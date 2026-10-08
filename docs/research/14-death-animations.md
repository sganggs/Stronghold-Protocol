# 14 · Enemy death animations: the art never drops the body, and 25 clips were being cut short

A player report — "a dying 帝国炮火先兆者 seems to drop at the very end", then "what about the other enemies'
animations?" — answered by reading the client's own data and its code.

## 0. TL;DR

- **No enemy animation moves the whole body.** Playing all 251 enemies' clips and sampling every bone's world position,
  the **root bone's vertical displacement is 0.000 tiles in every Die (234), Idle (235), Move (234) and Attack (215)
  clip**. Limbs move (up to 2.16 tiles for “帝国的甲胄”'s arms); the body never does. Every vertical placement is the
  renderer's: the fly lift, the model's own art hang (`.skel bounds.y`) and nothing else.
- **A dying flyer dropped at the wrong moment.** The client removes its fly offset in `CharacterAnimator.OnFinish` —
  when the finish state ends, not when the unit dies — so a drone stays aloft through the death animation and drops as
  it goes. The remake dropped it the instant `alive` went false, so the death clip played on the ground. Fixed: the lift
  is held for the Die clip and released inside the fade tail (§4).
- **25 death clips were cut short by a 1.6 s cap** — 盐风主教昆图斯's 7.97 s clip played 20 % of itself, 鼠王 37 %,
  杰斯顿·威廉姆斯 40 %, and 22 more (§3). The cap is now 8 s, above every clip in the data.
- 17 manifest entries have no Die clip at all; they are the ground items/collectibles (§5).

## 1. How the clips were read [DATA]

`tools/local-extract/enemy_animation_motion.mjs` (added here) reads `data/assets.json` + the extracted `.skel` files and
**plays** each clip: `Skeleton` + `AnimationState`, stepped at 30 Hz, `state.apply(skeleton)` and
`skeleton.updateWorldTransform()` after every step, recording the range of `skeleton.y` (the root) and of every
`bone.worldY`. Ranges are converted to tiles with the model's `modelScale` (320 skeleton units = one tile at scale 1 —
the conversion the flying-visuals write-up uses for the same models).

Do **not** try to read the timelines directly: in this build of `@pixi-spine/runtime-3.8` they hold packed numeric
arrays (`timeline.frames[0]` is a number, not `{time, x, y}`), so a keyframe walk silently reports zero motion — the
first attempt here did, and 270 Attack clips "had no rotation". Sampling the played skeleton is layout-agnostic and
matches what the client draws.

## 2. Nothing translates the body [DATA]

| clip | read | root displacement > 0.01 tiles |
|---|---|---|
| Die | 234 | **0** |
| Idle / Default | 235 | **0** |
| Move / Walk | 234 | **0** |
| Attack | 215 | **0** |

The largest single-bone travel inside a Die clip is 2.16 tiles (“帝国的甲胄”, a flailing limb), then 1.40 (节日气球),
1.29 (“独轮车玩具”), 1.18 (业余竞演者) — normal animation, not a fall. A "the body sinks" effect can therefore only come
from the code paths that place the model (`FLY_HOVER`, the `zTarget` ease, `lift`, and the artist's `bounds.y`).

## 3. Death clip durations, and the 1.6 s cap that cut them [DATA]

234 Death clips: shortest **0.50 s**, median **1.00 s**, longest **7.97 s**. `render/units.js` used
`clamp(d / rate, 0.35, 1.6)`, so **25 clips were trimmed** (11 %), every one of them a boss or elite:

| enemy | Die clip | played by the old cap |
|---|---|---|
| 盐风主教昆图斯 | 7.97 s | 1.60 s (20 %) |
| 鼠王 | 4.33 s | 37 % |
| 杰斯顿·威廉姆斯 | 4.00 s | 40 % |
| W / 泥岩 | 3.33 s | 48 % |
| 假想敌：胄 ×2 | 3.10 s | 52 % |
| “巨大的丑东西” | 2.83 s | 56 % |
| 腐败骑士 | 2.67 s | 60 % |
| 高普尼克 ×2 / 卢西恩，“猩红血钻” / 假想敌：管 ×2 | 2.33 s | 69 % |
| 假想敌：弦 | 2.30 s | 70 % |
| 雪孩子 / 伊利昂的木驮兽 / 鸭爵 ×2 / 纠缠藤蔓 / 凋零骑士 | 2.00 s | 80 % |
| 陷落雪祀 | 1.80 s | 89 % |
| “帝国的甲胄” / 底海滑动者 / 富营养的滑动者 | 1.67 s | 96 % |

The lower bound (0.35 s) trims nothing: the shortest real clip is 0.50 s. The client plays its clip out — its `OnFinish`
fires when the finish state ends — so the cap only ever made the remake's deaths shorter than the official's.

## 4. A dying flyer drops at the end of the clip, like the client [DATA]

The client's fly offset is one constant (`Vector3(0, 0.35f, 0)` in `Torappu.Battle.CharacterAnimator`, applied by
`_SetFlyMountPointOffset` / `_SetFlyHitOffset` while a unit flies and negated when it lands; the remake draws 0.35 in
character space ≈ **1.3 tiles** as `FLY_HOVER` — the flying-visuals write-up has the full derivation). Its only direct
caller is `OnFinish` (#62924, call site
0x1805feb87), disassembled as `xor edx, edx; mov rcx, rbx; call _SetFlyMountPointOffset` — **arg 0**, the negation
branch — followed by clearing `[this+0x128]` and a tail call to another cleanup. `OnFinish` has no direct `call` site of
its own: it is a virtual lifecycle method (there is a `<>xLuaBaseProxy_OnFinish`), so the battle framework calls it
through the vtable when the character's **finish** state ends.

Since the Die clips carry no vertical motion (§2):

- **Client**: the drone stays aloft for the whole death animation and drops as the finish state ends.
- **Remake before**: `hoverTo = this.flying && this.alive ? FLY_HOVER : 0` — `die()` clears `alive` *before* the clip
  plays, so every flyer sank to the ground inside ≈0.42 s (lerp τ = 1/6 s) and played its death clip **on the ground**.
- **Remake now**: the hover target is `this.alive || (this.dying > DIE_FADE_TAIL && !this.down)` — the flyer holds
  `FLY_HOVER` for the whole clip (the view fades over the last `DIE_FADE_TAIL` = 0.55 s of `dying`) and drops inside
  that fade, which is the client's `OnFinish` moment. A knocked-down (`down`) flyer still lies on the ground.

All 27 flying enemies of the data have a Die clip of 0.67–1.00 s, well inside the cap, so the cap change never touches
them; 帝国炮火先兆者 and 帝国炮火中枢先兆者 are unexceptional (Die 1.00 s, root displacement 0.000).

## 5. The 17 entries with no Die clip [DATA]

未装配刀片 · 防护背心 · 冲击式施术单元 (deployable equipment) and 木制瑞印 · 红木瑞印 · 小说卷轴 · 诗画卷轴 · 青铜镜 ·
黄铜镜 · 木制镇纸 · 红木镇纸 · 青瓷茶器 · 彩瓷茶器 · 铜矛头 · 铁矛头 · 铜灯盘 · 铁灯盘 (the collectible/relic props). They take
the documented frozen-first-idle-frame path (see the `die()` comment in `render/spine.js`), which is right for an item
that is picked up rather than killed.

## 6. Implementation (2026-10-06, client-only)

- `public/js/render/units.js`: new `DIE_FADE_TAIL = 0.55` (the fade tail `die()` already appended as a literal) and
  `DIE_CLIP_MAX = 8`; `dying = clamp(d / rate, 0.35, DIE_CLIP_MAX) + DIE_FADE_TAIL`; the hover target as in §4; the three
  `0.55` literals in `die()` / the knockdown branch / the fade now use `DIE_FADE_TAIL`.
- `test/render/unitview.test.js`: a dying flyer keeps `FLY_HOVER` through the Die clip and is under a quarter / a
  twentieth of it inside the fade (a walker stays at 0); the 7.97 s boss clip is scheduled whole and the view is still on
  screen 5 s in.
- `test/render/playtest6-enemies.test.js`: a data guard — no `data/assets.json` Death clip exceeds `DIE_CLIP_MAX`
  (234 clips seen, the longest 7.97 s).
- `tools/local-extract/enemy_animation_motion.mjs`: the sweep of §2–§3 (`--game`/`--assets`, `--keys`, `--only-fly`,
  `--clip`, `--json`).
- Client-only: the server serves `units.js` per request, so a hard refresh (Ctrl+F5) applies it — no restart.
