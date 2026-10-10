# ARCHITECTURE.md — a map of the code

For a newcomer who wants to find their way before changing something. This file only maps the code. The contracts are
in the design document — [DESIGN.md](DESIGN.md) is its index, the current rules are in `docs/design/` (§5 the battle
engine: [design/engine.md](design/engine.md); §6 the match: [design/match.md](design/match.md); §8 the protocol and §14
client-side combat: [design/network.md](design/network.md); §9 rendering: [design/client.md](design/client.md)), the
per-release revisions and their evidence in `docs/history/`;
the details in [SIM.md](SIM.md) (battle engine, hooks, SkillSpec), [META.md](META.md) (match engine, prep-phase
effects), [DATA.md](DATA.md) (generated data), [ASSETS.md](ASSETS.md) (art and audio) and [I18N.md](I18N.md)
(languages). How to set up, test and send a change: [CONTRIBUTING.md](../CONTRIBUTING.md).

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
  match in memory — rounds, shop, economy, bots, validation. Nothing is written to disk.
- **The browser** loads native ES modules with no bundler and no build step; the libraries are vendored into
  `public/vendor/` by `tools/vendor.mjs` on `npm install`.
- **The battle simulation** (`server/sim/`) is pure ESM without any Node API, served read-only at `/sim/`. Both sides
  run it from the same JSON battle description (`server/sim/spec.js`, the BattleSpec): each player's browser simulates
  its own battle (`public/js/battle/runner.js`) and reports progress and the result; the server checks the result
  against the spec (`server/match/fields.js` `validateClientResult`), runs the battles no connected human owns (bots, a
  dropped player, an authority that missed its deadline) and can re-simulate results (`SP_VERIFY`). `SP_COMBAT=server`
  is the older mode in which the server runs every battle and streams snapshots. DESIGN §14.
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
| server → client | `room.state`, `room.closed` | `server/lobby.js` |
| | `m.public` (what every player sees), `m.private` (one player's shop, hand, funds …), `m.field`, `m.toast`, `m.ticker`, `m.emote`, `m.unitStats`, `m.result` | `server/match/match/views.js`, `server/match/player/views.js` |
| | `b.start` (a BattleSpec), `b.pool` (the shared leader HP), `b.end`; `b.snap` / `b.ev` only in the server-run mode | `server/match/match/clientCombat.js` |

- A request that carries `rid` is answered with `ok` or `error` echoing it. `server/net.js` rate-limits each socket,
  validates every message against `C2S` and refuses anything unknown; the handlers never trust the client.
- Messages meant for people (`m.toast`, `m.ticker`) carry a message id and its parameters, so each client shows them in
  its own language (`shared/i18n.js` `wireMessage`).
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
| `server/http/` | `config.js` (environment), `websocket.js` (sessions, `/ws`), `static.js` (the mounts), `media.js`, `files.js` (MIME, gzip, ETag, ranges), `buildTag.js`, `routes.js` (`/healthz`), `common.js`, `boot.js` (a pending update package first, banner, shutdown) |
| `server/net.js` | sessions and reconnect tokens, rate limits, message validation |
| `server/lobby.js` | rooms, seats, AI seats, spectators; starts a `Match` |
| `server/data.js` | loads `data/*.json` once (frozen) |
| `server/packs.js` | the content packs (PACKS.md): finds the language packs of `public/i18n/` and the pack folders of `packs/`, validates them, answers `/packs/index.json` and which pack files may be served; re-reads the folders when they change |
| `server/update.js` | the update package on the player's machine (DEPLOY.md §1.5): before the server starts, an extracted `UPDATE.json` is finished — the install verified against `MANIFEST.json`, the files the new version dropped deleted, or the start refused when the install is another version; doctor's `MANIFEST.json` check |
| `server/match/Match.js` | one match: the phase machine, timers, the round loop, co-op, the views; its methods are in `server/match/match/` (`phases.js`, `prep.js`, `combat.js`, `clientCombat.js`, `reports.js`, `unitePhase.js`, `bossRounds.js`, `settle.js`, `views.js`, `intents.js` …) |
| `server/match/PlayerState.js` | one player's shop, hand, board, items, bonds and LP, and every prep intent; its methods are in `server/match/player/` (`economy.js`, `acquire.js`, `placement.js`, `items.js`, `pieces.js`, `prep.js`, `round.js`, `diy.js`, `views.js` …) |
| `server/match/` (the rest) | `pool.js` (the shared chess pool), `board.js` (placement), `bondsMeta.js`, `effectsMeta.js` and `builtinMeta.js` (prep-phase effects), `choices.js` (机变), `waves.js`, `unite.js` (联防), `finalAssault.js`, `results.js`, `bot.js` (AI players and AI 托管), `fields.js` (the battles of a combat phase), `scheduler.js`, `gamedata.js` |
| `server/sim/Battle.js` | one battle field; its methods are in `server/sim/battle/` (`lifecycle.js`, `spawns.js`, `deploy.js`, `blocking.js`, `combat.js`, `status.js`, `summons.js`, `displacement.js`, `events.js` …) |
| `server/sim/` (the rest) | `skills.js`, `ai.js`, `damage.js`, `buffs.js`, `targeting.js`, `grid.js` (pathing), `units.js`, `professions.js`, `snapshot.js`, `spec.js` (the BattleSpec), `simdata.js` (data records → engine defs), `nodeData.js` (the Node-only data loader, never served) |
| `server/sim/content/` | everything game-specific, installed into a battle by `server/sim/content/index.js` |
| `server/sim/content/kits/` | the operator kits: `ops/` holds one file per chess (`<chessId>-<codename>.js`, 129), per 补位 stand-in (`standin-<codename>.js`, 9) and per 自选 operator (`op-<codename>.js`, 72); `shared/` the helpers several kits use; `index.js` the registry; `README.md` the guide |
| `server/sim/content/enemies/` | the enemy kits by special type (`invisible.js`, `times.js`, `element.js`, `dot.js`, `reflection.js`, `fly.js`, `special.js`) and `leaders.js`; `server/sim/content/enemies.js` dispatches them, `server/sim/content/bosses.js` scripts the leaders |
| `server/sim/content/garrisons/`, `items/`, `bands/` | 特质, equipment and strategies: `battle.js` is the battle side, `meta.js` the prep side (`registerMeta`, META §2) |
| `server/sim/content/bonds/` | the 23 bonds: `core.js` the 8 core bonds (both sides), `server/sim/content/bonds/addon/` the 15 add-on bonds (`battle.js`, `meta.js`) |
| `server/sim/content/` (the rest) | `tokens.js` (summons), `devices.js` (terrain and stage devices), `generic.js` (the kit built from a skill's data when a chess has none), `choices.js` (机变 cards in battle), `traitMods.js` (the module trait line the engine applies to every operator: 「攻击范围内存在N名及以上敌人时攻击速度+X」) |
| `shared/` | imported by the server and the browser: `protocol.js`, `constants.js`, `i18n.js`, `i18nData.js` and `i18nPacks.js` (languages), `packs.js` (the content-pack format), `standIn.js` (补位), `diy.js` (自选编队), `highGround.js`, `loadoutRecord.js` |

### Client (`public/`)

| path | what |
|---|---|
| `public/index.html`, `public/js/main.js` | the page and its entry: boot, the router (title → lobby → room → game) |
| `public/js/net.js`, `public/js/store.js`, `public/js/data.js` | the socket client, the observable store, the data loader (`/data/*.json`, with the English overlay) |
| `public/js/battle/` | `runner.js` (the local battle: loads `/sim/`, steps it, reports), `observe.js` (who may watch which field) |
| `public/js/screens/` | `title.js`, `lobby.js`, `room.js`, `loadout.js` (干员调配), `cultivation.js` (its 潜能 / 练度 controls), `ownership.js` (干员持有), `diy.js` (自选编队), `briefing.js`, `bandDraft.js`, `game.js` with `public/js/screens/game/`, `result.js` |
| `public/js/ui/` | the HUD components (`hud.js`, `shopBar.js`, `detailPanel.js`, `bondStrip.js`, `teamPanel.js` …); `public/js/ui/gameLogic/` the pure in-match logic, unit-tested in Node |
| `public/js/render/` | the field view: `app.js` with `public/js/render/app/`, `units.js` and `spine.js` (models), `tiles.js`, `projection.js`, `interp.js`, `pick.js`, `drag.js`, `public/js/render/fx/` (effects; `kinds.js` maps the fx kinds), `public/js/render/board3d/` (the official 3D board) |
| `public/css/`, `public/i18n/<code>.json` | the styles; the UI strings of each language pack (English ships) |

### Data, tools, tests

| path | what |
|---|---|
| `data/*.json` | generated by `tools/build-data.mjs` and committed — never edited by hand (DATA.md); `data/backups.json` holds the 补位 and 自选 data, `data/i18n/<code>.json` the game texts of a language pack (English), `data/assets.json` the art manifest |
| `packs/` | content packs installed as folders, `packs/<id>/pack.json` + files (PACKS.md); empty in the repository but for its readme |
| `tools/` | `build-data.mjs`, `build-i18n.mjs`, `i18n.mjs` (UI strings, language packs), `packs.mjs` (content packs), `setup.mjs` / `fetch-assets.mjs` / `tools/assets/` (art and audio), `tools/local-extract/` (art from a local game client), `vendor.mjs`, `golden.mjs`, `check-imports.mjs`, `package.mjs` / `package-update.mjs` (the release zips, the update package), `doctor.mjs`; sweeps: `matchrun.mjs`, `simrun.mjs`, `botbench.mjs`, `balance.mjs` |
| `test/` | `node:test` suites by area: `test/content/` (kits, enemies, bonds, items), `test/sim/` (the engine), `test/match/` (match engine, bots), `test/ui/`, `test/render/`, `test/golden/` (the stored digests), `test/helpers/` (`battleHarness.js`; `designDocs.js`, the design document in § order for the doc tests), `test/e2e/` (browser and bot runs) |
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
public/assets/ ─────────▶ public/js/render/, public/js/audio.js (URLs listed in data/assets.json)
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
- **Tests.** `node --test` runs every suite that needs no browser; the browser suites are opt-in ([CONTRIBUTING.md](../CONTRIBUTING.md) §2).
  The battle harness `test/helpers/battleHarness.js` (SIM.md §10) sets up a battle in a few lines.

## 6. Where to start

| to change … | start at | then |
|---|---|---|
| an operator's skill, talent or module | its kit in `server/sim/content/kits/ops/` (search for the chess id or the Chinese name) | the fidelity checklist of `server/sim/content/kits/README.md`, a test in `test/content/`, golden |
| add a 自选 operator | `server/sim/content/kits/README.md`, "How to add an operator (自选)" | `op-<codename>.js`, `OPERATOR_KIT_FILES`, `test/content/op_<codename>.test.js` |
| a rule of the battle engine (blocking, damage, statuses, skills) | `server/sim/battle/`, `server/sim/damage.js`, `server/sim/skills.js`, `server/sim/targeting.js`, `server/sim/ai.js` | SIM.md, DESIGN §5 |
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
| HTTP, headers, static routes | `server/http/` | `test/version.test.js`, `test/client-static.test.js` |

Before changing a rule, read the DESIGN section that owns it (module headers cite their sections; the table in
DESIGN.md names the file that holds each) and the official source; a rule no source settles is marked `[ASSUMED]`
([CONTRIBUTING.md](../CONTRIBUTING.md) §3).
