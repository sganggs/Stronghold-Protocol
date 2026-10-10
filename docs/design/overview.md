# DESIGN §0, §1, §2, §11, §12 — Scope, stack, repository layout, quality bar

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 0. Product scope (v1)

A faithful, polished, **online co-op** browser remake of Arknights' seasonal auto-chess TD mode 「卫戍协议：盟约」(下半, `act2autochess`).

In scope:
- Title → lobby (nickname, create room / join by 4-letter code or `?room=CODE` link, host picks difficulty, up to 4 players, **AI teammates** can fill seats, ready/start). Solo (独立模拟) and co-op (同盟模拟, 1–4 humans + optional AI).
- Difficulties: 标准 FUNNY, 险境 NORMAL, 绝境 HARD, 终极 ABYSS (solo and multi variants from `modeDataDict`). Training/tutorial mode is out of scope.
- Pre-game: INFO_CHECK briefing (disabled bonds, banned operators, enemy factions, stage) → BAND_CHECK strategy draft (40 bands, random order, 1 skip in co-op) → BATTLE_CHECK.
- Rounds 1–14 (+ hidden 15): prep (shop, hand, board, items, freeze, refresh, level-up, sell, merge + reward pick, ready), 机变 draft rounds, simultaneous auto-combat on each player's own field, 联防 unite phase, LP loss/elimination, Final Assault boss round with merged LP and shared boss HP pool, Hidden Core, settlement with titles.
- Full content: 112 visible chess (+ elites), their default skills and talents, 23 bonds with layers, all 43 特质 (garrison) effect keys, 56 equipment + Arts, 40 bands, 机变 cards, enemy factions/special enemies, 10 bosses, stage devices/terrain (crates, blowers, mire, smog, deep sea, infection).
- Rendering with the real Spine battle chibis (PixiJS 7 + pixi-spine 4), procedural tiles, VFX, damage numbers, real BGM/SFX, emotes, broadcast ticker.
- Reconnect, AI take-over of disconnected players, robust validation of every client intent.

New features require explicit maintainer approval before implementation. The 2026-10-10 review approved retaining
the existing PWA installation, unanimous opening reroll, teammate emotes and cooperative purchasing heuristic
(DESIGN §28.15, §28.16, §28.19, §28.21); this is not blanket approval for future additions.

Out of scope v1: matchmaking queue, training/tutorial, DIY (甄选) slots (the 4 DIY chess are removed from the shared pool — 0.2.0 plays them as 自选编队: the picks of the 干员调配 overlay's 自选编队 tab, each sold only in its player's shop; DATA.md §18, shared/diy.js, server/match/player/diy.js), trophies/progression persistence, reporting.

---

## 1. Tech stack

- **Node.js ≥ 22** (CI: 22 and 24), ESM (`"type": "module"`), single dependency `ws@8`. No bundler, no TypeScript. JSDoc types where helpful.
- **Server-authoritative simulation.** Clients send *intents*; the server validates, mutates state and pushes state/snapshots.
- **Client:** static files, native ES modules. Vendored libs in `public/vendor/`: `pixi.min.js` (PixiJS **7.4.2** UMD, global `PIXI`), `pixi-spine.js` (**4.0.6** UMD, `PIXI.spine`), `preact.module.js` + `hooks.module.js` + `htm.module.js` (Preact 10 + htm, no build step). No CDN at runtime (LAN play must work offline).
- **Shared code** in `shared/` is imported by both server and browser (pure ESM, no Node APIs).
- Tests: `node --test` (`test/**/*.test.js`). Browser E2E: `puppeteer-core` driving the system Chrome (dev dependency, optional; puppeteer-core 25 is ESM-only and needs Node ≥ 22.12, so the suites load it with `await import`).

Run: `npm install && npm run assets && npm start` → `http://localhost:3000`. Friends on LAN use `http://<host-ip>:3000`. Internet play: a tunnel (e.g. `cloudflared tunnel --url http://localhost:3000`) or any Node host (Dockerfile provided).

---

## 2. Repository layout & ownership

```
server/
  index.js                 process entry: startServer() wires server/http/ (plain node:http + ws); boots when run directly
  http/
    config.js              ROOT, served dirs, env (PORT, HOST, TRUST_PROXY, DEBUG), options handed to net.js / lobby.js
    websocket.js           session wiring (SessionRegistry → Lobby → Network), WebSocket upgrade at /ws (64 KB frames)
    static.js              mounts / → public, /data/, /shared/, /sim/ (.js only), the /data.js browser stand-in, path guards
    media.js               /media/… extension-less audio → public/assets/audio
    files.js               one file → response: MIME, gzip (.skel/.atlas/.json/.js/.css …), ETag / 304, cache policy, ranges
    buildTag.js            build tag of the served browser runtime (/healthz build, public/js/ui/buildGuard.js)
    routes.js              request listener: 414 / 400 / 405 guards, GET /healthz, then static files
    common.js              security headers, URL split, error page, JSON replies, bare 400 for unparseable requests
    boot.js                boot banner (Local / LAN / tunnel URLs), port-in-use hint, graceful SIGINT / SIGTERM
  net.js                   session registry, send helpers, per-connection rate limit, message validation (uses shared/protocol.js)
  lobby.js                 rooms (4-letter codes), seats, host, AI seats, ready/start, reconnect tokens, room→Match wiring
  data.js                  loads data/*.json once, builds indexes (getChess, getBond, …); frozen objects
  match/
    Match.js               match state machine, timers, round loop, co-op orchestration, broadcasting views — the class:
                           the lobby⇄match interface (header), constructor + method install
    match/                 Match's methods by concern (platform, infra, messaging, views, watch, intents, pause, phases,
                           spDraft, prep, combat, clientCombat, reports, unitePhase, bossRounds, settle; shared constants
                           in common.js), installed on Match.prototype
    PlayerState.js         per-player economy/shop/hand/board/items/bonds/LP state + all prep-intent handlers — the class:
                           constructor + method install
    player/                PlayerState's methods by concern (basics, pieces, acquire, economy, placement, items, prep,
                           round, views; common.js), installed on PlayerState.prototype
    pool.js                SharedPool (copies per base chess), banned/disabled bonds, odds & rolls
    board.js               placement legality, deploy cap, hand/temp management, merge detection & execution
    bondsMeta.js           bond member counting (BOARD / BOARD_AND_DECK / golden), activation tiers, persistent layers
    effectsMeta.js         registry + dispatcher of prep-phase ("SERVER_*") effects: garrisons, bands, items, bonds
    choices.js             机变 draft: card generation per family, pick order, timeouts, application
    waves.js               match enemy factions, per-round spawn list generation, stat scaling, bounties
    unite.js               联防 helper selection, leaked-enemy aggregation, LP attribution
    finalAssault.js        R14/R15 pairing, merged LP, shared boss HP pool, overtime drain
    results.js             settlement stats, titles (评语)
    bot.js                 AI player (plays prep phases; also auto-play for disconnected humans)
  sim/
    Battle.js              one field simulation (normal / unite / boss); public API §5 — the class: constructor + method install
    battle/                Battle's methods by concern (players, lifecycle, hooks, spawns, deploy, blocking, status, combat,
                           queries, summons, tiles, displacement, economy, events), installed on Battle.prototype
    constants.js           TICK, conversions, tuning knobs
    rng.js                 seeded PRNG (mulberry32) + helpers
    grid.js                field grid, tile queries, passability, official 4-direction SPFA flow field + line-of-sight smoothing, road-over-floor preference only where it crosses fewer floor tiles (§21.15); DEPLOY_REFUSED_TILES (深水区, §21.3)
    units.js               Unit / Operator / Enemy / Token classes, stat aggregation
    buffs.js               Buff model, status catalogue (stun, freeze, cold, sleep, slow, fragile, stealth, …)
    damage.js              damage & heal pipeline, element gauges
    targeting.js           target selection helpers, range tests, priorities
    body.js                hit areas of huge enemies: the one helper behind every range test on enemies (§3, §19.4)
    projectiles.js         projectile flight/impact
    skills.js              skill runtime: SP, triggers, durations, ammo, charges; interprets SkillSpec
    ai.js                  enemy movement/attack AI, operator attack loop
    fear.js                恐惧 movement of enemies (reachable-tile fan, random checkpoints, self-fear flutter; §20.4)
    snapshot.js            compact serialization for clients
    content/
      index.js             installs all content into a Battle (kits, bonds, garrisons, items, bands, enemies, devices)
      kits/index.js        operator kit registry keyed by base chessId (guide: kits/README.md)
      kits/ops/*.js        one operator kit (skills + talents) per file, <chessId>-<codename>.js
      kits/shared/*.js     helpers the kits share (shared/tier1.js: the general ones)
      tokens.js            summon/token definitions
      bonds.js             battle side of the 23 bonds
      garrisons.js         battle side (IN_BATTLE) garrison effect keys
      items.js             battle side of equipment + Arts
      bands.js             battle side of band (strategy) effects
      enemies.js           enemy ability specs + generic special-type behaviours: dispatch hooks, KITS, STATS_ONLY
      enemies/             helpers.js, archetypes.js, one kit file per special type (invisible, times, element, dot,
                           reflection, fly, special) and leaders.js — each with its part of KITS
      bosses.js            boss scripts (boss_1 … boss_10)
      devices.js           stage devices & special terrain
shared/
  constants.js             enums, phases, areas, error codes, UI-relevant constants
  protocol.js              message catalogue + validators (§8)
  format.js                rich-text description → HTML/plain; number formatting
  rules.js                 pure helpers shared by UI & server (e.g. price display, sell value, bond tier from count)
data/                      generated by tools/build-data.mjs — committed; see docs/DATA.md
public/
  index.html               single page; loads /js/main.js as module
  css/                     theme.css (tokens, fonts), components.css, screens/*.css
  js/
    main.js                boot, router between screens, global store
    net.js                 WebSocket client, reconnect, request/response helpers
    store.js               tiny observable store (state from server + local UI state)
    data.js                fetches /data/*.json, same indexes as server/data.js
    audio.js               BGM/SFX manager (Web Audio), volume settings
    assets.js              asset URLs, image cache, Spine loader with LRU + fallback
    screens/               title.js, lobby.js, room.js, briefing.js, bandDraft.js, game.js (entry; game/*.js plates, marks, early events), result.js
    ui/                    hud.js, bondStrip.js, bondPopup.js, shopBar.js, teamPanel.js, detailPanel.js,
                           tooltip.js, choiceOverlay.js, rewardOverlay.js, ticker.js, emotes.js, settings.js, toasts.js,
                           gameLogic.js (barrel; gameLogic/*.js placement, bonds, phases, shop, loadout)
    render/                app.js (field view; app/*.js helpers), projection.js, tiles.js, units.js, spine.js, fx.js (effects; fx/*.js), interp.js, drag.js, pick.js, promote.js (API §9)
  vendor/                  pixi, pixi-spine, preact, hooks, htm (copied from node_modules by tools/vendor.mjs)
  assets/                  downloaded art/audio (git-ignored), see docs/ASSETS.md
  fonts/                   self-hosted fonts
tools/
  build-data.mjs           official data + research JSON → data/*.json
  fetch-assets.mjs         downloads/optimizes assets → public/assets + data/assets.json
  vendor.mjs               copies vendor libs from node_modules → public/vendor
test/                      node:test suites; test/e2e/ browser + bot tests
docs/                      DESIGN.md (the index of this document: the rules in design/, the per-release revisions in
                           history/), ARCHITECTURE.md, DATA.md, SIM.md, META.md, I18N.md, ASSETS.md, BALANCE.md,
                           DEPLOY.md, PLAYING.md, WINDOWS.md, research/
                           (the wire protocol is normative in shared/protocol.js itself)
LICENSE                    GPL-3.0-or-later (the project's code); NOTICE.md: scope, non-commercial game assets, the Spine
                           Runtimes linking permission; THIRD-PARTY-NOTICES.md: libraries, fonts, data sources
```

Ownership rule for parallel agents: **only edit files assigned to you**; if you need a change in someone else's file, write it in your final report instead (the integrator applies it). Shared files (`shared/*`, `docs/DESIGN.md`) are owned by the architect.

---

## 11. Quality bar & testing

- **No crash paths**: every server handler guarded; a thrown error inside a Battle tick for one field must not kill the match (log, force-end that battle as timeout, continue). Invariants asserted in tests: no NaN/Infinity in any unit field; hp ∈ [0, maxHp]; positions inside rect; battles terminate within `timeLimit + 1 s` (boss: terminate by pool/force); pool copy counts never negative and never exceed caps; funds never negative; hand/temp sizes respected.
- Unit tests per module; content tests per effect; **full-match bot tests**: 1/2/4-player matches of every difficulty with fixed seeds run to RESULT headlessly (fast-forward: no real-time pacing) with zero errors; protocol fuzz (random/invalid intents) never crashes and never corrupts state.
- **Browser E2E** (puppeteer-core + system Chrome): open 2 tabs, create/join room, add AI, play through prep/combat of several rounds, zero console errors, screenshots saved to `test/e2e/out/` for visual review.
- Performance: a normal battle tick with 60 enemies + 10 ops < 0.5 ms; 4 parallel fields at 2× real time < 15% CPU of one core; the heavy 2-player boss field (18 ops, ~130 enemies alive, `test/sim/robustness.test.js`) < 0.5 ms per tick on a development machine, the best of three runs of the same battle — 1.0 ms when `process.env.CI` is set (GitHub's shared windows runners measured 0.51–0.58 ms and failed the 0.5 ms bar on PR #10, #12, #14 and master's own push; a real regression still shows locally).

---

## 12. Implementation phases

1. **Foundation**: build-data, fetch-assets/vendor, server platform (http/ws/lobby), client shell (screens up to room).
2. **Core**: sim engine + harness; match/meta; render engine; game UI.
3. **Content**: kits, bonds, garrisons, items, bands, enemies/bosses/devices, choices.
4. **Integration & QA**: wire everything, bots, E2E, balance pass, bug-hunt workflows until dry, visual polish.

---
