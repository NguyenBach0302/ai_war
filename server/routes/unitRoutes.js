const express = require('express');
const asyncHandler = require('express-async-handler');
const { ADMIN_UNIT_FIELDS } = require('../config/constants');

function createUnitRouter({ authenticate, isAdmin, pool }) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        const [units] = await pool.query('SELECT * FROM units');
        res.json(units);
    }));

    return router;
}

function createAdminUnitRouter({ authenticate, isAdmin, pool }) {
    const router = express.Router();

    router.post('/update', authenticate, isAdmin, asyncHandler(async (req, res) => {
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

    return router;
}

module.exports = { createUnitRouter, createAdminUnitRouter };
