"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
const auth_1 = require("./middleware/auth");
const offers_1 = __importDefault(require("./routes/offers"));
const orders_1 = __importDefault(require("./routes/orders"));
const admin_1 = __importDefault(require("./routes/admin"));
const auth_2 = __importDefault(require("./routes/auth"));
const payments_1 = __importDefault(require("./routes/payments"));
const app = (0, express_1.default)();
const PORT = parseInt(process.env.PORT || '3001', 10);
// CORS — allow all origins (needed for Telegram Mini App)
app.use((0, cors_1.default)({
    origin: '*',
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'X-Telegram-Init-Data', 'Authorization'],
}));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true, limit: '10mb' }));
// Health check (no auth)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        openai_key_set: !!process.env.OPENAI_API_KEY,
        openai_key_prefix: process.env.OPENAI_API_KEY ? process.env.OPENAI_API_KEY.slice(0, 7) + '...' : 'NOT SET',
        admin_ids: process.env.ADMIN_IDS || 'NOT SET',
    });
});
// Apply auth middleware to all API routes
app.use('/api', auth_1.authMiddleware);
// API Routes
app.use('/api/auth', auth_2.default);
app.use('/api/offers', offers_1.default);
app.use('/api/orders', orders_1.default);
app.use('/api/payments', payments_1.default);
app.use('/api/admin', admin_1.default);
// Serve static frontend — check multiple candidate paths
const candidatePaths = [
    path_1.default.join(__dirname, '../miniapp/dist'), // flat deploy folder: dist/ + miniapp/dist/
    path_1.default.join(__dirname, '../../miniapp/dist'), // monorepo: apps/api/dist/ + apps/miniapp/dist/
    path_1.default.join(process.cwd(), 'miniapp/dist'), // cwd-relative
];
const staticPath = candidatePaths.find(p => fs_1.default.existsSync(p));
if (staticPath) {
    app.use(express_1.default.static(staticPath));
    // React Router support — return index.html for all non-API routes
    app.get('*', (req, res) => {
        res.sendFile(path_1.default.join(staticPath, 'index.html'));
    });
    console.log(`Serving frontend from ${staticPath}`);
}
else {
    // API-only mode fallback
    app.use((req, res) => {
        res.status(404).json({ error: 'Not found' });
    });
}
// Error handler
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error', message: err.message });
});
app.listen(PORT, () => {
    console.log(`Wine Cave API running on port ${PORT}`);
});
exports.default = app;
