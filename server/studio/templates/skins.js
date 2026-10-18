import { checkedPresentation } from './theme.js';
import { skinsOverlay } from '../../../public/studio/js/presentation.js';

export default {
  id: 'skins', class: 'cosmetic', kinds: ['operator'], slots: () => [], overlay: () => ({}),
  build({ id, target, options }) {
    const o = checkedPresentation('skins', id, target, options);
    // The entry may already exist in this installation, or be supplied by another content plugin.
    return { manifest: { permissions: ['assets.add', 'assets.override'], assets: skinsOverlay(target ? `operator:${target.key}` : '', o.outfits) }, files: {} };
  },
};
