const {
    CHILYGIRL_UNIT,
    DEFAULT_LOADOUTS,
    ICEMAN_UNIT,
    LOADOUT_UNIT_ALIASES
} = require('../config/constants');

function createUnitService(pool) {
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
        await pool.query('ALTER TABLE units MODIFY icon VARCHAR(64) NOT NULL');
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

    function normalizeLoadoutUnitNames(rawUnitNames, allowedNames) {
        const allowed = allowedNames instanceof Set ? allowedNames : new Set(allowedNames || []);
        return [...new Set((Array.isArray(rawUnitNames) ? rawUnitNames : [])
            .map(name => LOADOUT_UNIT_ALIASES.get(String(name)) || String(name))
            .filter(name => allowed.has(name)))].slice(0, 5);
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
        const ownedNames = new Set(ownedUnits.map(unit => unit.name));
        const [loadoutRows] = await pool.query('SELECT slot, name, unit_names, is_active FROM user_loadouts WHERE user_id = ? ORDER BY slot ASC', [userId]);
        const loadouts = loadoutRows.map(row => ({
            slot: Number(row.slot),
            name: row.name,
            unitNames: normalizeLoadoutUnitNames(typeof row.unit_names === 'string' ? JSON.parse(row.unit_names) : row.unit_names, ownedNames),
            isActive: !!row.is_active
        }));
        return { ...user, ownedUnits, loadouts, activeLoadoutSlot: loadouts.find(loadout => loadout.isActive)?.slot || 1 };
    }

    async function resolveUserLoadout(userId, requestedSlot) {
        await ensureUserArmory(userId);
        const [ownedRows] = await pool.query(`
            SELECT u.name
            FROM units u
            JOIN user_units uu ON uu.unit_id = u.id
            WHERE uu.user_id = ?
        `, [userId]);
        const ownedNames = new Set(ownedRows.map(row => row.name));
        const slot = [1, 2, 3].includes(Number(requestedSlot)) ? Number(requestedSlot) : null;
        const params = slot ? [userId, slot] : [userId];
        const query = slot
            ? 'SELECT slot, unit_names FROM user_loadouts WHERE user_id = ? AND slot = ?'
            : 'SELECT slot, unit_names FROM user_loadouts WHERE user_id = ? AND is_active = 1 ORDER BY slot ASC LIMIT 1';
        const [rows] = await pool.query(query, params);
        const row = rows[0];
        if (!row) return DEFAULT_LOADOUTS[0].unitNames;
        const unitNames = normalizeLoadoutUnitNames(typeof row.unit_names === 'string' ? JSON.parse(row.unit_names) : row.unit_names, ownedNames);
        return unitNames.length ? unitNames : DEFAULT_LOADOUTS[0].unitNames;
    }

    return {
        ensureGameUnits,
        ensureLoadoutTables,
        ensureUserArmory,
        getUserProfilePayload,
        normalizeLoadoutUnitNames,
        resolveUserLoadout
    };
}

module.exports = { createUnitService };
