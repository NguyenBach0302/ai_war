const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
}[ch]));

const MobileViewport = (function() {
    let frame = null;

    function sync() {
        if (frame) cancelAnimationFrame(frame);
        frame = requestAnimationFrame(() => {
            frame = null;
            const vv = window.visualViewport;
            const height = Math.round(vv?.height || window.innerHeight || document.documentElement.clientHeight);
            document.documentElement.style.setProperty('--app-height', `${height}px`);
            document.body.classList.toggle('is-fullscreen', !!document.fullscreenElement);
        });
    }

    function init() {
        sync();
        window.addEventListener('resize', sync, { passive: true });
        window.addEventListener('orientationchange', () => setTimeout(sync, 250), { passive: true });
        window.visualViewport?.addEventListener('resize', sync, { passive: true });
        window.visualViewport?.addEventListener('scroll', sync, { passive: true });
        document.addEventListener('fullscreenchange', sync);
    }

    return { init, sync };
})();

const Auth = (function() {
    let currentUser = null;
    let token = localStorage.getItem('token');

    async function login() {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        try {
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
                alert(data.message || 'Login failed');
            }
        } catch (err) {
            alert('Cannot reach the server. Please try again.');
        }
    }

    async function register() {
        const username = document.getElementById('reg-username').value.trim();
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

        try {
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
                alert(data.message || 'Registration failed');
            }
        } catch (err) {
            alert('Cannot reach the server. Please try again.');
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
            <span>Welcome, <strong>${escapeHtml(currentUser.username)}</strong></span>
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

const Online = (function() {
    let source = null;
    let currentMatchId = null;

    function setStatus(message) {
        const el = document.getElementById('online-status');
        if (el) el.textContent = message || '';
    }

    function closeStream() {
        if (source) source.close();
        source = null;
    }

    function openStream(matchId) {
        closeStream();
        const token = encodeURIComponent(Auth.getToken());
        source = new EventSource(`/api/match/stream?matchId=${encodeURIComponent(matchId)}&token=${token}`);
        source.addEventListener('match-start', event => {
            const data = JSON.parse(event.data);
            currentMatchId = data.matchId;
            Game.init(null, {
                online: true,
                matchId: data.matchId,
                playerIndex: data.playerIndex,
                players: data.players,
                seed: data.seed,
                startsAt: data.startsAt
            });
        });
        source.addEventListener('match-action', event => {
            Game.applyOnlineAction(JSON.parse(event.data));
        });
        source.addEventListener('player-disconnected', () => {
            setStatus('Opponent disconnected. Match can continue, but they may stop responding.');
        });
        source.addEventListener('match-ended', () => {
            closeStream();
            setStatus('Match ended.');
        });
        source.onerror = () => setStatus('Online connection interrupted. Reconnecting...');
    }

    async function findMatch() {
        setStatus('Searching for an opponent...');
        try {
            const res = await fetch('/api/match/join', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${Auth.getToken()}` }
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Unable to join online match');
            currentMatchId = data.matchId;
            openStream(data.matchId);
            if (data.status === 'waiting') {
                setStatus('Waiting for player 2 to join from another device...');
            } else {
                setStatus('Opponent found. Launching match...');
            }
        } catch (err) {
            setStatus(err.message || 'Unable to start online match.');
        }
    }

    async function sendBuy(unitType) {
        if (!currentMatchId) return;
        await fetch('/api/match/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ matchId: currentMatchId, type: 'buy', unitType })
        });
    }

    function leave() {
        if (currentMatchId) {
            fetch('/api/match/leave', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: JSON.stringify({ matchId: currentMatchId })
            }).catch(() => {});
        }
        currentMatchId = null;
        closeStream();
    }

    return { findMatch, sendBuy, leave };
})();

const Admin = (function() {
    async function show() {
        const list = document.getElementById('admin-unit-list');
        list.innerHTML = '<p style="color:var(--primary)">Loading unit data...</p>';
        document.getElementById('admin-overlay').style.display = 'flex';
        
        const res = await fetch('/api/units');
        if (!res.ok) {
            list.innerHTML = '<p style="color:var(--danger)">Unable to load unit data.</p>';
            return;
        }
        const units = await res.json();
        
        list.innerHTML = units.map(u => `
            <div class="intel-entry" style="display:flex; flex-direction:column; gap:12px; padding:20px; border:1px solid var(--border); background:rgba(2,6,23,0.6); border-radius:10px;">
                <div style="display:flex; justify-content:space-between; align-items:center; border-bottom: 1px solid var(--border); padding-bottom:10px;">
                    <strong style="color:var(--primary); font-size:18px;">${escapeHtml(u.icon)} ${escapeHtml(u.name)}</strong>
                    <button class="buy-btn" style="height:35px; font-size:11px; padding:0 15px;" onclick="Admin.update(${Number(u.id)}, '${escapeHtml(u.name)}')">SAVE</button>
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
                        <input type="number" step="0.01" id="adm-dodge-${u.id}" value="${u.dodge ?? 0}">
                    </div>
                    <div class="auth-input-group">
                        <label style="font-size:9px;">Lifesteal %</label>
                        <input type="number" step="0.01" id="adm-lifesteal-${u.id}" value="${u.lifesteal ?? 0}">
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
    const MAP_W = 2400, MAP_H = 560;
    const MAX_PLAYERS = 2;
    const GROUND_Y = 420;
    const LANE_Y = GROUND_Y - 38;
    const BASE_R = 62;
    const GOLD_RATE = 0.15;
    const FIXED_FRAME_MS = 1000 / 60;
    const COLORS = [
        { name: 'Azure', main: '#38bdf8', dark: '#0c4a6e' },
        { name: 'Amber', main: '#fbbf24', dark: '#78350f' },
        { name: 'Emerald', main: '#10b981', dark: '#064e3b' },
        { name: 'Rose', main: '#f43f5e', dark: '#4c0519' }
    ];

    let CLASSES = {};
    let canvas, ctx, running = false, frameCount = 0, paused = false;
    let players = [], units = [], projectiles = [], vfx = [], particles = [], floatingTexts = [], unitsPending = [];
    let aiProcessFlags = [false, false]; 
    let onlineMode = false, onlineMatchId = null, localPlayerIndex = 0, rngState = 1;
    let onlineActions = [], simulationStartedAt = 0;
    const MAX_PARTICLES = 150;
    const MAX_VFX = 50;
    const MAX_TEXTS = 50;
    const MAX_UNITS_PER_PLAYER = 50;
    const MELEE_CROWD_LIMIT = 2;
    const MELEE_RETARGET_DISTANCE = 260;
    const MELEE_BASE_INTERCEPT_DISTANCE = 220;
    const MELEE_BASE_INTERCEPT_BACKTRACK = 45;
    const MELEE_BASE_INTERCEPT_LANE_WIDTH = 90;
    const MIN_CAMERA_ZOOM = 0.55;
    const MAX_CAMERA_ZOOM = 1.8;
    const CAMERA_ZOOM_STEP = 0.1;

    let lastActiveState = null;
    let mousePos = { x: 0, y: 0 };
    let hudResizeListenerAttached = false;
    let cameraWheelListenerAttached = false;
    let cameraZoom = Math.max(MIN_CAMERA_ZOOM, Math.min(MAX_CAMERA_ZOOM, Number(localStorage.getItem('cameraZoom')) || 1));

    const TILE = 20;
    const laneOffsets = [-18, -8, 8, 18, -28, 28];
    const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
    const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
    const laneYFor = (slot = 0) => LANE_Y + laneOffsets[Math.abs(slot) % laneOffsets.length];
    const getBaseForPlayer = (idx) => ({
        x: idx === 0 ? 130 : MAP_W - 130,
        y: LANE_Y,
        r: BASE_R
    });
    const getForwardDir = (owner) => owner === 0 ? 1 : -1;
    const getSpawnPoint = (owner, slot = 0) => {
        const base = players[owner]?.base || getBaseForPlayer(owner);
        return {
            x: base.x + getForwardDir(owner) * (base.r + 14),
            y: laneYFor(slot)
        };
    };
    const getTargetX = (target) => target.base ? target.base.x : target.x;
    const getTargetY = (target) => target.base ? target.base.y : target.y;
    const getTargetRadius = (target) => target.base ? target.base.r : 0;
    const getTargetDistance = (u, target) => dist(u, { x: getTargetX(target), y: getTargetY(target) }) - getTargetRadius(target);
    const getTargetKey = (target) => target.base ? `base-${target.id}` : target.id;
    const setSeed = (seed) => { rngState = (Number(seed) >>> 0) || 1; };
    const rng = () => {
        rngState = (rngState * 1664525 + 1013904223) >>> 0;
        return rngState / 0x100000000;
    };
    const isMeleeUnit = (u) => (u.meta?.range || 0) < 35;
    const targetPressure = (target, owner) => {
        if (target.base) return 0;
        const targetKey = getTargetKey(target);
        return units.filter(ally => (
            ally.owner === owner &&
            ally.hp > 0 &&
            isMeleeUnit(ally) &&
            (ally.currentTargetKey === targetKey ||
                dist(ally, target) <= Math.max(42, (ally.meta?.range || 0) + ally.radius + target.radius + 8))
        )).length;
    };
    const isBehindTarget = (candidate, front, owner) => {
        const dir = getForwardDir(owner);
        return (getTargetX(candidate) - getTargetX(front)) * dir > 18;
    };
    const findMeleeBaseInterceptTarget = (u, baseTarget) => {
        const dir = getForwardDir(u.owner);
        const baseAhead = (baseTarget.base.x - u.x) * dir - baseTarget.base.r;
        const laneY = u.laneY || LANE_Y;
        const intercepts = units
            .filter(e => {
                if (e.owner === u.owner || e.hp <= 0 || e.untargetableTimer > 0) return false;
                const ahead = (e.x - u.x) * dir;
                const betweenUnitAndBase = ahead >= -MELEE_BASE_INTERCEPT_BACKTRACK && ahead <= Math.max(baseAhead, MELEE_BASE_INTERCEPT_DISTANCE);
                const closeEnough = dist(u, e) <= MELEE_BASE_INTERCEPT_DISTANCE;
                const inLane = Math.abs(e.y - u.y) <= MELEE_BASE_INTERCEPT_LANE_WIDTH || Math.abs(e.y - laneY) <= MELEE_BASE_INTERCEPT_LANE_WIDTH;
                return inLane && (betweenUnitAndBase || closeEnough);
            })
            .map(e => ({ target: e, distance: getTargetDistance(u, e), pressure: targetPressure(e, u.owner) }))
            .sort((a, b) => {
                const aOpen = a.pressure < MELEE_CROWD_LIMIT ? 0 : 1;
                const bOpen = b.pressure < MELEE_CROWD_LIMIT ? 0 : 1;
                return aOpen - bOpen || a.distance - b.distance;
            });
        return intercepts[0]?.target || null;
    };
    const getBaseTargetByKey = (targetKey, owner) => {
        const baseMatch = String(targetKey || '').match(/^base-(\d+)$/);
        if (!baseMatch) return null;
        const baseOwner = Number(baseMatch[1]);
        const playerTarget = players.find(p => p.id === baseOwner && p.id !== owner && !p.eliminated && p.hp > 0);
        return playerTarget || null;
    };
    const getLockedCombatTarget = (u) => {
        if (!u.currentTargetKey) return null;
        const unitTarget = units.find(e => (
            e.id === u.currentTargetKey &&
            e.owner !== u.owner &&
            e.hp > 0 &&
            e.untargetableTimer <= 0
        ));
        if (unitTarget) return unitTarget;

        return getBaseTargetByKey(u.currentTargetKey, u.owner);
    };
    const pickCombatTarget = (u) => {
        if (isMeleeUnit(u)) {
            const baseFocusTarget = getBaseTargetByKey(u.baseFocusTargetKey, u.owner);
            if (baseFocusTarget) {
                const interceptTarget = findMeleeBaseInterceptTarget(u, baseFocusTarget);
                if (interceptTarget) return interceptTarget;
                return baseFocusTarget;
            }
            u.baseFocusTargetKey = null;
        }

        const lockedTarget = isMeleeUnit(u) ? getLockedCombatTarget(u) : null;
        if (lockedTarget) {
            if (lockedTarget.base) {
                u.baseFocusTargetKey = getTargetKey(lockedTarget);
                const interceptTarget = findMeleeBaseInterceptTarget(u, lockedTarget);
                if (interceptTarget) return interceptTarget;
            }
            return lockedTarget;
        }

        const candidates = [];
        units.forEach(e => {
            if (e.owner !== u.owner && e.hp > 0 && e.untargetableTimer <= 0) candidates.push({ target: e, distance: getTargetDistance(u, e) });
        });
        players.forEach(p => {
            if (!p.eliminated && p.id !== u.owner) candidates.push({ target: p, distance: getTargetDistance(u, p) });
        });
        if (candidates.length === 0) return null;

        candidates.sort((a, b) => a.distance - b.distance);
        const nearest = candidates[0];
        if (isMeleeUnit(u) && nearest.target.base) {
            u.baseFocusTargetKey = getTargetKey(nearest.target);
            const interceptTarget = findMeleeBaseInterceptTarget(u, nearest.target);
            if (interceptTarget) return interceptTarget;
            return nearest.target;
        }
        if (!isMeleeUnit(u) || nearest.target.base || targetPressure(nearest.target, u.owner) < MELEE_CROWD_LIMIT) {
            return nearest.target;
        }

        const fallback = candidates
            .filter(candidate => (
                !candidate.target.base &&
                isBehindTarget(candidate.target, nearest.target, u.owner) &&
                candidate.distance <= nearest.distance + MELEE_RETARGET_DISTANCE &&
                targetPressure(candidate.target, u.owner) < MELEE_CROWD_LIMIT
            ))
            .sort((a, b) => targetPressure(a.target, u.owner) - targetPressure(b.target, u.owner) || a.distance - b.distance)[0];
        return (fallback || nearest).target;
    };

    function loadSprite(src) {
        const img = new Image();
        img.src = src;
        return img;
    }

    function loadSheet(src, frameW = 128, frameH = 128) {
        const img = loadSprite(src);
        return { img, frameW, frameH };
    }

    const SPRITES = {
        guard: {
            idle: loadSheet('/res/guard/Idle.png'),
            walk: loadSheet('/res/guard/Walk.png'),
            attack_1: loadSheet('/res/guard/Attack 1.png'),
            attack_2: loadSheet('/res/guard/Attack 2.png'),
            defend: loadSheet('/res/guard/Defend.png'),
            protect: loadSheet('/res/guard/Protect.png')
        },
        bowman: {
            idle: loadSheet('/res/bowman/Idle.png'),
            walk: loadSheet('/res/bowman/Walk.png'),
            run: loadSheet('/res/bowman/Run.png'),
            shot: loadSheet('/res/bowman/Shot.png'),
            attack_1: loadSheet('/res/bowman/Attack_1.png'),
            attack_2: loadSheet('/res/bowman/Attack_2.png'),
            attack_3: loadSheet('/res/bowman/Attack_3.png'),
            arrow: loadSprite('/res/bowman/Arrow.png')
        },
        assassin: {
            idle: loadSheet('/res/assasin/Idle.png'),
            run: loadSheet('/res/assasin/Run.png'),
            attack_1: loadSheet('/res/assasin/Attack_1.png'),
            attack_2: loadSheet('/res/assasin/Attack_2.png'),
            attack_3: loadSheet('/res/assasin/Attack_3.png')
        },
        mage: {
            idle: loadSheet('/res/mage/Idle.png'),
            walk: loadSheet('/res/mage/Walk.png'),
            run: loadSheet('/res/mage/Run.png'),
            attack_1: loadSheet('/res/mage/Attack_1.png'),
            attack_2: loadSheet('/res/mage/Attack_2.png'),
            charge: loadSheet('/res/mage/Charge.png', 128, 64)
        },
        gunner: {
            idle: loadSheet('/res/gunner/Idle.png'),
            run: loadSheet('/res/gunner/Run.png'),
            attack: loadSheet('/res/gunner/Attack.png'),
            shot_1: loadSheet('/res/gunner/Shot_1.png'),
            shot_2: loadSheet('/res/gunner/Shot_2.png'),
            grenade: loadSheet('/res/gunner/Grenade.png'),
            explosion: loadSheet('/res/gunner/Explosion.png')
        },
        sniper: {
            idle: loadSheet('/res/sniper/Idle.png'),
            walk: loadSheet('/res/sniper/Walk.png'),
            shot: loadSheet('/res/sniper/Shot.png')
        },
        healer: {
            idle: loadSheet('/res/healer/Idle.png'),
            walk: loadSheet('/res/healer/Walk.png'),
            run: loadSheet('/res/healer/Run.png'),
            attack_1: loadSheet('/res/healer/Attack_1.png'),
            attack_2: loadSheet('/res/healer/Attack_2.png'),
            attack_3: loadSheet('/res/healer/Attack_3.png'),
            fire_1: loadSheet('/res/healer/Fire_1.png', 128, 64),
            fire_2: loadSheet('/res/healer/Fire_2.png', 128, 64)
        },
        iceman: {
            idle: loadSheet('/res/iceman/Idle.png'),
            walk: loadSheet('/res/iceman/Walk.png'),
            run: loadSheet('/res/iceman/Run.png'),
            attack_1: loadSheet('/res/iceman/Attack_1.png'),
            attack_2: loadSheet('/res/iceman/Attack_2.png'),
            charge_1: loadSheet('/res/iceman/Charge_1.png'),
            charge_2: loadSheet('/res/iceman/Charge_2.png'),
            magic_arrow: loadSheet('/res/iceman/Magic_arrow.png', 128, 64),
            magic_sphere: loadSheet('/res/iceman/Magic_sphere.png', 128, 64)
        },
        chilygirl: {
            idle: loadSheet('/res/chilygirl/idle.png'),
            run: loadSheet('/res/chilygirl/Walk.png'),
            attack: loadSheet('/res/chilygirl/attack.png'),
            protect: loadSheet('/res/chilygirl/Protection.png')
        }
    };

    function isSpriteReady(img) {
        return img && img.complete && img.naturalWidth > 0;
    }

    function getSheetFrameCount(sheet) {
        if (!sheet || !isSpriteReady(sheet.img)) return 0;
        return Math.max(1, Math.floor(sheet.img.naturalWidth / sheet.frameW));
    }

    function startUnitAction(u, action) {
        if (u.animAction !== action || frameCount - (u.animStartedAt || 0) > 40) {
            u.animAction = action;
            u.animStartedAt = frameCount;
        }
    }

    function facingFromVector(dx, dy, fallback = 'right') {
        if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return fallback;
        if (Math.abs(dx) > Math.abs(dy)) return dx < 0 ? 'left' : 'right';
        return dy < 0 ? 'up' : 'down';
    }

    function hexToRgb(hex) {
        const value = hex.replace('#', '');
        return {
            r: parseInt(value.substring(0, 2), 16),
            g: parseInt(value.substring(2, 4), 16),
            b: parseInt(value.substring(4, 6), 16)
        };
    }

    function alpha(hex, amount) {
        const rgb = hexToRgb(hex);
        return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${amount})`;
    }

    function drawRoundedRect(x, y, w, h, r) {
        const radius = Math.min(r, w / 2, h / 2);
        ctx.beginPath();
        ctx.moveTo(x + radius, y);
        ctx.lineTo(x + w - radius, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
        ctx.lineTo(x + w, y + h - radius);
        ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
        ctx.lineTo(x + radius, y + h);
        ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
        ctx.lineTo(x, y + radius);
        ctx.quadraticCurveTo(x, y, x + radius, y);
    }

    function drawHexagon(x, y, radius) {
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = Math.PI / 6 + (Math.PI * 2 * i) / 6;
            const px = x + Math.cos(a) * radius;
            const py = y + Math.sin(a) * radius;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
    }

    function drawBar(x, y, w, h, pct, color, bg = 'rgba(2,6,23,0.72)') {
        ctx.fillStyle = bg;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        ctx.strokeStyle = '#1f2937';
        ctx.lineWidth = 1;
        ctx.strokeRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x + 1), Math.round(y + 1), Math.round(Math.max(0, (w - 2) * clamp(pct, 0, 1))), Math.round(h - 2));
    }

    function px(x, y, w, h, color) {
        ctx.fillStyle = color;
        ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
    }

    function pixelDiamond(x, y, size, color, outline = '#2f2417') {
        px(x, y - size, size, size, color);
        px(x - size, y, size * 3, size, color);
        px(x, y + size, size, size, color);
        ctx.strokeStyle = outline;
        ctx.lineWidth = 2;
        ctx.strokeRect(Math.round(x - size), Math.round(y), Math.round(size * 3), Math.round(size));
    }

    function drawPixelSprite(rows, palette, scale = 2) {
        const h = rows.length;
        const w = rows[0].length;
        const ox = -Math.floor((w * scale) / 2);
        const oy = -Math.floor((h * scale) / 2);
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const color = palette[rows[y][x]];
                if (color) px(ox + x * scale, oy + y * scale, scale, scale, color);
            }
        }
    }

    function addParticle(x, y, color, count = 8, power = 2) {
        for (let i = 0; i < count && particles.length < MAX_PARTICLES; i++) {
            const angle = rng() * Math.PI * 2;
            const speed = rng() * power + 0.4;
            particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 24 + rng() * 24,
                maxLife: 48,
                size: 1.5 + rng() * 3,
                color
            });
        }
    }

    function getReduction(val) {
        if (val <= 0) return 0;
        if (val <= 50) return val * 0.01;
        let extra = val - 50;
        let reduction = 0.5 + 0.5 * (1 - Math.pow(0.5, extra / 50));
        return Math.min(0.99, reduction);
    }

    function calculateDamage(attacker, target, baseDmg, type) {
        if (target.buffs?.some(b => b.type === 'invulnerable')) return { amount: 0, isCrit: false, dodged: false };
        const damageTakenMult = target.buffs?.reduce((mult, b) => b.type === 'damage_taken_mult' ? mult * b.value : mult, 1) ?? 1;
        if (type === 'true') return { amount: baseDmg * damageTakenMult, isCrit: false, dodged: false };
        const targetDodge = target.meta ? (target.meta.dodge + (target.buffs?.find(b => b.type === 'dodge')?.value || 0)) : 0;
        if (rng() < targetDodge) return { amount: 0, isCrit: false, dodged: true };

        let finalDmg = baseDmg;
        const attackerCrit = attacker.meta ? (attacker.meta.crit_chance + (attacker.buffs?.find(b => b.type === 'crit_chance')?.value || 0)) : 0;
        const isCrit = rng() < attackerCrit;
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
        const bonusTrueDamage = attacker.buffs?.find(b => b.type === 'bonus_true_damage')?.value || 0;
        return { amount: (finalDmg + bonusTrueDamage) * damageTakenMult, isCrit, dodged: false };
    }

    function freezeUnit(target, duration = 180) {
        const existing = target.buffs?.find(b => b.type === 'frozen');
        if (existing) existing.duration = Math.max(existing.duration, duration);
        else target.buffs.push({ type: 'frozen', duration });
    }

    function isFrozen(u) {
        return u.buffs?.some(b => b.type === 'frozen');
    }

    function castIcemanSkill(u) {
        const targets = units
            .filter(en => en.owner !== u.owner && en.untargetableTimer <= 0)
            .map(en => ({ unit: en, distance: dist(u, en) }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 3)
            .map(entry => entry.unit);

        if (targets.length === 0) return false;
        u.mana -= 60;
        startUnitAction(u, 'charge_2');
        targets.forEach(en => {
            freezeUnit(en);
            const dmgRes = calculateDamage(u, en, 20, 'true');
            en.hp -= dmgRes.amount;
            en.lastAttacker = u.owner;
            spawnImpact(en.x, en.y, '#67e8f9', 28);
            addParticle(en.x, en.y, '#bae6fd', 14, 2.4);
            spawnVFX(en.x, en.y, `ICE ${Math.floor(dmgRes.amount)}`, '#7dd3fc');
        });
        spawnImpact(u.x, u.y, '#38bdf8', 36);
        spawnVFX(u.x, u.y - 20, 'FROST!', '#7dd3fc');
        return true;
    }

    function triggerIcemanPassive(u) {
        u.icemanPassiveTriggered = true;
        units.forEach(other => {
            if (other.id !== u.id && dist(u, other) <= 48) {
                freezeUnit(other, 150);
                spawnImpact(other.x, other.y, '#bae6fd', 24);
                spawnVFX(other.x, other.y, 'FROZEN', '#bae6fd');
            }
        });
        spawnImpact(u.x, u.y, '#e0f2fe', 50);
        spawnVFX(u.x, u.y - 24, 'ICE ARMOR!', '#e0f2fe');
    }

    function castChilyGirlSkill(u) {
        u.mana -= 70;
        u.buffs = u.buffs.filter(b => !['invulnerable', 'atk_speed_mult', 'bonus_true_damage'].includes(b.type));
        u.buffs.push(
            { type: 'invulnerable', duration: 180 },
            { type: 'atk_speed_mult', value: 2, duration: 180 },
            { type: 'bonus_true_damage', value: 5, duration: 180 }
        );
        startUnitAction(u, 'protect');
        spawnImpact(u.x, u.y, '#ef4444', 34);
        spawnVFX(u.x, u.y - 22, 'IMMORTAL!', '#fca5a5');
        return true;
    }

    function triggerChilyGirlProtection(u) {
        u.chilyProtectionTriggered = true;
        u.buffs.push(
            { type: 'damage_taken_mult', value: 0.2, duration: 180 },
            { type: 'chily_protection', duration: 180 }
        );
        startUnitAction(u, 'protect');
        spawnImpact(u.x, u.y, '#fb7185', 38);
        spawnVFX(u.x, u.y - 24, 'PROTECTION!', '#fda4af');
    }

    function addGold(playerIndex, amount) {
        const player = players[playerIndex];
        if (!player || !Number.isFinite(amount) || amount <= 0) return;
        player.gold += amount;
        const goldEl = document.getElementById(`gold-${playerIndex}`);
        if (goldEl) goldEl.innerText = `$ ${Math.floor(player.gold)}`;
    }

    function triggerChilyGirlPunch(u) {
        if (u.hp <= 0) return;
        const dir = getForwardDir(u.owner);
        const punchRange = 115;
        const punchHalfHeight = 42;
        const punchDamage = u.meta.dmg * 10;
        startUnitAction(u, 'attack');
        units.forEach(en => {
            if (en.owner === u.owner || en.untargetableTimer > 0) return;
            const ahead = (en.x - u.x) * dir;
            if (ahead < 0 || ahead > punchRange || Math.abs(en.y - u.y) > punchHalfHeight) return;
            const res = calculateDamage(u, en, punchDamage, u.meta.dmg_type);
            if (res.dodged) spawnVFX(en.x, en.y, 'MISS', '#94a3b8');
            else {
                en.hp -= res.amount;
                en.lastAttacker = u.owner;
                spawnImpact(en.x, en.y, '#ef4444', 34);
                addParticle(en.x, en.y, '#ef4444', 18, 3.6);
                spawnVFX(en.x, en.y, Math.floor(res.amount), '#fff');
            }
        });
        players.forEach(p => {
            if (p.eliminated || p.id === u.owner) return;
            const ahead = (p.base.x - u.x) * dir - p.base.r;
            if (ahead < 0 || ahead > punchRange || Math.abs(p.base.y - u.y) > punchHalfHeight + p.base.r) return;
            const res = calculateDamage(u, p, punchDamage, u.meta.dmg_type);
            p.hp -= res.amount;
            spawnImpact(p.base.x, p.base.y, '#ef4444', 38);
            spawnVFX(p.base.x, p.base.y, Math.floor(res.amount), '#fff');
        });
        spawnVFX(u.x + dir * 42, u.y - 16, 'PUNCH!', '#ef4444');
    }

    function getEffectiveMaxHp(u) {
        let maxHp = u.maxHp;
        u.buffs?.forEach(b => {
            if (b.type === 'max_hp_mult') maxHp *= b.value;
        });
        return maxHp;
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
                if (affordable.length > 0 && rng() > 0.5) spawnUnit(pIdx, affordable[Math.floor(rng() * affordable.length)]);
            } else {
                const res = await fetch('/api/ai/strategy', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${Auth.getToken()}`
                    },
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
        if (!res.ok) throw new Error('Unable to load units');
        const data = await res.json();
        CLASSES = {};
        data.forEach(u => {
            CLASSES[u.name] = {
                ...u,
                crit_chance: Number(u.crit_chance || 0),
                armor: Number(u.armor || 0),
                mres: Number(u.mres || 0),
                phys_pen: Number(u.phys_pen || 0),
                magic_pen: Number(u.magic_pen || 0),
                dodge: Number(u.dodge || 0),
                lifesteal: Number(u.lifesteal || 0),
                meta: u,
                skill: u.special?.split(':')[0]?.toLowerCase() || 'none',
                skillCost: u.name === 'Iceman' ? 60 : 30,
                skillRange: u.range * 2
            };
        });
        
        // Populate System Intel Panel
        const intelList = document.getElementById('unit-intel-list');
        if (intelList) {
            intelList.innerHTML = data.map(u => `
                <div class="intel-entry">
                    <div class="intel-row">
                        <strong style="color:var(--primary)">${escapeHtml(u.icon)} ${escapeHtml(u.name)}</strong>
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
            if (data.hasActive) {
                lastActiveState = data.state;
                document.getElementById('resume-overlay').style.display = 'flex';
            } else {
                updateSetupUI();
                document.getElementById('setup-overlay').style.display = 'flex';
            }
        } catch (e) {
            updateSetupUI();
            document.getElementById('setup-overlay').style.display = 'flex';
        }
    }

    async function saveSession() {
        if (!running || onlineMode) return;
        const state = {
            players: players.map(p => ({ gold: p.gold, hp: p.hp, maxHp: p.maxHp, eliminated: p.eliminated, name: p.name, config: p.config, base: p.base })),
            units: units.map(u => ({ type: u.type, owner: u.owner, x: u.x, y: u.y, hp: u.hp, mana: u.mana, icemanPassiveTriggered: !!u.icemanPassiveTriggered, chilyProtectionTriggered: !!u.chilyProtectionTriggered })),
            frameCount
        };
        await fetch('/api/session/save', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Auth.getToken()}` }, body: JSON.stringify({ state }) });
    }

    function togglePause() {
        if (onlineMode) {
            log('Pause is disabled during online matches.', '#fbbf24');
            return;
        }
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
        if (type === 'Gunman' && rng() < 0.3) { targetType = 'Sniper'; log(`${p.name}'s Gunman evolved into SNIPER!`, '#fbbf24'); }
        if (!CLASSES[targetType]) return;
        const meta = CLASSES[targetType];
        if (p.gold < meta.cost && type === targetType) return; 
        const playerUnitCount = units.filter(u => u.owner === pIdx).length + unitsPending.filter(u => u.owner === pIdx).length;
        if (playerUnitCount >= MAX_UNITS_PER_PLAYER) return;
        if (type === targetType) {
            p.gold -= meta.cost;
            log(`${p.name} deployed ${meta.icon} ${targetType}`, p.color.main);
        }
        const spawn = getSpawnPoint(pIdx, playerUnitCount);
        const u = {
            id: `u${pIdx}_${frameCount}_${units.length}_${unitsPending.length}`, owner: pIdx, type: targetType, meta: { ...meta }, hp: meta.hp, maxHp: meta.hp, mana: meta.mana * 0.5, maxMana: meta.mana,
            x: spawn.x, y: spawn.y, laneY: spawn.y, cooldown: 0, state: 'march', radius: 12, buffs: [], isPet: false, untargetableTimer: 0, lastAttacker: null, facing: pIdx === 0 ? 'right' : 'left', blockTimer: 0
        };
        unitsPending.push(u);
        updateUnitButtons();
    }

    function buyUnit(type, pIdx = localPlayerIndex) {
        if (onlineMode) {
            if (pIdx !== localPlayerIndex) return;
            Online.sendBuy(type).catch(() => log('Unable to send online command.', '#f43f5e'));
            return;
        }
        spawnUnit(pIdx, type);
    }

    function applyOnlineAction(payload) {
        if (!onlineMode || payload?.action !== 'buy') return;
        onlineActions.push({
            action: payload.action,
            playerIndex: Number(payload.playerIndex),
            unitType: payload.unitType,
            actionFrame: Number(payload.actionFrame || frameCount + 1)
        });
        onlineActions.sort((a, b) => a.actionFrame - b.actionFrame || a.playerIndex - b.playerIndex || String(a.unitType).localeCompare(String(b.unitType)));
    }

    function processOnlineActions() {
        while (onlineActions.length > 0 && onlineActions[0].actionFrame <= frameCount) {
            const next = onlineActions.shift();
            if (next.action === 'buy') spawnUnit(next.playerIndex, next.unitType);
        }
    }

    async function recordResult(result) {
        try {
            await fetch('/api/game/end', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${Auth.getToken()}` },
                body: JSON.stringify({ winnerId: result === 'win' ? Auth.getUser().id : null, duration: frameCount, result })
            });
        } catch (e) { console.error("Error recording result:", e); }
    }

    async function clearSession() {
        await fetch('/api/session/clear', { method: 'POST', headers: { 'Authorization': `Bearer ${Auth.getToken()}` } });
    }

    function update() {
        if (paused) return;
        frameCount++;
        if (onlineMode) processOnlineActions();
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
        updateUnitButtons();

        for (let i = projectiles.length - 1; i >= 0; i--) {
            const pr = projectiles[i];
            const d = dist(pr, { x: pr.tx, y: pr.ty });
            if (d < 10) {
                if (pr.heal) {
                    const target = units.find(eu => eu.id === pr.targetId && eu.owner === pr.owner);
                    if (target) {
                        const amount = Math.max(35, pr.dmg * 8);
                        target.hp = Math.min(getEffectiveMaxHp(target), target.hp + amount);
                        spawnImpact(target.x, target.y, '#22c55e', 24);
                        addParticle(target.x, target.y, '#86efac', 12, 2);
                        spawnVFX(target.x, target.y, `+${Math.floor(amount)}`, '#22c55e');
                    }
                    projectiles.splice(i, 1);
                    continue;
                }
                if (pr.explosionRadius) {
                    spawnExplosion(pr.tx, pr.ty, pr.owner, pr.explosionRadius);
                    spawnImpact(pr.tx, pr.ty, '#f97316', pr.explosionRadius + 12);
                    addParticle(pr.tx, pr.ty, '#f97316', 18, 3.2);
                    units.forEach(eu => {
                        if (eu.owner !== pr.owner && eu.untargetableTimer <= 0 && dist({ x: pr.tx, y: pr.ty }, eu) <= pr.explosionRadius) {
                            const dmgRes = calculateDamage({ meta: pr.attackerMeta || { crit_chance: 0, phys_pen: 0, magic_pen: 0 }, buffs: pr.attackerBuffs || [] }, eu, pr.dmg, pr.dmgType || 'physical');
                            if (dmgRes.dodged) spawnVFX(eu.x, eu.y, 'MISS', '#94a3b8');
                            else {
                                eu.hp -= dmgRes.amount;
                                eu.lastAttacker = pr.owner;
                                spawnVFX(eu.x, eu.y, Math.floor(dmgRes.amount), '#fff');
                            }
                        }
                    });
                    players.forEach(p => {
                        if (!p.eliminated && p.id !== pr.owner && dist({ x: pr.tx, y: pr.ty }, p.base) <= p.base.r + pr.explosionRadius) {
                            const dmgRes = calculateDamage({ meta: pr.attackerMeta || { crit_chance: 0, phys_pen: 0, magic_pen: 0 }, buffs: pr.attackerBuffs || [] }, p, pr.dmg, pr.dmgType || 'physical');
                            p.hp -= dmgRes.amount;
                            spawnVFX(pr.tx, pr.ty - 18, Math.floor(dmgRes.amount), '#fff');
                        }
                    });
                    projectiles.splice(i, 1);
                    continue;
                }
                units.forEach(eu => { 
                    if (eu.owner !== pr.owner && eu.untargetableTimer <= 0 && dist(pr, eu) < 25) { 
                        const dmgRes = calculateDamage({ meta: pr.attackerMeta || { crit_chance: 0, phys_pen: 0, magic_pen: 0 }, buffs: pr.attackerBuffs || [] }, eu, pr.dmg, pr.dmgType);
                        if (dmgRes.dodged) spawnVFX(eu.x, eu.y, 'MISS', '#94a3b8');
                        else { 
                            eu.hp -= dmgRes.amount; eu.lastAttacker = pr.owner; 
                            if (eu.type === 'Guard') {
                                eu.blockTimer = 30;
                                eu.facing = facingFromVector(pr.x - eu.x, pr.y - eu.y);
                            }
                            spawnImpact(eu.x, eu.y, dmgRes.isCrit ? '#ef4444' : pr.color, dmgRes.isCrit ? 30 : 20);
                            addParticle(eu.x, eu.y, dmgRes.isCrit ? '#ef4444' : pr.color, dmgRes.isCrit ? 16 : 8, dmgRes.isCrit ? 3.5 : 2);
                            spawnVFX(eu.x, eu.y, (dmgRes.isCrit ? '💥' : '') + Math.floor(dmgRes.amount), dmgRes.isCrit ? '#ff0000' : '#fff'); 
                            const ls = (pr.attackerMeta?.lifesteal || 0) + (pr.attackerBuffs?.find(b => b.type === 'lifesteal')?.value || 0);
                            if (ls > 0 && dmgRes.amount > 0) {
                                const firer = units.find(un => un.id === pr.attackerId);
                                if (firer) { const h = dmgRes.amount * ls; firer.hp = Math.min(getEffectiveMaxHp(firer), firer.hp + h); spawnVFX(firer.x, firer.y, `+${Math.floor(h)}`, '#22c55e'); }
                            }
                        }
                    } 
                });
                players.forEach(p => {
                    if (!p.eliminated && p.id !== pr.owner && dist(pr, p.base) <= p.base.r + 15) {
                        const dmgRes = calculateDamage({ meta: pr.attackerMeta || { crit_chance: 0, phys_pen: 0, magic_pen: 0 }, buffs: pr.attackerBuffs || [] }, p, pr.dmg, pr.dmgType);
                        p.hp -= dmgRes.amount;
                        spawnImpact(pr.tx, pr.ty, dmgRes.isCrit ? '#ef4444' : pr.color, dmgRes.isCrit ? 34 : 24);
                        addParticle(pr.tx, pr.ty, dmgRes.isCrit ? '#ef4444' : pr.color, 14, 3);
                        spawnVFX(pr.tx, pr.ty, (dmgRes.isCrit ? '💥' : '') + Math.floor(dmgRes.amount), dmgRes.isCrit ? '#ff0000' : '#fff');
                    }
                });
                projectiles.splice(i, 1);
            } else { const angle = Math.atan2(pr.ty - pr.y, pr.tx - pr.x); pr.x += Math.cos(angle) * pr.speed; pr.y += Math.sin(angle) * pr.speed; }
        }

        units.forEach(u => {
            if (u.cooldown > 0) u.cooldown--;
            if (u.blockTimer > 0) u.blockTimer--;
            u.healerRunning = false;
            const canRegen = !u.buffs.some(b => b.type === 'no_mana_regen');
            const effectiveMaxHp = getEffectiveMaxHp(u);
            u.hp = Math.min(u.hp, effectiveMaxHp);
            if (frameCount % 60 === 0) { u.hp = Math.min(effectiveMaxHp, u.hp + 1); if (canRegen) u.mana = Math.min(u.maxMana, u.mana + 5); }
            u.buffs = u.buffs.filter(b => {
                b.duration--;
                if (b.type === 'statue') { u.x = b.origX; u.y = b.origY; }
                if (b.type === 'chily_protection' && b.duration <= 0) triggerChilyGirlPunch(u);
                return b.duration > 0;
            });
            if (u.type === 'Iceman' && !u.icemanPassiveTriggered && u.hp > 0 && u.hp / effectiveMaxHp <= 0.5) {
                triggerIcemanPassive(u);
            }
            if (u.type === 'ChilyGirl' && !u.chilyProtectionTriggered && u.hp / effectiveMaxHp <= 0.5) {
                if (u.hp <= 0) u.hp = 1;
                triggerChilyGirlProtection(u);
            }
            if (isFrozen(u)) {
                u.state = 'frozen';
                u.currentTargetKey = null;
                return;
            }
            if (u.type === 'Iceman' && u.mana >= 60 && !u.isPet) {
                castIcemanSkill(u);
            } else if (u.type === 'ChilyGirl' && u.mana >= 70 && !u.isPet) {
                castChilyGirlSkill(u);
            } else if (u.mana >= 30 && !u.isPet) {
                if (u.type === 'Assassin') { let farthest = null, maxD = 0; const avoidGuard = u.hp / getEffectiveMaxHp(u) > 0.5; units.forEach(en => { if(en.owner !== u.owner && en.untargetableTimer <= 0 && dist(u, en) < 300 && !(avoidGuard && en.type === 'Guard')) { if(dist(u, en) > maxD) { maxD = dist(u, en); farthest = en; } } }); if (farthest) { const fromX = u.x, fromY = u.y; const dashFacing = facingFromVector(farthest.x - fromX, farthest.y - fromY, u.facing); const side = dashFacing === 'left' ? 1 : -1; u.mana = 0; u.x = farthest.x + side * (u.radius + farthest.radius + 2); u.y = farthest.y; u.currentTargetKey = getTargetKey(farthest); u.nextAttack3 = true; u.state = 'fight'; u.facing = dashFacing; u.buffs.push({ type: 'crit_chance', value: 0.5, duration: 180 }, { type: 'dodge', value: 0.5, duration: 180 }, { type: 'lifesteal', value: 0.5, duration: 180 }); spawnVFX(u.x, u.y, 'DASH!', '#f43f5e'); } }
                else if (u.type.toLowerCase().includes('gunman') || u.type.toLowerCase().includes('gunner')) { let bombTarget = null, minBombDist = Infinity; const skillRange = u.meta.range * 2; units.forEach(en => { if (en.owner !== u.owner && en.untargetableTimer <= 0) { const d = dist(u, en); if (d <= skillRange && d < minBombDist) { minBombDist = d; bombTarget = en; } } }); players.forEach(p => { if (!p.eliminated && p.id !== u.owner) { const d = dist(u, p.base) - p.base.r; if (d <= skillRange && d < minBombDist) { minBombDist = d; bombTarget = p; } } }); if (bombTarget) { const tx = bombTarget.base ? bombTarget.base.x : bombTarget.x, ty = bombTarget.base ? bombTarget.base.y : bombTarget.y; u.mana = 0; startUnitAction(u, 'attack'); u.facing = facingFromVector(tx - u.x, ty - u.y, u.facing); projectiles.push({ x: u.x, y: u.y - 18, tx, ty, owner: u.owner, dmg: u.meta.dmg, speed: 6, color: players[u.owner].color.main, dmgType: 'physical', attackerMeta: u.meta, attackerBuffs: [...u.buffs], attackerId: u.id, sprite: 'grenade', explosionRadius: 20 }); spawnVFX(u.x, u.y - 22, 'BOMB!', '#f97316'); } }
                else if (u.state === 'fight' && u.type === 'Guard') { u.mana = 0; startUnitAction(u, 'protect'); u.buffs.push({ type: 'statue', duration: 480, origX: u.x, origY: u.y }, { type: 'max_hp_mult', value: 1.5, duration: 480 }, { type: 'armor', value: 50, duration: 480 }, { type: 'mres', value: 50, duration: 480 }, { type: 'no_mana_regen', duration: 480 }); u.hp = Math.min(getEffectiveMaxHp(u), u.hp + u.maxHp * 0.5); spawnVFX(u.x, u.y, 'PROTECT!', '#94a3b8'); }
                else if (u.state === 'fight' && u.type === 'Mage') { let targets = units.filter(en => en.owner !== u.owner && dist(u, en) < 35); if (targets.length > 0) { u.mana = 0; targets.forEach(en => { const dmgRes = calculateDamage(u, en, 60, 'true'); en.hp -= dmgRes.amount; en.lastAttacker = u.owner; if (en.hp <= 0) u.mana = Math.min(u.maxMana, u.mana + 5); spawnVFX(en.x, en.y, Math.floor(dmgRes.amount), '#f97316'); }); spawnVFX(u.x, u.y, 'FIRE!', '#f97316'); } }
            }
            if (u.type === 'Healer') {
                let healTarget = null, healDist = Infinity;
                units.forEach(ally => {
                    if (ally.id !== u.id && ally.owner === u.owner && ally.hp / getEffectiveMaxHp(ally) < 0.5) {
                        const d = dist(u, ally);
                        if (d < healDist) { healDist = d; healTarget = ally; }
                    }
                });
                if (healTarget) {
                    const inHealRange = healDist <= u.meta.range;
                    if (inHealRange && u.mana >= 30 && u.cooldown <= 0) {
                        u.mana = 0;
                        u.cooldown = Math.floor(60 / Math.max(0.1, u.meta.atk_speed));
                        startUnitAction(u, 'attack_3');
                        u.facing = facingFromVector(healTarget.x - u.x, healTarget.y - u.y, u.facing);
                        projectiles.push({ x: u.x, y: u.y - 12, tx: healTarget.x, ty: healTarget.y - 10, owner: u.owner, targetId: healTarget.id, dmg: u.meta.dmg, speed: 7, color: '#22c55e', heal: true, sprite: 'healer_fire_2' });
                    } else if (!inHealRange) {
                        const dir = Math.sign(healTarget.x - u.x) || getForwardDir(u.owner);
                        u.x += dir * u.meta.move_speed * 2;
                        u.y += ((healTarget.laneY || healTarget.y || LANE_Y) - u.y) * 0.08;
                        u.facing = dir > 0 ? 'right' : 'left';
                        u.state = 'march';
                        u.healerRunning = true;
                        return;
                    }
                }
            }
            let target = pickCombatTarget(u);
            if (target) {
                u.currentTargetKey = getTargetKey(target);
                const tx = getTargetX(target), ty = getTargetY(target), tr = getTargetRadius(target);
                const d = dist(u, { x: tx, y: ty }) - tr;
                if (d <= u.meta.range) {
                    if (u.cooldown <= 0) {
                        let fAtkSpd = u.meta.atk_speed; u.buffs.forEach(b => { if(b.type === 'atk_speed_mult') fAtkSpd *= b.value; });
                        u.cooldown = Math.floor(60 / fAtkSpd);
                        const isBowman = u.type.toLowerCase().includes('bowman');
                        const isAssassin = u.type.toLowerCase().includes('assassin');
                        const isGuard = u.type.toLowerCase().includes('guard');
                        const isMage = u.type.toLowerCase().includes('mage');
                        const isGunman = u.type.toLowerCase().includes('gunman') || u.type.toLowerCase().includes('gunner');
                        const isSniper = u.type.toLowerCase().includes('sniper');
                        const isHealer = u.type.toLowerCase().includes('healer');
                        const isIceman = u.type.toLowerCase().includes('iceman');
                        const isChilyGirl = u.type.toLowerCase().includes('chilygirl');
                        const isMeleeStrike = u.meta.range < 35 || (isBowman && d <= 35);
                        if (isMeleeStrike) {
                            if (isBowman) {
                                const attackIdx = ((u.attackVariant || 0) % 3) + 1;
                                u.attackVariant = attackIdx;
                                startUnitAction(u, `attack_${attackIdx}`);
                            } else if (isAssassin) {
                                const attackIdx = u.nextAttack3 ? 3 : ((u.attackVariant || 0) % 2) + 1;
                                u.nextAttack3 = false;
                                if (attackIdx < 3) u.attackVariant = attackIdx;
                                startUnitAction(u, `attack_${attackIdx}`);
                            } else if (isGuard) {
                                const attackIdx = ((u.attackVariant || 0) % 2) + 1;
                                u.attackVariant = attackIdx;
                                startUnitAction(u, `attack_${attackIdx}`);
                            } else if (isChilyGirl) {
                                startUnitAction(u, 'attack');
                            }
                            const ls = u.meta.lifesteal + (u.buffs.find(b => b.type === 'lifesteal')?.value || 0);
                            const res = calculateDamage(u, target, u.meta.dmg, u.meta.dmg_type);
                            if (!res.dodged && !target.base) target.lastAttacker = u.owner;
                            if (res.dodged) spawnVFX(tx, ty, 'MISS', '#94a3b8');
                            else { target.hp -= res.amount; addParticle(tx, ty, res.isCrit ? '#ef4444' : players[u.owner].color.main, res.isCrit ? 14 : 7, res.isCrit ? 3 : 1.8); if (ls > 0) { const h = res.amount * ls; u.hp = Math.min(getEffectiveMaxHp(u), u.hp + h); spawnVFX(u.x, u.y, `+${Math.floor(h)}`, '#22c55e'); } spawnVFX(tx, ty, (res.isCrit?'💥':'')+Math.floor(res.amount), res.isCrit?'#ff0000':'#fff'); }
                        } else {
                            if (isBowman) startUnitAction(u, 'shot');
                            if (isMage) {
                                const attackIdx = ((u.attackVariant || 0) % 2) + 1;
                                u.attackVariant = attackIdx;
                                startUnitAction(u, `attack_${attackIdx}`);
                            }
                            if (isGunman) {
                                const shotIdx = ((u.attackVariant || 0) % 2) + 1;
                                u.attackVariant = shotIdx;
                                startUnitAction(u, `shot_${shotIdx}`);
                            }
                            if (isSniper) startUnitAction(u, 'shot');
                            if (isHealer) {
                                const attackIdx = ((u.attackVariant || 0) % 2) + 1;
                                u.attackVariant = attackIdx;
                                startUnitAction(u, `attack_${attackIdx}`);
                            }
                            if (isIceman) {
                                const attackIdx = ((u.attackVariant || 0) % 2) + 1;
                                u.attackVariant = attackIdx;
                                startUnitAction(u, `attack_${attackIdx}`);
                            }
                            if (isChilyGirl) startUnitAction(u, 'attack');
                            projectiles.push({ x: u.x, y: u.y, tx, ty, owner: u.owner, dmg: u.meta.dmg, speed: 8, color: players[u.owner].color.main, dmgType: u.meta.dmg_type, attackerMeta: u.meta, attackerBuffs: [...u.buffs], attackerId: u.id, sprite: isBowman ? 'arrow' : isMage ? 'mage_charge' : isHealer ? 'healer_fire_1' : isIceman ? 'iceman_magic_arrow' : isChilyGirl ? 'chily' : null });
                        }
                    }
                    u.state = 'fight';
                    u.facing = facingFromVector(tx - u.x, ty - u.y, u.facing);
                } else {
                    const dir = Math.sign(tx - u.x) || getForwardDir(u.owner);
                    u.x += dir * u.meta.move_speed;
                    const followY = isMeleeUnit(u) && !target.base ? ty : (u.laneY || LANE_Y);
                    u.y += (followY - u.y) * (isMeleeUnit(u) ? 0.16 : 0.08);
                    u.facing = dir > 0 ? 'right' : 'left';
                    u.state = 'march';
                }
            } else {
                u.currentTargetKey = null;
            }
        });

        for (let i = units.length - 1; i >= 0; i--) {
            if (units[i].hp <= 0) {
                const u = units[i];
                if (u.lastAttacker !== null) addGold(u.lastAttacker, u.meta.cost * 0.3);
                units.splice(i, 1);
            }
        }
        if (unitsPending.length > 0) { units.push(...unitsPending); unitsPending = []; }
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.vx *= 0.94;
            p.vy *= 0.94;
            p.life--;
            if (p.life <= 0) particles.splice(i, 1);
        }
        for (let i = vfx.length - 1; i >= 0; i--) {
            const fx = vfx[i];
            fx.life--;
            fx.radius += fx.growth;
            if (fx.life <= 0) vfx.splice(i, 1);
        }

        const activePlayers = players.filter(p => !p.eliminated);
        if (players[localPlayerIndex]?.eliminated || activePlayers.length <= 1) {
            running = false;
            document.getElementById('victory-overlay').style.display = 'flex';
            const vText = document.getElementById('victory-text');
            const result = (activePlayers.length === 1 && activePlayers[0].id === localPlayerIndex) ? 'win' : 'loss';
            
            if (result === 'win') {
                vText.innerText = 'VICTORY';
                vText.style.color = 'var(--success)';
            } else {
                vText.innerText = 'DEFEAT';
                vText.style.color = 'var(--danger)';
            }
            
            if (onlineMode) Online.leave();
            clearSession();
            recordResult(result);
        }
    }

    function drawMapBackground() {
        ctx.imageSmoothingEnabled = false;
        const sky = ctx.createLinearGradient(0, 0, 0, GROUND_Y);
        sky.addColorStop(0, '#18253a');
        sky.addColorStop(0.58, '#38546a');
        sky.addColorStop(1, '#76906e');
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, MAP_W, MAP_H);

        ctx.save();
        const sunX = MAP_W * 0.53;
        px(sunX - 34, 56, 68, 68, 'rgba(255, 218, 132, 0.22)');
        px(sunX - 22, 68, 44, 44, 'rgba(255, 238, 184, 0.35)');
        for (let i = 0; i < 16; i++) {
            const x = (i * 173) % MAP_W;
            const y = 58 + (i * 47) % 120;
            px(x, y, 52, 10, 'rgba(226, 232, 240, 0.16)');
            px(x + 18, y - 8, 74, 12, 'rgba(226, 232, 240, 0.1)');
        }
        for (let i = 0; i < 5; i++) {
            const ridgeY = 248 + i * 20;
            ctx.fillStyle = i % 2 ? '#263f3c' : '#315247';
            ctx.beginPath();
            ctx.moveTo(0, GROUND_Y);
            for (let x = -80; x <= MAP_W + 80; x += 160) {
                ctx.lineTo(x, ridgeY + Math.sin((x + i * 90) / 120) * 28);
            }
            ctx.lineTo(MAP_W, GROUND_Y);
            ctx.closePath();
            ctx.globalAlpha = 0.55 - i * 0.06;
            ctx.fill();
        }
        ctx.globalAlpha = 1;

        px(0, GROUND_Y - 42, MAP_W, 42, '#4f6f3d');
        px(0, GROUND_Y - 10, MAP_W, 10, '#7a5a34');
        px(0, GROUND_Y, MAP_W, MAP_H - GROUND_Y, '#5f3f25');
        px(0, GROUND_Y + 22, MAP_W, 18, '#4f3420');
        px(0, LANE_Y - 30, MAP_W, 8, '#2f5131');
        px(0, LANE_Y - 22, MAP_W, 8, '#6f6b58');
        px(0, LANE_Y - 14, MAP_W, 72, '#a7743d');
        px(0, LANE_Y + 58, MAP_W, 8, '#6f6b58');
        px(0, LANE_Y + 66, MAP_W, 8, '#2f5131');
        px(0, LANE_Y + 10, MAP_W, 11, 'rgba(65, 40, 22, 0.34)');
        px(0, LANE_Y + 34, MAP_W, 8, 'rgba(65, 40, 22, 0.24)');
        for (let x = 0; x < MAP_W; x += TILE) {
            const n = (x * 37) % 97;
            px(x, LANE_Y - 14, TILE, 7, n < 42 ? '#bd8647' : '#c8914f');
            px(x + 4, LANE_Y + 2 + (n % 5), 10, 3, '#83562e');
            px(x + 2, LANE_Y + 49, 12, 4, n > 55 ? '#7b5130' : '#b57c43');
            if (n % 7 === 0) px(x + 6, LANE_Y + 24, 18, 3, '#7a4f2d');
            if (n % 13 === 0) px(x + 9, LANE_Y - 21, 8, 8, '#8a846c');
            if (n % 17 === 0) px(x + 3, LANE_Y + 60, 10, 6, '#8a846c');
            px(x + 5, GROUND_Y + 12, 10, 4, '#3e2a1d');
            if (n % 3 === 0) px(x + 2, GROUND_Y - 18, 12, 10, '#5c7b43');
            if (n % 11 === 0) {
                px(x + 8, GROUND_Y - 58, 8, 34, '#3c2a1b');
                px(x, GROUND_Y - 72, 24, 18, '#315f37');
                px(x + 5, GROUND_Y - 84, 20, 18, '#3f7a43');
            }
        }
        for (let x = 190; x < MAP_W - 190; x += 170) {
            px(x, GROUND_Y + 48, 42, 8, '#3d2a1c');
            px(x + 8, GROUND_Y + 40, 26, 8, '#77512f');
        }
        px(0, LANE_Y + 72, MAP_W, 4, 'rgba(47,36,23,0.35)');
        ctx.restore();
    }

    function drawBase(p) {
        const pulse = Math.sin(frameCount / 28 + p.id) * 0.15 + 0.85;
        ctx.save();
        const dir = p.id === 0 ? 1 : -1;
        const x = Math.round(p.base.x - 62);
        const y = Math.round(p.base.y - 72);
        const flagY = y - 38 + Math.round(Math.sin(frameCount / 18 + p.id) * 2);
        const team = p.eliminated ? '#5b5142' : p.color.main;

        px(x - 18, y + 96, 160, 20, 'rgba(47,36,23,0.5)');
        px(x + 8, y + 42, 108, 78, '#5b3a24');
        px(x + 16, y + 50, 92, 66, p.eliminated ? '#4b4034' : '#9a6738');
        px(x + 2, y + 28, 32, 92, '#6b4b2b');
        px(x + 88, y + 22, 34, 98, '#6b4b2b');
        px(x + 8, y + 16, 24, 14, '#c8914f');
        px(x + 92, y + 10, 24, 14, '#c8914f');
        px(x + 38, y + 32, 50, 16, '#d2a158');
        px(x + 47, y + 70, 30, 50, '#2f2417');
        px(x + 55, y + 78, 14, 16, '#f2c45d');
        px(x + 22, y + 58, 14, 12, '#2f2417');
        px(x + 92, y + 54, 14, 12, '#2f2417');
        px(x + (dir > 0 ? 112 : 8), y + 42, 28, 58, '#7a4f2d');
        px(x + (dir > 0 ? 124 : -4), y + 50, 22, 16, team);

        const poleX = x + (dir > 0 ? 112 : 20);
        px(poleX, y - 28, 5, 60, '#2f2417');
        px(poleX + 5 * dir, flagY, 34 * dir, 20, team);
        px(poleX + 9 * dir, flagY + 5, 18 * dir, 5, '#f8fafc');

        ctx.strokeStyle = '#2f2417';
        ctx.lineWidth = 3;
        ctx.strokeRect(x + 8, y + 42, 108, 78);
        ctx.strokeRect(x + 2, y + 28, 32, 92);
        ctx.strokeRect(x + 88, y + 22, 34, 98);

        ctx.fillStyle = p.eliminated ? '#3b342b' : '#fff4c1';
        ctx.font = '700 13px "Rajdhani"';
        ctx.textAlign = 'center';
        ctx.fillText(p.name.slice(0, 3).toUpperCase(), p.base.x, p.base.y + 62);

        if (!p.eliminated) {
            drawBar(x + 22, y + 126, 82, 8, p.hp / p.maxHp, '#de3f32', '#2f2417');
            px(x + 4, y + 20, 8, 8, alpha(p.color.main, 0.75 * pulse));
            px(x + 116, y + 16, 8, 8, alpha(p.color.main, 0.75 * pulse));
        }
        ctx.restore();
    }

    function drawUnitBody(u, color) {
        const type = u.type.toLowerCase();
        const palette = {
            O: '#2f2417',
            S: '#f1c27d',
            H: '#6b3f22',
            T: color,
            D: alpha(color, 0.72),
            M: '#d8d1b8',
            L: '#8a5a32',
            G: '#f2c45d',
            W: '#f8fafc',
            R: '#c43b2f',
            P: '#7654b8',
            B: '#4da6d8'
        };

        if (type.includes('guard')) {
            drawPixelSprite([
                '....OOOO....',
                '...OMMMMO...',
                '..OMSSSMO...',
                '..OMSSSMO...',
                '...OTTTTO...',
                '..OTMTMTO..',
                '.OMTMTMTMO.',
                '.OMTMTMTMO.',
                '.OMTMMMTMO.',
                '..OTTTTTO..',
                '...OLLO....',
                '...O..O....'
            ], palette, 2);
            px(-20, -5, 8, 22, palette.M);
            px(-18, -1, 4, 14, palette.W);
            px(14, -3, 5, 18, palette.L);
            px(12, -7, 9, 5, palette.M);
            return;
        }
        if (type.includes('assassin')) {
            drawPixelSprite([
                '....OOOO....',
                '...OHHHHO...',
                '..OOSSSOO..',
                '..OHSSSHO..',
                '...ODDDO...',
                '..ODTTTDO..',
                '.ODTTTTTDO.',
                '.OODTTTDOO.',
                '..ODTDTDO..',
                '..ODDODDO..',
                '...O..O....',
                '..OO..OO...'
            ], palette, 2);
            px(12, -8, 18, 4, palette.M);
            px(24, -10, 5, 8, palette.W);
            px(-30, -8, 18, 4, palette.M);
            px(-30, -10, 5, 8, palette.W);
            return;
        }
        if (type.includes('mage')) {
            drawPixelSprite([
                '.....PP.....',
                '....PPPP....',
                '...OPPPPO...',
                '..OPSSSSPO..',
                '..OPSSSSPO..',
                '...OTTTTO...',
                '..OTPTPTO..',
                '.OTPTTTPTO.',
                '.OTTTTTTTO.',
                '..OTPTPTO..',
                '...O..O....',
                '..OO..OO...'
            ], palette, 2);
            px(16, -24, 5, 38, palette.L);
            px(12, -30, 13, 10, palette.G);
            px(15, -27, 7, 4, palette.W);
            return;
        }
        if (type.includes('sniper') || type.includes('gunman') || type.includes('gunner') || type.includes('bowman')) {
            drawPixelSprite([
                '....OOOO....',
                '...OHHHHO...',
                '..OHSSSHO..',
                '..OHSSSHO..',
                '...OTTTTO...',
                '..OTLLTTO..',
                '.OTTLTTTTO.',
                '.OTTTTTTTO.',
                '..OTLLTTO..',
                '..OTTOTTO..',
                '...O..O....',
                '..OO..OO...'
            ], palette, 2);
            px(12, -7, 24, 5, palette.L);
            px(32, -9, 6, 9, type.includes('bowman') ? palette.G : palette.M);
            px(-18, -6, 7, 14, palette.L);
            return;
        }
        drawPixelSprite([
            '....OOOO....',
            '...OHHHHO...',
            '..OHSSSHO..',
            '...OTTTTO...',
            '..OTTTTTO..',
            '.OTTTTTTTO.',
            '..OTTTTTO..',
            '...O..O....',
            '..OO..OO...'
        ], palette, 2);
    }

    function drawSheetAnimation(sheet, frameIndex, targetH = 74, yOffset = -8) {
        if (!sheet || !isSpriteReady(sheet.img)) return false;
        const frameCountForSheet = getSheetFrameCount(sheet);
        const frame = Math.min(frameCountForSheet - 1, Math.max(0, frameIndex % frameCountForSheet));
        const targetW = Math.round(sheet.frameW * (targetH / sheet.frameH));
        ctx.drawImage(
            sheet.img,
            frame * sheet.frameW,
            0,
            sheet.frameW,
            sheet.frameH,
            Math.round(-targetW / 2),
            Math.round(-targetH / 2 + yOffset),
            targetW,
            targetH
        );
        return true;
    }

    function drawBowmanSprite(u) {
        const sheets = SPRITES.bowman;
        let action = u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || elapsed >= actionDuration) {
            action = u.state === 'march' ? 'walk' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action === 'shot' || action.startsWith('attack_') ? 4 : 6;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 76, -8);
    }

    function drawAssassinSprite(u) {
        const sheets = SPRITES.assassin;
        let action = u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || elapsed >= actionDuration) {
            action = u.state === 'march' ? 'run' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action.startsWith('attack_') ? 4 : 6;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 76, -8);
    }

    function drawGuardSprite(u) {
        const sheets = SPRITES.guard;
        const isProtecting = u.buffs.some(b => b.type === 'statue');
        let action = isProtecting ? 'protect' : u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || (!isProtecting && elapsed >= actionDuration)) {
            action = u.blockTimer > 0 ? 'defend' : u.state === 'march' ? 'walk' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action.startsWith('attack_') || action === 'defend' ? 4 : 7;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 78, -8);
    }

    function drawMageSprite(u) {
        const sheets = SPRITES.mage;
        let action = u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || elapsed >= actionDuration) {
            action = u.state === 'march' ? 'walk' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action.startsWith('attack_') ? 4 : 6;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 76, -8);
    }

    function drawGunnerSprite(u) {
        const sheets = SPRITES.gunner;
        let action = u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || elapsed >= actionDuration) {
            action = u.state === 'march' ? 'run' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action === 'attack' || action.startsWith('shot_') ? 4 : 6;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 76, -8);
    }

    function drawSniperSprite(u) {
        const sheets = SPRITES.sniper;
        let action = u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 5;

        if (!action || !actionSheet || elapsed >= actionDuration) {
            action = u.state === 'march' ? 'walk' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action === 'shot' ? 5 : 7;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 76, -8);
    }

    function drawHealerSprite(u) {
        const sheets = SPRITES.healer;
        let action = u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || elapsed >= actionDuration) {
            action = u.state === 'march' ? (u.healerRunning ? 'run' : 'walk') : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action.startsWith('attack_') ? 4 : 6;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 76, -8);
    }

    function drawIcemanSprite(u) {
        const sheets = SPRITES.iceman;
        let action = u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || elapsed >= actionDuration) {
            action = u.state === 'march' ? 'walk' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action.startsWith('attack_') || action.startsWith('charge_') ? 4 : 6;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 78, -8);
    }

    function drawChilyGirlSprite(u) {
        const sheets = SPRITES.chilygirl;
        const isProtecting = u.buffs.some(b => b.type === 'chily_protection');
        let action = isProtecting ? 'protect' : u.animAction;
        const elapsed = frameCount - (u.animStartedAt || 0);
        const actionSheet = sheets[action];
        const actionFrames = getSheetFrameCount(actionSheet);
        const actionDuration = actionFrames * 4;

        if (!action || !actionSheet || (!isProtecting && elapsed >= actionDuration)) {
            action = u.state === 'march' ? 'run' : 'idle';
        }

        const sheet = sheets[action] || sheets.idle;
        const frameSpeed = action === 'attack' || action === 'protect' ? 4 : 6;
        const frame = action === u.animAction
            ? Math.floor(Math.max(0, elapsed) / frameSpeed)
            : Math.floor(frameCount / frameSpeed);

        return drawSheetAnimation(sheet, frame, 76, -8);
    }

    function drawChilyGirlEffects(u) {
        const invuln = u.buffs.some(b => b.type === 'invulnerable');
        const protection = u.buffs.some(b => b.type === 'chily_protection');
        const fast = u.buffs.some(b => b.type === 'atk_speed_mult');
        const dir = u.facing === 'left' ? -1 : 1;

        if (invuln || protection) {
            const pulse = 0.55 + Math.sin(frameCount / 5) * 0.18;
            ctx.save();
            ctx.globalAlpha = pulse;
            ctx.strokeStyle = invuln ? '#ef4444' : '#fda4af';
            ctx.lineWidth = protection ? 4 : 3;
            ctx.beginPath();
            ctx.ellipse(0, -14, protection ? 25 : 21, protection ? 34 : 29, 0, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = pulse * 0.55;
            ctx.fillStyle = invuln ? '#ef4444' : '#fb7185';
            for (let i = 0; i < 4; i++) {
                const a = frameCount / 9 + i * Math.PI / 2;
                px(Math.cos(a) * 22 - 2, -16 + Math.sin(a) * 28 - 2, 4, 4, ctx.fillStyle);
            }
            ctx.restore();
        }

        if (fast && u.state === 'fight') {
            ctx.save();
            ctx.globalAlpha = 0.5;
            for (let i = 0; i < 3; i++) {
                const x = -dir * (16 + i * 7 + frameCount % 5);
                px(x, -28 + i * 8, 12, 3, '#fca5a5');
            }
            ctx.restore();
        }

        if (u.animAction === 'attack' && frameCount - (u.animStartedAt || 0) < 18) {
            ctx.save();
            ctx.globalAlpha = 0.72;
            ctx.strokeStyle = '#ef4444';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(dir * 14, -22);
            ctx.quadraticCurveTo(dir * 40, -32, dir * 58, -12);
            ctx.stroke();
            ctx.strokeStyle = '#fff4c1';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(dir * 18, -15);
            ctx.lineTo(dir * 52, -7);
            ctx.stroke();
            ctx.restore();
        }
    }

    function drawUnit(u) {
        const p = players[u.owner];
        const bob = Math.round(Math.sin(frameCount / 12 + u.x * 0.02) * 2);
        const sx = Math.round(u.x);
        const sy = Math.round(u.y + bob);

        ctx.save();
        px(sx - 13, sy + 15, 26, 6, 'rgba(47,36,23,0.42)');
        ctx.translate(sx, sy);
        if (u.type === 'Guard') {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawGuardSprite(u)) {
                drawUnitBody(u, p.color.main);
            }
        } else if (u.type.toLowerCase().includes('bowman')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawBowmanSprite(u)) drawUnitBody(u, p.color.main);
        } else if (u.type.toLowerCase().includes('assassin')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawAssassinSprite(u)) drawUnitBody(u, p.color.main);
        } else if (u.type.toLowerCase().includes('mage')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawMageSprite(u)) drawUnitBody(u, p.color.main);
        } else if (u.type.toLowerCase().includes('gunman') || u.type.toLowerCase().includes('gunner')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawGunnerSprite(u)) drawUnitBody(u, p.color.main);
        } else if (u.type.toLowerCase().includes('sniper')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawSniperSprite(u)) drawUnitBody(u, p.color.main);
        } else if (u.type.toLowerCase().includes('healer')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawHealerSprite(u)) drawUnitBody(u, p.color.main);
        } else if (u.type.toLowerCase().includes('iceman')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (!drawIcemanSprite(u)) drawUnitBody(u, p.color.main);
        } else if (u.type.toLowerCase().includes('chilygirl')) {
            if (u.facing === 'left') ctx.scale(-1, 1);
            drawChilyGirlEffects(u);
            if (!drawChilyGirlSprite(u)) drawUnitBody(u, p.color.main);
        } else {
            if (u.facing === 'left') ctx.scale(-1, 1);
            if (u.state === 'fight' && frameCount % 18 < 9) ctx.translate(1, 0);
            drawUnitBody(u, p.color.main);
        }

        if (isFrozen(u)) {
            ctx.strokeStyle = '#bae6fd';
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.85;
            ctx.strokeRect(-20, -42, 40, 56);
            ctx.globalAlpha = 1;
        }

        px(-11, -21, 22, 4, p.color.main);
        px(-7, -20, 14, 2, '#fff4c1');

        const hbW = u.radius * 2.2;
        const hpPct = Math.max(0, u.hp / getEffectiveMaxHp(u));
        const manaPct = Math.max(0, u.mana / u.maxMana);
        drawBar(-hbW / 2, -u.radius - 28, hbW, 5, hpPct, hpPct > 0.35 ? '#4fb64f' : '#c43b2f', '#2f2417');
        drawBar(-hbW / 2, -u.radius - 21, hbW, 3, manaPct, '#4da6d8', '#2f2417');
        ctx.restore();
    }

    function draw() {
        ctx.clearRect(0, 0, MAP_W, MAP_H);
        drawMapBackground();
        players.forEach(p => {
            drawBase(p);
        });
        [...units].sort((a, b) => a.y - b.y).forEach(drawUnit);
        vfx.forEach(fx => {
            const pct = fx.life / fx.maxLife;
            ctx.save();
            ctx.globalAlpha = pct;
            if (fx.sprite === 'gunner_explosion' && isSpriteReady(SPRITES.gunner.explosion.img)) {
                const sheet = SPRITES.gunner.explosion;
                const frames = getSheetFrameCount(sheet);
                const frame = Math.min(frames - 1, Math.floor((1 - pct) * frames));
                const size = Math.max(48, fx.radius * 3);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(sheet.img, frame * sheet.frameW, 0, sheet.frameW, sheet.frameH, Math.round(fx.x - size / 2), Math.round(fx.y - size / 2), size, size);
            } else {
                ctx.strokeStyle = fx.color;
                ctx.lineWidth = 3;
                const r = Math.round(fx.radius);
                ctx.strokeRect(Math.round(fx.x - r), Math.round(fx.y - r), r * 2, r * 2);
            }
            ctx.restore();
        });
        projectiles.forEach(pr => {
            ctx.save();
            const angle = Math.atan2(pr.ty - pr.y, pr.tx - pr.x);
            const x = Math.round(pr.x);
            const y = Math.round(pr.y);
            if (pr.sprite === 'arrow' && isSpriteReady(SPRITES.bowman.arrow)) {
                ctx.translate(x, y);
                ctx.rotate(angle);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(SPRITES.bowman.arrow, -24, -24, 48, 48);
            } else if (pr.sprite === 'grenade') {
                ctx.translate(x, y);
                ctx.rotate(angle);
                px(-7, -4, 14, 8, '#22c55e');
                px(-5, -2, 10, 4, '#14532d');
                px(5, -5, 4, 3, '#86efac');
            } else if ((pr.sprite === 'healer_fire_1' || pr.sprite === 'healer_fire_2') && isSpriteReady(SPRITES.healer[pr.sprite === 'healer_fire_1' ? 'fire_1' : 'fire_2'].img)) {
                const sheet = SPRITES.healer[pr.sprite === 'healer_fire_1' ? 'fire_1' : 'fire_2'];
                const frames = getSheetFrameCount(sheet);
                const frame = Math.floor(frameCount / 3) % frames;
                ctx.translate(x, y);
                ctx.rotate(angle);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(sheet.img, frame * sheet.frameW, 0, sheet.frameW, sheet.frameH, -28, -14, 56, 28);
            } else if (pr.sprite === 'iceman_magic_arrow' && isSpriteReady(SPRITES.iceman.magic_arrow.img)) {
                const sheet = SPRITES.iceman.magic_arrow;
                const frames = getSheetFrameCount(sheet);
                const frame = Math.floor(frameCount / 3) % frames;
                ctx.translate(x, y);
                ctx.rotate(angle);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(sheet.img, frame * sheet.frameW, 0, sheet.frameW, sheet.frameH, -28, -14, 56, 28);
            } else if ((pr.sprite === 'chily' || pr.sprite === 'chily_big') && isSpriteReady(SPRITES.chilygirl.chili)) {
                const size = pr.sprite === 'chily_big' ? 58 : 34;
                ctx.translate(x, y);
                ctx.rotate(angle);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(SPRITES.chilygirl.chili, -size / 2, -size / 4, size, Math.round(size * 0.4));
            } else if (pr.sprite === 'mage_charge' && isSpriteReady(SPRITES.mage.charge.img)) {
                const sheet = SPRITES.mage.charge;
                const frames = getSheetFrameCount(sheet);
                const frame = Math.floor(frameCount / 3) % frames;
                ctx.translate(x, y);
                ctx.rotate(angle);
                ctx.imageSmoothingEnabled = false;
                ctx.drawImage(sheet.img, frame * sheet.frameW, 0, sheet.frameW, sheet.frameH, -26, -13, 52, 26);
            } else if (pr.dmgType === 'magic') {
                px(x - 5, y - 5, 10, 10, pr.color);
                px(x - 2, y - 2, 4, 4, '#fff4c1');
                px(x - Math.round(Math.cos(angle) * 12), y - Math.round(Math.sin(angle) * 12), 5, 5, '#5a3c8a');
            } else {
                const dx = Math.sign(Math.cos(angle)) || 1;
                const dy = Math.sign(Math.sin(angle));
                px(x - dx * 10, y - dy * 10, 12, 4, '#5b3922');
                px(x, y - 2, 8, 5, pr.color);
            }
            ctx.restore();
        });
        particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
            px(p.x, p.y, Math.max(2, p.size), Math.max(2, p.size), p.color);
            ctx.restore();
        });
        for (let i = floatingTexts.length - 1; i >= 0; i--) {
            let t = floatingTexts[i];
            ctx.globalAlpha = t.life / 60; ctx.fillStyle = t.color; ctx.font = 'bold 14px "Rajdhani"'; ctx.fillText(t.text, t.x, t.y);
            t.y += t.vy; t.life--;
            if (t.life <= 0) floatingTexts.splice(i, 1);
        }
        ctx.globalAlpha = 1;
        if (paused) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0,0,MAP_W,MAP_H); ctx.fillStyle = '#fff'; ctx.font = 'bold 40px Rajdhani'; ctx.fillText("GAME PAUSED", MAP_W/2, MAP_H/2); }
    }

    function loop(now = performance.now()) {
        if (!running) return;

        if (onlineMode) {
            if (!paused) {
                const targetFrame = Math.max(0, Math.floor((now - simulationStartedAt) / FIXED_FRAME_MS));
                let steps = 0;
                while (running && frameCount < targetFrame && steps < 8) {
                    update();
                    steps++;
                }
            }
            draw();
            if (running) requestAnimationFrame(loop);
            return;
        }

        update();
        draw();
        if (!paused && running) requestAnimationFrame(loop);
    }

    function updateSetupUI() {
        const count = MAX_PLAYERS;
        const playerCountEl = document.getElementById('player-count');
        if (playerCountEl) playerCountEl.value = String(MAX_PLAYERS);
        const configContainer = document.getElementById('agents-config');
        if (!configContainer) return;
        
        let html = '';
        for (let i = 0; i < count; i++) {
            const isHuman = i === 0;
            html += `
                <div class="agent-setup-card" style="border-left: 4px solid ${COLORS[i].main}">
                    <div class="agent-card-head">
                        <div>
                            <div class="brand-kicker">Slot ${i + 1}</div>
                            <div class="agent-role" style="color:${COLORS[i].main}">${isHuman ? 'Commander' : 'Enemy Agent'}</div>
                        </div>
                        <span class="agent-badge">${isHuman ? 'You' : 'AI'}</span>
                    </div>
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

    function panCamera(delta) {
        const wrap = document.getElementById('map-wrap');
        if (!wrap) return;
        wrap.scrollBy({ left: delta, behavior: 'smooth' });
        requestAnimationFrame(updateDeploymentHudPosition);
    }

    function focusCamera(target = 'home') {
        const wrap = document.getElementById('map-wrap');
        if (!wrap) return;
        const positions = {
            home: 0,
            mid: Math.max(0, (wrap.scrollWidth - wrap.clientWidth) / 2),
            enemy: Math.max(0, wrap.scrollWidth - wrap.clientWidth)
        };
        wrap.scrollTo({ left: positions[target] ?? positions.home, behavior: 'smooth' });
        requestAnimationFrame(updateDeploymentHudPosition);
    }

    function getCameraScrollCenter(wrap) {
        return {
            x: (wrap.scrollLeft + wrap.clientWidth / 2) / Math.max(1, wrap.scrollWidth),
            y: (wrap.scrollTop + wrap.clientHeight / 2) / Math.max(1, wrap.scrollHeight)
        };
    }

    function updateCameraZoomLabel() {
        const label = document.getElementById('camera-zoom-label');
        if (label) label.textContent = `${Math.round(cameraZoom * 100)}%`;
    }

    function applyCameraZoom(center = null) {
        const wrap = document.getElementById('map-wrap');
        const scrollCenter = center || (wrap ? getCameraScrollCenter(wrap) : null);
        document.documentElement.style.setProperty('--camera-zoom', cameraZoom.toFixed(2));
        updateCameraZoomLabel();
        localStorage.setItem('cameraZoom', cameraZoom.toFixed(2));

        if (wrap && scrollCenter) {
            requestAnimationFrame(() => {
                wrap.scrollLeft = Math.max(0, scrollCenter.x * wrap.scrollWidth - wrap.clientWidth / 2);
                wrap.scrollTop = Math.max(0, scrollCenter.y * wrap.scrollHeight - wrap.clientHeight / 2);
                updateDeploymentHudPosition();
            });
            return;
        }
        requestAnimationFrame(updateDeploymentHudPosition);
    }

    function setCameraZoom(value) {
        const wrap = document.getElementById('map-wrap');
        const center = wrap ? getCameraScrollCenter(wrap) : null;
        cameraZoom = clamp(Number(value) || 1, MIN_CAMERA_ZOOM, MAX_CAMERA_ZOOM);
        applyCameraZoom(center);
    }

    function zoomCamera(delta) {
        setCameraZoom(Math.round((cameraZoom + delta) / CAMERA_ZOOM_STEP) * CAMERA_ZOOM_STEP);
    }

    function handleCameraWheel(e) {
        if (!e.ctrlKey && !e.metaKey) return;
        e.preventDefault();
        zoomCamera(e.deltaY > 0 ? -CAMERA_ZOOM_STEP : CAMERA_ZOOM_STEP);
    }

    function updateDeploymentHudPosition() {
        const wrap = document.getElementById('map-wrap');
        const hud = document.getElementById('deployment-hud');
        if (!wrap || !hud) return;
        if (window.matchMedia('(max-width: 950px), (pointer: coarse) and (max-height: 520px)').matches) {
            hud.style.left = '';
            return;
        }
        hud.style.left = `${wrap.scrollLeft + wrap.clientWidth / 2}px`;
    }

    async function toggleFullscreen() {
        try {
            if (document.fullscreenElement) {
                await document.exitFullscreen();
            } else {
                const target = document.documentElement;
                try {
                    await target.requestFullscreen({ navigationUI: 'hide' });
                } catch (err) {
                    await target.requestFullscreen();
                }
                if (screen.orientation?.lock && window.matchMedia('(max-width: 950px)').matches) {
                    screen.orientation.lock('landscape').catch(() => {});
                }
            }
        } catch (err) {
            console.warn('Fullscreen request was blocked by the browser:', err);
        } finally {
            MobileViewport.sync();
            requestAnimationFrame(updateDeploymentHudPosition);
        }
    }

    function init(state = null, options = {}) {
        MobileViewport.sync();
        document.getElementById('setup-overlay').style.display = 'none';
        onlineMode = !!options.online;
        onlineMatchId = options.matchId || null;
        localPlayerIndex = onlineMode ? Number(options.playerIndex || 0) : 0;
        setSeed(onlineMode ? options.seed : 1);
        canvas = document.getElementById('gameCanvas'); 
        canvas.width = MAP_W;
        canvas.height = MAP_H;
        ctx = canvas.getContext('2d');
        canvas.addEventListener('mousemove', handleMouseMove);
        
        const count = MAX_PLAYERS;
        players = []; 
        projectiles = [];
        vfx = [];
        particles = [];
        floatingTexts = [];
        unitsPending = [];
        onlineActions = [];
        
        const dash = document.getElementById('dashboard'); 
        dash.innerHTML = '';
        
        for (let i = 0; i < count; i++) {
            const isHuman = onlineMode ? true : i === 0;
            const savedPlayer = state?.players?.[i];
            const onlinePlayerName = options.players?.[i]?.username;
            if (savedPlayer) players.push({ ...savedPlayer, id: i, color: COLORS[i], isHuman, base: getBaseForPlayer(i) });
            else players.push({ id: i, name: onlinePlayerName || (isHuman ? Auth.getUser().username : 'Enemy Agent'), isHuman, color: COLORS[i], gold: 150, hp: 2500, maxHp: 2500, base: getBaseForPlayer(i), eliminated: false });
            dash.innerHTML += `<div class="player-card" style="border-top:2px solid ${COLORS[i].main}"><div class="card-header"><span class="player-name">${escapeHtml(players[i].name)}</span><span class="resource-count" id="gold-${i}">$ ${Math.floor(players[i].gold)}</span></div><div class="hp-bg"><div class="hp-bar" id="hp-${i}" style="width:${(players[i].hp/players[i].maxHp)*100}%"></div></div></div>`;
        }

        if (state?.units) {
            units = state.units.filter(u => u.owner < MAX_PLAYERS).map((u, idx) => {
                const type = u.type === 'Hunter' ? 'Iceman' : u.type;
                return ({
                ...u,
                type,
                meta: { ...CLASSES[type] },
                id: `saved_${idx}_${frameCount}`,
                y: laneYFor(idx),
                laneY: laneYFor(idx),
                radius: 12, buffs: [], isPet: false, untargetableTimer: 0, cooldown: 0, state: 'march', lastAttacker: null, facing: u.owner === 0 ? 'right' : 'left', blockTimer: 0, icemanPassiveTriggered: !!u.icemanPassiveTriggered, chilyProtectionTriggered: !!u.chilyProtectionTriggered
            });
            });
            frameCount = state.frameCount || 0;
        } else {
            units = [];
            frameCount = 0;
        }

        document.getElementById('deployment-hud').style.display = 'block';
        document.getElementById('unit-buttons').innerHTML = Object.keys(CLASSES).filter(k => CLASSES[k].cost > 0).map(k => `<button class="unit-btn" id="btn-${k}" onclick="Game.buy('${k}')"><span class="u-icon">${escapeHtml(CLASSES[k].icon)}</span><span class="u-name">${escapeHtml(k)}</span><span class="u-cost">${CLASSES[k].cost}g</span></button>`).join('');
        updateUnitButtons();
        const mapWrap = document.getElementById('map-wrap');
        if (mapWrap) mapWrap.onscroll = updateDeploymentHudPosition;
        applyCameraZoom();
        if (mapWrap && !cameraWheelListenerAttached) {
            mapWrap.addEventListener('wheel', handleCameraWheel, { passive: false });
            cameraWheelListenerAttached = true;
        }
        if (!hudResizeListenerAttached) {
            window.addEventListener('resize', updateDeploymentHudPosition, { passive: true });
            window.visualViewport?.addEventListener('resize', updateDeploymentHudPosition, { passive: true });
            document.addEventListener('fullscreenchange', updateDeploymentHudPosition);
            hudResizeListenerAttached = true;
        }
        updateDeploymentHudPosition();
        
        log(onlineMode ? `ONLINE MATCH ${onlineMatchId} LINKED.` : (state ? `SESSION RESUMED AT FRAME ${frameCount}.` : `STRATEGIC SESSION INITIALIZED.`), '#38bdf8');
        log(`Commander ${players[localPlayerIndex].name} online.`, '#fff');
        
        paused = false;
        const pauseBtn = document.getElementById('pause-btn');
        if (pauseBtn) pauseBtn.innerText = 'PAUSE';
        const firstFocus = localPlayerIndex === 0 ? 'home' : 'enemy';
        setTimeout(() => { focusCamera(firstFocus); updateDeploymentHudPosition(); }, 0);
        const startDelay = onlineMode ? Math.max(0, Number(options.startsAt || Date.now()) - Date.now()) : 0;
        if (onlineMode && startDelay > 0) log(`Battle starts in ${Math.ceil(startDelay / 1000)} seconds.`, '#fbbf24');
        setTimeout(() => {
            simulationStartedAt = onlineMode
                ? performance.now() - Math.max(0, Date.now() - Number(options.startsAt || Date.now()))
                : performance.now();
            running = true;
            requestAnimationFrame(loop);
        }, startDelay);
    }

    function spawnImpact(x, y, color, radius = 22) {
        if (vfx.length < MAX_VFX) vfx.push({ x, y, color, radius: 4, growth: radius / 14, life: 18, maxLife: 18 });
    }
    function spawnExplosion(x, y, owner, radius = 20) {
        if (vfx.length < MAX_VFX) vfx.push({ x, y, owner, sprite: 'gunner_explosion', radius, life: 36, maxLife: 36, growth: 0, color: '#f97316' });
    }
    function spawnVFX(x, y, text, color) { if (floatingTexts.length < MAX_TEXTS) floatingTexts.push({ x, y, text, color, life: 60, vy: -1 }); }
    function log(msg, color) { const l = document.getElementById('combat-log'); if (!l) return; const e = document.createElement('div'); e.className = 'log-entry'; e.style.color = color; e.textContent = msg; l.prepend(e); }

    function updateUnitButtons() {
        const localPlayer = players[localPlayerIndex];
        if (!localPlayer) return;
        const playerUnitCount = units.filter(u => u.owner === localPlayerIndex).length + unitsPending.filter(u => u.owner === localPlayerIndex).length;
        Object.keys(CLASSES).forEach(k => {
            const btn = document.getElementById(`btn-${k}`);
            if (!btn) return;
            btn.disabled = localPlayer.gold < CLASSES[k].cost || playerUnitCount >= MAX_UNITS_PER_PLAYER;
        });
    }

    return { init, buy: buyUnit, applyOnlineAction, fetchUnits, checkActiveSession, togglePause, toggleFullscreen, resume, startFresh, updateSetupUI, panCamera, focusCamera, zoomCamera, setCameraZoom };
})();

window.UI = UI;
window.Auth = Auth;
window.Admin = Admin;
window.Game = Game;
window.Online = Online;

window.onload = () => {
    MobileViewport.init();
    Auth.checkSession();
};
