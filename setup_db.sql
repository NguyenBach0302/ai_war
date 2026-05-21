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

-- Seed units table with data from the game
INSERT IGNORE INTO units (name, icon, hp, mana, speed, `range`, dmg, cd, cost, special, role, dmg_type) VALUES
('Guard', '🛡️', 200, 100, 1.1, 25, 15, 40, 80, 'Phalanx: +50% HP, +50 Armor, Heal 10HP/s, Static for 8s', 'Tanker', 'physical'),
('Assassin', '🗡️', 80, 80, 1.9, 20, 35, 30, 60, 'Frenzy: Blink to farthest enemy, 100% Dodge/50% Lifesteal for 5s', 'Burst/Flank', 'physical'),
('Mage', '🔮', 70, 120, 0.8, 140, 60, 65, 75, 'Meteor: Massive AoE Magic dmg, restore mana on kill', 'Artillery', 'true'),
('Healer', '✨', 90, 120, 1.0, 120, 5, 55, 50, 'Aura: Instantly heal 30 HP to allies', 'Support', 'physical'),
('Bowman', '🏹', 100, 40, 1.2, 160, 12, 35, 45, 'Pierce: Shred 50% Enemy Armor for 2 hits', 'Debuffer', 'physical'),
('Gunman', '🔫', 110, 60, 0.9, 160, 45, 100, 90, 'Rapid Fire: x3 Attack Speed for 2s', 'DPS', 'physical'),
('Hunter', '🐾', 130, 70, 1.4, 130, 20, 45, 55, 'Summon: Call a Pet dog to fight alongside', 'Sustained DPS', 'physical');
