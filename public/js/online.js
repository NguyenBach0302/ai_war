const Online = (function() {
    let source = null;
    let socket = null;
    let currentMatchId = null;
    let activeStartedMatchId = null;
    let commandSeq = 1;
    let pingTimer = null;
    let pingMs = null;

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
            if (activeStartedMatchId === data.matchId) return;
            activeStartedMatchId = data.matchId;
            Game.init(null, {
                online: true,
                matchId: data.matchId,
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
        if (eventName === 'match-ended') {
            if (payload?.state) Game.applyAuthoritativeState(payload.state);
            currentMatchId = null;
            activeStartedMatchId = null;
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
        stopPingLoop();
        closeStream();
    }

    function clearLocalMatch() {
        currentMatchId = null;
        activeStartedMatchId = null;
        stopPingLoop();
    }

    return { findMatch, sendBuy, leave, clearLocalMatch, renderPing };
})();

