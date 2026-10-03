// Detail panel (click / right-click a piece, shop card, bond member, battle unit or previewed enemy):
// operators — portrait, name, tier, elite, class/subclass and, right under them in the header's right column (no
// scrolling, user playtest #2 item 9), the unit's bonds (阵营 / 盟约: icon, name, member count / next threshold,
// reached tier, active state — tap one for its popup); right under the header the operator's own effect (特质 —
// garrison: type chip (its official type icon + eventTypeDesc such as 整备能力, garrisonTypeIconKey) + description,
// compact, visible without scrolling: user playtest #3 items 8 / 9), the class trait (特性), stats + range mini-map, skill (the one chosen in the loadout, DESIGN §16: icon, SP
// info, rich description, 已调配 when not the default), elite module (模组: official type icon from the local-client
// art, else its letter), equipped items, talents (CHESS_SECTIONS); items — icon, tier,
// effect; tokens — the owner's variant (a golden owner's summon: its `_b` stats / skill), how a placed summon takes
// the field (shared/constants.js SKILL_SUMMON_START_DEPLOY), its token skill and talents; enemies — stats, rank,
// faction tags, abilities. Selling / destroying is the underframe's job in the
// match (research 09 §5, ui/underframe.js): the panel's own 出售 / 销毁 buttons only render for callers that pass
// `editable` + handlers. `side` 'right' docks the panel at the right edge (the game screen picks the side away from a
// selected unit's underframe, gameLogic panelSide).
// Live stats (user playtest #4 item 7 — the card used to show the fixed record numbers): `live` = the unit's current
// stats (shared/protocol.js unitStatsEntry + `src`) — in battle the browser's own sim (battle/runner.js unitStats; a
// getter re-read 4× a second: current HP, max HP, ATK, DEF, RES, attack interval, block), in prep the stats the own
// board's units start their next battle with (m.unitStats: equipment, bonds / layers, 特质, band and 机变 effects). Each
// value is coloured against the unit's base like the official card — green when it helps (higher, or a shorter attack
// interval) with the difference beside it, red when it hurts — and a 实时 / 开战时 tag says which it is.

import { html, Icon, TierChip, MicroLabel, Button, confirmDialog, useTicker } from './components.js';
import { Img, RichText, UnitThumb, BondGlyph, GIcon } from './gameComponents.js';
import { attackInterval, rangeGridBox, fmtNum, tileKey, chessLoadout, nextThreshold, bondTier, effectiveBonds } from './gameLogic.js';
import { chessPortraitUrl, skillIconUrl, skillRecordIconUrl, profIconUrl, subProfIconUrl, itemIconUrl, enemyIconUrl, tokenAvatarUrl, factionIconUrl, uiUrl, moduleTypeIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { attackRangeGrid } from '../../../shared/loadoutRecord.js';
import { SKILL_SUMMON_START_DEPLOY } from '../../../shared/constants.js';
import { moduleBadge } from './loadoutModel.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const PROF_NAME = { PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击', CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种', TOKEN: '召唤物' };
const SP_TYPE = { INCREASE_WITH_TIME: '自动回复', INCREASE_WHEN_ATTACK: '攻击回复', INCREASE_WHEN_TAKEN_DAMAGE: '受击回复', ON_DEPLOY: '被动' };
const SKILL_TYPE = { MANUAL: '自动触发', AUTO: '自动触发', PASSIVE: '被动' };
/** Fallback type icon by trigger, for a garrison record without its official `eventTypeIcon` (garrisonTypeIconKey). */
const EVENT_ICON = { IN_BATTLE: 's_icon_battle', SERVER_GAIN: 's_icon_bond', SERVER_PREP_START: 's_icon_bond', SERVER_PREP_FIN: 's_icon_bond', SERVER_CHESS_SOLD: 's_icon_gold', SERVER_PRICE: 's_icon_gold', SERVER_REFRESH_SHOP: 's_icon_gold' };
const RANK = { NORMAL: '普通', ELITE: '精英', BOSS: '领袖' };
const DMG = { phys: '物理', arts: '法术', heal: '治疗', true: '真实', none: '无' };

/** Mini range map. */
export function RangeGrid({ grid, class: cls }) {
  const box = rangeGridBox(grid);
  if (!box.cells.size) return html`<span class="t-dim">—</span>`;
  const cells = [];
  for (let r = box.r0; r > box.r0 - box.rows; r--) {
    for (let c = box.c0; c < box.c0 + box.cols; c++) {
      const self = r === 0 && c === 0;
      cells.push(html`<i key=${`${r},${c}`} class=${cx(box.cells.has(tileKey(r, c)) && 'on', self && 'self')}></i>`);
    }
  }
  return html`<div class=${cx('rgrid', cls)} style=${`grid-template-columns:repeat(${box.cols}, var(--rg))`} aria-label="攻击范围">${cells}</div>`;
}

function Stat({ k, v, sub, tone = null, title }) {
  return html`<div class=${cx('dstat', tone && `is-${tone}`)} title=${title}><span class="dstat__k">${k}</span><span class="dstat__row"><b class="dstat__v num">${v}</b>${sub ? html`<small>${sub}</small>` : null}</span></div>`;
}

/** Tolerance below which a live stat counts as its base (display rounding). */
const STAT_EPS = { interval: 0.005, res: 0.05, moveSpeed: 0.005 };

/**
 * How a live stat compares with the unit's base (the official card's colours): 'up' (green) when it helps — higher,
 * or a shorter attack interval —, 'down' (red) when it hurts, null when equal or unknown.
 * @param {string} key maxHp | atk | def | res | interval | blockCnt | moveSpeed
 * @param {any} cur @param {any} base
 * @returns {'up'|'down'|null}
 */
export function statTone(key, cur, base) {
  if (!Number.isFinite(cur) || !Number.isFinite(base)) return null;
  const d = cur - base;
  if (Math.abs(d) < (STAT_EPS[key] ?? 0.5)) return null;
  return (key === 'interval' ? d < 0 : d > 0) ? 'up' : 'down';
}

/**
 * One stat of the card: the live value (when `live` has it) coloured against `live.base`, with the difference as the
 * small text; else the record value.
 * @param {any} live unitStatsEntry (+ src) or null
 * @param {string} key unitStatsEntry key
 * @param {any} fallback record value
 * @param {(v: any) => any} [fmt]
 * @returns {{ v: any, tone: 'up'|'down'|null, sub: string|null, title: string|undefined }}
 */
export function liveStat(live, key, fallback, fmt = fmtNum) {
  const cur = live && Number.isFinite(live[key]) ? live[key] : null;
  if (cur == null) return { v: fallback == null ? '—' : fmt(fallback), tone: null, sub: null, title: undefined };
  const base = live.base && Number.isFinite(live.base[key]) ? live.base[key] : null;
  const tone = statTone(key, cur, base);
  let sub = null;
  if (tone) {
    const d = cur - base;
    sub = key === 'interval' ? `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(2)}` : `${d > 0 ? '+' : '−'}${key === 'res' || key === 'moveSpeed' ? Math.round(Math.abs(d) * 10) / 10 : fmtNum(Math.abs(d))}`;
  }
  return { v: fmt(cur), tone, sub, title: base != null ? `基础 ${fmt(base)}` : undefined };
}

/** The tag of a live stats block: 实时 (battle) / 开战时 (the prep preview). */
function LiveTag({ live }) {
  if (!live) return null;
  const battle = live.src === 'battle';
  return html`<span class=${cx('dstats__tag', battle && 'is-battle')} title=${battle ? '当前作战中的实时数值（绿色为增益，红色为减益）'
    : '下一场作战开始时的数值：已计入装备、盟约层数、特质、策略与机变效果（不含技能与作战中的临时效果）'}>${battle ? '实时' : '开战时'}</span>`;
}

const fmtInterval = (v) => (Number.isFinite(v) && v > 0 ? `${v.toFixed(2)}s` : '—');
const fmtRes = (v) => (Number.isFinite(v) ? String(Math.round(v * 10) / 10) : '0');

/** HP bar of the card header: the live HP in battle, else the snapshot's. */
function hpOf(live, snapHp) {
  if (live && live.src === 'battle' && Number.isFinite(live.hp) && Number.isFinite(live.maxHp)) return { hp: live.hp, max: live.maxHp };
  return snapHp || null;
}

function Section({ title, micro, children, class: cls }) {
  return html`<section class=${cx('dsec', cls)}>
    <h4 class="dsec__title">${title}${micro ? html`<${MicroLabel}>${micro}</${MicroLabel}>` : null}</h4>
    ${children}
  </section>`;
}

function ItemRow({ itemId }) {
  const it = data.lookup('items', itemId);
  return html`<div class="ditem">
    <${UnitThumb} kind="item" id=${itemId} size="sm" />
    <div class="ditem__text"><b>${it?.name || itemId}</b><${RichText} text=${it?.descRaw || it?.desc || ''} class="ditem__desc" /></div>
  </div>`;
}

/**
 * The unit's bonds right under the header: icon, name, the player's member count / next threshold, reached tier.
 * The ids are the piece's EFFECTIVE bonds (its record's `bonds` ∪ the 变形同构体 grants, gameLogic.effectiveBonds), so
 * a 转职 shows up wherever the piece sits; a granted chip carries the `is-granted` marker + its source in the title.
 * @param {{ bondIds: string[], granted?: string[], bonds?: any[], onBond?: (bondId: string) => void }} props
 */
export function BondChips({ bondIds, granted = [], bonds = [], onBond = null }) {
  const ids = Array.isArray(bondIds) ? bondIds.filter((b) => typeof b === 'string') : [];
  if (!ids.length) return null;
  const extra = new Set(Array.isArray(granted) ? granted.filter((b) => typeof b === 'string') : []);
  const mine = new Map((Array.isArray(bonds) ? bonds : []).filter((b) => b && typeof b.bondId === 'string').map((b) => [b.bondId, b]));
  return html`<div class="dbonds dbonds--top" role="list" aria-label="所属盟约">
    ${ids.map((id) => {
      const rec = data.lookup('bonds', id);
      const e = mine.get(id) || null;
      const th = Array.isArray(e?.thresholds) && e.thresholds.length ? e.thresholds : Array.isArray(rec?.thresholds) ? rec.thresholds : [];
      const count = Number.isFinite(e?.count) ? e.count : 0;
      const tier = Number.isFinite(e?.tier) ? e.tier : bondTier(count, th, rec?.maxCount ?? null);
      const active = e ? !!e.active : tier > 0;
      const next = nextThreshold(count, th);
      const cap = next ?? th[th.length - 1] ?? null;
      const isGranted = extra.has(id);
      const label = `${rec?.name || id}：在场 ${count}${cap != null ? `/${cap}` : ''}${active ? `，已激活 ${tier} 阶` : '，未激活'}${isGranted ? '（由装备额外赋予的盟约）' : ''}`;
      const body = html`
        <${BondGlyph} bondId=${id} class="dbond__icon" />
        ${isGranted ? html`<span class="dbond__extra" title="由装备额外赋予的盟约">额外</span>` : null}
        <span class="dbond__name">${rec?.name || id}</span>
        <span class=${cx('dbond__count', 'num', next == null && count > 0 && 'is-max')}>${count}${cap != null ? html`<small>/${cap}</small>` : null}</span>
        ${th.length ? html`<span class="dbond__tiers" aria-hidden="true">${th.map((_, i) => html`<i key=${i} class=${i < tier ? 'on' : ''}></i>`)}</span>` : null}`;
      return onBond
        ? html`<button key=${id} type="button" role="listitem" class=${cx('dbond', active && 'is-active', rec?.isCore && 'is-core', isGranted && 'is-granted')} title=${label} aria-label=${label}
            data-bond=${id} onClick=${() => onBond(id)}>${body}</button>`
        : html`<span key=${id} role="listitem" class=${cx('dbond', active && 'is-active', rec?.isCore && 'is-core', isGranted && 'is-granted')} title=${label} data-bond=${id}>${body}</span>`;
    })}
  </div>`;
}

/**
 * 特性 text of the record the unit fights with (DESIGN §16: `lo.record` = the chosen module's traitOverride, or the
 * no-module traitBase for 不装备 — data `trait` is the default module's).
 */
function traitText(c, golden, lo) {
  const t = (lo?.record || c).trait || {};
  const base = t.descRaw || t.desc || '';
  if (!golden || lo?.record !== c) return base;
  return t.moduleDescRaw || base;
}

/**
 * Order of an operator card's blocks (user playtest #3 item 8): the operator's own effect (特质 — garrison: its trigger
 * such as 休整期结束时 and what it does) right under the header, visible without scrolling; the class trait (特性) and
 * the stats next; then the skill, the elite's module, the equipped items (the player's own build) and the talents.
 */
export const CHESS_SECTIONS = Object.freeze(['head', 'garrison', 'trait', 'stats', 'skill', 'module', 'equip', 'talents', 'actions']);

/**
 * Sprite key (ui `garrisonTypeIcon/…`, small variant) of a 特质's type chip: the garrison's own official
 * `eventTypeIcon` — icon_battle 作战能力 / icon_gold 整备能力 / icon_bond 持续叠加·单次叠加 / icon_support 特异化, the
 * icon that goes with its `eventTypeDesc` — never a guess from the trigger (that put the spoked 特异化 glyph, which reads
 * like a loading spinner, before the text of every <休整期开始时 / 结束时> 特质: user playtest #3 item 9).
 * @param {{ eventTypeIcon?: string|null, eventType?: string }|null} garrison
 */
export function garrisonTypeIconKey(garrison) {
  const k = garrison && typeof garrison.eventTypeIcon === 'string' ? garrison.eventTypeIcon : '';
  if (/^icon_[a-z]+$/.test(k)) return `s_${k}`;
  return EVENT_ICON[garrison?.eventType] || 's_icon_bond';
}

/** The operator's own effect (特质, garrisons.json): trigger chip + description, compact. */
function GarrisonBlock({ garrison, m }) {
  return html`<section class="dgarrison" aria-label="特质" data-garrison=${garrison.garrisonId || ''}>
    <div class="dgarrison__head">
      <span class="dgarrison__k">特质</span>
      <span class="dgarrison__type">
        <${Img} src=${uiUrl(m, `garrisonTypeIcon/${garrisonTypeIconKey(garrison)}`)} class="dgarrison__icon" />
        ${garrison.eventTypeDesc || ''}
      </span>
    </div>
    <${RichText} as="p" text=${garrison.descRaw || garrison.desc} class="dgarrison__text" />
  </section>`;
}

export function ChessDetail({ chess, piece, unit, snapHp, editable, onSell, bonds, loadout, onBond, live = null, hint = null }) {
  const m = data.get('assets');
  const hp = hpOf(live, snapHp);
  const lo = chessLoadout(chess, loadout, (id) => data.lookup('chess', id));
  const c = chess;
  // stats / talents the unit fights with: the chosen module's (or none — statsBase) for an elite (DESIGN §16)
  const fr = lo?.record || c;
  const s = fr.stats || {};
  const golden = !!(c.isGolden || piece?.golden);
  const interval = attackInterval(s.bat, s.aspd);
  const sk = lo?.skill || c.skill || null;
  // a chosen skill the manifest has no icon for (only the default skills' icons are fetched): its slot letter
  const skIcon = sk && lo && !lo.defaultSkill ? skillRecordIconUrl(m, sk, { empty: false }) : skillIconUrl(m, c);
  const skSlot = sk && Number.isInteger(sk.index) ? `S${sk.index + 1}` : null;
  const garrison = Array.isArray(c.garrisonIds) && c.garrisonIds[0] ? data.lookup('garrisons', c.garrisonIds[0]) : null;
  const items = Array.isArray(piece?.items) ? piece.items : [];
  // the bonds this PIECE counts as: its record's own ∪ the 变形同构体 grants of the other equipped item
  // (gameLogic.effectiveBonds — the same rule the match counts with, server/match/bondsMeta.js pieceBonds). The count
  // beside a chip stays the player's own (m.private.bonds), which follows the bond's countMode.
  const ownBonds = Array.isArray(c.bonds) ? c.bonds.filter((b) => typeof b === 'string') : [];
  const bondIds = effectiveBonds(ownBonds, piece, (id) => data.lookup('items', id), (id) => !!data.lookup('bonds', id));
  const grantedBonds = bondIds.filter((b) => !ownBonds.includes(b));
  const sell = c.sellPrice ?? 1;
  const blocks = {};
  blocks.head = html`
    <div key="head" class="dhead">
      <div class=${cx('dhead__art', golden && 'is-golden', `dhead__art--t${c.tier}`)}>
        <${Img} src=${chessPortraitUrl(m, c)} fallback=${html`<${UnitThumb} kind="chess" id=${c.chessId} size="lg" />`} />
      </div>
      <div class="dhead__info">
        <div class="dhead__chips">
          <${TierChip} tier=${c.tier} golden=${golden} size="lg" />
          ${golden ? html`<span class="dtag-elite">精锐</span>` : null}
          ${piece?.kind === 'token' ? html`<span class="dtag-token">召唤物</span>` : null}
        </div>
        <h3 class="dhead__name">${c.name}</h3>
        <span class="dhead__en">${c.appellation || ''}</span>
        <div class="dhead__class">
          <${Img} src=${profIconUrl(m, c.profession)} class="dhead__prof" />
          <span>${PROF_NAME[c.profession] || c.profession || ''}</span>
          <i class="sep"></i>
          <${Img} src=${subProfIconUrl(m, c)} class="dhead__sub" />
          <span>${c.subProfessionName || ''}</span>
          <span class="dhead__pos">${c.position === 'MELEE' ? '近战位' : '远程位'}</span>
        </div>
        ${hp ? html`<div class="dhp"><i style=${`width:${Math.max(0, Math.min(100, (hp.hp / Math.max(1, hp.max)) * 100))}%`}></i><span class="num">${fmtNum(hp.hp)} / ${fmtNum(hp.max)}</span></div>` : null}
        <${BondChips} bondIds=${bondIds} granted=${grantedBonds} bonds=${bonds} onBond=${onBond} />
      </div>
    </div>`;
  blocks.garrison = garrison ? html`<${GarrisonBlock} key="garrison" garrison=${garrison} m=${m} />` : null;
  blocks.trait = c.trait?.desc ? html`<p key="trait" class="dtrait"><${Icon} name="info" /><${RichText} text=${traitText(c, golden, lo)} /></p>` : null;
  // live (battle) / start-of-battle (prep) values against the base, else the record's (liveStat)
  const st = {
    maxHp: liveStat(live, 'maxHp', s.maxHp), atk: liveStat(live, 'atk', s.atk), def: liveStat(live, 'def', s.def),
    res: liveStat(live, 'res', s.res ?? 0, fmtRes), interval: liveStat(live, 'interval', interval, fmtInterval),
    blockCnt: liveStat(live, 'blockCnt', s.blockCnt, (v) => String(v)),
  };
  blocks.stats = html`
    <div key="stats" class=${cx('dstats-wrap', live && 'is-live')} data-live=${live ? live.src || 'prep' : undefined}>
      <div class="dstats">
        <${LiveTag} live=${live} />
        <${Stat} k="生命上限" ...${st.maxHp} />
        <${Stat} k="攻击" ...${st.atk} />
        <${Stat} k="防御" ...${st.def} />
        <${Stat} k="法术抗性" ...${st.res} />
        <${Stat} k="攻击间隔" ...${st.interval} />
        <${Stat} k="阻挡数" ...${st.blockCnt} />
        <${Stat} k="部署费用" v=${s.cost ?? '—'} />
        <${Stat} k="再部署" v=${s.respawnTime != null ? `${s.respawnTime}s` : '—'} />
      </div>
      <div class="drange"><span class="dstat__k">攻击范围</span><${RangeGrid} grid=${attackRangeGrid(fr) || c.rangeGrid} /></div>
    </div>`;
  blocks.skill = sk ? html`<${Section} key="skill" title="技能" micro="SKILL" class="dsec--skill">
      <div class="dskill" data-skill=${sk.skillId || ''}>
        <${Img} src=${skIcon} class="dskill__icon" fallback=${html`<span class="dskill__icon dskill__icon--empty">${skSlot ? html`<b class="num">${skSlot}</b>` : null}</span>`} />
        <div class="dskill__meta">
          <b class="dskill__name">${skSlot && (lo?.choices || 0) > 1 ? html`<span class="dskill__slot num" title=${`技能 ${skSlot}`}>${skSlot}</span>` : null}${sk.name}${lo && !lo.defaultSkill ? html`<span class="dtag-loadout" title="干员调配中选择的技能">已调配</span>` : null}</b>
          <div class="dskill__tags">
            <span class="dsp dsp--${sk.spType === 'INCREASE_WHEN_ATTACK' ? 'atk' : sk.spType === 'INCREASE_WHEN_TAKEN_DAMAGE' ? 'def' : 'time'}">${SP_TYPE[sk.spType] || '技力'}</span>
            <span class="dsp dsp--trig">${SKILL_TYPE[sk.skillType] || '自动触发'}</span>
            ${sk.spType !== 'ON_DEPLOY' && sk.skillType !== 'PASSIVE' ? html`<span class="dsp__num"><${GIcon} name="bolt" />初始 <b class="num">${sk.initSp ?? 0}</b> · 消耗 <b class="num">${sk.spCost ?? 0}</b></span>` : null}
            ${sk.duration > 0 ? html`<span class="dsp__num">持续 <b class="num">${sk.duration}</b>s</span>` : null}
            ${sk.maxChargeTime > 1 ? html`<span class="dsp__num">充能 <b class="num">${sk.maxChargeTime}</b></span>` : null}
          </div>
        </div>
      </div>
      <${RichText} as="p" text=${sk.descRaw || sk.desc} class="dtext" />
    <//>` : null;
  blocks.module = golden && lo?.module ? html`<${Section} key="module" title="模组" micro="MODULE" class="dsec--module">
      <div class=${cx('dmodule', lo.module.none && 'is-none')} data-module=${lo.module.id}>
        ${!lo.module.none && lo.module.typeName ? html`<span class="dmodule__icon" data-type=${lo.module.typeName}>
          <${Img} src=${moduleTypeIconUrl(data.get('local'), lo.module.typeName)} fallback=${html`<b class="num">${moduleBadge(lo.module)}</b>`} /></span>` : null}
        <b class="dmodule__name">${lo.module.name}</b>
        ${lo.module.typeName ? html`<span class="dmodule__type">${lo.module.typeName}</span>` : null}
        ${!lo.defaultModule ? html`<span class="dtag-loadout" title="干员调配中选择的模组">已调配</span>` : null}
      </div>
    <//>` : null;
  blocks.equip = piece?.kind === 'chess' ? html`<${Section} key="equip" title="装备" micro=${`EQUIP ${items.length}/2`} class="dsec--equip">
      ${items.length ? items.map((it) => html`<${ItemRow} key=${it.uid} itemId=${it.id} />`) : html`<p class="t-dim dempty">拖拽装备至该干员以配发（最多 2 件）</p>`}
    <//>` : null;
  blocks.talents = Array.isArray(fr.talents) && fr.talents.some((t) => t && t.name && !t.hidden) ? html`<${Section} key="talents" title="天赋" micro="TALENT" class="dsec--talent">
      ${fr.talents.filter((t) => t && t.name && !t.hidden).map((t, i) => html`<div key=${i} class="dtalent"><b>${t.name}</b><${RichText} text=${t.descRaw || t.desc} class="dtext" /></div>`)}
    <//>` : null;
  blocks.actions = piece && editable && piece.kind !== 'item' ? html`<div key="actions" class="dactions">
      <${Button} variant="amber" icon="close" class="dpanel__sell" onClick=${() => onSell(piece, c)}>出售<span class="dsell num">+${sell}</span><//>
    </div>` : null;
  const out = CHESS_SECTIONS.map((k) => blocks[k]).filter(Boolean);
  // a merge-completing shop / reward card: where the elite goes (shopBar mergeHint), right under the header
  if (hint) out.splice(1, 0, html`<p key="merge" class="dhint dhint--merge"><${Icon} name="info" />可晋升：${hint}</p>`);
  return out;
}

/**
 * An item's card (hand / temp / shop / equipped). An effect-only item (items.json `shopExcluded`: the special 维式重锤,
 * 突变细胞 — user playtest #4 item 5) says it is never sold and where it comes from (`shopExcludedBy`).
 */
export function ItemDetail({ item, piece, editable, onDestroy }) {
  const m = data.get('assets');
  return html`
    <div class="dhead dhead--item">
      <div class=${cx('dhead__icon', item.isGolden && 'is-golden')}><${Img} src=${itemIconUrl(m, item)} fallback=${html`<${GIcon} name="bolt" />`} /></div>
      <div class="dhead__info">
        <div class="dhead__chips"><${TierChip} tier=${item.tier} golden=${item.isGolden} size="lg" />${item.isGolden ? html`<span class="dtag-elite">进阶</span>` : null}
          <span class="dtag-kind">${item.itemType === 'MAGIC' ? '奇术' : '装备'}</span></div>
        <h3 class="dhead__name">${item.name}</h3>
        ${item.flavor ? html`<span class="dhead__flavor">${item.flavor}</span>` : null}
      </div>
    </div>
    <${Section} title="效果" micro="EFFECT"><${RichText} as="p" text=${item.descRaw || item.desc} class="dtext" /><//>
    ${item.itemType === 'MAGIC'
      ? html`<p class="dhint"><${Icon} name="info" />将其拖拽至战场上的格子使用</p>`
      : html`<p class="dhint"><${Icon} name="info" />拖拽至干员身上进行配发（每名干员最多 2 件，配发后无法取下）${item.mergeable ? '；2 件相同装备自动合成进阶装备' : ''}</p>`}
    ${item.shopExcluded ? html`<p class="dhint dhint--source"><${Icon} name="info" />调度中心不出售 · 获取途径：${item.shopExcludedBy || '效果获得'}</p>` : null}
    ${piece && editable ? html`<div class="dactions"><${Button} variant="danger" onClick=${() => onDestroy(piece, item)}>销毁道具<//></div>` : null}`;
}

function EnemyDetail({ enemy, snapHp, count, live = null }) {
  const m = data.get('assets');
  const s = enemy.stats || {};
  const types = Array.isArray(enemy.acTypes) ? enemy.acTypes : enemy.acType ? [enemy.acType] : [];
  const factions = data.get('factions')?.types || {};
  const imm = Object.entries(s.immunities || {}).filter(([, v]) => v).map(([k]) => ({ stun: '晕眩', silence: '沉默', sleep: '沉睡', frozen: '冻结', levitate: '浮空' }[k] || k));
  const interval = attackInterval(s.bat, s.aspd);
  const hp = hpOf(live, snapHp);
  // a battle enemy: its live stats against its spawned ones (the round's multipliers included — unitStatsEntry base)
  const st = {
    maxHp: liveStat(live, 'maxHp', s.maxHp), atk: liveStat(live, 'atk', s.atk), def: liveStat(live, 'def', s.def),
    res: liveStat(live, 'res', s.res ?? 0, fmtRes), moveSpeed: liveStat(live, 'moveSpeed', s.moveSpeed, (v) => String(Math.round(v * 100) / 100)),
    interval: liveStat(live, 'interval', interval, (v) => (Number.isFinite(v) && v > 0 ? `${v.toFixed(1)}s` : '—')),
  };
  return html`
    <div class="dhead dhead--enemy">
      <div class=${cx('dhead__icon', 'dhead__icon--enemy', enemy.rank === 'BOSS' && 'is-boss', enemy.rank === 'ELITE' && 'is-elite')}>
        <${Img} src=${enemyIconUrl(m, enemy.key)} fallback=${html`<${GIcon} name="skull" />`} />
      </div>
      <div class="dhead__info">
        <div class="dhead__chips">
          <span class=${cx('drank', `drank--${(enemy.rank || 'NORMAL').toLowerCase()}`)}>${RANK[enemy.rank] || '普通'}</span>
          <span class="dtag-kind">${s.motion === 'FLY' ? '空中' : '地面'}</span>
          ${count ? html`<span class="dtag-kind num">×${count}</span>` : null}
        </div>
        <h3 class="dhead__name">${enemy.name}</h3>
        <div class="dfactions">${types.map((t) => html`<span key=${t} class="dfaction"><${Img} src=${factionIconUrl(m, factions[t]?.icon)} />${factions[t]?.name || t}</span>`)}</div>
        ${hp ? html`<div class="dhp dhp--enemy"><i style=${`width:${Math.max(0, Math.min(100, (hp.hp / Math.max(1, hp.max)) * 100))}%`}></i><span class="num">${fmtNum(hp.hp)} / ${fmtNum(hp.max)}</span></div>` : null}
      </div>
    </div>
    <div class=${cx('dstats', live && 'is-live')} data-live=${live ? live.src || 'battle' : undefined}>
      <${LiveTag} live=${live} />
      <${Stat} k="生命上限" ...${st.maxHp} />
      <${Stat} k="攻击" ...${st.atk} sub=${st.atk.sub || DMG[s.dmgType] || ''} />
      <${Stat} k="防御" ...${st.def} />
      <${Stat} k="法术抗性" ...${st.res} />
      <${Stat} k="移动速度" ...${st.moveSpeed} />
      <${Stat} k="攻击间隔" ...${st.interval} />
      <${Stat} k="攻击范围" v=${s.rangeRadius > 0 ? s.rangeRadius : '近战'} />
      <${Stat} k="目标价值" v=${s.lpr ?? 1} />
    </div>
    ${imm.length ? html`<p class="dhint"><${Icon} name="shield" />免疫：${imm.join('、')}</p>` : null}
    ${Array.isArray(enemy.abilities) && enemy.abilities.length ? html`<${Section} title="能力" micro="ABILITIES">
      <ul class="dabil">${enemy.abilities.map((a, i) => html`<li key=${i}><${RichText} text=${typeof a === 'string' ? a : a.textRaw || a.text} /></li>`)}</ul>
    <//>` : enemy.descRaw || enemy.desc ? html`<${Section} title="说明"><${RichText} as="p" text=${enemy.descRaw || enemy.desc} class="dtext" /><//>` : null}`;
}

/**
 * How a summon piece placed in the prep phase takes the field (user playtest #6; sim/content/tokens.js): a talent
 * summon deploys with the board; a skill's summon (赫默's 医疗探机, 巫恋's 诅咒娃娃) once at the battle start and again
 * with each skill (`startDeploy`: shared/constants.js SKILL_SUMMON_START_DEPLOY, the PRTS reading the user settled) —
 * or, with the switch off, only when its owner's skill fires. null for tokens that are no hand piece.
 * @param {any} token tokens.json record
 * @param {boolean} [startDeploy] the sim's switch (tests pass both values)
 */
export function summonDeployHint(token, startDeploy = SKILL_SUMMON_START_DEPLOY) {
  if (!token || token.kind !== 'summon' || token.placeable !== true) return null;
  const talent = Object.values(token.variants || {}).some((v) => (v?.sources || []).includes('talent'));
  if (talent) return '作战开始时在摆放的位置部署';
  return startDeploy
    ? '作战开始时在摆放的位置部署一次，之后所属干员每次发动技能时再次出现（未摆放则不会出现）'
    : '所属干员发动技能时才在摆放的位置出现（未摆放则不会出现）';
}

/**
 * The token variant of the summon's owner (tokens.json `variants`, keyed by owner chess id): a golden owner's `_b`
 * entry (精锐 赫默's drone ATK 114, 精锐 巫恋's doll −30%), else its normal `_a` entry, else the first one.
 * @param {any} token tokens.json record
 * @param {string|null} ownerId the owner's chess id (null: unknown, e.g. a teammate's summon)
 */
export function tokenVariantFor(token, ownerId = null) {
  const vs = token?.variants || {};
  if (typeof ownerId === 'string') {
    const v = vs[ownerId] || vs[ownerId.replace(/_b$/, '_a')];
    if (v) return v;
  }
  return Object.values(vs)[0] || null;
}

/** Chess id of the operator owning a token piece (`ownerUid`), from the player's own pieces (indexPieces). */
function tokenOwnerId(piece, pieces) {
  if (!piece || piece.kind !== 'token' || !Number.isInteger(piece.ownerUid)) return null;
  const owner = pieces?.get(piece.ownerUid)?.piece;
  return owner && owner.kind === 'chess' ? owner.id : null;
}

export function TokenDetail({ token, piece, ownerId = null, snapHp = null, live = null }) {
  const m = data.get('assets');
  // the owner's variant: its stats, talents and token skill (a golden owner's summon is stronger)
  const v0 = tokenVariantFor(token, ownerId);
  const s = v0?.stats || token.stats || {};
  const hp = hpOf(live, snapHp);
  const st = {
    maxHp: liveStat(live, 'maxHp', s.maxHp), atk: liveStat(live, 'atk', s.atk), def: liveStat(live, 'def', s.def),
    blockCnt: liveStat(live, 'blockCnt', s.blockCnt, (v) => String(v)),
  };
  // what the summon does lives in its talent (凯瑟琳's 支援装置: "使攻击范围内一名友方干员获得…屏障") or token skill (诅咒娃娃)
  const talents = (v0?.talents || []).filter((t) => t && t.name && t.desc);
  const skill = v0?.skill && v0.skill.desc && !/^skcom_withdraw/.test(String(v0.skill.skillId || '')) ? v0.skill : null;
  const hint = piece ? summonDeployHint(token) : null;
  return html`
    <div class="dhead dhead--item">
      <div class="dhead__icon"><${Img} src=${tokenAvatarUrl(m, token.tokenId)} fallback=${html`<${GIcon} name="target" />`} /></div>
      <div class="dhead__info">
        <div class="dhead__chips"><span class="dtag-token">召唤物</span>${piece?.count > 1 ? html`<span class="dtag-kind num">×${piece.count}</span>` : null}</div>
        <h3 class="dhead__name">${token.name}</h3>
        ${hp ? html`<div class="dhp"><i style=${`width:${Math.max(0, Math.min(100, (hp.hp / Math.max(1, hp.max)) * 100))}%`}></i><span class="num">${fmtNum(hp.hp)} / ${fmtNum(hp.max)}</span></div>` : null}
      </div>
    </div>
    <div class=${cx('dstats', live && 'is-live')} data-live=${live ? live.src || 'prep' : undefined}>
      <${LiveTag} live=${live} />
      <${Stat} k="生命上限" ...${st.maxHp} /><${Stat} k="攻击" ...${st.atk} />
      <${Stat} k="防御" ...${st.def} /><${Stat} k="阻挡数" ...${st.blockCnt} />
    </div>
    ${hint ? html`<p class="dhint"><${Icon} name="info" />${hint}</p>` : null}
    ${token.descRaw || token.desc ? html`<${Section} title="说明"><${RichText} as="p" text=${token.descRaw || token.desc} class="dtext" /><//>` : null}
    ${skill ? html`<${Section} title="技能"><p class="dtext"><b>${skill.name}</b> ${skill.desc}</p><//>` : null}
    ${talents.length ? html`<${Section} title="天赋">${talents.map((t, i) => html`<p class="dtext" key=${i}><b>${t.name}</b> ${t.desc}</p>`)}<//>` : null}`;
}

/**
 * Resolve what a detail target shows.
 * @param {{ kind:'piece'|'chess'|'item'|'enemy'|'unit'|'token', id?:string, uid?:number, unit?:any, count?:number }} target
 * @param {Map<number, any>} pieces indexPieces(priv)
 */
export function resolveDetail(target, pieces) {
  if (!target) return null;
  if (target.kind === 'piece') {
    const e = pieces?.get(target.uid);
    if (!e) return null;
    const p = e.piece;
    if (p.kind === 'item') { const it = data.lookup('items', p.id); return it ? { type: 'item', item: it, piece: p } : null; }
    if (p.kind === 'token') { const t = data.lookup('tokens', p.id); return t ? { type: 'token', token: t, piece: p, ownerId: tokenOwnerId(p, pieces) } : null; }
    const c = data.lookup('chess', p.id);
    return c ? { type: 'chess', chess: c, piece: p } : null;
  }
  if (target.kind === 'chess') { const c = data.lookup('chess', target.id); return c ? { type: 'chess', chess: c, hint: target.hint || null } : null; }
  if (target.kind === 'item') { const it = data.lookup('items', target.id); return it ? { type: 'item', item: it } : null; }
  if (target.kind === 'enemy') { const en = data.lookup('enemies', target.id); return en ? { type: 'enemy', enemy: en, count: target.count } : null; }
  if (target.kind === 'token') { const t = data.lookup('tokens', target.id); return t ? { type: 'token', token: t } : null; }
  if (target.kind === 'unit') {
    const u = target.unit || {};
    const own = Number.isInteger(u.uid) ? pieces?.get(u.uid) : null;
    if (u.side === 'enemy') { const en = data.lookup('enemies', u.defId); return en ? { type: 'enemy', enemy: en, unitId: u.id } : null; }
    const c = data.lookup('chess', u.defId);
    if (c) return { type: 'chess', chess: c, piece: own?.piece || null, unitId: u.id };
    const t = data.lookup('tokens', u.defId);
    if (t) return { type: 'token', token: t, unitId: u.id, ownerId: tokenOwnerId(own?.piece, pieces) };
    const en = data.lookup('enemies', u.defId);
    return en ? { type: 'enemy', enemy: en, unitId: u.id } : null;
  }
  return null;
}

/**
 * The panel.
 * @param {{ detail:any, editable:boolean, snapHp?:{hp:number,max:number}|null, onClose:Function, onSell:(piece:any)=>void, onDestroy:(piece:any)=>void,
 *   bonds?: any[], loadout?: any, onBond?: (bondId:string)=>void, side?: 'left'|'right', shopOpen?: boolean }} props
 *   bonds: the owner's m.private.bonds (counts / tiers of the bond chips); loadout: m.private.loadout (DESIGN §16) for
 *   the player's own operators and shop cards; a teammate's unit gets its owner's choice (gameLogic unitLoadout); null
 *   = the defaults
 *   live: the unit's live stats (unitStatsEntry + src 'battle' | 'prep') — an object, or a getter the panel re-reads 4×
 *   a second (the battle's own sim, battle/runner.js unitStats); null ⇒ the record's numbers
 */
export function DetailPanel({ detail, editable, snapHp, onClose, onSell, onDestroy, bonds = [], loadout = null, onBond = null, side = 'left', shopOpen = false, live = null }) {
  const getter = typeof live === 'function' ? live : null;
  useTicker(detail && getter ? 250 : 0);
  if (!detail) return null;
  let liveNow = null;
  try { liveNow = getter ? getter() : live && typeof live === 'object' ? live : null; } catch { liveNow = null; }
  const sellIt = async (piece, chess) => {
    const golden = piece.golden || chess?.isGolden;
    if (golden) {
      const ok = await confirmDialog({ title: '出售精锐干员', text: `确定要出售精锐干员「${chess?.name || ''}」吗？出售后获得 ${chess?.sellPrice ?? 1} 资金。`, okText: '出售', danger: true });
      if (!ok) return;
    }
    onSell(piece);
  };
  const destroyIt = async (piece, item) => {
    const ok = await confirmDialog({ title: '销毁道具', text: `道具无法出售。确定要销毁「${item?.name || ''}」吗？`, okText: '销毁', danger: true });
    if (ok) onDestroy(piece);
  };
  return html`<aside class=${cx('dpanel', 'brackets', `dpanel--${detail.type}`, side === 'right' && 'dpanel--right', side === 'right' && shopOpen && 'is-shop')} role="dialog" aria-label="详情"
      data-side=${side === 'right' ? 'right' : 'left'}>
    <button type="button" class="dpanel__close" aria-label="关闭" onClick=${onClose}><${Icon} name="close" /></button>
    <div class="dpanel__scroll">
      ${detail.type === 'chess' ? html`<${ChessDetail} chess=${detail.chess} piece=${detail.piece} snapHp=${snapHp} editable=${editable} onSell=${sellIt}
        bonds=${bonds} loadout=${loadout} onBond=${onBond} live=${liveNow} hint=${detail.hint || null} />` : null}
      ${detail.type === 'item' ? html`<${ItemDetail} item=${detail.item} piece=${detail.piece} editable=${editable} onDestroy=${destroyIt} />` : null}
      ${detail.type === 'enemy' ? html`<${EnemyDetail} enemy=${detail.enemy} snapHp=${snapHp} count=${detail.count} live=${liveNow} />` : null}
      ${detail.type === 'token' ? html`<${TokenDetail} token=${detail.token} piece=${detail.piece} ownerId=${detail.ownerId ?? null} snapHp=${snapHp} live=${liveNow} />` : null}
    </div>
  </aside>`;
}

