CREATE DATABASE IF NOT EXISTS ai_war;
USE ai_war;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    gold INT DEFAULT 150,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    icon VARCHAR(10) NOT NULL,
    hp INT NOT NULL,
    mana INT NOT NULL,
    speed FLOAT NOT NULL,
    `range` INT NOT NULL,
    dmg INT NOT NULL,
    cd INT NOT NULL,
    cost INT NOT NULL,
    special TEXT,
    role VARCHAR(50),
    dmg_type VARCHAR(20) DEFAULT 'physical'
);

CREATE TABLE IF NOT EXISTS games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    winner_id INT,
    duration INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (winner_id) REFERENCES users(id)
);

-- Clear any legacy roster so only the new classes remain
DELETE FROM units;

-- Seed units table with the NEW class roster (mirrors CLASS_DATA in public/game.js).
-- cost == shop tier. mana == ability cost. dmg_type drives mitigation.
INSERT IGNORE INTO units (name, icon, hp, mana, speed, `range`, dmg, cd, cost, special, role, dmg_type) VALUES
('Footman',    '🛡️', 150, 50,  1.2, 26,  16, 36, 1, 'Shield Bash: stun and knock back the front line.',          'Bruiser',  'physical'),
('Archer',     '🏹', 90,  45,  1.2, 165, 14, 30, 1, 'Multishot: a volley of piercing arrows.',                  'Ranger',   'physical'),
('Pyromancer', '🔥', 80,  55,  0.9, 145, 18, 42, 1, 'Flameburst: AoE blast that ignites the ground.',           'Mage',     'magic'),
('Acolyte',    '✨', 95,  40,  1.0, 130, 8,  40, 1, 'Mend: heal the lowest ally and grant a shield.',           'Healer',   'magic'),
('Knight',     '⚔️', 240, 60,  1.0, 28,  18, 40, 2, 'Guardian: huge shield and taunt nearby enemies.',          'Tank',     'physical'),
('Rogue',      '🗡️', 95,  45,  1.9, 22,  30, 26, 2, 'Shadowstrike: blink to the backline for a lethal crit.',   'Assassin', 'physical'),
('Frostmage',  '❄️', 90,  55,  0.9, 140, 16, 44, 2, 'Frost Nova: chill and freeze a cluster of foes.',          'Control',  'magic'),
('Druid',      '🐺', 130, 60,  1.0, 110, 18, 40, 2, 'Wild Call: summon a wolf to fight beside you.',            'Summoner', 'magic'),
('Berserker',  '🪓', 170, 50,  1.5, 24,  34, 30, 3, 'Bloodrage: frenzied attack speed and lifesteal.',          'Burst',    'physical'),
('Stormcaller','⚡', 95,  65,  0.9, 150, 22, 46, 3, 'Chain Lightning: arcs between several enemies.',           'AreaDPS',  'magic'),
('Paladin',    '🌟', 220, 65,  1.0, 30,  22, 40, 3, 'Aegis: shield all allies and smite a foe.',                'Support',  'magic'),
('Warlock',    '☠️', 110, 60,  0.9, 140, 18, 44, 3, 'Curse: spreading poison that shreds armor.',               'Control',  'magic'),
('Dragoon',    '🐉', 180, 55,  1.4, 26,  40, 34, 4, 'Leap Strike: dive the backline with a fiery crash.',       'Mobility', 'physical'),
('Necromancer','💀', 130, 70,  0.9, 135, 22, 44, 4, 'Raise Dead: a shadow nova that summons skeletons.',        'Summoner', 'magic'),
('Valkyrie',   '👼', 150, 60,  1.1, 125, 26, 38, 4, 'Divine Volley: heal allies while smiting enemies.',        'Hybrid',   'magic'),
('Archmage',   '🌀', 130, 80,  0.8, 160, 30, 50, 5, 'Meteor: a telegraphed cataclysm of arcane fire.',          'AreaDPS',  'true');
