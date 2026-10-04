# Aldus imprint of the browser client

Everything that makes this project deployable on [Aldus](https://aldus.vikala.io) lives in this folder. Aldus serves
static files only: one imprint, at `https://stronghold.apps.vikala.io/`, built from the same sources the Node server
serves.

**This repository is a fork.** No file outside `aldus/` is moved or changed for the deployment, so updates from the
original project merge as before. The usual Aldus layout (`frontend/` and `backend/`) is deliberately not used here.

Status: the page is live as a trial (section "Live"). The socket backend in `worker/` is not deployed, so the live
page shows the title screen and then a lost connection.

| File | What |
|---|---|
| `imprint.json` | The imprint: its name, the storage that keeps its builds, the build command, the outside hosts the page may load from. |
| `build.mjs` | Assembles `dist/` from `public/`, `data/`, `shared/` and `server/sim/`. Its header comment is the reference. |
| `build.test.js` | The build's tests. `node --test` at the repository root runs them too. |
| `package.json` | The one dependency of the build: `@pixi/unsafe-eval`, pinned to the PixiJS version. |
| `WS-EVENTS.md` | What the client and the game server send each other during a game, with measured sizes: the map for the socket backend that is not built yet. |
| `WS-STATE.md` | For each client message: the state that changes in the backend, how a Durable Object would keep it, and the answer (`send()` or `broadcast()`). |
| `worker/` | The socket backend, a prototype: a Rust Cloudflare Worker with one Durable Object that runs the original match engine. Its own `README.md` has the build, the tests and the limits. |
| `dist/` | The output (git-ignored). |

## Build and check

```bash
npm install                    # at the repository root: the client libraries (public/vendor)
npm install --prefix aldus     # the PixiJS patch
node aldus/build.mjs           # → aldus/dist, about 180 files and 10 MB
aldus -C aldus -e production check
node --test aldus/build.test.js
```

`aldus check` reports one warning, IMP-22 on `vendor/pixi.min.js`. It is expected: PixiJS still contains the
`new Function` calls, and the patch below keeps the page from reaching them.

## What the build does

The Node server answers the client's URLs from five places. The build lays the same URLs out as one folder:

| URL | From |
|---|---|
| `/` | `public/`, without `dev/`, `assets/` and `fonts/` |
| `/data/` | `data/*.json` |
| `/shared/` | `shared/` |
| `/sim/` | `server/sim/**/*.js`, without the Node-only `nodeData.js` |
| `/data.js` | the shim string `server/index.js` exports |

Three things are done to the copy, never to the sources:

1. **Inline event handlers.** An imprint's Content-Security-Policy refuses them. `public/index.html` has two; each
   becomes a data attribute plus a listener in one inline script, which the entry page may carry.
2. **PixiJS.** PixiJS 7 builds its uniform uploads with `new Function`, which the policy refuses, so the renderer
   would throw on its first shader. PixiJS's own patch for such pages is appended to the copy of
   `vendor/pixi.min.js`.
3. **`robots.txt`** refuses crawlers, because the project asks that an address goes to friends only.

## When the original project changes

Merge as usual, then build. The build stops, with the reason, when a change needs a decision here:

| The build says | Do |
|---|---|
| inline event handlers this build does not know | Add the handler to `KNOWN_HANDLERS` and `HANDLER_SCRIPT` in `build.mjs`. |
| PixiJS is X but … pins `@pixi/unsafe-eval` Y | Set the same version in `package.json`, then `npm install --prefix aldus`. PixiJS 8 needs no patch. |
| `server/index.js` no longer exports `DATA_SHIM_JS` | Read how `/data.js` is served now, and write that file in `build.mjs`. |
| the build breaks the imprint contract | A limit is passed (1,000 files, 100 MB, 25 MB a file), or a file has no extension. |

A new top-level folder the server starts to serve is not noticed by the build: compare `createStaticHandler` in
`server/index.js` with the table above after a large update.

## Not here yet

- **The game server, deployed.** The page opens its WebSocket at `/ws` of its own origin, and an imprint does not
  answer it: on the imprint alone the title screen loads and then shows that the connection is lost. `worker/` is the
  backend for that socket, as a prototype that runs locally. It is not deployed, it keeps its state in memory only, and
  it has no route on the imprint's host yet.
- **The art and audio.** `public/assets` is about 270 MB in about 4,000 files, over the limits of an imprint, and is
  not ours to publish (NOTICE.md). The client draws its placeholder visuals without it, as on any install that
  skipped the download.

## Deploy

The steps that change a live system follow the `aldus-heron-deploy-env` skill, with `aldus -C aldus -e production`
for the CLI and `--frontend aldus` for its `preflight.py`. A later deploy of the page is one command:

```bash
aldus -C aldus -e production deploy --build -m "what changed"
```

## Live

- **The page:** `https://stronghold.apps.vikala.io/`, a trial deploy. First deploy `01M444V165ZW1ZERBRA7N2PFX6`,
  on 2026-10-04.
- **The storage:** `stronghold` in Mouseion holds the builds, under `builds/<deploy>/`. It is shared, read and
  write, with the account of the app, `stronghold-imprint@vikala.io`.
- **The secrets:** `mouseion-token`. The imprint has no blocks, so it has no Heron key.
- **The socket backend:** not deployed. It needs a Worker route for `stronghold.apps.vikala.io/ws` in the Cloudflare
  account that owns `vikala.io`.
- **Checked in a browser on 2026-10-04:** the title screen loads, and no script of the game breaks the policy. One
  script that is not part of the game is refused: the analytics beacon that Cloudflare adds to pages of this zone.
- `preflight.py` shows one item as missing, `backend/heron.json`. This is correct: the imprint has no blocks.
