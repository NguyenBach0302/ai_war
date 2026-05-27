const express = require('express');
const asyncHandler = require('express-async-handler');

function createAuthRouter({ bcrypt, jwt, jwtSecret, pool }) {
    const router = express.Router();

    router.post('/register', asyncHandler(async (req, res) => {
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

    router.post('/login', asyncHandler(async (req, res) => {
        const { username, password } = req.body;
        const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
        const user = users[0];
        if (user && await bcrypt.compare(password, user.password)) {
            const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, jwtSecret, { expiresIn: '24h' });
            res.json({ token, user: { id: user.id, username: user.username, gold: user.gold, wins: user.wins, losses: user.losses, role: user.role } });
        } else {
            res.status(401).json({ message: 'Invalid credentials' });
        }
    }));

    return router;
}

module.exports = { createAuthRouter };
