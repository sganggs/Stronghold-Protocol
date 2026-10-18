import { gameplayDefaults } from '../../../public/studio/js/gameplayModel.js';
import { StudioError } from '../files.js';

export default {
  id: 'rules', class: 'content', kinds: [], slots: () => [], overlay: () => ({}),
  build({ id, options }) {
    const rules = options.rules ?? gameplayDefaults('rules', id).rules;
    // [ASSUMED] A rules-only wizard needs at least one declaration to make a useful strict-checkable plugin.
    if (!Object.keys(rules).length) throw new StudioError('PLUGIN_EMPTY', 400, { where: 'rules', detail: 'declare at least one switch' });
    return { manifest: { scope: ['room'], permissions: [], rules }, files: {} };
  },
};
