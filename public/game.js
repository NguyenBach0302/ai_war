const Auth = (function() {
    let currentUser = null;
    let token = localStorage.getItem('token');

    async function login() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const res = await fetch('/api/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (data.token) {
            localStorage.setItem('token', data.token);
            token = data.token;
            currentUser = data.user;
            document.getElementById('auth-overlay').style.display = 'none';
            updateUserStatus();
            await Game.fetchUnits();
            Game.checkActiveSession();
        } else {
            alert(data.message);
        }
    }

    async function register() {
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Registered successfully! Please login.');
        } else {
            alert(data.message);
        }
    }

    async function checkSession() {
        if (!token) return;
        const res = await fetch('/api/user/profile', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
            currentUser = await res.json();
            document.getElementById('auth-overlay').style.display = 'none';
            updateUserStatus();
            await Game.fetchUnits();
            Game.checkActiveSession();
        } else {
            localStorage.removeItem('token');
        }
    }

    function updateUserStatus() {
        const status = document.getElementById('user-status');
        if (!status || !currentUser) return;
        status.innerHTML = `
            <span>Welcome, <strong>${currentUser.username}</strong></span>
            <span class="status-item">💰 ${currentUser.gold}</span>
            <span class="status-item">🏆 ${currentUser.wins}W / ${currentUser.losses}L</span>
            <span class="status-item" style="cursor:pointer; color:var(--danger)" onclick="Auth.logout()">Logout</span>
        `;
    }

    function logout() {
        localStorage.removeItem('token');
        location.reload();
    }

    return { login, register, checkSession, logout, getToken: () => token, getUser: () => currentUser };
})();

const Game = (function() {
    // ===== CONFIG & DATA =====
    const MAP_W = 1000, MAP_H = 700;
    const GOLD_RATE = 0.15;
    const COLORS = [
        { name: 'Azure', main: '#38bdf8', dark: '#0c4a6e' },
        { name: 'Amber', main: '#fbbf24', dark: '#78350f' },
        { name: 'Emerald', main: '#10b981', dark: '#064e3b' },
        { name: 'Rose', main: '#f43f5e', dark: '#4c0519' }
    ];

    let CLASSES = {};

    // ===== STATE =====
    let canvas, ctx, running = false, frameCount = 0;
    let players = [], units = [], projectiles = [], vfx = [], particles = [], floatingTexts = [], unitsPending = [];
    let aiProcessFlags = [false, false, false, false]; 
    const MAX_PARTICLES = 150;
    const MAX_VFX = 50;
    const MAX_TEXTS = 50;
    const MAX_UNITS_PER_PLAYER = 50;

    let lastActiveState = null;

    // ===== HELPERS =====
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function getReduction(val) {
        let red = 0;
        if (val <= 50) red = val * 0.01;
        else red = 0.5 + (val - 50) * 0.005;
        return Math.min(0.99, red);
    }

    async function fetchUnits() {
        const res = await fetch('/api/units');
        const data = await res.json();
        CLASSES = {};
        data.forEach(u => {
            CLASSES[u.name] = { 
                ...u, 
                meta: u,
                skill: u.special?.split(':')[0]?.toLowerCase() || 'none',
                skillCost: 30,
                skillRange: u.range * 2,
                crit: u.name === 'Assassin' ? 0.5 : 0,
                lifesteal: 0,
                dodge: 0,
                armor: u.name === 'Guard' ? 50 : 10,
                mres: u.name === 'Guard' ? 50 : 10
            };
        });
    }

    async function checkActiveSession() {
        const res = await fetch('/api/session/active', {
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });
        const data = await res.json();
        if (data.hasActive) {
            lastActiveState = data.state;
            document.getElementById('resume-overlay').style.display = 'flex';
        } else {
            document.getElementById('setup-overlay').style.display = 'flex';
        }
    }

    async function saveSession() {
        if (!running) return;
        const state = {
            players: players.map(p => ({ gold: p.gold, hp: p.hp, maxHp: p.maxHp, eliminated: p.eliminated, name: p.name, config: p.config, base: p.base })),
            units: units.map(u => ({ type: u.type, owner: u.owner, x: u.x, y: u.y, hp: u.hp, mana: u.mana })),
            frameCount
        };
        await fetch('/api/session/save', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ state })
        });
    }

    function resume() {
        if (!lastActiveState) return;
        document.getElementById('resume-overlay').style.display = 'none';
        init(lastActiveState);
    }

    function startFresh() {
        document.getElementById('resume-overlay').style.display = 'none';
        document.getElementById('setup-overlay').style.display = 'flex';
        fetch('/api/session/clear', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });
    }

    function spawnParticles(x, y, color, count) {
        if (particles.length > MAX_PARTICLES) return;
        for (let i = 0; i < count; i++) {
            particles.push({
                x, y,
                vx: (Math.random() - 0.5) * 4,
                vy: (Math.random() - 0.5) * 4,
                life: 30 + Math.random() * 20,
                color
            });
        }
    }

    function spawnSkillVFX(type, x, y, options = {}) {
        if (vfx.length > MAX_VFX) return;
        vfx.push({
            type, x, y, 
            life: options.life || 30, 
            maxLife: options.life || 30,
            color: options.color || '#fff',
            radius: options.radius || 10,
            targetX: options.targetX,
            targetY: options.targetY
        });
    }

    function log(msg, color) {
        const logDiv = document.getElementById('combat-log');
        if (!logDiv) return;
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.style.color = color || '#94a3b8';
        entry.innerHTML = `[${Math.floor(frameCount/60)}s] ${msg}`;
        logDiv.prepend(entry);
        if (logDiv.children.length > 50) logDiv.removeChild(logDiv.lastChild);
        logDiv.scrollTop = 0;
    }

    function spawnVFX(x, y, text, color) {
        if (floatingTexts.length > MAX_TEXTS) return;
        floatingTexts.push({
            x, y, text, color,
            life: 60,
            vy: -1
        });
    }

    // ===== CORE LOGIC =====
    function spawnUnit(pIdx, type) {
        const p = players[pIdx];
        if (!CLASSES[type] || CLASSES[type].cost <= 0) return;
        
        const meta = CLASSES[type];
        if (p.gold < meta.cost) return;

        const playerUnitCount = units.filter(u => u.owner === pIdx).length + unitsPending.filter(u => u.owner === pIdx).length;
        if (playerUnitCount >= MAX_UNITS_PER_PLAYER) return;

        p.gold -= meta.cost;
        const angle = Math.random() * Math.PI * 2;
        const u = {
            id: Math.random().toString(36).substr(2, 9), owner: pIdx,
            type: type, meta: { ...meta }, hp: meta.hp, maxHp: meta.hp,
            mana: meta.mana * 0.5, maxMana: meta.mana,
            x: p.base.x + Math.cos(angle) * 50, y: p.base.y + Math.sin(angle) * 50,
            cooldown: 0, skillTimer: 0, untargetableTimer: 0, state: 'march', radius: 12,
            lastAttacker: null, buffs: []
        };
        unitsPending.push(u);
        spawnParticles(u.x, u.y, p.color.main, 10);
        log(`${p.name} deployed ${type} ${meta.icon}`, p.color.main);
    }

    async function processAIStrategic(pIdx) {
        const p = players[pIdx];
        if (p.eliminated || aiProcessFlags[pIdx]) return;

        const affordable = Object.keys(CLASSES).filter(k => CLASSES[k].cost > 0 && CLASSES[k].cost <= p.gold);
        if (affordable.length === 0) return;

        if (p.gold > 250) {
            spawnUnit(pIdx, affordable[Math.floor(Math.random()*affordable.length)]);
            return;
        }

        aiProcessFlags[pIdx] = true;
        try {
            const response = await fetch('/api/ai/strategy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player: { 
                        name: p.name, 
                        gold: p.gold, 
                        hp: p.hp, 
                        maxHp: p.maxHp, 
                        units: units.filter(u => u.owner === pIdx).map(u => u.type),
                        basePos: { x: p.base.x, y: p.base.y }
                    },
                    gameState: { 
                        enemies: players.filter(pl => pl.id !== pIdx && !pl.eliminated).map(pl => ({ 
                            name: pl.name, 
                            hp: pl.hp,
                            basePos: { x: pl.base.x, y: pl.base.y }
                        })) 
                    },
                    config: p.config
                })
            });
            const data = await response.json();
            if (data.decision !== 'save' && CLASSES[data.decision]) {
                spawnUnit(pIdx, data.decision);
            }
        } catch (e) {
            spawnUnit(pIdx, affordable[0]);
        } finally {
            aiProcessFlags[pIdx] = false;
        }
    }

    function updateIntel() {
        const list = document.getElementById('unit-intel-list');
        if (!list || frameCount % 30 !== 0) return;
        list.innerHTML = units.map(u => `
            <div class="intel-entry">
                <div class="intel-row"><span style="color:${players[u.owner].color.main}">${u.meta.icon} ${u.type}</span><span class="intel-hp">${Math.ceil(u.hp)} HP</span></div>
                <div class="intel-row" style="opacity:0.8; font-size:9px; color:var(--primary);"><span>Mana: ${Math.floor(u.mana)}</span><span>State: ${u.state.toUpperCase()}</span></div>
            </div>
        `).join('');
    }

    function update() {
        frameCount++;
        if (frameCount % 600 === 0) saveSession();

        for (let i = projectiles.length - 1; i >= 0; i--) {
            const pr = projectiles[i];
            const d = dist(pr, { x: pr.tx, y: pr.ty });
            if (d < 10) {
                spawnParticles(pr.x, pr.y, pr.color, 5);
                units.forEach(eu => { 
                    if (eu.owner !== pr.owner && eu.untargetableTimer <= 0 && dist(pr, eu) < 25) { 
                        let finalDmg = pr.dmg;
                        if (eu.meta && pr.dmgType !== 'true') {
                            let armor = eu.meta.armor || 0;
                            const reduction = pr.dmgType === 'magic' ? getReduction(eu.meta.mres || 0) : getReduction(armor);
                            finalDmg *= (1 - reduction);
                        }
                        eu.hp -= finalDmg; eu.lastAttacker = pr.owner; 
                        spawnVFX(eu.x, eu.y, `-${Math.floor(finalDmg)}`, '#fff'); 
                    } 
                });
                players.forEach(p => { if (!p.eliminated && p.id !== pr.owner && dist(pr, p.base) < 60) { p.hp -= pr.dmg; } });
                projectiles.splice(i, 1);
            } else {
                const angle = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
                pr.x += Math.cos(angle) * pr.speed; pr.y += Math.sin(angle) * pr.speed;
            }
        }

        for (let i = vfx.length - 1; i >= 0; i--) { vfx[i].life--; if (vfx[i].life <= 0) vfx.splice(i, 1); }
        for (let i = particles.length - 1; i >= 0; i--) { let p = particles[i]; p.x += p.vx; p.y += p.vy; p.life--; if (p.life <= 0) particles.splice(i, 1); }
        for (let i = floatingTexts.length - 1; i >= 0; i--) { let t = floatingTexts[i]; t.y += t.vy; t.life--; if (t.life <= 0) floatingTexts.splice(i, 1); }

        players.forEach((p, i) => {
            if (p.eliminated) return;
            p.gold += GOLD_RATE;
            if (frameCount % 60 === 0) {
                let targetUnit = null, minDist = 200;
                units.forEach(u => { if (u.owner !== i && u.untargetableTimer <= 0) { const d = dist(p.base, u); if (d < minDist) { minDist = d; targetUnit = u; } } });
                if (targetUnit) projectiles.push({ x: p.base.x, y: p.base.y, tx: targetUnit.x, ty: targetUnit.y, owner: i, dmg: 30, isAoE: false, speed: 12, color: p.color.main, dmgType: 'true' });
            }
            if (frameCount % 60 === 0 && !p.isHuman) processAIStrategic(i);
            if (frameCount % 10 === 0) {
                const gb = document.getElementById(`gold-${i}`); if (gb) gb.innerText = `💰 ${Math.floor(p.gold)}`;
                const hb = document.getElementById(`hp-${i}`); if (hb) hb.style.width = `${(p.hp / p.maxHp) * 100}%`;
                if (p.isHuman) Object.keys(CLASSES).forEach(type => { const btn = document.getElementById(`btn-${type}`); if (btn) btn.disabled = p.gold < CLASSES[type].cost; });
            }
        });

        updateIntel();

        units.forEach(u => {
            if (frameCount % 60 === 0) { u.hp = Math.min(u.maxHp, u.hp + 1); u.mana = Math.min(u.maxMana, u.mana + 2); }
            if (u.cooldown > 0) u.cooldown--;
            u.buffs = u.buffs.filter(b => { b.duration--; return b.duration > 0; });

            let target = null, minDist = Infinity;
            units.forEach(e => { if (e.owner !== u.owner && e.untargetableTimer <= 0) { const d = dist(u, e); if (d < minDist) { minDist = d; target = e; } } });
            players.forEach(p => { if (!p.eliminated && p.id !== u.owner) { const d = dist(u, p.base); if (d < minDist * 1.5) { minDist = d; target = p; } } });

            if (target) {
                const tx = target.base ? target.base.x : target.x, ty = target.base ? target.base.y : target.y;
                const d = dist(u, { x: tx, y: ty });
                if (d <= u.meta.range) {
                    if (u.cooldown <= 0) {
                        u.cooldown = u.meta.cd;
                        let dmg = u.meta.dmg;
                        if (u.meta.range < 35) {
                            target.hp -= dmg; if (target.base === undefined) target.lastAttacker = u.owner;
                            spawnVFX(tx, ty, `-${Math.floor(dmg)}`, players[u.owner].color.main);
                        } else {
                            projectiles.push({ x: u.x, y: u.y, tx, ty, owner: u.owner, dmg: dmg, isAoE: false, speed: 8, color: players[u.owner].color.main, dmgType: u.meta.dmgType || 'physical' });
                        }
                    }
                    u.state = 'fight';
                } else {
                    const angle = Math.atan2(ty - u.y, tx - u.x); u.x += Math.cos(angle) * u.meta.speed; u.y += Math.sin(angle) * u.meta.speed; u.state = 'march';
                }
            }
        });

        for (let i = units.length - 1; i >= 0; i--) {
            if (units[i].hp <= 0) {
                const u = units[i];
                if (u.lastAttacker !== null) { const killer = players[u.lastAttacker]; if (killer) killer.gold += u.meta.cost * 0.3; }
                units.splice(i, 1);
            }
        }

        players.forEach(p => { 
            if (!p.eliminated && p.hp <= 0) { 
                p.eliminated = true; 
                if (p.isHuman) endGame(null);
            } 
        });
        const alive = players.filter(p => !p.eliminated);
        if (alive.length <= 1 && frameCount > 300) endGame(alive[0]);

        if (unitsPending.length > 0) { units.push(...unitsPending); unitsPending = []; }
    }

    function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        players.forEach(p => {
            ctx.fillStyle = p.eliminated ? '#0f172a' : p.color.dark; ctx.strokeStyle = p.color.main; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.base.x, p.base.y, p.base.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        });
        units.forEach(u => {
            ctx.fillStyle = players[u.owner].color.main; ctx.beginPath(); ctx.arc(u.x, u.y, u.radius, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.fillText(u.meta.icon, u.x, u.y + 4);
        });
        projectiles.forEach(pr => { ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI * 2); ctx.fill(); });
    }

    function loop() { if (!running) return; update(); draw(); requestAnimationFrame(loop); }

    function init(savedState = null) {
        const count = savedState ? savedState.players.length : parseInt(document.getElementById('player-count').value);
        document.getElementById('setup-overlay').style.display = 'none';
        canvas = document.getElementById('gameCanvas'); 
        canvas.width = MAP_W; canvas.height = MAP_H; ctx = canvas.getContext('2d');
        const pos = [{ x: 80, y: 80 }, { x: MAP_W - 80, y: MAP_H - 80 }, { x: MAP_W - 80, y: 80 }, { x: 80, y: MAP_H - 80 }];
        const dash = document.getElementById('dashboard'); dash.innerHTML = '';
        players = [];
        const user = Auth.getUser();

        for (let i = 0; i < count; i++) {
            const isHuman = i === 0;
            if (savedState) {
                players.push({ ...savedState.players[i], id: i, color: COLORS[i], isHuman });
            } else {
                players.push({ id: i, name: isHuman ? user.username : `Agent ${i + 1}`, isHuman, color: COLORS[i], gold: 150, hp: 2500, maxHp: 2500, base: { x: pos[i].x, y: pos[i].y, r: 50 }, eliminated: false, config: { provider: 'deepseek' } });
            }
            dash.innerHTML += `<div class="player-card" id="card-${i}" style="border-top: 2px solid ${COLORS[i].main}"><div class="card-header"><span class="player-name">${players[i].name}</span><span class="resource-count" id="gold-${i}">$ ${Math.floor(players[i].gold)}</span></div><div class="hp-bg"><div class="hp-bar" id="hp-${i}" style="width:${(players[i].hp/players[i].maxHp)*100}%"></div></div></div>`;
        }

        units = [];
        if (savedState) {
            frameCount = savedState.frameCount;
            savedState.units.forEach(su => {
                const meta = CLASSES[su.type];
                units.push({
                    ...su,
                    id: Math.random().toString(36).substr(2, 9),
                    meta: { ...meta },
                    maxHp: meta.hp,
                    maxMana: meta.mana,
                    cooldown: 0, skillTimer: 0, untargetableTimer: 0, state: 'march', radius: 12,
                    lastAttacker: null, buffs: []
                });
            });
        }

        const hud = document.getElementById('deployment-hud');
        hud.style.display = 'block';
        document.getElementById('unit-buttons').innerHTML = Object.keys(CLASSES).map(type => `<button class="unit-btn" id="btn-${type}" onclick="Game.buy('${type}', 0)"><span class="u-icon">${CLASSES[type].icon}</span><span class="u-name">${type}</span><span class="u-cost">${CLASSES[type].cost}g</span></button>`).join('');

        running = true; requestAnimationFrame(loop);
    }

    async function endGame(winner) {
        running = false;
        const result = (winner && winner.isHuman) ? 'win' : 'loss';
        const duration = Math.floor(frameCount / 60);
        
        await fetch('/api/session/clear', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
        });

        await fetch('/api/game/end', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ winnerId: Auth.getUser().id, duration, result })
        });

        document.getElementById('victory-overlay').style.display = 'flex';
        document.getElementById('victory-text').innerText = (result === 'win') ? 'VICTORY' : 'DEFEAT';
    }

    return { init, buy: (type, pIdx) => spawnUnit(pIdx, type), fetchUnits, updateSetupUI: () => {}, checkActiveSession, resume, startFresh };
})();

window.onload = () => Auth.checkSession();
