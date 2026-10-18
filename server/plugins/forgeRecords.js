// Forge JSON mappings only. No workshop module is imported or evaluated.
import { clone, object } from '../../shared/plugins/dataUtils.js';

const PREFIX = { bonds: 'bond_x', items: 'item_x', bands: 'band_x', effects: 'effect_x', garrisons: 'garrison_x', tokens: 'token_x', traits: 'garrison_x' };
const KEY = { bonds: 'bondId', items: 'id', bands: 'bandId', effects: 'effectId', garrisons: 'garrisonId', tokens: 'tokenId', traits: 'garrisonId' };

/** References are exact ids (including comma-separated blackboard lists), never substrings in descriptions. */
export function rewriteForgeIds(value, ids, field = '') {
  if (typeof value === 'string') {
    if (['file', 'name', 'desc', 'descRaw', 'effectDesc', 'effectDescRaw', 'note', 'flavor', 'key', 'effectKey', 'effectType'].includes(field)) return value;
    return ids.get(value) ?? (value.includes(',') ? value.split(',').map(id => ids.get(id.trim()) ?? id).join(',') : value);
  }
  if (Array.isArray(value)) return value.map(v => rewriteForgeIds(v, ids, field));
  if (object(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [field === 'variants' ? ids.get(k) ?? k : k, rewriteForgeIds(v, ids, k)]));
  return value;
}

/** Predeclare supported records before chess references are filtered. Unknown behavior is explicitly reported. */
export function planForgeRecords({ read, table, allocate, skip, assume = () => {} }) {
  const records = [], ids = new Map(), handled = new Set(), additions = new Map();
  const maps = Object.fromEntries(Object.keys(PREFIX).map(file => [file, read(file) ?? {}]));
  const knownBuffs = new Set(Object.values(table('effects') ?? {}).flatMap(e => (e.buffs ?? []).map(b => b.key)));
  const knownGarrisons = new Set(Object.values(table('garrisons') ?? {}).map(g => g.effectKey));
  const itemBuffs = new Set(Object.values(table('items') ?? {}).flatMap(e => (e.buffs ?? []).map(b => `${b.key}:${b.bbStr?.key ?? ''}`)));
  const reject = (file, id, field, reason) => skip(`${file}:${id}#${field}`, reason, reason, undefined,
    ({ garrisons: 'traits', traits: 'traits', bonds: 'bonds', bands: 'bands', items: 'items', tokens: 'tokens' })[file]);
  for (const [file, map] of Object.entries(maps)) for (const [id, raw] of Object.entries(map)) {
    if (table(file)?.[id]) continue;
    handled.add(`${file}:${id}`);
    if (!object(raw)) { reject(file, id, 'record', 'Record must be an object.'); continue; }
    const r = clone(raw), target = file === 'traits' ? 'garrisons' : file;
    const base = r.base ?? r.effectRef;
    // The generic grant handler dispatches by eventType, so both acquisition and sale retain their original timing.
    if (target === 'garrisons' && ['custom_grant_item_on_acquire', 'custom_grant_item_on_sell'].includes(r.effectKey)
      && ['SERVER_GAIN', 'SERVER_CHESS_SOLD'].includes(r.eventType) && Number.isInteger(r.bb?.count) && r.bb.count >= 1 && r.bb.count <= 10
      && typeof r.bbStr?.item === 'string') {
      r.effectKey = 'SERVER_GAIN_EQUIP'; r.effectType = 'SERVER_GAIN_EQUIP';
      r.bbStr = { ...r.bbStr, chess: r.bbStr.item };
      delete r.bbStr.item;
    }
    if (target === 'garrisons' && !knownGarrisons.has(r.effectKey ?? table(target)?.[base]?.effectKey)) {
      reject(file, id, 'effectKey', `No faithful mapping for ${r.effectKey ?? '(missing effectKey)'}; requires a DSL talent or sandbox script kit.`); continue;
    }
    if (file === 'bands' && (!base || !table('bands')?.[base])) {
      reject(file, id, 'base/effectRef', `Band requires an official behavior base; unsupported buffs: ${(r.buffs ?? []).map(b => b.key).join(', ')}.`); continue;
    }
    if (file === 'items' && !base && (!Array.isArray(r.buffs) || !r.buffs.length || r.buffs.some(b => !itemBuffs.has(`${b.key}:${b.bbStr?.key ?? ''}`)))) {
      reject(file, id, 'buffs', `Unsupported item buffs: ${(r.buffs ?? []).filter(b => !itemBuffs.has(`${b.key}:${b.bbStr?.key ?? ''}`)).map(b => `${b.key}/${b.bbStr?.key ?? ''}`).join(', ') || '(missing buffs)'}; needs an official effectRef.`); continue;
    }
    if (file === 'effects' && (r.buffs ?? []).some(b => !knownBuffs.has(b.key))) {
      reject(file, id, 'buffs', `Unsupported effect keys: ${r.buffs.filter(b => !knownBuffs.has(b.key)).map(b => b.key).join(', ')}.`); continue;
    }
    if (file === 'tokens' && (!object(r.stats) || !Array.isArray(r.rangeGrid))) {
      reject(file, id, 'stats/rangeGrid', 'Complete token stats and rangeGrid required.'); continue;
    }
    if (file === 'bonds') {
      if (!Array.isArray(r.thresholds) || !r.thresholds.length) { reject(file, id, 'thresholds', 'Bond thresholds are required.'); continue; }
      // Metadata stays visible; arbitrary engine-specific behavior cannot be inferred from its prose. [ASSUMED]
      if (r.buffs?.length || r.bb && Object.keys(r.bb).length) {
        skip(`bonds:${id}#behavior`, 'Bond metadata imported; custom behavior requires DSL or a script kit.',
          `Bond metadata imported; unmapped behavior fields: buffs (${(r.buffs ?? []).map(b => b.bbStr?.key ?? b.key).join(', ')}), bb (${Object.keys(r.bb ?? {}).join(', ')}). Supply DSL or a script kit.`);
      }
      delete r.buffs;
      r.members = []; r.visibleMembers = [];
      // A bond without a supplied effect receives an empty descriptive effect, never a guessed mechanic.
      r.effectId = allocate('effect_x', `bond_${id}`);
      records.push({ file: 'effects', id: r.effectId, value: { effectId: r.effectId, name: r.name, desc: r.desc ?? '', buffs: [], params: {} } });
      r.desc ??= ''; r.countMode ??= 'BOARD';
    }
    const mapped = allocate(PREFIX[file], id);
    ids.set(id, mapped);
    r[KEY[file]] = mapped;
    delete r.base;
    if (file === 'items' && !table('effects')?.[r.effectId] && !maps.effects[r.effectId]) {
      // [ASSUMED] The complete item's existing buff records are the only source for its missing effect.
      assume('item-effect', '缺少的物品效果由该物品已有的受支持 buff 构成。', 'Missing item effects are built only from the item’s supported buffs.'); // i18n-ignore: importer report, not player interface
      const eid = allocate('effect_x', `item_${id}`);
      r.effectId = eid;
      records.push({ file: 'effects', id: eid, value: { effectId: eid, name: r.name, desc: r.desc ?? '', buffs: r.buffs, params: r.params ?? {} } });
    }
    if (file === 'tokens') {
      // Summon selection comes from a kit; a complete record alone does not summon itself.
      skip(`tokens:${id}#behavior`, 'Token data imported; spawning and custom behavior require a kit.', 'Token data imported; spawning and custom behavior require a kit.');
    }
    records.push({ file: target, id: mapped, ...(base ? { base } : {}), value: r });
    if (!additions.has(target)) additions.set(target, {});
    additions.get(target)[id] = r;
  }
  return { records, ids, handled, additions };
}

/** Rename exact id literals in carried scripts using AST offsets, never regex or execution. */
export function rewriteForgeKit(source, ids, parse) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' }), edits = [], stack = [ast];
  // [ASSUMED] This pure predicate has the same loadout contract as our tier2 helper; inline it in the sandbox.
  for (const n of ast.body) if (n.type === 'ImportDeclaration' && n.source.value === '@kit/tier2.js'
    && n.specifiers.length && n.specifiers.every(s => s.type === 'ImportSpecifier' && s.imported.name === 'onDefaultSkill')) {
    edits.push([n.start, n.end, n.specifiers.map(s => `const ${s.local.name} = chess => {
      const d = (chess?.skills ?? []).find(s => s && s.isDefault);
      return !d || !chess?.skill || d.skillId === chess.skill.skillId;
    };`).join('\n')]);
  }
  while (stack.length) { // loop-cap: finite AST nodes, bounded by the importer's source-byte cap
    const n = stack.pop();
    if (!n || typeof n !== 'object') continue;
    if (n.type === 'Literal' && typeof n.value === 'string' && ids.has(n.value)) edits.push([n.start, n.end, JSON.stringify(ids.get(n.value))]);
    for (const v of Object.values(n)) if (Array.isArray(v)) stack.push(...v); else if (v && typeof v === 'object') stack.push(v);
  }
  for (const [a, b, text] of edits.sort((a, b) => b[0] - a[0])) source = source.slice(0, a) + text + source.slice(b);
  return source;
}
