# DESIGN §34 — Changes after 0.3.0 (unreleased)

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 34. Next release — changes after 0.3.0 (unreleased)

### 34.1 Procedural multi-hit attack visuals (PR #550)

PR #550 by @CXUtk, revised after the maintainer's review. Published 0.2.6 and 0.3.0 chapters are unchanged.

**Seen.** With the official effects off or unavailable, a multi-hit arrow/bolt attack drew one tracer despite its
existing hit count; scatter attacks drew an individual arrow toward each target. Archetto's S3 had no distinct
procedural storm tracer.

**Now.** The optional fifth `atk` field carries fixed hit counts, or an explicitly opted-in dynamic count, so the
procedural renderer staggers cosmetic shots from one event without repeating the attack animation. Archetto's S3
opts in to `archetStorm`. Only Executor and Pinecone enable `shotgunWave` through their own kits: one expanding fan
follows deployment direction and current attack range, with later targets marked `shotgunWaveSkip`. Ch'en the
Holungday and other users of the shared `reaperrange` profession retain their existing effect. Executor's fan adds
five varied cosmetic pellet streaks; their randomness stays in the renderer.

**Official effects.** The 0.3.0 `FxWiring` attack/chain handling runs first. When it handles the attack, no procedural
volley or fan is drawn. Otherwise the unchanged fallback call receives the optional visual metadata. This includes
the setting being off, a 2D board and missing extracted effects; the official layer keeps its own multi-hit timing.

**[ASSUMED]** The storm tracer's palette, bow flash and impact ring, and the fan's 1.10-radian spread,
0.17-second display-time lifetime, orange/gold-white colours and pellet appearance approximate the gameplay
reference supplied by the contributor. They are not extracted official effect parameters. The fan lifetime does
not scale with the battle clock. Only the observed operators opt in; no claim is made about the official effects
of other scattershooters.

Simulation damage, projectile counts, attack animations and impact timing are unchanged. `FX_METHOD_ORDER` retains
the upstream methods, including `officialNumber`. The unrelated render-demo `recordings` parameter is excluded
from this PR. Normative: [client.md](../design/client.md); event metadata: [SIM.md](../SIM.md).

**Tests.** `test/content/kroos-volley.test.js`, `test/content/multihit-visuals.test.js` and `test/render/fxproj.test.js`
cover two/four/five-hit volleys, one fan for multiple targets, deployment-facing and range changes, independent
pellet appearance, and no opt-in on generic scattershooters or Ch'en the Holungday's skills. The upstream official
attack/chain and procedural-fallback tests remain applicable. No golden expectation changes are intended.
