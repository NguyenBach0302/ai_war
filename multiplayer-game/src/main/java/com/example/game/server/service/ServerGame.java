package com.example.game.server.service;

import com.example.game.common.model.GameStatus;
import com.example.game.common.model.Mark;
import com.example.game.common.protocol.Message;
import com.example.game.common.protocol.MessageType;
import com.example.game.server.data.GameSessionDao;
import com.example.game.server.data.PlayerDao;
import com.example.game.server.game.IllegalMoveException;
import com.example.game.server.game.TicTacToe;
import com.example.game.server.net.ClientSession;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.SQLException;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * A live match between two connected clients. Wraps the pure {@link TicTacToe}
 * rules engine and is responsible for:
 * <ul>
 *   <li>mapping each {@link ClientSession} to its {@link Mark},</li>
 *   <li>applying validated moves and broadcasting authoritative state,</li>
 *   <li>persisting the result and updating player stats when it ends.</li>
 * </ul>
 *
 * <p>The server is authoritative: a move is only accepted if the rules engine
 * accepts it. All mutating methods are {@code synchronized} so the two players'
 * handler threads can never interleave on the same game.
 */
public final class ServerGame {

    private static final Logger log = LoggerFactory.getLogger(ServerGame.class);

    private final long dbSessionId;
    private final ClientSession playerX;
    private final ClientSession playerO;
    private final TicTacToe game = new TicTacToe();

    private final GameSessionDao gameSessionDao;
    private final PlayerDao playerDao;

    private boolean finished = false;

    ServerGame(long dbSessionId,
               ClientSession playerX,
               ClientSession playerO,
               GameSessionDao gameSessionDao,
               PlayerDao playerDao) {
        this.dbSessionId = dbSessionId;
        this.playerX = playerX;
        this.playerO = playerO;
        this.gameSessionDao = gameSessionDao;
        this.playerDao = playerDao;
    }

    public long getDbSessionId() {
        return dbSessionId;
    }

    synchronized boolean isFinished() {
        return finished;
    }

    boolean involves(ClientSession session) {
        return session == playerX || session == playerO;
    }

    /** Notify both players that the match has begun and push the empty board. */
    synchronized void start() {
        playerX.send(Message.of(MessageType.MATCH_FOUND)
                .with("gameId", dbSessionId)
                .with("yourMark", Mark.X.name())
                .with("opponent", playerO.getPlayer().username()));
        playerO.send(Message.of(MessageType.MATCH_FOUND)
                .with("gameId", dbSessionId)
                .with("yourMark", Mark.O.name())
                .with("opponent", playerX.getPlayer().username()));
        broadcastState();
    }

    /**
     * Apply a move requested by {@code session}. Illegal moves are rejected with
     * an {@link MessageType#ERROR} sent only to the offender; the game state is
     * unchanged.
     */
    synchronized void handleMove(ClientSession session, int cell) {
        if (finished) {
            session.send(error("The game is already over."));
            return;
        }
        Mark mark = markOf(session);
        try {
            game.makeMove(cell, mark);
        } catch (IllegalMoveException e) {
            session.send(error(e.getMessage()));
            return;
        }

        if (game.getStatus().isTerminal()) {
            broadcastGameOver();
            persistResult();
            finished = true;
        } else {
            broadcastState();
        }
    }

    /** Relay a chat line from one player to the other. */
    synchronized void relayChat(ClientSession from, String text) {
        ClientSession other = (from == playerX) ? playerO : playerX;
        other.send(Message.of(MessageType.CHAT_MESSAGE)
                .with("from", from.getPlayer().username())
                .with("text", text));
    }

    /**
     * Handle a participant disconnecting mid-game: tell the opponent and close
     * the match out. Returns true if the game was still running.
     */
    synchronized boolean handleDisconnect(ClientSession gone) {
        if (finished) {
            return false;
        }
        ClientSession other = (gone == playerX) ? playerO : playerX;
        other.send(Message.of(MessageType.OPPONENT_LEFT)
                .with("message", "Your opponent left the game."));
        finished = true;
        return true;
    }

    // ----- helpers -----

    private Mark markOf(ClientSession session) {
        return (session == playerX) ? Mark.X : Mark.O;
    }

    private void broadcastState() {
        Message state = Message.of(MessageType.GAME_STATE)
                .with("board", boardAsList())
                .with("nextTurn", game.getNextTurn().name());
        playerX.send(state);
        playerO.send(state);
    }

    private void broadcastGameOver() {
        GameStatus status = game.getStatus();
        Mark winner = switch (status) {
            case X_WON -> Mark.X;
            case O_WON -> Mark.O;
            default -> Mark.EMPTY;
        };
        Message over = Message.of(MessageType.GAME_OVER)
                .with("board", boardAsList())
                .with("result", status.name())
                .with("winnerMark", winner.name());
        playerX.send(over);
        playerO.send(over);
    }

    private List<String> boardAsList() {
        return Arrays.stream(game.getBoard())
                .map(Mark::name)
                .collect(Collectors.toList());
    }

    private void persistResult() {
        GameStatus status = game.getStatus();
        long xId = playerX.getPlayer().id();
        long oId = playerO.getPlayer().id();
        Long winnerId = switch (status) {
            case X_WON -> xId;
            case O_WON -> oId;
            default -> null;
        };
        try {
            gameSessionDao.finish(dbSessionId, status, winnerId, game.serializeBoard());
            switch (status) {
                case X_WON -> {
                    playerDao.recordOutcome(xId, PlayerDao.Outcome.WIN);
                    playerDao.recordOutcome(oId, PlayerDao.Outcome.LOSS);
                }
                case O_WON -> {
                    playerDao.recordOutcome(oId, PlayerDao.Outcome.WIN);
                    playerDao.recordOutcome(xId, PlayerDao.Outcome.LOSS);
                }
                case DRAW -> {
                    playerDao.recordOutcome(xId, PlayerDao.Outcome.DRAW);
                    playerDao.recordOutcome(oId, PlayerDao.Outcome.DRAW);
                }
                default -> { /* unreachable: status is terminal here */ }
            }
        } catch (SQLException e) {
            log.error("Failed to persist result for game {}", dbSessionId, e);
        }
    }

    private Message error(String message) {
        return Message.of(MessageType.ERROR).with("message", message);
    }
}
