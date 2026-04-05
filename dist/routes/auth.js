"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
// POST /api/auth/login — validate Telegram initData, upsert user, return session
// Auth middleware already handles this — we just return the user
router.post('/login', (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    res.json({
        user: req.user,
        message: 'Logged in successfully'
    });
});
// GET /api/auth/me — get current user
router.get('/me', (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    res.json(req.user);
});
// POST /api/auth/grant-admin — force-grant admin using bot token as secret
router.post('/grant-admin', (req, res) => {
    const { secret, telegram_id } = req.body;
    const BOT_TOKEN = process.env.BOT_TOKEN || '8639801706:AAGPZPmVXBZrClgKjvRWwQnWNOkOytyMhpo';
    if (secret !== BOT_TOKEN) {
        res.status(403).json({ error: 'Invalid secret' });
        return;
    }
    // List all users if no telegram_id provided (helps find the right ID)
    if (!telegram_id) {
        const users = db_1.default.prepare('SELECT id, telegram_id, first_name, username, is_admin FROM users').all();
        res.json({ users });
        return;
    }
    db_1.default.prepare('UPDATE users SET is_admin = 1 WHERE telegram_id = ?').run(String(telegram_id));
    const user = db_1.default.prepare('SELECT * FROM users WHERE telegram_id = ?').get(String(telegram_id));
    if (!user) {
        res.status(404).json({ error: 'User not found — open the app in Telegram first, then retry' });
        return;
    }
    res.json({ ok: true, user });
});
exports.default = router;
