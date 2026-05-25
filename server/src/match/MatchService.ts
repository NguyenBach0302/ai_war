type AnyObject = Record<string, any>;

export class MatchService {
    private pool: AnyObject;
    private WebSocket: AnyObject;
    private readonly MATCH_START_DELAY_MS = 3000;
    private readonly MATCH_TTL_MS = 1000 * 60 * 60;
    private readonly MATCH_FPS = 60;
    private readonly MATCH_ACTION_DELAY_FRAMES = 0;
    private readonly MATCH_BROADCAST_EVERY_FRAMES_LOW_LOAD = 2;
    private readonly MATCH_BROADCAST_EVERY_FRAMES = 4;
    private readonly MATCH_BROADCAST_EVERY_FRAMES_HIGH_LOAD = 6;
    private readonly MATCH_BROADCAST_EVERY_FRAMES_VERY_HIGH_LOAD = 8;
    private readonly FULL_SNAPSHOT_EVERY_FRAMES = 60;
    private readonly SERVER_GOLD_RATE = 0.15;
    private readonly SERVER_MAP_W = 2400;
    private readonly SERVER_LANE_Y = 382;
    private readonly SERVER_ROAD_HALF_WIDTH = 120;
    private readonly SERVER_BASE_R = 62;
    private readonly SERVER_UNIT_SIZE = 10;
    private readonly SERVER_UNIT_HALF_SIZE = this.SERVER_UNIT_SIZE / 2;
    private readonly SERVER_FORMATION_LANE_OFFSETS = [-45, -35, -25, -15, -5, 5, 15, 25, 35, 45];
    private readonly SERVER_MARCH_STEER_INTERVAL = 10;
    private readonly SERVER_MARCH_STEER_STEP = 12;
    private readonly SERVER_MARCH_STEER_LIMIT = 64;
    private readonly SERVER_MAX_UNITS_PER_PLAYER = 50;
    private readonly SERVER_MANA_REGEN_INTERVAL_FRAMES = 60;
    private readonly SERVER_MANA_REGEN_AMOUNT = 4;
    private readonly MAX_MATCH_EVENTS = 256;
    private readonly MAX_SIM_EVENTS = 128;
    private readonly MAX_VISUAL_EVENTS = 96;
    private readonly UNIT_TYPE_CODES: Record<string, number> = {
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
    private readonly UNIT_STATE_CODES: Record<string, number> = {
        idle: 0,
        march: 1,
        fight: 2,
        frozen: 3
    };
    private readonly FACING_CODES: Record<string, number> = {
        left: 0,
        right: 1
    };
    private readonly BUFF_TYPE_CODES: Record<string, number> = {
        dodge: 1,
        lifesteal: 2,
        crit_chance: 3,
        phys_pen: 4,
        invulnerable: 5,
        atk_speed_mult: 6,
        no_mana_regen: 7
    };
    private readonly ANIM_ACTION_CODES: Record<string, number> = {
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
    private waitingMatches: string[] = [];
    private matches = new Map<string, AnyObject>();
    private cleanupTimer: NodeJS.Timeout;

    constructor({ pool, WebSocketClass }: { pool: AnyObject; WebSocketClass: AnyObject }) {
        this.pool = pool;
        this.WebSocket = WebSocketClass;
        this.cleanupTimer = setInterval(() => this.cleanupExpiredMatches(), 1000 * 60 * 10);
        this.cleanupTimer.unref?.();
    }

    makeMatchId(): string {
        return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    }

    sendMatchEvent(match: AnyObject, event: string, payload: AnyObject): void {
        const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
        match.clients.forEach((client: AnyObject) => client.write(data));
        (match.wsClients || new Map()).forEach((socket: AnyObject) => {
            if (socket.readyState !== this.WebSocket.OPEN) return;
            if (event === 'match-state') {
                socket.send(this.encodeBinaryMatchState(payload));
                return;
            }
            const wsData = JSON.stringify({ event, payload });
            socket.send(wsData);
        });
    }

    getMatchFrame(match: AnyObject): number {
        if (!match.startsAt) return 0;
        return Math.max(0, Math.floor((Date.now() - match.startsAt) / 1000 * this.MATCH_FPS));
    }

    getConfirmedFrame(match: AnyObject): number {
        return Math.max(0, this.getMatchFrame(match) - this.MATCH_ACTION_DELAY_FRAMES);
    }

    sendMatchEventToPlayer(match: AnyObject, userId: number, event: string, payload: AnyObject): void {
        const client = match.clients.get(userId);
        if (client) client.write(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`);
        const socket = match.wsClients?.get(userId);
        if (socket?.readyState === this.WebSocket.OPEN) socket.send(JSON.stringify({ event, payload }));
    }

    getServerBaseForPlayer(idx: number): AnyObject {
        return {
            x: idx === 0 ? 130 : this.SERVER_MAP_W - 130,
            y: this.SERVER_LANE_Y,
            r: this.SERVER_BASE_R
        };
    }

    getServerForwardDir(owner: number): number {
        return owner === 0 ? 1 : -1;
    }

    serverDist(a: AnyObject, b: AnyObject): number {
        return Math.hypot(a.x - b.x, a.y - b.y);
    }

    getServerUnitHalfSize(): number {
        return this.SERVER_UNIT_HALF_SIZE;
    }

    getServerTargetRadius(target: AnyObject): number {
        return target?.base ? Number(target.base.r || this.SERVER_BASE_R) : this.getServerUnitHalfSize();
    }

    getServerTargetPoint(target: AnyObject): AnyObject {
        return target.base ? target.base : target;
    }

    getServerSurfaceDistance(unit: AnyObject, target: AnyObject): number {
        const point = this.getServerTargetPoint(target);
        return Math.max(0, this.serverDist(unit, point) - this.getServerUnitHalfSize() - this.getServerTargetRadius(target));
    }

    clampServerUnitPosition(unit: AnyObject): void {
        const minX = this.getServerBaseForPlayer(0).x + this.SERVER_BASE_R + this.SERVER_UNIT_HALF_SIZE;
        const maxX = this.getServerBaseForPlayer(1).x - this.SERVER_BASE_R - this.SERVER_UNIT_HALF_SIZE;
        const minY = this.SERVER_LANE_Y - this.SERVER_ROAD_HALF_WIDTH + this.SERVER_UNIT_HALF_SIZE;
        const maxY = this.SERVER_LANE_Y + this.SERVER_ROAD_HALF_WIDTH - this.SERVER_UNIT_HALF_SIZE;
        unit.x = Math.min(maxX, Math.max(minX, Number(unit.x || 0)));
        unit.y = Math.min(maxY, Math.max(minY, Number.isFinite(Number(unit.y)) ? Number(unit.y) : this.SERVER_LANE_Y));
    }

    chooseServerMarchY(sim: AnyObject, unit: AnyObject, preferredY: number, dir: number): number {
        const minY = this.SERVER_LANE_Y - this.SERVER_ROAD_HALF_WIDTH + this.SERVER_UNIT_HALF_SIZE;
        const maxY = this.SERVER_LANE_Y + this.SERVER_ROAD_HALF_WIDTH - this.SERVER_UNIT_HALF_SIZE;
        const baseY = Math.min(maxY, Math.max(minY, Number(preferredY || this.SERVER_LANE_Y)));
        if (!Number.isFinite(unit.marchTargetY)) unit.marchTargetY = Math.min(maxY, Math.max(minY, Number(unit.y || baseY)));
        if (Number(unit.marchRetargetCooldown || 0) > 0) {
            unit.marchRetargetCooldown -= 1;
            return unit.marchTargetY;
        }

        let upperBias = 0;
        let lowerBias = 0;
        let frontBlockers = 0;
        sim.units.forEach((other: AnyObject) => {
            if (other === unit || other.hp <= 0) return;
            const dx = (Number(other.x || 0) - Number(unit.x || 0)) * dir;
            if (dx < -10 || dx > 28) return;
            const dy = Number(other.y || 0) - Number(unit.y || 0);
            if (Math.abs(dy) > 24) return;
            frontBlockers += 1;
            const weight = (32 - Math.min(32, dx + 10)) * (26 - Math.abs(dy));
            if (dy <= 0) upperBias += weight * (other.owner === unit.owner ? 1.15 : 0.85);
            if (dy >= 0) lowerBias += weight * (other.owner === unit.owner ? 1.15 : 0.85);
        });

        let steer = 0;
        if (frontBlockers > 0) {
            const imbalance = lowerBias - upperBias;
            if (Math.abs(imbalance) > 40) steer = imbalance > 0 ? -1 : 1;
            else steer = (unit.lastMarchSteerDir || 1) * -1;
        } else {
            const returnDelta = baseY - unit.marchTargetY;
            if (Math.abs(returnDelta) > 10) steer = Math.sign(returnDelta);
        }

        const nextTarget = steer === 0
            ? unit.marchTargetY
            : Math.min(maxY, Math.max(minY, Math.max(baseY - this.SERVER_MARCH_STEER_LIMIT, Math.min(baseY + this.SERVER_MARCH_STEER_LIMIT, unit.marchTargetY + steer * this.SERVER_MARCH_STEER_STEP))));
        if (steer !== 0) unit.lastMarchSteerDir = steer;
        unit.marchTargetY = Math.abs(nextTarget - baseY) < 4 && frontBlockers === 0 ? baseY : nextTarget;
        unit.marchRetargetCooldown = frontBlockers > 0 ? this.SERVER_MARCH_STEER_INTERVAL : Math.max(4, Math.floor(this.SERVER_MARCH_STEER_INTERVAL * 0.5));
        return unit.marchTargetY;
    }

    getServerFormationPosition(player: AnyObject, playerIndex: number, row = 0, column = 0): AnyObject {
        const dir = this.getServerForwardDir(playerIndex);
        const offset = this.SERVER_FORMATION_LANE_OFFSETS[column] ?? 0;
        return {
            x: player.base.x + dir * (player.base.r + this.SERVER_UNIT_HALF_SIZE + row * this.SERVER_UNIT_SIZE),
            y: this.SERVER_LANE_Y + offset
        };
    }

    buildServerSpatialIndex(sim: AnyObject): AnyObject {
        const cellSize = Math.max(24, this.SERVER_UNIT_SIZE * 2);
        const cells = new Map<string, AnyObject[]>();
        const byOwner = sim.players.map(() => []);
        sim.units.forEach((unit: AnyObject) => {
            if (unit.hp <= 0) return;
            const cellX = Math.floor(Number(unit.x || 0) / cellSize);
            const cellY = Math.floor(Number(unit.y || 0) / cellSize);
            const key = `${cellX}:${cellY}`;
            const bucket = cells.get(key);
            if (bucket) bucket.push(unit);
            else cells.set(key, [unit]);
            byOwner[unit.owner]?.push(unit);
        });
        byOwner.forEach((units: AnyObject[]) => units.sort((a, b) => Number(a.x || 0) - Number(b.x || 0)));
        sim.spatialIndex = { cellSize, cells, byOwner };
        return sim.spatialIndex;
    }

    queryServerSpatialUnits(sim: AnyObject, x: number, y: number, radius: number, predicate: ((unit: AnyObject) => boolean) | null = null): AnyObject[] {
        const index = sim?.spatialIndex || this.buildServerSpatialIndex(sim);
        const cellRadius = Math.ceil(radius / index.cellSize);
        const originX = Math.floor(Number(x || 0) / index.cellSize);
        const originY = Math.floor(Number(y || 0) / index.cellSize);
        const seen = new Set<string>();
        const result: AnyObject[] = [];
        for (let cx = originX - cellRadius; cx <= originX + cellRadius; cx++) {
            for (let cy = originY - cellRadius; cy <= originY + cellRadius; cy++) {
                const bucket = index.cells.get(`${cx}:${cy}`);
                if (!bucket) continue;
                bucket.forEach((unit: AnyObject) => {
                    if (seen.has(unit.id)) return;
                    seen.add(unit.id);
                    if (this.serverDist({ x, y }, unit) > radius) return;
                    if (predicate && !predicate(unit)) return;
                    result.push(unit);
                });
            }
        }
        return result;
    }

    findServerUnitsNearX(units: AnyObject[], x: number): number {
        let low = 0;
        let high = units.length;
        while (low < high) {
            const mid = (low + high) >> 1;
            if (Number(units[mid].x || 0) < x) low = mid + 1;
            else high = mid;
        }
        return low;
    }

    findServerSpawnPoint(sim: AnyObject, playerIndex: number): AnyObject {
        const player = sim.players[playerIndex];
        const columns = this.SERVER_FORMATION_LANE_OFFSETS.length;
        const maxRows = Math.ceil(this.SERVER_MAX_UNITS_PER_PLAYER / columns) + 4;
        for (let row = 0; row < maxRows; row++) {
            for (let column = 0; column < columns; column++) {
                const candidate = this.getServerFormationPosition(player, playerIndex, row, column);
                const blocked = sim.units.some((other: AnyObject) => this.serverDist(other, candidate) < this.SERVER_UNIT_SIZE);
                if (!blocked) return candidate;
            }
        }
        return this.getServerFormationPosition(player, playerIndex, maxRows, 0);
    }

    resolveServerUnitSpacing(sim: AnyObject): void {
        if (!sim?.units?.length) return;
        const minDistance = this.SERVER_UNIT_SIZE;
        for (let pass = 0; pass < 6; pass++) {
            let changed = false;
            const index = this.buildServerSpatialIndex(sim);
            const handledPairs = new Set<string>();
            index.cells.forEach((bucket: AnyObject[]) => {
                bucket.forEach((a: AnyObject) => {
                    const cellX = Math.floor(Number(a.x || 0) / index.cellSize);
                    const cellY = Math.floor(Number(a.y || 0) / index.cellSize);
                    for (let dxCell = -1; dxCell <= 1; dxCell++) {
                        for (let dyCell = -1; dyCell <= 1; dyCell++) {
                            const neighbor = index.cells.get(`${cellX + dxCell}:${cellY + dyCell}`);
                            if (!neighbor) continue;
                            neighbor.forEach((b: AnyObject) => {
                                if (a === b) return;
                                const pairKey = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
                                if (handledPairs.has(pairKey)) return;
                                handledPairs.add(pairKey);
                                const dx = Number(b.x || 0) - Number(a.x || 0);
                                const dy = Number(b.y || 0) - Number(a.y || 0);
                                const distance = Math.hypot(dx, dy);
                                if (distance >= minDistance) return;
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
                            });
                        }
                    }
                });
            });
            if (!changed) break;
        }
    }

    getServerDamage(attacker: AnyObject, target: AnyObject, baseDmg: number, type: string): number {
        if (type === 'true' || !target.meta) return baseDmg;
        const armorValue = type === 'magic' ? Number(target.meta.mres || 0) : Number(target.meta.armor || 0);
        const pen = type === 'magic' ? Number(attacker.meta.magic_pen || 0) : Number(attacker.meta.phys_pen || 0);
        const effective = Math.max(0, armorValue * (1 - pen));
        const reduction = effective <= 50
            ? effective * 0.01
            : Math.min(0.99, 0.5 + 0.5 * (1 - Math.pow(0.5, (effective - 50) / 50)));
        return baseDmg * (1 - reduction);
    }

    calculateServerDamage(sim: AnyObject, attacker: AnyObject, target: AnyObject, baseDmg: number, type: string): AnyObject {
        if (target.chilyShieldUntil && target.chilyShieldUntil > sim.frame) {
            return { amount: 0, dodged: false, isCrit: false };
        }
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

    pushServerEvent(match: AnyObject, event: AnyObject): AnyObject {
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

    snapshotServerTarget(target: AnyObject): AnyObject {
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

    getRecentServerEvents(sim: AnyObject, limit = 80): AnyObject[] {
        if (!sim) return [];
        const gameplayEvents = sim.eventHistory.slice(-limit);
        const visualEvents = sim.pendingVisualEvents.slice(-limit);
        return [...gameplayEvents, ...visualEvents]
            .sort((a, b) => Number(a.frame || 0) - Number(b.frame || 0))
            .slice(-limit);
    }

    getBroadcastEveryFrames(sim: AnyObject): number {
        const unitCount = Array.isArray(sim?.units) ? sim.units.length : 0;
        if (unitCount >= 70) return this.MATCH_BROADCAST_EVERY_FRAMES_VERY_HIGH_LOAD;
        if (unitCount >= 40) return this.MATCH_BROADCAST_EVERY_FRAMES_HIGH_LOAD;
        if (unitCount <= 16) return this.MATCH_BROADCAST_EVERY_FRAMES_LOW_LOAD;
        return this.MATCH_BROADCAST_EVERY_FRAMES;
    }

    applyServerDamage(match: AnyObject, attacker: AnyObject, target: AnyObject, baseDmg: number, type: string, skill: string | null = null): AnyObject {
        const sim = match.sim;
        const result = this.calculateServerDamage(sim, attacker, target, baseDmg, type);
        if (!result.dodged) {
            target.hp -= result.amount;
            if (!target.base) target.lastAttacker = attacker.owner;
            if (target.base && result.amount > 0) attacker.baseAttackLockOwner = target.id;
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

    createServerSim(match: AnyObject): AnyObject {
        const unitRows = Array.isArray(match.units) ? match.units : [];
        const classes = new Map(unitRows.map((unit: AnyObject) => [unit.name, unit]));
        return {
            frame: 0,
            seq: 0,
            nextUnitId: 1,
            rngState: Number(match.seed || 1) >>> 0 || 1,
            commands: [],
            classes,
            players: match.players.map((player: AnyObject, idx: number) => ({
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

    serverRng(sim: AnyObject): number {
        sim.rngState = (sim.rngState * 1664525 + 1013904223) >>> 0;
        return sim.rngState / 0x100000000;
    }

    roundForWire(value: number, decimals = 1): number {
        const factor = 10 ** decimals;
        return Math.round(Number(value || 0) * factor) / factor;
    }

    encodeWireBuff(buff: AnyObject): AnyObject {
        return {
            t: this.BUFF_TYPE_CODES[buff.type] ?? buff.type,
            v: this.roundForWire(buff.value, 2),
            d: Math.max(0, Math.floor(Number(buff.duration || 0)))
        };
    }

    encodeWirePlayer(player: AnyObject): AnyObject {
        return {
            i: player.id,
            g: this.roundForWire(player.gold, 2),
            h: this.roundForWire(player.hp, 2),
            H: this.roundForWire(player.maxHp, 2),
            e: player.eliminated ? 1 : 0
        };
    }

    encodeWireUnit(unit: AnyObject, sim: AnyObject): AnyObject {
        const buffs = [
            ...(unit.dodgeBoostUntil && unit.dodgeBoostUntil > sim.frame ? [{ type: 'dodge', value: 0.5, duration: unit.dodgeBoostUntil - sim.frame }] : []),
            ...(unit.lifestealBoostUntil && unit.lifestealBoostUntil > sim.frame ? [{ type: 'lifesteal', value: 0.5, duration: unit.lifestealBoostUntil - sim.frame }] : []),
            ...(unit.critBoostUntil && unit.critBoostUntil > sim.frame ? [{ type: 'crit_chance', value: 0.5, duration: unit.critBoostUntil - sim.frame }] : []),
            ...(unit.penBoostUntil && unit.penBoostUntil > sim.frame ? [{ type: 'phys_pen', value: 0.15, duration: unit.penBoostUntil - sim.frame }] : []),
            ...(unit.chilyShieldUntil && unit.chilyShieldUntil > sim.frame ? [{ type: 'invulnerable', value: 0, duration: unit.chilyShieldUntil - sim.frame }] : []),
            ...(unit.chilyAttackSpeedUntil && unit.chilyAttackSpeedUntil > sim.frame ? [{ type: 'atk_speed_mult', value: 3, duration: unit.chilyAttackSpeedUntil - sim.frame }] : []),
            ...(unit.chilyNoManaRegenUntil && unit.chilyNoManaRegenUntil > sim.frame ? [{ type: 'no_mana_regen', value: 0, duration: unit.chilyNoManaRegenUntil - sim.frame }] : [])
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

    parseWireUnitId(unitId: string, ownerFallback = 0): { owner: number; index: number } {
        const text = String(unitId || '');
        const match = /^s(\d+)_(\d+)$/.exec(text);
        if (!match) return { owner: ownerFallback, index: 0 };
        return {
            owner: Number(match[1] || ownerFallback),
            index: Number(match[2] || 0)
        };
    }

    getBinaryUnitSize(unit: AnyObject): number {
        const buffCount = Array.isArray(unit.b) ? unit.b.length : 0;
        return 37 + (buffCount * 6);
    }

    encodeBinaryMatchState(payload: AnyObject): Buffer {
        const state = payload?.state || {};
        const players = Array.isArray(state.p) ? state.p : [];
        const units = Array.isArray(state.u) ? state.u : [];
        const removed = Array.isArray(state.r) ? state.r : [];
        let totalSize = 1 + 4 + 4 + 8 + 1 + 1 + 2 + 2;
        totalSize += players.length * 14;
        totalSize += removed.length * 5;
        units.forEach((unit: AnyObject) => {
            totalSize += this.getBinaryUnitSize(unit);
        });

        const buffer = Buffer.allocUnsafe(totalSize);
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        let offset = 0;
        view.setUint8(offset, state.m === 'd' ? 1 : 0); offset += 1;
        view.setUint32(offset, Number(payload.seq || 0)); offset += 4;
        view.setUint32(offset, Number(state.fc || payload.frame || 0)); offset += 4;
        view.setFloat64(offset, Number(payload.serverNow || Date.now())); offset += 8;
        view.setUint8(offset, players.length); offset += 1;
        view.setUint8(offset, units.length); offset += 1;
        view.setUint16(offset, removed.length); offset += 2;
        view.setUint16(offset, Number(payload.frame || 0)); offset += 2;

        players.forEach((player: AnyObject) => {
            view.setUint8(offset, Number(player.i || 0)); offset += 1;
            view.setFloat32(offset, Number(player.g || 0)); offset += 4;
            view.setFloat32(offset, Number(player.h || 0)); offset += 4;
            view.setFloat32(offset, Number(player.H || 0)); offset += 4;
            view.setUint8(offset, Number(player.e || 0)); offset += 1;
        });

        removed.forEach((unitId: string) => {
            const parsed = this.parseWireUnitId(unitId);
            view.setUint8(offset, parsed.owner); offset += 1;
            view.setUint32(offset, parsed.index); offset += 4;
        });

        units.forEach((unit: AnyObject) => {
            const parsed = this.parseWireUnitId(unit.i, unit.o);
            const buffs = Array.isArray(unit.b) ? unit.b : [];
            view.setUint8(offset, parsed.owner); offset += 1;
            view.setUint32(offset, parsed.index); offset += 4;
            view.setUint8(offset, Number(unit.t || 0)); offset += 1;
            view.setFloat32(offset, Number(unit.h || 0)); offset += 4;
            view.setFloat32(offset, Number(unit.H || 0)); offset += 4;
            view.setFloat32(offset, Number(unit.m || 0)); offset += 4;
            view.setFloat32(offset, Number(unit.M || 0)); offset += 4;
            view.setFloat32(offset, Number(unit.x || 0)); offset += 4;
            view.setFloat32(offset, Number(unit.y || 0)); offset += 4;
            view.setUint8(offset, Number(unit.s || 0)); offset += 1;
            view.setUint8(offset, Number(unit.r || 0)); offset += 1;
            view.setUint8(offset, Number(unit.f || 0)); offset += 1;
            view.setUint8(offset, Number(unit.a || 0)); offset += 1;
            view.setUint16(offset, Number(unit.z || 0)); offset += 2;
            view.setUint8(offset, buffs.length); offset += 1;
            buffs.forEach((buff: AnyObject) => {
                view.setUint8(offset, Number(buff.t || 0)); offset += 1;
                view.setFloat32(offset, Number(buff.v || 0)); offset += 4;
                view.setUint8(offset, Math.max(0, Math.min(255, Number(buff.d || 0)))); offset += 1;
            });
        });

        return buffer;
    }

    serializeServerSim(match: AnyObject): AnyObject {
        const sim = match.sim;
        return {
            seq: sim.seq,
            frame: sim.frame,
            serverNow: Date.now(),
            state: {
                m: 'f',
                fc: sim.frame,
                p: sim.players.map((player: AnyObject) => this.encodeWirePlayer(player)),
                u: sim.units.map((unit: AnyObject) => this.encodeWireUnit(unit, sim))
            },
            events: this.getRecentServerEvents(sim)
        };
    }

    buildDeltaStatePayload(match: AnyObject, fullPayload: AnyObject): AnyObject {
        const currentUnits = Array.isArray(fullPayload?.state?.u) ? fullPayload.state.u : [];
        const previous = match.broadcastUnitCache || new Map<string, string>();
        const current = new Map<string, string>();
        const changed: AnyObject[] = [];

        currentUnits.forEach((unit: AnyObject) => {
            const signature = JSON.stringify(unit);
            current.set(unit.i, signature);
            if (previous.get(unit.i) !== signature) changed.push(unit);
        });

        const removed: string[] = [];
        previous.forEach((_: string, unitId: string) => {
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

    createBroadcastPayload(match: AnyObject): AnyObject {
        const fullPayload = this.serializeServerSim(match);
        match.stateSeq = fullPayload.seq;
        match.stateSnapshot = fullPayload;
        const payload = this.buildDeltaStatePayload(match, fullPayload);
        if (match.sim) match.sim.pendingVisualEvents = [];
        return payload;
    }

    broadcastServerFrame(match: AnyObject): void {
        if (!match.sim) return;
        const payload = this.createBroadcastPayload(match);
        this.sendMatchEvent(match, 'match-state', payload);
        if (payload.events?.length) {
            this.sendMatchEvent(match, 'match-events', payload.events);
        }
    }

    endServerMatch(match: AnyObject, reason = 'finished'): void {
        if (!match || match.ended) return;
        match.ended = true;
        this.broadcastServerFrame(match);
        this.sendMatchEvent(match, 'match-ended', {
            reason,
            state: match.stateSnapshot,
            winnerIndex: match.sim?.players.find((player: AnyObject) => !player.eliminated)?.id ?? null
        });
        setTimeout(() => this.removeMatch(match.id), 1500);
    }

    handleMatchBuy(match: AnyObject, userId: number, unitType: string): AnyObject {
        if (!match || !match.started || match.ended) {
            return { ok: false, status: 404, message: 'Match not found' };
        }
        const playerIndex = match.players.findIndex((player: AnyObject) => player.id === userId);
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
                if (statePayload.events?.length) {
                    this.sendMatchEvent(match, 'match-events', statePayload.events);
                }
            }
        }
        this.sendMatchEvent(match, 'match-action', payload);
        return { ok: true, action: payload, state: statePayload };
    }

    spawnServerUnit(match: AnyObject, playerIndex: number, unitType: string): boolean {
        const sim = match.sim;
        const player = sim.players[playerIndex];
        const meta = sim.classes.get(unitType);
        if (!player || player.eliminated || !meta) return false;
        const ownedCount = sim.units.filter((unit: AnyObject) => unit.owner === playerIndex).length;
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
            laneY: spawn.y,
            marchTargetY: spawn.y,
            marchRetargetCooldown: 0,
            lastMarchSteerDir: 0,
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
            baseAttackLockOwner: null,
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

    findServerTarget(sim: AnyObject, unit: AnyObject): AnyObject {
        if (Number.isInteger(unit.baseAttackLockOwner)) {
            const lockedBase = sim.players.find((player: AnyObject) => !player.eliminated && player.id === unit.baseAttackLockOwner && player.id !== unit.owner && player.hp > 0);
            if (lockedBase) return lockedBase;
            unit.baseAttackLockOwner = null;
        }

        const index = sim?.spatialIndex || this.buildServerSpatialIndex(sim);
        const enemies = index.byOwner[(unit.owner + 1) % index.byOwner.length] || [];
        let bestTarget: AnyObject = null;
        let bestDistance = Infinity;
        const pivot = this.findServerUnitsNearX(enemies, Number(unit.x || 0));

        for (let left = pivot - 1, right = pivot; left >= 0 || right < enemies.length;) {
            const leftDx = left >= 0 ? Math.abs(Number(enemies[left].x || 0) - Number(unit.x || 0)) : Infinity;
            const rightDx = right < enemies.length ? Math.abs(Number(enemies[right].x || 0) - Number(unit.x || 0)) : Infinity;
            const useLeft = leftDx <= rightDx;
            const candidate = useLeft ? enemies[left--] : enemies[right++];
            const minPossible = Math.max(0, (useLeft ? leftDx : rightDx) - this.SERVER_UNIT_HALF_SIZE - this.SERVER_UNIT_HALF_SIZE);
            if (minPossible > bestDistance) break;
            const distance = this.getServerSurfaceDistance(unit, candidate);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestTarget = candidate;
            }
        }

        sim.players.forEach((player: AnyObject) => {
            if (!player.eliminated && player.id !== unit.owner) {
                const distance = this.getServerSurfaceDistance(unit, player);
                if (distance < bestDistance) {
                    bestDistance = distance;
                    bestTarget = player;
                }
            }
        });

        return bestTarget;
    }

    setServerAnim(unit: AnyObject, action: string, frame: number): void {
        if (unit.animAction !== action || frame - Number(unit.animStartedAt || 0) > 24) {
            unit.animAction = action;
            unit.animStartedAt = frame;
        }
    }

    getServerAttackAnim(unit: AnyObject): string {
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

    getServerProjectileSprite(unit: AnyObject, skill: string | null = null): string | null {
        const type = String(unit.type || '').toLowerCase();
        if (skill === 'grenade') return 'grenade';
        if (type.includes('bowman')) return 'arrow';
        if (type.includes('mage')) return 'mage_charge';
        if (type.includes('healer')) return 'healer_fire_1';
        if (type.includes('iceman')) return 'iceman_magic_arrow';
        if (type.includes('chilygirl')) return 'chily';
        return null;
    }

    addServerProjectileVisual(match: AnyObject, unit: AnyObject, target: AnyObject, skill: string | null = null): void {
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
    }

    addServerVfxVisual(match: AnyObject, x: number, y: number, text: string, color = '#fff'): void {
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
    }

    applyServerAreaDamage(match: AnyObject, unit: AnyObject, center: AnyObject, radius: number, amount: number, damageType: string, label: string): void {
        const sim = match.sim;
        this.queryServerSpatialUnits(sim, center.x, center.y, radius, (target: AnyObject) => target.owner !== unit.owner && target.hp > 0)
            .forEach((target: AnyObject) => {
                this.applyServerDamage(match, unit, target, amount, damageType, label);
            });
    }

    tryServerSkill(match: AnyObject, unit: AnyObject, target: AnyObject): boolean {
        const sim = match.sim;
        if (unit.skillCooldown > 0 || unit.maxMana <= 0) return false;
        const lower = String(unit.type || '').toLowerCase();

        if (lower.includes('iceman') && unit.mana >= 60) {
            unit.mana -= 60;
            unit.skillCooldown = 120;
            this.setServerAnim(unit, 'charge_2', sim.frame);
            const targets = this.queryServerSpatialUnits(sim, unit.x, unit.y, 320, (other: AnyObject) => other.owner !== unit.owner && other.hp > 0)
                .map((other: AnyObject) => ({ unit: other, distance: this.serverDist(unit, other) }));
            targets.sort((a, b) => a.distance - b.distance);
            const selectedTargets = targets.slice(0, 3).map(entry => entry.unit);
            selectedTargets.forEach((enemy: AnyObject) => {
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

        if (lower.includes('chilygirl') && unit.mana >= 70) {
            unit.mana -= 70;
            unit.skillCooldown = 180;
            unit.chilyShieldUntil = sim.frame + 180;
            unit.chilyAttackSpeedUntil = sim.frame + 180;
            unit.chilyNoManaRegenUntil = sim.frame + 180;
            this.setServerAnim(unit, 'protect', sim.frame);
            this.addServerVfxVisual(match, unit.x, unit.y - 24, 'SHIELD', '#fca5a5');
            return true;
        }

        if (lower.includes('assassin') && unit.mana >= 80) {
            const dashCandidates = this.queryServerSpatialUnits(sim, unit.x, unit.y, 300, (other: AnyObject) => other.owner !== unit.owner && other.hp > 0);
            let dashTarget: AnyObject = null;
            let farthestDistance = -1;
            dashCandidates.forEach((other: AnyObject) => {
                const distance = this.serverDist(unit, other);
                if (distance > farthestDistance) {
                    farthestDistance = distance;
                    dashTarget = other;
                }
            });
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
            const allyPool = sim.spatialIndex?.byOwner?.[unit.owner] || sim.units;
            let ally: AnyObject = null;
            let lowestHpRatio = Infinity;
            allyPool.forEach((other: AnyObject) => {
                if (other.id === unit.id || other.hp >= other.maxHp) return;
                const hpRatio = other.hp / Math.max(1, other.maxHp);
                if (hpRatio < lowestHpRatio) {
                    lowestHpRatio = hpRatio;
                    ally = other;
                }
            });
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

    updateServerSim(match: AnyObject): void {
        const sim = match.sim;
        if (!sim || match.ended) return;
        sim.frame += 1;

        sim.players.forEach((player: AnyObject) => {
            if (!player.eliminated) player.gold += this.SERVER_GOLD_RATE;
        });

        while (sim.commands.length) {
            const command = sim.commands.shift();
            if (command.type === 'buy') this.spawnServerUnit(match, command.playerIndex, command.unitType);
        }

        this.buildServerSpatialIndex(sim);

        sim.units.forEach((unit: AnyObject) => {
            if (unit.cooldown > 0) unit.cooldown -= 1;
            if (unit.skillCooldown > 0) unit.skillCooldown -= 1;
            if (sim.frame % this.SERVER_MANA_REGEN_INTERVAL_FRAMES === 0) {
                unit.hp = Math.min(unit.maxHp, unit.hp + 1);
                if (!unit.chilyNoManaRegenUntil || unit.chilyNoManaRegenUntil <= sim.frame) {
                    unit.mana = Math.min(unit.maxMana, unit.mana + this.SERVER_MANA_REGEN_AMOUNT);
                }
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
                    const atkSpeedMult = unit.chilyAttackSpeedUntil && unit.chilyAttackSpeedUntil > sim.frame ? 3 : 1;
                    const atkSpeed = Math.max(0.1, Number(unit.meta.atk_speed || 1) * atkSpeedMult);
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
                const preferredY = Number(unit.meta.range || 25) < 35 && !target.base
                    ? Number(targetPoint.y || this.SERVER_LANE_Y)
                    : Number(unit.laneY || this.SERVER_LANE_Y);
                const marchY = this.chooseServerMarchY(sim, unit, preferredY, dir);
                unit.y += (marchY - Number(unit.y || this.SERVER_LANE_Y)) * (Number(unit.meta.range || 25) < 35 ? 0.08 : 0.05);
                this.clampServerUnitPosition(unit);
            }
        });

        this.buildServerSpatialIndex(sim);
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

        sim.players.forEach((player: AnyObject) => {
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
        if (sim.frame % this.getBroadcastEveryFrames(sim) === 0) this.broadcastServerFrame(match);
        const activePlayers = sim.players.filter((player: AnyObject) => !player.eliminated);
        if (activePlayers.length <= 1) this.endServerMatch(match, 'finished');
    }

    startServerSimulation(match: AnyObject): void {
        if (match.simTimer) clearInterval(match.simTimer);
        match.sim = this.createServerSim(match);
        match.simTimer = setInterval(() => this.updateServerSim(match), 1000 / this.MATCH_FPS);
        match.simTimer.unref?.();
    }

    getMatchPayload(match: AnyObject, userId: number): AnyObject {
        return {
            matchId: match.id,
            playerIndex: match.players.findIndex((player: AnyObject) => player.id === userId),
            players: match.players.map((player: AnyObject) => ({ id: player.id, username: player.username })),
            seed: match.seed,
            startsAt: match.startsAt,
            serverNow: Date.now(),
            confirmedFrame: this.getConfirmedFrame(match),
            units: match.units || null
        };
    }

    async getUnitSnapshot(): Promise<any> {
        try {
            const [units] = await this.pool.query('SELECT * FROM units ORDER BY id ASC');
            return units;
        } catch (err: any) {
            console.warn('[Match] Unable to capture unit snapshot:', err.message);
            return null;
        }
    }

    removeMatch(matchId: string): void {
        const match = this.matches.get(matchId);
        if (!match) return;
        match.clients.forEach((client: AnyObject) => client.end());
        if (match.simTimer) clearInterval(match.simTimer);
        this.matches.delete(matchId);
        const waitingIdx = this.waitingMatches.findIndex(id => id === matchId);
        if (waitingIdx >= 0) this.waitingMatches.splice(waitingIdx, 1);
    }

    cleanupExpiredMatches(): void {
        const now = Date.now();
        this.matches.forEach(match => {
            if (now - match.createdAt > this.MATCH_TTL_MS) this.removeMatch(match.id);
        });
    }

    async joinMatch(user: AnyObject): Promise<AnyObject> {
        for (const match of this.matches.values()) {
            if (!match.ended && match.players.some((player: AnyObject) => player.id === user.id)) {
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

    openStream(req: AnyObject, res: AnyObject, verifyToken: (token: string) => AnyObject): void {
        let decoded: AnyObject;
        try {
            decoded = verifyToken(String(req.query.token || ''));
        } catch (err) {
            res.status(401).end();
            return;
        }

        const match = this.matches.get(String(req.query.matchId || ''));
        if (!match || !match.players.some((player: AnyObject) => player.id === decoded.id)) {
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
            (match.actionLog || []).forEach((action: AnyObject) => {
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

    performAction(matchId: string, userId: number, body: AnyObject): AnyObject {
        const match = this.matches.get(String(matchId || ''));
        if (String(body.type || '') !== 'buy') {
            return { ok: false, status: 400, message: 'Invalid match action' };
        }
        return this.handleMatchBuy(match, userId, String(body.unitType || ''));
    }

    publishState(matchId: string, userId: number, body: AnyObject): AnyObject {
        const match = this.matches.get(String(matchId || ''));
        if (!match || !match.started || match.ended) {
            return { ok: false, status: 404, message: 'Match not found' };
        }

        const playerIndex = match.players.findIndex((player: AnyObject) => player.id === userId);
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

        const realtimeEvents = events.filter((event: AnyObject) => event?.type !== 'damage').slice(-50);
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
            match.eventHistory = [...(match.eventHistory || []), ...events.map((event: AnyObject) => ({
                ...event,
                serverSeq: seq,
                serverFrame: frame,
                serverAt: payload.serverNow
            }))].slice(-this.MAX_MATCH_EVENTS);
        }
        match.players.forEach((player: AnyObject, idx: number) => {
            if (idx !== 0) this.sendMatchEventToPlayer(match, player.id, 'match-state', payload);
        });
        return { ok: true };
    }

    pingMatch(matchId: string, userId: number, clientSentAt: number): AnyObject {
        const match = this.matches.get(String(matchId || ''));
        if (!match || !match.players.some((player: AnyObject) => player.id === userId)) {
            return { ok: false, status: 404, message: 'Match not found' };
        }
        return {
            ok: true,
            matchId: match.id,
            serverNow: Date.now(),
            clientSentAt: Number(clientSentAt || 0)
        };
    }

    leaveMatch(matchId: string, userId: number): AnyObject {
        const match = this.matches.get(String(matchId || ''));
        if (match && match.players.some((player: AnyObject) => player.id === userId)) {
            match.ended = true;
            this.sendMatchEvent(match, 'match-ended', { reason: 'left', userId });
            setTimeout(() => this.removeMatch(match.id), 1000);
        }
        return { ok: true };
    }

    handleSocketConnection(socket: AnyObject, req: AnyObject, verifyToken: (token: string) => AnyObject): void {
        const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
        let decoded: AnyObject;
        try {
            decoded = verifyToken(String(url.searchParams.get('token') || ''));
        } catch (err) {
            socket.close(1008, 'Unauthorized');
            return;
        }

        const match = this.matches.get(String(url.searchParams.get('matchId') || ''));
        if (!match || !match.players.some((player: AnyObject) => player.id === decoded.id)) {
            socket.close(1008, 'Match not found');
            return;
        }

        match.wsClients.set(decoded.id, socket);
        socket.send(JSON.stringify({ event: 'ws-ready', payload: this.getMatchPayload(match, decoded.id) }));
        if (match.started) {
            socket.send(JSON.stringify({ event: 'match-start', payload: this.getMatchPayload(match, decoded.id) }));
            (match.actionLog || []).forEach((action: AnyObject) => socket.send(JSON.stringify({ event: 'match-action', payload: action })));
            if (match.stateSnapshot) socket.send(this.encodeBinaryMatchState(match.stateSnapshot));
            if (match.stateSnapshot?.events?.length) {
                socket.send(JSON.stringify({ event: 'match-events', payload: match.stateSnapshot.events }));
            }
        }

        socket.on('message', (raw: AnyObject) => {
            let message: AnyObject;
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
