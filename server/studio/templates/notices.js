import { checkedPresentation } from './theme.js';
export default {
  id: 'notices', class: 'cosmetic', kinds: [], slots: () => [], overlay: () => ({}),
  build({ id, options }) {
    const o = checkedPresentation('notices', id, null, options);
    return { manifest: { scope: ['personal'], notices: o.notices }, files: {} };
  },
};
