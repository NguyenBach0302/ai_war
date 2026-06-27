package com.example.game.client;

import com.example.game.client.net.ConnectionState;
import com.example.game.client.net.ServerConnection;
import com.example.game.client.ui.GamePane;
import com.example.game.client.ui.LoginPane;
import com.example.game.common.model.Mark;
import com.example.game.common.protocol.Message;
import com.example.game.common.protocol.MessageType;
import javafx.application.Platform;
import javafx.scene.layout.StackPane;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.List;

/**
 * Mediates between the {@link ServerConnection} (network layer) and the JavaFX
 * views (UI layer). It is the only place the two meet, which keeps both sides
 * ignorant of each other.
 *
 * <p><strong>Threading:</strong> the connection invokes
 * {@link #onMessage}/{@link #onState} on the network thread. This class is the
 * boundary that hops onto the JavaFX Application Thread via
 * {@link Platform#runLater} before touching any {@code Node}. User-initiated
 * actions run on the FX thread and only ever call the non-blocking
 * {@link ServerConnection#send}, so the FX thread is never blocked on I/O.
 */
public final class GameClientController implements LoginPane.Listener, GamePane.Listener {

    private static final Logger log = LoggerFactory.getLogger(GameClientController.class);

    private final ClientConfig config;
    private final StackPane root;

    private LoginPane loginPane;
    private GamePane gamePane;
    private ServerConnection connection;

    // ----- session state (FX thread) -----
    private Mark myMark = Mark.EMPTY;
    private boolean loggedIn = false;

    // ----- credentials cached for transparent re-login on reconnect (net thread reads) -----
    private volatile String username;
    private volatile String password;

    public GameClientController(ClientConfig config, StackPane root) {
        this.config = config;
        this.root = root;
    }

    /** Build the views, show the login screen, and start connecting. */
    public void init() {
        this.loginPane = new LoginPane(this);
        this.gamePane = new GamePane(this);
        root.getChildren().add(loginPane);

        this.connection = new ServerConnection(
                config.host(), config.port(),
                this::onMessage,     // network thread
                this::onState,       // network thread
                this::onConnected);  // network thread
        connection.start();
    }

    public void shutdown() {
        if (connection != null) {
            connection.close();
        }
    }

    // ===================== LoginPane.Listener (FX thread) =====================

    @Override
    public void onLogin(String username, String password) {
        this.username = username;
        this.password = password;
        connection.send(Message.of(MessageType.LOGIN)
                .with("username", username)
                .with("password", password));
    }

    @Override
    public void onRegister(String username, String password) {
        this.username = username;
        this.password = password;
        connection.send(Message.of(MessageType.REGISTER)
                .with("username", username)
                .with("password", password));
    }

    // ===================== GamePane.Listener (FX thread) =====================

    @Override
    public void onFindMatch() {
        myMark = Mark.EMPTY;
        gamePane.clearBoard();
        gamePane.setStatus("Searching for an opponent…");
        gamePane.setFindMatchEnabled(false);
        connection.send(Message.of(MessageType.FIND_MATCH));
    }

    @Override
    public void onCellClicked(int cell) {
        // Optimistically send; the server is authoritative and will reject if
        // it is not actually our turn. We also gate input via setBoardEnabled.
        connection.send(Message.of(MessageType.MAKE_MOVE).with("cell", cell));
    }

    @Override
    public void onSendChat(String text) {
        gamePane.appendChat("You", text);
        connection.send(Message.of(MessageType.CHAT).with("text", text));
    }

    // ===================== ServerConnection callbacks (network thread) =====================

    /** Called after each successful (re)connect. Auto re-login if we were in. */
    private void onConnected() {
        if (loggedIn && username != null && password != null) {
            log.info("Reconnected — re-authenticating as {}", username);
            connection.send(Message.of(MessageType.LOGIN)
                    .with("username", username)
                    .with("password", password));
        }
    }

    private void onState(ConnectionState state) {
        // Hop to the FX thread before touching the UI.
        Platform.runLater(() -> {
            String text = switch (state) {
                case CONNECTING -> "Connecting…";
                case CONNECTED -> "Connected";
                case RECONNECTING -> "Connection lost — reconnecting…";
                case DISCONNECTED -> "Disconnected";
            };
            loginPane.setStatus(state == ConnectionState.CONNECTED ? "" : text);
            loginPane.setInputDisabled(state != ConnectionState.CONNECTED);
            gamePane.setConnectionStatus(text);
            if (state == ConnectionState.CONNECTED && loggedIn) {
                gamePane.setConnectionStatus("Connected");
            }
        });
    }

    private void onMessage(Message msg) {
        // Always marshal onto the FX thread; never mutate Nodes off-thread.
        Platform.runLater(() -> handleMessage(msg));
    }

    // ===================== message handling (FX thread) =====================

    private void handleMessage(Message msg) {
        switch (msg.getType()) {
            case LOGIN_OK -> handleLoginOk(msg);
            case ERROR -> handleError(msg);
            case MATCH_FOUND -> handleMatchFound(msg);
            case GAME_STATE -> handleGameState(msg);
            case GAME_OVER -> handleGameOver(msg);
            case CHAT_MESSAGE -> gamePane.appendChat(
                    msg.getString("from"), msg.getString("text"));
            case OPPONENT_LEFT -> handleOpponentLeft(msg);
            case PONG -> { /* liveness only */ }
            default -> log.debug("Ignoring unexpected message: {}", msg.getType());
        }
    }

    private void handleLoginOk(Message msg) {
        boolean wasLoggedIn = loggedIn;
        loggedIn = true;
        String name = msg.getString("username");
        if (!wasLoggedIn) {
            // First login: switch from the login screen to the game screen.
            root.getChildren().setAll(gamePane);
        }
        gamePane.setStatus(String.format("Hi %s  (W:%d  L:%d  D:%d)",
                name,
                msg.getInt("wins", 0),
                msg.getInt("losses", 0),
                msg.getInt("draws", 0)));
        gamePane.setFindMatchEnabled(true);
    }

    private void handleError(Message msg) {
        String message = msg.getString("message");
        if (loggedIn) {
            gamePane.setStatus(message);
            gamePane.setFindMatchEnabled(true);
        } else {
            loginPane.setStatus(message);
        }
    }

    private void handleMatchFound(Message msg) {
        myMark = Mark.valueOf(msg.getString("yourMark"));
        gamePane.setStatus(String.format("Match vs %s — you are %s",
                msg.getString("opponent"), myMark));
        gamePane.setFindMatchEnabled(false);
    }

    @SuppressWarnings("unchecked")
    private void handleGameState(Message msg) {
        List<String> board = (List<String>) msg.getData().get("board");
        if (board != null) {
            gamePane.renderBoard(board);
        }
        Mark nextTurn = Mark.valueOf(msg.getString("nextTurn"));
        boolean myTurn = nextTurn == myMark;
        gamePane.setBoardEnabled(myTurn);
        gamePane.setStatus(myTurn ? "Your turn (" + myMark + ")" : "Opponent's turn…");
    }

    @SuppressWarnings("unchecked")
    private void handleGameOver(Message msg) {
        List<String> board = (List<String>) msg.getData().get("board");
        if (board != null) {
            gamePane.renderBoard(board);
        }
        gamePane.setBoardEnabled(false);
        Mark winner = Mark.valueOf(msg.getString("winnerMark"));
        String result;
        if (winner == Mark.EMPTY) {
            result = "It's a draw!";
        } else if (winner == myMark) {
            result = "You win! 🎉";
        } else {
            result = "You lose.";
        }
        gamePane.setStatus(result + "  Click Find Match to play again.");
        gamePane.setFindMatchEnabled(true);
        myMark = Mark.EMPTY;
    }

    private void handleOpponentLeft(Message msg) {
        gamePane.setBoardEnabled(false);
        gamePane.setStatus(msg.getString("message") + "  Click Find Match to play again.");
        gamePane.setFindMatchEnabled(true);
        myMark = Mark.EMPTY;
    }
}
