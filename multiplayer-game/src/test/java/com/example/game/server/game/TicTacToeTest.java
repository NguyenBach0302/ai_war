package com.example.game.server.game;

import com.example.game.common.model.GameStatus;
import com.example.game.common.model.Mark;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

/**
 * Unit tests for the pure {@link TicTacToe} rules engine. No network, DB or UI —
 * just the logic, which is exactly what makes the core easy to test.
 */
class TicTacToeTest {

    @Test
    @DisplayName("X moves first and turns alternate")
    void turnsAlternate() {
        TicTacToe game = new TicTacToe();
        assertEquals(Mark.X, game.getNextTurn());
        game.makeMove(0, Mark.X);
        assertEquals(Mark.O, game.getNextTurn());
        game.makeMove(1, Mark.O);
        assertEquals(Mark.X, game.getNextTurn());
    }

    @Test
    @DisplayName("playing out of turn is rejected")
    void rejectsOutOfTurn() {
        TicTacToe game = new TicTacToe();
        IllegalMoveException ex =
                assertThrows(IllegalMoveException.class, () -> game.makeMove(0, Mark.O));
        assertEquals("It is not O's turn.", ex.getMessage());
    }

    @Test
    @DisplayName("playing an occupied cell is rejected")
    void rejectsOccupiedCell() {
        TicTacToe game = new TicTacToe();
        game.makeMove(4, Mark.X);
        assertThrows(IllegalMoveException.class, () -> game.makeMove(4, Mark.O));
    }

    @Test
    @DisplayName("out-of-range cells are rejected")
    void rejectsOutOfRange() {
        TicTacToe game = new TicTacToe();
        assertThrows(IllegalMoveException.class, () -> game.makeMove(-1, Mark.X));
        assertThrows(IllegalMoveException.class, () -> game.makeMove(9, Mark.X));
    }

    @Test
    @DisplayName("a completed row wins for X")
    void detectsRowWin() {
        TicTacToe game = new TicTacToe();
        game.makeMove(0, Mark.X); // X
        game.makeMove(3, Mark.O); // O
        game.makeMove(1, Mark.X); // X
        game.makeMove(4, Mark.O); // O
        game.makeMove(2, Mark.X); // X completes top row 0,1,2
        assertEquals(GameStatus.X_WON, game.getStatus());
    }

    @Test
    @DisplayName("a completed diagonal wins for O")
    void detectsDiagonalWin() {
        TicTacToe game = new TicTacToe();
        game.makeMove(1, Mark.X);
        game.makeMove(0, Mark.O);
        game.makeMove(2, Mark.X);
        game.makeMove(4, Mark.O);
        game.makeMove(5, Mark.X);
        game.makeMove(8, Mark.O); // O completes diagonal 0,4,8
        assertEquals(GameStatus.O_WON, game.getStatus());
    }

    @Test
    @DisplayName("a full board with no line is a draw")
    void detectsDraw() {
        TicTacToe game = new TicTacToe();
        // X O X
        // X O O
        // O X X   -> no three in a line
        int[] order = {0, 1, 2, 4, 3, 5, 7, 6, 8};
        Mark turn = Mark.X;
        for (int cell : order) {
            game.makeMove(cell, turn);
            turn = turn.opponent();
        }
        assertEquals(GameStatus.DRAW, game.getStatus());
    }

    @Test
    @DisplayName("no moves are accepted after the game ends")
    void rejectsMovesAfterWin() {
        TicTacToe game = new TicTacToe();
        game.makeMove(0, Mark.X);
        game.makeMove(3, Mark.O);
        game.makeMove(1, Mark.X);
        game.makeMove(4, Mark.O);
        game.makeMove(2, Mark.X); // X wins
        assertEquals(GameStatus.X_WON, game.getStatus());
        assertThrows(IllegalMoveException.class, () -> game.makeMove(5, Mark.O));
    }

    @Test
    @DisplayName("board serialization reflects moves")
    void serializesBoard() {
        TicTacToe game = new TicTacToe();
        game.makeMove(0, Mark.X);
        game.makeMove(8, Mark.O);
        assertEquals("X.......O", game.serializeBoard());
    }

    @Test
    @DisplayName("getBoard returns a defensive copy")
    void boardIsDefensivelyCopied() {
        TicTacToe game = new TicTacToe();
        Mark[] snapshot = game.getBoard();
        snapshot[0] = Mark.X; // mutate the returned copy

        Mark[] allEmpty = new Mark[9];
        java.util.Arrays.fill(allEmpty, Mark.EMPTY);
        // The engine's internal board must be unaffected by the mutation above.
        assertArrayEquals(allEmpty, game.getBoard());
    }
}
