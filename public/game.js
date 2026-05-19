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

    const CLASSES = {
        Guard: { icon: '🛡️', hp: 200, mana: 50, speed: 1.1, range: 25, dmg: 15, cd: 40, cost: 80, skill: 'block', skillCost: 30 },
        Assassin: { icon: '🗡️', hp: 80, mana: 80, speed: 1.9, range: 20, dmg: 35, cd: 30, cost: 60, skill: 'blink', skillCost: 40 },
        Mage: { icon: '🔮', hp: 70, mana: 150, speed: 0.8, range: 140, dmg: 20, cd: 65, cost: 75, skill: 'freeze', aoe: 50, skillCost: 60 },
        Healer: { icon: '✨', hp: 90, mana: 120, speed: 1.0, range: 120, heal: 5, cd: 55, cost: 50, skill: 'aura', skillCost: 20 },
        Bowman: { icon: '🏹', hp: 100, mana: 40, speed: 1.2, range: 180, dmg: 14, cd: 35, cost: 45, skill: 'pierce', skillCost: 15 },
        Gunman: { icon: '🔫', hp: 110, mana: 60, speed: 0.9, range: 160, dmg: 45, cd: 100, cost: 90, skill: 'burst', skillCost: 50 },
        Hunter: { icon: '🐾', hp: 130, mana: 70, speed: 1.4, range: 130, dmg: 20, cd: 45, cost: 55, skill: 'recall_pet', skillCost: 25 }
    };

    // ===== STATE =====
    let canvas, ctx, running = false, frameCount = 0;
    let players = [], units = [], projectiles = [], vfx = [], particles = [];
    let aiProcessFlags = [false, false, false, false]; 

    // ===== HELPERS =====
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

    function spawnParticles(x, y, color, count) {
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
        const el = document.createElement('div');
        el.className = 'dmg-text';
        el.style.left = `${(x / MAP_W) * 100}%`;
        el.style.top = `${(y / MAP_H) * 100}%`;
        el.style.color = color || '#f1f5f9';
        el.innerText = text;
        const wrap = document.getElementById('map-wrap');
        if (wrap) wrap.appendChild(el);
        setTimeout(() => el.remove(), 800);
    }

    // ===== CORE LOGIC =====
    function spawnUnit(pIdx, type) {
        const p = players[pIdx];
        const meta = CLASSES[type];
        if (p.gold < meta.cost) return;

        p.gold -= meta.cost;
        const angle = Math.random() * Math.PI * 2;
        const u = {
            id: Math.random().toString(36).substr(2, 9), owner: pIdx,
            type, meta, hp: meta.hp, maxHp: meta.hp,
            mana: meta.mana * 0.5, maxMana: meta.mana,
            x: p.base.x + Math.cos(angle) * 50, y: p.base.y + Math.sin(angle) * 50,
            cooldown: 0, skillTimer: 0, untargetableTimer: 0, state: 'march', radius: 12,
            lastAttacker: null
        };
        units.push(u);
        spawnParticles(u.x, u.y, p.color.main, 10);
        log(`${p.name} deployed ${type} ${meta.icon}`, p.color.main);
    }

    async function processAIStrategic(pIdx) {
        const p = players[pIdx];
        if (p.eliminated || aiProcessFlags[pIdx]) return;

        const affordable = Object.keys(CLASSES).filter(k => CLASSES[k].cost <= p.gold);
        if (affordable.length === 0) return;

        if (p.gold > 250) {
            spawnUnit(pIdx, affordable[Math.floor(Math.random()*affordable.length)]);
            return;
        }

        if (p.config.provider === 'local') {
            spawnUnit(pIdx, affordable[Math.floor(Math.random()*affordable.length)]);
            return;
        }

        aiProcessFlags[pIdx] = true;
        try {
            const response = await fetch('/api/ai/strategy', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    player: { name: p.name, gold: p.gold, hp: p.hp, maxHp: p.maxHp, units: units.filter(u => u.owner === pIdx).map(u => u.type) },
                    gameState: { enemies: players.filter(pl => pl.id !== pIdx && !pl.eliminated).map(pl => ({ name: pl.name, hp: pl.hp })) },
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

        // Update Particles
        particles.forEach((pt, i) => {
            pt.x += pt.vx; pt.y += pt.vy; pt.life--;
            if (pt.life <= 0) particles.splice(i, 1);
        });

        players.forEach((p, i) => {
            if (p.eliminated) return;
            p.gold += GOLD_RATE;

            if (frameCount % 60 === 0) {
                let targetUnit = null, minDist = 200;
                units.forEach(u => {
                    if (u.owner !== i && u.untargetableTimer <= 0) {
                        const d = dist(p.base, u);
                        if (d < minDist) { minDist = d; targetUnit = u; }
                    }
                });
                if (targetUnit) {
                    projectiles.push({
                        x: p.base.x, y: p.base.y, tx: targetUnit.x, ty: targetUnit.y,
                        owner: i, dmg: 20, isAoE: false, speed: 12, color: p.color.main, isBaseDefense: true
                    });
                }
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
            if (u.skillTimer > 0) u.skillTimer--;
            if (u.untargetableTimer > 0) u.untargetableTimer--;
            
            if (u.skillTimer <= 0) u.state = (u.state === 'block') ? 'block' : 'march';

            let target = null, minDist = Infinity;
            if (u.type === 'Healer') {
                units.forEach(a => { if (a.owner === u.owner && a.id !== u.id && a.hp < a.maxHp * 0.5) { const d = dist(u, a); if (d < minDist) { minDist = d; target = a; } } });
            } else {
                units.forEach(e => { if (e.owner !== u.owner && e.untargetableTimer <= 0) { const d = dist(u, e); if (d < minDist) { minDist = d; target = e; } } });
                players.forEach(p => { if (!p.eliminated && p.id !== u.owner) { const d = dist(u, p.base); if (d < minDist * 1.5) { minDist = d; target = p; } } });
            }

            if (target) {
                const tx = target.base ? target.base.x : target.x, ty = target.base ? target.base.y : target.y;
                const d = dist(u, { x: tx, y: ty });
                if (d <= u.meta.range) {
                    if (u.cooldown <= 0) {
                        u.cooldown = u.meta.cd;
                        let usedSkill = false;
                        if (u.mana >= u.meta.skillCost) {
                            if (u.type === 'Guard' && Math.random() < 0.4) { 
                                u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.5); u.mana -= u.meta.skillCost; usedSkill = true; 
                                spawnVFX(u.x, u.y, "HEAL!", "#44ff44");
                                spawnSkillVFX('circle', u.x, u.y, { color: '#ffd700', radius: 40, life: 20 });
                            }
                            else if (u.type === 'Assassin' && Math.random() < 0.4) { 
                                let farthestEnemy = null, maxD = -1;
                                units.forEach(e => { if (e.owner !== u.owner && e.untargetableTimer <= 0) { const d = dist(u, e); if (d <= 350 && d > maxD) { maxD = d; farthestEnemy = e; } } });
                                if (farthestEnemy) { 
                                    spawnSkillVFX('line', u.x, u.y, { targetX: farthestEnemy.x, targetY: farthestEnemy.y, color: '#ff00ff', life: 15 });
                                    u.x = farthestEnemy.x + (Math.random()-0.5)*10; u.y = farthestEnemy.y + (Math.random()-0.5)*10; 
                                    u.mana -= u.meta.skillCost; u.untargetableTimer = 18; usedSkill = true; 
                                    spawnVFX(u.x, u.y, "BLINK!", "#ff00ff");
                                    spawnSkillVFX('circle', u.x, u.y, { color: '#ff00ff', radius: 30, life: 10 });
                                }
                            } else if (u.type === 'Hunter' && Math.random() < 0.4) {
                                let pet = units.find(p => p.type === 'Pet' && p.hunterId === u.id);
                                if (!pet) {
                                    pet = { id: Math.random().toString(36).substr(2, 9), owner: u.owner, hunterId: u.id, type: 'Pet', meta: { icon: '🐕', hp: u.meta.hp * 0.5, dmg: u.meta.dmg * 0.5, speed: u.meta.speed * 1.2, range: 25, cd: 30, cost: 0 }, hp: u.maxHp * 0.5, maxHp: u.maxHp * 0.5, mana: 0, maxMana: 0, x: u.x, y: u.y, cooldown: 0, skillTimer: 0, untargetableTimer: 0, state: 'march', radius: 8, lastAttacker: null };
                                    units.push(pet); spawnVFX(u.x, u.y, "SUMMON!", "#aa6600");
                                    spawnSkillVFX('circle', u.x, u.y, { color: '#aa6600', radius: 35, life: 20 });
                                } else { 
                                    spawnSkillVFX('line', pet.x, pet.y, { targetX: u.x, targetY: u.y, color: '#aa6600', life: 15 });
                                    pet.x = u.x; pet.y = u.y; spawnVFX(u.x, u.y, "RECALL!", "#aa6600"); 
                                }
                                u.mana -= u.meta.skillCost; usedSkill = true;
                            } else if (u.type === 'Healer' && Math.random() < 0.5) { 
                                target.hp = Math.min(target.maxHp, target.hp + 30); u.mana -= u.meta.skillCost; usedSkill = true; 
                                spawnVFX(tx, ty, "++30", "#44ff44");
                                spawnSkillVFX('pulse', tx, ty, { color: '#44ff44', radius: 50, life: 25 });
                            } else if (u.type === 'Bowman' && Math.random() < 0.5) {
                                u.mana -= u.meta.skillCost; usedSkill = true;
                                spawnVFX(u.x, u.y, "PIERCE!", "#ffff00");
                                projectiles.push({ x: u.x, y: u.y, tx, ty, owner: u.owner, dmg: u.meta.dmg * 2, speed: 15, color: '#ffff00' });
                                spawnSkillVFX('line', u.x, u.y, { targetX: tx, targetY: ty, color: '#ffff00', life: 10 });
                            } else if (u.type === 'Gunman' && Math.random() < 0.5) {
                                u.mana -= u.meta.skillCost; usedSkill = true;
                                spawnVFX(u.x, u.y, "BURST!", "#ff4400");
                                for(let j=0; j<3; j++) {
                                    setTimeout(() => {
                                        if (target && target.hp > 0) projectiles.push({ x: u.x, y: u.y, tx: tx + (Math.random()-0.5)*20, ty: ty + (Math.random()-0.5)*20, owner: u.owner, dmg: u.meta.dmg * 0.6, speed: 10, color: '#ff8800' });
                                    }, j * 100);
                                }
                                spawnSkillVFX('circle', u.x, u.y, { color: '#ff4400', radius: 25, life: 15 });
                            }
                        }
                        if (!usedSkill) {
                            if (u.type === 'Healer') { 
                                target.hp = Math.min(target.maxHp, target.hp + u.meta.heal); spawnVFX(tx, ty, `+${u.meta.heal}`, "#44ff44"); 
                                spawnSkillVFX('pulse', tx, ty, { color: '#44ff44', radius: 25, life: 15 });
                            }
                            else if (u.meta.range < 35) {
                                let dmg = u.meta.dmg; if (target.state === 'block') dmg *= 0.2;
                                target.hp -= dmg; if (target.base === undefined) target.lastAttacker = u.owner;
                                spawnVFX(tx, ty, `-${Math.floor(dmg)}`, players[u.owner].color.main);
                                if (Math.random() < 0.3) spawnSkillVFX('slash', tx, ty, { color: players[u.owner].color.main, life: 10 });
                            } else {
                                const isMageSkill = (u.type === 'Mage' && u.mana >= u.meta.skillCost && Math.random() < 0.5);
                                let finalDmg = u.meta.dmg; if (isMageSkill) { 
                                    u.mana -= u.meta.skillCost; finalDmg *= 1.5; 
                                    spawnSkillVFX('circle', u.x, u.y, { color: '#44aaff', radius: 30, life: 15 });
                                }
                                projectiles.push({ x: u.x, y: u.y, tx, ty, owner: u.owner, dmg: finalDmg, isAoE: !!u.meta.aoe, aoe: u.meta.aoe || 0, speed: 8, color: players[u.owner].color.main, isFreeze: u.type === 'Mage' && isMageSkill });
                            }
                        }
                    }
                    u.state = (u.state === 'block') ? 'block' : 'fight';
                } else if (u.state !== 'block') {
                    const angle = Math.atan2(ty - u.y, tx - u.x);
                    u.x += Math.cos(angle) * u.meta.speed; u.y += Math.sin(angle) * u.meta.speed; u.state = 'march';
                }
            }
        });

        projectiles.forEach((pr, i) => {
            const d = dist(pr, { x: pr.tx, y: pr.ty });
            if (d < 10) {
                spawnParticles(pr.x, pr.y, pr.color, 5);
                if (pr.isAoE) {
                    spawnSkillVFX('circle', pr.x, pr.y, { color: pr.isFreeze ? '#44aaff' : '#ffaa00', radius: pr.aoe, life: 20 });
                    units.forEach(eu => { if (eu.owner !== pr.owner && eu.untargetableTimer <= 0 && dist(pr, eu) < pr.aoe) { eu.hp -= pr.dmg; eu.lastAttacker = pr.owner; if (pr.isFreeze) eu.cooldown += 50; spawnVFX(eu.x, eu.y, `-${pr.dmg}`, '#ffaa00'); } });
                    players.forEach(p => { if (!p.eliminated && p.id !== pr.owner && dist(pr, p.base) < pr.aoe + 45) { p.hp -= pr.dmg; spawnVFX(p.base.x, p.base.y, `-${pr.dmg}`, '#ffaa00'); } });
                } else {
                    units.forEach(eu => { if (eu.owner !== pr.owner && eu.untargetableTimer <= 0 && dist(pr, eu) < 25) { eu.hp -= pr.dmg; eu.lastAttacker = pr.owner; spawnVFX(eu.x, eu.y, `-${pr.dmg}`, '#fff'); } });
                    players.forEach(p => { if (!p.eliminated && p.id !== pr.owner && dist(pr, p.base) < 60) { p.hp -= pr.dmg; spawnVFX(p.base.x, p.base.y, `-${pr.dmg}`, '#fff'); } });
                }
                projectiles.splice(i, 1);
            } else {
                const angle = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
                pr.x += Math.cos(angle) * pr.speed; pr.y += Math.sin(angle) * pr.speed;
            }
        });

        vfx.forEach((v, i) => { v.life--; if (v.life <= 0) vfx.splice(i, 1); });
        particles.forEach((p, i) => { p.x += p.vx; p.y += p.vy; p.life--; if (p.life <= 0) particles.splice(i, 1); });

        units.forEach(u => {
            if (u.hp <= 0) {
                spawnParticles(u.x, u.y, players[u.owner].color.main, 15);
                if (u.lastAttacker !== null) {
                    const killer = players[u.lastAttacker];
                    if (killer && !killer.eliminated) {
                        const reward = u.meta.cost * 0.3;
                        killer.gold += reward; spawnVFX(u.x, u.y, `+${Math.floor(reward)}g`, 'var(--accent)');
                    }
                }
            }
        });

        units = units.filter(u => u.hp > 0);
        players.forEach(p => { 
            if (!p.eliminated && p.hp <= 0) { 
                p.eliminated = true; 
                spawnParticles(p.base.x, p.base.y, p.color.main, 50);
                units = units.filter(u => u.owner !== p.id); 
                log(`CRITICAL: ${p.name} eliminated!`, '#ff4444'); 
                const card = document.getElementById(`card-${p.id}`); 
                if (card) card.classList.add('eliminated'); 
            } 
        });
        const alive = players.filter(p => !p.eliminated);
        if (alive.length <= 1 && frameCount > 300) endGame(alive[0]);
    }

    function draw() {
        if (!ctx) return;
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        players.forEach(p => {
            ctx.fillStyle = p.eliminated ? '#0f172a' : p.color.dark; ctx.strokeStyle = p.color.main; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(p.base.x, p.base.y, p.base.r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = '32px serif'; ctx.textAlign = 'center'; ctx.fillText(p.eliminated ? '☠️' : '🏰', p.base.x, p.base.y + 12);
        });
        units.forEach(u => {
            ctx.save(); 
            ctx.fillStyle = players[u.owner].color.main; ctx.strokeStyle = u.state === 'block' ? '#fff' : 'rgba(0,0,0,0.3)'; ctx.lineWidth = u.state === 'block' ? 3 : 1;
            ctx.beginPath(); ctx.arc(u.x, u.y, u.radius, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#fff'; ctx.font = '12px serif'; ctx.textAlign = 'center'; ctx.fillText(u.meta.icon, u.x, u.y + 4);
            const hPerc = u.hp / u.maxHp, mPerc = u.mana / u.maxMana;
            ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.fillRect(u.x-12, u.y-22, 24, 4);
            ctx.fillStyle = '#10b981'; ctx.fillRect(u.x-12, u.y-22, 24 * hPerc, 2);
            ctx.fillStyle = '#38bdf8'; ctx.fillRect(u.x-12, u.y-20, 24 * mPerc, 2);
            ctx.restore();
        });
        projectiles.forEach(pr => { ctx.fillStyle = pr.color; ctx.beginPath(); ctx.arc(pr.x, pr.y, 4, 0, Math.PI * 2); ctx.fill(); });
        
        vfx.forEach(v => {
            ctx.save();
            ctx.globalAlpha = v.life / v.maxLife;
            ctx.strokeStyle = v.color; ctx.fillStyle = v.color; ctx.lineWidth = 2;
            if (v.type === 'circle') {
                ctx.beginPath(); ctx.arc(v.x, v.y, v.radius * (1 - v.life/v.maxLife), 0, Math.PI * 2); ctx.stroke();
            } else if (v.type === 'pulse') {
                ctx.beginPath(); ctx.arc(v.x, v.y, v.radius, 0, Math.PI * 2); ctx.stroke();
                ctx.globalAlpha *= 0.3; ctx.fill();
            } else if (v.type === 'line') {
                ctx.beginPath(); ctx.moveTo(v.x, v.y); ctx.lineTo(v.targetX, v.targetY); ctx.stroke();
            } else if (v.type === 'slash') {
                ctx.beginPath(); ctx.moveTo(v.x-15, v.y-15); ctx.lineTo(v.x+15, v.y+15); ctx.stroke();
            }
            ctx.restore();
        });

        particles.forEach(pt => {
            ctx.save();
            ctx.globalAlpha = pt.life / 50;
            ctx.fillStyle = pt.color;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        });
    }

    function loop() { if (!running) return; update(); draw(); requestAnimationFrame(loop); }

    function updateSetupUI() {
        const count = parseInt(document.getElementById('player-count').value);
        for (let i = 1; i <= 4; i++) {
            const card = document.getElementById(`agent-card-${i}`);
            if (card) card.style.display = (i <= count) ? 'block' : 'none';
        }
    }

    function init() {
        const count = parseInt(document.getElementById('player-count').value);
        const overlay = document.getElementById('setup-overlay');
        if (overlay) overlay.style.display = 'none';
        canvas = document.getElementById('gameCanvas'); 
        if (!canvas) return;
        canvas.width = MAP_W; canvas.height = MAP_H; ctx = canvas.getContext('2d');
        const pos = [{ x: 80, y: 80 }, { x: MAP_W - 80, y: MAP_H - 80 }, { x: MAP_W - 80, y: 80 }, { x: 80, y: MAP_H - 80 }];
        const dash = document.getElementById('dashboard'); 
        if (dash) dash.innerHTML = '';
        
        players = [];
        let firstHumanIdx = -1;

        for (let i = 0; i < count; i++) {
            const typeSelect = document.getElementById(`p${i+1}-type`);
            const isHuman = typeSelect ? typeSelect.value === 'human' : false;
            const providerSelect = document.getElementById(`p${i+1}-provider`);
            const modelSelect = document.getElementById(`p${i+1}-model`);
            const config = {
                provider: providerSelect ? providerSelect.value : 'local',
                model: modelSelect ? modelSelect.value : 'default'
            };

            players.push({ id: i, name: isHuman ? `Commander ${i+1}` : `Agent ${i + 1}`, isHuman, color: COLORS[i], gold: 150, hp: 2500, maxHp: 2500, base: { x: pos[i].x, y: pos[i].y, r: 50 }, eliminated: false, config });
            if (dash) dash.innerHTML += `
                <div class="player-card" id="card-${i}" style="border-top: 2px solid ${COLORS[i].main}">
                    <div class="card-header">
                        <span class="player-name">${players[i].name}</span>
                        <span class="resource-count" id="gold-${i}">$ 150</span>
                    </div>
                    <div class="hp-bg">
                        <div class="hp-bar" id="hp-${i}" style="width:100%"></div>
                    </div>
                    ${!isHuman ? `<div style="font-size:9px; text-align:center; color:var(--text-muted); margin-top:4px; font-family:var(--font-data)">AI: ${config.provider.toUpperCase()}</div>` : ''}
                </div>`;
            
            if (isHuman && firstHumanIdx === -1) firstHumanIdx = i;
        }

        const hud = document.getElementById('deployment-hud');
        if (firstHumanIdx !== -1 && hud) {
            hud.style.display = 'block';
            const unitButtons = document.getElementById('unit-buttons');
            if (unitButtons) unitButtons.innerHTML = Object.keys(CLASSES).map(type => `<button class="unit-btn" id="btn-${type}" onclick="Game.buy('${type}', ${firstHumanIdx})"><span class="u-icon">${CLASSES[type].icon}</span><span class="u-name">${type}</span><span class="u-cost">${CLASSES[type].cost}g</span></button>`).join('');
        } else if (hud) {
            hud.style.display = 'none';
        }

        running = true; log("Arena initialized. Systems online.", "var(--primary)"); requestAnimationFrame(loop);
    }

    function endGame(winner) { running = false; const vic = document.getElementById('victory-overlay'); if (vic) vic.style.display = 'flex'; const vicText = document.getElementById('victory-text'); if (vicText) vicText.innerText = winner ? `${winner.name} TRIUMPHS!` : "DRAW"; }

    return { init, updateSetupUI, buy: (type, pIdx) => spawnUnit(pIdx, type), COLORS };
})();

function updateModelOptions(pIdx, providerId) {
    const modelSelect = document.getElementById(`p${pIdx}-model`);
    if (!modelSelect) return;
    const models = {
        deepseek: ['deepseek-v4-flash', 'deepseek-v4-pro'],
        openai: ['o4-mini', 'gpt-5.4-mini', 'gpt-5-2025-08-07'],
        local: ['rule-based-default']
    };
    const list = models[providerId] || ['default'];
    modelSelect.innerHTML = list.map(m => `<option value="${m}">${m}</option>`).join('');
}

// DYNAMIC SETUP UI GENERATOR
(function() {
    const grid = document.getElementById('agents-config');
    if (!grid) return;
    const providers = [
        { id: 'deepseek', label: 'DEEPSEEK', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
        { id: 'openai', label: 'OPENAI', models: ['o4-mini', 'gpt-5.4-mini', 'gpt-5-2025-08-07'] },
        { id: 'local', label: 'LOCAL', models: ['rule-based-default'] }
    ];
    
    for (let i = 1; i <= 4; i++) {
        const card = document.createElement('div');
        card.className = `agent-setup-card ${i===1?'active-p1':''}`;
        card.id = `agent-card-${i}`;
        card.innerHTML = `
            <div class="a-title">
                <span>SLOT 0${i}</span>
                <span style="font-size:10px; color:${Game.COLORS[i-1].main}; font-family:var(--font-data)">● ${Game.COLORS[i-1].name}</span>
            </div>
            <label>Controller</label>
            <select id="p${i}-type" onchange="const fields = document.getElementById('p${i}-ai-fields'); if (fields) fields.style.display = this.value==='ai'?'block':'none'">
                <option value="human" ${i===1?'selected':''}>Human Commander</option>
                <option value="ai" ${i!==1?'selected':''}>AI Strategist</option>
            </select>
            <div id="p${i}-ai-fields" style="display: ${i===1?'none':'block'}">
                <label>Provider</label>
                <select id="p${i}-provider" onchange="updateModelOptions(${i}, this.value)">
                    ${providers.map(p => `<option value="${p.id}">${p.label}</option>`).join('')}
                </select>
                <label>Active Model</label>
                <select id="p${i}-model"></select>
            </div>
        `;
        grid.appendChild(card);
        updateModelOptions(i, providers[0].id);
    }
    Game.updateSetupUI();
})();
