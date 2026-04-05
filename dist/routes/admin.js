"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// All admin routes require admin privileges
router.use(auth_1.adminMiddleware);
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
