// The settlement flow of the match on screen (research 06 §10.6; the official act's settlement): a radar intro, then
// two pages, drawn with the official settlement sprites (assets `settle/*`, `elite/*`, `entry/season_logo_settle`;
// docs/ASSETS.md) — every sprite falls back to text / plain CSS when the resource pack is not there.
//   个人战报 (SelfPage): my own outcome (模拟完成, or 模拟中断 when the team lost or I was out before the end) over the
//     terrain and its target point, the rounds I passed, the leaders I helped defeat, my final lineup (ten slots: tier,
//     elite level and gear of each operator), my bonds and their layers, my plate with the trophies, the level
//     settlement — 获得卫戍认证 +N and 每日防卫目标 (data/config.json rewards) filling the LV bar — then 下一步.
//   同盟 (TeamPage): one card per seat (its ace operator's art, the 评语, the rounds passed, the player plate, the
//     trophies), the team's outcome and rounds, the match time and date, 数据详情 (the full report: screens/result.js
//     ResultView) and 返回同盟 / 返回大厅. A match with gameplay plugins carries the 「非官方」 mark (DESIGN §32.6) and
//     leaves the level alone; the 结算 tab plugin slot (result.tab) sits on this page.
// The LV is counted from this device's match records (ui/stats.js): the 卫戍认证 of each settled official match (its
// settlement row's `reward`) and the 每日防卫目标 bonus of each day that reached it, against the levels of
// config.rewards.milestones. [ASSUMED] the official game keeps the total on the account; this project has no accounts,
// so a device counts what it recorded (cleared browser data starts again at LV 0). A spectator seat (no row of its own)
// opens on the team page. The stats page re-views a stored match with ResultView.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, DifficultyIcon, Spinner } from '../ui/components.js';
import { useGameData, Img, Sprite, PlayerAvatar, BondGlyph, BandIcon } from '../ui/gameComponents.js';
import { normalizeResult, diyRecordFor, cardStandIn, standInForText } from '../ui/gameLogic.js';
import { data } from '../data.js';
import { chessPortraitUrl, chessAvatarUrl, itemIconUrl, enemyIconUrl, titleIconUrl } from '../ui/assetUrls.js';
import { store, useStore, emptyMatch } from '../store.js';
import { audio } from '../audio.js';
import { sentText } from '../ui/lang.js';
import { reducedMotion } from '../ui/device.js';
import { recordId, selfRowOf, loadStats, isModdedRecord } from '../ui/stats.js';
import { UnofficialMark, isModdedRoom } from '../ui/pluginTag.js';
import { TestMark } from '../ui/testConsole.js';
import { ResultView, resultBonds } from './result.js';
import { DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const pad2 = (n) => String(Math.max(0, Math.trunc(n) || 0)).padStart(2, '0');
const int = (v) => Math.max(0, Math.round(Number(v) || 0));
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
/** A stage position (1920×1080 design pixels) as rem (1rem = 100px). */
const at = (x, y) => `left:${x / 100}rem;top:${y / 100}rem`;

/** The radar intro, and the page change after 下一步. */
export const INTRO_MS = 1500;
const LEAVE_MS = 380;

// ---- the level settlement ---------------------------------------------------------------------------------------------

/**
 * LV of a 卫戍认证 total against config.rewards.milestones (cumulative `tokens` per `level`): the levels reached (0 before
 * the first), the progress into the next (`into` of `need`), `max` past the last.
 * @param {number} total @param {{ level: number, tokens: number }[]} milestones
 */
export function levelOf(total, milestones) {
  const n = int(total);
  let lv = 0;
  let prev = 0;
  for (const m of Array.isArray(milestones) ? milestones : []) {
    if (!Number.isFinite(m?.tokens)) continue;
    if (n < m.tokens) return { lv, into: n - prev, need: m.tokens - prev, max: false };
    lv = Number.isFinite(m.level) ? m.level : lv + 1;
    prev = m.tokens;
  }
  return { lv, into: 0, need: 0, max: true };
}

/** The 每日防卫目标 day of a time: local, turning over at `resetHour` (04:00). */
export function dayKey(ts, resetHour = 4) {
  const d = new Date(ts - resetHour * 3600000);
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
}

/**
 * The 每日防卫目标 points of a match: the row of the rounds passed in config.rewards.baseByRoundsPassed (its
 * dailyMissionPoint — [ASSUMED] unscaled by difficulty and mode, as the table gives it apart from the scaled reward).
 */
export function dailyPointsFor(roundsPassed, table) {
  const n = Number(roundsPassed) || 0;
  const row = (Array.isArray(table) ? table : []).filter((r) => r && r.round <= n).pop();
  return int(row?.dailyPoint);
}

/**
 * This match's level settlement from the local records (ui/stats.js, any order; the match's own record — `id` — and
 * anything after it left out). An official settled match earns its row's `reward` (server/match/results.js rewardFor);
 * a day whose matches reached the daily goal earned the bonus once ([ASSUMED] the bonus is 卫戍认证 too, so it counts
 * toward the level; the day is the local one). `counted` false (gameplay plugins): this match earns
 * nothing. Returns the totals before and after this match, its gain and bonus, my trophies so far, today's daily goal.
 * @param {any[]} records
 * @param {{ id?: string|null, gain?: number, rounds?: number, trophies?: number, at?: number, counted?: boolean, rewards?: any }} cur
 */
export function levelProgress(records, { id = null, gain = 0, rounds = 0, trophies = 0, at: now = Date.now(), counted = true, rewards = null } = {}) {
  const daily = rewards?.daily && rewards.daily.need > 0 ? rewards.daily : null;
  const table = rewards?.baseByRoundsPassed;
  const reset = Number.isFinite(daily?.resetHour) ? daily.resetHour : 4;
  const days = new Map();
  let total = 0;
  let cups = 0;
  for (const rec of Array.isArray(records) ? records : []) {
    // a quit record had no settlement: nothing earned
    // (a 测试 match never counts: its record is not kept, and an old or imported one marked test is skipped too)
    if (!rec || rec.id === id || !Number.isFinite(rec.t) || rec.t > now || rec.end === 'quit' || rec.test === true || isModdedRecord(rec)) continue;
    const row = selfRowOf(rec);
    total += int(row?.reward);
    cups += int(row?.trophies);
    if (daily) { const k = dayKey(rec.t, reset); days.set(k, (days.get(k) || 0) + dailyPointsFor(row?.roundsPassed, table)); }
  }
  if (daily) for (const pts of days.values()) if (pts >= daily.need) total += int(daily.bonus);
  const today = daily ? days.get(dayKey(now, reset)) || 0 : 0;
  const pts = counted && daily ? dailyPointsFor(rounds, table) : 0;
  const bonus = daily && today < daily.need && today + pts >= daily.need ? int(daily.bonus) : 0;
  const g = counted ? int(gain) : 0;
  return {
    gain: g, bonus, before: total, after: total + g + bonus, trophies: cups + (counted ? int(trophies) : 0), counted,
    daily: daily ? { name: daily.name, need: daily.need, today: Math.min(daily.need, today + pts) } : null,
  };
}

// ---- small facts --------------------------------------------------------------------------------------------------------

// The operator's elite phase and level on the board, by tier, plain / elite (research 01-core-data charPriceByTier):
// tiers I and II field E1 operators (55 / 60) and elite E2 ones (50 / 55); III–VI E2 at 1, elite at 60.
const OP_LEVEL = { 1: [[1, 55], [2, 50]], 2: [[1, 60], [2, 55]] };
/** @returns {{ phase: number, level: number }} */
export function opLevel(tier, golden) {
  const [phase, level] = (OP_LEVEL[tier] || [[2, 1], [2, 60]])[golden ? 1 : 0];
  return { phase, level };
}

/** The ace of a lineup — the team card's art: the highest tier, elite first, the earliest on the board. */
export function aceOf(lineup) {
  let best = null;
  (Array.isArray(lineup) ? lineup : []).forEach((u) => {
    if (!u || u.kind === 'token') return;
    const s = (Number(u.tier) || 0) * 2 + (u.golden ? 1 : 0);
    if (!best || s > best.s) best = { u, s };
  });
  return best ? best.u : null;
}

/** 00时42分24秒 */
export function fmtDuration(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.floor(ms / 1000);
  return t('{h}时{m}分{s}秒', { h: pad2(s / 3600), m: pad2((s % 3600) / 60), s: pad2(s % 60) });
}

/** 2025/12/11 07:51 (local time) */
export function fmtDate(ts) {
  const d = new Date(ts);
  if (!Number.isFinite(d.getTime())) return '—';
  return `${d.getFullYear()}/${pad2(d.getMonth() + 1)}/${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

/** Whether a settlement row cleared the match: the server's per-row `victory` (team won AND still in), else derived. */
export function rowCleared(raw, row, victory) {
  if (typeof raw?.victory === 'boolean') return raw.victory;
  return !!victory && row?.alive !== false && !row?.left;
}

/** A number counting from `from` to `to` (ease-out) once `run` holds; timers, not frames, so a hidden tab still ends. */
function useCountUp(to, { ms = 700, delay = 0, from = 0, run = true } = {}) {
  const target = Math.round(Number(to) || 0);
  const start = Math.round(Number(from) || 0);
  const [v, setV] = useState(() => (reducedMotion() ? target : start));
  useEffect(() => {
    if (!run) return undefined;
    if (reducedMotion() || target === start) { setV(target); return undefined; }
    const t0 = Date.now() + delay;
    const id = setInterval(() => {
      const k = Math.min(1, Math.max(0, (Date.now() - t0) / ms));
      setV(Math.round(start + (target - start) * (1 - (1 - k) ** 3)));
      if (k >= 1) clearInterval(id);
    }, 32);
    return () => clearInterval(id);
  }, [target, start, run]);
  return v;
}

/**
 * Fit the 1920×1080 stage (19.2rem × 10.8rem) into the screen: 1rem already fits it to the window (theme.css), but not
 * below the 40px floor (a phone held sideways) or inside the safe-area insets — there it is scaled down (--k on the root).
 */
function useStageFit(ref) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const fit = () => {
      const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 100;
      const k = Math.min(el.clientWidth / (19.2 * rem), el.clientHeight / (10.8 * rem));
      el.style.setProperty('--k', String(Math.max(0.3, Math.min(1, k || 1))));
    };
    fit();
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    addEventListener('resize', fit);
    return () => { ro?.disconnect(); removeEventListener('resize', fit); };
  }, []);
}

// ---- shared pieces ------------------------------------------------------------------------------------------------------

function Logo() {
  return html`<div class="slogo" aria-hidden="true">
    <${Sprite} k="entry/season_logo_settle" class="slogo__img"
      fallback=${html`<${Sprite} k="settle/common_logo" class="slogo__img" fallback=${html`<b class="slogo__txt">STRONGHOLD<br />PROTOCOL</b>`} />`} />
  </div>`;
}

/** The official elite emblem (E1 / E2). */
function EliteMark({ phase }) {
  if (!(phase > 0)) return null;
  return html`<${Sprite} k=${`elite/elite_${phase}`} class="selite" fallback=${html`<small class="selite">E${phase}</small>`} />`;
}

/** The mode pill: the official difficulty plate (its emblem, no text) under the difficulty's name. */
function ModePill({ r }) {
  const d = r.difficulty;
  if (!d) return null;
  const key = String(d).toLowerCase();
  return html`<span class=${cx('smode', `smode--${key}`)} style=${`--d-color:${DIFFICULTY_COLORS[d] || 'var(--text-lo)'}`}>
    <${Sprite} k=${`settle/mode_${key}`} class="smode__bg" fallback=${html`<span class="smode__bg smode__bg--css"><${DifficultyIcon} difficulty=${d} /></span>`} />
    <b class="smode__name">${DIFFICULTY_NAMES[d] ? t(DIFFICULTY_NAMES[d]) : d}</b>
  </span>`;
}

// ---- the radar intro ----------------------------------------------------------------------------------------------------

const SEAT_BOX = [[640, 355], [1145, 355], [640, 640], [1145, 640]];
const GHOSTS = [['left_up', 480, 200], ['right_up', 1310, 200], ['left_down', 480, 750], ['right_down', 1310, 750]];

function SettleIntro({ players, myId, lose, onDone }) {
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const id = setTimeout(() => done.current(), INTRO_MS);
    const skip = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); done.current(); } };
    addEventListener('keydown', skip);
    return () => { clearTimeout(id); removeEventListener('keydown', skip); };
  }, []);
  const s = lose ? 'f' : 's';
  const seats = SEAT_BOX.map((xy, i) => ({ xy, p: players.find((p) => p.seat === i) || null }));
  return html`<div class=${cx('sintro', lose && 'is-lose')} data-testid="settle-intro" onClick=${() => done.current()}>
    <div class="settle__stage" aria-hidden="true">
      <${Sprite} k="settle/aim" class="sintro__aim" />
      <${Sprite} k=${`settle/before_round_${s}`} class="sintro__ring" fallback=${html`<i class="sintro__ring sintro__ring--css"></i>`} />
      <${Sprite} k=${`settle/before_up_frame_${s}`} class="sintro__frame sintro__frame--up" />
      <${Sprite} k=${`settle/before_down_frame_${s}`} class="sintro__frame sintro__frame--down" />
      ${GHOSTS.map(([k, x, y], i) => html`<span key=${k} class="sintro__ghost" style=${`${at(x, y)};--i:${i}`}>
        <${Sprite} k=${k === 'right_down' ? 'settle/blank_right_down' : `settle/blank_${k}_${s}`} /></span>`)}
      ${seats.map(({ xy: [x, y], p }, i) => html`<span key=${i} style=${`${at(x, y)};--i:${i}`}
          class=${cx('sintro__seat', !p && 'is-empty', p && p.playerId === myId && 'is-me', p && p.alive === false && 'is-out', p && p.left && 'is-left')}>
        <${Sprite} k=${`settle/before_middle_${s}_${pad2(i + 1)}`} fallback=${html`<b class="sintro__tile num">${pad2(i + 1)}</b>`} /></span>`)}
      <span class="sintro__core" style=${at(888, 469)}><${Sprite} k=${`settle/before_middle_${s}`} fallback=${html`<b class="sintro__tile num">00</b>`} /></span>
      <${Sprite} k="settle/img_text" class="sintro__foot" fallback=${html`<small class="sintro__foot">RHODES ISLAND STRONGHOLD PROTOCOL</small>`} />
      <${Logo} />
    </div>
  </div>`;
}

// ---- 个人战报 -------------------------------------------------------------------------------------------------------------

// The terrain's target point and the rays to the lineup (stage pixels). [ASSUMED] read off the official settlement as
// the event footage shows it (the client's layout is not in the extracted data); the background art is laid so that
// its target — at (389, 349) of the 1020×960 team-show art, the same terrain — falls on AIM.
const AIM = [682, 345];
const BG_AT = [AIM[0] - 389, AIM[1] - 349];
const RAYS = [[1057, 192], [1410, 312], [1080, 402], [960, 585], [1080, 697], [900, 735], [682, 615]];
const CROSSES = [[930, 240], [845, 640]];

/** A quarter sprite turned four ways round its corner: the full ring / disc of the target. */
const Quad = ({ k, cls }) => html`<span class=${cx('squad', cls)}>${[0, 1, 2, 3].map((n) => html`<${Sprite} key=${n} k=${k} class=${`squad__q squad__q--${n}`} />`)}</span>`;

function Target({ lose }) {
  const s = lose ? 'f' : 's';
  return html`<div class="starget" style=${at(AIM[0], AIM[1])} aria-hidden="true">
    <${Quad} k=${`settle/target_bg_color_${s}`} cls="starget__color" />
    <${Sprite} k="settle/target_bg_round_02" class="starget__disc" />
    <${Quad} k="settle/target_bg_round_01" cls="starget__arc" />
    <${Quad} k=${`settle/target_round_${s}`} cls="starget__ring" />
    <${Sprite} k="settle/target_dot" class="starget__dot" fallback=${html`<i class="starget__dot starget__dot--css"></i>`} />
    <${Sprite} k=${`settle/target_dot_middle_${s}`} class="starget__mid" />
    <span class="starget__label">
      <${Sprite} k="settle/target_title_up" class="starget__up" fallback=${html`<b class="starget__up">TARGET POINT</b>`} />
      <${Sprite} k="settle/target_title_down" class="starget__down" fallback=${html`<small class="starget__down">STRONGHOLD PROTOCOL</small>`} />
    </span>
  </div>`;
}

function Rays({ lose }) {
  return html`<div class="srays" aria-hidden="true">
    ${RAYS.map(([x, y], i) => {
      const dx = x - AIM[0];
      const dy = y - AIM[1];
      const a = (Math.atan2(dy, dx) * 180) / Math.PI;
      return html`<span key=${i} class="sray" style=${`${at(AIM[0], AIM[1])};width:${Math.hypot(dx, dy) / 100}rem;transform:rotate(${a}deg);--i:${i}`}>
        <${Sprite} k="settle/dot_line_01" class="sray__line" fallback=${html`<i class="sray__line sray__line--css"></i>`} />
        <${Sprite} k="settle/arrow_02" class="sray__arrow" />
      </span>`;
    })}
    ${RAYS.map(([x, y], i) => html`<span key=${`e${i}`} class="sray__end" style=${`${at(x, y)};--i:${i}`}>
      <${Sprite} k="settle/dot_line_round" fallback=${html`<i class="sray__ring"></i>`} /></span>`)}
    ${lose ? CROSSES.map(([x, y], i) => html`<span key=${`x${i}`} class="sray__ban" style=${at(x, y)}>
      <${Sprite} k="settle/dot_line_ban" fallback=${html`<${Icon} name="close" />`} /></span>`) : null}
  </div>`;
}

/** One unit of a lineup as the cards draw it (自选 pick / 补位 stand-in resolved as on the report's thumbnails). */
function unitView(u, gd) {
  const m = gd.m;
  const chess = u.kind === 'token' ? null : gd.chess(u.id);
  const dr = u.diy && chess ? diyRecordFor(chess, u.diy, { chess: data.get('chess'), backups: data.get('backups') }) : null;
  const si = !dr && chess ? cardStandIn(chess, { unit: u, backups: gd.backups }) : null;
  const rec = dr || si || chess;
  const tier = Math.max(0, Math.min(6, Number(u.tier) || Number(rec?.tier) || 0));
  return {
    si,
    tier,
    golden: !!(u.golden ?? rec?.isGolden),
    name: rec?.name || '',
    art: rec ? chessPortraitUrl(m, rec) : null,
    avatar: rec ? chessAvatarUrl(m, rec) : null,
    title: si ? t('{name}（{note}）', { name: si.name, note: standInForText(chess.name) }) : (rec?.name || ''),
    items: (Array.isArray(u.items) ? u.items : []).map((id) => data.lookup('items', id)).filter(Boolean),
  };
}

const NoInfo = () => html`<small class="sop__noinfo">NO INFO</small>`;

/** One lineup slot as a tall card; `u` null = an empty slot (the official NO INFO card). */
export function OpCard({ u, gd, i }) {
  if (!u) {
    return html`<div class="sop is-empty" style=${`--i:${i}`}>
      <${Sprite} k="settle/operator_bg" class="sop__empty" fallback=${html`<span class="sop__art"><${NoInfo} /></span>`} />
    </div>`;
  }
  const v = unitView(u, gd);
  const lv = opLevel(v.tier, v.golden);
  const src = v.art || v.avatar;
  return html`<div class=${cx('sop', v.tier && `sop--t${v.tier}`, v.golden && 'is-golden')} style=${`--i:${i}`} title=${v.title}>
    <span class="sop__art"><${Img} src=${src} class=${v.art ? 'is-portrait' : 'is-avatar'} fallback=${html`<span class="sop__glyph">${[...(v.name || '?')][0]}</span>`} /></span>
    <${Sprite} k="settle/operator_frame" class="sop__frame" />
    ${v.tier ? html`<b class="sop__tier">${ROMAN[v.tier]}</b>` : null}
    <span class="sop__lv"><${Sprite} k="settle/operator_lv_bg" class="sop__lvbg" /><${EliteMark} phase=${lv.phase} /><b class="num">${lv.level}</b></span>
    ${v.si ? html`<span class="sop__si" data-standin=${v.si.charId}>${t('替补')}</span>` : null}
    <span class="sop__slots">${[0, 1].map((k) => {
      const it = v.items[k];
      return html`<i key=${k} class=${cx('sop__slot', it && 'has-item')} title=${it?.name || ''}>${it
        ? html`<${Img} src=${itemIconUrl(gd.m, it)} fallback=${html`<b>${[...(it.name || '?')][0]}</b>`} />`
        : html`<${Sprite} k="settle/operator_trap_bg" class="sop__trap" fallback=${html`<${NoInfo} />`} />`}</i>`;
    })}</span>
  </div>`;
}

function BondBar({ bonds, gd }) {
  const list = resultBonds(bonds, (id) => gd.bond(id));
  const ref = useRef(null);
  const [more, setMore] = useState(false);
  useLayoutEffect(() => { const el = ref.current; if (el) setMore(el.scrollWidth > el.clientWidth + 2); }, [list.length]);
  return html`<div class="sbonds">
    <span class="sbonds__mark" aria-hidden="true"><${Sprite} k="settle/band_icon" fallback=${html`<small>BONDS</small>`} /></span>
    <div class="sbonds__list" ref=${ref}>
      ${list.length ? list.map((b, i) => html`<span key=${b.bondId} class=${cx('sbond', b.active && 'is-on')} style=${`--i:${i}`} title=${gd.bond(b.bondId)?.name || b.bondId}>
        <span class="sbond__disc"><${BondGlyph} bondId=${b.bondId} /></span>${b.hideLayers ? html`<b class="num">—</b>` : html`<b class="num">${b.layers ?? 0}</b>`}</span>`)
        : html`<${Sprite} k="settle/band_noinfo" class="sbonds__none" fallback=${html`<span class="sbonds__none">NO INFO</span>`} />`}
    </div>
    ${more ? html`<button type="button" class="sbonds__more" aria-label=${t('更多')} onClick=${() => ref.current?.scrollBy({ left: 300, behavior: 'smooth' })}><${Icon} name="chevronRight" /></button>` : null}
  </div>`;
}

/**
 * The level settlement: LV, the bar filling with this match's 卫戍认证 (LEVEL UP! / MAX), what it earned and the daily
 * goal — or, for a match with gameplay plugins, that it counts for nothing.
 */
function LevelStrip({ prog, milestones }) {
  const gain = useCountUp(prog.gain, { ms: 650, delay: 300 });
  const total = useCountUp(prog.after, { ms: 1300, delay: 700, from: prog.before });
  const lv0 = levelOf(prog.before, milestones);
  const lv = levelOf(total, milestones);
  const d = prog.daily;
  return html`<div class=${cx('slv', lv.max && 'is-max')} title=${t('等级：本机记录的官方对局累计获得的卫戍认证')}>
    <span class="slv__lv"><${Sprite} k="settle/img_lv" class="slv__lvimg" fallback=${html`<small>LV.</small>`} /><b class="num">${lv.lv}</b></span>
    <div class="slv__track">
      ${lv.lv > lv0.lv ? html`<span class="slv__up"><${Sprite} k="settle/levelup" class="slv__flag" /><${Sprite} k="settle/img_lvup" fallback=${html`<b>LEVEL UP!</b>`} /></span>` : null}
      ${lv.max ? html`<span class="slv__max"><${Sprite} k="settle/max_bg" class="slv__flag" /><${Sprite} k="settle/img_max" fallback=${html`<b>MAX</b>`} /></span>` : null}
      <span class="slv__bar"><i style=${`width:${lv.max ? 100 : (lv.into / Math.max(1, lv.need)) * 100}%`}></i></span>
      ${lv.max ? null : html`<span class="slv__exp num"><b>${lv.into}</b><${Sprite} k="settle/num_line" class="slv__slash" fallback="/" />${lv.need}</span>`}
    </div>
    <div class="slv__gains">
      ${prog.counted ? html`
        <span class="slv__gain"><${Sprite} k="settle/reward_normal_icon" class="slv__icon" />${t('获得卫戍认证 +{n}', { n: gain })}</span>
        ${d ? html`<span class=${cx('slv__gain', 'slv__gain--daily', prog.bonus && 'is-done')} title=${t('每日防卫目标：{today}/{need}', { today: d.today, need: d.need })}>
          <${Sprite} k="settle/reward_plus" class="slv__icon" />${t('每日防卫目标 +{n}', { n: prog.bonus })}<small class="num">${d.today}/${d.need}</small></span>` : null}`
        : html`<span class="slv__gain slv__gain--off">${prog.test ? t('测试对局不计入等级') : t('非官方对局不计入等级')}</span>`}
    </div>
  </div>`;
}

/** One defeated leader on the report: the official medal (the 隐秘核心 one for the Hidden Core). */
function Medal({ m, i }) {
  const sp = m.kind === 'hidden' ? '_sp' : '';
  const label = m.kind === 'boss' ? t('敌方领袖') : t('隐秘核心');
  return html`<span class=${cx('smedal', `smedal--${m.kind}`, m.done ? 'is-done' : 'is-miss')} style=${`--i:${i}`} title=${m.rec?.name ? `${label} · ${m.rec.name}` : label}>
    <${Sprite} k=${`settle/round_info_boss_bg${sp}`} class="smedal__bg" />
    <${Sprite} k=${`settle/round_info_boss_icon${sp}`} class="smedal__icon"
      fallback=${html`<${Img} src=${enemyIconUrl(m.gd.m, m.rec?.enemyKey)} class="smedal__icon" fallback=${html`<${Icon} name="crown" class="smedal__icon" />`} />`} />
    ${m.done ? html`<${Sprite} k=${`settle/round_info_boss_complete${sp}`} class="smedal__check" fallback=${html`<i class="smedal__check"><${Icon} name="check" /></i>`} />`
      : html`<i class="smedal__check is-miss"><${Icon} name="close" /></i>`}
  </span>`;
}

/** The 测试 mark of a match of the 「测试」 mode (0.3.1, DESIGN §34.8) with its command count, as on the detail view. */
function SettleTestMark({ res }) {
  if (res?.test !== true) return null;
  return html`<span class="settle__test" data-testid="settle-test"><${TestMark} /> ${t('测试对局')}${Number.isInteger(res.testActions) ? html` · ${t('测试指令 {n} 次', { n: res.testActions })}` : null}</span>`;
}

function SelfPage({ r, res, raw, self, gd, prog, content, onNext }) {
  const cleared = rowCleared(raw, self, r.victory);
  const [leaving, setLeaving] = useState(false);
  const nextRef = useRef(null);
  const rounds = useCountUp(self.roundsPassed, { ms: 700, delay: 350 });
  const boss = cleared && r.bossId ? gd.boss(r.bossId) : null;
  const hidden = cleared && r.hiddenReached && r.hiddenBossId ? gd.boss(r.hiddenBossId) : null;
  const medals = [boss && { kind: 'boss', rec: boss, done: true, gd }, hidden && { kind: 'hidden', rec: hidden, done: r.hiddenCleared, gd }].filter(Boolean);
  const slots = Array.from({ length: 10 }, (_, i) => self.lineup[i] || null);
  const milestones = gd.config?.rewards?.milestones;
  useEffect(() => {
    audio.sfx(cleared ? 'settlementSucceed' : 'settlementFail');
    const sign = medals.length ? setTimeout(() => audio.sfx('settlementBossSign'), 900) : null;
    const focus = setTimeout(() => nextRef.current?.focus({ preventScroll: true }), 1800);
    return () => { clearTimeout(sign); clearTimeout(focus); };
  }, []);
  const next = () => {
    if (leaving) return;
    if (reducedMotion()) { onNext(); return; }
    setLeaving(true);
    setTimeout(onNext, LEAVE_MS);
  };
  return html`<section class=${cx('sself', cleared ? 'is-win' : 'is-lose', leaving && 'is-leaving')} data-testid="settle-self">
    <div class="settle__stage">
      <span class="sself__bg" style=${at(BG_AT[0], BG_AT[1])} aria-hidden="true"><${Sprite} k=${`settle/settlemen_personal_${cleared ? 'success' : 'fail'}`} /></span>
      <${Rays} lose=${!cleared} />
      <${Target} lose=${!cleared} />
      <div class="sself__fx" aria-hidden="true"></div>
      <${Logo} />
      <div class="sself__band">${self.bandId ? html`<${BandIcon} bandId=${self.bandId} size="lg" />` : html`<${PlayerAvatar} player=${self} self=${true} />`}<i aria-hidden="true"></i></div>
      <div class="sself__mode"><${ModePill} r=${r} /><${UnofficialMark} room=${content ? { content } : null} class="sself__modmark" /><${SettleTestMark} res=${res} /></div>
      <h1 class="sself__title">${cleared ? t('模拟完成') : t('模拟中断')}</h1>
      <div class="sself__rounds"><span>${t('通过回合')}</span><b class="num">${rounds}</b></div>
      ${medals.length ? html`<div class="sself__medals">${medals.map((m, i) => html`<${Medal} key=${m.kind} m=${m} i=${i} />`)}</div>` : null}
      <div class="splate">
        <${PlayerAvatar} player=${self} self=${true} class="splate__ava" />
        <div class="splate__info">
          <b class="splate__name"><${Sprite} k=${plateArt(self, true)} class="splate__namebg" /><span>${self.name}</span></b>
          <span class="splate__rank" title=${t('累计奖杯')}><${Sprite} k="settle/id_info_cup_icon" class="splate__cup" fallback=${html`<${Icon} name="crown" />`} /><b class="num">${prog.trophies}</b></span>
          <span class="splate__gain"><small><${Icon} name="crown" />${t('获得奖杯')}</small><b class="num">${self.trophies}</b></span>
        </div>
      </div>
      <div class="sops">
        <div class="sops__row sops__row--1">${slots.slice(0, 5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} i=${i} />`)}</div>
        <div class="sops__row sops__row--2">${slots.slice(5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} i=${i + 5} />`)}</div>
      </div>
      <${BondBar} bonds=${self.bonds} gd=${gd} />
      <div class="settle__barbg" aria-hidden="true"><${Sprite} k="settle/bottom_bg" /></div>
      ${Array.isArray(milestones) && milestones.length ? html`<${LevelStrip} prog=${prog} milestones=${milestones} />` : null}
      <button type="button" ref=${nextRef} class="settle__next" onClick=${next}>
        <${Sprite} k="settle/btn_next_bg" class="settle__btnbg" />
        <${Sprite} k="settle/next_icon" class="settle__nexticon" fallback=${html`<span class="settle__nexticon"><${Icon} name="chevronRight" /></span>`} /><span>${t('下一步')}</span>
      </button>
    </div>
  </section>`;
}

// ---- 同盟 ----------------------------------------------------------------------------------------------------------------

/** A player plate's bar: red for a seat that left, mint for mine, grey for a teammate's ([ASSUMED] the art has the three
 * bars — id_info_bg, _quit, _single — not which seat takes which). */
const plateArt = (p, self) => `settle/${p.left ? 'id_info_bg_quit' : self ? 'id_info_bg' : 'id_info_bg_single'}`;

function titleView(p, gd) {
  if (!p.title) return null;
  const titles = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const rec = titles.find((x) => x.id === p.title.id) || null;
  const rawRec = (data.getRaw('config')?.titles || []).find((x) => x && x.id === p.title.id) || null;
  const name = sentText(p.title?.name, rawRec?.name, rec?.name) || rec?.name || null;
  if (!name) return null;
  return {
    name,
    text: rec?.text || p.title?.text || '',
    icon: titleIconUrl(gd.m, rec?.picId || p.title?.picId || String(p.title.id || '').replace('comment_', 'comment_icon_')),
  };
}

function TeamCard({ p, i, gd, self, victory, raw }) {
  const ace = aceOf(p.lineup);
  const v = ace ? unitView(ace, gd) : null;
  const title = titleView(p, gd);
  const cleared = rowCleared(raw, p, victory);
  const band = p.bandId ? gd.band(p.bandId) : null;
  return html`<article class=${cx('tcard', self && 'is-self', p.alive === false && 'is-dead', p.left && 'is-left', cleared ? 'is-clear' : 'is-fail')} style=${`--i:${i}`}>
    <header class="tcard__head" aria-hidden="true"><i class="tcard__pin"></i><span class="tcard__code"><i></i><i></i><i></i>STRONGHOLD PROTOCOL</span><span class="tcard__seat num">${pad2(p.seat + 1)}</span></header>
    <div class="tcard__art">
      <${Img} src=${v?.art || v?.avatar} class=${cx('tcard__img', v?.art ? 'is-portrait' : 'is-avatar')} fallback=${html`<span class="tcard__glyph">${[...(p.name || '?')][0]}</span>`} />
      ${p.left ? html`<span class="tcard__cut">${t('连接中断')}</span>` : null}
      ${title ? html`<div class="tcard__title" title=${title.text}>
        <${Img} src=${title.icon} class="tcard__ticon" fallback=${html`<${Icon} name="crown" class="tcard__ticon" />`} /><b>${title.name}</b></div>` : null}
      <div class="tcard__rounds"><span>${t('通过回合')}</span><b class="num">${p.roundsPassed}</b></div>
    </div>
    <div class="tcard__plate">
      <${Sprite} k=${plateArt(p, self)} class="tcard__platebg" />
      <${PlayerAvatar} player=${p} self=${self} class="tcard__ava" />
      <span class="tcard__who">
        <b class="tcard__name"><span>${p.name}</span>${p.isBot ? html`<span class="tcard__ai">AI</span>` : null}</b>
        ${band ? html`<span class="tcard__band"><${BandIcon} bandId=${band.bandId} size="xs" /><span>${band.name}</span></span>` : null}
      </span>
    </div>
    <div class="tcard__chips">
      <span class="tchip tchip--cup" title=${t('获得奖杯')}><${Sprite} k="settle/id_info_cup_icon" class="tchip__cup" fallback=${html`<${Icon} name="crown" />`} /><b class="num">+${p.trophies}</b></span>
    </div>
  </article>`;
}

function TeamPage({ r, res, gd, myId, at: when, content, backLabel, onBack, onDetail }) {
  const rounds = useCountUp(r.roundsPassed, { ms: 900, delay: 450 });
  const backRef = useRef(null);
  const rawOf = (pid) => (Array.isArray(res?.players) ? res.players.find((x) => x && x.playerId === pid) : null) || null;
  const self = r.players.find((p) => p.playerId === myId) || null;
  const bg = self?.left ? 'quit' : r.victory ? 'success' : 'fail';
  useEffect(() => {
    audio.sfx('settlementTeam');
    const id = setTimeout(() => backRef.current?.focus({ preventScroll: true }), 900);
    return () => clearTimeout(id);
  }, []);
  return html`<section class=${cx('steam', r.victory ? 'is-win' : 'is-lose')} data-testid="settle-team">
    <div class="steam__bg" aria-hidden="true"><${Sprite} k=${`settle/settlemen_teamshow_${bg}`} /></div>
    <div class="settle__stage">
      <${Logo} />
      <div class="steam__cards" style=${`--n:${r.players.length}`}>
        ${r.players.length ? r.players.map((p, i) => html`<${TeamCard} key=${p.playerId} p=${p} i=${i} gd=${gd} self=${p.playerId === myId} victory=${r.victory} raw=${rawOf(p.playerId)} />`)
          : html`<p class="steam__none">${t('暂无结算数据')}</p>`}
      </div>
      <div class="settle__barbg steam__barbg" aria-hidden="true"><${Sprite} k="settle/bottom_bg" /></div>
      <div class="steam__outcome">
        <span class="steam__tags"><${ModePill} r=${r} /><${UnofficialMark} room=${content ? { content } : null} /><${SettleTestMark} res=${res} /></span>
        <b class="steam__title">${r.victory ? t('模拟完成') : t('模拟中断')}</b>
      </div>
      <div class="steam__rounds"><span>${t('同盟通过回合')}</span><b class="num">${rounds}</b></div>
      <div class="steam__when">
        <span class="steam__row"><${Sprite} k="settle/date_time_bg" class="steam__rowbg" /><${Sprite} k="settle/time_icon" class="steam__ico" />${fmtDuration(r.durationMs)}</span>
        <span class="steam__row"><${Sprite} k="settle/date_time_bg" class="steam__rowbg" /><${Sprite} k="settle/date_icon" class="steam__ico" />${fmtDate(when)}</span>
      </div>
      <button type="button" class="sbtn sbtn--ghost steam__detail" onClick=${onDetail}>
        <${Sprite} k="settle/btn_bg_02" class="settle__btnbg" /><${Icon} name="chart" /><span>${t('数据详情')}</span></button>
      <button type="button" ref=${backRef} class="sbtn sbtn--primary settle__back" onClick=${onBack}>
        <${Sprite} k="settle/btn_next_bg" class="settle__btnbg" />
        <${Sprite} k="settle/btn_back_icon_01" class="sbtn__mark" fallback=${html`<${Icon} name="chevronLeft" />`} /><span>${backLabel}</span></button>
      <div class="ui-slot steam__slot" data-ui-slot="result.tab" aria-label=${t('界面插件')} dangerouslySetInnerHTML=${{ __html: '' }}></div>
    </div>
  </section>`;
}

// ---- the flow -----------------------------------------------------------------------------------------------------------

/**
 * The settlement of one m.result: intro → 个人战报 → 同盟; 数据详情 opens the full report over it.
 * `content`: the room's content (room.state.content) — gameplay plugins mark the match unofficial (DESIGN §32.6).
 * @param {{ res: any, pub?: any, myId?: string|null, content?: any, backLabel: string, onBack: () => void }} props
 */
export function SettleFlow({ res, pub = null, myId = null, content = null, backLabel, onBack }) {
  const gd = useGameData();
  const r = normalizeResult(res, pub);
  const self = r.players.find((p) => p.playerId === myId) || null;
  const rawSelf = self && Array.isArray(res?.players) ? res.players.find((x) => x && x.playerId === myId) || null : null;
  const [page, setPage] = useState(() => (!self ? 'team' : reducedMotion() ? 'self' : 'intro'));
  const [detail, setDetail] = useState(false);
  // this device's records as the match ended (m.result is recorded as it arrives: the match's own record is left out)
  const ctx = useMemo(() => {
    const { records } = loadStats();
    const id = recordId(res, myId);
    const own = records.find((x) => x.id === id);
    return { records, id, at: own?.t || Date.now() };
  }, []);
  // a 测试 match earns nothing toward the level or the daily goal (its server reward is 0 and its record is not kept)
  const isTest = res?.test === true;
  const prog = useMemo(() => (self ? { ...levelProgress(ctx.records, {
    id: ctx.id, gain: self.reward, rounds: self.roundsPassed, trophies: self.trophies, at: ctx.at,
    counted: !isTest && !isModdedRoom(content ? { content } : null), rewards: gd.config?.rewards,
  }), test: isTest } : null), [gd.config]);
  const rootRef = useRef(null);
  useStageFit(rootRef);
  const lose = self ? !rowCleared(rawSelf, self, r.victory) : !r.victory;
  return html`<div ref=${rootRef} class=${cx('screen', 'result', 'settle', `settle--${page}`)} data-testid="settle">
    ${page === 'intro' ? html`<${SettleIntro} players=${r.players} myId=${myId} lose=${lose} onDone=${() => setPage('self')} />` : null}
    ${page === 'self' ? html`<${SelfPage} r=${r} res=${res} raw=${rawSelf} self=${self} gd=${gd} prog=${prog} content=${content} onNext=${() => setPage('team')} />` : null}
    ${page === 'team' ? html`<${TeamPage} r=${r} res=${res} gd=${gd} myId=${myId} at=${ctx.at} content=${content} backLabel=${backLabel} onBack=${onBack} onDetail=${() => setDetail(true)} />` : null}
    ${detail ? html`<div class="settle__detail" data-testid="settle-detail">
      <${ResultView} res=${res} pub=${pub} myId=${myId} quiet=${true} slot=${false} content=${content} backLabel=${t('返回')} onBack=${() => setDetail(false)} /></div>` : null}
  </div>`;
}

/**
 * RESULT screen of the match on screen: reads the store; 返回同盟 / 返回大厅 drops the match.
 * The RESULT phase can reach the client before m.result: the flow starts once the payload is here, since its own row
 * decides intro → 个人战报 (a seat) or 同盟 (a spectator).
 */
export function ResultScreen() {
  const res = useStore((s) => s.match.result);
  const pub = useStore((s) => s.match.public);
  const myId = useStore((s) => s.me.playerId);
  const hasRoom = useStore((s) => !!s.room);
  const content = useStore((s) => s.room?.content ?? null);
  const back = () => store.set({ match: emptyMatch() });
  if (!res) return html`<div class="screen result settle" data-testid="settle-wait"><${Spinner} size="lg" /></div>`;
  return html`<${SettleFlow} res=${res} pub=${pub} myId=${myId} content=${content} backLabel=${hasRoom ? t('返回同盟') : t('返回大厅')} onBack=${back} />`;
}
