# The socket Worker

This folder holds the socket backend of the imprint: a Cloudflare Worker in Rust with one Durable Object. The client
of the original project connects to it at `/ws` and plays without a change.

Status: a prototype. It runs on a local machine with `wrangler dev`. It does not run on Cloudflare.

## 1. The design

The Worker has two parts.

| Part | Language | Contents |
|---|---|---|
| The Rust code | Rust (`src/`) | the sockets<br>the sessions<br>the rooms<br>the storage |
| The engine | JavaScript (the original project) | the rules of a match: `server/match/`, `server/sim/`, `shared/` |

- The Rust code is new. It is the Rust version of `server/net.js` and `server/lobby.js`.
- The engine is not new, and this folder does not change it. `engine/glue.js` imports the original files, and `build-engine.mjs` makes
  one file of them.
- The Rust code and the engine exchange JSON text. A match goes across as a handle that the Rust code keeps.
- The Rust code has no rule of the game. It gets each rule from the original files: the checks of a message, the
  texts of the errors, the names of the AI players.

One Durable Object, `GameServer`, is the full server. The client opens its socket before it knows a room. Thus a room
cannot be a Durable Object of its own.

## 2. The files

| File | Contents |
|---|---|
| `src/lib.rs` | the Worker and the Durable Object: `/ws` and `/healthz` |
| `src/server.rs` | the sessions, the lobby, and the connection to a match |
| `src/engine.rs` | the functions of the engine, as the Rust code sees them |
| `engine/glue.js` | the functions of the engine, as JavaScript gives them |
| `engine/stubs/` | small replacements for the Node modules that the original files import |
| `build-engine.mjs` | the build of the engine bundle |
| `entry.mjs` | the module that wrangler uploads |
| `wrangler.toml` | the config of the Worker and of the Durable Object |
| `test/` | the tests |

## 3. Build and run

You need these tools:

- Rust, with the target `wasm32-unknown-unknown`
- `worker-build` 0.8.7
- Node 22 or later

```bash
rustup target add wasm32-unknown-unknown
cargo install worker-build@0.8.7 --locked
npm install                       # at the root of the repository
npm install --prefix aldus/worker
node aldus/build.mjs              # the page, for the local Worker
cd aldus/worker
npx wrangler dev --port 8870 --inspector-port 9370 --ip 127.0.0.1 --assets ../dist
```

Then open `http://127.0.0.1:8870/`. The local Worker gives the page and the socket from one origin.

CAUTION: Do not use port 8787 on the machine of the operator. A different server uses it.

`wrangler dev` does the build first: the engine bundle, then the Rust code.

## 4. The tests

```bash
node --test aldus/worker/test/engine.test.js
SP_WORKER_URL=ws://127.0.0.1:8870/ws node --test aldus/worker/test/conformance.test.js
```

- `engine.test.js` builds the engine bundle and starts a match from it. It needs no Worker.
- `conformance.test.js` needs the local Worker. It sends the same 38 steps to the Node server of the original project
  and to the Worker. Then it compares the messages that each socket got. Without `SP_WORKER_URL`, the test skips.

## 5. The results of 2026-10-04

- The conformance test passed: the Worker and the Node server gave the same messages for each step.
- The browser client played three rounds of a solo match with the local Worker. It sent 32 `b.progress` and 2
  `b.result`, and the Worker accepted them.
- The size of the upload is 6.3 MB, or 876 KB with gzip. The limit of the free plan is 3 MB with gzip.

## 6. Compatibility with Workers and Durable Objects

Each item below was a problem in the build or is a rule of the platform.

- **No `strip` in the release profile.** With `strip = true`, `wasm-bindgen` stops with the error "externref table
  required for catch wrappers".
- **The engine loads on the first request.** A Worker has a short time limit for its start, and the engine bundle is
  5 MB. `entry.mjs` imports the bundle only when the Rust code asks for it.
- **The engine loads its content at run time.** Three original files use `import(path)` with a path that they make at
  run time. A bundle cannot follow such an import. `build-engine.mjs` gives each of these files a table of its
  modules. If one of these files changes its loader, the build stops.
- **No Node modules.** The original files import these Node modules:
  - `node:fs`
  - `node:path`
  - `node:url`
  - `node:crypto`
  - `node:net`

  The bundle has a small replacement for each one. `wrangler.toml` does not set the flag `nodejs_compat`.
- **The game data is in the bundle as text.** The engine parses it for the first match, not at the start.
- **The simulation runs as it does in a browser.** The bundle defines `process` as absent.
- **The standard WebSocket API, not the hibernation API.** The state is in the memory. Thus the Durable Object must
  stay in the memory while a socket is open.
- **`new_sqlite_classes` in the first migration.** The storage type of a class cannot change later, and the tables of
  `WS-STATE.md` use SQLite.
- **The engine calls back into the Rust code.** It does this during a call from the Rust code and also from its timers. A
  callback that cannot borrow the `Server` puts its message in a queue. The Rust code empties the queue after each
  call.

## 7. Not built

- **The storage.** The state is in the memory only. A restart of the Durable Object stops each room. `WS-STATE.md`
  has the design of the four tables.
- **The limits of `server/net.js`.** The Worker has no rate limit for each socket and no limit for each network.
- **The replay of the result.** A player who connects again after the end of a match does not get `m.result` again.
- **The delay between two answers to `hello`.** The Worker answers each `hello` immediately.
- **The deploy.** `wrangler.toml` has the route `stronghold.apps.vikala.io/ws`, which gives the socket the origin of
  the page. The deploy needs the Cloudflare account that owns `vikala.io`.

## 8. When the original project changes

Merge as usual. Then do these steps:

1. Run `node --test aldus/worker/test/engine.test.js`. It fails if a content loader changed.
2. Start the local Worker.
3. Run the conformance test. It fails if the session layer or the lobby of the original project changed its
   messages. Then change `src/server.rs` to agree.

A change in the rules of a match needs no change here: the engine is the original code.
