# Networked Multiplayer Tic-Tac-Toe

A small but production-shaped **client/server multiplayer game** in Java,
demonstrating a clean end-to-end flow: JavaFX UI → TCP sockets → thread-pooled
server → game logic → H2 database.

It is intentionally scaffolded so each architectural concern lives in its own
layer and can be understood (and tested) in isolation.

---

## Architecture

```
                       ┌──────────────────────────── CLIENT (JavaFX) ────────────────────────────┐
                       │  ClientMain (Application)                                                 │
   UI layer            │     └─ GameClientController  ── Platform.runLater ──>  LoginPane/GamePane │
                       │            │  (the ONLY place network ↔ UI meet)                          │
   Network layer       │     ServerConnection  (background thread, auto-reconnect w/ backoff)      │
                       └───────────────────────────────────┬──────────────────────────────────────┘
                                                            │  NDJSON over TCP (one JSON Message per line)
                       ┌────────────────────────────────────┴───────────── SERVER ────────────────┐
   Network layer       │  GameServer (ServerSocket + ExecutorService thread pool)                  │
                       │     └─ ClientHandler (1 per connection)  ── MessageRouter ──>             │
   Service/logic layer │        AuthService · MatchmakingService · GameSessionManager · ServerGame │
                       │            └─ TicTacToe  (pure rules engine — unit tested)                 │
   Data layer          │  Database (HikariCP pool) · PlayerDao · GameSessionDao  (PreparedStatement)│
                       └───────────────────────────────────────────────────────────────────────────┘
                                                            │
                                                       H2 (embedded)
```

### Layer responsibilities

| Layer    | Server                                                   | Client                                  |
|----------|----------------------------------------------------------|-----------------------------------------|
| Network  | `server.net.*` — accept loop, per-client handler, router | `client.net.ServerConnection`           |
| Logic    | `server.service.*`, `server.game.TicTacToe`              | `client.GameClientController`           |
| UI       | —                                                        | `client.ClientMain`, `client.ui.*`      |
| Data     | `server.data.*` (DAOs + pool)                            | —                                       |
| Shared   | `common.protocol.*`, `common.model.*` (wire contract)    | (same package, shared)                  |

---

## How the design meets the requirements

- **Thread pool, not raw threads** — `GameServer` submits each connection to a
  fixed `ExecutorService` (`Executors.newFixedThreadPool`). No `new Thread()`
  per client. *(Upgrade path: swap for `Executors.newVirtualThreadPerTaskExecutor()`
  on Java 21+ to scale past the fixed cap — blocking socket I/O is the ideal
  virtual-thread workload.)*
- **Proper protocol** — newline-delimited JSON (`common.protocol`). `MessageType`
  is a shared enum so both ends agree at compile time; `Codec` does encode/decode.
- **Prepared statements + connection pool** — every query in `PlayerDao` /
  `GameSessionDao` is a `PreparedStatement` with bound params (no string concat).
  Connections come from a HikariCP pool (`Database`).
- **Separation of concerns** — network / logic / UI / data are distinct packages
  with one-way dependencies. `TicTacToe` has zero infrastructure imports.
- **Reconnection** — `ServerConnection` reconnects with capped exponential
  backoff and transparently re-authenticates (`GameClientController.onConnected`).
- **Correct JavaFX threading** — the network thread never touches a `Node`;
  `GameClientController` hops onto the FX thread with `Platform.runLater`, and the
  FX thread only calls the non-blocking `send()` (no blocking I/O on the FX thread).
- **Server-side validation** — `AuthService` validates username/password;
  `TicTacToe` enforces all move rules; the server is authoritative and rejects
  illegal client requests rather than trusting them.
- **No God classes** — responsibilities are split into small, focused classes.

---

## Prerequisites

- **JDK 17+**
- **Maven 3.8+**

## Build & test

```bash
cd multiplayer-game
mvn clean test        # runs the TicTacToe unit tests
mvn clean package     # compiles everything
```

## Run

Open two terminals (server first):

```bash
# 1) Server
mvn -Pserver compile exec:java
#    options: -Dgame.port=5555 -Dgame.threadPoolSize=200 \
#             -Dgame.jdbcUrl="jdbc:h2:./data/game;AUTO_SERVER=TRUE"

# 2) Client (run twice to get two players)
mvn javafx:run
#    options: -Dgame.host=localhost -Dgame.port=5555
```

Register/log in as two different users in two client windows, click **Find
Match** in both, and play. Game results and win/loss/draw stats are persisted to
the H2 database under `./data/`.

---

## Protocol summary

Each frame is one line of JSON: `{"type":"...","data":{...}}`.

| Direction        | Type            | Payload                               |
|------------------|-----------------|---------------------------------------|
| client → server  | `REGISTER`/`LOGIN` | `username`, `password`              |
| client → server  | `FIND_MATCH` / `CANCEL_MATCH` | —                        |
| client → server  | `MAKE_MOVE`     | `cell` (0–8)                          |
| client → server  | `CHAT`          | `text`                                |
| server → client  | `LOGIN_OK`      | `playerId`, `username`, `wins`/`losses`/`draws` |
| server → client  | `MATCH_FOUND`   | `gameId`, `yourMark`, `opponent`      |
| server → client  | `GAME_STATE`    | `board` (9 marks), `nextTurn`         |
| server → client  | `GAME_OVER`     | `board`, `result`, `winnerMark`       |
| server → client  | `CHAT_MESSAGE` / `OPPONENT_LEFT` / `ERROR` | message fields    |

---

## Project layout

```
multiplayer-game/
├─ pom.xml
├─ src/main/java/com/example/game/
│  ├─ common/            # shared wire protocol + model (Mark, GameStatus)
│  ├─ server/
│  │  ├─ net/            # GameServer, ClientHandler, ClientSession, MessageRouter
│  │  ├─ service/        # AuthService, MatchmakingService, GameSessionManager, ServerGame
│  │  ├─ game/           # TicTacToe (pure rules) + IllegalMoveException
│  │  ├─ data/           # Database (HikariCP), PlayerDao, GameSessionDao
│  │  ├─ ServerMain.java # entry point
│  │  └─ ServerConfig / ServerContext
│  └─ client/
│     ├─ net/            # ServerConnection (reconnect), ConnectionState
│     ├─ ui/             # LoginPane, GamePane
│     ├─ ClientMain.java # JavaFX Application
│     ├─ ClientLauncher.java
│     └─ GameClientController.java
├─ src/main/resources/   # schema.sql, simplelogger.properties
└─ src/test/java/...      # TicTacToeTest
```

## Possible extensions

- Virtual threads (Java 21) for the client pool.
- A reconnect/resume token so an in-progress game survives a brief drop
  (the hooks are already in `ServerConnection`/`GameClientController`).
- A leaderboard query in `PlayerDao` and a UI panel for it.
- TLS via `SSLServerSocketFactory` / `SSLSocketFactory`.
```
