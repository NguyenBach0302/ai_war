package com.example.game.server.net;

import com.example.game.server.ServerConfig;
import com.example.game.server.ServerContext;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.IOException;
import java.net.ServerSocket;
import java.net.Socket;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

/**
 * The TCP front door. Binds a {@link ServerSocket}, accepts connections in a
 * loop and submits each to a fixed-size {@link ExecutorService} thread pool —
 * never a raw {@code new Thread()} per client. The pool bounds resource use and
 * gives the connections a managed lifecycle.
 *
 * <p>The accept loop runs on the calling thread; {@link #stop()} unblocks it by
 * closing the server socket and then drains the pool.
 */
public final class GameServer {

    private static final Logger log = LoggerFactory.getLogger(GameServer.class);

    private final ServerConfig config;
    private final ServerContext context;
    private final MessageRouter router;
    private final ExecutorService clientPool;

    private volatile boolean running = false;
    private ServerSocket serverSocket;

    public GameServer(ServerConfig config, ServerContext context) {
        this.config = config;
        this.context = context;
        this.router = new MessageRouter(context);
        this.clientPool = Executors.newFixedThreadPool(
                config.threadPoolSize(),
                namedDaemonThreadFactory());
    }

    /** Bind and run the accept loop until {@link #stop()} is called. Blocking. */
    public void start() throws IOException {
        serverSocket = new ServerSocket(config.port());
        running = true;
        log.info("Game server listening on port {}", config.port());

        while (running) {
            try {
                Socket socket = serverSocket.accept();
                socket.setTcpNoDelay(true); // low latency for small game frames
                ClientSession session = new ClientSession(socket);
                clientPool.submit(new ClientHandler(session, context, router));
            } catch (IOException e) {
                if (running) {
                    log.warn("Failed to accept connection", e);
                } // else: socket closed by stop(); exit quietly
            }
        }
    }

    /** Stop accepting, interrupt handlers and release resources. */
    public void stop() {
        running = false;
        try {
            if (serverSocket != null) {
                serverSocket.close();
            }
        } catch (IOException e) {
            log.warn("Error closing server socket", e);
        }
        clientPool.shutdownNow();
        try {
            if (!clientPool.awaitTermination(5, TimeUnit.SECONDS)) {
                log.warn("Client pool did not terminate cleanly.");
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        log.info("Game server stopped.");
    }

    private static java.util.concurrent.ThreadFactory namedDaemonThreadFactory() {
        return new java.util.concurrent.ThreadFactory() {
            private int counter = 0;

            @Override
            public synchronized Thread newThread(Runnable r) {
                Thread t = new Thread(r, "client-handler-" + (counter++));
                t.setDaemon(true);
                return t;
            }
        };
    }
}
