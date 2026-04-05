"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const multer_1 = __importDefault(require("multer"));
const sharp_1 = __importDefault(require("sharp"));
const openai_1 = __importDefault(require("openai"));
const router = (0, express_1.Router)();
// Multer setup — memory storage, max 10MB
const upload = (0, multer_1.default)({
    storage: multer_1.default.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
});
// Cast multer middleware to avoid @types/multer / @types/express version conflicts
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
// Mock response for when OPENAI_API_KEY is not set
const MOCK_PARSED = {
    title: 'Château Example Saint-Émilion Grand Cru',
    producer: 'Château Example',
    vintage: 2020,
    region: 'Saint-Émilion',
    country: 'France',
    grape: '70% Merlot, 30% Cabernet Franc',
    price_per_bottle: 89.00,
    currency: 'CHF',
    stock_bottles: 6,
    score: 95,
    score_source: 'Robert Parker',
    description: 'Rich and complex with layers of dark fruit, cedar, and spice. Long, velvety finish.',
    vivino_url: null,
};
// POST /api/admin/parse-screenshot — parse a wine offer screenshot
router.post('/parse-screenshot', multerSingle, async (req, res) => {
    try {
        if (!req.file) {
            res.status(400).json({ error: 'No screenshot file uploaded' });
            return;
        }
        const file = req.file;
        const buffer = file.buffer;
        // ── 1. Crop the wine bottle image using Sharp ──────────────────────────
        const metadata = await (0, sharp_1.default)(buffer).metadata();
        const imgWidth = metadata.width ?? 1080;
        const imgHeight = metadata.height ?? 1920;
        // Bottle is in the upper-left to upper-center area
        const cropX = 0;
        const cropY = 50; // skip status bar
        const cropWidth = Math.round(imgWidth * 0.55);
        const cropHeight = Math.round(imgHeight * 0.40);
        const croppedBuffer = await (0, sharp_1.default)(buffer)
            .extract({
            left: cropX,
            top: cropY,
            width: Math.min(cropWidth, imgWidth),
            height: Math.min(cropHeight, imgHeight - cropY),
        })
            .trim()
            .png()
            .toBuffer();
        const bottleBase64 = `data:image/png;base64,${croppedBuffer.toString('base64')}`;
        // ── 2. Parse wine details using OpenAI Vision ──────────────────────────
        let parsed;
        if (!process.env.OPENAI_API_KEY) {
            // No API key — return mock data for testing
            console.log('[parse-screenshot] OPENAI_API_KEY not set, returning mock data');
            parsed = MOCK_PARSED;
        }
        else {
            const openai = new openai_1.default({ apiKey: process.env.OPENAI_API_KEY });
            const base64Image = buffer.toString('base64');
            const mimeType = file.mimetype;
            const response = await openai.chat.completions.create({
                model: 'gpt-4o',
                max_tokens: 1000,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: PARSE_PROMPT },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${base64Image}`,
                                    detail: 'high',
                                },
                            },
                        ],
                    },
                ],
            });
            const text = response.choices[0].message.content ?? '';
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                res.status(422).json({ error: 'Could not extract JSON from OpenAI response', raw: text });
                return;
            }
            parsed = JSON.parse(jsonMatch[0]);
        }
        res.json({
            parsed,
            bottle_image_base64: bottleBase64,
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
