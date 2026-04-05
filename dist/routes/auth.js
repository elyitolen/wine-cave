"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
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
exports.default = router;
