const express = require('express');
const asyncHandler = require('express-async-handler');
const { PROVIDERS } = require('../config/constants');

const fetch = (...args) => import('node-fetch').then(({ default: fetchImpl }) => fetchImpl(...args));

function createAiRouter({ authenticate, pool }) {
    const router = express.Router();

    router.post('/strategy', authenticate, asyncHandler(async (req, res) => {
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

    return router;
}

module.exports = { createAiRouter };
