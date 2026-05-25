DROP DATABASE IF EXISTS ai_war;
CREATE DATABASE ai_war;
USE ai_war;

CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    gold INT DEFAULT 150,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    role INT DEFAULT 4, -- 0: Admin, 1-4: Other roles
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS units (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    icon VARCHAR(10) NOT NULL,
    hp INT NOT NULL,
    mana INT NOT NULL,
    move_speed FLOAT NOT NULL,
    `range` INT NOT NULL,
    dmg INT NOT NULL,
    atk_speed FLOAT NOT NULL, -- attacks per second
    cost INT NOT NULL,
    special TEXT,
    role VARCHAR(50),
    dmg_type VARCHAR(20) DEFAULT 'physical',
    -- NEW ADVANCED STATS
    crit_chance FLOAT DEFAULT 0,
    armor INT DEFAULT 0,
    mres INT DEFAULT 0,
    phys_pen FLOAT DEFAULT 0,
    magic_pen FLOAT DEFAULT 0,
    dodge FLOAT DEFAULT 0.1,
    lifesteal FLOAT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    winner_id INT,
    duration INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (winner_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS game_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    state_json JSON NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_sessions_user_active (user_id, is_active),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Seed units table with data from the game
INSERT IGNORE INTO units (name, icon, hp, mana, move_speed, `range`, dmg, atk_speed, cost, special, role, dmg_type, crit_chance, armor, mres, phys_pen, magic_pen, dodge, lifesteal) VALUES
    ('Guard', '🛡️', 200, 100, 1.5, 25, 15, 0.8, 80, 'Block: Heal 20% HP and gain +50 armor/+50 magic armor for 8s', 'Tanker', 'physical', 0, 60, 30, 0, 0, 0.1, 0),
    ('Assassin', '🗡️', 80, 80, 1.9, 20, 35, 1.5, 60, 'Dash: Jump to farthest enemy, +50% Crit/Dodge/Lifesteal', 'Burst/Flank', 'physical', 0.25, 10, 10, 0, 0, 0.3, 0),
    ('Mage', '🔮', 70, 120, 1.2, 140, 60, 1, 75, 'Fire: AoE True damage, mana refund on kill', 'Artillery', 'magic', 0, 10, 10, 0, 0.10, 0.1, 0),
    ('Healer', '✨', 90, 120, 1.1, 120, 5, 1, 50, 'High Heal: Costs 50% mana to heal 3 nearest allies within 200px for 20 HP each', 'Support', 'physical', 0, 10, 10, 0, 0, 0.1, 0),
    ('Bowman', '🏹', 100, 40, 1.2, 160, 12, 1.7, 45, 'Fast: Costs 65% mana to increase attack speed by 50% for 3s', 'Debuffer', 'physical', 0, 10, 10, 0.15, 0, 0.1, 0),
    ('Gunman', '🔫', 110, 60, 0.9, 160, 45, 0.8, 90, 'Range Up: Costs 65% mana to gain +100 range for 3s', 'DPS', 'physical', 0.05, 15, 10, 0.05, 0, 0.1, 0),
    ('Iceman', '❄️', 100, 90, 1.2, 130, 12, 1.1, 60, 'Summon Frost: Costs 60% mana to freeze 3 nearest enemies within 200px for 2s; frozen units cannot attack or move', 'Control Mage', 'magic', 0, 10, 20, 0, 0.10, 0.1, 0),
    ('ChilyGirl', '🌶️', 85, 100, 1.15, 25, 10, 2.5, 70, 'Chili Shield: Cannot take damage for 3s, gains x3 attack speed, and cannot regenerate mana during the effect; first time below 50% HP enters Protection for 3s reducing damage by 80%, then punches forward for 10x damage', 'Melee Bruiser', 'physical', 0, 50, 50, 0, 0, 0.1, 0),
    ('Sniper', '🎯', 90, 100, 0.7, 300, 80, 0.5, 0, 'Long Range: High damage precision', 'Elite DPS', 'physical', 0.20, 10, 10, 0.30, 0, 0.1, 0);

UPDATE units
SET `range` = 25,
    dmg = 10,
    atk_speed = 2.5,
    special = 'Chili Shield: Cannot take damage for 3s, gains x3 attack speed, and cannot regenerate mana during the effect; first time below 50% HP enters Protection for 3s reducing damage by 80%, then punches forward for 10x damage',
    role = 'Melee Bruiser',
    dmg_type = 'physical',
    armor = 50,
    mres = 50,
    magic_pen = 0
WHERE name = 'ChilyGirl';
