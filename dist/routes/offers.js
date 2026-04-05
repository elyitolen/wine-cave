"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const auth_1 = require("../middleware/auth");
const orders_1 = require("./orders");
const router = (0, express_1.Router)();
// GET /api/offers — list all open offers with order counts
router.get('/', (req, res) => {
    const offers = db_1.default.prepare(`
    SELECT
      o.*,
      COUNT(DISTINCT ord.id) as order_count,
      COALESCE(SUM(CASE WHEN ord.status != 'cancelled' THEN ord.bottles_requested ELSE 0 END), 0) as bottles_requested_total,
      COALESCE(SUM(CASE WHEN ord.status != 'cancelled' THEN ord.bottles_allocated ELSE 0 END), 0) as bottles_allocated_total
    FROM offers o
    LEFT JOIN orders ord ON ord.offer_id = o.id AND ord.status != 'cancelled'
    WHERE o.status = 'open'
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `).all();
    res.json(offers);
});
// GET /api/offers/all — list ALL offers (admin)
router.get('/all', auth_1.adminMiddleware, (req, res) => {
    const offers = db_1.default.prepare(`
    SELECT
      o.*,
      COUNT(DISTINCT ord.id) as order_count,
      COALESCE(SUM(CASE WHEN ord.status != 'cancelled' THEN ord.bottles_requested ELSE 0 END), 0) as bottles_requested_total,
      COALESCE(SUM(CASE WHEN ord.status != 'cancelled' THEN ord.bottles_allocated ELSE 0 END), 0) as bottles_allocated_total
    FROM offers o
    LEFT JOIN orders ord ON ord.offer_id = o.id AND ord.status != 'cancelled'
    GROUP BY o.id
    ORDER BY o.created_at DESC
  `).all();
    res.json(offers);
});
// GET /api/offers/:id — single offer with full order list + allocation snapshot
router.get('/:id', (req, res) => {
    const offer = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    if (!offer) {
        res.status(404).json({ error: 'Offer not found' });
        return;
    }
    const orders = db_1.default.prepare(`
    SELECT
      ord.*,
      u.first_name,
      u.last_name,
      u.username,
      u.telegram_id
    FROM orders ord
    JOIN users u ON u.id = ord.user_id
    WHERE ord.offer_id = ?
    ORDER BY ord.created_at ASC
  `).all(req.params.id);
    // Get the current user's order if logged in
    const myOrder = req.user
        ? db_1.default.prepare('SELECT * FROM orders WHERE offer_id = ? AND user_id = ?').get(req.params.id, req.user.id)
        : null;
    res.json({ offer, orders, myOrder });
});
// POST /api/offers — create offer (admin only)
router.post('/', auth_1.adminMiddleware, (req, res) => {
    const { title, producer, vintage, region, country, grape, score, price_per_bottle, currency, stock_bottles, image_url, vivino_url, description, closes_at } = req.body;
    if (!title || !price_per_bottle || stock_bottles === undefined || stock_bottles === null) {
        res.status(400).json({ error: 'title, price_per_bottle, and stock_bottles are required' });
        return;
    }
    const result = db_1.default.prepare(`
    INSERT INTO offers (title, producer, vintage, region, country, grape, score, price_per_bottle, currency, stock_bottles, image_url, vivino_url, description, closes_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, producer || null, vintage || null, region || null, country || null, grape || null, score || null, price_per_bottle, currency || 'CHF', stock_bottles, image_url || null, vivino_url || null, description || null, closes_at || null);
    const offer = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(offer);
});
// PATCH /api/offers/:id — update offer (admin only)
router.patch('/:id', auth_1.adminMiddleware, (req, res) => {
    const offer = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    if (!offer) {
        res.status(404).json({ error: 'Offer not found' });
        return;
    }
    const { title, producer, vintage, region, country, grape, score, price_per_bottle, currency, stock_bottles, image_url, vivino_url, description, closes_at, status } = req.body;
    db_1.default.prepare(`
    UPDATE offers SET
      title = COALESCE(?, title),
      producer = COALESCE(?, producer),
      vintage = COALESCE(?, vintage),
      region = COALESCE(?, region),
      country = COALESCE(?, country),
      grape = COALESCE(?, grape),
      score = COALESCE(?, score),
      price_per_bottle = COALESCE(?, price_per_bottle),
      currency = COALESCE(?, currency),
      stock_bottles = COALESCE(?, stock_bottles),
      image_url = COALESCE(?, image_url),
      vivino_url = COALESCE(?, vivino_url),
      description = COALESCE(?, description),
      closes_at = COALESCE(?, closes_at),
      status = COALESCE(?, status)
    WHERE id = ?
  `).run(title || null, producer || null, vintage || null, region || null, country || null, grape || null, score || null, price_per_bottle || null, currency || null, stock_bottles || null, image_url || null, vivino_url || null, description || null, closes_at || null, status || null, req.params.id);
    const updated = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    res.json(updated);
});
// POST /api/offers/:id/close — close offer (admin only)
router.post('/:id/close', auth_1.adminMiddleware, (req, res) => {
    const offer = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    if (!offer) {
        res.status(404).json({ error: 'Offer not found' });
        return;
    }
    db_1.default.prepare("UPDATE offers SET status = 'closed' WHERE id = ?").run(req.params.id);
    // Run final allocation
    (0, orders_1.runAllocation)(offer.id);
    // Create payment records for allocated orders
    const allocatedOrders = db_1.default.prepare(`
    SELECT ord.*, u.id as uid
    FROM orders ord
    JOIN users u ON u.id = ord.user_id
    WHERE ord.offer_id = ? AND ord.status = 'allocated' AND ord.bottles_allocated > 0
  `).all(req.params.id);
    const offerData = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    if (offerData) {
        const insertPayment = db_1.default.prepare(`
      INSERT OR IGNORE INTO payments (user_id, offer_id, amount, currency)
      VALUES (?, ?, ?, ?)
    `);
        const insertAll = db_1.default.transaction(() => {
            for (const order of allocatedOrders) {
                const amount = order.bottles_allocated * offerData.price_per_bottle;
                insertPayment.run(order.uid, order.offer_id, amount, offerData.currency);
            }
        });
        insertAll();
    }
    res.json({ success: true, message: 'Offer closed and payments created' });
});
// POST /api/offers/:id/recalculate — re-run allocation (admin only)
router.post('/:id/recalculate', auth_1.adminMiddleware, (req, res) => {
    const offer = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(req.params.id);
    if (!offer) {
        res.status(404).json({ error: 'Offer not found' });
        return;
    }
    (0, orders_1.runAllocation)(offer.id);
    const orders = db_1.default.prepare(`
    SELECT ord.*, u.first_name, u.last_name, u.username
    FROM orders ord
    JOIN users u ON u.id = ord.user_id
    WHERE ord.offer_id = ?
    ORDER BY ord.created_at ASC
  `).all(req.params.id);
    res.json({ success: true, orders });
});
exports.default = router;
