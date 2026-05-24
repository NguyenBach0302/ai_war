const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const asyncHandler = require('express-async-handler');
const path = require('path');
const http = require('http');
const { WebSocketServer, WebSocket } = require('ws');
const pool = require('./db');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

dotenv.config();

const app = express();
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/api/match/ws' });
const JWT_SECRET = process.env.JWT_SECRET || 'secret';
const MATCH_START_DELAY_MS = 3000;
const MATCH_TTL_MS = 1000 * 60 * 60;
const MATCH_FPS = 60;
const MATCH_ACTION_DELAY_FRAMES = 0;
const MATCH_BROADCAST_EVERY_FRAMES = 2;
const SERVER_GOLD_RATE = 0.15;
const SERVER_MAP_W = 2400;
const SERVER_LANE_Y = 382;
const SERVER_ROAD_HALF_WIDTH = 120;
const SERVER_BASE_R = 62;
const SERVER_UNIT_SIZE = 10;
const SERVER_UNIT_HALF_SIZE = SERVER_UNIT_SIZE / 2;
const SERVER_MAX_UNITS_PER_PLAYER = 50;
const SERVER_MANA_REGEN_INTERVAL_FRAMES = 60;
const SERVER_MANA_REGEN_AMOUNT = 4;
const waitingMatches = [];
const matches = new Map();
const ADMIN_UNIT_FIELDS = new Set([
    'hp', 'mana', 'dmg', 'atk_speed', 'range', 'move_speed', 'armor', 'mres',
    'crit_chance', 'phys_pen', 'magic_pen', 'dodge', 'lifesteal', 'cost'
]);
const ICEMAN_UNIT = {
    name: 'Iceman',
    icon: '❄️',
    hp: 100,
    mana: 90,
    move_speed: 1.2,
    range: 130,
    dmg: 12,
    atk_speed: 1.1,
    cost: 60,
    special: 'Summon Frost: Freeze 3 nearest enemies and deal 20 true damage; passive freezes adjacent units below 50% HP',
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
    icon: '🌶️',
    hp: 85,
    mana: 100,
    move_speed: 1.15,
    range: 25,
    dmg: 10,
    atk_speed: 2.5,
    cost: 70,
    special: 'Immortal Body: Cannot lose HP for 3s, x2 attack speed, attacks deal +5 true damage; first time below 50% HP enters Protection for 3s reducing damage by 80%, then punches forward for 10x damage',
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

app.use(cors());
app.use(express.json({ limit: '2mb' }));

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, '../public')));
app.use('/res', express.static(path.join(__dirname, '../res')));

// Explicitly serve index.html for the root route
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Middleware for authentication
const authenticate = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ message: 'Unauthorized' });
    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        res.status(401).json({ message: 'Invalid token' });
    }
};

const isAdmin = (req, res, next) => {
    if (req.user?.role !== 0) return res.status(403).json({ message: 'Forbidden: Admin only' });
    next();
};

function makeMatchId() {
    return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function sendMatchEvent(match, event, payload) {
    const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
    match.clients.forEach(client => client.write(data));
    const wsData = JSON.stringify({ event, payload });
    (match.wsClients || new Map()).forEach(socket => {
        if (socket.readyState === WebSocket.OPEN) socket.send(wsData);
    });
}

function getMatchFrame(match) {
    if (!match.startsAt) return 0;
    return Math.max(0, Math.floor((Date.now() - match.startsAt) / 1000 * MATCH_FPS));
}

function getConfirmedFrame(match) {
    return Math.max(0, getMatchFrame(match) - MATCH_ACTION_DELAY_FRAMES);
}

function sendMatchEventToPlayer(match, userId, event, payload) {
    const client = match.clients.get(userId);
    if (client) client.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
    const socket = match.wsClients?.get(userId);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ event, payload }));
}

function getServerBaseForPlayer(idx) {
    return {
        x: idx === 0 ? 130 : SERVER_MAP_W - 130,
        y: SERVER_LANE_Y,
        r: SERVER_BASE_R
    };
}

function getServerForwardDir(owner) {
    return owner === 0 ? 1 : -1;
}

function serverDist(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
}

function getServerUnitHalfSize() {
    return SERVER_UNIT_HALF_SIZE;
}

function getServerTargetRadius(target) {
    return target?.base ? Number(target.base.r || SERVER_BASE_R) : getServerUnitHalfSize();
}

function getServerSurfaceDistance(unit, target) {
    const point = getServerTargetPoint(target);
    return Math.max(0, serverDist(unit, point) - getServerUnitHalfSize() - getServerTargetRadius(target));
}

function clampServerUnitPosition(unit) {
    const minX = getServerBaseForPlayer(0).x + SERVER_BASE_R + SERVER_UNIT_HALF_SIZE;
    const maxX = getServerBaseForPlayer(1).x - SERVER_BASE_R - SERVER_UNIT_HALF_SIZE;
    const minY = SERVER_LANE_Y - SERVER_ROAD_HALF_WIDTH + SERVER_UNIT_HALF_SIZE;
    const maxY = SERVER_LANE_Y + SERVER_ROAD_HALF_WIDTH - SERVER_UNIT_HALF_SIZE;
    unit.x = Math.min(maxX, Math.max(minX, Number(unit.x || 0)));
    unit.y = Math.min(maxY, Math.max(minY, Number(unit.y || SERVER_LANE_Y)));
}

function findServerSpawnPoint(sim, playerIndex) {
    const player = sim.players[playerIndex];
    const dir = getServerForwardDir(playerIndex);
    const x = player.base.x + dir * (player.base.r + SERVER_UNIT_HALF_SIZE);
    const minY = SERVER_LANE_Y - SERVER_ROAD_HALF_WIDTH + SERVER_UNIT_HALF_SIZE;
    const maxY = SERVER_LANE_Y + SERVER_ROAD_HALF_WIDTH - SERVER_UNIT_HALF_SIZE;
    const slots = [SERVER_LANE_Y];
    for (let step = SERVER_UNIT_SIZE; step <= SERVER_ROAD_HALF_WIDTH; step += SERVER_UNIT_SIZE) {
        slots.push(SERVER_LANE_Y - step, SERVER_LANE_Y + step);
    }
    for (const candidateY of slots) {
        if (candidateY < minY || candidateY > maxY) continue;
        const blocked = sim.units.some(other =>
            Math.abs(Number(other.x || 0) - x) < SERVER_UNIT_SIZE &&
            Math.abs(Number(other.y || SERVER_LANE_Y) - candidateY) < SERVER_UNIT_SIZE
        );
        if (!blocked) return { x, y: candidateY };
    }
    return { x, y: SERVER_LANE_Y };
}

function resolveServerUnitSpacing(sim) {
    if (!sim?.units?.length) return;
    for (let pass = 0; pass < 6; pass++) {
        let changed = false;
        for (let i = 0; i < sim.units.length; i++) {
            for (let j = i + 1; j < sim.units.length; j++) {
                const a = sim.units[i];
                const b = sim.units[j];
                const dx = Number(b.x || 0) - Number(a.x || 0);
                const dy = Number(b.y || 0) - Number(a.y || 0);
                const overlapX = SERVER_UNIT_SIZE - Math.abs(dx);
                const overlapY = SERVER_UNIT_SIZE - Math.abs(dy);
                if (overlapX <= 0 || overlapY <= 0) continue;
                if (overlapY <= overlapX) {
                    const pushY = overlapY / 2 || SERVER_UNIT_HALF_SIZE;
                    const signY = dy === 0 ? (a.owner <= b.owner ? -1 : 1) : Math.sign(dy);
                    a.y -= signY * pushY;
                    b.y += signY * pushY;
                } else {
                    const pushX = overlapX / 2 || SERVER_UNIT_HALF_SIZE;
                    const signX = dx === 0 ? (a.owner <= b.owner ? -1 : 1) : Math.sign(dx);
                    a.x -= signX * pushX;
                    b.x += signX * pushX;
                }
                clampServerUnitPosition(a);
                clampServerUnitPosition(b);
                changed = true;
            }
        }
        if (!changed) break;
    }
}

function getServerTargetPoint(target) {
    return target.base ? target.base : target;
}

function getServerDamage(attacker, target, baseDmg, type) {
    if (type === 'true' || !target.meta) return baseDmg;
    const armorValue = type === 'magic' ? Number(target.meta.mres || 0) : Number(target.meta.armor || 0);
    const pen = type === 'magic' ? Number(attacker.meta.magic_pen || 0) : Number(attacker.meta.phys_pen || 0);
    const effective = Math.max(0, armorValue * (1 - pen));
    const reduction = effective <= 50
        ? effective * 0.01
        : Math.min(0.99, 0.5 + 0.5 * (1 - Math.pow(0.5, (effective - 50) / 50)));
    return baseDmg * (1 - reduction);
}

function calculateServerDamage(sim, attacker, target, baseDmg, type) {
    const dodge = target.meta ? Number(target.meta.dodge || 0) + (target.dodgeBoostUntil && target.dodgeBoostUntil > sim.frame ? 0.5 : 0) : 0;
    if (dodge > 0 && serverRng(sim) < dodge) {
        return { amount: 0, dodged: true, isCrit: false };
    }
    let amount = baseDmg;
    const attackerMeta = {
        ...(attacker.meta || {}),
        crit_chance: Number(attacker.meta?.crit_chance || 0) + (attacker.critBoostUntil && attacker.critBoostUntil > sim.frame ? 0.5 : 0),
        phys_pen: Number(attacker.meta?.phys_pen || 0) + (attacker.penBoostUntil && attacker.penBoostUntil > sim.frame ? 0.15 : 0)
    };
    const effectiveAttacker = { ...attacker, meta: attackerMeta };
    const critChance = Number(attackerMeta.crit_chance || 0);
    const isCrit = critChance > 0 && serverRng(sim) < critChance;
    if (isCrit) amount *= 2;
    amount = getServerDamage(effectiveAttacker, target, amount, type);
    return { amount, dodged: false, isCrit };
}

function pushServerEvent(match, event) {
    const sim = match.sim;
    const payload = { frame: sim?.frame || 0, ...event };
    if (sim) sim.eventHistory.push(payload);
    match.eventHistory = [...(match.eventHistory || []), payload];
    return payload;
}

function snapshotServerTarget(target) {
    if (!target) return null;
    const point = getServerTargetPoint(target);
    return {
        id: target.id ?? `base-${target.id}`,
        type: target.type || 'Base',
        owner: target.owner ?? target.id ?? null,
        x: Number(point?.x || 0),
        y: Number(point?.y || 0),
        hp: Number(target.hp || 0),
        maxHp: Number(target.maxHp || 0),
        radius: getServerTargetRadius(target),
        isBase: !!target.base
    };
}

function getRecentServerEvents(sim, limit = 80) {
    if (!sim) return [];
    const gameplayEvents = sim.eventHistory.slice(-limit);
    const visualEvents = sim.pendingVisualEvents.slice(-limit);
    return [...gameplayEvents, ...visualEvents]
        .sort((a, b) => Number(a.frame || 0) - Number(b.frame || 0))
        .slice(-limit);
}

function applyServerDamage(match, attacker, target, baseDmg, type, skill = null) {
    const sim = match.sim;
    const result = calculateServerDamage(sim, attacker, target, baseDmg, type);
    if (!result.dodged) {
        target.hp -= result.amount;
        if (!target.base) target.lastAttacker = attacker.owner;
        const lifesteal = Number(attacker.meta?.lifesteal || 0) + (attacker.lifestealBoostUntil && attacker.lifestealBoostUntil > sim.frame ? 0.5 : 0);
        if (lifesteal > 0 && result.amount > 0) {
            attacker.hp = Math.min(attacker.maxHp, attacker.hp + result.amount * lifesteal);
        }
    }
    const event = pushServerEvent(match, {
        type: 'damage',
        attackerId: attacker.id,
        attackerType: attacker.type,
        attackerOwner: attacker.owner,
        targetId: target.id ?? `base-${target.id}`,
        targetType: target.type || 'Base',
        targetOwner: target.owner ?? target.id ?? null,
        amount: result.amount,
        damageType: type,
        dodged: result.dodged,
        crit: result.isCrit,
        skill,
        attackerX: Number(attacker.x || 0),
        attackerY: Number(attacker.y || 0),
        targetX: Number(getServerTargetPoint(target)?.x || 0),
        targetY: Number(getServerTargetPoint(target)?.y || 0)
    });
    attacker.lastDamageDealt = {
        frame: sim.frame,
        targetId: event.targetId,
        targetType: event.targetType,
        amount: result.amount,
        damageType: type,
        dodged: result.dodged,
        crit: result.isCrit,
        skill
    };
    if (!target.base) {
        target.lastDamageTaken = {
            frame: sim.frame,
            attackerId: attacker.id,
            attackerType: attacker.type,
            amount: result.amount,
            damageType: type,
            dodged: result.dodged,
            crit: result.isCrit,
            skill
        };
    }
    return result;
}

function createServerSim(match) {
    const unitRows = Array.isArray(match.units) ? match.units : [];
    const classes = new Map(unitRows.map(unit => [unit.name, unit]));
    return {
        frame: 0,
        seq: 0,
        nextUnitId: 1,
        rngState: Number(match.seed || 1) >>> 0 || 1,
        commands: [],
        classes,
        players: match.players.map((player, idx) => ({
            id: idx,
            userId: player.id,
            name: player.username,
            gold: 150,
            hp: 2500,
            maxHp: 2500,
            eliminated: false,
            base: getServerBaseForPlayer(idx)
        })),
        units: [],
        projectiles: [],
        pendingVisualEvents: [],
        eventHistory: []
    };
}

function serverRng(sim) {
    sim.rngState = (sim.rngState * 1664525 + 1013904223) >>> 0;
    return sim.rngState / 0x100000000;
}

function serializeServerSim(match) {
    const sim = match.sim;
    return {
        seq: sim.seq,
        frame: sim.frame,
        serverNow: Date.now(),
        state: {
            frameCount: sim.frame,
            players: sim.players.map(player => ({
                id: player.id,
                name: player.name,
                gold: player.gold,
                hp: player.hp,
                maxHp: player.maxHp,
                eliminated: player.eliminated
            })),
            units: sim.units.map(unit => ({
                id: unit.id,
                owner: unit.owner,
                type: unit.type,
                hp: unit.hp,
                maxHp: unit.maxHp,
                mana: unit.mana,
                maxMana: unit.maxMana,
                x: unit.x,
                y: unit.y,
                laneY: unit.y,
                cooldown: unit.cooldown,
                state: unit.state,
                behavior: unit.behavior || unit.state,
                radius: getServerUnitHalfSize(),
                buffs: [
                    ...(unit.dodgeBoostUntil && unit.dodgeBoostUntil > sim.frame ? [{ type: 'dodge', value: 0.5, duration: unit.dodgeBoostUntil - sim.frame }] : []),
                    ...(unit.lifestealBoostUntil && unit.lifestealBoostUntil > sim.frame ? [{ type: 'lifesteal', value: 0.5, duration: unit.lifestealBoostUntil - sim.frame }] : []),
                    ...(unit.critBoostUntil && unit.critBoostUntil > sim.frame ? [{ type: 'crit_chance', value: 0.5, duration: unit.critBoostUntil - sim.frame }] : []),
                    ...(unit.penBoostUntil && unit.penBoostUntil > sim.frame ? [{ type: 'phys_pen', value: 0.15, duration: unit.penBoostUntil - sim.frame }] : [])
                ],
                isPet: false,
                untargetableTimer: 0,
                facing: unit.facing,
                blockTimer: 0,
                animAction: unit.animAction,
                animStartedAt: unit.animStartedAt,
                position: {
                    x: unit.x,
                    y: unit.y,
                    laneY: unit.y
                },
                footprint: {
                    width: SERVER_UNIT_SIZE,
                    height: SERVER_UNIT_SIZE,
                    halfSize: SERVER_UNIT_HALF_SIZE
                },
                target: unit.currentTarget || null,
                targetDistance: Number(unit.targetDistance || 0),
                stats: {
                    moveSpeed: Number(unit.meta?.move_speed || 0),
                    range: Number(unit.meta?.range || 0),
                    damage: Number(unit.meta?.dmg || 0),
                    attackSpeed: Number(unit.meta?.atk_speed || 0),
                    damageType: unit.meta?.dmg_type || 'physical'
                },
                lastDamageDealt: unit.lastDamageDealt || null,
                lastDamageTaken: unit.lastDamageTaken || null
            })),
            projectiles: [],
            vfx: [],
            floatingTexts: []
        },
        events: getRecentServerEvents(sim)
    };
}

function broadcastServerFrame(match) {
    if (!match.sim) return;
    const payload = serializeServerSim(match);
    match.stateSeq = payload.seq;
    match.stateSnapshot = payload;
    sendMatchEvent(match, 'match-state', payload);
}

function endServerMatch(match, reason = 'finished') {
    if (!match || match.ended) return;
    match.ended = true;
    broadcastServerFrame(match);
    sendMatchEvent(match, 'match-ended', {
        reason,
        state: match.stateSnapshot,
        winnerIndex: match.sim?.players.find(player => !player.eliminated)?.id ?? null
    });
    setTimeout(() => removeMatch(match.id), 1500);
}

function handleMatchBuy(match, userId, unitType) {
    if (!match || !match.started || match.ended) {
        return { ok: false, status: 404, message: 'Match not found' };
    }
    const playerIndex = match.players.findIndex(player => player.id === userId);
    if (playerIndex < 0) return { ok: false, status: 403, message: 'Not in this match' };
    if (!/^[a-zA-Z0-9 _-]{1,40}$/.test(String(unitType || ''))) {
        return { ok: false, status: 400, message: 'Invalid unit type' };
    }

    const serverFrame = match.sim?.frame ?? getMatchFrame(match);
    const actionId = Number(match.nextActionId || 1);
    const payload = {
        actionId,
        action: 'buy',
        playerIndex,
        unitType: String(unitType),
        actionFrame: serverFrame,
        serverFrame,
        sentAt: Date.now()
    };
    match.nextActionId = actionId + 1;
    match.lastActionFrame = serverFrame;
    match.actionLog = [...(match.actionLog || []), payload].slice(-200);

    let statePayload = null;
    if (match.sim) {
        const spawned = spawnServerUnit(match, playerIndex, payload.unitType);
        if (spawned) {
            match.sim.seq += 1;
            statePayload = serializeServerSim(match);
            match.stateSeq = statePayload.seq;
            match.stateSnapshot = statePayload;
            sendMatchEvent(match, 'match-state', statePayload);
        }
    }
    sendMatchEvent(match, 'match-action', payload);
    return { ok: true, action: payload, state: statePayload };
}

function spawnServerUnit(match, playerIndex, unitType) {
    const sim = match.sim;
    const player = sim.players[playerIndex];
    const meta = sim.classes.get(unitType);
    if (!player || player.eliminated || !meta) return false;
    const ownedCount = sim.units.filter(unit => unit.owner === playerIndex).length;
    if (ownedCount >= SERVER_MAX_UNITS_PER_PLAYER) return false;
    const cost = Number(meta.cost || 0);
    if (player.gold < cost) return false;
    player.gold -= cost;
    const dir = getServerForwardDir(playerIndex);
    const spawn = findServerSpawnPoint(sim, playerIndex);
    const unit = {
        id: `s${playerIndex}_${sim.nextUnitId++}`,
        owner: playerIndex,
        type: unitType,
        meta,
        hp: Number(meta.hp || 1),
        maxHp: Number(meta.hp || 1),
        mana: Number(meta.mana || 0) * 0.5,
        maxMana: Number(meta.mana || 0),
        x: spawn.x,
        y: spawn.y,
        cooldown: 0,
        skillCooldown: 30,
        state: 'march',
        animAction: 'idle',
        animStartedAt: sim.frame,
        facing: dir > 0 ? 'right' : 'left',
        lastAttacker: null,
        behavior: 'spawn',
        currentTarget: null,
        targetDistance: 0,
        lastDamageDealt: null,
        lastDamageTaken: null
    };
    clampServerUnitPosition(unit);
    sim.units.push(unit);
    const event = { type: 'unit-spawn', frame: sim.frame, unitId: unit.id, unitType, owner: playerIndex, x: unit.x, y: unit.y };
    sim.eventHistory.push(event);
    match.eventHistory = [...(match.eventHistory || []), event];
    return true;
}

function findServerTarget(sim, unit) {
    const enemies = sim.units
        .filter(other => other.owner !== unit.owner && other.hp > 0)
        .map(other => ({ target: other, distance: getServerSurfaceDistance(unit, other) }));
    sim.players.forEach(player => {
        if (!player.eliminated && player.id !== unit.owner) {
            enemies.push({ target: player, distance: getServerSurfaceDistance(unit, player) });
        }
    });
    enemies.sort((a, b) => a.distance - b.distance);
    return enemies[0]?.target || null;
}

function setServerAnim(unit, action, frame) {
    if (unit.animAction !== action || frame - Number(unit.animStartedAt || 0) > 24) {
        unit.animAction = action;
        unit.animStartedAt = frame;
    }
}

function getServerAttackAnim(unit) {
    const type = String(unit.type || '').toLowerCase();
    if (type.includes('bowman') || type.includes('sniper')) return 'shot';
    if (type.includes('gunman') || type.includes('gunner')) return 'shot_1';
    if (type.includes('mage') || type.includes('iceman')) return 'attack_1';
    if (type.includes('healer')) return 'attack_1';
    if (type.includes('guard')) return 'attack_1';
    if (type.includes('assassin')) return 'attack_1';
    if (type.includes('chilygirl')) return 'attack';
    return 'attack';
}

function getServerProjectileSprite(unit, skill = null) {
    const type = String(unit.type || '').toLowerCase();
    if (skill === 'grenade') return 'grenade';
    if (type.includes('bowman')) return 'arrow';
    if (type.includes('mage')) return 'mage_charge';
    if (type.includes('healer')) return 'healer_fire_1';
    if (type.includes('iceman')) return 'iceman_magic_arrow';
    if (type.includes('chilygirl')) return 'chily';
    return null;
}

function addServerProjectileVisual(match, unit, target, skill = null) {
    const sim = match.sim;
    if (!sim) return;
    const point = getServerTargetPoint(target);
    const event = {
        type: 'projectile',
        id: `pv${sim.frame}_${sim.pendingVisualEvents.length}_${unit.id}`,
        frame: sim.frame,
        attackerId: unit.id,
        attackerType: unit.type,
        targetId: target.id ?? `base-${target.id}`,
        targetType: target.type || 'Base',
        x: unit.x,
        y: unit.y - 8,
        tx: point.x,
        ty: point.y,
        owner: unit.owner,
        dmg: Number(unit.meta.dmg || 1),
        speed: skill === 'grenade' ? 6 : 8,
        color: unit.owner === 0 ? '#38bdf8' : '#fbbf24',
        dmgType: unit.meta.dmg_type || 'physical',
        sprite: getServerProjectileSprite(unit, skill),
        explosionRadius: skill === 'grenade' ? 28 : 0
    };
    sim.pendingVisualEvents.push(event);
    sendMatchEvent(match, 'match-visual', event);
}

function addServerVfxVisual(match, x, y, text, color = '#fff') {
    const sim = match.sim;
    if (!sim) return;
    const event = {
        type: 'vfx',
        id: `vfx${sim.frame}_${sim.pendingVisualEvents.length}_${text}`,
        frame: sim.frame,
        x,
        y,
        text,
        color
    };
    sim.pendingVisualEvents.push(event);
    sendMatchEvent(match, 'match-visual', event);
}

function applyServerAreaDamage(match, unit, center, radius, amount, damageType, label) {
    const sim = match.sim;
    sim.units.forEach(target => {
        if (target.owner === unit.owner || target.hp <= 0) return;
        if (serverDist(target, center) > radius) return;
        applyServerDamage(match, unit, target, amount, damageType, label);
    });
}

function tryServerSkill(match, unit, target) {
    const sim = match.sim;
    if (unit.skillCooldown > 0 || unit.maxMana <= 0) return false;
    const type = String(unit.type || '');
    const lower = type.toLowerCase();

    if (lower.includes('iceman') && unit.mana >= 60) {
        unit.mana -= 60;
        unit.skillCooldown = 120;
        setServerAnim(unit, 'charge_2', sim.frame);
        const targets = sim.units
            .filter(other => other.owner !== unit.owner && other.hp > 0)
            .map(other => ({ unit: other, distance: serverDist(unit, other) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 3)
            .map(entry => entry.unit);
        targets.forEach(enemy => {
            enemy.frozenUntil = Math.max(enemy.frozenUntil || 0, sim.frame + 120);
            applyServerDamage(match, unit, enemy, 20, 'true', 'frost');
            addServerVfxVisual(match, enemy.x, enemy.y - 20, 'FROST', '#7dd3fc');
        });
        return true;
    }

    if (lower.includes('gunman') || lower.includes('gunner')) {
        if (unit.mana >= 60 && target) {
            unit.mana -= 60;
            unit.skillCooldown = 240;
            setServerAnim(unit, 'attack', sim.frame);
            addServerProjectileVisual(match, unit, target, 'grenade');
            applyServerAreaDamage(match, unit, getServerTargetPoint(target), 48, Number(unit.meta.dmg || 1) * 1.8, 'physical', 'grenade');
            return true;
        }
    }

    if (lower.includes('mage') && unit.mana >= 80 && target) {
        unit.mana -= 80;
        unit.skillCooldown = 240;
        setServerAnim(unit, 'attack_2', sim.frame);
        addServerProjectileVisual(match, unit, target, 'fire');
        applyServerAreaDamage(match, unit, getServerTargetPoint(target), 70, 55, 'magic', 'fire');
        addServerVfxVisual(match, getServerTargetPoint(target).x, getServerTargetPoint(target).y - 18, 'FIRE', '#f97316');
        return true;
    }

    if (lower.includes('guard') && unit.mana >= 80) {
        unit.mana -= 80;
        unit.skillCooldown = 420;
        unit.hp = Math.min(unit.maxHp * 1.4, unit.hp + unit.maxHp * 0.35);
        setServerAnim(unit, 'protect', sim.frame);
        addServerVfxVisual(match, unit.x, unit.y - 24, 'PROTECT', '#94a3b8');
        return true;
    }

    if (lower.includes('chilygirl') && unit.mana >= 70 && target) {
        unit.mana -= 70;
        unit.skillCooldown = 240;
        setServerAnim(unit, 'attack', sim.frame);
        addServerProjectileVisual(match, unit, target, 'chily_big');
        applyServerAreaDamage(match, unit, getServerTargetPoint(target), 60, Number(unit.meta.dmg || 1) * 3, 'true', 'big_chili');
        addServerVfxVisual(match, getServerTargetPoint(target).x, getServerTargetPoint(target).y - 18, 'CHILI', '#fb7185');
        return true;
    }

    if (lower.includes('assassin') && unit.mana >= 80) {
        const dashTarget = sim.units
            .filter(other => other.owner !== unit.owner && other.hp > 0 && serverDist(unit, other) <= 300)
            .sort((a, b) => serverDist(unit, b) - serverDist(unit, a))[0];
        if (!dashTarget) return false;
        unit.mana -= 80;
        unit.skillCooldown = 300;
        const side = unit.facing === 'left' ? 1 : -1;
        unit.x = dashTarget.x + side * 28;
        unit.y = dashTarget.y;
        setServerAnim(unit, 'attack_3', sim.frame);
        unit.dodgeBoostUntil = sim.frame + 180;
        unit.lifestealBoostUntil = sim.frame + 180;
        addServerVfxVisual(match, unit.x, unit.y - 20, 'DASH', '#f43f5e');
        return true;
    }

    if (lower.includes('healer') && unit.mana >= 80) {
        const ally = sim.units
            .filter(other => other.owner === unit.owner && other.id !== unit.id && other.hp < other.maxHp)
            .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
        if (ally) {
            unit.mana -= 80;
            unit.skillCooldown = 240;
            setServerAnim(unit, 'attack_3', sim.frame);
            addServerProjectileVisual(match, unit, ally, 'heal');
            const amount = Math.max(35, Number(unit.meta.dmg || 1) * 8);
            ally.hp = Math.min(ally.maxHp, ally.hp + amount);
            addServerVfxVisual(match, ally.x, ally.y - 18, `+${Math.floor(amount)}`, '#22c55e');
            return true;
        }
    }

    if (lower.includes('bowman') && unit.mana >= 40) {
        unit.mana -= 40;
        unit.skillCooldown = 300;
        unit.penBoostUntil = sim.frame + 180;
        setServerAnim(unit, 'attack_3', sim.frame);
        addServerVfxVisual(match, unit.x, unit.y - 20, 'FOCUS', '#fbbf24');
        return true;
    }

    return false;
}

function updateServerSim(match) {
    const sim = match.sim;
    if (!sim || match.ended) return;
    sim.frame += 1;

    sim.players.forEach(player => {
        if (!player.eliminated) player.gold += SERVER_GOLD_RATE;
    });

    while (sim.commands.length) {
        const command = sim.commands.shift();
        if (command.type === 'buy') spawnServerUnit(match, command.playerIndex, command.unitType);
    }

    sim.units.forEach(unit => {
        if (unit.cooldown > 0) unit.cooldown -= 1;
        if (unit.skillCooldown > 0) unit.skillCooldown -= 1;
        if (sim.frame % SERVER_MANA_REGEN_INTERVAL_FRAMES === 0) {
            unit.hp = Math.min(unit.maxHp, unit.hp + 1);
            unit.mana = Math.min(unit.maxMana, unit.mana + SERVER_MANA_REGEN_AMOUNT);
        }
        if (unit.frozenUntil && unit.frozenUntil > sim.frame) {
            unit.state = 'frozen';
            unit.behavior = 'crowd_controlled';
            unit.currentTarget = null;
            unit.targetDistance = 0;
            setServerAnim(unit, 'idle', sim.frame);
            return;
        }
        const target = findServerTarget(sim, unit);
        if (!target) {
            unit.state = 'idle';
            unit.behavior = 'idle';
            unit.currentTarget = null;
            unit.targetDistance = 0;
            setServerAnim(unit, 'idle', sim.frame);
            return;
        }
        const targetPoint = getServerTargetPoint(target);
        const range = Number(unit.meta.range || 25);
        const distance = getServerSurfaceDistance(unit, target);
        const dir = Math.sign(targetPoint.x - unit.x) || getServerForwardDir(unit.owner);
        unit.facing = dir > 0 ? 'right' : 'left';
        unit.currentTarget = snapshotServerTarget(target);
        unit.targetDistance = distance;

        if (distance <= range) {
            unit.state = 'fight';
            unit.behavior = 'engaging';
            if (tryServerSkill(match, unit, target)) return;
            if (unit.cooldown <= 0) {
                const atkSpeed = Math.max(0.1, Number(unit.meta.atk_speed || 1));
                unit.cooldown = Math.max(1, Math.floor(MATCH_FPS / atkSpeed));
                unit.behavior = 'attacking';
                setServerAnim(unit, getServerAttackAnim(unit), sim.frame);
                const berserk = unit.berserkUntil && unit.berserkUntil > sim.frame ? 1.6 : 1;
                if (range >= 35) addServerProjectileVisual(match, unit, target);
                applyServerDamage(match, unit, target, Number(unit.meta.dmg || 1) * berserk, unit.meta.dmg_type || 'physical');
            }
        } else {
            unit.state = 'march';
            unit.behavior = 'moving';
            setServerAnim(unit, 'walk', sim.frame);
            unit.x += dir * Number(unit.meta.move_speed || 1);
            clampServerUnitPosition(unit);
        }
    });

    resolveServerUnitSpacing(sim);

    for (let i = sim.units.length - 1; i >= 0; i--) {
        const unit = sim.units[i];
        if (unit.hp <= 0) {
            const killer = sim.players[unit.lastAttacker];
            if (killer) killer.gold += Number(unit.meta.cost || 0) * 0.3;
            const event = { type: 'unit-death', frame: sim.frame, unitId: unit.id, unitType: unit.type, owner: unit.owner, killerOwner: unit.lastAttacker };
            sim.eventHistory.push(event);
            match.eventHistory = [...(match.eventHistory || []), event];
            sim.units.splice(i, 1);
        }
    }

    sim.players.forEach(player => {
        if (!player.eliminated && player.hp <= 0) {
            player.eliminated = true;
            const event = { type: 'player-eliminated', frame: sim.frame, playerIndex: player.id, playerName: player.name };
            sim.eventHistory.push(event);
            match.eventHistory = [...(match.eventHistory || []), event];
        }
    });

    sim.seq += 1;
    if (sim.frame % MATCH_BROADCAST_EVERY_FRAMES === 0) broadcastServerFrame(match);
    const activePlayers = sim.players.filter(player => !player.eliminated);
    if (activePlayers.length <= 1) endServerMatch(match, 'finished');
}

function startServerSimulation(match) {
    if (match.simTimer) clearInterval(match.simTimer);
    match.sim = createServerSim(match);
    match.simTimer = setInterval(() => updateServerSim(match), 1000 / MATCH_FPS);
    match.simTimer.unref?.();
}

function getMatchPayload(match, userId) {
    return {
        matchId: match.id,
        playerIndex: match.players.findIndex(player => player.id === userId),
        players: match.players.map(player => ({ id: player.id, username: player.username })),
        seed: match.seed,
        startsAt: match.startsAt,
        serverNow: Date.now(),
        confirmedFrame: getConfirmedFrame(match),
        units: match.units || null
    };
}

async function getUnitSnapshot() {
    try {
        const [units] = await pool.query('SELECT * FROM units ORDER BY id ASC');
        return units;
    } catch (err) {
        console.warn('[Match] Unable to capture unit snapshot:', err.message);
        return null;
    }
}

function removeMatch(matchId) {
    const match = matches.get(matchId);
    if (!match) return;
    match.clients.forEach(client => client.end());
    if (match.simTimer) clearInterval(match.simTimer);
    matches.delete(matchId);
    const waitingIdx = waitingMatches.findIndex(id => id === matchId);
    if (waitingIdx >= 0) waitingMatches.splice(waitingIdx, 1);
}

setInterval(() => {
    const now = Date.now();
    matches.forEach(match => {
        if (now - match.createdAt > MATCH_TTL_MS) removeMatch(match.id);
    });
}, 1000 * 60 * 10).unref?.();

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
    await upsertUnit(ICEMAN_UNIT);
    await upsertUnit(CHILYGIRL_UNIT);
    await pool.query('DELETE FROM units WHERE name = ?', ['Hunter']);
}

// --- Auth Routes ---
app.post('/api/auth/register', asyncHandler(async (req, res) => {
    const username = String(req.body.username || '').trim();
    const password = String(req.body.password || '');

    if (!/^[a-zA-Z0-9_]{3,24}$/.test(username)) {
        return res.status(400).json({ message: 'Username must be 3-24 letters, numbers, or underscores' });
    }
    if (password.length < 6) {
        return res.status(400).json({ message: 'Password must be at least 6 characters' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    try {
        // Default role is 4 as per DB schema
        const [result] = await pool.query('INSERT INTO users (username, password) VALUES (?, ?)', [username, hashedPassword]);
        res.status(201).json({ message: 'User registered', userId: result.insertId });
    } catch (err) {
        res.status(400).json({ message: 'Username already exists' });
    }
}));

app.post('/api/auth/login', asyncHandler(async (req, res) => {
    const { username, password } = req.body;
    const [users] = await pool.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = users[0];
    if (user && await bcrypt.compare(password, user.password)) {
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '24h' });
        res.json({ token, user: { id: user.id, username: user.username, gold: user.gold, wins: user.wins, losses: user.losses, role: user.role } });
    } else {
        res.status(401).json({ message: 'Invalid credentials' });
    }
}));

// --- Unit Routes ---
app.get('/api/units', asyncHandler(async (req, res) => {
    const [units] = await pool.query('SELECT * FROM units');
    res.json(units);
}));

app.post('/api/admin/units/update', authenticate, isAdmin, asyncHandler(async (req, res) => {
    const { id, stats } = req.body;
    const safeEntries = Object.entries(stats || {})
        .filter(([key, value]) => ADMIN_UNIT_FIELDS.has(key) && Number.isFinite(Number(value)));

    if (!Number.isInteger(Number(id)) || safeEntries.length === 0) {
        return res.status(400).json({ message: 'Invalid unit update payload' });
    }

    const fields = safeEntries.map(([key]) => `\`${key}\` = ?`).join(', ');
    const values = [...safeEntries.map(([, value]) => Number(value)), Number(id)];
    await pool.query(`UPDATE units SET ${fields} WHERE id = ?`, values);
    res.json({ message: 'Unit updated' });
}));

// --- User Routes ---
app.get('/api/user/profile', authenticate, asyncHandler(async (req, res) => {
    const [users] = await pool.query('SELECT id, username, gold, wins, losses, role FROM users WHERE id = ?', [req.user.id]);
    res.json(users[0]);
}));

// --- Session Routes ---
app.post('/api/session/save', authenticate, asyncHandler(async (req, res) => {
    const { state } = req.body;
    // Check if active session exists
    const [existing] = await pool.query('SELECT id FROM game_sessions WHERE user_id = ? AND is_active = 1', [req.user.id]);
    if (existing.length > 0) {
        await pool.query('UPDATE game_sessions SET state_json = ? WHERE id = ?', [JSON.stringify(state), existing[0].id]);
    } else {
        await pool.query('INSERT INTO game_sessions (user_id, state_json) VALUES (?, ?)', [req.user.id, JSON.stringify(state)]);
    }
    res.json({ message: 'Session saved' });
}));

app.get('/api/session/active', authenticate, asyncHandler(async (req, res) => {
    const [sessions] = await pool.query('SELECT state_json FROM game_sessions WHERE user_id = ? AND is_active = 1', [req.user.id]);
    if (sessions.length > 0) {
        const rawState = sessions[0].state_json;
        const state = typeof rawState === 'string' ? JSON.parse(rawState) : rawState;
        res.json({ hasActive: true, state });
    } else {
        res.json({ hasActive: false });
    }
}));

app.post('/api/session/clear', authenticate, asyncHandler(async (req, res) => {
    await pool.query('UPDATE game_sessions SET is_active = 0 WHERE user_id = ?', [req.user.id]);
    res.json({ message: 'Session cleared' });
}));

// --- Online Match Routes ---
app.post('/api/match/join', authenticate, asyncHandler(async (req, res) => {
    const user = { id: req.user.id, username: req.user.username };

    for (const match of matches.values()) {
        if (!match.ended && match.players.some(player => player.id === user.id)) {
            return res.json({ status: match.started ? 'started' : 'waiting', ...getMatchPayload(match, user.id) });
        }
    }

    const waitingId = waitingMatches.shift();
    const waitingMatch = waitingId ? matches.get(waitingId) : null;
    if (waitingMatch && waitingMatch.players.length === 1 && waitingMatch.players[0].id !== user.id) {
        waitingMatch.players.push(user);
        waitingMatch.started = true;
        waitingMatch.startsAt = Date.now() + MATCH_START_DELAY_MS;
        startServerSimulation(waitingMatch);
        sendMatchEvent(waitingMatch, 'match-start', { ...getMatchPayload(waitingMatch, waitingMatch.players[0].id), playerIndex: 0 });
        res.json({ status: 'started', ...getMatchPayload(waitingMatch, user.id) });
        return;
    }

    const match = {
        id: makeMatchId(),
        players: [user],
        clients: new Map(),
        wsClients: new Map(),
        seed: Math.floor(Math.random() * 0xffffffff),
        units: await getUnitSnapshot(),
        startsAt: null,
        started: false,
        ended: false,
        createdAt: Date.now(),
        nextActionId: 1,
        lastActionFrame: 0,
        actionLog: [],
        stateSeq: 0,
        stateSnapshot: null,
        stateLog: [],
        eventHistory: []
    };
    matches.set(match.id, match);
    waitingMatches.push(match.id);
    res.json({ status: 'waiting', ...getMatchPayload(match, user.id) });
}));

app.get('/api/match/stream', (req, res) => {
    let decoded;
    try {
        decoded = jwt.verify(String(req.query.token || ''), JWT_SECRET);
    } catch (err) {
        return res.status(401).end();
    }

    const match = matches.get(String(req.query.matchId || ''));
    if (!match || !match.players.some(player => player.id === decoded.id)) {
        return res.status(404).end();
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();
    res.write(': connected\n\n');
    match.clients.set(decoded.id, res);

    if (match.started) {
        res.write(`event: match-start\ndata: ${JSON.stringify(getMatchPayload(match, decoded.id))}\n\n`);
        (match.actionLog || []).forEach(action => {
            res.write(`event: match-action\ndata: ${JSON.stringify(action)}\n\n`);
        });
        if (match.stateSnapshot) {
            res.write(`event: match-state\ndata: ${JSON.stringify(match.stateSnapshot)}\n\n`);
        }
    }

    const syncTimer = setInterval(() => {
        if (res.destroyed || match.ended) {
            clearInterval(syncTimer);
            return;
        }
        res.write(`event: match-sync\ndata: ${JSON.stringify({
            serverNow: Date.now(),
            serverFrame: getMatchFrame(match),
            confirmedFrame: getConfirmedFrame(match),
            lastActionId: Number(match.nextActionId || 1) - 1,
            actions: (match.actionLog || []).slice(-50)
        })}\n\n`);
    }, 250);

    req.on('close', () => {
        clearInterval(syncTimer);
        if (match.clients.get(decoded.id) === res) match.clients.delete(decoded.id);
        sendMatchEvent(match, 'player-disconnected', { userId: decoded.id });
    });
});

app.post('/api/match/action', authenticate, (req, res) => {
    const match = matches.get(String(req.body.matchId || ''));
    const type = String(req.body.type || '');
    const unitType = String(req.body.unitType || '');
    if (type !== 'buy') {
        return res.status(400).json({ message: 'Invalid match action' });
    }
    const result = handleMatchBuy(match, req.user.id, unitType);
    if (!result.ok) return res.status(result.status || 400).json({ message: result.message || 'Unable to process action' });
    res.json(result);
});

app.post('/api/match/state', authenticate, (req, res) => {
    const match = matches.get(String(req.body.matchId || ''));
    if (!match || !match.started || match.ended) {
        return res.status(404).json({ message: 'Match not found' });
    }

    const playerIndex = match.players.findIndex(player => player.id === req.user.id);
    if (playerIndex !== 0) {
        return res.status(403).json({ message: 'Only the authoritative simulator can publish state' });
    }

    const seq = Number(req.body.seq || 0);
    const frame = Number(req.body.frame || 0);
    const state = req.body.state;
    const events = Array.isArray(req.body.events) ? req.body.events.slice(0, 200) : [];
    if (!Number.isFinite(seq) || !Number.isFinite(frame) || !state || typeof state !== 'object') {
        return res.status(400).json({ message: 'Invalid match state' });
    }
    if (seq <= Number(match.stateSeq || 0)) {
        return res.json({ ok: true, ignored: true });
    }

    const realtimeEvents = events.filter(event => event?.type !== 'damage').slice(-50);
    const payload = {
        seq,
        frame,
        serverNow: Date.now(),
        state,
        events: realtimeEvents
    };
    match.stateSeq = seq;
    match.stateSnapshot = payload;
    match.stateLog = [...(match.stateLog || []), payload].slice(-240);
    if (events.length) {
        match.eventHistory = [...(match.eventHistory || []), ...events.map(event => ({
            ...event,
            serverSeq: seq,
            serverFrame: frame,
            serverAt: payload.serverNow
        }))];
    }
    match.players.forEach((player, idx) => {
        if (idx !== 0) sendMatchEventToPlayer(match, player.id, 'match-state', payload);
    });
    res.json({ ok: true });
});

app.post('/api/match/leave', authenticate, (req, res) => {
    const match = matches.get(String(req.body.matchId || ''));
    if (match && match.players.some(player => player.id === req.user.id)) {
        match.ended = true;
        sendMatchEvent(match, 'match-ended', { reason: 'left', userId: req.user.id });
        setTimeout(() => removeMatch(match.id), 1000);
    }
    res.json({ ok: true });
});

wss.on('connection', (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    let decoded;
    try {
        decoded = jwt.verify(String(url.searchParams.get('token') || ''), JWT_SECRET);
    } catch (err) {
        socket.close(1008, 'Unauthorized');
        return;
    }

    const match = matches.get(String(url.searchParams.get('matchId') || ''));
    if (!match || !match.players.some(player => player.id === decoded.id)) {
        socket.close(1008, 'Match not found');
        return;
    }

    match.wsClients.set(decoded.id, socket);
    socket.send(JSON.stringify({ event: 'ws-ready', payload: getMatchPayload(match, decoded.id) }));
    if (match.started) {
        socket.send(JSON.stringify({ event: 'match-start', payload: getMatchPayload(match, decoded.id) }));
        (match.actionLog || []).forEach(action => socket.send(JSON.stringify({ event: 'match-action', payload: action })));
        if (match.stateSnapshot) socket.send(JSON.stringify({ event: 'match-state', payload: match.stateSnapshot }));
    }

    socket.on('message', raw => {
        let message;
        try {
            message = JSON.parse(raw.toString());
        } catch (err) {
            socket.send(JSON.stringify({ event: 'error', payload: { message: 'Invalid JSON' } }));
            return;
        }
        if (message.type === 'buy') {
            const result = handleMatchBuy(match, decoded.id, message.unitType);
            socket.send(JSON.stringify({ event: 'command-result', payload: { requestId: message.requestId || null, ...result } }));
            return;
        }
        if (message.type === 'leave') {
            match.ended = true;
            sendMatchEvent(match, 'match-ended', { reason: 'left', userId: decoded.id });
            setTimeout(() => removeMatch(match.id), 1000);
        }
    });

    socket.on('close', () => {
        if (match.wsClients?.get(decoded.id) === socket) match.wsClients.delete(decoded.id);
    });
});

// --- Game Routes ---
app.post('/api/game/end', authenticate, asyncHandler(async (req, res) => {
    const { winnerId, duration, result } = req.body; // result: 'win' or 'loss'
    await pool.query('INSERT INTO games (winner_id, duration) VALUES (?, ?)', [winnerId, duration]);
    
    if (result === 'win') {
        await pool.query('UPDATE users SET wins = wins + 1, gold = gold + 100 WHERE id = ?', [req.user.id]);
    } else {
        await pool.query('UPDATE users SET losses = losses + 1, gold = gold + 20 WHERE id = ?', [req.user.id]);
    }
    
    res.json({ message: 'Game result saved' });
}));

// --- AI Strategy Route ---
app.post('/api/ai/strategy', authenticate, asyncHandler(async (req, res) => {
    const { player, gameState, config } = req.body;
    
    const providerName = config?.provider || 'deepseek';
    const provider = PROVIDERS[providerName] || PROVIDERS.deepseek;
    const apiKey = provider.key;
    const model = config?.model || (providerName === 'openai' ? 'o4-mini' : 'deepseek-v4-flash');

    // Fetch units from DB to provide to AI
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
        const affordableUnits = dbUnits.filter(u => u.cost <= player.gold).map(u => u.name);
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
    ${gameState.enemies.map(e => `- ${e.name}: Base HP ${e.hp}, Position (x: ${e.basePos?.x}, y: ${e.basePos?.y})`).join('\n')}

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
            model: model,
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
        const affordableUnits = dbUnits.filter(u => u.cost <= player.gold).map(u => u.name);
        res.json({ decision: affordableUnits.length ? affordableUnits[0] : 'save' });
    }
}));

ensureGameUnits()
    .catch(err => console.error('[Unit Migration] Unable to ensure game units:', err.message))
    .finally(() => {
        server.listen(PORT, () => {
            console.log(`Age of Agents Secured Server running at http://localhost:${PORT}`);
        });
    });
