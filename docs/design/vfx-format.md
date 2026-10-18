# DESIGN §33 — Official battle effects (特效): the extracted format

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

**Changelog** (for runtimes reading the files; newest first)

* **2026-10-16 — lingering areas: readings from the client's data and code, no format change (0.3.1, the maintainer's
  report of 2026-10-16; history 0.3.1 §34.5)**. (1) A ground-placed effect's root (`ParticleEffect._spawnLocation` 5,
  7, 17, 26, 35) sits on its point: the client's Effect._InitLocationFromEntity sets the root's localPosition to the
  spawn location, so its authored `pos` is no offset (§33.4; the next entry extends this to every root) — 萨卡兹枯朽战士's `enemy_nhpbr_attack_range` is saved with
  its root 10 tiles under the board. (2) An enemy's kit areas are its talents' and skills' projectiles and rows the
  index writes without the moment they play (a death talent's projectile, a skill's second projectile, a castTarget row
  of a skill its kit fires itself): §33.16 reads them for the sim's zone fx (ENEMY_FX_BINDINGS). (3) An enemy skill
  whose root ability is an attack is that one attack: its kit fx drawn, its window's later attacks are the enemy's own
  (§33.16 Enemy skills). (4) A talent loop created by a buff at its
  tick in a mode (水遁忍者's RotateEffect) plays while that mode lasts (§33.16).
* **2026-10-16 (2) — where an effect stands and how big its particles are, from the client's code and data, no format
  change (0.3.1: the maintainer's report of 2026-10-16, history §34.6)**. (1) A prefab root's own transform is no part
  of the effect: the client sets the root's position where it plays it, and a projectile's flying effect sits on the
  projectile's body (§33.4); 203 prefabs have an authored root position — 安洁莉娜 S2's orbs were drawn 0.94 tile above
  their path. (2) An effect at FOOT_POINT, HIT_POINT or HEAD_POINT takes the unit's Graphic tilt (−30° about X, its
  skin animator's rotation), MUZZLE_POINT_WITHOUT_ROTATION, NONE, the ground spawns and an effect played at a map
  position none (§33.2, §33.11): the effects authored standing (荒芜拉普兰德 S3's seal, 能天使 S3's light bars) stand facing
  the camera. (3) A renderer's `m_Pivot` moves the particle by + pivot × size along its own axes, a stretched billboard
  included: pivot.y × the particle's Y size along the velocity and pivot.x × its X size across, not along the stretched
  length (§33.6). (4) A local-space particle is drawn at its scaling mode's scale as it is now, and a particle's size is × that scale per axis
  whether or not its system has `size3D` (§33.5). (5) A projectile whose movement has `comeBack` flies back to its
  source after its hit at the come-back speed toward the HitPoint as it is now (§33.12 Projectile). `delayAfterReached`
  of 1 on the Paracurve / NarantS3 come-back projectiles is a flag; the wait is `delayTime` 0.01 s, under one sim tick,
  and the visual turns back on the hit with the sim.

* **2026-10-16 — readings corrected from the client's data and code, no format change (0.3.1: the 0.3.0 effects audit's
  R18–R21 and its low-confidence observations; history 0.3.1)**. (1) A prefab's root node is active when the effect
  plays, whatever its `active` (§33.4): 35 prefabs of the used set are saved with an inactive root. (2) A stretched
  billboard runs the particle's Y size along its velocity and its X size across (§33.6). (3) An effect whose root
  `static_offset` node lies deeper in the board than its anchor (`pos` z > 0) sorts its order-0 renderers behind the
  units (§33.6). (4) A `VigilWolfEffectEmitter` row's `buffKey` is a buff its owner must hold when the row plays (§33.12
  Mode attacks). (5) A token's skill record is its owner variant's (data/tokens.json, §33.16). (6) An AppearSkill's
  `_overrideStartEffect` use is its unit's deploy effect (§33.12 roles, §33.16). (7) A CreateEffect action of an
  ability (`…_actions CreateEffect` uses) may target the ability's target, which index v3 does not write (§33.16).

* **2026-10-15 — the skin points' rotation (index.json `skins`, §33.12 Skin)**; no version change, fields added only:
  every point has `rot` (its local rotation, quaternion x y z w) and every point with a `bone` has `followRot` (its
  BoneFollower's `followBoneRotation`). 54 of the used set's 1,118 bone-followed points do not take their bone's
  rotation and keep `rot`: 洛洛's SpecialPoint1 and 令's SpecialPoint2 (30° about x, cancelling the Graphic's −30°) and
  50 with the identity or a small turn about z (烛煌, 塑心, 焰尾 … and 19 enemies' and 2 tokens' points). A reader of an
  earlier index (no `rot` / `followRot`) takes the bone's angle for every bone-followed point and no turn for the others.
* **2026-10-15 — corrections after the maintainer's play (history §32.14.38)**; no version changes — the files now
  match what this text already said, and a reader of the earlier files keeps working. (1) Meshes (§33.9): a skinned
  mesh has four bone influences per vertex. A Unity 2019+ mesh stores 1–4 (its BlendIndices / BlendWeight channels'
  dimension) and no BlendWeight when every vertex follows one bone; earlier runs wrote those rows as they came — 2 per
  vertex for 21 skinned renderers of the used set (铃兰 S3's ninth tail, 琴柳's flags …), no bone data at all for 41
  (伊芙利特 S3's flame tongues, eight of 铃兰's tails …) —, so a reader can infer the count from `boneIndices.length /
  vertexCount` and must extract again for the second kind. (2) index.json projectiles (§33.12): `main` and `lifeTime`
  are the projectile class's own (SimpleProjectile, HarpoonProjectile, …); earlier runs took the last behaviour's
  `_mainEffect` — 30 projectiles named their chain or rope line and lost the flying effect and the life (their
  `behaviours` give both) —; the new `link` names that line (a ChainLightningEffectBehaviour's or a HarpoonRenderer's:
  `behaviours` say which, and how it is drawn — §33.12 Projectile).
* **2026-10-15 — readings corrected from the client's code, no format change** (DESIGN §32.14.36). (1) A skin point
  with a `bone` (§33.12 Skin) has as `pos` that bone in the prefab's edit-time pose (the 0-length `Default` clip), not
  where the client reads it in battle — the live transform (`MountPoint.get_mapPositionV3`): read the bone from the
  unit's skeleton. (2) Which spawn locations also take the mount point's rotation, and what FollowMountPoint copies
  (§33.11, resolved). (3) ParacurveMovement and AmiyaS2Movement (§33.12 Projectile, resolved): the arc tops out
  `raiseHeight` above the start. (4) A projectile's `main`, written as the last `_mainEffect` of its behaviours, is for
  a chain-lightning or harpoon projectile (32 of the full set) a line renderer's effect; the flying effect is its
  projectile behaviour's own, and a harpoon's rope runs from the shooter to the head while a chain's lightning joins
  the chain's targets as the shot reaches them (`behaviours`, §33.12 Projectile; the extractor's fix: the entry above).
* **2026-10-15 — Phase 1d: `index.json` version 3** (§33.17; the descriptors, `textures.json` and the meshes keep their
  versions, the file list's `fx.index.version` is 3; no field was removed or renamed, and only two mode attacks change
  besides the additions — (6) —: a version-2 reader keeps working). (1) `units[id].talents` — the unit's talents by
  prefab key (`Talents/<key>`: `1`, `2`, `-1`, `Reborn`, …), each with its nodes (Talent class, ability, mode, `when`:
  deploy / reborn / attack / toggle / passive, the reborn talent's mode / handler / count, the toggle checkers, the buff
  template actions that cast it, the skills it is valid with, the modes its buffs switch to) and the skills' fields
  (`uses` with the skills' role vocabulary, `roles`, `effects`, `projectiles`, `unclassified`, `abilities`); `bb` on an
  enemy's talent: the key of data/enemies.json `talents.bb` (`Reborn.duration` → `Reborn`). (2) `units[id].abilities`:
  the common abilities (the head's `_commonAbilities` — stand switches, revives, the talents' bombs), the modes'
  general abilities (`_generalAbilities` — auras, funnels, effects while a mode is on) and the trait, the same entry
  shape with `kind`, `name` / `alias`, `modes`, `triggers` / `stops` and `switchMode`. (3) `units[id].talentKeys`: our
  data's talent indexes → the prefab keys (operators and summons, from the official character / module tables), and
  `units[id].spineEffects` (a SpineEffectEmitter's presets). (4) Which projectile an ability fires: `skills[id].abilities`
  (every attack ability of the skill prefab: class, node, projectileKey, extraProjectileKeys, additionalProjectile,
  mount, …; and the helpers that fire one — SimpleProjectileEmitter, ChantWithProjectileBeforeSkill), `projectileKey` on
  the emitter uses of a projectile-firing ability; the same fields on talents' and abilities' entries; mode attacks and
  their sub-abilities gain `mount`, `mountGroup`, `additionalTimes`, `triggerDelta`, `additionalProjectile`. (5) A buff's
  life on each use it carries (`life`: Torappu.LifeType — IMMEDIATELY / LIMITED / INFINITY / CUSTOM —, `time`, the
  blackboard `key` of a timed buff's duration, `tick`, `db`). (6) Group choice from the data: `select` on group abilities
  (AbilityRandomGroup's SelectMethod Random / Loop and weights, AbilitySelectableGroup's configs in order, Parallel,
  FirstSucceed, Sequence; `main` / `burst`); an AbilitySelectableGroup's sub-abilities now follow its `_abilityConfigs`
  (and a BurstAttackGroup's burst attack comes last — 号角 S2's order changes), a funnel attack takes the funnels beside it
  (耶拉 S2 gains its two). (7) Corrected: UberAnimationEffectEmitter's `loopType` is *metadata* LoopType 0 LOOP (the
  animations in turn), 1 RANDOM — §33.12 assumed 1 meant "in turn"; emitters carry `loopTypeName`, replace-group uses
  `loopType`. (8) Corrected carriers (`on`): an attachment's `_additiveActiveBuffs`, a blocker's `_buffsToBlockee`,
  `_projectileBuffs`, the tile listeners' and LockTargetAbility's buffs are the targets', `_buffsToExistToken` a summon's
  (one skill use changes: `SpawnTokenOnTileByIDAbility._buffsToExistToken`, unknown → token). (9) New effect fields:
  a funnel's `_idleEffect` / `_idleBackEffect` / `_overloadIdleEffect` (loop), `_appearEffect` (start), `_disappearEffect`
  (end); a reborn talent's `_effects` (start); `ExtraAbilityPreloads._effects` is no use (preloads only). Numbers: §33.17.
* **2026-10-15 — Phase 1c: `index.json` version 2, meshes version 2** (§33.12, §33.9; the descriptors and
  `textures.json` stay version 1, the file list's `fx.index.version` is 2; no field was removed or renamed — a version-1
  reader keeps working and simply does not see the additions, except the two corrections (9) and (10)). (1) A mode's
  `attack` takes the rows of every effect emitter on its node, not only an exact `UberEffectEmitter`: its subclasses
  (`MultiHitUberEffectEmitter`, `UberAnimationEffectEmitter`, the charge emitters, …) and the custom emitters
  (`AphrisEffectEmitter`, `FunnelEffectEmitter`, …) — the mode attacks of 19 operators had no rows; when the node's
  emitters are not one plain `UberEffectEmitter`, `attack.emitters` lists them with their settings and each row names
  its `emitter`; a MultiHit emitter's `_hitGroups` rows join `hit` with `group`, an UberAnimation emitter's
  `_replaceGroup` rows join `cast` / `hit` with `group` and `anim`, another row list keeps its `field`; two emitters on
  one node no longer overwrite each other's rows. (2) `attack.node`; `attack.abilities`: a group ability's sub-abilities
  and a funnel attack's funnels, each an attack of its own. (3) `combat`: the mode's `_combat` (the blow on a blocker)
  when it is another ability than `attack`'s — the only attack of most enemies, whose `attack` is null. (4)
  `units[id].charge` and `attack.charge`: the 秘术师's chargeable groups — per-energy effect groups, store abilities,
  projectiles and mount points (§33.12 Charge). (5) Skills: `rootClass` / `rootAbility`; the uses of a group list carry
  `group` / `groups` (a replace group's `anim`, the MultiHit choice flags); a `_replaceGroup`'s `hitEffectOptions` are
  hit uses (they counted as cast uses; none in this client). (6) Enemies' skills: `units[enemy].skills`, keyed by the
  lower-case node name = data/enemies.json `skills[].prefabKey`, with `nodes` / `inModes` (not in `index.skills`: the
  keys repeat across enemies); summons' skills (`sktok_*` / `skcom_*` of the tokens' data) in `units[token].skills` and
  `index.skills`. (7) `prefabs[key].spawn` / `follow`: the descriptor's SpawnLocation and FollowMountPoint type. (8)
  `extract.py --print-jobs` lists `fx.indexVersion`; a `--fx-keys` run merges only into an earlier version-2 index (else
  it writes a set of just those keys). (9) Corrected: `skins[id].points` no longer include the prefab root's own
  transform — 90 skins change (78 enemies, 10 tokens, 2 operators: 88 roots authored tiles away, e.g. `enemy_1007_slime`
  at (3, 3, 0), and float noise), their points now sit over the feet; the runtime's `skinShift` (render/vfx/mounts.js),
  which moved 84 of them back, has nothing left to move for an index of version 2 and can go (or skip version ≥ 2). (10)
  Corrected: a mesh's `colors` are 0…1 as §33.9 says (version 1 wrote the client's bytes, 0…255; a reader that divides
  values above 1 by 255 reads both); the mesh files are version 2, and their keys (a hash of the file) all change.
  Numbers: §33.15.
* **2026-10-15 — Phase 1b, the full set.** (1) The file list left `data/local-assets.json`: it is `data/local-fx.json`
  (§33.1), served at `/data/local-fx.json` with hashed URLs; its groups (`fx`, `fx/prefabs`, `fx/tex`, `fx/mesh`) and
  entries are the ones `data/local-assets.json` had, which now has no fx group. A worktree that links
  `data/local-assets.json` from another checkout links `data/local-fx.json` too (it is written next to the
  `--manifest` path as given). (2) `index.json` (§33.12): the six enemy `_2` variants without a prefab of their own
  are copies of their base unit with `aliasOf`; an emitter row's `effects` is what it plays — directionType 0 (NONE)
  plays only the first slot (the other slots are leftovers: before, they were listed too), a directional row keeps
  every distinct key plus `slots` (the effect per facing); keys the client lacks are dropped; a row may carry only a
  `hookEffectAfterFirstAttack`. (3) Skills gained `mode` / `modeBy`, `uses`, `roles` and `unclassified` (§33.12),
  from the skill prefabs and the client's buff templates. (4) The used set holds the sample's keys too. (5)
  `InheritVelocityModule` / `LifetimeByEmitterSpeedModule` export: their `m_Curve` is a MinMaxCurve (159 prefabs of
  the full set failed on it). (6) The **[verify]** marks were checked against the client: resolved — ability events (§33.12), vertex stream
  packing and the custom-data components (§33.6), `FxUVRotation` (§33.11), `PauseEffectIf` (§33.11, the earlier
  `buff_stun` example was wrong), the texture-sheet frame from the data's `0.9999` ends (§33.5); still assumed —
  the billboard roll's sign, the Limit Velocity dampen step (§33.5), `FxUVRotation`'s matrix sign. No descriptor field
  changed.
* **2026-10-14 — Phase 1a**: the format and the sample.

## 33. Official battle effects — the extracted format (0.3.0, Phase 1a–1d)

The official battle effects (hit sparks, projectiles, cast flashes, status loops, skill effects) are Unity prefabs of
ParticleSystems, meshes, trails and small behaviour scripts. `tools/local-extract/fx.py` (run as `extract.py --only fx`)
reads them from the player's own client — like every local-client asset (§13), nothing of it is committed or shipped —
and writes them in the format below, from which the web runtime rebuilds and plays them. This section is the contract
between the two: a runtime can be written from it without opening Unity. (The feasibility study before it, 2026-10-14,
is kept with the maintainer's local handoff notes.)

Everything in the files is Unity-native (axes, units, enums, serialized field names), transcribed, not reinterpreted:
the descriptor keeps Unity's names so that every field can also be looked up in Unity's documentation. What the
extractor adds is the resolution of references (other files, other nodes, shaders' render states, clip bindings) and the
decoding of compressed data (animation clips, textures, meshes).

**Status (Phase 1d).** The extractor and this format cover the full set the mode uses (§33.14; the Phase 1a sample,
§33.13, is a subset) and, since Phase 1c (§33.15), every emitter of the units' attacks, the charge groups and the
enemies' and summons' skills; since Phase 1d (§33.17) the units' talents, common and general abilities, which ability
fires which projectile, the buffs' lives and the groups' choice; the runtime and the skill mapping read them (Phases 2
and 3; what the runtime does not read yet: §33.17's list), and the 驭械术士's floating units from the funnel attacks, their
FunnelEffectEmitters and their projectiles (§33.18). Where the client's own
behaviour cannot be read from its data, the text says **assumed** (Unity behaviour the data cannot confirm);
**resolved** marks what Phase 1b checked against the client (its shader source, il2cpp metadata, prefab data). Enum and
field names marked *metadata* come from the client's il2cpp metadata
(`Arknights_Data/il2cpp_data/Metadata/global-metadata.dat`, version 29, not encrypted: type and field names, nested
types, the enum constants with their values; method bodies are native code and not read).

### 33.1 Files, the file list and the extractor run

```
.venv/bin/python tools/local-extract/extract.py --only fx                        the Phase 1a sample (§33.13)
.venv/bin/python tools/local-extract/extract.py --only fx --fx-set used          every effect the mode's units use
.venv/bin/python tools/local-extract/extract.py --only fx --fx-keys k1,k2        named prefabs only (a dev aid)
                                                 [--fx-jobs N]  worker processes (default up to 8)
```

A run can be staged away from the live folders: `--out <dir>/public/assets/local --manifest
<dir>/data/local-assets.json` writes the files under `<dir>/public/assets/local/fx/` and the file list next to that
manifest, `<dir>/data/local-fx.json` (the URLs in it stay `/assets/local/fx/…`: copying both into place promotes the
set, and `SP_FX_ROOT=<dir> node --test test/local-extract-fx.test.js` checks it where it is).

A plain `extract.py` run (no `--only`) does not run fx. The run reads `data/chess.json`, `data/backups.json`,
`data/enemies.json` and `data/tokens.json` for the unit list (and the enemies' talent keys), the official
`character_table.json`, `battle_equip_table.json` and `uniequip_table.json` under `.cache/gamedata/excel/` when setup
fetched them (our data's talent indexes → the prefabs' talent nodes, §33.17 `talentKeys`; without them the links are
left out), caches the bundles' prefab lists under `.cache/fx/` (per bundle size + mtime) and writes, under
`public/assets/local/fx/`:

| file | content |
|---|---|
| `index.json` | §33.12: per unit (operator / enemy / token) the attack modes, skills, talents and common / general abilities (§33.17), projectiles and mount points; the projectiles; the generic keys; one summary per exported prefab |
| `textures.json` | §33.8: texture key → size, wrap, filter, alpha, files |
| `prefabs/<file>.json` | §33.4: one descriptor per effect prefab (effect key → file: `fx_file(key)` — the key itself when it is URL-safe (`[A-Za-z0-9_.-]`), else the safe form + `-` + the key's CRC32 in hex, e.g. `buff_ fragile_01` → `buff__fragile_01-9c1f…`) |
| `tex/<key>.webp`, `tex/half/<key>.webp` | §33.8: every texture (WebP q90, alpha kept), and a half-size copy for the light tier (both sides ≥ 64 px) |
| `mesh/<key>.json` | §33.9: meshes of mesh particles, MeshRenderers, skinned meshes and mesh-shaped emitters |

**The file list: `data/local-fx.json`** (written next to `data/local-assets.json`, `--manifest`; gitignored like it).
It names every file, so the server's asset index hashes its URL: the server hands it out at `GET /data/local-fx.json` as
a view whose URLs carry the content hash, `/assets/~<hash>/local/fx/…` (immutable for a year; docs/ASSETS.md "The
committed manifest and the served manifests"), and answers an empty `{ groups: {} }` on an install without effects. It
is a file of its own — ~8,800 entries for the full set — so that `data/local-assets.json`, which every page loads, stays
small: that file has no fx group (an fx run removes the ones a Phase 1a run wrote there). The server never loads it
(`server/data.js UNLOADED_DATA`), it is no part of the content hash (`PRESENTATION_DATA`), and the release zips leave the
effects out while `tools/package.mjs FULL_ZIP_FX` is off. The runtime takes URLs from it, never builds them:

```
{ version: 1, format: 'fx-manifest', source: 'local-client', client (the client version), set ('sample' | 'used' | 'keys'),
  count (entries), groups: { fx, fx/prefabs, fx/tex, fx/mesh } }
```

| group | entries |
|---|---|
| `fx` | `index` `{ path, kind: 'FxIndex', version, set, prefabs }`, `textures` `{ path, kind: 'FxTextures', count }` |
| `fx/prefabs` | effect key → `{ path, kind: 'FxPrefab' }` |
| `fx/tex` | texture key → `{ path, w, h, kind: 'Texture2D', half? }` (`half`: the half-size copy's URL) |
| `fx/mesh` | mesh key → `{ path, kind: 'FxMesh', verts }` |

Each JSON file starts with `format` (`fx-index`, `fx-textures`, `fx-prefab`, `fx-mesh`) and `version` (1; since Phase
1c `index.json` 2 and the meshes 2, since Phase 1d `index.json` 3 — the changelog says what changed). A full run
(`sample` / `used`) rewrites the list and removes the files of an earlier run that are no longer listed; `--fx-keys`
re-exports the named prefabs (and the keys they name) into the earlier set — their descriptors, index summaries and list
entries are replaced, everything else stays (without an earlier set it writes a set of just those keys).

**Keys are case-insensitive.** Effect, projectile and skill keys are the bundles' container names, which are lower
case; the client's own references mix cases (a `SwitchableBackEffect` names `chen2_skill_01_buff_02_B`). Every key the
extractor writes (file names, file-list entries, the index, the descriptors' `refs`) is lower case; behaviour fields keep
the client's spelling — lower-case a key read from them before looking it up.

Timings on the maintainer's Mac (Windows client 26-09-13, 8 processes): the full set (§33.14: 4,253 prefabs, 186 MB)
takes ~3 minutes; the sample (126 prefabs, 290 textures, 43 meshes, 6.8 MB) ~17 s; a first run adds ~10 s (the bundles'
prefab lists: 606 effect bundles read once, then cached in `.cache/fx/`). The prefab export costs ~0.18 s CPU per
prefab; libwebp effort 4 (`WEBP_METHOD`; effort 6 is ~90× slower here for 4.5 % smaller files).

### 33.2 Conventions

**Numbers.** Floats have 6 significant digits; `-0` is `0`; NaN and ±∞ are `null` (in curve keys, `null` slopes mean
stepped, §33.3). Integers stay integers. Booleans are JSON booleans where Unity serializes a bool, else Unity's 0 / 1
integers are kept (most script fields: `_isLoop: 0`).

**Units.** Lengths are Unity units = tiles (one tile is 1 × 1). Times are seconds of battle time. Angles: radians in the
ParticleSystem's rotation fields (`startRotation*`, `RotationModule`, `RotationBySpeedModule` — e.g. a random spin
`{ min: -6.28319, max: 6.28319 }` rad/s); degrees everywhere else (Euler angles of transforms and clips, `ShapeModule`
`angle` / `arc` / `m_Rotation`, `FxUVRotation`). Colours are Unity's raw floats, in gamma space (the client renders in
gamma space: blend them as they are, no sRGB conversion), and may exceed 1 (HDR tints).

**Frames.** Every transform, vector and mesh vertex is in Unity's left-handed frame, as authored. Effects are authored
for the battle scene, whose world frame is the level's centred frame of `render/projection.js`: x = column − 10,
y = row − 9, **z = −height** (z points down into the board; the battle camera looks along +z, pitched 30° from straight
down, vertical FOV 40° — `OFFICIAL` in `render/projection.js`, which is exactly the camera the board uses). A point
`p_u` of the battle world is the board point `p_o = (p_u.x + 10, p_u.y + 9, −p_u.z)` (x = column, y = row, z = height).

The recommended way to render: build every effect in Unity space (Unity's TRS order, Unity's quaternions, Unity's
camera-facing math), with the camera transformed into the same space, and map positions with the linear map
`C = diag(1, 1, −1)` plus the anchor's translation only when they become board / clip-space positions. C is its own
inverse. Because C has determinant −1, triangle winding flips: draw effect geometry with culling off (nearly every
Torappu particle pass is `Cull Off`; for a `Back` / `Front` pass — the Rim shaders, a material's `_CullMode` — swap the
two). Direction vectors map with C as well
(`v_o = (v.x, v.y, −v.z)`); a quaternion maps as `(−qx, −qy, qz, qw)` when an orientation must be expressed in the board
frame. Euler angles (transforms, clips, shape rotation) are degrees applied as Unity's `Quaternion.Euler(x, y, z)`:
rotate about Z, then X, then Y (q = q_y · q_x · q_z).

Why it works out: every unit's `Graphic` node is rotated −30° about X (quaternion `(-0.258819, 0, 0, 0.965926)`), so a
character's skeleton plane is perpendicular to the camera's view direction, and the client gives an effect it spawns
at the unit's FOOT, HIT or HEAD point that same rotation (§33.11 `_spawnLocation`, resolved 0.3.1): a plane authored in
the effect's own XY plane stands facing the camera like the skeleton (荒芜拉普兰德 S3's seal, 能天使 S3's light bars), one
turned +30° about X under it lies in the board (`common_hit_01`'s `andi`; the deploy ring of `common_char_birth_01`,
turned −150°, alike), and an effect placed on the ground or at a map position takes no rotation. With our camera being the official one, the
authored transforms produce the official picture.

**Gravity.** A ParticleSystem's gravity is `Physics.gravity × gravityModifier` in battle-world space; the client's
`Physics.gravity` (globalgamemanagers, PhysicsManager) is the default `(0, −9.81, 0)`: towards row 0, in the board's
plane — on screen that reads as falling down.

**Time.** Effects run on the battle clock (`FxSystem._ts`, ≈ 2 game seconds per real second at 2× speed), so they stay
in step with the Spine clips. The client simulates particles in steps of at most 1/30 s (TimeManager "Maximum Particle
Timestep" 0.0333): a runtime that wants the same drag / limit-velocity results sub-steps the same way.

### 33.3 Value encodings (curves, gradients, references)

**AnimationCurve** (`keys`): `[[time, value, inSlope, outSlope], …]`, sorted by time; a weighted key appends
`weightedMode, inWeight, outWeight` (weightedMode: 1 in, 2 out, 3 both). Evaluate as Unity does: between keys k0, k1
(Δ = t1 − t0) the cubic Hermite with tangents `k0.outSlope·Δ` and `k1.inSlope·Δ`; a `null` slope on either side of a
segment makes it stepped (hold k0's value until t1). Weighted tangents use Unity's Bézier form (rare: none in the sample).
Outside the keys, clamp to the first / last value (particle curves are evaluated on 0…1).

**MinMaxCurve** (Unity's `minMaxState` modes):

| encoding | mode | value |
|---|---|---|
| a number | Constant (0) | that number |
| `{ min, max }` | TwoConstants (3) | lerp(min, max, r) |
| `{ scalar, curve }` | Curve (1) | curve(t) × scalar |
| `{ scalar, minCurve, maxCurve }` | TwoCurves (2) | lerp(minCurve(t), maxCurve(t), r) × scalar |

`t` is the normalized time the field is defined over: the system's time / `lengthInSec` for the start values and the
emission rate (InitialModule `start*`, `rateOverTime`, burst counts), the particle's age / lifetime for the
over-lifetime modules, the custom data and the texture-sheet frame. `r` is a random number per particle, drawn when the
particle is born and kept (Unity keeps one per field). For the start values about 99 % of the systems use Constant or
TwoConstants (§33.5's table).

**Gradient**: `{ mode: 'blend' | 'fixed', color: [[t, r, g, b], …], alpha: [[t, a], …] }` (t in 0…1, up to 8 keys each).
Colour and alpha keys are separate tracks; 'blend' interpolates linearly between keys, 'fixed' holds the key at or
after t (Unity's fixed mode: the first key whose time ≥ t).

**MinMaxGradient**:

| encoding | mode | value |
|---|---|---|
| `[r, g, b, a]` | Color (0) | that colour |
| `{ min, max }` (colours) | TwoColors (2) | lerp(min, max, r) per component |
| `{ gradient }` | Gradient (1) | gradient(t) |
| `{ minGradient, maxGradient }` | TwoGradients (3) | lerp(min(t), max(t), r) |
| `{ random }` | RandomColor (4) | random(gradient) — one random point of the gradient, per particle |

**Vectors and colours**: `[x, y, z(, w)]`, `[r, g, b, a]`. A Unity `MultiModeParameter` (ShapeModule `radius`, `arc`,
`m_MeshSpawn`) is `{ value, mode, spread, speed }` (mode: 0 Random, 1 Loop, 2 PingPong, 3 BurstSpread; `speed` a
MinMaxCurve).

**References** (Unity PPtrs) are resolved:

| encoding | meaning |
|---|---|
| `{ node }` | a GameObject of this prefab (§33.4 node id) |
| `{ node, component }` | a component on that node (`'Transform'`, `'ParticleSystem'`, …) |
| `{ material: i }` | `materials[i]` of this descriptor |
| `{ mesh: key }` | a mesh file (§33.9); `'builtin:Quad'` etc. for Unity's built-in meshes |
| `{ texture: key }` | a texture (§33.8) |
| `{ clip: i }` | `clips[i]` of this descriptor |
| `{ builtin: x }` | an asset of Unity's built-in resources (`x`: a built-in mesh name or its path id) |
| `{ asset, name }` | any other asset (type, name) — informational |
| `null` | no reference (Unity's null), or a reference the extractor could not resolve |

### 33.4 The prefab descriptor (`prefabs/<file>.json`)

```
{ format: 'fx-prefab', version: 1, key, bundle, root: 0,
  nodes: [Node…], materials: [Material…] (§33.7), clips: [Clip…] (§33.10),
  textures: [texture key…], meshes: [mesh key…],          the files this prefab needs (preload them)
  refs: [effect key…],                                     other effects its behaviours name (§33.11: variants by
                                                           facing, chained effects) — exported too
  stats: { nodes, particleSystems, liveParticles, duration, looping } }
```

`stats` are estimates for budgets and pooling: `liveParticles` the rough peak of live particles of the active
systems, `duration` the time until every non-looping system has finished (startDelay + lengthInSec + max lifetime;
`null` when any system loops), `looping` whether one does.

**Node** (one per GameObject; `nodes[0]` is the prefab root; children in Transform order, depth first):

```
{ id, name, parent (id | null), children: [id…], active (the GameObject's own activeSelf),
  pos: [x, y, z], rot: [x, y, z, w] (quaternion), scale: [x, y, z],      local transform (Unity)
  particleSystem?        §33.5          particleSystemRenderer?   §33.6
  meshFilter?            mesh key (or 'builtin:Quad', or null)
  meshRenderer?, skinnedMeshRenderer?, trailRenderer?, lineRenderer?, spriteRenderer?    §33.6
  animator?, animation?  §33.10         behaviours?: [Behaviour…]  §33.11
  ignored?: [component type…]           components the format leaves out (MeshCollider, BoxCollider, …) }
```

World matrix of a node = parent's world matrix × T(pos) · R(rot) · S(scale). A node is active when it and all its
parents are `active` (Unity's activeInHierarchy); an inactive node renders and simulates nothing until something (an
FxDelay, a clip curve on `m_IsActive`) activates it. A renderer also has its own `m_Enabled`. The root is the
exception: the client activates an effect's GameObject as it plays it (`Effect._DelayToActiveGameObject` →
`GameObjectUtil.SetActiveIfNecessary`, GameAssembly.dll of 2026-09-13), so a root saved inactive — 35 prefabs of the
used set: the 狼群's `vigil_token_sub_attack_1` / `_2`, 伺夜's and 至简's attack starts, 艾雅法拉's hit, 风笛 S3's buff,
百炼嘉维尔 S2's chainsaw glow … — plays like any other (the runtime drew nothing of them before 0.3.1). The root's own
transform is the game's too: the client sets the root's position where it plays the effect (`Effect._InitLocation…`,
its rotation by the spawn location, §33.11), and a projectile's flying effect is a child of the projectile's body,
which flies the path, with its transform reset (`Misc.Reset`) — so the root's authored `pos` (203 prefabs, 155 of them
projectile bodies: `aglina_skill_02_trail` at (0.18, 0.74, −0.60), 0.94 tile up the screen) is not added, and a
projectile body's authored `rot` gives way to its flight (0.3.1, history §34.6).

The usual layout: the root carries the controlling behaviour (`ParticleEffect`, `ProjectileEffect`, §33.11) → a node
`static_offset` → a node `fixed` (or `rotation_y` / `rotation_z`, nodes the behaviour turns by direction) holding a
ParticleSystem whose renderer is disabled (`Default-Particle` material) — it only times its children (in Unity, playing
a system plays its child systems) → the visible systems, quads, trails. Note the children's tilts against the root's
spawn rotation (§33.2).

### 33.5 ParticleSystem (`node.particleSystem`)

Only enabled modules are written (InitialModule always); a missing module is off. Field names are Unity's serialized
names (`ParticleSystem` in a Unity YAML scene); the enum values are Unity's.

**System fields**: `lengthInSec` (duration), `looping`, `prewarm` (a looping system starts as if one full duration had
already run), `startDelay` (MinMaxCurve, s), `playOnAwake`, `simulationSpeed`, `moveWithTransform` (simulation space: 0
Local — particles move with the system's transform, 1 World — they stay where they were emitted, 2 Custom — relative to
`moveWithCustomTransform` `{node, component}`), `scalingMode` (0 Hierarchy — the full world scale applies, 1 Local —
only the system's own `scale` applies to its particles: the player's frame is the world rotation with unit axes times
that scale, and an axis a parent scaled to zero is rebuilt from the other two, mirrored with the effect (history
§32.14.38), 2 Shape — scale applies to the emission shape only; a particle's size is × the Hierarchy / Local scale per
axis — x across, y up the particle, z through a mesh — whether or not the system has `size3D` (1,318 systems of 462
prefabs sit on unevenly scaled nodes: 荒芜拉普兰德 S3's seal tips 1 × 0.7, 娜仁图亚 S3's hit glow a 2.4 × 0.29 streak), and
a local-space particle is drawn at that scale as it is now, a world-space one at the scale it was born at (a clip that
grows a node from 0 grows its particles: the seal's discs; 531 systems of 142 prefabs are born at 0 or animated) —
0.3.1, history §34.6; the remake drew a uniform size × the x scale, as born), `stopAction`, `cullingMode`, `ringBufferMode`,
`ringBufferLoopRange`, `emitterVelocityMode` (0 Transform, 1 Rigidbody: the emitter's velocity for inherit-velocity and
rate-over-distance), `useUnscaledTime`, `autoRandomSeed`, `randomSeed`.

**InitialModule** (Main): `startLifetime`, `startSpeed` (along the shape's emission direction), `startSize` (or, with
`size3D`, `startSize` / `startSizeY` / `startSizeZ` per axis), `startRotation` (radians; with `rotation3D`
`startRotationX` / `startRotationY` / `startRotation` (Z)) — a billboard's roll about the view axis; Unity turns
particles clockwise on screen for positive angles, the opposite of a Transform's Z rotation (**assumed**: Unity's
behaviour, which no data of the client confirms; the transform-driven spins such as `buff_stun`'s are clips, §33.10) —,
`randomizeRotationDirection` (0…1: the share of particles whose rotation and spin are mirrored), `startColor` (MinMaxGradient), `gravityModifier` (MinMaxCurve × Physics.gravity,
§33.2), `maxNumParticles` (emission stops at this many live particles), `customEmitterVelocity`.

**ShapeModule** (where particles are born and their initial direction; omitted = emit at the system's origin, direction
+Z): `type` / `typeName` — `sphere`, `hemisphere`, `cone`, `box`, `mesh`, `coneVolume`, `circle`, `singleSidedEdge`,
`meshRenderer`, `skinnedMeshRenderer`, `boxShell`, `boxEdge`, `donut`, `rectangle` (and Unity's deprecated `*Shell` /
`circleEdge` ids, unused); `radius` and `arc` (MultiModeParameter, arc in degrees), `radiusThickness` (0 = only the
surface / edge, 1 = the whole volume), `angle` (cone half-angle, degrees), `length` (coneVolume length), `boxThickness`,
`donutRadius`, `m_Position` / `m_Rotation` (Euler degrees) / `m_Scale` (the shape's own transform inside the system),
`alignToDirection`, `randomDirectionAmount`, `sphericalDirectionAmount`, `randomPositionAmount`; mesh shapes: `m_Mesh`
(`{mesh}`), `m_MeshRenderer` / `m_SkinnedMeshRenderer` (`{node, component}`), `placementMode` (0 vertex, 1 edge,
2 triangle), `m_MeshSpawn`, `m_UseMeshColors`, `m_MeshNormalOffset`, `m_MeshMaterialIndex` / `m_UseMeshMaterialIndex`;
texture-masked shapes (`m_Texture`, …: unused). Unity's geometry: cone and hemisphere open along the shape's local +Z,
circle / donut / rectangle lie in its local XY plane, the edge runs along local X.

**EmissionModule**: `rateOverTime` (MinMaxCurve over the system's normalized time), `rateOverDistance` (particles per
unit the emitter moves — projectile trails), `m_Bursts`: `[{ time, countCurve, cycleCount (0 = repeat for ever),
repeatInterval, probability }]` (`m_BurstCount` is their number).

**Over-lifetime modules** (t = age / lifetime):
* `SizeModule`: `curve` (multiplies startSize); with `separateAxes` `curve` = X, `y`, `z`.
* `RotationModule`: angular velocity `curve` (rad/s, Z); with `separateAxes` `x`, `y`, `curve` (Z).
* `ColorModule`: `gradient` (MinMaxGradient, multiplies startColor).
* `VelocityModule`: `x`, `y`, `z` (added velocity), `orbitalX` / `orbitalY` / `orbitalZ` (rad/s around the system
  centre), `orbitalOffsetX/Y/Z`, `radial` (along centre → particle), `speedModifier` (multiplies the velocity),
  `inWorldSpace` (0 local, 1 world).
* `ClampVelocityModule` (Limit Velocity): `magnitude` (or `x` / `y` / `z` with `separateAxis`), `dampen` (the share of
  the excess speed removed per step), `drag` (MinMaxCurve) with `multiplyDragByParticleSize` /
  `multiplyDragByParticleVelocity`, `inWorldSpace`. **Assumed**: Unity applies dampen once per simulation step
  (sub-steps of ≤ 1/30 s, §33.2); the client's data cannot show the step (engine code).
* `ForceModule`: `x`, `y`, `z` (acceleration), `inWorldSpace`, `randomizePerFrame`.
* `InheritVelocityModule`: `m_Mode` (0 Initial, 1 Current), `m_Curve`.
* `LifetimeByEmitterSpeedModule`, `SizeBySpeedModule`, `RotationBySpeedModule`, `ColorBySpeedModule` (`range` = the
  speed interval mapped to 0…1).
* `NoiseModule`: `strength` (with `separateAxes` `strength` / `strengthY` / `strengthZ`), `frequency`, `scrollSpeed`,
  `damping` (strength proportional to frequency), `octaves`, `octaveMultiplier`, `octaveScale`, `quality` (0 1D, 1 2D,
  2 3D), `remap` / `remapY` / `remapZ` / `remapEnabled`, `positionAmount`, `rotationAmount`, `sizeAmount`. Unity's
  noise is curl noise; any smooth 3D noise of the same frequency and strength reads alike.

**UVModule** (Texture Sheet Animation): `mode` (0 grid, 1 sprites — grid only in this client), `tilesX` × `tilesY`,
`animationType` (0 whole sheet, 1 single row: `rowMode` / `rowIndex`), `timeMode` (0 lifetime, 1 speed (`speedRange`),
2 fps (`fps`)), `frameOverTime` and `startFrame` (MinMaxCurves **normalized**: 0…1 of the frame count — the client's
values run to 0.9999), `cycles` (sheet loops per lifetime), `flipU` / `flipV` (probabilities), `uvChannelMask`. Frame
index = floor(frac(startFrame + frameOverTime(frac(t · cycles))) · frames); frames run left to right, top to bottom
(frame 0 is the top-left tile). **Resolved** by the data: the authored curves end at 0.9999, not 1, exactly so that
floor(v · frames) stays on the last frame instead of wrapping to the first; the `cycles` repetition is Unity's
documented meaning (assumed).

**SubModule**: `subEmitters`: `[{ emitter: {node, component: 'ParticleSystem'} | null, type, properties,
emitProbability }]` — type 0 Birth, 1 Collision, 2 Death, 3 Trigger, 4 Manual; `properties` a bitmask of what the
child inherits (1 colour, 2 size, 4 rotation, 8 lifetime, 16 duration; 0 = nothing). A sub-emitter system does not
emit on its own; it emits (its bursts) at the parent particle's position for each parent event. `emitter: null` occurs
in the data and does nothing.

**TrailModule** (trails behind particles, drawn with the renderer's `materials[1]`): `mode` (0 Particles — one trail
per particle, 1 Ribbon — one strip through the particles in age order), `ratio` (share of particles with a trail),
`lifetime` (MinMaxCurve, × the particle lifetime), `minVertexDistance`, `textureMode` (0 Stretch, 1 Tile,
2 DistributePerSegment, 3 RepeatPerSegment), `worldSpace`, `dieWithParticles`, `sizeAffectsWidth`, `sizeAffectsLifetime`,
`inheritParticleColor`, `colorOverLifetime`, `widthOverTrail` (MinMaxCurve over the trail, head 0 → tail 1),
`colorOverTrail`, `ribbonCount`, `splitSubEmitterRibbons`, `attachRibbonsToTransform`.

**CustomDataModule**: `mode0` / `mode1` (0 disabled, 1 vector, 2 colour), `vectorComponentCount0/1`, `vector0_0…0_3`,
`vector1_0…1_3` (MinMaxCurves over the particle lifetime), `color0` / `color1`. These values reach the shader only
through the renderer's custom vertex streams (§33.6) — the `*(CustomData)` shaders read them (dissolve amount, UV
offsets).

**CollisionModule** (66 systems in the used set), **TriggerModule**, **LightsModule**, **ExternalForcesModule**: written
when enabled; a runtime may ignore them (no collider exists in our scene; the used set has no lights / external forces).

How often each module occurs in the systems 盟约 uses (28,360 ParticleSystems of the 4,013 prefabs, client 26-08-16):
Emission 83 %, Color 76 %, Size 69 %, Shape 41 % (cone 5,791, sphere 1,904, box 1,809, circle 1,142, coneVolume 609),
ClampVelocity 28 %, UV 16 %, CustomData 11 %, Rotation 11 %, Velocity 9 %, Noise 8 %, Force 3 %, Trail 2 %,
Sub 1 %, InheritVelocity 1 %; 23 % loop, 3,019 prewarm, 16 % simulate in world space, 89 % use scaling mode Local.

### 33.6 Renderers

All renderers carry `m_Enabled`, `m_SortingLayerID` / `m_SortingLayer`, `m_SortingOrder` and `materials` (indices
into the descriptor's `materials`, `null` for a missing one — draw nothing with it).

**`particleSystemRenderer`**: `renderMode` / `m_RenderMode` — `billboard` (0), `stretch` (1), `horizontalBillboard` (2),
`verticalBillboard` (3), `mesh` (4), `none` (5); `renderAlignment` / `m_RenderAlignment` — `view` (0, face the camera
plane), `world` (1), `local` (2, the system's transform orientation — 9,422 renderers: most mesh particles and many
quads are local), `facing` (3, face the camera position), `velocity` (4); `m_SortMode` (0 none, 1 by distance, 2 oldest
in front, 3 youngest in front), `m_SortingFudge` (bias of the camera distance used to sort this system against
others), `m_MinParticleSize` / `m_MaxParticleSize` (on-screen size clamp, as a fraction of the viewport height),
`m_LengthScale` / `m_VelocityScale` / `m_CameraVelocityScale` (stretched billboards: along the velocity the particle's
Y size × lengthScale + speed × velocityScale, across it its X size — the particle's Y is the stretched axis: of the
used set's stretched renderers with a pivot, 2,434 set it in Y and 9 in X, against 405 / 379 for plain billboards,
and 2,130 of the 2,449 stretched systems with unequal X / Y sizes make Y the long one; 风笛's lance thrust, a Y 3.5 /
X 0.5 flash flying along the thrust, was a vertical needle with the sizes the other way round, 0.3.1),
`m_FreeformStretching`, `m_RotateWithStretchDirection`, `m_NormalDirection`, `m_Pivot` (in
particle-size units: the quad or mesh is drawn at position + pivot × size along the particle's own axes, turning with
its roll — 荒芜拉普兰德 S3's seal tips, Quads with a pivot of −0.5 / −0.81 left of the centre and their twins turned 180°
about Y right of it, point outward only so, and of the used set's view billboards with a Y pivot 210 lift the quad
against 22: 艾雅法拉 S2's range flames stand on the ground; a stretched billboard adds the same pivot after its head
shift, pivot.y × the particle's Y size along the velocity and pivot.x × its X size across — that Y size, not the
stretched length; 1,754 stretched renderers have |pivot| > 0.2, and the largest shifts are 锏 S3
`blkkgt_skill_03_start_01` `light` (up to 4.62 tiles), `enemy_mdrock_buff_03_start_02` `shandian` (4.57) and 陈 S2
`chen_skill_02_start` `renwu_01` (2.77) — 1,291 renderers of 661
prefabs set one — the remake moved the particle the other way before 0.3.1, and skipped it on a stretch, history §34.6), `m_Flip` (0…1: the share of particles mirrored per axis), `m_AllowRoll`; mesh particles:
`m_Mesh`, `m_Mesh1…3` (`{mesh}` or null), `m_MeshDistribution` (0 uniform, 1 by `m_MeshWeighting*`), `m_MaskInteraction`;
`materials[0]` draws the particles, `materials[1]` the TrailModule's trails.

Custom vertex streams: `m_UseCustomVertexStreams` and `vertexStreams` (names; `m_VertexStreams` the ids). Only when
`m_UseCustomVertexStreams` is true does the list apply; otherwise the shader gets Unity's default streams Position,
Normal, Color, UV. Unity packs the streams in list order: Position → POSITION, Normal → NORMAL, Tangent → TANGENT,
Color → COLOR, then every other stream fills TEXCOORD0, TEXCOORD1, … four floats at a time (UV is 2 floats, Custom1XYZW
4, AgePercent 1, …) — e.g. `[Position, Normal, Color, UV, Custom1XYZW]` gives TEXCOORD0.xy = UV, TEXCOORD0.zw =
Custom1.xy, TEXCOORD1.xy = Custom1.zw.

**Resolved** against the client's shader source (the custom-data variants, keyword `_HGCUSTOMVERTEXSTREAM_ON`): their
vertex inputs are sized to exactly these packings — `TEXCOORD0` half4, `TEXCOORD1` half4, `TEXCOORD2` half2 (10 floats)
in the Disturb / Ram / ZDistort `(CustomData)` families, whose renderers stream `[Position, Normal, Color, UV,
Custom1XYZW, Custom2XYZW]` (2,301 renderers of the used set: UV 2 + 4 + 4); `TEXCOORD0` + `TEXCOORD1` (8 floats) in
`Dissolve(CustomData)`, whose renderers stream `[…, UV, Custom1XYZW, Custom2XY]` (653). What the components do there
(CustomDataModule curves, §33.5) — offsets are added to a texture's UV after its tiling / offset, before the UV
rotation and the scrolling: in `Disturb(CustomData)` Custom1.xy offsets the main texture, Custom1.zw the dissolve
texture, Custom2.zw the disturb texture (the Ram and ZDistort families add the same three inputs to their own three
textures), Custom2.x is added to `_Amount` (the dissolve threshold) and Custom2.y to `_IntensityU` / `_IntensityV`
(the disturb strength); in `Dissolve(CustomData)` Custom1.xy / Custom1.zw offset its main / dissolve textures,
Custom2.x is added to `_DissolveIntensity` and Custom2.y to `_BorderWidth`. Without the keyword (or without custom
streams) the components are 0.

**`meshFilter` + `meshRenderer`**: the mesh drawn with the node's world transform, one material per sub-mesh.
`builtin:Quad` is Unity's quad: vertices (±0.5, ±0.5, 0), normal −Z, UV (0,0) at (−0.5, −0.5).

**`skinnedMeshRenderer`**: `m_Mesh`, `m_Bones` (`[{node, component}]`, the bone transforms), `m_RootBone`, `m_Quality`,
`m_BlendShapeWeights`; the mesh file carries `boneWeights`, `boneIndices`, `bindPoses` (§33.9). A vertex is
Σᵢ wᵢ · (boneᵢ world · bindPoseᵢ) · v. 17 prefabs in the used set (Ifrit S3's flame tongues), animated by legacy clips.

**`trailRenderer`**: `m_Time` (trail lifetime, s), `m_MinVertexDistance`, `m_Autodestruct`, `m_Emitting`, `m_Parameters`
= `{ widthMultiplier, widthCurve (keys over the trail, head 0 → tail 1), colorGradient (head → tail), numCornerVertices,
numCapVertices, alignment (0 view, 1 transform Z / local), textureMode (0 Stretch, 1 Tile, 2 DistributePerSegment,
3 RepeatPerSegment) }`. The trail follows its node's world position (the projectile's flight).

**`lineRenderer`**: `m_Positions` (in world space when `m_UseWorldSpace`, else the node's space), `m_Loop`, the same
`m_Parameters`. The authored positions are placeholders: the effects that use lines (chains, beams) get their end
points from the game (source and target). 32 of the used set's 34 line prefabs are world-space — their points are
fixed spots of the authoring scene (溯光星源 S1's chain at world (5, 4) → (6, 3)) and must not be drawn as they are;
the web runtime draws such a line only once it set its end points (a harpoon's rope, §33.12: from the shooter's point
to the head).

**`spriteRenderer`**: not used by the effects of this mode (written with its materials only).

**Sorting and depth.** Transparent renderers sort by sorting layer, then `m_SortingOrder`, then the material's queue,
then camera distance (with `m_SortingFudge`). 71 % of the effect materials have ZTest `Disabled` (§33.7): they ignore
the board's depth; the rest test against it (ground decals, ranges). The units sort among them: an operator's Spine
renderers (its chararts' `Front` / `Back` / `Spine` MeshRenderers) sit on the Default layer (`m_SortingLayer` 0) at
order 0, so an effect renderer on a lower layer, or on the Default layer with a negative order, is drawn before every
unit — behind it (野鬃 S2's ring of lances at −3, a bubble's back half at −2; 5,637 of the used set's 34,061 enabled
renderers) —, a positive order after them, and order 0 by distance with them. The web runtime draws the first kind in
its pass under the units (`render/vfx/effect.js` `behindUnits`) along with the renderers lying flat on the ground,
and — for order 0 — the renderers of an effect authored behind its unit: a root `static_offset` node deeper in the
board than the anchor (`pos` z > 0; 50 prefabs of the used set — auras, the `*_back` halves, a slash for a unit
facing up) puts the effect farther from the camera than the unit's tilted body, which lies at its feet's depth, so
Unity draws it first (0.3.1: 瑕光 S3's horses, wings and halo, z +0.23 and 0.5–1.1 tiles behind her feet, covered her);
a `static_offset` pulled forward (z < 0) or at 0 keeps the flat rule [ASSUMED: the units' renderers sort at their
feet's depth; an effect whose depth comes from its children's positions alone is not judged].

### 33.7 Materials (`descriptor.materials[]`)

```
{ name, shader (the shader's name, e.g. 'Torappu/Particles/Additive'),
  passes: [{ blend: [src, dst, srcAlpha, dstAlpha], blendOp, zTest, zWrite, cull, colorMask }],
  queue (the material's render queue, else the shader's Queue tag, e.g. 'Transparent' = 3000),
  keywords: [shader keyword…],
  floats: { name: number }, colors: { name: [r, g, b, a] (also vectors) },
  textures: { name: { tex: key | null | 'builtin:<id>', st: [scaleX, scaleY, offsetX, offsetY], default? } },
  defaults?: [property names the material did not store: their values are the shader's defaults] }
```

Only the shader's declared properties are written (materials keep stale values of earlier shaders; they are dropped),
each with the material's value or the shader's default. `textures[n].default` is the shader's default texture name
('white', 'black', 'gray', 'bump') when no texture is set. The pass states are resolved for this material: blend
factors (`Zero`, `One`, `DstColor`, `SrcColor`, `OneMinusDstColor`, `SrcAlpha`, `OneMinusSrcColor`, `DstAlpha`,
`OneMinusDstAlpha`, `SrcAlphaSaturate`, `OneMinusSrcAlpha`), `blendOp` (`Add`, …), `zTest` (`Disabled` — always pass
— `Less`, `LessEqual`, …), `zWrite`, `cull` (`Off`, `Front`, `Back`), `colorMask` (bits R 8, G 4, B 2, A 1) — where
the shader takes a state from a property (`_ZTest`, `_DstBlend`, `_SrcBlend`, `_PremultiplyAlpha`, `_CullMode`, …) the
material's value (or the property default) is used. The alpha factors matter only when the effect layer's alpha is
composited (a transparent canvas). `keywords` select the shader's variant: in this client `_HGCUSTOMVERTEXSTREAM_ON`
(the custom-data variant of the `*(CustomData)` shaders), `HG_SPRITE_SHEET` / `HG_SPRITE_SHEET_LERP` (AlphaBlend's
in-shader flipbook), `_ALPHABLEND_ON`, `_WEIGHT_ON`, …

Shaders of the used set (by material uses; 38 names): `Torappu/Particles/AlphaBlend` 9,208, `…/Additive` 9,124,
`…/Ram/Disturb(CustomData)` 3,244, `…/Disturb/Disturb(CustomData)` 1,823, `…/Dissolve/Dissolve(CustomData)` 968,
`…/Dissolve/Dissolve AB` 945, `…/Dissolve/Dissolve Add` 760, `…/Disturb/Disturb Origin` 568, `…/Disturb/Disturb Anchor`
405, `…/Dissolve/Dissolve AB (VertexColor Major)` 395, `…/Dissolve/Dissolve AB UVTween` 361, `…/Dissolve Add UVTween`
288, `…/Dissolve Add Double` 213, … and the rare GrabPass / ZDistort / Bloom / Rim / Mask / Multiply families. The
runtime implements these families in its own GLSL; their behaviour (properties, passes, the vertex / fragment
computations) is documented for the runtime developer in a reference kept outside the repository — official shader
source never enters it. The common pattern: output = 2 × vertex colour × `_TintColor` × texture (a `_TintColor` of
0.5 grey is neutral), Dissolve variants cut the alpha by a noise texture against `_Amount` with a soft `_BorderWidth`,
Disturb variants offset the main UVs by a scrolled distortion texture.

### 33.8 Textures (`textures.json`, `tex/`)

`textures.json` = `{ format: 'fx-textures', version: 1, textures: { key: Texture } }`:

```
{ name (the Unity name), w, h, format (the client's encoding: DXT1, DXT5, RGBA32, …), mips, srgb, alpha,
  file: 'tex/<key>.webp', half: 'tex/half/<key>.webp' | null,
  wrapU, wrapV ('repeat' | 'clamp' | 'mirror' | 'mirrorOnce'), filter ('point' | 'bilinear' | 'trilinear'), aniso }
```

A key is the safe Unity name + the first 8 hex digits of the SHA-1 of the decoded pixels, so identical copies in
different bundles share one file (`star_02` alone exists ~50 times in the client). `alpha` false = every pixel opaque
(written as RGB). Textures are straight (not premultiplied) alpha; the half-size copy is resized premultiplied (no dark
fringes). `srgb` is informational: render in gamma space (§33.2). Built-in textures appear as `builtin:<path id>`.

### 33.9 Meshes (`mesh/<key>.json`)

```
{ format: 'fx-mesh', version: 2, name, vertexCount,
  positions: [x, y, z, …], normals?: […], uv0?: [u, v, …], uv1?: […], colors?: [r, g, b, a, …] (0…1, since version 2),
  submeshes: [[i0, i1, i2, …], …] (triangle lists, one per material),
  boneWeights?: [w0, w1, w2, w3, …], boneIndices?: [i0…i3, …], bindPoses?: [[16 floats row-major]…] }
```

Unity mesh space (left-handed, as authored). Key = safe name + 8 hex digits of the SHA-1 of the file. `boneWeights` /
`boneIndices` hold four pairs per vertex, missing ones (0, 0): the client's meshes keep 1–4 influences per vertex and no
weights when each vertex follows one bone (then its weight is 1) — an extraction made before the correction of
2026-10-15 wrote that count (2 per vertex) or, without weights, no bone data at all (changelog). The client
stores vertex colours as bytes (a UNorm8 channel): version 1 wrote those bytes (0…255; 722 meshes of the used set have
colours), version 2 writes them as 0…1 floats (the bytes ÷ 255), as this section always said. Meshes of mesh
particles are small (`Plane003`, `Cone001`, `Torus001`, `Sphere001`: 4–200 vertices; 435 meshes / 57k vertices in the
whole used set).

### 33.10 Animation clips (`descriptor.clips[]`, `node.animator`, `node.animation`)

`node.animator` = `{ controller, clips: [clip index…], default, enabled, cullingMode, updateMode }`: the Animator plays
`default` from time 0 when the effect starts (every effect controller of the sample has one clip). `node.animation`
(legacy) = `{ clips, default, playAutomatically, wrapMode, enabled }`.

```
Clip = { name, legacy, length, start, loop, sampleRate, wrapMode, events: [{ time, function, data, float, int }],
         curves: [{ node, path, type, property, keys, customType?, pptr?, pathHash? }] }
```

A curve drives one float of one component of node `node` (`path`: its path from the Animator's / Animation's node;
`node: null` + `pathHash` when the clip names an object the prefab does not have — Unity ignores those). Evaluate the
keys at the clip time (§33.3; looping clips wrap at `length`, others hold their end values). `type` and `property`:

| type | property | meaning |
|---|---|---|
| `Transform` | `localPosition.x/y/z`, `localScale.x/y/z` | the node's local position / scale |
| `Transform` | `localRotation.x/y/z/w` | quaternion (normalize after evaluating) |
| `Transform` | `localEulerAnglesRaw.x/y/z` | Euler degrees (Z, X, Y order, §33.2; e.g. `buff_stun`'s spin: z 0 → −720 over 10.03 s) |
| `GameObject` | `m_IsActive` | > 0.5 = active |
| `MeshRenderer`, `ParticleSystemRenderer`, `TrailRenderer`, `LineRenderer`, `SkinnedMeshRenderer` | `material.<prop>[.<c>]` (customType 22) | overrides a material property of that renderer only: c = `r g b a` (colours), `x y z w` (vectors — for `_MainTex_ST`: x, y scale, z, w offset), none (floats). Seen: `_TintColor`, `_MainColor`, `_MainTex_ST`, `_Amount`, `_Amount_02`, `_BorderWidth`, `_DissolveTex_ST`, `_DisturTex_ST` |
| `TrailRenderer` / `LineRenderer` | `m_Parameters.widthMultiplier`, `m_Time`, … (customType 30 / 29) | the renderer field of that path |
| `ParticleSystem` | dotted module path, e.g. `EmissionModule.rateOverTime.scalar`, `InitialModule.startColor.maxColor.a` (customType 27) | that serialized field of the system |
| `MonoBehaviour` | the script's field | (16 bindings in the used set) |

Unresolvable properties would read `crc:<n>` (none in the sample). Clips are decoded from Unity's streamed (Hermite
segments), dense (sampled; written as linear keys) and constant tracks; legacy clips from their explicit curves.

### 33.11 Behaviours (`node.behaviours[]`)

`{ class, namespace, enabled, fields }` — every MonoBehaviour with its serialized fields (Unity names, references
resolved per §33.3; `_bodyTransofrm` is the client's spelling). Disabled behaviours (`enabled: false`) do nothing.
Semantics below are read from the field names, the data and the client's type, field and enum names (*metadata*);
**resolved** marks what was checked against the client's shader source or metadata, **assumed** what still is not.

**`ParticleEffect`** (Torappu.Battle.Effects — the root of most effects; 3,630 in the used set):
* `_spawnLocation` — where the game places the effect on its owner (*metadata* SpawnLocation): 0 NONE, 1 FOOT_POINT,
  2 HIT_POINT, 3 MUZZLE_POINT, 4 HEAD_POINT, 5 GROUND_CENTER, 6 MUZZLE_POINT_WITHOUT_ROTATION, 7 GROUND_CENTER_WITH_ZERO_HEIGHT,
  8 MP_SPECIAL_0, 9 MP_SPECIAL_1, 10 MP_SPECIAL_2, 11 MP_SPECIAL_3, 12 CAMERA, 13–16 MP_SPECIAL_4–7, 17 TILE_CENTER,
  18–25 MP_SPECIAL_8–15, 26 GROUND_CENTER_WITH_TILE_HEIGHT, 27–34 MP_SPECIAL_16–23, 35 GROUND_CENTER_WITH_HIGHLAND_HEIGHT.
  The points are the unit's mount points (§33.12 `skins`): FOOT = the unit's root, HIT = `HitPoint`, MUZZLE = `Muzzle` /
  `MuzzlePoint`, HEAD = `HeadPoint`, MP_SPECIAL_n = `Special<n>` / `SpecialPoint<n>`. In the sample: hits use 2, cast
  flashes 3 / 6 / 8, status loops 1 / 4, ranges 5 / 7. **Resolved** (the client's `Effect._InitLocationFromEntity`;
  the rotations corrected in 0.3.1, history §34.6): FOOT_POINT, HIT_POINT and HEAD_POINT take the point's position and
  the rotation of the unit's skin animator — the `Graphic` node's −30° about X, without the FaceSwitcher's turn: an
  effect authored in its own XY plane stands facing the camera (§33.2; 2,590 prefabs play there, their planar
  renderers authored standing 7,255 times against 514 lying flat), FLIP_TWO_SIDE mirrors it for a unit facing left —;
  MUZZLE_POINT_WITHOUT_ROTATION and NONE take no rotation, the ground spawns (GROUND_CENTER…, TILE_CENTER) the unit
  root's (none), and an effect the game plays at a map position (`Effect._InitLocation`: a kit fx's tile, a
  projectile's target tile) none; MUZZLE_POINT and the MP_SPECIAL points
  (`_SetPosAndRotToMountPoint`) take the point's position and its world rotation: the unit's Graphic tilt (−30° about
  X), the FaceSwitcher's turn for a unit facing left (180° about the skeleton plane's up axis: the client tweens that
  node's rotation to turn a unit) and, for a point a BoneFollower keeps on a bone, the bone's angle — such prefabs are
  authored along the point, unturned about X (灰毫's `ashlok_attack_01_start`).
* `_rotateType` (*metadata* RotateType): 0 NONE, 1 FLIP_TWO_SIDE (mirror for a left-facing owner), 2 FOUR_DIRECTION,
  3 FIXED_DIRECTION, 4 ANY_DIR; `_leftIsDefault` (the art faces left), `_mainDir`, `_useBodyRotation`, `_rotationY` /
  `_rotationZ` / `_flipZ` (`{node}`: the helper nodes the direction turns / flips — e.g. `inside_attack_01_hit`'s
  `rotation_y`).
* `_delayToPlay` (s before the systems start), `_delayToFinish` (s the effect lingers after it is finished, then it is
  recycled), `_maxLifetime` (s, −1 none), `_randomPlayDelay`, `_isLoop`, `_inactiveOnFinish` (`[{node}]` hidden when it
  finishes: when the game stops it or its content has ended, through the linger), `_subFXDelayConfigs`, `_holdByOwner`
  (its owner holds it: the effect moves with the unit — §33.16 Placement; **assumed** from the client's names
  `ParticleEffect.holdByOwner`, `Entity.m_holdEffects`, `CreateEffectHoldBySource(…, setAsParent)`: 1 on the attack
  starts, buffs and statuses, 0 on the hits and ground ranges), `_overwriteHeight` / `_heightOffset` (place at this height),
  `_usePlaybackSpeed` / `_limitedPlaybackSpeed` (follow the owner's attack speed, capped), `_preloadCnt` (pool size
  hint), `_allowAutoReuse`, `_disableBattleEffectShrink`, `_ignoredByParticleEffectManager`, `_toggleMeshRendererWhenPause`.
* An effect is finished when every non-looping system has ended and has no live particle (and its clips have ended);
  looping effects run until the game stops them (a status ends, a skill ends, a projectile arrives).

**`ProjectileEffect`** (the flying part of a projectile, §33.12): `_mainDir`, `_resetMainDir`, `_rotate180Y`,
`_randomAngle`, `_flipIfLeft`, `_delayToFinish`, `_inactiveOnFinish`, `_inactiveOnHit` (`[{node}]` hidden on arrival
while the rest — trails — fades), `_preloadCnt`, `_allowAutoReuse`. The 172 with an `_inactiveOnFinish` list name their
body there (崖心's hook and 灰毫's shell `gonggaoban`, 空弦's arrow `gongjian`) with a `_delayToFinish` of 0.5 s for the
trail: the flight's end finishes the effect (a projectile clears its main effect when it is reached), so the body goes
as the shot lands (DESIGN §32.14.40; it used to stay on the target until the trail had faded).
**`EmptyEffect`**: an effect with no own logic.

**`FxDelay`**: `_delayTime` — the node becomes active that many seconds after the effect starts (its nodes start
inactive or the behaviour hides them first).

**`FxUVTweener`** / **`FxUVTweenerAdvance`** (Torappu.Fx): scroll texture offsets of the node's renderer material:
`xspeed`, `yspeed` (UV units per second, `_MainTex`), `useSecondMap` + `secondMapName` (e.g. `_DisturTex`, `_RamTex`,
`_DissolveTex`) + `secondXSpeed` / `secondYSpeed`, `keepInitOffset` (start from the material's offset), `protectMainUV`
/ `protectSecondUV`, `useSharedMaterial`; Advance adds `tweenRepeat`, `tweenAnmTime`, `extraMapSettings`.
**`FxUVRotation`** (186 prefabs): `_propertyName` (`_Rotation`), `_rotateTex1…4` (which textures), `angle1`,
`_angle2…4` (degrees). **Resolved** in the shader source: the Torappu particle shaders that support it rotate each
texture's UV about its centre when the float `_HG_UV_ROTATION` is > 0.5 — uv′ = (dot(uv − 0.5, R.xz),
dot(uv − 0.5, R.yw)) + 0.5, after the texture's tiling / offset and before its time scroll — with one matrix per
texture slot, `<propertyName>0…3` = `_Rotation0` (texture 1, `_MainTex`), `_Rotation1` (2, `_DissolveTex`),
`_Rotation2` (3, `_WeightTex`), `_Rotation3` (4, `_DisturbTex` / the ramp's disturb map). No material stores them: the
behaviour sets them at run time. **Assumed**: R = (cos θ, sin θ, −sin θ, cos θ) for its angle θ (the standard 2D
rotation, so u′ = cos θ·u − sin θ·v), and `_HG_UV_ROTATION` = 1 while it runs.

**`FollowMountPoint`**: keeps the effect on a mount point of its owner (*metadata* MountPointType): 0 FOOT, 1 HIT,
2 MUZZLE, 3 HEAD, 4 UI, 5 SPECIAL_0, 6 SPECIAL_1, 7 GROUND, 8 SPECIAL_2, 9 SPECIAL_3, 10 SPECIAL_4, 11–29
SPECIAL_5–SPECIAL_23 — sample: `buff_frozen` 0, `common_root_01` 1, `enemy_tidmag_attack_01_start_01` 2, `buff_stun` /
`buff_cold` 3, `greyy_attack_01_start` 5; `_followScale` / `_followScaleSign` / `_scaleMultiplier`,
`_keepOriginRotation`, `_pauseWhenMountPointInvalid`, `_onlyPauseWhenMountPointInvalid`, `_useBehaviourPause`.
**Resolved** (`FollowMountPoint._FollowMountPoint`): every LateUpdate the effect takes the point's position and,
unless `_keepOriginRotation`, its world rotation (as MUZZLE_POINT above); `_followScaleSign` copies the sign of the
point's local scale, `_followScale` the scale itself (× `_scaleMultiplier`). The status loops keep their rotation
(`buff_stun`, `buff_frozen`, `common_root_01`: `_keepOriginRotation` 1) — the rotation their spawn location gave them
(`_spawnLocation` above: the Graphic tilt on FOOT / HIT / HEAD, 0.3.1); the weapon effects take it (安洁莉娜's
`aglina_skill_02_start` on SPECIAL_0, its parts 0.35–0.4 along local +x: up her staff); FOOT's point is the skeleton's
root, so an effect following it takes the tilt and the facing turn.
**`FollowDirection`**: turns with the owner's facing (`_useFourDir`, `_useOwnerDirection`, `_useOwnerMoveDirection`,
`_leftIsDefault`, `_reverseWhenFaceToBack`, `_flipWhenFaceToVertical`, `_onlyFollowOnPlay`, `_useDirectionLerp`,
`_lerpDuration`, …). **`FollowOwner`**, **`FollowOwnerRootTileHeight`**, **`FollowTileHeight`** (`_followTileHeightSpeed`):
follow the owner / the height of the tile under it.

**Variants by facing** (the game swaps in another effect key — named in the descriptor's `refs`, and exported):
**`SwitchableBackEffect`**
(`_backEffect`: the key used when the owner faces back), **`SwitchableRightEffect`** (`_rightEffect`, `_reverseLeftRight`,
`_reactivationMode` 0 RESUME / 1 RESTART), **`SwitchableEffectByFaceDirection`** (`_upEffect`, `_downEffect`,
`_leftEffect`, `_useDeployDirection`).

**Chains** (spawn other effect keys): **`OnPlayEmitter`** / **`OnPlayEmitterIf`** (`_effects`, `_instant`, `_preDelay`,
`_useFaceVector`, `_clearWhenFinish`, `_useSourceEffectPos`; If: `_checkType` 1 MOTION_MODE, 2 OWNER_CONTAINS_BUFF,
4 OWNER_SPINE_FACE_TO_MATCH, `_motionMode` (0 WALK, 1 FLY), `_buffKey`, `_playWhenFaceToBack`), **`OnFinishEmitter`**
(`_effects` started when this one finishes, e.g. `amgoat_skill_03_buff` → `amgoat_skill_03_buff_end`),
**`OnFinishAnime`** / **`TriggerAnimatorWhenFinish`** (set an Animator trigger at the end), **`PauseAnotherEffect`**
(`_effect`, `_preDelay`, `_checkUpdate`; 21 prefabs). The runtime starts an OnPlayEmitter's effects with their parent's
placement and owner (`system.js FxHandle._start`); on a unit a chained effect keeps to its own FollowMountPoint's point,
else moves with the unit when its parent or its own `_holdByOwner` says so (§32.14.40: before, they all kept their
parent's placement, and a parent without a FollowMountPoint left them where they started — 能天使 S2's
`angle_skill_02_buff_02` and 纯烬艾雅法拉 S3's five weapon effects, each on its own Special point in the client, at her
feet). PauseAnotherEffect is **run** since round 46 (history §32.14.42; `effect.js` `def.pauses`, `system.js
_pauseOthers`): while the effect plays (after `_preDelay`) the effects of the key `_effect` on the same unit (the
`owner` FxWiring.playOn gives each effect) are not drawn — they keep running and show again once it stops. It shows one
variant of a stack — 泥岩's and 鼠王's shield layers (`mudrok_buff_01_start` pauses `_02` and `_03`, `_02` pauses `_03`),
the 泥岩 boss's `enemy_mdrock_skill_buff_01/02/03` — and puts a skill's range in place of a talent's aura (塑心 S3's
`cello_skill_03_buff_range` over `cello_buff_01`, 调香师 S2's `flower_skill_02_range` over `flower_buff_01_range`, 帕拉斯
S3, 琳琅诗怀雅's trait). [ASSUMED]: the client's pause hides the effect (Unity's would freeze its particles);
`_checkUpdate` 0 (pause what plays at the start only) is treated like 1.

**`PauseEffectIf`**: pause (hide) the effect while a condition on its owner holds — `_checkAbnormalFlag` +
`_pauseWhenAbnormalFlag(s)`, `_checkAbnormalImmune` + `_pauseWhenAbnormalImmune`, `_checkNotInAbnormalFlag` +
`_pauseWhenNotInAbnormalFlag`, `_checkAbnormalCombo` + `_pauseWhenAbnormalCombo`, `_checkContainBuff` + keys,
`_checkFaceToBack` / `_checkFaceToRight`, `_checkDisappear`, `_checkUnitModeIndex`, `_checkState`, `_checkOnPlay`,
`_requireAllConditions`, `_disableMeshRendererWhenPause`. Each `_check…` is a *metadata* PauseEffectIf.CheckType:
0 NOT_CHECK, 1 CHECK_YES (pause while the condition holds), 2 CHECK_NO (pause while it does not) — not a boolean; the
`_pauseWhen…` value it tests is read only when the check is 1 or 2 (a 0 there is a value, not "off"). Flags (*metadata*
AbnormalFlag): 0 STUNNED, 5 INVINCIBLE, 9 INVISIBLE, 11 DISARMED, 12 SILENCED, 13 UNMOVABLE, 16 FROZEN, 17 CAMOUFLAGE,
23 COLD, 25 LEVITATE, 33 FEARED, 39 PALSY, 43 DOZE, 45 GROUND_BOUND, …; combos (AbnormalCombo): 0 SLEEPING,
1 SHELTERING, 2 ISOLATE. **Resolved** examples: `buff_stun` pauses while its owner is immune to STUNNED (immune check 1,
value 0) or not stunned (not-in check 1, value 0); `buff_frozen` the same with FROZEN (16); `buff_cold` while the owner
is FROZEN (flag check 1, value 16); `buff_sleep` while the owner is not SLEEPING (combo check 2, value 0). **`PauseEffectIfDisappeared`**,
**`PauseEffectIfRenderInvisible`**, **`PauseEffectWithAnimation`** (`_validAnimation`, `_invalidAnimation`,
`_delayToPause`, `_delayToRestore`, `_finishIfPause`).

**`FxLODSetting`** (Torappu.Fx; 141 prefabs): the client's own low-quality reductions — `_disableObjects` (`[{node}]`
removed at low quality), `_particleDetailsHookers` (`[{ _particle: {node, component}, _detailPercentage }]`: emission
scaled by that share). A light tier can apply it.

**Others**: `ColorModifier` (`_color` tint), `FunnelHitEffect` (`_randomRange`), `OnPlayAudioPlayer` (`_audioSignal`:
a sound — the runtime's audio may play it), and the long tail (55 classes in the used set; most occur once or twice).

### 33.12 `index.json`

```
{ format: 'fx-index', version: 3, set: 'sample' | 'used' | 'keys', source: { root, client },
  units: { id: Unit }, projectiles: { key: Projectile }, skills: { skillId: Skill },
  skins: { id: Skin }, generic: { hit, die, birth, status, keys }, prefabs: { key: PrefabSummary } }
```

`version` is 2 since Phase 1c and 3 since Phase 1d (the changelog lists what each added; an older reader finds every
field it reads where it was). **Unit** (`char_*` from charpack/, `enemy_*` from battle/enm_pfb_*, tokens from
pkgrps/btl_pfb_tokens_*):

```
{ kind: 'char' | 'enemy' | 'token', prefab (bundle), rootClass ('Character' | 'Enemy' | …),
  startEffect, deadEffect (keys or null: the deploy / death effect when the unit names one),
  graphic: { path, pos, rot, scale },          the unit's Graphic node (its skin's placement and tilt)
  modes: [{ name ('Default', 'S1', 'S2', …), overrideStartEffect, overrideDeadEffect,
            attack: Attack | null,             the mode's `_attack`
            combat?: Attack }],                its `_combat` (the blow on a blocker), when another ability (v2)
  charge?: [Charge…],                          the chargeable groups (the 秘术师's stored energies, below; v2)
  skills: { skillId: Skill },                  the same objects as index.skills; an enemy's own skills (v2, below)
  talents?: { key: Talent },                   its talents by prefab key (v3, §33.17)
  abilities?: [Ability…],                      its common / general abilities and trait (v3, §33.17)
  talentKeys?: { base, trait?, modules? },     our data's talent indexes → the talents' keys (v3, §33.17)
  spineEffects?: [Emit…],                      a SpineEffectEmitter's presets (v3, §33.17)
  projectiles: [key…], refs: [every effect key the unit uses], skin: id | absent,
  aliasOf?: id }                               a copy of unit `id` (below)
Attack = { class ('RangedAttack', 'MeleeAttack', 'RangedHeal', 'MultiMeleeAttack', 'AbilityRandomGroup', …), animKey,
           attackType, damageType, projectileKey, extraProjectileKeys, projectileDestination,
           node?,                              the ability's node in the unit prefab, e.g. 'Modes/S1/Body/Attack' (v2)
           cast?, hit?, attach?, inputTarget?, castTarget?: [Emit…],
           emitters?: [{ class, …settings }],  the node's effect emitters, when not one plain UberEffectEmitter (v2)
           abilities?: [Attack…],              a group's sub-abilities, a funnel attack's funnels (v2)
           charge?: { group, ability, animKey? },    the charge ability it releases: indexes into `charge` (v2)
           select?: { method, … },             a group's choice of sub-abilities (v3, §33.17)
           mount?, mountGroup?, additionalTimes?, triggerDelta?, additionalProjectile(s)? }   (v3, §33.17)
Emit = { effects: [key…], slots?: [key | null…], directionType, oneshot, startEvent, endEvent, onlyOnce,
         useFourDirectionalFace, hookEffectAfterFirstAttack, …,
         emitter?, group?, anim?, field? }     (v2: below)
```

`modes[0]` (`Default`) is the normal attack; the others are the modes a skill switches to (`S1` = skill 1's attack,
named by the client; a skill's `mode` names it, below). An attack's `cast` effects play on the attacker, its `hit`
effects on each target hit (melee and direct attacks), and a projectile's own `onHit` effects where the projectile
arrives. **Resolved** (*metadata*): an Emit row is a `Torappu.Battle.Abilities.UberEffectEmitter` option —
`CastEffectOptions` (`cast`, `inputTarget`, `castTarget`: `_oneshot`, `_startEvent`, `_endEvent`, …),
`HitEffectOptions` (`hit`: `_oneshot`, `_endEvent` — it starts at each hit on a target, the emitter's OnCastOnTarget),
`AttachEffectOptions` (`attach`: from the ability's attach to its detach, no events); `startEvent` / `endEvent` are
`Torappu.Battle.AbilityStandard/Event` — 0 ON_ATTACHED, 1 ON_DETACHED, 2 ON_CAST_START, 3 ON_CAST_END, 4 ON_SPELL_ON,
5 ON_SPELL_END, 6 ON_ATTACK_FINISH, 7 ON_ATTACK_CHECK_POINT, 8 ON_OVERLOAD, the only enum with these names: a cast
effect plays from its start event (a one-shot just plays there) and a looping one stops at its end event. In the used
set the units' cast rows start at 2 (662) or 4 (79, the spell — the moment the attack fires) and end at 3 (719) or 6
(21). `directionType`
(*metadata* UberEffectEmitter.EffectOptions.DirectionType): 0 NONE, 1 L_OR_R, 2 U_OR_D, 3 FOUR_DIR, 4 UD_OR_LR,
5 FOUR_DIR_FIXED. `effects` are the keys a row plays: for 0 the first slot only (the client fills the other slots of
some NONE rows with leftovers — 5 rows of the used set, one naming a key the client lacks — which the game does not
play; the variants by facing then come from the effect's own `SwitchableEffectByFaceDirection`, §33.11), else every
distinct key, and `slots` holds the effect per facing as *metadata* `Torappu.SharedConsts.Direction` indexes it:
0 UP (the back view), 1 RIGHT, 2 DOWN (the front view), 3 LEFT (null: nothing; L_OR_R rows use 1 / 3, U_OR_D rows
0 / 2). `hookEffectAfterFirstAttack` (a key or '') replaces the row's effect from the second attack on; a row may have
only that. Keys the client does not have are dropped (the extractor logs them).

**Every emitter of the attack's node (v2).** The rows come from every effect emitter on the ability's node, whatever its
class: `UberEffectEmitter` and its subclasses — `MultiHitUberEffectEmitter`, `UberAnimationEffectEmitter`,
`MultiChargeUberEffectEmitter`, `MultiExChargeUberEffectEmitter`, `MergeableChargeUberEffectEmitter`,
`UberEffectEmitterInCertainMode`, `VigilWolfEffectEmitter` — and the emitters of their own kind (`AphrisEffectEmitter`,
`FunnelEffectEmitter`, `MuzzleGroupEffectEmitter`, `RangeLineEffectEmitter`, `InputTargetProjectileEmitter`,
`EndAnimEffectEmitter`). Version 1 read only an exact `UberEffectEmitter`: the mode attacks whose emitter is a subclass
— 19 operators': 深靛 / 黑键 / 维伊's charge attacks, the multi-hit attacks of 赤刃明霄陈, 艾丽妮, 缄默德克萨斯, 玛恩纳, 薇薇安娜, 锏, 弑君者, 斩业星熊 and
the animation-switching attacks of nine more — had no rows, and a node with two emitters kept only the second one's
lists. When the node's emitters are anything but one plain `UberEffectEmitter`, `attack.emitters` lists them in
component order — `{ class, …settings }`, the settings being the fields the base class lacks (Unity names without the
underscore; PPtrs dropped; effect / projectile keys lower case) — and every row says whose it is (`emitter`: an index
into `emitters`). The rows a subclass keeps in groups join the lists with the group's index:

* `MultiHitUberEffectEmitter._hitGroups` (`hit` rows; `_castGroups` / `_timesBasedHitEffects` the same, empty in this
  client): `group` = the group, played on one hit of the attack — **assumed** (engine code): hit k of a cast plays group
  min(k, last); with the emitter's `useLoopHitEffect` 1 group k mod n, with `useRandomHitEffect` 1 a random one;
  `keepBaseHitEffect` 1 also plays its rows without a group (no MultiHit emitter of this client has both);
  `oncePerTarget` 1: once per target per cast. The emitter's `groups` gives each group list's length (a group without
  rows still counts: the 2nd of 3 groups may play nothing).
* `UberAnimationEffectEmitter._replaceGroup` (`effectOptions` → `cast`, `hitEffectOptions` → `hit`): `group` and
  `anim`, the animation the group belongs to; the emitter's `sourceAnimKey` (the attack animation it replaces),
  `loopType` and `replaceAnims` (the group animations in order). **Resolved** (v3, *metadata*
  UberAnimationEffectEmitter.LoopType, written as `loopTypeName`): 0 LOOP — the attack plays the group animations in
  turn instead of `sourceAnimKey` —, 1 RANDOM — a random one per attack (version 2 of this text assumed 1 meant in
  turn); **assumed**: a row with `anim` plays when the attack plays that animation, the rows without `anim` on every
  attack.
* another list of rows keeps its field name (`field`, e.g. `VigilWolfEffectEmitter._vigilWolfCastEffects`, whose rows
  carry the `buffKey` the owner must have).

A row with `group` or `anim` is conditional: a version-1 reader that plays every row of `hit` plays every group on
each hit. The charge emitters' per-energy groups are no attack rows (Charge, below).

**Sub-abilities and the blow on a blocker (v2).** A group ability (`AbilityRandomGroup`, `AbilitySelectableGroup`,
`AbilityParallelGroup`, `AbilityFirstSucceedGroup`, `BurstAttackGroup` — its `_abilities`) and an attack whose child
nodes carry abilities of their own (`MultiFunnelRemoteAttack`'s funnels) list them in `abilities`, each an Attack with
its node, rows, projectile and charge: per cast a Parallel group casts all of them, the others one — v3's `select`
(§33.17) says how: a random one or each in turn (AbilityRandomGroup), the first in config order whose trigger finds a
target (AbilitySelectableGroup / BurstAttackGroup, whose `abilities` follow `_abilityConfigs` since v3), the first that
succeeds, one after the other; which one a given cast picks is still the client's choice at run time (a reader without
that signal may play `abilities[0]`). The group's own `cast` / `hit` lists hold only the group node's emitters (usually
none). `combat` is
the mode's `_combat` — the ability a unit uses on a unit blocking it — when it is not `attack`'s ability: it is the
only attack of a melee enemy (`attack` null: 169 enemy modes of the used set), and the blocked attack of many ranged
ones; a runtime plays `combat` for a blocked blow (a melee 'atk'), `attack` else, and either one when the other is null.

**Aliases.** An enemy key without a prefab of its own (`enemy_2001_duckmi_2`, `enemy_2002_bearmi_2`,
`enemy_2034_sythef_2`, `enemy_2085_skzjxd_2`, `enemy_9013_acstmk_2`, `enemy_9017_achunt_2`: elite variants) is drawn
with its base prefab: its unit is a copy of the base unit's with `aliasOf: <base id>`.

**Charge** (v2; the 秘术师's stored energies — 深靛 `char_469_indigo`, 黑键 `char_4046_ebnhlz`, 维伊 `char_4226_veen` —
from the unit prefab's Trait/Charge…Group):

```
Charge = { node ('Trait/ChargableAttackGroup'), class ('AbilityChargeableGroup' | 'AbilityExChargeGroup'),
           maxChargeTimes?, emitters: [ChargeEmitter…],        the group node's emitters (深靛's, 维伊's)
           abilities: [ChargeAbility…] }                        the group's `_abilities`, in order
ChargeAbility = { node, class ('ChargeRangedAttack' | 'ExChargeRangedAttack' | 'MergeableChargeRangeAttack'),
                  modes: [the mode names whose attack releases it], animKey, projectileKey, extraProjectileKeys,
                  exProjectileKey?, mergeProjectileKey?, maxChargeTimes, maxExChargeTimes?, mergeSize?, forceExCharge?,
                  mountPointType + mount, mountPointForProjectiles + mounts, exMounts + exMountNames,
                  emitters: [ChargeEmitter…] }
ChargeEmitter = { class, …settings (isExEffectEmitter, chargeEffectStartEvent, mergeSize, …), cast?, hit?, …: [Emit…],
                  chargeEffectGroups?, chargeCastGroups?,
                  mergedChargeEffectGroups?, mergedChargeCastGroups?: [[Emit…]…] }   group k: the (k+1)-th energy
```

Group k (0-based) of `chargeEffectGroups` / `chargeCastGroups` holds the rows played when the (k+1)-th energy is
stored, each at its row's start event: in this client the group node's (or an ExCharge ability's) `chargeEffectGroups`
at ON_SPELL_ON (4), whose loops (`prefabs[key].looping`, a FollowMountPoint on a Special point — `prefabs[key].follow`)
stay while that energy is stored, and the store ability's `chargeEffectGroups` / `chargeCastGroups` at ON_CAST_START
(2), one-shots; `merged…` the same for 维伊's merged energies (every `mergeSize` stored energies merge into one).
`isExEffectEmitter` 1 marks 黑键's elite-energy emitter. A release fires the stored energies as projectiles from
`mounts[k]` (MountPointType names, §33.11 FollowMountPoint; `exMountNames` for 黑键's elite ones; ability without its
own mounts: its effects' `follow`) to the target — the ability's `projectileKey` (`exProjectileKey`,
`mergeProjectileKey`). The mode attack that stores and releases names its charge ability: `attack.charge` =
`{ group, ability }` (indexes into `charge` and its `abilities`) and `animKey`, its store animation (`_chargeAnimKey`).
The store events themselves come from the game (in the remake, the snapshot's stored-energy count of PR #636).

**Skill** (`[uc]skills.ab`, the skills of the units: the chess data's, the 补位 / 自选 forms' of data/backups.json and
every `skchr_<code>_<n>` of an operator, the tokens' of data/tokens.json and data/backups.json `tokens`; an enemy's
skills come from its own prefab, below):

```
{ rootClass, rootAbility,                     the skill root's class and ability (v2, below)
  effects: [every key it names — its buff templates' included], projectiles: [key…],
  mode: index into the owner's modes | null, modeBy?: 'data' | 'name',
  uses: [Use…], roles: { start?, loop?, range?, cast?, hit?, end?, ready?, trigger?, other?: [key…] },
  unclassified: [keys found in the prefab that no use places],
  abilities: [{ node, class, animKey?, projectileKey?, … }],   its attack abilities and projectiles (v3, §33.17)
  nodes?, inModes?: [path… / mode name…] }    an enemy's skill: its node(s) and their modes (v2)
Use = { role, keys: [key…], from ('UberEffectEmitter._castEffects', 'ActiveBuffAbility._buffs',
        'ActiveBuffAbility._buffs → template <templateKey>', …), node (the skill prefab's GameObject),
        ability? (the ability an emitter serves: 'MeleeAttack', 'ActiveBuffAbility', …),
        list?, startEvent?, endEvent?, oneshot?, directionType?, slots?   (an emitter row, as Emit)
        group?, groups?, anim?, useLoopHitEffect?, useRandomHitEffect?, … (a group list's row, v2: below)
        on? ('owner' | 'targets' | 'token'), buff?, template?            (a buff: who carries it, its keys)
        event?, action?                                                  (a buff template's action: a Buff event name,
                                                                          the action node: CreateEffect, CreateBuff, …)
        bb?, by? ('name': placed by the key's name), mode? (v2: an enemy skill's copy, below)
        projectileKey?, extraProjectileKeys?, life?, loopType? }        (v3, §33.17)
```

`rootClass` (v2) is the class of the skill root deriving from *metadata* `Torappu.Battle.Skill` — `CastSkill` (900 of
the client's 1,549 skill prefabs), `PassiveSkill`, `AppearSkill` (a summon's or a deploy skill), `ReplacementSkill` /
`ReplacementSkillFixed` (one cast that replaces the next attack), `AttachOrDetachSkill`, `CastSkillWithLimitTimes`,
`CastTokenSkill`, `ToggleSkill`, `BurstCastSkill`, … (helpers on the same node — `BuffDuringSkill`, `BuffAfterSkill`,
`ChantBeforeSkill` — are not: the Skill class is the one with `_canSilenced` and `_attachSignalIds`), `EnemySkill` for
an enemy's skill, null when none (`sktok_tooltree`); `rootAbility` the root node's ability (`ActiveBuffAbility`,
`MeleeAttack`, `AbilitySequenceGroup`, …) or null. The uses of a group list (`MultiHitUberEffectEmitter._hitGroups` —
10 skills of the used set: skchr_acpion_3 8 groups, ascln_1 2, blkkgt_1 2, chen_3 10, chen3_2 6, irene_1 2, phatm2_1 2,
vvana_1 3, zuole_1 3, zuole_3 7 —, `_castGroups`, `_timesBasedHitEffects`, `UberAnimationEffectEmitter._replaceGroup`)
carry `group` (the group's index), `groups` (the list's length) and the emitter's `useLoopHitEffect` /
`useRandomHitEffect` / `keepBaseHitEffect` / `oncePerTarget` when set, a replace group's `anim` (its
`hitEffectOptions` are `hit` uses; version 1 counted them as cast uses — no skill of this client has any); the group
semantics are the mode attacks' (above).

**Enemies' and summons' skills (v2).** An enemy's skills are nodes of its own prefab carrying an `EnemySkill` (with the
ability and the emitters; a `ReadyEnemySkillEffect` gives `ready`): `units[enemy].skills` holds one per node, keyed by
the node's name in lower case — the `prefabKey` of data/enemies.json `skills[]` (`stuncombat`, `bornanim`, `1`, …) —,
with `nodes` (its path; one per copy when a boss has the skill in several modes — the copies' uses are joined with
`mode`, the copy's mode name, when they differ) and `inModes` (the modes holding the copies; absent for a skill outside
the modes). These keys repeat across enemies (`1`, `skill`): they are not in `index.skills`. The roles are the
operators' (the uses of a skill whose ability is an attack — `MeleeAttack`, `RangedAttack` — follow each of its casts,
below). A summon's skills (`sktok_*`, `skcom_*`: every `skill` object of its data record, `prefabId` else `skillId`, a
`[n]` suffix dropped) are `[uc]skills.ab` prefabs like the operators': in `units[token].skills` and `index.skills`.

The extractor reads every behaviour of the skill prefab (its emitters, abilities, buffs, the Odin action graphs some
abilities carry) and the client's buff templates (`config/buff_template_holder.ab`, *metadata*
`Torappu.Battle.BuffTemplate`: `templateKey`, `effectKey`, `eventToActions` keyed by *metadata* `Torappu.Battle.Buff/Event`),
and gives every effect a role — when the runtime plays it on the sim's skill timeline:

| role | when | from |
|---|---|---|
| `start` | once when the skill starts (for a one-cast skill — `ReplacementSkill` — its cast) | one-shot cast rows (start event 2 / 4 / 0), `_beginEffect`, `_overrideStartEffect` (an AppearSkill's: the unit's deploy effect while it fights with that skill — Character.GetStartEffect returns it before the mode's `overrideStartEffect` and the unit's `_startEffect`; 0.3.1), `_startEffect`, `_chantSuccessEffects`, a buff template's action at ON_BUFF_START / ON_SKILL_START |
| `loop` | while the skill lasts (or the buff carrying it: `on` says on whom) | looping cast rows (start → end event), attach rows, a buff's effect (`overrideEffectKey`, else its template's `effectKey`), aura `_effects`, channel emitters, buffs a template creates |
| `range` | the skill's area marker (loop or one-shot by `oneshot`) | a cast row or a field named `*_range*`, `RangeEffectEmitter`, `_tileEffectKey` |
| `cast` | each ability use while a buff lasts | a template's action at ON_ABILITY_START / ON_ABILITY_SPELL_ON / ON_BEFORE_ATTACK |
| `hit` | each target hit (on the target) | hit / castTarget / inputTarget rows (and `MultiHitUberEffectEmitter` groups), `_hitEffect(Key)`, a template's action at ON_OUTPUT_DAMAGE / ON_AFTER_ATTACK / …, a target buff's start action |
| `end` | when the skill (or the buff) ends | cast rows starting at 1 / 3 / 5 / 6 or named `*_end`, `_endEffect`, `_beforeEndEffects`, ON_BUFF_FINISH / ON_SKILL_FINISH actions |
| `ready` | while the skill is ready to cast | `ReadySkillEffect`, an enemy's `ReadyEnemySkillEffect` (v2) |
| `trigger` | a buff's other events (periodic ON_BUFF_TRIGGER, reactive ON_TAKE_DAMAGE, …; `event` names it) | template actions |
| `other` | not placed | (none in the used set) |

An emitter row's role is relative to the cast of the ability it serves (`ability`): for an `ActiveBuffAbility` or a
`ReplacementSkill`'s single attack that cast is the skill's start, so `start` / `end` / `loop` follow the skill; when the
ability is an attack the skill repeats (`MeleeAttack`, `RangedAttack`, `Multi…Attack`, `ChannelingMeleeAttack` in a
skill that lasts), they follow each of its casts — `startEvent` / `endEvent` say where in the cast.

A buff's carrier (`on`): `owner` for the buffs a skill gives its unit (`ActiveBuffAbility` without a selector,
`BuffDuringSkill`, `BuffToOwner…`, passive and chant buffs), `targets` for the buffs an attack applies (`_activeBuffs`
— status loops such as `buff_burn` on Ifrit S2's targets; since v3 also an attachment's `_additiveActiveBuffs`, added to
the owner's attacks, a blocker's `_buffsToBlockee`, `_projectileBuffs`, the tile listeners' and LockTargetAbility's)
and the selector-driven or aura buffs, `token` for buffs a summon gets (`_buffsToToken`, `_buffsToExistToken`); absent
when unknown. Every use a buff carries has its `life` since v3 (§33.17). `by: 'name'` marks the few effects (11 in the used set: a buff blackboard's `effect`
value, an extra event group) whose field says nothing about time, placed by their names (`*_hit` / `*_heal` → hit,
`*_buff` / `*_loop` → loop, `*_start` → start, `*_end` → end, `*_range` → range).

`mode` is the owner's mode the skill switches to — its attacks then use that mode's cast / hit effects (and its
projectile): `modeBy: 'data'` when the skill's data say it (the blackboard `mode` of a `switch_mode*` buff, a
`ToggleSkill`'s `_switchToMode`), `'name'` when the owner has a mode named after the skill (`S<n>` for `skchr_…_<n>`,
case-insensitive; where both exist they agree in 204 of 210 skills). So a runtime plays, on the sim's events: skill
start → `roles.start` (+ `range`), while active → `roles.loop` on `on` (default the owner) and the attacks of
`modes[mode]`, each hit → `roles.hit` (+ the mode's hit / projectile effects), skill end → `roles.end` (and stops the
loops). The web runtime reads `uses` (not the flat `roles`) through `render/vfx/skills.js` and plays them as §33.16
says.

**Projectile** (`[uc]projectiles.ab`):

```
{ main (the flying effect key: the projectile class's _mainEffect; before 2026-10-15 the last `_mainEffect` of its
  behaviours), lifeTime (s: its _lifeTime),
  link? (the line a ChainLightningEffectBehaviour or a HarpoonRenderer draws: a chain's lightning, a harpoon's rope),
  movement: { class, … every field },
  onStart?, onReached?, onHit?, onStop?, toTargetOnStart?, toTileOnStart?, onTrigger?, onSelect?: [key…],
  effects: [every key], projectiles: [nested projectile keys], behaviours: [{ class, node, fields }] }
```

The flying effect is the projectile behaviour's own `_mainEffect` (`behaviours[]` of class SimpleProjectile,
HarpoonProjectile, LassoProjectile, LaserProjectile …). A `ChainLightningEffectBehaviour`'s `_mainEffect` is the
lightning between a chain's targets — the client plays it as the shot reaches them (ChainLightningHitBehaviour
OnProjectileReached / DoSelectTargetToHit → PlayLineEffect; the behaviour has no tick of its own, and all 17 of the
used set have `_linkSource` 0: no line from the shooter) — and a `HarpoonRenderer`'s the rope from the shooter's point
to the head, set every tick (OnTick / _UpdatePosition): line renderers whose points the game sets, authored in world
space. An index written before 2026-10-15 kept as `main` whichever `_mainEffect` came last: for 32 projectiles of the
full set (惊蛰's `projectile_leizi`, 异客, 莎草, 歌蕾蒂娅, 溯光星源, Mon3tr …) a line, and `lifeTime` was lost; the fixed
extractor writes the projectile class's own and names the line `link`. A reader takes the parts from `behaviours`
(the runtime's `render/vfx/flight.js projectileParts`: `main`, `rope`, `chain`, the LIMITED `life`).
`toTargetOnStart` / `toTileOnStart` (EffectBehaviour `_effectsToTargetWhenStart` / `_effectsToTileWhenStart`) play on
the target and on its tile when the projectile starts — 溯光星源 S3's lightning, whose projectile has no flying effect
(a SimpleProjectile with a 0.517 s LIMITED life: a timer whose hit comes at its end); `onHit` at each target hit.

`movement.class` is `AdvancedMovement` (fields `speed` in tiles/s, `moveType` — *metadata* MoveType: 0 NONE,
1 TRACE_TARGET_WITH_SPEED, 2 TRACE_TARGET_WITHIN_TIME, 3 TWO_POINTS, 4 FIXED_DIRECTION, 5 FIXED_DISTANCE,
6 FUNC_ANGLE_AND_TIME, 7 FUNC_INIT_SPEED_AND_ACC, 8 FUNC_CURVE_AND_X_LENGTH, 9 FUNC_TURN_AND_WAVE_TO_TARGET —
`rotateToTarget`, `comeBack`, `delayToStart`, …) or `ParacurveMovement` (`speed`, `raiseHeight`,
`noRaiseHeightThreshold`, `inverseParacurve`, `useRandomHeight`, …: a lobbed arc). **Resolved** (the client's
ParacurveMovement OnInit / OnTick / _CalculateNextPosition): the projectile starts at the shooter's mount point and
crosses the ground at `speed` homing on the target's point; its raise h is `raiseHeight` (`useRandomHeight`: a value
in `randomHeightRange`), 0 when the ground distance is not above `noRaiseHeightThreshold`; with H = max(0, start height
+ h − end height) and T = distance / speed it climbs at √(2gh) under g = 2(√h + √H)²/T² — it tops out h above its
start — and after the top g is re-solved each tick to land on the target's current height; `inverseParacurve`
(`randomInverseParacurve`: a coin) flies the mirror image. As a function of the flight fraction k the height is
start + 2√h·s·k − s²·k² (s = √h + √H) whatever T is. **Resolved** (0.3.1, history §34.6: their Comeback state): a
movement with `comeBack` turns, after the hit, into a leg back to the source's HitPoint at `speed` ×
`comeBackSpeedScale` (跃跃's `projectile_chr_caper` 15 × 0.25 = 3.75 tiles/s, the sim's BOOMERANG_RETURN_SPEED), stepping
at that speed toward the HitPoint as it is now — a duration locked at the turn would cover a thrower who moves in the
original time, faster than 3.75 —, a ParacurveMovement along an arc rebuilt only when its start height, end height or
ground distance changes; the projectile keeps its main effect until it is back and then
clears it, and a source gone takes nothing back — 10 projectiles (跃跃's, 娜仁图亚's). The pause before that leg is not
1 s: on a ParacurveMovement / NarantS3Movement `delayAfterReached` is 0 or 1 (a flag) and `delayTime` is the seconds
(0.01 on `projectile_chr_caper_s2` / `_s2_1` and `projectile_chr_narant_s3` / `_s3_1` / `_s3_2`); on an AdvancedMovement
`delayAfterReached` itself is the seconds (0.01, or 0 on `narant_s2`). 0.01 s is under one sim tick, the return
projectile already waits for the next tick, and the visual turns back on the hit so it stays on the sim's catch
[ASSUMED: the raw float pmUpdateAfterReach waits at +0xec is `delayTime`]. `AmiyaS2Movement` (安洁莉娜 S2): straight and homing in `time` s
after a start phase of `startDuration` towards `startDistance` in a random direction, its body at
(0, sin φ · `yAnimateOffset`, 0) across the flight, φ advancing 2π · `yAnimateSpeed` per second from a random start. The
sim keeps its own projectile speeds; the visual flies its flying effect along the sim's flight and plays `onHit` at the
target's HitPoint (`onReached` where it lands). Graphic / logic pairs (`projectile_amgoat_s3_graphic` / `_logic`) are
listed as nested projectiles.

**Skin** (mount points): `{ source, graphic, points: { name: { facing: { pos, bone, path, rot, followRot? } } } }`
(`rot` / `followRot` since 2026-10-15, below). `pos` is the point in
the unit's root frame (Unity axes and units, through the unit's `Graphic` node and the skin's FaceSwitcher scale) — e.g.
隐现's `HitPoint` (0, 0.232, −0.250): 0.25 above the feet. The prefab root's own transform is no part of it (index version
2): an enemy or token prefab's root sits where it was authored — 88 of the used set's sit tiles away (`enemy_1007_slime`
at (3, 3, 0), `token_10050_monstr_prosts` 99.8 down) — and the game places the unit; an operator's skin root may carry
an offset the client drops when it attaches the skin (`char_446_aroma`: −1.895 in x). Version 1 composed it, so those
skins' points sat tiles away from the feet (the runtime's `skinShift` moved 84 of them back). `facing` is `front` /
`back` (operators have Front and Back skeletons) or `all`. `bone` names the Spine bone a `BoneFollower` keeps the point
on (`F_Muzzle`, `B_Muzzle`, `Muzzle`, `Hip`, …; 125 of the 126 operators' muzzles, every Special point): such a point's
`pos` is that bone in the prefab's edit-time pose — the 0-length `Default` clip: 灰毫's Muzzle 16 skeleton units above
her feet, her cannon lowered; 溯光星源's 2.45 tiles to her right, her Idle's parking spot — while in battle the client
reads the point's live transform (`MountPoint.get_mapPositionV3`, or the same bone baked per frame): a shot leaves
where the attack clip holds the muzzle when it fires. A runtime reads the bone from the unit's skeleton (§33.16
Placement), `pos` only without one. `rot` is the point's local rotation in its parent (Front / Back / FaceSwitcher —
none of them turned in an operator's skin; quaternion x y z w). spine-unity's BoneFollower (the point's parent holds
its skeleton) sets the point's local position from the bone every frame and, with `followBoneRotation` (`followRot`
true: 1,064 of the used set's 1,118 bone-followed points), its local rotation to the bone's angle about z; without it
the point keeps `rot` — 洛洛's SpecialPoint1 on F_UVA_01 and 令's SpecialPoint2 on F_Effects_01 are turned 30° about x
(the only X / Y turns a point keeps: 19 enemy and token points with the same 30° follow their bone's rotation). A point
no bone moves keeps `rot` too (the identity but for 3: `enemy_2025_syufo`'s HitPoint and HeadPoint,
`token_10012_rosmon_shield`'s Special0, 90° about z). Operators' points come from `chararts/<id>.ab` (`defaultskin`)
placed under the charpack's `Graphic`; enemies' and tokens' from their own prefab. Point names vary by skin:
`HitPoint`, `HeadPoint`, `HeadAnchor`, `Muzzle` / `MuzzlePoint`, `Special0` / `SpecialPoint0` (… `1`, `2`).

**generic**: `{ hit: { phys, arts, heal, enemy, fire, cut, ranger }, die: { char, enemy }, birth: { char },
status: { <sim status>: key }, keys: [every generic key exported] }` — the keys the client binds in code (no data file
names them): the hit by damage type, deaths, deploy, and the status loops by the sim's status names (render/style.js
`STATUS_ICON` keys; e.g. `stun` → `buff_stun`, `freeze` → `buff_autochess_frozen` — this mode's own frozen effect —,
`cold` → `buff_cold`, `sleep` → `buff_sleep`, `burn` → `buff_burn`). The map is the extractor's default
(`FX_GENERIC`); `keys` also holds every prefab of `buff.ab`.

**prefabs**: key → `{ file, bundle, nodes, particleSystems, liveParticles, duration, looping, refs, spawn?, follow? }`
(the descriptor's stats and `refs`; v2: `spawn` = its first enabled `ParticleEffect` / `EmptyEffect`'s `_spawnLocation`
and `follow` = its first enabled `FollowMountPoint`'s `_mountPointType`, §33.11, when it has them — where the effect
sits on its owner without loading the descriptor).

### 33.13 The Phase 1a sample (a subset of the full set, §33.14)

`extract.py --only fx` exports (client 26-09-13, `set: 'sample'`) 126 prefabs from 32 bundles, 290 textures (each with
a half-size copy), 43 meshes, 9 units, 11 projectiles, 12 skills — 6.8 MB (descriptors 2.2 MB, textures 3.9 MB, meshes
0.4 MB, index 0.1 MB):

* the keys of the brief (`FX_SAMPLE_KEYS`): `common_hit_01`, `common_firemagic_hit_01`, `common_enemy_hit_01`,
  `common_char_die_01`, `common_enemy_die_01`, `common_char_birth_01`, `buff_stun`, `buff_frozen`,
  `buff_autochess_frozen`, `buff_sleep`, `buff_burn`, `buff_cold`, the 隐现 (`inside_attack_01_*`), 格雷伊 (`greyy_*`),
  赫默 (`silent_attack_01_trail` + `myrrh_attack_01_hit`), 伊芙利特 (`ifrit_attack_01_start`, `ifrit_skill_03_*`),
  艾雅法拉 (`amgoat_skill_03_*`), 法术大师 (`lazerd_attack_01_*`) sets and `enemy_tidmag_attack_01_hit`;
* every effect the sample units reference (`FX_SAMPLE_UNITS`: `char_498_inside`, `char_253_greyy`, `char_108_silent`,
  `char_134_ifrit`, `char_180_amgoat`, `enemy_1041_lazerd(_2)`, `enemy_1161_tidmag(_2)`) and the generic keys;
* one prefab per rarer feature (`FX_COVERAGE_KEYS`): mesh-shaped emitter `swire2_skill_02_range`, ribbon trail
  `kroos2_attack_trail_01`, particle trails `bldsk_attack_01_start`, rate over distance `vendla_attack_trail_01`, orbital
  velocity `akkord_skill_02_buff_01`, velocity alignment `jesca2_skill_01_trail_01`, horizontal billboards
  `chen2_skill_02_range_01`, custom-data shaders `enemy_tgshd_attack_start_01`, clips on GameObject.active
  `crosly_attack_a_start`, on a LineRenderer `aphris_attack_01_line_01`, on a ParticleSystem `buff_yang_conversion_01`,
  birth / collision sub-emitters `enemy_jakill_reborn_03_start` / `irene_skill_03_range_02`, prewarm + lines
  `enemy_achunt_chain`, skinned meshes + legacy clips `ifrit_skill_03_buff`, and the behaviour classes of §33.11
  (`chen2_skill_01_buff_02`, `indigo_skill_01_buff_02`, `angel2_attack_loop_start_01`, `sbell2_ground_01`,
  `lumen_skill_02_hit`, `glady_skill_01_line`, `phatm2_skill_03_buff_02`, `etlchi_innate_hit_01`, `enemy_crstf_buff_01`,
  `yu_skill1_attack_01`, `aglna2_skill_02_buff_weapon_02`);
* the keys those prefabs' behaviours name (a second pass): `amgoat_skill_03_buff_end`, `angel2_attack_up_loop_start_01`,
  `angel2_attack_down_loop_start_01`, `chen2_skill_01_buff_02_b`, `common_disarm_icon`, `indigo_skill_01_buff`.

Checked on the output: clip decoding against known values (`buff_stun` z 0 → −720 over 10.03 s; the gate pulse's
`_TintColor.a` of `[pack]map.ab`), material blend states against the shaders (AlphaBlend takes its source factor from
`_PremultiplyAlpha`, default SrcAlpha), mount points against the transforms they compose, every clip binding resolved
(675 curves, no `crc:` property; 50 name objects their prefab lacks), every key the index names has a descriptor.

### 33.14 Phase 1b: the full set

`extract.py --only fx --fx-set used` (Windows client 26-09-13, 8 processes on the maintainer's Mac) exports 516 units
(210 operators, 243 enemies, 57 tokens and the 6 enemy aliases), 538 projectiles, 529 skills and 4,253 effect prefabs
from 264 bundles — 3,990 named by the units, their skills and the skills' buff templates, the generic keys and the
sample's, then 263 named by the exported behaviours (two more passes) — with 3,303 textures (3,263 with a half-size
copy) and 1,201 meshes: 12,023 files, 186 MB — descriptors 118 MB (17 MB gzipped, as the server sends them), textures
35 MB + 15 MB half-size, meshes 11.5 MB, `index.json` 5.4 MB (0.3 MB gzipped), `textures.json` 0.85 MB; the file list
`data/local-fx.json` has 8,759 entries, 1.2 MB (0.1 MB gzipped). The run takes 172 s: the bundles' prefab lists 0.5 s
(cached; a first run reads the ~600 effect bundles once), units, skills and buff templates 47 s, the prefabs 124 s
(757 s of CPU). No prefab fails, and the consistency test (`test/local-extract-fx.test.js`) passes on the output: every
key the index names — attack rows, slots, hooks, skill uses — has a descriptor, every listed file exists.

Skills: 497 of the 529 have effect roles (§33.12; 0 keys left unclassified, 11 effects placed by name); 22 more name no
effect of their own but switch to a mode, whose attacks carry their effects; 10 name neither — `skchr_doroth_1`–`3`,
`skchr_prove_1`, `skchr_silent_2`, `skchr_sunbr_1`, `skchr_svrash_1`, `skchr_vodfox_2`, `skchr_vvana_3`,
`skchr_wang_1`: what the client shows for them comes from what they place (tokens, traps), the unit's own animation, or
nothing. 333 skills have a mode (221 from their data, 112 by name).

### 33.15 Phase 1c: index.json and the meshes version 2

`extract.py --only fx --fx-set used` with the Phase 1c extractor (Windows client 26-09-13, 8 processes on the
maintainer's Mac) exports 516 units, 541 projectiles (+3), 596 skills (+67: 65 summons' `sktok_*` and two `skcom_*` of
the 补位 / 自选 forms) and 4,311 effect prefabs (+58, none dropped: the enemies' and summons' skills' effects and their buff
templates' — `doroth_bomb_*`, `cqbw_skill_02_*`, …), 3,323 textures (3,282 half-size copies) and 1,214 meshes (version
2: 11.0 MB, 11.5 before — 0…1 colours write shorter than bytes): 12,132 files, 188.1 MB (+1.9 MB); descriptors 119.8 MB
(17.3 MB gzipped), `index.json` 6.0 MB (0.33 MB gzipped; 5.4 / 0.29 in version 1), the file list 8,850 entries, 1.2 MB.
The run takes 152 s (units, skills and buff templates 45 s). 90 skins' points moved (the root transform, changelog (9)):
every HitPoint of the set is now within 0.33 of the feet across and 1.15 up. The consistency test passes on the output
(`SP_FX_ROOT`, §33.1), now over every attack, combat, sub-ability, charge group and enemy skill, the skins' hit points
and the meshes' colours as well.

* **Mode attacks.** The subclass emitters (§33.12): 15 MultiCharge attacks of 深靛, 黑键 and 维伊 (维伊's six are the
  sub-abilities of an AbilitySelectableGroup), 19 MultiHit attacks with 46 hit groups (8 operators and
  `enemy_1535_wlfmster`), 16 UberAnimation emitters of 10 operators (22 rows with `anim`; 圣聆初雪's and 谬因's name none:
  empty replace groups next to a plain emitter). Operators with attack rows: 202 of 210 (189 in version 1); enemies 197
  of 243 (75): `combat` is in 220 enemy modes, the only attack in 169; summons 21 of 57 (19). Sub-abilities: 66 operator
  attacks and 2 combats, 8 enemy, 2 summon; `attack.emitters` on 39 operator attacks.
* **Charge.** 深靛: an AbilityChargeableGroup of 3 energies, its node's emitter with 4 per-energy loop groups, 3 store
  abilities (Default, S1, S2 — each with its projectile, mounts SPECIAL_1, SPECIAL_2, SPECIAL_3, SPECIAL_0 and a 4-group
  one-shot emitter). 黑键: an AbilityExChargeGroup of 3 ExCharge abilities (Default, S1: a normal emitter with 4 + 4
  groups and an elite one, `isExEffectEmitter`, with 1 + 1, mounts SPECIAL_0–3 and elite SPECIAL_4; S3: elite only,
  5 + 5, `forceExCharge`). 维伊: an AbilityChargeableGroup of 9 energies, `mergeSize` 3, its node's emitter with 5 + 5
  energy and 4 + 4 merged groups, 3 store abilities (Default, also released in S1; S2; S3).
* **Skills.** `rootClass`: CastSkill 369, ReplacementSkill 38, ReplacementSkillFixed 37, PassiveSkill 34,
  CastSkillWithLimitTimes 27, AppearSkill 26, AttachOrDetachSkill 20, CastSkillWithSuspendable 15, MultiAppearSkill 9,
  CastTokenSkill 7, … The 10 skills with MultiHit groups (§33.12) carry `group`.
* **Enemies' and summons' skills**, against the game's roster (tools/vfx-skill-coverage.mjs's (unit, skill) pairs: 126
  of enemies, 78 of summons): 123 enemy pairs have an entry (120 skill entries on 78 enemies, 91 with uses; the copies
  of 4 bosses' skills differ by mode) and 71 summon pairs (66 summon skills, 22 with uses). Without one:
  `enemy_1174_duholy(_2)` `Flame` (the prefab has no such node: an attack and talents only), `enemy_9023_acdums`
  `Skill` (its abilities are `CommonAbilities` — AOE, PassionSkill, DepassionSkill — with no skill node);
  `sktok_mtship_1` / `_2`, `sktok_mcgraf_1`, `sktok_svash2_2` (three tokens), `sktok_phatm2_mndclv_3`: no skill prefab
  in the client (nor in the iOS hot update of 26-10-08) — skills of the data only. The operators' pairs: 548 of 549
  (534: the forms' `skcom_*` were not crawled); `skcom_assist_cost[3]` has no prefab either.

Still outside the index after Phase 1c: the effect emitters of talents (deploy effects, the bosses' revive loops), common
abilities (stand switches, revives) and a few modes' general abilities (funnels, an aura) — 33 units, 47 nodes. Phase 1d
exports them (§33.17: 42 of the 47; the other 5 are attacks no mode references).

### 33.16 The runtime's skill wiring (0.3.0 Phase 3b, 3c, 3d)

The field view plays a skill's effects from its `uses` (`render/vfx/skills.js skillPlan`: each use placed by its
role, its ability, its events and its carrier — the module header; `render/vfx/skillfx.js` plays the plan, DESIGN §9
"Official battle effects", Skills) and a unit's attacks from its modes (`render/vfx/wiring.js`). What it reads of
index.json — version 1 and the version 2 fields (§33.12, §33.15; Phase 3c) — and what it does with them:

* **A unit's skill**: the unit by FxWiring's candidates (a stand-in's or a 自选 pick's operator, the chess' operator,
  the spine, the def id), its skill from our data record's `skills[]` by the loadout's index (`prefabId`, else
  `skillId`), looked up in the unit's `skills`, then in `skills`; without a record, `skchr_<code>_<index + 1>`; a summon
  without a record of its skill, the only one its unit has [ASSUMED] (version 2 lists the summons' skills).
* **Modes**: `skills[id].mode` names the attack mode while the skill is on (`modes[mode].name`). A mode whose name
  ends in `[Down]` / `[D]` / `[DOWN]` / `(D)`, `(U)` or `(LR)` is a facing variant: the unit facing that way attacks in
  it, else in the plain mode (DESIGN §32.14.36; before, a variant was never chosen) [ASSUMED: by the names]; a skill
  that names no mode while its unit has only variants of `S<n>` (灰毫 S2: `S2(U)` / `S2(D)` / `S2(LR)`) switches to
  the variant. A unit without a resolved skill keeps `S<n>`. An enemy in a form
  whose name is one of its modes' (case aside; `form2` → `Reborn`) attacks in that mode, and its skills play that
  mode's copies.
* **Events**: a use's `startEvent` / `endEvent` are AbilityStandard/Event names (`ON_CAST_START` …), a unit's Emit row's
  numbers; ON_ATTACHED / ON_CAST_START rows start with the cast (the attack's wind-up), the others at the strike.
* **Mode attacks (v2)**: an 'atk' plays the mode's `combat` for a melee blow of a unit that is blocked or blocks
  (UF.BLOCKED) and when `attack` is null, else `attack`; a ranged-kind 'atk' of an operator on an enemy while both show
  UF.BLOCKED and the enemy stands within the sim's block radius of its centre (0.75 / 0.95 tiles, ground / air) is such
  a blow when its mode has both (the 领主s and 伊内丝: the sim names their every attack by the ranged kind; round 46, history
  §32.14.41) [ASSUMED: the snapshot does not say who blocks whom]. A group ability fires its `abilities` as §33.12 says: a
  Parallel group all of them, a Random group one picked by a seed of the unit's id and attack count (the same in a
  replay), the other groups the first that fits the attack (a heal: /Heal/, a shot: /Ranged/, a blow: neither; a
  `Blocked…` node — 号角's BlockedRangedAttack — only while the unit blocks, and then first [ASSUMED: the configs'
  triggers are not exported]), else the first; a funnel attack is one attack. The attack flies the first fired ability's `projectileKey`. A row plays as
  its `emitter` allows: an UberAnimation replace group's row (`anim`) when the attack plays that animation — for
  `loopType` 1 the group animations in turn by the unit's attack count [ASSUMED], else the animation the model plays
  (SpineActor.attackAnim), else `sourceAnimKey`; an InCertainMode emitter's rows only in the mode of index
  `activeMode`; a VigilWolf row bound to a buff of its owner (`buffKey`) while the owner holds that buff — the client's
  VigilWolfCastEffectOptions.PlayEffect checks Entity.ContainsBuff — read from the 狼群's 狼影 count (b.snap `wolves`
  [left, max], `wiring.js WOLF_BUFFS`): the 狼群领袖 talent's `vigil_wolf_t_1_enhance[holder]` buffs (one per 狼影 beyond the
  pack, `[born]` making one at the deploy) each derive a `…[damage]`, held from 2 wolves on (`vigil_token_sub_attack_1`),
  and `…[trigger_override]` exists while the holders are at max_stack_cnt (all 3 wolves: `vigil_token_sub_attack_2`)
  [ASSUMED: the sim's count is the client's holders + 1]; a row bound to another buff never (0.3.1, audit R19; before,
  every buff-bound row was skipped). Version 1's
  attacks carry none of these fields and play as before. Version 3 (Phase 3d): the UberAnimation `loopType` is 0 LOOP
  (in turn) and 1 RANDOM (a seeded pick — §33.17 resolved it; Phase 3c had taken 1 for in turn); a group's `select`
  decides its sub-ability — `parallel` all (its `main` first: that one's projectile), `random` a seeded pick
  (`diffFromLast`: never the previous one; `probKeys` weights are not read: equal odds [ASSUMED]), `loop` / `sequential`
  in turn by the unit's attack count, `trigger` / `firstSucceed` the first of the attack's kind, a BurstAttackGroup's
  `burst` attack left out [ASSUMED]; the ability firing the projectile gives the shot's `mount` (else the muzzle), a
  `mountGroup`'s points in turn (LOOP) or at random, and `additionalTimes` follow-up shots every `triggerDelta` s flying
  `additionalProjectile(s)` (else its own) — drawn only, the sim deals the attack's hits with the attack.
* **Hit groups**: a MultiHit emitter's grouped rows are the hit groups — every group kept, an empty one too (that hit
  plays nothing); hit k of a blow (its k-th HP 'dmg' or 'heal' on the target in the blow's frame) plays group min(k,
  last), k mod n with `useLoopHitEffect`, a seeded group with `useRandomHitEffect`, only the first with `oncePerTarget`;
  the attack's rows without a group play on every hit (a MultiHit emitter's own only with `keepBaseHitEffect`, as §33.12
  says; no emitter of this client has both). A skill's uses carry `group` / `groups` and the emitter's flags the same
  way (`skills.js hitGroups`, `hitOptsOf`); a version 1 index's flattened rows keep the `_range` rule of §33.12's
  skills.js reading.
* **Attack abilities of a skill** (`ability` matching /Attack|Heal/, not Channeling*): their rows replace the attack
  mode's while the skill is on; a ranged one flies its ability's projectile — index v3: `skills[id].abilities[]`
  (`projectileKey` by node and class, also an ability with no rows of its own) or a use's `projectileKey` — else one of
  the skill's `projectiles` by the naming rule (the only one, else the shortest named `_s<n>` / `_sk<n>` after the
  skill's number, else the first), with the ability's mount and follow-up shots.
* **A skill's own casts and its kit's hits** (history §32.14.43): attack abilities of a skill that are no normal
  attack carry `when` on the plan — `'end'` for a final attack (the node `FinalAttack` / `EndAttack` …, or every cast row
  `end`: 灵知 S3, 薄荷 S2, 歌蕾蒂娅 S3, 锏 S3 [ASSUMED: by the names]), `'start'` for the attacks of a lasting or passive
  skill whose root ability is an AbilitySequenceGroup (the skill runs it once as it starts: 缄默德克萨斯 S2 / S3's appear
  strike, 仇白 S2's sword split, 余 S2's teleport, 焰影苇草 S2's fire balls; our record decides the kind) — and never stand
  for a normal attack (the mode's rows do): their cast and range rows play on the owner at the skill's start (a
  passive's: its deploy) or at its 0. Their hits, and those of an instant activation with no 'atk' between its 1 and 0,
  are the frame's *kit hits*: 'dmg' names no source, so an HP 'dmg' on the owner's enemies (a heal ability: a 'heal' on
  its side) that no attack owns — no waiting blow, no melee attacker, no floating unit's hit — in that frame after the
  activation, the start or a bound kit fx is a hit of that attack (hit k of a target its group, the first its aims and
  the attack's buffs) and stands for the procedural spark / generic heal; a final attack's hits are the damage of the
  0's frame before the 0 (the kit deals it first) [ASSUMED: a kit hits in that frame]. In the frame of an instant
  activation its attack is the skill's whatever kind the sim made it (阿罗玛 S1's 'beam', 夕 S1's 'bolt'; a heal stays
  a heal), and a ReplacementSkill's replaced attack may follow its 0 in that frame (华法琳 S1): the no-attack fallback
  waits for the frame's end. A kit fx may stand for a plan attack (`FX_BINDINGS` `attack`: 锏 S3's 'slash' is her
  Damage ability).
* **Facing variants of a buff template** (history §32.14.43): the uses of one template action (same `from`, event,
  action, buff, node, carrier, role) whose keys are one effect's variants by name — `<base>_up` / `_down` / `_left` /
  `_right`, `_back` (facing up), `_front`, the plain `<base>` — are one entry with `slots` picked by the owner's deploy
  direction (`skills.js dirFamilies`; a facing without a variant of its own plays the plain key, else `_front`): the
  client's CheckCharacterDefaultDirection branches (仇白 S2's sword wind: UP `_up`, DOWN `_down`, RIGHT the plain key,
  else `_left`), which index.json writes as a use each without the condition. Before, every variant looped at once.
* **Buffs on targets** (`on: 'targets'`) from an attack ability's `_activeBuffs` loop on that attack's targets by the
  buff's `life` (index v3): LIMITED for its `time` or our record's blackboard value of its `key`, INFINITY while the
  skill lasts, IMMEDIATELY once (`skills.js lifeOf`); without one (or a LIMITED one no blackboard gives) for our
  record's blackboard duration (`duration`, `…_duration`, `….duration`), else while the skill lasts.
* **Charges**: a unit's `charge` (v2: the chargeable groups) makes the charge plan (`skills.js chargeFromIndex`): the
  reference store ability is the one whose `modes` hold `Default`; its slots are the group node's emitters' and the
  reference's non-ex emitters' groups (`chargeEffectGroups` at ON_SPELL_ON: the stored energy's loops; the others: the
  one-shots of the store), each at the reference's `mountPointForProjectiles` point (else its effects' `follow`); the
  elite slots are the ex emitters' (`isExEffectEmitter`) at `exMounts`, a `forceExCharge` ability's for its modes; the
  merged slots `mergeSize`'s; the cap `maxChargeTimes`; the projectiles each ability's (`projectileKey`,
  `exProjectileKey`, `mergeProjectileKey`) for its `modes`. For 深靛, 黑键 and 维伊 this gives the transcribed table
  (`CHARGE_EMITTERS`), which stays for a version 1 index.
* **Root class**: a skill's `rootClass` is kept on the plan (`plan.rootClass`); a ReplacementSkill* is one cast (the
  plan's kind `instant`: its single attack is the skill), a PassiveSkill without our record a passive.
* **A token's skill record** (0.3.1, audit R18; `skills.js skillRecordOf` / `tokenSkillRecord`): data/tokens.json
  writes only `{ skillId, bb }` at a token's top; the full records (skillType, duration, prefabId) sit in its owners'
  `variants` — `skill` and `bySkill[i].skill`, one per index of the owner's skill choice, the def the sim merges for
  the token, whose UnitInfo `skillIndex` is that record's `index`. The plan takes the variant record with the unit's
  skillIndex (浊心斯卡蒂 S1 / S2 / S3 → her 海嗣's sktok_skadi2_1 / _2 / _3), else the top record with the type fields of
  the variant record of its id. 诅咒娃娃's PASSIVE record makes its plan a passive: its aura `vodfox_skill_02_buff`
  loops from the deploy while it stands (the sim sends no skill event for a passive with a duration, and the plan read
  as instant without a type); the 海嗣's aura loops while it stands too (its PASSIVE token skill). A passive token
  skill's mode holds from the deploy (every 香槟炸弹 in M2: its ability loop and M2's two hit rows); 流形's MANUAL
  records make its plan lasting, and only S3's (sktok_mlyss_wtrman_3) has effects. [ASSUMED] the variant record is
  the first owner's (the base piece `_a`; UnitInfo names no summoner): an elite `_b` owner's record of the same index
  differs only in level, text, blackboard values and (蜜蜡's 沙之碑) SP cost — the base piece's values, as the top
  record had.
* **An AppearSkill's start effect** (0.3.1, audit R21; plan entries with `birth`, `SkillFx.birthOf`): the
  `_overrideStartEffect` use of an AppearSkill / MultiAppearSkill is the unit's deploy effect while it fights with that
  skill — the client's Character.GetStartEffect returns it before the mode's `overrideStartEffect` and the unit's own
  `_startEffect` (else the generic deploy) —, so `FxWiring.deploy` plays no other one: 缄默德克萨斯 S1 shows
  `texas2_birth_01_start` alone, S2 / S3 (`common_empty`) no deploy effect beside the appear strike, 斯卡蒂 S2 her
  looping `skadi_skill_02_start` without the generic pillar (弑君者 S2 / S3 alike). A passive plays it with its start
  one-shots (a looping one held while the unit stands); for another kind the deploy plays it and the skill's start
  leaves it out.
* **Enemy skills (v2)**: `units[enemy].skills` by the lower-case `prefabKey` of the enemy's data record's `skills[]`
  (the slot order). A skill's window opens on ['cast', id, slot, dur?] — since Phase 3d the sim sends it (SIM.md,
  `content/enemies/helpers.js castSlot`: a cooldown cast, an SP skill's attack before its 'atk', a kit's own moment) —
  or, for an enemy whose record has a single skill, when the snapshot's anim turns SKILL (the sim holds it 0.5 s after
  an ability fires) [ASSUMED]; it plays the plan's start, range and loops, the enemy's attacks in it play the skill's
  attack rows (a skill of attack rows with no 'atk' in its first frame — the kit flies its own shot — plays that
  attack's cast and range rows [ASSUMED]), and it ends — its loops stop, its end plays — once the anim leaves SKILL and
  its time is over (the event's `dur`, else 0.3 s [ASSUMED]), or on the enemy's death or leak. A use's `mode` picks the
  copy of the enemy's current mode; `inModes` is not needed. Not drawn: the skill's effects on others (`on: 'targets'`:
  no event names them). A skill whose root ability is an attack (`rootAbility` …Attack: RangedAttack, MeleeAttack) is
  that one attack: once the kit's own fx stood for it (an Enemies' areas binding below drew in its window), the enemy's
  attacks in the rest of the window are its normal ones (0.3.1, history §34.5: the 'cast' of 鼠王's 【沙狱】 carries the
  debuff's 15 s, and every attack of the boss in it played the sandstorm `mousek_skill_02_range` on its target; a skill
  whose attack is a later 'atk' — 暴鸰's bomb, 0.27 s after its 'cast' — keeps the window's rows for it) [ASSUMED: the
  window's `dur` is then the skill's effect's, not a time the attacks change].
* **Enemies' areas** (0.3.1, the maintainer's report of 2026-10-16, history §34.5; `skills.js ENEMY_FX_BINDINGS`,
  `skillfx.js _enemyFx`): a zone names no source (`content/enemies/helpers.js zone`: ['fx', 'zone', x, y,
  { r, dur, kind }]) except 【污染秽蚀】, whose fx carries `pollution`'s src (display only). A binding by the enemy's unit
  key says how its fx finds the enemy — `id`; `died`: one of that key that died in the fx's frame within OWNER_NEAR (1)
  tile of its point (a death zone: the sim makes it in the death hook, after the 'die'); `cast`: one whose skill (its
  prefabKey) was cast in that frame (castSlot comes in the same tick); `near`: a standing one within OWNER_NEAR of it;
  `any`: the kind is that enemy's alone. Tried as: the unit the zone's id names, then a death within OWNER_NEAR, then a
  cast the zone does not name, then a unit at the point, then the kind alone [ASSUMED: a zone with no id belongs to the
  death at the point, else to the cast]. A binding that draws nothing does not claim the fx. A zone plays its prefabs at
  the fx's point on the ground, the looping ones for its `dur`: 萨卡兹枯朽战士 / 组长's death pool (PollutedDie's
  `projectile_enemy_nhpbr_polluted`, whose `toTargetOnStart` `enemy_nhpbr_attack_range` loops until the projectile stops
  — its life the blackboard's `projectile_life_time`), 萨卡兹枯朽战车 / 尖端's 秽蚀轰击 pool (AttackPolluted's
  `projectile_enemy_nhtank_polluted` reached `enemy_nhtank_attack_range`; the zone's id keeps it when a warrior also died
  on that tile), 假想敌：蚀裂's cloud on its killer (`projectile_enemy_actoxi` reached `enemy_actoxi_idle`), 咸鳞汁推荐者's
  barrel zone (BlockedBoom's `projectile_enemy_wintun_range` reached `enemy_wintun_range`), 鼠王's 【沙狱】 (the
  castTarget row `mousek_skill_02_range` — the sandstorm, a one-shot of 21 s — once on the target). An aura's tick its
  talent loops stand for (talentfx.js draws them: 深溟巢涌者's 'pulse' — AOE —, 鼎沸's 'boil' — aoe —) skips the
  procedural pulse, and one unclaimed HP hit in that frame on a unit inside the sim radius that no attack owns plays the
  aura's buff effects on it (each aura takes at most one per unit, and that hit is offered to every aura in the frame
  [ASSUMED]: the talent's uses `on: 'targets'` — a trigger once, `enemy_dsubrl_attack_hit`; a loop held AURA_HOLD_S
  (1.25 s) past the last tick, `enemy_cjhot_debuff`) instead of the procedural spark. A unit past the radius keeps its
  spark. A mode's loops: 水遁忍者's spin ('telegraph' of kind 'spin') plays its mode M1's RotateEffect loop
  (`enemy_ymgtop_skill_01_buff_01`, a buff its template creates at its tick, which talents.js leaves unmapped) for its
  record's `EndRotate.rotate_duration`, until 失衡's 'phase' spinStop or its death [ASSUMED: the loop lasts the sim's
  spin]. The bound prefabs preload with the battle's units (SkillFx.keys). Layer off, or the prefabs not installed: the
  procedural fx.
* **Summons' skills** (v2) play like an operator's.
* **Talents and abilities (v3, Phase 3d)**: `render/vfx/talents.js` plans every talent node and ability of a unit with
  the skills' planner and binds it by `when`; `render/vfx/talentfx.js` plays it. In force: an operator's or a summon's
  talents by its record (`talents[].index` → `talentKeys.base`, a `fromModule` one → `modules[record.module.id]`, the
  `trait` always), a node with `skills` only with one of those equipped; an enemy's all. A talent's uses find their node
  by its path, and by `ability` or the field's class where nodes share a path; a mode's copy (`same`) plays its
  original's. `deploy` — its one-shots at the 'deploy' (an enemy's or a summon's 'spawn'), once per life, and its loops
  while the unit stands (AppearSyncedTalent auras); `passive` — its loops while the unit stands, a node in a mode (a
  general ability's `modes`) while that mode is on (the skill's mode window, a form); `toggle` — while its checkers
  hold: HpRatioToggleChecker on the snapshot's HP ratio (a full-range checker beside a blackboard `hp_ratio` takes that
  bound [ASSUMED]), BlockedToggleChecker on UF.BLOCKED, the enemies' 隐匿 (AdvancedCompound, `common_invisible`) on
  UF.STEALTH, one that only turns off while blocked off while UF.BLOCKED and `restoreDelay` s after; any other checker
  has no signal; `reborn` — the 重生's knock-out fx ('reborn', 'stone' form) plays the handler's rows held until the
  stand-up fx ('form2', 'fly'), which plays its end rows and the talent's own buffs (`RebornTalent._buffs`: LIMITED for
  its blackboard key's value in our enemy record's `talents.bb` under the talent's `bb` prefix — the 无敌 loop —, INFINITY
  while the unit stands, IMMEDIATELY once), a husk's revival ('revived') its ManualTriggerRebornTalent's `_effects`;
  then `reborn.mode`'s attacks; null — the sim fx its `triggers` name (a fatal blow, ON_BEFORE_TRY_SET_HP_ZERO:
  'substitute' / 'undying'; a stand-in buff's ON_BUFF_FINISH: 'swap' / 'dollEnd'; ON_SKILL_START: the skill's start;
  ON_OWNER_BORN: the deploy), its rows once (a loop for 3 s [ASSUMED]); `attack` — only where a kit fx marks the
  talent's attack ('extraAttack': 守林人's 受选之人 — the attack's casts on the owner, its hits on that attack's target), else
  nothing (8 roster nodes). The forms' modes come from the data (`talents.js formModes`: a RebornTalent's 'form2' →
  `reborn.mode`, a husk's modes, a 傀儡师's 'doll' → the mode its fatal-blow node switches to — 风丸 → Stand, whose attack
  rows then play), else a form named like a mode. An arts barrier's talent (its key names a shield) plays while the
  barrier holds: the sim's 'shieldBreak' ends it, its 'artsBarrier' phase raises it again [ASSUMED]. **Per-layer loops**
  (round 46, history §32.14.42): a binding's loops that its buffs create with CreateBuff(s) at a buff event and whose
  prefabs pause one another (PauseAnotherEffect, §33.11) are a stack, bottom (pausing none) to top. An ally plays the
  lowest n for the n hit-negating layers the sim reports (b.snap `layers`, sim `snapshot.js layerView`: the sum of its
  buffs' `shieldHits`) — 泥岩's talent (client `mudrok_t_1`: the first layer's buff carries `mudrok_buff_03_start`, the
  middle ones `_02`, the last `_01`) shows `_03` / `_02` / `_01` for 1 / 2 / 3 layers and nothing at 0 — and each layer
  gained plays the binding's start one-shots again (`mudrok_buff_01_begin`, the `[recharge]` template's CreateEffect);
  an enemy keeps the whole stack while its barrier holds — 鼠王's and the 泥岩 boss's top variant until 'shieldBreak'
  [ASSUMED: our barrier is one amount, the client's three parts of `dynamic` each, `mousek_shield[a]`–`[c]` /
  `enemy_mdrock_s_2[shield_a]`–`[c]`, which switch the variant as each part breaks]. One effect key on
  one spot plays once whichever binding wants it (a mode switch from one copy to another keeps it running); a prefab
  that does not loop plays once while its binding is in force — so does a skill's held row of such a prefab (SkillFx:
  at the skill start, for its own life; a tier switch or a view built mid-battle does not replay it). Not drawn: what no
  client signal shows (template casts at
  events the client never sees, filter / range / profession checkers, a talent attack no kit fx marks, the buffs on
  others, `spineEffects`).
* **Placement (v2)**: `prefabs[key].spawn` / `follow` give a plan entry its `point` / `follow` without loading the
  descriptor (a charge slot without a `mountPointForProjectiles` point leaves from its loop's `follow`; a descriptor
  read with `opts.describe` still wins, and at play time the loaded descriptor places the effect as before; an effect
  played before its descriptor arrived — a loop started in the battle's first frames — is placed by its summary: on
  its `follow` point (a FollowMountPoint, from the first frame as below), else at its `spawn`, and takes up its
  rotation, direction and pause behaviours once loaded, round 46: it used to sit at the HitPoint for good);
  `mounts.js skinShift` — version 1's guess at a skin exported without its root transform — is off for a version 2
  index. Since DESIGN §32.14.36: a skin point with a `bone` is read where the unit's model draws that bone
  (`UnitView.boneOffset`: `UNIT.modelScale` from the feet, the facing applied; its `up` along the plane the camera sees
  face-on), for a shot, the strike's cast rows and a projectile's `onStart` as the attack clip poses it at its strike
  frame (its first OnAttack time) — `pos` only without a model or the bone [ASSUMED: the drawn frame; the static points
  keep the client's offsets]; an effect with a FollowMountPoint starts on its point and follows it, with its rotation
  unless `_keepOriginRotation`, and a MUZZLE_POINT or Special-point spawn takes the point's rotation (§33.11):
  `mounts.js mountRotation` = the Graphic rotation · the facing turn · the point's local rotation: the bone's angle
  when its BoneFollower follows the bone's rotation (`followRot`, §33.12 Skin; 0 without the drawn bone), else the
  point's own `rot`. 洛洛's SpecialPoint1 and 令's SpecialPoint2 keep their 30° about X, which cancels the Graphic's
  tilt: 洛洛's drone lies flat at home as the client draws it (turned by F_UVA_01's 90° it stood upright after the
  merge); 50 more points (10 more operators', 19 enemies', 2 tokens') keep the identity or a small turn about Z instead
  of their bone's angle, and 3 static points their 90° about Z. An index without `rot` / `followRot`: the bone's angle
  for every bone-followed point, no turn for the others, as before. A shot flies along the client's arc (§33.12
  Projectile; `render/vfx/flight.js`; its parts below). Since DESIGN §32.14.40: an effect its unit holds — a held one
  (`playOn` `follow`: a status loop, an aura, a skill's or a talent's loop) or a `_holdByOwner` prefab — without a
  FollowMountPoint moves with the unit, its offset from the feet as it started (a ground spawn on the ground); a hit or
  a ground range not held stays where it started, a FollowOwner one keeps to the feet only when held, as before
  [ASSUMED: §33.11 `_holdByOwner`; a status loop whose prefab says 0 — `common_stealth`, `buff_ fragile_01`,
  `common_invincible_01` — follows its unit all the same]. Since 0.3.1 (history §34.6): the prefab root's authored
  position is no part of an effect (`compileEffect`; kept as `rootPos`), and its rotation is the spawn location's
  (`mounts.js spawnRotation`, the effect's `rootRot`): the Graphic tilt for FOOT / HIT / HEAD (`graphicRotation`), none
  for MUZZLE_POINT_WITHOUT_ROTATION, NONE, the ground spawns and an effect on a point of the ground (a kit fx's tile, a
  projectile's target tile), the point's rotation (`mountRotation`, above) for MUZZLE_POINT and the Special points; a
  FollowMountPoint without `_keepOriginRotation` takes its point's, on FOOT the skeleton root's (the tilt and the facing
  turn), and with it keeps the spawn location's; a chained effect (OnPlayEmitter) takes its own spawn location's; an
  effect played before its descriptor arrived takes up its rotation once loaded, as above.
* **Projectile reached effects**: a skill projectile's `onReached` (else `onHit`) is what `skills.js FX_BINDINGS` plays
  where a kit's fx stands for that projectile (克莱门莎 S3's `projectile_chr_clemnt_s3`). A binding may name its own
  `keys` instead, played once `at: 'target'` on the unit the fx names (round 46: 泡泡 S2's 'counter' →
  `bubble_skill_02_hit` on the attacker, the client's `bubble_s_2` CreateEffect on MODIFIER_SOURCE at ON_TAKE_DAMAGE;
  the kit's fx carries `target`; another field with the binding's `target`: 0.3.1, audit R20 — 归溟幽灵鲨 S1's
  'hpShare' names the ally in `to`, and her ExchangeHp ability (AnimatedActionToTargetAbility, [uc]skills.ab) creates
  `ghost2_skill_01_start` on SOURCE and `ghost2_skill_01_hit` on TARGET). A key bound so is no row on the owner
  (`skills.js targetBound`, unmapped `bound`): index v3 writes an ability's `_actions` CreateEffect uses without their
  target, as start rows of the owner. The same cause stays open for 雪猎's talent (`snhunt_talent_01_hit` / `_02` on
  TARGET, at her skill start; the kit's 'strike' names the target) and 真言 S1 (a 自选 pick: `mantra_skill_01_hit_01`
  / `mantra_bounce_hit_01` on PROJECTILE_TRACETARGET, the shot's target): the extractor should write each action's
  `_targetType` (open).
* **`[eff_cond]` state loops** (round 46, history §32.14.42; `skills.js COND_BUFFS`, `condState`, plan `cond`;
  `skillfx.js _cond`): the buffs a skill's `[eff_cond]` template creates at its ON_BUFF_TRIGGER (every 0.1 s) show a
  condition's state, and index.json lists only their keys. For the templates whose client graph COND_BUFFS transcribes
  (卡涅利安's `billro_s_1/2/3[eff_cond]`, read from config/buff_template_holder.ab) the state's buffs loop on the owner:
  the skill on and cast with every charge stored (the kit's start fx says `charged`) → full + half sand armour; on →
  the half one (S3: its two halves); off with 2 charges stored → full + half; with 1 → the idle half (`_buff_01`); none
  below. The stored charges come from b.snap `charges` (sim `snapshot.js chargeView`, display only). Other
  `[eff_cond]` templates stay unmapped 'conditional'.
* **The procedural looks the official layer stands for** (round 46, the official-effects audit's R10 / R11; history
  §32.14.44). With 官方特效 on and the effects installed — never with the layer off or a lite install without them:
  - A skill whose official plan has no cast rows (no start, loop or range row, no attack cast / range row: 赫默 S2,
    巫恋 S2, 古米 S1, 银灰 S1, 塞雷娅 S1, 瑰盐 S1, 流星 S1 / S2, 华法琳 S2, 塑心 S3, 魔王 S2) shows no procedural
    activation burst or aura (`SkillFx.skill` → true): the client shows nothing at that cast. "Installed" is any
    prefab of the unit's plan, its skill's `effects`, its modes' rows, its `refs` or its `startEffect`. Since 0.3.1
    (history §34.1.6) the same holds for a passive skill's 0.5 s window at deploy (普罗旺斯 S1, 琳琅诗怀雅 S1):
    `SkillFx.skill`'s passive branch asks `_noBurst` too.
  - A kit fx that stands for an official effect the client plays there is bound to it (`FX_BINDINGS`, now with `keys`
    — prefabs no projectile record lists as reached —, `hold: 'fx'` — the fx's own `duration` / `dur` / `hold` —,
    `during` — only while the skill lasts — and owner `'skill'` for an fx that names no owner): the areas 锡人 S1 / S2,
    引星棘刺 S1 / S3, 波登可 S2, 歌蕾蒂娅 S3 (tornado) and 异客 S3 (storm) are their skill projectiles' reached
    effects at the fx's tile for the area's time (the projectile stays where it lands: AuraHitBehaviour); 异客 S3's
    strikes `pasngr_skill_03_hit`; 溯光星源 S2's links the link projectile's hit on each pulled enemy; 焰影苇草 S2's
    fire strikes `reed2_skill_02_hit`; 蕾缪安 S3's lock the aim projectile's crosshair (`lemuen_skill_03_crosshair_range`
    / `_02`, 1.5 s without a hold [ASSUMED])
    and her bombard the attack projectile's reached hit. Since 0.3.1 (history §34.5): 号角 S1's flare (the light
    projectile `projectile_chr_horn_s1_light`'s reached `horn_skill_01_hit_02_buff` / `_02`), and the 自选 pick 琴柳's
    flags — S2 `sleach_skill_02_flag_01` with its ground, S3 `sleach_skill_03_flag_01` with its range loops and its strike
    `sleach_skill_03_range_start_01` / `_02` (the flag model itself — a pole and a skinned cloth of the unported SimSpine
    shader, drawn through the basic fallback — does not show yet [open]).
    A binding at 'point' lies on the field's tile there (OfficialFx ctx.heightAt; before, its owner's height — 锡人's
    flask on the road at his high ground's 0.42), and a flight whose projectile a binding of the shooter's places
    leaves its reached effects to it (SkillFx.bindsReached; before, 锡人's flask also played at the target's HitPoint
    where the drawn flight ended, for up to LOOP_TTL).
  - A kit fx kind the skill's own official effects stand for is skipped while the skill lasts (`FX_COVER`: on, its
    activation frame, `COVER_AFTER_S` = 1 s after its end [ASSUMED], or a binding of the owner still held) when the
    skill's plan has an installed prefab: 莫斯提马 S2's zone, 白面鸮 S2's and 流明 S1's heal fields (his: the skill's
    buff on the patient, `lumen_skill_01_range`, plays with the heal), 凛御银灰 S2's blast, 远牙 S2's
    and 溯光星源 S3's links, 空弦 S1 / S2's, 流星 S2's and 雪猎 S2's volleys, 信仰搅拌机 S3's counters, 歌蕾蒂娅 S3's
    tornado pulls, 伺夜 S1's and 迷迭香 S3's summon pillars, 卡涅利安 S2's chains (once her loops are drawable); since 0.3.1
    浊心斯卡蒂 S3's tide (her Aura `_effects` loops), 银灰 S2's snow (his skill loop), the 自选 picks' 珊比 S3 belt
    (`thumpy_skill_03_range_01`) and 假日威龙陈 S2 / S3 slime (her attacks' `chen2_skill_0N_range_01` on their targets).
  - A summon's pillar ('summon' archetypes, not the floating units' kinds) in the frame its official birth effect was
    drawn (`FxWiring.deploy`'s key: its skill's own start effect — an AppearSkill's, 0.3.1 —, the mode's override,
    its own, the generic one) is skipped: 风丸 S2's 替身, 伺夜's
    wolves, 夕's and 维娜·维多利亚 S3's summons, 耀骑士临光 S3's sword; a token's arrival burst ('radiantSword',
    'summonStun', 'summonBurst', 'paperDoll', 'obelisk') only with its own birth effect.
  - Kept procedural (the client shows such a cue that is not placed here, or the fx is not the skill's): 引星棘刺 S2's
    drifting area, 新约能天使's air
    strikes (`angel2_skill_N_loop_*` on projectiles not flown), 蕾缪安 S3's falling shells, 扎罗's fear-cage beams (the
    client's `enemy_wlfmster_a_skill_end_buff` on the caged operators is not placed), 缇缇 S3's wake (the fx names no
    owner) and the talents' cues (刺玫's and 雪猎's strikes / counters, 风丸's 替身 burst); 泡泡 S2's counter is its
    binding above (audit R17). Areas kept so in 0.3.1 (history §34.5): 圣聆初雪's snow layers (`sbell2_ground_0N` per
    tile — no event carries the tiles' layers), the 自选 picks' 珊比 S2 glue (`thumpy_skill_02_trap_01` per glued tile —
    the fx gives their centre), 黍's farm tiles (`shu_talent_buff_01` per sown tile), 克莱门莎 S2's vortex (no prefab
    of its own found), 霍尔海雅 S3's and 斩业星熊 S2's moving areas (projectiles that fly or orbit), 集团军重型火炮's
    burning zone (its prefab is not in the extracted set — and it is no enemy of the four modes), 炎佑's flame (a lasso
    line to its target).
* **A projectile's parts** (2026-10-15, history §32.14.36 and §32.14.38; `flight.js projectileParts`, `wiring.js
  _fly`): the flying effect is the projectile class's own `_mainEffect` and its life that class's LIMITED `_lifeTime`,
  read from `behaviours` (an index written before the correction named a chain's or a rope's line `main` for 30
  projectiles); it flies from the shot's mount point (Placement above), its root's transform the flight's (0.3.1). A
  projectile whose movement has `comeBack` (§33.12 Projectile) plays its hit at the target and flies back to the
  thrower's HitPoint at the sim's return speed for the 回环射手's 'boomerang' (else `speed` ×
  `comeBackSpeedScale`), stepping that speed toward the HitPoint as it is now, a Paracurve one along an arc rebuilt
  when its inputs change, its effect removed at the catch; a thrower gone ends it at the
  hit. The client's `delayAfterReached` of 1 on the Paracurve / NarantS3 come-backs is a flag (`delayTime` 0.01 s, under
  one tick); the visual does not hang, so the drawn boomerang stays on the sim's catch
  (`wiring.js _comeBack` / `_turnBack` / `_stepBack`, 0.3.1, history §34.6: it stopped at the target, then a locked
  return duration rubber-banded a moving thrower). A harpoon's rope (a HarpoonRenderer's
  `_mainEffect`) runs from the shooter's point as it is drawn to the head while it flies — its LineRenderers' end
  points set by the runtime (`effect.js linkLines`; a world-space line without them draws nothing) — and fades once the
  head arrives; a chain's lightning (a ChainLightningEffectBehaviour's) is not flown — the client plays it between the
  chain's targets as the shot reaches them (§33.12 Projectile): the sim's 'chain' / 'chainHeal' bounces after an official
  shot of such a projectile draw the line from the previous target's HitPoint to the next one's and the projectile's
  `onHit` on the next, when the shot reaches its first target (`wiring.js chain`, round 46) [ASSUMED: every bounce at
  once — `_interval` 0 —, between HitPoints, the looping line shown 0.2 s, `CHAIN_LINE_S`]; a bounce of any other chain
  stays procedural. As the
  shot starts, `toTargetOnStart` plays on the target (FLIP_TWO_SIDE by the side the shot comes from, kept on the target
  while it lives) and `toTileOnStart` on the target's tile; a projectile without a flying effect holds its `onHit` for
  its life when that is longer than the sim's flight (up to 1.5 s, `TIMER_HIT_MAX`), the target's damage meanwhile
  drawing no procedural spark [ASSUMED: the sim's damage keeps its own time].
* **Hits against the sim's timing** (round 46, history §32.14.41; `wiring.js`): the sim moves a shot in its firing tick
  and lands it about a tick before the drawn flight (distance ÷ speed) ends, and heals at the 'atk': the HP 'dmg' or
  'heal' on a target with an official hit on its way is that hit's — in the attack's frame, or from 0.2 s before the
  drawn hit (`CLAIM_LEAD`) until 0.35 s after; one entry per target and frame, taken by the first frame's events
  (`_expect`) — so neither the procedural spark nor the generic heal hit plays ahead of the projectile's own hit; a
  damage earlier in the flight (a 灼燃 tick) stays procedural. A projectile attack's own hit rows play with its
  projectile's hit (none of the index's projectiles has both: 能天使 S2/S3, 录武官, 烛煌 S3, 2 more have only rows); a direct
  ranged attack — no projectile of its own: 能天使's normal attack, 协律, a 阵法术师's beam — is drawn by its official rows
  when it has any (no procedural tracer, orb or beam over them; its hit rows wait for its damage for the sim's flight plus
  0.35 s), else — or when its ability names a projectile the index lacks — by the procedural shot. An attack the sim makes melee whose official ability is a ranged one with a
  projectile (蒂比: RangedAttack, the sim's 天空行者 melee) flies that projectile for show at its own `movement.speed`, its
  damage covered until the hit [ASSUMED: display only; the enemies' attacks keep the melee path].
* **A skill's mode attach rows** (`skills.js attachUses`): the `attach` rows of the mode a skill switches to
  (AttachEffectOptions: attached with the mode) join the plan, held for the skill — `range` for a `*_range*` key, else
  `loop`; a row `onlyAttachOnDummy` (the client's preview dummy) is left out. The enemies' rows in their Default /
  combat modes are not played.
* **Sorting against the units**: a renderer that sorts before the units (§33.6: a lower sorting layer, or the Default
  layer with a negative order) draws in the pass under them (`effect.js behindUnits`), with those lying flat on the
  ground; skinned meshes read the influences per vertex their file stores (`geom.js skinStride`, §33.9).

Coverage of the roster (`tools/vfx-skill-coverage.mjs`, version 1 → version 2; version 3 below): operator (unit, skill)
pairs 547 → 548 of 549 in the index, 501 → 502 with a plan the battle view drives (91.4 %); summons 2 → 71 of 78, 2 → 23
drivable; enemies 0 → 123 of 126, 0 → 86 drivable (68.3 %); units with attack rows: operators 189 → 202 of 210, enemies
75 of 243 → 201 of 249 (version 2 lists the 6 aliases as units), summons 19 → 21 of 57. Of the 58 roster enemies with a
skill plan, 23 show the snapshot's SKILL window in a battle (a survey through the sim) and 11 of those have a single
skill — their windows open on this line; the others wait for the 'cast' event.

Index version 3 with the sim's 'cast' event (Phase 3d; `--sim` runs the enemy duels): of the 58 roster enemies with a
skill plan 46 open their skill windows in a 75 s duel against two operators and all 46 play official skill keys (11
before: single-skill enemies on the SKILL anim); the other 12 cast nothing there — 3 BornAnim skills and 2 enemies the
sim gives no skill use (赘生甲壳, the ally 炎佑), the rest need what a duel does not make (源石污染区 tiles, flying prey, a
knock-out, half HP, a push, other enemies in range). Talents and abilities (bindings in force; bound / all): operators
52 / 152 on 33 of the 122 units with talents (passive talents 17 / 81, abilities 31 / 47, deploy 1 / 2, toggles 1 / 4,
template-cast talents 2 / 10, attack talents 0 / 8), summons 28 / 37, enemies 181 / 262 on 125 of 249 (passive 84 / 122,
toggles 41 / 47, reborn 13 / 13, deploy 6 / 12, abilities 37 / 51); the others name no effect the client can place
(unmapped rows 76, no effects 51, targets only 31) or have no signal (a template trigger 21, a toggle 6, a talent attack
5).

### 33.17 Phase 1d: talents, common and general abilities, the abilities' projectiles, buff lives (index.json version 3)

`extract.py --only fx --fx-set used` with the Phase 1d extractor (Windows client 26-09-13, 8 processes on the
maintainer's Mac) exports what the units do outside their attacks and skills: every talent node, common ability,
general ability and trait of the roster's units (the chess operators, the 补位 / 自选 forms, the enemies, the summons)
that names an effect or fires a projectile — read with the skills' reader (§33.12: the same `uses`, roles, events,
carriers), so a runtime can feed them to the same planner — and what the data says about when they act. Where a field
below says *metadata*, the names come from the client's il2cpp metadata (§33).

**Talent** (`units[id].talents[key]`: one entry per prefab key — the name of a `Talents/<key>` node, wherever it sits:
under the root, `Others/Direction/Talents`, a mode, an attack; a node is a talent when it carries a Torappu.Battle.Talent
behaviour — `Talent`, `AppearTalent`, `RebornTalent`, `ProbReplaceNextAtkTalent`, … —; exported when one of its nodes
names an effect or a projectile):

```
Talent = { nodes: [TalentNode…],                      every node with that key (one key can have several: an ability
                                                       and its effects on two nodes, one copy per mode)
           bb?,                                        an enemy's: the key data/enemies.json talents.bb uses for it
                                                       (`Reborn.duration` → 'Reborn'; case as our data writes it)
           effects, projectiles, uses, roles, unclassified, abilities }   as a Skill's (§33.12; a use's `node` is the
                                                       node's path, `mode` the mode holding it when it sits in one)
TalentNode = { node (its path in the unit prefab), class (the Talent class), ability (the node's ability class),
               mode? (the mode holding the node), when, skills? (Talent._checkValidBySkillIndex: valid only with these
               skill indexes equipped), overwriteKey? (_overwriteTalentKey), reborn?, toggle?, triggers?, stops?,
               switchMode?, same? (the index of a node outside the modes with the same uses: a mode's copy is listed,
               its uses are not repeated) }
```

**Ability** (`units[id].abilities[]`: one entry per root node — the head's `_commonAbilities` and the abilities right
under a `CommonAbilities` node (`common`), the modes' `_generalAbilities` (`general`), the head's `_traitAbility`
(`trait`); a group's sub-abilities belong to its entry; exported when it names an effect or a projectile):

```
Ability = { kind ('common' | 'general' | 'trait'), name (its GameObject's name, e.g. 'kazema[switch2stand]'),
            alias? (its namedAsAlias when another), node, class (its ability class), modes? (a general ability: the
            modes listing it) | mode?, when, toggle?, triggers?, stops?, switchMode?,
            effects, projectiles, uses, roles, unclassified, abilities }
```

* **`when`** — what the classes say about the moment: `deploy` (AppearTalent, AppearSyncedTalent: cast as the unit
  appears — 16 talent nodes, e.g. 耀骑士临光's `nearl2_birth_01_start`), `reborn` (RebornTalent and its kin, and the
  ability that handles the 重生 — 15), `attack` (ProbReplaceNextAtkTalent / ProbAdditionNextAtkTalent: an attack the
  talent replaces or adds to, with the blackboard probability its `_probKey` names — 8), `toggle` (a ToggleablePassive*
  ability with a toggle checker: on while the checker's condition holds — 53 talent nodes, 5 abilities), `passive` (a
  passive or aura ability: attached for as long as its holder is — a talent from the deploy, one in a mode while that
  mode is on, a general ability while its mode is on — 297 talent nodes, 133 abilities), null (cast by something else:
  `triggers`, a reborn talent's handler, a sequence's step — 54 talent nodes, 37 abilities).
* **`triggers`** / **`stops`** — the buff template actions that cast (`TriggerAbility`, `TriggerAbilityMergeBB`,
  `TriggerAbilityUseSelector…`) or stop (`InterruptAbility`, `PauseAbility`) the node by its name or alias: `{ template,
  event (the Buff/Event that runs the action), action, name, buff? }`, from the templates the unit reaches (its prefab's
  and its skills' buffs, the buffs their templates create) or named after its code (`kazema_…`, `enemy_reid…`). A
  template whose TriggerAbility names no ability casts the one its buff's blackboard `ability_name` names (`buff`:
  that buff; *assumed* from the data — the generic templates `triggerability_tick_trigger`, `trigger_ability[onstart]`
  have an empty name, their buffs carry the key). E.g. 风丸's `kazema[switch2stand]`: `kazema_tr` at
  ON_BEFORE_TRY_SET_HP_ZERO (the fatal blow), `kazema[switch2normal]`: `kazema_standin[switch]` at ON_BUFF_FINISH;
  灵知's talent 2: `triggerability_tick_trigger` through the buff `gnosis_t_2`.
* **`switchMode`** — `[{ mode (the unit's mode name, or null), restore, event, buff }]`: the SwitchMode actions of the
  templates of the node's buffs (the mode read from the buff's blackboard `mode` when the action says so) — the form the
  ability puts the unit in (风丸's stand switch → `Stand`, 烛煌's `blaze2[to_default_state]` → `Default`).
* **`reborn`** (a reborn talent's node) — `{ mode (the mode it revives into, `_modeIndex`), maxCount, hpRatio, handler
  (the `_abilityName` of the ability that plays the 重生, `_useAbilityToHandle`), handlerNode (that ability's node) }`;
  the handler's emitter rows run from the 重生's start (ON_CAST_START) to its end (ON_CAST_END), the talent's `_buffs`
  (the 无敌 loop, `life.key` `invincible` — data/enemies.json `Reborn.invincible`) after it, its `_effects` at the start.
  E.g. “复仇者” (`enemy_1539_reid`): handler `Revive`, `enemy_reid_revive_01` looping until `enemy_reid_revive_02`, then
  mode `Reborn`.
* **`toggle`** — the node's toggle checkers with their settings: `HpRatioToggleChecker` (`minHpRatio`, `maxHpRatio`: on
  while the HP ratio lies between — “复仇者”'s AtkUp at ≤ 0.5), `AdvancedCompoundToggleChecker` (`disableWhenBlocked`,
  `restoreDelay`, …: the enemies' 隐匿, `common_invisible`, off while blocked and 3 s after), `BlockedToggleChecker`,
  `RangeTileToggleChecker`, `FilterBuffToggleChecker`.

**Our data's talent ids.** `units[id].talentKeys` (operators and summons) = `{ base: { talent index: [prefab keys] },
trait?: [prefab keys], modules?: { uniEquipId: { talent index: [prefab keys] } } }`: data/chess.json / data/tokens.json
`talents[].index` is the index into the official character_table's talents, whose candidates name their node
(`prefabKey`: `1`, `2`, but also `-1`, `1+`, `t1`, `#`, …); the trait's candidates (always on: 风丸's trait talent is
`-1`); a module's talents (our `fromModule` talents: index −1 for one it adds, e.g. 灵知's `uniequip_003_gnosis` →
`10`). So a unit's active talents are the keys of its record's talents (`fromModule` → `modules[record.module.id]`, else
`base`) and of its trait. An enemy's talents are all on; `bb` links them to its record's blackboard.

**`units[id].spineEffects`** — a SpineEffectEmitter's presets (on the unit's Graphic: `扎罗，“狼之主”`'s two skill
loops), Emit rows with `node`, `preset` (the index a Spine event names — *assumed* from the class; the events are in the
skeleton, not the prefab) and `createAtWorldPos`.

**Which projectile an ability fires.** `skills[id].abilities` lists every attack ability of the skill prefab — `{ node,
class, animKey, attackType, damageType, projectileKey, extraProjectileKeys, projectileDestination, mount, mountGroup?,
additionalTimes?, triggerDelta?, additionalProjectile(s)?, select? }` — and every other behaviour that fires a
projectile of its own (`SimpleProjectileEmitter`: 赤刃明霄陈 S3, `ChantWithProjectileBeforeSkill`: 予愿安洁莉娜 S2, as
`{ node, class, projectileKey }`); an emitter use of a projectile-firing ability carries its `projectileKey` (and
`extraProjectileKeys`). Talents and abilities have the same `abilities`; the mode attacks and their sub-abilities gain
`mount` (the MountPointType name of `_mountPointType`: where the shot leaves), `mountGroup` (`{ loop, mounts }`: points
taken in turn — *metadata* MountPointGroup.LoopType RANDOM / LOOP), `additionalTimes` / `triggerDelta` (a multi attack's
hits after the first and their spacing) and `additionalProjectile(s)` (the projectile of those shots: 阿's S2 and S3).

**Buff lives.** Every use a buff carries has `life` = `{ type, time?, key?, db?, tick? }`: `type` *metadata*
Torappu.LifeType of the BuffData's `lifeTimeType` (the templates' own Odin data write the same field by name):
IMMEDIATELY (applied and gone — its effect plays once), LIMITED (for a time: `time` = `lifeTime` s when set, else the
blackboard `key` (`durationKey`) — our data's records carry the values, e.g. `duration`; a LIMITED buff with neither
lasts what its ability gives it, *assumed*: the skill), INFINITY (until removed: its ability ends, the target leaves the
aura, the skill ends), CUSTOM; `db` = `loadFromDB` (the client's buff table may replace these; 2 uses); `tick` =
`triggerInterval` (the period of its ON_BUFF_TRIGGER actions — the ticks no client event reports). The templates have
no life of their own (Torappu.Battle.BuffTemplate: `templateKey`, `effectKey`, `eventToActions`, `onEventPriority`).

**Group choice.** `select` on a group ability (mode attacks, sub-abilities, skills' and talents' abilities): `{ method,
probKeys?, diffFromLast?, allAtLeastOnce?, loop?, main?, burst? }` — `random` / `loop` (*metadata*
AbilityRandomGroup.SelectMethod Random / Loop; `probKeys`: the blackboard keys of the weights when configurable),
`trigger` (AbilitySelectableGroup, BurstAttackGroup: the first config whose own trigger finds its target; `sequential`
with `_selectAbilitySequentially`), `firstSucceed`, `parallel` (`main`: the index of `_mainAbility`), `sequence`
(`loop`: it starts over); `burst`: the index of a BurstAttackGroup's burst attack. The MultiHit groups need no new
field: their choice flags were exported (§33.12) and the base rule (hit k plays group min(k, last)) is engine code no
data shows — still **assumed**; `additionalTimes` + 1 is the hits of the attack, against `groups` the groups.

**Numbers** (the full set): 4,518 effect prefabs (+207: the effects the talents' and abilities' buff templates name;
none dropped), 3,388 textures (+65), 1,233 meshes (+19): 12,489 files, 193.5 MB (+5.4 MB); `index.json` 6.7 MB
(0.40 MB gzipped; 6.0 / 0.34 in version 2), the file list 9,141 entries, 1.22 MB. The run takes 158 s (units, skills
and buff templates 48 s). Talents of 268 units (105 operators, 140 enemies, 23 summons): 337 keys, 443 nodes, 575 uses;
abilities of 119 units: 59 common, 111 general, 5 traits, 291 uses; 57 nodes cast by a template action (5 through a
blackboard name), 57 with a mode switch, 11 reborn talents (6 with their handler node); `talentKeys` for 210 operators
and 45 summons (125 of the operators' 126 exported talent keys and all 24 of the summons' are named there; 夕's `2+`
is not); `bb` on 150 of the enemies' 187 talents (the rest have no blackboard in our data). Of Phase 1c's 47 nodes
outside the index (§33.15) 42 are exported; the other 5 are `Combat` attacks no mode references (妖怪, 御4, 寒霜:
their mode's `_combat` is `EmptyCombat`; 守墓石像's `Stone` mode has none). Skills: 210 of the 596 list `abilities`
(104 entries fire a projectile); of the 85 skills with projectiles 76 name all of them through an ability, 9 do not
(伊内丝 S3, 魔王 S1–S3, 仇白 S1, 菲亚梅塔 S2, 老鲤 S2, 维什戴尔 S1, 克莱门莎 S3: a buff's blackboard or a template's
EmitProjectile action names them); 109 uses carry a `projectileKey`. Mode attacks: `select` on 76 groups, `mount` on
458 abilities, `additionalTimes` on 74, 16 UberAnimation emitters (LOOP 6, RANDOM 10). Buff uses with a `life`: 713 of
the operators' and summons' skills (LIMITED 407 — 268 with a blackboard key, 4 with a time —, INFINITY 286, IMMEDIATELY
20), 485 of the talents, 252 of the abilities, 71 of the enemies' skills.

**What the runtime does not read yet, and the signals it has** (§33.16 reads skills only; `render/vfx/skills.js` is
the runtime's; the sim's client events are docs/SIM.md §9's): `talents` / `abilities` can go through the skill planner
(their `uses` have the skills' shape), bound per node by `when`: `deploy` → `['deploy', id]` (and a unit's `['spawn',
…]`); `passive` → from the spawn / deploy to `['die', …]` / `['leak', id]` / the battle's end (a general ability only
while its mode is on: the skill's mode, `skills[id].mode`, between `['skill', id, 1]` and `0`, or a form); `reborn` →
an enemy's 重生 (`content/enemies/archetypes.js reborn()`): the knock-out's `['fx', 'telegraph', …, { id, form: 'reborn',
dur, kind: 'reborn' }]` starts the handler's ON_CAST_START rows, the stand-up's `['fx', 'revive', …, { id, form:
'form2' }]` its ON_CAST_END rows and the talent's buffs (the 无敌 loop for `life.key`'s blackboard value), and the
attacks of `reborn.mode`; `toggle` → the snapshot (HP ratio for HpRatioToggleChecker, UF.blocked for the blocked
checkers, UF.stealth and `['status', id, 'stealth', 1 | 0]` for the 隐匿 one); `switchMode` / a mode's general
abilities → the form tuples (`shared/protocol.js fxForm`: the sim's form names — a 傀儡师's `doll` on `['fx',
'substitute']`, `null` on `swap` / `dollEnd`, the enemies' setForm forms — need a map to the client's mode names: 风丸's
`doll` is `Stand`); `triggers` at ON_BEFORE_TRY_SET_HP_ZERO → the kits' `['fx', 'undying', …]` / `substitute`,
ON_BUFF_FINISH of a stand-in buff → `swap` / `dollEnd`; `attack` → no event names the talent's attack (unmapped, or a
kit's fx); `tick` and the other buff events, a template's casts at events the client never sees, `spineEffects`: no
signal. The attacks: `select` / `abilities` order for a group's sub-ability (still the client's pick per cast),
`mount` for where a shot leaves, `additionalProjectile` for the follow-up shots; skills: `abilities[].projectileKey` /
a use's `projectileKey` replaces `skillProjectile`'s naming rule; `life` replaces `buffDuration(srec)`'s guess for the
buffs on targets (`key` → our record's blackboard, `time`, INFINITY → while the skill or aura lasts, IMMEDIATELY → once).

**Still assumed, or not exported.** Which sub-ability a group picks for a given cast and which hit group a MultiHit hit
plays (engine code; the data's flags are exported); the unnamed TriggerAbility reading the blackboard `ability_name`;
a LIMITED buff without a key or time lasting its ability; a SpineEffectEmitter preset per Spine event; the projectiles a
buff's blackboard (`next_projectile_key`, `projectile`) or a template's EmitProjectile action names (9 skills above) —
in `projectiles`, not tied to an ability; the 5 unreferenced `Combat` nodes; template-created buffs' lives (their
CreateBuff data is not read for `life`); talents and abilities whose nodes name no effect (stat buffs, card plugins:
nothing to draw).

### 33.18 The 驭械术士's floating units (0.3.0, round 46)

The floating units (浮游单元) of the 驭械术士 branch (subProfessionId `funnel`: 荒芜拉普兰德, 洛洛, 至简, 耶拉 and the 自选 澄闪 in
the mode's pool) are no unit of their own — no token, and no image of the operator's Spine model draws them (洛洛's
skeleton has her drone only in its `Skill_Begin` clip, as she launches it). Each is an effect prefab that an ability of
the operator's prefab (`charpack/<id>.ab`) shows at a Special point of her skin, and what it does to an enemy is a
projectile of `[uc]projectiles.ab` (round 46: the four operators' prefabs, their skills and projectiles dumped with
UnityPy). index.json version 3 carries all of it; nothing was added to the format, and the full set (§33.14) holds every
prefab (98 keys for the four, 5.4 MB of their textures).

* **Mode attacks with units.** A mode attack of class MultiFunnelsNormalAttack or MultiFunnelRemoteAttack lists its
  units in `attack.abilities` (its `_funnelActions`, v2; `_useExtraActiveCntAbility`: a talent or a skill's passive adds
  active units). Each unit's node carries a FunnelEffectEmitter (`emitters[]`, v3): `idleEffect` — the loop while the
  unit is home —, `idleBackEffect` with `useIdleBackEffect` (the owner facing back), `overloadIdleEffect` with
  `useOverloadEffect` (洛洛 S2's overload), `appearEffect` / `disappearEffect` (as it comes back / leaves),
  `setActiveFalseWhenPause`. The unit's `projectileKey` is its attack: AttachToTarget (the target's HitPoint;
  `_delayTime` s after reaching it with `_delayAfterReached` — 荒芜拉普兰德's normal attack 0.5 s —; `_immediatelyReach`,
  `_followTarget`) playing an EffectBehaviour hit (`onHit`) or a SequenceEffectBehaviour's `_effectGroups` (one group
  per hit, in turn; `_overloadGroups` with `_enableOverloadEffect`). The hit prefabs carry the unit itself: a wolf that
  lunges through the target in 0.17 s and fades by 0.83 s (`whitw2_token_hit_0X`), a drone or token that appears beside
  the target, fires and is gone after 0.5–0.6 s (`rockr_token_skill_02_hit_L_01` / `_R_01`, `kjera_token_skill_02_hit_F_L_01`;
  their FunnelHitEffect moves them by up to ±0.2 × ±0.05).
* **The funnel shot.** A general ability of class MultiFunnelNormalAttack (`abilities[]`, kind `general`, its `modes`;
  a buff template triggers it at the owner's ON_ABILITY_CAST_ON_TARGET) is the unit's shot with the operator's own
  normal attack: its sub-ability's `projectileKey` flies from its `mount` (the unit's Special point), with its cast rows
  (`uses` from `_castEffects`: 耶拉's `kjera_token_attack_start_01` on her token). The unit's look in those modes is the
  PassiveBuffAbility general ability of the same modes (`Effect`), a prefab that follows a mount point
  (`prefabs[key].follow`). A skill's own MultiFunnelNormalAttack (`skills[id].abilities[]`) replaces it for the skill's
  attacks (至简 S2's `Funnel_s2` at SPECIAL_2).
* **Dispersed units.** 荒芜拉普兰德 S3's general ability `WolvesDispersed` (Whitw2Skill3FunnelRangedAttack; its sub-abilities fire
  nothing of their own) lists the units in `projectiles`: the flights `projectile_chr_whitw2_funnel_s3_1…4` — `main` the
  flying wolf (`whitw2_skill_03_token_trail_01`), a GroupedMovement of HoveringInPlaceMovement (radius 1.25, speed 1),
  AttachToTarget (`_followTarget`), an AdvancedMovement chase (2 → 4 at 1 per s) and an AdvancedMovement spread (away
  from the source, 0.1 → 2 at 1.9 per s) switched by MovementSwitchControllerForWhitw2 (its trace-target buff's override
  effect `whitw2_skill_03_mark_01` over the chased enemy; the reappearance square ±0.75) — and their `_attach`
  projectiles (the hits while latched, SequenceEffect `whitw2_token_hit_0X`; the extra buff's override effect
  `whitw2_skill_03_mark_02` on the latched enemy); its BuffToOwner use `whitw2_skill_03_buff_start` (LIMITED, 3 s).
* **Where they float.** The idle prefabs follow SPECIAL_0 / _1 / _2 (their FollowMountPoint, `prefabs[key].follow`), and
  the skin's point names its bone (`skins[…].points.SpecialPointN.front` / `.back` `.bone`): 荒芜拉普兰德
  F_Funnel_Muzzle_1–3, 洛洛 F_UVA_01, 至简 F_Fly, 耶拉 F_Rock_1 / F_Rock_2, 澄闪 F_DroneA. A skin's point is its bone in the
  prefab's edit-time pose (§33.12 Skin; for these points the Idle clip's first frame, to within the idle bob): x = the
  bone's x × 0.0027, the height in the Graphic plane the same scale about the skeleton's origin (0.157 under the root),
  the plane turned −30° about x (the four chess operators' skins against their Spine models). The client's
  BoneFollower moves the point with the clips: 洛洛's, 至简's and 耶拉's units bob with the Idle clip, 荒芜拉普兰德's
  wolves stay put in Idle and move in `Skill_1_Loop`.

| operator | at home | with her normal attack | skills |
|---|---|---|---|
| 荒芜拉普兰德 `char_1038_whitw2` | Default / S1: `whitw2_token_01`–`_03` (1, + S1's passive 浮游单元+1, + the 头狼 talent's third stage) at SPECIAL_0 / _1 / _2 | her shot `projectile_chr_whitw2`; each unit: `whitw2_token_end_0X`, the lunge `whitw2_token_hit_0X` on the target, back with `whitw2_token_end_0X` | S1 (toggle): the same units, AttachToTarget at once and following the target; S2: `S2Funnel1`–`6` with no emitter (nothing at home), one per lock, `whitw2_token_hit_0X` every attack; S3: the dispersed wolves |
| 洛洛 `char_4040_rockr` | Default: `rockr_token_01` at SPECIAL_1 | her shot; the drone's `projectile_chr_rockr_funnel` (`rockr_token_trail_01`, hit `rockr_token_hit_01`) from SPECIAL_1 | S2: one unit (idle `rockr_token_01`, `rockr_token_show_01` / `hide_01`, overload `rockr_token_overload_01`) beside the target, left then right (`rockr_token_skill_02_hit_L_01` / `_R_01`; overload `_L_overload_01` / `_R_overload_02`) |
| 至简 `char_4054_malist` | Default: `malist_drone` at SPECIAL_0 | her shot; `projectile_chr_malist_funnel` (`malist_drone_trail`) from SPECIAL_0 | S2 (a ReplacementSkillFixed, no mode switch): `projectile_chr_malist_funnel_2` from SPECIAL_2 |
| 耶拉 `char_4013_kjera` | Default: `kjera_token_default` (back `kjera_token_B_01`) at SPECIAL_0 | her shot; `kjera_token_attack_start_01` on the token and `projectile_chr_kjera_funnel` (`kjera_token_attack_trail_01`, hit `kjera_token_hit_01`) from SPECIAL_0 | S2: two units (idle `kjera_token_F_01` / `_F_02` at SPECIAL_0 / _1, back `_B_01` / `_B_02`, `show_01` / `_02`, `hide_01` / `_02`): `kjera_token_skill_02_hit_F_L_01` / `_02` and `_F_R_01` / `_02` |
| 澄闪 `char_377_gdglow` (自选) | Default: `gdglow_token_01` at SPECIAL_1 | `projectile_chr_gdglow_funnel` (`gdglow_token_attack_trail_01`) from SPECIAL_1 | S1 / S2: two units, S3 three (idle `gdglow_token_skill_0X`, `gdglow_token_hide_0X` both ways): `gdglow_token_hit_L_01` / `_L_02` / `_R_01` / `_R_02` in turn |

**The runtime** (`render/vfx/funnels.js` plans a unit, `render/vfx/funnelfx.js` plays it — owned by the wiring like
SkillFx and TalentFx —, the wiring follows the bone as it follows every FollowMountPoint: §33.16 Placement; DESIGN §9
"Official battle effects"; client only):

* **Home.** The loops of the units that are home follow their prefab's point — its FollowMountPoint, with the point's
  rotation — where the unit's model draws the point's bone (§33.16 Placement: `UnitView.boneOffset`, the facing applied,
  up the plane the camera faces; no model or bone: the skin's point). In a mode whose attack holds units, the first n
  with an idle loop: with the skill on, the units it releases (the kit's 'drones' count, else 1 + the skill record's
  blackboard `attack@cnt`); else the units one attack showed (the hits after the body hit), before any attack 1 + a
  passive "浮游单元+N" of the equipped skill's text; the back loop for a unit facing back (the snapshot's Back model),
  the overload loop after the kit's 'overload'. In the modes of a funnel shot, the passive ability's loop — TalentFx
  leaves those bindings to FunnelFx (`funnelfx.js owns`). One key on one point plays once, so a mode switch to the same
  loop (洛洛's Default → S2, 荒芜拉普兰德's Default → S1) keeps it running; a unit shown where none of its own floated
  (a skill's added unit, the units back from a hunt) plays its `appearEffect`.
* **Attached units (the owner's 'atk').** 荒芜拉普兰德's Default, S1 and S2 (the sim deals the units' hits with her attack):
  the k-th HP 'dmg' on the target after the body hit is unit k's (a 'dmg' names no source: those of her damage type in
  the tick of the first — her data record's arts, any HP hit when a record names none; the sim deals them in one call;
  and so is the count from then on); several targets of
  one attack (S2's locks; one enemy can hold several) are one unit each; each plays its hit group on its target and is
  home again 0.85 s later (`appearEffect`). A normal attack's units (MultiFunnelsNormalAttack) leave home with the attack
  (`disappearEffect`, the loop gone at once — `setActiveFalseWhenPause`), a skill mode's with their own hit. The body
  shot flies at the attack's first target only. A mode whose units a kit's 'drone' fx shows to hit on their own (洛洛 S2,
  耶拉 S2) takes the owner's attacks for her own shot only.
* **The funnel shot** flies its projectile from its mount in the sim's flight time with its hit on arrival; its
  ON_CAST_START casts start with the owner's wind-up (`castStart`), at the strike without one.
* **Remote units (the kit's 'drone').** 洛洛 S2, 耶拉 S2 and 澄闪's skills (the sim's drones hit on their own clock, one
  'drone' fx per hit at the lock): the k-th of the owner's fx in a frame is unit k; it leaves home at its first hit and
  plays its hit groups in turn on the enemy there (the nearest within 0.6 tiles; the prefab follows its HitPoint and
  the FunnelHitEffect offset), the previous hit stopping; units in step with the same groups (澄闪's) start one group
  apart; it comes back 2 s after its last hit or at the skill's end (`appearEffect` where the mode then shows a unit on
  that point).
* **Dispersed units.** 'drones' releases n flights from her, evenly spread with one along her facing — the kit's speeds
  (the client's spread and chase above) for `attack@times` s —; 'droneLock' sends the free flight nearest to the named
  enemy after it (the trace mark over it); it latches on reaching it (the latched mark) and lunges at each 'drone' at
  that enemy (a chasing flight there latches at once); a lost target puts it at a seeded point of the ±0.75 square
  around the spot until its next lock, circling after 0.25 s (the kit's 0.9 radius, 1 tile per s); a 'drone' elsewhere
  (a free unit's place, once a second) pulls the nearest free flight halfway there; the skill's end stops them and the
  home units come back. A view that saw no 'drones' (built mid-skill, a late fx dropped) releases 1 + `attack@cnt` after
  0.4 s; her `whitw2_skill_03_buff_start` plays with the release.
* **The kit fx they stand for** are not drawn procedurally: 'drone' / 'drones' (the light pillar), 'droneLock' (the
  reticle) and 'overload' (the chevrons) of a funnel unit return true from `FxWiring.simFx` when its effects are there.
  Without the layer (设置「官方特效」 关, the 2D board, no extracted effects — a lite install) or without the unit's
  prefabs, the field view keeps its procedural look, the pillar included.

**Assumed** (the client's choices are engine code): the hits at the sim's damage moment (AttachToTarget's delay not
added), 0.85 s before an attached unit is home again and 2 s before a remote one comes back, the appear / disappear
moments at a skill's start and end, the initial count from the skill's text, the flights' height (0.3 over the ground),
the S3 pulse correction, the hover radius (the sim kit's 0.9; the client's HoveringInPlaceMovement says 1.25), the
groups one apart; the units on their bones as the remake's model draws them, with their point's rotation (§33.16
Placement: 荒芜拉普兰德's wolves face forward on the bones' 87°; 洛洛's drone keeps its point's own 30° about X — its
BoneFollower does not follow F_UVA_01's rotation — and lies flat). Not drawn: 澄闪's self-destruct (`projectile_chr_gdglow_funnel_s12_3` … — the kit's 'explode' keeps the
procedural blast), a unit hidden while its owner is stunned (`setActiveFalseWhenPause`: no signal ties a unit's pause
to a status).


### Reported effects after 0.3.0 (§34.31, 2026-10-17)

- **Wild Mane S2:** `CastEffectOptions.useFourDirectionalFace` selects the owner's deploy-direction vector for
  FOUR_DIRECTION / ANY_DIR casts, independently of `directionType` (which selects a key slot). The unit's S2 cast
  uses `wildmn_skill_02_start`, `directionType=0`, `useFourDirectionalFace=1`; its hit has both directional flags off.
  The cast's ParticleEffect is FOUR_DIRECTION, GROUND_CENTER, mainDir RIGHT, with a rotation-Z helper authored at
  90°. `ParticleEffect.FaceTo` replaces that helper rotation; it does not add another quarter-turn or left mirror.
  The yellow/white `congci_add` / `congci_cl` quads have positive X pivots: §33.6's positive pivot displacement is
  required (0.3.0 subtracted it, putting the streak behind the owner; the shared fix is already in §34.6).
- **Yu S3:** `yuwall.js` interprets the installed source/root controllers. `YuS3EffectBehaviour.OnPlay` creates
  `yu_skill3_range_01_root` per tile across the owner's row for UP/DOWN, column for LEFT/RIGHT.
  `YuS3EffectWithEdgeBehaviour` offsets visible pieces by `_offset` (officially 0.4) along the facing direction;
  horizontal pieces use `_effectWhenHorizontal`, vertical pieces use the left/right variant according to world X
  relative to the battle camera. Adjacent invalid tiles receive the matching horizontal or vertical end caps
  (first check 0.05 s, subsequent checks 2 s). No stretching one prefab over the whole board.
  The source is EmptyEffect; `FinishEffectViaOwnerBuff` holds it for `yu_s_3[effect]`, so it is a skill-held composite,
  including pending loads. Official `skill_table.skchr_yu_3.levels[*].duration` is 45 s. Skill off, owner death/removal
  and battle reset stop all children. [ASSUMED] The remake's active field rectangle is the official controller's
  valid map; the segments are drawn unclipped, the caps on the invalid tiles just past each end, as the maintainer's
  official recording shows the whole crimson curtain (a world-space clip tried first left flat slivers, because some
  vertex paths pass local positions as `v_wpos`). The procedural 2D/off fallback holds the same offset footprint until skill end;
  its 0.16-tile ground-strip width and colour are [ASSUMED] presentation. `firewallBlock` places `yu_skill3_annex_01`
  once at the eliminated bullet. `yu_skill3_annex_02` requires the ally buff's ON_TAKE_DAMAGE trigger: our sim
  emits no matching event, so it remains unmapped and is never guessed from unrelated damage.
- **Manifold:** official `token_10030_mlyss_wtrman` mode animation replacement pairs select A_Idle/A_Attack/A_Combat
  for Melee and Melee_S3, B_Idle/B_Attack/B_Combat for Range. `UnitView` applies those roles in 2D and 3D and keeps
  them through skill toggles/model loads; its form also selects the index's mode attack/combat effects. The existing
  `copy {id,src}` event supplies the copied operator's position. [ASSUMED] If that cosmetic event was missed, or a split
  clone has none, `atk` reconstructs Melee from `none`, Range from its projectile kind (the current sim's copyInto
  contract); no change animation is replayed over an attack. This does not invent a recovery/c0 transition or a
  summoner link. The sim exposes no token-owner skill window for `c2_skill_03_buff_01`; it remains conditional.

Sources: local official v3 index/prefabs; `pkgrps/btl_pfb_tokens_0.ab` mode `_replaceAnimPairs` and
`SwitchToMelee/Range`; `skill_table.json` (`skchr_wildmn_2`, `skchr_yu_3`, `skchr_mlyss_3`); official client
`CastEffectOptions.CreateEffect`, `ParticleEffect.FaceTo`, `YuS3EffectBehaviour.OnPlay` and
`YuS3EffectWithEdgeBehaviour` (addresses and replay evidence in history §34.31). No sim rules change.
