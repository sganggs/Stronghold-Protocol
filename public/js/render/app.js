// render/app.js — battlefield view (DESIGN §9). PixiJS 7 (global PIXI) + pixi-spine (PIXI.spine), loaded on demand
// from /vendor when the page did not include them as classic <script> tags.
//
//   const view = await createFieldView(host, { data, assets, audio, settings, padding, hud })
//   view.setStage(stage)                        procedural tiles + devices (data/stages.json entry)
//   view.setCamera(kind, { rect, side, padding, instant, shop })   'prep'|'normal'|'unite'|'boss'('hidden'); animated
//                                               — the prep cameras (own board / Final Assault half) keep the bench
//                                               and the field clear of `hud(kind, size, { shop })` = { top, bottom } px
//                                               of DOM HUD along the top / bottom edge (projection.js clearHud; user
//                                               playtest #5 item 9: the shop bar covered the bench on phones); `shop:
//                                               false` = the folded shop: the official shop-collapsed prep camera
//                                               (left_prepare / *_boss_prepare) clear of the folded shop's band (public
//                                               issue #5: folding the shop did not grow the board)
//   view.setPrep(privateState, { editable, canPlace })       hand/temp/board pieces; editable enables drag & drop; a
//                                               new board piece flashes (fx.deploy), and so does a card that just arrived in the hand or temp; a merge's elite — on the tile of
//                                               the deployed copy it replaced, or on its bench slot — gets the
//                                               promotion cue instead (render/promote.js, fx.promote)
//   view.enterBattle(fieldMeta)                 m.field { fieldId, kind, rect, stageId, units: [UnitInfo] } — each
//                                               unit through renderInfo(UnitInfo) (an enemy's `form`: a view built
//                                               mid-battle starts in the current model form)
//   view.pushSnapshot(snap); view.pushEvents(ev | { ev, gt })  b.snap / b.ev wire frames as received (game time in
//                                               `gt`; a numeric `t` is accepted for raw Battle snapshots / recordings)
//                                               — 100 ms interpolation buffer; b.snap `down` keeps knocked-out
//                                               operators on the field under a redeploy ring and `elem` draws the
//                                               element gauges (user playtest #4 items 8 / 9, render/units.js); a
//                                               'die' with reason FORCED_EXIT (an operator entering 联防 knocked out,
//                                               user playtest #5 item 2) goes straight to the held pose, no burst; an
//                                               fx with a `form` (shared/protocol.js fxForm) switches the enemy's
//                                               model to that clip set (render/units.js FORMS)
//   view.setLocalFeed({ on, speed })            frames come from the local sim every frame (client-side combat):
//                                               ~2-frame buffer at the battle's game speed
//   view.highlightTiles(tiles, style)           [[r,c]] | [{row,col}]; style 'legal'|'illegal'|'range'|'rangeStand'|
//                                               'hover'|'target'|{color,fill,line,group}; highlightTiles(null) clears all
//   view.on(name, fn) → unsubscribe ; view.off(name, fn)
//        pieceDragStart { uid, piece, from } · pieceDrop { uid, piece, from, target } · pieceDragEnd {uid, dropped}
//        pieceClick { uid, piece, button, detail, clientX, clientY } (battle units: { unitId, uid, unit, … })
//        pieceDetail (right-click / long-press) · pieceHover { uid } | { uid: null } (battle: + unitId, unit)
//        tileHover { row, col, area, idx } | null (while dragging: the drop target — the tile under the pointer)
//   view.pieceScreenRect(uid) → { left, top, right, bottom, width, height, x, y } (client px: the drawn body) | null
// Picking (user playtest #4 item 1: the ground is drawn as tiles — a press on a tile is a press on the unit standing
// there): every "which unit is under the pointer" — prep press / click / detail / drag start / hover (pieceAt), battle
// clicks and hover (battleUnitAt), the pen (penUnitAt) — is render/pick.js over the tile under the pointer (groundTile:
// raised tops first); battle enemies, which walk between tiles, by their ground position (flying ones by their drawn
// body; a huge boss also anywhere on its hit area — data/enemies.json `hitArea`, user playtest #5). A dragged piece
// is held under the pointer — a unit with its drawn feet DRAG_HOLD_TILES below it (the pointer on its body), an item
// plate centred on it — and drops on the tile under the pointer (render/drag.js); an item dropped on a unit's tile
// equips that unit.
//   Direction step (ui/facingWheel.js, research 09 §1.2):
//   view.tileScreen(row, col) → { x, y, s, poly: [[x,y]×4] } (client px: tile-top centre, px per tile, corners) | null
//   view.holdPiece(uid, {row,col} | null)       keep a dropped prep piece standing on a tile while its direction is
//                                               chosen / the move is in flight (null releases; setPrep then settles it)
//   view.setPieceDir(uid, dir)                  show a prep piece facing UP|RIGHT|DOWN|LEFT (wheel preview / stored dir)
//   view.setSettings({ damageNumbers, quality: 'high'|'medium'|'low' }) ; view.resize() ; view.destroy()
//   view.stats() → { fps, frameMs, cpuMs, renderMs, units, particles, impostor, impostorAtlas, boardArt, … } (dev / perf)
//
// Enemy preview pen (research 09 §2.2 / 08 §4.2, render/pen.js): in prep the next round's enemies idle in the pen
// (rows 14–18 × cols 7–13; upper-gate enemies rows 17–18, lower-gate rows 14–15; spawn-time order, ≤ 3 per tile,
// ≤ 50 figures, elites / bosses always), facing left, no bars, no simulation. Source: `setPrep(priv)` reads
// `priv.nextEnemies`; a read-only scouting board (`enterBattle({ prep: true, nextEnemies })`) shows the teammate's
// pen; `view.setPen(list | null)` sets it directly. A real battle (enterBattle without `prep`) empties it. A tap on a
// pen enemy emits pieceClick { enemyKey, preview: true, unit: { side: 'enemy', defId, enemyKey, preview: true } }.
//   view.setCamera('pen') pans to the pen in 0.25 s (configBlackBoard move_time); `view.setCamera(kind, opts)` goes
//   back (the same kind without options returns to the exact camera used before the pen).
//   The pen is shown ONLY by the pen camera (user playtest #2 item 6: the battlefield with the waiting enemies above it
//   looked wrong — after 返回战场 and in every battle): the prep, battle, 联防 and boss cameras neither build its 3D
//   area nor draw its 2D rows (`boardArea` / `bandFor`), and its figures hide (`penShown`, kept for the way back); a
//   flight to / from the pen shows both while it lasts.
// The round's leader (community report #12, owner's decision 2026-10-04; research 09 §2.2: in the official Final Assault
// prep image the boss stands on the boss field with its HP bar): a nextEnemies entry with its spawn tile `start`
// (render/prepfield.js leaderStand) stands there — idle, with its (full) HP bar, facing the player's half, a tap shows its
// details like a pen enemy — instead of in the pen, shown by the boss-field prep camera only (`leaderShown`); while an
// operator's range preview shows (a RANGE_GROUPS highlight: the direction wheel's 'facing', a selected piece's range) its
// hit tiles (the sim's hit rectangle, render/pick.js hitTiles) are lit in red beside it (LEADER_HIT_STYLE). Display only.
// Final Assault / Hidden Core prep (research 09 §1.2, render/prepfield.js): `view.setCamera('bossPrep', { side })`
// (or 'prep' with a boss-row rect) shows the prep pieces on the player's half of the boss field — board rows 9–12 →
// boss rows 2–5, bench 7 → 0, temp 8 → 1, side 'R' mirrored col c → 20 − c with RIGHT ↔ LEFT. Every public
// coordinate stays in BOARD space (pieceDrop targets, canPlace, highlightTiles, tileScreen, holdPiece, setPieceDir,
// stored `dir`); `view.prepField()` → { kind, side, mirror } and `tileScreen(...).mirror` tell the direction wheel
// that a screen-right swipe means board LEFT on the mirrored half.
// Lost WebGL context of the 3D board: the 2D board takes over at once and the 3D board is rebuilt on a fresh context
// a moment later (up to 3 tries; a context lost again right away counts as a failure; `setBoardMode('2d')` stops it).
//
// Board art: the real 卫戍协议 board textures of the local client are used when installed (render/boardArt.js, crops
// from tools/crop-board-atlas.mjs); otherwise every material is procedural (same geometry, no network errors).
// 3D board (DESIGN §15): with the local art installed and WebGL2 available, the official board is a real three.js
// scene (render/board3d) on a canvas UNDER the (then transparent) Pixi canvas; the TileField keeps only highlights,
// airflow and the grid queries (tiles.setExternal). One camera (render/projection.js) drives both layers — the
// three.js PerspectiveCamera is synced from it every change. Missing art / three / WebGL2, a failed init or a lost
// context fall back to the 2D atlas board. `opts.board`: 'auto' (default) | '3d' | '2d'; `?board=2d|3d` in the URL
// overrides (dev; '3d' also accepts a slow / software GPU). stats().board3d → { on, calls, triangles, cpuMs }.
// three.js is only downloaded when the local-art manifest lists the board atlas. That manifest is awaited with the asset
// manifest (≤ 4 s; the game seeds the store with its own copies, ui/fieldHost.js seedAssets), so an enemy whose model
// only the local client has draws it (assets.js spineEntry). A manifest that arrives later (assets.js onChange) makes
// every view re-resolve its picture and model (UnitView.retryAssets), and so does showing the tab again; battle mode
// holds the Spine cache so a battle begun in a hidden tab keeps its models (holdScene; public issue #8 item 5). The
// built 3D area, the drawn 2D rows and the lit rect follow `viewKind` (a 'prep' camera on the boss rows = the Final
// Assault prep = the boss field).
// Battle device boxes (`ctx.createBox`) follow the board layer (switchableBox), so a 3D ⇄ 2D switch keeps crates.
// Crowds and clipped Spine skeletons render through the shared impostor atlas (render/impostor.js), flushed once per
// frame before the main pass.
// canPlace: `(uid, target, piece) => bool` (the game UI's form: target = {area:'board',row,col}|{area:'hand',idx})
// or `(piece, row, col, target) => bool` (functions declaring ≥ 3 parameters). Throwing ⇒ illegal.
// Piece shape (DESIGN §8.3): { uid, kind: 'chess'|'item'|'token', id, golden, tier, items: [{uid,id}], count, ownerUid }.
// `assets` may be the store from public/js/assets.js or the raw /data/assets.json manifest (it is wrapped);
// `data` is the client data store (public/js/data.js: lookup(file, id)) or plain { chess, tokens, items, enemies } maps.

import { GEO, ANIM, UF } from '../../../shared/constants.js';
import { fxForm } from '../../../shared/protocol.js';
import { Camera, presetCamera, lerpCamera, easeInOutCubic, pickTile, normRect } from './projection.js';
import { SnapshotBuffer, frameTime } from './interp.js';
import { TileField } from './tiles.js';
import { UnitView, ItemView, DeviceView, FORMS } from './units.js';
import { FxSystem, ensureDamageFonts } from './fx.js';
import { createDragController, pieceTile } from './drag.js';
import { backdropTextures, shadowTexture, refreshTierChips, silhouetteTexture } from './textures.js';
import { TILE_H, TIER_COLORS, COLORS } from './style.js';
import { createAssets, assets as defaultAssets } from '../assets.js';
import { loadBoardArt } from './boardArt.js';
import { ImpostorAtlas } from './impostor.js';
import { loadThree, loadBoardPack, webgl2Available, boardArtListed } from './board3d/load.js';
import { BoardScene } from './board3d/scene.js';
import { AREAS, areaFor, unionAreas } from './board3d/layout.js';
import { layoutPen, penSignature } from './pen.js';
import { IDENTITY, bossPrepField, tilesToDisp, leaderStand } from './prepfield.js';
import { pickOnTile, pickBattle, hitRectAt, hitTiles } from './pick.js';
import { promotionsOf } from './promote.js';

const VENDOR = { pixi: '/vendor/pixi.min.js', spine: '/vendor/pixi-spine.js' };
const PIECE_DIRS = new Set(['UP', 'RIGHT', 'DOWN', 'LEFT']);
/** Stored facing of a prep piece (m.private board pieces carry `dir`; bench pieces have none ⇒ undefined). */
const pieceDirOf = (piece) => (typeof piece?.dir === 'string' && PIECE_DIRS.has(piece.dir.toUpperCase()) ? piece.dir.toUpperCase() : undefined);
const CAMERA_MS = 750;
/** Camera pan to / from the enemy preview pen (configBlackBoard move_time 0.25). */
export const PEN_CAMERA_MS = 250;
/** Recovery of a lost 3D board context: delays of the rebuild attempts (ms) and how soon a new loss counts as failure. */
const BOARD3D_RETRY_MS = [1200, 4000, 12000];
const BOARD3D_STABLE_MS = 10000;
/** Highlight groups that show a unit's range: never drawn on bench / temp pads (they are not part of any battle). */
const RANGE_GROUPS = new Set(['facing', 'range', 'rangeStand', 'select', 'sel', 'selRange']);
/**
 * The round leader's hit tiles, lit beside an operator's range preview in the Final Assault / Hidden Core prep (see the
 * header; community report #12 "boss受击范围可以像官方原版那样用红色"). [ASSUMED] the red and its strength: the players' request,
 * no source shows the official colour; the range preview stays orange.
 */
export const LEADER_HIT_STYLE = Object.freeze({ group: 'leaderHit', color: 0xff3b30, fill: 0.3, line: 0.95 });
/** atk projectile kinds whose first id is the previous bounce target (sim ai.js), not the attacker. */
const CHAIN_KINDS = new Set(['chain', 'chainHeal']);
const DROP_PENDING_MS = 1300;
/**
 * A dragged unit is held with its drawn feet this many tiles below the pointer — the pointer on its body, the model
 * under the finger / mouse (user playtest #4 item 1: as in v2.1; mouse and touch alike). An item plate is centred on it.
 */
export const DRAG_HOLD_TILES = 0.45;

/**
 * A view as a render/pick.js unit, or null when it cannot be picked (gone, faded out, dead): standing on the display
 * tile it is drawn on, or — `walks` (battle enemies) — by its ground position and its drawn body (feet to head, on
 * screen; a flying one by its body alone).
 */
function pickUnitOf(v, walks = false, hitArea = null) {
  // a knocked-out operator lying on its tile waiting to redeploy (b.snap `down`, user playtest #4 item 9) is on that tile
  // too: a press there selects it; other dead / dying views are gone
  if (!v || v.destroyed || (v.alive === false && !v.down)) return null;
  if (Number.isFinite(v.alpha) && v.alpha < 0.05) return null;
  const sc = v.screen;
  const body = walks && sc && sc.s > 0 && !v.culled ? { x: sc.x, top: Number.isFinite(sc.top) ? sc.top : sc.y, feet: sc.y, s: sc.s } : null;
  const tile = walks ? null : { row: Math.round(v.y), col: Math.round(v.x) };
  // a huge boss (data `hitArea`): its hit area on the ground and a body box as wide as it are pickable (render/pick.js)
  const area = walks && !v.flying ? hitRectAt(v.x, v.y, hitArea) : null;
  if (area && body) body.hw = hitArea.w / 2;
  return { tile, x: v.x, y: v.y, fly: walks && !!v.flying, body, area, depth: v.root && !v.root.destroyed ? v.root.zIndex : 0, ref: v };
}

let pixiPromise = null;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/** Make sure PIXI and PIXI.spine exist (classic scripts; loaded once). */
export function ensurePixi() {
  if (globalThis.PIXI && globalThis.PIXI.spine) return Promise.resolve(globalThis.PIXI);
  if (!pixiPromise) {
    pixiPromise = (async () => {
      if (!globalThis.PIXI) await loadScript(VENDOR.pixi);
      if (!globalThis.PIXI?.spine) await loadScript(VENDOR.spine);
      if (!globalThis.PIXI || !globalThis.PIXI.spine) throw new Error('PIXI / pixi-spine unavailable');
      return globalThis.PIXI;
    })();
    pixiPromise.catch(() => { pixiPromise = null; });
  }
  return pixiPromise;
}

const VIEW_KINDS = new Set(['prep', 'normal', 'unite', 'boss', 'bossPrep', 'pen']);

/**
 * The field a camera request actually shows — what render/projection.js presetCamera frames: 'hidden' → 'boss';
 * a 'prep' camera asked for the boss rows (Final Assault prep: rect r1 ≤ 6) → 'bossPrep'; unknown kinds → 'normal'.
 * Drives the built 3D area, the drawn 2D rows and the lit rect, so they always match the camera.
 */
export function viewKind(kind, opts) {
  let k = kind === 'hidden' ? 'boss' : kind;
  if (!VIEW_KINDS.has(k)) k = 'normal';
  if (k === 'prep' && opts && opts.rect && normRect(opts.rect).r1 <= 6) k = 'bossPrep';
  return k;
}

/** 3D areas without the enemy preview pen block (the own field / both normal halves); see `boardArea`. */
const AREA_NO_PEN = Object.freeze({
  normal: Object.freeze(AREAS.normal.filter((a) => a.r1 <= 13)),
  unite: Object.freeze(AREAS.unite.filter((a) => a.r1 <= 13)),
});

/**
 * 3D area built for a view kind (viewKind): the enemy preview pen (rows 14–18) only for the 'pen' camera — the prep,
 * battle and 联防 cameras show the field alone (user playtest #2 item 6) with its separator rows 6 and 13 (the row-13
 * devices blow into the field: act2 m01's blowers, user playtest #5 item 6; the boss field's row-6 devices are drawn
 * with the boss field only — board3d/layout.js stageDevices); the boss kinds build the boss field.
 */
export function boardArea(vk) {
  if (vk === 'pen') return AREAS.normal;
  if (vk === 'prep' || vk === 'normal') return AREA_NO_PEN.normal.length ? AREA_NO_PEN.normal : AREAS.normal;
  if (vk === 'unite') return AREA_NO_PEN.unite.length ? AREA_NO_PEN.unite : AREAS.unite;
  return areaFor(vk);
}

/**
 * 2D rows drawn for a view kind: the pen rows (14–18) only for the 'pen' camera; the boss field with the separator
 * and the normal rows behind it as scenery.
 */
export function bandFor(kind) {
  if (kind === 'boss' || kind === 'hidden' || kind === 'bossPrep') return [0, 13];
  return kind === 'pen' ? [6, 18] : [6, 13];
}

/**
 * Active field rows [r0, r1] of a view kind for the 2D board (render/tiles.js `setView` field: drawn rows outside it are
 * dim scenery without devices): the normal / 联防 / prep fields live between the separator walls (rows 6–13, the
 * devices on the row-13 wall included; the row-6 wall's belong to the boss field — tiles.js _stageDevices); the pen
 * camera adds the pen (6–18); the boss field 0–6.
 */
export function fieldRows(kind) {
  return kind === 'boss' || kind === 'hidden' || kind === 'bossPrep' ? [0, 6] : kind === 'pen' ? [6, 18] : [6, 13];
}

/** Are the pen's figures shown for a view kind (a camera flight shows them when either end is the pen)? */
export const penShown = (vk, prevVk = null) => vk === 'pen' || prevVk === 'pen';
/** Is the prep's leader on the boss field shown for a view kind (a flight shows it when either end is the boss-field prep)? */
export const leaderShown = (vk, prevVk = null) => vk === 'bossPrep' || prevVk === 'bossPrep';

/**
 * 'die' reason of an operator that enters the battle already knocked out — a 联防 helper's operator down at the end of
 * its own combat, deployed and forced out at once (server/sim/constants.js FORCED_EXIT, user playtest #5 item 2): its
 * view goes straight to the held knocked-down pose (UnitView.die(true)) without the death burst; b.snap `down` keeps it.
 */
export const FORCED_EXIT = 'forcedExit';

/**
 * Generic death particles for a battle unit's 'die' event: never for stage devices, nor for a summon used up by its
 * own effect (user playtest #2 item 4: 香槟炸弹's blast — sim fx `{ consumed: true, id }` before its 'die' — is its end,
 * not a knock-out), nor for an operator entering the battle knocked out (FORCED_EXIT).
 */
export const showsDeathFx = (info, consumed = false, reason = null) => !consumed && reason !== FORCED_EXIT && info?.kind !== 'device';

/**
 * The views' info of a battle unit from its UnitInfo (m.field / fieldMeta `units`, a 'spawn' event; snapshot.js
 * unitInfo), sanitised; null for a malformed entry. `form` — the unit's current model form (an enemy's, content/enemies.js
 * setForm: 转译基底·α's forms, a 逐火 余烬, a leader after its 重生, 掠海漂移体's crawl; a 傀儡师 fighting as its 替身, sim
 * professions.js) — makes a view built mid-battle (a teammate's
 * field watched later, 联防 observers, a reconnect, server-run watchers: no fx of the change is replayed) start on that
 * clip set (render/units.js FORMS); it used to be dropped here, so such views drew the first form (player report #5).
 */
export function renderInfo(u) {
  if (!u || typeof u !== 'object' || (typeof u.id !== 'number' && typeof u.id !== 'string')) return null;
  return {
    id: u.id, uid: u.uid ?? null, kind: u.kind || 'enemy', side: u.side === 'ally' ? 'ally' : 'enemy', ownerId: u.ownerId ?? null,
    defId: u.defId ?? null, name: u.name ?? '', tier: u.tier ?? 1, golden: !!u.golden, spine: u.spine ?? u.defId ?? null,
    avatar: u.avatar ?? u.defId ?? null, x: Number(u.x) || 0, y: Number(u.y) || 0, facing: u.facing === -1 ? -1 : 1,
    maxHp: Number(u.maxHp) || 1, boss: !!u.boss, motion: u.motion,
    // deploy direction of allies (UnitInfo.dir, DESIGN §3): the model (Back for UP, mirrored for LEFT) and the
    // ground wedge follow it; absent = unknown (legacy frames) → derived from `facing`, no wedge
    dir: typeof u.dir === 'string' ? u.dir : undefined,
    // the unit's current model form (UnitInfo.form: an enemy's mode, a 傀儡师's 替身): the view starts in it (UnitView reads info.form)
    form: typeof u.form === 'string' ? u.form : undefined,
    // DESIGN §16 loadout of an ally (UnitInfo.skillIndex / moduleId): the Spine actor plays that skill's clip, and a
    // tap hands them to the detail card (a teammate's unit shows its owner's skill / module)
    skillIndex: Number.isInteger(u.skillIndex) ? u.skillIndex : undefined,
    moduleId: typeof u.moduleId === 'string' ? u.moduleId : undefined,
    // the ally's equipped item ids (UnitInfo.items, DESIGN §16 / §21.11): the detail card needs them for a teammate's
    // unit (resolveDetail `unitItems` → the read-only 装备 section and the 变形同构体 pairing chips); the owner's own
    // unit takes its items from the piece instead, so only other players' boards ever read this field
    items: Array.isArray(u.items) ? u.items.filter((x) => typeof x === 'string') : undefined,
  };
}

/** '2d' | '3d' | 'auto' board preference: `?board=` in the page URL (dev), else the view option. */
export function boardPreference(opt) {
  let q = null;
  try { q = new URLSearchParams(globalThis.location?.search || '').get('board'); } catch { /* no location */ }
  const v = q || opt;
  return v === '2d' || v === '3d' ? v : 'auto';
}

/**
 * A battle device box (render/units.js DeviceView `ctx.createBox()` contract: `{ mesh, update(cam, b), destroy() }`)
 * that follows the board layer: the 3D scene's crate mesh while `board()` returns a BoardScene, else the Pixi box of
 * the 2D board. A board switch mid-battle (lost WebGL context → 2D, or back to 3D) swaps the inner box on the next
 * update instead of leaving the crate on a dead scene. `mesh` is the Pixi mesh (null in 3D: nothing to add to Pixi).
 */
export function switchableBox({ board, pixi }) {
  let inner = null, owner;
  const drop = () => { try { inner?.destroy(); } catch { /* ignore */ } inner = null; owner = undefined; };
  return {
    get mesh() { return inner ? inner.mesh || null : null; },
    get inner() { return inner; },
    update(cam, b) {
      const scene = board() || null;
      if (!inner || owner !== scene || inner.destroyed) {
        drop();
        inner = scene ? scene.createDevice() : pixi();
        owner = scene;
      }
      inner?.update(cam, b);
    },
    destroy: drop,
  };
}

function withTimeout(p, ms) {
  return Promise.race([p, new Promise((resolve) => setTimeout(resolve, ms))]);
}

/** Wrap whatever the caller passed as `assets` into the store API of public/js/assets.js. */
function resolveAssets(a) {
  if (a && typeof a === 'object' && typeof a.ready === 'function' && typeof a.spineEntry === 'function') return a;
  if (a && typeof a === 'object' && (a.chars || a.enemies || a.version)) return createAssets({ manifest: a });
  return defaultAssets;
}

function makeData(src) {
  const look = (file, id) => {
    if (id == null || id === '') return null;
    try {
      if (src && typeof src.lookup === 'function') return src.lookup(file, id) || null;
      const m = src && src[file];
      if (m instanceof Map) return m.get(id) || null;
      if (m && typeof m === 'object' && Object.hasOwn(m, id)) return m[id] || null;
    } catch { /* ignore */ }
    return null;
  };
  return {
    chess: (id) => look('chess', id), token: (id) => look('tokens', id), item: (id) => look('items', id),
    enemy: (id) => look('enemies', id), stage: (id) => look('stages', id), bond: (id) => look('bonds', id),
  };
}

const QUALITY_RES = { high: 2, medium: 1.5, low: 1 };
/** Pixel-ratio cap of the 3D board canvas per quality (its fill cost is the PBR board, not the sprites). */
const BOARD_RES = { high: 2, medium: 1.25, low: 1 };

/**
 * Before a renderer is destroyed: free its GL copies of every texture / buffer / geometry / framebuffer it
 * uploaded. Module-level textures (FX atlas, tier chips, backdrop, diamonds, Spine pages, PIXI.Texture.WHITE…)
 * outlive the view; PIXI 7 leaves their per-context GL entries and 'dispose' listeners pointing at the dead
 * renderer, which kept every unmounted view's renderer, canvas and WebGL context reachable.
 */
export function releaseGl(renderer) {
  const ts = renderer && renderer.texture;
  if (ts && Array.isArray(ts.managedTextures) && typeof ts.destroyTexture === 'function') {
    for (const bt of ts.managedTextures.slice()) { try { ts.destroyTexture(bt, true); } catch { /* ignore */ } }
    ts.managedTextures.length = 0;
  }
  for (const sys of [renderer?.geometry, renderer?.buffer, renderer?.framebuffer]) {
    try { if (sys && typeof sys.disposeAll === 'function') sys.disposeAll(false); } catch { /* ignore */ }
  }
  // shader programs are cached globally by source (PIXI.utils.ProgramCache) with one GLProgram per context
  const uid = renderer?.CONTEXT_UID, gl = renderer?.gl;
  const programs = globalThis.PIXI?.utils?.ProgramCache;
  if (uid != null && programs && typeof programs === 'object') {
    for (const prog of Object.values(programs)) {
      const g = prog && prog.glPrograms && prog.glPrograms[uid];
      if (!g) continue;
      try { if (gl && g.program) gl.deleteProgram(g.program); } catch { /* ignore */ }
      delete prog.glPrograms[uid];
    }
  }
}

/**
 * Create the battlefield view inside `host` (an element sized by CSS; the canvas fills it).
 * @param {HTMLElement} host
 * @param {{ data?: any, assets?: any, audio?: any, settings?: { damageNumbers?: boolean, quality?: string },
 *           padding?: object|((kind:string, size:{width:number,height:number}) => object),
 *           hud?: {top:number,bottom:number}|((kind:'prep'|'bossPrep', size:{width:number,height:number}, o:{shop:boolean}) => {top:number,bottom:number}|null) }} [opts]
 */
export async function createFieldView(host, options = {}) {
  if (!host || typeof host.appendChild !== 'function') throw new TypeError('createFieldView: host element required');
  const opts = options && typeof options === 'object' ? options : {};
  const P = await ensurePixi();
  const assets = resolveAssets(opts.assets);
  const data = makeData(opts.data);
  const settings = { damageNumbers: true, quality: 'high', ...(opts.settings || {}) };
  // the 3D board (three.js + the official art) loads in parallel with everything else
  const boardPref = boardPreference(opts.board);
  const want3d = boardPref !== '2d' && webgl2Available(boardPref === '3d');
  // three.js (~2 MB) is fetched only when the local-art manifest lists the board atlas (in parallel with the art)
  const artListed = want3d ? boardArtListed(assets).catch(() => false) : Promise.resolve(false);
  const threePromise = artListed.then((ok) => (ok ? loadThree() : null));
  const packPromise = artListed.then((ok) => (ok ? Promise.resolve(assets.ready ? assets.ready() : null).catch(() => null).then(() => loadBoardPack(assets)) : null));
  // the manifest, and the optional local-art manifest in parallel: unit views pick an enemy's local-client model by it
  // (assets.js spineEntry, DESIGN §13 — 灼热源石虫 / 炽焰源石虫); absent or slow, they draw the web models
  await withTimeout(Promise.all([assets.ready ? assets.ready() : null, assets.local ? assets.local() : null]
    .map((p) => Promise.resolve(p).catch(() => {}))), 4000);
  // web fonts for the bitmap damage numbers / tier chips (never block long)
  try { if (document.fonts?.load) await withTimeout(Promise.all([document.fonts.load('700 40px Bender'), document.fonts.load('700 40px Oxanium')]), 1500); } catch { /* ignore */ }

  const size = () => ({ width: Math.max(1, host.clientWidth || 1), height: Math.max(1, host.clientHeight || 1) });
  const dpr = () => Math.min(globalThis.devicePixelRatio || 1, QUALITY_RES[settings.quality] || 2);
  const boardDpr = () => Math.min(globalThis.devicePixelRatio || 1, BOARD_RES[settings.quality] || 2);
  const s0 = size();
  const app = new P.Application({
    // MSAA only where it pays: dense (DPR ≥ 1.5) screens are sharp enough without it and it would cost 4× the fill
    // transparent: the 3D board canvas shows through (the 2D board paints an opaque backdrop itself)
    width: s0.width, height: s0.height, antialias: opts.antialias ?? (settings.quality === 'high' && (globalThis.devicePixelRatio || 1) < 1.5), backgroundColor: 0x0a0e0d, backgroundAlpha: 0,
    resolution: dpr(), autoDensity: true, powerPreference: 'high-performance',
  });
  const canvas = app.view;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  canvas.style.userSelect = 'none';
  canvas.setAttribute('aria-label', '战场');
  canvas.style.position = 'relative';
  canvas.style.zIndex = '1';
  host.appendChild(canvas);

  // ---- layers ---------------------------------------------------------------------------------------------
  const stage = app.stage;
  const backdrop = new P.Container();
  const world = new P.Container();
  const layers = {
    ground: new P.Container(), anim: new P.Container(), overlay: new P.Container(), shadow: new P.Container(),
    groundFx: new P.Container(), fxNormal: new P.Container(), units: new P.Container(), fxAdd: new P.Container(),
    bars: new P.Container(), text: new P.Container(), screen: new P.Container(),
  };
  layers.units.sortableChildren = true;
  world.addChild(layers.ground, layers.anim, layers.overlay, layers.shadow, layers.groundFx, layers.fxNormal, layers.units, layers.fxAdd, layers.bars, layers.text);
  stage.addChild(backdrop, world, layers.screen);

  const bg = backdropTextures();
  const bgGrad = new P.Sprite(bg.gradient);
  const bgGrid = new P.TilingSprite(bg.grid, s0.width, s0.height);
  bgGrid.alpha = 0.9;
  const bgMountains = new P.TilingSprite(P.Texture.EMPTY, s0.width, 236);
  bgMountains.tint = 0x1d2b28;
  bgMountains.alpha = 0.9;
  const bgMountains2 = new P.TilingSprite(P.Texture.EMPTY, s0.width, 236);
  bgMountains2.tint = 0x121a18;
  bgMountains2.alpha = 1;
  const bgVignette = new P.Sprite(bg.vignette);
  backdrop.addChild(bgGrad, bgMountains, bgMountains2, bgGrid, bgVignette);
  let mountainsAsked = false;
  /** The backdrop's mountain silhouette (optional art; asked again when the manifest arrives late). */
  function loadMountains() {
    const mountainUrl = !mountainsAsked && assets.ui ? assets.ui('entry/bg_mountains_tiled') : null;
    if (!mountainUrl || !assets.image) return;
    mountainsAsked = true;
    assets.image(mountainUrl).then((img) => {
      if (!img || destroyed) return;
      try { const mt = silhouetteTexture(img); bgMountains.texture = mt; bgMountains2.texture = mt; } catch { /* optional art */ }
    }, () => {});
  }
  loadMountains();

  // ---- state ----------------------------------------------------------------------------------------------
  const listeners = new Map();
  const emit = (name, payload) => {
    const set = listeners.get(name);
    if (!set) return;
    for (const fn of [...set]) { try { fn(payload); } catch (err) { console.error(`[render] ${name} listener failed`, err); } }
  };

  let destroyed = false;
  let mode = 'idle';          // 'idle' | 'prep' | 'battle'
  let stageRec = null;
  let cam = presetCamera('prep', { width: s0.width, height: s0.height, padding: defaultPadding('prep', s0) }, { hud: hudBands('prep', s0) });
  let camFrom = null, camTo = null, camT0 = 0, camKind = 'prep', camOpts = {}, camMs = CAMERA_MS;
  let pendingView = null;     // tile band/focus to apply when the camera transition ends
  const views = new Map();    // key → view (prep: 'p:'+uid; battle: unit id)
  let prepPieces = [];        // { uid, piece, area, idx, row, col, key }
  // the last prep pieces before a battle / scouting board emptied prepPieces: a merge completed between two preps (a band
  // or 机变 grant at ROUND_START, a SETTLE merge) is still recognised by the next setPrep (QA 6b)
  let promoBase = [];
  const promotions = [];      // the last merges cued by setPrep (fx.promote): { uid, id, area, row, col, idx, copies } — dev / tests
  let battleMeta = null;
  let sceneHold = null;       // release function of the Spine cache hold of battle mode (holdScene)
  const infos = new Map();    // battle unit id → UnitInfo
  // battle ids whose view finished its death / leak fade: a snapshot may still list them for a moment (the sim keeps
  // dead units for DIE_ANIM_TIME), which must not bring the view back; a spawn / deploy / live sample clears it
  const gone = new Set();
  const woundUp = new WeakSet(); // atk event tuples whose attack wind-up already started
  const interp = new SnapshotBuffer({ delay: 0.1, rate: 2 });
  const sample = new Map();
  const meleePending = new Map(); // target id → { src, t }
  const consumedIds = new Set();  // battle ids used up by their own effect (fx `consumed`): no death particles
  let canPlaceFn = null;
  let editable = false;
  let dragState = null;       // { uid, key, view, from, home: {x,y,z} }
  const pending = new Map();  // key → { t, home } dropped pieces awaiting the server
  const held = new Map();     // uid → world { x, y, z }: prep pieces pinned to a tile by the direction step (holdPiece)
  let hoverUnit = null;
  let frameMs = 16, fps = 60, lastNow = performance.now();
  const layerPops = new Map();
  // prep field (render/prepfield.js): identity on the own board, the boss-field half in the Final Assault prep
  let prepXf = IDENTITY;
  let lastPrep = null;        // { ps, o } of the last setPrep (re-applied when the prep field changes)
  const hlReq = new Map();    // highlight group → { tiles (board space), style } requested through highlightTiles
  // enemy preview pen (render/pen.js): figure key → UnitView (own map: never touched by the battle sync)
  const penViews = new Map();
  let penSig = null;
  let penHidden = true;       // the pen's figures are shown only by the pen camera (setPenHidden)
  let penList = null;
  let ownPen = null;          // the own m.private.nextEnemies (fallback composition of a scouted teammate's pen)
  let camBeforePen = null;    // { kind, opts } the camera the pen returns to
  let leader = null;          // { key, view, stand, area } the round leader standing on the boss field in the prep (setLeader)
  let leaderHidden = true;    // shown only by the boss-field prep camera (leaderShown)

  const heightAt = (r, c) => (tiles ? tiles.heightAt(r, c) : 0);
  const ctx = {
    P, layers, assets, settings, fx: null, shadowTex: shadowTexture(),
    cam: () => cam, heightAt,
    animRate: () => (mode === 'battle' ? interp.rate : 1),
    timeScale: () => (mode === 'battle' ? interp.rate : 1),
    lookupDef: (info) => (info.side === 'enemy' ? data.enemy(info.defId) : data.chess(info.defId) || data.token(info.defId)),
    crowded: () => views.size > 90,
    renderer: app.renderer,
    frameNo: () => frameNo,
    impostorInterval: () => impInterval,
    clipAllowed: () => clipAllowed,
    viewport: () => vp,
    loadLevel: () => loadLevel,
    surfaceLayer: (row) => tiles.surfaceLayer(row),
  };
  const tiles = new TileField({ ground: layers.ground, overlay: layers.overlay, props: layers.units, anim: layers.anim });
  const fx = new FxSystem({
    P, layers, cam: () => cam, settings, assets, heightAt, redVignette: bg.red, surfaceLayer: ctx.surfaceLayer,
    timeScale: () => ctx.timeScale(),
    loadLevel: () => loadLevel,
    fieldRect: () => (mode === 'battle' && battleMeta ? battleMeta.rect : null),
    subProfOf: (defId) => data.chess(defId)?.subProfessionId || null,
    view: (id) => views.get(id) || null,
    screenSize: size,
    fieldTop: () => {
      const R = camRect();
      const p = cam.project((R.c0 + R.c1) / 2, R.r1 + 0.5, 1.6);
      return Math.max(80, Math.min(size().height * 0.4, p.y));
    },
  });
  ctx.fx = fx;
  // battle devices (crates / turrets as sim units): the official crate mesh in the 3D scene, else a Pixi box
  ctx.createBox = () => switchableBox({ board: () => board3d, pixi: () => tiles.createBox() });
  const impostors = new ImpostorAtlas(app.renderer);
  ctx.impostors = impostors;
  tiles.setView(bandFor('prep'), camRect(), fieldRows('prep'));
  // the real board art of the local client (optional): wait briefly so the first frame already uses it; a late
  // arrival swaps the atlas in place
  const artPromise = loadBoardArt(assets).then((art) => {
    if (art && !destroyed) { tiles.setArt(art); tiles.project(cam, true); }
    return art;
  }, () => null);
  await withTimeout(artPromise, 2500);

  // ---- 3D board layer (render/board3d, DESIGN §15) -----------------------------------------------------------
  let board3d = null;          // BoardScene while the 3D board is on
  let board3dCanvas = null;
  let board3dError = null;
  // lost-context recovery: the THREE module + art pack of the last 3D board, the pending retry, failures so far
  const recover = { THREE: null, pack: null, timer: 0, tries: 0, since: 0, off: false, count: 0 };
  function enable3d(THREE, pack) {
    if (destroyed || board3d || !THREE || !pack) return false;
    recover.THREE = THREE; recover.pack = pack;
    try {
      try { if (getComputedStyle(host).position === 'static') host.style.position = 'relative'; } catch { /* ignore */ }
      const c3 = document.createElement('canvas');
      c3.setAttribute('aria-hidden', 'true');
      Object.assign(c3.style, { position: 'absolute', left: '0', top: '0', width: '100%', height: '100%', display: 'block', pointerEvents: 'none', zIndex: '0' });
      host.insertBefore(c3, canvas);
      board3dCanvas = c3;
      const b = new BoardScene(THREE, pack, {
        canvas: c3, antialias: settings.quality !== 'low' && (globalThis.devicePixelRatio || 1) < 2, shadows: settings.quality !== 'low',
      });
      const sz = size();
      b.resize(sz.width, sz.height, boardDpr());
      board3d = b;
      tiles.setExternal(true);
      backdrop.visible = false;
      b.setArea(boardArea(viewKind(camKind, camOpts)));
      if (stageRec) b.setStage(stageRec);
      b.setFocus(camRect());
      b.setBattleRect(mode === 'battle' && battleMeta ? battleMeta.rect : null);
      tiles.project(cam, true);
      recover.since = performance.now();
      for (const [g, r] of hlReq) drawHighlight(r.tiles, r.style, g);
      return true;
    } catch (err) {
      board3dError = String(err?.message || err);
      console.warn('[render] 3D board unavailable, using the 2D board:', err);
      disable3d();
      return false;
    }
  }
  function disable3d() {
    const b = board3d;
    board3d = null;
    try { b?.destroy(); } catch { /* ignore */ }
    try { board3dCanvas?.remove(); } catch { /* ignore */ }
    board3dCanvas = null;
    if (!destroyed) {
      tiles.setExternal(false); backdrop.visible = true; tiles.project(cam, true);
      for (const [g, r] of hlReq) drawHighlight(r.tiles, r.style, g);
    }
  }
  /**
   * The 3D board's WebGL context was lost (GPU reset, driver, too many contexts): the 2D board takes over at once and a
   * fresh 3D board (new canvas + context) is built a moment later. A board that loses its context again within
   * BOARD3D_STABLE_MS counts as a failed try; after BOARD3D_RETRY_MS.length failures the view stays on the 2D board.
   */
  function onBoard3dLost() {
    console.warn('[render] WebGL context of the 3D board lost: 2D board until it can be rebuilt');
    const quick = performance.now() - recover.since < BOARD3D_STABLE_MS;
    disable3d();
    recover.count++;
    if (!quick) recover.tries = 0;
    scheduleRecover();
  }
  function scheduleRecover() {
    clearTimeout(recover.timer);
    recover.timer = 0;
    if (destroyed || recover.off || !recover.THREE || !recover.pack || recover.tries >= BOARD3D_RETRY_MS.length) return;
    const delay = BOARD3D_RETRY_MS[recover.tries++];
    recover.timer = setTimeout(() => {
      recover.timer = 0;
      if (destroyed || recover.off || board3d) return;
      if (!webgl2Available(boardPref === '3d')) { scheduleRecover(); return; }
      if (!enable3d(recover.THREE, recover.pack)) scheduleRecover();
    }, delay);
  }
  if (want3d) {
    const ready = Promise.all([threePromise, packPromise]).then(([THREE, pack]) => (THREE && pack ? enable3d(THREE, pack) : false), () => false);
    await withTimeout(ready, 6000);
  }
  // the official soft shadow sprite replaces the procedural one once loaded (may already be cached; asked again when the
  // manifest arrives late)
  let shadowAsked = false;
  function loadShadow() {
    const shadowUrl = !shadowAsked && assets.ui ? assets.ui('battle/sprite_shadow') : null;
    if (!shadowUrl) return;
    shadowAsked = true;
    try {
      const t = P.Texture.from(shadowUrl);
      const use = () => {
        if (destroyed) return;
        ctx.shadowTex = t;
        for (const v of views.values()) if (v.shadow && !v.destroyed) v.shadow.texture = t;
        for (const v of penViews.values()) if (v.shadow && !v.destroyed) v.shadow.texture = t;
      };
      if (t.baseTexture.valid) use(); else t.baseTexture.once('loaded', use);
    } catch { /* optional */ }
  }
  loadShadow();
  ensureDamageFonts();
  // web fonts may land after the first chips were drawn
  if (document.fonts?.ready) document.fonts.ready.then(() => { if (!destroyed) refreshTierChips(); }).catch(() => {});

  // ---- camera ---------------------------------------------------------------------------------------------

  function defaultPadding(kind, sz) {
    if (typeof opts.padding === 'function') { try { const p = opts.padding(kind, sz); if (p) return p; } catch { /* ignore */ } }
    if (opts.padding && typeof opts.padding === 'object') return opts.padding;
    const w = sz.width, h = sz.height;
    if (kind === 'prep' || kind === 'bossPrep') return { top: h * 0.1, bottom: h * 0.24, left: Math.min(170, w * 0.09), right: w * 0.05 };
    if (kind === 'boss' || kind === 'unite') return { top: h * 0.13, bottom: h * 0.1, left: Math.min(150, w * 0.08), right: w * 0.02 };
    return { top: h * 0.13, bottom: h * 0.12, left: Math.min(170, w * 0.09), right: w * 0.05 };
  }

  // the HUD bands the prep cameras keep the bench / field clear of (projection.js clearHud; user playtest #5 item 9):
  // `opts.hud` = (kind, size, { shop }) => { top, bottom } | null, or a fixed object; none → the plain official framing.
  // `shop: false` asks for the folded shop's band (the camera request's `shop: false`, public issue #5)
  function hudBands(kind, sz, o) {
    if (kind !== 'prep' && kind !== 'bossPrep') return null;
    if (typeof opts.hud === 'function') { try { return opts.hud(kind, sz, o) || null; } catch { return null; } }
    return opts.hud && typeof opts.hud === 'object' ? opts.hud : null;
  }

  function camRect() {
    const k = viewKind(camKind, camOpts);
    if (k === 'pen') return { r0: 14, r1: 18, c0: 7, c1: 13 };
    // prep lights the bench (hand row 7 / temp row 8) with the field, like the official prep view
    if (camOpts.rect) { const r = normRect(camOpts.rect); return k === 'prep' ? { ...r, r0: Math.min(r.r0, GEO.HAND_ROW) } : r; }
    if (k === 'bossPrep') return camOpts.side === 'R' ? { r0: 0, r1: 5, c0: 10, c1: 20 } : { r0: 0, r1: 5, c0: 0, c1: 10 };
    return k === 'boss' ? { ...GEO.BOSS_RECT } : k === 'unite' ? { ...GEO.UNITE_RECT } : k === 'prep' ? { r0: 7, r1: 12, c0: 0, c1: 10 } : { ...GEO.NORMAL_RECT };
  }

  function targetCamera(kind, o) {
    const sz = size();
    const k = kind === 'hidden' ? 'boss' : (['prep', 'normal', 'unite', 'boss', 'bossPrep', 'pen'].includes(kind) ? kind : 'normal');
    let rect = o.rect ? normRect(o.rect) : null;
    if (k === 'prep') rect = rect ? { ...rect, r0: Math.min(rect.r0, GEO.HAND_ROW) } : null;
    // official configBlackBoard framing (render/projection.js presetCamera); the padding only matters for the
    // fitted fallback (custom rects, portrait viewports); a prep camera keeps the bench and the field clear of the HUD
    // — `shop: false` (the folded shop, public issue #5) = the official shop-collapsed camera, clear of the folded
    // shop's HUD band (re-evaluated on resize: camOpts keep the flag)
    const vk = viewKind(kind, o); // (a 'prep' camera on the boss rows = the Final Assault prep)
    return presetCamera(k, { width: sz.width, height: sz.height, padding: o.padding || defaultPadding(k, sz) }, {
      rect, side: o.side, half: !!o.half, shop: o.shop, fit: !!o.fit, config: stageRec?.config || null,
      hud: hudBands(vk, sz, { shop: o.shop !== false }),
    });
  }

  // rows drawn per camera kind: module `bandFor`; the active field rows: module `fieldRows`

  function setCamera(kind, options) {
    if (destroyed) return false;
    let o = options && typeof options === 'object' ? options : {};
    const prevView = viewKind(camKind, camOpts);
    const prevBand = bandFor(prevView), prevField = fieldRows(prevView);
    const nextKind = typeof kind === 'string' ? kind : 'normal';
    // the enemy pen is a detour of the prep camera: remember where it came from; the same kind asked again without
    // framing options goes back to exactly that camera (Final Assault half, shop state…)
    const framing = (x) => Object.keys(x).some((k) => k !== 'instant' && k !== 'ms' && x[k] !== undefined);
    if (viewKind(nextKind, o) === 'pen') {
      if (prevView !== 'pen') camBeforePen = { kind: camKind, opts: { ...camOpts, instant: undefined, ms: undefined } };
    } else if (prevView === 'pen' && camBeforePen && nextKind === camBeforePen.kind && !framing(o)) {
      o = { ...camBeforePen.opts, instant: o.instant, ms: o.ms };
    }
    camKind = nextKind;
    camOpts = { ...o };
    // the field actually shown (a 'prep' camera on the boss rows is the Final Assault prep: boss field built / drawn)
    const vk = viewKind(camKind, camOpts);
    if (vk === 'prep') setPrepField(IDENTITY);
    else if (vk === 'bossPrep') setPrepField(bossPrepField(camOpts.side === 'R' ? 'R' : 'L'));
    const target = targetCamera(camKind, camOpts);
    const band = bandFor(vk);
    const field = fieldRows(vk);
    const focus = camRect();
    board3d?.setFocus(focus);
    camMs = Number.isFinite(o.ms) && o.ms >= 0 ? o.ms : (vk === 'pen' || prevView === 'pen' ? PEN_CAMERA_MS : CAMERA_MS);
    if (o.instant || camMs === 0 || mode === 'idle' && !camTo) {
      board3d?.setArea(boardArea(vk));
      cam = target; camFrom = camTo = null;
      tiles.setView(band, focus, field);
      setPenHidden(!penShown(vk));
      setLeaderHidden(!leaderShown(vk));
      pendingView = null;
    } else {
      camFrom = cam.clone();
      camTo = target;
      camT0 = performance.now();
      // keep both fields drawn (and lit) while the camera flies between them
      tiles.setView([Math.min(prevBand[0], band[0]), Math.max(prevBand[1], band[1])], focus, [Math.min(prevField[0], field[0]), Math.max(prevField[1], field[1])]);
      board3d?.setArea(unionAreas(boardArea(prevView), boardArea(vk)));
      setPenHidden(!penShown(vk, prevView));
      setLeaderHidden(!leaderShown(vk, prevView));
      pendingView = { band, focus, field, area: boardArea(vk), pen: penShown(vk), leader: leaderShown(vk) };
    }
    return true;
  }

  /**
   * Where the prep pieces stand (render/prepfield.js): the own board, or the player's half of the boss field in the
   * Final Assault prep. A change re-homes the pieces and re-draws the board-space highlight requests.
   */
  function setPrepField(xf) {
    const next = xf || IDENTITY;
    if (next.kind === prepXf.kind && next.side === prepXf.side) return;
    prepXf = next;
    if (mode !== 'prep') return;
    if (lastPrep) setPrep(lastPrep.ps, lastPrep.o);
    for (const e of prepPieces) {
      const v = views.get(e.key);
      if (e.area === 'board' && v && typeof v.setDir === 'function') v.setDir(prepXf.dirToDisp(pieceDirOf(e.piece) || 'RIGHT'));
    }
    for (const [group, req] of hlReq) drawHighlight(req.tiles, req.style, group);
    faceLeader();
    syncLeaderHits();
  }

  function stepCamera(now) {
    if (!camTo) return;
    const k = camMs > 0 ? Math.min(1, (now - camT0) / camMs) : 1;
    const e = easeInOutCubic(k);
    if (!cam || cam === camFrom) cam = new Camera();
    lerpCamera(camFrom, camTo, e, cam);
    if (k >= 1) {
      cam = camTo; camFrom = camTo = null;
      if (pendingView) {
        tiles.setView(pendingView.band, pendingView.focus, pendingView.field);
        board3d?.setArea(pendingView.area);
        setPenHidden(!pendingView.pen);
        setLeaderHidden(!pendingView.leader);
        pendingView = null;
        tiles.project(cam, true);
      }
    }
  }

  // ---- backdrop -------------------------------------------------------------------------------------------

  function layoutBackdrop() {
    const { width, height } = size();
    bgGrad.width = width; bgGrad.height = height;
    bgVignette.width = width; bgVignette.height = height;
    bgGrid.width = width; bgGrid.height = height;
    bgMountains.width = width; bgMountains2.width = width;
  }

  function updateBackdrop(t) {
    const { height } = size();
    // horizon ≈ projection of the far rows; mountains sit behind the board
    const horizon = Math.max(0, cam.project(cam.tx, cam.ty + 16, 0).y);
    bgMountains.position.set(0, Math.min(height * 0.35, horizon) - 150);
    bgMountains2.position.set(0, Math.min(height * 0.35, horizon) - 95);
    bgMountains.tilePosition.x = -cam.tx * 12 + t * 2;
    bgMountains2.tilePosition.x = -cam.tx * 22 + 300;
    bgMountains2.tileScale.set(1.25);
    bgGrid.tilePosition.set(-cam.tx * 30, -cam.ty * 10);
  }

  // ---- stage ----------------------------------------------------------------------------------------------

  function setStage(st) {
    if (!st || typeof st !== 'object' || !Array.isArray(st.rows)) return false;
    stageRec = st;
    tiles.setStage(st);
    tiles.setBattleRect(mode === 'battle' && battleMeta ? battleMeta.rect : null);
    if (board3d) { board3d.setStage(st); board3d.setBattleRect(mode === 'battle' && battleMeta ? battleMeta.rect : null); }
    tiles.project(cam, true);
    // a pen laid out before the stage arrived (setPrep / a scouting board first) used the default zones and the old
    // tile heights: lay it out again on this stage
    if (penList) { const l = penList; clearPen(); setPenList(l); }
    return true;
  }

  // ---- views ----------------------------------------------------------------------------------------------

  function dropView(key) {
    const v = views.get(key);
    if (!v) return;
    views.delete(key);
    if (hoverUnit === v) hoverUnit = null;
    try { v.destroy(); } catch (err) { console.warn('[render] view destroy', err); }
  }

  function clearViews(prefix) {
    for (const k of [...views.keys()]) if (prefix == null || String(k).startsWith(prefix)) dropView(k);
  }

  // ---- prep -----------------------------------------------------------------------------------------------

  function pieceInfo(piece, area) {
    const kind = piece.kind;
    // board pieces face their stored dir (the server default RIGHT when absent), drawn through the prep field (mirrored
    // on the right half of the Final Assault prep); bench pieces face right
    const dir = area === 'board' ? dispDir(pieceDirOf(piece) || 'RIGHT') : undefined;
    if (kind === 'item') {
      const rec = data.item(piece.id);
      const tier = rec?.tier || piece.tier || 1;
      const url = assets.itemIcon ? assets.itemIcon(rec ? { trapId: rec.trapId, iconId: rec.iconId } : piece.id) : null;
      return { kind: 'item', defId: piece.id, icon: url, color: (piece.golden || rec?.isGolden) ? 0xffc600 : TIER_COLORS[tier] || TIER_COLORS[1] };
    }
    if (kind === 'token') {
      const rec = data.token(piece.id);
      return { kind: 'token', side: 'ally', defId: piece.id, spine: rec?.assets?.spine || piece.id, avatar: rec?.assets?.avatar || piece.id, tier: piece.tier || 1, golden: false, dir };
    }
    const rec = data.chess(piece.id);
    return {
      kind: 'op', side: 'ally', defId: piece.id,
      spine: rec?.assets?.spine || rec?.charId || null, avatar: rec?.assets?.avatar || rec?.charId || null,
      tier: rec?.tier || piece.tier || 1, golden: !!(piece.golden || rec?.isGolden), dir,
    };
  }

  /** Board-space direction → the direction drawn (mirrored on the right half of the Final Assault prep). */
  function dispDir(d) { return d ? prepXf.dirToDisp(d) : d; }
  /** Board-space tile → world point of its top (the prep field transform applied). */
  function boardWorld(row, col, bench = false) {
    const d = prepXf.toDisp(row, col);
    return { x: d.col, y: d.row, z: bench ? TILE_H.bench : heightAt(d.row, d.col) };
  }
  /** The tile under a canvas point in BOARD space (null off-grid; an impossible tile off the player's half). */
  function pickBoardTile(x, y) {
    const t = pickTile(cam, x, y, heightAt, tiles.levels);
    if (!t || prepXf === IDENTITY) return t;
    const b = prepXf.toBoard(t.row, t.col);
    return b ? { ...t, row: b.row, col: b.col } : { row: -1, col: -1, x: t.x, y: t.y };
  }

  function slotWorld(p) {
    const h = held.get(p.uid);
    if (h) return h;
    const t = pieceTile(p);
    if (!t) return null;
    return boardWorld(t.row, t.col, p.area === 'hand' || p.area === 'temp');
  }

  function setPrep(ps, options) {
    if (destroyed) return false;
    const o = options && typeof options === 'object' ? options : {};
    if (mode !== 'prep') enterPrepMode();
    lastPrep = { ps, o };
    editable = !!o.editable;
    canPlaceFn = typeof o.canPlace === 'function' ? o.canPlace : null;
    drag.setCanPlace(canPlaceFn ? adaptCanPlace(canPlaceFn) : null);
    drag.setEditable(editable);
    const list = [];
    const addList = (arr, area) => {
      if (!Array.isArray(arr)) return;
      arr.forEach((pc, i) => {
        if (!pc || typeof pc !== 'object' || !Number.isInteger(pc.uid)) return;
        if (area === 'board') {
          if (!Number.isInteger(pc.row) || !Number.isInteger(pc.col)) return;
          list.push({ piece: pc, area, row: pc.row, col: pc.col, uid: pc.uid });
        } else list.push({ piece: pc, area, idx: i, uid: pc.uid });
      });
    };
    const src = ps && typeof ps === 'object' ? ps : {};
    ownPen = Array.isArray(src.nextEnemies) ? src.nextEnemies : null;
    setPenList(ownPen);
    addList(src.hand, 'hand');
    addList(src.temp, 'temp');
    addList(src.board, 'board');
    const seen = new Set();
    const prevBoard = new Set(prepPieces.filter((p) => p.area === 'board').map((p) => p.uid));
    // merges since the last state (render/promote.js): new elite uid → where its consumed copies stood (their views
    // still exist until the sweep below) — the elite gets the promotion cue instead of the deploy flash
    const promoFrom = new Map();
    const before = prepPieces.length ? prepPieces : promoBase;
    promoBase = [];
    for (const [uid, copies] of promotionsOf(before, list, (id) => data.chess(id))) {
      // the consumed copies' views (gone after a battle rebuilt the scene: their slots instead) — the streaks' origins
      promoFrom.set(uid, copies.map((g) => {
        const cv = views.get(g.key);
        if (cv && !cv.destroyed) return { x: cv.x, y: cv.y, z: cv.z || 0 };
        const w = slotWorld(g);
        return w ? { x: w.x, y: w.y, z: w.z || 0 } : null;
      }).filter(Boolean));
    }
    for (const e of list) {
      if (seen.has(e.uid)) continue; // duplicate uid in bad state: keep the first
      seen.add(e.uid);
      const key = 'p:' + e.uid;
      e.key = key;
      const info = pieceInfo(e.piece, e.area);
      const sig = `${info.kind}|${info.defId}|${info.golden ? 1 : 0}`;
      let v = views.get(key);
      if (v && v._sig !== sig) { dropView(key); v = null; }
      const w = slotWorld(e);
      if (!w) continue;
      if (!v) {
        // board pieces are built facing their stored dir (no Front → Back swap after every round's rebuild)
        const full = { ...info, id: key, uid: e.uid, x: w.x, y: w.y, facing: info.dir === 'LEFT' ? -1 : 1, maxHp: 1 };
        v = info.kind === 'item' ? new ItemView(ctx, full) : new UnitView(ctx, full, { prep: true });
        v._sig = sig;
        v.setWorld(w.x, w.y, w.z);
        views.set(key, v);
        if (promoFrom.has(e.uid)) {
          // a merge's elite: on the tile of the deployed copy it replaced, or on its bench slot
          if (e.area === 'board') v.onDeploy?.();
          fx.promote(v, promoFrom.get(e.uid).filter((f) => Math.abs(f.x - w.x) + Math.abs(f.y - w.y) > 1e-3));
          promotions.push({ uid: e.uid, id: e.piece.id, area: e.area, row: e.row ?? null, col: e.col ?? null, idx: e.idx ?? null, copies: promoFrom.get(e.uid).length });
          if (promotions.length > 20) promotions.shift();
        } else if (e.area === 'board' && prevBoard.size && !prevBoard.has(e.uid)) { v.onDeploy?.(); fx.deploy(v); }
        else if (before.length && (e.area === 'hand' || e.area === 'temp') && !before.some((g) => g.uid === e.uid)) fx.deploy(v);
      } else {
        const prevHome = v._home;
        const moved = !prevHome || prevHome.x !== w.x || prevHome.y !== w.y || prevHome.z !== w.z;
        if (dragState && dragState.key === key) {
          dragState.home = w;                       // being dragged: only its home slot changes
        } else if (pending.has(key) && !moved && !splitLanded(e, pending.get(key).board, list)) {
          // dropped, but this state predates the server applying the move: stay at the drop target
        } else {
          pending.delete(key);
          if (moved || Math.abs(v.x - w.x) + Math.abs(v.y - w.y) > 1e-3) v._tween = { fx: v.x, fy: v.y, fz: v.z, tx: w.x, ty: w.y, tz: w.z, t: 0 };
          v.lift = 0;
          if (e.area === 'board' && !prevBoard.has(e.uid) && v.onDeploy) { v.onDeploy(); fx.deploy(v); }
        }
      }
      v._home = w;
      v.dimmed = false;
      if (info.kind === 'item' && v.setIcon) v.setIcon(info.icon); // an icon the manifest named late (onAssets)
      if (v.setCount) v.setCount(e.piece.kind === 'token' ? e.piece.count : 0);
      if (v.setItems) v.setItems(Array.isArray(e.piece.items) ? e.piece.items.map((it) => { const r = data.item(it?.id); return assets.itemIcon ? assets.itemIcon(r ? { trapId: r.trapId, iconId: r.iconId } : it?.id) : null; }) : []);
      v._showFacing = e.area === 'board';
      // the stored facing (a piece held by the direction step shows the wheel's preview instead)
      if (e.area === 'board' && info.dir && !held.has(e.uid) && typeof v.setDir === 'function') v.setDir(info.dir);
    }
    for (const k of [...views.keys()]) if (String(k).startsWith('p:') && !seen.has(Number(String(k).slice(2)))) dropView(k);
    prepPieces = list.filter((e) => e.key && views.has(e.key));
    if (dragState && !views.has(dragState.key)) { drag.reset(); endDragVisual(false); }
    holdScene(false); // the prep pieces reference their models now (a battle's hold ends here)
    return true;
  }

  /**
   * A summon stack of several copies (凯瑟琳's 2 devices, user playtest #6) dropped on a board tile stays in the hand
   * and one copy — a new piece of the same token — lands there: the state already shows the move, the stack goes home.
   */
  function splitLanded(e, tile, list) {
    if (!tile || !e || e.piece?.kind !== 'token' || e.area === 'board') return false;
    return list.some((x) => x.area === 'board' && x.uid !== e.uid && x.piece?.kind === 'token' && x.piece.id === e.piece.id && x.row === tile.row && x.col === tile.col);
  }

  function adaptCanPlace(fn) {
    if (fn.length >= 3) return (piece, row, col, target) => !!fn(piece, row, col, target);
    return (piece, row, col, target) => !!fn(piece.uid, target, piece);
  }

  function enterPrepMode() {
    mode = 'prep';
    held.clear();
    clearViews();
    infos.clear();
    gone.clear();
    battleMeta = null;
    interp.reset();
    fx.clear();
    meleePending.clear();
    consumedIds.clear();
    tiles.setBattleRect(null);
    board3d?.setBattleRect(null);
    clearHl();
  }

  // ---- enemy preview pen (render/pen.js) -----------------------------------------------------------------------

  /** Show a preview list (m.private.nextEnemies shape) in the pen; null / [] empties it. Unchanged lists are kept. */
  function setPenList(list) {
    const sig = Array.isArray(list) && list.length ? penSignature(list) : '';
    if (sig === penSig) return;
    clearPen();
    penSig = sig;
    penList = sig ? list : null;
    if (!sig) return;
    // the leader with a spawn tile stands on the boss field (setLeader), not in the pen
    const stand = leaderStand(list, (k) => data.enemy(k)?.hitArea ?? null, hitTiles);
    setLeader(stand);
    const pen = layoutPen(stand ? list.filter((e) => e !== stand.entry) : list, { stage: stageRec });
    for (const f of pen.figures) {
      const rec = data.enemy(f.enemyKey);
      const rank = rec?.rank;
      const info = {
        id: 'e:' + f.key, kind: 'enemy', side: 'enemy', defId: f.enemyKey, enemyKey: f.enemyKey, preview: true, name: rec?.name || f.enemyKey,
        tier: f.boss || rank === 'BOSS' ? 3 : f.elite || rank === 'ELITE' ? 2 : 1, golden: false,
        spine: rec?.spine || f.enemyKey, avatar: rec?.iconId || rec?.avatar || f.enemyKey,
        x: f.x, y: f.y, facing: -1, maxHp: 1, boss: !!f.boss, motion: f.fly ? 'FLY' : undefined,
      };
      const v = new UnitView(ctx, info, { prep: true, lod: 'idle' });
      v.setWorld(f.x, f.y, heightAt(f.row, f.col));
      v.fadeIn = 0;
      penViews.set(info.id, v);
      if (penHidden) hidePenView(v, true);
    }
  }

  /** Hide (or show again) the pen's figures: only the pen camera shows them (see the header). */
  function setPenHidden(hidden) {
    penHidden = !!hidden;
    for (const v of penViews.values()) hidePenView(v, penHidden);
  }
  function hidePenView(v, hidden) {
    if (!v || v.destroyed) return;
    if (hidden) {
      for (const k of ['root', 'hud', 'shadow', 'facingArrow', 'blockIcon']) if (v[k]) v[k].visible = false;
    } else {
      v.culled = undefined; // viewport culling decides the visibility again — now (fresh screen geometry for hit tests)
      try { v.update(0, cam, clock); } catch { /* the next frame retries */ }
    }
  }

  function clearPen() {
    for (const v of penViews.values()) { try { v.destroy(); } catch { /* ignore */ } }
    penViews.clear();
    penSig = null;
    penList = null;
    clearLeader();
  }

  /**
   * The round's leader standing on the boss field in the Final Assault / Hidden Core prep (`stand`: prepfield.js
   * leaderStand; see the header) or none. Kept while the same leader stands on the same tile.
   */
  function setLeader(stand) {
    const key = stand ? `${stand.entry.enemyKey}@${stand.row},${stand.col}` : null;
    if ((leader ? leader.key : null) === key) return;
    clearLeader();
    if (!stand) return;
    const k = stand.entry.enemyKey;
    const rec = data.enemy(k);
    // not a prep view: a boss shows its HP bar (full: the round has not begun)
    const v = new UnitView(ctx, {
      id: 'leader:' + k, kind: 'enemy', side: 'enemy', defId: k, enemyKey: k, preview: true, name: rec?.name || k, tier: 3, golden: false,
      spine: rec?.spine || k, avatar: rec?.iconId || rec?.avatar || k, x: stand.col, y: stand.row, facing: -1, maxHp: 1, boss: true,
    });
    v.setWorld(stand.col, stand.row, heightAt(stand.row, stand.col));
    v.fadeIn = 0;
    leader = { key, view: v, stand, area: rec?.hitArea ?? null };
    faceLeader();
    if (leaderHidden) hidePenView(v, true);
    syncLeaderHits();
  }
  /** The leader faces the player's half of the boss field (left half → left) [ASSUMED look]. */
  function faceLeader() { if (leader) leader.view.visFacing = prepXf.side === 'R' ? 1 : -1; }
  function clearLeader() {
    if (!leader) return;
    try { leader.view.destroy(); } catch { /* ignore */ }
    leader = null;
    syncLeaderHits();
  }
  function setLeaderHidden(hidden) {
    leaderHidden = !!hidden;
    if (leader) hidePenView(leader.view, leaderHidden);
    syncLeaderHits();
  }
  /** The leader's hit tiles in red while an operator's range preview shows in the boss-field prep (LEADER_HIT_STYLE). */
  function syncLeaderHits() {
    if (!tiles) return;
    const on = !!leader && !leaderHidden && mode === 'prep' && prepXf.kind === 'bossPrep' && [...hlReq.keys()].some((g) => RANGE_GROUPS.has(g));
    if (on) tiles.setHighlights(leader.stand.tiles, LEADER_HIT_STYLE, LEADER_HIT_STYLE.group);
    else tiles.clearHighlights(LEADER_HIT_STYLE.group);
  }
  /** The leader under a canvas point (its drawn body or hit area, like a battle enemy), or null. */
  function leaderAt(x, y) {
    if (!leader || leaderHidden) return null;
    const u = pickUnitOf(leader.view, true, leader.area);
    return u && pickBattle([u], groundTile(x, y), x, y) ? leader.view : null;
  }

  /** The pen enemy under a canvas point: a figure on the tile under it (render/pick.js; ≤ 3 idle per pen tile). */
  function penUnitAt(x, y) {
    if (penHidden) return null;
    const units = [];
    for (const v of penViews.values()) { const u = pickUnitOf(v); if (u) units.push(u); }
    const hit = pickOnTile(units, groundTile(x, y));
    return hit ? hit.ref : null;
  }

  function emitPenClick(v, e) {
    const info = { ...v.info };
    emit('pieceClick', { enemyKey: info.enemyKey, preview: true, unit: info, unitId: null, uid: null, button: e.button, detail: e.button === 2, clientX: e.clientX, clientY: e.clientY });
  }

  // ---- drag & pointer ----------------------------------------------------------------------------------------

  /** The display tile under a canvas point (raised tops first) and the point on its top (world x, y), or null. */
  function groundTile(x, y) {
    const t = pickTile(cam, x, y, heightAt, tiles.levels);
    return t ? { row: t.row, col: t.col, x: t.x, y: t.y } : null;
  }

  /** The prep piece under a canvas point: the one on the tile under it (render/pick.js; board, bench and temp rows). */
  function pieceAt(x, y) {
    if (mode !== 'prep') return null;
    const units = [];
    for (const e of prepPieces) {
      const u = pickUnitOf(views.get(e.key));
      if (u) { u.entry = e; units.push(u); }
    }
    const best = pickOnTile(units, groundTile(x, y))?.entry;
    if (!best) return null;
    return { uid: best.uid, kind: best.piece.kind, id: best.piece.id, area: best.area, idx: best.idx, row: best.row, col: best.col, piece: best.piece, draggable: true };
  }

  const drag = createDragController({
    hitPiece: (x, y) => pieceAt(x, y),
    pickTile: (x, y) => pickBoardTile(x, y),
    isOverCanvas: (cx, cy) => {
      try { const el = document.elementFromPoint(cx, cy); return !el || el === canvas; } catch { return true; }
    },
    emit: (name, payload) => onDragEvent(name, payload),
  });

  function publicPiece(p) {
    if (!p) return p;
    return { ...p.piece, area: p.area, idx: p.idx, row: p.row, col: p.col };
  }

  function onDragEvent(name, payload) {
    const out = payload && payload.piece ? { ...payload, piece: publicPiece(payload.piece) } : payload;
    switch (name) {
      case 'pieceDragStart': startDragVisual(payload); break;
      case 'pieceDragMove': moveDragVisual(payload); return; // internal
      case 'pieceDrop': dropDragVisual(payload); break;
      case 'pieceDragEnd': if (!payload.dropped) endDragVisual(true); else clearHl('dragTarget'); break;
      case 'pieceHover': {
        for (const e of prepPieces) { const v = views.get(e.key); if (v) v.setHover(e.uid === payload.uid); }
        break;
      }
      default: break;
    }
    emit(name, out);
  }

  /** Group key of a highlight request (render/tiles.js setHighlights rule). */
  function hlKey(style, group) {
    return group || (typeof style === 'object' && style ? style.group : null) || (typeof style === 'string' ? style : 'custom');
  }
  /**
   * Draw a BOARD-space highlight group: range previews never light the bench / temp pads (rows 7–8: no battle
   * happens there), the prep field transform maps the tiles onto the boss field in the Final Assault prep, and the 2D
   * board stripes range previews under the units (the 3D board gets them from the direction wheel's layer).
   */
  function drawHighlight(list, style, group) {
    const key = hlKey(style, group);
    const range = RANGE_GROUPS.has(key) || style === 'range';
    let t = tilesToDisp(IDENTITY, list);
    if (range) t = t.filter(([r]) => r !== GEO.HAND_ROW && r !== GEO.TEMP_ROW);
    if (mode === 'prep' && prepXf !== IDENTITY) t = tilesToDisp(prepXf, t);
    tiles.setHighlights(t, style, key, { stripes: range && key !== 'rangeStand' && !board3d });
  }
  function clearHl(group) {
    if (group) hlReq.delete(group); else hlReq.clear();
    tiles.clearHighlights(group);
    syncLeaderHits();
  }

  function legalTiles(piece) {
    const fn = canPlaceFn ? adaptCanPlace(canPlaceFn) : null;
    if (!fn) return [];
    const out = [];
    const F = GEO.FIELD;
    for (let r = F.r0; r <= F.r1; r++) for (let c = F.c0; c <= F.c1; c++) {
      try { if (fn(piece, r, c, { area: 'board', row: r, col: c })) out.push([r, c]); } catch { /* illegal */ }
    }
    for (let i = 0; i < GEO.HAND_SIZE; i++) {
      try { if (fn(piece, GEO.HAND_ROW, i, { area: 'hand', idx: i })) out.push([GEO.HAND_ROW, i]); } catch { /* illegal */ }
    }
    return out;
  }

  function startDragVisual(p) {
    const key = 'p:' + p.uid;
    const v = views.get(key);
    if (!v) return;
    dragState = { uid: p.uid, key, view: v, from: p.from, home: v._home || { x: v.x, y: v.y, z: v.z } };
    v.lift = 0.3;
    v._tween = null;
    const t = pieceTile(p.piece);
    if (t) drawHighlight([[t.row, t.col]], 'hover', 'dragFrom');
    drawHighlight(legalTiles(p.piece), 'legal', 'legal');
  }

  function moveDragVisual(p) {
    if (!dragState) return;
    const v = dragState.view;
    // held under the pointer: a unit with its drawn (lifted) feet DRAG_HOLD_TILES of its own px per tile below it (the
    // scale at the pointer's ground, refined once at the feet), an item plate centred on it; the drop target
    // (p.target, highlighted below) is the tile under the pointer
    const item = v instanceof ItemView;
    const g = cam.unproject(p.x, p.y, 0);
    const hold = item ? 0 : DRAG_HOLD_TILES;
    const s0 = g ? cam.scaleAt(g.x, g.y, 0) : cam.scale;
    const t = pickTile(cam, p.x, p.y + hold * s0, heightAt, tiles.levels);
    const z = t ? heightAt(t.row, t.col) : 0;
    const up = item ? z : z + (v.lift || 0) + (v.hover || 0);
    let w = cam.unproject(p.x, p.y + hold * s0, up);
    if (w && hold) w = cam.unproject(p.x, p.y + hold * cam.scaleAt(w.x, w.y, up), up) || w;
    if (w) {
      v.x = Math.max(-1, Math.min(21, w.x));
      v.y = Math.max(-1, Math.min(19, w.y));
      v.z = z;
    }
    if (p.target && p.target.area !== 'temp') {
      const r = p.target.area === 'board' ? p.target.row : GEO.HAND_ROW;
      const c = p.target.area === 'board' ? p.target.col : p.target.idx;
      drawHighlight([[r, c]], p.legal ? 'target' : 'illegal', 'dragTarget');
    } else clearHl('dragTarget');
  }

  function dropDragVisual(p) {
    if (!dragState) return;
    const v = dragState.view;
    const t = p.target;
    if (t && (t.area === 'board' || t.area === 'hand')) {
      const row = t.area === 'board' ? t.row : GEO.HAND_ROW, col = t.area === 'board' ? t.col : t.idx;
      const w = boardWorld(row, col, t.area === 'hand');
      v._tween = { fx: v.x, fy: v.y, fz: v.z, tx: w.x, ty: w.y, tz: w.z, t: 0 };
      pending.set(dragState.key, { t: performance.now(), view: v, board: t.area === 'board' ? { row, col } : null });
    } else {
      const h = dragState.home;
      v._tween = { fx: v.x, fy: v.y, fz: v.z, tx: h.x, ty: h.y, tz: h.z, t: 0 };
    }
    v.lift = 0;
    clearHl('dragFrom'); clearHl('dragTarget'); clearHl('legal');
    dragState = null;
  }

  function endDragVisual(cancelled) {
    if (dragState) {
      const v = dragState.view;
      const h = dragState.home;
      if (cancelled && v && !v.destroyed) v._tween = { fx: v.x, fy: v.y, fz: v.z, tx: h.x, ty: h.y, tz: h.z, t: 0 };
      if (v) v.lift = 0;
    }
    dragState = null;
    clearHl('dragFrom'); clearHl('dragTarget'); clearHl('legal');
  }

  function canvasPoint(e) {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  function evPayload(e) {
    const p = canvasPoint(e);
    return { pointerId: e.pointerId, pointerType: e.pointerType, button: e.button, x: p.x, y: p.y, clientX: e.clientX, clientY: e.clientY };
  }

  /** The battle unit under a canvas point (render/pick.js: an ally on the tile under it, an enemy near its ground). */
  function battleUnitAt(x, y) {
    const units = [];
    for (const v of views.values()) {
      if (!v.info || v.info.kind === 'device') continue;
      const enemy = v.info.side !== 'ally';
      // a huge boss: its hit area (data/enemies.json `hitArea`, the sim's hit rectangle) is pickable too
      const u = pickUnitOf(v, enemy, enemy ? data.enemy(v.info.defId)?.hitArea ?? null : null);
      if (u) units.push(u);
    }
    const hit = pickBattle(units, groundTile(x, y), x, y);
    return hit ? hit.ref : null;
  }

  const onPointerDown = (e) => {
    if (destroyed) return;
    const ev = evPayload(e);
    if (mode === 'battle') {
      const v = battleUnitAt(ev.x, ev.y);
      if (v) {
        const info = infos.get(v.id) || v.info;
        const payload = { unitId: v.id, uid: info?.uid ?? null, unit: info, button: e.button, detail: e.button === 2, clientX: e.clientX, clientY: e.clientY };
        emit('pieceClick', payload);
        if (e.button === 2) emit('pieceDetail', payload);
      } else if (penViews.size) {
        const pv = penUnitAt(ev.x, ev.y);
        if (pv) emitPenClick(pv, e);
      }
      return;
    }
    if (drag.pointerDown(ev)) { try { canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ } return; }
    if (mode === 'prep') { const lv = leaderAt(ev.x, ev.y); if (lv) { emitPenClick(lv, e); return; } }
    if (penViews.size && mode === 'prep') {
      const pv = penUnitAt(ev.x, ev.y);
      if (pv) emitPenClick(pv, e);
    }
  };
  const onPointerMove = (e) => {
    if (destroyed) return;
    const ev = evPayload(e);
    if (mode === 'battle') {
      if (e.pointerType === 'touch') return;
      const v = battleUnitAt(ev.x, ev.y);
      if (v !== hoverUnit) {
        hoverUnit = v;
        const info = v ? infos.get(v.id) || v.info : null;
        emit('pieceHover', v ? { unitId: v.id, uid: info?.uid ?? null, unit: info, clientX: e.clientX, clientY: e.clientY } : { uid: null, unitId: null });
      }
      return;
    }
    drag.pointerMove(ev);
  };
  const onPointerUp = (e) => { if (!destroyed && mode !== 'battle') drag.pointerUp(evPayload(e)); try { canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ } };
  const onPointerCancel = (e) => { if (!destroyed) drag.pointerCancel(evPayload(e)); };
  const onPointerLeave = (e) => { if (!destroyed && !drag.dragging) drag.pointerLeave(evPayload(e)); if (hoverUnit) { hoverUnit = null; emit('pieceHover', { uid: null, unitId: null }); } };
  const onContext = (e) => e.preventDefault();
  // A finger is handled through the pointer events above only. The compatibility mouse events + click of a tap come
  // after touchend, hit-tested at the finger again — where the tap may just have opened DOM UI: a tap on a unit's tile
  // selects it and its underframe opens over the tile (clamped under the top bar on a phone), and the click pressed
  // 撤退 / 出售 (user playtest #4 item 1 on a phone). Cancelling touchend drops them.
  const onTouchEnd = (e) => { if (e.cancelable) e.preventDefault(); };
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerCancel);
  canvas.addEventListener('pointerleave', onPointerLeave);
  canvas.addEventListener('contextmenu', onContext);
  canvas.addEventListener('touchend', onTouchEnd, { passive: false });

  // ---- battle ---------------------------------------------------------------------------------------------

  /**
   * Battle mode holds the Spine cache (assets.js `spine.hold()`, its memory policy): the battle's views are built in
   * animation frames, which a hidden tab does not run — a battle that began in a background tab referenced no skeleton, and
   * the quiet budget emptied the cache ≈ 18 s later, so back in the tab every unit was an avatar diamond until its model
   * downloaded again (public issue #8 item 5). Released once the prep pieces reference their models (setPrep) and on
   * destroy; the idle budget still applies meanwhile.
   */
  function holdScene(on) {
    if (on) { if (!sceneHold && typeof assets.spine?.hold === 'function') sceneHold = assets.spine.hold(); return; }
    const release = sceneHold;
    sceneHold = null;
    if (release) { try { release(); } catch { /* ignore */ } }
  }

  function enterBattle(meta) {
    if (destroyed || !meta || typeof meta !== 'object') return false;
    holdScene(true); // before the prep views go: the cache is never "quiet" across the switch
    drag.reset();
    endDragVisual(false);
    clearViews();
    if (prepPieces.length) promoBase = prepPieces;
    prepPieces = [];
    infos.clear();
    gone.clear();
    interp.reset();
    fx.clear();
    meleePending.clear();
    consumedIds.clear();
    clearHl();
    renderT0Battle = null;
    mode = 'battle';
    const rect = meta.rect ? normRect(meta.rect) : (meta.kind === 'boss' || meta.kind === 'hidden' ? { ...GEO.BOSS_RECT } : meta.kind === 'unite' ? { ...GEO.UNITE_RECT } : { ...GEO.NORMAL_RECT });
    // prep: true = a read-only scouting board (a teammate's lineup during prep): prep-style pieces, no bars
    battleMeta = { fieldId: meta.fieldId ?? null, kind: meta.kind || 'normal', rect, stageId: meta.stageId ?? null, prep: meta.prep === true };
    // a scouted teammate's board shows THEIR pen (m.field nextEnemies; without it the shared wave composition of the
    // own preview, bounties excluded); a real battle empties the pen (the enemies are about to spawn)
    if (battleMeta.prep) setPenList(Array.isArray(meta.nextEnemies) ? meta.nextEnemies : (ownPen || []).filter((x) => x && x.source !== 'bounty' && x.source !== 'effect'));
    else setPenList(null);
    if (meta.stageId && (!stageRec || stageRec.id !== meta.stageId)) {
      const st = data.stage(meta.stageId);
      if (st) setStage(st);
    }
    tiles.setBattleRect(rect);
    board3d?.setBattleRect(rect);
    for (const u of Array.isArray(meta.units) ? meta.units : []) addInfo(u);
    return true;
  }

  function addInfo(u) {
    const info = renderInfo(u);
    if (info) infos.set(info.id, info);
    return info;
  }

  // a hand item on a scouted prep board (UnitInfo kind 'item'): the plate's icon and colour resolve client-side,
  // exactly like the own prep bench (pieceInfo)
  function scoutItemInfo(info) {
    const rec = data.item(info.defId);
    const tier = rec?.tier || info.tier || 1;
    return { ...info,
      icon: assets.itemIcon ? assets.itemIcon(rec ? { trapId: rec.trapId, iconId: rec.iconId } : info.defId) : null,
      color: (info.golden || rec?.isGolden) ? 0xffc600 : TIER_COLORS[tier] || TIER_COLORS[1] };
  }

  function battleView(id) {
    let v = views.get(id);
    if (v) return v;
    const info = infos.get(id);
    if (!info || gone.has(id)) return null;
    v = info.kind === 'device' ? new DeviceView(ctx, info)
      : info.kind === 'item' ? new ItemView(ctx, scoutItemInfo(info))
      : new UnitView(ctx, info, { prep: !!battleMeta?.prep && info.side === 'ally' });
    // a teammate's operator shows its equipped items like the own prep bench does (item pips; user playtest #2:
    // at the unit, not only in the detail card) — prep surfaces only, the battle HUD stays as it is
    if (v.setItems && battleMeta?.prep && Array.isArray(info.items) && info.items.length) {
      v.setItems(info.items.map((it) => { const r = data.item(it); return assets.itemIcon ? assets.itemIcon(r ? { trapId: r.trapId, iconId: r.iconId } : it) : null; }));
    }
    v.setWorld(info.x, info.y, 0);
    v._seen = false;
    v._born = performance.now();
    views.set(id, v);
    return v;
  }

  function pushSnapshot(snap) {
    if (destroyed || mode !== 'battle') return false;
    if (battleMeta?.fieldId && snap && snap.fieldId && snap.fieldId !== battleMeta.fieldId) return false;
    return interp.push(snap, performance.now() / 1000);
  }

  function pushEvents(ev) {
    if (destroyed || mode !== 'battle') return 0;
    let list = ev, t;
    if (ev && !Array.isArray(ev) && typeof ev === 'object') {
      if (battleMeta?.fieldId && ev.fieldId && ev.fieldId !== battleMeta.fieldId) return 0;
      list = ev.ev; t = frameTime(ev);
    }
    if (!Array.isArray(list)) return 0;
    // spawn infos are needed as soon as possible (a snapshot may reference the unit first); a placeholder view made
    // for a snapshot unit nobody announced is rebuilt with the real info
    for (const e of list) {
      if (!Array.isArray(e) || e[0] !== 'spawn') continue;
      const info = addInfo(e[1]);
      if (info && views.get(info.id)?._unknown) dropView(info.id);
    }
    return interp.pushEvents(list, performance.now() / 1000, t);
  }

  // attack wind-ups: an 'atk' still queued in the buffer starts its Spine clip early enough for the strike frame to
  // land when the event is rendered (the look-ahead is the interpolation delay, ~0.2 game s)
  function windUpAttacks(renderT) {
    upcomingT = renderT;
    interp.forEachUpcoming(renderT, renderT + 1.5, onUpcoming);
  }
  let upcomingT = 0;
  function onUpcoming(e, t) {
    if (e[0] !== 'atk' || woundUp.has(e) || CHAIN_KINDS.has(e[3])) return;
    const v = views.get(e[1]);
    if (!v || !v.windUp) return;
    if (v.windUp(t - upcomingT, e[3])) woundUp.add(e);
  }

  const EVS = [];
  /** State events handed out more than 1.5 game s late (a stall, a hidden tab, a field entered late) → how late. */
  const LATE = new Map();
  function processEvents(renderT) {
    EVS.length = 0;
    LATE.clear();
    interp.takeEvents(renderT, EVS, renderT - 1.5, LATE);
    for (const e of EVS) {
      try { handleEvent(e, renderT); } catch (err) { if (!handleEvent.warned) { handleEvent.warned = true; console.warn('[render] event failed', e, err); } }
    }
  }

  function handleEvent(e, now) {
    switch (e[0]) {
      case 'spawn': {
        const info = addInfo(e[1]);
        if (!info) break;
        gone.delete(info.id);
        const v = battleView(info.id);
        if (v && info.side === 'enemy' && renderT0Battle != null && now - renderT0Battle > 0.2) fx.ring(info.x, info.y, 0, 0.1, 0.7, 0xff5a4a, 0.4);
        break;
      }
      case 'deploy': {
        gone.delete(e[1]);
        const v = battleView(e[1]);
        if (v) { v.onDeploy?.(); if (v.info?.kind !== 'device') fx.deploy(v); }
        break;
      }
      case 'atk': {
        const src = views.get(e[1]) || battleView(e[1]);
        const tgt = views.get(e[2]) || battleView(e[2]);
        // chain / chainHeal bounces: the "source" is the previous target of the bounce, not an attacker
        if (src && !CHAIN_KINDS.has(e[3])) src.onAttack?.(tgt, now, e[3]);
        if (e[3] === 'none' || !e[3]) { if (tgt && src) meleePending.set(tgt.id, { src, t: now }); }
        fx.attack(src, tgt, e[3]);
        break;
      }
      case 'dmg': {
        const v = views.get(e[1]);
        if (!v) break;
        const amt = Number(e[2]) || 0;
        const m = meleePending.get(v.id);
        let src = null;
        if (m && now - m.t < 0.35) { src = m.src; meleePending.delete(v.id); fx._slashAt = src.id; }
        fx.damage(v, amt, e[3], src);
        break;
      }
      case 'heal': { const v = views.get(e[1]); if (v) fx.heal(v, Number(e[2]) || 0); break; }
      case 'skill': { const v = views.get(e[1]); if (v) { v.setSkill?.(!!e[2]); fx.skill(v, !!e[2]); } break; }
      case 'die': {
        const v = views.get(e[1]);
        const used = consumedIds.delete(e[1]);
        if (v && v.alive) { v.die(e[2] === FORCED_EXIT); if (showsDeathFx(v.info, used, e[2])) fx.death(v); }
        break;
      }
      case 'leak': {
        const v = views.get(e[1]);
        if (v) {
          leakFlash(v.x, v.y);
          v.alive = false;
          v.dying = 0.25; v.dieDur = 0.25;
        }
        fx.leak();
        break;
      }
      case 'status': { const v = views.get(e[1]); if (v) v.onStatus?.(e[2], !!e[3]); break; }
      case 'fx': {
        if (e[4] && typeof e[4] === 'object' && e[4].consumed && e[4].id != null) {
          consumedIds.add(e[4].id);
          if (consumedIds.size > 200) consumedIds.delete(consumedIds.values().next().value);
        }
        // an enemy's mode change — the `form` of a sim setForm fx (shared/protocol.js fxForm: 掠海漂移体 → 爬行模式, user
        // playtest #5 item 1; 转译基底's forms, a 逐火 ember and its revival, the leaders' 重生, 守墓石像 — user report after
        // 0.1.0) — switches the view's clip set (UnitView.setForm; a kind without a clip set of that skeleton changes
        // nothing); the info keeps it for a view built later. No client stage drops these fx: battle/runner.js
        // keepsState (catch-up frames, hidden-tab backlog), screens/game.js keepEarly (the pre-entry buffer) and
        // render/interp.js isCosmeticEvent (stale-event drop, full-queue shed). One handed out late switches the model
        // without its telegraph, its closing clip shortened by the lateness.
        const form = fxForm(e);
        const late = form !== undefined ? LATE.get(e) || 0 : 0;
        if (form !== undefined) {
          const inf = infos.get(e[4].id);
          if (inf && (form === null || FORMS[inf.spine || inf.defId]?.[form])) inf.form = form;
          const x = late > 0 ? { ...e[4], late, ...(Number(e[4].dur) > 0 ? { dur: Math.max(0, Number(e[4].dur) - late) } : {}) } : e[4];
          views.get(e[4].id)?.setForm?.(form, x);
        }
        if (!(late > 0)) fx.simFx(e[1], Number(e[2]), Number(e[3]), e[4]);
        break;
      }
      case 'layer': {
        const bondId = e[2], n = Number(e[3]) || 0;
        if (!(n > 0) || typeof bondId !== 'string') break;
        const k = bondId;
        const cur = layerPops.get(k);
        if (cur && now - cur.t < 0.8) { cur.n += n; break; }
        layerPops.set(k, { t: now, n });
        const url = assets.bondIcon ? assets.bondIcon(bondId) : null;
        let tex = null;
        if (url) { try { tex = P.Texture.from(url); } catch { tex = null; } }
        fx.pop(tex, `+${n}`, 0xffffff, layerPops.size);
        break;
      }
      case 'bounty': {
        const n = Number(e[2]) || 0;
        if (n > 0) fx.pop(fx.tex.coin, `+${n}`, COLORS.gold, 3);
        break;
      }
      default: break;
    }
  }

  function leakFlash(x, y) {
    if (!stageRec) return;
    const R = battleMeta?.rect || GEO.NORMAL_RECT;
    let best = null, bd = Infinity;
    for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) {
      if (tiles.tile(r, c).glyph !== 'E') continue;
      const d = (r - y) ** 2 + (c - x) ** 2;
      if (d < bd) { bd = d; best = [r, c]; }
    }
    if (best) { tiles.flashObjective(best[0], best[1]); board3d?.flashObjective(best[0], best[1]); }
  }

  let renderT0Battle = null;   // game time of the first rendered battle frame (spawn puffs skip the initial wave)
  let downSeq = 0;             // syncBattle pass counter: a view still marked down after a pass left the `down` list
  function syncBattle(renderT) {
    if (renderT0Battle == null) renderT0Battle = renderT;
    interp.sample(renderT, sample);
    for (const [id, s] of sample) {
      let v = views.get(id);
      if (!v && gone.has(id)) {
        if (s.anim === ANIM.DIE || !(s.hp > 0)) continue; // the tail of its DIE window: stays gone
        gone.delete(id);                                  // alive again (redeployed without an event)
      }
      if (!v) v = battleView(id) || createUnknown(id, s);
      if (!v) continue;
      if (!v._seen) { v._seen = true; v.fadeIn = 0; }
      if (v.alive || v.info?.kind === 'device') v.sync(s, renderT);
      else if (v.dying > 0) { v.x = s.x; v.y = s.y; }
      else if (s.anim !== ANIM.DIE && s.hp > 0) { v.revive?.(); v.sync(s, renderT); }
    }
    // knocked-out operators waiting to redeploy (b.snap `down`, user playtest #4 item 9): their view stays on the
    // field knocked down under a redeploy ring (UnitView.setDown) — made on the spot for one already down when this
    // field was entered; one that leaves the list without a redeploy fades out
    const down = interp.downAt(renderT);
    downSeq++;
    if (down) {
      for (const d of down) {
        let v = views.get(d[0]);
        let fresh = false;
        if (!v) {
          const info = infos.get(d[0]);
          if (!info || info.side !== 'ally' || info.kind === 'device') continue;
          gone.delete(d[0]);
          v = battleView(d[0]);
          fresh = true;
        }
        if (!v || typeof v.setDown !== 'function') continue;
        v._seen = true;
        v.setDown(d, renderT, fresh);
        v._downSeq = downSeq;
      }
    }
    const now = performance.now();
    for (const [id, v] of views) {
      if (v.down && v._downSeq !== downSeq) v.setDown(null, renderT);
      if (sample.has(id) || v.down) continue;
      if (v._seen) {
        // left the snapshot: removed (leaked / hidden / died and its DIE window passed)
        if (v.alive) { v.alive = false; v.dying = 0.25; v.dieDur = 0.25; }
      } else if (now - (v._born || now) > 8000) v.remove = true;
      else if (v.root) v.root.alpha = 0;
    }
  }

  function createUnknown(id, s) {
    if (infos.has(id)) return null;
    addInfo({ id, kind: 'enemy', side: 'enemy', defId: null, x: s.x, y: s.y, maxHp: s.maxHp });
    infos.get(id)._unknown = true;
    const v = battleView(id);
    if (v) v._unknown = true;
    return v;
  }

  // ---- frame --------------------------------------------------------------------------------------------------

  let clock = 0;
  let cpuMs = 0;
  let frameNo = 0;
  let impInterval = 0;
  let vp = { width: s0.width, height: s0.height };   // viewport (CSS px) of this frame: unit culling
  let culledCount = 0;
  // Adaptive load level 0–3: a device that cannot hold the frame rate with the current work switches crowds to
  // impostors earlier and animates small / far units at a lower rate (units.js); it steps back after a calm spell.
  let loadLevel = 0, slowFor = 0, fastFor = 0;
  function adaptLoad(dtRaw) {
    if (!(dtRaw > 0) || dtRaw > 0.25 || globalThis.document?.hidden) return;
    const busy = views.size + penViews.size > 8;
    if (frameMs > 19.5 && busy) { slowFor += dtRaw; fastFor = 0; }
    else if (frameMs < 17.6) { fastFor += dtRaw; slowFor = 0; }
    if (slowFor > 1 && loadLevel < 3) { loadLevel++; slowFor = 0; fastFor = 0; impInterval = pickImpostorInterval(); }
    else if (loadLevel > 0 && (fastFor > 6 * loadLevel || !busy && fastFor > 2)) { loadLevel--; fastFor = 0; impInterval = pickImpostorInterval(); }
  }
  // Crowded fields render skeletons through staggered RenderTexture impostors (units.js): the interval grows with
  // the number of Spine units so the per-frame vertex work stays roughly constant (hysteresis: re-evaluated
  // every 30 frames). Prep and ordinary fields keep full-rate direct rendering.
  // Spine clipping masks (only eyeball clips on the current roster, invisible at chibi scale) each cost a stencil
  // render-pass break (~2–5 ms of GPU on tiled GPUs): kept only for a lone clipped skeleton at high quality
  let clipAllowed = true;
  function pickClipping() {
    let n = 0;
    for (const v of views.values()) if (v.actor && v.actor.clipped && v.alive !== false) n++;
    return settings.quality === 'high' && n <= 1;
  }
  function pickImpostorInterval() {
    let n = 0;
    for (const v of views.values()) if (v.actor && v.spineReady) n++;
    const q = settings.quality;
    const base = (q === 'low' ? 12 : q === 'medium' ? 26 : 44) / (1 + loadLevel);
    if (n <= base) return 0;
    // a struggling device (load level ≥ 2) may refresh a big crowd more rarely (10 Hz at worst)
    return Math.min(loadLevel >= 2 ? 6 : 4, Math.max(2, Math.ceil(n / (base * 0.75))));
  }
  function frame() {
    if (destroyed) return;
    const now = performance.now();
    try { frameBody(now); } finally { cpuMs = cpuMs * 0.9 + (performance.now() - now) * 0.1; }
  }
  function frameBody(now) {
    frameNo++;
    if (frameNo % 30 === 1) {
      impInterval = pickImpostorInterval(); clipAllowed = pickClipping();
      culledCount = 0;
      for (const v of views.values()) if (v.culled) culledCount++;
      for (const v of penViews.values()) if (v.culled) culledCount++;
    }
    const dtRaw = (now - lastNow) / 1000;
    lastNow = now;
    const dt = Math.min(0.1, Math.max(0, dtRaw));
    if (dtRaw < 0.25) frameMs = frameMs * 0.9 + dtRaw * 1000 * 0.1;
    fps = 1000 / Math.max(1, frameMs);
    adaptLoad(dtRaw);
    vp.width = Math.max(1, host.clientWidth || 1); vp.height = Math.max(1, host.clientHeight || 1);
    clock += dt;
    if ((globalThis.devicePixelRatio || 1) !== lastDpr) { lastDpr = globalThis.devicePixelRatio || 1; resize(); }
    try {
      stepCamera(now);
      if (board3d) {
        if (board3d.lost) onBoard3dLost();
        else board3d.render(cam, clock);
      }
      tiles.project(cam);
      updateBackdrop(clock);
      if (mode === 'battle') {
        const renderT = interp.update(now / 1000);
        if (Number.isFinite(renderT)) {
          processEvents(renderT);
          syncBattle(renderT);
          windUpAttacks(renderT);
        }
      } else if (mode === 'prep') {
        for (const [key, pd] of pending) {
          if (now - pd.t > DROP_PENDING_MS) {
            pending.delete(key);
            const v = views.get(key);
            if (v && v._home && (!dragState || dragState.key !== key)) v._tween = { fx: v.x, fy: v.y, fz: v.z, tx: v._home.x, ty: v._home.y, tz: v._home.z, t: 0 };
          }
        }
      }
      for (const [key, v] of views) {
        if (v._tween) {
          const tw = v._tween;
          tw.t = Math.min(1, tw.t + dt / 0.22);
          const k = 1 - (1 - tw.t) * (1 - tw.t);
          v.x = tw.fx + (tw.tx - tw.fx) * k; v.y = tw.fy + (tw.ty - tw.fy) * k; v.z = tw.fz + (tw.tz - tw.fz) * k;
          if (tw.t >= 1) v._tween = null;
        }
        v.update(dt, cam, clock);
        if (v.remove) { dropView(key); if (mode === 'battle') gone.add(key); }
      }
      if (!penHidden) for (const v of penViews.values()) v.update(dt, cam, clock);
      if (leader && !leaderHidden) leader.view.update(dt, cam, clock);
      tiles.update(dt);
      fx.update(dt);
      impostors.flush();
    } catch (err) {
      if (!frame.warned) { frame.warned = true; console.error('[render] frame failed', err); }
    }
  }
  app.ticker.add(frame);
  // render-cost probe (PIXI renders at UPDATE_PRIORITY.LOW = -25)
  let renderT0 = 0, renderMs = 0;
  const preRender = () => { renderT0 = performance.now(); };
  const postRender = () => { if (renderT0) renderMs = renderMs * 0.9 + (performance.now() - renderT0) * 0.1; };
  app.ticker.add(preRender, null, -24);
  app.ticker.add(postRender, null, -26);

  // ---- resize ---------------------------------------------------------------------------------------------------

  function resize() {
    if (destroyed) return;
    const sz = size();
    const res = dpr();
    if (app.renderer.resolution !== res) app.renderer.resolution = res;
    app.renderer.resize(sz.width, sz.height);
    board3d?.resize(sz.width, sz.height, boardDpr());
    layoutBackdrop();
    const target = targetCamera(camKind, camOpts);
    if (camTo) camTo = target; else cam = target;
    tiles.project(cam, true);
  }
  let ro = null;
  if (typeof ResizeObserver === 'function') {
    ro = new ResizeObserver(() => resize());
    ro.observe(host);
  }
  // a DPR change without a size change (window dragged to another monitor, zoom) must re-rasterise too; polled
  // per frame because not every browser fires a resize / matchMedia change for it
  let lastDpr = globalThis.devicePixelRatio || 1;
  layoutBackdrop();

  // ---- late assets, hidden tabs (public issue #8 item 5: operators drawn as image-less placeholders) ----------------------
  // The asset manifest (or the local-client one) arrived after views were built — a reload whose manifest fetch was slow or
  // failed (assets.js onChange): every view re-resolves what it could not draw (UnitView.retryAssets) and the prep pieces
  // re-read their item icons. The tab shown again: a manifest still missing is asked for again and views without a model
  // load it again at once (their bounded retries never run while hidden: no frames).
  function onAssets() {
    if (destroyed) return;
    loadShadow();
    loadMountains();
    if (mode === 'prep' && lastPrep) setPrep(lastPrep.ps, lastPrep.o);
    for (const v of views.values()) v.retryAssets?.();
    for (const v of penViews.values()) v.retryAssets?.();
    leader?.view.retryAssets?.();
  }
  const offAssets = typeof assets.onChange === 'function' ? assets.onChange(onAssets) : null;
  const onVisible = () => {
    if (destroyed || globalThis.document?.visibilityState !== 'visible') return;
    if (assets.loaded === false && typeof assets.ready === 'function') assets.ready();
    for (const v of views.values()) v.retryAssets?.();
    for (const v of penViews.values()) v.retryAssets?.();
    leader?.view.retryAssets?.();
  };
  globalThis.document?.addEventListener?.('visibilitychange', onVisible);

  // ---- public API ---------------------------------------------------------------------------------------------

  const view = {
    setStage,
    setCamera,
    setPrep,
    /** Enemy preview pen: a list in m.private.nextEnemies shape, or null to empty it (setPrep does this itself). */
    setPen(list) { if (destroyed) return false; setPenList(Array.isArray(list) ? list : null); return true; },
    enterBattle,
    pushSnapshot,
    pushEvents,
    /**
     * Client-side combat glue (DESIGN §14): battle frames come from the local simulation (public/js/battle/runner.js)
     * every animation frame instead of the network, so the render clock trails them by ~2 frames (not the 100 ms
     * jitter buffer) and runs at the battle's game speed. `{ on: false }` restores the network settings.
     */
    setLocalFeed(o) {
      const on = !!(o && o.on);
      const speed = Number(o && o.speed) > 0 ? Number(o.speed) : 2;
      interp.delay = on ? 0.034 : 0.1;
      interp.defaultRate = on ? Math.min(20, speed) : 2;
      interp.maxRate = on ? Math.max(8, speed * 1.5) : 8;
      return true;
    },
    highlightTiles(tilesList, style) {
      if (tilesList == null || (Array.isArray(tilesList) && !tilesList.length && style == null)) { clearHl(); return true; }
      const st = style ?? 'range';
      const key = hlKey(st);
      if (Array.isArray(tilesList) && tilesList.length) hlReq.set(key, { tiles: tilesList, style: st }); else hlReq.delete(key);
      drawHighlight(tilesList, st, key);
      syncLeaderHits();
      return true;
    },
    on(name, fn) {
      if (typeof fn !== 'function') return () => {};
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(fn);
      return () => listeners.get(name)?.delete(fn);
    },
    off(name, fn) { listeners.get(name)?.delete(fn); },
    pieceScreenRect(uid) {
      let v = views.get('p:' + uid);
      if (!v) for (const x of views.values()) if (x.uid === uid || x.info?.uid === uid || x.id === uid) { v = x; break; }
      if (!v || v.destroyed) return null;
      const b = v.bounds();
      const r = canvas.getBoundingClientRect();
      const left = r.left + b.x, top = r.top + b.y;
      return { left, top, right: left + b.width, bottom: top + b.height, width: b.width, height: b.height, x: left, y: top };
    },
    /**
     * Screen geometry of a BOARD-space tile (in the Final Assault prep: where that board tile is drawn on the boss
     * field). `mirror` = the prep field is mirrored (the right-hand player): a screen-right swipe is board LEFT.
     */
    tileScreen(row, col) {
      if (destroyed || !Number.isInteger(row) || !Number.isInteger(col)) return null;
      const d = mode === 'prep' ? prepXf.toDisp(row, col) : { row, col };
      // Final Assault prep: a board tile that does not land on the boss field (a range reaching past it) has no screen
      // place there (the same rule as the highlights, render/prepfield.js tilesToDisp)
      if (mode === 'prep' && prepXf !== IDENTITY && !tilesToDisp(prepXf, [[row, col]]).length) return null;
      const z = heightAt(d.row, d.col);
      const r = canvas.getBoundingClientRect();
      const c = cam.project(d.col, d.row, z);
      if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) return null;
      const corner = (dx, dy) => { const p = cam.project(d.col + dx, d.row + dy, z); return [r.left + p.x, r.top + p.y]; };
      return { x: r.left + c.x, y: r.top + c.y, s: c.s, poly: [corner(-0.5, 0.5), corner(0.5, 0.5), corner(0.5, -0.5), corner(-0.5, -0.5)], mirror: mode === 'prep' && prepXf.mirror };
    },
    /**
     * True when the view itself stripes range previews ('facing' / 'selRange' / 'range' groups) under the units (the 2D
     * board): the direction wheel then needs no striped overlay of its own (it would cover the units).
     */
    stripesUnder() { return !destroyed && !board3d; },
    /** Where the prep pieces are shown: { kind: 'board'|'bossPrep', side: 'L'|'R', mirror } (render/prepfield.js). */
    prepField() { return { kind: prepXf.kind, side: prepXf.side, mirror: prepXf.mirror }; },
    holdPiece(uid, tile) {
      if (destroyed || !Number.isInteger(uid)) return false;
      if (!tile || !Number.isInteger(tile.row) || !Number.isInteger(tile.col)) { held.delete(uid); return true; }
      const w = boardWorld(tile.row, tile.col);
      held.set(uid, w);
      const key = 'p:' + uid;
      const v = views.get(key);
      if (v && !v.destroyed && (!dragState || dragState.key !== key)) {
        v._home = w;
        if (Math.abs(v.x - w.x) + Math.abs(v.y - w.y) + Math.abs(v.z - w.z) > 1e-3) v._tween = { fx: v.x, fy: v.y, fz: v.z, tx: w.x, ty: w.y, tz: w.z, t: 0 };
        v.lift = 0;
      }
      return true;
    },
    /** Show a prep piece facing a BOARD-space direction (drawn mirrored on the right half of the Final Assault prep). */
    setPieceDir(uid, dir) {
      const v = views.get('p:' + uid);
      if (!v || v.destroyed || typeof v.setDir !== 'function' || typeof dir !== 'string') return false;
      v.setDir(prepXf.dirToDisp(dir.toUpperCase()));
      return true;
    },
    setSettings(s) {
      if (!s || typeof s !== 'object') return;
      const q = settings.quality;
      if (typeof s.damageNumbers === 'boolean') settings.damageNumbers = s.damageNumbers;
      if (s.quality === 'high' || s.quality === 'medium' || s.quality === 'low') settings.quality = s.quality;
      if (q !== settings.quality) { board3d?.setQuality?.(settings.quality); resize(); }
    },
    resize,
    /** Dev / settings: switch the board layer ('3d' loads three.js + the art when available; '2d' = atlas board). */
    async setBoardMode(m) {
      if (destroyed) return false;
      if (m === '2d') { recover.off = true; clearTimeout(recover.timer); disable3d(); return false; }
      recover.off = false; recover.tries = 0;
      if (board3d) return true;
      if (!webgl2Available(true)) return false; // an explicit request: a slow GPU is the caller's choice
      const [THREE, pack] = await Promise.all([loadThree(), loadBoardPack(assets)]);
      return enable3d(THREE, pack);
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      try { ro?.disconnect(); } catch { /* ignore */ }
      try { offAssets?.(); } catch { /* ignore */ }
      globalThis.document?.removeEventListener?.('visibilitychange', onVisible);
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerCancel);
      canvas.removeEventListener('pointerleave', onPointerLeave);
      canvas.removeEventListener('contextmenu', onContext);
      canvas.removeEventListener('touchend', onTouchEnd);
      app.ticker.remove(frame);
      app.ticker.remove(preRender);
      app.ticker.remove(postRender);
      clearTimeout(recover.timer);
      drag.reset();
      for (const k of [...views.keys()]) dropView(k);
      clearPen();
      holdScene(false); // no scene any more: the quiet budget may free the skeletons (lobby / room / result)
      try { fx.destroy(); } catch { /* ignore */ }
      try { tiles.destroy(); } catch { /* ignore */ }
      try { impostors.destroy(); } catch { /* ignore */ }
      listeners.clear();
      try { board3d?.destroy(); } catch { /* ignore */ }
      board3d = null;
      try { board3dCanvas?.remove(); } catch { /* ignore */ }
      releaseGl(app.renderer);
      try { app.destroy(true, { children: true, texture: false, baseTexture: false }); } catch { /* ignore */ }
    },
    stats() {
      return {
        fps: Math.round(fps * 10) / 10, frameMs: Math.round(frameMs * 100) / 100, cpuMs: Math.round(cpuMs * 100) / 100, renderMs: Math.round(renderMs * 100) / 100, mode, units: views.size, impostor: impInterval, impostorAtlas: { ...impostors.stats }, boardArt: !!tiles.atlas.art,
        board3d: board3d ? { on: true, ...board3d.stats(), losses: recover.count } : { on: false, error: board3dError, recovering: !!recover.timer, losses: recover.count },
        pen: penViews.size, prepField: prepXf.kind === 'bossPrep' ? prepXf.side : null, lod: loadLevel, culled: culledCount,
        ...fx.counts, spine: assets.spine?.stats ? assets.spine.stats() : null, renderT: interp.renderT, rate: interp.rate,
        buffered: interp.size, camera: cam.params(),
      };
    },
    get mode() { return mode; },
    /** Dev hooks (demo / tests). */
    debug: {
      app, get cam() { return cam; }, get board3d() { return board3d; }, tiles, views, penViews, get leader() { return leader; }, interp, fx, ctx, drag, get camKind() { return viewKind(camKind, camOpts); },
      promotions,
      // picking (render/pick.js) at canvas px: the prep piece / battle view / pen view there, the ground tile under it
      pick: { pieceAt, battleUnitAt, penUnitAt, groundTile },
    },
  };
  return view;
}
