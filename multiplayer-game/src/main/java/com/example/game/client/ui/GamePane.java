package com.example.game.client.ui;

import com.example.game.common.model.Mark;
import javafx.geometry.Insets;
import javafx.geometry.Pos;
import javafx.scene.control.Button;
import javafx.scene.control.Label;
import javafx.scene.control.TextArea;
import javafx.scene.control.TextField;
import javafx.scene.layout.BorderPane;
import javafx.scene.layout.GridPane;
import javafx.scene.layout.HBox;
import javafx.scene.layout.VBox;

import java.util.List;

/**
 * The in-game screen: a 3×3 board, a status line, a "find match" button and a
 * simple chat panel. Pure view — it renders state pushed by the controller and
 * forwards clicks via the {@link Listener}.
 *
 * <p>All mutators must be called on the JavaFX Application Thread.
 */
public final class GamePane extends BorderPane {

    public interface Listener {
        void onFindMatch();

        void onCellClicked(int cell);

        void onSendChat(String text);
    }

    private final Button[] cells = new Button[9];
    private final Label statusLabel = new Label("Welcome!");
    private final Label connectionLabel = new Label();
    private final Button findMatchButton = new Button("Find Match");
    private final TextArea chatLog = new TextArea();
    private final TextField chatInput = new TextField();

    private final Listener listener;

    public GamePane(Listener listener) {
        this.listener = listener;
        setPadding(new Insets(16));
        setTop(buildHeader());
        setCenter(buildBoard());
        setRight(buildChat());
        setBoardEnabled(false);
    }

    private VBox buildHeader() {
        statusLabel.setStyle("-fx-font-size: 16px; -fx-font-weight: bold;");
        connectionLabel.setStyle("-fx-text-fill: #666;");
        findMatchButton.setOnAction(e -> listener.onFindMatch());
        HBox row = new HBox(16, findMatchButton, connectionLabel);
        row.setAlignment(Pos.CENTER_LEFT);
        VBox header = new VBox(8, statusLabel, row);
        header.setPadding(new Insets(0, 0, 12, 0));
        return header;
    }

    private GridPane buildBoard() {
        GridPane grid = new GridPane();
        grid.setHgap(6);
        grid.setVgap(6);
        grid.setAlignment(Pos.CENTER);
        for (int i = 0; i < 9; i++) {
            final int index = i;
            Button cell = new Button(" ");
            cell.setPrefSize(96, 96);
            cell.setStyle("-fx-font-size: 36px; -fx-font-weight: bold;");
            cell.setOnAction(e -> listener.onCellClicked(index));
            cells[i] = cell;
            grid.add(cell, i % 3, i / 3);
        }
        return grid;
    }

    private VBox buildChat() {
        chatLog.setEditable(false);
        chatLog.setPrefWidth(220);
        chatLog.setWrapText(true);
        chatInput.setPromptText("Message…");
        chatInput.setOnAction(e -> {
            String text = chatInput.getText().trim();
            if (!text.isEmpty()) {
                listener.onSendChat(text);
                chatInput.clear();
            }
        });
        VBox box = new VBox(8, new Label("Chat"), chatLog, chatInput);
        box.setPadding(new Insets(0, 0, 0, 16));
        return box;
    }

    // ----- controller-facing mutators (FX thread only) -----

    public void setStatus(String text) {
        statusLabel.setText(text);
    }

    public void setConnectionStatus(String text) {
        connectionLabel.setText(text);
    }

    public void setFindMatchEnabled(boolean enabled) {
        findMatchButton.setDisable(!enabled);
    }

    /** Render the board from a list of nine {@link Mark} names. */
    public void renderBoard(List<String> marks) {
        for (int i = 0; i < 9 && i < marks.size(); i++) {
            Mark mark = Mark.valueOf(marks.get(i));
            cells[i].setText(mark == Mark.EMPTY ? " " : mark.name());
            // A filled cell can never be played again.
            cells[i].setDisable(mark != Mark.EMPTY);
        }
    }

    public void clearBoard() {
        for (Button cell : cells) {
            cell.setText(" ");
            cell.setDisable(true);
        }
    }

    /** Enable/disable empty cells (used to gate input to the player's turn). */
    public void setBoardEnabled(boolean enabled) {
        for (Button cell : cells) {
            boolean empty = cell.getText().isBlank();
            cell.setDisable(!(enabled && empty));
        }
    }

    public void appendChat(String who, String text) {
        chatLog.appendText(who + ": " + text + "\n");
    }
}
