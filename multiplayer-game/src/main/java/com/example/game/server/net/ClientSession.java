package com.example.game.server.net;

import com.example.game.common.protocol.Codec;
import com.example.game.common.protocol.Message;
import com.example.game.server.data.Player;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

/**
 * Represents one connected client: its socket, buffered I/O streams and
 * authentication state. One {@link ClientSession} is created per accepted
 * connection and driven by a single {@link ClientHandler} thread.
 *
 * <p>{@link #send(Message)} is thread safe (guarded by {@link #writeLock}) so
 * that other threads — e.g. the opponent's handler pushing a board update — can
 * write to this client without corrupting the stream.
 */
public final class ClientSession {

    private static final Logger log = LoggerFactory.getLogger(ClientSession.class);

    private final String sessionId = UUID.randomUUID().toString();
    private final Socket socket;
    private final BufferedReader in;
    private final BufferedWriter out;
    private final Object writeLock = new Object();

    /** Null until the client authenticates; set once on login/register. */
    private volatile Player player;

    public ClientSession(Socket socket) throws IOException {
        this.socket = socket;
        this.in = new BufferedReader(
                new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        this.out = new BufferedWriter(
                new OutputStreamWriter(socket.getOutputStream(), StandardCharsets.UTF_8));
    }

    /** Block until the next line/frame arrives, or {@code null} at end of stream. */
    public String readLine() throws IOException {
        return in.readLine();
    }

    /** Encode and write one message, flushing immediately. Thread safe. */
    public void send(Message message) {
        try {
            String line = Codec.encode(message);
            synchronized (writeLock) {
                out.write(line);
                out.write('\n');
                out.flush();
            }
        } catch (IOException e) {
            // A failed write usually means the client vanished; the read loop
            // will observe EOF and tear the session down.
            log.debug("Failed to send {} to {}: {}", message.getType(), this, e.toString());
        }
    }

    public boolean isAuthenticated() {
        return player != null;
    }

    public Player getPlayer() {
        return player;
    }

    public void setPlayer(Player player) {
        this.player = player;
    }

    public String getSessionId() {
        return sessionId;
    }

    /** Close the socket; idempotent. */
    public void close() {
        try {
            socket.close();
        } catch (IOException ignored) {
            // best-effort
        }
    }

    @Override
    public String toString() {
        String who = (player != null) ? player.username() : "anonymous";
        return "ClientSession[" + who + "@" + socket.getRemoteSocketAddress() + "]";
    }
}
