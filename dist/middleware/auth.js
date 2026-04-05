"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.adminMiddleware = adminMiddleware;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = __importDefault(require("../db"));
const BOT_TOKEN = process.env.BOT_TOKEN || '8639801706:AAGPZPmVXBZrClgKjvRWwQnWNOkOytyMhpo';
function validateTelegramInitData(initData) {
    try {
        const params = new URLSearchParams(initData);
        const hash = params.get('hash');
        if (!hash)
            return null;
        params.delete('hash');
        // Sort keys alphabetically
        const sortedKeys = Array.from(params.keys()).sort();
        const dataCheckString = sortedKeys
            .map(key => `${key}=${params.get(key)}`)
            .join('\n');
        // Create secret key using HMAC-SHA256 with "WebAppData" as key
        const secretKey = crypto_1.default
            .createHmac('sha256', 'WebAppData')
            .update(BOT_TOKEN)
            .digest();
        const computedHash = crypto_1.default
            .createHmac('sha256', secretKey)
            .update(dataCheckString)
            .digest('hex');
        if (computedHash !== hash)
            return null;
        // Parse user data
        const result = {};
        params.forEach((value, key) => {
            result[key] = value;
        });
        return result;
    }
    catch {
        return null;
    }
}
function upsertUser(telegramUser) {
    const telegram_id = String(telegramUser.id);
    const existing = db_1.default.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
    // Permanent owner IDs — always admin regardless of DB state
    const OWNER_IDS = ['202455149'];
    const ADMIN_IDS = [...OWNER_IDS, ...(process.env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean)];
    const is_admin = ADMIN_IDS.includes(telegram_id) ? 1 : (existing?.is_admin ?? 0);
    if (existing) {
        db_1.default.prepare(`
      UPDATE users SET first_name = ?, last_name = ?, username = ?, is_admin = ?
      WHERE telegram_id = ?
    `).run(telegramUser.first_name || existing.first_name, telegramUser.last_name || existing.last_name, telegramUser.username || existing.username, is_admin, telegram_id);
        return db_1.default.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
    }
    else {
        db_1.default.prepare(`
      INSERT INTO users (telegram_id, first_name, last_name, username, is_admin)
      VALUES (?, ?, ?, ?, ?)
    `).run(telegram_id, telegramUser.first_name || null, telegramUser.last_name || null, telegramUser.username || null, is_admin);
        return db_1.default.prepare('SELECT * FROM users WHERE telegram_id = ?').get(telegram_id);
    }
}
function authMiddleware(req, res, next) {
    const initData = req.headers['x-telegram-init-data'];
    // Demo mode: no initData provided — create/use a demo user
    if (!initData) {
        const demoTelegramId = 'demo_user_1';
        const demoUser = upsertUser({
            id: demoTelegramId,
            first_name: 'Demo',
            last_name: 'User',
            username: 'demo_user'
        });
        // Make demo user admin for easy testing
        db_1.default.prepare('UPDATE users SET is_admin = 1 WHERE telegram_id = ?').run(demoTelegramId);
        demoUser.is_admin = 1;
        req.user = demoUser;
        return next();
    }
    const validated = validateTelegramInitData(initData);
    if (!validated) {
        res.status(401).json({ error: 'Invalid Telegram initData' });
        return;
    }
    try {
        const telegramUser = JSON.parse(validated['user'] || '{}');
        const user = upsertUser(telegramUser);
        req.user = user;
        next();
    }
    catch {
        res.status(401).json({ error: 'Failed to parse user data' });
    }
}
function adminMiddleware(req, res, next) {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    if (!req.user.is_admin) {
        res.status(403).json({ error: 'Admin access required' });
        return;
    }
    next();
}
