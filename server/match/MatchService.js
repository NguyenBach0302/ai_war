class MatchService {
    constructor({ pool, WebSocketClass }) {
        this.pool = pool;
        this.WebSocket = WebSocketClass;
        this.MATCH_START_DELAY_MS = 3000;
        this.MATCH_TTL_MS = 1000 * 60 * 60;
        this.MATCH_FPS = 60;
        this.MATCH_ACTION_DELAY_FRAMES = 0;
        this.MATCH_BROADCAST_EVERY_FRAMES = 4;
        this.FULL_SNAPSHOT_EVERY_FRAMES = 60;
        this.SERVER_GOLD_RATE = 0.15;
        this.SERVER_MAP_W = 2400;
        this.SERVER_LANE_Y = 382;
        this.SERVER_ROAD_HALF_WIDTH = 120;
        this.SERVER_BASE_R = 62;
        this.SERVER_UNIT_SIZE = 10;
        this.SERVER_UNIT_HALF_SIZE = this.SERVER_UNIT_SIZE / 2;
        this.SERVER_FORMATION_LANE_OFFSETS = [-18, -8, 8, 18, -28, 28];
        this.SERVER_MAX_UNITS_PER_PLAYER = 50;
        this.SERVER_MANA_REGEN_INTERVAL_FRAMES = 60;
        this.SERVER_MANA_REGEN_AMOUNT = 4;
        this.MAX_MATCH_EVENTS = 256;
        this.MAX_SIM_EVENTS = 128;
        this.MAX_VISUAL_EVENTS = 96;
        this.UNIT_TYPE_CODES = {
            Guard: 1,
            Assassin: 2,
            Mage: 3,
            Healer: 4,
            Bowman: 5,
            Gunman: 6,
            Gunner: 7,
            Iceman: 8,
            ChilyGirl: 9,
            Sniper: 10
        };
        this.UNIT_STATE_CODES = {
            idle: 0,
            march: 1,
            fight: 2,
            frozen: 3
        };
        this.FACING_CODES = {
            left: 0,
            right: 1
        };
        this.BUFF_TYPE_CODES = {
            dodge: 1,
            lifesteal: 2,
            crit_chance: 3,
            phys_pen: 4
        };
        this.ANIM_ACTION_CODES = {
            idle: 0,
            walk: 1,
            attack: 2,
            attack_1: 3,
            attack_2: 4,
            attack_3: 5,
            shot: 6,
            shot_1: 7,
            charge_2: 8,
            protect: 9,
            defend: 10
        };
        this.waitingMatches = [];
        this.matches = new Map();
        this.cleanupTimer = setInterval(() => this.cleanupExpiredMatches(), 1000 * 60 * 10);
        this.cleanupTimer.unref?.();
    }

    makeMatchId() {
        return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    sendMatchEvent(match, event, payload) {
        const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        match.clients.forEach(client => client.write(data));
        const wsData = JSON.stringify({ event, payload });
        (match.wsClients || new Map()).forEach(socket => {
            if (socket.readyState === this.WebSocket.OPEN) socket.send(wsData);
        });
    }

    getMatchFrame(match) {
        if (!match.startsAt) return 0;
        return Math.max(0, Math.floor((Date.now() - match.startsAt) / 1000 * this.MATCH_FPS));
    }

    getConfirmedFrame(match) {
        return Math.max(0, this.getMatchFrame(match) - this.MATCH_ACTION_DELAY_FRAMES);
    }

    sendMatchEventToPlayer(match, userId, event, payload) {
        const client = match.clients.get(userId);
        if (client) client.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        const socket = match.wsClients?.get(userId);
        if (socket?.readyState === this.WebSocket.OPEN) socket.send(JSON.stringify({ event, payload }));
    }

    getServerBaseForPlayer(idx) {
        return {
            x: idx === 0 ? 130 : this.SERVER_MAP_W - 130,
            y: this.SERVER_LANE_Y,
            r: this.SERVER_BASE_R
        };
    }

    getServerForwardDir(owner) {
        return owner === 0 ? 1 : -1;
    }

    serverDist(a, b) {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    getServerUnitHalfSize() {
        return this.SERVER_UNIT_HALF_SIZE;
    }

    getServerTargetRadius(target) {
        return target?.base ? Number(target.base.r || this.SERVER_BASE_R) : this.getServerUnitHalfSize();
    }

    getServerTargetPoint(target) {
        return target.base ? target.base : target;
    }

    getServerSurfaceDistance(unit, target) {
        const point = this.getServerTargetPoint(target);
        return Math.max(0, this.serverDist(unit, point) - this.getServerUnitHalfSize() - this.getServerTargetRadius(target));
    }

    clampServerUnitPosition(unit) {
        const minX = this.getServerBaseForPlayer(0).x + this.SERVER_BASE_R + this.SERVER_UNIT_HALF_SIZE;
        const maxX = this.getServerBaseForPlayer(1).x - this.SERVER_BASE_R - this.SERVER_UNIT_HALF_SIZE;
        const minY = this.SERVER_LANE_Y - this.SERVER_ROAD_HALF_WIDTH + this.SERVER_UNIT_HALF_SIZE;
        const maxY = this.SERVER_LANE_Y + this.SERVER_ROAD_HALF_WIDTH - this.SERVER_UNIT_HALF_SIZE;
        unit.x = Math.min(maxX, Math.max(minX, Number(unit.x || 0)));
        unit.y = Math.min(maxY, Math.max(minY, Number.isFinite(Number(unit.y)) ? Number(unit.y) : this.SERVER_LANE_Y));
    }

    getServerFormationPosition(player, playerIndex, row = 0, column = 0) {
        const dir = this.getServerForwardDir(playerIndex);
        const offset = this.SERVER_FORMATION_LANE_OFFSETS[column] ?? 0;
        return {
            x: player.base.x + dir * (player.base.r + this.SERVER_UNIT_HALF_SIZE + row * this.SERVER_UNIT_SIZE),
            y: this.SERVER_LANE_Y + offset
        };
    }

    findServerSpawnPoint(sim, playerIndex) {
        const player = sim.players[playerIndex];
        const columns = this.SERVER_FORMATION_LANE_OFFSETS.length;
        const maxRows = Math.ceil(this.SERVER_MAX_UNITS_PER_PLAYER / columns) + 4;
        for (let row = 0; row < maxRows; row++) {
            for (let column = 0; column < columns; column++) {
                const candidate = this.getServerFormationPosition(player, playerIndex, row, column);
                const blocked = sim.units.some(other => this.serverDist(other, candidate) < this.SERVER_UNIT_SIZE);
                if (!blocked) return candidate;
            }
        }
        return this.getServerFormationPosition(player, playerIndex, maxRows, 0);
    }

    resolveServerUnitSpacing(sim) {
        if (!sim?.units?.length) return;
        const minDistance = this.SERVER_UNIT_SIZE;
        for (let pass = 0; pass < 6; pass++) {
            let changed = false;
            for (let i = 0; i < sim.units.length - 1; i++) {
                const a = sim.units[i];
                for (let j = i + 1; j < sim.units.length; j++) {
                    const b = sim.units[j];
                    const dx = Number(b.x || 0) - Number(a.x || 0);
                    const dy = Number(b.y || 0) - Number(a.y || 0);
                    const distance = Math.hypot(dx, dy);
                    if (distance >= minDistance) continue;
                    const overlap = (minDistance - distance) / 2;
                    const normalX = distance < 0.001 ? (a.owner <= b.owner ? 1 : -1) : dx / distance;
                    const normalY = distance < 0.001 ? 0 : dy / distance;
                    a.x -= normalX * overlap;
                    a.y -= normalY * overlap;
                    b.x += normalX * overlap;
                    b.y += normalY * overlap;
                    this.clampServerUnitPosition(a);
                    this.clampServerUnitPosition(b);
                    changed = true;
                }
            }
            if (!changed) break;
        }
    }

    getServerDamage(attacker, target, baseDmg, type) {
        if (type === 'true' || !target.meta) return baseDmg;
        const armorValue = type === 'magic' ? Number(target.meta.mres || 0) : Number(target.meta.armor || 0);
        const pen = type === 'magic' ? Number(attacker.meta.magic_pen || 0) : Number(attacker.meta.phys_pen || 0);
        const effective = Math.max(0, armorValue * (1 - pen));
        const reduction = effective <= 50
            ? effective * 0.01
            : Math.min(0.99, 0.5 + 0.5 * (1 - Math.pow(0.5, (effective - 50) / 50)));
        return baseDmg * (1 - reduction);
    }

    calculateServerDamage(sim, attacker, target, baseDmg, type) {
        const dodge = target.meta ? Number(target.meta.dodge || 0) + (target.dodgeBoostUntil && target.dodgeBoostUntil > sim.frame ? 0.5 : 0) : 0;
        if (dodge > 0 && this.serverRng(sim) < dodge) {
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
        const isCrit = critChance > 0 && this.serverRng(sim) < critChance;
        if (isCrit) amount *= 2;
        amount = this.getServerDamage(effectiveAttacker, target, amount, type);
        return { amount, dodged: false, isCrit };
    }

    pushServerEvent(match, event) {
        const sim = match.sim;
        const payload = { frame: sim?.frame || 0, ...event };
        if (sim) {
            sim.eventHistory.push(payload);
            if (sim.eventHistory.length > this.MAX_SIM_EVENTS) {
                sim.eventHistory.splice(0, sim.eventHistory.length - this.MAX_SIM_EVENTS);
            }
        }
        match.eventHistory = [...(match.eventHistory || []), payload].slice(-this.MAX_MATCH_EVENTS);
        return payload;
    }

    snapshotServerTarget(target) {
        if (!target) return null;
        const point = this.getServerTargetPoint(target);
        return {
            id: target.id ?? `base-${target.id}`,
            type: target.type || 'Base',
            owner: target.owner ?? target.id ?? null,
            x: Number(point?.x || 0),
            y: Number(point?.y || 0),
            hp: Number(target.hp || 0),
            maxHp: Number(target.maxHp || 0),
            radius: this.getServerTargetRadius(target),
            isBase: !!target.base
        };
    }

    getRecentServerEvents(sim, limit = 80) {
        if (!sim) return [];
        const gameplayEvents = sim.eventHistory.slice(-limit);
        const visualEvents = sim.pendingVisualEvents.slice(-limit);
        return [...gameplayEvents, ...visualEvents]
            .sort((a, b) => Number(a.frame || 0) - Number(b.frame || 0))
            .slice(-limit);
    }

    applyServerDamage(match, attacker, target, baseDmg, type, skill = null) {
        const sim = match.sim;
        const result = this.calculateServerDamage(sim, attacker, target, baseDmg, type);
        if (!result.dodged) {
            target.hp -= result.amount;
            if (!target.base) target.lastAttacker = attacker.owner;
            const lifesteal = Number(attacker.meta?.lifesteal || 0) + (attacker.lifestealBoostUntil && attacker.lifestealBoostUntil > sim.frame ? 0.5 : 0);
            if (lifesteal > 0 && result.amount > 0) {
                attacker.hp = Math.min(attacker.maxHp, attacker.hp + result.amount * lifesteal);
            }
        }

        const event = this.pushServerEvent(match, {
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
            targetX: Number(this.getServerTargetPoint(target)?.x || 0),
            targetY: Number(this.getServerTargetPoint(target)?.y || 0)
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

    createServerSim(match) {
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
                base: this.getServerBaseForPlayer(idx)
            })),
            units: [],
            projectiles: [],
            pendingVisualEvents: [],
            eventHistory: []
        };
    }

    serverRng(sim) {
        sim.rngState = (sim.rngState * 1664525 + 1013904223) >>> 0;
        return sim.rngState / 0x100000000;
    }

    roundForWire(value, decimals = 1) {
        const factor = 10 ** decimals;
        return Math.round(Number(value || 0) * factor) / factor;
    }

    encodeWireBuff(buff) {
        return {
            t: this.BUFF_TYPE_CODES[buff.type] ?? buff.type,
            v: this.roundForWire(buff.value, 2),
            d: Math.max(0, Math.floor(Number(buff.duration || 0)))
        };
    }

    encodeWirePlayer(player) {
        return {
            i: player.id,
            g: this.roundForWire(player.gold, 2),
            h: this.roundForWire(player.hp, 2),
            H: this.roundForWire(player.maxHp, 2),
            e: player.eliminated ? 1 : 0
        };
    }

    encodeWireUnit(unit, sim) {
        const buffs = [
            ...(unit.dodgeBoostUntil && unit.dodgeBoostUntil > sim.frame ? [{ type: 'dodge', value: 0.5, duration: unit.dodgeBoostUntil - sim.frame }] : []),
            ...(unit.lifestealBoostUntil && unit.lifestealBoostUntil > sim.frame ? [{ type: 'lifesteal', value: 0.5, duration: unit.lifestealBoostUntil - sim.frame }] : []),
            ...(unit.critBoostUntil && unit.critBoostUntil > sim.frame ? [{ type: 'crit_chance', value: 0.5, duration: unit.critBoostUntil - sim.frame }] : []),
            ...(unit.penBoostUntil && unit.penBoostUntil > sim.frame ? [{ type: 'phys_pen', value: 0.15, duration: unit.penBoostUntil - sim.frame }] : [])
        ].map(buff => this.encodeWireBuff(buff));

        return {
            i: unit.id,
            o: unit.owner,
            t: this.UNIT_TYPE_CODES[unit.type] ?? unit.type,
            h: this.roundForWire(unit.hp, 2),
            H: this.roundForWire(unit.maxHp, 2),
            m: this.roundForWire(unit.mana, 2),
            M: this.roundForWire(unit.maxMana, 2),
            x: this.roundForWire(unit.x, 1),
            y: this.roundForWire(unit.y, 1),
            s: this.UNIT_STATE_CODES[unit.state] ?? unit.state,
            r: this.getServerUnitHalfSize(),
            b: buffs,
            f: this.FACING_CODES[unit.facing] ?? unit.facing,
            a: this.ANIM_ACTION_CODES[unit.animAction] ?? unit.animAction,
            z: Math.max(0, Math.floor(Number(unit.animStartedAt || 0)))
        };
    }

    serializeServerSim(match) {
        const sim = match.sim;
        return {
            seq: sim.seq,
            frame: sim.frame,
            serverNow: Date.now(),
            state: {
                m: 'f',
                fc: sim.frame,
                p: sim.players.map(player => this.encodeWirePlayer(player)),
                u: sim.units.map(unit => this.encodeWireUnit(unit, sim))
            },
            events: this.getRecentServerEvents(sim)
        };
    }

    buildDeltaStatePayload(match, fullPayload) {
        const currentUnits = Array.isArray(fullPayload?.state?.u) ? fullPayload.state.u : [];
        const previous = match.broadcastUnitCache || new Map();
        const current = new Map();
        const changed = [];

        currentUnits.forEach(unit => {
            const signature = JSON.stringify(unit);
            current.set(unit.i, signature);
            if (previous.get(unit.i) !== signature) changed.push(unit);
        });

        const removed = [];
        previous.forEach((_, unitId) => {
            if (!current.has(unitId)) removed.push(unitId);
        });

        match.broadcastUnitCache = current;

        const shouldSendFull = !match.lastFullStateFrame
            || fullPayload.frame - match.lastFullStateFrame >= this.FULL_SNAPSHOT_EVERY_FRAMES
            || changed.length >= Math.max(8, Math.floor(currentUnits.length * 0.6));

        if (shouldSendFull) {
            match.lastFullStateFrame = fullPayload.frame;
            return fullPayload;
        }

        return {
            seq: fullPayload.seq,
            frame: fullPayload.frame,
            serverNow: fullPayload.serverNow,
            state: {
                m: 'd',
                fc: fullPayload.state.fc,
                p: fullPayload.state.p,
                u: changed,
                r: removed
            },
            events: fullPayload.events
        };
    }

    createBroadcastPayload(match) {
        const fullPayload = this.serializeServerSim(match);
        match.stateSeq = fullPayload.seq;
        match.stateSnapshot = fullPayload;
        return this.buildDeltaStatePayload(match, fullPayload);
    }

    broadcastServerFrame(match) {
        if (!match.sim) return;
        const payload = this.createBroadcastPayload(match);
        this.sendMatchEvent(match, 'match-state', payload);
    }

    endServerMatch(match, reason = 'finished') {
        if (!match || match.ended) return;
        match.ended = true;
        this.broadcastServerFrame(match);
        this.sendMatchEvent(match, 'match-ended', {
            reason,
            state: match.stateSnapshot,
            winnerIndex: match.sim?.players.find(player => !player.eliminated)?.id ?? null
        });
        setTimeout(() => this.removeMatch(match.id), 1500);
    }

    handleMatchBuy(match, userId, unitType) {
        if (!match || !match.started || match.ended) {
            return { ok: false, status: 404, message: 'Match not found' };
        }
        const playerIndex = match.players.findIndex(player => player.id === userId);
        if (playerIndex < 0) return { ok: false, status: 403, message: 'Not in this match' };
        if (!/^[a-zA-Z0-9 _-]{1,40}$/.test(String(unitType || ''))) {
            return { ok: false, status: 400, message: 'Invalid unit type' };
        }

        const serverFrame = match.sim?.frame ?? this.getMatchFrame(match);
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
            const spawned = this.spawnServerUnit(match, playerIndex, payload.unitType);
            if (spawned) {
                match.sim.seq += 1;
                statePayload = this.createBroadcastPayload(match);
                this.sendMatchEvent(match, 'match-state', statePayload);
            }
        }
        this.sendMatchEvent(match, 'match-action', payload);
        return { ok: true, action: payload, state: statePayload };
    }

    spawnServerUnit(match, playerIndex, unitType) {
        const sim = match.sim;
        const player = sim.players[playerIndex];
        const meta = sim.classes.get(unitType);
        if (!player || player.eliminated || !meta) return false;
        const ownedCount = sim.units.filter(unit => unit.owner === playerIndex).length;
        if (ownedCount >= this.SERVER_MAX_UNITS_PER_PLAYER) return false;
        const cost = Number(meta.cost || 0);
        if (player.gold < cost) return false;
        player.gold -= cost;
        const dir = this.getServerForwardDir(playerIndex);
        const spawn = this.findServerSpawnPoint(sim, playerIndex);
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
        this.clampServerUnitPosition(unit);
        sim.units.push(unit);
        const event = { type: 'unit-spawn', frame: sim.frame, unitId: unit.id, unitType, owner: playerIndex, x: unit.x, y: unit.y };
        sim.eventHistory.push(event);
        if (sim.eventHistory.length > this.MAX_SIM_EVENTS) {
            sim.eventHistory.splice(0, sim.eventHistory.length - this.MAX_SIM_EVENTS);
        }
        match.eventHistory = [...(match.eventHistory || []), event].slice(-this.MAX_MATCH_EVENTS);
        return true;
    }

    findServerTarget(sim, unit) {
        const enemies = sim.units
            .filter(other => other.owner !== unit.owner && other.hp > 0)
            .map(other => ({ target: other, distance: this.getServerSurfaceDistance(unit, other) }));
        sim.players.forEach(player => {
            if (!player.eliminated && player.id !== unit.owner) {
                enemies.push({ target: player, distance: this.getServerSurfaceDistance(unit, player) });
            }
        });
        enemies.sort((a, b) => a.distance - b.distance);
        return enemies[0]?.target || null;
    }

    setServerAnim(unit, action, frame) {
        if (unit.animAction !== action || frame - Number(unit.animStartedAt || 0) > 24) {
            unit.animAction = action;
            unit.animStartedAt = frame;
        }
    }

    getServerAttackAnim(unit) {
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

    getServerProjectileSprite(unit, skill = null) {
        const type = String(unit.type || '').toLowerCase();
        if (skill === 'grenade') return 'grenade';
        if (type.includes('bowman')) return 'arrow';
        if (type.includes('mage')) return 'mage_charge';
        if (type.includes('healer')) return 'healer_fire_1';
        if (type.includes('iceman')) return 'iceman_magic_arrow';
        if (type.includes('chilygirl')) return 'chily';
        return null;
    }

    addServerProjectileVisual(match, unit, target, skill = null) {
        const sim = match.sim;
        if (!sim) return;
        const point = this.getServerTargetPoint(target);
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
            sprite: this.getServerProjectileSprite(unit, skill),
            explosionRadius: skill === 'grenade' ? 28 : 0
        };
        sim.pendingVisualEvents.push(event);
        if (sim.pendingVisualEvents.length > this.MAX_VISUAL_EVENTS) {
            sim.pendingVisualEvents.splice(0, sim.pendingVisualEvents.length - this.MAX_VISUAL_EVENTS);
        }
        this.sendMatchEvent(match, 'match-visual', event);
    }

    addServerVfxVisual(match, x, y, text, color = '#fff') {
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
        if (sim.pendingVisualEvents.length > this.MAX_VISUAL_EVENTS) {
            sim.pendingVisualEvents.splice(0, sim.pendingVisualEvents.length - this.MAX_VISUAL_EVENTS);
        }
        this.sendMatchEvent(match, 'match-visual', event);
    }

    applyServerAreaDamage(match, unit, center, radius, amount, damageType, label) {
        const sim = match.sim;
        sim.units.forEach(target => {
            if (target.owner === unit.owner || target.hp <= 0) return;
            if (this.serverDist(target, center) > radius) return;
            this.applyServerDamage(match, unit, target, amount, damageType, label);
        });
    }

    tryServerSkill(match, unit, target) {
        const sim = match.sim;
        if (unit.skillCooldown > 0 || unit.maxMana <= 0) return false;
        const lower = String(unit.type || '').toLowerCase();

        if (lower.includes('iceman') && unit.mana >= 60) {
            unit.mana -= 60;
            unit.skillCooldown = 120;
            this.setServerAnim(unit, 'charge_2', sim.frame);
            const targets = sim.units
                .filter(other => other.owner !== unit.owner && other.hp > 0)
                .map(other => ({ unit: other, distance: this.serverDist(unit, other) }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 3)
                .map(entry => entry.unit);
            targets.forEach(enemy => {
                enemy.frozenUntil = Math.max(enemy.frozenUntil || 0, sim.frame + 120);
                this.applyServerDamage(match, unit, enemy, 20, 'true', 'frost');
                this.addServerVfxVisual(match, enemy.x, enemy.y - 20, 'FROST', '#7dd3fc');
            });
            return true;
        }

        if ((lower.includes('gunman') || lower.includes('gunner')) && unit.mana >= 60 && target) {
            unit.mana -= 60;
            unit.skillCooldown = 240;
            this.setServerAnim(unit, 'attack', sim.frame);
            this.addServerProjectileVisual(match, unit, target, 'grenade');
            this.applyServerAreaDamage(match, unit, this.getServerTargetPoint(target), 48, Number(unit.meta.dmg || 1) * 1.8, 'physical', 'grenade');
            return true;
        }

        if (lower.includes('mage') && unit.mana >= 80 && target) {
            unit.mana -= 80;
            unit.skillCooldown = 240;
            this.setServerAnim(unit, 'attack_2', sim.frame);
            this.addServerProjectileVisual(match, unit, target, 'fire');
            this.applyServerAreaDamage(match, unit, this.getServerTargetPoint(target), 70, 55, 'magic', 'fire');
            this.addServerVfxVisual(match, this.getServerTargetPoint(target).x, this.getServerTargetPoint(target).y - 18, 'FIRE', '#f97316');
            return true;
        }

        if (lower.includes('guard') && unit.mana >= 80) {
            unit.mana -= 80;
            unit.skillCooldown = 420;
            unit.hp = Math.min(unit.maxHp * 1.4, unit.hp + unit.maxHp * 0.35);
            this.setServerAnim(unit, 'protect', sim.frame);
            this.addServerVfxVisual(match, unit.x, unit.y - 24, 'PROTECT', '#94a3b8');
            return true;
        }

        if (lower.includes('chilygirl') && unit.mana >= 70 && target) {
            unit.mana -= 70;
            unit.skillCooldown = 240;
            this.setServerAnim(unit, 'attack', sim.frame);
            this.addServerProjectileVisual(match, unit, target, 'chily_big');
            this.applyServerAreaDamage(match, unit, this.getServerTargetPoint(target), 60, Number(unit.meta.dmg || 1) * 3, 'true', 'big_chili');
            this.addServerVfxVisual(match, this.getServerTargetPoint(target).x, this.getServerTargetPoint(target).y - 18, 'CHILI', '#fb7185');
            return true;
        }

        if (lower.includes('assassin') && unit.mana >= 80) {
            const dashTarget = sim.units
                .filter(other => other.owner !== unit.owner && other.hp > 0 && this.serverDist(unit, other) <= 300)
                .sort((a, b) => this.serverDist(unit, b) - this.serverDist(unit, a))[0];
            if (!dashTarget) return false;
            unit.mana -= 80;
            unit.skillCooldown = 300;
            const side = unit.facing === 'left' ? 1 : -1;
            unit.x = dashTarget.x + side * 28;
            unit.y = dashTarget.y;
            this.setServerAnim(unit, 'attack_3', sim.frame);
            unit.dodgeBoostUntil = sim.frame + 180;
            unit.lifestealBoostUntil = sim.frame + 180;
            this.addServerVfxVisual(match, unit.x, unit.y - 20, 'DASH', '#f43f5e');
            return true;
        }

        if (lower.includes('healer') && unit.mana >= 80) {
            const ally = sim.units
                .filter(other => other.owner === unit.owner && other.id !== unit.id && other.hp < other.maxHp)
                .sort((a, b) => (a.hp / a.maxHp) - (b.hp / b.maxHp))[0];
            if (!ally) return false;
            unit.mana -= 80;
            unit.skillCooldown = 240;
            this.setServerAnim(unit, 'attack_3', sim.frame);
            this.addServerProjectileVisual(match, unit, ally, 'heal');
            const amount = Math.max(35, Number(unit.meta.dmg || 1) * 8);
            ally.hp = Math.min(ally.maxHp, ally.hp + amount);
            this.addServerVfxVisual(match, ally.x, ally.y - 18, `+${Math.floor(amount)}`, '#22c55e');
            return true;
        }

        if (lower.includes('bowman') && unit.mana >= 40) {
            unit.mana -= 40;
            unit.skillCooldown = 300;
            unit.penBoostUntil = sim.frame + 180;
            this.setServerAnim(unit, 'attack_3', sim.frame);
            this.addServerVfxVisual(match, unit.x, unit.y - 20, 'FOCUS', '#fbbf24');
            return true;
        }

        return false;
    }

    updateServerSim(match) {
        const sim = match.sim;
        if (!sim || match.ended) return;
        sim.frame += 1;

        sim.players.forEach(player => {
            if (!player.eliminated) player.gold += this.SERVER_GOLD_RATE;
        });

        while (sim.commands.length) {
            const command = sim.commands.shift();
            if (command.type === 'buy') this.spawnServerUnit(match, command.playerIndex, command.unitType);
        }

        sim.units.forEach(unit => {
            if (unit.cooldown > 0) unit.cooldown -= 1;
            if (unit.skillCooldown > 0) unit.skillCooldown -= 1;
            if (sim.frame % this.SERVER_MANA_REGEN_INTERVAL_FRAMES === 0) {
                unit.hp = Math.min(unit.maxHp, unit.hp + 1);
                unit.mana = Math.min(unit.maxMana, unit.mana + this.SERVER_MANA_REGEN_AMOUNT);
            }
            if (unit.frozenUntil && unit.frozenUntil > sim.frame) {
                unit.state = 'frozen';
                unit.behavior = 'crowd_controlled';
                unit.currentTarget = null;
                unit.targetDistance = 0;
                this.setServerAnim(unit, 'idle', sim.frame);
                return;
            }

            const target = this.findServerTarget(sim, unit);
            if (!target) {
                unit.state = 'idle';
                unit.behavior = 'idle';
                unit.currentTarget = null;
                unit.targetDistance = 0;
                this.setServerAnim(unit, 'idle', sim.frame);
                return;
            }

            const targetPoint = this.getServerTargetPoint(target);
            const range = Number(unit.meta.range || 25);
            const distance = this.getServerSurfaceDistance(unit, target);
            const dir = Math.sign(targetPoint.x - unit.x) || this.getServerForwardDir(unit.owner);
            unit.facing = dir > 0 ? 'right' : 'left';
            unit.currentTarget = this.snapshotServerTarget(target);
            unit.targetDistance = distance;

            if (distance <= range) {
                unit.state = 'fight';
                unit.behavior = 'engaging';
                if (this.tryServerSkill(match, unit, target)) return;
                if (unit.cooldown <= 0) {
                    const atkSpeed = Math.max(0.1, Number(unit.meta.atk_speed || 1));
                    unit.cooldown = Math.max(1, Math.floor(this.MATCH_FPS / atkSpeed));
                    unit.behavior = 'attacking';
                    this.setServerAnim(unit, this.getServerAttackAnim(unit), sim.frame);
                    const berserk = unit.berserkUntil && unit.berserkUntil > sim.frame ? 1.6 : 1;
                    if (range >= 35) this.addServerProjectileVisual(match, unit, target);
                    this.applyServerDamage(match, unit, target, Number(unit.meta.dmg || 1) * berserk, unit.meta.dmg_type || 'physical');
                }
            } else {
                unit.state = 'march';
                unit.behavior = 'moving';
                this.setServerAnim(unit, 'walk', sim.frame);
                unit.x += dir * Number(unit.meta.move_speed || 1);
                this.clampServerUnitPosition(unit);
            }
        });

        this.resolveServerUnitSpacing(sim);

        for (let i = sim.units.length - 1; i >= 0; i--) {
            const unit = sim.units[i];
            if (unit.hp > 0) continue;
            const killer = sim.players[unit.lastAttacker];
            if (killer) killer.gold += Number(unit.meta.cost || 0) * 0.3;
            const event = { type: 'unit-death', frame: sim.frame, unitId: unit.id, unitType: unit.type, owner: unit.owner, killerOwner: unit.lastAttacker };
            sim.eventHistory.push(event);
            if (sim.eventHistory.length > this.MAX_SIM_EVENTS) {
                sim.eventHistory.splice(0, sim.eventHistory.length - this.MAX_SIM_EVENTS);
            }
            match.eventHistory = [...(match.eventHistory || []), event].slice(-this.MAX_MATCH_EVENTS);
            sim.units.splice(i, 1);
        }

        sim.players.forEach(player => {
            if (!player.eliminated && player.hp <= 0) {
                player.eliminated = true;
                const event = { type: 'player-eliminated', frame: sim.frame, playerIndex: player.id, playerName: player.name };
                sim.eventHistory.push(event);
                if (sim.eventHistory.length > this.MAX_SIM_EVENTS) {
                    sim.eventHistory.splice(0, sim.eventHistory.length - this.MAX_SIM_EVENTS);
                }
                match.eventHistory = [...(match.eventHistory || []), event].slice(-this.MAX_MATCH_EVENTS);
            }
        });

        sim.seq += 1;
        if (sim.frame % this.MATCH_BROADCAST_EVERY_FRAMES === 0) this.broadcastServerFrame(match);
        const activePlayers = sim.players.filter(player => !player.eliminated);
        if (activePlayers.length <= 1) this.endServerMatch(match, 'finished');
    }

    startServerSimulation(match) {
        if (match.simTimer) clearInterval(match.simTimer);
        match.sim = this.createServerSim(match);
        match.simTimer = setInterval(() => this.updateServerSim(match), 1000 / this.MATCH_FPS);
        match.simTimer.unref?.();
    }

    getMatchPayload(match, userId) {
        return {
            matchId: match.id,
            playerIndex: match.players.findIndex(player => player.id === userId),
            players: match.players.map(player => ({ id: player.id, username: player.username })),
            seed: match.seed,
            startsAt: match.startsAt,
            serverNow: Date.now(),
            confirmedFrame: this.getConfirmedFrame(match),
            units: match.units || null
        };
    }

    async getUnitSnapshot() {
        try {
            const [units] = await this.pool.query('SELECT * FROM units ORDER BY id ASC');
            return units;
        } catch (err) {
            console.warn('[Match] Unable to capture unit snapshot:', err.message);
            return null;
        }
    }

    removeMatch(matchId) {
        const match = this.matches.get(matchId);
        if (!match) return;
        match.clients.forEach(client => client.end());
        if (match.simTimer) clearInterval(match.simTimer);
        this.matches.delete(matchId);
        const waitingIdx = this.waitingMatches.findIndex(id => id === matchId);
        if (waitingIdx >= 0) this.waitingMatches.splice(waitingIdx, 1);
    }

    cleanupExpiredMatches() {
        const now = Date.now();
        this.matches.forEach(match => {
            if (now - match.createdAt > this.MATCH_TTL_MS) this.removeMatch(match.id);
        });
    }

    async joinMatch(user) {
        for (const match of this.matches.values()) {
            if (!match.ended && match.players.some(player => player.id === user.id)) {
                return { status: match.started ? 'started' : 'waiting', ...this.getMatchPayload(match, user.id) };
            }
        }

        const waitingId = this.waitingMatches.shift();
        const waitingMatch = waitingId ? this.matches.get(waitingId) : null;
        if (waitingMatch && waitingMatch.players.length === 1 && waitingMatch.players[0].id !== user.id) {
            waitingMatch.players.push(user);
            waitingMatch.started = true;
            waitingMatch.startsAt = Date.now() + this.MATCH_START_DELAY_MS;
            this.startServerSimulation(waitingMatch);
            this.sendMatchEvent(waitingMatch, 'match-start', { ...this.getMatchPayload(waitingMatch, waitingMatch.players[0].id), playerIndex: 0 });
            return { status: 'started', ...this.getMatchPayload(waitingMatch, user.id) };
        }

        const match = {
            id: this.makeMatchId(),
            players: [user],
            clients: new Map(),
            wsClients: new Map(),
            seed: Math.floor(Math.random() * 0xffffffff),
            units: await this.getUnitSnapshot(),
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
        this.matches.set(match.id, match);
        this.waitingMatches.push(match.id);
        return { status: 'waiting', ...this.getMatchPayload(match, user.id) };
    }

    openStream(req, res, verifyToken) {
        let decoded;
        try {
            decoded = verifyToken(String(req.query.token || ''));
        } catch (err) {
            res.status(401).end();
            return;
        }

        const match = this.matches.get(String(req.query.matchId || ''));
        if (!match || !match.players.some(player => player.id === decoded.id)) {
            res.status(404).end();
            return;
        }

        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders?.();
        res.write(': connected\n\n');
        match.clients.set(decoded.id, res);

        if (match.started) {
            res.write(`event: match-start\ndata: ${JSON.stringify(this.getMatchPayload(match, decoded.id))}\n\n`);
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
                serverFrame: this.getMatchFrame(match),
                confirmedFrame: this.getConfirmedFrame(match),
                lastActionId: Number(match.nextActionId || 1) - 1,
                actions: (match.actionLog || []).slice(-50)
            })}\n\n`);
        }, 250);

        req.on('close', () => {
            clearInterval(syncTimer);
            if (match.clients.get(decoded.id) === res) match.clients.delete(decoded.id);
            this.sendMatchEvent(match, 'player-disconnected', { userId: decoded.id });
        });
    }

    performAction(matchId, userId, body) {
        const match = this.matches.get(String(matchId || ''));
        if (String(body.type || '') !== 'buy') {
            return { ok: false, status: 400, message: 'Invalid match action' };
        }
        return this.handleMatchBuy(match, userId, String(body.unitType || ''));
    }

    publishState(matchId, userId, body) {
        const match = this.matches.get(String(matchId || ''));
        if (!match || !match.started || match.ended) {
            return { ok: false, status: 404, message: 'Match not found' };
        }

        const playerIndex = match.players.findIndex(player => player.id === userId);
        if (playerIndex !== 0) {
            return { ok: false, status: 403, message: 'Only the authoritative simulator can publish state' };
        }

        const seq = Number(body.seq || 0);
        const frame = Number(body.frame || 0);
        const state = body.state;
        const events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
        if (!Number.isFinite(seq) || !Number.isFinite(frame) || !state || typeof state !== 'object') {
            return { ok: false, status: 400, message: 'Invalid match state' };
        }
        if (seq <= Number(match.stateSeq || 0)) {
            return { ok: true, ignored: true };
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
            }))].slice(-this.MAX_MATCH_EVENTS);
        }
        match.players.forEach((player, idx) => {
            if (idx !== 0) this.sendMatchEventToPlayer(match, player.id, 'match-state', payload);
        });
        return { ok: true };
    }

    pingMatch(matchId, userId, clientSentAt) {
        const match = this.matches.get(String(matchId || ''));
        if (!match || !match.players.some(player => player.id === userId)) {
            return { ok: false, status: 404, message: 'Match not found' };
        }
        return {
            ok: true,
            matchId: match.id,
            serverNow: Date.now(),
            clientSentAt: Number(clientSentAt || 0)
        };
    }

    leaveMatch(matchId, userId) {
        const match = this.matches.get(String(matchId || ''));
        if (match && match.players.some(player => player.id === userId)) {
            match.ended = true;
            this.sendMatchEvent(match, 'match-ended', { reason: 'left', userId });
            setTimeout(() => this.removeMatch(match.id), 1000);
        }
        return { ok: true };
    }

    handleSocketConnection(socket, req, verifyToken) {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        let decoded;
        try {
            decoded = verifyToken(String(url.searchParams.get('token') || ''));
        } catch (err) {
            socket.close(1008, 'Unauthorized');
            return;
        }

        const match = this.matches.get(String(url.searchParams.get('matchId') || ''));
        if (!match || !match.players.some(player => player.id === decoded.id)) {
            socket.close(1008, 'Match not found');
            return;
        }

        match.wsClients.set(decoded.id, socket);
        socket.send(JSON.stringify({ event: 'ws-ready', payload: this.getMatchPayload(match, decoded.id) }));
        if (match.started) {
            socket.send(JSON.stringify({ event: 'match-start', payload: this.getMatchPayload(match, decoded.id) }));
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
                const result = this.handleMatchBuy(match, decoded.id, message.unitType);
                socket.send(JSON.stringify({ event: 'command-result', payload: { requestId: message.requestId || null, ...result } }));
                return;
            }

            if (message.type === 'leave') {
                match.ended = true;
                this.sendMatchEvent(match, 'match-ended', { reason: 'left', userId: decoded.id });
                setTimeout(() => this.removeMatch(match.id), 1000);
            }
        });

        socket.on('close', () => {
            if (match.wsClients?.get(decoded.id) === socket) match.wsClients.delete(decoded.id);
        });
    }
}

module.exports = { MatchService };
