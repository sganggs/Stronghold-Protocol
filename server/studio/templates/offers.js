import { jsonText } from '../gameData.js';
import { gameplayDefaults } from '../../../public/studio/js/gameplayModel.js';

export default {
  id: 'offers', class: 'content', kinds: [], slots: () => [], overlay: () => ({}),
  build({ id, options }) {
    const o = { ...gameplayDefaults('offers', id), ...options };
    // [ASSUMED] The form owns one local card pool; authors never have to type a file path.
    return { manifest: { scope: ['room'], permissions: ['offers'], offers: ['offers/window.json'] },
      files: { 'offers/window.json': jsonText({ ...o.window, options: { source: 'offers/cards.json' } }),
        'offers/cards.json': jsonText(o.cards) } };
  },
};
