# ARCHITECTURE.md — a map of the code

For a newcomer who wants to find their way before changing something. This file only maps the code. The contracts are
in the design document — [DESIGN.md](DESIGN.md) is its index, the current rules are in `docs/design/` (§5 the battle
engine: [design/engine.md](design/engine.md); §6 the match: [design/match.md](design/match.md); §8 the protocol and §14
client-side combat: [design/network.md](design/network.md); §9 rendering: [design/client.md](design/client.md)), the
per-release revisions and their evidence in `docs/history/`;
the details in [SIM.md](SIM.md) (battle engine, hooks, SkillSpec), [META.md](META.md) (match engine, prep-phase
effects), [DATA.md](DATA.md) (generated data), [ASSETS.md](ASSETS.md) (art and audio), [SKINS.md](SKINS.md) (operator
skins: a cosmetic plugin's `chars[charId].skins`), [I18N.md](I18N.md)
(languages) and [PLUGINS.md](PLUGINS.md) (plugins and the content hash; [PLUGIN-GUIDE.md](PLUGIN-GUIDE.md) the beginner's guide to
making one, in Chinese). The [settlement migration guide](SETTLEMENT.md) maps damage/healing mechanisms to the
current object-request API. How to set up, test and send a change: [CONTRIBUTING.md](../CONTRIBUTING.md).

## 1. What runs where

```
 browser (public/)                               one Node process (server/index.js, Node ≥ 22)
 ┌──────────────────────────────────────┐        ┌─────────────────────────────────────────────────────┐
 │ screens/, ui/   Preact + htm         │─ HTTP ▶│ server/http/  static files: / /data/ /shared/       │
 │ render/         PixiJS, pixi-spine,  │        │               /sim/ /media/, GET /healthz           │
 │                 three.js             │        │                                                     │
 │ battle/runner.js  runs the sim       │◀ /sim/ │ server/sim/   the deterministic battle sim          │
 │ net.js           the socket          │◀ /ws ▶ │ server/net.js → lobby.js → match/Match.js           │
 │                                      │        │                 (rooms)    (rounds, economy, views) │
 └──────────────────────────────────────┘        └─────────────────────────────────────────────────────┘
```

- **The server** is one Node process: plain `node:http` plus `ws`, no framework (`server/index.js` wires
  `server/http/`). It serves the static client, the generated data and the sim's source files, and runs every room and
  match in memory — rounds, shop, economy, bots, validation. Plugin authoring writes folders and locks to disk; the studio key persists too. Gameplay content sets use separate match children (§3).
- **The browser** loads native ES modules with no bundler and no build step; the libraries are vendored into
  `public/vendor/` by `tools/vendor.mjs` on `npm install`.
- **The battle simulation** (`server/sim/`) is pure ESM without any Node API, served read-only at `/sim/`. Both sides
  run it from the same JSON battle description (`server/sim/spec.js`, the BattleSpec): each player's browser simulates
  its own battle (`public/js/battle/runner.js`) and reports progress and the result; the server checks the result
  against the spec (`server/match/fields.js` `validateClientResult`), runs the battles no connected human owns (bots, a
  dropped player, an authority that missed its deadline) and can re-simulate results (`SP_VERIFY`). `SP_COMBAT=server`
  is the older mode in which the server runs every battle and streams snapshots. `SP_BOT_REHEARSAL=host` also lets
  the host's browser test AI teammates' layouts before battle (META §1.5). If the host cannot finish, the server does
  the work. A gameplay-plugin room stays on the server. Actual battles and human seats under AI 托管 are unchanged.
  DESIGN §14.
- **Determinism** is what makes this work: fixed 1/30 s ticks, a seeded PRNG (`server/sim/rng.js`), no wall clock,
  no `Math.random` and only correctly rounded arithmetic in the sim, so the same spec and data give the same battle on
  every machine, bit for bit. ECMA-262 leaves `Math.hypot`, `sin`, `cos`, `atan2`, `pow` (and `**`) implementation-
  approximated and the engines differ in their last bits (V8, SpiderMonkey and JavaScriptCore each compute `hypot`
  differently; Chrome's and Node's `sin` differ), so the sim takes them from `server/sim/detmath.js`, built only from
  + − × ÷ and `Math.sqrt`; ESLint and `test/sim/detmath.test.js` refuse the Math ones in `server/sim/`. The golden
  results (§5) rely on it.

## 2. The WebSocket protocol

`shared/protocol.js` is normative: `C2S` holds one validator per client message and `S2C` lists the server messages.
Every frame is JSON text, `{ t, rid?, …fields }`.

| direction | messages | handled in |
|---|---|---|
| client → server | `hello` (name, reconnect token) → `welcome`; `ping` → `pong` | `server/net.js` |
| | `room.*`: create, join, ready, difficulty, AI seats, kick, start, the 干员调配 loadout, 干员持有 ownership, 自选编队 picks, spectating | `server/lobby.js` |
| | `g.*`: match intents — buy, refresh, freeze, level up, sell, move, equip, Arts, rewards, 机变 choices, ready, emotes, watching, pause … | `server/match/match/intents.js` → `server/match/player/` |
| | `b.progress`, `b.result`: the battle reports of the authoritative browser | `server/match/match/reports.js` |
| | `b.rehearsalResult`: the host's choice of AI layout (only with `SP_BOT_REHEARSAL=host`) | `server/match/match/rehearsal.js` |
| server → client | `room.state`, `room.closed` | `server/lobby.js` |
| | `m.public` (what every player sees), `m.private` (one player's shop, hand, funds …), `m.field`, `m.toast`, `m.ticker`, `m.emote`, `m.unitStats`, `m.result` | `server/match/match/views.js`, `server/match/player/views.js` |
| | `b.start` (a BattleSpec), `b.pool` (the shared leader HP), `b.end`; `b.snap` / `b.ev` only in the server-run mode | `server/match/match/clientCombat.js` |
| | `b.rehearsal`, `b.rehearsalCancel`: ask the host to test AI layouts or stop that task | `server/match/match/rehearsal.js` |

- A request that carries `rid` is answered with `ok` or `error` echoing it. `server/net.js` rate-limits each socket,
  validates every message against `C2S` and refuses anything unknown; the handlers never trust the client.
- Messages meant for people (`m.toast`, `m.ticker`) carry a message id and its parameters, so each client shows them in
  its own language (`shared/i18n.js` `wireMessage`).
- `welcome` and `room.state` carry the content identity — the hash `cs` of the code and data the room plays, the
  vanilla one for rooms without gameplay plugins — and every BattleSpec repeats it; a room's cosmetic plugins
  (`room.setPlugins`, the host's) are named by the visual hash `vs` beside it (DESIGN §8.4, PLUGINS.md §9).
- The exact view shapes: DESIGN §8.3 and META §5.

## 3. The directory layout

0.2.0 split the big files without changing behaviour. Three classes keep their constructor in one file and their
methods in a folder, installed on the prototype in a fixed order (a method name defined twice throws):
`server/sim/Battle.js` with `server/sim/battle/`, `server/match/Match.js` with `server/match/match/`, and
`server/match/PlayerState.js` with `server/match/player/`. Two client modules became barrels that re-export a folder,
so old imports keep working: `public/js/ui/gameLogic.js` (`public/js/ui/gameLogic/`) and `public/js/render/fx.js`
(`public/js/render/fx/`). DESIGN §2 lists every file.

### Server and shared code

| path | what |
|---|---|
| `server/index.js` | the process entry (`npm start`); `startServer()` wires `server/http/` |
| `server/http/` | `csp.js` (site importmap hashes and independent simulation-Worker CSP), `config.js` (environment), `websocket.js` (sessions, `/ws`, permessage-deflate), `static.js` (the mounts, the `~<hash>` asset routes), `media.js`, `files.js` (MIME, brotli / gzip, ETag, ranges), `buildTag.js`, `routes.js` (`/healthz`), `traffic.js` (bytes sent by category and on the WebSocket, `/healthz?traffic=1`), `assetIndex.js` (the content hashes of `public/assets/` and `public/fonts/`, cached in `.cache/asset-hashes.json`), `assetViews.js` (the served `/data/assets.json` and `/data/local-assets.json`: every art URL with its hash segment; ASSETS.md), `common.js`, `boot.js` (a pending update package first, banner, shutdown) |
| `server/net.js` | sessions and reconnect tokens, rate limits, message validation |
| `server/lobby.js` | rooms, seats, AI seats, spectators; starts a `Match` |
| `server/data.js` | loads `data/*.json` once (frozen) |
| `server/plugins/` | the plugin system (PLUGINS.md, DESIGN §32): `registry.js` finds the language packs of `public/i18n/`, the pack folders of `packs/` and the plugins of `plugins/`, validates them (a cosmetic plugin's asset overlay too, its files hashed), answers `/packs/index.json`, `/plugins/index.json` and which files may be served, re-reads the folders when they change; `identity.js` computes the vanilla content hash `cs` from the served sim, shared code and data at start (`/cs/<cs16>/index.json`, `/healthz`, `welcome`, `room.state`); `visualSet.js` the visual sets of cosmetic plugins — a room's or a player's, named by `vs` — served at `/vs/<vs16>/overlay.json` (the composition and each plugin's writes: the browser composes the art itself, `public/js/assets.js`), their files at `/p/<id>/<hash8>/<path>`; `contentSet.js` builds a content set of data plugins (C1, DESIGN §32.5); `roomSets.js` turns a room's plugin list into its visual set and its content set, `contentSets.js` keeps the content sets rooms hold (by `cs`, the concurrent limit, `/cs/<cs16>/…`), `policy.js` reads the server owner's `plugins/config.json` (P1c, DESIGN §32.6) |
| `server/plugins/` (scripts and installs) | `contentData.js` reads declared JSON; `trusted.js` checks mode, lock pins and listening addresses; `scriptPreflight.js` / `scriptProbe.js` probe setup in disposable children; `scriptTestSetup.js` preloads author tests; `trustedRuntime.js` / `trustedEntry.js` / `trustedApi.js` host native server extensions; `install.js` checks and installs local or hash-pinned HTTPS zips; `forgeImport.js` converts Forge packs without executing their scripts, and `forgeKits.js` carries their `kits/` into one sandboxed script plugin |
| `server/plugins/` (packing) | `pack.js` checks a plugin folder and writes its `plugin.lock.json` (Spine clip data parsed from the skeleton), `zip.js` its deterministic zip — for `tools/plugin.mjs` and the studio |
| `server/studio/` | the plugin studio 插件工作台 (PLUGINS.md §15, DESIGN §32.9): `index.js` serves `/studio/` and its API to this machine and the local network only (`gate.js`; every change carries the studio's key, `key.js`; `paths.js` its URLs for the static server), `files.js` keeps every read and write inside `plugins/<id>/` (no link followed), `templates/` (one module per template), `targets.js` (targets by official name), `edit.js` (fields, slots, one-click fixes), `preview.js` (the temporary composition), `watch.js` (hot reload: fs.watch → rescan → rooms apply again) |
| `server/studio/` (gameplay authoring) | `gameData.js` reads official data and bundled template files; `authoring.js` validates/revises wizard drafts; `dslExamples.js` supplies examples; `trialOptions.js` lists scenarios; `trialScenario.js` builds BattleSpecs; `trial.js` owns jobs; `trialChild.js` builds content sets; `trialRunner.js` simulates in a disposable child; `trialDraft.js` confines draft writes and cleanup |
| `server/studio/console.js`, `shared/studio/scenario.js` | standalone test console: keyed validation and match-equivalent BattleSpec building; versioned bounded scenario JSON shared with the browser; no rooms or server battle jobs |
| `server/match/host/` | where a room with gameplay plugins plays (P1c, DESIGN §32.6): `index.js` one child process — or worker thread, `SP_MATCH_HOST=worker` — per content set, the watchdog and the limits; `childHost.js` adds permission-limited JSON-IPC children for sandbox scripts; `entry.js` inside it checks the set's bytes against `cs`, installs the data and only then imports `Match.js`; `ipc.js` validates and bounds child messages in the parent; `proxy.js` is the lobby's `room.match` for such a match (Promise answers, the room's messages in order) |
| `server/packs.js` | the content-pack API of 0.2.0 (PACKS.md), a compatibility export of `server/plugins/registry.js` |
| `server/update.js` | the update package on the player's machine (DEPLOY.md §1.5): before the server starts, an extracted `UPDATE.json` is finished — the install verified against `MANIFEST.json`, the files the new version dropped deleted, or the start refused when the install is another version; doctor's `MANIFEST.json` check |
| `server/match/Match.js` | one match: the phase machine, timers, the round loop, co-op, the views; its methods are in `server/match/match/` (`phases.js`, `prep.js`, `combat.js`, `clientCombat.js`, `rehearsal.js`, `reports.js`, `unitePhase.js`, `bossRounds.js`, `settle.js`, `views.js`, `intents.js` …) |
| `server/match/PlayerState.js` | one player's shop, hand, board, items, bonds and LP, and every prep intent; its methods are in `server/match/player/` (`economy.js`, `acquire.js`, `placement.js`, `items.js`, `pieces.js`, `prep.js`, `round.js`, `diy.js`, `views.js` …) |
| `server/match/` (the rest) | `pool.js` (the shared chess pool), `board.js` (placement), `bondsMeta.js`, `effectsMeta.js` and `builtinMeta.js` (prep-phase effects), `choices.js` (机变), `waves.js`, `unite.js` (联防), `finalAssault.js`, `results.js`, `bot.js` (AI players and AI 托管), `fields.js` (the battles of a combat phase), `scheduler.js`, `gamedata.js` |
| `server/sim/Battle.js` | one battle field; its methods are in `server/sim/battle/` (`lifecycle.js`, `spawns.js`, `deploy.js`, `blocking.js`, `combat.js`, `status.js`, `summons.js`, `displacement.js`, `events.js` …) |
| `server/sim/` (the rest) | `skills.js`, `ai.js`, `attack.js` (the explicit settlement API), `attack/` (hit, ordered injury effects, transfers, health, element, heal and helpers), `damage.js` (independent deprecated oracle; production imports use attack/ helpers), `buffs.js`, `targeting.js`, `grid.js` (pathing), `units.js`, `professions.js`, `snapshot.js`, `spec.js` (the BattleSpec), `rehearsal.js` (tests AI layouts and picks the best, shared with the browser), `simdata.js` (data records → engine defs), `nodeData.js` (the Node-only data loader, never served) |
| `server/sim/content/` | everything game-specific, installed into a battle by `server/sim/content/index.js` |
| `server/sim/content/kits/` | the operator kits: `ops/` holds one file per chess (`<chessId>-<codename>.js`, 129), per 补位 stand-in (`standin-<codename>.js`, 9) and per 自选 operator (`op-<codename>.js`, 72); `shared/` the helpers several kits use; `index.js` the registry; `README.md` the guide |
| `server/sim/content/enemies/` | the enemy kits by special type (`invisible.js`, `times.js`, `element.js`, `dot.js`, `reflection.js`, `fly.js`, `special.js`) and `leaders.js`; `server/sim/content/enemies.js` dispatches them, `server/sim/content/bosses.js` scripts the leaders |
| `server/sim/content/garrisons/`, `items/`, `bands/` | 特质, equipment and strategies: `battle.js` is the battle side, `meta.js` the prep side (`registerMeta`, META §2) |
| `server/sim/content/bonds/` | the 23 bonds: `core.js` the 8 core bonds (both sides), `server/sim/content/bonds/addon/` the 15 add-on bonds (`battle.js`, `meta.js`) |
| `server/sim/content/` (the rest) | `tokens.js` (summons), `devices.js` (terrain and stage devices), `generic.js` (the kit built from a skill's data when a chess has none), `choices.js` (机变 cards in battle), `traitMods.js` (the module trait line the engine applies to every operator: 「攻击范围内存在N名及以上敌人时攻击速度+X」) |
| `server/sim/content/dsl/`, `server/sim/content/extensions.js`, `server/match/dslMeta.js` | the declarative compiler/validator/vocabulary/bounds; script registration and budgets; prep DSL hooks (PLUGINS.md §12–§13) |
| `shared/plugins/` (data and author APIs) | `patch.js`, `records.js`, `recordsSchema.js`, `skillSpec.js`, `validate.js`, `dataUtils.js` compose and check data; `limits.js`, `officialBounds.js`, `steps.js`, `textNumber.js`, `textPatterns.js` share work bounds; `scriptCheck.js` checks portable entry syntax; `ui.js` the read-only frame protocol; `catalog.js` validates catalogue entries; `surface.js` anchors the generated API table |
| `shared/` | imported by the server and the browser: `protocol.js`, `constants.js`, `i18n.js`, `i18nData.js` and `i18nPacks.js` (languages), `packs.js` (the language-pack index), `shared/plugins/` (`sandbox.js` the per-plugin SES loader and verified descriptor adapter; `scriptLoad.js` shared verification and native source routes; `sdk.js` the common registration facade; `manifest.js` the plugin manifest, `identity.js` the content hash, `visual.js` a cosmetic plugin's asset overlay and the visual hash, `order.js` a set's load order, `errors.js` the error catalogue: every `PLUGIN_*` code in plain words), `sha256.js` (SHA-256 in plain JavaScript), `standIn.js` (补位), `diy.js` (自选编队), `highGround.js`, `loadoutRecord.js` |

### Client (`public/`)

| path | what |
|---|---|
| `public/index.html`, `public/js/main.js` | the page and its entry: boot, the router (title → lobby → room → game) |
| `public/js/net.js`, `public/js/store.js`, `public/js/data.js` | the socket client, the observable store, the data loader (`/data/*.json`, with the English overlay) |
| `public/js/content.js` | the room's cosmetic plugins and the player's own (PLUGINS.md §9): fetched, checked against `room.state.content.vs` and laid over the art manifest (`public/js/cosmetics.js` cosmetic layers — small; `shared/plugins/visual.js` loads with the first set —, data.js's view of `assets`); the plugin catalogue; the room's 插件 tag is `public/js/ui/pluginTag.js`, its panel `public/js/ui/pluginPanel.js` (loaded when it opens) |
| `public/js/battle/` | `runner.js` (the local battle clock and reports), `simHost.js` (C4: vanilla InPageSimHost, every gameplay set WorkerSimHost), `simWorker.js` / `simWorkerRuntime.js` (pure Worker engine, no JSON fetch), `simLoader.js` (shared data loader), `rehearsal.js` / `rehearsalWorker.js` (same-origin module Worker: test AI layouts when `SP_BOT_REHEARSAL=host`), `observe.js` (who may watch which field) |
| `public/js/screens/` | `title.js`, `lobby.js`, `room.js`, `loadout.js` (干员调配), `cultivation.js` (its 潜能 / 练度 controls), `ownership.js` (干员持有), `diy.js` (自选编队), `briefing.js`, `bandDraft.js`, `game.js` with `public/js/screens/game/`, `result.js` |
| `public/js/ui/` | the HUD components (`hud.js`, `shopBar.js`, `detailPanel.js`, `bondStrip.js`, `teamPanel.js` …); `public/js/ui/gameLogic/` the pure in-match logic, unit-tested in Node |
| `public/js/render/` | the field view: `app.js` with `public/js/render/app/`, `units.js` and `spine.js` (models), `tiles.js`, `projection.js`, `interp.js`, `pick.js`, `drag.js`, `public/js/render/fx/` (effects; `kinds.js` maps the fx kinds), `public/js/render/vfx/` (the official battle effects from the local client: a Unity ParticleSystem interpreter, GLSL shader ports, the WebGL2 pass, the event wiring and the skills' plans and their runtime, `skills.js` / `skillfx.js`, the 驭械术士's floating units, `funnels.js` / `funnelfx.js`; DESIGN §9), `public/js/render/board3d/` (the official 3D board) |
| `public/css/`, `public/i18n/<code>.json` | the styles; the UI strings of each language pack (English ships) |
| `public/studio/` | the plugin studio's page (`/studio/`, local network only): `index.html`, `studio.css`; `public/studio/js/main.js` the shell, `api.js` keyed requests, `create.js` / `picker.js` creation, `slots.js` / `info.js` / `issues.js` editing and findings, `labels.js` display names |
| `public/studio/js/` (gameplay and import) | `authoring.js` / `validateDraft.js` wizard saves and validation; `editors/` template forms (including `dslForm.js` and shared `controls.js`); `trial.js` trial controls; `preview/` the game's cards, field and sound plus `replay.js` / `layers.js`; `forge.js` and `catalog.js` import/install flows |
| `public/studio/console.html`, `public/studio/js/console/` | test console page: `main.js` key/JSON/persistence, `editor.js` scenario controls, `view.js` real sim/field host, `runtime.js` fixed-tick driving and bounded inspector/effect logs |
| `public/js/ui/pluginSettings.js`, `public/js/ui/numberInput.js`, `public/js/ui/uiPlugins.js`, `public/js/ui/pluginFrame.js` | room settings controls, decimal input, personal UI switches and the sandboxed frame host |

### Data, tools, tests

| path | what |
|---|---|
| `data/*.json` | generated by `tools/build-data.mjs` and committed — never edited by hand (DATA.md); `data/backups.json` holds the 补位 and 自选 data, `data/i18n/<code>.json` the game texts of a language pack (English), `data/assets.json` the art manifest |
| `packs/` | content packs installed as folders, `packs/<id>/pack.json` + files (PACKS.md); empty in the repository but for its readme |
| `plugins/` | a server's plugins, `plugins/<id>/plugin.json` + files (PLUGINS.md); git-ignored but for its readme, its guide for AI agents (`plugins/AGENTS.md`) and the templates (`plugins/_template/cosmetic/`, `plugins/_template/content/`, `plugins/_template/script/`, `plugins/_template/ui/`) |
| `schemas/` | JSON Schemas of manifests, asset overlays, compact records, DSL, UI messages and community catalogues (PLUGINS.md §15), for editors and AI agents |
| `tools/` | `build-data.mjs`, `build-i18n.mjs`, `i18n.mjs` (UI strings, language packs), `packs.mjs` (content packs), `plugin.mjs` (plugins: list, check, pack, new, test, errors, surface, import-forge, install, catalog), `setup.mjs` / `fetch-assets.mjs` / `tools/assets/` (art and audio), `tools/local-extract/` (art from a local game client), `vendor.mjs`, `golden.mjs`, `check-imports.mjs`, `package.mjs` / `package-update.mjs` (the release zips, the update package, the example asset pack), `doctor.mjs`; sweeps: `matchrun.mjs`, `simrun.mjs`, `botbench.mjs`, `balance.mjs` |
| `test/` | `node:test` suites by area: `test/content/` (kits, enemies, bonds, items), `test/sim/` (the engine), `test/match/` (match engine, bots), `test/ui/`, `test/render/`, `test/golden/` (the stored digests), `test/plugins/` and `test/studio/` (the plugin system, the studio), `test/helpers/` (`battleHarness.js`; `designDocs.js`, the design document in § order for the doc tests), `test/e2e/` (browser and bot runs) |
| `types/` | JSDoc typedefs of the type-checked slice (`types/README.md`) |
| `docs/` | the documents; `docs/DESIGN.md` the index of the design document, `docs/design/` its current rules, `docs/history/` its per-release revisions; `docs/research/` the research on the official mode |

## 4. Data flow

```
official zh_CN tables (.cache/gamedata) ─┐
docs/research/*.json ────────────────────┴─▶ tools/build-data.mjs ─▶ data/*.json
official EN tables ────────────────────────▶ tools/build-i18n.mjs ─▶ data/i18n/en.json
public mirrors, a local client ────────────▶ tools/setup.mjs ──────▶ public/assets/ + data/assets.json

data/*.json ──────────┬─▶ server/data.js ─────────────▶ the match, the server's battles
                      ├─▶ public/js/data.js ──────────▶ the UI
                      └─▶ public/js/battle/runner.js ─▶ the browser's battles (setSimData)
data/i18n/en.json ──────▶ public/js/data.js ──────────▶ the English game texts
public/assets/ ─────────▶ public/js/render/, public/js/audio.js (URLs listed in data/assets.json,
                           served with content-hash segments: server/http/assetViews.js)
```

- **Game data.** `tools/build-data.mjs` downloads the official zh_CN tables into `.cache/gamedata/` (or reads them
  there with `--offline`), joins them with the research JSON and writes `data/*.json` deterministically; DATA.md
  documents every field. A data fix goes into the builder: rebuild with `node tools/build-data.mjs --offline` and
  compare the JSON to see that only the intended data changed.
- **On the server**, `server/data.js` loads the files once; the match reads them through `server/match/gamedata.js`,
  the sim through `server/sim/simdata.js`, which turns every record into a frozen engine def.
- **In the browser**, `public/js/data.js` fetches the same files once per page for the UI, and the battle runner loads
  its own frozen copies for the sim (`loadBrowserSim` → `setSimData`), so both sides simulate from the same data.
- **Languages.** Chinese is the source language; every other language is a pack — `public/i18n/<code>.json` (UI
  strings) and optionally `data/i18n/<code>.json` (game texts), listed by the server at `/packs/index.json`
  (`server/packs.js`; PACKS.md). The English game texts come from the official EN client (`tools/build-i18n.mjs` →
  `data/i18n/en.json`, applied by `public/js/data.js`); UI strings are wrapped in `t('…')` and translated in the packs
  (`tools/i18n.mjs` lists what is missing); server messages travel as message ids. I18N.md.
- **Content identity.** At start `server/plugins/identity.js` hashes the bytes the server serves — the sim, the
  shared code, the `/data.js` stand-in and the gameplay `data/*.json` — into the content hash `cs`
  (`shared/plugins/identity.js`, with `shared/sha256.js` in the browser); two machines with the same `cs` run the same
  battles. PLUGINS.md §6.
- **Art and audio** are never committed. `npm run setup` downloads them from public mirrors (`tools/fetch-assets.mjs`,
  planned by `tools/assets/plan.mjs`) into `public/assets/` and writes the manifest `data/assets.json`;
  `tools/local-extract/` can add art from a local game client. The client only requests URLs listed in the manifest.
  ASSETS.md.

## 5. Safety nets

- **Golden results** (`tools/golden.mjs`, `test/golden/`, `test/golden.test.js`): a fixed corpus of seeded scenarios —
  every chess with every skill and module, every bond, every leader and 联防 field, whole bot matches, every 补位
  stand-in and every 自选 operator — reduced to digests. `npm test` checks a fast subset; `npm run golden` or
  `GOLDEN_FULL=1 node --test test/golden.test.js` checks everything. A refactor must never change them; a gameplay
  change runs `npm run golden:update` and commits the new digests with the change, naming the scenarios that moved
  and why (`test/golden/README.md`).
- **Import boundaries** (`tools/check-imports.mjs`, `npm run check:imports`): `server/sim/` is served to browsers, so it
  may not import the match, the lobby, the server entry, the net layer (`ws`, `node:http` …), `public/` or any Node
  builtin; `server/match/` may not import `public/` or the net layer. The one listed exception is
  `server/sim/nodeData.js`, the Node-only data loader the browser never loads, and `test/check-imports.test.js` pins
  that list. The kit layout test (`test/content/kits_layout.test.js`) also refuses Node-only imports, clocks and
  `Math.random` in kits.
- **Lint and types.** `npm run lint` is a correctness-only ESLint (`eslint.config.js`: warnings are allowed, errors
  are not); `npm run typecheck` checks a JSDoc slice (`jsconfig.json`; `types/README.md` says how to widen it). CI
  runs both once, and the tests on Ubuntu and Windows with Node 22 and 24 (`.github/workflows/ci.yml`).
- **Tests.** `npm test` runs every suite that needs no browser (`node --test` over the test files; a bare `node --test`
  also runs the helpers and fixtures under test/); the browser suites are opt-in ([CONTRIBUTING.md](../CONTRIBUTING.md) §2).
  The battle harness `test/helpers/battleHarness.js` (SIM.md §10) sets up a battle in a few lines.

## 6. Where to start

| to change … | start at | then |
|---|---|---|
| an operator's skill, talent or module | its kit in `server/sim/content/kits/ops/` (search for the chess id or the Chinese name) | the fidelity checklist of `server/sim/content/kits/README.md`, a test in `test/content/`, golden |
| add a 自选 operator | `server/sim/content/kits/README.md`, "How to add an operator (自选)" | `op-<codename>.js`, `OPERATOR_KIT_FILES`, `test/content/op_<codename>.test.js` |
| a rule of the battle engine (blocking, damage, statuses, skills) | `server/sim/battle/`, `server/sim/attack.js`, `server/sim/attack/`, `server/sim/skills.js`, `server/sim/targeting.js`, `server/sim/ai.js` | SIM.md, DESIGN §5 |
| an enemy or a leader | `server/sim/content/enemies/`, `server/sim/content/bosses.js` | `test/content/enemies_bosses.test.js` |
| a bond, 特质, item or strategy | `server/sim/content/bonds/`, `server/sim/content/garrisons/`, `server/sim/content/items/`, `server/sim/content/bands/` (the battle side and the prep side apart) | META.md §2 |
| the shop, economy, hand or placement | `server/match/player/`, `server/match/pool.js`, `server/match/board.js` | `test/match/` |
| phases, timers, 联防, the Final Assault | `server/match/match/phases.js`, `server/match/match/unitePhase.js`, `server/match/match/bossRounds.js`, `server/match/unite.js`, `server/match/finalAssault.js` | META.md §1, §4 |
| the bots | `server/match/bot.js` | `tools/botbench.mjs` |
| a new client message | `shared/protocol.js` (`C2S`), then `server/match/match/intents.js` (or `server/lobby.js` for `room.*`) | DESIGN §8 |
| data from the official tables | `tools/build-data.mjs` | rebuild `--offline`, JSON compare, DATA.md, golden |
| a screen or a HUD panel | `public/js/screens/`, `public/js/ui/`; pure logic in `public/js/ui/gameLogic/` | `test/ui/` |
| battle visuals | `public/js/render/fx/kinds.js`, `public/js/render/units.js`, `public/js/render/spine.js` | `test/render/` |
| a UI text | `t('…')` in the code, the English in `public/i18n/en.json` | I18N.md |
| a language | `public/i18n/<code>.json` (`node tools/i18n.mjs template <code>`), no code | I18N.md "Adding a language", PACKS.md |
| a cosmetic plugin (art, models, voices, music) | `/studio/` of a running server, or `node tools/plugin.mjs new` | docs/PLUGIN-GUIDE.md, PLUGINS.md §9 / §15 |
| data / DSL / script plugin behavior | `shared/plugins/`, `server/plugins/contentSet.js`, `server/sim/content/dsl/`, `shared/plugins/sdk.js` | PLUGINS.md §10–§13, PLUGIN-DSL.md, PLUGIN-API.md |
| studio wizard, trial or import/install | `server/studio/`, `public/studio/js/`, `server/plugins/install.js`, `server/plugins/forgeImport.js` | `test/studio/`, `test/plugins/` |
| HTTP, headers, static routes | `server/http/` | `test/version.test.js`, `test/client-static.test.js` |

Before changing a rule, read the DESIGN section that owns it (module headers cite their sections; the table in
DESIGN.md names the file that holds each) and the official source; a rule no source settles is marked `[ASSUMED]`
([CONTRIBUTING.md](../CONTRIBUTING.md) §3).
