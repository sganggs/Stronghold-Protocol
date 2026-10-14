// Compat module (stronghold-ui package) — install ONLY when the target has no public/js/ui/cloudStats.js.
// The original deployment keeps a logged-in player's match records in its accounts service (the same list on every
// device). Here the account is local (ui/accounts.js of this package), so "the account's records" ARE this browser's:
// the game's own list in localStorage (ui/stats.js, `sp.pref.stats`). Nothing is uploaded. 点赞 / 好友 need a shared
// service: accountApi refuses, and the settlement greys those buttons out. Replace this file together with
// accounts.js when a real account system is connected (AGENTS.md §3.2).
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { loadStats } from './stats.js';

const listeners = new Set();
const NO_SERVICE = '本服未接入账号服务（成就与战绩只保存在这台设备的浏览器里）';

/** No accounts service here. */
export async function accountApi() { throw new Error(NO_SERVICE); }

/** { records (newest first), source, ready, failed, likes } — the local account's list = this browser's records. */
export function currentRecords() {
  const records = [...loadStats().records].sort((a, b) => (b?.t || 0) - (a?.t || 0));
  return { records, source: 'account', local: true, ready: true, failed: false, likes: null };
}
export function syncRecords() { for (const fn of listeners) fn(); return Promise.resolve(); }
/** Nothing is uploaded: a record is never "on the account service". */
export async function ensureUploaded() { return false; }
export async function uploadRecords() { return 0; }
export const importDeviceRecords = () => uploadRecords();
export async function clearAccountRecords() {}
export async function loadFriendRecords() { throw new Error(NO_SERVICE); }

/** Preact: the records, re-read when another tab writes them and when a match is recorded here. */
export function useRecords() {
  const [cur, setCur] = useState(currentRecords);
  useEffect(() => {
    const fn = () => setCur(currentRecords());
    listeners.add(fn);
    const onStorage = (e) => { if (!e.key || e.key.startsWith('sp.pref.stats')) fn(); };
    addEventListener('storage', onStorage);
    const id = setInterval(() => { if (!document.hidden) fn(); }, 15000);
    return () => { listeners.delete(fn); removeEventListener('storage', onStorage); clearInterval(id); };
  }, []);
  return cur;
}
export function startCloudStats() {}
