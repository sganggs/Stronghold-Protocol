// Pure author-prefab validation shared by the server reader and browser merge; outside the sim identity.
import { fxObject as obj, fxId, PLUGIN_FX_LIMITS as CAP } from './pluginFormat.js';

const allowed = (v, names) => obj(v) && Object.keys(v).every(k => names.includes(k));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const scalar = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const flag = v => [undefined, false, true, 0, 1].includes(v);
const optional = (v, lo, hi) => v === undefined || scalar(v, lo, hi);
const oneOf = (v, values) => v === undefined || values.includes(v);

/** Reject unbounded recursion, numeric payloads, prototype keys and hidden strings before schema-specific checks. */
export function boundedFxJson(value) {
  let left = 100000;
  const walk = (v, depth) => {
    check(--left >= 0 && depth <= 24, 'effect JSON complexity limit');
    if (typeof v === 'number') check(Number.isFinite(v) && Math.abs(v) <= 10000, 'effect number outside ±10000');
    if (typeof v === 'string') check(v.length <= 256, 'effect string too long');
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) {
      check(!['__proto__', 'prototype', 'constructor'].includes(k), 'unsafe effect key');
      walk(x, depth + 1);
    }
  };
  walk(value, 0);
}

export function validateFxPrefab(d, textures) {
  boundedFxJson(d);
  check(allowed(d, ['format', 'version', 'key', 'root', 'nodes', 'materials', 'textures', 'meshes', 'refs', 'clips', 'stats', 'bundle']) && d.format === 'fx-prefab' && d.version === 1 && fxId(d.key), 'fx-prefab version 1 required');
  check(Array.isArray(d.nodes) && d.nodes.length > 0 && d.nodes.length <= CAP.nodes && (d.root ?? 0) === 0, 'prefab node/root limit');
  // [ASSUMED] First author format: particles and built-in quads, no chained effects, custom meshes or animation clips.
  for (const k of ['refs', 'meshes', 'clips']) check(d[k] === undefined || Array.isArray(d[k]) && d[k].length === 0, `${k} are unsupported in plugin prefabs`);
  check(Array.isArray(d.textures) && d.textures.every(t => Object.hasOwn(textures, t)), 'undeclared prefab texture');
  check(Array.isArray(d.materials) && d.materials.length <= 16, 'material limit');
  for (const m of d.materials) {
    check(allowed(m, ['name', 'shader', 'passes', 'queue', 'keywords', 'floats', 'colors', 'textures']) && ['Torappu/Particles/Additive', 'Torappu/Particles/Alpha Blended'].includes(m.shader), 'only built-in additive/alpha particle materials');
    check(obj(m.textures) && Object.values(m.textures).every(t => allowed(t, ['tex', 'st']) && Object.hasOwn(textures, t.tex) && (t.st === undefined || Array.isArray(t.st) && t.st.length === 4 && t.st.every(Number.isFinite))), 'invalid material texture');
    check(m.passes === undefined || Array.isArray(m.passes) && m.passes.length <= 2, 'material pass limit');
    for (const p of m.passes || []) check(allowed(p, ['blend', 'blendOp', 'zTest', 'zWrite', 'cull', 'colorMask']) &&
      (p.blend === undefined || Array.isArray(p.blend) && p.blend.length === 4 && p.blend.every(v => ['Zero', 'One', 'DstColor', 'SrcColor', 'OneMinusDstColor', 'SrcAlpha', 'OneMinusSrcColor', 'DstAlpha', 'OneMinusDstAlpha', 'SrcAlphaSaturate', 'OneMinusSrcAlpha'].includes(v))) &&
      oneOf(p.blendOp, ['Add', 'Subtract', 'ReverseSubtract', 'Min', 'Max']) && oneOf(p.zTest, ['Disabled', 'Never', 'Less', 'Equal', 'LessEqual', 'Greater', 'NotEqual', 'GreaterEqual', 'Always']) && flag(p.zWrite) && oneOf(p.cull, ['Off', 'Front', 'Back']) && optional(p.colorMask, 0, 15), 'invalid material pass');
    check(m.keywords === undefined || Array.isArray(m.keywords) && m.keywords.length <= 32 && m.keywords.every(k => typeof k === 'string'), 'invalid material keywords');
    check(m.floats === undefined || obj(m.floats) && Object.keys(m.floats).length <= 64 && Object.values(m.floats).every(Number.isFinite), 'invalid material floats');
    check(m.colors === undefined || obj(m.colors) && Object.keys(m.colors).length <= 16 && Object.values(m.colors).every(v => Array.isArray(v) && v.length === 4 && v.every(Number.isFinite)), 'invalid material colors');
  }
  let systems = 0, particles = 0, emitters = 0;
  for (const [i, n] of d.nodes.entries()) {
    check(allowed(n, ['id', 'name', 'parent', 'children', 'active', 'pos', 'rot', 'scale', 'particleSystem', 'particleSystemRenderer', 'meshFilter', 'meshRenderer', 'behaviours']), 'unsupported prefab node field');
    check(n.id === i && (i === 0 ? n.parent == null : Number.isInteger(n.parent) && n.parent >= 0 && n.parent < i), 'nodes must be a parent-first tree');
    check(n.children === undefined || Array.isArray(n.children) && n.children.every(c => Number.isInteger(c) && c > i && c < d.nodes.length && d.nodes[c].parent === i), 'invalid child reference');
    check(flag(n.active), 'invalid node active flag');
    for (const [k, size] of [['pos', 3], ['rot', 4], ['scale', 3]]) check(n[k] === undefined || Array.isArray(n[k]) && n[k].length === size && n[k].every(Number.isFinite), `invalid ${k}`);
    check(n.behaviours === undefined || Array.isArray(n.behaviours) && n.behaviours.length <= 1 && n.behaviours.every(b => allowed(b, ['class', 'enabled', 'fields']) && b.class === 'ParticleEffect' && allowed(b.fields, ['_isLoop', '_maxLifetime', '_spawnLocation', '_delayToPlay', '_delayToFinish', '_rotateType'])), 'unsupported behaviour');
    for (const b of n.behaviours || []) { const f = b.fields;
      check(flag(b.enabled) && flag(f._isLoop) && optional(f._maxLifetime, -1, 30) && optional(f._delayToPlay, 0, 30) && optional(f._delayToFinish, 0, 30) && optional(f._spawnLocation, 0, 20) && optional(f._rotateType, 0, 20), 'invalid ParticleEffect fields');
    }
    if (n.meshFilter !== undefined) check(n.meshFilter?.builtin === 'Quad' && Object.keys(n.meshFilter).length === 1, 'only builtin Quad meshes');
    for (const r of [n.meshRenderer, n.particleSystemRenderer].filter(Boolean)) {
      check(allowed(r, ['m_Enabled', 'renderMode', 'renderAlignment', 'materials', 'm_SortingOrder', 'm_SortingLayer']) && Array.isArray(r.materials) && r.materials.length <= 4 && r.materials.every(m => Number.isInteger(m) && m >= 0 && m < d.materials.length), 'invalid renderer/material reference');
      check(r.renderMode === undefined || ['billboard', 'horizontal', 'vertical'].includes(r.renderMode), 'unsupported particle render mode');
      check(flag(r.m_Enabled) && (r.renderAlignment === undefined || ['view', 'world', 'local', 'facing', 'velocity'].includes(r.renderAlignment)) && optional(r.m_SortingOrder, -100, 100) && optional(r.m_SortingLayer, 0, 100), 'invalid renderer fields');
    }
    if (n.particleSystem) {
      const p = n.particleSystem, init = p.InitialModule, em = p.EmissionModule;
      check(allowed(p, ['lengthInSec', 'looping', 'prewarm', 'startDelay', 'playOnAwake', 'simulationSpeed', 'moveWithTransform', 'scalingMode', 'InitialModule', 'EmissionModule']), 'unsupported particle module');
      check([undefined, false, 0].includes(p.prewarm) && Number.isFinite(p.lengthInSec) && p.lengthInSec > 0 && p.lengthInSec <= 30, 'particle duration 0–30; no prewarm');
      check(flag(p.looping) && flag(p.playOnAwake) && optional(p.startDelay, 0, 30) && optional(p.simulationSpeed, 0, 8) && optional(p.moveWithTransform, 0, 2) && optional(p.scalingMode, 0, 2), 'invalid particle main fields');
      check(allowed(init, ['startLifetime', 'startSpeed', 'startSize', 'startColor', 'maxNumParticles']) && Number.isInteger(init.maxNumParticles) && init.maxNumParticles >= 1 && init.maxNumParticles <= 256, 'particle capacity 1–256');
      for (const k of ['startLifetime', 'startSpeed', 'startSize']) check(typeof init[k] === 'number' && init[k] >= 0 && init[k] <= (k === 'startLifetime' ? 30 : 8), `bounded scalar ${k} required`);
      check(Array.isArray(init.startColor) && init.startColor.length === 4 && init.startColor.every(v => Number.isFinite(v) && v >= 0 && v <= 1), 'RGBA color required');
      check(allowed(em, ['rateOverTime', 'm_Bursts']) && Number.isFinite(em.rateOverTime) && em.rateOverTime >= 0 && em.rateOverTime <= 256 && Array.isArray(em.m_Bursts) && em.m_Bursts.length <= 16, 'invalid emission');
      for (const b of em.m_Bursts) check(allowed(b, ['time', 'countCurve', 'cycleCount', 'repeatInterval', 'probability']) && Number.isFinite(b.countCurve) && b.countCurve >= 0 && b.countCurve <= 256 && (b.cycleCount === undefined || Number.isInteger(b.cycleCount) && b.cycleCount >= 1 && b.cycleCount <= 16) && optional(b.time, 0, 30) && optional(b.repeatInterval, 0.01, 30) && optional(b.probability, 0, 1), 'invalid burst');
      systems++; particles += init.maxNumParticles; emitters += em.m_Bursts.length + (em.rateOverTime > 0 ? 1 : 0);
    }
  }
  check(systems <= CAP.systems && particles <= CAP.particles && emitters <= CAP.emitters, 'particle systems/particles/emitters exceed cap');
  return d;
}

