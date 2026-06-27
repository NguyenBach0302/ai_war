package com.example.game.server.service;

import com.example.game.common.protocol.Message;
import com.example.game.common.protocol.MessageType;
import com.example.game.server.net.ClientSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.SQLException;
import java.util.ArrayDeque;
import java.util.Deque;

/**
 * Pairs waiting players into games (first-come, first-served). A single FIFO
 * queue holds players who have requested a match but not yet been paired.
 *
 * <p>Access to the queue is synchronized; the (potentially slow) game creation
 * — which touches the database — is performed outside the lock so matchmaking
 * for other players is never blocked on I/O.
 */
public final class MatchmakingService {

    private static final Logger log = LoggerFactory.getLogger(MatchmakingService.class);

    private final Deque<ClientSession> queue = new ArrayDeque<>();
    private final GameSessionManager gameSessionManager;

    public MatchmakingService(GameSessionManager gameSessionManager) {
        this.gameSessionManager = gameSessionManager;
    }

    /**
     * Enqueue a player. If an opponent is already waiting, a game starts
     * immediately; otherwise the player waits for the next arrival.
     */
    public void findMatch(ClientSession session) {
        if (gameSessionManager.isInGame(session)) {
            session.send(error("You are already in a game."));
            return;
        }

        ClientSession opponent = null;
        synchronized (queue) {
            if (queue.contains(session)) {
                return; // already queued; ignore duplicate request
            }
            ClientSession head = queue.peek();
            if (head != null && head != session) {
                opponent = queue.poll();
            } else {
                queue.offer(session);
            }
        }

        if (opponent == null) {
            session.send(Message.of(MessageType.ERROR)
                    .with("message", "Waiting for an opponent..."));
            return;
        }

        // Pair found — create the game outside the lock.
        try {
            gameSessionManager.startGame(opponent, session);
        } catch (SQLException e) {
            log.error("Failed to start game", e);
            opponent.send(error("Could not start the game. Please try again."));
            session.send(error("Could not start the game. Please try again."));
        }
    }

    /** Remove a player from the queue (explicit cancel or disconnect). */
    public void cancel(ClientSession session) {
        synchronized (queue) {
            queue.remove(session);
        }
    }

    private Message error(String message) {
        return Message.of(MessageType.ERROR).with("message", message);
    }
}
