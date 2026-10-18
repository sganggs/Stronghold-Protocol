// render/vfx/mounts.js — where an official effect sits on a unit (DESIGN §33.11 `_spawnLocation`, §33.12 skins): the
// mount points of the unit's skin (in its root frame: Unity axes, through its Graphic node and FaceSwitcher scale),
// mirrored for a left-facing unit and taken from the Back skeleton for one facing up, placed at the unit's feet in the
// battle's Unity frame. A point a BoneFollower keeps on a Spine bone (the skin's `bone`: Muzzle, the Special points —
// the client moves them with the skeleton, and the skin's `pos` is only the bone in the prefab's edit-time Default
// pose) is read from the unit's model as it is drawn now (`unit.view.boneOffset`, render/units.js), with its rotation
// (`mountRotation`). Pure functions (Node tests).
//
//   spawnPoint(skin, spawn, unit, out)   unit = { x, y, z (board: col, row, height), left: bool, back: bool, scale?,
//                                        view? (a UnitView: boneOffset), tilt? (the camera's, degrees), strike? (the
//                                        bone at the attack clip's strike frame) }
//   mountPoint(skin, type, unit, out)    FollowMountPoint's MountPointType (0 FOOT, 1 HIT, 2 MUZZLE, 3 HEAD, …)
//   mountRotation(skin, kind, unit, out) the world rotation of a mount point (Graphic tilt · facing turn · the bone's
//                                        angle, or the point's own rotation when its BoneFollower does not follow it;
//                                        'foot': FollowMountPoint FOOT, the face's skeleton root — tilt · facing turn)
//   spawnRotation(spawn)                 the rotation a spawn location gives an effect: 'graphic' (FOOT / HIT / HEAD:
//                                        the Graphic tilt, no facing turn), a point kind (MUZZLE / Special), else null
//   graphicRotation(skin, out)           the unit's Graphic rotation (−30° about X)
//   POINT_NAMES                          the skin point names tried per point kind (names vary by skin)

/** Point names per kind, in the order tried (§33.12: HitPoint, HeadPoint / HeadAnchor, Muzzle / MuzzlePoint, …). */
export const POINT_NAMES = Object.freeze({
  hit: ['HitPoint', 'Hit', 'hitPoint'],
  muzzle: ['Muzzle', 'MuzzlePoint', 'muzzle'],
  head: ['HeadPoint', 'HeadAnchor', 'Head'],
});
const special = (n) => [`Special${n}`, `SpecialPoint${n}`, `Special_${n}`];

/**
 * The camera tilt the drawn model faces (degrees from straight down: render/projection.js OFFICIAL.pitch). The client
 * turns every unit's Graphic node −30° about X — its skeleton plane faces the 30° battle camera — and the field view
 * draws the skeleton as an upright billboard under the same camera: a model offset `up` along the model is
 * (0, up·cos t, −up·sin t) in the Unity frame.
 */
export const SKELETON_TILT = 30;
/** The client's Graphic rotation (−30° about X), for a skin that does not carry its own. */
const GRAPHIC_ROT = Object.freeze([-0.258819, 0, 0, 0.965926]);
const DEG = Math.PI / 180;

/** The point kind of a ParticleEffect spawn location (null = the unit's feet / the ground). */
export function spawnKind(spawn) {
  switch (spawn) {
    case 2: return 'hit';
    case 3: case 6: return 'muzzle';
    case 4: return 'head';
    case 8: return 's0'; case 9: return 's1'; case 10: return 's2'; case 11: return 's3';
    default:
      if (spawn >= 13 && spawn <= 16) return 's' + (spawn - 9);
      if (spawn >= 18 && spawn <= 25) return 's' + (spawn - 10);
      if (spawn >= 27 && spawn <= 34) return 's' + (spawn - 11);
      return null;
  }
}

/**
 * The point kind whose rotation a spawn location also takes (DESIGN §33.11; the client's
 * Effect._InitLocationFromEntity): MUZZLE_POINT (3) and the MP_SPECIAL points (_SetPosAndRotToMountPoint) set the
 * effect's rotation to the mount point's; FOOT, HIT, HEAD and MUZZLE_POINT_WITHOUT_ROTATION keep the unit's own
 * (unturned) rotation — their prefabs are pre-tilted for the camera — and the others are no mount point.
 */
export function spawnRotationKind(spawn) {
  if (spawn === 3) return 'muzzle';
  const k = spawnKind(spawn);
  return k && k[0] === 's' ? k : null;
}

/**
 * The rotation an effect spawned on a unit takes from its spawn location (DESIGN §33.11; the client's
 * Effect._InitLocationFromEntity, GameAssembly.dll of 2026-09-13, which sets the effect's transform.rotation):
 * FOOT_POINT, HIT_POINT and HEAD_POINT take the unit's graphicFootTransform / graphicTransform — its skin's animator
 * (CharacterAnimator.get_graphicTransform: its own transform), which Character.SetupSkin parents to the Graphic node: the
 * −30° tilt about X, without the facing turn (the FaceSwitcher sits below it) — `'graphic'`; MUZZLE_POINT and the Special
 * points the point's own world rotation (spawnRotationKind: its kind); NONE, MUZZLE_POINT_WITHOUT_ROTATION
 * (Quaternion.identity), the ground and tile locations (the unit root's, unturned) the identity — null. An effect
 * authored standing (the skeleton's plane: 荒芜拉普兰德 S3's seal, 能天使 S3's light bars) stands facing the camera; the
 * pre-tilted content (+30° about X: common_hit_01's sparks) lies on the board.
 */
export function spawnRotation(spawn) {
  if (spawn === 1 || spawn === 2 || spawn === 4) return 'graphic';
  return spawnRotationKind(spawn);
}

/** The unit's Graphic rotation (quaternion [x, y, z, w]): the skin's `graphic.rot`, else the client's −30° about X. */
export function graphicRotation(skin, out = [0, 0, 0, 1]) {
  const g = skin && skin.graphic && Array.isArray(skin.graphic.rot) && skin.graphic.rot.length === 4 && skin.graphic.rot.every(Number.isFinite) ? skin.graphic.rot : GRAPHIC_ROT;
  out[0] = g[0]; out[1] = g[1]; out[2] = g[2]; out[3] = g[3];
  return out;
}

/** The point kind of a FollowMountPoint MountPointType. */
export function mountKind(type) {
  switch (type) {
    case 1: return 'hit';
    case 2: return 'muzzle';
    case 3: return 'head';
    case 5: return 's0'; case 6: return 's1'; case 8: return 's2'; case 9: return 's3';
    default:
      if (type >= 10 && type <= 29) return 's' + (type - 6);
      return null; // FOOT, UI, GROUND
  }
}

const fixes = new WeakMap();
const _fixed = [0, 0, 0];
/** The loaded index.json's version (FxLibrary.index sets it): version 2 placed every skin's points over the feet. */
let indexVersion = 1;

/** The version of the index.json in use (render/vfx/library.js index): from 2 on skinShift has nothing to move. */
export function setIndexVersion(v) { indexVersion = Number.isInteger(v) && v > 0 ? v : 1; }

/**
 * A skin whose points sit whole tiles away from the unit's feet (84 of the full set's 709 hit points — 72 enemies,
 * 10 tokens, 2 operators — are shifted by one constant x / y per skin: the prefab's Spine / FaceSwitcher placement,
 * which the client resets at run time, is part of the extracted composition) is moved back: its HitPoint over the feet
 * at the height it has (y = −0.9 z, the slope of the well-placed skins' hit points), every point by the same shift.
 * [ASSUMED] the shift. Index version 2 drops that placement (DESIGN §33.12 Skin, changelog (9)): nothing to move then.
 */
export function skinShift(skin) {
  if (!skin || !skin.points || indexVersion >= 2) return null;
  let f = fixes.get(skin);
  if (f !== undefined) return f;
  f = null;
  let ref = null;
  for (const nm of ['HitPoint', 'Hit', 'HeadPoint', ...Object.keys(skin.points)]) {
    const p = skin.points[nm];
    const v = p && (p.front || p.all || p.back);
    if (v && Array.isArray(v.pos)) { ref = { nm, pos: v.pos }; break; }
  }
  if (ref) {
    const [x, y, z] = ref.pos;
    const head = ref.nm.startsWith('Head');
    const yWant = -z * (head ? 1.3 : 0.9);
    if (Math.abs(x) > 0.9 || y > 1.6 || y < -0.6) f = [-x, yWant - y, 0];
  }
  fixes.set(skin, f);
  return f;
}

/**
 * The skin point of a kind for a facing: `{ pos, bones, rot, followRot }` — `pos` its offset (Unity, unit root frame;
 * skinShift applied), `bones` the BoneFollower bone names to look for in the model drawn (the facing's first, then the
 * other skeleton's: a unit facing up without a Back model draws the Front one) or null for a point no bone moves, `rot`
 * the point's local rotation (index.json's `rot`, quaternion [x, y, z, w]; null in an index extracted without it),
 * `followRot` whether the bone's angle turns it (a BoneFollower's followBoneRotation: index.json's `followRot`, true
 * when the index does not say) — or null when the skin lacks it.
 */
export function skinPoint(skin, kind, back) {
  const pts = skin && skin.points;
  if (!pts || !kind) return null;
  const names = kind[0] === 's' ? special(kind.slice(1)) : POINT_NAMES[kind] || [];
  for (const nm of names) {
    const p = pts[nm];
    if (!p) continue;
    const f = (back ? p.back : p.front) || p.all || p.front || p.back;
    if (!f || !Array.isArray(f.pos)) continue;
    const other = f === p.front ? p.back : p.front;
    const bones = f.bone ? (other && other.bone && other.bone !== f.bone ? [f.bone, other.bone] : [f.bone]) : null;
    const rot = Array.isArray(f.rot) && f.rot.length === 4 && f.rot.every(Number.isFinite) ? f.rot : null;
    const followRot = !!bones && f.followRot !== false;
    const sh = skinShift(skin);
    if (!sh) return { pos: f.pos, bones, rot, followRot };
    return { pos: [f.pos[0] + sh[0], f.pos[1] + sh[1], f.pos[2] + sh[2]], bones, rot, followRot };
  }
  return null;
}

/** A skin point's offset (Unity, unit root frame) by kind and facing; null when the skin lacks it. */
export function pointOffset(skin, kind, back) {
  const p = skinPoint(skin, kind, back);
  if (!p) return null;
  _fixed[0] = p.pos[0]; _fixed[1] = p.pos[1]; _fixed[2] = p.pos[2];
  return _fixed;
}

const _bo = { x: 0, up: 0, angle: 0, flip: 1 };

/**
 * The live bone of a bone-followed point on the unit's model (`unit.view.boneOffset`, render/units.js: the bone as the
 * model is drawn now — `unit.strike`: as its attack clip poses it at the strike frame —, its offset from the feet in
 * tiles — `x` along the screen's right with the facing applied, `up` along the model — its angle in the skeleton and
 * the drawn facing), or null (no model drawn, no such bone).
 */
function liveBone(p, unit) {
  const v = p && p.bones ? unit.view : null;
  if (!v || typeof v.boneOffset !== 'function') return null;
  const o = v.boneOffset(p.bones, _bo, !!unit.strike);
  return o && Number.isFinite(o.x) && Number.isFinite(o.up) ? o : null;
}

/**
 * The Unity battle-frame position of a point of a unit: its feet (board x, y, z → (x − 10, y − 9, −z)) plus the
 * skin offset (x mirrored when the unit faces left; `scale` multiplies the offset) — for a bone-followed point the
 * bone where the model draws it now: `up` along the plane the camera sees face-on (`unit.tilt`, else SKELETON_TILT).
 */
export function unitPoint(skin, kind, unit, out = [0, 0, 0]) {
  const k = Number.isFinite(unit.scale) ? unit.scale : 1;
  out[0] = unit.x - 10; out[1] = unit.y - 9; out[2] = -(unit.z || 0);
  const p = kind ? skinPoint(skin, kind, !!unit.back) : null;
  const b = p ? liveBone(p, unit) : null;
  if (b) {
    const t = (Number.isFinite(unit.tilt) ? unit.tilt : SKELETON_TILT) * DEG;
    out[0] += b.x; out[1] += b.up * Math.cos(t); out[2] -= b.up * Math.sin(t);
  } else if (p) {
    const o = p.pos;
    out[0] += (unit.left ? -o[0] : o[0]) * k;
    out[1] += o[1] * k;
    out[2] += o[2] * k;
  } else if (kind) {
    // no such point: a plausible fallback over the feet (hit ≈ a third of a tile up, muzzle a little higher, head ×2)
    const h = kind === 'head' ? 0.75 : kind === 'muzzle' ? 0.4 : 0.3;
    out[1] += h * 0.866 * k; out[2] -= h * 0.5 * k;
  }
  return out;
}

export function spawnPoint(skin, spawn, unit, out) { return unitPoint(skin, spawnKind(spawn), unit, out); }

export function mountPoint(skin, type, unit, out) { return unitPoint(skin, mountKind(type), unit, out); }

/**
 * The world rotation of a unit's mount point (Unity quaternion [x, y, z, w]) — what the client's effects take from it
 * (FollowMountPoint without `_keepOriginRotation`, a MUZZLE_POINT or Special-point spawn): the unit's Graphic tilt
 * (the skin's `graphic.rot`, −30° about X), the FaceSwitcher's turn for a unit drawn facing left (180° about the
 * skeleton plane's up axis: the client turns that node to face left) and the point's local rotation in its skeleton
 * node. A BoneFollower with followBoneRotation sets that to the bone's angle in the skeleton plane (Spine's world
 * rotation, counter-clockwise; 0 without the drawn bone); a point whose BoneFollower does not follow the bone's
 * rotation (`followRot: false` — 洛洛's SpecialPoint1, 令's SpecialPoint2: 30° about X, cancelling the Graphic's tilt)
 * and a point no bone moves keep their own (`rot`). An index extracted without them (no `rot` / `followRot`): the
 * bone's angle for every bone-followed point, the identity for the others (the ones read then, HitPoint / HeadPoint,
 * are the identity). Null without a kind (GROUND, UI: the unit's own, unturned rotation). 'foot' (a FollowMountPoint on
 * FOOT: CharacterAnimator.get_footTransform, the face's skeleton root under the FaceSwitcher) is no skin point: the
 * Graphic tilt and the facing turn alone.
 */
export function mountRotation(skin, kind, unit, out = [0, 0, 0, 1]) {
  if (!kind) return null;
  const g = skin && skin.graphic && Array.isArray(skin.graphic.rot) && skin.graphic.rot.length === 4 ? skin.graphic.rot : GRAPHIC_ROT;
  const p = skinPoint(skin, kind, !!unit.back);
  const b = p ? liveBone(p, unit) : null;
  const left = b ? b.flip < 0 : !!unit.left;
  // the point's local rotation l: Rz(the bone's angle) = (0, 0, sin, cos) when the bone turns it, else its own
  let lx = 0, ly = 0, lz = 0, lw = 1;
  if (p && p.followRot) {
    const ang = b && Number.isFinite(b.angle) ? b.angle * DEG : 0;
    lz = Math.sin(ang / 2); lw = Math.cos(ang / 2);
  } else if (p && p.rot) {
    const r = p.rot;
    lx = r[0]; ly = r[1]; lz = r[2]; lw = r[3];
  }
  // g · Ry(left ? 180° : 0) · l, with Ry(180°) · l = (0, 1, 0, 0) · (lx, ly, lz, lw) = (lz, lw, −lx, −ly)
  const fx = left ? lz : lx, fy = left ? lw : ly, fz = left ? -lx : lz, fw = left ? -ly : lw;
  const ax = g[0], ay = g[1], az = g[2], aw = g[3];
  out[0] = aw * fx + ax * fw + ay * fz - az * fy;
  out[1] = aw * fy - ax * fz + ay * fw + az * fx;
  out[2] = aw * fz + ax * fy - ay * fx + az * fw;
  out[3] = aw * fw - ax * fx - ay * fy - az * fz;
  return out;
}
