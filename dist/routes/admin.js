"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const jimp_1 = require("jimp");
const tesseract_js_1 = require("tesseract.js");
const router = (0, express_1.Router)();
// Multer setup — memory storage, max 10MB
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});
const multerSingle = upload.single('screenshot');
// All admin routes require admin privileges
router.use(auth_1.adminMiddleware);
const PARSE_PROMPT = `You are analyzing a wine offer screenshot from Edulis (Swiss wine merchant). Extract the following fields as JSON. Be precise. If a field is not found, use null.

{
  "title": "full wine name including appellation e.g. Château Pavie Saint-Émilion Grand Cru",
  "producer": "producer/domaine name only e.g. Château Pavie",
  "vintage": 2017,
  "region": "region e.g. Saint-Émilion",
  "country": "country e.g. France",
  "grape": "grape varieties e.g. 60% Merlot, 22% Cabernet Franc, 18% Cabernet Sauvignon",
  "price_per_bottle": 160.00,
  "currency": "CHF",
  "stock_bottles": 6,
  "score": 99,
  "score_source": "Robert Parker",
  "description": "first tasting note paragraph only, max 300 chars",
  "vivino_url": null
}

For stock_bottles: look for "X bottles per person" or "Limited @ X bottles" — that is the per-person limit which is the stock to use.
For score: use the highest critic score mentioned.
For price: extract the numeric price per bottle in CHF excluding TVA.`;
function parseOcrText(text) {
    // Normalize text
    const t = text.replace(/\s+/g, ' ').trim();
    // ── Price ─────────────────────────────────────────────────────────────
    const priceMatch = t.match(/[@®]\s*([\d.,]+)\s*CHF/i) ||
        t.match(/([\d.,]+)\s*CHF\s*\/\s*b/i);
    const price_per_bottle = priceMatch
        ? parseFloat(priceMatch[1].replace(',', '.'))
        : null;
    // ── Vintage ───────────────────────────────────────────────────────────
    const vintageMatch = t.match(/\b(19|20)\d{2}\b.*?@/) ||
        t.match(/@.*?((?:19|20)\d{2})\b/) ||
        t.match(/\b((19|20)\d{2})\s*@/);
    // Scan for year near @ symbol
    const yearNearPrice = t.match(/((?:19|20)\d{2})\s*[@®]/);
    const vintage = yearNearPrice ? parseInt(yearNearPrice[1]) : null;
    // ── Stock bottles ──────────────────────────────────────────────────────
    const stockMatch = t.match(/[Oo]nly\s*(\d+)\s*(?:wooden\s*case\s*of\s*)?(\d+)?\s*bottles?\s*per\s*person/i) ||
        t.match(/[Ll]imited\s*@\s*(\d+)\s*bottles?\s*\/?\s*[Pp]erson/i) ||
        t.match(/[Oo]nly\s*(\d+)\s*[Bb]ottles?\s*\/\s*[Pp]erson/i) ||
        t.match(/(\d+)\s*[Bb]ati[sl][\w!]*\s*[|/\\]\s*[Pp]erso/i) ||
        t.match(/(\d+)\s*[Bb]ot(?:tles?)?\s*[|/\\]\s*[Pp]ers/i);
    let stock_bottles = null;
    if (stockMatch) {
        // If "1 wooden case of 6 bottles" → stock = 6
        if (stockMatch[2]) {
            stock_bottles = parseInt(stockMatch[2]);
        }
        else {
            stock_bottles = parseInt(stockMatch[1]);
        }
    }
    // ── Score ──────────────────────────────────────────────────────────────
    const scoreMatches = [...t.matchAll(/(\d{2,3})\s*[Pp]oints?/g)];
    const scores = scoreMatches.map(m => parseInt(m[1])).filter(s => s >= 85 && s <= 100);
    const score = scores.length > 0 ? Math.max(...scores) : null;
    // ── Score source ───────────────────────────────────────────────────────
    const sourceMatch = t.match(/(Robert Parker|James Suckling|Jeb Dunnuck|Wine Spectator|Antonio Galloni|Wine Advocate|Vinous|Decanter)\s*[:\-]/i);
    const score_source = sourceMatch ? sourceMatch[1] : null;
    // ── Title and producer from the headline ──────────────────────────────
    // Pattern: "0.75L - Producer WINE NAME (appellation) VINTAGE @ PRICE"
    const headlineMatch = t.match(/0\.75L\s*[-–]\s*(.+?)\s*(?:(?:19|20)\d{2})\s*[@®]/i);
    let title = null;
    let producer = null;
    if (headlineMatch) {
        const rawTitle = headlineMatch[1].trim();
        title = rawTitle;
        // Extract producer: everything before the FIRST all-caps word sequence
        // e.g. "Charles Noëllat GEVREY CHAMBERTIN En Pallud" → producer = "Charles Noëllat"
        const producerMatch = rawTitle.match(/^(.+?)\s+(?=[A-ZÀ-Ÿ]{3,})/);
        producer = producerMatch ? producerMatch[1].trim() : rawTitle.split(' ').slice(0, 2).join(' ');
        // Append vintage to title
        if (vintage)
            title = `${rawTitle} ${vintage}`;
    }
    // ── Grape ──────────────────────────────────────────────────────────────
    const grapeMatch = t.match(/[Gg]rape\s*[:\-]?\s*([^\n.]+(?:Pinot|Merlot|Cabernet|Syrah|Grenache|Riesling|Chardonnay|Nebbiolo|Sangiovese|Tempranillo)[^\n.]*)/i) ||
        t.match(/(\d+%\s*(?:Pinot|Merlot|Cabernet|Syrah|Grenache|Riesling|Chardonnay|Nebbiolo|Sangiovese|Tempranillo)[^\n.;,]*(?:,\s*\d+%\s*\w+)*)/i) ||
        t.match(/100%\s*(Pinot Noir|Merlot|Cabernet Sauvignon|Syrah|Grenache|Riesling|Chardonnay|Nebbiolo|Sangiovese)/i);
    const grape = grapeMatch ? grapeMatch[1].trim().slice(0, 200) : null;
    // ── Description: first long sentence after a critic name ──────────────
    const descMatch = t.match(/\d{2,3}\s*[Pp]oints?\s+([A-Z][^.!?]+(?:[.!?][^.!?]+){0,3})/);
    const description = descMatch ? descMatch[1].trim().slice(0, 400) : null;
    // ── Country/region heuristics ──────────────────────────────────────────
    let country = null;
    let region = null;
    const regionCountryMap = {
        'Bordeaux': { region: 'Bordeaux', country: 'France' },
        'Saint-Émilion': { region: 'Saint-Émilion', country: 'France' },
        'Pomerol': { region: 'Pomerol', country: 'France' },
        'Pauillac': { region: 'Pauillac', country: 'France' },
        'Gevrey': { region: 'Gevrey-Chambertin', country: 'France' },
        'Chambertin': { region: 'Gevrey-Chambertin', country: 'France' },
        'Bourgogne': { region: 'Bourgogne', country: 'France' },
        'Burgundy': { region: 'Bourgogne', country: 'France' },
        'Hermitage': { region: 'Rhône', country: 'France' },
        'Châteauneuf': { region: 'Châteauneuf-du-Pape', country: 'France' },
        'Champagne': { region: 'Champagne', country: 'France' },
        'Mosel': { region: 'Mosel', country: 'Germany' },
        'Rheingau': { region: 'Rheingau', country: 'Germany' },
        'Barolo': { region: 'Barolo', country: 'Italy' },
        'Barbaresco': { region: 'Barbaresco', country: 'Italy' },
        'Brunello': { region: 'Montalcino', country: 'Italy' },
        'Rioja': { region: 'Rioja', country: 'Spain' },
        'Priorat': { region: 'Priorat', country: 'Spain' },
        'Napa': { region: 'Napa Valley', country: 'USA' },
        'Wachau': { region: 'Wachau', country: 'Austria' },
    };
    for (const [keyword, val] of Object.entries(regionCountryMap)) {
        if (t.includes(keyword)) {
            region = val.region;
            country = val.country;
            break;
        }
    }
    return {
        title,
        producer,
        vintage,
        region,
        country,
        grape,
        price_per_bottle,
        currency: 'CHF',
        stock_bottles,
        score,
        score_source,
        description,
        vivino_url: null,
    };
}
// ── Vivino URL lookup via Brave Search ──────────────────────────────────────
async function findVivinoUrl(producer, title, vintage) {
    try {
        // Build search query: site:vivino.com {producer} {title words} {vintage}
        const nameWords = (title || '').replace(producer || '', '').trim();
        const queryParts = [
            'site:vivino.com',
            producer || '',
            nameWords,
            vintage ? String(vintage) : '',
        ].filter(Boolean);
        const query = queryParts.join(' ');
        // Use Yahoo Search — returns Vivino URLs in RU= encoded params, works from servers
        const res = await fetch('https://search.yahoo.com/search?p=' + encodeURIComponent(query), {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'en-US,en;q=0.9',
            },
            redirect: 'follow',
            signal: AbortSignal.timeout(10000),
        });
        if (!res.ok)
            return null;
        const html = await res.text();
        // Yahoo encodes result URLs in RU= query parameters
        const ruMatches = html.match(/RU=(https?%3A%2F%2F[^%]+vivino[^&"<>]+)/gi) || [];
        const vivinoUrls = ruMatches
            .map(m => {
            try {
                return decodeURIComponent(m.replace(/^RU=/i, ''));
            }
            catch {
                return '';
            }
        })
            .filter(u => /vivino\.com\/.+\/w\/\d+/.test(u))
            // Strip Yahoo tracking suffix (/RK=... /RS=...)
            .map(u => u.replace(/\/(RK|RS)=[^/]*.*$/, '').replace(/[?&]bottle_count=.*$/, ''));
        const uniqueUrls = [...new Set(vivinoUrls)];
        if (uniqueUrls.length === 0)
            return null;
        const yearStr = vintage ? String(vintage) : '';
        // Yahoo already ranks by relevance — prefer first URL that has the correct vintage year.
        // Fall back to first URL with any vintage if no year match found.
        const withVintage = uniqueUrls.filter(u => yearStr && u.includes('year=' + yearStr));
        const withoutVintage = uniqueUrls.filter(u => !yearStr || !u.includes('year='));
        // Quick sanity-check: must contain at least one word from the wine name in its slug
        const normalize = (s) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
        const cleanTitle = (title || '')
            .replace(/\([^)]*\)/g, ' ')
            .replace(/\d{4}/g, ' ')
            .trim();
        const titleSlug = normalize(cleanTitle);
        const titleWords = titleSlug.split(' ').filter(w => w.length > 4);
        const isRelevant = (url) => {
            const slug = normalize(url);
            return titleWords.some(w => slug.includes(w));
        };
        const best = [...withVintage, ...withoutVintage].find(isRelevant);
        if (!best)
            return null;
        // Normalise URL: strip country/locale prefix → canonical form
        const canonical = bestUrl
            .replace(/https:\/\/www\.vivino\.com\/[A-Z]{2}(-[A-Z]{2})?\/en\//, 'https://www.vivino.com/')
            .replace(/https:\/\/www\.vivino\.com\/[A-Z]{2}(-[A-Z]{2})?\/([a-z]{2})\//, 'https://www.vivino.com/$2/');
        return canonical;
    }
    catch (err) {
        console.error('[findVivinoUrl] Error:', err);
        return null;
    }
}
// POST /api/admin/parse-screenshot — parse a wine offer screenshot
router.post('/parse-screenshot', multerSingle, async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No screenshot file uploaded' });
            return;
        }
        const file = req.file;
        const buffer = file.buffer;
        // ── 1. Crop the wine bottle image using Jimp ──────────────────────────
        const image = await jimp_1.Jimp.read(buffer);
        const imgWidth = image.width;
        const imgHeight = image.height;
        // Smart bottle region detection:
        // Score each row by the fraction of "mid-tone" pixels (not pure white, not text-black).
        // Bottle photo rows have many mid-tone pixels; text-on-white rows are mostly white.
        const SKIP_TOP = 130;
        const SKIP_BOTTOM = 50;
        const rawScores = [];
        const step = Math.max(1, Math.floor(imgWidth / 50)); // sample ~50 pixels per row
        for (let y = SKIP_TOP; y < imgHeight - SKIP_BOTTOM; y++) {
            let midToneCount = 0;
            let total = 0;
            for (let x = 0; x < imgWidth; x += step) {
                const pixel = image.getPixelColor(x, y);
                const r = (pixel >> 24) & 0xff;
                const g = (pixel >> 16) & 0xff;
                const b = (pixel >> 8) & 0xff;
                // Mid-tone: not pure white (maxC < 235) and not near-black (minC > 20)
                if (Math.max(r, g, b) < 235 && Math.min(r, g, b) > 20)
                    midToneCount++;
                total++;
            }
            rawScores.push(midToneCount / total);
        }
        // Smooth scores with a 15-row moving average
        const SMOOTH = 15;
        const smoothed = rawScores.map((_, i) => {
            const start = Math.max(0, i - SMOOTH);
            const end = Math.min(rawScores.length, i + SMOOTH + 1);
            const slice = rawScores.slice(start, end);
            return slice.reduce((a, b) => a + b, 0) / slice.length;
        });
        // Find largest contiguous region above threshold
        const THRESHOLD = 0.4;
        let bestStart = -1, bestEnd = -1, bestLen = 0;
        let curStart = -1;
        for (let i = 0; i < smoothed.length; i++) {
            if (smoothed[i] > THRESHOLD && curStart === -1) {
                curStart = i;
            }
            else if (smoothed[i] <= THRESHOLD && curStart !== -1) {
                const len = i - curStart;
                if (len > bestLen) {
                    bestLen = len;
                    bestStart = curStart;
                    bestEnd = i;
                }
                curStart = -1;
            }
        }
        if (curStart !== -1) {
            const len = smoothed.length - curStart;
            if (len > bestLen) {
                bestStart = curStart;
                bestEnd = smoothed.length;
            }
        }
        // Convert back to image coordinates (offset by SKIP_TOP) with 10px padding
        let cropY, cropHeight;
        if (bestStart >= 0) {
            cropY = Math.max(0, bestStart + SKIP_TOP - 10);
            const cropYEnd = Math.min(imgHeight, bestEnd + SKIP_TOP + 10);
            cropHeight = cropYEnd - cropY;
        }
        else {
            // Fallback: top third of image below nav bar
            cropY = SKIP_TOP;
            cropHeight = Math.round(imgHeight * 0.35);
        }
        const croppedBuffer = await image
            .clone()
            .crop({ x: 0, y: cropY, w: imgWidth, h: cropHeight })
            .getBuffer(jimp_1.JimpMime.png);
        const bottleBase64 = `data:image/png;base64,${croppedBuffer.toString('base64')}`;
        // ── 2. OCR the screenshot with Tesseract ──────────────────────────────
        const worker = await (0, tesseract_js_1.createWorker)('eng+fra');
        const { data: { text } } = await worker.recognize(buffer);
        await worker.terminate();
        console.log('[parse-screenshot] OCR text:', text.slice(0, 500));
        // ── 3. Parse fields from OCR text ─────────────────────────────────────
        const parsed = parseOcrText(text);
        console.log('[parse-screenshot] Parsed:', JSON.stringify(parsed));
        // ── 4. Find Vivino URL ──────────────────────────────────────────────────
        const vivinoUrl = await findVivinoUrl(parsed.producer, parsed.title, parsed.vintage);
        if (vivinoUrl) {
            parsed.vivino_url = vivinoUrl;
            console.log('[parse-screenshot] Vivino URL:', vivinoUrl);
        }
        else {
            console.log('[parse-screenshot] No confident Vivino match found');
        }
        res.json({
            parsed,
            bottle_image_base64: bottleBase64,
            ocr_text: text, // include for debugging
        });
    }
    catch (err) {
        console.error('[parse-screenshot] Error:', err);
        res.status(500).json({
            error: 'Failed to parse screenshot',
            message: err instanceof Error ? err.message : String(err),
        });
    }
});
// GET /api/admin/users — list all users
router.get('/users', (req, res) => {
    const users = db_1.default.prepare(`
    SELECT
      u.*,
      COUNT(DISTINCT ord.id) as order_count
    FROM users u
    LEFT JOIN orders ord ON ord.user_id = u.id AND ord.status != 'cancelled'
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `).all();
    res.json(users);
});
// PATCH /api/admin/users/:id — toggle admin status
router.patch('/users/:id', (req, res) => {
    const { is_admin } = req.body;
    if (is_admin === undefined) {
        res.status(400).json({ error: 'is_admin field required' });
        return;
    }
    db_1.default.prepare('UPDATE users SET is_admin = ? WHERE id = ?').run(is_admin ? 1 : 0, req.params.id);
    const user = db_1.default.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
    res.json(user);
});
// GET /api/admin/stats — overall stats
router.get('/stats', (req, res) => {
    const stats = {
        totalUsers: db_1.default.prepare('SELECT COUNT(*) as cnt FROM users').get().cnt,
        totalOffers: db_1.default.prepare('SELECT COUNT(*) as cnt FROM offers').get().cnt,
        openOffers: db_1.default.prepare("SELECT COUNT(*) as cnt FROM offers WHERE status = 'open'").get().cnt,
        totalOrders: db_1.default.prepare("SELECT COUNT(*) as cnt FROM orders WHERE status != 'cancelled'").get().cnt,
        totalPaymentsPending: db_1.default.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'pending'").get().total,
        totalPaymentsPaid: db_1.default.prepare("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE status = 'paid'").get().total,
    };
    res.json(stats);
});
// GET /api/admin/payments — all payments
router.get('/payments', (req, res) => {
    const payments = db_1.default.prepare(`
    SELECT
      p.*,
      u.first_name,
      u.last_name,
      u.username,
      u.telegram_id,
      o.title as offer_title
    FROM payments p
    JOIN users u ON u.id = p.user_id
    JOIN offers o ON o.id = p.offer_id
    ORDER BY p.created_at DESC
  `).all();
    res.json(payments);
});
// PATCH /api/admin/payments/:id — mark payment as paid
router.patch('/payments/:id', (req, res) => {
    const { status } = req.body;
    if (!status || !['pending', 'paid'].includes(status)) {
        res.status(400).json({ error: 'status must be pending or paid' });
        return;
    }
    db_1.default.prepare('UPDATE payments SET status = ? WHERE id = ?').run(status, req.params.id);
    const payment = db_1.default.prepare('SELECT * FROM payments WHERE id = ?').get(req.params.id);
    res.json(payment);
});
exports.default = router;
