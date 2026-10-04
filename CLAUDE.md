# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Unofficial, non-commercial fan remake of Arknights' auto-chess tower-defense mode 卫戍协议：盟约 (*Stronghold Protocol: Alliance*), solo or 1–4 player co-op. One long-running Node.js process (static HTTP + a WebSocket at `/ws`) and a browser client with no build step.

Node ≥ 22, ESM everywhere (`"type": "module"`). There is **no bundler, no TypeScript, no linter and no formatter**: match the surrounding code by hand, and use JSDoc types where they help. The only runtime server dependency is `ws`.

## Commands

```bash
npm install          # postinstall (tools/vendor.mjs) copies pixi / pixi-spine / preact / htm / three into public/vendor
npm run setup        # environment check + ~270 MB art/audio into public/assets (optional: server and tests run without it)
npm start            # http://localhost:3000        (npm run dev = node --watch)
npm run doctor       # read-only diagnosis: Node, deps, assets, port, LAN addresses

node --test                                                           # everything, ~3,170 tests
node --test test/sim/skills.test.js                                   # one file
node --test --test-name-pattern='<regex>' test/match/economy.test.js  # one test
SP_E2E=1 node --test test/ui/mock.e2e.test.js                         # browser E2E (system Chrome; CHROME_PATH overrides)
SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js                    # also needs the downloaded assets
RENDER_E2E=1 node --test 'test/render/*.browser.test.js'              # renderer; some need locally extracted board art

npm run build-data   # regenerate data/*.json from the official tables (-- --offline: use .cache/gamedata only)
```

Suites that need Chrome, `public/assets`, `.cache/gamedata` or `data/local-assets.json` skip themselves, so plain `node --test` is expected to pass on a fresh clone after `npm install`. CI (`.github/workflows/ci.yml`) does exactly that on Ubuntu + Windows × Node 22/24, plus `node tools/setup.mjs --check --no-local` and a boot smoke test against `/healthz`.

Headless tools, each documented in its header comment:

- `tools/simrun.mjs`: one battle (`--mode mode_multi_normal --round 5 --lineup "…"`, `--ascii`, `--json`).
- `tools/matchrun.mjs`: whole bot matches in virtual time (`--mode coop --players 2 --difficulty HARD --seed 1`).
- `tools/balance.mjs`, `tools/botbench.mjs`, `tools/kit-coverage.mjs`, `tools/record-battle.mjs`.

Dev pages served from `public/dev/`: `/dev/game-mock.html` (the in-match UI against an in-browser mock server), `/dev/render-demo.html` (the renderer replaying recorded battles), `/dev/uikit.html`.

Server env: `PORT`, `HOST`, `SP_COMBAT=client|server`, `SP_VERIFY=off|sample|all`, `TRUST_PROXY`, `DEBUG`. Client URL switches: `?board=2d`, `?render=fallback`.

## Architecture

| Path | Role |
|---|---|
| `server/index.js` | Static server and boot. Serves `/` → `public/`, `/data/` → `data/`, `/shared/` → `shared/`, `/sim/` → `server/sim/` (`.js` only), and a generated `/data.js` shim. |
| `server/net.js`, `server/lobby.js` | Sessions, rate limits, message validation; rooms, seats, reconnect tokens, room → match wiring. |
| `server/match/` | The match and economy engine: `Match.js` (state machine, timers, views), `PlayerState.js` (shop / bench / board / items and every prep intent), `pool`, `board`, `bondsMeta`, `effectsMeta`, `choices`, `waves`, `unite`, `finalAssault`, `fields`, `results`, `bot`, `scheduler`. |
| `server/sim/` | The deterministic battle engine (`Battle.js`, `grid`, `units`, `buffs`, `damage`, `targeting`, `skills`, `ai`, `professions`, `snapshot`, `spec`) and all game content under `content/`. **Runs in both Node and the browser.** |
| `shared/` | Pure ESM used by both sides: `constants.js` (enums, phases, geometry, `APP_VERSION`), `protocol.js` (the normative message catalogue and validators), `loadoutRecord.js`, `bandBonds.js`, `media.js`. |
| `public/js/` | Client: `main.js` (boot + store-derived router), `store.js`, `net.js`, `screens/`, `ui/` (Preact + htm), `render/` (PixiJS 7 + pixi-spine; `render/board3d/` is the three.js board), `battle/runner.js` (client-side combat). |
| `data/` | Generated game data (committed) plus the asset manifest `assets.json`. |
| `tools/`, `scripts/` | Data build, asset download, local-client extraction (Python), setup / doctor; start scripts and the Windows bundle. |

Ideas that span files:

- **Client-side combat (DESIGN §14).** Each battle is fully described by a JSON `BattleSpec` (`server/sim/spec.js`). The owning player's browser simulates it and uploads `b.progress` / `b.result`; the server validates the result against the spec (`match/fields.js validateClientResult`) and re-simulates or takes the field over when it is invalid, late or the authority drops. Bots and absent players are simulated on the server. `SP_COMBAT=server` is the legacy server-run, streamed mode, and many match tests still run with `clientCombat: false`.
- **The sim is deterministic and browser-safe.** No wall clock and no `Math.random` under `server/sim/`: the only randomness is `battle.rng()`. No Node APIs either, except in `server/sim/nodeData.js`, which is loaded dynamically under Node only and is never served. The same holds for `shared/`.
- **Content plugs in through hooks, not engine edits.** Each domain module under `server/sim/content/` exports `install(battle)` (battle side) and `registerMeta(registry)` (prep side, the `SERVER_*` effects dispatched by `match/effectsMeta.js`). Operator kits live in `content/kits/tier1..6.js` as `{ [baseChessId]: (bb, chess, def) => Kit }`. Numbers come from the data blackboards (`bb`), never hard-coded when a blackboard key exists.
- **Protocol.** JSON frames `{ t, rid?, … }`. `room.*` is the lobby, `g.*` are match intents, `m.*` are server state pushes, `b.*` is battle traffic. The server is authoritative for everything outside a battle: clients send intents, the server validates and pushes full `m.public` / `m.private` views.
- **Geometry and time.** Every stage is a 19 × 21 grid with **row 0 at the bottom**; range grids are `[dRow, dCol]` relative to facing RIGHT and are rotated. The sim steps at `TICK = 1/30` s of game time and combat runs at a forced 2× real time. Prep timers are absolute server deadlines.
- **All state is in server memory.** One process, one instance; a restart ends every room.

## Aldus deployment (this fork only)

This repository is a fork of `sganggs/Stronghold-Protocol`, so the deployment to Aldus (a static host; an app there is an "imprint") is **additive**: everything for it lives in `aldus/`, and no upstream file is moved or edited for it. Do not create `frontend/` or `backend/` folders, and do not restructure the project to fit the platform.

- `aldus/build.mjs` assembles `aldus/dist/` from `public/`, `data/`, `shared/` and `server/sim/`, mirroring the URL map of `createStaticHandler` in `server/index.js`. What an imprint's CSP needs (no inline event handlers, PixiJS patched with `@pixi/unsafe-eval`) is done to the copy. It fails closed when upstream changes something it cannot map; `aldus/README.md` lists each case.
- Build and check: `npm install`, `npm install --prefix aldus`, `node aldus/build.mjs`, `aldus -C aldus -e production check`, `node --test aldus/build.test.js`.
- `aldus/worker/` is the socket backend for the imprint, as a prototype: a Rust Cloudflare Worker (workers-rs) with one Durable Object. Rust owns the sockets, sessions, lobby and storage (a port of `server/net.js` and `server/lobby.js`, so a change to either upstream file must be ported to `src/server.rs` and added to the conformance script); the match engine is upstream's JavaScript, bundled unchanged by `aldus/worker/build-engine.mjs` and called through `engine/glue.js`. Never put game rules in the Rust code. `aldus/worker/README.md` lists the platform pitfalls already hit (no `strip`, lazy engine load, run-time imports made static).
- Worker checks: `node --test aldus/worker/test/engine.test.js`; with the Worker running (`npx wrangler dev --port 8870 --inspector-port 9370 --ip 127.0.0.1 --assets ../dist` in `aldus/worker`), `SP_WORKER_URL=ws://127.0.0.1:8870/ws node --test aldus/worker/test/conformance.test.js` compares it with the Node server frame by frame. Port 8787 is taken on the operator's machine.
- `aldus/WS-EVENTS.md` and `aldus/WS-STATE.md` describe the socket traffic and the state each message changes. The fork's own docs under `aldus/` are written in ASD-STE100.
- `aldus/i18n/` is the interface translation for the imprint: a catalog keyed by the Chinese source string (`locales/en.json`) and a runtime that rewrites the drawn text, English by default. The game data is never translated (the sim reads Chinese text). After a merge, `node aldus/i18n/extract.mjs --missing` lists the new untranslated text.
- A trial is live (`aldus/README.md`, section "Live"): the page at `https://stronghold.apps.vikala.io/` and the Worker `stronghold-ws` on the route `/ws` of that host. Deploy the page and the Worker from the same commit: both run the sim.
- The art in `public/assets` is never part of the build (4,014 files, 282 MB against an imprint's 1,000 files and 100 MB). It is in the R2 bucket `stronghold-protocol`, public at `https://assets.apps.vikala.io` (`ASSET_ORIGIN` in `aldus/build.mjs`; `aldus/sync-art.sh` fills it). The build points the copy of `data/assets.json` at that origin and patches the copy of `public/js/assets.js` (`validSpine` accepts only same-origin paths upstream). `aldus/README.md`, section "The art", has the details. Running `tools/fetch-assets.mjs` may rewrite `stats.bytes` in the tracked `data/assets.json`: restore it.

## Documentation

`docs/DESIGN.md` is the single source of truth. It is about 500 KB with multi-kilobyte lines, so do not read it whole: `grep -n '^##' docs/DESIGN.md`, then read the section by offset. §0–§16 are the architecture and contracts; §17–§22 are dated rule revisions (playtests, GitHub issues) and **supersede earlier text** where they conflict. Its §2 file tree predates some files, so trust `git ls-files` for what exists.

- `docs/SIM.md`: engine reference for content authors (hooks, helpers, SkillSpec schema, worked examples, the test harness).
- `docs/META.md`: match engine, the effect registry and handler `ctx`, views.
- `docs/DATA.md`: schema of every `data/*.json` file. `docs/ASSETS.md`: asset pipeline and manifest. `docs/BALANCE.md`: difficulty measurement.
- `docs/research/`: notes on the official rules; start at `00-INDEX.md`. Where a file's body and its "Addendum (critic)" disagree, the addendum wins.

Precedence when sources disagree: DESIGN.md, then research, then the simplest faithful behaviour written down in the module's header comment. Nearly every source file opens with a long header comment stating its contract and the DESIGN sections behind it. Read it before changing the file and keep it true afterwards.

## Rules that are easy to break

- **Do not hand-edit `data/*.json`.** Change `tools/build-data.mjs` and rebuild; the output is deterministic and byte-identical for the same inputs. `stages.json` ground paths are derived from `server/sim/grid.js`, so a pathing change needs a rebuild (`test/data.test.js` catches stale data, but only when `.cache/gamedata` exists). `data/assets.json` is written by `tools/fetch-assets.mjs`, which refuses to drop entries without `--allow-shrink`.
- **Docs are under test.** `test/docs-consistency.test.js` pins sentences in `README.md`, `CHANGELOG.md`, `docs/DESIGN.md`, `SIM.md`, `META.md`, `DATA.md`, `DEPLOY.md`, `PLAYING.md` and the research notes against the code. A rule change is code + test + docs together; after editing any of those files run that test. Other suites pin README wording too (`test/version.test.js`, `test/static-local-art.test.js`).
- **One version in five places**: `package.json`, `package-lock.json`, `shared/constants.js` `APP_VERSION`, the README badge and the newest `CHANGELOG.md` heading (`test/version.test.js`). `README.en.md` repeats the badge and version by hand. `PROTOCOL_VERSION` is the separate wire-format number.
- **Languages.** Player-facing strings and the player docs (`README.md`, `CHANGELOG.md`, `NOTICE.md`, `docs/PLAYING.md`, `DEPLOY.md`, `WINDOWS.md`) are Simplified Chinese. Code, comments, identifiers and the technical docs are English. `README.en.md` is a translation of `README.md`; update it when the README changes.
- **`[ASSUMED]`** marks a value or rule reconstructed without an official source. Keep the tag, keep the value tunable, and add the tag to anything new that is inferred. Rules are checked against the official data tables and PRTS; deliberate deviations are listed explicitly (for example `TRIGGER_DEVIATIONS` in `tools/build-data.mjs`, DESIGN §21.29).
- **Every content effect gets a test** under `test/content/` using `test/helpers/battleHarness.js` (`makeBattle`). Match tests use `test/match/harness.js` (`makeMatch`: virtual scheduler, optional `FakeBattle`). Tests assert the engine invariants: no NaN, `hp ∈ [0, maxHp]`, battles terminate, funds and pool counts never negative.
- **No crash paths on the server.** Every client intent is validated, and an error thrown inside one field's battle must not take the match down.
- **Nothing from a CDN at runtime.** LAN play has to work offline, so client libraries are vendored into `public/vendor` (git-ignored, regenerated by `npm install`).
- **Never commit game assets.** `public/assets/`, `public/fonts/`, `public/vendor/`, `data/local-assets.json` and `.cache/` are git-ignored; the art and audio are © Hypergryph / Yostar and outside the GPL (`NOTICE.md`). The project is strictly non-commercial, so no ads, payments or tipping features.
- **Upstream URLs.** `package.json`, the README clone command and `test/version.test.js` point at `sganggs/Stronghold-Protocol`. Do not rewrite them to a fork's URL.
- **Line endings** are fixed by `.gitattributes`: LF everywhere except `.bat` / `.cmd` / `.ps1` (CRLF). Tests match file content line by line.
- **Commit messages** on upstream `master` are a one-line Chinese summary ending in the PR number, `(#NN)`; working commits inside a batch are English and prefixed with the batch name (`feedback2: …`).
