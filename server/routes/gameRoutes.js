const express = require('express');
const asyncHandler = require('express-async-handler');

function createGameRouter({ authenticate, pool }) {
    const router = express.Router();

    router.post('/end', authenticate, asyncHandler(async (req, res) => {
        const { winnerId, duration, result } = req.body;
        await pool.query('INSERT INTO games (winner_id, duration) VALUES (?, ?)', [winnerId, duration]);

        if (result === 'win') {
            await pool.query('UPDATE users SET wins = wins + 1, gold = gold + 100 WHERE id = ?', [req.user.id]);
        } else {
            await pool.query('UPDATE users SET losses = losses + 1, gold = gold + 20 WHERE id = ?', [req.user.id]);
        }

        res.json({ message: 'Game result saved' });
    }));

    return router;
}

module.exports = { createGameRouter };
