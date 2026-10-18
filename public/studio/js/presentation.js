// Data-only form models, shared with the server templates. Keep these outside shared/: authoring changes must not
// change the vanilla simulation identity. Validation delegates to the installed plugin readers, without coercion.
import { readThemeDeclaration } from '../../../shared/plugins/theme.js';
import { readNotices } from '../../../shared/plugins/notices.js';
import { isSkinKey, readAssetOverlay } from '../../../shared/plugins/visual.js';
import { operatorFxProblems, pluginFxProblems } from '../../js/render/vfx/pluginFormat.js';

export const PRESENTATION_TEMPLATES = Object.freeze(['theme', 'notices', 'fx', 'skins']);
export const fxUnit = id => `char_x_${id.replaceAll('-', '_')}_one`;
export const skinTarget = target => (target || 'operator:char_102_texas').replace(/^operator:/, '');
export const emptyBook = (id = 'flash') => ({ id, image: `fx/${id}.png`, frames: 1, cols: 1, fps: 12, anchor: [0.5, 0.5], scale: 1, blend: 'normal', loop: false });

/** Defaults only fill absent options. Invalid explicit values reach the same validator as plugin check. */
export function presentationOptions(template, options = {}) {
  if (template === 'theme') return { vars: {}, ...options };
  if (template === 'notices') return { notices: [{ id: 'notice-1', title: 'Announcement', body: 'Replace this text with your announcement.' }], ...options };
  if (template === 'skins') return { outfits: [{ key: 'outfit-1', name: 'Outfit 1', group: '' }], ...options };
  if (template === 'fx') return { source: 'flipbook', kitRef: 'char_102_texas', unit: '', skills: {},
    flipbooks: [emptyBook()], bindings: [{ slot: '0', phase: 'attack', effect: 'flash' }], ...options };
  return options;
}

export function skinsOverlay(target, outfits) {
  return { chars: { [skinTarget(target)]: { skins: Object.fromEntries(outfits.map(({ key, ...skin }) => [key, skin])) } } };
}
export function fxOverlay(id, o) {
  const bind = Object.create(null);
  for (const row of o.bindings) {
    const skills = bind[fxUnit(id)] ||= Object.create(null);
    (skills[row.slot] ||= Object.create(null))[row.phase] = row.effect;
  }
  return { fx: { flipbooks: Object.fromEntries(o.flipbooks.map(({ id: key, ...book }) => [key, book])), bind } };
}

export function validatePresentation(draft) {
  const o = presentationOptions(draft.template, draft.options);
  let problems = [];
  const add = (code, path, message) => problems.push({ code, path, message });
  if (draft.template === 'theme') problems = readThemeDeclaration({ vars: o.vars }).problems;
  if (draft.template === 'notices') problems = readNotices(o.notices).problems;
  if (draft.template === 'skins') {
    if (!Array.isArray(o.outfits) || o.outfits.length > 64) add('PLUGIN_ASSETS_SHAPE', 'outfits', 'At most 64 outfits per operator');
    else {
      const seen = new Set();
      for (const [i, outfit] of o.outfits.entries()) {
        if (!outfit || !isSkinKey(outfit.key) || seen.has(outfit.key)) add('PLUGIN_ASSETS_SHAPE', `outfits.${i}.key`, 'Unique skin key: 1–64 letters, digits, _ @ # + . -');
        seen.add(outfit?.key);
      }
      if (!problems.length) {
        const read = readAssetOverlay(skinsOverlay(draft.target, o.outfits));
        problems.push(...read.issues.filter(i => i.level === 'problem'));
      }
    }
  }
  if (draft.template === 'fx') {
    if (!['official', 'flipbook'].includes(o.source)) add('PLUGIN_PART_SHAPE', 'source', 'Choose official or flipbook');
    else if (o.source === 'official') {
      for (const message of operatorFxProblems({ unit: o.unit, skills: o.skills })) add('PLUGIN_RECORD_TYPE', 'fx', message);
    } else if (!Array.isArray(o.flipbooks) || !Array.isArray(o.bindings) || o.flipbooks.length > 128 || o.bindings.length > 60) {
      // [ASSUMED] One binding row per phase per supported slot (10 × 6), no duplicate addresses.
      add('PLUGIN_PART_SHAPE', 'fx', 'At most 128 flipbooks and 60 binding rows');
    } else {
      const ids = new Set(), addresses = new Set();
      for (const b of o.flipbooks) {
        if (!b || ids.has(b.id)) add('PLUGIN_PART_SHAPE', 'flipbooks', 'Duplicate or missing flipbook id');
        ids.add(b?.id);
      }
      for (const row of o.bindings) {
        if (!row) { add('PLUGIN_PART_SHAPE', 'bindings', 'Missing binding'); continue; }
        const address = `${row.slot}.${row.phase}`;
        if (addresses.has(address) || !ids.has(row.effect)) add('PLUGIN_PART_SHAPE', `bindings.${address}`, 'Duplicate binding or missing effect');
        addresses.add(address);
      }
      if (!problems.length) for (const message of pluginFxProblems(fxOverlay(draft.id, o).fx, [draft.id])) add('PLUGIN_PART_SHAPE', 'fx', message);
    }
  }
  return { ok: !problems.length, problems: problems.map(p => ({ ...p, path: p.path || p.at?.join('.') || '', message: p.message || p.text || p.code })) };
}
