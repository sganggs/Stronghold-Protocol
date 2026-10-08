// ui/routeTransition.js — which transition a route change gets (DESIGN §10).
//
// Routes (store.js selectRoute): title → lobby → room → game (briefing / draft / match / result all
// live inside 'game'). The transition carries the hierarchy:
//   fade    — the title is an independent system: a near-black veil covers the swap (main.js).
//   push    — parent → child inside the app (lobby → room): the new screen slides in from the right
//             while the old one gives way to the left.
//   pop     — child → parent (room → lobby): the mirror image.
//   zoomin  — entering the match (room → game): the new screen grows into place (方舟-style zoom-in).
//   zoomout — leaving the match (game → room): it recedes and the room settles back.

/**
 * @param {string} from @param {string} to
 * @returns {'fade'|'push'|'pop'|'zoomin'|'zoomout'|null} null when nothing changes
 */
export function routeTransition(from, to) {
  if (from === to) return null;
  if (from === 'title' || to === 'title') return 'fade';
  if (to === 'game') return 'zoomin';
  if (from === 'game') return 'zoomout';
  const depth = { lobby: 1, room: 2 };
  return (depth[to] ?? 0) > (depth[from] ?? 0) ? 'push' : 'pop';
}
