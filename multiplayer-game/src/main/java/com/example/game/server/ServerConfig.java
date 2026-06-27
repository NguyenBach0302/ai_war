package com.example.game.server;

/**
 * Immutable server configuration. Values are read from system properties (with
 * sensible defaults) so the server can be tuned without code changes:
 *
 * <pre>
 *   mvn -Pserver exec:java -Dgame.port=6000 -Dgame.poolSize=8
 * </pre>
 */
public record ServerConfig(
        int port,
        int threadPoolSize,
        String jdbcUrl,
        String dbUser,
        String dbPassword,
        int dbPoolSize
) {

    public static ServerConfig fromSystemProperties() {
        return new ServerConfig(
                intProp("game.port", 5555),
                // Each connected client occupies one pooled thread for its
                // lifetime (blocking socket I/O), so this caps concurrent clients.
                intProp("game.threadPoolSize", 200),
                System.getProperty("game.jdbcUrl", "jdbc:h2:./data/game;AUTO_SERVER=TRUE"),
                System.getProperty("game.dbUser", "sa"),
                System.getProperty("game.dbPassword", ""),
                intProp("game.dbPoolSize", 10));
    }

    private static int intProp(String key, int defaultValue) {
        String raw = System.getProperty(key);
        if (raw == null) {
            return defaultValue;
        }
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            return defaultValue;
        }
    }
}
