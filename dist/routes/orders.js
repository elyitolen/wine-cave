"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.runAllocation = runAllocation;
const express_1 = require("express");
const db_1 = __importDefault(require("../db"));
const router = (0, express_1.Router)();
/**
 * FCFS Pooled Allocation Logic
 * - Pool all bottle requests for an offer
 * - Sort by created_at (first come, first served)
 * - Allocate as many bottles as possible from stock
 * - Cases of 6 have priority, then partial bottles
 */
function runAllocation(offerId) {
    const offer = db_1.default.prepare('SELECT * FROM offers WHERE id = ?').get(offerId);
    if (!offer)
        return;
    const totalStock = offer.stock_bottles;
    // Get all non-cancelled orders sorted by created_at (FCFS)
    const orders = db_1.default.prepare(`
    SELECT * FROM orders
    WHERE offer_id = ? AND status != 'cancelled'
    ORDER BY created_at ASC
  `).all(offerId);
    if (orders.length === 0)
        return;
    // Calculate total requested
    const totalRequested = orders.reduce((sum, o) => sum + o.bottles_requested, 0);
    const updateOrder = db_1.default.prepare(`
    UPDATE orders
    SET bottles_allocated = ?,
        status = ?,
        updated_at = datetime('now')
    WHERE id = ?
  `);
    const allocateAll = db_1.default.transaction(() => {
        let remainingStock = totalStock;
        if (totalRequested <= totalStock) {
            // Everyone gets what they want
            for (const order of orders) {
                updateOrder.run(order.bottles_requested, 'allocated', order.id);
            }
            return;
        }
        // FCFS allocation: give each person what they asked for until stock runs out
        const allocations = [];
        for (const order of orders) {
            if (remainingStock <= 0) {
                allocations.push({ id: order.id, allocated: 0, status: 'waitlisted' });
            }
            else if (remainingStock >= order.bottles_requested) {
                allocations.push({ id: order.id, allocated: order.bottles_requested, status: 'allocated' });
                remainingStock -= order.bottles_requested;
            }
            else {
                // Partial allocation
                allocations.push({ id: order.id, allocated: remainingStock, status: 'allocated' });
                remainingStock = 0;
            }
        }
        // Apply allocations
        for (const alloc of allocations) {
            updateOrder.run(alloc.allocated, alloc.status, alloc.id);
        }
    });
    allocateAll();
}
// GET /api/orders/mine — my orders across all offers
router.get('/mine', (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const orders = db_1.default.prepare(`
    SELECT
      ord.*,
      o.title,
      o.producer,
      o.vintage,
      o.price_per_bottle,
      o.currency,
      o.status as offer_status,
      o.closes_at
    FROM orders ord
    JOIN offers o ON o.id = ord.offer_id
    WHERE ord.user_id = ? AND ord.status != 'cancelled'
    ORDER BY ord.created_at DESC
  `).all(req.user.id);
    res.json(orders);
});
// POST /api/orders — place order
router.post('/', (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const { offer_id, bottles_requested } = req.body;
    if (!offer_id || !bottles_requested || bottles_requested < 1) {
        res.status(400).json({ error: 'offer_id and bottles_requested (>= 1) are required' });
        return;
    }
    const offer = db_1.default.prepare("SELECT * FROM offers WHERE id = ? AND status = 'open'").get(offer_id);
    if (!offer) {
        res.status(404).json({ error: 'Offer not found or not open' });
        return;
    }
    // Check for existing order
    const existing = db_1.default.prepare('SELECT * FROM orders WHERE offer_id = ? AND user_id = ?').get(offer_id, req.user.id);
    if (existing) {
        res.status(409).json({ error: 'You already have an order for this offer. Use PATCH to update.' });
        return;
    }
    db_1.default.prepare(`
    INSERT INTO orders (offer_id, user_id, bottles_requested)
    VALUES (?, ?, ?)
  `).run(offer_id, req.user.id, bottles_requested);
    // Re-run allocation
    runAllocation(offer_id);
    const order = db_1.default.prepare('SELECT * FROM orders WHERE offer_id = ? AND user_id = ?').get(offer_id, req.user.id);
    res.status(201).json(order);
});
// PATCH /api/orders/:id — update bottle count
router.patch('/:id', (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const order = db_1.default.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
    }
    // Only the order owner can update it
    if (order.user_id !== req.user.id && !req.user.is_admin) {
        res.status(403).json({ error: 'Not your order' });
        return;
    }
    if (order.status === 'cancelled') {
        res.status(400).json({ error: 'Cannot update a cancelled order' });
        return;
    }
    const { bottles_requested } = req.body;
    if (!bottles_requested || bottles_requested < 1) {
        res.status(400).json({ error: 'bottles_requested must be >= 1' });
        return;
    }
    // Check offer is still open
    const offer = db_1.default.prepare("SELECT * FROM offers WHERE id = ? AND status = 'open'").get(order.offer_id);
    if (!offer) {
        res.status(400).json({ error: 'Offer is not open for modifications' });
        return;
    }
    db_1.default.prepare(`
    UPDATE orders
    SET bottles_requested = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(bottles_requested, req.params.id);
    // Re-run allocation
    runAllocation(order.offer_id);
    const updated = db_1.default.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    res.json(updated);
});
// DELETE /api/orders/:id — cancel order
router.delete('/:id', (req, res) => {
    if (!req.user) {
        res.status(401).json({ error: 'Not authenticated' });
        return;
    }
    const order = db_1.default.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    if (!order) {
        res.status(404).json({ error: 'Order not found' });
        return;
    }
    if (order.user_id !== req.user.id && !req.user.is_admin) {
        res.status(403).json({ error: 'Not your order' });
        return;
    }
    // Check offer is still open
    const offer = db_1.default.prepare("SELECT * FROM offers WHERE id = ? AND status = 'open'").get(order.offer_id);
    if (!offer) {
        res.status(400).json({ error: 'Offer is not open; cannot cancel' });
        return;
    }
    db_1.default.prepare(`
    UPDATE orders
    SET status = 'cancelled', bottles_allocated = 0, updated_at = datetime('now')
    WHERE id = ?
  `).run(req.params.id);
    // Re-run allocation after cancellation
    runAllocation(order.offer_id);
    res.json({ success: true });
});
exports.default = router;
