const express = require('express');
const asyncHandler = require('express-async-handler');

function createMatchRouter({ authenticate, matchService, unitService, verifyMatchToken }) {
    const router = express.Router();

    router.post('/join', authenticate, asyncHandler(async (req, res) => {
        const loadoutUnitNames = await unitService.resolveUserLoadout(req.user.id, req.body?.loadoutSlot);
        const payload = await matchService.joinMatch({
            id: req.user.id,
            username: req.user.username,
            loadoutSlot: [1, 2, 3].includes(Number(req.body?.loadoutSlot)) ? Number(req.body.loadoutSlot) : null,
            loadoutUnitNames
        });
        res.json(payload);
    }));

    router.post('/custom/create', authenticate, asyncHandler(async (req, res) => {
        const loadoutUnitNames = await unitService.resolveUserLoadout(req.user.id, req.body?.loadoutSlot);
        const payload = await matchService.createCustomRoom({
            id: req.user.id,
            username: req.user.username,
            loadoutSlot: [1, 2, 3].includes(Number(req.body?.loadoutSlot)) ? Number(req.body.loadoutSlot) : null,
            loadoutUnitNames
        });
        res.json(payload);
    }));

    router.post('/custom/join', authenticate, asyncHandler(async (req, res) => {
        const loadoutUnitNames = await unitService.resolveUserLoadout(req.user.id, req.body?.loadoutSlot);
        const payload = await matchService.joinCustomRoom(String(req.body?.roomCode || ''), {
            id: req.user.id,
            username: req.user.username,
            loadoutSlot: [1, 2, 3].includes(Number(req.body?.loadoutSlot)) ? Number(req.body.loadoutSlot) : null,
            loadoutUnitNames
        });
        if (payload?.status && payload.status >= 400) {
            return res.status(payload.status).json({ message: payload.message || 'Unable to join custom room' });
        }
        res.json(payload);
    }));

    router.get('/stream', (req, res) => {
        matchService.openStream(req, res, verifyMatchToken);
    });

    router.post('/action', authenticate, (req, res) => {
        const result = matchService.performAction(req.body.matchId, req.user.id, req.body);
        if (!result.ok) return res.status(result.status || 400).json({ message: result.message || 'Unable to process action' });
        res.json(result);
    });

    router.post('/state', authenticate, (req, res) => {
        const result = matchService.publishState(req.body.matchId, req.user.id, req.body);
        if (!result.ok) return res.status(result.status || 400).json({ message: result.message || 'Unable to process state' });
        res.json(result);
    });

    router.post('/ping', authenticate, (req, res) => {
        const result = matchService.pingMatch(req.body.matchId, req.user.id, req.body.clientSentAt);
        if (!result.ok) return res.status(result.status || 400).json({ message: result.message || 'Unable to ping match' });
        res.json(result);
    });

    router.post('/leave', authenticate, (req, res) => {
        res.json(matchService.leaveMatch(req.body.matchId, req.user.id));
    });

    return router;
}

module.exports = { createMatchRouter };
