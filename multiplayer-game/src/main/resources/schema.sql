-- Schema for the multiplayer Tic-Tac-Toe server (H2, embedded).
-- Idempotent: safe to run on every server start.

CREATE TABLE IF NOT EXISTS players (
    id            BIGINT AUTO_INCREMENT PRIMARY KEY,
    username      VARCHAR(32)  NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL,   -- BCrypt hash, never plaintext
    wins          INT          NOT NULL DEFAULT 0,
    losses        INT          NOT NULL DEFAULT 0,
    draws         INT          NOT NULL DEFAULT 0,
    created_at    TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS game_sessions (
    id           BIGINT AUTO_INCREMENT PRIMARY KEY,
    player_x_id  BIGINT      NOT NULL,
    player_o_id  BIGINT      NOT NULL,
    winner_id    BIGINT,                  -- NULL = draw or unfinished
    status       VARCHAR(16) NOT NULL,    -- IN_PROGRESS / X_WON / O_WON / DRAW
    final_board  VARCHAR(9),              -- compact board, e.g. 'X.OXO..X.'
    started_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at     TIMESTAMP,
    CONSTRAINT fk_gs_px FOREIGN KEY (player_x_id) REFERENCES players(id),
    CONSTRAINT fk_gs_po FOREIGN KEY (player_o_id) REFERENCES players(id),
    CONSTRAINT fk_gs_w  FOREIGN KEY (winner_id)   REFERENCES players(id)
);

CREATE INDEX IF NOT EXISTS idx_gs_player_x ON game_sessions(player_x_id);
CREATE INDEX IF NOT EXISTS idx_gs_player_o ON game_sessions(player_o_id);
