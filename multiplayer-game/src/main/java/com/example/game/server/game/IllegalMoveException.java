package com.example.game.server.game;

/**
 * Thrown by {@link TicTacToe} when a requested move violates the rules. The
 * message is safe to relay to the offending client.
 */
public class IllegalMoveException extends RuntimeException {
    public IllegalMoveException(String message) {
        super(message);
    }
}
