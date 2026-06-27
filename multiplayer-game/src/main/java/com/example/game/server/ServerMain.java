package com.example.game.server;

import com.example.game.server.net.GameServer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Server entry point. Wires the composition root ({@link ServerContext}), starts
 * the {@link GameServer} accept loop, and registers a shutdown hook for clean
 * teardown of the thread pool and DB connection pool.
 *
 * <p>Run with: {@code mvn -Pserver compile exec:java}
 */
public final class ServerMain {

    private static final Logger log = LoggerFactory.getLogger(ServerMain.class);

    public static void main(String[] args) {
        ServerConfig config = ServerConfig.fromSystemProperties();
        ServerContext context = new ServerContext(config);
        GameServer server = new GameServer(config, context);

        Runtime.getRuntime().addShutdownHook(new Thread(() -> {
            log.info("Shutting down...");
            server.stop();
            context.close();
        }, "shutdown-hook"));

        try {
            server.start(); // blocks until stop()
        } catch (Exception e) {
            log.error("Server terminated abnormally", e);
            context.close();
            System.exit(1);
        }
    }
}
