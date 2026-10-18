// Presentation-only plugin contract (§34.18). Shared by the loader and the browser, outside the sim identity.
export const PLUGIN_FX_LIMITS = Object.freeze({ files: 256, bytes: 32 * 1024 * 1024, jsonBytes: 1024 * 1024,
  units: 64, effects: 128, nodes: 64, systems: 16, particles: 1024, emitters: 32, textureSize: 2048, frames: 256 }); // [ASSUMED]
export const FX_PHASES = Object.freeze(['skillStart', 'skillLoop', 'skillEnd', 'attack', 'hit', 'projectile']);
export const fxObject = v => !!v && typeof v === 'object' && !Array.isArray(v);
export const fxId = v => typeof v === 'string' && /^[a-z0-9][a-z0-9_-]{0,95}$/.test(v) && !['constructor', 'prototype', '__proto__'].includes(v);
export const fxPath = v => typeof v === 'string' && /^fx\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\.(json|png)$/.test(v);
const keys = (v, allowed) => fxObject(v) && Object.keys(v).every(k => allowed.includes(k));
const num = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
const integer = (v, min, max) => Number.isInteger(v) && num(v, min, max);
export const fxNamespace = id => `plugin:${id}:`;
export const ownsFxUnit = (id, owners) => owners.some(owner => id.startsWith(`char_x_${owner.replace(/-/g, '_')}_`) && fxId(id));

export function operatorFxProblems(fx) {
  if (fx === undefined) return [];
  if (!keys(fx, ['unit', 'skills']) || !fxId(fx.unit)) return ['fx needs a unit key and optional skills map'];
  if (fx.skills !== undefined && (!fxObject(fx.skills) || Object.keys(fx.skills).length > 10 || Object.entries(fx.skills).some(([k, v]) => !fxId(k) || !fxId(v)))) return ['fx.skills must map at most 10 skill indices/ids to effect skill ids'];
  return [];
}

export function flipbookProblems(b) {
  if (!keys(b, ['image', 'frames', 'cols', 'fps', 'anchor', 'scale', 'blend', 'loop']) || !fxPath(b.image) || !b.image.endsWith('.png')) return ['flipbook needs a PNG under fx/; unknown fields are refused'];
  if (!integer(b.frames, 1, 256) || !integer(b.cols, 1, b.frames) || !num(b.fps, 0.1, 60)) return ['frames 1–256, cols 1–frames and fps 0.1–60 required'];
  if (b.anchor !== undefined && (!Array.isArray(b.anchor) || b.anchor.length !== 2 || b.anchor.some(v => !num(v, 0, 1)))) return ['anchor must be [x,y] in 0–1'];
  if (b.scale !== undefined && !num(b.scale, 0.01, 8) || b.blend !== undefined && !['normal', 'add'].includes(b.blend) || b.loop !== undefined && typeof b.loop !== 'boolean') return ['invalid scale, blend or loop'];
  return [];
}

export function pluginFxProblems(fx, owners) {
  if (!keys(fx, ['index', 'flipbooks', 'bind', 'silentPhases'])) return ['unknown fx field'];
  const out = [];
  if (fx.index !== undefined && fx.index !== 'fx/index.json') out.push('compiled index must be fx/index.json');
  if (fx.flipbooks !== undefined) {
    if (!fxObject(fx.flipbooks) || Object.keys(fx.flipbooks).length > 128) out.push('at most 128 flipbooks');
    else for (const [id, b] of Object.entries(fx.flipbooks)) {
      if (!fxId(id)) out.push('invalid flipbook id');
      out.push(...flipbookProblems(b).map(s => `${id}: ${s}`));
    }
  }
  if (fx.bind !== undefined) {
    if (!fxObject(fx.bind) || Object.keys(fx.bind).length > 64) out.push('at most 64 bound units');
    else for (const [id, skills] of Object.entries(fx.bind)) {
      if (!ownsFxUnit(id, owners) || !fxObject(skills) || Object.keys(skills).length > 10) { out.push(`invalid bound unit ${id}`); continue; }
      for (const [sk, phases] of Object.entries(skills)) if (!fxId(sk) || !keys(phases, FX_PHASES) || Object.values(phases).some(v => !fxId(v))) out.push(`invalid skill binding ${id}.${sk}`);
    }
  }
  if (fx.silentPhases !== undefined && (!Array.isArray(fx.silentPhases) || fx.silentPhases.length > 128 || fx.silentPhases.some(v => typeof v !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(v)))) out.push('silentPhases needs at most 128 phase names');
  return out;
}

/** Exact frame boundaries, top-left atlas order; trailing cells are never displayed. Battle seconds only. */
export function flipbookFrame(b, seconds) {
  const tick = Math.floor(Math.max(0, seconds) * b.fps + 1e-9);
  if (!b.loop && tick >= b.frames) return null;
  const frame = tick % b.frames, rows = Math.ceil(b.frames / b.cols);
  return { frame, col: frame % b.cols, row: Math.floor(frame / b.cols), rows, u: (frame % b.cols) / b.cols, v: Math.floor(frame / b.cols) / rows };
}

export function pluginFxSurface() {
  return ['record.operator.fx', 'overlay.fx.index', 'overlay.fx.flipbooks', 'overlay.fx.bind', 'overlay.fx.silentPhases', 'dsl.fx.plugin'].map(name =>
    ({ name, group: 'effects', stability: 'stable', since: '0.3.1', anchor: 'public/js/render/vfx/pluginFormat.js#pluginFxProblems' }));
}
