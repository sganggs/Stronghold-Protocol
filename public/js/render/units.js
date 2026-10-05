// render/units.js — per-unit views for battle units and prep pieces (DESIGN §9).
//
// UnitView = shadow sprite (shadow layer) + body container (depth-sorted unit layer: elite aura, Spine actor or
// the avatar-in-rarity-diamond fallback) + HUD container (bar layer: HP bar with delayed "ghost" damage, SP bar
// with ready glow / draining skill bar, tier chip, status icons, blocked marker). The fallback shows at once and
// cross-fades to the Spine model when it has loaded (the game never blocks on Spine); an optional local-client model
// (assets.js spineEntry `fallback`, DESIGN §13: 灼热源石虫 / 炽焰源石虫) falls back to the web model first; that web alias
// (the plain 源石虫) is drawn tinted toward the slug's own colours (ALIAS_TINT). A model that failed or timed out is
// loaded again after SPINE_RETRY_MS (bounded), and `retryAssets()` re-resolves a view's picture and model when the
// asset manifest arrives after the view was built or the tab is shown again (render/app.js; public issue #8 item 5:
// after a reload whose manifest was slow or failed, every operator stayed the image-less placeholder for good); a load
// begun while the tab was hidden and still in flight SPINE_STUCK_MS after it is shown again is started again
// (assets.js spine.restart: GitHub #68, such a load may never settle — its view stayed the placeholder). Every
// bar is a tinted Texture.WHITE sprite, so HUDs batch into few draw calls.
//
// Placement: feet anchored at world (x, y, z); scale = camera px-per-tile at the feet × UNIT.modelScale, so
// chibis shrink with distance like the original. An enemy's model is also scaled by its official prefab factor
// (enemies.json `modelScale`, user playtest #6 item 9: the official battle prefab shrinks e.g. 威龙 to 0.16 / 0.27 of
// the standard size — tools/build-data.mjs MODEL_SCALES; `enemyModelScale`). Operators and summons face their deploy direction `dir`
// (research 09 §1.2, DESIGN §3: UP|RIGHT|DOWN|LEFT, chosen with the direction wheel; UnitInfo / piece `dir`, else
// the legacy `facing` ±1): the Back model for UP (when one exists, research 07 §5.5), the Front model for RIGHT and
// DOWN, mirrored for LEFT; the orange ground wedge "›" of prep board pieces points along `dir` (rotated on the ground
// plane). `setDir(dir)` re-orients a live view (swapping Front ⇄ Back without a fallback flash). Enemies flip by the
// sign of their horizontal velocity (with hysteresis). A dead or knocked-out operator facing UP falls and lies with its
// Front model — 131 of the 135 Back skeletons have no Die clip (GitHub issue #25: the Back model went on with its
// attack loop under the redeploy ring) — and stands up again with the Back model (`_wantsBack`, `_syncModel`).
//
// Knocked-out operators (user playtest #4 item 9, b.snap `down`): `setDown([id, respawnAt, respawnTime, state, row,
// col])` keeps a dead operator on the tile it lies on (row / col: where it fell, or its home — sim Battle._layBody,
// player report F5 after 0.1.0) in its knocked-down pose — the Spine Die clip played once and held on its last
// frame (the collapsed / kneeling pose with closed eyes; the Front model's for one facing UP unless its Back skeleton has its own Die clip, see above), slightly
// greyed — with a redeploy ring above its head:
// a dark disc, a mint arc filling as the respawn timer runs and the seconds left; once the timer is done and it still
// waits, a full amber ring with "DP" (not enough DP) or a red ring with "!" (its tile is taken). `onDeploy` (the
// redeploy) plays the deploy clip and restores the normal look; `setDown(null)` on a dead view lets it fade out.
// An operator that enters a battle already knocked out (联防, user playtest #5 item 2: sim 'die' reason 'forcedExit')
// goes down with `die(true)`: straight to the held end of the clip, no fall.
// Enemy modes (the `form` of a sim fx — shared/protocol.js fxForm — → `setForm(form, fx)`): 掠海漂移体 dropping to 爬行模式
// (user playtest #5 item 1) plays its skeleton's 'Change' clip once, then the crawl set (*_02); 暴鸰 flies on without its
// bomb (*_2) after the drop (feedback D4); 转译基底's forms, the 逐火 embers, 再生's puppet, the leaders' 重生 and 守墓石像
// likewise (user report after 0.1.0) — FORMS; an operator's form is a 傀儡师's 替身 (GitHub issue #44). A view built later
// (`info.form` = UnitInfo `form`, the sim's current form, through render/app.js renderInfo) starts in the mode; a dead
// view keeps the form it died in (`_dieForm`) for a model built while it lies down.
// Element gauges (b.snap `elem` → sample `el` / `elFill` / `elUntil` / `elDur`), the official form (PRTS 元素: "模型
// 下部会显示对应的元素图标，并以白条显示剩余的元素值"; enemies "小尺寸图标（不显示元素图标，仅根据元素种类改变背景色）"): a row
// right under the unit's own HP / SP bars and inside their span — the element's disc at the left (operators with its
// glyph, enemies smaller and plain) and a white bar of the remaining 元素值 (1 − fill) that runs out right to left
// like the HP bar above it; during a 爆发冷却 the bar refills over the cooldown (PRTS: "元素条显示缓慢恢复至上限"), drawn in
// the element's colour with the disc pulsing [ASSUMED look], so a refill never reads as 元素值 still left while the
// burst's stun / damage / 凋亡 ticks hit the unit. User playtest #6 (report 11): the v2.3 ring right of the bars sat on
// the next operator's tier chip and bars (drawn under them) and read as that operator's gauge, a shrinking ring reads
// like a filling progress ring, and its refill was the same white as the 元素值 left. The disc comes from the hudRings
// atlas, the bars are tinted Texture.WHITE sprites; built on first use and hidden when idle.
//
// ItemView renders hand items as a floating icon plate; DeviceView renders battle devices (crates) as 3D boxes
// with an HP bar once damaged.
//
// Cost control (low-end devices): a unit whose body is outside the viewport (`ctx.viewport()`, with a margin) is not
// animated or drawn at all (its clock catches up, ≤ 0.5 s, when it comes back); `opts.lod: 'idle'` (the enemy preview
// pen: idle loops only) animates through the impostor atlas every 3rd frame; under the view's adaptive load level
// (`ctx.loadLevel()` 1–3, app.js) small / far units (< ~56 px per tile) animate every 2nd frame, and from level 2 on
// every unit does.
//
// Picking is by tile (render/pick.js, user playtest #4 item 1): views carry no hit shapes; `bounds()` is the drawn body's
// screen rect for tooltips and overlays (view.pieceScreenRect). A dragged (lifted) item plate is drawn centred on its
// ground point, i.e. on the pointer (render/app.js).

import { UF, ANIM } from '../../../shared/constants.js';
import { SpineActor } from './spine.js';
import { diamondTexture, shadowTexture, fxAtlas, tierChip, statusTexture, itemTexture, hudRings, ringArc, HUD_DISC, ELEMENT_RING } from './textures.js';
import { COLORS, TIER_COLORS, ENEMY_FRAME, UNIT, PROJ, statusIconKey, statusIconSuppressed } from './style.js';
import { drawCrate, rowDepthKey, ROW_KEY, deviceBoxOf, DEVICE_BOX } from './tiles.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
/** Deploy direction of an ally from a UnitInfo / piece: `dir` (any case), else the legacy `facing` sign. */
export function unitDir(info) {
  const d = typeof info?.dir === 'string' ? info.dir.toUpperCase() : null;
  if (d && DIRS.includes(d)) return d;
  return info?.facing === -1 ? 'LEFT' : 'RIGHT';
}
/**
 * Official size factor of an enemy's model (enemies.json `modelScale`: its battle prefab's scale / the standard 0.27;
 * 1 when absent or unusable) — applied on top of UNIT.modelScale to the skeleton and to the head (bar) height.
 */
export function enemyModelScale(rec) {
  const k = Number(rec && rec.modelScale);
  return Number.isFinite(k) && k > 0.05 && k < 20 ? k : 1;
}
/**
 * Seconds of the death clip of a manifest Spine entry (`anims.die`, else a 'Die' clip, as SpineActor.dieClip; its
 * `animations` duration), 0 when it has none — 131 of the 135 operator Back models (GitHub issue #25).
 */
export function dieClipDur(entry) {
  const durs = entry && entry.animations && typeof entry.animations === 'object' ? entry.animations : null;
  if (!durs) return 0;
  const name = (entry.anims && typeof entry.anims.die === 'string' && entry.anims.die) || 'Die';
  const d = Object.hasOwn(durs, name) ? Number(durs[name]) : NaN;
  return Number.isFinite(d) && d > 0 ? d : 0;
}
/** World step (x = col, y = row) of a direction. */
export const DIR_STEP = Object.freeze({ UP: [0, 1], RIGHT: [1, 0], DOWN: [0, -1], LEFT: [-1, 0] });
const nowMs = () => (globalThis.performance ? globalThis.performance.now() : Date.now());
/** Units with no art in the game data drawn as an ice diamond: 圣聆初雪 S2's frozen protection point (保护目标（冻结状态）, PRTS
 *  无头像; data/assets.json has no avatar or model for it, so the token fallback showed 圣聆初雪's own face) — the marker of a
 *  frozen gate. */
const ICE_TOKENS = new Set(['token_10058_sbell2_icetgt']);
const ICE_FRAME = 0x9fe6ff;
/** How long a view waits for its avatar before showing the image-less placeholder diamond. */
const PIC_WAIT_MS = 400;
/**
 * Waits (ms, real time) before a view loads its Spine model again after the load failed or timed out (assets.js, 20 s)
 * — bounded: after the last one the view keeps its diamond until `retryAssets` (a manifest that arrived late, the tab
 * shown again). Counted from the failure; a hidden tab runs no frames, so nothing is retried while hidden.
 */
export const SPINE_RETRY_MS = Object.freeze([2000, 6000, 15000, 30000]);
/**
 * A Spine load begun while the tab was hidden and still in flight this long (ms, real time) after the tab is shown again
 * is started again (`retryAssets` arms it, `update` fires it; GitHub #68: such a load — a request the hidden tab left
 * hanging — may never settle, and the view stayed the placeholder). A load that finishes within it is never doubled.
 * [ASSUMED] the length: a healthy load finishes within a few seconds once the tab is visible.
 */
export const SPINE_STUCK_MS = 5000;

/** Heights above this count as standing on a raised top (bench pads are the lowest raised tiles, 0.16). */
const RAISED_Z = 0.12;
/** Flying units hover this many tiles above the ground they cross. */
export const FLY_HOVER = 0.32;

/** b.snap `down` entry states (server/sim/constants.js DOWN_STATE). */
export const DOWN_STATE = Object.freeze({ COUNTING: 0, WAIT_DP: 1, WAIT_TILE: 2 });
/** Knocked-down look: model tint and alpha; redeploy ring colours per state; ring size (tiles) and height. */
export const DOWN_LOOK = Object.freeze({
  tint: 0xb4b4b4, alpha: 0.92,
  ring: Object.freeze({ [DOWN_STATE.COUNTING]: 0x4ed8af, [DOWN_STATE.WAIT_DP]: 0xffc600, [DOWN_STATE.WAIT_TILE]: 0xff4b3e }),
  size: 0.42, height: 1.02,
});
/**
 * An enemy drawn with another enemy's web model because its own is only in the local client (manifest `spineAliasOf`
 * + `spineLocal`: 灼热 / 炽焰源石虫 → the plain 源石虫's skeleton, feedback D3 after 0.1.0): a multiply tint toward its own
 * lava colours (orange / red-orange), so it reads apart from the plain slug where the local art was not extracted
 * (research 07 §5.6 "a hue shift") [ASSUMED look]. Never on its official (local) model; status tints win over it.
 */
export const ALIAS_TINT = Object.freeze({ enemy_1305_mhslim: 0xffc48a, enemy_1305_mhslim_2: 0xff9070 });
/**
 * Element gauge row under the bars (see header): the disc's diameter in tiles and its pixel clamp (enemies × `enemy`),
 * the gap under the bars (px). The white bar is as tall as the SP bar and fills the rest of the bars' width. During a
 * 爆发冷却 the refilling bar takes the element's colour (textures.js ELEMENT_RING `tint`) and the disc's alpha pulses
 * between `pulse` and 1 at `pulseHz` (real time).
 */
export const EL_BAR = Object.freeze({ icon: 0.15, min: 8, max: 15, enemy: 0.8, gap: 1, pulse: 0.45, pulseHz: 1.5 });

/**
 * Enemy modes drawn with another clip set of the same skeleton (the `form` of a sim fx — shared/protocol.js fxForm —
 * → UnitView.setForm), per Spine id; the mode's roles override the manifest's (data/assets.json anims), `change` plays
 * once first:
 * - 掠海漂移体 (PRTS: 受晕眩/沉睡/冻结影响后进入爬行模式 — for good) crawls on its *_02 clips after 'Change';
 * - 暴鸰 flies on its bomb-less *_2 clips once its one bomb left (the official prefab's mode S1: Move→Move_2, Idle→Idle_2,
 *   Die→Die_2; user feedback after 0.1.0, D4: the bomb used to stay under the drone — no change clip, the drop is its
 *   Attack clip);
 * - 转译基底·α (user report after 0.1.0, #5): its 2 s change clip A_Die_B / _C / _D, then 寻仇者 B_*, 幽灵 C_* (no attack
 *   clip: it never attacks) or 特战术师 D_* — its manifest roles are the original form's A_Idle / A_Move;
 * - 深池逐火战士 / 精锐战士 / 护卫 (#8): knocked out → 'Die' (the 1 s 重生), the 余烬 on Idle_2 / Move_2 and its death on
 *   Die_2 (also while 'Revive' plays: the ember can still be beaten); standing up again → 'Revive', then the warrior's
 *   manifest clips;
 * - 假想敌：再生: knocked out → A_Die, the 傀儡 on B_Idle / B_Move / B_Die; back → B_Revive, then the A_* manifest clips;
 *   (both: the stand-up clip (`end`) is timed from the 'ember' fx's `dur` to end as the husk stands up — the 'revive'
 *   fx then only lands in the manifest clips);
 * - the leaders' 重生 (sim reborn(): forms 'reborn' → 'form2'): 锏 Revive1, Revive2 held, Revive3, then B_*; 扎罗 A_revive_1 /
 *   _2 / _3, then B_* (its double-hit attack); “复仇者” Revive_Begin / _Loop / _End; 杰斯顿 C1_Die (its 4 s 重生), then
 *   C2_* — their manifests mix the forms (锏 / 扎罗 died on B_Die from the A model, the look of report #5). The closing
 *   clip (`end`) is timed from the 重生's `dur` (the 'telegraph' fx) to end with it, so the second form walks and
 *   attacks on its own clips at once (a view that missed the timing — built mid-重生 — skips the closing clip);
 * - 守墓石像 (forms 'stone' → 'fly'): the statue on Sleep [ASSUMED by name], then the flyer's *_2 clips.
 * - the 傀儡师 operators' <替身> (sim professions.js installDollkeeper: form 'doll' from the start of the switch to it
 *   until the switch back starts, GitHub issue #44): the skeletons draw it on their *_B clips (their own slots — the
 *   本体's are hidden). 归溟幽灵鲨: Start_B fades it in (the 1 s switch), Idle_B (it never attacks), Die_B breaks it
 *   apart over its last second (`end`, timed from the 'substitute' fx's `dur`), the 本体 comes back on Start_2 (`leave`:
 *   played when the form ends); knocked out as the 替身 it collapses on Die_B_2 and stays down so. 风丸: Start_B, then
 *   Idle_B / Attack_B (her 替身 attacks), Die_B; the 本体 comes back on Start. Facing UP: 归溟幽灵鲨's Back skeleton has
 *   only Idle_B and Start_2, 风丸's Start_B, Idle_B and Attack_B — the clips a Back skeleton lacks are skipped; neither has
 *   the 替身's death clip, so a 替身 knocked out lies on the Front model like every knocked-out operator facing UP
 *   (_wantsBack). The sim resets the form right after the 'die' event; the form it died in (`_dieForm`) gives the model
 *   built for the knock-out — and one rebuilt while it is down — the 替身's death clip; it stands up as the 本体.
 * A kind without a clip set of this skeleton (barriers, charges, …) changes nothing. 吉兆飞鳞's 晕眩模式 is its Stun clip.
 */
const loop = (name, via = null) => Object.freeze(via ? { begin: null, loop: name, end: null, via } : { begin: null, loop: name, end: null });
const clipSet = (idle, move, die, attack = null) => Object.freeze({
  idle, deploy: idle, die, move: loop(move),
  attack: attack ? loop(attack, 'attackAny') : null,
  skill: attack ? Object.freeze({ begin: null, loop: attack, end: null, via: 'attack', index: 0, idle: null }) : null,
});
const EMBER = Object.freeze({
  husk: Object.freeze({ change: 'Die', end: 'Revive', next: 'revived', roles: clipSet('Idle_2', 'Move_2', 'Die_2') }),
  revived: Object.freeze({ change: null, roles: Object.freeze({}) }),
});
/** A 重生 held on `hold` (also while the sim reports the rebirth's stun) after `begin`, closing on `end` as the 重生 ends,
 *  then the second form. */
const rebirth = (begin, hold, end, form2 = Object.freeze({})) => Object.freeze({
  reborn: Object.freeze({ change: begin, end, next: 'form2', roles: Object.freeze({ idle: hold, deploy: hold, move: loop(hold), stun: loop(hold), attack: null, skill: null }) }),
  form2: Object.freeze({ change: null, roles: form2 }),
});
const STATUE = Object.freeze({
  stone: Object.freeze({ change: null, roles: Object.freeze({ idle: 'Sleep', deploy: 'Sleep', move: loop('Sleep'), stun: loop('Sleep'), attack: null, skill: null }) }),
  fly: Object.freeze({ change: null, roles: clipSet('Idle_2', 'Move_2', 'Die_2', 'Attack_2') }),
});
const JAKILL2 = clipSet('C2_Idle', 'C2_Move', 'C2_Die', 'C2_Attack');
/** A 傀儡师's 替身 roles: idle `idle`, death `die`, attack `attack` (null: none), no skill clip of its own. */
const dollRoles = (idle, die, attack = null) => Object.freeze({
  idle, deploy: idle, die, attack: attack ? Object.freeze({ begin: null, loop: attack, end: null }) : null, attackDown: null, skill: null,
});
export const FORMS = Object.freeze({
  char_1023_ghost2: Object.freeze({
    doll: Object.freeze({ change: 'Start_B', end: 'Die_B', leave: 'Start_2', roles: dollRoles('Idle_B', 'Die_B_2') }),
  }),
  char_4016_kazema: Object.freeze({
    doll: Object.freeze({ change: 'Start_B', leave: 'Start', roles: dollRoles('Idle_B', 'Die_B', 'Attack_B') }),
  }),
  enemy_1040_bombd: Object.freeze({
    bombed: Object.freeze({
      roles: Object.freeze({
        idle: 'Idle_2', deploy: 'Idle_2', die: 'Die_2',
        move: Object.freeze({ begin: 'Move_Begin_2', loop: 'Move_Loop_2', end: 'Move_End_2' }),
      }),
    }),
  }),
  enemy_2025_syufo: Object.freeze({
    crawl: Object.freeze({ change: 'Change', roles: clipSet('Idle_02', 'Move_02', 'Die_02', 'Attack_02') }),
  }),
  enemy_10081_mpplai: Object.freeze({
    translator_fuchou: Object.freeze({ change: 'A_Die_B', roles: clipSet('B_Idle', 'B_Move', 'B_Die', 'B_Attack') }),
    translator_youling: Object.freeze({ change: 'A_Die_C', roles: clipSet('C_Idle', 'C_Move', 'C_Die') }),
    translator_shushi: Object.freeze({ change: 'A_Die_D', roles: clipSet('D_Idle', 'D_Move', 'D_Die', 'D_Attack') }),
  }),
  enemy_1288_duskls: EMBER,
  enemy_1288_duskls_2: EMBER,
  enemy_1292_duskld: EMBER,
  enemy_9010_acpupp: Object.freeze({
    husk: Object.freeze({ change: 'A_Die', end: 'B_Revive', next: 'revived', roles: clipSet('B_Idle', 'B_Move', 'B_Die') }),
    revived: Object.freeze({ change: null, roles: Object.freeze({}) }),
  }),
  enemy_1525_blkswb: rebirth('Revive1', 'Revive2', 'Revive3', clipSet('B_Idle', 'B_Move', 'B_Die', 'B_Attack')),
  enemy_1535_wlfmster: rebirth('A_revive_1', 'A_revive_2', 'A_revive_3', clipSet('B_Idle', 'B_Move', 'B_Die', 'B_Attack')),
  enemy_1539_reid: rebirth('Revive_Begin', 'Revive_Loop', 'Revive_End'),
  enemy_1516_jakill: Object.freeze({
    reborn: Object.freeze({ change: 'C1_Die', roles: JAKILL2 }),
    form2: Object.freeze({ change: null, roles: JAKILL2 }),
  }),
  enemy_1172_dugago: STATUE,
  enemy_1172_dugago_2: STATUE,
});

/**
 * Keep `obj` in the right layer: the surface container of block row round(y) when it lies on a raised top at
 * height `z` (drawn after that row's blocks), else `fallback`. Reparents only on change.
 */
export function placeOnGround(ctx, obj, fallback, y, z) {
  let layer = fallback;
  if (z > RAISED_Z && ctx.surfaceLayer) layer = ctx.surfaceLayer(Math.round(y)) || fallback;
  if (obj.parent !== layer) layer.addChild(obj);
}

/** Standing height of a world point (tile top incl. raised devices); 0 off-grid / without a stage. */
export function groundZ(ctx, x, y) {
  if (!ctx.heightAt) return 0;
  const h = ctx.heightAt(Math.round(y), Math.round(x));
  return Number.isFinite(h) && h > 0 ? h : 0;
}

/** Enemy Spine models face right by default like operators (verified by eye on Ark-Models skeletons). */
export const ENEMY_MODEL_FACES_LEFT = false;

let _whiteTex = null;
const white = () => (_whiteTex || (_whiteTex = globalThis.PIXI.Texture.WHITE));

function bar(P, parent, color, alpha = 1) {
  const s = new P.Sprite(white());
  s.tint = color;
  s.alpha = alpha;
  s.anchor.set(0, 0.5);
  parent.addChild(s);
  return s;
}

/**
 * Shared context handed to every view by app.js.
 * @typedef {{ P: any, layers: { shadow: any, units: any, bars: any, groundFx: any },
 *   assets: any, cam: () => any, heightAt: (r:number,c:number)=>number, fx: any, time: () => number,
 *   settings: { damageNumbers: boolean, quality: string } }} ViewCtx
 */

export class UnitView {
  /**
   * @param {ViewCtx} ctx
   * @param {object} info UnitInfo-like: { id, uid?, kind, side, defId, spine, avatar, tier, golden, facing, maxHp, boss?, motion?, name? }
   * @param {{ prep?: boolean }} [opts]
   */
  constructor(ctx, info, opts = {}) {
    const P = ctx.P;
    this.ctx = ctx;
    this.P = P;
    this.info = { ...info };
    this.id = info.id;
    this.uid = info.uid ?? null;
    this.prep = !!opts.prep;
    this.lodIdle = opts.lod === 'idle';
    this.culled = false;          // outside the viewport this frame (not animated, not drawn)
    this._offDt = 0;              // animation time skipped while culled
    this._far = false;            // small on screen (adaptive LOD, with hysteresis)
    this.isEnemy = info.side === 'enemy';
    this.isBoss = !!info.boss;
    // enemies: the official prefab's size factor (1 for operators, summons and enemies at the standard size)
    this.modelK = this.isEnemy ? enemyModelScale(ctx.lookupDef ? ctx.lookupDef(info) : null) : 1;
    this.isToken = info.kind === 'token';
    this.golden = !!info.golden;
    this.tier = clamp(Number(info.tier) || 1, 1, 6);
    this.x = Number(info.x) || 0; this.y = Number(info.y) || 0; this.z = 0;
    this.zTarget = null;          // battle: standing height the feet ease towards (tile top under the unit)
    this.flying = info.motion === 'FLY';
    this.hover = 0;               // flying: body height above the ground under it
    this.dir = this.isEnemy ? null : unitDir(info);
    // whether the direction is known (UnitInfo / piece `dir`), not just the legacy ±1: battle and scouting views show
    // the ground wedge only then (a derived RIGHT would mislabel an UP / DOWN operator)
    this.hasDir = !this.isEnemy && typeof info.dir === 'string' && DIRS.includes(info.dir.toUpperCase());
    this.facing = this.dir === 'LEFT' ? -1 : 1;
    this.visFacing = this.isEnemy ? -1 : this.facing;
    this.hp = Number(info.maxHp) || 1; this.maxHp = Number(info.maxHp) || 1; this.ghostHp = this.hp;
    this.sp = 0; this.spMax = 0;
    this.flags = 0; this.anim = ANIM.IDLE;
    this.statuses = new Set();
    this.alive = true;
    this.dying = 0;               // seconds left of the death fade (0 = not dying)
    this.dieT = 0;                // seconds since die() (the Die clip's clock; a late Spine model catches up)
    this.remove = false;          // set when the death fade ended (owner removes the view)
    this.down = null;             // knocked out, waiting to redeploy: { until, total, state } (setDown) — no fade meanwhile
    this.gameT = 0;               // battle game time of the frame (render clock), for the redeploy ring's countdown and the element bar's refill
    this.el = null; this.elFill = 0; this.elUntil = 0; this.elDur = 0;   // shown element gauge (sync)
    this._elBar = null;           // { root, disc, bg, fill } sprites of the element gauge row, built on first use
    this._downRing = null;        // { disc, track, arc, text } sprites, built on first use
    this.alpha = 1; this.fadeIn = this.prep ? 1 : 0;
    this.lunge = 0; this.lungeDir = { x: 1, y: 0 };
    this.flash = 0;
    this.bob = Math.random() * Math.PI * 2;
    this.hovered = false; this.dimmed = false; this.lift = 0;
    this.lastAtk = -1; this.atkInterval = defaultInterval(ctx, info);
    this.shake = 0;
    this.screen = { x: 0, y: 0, s: 1, top: 0 };
    this.destroyed = false;
    this.form = typeof info.form === 'string' ? info.form : null;   // the unit's model form: an enemy's mode, a 傀儡师's 替身 (setForm, FORMS)
    this._dieForm = null;         // the form it died in (die): a model built while it lies down shows that form's death

    // --- display objects
    this.shadow = new P.Sprite(ctx.shadowTex || shadowTexture());
    this.shadow.anchor.set(0.5);
    this.shadow.alpha = 0.55;
    ctx.layers.shadow.addChild(this.shadow);

    this.root = new P.Container();
    this.root.sortableChildren = false;
    ctx.layers.units.addChild(this.root);

    const fx = fxAtlas();
    this.aura = null;
    if (this.golden) {
      this.aura = new P.Sprite(fx.tex.glow);
      this.aura.anchor.set(0.5, 0.62);
      this.aura.tint = 0xffc94a;
      this.aura.blendMode = P.BLEND_MODES.ADD;
      this.root.addChild(this.aura);
    }
    this.body = new P.Container();
    this.root.addChild(this.body);
    this.fallback = new P.Sprite(P.Texture.EMPTY);
    this.fallback.anchor.set(0.5, 1);
    this.body.addChild(this.fallback);
    this.actor = null;
    this.spineReady = false;
    this._modelDirty = false;            // died / stood up since the last frame: update() checks Front ⇄ Back (_syncModel)
    this._spineBusy = false;             // a Spine load of this view is in flight
    this._spineTries = 0;                // failed loads since the last model (SPINE_RETRY_MS)
    this._retryAt = 0;                   // when the next retry is due (ms, performance clock; 0 = none)
    this._spineHidden = false;           // the load in flight began while the tab was hidden (SPINE_STUCK_MS)
    this._stuckAt = 0;                   // when that load is started again unless it settled (ms; 0 = none)
    this.baseTint = 0xffffff;            // the drawn model's own tint (ALIAS_TINT), under the status tints

    this.hud = new P.Container();
    ctx.layers.bars.addChild(this.hud);
    this._buildHud();

    this.facingArrow = null;
    this._loadPicture();
    this._loadSpine();
  }

  // ---- loading ---------------------------------------------------------------------------------------------

  _frameColor() {
    if (this.isEnemy) return this.isBoss ? ENEMY_FRAME.boss : this.tier >= 2 ? ENEMY_FRAME.elite : ENEMY_FRAME.normal;
    if (ICE_TOKENS.has(this.info.defId)) return ICE_FRAME;
    if (this.golden) return 0xffc600;
    return TIER_COLORS[this.tier] || TIER_COLORS[1];
  }

  // The fallback portrait (avatar in a rarity diamond, a 160×160 canvas cached by textures.js) is built lazily, on
  // the first frame it is actually visible: never for a unit whose Spine model is ready before that, and never as
  // an image-less placeholder that the avatar replaces a moment later (the placeholder only shows when the avatar
  // is missing or still loading after PIC_WAIT_MS).
  _loadPicture() {
    const a = this.ctx.assets;
    // (an ICE_TOKENS unit takes no picture: the token fallback would be its owner's face — assets.js tokenAvatarUrl)
    const url = ICE_TOKENS.has(this.info.defId) ? null : a && (a.picture ? a.picture(this.info.avatar) || a.picture(this.info.defId) || a.picture(this.info.spine) : null);
    this._pic = { key: String(this.info.avatar || this.info.defId || 'unknown'), color: this._frameColor(), img: null, state: 'none', shown: null, t0: nowMs() };
    if (!url || !a.image) return;
    const cached = typeof a.imageNow === 'function' ? a.imageNow(url) : null;
    if (cached) { this._pic.img = cached; this._pic.state = 'img'; return; }
    this._pic.state = 'wait';
    const pic = this._pic;
    Promise.resolve().then(() => a.image(url)).then((img) => {
      if (img) { pic.img = img; pic.state = 'img'; } else pic.state = 'none';
    }, () => { pic.state = 'none'; });
  }

  /** Put the right diamond on the fallback sprite (called while the fallback is visible). */
  _ensurePicture() {
    const pic = this._pic;
    if (!pic || this.destroyed) return;
    let want = pic.state === 'img' ? 'img' : 'placeholder';
    if (pic.state === 'wait' && nowMs() - pic.t0 < PIC_WAIT_MS) want = null;
    if (!want || pic.shown === want) return;
    this.fallback.texture = diamondTexture(pic.key, want === 'img' ? pic.img : null, pic.color, { enemy: this.isEnemy, golden: this.golden, ice: ICE_TOKENS.has(this.info.defId) });
    pic.shown = want;
  }

  /** @param {boolean} [retry] load again even after a remembered failure (assets.js acquire `{ retry }`) */
  _loadSpine(retry = false) {
    const a = this.ctx.assets;
    if (!a || !a.spineEntry || !a.spine) return;
    const id = this.info.spine || this.info.defId;
    // Front/Back rule (research 07 §5.5 / 09 §1.2): Front facing right/down (mirrored for left), Back facing up — while
    // standing (a knocked-out operator lies with the model that has a fall: _wantsBack).
    const back = this._wantsBack();
    const entry = id ? a.spineEntry(id, { back }) : null;
    if (!entry || this.ctx.settings?.quality === 'low' && this.isEnemy && !this.isBoss && this.ctx.crowded?.()) return;
    this.entryBack = back;
    this._acquireSpine(entry, id, retry);
  }

  /**
   * Re-resolve what this view could not draw yet (public issue #8 item 5): the picture when it has none (no avatar URL —
   * the asset manifest arrived after the view was built — or the image failed) and, at once, the Spine model when none
   * is shown and none is loading (no manifest entry then, or a load that failed / timed out). render/app.js calls it for
   * every view when a manifest arrives (assets.js onChange) and when the tab is shown again. A load still in flight that
   * began while the tab was hidden gets SPINE_STUCK_MS from now (the tab visible) to finish, then `update` starts it again
   * (GitHub #68). Nothing to do otherwise.
   */
  retryAssets() {
    if (this.destroyed) return;
    if (!this._pic || this._pic.state === 'none') this._loadPicture();
    if (this.actor) return;
    if (!this._spineBusy) { this._retryAt = 0; this._loadSpine(true); return; }
    if (this._spineHidden && !this._stuckAt && !globalThis.document?.hidden) this._stuckAt = nowMs() + SPINE_STUCK_MS;
  }

  /**
   * Load `entry` and show it. Every acquire is paired with exactly one release: a superseded / failed / post-destroy
   * load releases its own entry; the displayed model's entry (`_actorEntry`) is released when that model is replaced or
   * destroyed. A model that fails to load falls back to the entry's `fallback` (an optional local-client model,
   * assets.js spineEntry: DESIGN §13) when it names one; otherwise the view keeps its fallback diamond and — while no
   * model is shown — loads again after SPINE_RETRY_MS (a timed-out or failed download used to stay a diamond for good).
   */
  _acquireSpine(entry, id, retry = false) {
    const a = this.ctx.assets;
    this.entry = entry;
    const req = this._spineReq = (this._spineReq || 0) + 1;
    this._spineBusy = true;
    this._spineHidden = !!globalThis.document?.hidden;
    this._stuckAt = 0;
    a.spine.acquire(entry, retry ? { retry: true } : undefined).then((data) => {
      if (req === this._spineReq) { this._spineBusy = false; this._stuckAt = 0; }
      if (this.destroyed || req !== this._spineReq) { this._releaseEntry(entry); return; }
      this._spineTries = 0;
      this._retryAt = 0;
      let actor = null;
      try {
        actor = new SpineActor(data, entry);
        actor.setSkillIndex(this.info.skillIndex);
        // enemies play their attack clip once per attack, then walk on (GitHub #58: the sim stands them for that clip)
        actor.clipPerAttack = this.isEnemy;
      } catch (err) {
        console.warn('[render] spine build failed', id, err?.message || err);
        this._releaseEntry(entry);
        return;
      }
      // a Front ⇄ Back swap (setDir, or knocked out / standing again: _syncModel) replaces the previous model in place:
      // no fallback diamond in between; a deploy clip it was playing goes on on the new model (an operator facing UP
      // redeployed: its Back model takes over from the Front model it lay down with)
      const swap = !!this.actor;
      const deployed = swap && this.alive ? this.actor.deployElapsed() : null;
      if (swap) this._dropActor();
      this.actor = actor;
      this._actorEntry = entry;
      this.baseTint = (!entry.local && ALIAS_TINT[id]) || 0xffffff;   // the web alias of a local-only model
      this.body.addChild(this.actor.spine);
      this.spineReady = true;
      this.swapT = swap ? 1 : 0;
      this.actor.spine.alpha = swap ? 1 : 0;
      // a mode the unit is already in (a model built or rebuilt after the change): its clip set, no change clip — a dead
      // one lies in the form it died in (a 替身 knocked out: the sim resets the form at once, but the Front model it lies
      // down with facing UP, §22.1, is built a frame later; a model rebuilt while it is down)
      const f = this._formSpec() || (this.alive ? null : this._dieForm);
      if (f) this.actor.setForm(f.roles);
      // replay current state (a dead model resumes its Die clip where it would be — a knocked-down one holds its end)
      if (!this.alive) {
        const d = this.actor.die();
        const at = Math.min(d, this.dieT * (this.ctx.animRate?.() || 1));
        if (at > 0) this.actor.update(at);
      } else {
        if (this.flags & UF.SKILL) this.actor.setSkill(true);
        this.actor.setBase(this._baseFromAnim());
        if (deployed != null) { this.actor.deploy(); if (deployed > 0) this.actor.update(deployed); }
      }
    }, () => {
      if (req === this._spineReq) { this._spineBusy = false; this._stuckAt = 0; }
      this._releaseEntry(entry);
      if (this.destroyed || req !== this._spineReq) return;
      if (entry.fallback) { this._acquireSpine(entry.fallback, id, retry); return; }
      // keep the fallback diamond (or the model already shown: a failed Front ⇄ Back swap) — and try again later
      if (!this.actor && this._spineTries < SPINE_RETRY_MS.length) this._retryAt = nowMs() + SPINE_RETRY_MS[this._spineTries++];
    });
  }

  _formSpec() {
    return this.form ? FORMS[this.info.spine || this.info.defId]?.[this.form] || null : null;
  }

  /**
   * The unit changed mode (the `form` of a sim fx — shared/protocol.js fxForm; `fx` = that fx's extra): the mode's clip
   * set (FORMS) after its change clip, and its closing clip (`end`, landing in the `next` form's clips) timed to end
   * `fx.dur` game s later — the unit is still in this mode while it plays (an ember can be beaten in its last second),
   * so this mode's death clip stays until the next mode's fx; null goes back to the manifest clips (through the old
   * mode's `leave` clip when it has one: a 替身's 本体 coming back); a kind this skeleton has no clip set for (an arts
   * barrier, a broken charge …) changes nothing. Kept for a model built later.
   */
  setForm(kind, fx = null) {
    const k = typeof kind === 'string' ? kind : null;
    if (k === this.form) return;
    if (k && !FORMS[this.info.spine || this.info.defId]?.[k]) return;
    const prev = this._formSpec();
    this.form = k;
    this.info.form = k;
    const f = this._formSpec();
    if (!this.actor) return;
    const dur = fx && Number(fx.dur);
    let next = f && f.next ? FORMS[this.info.spine || this.info.defId]?.[f.next]?.roles || null : null;
    if (next && typeof f.roles.die === 'string') next = { ...next, die: f.roles.die };
    // an fx handed out late (render/app.js: a stall, a hidden tab) skips a change clip that would already have ended
    const late = fx && Number(fx.late) > 0 ? Number(fx.late) : 0;
    const change = f && f.change && !(late > 0 && late >= (this.actor.dur?.(f.change) ?? Infinity)) ? f.change : null;
    if (f) this.actor.setForm(f.roles, change, f.end && dur > 0 ? { clip: f.end, in: dur, roles: next } : null);
    else if (prev) this.actor.setForm(null, prev.leave && !(late > 0 && late >= (this.actor.dur?.(prev.leave) ?? Infinity)) ? prev.leave : null);
  }

  // ---- HUD -------------------------------------------------------------------------------------------------

  _buildHud() {
    const P = this.P, h = this.hud;
    this.hpBg = bar(P, h, COLORS.hpBack, 0.85);
    this.hpGhost = bar(P, h, COLORS.hpGhost, 0.9);
    this.hpFill = bar(P, h, this.isEnemy ? (this.isBoss ? COLORS.hpBoss : COLORS.hpEnemy) : COLORS.hpAlly);
    this.shieldBar = bar(P, h, COLORS.shield, 0.95);
    this.spBg = bar(P, h, COLORS.hpBack, 0.85);
    this.spFill = bar(P, h, COLORS.sp);
    this.spGlow = new P.Sprite(fxAtlas().tex.glow);
    this.spGlow.anchor.set(0.5);
    this.spGlow.tint = COLORS.spReady;
    this.spGlow.blendMode = P.BLEND_MODES.ADD;
    h.addChild(this.spGlow);
    // nothing shows until the first HUD update decides (a culled or prep view never draws bars)
    for (const b of [this.hpBg, this.hpGhost, this.hpFill, this.shieldBar, this.spBg, this.spFill, this.spGlow]) b.visible = false;
    this.chip = null;
    // operators only: summon tokens have no tier (hand and field alike)
    if (!this.isEnemy && !this.isToken && this.info.kind !== 'device') {
      this.chip = new P.Sprite(tierChip(this.tier, this.golden));
      this.chip.anchor.set(0.5);
      h.addChild(this.chip);
    }
    this.icons = [];
    for (let i = 0; i < 4; i++) {
      const s = new P.Sprite(P.Texture.EMPTY);
      s.anchor.set(0.5);
      s.visible = false;
      h.addChild(s);
      this.icons.push(s);
    }
    this.blockIcon = new P.Sprite(statusTexture('blocked'));
    this.blockIcon.anchor.set(0.5);
    this.blockIcon.visible = false;
    this.ctx.layers.groundFx.addChild(this.blockIcon);
    this.countText = null;
    this.itemPips = [];
  }

  /** Show a stack count (token stacks in the hand) — BitmapText-free: a tiny canvas-less chip via Text. */
  setCount(n) {
    const P = this.P;
    if (!(n > 1)) { if (this.countText) this.countText.visible = false; return; }
    if (!this.countText) {
      this.countText = new P.Text('', { fontFamily: 'Bender, Oxanium, sans-serif', fontSize: 22, fontWeight: '700', fill: '#ffffff', stroke: '#0b0f0e', strokeThickness: 5 });
      this.countText.anchor.set(0.5);
      this.hud.addChild(this.countText);
    }
    this.countText.text = `×${n}`;
    this.countText.visible = true;
  }

  /** Equipped item pips (prep): list of item icon URLs. */
  setItems(urls) {
    const P = this.P;
    const list = Array.isArray(urls) ? urls.slice(0, 2) : [];
    while (this.itemPips.length > list.length) this.itemPips.pop().destroy();
    list.forEach((u, i) => {
      let s = this.itemPips[i];
      if (!s) { s = new P.Sprite(P.Texture.EMPTY); s.anchor.set(0.5); this.hud.addChild(s); this.itemPips[i] = s; }
      if (s._url === u) return;
      s._url = u;
      const a = this.ctx.assets;
      s.texture = itemTexture(u || 'none', null, 0x4ed8af);
      if (u && a?.image) a.image(u).then((img) => { if (!s.destroyed && s._url === u) s.texture = itemTexture(u, img, 0x4ed8af); }, () => {});
    });
  }

  // ---- state input ---------------------------------------------------------------------------------------

  _baseFromAnim() {
    if (this.anim === ANIM.STUN || (this.flags & (UF.STUNNED | UF.FROZEN | UF.SLEEP))) return 'stun';
    if (this.anim === ANIM.MOVE) return 'move';
    return 'idle';
  }

  /** Apply an interpolated sample (render/interp.js); `t` = the render clock's game time (ring countdowns). */
  sync(s, t) {
    if (!s) return;
    if (Number.isFinite(t)) this.gameT = t;
    // the element gauge shown (b.snap `elem`): element, fill 0..1, cooldown end (game s) and length
    this.el = typeof s.el === 'string' ? s.el : null;
    this.elFill = this.el ? s.elFill || 0 : 0; this.elUntil = this.el ? s.elUntil || 0 : 0; this.elDur = this.el ? s.elDur || 0 : 0;
    this.x = s.x; this.y = s.y;
    this.flying = !!(s.flags & UF.FLYING) || this.info.motion === 'FLY';
    // ground enemies only ever walk low tiles (a rounding step onto a block edge must not pop them up)
    const gz = this.isEnemy && !this.flying ? 0 : groundZ(this.ctx, s.x, s.y);
    if (this.zTarget == null) this.z = gz;
    this.zTarget = gz;
    if (s.maxHp > 0) this.maxHp = s.maxHp;
    const hp = clamp(s.hp, 0, this.maxHp);
    if (hp < this.hp - 0.5 && this.isBoss) this.shake = 0.25;
    this.hp = hp;
    this.sp = s.sp; this.spMax = s.spMax;
    const prevFlags = this.flags;
    this.flags = s.flags | 0;
    this.anim = s.anim | 0;
    if (this.isEnemy && Math.abs(s.vx) > 0.08) this.visFacing = s.vx < 0 ? -1 : 1;
    if ((prevFlags ^ this.flags) & UF.SKILL) this.setSkill(!!(this.flags & UF.SKILL));
    if (this.anim === ANIM.DIE && this.alive) this.die();
    if (this.actor && this.alive) this.actor.setBase(this._baseFromAnim());
  }

  setWorld(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }

  setFacing(f) {
    if (this.isEnemy) { this.facing = f === -1 ? -1 : 1; return; }
    // the legacy ±1 only speaks about left / right: an UP / DOWN operator keeps its direction
    if (f === -1) this.setDir('LEFT');
    else if (this.dir === 'LEFT') this.setDir('RIGHT');
  }

  /**
   * Whether this unit should show its Back model: facing UP and a Back model exists — while it stands. A dead or
   * knocked-out one keeps the Back model only when that skeleton has a fall of its own (4 of the 135 Back models); the
   * others have no Die clip, so the Front model shows the fall and the held knocked-down pose (GitHub issue #25: the
   * Back model went on with its attack loop under the redeploy ring) [ASSUMED: no source says which model the official
   * client lies down with; a Back skeleton without a Die clip cannot show a fall].
   */
  _wantsBack() {
    const a = this.ctx.assets;
    const id = this.info.spine || this.info.defId;
    if (this.isEnemy || this.dir !== 'UP' || !id || !a || typeof a.hasBack !== 'function' || !a.hasBack(id)) return false;
    return this.alive || dieClipDur(typeof a.spineEntry === 'function' ? a.spineEntry(id, { back: true }) : null) > 0;
  }

  /**
   * Load the model the unit wants when it is not the one shown or loading (Front ⇄ Back: its direction, or it went down /
   * stood up again). A swap replaces the model in place (_acquireSpine: no diamond in between; a fall or a deploy clip
   * goes on where it is). Nothing before the first model was asked for (no manifest entry yet).
   */
  _syncModel() {
    if (this.entry && this._wantsBack() !== !!this.entryBack) this._loadSpine();
  }

  /**
   * Re-orient an operator / summon (UP|RIGHT|DOWN|LEFT, any case; the direction wheel's live preview and the stored
   * m.private `dir`). Mirrors for LEFT, swaps to the Back model for UP (and back) when the model differs.
   */
  setDir(dir) {
    if (this.isEnemy || this.destroyed) return;
    const d = unitDir({ dir, facing: this.facing });
    if (typeof dir !== 'string' || d === this.dir) return;
    this.dir = d;
    this.info.dir = d;
    this.hasDir = true;
    this.facing = d === 'LEFT' ? -1 : 1;
    this.visFacing = this.facing;
    if (this.imp) this.imp.dirty = true;
    this._syncModel();
  }

  _releaseEntry(entry) {
    try { this.ctx.assets?.spine?.release(entry); } catch { /* ignore */ }
  }

  /** Destroy the current Spine actor (and its impostor) and release its asset entry (model swap / destroy). */
  _dropActor() {
    if (this.imp) {
      try { if (this.imp.slot) this.ctx.impostors?.free(this.imp.slot); this.imp.sprite.destroy(); if (this.imp.rt) this.imp.rt.destroy(true); } catch { /* ignore */ }
      this.imp = null;
    }
    this._box = null;
    this._tint = undefined;   // the next model gets the current tint on its first frame (a knocked-down one its grey)
    const old = this.actor;
    this.actor = null;
    this.spineReady = false;
    if (old) { try { old.destroy(); } catch { /* ignore */ } }
    if (this._actorEntry) this._releaseEntry(this._actorEntry);
    this._actorEntry = null;
  }

  /** An attack was made (b.ev 'atk'). `target` = view or null. */
  onAttack(target, now, kind) {
    if (!this.alive) return;
    // a one-off cast (PROJ[kind].once: 暴鸰's bomb drop) is no attack rhythm: its clip plays once at its own speed
    const once = !!PROJ[kind]?.once;
    if (!once) {
      if (this.lastAtk >= 0) {
        const d = now - this.lastAtk;
        if (d > 0.05 && d < 6) this.atkInterval = this.atkInterval * 0.6 + d * 0.4;
      }
      this.lastAtk = now;
    }
    if (target && !this.isEnemy && this.info.kind !== 'device') {
      // operators keep their deploy direction (research 09 §1.2); enemies may turn towards their target
    } else if (target && this.isEnemy) {
      const dx = target.x - this.x;
      if (Math.abs(dx) > 0.1) this.visFacing = dx < 0 ? -1 : 1;
    }
    if (target) {
      const dx = target.x - this.x, dy = target.y - this.y, len = Math.hypot(dx, dy) || 1;
      this.lungeDir.x = dx / len; this.lungeDir.y = dy / len;
    }
    this.lunge = 1;
    if (this.actor) this.actor.attack(this.atkInterval, once); // game seconds: the actor's clock runs in game time
    if (this.imp) this.imp.dirty = true;
  }

  /**
   * An attack by this unit is `lead` game seconds ahead in the snapshot buffer: start the Spine attack wind-up now
   * so the strike frame lines up with the attack. True once started (then stop calling for that attack). `kind` = the
   * 'atk' projKind (a one-off cast winds up at the clip's own speed).
   */
  windUp(lead, kind) {
    if (!this.alive || !this.actor || !this.spineReady) return false;
    const ok = this.actor.windUp(this.atkInterval, lead, !!PROJ[kind]?.once);
    if (ok && this.imp) this.imp.dirty = true;
    return ok;
  }

  onHit() { this.flash = 1; }

  setSkill(on) {
    if (on) this.statuses.add('skill'); else this.statuses.delete('skill');
    if (this.actor) this.actor.setSkill(on);
  }

  onDeploy() {
    this.fadeIn = 0;
    if (!this.alive) this.revive();
    if (this.actor) this.actor.deploy();
  }

  onStatus(key, on) {
    if (typeof key !== 'string') return;
    if (on) this.statuses.add(key); else this.statuses.delete(key);
  }

  /**
   * The unit died: its Die clip plays, then it fades (unless it stays down, setDown). `instant`: it starts on the held
   * end of the clip — a unit that is already down (a field joined mid-battle, an operator entering 联防 knocked out).
   * An operator facing UP whose Back model has no Die clip (GitHub issue #25) falls with its Front model: the swap is
   * made by this frame's update (`_modelDirty` → _syncModel, after every event and snapshot of the frame, so a death
   * and a redeploy in one frame — a 突袭 jump, a 不屈 revive, a backlog after a hidden tab — load nothing); meanwhile the
   * Back model holds still (SpineActor.die), and the Front model's Die clip times the fade. The form it dies in
   * (`_dieForm`: a 傀儡师's 替身, which the sim resets right after the 'die' event) gives that model — and any built while
   * it lies down — its death clip, until it stands up again.
   */
  die(instant = false) {
    if (!this.alive) return;
    this.alive = false;
    this._modelDirty = true;
    this._dieForm = this._formSpec();
    let d = this.actor ? this.actor.die() : 0;
    if (this.actor && !d) d = this._fallDur();
    const rate = this.ctx.animRate?.() || 1;
    this.dieT = 0;
    this.dying = clamp(d / rate, 0.35, 1.6) + 0.55;
    this.dieDur = this.dying;
    if (instant) { this.dieT = 30; if (this.actor) this.actor.update(30); }
  }

  /** Seconds of the fall of the model the unit wants now (its manifest entry's Die clip), 0 without one. */
  _fallDur() {
    const a = this.ctx.assets;
    const id = this.info.spine || this.info.defId;
    return a && typeof a.spineEntry === 'function' && id ? dieClipDur(a.spineEntry(id, { back: this._wantsBack() })) : 0;
  }

  /** Standing again (a redeploy, a revive): an operator facing UP gets its Back model back (this frame's update). */
  revive() {
    this.alive = true;
    this._modelDirty = true;
    // a model built while it lay in a form's death pose (_dieForm) stands up on the unit's own clips
    if (this._dieForm && this.actor && !this._formSpec()) this.actor.setForm(null);
    this._dieForm = null;
    this.dying = 0; this.remove = false; this.alpha = 1;
    this.down = null;
    this.hp = this.maxHp; this.ghostHp = this.hp;
    if (this.actor) this.actor.revive();
  }

  /**
   * Knocked-out state (b.snap `down` entry `[id, respawnAt, respawnTime, state, row?, col?]`, render/interp.js downAt)
   * or null; `t` = the render clock's game time. A living view is knocked down first (its Die clip plays; `instant`: a
   * view made for a unit that is already down — a field joined mid-battle — starts on the held end of the clip). While
   * down the view never fades: the Die clip's last frame stays on the tile the entry names (the view moves there when
   * it stands elsewhere: a body that went back to its home, a view built from the unit's deploy info) under the
   * redeploy ring. null on a view still down (it left for good) starts the fade; the redeploy itself comes through
   * onDeploy / revive.
   */
  setDown(d, t, instant = false) {
    if (Number.isFinite(t)) this.gameT = t;
    if (!d) {
      if (!this.down) return;
      this.down = null;
      if (!this.alive) { this.dying = 0.55; this.dieDur = 0.55; }
      return;
    }
    if (this.alive) this.die(instant);
    if (Number.isInteger(d[4]) && Number.isInteger(d[5]) && (this.x !== d[5] || this.y !== d[4])) {
      this.x = d[5]; this.y = d[4];
      this.z = this.zTarget = groundZ(this.ctx, this.x, this.y);
    }
    if (this.zTarget == null) this.z = this.zTarget = groundZ(this.ctx, this.x, this.y); // never synced: its tile top
    this.dying = 0; // no death fade while down
    const dn = this.down || (this.down = { until: 0, total: 0, state: DOWN_STATE.COUNTING });
    dn.until = Number(d[1]) || 0;
    dn.total = Math.max(0, Number(d[2]) || 0);
    dn.state = d[3] | 0;
  }

  // ---- per frame -------------------------------------------------------------------------------------------

  /** @param {number} dt real seconds @param {any} cam camera @param {number} t real clock */
  update(dt, cam, t) {
    if (this.destroyed) return;
    const P = this.P;
    // the model for the state the frame's events and snapshot left (Front ⇄ Back when it went down / stood up: die, revive)
    if (this._modelDirty) { this._modelDirty = false; this._syncModel(); }
    // a failed / timed-out model load is tried again once its wait is over (SPINE_RETRY_MS; frames only: never hidden)
    if (this._retryAt && nowMs() >= this._retryAt) { this._retryAt = 0; if (!this.actor && !this._spineBusy) this._loadSpine(true); }
    // a load begun in a hidden tab and still in flight SPINE_STUCK_MS after it came back: started again (GitHub #68)
    if (this._stuckAt && nowMs() >= this._stuckAt) {
      this._stuckAt = 0;
      if (!this.actor && this._spineBusy && this.entry) { this._spineHidden = false; this.ctx.assets?.spine?.restart?.(this.entry); }
    }
    if (this.zTarget != null && this.z !== this.zTarget) {
      const d = this.zTarget - this.z;
      this.z = Math.abs(d) < 1e-3 ? this.zTarget : this.z + d * Math.min(1, dt * 12);
    }
    const hoverTo = this.flying && this.alive ? FLY_HOVER : 0;
    if (this.hover !== hoverTo) this.hover = Math.abs(hoverTo - this.hover) < 1e-3 ? hoverTo : this.hover + (hoverTo - this.hover) * Math.min(1, dt * 6);
    const p = cam.project(this.x, this.y, this.z + this.hover + this.lift, this.screen);
    const s = p.s;
    // fades
    if (this.fadeIn < 1) this.fadeIn = Math.min(1, this.fadeIn + dt * 4);
    let alpha = this.fadeIn;
    if (this.down) {
      // knocked down: the Die clip ends and holds its last frame (the actor keeps its clock), no fade
      this.dieT += dt;
      alpha *= DOWN_LOOK.alpha;
    } else if (this.dying > 0) {
      this.dieT += dt;
      this.dying -= dt;
      const tail = 0.55;
      if (this.dying < tail) alpha *= Math.max(0, this.dying / tail);
      if (this.dying <= 0) { this.dying = 0; this.remove = true; alpha = 0; }
    }
    if (this.flags & UF.STEALTH) alpha *= 0.45;
    if (this.dimmed) alpha *= 0.35;
    this.alpha = alpha;

    // body placement — the 0.12-tile jolt toward the target on an attack stands in for the avatar diamond's missing attack
    // clip; a Spine model plays its own and keeps its place (GitHub #61: every ranged attack shoved the model aside)
    const lungeK = this.lunge > 0 && !(this.actor && this.spineReady) ? Math.sin(this.lunge * Math.PI) * 0.12 : 0;
    this.lunge = Math.max(0, this.lunge - dt * 5);
    const lx = this.lungeDir.x * lungeK, ly = this.lungeDir.y * lungeK;
    let bx = p.x, by = p.y;
    if (lungeK) { const q = cam.project(this.x + lx, this.y + ly, this.z + this.hover + this.lift, LG_P); bx = q.x; by = q.y; }
    this.root.position.set(bx, by);
    this.root.alpha = alpha;
    this.root.zIndex = unitDepthKey(cam, this.x, this.y, this.lift);
    // off-screen: nothing to animate or draw (bounds / hit-testing still follow `screen`)
    if (this._cull(bx, by, s, dt)) return;
    const flip = this.isEnemy ? (ENEMY_MODEL_FACES_LEFT ? -this.visFacing : this.visFacing) : this.visFacing;

    // shadow (on a raised top it is drawn with that block row, else in the shadow layer under everything)
    placeOnGround(this.ctx, this.shadow, this.ctx.layers.shadow, this.y, this.z);
    const sh = cam.project(this.x, this.y, this.z, SH_P);
    this.shadow.position.set(sh.x, sh.y);
    const shw = s * (this.isBoss ? 1.6 : 0.95) / this.shadow.texture.width;
    this.shadow.scale.set(shw, shw * (this.shadow.texture === shadowTexture() ? 1 : 1.05));
    this.shadow.alpha = 0.5 * alpha * (this.lift > 0 ? 0.6 : 1);

    // model / fallback
    const spineShown = this.actor && this.spineReady;
    if (spineShown) {
      if (this.swapT < 1) this.swapT = Math.min(1, this.swapT + dt * 5);
      this.fallback.alpha = 1 - this.swapT;
      this.fallback.visible = this.swapT < 1;
      const sc = s * UNIT.modelScale * this.modelK;
      const flashK = this.flash > 0 ? this.flash : 0;
      let tint = this.baseTint;
      if (this.down) tint = DOWN_LOOK.tint;
      else if (this.flags & UF.FROZEN) tint = 0x9fd4ff;
      else if (this.flags & UF.COLD) tint = 0xcfe6ff;
      if (flashK > 0) tint = mixTint(tint, 0xff8a80, flashK * 0.8);
      let animDt = dt * (this.ctx.animRate?.() || 1);
      if (this._offDt > 0) { animDt += Math.min(0.5, this._offDt); this._offDt = 0; }
      let interval = this.ctx.impostorInterval ? this.ctx.impostorInterval() : 0;
      if (this.lodIdle) interval = Math.max(interval, 3);
      const lvl = this.ctx.loadLevel ? this.ctx.loadLevel() : 0;
      if (lvl > 0) {
        this._far = this._far ? s < 60 : s < 52;
        if (lvl >= 2 || this._far) interval = Math.max(interval, 2);
      }
      if (this.actor.clipped) {
        const clip = this.ctx.clipAllowed ? this.ctx.clipAllowed() : true;
        this.actor.setClipping(clip);
        if (clip && this.ctx.impostors) interval = Math.max(1, interval);
      }
      if (interval > 0 && this.ctx.renderer) {
        this._updateImpostor(sc, flip, tint, animDt, interval);
      } else {
        if (this.imp) this._leaveImpostor();
        this.actor.spine.alpha = this.swapT;
        this.actor.spine.scale.set(sc * flip, sc);
        this.actor.update(animDt);
        if (this._tint !== tint) { this._tint = tint; this.actor.spine.tint = tint; }
      }
    }
    // the diamond is only needed while no model shows (a cross-fade keeps whatever diamond was already up)
    if (!spineShown) this._ensurePicture();
    if (!spineShown || this.swapT < 1) {
      const size = s * UNIT.diamond * (this.isBoss ? 1.5 : 1);
      const bob = this.alive ? Math.sin(t * 2.4 + this.bob) * s * 0.03 : 0;
      this.fallback.scale.set(size / 160);
      this.fallback.position.set(0, -s * 0.08 + bob);
      this.fallback.tint = this.down ? DOWN_LOOK.tint : this.flash > 0 ? mixTint(0xffffff, 0xff8a80, this.flash) : (this.flags & UF.FROZEN ? 0x9fd4ff : 0xffffff);
      if (!this.alive) this.fallback.alpha = Math.max(0, this.fallback.alpha);
    }
    this.flash = Math.max(0, this.flash - dt * 6);

    // facing chevron on the ground, like the original's orange › (research 09 §1.2: prep and combat): own prep pieces
    // on the board (app.js sets _showFacing; bench pieces have none); battle / scouting allies whose dir is known
    const wedge = this._showFacing !== undefined ? this._showFacing && this.prep : this.hasDir && this.info.kind !== 'device';
    if (wedge && this.alive) {
      if (!this.facingArrow) {
        this.facingArrow = new P.Sprite(fxAtlas().tex.chevron);
        this.facingArrow.anchor.set(0.5);
        this.facingArrow.tint = 0xff9c33;
        this.ctx.layers.groundFx.addChild(this.facingArrow);
      }
      placeOnGround(this.ctx, this.facingArrow, this.ctx.layers.groundFx, this.y, this.z);
      // on the ground ring, 0.36 tile out along the deploy direction; rotated to the projected direction and
      // foreshortened along it (the chevron texture points right: local x = the pointing axis)
      const [sx, sy] = DIR_STEP[this.dir] || DIR_STEP.RIGHT;
      const c0 = cam.project(this.x, this.y, this.z + 0.01, FA_C);
      const fa = cam.project(this.x + 0.36 * sx, this.y + 0.36 * sy, this.z + 0.01, FA_P);
      const vx = fa.x - c0.x, vy = fa.y - c0.y;
      const len = Math.hypot(vx, vy) || 1;
      this.facingArrow.visible = this.lift <= 0;
      this.facingArrow.position.set(fa.x, fa.y);
      this.facingArrow.rotation = Math.atan2(vy, vx);
      const fs = (s * 0.22) / 64;
      const along = clamp(len / (s * 0.36 || 1), 0.35, 1.2);
      this.facingArrow.scale.set(fs * along, fs * (sy ? 1 : 0.8));
      this.facingArrow.alpha = 0.9 * alpha;
    } else if (this.facingArrow) this.facingArrow.visible = false;

    // elite aura
    if (this.aura) {
      const k = 0.35 + 0.12 * Math.sin(t * 2.2 + this.bob);
      this.aura.alpha = k;
      this.aura.scale.set((s * 1.3) / 128, (s * 1.9) / 128);
    }

    // head height: operators/tokens are uniform chibis; enemies vary (setup-pose bounds, when known; else the chibi
    // headroom × their official model factor)
    let headTiles = UNIT.headroom;
    if (this.isEnemy && spineShown && this.actor.entry.bounds) headTiles = clamp(this.actor.height * UNIT.modelScale * this.modelK * 0.92, 0.55, this.isBoss ? 3.2 : 2.2);
    else if (this.isEnemy && this.isBoss) headTiles = 2.2;
    else if (this.isEnemy && spineShown) headTiles = clamp(UNIT.headroom * this.modelK, 0.55, 2.2);
    this._headTiles = headTiles;
    this.screen.top = by - headTiles * s;
    this._updateHud(dt, s, bx, by - headTiles * s, alpha, t);
  }

  /**
   * Viewport culling: true (and everything hidden) while the unit's body lies outside the viewport with a margin.
   * Dying units are never culled (their fade must finish and remove the view).
   */
  _cull(bx, by, s, dt) {
    const vp = this.ctx.viewport ? this.ctx.viewport() : null;
    let off = false;
    if (vp && !(this.dying > 0) && !this.lift) {
      const m = s * 1.3;
      off = bx < -m || bx > vp.width + m || by < -m * 0.5 || by - s * 3.6 > vp.height;
    }
    if (off !== this.culled) {
      this.culled = off;
      this.root.visible = !off;
      this.hud.visible = !off;
      this.shadow.visible = !off;
      if (off) { if (this.facingArrow) this.facingArrow.visible = false; this.blockIcon.visible = false; }
    }
    if (off) this._offDt += dt * (this.ctx.animRate?.() || 1);
    return off;
  }

  _updateHud(dt, s, x, y, alpha, t) {
    const prep = this.prep;
    const showBars = !prep && this.alive && this.info.kind !== 'item';
    const damaged = this.hp < this.maxHp - 0.5;
    const showHp = showBars && (!this.isEnemy || damaged || this.isBoss);
    const bw = clamp(s * (this.isBoss ? UNIT.bossBarWidth : UNIT.barWidth), 24, this.isBoss ? 260 : 96);
    const bh = clamp(s * (this.isBoss ? 0.12 : 0.075), 3, this.isBoss ? 12 : 7);
    // a knocked-down operator's HUD is its redeploy ring alone, drawn at full strength over the greyed model
    this.hud.alpha = this.down ? this.fadeIn : this.dying > 0 ? 0 : alpha;
    let sx = this.shake > 0 ? Math.sin(t * 90) * this.shake * 10 : 0;
    this.shake = Math.max(0, this.shake - dt);
    const x0 = x - bw / 2 + sx;
    let cy = y - 4;
    // HP
    this.hpBg.visible = this.hpFill.visible = this.hpGhost.visible = showHp;
    if (showHp) {
      const k = this.maxHp > 0 ? clamp(this.hp / this.maxHp, 0, 1) : 0;
      if (this.ghostHp < this.hp) this.ghostHp = this.hp;
      else this.ghostHp = Math.max(this.hp, this.ghostHp - this.maxHp * dt * 0.9);
      const g = this.maxHp > 0 ? clamp(this.ghostHp / this.maxHp, 0, 1) : 0;
      this.hpBg.position.set(x0 - 1, cy); this.hpBg.width = bw + 2; this.hpBg.height = bh + 2;
      this.hpGhost.position.set(x0, cy); this.hpGhost.width = bw * g; this.hpGhost.height = bh;
      this.hpFill.position.set(x0, cy); this.hpFill.width = bw * k; this.hpFill.height = bh;
      if (!this.isEnemy) this.hpFill.tint = k < 0.3 ? COLORS.hpAllyLow : COLORS.hpAlly;
    }
    const shielded = showHp && (this.flags & UF.SHIELD);
    this.shieldBar.visible = !!shielded;
    if (shielded) { this.shieldBar.position.set(x0, cy - bh / 2 - 1); this.shieldBar.width = bw; this.shieldBar.height = Math.max(1.5, bh * 0.35); }
    // SP
    const showSp = showBars && !this.isEnemy && this.spMax > 0;
    this.spBg.visible = this.spFill.visible = showSp;
    const spH = Math.max(2, bh * 0.6);
    let ready = false;
    if (showSp) {
      const active = !!(this.flags & UF.SKILL);
      const k = clamp(this.sp / this.spMax, 0, 1);
      ready = !active && k >= 0.999;
      const sy = cy + bh / 2 + spH / 2 + 1.5;
      this.spBg.position.set(x0 - 1, sy); this.spBg.width = bw + 2; this.spBg.height = spH + 2;
      this.spFill.position.set(x0, sy); this.spFill.width = bw * k; this.spFill.height = spH;
      this.spFill.tint = active ? COLORS.spActive : ready ? COLORS.spReady : COLORS.sp;
      this._spY = sy;
    }
    this.spGlow.visible = ready;
    if (ready) {
      const pulse = 0.55 + 0.35 * Math.sin(t * 6);
      this.spGlow.position.set(x0 + bw, this._spY);
      this.spGlow.scale.set((spH * 5) / 128);
      this.spGlow.alpha = pulse;
    }
    // tier chip (left of the bars in battle; above the head in prep)
    if (this.chip) {
      const cs = clamp(s * (prep ? 0.24 : 0.19), 11, 28) / 44;
      this.chip.scale.set(cs);
      this.chip.visible = this.alive;
      if (prep) this.chip.position.set(x, y - this.chip.height / 2 + 2);
      else this.chip.position.set(x0 - this.chip.width / 2 - 1, cy + (showSp ? spH / 2 : 0));
    }
    // status icons row above the bars
    const icons = this._iconKeys();
    const isz = clamp(s * 0.26, 12, 26);
    const iy = cy - bh / 2 - isz / 2 - 3;
    for (let i = 0; i < this.icons.length; i++) {
      const ic = this.icons[i];
      const key = icons[i];
      if (!key || !this.alive || prep) { ic.visible = false; continue; }
      const tex = statusTexture(key);
      if (!tex) { ic.visible = false; continue; }
      ic.texture = tex;
      ic.visible = true;
      ic.width = ic.height = isz;
      ic.position.set(x - ((icons.length - 1) * (isz + 2)) / 2 + i * (isz + 2), iy);
    }
    // element gauge row under the bars (b.snap `elem`); redeploy ring above a knocked-down operator (b.snap `down`)
    this._updateElementBar(showBars && !!this.el, x0, bw, cy + bh / 2 + (showSp ? spH + 1.5 : 0) + 1, spH, s, t);
    this._updateDownRing(!prep && !!this.down && !this.alive, x, this.screen.y - DOWN_LOOK.height * s, s, t);
    // blocked marker at the feet (enemies held by a blocker)
    const blocked = !prep && this.alive && this.isEnemy && (this.flags & UF.BLOCKED);
    this.blockIcon.visible = !!blocked;
    if (blocked) {
      const f = this.screen;
      this.blockIcon.position.set(f.x + (this.visFacing < 0 ? -1 : 1) * s * 0.34, SH_P.y - s * 0.04);
      this.blockIcon.scale.set(clamp(s * 0.22, 9, 22) / 32 * (this.visFacing < 0 ? -1 : 1), clamp(s * 0.22, 9, 22) / 32);
      this.blockIcon.alpha = 0.85 * alpha;
    }
    // count badge & item pips (prep)
    if (this.countText && this.countText.visible) {
      this.countText.scale.set(clamp(s / 90, 0.5, 1.2));
      this.countText.position.set(x + s * 0.32, this.screen.y - s * 0.12);
    }
    for (let i = 0; i < this.itemPips.length; i++) {
      const pip = this.itemPips[i];
      const ps = clamp(s * 0.26, 12, 30);
      pip.width = pip.height = ps;
      pip.position.set(this.screen.x - s * 0.36 + i * (ps + 1), this.screen.y - s * 0.05);
      pip.visible = this.alive;
    }
  }

  /** True while the shown gauge is in its 爆发冷却 (b.snap `elem` carries the cooldown's end and length). */
  elementCooling() {
    return !!this.el && this.elDur > 0 && this.elUntil > 0;
  }

  /**
   * The share of the element bar drawn (0..1): the remaining 元素值 (1 − fill), or during a 爆发冷却 the part of the
   * cooldown already run (the bar refills to full, PRTS 元素 "元素条显示缓慢恢复至上限"). 0 without a gauge.
   */
  elementLeft() {
    if (!this.el) return 0;
    if (this.elementCooling()) return clamp(1 - (this.elUntil - this.gameT) / this.elDur, 0, 1);
    return clamp(1 - this.elFill, 0, 1);
  }

  /**
   * Element gauge row (see header) under the bars spanning x0 … x0 + bw, its top at `top`: the element's disc at the
   * left (operators with its glyph; enemies plain, × EL_BAR.enemy) and, beside it to the bars' right end, a bar of
   * `elementLeft()` on a dark track `h` px tall — white for the 元素值 left; in the element's colour, the disc pulsing
   * (clock `t`), while it refills over a 爆发冷却. Built on the first gauge, hidden while there is none.
   */
  _updateElementBar(show, x0, bw, top, h, s, t = 0) {
    let r = this._elBar;
    if (!show) { if (r) r.root.visible = false; return; }
    const tex = hudRings();
    if (!r) {
      const P = this.P;
      const root = new P.Container();
      const bg = bar(P, root, COLORS.hpBack, 0.85);
      const fill = bar(P, root, 0xffffff);
      const disc = new P.Sprite(tex.disc.burn);
      disc.anchor.set(0.5);
      root.addChild(disc);
      r = this._elBar = { root, disc, bg, fill };
      this.hud.addChild(root);
    }
    const d = clamp(s * EL_BAR.icon, EL_BAR.min, EL_BAR.max) * (this.isEnemy ? EL_BAR.enemy : 1);
    const cy = top + EL_BAR.gap + d / 2;
    r.disc.texture = (this.isEnemy ? tex.discEnemy : tex.disc)[this.el] || tex.disc.burn;
    r.disc.width = r.disc.height = d / HUD_DISC;   // the disc fills HUD_DISC of its atlas cell
    r.disc.position.set(x0 + d / 2, cy);
    const bx = x0 + d + 2, w = Math.max(4, x0 + bw - bx);
    r.bg.position.set(bx - 1, cy); r.bg.width = w + 2; r.bg.height = h + 2;
    const k = this.elementLeft();
    r.fill.visible = k > 0;
    r.fill.position.set(bx, cy); r.fill.width = w * k; r.fill.height = h;
    if (this.elementCooling()) {
      r.fill.tint = (ELEMENT_RING[this.el] || ELEMENT_RING.burn).tint;
      r.disc.alpha = EL_BAR.pulse + (1 - EL_BAR.pulse) * (0.5 + 0.5 * Math.cos(t * Math.PI * 2 * EL_BAR.pulseHz));
    } else {
      r.fill.tint = 0xffffff;
      r.disc.alpha = 1;
    }
    r.root.visible = true;
  }

  /**
   * Redeploy ring above a knocked-down operator (see header), centred on (cx, cy): a mint arc filling as its respawn
   * timer runs with the seconds left; a full pulsing amber ring with "DP" / red ring with "!" once it only waits.
   */
  _updateDownRing(show, cx, cy, s, t) {
    let r = this._downRing;
    if (!show) { if (r) r.root.visible = false; return; }
    const tex = hudRings();
    if (!r) {
      const P = this.P;
      const root = new P.Container();
      const mk = (tx) => { const sp = new P.Sprite(tx); sp.anchor.set(0.5); root.addChild(sp); return sp; };
      const disc = mk(tex.downDisc), track = mk(tex.track), arc = mk(tex.arcs[0]);
      const text = new P.Text('', { fontFamily: 'Bender, Oxanium, "Noto Sans SC", sans-serif', fontSize: 32, fontWeight: '700', fill: '#ffffff', stroke: '#0b0f0e', strokeThickness: 6 });
      text.anchor.set(0.5);
      root.addChild(text);
      r = this._downRing = { root, disc, track, arc, text, label: null };
      this.hud.addChild(root);
    }
    const dn = this.down;
    const counting = dn.state === DOWN_STATE.COUNTING;
    const left = Math.max(0, dn.until - this.gameT);
    r.arc.texture = ringArc(counting ? (dn.total > 0 ? clamp(1 - left / dn.total, 0, 1) : 1) : 1);
    const color = DOWN_LOOK.ring[dn.state] ?? DOWN_LOOK.ring[DOWN_STATE.COUNTING];
    r.arc.tint = color;
    const label = counting ? String(Math.ceil(left - 1e-6)) : dn.state === DOWN_STATE.WAIT_DP ? 'DP' : '!';
    if (r.label !== label) {
      r.label = label;
      r.text.text = label;
      r.text.style.fill = counting ? '#ffffff' : '#' + color.toString(16).padStart(6, '0');
    }
    const d = clamp(s * DOWN_LOOK.size, 22, 52);
    const k = d / tex.size;
    r.disc.scale.set(k); r.track.scale.set(k); r.arc.scale.set(k);
    r.text.scale.set((d * (label.length > 2 ? 0.34 : 0.44)) / 32);
    r.root.position.set(cx, cy);
    r.root.alpha = counting ? 1 : 0.72 + 0.28 * Math.sin(t * 5);
    r.root.visible = true;
  }

  // ---- impostor mode (crowded fields, clipped skeletons): the skeleton is rendered into a slot of the shared
  // impostor atlas (render/impostor.js) every `interval` frames (staggered per unit; every frame for clipped
  // skeletons, whose stencil masks must stay out of the main pass) and shown as one sprite. Without a free atlas
  // slot the unit keeps a private RenderTexture (same visuals, one extra framebuffer switch).

  _impBox() {
    if (this._box) return this._box;
    let b = null;
    try { b = this.actor.spine.getLocalBounds(); } catch { b = null; }
    let x0 = -220, y0 = -420, x1 = 220, y1 = 40;
    if (b && Number.isFinite(b.width) && b.width > 10 && b.height > 10) {
      const padX = Math.max(60, b.width * 0.3), padY = Math.max(50, b.height * 0.22);
      x0 = Math.min(b.x - padX, -140); x1 = Math.max(b.x + b.width + padX, 140);
      y0 = Math.min(b.y - padY, -260); y1 = Math.max(b.y + b.height + padY * 0.4, 30);
    }
    this._box = { x0, y0, w: x1 - x0, h: y1 - y0 };
    return this._box;
  }

  _updateImpostor(sc, flip, tint, animDt, interval) {
    const P = this.P;
    const atlas = this.ctx.impostors || null;
    if (!this.imp) {
      const sprite = new P.Sprite(P.Texture.EMPTY);
      if (this.actor.spine.parent) this.actor.spine.parent.removeChild(this.actor.spine);
      if (atlas) atlas.park(this.actor.spine);
      this.body.addChild(sprite);
      this.imp = { sprite, slot: null, rt: null, sc: 0, acc: 0, phase: (Math.random() * 64) | 0, dirty: true };
    }
    const imp = this.imp;
    imp.acc += animDt;
    const frame = this.ctx.frameNo ? this.ctx.frameNo() : 0;
    const due = imp.dirty || interval <= 1 || (frame + imp.phase) % interval === 0 || Math.abs(sc - imp.sc) > imp.sc * 0.12;
    if (due) {
      this.actor.update(imp.acc);
      imp.acc = 0;
      imp.dirty = false;
      this._renderImpostor(sc, atlas);
    }
    const k = imp.sc > 0 ? sc / imp.sc : 1;
    imp.sprite.scale.set(k * flip, k);
    imp.sprite.alpha = this.swapT;
    imp.sprite.tint = tint;
  }

  _renderImpostor(sc, atlas) {
    const P = this.P, R = this.ctx.renderer, imp = this.imp;
    const box = this._impBox();
    const w = Math.max(8, Math.ceil(box.w * sc)), h = Math.max(8, Math.ceil(box.h * sc));
    const sp = this.actor.spine;
    sp.alpha = 1;
    if (this._tint !== 0xffffff) { this._tint = 0xffffff; sp.tint = 0xffffff; }
    const ox = -box.x0 * sc, oy = -box.y0 * sc;
    if (atlas) {
      let slot = imp.slot;
      const clip = !!(this.actor.clipped && this.actor.clipOn);
      if (!slot || w > slot.w || h > slot.h || w < slot.w * 0.6 || h < slot.h * 0.6 || slot.clip !== clip) {
        if (slot) atlas.free(slot);
        slot = imp.slot = atlas.alloc(w, h, { clip });
        if (slot && imp.rt) { imp.rt.destroy(true); imp.rt = null; }
      }
      if (slot) {
        atlas.draw(slot, sp, { a: sc, d: sc, tx: ox, ty: oy });
        if (imp.sprite.texture !== slot.tex) imp.sprite.texture = slot.tex;
        imp.sprite.anchor.set(ox / slot.w, oy / slot.h);
        imp.sc = sc;
        return;
      }
    }
    // private render target (no atlas / atlas full)
    let rt = imp.rt;
    if (!rt || w > rt.width || h > rt.height || w < rt.width * 0.6 || h < rt.height * 0.6) {
      if (rt) rt.destroy(true);
      rt = imp.rt = P.RenderTexture.create({ width: Math.ceil(w / 8) * 8, height: Math.ceil(h / 8) * 8, resolution: R.resolution });
      imp.sprite.texture = rt;
    }
    const parent = sp.parent;
    sp.position.set(0, 0);
    sp.scale.set(1, 1);
    sp.visible = true;
    const m = this._m || (this._m = new P.Matrix());
    m.set(sc, 0, 0, sc, ox, oy);
    try { R.render(sp, { renderTexture: rt, clear: true, transform: m }); } catch { /* lost context etc. */ }
    if (parent === atlas?.parked) sp.visible = false;
    imp.sprite.anchor.set(ox / rt.width, oy / rt.height);
    imp.sc = sc;
  }

  _leaveImpostor() {
    const imp = this.imp;
    this.imp = null;
    if (!imp) return;
    const atlas = this.ctx.impostors || null;
    if (imp.slot && atlas) atlas.free(imp.slot);
    imp.sprite.destroy();
    if (imp.rt) imp.rt.destroy(true);
    if (this.actor && this.actor.spine) {
      if (atlas) atlas.unpark(this.actor.spine);
      this.actor.spine.visible = true;
      this.actor.spine.position.set(0, 0);
      this.body.addChild(this.actor.spine);
    }
  }

  _iconKeys() {
    const out = ICON_TMP;
    out.length = 0;
    const f = this.flags;
    const push = (k) => { if (k && !out.includes(k) && out.length < 4) out.push(k); };
    if (f & UF.FROZEN) push('freeze');
    else if (f & UF.STUNNED) push('stun');
    if (f & UF.SLEEP) push('sleep');
    if (f & UF.COLD && !(f & UF.FROZEN)) push('cold');
    if (f & UF.INVULN) push('invuln');
    if (f & UF.STEALTH) push('stealth');
    for (const k of this.statuses) {
      if (out.length >= 4) break;
      if (k === 'skill') continue;
      // a burst's lock ('burnBurst', 'neuralBurst' … — the 爆发冷却) is shown by the element gauge row under the bars
      // (b.snap `elem`); only a feed without gauges (an older recording) shows it as a status
      if (this.el && k.endsWith('Burst')) continue;
      if (statusIconSuppressed(k, this.statuses)) continue; // 折射 while silenced
      const icon = statusIconKey(k);
      // flag-driven states are authoritative (a stale 'stun' status must not outlive the flag)
      if (!icon || icon === 'stun' || icon === 'freeze' || icon === 'sleep' || icon === 'stealth' || icon === 'invuln') continue;
      if (icon === 'cold' && (f & UF.FROZEN)) continue;
      push(icon);
    }
    return out;
  }

  /** Canvas-space bounds (CSS px) of the body: 0.7 tile wide, from its head (UNIT.headroom; enemies: their model) down
   * to just below the feet — tooltips and overlays (view.pieceScreenRect), not picking (render/pick.js is by tile). */
  bounds() {
    const s = this.screen.s || 1;
    const h = (this._headTiles || UNIT.headroom) * s;
    const w = s * 0.7;
    return { x: this.screen.x - w / 2, y: this.screen.y - h, width: w, height: h + s * 0.1 };
  }

  setHover(on) { this.hovered = !!on; }

  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this._dropActor();
    this.shadow.destroy();
    this.blockIcon.destroy();
    if (this.facingArrow) this.facingArrow.destroy();
    this.hud.destroy({ children: true });
    this.root.destroy({ children: true });
  }
}

const SH_P = { x: 0, y: 0, s: 0, depth: 0 };
const FA_P = { x: 0, y: 0, s: 0, depth: 0 };
const FA_C = { x: 0, y: 0, s: 0, depth: 0 };
const LG_P = { x: 0, y: 0, s: 0, depth: 0 };
const ICON_TMP = [];

/**
 * Unit-layer zIndex of a unit / piece whose feet are at (x, y): farther rows first (so raised block rows, keyed by
 * tiles.rowDepthKey, hide units behind them); lifted (dragged) pieces on top; ties broken by column.
 */
export function unitDepthKey(cam, x, y, lift = 0) {
  // +40 (< one row of depth at the official 30° pitch, 100·sin 30° = 50): a lifted piece never ties with the unit one
  // row in front of it (a tie flickers with the column tie-break)
  return -cam.depthOf(x, y, 0) * 100 + (lift > 0 ? 40 : 0) + x * 0.001;
}

function mixTint(a, b, k) {
  const t = clamp(k, 0, 1);
  const ar = (a >> 16) & 255, ag = (a >> 8) & 255, ab = a & 255;
  const br = (b >> 16) & 255, bg = (b >> 8) & 255, bb = b & 255;
  return ((ar + (br - ar) * t) << 16) | ((ag + (bg - ag) * t) << 8) | ((ab + (bb - ab) * t) | 0);
}

/** Attack interval from data (bat × 100 / aspd), game seconds. */
function defaultInterval(ctx, info) {
  try {
    const rec = ctx.lookupDef ? ctx.lookupDef(info) : null;
    const st = rec?.stats;
    if (st && st.bat > 0) return clamp((st.bat * 100) / (st.aspd > 0 ? st.aspd : 100), 0.2, 6);
  } catch { /* ignore */ }
  return 1.2;
}

// =============================================================================================================

/**
 * Hand item: icon plate floating above its slot. While dragged (`lift` > 0) the plate is centred on its ground point —
 * the pointer (render/app.js moveDragVisual); it drops on (and equips the unit on) the tile under the pointer.
 */
export class ItemView {
  constructor(ctx, info) {
    const P = ctx.P;
    this.ctx = ctx; this.P = P;
    this.info = { ...info };
    this.id = info.id; this.uid = info.uid ?? null;
    this.x = info.x || 0; this.y = info.y || 0; this.z = 0;
    this.alive = true; this.remove = false; this.lift = 0; this.dimmed = false;
    this.bob = Math.random() * 6;
    this.screen = { x: 0, y: 0, s: 1, top: 0 };
    this.shadow = new P.Sprite(ctx.shadowTex || shadowTexture());
    this.shadow.anchor.set(0.5);
    ctx.layers.shadow.addChild(this.shadow);
    this.root = new P.Container();
    ctx.layers.units.addChild(this.root);
    this.plate = new P.Sprite(itemTexture(String(info.defId || 'item'), null, info.color || 0x9aa5a0));
    this.plate.anchor.set(0.5, 1);
    this.root.addChild(this.plate);
    this.info.icon = null;
    this.setIcon(info.icon);
    this.hud = null;
  }
  /** Show the item's icon (an URL; the plain plate until it loads) — again when the asset manifest named it late. */
  setIcon(url) {
    if (this.destroyed || !url || url === this.info.icon) return;
    this.info.icon = url;
    const a = this.ctx.assets;
    if (a?.image) a.image(url).then((img) => { if (!this.destroyed && img && this.info.icon === url) this.plate.texture = itemTexture(String(this.info.defId), img, this.info.color || 0x9aa5a0); }, () => {});
  }
  setWorld(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
  /** A battle snapshot sample (syncBattle syncs every unit of the field): a hand item on a scouted prep board rides
   *  the units as kind 'item' (Match.prepFieldMeta) — follow its position, there is nothing else to animate. */
  sync(s) { this.x = s.x; this.y = s.y; }
  update(dt, cam, t) {
    const lifted = this.lift > 0;
    const p = cam.project(this.x, this.y, lifted ? this.z : this.z + this.lift + 0.12 + Math.sin(t * 2 + this.bob) * 0.03, this.screen);
    this.root.position.set(p.x, p.y);
    this.root.zIndex = unitDepthKey(cam, this.x, this.y, this.lift);
    const size = p.s * 0.62;
    this.plate.scale.set(size / 128);
    this.plate.anchor.set(0.5, lifted ? 0.5 : 1);
    this.root.alpha = this.dimmed ? 0.35 : 1;
    placeOnGround(this.ctx, this.shadow, this.ctx.layers.shadow, this.y, this.z);
    const sh = cam.project(this.x, this.y, this.z, SH_P);
    this.shadow.position.set(sh.x, sh.y);
    this.shadow.scale.set((p.s * 0.55) / this.shadow.texture.width);
    this.shadow.alpha = 0.35;
    this.screen.top = lifted ? p.y - size / 2 : p.y - size;
  }
  /** Canvas-space bounds (CSS px) of the plate (centred on the pointer while dragged). */
  bounds() {
    const w = (this.screen.s || 1) * 0.62;
    return { x: this.screen.x - w / 2, y: this.lift > 0 ? this.screen.y - w / 2 : this.screen.y - w, width: w, height: w };
  }
  setHover() {}
  destroy() { if (this.destroyed) return; this.destroyed = true; this.shadow.destroy(); this.root.destroy({ children: true }); }
}

// =============================================================================================================

/**
 * Battle device unit (kind 'device': crates, “双眼皮” turrets, unknown stage devices): a textured 3D box (the tile
 * atlas, render/tiles.js BoxMesh — the real crate / device plates when the board art is installed), a turret head
 * that turns to its target and flashes on attack, HP bar once damaged, and a break-apart on death.
 */
const GENERIC_DEVICE = Object.freeze({ size: 0.7, height: 0.36, top: 'platformTop', side: 'forbidSide' });
export class DeviceView {
  constructor(ctx, info) {
    const P = ctx.P;
    this.ctx = ctx; this.P = P;
    this.info = { ...info };
    this.id = info.id; this.uid = null;
    this.isEnemy = false;
    this.spec = deviceBoxOf(info.defId) || GENERIC_DEVICE;
    this.turret = this.spec === DEVICE_BOX.turret;
    this.x = Number(info.x) || 0; this.y = Number(info.y) || 0; this.z = 0;
    this.hp = Number(info.maxHp) || 100; this.maxHp = this.hp;
    this.alive = true; this.remove = false; this.dying = 0; this.flags = 0;
    this.facing = info.facing === -1 ? -1 : 1;
    this.aim = this.facing > 0 ? 0 : Math.PI; this.aimTo = this.aim; this.fire = 0;
    this.screen = { x: 0, y: 0, s: 1, top: 0 };
    this._headTiles = this.spec.height + 0.2;
    this.box = ctx.createBox ? ctx.createBox() : null;
    this.gfx = new P.Graphics();       // fallback body (no tile field) and the turret head
    ctx.layers.units.addChild(this.gfx);
    this.hud = new P.Container();
    ctx.layers.bars.addChild(this.hud);
    this.hpBg = bar(P, this.hud, COLORS.hpBack, 0.85);
    this.hpFill = bar(P, this.hud, this.turret ? COLORS.hpAlly : 0xe0b877);
    this.camVersion = -1;
  }
  sync(s) {
    if (!s) return;
    this.x = s.x; this.y = s.y; this.z = groundZ(this.ctx, s.x, s.y);
    if (s.maxHp > 0) this.maxHp = s.maxHp;
    this.hp = clamp(s.hp, 0, this.maxHp); this.flags = s.flags | 0;
  }
  setWorld(x, y, z = 0) { this.x = x; this.y = y; this.z = z; }
  onAttack(target) {
    if (!this.alive) return;
    if (target) this.aimTo = Math.atan2(target.y - this.y, target.x - this.x);
    this.fire = 1;
  }
  windUp() { return false; }
  onHit() { this.shake = 0.2; }
  onDeploy() {}
  onStatus() {}
  setSkill() {}
  setFacing() {}
  die() { if (!this.alive) return; this.alive = false; this.dying = 0.45; this.ctx.fx?.crateBreak?.(this.x, this.y, this.z, this.turret ? 0x6c777d : null); }
  revive() { this.alive = true; this.dying = 0; this.remove = false; }
  update(dt, cam, t) {
    const shake = this.shake > 0 ? Math.sin(t * 80) * this.shake * 0.05 : 0;
    this.shake = Math.max(0, (this.shake || 0) - dt);
    const k = this.dying > 0 ? Math.max(0, this.dying / 0.45) : 1;
    if (this.dying > 0) { this.dying -= dt; if (this.dying <= 0) this.remove = true; }
    const zKey = rowDepthKey(cam, Math.round(this.y)) + ROW_KEY.devices;
    const size = this.spec.size * (0.6 + 0.4 * k), height = this.spec.height * k;
    const g = this.gfx;
    if (this.box) {
      this.box.update(cam, { x: this.x + shake, y: this.y, z: this.z, size, height, top: this.spec.top, side: this.spec.side, alpha: k });
      if (this.box.mesh) {
        if (!this.box.mesh.parent) this.ctx.layers.units.addChild(this.box.mesh);
        this.box.mesh.zIndex = zKey;
      }
    }
    const redraw = !this.box || this.turret || cam.version !== this.camVersion || shake || this.dying > 0 || this._lastShake;
    if (redraw) {
      this.camVersion = cam.version;
      this._lastShake = !!shake;
      g.clear();
      if (!this.box) drawCrate(g, cam, this.x + shake, this.y, this.z, size, height, 1);
      if (this.turret && height > 0.05) this._drawHead(g, cam, dt, height, k);
    }
    g.zIndex = zKey + 0.001;
    g.alpha = k;
    const p = cam.project(this.x, this.y, this.z + this.spec.height + 0.35, this.screen);
    const show = this.alive && this.hp < this.maxHp - 0.5;
    this.hud.visible = show;
    if (show) {
      const bw = clamp(p.s * 0.7, 24, 90), bh = clamp(p.s * 0.06, 3, 6);
      this.hpBg.position.set(p.x - bw / 2 - 1, p.y); this.hpBg.width = bw + 2; this.hpBg.height = bh + 2;
      this.hpFill.position.set(p.x - bw / 2, p.y); this.hpFill.width = bw * clamp(this.hp / this.maxHp, 0, 1); this.hpFill.height = bh;
    }
    this.screen.top = p.y;
  }
  /** Turret head: a squat dome with a barrel aimed at the last target; muzzle flash on attack. */
  _drawHead(g, cam, dt, height, k) {
    let d = this.aimTo - this.aim;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    this.aim += d * Math.min(1, dt * 10);
    this.fire = Math.max(0, this.fire - dt * 5);
    const z = this.z + height;
    const c = cam.project(this.x, this.y, z + 0.08);
    const s = c.s;
    const ex = Math.cos(this.aim), ey = Math.sin(this.aim);
    const recoil = this.fire * 0.06;
    const tip = cam.project(this.x + ex * (0.42 - recoil), this.y + ey * (0.42 - recoil), z + 0.12);
    g.lineStyle(0);
    g.beginFill(0x1c2124, 0.95 * k); g.drawEllipse(c.x, c.y, s * 0.2, s * 0.13); g.endFill();
    g.lineStyle(Math.max(2, s * 0.07), 0x39444a, k);
    g.moveTo(c.x, c.y - s * 0.05); g.lineTo(tip.x, tip.y - s * 0.03);
    g.lineStyle(Math.max(1, s * 0.03), 0x9aa7ad, k);
    g.moveTo(c.x, c.y - s * 0.06); g.lineTo(tip.x, tip.y - s * 0.04);
    g.lineStyle(0);
    g.beginFill(0x4b565c, k); g.drawEllipse(c.x, c.y - s * 0.07, s * 0.14, s * 0.09); g.endFill();
    g.beginFill(this.fire > 0 ? 0xffd27a : 0xff5a4a, (0.6 + 0.4 * this.fire) * k); g.drawCircle(c.x, c.y - s * 0.09, s * 0.035); g.endFill();
    if (this.fire > 0.2) { g.beginFill(0xfff0c0, this.fire * 0.8 * k); g.drawCircle(tip.x, tip.y - s * 0.03, s * 0.08 * this.fire); g.endFill(); }
  }
  bounds() { const s = this.screen.s; return { x: this.screen.x - s * 0.45, y: this.screen.y, width: s * 0.9, height: s }; }
  hitTest(x, y) { const b = this.bounds(); return this.alive && x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height; }
  setHover() {}
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.box) this.box.destroy();
    this.gfx.destroy();
    this.hud.destroy({ children: true });
  }
}
