package com.example.game.server.service;

import com.example.game.server.data.GameSessionDao;
import com.example.game.server.data.PlayerDao;
import com.example.game.server.net.ClientSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.SQLException;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Tracks all live {@link ServerGame}s and routes per-game actions (moves, chat,
 * disconnects) to the right one. Indexed by session id for O(1) lookup from a
 * client's handler thread.
 *
 * <p>Thread safe via a {@link ConcurrentHashMap}; each {@link ServerGame}
 * serializes its own mutations internally.
 */
public final class GameSessionManager {

    private static final Logger log = LoggerFactory.getLogger(GameSessionManager.class);

    /** sessionId -> the game that session is currently in. */
    private final Map<String, ServerGame> gamesBySession = new ConcurrentHashMap<>();

    private final GameSessionDao gameSessionDao;
    private final PlayerDao playerDao;

    public GameSessionManager(GameSessionDao gameSessionDao, PlayerDao playerDao) {
        this.gameSessionDao = gameSessionDao;
        this.playerDao = playerDao;
    }

    /**
     * Create, persist and start a new match between two authenticated clients.
     * The first argument plays X (moves first).
     */
    public void startGame(ClientSession playerX, ClientSession playerO) throws SQLException {
        long dbId = gameSessionDao.createInProgress(
                playerX.getPlayer().id(), playerO.getPlayer().id());
        ServerGame gameSession =
                new ServerGame(dbId, playerX, playerO, gameSessionDao, playerDao);
        gamesBySession.put(playerX.getSessionId(), gameSession);
        gamesBySession.put(playerO.getSessionId(), gameSession);
        log.info("Started game {} : {} (X) vs {} (O)",
                dbId, playerX.getPlayer().username(), playerO.getPlayer().username());
        gameSession.start();
    }

    public void handleMove(ClientSession session, int cell) {
        ServerGame game = gamesBySession.get(session.getSessionId());
        if (game == null) {
            return; // not in a game; ignore stray move
        }
        game.handleMove(session, cell);
        if (game.isFinished()) {
            forget(game);
        }
    }

    public void handleChat(ClientSession session, String text) {
        ServerGame game = gamesBySession.get(session.getSessionId());
        if (game != null) {
            game.relayChat(session, text);
        }
    }

    /** Called when a client disconnects; cleans up any game it was in. */
    public void handleDisconnect(ClientSession session) {
        ServerGame game = gamesBySession.remove(session.getSessionId());
        if (game != null) {
            game.handleDisconnect(session);
            forget(game);
        }
    }

    public boolean isInGame(ClientSession session) {
        return gamesBySession.containsKey(session.getSessionId());
    }

    private void forget(ServerGame game) {
        gamesBySession.values().removeIf(g -> g == game);
    }
}
