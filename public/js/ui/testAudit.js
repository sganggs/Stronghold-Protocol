// Host-dock formatting for a test-command audit row (DESIGN §34.8). Plain ESM, no DOM.
import { t } from '../../../shared/i18n.js';
import { ERR_TEXT } from '../../../shared/constants.js';

/** Scheduler milliseconds as HH:MM:SS. A bad value is 00:00:00. */
export function matchClock(ms) {
  const n = Number(ms);
  const s = Number.isFinite(n) && n > 0 ? Math.floor(n / 1000) : 0;
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

/** Newest row first. The input array is not mutated. */
export function newestFirst(log) {
  return Array.isArray(log) ? log.slice().reverse() : [];
}

/**
 * Player-facing reason carried in a test refusal's `detail`.
 * `shop|{chess,item}` and `round|{hi}` include the numbers the server checked.
 * @param {unknown} detail
 * @returns {string}
 */
export function explainTestDetail(detail) {
  if (typeof detail !== 'string' || !detail) return '';
  const bar = detail.indexOf('|');
  const kind = bar < 0 ? detail : detail.slice(0, bar);
  let params = {};
  if (bar >= 0) {
    try { params = JSON.parse(detail.slice(bar + 1)); } catch { params = {}; }
  }
  if (!params || typeof params !== 'object') params = {};
  switch (kind) {
    case 'shop': return t('这一级商店要 {chess} 个干员和 {item} 个装备', params);
    case 'round': return t('回合只能是 1 到 {hi}', params);
    case 'layers': return t('层数不能减少');
    case 'timers': return t('作战进行中不能开关计时');
    case 'bond': return t('这个盟约不能在本模式使用');
    default: return '';
  }
}

/**
 * Toast text for a refused test command. A known detail is the reason itself. Otherwise the message of the
 * error code (ERR_TEXT), then the error's own message. 无效的目标 is only the fallback for a real bad target
 * or a refusal that carries neither.
 * @param {any} err
 * @returns {string}
 */
export function testRefusalText(err) {
  const why = explainTestDetail(err?.detail);
  if (why) return why;
  if (err && typeof err === 'object' && err.code && Object.hasOwn(ERR_TEXT, err.code)) return t(ERR_TEXT[err.code]);
  if (typeof err?.message === 'string' && err.message) return t(err.message);
  return t('无效的目标');
}

/** One audit line: one number, the actor's name, a clock, the command, the translated result. */
export function formatAuditLine(entry, name) {
  const e = entry || {};
  const who = name || e.playerId || '';
  const result = e.ok ? t('成功') : (explainTestDetail(e.detail) || (e.code && Object.hasOwn(ERR_TEXT, e.code) ? t(ERR_TEXT[e.code]) : (e.code || '')));
  return `${e.seq} ${who} ${matchClock(e.at)} ${e.cmd} ${result}`;
}
