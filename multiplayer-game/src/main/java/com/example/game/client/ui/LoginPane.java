package com.example.game.client.ui;

import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.PasswordField;
import javafx.scene.control.TextField;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;

/**
 * Login / registration screen. Pure view: it collects input and forwards intent
 * through a {@link Listener}; it performs no networking and holds no game state.
 *
 * <p>All methods are expected to be called on the JavaFX Application Thread.
 */
public final class LoginPane extends VBox {

    /** Callbacks the controller implements to react to button presses. */
    public interface Listener {
        void onLogin(String username, String password);

        void onRegister(String username, String password);
    }

    private final TextField usernameField = new TextField();
    private final PasswordField passwordField = new PasswordField();
    private final Label statusLabel = new Label();
    private final Button loginButton = new Button("Log in");
    private final Button registerButton = new Button("Register");

    public LoginPane(Listener listener) {
        setSpacing(12);
        setPadding(new Insets(40));
        setAlignment(Pos.CENTER);

        Label title = new Label("Tic-Tac-Toe");
        title.setStyle("-fx-font-size: 24px; -fx-font-weight: bold;");

        usernameField.setPromptText("Username (3-32 chars)");
        usernameField.setMaxWidth(260);
        passwordField.setPromptText("Password (min 6 chars)");
        passwordField.setMaxWidth(260);

        statusLabel.setWrapText(true);
        statusLabel.setStyle("-fx-text-fill: #b00020;");

        loginButton.setDefaultButton(true);
        loginButton.setOnAction(e -> listener.onLogin(
                usernameField.getText().trim(), passwordField.getText()));
        registerButton.setOnAction(e -> listener.onRegister(
                usernameField.getText().trim(), passwordField.getText()));

        HBox buttons = new HBox(10, loginButton, registerButton);
        buttons.setAlignment(Pos.CENTER);

        getChildren().addAll(title, usernameField, passwordField, buttons, statusLabel);
    }

    /** Show an error/info message under the form. */
    public void setStatus(String message) {
        statusLabel.setText(message == null ? "" : message);
    }

    /** Disable inputs while a request is in flight or the link is down. */
    public void setInputDisabled(boolean disabled) {
        usernameField.setDisable(disabled);
        passwordField.setDisable(disabled);
        loginButton.setDisable(disabled);
        registerButton.setDisable(disabled);
    }
}
