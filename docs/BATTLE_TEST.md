# Battle sandbox

Open `/dev/ember-test.html` on the normal local server (`npm start`). It uses the current shared simulation,
`BattleSpec`, data loader and field renderer, like `public/dev/render-demo.js` and `public/dev/battle-perf.js`.
It starts paused. Configuration edits rebuild the scene; attack switches and manual damage are local test injections.

## Inspecting a scene

- Select a real normal/elite operator, skill, module, potential 1–6 and development 0–3. Deployment follows the
  current grid and `shared/highGround.js`, including branch traits that allow melee operators on high ground.
- Choose any enemy record and variant. Leader/part scenes include the solo template, shared HP pool, devices,
  related parts and summon routes. Template routes preserve patrol and teleport legs; custom ground paths use
  the production flow field, while flying paths connect checkpoints directly.
- Step one frame, N frames, or one second. One step uses the sim's `TICK` (1/30 game second); speed controls only
  wall-clock pacing. The panel shows integer frame count and game seconds (displayed to three decimals).
- Inspect all related enemies, HP, SP, numeric and hit-count shields, phase, state flags, blocking and isolated
  simulation errors. Script-owned SP and shields have read-only accessors; the status panel reads cached stats.
- Manual damage keeps mitigation/shields/caps. Lethal HP loss bypasses defence but still follows fatal/revival
  hooks and the boss per-hit limit. Hit-count attacks consume one hit. Every successful injection is recorded.
- A rebuild preserves simulation phase metadata. `presentLocalFrame` accepts consecutive edits at the same time
  and holds the render clock. Closing form animations start only at the simulation transition. The interpolated
  match feed (`pushSnapshot`/`pushEvents`) retains its normal timing.

## Scene JSON

Export copies JSON into the text area; Download JSON saves it. Paste JSON or select a file, then import/replay.
Import validates and reconstructs a separate scene before replacing the current one. Invalid input leaves the
current scene available. Replay Current Operations repeats the exported initial scene and all recorded operations.
Restart drops the old battle and its scheduled callbacks; late model checks cannot overwrite the new scene.

The schema is `{ schemaVersion: 1, gameVersion, dataVersion, seed, config, operations, endTick }`.
`config` contains only initial selections, deployment, routes, loadouts and attack settings. `dataVersion` fingerprints
all unlocalized simulation data (including boss/config records) with sorted keys and two 32-bit content hashes;
it is a diagnostic fingerprint, not a cryptographic authenticity check. No Unit, Battle, timer or other runtime
object is serialized. A game/data mismatch is shown explicitly; reproducing the original result then requires the
original checkout and data.

[ASSUMED] The development replay convention is **tick 0 after initial deployment/spawn hooks, before the first
simulation step**; tick N operations run after exactly N steps. Operations sort by `(tick, sequence)`; each tick's
sequence starts at zero and has no gaps or duplicates. Supported types:

| type | payload |
|---|---|
| `autoAttack` | `side: 'ally'|'enemy'`, `enabled: boolean` |
| `damage` | `targetId`, positive `amount`, `damageType: 'phys'|'arts'|'true'`, `lethal`, `hit` |
| `retreat` | `targetId` (the selected operator) |

The same data, initial configuration, seed and operations reproduce the same simulation result. The importer checks
schema, unknown fields/types, IDs, loadouts, coordinates, reachability, booleans and numeric bounds. Limits: 2 MB JSON,
64 checkpoints, 10,000 operations, 18,000 ticks; ordinary scenarios also retain the production 300-second timeout.
Logs retain 200 entries and support type filtering and copying the retained matching entries. Filtering never
changes the recorded operation sequence.

## Current support and limitations

Verified against 0.2.4's `server/sim/content/devices.js`, enemy kits and boss templates:

- act1 m01–m04 and act2 m01–m04 use the implemented map rules. act1 m05–m07 are rejected because water platforms,
  sandstorm/mounds and bushes remain unimplemented in the sim (their season weights are zero).
- Terrain-dependent enemies suggest a matching map/spawn and report when the chosen map cannot activate a terrain
  ability. This does not supply extra terrain or alter enemy definitions.
- `enemy_9016_acstmr` cannot be selected independently: its leader's skill must bind an actual target and construct
  its tracking route. Select `enemy_9013_acstmk` instead. Other token-only enemies use their real leader context when
  one exists; spawned children remain observable in the state panel and damage target list.
- Attack controls suppress the local ordinary attack loop, including the scripted attacks of deer and pipe/string;
  independent skills, phase timers and summons continue. The scene uses no bonds, items, multiplayer or meta-phase
  choices and therefore is not a complete match reproduction tool.
- Spine availability depends on local assets. Missing manifest entries or load errors are reported; the renderer's
  fallback and the simulation state remain usable. Model playback is visual, never the source of a revival/phase.

## Validation

```bash
node --test test/content/battle_scenario.test.js test/content/battle_replay.test.js test/content/ember_scenario.test.js
# Chrome + downloaded models for the first two; the replay suite also exercises missing-model fallback
RENDER_E2E=1 node --test test/render/battle-sandbox.browser.test.js test/render/ember.browser.test.js test/render/battle-replay.browser.test.js
node tools/i18n.mjs check --all --strict public/dev/battle-scenario.js public/dev/battle-replay.js public/dev/ember-demo.js public/dev/ember-ui.js
```

On Windows, set `$env:RENDER_E2E='1'`; for existing production render regressions also set `$env:CHROME_PATH` to the
installed Chrome executable. Browser suites are opt-in. No gameplay or golden update is part of this tool.
