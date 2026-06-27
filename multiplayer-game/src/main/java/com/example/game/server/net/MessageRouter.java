package com.example.game.server.net;

import com.example.game.common.protocol.Message;
import com.example.game.common.protocol.MessageType;
import com.example.game.server.ServerContext;
import com.example.game.server.data.DuplicateUsernameException;
import com.example.game.server.data.Player;
import com.example.game.server.service.AuthenticationException;
import com.example.game.server.service.InvalidInputException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.sql.SQLException;

/**
 * Translates an incoming {@link Message} into the appropriate service call for a
 * given {@link ClientSession}. This is the single dispatch point between the
 * network layer and the service layer — handlers stay thin and the protocol
 * surface is visible in one switch.
 *
 * <p>Stateless and shared across all connections; per-client state lives on the
 * {@link ClientSession}.
 */
public final class MessageRouter {

    private static final Logger log = LoggerFactory.getLogger(MessageRouter.class);

    private final ServerContext ctx;

    public MessageRouter(ServerContext ctx) {
        this.ctx = ctx;
    }

    public void route(ClientSession session, Message msg) {
        MessageType type = msg.getType();
        if (type == null) {
            session.send(error("Missing message type."));
            return;
        }

        // Gate everything except auth/ping behind authentication.
        if (!session.isAuthenticated()
                && type != MessageType.LOGIN
                && type != MessageType.REGISTER
                && type != MessageType.PING) {
            session.send(error("You must log in first."));
            return;
        }

        try {
            switch (type) {
                case REGISTER -> handleRegister(session, msg);
                case LOGIN -> handleLogin(session, msg);
                case FIND_MATCH -> ctx.matchmakingService().findMatch(session);
                case CANCEL_MATCH -> ctx.matchmakingService().cancel(session);
                case MAKE_MOVE -> ctx.gameSessionManager()
                        .handleMove(session, msg.getInt("cell", -1));
                case CHAT -> handleChat(session, msg);
                case PING -> session.send(Message.of(MessageType.PONG));
                default -> session.send(error("Unsupported message type: " + type));
            }
        } catch (InvalidInputException | AuthenticationException | DuplicateUsernameException e) {
            // Expected, client-facing failures: relay the message.
            session.send(error(e.getMessage()));
        } catch (SQLException e) {
            log.error("Database error handling {} from {}", type, session, e);
            session.send(error("A server error occurred. Please try again."));
        }
    }

    private void handleRegister(ClientSession session, Message msg) throws SQLException {
        Player player = ctx.authService()
                .register(msg.getString("username"), msg.getString("password"));
        bindAndAck(session, player);
    }

    private void handleLogin(ClientSession session, Message msg) throws SQLException {
        Player player = ctx.authService()
                .login(msg.getString("username"), msg.getString("password"));
        bindAndAck(session, player);
    }

    private void bindAndAck(ClientSession session, Player player) {
        session.setPlayer(player);
        session.send(Message.of(MessageType.LOGIN_OK)
                .with("playerId", player.id())
                .with("username", player.username())
                .with("wins", player.wins())
                .with("losses", player.losses())
                .with("draws", player.draws()));
        log.info("{} authenticated", player.username());
    }

    private void handleChat(ClientSession session, Message msg) {
        String text = msg.getString("text");
        if (text == null || text.isBlank()) {
            return;
        }
        // Trim to a sane length; never trust client-provided sizes.
        String trimmed = text.length() > 500 ? text.substring(0, 500) : text;
        ctx.gameSessionManager().handleChat(session, trimmed);
    }

    private Message error(String message) {
        return Message.of(MessageType.ERROR).with("message", message);
    }
}
