const ADMIN_UNIT_FIELDS = new Set([
    'hp', 'mana', 'dmg', 'atk_speed', 'range', 'move_speed', 'armor', 'mres',
    'crit_chance', 'phys_pen', 'magic_pen', 'dodge', 'lifesteal', 'cost'
]);

const DEFAULT_LOADOUTS = [
    { slot: 1, name: 'Vanguard', unitNames: ['Guard', 'Bowman', 'Mage', 'Healer', 'Gunman'] },
    { slot: 2, name: 'Strike Team', unitNames: ['Assassin', 'Bowman', 'Gunman', 'Iceman', 'ChilyGirl'] },
    { slot: 3, name: 'Control Line', unitNames: ['Guard', 'Mage', 'Healer', 'Iceman', 'ChilyGirl'] }
];

const LOADOUT_UNIT_ALIASES = new Map([
    ['Hunter', 'Iceman'],
    ['Gunner', 'Gunman']
]);

const ICEMAN_UNIT = {
    name: 'Iceman',
    icon: 'ICE',
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
    icon: 'CHILI',
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

module.exports = {
    ADMIN_UNIT_FIELDS,
    DEFAULT_LOADOUTS,
    LOADOUT_UNIT_ALIASES,
    ICEMAN_UNIT,
    CHILYGIRL_UNIT,
    PROVIDERS
};
