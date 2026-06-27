package com.example.game.client.net;

import com.example.game.common.protocol.Codec;
import com.example.game.common.protocol.Message;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.net.InetSocketAddress;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.function.Consumer;

/**
 * Client-side TCP connection to the game server, with automatic reconnection.
 *
 * <p>A single background thread owns the socket and runs the read loop. When the
 * socket drops unexpectedly it retries with capped exponential backoff until it
 * reconnects or {@link #close()} is called. Connection-state transitions and
 * decoded messages are delivered through callbacks.
 *
 * <p><strong>Threading contract:</strong> callbacks fire on the network thread,
 * <em>not</em> the JavaFX Application Thread. Consumers that touch the UI must
 * marshal onto the FX thread themselves (the controller wraps them in
 * {@link javafx.application.Platform#runLater}). This keeps the network layer
 * free of any UI dependency.
 */
public final class ServerConnection {

    private static final Logger log = LoggerFactory.getLogger(ServerConnection.class);

    private static final long INITIAL_BACKOFF_MS = 1_000;
    private static final long MAX_BACKOFF_MS = 15_000;
    private static final int CONNECT_TIMEOUT_MS = 5_000;

    private final String host;
    private final int port;

    private final Consumer<Message> messageListener;
    private final Consumer<ConnectionState> stateListener;
    /** Invoked after a (re)connection succeeds, so callers can re-authenticate. */
    private final Runnable onConnected;

    private final ExecutorService networkExecutor =
            Executors.newSingleThreadExecutor(r -> {
                Thread t = new Thread(r, "client-network");
                t.setDaemon(true);
                return t;
            });

    private final Object writeLock = new Object();
    private volatile Socket socket;
    private volatile BufferedWriter out;
    private volatile boolean closed = false;

    public ServerConnection(String host,
                            int port,
                            Consumer<Message> messageListener,
                            Consumer<ConnectionState> stateListener,
                            Runnable onConnected) {
        this.host = host;
        this.port = port;
        this.messageListener = messageListener;
        this.stateListener = stateListener;
        this.onConnected = onConnected;
    }

    /** Begin connecting (and stay connected) on the background thread. */
    public void start() {
        networkExecutor.submit(this::connectionLoop);
    }

    /**
     * Send a message. Safe to call from any thread. If currently disconnected,
     * the send is dropped (the caller will get a state callback and can retry);
     * we never block the FX thread waiting for the socket.
     */
    public void send(Message message) {
        BufferedWriter writer = this.out;
        if (writer == null) {
            log.debug("Dropping {} — not connected", message.getType());
            return;
        }
        try {
            String line = Codec.encode(message);
            synchronized (writeLock) {
                writer.write(line);
                writer.write('\n');
                writer.flush();
            }
        } catch (IOException e) {
            log.debug("Send failed: {}", e.toString());
            // The read loop will detect the drop and trigger reconnect.
        }
    }

    /** Permanently close the connection; stops reconnection attempts. */
    public void close() {
        closed = true;
        closeSocketQuietly();
        networkExecutor.shutdownNow();
    }

    // ----- background thread -----

    private void connectionLoop() {
        long backoff = INITIAL_BACKOFF_MS;
        boolean firstAttempt = true;

        while (!closed) {
            stateListener.accept(firstAttempt ? ConnectionState.CONNECTING
                    : ConnectionState.RECONNECTING);
            try {
                openSocket();
                backoff = INITIAL_BACKOFF_MS; // reset on success
                stateListener.accept(ConnectionState.CONNECTED);
                onConnected.run();            // e.g. re-send login
                readLoop();                   // blocks until the socket drops
            } catch (IOException e) {
                log.debug("Connection attempt failed: {}", e.toString());
            }

            if (closed) {
                break;
            }

            stateListener.accept(ConnectionState.DISCONNECTED);
            sleep(backoff);
            backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
            firstAttempt = false;
        }
        stateListener.accept(ConnectionState.DISCONNECTED);
    }

    private void openSocket() throws IOException {
        Socket s = new Socket();
        s.connect(new InetSocketAddress(host, port), CONNECT_TIMEOUT_MS);
        s.setTcpNoDelay(true);
        this.socket = s;
        this.out = new BufferedWriter(
                new OutputStreamWriter(s.getOutputStream(), StandardCharsets.UTF_8));
        log.info("Connected to {}:{}", host, port);
    }

    private void readLoop() throws IOException {
        BufferedReader in = new BufferedReader(
                new InputStreamReader(socket.getInputStream(), StandardCharsets.UTF_8));
        String line;
        while ((line = in.readLine()) != null) {
            if (line.isBlank()) {
                continue;
            }
            try {
                messageListener.accept(Codec.decode(line));
            } catch (IOException parseError) {
                log.warn("Received malformed frame: {}", line);
            }
        }
        // null line => server closed the stream cleanly; fall through to reconnect.
        this.out = null;
    }

    private void closeSocketQuietly() {
        Socket s = this.socket;
        if (s != null) {
            try {
                s.close();
            } catch (IOException ignored) {
                // best-effort
            }
        }
        this.out = null;
    }

    private void sleep(long ms) {
        try {
            Thread.sleep(ms);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
    }
}
