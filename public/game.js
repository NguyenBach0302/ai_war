/* ============================================================
   Age of Agents — Auto Chess Arena
   TFT-style auto-battler: shop -> place -> combat -> economy
   ============================================================ */

/* ---------------- AUTH ---------------- */
const Auth = (function () {
    let currentUser = null;
    let token = localStorage.getItem('token');

    function msg(t, ok) {
        const el = document.getElementById('auth-msg');
        if (el) { el.textContent = t; el.style.color = ok ? 'var(--good)' : 'var(--bad)'; }
    }

    async function login() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!username || !password) return msg('Enter username and password');
        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (data.token) {
                localStorage.setItem('token', data.token);
                token = data.token; currentUser = data.user;
                enterLobby();
            } else { msg(data.message || 'Login failed'); }
        } catch (e) { msg('Network error'); }
    }

    async function register() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!username || !password) return msg('Enter username and password');
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            });
            const data = await res.json();
            if (res.ok) msg('Registered! Now log in.', true);
            else msg(data.message || 'Register failed');
        } catch (e) { msg('Network error'); }
    }

    async function checkSession() {
        if (!token) return;
        try {
            const res = await fetch('/api/user/profile', { headers: { Authorization: `Bearer ${token}` } });
            if (res.ok) { currentUser = await res.json(); enterLobby(); }
            else localStorage.removeItem('token');
        } catch (e) { /* offline */ }
    }

    async function enterLobby() {
        document.getElementById('auth-overlay').classList.add('hidden');
        updateUserStatus();
        await Game.fetchUnits();
        Game.checkActiveSession();
    }

    function updateUserStatus() {
        const status = document.getElementById('user-status');
        if (!status || !currentUser) return;
        status.classList.remove('hidden');
        status.innerHTML = `
            <span class="us-name">${currentUser.username}</span>
            <span class="us-stat">🏆 ${currentUser.wins || 0}</span>
            <span class="us-stat">💀 ${currentUser.losses || 0}</span>
            <button class="icon-btn" title="Logout" onclick="Auth.logout()">⎋</button>`;
    }

    function logout() { localStorage.removeItem('token'); location.reload(); }

    return { login, register, checkSession, logout, getToken: () => token, getUser: () => currentUser };
})();

/* ---------------- GAME ---------------- */
const Game = (function () {
    /* ===== STATIC CONFIG ===== */
    const ROWS = 3, COLS = 6;                 // board grid
    const BENCH_SIZE = 9;
    const PREP_SECONDS = 30;
    const POST_SECONDS = 3;
    const MAX_LEVEL = 9;
    const ARENA_W = 900, ARENA_H = 620;
    const SHOP_SLOTS = 5;

    const COLORS = [
        { name: 'Azure', main: '#38bdf8', glow: 'rgba(56,189,248,.5)' },
        { name: 'Rose', main: '#fb7185', glow: 'rgba(251,113,133,.5)' },
        { name: 'Amber', main: '#fbbf24', glow: 'rgba(251,191,36,.5)' },
        { name: 'Emerald', main: '#34d399', glow: 'rgba(52,211,153,.5)' }
    ];

    // Per-unit auto-chess tuning. tier == shop cost in gold.
    const UNIT_CFG = {
        Bowman: { tier: 1, armor: 10, mres: 10 },
        Hunter: { tier: 1, armor: 15, mres: 10 },
        Guard: { tier: 2, armor: 60, mres: 40 },
        Healer: { tier: 2, armor: 10, mres: 25 },
        Assassin: { tier: 3, armor: 10, mres: 10, crit: 0.5 },
        Mage: { tier: 3, armor: 5, mres: 10 },
        Gunman: { tier: 4, armor: 18, mres: 18 }
    };
    const TIER_COLOR = { 1: '#9ca3af', 2: '#34d399', 3: '#38bdf8', 4: '#c084fc', 5: '#fbbf24' };

    // Star scaling for hp / damage.
    const STAR_HP = { 1: 1, 2: 1.8, 3: 3.2 };
    const STAR_DMG = { 1: 1, 2: 1.8, 3: 3.4 };

    // Shop tier odds by level (percent for tiers 1..4).
    const SHOP_ODDS = {
        1: [100, 0, 0, 0], 2: [70, 30, 0, 0], 3: [60, 35, 5, 0],
        4: [50, 35, 13, 2], 5: [42, 35, 18, 5], 6: [33, 32, 25, 10],
        7: [26, 30, 30, 14], 8: [20, 26, 34, 20], 9: [16, 22, 36, 26]
    };
    // XP required to advance FROM a given level.
    const LEVEL_XP = { 1: 2, 2: 2, 3: 6, 4: 10, 5: 20, 6: 36, 7: 48, 8: 72 };
    const XP_PER_BUY = 4, XP_COST = 4, REROLL_COST = 2;

    /* ===== STATE ===== */
    let CLASSES = {};          // name -> {meta, tier, armor, mres, crit, icon, ...}
    let POOL = [];             // flat list of unit names weighted by availability per tier
    let players = [];
    let me = null;             // human player ref
    let round = 1;
    let phase = 'idle';        // idle | shop | combat | post
    let prepTimer = 0, prepInterval = null;
    let selected = null;       // selected slot {zone,...} during prep
    let battle = null, rafId = null;
    let log = [];

    /* ===== HELPERS ===== */
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const uid = () => Math.random().toString(36).slice(2, 9);
    const byId = (id) => document.getElementById(id);

    function getReduction(val) {
        let r = val <= 50 ? val * 0.01 : 0.5 + (val - 50) * 0.005;
        return Math.min(0.85, r);
    }

    function addLog(text, color) {
        log.unshift({ text, color: color || 'var(--muted)', r: round });
        if (log.length > 60) log.pop();
        renderLog();
    }

    function renderLog() {
        const el = byId('combat-log'); if (!el) return;
        el.innerHTML = log.map(e =>
            `<div class="log-entry"><span class="log-r">R${e.r}</span><span style="color:${e.color}">${e.text}</span></div>`
        ).join('');
    }

    /* ===== DATA LOAD ===== */
    // Mirrors setup_db.sql so the arena is fully playable even without the DB/API.
    const FALLBACK_UNITS = [
        { name: 'Guard', icon: '🛡️', hp: 200, speed: 1.1, range: 25, dmg: 15, cd: 40, role: 'Tanker', dmg_type: 'physical' },
        { name: 'Assassin', icon: '🗡️', hp: 80, speed: 1.9, range: 20, dmg: 35, cd: 30, role: 'Burst', dmg_type: 'physical' },
        { name: 'Mage', icon: '🔮', hp: 70, speed: 0.8, range: 140, dmg: 60, cd: 65, role: 'Artillery', dmg_type: 'true' },
        { name: 'Healer', icon: '✨', hp: 90, speed: 1.0, range: 120, dmg: 5, cd: 55, role: 'Support', dmg_type: 'physical' },
        { name: 'Bowman', icon: '🏹', hp: 100, speed: 1.2, range: 160, dmg: 12, cd: 35, role: 'Debuffer', dmg_type: 'physical' },
        { name: 'Gunman', icon: '🔫', hp: 110, speed: 0.9, range: 160, dmg: 45, cd: 100, role: 'DPS', dmg_type: 'physical' },
        { name: 'Hunter', icon: '🐾', hp: 130, speed: 1.4, range: 130, dmg: 20, cd: 45, role: 'Ranger', dmg_type: 'physical' }
    ];

    function loadClasses(data) {
        CLASSES = {}; POOL = [];
        data.forEach(u => {
            const cfg = UNIT_CFG[u.name] || { tier: 1, armor: 10, mres: 10 };
            CLASSES[u.name] = {
                name: u.name, icon: u.icon, hp: u.hp, dmg: u.dmg, range: u.range,
                speed: u.speed, cd: u.cd, role: u.role,
                dmgType: (u.dmg_type || u.dmgType || 'physical'),
                tier: cfg.tier, armor: cfg.armor, mres: cfg.mres, crit: cfg.crit || 0,
                special: u.special
            };
        });
        POOL = Object.values(CLASSES);
    }

    async function fetchUnits() {
        try {
            const res = await fetch('/api/units');
            if (!res.ok) throw new Error('bad status');
            const data = await res.json();
            if (!Array.isArray(data) || !data.length) throw new Error('empty');
            loadClasses(data);
        } catch (e) {
            console.warn('Units API unavailable — using built-in roster.', e.message);
            loadClasses(FALLBACK_UNITS);
        }
    }

    /* ===== UNIT FACTORY ===== */
    function makeUnit(name, star = 1) {
        const c = CLASSES[name];
        return { uid: uid(), name, star, tier: c.tier, icon: c.icon };
    }

    /* ===== ECONOMY ===== */
    function streakBonus(s) {
        const a = Math.abs(s);
        if (a >= 6) return 3; if (a >= 4) return 2; if (a >= 2) return 1; return 0;
    }

    function applyIncome(p, first) {
        if (p.eliminated) return;
        let income = first ? 0 : 5;
        const interest = Math.min(5, Math.floor(p.gold / 10));
        const sb = first ? 0 : streakBonus(p.streak);
        p.gold += income + interest + sb;
        if (p.isHuman && !first) {
            let parts = [`+${income}`];
            if (interest) parts.push(`+${interest} interest`);
            if (sb) parts.push(`+${sb} streak`);
            addLog(`Income ${parts.join(' ')} → ${p.gold}g`, 'var(--gold)');
        }
    }

    /* ===== SHOP ===== */
    function rollTier(level) {
        const odds = SHOP_ODDS[level] || SHOP_ODDS[9];
        const r = Math.random() * 100; let acc = 0;
        for (let t = 0; t < 4; t++) { acc += odds[t]; if (r < acc) return t + 1; }
        return 1;
    }

    function rollShop(p) {
        const shop = [];
        for (let i = 0; i < SHOP_SLOTS; i++) {
            const tier = rollTier(p.level);
            const candidates = POOL.filter(u => u.tier === tier);
            const pick = candidates.length ? candidates[Math.floor(Math.random() * candidates.length)]
                : POOL[Math.floor(Math.random() * POOL.length)];
            shop.push(pick.name);
        }
        p.shop = shop;
    }

    function reroll() {
        if (phase !== 'shop' || me.gold < REROLL_COST) return;
        me.gold -= REROLL_COST; rollShop(me);
        renderShop(); renderEcon();
    }

    function buyXP() {
        if (phase !== 'shop' || me.level >= MAX_LEVEL || me.gold < XP_COST) return;
        me.gold -= XP_COST; gainXP(me, XP_PER_BUY);
        renderEcon(); renderBoard();
    }

    function gainXP(p, amount) {
        if (p.level >= MAX_LEVEL) return;
        p.xp += amount;
        while (p.level < MAX_LEVEL && p.xp >= (LEVEL_XP[p.level] || 999)) {
            p.xp -= LEVEL_XP[p.level]; p.level++;
            if (p.isHuman) addLog(`Leveled up to ${p.level}! Board cap ${p.level}.`, 'var(--accent)');
        }
        if (p.level >= MAX_LEVEL) p.xp = 0;
    }

    function buyShop(idx) {
        if (phase !== 'shop') return;
        const name = me.shop[idx]; if (!name) return;
        const cost = CLASSES[name].tier;
        if (me.gold < cost) return flashNoGold();
        if (freeBenchSlot(me) === -1 && !wouldCombine(me, name)) return flashNoGold();
        me.gold -= cost;
        me.shop[idx] = null;
        acquireUnit(me, name);
        renderShop(); renderBench(); renderBoard(); renderEcon();
    }

    /* ===== BENCH / BOARD ===== */
    function freeBenchSlot(p) { return p.bench.findIndex(s => s === null); }
    function boardCount(p) { return Object.keys(p.board).length; }
    function boardKey(r, c) { return r + '-' + c; }

    function addToBench(p, unit) {
        const i = freeBenchSlot(p);
        if (i === -1) return false;
        p.bench[i] = unit; return true;
    }

    // Add a bought unit, correctly handling a full bench when the buy completes a combine.
    function acquireUnit(p, name) {
        if (freeBenchSlot(p) !== -1) { addToBench(p, makeUnit(name)); combineAll(p); return; }
        // bench full: only valid when this purchase merges two existing 1-stars
        const matches = allUnits(p).filter(x => x.unit.name === name && x.unit.star === 1).slice(0, 2);
        if (matches.length < 2) return; // safety; caller guards against this
        const onBoard = matches.find(x => x.loc.zone === 'board');
        const target = onBoard ? onBoard.loc : matches[0].loc;
        matches.forEach(x => setAt(p, x.loc, null));
        setAt(p, target, makeUnit(name, 2));
        combineAll(p);
        if (p.isHuman) addLog(`✦✦ ${CLASSES[name].icon} ${name} upgraded to ★★!`, 'var(--accent)');
    }

    function allUnits(p) {
        const arr = [];
        p.bench.forEach((u, i) => { if (u) arr.push({ unit: u, loc: { zone: 'bench', idx: i } }); });
        Object.entries(p.board).forEach(([k, u]) => arr.push({ unit: u, loc: { zone: 'board', key: k } }));
        return arr;
    }

    function getAt(p, loc) {
        return loc.zone === 'bench' ? p.bench[loc.idx] : (p.board[loc.key] || null);
    }
    function setAt(p, loc, unit) {
        if (loc.zone === 'bench') p.bench[loc.idx] = unit;
        else { if (unit) p.board[loc.key] = unit; else delete p.board[loc.key]; }
    }

    // would buying `name` complete a 3-combine even with full bench?
    function wouldCombine(p, name) {
        const c = allUnits(p).filter(x => x.unit.name === name && x.unit.star === 1).length;
        return c >= 2;
    }

    function combineAll(p) {
        let changed = true;
        while (changed) {
            changed = false;
            const groups = {};
            allUnits(p).forEach(x => {
                if (x.unit.star >= 3) return;
                const key = x.unit.name + '|' + x.unit.star;
                (groups[key] = groups[key] || []).push(x);
            });
            for (const key in groups) {
                const g = groups[key];
                if (g.length >= 3) {
                    const three = g.slice(0, 3);
                    const onBoard = three.find(x => x.loc.zone === 'board');
                    const target = onBoard ? onBoard.loc : three[0].loc;
                    three.forEach(x => setAt(p, x.loc, null));
                    const up = makeUnit(three[0].unit.name, three[0].unit.star + 1);
                    setAt(p, target, up);
                    if (p.isHuman) addLog(`${up.icon} ${up.name} upgraded to ${'★'.repeat(up.star)}!`, 'var(--accent)');
                    changed = true; break;
                }
            }
        }
    }

    function sellValue(unit) {
        const base = CLASSES[unit.name].tier;
        return base * Math.pow(3, unit.star - 1) - (unit.star > 1 ? 1 : 0);
    }

    /* ===== SELECTION / MOVEMENT (tap + drag) ===== */
    function sameLoc(a, b) {
        if (!a || !b || a.zone !== b.zone) return false;
        return a.zone === 'bench' ? a.idx === b.idx : a.key === b.key;
    }

    function selectSlot(loc) {
        if (phase !== 'shop') return;
        if (loc.zone === 'sell') { if (selected) sellUnit(selected); clearSelection(); return; }
        if (selected && sameLoc(selected, loc)) { clearSelection(); return; }
        if (selected) { moveUnit(selected, loc); clearSelection(); return; }
        if (getAt(me, loc)) { selected = loc; highlightSelection(); }
    }

    function moveUnit(from, to) {
        const fromU = getAt(me, from);
        const toU = getAt(me, to);
        if (!fromU) return;
        // moving bench -> board (new occupancy) must respect level cap
        if (to.zone === 'board' && from.zone === 'bench' && !toU && boardCount(me) >= me.level) {
            flashBoardCap(); return;
        }
        setAt(me, to, fromU);
        setAt(me, from, toU); // swap (toU may be null)
        renderBench(); renderBoard();
    }

    function sellUnit(loc) {
        const u = getAt(me, loc); if (!u) return;
        me.gold += sellValue(u);
        setAt(me, loc, null);
        addLog(`Sold ${u.icon} ${u.name} for ${sellValue(u)}g`, 'var(--muted)');
        renderBench(); renderBoard(); renderEcon();
    }

    function clearSelection() { selected = null; document.querySelectorAll('.slot.selected').forEach(e => e.classList.remove('selected')); }
    function highlightSelection() {
        document.querySelectorAll('.slot.selected').forEach(e => e.classList.remove('selected'));
        const sel = selected.zone === 'bench'
            ? document.querySelector(`#bench-grid .slot[data-idx="${selected.idx}"]`)
            : document.querySelector(`#board-grid .slot[data-key="${selected.key}"]`);
        if (sel) sel.classList.add('selected');
    }

    /* ===== AUTO FILL (human convenience + bots) ===== */
    function autoPlace(p) {
        // gather all units, clear board, place best up to level
        const units = allUnits(p).map(x => x.unit);
        p.board = {};
        // sort: tanks (melee, high armor) first, then dps/support
        units.sort((a, b) => placePriority(b) - placePriority(a));
        const cap = p.level;
        const chosen = units.slice(0, cap);
        const benchLeft = units.slice(cap);
        // reset bench
        p.bench = Array(BENCH_SIZE).fill(null);
        benchLeft.forEach(u => addToBench(p, u));
        // assign rows: melee front (row 0), ranged back (row 2)
        let frontCol = 0, midCol = 0, backCol = 0;
        chosen.forEach(u => {
            const c = CLASSES[u.name];
            let row, col;
            if (c.range < 35) { row = 0; col = frontCol++; }
            else if (c.role === 'Support') { row = 2; col = backCol++; }
            else { row = 1; col = midCol++; }
            if (col >= COLS) { row = Math.min(2, row + 1); col = 0; }
            // find a free cell near intended
            let placed = false;
            for (let dr = 0; dr < ROWS && !placed; dr++) {
                for (let dc = 0; dc < COLS && !placed; dc++) {
                    const rr = clamp(row + (dr % 2 ? dr : -dr), 0, ROWS - 1);
                    const cc = (col + dc) % COLS;
                    const k = boardKey(rr, cc);
                    if (!p.board[k]) { p.board[k] = u; placed = true; }
                }
            }
        });
    }

    function placePriority(u) {
        const c = CLASSES[u.name];
        let pr = u.star * 10 + u.tier;
        if (c.range < 35) pr += 5;       // tanks valuable on board
        return pr;
    }

    function autoFill() { if (phase !== 'shop') return; autoPlace(me); clearSelection(); renderBench(); renderBoard(); }

    /* ===== BOTS ===== */
    function botTurn(p) {
        if (p.eliminated) return;
        let guard = 0;
        // spend logic: buy duplicates / affordable, keep some economy
        const keepGold = p.level < 6 ? 10 : 0;     // hold for interest early
        let bought = true;
        while (bought && guard++ < 30) {
            bought = false;
            // prefer shop slots that combine or that we want
            for (let i = 0; i < p.shop.length; i++) {
                const name = p.shop[i]; if (!name) continue;
                const cost = CLASSES[name].tier;
                const wantCombine = wouldCombine(p, name);
                if (p.gold - cost < keepGold && !wantCombine) continue;
                if (freeBenchSlot(p) === -1 && !wantCombine) continue;
                if (p.gold < cost) continue;
                p.gold -= cost; p.shop[i] = null;
                acquireUnit(p, name);
                bought = true;
            }
        }
        // level up when flush
        if (p.gold > 30 + keepGold && p.level < MAX_LEVEL) buyXPFor(p);
        // occasional reroll if rich and bench has room
        if (p.gold > 40) { p.gold -= REROLL_COST; rollShop(p); botBuyOnce(p, keepGold); }
        autoPlace(p);
    }

    function buyXPFor(p) {
        let n = 0;
        while (p.gold >= XP_COST && p.level < MAX_LEVEL && n++ < 5) { p.gold -= XP_COST; gainXP(p, XP_PER_BUY); }
    }
    function botBuyOnce(p, keepGold) {
        for (let i = 0; i < p.shop.length; i++) {
            const name = p.shop[i]; if (!name) continue;
            const cost = CLASSES[name].tier;
            if (p.gold - cost < keepGold) continue;
            if (freeBenchSlot(p) === -1 && !wouldCombine(p, name)) continue;
            p.gold -= cost; p.shop[i] = null; acquireUnit(p, name);
        }
    }

    /* ===== COMBAT BUILD ===== */
    function arenaPos(r, c, side) {
        const x = (c + 0.5) / COLS * ARENA_W;
        let y = ARENA_H * 0.52 + (r + 0.5) / ROWS * (ARENA_H * 0.46);
        if (side === 'enemy') y = ARENA_H - y;
        return { x, y };
    }

    function makeCombatUnit(unit, side, r, c) {
        const m = CLASSES[unit.name];
        const sh = STAR_HP[unit.star], sd = STAR_DMG[unit.star];
        const pos = arenaPos(r, c, side);
        return {
            side, name: unit.name, star: unit.star, icon: m.icon,
            x: pos.x, y: pos.y, radius: 13 + unit.star * 2,
            maxHp: Math.round(m.hp * sh), hp: Math.round(m.hp * sh),
            dmg: m.dmg * sd, range: m.range, speed: m.speed * 1.5,
            cd: Math.floor(Math.random() * 20), baseCd: m.cd,
            dmgType: m.dmgType, armor: m.armor, mres: m.mres,
            crit: m.crit, role: m.role, color: side === 'me' ? me.color.main : '#fb7185',
            flash: 0
        };
    }

    function buildBattle(boardA, boardB) {
        const units = [];
        Object.entries(boardA).forEach(([k, u]) => { const [r, c] = k.split('-').map(Number); units.push(makeCombatUnit(u, 'me', r, c)); });
        Object.entries(boardB).forEach(([k, u]) => { const [r, c] = k.split('-').map(Number); units.push(makeCombatUnit(u, 'enemy', r, c)); });
        return { units, projectiles: [], particles: [], texts: [], tick: 0, done: false, winner: null };
    }

    function nearestEnemy(b, u) {
        let best = null, bd = Infinity;
        for (const e of b.units) {
            if (e.side === u.side || e.hp <= 0) continue;
            const d = dist(u, e); if (d < bd) { bd = d; best = e; }
        }
        return { target: best, d: bd };
    }
    function lowestAlly(b, u, maxD) {
        let best = null, bestRatio = 1;
        for (const a of b.units) {
            if (a.side !== u.side || a.hp <= 0 || a === u) continue;
            if (dist(u, a) > maxD) continue;
            const ratio = a.hp / a.maxHp;
            if (ratio < bestRatio) { bestRatio = ratio; best = a; }
        }
        return best;
    }

    function applyDamage(b, target, dmg, dmgType, color) {
        let f = dmg;
        if (dmgType !== 'true') {
            const red = getReduction(dmgType === 'magic' ? target.mres : target.armor);
            f *= (1 - red);
        }
        target.hp -= f; target.flash = 6;
        b.texts.push({ x: target.x, y: target.y - 10, text: `-${Math.round(f)}`, color: color || '#fff', life: 32, vy: -0.8 });
    }

    function spawnParticles(b, x, y, color, n) {
        if (b.particles.length > 160) return;
        for (let i = 0; i < n; i++) b.particles.push({ x, y, vx: (Math.random() - .5) * 4, vy: (Math.random() - .5) * 4, life: 18 + Math.random() * 14, color });
    }

    function stepBattle(b) {
        b.tick++;
        // projectiles
        for (let i = b.projectiles.length - 1; i >= 0; i--) {
            const pr = b.projectiles[i];
            if (!pr.target || pr.target.hp <= 0) { b.projectiles.splice(i, 1); continue; }
            const d = dist(pr, pr.target);
            if (d < 14) {
                applyDamage(b, pr.target, pr.dmg, pr.dmgType, pr.color);
                spawnParticles(b, pr.target.x, pr.target.y, pr.color, 5);
                b.projectiles.splice(i, 1);
            } else {
                const a = Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x);
                pr.x += Math.cos(a) * pr.speed; pr.y += Math.sin(a) * pr.speed;
            }
        }
        // units
        for (const u of b.units) {
            if (u.hp <= 0) continue;
            if (u.flash > 0) u.flash--;
            if (u.cd > 0) u.cd--;
            const isHealer = u.role === 'Support';
            const { target, d } = nearestEnemy(b, u);
            if (!target) continue;
            if (isHealer) {
                // heal lowest ally within range, else act like ranged poke
                const ally = lowestAlly(b, u, u.range);
                if (u.cd <= 0 && ally) {
                    u.cd = u.baseCd;
                    const heal = (20 + 10 * u.star);
                    ally.hp = Math.min(ally.maxHp, ally.hp + heal);
                    b.texts.push({ x: ally.x, y: ally.y - 10, text: `+${heal}`, color: '#34d399', life: 30, vy: -0.8 });
                    continue;
                }
            }
            if (d <= u.range) {
                if (u.cd <= 0) {
                    u.cd = u.baseCd;
                    let dmg = u.dmg;
                    if (u.crit && Math.random() < u.crit) dmg *= 2;
                    if (u.range < 35) {
                        applyDamage(b, target, dmg, u.dmgType, u.color);
                    } else {
                        b.projectiles.push({ x: u.x, y: u.y, target, dmg, dmgType: u.dmgType, speed: 9, color: u.color });
                    }
                }
            } else {
                const a = Math.atan2(target.y - u.y, target.x - u.x);
                u.x = clamp(u.x + Math.cos(a) * u.speed, 8, ARENA_W - 8);
                u.y = clamp(u.y + Math.sin(a) * u.speed, 8, ARENA_H - 8);
            }
        }
        // fx decay
        for (let i = b.particles.length - 1; i >= 0; i--) { const p = b.particles[i]; p.x += p.vx; p.y += p.vy; if (--p.life <= 0) b.particles.splice(i, 1); }
        for (let i = b.texts.length - 1; i >= 0; i--) { const t = b.texts[i]; t.y += t.vy; if (--t.life <= 0) b.texts.splice(i, 1); }
        // remove dead
        for (let i = b.units.length - 1; i >= 0; i--) if (b.units[i].hp <= 0) b.units.splice(i, 1);
        // outcome
        const mine = b.units.filter(u => u.side === 'me');
        const foe = b.units.filter(u => u.side === 'enemy');
        if (!mine.length || !foe.length || b.tick > 2200) {
            b.done = true;
            b.winner = mine.length && !foe.length ? 'me' : (foe.length && !mine.length ? 'enemy' : (mine.length >= foe.length ? 'me' : 'enemy'));
            b.survivors = b.winner === 'me' ? mine : foe;
        }
    }

    /* simulate a fight to the end, no rendering. returns {winner, survivors:[{star}]} */
    function simulateFight(boardA, boardB) {
        const b = buildBattle(boardA, boardB);
        let guard = 0;
        while (!b.done && guard++ < 4000) stepBattle(b);
        if (!b.done) { b.winner = b.units.filter(u => u.side === 'me').length >= b.units.filter(u => u.side === 'enemy').length ? 'me' : 'enemy'; b.survivors = b.units.filter(u => u.side === b.winner); }
        return { winner: b.winner, survivors: (b.survivors || []).map(u => ({ star: u.star })) };
    }

    /* ===== MATCHMAKING + ROUND RESOLUTION ===== */
    function alivePlayers() { return players.filter(p => !p.eliminated); }

    function assignedOpponent(p) {
        const others = alivePlayers().filter(o => o.id !== p.id);
        if (!others.length) return null;
        return others[(round + p.id) % others.length];
    }

    function roundDamage(round, survivors) {
        let dmg = Math.min(8, 2 + Math.floor(round / 3));
        survivors.forEach(s => dmg += s.star);
        return Math.min(22, dmg);
    }

    function resolveRound() {
        // human result animated separately; here resolve everyone, apply damage
        alivePlayers().forEach(p => {
            if (p.isHuman) return; // human handled by animation flow
            const opp = assignedOpponent(p);
            if (!opp) return;
            const res = simulateFight(p.board, opp.board);
            p._result = res;
        });
    }

    function applyResultsAndAdvance(humanResult) {
        // human
        const oppH = me._humanOpp;
        finishPlayerRound(me, humanResult, oppH);
        // bots
        alivePlayers().forEach(p => {
            if (p.isHuman) return;
            finishPlayerRound(p, p._result, assignedOpponent(p));
            p._result = null;
        });
        // eliminations
        players.forEach(p => {
            if (!p.eliminated && p.hp <= 0) {
                p.eliminated = true;
                addLog(`${p.name} has been eliminated!`, 'var(--bad)');
            }
        });
        const alive = alivePlayers();
        if (me.eliminated || alive.length <= 1) {
            endGame(alive.length === 1 ? alive[0] : null);
            return false;
        }
        return true;
    }

    function finishPlayerRound(p, res, opp) {
        if (!res || !opp) { return; }
        if (res.winner === 'me') {
            p.streak = p.streak >= 0 ? p.streak + 1 : 1;
        } else {
            p.streak = p.streak <= 0 ? p.streak - 1 : -1;
            const dmg = roundDamage(round, res.survivors);
            p.hp = Math.max(0, p.hp - dmg);
            if (p.isHuman) addLog(`Defeated by ${opp.name}. Lost ${dmg} HP (now ${p.hp}).`, 'var(--bad)');
        }
        if (p.isHuman && res.winner === 'me') addLog(`Victory over ${opp.name}! Streak ${p.streak}.`, 'var(--good)');
    }

    /* ===== ROUND FLOW ===== */
    function startShop(first) {
        phase = 'shop';
        clearSelection();
        alivePlayers().forEach(p => { applyIncome(p, first); rollShop(p); });
        // bots act
        alivePlayers().forEach(p => { if (!p.isHuman) botTurn(p); });
        // ui
        byId('combat-view').classList.add('hidden');
        byId('prep-view').classList.remove('hidden');
        setPhaseTag('Prep');
        renderAll();
        saveSession();
        startPrepTimer();
    }

    function startPrepTimer() {
        clearInterval(prepInterval);
        prepTimer = PREP_SECONDS; updateTimerUI();
        prepInterval = setInterval(() => {
            prepTimer--; updateTimerUI();
            if (prepTimer <= 0) { clearInterval(prepInterval); startCombat(); }
        }, 1000);
    }

    function fight() { if (phase !== 'shop') return; clearInterval(prepInterval); startCombat(); }

    function startCombat() {
        if (phase === 'combat') return;
        phase = 'combat'; clearSelection();
        setPhaseTag('Combat');
        // auto-place any leftover bench units onto open board cells for human (optional aid)
        resolveRound(); // computes bot results
        const opp = assignedOpponent(me);
        me._humanOpp = opp;
        byId('prep-view').classList.add('hidden');
        byId('combat-view').classList.remove('hidden');
        byId('combat-matchup').textContent = `${me.name}  vs  ${opp ? opp.name : '—'}`;
        byId('combat-result').classList.add('hidden');
        setupArenaCanvas();
        if (!opp) { setTimeout(() => endCombat({ winner: 'me', survivors: [] }), 500); return; }
        battle = buildBattle(me.board, opp.board);
        runBattleLoop();
    }

    let arenaCanvas, arenaCtx;
    function setupArenaCanvas() {
        arenaCanvas = byId('arena');
        arenaCanvas.width = ARENA_W; arenaCanvas.height = ARENA_H;
        arenaCtx = arenaCanvas.getContext('2d');
    }

    function runBattleLoop() {
        if (!battle) return;
        // run a few sim steps per frame for snappier combat
        for (let s = 0; s < 2 && !battle.done; s++) stepBattle(battle);
        drawArena();
        if (battle.done) {
            const res = { winner: battle.winner, survivors: (battle.survivors || []).map(u => ({ star: u.star })) };
            cancelAnimationFrame(rafId);
            setTimeout(() => endCombat(res), 700);
            return;
        }
        rafId = requestAnimationFrame(runBattleLoop);
    }

    function endCombat(humanResult) {
        // show result banner
        const banner = byId('combat-result');
        const win = humanResult.winner === 'me';
        banner.className = win ? 'result-win' : 'result-loss';
        banner.textContent = win ? 'ROUND WON' : 'ROUND LOST';
        banner.classList.remove('hidden');
        phase = 'post'; setPhaseTag('Result');
        const cont = applyResultsAndAdvance(humanResult);
        renderStandings(); renderPlayersStrip();
        if (!cont) return;
        setTimeout(() => { round++; startShop(false); }, POST_SECONDS * 1000);
    }

    /* ===== RENDER: ARENA ===== */
    function drawArena() {
        const ctx = arenaCtx; if (!ctx) return;
        ctx.clearRect(0, 0, ARENA_W, ARENA_H);
        // mid divider
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(0, ARENA_H / 2); ctx.lineTo(ARENA_W, ARENA_H / 2); ctx.stroke();
        // grid dots
        ctx.fillStyle = 'rgba(255,255,255,.04)';
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            const p = arenaPos(r, c, 'me'); ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill();
            const q = arenaPos(r, c, 'enemy'); ctx.beginPath(); ctx.arc(q.x, q.y, 2, 0, 7); ctx.fill();
        }
        // particles
        battle.particles.forEach(p => { ctx.globalAlpha = Math.max(0, p.life / 30); ctx.fillStyle = p.color; ctx.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); });
        ctx.globalAlpha = 1;
        // units
        battle.units.forEach(u => {
            // body
            ctx.save();
            ctx.shadowColor = u.color; ctx.shadowBlur = u.flash > 0 ? 18 : 8;
            ctx.fillStyle = u.flash > 0 ? '#fff' : (u.side === 'me' ? 'rgba(56,189,248,.22)' : 'rgba(251,113,133,.22)');
            ctx.strokeStyle = u.color; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(u.x, u.y, u.radius, 0, 7); ctx.fill(); ctx.stroke();
            ctx.restore();
            // icon
            ctx.fillStyle = '#fff'; ctx.font = `${u.radius + 4}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(u.icon, u.x, u.y + 1);
            // star pips
            if (u.star > 1) {
                ctx.fillStyle = u.star === 3 ? '#fbbf24' : '#e5e7eb'; ctx.font = '9px Inter';
                ctx.fillText('★'.repeat(u.star), u.x, u.y - u.radius - 6);
            }
            // hp bar
            const w = u.radius * 2, hpw = w * clamp(u.hp / u.maxHp, 0, 1);
            ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(u.x - u.radius, u.y - u.radius - 5, w, 3);
            ctx.fillStyle = u.side === 'me' ? '#34d399' : '#fb7185'; ctx.fillRect(u.x - u.radius, u.y - u.radius - 5, hpw, 3);
        });
        // projectiles
        battle.projectiles.forEach(pr => { ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, 7); ctx.fill(); });
        // floating texts
        battle.texts.forEach(t => { ctx.globalAlpha = Math.max(0, t.life / 32); ctx.fillStyle = t.color; ctx.font = 'bold 14px Roboto Mono'; ctx.textAlign = 'center'; ctx.fillText(t.text, t.x, t.y); });
        ctx.globalAlpha = 1;
    }

    /* ===== RENDER: PREP UI ===== */
    function renderAll() { renderBoard(); renderBench(); renderShop(); renderEcon(); renderStandings(); renderPlayersStrip(); }

    function chipHtml(unit, ctx) {
        const c = CLASSES[unit.name];
        const stars = unit.star > 1 ? `<span class="stars s${unit.star}">${'★'.repeat(unit.star)}</span>` : '';
        return `<div class="chip tier-${unit.tier} star-${unit.star}" data-name="${unit.name}"
                    style="--tc:${TIER_COLOR[unit.tier]}">
                    <span class="chip-icon">${c.icon}</span>${stars}
                </div>`;
    }

    function renderBoard() {
        const grid = byId('board-grid'); if (!grid) return;
        grid.style.setProperty('--cols', COLS);
        let html = '';
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            const k = boardKey(r, c); const u = me.board[k];
            html += `<div class="slot board-slot" data-zone="board" data-key="${k}">${u ? chipHtml(u) : ''}</div>`;
        }
        grid.innerHTML = html;
        bindSlots(grid);
        byId('board-cap').textContent = `${boardCount(me)}/${me.level}`;
    }

    function renderBench() {
        const grid = byId('bench-grid'); if (!grid) return;
        let html = '';
        for (let i = 0; i < BENCH_SIZE; i++) {
            const u = me.bench[i];
            html += `<div class="slot bench-slot" data-zone="bench" data-idx="${i}">${u ? chipHtml(u) : ''}</div>`;
        }
        grid.innerHTML = html;
        bindSlots(grid);
    }

    function renderShop() {
        const bar = byId('shop-cards'); if (!bar) return;
        bar.innerHTML = me.shop.map((name, i) => {
            if (!name) return `<div class="shop-card empty"></div>`;
            const c = CLASSES[name];
            return `<div class="shop-card tier-${c.tier}" style="--tc:${TIER_COLOR[c.tier]}" onclick="Game.buyShop(${i})">
                        <div class="sc-icon">${c.icon}</div>
                        <div class="sc-name">${name}</div>
                        <div class="sc-role">${c.role || ''}</div>
                        <div class="sc-cost"><span class="gc">⬤</span>${c.tier}</div>
                    </div>`;
        }).join('');
    }

    function renderEcon() {
        byId('gold-amt').textContent = Math.floor(me.gold);
        byId('lvl-num').textContent = me.level;
        const need = LEVEL_XP[me.level] || 0;
        byId('xp-text').textContent = me.level >= MAX_LEVEL ? 'MAX' : `${me.xp}/${need}`;
        byId('xp-fill').style.width = me.level >= MAX_LEVEL ? '100%' : `${(me.xp / need) * 100}%`;
        // disable states
        byId('reroll-btn').classList.toggle('disabled', me.gold < REROLL_COST);
        byId('buy-xp-btn').classList.toggle('disabled', me.gold < XP_COST || me.level >= MAX_LEVEL);
        document.querySelectorAll('.shop-card').forEach((el, i) => {
            const name = me.shop[i];
            if (name) el.classList.toggle('unaffordable', me.gold < CLASSES[name].tier);
        });
    }

    function renderPlayersStrip() {
        const strip = byId('players-strip'); if (!strip) return;
        strip.innerHTML = players.map(p => `
            <div class="pstrip-card ${p.eliminated ? 'dead' : ''} ${p.isHuman ? 'me' : ''}" style="--pc:${p.color.main}">
                <div class="ps-top"><span class="ps-name">${p.name}</span><span class="ps-lvl">L${p.level}</span></div>
                <div class="ps-hpbg"><div class="ps-hp" style="width:${clamp(p.hp, 0, 100)}%"></div></div>
                <div class="ps-foot"><span>${'❤'} ${Math.max(0, p.hp)}</span><span class="ps-streak">${streakIcon(p.streak)}</span></div>
            </div>`).join('');
    }

    function streakIcon(s) {
        if (s >= 2) return `<span style="color:var(--good)">▲${s}</span>`;
        if (s <= -2) return `<span style="color:var(--bad)">▼${-s}</span>`;
        return '';
    }

    function renderStandings() {
        const el = byId('standings'); if (!el) return;
        const sorted = [...players].sort((a, b) => (b.eliminated - a.eliminated) || b.hp - a.hp).sort((a, b) => a.eliminated - b.eliminated);
        el.innerHTML = sorted.map((p, i) => `
            <div class="stand-row ${p.eliminated ? 'dead' : ''}">
                <span class="st-rank">${i + 1}</span>
                <span class="st-dot" style="background:${p.color.main}"></span>
                <span class="st-name">${p.name}${p.isHuman ? ' (You)' : ''}</span>
                <span class="st-hp">${Math.max(0, p.hp)}</span>
            </div>`).join('');
    }

    /* ===== SLOT BINDING (tap + drag) ===== */
    function bindSlots(container) {
        container.querySelectorAll('.slot').forEach(slot => {
            const loc = slotLoc(slot);
            slot.onclick = () => selectSlot(loc);
            // drag source
            const chip = slot.querySelector('.chip');
            if (chip) {
                chip.setAttribute('draggable', 'true');
                chip.ondragstart = (e) => { e.dataTransfer.setData('text/plain', JSON.stringify(loc)); selected = loc; };
            }
            slot.ondragover = (e) => { e.preventDefault(); slot.classList.add('drop-hover'); };
            slot.ondragleave = () => slot.classList.remove('drop-hover');
            slot.ondrop = (e) => {
                e.preventDefault(); slot.classList.remove('drop-hover');
                try { const from = JSON.parse(e.dataTransfer.getData('text/plain')); moveUnit(from, loc); } catch (x) { }
                clearSelection();
            };
        });
        // sell zone
        const sell = byId('sell-zone');
        if (sell) {
            sell.ondragover = (e) => { e.preventDefault(); sell.classList.add('drop-hover'); };
            sell.ondragleave = () => sell.classList.remove('drop-hover');
            sell.ondrop = (e) => { e.preventDefault(); sell.classList.remove('drop-hover'); try { const from = JSON.parse(e.dataTransfer.getData('text/plain')); sellUnit(from); } catch (x) { } clearSelection(); };
            sell.onclick = () => { if (selected) { sellUnit(selected); clearSelection(); } };
        }
    }
    function slotLoc(slot) {
        return slot.dataset.zone === 'bench'
            ? { zone: 'bench', idx: +slot.dataset.idx }
            : { zone: 'board', key: slot.dataset.key };
    }

    /* ===== UI FEEDBACK ===== */
    function flashNoGold() { const g = byId('gold-amt'); if (g) { g.classList.remove('shake'); void g.offsetWidth; g.classList.add('shake'); } }
    function flashBoardCap() { const b = byId('board-cap'); if (b) { b.classList.remove('shake'); void b.offsetWidth; b.classList.add('shake'); } }
    function setPhaseTag(t) { const el = byId('phase-tag'); if (el) el.textContent = t; }
    function updateTimerUI() {
        const el = byId('phase-timer'); if (el) el.textContent = Math.max(0, prepTimer);
        const ring = byId('timer-ring');
        if (ring) ring.style.setProperty('--pct', `${(prepTimer / PREP_SECONDS) * 100}%`);
    }

    /* ===== SETUP / INIT ===== */
    function init(savedState) {
        byId('setup-overlay').classList.add('hidden');
        byId('game-root').classList.remove('hidden');
        byId('round-info').classList.remove('hidden');
        byId('panel-toggle').classList.remove('hidden');
        const user = Auth.getUser();

        if (savedState) {
            round = savedState.round || 1;
            players = savedState.players.map((sp, i) => hydratePlayer(sp, i, user));
        } else {
            const oppCount = +document.querySelector('#opp-select .seg.active').dataset.val;
            const total = oppCount + 1;
            players = [];
            for (let i = 0; i < total; i++) {
                players.push(newPlayer(i, i === 0, i === 0 ? user.username : `Agent ${i}`));
            }
            round = 1;
        }
        me = players[0];
        log = [];
        addLog('Match started. Build your board!', 'var(--accent)');
        startShop(true);
    }

    function newPlayer(id, isHuman, name) {
        return {
            id, name, isHuman, color: COLORS[id % COLORS.length],
            hp: 100, gold: 2, level: 2, xp: 0, streak: 0, eliminated: false,
            bench: Array(BENCH_SIZE).fill(null), board: {}, shop: []
        };
    }

    function hydratePlayer(sp, id, user) {
        const p = newPlayer(id, sp.isHuman, sp.isHuman ? user.username : sp.name);
        p.hp = sp.hp; p.gold = sp.gold; p.level = sp.level; p.xp = sp.xp;
        p.streak = sp.streak; p.eliminated = sp.eliminated;
        p.bench = (sp.bench || []).map(u => u ? makeUnit(u.name, u.star) : null);
        while (p.bench.length < BENCH_SIZE) p.bench.push(null);
        p.board = {};
        Object.entries(sp.board || {}).forEach(([k, u]) => { if (u) p.board[k] = makeUnit(u.name, u.star); });
        return p;
    }

    /* ===== SESSION ===== */
    async function saveSession() {
        if (!Auth.getToken()) return;
        const serial = (u) => u ? { name: u.name, star: u.star } : null;
        const state = {
            round,
            players: players.map(p => ({
                name: p.name, isHuman: p.isHuman, hp: p.hp, gold: p.gold, level: p.level,
                xp: p.xp, streak: p.streak, eliminated: p.eliminated,
                bench: p.bench.map(serial),
                board: Object.fromEntries(Object.entries(p.board).map(([k, u]) => [k, serial(u)]))
            }))
        };
        try {
            await fetch('/api/session/save', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Auth.getToken()}` },
                body: JSON.stringify({ state })
            });
        } catch (e) { }
    }

    let pendingState = null;
    async function checkActiveSession() {
        try {
            const res = await fetch('/api/session/active', { headers: { Authorization: `Bearer ${Auth.getToken()}` } });
            const data = await res.json();
            if (data.hasActive && data.state && data.state.players) {
                pendingState = data.state;
                byId('resume-overlay').classList.remove('hidden');
                return;
            }
        } catch (e) { }
        byId('setup-overlay').classList.remove('hidden');
        bindSetup();
    }

    function resume() { byId('resume-overlay').classList.add('hidden'); init(pendingState); }
    function startFresh() {
        byId('resume-overlay').classList.add('hidden');
        byId('setup-overlay').classList.remove('hidden');
        bindSetup();
        fetch('/api/session/clear', { method: 'POST', headers: { Authorization: `Bearer ${Auth.getToken()}` } }).catch(() => { });
    }

    function bindSetup() {
        document.querySelectorAll('#opp-select .seg').forEach(seg => {
            seg.onclick = () => {
                document.querySelectorAll('#opp-select .seg').forEach(s => s.classList.remove('active'));
                seg.classList.add('active');
            };
        });
    }

    /* ===== END GAME ===== */
    async function endGame(winner) {
        phase = 'over'; clearInterval(prepInterval); cancelAnimationFrame(rafId);
        const win = winner && winner.isHuman;
        const overlay = byId('victory-overlay');
        byId('victory-icon').textContent = win ? '👑' : '💀';
        byId('victory-text').textContent = win ? 'VICTORY' : 'DEFEAT';
        byId('victory-text').style.color = win ? 'var(--gold)' : 'var(--bad)';
        byId('victory-sub').textContent = win
            ? `You are the last commander standing after ${round} rounds.`
            : `Eliminated on round ${round}. ${winner ? winner.name + ' took the crown.' : ''}`;
        overlay.classList.remove('hidden');

        const user = Auth.getUser();
        try {
            await fetch('/api/session/clear', { method: 'POST', headers: { Authorization: `Bearer ${Auth.getToken()}` } });
            await fetch('/api/game/end', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Auth.getToken()}` },
                body: JSON.stringify({ winnerId: user.id, duration: round, result: win ? 'win' : 'loss' })
            });
        } catch (e) { }
    }

    return {
        fetchUnits, checkActiveSession, init, resume, startFresh,
        buyShop, reroll, buyXP, autoFill, fight
    };
})();

/* ---------------- UI helpers ---------------- */
const UI = (function () {
    function togglePanel() { document.getElementById('side-panel').classList.toggle('open'); }
    return { togglePanel };
})();

window.onload = () => Auth.checkSession();
