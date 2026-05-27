const express = require('express');
const asyncHandler = require('express-async-handler');

function createSessionRouter({ authenticate, pool }) {
    const router = express.Router();

    router.post('/save', authenticate, asyncHandler(async (req, res) => {
        const { state } = req.body;
        const [existing] = await pool.query('SELECT id FROM game_sessions WHERE user_id = ? AND is_active = 1', [req.user.id]);
        if (existing.length > 0) {
            await pool.query('UPDATE game_sessions SET state_json = ? WHERE id = ?', [JSON.stringify(state), existing[0].id]);
        } else {
            await pool.query('INSERT INTO game_sessions (user_id, state_json) VALUES (?, ?)', [req.user.id, JSON.stringify(state)]);
        }
        res.json({ message: 'Session saved' });
    }));

    router.get('/active', authenticate, asyncHandler(async (req, res) => {
        const [sessions] = await pool.query('SELECT state_json FROM game_sessions WHERE user_id = ? AND is_active = 1', [req.user.id]);
        if (sessions.length > 0) {
            const rawState = sessions[0].state_json;
            const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
            res.json({ hasActive: true, state });
        } else {
            res.json({ hasActive: false });
        }
    }));

    router.post('/clear', authenticate, asyncHandler(async (req, res) => {
        await pool.query('UPDATE game_sessions SET is_active = 0 WHERE user_id = ?', [req.user.id]);
        res.json({ message: 'Session cleared' });
    }));

    return router;
}

module.exports = { createSessionRouter };
