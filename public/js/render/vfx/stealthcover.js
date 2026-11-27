// public/js/render/vfx/stealthcover.js — hide the generic 隐匿 icon only while a unit's own
// camouflage effect is actually playing (round 86, lane f5).
//
// 乌啾 S2's 迷彩 is turdus_skill_02_buff_01 on the ally (index buff turdus_s2[try_camouflage]), not the
// common stealth effect. SkillFx covers the ally when that loop starts and uncovers it when the loop
// stops. With 官方特效 off, or the prefab missing, nothing covers and the icon stays.
// A status that is still 隐匿 ('stealth') keeps the icon. Flag-only stealth (grass, smoke) is not covered.

const covers = new WeakMap();

function bucket(view) {
  let rec = covers.get(view);
  if (!rec) { rec = new Map(); covers.set(view, rec); }
  return rec;
}

/** One live official effect of `key` (a status key, 'camou') is playing on `view`. */
export function coverStealth(view, key) {
  if (!view || typeof key !== 'string' || !key) return;
  const rec = bucket(view);
  rec.set(key, (rec.get(key) || 0) + 1);
}

/** That effect stopped. */
export function uncoverStealth(view, key) {
  if (!view || typeof key !== 'string' || !key) return;
  const rec = covers.get(view);
  if (!rec) return;
  const n = (rec.get(key) || 0) - 1;
  if (n <= 0) rec.delete(key);
  else rec.set(key, n);
}

/**
 * The generic 隐匿 icon is hidden: an own effect covers a status this unit still has, and no uncovered
 * 'stealth' status is also on it.
 */
export function stealthIconCovered(view) {
  const rec = view ? covers.get(view) : null;
  if (!rec || rec.size === 0) return false;
  const st = view.statuses;
  const has = (k) => !!st && (typeof st.has === 'function' ? st.has(k) : Array.isArray(st) && st.includes(k));
  if (has('stealth')) return false;
  for (const k of rec.keys()) if (has(k)) return true;
  return false;
}
