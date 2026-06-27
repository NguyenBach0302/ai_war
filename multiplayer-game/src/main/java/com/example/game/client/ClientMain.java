package com.example.game.client;

import javafx.application.Application;
import javafx.scene.Scene;
import javafx.scene.layout.StackPane;
import javafx.stage.Stage;

/**
 * JavaFX {@link Application} for the client. Kept deliberately thin: it builds
 * the window and delegates all behaviour to {@link GameClientController}. Launch
 * via {@link ClientLauncher} (or {@code mvn javafx:run}).
 */
public final class ClientMain extends Application {

    private GameClientController controller;

    @Override
    public void start(Stage stage) {
        ClientConfig config = ClientConfig.fromSystemProperties();

        StackPane root = new StackPane();
        controller = new GameClientController(config, root);
        controller.init();

        stage.setScene(new Scene(root, 760, 560));
        stage.setTitle("Networked Tic-Tac-Toe");
        stage.show();
    }

    @Override
    public void stop() {
        // Called by JavaFX on window close — tear down the network thread.
        if (controller != null) {
            controller.shutdown();
        }
    }
}
