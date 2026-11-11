// The local stats viewer (统计数据): this browser's record of the matches the player took part in — see ui/stats.js for
// what is recorded, what counts and how the storage is bounded. A full-screen overlay opened imperatively from the
// title screen / lobby / room (`openStats()`); <StatsHost/> is mounted once by main.js. Ported from PR #323 by
// @2321Robin; reworked for 0.2.2 in the grammar of 干员调配 (top bar with tabs, a note line, a scrolling body).
//
//   总览      – games, wins, win rate, hidden-core reaches / clears, best round; the difficulties; the six
//               评语 (titles) with their counts; what counts and what was left out
//   总览下方   – top three most used active settlement alliances and strategies; per strategy: games / passed / rate
//   战斗累计  – time played; the player's summed combat bookkeeping of the settled matches
//   对局记录  – every stored match, newest first. A settled row re-views that match's settlement screen (the record is
//               inverted into an m.result payload for <ResultView/>); a match given up early is marked 中途退出 and,
//               when it did not count, 不计入统计
// Everything is 本机数据 (localStorage, `sp.pref.stats`) and the page says so, teammates' names included. 导出 / 导入 (a
// JSON file, merged by record id on the way in) moves it between devices; 清空 resets it after a confirm dialog.
// The host renders nothing until opened and the game data files the replay needs load only then (the lobby alone never
// downloads them): the statistics tabs read config / bands / bonds / assets only.
// Official versions (DESIGN §35.23, M1): a version filter above the tabs — the version the page shows by default, every
// version that has records, and 全部版本 — narrows every tab (ui/stats.js recordsOfVersion); a row of another version
// carries its tag (ui/pluginTag.js VersionTag). Re-viewing a settlement needs that version's data on the page: outside a
// room the row offers 切换到「X」查看 (the page shows that version while the replay is open — the store's `replayVersion`,
// versions.js shownVersion — and the settlement opens once its data is checked; closing the replay or 统计数据 clears it,
// the lobby preference is never touched); in a room it says the room's version decides the data; a version this server
// does not offer (welcome.versions, e.g. a server narrowed to 第二期下半) is not offered as a switch. The replay's wait always keeps
// 返回统计 (a failed version set offers 重试). A replay opened in a room sets `replayVersion` too (the room's version comes
// first, so nothing changes while seated): a room left under the open replay keeps that version shown.
// 成就统计 counts the season of the version shown. 盟约记录's peak lineup (chess and item ids) is drawn only with the data
// of its own version: a peak of another version (the filter on another version or 全部版本, or 成就统计's other half of
// the season) shows its alliance and layers, and 切换到「X」查看 in place of the operators and gear — chess and item ids
// are reused across versions for other operators and items (第一期下半: 100 chess ids, 72 item ids; review fix).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS } from '../../../shared/constants.js';
import { html, Icon, Spinner, Button, Modal, confirmDialog } from '../ui/components.js';
import { useGameData, makeLookups, BandIcon, BondGlyph, Img } from '../ui/gameComponents.js';
import { data, useData, createDataStore } from '../data.js';
import { fmtNum, diyRecordFor, cardStandIn } from '../ui/gameLogic.js';
import { useDocClass } from '../ui/device.js';
import { uiUrl, chessPortraitUrl, itemIconUrl } from '../ui/assetUrls.js';
import { identity } from '../net.js';
import { titleSectorClip } from '../ui/titleHexagon.js';
import { store, createStore, useStore, selectRoute } from '../store.js';
import { ResultView } from './result.js';
import { EmptyTopRecords } from '../ui/statsEmpty.js';
import { LegacyStats } from './statsLegacy.js';
import { toast, toastError } from '../ui/toasts.js';
import {
  loadStats, peekStatsRecords, saveStats, emptyStats, importStats, exportStats, aggregateStats, countsTowardStats, selfRowOf, roundsOf, isModdedRecord,
  recordToResult, MAX_RECORDS, FULL_KEEP, IMPORT_MAX_CHARS,
  trophyMedalOf, strategyBadgeIds, highestBondRecord, highestBondLayers, achievementRecords, recordVersion, recordsOfSeason, recordsForStatsTab, aggregateStatsBySeason,
} from '../ui/stats.js';
import { t, N_ } from '../../../shared/i18n.js';
import { scriptOf } from '../../../shared/i18nPacks.js';
import { VersionTag } from '../ui/pluginTag.js';
import { contentSet, retryContentSet } from '../content.js';
import { DEFAULT_VERSION, shownVersion, seasonOf, versionLabel, welcomeVersion } from '../versions.js';
import { VERSIONS, versionById, LOBBY_DEFAULT_VERSION } from '../../../shared/versions.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Rows of 对局记录 shown at first and added by each 显示更多. */
export const HISTORY_PAGE = 50;

// `version`: the version filter (null: the version the page shows; 'all': every record — DESIGN §35.23)
const statsStore = createStore({ open: false, tab: 'overview', withModded: false, version: null });

/** Open the stats viewer (title screen / lobby / room entry points). */
export function openStats() {
  data.load('config');
  data.load('bands');
  data.load('bonds');
  data.load('assets');
  statsStore.set({ open: true, tab: 'overview' });
}
export const closeStats = () => statsStore.set({ open: false });
/**
 * Whether 统计数据 is open (the lobby's 成就统计 card reads the records again when it closes; main.js floats the room's
 * version vote above it, ui/versionVote.js CoveredVersionVote).
 */
export const useStatsOpen = () => useStore((s) => s.open, Object.is, statsStore);

const TABS = [
  { id: 'overview', name: N_('成就统计') },
	{ id: 'pastSeasons', name: N_('过往赛季') },
  { id: 'totals', name: N_('战斗累计') },
  { id: 'history', name: N_('对局记录') },
];

const pct = (n, d) => (d > 0 ? `${Math.round((n / d) * 100)}%` : '0%');
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

/** The doctor's line (name, trophies), the solo / co-op rows and the six titles: 总览 and the lobby's 成就统计. */
function ProfileBlock({ agg, gd, nickname }) {
	const solo = agg.byMode.solo, coop = agg.byMode.coop;
	const breakthrough = agg.modeBreakthrough;
	const metrics = [
		{ value: fmtNum(solo.games), label: N_('总模拟数') },
		{ value: fmtNum(solo.wins), label: N_('成功卫戍') },
		{ value: breakthrough.solo.highestDifficulty ? difficultyName(breakthrough.solo.highestDifficulty) : t('尚未通关'), label: N_('极限突破'), difficulty: true },
		{ value: fmtNum(breakthrough.solo.abyssWins), label: N_('极限胜场') },
		{ value: fmtNum(coop.games), label: N_('总模拟数') },
		{ value: fmtNum(coop.wins), label: N_('成功卫戍') },
		{ value: fmtNum(breakthrough.coop.hardWins), label: N_('绝境突破') },
		{ value: fmtNum(breakthrough.coop.abyssWins), label: N_('终极突破') },
	];
	return html`<div class="st-overview-details">
		<div class="st-mode-summary">
			<${RecordHeading} icon="headingSequence" title=${t('序列数据')} manifest=${gd.m} />
			<div class="st-modegrid-scroll"><table class="st-modegrid">
				<thead><tr>${[['solo', N_('独立模拟')], ['coop', N_('联合模拟')]].map(([mode, label]) => html`<th key=${mode} colspan="4" scope="colgroup" class="st-modegrid__mode">
					<${Icon} name=${mode === 'solo' ? 'user' : 'users'} /><span class="st-modegrid__name">${t(label)}</span>
				</th>`)}</tr></thead>
				<tbody><tr class="st-modegrid__row">${metrics.map(({ value, label, difficulty }, i) => html`<td key=${i} class="st-modegrid__cell">
					<b class=${cx('st-modegrid__value', difficulty ? 'st-modegrid__difficulty' : 'num')}>${value}</b>
					<span class="st-modegrid__label">${t(label)}</span>
				</td>`)}</tr></tbody>
			</table></div>
		</div>
		<div class="st-title-panel">
			<${RecordHeading} icon="headingSocial" title=${t('社交数据')} manifest=${gd.m} />
			<div class="st-profile">
				<b class="st-profile__name">Dr. ${nickname || t('未知')}</b>
				<div class="st-profile__trophies" title=${t('累计本机保留战绩中获得的奖杯')}>
					<${Img} src=${uiUrl(gd.m, `medalIcon/${trophyMedalOf(agg.trophies, gd.config?.trophies?.medals)?.iconId || ''}`)} class="st-profile__medal" fallback=${html`<${Icon} name="crown" />`} />
					<div><span>${t('获得奖杯')}</span><b class="num">${fmtNum(agg.trophies)}</b></div>
				</div>
			</div>
			<div class="st-social-details"><${SocialTitleChart} manifest=${gd.m} /><${SocialTitleList} agg=${agg} manifest=${gd.m} /></div>
		</div>
	</div>`;
}

/**
 * 成就统计: profile and the six titles. `records`: the ones the
 * achievement blocks read (ui/stats.js achievementRecords — no gameplay-plugin match unless 「含插件对局」).
 */
function Overview({ agg, gd, nickname, records }) {
  useData('chess', 'items', 'backups');
  const fonts = uiUrl(gd.m, 'statistics/fontStyles');
  return html`<${Section} title=${t('成就统计')}>
    <${ModdedSwitch} agg=${agg} />
    ${agg.test > 0 ? html`<p class="t-dim" data-testid="stats-test-excluded">${t('测试对局不计入统计。')}</p>` : null}
    ${fonts ? html`<link rel="stylesheet" href=${fonts} />` : null}
    <${ProfileBlock} agg=${agg} gd=${gd} nickname=${nickname} />
    <${RecordHeading} icon="headingAchievement" title=${t('卫戍成就')} manifest=${gd.m} class="st-record-heading--achievement" />
    <${MatchRecords} maxima=${agg.count ? agg.maxima : { gold: 0, merges: 0, kills: 0 }} achievements=${agg.achievements} manifest=${gd.m} />

  <//>`;
}

function RecordHeading({ title, manifest, icon, class: cls }) {
  return html`<h3 class=${cx('st-record-heading', cls)} style=${`background-image:url(${uiUrl(manifest, 'statistics/headingBar')})`}>
    <span class="st-record-heading__icon" aria-hidden="true">
      <${Img} src=${uiUrl(manifest, 'statistics/headingIconFrame')} class="st-record-heading__frame" />
      <${Img} src=${uiUrl(manifest, `statistics/${icon}`) || uiUrl(manifest, 'statistics/headingIcon')} class="st-record-heading__glyph" />
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

/**
 * 盟约记录's peak (ui/stats.js highestBondRecord). The loaded config names the data the lookups read, even while the
 * page waits for a newly requested version. A peak of another version keeps its alliances but not its lineup.
 * @param {{ peak: ReturnType<typeof highestBondRecord>, gd: any }} props
 */
export function BondAchievement({ peak, gd }) {
  const bonds = (peak?.player?.bonds || []).filter((b) => b.active).sort((a, b) => b.layers - a.layers);
  const own = recordVersion(peak?.record);
  const sameVersion = !peak || own === (gd.config?.version?.id ?? DEFAULT_VERSION);
  const lineup = sameVersion ? peak?.player?.lineup : null;
  return html`<div class="st-achievement">
    <div class="st-achievement__peak">
      <span class="st-achievement__caption">${t('战果纪录')}</span>
      <div class="st-achievement__bond" style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBondFrame')})`}>${peak ? html`<${BondGlyph} bondId=${peak.bond.bondId} />` : null}</div>
      <span>${t('盟约最高叠加')}</span><b class="num">${fmtNum(peak?.bond?.layers || 0)}</b>
    </div>
    <div class="st-achievement__detail" style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBg')})`}>
      <ul class="st-achievement__lineup">${sameVersion ? null : html`<li class="st-achievement__other" data-testid="achievement-other-version">
        <${VersionTag} version=${own} compact=${true} />${t('切换到「{version}」查看', { version: versionLabel(own) })}</li>`}${Array.from({ length: 10 }, (_, i) => lineup?.[i]
        ? html`<${AchievementOperator} key=${i} unit=${lineup[i]} gd=${gd} />`
        : html`<li key=${i} class="st-achievement-unit is-empty" aria-hidden="true"><i></i><span>${t('NO INFO')}</span>
          <div class="st-achievement-unit__items"><div class="st-achievement-unit__slot"><i></i></div><div class="st-achievement-unit__slot"><i></i></div></div>
        </li>`)}</ul>
      <ul class="st-achievement__bonds">${!bonds.length ? [0, 1, 2].map(i => html`<li key=${i} class="is-empty" aria-hidden="true" style=${{ backgroundImage: `url("${uiUrl(gd.m, 'statistics/achievementBondTile')}")` }}></li>`) : null}${bonds.map((bond) => html`<li key=${bond.bondId} title=${gd.bond(bond.bondId)?.name || bond.bondId}
        style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBondTile')})`}>
        <${BondGlyph} bondId=${bond.bondId} />${gd.bond(bond.bondId)?.noStack ? null : html`<b class="num">${fmtNum(bond.layers)}</b>`}
      </li>`)}</ul>
    </div>
  </div>`;
}

/** Latest official six-dimensional chart. Unverified local values remain zero by maintainer decision. */
function SocialTitleChart({ manifest }) {
	const sectors = [N_('盟约理解'), N_('人力调度'), N_('装备活用'), N_('资金管理'), N_('补救能力'), N_('领袖挑战')];
	const values = sectors.map(() => 0);
	const mask = uiUrl(manifest, 'statistics/socialTitleMask');
	return html`<div class=${cx('st-titlehex', 'st-titlehex--social', mask && 'has-reference-mask')} role="group" aria-label=${t('称号')}
		style=${{ '--st-title-mask': mask ? `url("${mask}")` : undefined }}>
		<${Img} src=${uiUrl(manifest, 'statistics/socialTitleMark')} class="st-social-chart__mark" />
		<div class="st-titlehex__graphic" aria-hidden="true">
			${sectors.map((label, i) => {
				const clip = titleSectorClip(values[i], 100);
				return html`<div key=${label} class="st-titlehex__wedge" style=${{ '--sector-angle': `${i * 60}deg`, '--texture-angle': `${-i * 60}deg` }}>
					<div class="st-titlehex__base"></div>
					${clip ? html`<div class="st-titlehex__active"><div class="st-titlehex__sector" style=${{ clipPath: clip }}><div class="st-titlehex__texture"></div></div></div>` : null}
				</div>`;
			})}
			<${Img} src=${uiUrl(manifest, 'statistics/decoration')} class="st-titlehex__decoration" />
		</div>
		<ul class="st-titlehex__labels">${sectors.map((label, i) => html`<li key=${label} class=${`st-titlehex__label st-social-chart__label--${i}`}>
			<b class="st-titlehex__count num">${fmtNum(values[i])}</b>
			<span class="st-titlehex__name"><${Img} src=${uiUrl(manifest, 'statistics/socialTitleLabel')} />${t(label)}</span>
		</li>`)}</ul>
	</div>`;
}

/** Title counts use the current season's catalog, independently of lobby/replay data. */
function SocialTitleList({ agg, manifest }) {
	const source = useMemo(() => createDataStore({ base: `/data/${versionById(LOBBY_DEFAULT_VERSION)?.dir || ''}` }), []);
	const [ready, setReady] = useState(false);
	const locale = data.locale();
	useEffect(() => {
		let alive = true;
		Promise.all([source.loadAll('config'), source.setLocale(locale)]).then(() => { if (alive) setReady(true); });
		return () => { alive = false; };
	}, [source, locale]);
	if (!ready) return html`<${Spinner} size="sm" />`;
	const titles = new Map((source.get('config')?.titles || []).map(title => [title.id, title]));
	// Official rank-1/2 titles pair by category; rank-0 titles form the special group.
	const groups = [
		{ label: N_('称号一览'), ids: [2, 3, 5, 6, 8, 9, 11, 12, 14, 15, 17, 18] },
		{ label: N_('特殊称号'), ids: [1, 4, 7, 10, 13, 16] },
	];
	return html`<div class="st-social-title-groups">${groups.map(group => html`<section key=${group.label} class="st-social-titles">
		<h3 class="st-social-titles__heading"><${Img} src=${uiUrl(manifest, 'statistics/socialTitleGroupMark')} />${t(group.label)}</h3>
		<dl class="st-social-titles__list">${group.ids.map(number => titles.get(`comment_${number}`)).filter(Boolean).map(title => {
			const count = agg.titles[title.id]?.count || 0;
			return html`<div key=${title.id} class="st-social-titles__item">
				<dt><${Img} src=${uiUrl(manifest, `statistics/socialTitle_${title.id}`)} fallback=${html`<span class="st-social-titles__icon"></span>`} /><span title=${title.name}>${title.name}</span></dt>
				<dd class="num">${count > 999 ? '999+' : fmtNum(count)}</dd>
			</div>`;
		})}</dl>
	</section>`)}</div>`;
}

/** Single-match records, always in the requested funds / promotions / defeats order. */
function MatchRecords({ maxima, achievements, manifest }) {
  const rows = [
    ['gold', N_('单局最多消耗资金'), 'recordV3Funds'],
    ['merges', N_('单局最多晋升次数'), 'recordV3Promotions'],
    ['kills', N_('单局最多击败数'), 'recordV3Defeats'],
		['winStreak', N_('最高连胜'), achievements.streakMode === 'solo' ? 'recordSoloStreak' : 'recordCoopStreak'],
		['uniteKills', N_('单局最多联防击退'), 'recordUniteKills'],
		['bossShare', N_('单局最多对领袖伤害'), 'recordBossShare'],
  ];
	const values = { ...maxima, ...achievements };
  return html`<div class="st-records" data-testid="stats-match-records">
    ${rows.map(([key, label, art]) => html`<div key=${key} class=${`st-record st-record--${key}`}>
      <span class=${`st-record__icon st-record__icon--${art}`} aria-hidden="true"
			style=${{ '--st-record-mask': `url("${uiUrl(manifest, `statistics/${art}`)}")` }}></span>
      <${Img} src=${uiUrl(manifest, 'statistics/recordV3Label')} class="st-record__decoration" />
      <span class="st-record__label">${t(label)}</span>
      <div class="st-record__value num"><span aria-hidden="true">${key === 'bossShare' ? '' : 'x'}</span><b>${values[key] == null ? '—' : key === 'bossShare' ? `${Math.round(values[key] * 10) / 10}%` : fmtNum(values[key])}</b></div>
    </div>`)}
  </div>`;
}

/** 盟约记录: the three highest-stack alliances and the highest-stack match (总览 and the lobby's 成就统计). */
function BondRecords({ agg, gd, records, allSeasons = false }) {
	useData('chess', 'items', 'backups');
  const bonds = highestBondLayers(records);
  return html`<${RecordHeading} icon="headingBond" title=${t('盟约记录')} manifest=${gd.m} />
    <h4 class="st-sub st-favorites__heading">${allSeasons ? t('已激活层数最高的盟约：') : t('本序列中已激活层数最高的盟约：')}</h4>
    ${bonds.length ? html`<div class="st-top-bonds">
      ${bonds.slice(0, 3).map(([bondId, layers], index) => {
        const name = gd.bond(bondId)?.name || bondId;
        return html`<div key=${bondId} class="st-top-bond">
          <div class="st-top-bond__art">
            <${Img} src=${uiUrl(gd.m, 'statistics/bondTopFrame')} class="st-bond-frame" />
            <${BondGlyph} bondId=${bondId} />
            <span class="st-top-bond__rank">${t('TOP{n}', { n: index + 1 })}</span>
          </div>
          <div class="st-top-bond__text">
            <span class="st-top-bond__name" title=${name}>${name}</span>
			<b class="st-top-bond__layers num">${fmtNum(layers)} <small>${t('层')}</small></b>
          </div>
        </div>`;
      })}
    </div>` : html`<${EmptyTopRecords} kind="bond" manifest=${gd.m} />`}
	<h4 class="st-sub st-bond-members__heading">${allSeasons ? t('已激活盟约层数最高单局：') : t('本序列中已激活盟约层数最高单局：')}</h4>
	<${BondAchievement} peak=${highestBondRecord(records)} gd=${gd} />`;
}

/** 策略记录: the three most used strategies and the ones with the special mark (`records`: ui/stats.js achievementRecords). */
function StrategyRecords({ agg, gd, records }) {
  const badges = strategyBadgeIds(records, data.get('bands'));
  const rows = Object.entries(agg.bands).sort((a, b) => (b[1].games - a[1].games) || (b[1].wins - a[1].wins));
  return html`<${RecordHeading} icon="headingStrategy" title=${t('策略记录')} manifest=${gd.m} class="st-record-heading--strategy" />
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
      </div>` : html`<h4 class="st-sub st-strategies__heading">${t('最常使用的策略')}</h4><${EmptyTopRecords} kind="strategy" manifest=${gd.m} />`}
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
    </ul>` : null}`;
}

/** 盟约&策略: top-three active settlement alliances and strategies, in the overview. */
function Bands({ agg, gd, records, allSeasons = false }) {
  useData('chess');
  const fonts = uiUrl(gd.m, 'statistics/fontStyles');
  return html`<${Section} title=${t('盟约&策略')} micro="ALLIANCES / STRATEGIES">
    ${fonts ? html`<link rel="stylesheet" href=${fonts} />` : null}
    <${BondRecords} agg=${agg} gd=${gd} records=${records} allSeasons=${allSeasons} />
    <${StrategyRecords} agg=${agg} gd=${gd} records=${records} />
  <//>`;
}

const SUM_ROWS = [
  ['kills', N_('击倒敌人')], ['bossDamage', N_('领袖伤害')], ['dmgDealt', N_('造成伤害')], ['activatedLayers', N_('盟约层数')],
  ['merges', N_('晋升次数')], ['itemsEquipped', N_('配发装备')], ['gold', N_('消耗资金')], ['perfectRounds', N_('完美作战')],
  ['refreshes', N_('刷新次数')], ['leaks', N_('未击倒')], ['lpLost', N_('损失生命')],
];

/** Resolve each season's strategy names from its own data without changing the game content set. */
function SeasonStrategies({ group }) {
	const source = useMemo(() => createDataStore({ base: `/data/${versionById(group.version)?.dir || ''}` }), [group.version]);
	const [ready, setReady] = useState(false);
	const locale = data.locale();
	useEffect(() => {
		let alive = true;
		Promise.all([source.loadAll('bands'), source.setLocale(locale)]).then(() => { if (alive) setReady(true); });
		return () => { alive = false; };
	}, [source, locale]);
	const rows = Object.entries(group.stats.bands).sort((a, b) => b[1].games - a[1].games || b[1].wins - a[1].wins);
	if (!rows.length) return null;
	return html`<section class="st-season-strategies" data-season=${group.season}>
		<h3 class="st-sub">${versionLabel(group.version)}</h3>
		${ready ? html`<div class="st-tablewrap"><table class="st-table">
			<thead><tr><th>${t('策略')}</th><th class="num">${t('使用局数')}</th><th class="num">${t('通过局数')}</th><th class="num">${t('通过率')}</th></tr></thead>
			<tbody>${rows.map(([id, value]) => html`<tr key=${id}>
				<td><span class="st-band">${source.lookup('bands', id)?.name || id}</span></td>
				<td class="num">${fmtNum(value.games)}</td><td class="num">${fmtNum(value.wins)}</td>
				<td class="num">${pct(value.wins, value.games)}</td>
			</tr>`)}</tbody>
		</table></div>` : html`<${Spinner} size="sm" />`}
	</section>`;
}

/** 战斗累计: accumulated time played and the self player's sums over the settled matches. */
function CombatSums({ agg, records, withModded }) {
  const difficultyRows = DIFFICULTIES.concat(Object.keys(agg.byDifficulty).filter((d) => !DIFFICULTIES.includes(d)));
	const seasons = aggregateStatsBySeason(records, { modded: withModded });
  return html`<${Section} title=${t('战斗累计')} micro="COMBAT TOTALS">
    <div class="st-sums">
      <div class="st-sum"><span>${t('累计时长')}</span><b class="num">${playedText(agg.duration.totalMs)}</b></div>
      ${SUM_ROWS.map(([k, label]) => html`<div key=${k} class="st-sum"><span>${t(label)}</span><b class="num">${fmtNum(Number.isFinite(agg.sums[k]) ? agg.sums[k] : 0)}</b></div>`)}
    </div>
    ${difficultyRows.length ? html`<div class="st-tablewrap"><table class="st-table">
      <thead><tr><th>${t('难度')}</th><th class="num">${t('局数')}</th><th class="num">${t('胜场')}</th><th class="num">${t('胜率')}</th><th class="num">${t('隐秘核心通关')}</th></tr></thead>
      <tbody>
        ${difficultyRows.map((d) => {
          const v = agg.byDifficulty[d] || { games: 0, wins: 0, hiddenCleared: 0 };
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
	${seasons.map(group => html`<${SeasonStrategies} key=${group.season} group=${group} />`)}
    <p class="st-rule"><${Icon} name="info" /><span>${t('计入统计：打到结算的对局，以及中途退出前至少清完 1 个回合的对局；更早退出的对局只留在对局记录里。')}${agg.excluded
      ? html` <b>${t('另有 {n} 局未计入统计', { n: agg.excluded })}</b>` : null}${agg.modded
      ? html` ${t('使用改变玩法插件的对局为非官方对局，默认不计入总览。')}` : null}</span></p>
    <p class="st-rule"><${Icon} name="info" /><span>${t('本机数据：只保存在这个浏览器里，不会上传到服务器；同盟对局里队友的代号也会存在本机（导出文件里也有）。')}</span></p>
  <//>`;
}

/**
 * The version filter (see the header): the version shown, every version with records, 全部版本 — only once records of
 * another version exist or the server enables versions.
 */
function VersionFilter({ records, value, shown }) {
  const enabled = useStore((s) => Array.isArray(s.versions));
  const have = new Set((records || []).map(recordVersion));
  have.add(shown);
  if (!enabled && have.size < 2) return null;
  const options = [...VERSIONS.filter((v) => have.has(v.id)).map((v) => ({ id: v.id, name: versionLabel(v.id) })), { id: 'all', name: t('全部版本') }];
  return html`<div class="st-verfilter" role="radiogroup" aria-label=${t('版本')} data-testid="stats-version">
    <span class="st-verfilter__k">${t('版本')}</span>
    ${options.map((o) => html`<button key=${o.id} type="button" role="radio" aria-checked=${value === o.id ? 'true' : 'false'} data-version=${o.id}
      class=${cx('dpick__opt', value === o.id && 'is-active')} onClick=${() => statsStore.set({ version: o.id === shown ? null : o.id })}>${o.name}</button>`)}
  </div>`;
}

/**
 * Can this page show `version`'s data outside a room? 第二期下半 always (its own /data/ files); another version only when
 * this server offers it (welcome.versions: content.js loads a version set from there).
 * @param {any} s the app store's state @param {string} version
 */
const versionOffered = (s, version) => version === DEFAULT_VERSION || !!welcomeVersion(s, version);

/** One 对局记录 row: what it was, who won, whether it counted and whether the settlement can be re-viewed. */
function HistoryRow({ rec, gd, onOpen }) {
  const self = selfRowOf(rec);
  const quit = rec.end === 'quit';
  const counted = countsTowardStats(rec);
  const won = self ? !!self.victory : !!rec.victory;
  const band = self?.bandId ? gd.band(self.bandId) : null;
  const rounds = roundsOf(rec);
  const known = Number.isFinite(self?.roundsPassed) || Number.isFinite(rec.roundsPassed);
  // another version's settlement needs its data on the page (see the header): offered as a switch outside a room
  const version = recordVersion(rec);
  const shown = useStore(shownVersion);
  const inRoom = useStore((s) => !!s.room);
  const offered = useStore((s) => versionOffered(s, version));
  const other = version !== shown;
  // a quit has nothing settled; a compacted record no rows left; another version needs the lobby and this server's offer
  const view = !quit && !rec.compact && !(other && (inRoom || !offered));
  const open = () => onOpen(rec);
  return html`<tr class=${cx(quit ? 'is-quit' : won ? 'is-win' : 'is-lose', !counted && 'is-excluded', view && 'is-clickable')} data-version=${version}
      title=${!quit && !rec.compact && other ? (inRoom ? t('同盟中的数据由房间的版本决定，离开同盟后才能回看「{version}」的结算', { version: versionLabel(version) })
        : !offered ? t('这台服务器没有提供「{version}」，不能回看该局结算', { version: versionLabel(version) }) : t('切换到「{version}」查看', { version: versionLabel(version) }))
        : view ? t('点击查看该局结算') : !counted ? t('没有清完第一个回合就退出，不计入统计') : quit ? t('中途退出的对局没有结算可看') : t('较早的对局只保留汇总，不能回看结算')}
      tabIndex=${view ? 0 : undefined}
      onClick=${view ? open : undefined} onKeyDown=${view ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } } : undefined}>
    <td class="st-t">${dateTime(rec.t)}</td>
    <td>${difficultyName(rec.difficulty)}</td>
    <td>${rec.roomMode === 'solo' ? t('单人') : rec.roomMode === 'coop' ? t('同盟') : '—'}</td>
    <td><span class="st-band">${band ? html`<${BandIcon} bandId=${band.bandId} size="xs" />${band.name}` : self?.bandId || '—'}</span></td>
    <td class="st-res">${quit ? html`<span class="t-quit">${t('中途退出')}</span>` : html`<span class=${won ? 't-win' : 't-lose'}>${won ? t('胜') : t('负')}</span>`}
      ${!counted ? html`<em class="st-chip">${t('不计入统计')}</em>` : null}
      ${isModdedRecord(rec) ? html`<em class="st-chip is-modded" title=${(rec.content.plugins || []).join(', ')}>${t('非官方')}</em>` : null}
      <${VersionTag} version=${rec.version ?? null} compact=${true} class="st-chip" /></td>
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

/**
 * The replay's wait (hook-free: the tests draw it): why it cannot be drawn — the room plays another version
 * (`otherInRoom`), this server does not offer it, its set failed the check — else a spinner; 重试 for a failed set
 * outside a room; 返回统计 always.
 * @param {{ version: string, otherInRoom: boolean, offered: boolean, failed: boolean, inRoom: boolean, onBack: () => void }} props
 */
export function ReplayWait({ version, otherInRoom, offered, failed, inRoom, onBack }) {
  const label = versionLabel(version);
  const why = otherInRoom ? t('同盟中的数据由房间的版本决定，离开同盟后才能回看「{version}」的结算', { version: label })
    : !offered ? t('这台服务器没有提供「{version}」，不能回看该局结算', { version: label })
      : failed ? t('版本数据校验失败') : null;
  return html`<div class="st-loading st-replay-wait" data-testid="stats-replay-wait">
    ${why ? html`<p class=${cx('t-lo', failed && 'is-warn')}>${why}</p>`
      : html`<${Spinner} size="md" /><p class="t-lo">${version !== DEFAULT_VERSION ? t('正在载入「{version}」的数据…', { version: label }) : ''}</p>`}
    <div class="st-replay-wait__acts">
      ${failed && !inRoom ? html`<${Button} variant="primary" size="sm" data-testid="stats-replay-retry" onClick=${retryContentSet}>${t('重试')}<//>` : null}
      <${Button} variant="secondary" size="sm" icon="chevronLeft" data-testid="stats-replay-back" onClick=${onBack}>${t('返回统计')}<//>
    </div>
  </div>`;
}

/**
 * A stored match re-viewed as its settlement screen: the full game data is loaded now (the lobby alone never loads it)
 * — of the record's version, which the page loads first when it shows another (see the header). Until it can be drawn
 * the wait keeps 返回统计: the version may be one this server does not offer, the room may now play another, or the
 * version set may fail its check (重试). The record's version is the store's `replayVersion` from the moment the row is
 * opened, also in a room (where the room's version comes first, versions.js shownVersion): a room left while the replay is
 * open (kick, room closed) never moves the page to the lobby's version, so the settlement stays drawn.
 */
function Replay({ rec, onBack }) {
  const gd = useGameData();
  const res = useMemo(() => recordToResult(rec), [rec]);
  const version = recordVersion(rec);
  const versionReady = useStore((c) => (version === DEFAULT_VERSION ? c.kind !== 'version' : c.kind === 'version' && c.version === version && c.status === 'ready'), Object.is, contentSet);
  const failed = useStore((c) => version !== DEFAULT_VERSION && c.kind === 'version' && c.version === version && c.status === 'failed', Object.is, contentSet);
  const shown = useStore(shownVersion);
  const inRoom = useStore((s) => !!s.room);
  const offered = useStore((s) => versionOffered(s, version));
  if (!gd.ready || !versionReady || shown !== version) {
    return html`<${ReplayWait} version=${version} otherInRoom=${inRoom && shown !== version} offered=${offered} failed=${failed} inRoom=${inRoom} onBack=${onBack} />`;
  }
  return html`<${ResultView} res=${res} pub=${null} myId=${rec.selfId} backLabel=${t('返回统计')} onBack=${onBack} quiet=${true}
    content=${rec.content ? { cs: rec.content.cs, vanilla: false, plugins: rec.content.plugins } : null} version=${rec.version ?? null} />`;
}

/** 统计数据's replay closed (or the overlay): the page shows its own version again (versions.js shownVersion). */
function clearReplayVersion() {
  if (store.get().replayVersion != null) store.set({ replayVersion: null });
}

/** The overlay, rendered while open (its data hooks run only then). */
function StatsScreen({ tab }) {
  const ready = useData('config', 'bands', 'bonds', 'assets');
  const gd = useMemo(() => makeLookups(ready), [ready, data.locale(), data.contentId()]);
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
      if (replayRef.current) { setReplay(null); clearReplayVersion(); } else closeStats();
    };
    window.addEventListener('keydown', onKey, true);
    const timer = setTimeout(() => boxRef.current?.focus?.(), 30);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(timer); };
  }, []);

  const withModded = useStore((s) => s.withModded, Object.is, statsStore);
  // the version filter (see the header): the version shown unless another (or 全部版本) is picked
  const shown = useStore(shownVersion);
  const picked = useStore((s) => s.version, Object.is, statsStore);
  const versionPick = picked || shown;
  const recs = useMemo(() => recordsForStatsTab(stats.records, tab, versionPick), [stats, tab, versionPick]);
  const agg = useMemo(() => aggregateStats(recs, { modded: withModded }), [recs, withModded]);
  // 盟约记录's peak and the strategy marks follow the same 「含插件对局」 switch as the tallies (the history lists them all)
  const achRecords = useMemo(() => achievementRecords(recs, withModded), [recs, withModded]);
  // the row's version is shown while the replay is open (`replayVersion`, a transient override — the lobby preference
  // stays), set before the replay mounts so its data hooks load that version's files (the replay waits for its data).
  // Set in a room too, where it changes nothing (the room's version comes first) but keeps the version when the room goes
  // away under the open replay: no flip to the lobby's version and back (review fix)
  const openRecord = (rec) => {
    const v = recordVersion(rec);
    if (v !== shownVersion(store.get()) && (store.get().room || !versionOffered(store.get(), v))) return;
    if (store.get().replayVersion !== v) store.set({ replayVersion: v });
    setReplay(rec);
  };
  const closeReplay = () => { setReplay(null); clearReplayVersion(); };
  useEffect(() => clearReplayVersion, []);
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
    <${Replay} rec=${replay} onBack=${closeReplay} />
  </div>`;

  const empty = !stats.records.length;
  return html`<div class="st" role="dialog" aria-modal="true" aria-label=${t('统计数据')} tabindex="-1" ref=${boxRef}>
    <div class="st__bg" aria-hidden="true"></div>
    <header class="st-top">
      <div class="st-top__left">
        <${Button} variant="ghost" size="md" icon="chevronLeft" class="st-back" onClick=${closeStats} aria-label=${t('返回')} title=${t('返回 (Esc)')}>${t('返回')}<//>
      </div>
      <div class="st-top__center">
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
    ${stats.damaged ? html`<p class="st-note is-warn"><${Icon} name="warn" />${t('本机保存的统计数据无法读取，已另存为备份，从现在起重新记录。')}</p>` : null}
    ${stats.dropped ? html`<p class="st-note is-warn"><${Icon} name="warn" />${t('有 {n} 条记录已损坏，已忽略。', { n: stats.dropped })}</p>` : null}
    ${tab === 'totals' || tab === 'history' ? html`<${VersionFilter} records=${stats.records} value=${versionPick} shown=${shown} />` : null}
    <div class="ui-slot" data-ui-slot="stats.tab" aria-label=${t('界面插件')} dangerouslySetInnerHTML=${{ __html: '' }}></div>
    <main class="st-body" data-tab=${tab}>
      ${!ready ? html`<div class="st-loading"><${Spinner} size="md" /></div>`
        : stats.newer ? html`<p class="st-empty">${t('检测到更新版本的统计数据，请先升级客户端再查看，以免覆盖数据。')}</p>`
              : tab === 'totals' ? html`<${CombatSums} agg=${agg} records=${recordsForStatsTab(stats.records, 'overview', null)} withModded=${withModded} />`
                : tab === 'history' ? html`<${History} records=${recs} gd=${gd} onOpen=${openRecord} />`
				: tab === 'pastSeasons' ? html`<${LegacyStats} agg=${agg} nickname=${nickname} records=${achRecords} filterControl=${html`<${ModdedSwitch} agg=${agg} />`} />`
                  : html`<${Overview} agg=${agg} gd=${gd} nickname=${nickname} records=${achRecords} /><${Bands} agg=${agg} gd=${gd} records=${achRecords}  />`}
    </main>
  </div>`;
}

/**
 * 成就统计 (the lobby's achievement card, PR #643 — the event's 卫戍协议：盟约 achievement window, video 1:28–1:43; the
 * lobby's statistics entry by the maintainer's decision of 2026-10-21): one scrolling window under an orange banner — the
 * doctor's line and titles, 卫戍成就 (the peak alliance's match and the single-match records), 盟约记录 and 策略记录. It
 * only reads this browser's records (`peekStatsRecords`: a damaged or newer store is left for 统计数据 to handle) and,
 * like 统计数据 with 「含插件对局」 off, leaves the gameplay-plugin matches out of every block (achievementRecords for the
 * peak and the marks); 查看完整统计 opens 统计数据. The lineup's portraits, 自选 units and gear need chess / backups / items:
 * loaded here, since nothing on the lobby path loads them.
 * @param {{ onClose: () => void }} props
 */
export function AchievementDialog({ onClose }) {
  const ready = useData('config', 'bands', 'bonds', 'assets', 'chess', 'items', 'backups');
  const gd = useMemo(() => makeLookups(ready), [ready, data.locale(), data.contentId()]);
  // the season of the version shown (DESIGN §35.23), like the lobby's card
  const season = useStore((s) => seasonOf(shownVersion(s)));
  const records = useMemo(() => recordsOfSeason(peekStatsRecords(), season), [season]);
  const agg = useMemo(() => aggregateStats(records), [records]);
  const official = useMemo(() => achievementRecords(records), [records]);
  // a title in an alphabetic script (English …): ": " between its halves, as on the hub and the title screen
  const colon = scriptOf(t('卫戍协议')) === 'alphabetic' ? ': ' : '：';
  const nickname = useStore((s) => s.me.name);
  const fonts = ready ? uiUrl(gd.m, 'statistics/fontStyles') : null;
  const more = () => { onClose(); openStats(); };
  return html`<${Modal} open=${true} onClose=${onClose} class="achv" veilClass="achv-veil">
    <header class="achv__banner">
      <${Img} src=${ready ? uiUrl(gd.m, 'settle/common_logo') : null} class="achv__logo" fallback=${html`<span class="achv__logo-text">STRONGHOLD PROTOCOL</span>`} />
      <div class="achv__title">
        <span class="achv__mark" aria-hidden="true"><${Img} src=${ready ? uiUrl(gd.m, 'entry/season_logo') : null} /></span>
        <span class="achv__en" aria-hidden="true">ALLIANCE</span>
        <h2 class="modal__title achv__name">${t('卫戍协议')}<span>${colon}</span>${t('盟约')}</h2>
      </div>
      <button type="button" class="achv__close" onClick=${onClose} aria-label=${t('关闭')} title=${t('关闭')}><${Icon} name="close" /></button>
    </header>
    <div class="achv__scroll st-body" data-testid="achievement-dialog">
      ${fonts ? html`<link rel="stylesheet" href=${fonts} />` : null}
      ${!ready ? html`<div class="st-loading"><${Spinner} size="md" /></div>` : html`
        <${ProfileBlock} agg=${agg} gd=${gd} nickname=${nickname} />
        <${RecordHeading} icon="headingAchievement" title=${t('卫戍成就')} manifest=${gd.m} class="st-record-heading--achievement" />
        <${MatchRecords} maxima=${agg.count ? agg.maxima : { gold: 0, merges: 0, kills: 0 }} achievements=${agg.achievements} manifest=${gd.m} />
        <${BondRecords} agg=${agg} gd=${gd} records=${official} />
        <${StrategyRecords} agg=${agg} gd=${gd} records=${official} />`}
    </div>
    <footer class="achv__foot">
      <span><${Icon} name="info" />${t('本机记录：只保存在这个浏览器里')}</span>
      <button type="button" class="achv__more" onClick=${more}>${t('查看完整统计')}<${Icon} name="chevronRight" /></button>
    </footer>
  <//>`;
}

/** Global stats viewer host — mounted once by main.js; renders nothing (and loads nothing) until opened. */
export function StatsHost() {
  const { open, tab } = useStore((s) => s, Object.is, statsStore);
  if (!open) return null;
  return html`<${StatsScreen} tab=${tab} />`;
}

