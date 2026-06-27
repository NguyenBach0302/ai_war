package com.example.game.common.model;

/** Lifecycle state of a single game. */
public enum GameStatus {
    IN_PROGRESS,
    X_WON,
    O_WON,
    DRAW;

    public boolean isTerminal() {
        return this != IN_PROGRESS;
    }
}
