package com.example.game.common.protocol;

/**
 * Every message exchanged between client and server carries exactly one
 * {@code MessageType}. Keeping the vocabulary in a single enum means both ends
 * agree on the protocol at compile time.
 *
 * <p>Naming convention: requests sent by the client are imperatives
 * (e.g. {@link #LOGIN}); messages pushed by the server are facts/events
 * (e.g. {@link #LOGIN_OK}, {@link #GAME_STATE}).
 */
public enum MessageType {

    // ----- Client -> Server (requests) -----
    /** {@code {username, password}} */
    REGISTER,
    /** {@code {username, password}} */
    LOGIN,
    /** No payload. Adds the player to the matchmaking queue. */
    FIND_MATCH,
    /** No payload. Removes the player from the matchmaking queue. */
    CANCEL_MATCH,
    /** {@code {cell}} where cell is 0..8. */
    MAKE_MOVE,
    /** {@code {text}} broadcast to the opponent. */
    CHAT,
    /** No payload. Keep-alive / liveness probe. */
    PING,

    // ----- Server -> Client (responses & events) -----
    /** {@code {playerId, username, wins, losses, draws}} */
    LOGIN_OK,
    /** {@code {message}} — a request was rejected (bad input, auth failure, …). */
    ERROR,
    /** No payload. Reply to {@link #PING}. */
    PONG,
    /** {@code {gameId, yourMark, opponent}} — a match has started. */
    MATCH_FOUND,
    /** {@code {board, nextTurn}} — authoritative board after every change. */
    GAME_STATE,
    /** {@code {board, result, winnerMark}} — terminal state. */
    GAME_OVER,
    /** {@code {from, text}} — chat relayed from the opponent. */
    CHAT_MESSAGE,
    /** {@code {message}} — opponent left; the game is abandoned. */
    OPPONENT_LEFT
}
