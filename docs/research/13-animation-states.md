# 13 · Enemy animation states: the clips the sprite data ships but the role mapping never reached

Companion to the flying-visuals write-up (12) and the death-animation one (13). A sweep of every enemy's Spine model
against the manifest's animation roles (`data/assets.json` `anims`) found whole *state families* whose clips no role
references — a multi-skill boss's extra cast animations, a stun family spelled three ways, a Run cycle, and the revive
forms. This file records what was measured, what turned out to be already wired, and what was fixed.

## 0. TL;DR

- **No clip the roles name is missing from its skeleton, and no declared duration disagrees** (251 enemies, 1562 role
  references, 0 mismatches) — the role mapping itself is sound. What was missing was *coverage*: 34 enemies carry
  several skill clips, 6 carry stun clips in two spellings, 3 carry a Run cycle, 13 carry a Revive clip.
- **Multi-skill enemies could only ever show their first skill clip** (盐风主教昆图斯 has `Skill_01..04` for ten
  abilities): the asset plan asked for one slot, and nothing told the client which slot was casting. Both fixed — the
  manifest gained **200** `anims.skills.*` paths across 18 models, the sim raises a `['cast', id, slot]` event
  (DESIGN §14) and `UnitInfo.skillIndex` now covers enemies, the renderer swaps the clip (`UnitView.setSkillSlot`).
- **The Revive clips were mostly already wired** — by the client's own `FORMS` table, not by the role mapping. Two
  enemies that the sim revives had no form set (巨大的丑东西, 自在); they do now.
- **The stun family is spelled `Stun` / `Stun_1`+`Stun_2` / `Dizzy_*`** and the resolver only knew the first: 3 models
  had a stun clip and no role, so a stunned enemy was drawn as its current clip frozen at timeScale 0. Now all **16**
  models with a stun clip have the role.
- **猎狗pro walks instead of running**: it ships `Move_Loop` 0.80 s next to `Run_Loop` 0.53 s and its `stats.moveSpeed`
  is 1.9, the fastest common value in the data. The Run cycle is now its own role and a fast mover walks on it.
- **Only two of the families are visible in this mode at all** (`data/waves.json`): Run (猎狗pro) and Back/Launch (the
  two 胄 parts). Combat (4 enemies) and Start/Appear (2) are never spawned here, so wiring them would be unobservable.

## 1. How the sweep was done [DATA]

`tools/local-extract/enemy_animation_motion.mjs` (added with 13) plays every clip of every model and samples bone world
positions. For this write-up its output was cross-referenced against three things: the manifest's roles
(`data/assets.json`), the mode's spawn list (`data/waves.json`) and the sim's own content
(`server/sim/content/*.js`).

Do **not** try to read the timelines directly: in this build of `@pixi-spine/runtime-3.8` they hold packed numeric
arrays (`timeline.frames[0]` is a number, not `{time, x, y}`), so a keyframe walk silently reports zero motion. Play the
clip and sample the skeleton instead.

The visibility filter matters as much as the sweep: a clip family nothing spawns cannot be verified in game, so it is
recorded here rather than wired.

## 2. The families, and which of them this mode can show

| family | enemies with the clips | spawned by this mode? | outcome |
|---|---|---|---|
| skill slots (`Skill_01..04`, `Skill_1..3`, `Skill2_*`) | 34 enemies (15 with two or more skills in the data) | yes | **fixed** (§3) |
| Revive (`Revive`, `Revive_01`, `Revive1..3`, `A_revive_1..3`, `Revive_Begin/Loop/End`) | 13 | yes | mostly already wired via `FORMS`; **two fixed** (§4) |
| stun (`Stun`, `Stun_1/2`, `Dizzy_Begin/Loop/End`) | 6 | 4 of them | **fixed** (§5) |
| Run (`Run_Begin/Loop/End`, `Run`) | 3 | 猎狗pro | **fixed** (§6) |
| Back / Launch (`Back_*`, `Launch_*`) | “斩胄之剑”, “破胄之锤” | yes | open: their `immunities.levitate` makes 击飞 unreachable and 击退 needs the sim's push state mapped to a clip |
| Combat (`Combat`, `Combat_End`, `Combat_NoPre`) | 隐形弩手, 隐形弩手组长, 碎骨, “邪魔的利刃” | **no** | not wired — unobservable |
| Start / Appear / Disappear | 寻险水手, 弑君者 | **no** | not wired — unobservable |

## 3. Multi-skill enemies: two things kept the extra clips unreachable [DATA]

**The plan asked for one slot.** `tools/assets/plan.mjs` built every enemy model with `skillIndices: [0]`, and
`resolveRoles` emits `roles.skills` only when it is given more than one index — so the manifest never carried the
per-slot clips. Fixed inside `resolveRoles`: the numbered clips in the skeleton (`Skill_1`, `Skill_01`, `Skill_2_…`) are
detected and appended to the requested indices, while the caller's own order still decides which index is
`roles.skill` (a character's equipped skill — that order is load-bearing, and an early version of this fix that sorted
the indices broke it; the manifest writer's shrink guard caught it before anything was written).

**Nothing told the client which slot was casting.** The snapshot's `skillIndex` was sent for allies only
(`u.side === 'ally'`), and enemy abilities announced no slot. Now an ability that fires reports it
(`content/enemies.js` `castSkillSlot`: an explicit `a.index`, else the `data skills[].prefabKey` that names the ability —
盐风主教昆图斯's kit already names its abilities `Tidewater` / `Rockfall` / `SummonTentac`, i.e. data skills 0–2), which
raises `['cast', id, slot]` (DESIGN §14) and fills `UnitInfo.skillIndex`; the renderer swaps to that slot's clip
(`render/app.js` `case 'cast'` → `UnitView.setSkillSlot` → `SpineActor.setSkillIndex`).

Regenerating the manifest added **200** `anims.skills.*` paths across **18** models and removed none.

Remaining: the other multi-skill enemies need one line each in their kits — either `id: '<prefabKey>'` on the ability
(most kits name their abilities differently: 鼠王's `DriftSand` / `SandStorm` / `Mark` appear nowhere in the source) or an
explicit `index`. The mechanism, the data and the client are all in place.

## 4. Revive: mostly already wired — by `FORMS`, not by the roles [DATA]

The sweep lists every clip the **roles** never reference, which included `Revive*` for 13 enemies; that reads like
"their revive animations are unused". They are not: `render/units.js` **`FORMS`** drives them, keyed by Spine id, from
the sim's `form` (a `reborn()` / `husk()` / `statue()` fx carries it). Verified per key: 深池逐火战士 / 精锐战士 / 护卫
(`husk` → `Revive`, timed from the 1 s 重生), 假想敌：再生 (`husk` → `B_Revive`), 锏 (`Revive1/2/3`), 扎罗
(`A_revive_1/2/3`) and “复仇者” (`Revive_Begin/Loop/End`) were all covered.

Two were not — their skeletons carry the clip, the sim runs a `reborn()` with a second form, and `FORMS` had no entry:

| enemy | sim | clip | fixed to |
|---|---|---|---|
| “巨大的丑东西” `enemy_1512_mcmstr` | `kitUglyThing`: KO ⇒ `reborn.duration` 10 s ⇒ the fleeing 大祭司 | `Revive` 8.67 s | `reborn: { change: 'Revive', next: 'form2' }`, `form2: Idle_2 / Move_2 / Die` (the 大祭司 never attacks) |
| “自在” `enemy_1517_xi` | `kitXi`: KO ⇒ 5 s 重生 ⇒ the same model with `reborn.atk` | `Revive_01` 5.33 s | `reborn: { change: 'Revive_01', next: 'form2' }`, `form2: {}` (no clip change) |

Both use the skeleton's Revive clip as the form's `change` (played once; `SpineActor.setForm` holds mode `change` until
it ends, so attacks and the resting state wait), and neither kit stuns the enemy during the 重生 (`reborn()` sets
invulnerable / untargetable / unblockable only).

Left alone on purpose: 假想敌：胄 ×2 and “斩胄之剑” / “破胄之锤” also have a `Revive` clip (4.43 s), but the sim has no
revive state for them, so a form set would be dead code.

## 5. The stun family: two spellings, sometimes numbered [DATA]

Six enemies carry a stun clip, in three spellings: `Stun` / `Stun_End` (吉兆飞鳞 — also the only one with a `Stun_Die`
—, 乌顶巨角卢鲁, and four tokens/operators), `Stun_1` / `Stun_2` (“巨大的丑东西” — two variants, the first is the loop)
and `Dizzy_Begin/Loop/End/Die` (“斩胄之剑” / “破胄之锤”). `resolveStun` only looked for `Stun` / `Stun_Begin` /
`Stun_End`, so the last two families resolved to no role at all — and a stunned enemy with no `anims.stun` is drawn by
the client's fallback: the **current clip frozen at timeScale 0**, not a dizzy animation.

`resolveStun` now tries `Stun` → `Stun_1` → `Dizzy_Loop` for the loop (with the matching `*_Begin` / `*_End`), which
added the role for three models: **9 added paths, all `anims.stun.*`; 3 removed, the explicit `anims.stun: null` they
replace**. All 16 models with a stun clip now have a role. Which of them can be stunned (`data/enemies.json`
`immunities.stun`; **226 of 251** enemies can):

| enemy | stun-immune? | effect |
|---|---|---|
| “巨大的丑东西” `enemy_1512_mcmstr` | no | **visible**: a stunned 丑东西 plays `Stun_1` instead of freezing |
| “斩胄之剑” `enemy_9014_acstma` / “破胄之锤” `enemy_9015_acstmb` | **yes** | none in this mode — the mapping is truthful, the clips stay unreachable |

Remaining: the `*_Die` clips (dying while stunned) have no role — `roles.die` is fixed by the manifest, so a stunned
death plays the plain `Die`. The only place that is reachable today is 吉兆飞鳞's `Stun_Die`.

## 6. 猎狗pro walks instead of running [DATA]

Its skeleton ships `Move_Begin/Move_Loop/Move_End` (0.17 / **0.80** / 0.17 s) **next to** `Run_Begin/Run_Loop/Run_End`
(0.17 / **0.53** / 0.17 s) — a 1.5× faster cycle — its description says 行动速度很快 and its `stats.moveSpeed` is
**1.9**, the highest common value in the data (42 of 249 enemies are above the standard 1; only three models ship a Run
cycle at all, so the rule can only ever fire where the clips exist). The move role keeps its own choice (`resolveMove`
still prefers `Move`); the new `run` role carries the Run set beside it.

- `tools/assets/anim-roles.mjs`: `resolveRun` + `roles.run` (only when the skeleton has the cycle) + validation through
  `roleAnimationNames`. Regenerating added **18 paths, all `anims.run.*`, and removed none** (6 models).
- `render/spine.js`: `SpineActor.setRunMode(on)` swaps `roles.move` for `anims.run` (through a shared `_applyRoles`, so
  it composes with `setSkillIndex`).
- `render/units.js`: a view of an enemy whose `stats.moveSpeed` is above 1 calls `setRunMode(true)` when its model is
  built. `[ASSUMED]` the threshold: the client's own trigger is unknown, but a model that ships a faster cycle and an
  enemy documented as fast should use it.

## 7. Implementation summary

| area | change |
|---|---|
| roles | `resolveRoles` detects numbered skill clips; `resolveStun` knows `Stun_1` / `Dizzy_*`; `resolveRun` adds `roles.run`; `roleAnimationNames` validates both new roles |
| data | `data/assets.json` regenerated: **227 added paths** (200 `anims.skills.*`, 18 `anims.run.*`, 9 `anims.stun.*`), **3 removed** (the `anims.stun: null` the new roles replace), the hash and `stats.bytes` the only other differences |
| sim | `content/enemies.js` `castSkillSlot` + the `cast` event; `content/bosses.js` names 昆图斯's abilities; `snapshot.js` carries `skillIndex` for enemies |
| client | `SpineActor._applyRoles` / `setSkillIndex` / `setRunMode`; `UnitView.setSkillSlot` / `moveFast`; the two `FORMS` entries; `render/app.js` `case 'cast'` |
| docs | DESIGN §8.2/§14 (`cast`, the enemy `skillIndex`), this file, `00-INDEX.md` |
| tests | `test/assets.test.js` (the resolver families + two whole-manifest guards: every model with a stun clip has a stun role, every model with a Run clip a run role), `test/content/enemies_bosses.test.js` (a real 昆图斯 battle reports slots 0–2), `test/render/loadout-skill.test.js` (an enemy cast slot swaps the clip), `test/render/forms.test.js` (the two 重生 sets + every clip `FORMS` names exists in its manifest), `test/render/unitview.test.js` (a fast mover walks on `Run_Loop`, and the cast slot and run cycle compose) |

The sim change raises a new event, so the golden digests move: run `npm run golden:update` (`node tools/golden.mjs
--update`) when merging this.
