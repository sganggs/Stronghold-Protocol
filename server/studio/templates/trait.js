import { jsonText } from '../gameData.js';
import { gameplayDefaults } from '../../../public/studio/js/gameplayModel.js';
import { StudioError } from '../files.js';

export default {
  id: 'trait', class: 'content', kinds: ['operator'], slots: () => [], overlay: () => ({}),
  build({ id, options, target, data }) {
    const o = { ...gameplayDefaults('trait', id), ...(target ? { charId: target.key } : {}), ...options };
    // [ASSUMED] This standalone template requires a playable official chess record, so trial works immediately.
    // Backup-only operators need an operator plugin first; a trait declaration alone does not add a chess pair.
    if (!Object.values(data.chess).some(c => c.charId === o.charId && !c.isGolden && !c.isDiy))
      throw new StudioError('PLUGIN_DATA_REFERENCE', 400, { where: 'charId', detail: 'existing playable operator required' });
    return { manifest: { scope: ['room'], permissions: ['data.add', 'data.patch', 'dsl'], operators: ['data/trait.json'] },
      files: { 'data/trait.json': jsonText({ op: 1, charId: o.charId,
        ...(o.override ? { overrides: [`trait:${o.charId}`] } : {}),
        trait: { text: { zh: o.desc }, translations: o.translations, dsl: o.spec } }) } };
  },
};
