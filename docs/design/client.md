# DESIGN §9, §10, §13, §15 — Rendering, UI, local-client art, the 3D board

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 9. Client rendering contract (public/js/render)

**Operator skins (§34.23, [SKINS.md](../SKINS.md)).** [ASSUMED] Retain received skin IDs separately from displayed
skins so the other-player switch restores loaded units when re-enabled, including boss prep partners. Any-phase
`room.skins` refreshes owner/private and existing scout views; public seat choices update current battle rendering
without restarting playback or changing the sim / BattleSpec. Resolve every surface's skin from the effective
operator body (official `activity_table` `charShopChessDatas.backupCharId` for stand-ins, the pick for DIY slots).
Outfits following that body and live refresh timing are cosmetic UI assumptions; gameplay and golden results stay unchanged.

**Studio test console (0.3.1).**

The maintainer's standalone battle sandbox is `/studio/console.html` (history §34.8; format and limits in
[PLUGINS.md](../PLUGINS.md#test-console)). Its options/build API uses the existing local-network studio gate and key.
The server validates and builds a vanilla BattleSpec using match wave/placement helpers; the browser's real sim and
field view run it without rooms or result submissions. Editing resets to tick zero, runs start paused, stepping is
one or thirty fixed ticks, speed is 0.25×–8×, and a hidden tab pauses. JSON saves the setup and seed; the last valid
setup persists in this browser. Official/prep effects outside that single battle are named as unsupported.
A full match is a separate host test room (history §34.8): the sandbox does not open one and does not send `g.test`.
The lobby only offers creation when `welcome.testMode` is true. Joining/watching requires a test acknowledgement;
recent room chips, room/briefing headers, HUD/watch views and settlement keep the test mark. The host dock sends
validated commands and renders the public audit tail. Test results and quits never enter local history, awards,
statistics or badges; the live marker latches until the match is cleared.

`createFieldView(host, { …, playbackTime: () => gameSeconds })` optionally drives visual animation time from the
caller's simulation clock, allowing exact pauses/steps in the console. Ordinary views omit it and retain their
wall-clock/interpolation timing. Official effects still follow the snapshot clock; the console observes only its
own renderer's loaded instances/procedural calls. These diagnostic counts depend on assets and rendering, never
participate in simulation results, and are distinct from damage/heal totals. Match test commands are not part of this page.

Bond-layer audio (#482): live own preparation gains arrive as `m.layer`; the displayed battle's `layer` tuples
play the same `bondUp` cue. A gain of several layers plays once, including gains to inactive bonds. The official
`ON_ACT1AUTOCHESS_ADD_BOND` bank allows one sound and replaces the oldest; there is no added cooldown. Existing
bond activation cues use this same channel. State snapshots, settlement backfill and buffered field-entry events
do not generate layer cues. Field entry, leaving the game and muting cancel playing or still-decoding layer audio.

`import { createFieldView } from './render/app.js'`

```js
const view = await createFieldView(canvasHost /* HTMLElement */, { data, assets, audio })
view.setStage(stage)                         // draw tiles (procedural), devices
view.setCamera(kind /* 'prep'|'normal'|'unite'|'boss' */, { rect, side, shop, ms })  // animates camera; shop: false = the
                                             //   folded shop's prep camera (official shop-collapsed framing, §21.27);
                                             //   ms overrides the flight duration — the shop fold / unfold zoom takes
                                             //   the short FOLD_CAMERA_MS (render/app/tune.js, GitHub #602).
                                             //   设置「部署时收起商店」 (prepDeployFold, default on) is that zoom;
                                             //   off, a pickup changes neither the shop fold nor the camera (§34.3).
                                             //   Opening 敌方情报 during a held drag leaves that one-shot restore owed
                                             //   until the pen closes [ASSUMED] (§34.3).
                                             //   'pen' pans to the enemy preview pen in 0.25 s (see below)
view.setPrep(privateState, { editable })     // render hand/temp/board pieces as chibis (spine or fallback); editable enables drag;
                                             //   a merge's new elite on the board plays fx.promote instead of fx.deploy (render/promote.js, §20.11),
                                             //   also after a battle (a merge between two preps: the last prep state is kept, §20.14);
                                             //   an operator new on the bench, a merge's elite and a piece put on another board tile land (§31.8)
view.replayDeploys(uids)                     // the round start: the own board's pieces land one after another, 50 ms apart (§31.8)
view.enterBattle(fieldMeta)                  // switch to battle rendering for m.field
view.pushSnapshot(snap) ; view.pushEvents(ev)   // interpolated rendering (100 ms buffer)
view.highlightTiles(tiles, style)            // legal/illegal placement, range preview
view.on('pieceDragStart'|'pieceDrop'|'pieceDragEnd'|'pieceClick'|'pieceHover'|'tileHover', fn)
   // pieceDrop: { uid, target: {area:'board',row,col}|{area:'hand',idx}|{area:'outside', clientX, clientY} }
   // area 'outside' lets the DOM UI decide: released off the grid or over DOM covering the canvas (the shop bar), mouse
   //   and touch alike — there is no drag-to-sell, the piece goes back
   // the drop target, its highlight and tileHover while dragging = the tile under the POINTER; an item dropped on a
   //   tile equips the unit standing on it (§18.1); a dragged unit is drawn standing on that tile while it is a legal
   //   target — a board tile or a bench slot (render/drag.js dragStandTile), the official deploy drag — and held under
   //   the pointer elsewhere (DRAG_HOLD_TILES), an item plate on the pointer (§27.62)
view.pieceScreenRect(uid)                    // the drawn body's rect { left, top, right, bottom, width, height, x, y } (tooltips / overlays)
view.tileScreen(row, col)                    // { x, y, s, poly } client px of a tile top (direction wheel geometry)
view.holdPiece(uid, {row,col}|null)          // keep a dropped piece on a tile while its direction is chosen
view.setPieceDir(uid, dir)                   // show a prep piece facing UP|RIGHT|DOWN|LEFT (wheel preview / stored dir)
view.resize() ; view.destroy()
```

`createFieldView(host, { …, signal })` takes an `AbortSignal` (0.2.2, GitHub PR #302 by @siruimei07): an abort during the build — the Pixi load, the manifest, the fonts, the board art and the 3D board waits — destroys what the attempt made (the canvas, the ticker, the listeners, the observers) and rejects, a failure while it is built releases the same partial resources, and `view.destroy()` is idempotent. `ui/fieldHost.js mountFieldView(host, { signal })` aborts that signal when the engine fails, times out (12 s) or the owner unmounts, disposes a view a factory returns after that, and never clears the other children of `host` — the simplified view and a newer mount share it.

Asset URLs (0.2.6, host bandwidth layer 1): the client takes every art, model and audio URL from `data/assets.json` and `data/local-assets.json` and builds none itself, so the content-hash segment the server puts in front (`/assets/~<hash>/…`, docs/ASSETS.md "The committed manifest and the served manifests") needs nothing on this side: `validSpine` still sees `.skel`, pixi-spine finds the atlas and its pages under the same segment (a model shares one hash), audio is fetched as `/media/~<hash>/…`. The two URLs the client derives from another file's — the 3D board's `tiles.json` beside the atlas and the token death sound beside `charDie` — are served `no-cache` (the board) or drop the segment (`shared/assetPaths.js unhashedUrl`, the sound).

Enemy preview pen (`render/pen.js`, `render/app/view.js`; research 09 §2): in prep the next round's enemies (`m.private.nextEnemies`; a scouted teammate's from their `m.field`) idle in the pen, rows 14–18 × cols 7–13, no bars, facing left. The pen shows with the prep camera — the own board, its shop-folded framing (the deploy fold included), a scouted teammate's board (their pen), back from the pen view (返回战场) — and with the pen camera (🔍▶▶, `setCamera('pen')`): the 3D board builds the pen block (`boardArea` → `AREAS.normal`: rows 13–18 × cols 6–14, the pen's two red gates (15, 7) / (18, 7) with it), the 2D board draws its rows (`bandFor` / `fieldRows` 6–18: the same pen in both, only the lit rect moves) and its figures show (`showsPen` / `penShown`; `view.stats().penHidden`). At the official prep framing its front rows stand at the top right of the view, beyond the board behind the upper gate, as in the official 休整期 (research 09 §2.1; the maintainer's recording, decision of 2026-10-15), so 🔍▶▶ pans to what is already in view. The battle, 联防, boss and hidden cameras never show it, nor does the Final Assault / Hidden Core prep (its frame ends far below the pen; the round's leader stands on the boss field instead, `leaderShown`). A camera flight keeps both ends' areas and rows and shows the pen when either end does (`restView` / `flightView`), except a flight from the prep camera into a battle camera: the pen goes with the battle start (`enterBattle` also empties its figures) and comes back as the next prep's flight begins. Superseded: user playtest #2 item 6 (2026-09-29) kept the pen to the pen camera ("the battlefield with the waiting enemies above it looked wrong — after 返回战场 and in every battle"); the maintainer's decision of 2026-10-15 reversed that for the prep camera, battles stay as they were (DESIGN §32.14.30). The DOM fallback (simplified view) still shows its pen only behind 🔍▶▶.

Visuals: oblique perspective board (tilted ~30°, trapezoid tiles), raised highland blocks with side faces, road/floor/forbidden styles per research 07 §7, pulsing red gates, blue objective (3D board: `materials.js gateMaterial` after the client's `Torappu/Particles/Additive` / `AlphaBlend` — 2 · _TintColor · texture on the texture's stored values, alpha clamped; the start box tinted red (1, 0, 0) with alpha 0.134 → 0.229, the objective's additive part blue (0, 0.0897, 1) with 0.16 → 0.097, its alpha-blended part (1, 1, 1, 1), from the client's 2 s clip, `scene.js GATE_TINT` — the clip's keys are cubic segments with flat ends, a smoothstep between the two values (`gatePulse`); before, an untinted texture × a gain tuned by eye left the red box's dashes and glyph white, GitHub PR #571 comments; **[ASSUMED]** which of the clip's two renderers is which box, and white vertex colours), dashed hand pads. Units: Spine (Front/Back rule, feet anchored — flying units hover `FLY_HOVER` 1.3 tiles up, the client's 0.35 in character space, research 12, §25.13.5 — an enemy flyer from the road whatever tile it crosses (GitHub #277) —, shadow sprite on the ground), elite gold outline glow, tier chip, HP bar (green ally / red enemy), SP bar (skill ready glow; while an ammo skill runs it is the magazine instead — a yellow cell per round, emptying from the right, `b.snap ammo`, and the skill draws no standing aura, UnitInfo `ammoSkill`; with 设置「弹药数量」 on, its count `left/magazine` under it, §31.9), 斩业星熊's 我执 pool as a red bar over her drained HP bar (`b.snap neg`), 伺夜's 狼群 count as a row of diamonds under the bars, the lit ones the 狼影 left (`b.snap wolves`; 0.2.2, GitHub PR #303 / #378 / #383), status icons, the element gauge row under the bars — icon + white bar of the remaining 元素值, element-coloured refill during a 爆发冷却 (§18.3, §20.8); enemies drawn × their official prefab factor (enemies.json `modelScale`, §20.4); an enemy's mode — the `form` of a sim fx (`shared/protocol.js fxForm`), or UnitInfo `form` for a view built later through `render/app/info.js renderInfo` — switches clip sets (`render/units.js FORMS`: 掠海漂移体 crawl, 暴鸰 bombed, 转译基底's forms, the 逐火 embers, the leaders' 重生, 守墓石像, the 孤岛风云 prisoners' warning and 解放; closing clips timed from the fx `dur`), a one-off cast (`PROJ[kind].once`) plays once, and a local-only model's web alias is tinted (`ALIAS_TINT`: 灼热 / 炽焰源石虫, §21.14); damage numbers (phys orange-white, arts purple, true white, heal green); projectiles drawn per kind, hit sparks and melee slashes, skill activation bursts and auras (§17.3); death fade for enemies, summons and devices — a knocked-out operator stays on its tile in its held Die pose under a redeploy ring (§18.3); leak flash at the objective. Fallback when Spine missing/failed: avatar in a rarity-coloured diamond with bob/lunge tweens — a failed or timed-out model is loaded again (bounded), and a view re-resolves its model and avatar when the asset manifest arrives late or the tab is shown again (§21.27). 60 fps target with ≤ 120 units (a crowd draws its Spine units through the cached atlas, `render/impostor.js`, each refreshed every k-th frame: the refresh turns follow this frame's update order — `ctx.impostorSlot()`, a counter reset at the start of every frame — so a frame refreshes ⌊n/k⌋ or ⌈n/k⌉ of n units instead of whatever random per-unit phases gave, and a unit not refreshed for 2k frames is refreshed regardless; GitHub PR #334 by @Cloudnyco, issue #327 step 1 — its step 2, a time budget by priority, is not done; a model whose pose cannot change — `SpineActor.poseHeld()`: a knocked-out operator in the held end of its Die clip, a frozen model — is neither re-posed nor redrawn, only its clock runs, until a new clip, a revive, a wind-up, a form's closing clip, a clipping switch or a zoom past the impostor's rescale threshold; an impostor's slot is sized from every clip the unit can play — measured once per skeleton, a few frames after the model loads (`render/spine.js clipBounds`, sampled within a 2.5 ms frame budget; until then the unit is drawn directly); no model shows its setup pose (one frozen before its first update — built while stunned without a stun clip — shows its clip's first frame) —, a clip too large for that box (`render/units.js impostorBox`: mostly a deploy drop from above) is drawn directly while it plays, and the atlas draws every slot clipped to its own rectangle (a scissor rect; every batch flush gets its own vertex buffer, which Apple GPUs need), so no pose is cut and nothing is left in another unit's slot (GitHub #542, §31.6); the redeploy rings draw one shared rasterised label per number, `render/textures.js downLabel`, the same pixels as a Text of their own). Picking (which unit a press / hover / dropped item is on) and the drag target follow one rule, `render/pick.js` — the tile under the pointer (§18.1); the Spine store never hands out a skeleton whose unload is in flight (§17.1).

### Official battle effects (官方特效; render/vfx, 0.3.0)

`public/js/render/vfx/` plays the official battle effect prefabs that `tools/local-extract/fx.py` extracts from the
player's own client (the format: DESIGN §33, docs/design/vfx-format.md) on the 3D board. It is client-only: it draws
events the field view already receives, and the simulation, the protocol and the golden results do not change. The
history and the open points: DESIGN §32.14.25.

- **Files.** `available.js loadFxList` fetches `data/local-fx.json` once per page (the served view carries hashed URLs;
  an empty `{ groups: {} }` or a 404 means none; without it the Phase 1a `fx` groups of `data/local-assets.json` serve).
  `library.js FxLibrary` loads `index.json`, `textures.json`, the descriptors (compiled once per prefab:
  `effect.js compileEffect`), meshes (`normalizeMesh`: colours written as bytes are read as 0…1) and the WebP textures
  (`tex/half/` on the light tier) as they are needed. At the prep → battle switch the battle's units' keys are loaded
  (`wiring.js begin`; a unit that joins later, at its spawn event: `more`) and their programs and textures go to the
  GPU a few per frame (`system.js warm`, `WARM_MS` 2 ms); a texture on the GPU is not decoded again.
- **Simulation.** `psys.js` interprets Unity's ParticleSystem: the main module, emission (rate over time and distance,
  bursts with cycles and probability), the shapes, velocity / limit velocity / force / inherit velocity / noise /
  rotation / size / colour over lifetime and by speed, texture sheets, trails, sub-emitters, prewarm, start delay,
  simulation spaces and scaling modes (a particle's size × the scaling mode's scale per axis, a local-space one's as it
  is now: DESIGN §33.5), in fixed sub-steps of at most 1/30 s with a seeded generator. `clips.js` samples
  the prefabs' clips (transforms, active flags, material, renderer and system properties). `effect.js Effect` runs the
  hierarchy and the behaviours: ParticleEffect (delays, loop and stop fade, max lifetime, direction helpers, spawn
  location), ProjectileEffect, FxDelay, FxUVTweener(Advance), FxUVRotation, FxLODSetting, FollowMountPoint /
  FollowOwner, FollowDirection, OnPlay / OnFinish emitters, the Switchable*Effect variants, ColorModifier and
  PauseEffectIf (its CheckType conditions that a view can answer: facing, abnormal flags, sleep).
- **Clock.** The battle clock: the advance of the interpolated render time each frame (`app.js frameBody`, at most
  0.25 s), so the effects follow the game speed and stop with a paused or stalled battle.
- **Drawing.** Two passes in the Pixi stage, `vfxGround` (renderers lying flat within 0.25 of the ground, and those
  the client sorts before the units — a lower sorting layer, or the Default layer with a negative order: DESIGN §33.6
  — under the units) and `vfxOver` (the rest, over the units and the procedural fx), drawn with raw WebGL2 in Pixi's
  context
  (`gl.js FxGL`; Pixi's state is reset after the pass) and the board's camera: `system.js unityViewProj` maps the
  Unity battle frame (board frame through C = diag(1, 1, −1) about the centre (10, 9)) through `projection.js`'s
  camera, pixel for pixel. The entries of every live effect are sorted as Unity sorts them (sorting layer, order,
  render queue, distance back to front) and contiguous draws of one material are merged; a ZTest material tests
  against a depth pre-pass of the board's tile heights. The Pixi canvas is transparent over the three.js board, so the
  blend factors are rewritten for premultiplied compositing: a straight alpha blend becomes (One, OneMinusSrcAlpha),
  additive blends keep the destination alpha, and the Multiply family darkens through (Zero, SrcColor).
- **Shaders.** `glsl.js` holds GLSL ES 3.0 programs written for the client's particle shader families (no official
  source is in the repository): basic, legacy premultiplied / alpha-blended, standard unlit, dissolve (tween, vertex
  colour, double, custom data), disturb (origin, anchor, custom data, ramp), ramp, mask, rim, flipbook and multiply,
  with `_Time` on the battle clock, the custom vertex streams and FxUVRotation as DESIGN §33.6 / §33.11 resolve them.
  A shader of no ported family (GrabPass distortion, RGB split, blur, toon, matcap, outline, …) draws with the basic or
  dissolve program by its name and is logged once (`materials.js fallbackLog`).
- **Wiring** (`wiring.js FxWiring`, from index.json §33.12). An attack: its cast rows on the attacker — the
  ON_CAST_START ones when the attack's wind-up starts its Spine clip (`app.js onUpcoming` → `castStart`, as far into the
  effect as the clip started), the ON_SPELL_ON ones at the 'atk' event; a NONE row's first slot, a directional row's
  slot for the facing, `hookEffectAfterFirstAttack` / `onlyOnce` by the unit's attack count; a looping row, and a
  looping prefab on a one-shot row, stops at the cast's end: the clip's end at its own speed, else after 0.6 s —, its
  `castTarget` / `inputTarget` rows on the target, its projectile's flying effect (the projectile class's own, not a
  chain line or a harpoon's rope: `flight.js projectileParts`) flown from the muzzle — the bone where the model draws it
  at the attack clip's strike frame — to the target's HitPoint in the sim's flight time (homing, the client's Paracurve
  arc and AmiyaS2 wobble) with `onHit` on arrival — a harpoon's rope stretched from the shooter's point to the head
  (its LineRenderers' end points: `effect.js linkLines`), its `toTargetOnStart` / `toTileOnStart` on the target and
  its tile as it starts, a timer projectile's hit at the end of its life (§33.16) —, its hit rows when a melee or
  direct blow's damage lands (else the generic hit by damage type) — a projectile attack's with its projectile's hit, the
  damage or heal the sim lands for a shot before its drawn hit covered by it (round 46, §33.16 "Hits against the sim's
  timing") —; a direct ranged attack with official rows draws no procedural shot; a chain's bounces after an official
  shot of a chain projectile draw its line and hit (`wiring.chain`). One attack on several targets — the sim sends an
  'atk' per target in one tick — casts once (its target rows play on each). Index version 2 (0.3.0 Phase 3c, §33.16): a
  melee blow of a unit that is blocked or blocks (UF.BLOCKED), and every attack of a mode without `attack`, plays the
  mode's `combat` (so does a 领主's ranged-kind 'atk' on the enemy it blocks, round 46); a group ability plays the sub-abilities that fire (a Parallel group all, a Random group one picked by
  a seed of the unit's id and attack count, the others the one that fits the attack's kind) and flies the first one's
  projectile; a MultiHit emitter's hit groups play by the hit's order in the blow's frame (group min(k, last); in turn
  with `useLoopHitEffect`, seeded with `useRandomHitEffect`, the first only with `oncePerTarget`) and its rows without a
  group on every hit; an UberAnimation replace group's rows play with their animation (index v3: `loopType` 0 in turn, 1
  a seeded pick); an InCertainMode emitter's rows only in its mode; a VigilWolf row bound to a buff of its owner never.
  Index version 3 (Phase 3d): a group's `select` picks its sub-ability (parallel all with its main first, random seeded
  and never the previous one with `diffFromLast`, loop / sequential in turn, the first of the attack's kind else, a
  burst attack left out); a shot leaves from its ability's `mount` (a `mountGroup`'s points in turn or at random) and a
  multi attack flies its `additionalTimes` follow-up shots every `triggerDelta` s. Also the generic heal hit, the status
  loops (`generic.status` by the sim's status names) on the unit's mount point while they last, and the unit's own death
  / deploy effect or the generic one. A drawn official hit replaces the procedural spark and slash (the numbers stay);
  what index.json does not drive — a unit it does not list, a chain no official shot opened, an enemy skill no signal opens (Skills,
  below), a talent no signal binds (Talents) — stays procedural. `mounts.js` reads the skin's points (HitPoint, Muzzle,
  HeadPoint, Special points; front / back skeleton, mirrored for a unit facing left) at the unit's feet — a point a
  BoneFollower keeps on a Spine bone where the model draws that bone (`UnitView.boneOffset`) —; an effect with a
  FollowMountPoint follows its point, a weapon effect (and a MUZZLE_POINT / Special-point spawn) with the point's
  rotation; a mode's facing variant plays for the unit's facing (DESIGN §32.14.36). A prefab root's authored position is
  dropped and its rotation is the spawn location's — the unit's Graphic tilt at FOOT / HIT / HEAD (`mounts.js
  spawnRotation`, `graphicRotation`), none at MUZZLE_POINT_WITHOUT_ROTATION, NONE, the ground spawns and a point of the
  ground — so an effect authored standing stands facing the camera (荒芜拉普兰德 S3's seal, 能天使 S3's light bars); a shot
  whose movement comes back (跃跃's boomerang) flies back to the thrower's HitPoint after its hit (DESIGN §34.6). An
  effect played before its prefab loaded is placed by index.json's summary (`prefabs[key].spawn`, its FollowMountPoint's
  `follow` point from the first frame) and takes up its rotation, direction and pause behaviours once loaded (round 46).
- **Skills** (0.3.0 Phase 3b – 3d, `skillfx.js SkillFx`, owned by the wiring; the plans of `skills.js`, DESIGN §33.12
  and §33.16). A battle unit resolves once to its official skill and plan (its data record: `ctx.lookupDef`) and its
  秘术师 charge plan. ['skill', id, 1] plays the plan's `start` and `range` and starts its `loop` (held for the skill:
  stopped with the effect's own fade on ['skill', id, 0], the unit's death, leak or retreat, the battle's reset); 0
  plays `end`. A view built mid-battle (a reconnect, a watched field) starts the loops from the snapshot flag UF.SKILL;
  a passive loops while the unit is deployed (its start one-shots once per deployment; a PASSIVE skill its kit runs
  as a timed one — UF.SKILL seen — follows its events); `ready` loops while sp ≥ spMax > 0 and the skill is off. While
  the skill is on its attacks use the plan's mode (`modeName`; the old `S<n>` rule without a plan): a skill with an
  attack ability of its own replaces the mode's rows with its own for an attack of its kind (a heal, a shot, a blow — 斩业星熊
  S2's shield throw is no melee blow) — cast and range on the owner (ON_CAST_START rows with
  the wind-up: `app.js onUpcoming` sees a ['skill', id, 1] queued before the 'atk'), `aim` on the target, its hit
  groups on the target (the k-th HP 'dmg' — or 'heal' — on it in that frame plays group k; an element gauge fill is
  no hit), its own projectile for a ranged one —, else its `each` rows join the mode's; the buffs of its attacks loop
  on their targets for the blackboard's duration (a status loop of the same key takes over); `trigger` plays on the
  owner's damage (once a frame). An instant skill whose kit made no attack between 1 and 0 plays its attack's cast
  once. 深靛's stored energies (b.snap `energy`, sent whatever 设置「显示弹药与能量数量」 says): each store plays its one-shot and
  lights the next slot's loop at its Special point; an attack flies one projectile per stored energy from its slot
  beside the shot (the sim's 1 + n hits) and the slots go dark; a death or redeploy dims them. When the official layer
  shows a skill, its procedural activation burst and aura are not drawn, and neither are the kit 'fx' it stands for
  (`simFx`): a cast flash on the owner in the frame of the skill start or, tagged with the skill, while its loops play;
  a skill-tagged fx standing for the plan's `pulse` rows (its buff's ticks on the owner, its other hits away from it),
  which play there; and `skills.js FX_BINDINGS` (克莱门莎 S3's 'lock': her skill projectile's mark and three strikes on
  the tile, which also stand for her 'blast's there). A skill with nothing official (no plan, or none of its rows
  extracted) keeps the procedural burst and aura. An effect a plan reaches two ways (a buff's `_buffs` and
  `_extraBuffs`) plays once. A skill attack flies its ability's projectile (index v3 `projectileKey`, else the naming
  rule) and the buffs of its attacks last their `life` (LIMITED: its time or the record's blackboard key; INFINITY: the
  skill; IMMEDIATELY: once). Enemies (index version 2): an enemy's skills by its data record's `skills[].prefabKey`
  (the slots); a skill's window opens on ['cast', id, slot, dur?] (the sim sends it since 0.3.0 Phase 3d: SIM.md) or,
  for an enemy whose record has a single skill, when the snapshot's anim turns SKILL (the sim holds it 0.5 s after an
  ability fires): its start, range and loops play and the enemy's attacks in it use the skill's attack rows (with no
  attack in its first frame, its attack's cast plays); it ends once the anim leaves SKILL and its `dur` (else 0.3 s) is
  over, or on the enemy's death or leak. An enemy in a form whose name is one of its modes' attacks in that
  mode and plays that mode's copies of its skills. A summon's skill — its record's, else the only one its unit has —
  plays like an operator's.
- **Talents and abilities** (0.3.0 Phase 3d, `talentfx.js TalentFx`, owned by the wiring; the bindings of `talents.js`,
  DESIGN §33.16, index v3 §33.17). A battle unit's talents in force — an operator's by its record's talents through
  `talentKeys` (a module's with its module, the trait's always, a node valid with one skill only with it), an enemy's
  all — and its common / general abilities and trait play by `when`: deploy talents at the 'deploy' (an enemy's or a
  summon's 'spawn'; render/app.js `wiring.spawned`) once per life, with their loops while the unit stands; passive ones
  while it stands (a mode's copy, a general ability, while that mode is on); toggles while their checkers hold on the
  snapshot (HP ratio, UF.BLOCKED, the 隐匿 UF.STEALTH, a blocked checker's restore delay); an enemy's 重生 from the
  knock-out form fx (the handler's loop) to the stand-up fx (its end, the 无敌 loop for the enemy record's blackboard
  time, the buffs it leaves) — render/app.js hands every form fx to `wiring.form`, which also sets the unit's attack
  mode from the data (`talents.js formModes`: a 重生's second form, a husk's, 风丸's 替身 → Stand); a node a template casts on
  the sim's fx (a fatal blow's 'substitute' / 'undying', the stand-in's end 'swap' / 'dollEnd', the skill start, the
  deploy); a talent attack on the kit's 'extraAttack'; an arts barrier's talent until 'shieldBreak'. One effect plays
  once per spot whichever binding wants it. When the official rows draw a kit fx's or a form fx's moment, its procedural
  fx is skipped.
- **Floating units** (0.3.0 round 46, `funnelfx.js FunnelFx`, owned by the wiring; the plans of `funnels.js`, DESIGN
  §33.18). The 驭械术士's units are effect prefabs the official attack abilities show at the operator's Special points: at
  home their loops (a mode attack's FunnelEffectEmitter idle — its back and overload variants —, or a funnel shot's
  passive look, which TalentFx leaves to FunnelFx) follow the point where the model draws its bone, with the point's
  rotation (their FollowMountPoint, as the wiring places every one: `mounts.js`, DESIGN §32.14.36); with the owner's
  'atk' the attached units (荒芜拉普兰德) leave home and each lands with its 'dmg' after the body hit (the wolf's lunge),
  then comes back; a funnel shot flies from its mount (洛洛, 至简, 耶拉, 澄闪, 至简 S2's own);
  the kit's 'drone' fx are the remote units' hits (洛洛 S2, 耶拉 S2, 澄闪's skills: the unit beside the enemy, its groups in
  turn, the overload look; it returns after 2 s without a hit or at the skill's end); 荒芜拉普兰德 S3's 'drones' /
  'droneLock' / 'drone' drive her dispersed wolves (spread, chase, latch, hits, the trace and latched marks). Those kit
  fx (the light pillar, the reticle, the overload chevrons) are not drawn procedurally while the units' effects are
  there; without them the procedural look stays.
- **Budget.** Tier 完整 (`full`: up to 220 effects and 6,000 particles, full-size textures) and 精简 (`lite`: 90 and
  2,500, half-size textures, half the emission, the prefabs' FxLODSetting nodes off, no rim or distortion lookups).
  Past the caps a new one-shot is dropped (loops and projectiles always start), and so is a one-shot whose prefab
  loads more than 0.6 s late; a one-shot nobody stops ends after its authored duration, a looping prefab nobody owns
  after 8 s at the latest, and an OnPlayEmitter's looping effect with the effect that played it; finished instances
  are pooled per prefab (up to its `_preloadCnt`, at most 12).
- **Setting.** 设置「官方特效」 (`officialFx`: auto / off / lite / full; `tier.js resolveOfficialFx`: auto is 完整 on a
  desktop and 精简 on a touch device) shows only when the served list names effects. The files are the server owner's
  extraction (`tools/local-extract`), served to every player of that server: a remote player sees the host's effects,
  whatever client they have. The effects draw on the 3D board with WebGL2 only; the 2D board and the simplified board
  keep the procedural effects. A tier switch clears the effects; the skill loops that should run start again quietly.
- **Plugin effects** (0.3.1, [§34.18](../history/0.3.1.md#3418-plugin-operator-effects)). Explicit `fx.unit` requires
  an exact index key for both skills and attack/talent wiring; a miss skips `fx.skills` and keeps the old fallback.
  [ASSUMED] Borrowed talents use the borrower's equipped indices and active module. Author flipbooks draw on both
  boards; compiled prefabs remain 3D-only. The browser rechecks unit ownership and prefab bodies before merge.
  [ASSUMED] Only an identified source whose custom hit draws replaces that damage spark: ranged arrivals are
  estimated and cannot claim source-less damage on the target. Owner/target death cancels pending arrivals.
  Replacing the visual set or destroying the player releases flipbook base textures after their sprites.
- **Dev.** `public/dev/fx-viewer.html` plays any effect key (`?key=`, on a unit's mount points with `&unit=`, turned as
  the wiring turns it for its spawn location;
  `?attack=<unit id>` repeats that unit's attack from index.json through the wiring; `?skilldemo=<unit id>&s=<slot>`
  cycles its skill through the wiring — on, an attack a second, off — with `&instant=1`, `&passive=1`, `&charge=<n>`,
  `&ready=1`, `&hits=<n>` (damage events per blow: a MultiHit attack's groups); an enemy's opens its window with the
  snapshot's SKILL anim and the 'cast' slot, `&block=1` for its combat, `&form=<form>` for a form's mode (skillCmd also
  drives talents: spawn, hp, flags, form, kitfx); `&tier=`,
  `&stress=<loops>,<hits per s>`); `public/dev/battle-perf.html` takes `&fx=off|lite|full|auto`
  and `tools/perfbench.mjs --fx`; `tools/vfx-skill-coverage.mjs` prints the roster's plan coverage and what the battle
  view plays of it.

---

## 10. Client UI (screens & components)

Look & feel: research 06 §11–§12 (near-black green-grey panels, mint `#4ed8af` accents, gold prices, bracket frames, hexagon badges, bond discs, 7-segment countdown). Fonts: Noto Sans SC (Google Fonts with local fallback), Bender/Novecento self-hosted for numerals and Latin micro-labels.

Screens: **Title** (season art backdrop, 开始 → nickname), **Lobby** (独立模拟 / 同盟模拟 → create or join; recent rooms; a 设置 button left of 玩法说明 opens the title screen's settings dialog, GitHub #238; the top bar's S.W.E.E.P. opens the read-only **S.W.E.E.P.报告** — `screens/sweep.js`, a full-screen `Modal`: 盟约报告 / 策略报告 / 敌方资料 after the event's report screen, and the enemy codex whose per-stat letter grades are the official handbook bands, factions.json `handbookLevels` from enemy_handbook_table `levelInfoList`, the enemy's own number beside each), **Room** (4 seats, invite code + copy link, difficulty picker (host), the co-op 「AI 队友最后选择」 switch (host, off by default; read-only for the others), add/remove AI, ready, start; the same 设置 button), **Briefing** (INFO_CHECK: stage, factions, disabled bonds, banned chess, boss silhouette, ready x/4), **Band draft** (the official 请选择策略 band when the pick becomes the player's, co-op, `ui/turnBanner.js`; grid of 40 bands with icon/name/LP/effect; turn order list; skip; 查看禁用盟约与干员 under the order list opens the briefing's bond rows, legend and banned operators again in a read-only dialog — one component, `ui/matchInfo.js`, §21.28), **协议启动！** (BATTLE_CHECK: the official battleReady/* boot screen — the Rhodes Island ship zooming in, a card per doctor with lines into it, 协议启动！ — once its sprites are loaded, else the 协议启动 banner; `ui/protocolBoot.js`), **Game** (Pixi field + DOM HUD: top bar with round/phase capsule (the kill counter reads 已解决 / the round's own enemies: a leak counts, a split child or summon is in neither number, §14; at each phase change the capsule plays a 2–3 s scene of the official hudPanel/trans_* sprites — kettles at 回合开始, the robot meeting the enemy at 作战 / 联防 — none with reduced motion or without the art pack, `ui/hud.js` capsuleFxKind)/LP (live during the own battle, §17.5)/timer/ready, and beside the latency a 观战席 capsule (eye + count, a roster with the host's ✕) while the room has spectators (GitHub #120); bond strip + popups; left team panel with LP/status/emote bubbles, click to watch (a boss round frames the viewer's pair in green, §15); bottom shop bar (level card, 3–5 chess cards — a slot the upgrade just opened is a bare frame until the next refresh, GitHub #332 —, item card, funds, refresh, freeze, collapse; 准备就绪 folds it and cancelling unfolds it, GitHub #138; picking up a piece on the own prep board — 部署干员 / 装备 / reposition, and a legal drop's direction wheel — folds it and zooms to the shop-collapsed prep camera for the interaction's duration, then restores the player's own fold state (the drag never writes it), GitHub #602); detail panel on click/hover (header with bonds, then 特质 — the operator's own effect — right under it, 特性, stats (live: the battle's own numbers / the start-of-battle ones in prep, §18.5), skill, module, equipped items, talents: §17.5); enemy preview drawer (next round enemies with counts, factions; its 本局信息 tab lists the briefing's disabled bonds and banned operators, §21.28); 机变 overlay (the official 悬赏决策 look, the event's video 9:59 – 10:16: the header 「name | description」 over the timing line, the player deciding or 当前轮到你决策 and the countdown at the right — the pick order is no list of its own but a ✓ (picked) / ••• (deciding) on the team panel's portraits, `choiceOverlay.js spMarks`; the official card: a charcoal card in a light frame, framed icon + name, the effect text — data `descRaw` — under it, the taker's round avatar on the top-right corner, a taken card flat grey; two taps — the armed card in a white frame with a ☑ 确认选择 strip, §18.2, §20.7; when a shared draft's pick comes round to the player the official 轮到你选 disc — effectChoose/* sprites, `ui/turnPopup.js` — pops over it for 1.2 s with the 轮到你 sound, none without the art pack or with reduced motion); merge reward overlay (the promotion reward, or a special offer — 凯瑟琳's 定向投放 … — as item / chess cards under its source's label, with the count of offers queued behind it, §21.2); phase banners, and the official round plate at 回合开始 (`ui/matchPopups.js`, the `roundStartDialog` sprites: the robot · 回合 NN · 获得 +N, the income as m.private.funds rose since the phase before; a watcher — eliminated or a spectator seat — gets 观战中 under it and no 获得, GitHub #236; the 剩余 N 回合 strip from three rounds before the final assault; inside 回合开始's 2 s) and, for 联防, the same plate in orange with the official 联防 faces (`hudPanel/trans_coop4` / `trans_coop3`) and the banner's words; and, once their official art is in, 最终攻势 opens with the merged-LP plate and 隐秘核心 with 隐秘核心已解锁, and the run's end (击败了全部领袖！ / 未能击破隐秘核心 / 模拟中断) shows inside the server's pause before RESULT, never delaying it (`ui/bossPlates.js`); the round's result box at SETTLE (the official 「作战结束」 + 「全员无伤！」 / 「生命值减少 −N」 for the viewer's own LP — after a 联防 the server's charge, `m.public.uniteResult.losses` — with the matching BATTLEOVER sound; none in the boss rounds or for a viewer not in the round; GitHub #235, PR #112); ticker (by broadcast priority, highest first; a leader-damage line plays only in its round and a player's newer one replaces the older, §21.10); toasts; the 协议已失效 dialog when the player's own LP runs out while the team plays on (the project's Modal over the official map, an original pixel face — no sprite exists —, 继续观战 / 离开模拟; `ui/downedPlate.js`); emote wheel; settings (volume, quality, show damage numbers, the optional ammo count)), **Result** (the official settlement flow in the official `settle/*` art, each sprite with a text / CSS fallback, `screens/settle.js`: a radar intro; 个人战报 — the viewer's own outcome (模拟完成 / 模拟中断), rounds, leader medals, the ten lineup slots, bonds, trophies and the level settlement against the official 60 cumulative 卫戍认证 levels (`config.rewards.milestones`) with 每日防卫目标 (`config.rewards.daily`), counted from this device's official records [ASSUMED]; 同盟 — a card per seat, the team's rounds, time and date, the 「非官方」 mark and the `result.tab` plugin slot, 数据详情 = the full report `screens/result.js ResultView` (victory/defeat, rounds, per-player lineup, stats, titles), back to room; a spectator opens on 同盟).

盟约栏支持「收起／展开盟约」（GitHub #142）：收起时隐藏完整列表并关闭由列表打开的浮层，让原图标区域的指针事件到达棋盘，只保留至少 44×44 CSS px 的恢复按钮。折叠状态在本局阶段变化、观看队友时保留；展开后仍按当前观看对象显示最新盟约。按钮支持 Enter / Space，聚焦按钮时 Space 不触发准备或暂停。

A bond the mode never activates (标准: official `inactiveBondIdList`) reads 本局禁用 on shop / reward cards (struck through), detail chips and the popup — no 在场 count, no 当前效果 (§21.7); a strategy built around one carries a 本局禁用 tag and note in the strategy draft and stays selectable (bands.json `bondIds`, §21.26).

The strategy draft enables skip only on the viewer's turn, with quota left and another unpicked player to pass to.
The order list retains finished players for display; they do not keep the last player's skip button enabled.

Interactions (research 09 §1.2 / §5, which supersede the first draft): shop card, upgrade and 机变 card are two-tap (select → confirm, §18.2) — a tap anywhere on the card, its confirm strip included, is the card's tap (shop cards have no ⓘ corner; the armed bar sits above the detail card; a shop card that cannot be bought right now opens its detail on tap, §20.7); a press / drop goes by the tile under the pointer (§18.1); drag bench↔board — over a legal tile the dragged unit stands on it, as in the official deploy drag, held under the pointer elsewhere (§27.62); a legal board drop (also onto the piece's own tile) opens the 4-direction deploy wheel (swipe UP/RIGHT/DOWN/LEFT with the rotated range striped orange; release in the centre, ✕ 点击取消 or Esc cancels); tap a unit's tile ⇒ underframe with **出售 +N** (and **撤退** on the board; items/Arts in the hand / temp: **销毁** — equipped items are locked, §6.2) plus its rotated range — the range follows the open detail card (`screens/game/range.js inspectRange`, GitHub PR #281): an own board piece in prep, and in battle or on a scouted board any ally operator / summon on the field with its current range (the live stats' `range` and `dir`, the snapshot's tile), never an enemy or a bench unit (UnitInfo `area` hand / temp); drag, the wheel and the pen hide it; no drag-to-sell; drag an item onto a unit's tile ⇒ equip that unit (both slots used ⇒ the replace dialog `ui/equipReplace.js` shows the incoming and the two equipped items; the player picks the one to replace — it is destroyed — `g.equip replaceUid`; cancel changes nothing); Arts are dropped on a tile and get the direction step; right-click or long-press ⇒ detail (or a tap on a shop card while the bar is locked); keyboard shortcuts — the defaults, which each player rebinds in 设置 → 快捷键 (`ui/gameLogic/shortcuts.js`, saved with the settings; §25.15) — `W` buy the hovered shop card directly (operators and items, no click; empty/sold slots and reward choices do nothing; existing funds/bench checks apply; §32.14.22), `R` refresh, `F` freeze, `D` level-up, `Q` retreat / `X` sell the own operator under the pointer, without clicking first or falling back to an old selection (board operators can retreat; board, bench and temporary-bench operators can be sold; blank tiles, HUD, items and summons do nothing; §32.14.22), `Space` ready (in a solo battle: pause / resume, §14 Solo pause); `Esc` closes (fixed); none acts while a text field has the focus or a dialog is open, nor while spectating, eliminated, watching another board, or on AI autopilot (暂离 or the server's autoplay). While a promotion reward or a special refresh replaces the shop row, W buys only a visible shop card and never a hidden slot or a reward card (§32.14.22). All actions optimistic-free: UI waits for server state (latency is small).

The owner's `prepMapChars` (外勤医疗's 预备干员-医疗, or another displayed map-character variant) are read-only
preparation views: tapping one opens its existing operator-style detail card and highlights its attack range from
its board-space position and facing, including on a mirrored boss half. They cannot be dragged, sold or retreated
from this preview. The inspection affordance does not make the preview a combat unit; the battle sim still creates
the selected variant at battle start (§30.22).

Audio: autochess BGM per phase, UI SFX (buy/sell/refresh/level/merge/ready/timer), a prep piece's landing sound (its battle deploy sound, once per landing, in landing voices of its own that take over the oldest, §31.8), per-unit attack/hit SFX (throttled; an impact plays for a hostile attack's phys / arts / true damage only, never an operator's skill-mode file for a normal attack; each bank's own instance limit, pitch and delay — §34.25; a skill cue that reaches the client before its unit — the sim emits a deploy-tick cast ahead of the unit's `['spawn']` — is held and sounds once when the unit is tracked, `AudioManager.pendingSkill`, GitHub PR #292 by @LimitlessHPPK; entering a field late hands the sound the buffered `spawn` tuples only, `screens/game/early.js audioEarly`, so no old death, deploy or cast replays), boss music in R14/15. While the music is silent — muted, or the BGM volume at 0 — no BGM is downloaded: the track the screen wants is remembered, a different one still playing stops, and the wanted track is fetched once the music is audible again (`AudioManager.bgmSilent`; about 14 MB a match for a player who turned the music off).

---

## 13. Local-client art (optional, host-side)

Title-screen asset download (downstream request, 2026-10-14, PR #628): **下载完整素材** explicitly predownloads the server's
manifest-listed models, textures, audio and optional local art into the browser's HTTP cache. Show file progress,
bytes read, pause/resume and failed-file retry. Do not mark completion until every listed response is fully read;
missing server files remain visible failures. Closing the dialog pauses the queue. Cache eviction and refreshes
do not retain a permanent completion flag. The same dialog can import a local folder or zip. Only bytes whose
SHA-256 matches the served manifest are kept (a Spine model only as a whole group). They are stored in Cache
Storage and served by `public/sw.js` for hashed `/assets/`, `/fonts/` and `/media/` URLs alone. Import requires
HTTPS or localhost. Files already imported are not requested again. See [ASSETS.md](../ASSETS.md#player-initiated-predownload).

`tools/local-extract/extract.py` (Python: UnityPy + lz4 + Pillow; decodes Arknights' custom **LZ4AK** bundle compression via `aklz4.py`) extracts the art the web download does not include (some of it, most official HUD sprites among it, is on the public mirror too — §22.5) from a locally installed client (CrossOver Windows build or PlayCover iOS build) into `public/assets/local/**` and writes `data/local-assets.json` (`{ groups: { '<subdir>': { name: { path, w, h, kind } } } }`). Everything here is **optional**: clients must render correctly when the file or any entry is missing (fall back to the web assets / procedural art). The emotes and the guide pages below are on the public mirror too (§22.5): fetch-assets downloads them (data/assets.json `ui['emoticon/<dir>/<picId>']`, `ui['guide/<key>']`) and the client shows the local copy first, then that one (`data.js artUrls`); docs/DEPLOY.md §6 lists what still needs the client.
- `map/autochess/TX_autochessi_*` — the real autochess board atlas (`_D` diffuse 2048² with floor tiles, gold-framed high-ground plates, REINFORCEMENTS bench pads, EQUIPMENTS pads, crates, gates; `_N/_M/_E` normal/mask/emission; `common_D` device icons; `BG` backdrop). `map/autochesssand/*` — the textures and materials of the sand theme (the theme of nine of the eleven battlefield scenes, §15).
- `scene/<stageId>/` and `scene/tex/` — the official scene of a battlefield (§15 "Official battlefield scenes", DESIGN §30.21): `scene.json` (materials, key light, chunk records), `scene.bin` (the meshes in board space), the lightmap pages `lm<i>`, the reflection atlas `env`, and the materials' albedo, normal, metallic-gloss and emission textures shared by the scenes. Normal, metallic-gloss and emission WebP copies are lossless (emission is exported only when `_EMISSION` is on); albedo and lightmaps stay lossy. `env` stays PNG. Read from the scene bundles `scenes/activities/<season>/level_<stage>/…`, which the client carries only while the season runs: `extract.py --only scene` takes them from the client or from `--scenes <dir>` / `.cache/official-scenes/*` (`tools/local-extract/fetch_scenes.py` downloads them from the official CDN's in-season version). The 0.2.5 full release zip includes the extracted files when the maintainer extracted them before packaging; a lite zip and a source install may fetch and extract them (`node tools/setup.mjs --scenes`). The repository never stores the bundles or the extracted files.
- `ui/{common,battle,outer}/*` — every sprite of the three official autochess UI bundles (tier chips I–VI, bond disc rings, frames, banners, HUD pieces, badges, backgrounds, mode art).
- `emoticon/<dir>/<picId>.png` — the 36 official battle emotes, 6 themes (`shared/constants.js → EMOTE_THEMES / EMOTES`, `emoteArtPath`; data/emotes.json); also downloaded from the mirror (§22.5).
- `guide/autochess_{home,shop,handbook}_N.png` — the 19 official tutorial pages; stored squashed to 1024² — **display at 16:9** (the mirror copies too, §22.5). `extract.py` writes a WebP copy (lossy, quality 90) beside each page and the manifest lists the copy (`GUIDE_WEBP_MODE`; 25.6 MB → 4.2 MB); the viewer preloads only the next page (`ui/guide.js guidePreloadUrl`), not the previous one too.
- `projectiles/*` — battle projectile sprites.
- `spine/enemy/<id>/` — enemy models no web dump carries (灼热 / 炽焰源石虫, `extract.py ENEMY_SPINES`): manifest `enemies[id].spineLocal` (metadata from the committed `tools/assets/local-enemy-spines.json`); drawn instead of the tinted web alias when every file is listed (§21.14).
- `spine/token/<id>/` — token (summon) models no web dump carries (40: most 自选 summons, 凯瑟琳's 爬行号·防护单元, 凛御银灰's 风雪之眼; `extract.py TOKEN_SPINES`, the Front renderer's skeleton of each battle token prefab): manifest `tokens[id].spineLocal` (metadata from the committed `tools/assets/local-token-spines.json`); drawn instead of the avatar diamond when every file is listed (docs/ASSETS.md "Token models from the local client").
- `module/<TYPE>` — the official module (uniequip) TYPE icons (white glyphs; keys are the client's mixed-case file names, e.g. `PRI-X`, `mar-x`, `isw-a`), matched **case-insensitively** against a ModuleRecord's `typeName` by `assetUrls.moduleTypeIconUrl(local, typeName)` (Greek type letters map to the file's Latin letter: `ISW-α` → `isw-a`) — shown on the 干员调配 module cards / module info, the detail panel's 模组 row and the shop card's module tag; lettered tiles / type text without them.

---

## 15. Official 3D board scene (v2 visual target)

Findings (2026-09-28): 卫戍协议 levels have no scene bundle (`mapId` null; the official hot-update list contains none). The client **builds the board at runtime** from the stage grid using the map theme `arts/maps/map_autochess` (materials `MT_autochess` (albedo `TX_autochessi_D` 2048², normal `_N`, metallic/gloss `_M`, emission `_E`), `MT_autochess_common` (`common_D/_E`: device/gate icons), `MT_autochess_Transparent` (`Transparent_D/N/M/E`), `MT_autochessi_BG` (`TX_autochessi_BG`)), the background meshes `arts/maps/map_autochess/bkg_mesh.ab` (`S_Background_common`, `S_Background_shadow`) and `arts/maps/common/meshes/s_background_common.ab`, device meshes (`s_common_box_01` crate, `s_wind_device` blower, …), plus the standard gate/objective effects. The level's `options.configBlackBoard` carries the official camera framing (`default_pos_x/y`, `default_size`, `enemy_pos_x/y`, …).

Correction (2026-10-11, GitHub #532; PR #533 by @andrew05060414): the first finding above was made off season and is wrong. While a season runs, the official hot-update list carries **one prebuilt scene per battlefield** — `scenes/activities/act1autochess/level_act1autochess_m01…m07` and `scenes/activities/act2autochess/level_act2autochess_m01…m04` (each with `…/lightingdata.ab` and `…_lighting_settings.ab`; Android versions `25-11-21-15-21-44_ee1197`, `26-03-13-06-11-47_14fb99`, `26-04-13-12-31-42_e9b560`); the lists of 2026-09-13 and 2026-10-08 have none, and no 卫戍协议 level data either. The asset index of those versions (`<hash>.idx`: each bundle's dependencies) gives each scene's art: act1 m01–m07 and act2 m02 / m04 depend on `arts/maps/map_autochesssand` (m05 and act2 m04 also on `map_doss_shore`), act2 m01 on `map_lakegarden` + `map_syracuse_metro`, act2 m03 on `map_kxmr` + `map_lm_center`. **No battlefield scene depends on `arts/maps/map_autochess`** (the metal theme the procedural board below draws; in the current client the 矢量突破 scenes `act3break` use it). A scene holds the logic tiles (`(row,col)#tileKey` at anchor-local (col, row, −height), high ground 0.4), the art under `GraphicHolder` (static parts merged into "Combined Mesh (root: scene)" objects, lightmapped: Shadowmask mode, one directional key light), and three sub-graphics `HIDDEN@1…3` (`MapSubGraphicHolder`) that the game switches on: the left normal field, the right normal field and the boss field — the areas of `layout.js AREAS`.

Official battlefield scenes (`board3d/load.js loadScenePack`, `scene.js setScenePack`, `materials.js sceneMaterial`): when `data/local-assets.json` lists `scene/<stageId>`, the 3D board draws that scene instead of the procedural tiles, cliffs and background plane; the devices, gate / objective boxes, field edges and terrain overlays stay as below, and so do the device slabs — 射击台, 特制水上平台, 封印的地面 (`layout.js buckets.raised`, their sides reaching 0.08 under the scene's ground): they are runtime devices the scenes do not contain, while the scenes do model the 'h' high ground (act2 m01 / m02), which is not repeated (0.2.6, GitHub #569). The 射击台 is drawn as the official model on both boards when the local art has it (0.3.0, round 40, DESIGN §32.14.10): `trap_1106_achplat` of the 卫戍协议 device bundle `arts/maps/common/trap/trap_110.ab` (extracted to `mesh/trap_110`: the mesh at its prefab scale 0.01 — 1.05 tiles square, 0.465 high — its texture and its material), lit by `materials.js trapMaterial` (`Torappu/Scene/Trap/Shadow`: albedo × (`_Ambient` 0.895 + `_Diffuse` 0.197 · N·L) in display values, with an official scene's own key light; **[ASSUMED]** the formula, from the material's parameters, and no realtime shadow on the model); units stand on its top (`style.js TILE_H.platform` 0.465, on the 2D board too); without the model the slab of that height stays. The base part is always drawn; a `HIDDEN@n` part is drawn when its centre lies in one of the built areas. Chunks of those shown parts that share a material and a lightmap page are one mesh when the area is built (`load.js mergeSceneChunks`); water shares a mesh across pages because its shader has no lightmap. A switched-off part stays out of that mesh. Without the scene (not extracted, a load failure, an unknown `version`) the procedural metal board is drawn as before. The lit materials follow the official GLES program of `Torappu/Scene/StandardRealtimeShadow` (`shaders/standardrealtimeshadow.ab` of the in-season Android version, read 2026-10-12; `materials.js SCENE_LIGHT` has the formula): Unity's mobile Standard BRDF in display (gamma) values — the diffuse colour albedo × 0.779 · (1 − metallic) lit by the lightmap's baked light and by the key light · N·L · the baked shadow mask, the key light's specular highlight, and the reflection of the scene's default reflection cubemap by roughness and Fresnel (from 0.221), with N bent by the normal map, clamped to 1. The client is in gamma colour space: its PlayerSettings give gamma colour space (`m_ActiveColorSpace` 0) and an LDR camera, the scene's key light is Mixed / Shadowmask, and the lightmap pages are RGBM (`m_LightmapFormat` 2), which Unity reads there as 5 · A · RGB. Emission is added after that sum when `_EMISSION` is on and `emissionMap` loaded: `toDisplay(texture(_EmissionMap)) * _EmissionColor.rgb`, the same term at the end of `Torappu/Scene/StandardRealtimeShadow` and `Torappu/Scene/Standard` (Android `26-04-13-12-31-42_e9b560`, the normal set and the cutout set). A map without the keyword (`MT_Syracuse_metro_floor`) stays unlit. Not drawn: the units' realtime shadow map (`_ShadowStrength` scales only that one; the baked shadow is used whole), the vertex-colour blend (`_HG_VERTEX_COLOR_BLEND_ON`; **[ASSUMED]** read as a tile buried in sand that the client uncovers at run time by a rule not found yet — drawn as the program writes it, it covers every patterned tile of the field), the sky box, the map effects (`mapeff_*`) and the post-processing profile are not drawn; water is described below (0.3.0, GitHub #549; DESIGN §32.14.6); crates cast no shadow on a scene. `SCENE_LIGHT` `direct` 1 and `indirect` 1 are the scene's own light values (no tuning); `scenes.py decode_rgbm` writes the pages as 5 · A · RGB / `lightRange` (3.0) and marks scene.json `lightEncoding: 'gamma'`; **[ASSUMED]** a scene extracted before that (no `lightEncoding`: pages in the earlier linear reading, range 8) still draws through an approximate read-back in the shader (`SCENE_LM_V1`: within a few percent, bright), exact only after it is extracted again. Correction (2026-10-12, DESIGN §32.14.2): 0.2.5 added the two terms in linear light with gains 0.8 / 0.4 tuned by eye, which came out about half as bright as the client; 0.2.6 set both gains to 1, still in linear light (GitHub #549, PR #554 by @xcdoge); the sum is now made in display values as the client does. Measured against 0.2.5 (sand of 战场 act2autochess_m02: 97 against the client's ≈ 183 of 255; with the client's sum 196, and 170 under the focus falloff kept below). `scenes.py` writes each scene's default reflection cubemap decoded as the atlas `env.png` (scene.json `env`: size, mips, range; RGBM read as 5 · A · RGB × the scene's reflection intensity, the client's own pre-filtered mips) and the materials' normal (`normal_rgb`, lossless WebP), metallic-gloss (lossless WebP) and, only when `_EMISSION` is on, emission map (lossless WebP, like the normal and metallic-gloss maps) to `scene/tex`; **[ASSUMED]** the tangent frame comes from screen-space derivatives, t along +u and b along +v, the bump's sign not checked against the client surface by surface (scene.bin has no tangents). A scene extracted before the atlas (no `env`) draws the plain sum albedo × (lightmap + key light · N·L · shadow), within about 10 % of the full formula. Measured on act2autochess_m02 (prep camera, 0–255; the client's screenshot in brackets, another framing): light stone tiles 186 (186), planks 203 (206), sand outside the field 164 under the focus falloff kept below (183). **[ASSUMED]** `SCENE_LIGHT.ambient` 0.5 (a mesh without a lightmap page); one reflection cubemap per scene, chosen at the board's anchor — the baked cubemap of the ReflectionProbe whose box holds the board at the probe's intensity (act2autochess_m01 / m03), else the scene's default reflection (scene.json `env.source`); a renderer outside the probe's box and the blend at its edge are not reproduced. The vertex-colour blend is, in that program, `mix(albedo, _BlendColor, smoothstep(_BlendRangeCtrl.x, _BlendRangeCtrl.y, colour.r) · _BlendStrength)` with the geometric normal — a tile buried in sand; it is not drawn because the meshes carry colour.r = 1 on tiles the client shows uncovered (which tiles the client uncovers, and when, is not known yet); the focus falloff outside the lit field rect also dims the scene (`uFocusDim` 0.72) — the client shows no such falloff, the owner chose to keep it (2026-10-12). Owner decision (2026-10-12): these extracted files belong to the 0.2.5 asset pack and may ship in the full release zip; a lite package or a source install may download and extract them on that machine. Missing extractor dependencies keep the metal board. The repository still never stores the official files.

**[ASSUMED]** Source-scene correction (maintainer decision, 2026-10-17; GitHub #684, DESIGN §34.24): extractor
version 4 drops only complete duplicate renderers, keeping the normal lightmap bake. Compare all submeshes,
oriented triangles, UV0, extra UV channels, colours, materials/textures and lightmap-independent renderer state;
world transforms, positions, normals and tangents must agree within an absolute `1e-6` float32-bake tolerance. Partial overlaps stay. A keeper
must cover the removed renderer's visibility (the same group or the always-visible base), so a lone hidden object
and separately switched groups remain. Prefer non-collapsed lightmap UVs, then base visibility, then static baking,
then the lower renderer id. Existing extracted scenes require re-extraction; mesh format version stays 1.

阻隔工事 (`trap_1105_accrate`, renderer `crate`; 0.3.1, GitHub #663, DESIGN §34.7): static prep crates and
battle DeviceViews use the client's own 636-vertex / 344-triangle model and `TX_trap_1105_accrate`, extracted under
`mesh/trap_110`, with its authored UVs. The battle prefab's identity parents, model rotation −90° about X and scale
0.01 map the OBJ to board coordinates (−x, z, y) × 0.01; the authored pivot stays, footprint ≈ 1.013 × 1.019 tiles,
base 0.00175 and top 0.83772. `trapMaterial` uses `MT_trap_1105_accrate` (`Torappu/Scene/Trap/Shadow`, `_Ambient`
0.809, `_Diffuse` 0.271), the active scene's key light and the existing focus falloff. **[ASSUMED]** the shader formula
and omitted realtime shadows are the same approximation as 射击台 above; the client's separate sprite shadow is not
reproduced. Battle crates retain the existing shrinking / opacity death fade and have independent opacity uniforms;
their HP bars use the actual model height plus the existing 0.35 offset. A board-mode switch changes the dimensions
and HUD height on the same frame. Without the mesh, normals, UVs or texture, crates keep the old `s_common_box_01`
box with projected atlas UVs and `mat.board` (procedural box if that mesh is missing too). Mounds always retain that
old box. The 2D board keeps its atlas crops and 0.84 × 0.74 device box; `boxProjectUV` and the atlas rects remain.

Water (`materials.js waterMaterial`, `applyWaterMaterial`; issue #549, idea from PR #555): the board's water tiles
and the official scene's **StylizedWater surfaces use one shader**, with the active map's own deep/shallow colours,
normal tiling/strength and two scroll speeds, sun direction, glossiness, caustics and colour/sky intensity.
`load.js sceneWaterInfo` picks a surface by shader ending `/StylizedWater`, then material name `_water<digits>`;
a valid explicit `scene.json waterMaterial` wins. **[ASSUMED]** when there are multiple surfaces the board uses the
first matching shader record; scene meshes retain their individual records (including the yellow-green `water2`
in act1 m05 / act2 m04). `DynamicWaterTile` is a platform decal, not a surface: it cannot select the board water and
keeps its previous approximation. Only an active, successfully built scene changes the board water; preloading,
switching, replacing or removing packs cannot leave another stage's colours or a disposed reflection on it.
Missing records restore `WATER_DEFAULTS` (the procedural board's appearance); missing fields within a record use
`SCENE_WATER_DEFAULTS` (the extracted `MT_AutochessSand_water` values).

Water uses #571's colour convention: water colour, reflection, highlights and caustics combine in **display/Gamma
values**, clamp to 1, then exact sRGB `toLinear`, the existing linear focus falloff, and `<colorspace_fragment>`.
The scene's decoded reflection cube is shared with its lit materials, sampled with the actual camera reflection
and board z negated (`rd.x, rd.y, -rd.z`), multiplied by `env.range`; only a missing cube uses a two-stop sky
gradient. **[ASSUMED]** the scene cube stands in for the water's `_Skybox`; `WATER_TUNING` uses sky/specular/caustics
gains **0.15 / 0.6 / 0.2 with a cube**, **0.22 / 1.6 / 0.35 without**, with alpha lift **0.2**. These are provisional
values for screenshot review: reflection replaces a fraction of the base, rather than adding another sky, and the
smaller gains with a cube limit repeated brightening. Also **[ASSUMED]**: glossiness ×128 (minimum 2) as a Phong
exponent; wet blend `0.08 + 0.2 N·L` instead of shore depth; caustics tint `(0.55,0.85,0.9)` and distortion `0.08`;
specular tint `(0.5,0.6,0.65)`; display-space gradient `(0.10,0.12,0.15)` → `(0.30,0.36,0.44)`;
roughness mip curve `r(1.7−0.7r) × (mips−1)` (missing mip count: 7 levels); `_SunDir` interpreted as toward the sun
in the scene's Unity frame, with z negated into board space. The board's normal/caustics maps are reused and can
fall back independently; water-specific flow distortion, `_SkyCurvatureMask`, `_CausticCtrl`, foam and the separate
sun-disc controls are not reproduced. **[ASSUMED]** procedural defaults encode the old deep/shallow RGB as sRGB,
with caustics tint `(0.28,0.25,0.23)` and specular tint `(0.8,0.65,0.6)` approximating the old display output; they
retain the old tiling, scrolling, sun, fixed view, wet blend, exponent 40 and opacity 0.9, with no sky contribution.
Browser screenshot acceptance, including highlights and both water records, remains necessary; these are not a
claim of matching the official StylizedWater formula.

Target: a **real 3D board layer** rendered with three.js (vendored ESM, no CDN) underneath the existing Pixi layer:
- Geometry generated from `data/stages.json` like the official builder: LOW tiles = top quads; HIGH tiles = raised blocks with side walls; forbidden/void, fences, gates (red), objective (blue), hand/temp pads, special terrain; UVs mapped onto the official atlas regions (reuse/extend `public/assets/local/map/autochess/tiles.json`); normal + emission + metallic maps; lighting tuned to match official screenshots (key directional light, ambient/hemisphere, soft contact shadows); official background meshes & texture; device meshes (OBJ exported by `tools/local-extract`) with their textures; animated gate/objective effects.
- One camera model drives both layers: `public/js/render/projection.js` keeps its public API (`worldToScreen`, `screenToWorld`/tile picking, presets, transitions) but derives it from a three.js `PerspectiveCamera` initialised from the official configBlackBoard framing, so Spine units, FX, drag/drop and hit-testing stay aligned with the 3D board.
- Must degrade gracefully: when local-client art or WebGL2 features are missing, fall back to the current 2D atlas board; keep 60 fps (static geometry merged into few draw calls; textures mipmapped; DPR-aware).
- Implemented (`public/js/render/board3d/*`, `render/app.js`): three.js is downloaded only when the local-art manifest lists the board atlas; the built 3D area, the drawn 2D rows and the lit rect follow `viewKind(kind, {rect})` (the field the camera actually shows: a 'prep' camera on rows ≤ 6 = `bossPrep`); the background plane is extended with mirrored copies and the clear colour matches the fog (no visible edge at any aspect); battle crates live in their own group (survive scene rebuilds) and follow the board mode (`switchableBox`: 3D mesh ⇄ 2D box on a mode switch or a lost WebGL context); quality 'low' drops shadows; `?board=2d|3d` overrides. The direction wheel's range stripes sit between the board canvas and the unit canvas.
- Done: Final Assault / Hidden Core prep takes place on your own half of the boss field (research 09 §1.2): pieces shown at boss-field positions (row − 7; right-hand player mirrored col → 20 − col, RIGHT ↔ LEFT), drop targets and wheel directions mapped back to board coordinates (`prepCamera` → `bossPrep` in public/js/ui/gameLogic.js; covered by the playtest2 browser tests). A scout of such a board (`m.field` prep of a boss round) comes in boss-field coordinates with the player's `side` and is framed the same way, the leader standing at its spawn (0.2.0, community report item 55). Both players of a pair are shown together, as in the battle (0.2.0, community report item 51): the partner's board stands on the other half (`m.private.bossMate` units, already in boss-field coordinates: mirrored on the right half, RIGHT ↔ LEFT; read-only `m:<uid>` views of `render/app.js syncMates`), the whole boss field is lit, a scout carries both halves (`mate`), and the team panel frames the pair's avatars in the official green (`ui/battle bg_team_border` tinted, a plain ring without the local art; `gameLogic teamFrameIds`) from the round's start through the fight.

---

Clipboard exports (`ui/clipboard.js`, §28.3) first use the secure Clipboard API. The textarea fallback for LAN
play stays inside the active modal/guide focus boundary; it copies only after focus and the complete selection
are verified, and cleans up / restores focus on both success and failure. Failure exposes the existing manual-copy UI.


Push/pull slides preserve the target's pre-hit facing through the waiting and moving phases (`keepFacing`, §28.9).
Explicit false and unmarked raw displacements face the travel direction. Normal snapshot facing resumes on landing.
[ASSUMED] unrecorded push sources and reverse-facing hook pulls use the same display rule as the cited examples.

### Local preferences and recovery (§28.14, §28.18–20)

Settings persist `textSize` (sm/md/lg/xl; default sm), `voiceLang` (cn/jp/en/kr; default cn), `voiceNative` (the
本土语言 switch; default false), `voiceOverrides` (charId → cn/jp/en/kr/native; default empty), `prepDeployFold`
(部署时收起商店; default true — only an explicit false turns the 0.3.0 deploy fold off) and `ammoEnergyCount`
(显示弹药与能量数量; default false). A saved `ammoCount` or `mysticEnergy` of `true` migrates into `ammoEnergyCount`
on read and is not written back. CSS text uses `--t`;
the layout rem, camera and board geometry stay unchanged. Larger text and translated controls wrap within the settings
modal. The normal roster detail and chosen DIY cards expose each operator's voice preference, shared across that
charId's forms, listing only the dubs this server has and offering a preview. An absent override follows the global
preference, then the own-language dub when the switch is on and the operator has one, then Chinese. A missing line
falls back to the Chinese file of the same name. Changing the global language does not clear per-operator choices.

异形屏适配 (`ui/screenFit.js`) persists `sp.pref.screenFit` — four whole pixel offsets `{ l, r, t, b }` in ±100 (inward
positive; the settings show each as a 0–100 slider, 50 = 0, 2 px a step) — on this device only. While any offset is
non-zero, `<html data-fit>` with `--fit-l/r/t/b` makes `.app-root` and the full-page panels (统计数据, 干员调配, 玩法说明)
the inset box and computes the layout rem from it (css/devices.css §5); dialogs and toasts keep the whole screen. The
board is sized from its host, and `fieldHost.js hudBands` measures the HUD from the host's top. All zero leaves no
attribute: the page is exactly the unmoved one.
Overrides are local listening preferences, absent from room loadouts and their exports.

The title and lobby offer explicit recovery of a previously saved local match seat. `sp.matches` stores bounded name /
room-code metadata indexed by token hash; the existing four-entry `sp.tokens` ring remains the authority. Recovery
rechecks BroadcastChannel claims before selecting the token in memory and reconnecting in the same document.
Only the server's `welcome` (`saveToken`) persists that selection and its first-welcome stamp (`sp.tokenWelcome`,
bound to the token hash). Refreshing or reconnecting the same token preserves that stamp. A tab with a session token
initializes with that token or null, never another recent token, and answers ownership queries during initialization.
An earlier welcome takes precedence; equal stamps prefer an already welcomed live document over a copied session,
then tab id breaks ties. A session token without a stamp still outranks a tentative shared-token selection. A pending
recovery yields when the original owner returns; a later welcomed holder also gives up its local claim and pending
reconnect. `hello.noReplace` prevents tentative recovery from evicting a connected session even if its hello is already
in flight; `hello.claimAt` preserves the earlier-welcome priority for established holders' in-flight reconnects. A stale
welcome never reaches the store or flushes queued game actions. Nickname persistence also waits for welcome, so a
refused recovery can return to the previous identity and nickname. It does not identify players by name or IP.
Without BroadcastChannel it refuses shared recovery. Server restart / expiry clears
obsolete metadata on the next welcome. A spectator never registers a recoverable player seat.

`manifest.json` enables browser installation. The maintainer's revised decision of 2026-10-10 is to
**沿用 0.2.x 的薄荷绿城堡并精修**: `public/icons/app.svg` keeps the existing three-battlement rook, inset tower
and splayed base in mint `#4ed8af` on dark `#0c0f0e`. Refinement B narrows the tower, balances the battlements,
thins the base and increases breathing room. It has no lettering, gradients or gloss and uses no official art,
logos, icons or fonts.
`tools/export-app-icons.py` exports 192/512 px PNGs for `any` and separate opaque `maskable` icons: the latter scale
only the mark to 87.5%, keeping every foreground pixel inside the central circle of radius 40% of the canvas.
The same master supplies 16/32/48 px PNG / ICO favicons and the 180 px Apple touch icon linked from `index.html`.
These project-owned assets live in `public/icons/` and ship in full and lite packages; ASSETS.md records their provenance.
The install button appears only for a live browser install offer and hides
in standalone/fullscreen windows or after installation. Every offer is consumed before awaiting the prompt, including
cancellation or failure. The install button does not register a service worker and does not make the server available
offline. A separate asset-only worker (`public/sw.js`) may be registered on HTTPS or localhost to serve imported
hashed art from Cache Storage; it does not intercept the page, scripts, `/data/`, `/sim/` or `/ws`. HTTPS or
localhost and browser support still govern installation.

### Skill-mode sound and delayed models (§28.17, §28.22)

The audio manifest can carry `attacks` / `hits` plus independent `attackMix` / `hitMix` by skill index. Only an active
skill uses a mode bank. The slot is the skill that switches to that attack mode (§34.3), not the `_d` / `_h` / `_s`
letter on the file. An unclaimed mode named exactly `S<n>` is skill n [ASSUMED]; a mode another skill links is not taken. Impacts remember the mode at the time of the attack; an end event cancels a queued start for
an unknown unit, and a late-join snapshot restores the current mode. A mode without a bank falls back to its normal
sound. A selected mode with no mix uses its own default volume/probability, not the ordinary bank's mix.

Attack / hit playback follows `excel/audio_data.json soundFXBanks` (§34.25, GitHub #680):
`audio.sfx.pools` retains each selected bank's `maxSoundAllowed` / `popOldest` and each candidate file's
`minPitch` / `maxPitch` / `delay` (seconds). Unit `pools` and per-skill `attackPools` / `hitPools` identify the bank.
A full pool with `popOldest: true` stops its oldest instance for the new one; otherwise the new sound is dropped.
Aliases share their target bank's pool; distinct banks using one file keep separate limits. Pitch is drawn uniformly
within the played file's own range with client-only randomness ([ASSUMED] uniform distribution); playback starts after its own delay on the audio clock.
The maintainer chose 0.3.1 for this change (reply draft A). [ASSUMED] The remake retains its global 8-voice budget,
160 ms per-unit/role cooldown and 45 ms per-URL gap at playback admission to guard high game speeds. Decoding and
delayed requests reserve no playing slots: admission and takeover happen only when the file's delay has elapsed
after decoding, on the audio clock (a suspended context does not consume that delay). This keeps a sustained stream
audible even when attacks arrive faster than the delay; Chen's official attack bank has cap 2, takeover and delay 0.6 s.
[ASSUMED] At most 64 decoding/delayed requests wait independently of playing slots. A stalled URL has one decode
subscriber and retains only the latest request per bank/unit-role; at most 64 unresolved URL subscriptions survive
across fields, so repeated field changes cannot grow a stalled promise's handler list. Undecoded requests older than
2500 real ms are discarded when decoding finishes. Field replacement, returning to prep and game-screen cleanup
invalidate pending callbacks with a field generation token, cancel delay timers and stop playing pool sources.
These queue bounds, expiry and lifecycle/scheduling choices are web-client guards [ASSUMED]. A zero bank limit means no
bank cap, still subject to the global budget. Missing pool metadata keeps the legacy two-copy behavior; sparse/custom
banks default to cap 2, no takeover, pitch 1 and delay 0. A cosmetic replacement absent from the bank's file list uses
pitch 1 and delay 0 with the bank's cap. These are client presentation choices; no sim or golden change.

A model that arrives after an actual deployment continues Start at the elapsed game time; after the clip's duration it
shows the current base pose. A subsequent attack/death supersedes that pending entrance. That change (0.2.3) added no
deployment sound or per-phase animation schedule; the prep landings of §31.8 below add both for prep pieces.

The simplified-view notice describes a renderer load failure, rather than declaring the device incapable of 3D.
On same-battle metadata refresh, remembered once-spawned device records also seed the renderer's new entry (§29.14).
This preserves device tile picking and live-HP cards; records explicitly supplied by the refresh take precedence,
and a different field never inherits the previous field's devices.
The same fallback covers import failure, timeout and WebGL initialization errors; a reload can retry.
It does not diagnose a particular user's GPU or persist a disabled renderer preference (§28.25).

### Local statistics

The statistics page is being progressively aligned with the [official statistics template](https://ak-webview.hypergryph.com/autoChess/act1autochess).

Accumulated play time appears first in the 战斗累计 tab, alongside the combat sums. It uses the same `duration.totalMs` aggregation and existing minute / hour formatting; the move changes no counting rule.

The overview displays `Dr. <nickname>` from the active session's `me.name` only. A successful history import
restores the newest usable self nickname from that file only when the current name is empty; an existing name wins.
Validate restored names with the title entry's sanitizer, update `me.name` and saved `sp.name`, and fill an empty
entry field without entering the lobby. Entering a nickname and server welcome already update both name locations.
Display 未知 while no current or usable imported name is available. 
The trophies icon uses the existing asset manifest. Compaction and export/import retain trophy awards; older already-compacted rows whose awards were discarded cannot be restored by this display. This is local recorded data, not an official account trophy balance.

A strategy earns its corner badge after 3 successful defenses (`bands.victorCount`; [research 01](../research/01-core-rules.md)).

[ASSUMED] Alliance usage means active in the local player's final settlement: once per match, independent of layers;
inactive bonds retaining layers, teammates and partial quit snapshots do not count. The 0.3.0 storage version (v2, the
same step as the content set of §32.6) keeps `usedBondIds` when discarding full replay details; v1 full rows still work,
but discarded old bond data is not reconstructed. Records whose room mode is unknown (`roomMode` null) count in the
total but in neither mode row: a line under the rows gives their number (DESIGN §32.14.16).

Title-count display uses the following 20-award boundary, confirmed in the official statistics template:

| Count | Display behavior |
|---|---|
| Below 20 | Not full; fill grows with the count; no count highlight. |
| Exactly 20 | Full fill and count highlight. |
| Above 20 | Full fill and count highlight; the number continues to show the actual count. |

Community UI and recovery (§29.6): DIY reuses roster stats and skill previews; Swire's coins and, with 设置「显示弹药与能量数量」 on, a 秘术师's stored attack energies (GitHub #633, PR #636) show current/cap. The lobby player chip opens statistics and the responsive header keeps optional controls from overlapping its title. Settlement's summary scrolls separately from Return. Failed board art can retry, and failed three.js imports use two bounded fresh URLs. Failed engine initialization can remount on online/visibility, at most twice consecutively, cleaning up each previous view; explicit fallback/2D stays selected.

Replacing a field renderer also resets the game screen's entered-view identity. Frames are buffered while the replacement loads; after subscribing, the local runner re-shows full current metadata/snapshot, or the server resends the watched field. Real local and server-streamed battles preserve the same simulation object and clock through recovery, including enemies spawned before the new renderer existed.

§30.4: the HP tower retains current HP until settlement and shows pending loss separately. Shop refresh is single
flight per client until its promise settles (success or error); the button and R key share that state. DIY-only
potential/cultivation changes are exportable; spectator member resolution includes the owner's DIY selection.
Bond tooltips show banned visible members in one clamped scrollable compound box, stacked on narrow screens.
An open list updates on member changes; long-press lists persist for reading and close on outside tap/Escape.
The developer simulation checker and its bounded verification claims are specified in SIM §11 and history §30.5.

Operator attack clips play once per actual attack (§30.7), retaining their interval-based speed. A prepared wind-up
is consumed without replay; a later queued attack may start during the previous recovery. Without another attack
the actor returns to base/skill idle. Late operator events still start at the strike frame; no sim timing changes.

§34.31: Blemishine's S2 strikes use her official S2 mode's `Attack` (`Attack_Down` when facing down and available),
while `Skill_2` remains the cast; S3 retains `Skill_3`. Read only the effects index the field already loaded.
The same verified S2 mapping applies without it: the manifest's cast has OnAttack, so absence of that event alone
cannot identify this cast. The legacy index omits per-mode animation remaps and skin key-to-clip tables; until
those are exported, every other skill retains its existing roles with or without the index [ASSUMED], rather than
treating every raw `Attack` key as the normal skeleton clip. Held loops (§34.4/§34.4.1) and distinct skill idles
(§23.13) keep their rules. History §34.31 lists the further cross-checked candidates, unchanged in 0.3.1.

Connection recovery sits above the AI-away overlay and below global modals (§30.8), so a replaced session can
be reclaimed by pointer while away. This does not change the stacking behavior of modals nested inside a screen.

§30.20: 设置 →「官方伤害数字」 defaults off. Off, damage numbers stay the typed every-hit popups. On, and only
while 「显示伤害数字」 is also on, the field draws a red integer for a `dmg` tuple marked `'r'` and a yellow MISS
for a dodge fx whose payload is `num: 'm'` (PRTS 作战机制 「伤害红字（暴击）」). Ordinary hits and heals draw no
digits in that mode. The mark is computed in the sim; the random offset above the model is client-side. The
simplified board uses the same mark with a fixed slot. The title footer links the project repository in a new tab.

### Deploy animation replays (§31.8)

PR #416 by @Cromemadnd. A prep piece that lands plays its Start clip again with its landing sound, once per landing
(`render/units.js UnitView.land`): the sound its battle deployment makes (`audio.js deployCue` → `deploySfxUrl`, its own
ON_UNIT_BORN file else b_char_set / b_char_tokenset) through the SFX volume and mute, in landing voices of its own
(`LAND_VOICES` 3 at once [ASSUMED], a 160 ms cooldown per piece, not the battle limiter): a landing over the cap takes the
oldest one's voice (a 30 ms fade) instead of being dropped, so every landing of a round start is heard though most share
the 1.41 s b_char_set; the field view fetches the generic files ahead (`warmLandings`). A piece whose
Start still plays (on its model, owed to a model still loading, or cued less than a clip ago) keeps it and sounds nothing
more. Only an idle prep piece lands, never a battle unit or one attacking, dying, dragged or in another clip, and nothing
lands in a hidden tab. Battle deploys keep the silent `onDeploy`; audio.handleBattleEvents sounds them.

- Round start (the maintainer's confirmation from official play, 2026-10-13): during 回合开始 the own board's pieces land
  one after another in deployment order — operators by column from the left, top to bottom within a column, then the
  summons (`ui/gameLogic deployOrder`, the order of Battle.start) — `DEPLOY_REPLAY_MS` 50 ms apart [ASSUMED], chained
  timeouts (`render/app.js replayDeploys`). `screens/game.js` asks once its field-view wiring has run and marks the round
  only when the view has taken the sequence (`roundStartReplay`): a view or board not built yet is asked again during
  回合开始, a resync or re-render of the same round replays nothing. Own board only: never a scouted or watched
  teammate's board, a spectator seat, an eliminated player or the boss partner's half. The timers end with prep mode, a
  fresh prep scene and `destroy()`.
- [ASSUMED] (the PR author's account): an operator that arrives on the bench (a purchase, a reward, a grant) and a merge's
  elite land; so does a piece that a new state puts on a board tile it was not on (from the bench, another tile, a swap),
  when that state arrives. Turning in place, a retreat and bench moves do not.

### Optional ammo and stored-energy counts (§31.9, §32.14.28, §34.3)

设置 →「显示弹药与能量数量」 (`ammoEnergyCount`) is one switch, off by default. It replaces 「弹药数量」
(`ammoCount`, PR #552 by @IceCodeNew) and 「秘术师能量」 (`mysticEnergy`, PR #636 by @zasx77771, GitHub #633).
The official HUD has neither number (the maintainer's decisions of 2026-10-13 and 2026-10-15). A saved profile is
read once: the merged switch is on when either old key was the boolean `true`; a stored boolean `ammoEnergyCount`
wins, and the old keys are not written back. [ASSUMED] that precedence, so turning the merged switch off stays off.

On, an operator's ammo bar carries `left/magazine` under it (`UnitView._updateAmmoCount`, the exact b.snap `ammo`
counts, extra rounds and refills included), centred in the bar's yellow; the rows under the bars move down by its
height. It hides with the magazine, in the prep view and after death. The simplified board has no ammo bar and so no
count. The same switch puts a 秘术师's `stored/cap` in the row stack under the purse (`UnitView._updateEnergy`,
b.snap `energy` from `snapshot.js mysticView`: `trait.stored` against `profile.storeMax`, zero included), in a violet
orb of its own; the element gauge moves down by its height. Allies only; kits with a store of their own (维伊, 黑键)
have no row. The official effect is the default display: with 设置「官方特效」 on, the same readout lights 深靛's
stored energies on the operator (§9 "Official battle effects", Skills) whatever this setting says.

### Plugin studio gameplay previews (§32.9.1)

Gameplay authoring uses a separate editor module per template under `public/studio/js/editors/`. DSL inputs are
structured controls with server validation; script source is read-only. Trial replays feed actual field metadata,
`b.snap` and `b.ev` shapes into `render/app.js`. The studio never executes author battle scripts in its page.
UI-widget previews use the same `pluginFrame` host as the game, with fake data and memory-only preview storage; all
frame sandbox, navigation and message limits remain in force. The room's settings form is manifest-driven and shows
normalized values from the room, read-only for non-hosts and during a match. Vanilla pages load no extra studio code.

Authoring checks (DESIGN §32.9.1): numeric fields display the shared official bounds and positive step floor; invalid saves are refused. DSL validation network failures are explicit, and saving revalidates the current spec before writing. Unkeyed studio state reads omit script source. Trial replay remains a data-only renderer feed; sandbox simulation runs in the same SES executor as a formal match. Forge and catalogue entry points remain available beside the authoring templates.

0.3.1 (§34.29) adds bond/item/trait/offers/rules templates with actual fields and official-name pickers. Full-draft
validation uses the existing keyed validate-dsl endpoint, ordinary folder checks and data-only composition; no new
plugin grammar or route. Reopen reads current document fields; save merges only form-owned changes, retaining
other fields/declarations/required permissions and their unchanged raw JSON bytes. Validation, unsaved trials and
save check the complete merged folder before writing. Their dummy/wave/duel trials add an explicit
single-holder prep event and active-bond/equipped-item fixture [ASSUMED], plus real Match offer choice, refresh and
virtual-clock timeout with before/after feedback. Bond income/refresh and trait gain/deploy use their own hook
vocabularies; Auto selects the first prep rule or roundStart [ASSUMED]. Rules trials compare real refresh, prep
loadout, morph equipment and unequip actions with vanilla; replay carries actual equipment/loadout and morphPairing.
These fixed bounded fixtures are [ASSUMED], not a full economy/room;
golden scenes and the independent vanilla console keep their previous behavior. New UI uses the four language packs.

Presentation authoring (§34.30): theme, notices, fx and skins each have a template and form. Theme applies only
validated tokens to the studio root and restores the previous inline declarations on unmount [ASSUMED]. Notices
preview uses the announcement popup's localization and plain text. Skins previews use the actual picker rows and
fallbacks; file-slot changes hydrate the form before subsequent saves. FX drafts use the existing trial replay in
both board modes; locally indexed borrowed official effects remain 3D-only. All four forms hydrate current declarations
and reuse the gameplay authoring delta merge. Form saves require complete folders and staged media to pass strict checks;
invalid retained content is refused with contextual errors, without requiring gameplay data for cosmetics. FX images
are saved with their form; default bindings use the equipped skill. Unsupported summon carriers are refused [ASSUMED].
Skin uploads isolate shared paths, including Spine, and validate bytes before replacement; numeric directory suffixes
are [ASSUMED]. Skin slot uploads and the files PUT route use a no-new-problems strict gate (code + where/file),
allowing incremental missing-image repair; each uploaded file must validate. The 0.3.0 slots keep writing directly. Every PNG encoding is inflated to its exact scanline size, including Adam7,
with a 256 MiB raw cap [ASSUMED]; only declared FX sheets (inline/file overlays; upload checks ignore extension case) use the
2048px non-interlaced 8-bit RGB/RGBA subset. Candidates hardlink unchanged files (clone-copy fallback) after refusing
all links; only changed files face upload limits, with aggregate limits checked on the candidate. [ASSUMED] Hidden
`.sp-studio-*` candidates inside the real plugins directory share its volume and are excluded by registry scanning.
HTTP link staging and complete checks use bounded children (two concurrent, 20 seconds, 512 MiB heap [ASSUMED]);
cleanup runs on every outcome. Changed media commits before plugin.json with rollback. FX reads merge into the
latest draft and disable save while pending. Trial bodies match the 160 MiB authoring limit; staged replay PNGs
are embedded for the replay lifetime (8 MiB compressed image total inside the 16 MiB result cap [ASSUMED]).
No new route or gameplay rule is introduced.

### Combat metrics (作战统计) — ported from the xinhai-ai fork, opt-in

设置 →「作战统计」 (`combatMetrics`, PR #618 by @robll-v1) defaults off, the same kind of decision as 显示弹药与能量数量: the
official HUD has no such panel. Off, the corner button is not rendered and `trackCombat` is not called (no `damaged`
hook, `battle.heal` is not wrapped). On, the corner's 作战统计 button (`gm__metrics`, `ui/combatMetrics.js`) opens a
modeless panel over the running battle: the fight keeps playing behind it, ✕ / Esc closes it, and the next frame's
prep keeps it usable.

`battle/metrics.js` (`trackCombat`) attaches in `prepare` only when the setting is on and the host is in-page.
`screens/game.js` pushes the switch with `setCombatMetrics` (the runner does not import the settings store). A
gameplay-plugin room (`room.content.vanilla === false`) simulates in a Worker: the page holds wire state only (time
and ids, no `damaged` hook and no `heal`), so the meter is not attached and the button stays hidden. A cosmetic plugin
keeps the vanilla content set and the in-page host, so the meter still runs. A `hud.right` ui-slot is a separate node
and is not gated by this setting. Turning the setting off mid-battle detaches the hook and restores `heal`. Turning it
on does not backfill a battle already prepared ([ASSUMED]: the hooks would have missed damage already dealt); the next
battle prepared after the switch is the first one counted.

`combatMetrics({ scope: 'battle' | 'match', ownerId })` sits beside `currentBattle()` on the runner. A row is one
operator: the effective HP the sim's own counters lost (mitigation, silent damage and DoTs included; overkill, element
gauge fill and friendly damage excluded), the HP a heal actually restored (overheal and shields excluded), the local
battle seconds, and dps / hps; the bar under the name is segmented by damage type (物理 / 法术 / 真实 / 元素) and rows
sort by damage. Same-name operators merge per player (`combineCombat`), summons count toward their owner, and the panel
passes `myId` — it shows the own player only. 本局累计 keeps the last snapshot of every locally simulated battle
(evicted replicas included; a replayed battle replaces its snapshot, never adds a second) until the match really
restarts (a new match / a rewound round); a new round's prep clears only 当前战斗. Nothing here is sent to the server or
enters b.progress / b.result, and a tracked battle's result and rendered events are byte-identical to an untracked one
(test/match/combat-metrics.test.js, test/match/runner.test.js). Ported from [xinhai-ai/Stronghold-Protocol](https://github.com/xinhai-ai/Stronghold-Protocol)
(其公开部署分支，作者 @临夏俨然) with thanks.

### Forge compact metadata (0.3.1)

Forge import (CLI and the studio's explicit preview/import) and setup's startup/update gap preparation fetch missing
official tables only when out-of-roster operators need them (maintainer decision 2026-10-17, §34.33). The cache uses
the voice indexes' source/mirror policy; offline flags refuse downloads and failures retain the reported local fallback.
The studio's offline box clears the previous report and applies to preview and confirm. Gameplay never fetches tables.
The table set, validation limits and installation options are specified in [PLUGINS §16](../PLUGINS.md#16-forge-import).

Compact operators may declare `chess.hidden`, explicit `chess.ids.normal/elite`, exact `art.assets` and official
`origin` references ([PLUGINS §16](../PLUGINS.md#16-forge-import)). Hidden records remain addressable for grants,
but never enter shops, visible handbook/loadout lists or owned DIY selection. Explicit pair IDs drive upgrades.
[ASSUMED] Provenance is descriptive only, hiding applies to both forms and both identities, and borrowed voice
preferences belong to the borrowed bank. Evidence and migration: [0.3.1 history](../history/0.3.1.md).

[ASSUMED] One installed lang plugin may overlay each built-in language, in sorted plugin order; supplied UI/game-text
keys override and missing/invalid entries retain built-in text. Scope remains browser-local choice, independent of
room content and simulation. Pure geometry SDK helpers return frozen values and accept at most 1024 range cells.
Forge UI mounts without an equivalent slot require an explicit manual-adaptation report, separate from script copying.
Art/audio templates ship original CC0 sample media; the studio fills the target's first editable slot [ASSUMED].
