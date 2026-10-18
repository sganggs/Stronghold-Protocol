// Labels for the studio console. Pure helpers so a test can check them without the page.
import { t } from '../../../../shared/i18n.js';
import { isDiyModule } from '../../../../shared/diy.js';

/** "(row,col)". An array's default join is "11,5", which reads as 115. */
export function devicePos(pos) {
  if (Array.isArray(pos) && pos.length >= 2) return `(${pos[0]},${pos[1]})`;
  return '()';
}

/**
 * Module options for a form. A locked 自选 prototype keeps its fixed module even when isDiyModule would drop it
 * (ISW / SO / RA). A fixed id missing from the form is still listed so the control is not blank.
 * `lockedName` is that module's display name (backups `moduleNames` / a form module). Without one, the id is the name.
 * @param {any[]|null|undefined} modules
 * @param {boolean} diy
 * @param {string|null|undefined} lockedId
 * @param {string|null|undefined} [lockedName]
 */
export function moduleOptions(modules, diy, lockedId, lockedName) {
  const list = Array.isArray(modules) ? modules : [];
  const fixed = typeof lockedId === 'string' && lockedId && lockedId !== 'none' ? lockedId : '';
  const out = list.filter((m) => m && (!diy || isDiyModule(m) || (fixed && m.uniEquipId === fixed)));
  if (diy && fixed && !out.some((m) => m.uniEquipId === fixed)) {
    const name = typeof lockedName === 'string' && lockedName && lockedName !== fixed ? lockedName : fixed;
    out.push({ uniEquipId: fixed, name });
  }
  return out;
}

/**
 * Display name of a locked module. The DIY picker reads the same backups record (moduleNames, else any form's
 * modules[]). An overlay-applied backups file already carries the locale's name. Empty when the id is unknown.
 * @param {any} backups
 * @param {string|null|undefined} charId
 * @param {string|null|undefined} uniEquipId
 * @returns {string}
 */
export function lockedModuleLabel(backups, charId, uniEquipId) {
  if (typeof uniEquipId !== 'string' || !uniEquipId || uniEquipId === 'none') return '';
  const unit = backups?.units?.[charId];
  if (!unit || typeof unit !== 'object') return '';
  const named = unit.moduleNames?.[uniEquipId];
  if (named && typeof named.name === 'string' && named.name) return named.name;
  const forms = unit.forms && typeof unit.forms === 'object' ? unit.forms : {};
  for (const form of Object.values(forms)) {
    const hit = (form?.modules || []).find((m) => m && m.uniEquipId === uniEquipId && typeof m.name === 'string' && m.name);
    if (hit) return hit.name;
  }
  return '';
}

/** A mode record's name as the data overlay left it (lobby difficulty names are the same strings). */
export function modeOptionLabel(mode, id) {
  const name = typeof mode?.name === 'string' && mode.name ? mode.name : (id || '');
  return `${name} · ${id || ''}`;
}

/** `S{n} · name` from a skill record the data overlay already localized. */
export function skillOptionName(skill) {
  const index = Number.isInteger(skill?.index) ? skill.index : 0;
  const name = typeof skill?.name === 'string' ? skill.name : '';
  return `S${index + 1} · ${name}`;
}

/** A module option's name. The raw uniEquipId is not a name. */
export function moduleOptionName(mod) {
  const id = typeof mod?.uniEquipId === 'string' ? mod.uniEquipId : '';
  const name = typeof mod?.name === 'string' && mod.name && mod.name !== id ? mod.name : '';
  return name || id;
}

/** Device checkbox text. `device.name` is the stage record's name after the data overlay. */
export function deviceOptionName(device) {
  const name = typeof device?.name === 'string' && device.name ? device.name : (device?.key || '');
  return `${name} · ${devicePos(device?.pos)} · ${device?.alias || ''}`;
}

/** Stock left after placements of this owner and token. Never negative. */
export function tokenRemaining(slot, units) {
  const count = Number(slot?.count);
  const owner = slot?.ownerUid;
  const id = slot?.tokenId;
  const placed = (Array.isArray(units) ? units : []).filter((u) => u && u.kind === 'token' && u.ownerUid === owner && u.tokenId === id).length;
  const left = (Number.isFinite(count) ? count : 0) - placed;
  return left > 0 ? left : 0;
}

/**
 * One route. Walks that share a path still differ by the #index; that index is the only distinguisher.
 * @param {{ motion?: string, start?: number[], end?: number[], checkpoints?: number[][] }} route
 * @param {number} index
 */
export function routeLabel(route, index) {
  const r = route || {};
  const pair = (p) => (Array.isArray(p) && p.length >= 2 ? `${p[0]},${p[1]}` : '');
  const cps = Array.isArray(r.checkpoints) ? r.checkpoints : [];
  const via = cps.length ? `${t('经由')} ${cps.map((p) => `(${pair(p)})`).join(' ')}` : t('直达');
  return `#${(index | 0) + 1} ${r.motion || ''} (${pair(r.start)}) → (${pair(r.end)}) · ${via}`;
}
