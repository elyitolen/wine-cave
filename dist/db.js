"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const path_1 = __importDefault(require("path"));
const DB_PATH = process.env.DB_PATH || path_1.default.join(process.cwd(), 'wine-cave.db');
const db = new better_sqlite3_1.default(DB_PATH);
// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    telegram_id TEXT UNIQUE NOT NULL,
    first_name TEXT,
    last_name TEXT,
    username TEXT,
    is_admin INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS offers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    producer TEXT,
    vintage INTEGER,
    region TEXT,
    country TEXT,
    grape TEXT,
    score INTEGER,
    price_per_bottle REAL NOT NULL,
    currency TEXT DEFAULT 'CHF',
    stock_bottles INTEGER NOT NULL,
    image_url TEXT,
    vivino_url TEXT,
    description TEXT,
    status TEXT DEFAULT 'open' CHECK(status IN ('open','closed','cancelled')),
    created_at TEXT DEFAULT (datetime('now')),
    closes_at TEXT
  );

  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    offer_id INTEGER NOT NULL REFERENCES offers(id),
    user_id INTEGER NOT NULL REFERENCES users(id),
    bottles_requested INTEGER NOT NULL,
    bottles_allocated INTEGER DEFAULT 0,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','allocated','waitlisted','cancelled')),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(offer_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    offer_id INTEGER NOT NULL REFERENCES offers(id),
    amount REAL NOT NULL,
    currency TEXT DEFAULT 'CHF',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid')),
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, offer_id)
  );
`);
// Seed demo data on first startup
function seedDemoData() {
    const offerCount = db.prepare('SELECT COUNT(*) as cnt FROM offers').get().cnt;
    if (offerCount > 0)
        return;
    const insertOffer = db.prepare(`
    INSERT INTO offers (title, producer, vintage, region, country, grape, score, price_per_bottle, currency, stock_bottles, description, closes_at)
    VALUES (@title, @producer, @vintage, @region, @country, @grape, @score, @price_per_bottle, @currency, @stock_bottles, @description, @closes_at)
  `);
    const demoOffers = [
        {
            title: 'Barolo Brunate 2019',
            producer: 'Giuseppe Rinaldi',
            vintage: 2019,
            region: 'Piedmont',
            country: 'Italy',
            grape: 'Nebbiolo',
            score: 97,
            price_per_bottle: 145.00,
            currency: 'CHF',
            stock_bottles: 36,
            description: 'A benchmark Barolo from one of the Langhe\'s most storied estates. Deep garnet with a nose of dried roses, tar, and forest floor. On the palate, silky tannins frame flavors of cherry, tobacco, and spice. Exceptional ageing potential of 20+ years.',
            closes_at: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            title: 'Champagne Blanc de Blancs 2015',
            producer: 'Pierre Péters',
            vintage: 2015,
            region: 'Champagne — Le Mesnil-sur-Oger',
            country: 'France',
            grape: 'Chardonnay',
            score: 95,
            price_per_bottle: 98.00,
            currency: 'CHF',
            stock_bottles: 48,
            description: 'From the Grand Cru village of Le Mesnil-sur-Oger, this Blanc de Blancs delivers stunning mineral precision. Lemon curd, white flowers, and a chalky backbone that is quintessentially Côte des Blancs. Vibrant acidity ensures a long finish.',
            closes_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            title: 'Hermitage Rouge 2018',
            producer: 'M. Chapoutier',
            vintage: 2018,
            region: 'Northern Rhône',
            country: 'France',
            grape: 'Syrah',
            score: 96,
            price_per_bottle: 122.50,
            currency: 'CHF',
            stock_bottles: 24,
            description: 'A majestic Hermitage from granitic soils on the famed hill. Dense and concentrated with black olive, smoked meat, and dark berry fruit. The tannins are powerful yet refined, with a finish that lingers for over a minute. Will reward a decade of patience.',
            closes_at: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString()
        },
        {
            title: 'Riesling Smaragd Singerriedel 2021',
            producer: 'Emmerich Knoll',
            vintage: 2021,
            region: 'Wachau',
            country: 'Austria',
            grape: 'Riesling',
            score: 94,
            price_per_bottle: 68.00,
            currency: 'CHF',
            stock_bottles: 60,
            description: 'From the legendary Singerriedel vineyard, this Smaragd Riesling is a tour de force. Peach, apricot, and white peach on the nose with a vibrant, almost electric minerality. Perfect balance between richness and freshness. A sommelier favourite.',
            closes_at: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000).toISOString()
        }
    ];
    const insertMany = db.transaction(() => {
        for (const offer of demoOffers) {
            insertOffer.run(offer);
        }
    });
    insertMany();
    console.log('Seeded 4 demo wine offers.');
}
seedDemoData();
// ── Migrations ────────────────────────────────────────────────────────────
// Add UNIQUE(user_id, offer_id) to payments if it doesn't exist yet.
// SQLite doesn't support ADD CONSTRAINT, so we rebuild the table idempotently.
try {
    const tableInfo = db.prepare("PRAGMA index_list('payments')").all();
    const hasUnique = tableInfo.some(idx => idx.unique && idx.name.toLowerCase().includes('user_id'));
    if (!hasUnique) {
        // Check if a unique index already exists via a different naming
        const indexes = db.prepare("SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='payments'").all();
        const uniqueOnUserOffer = indexes.some(i => i.sql && i.sql.includes('user_id') && i.sql.includes('offer_id'));
        if (!uniqueOnUserOffer) {
            db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_user_offer ON payments(user_id, offer_id)`);
            console.log('[migration] Added UNIQUE index on payments(user_id, offer_id)');
        }
    }
}
catch (e) {
    console.warn('[migration] payments unique index:', e);
}
exports.default = db;
