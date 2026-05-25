const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const pool = require('./db');
const { MatchService } = require('./match/MatchService');

const fetch = (...args) => import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/match/ws' });
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const matchService = new MatchService({ pool, WebSocketClass: WebSocket });
const ADMIN_UNIT_FIELDS = new Set([
    'hp', 'mana', 'dmg', 'atk_speed', 'range', 'move_speed', 'armor', 'mres',
    'crit_chance', 'phys_pen', 'magic_pen', 'dodge', 'lifesteal', 'cost'
]);
const DEFAULT_LOADOUTS = [
    { slot: 1, name: 'Vanguard', unitNames: ['Guard', 'Bowman', 'Mage', 'Healer', 'Gunman'] },
    { slot: 2, name: 'Strike Team', unitNames: ['Assassin', 'Bowman', 'Gunman', 'Iceman', 'ChilyGirl'] },
    { slot: 3, name: 'Control Line', unitNames: ['Guard', 'Mage', 'Healer', 'Iceman', 'ChilyGirl'] }
];

const ICEMAN_UNIT = {
    name: 'Iceman',
    icon: 'â„ï¸',
    hp: 100,
    mana: 90,
    move_speed: 1.2,
    range: 130,
    dmg: 12,
    atk_speed: 1.1,
    cost: 60,
    special: 'Summon Frost: Costs 60% mana to freeze 3 nearest enemies within 200px for 2s; frozen units cannot attack or move',
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
    icon: 'ðŸŒ¶ï¸',
    hp: 85,
    mana: 100,
    move_speed: 1.15,
    range: 25,
    dmg: 10,
    atk_speed: 2.5,
    cost: 70,
    special: 'Chili Shield: Cannot take damage for 3s, gains x3 attack speed, and cannot regenerate mana during the effect; first time below 50% HP enters Protection for 3s reducing damage by 80%, then punches forward for 10x damage',
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

app.use(cors());
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '../public')));
app.use('/res', express.static(path.join(__dirname, '../res')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try {
        req.user = jwt.verify(token, JWT_SECRET);
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user?.role !== 0) return res.status(403).json({ message: 'Forbidden: Admin only' });
    next();
};

const verifyMatchToken = token => jwt.verify(token, JWT_SECRET);

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

async function ensureLoadoutTables() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_units (
            user_id INT NOT NULL,
            unit_id INT NOT NULL,
            acquisition_source VARCHAR(30) DEFAULT 'base_free',
            acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, unit_id),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
            FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_loadouts (
            user_id INT NOT NULL,
            slot TINYINT NOT NULL,
            name VARCHAR(50) NOT NULL,
            unit_names JSON NOT NULL,
            is_active TINYINT(1) DEFAULT 0,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            PRIMARY KEY (user_id, slot),
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);
}

async function ensureUserArmory(userId) {
    await pool.query(`
        INSERT IGNORE INTO user_units (user_id, unit_id, acquisition_source)
        SELECT ?, id, 'base_free' FROM units
    `, [userId]);

    const [existing] = await pool.query('SELECT slot FROM user_loadouts WHERE user_id = ?', [userId]);
    const existingSlots = new Set(existing.map(row => Number(row.slot)));
    for (const loadout of DEFAULT_LOADOUTS) {
        if (existingSlots.has(loadout.slot)) continue;
        await pool.query(
            'INSERT INTO user_loadouts (user_id, slot, name, unit_names, is_active) VALUES (?, ?, ?, ?, ?)',
            [userId, loadout.slot, loadout.name, JSON.stringify(loadout.unitNames), loadout.slot === 1 ? 1 : 0]
        );
    }
}

async function getUserProfilePayload(userId) {
    await ensureUserArmory(userId);
    const [[user]] = await pool.query('SELECT id, username, gold, wins, losses, role FROM users WHERE id = ?', [userId]);
    const [ownedUnits] = await pool.query(`
        SELECT u.*, uu.acquisition_source
        FROM units u
        JOIN user_units uu ON uu.unit_id = u.id
        WHERE uu.user_id = ?
        ORDER BY u.id ASC
    `, [userId]);
    const [loadoutRows] = await pool.query('SELECT slot, name, unit_names, is_active FROM user_loadouts WHERE user_id = ? ORDER BY slot ASC', [userId]);
    const loadouts = loadoutRows.map(row => ({
        slot: Number(row.slot),
        name: row.name,
        unitNames: typeof row.unit_names === 'string' ? JSON.parse(row.unit_names) : row.unit_names,
        isActive: !!row.is_active
    }));
    return { ...user, ownedUnits, loadouts, activeLoadoutSlot: loadouts.find(loadout => loadout.isActive)?.slot || 1 };
}

async function resolveUserLoadout(userId, requestedSlot) {
    await ensureUserArmory(userId);
    const slot = [1, 2, 3].includes(Number(requestedSlot)) ? Number(requestedSlot) : null;
    const params = slot ? [userId, slot] : [userId];
    const query = slot
        ? 'SELECT slot, unit_names FROM user_loadouts WHERE user_id = ? AND slot = ?'
        : 'SELECT slot, unit_names FROM user_loadouts WHERE user_id = ? AND is_active = 1 ORDER BY slot ASC LIMIT 1';
    const [rows] = await pool.query(query, params);
    const row = rows[0];
    if (!row) return DEFAULT_LOADOUTS[0].unitNames;
    const unitNames = typeof row.unit_names === 'string' ? JSON.parse(row.unit_names) : row.unit_names;
    return Array.isArray(unitNames) ? unitNames.slice(0, 5) : DEFAULT_LOADOUTS[0].unitNames;
}

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

app.get('/api/user/profile', authenticate, asyncHandler(async (req, res) => {
    res.json(await getUserProfilePayload(req.user.id));
}));

app.post('/api/user/loadouts', authenticate, asyncHandler(async (req, res) => {
    await ensureUserArmory(req.user.id);
    const [ownedRows] = await pool.query(`
        SELECT u.name
        FROM units u
        JOIN user_units uu ON uu.unit_id = u.id
        WHERE uu.user_id = ?
    `, [req.user.id]);
    const ownedNames = new Set(ownedRows.map(row => row.name));
    const loadouts = Array.isArray(req.body.loadouts) ? req.body.loadouts : [];
    const activeLoadoutSlot = [1, 2, 3].includes(Number(req.body.activeLoadoutSlot)) ? Number(req.body.activeLoadoutSlot) : 1;

    for (const rawLoadout of loadouts) {
        const slot = Number(rawLoadout.slot);
        if (![1, 2, 3].includes(slot)) {
            return res.status(400).json({ message: 'Invalid loadout slot' });
        }
        const unitNames = [...new Set((Array.isArray(rawLoadout.unitNames) ? rawLoadout.unitNames : []).map(name => String(name)))];
        if (unitNames.length < 1 || unitNames.length > 5 || unitNames.some(name => !ownedNames.has(name))) {
            return res.status(400).json({ message: 'Each loadout must contain 1-5 owned units' });
        }
        const name = String(rawLoadout.name || `Loadout ${slot}`).trim().slice(0, 50) || `Loadout ${slot}`;
        await pool.query(
            `INSERT INTO user_loadouts (user_id, slot, name, unit_names, is_active)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE name = VALUES(name), unit_names = VALUES(unit_names), is_active = VALUES(is_active)`,
            [req.user.id, slot, name, JSON.stringify(unitNames), slot === activeLoadoutSlot ? 1 : 0]
        );
    }
    await pool.query('UPDATE user_loadouts SET is_active = IF(slot = ?, 1, 0) WHERE user_id = ?', [activeLoadoutSlot, req.user.id]);
    res.json(await getUserProfilePayload(req.user.id));
}));

app.post('/api/session/save', authenticate, asyncHandler(async (req, res) => {
    const { state } = req.body;
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

app.post('/api/match/join', authenticate, asyncHandler(async (req, res) => {
    const loadoutUnitNames = await resolveUserLoadout(req.user.id, req.body?.loadoutSlot);
    const payload = await matchService.joinMatch({
        id: req.user.id,
        username: req.user.username,
        loadoutSlot: [1, 2, 3].includes(Number(req.body?.loadoutSlot)) ? Number(req.body.loadoutSlot) : null,
        loadoutUnitNames
    });
    res.json(payload);
}));

app.get('/api/match/stream', (req, res) => {
    matchService.openStream(req, res, verifyMatchToken);
});

app.post('/api/match/action', authenticate, (req, res) => {
    const result = matchService.performAction(req.body.matchId, req.user.id, req.body);
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message || 'Unable to process action' });
    res.json(result);
});

app.post('/api/match/state', authenticate, (req, res) => {
    const result = matchService.publishState(req.body.matchId, req.user.id, req.body);
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message || 'Unable to process state' });
    res.json(result);
});

app.post('/api/match/ping', authenticate, (req, res) => {
    const result = matchService.pingMatch(req.body.matchId, req.user.id, req.body.clientSentAt);
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message || 'Unable to ping match' });
    res.json(result);
});

app.post('/api/match/leave', authenticate, (req, res) => {
    res.json(matchService.leaveMatch(req.body.matchId, req.user.id));
});

wss.on('connection', (socket, req) => {
    matchService.handleSocketConnection(socket, req, verifyMatchToken);
});

app.post('/api/game/end', authenticate, asyncHandler(async (req, res) => {
    const { winnerId, duration, result } = req.body;
    await pool.query('INSERT INTO games (winner_id, duration) VALUES (?, ?)', [winnerId, duration]);

    if (result === 'win') {
        await pool.query('UPDATE users SET wins = wins + 1, gold = gold + 100 WHERE id = ?', [req.user.id]);
    } else {
        await pool.query('UPDATE users SET losses = losses + 1, gold = gold + 20 WHERE id = ?', [req.user.id]);
    }

    res.json({ message: 'Game result saved' });
}));

app.post('/api/ai/strategy', authenticate, asyncHandler(async (req, res) => {
    const { player, gameState, config } = req.body;
    const providerName = config?.provider || 'deepseek';
    const provider = PROVIDERS[providerName] || PROVIDERS.deepseek;
    const apiKey = provider.key;
    const model = config?.model || (providerName === 'openai' ? 'o4-mini' : 'deepseek-v4-flash');

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
        const affordableUnits = dbUnits.filter(unit => unit.cost <= player.gold).map(unit => unit.name);
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
    ${gameState.enemies.map(enemy => `- ${enemy.name}: Base HP ${enemy.hp}, Position (x: ${enemy.basePos?.x}, y: ${enemy.basePos?.y})`).join('\n')}

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
            model,
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
        const affordableUnits = dbUnits.filter(unit => unit.cost <= player.gold).map(unit => unit.name);
        res.json({ decision: affordableUnits.length ? affordableUnits[0] : 'save' });
    }
}));

ensureGameUnits()
    .then(ensureLoadoutTables)
    .catch(err => console.error('[Unit Migration] Unable to ensure game units/loadouts:', err.message))
    .finally(() => {
        server.listen(PORT, () => {
            console.log(`Age of Agents Secured Server running at http://localhost:${PORT}`);
        });
    });
