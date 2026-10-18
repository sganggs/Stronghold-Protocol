// Reopen the actual documents: the sidecar only supplies controls with no stored field.
import { gameplayDefaults, bondId } from '../../public/studio/js/gameplayModel.js';

export function readAuthorOptions(id, author, documents, manifest, data) {
  const { template } = author, o = { ...gameplayDefaults(template, id), ...author.options };
  const doc = rel => documents[rel] === undefined ? null : JSON.parse(documents[rel].toString());
  const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
  if (template === 'rules') o.rules = manifest.rules || {};
  if (template === 'bond') {
    Object.assign(o, pick(doc('data/bond.json')?.entries?.find(r => r.id === bondId(id))?.value,
      ['name', 'desc', 'thresholds', 'countMode', 'isCore']));
    const members = doc('data/members.json')?.ops?.filter(r => r.file === 'chess' && r.path?.[0] === 'bonds' && r.value?.includes(bondId(id)));
    if (members) o.members = [...new Set(members.map(r => data.chess[r.id]?.charId).filter(Boolean))];
    const unguard = rules => (rules || []).map(r => {
      const copy = structuredClone(r);
      if (copy.if?.bondActive?.id === bondId(id)) { o.effectTier = copy.if.bondActive.tier; delete copy.if.bondActive; }
      if (copy.if && !Object.keys(copy.if).length) delete copy.if;
      return copy;
    });
    o.prep = manifest.dsl?.includes('dsl/bond.json') ? unguard(doc('dsl/bond.json')?.meta?.on) : [];
    o.talents = manifest.operators?.includes('data/talents.json')
      ? unguard(doc('data/talents.json')?.find(r => r.charId === o.members[0])?.trait?.dsl?.talents) : [];
  }
  if (template === 'item') {
    const itemDoc = doc('data/item.json');
    const entries = itemDoc?.entries || itemDoc?.ops?.filter(r => r.op === 'add') || [];
    const normal = entries.find(r => r.id === `item_x_${id.replaceAll('-', '_')}_a`);
    if (normal) {
      const value = normal.value || normal.set;
      o.base = normal.base || value.effectRef || doc('data/identity.json')?.ops?.find(r => r.id === normal.id)?.value?.effectRef || o.base;
      Object.assign(o, pick(value, ['name', 'hideInShop', 'shopExcluded', 'shopSortId']));
      o.paired = entries.some(r => r.id === `item_x_${id.replaceAll('-', '_')}_b`);
      for (const [i, which] of ['normal', 'elite'].entries()) {
        const r = entries.find(r => r.id === `item_x_${id.replaceAll('-', '_')}_${i ? 'b' : 'a'}`);
        if (r) o[which] = pick(r.value || r.set, ['price', 'tier', 'desc', 'buffs']);
      }
    }
  }
  if (template === 'trait') {
    const r = doc('data/trait.json');
    if (r) Object.assign(o, { charId: r.charId, desc: r.trait?.text?.zh || '', translations: r.trait?.translations || {},
      spec: r.trait?.dsl, override: r.overrides?.includes(`trait:${r.charId}`) || false });
  }
  if (template === 'offers') {
    o.window = doc('offers/window.json') || o.window;
    o.cards = doc('offers/cards.json') || o.cards;
  }
  return o;
}

// Presentation forms expose the current declarations, including externally edited values.
export function readPresentationOptions(id, author, documents, manifest, data) {
  const o = { ...author.options };
  if (author.template === 'theme') o.vars = manifest.theme?.vars || {};
  if (author.template === 'notices') o.notices = manifest.notices || [];
  if (author.template === 'skins') {
    const charId = (author.target || 'operator:char_102_texas').replace(/^operator:/, '');
    o.outfits = Object.entries(manifest.assets?.chars?.[charId]?.skins || {}).map(([key, rec]) => ({ key, ...rec }));
  }
  if (author.template === 'fx') {
    const doc = JSON.parse(documents['data/operator.json']?.toString() || '{}');
    const record = Array.isArray(doc) ? doc.find(r => r.charId === `char_x_${id.replaceAll('-', '_')}_one`) : doc;
    o.kitRef = data?.chess?.[record?.kit?.ref]?.charId || record?.kit?.ref || o.kitRef;
    o.source = record?.fx ? 'official' : 'flipbook';
    o.unit = record?.fx?.unit || '';
    o.skills = record?.fx?.skills || {};
    o.flipbooks = Object.entries(manifest.assets?.fx?.flipbooks || {}).map(([id, book]) => ({ id, ...book }));
    o.bindings = Object.entries(manifest.assets?.fx?.bind?.[record?.charId] || {}).flatMap(([slot, phases]) =>
      Object.entries(phases).map(([phase, effect]) => ({ slot, phase, effect })));
  }
  return o;
}
