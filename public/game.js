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
        const username = document.getElementById('reg-username').value;
        const password = document.getElementById('reg-password').value;
        const confirm = document.getElementById('reg-password-confirm').value;

        if (!username || !password) {
            alert('Please fill in all fields');
            return;
        }

        if (password !== confirm) {
            alert('Passwords do not match');
            return;
        }

        const res = await fetch('/api/auth/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (res.ok) {
            alert('Registered successfully! Please login.');
            toggleForm('login');
        } else {
            alert(data.message);
        }
    }

    function toggleForm(type) {
        const loginForm = document.getElementById('login-form');
        const regForm = document.getElementById('register-form');
        const title = document.getElementById('auth-title');

        if (type === 'register') {
            loginForm.style.display = 'none';
            regForm.style.display = 'block';
            title.innerText = 'Commander Registration';
        } else {
            loginForm.style.display = 'block';
            regForm.style.display = 'none';
            title.innerText = 'Commander Login';
        }
    }

    function showForm(type) {
        document.getElementById('auth-overlay').style.display = 'flex';
        toggleForm(type);
    }

    async function checkSession() {
        console.log("Checking session. Token:", token);
        try {
            if (!token) {
                console.log("No token, showing auth overlay.");
                document.getElementById('auth-overlay').style.display = 'flex';
                return;
            }
            const res = await fetch('/api/user/profile', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            console.log("Profile response:", res.status);
            if (res.ok) {
                currentUser = await res.json();
                document.getElementById('auth-overlay').style.display = 'none';
                updateUserStatus();
                await Game.fetchUnits();
                Game.checkActiveSession();
            } else {
                console.log("Profile invalid, clearing token and showing auth overlay.");
                localStorage.removeItem('token');
                token = null;
                currentUser = null;
                document.getElementById('auth-overlay').style.display = 'flex';
            }
        } catch (err) {
            console.error("Session check failed", err);
            document.getElementById('auth-overlay').style.display = 'flex';
        }
    }

    function updateUserStatus() {
        const info = document.getElementById('user-info-text');
        const setupAdminWrap = document.getElementById('admin-setup-btn-wrap');
        const pauseBtn = document.getElementById('pause-btn');
        const authNavBtns = document.getElementById('auth-nav-btns');
        
        if (!info || !currentUser) {
            if (authNavBtns) authNavBtns.style.display = 'flex';
            return;
        }
        
        if (authNavBtns) authNavBtns.style.display = 'none';

        const adminBtnHtml = currentUser.role === 0 ? `<button onclick="Admin.show()" class="admin-badge">ADMIN</button>` : '';
        const adminSetupBtnHtml = currentUser.role === 0 ? `<button class="buy-btn" style="background: var(--accent); color: black;" onclick="Admin.show()">Admin Console</button>` : '';

        info.innerHTML = `
            <span>Welcome, <strong>${currentUser.username}</strong></span>
            ${adminBtnHtml}
            <span class="status-item">💰 ${currentUser.gold}</span>
            <span class="status-item">🏆 ${currentUser.wins}W / ${currentUser.losses}L</span>
            <span class="status-item" style="cursor:pointer; color:var(--danger)" onclick="Auth.logout()">Logout</span>
        `;

        if (setupAdminWrap) setupAdminWrap.innerHTML = adminSetupBtnHtml;
        if (pauseBtn) pauseBtn.style.display = 'block';
    }

    function logout() {
        localStorage.removeItem('token');
        location.reload();
    }

    return { login, register, toggleForm, showForm, checkSession, logout, getToken: () => token, getUser: () => currentUser };
})();

const UI = (function() {
    function forceReset() {
        const overlays = ['auth-overlay', 'setup-overlay', 'resume-overlay', 'admin-overlay', 'victory-overlay'];
        overlays.forEach(id => {
            const el = document.getElementById(id);
            if (el) el.style.display = 'none';
        });
        console.log("UI Force Reset executed.");
    }
    return { forceReset };
})();

const Admin = (function() {
    async function show() {
        const list = document.getElementById('admin-unit-list');
        list.innerHTML = '<p style="color:var(--primary)">Loading unit data...</p>';
        document.getElementById('admin-overlay').style.display = 'flex';
        
        const res = await fetch('/api/units');
        const units = await res.json();
        
        list.innerHTML = units.map(u => `
            <div class="intel-entry" style="display:flex; flex-direction:column; gap:12px; padding:20px; border:1px solid var(--border); background:rgba(2,6,23,0.6); border-radius:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border); padding-bottom:10px;">
                    <strong style="color:var(--primary); font-size:18px;">${u.icon} ${u.name}</strong>
                    <button class="buy-btn" style="height:35px; font-size:11px; padding:0 15px;" onclick="Admin.update(${u.id}, '${u.name}')">SAVE</button>
                </div>
                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:12px;">
                    <div class="auth-input-group">
                        <label style="font-size:9px;">HP</label>
                        <input type="number" id="adm-hp-${u.id}" value="${u.hp}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Mana</label>
                        <input type="number" id="adm-mana-${u.id}" value="${u.mana}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">DMG</label>
                        <input type="number" id="adm-dmg-${u.id}" value="${u.dmg}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Atk Spd</label>
                        <input type="number" step="0.1" id="adm-atkspeed-${u.id}" value="${u.atk_speed}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Range</label>
                        <input type="number" id="adm-range-${u.id}" value="${u.range}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Move Spd</label>
                        <input type="number" step="0.1" id="adm-movespeed-${u.id}" value="${u.move_speed}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Armor</label>
                        <input type="number" id="adm-armor-${u.id}" value="${u.armor}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">M-Res</label>
                        <input type="number" id="adm-mres-${u.id}" value="${u.mres}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Crit %</label>
                        <input type="number" step="0.01" id="adm-crit-${u.id}" value="${u.crit_chance}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">P-Pen %</label>
                        <input type="number" step="0.01" id="adm-ppen-${u.id}" value="${u.phys_pen}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">M-Pen %</label>
                        <input type="number" step="0.01" id="adm-mpen-${u.id}" value="${u.magic_pen}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Dodge %</label>
                        <input type="number" step="0.01" id="adm-dodge-${u.id}" value="${u.dodge}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Lifesteal %</label>
                        <input type="number" step="0.01" id="adm-lifesteal-${u.id}" value="${u.lifesteal}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Cost</label>
                        <input type="number" id="adm-cost-${u.id}" value="${u.cost}">
                    </div>
                </div>
            </div>
        `).join('');
    }

    async function update(id, name) {
        const stats = {
            hp: parseInt(document.getElementById(`adm-hp-${id}`).value),
            mana: parseInt(document.getElementById(`adm-mana-${id}`).value),
            dmg: parseInt(document.getElementById(`adm-dmg-${id}`).value),
            atk_speed: parseFloat(document.getElementById(`adm-atkspeed-${id}`).value),
            range: parseInt(document.getElementById(`adm-range-${id}`).value),
            move_speed: parseFloat(document.getElementById(`adm-movespeed-${id}`).value),
            armor: parseInt(document.getElementById(`adm-armor-${id}`).value),
            mres: parseInt(document.getElementById(`adm-mres-${id}`).value),
            crit_chance: parseFloat(document.getElementById(`adm-crit-${id}`).value),
            phys_pen: parseFloat(document.getElementById(`adm-ppen-${id}`).value),
            magic_pen: parseFloat(document.getElementById(`adm-mpen-${id}`).value),
            dodge: parseFloat(document.getElementById(`adm-dodge-${id}`).value),
            lifesteal: parseFloat(document.getElementById(`adm-lifesteal-${id}`).value),
            cost: parseInt(document.getElementById(`adm-cost-${id}`).value),
        };

        const res = await fetch('/api/admin/units/update', {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ id, stats })
        });

        if (res.ok) {
            alert(`${name} updated successfully!`);
            await Game.fetchUnits();
        } else {
            const data = await res.json();
            alert(`Error: ${data.message}`);
        }
    }

    return { show, update };
})();

const Game = (function() {
    const MAP_W = 1000, MAP_H = 700;
    const GOLD_RATE = 0.15;
    const COLORS = [
        { name: 'Azure', main: '#38bdf8', dark: '#0c4a6e' },
        { name: 'Amber', main: '#fbbf24', dark: '#78350f' },
        { name: 'Emerald', main: '#10b981', dark: '#064e3b' },
        { name: 'Rose', main: '#f43f5e', dark: '#4c0519' }
    ];

    let CLASSES = {};
    let canvas, ctx, running = false, frameCount = 0, paused = false;
    let players = [], units = [], projectiles = [], vfx = [], particles = [], floatingTexts = [], unitsPending = [];
    let aiProcessFlags = [false, false, false, false]; 
    const MAX_PARTICLES = 150;
    const MAX_VFX = 50;
    const MAX_TEXTS = 50;
    const MAX_UNITS_PER_PLAYER = 50;

    let lastActiveState = null;
    let mousePos = { x: 0, y: 0 };

    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function getReduction(val) {
        if (val <= 0) return 0;
        if (val <= 50) return val * 0.01;
        let extra = val - 50;
        let reduction = 0.5 + 0.5 * (1 - Math.pow(0.5, extra / 50));
        return Math.min(0.99, reduction);
    }

    function calculateDamage(attacker, target, baseDmg, type) {
        if (type === 'true') return { amount: baseDmg, isCrit: false, dodged: false };
        const targetDodge = target.meta ? (target.meta.dodge + (target.buffs?.find(b => b.type === 'dodge')?.value || 0)) : 0;
        if (Math.random() < targetDodge) return { amount: 0, isCrit: false, dodged: true };

        let finalDmg = baseDmg;
        const attackerCrit = attacker.meta ? (attacker.meta.crit_chance + (attacker.buffs?.find(b => b.type === 'crit_chance')?.value || 0)) : 0;
        const isCrit = Math.random() < attackerCrit;
        if (isCrit) finalDmg *= 2;

        if (!target.meta) return { amount: finalDmg, isCrit, dodged: false };

        if (type === 'physical') {
            let armor = target.meta.armor || 0;
            armor *= (1 - (attacker.meta.phys_pen + (attacker.buffs?.find(b => b.type === 'phys_pen')?.value || 0)));
            finalDmg *= (1 - getReduction(armor));
        } else if (type === 'magic') {
            let mres = target.meta.mres || 0;
            mres *= (1 - (attacker.meta.magic_pen + (attacker.buffs?.find(b => b.type === 'magic_pen')?.value || 0)));
            finalDmg *= (1 - getReduction(mres));
        }
        return { amount: finalDmg, isCrit, dodged: false };
    }

    async function processAI(pIdx) {
        if (aiProcessFlags[pIdx]) return;
        aiProcessFlags[pIdx] = true;
        const p = players[pIdx];
        const enemies = players.filter(ep => !ep.eliminated && ep.id !== pIdx).map(ep => ({ name: ep.name, hp: ep.hp, basePos: ep.base }));
        const playerState = { name: p.name, gold: p.gold, hp: p.hp, maxHp: p.maxHp, basePos: p.base, units: units.filter(u => u.owner === pIdx).map(u => u.type) };
        const configDropdown = document.getElementById(`ai-provider-${pIdx}`);
        const provider = configDropdown ? configDropdown.value : 'random';
        
        try {
            if (provider === 'random') {
                const affordable = Object.keys(CLASSES).filter(k => CLASSES[k].cost <= p.gold);
                if (affordable.length > 0 && Math.random() > 0.5) spawnUnit(pIdx, affordable[Math.floor(Math.random() * affordable.length)]);
            } else {
                const res = await fetch('/api/ai/strategy', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ player: playerState, gameState: { enemies }, config: { provider } })
                });
                const data = await res.json();
                if (data.decision && data.decision !== 'save') spawnUnit(pIdx, data.decision);
            }
        } catch (e) {
            console.error(`AI Error for ${p.name}:`, e);
        }
        
        setTimeout(() => { aiProcessFlags[pIdx] = false; }, 3000);
    }

    async function fetchUnits() {
        const res = await fetch('/api/units');
        const data = await res.json();
        CLASSES = {};
        data.forEach(u => {
            CLASSES[u.name] = { ...u, meta: u, skill: u.special?.split(':')[0]?.toLowerCase() || 'none', skillCost: 30, skillRange: u.range * 2 };
        });
        
        // Populate System Intel Panel
        const intelList = document.getElementById('unit-intel-list');
        if (intelList) {
            intelList.innerHTML = data.map(u => `
                <div class="intel-entry">
                    <div class="intel-row">
                        <strong style="color:var(--primary)">${u.icon} ${u.name}</strong>
                        <span class="intel-hp">HP: ${u.hp}</span>
                    </div>
                    <div class="intel-row" style="margin-top:4px; font-size:10px; color:var(--text-muted)">
                        <span>DMG: ${u.dmg}</span>
                        <span>DEF: ${u.armor}/${u.mres}</span>
                    </div>
                    <div class="intel-row" style="font-size:10px; color:var(--text-muted)">
                        <span>Cost: ${u.cost}g</span>
                        <span>Spd: ${u.move_speed}</span>
                    </div>
                </div>
            `).join('');
        }
    }

    async function checkActiveSession() {
        try {
            const res = await fetch('/api/session/active', { headers: { 'Authorization': `Bearer ${Auth.getToken()}` } });
            const data = await res.json();
            if (data.hasActive) { lastActiveState = data.state; document.getElementById('resume-overlay').style.display = 'flex'; }
            else { document.getElementById('setup-overlay').style.display = 'flex'; }
        } catch (e) { document.getElementById('setup-overlay').style.display = 'flex'; }
    }

    async function saveSession() {
        if (!running) return;
        const state = {
            players: players.map(p => ({ gold: p.gold, hp: p.hp, maxHp: p.maxHp, eliminated: p.eliminated, name: p.name, config: p.config, base: p.base })),
            units: units.map(u => ({ type: u.type, owner: u.owner, x: u.x, y: u.y, hp: u.hp, mana: u.mana })),
            frameCount
        };
        await fetch('/api/session/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Auth.getToken()}` }, body: JSON.stringify({ state }) });
    }

    function togglePause() {
        paused = !paused;
        document.getElementById('pause-btn').innerText = paused ? 'RESUME' : 'PAUSE';
        if (!paused && running) requestAnimationFrame(loop);
    }

    function handleMouseMove(e) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        mousePos.x = (e.clientX - rect.left) * scaleX;
        mousePos.y = (e.clientY - rect.top) * scaleY;

        // Check for unit hover
        let hoveredUnit = null;
        units.forEach(u => { if (dist(mousePos, u) < u.radius + 5) hoveredUnit = u; });

        const popup = document.getElementById('unit-detail-popup');
        if (hoveredUnit) {
            popup.style.display = 'block';
            popup.style.left = (e.clientX + 15) + 'px';
            popup.style.top = (e.clientY + 15) + 'px';
            document.getElementById('udp-name').innerText = hoveredUnit.type;
            document.getElementById('udp-icon').innerText = hoveredUnit.meta.icon;
            document.getElementById('udp-hp').innerText = `${Math.ceil(hoveredUnit.hp)}/${hoveredUnit.maxHp}`;
            document.getElementById('udp-mana').innerText = `${Math.floor(hoveredUnit.mana)}/${hoveredUnit.maxMana}`;
            document.getElementById('udp-dmg').innerText = hoveredUnit.meta.dmg;
            document.getElementById('udp-def').innerText = `${hoveredUnit.meta.armor}/${hoveredUnit.meta.mres}`;
            document.getElementById('udp-stats').innerText = `${(hoveredUnit.meta.crit_chance*100).toFixed(0)}%/${(hoveredUnit.meta.dodge*100).toFixed(0)}%`;
            document.getElementById('udp-ls').innerText = (hoveredUnit.meta.lifesteal*100).toFixed(0) + '%';
        } else {
            popup.style.display = 'none';
        }
    }

    function spawnUnit(pIdx, type) {
        const p = players[pIdx];
        let targetType = type;
        if (type === 'Gunman' && Math.random() < 0.3) { targetType = 'Sniper'; log(`${p.name}'s Gunman evolved into SNIPER! 🎯`, '#fbbf24'); }
        if (!CLASSES[targetType]) return;
        const meta = CLASSES[targetType];
        if (p.gold < meta.cost && type === targetType) return; 
        const playerUnitCount = units.filter(u => u.owner === pIdx).length + unitsPending.filter(u => u.owner === pIdx).length;
        if (playerUnitCount >= MAX_UNITS_PER_PLAYER) return;
        if (type === targetType) {
            p.gold -= meta.cost;
            log(`${p.name} deployed ${meta.icon} ${targetType}`, p.color.main);
        }
        const angle = Math.random() * Math.PI * 2;
        const u = {
            id: Math.random().toString(36).substr(2, 9), owner: pIdx, type: targetType, meta: { ...meta }, hp: meta.hp, maxHp: meta.hp, mana: meta.mana * 0.5, maxMana: meta.mana,
            x: p.base.x + Math.cos(angle) * 50, y: p.base.y + Math.sin(angle) * 50, cooldown: 0, state: 'march', radius: 12, buffs: [], isPet: false, untargetableTimer: 0
        };
        unitsPending.push(u);
    }

    async function recordResult(result) {
        try {
            await fetch('/api/game/end', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Auth.getToken()}` },
                body: JSON.stringify({ winnerId: result === 'win' ? Auth.getUser().id : null, duration: frameCount, result })
            });
            await Auth.checkSession(); // Refresh stats
        } catch (e) { console.error("Error recording result:", e); }
    }

    async function clearSession() {
        await fetch('/api/session/clear', { method: 'POST', headers: { 'Authorization': `Bearer ${Auth.getToken()}` } });
    }

    function update() {
        if (paused) return;
        frameCount++;
        if (frameCount % 600 === 0) saveSession();

        if (frameCount % 60 === 0) {
            players.forEach((p, i) => {
                if (!p.eliminated && !p.isHuman) processAI(i);
            });
        }

        players.forEach((p, i) => {
            if (!p.eliminated) {
                p.gold += GOLD_RATE;
                const goldEl = document.getElementById(`gold-${i}`);
                if (goldEl) goldEl.innerText = `$ ${Math.floor(p.gold)}`;
                const hpEl = document.getElementById(`hp-${i}`);
                if (hpEl) hpEl.style.width = `${Math.max(0, (p.hp/p.maxHp)*100)}%`;
                
                if (p.hp <= 0) {
                    p.eliminated = true;
                    log(`${p.name} HAS BEEN ELIMINATED!`, '#f43f5e');
                }
            }
        });

        for (let i = projectiles.length - 1; i >= 0; i--) {
            const pr = projectiles[i];
            const d = dist(pr, { x: pr.tx, y: pr.ty });
            if (d < 10) {
                units.forEach(eu => { 
                    if (eu.owner !== pr.owner && eu.untargetableTimer <= 0 && dist(pr, eu) < 25) { 
                        const dmgRes = calculateDamage({ meta: pr.attackerMeta || { crit_chance: 0, phys_pen: 0, magic_pen: 0 }, buffs: pr.attackerBuffs || [] }, eu, pr.dmg, pr.dmgType);
                        if (dmgRes.dodged) spawnVFX(eu.x, eu.y, 'MISS', '#94a3b8');
                        else { 
                            eu.hp -= dmgRes.amount; eu.lastAttacker = pr.owner; 
                            spawnVFX(eu.x, eu.y, (dmgRes.isCrit ? '💥' : '') + Math.floor(dmgRes.amount), dmgRes.isCrit ? '#ff0000' : '#fff'); 
                            const ls = (pr.attackerMeta?.lifesteal || 0) + (pr.attackerBuffs?.find(b => b.type === 'lifesteal')?.value || 0);
                            if (ls > 0 && dmgRes.amount > 0) {
                                const firer = units.find(un => un.id === pr.attackerId);
                                if (firer) { const h = dmgRes.amount * ls; firer.hp = Math.min(firer.maxHp, firer.hp + h); spawnVFX(firer.x, firer.y, `+${Math.floor(h)}`, '#22c55e'); }
                            }
                        }
                    } 
                });
                players.forEach(p => {
                    if (!p.eliminated && p.id !== pr.owner && dist(pr, p.base) <= p.base.r + 15) {
                        const dmgRes = calculateDamage({ meta: pr.attackerMeta || { crit_chance: 0, phys_pen: 0, magic_pen: 0 }, buffs: pr.attackerBuffs || [] }, p, pr.dmg, pr.dmgType);
                        p.hp -= dmgRes.amount;
                        spawnVFX(pr.tx, pr.ty, (dmgRes.isCrit ? '💥' : '') + Math.floor(dmgRes.amount), dmgRes.isCrit ? '#ff0000' : '#fff');
                    }
                });
                projectiles.splice(i, 1);
            } else { const angle = Math.atan2(pr.ty - pr.y, pr.tx - pr.x); pr.x += Math.cos(angle) * pr.speed; pr.y += Math.sin(angle) * pr.speed; }
        }

        units.forEach(u => {
            if (u.cooldown > 0) u.cooldown--;
            const canRegen = !u.buffs.some(b => b.type === 'no_mana_regen');
            if (frameCount % 60 === 0) { u.hp = Math.min(u.maxHp, u.hp + 1); if (canRegen) u.mana = Math.min(u.maxMana, u.mana + 5); }
            u.buffs = u.buffs.filter(b => { b.duration--; if (b.type === 'statue') { u.x = b.origX; u.y = b.origY; } return b.duration > 0; });
            if (u.mana >= 30 && u.state === 'fight' && !u.isPet) {
                if (u.type === 'Guard') { u.mana = 0; u.maxHp *= 1.5; u.hp *= 1.5; u.buffs.push({ type: 'statue', duration: 480, origX: u.x, origY: u.y }, { type: 'armor', value: 50, duration: 480 }, { type: 'mres', value: 50, duration: 480 }, { type: 'no_mana_regen', duration: 480 }); spawnVFX(u.x, u.y, 'BLOCK!', '#94a3b8'); }
                else if (u.type === 'Assassin') { let farthest = null, maxD = 0; units.forEach(en => { if(en.owner !== u.owner && dist(u, en) < 300) { if(dist(u, en) > maxD) { maxD = dist(u, en); farthest = en; } } }); if (farthest) { u.mana = 0; u.x = farthest.x; u.y = farthest.y; u.buffs.push({ type: 'crit_chance', value: 0.5, duration: 180 }, { type: 'dodge', value: 0.5, duration: 180 }, { type: 'lifesteal', value: 0.5, duration: 180 }); spawnVFX(u.x, u.y, 'DASH!', '#f43f5e'); } }
                else if (u.type === 'Mage') { let targets = units.filter(en => en.owner !== u.owner && dist(u, en) < 35); if (targets.length > 0) { u.mana = 0; targets.forEach(en => { en.hp -= 60; if (en.hp <= 0) u.mana = Math.min(u.maxMana, u.mana + 5); spawnVFX(en.x, en.y, '60', '#f97316'); }); spawnVFX(u.x, u.y, 'FIRE!', '#f97316'); } }
            }
            let target = null, minDist = Infinity;
            units.forEach(e => { if (e.owner !== u.owner && e.untargetableTimer <= 0) { const d = dist(u, e); if (d < minDist) { minDist = d; target = e; } } });
            players.forEach(p => { if (!p.eliminated && p.id !== u.owner) { const d = dist(u, p.base) - p.base.r; if (d < minDist) { minDist = d; target = p; } } });
            if (target) {
                const tx = target.base ? target.base.x : target.x, ty = target.base ? target.base.y : target.y, tr = target.base ? target.base.r : 0;
                const d = dist(u, { x: tx, y: ty }) - tr;
                if (d <= u.meta.range) {
                    if (u.cooldown <= 0) {
                        let fAtkSpd = u.meta.atk_speed; u.buffs.forEach(b => { if(b.type === 'atk_speed_mult') fAtkSpd *= b.value; });
                        u.cooldown = Math.floor(60 / fAtkSpd);
                        if (u.meta.range < 35) {
                            const ls = u.meta.lifesteal + (u.buffs.find(b => b.type === 'lifesteal')?.value || 0);
                            const res = calculateDamage(u, target, u.meta.dmg, u.meta.dmg_type);
                            if (res.dodged) spawnVFX(tx, ty, 'MISS', '#94a3b8');
                            else { target.hp -= res.amount; if (ls > 0) { const h = res.amount * ls; u.hp = Math.min(u.maxHp, u.hp + h); spawnVFX(u.x, u.y, `+${Math.floor(h)}`, '#22c55e'); } spawnVFX(tx, ty, (res.isCrit?'💥':'')+Math.floor(res.amount), res.isCrit?'#ff0000':'#fff'); }
                        } else projectiles.push({ x: u.x, y: u.y, tx, ty, owner: u.owner, dmg: u.meta.dmg, speed: 8, color: players[u.owner].color.main, dmgType: u.meta.dmg_type, attackerMeta: u.meta, attackerBuffs: [...u.buffs], attackerId: u.id });
                    }
                    u.state = 'fight';
                } else { const angle = Math.atan2(ty - u.y, tx - u.x); u.x += Math.cos(angle) * u.meta.move_speed; u.y += Math.sin(angle) * u.meta.move_speed; u.state = 'march'; }
            }
        });

        for (let i = units.length - 1; i >= 0; i--) { if (units[i].hp <= 0) { const u = units[i]; if (u.lastAttacker !== null && players[u.lastAttacker]) players[u.lastAttacker].gold += u.meta.cost * 0.3; units.splice(i, 1); } }
        if (unitsPending.length > 0) { units.push(...unitsPending); unitsPending = []; }

        const activePlayers = players.filter(p => !p.eliminated);
        if (players[0].eliminated || activePlayers.length <= 1) {
            running = false;
            document.getElementById('victory-overlay').style.display = 'flex';
            const vText = document.getElementById('victory-text');
            const result = (activePlayers.length === 1 && activePlayers[0].id === 0) ? 'win' : 'loss';
            
            if (result === 'win') {
                vText.innerText = 'VICTORY';
                vText.style.color = 'var(--success)';
            } else {
                vText.innerText = 'DEFEAT';
                vText.style.color = 'var(--danger)';
            }
            
            clearSession();
            recordResult(result);
        }
    }

    function draw() {
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        players.forEach(p => {
            ctx.fillStyle = p.eliminated ? '#0f172a' : p.color.dark; ctx.strokeStyle = p.color.main; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.arc(p.base.x, p.base.y, p.base.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            if (!p.eliminated) { ctx.beginPath(); ctx.arc(p.base.x, p.base.y, p.base.r + 5, -Math.PI/2, (-Math.PI/2) + (Math.PI*2 * (p.hp/p.maxHp))); ctx.strokeStyle = p.color.main; ctx.lineWidth = 4; ctx.stroke(); }
        });
        units.forEach(u => {
            const p = players[u.owner]; ctx.fillStyle = p.color.main; ctx.beginPath(); ctx.arc(u.x, u.y, u.radius, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#fff'; ctx.font = 'bold 13px "Rajdhani"'; ctx.textAlign = 'center'; ctx.fillText(u.meta.icon, u.x, u.y + 4);
            const hbW = u.radius * 2; ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(u.x - u.radius, u.y - u.radius - 8, hbW, 3); ctx.fillStyle = '#22c55e'; ctx.fillRect(u.x - u.radius, u.y - u.radius - 8, hbW * (u.hp/u.maxHp), 3);
        });
        projectiles.forEach(pr => { ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI * 2); ctx.fill(); });
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            let t = floatingTexts[i];
            ctx.globalAlpha = t.life / 60; ctx.fillStyle = t.color; ctx.font = 'bold 14px "Rajdhani"'; ctx.fillText(t.text, t.x, t.y);
            t.y += t.vy; t.life--;
            if (t.life <= 0) floatingTexts.splice(i, 1);
        }
        ctx.globalAlpha = 1;
        if (paused) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,MAP_W,MAP_H); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Rajdhani'; ctx.fillText("GAME PAUSED", MAP_W/2, MAP_H/2); }
    }

    function loop() { if (!running) return; update(); draw(); if (!paused) requestAnimationFrame(loop); }

    function updateSetupUI() {
        const count = parseInt(document.getElementById('player-count').value);
        const configContainer = document.getElementById('agents-config');
        if (!configContainer) return;
        
        let html = '';
        for (let i = 0; i < count; i++) {
            const isHuman = i === 0;
            html += `
                <div class="setup-card" style="border-left: 4px solid ${COLORS[i].main}">
                    <div style="font-weight:bold; margin-bottom:10px; color:${COLORS[i].main}">${isHuman ? 'COMMANDER (YOU)' : `AGENT ${i+1}`}</div>
                    <div class="auth-input-group">
                        <label>AI Strategy</label>
                        <select id="ai-provider-${i}" ${isHuman ? 'disabled' : ''}>
                            <option value="deepseek">DeepSeek-V4</option>
                            <option value="openai">GPT-4o Mini</option>
                            <option value="random">Random Chaos</option>
                        </select>
                    </div>
                </div>
            `;
        }
        configContainer.innerHTML = html;
    }

    function resume() {
        document.getElementById('resume-overlay').style.display = 'none';
        init(lastActiveState);
    }

    function startFresh() {
        document.getElementById('resume-overlay').style.display = 'none';
        fetch('/api/session/clear', { method: 'POST', headers: { 'Authorization': `Bearer ${Auth.getToken()}` } });
        document.getElementById('setup-overlay').style.display = 'flex';
        updateSetupUI();
    }

    function init(state = null) {
        document.getElementById('setup-overlay').style.display = 'none';
        canvas = document.getElementById('gameCanvas'); 
        canvas.width = MAP_W;
        canvas.height = MAP_H;
        ctx = canvas.getContext('2d');
        canvas.addEventListener('mousemove', handleMouseMove);
        
        const count = state ? state.players.length : parseInt(document.getElementById('player-count').value);
        players = []; 
        projectiles = [];
        vfx = [];
        floatingTexts = [];
        unitsPending = [];
        
        const dash = document.getElementById('dashboard'); 
        dash.innerHTML = '';
        
        for (let i = 0; i < count; i++) {
            const isHuman = i === 0;
            if (state) players.push({ ...state.players[i], id: i, color: COLORS[i], isHuman });
            else players.push({ id: i, name: isHuman ? Auth.getUser().username : `Agent ${i+1}`, isHuman, color: COLORS[i], gold: 150, hp: 2500, maxHp: 2500, base: { x: i%2?MAP_W-80:80, y: i<2?80:MAP_H-80, r: 50 }, eliminated: false });
            dash.innerHTML += `<div class="player-card" style="border-top:2px solid ${COLORS[i].main}"><div class="card-header"><span class="player-name">${players[i].name}</span><span class="resource-count" id="gold-${i}">$ ${players[i].gold}</span></div><div class="hp-bg"><div class="hp-bar" id="hp-${i}" style="width:${(players[i].hp/players[i].maxHp)*100}%"></div></div></div>`;
        }

        if (state) {
            units = state.units.map(u => ({
                ...u,
                meta: { ...CLASSES[u.type] },
                id: Math.random().toString(36).substr(2, 9),
                radius: 12, buffs: [], isPet: false, untargetableTimer: 0, cooldown: 0, state: 'march'
            }));
            frameCount = state.frameCount || 0;
        } else {
            units = [];
            frameCount = 0;
        }

        document.getElementById('deployment-hud').style.display = 'block';
        document.getElementById('unit-buttons').innerHTML = Object.keys(CLASSES).filter(k => CLASSES[k].cost > 0).map(k => `<button class="unit-btn" id="btn-${k}" onclick="Game.buy('${k}', 0)"><span class="u-icon">${CLASSES[k].icon}</span><span class="u-name">${k}</span><span class="u-cost">${CLASSES[k].cost}g</span></button>`).join('');
        
        log(state ? `SESSION RESUMED AT FRAME ${frameCount}.` : `STRATEGIC SESSION INITIALIZED.`, '#38bdf8');
        log(`Commander ${players[0].name} online.`, '#fff');
        
        running = true; requestAnimationFrame(loop);
    }

    function spawnVFX(x, y, text, color) { if (floatingTexts.length < MAX_TEXTS) floatingTexts.push({ x, y, text, color, life: 60, vy: -1 }); }
    function log(msg, color) { const l = document.getElementById('combat-log'); if (!l) return; const e = document.createElement('div'); e.className = 'log-entry'; e.style.color = color; e.innerHTML = msg; l.prepend(e); }

    return { init, buy: (t, p) => spawnUnit(p, t), fetchUnits, checkActiveSession, togglePause, resume, startFresh, updateSetupUI };
})();

window.UI = UI;
window.Auth = Auth;
window.Admin = Admin;
window.Game = Game;

window.onload = () => Auth.checkSession();
