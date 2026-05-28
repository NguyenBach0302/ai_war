const Online = (function() {
    let source = null;
    let socket = null;
    let currentMatchId = null;
    let activeStartedMatchId = null;
    let commandSeq = 1;
    let pingTimer = null;
    let pingMs = null;
    let currentMatchType = 'ranked';
    let currentRoomCode = null;
    let roomState = null;

    function setRoomStatus(message) {
        const el = document.getElementById('custom-room-status');
        if (el) el.textContent = message || '';
    }

    function setLobbyVisible(visible) {
        const setupView = document.getElementById('setup-matchmaking-view');
        const roomView = document.getElementById('custom-room-view');
        if (setupView) setupView.style.display = visible ? 'none' : '';
        if (roomView) roomView.style.display = visible ? 'flex' : 'none';
    }

    function renderRoomState() {
        const codeEl = document.getElementById('custom-room-code');
        const countEl = document.getElementById('custom-room-count');
        const playersEl = document.getElementById('custom-room-players');
        const startBtn = document.getElementById('custom-room-start-btn');
        if (!codeEl || !countEl || !playersEl || !startBtn) return;
        const players = Array.isArray(roomState?.players) ? roomState.players : [];
        const roomCode = roomState?.roomCode || currentRoomCode || '------';
        const playerCount = players.length;
        const canStart = !!roomState?.canStart;
        codeEl.textContent = roomCode;
        countEl.textContent = `${playerCount} / 2`;
        playersEl.innerHTML = [0, 1].map(idx => {
            const player = players[idx];
            if (player) {
                return `
                    <div class="panel custom-room-player">
                        <div class="brand-kicker">${player.isHost ? 'Host' : 'Guest'}</div>
                        <strong>${escapeHtml(player.username)}</strong>
                    </div>
                `;
            }
            return `
                <div class="panel custom-room-player">
                    <div class="brand-kicker">Waiting</div>
                    <strong>Open Slot</strong>
                </div>
            `;
        }).join('');
        startBtn.disabled = !canStart;
    }

    function showRoomLobby(nextRoomState, message = '') {
        roomState = nextRoomState || roomState || null;
        if (roomState?.roomCode) currentRoomCode = roomState.roomCode;
        setLobbyVisible(true);
        renderRoomState();
        if (message) setRoomStatus(message);
    }

    function hideRoomLobby() {
        roomState = null;
        setLobbyVisible(false);
        setRoomStatus('');
    }

    function setStatus(message) {
        const el = document.getElementById('online-status');
        if (el) el.textContent = message || '';
    }

    function renderPing() {
        const wrap = document.getElementById('connection-stats');
        const value = document.getElementById('ping-value');
        if (!wrap || !value) return;
        wrap.classList.remove('ping-good', 'ping-warn', 'ping-bad');
        if (!currentMatchId) {
            wrap.style.display = 'none';
            value.textContent = '--';
            return;
        }
        wrap.style.display = 'inline-flex';
        const roundedPing = Number.isFinite(pingMs) ? Math.round(pingMs) : null;
        value.textContent = roundedPing === null ? '--' : String(roundedPing);
        if (roundedPing === null) return;
        if (roundedPing < 90) wrap.classList.add('ping-good');
        else if (roundedPing < 180) wrap.classList.add('ping-warn');
        else wrap.classList.add('ping-bad');
    }

    async function measurePing() {
        if (!currentMatchId || !Auth.getToken()) return;
        const startedAt = performance.now();
        try {
            const res = await fetch('/api/match/ping', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: JSON.stringify({ matchId: currentMatchId, clientSentAt: Date.now() })
            });
            if (!res.ok) return;
            await res.json().catch(() => null);
            const sample = performance.now() - startedAt;
            pingMs = Number.isFinite(pingMs) ? (pingMs * 0.65) + (sample * 0.35) : sample;
            renderPing();
        } catch (err) {
            // Keep the last sample on transient network failures.
        }
    }

    function startPingLoop() {
        stopPingLoop();
        renderPing();
        measurePing();
        pingTimer = setInterval(measurePing, 4000);
    }

    function stopPingLoop() {
        if (pingTimer) clearInterval(pingTimer);
        pingTimer = null;
        pingMs = null;
        renderPing();
    }

    function closeStream() {
        if (source) source.close();
        source = null;
        if (socket) socket.close();
        socket = null;
    }

    function handleRealtimeEvent(eventName, payload) {
        if (eventName === 'match-start') {
            const data = payload;
            currentMatchId = data.matchId;
            currentMatchType = data.matchType || 'ranked';
            currentRoomCode = data.roomCode || null;
            hideRoomLobby();
            if (activeStartedMatchId === data.matchId) return;
            activeStartedMatchId = data.matchId;
            Game.init(null, {
                online: true,
                matchId: data.matchId,
                matchType: currentMatchType,
                roomCode: currentRoomCode,
                playerIndex: data.playerIndex,
                players: data.players,
                seed: data.seed,
                startsAt: data.startsAt,
                serverNow: data.serverNow,
                confirmedFrame: data.confirmedFrame,
                units: data.units
            });
            return;
        }
        if (eventName === 'match-action') {
            Game.applyOnlineAction(payload);
            return;
        }
        if (eventName === 'match-sync') {
            Game.syncOnlineClock(payload);
            return;
        }
        if (eventName === 'match-state') {
            Game.applyAuthoritativeState(payload);
            return;
        }
        if (eventName === 'match-events') {
            Game.applyAuthoritativeEvents(Array.isArray(payload) ? payload : []);
            return;
        }
        if (eventName === 'match-visual') {
            Game.applyServerVisual(payload);
            return;
        }
        if (eventName === 'command-result') {
            if (payload?.state) Game.applyAuthoritativeState(payload.state);
            if (payload?.ok === false) setStatus(payload.message || 'Command rejected.');
            return;
        }
        if (eventName === 'error') {
            if (payload?.message) setStatus(payload.message);
            return;
        }
        if (eventName === 'player-disconnected') {
            setStatus('Opponent disconnected. Match can continue, but they may stop responding.');
            return;
        }
        if (eventName === 'room-state') {
            showRoomLobby(payload, payload?.message || '');
            if (payload?.message) setStatus(payload.message);
            return;
        }
        if (eventName === 'match-ended') {
            if (payload?.state) Game.applyAuthoritativeState(payload.state);
            currentMatchId = null;
            activeStartedMatchId = null;
            currentMatchType = 'ranked';
            currentRoomCode = null;
            hideRoomLobby();
            stopPingLoop();
            closeStream();
            setStatus('Match ended.');
        }
    }

    function openStream(matchId) {
        closeStream();
        currentMatchId = matchId;
        startPingLoop();
        const token = encodeURIComponent(Auth.getToken());
        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
        socket = new WebSocket(`${protocol}//${location.host}/api/match/ws?matchId=${encodeURIComponent(matchId)}&token=${token}`);
        socket.binaryType = 'arraybuffer';
        socket.onopen = () => setStatus('Online socket connected.');
        socket.onmessage = async event => {
            try {
                if (event.data instanceof ArrayBuffer) {
                    handleRealtimeEvent('match-state', Game.decodeBinaryMatchState(event.data));
                    return;
                }
                if (typeof Blob !== 'undefined' && event.data instanceof Blob) {
                    handleRealtimeEvent('match-state', Game.decodeBinaryMatchState(await event.data.arrayBuffer()));
                    return;
                }
                const data = JSON.parse(event.data);
                handleRealtimeEvent(data.event, data.payload);
            } catch (err) {
                console.warn('Invalid socket message', err);
            }
        };
        socket.onerror = () => setStatus('Online socket interrupted. Falling back...');
        socket.onclose = () => {
            if (!currentMatchId) return;
            source = new EventSource(`/api/match/stream?matchId=${encodeURIComponent(matchId)}&token=${token}`);
            source.addEventListener('match-start', event => handleRealtimeEvent('match-start', JSON.parse(event.data)));
            source.addEventListener('match-action', event => handleRealtimeEvent('match-action', JSON.parse(event.data)));
            source.addEventListener('match-sync', event => handleRealtimeEvent('match-sync', JSON.parse(event.data)));
            source.addEventListener('match-state', event => handleRealtimeEvent('match-state', JSON.parse(event.data)));
            source.addEventListener('match-events', event => handleRealtimeEvent('match-events', JSON.parse(event.data || '[]')));
            source.addEventListener('match-visual', event => handleRealtimeEvent('match-visual', JSON.parse(event.data)));
            source.addEventListener('room-state', event => handleRealtimeEvent('room-state', JSON.parse(event.data || '{}')));
            source.addEventListener('player-disconnected', event => handleRealtimeEvent('player-disconnected', JSON.parse(event.data || '{}')));
            source.addEventListener('match-ended', event => handleRealtimeEvent('match-ended', JSON.parse(event.data || '{}')));
            source.onerror = () => setStatus('Online connection interrupted. Reconnecting...');
        };
    }

    async function findMatch() {
        setStatus('Searching for an opponent...');
        try {
            const res = await fetch('/api/match/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: JSON.stringify({ loadoutSlot: Game.getSelectedLoadoutSlot() })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Unable to join online match');
            currentMatchId = data.matchId;
            currentMatchType = data.matchType || 'ranked';
            currentRoomCode = data.roomCode || null;
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

    async function openCustomRoom() {
        setStatus('Creating custom room...');
        try {
            const res = await fetch('/api/match/custom/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: JSON.stringify({
                    loadoutSlot: Game.getSelectedLoadoutSlot()
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Unable to open custom room');
            currentMatchId = data.matchId;
            currentMatchType = data.matchType || 'custom';
            currentRoomCode = data.roomCode || null;
            openStream(data.matchId);
            showRoomLobby(data.roomState || null, `Custom room ${data.roomCode} created. Share this ID with your friend.`);
            setStatus(`Custom room ${data.roomCode} created. Share this ID with your friend.`);
        } catch (err) {
            setStatus(err.message || 'Unable to open custom room.');
        }
    }

    async function joinCustomRoom() {
        const roomId = window.prompt('Enter the custom room ID.');
        if (roomId === null) return;
        const normalizedRoomId = roomId.trim();
        if (!normalizedRoomId) {
            setStatus('Room ID is required.');
            return;
        }
        setStatus('Joining custom room...');
        try {
            const res = await fetch('/api/match/custom/join', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: JSON.stringify({
                    roomCode: normalizedRoomId,
                    loadoutSlot: Game.getSelectedLoadoutSlot()
                })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Unable to join custom room');
            currentMatchId = data.matchId;
            currentMatchType = data.matchType || 'custom';
            currentRoomCode = data.roomCode || normalizedRoomId;
            openStream(data.matchId);
            showRoomLobby(data.roomState || null, `Joined custom room ${currentRoomCode}.`);
            setStatus(`Joined custom room ${currentRoomCode}.`);
        } catch (err) {
            setStatus(err.message || 'Unable to join custom room.');
        }
    }

    async function startCustomRoom() {
        if (!currentMatchId) return;
        setRoomStatus('Starting room...');
        try {
            const res = await fetch('/api/match/custom/start', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${Auth.getToken()}`
                },
                body: JSON.stringify({ matchId: currentMatchId })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data.message || 'Unable to start custom room');
            if (data?.message) {
                setRoomStatus(data.message);
                setStatus(data.message);
            }
        } catch (err) {
            const message = err.message || 'Unable to start custom room.';
            setRoomStatus(message);
            setStatus(message);
        }
    }

    function leaveRoomLobby() {
        leave();
        hideRoomLobby();
        setStatus('');
        document.getElementById('setup-overlay').style.display = 'flex';
    }

    async function sendBuy(unitType) {
        if (!currentMatchId) return;
        Game.previewOnlineBuy(unitType);
        if (socket && socket.readyState === WebSocket.OPEN) {
            try {
                socket.send(JSON.stringify({ type: 'buy', unitType, requestId: commandSeq++ }));
                return;
            } catch (err) {
                console.warn('Socket buy failed, retrying over HTTP', err);
            }
        }
        const res = await fetch('/api/match/action', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${Auth.getToken()}`
            },
            body: JSON.stringify({ matchId: currentMatchId, type: 'buy', unitType })
        });
        if (res.ok) {
            const data = await res.json().catch(() => null);
            if (data?.state) Game.applyAuthoritativeState(data.state);
        }
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
        activeStartedMatchId = null;
        currentMatchType = 'ranked';
        currentRoomCode = null;
        hideRoomLobby();
        stopPingLoop();
        closeStream();
    }

    function clearLocalMatch() {
        currentMatchId = null;
        activeStartedMatchId = null;
        currentMatchType = 'ranked';
        currentRoomCode = null;
        hideRoomLobby();
        stopPingLoop();
    }

    return { findMatch, openCustomRoom, joinCustomRoom, startCustomRoom, leaveRoomLobby, sendBuy, leave, clearLocalMatch, renderPing };
})();

