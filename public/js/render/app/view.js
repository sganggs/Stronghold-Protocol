// public/js/render/app/view.js — which field a camera shows, and the board box that follows it.

import { AREAS, areaFor, unionAreas } from '../board3d/layout.js';
import { normRect } from '../projection.js';

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
 * The view kinds that show the enemy preview pen — its 3D block, its 2D rows, its two red gates and its figures: the pen
 * camera, and the prep camera of the own normal field. In 休整期 the next round's enemies wait in the pen behind the
 * upper gate, at the top right of the prep view (research 09 §2.1; the maintainer's recording of the official game and
 * decision of 2026-10-15, which supersedes user playtest #2 item 6 "the pen with the pen camera only"), so 🔍▶▶ pans to
 * what is already in view. The battle, 联防, boss and hidden cameras never show it (the round's enemies spawn on the
 * field); nor does the Final Assault / Hidden Core prep ('bossPrep'): its camera frames the boss field, and the pen rows
 * lie far beyond the top edge of that frame (render/projection.js: at 1280 × 720 pen row 14 projects at y ≈ −170).
 */
const PEN_VIEWS = new Set(['prep', 'pen']);
/** The battle cameras: a flight from the prep camera into one of them drops the pen at once (see `penShown`). */
const BATTLE_VIEWS = new Set(['normal', 'unite', 'boss']);

/** Does a view kind (viewKind) show the enemy preview pen? */
export const showsPen = (vk) => PEN_VIEWS.has(vk);

/**
 * 3D area built for a view kind (viewKind): the prep and pen cameras build the field with the enemy preview pen block
 * (rows 13–18, `showsPen`); the battle and 联防 cameras the field alone, with its separator rows 6 and 13 (the row-13
 * devices blow into the field: act2 m01's blowers, user playtest #5 item 6; the boss field's row-6 devices are drawn
 * with the boss field only — board3d/layout.js stageDevices); the boss kinds build the boss field.
 */
export function boardArea(vk) {
  if (vk === 'pen' || vk === 'prep') return AREAS.normal;
  if (vk === 'normal') return AREA_NO_PEN.normal.length ? AREA_NO_PEN.normal : AREAS.normal;
  if (vk === 'unite') return AREA_NO_PEN.unite.length ? AREA_NO_PEN.unite : AREAS.unite;
  return areaFor(vk);
}

/**
 * 2D rows drawn for a view kind: the pen rows (14–18) with the prep and pen cameras; the boss field with the separator
 * and the normal rows behind it as scenery.
 */
export function bandFor(kind) {
  if (kind === 'boss' || kind === 'hidden' || kind === 'bossPrep') return [0, 13];
  return kind === 'pen' || kind === 'prep' ? [6, 18] : [6, 13];
}

/**
 * Active field rows [r0, r1] of a view kind for the 2D board (render/tiles.js `setView` field: drawn rows outside it are
 * dim scenery without devices): the normal / 联防 fields live between the separator walls (rows 6–13, the devices on
 * the row-13 wall included; the row-6 wall's belong to the boss field — tiles.js _stageDevices); the prep and pen
 * cameras add the pen (6–18: it looks the same in both, only the lit rect moves); the boss field 0–6.
 */
export function fieldRows(kind) {
  return kind === 'boss' || kind === 'hidden' || kind === 'bossPrep' ? [0, 6] : kind === 'pen' || kind === 'prep' ? [6, 18] : [6, 13];
}

/**
 * Are the pen's figures (and its block, rows and gates) shown for a view kind — with `prevVk`, during a camera flight
 * from it? A flight shows the pen when either end does, except a flight from the prep camera into a battle camera: the
 * pen goes with the battle start (the maintainer: hidden "最后进入战斗" — a real battle also empties its figures,
 * render/app.js enterBattle), not at the end of the flight. A flight away from the pen camera itself keeps it while it
 * lasts (the camera starts there), and the next prep's flight brings it back at once.
 */
export const penShown = (vk, prevVk = null) => showsPen(vk) || prevVk === 'pen' || (prevVk === 'prep' && !BATTLE_VIEWS.has(vk));

/** Is the prep's leader on the boss field shown for a view kind (a flight shows it when either end is the boss-field prep)? */
export const leaderShown = (vk, prevVk = null) => vk === 'bossPrep' || prevVk === 'bossPrep';

/**
 * What a camera at rest on view kind `vk` builds and draws: the 3D area (`area`), the drawn 2D rows (`band`), the 2D
 * board's active field rows (`field`), and whether the pen's figures (`pen`) and the boss-prep leader (`leader`) show.
 * @param {string} vk
 */
export function restView(vk) {
  return { area: boardArea(vk), band: bandFor(vk), field: fieldRows(vk), pen: showsPen(vk), leader: leaderShown(vk) };
}

/**
 * The same while a camera flies from view kind `prevVk` to `vk`: both ends' areas and rows, so neither field pops out
 * of view mid-flight — the pen only as `penShown(vk, prevVk)` says (dropped at once by a flight from the prep camera
 * into a battle). The camera at rest on `vk` applies `restView(vk)` when the flight ends.
 * @param {string} prevVk
 * @param {string} vk
 */
export function flightView(prevVk, vk) {
  const pen = penShown(vk, prevVk);
  const from = restView(prevVk), to = restView(vk);
  const noPen = (r) => [r[0], Math.min(r[1], 13)];
  const fromArea = pen ? from.area : from.area.filter((a) => a.r1 <= 13);
  const fb = pen ? from.band : noPen(from.band), ff = pen ? from.field : noPen(from.field);
  return {
    area: unionAreas(fromArea, to.area),
    band: [Math.min(fb[0], to.band[0]), Math.max(fb[1], to.band[1])],
    field: [Math.min(ff[0], to.field[0]), Math.max(ff[1], to.field[1])],
    pen, leader: leaderShown(vk, prevVk),
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
 * A battle device box (render/units.js DeviceView `ctx.createBox(spec)`: `{ mesh, spec, update(cam, b), destroy() }`)
 * that follows the board layer: the 3D scene's crate mesh while `board()` returns a BoardScene, else the Pixi box of
 * the 2D board. A board switch mid-battle (lost WebGL context → 2D, or back to 3D) swaps the inner box on the next
 * update instead of leaving the crate on a dead scene. `mesh` is the Pixi mesh (null in 3D: nothing to add to Pixi).
 */
export function switchableBox({ board, pixi, spec }) {
  let inner = null, owner;
  const drop = () => { try { inner?.destroy(); } catch { /* ignore */ } inner = null; owner = undefined; };
  return {
    get mesh() { return inner ? inner.mesh || null : null; },
    get inner() { return inner; },
    // Resolve before DeviceView computes size / HP height, including the first frame after a board switch.
    get spec() { return board()?.deviceSpec(spec) || spec; },
    update(cam, b) {
      const scene = board() || null;
      if (!inner || owner !== scene || inner.destroyed) {
        drop();
        inner = scene ? scene.createDevice(spec) : pixi();
        owner = scene;
      }
      inner?.update(cam, b);
    },
    destroy: drop,
  };
}
