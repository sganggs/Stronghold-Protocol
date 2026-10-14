// Compat shim (stronghold-ui package) — install ONLY when the target has no public/js/ui/friends.js.
// 好友 (friend list, presence, invitations) needs a shared accounts service — it cannot live in one browser. Without it:
// the hub shows no 好友 tile, the room no 邀请好友 button (room.js reads `openFriends.unavailable`), and the settlement's
// 加好友 stays greyed out (requestFriend refuses). The names below are the ones other screens import; a real module
// replaces this file (AGENTS.md §3.2).
import { html } from './components.js';
import { createStore } from '../store.js';

export const friendsStore = createStore({ data: null, open: false, tab: 'list', seen: [], viewing: null });
export const THUMB = 'M2 10h4v11H2zm6 11V10l5-8 1.2.6c.9.5 1.3 1.5 1.1 2.5L14.6 9H20a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21z';
export const ADD_FRIEND = 'M9 4a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM2 20c0-3.5 3.1-6 7-6s7 2.5 7 6v1H2zM19 7h2v3h3v2h-3v3h-2v-3h-3v-2h3z';
export const Glyph = ({ d, cls }) => html`<svg class=${['fglyph', cls].filter(Boolean).join(' ')} viewBox="0 0 24 24" aria-hidden="true"><path d=${d} /></svg>`;

export function FriendsTile() { return null; }
export function FriendsHost() { return null; }
export function openFriends() {}
openFriends.unavailable = true;
export const closeFriends = () => {};
export async function refreshFriends() { return null; }
export async function requestFriend() { throw new Error('本服未接入好友服务'); }
export function pendingCount() { return 0; }
export function startFriends() {}
