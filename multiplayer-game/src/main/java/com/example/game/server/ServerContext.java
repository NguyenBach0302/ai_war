package com.example.game.server;

import com.example.game.server.data.Database;
import com.example.game.server.data.GameSessionDao;
import com.example.game.server.data.PlayerDao;
import com.example.game.server.service.AuthService;
import com.example.game.server.service.GameSessionManager;
import com.example.game.server.service.MatchmakingService;

/**
 * Composition root for the server. Builds the data layer and service layer once
 * and exposes them to the network layer. Keeping construction in one place keeps
 * wiring explicit and avoids singletons/global state.
 */
public final class ServerContext implements AutoCloseable {

    private final Database database;
    private final AuthService authService;
    private final MatchmakingService matchmakingService;
    private final GameSessionManager gameSessionManager;

    public ServerContext(ServerConfig config) {
        this.database = new Database(
                config.jdbcUrl(), config.dbUser(), config.dbPassword(), config.dbPoolSize());
        this.database.initSchema();

        PlayerDao playerDao = new PlayerDao(database);
        GameSessionDao gameSessionDao = new GameSessionDao(database);

        this.authService = new AuthService(playerDao);
        this.gameSessionManager = new GameSessionManager(gameSessionDao, playerDao);
        this.matchmakingService = new MatchmakingService(gameSessionManager);
    }

    public AuthService authService() {
        return authService;
    }

    public MatchmakingService matchmakingService() {
        return matchmakingService;
    }

    public GameSessionManager gameSessionManager() {
        return gameSessionManager;
    }

    @Override
    public void close() {
        database.close();
    }
}
