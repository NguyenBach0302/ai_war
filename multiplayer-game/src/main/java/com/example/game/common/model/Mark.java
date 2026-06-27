package com.example.game.common.model;

/**
 * A cell occupant on the Tic-Tac-Toe board. Shared by the game logic, the wire
 * protocol and the UI so all layers speak the same vocabulary.
 */
public enum Mark {
    EMPTY,
    X,
    O;

    /** The mark belonging to the other player. {@code EMPTY.opponent()} is EMPTY. */
    public Mark opponent() {
        return switch (this) {
            case X -> O;
            case O -> X;
            case EMPTY -> EMPTY;
        };
    }
}
