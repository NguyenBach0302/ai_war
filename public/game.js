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

    const TIER_COLOR = { 1: '#9ca3af', 2: '#34d399', 3: '#38bdf8', 4: '#c084fc', 5: '#fbbf24' };

    /* ===== ELEMENTAL THEMES =====
       Each class has a theme that drives its entire visual identity:
       body tint, projectile look, skill FX, particle colors. */
    const THEMES = {
        steel:    { c: '#cbd5e1', glow: 'rgba(203,213,225,.55)', spark: '#e2e8f0' },
        wind:     { c: '#86efac', glow: 'rgba(134,239,172,.5)',  spark: '#bbf7d0' },
        fire:     { c: '#fb923c', glow: 'rgba(251,146,60,.6)',   spark: '#fde047' },
        holy:     { c: '#fde68a', glow: 'rgba(253,230,138,.6)',  spark: '#fffbeb' },
        shadow:   { c: '#a78bfa', glow: 'rgba(124,58,237,.55)',  spark: '#1e1b4b' },
        ice:      { c: '#7dd3fc', glow: 'rgba(125,211,252,.55)', spark: '#e0f2fe' },
        nature:   { c: '#4ade80', glow: 'rgba(74,222,128,.5)',   spark: '#a3e635' },
        blood:    { c: '#f87171', glow: 'rgba(239,68,68,.6)',    spark: '#fca5a5' },
        storm:    { c: '#67e8f9', glow: 'rgba(103,232,249,.6)',  spark: '#fef08a' },
        void:     { c: '#c084fc', glow: 'rgba(168,85,247,.55)',  spark: '#86efac' },
        arcane:   { c: '#f0abfc', glow: 'rgba(217,70,239,.6)',   spark: '#a5f3fc' },
        death:    { c: '#94a3b8', glow: 'rgba(100,116,139,.5)',  spark: '#bef264' }
    };

    /* ===== CLASS ROSTER (source of truth) =====
       Brand-new set. Every class has a clear role, an element theme, a mana
       pool and a signature ability that fires in combat with bespoke FX.
       cd = ticks between basic attacks. mana = cost to cast the ability.
       range < 35 == melee.  ability == key into ABILITIES map. */
    const CLASS_DATA = {
        // ---- Tier 1 ----
        Footman:   { tier: 1, icon: '🛡️', theme: 'steel',  role: 'Bruiser',  hp: 150, dmg: 16, range: 26, speed: 1.2, cd: 36, dmgType: 'physical', armor: 35, mres: 20, mana: 50, ability: 'shieldBash', desc: 'Shield Bash: stun + knock the front line.' },
        Archer:    { tier: 1, icon: '🏹', theme: 'wind',   role: 'Ranger',   hp: 90,  dmg: 14, range: 165, speed: 1.2, cd: 30, dmgType: 'physical', armor: 10, mres: 10, mana: 45, ability: 'multishot', desc: 'Multishot: a volley of piercing arrows.' },
        Pyromancer:{ tier: 1, icon: '🔥', theme: 'fire',   role: 'Mage',     hp: 80,  dmg: 18, range: 145, speed: 0.9, cd: 42, dmgType: 'magic',    armor: 5,  mres: 15, mana: 55, ability: 'flameburst', desc: 'Flameburst: AoE blast that ignites the ground.' },
        Acolyte:   { tier: 1, icon: '✨', theme: 'holy',   role: 'Healer',   hp: 95,  dmg: 8,  range: 130, speed: 1.0, cd: 40, dmgType: 'magic',    armor: 10, mres: 25, mana: 40, ability: 'mend', desc: 'Mend: heal the lowest ally and shield them.' },
        // ---- Tier 2 ----
        Knight:    { tier: 2, icon: '⚔️', theme: 'steel',  role: 'Tank',     hp: 240, dmg: 18, range: 28, speed: 1.0, cd: 40, dmgType: 'physical', armor: 60, mres: 40, mana: 60, ability: 'guardian', desc: 'Guardian: huge shield + taunt enemies.' },
        Rogue:     { tier: 2, icon: '🗡️', theme: 'shadow', role: 'Assassin', hp: 95,  dmg: 30, range: 22, speed: 1.9, cd: 26, dmgType: 'physical', armor: 12, mres: 12, crit: 0.4, mana: 45, ability: 'shadowstrike', desc: 'Shadowstrike: blink to the backline, lethal crit.' },
        Frostmage: { tier: 2, icon: '❄️', theme: 'ice',    role: 'Control',  hp: 90,  dmg: 16, range: 140, speed: 0.9, cd: 44, dmgType: 'magic',    armor: 8,  mres: 18, mana: 55, ability: 'frostnova', desc: 'Frost Nova: chill and freeze a cluster of foes.' },
        Druid:     { tier: 2, icon: '🐺', theme: 'nature', role: 'Summoner', hp: 130, dmg: 18, range: 110, speed: 1.0, cd: 40, dmgType: 'magic',    armor: 18, mres: 18, mana: 60, ability: 'summonWolf', desc: 'Wild Call: summon a wolf to fight beside you.' },
        // ---- Tier 3 ----
        Berserker: { tier: 3, icon: '🪓', theme: 'blood',  role: 'Burst',    hp: 170, dmg: 34, range: 24, speed: 1.5, cd: 30, dmgType: 'physical', armor: 25, mres: 15, mana: 50, ability: 'rage', desc: 'Bloodrage: frenzied attack speed + lifesteal.' },
        Stormcaller:{tier: 3, icon: '⚡', theme: 'storm',  role: 'AreaDPS',  hp: 95,  dmg: 22, range: 150, speed: 0.9, cd: 46, dmgType: 'magic',    armor: 8,  mres: 16, mana: 65, ability: 'chainlightning', desc: 'Chain Lightning: arcs between several enemies.' },
        Paladin:   { tier: 3, icon: '🌟', theme: 'holy',   role: 'Support',  hp: 220, dmg: 22, range: 30, speed: 1.0, cd: 40, dmgType: 'magic',    armor: 45, mres: 40, mana: 65, ability: 'aegis', desc: 'Aegis: shield all allies and smite a foe.' },
        Warlock:   { tier: 3, icon: '☠️', theme: 'void',   role: 'Control',  hp: 110, dmg: 18, range: 140, speed: 0.9, cd: 44, dmgType: 'magic',    armor: 10, mres: 20, mana: 60, ability: 'curse', desc: 'Curse: spreading poison that shreds armor.' },
        // ---- Tier 4 ----
        Dragoon:   { tier: 4, icon: '🐉', theme: 'fire',   role: 'Mobility', hp: 180, dmg: 40, range: 26, speed: 1.4, cd: 34, dmgType: 'physical', armor: 30, mres: 25, mana: 55, ability: 'leapstrike', desc: 'Leap Strike: dive the backline with a fiery crash.' },
        Necromancer:{tier: 4, icon: '💀', theme: 'death',  role: 'Summoner', hp: 130, dmg: 22, range: 135, speed: 0.9, cd: 44, dmgType: 'magic',    armor: 12, mres: 22, mana: 70, ability: 'raisedead', desc: 'Raise Dead: a shadow nova that summons skeletons.' },
        Valkyrie:  { tier: 4, icon: '👼', theme: 'holy',   role: 'Hybrid',   hp: 150, dmg: 26, range: 125, speed: 1.1, cd: 38, dmgType: 'magic',    armor: 22, mres: 28, mana: 60, ability: 'divinevolley', desc: 'Divine Volley: heal allies while smiting enemies.' },
        // ---- Tier 5 ----
        Archmage:  { tier: 5, icon: '🌀', theme: 'arcane', role: 'AreaDPS',  hp: 130, dmg: 30, range: 160, speed: 0.8, cd: 50, dmgType: 'true', armor: 10, mres: 30, mana: 80, ability: 'meteor', desc: 'Meteor: a telegraphed cataclysm of arcane fire.' }
    };

    // Star scaling for hp / damage.
    const STAR_HP = { 1: 1, 2: 1.8, 3: 3.2 };
    const STAR_DMG = { 1: 1, 2: 1.8, 3: 3.4 };

    // Shop tier odds by level (percent for tiers 1..5).
    const SHOP_ODDS = {
        1: [100, 0, 0, 0, 0], 2: [70, 30, 0, 0, 0], 3: [55, 35, 10, 0, 0],
        4: [45, 35, 16, 4, 0], 5: [38, 33, 21, 7, 1], 6: [30, 30, 26, 12, 2],
        7: [24, 28, 30, 15, 3], 8: [18, 24, 32, 21, 5], 9: [14, 20, 33, 26, 7]
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

    /* ===== DATA LOAD =====
       The client roster (CLASS_DATA) is the single source of truth so the new
       classes are guaranteed live regardless of any stale DB seed. */
    function loadClasses() {
        CLASSES = {}; POOL = [];
        Object.entries(CLASS_DATA).forEach(([name, c]) => {
            CLASSES[name] = {
                name, icon: c.icon, hp: c.hp, dmg: c.dmg, range: c.range,
                speed: c.speed, cd: c.cd, role: c.role, dmgType: c.dmgType,
                tier: c.tier, armor: c.armor, mres: c.mres, crit: c.crit || 0,
                theme: c.theme, mana: c.mana, ability: c.ability, desc: c.desc,
                melee: c.range < 35
            };
        });
        POOL = Object.values(CLASSES);
    }

    async function fetchUnits() { loadClasses(); }

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
        for (let t = 0; t < 5; t++) { acc += odds[t]; if (r < acc) return t + 1; }
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

    /* ===== COMBAT TUNING ===== */
    const MANA_PER_ATTACK = 10, MANA_PER_HIT = 4;
    const THEME_PROJECTILE = {
        fire: 'fire', ice: 'frost', wind: 'arrow', storm: 'bolt', arcane: 'arcane',
        holy: 'holy', shadow: 'shadow', nature: 'leaf', death: 'skull', void: 'void',
        blood: 'orb', steel: 'orb'
    };
    const SUMMON_DATA = {
        Wolf:     { icon: '🐺', theme: 'nature', hp: 70, dmg: 14, range: 22, speed: 1.7, cd: 22, dmgType: 'physical', armor: 12, mres: 8, ttl: 540 },
        Skeleton: { icon: '💀', theme: 'death',  hp: 55, dmg: 12, range: 24, speed: 1.3, cd: 28, dmgType: 'physical', armor: 8,  mres: 8, ttl: 540 }
    };

    function freshStatus(u) {
        u.shield = 0; u.shieldMax = 0;
        u.atkSpeedMult = 1; u.atkSpeedT = 0;
        u.lifesteal = 0; u.lifestealT = 0;
        u.slowMult = 1; u.slowT = 0;
        u.stunT = 0; u.shredT = 0;
        u.rageT = 0; u.tauntBy = null; u.tauntT = 0;
        u.dots = []; u.castFx = 0;
    }

    function makeCombatUnit(unit, side, r, c) {
        const m = CLASSES[unit.name];
        const sh = STAR_HP[unit.star], sd = STAR_DMG[unit.star];
        const pos = arenaPos(r, c, side);
        const th = THEMES[m.theme] || THEMES.steel;
        const u = {
            side, name: unit.name, star: unit.star, icon: m.icon,
            x: pos.x, y: pos.y, hx: pos.x, hy: pos.y, radius: 14 + unit.star * 2.5,
            maxHp: Math.round(m.hp * sh), hp: Math.round(m.hp * sh),
            dmg: m.dmg * sd, range: m.range, speed: m.speed * 1.5,
            cd: Math.floor(Math.random() * 18), baseCd: m.cd,
            dmgType: m.dmgType, armor: m.armor, mres: m.mres,
            crit: m.crit || 0, role: m.role, melee: m.melee,
            theme: m.theme, themeColor: th.c, themeGlow: th.glow, spark: th.spark,
            kind: THEME_PROJECTILE[m.theme] || 'orb',
            mana: 0, maxMana: m.mana || 999, ability: m.ability,
            color: side === 'me' ? me.color.main : '#fb7185',
            flash: 0, facing: side === 'me' ? -1 : 1, bob: Math.random() * 6.28
        };
        u.mana = Math.floor(Math.random() * u.maxMana * 0.4);
        freshStatus(u);
        return u;
    }

    function spawnSummon(b, owner, type, ox, oy) {
        const s = SUMMON_DATA[type]; if (!s) return;
        const th = THEMES[s.theme];
        const st = owner.star;
        const u = {
            side: owner.side, name: type, star: st, icon: s.icon, isSummon: true,
            x: ox, y: oy, hx: ox, hy: oy, radius: 11 + st,
            maxHp: Math.round(s.hp * (0.7 + 0.5 * st)), hp: Math.round(s.hp * (0.7 + 0.5 * st)),
            dmg: s.dmg * (0.7 + 0.5 * st), range: s.range, speed: s.speed * 1.5,
            cd: 6, baseCd: s.cd, dmgType: s.dmgType, armor: s.armor, mres: s.mres,
            crit: 0, role: 'Summon', melee: s.range < 35, theme: s.theme,
            themeColor: th.c, themeGlow: th.glow, spark: th.spark, kind: THEME_PROJECTILE[s.theme] || 'orb',
            mana: 0, maxMana: 99999, ability: null, ttl: s.ttl,
            color: owner.side === 'me' ? me.color.main : '#fb7185',
            flash: 0, facing: owner.facing, bob: Math.random() * 6.28
        };
        freshStatus(u);
        b.units.push(u);
        fxBurst(b, ox, oy, th.spark, 14, 3.5);
        fxRing(b, ox, oy, 4, 28, th.c, 22);
    }

    function buildBattle(boardA, boardB) {
        const units = [];
        Object.entries(boardA).forEach(([k, u]) => { const [r, c] = k.split('-').map(Number); units.push(makeCombatUnit(u, 'me', r, c)); });
        Object.entries(boardB).forEach(([k, u]) => { const [r, c] = k.split('-').map(Number); units.push(makeCombatUnit(u, 'enemy', r, c)); });
        return { units, projectiles: [], particles: [], texts: [], fx: [], strikes: [], tick: 0, done: false, winner: null };
    }

    /* ===== TARGETING HELPERS ===== */
    function nearestEnemy(b, u) {
        let best = null, bd = Infinity;
        for (const e of b.units) {
            if (e.side === u.side || e.hp <= 0) continue;
            const d = dist(u, e); if (d < bd) { bd = d; best = e; }
        }
        return { target: best, d: bd };
    }
    function farthestEnemy(b, u) {
        let best = null, bd = -1;
        for (const e of b.units) {
            if (e.side === u.side || e.hp <= 0) continue;
            const d = dist(u, e); if (d > bd) { bd = d; best = e; }
        }
        return best;
    }
    function weakestEnemy(b, u) {
        let best = null, bv = Infinity;
        for (const e of b.units) {
            if (e.side === u.side || e.hp <= 0) continue;
            if (e.hp < bv) { bv = e.hp; best = e; }
        }
        return best;
    }
    function enemiesNear(b, side, x, y, rad) {
        return b.units.filter(e => e.side !== side && e.hp > 0 && Math.hypot(e.x - x, e.y - y) <= rad);
    }
    function alliesNear(b, side, x, y, rad, incl, self) {
        return b.units.filter(a => a.side === side && a.hp > 0 && (incl || a !== self) && Math.hypot(a.x - x, a.y - y) <= rad);
    }
    function lowestAlly(b, u, maxD, inclSelf) {
        let best = null, bestRatio = 2;
        for (const a of b.units) {
            if (a.side !== u.side || a.hp <= 0 || (!inclSelf && a === u)) continue;
            if (dist(u, a) > maxD) continue;
            const ratio = a.hp / a.maxHp;
            if (ratio < bestRatio) { bestRatio = ratio; best = a; }
        }
        return best;
    }

    /* ===== STATUS APPLICATION ===== */
    function addShield(t, amt, ttl) { t.shield += amt; t.shieldMax = Math.max(t.shieldMax, t.shield); t.shieldT = ttl; }
    function applySlow(t, mult, ttl) { t.slowMult = Math.min(t.slowMult, mult); t.slowT = Math.max(t.slowT, ttl); }
    function applyStun(t, ttl) { t.stunT = Math.max(t.stunT, ttl); }
    function applyShred(t, ttl) { t.shredT = Math.max(t.shredT, ttl); }
    function addDot(t, dps, ttl, interval, theme, dmgType) {
        t.dots.push({ dps, t: ttl, interval, tick: interval, theme, dmgType: dmgType || 'magic' });
        if (t.dots.length > 4) t.dots.shift();
    }

    /* ===== DAMAGE ===== */
    function effArmor(t) { return t.armor * (t.shredT > 0 ? 0.5 : 1); }

    function dealDamage(b, target, dmg, dmgType, opt) {
        opt = opt || {};
        if (!target || target.hp <= 0) return 0;
        let f = dmg;
        if (dmgType !== 'true') {
            const res = dmgType === 'magic' ? target.mres : effArmor(target);
            f *= (1 - getReduction(res));
        }
        f = Math.max(1, f);
        let absorbed = 0;
        if (target.shield > 0) { absorbed = Math.min(target.shield, f); target.shield -= absorbed; f -= absorbed; }
        target.hp -= f;
        target.flash = 6;
        target.mana = Math.min(target.maxMana, target.mana + MANA_PER_HIT);
        if (opt.text !== false) {
            const shown = Math.round(f + absorbed);
            b.texts.push({
                x: target.x + (Math.random() - .5) * 10, y: target.y - 12,
                text: (opt.crit ? '✦' : '') + '-' + shown, color: opt.color || (opt.crit ? '#fde047' : '#fff'),
                life: opt.crit ? 42 : 30, vy: -0.95, size: opt.crit ? 19 : 14
            });
        }
        if (absorbed > 0) fxShieldHit(b, target);
        fxImpact(b, target.x, target.y, opt.color || target.themeColor || '#fff', opt.crit ? 1.7 : 1);
        return f;
    }
    // back-compat alias
    function applyDamage(b, target, dmg, dmgType, color) { return dealDamage(b, target, dmg, dmgType, { color }); }

    function healUnit(b, t, amt) {
        const real = Math.min(amt, t.maxHp - t.hp);
        t.hp = Math.min(t.maxHp, t.hp + amt);
        if (real > 0) {
            b.texts.push({ x: t.x + (Math.random() - .5) * 8, y: t.y - 12, text: '+' + Math.round(real), color: '#4ade80', life: 34, vy: -0.9, size: 14 });
            fxHeal(b, t.x, t.y);
        }
        return real;
    }

    /* ===== FX SPAWNERS (bounded) ===== */
    function fxCap(b) { return b.fx.length < 240; }
    function fxRing(b, x, y, r0, r1, color, life, width) { if (fxCap(b)) b.fx.push({ type: 'ring', x, y, r0, r1, color, life, max: life, w: width || 3 }); }
    function fxTelegraph(b, x, y, r, life, color) { if (fxCap(b)) b.fx.push({ type: 'telegraph', x, y, r, life, max: life, color }); }
    function fxGround(b, x, y, r, color, life) { if (fxCap(b)) b.fx.push({ type: 'ground', x, y, r, color, life, max: life }); }
    function fxBeam(b, x1, y1, x2, y2, color, life, w) { if (fxCap(b)) b.fx.push({ type: 'beam', x1, y1, x2, y2, color, life, max: life, w: w || 5 }); }
    function fxBolt(b, pts, color, life) { if (fxCap(b)) b.fx.push({ type: 'bolt', pts, color, life, max: life }); }
    function fxBlink(b, x1, y1, x2, y2, color) { if (fxCap(b)) b.fx.push({ type: 'blink', x1, y1, x2, y2, color, life: 16, max: 16 }); }
    function fxSlash(b, x, y, ang, color, scale) { if (fxCap(b)) b.fx.push({ type: 'slash', x, y, ang, color, scale: scale || 1, life: 14, max: 14 }); }
    function fxImpact(b, x, y, color, scale) { if (fxCap(b)) b.fx.push({ type: 'impact', x, y, color, scale: scale || 1, life: 12, max: 12 }); }
    function fxShieldHit(b, t) { if (fxCap(b)) b.fx.push({ type: 'shieldhit', unit: t, life: 12, max: 12 }); }
    function fxHeal(b, x, y) { if (fxCap(b)) b.fx.push({ type: 'heal', x, y, life: 26, max: 26 }); spawnParticles(b, x, y, '#4ade80', 5, 1.6, -1.4); }
    function fxCast(b, u, color) { if (fxCap(b)) b.fx.push({ type: 'cast', unit: u, color, life: 22, max: 22 }); }

    function spawnParticles(b, x, y, color, n, spread, vyBias) {
        if (b.particles.length > 220) return;
        spread = spread || 4;
        for (let i = 0; i < n; i++) {
            b.particles.push({
                x, y, vx: (Math.random() - .5) * spread, vy: (Math.random() - .5) * spread + (vyBias || 0),
                life: 18 + Math.random() * 16, max: 34, color, g: 0
            });
        }
    }
    function fxBurst(b, x, y, color, n, spread) { spawnParticles(b, x, y, color, n, spread, 0); }

    /* ===== ABILITIES =====
       Each fires once when a unit's mana is full. ctx = {target, d}. */
    const ABILITIES = {
        shieldBash(b, u) {
            const hits = enemiesNear(b, u.side, u.x, u.y, 78).slice(0, 3 + u.star);
            fxRing(b, u.x, u.y, 6, 80, u.themeColor, 22, 5);
            fxBurst(b, u.x, u.y, u.spark, 12, 4);
            hits.forEach(e => {
                dealDamage(b, e, u.dmg * 1.6, 'physical', { color: u.themeColor });
                applyStun(e, 26 + 4 * u.star);
                const a = Math.atan2(e.y - u.y, e.x - u.x);
                e.x = clamp(e.x + Math.cos(a) * 14, 8, ARENA_W - 8);
                e.y = clamp(e.y + Math.sin(a) * 14, 8, ARENA_H - 8);
            });
        },
        multishot(b, u) {
            const foes = [...b.units].filter(e => e.side !== u.side && e.hp > 0)
                .sort((a, c) => dist(u, a) - dist(u, c)).slice(0, 3 + Math.floor(u.star / 2));
            foes.forEach((e, i) => {
                spawnProjectile(b, u, e, u.dmg * 1.0, u.dmgType, { kind: 'arrow', speed: 13, spread: i });
            });
            fxBurst(b, u.x, u.y, u.spark, 6, 3);
        },
        flameburst(b, u) {
            const t = nearestEnemy(b, u).target; if (!t) return;
            b.strikes.push({ x: t.x, y: t.y, r: 76, delay: 8, dmg: u.dmg * 1.7, dmgType: 'magic', theme: 'fire', side: u.side, burn: u.dmg * 0.22, color: '#fb923c' });
            fxTelegraph(b, t.x, t.y, 76, 8, '#fb923c');
        },
        mend(b, u) {
            const ally = lowestAlly(b, u, 9999, true) || u;
            healUnit(b, ally, 55 + 28 * u.star);
            addShield(ally, 24 + 14 * u.star, 260);
            fxBeam(b, u.x, u.y, ally.x, ally.y, '#fde68a', 16, 3);
            fxRing(b, ally.x, ally.y, 4, 30, '#fde68a', 22, 3);
        },
        guardian(b, u) {
            addShield(u, 120 + 70 * u.star, 360);
            const foes = enemiesNear(b, u.side, u.x, u.y, 120);
            foes.forEach(e => { e.tauntBy = u; e.tauntT = 130; });
            fxCast(b, u, u.themeColor);
            fxRing(b, u.x, u.y, 8, 120, u.themeColor, 26, 4);
        },
        shadowstrike(b, u) {
            const t = weakestEnemy(b, u) || farthestEnemy(b, u); if (!t) return;
            const ox = u.x, oy = u.y;
            const a = Math.atan2(u.y - t.y, u.x - t.x);
            u.x = clamp(t.x + Math.cos(a) * 26, 8, ARENA_W - 8);
            u.y = clamp(t.y + Math.sin(a) * 26, 8, ARENA_H - 8);
            fxBlink(b, ox, oy, u.x, u.y, '#a78bfa');
            spawnParticles(b, ox, oy, '#1e1b4b', 10, 3);
            spawnParticles(b, u.x, u.y, '#1e1b4b', 8, 3);
            fxSlash(b, t.x, t.y, Math.atan2(t.y - u.y, t.x - u.x), '#c4b5fd', 1.4);
            dealDamage(b, t, u.dmg * 3.2, 'physical', { crit: true, color: '#c4b5fd' });
            u.atkSpeedMult = 1.6; u.atkSpeedT = 90;
        },
        frostnova(b, u) {
            const t = nearestEnemy(b, u).target; if (!t) return;
            fxRing(b, t.x, t.y, 6, 88, '#7dd3fc', 28, 4);
            fxGround(b, t.x, t.y, 78, 'rgba(125,211,252,.18)', 70);
            enemiesNear(b, u.side, t.x, t.y, 88).forEach((e, i) => {
                dealDamage(b, e, u.dmg * 1.25, 'magic', { color: '#7dd3fc' });
                applySlow(e, 0.45, 150);
                if (dist(t, e) < 46) applyStun(e, 22 + 3 * u.star);
                spawnParticles(b, e.x, e.y, '#e0f2fe', 5, 3);
            });
        },
        summonWolf(b, u) {
            const n = 1 + Math.floor(u.star / 2);
            for (let i = 0; i < n; i++) {
                const ox = clamp(u.x + (Math.random() - .5) * 40, 12, ARENA_W - 12);
                const oy = clamp(u.y + u.facing * (20 + i * 14), 12, ARENA_H - 12);
                spawnSummon(b, u, 'Wolf', ox, oy);
            }
            fxCast(b, u, u.themeColor);
        },
        rage(b, u) {
            u.atkSpeedMult = 2.0; u.atkSpeedT = 200; u.rageT = 200;
            u.lifesteal = 0.4; u.lifestealT = 200;
            healUnit(b, u, 30 + 15 * u.star);
            fxCast(b, u, '#f87171');
            fxRing(b, u.x, u.y, 6, 46, '#f87171', 24, 4);
            spawnParticles(b, u.x, u.y, '#fca5a5', 14, 4, -1);
        },
        chainlightning(b, u) {
            const hitSet = new Set();
            let cur = nearestEnemy(b, u).target; if (!cur) return;
            let from = u, dmg = u.dmg * 1.5;
            const pts = [{ x: u.x, y: u.y }];
            const bounces = 3 + u.star;
            for (let i = 0; i < bounces && cur; i++) {
                pts.push({ x: cur.x, y: cur.y });
                dealDamage(b, cur, dmg, 'magic', { color: '#67e8f9' });
                spawnParticles(b, cur.x, cur.y, '#fef08a', 5, 3);
                hitSet.add(cur);
                dmg *= 0.78; from = cur;
                let next = null, nd = 130;
                for (const e of b.units) {
                    if (e.side === u.side || e.hp <= 0 || hitSet.has(e)) continue;
                    const dd = dist(from, e); if (dd < nd) { nd = dd; next = e; }
                }
                cur = next;
            }
            fxBolt(b, pts, '#a5f3fc', 16);
        },
        aegis(b, u) {
            alliesNear(b, u.side, u.x, u.y, 160, true, u).forEach(a => {
                addShield(a, 60 + 35 * u.star, 320);
                fxRing(b, a.x, a.y, 4, a.radius + 14, '#fde68a', 22, 3);
            });
            const t = nearestEnemy(b, u).target;
            if (t) { fxBeam(b, t.x, t.y - 120, t.x, t.y, '#fffbeb', 18, 8); dealDamage(b, t, u.dmg * 2.0, 'magic', { color: '#fde68a' }); }
            fxCast(b, u, '#fde68a');
        },
        curse(b, u) {
            const t = nearestEnemy(b, u).target; if (!t) return;
            enemiesNear(b, u.side, t.x, t.y, 70).forEach(e => {
                addDot(e, u.dmg * 0.32, 180, 18, 'void', 'magic');
                applyShred(e, 220);
                fxGround(b, e.x, e.y, 22, 'rgba(168,85,247,.16)', 60);
                spawnParticles(b, e.x, e.y, '#86efac', 6, 2.4, -.6);
            });
            fxRing(b, t.x, t.y, 6, 72, '#c084fc', 24, 4);
        },
        leapstrike(b, u) {
            const t = farthestEnemy(b, u) || nearestEnemy(b, u).target; if (!t) return;
            const ox = u.x, oy = u.y;
            u.x = clamp(t.x, 8, ARENA_W - 8); u.y = clamp(t.y - u.facing * 22, 8, ARENA_H - 8);
            fxBlink(b, ox, oy, u.x, u.y, '#fb923c');
            fxRing(b, u.x, u.y, 6, 80, '#fb923c', 24, 5);
            spawnParticles(b, u.x, u.y, '#fde047', 16, 4.5);
            enemiesNear(b, u.side, u.x, u.y, 78).forEach(e => {
                dealDamage(b, e, u.dmg * 2.0, 'physical', { color: '#fb923c' });
                applyStun(e, 18);
            });
        },
        raisedead(b, u) {
            const t = nearestEnemy(b, u).target;
            const cx = t ? t.x : u.x, cy = t ? t.y : u.y;
            fxRing(b, cx, cy, 6, 84, '#94a3b8', 26, 4);
            fxGround(b, cx, cy, 70, 'rgba(100,116,139,.18)', 70);
            enemiesNear(b, u.side, cx, cy, 84).forEach(e => {
                dealDamage(b, e, u.dmg * 1.3, 'magic', { color: '#bef264' });
                spawnParticles(b, e.x, e.y, '#bef264', 5, 3);
            });
            const n = 1 + Math.floor(u.star / 2);
            for (let i = 0; i < n; i++) {
                const ox = clamp(u.x + (Math.random() - .5) * 44, 12, ARENA_W - 12);
                const oy = clamp(u.y + u.facing * (18 + i * 14), 12, ARENA_H - 12);
                spawnSummon(b, u, 'Skeleton', ox, oy);
            }
        },
        divinevolley(b, u) {
            alliesNear(b, u.side, u.x, u.y, 170, true, u).forEach(a => healUnit(b, a, 38 + 20 * u.star));
            const foes = [...b.units].filter(e => e.side !== u.side && e.hp > 0)
                .sort((a, c) => dist(u, a) - dist(u, c)).slice(0, 3);
            foes.forEach(e => spawnProjectile(b, u, e, u.dmg * 1.2, 'magic', { kind: 'holy', speed: 11 }));
            fxCast(b, u, '#fde68a');
            spawnParticles(b, u.x, u.y, '#fffbeb', 12, 3, -1.2);
        },
        meteor(b, u) {
            const t = nearestEnemy(b, u).target; if (!t) return;
            b.strikes.push({ x: t.x, y: t.y, r: 96, delay: 42, dmg: u.dmg * 2.4, dmgType: 'true', theme: 'arcane', side: u.side, burn: u.dmg * 0.2, color: '#f0abfc', meteor: true });
            fxTelegraph(b, t.x, t.y, 96, 42, '#f0abfc');
        }
    };

    function spawnProjectile(b, u, target, dmg, dmgType, opt) {
        opt = opt || {};
        const a = Math.atan2(target.y - u.y, target.x - u.x) + (opt.spread ? (opt.spread - 1) * 0.12 : 0);
        b.projectiles.push({
            x: u.x, y: u.y, target, dmg, dmgType, owner: u,
            speed: opt.speed || 9, color: opt.color || u.themeColor, theme: u.theme,
            kind: opt.kind || u.kind, trail: [], crit: !!opt.crit
        });
    }

    function castAbility(b, u) {
        const fn = ABILITIES[u.ability];
        if (!fn) return false;
        u.castFx = 10;
        fn(b, u);
        return true;
    }

    /* ===== PROCESS DELAYED AREA STRIKES (telegraphed AoE) ===== */
    function stepStrikes(b) {
        for (let i = b.strikes.length - 1; i >= 0; i--) {
            const s = b.strikes[i];
            if (--s.delay > 0) continue;
            fxRing(b, s.x, s.y, 8, s.r, s.color, 26, 5);
            fxGround(b, s.x, s.y, s.r * 0.85, s.theme === 'fire' || s.theme === 'arcane' ? 'rgba(251,146,60,.16)' : 'rgba(168,85,247,.16)', 80);
            spawnParticles(b, s.x, s.y, s.color, s.meteor ? 26 : 16, s.meteor ? 6 : 4.5);
            enemiesNear(b, s.side, s.x, s.y, s.r).forEach(e => {
                dealDamage(b, e, s.dmg, s.dmgType, { color: s.color });
                if (s.burn) addDot(e, s.burn, 120, 20, s.theme, 'magic');
            });
            b.strikes.splice(i, 1);
        }
    }

    function stepBattle(b) {
        b.tick++;
        stepStrikes(b);
        // projectiles
        for (let i = b.projectiles.length - 1; i >= 0; i--) {
            const pr = b.projectiles[i];
            if (!pr.target || pr.target.hp <= 0) { b.projectiles.splice(i, 1); continue; }
            pr.trail.push({ x: pr.x, y: pr.y }); if (pr.trail.length > 7) pr.trail.shift();
            const d = dist(pr, pr.target);
            if (d < 15) {
                dealDamage(b, pr.target, pr.dmg, pr.dmgType, { color: pr.color, crit: pr.crit });
                spawnParticles(b, pr.target.x, pr.target.y, pr.color, 5, 3);
                if (pr.owner && pr.owner.lifesteal > 0 && pr.owner.hp > 0) healUnit(b, pr.owner, pr.dmg * pr.owner.lifesteal);
                b.projectiles.splice(i, 1);
            } else {
                const a = Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x);
                pr.x += Math.cos(a) * pr.speed; pr.y += Math.sin(a) * pr.speed;
            }
        }
        // units
        for (const u of b.units) {
            if (u.hp <= 0) continue;
            u.hx = u.x; u.hy = u.y;
            if (u.flash > 0) u.flash--;
            if (u.castFx > 0) u.castFx--;
            // timers
            if (u.cd > 0) u.cd--;
            if (u.shieldT > 0 && --u.shieldT <= 0) u.shield = 0;
            if (u.slowT > 0 && --u.slowT <= 0) u.slowMult = 1;
            if (u.atkSpeedT > 0 && --u.atkSpeedT <= 0) u.atkSpeedMult = 1;
            if (u.lifestealT > 0 && --u.lifestealT <= 0) u.lifesteal = 0;
            if (u.shredT > 0) u.shredT--;
            if (u.rageT > 0) u.rageT--;
            if (u.tauntT > 0 && --u.tauntT <= 0) u.tauntBy = null;
            if (u.stunT > 0) u.stunT--;
            if (u.ttl !== undefined && --u.ttl <= 0) { u.hp = 0; spawnParticles(b, u.x, u.y, u.spark, 8, 3); continue; }
            // DoTs
            for (let k = u.dots.length - 1; k >= 0; k--) {
                const dot = u.dots[k]; dot.t--;
                if (--dot.tick <= 0) {
                    dot.tick = dot.interval;
                    const dc = (THEMES[dot.theme] || THEMES.void).c;
                    dealDamage(b, u, dot.dps, dot.dmgType, { color: dc, text: false });
                    b.texts.push({ x: u.x + (Math.random() - .5) * 8, y: u.y - 8, text: '-' + Math.round(dot.dps), color: dc, life: 22, vy: -0.7, size: 11 });
                    spawnParticles(b, u.x, u.y - 4, dc, 3, 1.6, -1);
                }
                if (dot.t <= 0 || u.hp <= 0) u.dots.splice(k, 1);
            }
            if (u.hp <= 0) continue;
            if (u.stunT > 0) continue; // stunned: no action

            // target (taunt overrides)
            let target, d;
            if (u.tauntBy && u.tauntBy.hp > 0) { target = u.tauntBy; d = dist(u, target); }
            else { const ne = nearestEnemy(b, u); target = ne.target; d = ne.d; }
            if (!target) continue;

            // cast ability when full
            if (u.ability && u.mana >= u.maxMana) { u.mana = 0; castAbility(b, u); continue; }

            if (d <= u.range) {
                if (u.cd <= 0) {
                    u.cd = Math.max(6, Math.round(u.baseCd / u.atkSpeedMult));
                    u.mana = Math.min(u.maxMana, u.mana + MANA_PER_ATTACK);
                    u.facing = target.y < u.y ? -1 : 1;
                    let dmg = u.dmg;
                    const crit = u.crit && Math.random() < u.crit;
                    if (crit) dmg *= 2;
                    if (u.melee) {
                        fxSlash(b, target.x, target.y, Math.atan2(target.y - u.y, target.x - u.x), u.themeColor, crit ? 1.3 : 1);
                        dealDamage(b, target, dmg, u.dmgType, { color: u.themeColor, crit });
                        if (u.lifesteal > 0) healUnit(b, u, dmg * u.lifesteal);
                    } else {
                        spawnProjectile(b, u, target, dmg, u.dmgType, { crit });
                    }
                }
            } else {
                const a = Math.atan2(target.y - u.y, target.x - u.x);
                const sp = u.speed * u.slowMult;
                u.facing = Math.sin(a) < 0 ? -1 : 1;
                u.x = clamp(u.x + Math.cos(a) * sp, 8, ARENA_W - 8);
                u.y = clamp(u.y + Math.sin(a) * sp, 8, ARENA_H - 8);
            }
        }
        // fx decay
        for (let i = b.particles.length - 1; i >= 0; i--) { const p = b.particles[i]; p.x += p.vx; p.y += p.vy; p.vy += p.g || 0; if (--p.life <= 0) b.particles.splice(i, 1); }
        for (let i = b.texts.length - 1; i >= 0; i--) { const t = b.texts[i]; t.y += t.vy; if (--t.life <= 0) b.texts.splice(i, 1); }
        for (let i = b.fx.length - 1; i >= 0; i--) { if (--b.fx[i].life <= 0) b.fx.splice(i, 1); }
        // remove dead
        for (let i = b.units.length - 1; i >= 0; i--) if (b.units[i].hp <= 0) b.units.splice(i, 1);
        // outcome (summons don't count toward survival)
        const mine = b.units.filter(u => u.side === 'me' && !u.isSummon);
        const foe = b.units.filter(u => u.side === 'enemy' && !u.isSummon);
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
        const T = battle.tick;
        ctx.clearRect(0, 0, ARENA_W, ARENA_H);

        // territory tint
        ctx.fillStyle = 'rgba(56,189,248,.04)'; ctx.fillRect(0, ARENA_H / 2, ARENA_W, ARENA_H / 2);
        ctx.fillStyle = 'rgba(251,113,133,.04)'; ctx.fillRect(0, 0, ARENA_W, ARENA_H / 2);
        // mid divider glow
        ctx.save();
        ctx.shadowColor = 'rgba(192,132,252,.5)'; ctx.shadowBlur = 12;
        ctx.strokeStyle = 'rgba(192,132,252,.25)'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(0, ARENA_H / 2); ctx.lineTo(ARENA_W, ARENA_H / 2); ctx.stroke();
        ctx.restore();
        // grid nodes
        ctx.fillStyle = 'rgba(255,255,255,.05)';
        for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
            const p = arenaPos(r, c, 'me'); ctx.beginPath(); ctx.arc(p.x, p.y, 1.5, 0, 7); ctx.fill();
            const q = arenaPos(r, c, 'enemy'); ctx.beginPath(); ctx.arc(q.x, q.y, 1.5, 0, 7); ctx.fill();
        }

        // ---- GROUND-LAYER FX (below units): telegraphs, ground patches, AoE rings ----
        battle.fx.forEach(f => { if (f.type === 'ground' || f.type === 'telegraph' || f.type === 'ring') drawFx(ctx, f, T); });

        // ---- UNIT SHADOWS ----
        battle.units.forEach(u => {
            ctx.fillStyle = 'rgba(0,0,0,.28)';
            ctx.beginPath(); ctx.ellipse(u.x, u.y + u.radius * 0.78, u.radius * 0.9, u.radius * 0.4, 0, 0, 7); ctx.fill();
        });

        // ---- UNITS ----
        battle.units.forEach(u => drawUnit(ctx, u, T));

        // ---- PROJECTILES (with trails) ----
        battle.projectiles.forEach(pr => drawProjectile(ctx, pr));

        // ---- OVER-LAYER FX ----
        battle.fx.forEach(f => { if (f.type !== 'ground' && f.type !== 'telegraph' && f.type !== 'ring') drawFx(ctx, f, T); });

        // ---- PARTICLES ----
        battle.particles.forEach(p => {
            ctx.globalAlpha = Math.max(0, p.life / (p.max || 34));
            ctx.fillStyle = p.color;
            ctx.beginPath(); ctx.arc(p.x, p.y, 2, 0, 7); ctx.fill();
        });
        ctx.globalAlpha = 1;

        // ---- FLOATING TEXTS ----
        battle.texts.forEach(t => {
            ctx.globalAlpha = Math.max(0, Math.min(1, t.life / 16));
            ctx.fillStyle = '#000'; ctx.font = `bold ${t.size || 14}px Roboto Mono`; ctx.textAlign = 'center';
            ctx.fillText(t.text, t.x + 1, t.y + 1);
            ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
        });
        ctx.globalAlpha = 1;
    }

    function drawUnit(ctx, u, T) {
        const bob = Math.sin(T * 0.12 + u.bob) * 1.5;
        const y = u.y + bob;
        const side = u.side === 'me' ? me.color.main : '#fb7185';

        // status aura ring (rage / slow / poison-shred)
        if (u.rageT > 0) auraRing(ctx, u.x, y, u.radius + 5 + Math.sin(T * 0.4) * 1.5, '#f87171', .5);
        else if (u.shredT > 0) auraRing(ctx, u.x, y, u.radius + 4, '#c084fc', .4);
        if (u.slowT > 0) auraRing(ctx, u.x, y, u.radius + 3, '#7dd3fc', .4);

        // body
        ctx.save();
        ctx.shadowColor = u.themeColor; ctx.shadowBlur = u.castFx > 0 ? 26 : (u.flash > 0 ? 18 : 9);
        const grad = ctx.createRadialGradient(u.x, y - 3, 2, u.x, y, u.radius);
        if (u.flash > 0) { grad.addColorStop(0, '#fff'); grad.addColorStop(1, u.themeColor); }
        else { grad.addColorStop(0, mixHex(u.themeColor, '#0b1020', .35)); grad.addColorStop(1, mixHex(u.themeColor, '#0b1020', .72)); }
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(u.x, y, u.radius, 0, 7); ctx.fill();
        ctx.restore();

        // side-colored outer ring + theme inner ring
        ctx.lineWidth = 3; ctx.strokeStyle = side;
        ctx.beginPath(); ctx.arc(u.x, y, u.radius + 0.5, 0, 7); ctx.stroke();
        ctx.lineWidth = 1.5; ctx.strokeStyle = u.themeColor;
        ctx.beginPath(); ctx.arc(u.x, y, u.radius - 2, 0, 7); ctx.stroke();

        // shield barrier
        if (u.shield > 0) {
            const sa = clamp(u.shield / Math.max(1, u.shieldMax), .2, 1);
            ctx.save();
            ctx.globalAlpha = .35 + sa * .35;
            ctx.strokeStyle = '#fde68a'; ctx.lineWidth = 2.5;
            ctx.shadowColor = '#fde68a'; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.arc(u.x, y, u.radius + 5, 0, 7); ctx.stroke();
            ctx.globalAlpha = .12 + sa * .12; ctx.fillStyle = '#fde68a';
            ctx.beginPath(); ctx.arc(u.x, y, u.radius + 5, 0, 7); ctx.fill();
            ctx.restore();
        }

        // icon
        ctx.fillStyle = '#fff'; ctx.font = `${u.radius + 3}px serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.globalAlpha = u.stunT > 0 ? .5 : 1;
        ctx.fillText(u.icon, u.x, y + 1);
        ctx.globalAlpha = 1;

        // star pips
        if (u.star > 1) {
            ctx.fillStyle = u.star === 3 ? '#fbbf24' : '#e5e7eb'; ctx.font = 'bold 9px Inter';
            ctx.fillText('★'.repeat(u.star), u.x, y - u.radius - 12);
        }

        // status mini-icons
        const st = [];
        if (u.stunT > 0) st.push('💢');
        if (u.dots.some(d => d.theme === 'fire')) st.push('🔥');
        if (u.dots.some(d => d.theme === 'void' || d.theme === 'death')) st.push('☠️');
        if (u.slowT > 0) st.push('❄️');
        if (u.rageT > 0) st.push('🔺');
        if (st.length) {
            ctx.font = '10px serif'; ctx.fillText(st.slice(0, 3).join(''), u.x, y - u.radius - (u.star > 1 ? 22 : 13));
        }

        // bars
        const w = u.radius * 2, bx = u.x - u.radius, by = y - u.radius - 7;
        ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(bx, by, w, 4);
        ctx.fillStyle = side === me.color.main ? '#34d399' : '#fb7185';
        ctx.fillRect(bx, by, w * clamp(u.hp / u.maxHp, 0, 1), 4);
        if (u.shield > 0) {
            ctx.fillStyle = 'rgba(253,230,138,.9)';
            ctx.fillRect(bx, by - 1.5, w * clamp(u.shield / u.maxHp, 0, 1), 2);
        }
        if (u.maxMana < 900) {
            ctx.fillStyle = 'rgba(0,0,0,.5)'; ctx.fillRect(bx, by + 4.5, w, 2);
            ctx.fillStyle = '#38bdf8'; ctx.fillRect(bx, by + 4.5, w * clamp(u.mana / u.maxMana, 0, 1), 2);
        }
    }

    function drawProjectile(ctx, pr) {
        // trail
        for (let i = 0; i < pr.trail.length; i++) {
            const t = pr.trail[i], a = (i / pr.trail.length) * 0.6;
            ctx.globalAlpha = a; ctx.fillStyle = pr.color;
            ctx.beginPath(); ctx.arc(t.x, t.y, 2 + i * 0.35, 0, 7); ctx.fill();
        }
        ctx.globalAlpha = 1;
        ctx.save();
        ctx.shadowColor = pr.color; ctx.shadowBlur = 12;
        const ang = pr.target ? Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x) : 0;
        if (pr.kind === 'arrow') {
            ctx.strokeStyle = pr.color; ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.moveTo(pr.x - Math.cos(ang) * 7, pr.y - Math.sin(ang) * 7); ctx.lineTo(pr.x + Math.cos(ang) * 7, pr.y + Math.sin(ang) * 7); ctx.stroke();
        } else if (pr.kind === 'bolt') {
            ctx.strokeStyle = '#fef08a'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(pr.x - Math.cos(ang) * 8, pr.y - Math.sin(ang) * 8); ctx.lineTo(pr.x, pr.y); ctx.stroke();
            ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(pr.x, pr.y, 3, 0, 7); ctx.fill();
        } else {
            const r = pr.kind === 'fire' ? 5 : 4;
            ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(pr.x, pr.y, r - 1.5, 0, 7); ctx.fill();
            ctx.fillStyle = pr.color; ctx.globalAlpha = .85; ctx.beginPath(); ctx.arc(pr.x, pr.y, r, 0, 7); ctx.fill();
        }
        ctx.restore(); ctx.globalAlpha = 1;
    }

    function auraRing(ctx, x, y, r, color, a) {
        ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = color; ctx.lineWidth = 2;
        ctx.shadowColor = color; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.stroke(); ctx.restore();
    }

    function drawFx(ctx, f, T) {
        const t = f.life / f.max;
        ctx.save();
        switch (f.type) {
            case 'ring': {
                const r = f.r0 + (f.r1 - f.r0) * (1 - t);
                ctx.globalAlpha = t; ctx.strokeStyle = f.color; ctx.lineWidth = f.w;
                ctx.shadowColor = f.color; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 7); ctx.stroke();
                break;
            }
            case 'telegraph': {
                const pulse = 0.3 + 0.5 * (1 - t);
                ctx.globalAlpha = 0.10 + 0.18 * (1 - t); ctx.fillStyle = f.color;
                ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
                ctx.globalAlpha = pulse; ctx.strokeStyle = f.color; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
                ctx.lineDashOffset = T * 0.6;
                ctx.beginPath(); ctx.arc(f.x, f.y, f.r * (0.6 + 0.4 * (1 - t)), 0, 7); ctx.stroke();
                break;
            }
            case 'ground': {
                ctx.globalAlpha = 0.7 * t * (0.7 + 0.3 * Math.sin(T * 0.5));
                ctx.fillStyle = f.color;
                ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, 7); ctx.fill();
                break;
            }
            case 'beam': {
                ctx.globalAlpha = t; ctx.lineCap = 'round'; ctx.shadowColor = f.color; ctx.shadowBlur = 14;
                ctx.strokeStyle = f.color; ctx.lineWidth = f.w * t + 1;
                ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(1, f.w * t * 0.4);
                ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
                break;
            }
            case 'bolt': {
                ctx.globalAlpha = t; ctx.shadowColor = f.color; ctx.shadowBlur = 12; ctx.lineCap = 'round';
                for (let pass = 0; pass < 2; pass++) {
                    ctx.strokeStyle = pass ? '#fff' : f.color; ctx.lineWidth = pass ? 1.5 : 4;
                    ctx.beginPath();
                    for (let i = 0; i < f.pts.length; i++) {
                        const p = f.pts[i];
                        const jx = i > 0 && i < f.pts.length - 1 ? (Math.random() - .5) * 10 : 0;
                        const jy = i > 0 && i < f.pts.length - 1 ? (Math.random() - .5) * 10 : 0;
                        if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x + jx, p.y + jy);
                    }
                    ctx.stroke();
                }
                break;
            }
            case 'blink': {
                ctx.globalAlpha = t * 0.8; ctx.strokeStyle = f.color; ctx.lineWidth = 5 * t; ctx.lineCap = 'round';
                ctx.shadowColor = f.color; ctx.shadowBlur = 12;
                ctx.beginPath(); ctx.moveTo(f.x1, f.y1); ctx.lineTo(f.x2, f.y2); ctx.stroke();
                break;
            }
            case 'slash': {
                ctx.globalAlpha = t; ctx.translate(f.x, f.y); ctx.rotate(f.ang);
                ctx.strokeStyle = f.color; ctx.lineWidth = 3 * f.scale; ctx.lineCap = 'round';
                ctx.shadowColor = f.color; ctx.shadowBlur = 10;
                const rr = 16 * f.scale;
                ctx.beginPath(); ctx.arc(0, 0, rr, -0.9, 0.9); ctx.stroke();
                ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2 * f.scale;
                ctx.beginPath(); ctx.arc(0, 0, rr, -0.7, 0.7); ctx.stroke();
                break;
            }
            case 'impact': {
                const r = (1 - t) * 14 * f.scale;
                ctx.globalAlpha = t; ctx.strokeStyle = f.color; ctx.lineWidth = 2.5;
                ctx.shadowColor = f.color; ctx.shadowBlur = 8;
                ctx.beginPath(); ctx.arc(f.x, f.y, r + 3, 0, 7); ctx.stroke();
                break;
            }
            case 'shieldhit': {
                if (f.unit) { ctx.globalAlpha = t; auraRing(ctx, f.unit.x, f.unit.y, f.unit.radius + 6, '#fde68a', t); }
                break;
            }
            case 'cast': {
                if (f.unit) {
                    const r = (1 - t) * 30;
                    ctx.globalAlpha = t; ctx.strokeStyle = f.color; ctx.lineWidth = 3;
                    ctx.shadowColor = f.color; ctx.shadowBlur = 16;
                    ctx.beginPath(); ctx.arc(f.unit.x, f.unit.y + f.unit.radius * 0.6, r, 0, 7); ctx.stroke();
                }
                break;
            }
            case 'heal': {
                const r = (1 - t) * 22;
                ctx.globalAlpha = t; ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 2.5;
                ctx.shadowColor = '#4ade80'; ctx.shadowBlur = 10;
                ctx.beginPath(); ctx.arc(f.x, f.y, r, 0, 7); ctx.stroke();
                break;
            }
        }
        ctx.restore(); ctx.globalAlpha = 1;
    }

    // mix two #rrggbb hex colors; w = weight of c1 (0..1)
    function mixHex(c1, c2, w) {
        const p = h => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
        try {
            const a = p(c1), b2 = p(c2);
            const m = a.map((v, i) => Math.round(v * w + b2[i] * (1 - w)));
            return `rgb(${m[0]},${m[1]},${m[2]})`;
        } catch (e) { return c1; }
    }

    /* ===== RENDER: PREP UI ===== */
    function renderAll() { renderBoard(); renderBench(); renderShop(); renderEcon(); renderStandings(); renderPlayersStrip(); }

    function chipHtml(unit, ctx) {
        const c = CLASSES[unit.name];
        const th = (THEMES[c.theme] || THEMES.steel).c;
        const stars = unit.star > 1 ? `<span class="stars s${unit.star}">${'★'.repeat(unit.star)}</span>` : '';
        return `<div class="chip tier-${unit.tier} star-${unit.star}" data-name="${unit.name}"
                    title="${c.desc || ''}" style="--tc:${TIER_COLOR[unit.tier]};--th:${th}">
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
            const th = (THEMES[c.theme] || THEMES.steel).c;
            return `<div class="shop-card tier-${c.tier}" title="${c.desc || ''}" style="--tc:${TIER_COLOR[c.tier]};--th:${th}" onclick="Game.buyShop(${i})">
                        <div class="sc-theme"></div>
                        <div class="sc-icon">${c.icon}</div>
                        <div class="sc-name">${name}</div>
                        <div class="sc-role">${c.role || ''} · ${c.theme}</div>
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

    /* ===== HEADLESS SELF-TEST (used by tools/sim-test.js; harmless in browser) ===== */
    function _selftest(runs) {
        runs = runs || 200;
        loadClasses();
        const savedMe = me;
        me = { color: COLORS[0] };
        const names = Object.keys(CLASSES);
        const report = { runs: 0, errors: [], unterminated: 0, winnersMe: 0, winnersEnemy: 0, abilitiesSeen: {}, drawOk: false };
        const randBoard = () => {
            const board = {}; const n = 2 + Math.floor(Math.random() * 6);
            const cells = [];
            for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) cells.push(r + '-' + c);
            for (let i = 0; i < n; i++) {
                const k = cells.splice(Math.floor(Math.random() * cells.length), 1)[0];
                board[k] = makeUnit(names[Math.floor(Math.random() * names.length)], 1 + Math.floor(Math.random() * 3));
            }
            return board;
        };
        // instrument ability casts
        const origCast = ABILITIES;
        for (let i = 0; i < runs; i++) {
            try {
                const A = randBoard(), B = randBoard();
                const b = buildBattle(A, B);
                let guard = 0;
                while (!b.done && guard++ < 4000) {
                    b.units.forEach(u => { if (u.ability && u.mana >= u.maxMana) report.abilitiesSeen[u.ability] = (report.abilitiesSeen[u.ability] || 0) + 1; });
                    stepBattle(b);
                }
                if (!b.done) report.unterminated++;
                if (b.winner === 'me') report.winnersMe++; else report.winnersEnemy++;
                report.runs++;
            } catch (e) { report.errors.push(String(e && e.stack || e)); if (report.errors.length > 5) break; }
        }
        // test the renderer with a mock 2D context
        try {
            const noop = () => {};
            const mock = new Proxy({}, {
                get(t, k) {
                    if (k === 'createRadialGradient' || k === 'createLinearGradient') return () => ({ addColorStop: noop });
                    if (typeof k === 'string' && k.startsWith('Symbol')) return undefined;
                    return noop;
                },
                set() { return true; }
            });
            arenaCtx = mock;
            const b = buildBattle(randBoard(), randBoard());
            battle = b;
            for (let i = 0; i < 120; i++) { stepBattle(b); drawArena(); }
            report.drawOk = true;
        } catch (e) { report.errors.push('DRAW: ' + String(e && e.stack || e)); }
        me = savedMe;
        return report;
    }

    return {
        fetchUnits, checkActiveSession, init, resume, startFresh,
        buyShop, reroll, buyXP, autoFill, fight, _selftest
    };
})();

/* ---------------- UI helpers ---------------- */
const UI = (function () {
    function togglePanel() { document.getElementById('side-panel').classList.toggle('open'); }
    return { togglePanel };
})();

window.onload = () => Auth.checkSession();
