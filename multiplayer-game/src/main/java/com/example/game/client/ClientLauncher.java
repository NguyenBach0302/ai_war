package com.example.game.client;

import javafx.application.Application;

/**
 * Plain (non-{@link Application}) entry point for the JavaFX client.
 *
 * <p>Launching JavaFX from a main class that does <em>not</em> extend
 * {@link Application} is the standard way to start the app from a regular
 * (non-modular) classpath/fat-jar without hitting the
 * "JavaFX runtime components are missing" error. {@code mvn javafx:run} uses
 * this as the {@code mainClass}.
 */
public final class ClientLauncher {
    public static void main(String[] args) {
        Application.launch(ClientMain.class, args);
    }
}
