package com.example.game.server.game;

import com.example.game.common.model.GameStatus;
import com.example.game.common.model.Mark;

import java.util.Arrays;

/**
 * Pure, self-contained Tic-Tac-Toe rules engine — <strong>no</strong> network,
 * threading, persistence or UI concerns. This is the unit-testable core of the
 * game logic layer.
 *
 * <p>The board is a flat array of nine cells indexed left-to-right, top-to-bottom:
 * <pre>
 *      0 | 1 | 2
 *     ---+---+---
 *      3 | 4 | 5
 *     ---+---+---
 *      6 | 7 | 8
 * </pre>
 *
 * <p>The engine is authoritative: it enforces turn order, bounds and occupancy,
 * and rejects illegal moves by throwing {@link IllegalMoveException}. Callers
 * (the server) never assume a move is legal just because a client sent it.
 *
 * <p>Not thread safe — a single game is only ever touched by one logical owner
 * at a time, and the server serializes access per game.
 */
public final class TicTacToe {

    public static final int SIZE = 9;

    /** All eight winning lines (rows, columns, diagonals). */
    private static final int[][] WIN_LINES = {
            {0, 1, 2}, {3, 4, 5}, {6, 7, 8},   // rows
            {0, 3, 6}, {1, 4, 7}, {2, 5, 8},   // columns
            {0, 4, 8}, {2, 4, 6}               // diagonals
    };

    private final Mark[] board = new Mark[SIZE];
    private Mark nextTurn = Mark.X;        // X always moves first
    private GameStatus status = GameStatus.IN_PROGRESS;
    private int movesPlayed = 0;

    public TicTacToe() {
        Arrays.fill(board, Mark.EMPTY);
    }

    /**
     * Apply a move for {@code player} at {@code cell}.
     *
     * @param cell   0..8, the target square
     * @param player the mark attempting the move; must equal {@link #getNextTurn()}
     * @throws IllegalMoveException if the game is over, it is not the player's
     *                              turn, the cell is out of range, or it is taken
     */
    public void makeMove(int cell, Mark player) {
        if (status.isTerminal()) {
            throw new IllegalMoveException("The game is already over.");
        }
        if (player != Mark.X && player != Mark.O) {
            throw new IllegalMoveException("A move must be made by X or O.");
        }
        if (player != nextTurn) {
            throw new IllegalMoveException("It is not " + player + "'s turn.");
        }
        if (cell < 0 || cell >= SIZE) {
            throw new IllegalMoveException("Cell " + cell + " is out of range (0..8).");
        }
        if (board[cell] != Mark.EMPTY) {
            throw new IllegalMoveException("Cell " + cell + " is already taken.");
        }

        board[cell] = player;
        movesPlayed++;
        recomputeStatus(player);
        if (!status.isTerminal()) {
            nextTurn = player.opponent();
        }
    }

    private void recomputeStatus(Mark justMoved) {
        for (int[] line : WIN_LINES) {
            if (board[line[0]] == justMoved
                    && board[line[1]] == justMoved
                    && board[line[2]] == justMoved) {
                status = (justMoved == Mark.X) ? GameStatus.X_WON : GameStatus.O_WON;
                return;
            }
        }
        if (movesPlayed == SIZE) {
            status = GameStatus.DRAW;
        }
    }

    public GameStatus getStatus() {
        return status;
    }

    public Mark getNextTurn() {
        return nextTurn;
    }

    /** @return a defensive copy of the board so callers cannot mutate internal state. */
    public Mark[] getBoard() {
        return board.clone();
    }

    /**
     * Compact string form of the board for persistence/serialization, e.g.
     * {@code "X.OXO..X."} ('.' = empty). Length is always {@link #SIZE}.
     */
    public String serializeBoard() {
        StringBuilder sb = new StringBuilder(SIZE);
        for (Mark m : board) {
            sb.append(switch (m) {
                case X -> 'X';
                case O -> 'O';
                case EMPTY -> '.';
            });
        }
        return sb.toString();
    }
}
