"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
// GET /api/payments/mine — my payment summary
router.get('/mine', (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const payments = db_1.default.prepare(`
    SELECT
      p.*,
      o.title as offer_title,
      o.producer,
      o.vintage,
      o.price_per_bottle,
      ord.bottles_allocated
    FROM payments p
    JOIN offers o ON o.id = p.offer_id
    LEFT JOIN orders ord ON ord.offer_id = p.offer_id AND ord.user_id = p.user_id
    WHERE p.user_id = ?
    ORDER BY p.created_at DESC
  `).all(req.user.id);
    const summary = {
        payments,
        totalPending: payments
            .filter((p) => p.status === 'pending')
            .reduce((sum, p) => sum + p.amount, 0),
        totalPaid: payments
            .filter((p) => p.status === 'paid')
            .reduce((sum, p) => sum + p.amount, 0),
        currency: 'CHF'
    };
    res.json(summary);
});
exports.default = router;
