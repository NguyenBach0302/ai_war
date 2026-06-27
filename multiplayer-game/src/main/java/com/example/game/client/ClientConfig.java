package com.example.game.client;

/**
 * Client connection settings, read from system properties so the host/port can
 * be overridden at launch:
 *
 * <pre>
 *   mvn javafx:run -Dgame.host=192.168.1.10 -Dgame.port=6000
 * </pre>
 */
public record ClientConfig(String host, int port) {

    public static ClientConfig fromSystemProperties() {
        String host = System.getProperty("game.host", "localhost");
        int port;
        try {
            port = Integer.parseInt(System.getProperty("game.port", "5555").trim());
        } catch (NumberFormatException e) {
            port = 5555;
        }
        return new ClientConfig(host, port);
    }
}
