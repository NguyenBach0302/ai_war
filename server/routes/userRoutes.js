const express = require('express');
const asyncHandler = require('express-async-handler');

function createUserRouter({ authenticate, pool, unitService }) {
    const router = express.Router();

    router.get('/profile', authenticate, asyncHandler(async (req, res) => {
        res.json(await unitService.getUserProfilePayload(req.user.id));
    }));

    router.post('/loadouts', authenticate, asyncHandler(async (req, res) => {
        await unitService.ensureUserArmory(req.user.id);
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
            const unitNames = unitService.normalizeLoadoutUnitNames(rawLoadout.unitNames, ownedNames);
            if (unitNames.length < 1 || unitNames.length > 5) {
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
        res.json(await unitService.getUserProfilePayload(req.user.id));
    }));

    return router;
}

module.exports = { createUserRouter };
