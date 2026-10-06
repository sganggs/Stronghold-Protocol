# 12 · Official flying visuals: a flat lift of ~1.3 tiles (the client's 0.35 in character space)

Written 2026-10-05 as research, after a player report (「无人机等飞行单位贴图位置明显偏低」) that flying units sat too low,
and the follow-up 「绝对不止 0.35」 with an official screenshot of 帝国炮火先兆者 over a tile. `PRTS` has no published
fly-height data, so the value was read from the client and then measured on screen:

- **`[DATA]`** the official fly offset is a **single model-independent constant, `Vector3(0, 0.35f, 0)`** —
  `Torappu.Battle.CharacterAnimator`'s constructor stores it, and `_SetFlyMountPointOffset` / `_SetFlyHitOffset` add it
  while the unit flies and add its negation when it lands (§2).
- **`[MEASURED]`** `0.35` is in the client's own *character* space, whose unit is the standard battle-prefab scale
  **0.27** (our `enemies.json modelScale` is a multiple of it), so the lift in **tiles is 0.35 / 0.27 ≈ 1.3** — and the
  player's screenshot measures **1.2–1.4 tiles** of art-bottom clearance (§3).

**Implemented** the same day: `FLY_HOVER` 0.32 → **1.3**, still a flat, model-independent lift from the model's own
origin (§6). An earlier attempt in this session (a per-model "anchor at the art bottom" term) was withdrawn — the client
has no per-model term at all, and the screenshot agrees with a plain constant.

**Tags** (as in research 11)
- **[DATA]**: read from the official client. Local Windows client 2.7.71 (Unity 2021.3.39f1, files dated 2026-08-20):
  `Arknights_Data/il2cpp_data/Metadata/global-metadata.dat` (il2cpp v29: class, field and method names, the type/method
  tables) and `GameAssembly.dll` (x86-64 machine code, disassembled with `objdump`; method addresses mapped to names
  through the `Assembly-CSharp.dll` code-gen module's method-pointer table and the metadata method tokens).
- **[MEASURED]**: pixel-measured from the player's official screenshot (2026-10-05) — the tile pitch, the drone's rotor
  span and the body-to-shadow distance, converted with the projection of §3.
- **[ASSUMED]**: the character-space → tile conversion (0.27) and each model's own art hang.
- **[COMM]**: the player reports that started this.

---

## 0. TL;DR

| # | Question | Official answer | Tag |
|---|---|---|---|
| 1 | Is there a fly-height constant? | **Yes: 0.35, only the Y component.** `CharacterAnimator`'s constructor sets its fly offset field to
  `Vector3(0, 0.35f, 0)`; `_SetFlyMountPointOffset` / `_SetFlyHitOffset` add it to the mount / hit transforms while the
  unit flies and add its **negation** when it lands (`m_flyMountPointOffsetApplied` tracks the state). | DATA |
| 2 | Is it per model? | **No.** No store to that field exists anywhere in the binary except the constructor, and the offset is applied
  to the model's own root transform — every flying unit gets the same lift, and each model keeps whatever art hang its
  artist gave it. | DATA |
| 3 | How much is that in tiles? | **≈ 1.3 tiles (`0.35 / 0.27`).** `0.35` is in the client's character space, where the unit is the standard
  battle-prefab scale **0.27**. The player's screenshot of 帝国炮火先兆者 over a tile measures **1.2–1.4 tiles**. | ASSUMED + MEASURED |
| 4 | What did the remake get wrong? | It lifted a flat **0.32** — the right *shape* (constant, from the origin) but ~1 tile too small, so every flyer sat
  low; the big drones (妖怪 / 妖怪MKII, whose art hangs 0.38 / 0.37 tiles below the origin) even had their art bottom
  *under* the tile. Now `FLY_HOVER = 1.3`, flat. | DATA + MEASURED |

---

## 1. How the addresses were found (reproducibility)

No disassembler, no Il2CppDumper — the method table was read directly from the binary and metadata.

1. **Metadata, self-calibrated** (`global-metadata.dat`, il2cpp v29). The struct sizes were calibrated empirically rather
   than assumed: `Il2CppTypeDefinition` = **88 bytes** (type token at +84, hi-byte 0x02, 100% of types; `method_count`
   at +64 and `field_count` at +68 — the u16 sums equal the method/field table sizes), `Il2CppMethodDefinition` = **32
   bytes** (name index at +0, `declaringType` at +4, method token at +20; the first token is `0x06000001`). Sanity-checked
   on `Torappu.Battle.AutoChessBattleConst` (field names match research 11's list; floats read correctly, e.g.
   `BATTLE_WAIT_UI_TIME = 1.5`, `RATIO_PARAM = 100`). (Integer constant values are compressed in v29 and not needed here.)
2. **Code-gen module** (`GameAssembly.dll`). The `Il2CppCodeGenModule` for `Assembly-CSharp.dll` was located through the
   string: find `"Assembly-CSharp.dll"`, convert its file offset to an RVA, then find a pointer to that RVA — that is the
   struct's `moduleName` field. For this build: `moduleName` VMA 0x186e69af0 (file+0x6e67ef0), **`methodPointerCount`
   = 217790**, **`methodPointers` = 0x188216460** (file+0x8214860, in `.data`).
3. **Method index → address**. The metadata method token's RID − 1 is the index into `methodPointers`. So
   `_SetFlyMountPointOffset` (token 0x600F5DA, RID 62938) → index **62937** → pointer **0x180600050**;
   `_SetFlyHitOffset` → **0x1805fff30**; `_OffsetHitTransform` → **0x1805ffdf0**; `..ctor` → **0x180600530**.
4. **Disassembly** with `objdump -d -j il2cpp --start-address=… --stop-address=… GameAssembly.dll`. The `il2cpp`
   section (VMA 0x18053c000, 0x653a05c bytes) holds the real x86-64 code. (The binary has Tencent's `UnityPlayer.dll.tvmp`
   and odd `.Sgxm0/.Sgxm1` sections, so the export table is unhelpful; the module-name route above avoids it.)

---

## 2. The fly offset: one constant, 0.35 (Y only) [DATA]

### 2.1 `CharacterAnimator..ctor` sets it (VMA 0x180600530)

```
movss  xmm1, [0x186a78a50]        ; 0.35f  (0x3EB33333)
xorps  xmm0, xmm0
unpcklps xmm0, xmm1               ; xmm0 = { x=0.0, y=0.35 }
xorps  xmm2, xmm2                 ; z = 0.0
movsd  [rbx+0x114], xmm0          ; field @ +0x114 = Vector3(0, 0.35, 0)   (x,y)
movss  [rbx+0x11c], xmm2          ;                                   (z)
```

So the instance field at **+0x114** is a `Vector3(0, 0.35, 0)` for every `CharacterAnimator`.
The constant sits in `.rdata` at **0x186a78a50 = 0x3EB33333** (= 0.3499999940395355), and the next float is an unrelated
1.8f.

### 2.2 `_SetFlyMountPointOffset` / `_SetFlyHitOffset` apply it

Both are structurally identical twins; `_SetFlyMountPointOffset` (VMA 0x180600050) shown:

```
cmp   [rbx+0x121], dl            ; m_flyMountPointOffsetApplied == (arg) ?  → return
je    ret
test  dl, dl
je    .notFlying
  movsd xmm6, [rbx+0x114]        ; the Vector3(0, 0.35, 0)
  mov   esi,  [rbx+0x11c]
  jmp   .apply
.notFlying:
  ... movss xmm1, [0x186a77e00]   ; −0.0 sign mask (0x80000000)
  ... xorps xmm1 (x/y/z)          ; negate all three components
.apply:
  call  _OffsetHitTransform([rbx+0xf8], &offset, 0)
  call  _OffsetHitTransform([rbx+0x100], &offset, 0)   ; a second transform
  mov   [rbx+0x121], dl          ; m_flyMountPointOffsetApplied = arg
```

- Flying (`arg != 0`): add the offset. Landing / not flying: add the **negation** (sign flipped through the `−0.0` mask
  at **0x186a77e00 = 0x80000000**), i.e. remove it.
- It touches **two** child transforms (`+0xf8`, `+0x100` — the mount point and the hit transform, both via
  `_OffsetHitTransform(transform, &offset, false)`). `_SetFlyHitOffset` is the same, guarded by a different static flag
  and a different member (`[r8+0x160]` vs `[r8+0x158]`).
- The only direct caller of `_SetFlyMountPointOffset` is `OnFinish` (#62924, call site 0x1805feb87) — the "land" path.

### 2.3 Reading

- **One constant, all flyers, no per-model term.** A section-wide scan for **any** store to
  `[reg+0x110/0x114/0x118/0x11c]` (SSE + GPR opcodes, with the ModRM `[reg+disp32]` form, in every executable section)
  found **no writer except the constructor** — nothing scales or rewrites the offset per model.
- **The offset is a plain local position at the model's root.** `_OffsetHitTransform` gets the vector by pointer and is
  called with two of the animator's own transforms, so the whole model moves up by one constant; where each model's art
  sits inside that space is the artist's business (妖怪's art hangs 0.38 tiles below its origin, 帝国炮火先兆者's art sits
  entirely above it).
- **The unit is not the tile.** 0.35 read as "tiles" is wrong: an offset applied at the model root in the client's
  character space is scaled by that space's unit — the **standard battle-prefab scale 0.27** (the same 0.27 our
  `enemies.json modelScale` is a multiple of). `0.35 / 0.27 = 1.296` tiles, and the screenshot (§3) measures 1.2–1.4.
  [ASSUMED: the exact hierarchy that produces the 1/0.27 factor; the two independent numbers agree, and the on-screen
  measurement is what the remake has to match.]

---

## 3. Measuring the official on screen [MEASURED]

Source: the player's own screenshot of 帝国炮火先兆者 hovering over a tile (2026-10-05; a 468×510 normalised copy; JPEG).
Measured with Pillow, on the tile grid and on the sprite itself.

| What | Value | How |
|---|---|---|
| Tile pitch, horizontal | ≈ 180–200 px | hazard-stripe bands (olive ≈ RGB 110,110,95) at x ≈ 202 and 382 on every row |
| Tile pitch, vertical | **150 px** | stripe bands at y ≈ 306.5 and 456.5 on the same column |
| Drone rotor span | 313 px | dark connected component (max channel < 95), x 60..372 |
| Drone art width, world | 1.561 tiles | skeleton `bounds.width` 710 × `modelScale` 0.7037 / 320 (`UNIT.modelScale`) |
| ⇒ scale | **≈ 200 px per tile** | 313 / 1.561 — agrees with the 180 px stripe pitch within 10 % |
| ⇒ tile tilt | cos θ ≈ 0.75, **sin θ ≈ 0.66** | cos θ = 150 / 200 (a ground tile's screen height vs its width) |
| Drone art bottom | y ≈ 223 (dark shell) … 250 (pod bottom) | dark component bottom / the pod's visible bottom edge |
| Shadow centroid | y ≈ 410 | the dark ellipse on the tile, x 157..404, y 392..428 |
| ⇒ screen gap | **160–187 px** | art bottom → shadow |
| ⇒ **hover** | **1.2–1.4 tiles** | h = Δy / (s · sin θ) = 160…187 / (200 × 0.66) |

Cross-checks: the client's own constant in character space gives 0.35 / 0.27 = **1.30** tiles — inside the measured
range; and the remake's old flat 0.32 would put the same drone only ≈ 42 px above its shadow at that zoom (0.32 × 200 ×
0.66), roughly a quarter of what the official shows, which is exactly what the report described.

Caveats: the art bottom is a matter of a few pixels (the pod is pale against the sky), the shadow is a soft ellipse, and
the drone's own `modelScale` is taken from our data — the estimate is ±0.2 tiles, not a precise constant. The lift is
**not** read from the shadow's *pixel* offset alone: the shadow marks the unit's ground point (the official draws flying
units' shadows on the ground tile), which is what makes it a usable reference.

### 3.1 What decides a model's own offset (read from the `.skel` bones) [DATA]

The per-model part of "where the art sits on the tile" is **the Spine authoring, and nothing else**: where the artist put
the skeleton's origin and how far the drawn art extends from it. The runtime only adds the one constant (§2). Read from
the shipped `.skel` files with the project's own parser (`@pixi-spine/runtime-3.8`, setup-pose bone Y in skeleton units,
origin = the root bone at y = 0):

| enemy | bones | lowest bone (setup) | art `bounds.y` | ⇒ net art hang |
|---|---|---|---|---|
| 妖怪 | 11 | `Fan_Stop_01` −145.1 (rotor); `Hip`/`root` ≈ 0 | **−162.7** | 0.377 tiles below the origin |
| 妖怪MKII | 11 | same skeleton as 妖怪 | −145.4 | 0.370 (its `modelScale` 0.8148 vs 0.7407 is the only difference) |
| 暴鸰 | 10 | `Fan_Stop_01` −130.5, `L_Leg` −16.9, `Hip` −0.1 | −107.7 | 0.249 |
| 寒霜 | 6 | `Fan_Stop_01` −57.6 (only 6 bones; `Hip` +70) | −32.9 | 0.068 |
| 帝国炮火先兆者 | 15 | `C_R_Support_Down` −158.2, `C_R_propeller` −89.1 | **+0.16** | **none** — nothing is *drawn* below its origin (the gear bone is below it, but the setup-pose attachment bounds start just above 0) |
| 御4 | 8 | `C_Fan_A` −135.9, `C_Belt` −34.9 | +9.3 | none (art starts above the origin) |

So: same-code constant + the artist's pivot/attachment layout = every visible difference between models. Two consequences
worth keeping in mind:

- A model whose art hangs below its origin keeps that hang in the official too (妖怪 flies with its rotors ≈ 0.92 tiles
  up, 帝国炮火先兆者 with its pod ≈ 1.30) — the remake now reproduces both, because it uses the same skeletons and the
  same constant.
- The client *does* hold a per-model positional table, `Torappu.Battle.BakedMountPointData` (`bakedStepInterval`,
  `frameCount`, `trsData` — per-frame TRS), read through `CharacterAnimator.GetMountPoint` /
  `get_footTransform` / `get_shadowTransform` / `get_hitTransform`. Those are the **mount points** (hit box, shadow decal,
  muzzle, foot), i.e. per-model anchors for effects and gameplay — not a repositioning of the drawn body.
- **Open question:** our renderer anchors every model by its origin, which equals "feet on the tile" for almost every
  model (ground units' median `bounds.y` = 0.013 tiles). The one visible outlier is the boss 盐风主教昆图斯 (0.99 tiles
  below its origin): *if* the official instead anchors bodies by the baked foot mount point, it would stand correctly while
  ours sinks. Distinguishing the two needs an official screenshot of that boss standing on a tile; until then the
  origin-anchoring rule (and this flat lift) is what the flying fix relies on.

Follow-up (2026-10-05, after the question "具体模型偏移位置到底受什么决定" and an official screenshot of 盐风主教昆图斯):

- The client's other per-model vertical value is **`CharacterAnimator.UpdateBaseline` → `host.get_graphicHeight()` →
  `ApplyBaselineEffect(0, −1, graphicHeight, 0)` → `SetFloatParam(<param>, −graphicHeight)`** (method pointers 0x1805ff880,
  #63458 `get_host`, #76677 `get_graphicHeight` — a *virtual* getter, so the value comes from the concrete entity's data —
  #63382 `ApplyBaselineEffect`, #63369 `SetFloatParam`; the height is negated through the same `−0.0` mask at 0x186a77e00).
  It reaches a **render/effect float parameter**, not a body transform: the model's height above its baseline is handed to
  the shader/effect layer (bars, effects, ground-fade), while the drawn body stays where the unit's transform puts it. Our
  data has no `graphicHeight` field; the renderer derives the equivalents itself (`bounds.y` for the art hang, `bounds.height`
  for the head/bar height).
- The boss check — **no repositioning, and no hole either.** 盐风主教昆图斯 (`enemy_1521_dslily`, `modelScale` missing → 1,
  383 bones, art 9.86 × 5.09 tiles, art bottom **0.99 tiles below the origin**, and no hole/pit region among its 113 atlas
  regions). Facts from our own data:
  - the boss's route (`waves.json act1autochess_h07_04`) is `move → [1,17] → **disappear** → wait 3 s → **appear [5,10]**`
    — it leaves the field and re-enters;
  - the wave's `devices` carry 4 **hidden `trap_039_dstnta`** at (5,9) / (5,11) / (3,9) / (3,11) — the spawn points of the
    tentacles its `SummonTentac` skill calls up (`dslily_dstnta` branches; `server/sim/content/bosses.js`).
  **Withdrawn interpretation:** an earlier pass read the grey area under the boss in the player's screenshot as a *hole in
  the ground*, and proposed drawing one. The owner checked the official: **there is no such hole, and the model has none
  either** (`hidden: true` devices draw nothing at match start; the grey area is the boss's own art/shadow over the tiles).
  So the boss's art simply extends ~1 tile below its position as big-monster art overlapping the tiles in front — which is
  exactly what origin-anchoring draws. **Origin-anchoring stands, no per-model body lift, and no `bossSpawn` decal is
  missing** (the client's device set omitting `bossSpawn` — `render/tiles.js DEVICE_ROLES`, `render/board3d/layout.js
  DEVICE_KINDS` — matches the official, which draws nothing there).
- Follow-up on the boss's **size** — verified, nothing to change. Our `enemies.json` has no `modelScale` for 盐风主教昆图斯,
  and our data omits that field exactly when the official prefab's scale product is the standard 0.27 (`tools/build-data.mjs`
  `MODEL_SCALES` lists only the deviations). Re-ran the host-side extractor against the local client
  (`python tools/local-extract/enemy_scales.py --game <…>/StreamingData/AB/Windows --json`, UnityPy + lz4 in a `.venv`):
  **`enemy_1521_dslily = 0.27`** — the standard — so `modelScale` 1 is correct and the boss is drawn at the right size.
  The same run reproduced the whole table for all 243 prefabs with **0 differences** from the hardcoded `MODEL_SCALES`,
  which is a clean end-to-end check of the size pipeline. (Re-runnable any time with that script; no dump committed.)
- **Do the official prefabs move a model vertically per model? No.** Asked as 「按原版偏移来修正」 after a mid-session
  misreading, this was settled by reading the battle prefabs directly (`tools/local-extract/enemy_model_offsets.py`,
  UnityPy; `dyn/battle/prefabs/enemies/<prefab>.prefab` in `battle/enm_pfb_*.ab`):
  - The **prefab root's** local position is an editor leftover that the game overwrites with the unit's world position at
    instantiation (妖怪 (0,0,0) but 帝国炮火先兆者 (4.23, 2.11, −1.2), 源石虫 (3, 3, 0), 掠海漂移体 (2.21, 5.23, 0)) —
    reading it as a height was the misreading, and it is what produced the bogus "+2.11 world units" for the drone.
  - The real placement is the **`Graphic` node** (the wrapper that holds `FaceSwitcher/Spine`): for all **28** of this
    mode's flyers its local position is **0** — ten at (0,0,0), the other seventeen at the same **(0, −0.2, −0.06)** that
    ground units such as 源石虫 use (a prefab-family convention, unrelated to `bounds.y`).
  - So the client applies **no per-model vertical correction to flyers** — flat `FLY_HOVER` is the client's own behaviour,
    and a model whose art hangs below its pivot keeps that hang on screen. The art-bottom compensation that was briefly
    implemented in this session is **withdrawn** (code back to a flat `FLY_HOVER = 1.3`, tests back to asserting the same
    lift for every flyer).
  - One genuine deviation did surface, and it is a *size*, not a position: 帝国炮火先兆者 and 帝国炮火中枢先兆者 have a
    **non-uniform** `Graphic` scale — **(0.19, 0.24, 0.24)**, i.e. the official draws them **1.263× taller** than the
    uniform 0.19 our `enemies.json modelScale` (0.7037) implies. Our renderer had no per-axis model scale, so those two
    were drawn ~21 % too short vertically — **now fixed**, see the sweep's last bullet.
- **Full sweep of all 243 enemies** (`enemy_model_offsets.py --json`):
  - `sy/sx ≠ 1` in exactly **3** of 242 readable prefabs: the two 先兆者 above (**+1.263**, a real vertical stretch) and
    `enemy_1196_msfyin`, whose ratio is **−1.000** because its `Graphic` X scale is **negative** (sx −0.4, sy 0.4) — the
    official **mirrors that model horizontally**, and our scale pipeline takes `abs()` (`enemy_scales.py` /
    `MODEL_SCALES`), so we draw it unmirrored. A facing detail, not a stretch, and it only affects that one enemy.
  - **Both are implemented** (owner: 「都要」, 2026-10-05): `enemies.json` gained `modelScaleY` (1.263, the two 先兆者) and
    `mirrorX` (木制瑞印), produced by `tools/build-data.mjs MODEL_STRETCH_Y` / `MIRRORED_PREFABS`; `render/units.js`
    multiplies the skeleton's Y scale (and the bar height) by `enemyModelScaleY` and flips `flip` for a mirrored model,
    in both the direct and the impostor draw paths. Documented in DATA.md §9; covered by three tests in
    `test/render/playtest6-enemies.test.js` (data, the 1.263 aspect + bar height, the opposite x-sign). Note neither the
    先兆者 pair nor 木制瑞印 appears in this mode's waves, so the fix is for the general data set (other modes/events).
  - `Graphic` vertical offsets are a small set of prefab-family conventions, none of them flyer-specific:
    (−0.200, −0.060) 180 enemies (16 of them FLY), (−0.202, 0) 25, (−0.200, 0) 18, (−0.450, −0.060) 4, (−0.330, −0.060) 4,
    and **(0, 0) for 11 — every one of which is a flyer**. Ground units share the −0.2 families, so that offset is the
    family's camera-facing convention, not a world-space lift of the model.
  - `modelScale` re-verified against the official `sx / 0.27` for all 242: **0 mismatches** (the shipped table is exact).
  - One prefab has no `Graphic` child at all (`enemy_9016_acstmr` 刺胄之弹) — nothing to read there.








---

## 4. The flyers of this mode, and why the old lift looked worst on the drones [DATA]

`bounds.y` is the art's lowest point in skeleton units (the view scales by `UNIT.modelScale = 1/320`, then by the enemy's
`modelScale`); `sink` (tiles) = `−bounds.y / 320 × modelScale` — how far the art hangs **below its own origin**. Under a
flat lift the *net* clearance is `FLY_HOVER − sink`, so the same constant leaves every model at a different visible
height — the official's arrangement too.

| enemy | key | `bounds.y` | `modelScale` | `sink` | net at 0.32 (before) | net at 1.3 (now) |
|---|---|---|---|---|---|---|
| 妖怪 | `enemy_1005_yokai` | −162.7 | 0.7407 | 0.377 | **−0.06** (art under the tile) | 0.92 |
| 妖怪MKII | `enemy_1005_yokai_2` | −145.4 | 0.8148 | 0.370 | **−0.05** (art under the tile) | 0.93 |
| 暴鸰 | `enemy_1040_bombd` | −107.7 | 0.7407 | 0.249 | +0.07 | 1.05 |
| 寒霜 | `enemy_1042_frostd` | −32.9 | 0.6667 | 0.068 | +0.25 | 1.23 |
| 帝国炮火先兆者 | `enemy_1112_emppnt` | **+0.16** (art above the origin) | 0.7037 | 0.000 | +0.32 | **1.30** |
| 帝国炮火中枢先兆者 | `enemy_1112_emppnt_2` | +0.16 | 0.7037 | 0.000 | +0.32 | 1.30 |

All **28** flying units in this mode's data (`stats.motion === 'FLY'`) are lifted by `FLY_HOVER`, in three groups that no
longer matter to the code: 9 whose art hangs below the origin (枯朽之种 0.386, 妖怪 0.377, 妖怪MKII 0.370, 威龙 0.269,
暴鸰 0.249, 寒霜 0.068, 法术大师A1/A2 0.049, 愧悔魂灵圣杯 0.003), 6 whose `bounds.y ≥ 0` (御4, the two 先兆者, 枯朽萃聚
使徒, 护障 / 护障·P) and 13 with no usable `bounds` in their `.skel` header (远眺, 节日气球, the 萨科塔 and 斩胄之剑 / 破胄
之锤 / 刺胄之弹 parts…). The flat lift is what the client does, so those three groups need no special case.

Ground units are unaffected: their median `bounds.y` sink is ≈ 0.013 tiles. (A separate oddity, not touched here: the boss
盐风主教昆图斯 sinks ≈ 0.99 tiles; body alignment is a broader change and not part of this report.)

### 4.1 近地悬浮是地面怪, not a low-flying tier [DATA]

Asked as "所有飞行敌方（非近地飞行）都是 +1.3 是吗" — **yes, and "近地悬浮" is not a flyer at all**: the official's own
data classifies those units as ground (`motion: WALK`), so they never see the lift. The two units whose descriptions say
it outright:

| enemy | 描述 | `motion` | our lift | the "slight hover" look comes from |
|---|---|---|---|---|
| 掠海漂移体 `enemy_2025_syufo` | 「【近地悬浮】，攻击额外造成侵蚀损伤」 | **WALK** | **0** | its art: `bounds.y = +6.7` skel units, i.e. drawn a hair *above* its pivot |
| 吉兆飞鳞 `enemy_10045_parrot` | 「近地悬浮，失去近地悬浮后晕眩数秒重新起飞…」 | **WALK** | **0** | (no `bounds` in the manifest) |

Consistency of the classification across the whole roster (249 enemies of this mode): every one of the **13** units whose
description carries the official 【飞行单位】 tag is `motion: FLY` (13/13), and no unit with 悬浮/浮空/漂浮/漂移 in its
description is `FLY` (0/2). So the tier boundary is data, not code — a "near-ground hoverer" is a ground enemy that the
artist drew slightly above its pivot, while a flyer is one the code lifts by the single constant. The same principle
explains every other per-model difference (§3.1): **the code never repositions a model relative to its origin**.


---

## 5. Before, official, now

| | Remake before | Official | Remake now (§6) |
|---|---|---|---|
| Lift | flat **0.32** from the origin | flat **0.35** in character space = **≈1.3 tiles** from the model root | flat **1.3** from the origin |
| Model dependence | none | none (one constant) | none (one constant) |
| 妖怪 net art clearance | −0.06 tiles (art under the tile) | ≈ 1.3 − 0.38 = 0.92 | 0.92 |
| 帝国炮火先兆者 net | +0.32 | ≈ 1.3 | 1.30 |

---

## 6. Implementation (2026-10-05 DEVELOPMENT, client-only)

- `public/js/render/units.js`: `FLY_HOVER` 0.32 → **1.3**, a flat lift used directly at the draw site
  (`const hoverTo = this.flying && this.alive ? FLY_HOVER : 0`). The doc-comment above the constant carries the full
  client citation (class, methods, VMA 0x180600555, constant 0x186a78a50 = 0x3EB33333, the −0.0 mask 0x186a77e00), the
  0.35/0.27 derivation and the screenshot measurement.
- **Withdrawn in the same session**: an earlier version of this fix exported a `flyLift(entry, modelK)` that added the
  model's own art hang (`max(0, −bounds.y / 320 × modelScale)`) on top of `FLY_HOVER = 0.35`. The disassembly (no
  per-model term) and the screenshot (a constant ≈1.3) both say the lift is model-independent, so it was removed rather
  than kept as a second, undocumented variable.
- `test/render/unitview.test.js`: `describe('flying units hover FLY_HOVER above the ground, whatever their model')` —
  3 tests: `FLY_HOVER ≈ 0.35 / 0.27`; every flyer of this mode keeps a positive, consistent net height and the two 妖怪
  drones *were* under the tile at the old 0.32 (with 帝国炮火先兆者's `bounds.y > 0` pinned as the "art above origin"
  case); and a view-level wiring test (a flying view's `hover === FLY_HOVER`, a ground view's `hover === 0`).
- Result: local full suite **3639 tests / 3628 pass / 0 fail, 11 skipped**. Pure client change (the server serves
  `units.js` per request), so a hard refresh (Ctrl+F5) applies it — no server restart.
- Not yet upstream: this is a local-install patch; the same diff + tests can be lifted onto the `stronghold-pr` clone as a
  client-only PR if wanted.
