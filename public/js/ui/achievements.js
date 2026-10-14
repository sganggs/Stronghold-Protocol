// 成就统计 (the event video 1:25–1:44, 2026-10-13): the lobby's top-left entry — a scene card with the trophies and the
// LV — and the 卫戍协议：盟约 panel it opens:
//   the player plate (LV, name, trophies, best round), the per-mode table (总模拟数 / 成功卫戍 / 绝境突破 = cleared on 绝境
//   or 终极), the six 评语 round a hexagon;
//   卫戍成就 — 战果纪录 (the match whose bond stacked highest: that bond, its layers, the lineup and its top bonds) and the
//     single-match bests of funds spent, promotions and enemies defeated;
//   盟约纪录 — the three bonds most often active, and the operators of the first;
//   策略纪录 — the three strategies most often picked, and those that carry the mark (cleared on 绝境 or 终极 with them).
// Everything is counted from match records: the logged-in player's account list (ui/cloudStats.js — the same on every
// device and server, 2026-10-14) or a friend's account list (opened from 好友, ui/friends.js). The achievements belong
// to the account (the owner, 2026-10-14): a guest's panel asks for a login instead (the device list stays on the stats
// page and can be imported after logging in). The footer names the source where the official prints its daily refresh
// time; the plate shows the trophies and the account's 获赞. The LV is the settlement's (screens/settle.js levelOf over
// the rows' `reward`). The second reference clip (2026-10-14, 0:04–0:18) set the look: a diamond loader on the blurred
// lobby until the data is in, then the panel fades in; a solid hexagon; the record's bonds in a 2×3 grid wired to the
// emblem. The drawn shapes are original; icons and portraits come from the resource pack.

import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button } from './components.js';
import { useGameData, BandIcon, BondGlyph, UnitThumb } from './gameComponents.js';
import { data } from '../data.js';
import { loadStats, countsTowardStats, selfRowOf, roundsOf } from './stats.js';
import { useCurrentAccount, openAccountPanel } from './accounts.js';
import { useRecords, loadFriendRecords, importDeviceRecords } from './cloudStats.js';
import { NameCardLayer } from './namecards.js';
import { TrophyBadge } from './trophies.js';
import { toast } from './toasts.js';
import { Emblem } from '../screens/title.js';
import { OpCard, levelOf } from '../screens/settle.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];
/** 绝境突破: a clear on these difficulties. */
const HARD_UP = new Set(['HARD', 'ABYSS']);
/** The hexagon's 评语, clockwise from the top (the official order). */
export const HEX_TITLES = ['comment_4', 'comment_5', 'comment_6', 'comment_1', 'comment_2', 'comment_3'];

/**
 * Everything the panel shows, from the local records (any order). `hiddenLayers(bondId)`: a bond whose layers the game
 * never shows (bonds.json noStack) cannot be the 战果纪录.
 * @param {any[]} records
 * @param {{ hiddenLayers?: (bondId: string) => boolean }} [o]
 */
export function achievementStats(records, { hiddenLayers = () => false } = {}) {
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const out = {
    trophies: 0, exp: 0, bestRound: 0,
    modes: { solo: { games: 0, wins: 0, hard: 0 }, coop: { games: 0, wins: 0, hard: 0 } },
    titles: {}, best: null, maxima: { gold: 0, merges: 0, kills: 0 },
    topBonds: [], topBands: [], markedBands: [],
  };
  const bonds = new Map();
  const bands = new Map();
  const marked = new Set();
  for (const rec of Array.isArray(records) ? records : []) {
    const self = rec ? selfRowOf(rec) : null;
    if (!self) continue;
    out.trophies += Math.max(0, num(self.trophies));
    out.exp += Math.max(0, num(self.reward));
    if (!countsTowardStats(rec)) continue;
    out.bestRound = Math.max(out.bestRound, roundsOf(rec));
    const won = !!self.victory;
    const hardWin = won && HARD_UP.has(rec.difficulty);
    const mode = out.modes[rec.roomMode];
    if (mode) { mode.games++; if (won) mode.wins++; if (hardWin) mode.hard++; }
    const tid = self.title?.id;
    if (tid) out.titles[tid] = (out.titles[tid] || 0) + 1;
    const st = self.stats || {};
    for (const k of ['gold', 'merges', 'kills']) if (num(st[k]) > out.maxima[k]) out.maxima[k] = st[k];
    if (self.bandId) {
      bands.set(self.bandId, (bands.get(self.bandId) || 0) + 1);
      if (hardWin) marked.add(self.bandId);
    }
    for (const b of Array.isArray(self.bonds) ? self.bonds : []) {
      if (!b || !b.bondId) continue;
      if (b.active) bonds.set(b.bondId, (bonds.get(b.bondId) || 0) + 1);
      const layers = num(b.layers);
      if (layers > 0 && !hiddenLayers(b.bondId) && (!out.best || layers > out.best.layers)) out.best = { rec, self, bondId: b.bondId, layers };
    }
  }
  const top = (map) => [...map].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, 3);
  out.topBonds = top(bonds).map(([bondId, games]) => ({ bondId, games }));
  out.topBands = top(bands).map(([bandId, games]) => ({ bandId, games }));
  out.markedBands = [...marked];
  return out;
}

/** The operators of a bond (plain chess, one per operator), by tier. */
export function bondOperators(chessList, bondId) {
  const seen = new Set();
  return (Array.isArray(chessList) ? chessList : [])
    .filter((c) => c && !c.isGolden && c.visible !== false && !c.isHidden && !c.isDiy && Array.isArray(c.bonds) && c.bonds.includes(bondId))
    .sort((a, b) => (a.tier - b.tier) || ((a.shopSortId ?? 0) - (b.shopSortId ?? 0)))
    .filter((c) => { const k = c.charId || c.chessId; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** My records' aggregate (the account's when logged in, else this device's), re-counted after every sync. */
function useAchievements(hiddenLayers) {
  const cur = useRecords();
  const s = useMemo(() => achievementStats(cur.records, { hiddenLayers }), [cur, hiddenLayers]);
  return { s, cur };
}
/** A friend's list (loaded once per open). */
function useFriendAchievements(friend, hiddenLayers) {
  const [got, setGot] = useState(null);
  useEffect(() => {
    let live = true;
    loadFriendRecords(friend.id).then((d) => { if (live) setGot(d); }).catch((err) => { if (live) setGot({ error: err?.message || t('读取失败'), records: [] }); });
    return () => { live = false; };
  }, [friend.id]);
  const s = useMemo(() => achievementStats(got?.records || [], { hiddenLayers }), [got, hiddenLayers]);
  return { s, got };
}
const noHidden = () => false;

// ---- the lobby entry ---------------------------------------------------------------------------------------------------

/**
 * The hub's top-left 成就统计 card: a dusk scene with the emblem, my trophies, and the label strip with my LV — the
 * account's; a guest's card says the achievements need a login.
 */
export function AchievementEntry({ onOpen }) {
  const { s, cur } = useAchievements(noHidden);
  const lv = levelOf(s.exp);
  const guest = cur.source !== 'account';
  return html`<button type="button" class=${cx('hub-ach', guest && 'is-guest')} onClick=${onOpen} title=${guest ? t('成就统计 · 登录账号后记录') : t('成就统计（本机记录）')}>
    <span class="hub-ach__scene" aria-hidden="true">
      <svg class="hub-ach__land" viewBox="0 0 320 110" preserveAspectRatio="none">
        <defs><linearGradient id="hubAchSky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="#2a2114" /><stop offset=".5" stop-color="#b8741c" /><stop offset="1" stop-color="#f0a636" /></linearGradient></defs>
        <rect width="320" height="110" fill="url(#hubAchSky)" />
        <path d="M0 110V80l28-12 22 9 34-27 27 18 30-13 41 23 27-11 31 17 33-21 47 25V110z" fill="#3a2a16" />
        <path d="M0 110V94l46-11 41 8 50-15 44 13 50-9 40 11 49-7V110z" fill="#18120b" />
        <path d="M262 110V70M262 80l-9-8M262 76l8-7M262 86l10-6" stroke="#18120b" stroke-width="2.5" fill="none" />
      </svg>
      <span class="hub-ach__mark"><${Emblem} /></span>
      <span class="hub-ach__rank">${guest ? html`<${Icon} name="rook" />` : html`<${TrophyBadge} count=${s.trophies} />`}<small><${Icon} name="crown" /><b class="num">${guest ? '—' : s.trophies}</b></small></span>
    </span>
    <span class="hub-ach__label">
      <svg class="hub-ach__badge" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h14v12l-7 6-7-6zm4 5v2h2V8zm4 0v2h2V8zm-4.5 4.2a4.5 4.5 0 0 0 7 0l-1.3-1a3 3 0 0 1-4.4 0z" fill-rule="evenodd" /></svg>
      <span>${t('成就统计')}</span>${guest ? html`<b class="hub-ach__lv hub-ach__login">${t('需登录')}</b>` : html`<b class="hub-ach__lv num">LV.${lv.lv}</b>`}
    </span>
  </button>`;
}

// ---- the panel ---------------------------------------------------------------------------------------------------------

function SectionBar({ title, micro }) {
  return html`<h3 class="ach-bar">
    <span class="ach-bar__icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M6 3h12v3h3v3a5 5 0 0 1-5 5h-.4A5 5 0 0 1 13 16.6V19h4v2H7v-2h4v-2.4A5 5 0 0 1 8.4 14H8a5 5 0 0 1-5-5V6h3zm0 5H5v1a3 3 0 0 0 1.4 2.5A5 5 0 0 1 6 10zm12 0v2a5 5 0 0 1-.4 1.5A3 3 0 0 0 19 9V8zM12 5.6l.9 1.9 2 .3-1.5 1.4.4 2-1.8-1-1.8 1 .4-2-1.5-1.4 2-.3z" fill-rule="evenodd" /></svg></span>
    <span class="ach-bar__title">${title}</span>
    <span class="ach-bar__marks" aria-hidden="true"><i><${Icon} name="rook" /></i><i><svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 0h7v7h-7z" fill="none" stroke="currentColor" stroke-width="2" /></svg></i>
      <${MicroLabel} class="ach-bar__micro">STRONGHOLD PROTOCOL<br />${micro}<//></span>
  </h3>`;
}

/**
 * The six 评语 round a hexagon of six solid triangles (gaps between them, the outer corners cut, a ruler along each
 * outer edge, a dark hub). Exported for the tests: the segment paths are plain geometry.
 */
export function hexSegments(R = 172) {
  const pt = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
  const mix = (p, q, u) => [p[0] + (q[0] - p[0]) * u, p[1] + (q[1] - p[1]) * u];
  const r1 = (p) => p.map((v) => Math.round(v * 10) / 10);
  return HEX_TITLES.map((id, i) => {
    const a = -90 + i * 60;
    const n = pt(a, 1); // outward normal of the outer edge
    const off = (p, d) => [p[0] + n[0] * d, p[1] + n[1] * d];
    const p1 = pt(a - 30, R), p2 = pt(a + 30, R);
    // the gaps: each triangle shrunk towards its centroid; then the hub corner and the two outer corners cut
    const g = [(p1[0] + p2[0]) / 3, (p1[1] + p2[1]) / 3];
    const s = (p) => [g[0] + (p[0] - g[0]) * 0.93, g[1] + (p[1] - g[1]) * 0.93];
    const [C, P1, P2] = [s([0, 0]), s(p1), s(p2)];
    const poly = [mix(C, P1, 0.12), mix(C, P1, 0.93), mix(P1, P2, 0.06), mix(P1, P2, 0.94), mix(C, P2, 0.93), mix(C, P2, 0.12)];
    // the ruler: a line inside the outer edge and ticks reaching towards it (every fourth one longer)
    const e1 = off(mix(P1, P2, 0.12), -14), e2 = off(mix(P1, P2, 0.88), -14);
    const ticks = Array.from({ length: 17 }, (_, j) => { const q = mix(e1, e2, j / 16); return [r1(q), r1(off(q, j % 4 === 0 ? 9 : 5))]; });
    return { id, i, points: poly.map((p) => r1(p).join(',')).join(' '), rule: [r1(e1), r1(e2)], ticks };
  });
}
const HEX = hexSegments();
const seg = ([p, q], key) => html`<line key=${key} x1=${p[0]} y1=${p[1]} x2=${q[0]} y2=${q[1]} />`;

function TitleHex({ titles, gd }) {
  const recs = Array.isArray(gd.config?.titles) ? gd.config.titles : [];
  const pt = (deg, r) => [Math.cos((deg * Math.PI) / 180) * r, Math.sin((deg * Math.PI) / 180) * r];
  return html`<div class="ach-hex">
    <span class="ach-hex__cap" aria-hidden="true"><i></i>STRONGHOLD PROTOCOL<small></small></span>
    <svg class="ach-hex__svg" viewBox="-300 -240 600 480" aria-hidden="true">
      ${HEX.map((h) => html`<g key=${h.id} class="ach-hex__seg" style=${`--i:${h.i}`}>
        <polygon points=${h.points} />
        <g class="ach-hex__ticks">${seg(h.rule, 'rule')}${h.ticks.map(seg)}</g>
      </g>`)}
      <circle class="ach-hex__hub" r="15" />
    </svg>
    ${HEX_TITLES.map((id, i) => {
      const [x, y] = pt(-90 + i * 60, 222);
      const rec = recs.find((r) => r.id === id);
      return html`<span key=${id} class="ach-hex__label" style=${`left:calc(50% + ${(x / 600) * 100}%);top:calc(50% + ${(y / 480) * 100}%);--i:${i}`} title=${rec?.text || ''}>
        <b class="num">${titles[id] || 0}</b><span>${rec?.name || id}</span></span>`;
    })}
  </div>`;
}

const THUMB = 'M2 10h4v11H2zm6 11V10l5-8 1.2.6c.9.5 1.3 1.5 1.1 2.5L14.6 9H20a2 2 0 0 1 2 2.3l-1.4 8A2 2 0 0 1 18.6 21z';

/**
 * `acct`: the account shown ({ name, tag, avatar, card }), null for a guest (then `me`, the store's player, names it).
 * The card: the avatar with the LV at its top-left corner, on the account's namecard (the owner, 2026-10-14).
 */
function Plate({ me, acct, s, likes }) {
  const lv = levelOf(s.exp);
  const name = acct?.name || me?.name || t('博士');
  return html`<div class="ach-plate">
    <div class=${cx('ach-card', acct?.card && 'has-nc')}>
      <${NameCardLayer} card=${acct?.card} small=${false} />
      <span class="ach-card__ava">
        ${acct?.avatar ? html`<img src=${acct.avatar} alt="" />` : html`<span class="ach-card__glyph">${[...name][0]}</span>`}
        <span class="ach-card__lv" title=${t('等级')}><b class="num">${lv.lv}</b><small>LV</small></span>
      </span>
      <span class="ach-card__who">
        <b class="ach-card__name">${name}${acct?.tag ? html`<span class="ach-card__tag">#${acct.tag}</span>` : null}</b>
        <span class="ach-card__id">${acct ? (acct.local ? t('本机账号 {name}', { name: `${acct.name}#${acct.tag}` }) : t('账号 {name}', { name: `${acct.name}#${acct.tag}` })) : t('本机记录')}</span>
      </span>
      <span class="ach-card__brand" aria-hidden="true">STRONGHOLD<br />PROTOCOL</span>
    </div>
    <div class="ach-counts">
      <span class="ach-counts__badge is-trophy"><${TrophyBadge} count=${s.trophies} /></span>
      <span class="ach-counts__row" title=${s.bestRound ? t('最高回合 {n}', { n: s.bestRound }) : ''}><small><${Icon} name="crown" />${t('已获奖杯')}</small><b class="num">${s.trophies}</b></span>
      <span class="ach-counts__badge is-like" aria-hidden="true"><svg viewBox="0 0 40 40"><rect x="4" y="4" width="32" height="32" rx="6" /><path class="ach-counts__ink" d="M11 19h4v10h-4zm6 10V19l4.5-7 1 .5c.8.4 1.1 1.3.9 2.2L22.6 18H28a2 2 0 0 1 2 2.3l-1.2 6.9A2 2 0 0 1 26.8 29z" /></svg></span>
      <span class="ach-counts__row ach-counts__likes" title=${t('在结算界面收到的队友点赞')}><small><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d=${THUMB} /></svg>${t('获赞数')}</small><b class="num">${likes ? likes.got : '—'}</b></span>
    </div>
  </div>`;
}

/** 导入本机记录: shown on my account's panel while this device holds matches the account lacks. */
function ImportBar({ cur }) {
  const [busy, setBusy] = useState(false);
  const n = useMemo(() => {
    if (cur.source !== 'account' || !cur.ready) return 0;
    const have = new Set(cur.records.map((r) => r.id));
    return loadStats().records.filter((r) => !have.has(r.id)).length;
  }, [cur]);
  if (!n) return null;
  const go = async () => {
    setBusy(true);
    try { const sent = await importDeviceRecords(); toast(t('已导入 {n} 局本机记录到账号', { n: sent }), 'success'); }
    catch (err) { toast(err?.message || t('导入失败'), 'error'); }
    finally { setBusy(false); }
  };
  return html`<div class="ach-import"><${Icon} name="info" /><span>${t('这台设备上还有 {n} 局记录不在账号里（登录前或其他账号玩的也在内）。', { n })}</span>
    <${Button} size="sm" variant="primary" loading=${busy} onClick=${go}>${t('导入到账号')}<//></div>`;
}

/**
 * A guest's panel: the achievements are the account's. The login dialog (ui/accounts.js, above this panel) opens on
 * top; once logged in, the panel turns into the account's.
 */
function GuestGate() {
  const n = useMemo(() => loadStats().records.length, []);
  return html`<div class="ach-gate">
    <span class="ach-gate__mark" aria-hidden="true"><${Emblem} /></span>
    <b class="ach-gate__title">${t('成就记录绑定在账号上')}</b>
    <p>${t('登录后每局战绩自动记入账号：奖杯、等级、获赞和各项纪录。')}</p>
    ${n ? html`<p class="ach-gate__local">${t('这台设备上有 {n} 局记录，登录后可以导入到账号。', { n })}</p>` : null}
    <${Button} variant="primary" size="lg" onClick=${() => openAccountPanel()}>${t('登录 / 注册')}<//>
  </div>`;
}

function ModeTable({ modes }) {
  const row = (key, icon, label) => html`<div class="ach-modes__row">
    <span class="ach-modes__mode"><${Icon} name=${icon} /><b>${label}</b></span>
    <span class="ach-modes__cell"><b class="num">${modes[key].games}</b><small>${t('总模拟数')}</small></span>
    <span class="ach-modes__cell"><b class="num">${modes[key].wins}</b><small>${t('成功卫戍')}</small></span>
    <span class="ach-modes__cell" title=${t('在绝境模拟或终极模拟中成功卫戍')}><b class="num">${modes[key].hard}</b><small>${t('绝境突破')}</small></span>
  </div>`;
  return html`<div class="ach-modes">${row('solo', 'user', t('独立模拟'))}${row('coop', 'users', t('同盟模拟'))}</div>`;
}

function BestRecord({ best, gd }) {
  if (!best) return html`<p class="ach-empty">${t('还没有可展示的战果：完成一局模拟后在这里记录盟约叠加最高的一局')}</p>`;
  const lineup = Array.isArray(best.self.lineup) ? best.self.lineup : [];
  const slots = Array.from({ length: 10 }, (_, i) => lineup[i] || null);
  const bonds = recordBonds(best.self.bonds, (id) => !!gd.bond?.(id)?.noStack);
  const bond = gd.bond?.(best.bondId);
  return html`<div class="ach-best">
    <div class="ach-best__left">
      <span class="ach-pill">${t('战果纪录')}<${Icon} name="chevrons" /></span>
      <span class="ach-best__mount">
        <span class="ach-best__glyph" title=${bond?.name || best.bondId}><${BondGlyph} bondId=${best.bondId} /></span>
        <span class="ach-best__label">${t('盟约最高叠加')}</span>
        <b class="ach-best__num num">${best.layers}</b>
        <i class="ach-best__wire" aria-hidden="true"></i>
      </span>
    </div>
    <div class="ach-best__lineup">
      <div class="ach-best__rows">
        <div class="ach-best__row">${slots.slice(0, 5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} i=${i} />`)}</div>
        <div class="ach-best__row">${slots.slice(5).map((u, i) => html`<${OpCard} key=${i} u=${u} gd=${gd} i=${i + 5} />`)}</div>
      </div>
      <div class="ach-best__bonds">${bonds.map((b, i) => html`<span key=${b.bondId} class=${cx('sbond', b.active && 'is-on')} style=${`--i:${i}`} title=${gd.bond?.(b.bondId)?.name || b.bondId}>
        <span class="sbond__disc"><${BondGlyph} bondId=${b.bondId} /></span><b class="num">${b.hidden ? '—' : b.layers}</b></span>`)}</div>
    </div>
  </div>`;
}

/**
 * The 战果纪录's bonds beside the lineup: that match's bonds (active ones first, then by layers), at most six — the
 * 2×3 grid of the reference. `noStack(bondId)`: a bond whose layers the game never shows prints a dash.
 */
export function recordBonds(list, noStack = () => false) {
  return (Array.isArray(list) ? list : [])
    .filter((b) => b && b.bondId && (b.active || Number(b.layers) > 0))
    .map((b) => ({ bondId: b.bondId, active: !!b.active, layers: Math.max(0, Number(b.layers) || 0), hidden: noStack(b.bondId) }))
    .sort((a, b) => (b.active - a.active) || ((b.hidden ? -1 : b.layers) - (a.hidden ? -1 : a.layers)))
    .slice(0, 6);
}

function Maxima({ maxima }) {
  const box = (cls, label, v, glyph) => html`<div class=${cx('ach-max', cls)}>
    <span class="ach-max__label">${label}</span><b class="ach-max__num"><small>x</small><span class="num">${v}</span></b>
    <svg class="ach-max__glyph" viewBox="0 0 48 48" aria-hidden="true"><path d=${glyph} /></svg>
  </div>`;
  return html`<div class="ach-maxima">
    ${box('is-gold', t('单局最多消耗资金:'), maxima.gold, 'M24 3 33 13 24 23 15 13zM12 21l9 10-9 10-9-10zM36 21l9 10-9 10-9-10z')}
    ${box('is-orange', t('单局最多晋级次数:'), maxima.merges, 'M4 22 16 10l8 8 8-8 12 12-5 5-7-7-8 8-8-8-7 7zM4 38l12-12 8 8 8-8 12 12-5 5-7-7-8 8-8-8-7 7z')}
    ${box('is-mint', t('单局最多击败数:'), maxima.kills, 'M6 4h8l10 13L34 4h8L28 22l16 18-6 5-14-15-14 15-6-5 16-18z')}
  </div>`;
}

function BondRecord({ topBonds, gd }) {
  if (!topBonds.length) return html`<p class="ach-empty">${t('暂无盟约记录')}</p>`;
  const ops = bondOperators(data.list('chess'), topBonds[0].bondId);
  return html`<div class="ach-list">
    <p class="ach-sub">${t('最常使用的盟约:')}</p>
    <div class="ach-tops">${topBonds.map((b, i) => html`<div key=${b.bondId} class="ach-top ach-top--bond" title=${t('{n} 局中激活', { n: b.games })}>
      <span class="ach-top__frame"><i class="ach-top__rank">TOP${i + 1}</i><${BondGlyph} bondId=${b.bondId} /></span>
      <b class="ach-top__name">${gd.bond?.(b.bondId)?.name || b.bondId}</b></div>`)}</div>
    ${ops.length ? html`<p class="ach-sub">${t('盟约下干员为:')}</p>
      <div class="ach-ops">${ops.map((c) => html`<span key=${c.chessId} class=${cx('ach-op', `sop--t${c.tier}`)} title=${c.name}>
        <${UnitThumb} kind="chess" id=${c.chessId} size="md" showTier=${false} /><b class="ach-op__tier">${ROMAN[c.tier] || ''}</b></span>`)}</div>` : null}
  </div>`;
}

function BandRecord({ topBands, marked, gd }) {
  if (!topBands.length) return html`<p class="ach-empty">${t('暂无策略记录')}</p>`;
  const name = (id) => gd.band?.(id)?.name || id;
  return html`<div class="ach-list">
    <p class="ach-sub">${t('最常使用的策略:')}</p>
    <div class="ach-tops ach-tops--band">${topBands.map((b, i) => html`<div key=${b.bandId} class="ach-top ach-top--band">
      <span class="ach-top__frame"><i class="ach-top__rank">TOP${i + 1}</i><${BandIcon} bandId=${b.bandId} size="lg" /></span>
      <span class="ach-top__side"><b class="ach-top__name">${name(b.bandId)}</b><span class="ach-top__count"><small>x</small><b class="num">${b.games}</b></span></span></div>`)}</div>
    <p class="ach-sub" title=${t('用该策略在绝境模拟或终极模拟中成功卫戍')}>${t('已获得特殊标识的策略:')}</p>
    ${marked.length ? html`<div class="ach-marks">${marked.map((id) => html`<div key=${id} class="ach-mark">
      <span class="ach-mark__frame"><${BandIcon} bandId=${id} size="lg" /><i class="ach-mark__badge" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M8 1.5 14 13H2zM8 6v3.6M8 11v.6" fill="none" stroke="currentColor" stroke-width="1.8" /></svg></i></span>
      <b>${name(id)}</b></div>`)}</div>` : html`<p class="ach-empty">${t('在绝境模拟或终极模拟中成功卫戍，所用策略会获得特殊标识')}</p>`}
  </div>`;
}

/**
 * The 卫戍协议：盟约 panel. `me`: the store's player (its name when not logged in). `friend` ({ id, name, tag, avatar }):
 * that friend's account list instead of mine.
 */
export function AchievementPanel({ me, onClose, friend = null }) {
  const gd = useGameData();
  const { me: myAcct, loaded } = useCurrentAccount();
  const hidden = useMemo(() => (gd.ready ? (id) => !!gd.bond?.(id)?.noStack : noHidden), [gd.ready]);
  return friend
    ? html`<${FriendPanel} gd=${gd} hidden=${hidden} friend=${friend} onClose=${onClose} />`
    : html`<${MyPanel} gd=${gd} hidden=${hidden} me=${me} acct=${myAcct} loaded=${loaded} onClose=${onClose} />`;
}
function MyPanel({ gd, hidden, me, acct, loaded, onClose }) {
  const { s, cur } = useAchievements(hidden);
  if (loaded && !acct) {
    return html`<${PanelFrame} gd=${gd} onClose=${onClose} foot=${t('成就数据保存在账号上')} loading=${false} gate=${html`<${GuestGate} />`} />`;
  }
  // the account's list (its copy shows at once; the very first load waits for the service, a failure shows the copy)
  const loading = !loaded || cur.source !== 'account' || (!cur.ready && !cur.failed && !cur.records.length);
  const foot = cur.local ? t('本机记录 · 保存在这台设备的浏览器里 · 每局结束后更新') : cur.failed ? t('账号服务暂时连不上 · 显示上次同步的数据') : t('账号数据 · 每局结束后更新');
  return html`<${PanelFrame} gd=${gd} s=${s} onClose=${onClose} foot=${foot} loading=${loading}
    plate=${html`<${Plate} me=${me} acct=${acct} s=${s} likes=${cur.likes} />`} extra=${html`<${ImportBar} cur=${cur} />`} />`;
}
function FriendPanel({ gd, hidden, friend, onClose }) {
  const { s, got } = useFriendAchievements(friend, hidden);
  const acct = got?.owner || friend;
  return html`<${PanelFrame} gd=${gd} s=${s} onClose=${onClose} foot=${got?.error || t('好友的账号数据')} loading=${!got}
    plate=${html`<${Plate} me=${null} acct=${acct} s=${s} likes=${got?.likes || null} />`} extra=${null} />`;
}

/** The diamond loader stays at least this long, so a panel read from the copy does not flash it. */
const LOADER_MIN_MS = 260;

/**
 * The dialog: the blurred lobby with the diamond loader until the data is in, then the panel fades in (the reference
 * clip's order). `gate`: a guest's login block in place of the counts.
 */
function PanelFrame({ gd, s, onClose, foot, loading, plate, extra, gate = null }) {
  const [closing, setClosing] = useState(false);
  const [shown, setShown] = useState(false);
  const opened = useMemo(() => Date.now(), []);
  const ready = gd.ready && !loading;
  const close = () => { if (closing) return; setClosing(true); setTimeout(onClose, 180); };
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') close(); };
    addEventListener('keydown', onKey);
    // the lobby chat (z 180, ui/communityChat.js) steps aside while a hub dialog is open
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  useEffect(() => {
    if (!ready || shown) return undefined;
    const id = setTimeout(() => setShown(true), Math.max(0, LOADER_MIN_MS - (Date.now() - opened)));
    return () => clearTimeout(id);
  }, [ready, shown]);
  return html`<div class=${cx('ach', closing && 'is-closing')} role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) close(); }}>
    ${!shown ? html`<span class="ach__loader" role="status" aria-label=${t('读取中')}><i></i><i></i><b></b></span>` : html`
    <div class="ach__box" role="dialog" aria-modal="true" aria-label=${t('成就统计')}>
      <header class="ach__head">
        <span class="ach__logo"><svg viewBox="0 0 40 30" aria-hidden="true"><path d="M8 4h10v8H8zM22 4h10v8H22zM8 18h10v8H8zM22 18h10v8H22z" fill="none" stroke="currentColor" stroke-width="2.4" /><path d="M2 2v26M38 2v26" stroke="currentColor" stroke-width="2" /></svg>
          <b>STRONGHOLD<br />PROTOCOL</b></span>
        <span class="ach__band">
          <svg class="ach__dunes" viewBox="0 0 300 40" preserveAspectRatio="none" aria-hidden="true">
            <path class="is-far" d="M0 24c28-7 58-13 92-9s56 11 90 4 64-14 118-7V40H0z" /><path d="M0 34c34-9 60-12 96-6s52 9 86 3 70-11 118-5V40H0z" /></svg>
          <span class="ach__emblem"><${Emblem} /></span>
          <span class="ach__titles"><i aria-hidden="true">ALLIANCE</i><b>${t('卫戍协议：盟约')}</b></span>
        </span>
      </header>
      <div class="ach__body">
        ${gate || html`
          ${extra}
          <section class="ach-top-area">
            <div class="ach-top-area__left">${plate}<${ModeTable} modes=${s.modes} /></div>
            <${TitleHex} titles=${s.titles} gd=${gd} />
          </section>
          <${SectionBar} title=${t('卫戍成就')} micro="ACHIEVEMENTS" />
          <${BestRecord} best=${s.best} gd=${gd} />
          <${Maxima} maxima=${s.maxima} />
          <${SectionBar} title=${t('盟约纪录')} micro="BONDS" />
          <${BondRecord} topBonds=${s.topBonds} gd=${gd} />
          <${SectionBar} title=${t('策略纪录')} micro="STRATEGIES" />
          <${BandRecord} topBands=${s.topBands} marked=${s.markedBands} gd=${gd} />`}
      </div>
      <button type="button" class="ach__close" onClick=${close} aria-label=${t('关闭')}><${Icon} name="close" /></button>
      <span class="ach__foot">${foot}</span>
    </div>`}
  </div>`;
}
