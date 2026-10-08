// ui/gameLogic/settings.js — settings defaults and sanitising. Re-exported from ../gameLogic.js.

import { clamp, isObj } from './shared.js';
import { DEFAULT_HOTKEYS, sanitizeHotkeys } from './shortcuts.js';


// ---- settings ------------------------------------------------------------------------------------------------------

/**
 * keys: the in-match shortcuts' key map (ui/gameLogic/shortcuts.js; settings → 快捷键).
 * bgm 1 / sfx 0.75 / quality medium are the local defaults carried over from the v0.1.4 tree (the owner's mix and the
 * quality that keeps the 3D board smooth); a profile that already saved the old values is moved by SETTINGS_MIGRATIONS.
 */
export const DEFAULT_SETTINGS = Object.freeze({ bgm: 1, sfx: 0.75, voice: 0.8, muted: false, damageNumbers: true, quality: 'medium', keys: DEFAULT_HOTKEYS });
const QUALITIES = ['high', 'medium', 'low'];

/**
 * The defaults above are only read when nothing is stored, so a browser that already saved `sp.pref.settings` would
 * keep the OLD values forever. The version stamp makes one defaults change actually reach an existing profile: with
 * no `v` in the stored record it is treated as v1 and the migrations below run once, then the record is saved again
 * carrying `SETTINGS_VERSION`. Bump SETTINGS_VERSION and add a row whenever DEFAULT_SETTINGS changes.
 */
export const SETTINGS_VERSION = 2;

/**
 * v1 → v2 (the pre-0.2.0-local defaults: music 60→100 %, effects 80→75 %, quality high→medium). Each value is
 * rewritten ONLY while it still equals the old default: a player who deliberately picked 60 % music or high quality
 * keeps their choice, while one who never touched those rows gets the new defaults. `voice` and `keys` are untouched —
 * voice is 0.8 in both, and the key map has its own sanitiser (ui/gameLogic/shortcuts.js).
 * @param {{ bgm: any, sfx: any, quality: any }} cur already clamped values
 */
const SETTINGS_MIGRATIONS = {
  2: (cur) => ({
    bgm: cur.bgm === 0.6 ? DEFAULT_SETTINGS.bgm : cur.bgm,
    sfx: cur.sfx === 0.8 ? DEFAULT_SETTINGS.sfx : cur.sfx,
    quality: cur.quality === 'high' ? DEFAULT_SETTINGS.quality : cur.quality,
  }),
};

/**
 * Sanitize persisted settings and migrate an unversioned record to the current defaults.
 * @param {any} raw
 * @returns {{ bgm: number, sfx: number, voice: number, muted: boolean, damageNumbers: boolean, quality: 'high'|'medium'|'low',
 *   keys: Record<'refresh'|'freeze'|'levelUp'|'retreat'|'sell'|'ready', string>, v: number }}
 */
export function sanitizeSettings(raw) {
  const r = isObj(raw) ? raw : {};
  const vol = (v, d) => (Number.isFinite(v) ? clamp(Math.round(v * 100) / 100, 0, 1) : d);
  const cur = {
    bgm: vol(r.bgm, DEFAULT_SETTINGS.bgm),
    sfx: vol(r.sfx, DEFAULT_SETTINGS.sfx),
    voice: vol(r.voice, DEFAULT_SETTINGS.voice),
    muted: typeof r.muted === 'boolean' ? r.muted : DEFAULT_SETTINGS.muted,
    damageNumbers: typeof r.damageNumbers === 'boolean' ? r.damageNumbers : DEFAULT_SETTINGS.damageNumbers,
    quality: QUALITIES.includes(r.quality) ? r.quality : DEFAULT_SETTINGS.quality,
    keys: sanitizeHotkeys(r.keys),
  };
  // A record without `v` predates the stamp: treat it as v1 so the migration for the current version runs.
  const from = Number.isInteger(r.v) && r.v > 0 ? r.v : 1;
  for (let v = from + 1; v <= SETTINGS_VERSION; v++) {
    const step = SETTINGS_MIGRATIONS[v];
    if (step) Object.assign(cur, step(cur));
  }
  return { ...cur, v: SETTINGS_VERSION };
}
