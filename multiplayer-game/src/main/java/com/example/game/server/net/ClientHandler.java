package com.example.game.server.net;

import com.example.game.common.protocol.Codec;
import com.example.game.common.protocol.Message;
import com.example.game.server.ServerContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;

/**
 * Drives a single client connection: reads newline-delimited JSON frames in a
 * loop and hands each to the {@link MessageRouter}. One instance runs on one
 * thread borrowed from the server's {@link java.util.concurrent.ExecutorService}
 * for the lifetime of the connection.
 *
 * <p>On any I/O failure or end-of-stream the loop exits and {@link #cleanup}
 * releases the player from matchmaking and any active game — so a dropped
 * client never leaves dangling server state.
 */
public final class ClientHandler implements Runnable {

    private static final Logger log = LoggerFactory.getLogger(ClientHandler.class);

    private final ClientSession session;
    private final ServerContext ctx;
    private final MessageRouter router;

    public ClientHandler(ClientSession session, ServerContext ctx, MessageRouter router) {
        this.session = session;
        this.ctx = ctx;
        this.router = router;
    }

    @Override
    public void run() {
        log.info("Client connected: {}", session);
        try {
            String line;
            while ((line = session.readLine()) != null) {
                if (line.isBlank()) {
                    continue;
                }
                handleLine(line);
            }
        } catch (IOException e) {
            log.debug("Connection lost for {}: {}", session, e.toString());
        } finally {
            cleanup();
        }
    }

    private void handleLine(String line) {
        Message msg;
        try {
            msg = Codec.decode(line);
        } catch (IOException e) {
            // Malformed frame: report but keep the connection open.
            session.send(Message.of(com.example.game.common.protocol.MessageType.ERROR)
                    .with("message", "Malformed message."));
            return;
        }
        router.route(session, msg);
    }

    private void cleanup() {
        // Release the player from any queue/game before closing the socket.
        ctx.matchmakingService().cancel(session);
        ctx.gameSessionManager().handleDisconnect(session);
        session.close();
        log.info("Client disconnected: {}", session);
    }
}
