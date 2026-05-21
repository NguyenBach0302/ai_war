const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const pool = require('./db');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secret';

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

// --- Auth Routes ---
app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
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
        const token = jwt.sign({ id: user.id, username: user.username }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, username: user.username, gold: user.gold, wins: user.wins, losses: user.losses } });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
}));

// --- Unit Routes ---
app.get('/api/units', asyncHandler(async (req, res) => {
    const [units] = await pool.query('SELECT * FROM units');
    // Format to match the client-side expectations if necessary, or just send as is
    res.json(units);
}));

// --- User Routes ---
app.get('/api/user/profile', authenticate, asyncHandler(async (req, res) => {
    const [users] = await pool.query('SELECT id, username, gold, wins, losses FROM users WHERE id = ?', [req.user.id]);
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
        res.json({ hasActive: true, state: JSON.parse(sessions[0].state_json) });
    } else {
        res.json({ hasActive: false });
    }
}));

app.post('/api/session/clear', authenticate, asyncHandler(async (req, res) => {
    await pool.query('UPDATE game_sessions SET is_active = 0 WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'Session cleared' });
}));

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
app.post('/api/ai/strategy', asyncHandler(async (req, res) => {
    const { player, gameState, config } = req.body;
    
    const providerName = config?.provider || 'deepseek';
    const provider = PROVIDERS[providerName] || PROVIDERS.deepseek;
    const apiKey = provider.key;
    const model = config?.model || (providerName === 'openai' ? 'o4-mini' : 'deepseek-v4-flash');

    // Fetch units from DB to provide to AI
    const [dbUnits] = await pool.query('SELECT name, cost, role, hp, special FROM units');
    const unitMarket = dbUnits.reduce((acc, unit) => {
        acc[unit.name] = { cost: unit.cost, role: unit.role, hp: unit.hp, special: unit.special };
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

app.listen(PORT, () => {
    console.log(`Age of Agents Secured Server running at http://localhost:${PORT}`);
});
