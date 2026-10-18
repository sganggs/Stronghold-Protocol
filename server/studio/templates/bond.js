import { jsonText, templateFile } from '../gameData.js';
import { bondId, gameplayDefaults } from '../../../public/studio/js/gameplayModel.js';
import { StudioError } from '../files.js';

export default {
  id: 'bond', class: 'content', kinds: [], overlay: () => ({}),
  slots: target => target ? [{ at: ['bonds', target.key], kind: 'image', field: 'icon', dir: `assets/${target.key}`, base: 'icon' }] : [],
  build({ id, options, data }) {
    const o = { ...gameplayDefaults('bond', id), ...options }, bid = bondId(id);
    // [ASSUMED] Authoring lists hold 1..64 distinct members, bounded independently of battle population.
    if (!Array.isArray(o.members) || !o.members.length || o.members.length > 64 || new Set(o.members).size !== o.members.length)
      throw new StudioError('PLUGIN_RECORD_TYPE', 400, { where: 'members', detail: '1..64 distinct operators required' });
    if (!Number.isInteger(o.effectTier) || o.effectTier < 1 || o.effectTier > o.thresholds.length)
      throw new StudioError('PLUGIN_RECORD_TYPE', 400, { where: 'effectTier', detail: 'effect tier must exist in thresholds' });
    const ops = [];
    for (const charId of o.members) {
      const members = Object.values(data.chess).filter(c => c.charId === charId && !c.isDiy);
      if (!members.length) throw new StudioError('PLUGIN_DATA_REFERENCE', 400, { where: 'members', detail: charId });
      for (const c of members) ops.push({ op: 'append', file: 'chess', id: c.chessId, path: ['bonds'], value: [bid] });
    }
    // [ASSUMED] One selected threshold guards all authored effects. Member traits preserve official kits/garrisons.
    const guard = rules => rules.map(r => ({ ...r, if: { ...r.if, bondActive: { id: bid, tier: o.effectTier } } }));
    const files = {
      'assets/studio-bond.png': templateFile('cosmetic', 'media/sample.png', null),
      'data/bond.json': jsonText({ records: 1, entries: [{ file: 'bonds', id: bid, value: {
        name: o.name, desc: o.desc, thresholds: o.thresholds, countMode: o.countMode, isCore: o.isCore } }] }),
      'data/members.json': jsonText({ patch: 1, ops }),
      'data/talents.json': jsonText(o.members.map(charId => ({ op: 1, charId, trait: { desc: o.desc,
        dsl: { dsl: 1, talents: guard(o.talents) } } }))),
      'dsl/bond.json': jsonText({ dsl: 1, pluginId: id, meta: { key: `effect:${id}:bond`, on: guard(o.prep) } }),
    };
    if (!o.prep.length) delete files['dsl/bond.json'];
    if (!o.talents.length) delete files['data/talents.json'];
    return { manifest: { scope: ['room'], permissions: ['data.add', 'data.patch', ...(o.prep.length || o.talents.length ? ['dsl'] : []), 'assets.add'],
      assets: { bonds: { [bid]: 'assets/studio-bond.png' } }, data: ['data/bond.json', 'data/members.json'],
      ...(o.talents.length ? { operators: ['data/talents.json'] } : {}), ...(o.prep.length ? { dsl: ['dsl/bond.json'] } : {}) }, files };
  },
};
