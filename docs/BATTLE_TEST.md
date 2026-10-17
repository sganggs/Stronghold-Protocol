# Battle sandbox

Open `/dev/ember-test.html` on the normal local server (`npm start`). It uses the current shared simulation,
`BattleSpec`, data loader and field renderer, like `public/dev/render-demo.js` and `public/dev/battle-perf.js`.
It loads original data through `public/js/battle/simLoader.js`, without room content sets or plugin scripts.
Use the plugin studio trial bench for plugin battles ([PLUGINS.md](PLUGINS.md) §15).
It starts paused. Configuration edits rebuild the scene; attack switches and manual damage are local test injections.

## Inspecting a scene

- Select an operator by name and toggle its elite form separately. Operators with multiple chess versions also
  show a version selector. The sandbox defaults 锡人 to tier 2, 耶拉 to tier 3, 录武官 to tier 5,
  白面鸮 / 百炼嘉维尔 / 魔王 / 华法琳 to tier 4 and 妮芙 to tier 5 (selection preferences of 2026-10-16).
  Historical versions remain selectable. Scene import restores all
  three controls from the recorded chess ID. Select a skill, module, potential 1–6 and development 0–3. Deployment follows the
  current grid and `shared/highGround.js`, including branch traits that allow melee operators on high ground.
- Choose any enemy record and variant. Leader/part scenes include the solo template, shared HP pool, devices,
  related parts and summon routes. Template routes preserve patrol and teleport legs; custom ground paths use
  the production flow field, while flying paths connect checkpoints directly.
- Enemy filters follow [PRTS's enemy roster](https://prts.wiki/w/敌人一览): rank, movement, kind, attack method
  and damage type, combined with name / ID / handbook number / ability search. The source is the generated handbook
  fields (`rank`, `stats.motion`, `tags`, `applyWay`, `stats.dmgTypes`), not a guess about scripted skills.
  Combined melee/ranged and physical/Arts records match either category. Only categories present in the data appear.
  Filters change the candidate list; selecting an enemy rebuilds the scene. An empty result keeps the current scene
  usable. Clear resets search and categories; importing a scene clears them so its recorded enemy is visible.
- Step one frame, N frames, or one second. One step uses the sim's `TICK` (1/30 game second); speed controls only
  wall-clock pacing. The panel shows integer frame count and game seconds (displayed to three decimals).
- Inspect all related enemies, HP, SP, numeric and hit-count shields, phase, state flags, blocking and isolated
  simulation errors. Script-owned SP and shields have read-only accessors; the status panel reads cached stats.
- Manual damage keeps mitigation/shields/caps. Lethal HP loss bypasses defence but still follows fatal/revival
  hooks and the boss per-hit limit. Hit-count attacks consume one hit. Every successful injection is recorded.
- A rebuild preserves simulation phase metadata. Only the sandbox imports `public/dev/battle-frames.js` and passes
  `developmentFrames: installDevelopmentFrames` when creating its view, installing the `presentLocalFrame` API.
  It accepts consecutive edits at the same
  time and holds that view's render clock. Ordinary views do not install this adapter or expose this API. Closing
  form animations start only at the simulation transition. The interpolated
  match feed (`pushSnapshot`/`pushEvents`) retains its normal timing.

## Scene JSON

Export copies JSON into the text area; Download JSON saves it. Paste JSON or select a file, then import/replay.
Import validates and reconstructs a separate scene before replacing the current one. Invalid input leaves the
current scene available. Replay Current Operations repeats the exported initial scene and all recorded operations.
Restart drops the old battle and its scheduled callbacks; late model checks cannot overwrite the new scene.
File reads (including their errors) are discarded after a newer file selection, a scene replacement/restart or teardown.

The schema is `{ schemaVersion: 1, gameVersion, dataVersion, seed, config, operations, endTick }`.
`config` contains only initial selections, deployment, routes, loadouts and attack settings. `dataVersion` fingerprints
all unlocalized simulation data returned by the loader (including bonds, items, garrisons, bands and the additional
boss/config records) with sorted keys and two 32-bit content hashes;
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

Verified against 0.3.0's `server/sim/content/devices.js`, enemy kits and boss templates:

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
# Chrome + downloaded models for the first two; replay also covers missing models and original data on a plugin server
RENDER_E2E=1 node --test test/render/battle-sandbox.browser.test.js test/render/ember.browser.test.js test/render/battle-replay.browser.test.js
node tools/i18n.mjs check --all --strict public/dev/battle-scenario.js public/dev/battle-replay.js public/dev/battle-frames.js public/dev/ember-demo.js public/dev/ember-ui.js
# Production round-start replay; verifies the ordinary view has no exact-frame adapter
SP_E2E=1 node --test test/ui/deploy-replay.e2e.test.js
```

On Windows, set `$env:RENDER_E2E='1'`; for existing production render regressions also set `$env:CHROME_PATH` to the
installed Chrome executable. Browser suites are opt-in. No gameplay or golden update is part of this tool.
