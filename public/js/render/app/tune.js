// public/js/render/app/tune.js — camera, drag and highlight tunables of the field view.

const CAMERA_MS = 750;

/** Camera pan to / from the enemy preview pen (configBlackBoard move_time 0.25). */
export const PEN_CAMERA_MS = 250;

/** Recovery of a lost 3D board context: delays of the rebuild attempts (ms) and how soon a new loss counts as failure. */
const BOARD3D_RETRY_MS = [1200, 4000, 12000];

const BOARD3D_STABLE_MS = 10000;

/**
 * Map view (see the map-view block of render/app.js): a wheel notch scales the player's view by
 * exp(−deltaY · WHEEL_ZOOM) — one mouse notch (deltaY 100) is ≈ ×1.17 in / ×0.85 out — and a trackpad's fractional
 * delta keeps the same feel (it is multiplicative, so a step feels equal at every zoom level). The limits live in
 * projection.js (ZOOM_MIN…ZOOM_MAX and a camera-aware px-per-tile band: clampZoomFor).
 */
const WHEEL_ZOOM = 0.0016;

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

export { CAMERA_MS, BOARD3D_RETRY_MS, BOARD3D_STABLE_MS, WHEEL_ZOOM, RANGE_GROUPS, CHAIN_KINDS, DROP_PENDING_MS };
