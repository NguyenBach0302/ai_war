SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- ---------------------------------------------------------
-- Database Setup
-- ---------------------------------------------------------
DROP DATABASE IF EXISTS ai_war;
CREATE DATABASE ai_war CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE ai_war;

-- ---------------------------------------------------------
-- Table: users
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password VARCHAR(255) NOT NULL,
    gold INT DEFAULT 150,
    wins INT DEFAULT 0,
    losses INT DEFAULT 0,
    role INT DEFAULT 4, -- 0: Admin, 1-4: Other roles
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: units
-- ---------------------------------------------------------
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
    -- ADVANCED STATS
    crit_chance FLOAT DEFAULT 0,
    armor INT DEFAULT 0,
    mres INT DEFAULT 0,
    phys_pen FLOAT DEFAULT 0,
    magic_pen FLOAT DEFAULT 0,
    dodge FLOAT DEFAULT 0.1,
    lifesteal FLOAT DEFAULT 0
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: games
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS games (
    id INT AUTO_INCREMENT PRIMARY KEY,
    winner_id INT,
    duration INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (winner_id) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: game_sessions
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS game_sessions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id INT NOT NULL,
    state_json JSON NOT NULL,
    is_active TINYINT(1) DEFAULT 1,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_game_sessions_user_active (user_id, is_active),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: user_units
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_units (
    user_id INT NOT NULL,
    unit_id INT NOT NULL,
    acquisition_source VARCHAR(30) DEFAULT 'base_free',
    acquired_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, unit_id),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (unit_id) REFERENCES units(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Table: user_loadouts
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_loadouts (
    user_id INT NOT NULL,
    slot TINYINT NOT NULL,
    name VARCHAR(50) NOT NULL,
    unit_names JSON NOT NULL,
    is_active TINYINT(1) DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (user_id, slot),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT chk_slot CHECK (slot BETWEEN 1 AND 3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------------------------------------------------------
-- Seed Data: units
-- ---------------------------------------------------------
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

SET FOREIGN_KEY_CHECKS = 1;
