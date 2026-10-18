import fs from 'node:fs';
import { checkedPresentation } from './theme.js';
import { fxOverlay } from '../../../public/studio/js/presentation.js';
import { operatorRecord } from './operator.js';
import { officialEffects } from '../presentationData.js';
import { StudioError } from '../files.js';
import { officialOperator, jsonText } from '../gameData.js';

export default {
  id: 'fx', class: 'content', kinds: ['operator'], slots: () => [], overlay: () => ({}),
  build(args) {
    const { id, options, publicDir } = args;
    const source = officialOperator(args.data, options.kitRef || args.target?.key || 'char_102_texas');
    // The previous generator is only a delta baseline, so old drafts can switch away from unsupported sources.
    // [ASSUMED] Refuse carriers whose summons cannot be represented by the compact operator format.
    if (!args.previous && [source.normal, source.elite].some(r => r.tokens?.length || r.displayTokens?.length || r.skills?.some(s => s.overrideTokenKey)))
      throw new StudioError('PLUGIN_RECORD_TYPE', 400, { where: 'kitRef', detail: 'This carrier needs owner-specific summon records. Choose an operator without summons.' });
    if (!args.previous && ['projectile', 'canHitFly', 'targetPriority'].some(key => (source.normal[key] ?? null) !== (source.elite[key] ?? null)))
      throw new StudioError('PLUGIN_RECORD_TYPE', 400, { where: 'kitRef', detail: 'This carrier changes attack metadata between forms, which the compact format cannot preserve. Choose another operator.' });
    const o = checkedPresentation('fx', id, args.target, { kitRef: args.target?.key || 'char_102_texas', bindings: [{ slot: String(source.normal.skill?.index ?? 0), phase: 'attack', effect: 'flash' }], ...options });
    // [ASSUMED] A borrowed official kit is the immediately playable carrier for this presentation template.
    const record = operatorRecord({ ...args, options: { kitRef: o.kitRef } });
    for (const which of ['normal', 'elite']) for (const key of ['dmgType', 'attackKind', 'placeOnRanged'])
      if (source[which][key] !== undefined) record.forms[which][key] = source[which][key];
    for (const key of ['projectile', 'canHitFly', 'targetPriority']) if (source.normal[key] != null) record[key] = source.normal[key];
    const manifest = { scope: ['room'], permissions: ['data.add'], operators: ['data/operator.json'] };
    const files = {};
    if (o.source === 'official') {
      const unit = officialEffects(publicDir).find(u => u.key === o.unit);
      if (!unit || Object.values(o.skills).some(s => !unit.skills.includes(s))) throw new StudioError('PLUGIN_RECORD_TYPE', 400, { where: 'fx', detail: 'Choose a unit and skills present in the local effects index' });
      record.fx = { unit: o.unit, skills: o.skills };
    } else {
      manifest.permissions.push('assets.add');
      manifest.assets = fxOverlay(id, o);
      // Original CC0 checkerboard, not game art. Existing uploaded paths are never overwritten on save.
      if (options.flipbooks === undefined) files['fx/flash.png'] = fs.readFileSync(new URL('../../../plugins/_template/cosmetic/media/sample.png', import.meta.url));
    }
    files['data/operator.json'] = jsonText(record);
    return { manifest, files, options: o };
  },
};
