// Compiled effects are data. Validate before hashing/serving; no pack code, shader source or URL is accepted.
import fs from 'node:fs';
import path from 'node:path';
import { readPluginManifest } from '../../shared/plugins/manifest.js';
import { issueList } from '../../shared/plugins/errors.js';
import { fxObject as obj, fxId, fxPath, pluginFxProblems, ownsFxUnit, PLUGIN_FX_LIMITS as CAP } from '../../public/js/render/vfx/pluginFormat.js';

import { boundedFxJson, validateFxPrefab } from '../../public/js/render/vfx/pluginValidate.js';
export { validateFxPrefab } from '../../public/js/render/vfx/pluginValidate.js';

const allowed = (v, names) => obj(v) && Object.keys(v).every(k => names.includes(k));
const check = (ok, message) => { if (!ok) throw new Error(message); };
const table = (v, cap) => obj(v) && Object.keys(v).length <= cap && Object.keys(v).every(fxId);
/** Inline effects contain JSON paths, unlike legacy art leaves; preserve the old reader for all other fields. */
export function readFxManifest(raw, ctx) {
  if (!obj(raw?.assets) || raw.assets.fx === undefined) return readPluginManifest(raw, ctx);
  const { fx, ...assets } = raw.assets;
  const read = readPluginManifest({ ...raw, assets }, ctx), list = issueList();
  list.take(read);
  for (const message of pluginFxProblems(fx, [ctx.id, ...Object.keys(raw.requires || {})])) list.problem('PLUGIN_PART_SHAPE', `fx: ${message}`, { at: ['assets', 'fx'], detail: message });
  const draft = read.manifest || read.draft;
  if (draft?.parts.assets) {
    draft.parts.assets.inline = { ...draft.parts.assets.inline, fx };
    if (!list.problems.length) draft.parts.assets.files.push(...[fx.index, ...Object.values(fx.flipbooks || {}).map(b => b.image)].filter(Boolean));
  }
  return { manifest: list.problems.length ? null : read.manifest, draft, problems: list.problems, warnings: list.warnings, issues: list.issues };
}

export function readFxAssets(dir, config, owners, listed) {
  const errors = pluginFxProblems(config, owners);
  if (errors.length) throw new Error(errors.join('; '));
  const used = new Set(), sizes = new Map(listed.filter(f => !f.link).map(f => [f.rel, f.bytes]));
  let bytes = 0, jsonBytes = 0;
  const read = rel => {
    check(fxPath(rel) && sizes.has(rel), `missing or unsafe effect file ${rel}`);
    let abs = dir;
    for (const component of rel.split('/')) { abs = path.join(abs, component); check(!fs.lstatSync(abs).isSymbolicLink(), 'effect symlink refused'); }
    if (!used.has(rel)) { used.add(rel); bytes += sizes.get(rel); }
    check(used.size <= CAP.files && bytes <= CAP.bytes && (!rel.endsWith('.json') || sizes.get(rel) <= CAP.jsonBytes), 'effect file/byte limit');
    return fs.readFileSync(abs);
  };
  const json = rel => { const b = read(rel); jsonBytes += b.length; check(jsonBytes <= 4 * 1024 * 1024, 'compiled effect JSON exceeds 4 MB'); const d = JSON.parse(b); boundedFxJson(d); return d; };
  const images = {};
  const image = rel => {
    if (images[rel]) return images[rel];
    const b = read(rel);
    check(rel.endsWith('.png') && b.length >= 33 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && b.toString('ascii', 12, 16) === 'IHDR', 'effect texture must be PNG');
    const w = b.readUInt32BE(16), h = b.readUInt32BE(20);
    check(w > 0 && h > 0 && w <= CAP.textureSize && h <= CAP.textureSize && b[24] === 8 && [2, 6].includes(b[25]), 'effect texture: 8-bit RGB/RGBA PNG, at most 2048 square');
    return images[rel] = { w, h };
  };
  for (const b of Object.values(config.flipbooks || {})) {
    const im = image(b.image);
    check(im.w % b.cols === 0 && im.h % Math.ceil(b.frames / b.cols) === 0, 'flipbook cells must divide the image');
  }
  const prefabs = {}, textures = {};
  let index = null;
  if (config.index) {
    index = json(config.index);
    check(allowed(index, ['format', 'version', 'units', 'skills', 'prefabs', 'textures', 'projectiles']) && index.format === 'fx-index' && index.version === 3, 'fx-index version 3 required');
    for (const [k, cap] of [['units', CAP.units], ['skills', CAP.effects], ['prefabs', CAP.effects], ['textures', CAP.effects]]) check(table(index[k], cap), `invalid index ${k}`);
    check(index.projectiles === undefined || obj(index.projectiles) && !Object.keys(index.projectiles).length, 'use fx.bind.projectile for plugin projectiles');
    for (const id of Object.keys(index.units)) check(ownsFxUnit(id, owners), 'compiled units must belong to the plugin or a declared dependency');
    for (const [id, t] of Object.entries(index.textures)) { check(allowed(t, ['file']) && fxPath(t.file), 'invalid texture entry'); textures[id] = { path: t.file, ...image(t.file) }; }
    for (const [id, p] of Object.entries(index.prefabs)) {
      check(allowed(p, ['file', 'looping', 'spawn', 'follow']) && fxPath(p.file) && p.file.endsWith('.json'), 'invalid prefab entry');
      check(!Object.hasOwn(config.flipbooks || {}, id), 'prefab and flipbook ids must differ');
      const d = validateFxPrefab(json(p.file), textures);
      check(d.key === id, 'prefab key differs from index'); prefabs[id] = d;
    }
    // Only the bounded subset the renderer can reliably place is admitted. Unknown fields fail closed.
    const use = u => allowed(u, ['keys', 'role', 'from', 'ability', 'oneshot']) && Array.isArray(u.keys) && u.keys.length <= 16 && u.keys.every(k => Object.hasOwn(prefabs, k)) && ['start', 'loop', 'end', 'hit', 'cast'].includes(u.role);
    for (const s of Object.values(index.skills)) check(allowed(s, ['uses', 'mode', 'rootClass']) && Array.isArray(s.uses) && s.uses.length <= 128 && s.uses.every(use), 'invalid skill uses');
    for (const u of Object.values(index.units)) {
      check(allowed(u, ['kind', 'skills', 'modes', 'startEffect', 'deadEffect']) && u.kind === 'char' && obj(u.skills) && Object.keys(u.skills).length <= 10 && Array.isArray(u.modes) && u.modes.length <= 10, 'invalid unit');
      for (const [id, s] of Object.entries(u.skills)) check(Object.hasOwn(index.skills, id) && JSON.stringify(s) === JSON.stringify(index.skills[id]), 'unit skills must match index skills');
      for (const m of u.modes) {
        check(allowed(m, ['name', 'attack']) && typeof m.name === 'string' && allowed(m.attack, ['cast', 'hit']), 'invalid attack mode');
        for (const k of ['cast', 'hit']) check(Array.isArray(m.attack[k]) && m.attack[k].length <= 32 && m.attack[k].every(row => allowed(row, ['effects', 'oneshot', 'startEvent', 'endEvent']) && Array.isArray(row.effects) && row.effects.length <= 16 && row.effects.every(id => Object.hasOwn(prefabs, id))), 'invalid attack effect uses');
      }
      for (const k of ['startEffect', 'deadEffect']) check(u[k] === undefined || Object.hasOwn(prefabs, u[k]), 'invalid unit effect');
    }
  }
  for (const skills of Object.values(config.bind || {})) for (const phases of Object.values(skills)) for (const id of Object.values(phases)) check(Object.hasOwn(prefabs, id) || Object.hasOwn(config.flipbooks || {}, id), `missing bound effect ${id}`);
  return { files: [...used], value: { config, index, prefabs, textures, images, owners: [...owners] } };
}
