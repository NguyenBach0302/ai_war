CREATE DATABASE IF NOT EXISTS ai_war;
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
    magic_pen FLOAT DEFAULT 0
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
    crit_chance FLOAT DEFAULT 0,
    armor INT DEFAULT 0,
    mres INT DEFAULT 0,
    phys_pen FLOAT DEFAULT 0,
    magic_pen FLOAT DEFAULT 0,
    dodge FLOAT DEFAULT 0.1,
    lifesteal FLOAT DEFAULT 0
    );

    -- Seed units table with data from the game
    INSERT IGNORE INTO units (name, icon, hp, mana, move_speed, `range`, dmg, atk_speed, cost, special, role, dmg_type, crit_chance, armor, mres, phys_pen, magic_pen, dodge, lifesteal) VALUES
    ('Guard', '🛡️', 200, 100, 1.5, 25, 15, 0.8, 80, 'Block: Statue form, +50% HP, +50 Arm/MRes for 8s', 'Tanker', 'physical', 0, 60, 30, 0, 0, 0.1, 0),
    ('Assassin', '🗡️', 80, 80, 1.9, 20, 35, 1.5, 60, 'Dash: Jump to farthest enemy, +50% Crit/Dodge/Lifesteal', 'Burst/Flank', 'physical', 0.25, 10, 10, 0, 0, 0.3, 0),
    ('Mage', '🔮', 70, 120, 1.2, 140, 60, 1, 75, 'Fire: AoE True damage, mana refund on kill', 'Artillery', 'magic', 0, 10, 10, 0, 0.10, 0.1, 0),
    ('Healer', '✨', 90, 120, 1.1, 120, 5, 1, 50, 'High Heal: Strong heal for Guard/Low HP allies', 'Support', 'physical', 0, 10, 10, 0, 0, 0.1, 0),
    ('Bowman', '🏹', 100, 40, 1.2, 160, 12, 1.7, 45, 'Fast: +15% P-Pen for 3s', 'Debuffer', 'physical', 0, 10, 10, 0.15, 0, 0.1, 0),
    ('Gunman', '🔫', 110, 60, 0.9, 160, 45, 0.8, 90, 'Rapid Fire: +100% Atk Spd for 3s', 'DPS', 'physical', 0.05, 15, 10, 0.05, 0, 0.1, 0),
    ('Hunter', '🐾', 130, 70, 1.3, 130, 20, 1.2, 55, 'Call Pet: Summon a pet companion', 'Sustained DPS', 'physical', 0.10, 20, 15, 0, 0, 0.1, 0),
    ('Sniper', '🎯', 90, 100, 0.7, 300, 80, 0.5, 0, 'Long Range: High damage precision', 'Elite DPS', 'physical', 0.20, 10, 10, 0.30, 0, 0.1, 0);
