const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
dotenv.config();

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const pool = require('./db');
const { MatchService } = require('./match/MatchService');
const { createAuthMiddleware } = require('./middleware/auth');
const { createUnitService } = require('./services/unitService');
const { createAuthRouter } = require('./routes/authRoutes');
const { createAdminUnitRouter, createUnitRouter } = require('./routes/unitRoutes');
const { createUserRouter } = require('./routes/userRoutes');
const { createSessionRouter } = require('./routes/sessionRoutes');
const { createMatchRouter } = require('./routes/matchRoutes');
const { createGameRouter } = require('./routes/gameRoutes');
const { createAiRouter } = require('./routes/aiRoutes');

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/match/ws' });
const matchService = new MatchService({ pool, WebSocketClass: WebSocket });
const unitService = createUnitService(pool);
const { authenticate, isAdmin, verifyMatchToken } = createAuthMiddleware(jwt, JWT_SECRET);

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/res', express.static(path.join(__dirname, '../res')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.use('/api/auth', createAuthRouter({ bcrypt, jwt, jwtSecret: JWT_SECRET, pool }));
app.use('/api/units', createUnitRouter({ authenticate, isAdmin, pool }));
app.use('/api/admin/units', createAdminUnitRouter({ authenticate, isAdmin, pool }));
app.use('/api/user', createUserRouter({ authenticate, pool, unitService }));
app.use('/api/session', createSessionRouter({ authenticate, pool }));
app.use('/api/match', createMatchRouter({ authenticate, matchService, unitService, verifyMatchToken }));
app.use('/api/game', createGameRouter({ authenticate, pool }));
app.use('/api/ai', createAiRouter({ authenticate, pool }));

wss.on('connection', (socket, req) => {
    matchService.handleSocketConnection(socket, req, verifyMatchToken);
});

unitService.ensureGameUnits()
    .then(unitService.ensureLoadoutTables)
    .catch(err => console.error('[Unit Migration] Unable to ensure game units/loadouts:', err.message))
    .finally(() => {
        server.listen(PORT, () => {
            console.log(`Age of Agents Secured Server running at http://localhost:${PORT}`);
        });
    });
