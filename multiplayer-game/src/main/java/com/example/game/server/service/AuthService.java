package com.example.game.server.service;

import com.example.game.server.data.DuplicateUsernameException;
import com.example.game.server.data.Player;
import com.example.game.server.data.PlayerDao;
import org.mindrot.jbcrypt.BCrypt;

import java.sql.SQLException;
import java.util.regex.Pattern;

/**
 * Account registration and login. Lives in the game-logic/service layer; it
 * knows nothing about sockets.
 *
 * <p>All inputs are validated <strong>here, on the server</strong> — the client
 * is never trusted. Passwords are hashed with BCrypt; plaintext is never stored
 * or logged.
 */
public final class AuthService {

    private static final Pattern USERNAME = Pattern.compile("^[A-Za-z0-9_]{3,32}$");
    private static final int MIN_PASSWORD_LENGTH = 6;
    private static final int MAX_PASSWORD_LENGTH = 100;
    private static final int BCRYPT_COST = 12;

    private final PlayerDao playerDao;

    public AuthService(PlayerDao playerDao) {
        this.playerDao = playerDao;
    }

    /**
     * Register a new account.
     *
     * @throws InvalidInputException      if username/password fail validation
     * @throws DuplicateUsernameException if the username is taken
     */
    public Player register(String username, String password) throws SQLException {
        validateUsername(username);
        validatePassword(password);
        String hash = BCrypt.hashpw(password, BCrypt.gensalt(BCRYPT_COST));
        return playerDao.create(username, hash);
    }

    /**
     * Verify credentials.
     *
     * @return the authenticated {@link Player}
     * @throws AuthenticationException if the username is unknown or the password
     *                                 is wrong (same message for both, to avoid
     *                                 leaking which usernames exist)
     */
    public Player login(String username, String password) throws SQLException {
        validateUsername(username);
        validatePassword(password);

        Player player = playerDao.findByUsername(username)
                .orElseThrow(() -> new AuthenticationException("Invalid username or password."));

        if (!BCrypt.checkpw(password, player.passwordHash())) {
            throw new AuthenticationException("Invalid username or password.");
        }
        return player;
    }

    private void validateUsername(String username) {
        if (username == null || !USERNAME.matcher(username).matches()) {
            throw new InvalidInputException(
                    "Username must be 3-32 characters: letters, digits or underscore.");
        }
    }

    private void validatePassword(String password) {
        if (password == null
                || password.length() < MIN_PASSWORD_LENGTH
                || password.length() > MAX_PASSWORD_LENGTH) {
            throw new InvalidInputException(
                    "Password must be between " + MIN_PASSWORD_LENGTH
                            + " and " + MAX_PASSWORD_LENGTH + " characters.");
        }
    }
}
