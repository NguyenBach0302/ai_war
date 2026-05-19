const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

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

const UNIT_COSTS = {
  Guard: 80, Assassin: 60, Mage: 75, Healer: 50, Bowman: 45, Gunman: 90, Hunter: 55
};

app.post('/api/ai/strategy', async (req, res) => {
  const { player, gameState, config } = req.body;
  
  const providerName = config?.provider || 'deepseek';
  const provider = PROVIDERS[providerName] || PROVIDERS.deepseek;
  const apiKey = provider.key;
  const model = config?.model || (providerName === 'openai' ? 'o4-mini' : 'deepseek-v4-flash');

  // Fallback if no key configured for the provider
  if (!apiKey || apiKey.includes('your_')) {
    const affordableUnits = Object.keys(UNIT_COSTS).filter(u => UNIT_COSTS[u] <= player.gold);
    const decision = affordableUnits.length ? affordableUnits[Math.floor(Math.random() * affordableUnits.length)] : 'save';
    return res.json({ decision });
  }

  const prompt = `
    You are the High Commander for "${player.name}" in a Real-Time Strategy game.
    Current Resources: ${player.gold} Gold.
    Base Health: ${player.hp}/${player.maxHp}.
    Your Current Army: ${player.units.length > 0 ? player.units.join(', ') : 'No units yet'}.
    
    UNIT MARKET (Unit: Cost):
    ${JSON.stringify(UNIT_COSTS)}

    ENEMY STATUS:
    ${JSON.stringify(gameState.enemies, null, 2)}

    STRATEGY GOAL: 
    1. Build a balanced army.
    2. Counter the enemy's units.
    
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

    // Handle o-series specific parameter
    if (model.startsWith('o')) {
      body.max_completion_tokens = 100;
      // o-models typically use a fixed temperature or don't support the parameter
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
    const affordableUnits = Object.keys(UNIT_COSTS).filter(u => UNIT_COSTS[u] <= player.gold);
    res.json({ decision: affordableUnits.length ? affordableUnits[0] : 'save' });
  }
});

app.listen(PORT, () => {
  console.log(`Age of Agents Secured Server running at http://localhost:${PORT}`);
});
