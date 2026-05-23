const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const path = require('path');
const pool = require('./db');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const MATCH_START_DELAY_MS = 3000;
const MATCH_TTL_MS = 1000 * 60 * 60;
const MATCH_FPS = 60;
const MATCH_ACTION_DELAY_FRAMES = 36;
const waitingMatches = [];
const matches = new Map();
const ADMIN_UNIT_FIELDS = new Set([
    'hp', 'mana', 'dmg', 'atk_speed', 'range', 'move_speed', 'armor', 'mres',
    'crit_chance', 'phys_pen', 'magic_pen', 'dodge', 'lifesteal', 'cost'
]);
const ICEMAN_UNIT = {
    name: 'Iceman',
    icon: '❄️',
    hp: 100,
    mana: 90,
    move_speed: 1.2,
    range: 130,
    dmg: 12,
    atk_speed: 1.1,
    cost: 60,
    special: 'Summon Frost: Freeze 3 nearest enemies and deal 20 true damage; passive freezes adjacent units below 50% HP',
    role: 'Control Mage',
    dmg_type: 'magic',
    crit_chance: 0,
    armor: 10,
    mres: 20,
    phys_pen: 0,
    magic_pen: 0.10,
    dodge: 0.1,
    lifesteal: 0
};
const CHILYGIRL_UNIT = {
    name: 'ChilyGirl',
    icon: '🌶️',
    hp: 85,
    mana: 100,
    move_speed: 1.15,
    range: 25,
    dmg: 10,
    atk_speed: 2.5,
    cost: 70,
    special: 'Immortal Body: Cannot lose HP for 3s, x2 attack speed, attacks deal +5 true damage; first time below 50% HP enters Protection for 3s reducing damage by 80%, then punches forward for 10x damage',
    role: 'Melee Bruiser',
    dmg_type: 'physical',
    crit_chance: 0,
    armor: 50,
    mres: 50,
    phys_pen: 0,
    magic_pen: 0,
    dodge: 0.1,
    lifesteal: 0
};

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));
app.use('/res', express.static(path.join(__dirname, '../res')));

// Explicitly serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Middleware for authentication
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user?.role !== 0) return res.status(403).json({ message: 'Forbidden: Admin only' });
    next();
};

function makeMatchId() {
    return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendMatchEvent(match, event, payload) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    match.clients.forEach(client => client.write(data));
}

function getMatchFrame(match) {
    if (!match.startsAt) return 0;
    return Math.max(0, Math.floor((Date.now() - match.startsAt) / 1000 * MATCH_FPS));
}

function getConfirmedFrame(match) {
    return Math.max(0, getMatchFrame(match) - MATCH_ACTION_DELAY_FRAMES);
}

function sendMatchEventToPlayer(match, userId, event, payload) {
    const client = match.clients.get(userId);
    if (!client) return;
    client.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
}

function getMatchPayload(match, userId) {
    return {
        matchId: match.id,
        playerIndex: match.players.findIndex(player => player.id === userId),
        players: match.players.map(player => ({ id: player.id, username: player.username })),
        seed: match.seed,
        startsAt: match.startsAt,
        serverNow: Date.now(),
        confirmedFrame: getConfirmedFrame(match),
        units: match.units || null
    };
}

async function getUnitSnapshot() {
    try {
        const [units] = await pool.query('SELECT * FROM units ORDER BY id ASC');
        return units;
    } catch (err) {
        console.warn('[Match] Unable to capture unit snapshot:', err.message);
        return null;
    }
}

function removeMatch(matchId) {
    const match = matches.get(matchId);
    if (!match) return;
    match.clients.forEach(client => client.end());
    matches.delete(matchId);
    const waitingIdx = waitingMatches.findIndex(id => id === matchId);
    if (waitingIdx >= 0) waitingMatches.splice(waitingIdx, 1);
}

setInterval(() => {
    const now = Date.now();
    matches.forEach(match => {
        if (now - match.createdAt > MATCH_TTL_MS) removeMatch(match.id);
    });
}, 1000 * 60 * 10).unref?.();

const PROVIDERS = {
    deepseek: {
        url: 'https://api.deepseek.com/v1/chat/completions',
        key: process.env.DEEPSEEK_API_KEY
    },
    openai: {
        url: 'https://api.openai.com/v1/chat/completions',
        key: process.env.OPENAI_API_KEY
    }
};

async function upsertUnit(unit) {
    const fields = [
        'name', 'icon', 'hp', 'mana', 'move_speed', 'range', 'dmg', 'atk_speed',
        'cost', 'special', 'role', 'dmg_type', 'crit_chance', 'armor', 'mres',
        'phys_pen', 'magic_pen', 'dodge', 'lifesteal'
    ];
    const values = fields.map(field => unit[field]);
    const updates = fields
        .filter(field => field !== 'name')
        .map(field => `\`${field}\` = VALUES(\`${field}\`)`)
        .join(', ');

    await pool.query(
        `INSERT INTO units (${fields.map(field => `\`${field}\``).join(', ')}) VALUES (${fields.map(() => '?').join(', ')}) ON DUPLICATE KEY UPDATE ${updates}`,
        values
    );
}

async function ensureGameUnits() {
    await upsertUnit(ICEMAN_UNIT);
    await upsertUnit(CHILYGIRL_UNIT);
    await pool.query('DELETE FROM units WHERE name = ?', ['Hunter']);
}

// --- Auth Routes ---
app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
        return res.status(400).json({ message: 'Username must be 3-24 letters, numbers, or underscores' });
    }
    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        // Default role is 4 as per DB schema
        const [result] = await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
        res.status(201).json({ message: 'User registered', userId: result.insertId });
    } catch (err) {
        res.status(400).json({ message: 'Username already exists' });
    }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = users[0];
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, username: user.username, gold: user.gold, wins: user.wins, losses: user.losses, role: user.role } });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
}));

// --- Unit Routes ---
app.get('/api/units', asyncHandler(async (req, res) => {
    const [units] = await pool.query('SELECT * FROM units');
    res.json(units);
}));

app.post('/api/admin/units/update', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { id, stats } = req.body;
    const safeEntries = Object.entries(stats || {})
        .filter(([key, value]) => ADMIN_UNIT_FIELDS.has(key) && Number.isFinite(Number(value)));

    if (!Number.isInteger(Number(id)) || safeEntries.length === 0) {
        return res.status(400).json({ message: 'Invalid unit update payload' });
    }

    const fields = safeEntries.map(([key]) => `\`${key}\` = ?`).join(', ');
    const values = [...safeEntries.map(([, value]) => Number(value)), Number(id)];
    await pool.query(`UPDATE units SET ${fields} WHERE id = ?`, values);
    res.json({ message: 'Unit updated' });
}));

// --- User Routes ---
app.get('/api/user/profile', authenticate, asyncHandler(async (req, res) => {
    const [users] = await pool.query('SELECT id, username, gold, wins, losses, role FROM users WHERE id = ?', [req.user.id]);
    res.json(users[0]);
}));

// --- Session Routes ---
app.post('/api/session/save', authenticate, asyncHandler(async (req, res) => {
    const { state } = req.body;
    // Check if active session exists
    const [existing] = await pool.query('SELECT id FROM game_sessions WHERE user_id = ? AND is_active = 1', [req.user.id]);
    if (existing.length > 0) {
        await pool.query('UPDATE game_sessions SET state_json = ? WHERE id = ?', [JSON.stringify(state), existing[0].id]);
    } else {
        await pool.query('INSERT INTO game_sessions (user_id, state_json) VALUES (?, ?)', [req.user.id, JSON.stringify(state)]);
    }
    res.json({ message: 'Session saved' });
}));

app.get('/api/session/active', authenticate, asyncHandler(async (req, res) => {
    const [sessions] = await pool.query('SELECT state_json FROM game_sessions WHERE user_id = ? AND is_active = 1', [req.user.id]);
    if (sessions.length > 0) {
        const rawState = sessions[0].state_json;
        const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
        res.json({ hasActive: true, state });
    } else {
        res.json({ hasActive: false });
    }
}));

app.post('/api/session/clear', authenticate, asyncHandler(async (req, res) => {
    await pool.query('UPDATE game_sessions SET is_active = 0 WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'Session cleared' });
}));

// --- Online Match Routes ---
app.post('/api/match/join', authenticate, asyncHandler(async (req, res) => {
    const user = { id: req.user.id, username: req.user.username };

    for (const match of matches.values()) {
        if (!match.ended && match.players.some(player => player.id === user.id)) {
            return res.json({ status: match.started ? 'started' : 'waiting', ...getMatchPayload(match, user.id) });
        }
    }

    const waitingId = waitingMatches.shift();
    const waitingMatch = waitingId ? matches.get(waitingId) : null;
    if (waitingMatch && waitingMatch.players.length === 1 && waitingMatch.players[0].id !== user.id) {
        waitingMatch.players.push(user);
        waitingMatch.started = true;
        waitingMatch.startsAt = Date.now() + MATCH_START_DELAY_MS;
        sendMatchEvent(waitingMatch, 'match-start', { ...getMatchPayload(waitingMatch, waitingMatch.players[0].id), playerIndex: 0 });
        res.json({ status: 'started', ...getMatchPayload(waitingMatch, user.id) });
        return;
    }

    const match = {
        id: makeMatchId(),
        players: [user],
        clients: new Map(),
        seed: Math.floor(Math.random() * 0xffffffff),
        units: await getUnitSnapshot(),
        startsAt: null,
        started: false,
        ended: false,
        createdAt: Date.now(),
        nextActionId: 1,
        lastActionFrame: 0,
        actionLog: [],
        stateSeq: 0,
        stateSnapshot: null,
        stateLog: [],
        eventHistory: []
    };
    matches.set(match.id, match);
    waitingMatches.push(match.id);
    res.json({ status: 'waiting', ...getMatchPayload(match, user.id) });
}));

app.get('/api/match/stream', (req, res) => {
    let decoded;
    try {
        decoded = jwt.verify(String(req.query.token || ''), JWT_SECRET);
    } catch (err) {
        return res.status(401).end();
    }

    const match = matches.get(String(req.query.matchId || ''));
    if (!match || !match.players.some(player => player.id === decoded.id)) {
        return res.status(404).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    match.clients.set(decoded.id, res);

    if (match.started) {
        res.write(`event: match-start\ndata: ${JSON.stringify(getMatchPayload(match, decoded.id))}\n\n`);
        (match.actionLog || []).forEach(action => {
            res.write(`event: match-action\ndata: ${JSON.stringify(action)}\n\n`);
        });
        if (match.stateSnapshot) {
            res.write(`event: match-state\ndata: ${JSON.stringify(match.stateSnapshot)}\n\n`);
        }
    }

    const syncTimer = setInterval(() => {
        if (res.destroyed || match.ended) {
            clearInterval(syncTimer);
            return;
        }
        res.write(`event: match-sync\ndata: ${JSON.stringify({
            serverNow: Date.now(),
            serverFrame: getMatchFrame(match),
            confirmedFrame: getConfirmedFrame(match),
            lastActionId: Number(match.nextActionId || 1) - 1,
            actions: (match.actionLog || []).slice(-50)
        })}\n\n`);
    }, 250);

    req.on('close', () => {
        clearInterval(syncTimer);
        if (match.clients.get(decoded.id) === res) match.clients.delete(decoded.id);
        sendMatchEvent(match, 'player-disconnected', { userId: decoded.id });
    });
});

app.post('/api/match/action', authenticate, (req, res) => {
    const match = matches.get(String(req.body.matchId || ''));
    if (!match || !match.started || match.ended) {
        return res.status(404).json({ message: 'Match not found' });
    }

    const playerIndex = match.players.findIndex(player => player.id === req.user.id);
    if (playerIndex < 0) return res.status(403).json({ message: 'Not in this match' });

    const type = String(req.body.type || '');
    const unitType = String(req.body.unitType || '');
    if (type !== 'buy' || !/^[a-zA-Z0-9 _-]{1,40}$/.test(unitType)) {
        return res.status(400).json({ message: 'Invalid match action' });
    }

    const serverFrame = getMatchFrame(match);
    const actionFrame = Math.max(
        serverFrame + MATCH_ACTION_DELAY_FRAMES,
        Number(match.lastActionFrame || 0) + 1
    );
    match.lastActionFrame = actionFrame;
    const actionId = Number(match.nextActionId || 1);
    const payload = {
        actionId,
        action: 'buy',
        playerIndex,
        unitType,
        actionFrame,
        serverFrame,
        sentAt: Date.now()
    };
    match.nextActionId = actionId + 1;
    match.actionLog = [...(match.actionLog || []), payload].slice(-200);
    sendMatchEvent(match, 'match-action', payload);
    res.json({ ok: true });
});

app.post('/api/match/state', authenticate, (req, res) => {
    const match = matches.get(String(req.body.matchId || ''));
    if (!match || !match.started || match.ended) {
        return res.status(404).json({ message: 'Match not found' });
    }

    const playerIndex = match.players.findIndex(player => player.id === req.user.id);
    if (playerIndex !== 0) {
        return res.status(403).json({ message: 'Only the authoritative simulator can publish state' });
    }

    const seq = Number(req.body.seq || 0);
    const frame = Number(req.body.frame || 0);
    const state = req.body.state;
    const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 200) : [];
    if (!Number.isFinite(seq) || !Number.isFinite(frame) || !state || typeof state !== 'object') {
        return res.status(400).json({ message: 'Invalid match state' });
    }
    if (seq <= Number(match.stateSeq || 0)) {
        return res.json({ ok: true, ignored: true });
    }

    const realtimeEvents = events.filter(event => event?.type !== 'damage').slice(-50);
    const payload = {
        seq,
        frame,
        serverNow: Date.now(),
        state,
        events: realtimeEvents
    };
    match.stateSeq = seq;
    match.stateSnapshot = payload;
    match.stateLog = [...(match.stateLog || []), payload].slice(-240);
    if (events.length) {
        match.eventHistory = [...(match.eventHistory || []), ...events.map(event => ({
            ...event,
            serverSeq: seq,
            serverFrame: frame,
            serverAt: payload.serverNow
        }))];
    }
    match.players.forEach((player, idx) => {
        if (idx !== 0) sendMatchEventToPlayer(match, player.id, 'match-state', payload);
    });
    res.json({ ok: true });
});

app.post('/api/match/leave', authenticate, (req, res) => {
    const match = matches.get(String(req.body.matchId || ''));
    if (match && match.players.some(player => player.id === req.user.id)) {
        match.ended = true;
        sendMatchEvent(match, 'match-ended', { reason: 'left', userId: req.user.id });
        setTimeout(() => removeMatch(match.id), 1000);
    }
    res.json({ ok: true });
});

// --- Game Routes ---
app.post('/api/game/end', authenticate, asyncHandler(async (req, res) => {
    const { winnerId, duration, result } = req.body; // result: 'win' or 'loss'
    await pool.query('INSERT INTO games (winner_id, duration) VALUES (?, ?)', [winnerId, duration]);
    
    if (result === 'win') {
        await pool.query('UPDATE users SET wins = wins + 1, gold = gold + 100 WHERE id = ?', [req.user.id]);
    } else {
        await pool.query('UPDATE users SET losses = losses + 1, gold = gold + 20 WHERE id = ?', [req.user.id]);
    }
    
    res.json({ message: 'Game result saved' });
}));

// --- AI Strategy Route ---
app.post('/api/ai/strategy', authenticate, asyncHandler(async (req, res) => {
    const { player, gameState, config } = req.body;
    
    const providerName = config?.provider || 'deepseek';
    const provider = PROVIDERS[providerName] || PROVIDERS.deepseek;
    const apiKey = provider.key;
    const model = config?.model || (providerName === 'openai' ? 'o4-mini' : 'deepseek-v4-flash');

    // Fetch units from DB to provide to AI
    const [dbUnits] = await pool.query('SELECT name, cost, role, hp, move_speed, atk_speed, special FROM units');
    const unitMarket = dbUnits.reduce((acc, unit) => {
        acc[unit.name] = { 
            cost: unit.cost, 
            role: unit.role, 
            hp: unit.hp, 
            move_speed: unit.move_speed,
            atk_speed: unit.atk_speed,
            special: unit.special 
        };
        return acc;
    }, {});

    if (!apiKey || apiKey.includes('your_')) {
        const affordableUnits = dbUnits.filter(u => u.cost <= player.gold).map(u => u.name);
        const decision = affordableUnits.length ? affordableUnits[Math.floor(Math.random() * affordableUnits.length)] : 'save';
        return res.json({ decision });
    }

    const prompt = `
    You are the High Commander for "${player.name}" in a Real-Time Strategy game.
    
    YOUR STATUS:
    - Gold: ${player.gold}
    - Base HP: ${player.hp}/${player.maxHp}
    - Base Position: (x: ${player.basePos?.x}, y: ${player.basePos?.y})
    - Current Army: ${player.units.length > 0 ? player.units.join(', ') : 'None'}

    ENEMY STATUS:
    ${gameState.enemies.map(e => `- ${e.name}: Base HP ${e.hp}, Position (x: ${e.basePos?.x}, y: ${e.basePos?.y})`).join('\n')}

    UNIT MARKET (Detailed Intel):
    ${JSON.stringify(unitMarket, null, 2)}

    STRATEGY GOAL: 
    1. Build a balanced army (Tanks, DPS, Support).
    2. Counter the enemy's current status and positions.
    3. Save gold if necessary for expensive high-tier units.
    
    Decide which unit to deploy or "save" gold.
    Respond ONLY with a JSON object: {"decision": "UnitName"} or {"decision": "save"}.
  `;

    try {
        console.log(`[AI Request] Provider: ${providerName}, Model: ${model}`);
        
        const body = {
            model: model,
            messages: [
                { role: 'system', content: 'You are a strategic RTS commander. Respond only with JSON.' },
                { role: 'user', content: prompt }
            ]
        };

        if (model.startsWith('o')) {
            body.max_completion_tokens = 100;
        } else {
            body.max_tokens = 100;
            body.temperature = 0.6;
        }

        const response = await fetch(provider.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`
            },
            body: JSON.stringify(body)
        });

        const data = await response.json();
        if (data.error) {
            console.error(`[AI Error] ${providerName} API Error:`, data.error);
            throw new Error(data.error.message);
        }
        
        let raw = data.choices[0].message.content.trim();
        raw = raw.replace(/```json/g, '').replace(/```/g, '').trim();
        console.log(`[AI Response] Success from ${providerName}`);
        res.json(JSON.parse(raw));
    } catch (error) {
        console.error(`[AI Fallback] Reason: ${error.message}`);
        const affordableUnits = dbUnits.filter(u => u.cost <= player.gold).map(u => u.name);
        res.json({ decision: affordableUnits.length ? affordableUnits[0] : 'save' });
    }
}));

ensureGameUnits()
    .catch(err => console.error('[Unit Migration] Unable to ensure game units:', err.message))
    .finally(() => {
        app.listen(PORT, () => {
            console.log(`Age of Agents Secured Server running at http://localhost:${PORT}`);
        });
    });
