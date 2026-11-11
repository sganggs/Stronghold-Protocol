// Second-period statistics retain the interface and metrics from before the sequence redesign.
import { useState, useEffect } from '../../vendor/hooks.module.js';
import { html, Icon, Spinner } from '../ui/components.js';
import { EmptyTopRecords } from '../ui/statsEmpty.js';
import { Img } from '../ui/gameComponents.js';
import { createDataStore, data as currentData } from '../data.js';
import { fmtNum, diyRecordFor, cardStandIn } from '../ui/gameLogic.js';
import { uiUrl, chessAvatarUrl, chessPortraitUrl, itemIconUrl, bondIconUrl, bandIconUrl } from '../ui/assetUrls.js';
import { trophyMedalOf, strategyBadgeIds, bondMemberChess, highestBondRecord, recordVersion } from '../ui/stats.js';
import { TITLE_HEX_SECTORS, titleSectorClip } from '../ui/titleHexagon.js';
import { VersionTag } from '../ui/pluginTag.js';
import { DEFAULT_VERSION, versionLabel } from '../versions.js';
import { t, N_ } from '../../../shared/i18n.js';

const data = createDataStore();
const cx = (...p) => p.flat().filter(Boolean).join(' ');
const pct = (n, d) => d > 0 ? Math.round(n / d * 100) + '%' : '—';
function Section({ title, children }) { return html`<section class="st-sec">${title ? html`<h2 class="st-sub">${title}</h2>` : null}${children}</section>`; }
function useData(...names) {
  const [ready, setReady] = useState(false);
  useEffect(() => { let alive = true; data.loadAll(...names).then(() => { if (alive) setReady(true); }); return () => { alive = false; }; }, [names.join('|')]);
  return ready;
}
function BondGlyph({ bondId }) {
  const bond = data.lookup('bonds', bondId);
  return html`<span class="bglyph" title=${bond?.name || bondId}><${Img} src=${bondIconUrl(data.get('assets'), bondId)} fallback=${html`<span class="bglyph__txt">${[...(bond?.name || '?')][0]}</span>`} /></span>`;
}
function BandIcon({ bandId }) {
  const band = data.lookup('bands', bandId);
  return html`<span class="bandicon" title=${band?.name || bandId}><${Img} src=${bandIconUrl(data.get('assets'), bandId)} fallback=${html`<span class="bandicon__txt">${[...(band?.name || '?')][0]}</span>`} /></span>`;
}
function RecordHeading({ title, manifest, class: cls }) {
  return html`<h3 class=${cx('st-record-heading', cls)} style=${{ backgroundImage: 'url(' + uiUrl(manifest, 'statistics/headingBar') + ')' }}>
    <span class="st-record-heading__icon" aria-hidden="true"><${Img} src=${uiUrl(manifest, 'statistics/headingIconFrame')} class="st-record-heading__frame" /><${Img} src=${uiUrl(manifest, 'statistics/headingIcon')} class="st-record-heading__glyph" /></span><span>${title}</span>
  </h3>`;
}
export function LegacyStats({ agg, nickname, records, filterControl }) {
  const [locale, setLocale] = useState(data.locale());
  const requestedLocale = currentData.locale();
  useEffect(() => { let alive = true; data.setLocale(requestedLocale).then(value => { if (alive) setLocale(value); }); return () => { alive = false; }; }, [requestedLocale]);
  const ready = useData('config', 'bands', 'bonds', 'chess', 'assets', 'items', 'backups');
  const gd = { list: name => data.list(name), m: data.get('assets'), config: data.get('config'), chess: id => data.lookup('chess', id), item: id => data.lookup('items', id), bond: id => data.lookup('bonds', id), band: id => data.lookup('bands', id) };
  return html`<div class="st-legacy" lang=${locale}>
    <p class="st-note">${t('目前过往赛季只有第二期下半，暂时无法切换')}</p>
    ${ready ? html`${filterControl}<${Overview} agg=${agg} gd=${gd} nickname=${nickname} records=${records} /><${Bands} agg=${agg} gd=${gd} records=${records} />` : html`<${Spinner} size="md" />`}
  </div>`;
}


function ProfileBlock({ agg, gd, nickname }) {
  const titles = (Array.isArray(gd.config?.titles) ? gd.config.titles : []).map((x) => ({ ...x, count: agg.titles[x.id]?.count || 0 }));
  // records whose room mode is unknown (`roomMode` null) count in the total but in neither mode row
  const unknownMode = Math.max(0, agg.count - agg.byMode.solo.games - agg.byMode.coop.games);
  return html`<div class="st-overview-details">
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
    </div>`;
}

function Overview({ agg, gd, nickname, records }) {
  useData('chess', 'items', 'backups');
  const fonts = uiUrl(gd.m, 'statistics/fontStyles');
  return html`<${Section}>
    ${agg.test > 0 ? html`<p class="t-dim" data-testid="stats-test-excluded">${t('测试对局不计入统计。')}</p>` : null}
    ${fonts ? html`<link rel="stylesheet" href=${fonts} />` : null}
    <${ProfileBlock} agg=${agg} gd=${gd} nickname=${nickname} />
    <${RecordHeading} title=${t('卫戍成就')} manifest=${gd.m} class="st-record-heading--achievement" />
    <${BondAchievement} peak=${highestBondRecord(records)} gd=${gd} />
    <${MatchRecords} maxima=${agg.maxima} manifest=${gd.m} />
  <//>`;
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
  const own = recordVersion(peak.record);
  const sameVersion = own === (gd.config?.version?.id ?? DEFAULT_VERSION);
  const lineup = sameVersion ? peak.player.lineup : null;
  return html`<div class="st-achievement">
    <div class="st-achievement__peak">
      <span class="st-achievement__caption">${t('战果纪录')}</span>
      <div class="st-achievement__bond" style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBondFrame')})`}><${BondGlyph} bondId=${peak.bond.bondId} /></div>
      <span>${t('盟约最高叠加')}</span><b class="num">${fmtNum(peak.bond.layers)}</b>
    </div>
    <div class="st-achievement__detail" style=${`background-image:url(${uiUrl(gd.m, 'statistics/achievementBg')})`}>
      <ul class="st-achievement__lineup">${sameVersion ? null : html`<li class="st-achievement__other" data-testid="achievement-other-version">
        <${VersionTag} version=${own} compact=${true} />${t('切换到「{version}」查看', { version: versionLabel(own) })}</li>`}${Array.from({ length: 10 }, (_, i) => lineup?.[i]
        ? html`<${AchievementOperator} key=${i} unit=${lineup[i]} gd=${gd} />`
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

function BondRecords({ agg, gd }) {
  useData('chess');
  const bonds = Object.entries(agg.bonds).sort((a, b) => (b[1].games - a[1].games) || a[0].localeCompare(b[0]));
  const members = bondMemberChess(gd.list('chess'), bonds[0]?.[0]);
  return html`<${RecordHeading} title=${t('盟约记录')} manifest=${gd.m} />
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
    </div>` : html`<${EmptyTopRecords} kind="bond" manifest=${gd.m} /><p class="st-hint">${t('暂无盟约使用记录')}</p>`}
    ${bonds.length ? html`<h4 class="st-sub st-bond-members__heading">${t('盟约下干员为：')}</h4>
      <ul class="st-bond-members">
        ${members.map((chess) => html`<li key=${`${chess.charId}#${chess.tier}`} class="st-bond-member" title=${chess.name}
          style=${`background-image:url(${uiUrl(gd.m, 'statistics/memberFrame')})`}>
          <${Img} src=${chessAvatarUrl(gd.m, chess)} class="st-bond-member__avatar" fallback=${html`<span>${chess.name}</span>`} />
          <${Img} src=${uiUrl(gd.m, `statistics/memberTier${chess.tier}`)} class="st-bond-member__tier" />
        </li>`)}
      </ul>` : null}`;
}

function StrategyRecords({ agg, gd, records }) {
  const badges = strategyBadgeIds(records, data.get('bands'));
  const rows = Object.entries(agg.bands).sort((a, b) => (b[1].games - a[1].games) || (b[1].wins - a[1].wins));
  return html`<${RecordHeading} title=${t('策略记录')} manifest=${gd.m} class="st-record-heading--strategy" />
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
    </ul>` : html`<p class="st-hint">${t('暂无获得特殊标识的策略')}</p>`}`;
}

function Bands({ agg, gd, records }) {
  useData('chess');
  const fonts = uiUrl(gd.m, 'statistics/fontStyles');
  const rows = Object.entries(agg.bands).sort((a, b) => (b[1].games - a[1].games) || (b[1].wins - a[1].wins));
  return html`<${Section} title=${t('盟约&策略')} micro="ALLIANCES / STRATEGIES">
    ${fonts ? html`<link rel="stylesheet" href=${fonts} />` : null}
    <${BondRecords} agg=${agg} gd=${gd} />
    <${StrategyRecords} agg=${agg} gd=${gd} records=${records} />
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
    </table></div>` : html`<p class="st-empty">${t('暂无数据')}</p>`}
  <//>`;
}
