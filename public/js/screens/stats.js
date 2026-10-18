// The local stats viewer (统计数据): this browser's record of the matches the player took part in — see ui/stats.js for
// what is recorded, what counts and how the storage is bounded. A full-screen overlay opened imperatively from the
// title screen / lobby / room (`openStats()`); <StatsHost/> is mounted once by main.js. Ported from PR #323 by
// @2321Robin; reworked for 0.2.2 in the grammar of 干员调配 (top bar with tabs, a note line, a scrolling body).
//
//   总览      – games, wins, win rate, hidden-core reaches / clears, best round; the difficulties; the six
//               评语 (titles) with their counts; what counts and what was left out
//   盟约&策略 – top three most used active settlement alliances and strategies; per strategy: games / passed / rate
//   战斗累计  – time played; the player's summed combat bookkeeping of the settled matches
//   对局记录  – every stored match, newest first. A settled row re-views that match's settlement screen (the record is
//               inverted into an m.result payload for <ResultView/>); a match given up early is marked 中途退出 and,
//               when it did not count, 不计入统计
// Everything is 本机数据 (localStorage, `sp.pref.stats`) and the page says so, teammates' names included. 导出 / 导入 (a
// JSON file, merged by record id on the way in) moves it between devices; 清空 resets it after a confirm dialog.
// The host renders nothing until opened and the game data files the replay needs load only then (the lobby alone never
// downloads them): the statistics tabs read config / bands / bonds / assets only.

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';
import { html, Icon, MicroLabel, Spinner, Button, confirmDialog } from '../ui/components.js';
import { useGameData, makeLookups, BandIcon, BondGlyph, Img } from '../ui/gameComponents.js';
import { data, useData } from '../data.js';
import { fmtNum, diyRecordFor, cardStandIn } from '../ui/gameLogic.js';
import { useDocClass } from '../ui/device.js';
import { uiUrl, chessAvatarUrl, chessPortraitUrl, itemIconUrl } from '../ui/assetUrls.js';
import { identity } from '../net.js';
import { TITLE_HEX_SECTORS, titleSectorClip } from '../ui/titleHexagon.js';
import { store, createStore, useStore, selectRoute } from '../store.js';
import { ResultView } from './result.js';
import { toast, toastError } from '../ui/toasts.js';
import {
  loadStats, saveStats, emptyStats, importStats, exportStats, aggregateStats, countsTowardStats, selfRowOf, roundsOf, isModdedRecord,
  recordToResult, MAX_RECORDS, FULL_KEEP, IMPORT_MAX_CHARS,
  trophyMedalOf, strategyBadgeIds, bondMemberChess, highestBondRecord,
} from '../ui/stats.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Rows of 对局记录 shown at first and added by each 显示更多. */
export const HISTORY_PAGE = 50;

const statsStore = createStore({ open: false, tab: 'overview', withModded: false });

/** Open the stats viewer (title screen / lobby / room entry points). */
export function openStats() {
  data.load('config');
  data.load('bands');
  data.load('bonds');
  data.load('assets');
  statsStore.set({ open: true, tab: 'overview' });
}
export const closeStats = () => statsStore.set({ open: false });

const TABS = [
  { id: 'overview', name: N_('总览'), micro: 'OVERVIEW' },
  { id: 'bands', name: N_('盟约&策略'), micro: 'ALLIANCES / STRATEGIES' },
  { id: 'totals', name: N_('战斗累计'), micro: 'COMBAT TOTALS' },
  { id: 'history', name: N_('对局记录'), micro: 'HISTORY' },
];

const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '—');
const dateTime = (ms) => {
  if (!ms) return '—';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
/** Time played: minutes up to 99, then hours with one decimal. */
function playedText(ms) {
  const mins = Math.round((ms || 0) / 60000);
  return mins < 100 ? t('{n} 分', { n: fmtNum(mins) }) : t('{n} 小时', { n: (mins / 60).toFixed(1) });
}
const difficultyName = (d) => (DIFFICULTY_NAMES[d] ? t(DIFFICULTY_NAMES[d]) : t('未知'));

/** Save `text` as a download. Silent no-op when the browser refuses downloads. */
function downloadText(filename, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  } catch { /* ignore */ }
}

/** Read a picked file as text (`File.text()`, with a FileReader fallback for older Safari). */
function readFileText(file) {
  if (typeof file?.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result ?? ''));
    fr.onerror = () => reject(fr.error || new Error('read failed'));
    fr.readAsText(file);
  });
}

/** `stronghold-stats-20261008-2130.json` */
function exportFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `stronghold-stats-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** One labelled number card. */
function StatCard({ label, micro, value, tone }) {
  return html`<div class=${cx('st-card', tone && `st-card--${tone}`)}>
    <${MicroLabel} tone=${tone === 'gold' ? 'gold' : 'mint'}>${micro}<//>
    <b class="st-card__num num">${value}</b>
    <span class="st-card__label">${label}</span>
  </div>`;
}

function Section({ children, class: cls }) {
  return html`<section class=${cx('st-sec', cls)}>
    ${children}
  </section>`;
}

/**
 * 「含插件对局」: the aggregates take in the matches with gameplay plugins too (ui/stats.js aggregateStats `modded`;
 * DESIGN §32.6 — off by default: such a match is unofficial). Shown once there is one.
 */
function ModdedSwitch({ agg }) {
  const on = useStore((s) => s.withModded, Object.is, statsStore);
  const n = on ? null : agg.modded;
  if (!on && !agg.modded) return null;
  return html`<label class="st-modded" data-testid="stats-modded">
    <button type="button" role="switch" aria-checked=${on ? 'true' : 'false'} class=${cx('set-toggle', on && 'is-on')}
      onClick=${() => statsStore.set({ withModded: !on })}><i></i></button>
    <span>${t('含插件对局')}${n ? html` <em class="t-dim">${t('（{n} 局未计入）', { n })}</em>` : null}</span>
  </label>`;
}

/** 总览: cards, the per-difficulty table, the six titles, and the line about what counts. */
function Overview({ agg, gd, nickname, records }) {
  useData('chess', 'items', 'backups');
  const rows = DIFFICULTIES.filter((d) => agg.byDifficulty[d]).concat(Object.keys(agg.byDifficulty).filter((d) => !DIFFICULTIES.includes(d)));
  const fonts = uiUrl(gd.m, 'statistics/fontStyles');
  const titles = (Array.isArray(gd.config?.titles) ? gd.config.titles : []).map((x) => ({ ...x, count: agg.titles[x.id]?.count || 0 }));
  // records whose room mode is unknown (`roomMode` null) count in the total but in neither mode row
  const unknownMode = Math.max(0, agg.count - agg.byMode.solo.games - agg.byMode.coop.games);
  return html`<${Section} title=${t('总览')} micro="OVERVIEW">
    <${ModdedSwitch} agg=${agg} />
    ${agg.test > 0 ? html`<p class="t-dim" data-testid="stats-test-excluded">${t('测试对局不计入统计。')}</p>` : null}
    ${fonts ? html`<link rel="stylesheet" href=${fonts} />` : null}
    <div class="st-overview-details">
      <div class="st-mode-summary">
        <div class="st-profile">
          <b class="st-profile__name">Dr. ${nickname || t('未知')}</b>
          <div class="st-profile__trophies" title=${t('累计本机保留战绩中获得的奖杯')}>
            <${Img} src=${uiUrl(gd.m, `medalIcon/${trophyMedalOf(agg.trophies, gd.config?.trophies?.medals)?.iconId || ''}`)}
              class="st-profile__medal" fallback=${html`<${Icon} name="crown" />`} />
            <div><span>${t('获得奖杯')}</span><b class="num">${fmtNum(agg.trophies)}</b></div>
          </div>
        </div>
      <table class="st-modegrid"><tbody>
        ${[['solo', N_('独立模拟')], ['coop', N_('联合模拟')]].map(([mode, label]) => {
          const v = agg.byMode[mode];
          const metrics = [
            { value: v.games, label: N_('总模拟数') },
            { value: v.wins, label: N_('成功卫戍') },
            { value: v.hiddenCleared, label: N_('绝境突破') },
          ];
          return html`<tr key=${mode} class="st-modegrid__row">
            <th scope="row" class="st-modegrid__mode">
              <${Icon} name=${mode === 'solo' ? 'user' : 'users'} />
              <span class="st-modegrid__name">${t(label)}</span>
            </th>
            ${metrics.map(({ value, label }) => html`<td key=${label} class="st-modegrid__cell">
              <b class="st-modegrid__value num">${fmtNum(value)}</b>
              <span class="st-modegrid__label">${t(label)}</span>
            </td>`)}
          </tr>`;
        })}
      </tbody></table>
      ${unknownMode > 0 ? html`<p class="st-mode-unknown">${t('另有 {n} 局战绩没有记录模式，只计入总局数', { n: fmtNum(unknownMode) })}</p>` : null}
      </div>
      ${titles.length ? html`<div class="st-title-panel">
        <${TitleHexagon} titles=${titles} manifest=${gd.m} /></div>` : null}
    </div>
    <div class="st-cards">
      <${StatCard} micro="GAMES" value=${fmtNum(agg.count)} label=${t('总局数')} />
      <${StatCard} micro="WINS" value=${fmtNum(agg.wins)} label=${t('胜场')} tone="mint" />
      <${StatCard} micro="WIN RATE" value=${pct(agg.wins, agg.count)} label=${t('胜率')} tone="gold" />
      <${StatCard} micro="HIDDEN CORE" value=${fmtNum(agg.hidden.reached)} label=${t('到达隐秘核心')} />
      <${StatCard} micro="HIDDEN CLEAR" value=${fmtNum(agg.hidden.cleared)} label=${t('通关隐秘核心')} />
      <${StatCard} micro="BEST ROUND" value=${fmtNum(agg.rounds.max)} label=${t('最远回合')} />
    </div>
    <${RecordHeading} title=${t('卫戍成就')} manifest=${gd.m} class="st-record-heading--achievement" />
    <${BondAchievement} peak=${highestBondRecord(records)} gd=${gd} />
    <${MatchRecords} maxima=${agg.maxima} manifest=${gd.m} />
    <p class="st-rule">${t('单局纪录按已结算对局统计；击败数包含联防实际击杀，旧战绩无法补算。')}</p>
    ${rows.length ? html`<div class="st-tablewrap"><table class="st-table">
      <thead><tr><th>${t('难度')}</th><th class="num">${t('局数')}</th><th class="num">${t('胜场')}</th><th class="num">${t('胜率')}</th><th class="num">${t('隐秘核心通关')}</th></tr></thead>
      <tbody>
        ${rows.map((d) => {
          const v = agg.byDifficulty[d];
          return html`<tr key=${d}>
            <td class="st-diff" style=${`--d-color:${DIFFICULTY_COLORS[d] || 'var(--text-lo)'}`}>${difficultyName(d)}</td>
            <td class="num">${fmtNum(v.games)}</td>
            <td class="num">${fmtNum(v.wins)}</td>
            <td class="num">${pct(v.wins, v.games)}</td>
            <td class="num">${fmtNum(v.hiddenCleared)}</td>
          </tr>`;
        })}
      </tbody>
    </table></div>` : null}
    <p class="st-rule"><${Icon} name="info" />${t('计入统计：打到结算的对局，以及中途退出前至少清完 1 个回合的对局；更早退出的对局只留在对局记录里。')}${agg.excluded
      ? html` <b>${t('另有 {n} 局未计入统计', { n: agg.excluded })}</b>` : null}${agg.modded
      ? html` ${t('使用改变玩法插件的对局为非官方对局，默认不计入总览。')}` : null}</p>
  <//>`;
}

function RecordHeading({ title, manifest, class: cls }) {
  return html`<h3 class=${cx('st-record-heading', cls)} style=${`background-image:url(${uiUrl(manifest, 'statistics/headingBar')})`}>
    <span class="st-record-heading__icon" aria-hidden="true">
      <${Img} src=${uiUrl(manifest, 'statistics/headingIconFrame')} class="st-record-heading__frame" />
      <${Img} src=${uiUrl(manifest, 'statistics/headingIcon')} class="st-record-heading__glyph" />
    </span><span>${title}</span>
  </h3>`;
}

function AchievementOperator({ unit, gd }) {
  const base = gd.chess(unit.id);
  const backups = data.get('backups');
  const chess = unit.diy && base ? diyRecordFor(base, unit.diy, { chess: data.get('chess'), backups })
    : base ? cardStandIn(base, { unit, backups }) || base : null;
  const portrait = chess ? chessPortraitUrl(gd.m, { ...chess, assets: { ...chess.assets,
    portrait: `${chess.charId}_${chess.status?.phase === 2 ? 2 : 1}` } }) : null;
  return html`<li class="st-achievement-unit" title=${chess?.name || unit.id}>
    <${Img} src=${portrait} class="st-achievement-unit__portrait" fallback=${html`<span>${chess?.name || unit.id}</span>`} />
    <${Img} src=${uiUrl(gd.m, `statistics/achievementTier${unit.tier || chess?.tier}`)} class="st-achievement-unit__tier" />
    ${chess?.status ? html`<div class="st-achievement-unit__level">
      <${Img} src=${uiUrl(gd.m, `statistics/achievementElite${chess.status.phase}`)} />
      <span>${fmtNum(chess.status.level)}</span>
    </div>` : null}
    <div class="st-achievement-unit__items">${Array.from({ length: 2 }, (_, i) => html`<div key=${i} class="st-achievement-unit__slot"
      style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementItemSlot')})`}>
      ${unit.items?.[i] ? html`<${Img} src=${itemIconUrl(gd.m, gd.item(unit.items[i]))} class="st-achievement-unit__item" />` : html`<i aria-hidden="true"></i>`}
    </div>`)}</div>
  </li>`;
}

function BondAchievement({ peak, gd }) {
  if (!peak) return html`<p class="st-hint">${t('暂无可用的盟约最高叠加战绩')}</p>`;
  const bonds = (peak.player.bonds || []).filter((b) => b.active).sort((a, b) => b.layers - a.layers);
  return html`<div class="st-achievement">
    <div class="st-achievement__peak">
      <span class="st-achievement__caption">${t('战果纪录')}</span>
      <div class="st-achievement__bond" style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBondFrame')})`}><${BondGlyph} bondId=${peak.bond.bondId} /></div>
      <span>${t('盟约最高叠加')}</span><b class="num">${fmtNum(peak.bond.layers)}</b>
    </div>
    <div class="st-achievement__detail" style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBg')})`}>
      <ul class="st-achievement__lineup">${Array.from({ length: 10 }, (_, i) => peak.player.lineup?.[i]
        ? html`<${AchievementOperator} key=${i} unit=${peak.player.lineup[i]} gd=${gd} />`
        : html`<li key=${i} class="st-achievement-unit is-empty" aria-hidden="true"><i></i><span>${t('NO INFO')}</span>
          <div class="st-achievement-unit__items"><div class="st-achievement-unit__slot"><i></i></div><div class="st-achievement-unit__slot"><i></i></div></div>
        </li>`)}</ul>
      <ul class="st-achievement__bonds">${bonds.map((bond) => html`<li key=${bond.bondId} title=${gd.bond(bond.bondId)?.name || bond.bondId}
        style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBondTile')})`}>
        <${BondGlyph} bondId=${bond.bondId} />${gd.bond(bond.bondId)?.noStack ? null : html`<b class="num">${fmtNum(bond.layers)}</b>`}
      </li>`)}</ul>
    </div>
  </div>`;
}

/** The official statistics view fills and highlights counts at 20 awards. */
function TitleHexagon({ titles, manifest }) {
  const byId = new Map(titles.map((x) => [x.id, x]));
  const mask = uiUrl(manifest, 'statistics/titleMask');
  const glow = uiUrl(manifest, 'statistics/countGlow');
  const [loadedArt, setLoadedArt] = useState([]);
  useEffect(() => {
    let active = true;
    const images = [mask, glow].filter(Boolean).map((url) => {
      const image = new Image();
      image.onload = () => { if (active) setLoadedArt((loaded) => loaded.includes(url) ? loaded : [...loaded, url]); };
      image.src = url;
      return image;
    });
    return () => { active = false; for (const image of images) image.onload = null; };
  }, [mask, glow]);
  return html`<div class=${cx('st-titlehex', mask && loadedArt.includes(mask) && 'has-reference-mask')} role="group" aria-label=${t('称号')}
    style=${{ '--st-title-mask': mask ? `url("${mask}")` : undefined, '--st-title-glow': glow && loadedArt.includes(glow) ? `url("${glow}")` : undefined }}>
    <div class="st-titlehex__graphic" aria-hidden="true">
      ${TITLE_HEX_SECTORS.map(([id, angle]) => {
        const clip = titleSectorClip(byId.get(id)?.count || 0);
        return html`<div key=${id} class="st-titlehex__wedge"
          style=${{ '--sector-angle': `${angle}deg`, '--texture-angle': `${-angle}deg` }}>
          <div class="st-titlehex__base"></div>
          ${clip ? html`<div class="st-titlehex__active"><div class="st-titlehex__sector" style=${{ clipPath: clip }}>
            <div class="st-titlehex__texture"></div>
          </div></div>` : null}
        </div>`;
      })}
      <${Img} src=${uiUrl(manifest, 'statistics/decoration')} class="st-titlehex__decoration" />
    </div>
    <ul class="st-titlehex__labels">
      ${TITLE_HEX_SECTORS.map(([id], i) => {
        const x = byId.get(id);
        return x ? html`<li key=${id} class=${cx('st-titlehex__label', `st-titlehex__label--${i}`)} title=${x.text || ''}>
          <b class=${cx('st-titlehex__count num', x.count >= 20 && 'is-bright')}>${fmtNum(x.count)}</b><span class="st-titlehex__name">${x.name}</span>
        </li>` : null;
      })}
    </ul>
  </div>`;
}

/** Single-match records, always in the requested funds / promotions / defeats order. */
function MatchRecords({ maxima, manifest }) {
  const rows = [
    ['gold', N_('单局最多消耗资金'), 'recordFunds'],
    ['merges', N_('单局最多晋升次数'), 'recordPromotions'],
    ['kills', N_('单局最多击败数'), 'recordDefeats'],
  ];
  return html`<div class="st-records" data-testid="stats-match-records">
    ${rows.map(([key, label, art]) => html`<div key=${key} class=${`st-record st-record--${key}`}>
      <${Img} src=${uiUrl(manifest, `statistics/${art}`)} class="st-record__icon" />
      <${Img} src=${uiUrl(manifest, 'statistics/recordLabel')} class="st-record__decoration" />
      <span class="st-record__label">${t(label)}</span>
      <div class="st-record__value num"><span aria-hidden="true">x</span><b>${maxima[key] == null ? '—' : fmtNum(maxima[key])}</b></div>
    </div>`)}
  </div>`;
}

/** 盟约&策略: top-three active settlement alliances and strategies, followed by the existing strategy table. */
function Bands({ agg, gd, records }) {
  useData('chess');
  const fonts = uiUrl(gd.m, 'statistics/fontStyles');
  const badges = strategyBadgeIds(records, data.get('bands'));
  const rows = Object.entries(agg.bands).sort((a, b) => (b[1].games - a[1].games) || (b[1].wins - a[1].wins));
  const bonds = Object.entries(agg.bonds).sort((a, b) => (b[1].games - a[1].games) || a[0].localeCompare(b[0]));
  const members = bondMemberChess(gd.list('chess'), bonds[0]?.[0]);
  return html`<${Section} title=${t('盟约&策略')} micro="ALLIANCES / STRATEGIES">
    ${fonts ? html`<link rel="stylesheet" href=${fonts} />` : null}
    <${RecordHeading} title=${t('盟约记录')} manifest=${gd.m} />
    <h4 class="st-sub st-favorites__heading">${t('最常使用的盟约')}</h4>
    ${bonds.length ? html`<div class="st-top-bonds">
      ${bonds.slice(0, 3).map(([bondId], index) => {
        const name = gd.bond(bondId)?.name || bondId;
        return html`<div key=${bondId} class="st-top-bond">
          <div class="st-top-bond__art">
            <${Img} src=${uiUrl(gd.m, 'statistics/bondTopFrame')} class="st-bond-frame" />
            <${BondGlyph} bondId=${bondId} />
            <span class="st-top-bond__rank">${t('TOP{n}', { n: index + 1 })}</span>
          </div>
          <div class="st-top-bond__text">
            <span class="st-top-bond__name" title=${name}>${name}</span>
          </div>
        </div>`;
      })}
    </div>` : html`<p class="st-hint">${t('暂无盟约使用记录')}</p>`}
    ${bonds.length ? html`<h4 class="st-sub st-bond-members__heading">${t('盟约下干员为：')}</h4>
      <ul class="st-bond-members">
        ${members.map((chess) => html`<li key=${`${chess.charId}#${chess.tier}`} class="st-bond-member" title=${chess.name}
          style=${`background-image:url(${uiUrl(gd.m, 'statistics/memberFrame')})`}>
          <${Img} src=${chessAvatarUrl(gd.m, chess)} class="st-bond-member__avatar" fallback=${html`<span>${chess.name}</span>`} />
          <${Img} src=${uiUrl(gd.m, `statistics/memberTier${chess.tier}`)} class="st-bond-member__tier" />
        </li>`)}
      </ul>` : null}
    <${RecordHeading} title=${t('策略记录')} manifest=${gd.m} class="st-record-heading--strategy" />
    ${rows.length ? html`<h4 class="st-sub st-strategies__heading">${t('最常使用的策略')}</h4>
      <div class="st-top-strategies">
        ${rows.slice(0, 3).map(([bandId, v], index) => {
          const name = gd.band(bandId)?.name || bandId;
          return html`<div key=${bandId} class="st-top-strategy">
            <div class="st-top-strategy__art">
              <${Img} src=${uiUrl(gd.m, 'statistics/strategyTopFrame')} class="st-strategy-frame" />
              <${BandIcon} bandId=${bandId} />
              <span class="st-top-strategy__rank">${t('TOP{n}', { n: index + 1 })}</span>
            </div>
            <div class="st-top-strategy__text">
              <span class="st-top-strategy__name" title=${name}>${name}</span>
              <div class="st-top-strategy__count num" title=${t('使用局数')}><span aria-hidden="true">x</span><b>${fmtNum(v.games)}</b></div>
            </div>
          </div>`;
        })}
      </div>` : null}
    ${badges.length ? html`<h4 class="st-sub st-strategies__heading">${t('已获得特殊标识的策略')}</h4>` : null}
    ${badges.length ? html`<ul class="st-strategy-badges">
      ${badges.map((bandId) => {
        const name = gd.band(bandId)?.name || bandId;
        return html`<li key=${bandId} class="st-strategy-badge">
          <div class="st-strategy-badge__art">
            <${Img} src=${uiUrl(gd.m, 'statistics/strategyBadgeFrame')} class="st-strategy-frame" />
            <${BandIcon} bandId=${bandId} />
            <${Img} src=${uiUrl(gd.m, 'statistics/strategyBadge')} class="st-strategy-badge__mark" />
          </div>
          <span class="st-strategy-badge__name" title=${name}>${name}</span>
        </li>`;
      })}
    </ul>` : html`<p class="st-hint">${t('暂无获得特殊标识的策略')}</p>`}
    ${rows.length ? html`<div class="st-tablewrap"><table class="st-table">
      <thead><tr><th>${t('策略')}</th><th class="num">${t('使用局数')}</th><th class="num">${t('通过局数')}</th><th class="num">${t('通过率')}</th></tr></thead>
      <tbody>
        ${rows.map(([bandId, v]) => {
          const band = gd.band(bandId);
          const rate = v.games > 0 ? Math.round((v.wins / v.games) * 100) : 0;
          return html`<tr key=${bandId}>
            <td><span class="st-band">${band?.name || bandId}</span></td>
            <td class="num">${fmtNum(v.games)}</td>
            <td class="num">${fmtNum(v.wins)}</td>
            <td class="num st-rate"><span class="st-bar" aria-hidden="true"><i style=${`width:${rate}%`}></i></span><b>${pct(v.wins, v.games)}</b></td>
          </tr>`;
        })}
      </tbody>
    </table></div>` : html`<p class="st-empty">${t('还没有记录 —— 完成一局对局后，这里会开始积累。')}</p>`}
  <//>`;
}

const SUM_ROWS = [
  ['kills', N_('击倒敌人')], ['bossDamage', N_('领袖伤害')], ['dmgDealt', N_('造成伤害')], ['activatedLayers', N_('盟约层数')],
  ['merges', N_('晋升次数')], ['itemsEquipped', N_('配发装备')], ['gold', N_('消耗资金')], ['perfectRounds', N_('完美作战')],
  ['refreshes', N_('刷新次数')], ['leaks', N_('未击倒')], ['lpLost', N_('损失生命')],
];

/** 战斗累计: accumulated time played and the self player's sums over the settled matches. */
function CombatSums({ agg }) {
  const rows = SUM_ROWS.filter(([k]) => Number.isFinite(agg.sums[k]));
  return html`<${Section} title=${t('战斗累计')} micro="COMBAT TOTALS">
    <div class="st-sums">
      <div class="st-sum"><span>${t('累计时长')}</span><b class="num">${playedText(agg.duration.totalMs)}</b></div>
      ${rows.map(([k, label]) => html`<div key=${k} class="st-sum"><span>${t(label)}</span><b class="num">${fmtNum(agg.sums[k])}</b></div>`)}
    </div>
  <//>`;
}

/** One 对局记录 row: what it was, who won, whether it counted and whether the settlement can be re-viewed. */
function HistoryRow({ rec, gd, onOpen }) {
  const self = selfRowOf(rec);
  const quit = rec.end === 'quit';
  const counted = countsTowardStats(rec);
  const won = self ? !!self.victory : !!rec.victory;
  const band = self?.bandId ? gd.band(self.bandId) : null;
  const rounds = roundsOf(rec);
  const known = Number.isFinite(self?.roundsPassed) || Number.isFinite(rec.roundsPassed);
  const view = !quit && !rec.compact; // a quit has nothing settled; a compacted record no rows left
  const open = () => onOpen(rec);
  return html`<tr class=${cx(quit ? 'is-quit' : won ? 'is-win' : 'is-lose', !counted && 'is-excluded', view && 'is-clickable')}
      title=${view ? t('点击查看该局结算') : !counted ? t('没有清完第一个回合就退出，不计入统计') : quit ? t('中途退出的对局没有结算可看') : t('较早的对局只保留汇总，不能回看结算')}
      tabIndex=${view ? 0 : undefined}
      onClick=${view ? open : undefined} onKeyDown=${view ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}>
    <td class="st-t">${dateTime(rec.t)}</td>
    <td>${difficultyName(rec.difficulty)}</td>
    <td>${rec.roomMode === 'solo' ? t('单人') : rec.roomMode === 'coop' ? t('同盟') : '—'}</td>
    <td><span class="st-band">${band ? html`<${BandIcon} bandId=${band.bandId} size="xs" />${band.name}` : self?.bandId || '—'}</span></td>
    <td class="st-res">${quit ? html`<span class="t-quit">${t('中途退出')}</span>` : html`<span class=${won ? 't-win' : 't-lose'}>${won ? t('胜') : t('负')}</span>`}
      ${!counted ? html`<em class="st-chip">${t('不计入统计')}</em>` : null}
      ${isModdedRecord(rec) ? html`<em class="st-chip is-modded" title=${(rec.content.plugins || []).join(', ')}>${t('非官方')}</em>` : null}</td>
    <td class="num">${known ? fmtNum(rounds) : '—'}</td>
    <td class="st-go" aria-hidden="true">${view ? html`<${Icon} name="chevronRight" />` : null}</td>
  </tr>`;
}

/** 对局记录: every stored match, newest first, HISTORY_PAGE rows at a time. */
function History({ records, gd, onOpen }) {
  const [shown, setShown] = useState(HISTORY_PAGE);
  const rows = records.slice(0, shown);
  return html`<${Section} title=${t('对局记录')} micro=${`HISTORY · ${records.length}`}>
    ${rows.length ? html`<div class="st-tablewrap"><table class="st-table st-table--history">
      <thead><tr><th>${t('时间')}</th><th>${t('难度')}</th><th>${t('模式')}</th><th>${t('策略')}</th><th>${t('结果')}</th><th class="num">${t('回合')}</th><th aria-hidden="true"></th></tr></thead>
      <tbody>${rows.map((r) => html`<${HistoryRow} key=${r.id} rec=${r} gd=${gd} onOpen=${onOpen} />`)}</tbody>
    </table></div>
    ${records.length > shown ? html`<div class="st-more"><${Button} size="sm" variant="secondary" onClick=${() => setShown(shown + HISTORY_PAGE)}>${t('显示更多（还有 {n} 局）', { n: records.length - shown })}<//></div>` : null}
    <p class="st-hint">${t('点击一行，回看该局结算；中途退出的对局只留记录。')} ${t('最多保留最近 {max} 局，最新的 {full} 局及盟约最高叠加战绩能回看结算。', { max: MAX_RECORDS, full: FULL_KEEP })}</p>`
      : html`<p class="st-empty">${t('还没有记录 —— 完成一局对局后，这里会开始积累。')}</p>`}
  <//>`;
}

/** A stored match re-viewed as its settlement screen: the full game data is loaded now (the lobby alone never loads it). */
function Replay({ rec, onBack }) {
  const gd = useGameData();
  const res = useMemo(() => recordToResult(rec), [rec]);
  if (!gd.ready) return html`<div class="st-loading"><${Spinner} size="md" /></div>`;
  return html`<${ResultView} res=${res} pub=${null} myId=${rec.selfId} backLabel=${t('返回统计')} onBack=${onBack} quiet=${true}
    content=${rec.content ? { cs: rec.content.cs, vanilla: false, plugins: rec.content.plugins } : null} />`;
}

/** The overlay, rendered while open (its data hooks run only then). */
function StatsScreen({ tab }) {
  const ready = useData('config', 'bands', 'bonds', 'assets');
  const gd = useMemo(() => makeLookups(ready), [ready, data.locale()]);
  const [stats, setStats] = useState(() => loadStats());
  const [replay, setReplay] = useState(null);
  const boxRef = useRef(null);
  const fileRef = useRef(null);
  const replayRef = useRef(null);
  replayRef.current = replay;
  const inMatch = useStore((s) => selectRoute(s) === 'game');
  const nickname = useStore((s) => s.me.name);
  useDocClass('sp-stats-open');

  // a match starting (the host pressed 开始) takes the player to its briefing: the overlay must not sit on top of it
  useEffect(() => { if (inMatch) closeStats(); }, [inMatch]);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || document.querySelector('.modal')) return; // a confirm dialog on top takes the Esc
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (replayRef.current) setReplay(null); else closeStats();
    };
    window.addEventListener('keydown', onKey, true);
    const timer = setTimeout(() => boxRef.current?.focus?.(), 30);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(timer); };
  }, []);

  const withModded = useStore((s) => s.withModded, Object.is, statsStore);
  const agg = useMemo(() => aggregateStats(stats.records, { modded: withModded }), [stats, withModded]);
  const reload = () => setStats(loadStats());

  const doExport = () => {
    try {
      const payload = exportStats(stats);
      downloadText(exportFilename(), JSON.stringify(payload));
      toast(t('已导出 {n} 条对局记录', { n: payload.records.length }), 'success');
    } catch (err) {
      toastError(err);
    }
  };
  const doFile = async (e) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // allow re-picking the same file
    if (!file) return;
    if (file.size > IMPORT_MAX_CHARS) { toast(t('文件过大，无法导入'), 'error'); return; }
    try {
      const raw = JSON.parse(await readFileText(file));
      const { stats: merged, added, skipped, dropped, name } = importStats(raw, loadStats());
      if (added && !saveStats(merged)) { toast(t('无法写入本机存储，可能已满'), 'error'); return; }
      if (!store.get().me.name && name) {
        identity.saveName(name);
        store.patch('me', { name });
      }
      reload();
      const tail = (skipped ? t('（跳过重复 {skipped} 条）', { skipped }) : '') + (dropped ? t('（{n} 条无法读取）', { n: dropped }) : '');
      toast(added ? t('已导入 {added} 条记录{tail}', { added, tail }) : t('没有新记录（全部与现有数据重复）'), 'success');
    } catch (err) {
      toast(err?.code === 'stats-newer-version' ? t('导入失败：这份文件由更新版本的客户端导出，请先升级客户端') : t('导入失败：不是有效的统计导出文件'), 'error');
    }
  };
  const doClear = async () => {
    const ok = await confirmDialog({
      title: t('清空统计数据'), micro: 'CLEAR STATISTICS', danger: true, okText: t('清空'),
      text: t('将删除本机保存的 {n} 条对局记录，无法恢复。', { n: stats.records.length }),
    });
    if (!ok) return;
    if (!saveStats(emptyStats())) { try { globalThis.localStorage?.removeItem('sp.pref.stats'); } catch { /* ignore */ } }
    reload();
    toast(t('已清空本机统计数据'), 'success');
  };

  if (replay) return html`<div class="st st--replay" ref=${boxRef} tabindex="-1" role="dialog" aria-modal="true" aria-label=${t('统计数据')}>
    <${Replay} rec=${replay} onBack=${() => setReplay(null)} />
  </div>`;

  const tabInfo = TABS.find((x) => x.id === tab) || TABS[0];
  const empty = !stats.records.length;
  return html`<div class="st" role="dialog" aria-modal="true" aria-label=${t('统计数据')} tabindex="-1" ref=${boxRef}>
    <div class="st__bg" aria-hidden="true"></div>
    <header class="st-top">
      <div class="st-top__left">
        <${Button} variant="ghost" size="md" icon="chevronLeft" class="st-back" onClick=${closeStats} aria-label=${t('返回')} title=${t('返回 (Esc)')}>${t('返回')}<//>
      </div>
      <div class="st-top__center">
        <${MicroLabel} tone="mint">STATISTICS // ${tabInfo.micro}<//>
        <div class="st-tabs" role="tablist" aria-label=${t('统计数据')}>
          ${TABS.map((x) => html`<button key=${x.id} type="button" role="tab" aria-selected=${x.id === tab ? 'true' : 'false'} data-tab=${x.id}
            class=${cx('st-tab', x.id === tab && 'is-on')} onClick=${() => statsStore.set({ tab: x.id })}>${t(x.name)}</button>`)}
        </div>
      </div>
      <div class="st-top__right">
        <${Button} variant="ghost" size="sm" data-testid="stats-export" disabled=${empty || stats.newer} onClick=${doExport} title=${t('导出为文件（可在别的设备上导入）')}>${t('导出')}<//>
        <${Button} variant="ghost" size="sm" data-testid="stats-import" disabled=${stats.newer} onClick=${() => fileRef.current?.click()} title=${t('从导出的文件导入（与现有记录合并）')}>${t('导入')}<//>
        <input ref=${fileRef} type="file" accept="application/json,.json" hidden onChange=${doFile} />
        <${Button} variant="secondary" size="sm" data-testid="stats-clear" disabled=${empty || stats.newer} onClick=${doClear} title=${t('清空本机的统计数据')}>${t('清空')}<//>
      </div>
    </header>
    <p class="st-note"><${Icon} name="info" />${t('本机数据：只保存在这个浏览器里，不会上传到服务器；同盟对局里队友的代号也会存在本机（导出文件里也有）。')}</p>
    ${stats.damaged ? html`<p class="st-note is-warn"><${Icon} name="warn" />${t('本机保存的统计数据无法读取，已另存为备份，从现在起重新记录。')}</p>` : null}
    ${stats.dropped ? html`<p class="st-note is-warn"><${Icon} name="warn" />${t('有 {n} 条记录已损坏，已忽略。', { n: stats.dropped })}</p>` : null}
    <div class="ui-slot" data-ui-slot="stats.tab" aria-label=${t('界面插件')} dangerouslySetInnerHTML=${{ __html: '' }}></div>
    <main class="st-body" data-tab=${tab}>
      ${!ready ? html`<div class="st-loading"><${Spinner} size="md" /></div>`
        : stats.newer ? html`<p class="st-empty">${t('检测到更新版本的统计数据，请先升级客户端再查看，以免覆盖数据。')}</p>`
          : empty ? html`<p class="st-empty">${t('还没有记录 —— 完成一局对局后，这里会开始积累。')}</p>`
            : tab === 'bands' ? html`<${Bands} agg=${agg} gd=${gd} records=${stats.records} />`
              : tab === 'totals' ? html`<${CombatSums} agg=${agg} />`
                : tab === 'history' ? html`<${History} records=${stats.records} gd=${gd} onOpen=${setReplay} />`
                  : html`<${Overview} agg=${agg} gd=${gd} nickname=${nickname} records=${stats.records} />`}
    </main>
  </div>`;
}

/** Global stats viewer host — mounted once by main.js; renders nothing (and loads nothing) until opened. */
export function StatsHost() {
  const { open, tab } = useStore((s) => s, Object.is, statsStore);
  if (!open) return null;
  return html`<${StatsScreen} tab=${tab} />`;
}

