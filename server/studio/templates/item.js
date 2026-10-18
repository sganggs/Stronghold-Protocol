import { clone, jsonText, localId, itemParams } from '../gameData.js';
import { gameplayDefaults } from '../../../public/studio/js/gameplayModel.js';
import { StudioError } from '../files.js';

export default {
  id: 'item', class: 'content', kinds: ['item'], slots: () => [], overlay: () => ({}),
  build({ id, options, target, data }) {
    const picked = target && Object.values(data.items).find(r => !r.isGolden && (r.iconId === target.key || r.id === target.key));
    const o = { ...gameplayDefaults('item', id), ...(picked ? { base: picked.id } : {}), ...options };
    const base = data.items[o.base];
    if (!base || base.effectRef || base.isGolden) throw new StudioError('PLUGIN_EFFECT_REF', 400, { where: 'base', detail: 'official normal item required' });
    const paired = !!(o.paired && base.goldenId && data.items[base.goldenId]);
    const normal = `item_x_${localId(id)}_a`, elite = `item_x_${localId(id)}_b`;
    const entries = (paired ? ['normal', 'elite'] : ['normal']).map(which => {
      const src = which === 'elite' ? data.items[base.goldenId] : base;
      if (!src) throw new StudioError('PLUGIN_DATA_REFERENCE', 400, { where: 'elite', detail: 'official pair required' });
      const value = { ...clone(src), ...o[which], name: o.name, desc: o[which]?.desc ?? src.desc,
        hideInShop: o.hideInShop, shopExcluded: o.shopExcluded, shopSortId: o.shopSortId,
        baseId: normal, goldenId: which === 'normal' && paired ? elite : null, isGolden: which === 'elite',
        mergeable: which === 'normal' && paired, upgradeNum: which === 'normal' && paired ? base.upgradeNum : 0,
        upgradeChessId: which === 'normal' && paired ? elite : null };
      // Complete records keep the supported buff handler and effect identity, plus the authored pair.
      delete value.effectRef;
      // DATA.md / build-data effectParams: first buff wins; strings override numbers within one buff.
      value.params = itemParams(value.buffs || []);
      return { file: 'items', id: which === 'normal' ? normal : elite, value };
    });
    // Complete pairs must expand before adding effectRef: compact inheritance deliberately makes a single item.
    // Retain the official identity for prep handlers and equipment combinations, using a patch only on our new ids.
    if (entries.some(r => r.value.itemType === 'MAGIC' || !r.value.buffs?.length)) {
      // Existing add patches admit complete inherited records, including buff-less morph pairs.
      // Compact item records normalize away pairing; do not route these pairs through that normalizer.
      const ops = entries.map((r, i) => ({ op: 'add', file: 'items', id: r.id,
        value: { ...r.value, id: r.id, effectRef: i ? base.goldenId : base.id } }));
      return { manifest: { scope: ['room'], permissions: ['data.add', 'data.patch'], data: ['data/item.json'] },
        files: { 'data/item.json': jsonText({ patch: 1, ops }) } };
    }
    const ops = entries.map((r, i) => ({ op: 'merge', file: 'items', id: r.id, path: [],
      value: { effectRef: i ? base.goldenId : base.id } }));
    return { manifest: { scope: ['room'], permissions: ['data.add', 'data.patch'], data: ['data/item.json', 'data/identity.json'] },
      files: { 'data/item.json': jsonText({ records: 1, entries }), 'data/identity.json': jsonText({ patch: 1, ops }) } };
  },
};
