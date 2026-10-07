// Detail panel (click / right-click a piece, shop card, bond member, battle unit or previewed enemy):
// operators — portrait, name, tier, elite, class/subclass and, right under them in the header's right column (no
// scrolling, user playtest #2 item 9), the unit's bonds (阵营 / 盟约: icon, name, member count / next threshold,
// reached tier, active state — tap one for its popup; a bond the mode never activates reads 本局禁用, gameLogic
// modeOffBonds; a bond its 变形同构体 pairing grants (gameLogic pieceBondIds: its piece's items, a teammate's unit:
// UnitInfo `items`, a bond popup's 同构 row: the wearer's) has a dashed chip tagged 同构 — the wearer counts for it);
// right under the header the operator's own effect (特质 —
// garrison: type chip (its official type icon + eventTypeDesc such as 整备能力, garrisonTypeIconKey) + description,
// compact, visible without scrolling: user playtest #3 items 8 / 9), the class trait (特性), stats + range mini-map, skill (the one chosen in the loadout, DESIGN §16: icon, SP
// info, rich description, 已调配 when not the default), elite module (模组: official type icon from the local-client
// art, else its letter), equipped items (read-only from those `items` when the card has no own piece), talents
// (CHESS_SECTIONS); items — icon, tier,
// effect; 变形同构体 (`canGiveBond`) also its 天赋栏 list (MorphPairings, gameLogic morphPairings: per bond the items that
// make the wearer its member, 本局禁用 marked; on a wearer's card the pairing it wears highlighted, 生效中 — GitHub issue
// #1, DESIGN §21.26) and a bond item (`giveBondId`) the line "与变形同构体一同装备时，携带者视为【X】成员" (MorphGrantLine);
// tokens — the owner's variant (a golden owner's summon: its `_b` stats / skill), how a placed summon takes
// the field (shared/constants.js SKILL_SUMMON_START_DEPLOY), its token skill and talents; a band map character (外勤医疗's
// Touch / 预备干员-医疗, tokens.json kind 'mapChar') — an operator of the mode: 干员, its class, 特性, skill and talents
// from its own record (MapCharDetail, GitHub #260); a skill text the game contradicts gets the line under it that says
// what the sim does (SKILL_TEXT_NOTES: Touch 恳切福音's 低于一半, PRTS 修正); enemies — stats, rank,
// faction tags, abilities. Selling / destroying is the underframe's job in the
// match (research 09 §5, ui/underframe.js): the panel's own 出售 / 销毁 buttons only render for callers that pass
// `editable` + handlers. `side` 'right' docks the panel at the right edge (the game screen picks the side away from a
// selected unit's underframe, gameLogic panelSide).
// Live stats (user playtest #4 item 7 — the card used to show the fixed record numbers): `live` = the unit's current
// stats (shared/protocol.js unitStatsEntry + `src`) — in battle the browser's own sim (battle/runner.js unitStats; a
// getter re-read 4× a second: current HP, max HP, ATK, DEF, RES, attack interval, block), in prep the stats the own
// board's units start their next battle with (m.unitStats: equipment, bonds / layers, 特质, band and 机变 effects). Each
// value is coloured against the unit's base like the official card — green when it helps (higher, or a shorter attack
// interval) with the difference beside it, red when it hurts — and a 实时 / 开战时 tag says which it is. The 攻击范围
// mini-map follows the live entry's `range` too (cardRangeGrid: the grid the unit attacks with now — a running skill's
// range such as 烛煌 S3's 4-11, rangeExtend included; community report E1 after 0.1.0, it used to stay the base grid);
// a grid larger than the box (RANGE_FIT) draws smaller cells (rangeGridStyle), a whole-field one reads 全场.
// The stats block (chessStatsBlock), the 特性 text (traitText) and the talent list (chessTalents) are exported: the 干员调配
// screen's 局内数值 section draws the same ones for the chosen skill / module, without a live entry (GitHub issue #64).

import { useEffect } from '../../vendor/hooks.module.js';
import { html, Icon, TierChip, MicroLabel, Button, confirmDialog, useTicker } from './components.js';
import { Img, RichText, UnitThumb, BondGlyph, GIcon, diyToken } from './gameComponents.js';
import { attackInterval, rangeGridBox, fmtNum, tileKey, chessLoadout, nextThreshold, bondTier, briefingBondTip, pieceBondIds, grantedBonds, morphPairings, ownStandIn, standInOf, standInLoadout, standInLabel, standInTip, standInForText, ownDiyRecord, ownDiyPick, diyRecordFor, pickGetter } from './gameLogic.js';
import { chessPortraitUrl, skillIconUrl, skillRecordIconUrl, profIconUrl, subProfIconUrl, itemIconUrl, enemyIconUrl, tokenAvatarUrl, factionIconUrl, uiUrl, moduleTypeIconUrl } from './assetUrls.js';
import { abilityRows } from './abilityLines.js';
import { data } from '../data.js';
import { attackRangeGrid } from '../../../shared/loadoutRecord.js';
import { SKILL_SUMMON_START_DEPLOY } from '../../../shared/constants.js';
import { moduleBadge, fullTraitText } from './loadoutModel.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { audio } from '../audio.js';
import { tokenVariantFor } from './gameLogic/loadout.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const PROF_NAME = { PIONEER: N_('先锋'), WARRIOR: N_('近卫'), TANK: N_('重装'), SNIPER: N_('狙击'), CASTER: N_('术师'), MEDIC: N_('医疗'), SUPPORT: N_('辅助'), SPECIAL: N_('特种'), TOKEN: N_('召唤物') };
const SP_TYPE = { INCREASE_WITH_TIME: N_('自动回复'), INCREASE_WHEN_ATTACK: N_('攻击回复'), INCREASE_WHEN_TAKEN_DAMAGE: N_('受击回复'), ON_DEPLOY: N_('被动') };
const SKILL_TYPE = { MANUAL: N_('自动触发'), AUTO: N_('自动触发'), PASSIVE: N_('被动') };
/** Fallback type icon by trigger, for a garrison record without its official `eventTypeIcon` (garrisonTypeIconKey). */
const EVENT_ICON = { IN_BATTLE: 's_icon_battle', SERVER_GAIN: 's_icon_bond', SERVER_PREP_START: 's_icon_bond', SERVER_PREP_FIN: 's_icon_bond', SERVER_CHESS_SOLD: 's_icon_gold', SERVER_PRICE: 's_icon_gold', SERVER_REFRESH_SHOP: 's_icon_gold' };
/**
 * A skill text the game contradicts, by skill id: the record keeps the official sentence, the card adds what the sim
 * does under it (a PRTS 修正 the kit follows). Touch 恳切福音 (the 外勤医疗 map character's and the Touch 补位's):
 * "对生命值不高于一半的友方单位" — PRTS corrects it to 低于 (原因 6), and content/tokens.js touchGospel boosts strictly
 * below half (GitHub #260).
 */
const SKILL_TEXT_NOTES = { skchr_acmedc_3: N_('实际为生命值低于一半时提高治疗量，正好一半不提高（PRTS 修正，原文为“不高于”）') };
const RANK = { NORMAL: N_('普通'), ELITE: N_('精英'), BOSS: N_('领袖') };
const DMG = { phys: N_('物理'), arts: N_('法术'), heal: N_('治疗'), true: N_('真实'), none: N_('无') };

/** A range grid of at least this many tiles covers the field (纯烬艾雅法拉 S3 "攻击范围扩大至整个战场"): named, not drawn. */
export const FIELD_WIDE_CELLS = 400;
/**
 * Columns × rows of the mini-map's own cells (.14rem, 2px apart) the card's range box holds without growing: the widest
 * record attack range (灰毫's 6 columns) and the tallest live one (银灰 S3's 7 rows). A larger grid — a live skill range
 * such as 远牙 S3's line to the field's edge (21 tiles) — draws smaller cells, edge to edge, in that space, so the box keeps
 * its size and the stats beside it stay readable.
 */
export const RANGE_FIT = Object.freeze({ cols: 6, rows: 7 });

/** Inline style of the mini-map (rangeGridBox `box`): its columns, and smaller cells when the grid exceeds RANGE_FIT. */
export function rangeGridStyle(box) {
  const cols = `grid-template-columns:repeat(${box.cols}, var(--rg))`;
  if (box.cols <= RANGE_FIT.cols && box.rows <= RANGE_FIT.rows) return cols;
  const fit = (n, k) => `calc((${k} * .14rem + ${(k - 1) * 2}px) / ${n})`;
  return `${cols};gap:0;--rg:max(1px, min(.14rem, ${fit(box.cols, RANGE_FIT.cols)}, ${fit(box.rows, RANGE_FIT.rows)}))`;
}

/**
 * The grid the card's 攻击范围 shows: the live entry's `range` (shared/protocol.js unitStatsEntry — what the unit attacks
 * with now: a running skill's range, rangeExtend included), else the loadout record's attack range at deployment
 * (shared/loadoutRecord.js attackRangeGrid: an elite's module grid, a passive range skill, the 特性's 攻击距离 — the same
 * tiles as the board overlay and the deploy wheel), else the record's own.
 * @param {any} live unitStatsEntry (+ src) or null @param {any} rec loadout-resolved record @param {any} chess
 * @returns {number[][]|null}
 */
export function cardRangeGrid(live, rec, chess) {
  if (live && Array.isArray(live.range) && live.range.length) return live.range;
  return attackRangeGrid(rec) || chess?.rangeGrid || null;
}

/** Mini range map. */
export function RangeGrid({ grid, class: cls }) {
  if (Array.isArray(grid) && grid.length >= FIELD_WIDE_CELLS) return html`<span class=${cx('rgrid-all', cls)} aria-label=${t('攻击范围')}>${t('全场')}</span>`;
  const box = rangeGridBox(grid);
  if (!box.cells.size) return html`<span class="t-dim">—</span>`;
  const cells = [];
  for (let r = box.r0; r > box.r0 - box.rows; r--) {
    for (let c = box.c0; c < box.c0 + box.cols; c++) {
      const self = r === 0 && c === 0;
      cells.push(html`<i key=${`${r},${c}`} class=${cx(box.cells.has(tileKey(r, c)) && 'on', self && 'self')}></i>`);
    }
  }
  return html`<div class=${cx('rgrid', cls)} style=${rangeGridStyle(box)} aria-label=${t('攻击范围')}>${cells}</div>`;
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
  return { v: fmt(cur), tone, sub, title: base != null ? t('基础 {v}', { v: fmt(base) }) : undefined };
}

/** The tag of a live stats block: 实时 (battle) / 开战时 (the prep preview). */
function LiveTag({ live }) {
  if (!live) return null;
  const battle = live.src === 'battle';
  return html`<span class=${cx('dstats__tag', battle && 'is-battle')} title=${battle ? t('当前作战中的实时数值（绿色为增益，红色为减益）')
    : t('下一场作战开始时的数值：已计入装备、盟约层数、特质、策略与机变效果（不含技能与作战中的临时效果）')}>${battle ? t('实时') : t('开战时')}</span>`;
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

const isOffIn = (off, bondId) => !!(off && typeof off.has === 'function' && off.has(bondId));

/**
 * The 变形同构体's 天赋栏 (gameLogic morphPairings): "搭配以下装备时，携带者视为对应盟约的成员：", then one line per bond — 【bond】
 * and the items that pair with it; a bond the mode never activates (`off`, gameLogic modeOffBonds) struck through with
 * 本局禁用. `carried` (the wearer's items — the card shows the item on an operator): the pairing it wears is highlighted
 * (生效中; 已搭配 when that bond is off), and a wearer without one reads 暂未生效.
 * @param {{ off?: Set<string>|null, carried?: Array<string|{id:string}>|null }} props
 */
export function MorphPairings({ off = null, carried = null }) {
  const rows = morphPairings(data.list('items'), data.list('bonds'), { off, carried });
  if (!rows.length) return null;
  const wearer = Array.isArray(carried);
  return html`<div class=${cx('dmorph', wearer && 'is-wearer')}>
    <p class="dmorph__lead">${t('搭配以下装备时，携带者视为对应盟约的成员：')}</p>
    <ul class="dmorph__list" aria-label=${t('变形同构体对应关系')}>
      ${rows.map((r) => html`<li key=${r.bondId} class=${cx('dmorph__row', r.off && 'is-off', r.worn && 'is-worn')} data-bond=${r.bondId}
          title=${`${t('{items} → 【{name}】', { items: r.items.map((it) => it.name), name: r.name })}${r.off ? t('（本局禁用）') : ''}`}>
        <span class="dmorph__bond">${t('【{name}】', { name: r.name })}</span>
        <span class="dmorph__items">${r.items.map((it, i) => html`<span key=${it.id} class=${cx('dmorph__item', it.worn && 'is-worn')}>${i ? tc('list', '、') : ''}${it.name}</span>`)}${r.worn
          ? html`<span class="dmorph__tag is-on">${r.off ? t('已搭配') : t('生效中')}</span>` : null}${r.off ? html`<span class="dmorph__tag is-off">${t('本局禁用')}</span>` : null}</span>
      </li>`)}
    </ul>
    ${wearer && !rows.some((r) => r.worn) ? html`<p class="dmorph__none">${t('暂未生效：需与上表中的一件装备一同携带')}</p>` : null}
  </div>`;
}

/**
 * A bond item's own line (items.json `giveBondId`): "与变形同构体一同装备时，携带者视为【X】成员" — 本局禁用 when the mode never
 * activates X; on a wearer that also carries a 变形同构体 (`carried`) it is in effect (生效中).
 * @param {{ item: any, off?: Set<string>|null, carried?: Array<string|{id:string}>|null }} props
 */
export function MorphGrantLine({ item, off = null, carried = null }) {
  const bond = item && !item.canGiveBond && typeof item.giveBondId === 'string' ? data.lookup('bonds', item.giveBondId) : null;
  if (!bond) return null;
  const morph = data.list('items').find((r) => r && r.canGiveBond);
  if (!morph) return null;
  const isOff = isOffIn(off, item.giveBondId);
  const worn = grantedBonds(carried, (id) => data.lookup('items', id)).includes(item.giveBondId);
  return html`<p class=${cx('dhint', 'dhint--morph', worn && 'is-worn', isOff && 'is-off')} data-bond=${item.giveBondId}>
    <${Icon} name="info" /><span>${t('与{morph}一同装备时，携带者视为【{bond}】成员', { morph: morph.name, bond: bond.name })}${isOff ? html`<span class="dmorph__tag is-off">${t('本局禁用')}</span>` : null}${worn
      ? html`<span class="dmorph__tag is-on">${isOff ? t('已搭配') : t('生效中')}</span>` : null}</span>
  </p>`;
}

/** An equipped item of the card: icon, name, effect — and for 变形同构体 / a bond item its pairing (`carried`: the wearer's items). */
function ItemRow({ itemId, carried = null, off = null }) {
  const it = data.lookup('items', itemId);
  return html`<div class="ditem">
    <${UnitThumb} kind="item" id=${itemId} size="sm" />
    <div class="ditem__text"><b>${it?.name || itemId}</b><${RichText} text=${it?.descRaw || it?.desc || ''} class="ditem__desc" />
      ${it?.canGiveBond ? html`<${MorphPairings} off=${off} carried=${carried || []} />` : it?.giveBondId ? html`<${MorphGrantLine} item=${it} off=${off} carried=${carried} />` : null}</div>
  </div>`;
}

/**
 * The unit's bonds right under the header: icon, name, the player's member count / next threshold, reached tier.
 * `granted`: the bonds among them the unit holds through 变形同构体 (dashed chip, 同构 tag).
 * @param {{ bondIds: string[], bonds?: any[], onBond?: (bondId: string) => void, off?: Set<string>|null, granted?: string[] }} props —
 *   off: the bonds the mode never activates (gameLogic modeOffBonds): 本局禁用 instead of the count
 */
export function BondChips({ bondIds, bonds = [], onBond = null, off = null, granted = [] }) {
  const ids = Array.isArray(bondIds) ? bondIds.filter((b) => typeof b === 'string') : [];
  if (!ids.length) return null;
  const iso = new Set(Array.isArray(granted) ? granted : []);
  const mine = new Map((Array.isArray(bonds) ? bonds : []).filter((b) => b && typeof b.bondId === 'string').map((b) => [b.bondId, b]));
  return html`<div class="dbonds dbonds--top" role="list" aria-label=${t('所属盟约')}>
    ${ids.map((id) => {
      const rec = data.lookup('bonds', id);
      // a bond this mode never activates (gameLogic modeOffBonds): 本局禁用, no count or tier pips
      const isOff = !!(off && typeof off.has === 'function' && off.has(id));
      const e = mine.get(id) || null;
      const th = Array.isArray(e?.thresholds) && e.thresholds.length ? e.thresholds : Array.isArray(rec?.thresholds) ? rec.thresholds : [];
      const count = Number.isFinite(e?.count) ? e.count : 0;
      const tier = isOff ? 0 : Number.isFinite(e?.tier) ? e.tier : bondTier(count, th, rec?.maxCount ?? null);
      const active = !isOff && (e ? !!e.active : tier > 0);
      const next = nextThreshold(count, th);
      const cap = next ?? th[th.length - 1] ?? null;
      const isoTag = iso.has(id) ? t('（变形同构体）') : '';
      // the count holds 调和's +1 (the server's bond entry says so, DESIGN §21.26)
      const harmonyTag = !isOff && Number.isInteger(e?.harmony) && e.harmony > 0 ? t('（含调和 +{harmony}）', { harmony: e.harmony }) : '';
      const label = isOff ? briefingBondTip(rec?.name || id, 'off')
        : `${rec?.name || id}${isoTag}${cap != null ? t('：在场 {count}/{cap}', { count, cap }) : t('：在场 {count}', { count })}${harmonyTag}${active ? t('，已激活 {tier} 阶', { tier }) : t('，未激活')}`;
      const body = isOff
        ? html`
        <${BondGlyph} bondId=${id} class="dbond__icon" />
        <span class="dbond__name">${rec?.name || id}</span>
        ${iso.has(id) ? html`<span class="dbond__iso">${t('同构')}</span>` : null}
        <span class="dbond__off">${t('本局禁用')}</span>`
        : html`
        <${BondGlyph} bondId=${id} class="dbond__icon" />
        <span class="dbond__name">${rec?.name || id}</span>
        ${iso.has(id) ? html`<span class="dbond__iso">${t('同构')}</span>` : null}
        <span class=${cx('dbond__count', 'num', next == null && count > 0 && 'is-max')}>${count}${cap != null ? html`<small>/${cap}</small>` : null}</span>
        ${th.length ? html`<span class="dbond__tiers" aria-hidden="true">${th.map((_, i) => html`<i key=${i} class=${i < tier ? 'on' : ''}></i>`)}</span>` : null}`;
      const cls = cx('dbond', active && 'is-active', isOff && 'is-off', rec?.isCore && 'is-core', iso.has(id) && 'is-granted');
      return onBond
        ? html`<button key=${id} type="button" role="listitem" class=${cls} title=${label} aria-label=${label}
            data-bond=${id} data-granted=${iso.has(id) ? '1' : null} onClick=${() => onBond(id)}>${body}</button>`
        : html`<span key=${id} role="listitem" class=${cls} title=${label} data-bond=${id} data-granted=${iso.has(id) ? '1' : null}>${body}</span>`;
    })}
  </div>`;
}

/**
 * 特性 text of the record the unit fights with (DESIGN §16: `lo.record` = the chosen module's traitOverride, or the
 * no-module traitBase for 不装备 — data `trait` is the default module's). Also the 干员调配 screen's (screens/loadout.js).
 */
export function traitText(c, golden, lo) {
  const t = (lo?.record || c).trait || {};
  if (!golden) return t.descRaw || t.desc || '';
  // the class trait (or the module's rewrite of it), then the record's own module line — also for a record cloned for
  // another skill or module (a 不装备 record carries none). Until 0.1.2 a clone fell back to the class trait (Grok review
  // of GitHub #64); until 0.2.0 the module line replaced the class trait (community report of 2026-10-06, item 16.2).
  return fullTraitText(t);
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
  return html`<section class="dgarrison" aria-label=${t('特质')} data-garrison=${garrison.garrisonId || ''}>
    <div class="dgarrison__head">
      <span class="dgarrison__k">${t('特质')}</span>
      <span class="dgarrison__type">
        <${Img} src=${uiUrl(m, `garrisonTypeIcon/${garrisonTypeIconKey(garrison)}`)} class="dgarrison__icon" />
        ${garrison.eventTypeDesc || ''}
      </span>
    </div>
    <${RichText} as="p" text=${garrison.descRaw || garrison.desc} class="dgarrison__text" />
  </section>`;
}

/** The talents the card lists (天赋): the loadout record's named, not hidden ones. */
export function chessTalents(rec) {
  return (Array.isArray(rec?.talents) ? rec.talents : []).filter((t) => t && t.name && !t.hidden);
}

/**
 * The card's stats block (block key "stats"): the eight stats and the 攻击范围 mini-map. `rec` = the loadout-resolved
 * record the unit fights with (chessLoadout `.record`: the chosen module's stats, the chosen skill's passive range),
 * `chess` the chess record (the range's fallback), `live` the live / start-of-battle entry (liveStat) or null — the
 * record's own numbers, untagged. A plain function (its root node keeps the key), shared by the detail card and the
 * 干员调配 screen (screens/loadout.js 局内数值, GitHub issue #64): one block, so the two never disagree.
 * @param {{ rec: any, chess: any, live?: any }} p
 */
export function chessStatsBlock({ rec, chess, live = null }) {
  const s = rec?.stats || {};
  const interval = attackInterval(s.bat, s.aspd);
  // live (battle) / start-of-battle (prep) values against the base, else the record's (liveStat)
  const st = {
    maxHp: liveStat(live, 'maxHp', s.maxHp), atk: liveStat(live, 'atk', s.atk), def: liveStat(live, 'def', s.def),
    res: liveStat(live, 'res', s.res ?? 0, fmtRes), interval: liveStat(live, 'interval', interval, fmtInterval),
    blockCnt: liveStat(live, 'blockCnt', s.blockCnt, (v) => String(v)),
  };
  return html`
    <div key="stats" class=${cx('dstats-wrap', live && 'is-live')} data-live=${live ? live.src || 'prep' : undefined}>
      <div class="dstats">
        <${LiveTag} live=${live} />
        <${Stat} k=${t('生命上限')} ...${st.maxHp} />
        <${Stat} k=${t('攻击')} ...${st.atk} />
        <${Stat} k=${t('防御')} ...${st.def} />
        <${Stat} k=${t('法术抗性')} ...${st.res} />
        <${Stat} k=${t('攻击间隔')} ...${st.interval} />
        <${Stat} k=${t('阻挡数')} ...${st.blockCnt} />
        <${Stat} k=${t('部署费用')} v=${s.cost ?? '—'} />
        <${Stat} k=${t('再部署')} v=${s.respawnTime != null ? `${s.respawnTime}s` : '—'} />
      </div>
      <div class="drange"><span class="dstat__k">${t('攻击范围')}</span><${RangeGrid} grid=${cardRangeGrid(live, rec, chess)} /></div>
    </div>`;
}

/** A skill's tags (SP type, trigger, initial SP · cost, duration, charges): the operator card's and a map character's. */
function skillTags(sk) {
  return html`
    <span class="dsp dsp--${sk.spType === 'INCREASE_WHEN_ATTACK' ? 'atk' : sk.spType === 'INCREASE_WHEN_TAKEN_DAMAGE' ? 'def' : 'time'}">${t(SP_TYPE[sk.spType]) || t('技力')}</span>
    <span class="dsp dsp--trig">${t(SKILL_TYPE[sk.skillType]) || t('自动触发')}</span>
    ${sk.spType !== 'ON_DEPLOY' && sk.skillType !== 'PASSIVE' ? html`<span class="dsp__num"><${GIcon} name="bolt" />${t('初始')} <b class="num">${sk.initSp ?? 0}</b> ${t('· 消耗')} <b class="num">${sk.spCost ?? 0}</b></span>` : null}
    ${sk.duration > 0 ? html`<span class="dsp__num">${t('持续')} <b class="num">${sk.duration}</b>s</span>` : null}
    ${sk.maxChargeTime > 1 ? html`<span class="dsp__num">${t('充能')} <b class="num">${sk.maxChargeTime}</b></span>` : null}`;
}

/** The line under a skill text the game contradicts (SKILL_TEXT_NOTES), or null. */
function skillTextNote(sk) {
  const note = sk && SKILL_TEXT_NOTES[sk.skillId];
  return note ? html`<p class="dhint dhint--rule" data-skill-note=${sk.skillId}><${Icon} name="info" />${t(note)}</p>` : null;
}

export function ChessDetail({ chess, piece, unit, snapHp, editable, onSell, bonds, offBonds = null, loadout, onBond, live = null, hint = null, unitItems = null, standIn = null, diy = null }) {
  const m = data.get('assets');
  const hp = hpOf(live, snapHp);
  // 0.2.0 自选编队: `chess` is then the composed 自选 record (the operator, the slot's tier / price); its skill and module are
  // the pick's — the lookups resolve the slot's ids to the same pick (shared/diy.js), so the loadout reads them as defaults
  const getChess = diy ? pickGetter((id) => data.lookup('chess', id), diy, { chess: data.get('chess'), backups: data.get('backups') }) : (id) => data.lookup('chess', id);
  // 0.2.0 补位: a chess fielded as its stand-in shows the stand-in — portrait, name, class, 特性, stats, range, skill,
  // talents, module (its backup selection, no loadout) — under a small 「替补」 tag, with the replaced operator's name
  // where the English name usually is (「银灰的替补」, [ASSUMED] placement); the chess's tier, bonds, 特质 and sell price
  // still apply (the owner's recall of the official mode, 2026-10-06)
  const si = standIn && standIn.standInFor ? standIn : null;
  const body = si || chess;
  const lo = si ? standInLoadout(si, getChess, data.get('backups')) : chessLoadout(chess, loadout, getChess);
  const c = chess;
  // stats / talents the unit fights with: the chosen module's (or none — statsBase) for an elite (DESIGN §16)
  const fr = lo?.record || body;
  const golden = !!(c.isGolden || piece?.golden);
  const sk = lo?.skill || body.skill || null;
  // a chosen skill the manifest has no icon for (only the default skills' icons are fetched): its slot letter
  const skIcon = sk && lo && !lo.defaultSkill ? skillRecordIconUrl(m, sk, { empty: false }) : skillIconUrl(m, body);
  const skSlot = sk && Number.isInteger(sk.index) ? `S${sk.index + 1}` : null;
  const garrison = Array.isArray(c.garrisonIds) && c.garrisonIds[0] ? data.lookup('garrisons', c.garrisonIds[0]) : null;
  const items = Array.isArray(piece?.items) ? piece.items : [];
  // the bonds the unit counts for: its own + a 变形同构体 pairing's (its piece's items; without one: `unitItems` — a
  // teammate's unit's UnitInfo items, a bond popup 同构 row's wearer's)
  const carried = piece ? items : (Array.isArray(unitItems) ? unitItems : []);
  const getItem = (id) => data.lookup('items', id);
  const bondIds = pieceBondIds(c, carried, getItem);
  const grantedIds = bondIds.filter((b) => !(Array.isArray(c.bonds) && c.bonds.includes(b)));
  const sell = c.sellPrice ?? 1;
  const blocks = {};
  blocks.head = html`
    <div key="head" class="dhead">
      <div class=${cx('dhead__art', golden && 'is-golden', `dhead__art--t${c.tier}`)}>
        <${Img} src=${chessPortraitUrl(m, body)} fallback=${html`<${UnitThumb} kind="chess" id=${c.chessId} size="lg" rec=${si} />`} />
      </div>
      <div class="dhead__info">
        <div class="dhead__chips">
          <${TierChip} tier=${c.tier} golden=${golden} size="lg" />
          ${golden ? html`<span class="dtag-elite">${t('精锐')}</span>` : null}
          ${piece?.kind === 'token' ? html`<span class="dtag-token">${t('召唤物')}</span>` : null}
          ${si ? html`<span class="dtag-standin" data-standin=${si.charId} title=${standInTip(si, c.name)}>${standInLabel(si)}</span>` : null}
          ${diy ? html`<span class="dtag-diy" data-diy=${c.charId || ''} title=${t('自选编队：所选技能与模组，没有特质，盟约按所属阵营分配')}>${t('自选')}</span>` : null}
        </div>
        <h3 class="dhead__name">${si ? si.name : c.name}</h3>
        ${si ? html`<span class="dhead__for" data-for=${c.chessId}>${standInForText(c.name)}</span>` : html`<span class="dhead__en">${c.appellation || ''}</span>`}
        <div class="dhead__class">
          <${Img} src=${profIconUrl(m, body.profession)} class="dhead__prof" />
          <span>${t(PROF_NAME[body.profession]) || body.profession || ''}</span>
          <i class="sep"></i>
          <${Img} src=${subProfIconUrl(m, body)} class="dhead__sub" />
          <span>${body.subProfessionName || ''}</span>
          <span class="dhead__pos">${body.position === 'MELEE' ? t('近战位') : t('远程位')}</span>
        </div>
        ${hp ? html`<div class="dhp"><i style=${`width:${Math.max(0, Math.min(100, (hp.hp / Math.max(1, hp.max)) * 100))}%`}></i><span class="num">${fmtNum(hp.hp)} / ${fmtNum(hp.max)}</span></div>` : null}
        <${BondChips} bondIds=${bondIds} bonds=${bonds} off=${offBonds} onBond=${onBond} granted=${grantedIds} />
      </div>
    </div>`;
  blocks.garrison = garrison ? html`<${GarrisonBlock} key="garrison" garrison=${garrison} m=${m} />` : null;
  blocks.trait = body.trait?.desc ? html`<p key="trait" class="dtrait"><${Icon} name="info" /><${RichText} text=${traitText(body, golden, lo)} /></p>` : null;
  // (`fr` is the body the unit fights with — a stand-in's record for a 补位 chess; `chess` is only the range's fallback)
  blocks.stats = chessStatsBlock({ rec: fr, chess: c, live });
  blocks.skill = sk ? html`<${Section} key="skill" title=${t('技能')} micro="SKILL" class="dsec--skill">
      <div class="dskill" data-skill=${sk.skillId || ''}>
        <${Img} src=${skIcon} class="dskill__icon" fallback=${html`<span class="dskill__icon dskill__icon--empty">${skSlot ? html`<b class="num">${skSlot}</b>` : null}</span>`} />
        <div class="dskill__meta">
          <b class="dskill__name">${skSlot && (lo?.choices || 0) > 1 ? html`<span class="dskill__slot num" title=${t('技能 {skSlot}', { skSlot })}>${skSlot}</span>` : null}${sk.name}${lo && !lo.defaultSkill && !si ? html`<span class="dtag-loadout" title=${t('干员调配中选择的技能')}>${t('已调配')}</span>` : null}</b>
          <div class="dskill__tags">${skillTags(sk)}</div>
        </div>
      </div>
      <${RichText} as="p" text=${sk.descRaw || sk.desc} class="dtext" />
      ${skillTextNote(sk)}
    <//>` : null;
  blocks.module = golden && lo?.module ? html`<${Section} key="module" title=${t('模组')} micro="MODULE" class="dsec--module">
      <div class=${cx('dmodule', lo.module.none && 'is-none')} data-module=${lo.module.id}>
        ${!lo.module.none && lo.module.typeName ? html`<span class="dmodule__icon" data-type=${lo.module.typeName}>
          <${Img} src=${moduleTypeIconUrl(data.get('local'), lo.module.typeName)} fallback=${html`<b class="num">${moduleBadge(lo.module)}</b>`} /></span>` : null}
        <b class="dmodule__name">${lo.module.name}</b>
        ${lo.module.typeName ? html`<span class="dmodule__type">${lo.module.typeName}</span>` : null}
        ${!lo.defaultModule && !si ? html`<span class="dtag-loadout" title=${t('干员调配中选择的模组')}>${t('已调配')}</span>` : null}
      </div>
    <//>` : null;
  // (a 变形同构体 / bond item row shows its pairing against what this operator carries: ItemRow `carried`)
  blocks.equip = piece?.kind === 'chess' ? html`<${Section} key="equip" title=${t('装备')} micro=${`EQUIP ${items.length}/2`} class="dsec--equip">
      ${items.length ? items.map((it) => html`<${ItemRow} key=${it.uid} itemId=${it.id} carried=${items} off=${offBonds} />`) : html`<p class="t-dim dempty">${t('拖拽装备至该干员以配发（最多 2 件）')}</p>`}
    <//>`
    // no own piece (a teammate's unit, a bond popup's 变形同构体 row): what it carries, read-only
    : !piece && carried.length ? html`<${Section} key="equip" title=${t('装备')} micro=${`EQUIP ${carried.length}/2`} class="dsec--equip">
      ${carried.map((id, i) => html`<${ItemRow} key=${`${i}:${id}`} itemId=${id} carried=${carried} off=${offBonds} />`)}
    <//>` : null;
  const talents = chessTalents(fr);
  blocks.talents = talents.length ? html`<${Section} key="talents" title=${t('天赋')} micro="TALENT" class="dsec--talent">
      ${talents.map((t, i) => html`<div key=${i} class="dtalent"><b>${t.name}</b><${RichText} text=${t.descRaw || t.desc} class="dtext" /></div>`)}
    <//>` : null;
  blocks.actions = piece && editable && piece.kind !== 'item' ? html`<div key="actions" class="dactions">
      <${Button} variant="amber" icon="close" class="dpanel__sell" onClick=${() => onSell(piece, si || c)}>${t('出售')}<span class="dsell num">+${sell}</span><//>
    </div>` : null;
  const out = CHESS_SECTIONS.map((k) => blocks[k]).filter(Boolean);
  // a merge-completing shop / reward card: where the elite goes (shopBar mergeHint), right under the header
  if (hint) out.splice(1, 0, html`<p key="merge" class="dhint dhint--merge"><${Icon} name="info" />${t('可晋升：{hint}', { hint })}</p>`);
  return out;
}

/**
 * An item's card (hand / temp / shop / reward card). An effect-only item (items.json `shopExcluded`: the special 维式重锤,
 * 突变细胞 — user playtest #4 item 5) says it is never sold and where it comes from (`shopExcludedBy`); a rule the
 * official text leaves out (items.json `note`: 突变细胞 returns to the hand after each use) is shown under the effect.
 * 变形同构体 lists its pairings (its 天赋栏: MorphPairings, `offBonds` marks 本局禁用); a bond item says which bond it gives
 * a 变形同构体 wearer (MorphGrantLine). (An equipped item is shown on its wearer's card: ChessDetail's 装备 rows.)
 */
export function ItemDetail({ item, piece, editable, onDestroy, offBonds = null }) {
  const m = data.get('assets');
  return html`
    <div class="dhead dhead--item">
      <div class=${cx('dhead__icon', item.isGolden && 'is-golden')}><${Img} src=${itemIconUrl(m, item)} fallback=${html`<${GIcon} name="bolt" />`} /></div>
      <div class="dhead__info">
        <div class="dhead__chips"><${TierChip} tier=${item.tier} golden=${item.isGolden} size="lg" />${item.isGolden ? html`<span class="dtag-elite">${t('进阶')}</span>` : null}
          <span class="dtag-kind">${item.itemType === 'MAGIC' ? t('奇术') : t('装备')}</span></div>
        <h3 class="dhead__name">${item.name}</h3>
        ${item.flavor ? html`<span class="dhead__flavor">${item.flavor}</span>` : null}
      </div>
    </div>
    <${Section} title=${t('效果')} micro="EFFECT"><${RichText} as="p" text=${item.descRaw || item.desc} class="dtext" /><//>
    ${item.canGiveBond ? html`<${Section} title=${t('天赋')} micro="TALENT" class="dsec--morph"><${MorphPairings} off=${offBonds} /><//>` : null}
    ${!item.canGiveBond && item.giveBondId ? html`<${MorphGrantLine} item=${item} off=${offBonds} />` : null}
    ${item.note ? html`<p class="dhint dhint--rule"><${Icon} name="info" />${item.note}</p>` : null}
    ${item.itemType === 'MAGIC'
      ? html`<p class="dhint"><${Icon} name="info" />${t('将其拖拽至战场上的格子使用')}</p>`
      : html`<p class="dhint"><${Icon} name="info" />${t('拖拽至干员身上进行配发（每名干员最多 2 件，配发后无法取下）')}${item.mergeable ? t('；2 件相同装备自动合成进阶装备') : ''}</p>`}
    ${item.shopExcluded ? html`<p class="dhint dhint--source"><${Icon} name="info" />${t('调度中心不出售 · 获取途径：{source}', { source: item.shopExcludedBy || t('效果获得') })}</p>` : null}
    ${piece && editable ? html`<div class="dactions"><${Button} variant="danger" onClick=${() => onDestroy(piece, item)}>${t('销毁道具')}<//></div>` : null}`;
}

function EnemyDetail({ enemy, snapHp, count, live = null }) {
  const m = data.get('assets');
  const s = enemy.stats || {};
  const types = Array.isArray(enemy.acTypes) ? enemy.acTypes : enemy.acType ? [enemy.acType] : [];
  const factions = data.get('factions')?.types || {};
  const imm = Object.entries(s.immunities || {}).filter(([, v]) => v).map(([k]) => ({ stun: t('晕眩'), silence: t('沉默'), sleep: t('沉睡'), frozen: t('冻结'), levitate: t('浮空') }[k] || k));
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
          <span class=${cx('drank', `drank--${(enemy.rank || 'NORMAL').toLowerCase()}`)}>${t(RANK[enemy.rank]) || t('普通')}</span>
          <span class="dtag-kind">${s.motion === 'FLY' ? t('空中') : t('地面')}</span>
          ${count ? html`<span class="dtag-kind num">×${count}</span>` : null}
        </div>
        <h3 class="dhead__name">${enemy.name}</h3>
        <div class="dfactions">${types.map((t) => html`<span key=${t} class="dfaction"><${Img} src=${factionIconUrl(m, factions[t]?.icon)} />${factions[t]?.name || t}</span>`)}</div>
        ${hp ? html`<div class="dhp dhp--enemy"><i style=${`width:${Math.max(0, Math.min(100, (hp.hp / Math.max(1, hp.max)) * 100))}%`}></i><span class="num">${fmtNum(hp.hp)} / ${fmtNum(hp.max)}</span></div>` : null}
      </div>
    </div>
    <div class=${cx('dstats', live && 'is-live')} data-live=${live ? live.src || 'battle' : undefined}>
      <${LiveTag} live=${live} />
      <${Stat} k=${t('生命上限')} ...${st.maxHp} />
      <${Stat} k=${t('攻击')} ...${st.atk} sub=${st.atk.sub || t(DMG[s.dmgType]) || ''} />
      <${Stat} k=${t('防御')} ...${st.def} />
      <${Stat} k=${t('法术抗性')} ...${st.res} />
      <${Stat} k=${t('移动速度')} ...${st.moveSpeed} />
      <${Stat} k=${t('攻击间隔')} ...${st.interval} />
      <${Stat} k=${t('攻击范围')} v=${s.rangeRadius > 0 ? s.rangeRadius : t('近战')} />
      <${Stat} k=${t('目标价值')} v=${s.lpr ?? 1} />
    </div>
    ${imm.length ? html`<p class="dhint"><${Icon} name="shield" />${t('免疫：{list}', { list: imm })}</p>` : null}
    ${Array.isArray(enemy.abilities) && enemy.abilities.length ? html`<${Section} title=${t('能力')} micro="ABILITIES">
      <ul class="dabil">${abilityRows(enemy.abilities, !!live?.silenced).map((a, i) => html`<li key=${i} class=${a.off ? 'is-off' : null}><${RichText} text=${a.text} /></li>`)}</ul>
    <//>` : enemy.descRaw || enemy.desc ? html`<${Section} title=${t('说明')}><${RichText} as="p" text=${enemy.descRaw || enemy.desc} class="dtext" /><//>` : null}`;
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
  if (talent) return t('作战开始时在摆放的位置部署');
  return startDeploy
    ? t('作战开始时在摆放的位置部署一次，之后所属干员每次发动技能时再次出现（未摆放则不会出现）')
    : t('所属干员发动技能时才在摆放的位置出现（未摆放则不会出现）');
}

/** Chess id of the operator owning a token piece (`ownerUid`), from the player's own pieces (indexPieces). */
function tokenOwnerId(piece, pieces) {
  if (!piece || piece.kind !== 'token' || !Number.isInteger(piece.ownerUid)) return null;
  const owner = pieces?.get(piece.ownerUid)?.piece;
  return owner && owner.kind === 'chess' ? owner.id : null;
}

/**
 * A band map character's card (TokenDetail): labelled 干员 with its class (医疗 · 远程位), its 特性, the four stats, its
 * skill — the operator card's row (icon, SP, duration), its text and SKILL_TEXT_NOTES — and its talents, all from the
 * tokens.json record. Until 0.2.1 it took the summon path: 召唤物, base stats only (GitHub #260).
 */
function MapCharDetail({ token, snapHp, live, m }) {
  const s = token.stats || {};
  const hp = hpOf(live, snapHp);
  const st = {
    maxHp: liveStat(live, 'maxHp', s.maxHp), atk: liveStat(live, 'atk', s.atk), def: liveStat(live, 'def', s.def),
    blockCnt: liveStat(live, 'blockCnt', s.blockCnt, (v) => String(v)),
  };
  const sk = token.skill && token.skill.desc ? token.skill : null;
  const talents = chessTalents(token);
  const trait = token.trait?.descRaw || token.trait?.desc || token.descRaw || token.desc || '';
  return html`
    <div class="dhead dhead--item" data-map-char=${token.tokenId}>
      <div class="dhead__icon"><${Img} src=${tokenAvatarUrl(m, token.tokenId)} fallback=${html`<${GIcon} name="target" />`} /></div>
      <div class="dhead__info">
        <div class="dhead__chips"><span class="dtag-kind">${t('干员')}</span></div>
        <h3 class="dhead__name">${token.name}</h3>
        <div class="dhead__class">
          <${Img} src=${profIconUrl(m, token.profession)} class="dhead__prof" />
          <span>${t(PROF_NAME[token.profession]) || token.profession || ''}</span>
          <span class="dhead__pos">${token.position === 'MELEE' ? t('近战位') : t('远程位')}</span>
        </div>
        ${hp ? html`<div class="dhp"><i style=${`width:${Math.max(0, Math.min(100, (hp.hp / Math.max(1, hp.max)) * 100))}%`}></i><span class="num">${fmtNum(hp.hp)} / ${fmtNum(hp.max)}</span></div>` : null}
      </div>
    </div>
    ${trait ? html`<p class="dtrait"><${Icon} name="info" /><${RichText} text=${trait} /></p>` : null}
    <div class=${cx('dstats', live && 'is-live')} data-live=${live ? live.src || 'prep' : undefined}>
      <${LiveTag} live=${live} />
      <${Stat} k=${t('生命上限')} ...${st.maxHp} /><${Stat} k=${t('攻击')} ...${st.atk} />
      <${Stat} k=${t('防御')} ...${st.def} /><${Stat} k=${t('阻挡数')} ...${st.blockCnt} />
    </div>
    ${sk ? html`<${Section} title=${t('技能')} micro="SKILL" class="dsec--skill">
      <div class="dskill" data-skill=${sk.skillId || ''}>
        <${Img} src=${skillRecordIconUrl(m, sk, { empty: false })} class="dskill__icon" fallback=${html`<span class="dskill__icon dskill__icon--empty"></span>`} />
        <div class="dskill__meta">
          <b class="dskill__name">${sk.name}</b>
          <div class="dskill__tags">${skillTags(sk)}</div>
        </div>
      </div>
      <${RichText} as="p" text=${sk.descRaw || sk.desc} class="dtext" />
      ${skillTextNote(sk)}
    <//>` : null}
    ${talents.length ? html`<${Section} title=${t('天赋')} micro="TALENT" class="dsec--talent">
      ${talents.map((x, i) => html`<div key=${i} class="dtalent"><b>${x.name}</b><${RichText} text=${x.descRaw || x.desc} class="dtext" /></div>`)}
    <//>` : null}`;
}

export function TokenDetail({ token, piece, ownerId = null, snapHp = null, live = null }) {
  const m = data.get('assets');
  // a band map character (外勤医疗's Touch / 预备干员-医疗, tokens.json kind 'mapChar') is an operator of the mode, not a
  // summon: no owner variants — its stats, skill, talents and 特性 are on the record (GitHub #260, PR #278)
  if (token?.kind === 'mapChar') return MapCharDetail({ token, snapHp, live, m });
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
        <div class="dhead__chips"><span class="dtag-token">${t('召唤物')}</span>${piece?.count > 1 ? html`<span class="dtag-kind num">×${piece.count}</span>` : null}</div>
        <h3 class="dhead__name">${token.name}</h3>
        ${hp ? html`<div class="dhp"><i style=${`width:${Math.max(0, Math.min(100, (hp.hp / Math.max(1, hp.max)) * 100))}%`}></i><span class="num">${fmtNum(hp.hp)} / ${fmtNum(hp.max)}</span></div>` : null}
      </div>
    </div>
    <div class=${cx('dstats', live && 'is-live')} data-live=${live ? live.src || 'prep' : undefined}>
      <${LiveTag} live=${live} />
      <${Stat} k=${t('生命上限')} ...${st.maxHp} /><${Stat} k=${t('攻击')} ...${st.atk} />
      <${Stat} k=${t('防御')} ...${st.def} /><${Stat} k=${t('阻挡数')} ...${st.blockCnt} />
    </div>
    ${hint ? html`<p class="dhint"><${Icon} name="info" />${hint}</p>` : null}
    ${token.descRaw || token.desc ? html`<${Section} title=${t('说明')}><${RichText} as="p" text=${token.descRaw || token.desc} class="dtext" /><//>` : null}
    ${skill ? html`<${Section} title=${t('技能')}><p class="dtext"><b>${skill.name}</b> ${skill.desc}</p><//>` : null}
    ${talents.length ? html`<${Section} title=${t('天赋')}>${talents.map((t, i) => html`<p class="dtext" key=${i}><b>${t.name}</b> ${t.desc}</p>`)}<//>` : null}`;
}

/**
 * A special terrain tile's tip (GitHub issue #184: 「建议加入对于特殊地形的单击信息提示」). Opened by a tap on the tile
 * itself — the game screen resolves it with `gameLogic.terrainInfo` from the stage the board on screen is built from, so
 * the mechanism lines carry that stage's own numbers (活性源石's damage / duration, 沼泽's stacks, 深水区's drowning …).
 * @param {{ name:string, tag:string, lines:string[], facts:string[], row:number, col:number }} terrain
 */
function TerrainDetail({ terrain }) {
  return html`
    <div class="dhead">
      <div class="dhead__icon"><${Icon} name="info" /></div>
      <div class="dhead__info">
        <div class="dhead__chips"><span class="dtag-kind">${terrain.tag}</span></div>
        <h3 class="dhead__name">${terrain.name}</h3>
      </div>
    </div>
    <${Section} title=${t('地形机制')} micro="TERRAIN">
      ${terrain.lines.map((line, i) => html`<p class="dtext" key=${i}>${line}</p>`)}
    <//>
    ${Array.isArray(terrain.facts) && terrain.facts.length ? html`<${Section} title=${t('这一格')}><p class="dtext">${terrain.facts.join(' · ')}</p><//>` : null}`;
}

/**
 * Resolve what a detail target shows.
 * @param {{ kind:'piece'|'chess'|'item'|'enemy'|'unit'|'token'|'terrain', id?:string, uid?:number, unit?:any, count?:number }} target
 * @param {Map<number, any>} pieces indexPieces(priv)
 * @param {{ priv?: any, backups?: any }} [opts] 0.2.0 补位: the player's own pieces and cards of a chess in
 *   m.private.standIns — a unit carrying `standInFor`, and a teammate's bond popup row that says it (`target.standInFor`)
 *   — resolve with `standIn` (the composed stand-in record the card shows: portrait, name, body, with the chess's
 *   bonds and 特质); 0.2.0 自选编队: the player's own pieces and cards of a DIY slot it filled (m.private.diy) — and a
 *   unit carrying `diy`, and a teammate's bond popup 自选 row that hands its unit's pick on (`target.diy`, 0.2.1) —
 *   resolve to the composed 自选 record (`chess`, the operator) with `diy` = the pick
 */
export function resolveDetail(target, pieces, { priv = null, backups = data.get('backups') } = {}) {
  if (!target) return null;
  // a special terrain tile (issue #184): the screen resolved the stage's own numbers already (gameLogic.terrainInfo)
  if (target.kind === 'terrain') return target.terrain && typeof target.terrain === 'object' ? { type: 'terrain', terrain: target.terrain } : null;
  const ownSi = (c) => ownStandIn(c, priv, backups);
  const dd = { chess: data.get('chess'), backups };
  /** the own card of chess `c`: its 自选 record and pick when the player filled that DIY slot */
  const ownDiy = (c) => {
    const rec = c ? ownDiyRecord(c, priv, dd) : null;
    return rec ? { chess: rec, diy: ownDiyPick(priv, c) } : null;
  };
  if (target.kind === 'piece') {
    const e = pieces?.get(target.uid);
    if (!e) return null;
    const p = e.piece;
    if (p.kind === 'item') { const it = data.lookup('items', p.id); return it ? { type: 'item', item: it, piece: p } : null; }
    if (p.kind === 'token') { const t = data.lookup('tokens', p.id) || diyToken(p.id); return t ? { type: 'token', token: t, piece: p, ownerId: tokenOwnerId(p, pieces) } : null; }
    const c = data.lookup('chess', p.id);
    const d = ownDiy(c);
    if (d) return { type: 'chess', chess: d.chess, piece: p, standIn: null, diy: d.diy };
    return c ? { type: 'chess', chess: c, piece: p, standIn: ownSi(c) } : null;
  }
  if (target.kind === 'chess') {
    // a bond popup's 变形同构体 row hands the wearer's item ids on (bondStrip onMember): the card shows the pair and the chip
    const c = data.lookup('chess', target.id);
    const items = Array.isArray(target.items) ? target.items.filter((x) => typeof x === 'string') : [];
    // (a bond popup's member card of a teammate's strip — `owner` another player — and the mode's banned list (`foreign`)
    // do not read the viewer's 补位 list: a teammate's row shows the stand-in only when its unit says it is one —
    // `target.standInFor`, from UnitInfo through ui/watchBonds.js ownerBoard)
    const foreign = !!target.foreign || (target.owner != null && !!priv && target.owner !== priv.playerId);
    // (a teammate's 自选 row hands its unit's pick on, `target.diy`: their operator, not the empty 甄选干员 slot — 0.2.1)
    const mate = foreign && c && target.diy && typeof target.diy === 'object' ? diyRecordFor(c, target.diy, dd) : null;
    const d = mate ? { chess: mate, diy: target.diy } : foreign ? null : ownDiy(c);
    if (d) return { type: 'chess', chess: d.chess, hint: target.hint || null, standIn: null, diy: d.diy, ...(items.length ? { unitItems: items } : {}) };
    const si = !c ? null : foreign ? (typeof target.standInFor === 'string' && target.standInFor ? standInOf(c, backups) : null) : ownSi(c);
    return c ? { type: 'chess', chess: c, hint: target.hint || null, standIn: si, ...(items.length ? { unitItems: items } : {}) } : null;
  }
  if (target.kind === 'item') { const it = data.lookup('items', target.id); return it ? { type: 'item', item: it } : null; }
  if (target.kind === 'enemy') { const en = data.lookup('enemies', target.id); return en ? { type: 'enemy', enemy: en, count: target.count } : null; }
  if (target.kind === 'token') { const t = data.lookup('tokens', target.id) || diyToken(target.id); return t ? { type: 'token', token: t } : null; }
  if (target.kind === 'unit') {
    const u = target.unit || {};
    const own = Number.isInteger(u.uid) ? pieces?.get(u.uid) : null;
    if (u.side === 'enemy') { const en = data.lookup('enemies', u.defId); return en ? { type: 'enemy', enemy: en, unitId: u.id } : null; }
    // a hand item on a scouted prep board (m.field units, kind 'item'): the item's own card
    if (u.kind === 'item') { const it = data.lookup('items', u.defId); return it ? { type: 'item', item: it } : null; }
    const c = data.lookup('chess', u.defId);
    // a unit says itself whether it is a stand-in (UnitInfo standInFor: the sim's, prep scouting's); an own piece's unit
    // follows m.private.standIns like the piece
    let si = null;
    if (c && typeof u.standInFor === 'string' && u.standInFor) si = standInOf(c, backups);
    else if (c && own?.piece) si = ownSi(c);
    // 0.2.0 自选编队: a unit says itself which operator fills its DIY slot (UnitInfo diy); an own piece's unit follows
    // m.private.diy like the piece
    const pick = c && u.diy && typeof u.diy === 'object' ? u.diy : own?.piece ? ownDiyPick(priv, c) : null;
    const dr = pick ? diyRecordFor(c, pick, dd) : null;
    if (dr) return { type: 'chess', chess: dr, piece: own?.piece || null, unitId: u.id, unitItems: Array.isArray(u.items) ? u.items : null, standIn: null, diy: pick };
    if (c) return { type: 'chess', chess: c, piece: own?.piece || null, unitId: u.id, unitItems: Array.isArray(u.items) ? u.items : null, standIn: si };
    const t = data.lookup('tokens', u.defId) || diyToken(u.defId);
    if (t) return { type: 'token', token: t, unitId: u.id, ownerId: tokenOwnerId(own?.piece, pieces) };
    const en = data.lookup('enemies', u.defId);
    return en ? { type: 'enemy', enemy: en, unitId: u.id } : null;
  }
  return null;
}

/**
 * The panel.
 * @param {{ detail:any, editable:boolean, snapHp?:{hp:number,max:number}|null, onClose:Function, onSell:(piece:any)=>void, onDestroy:(piece:any)=>void,
 *   bonds?: any[], offBonds?: Set<string>|null, loadout?: any, onBond?: (bondId:string)=>void, side?: 'left'|'right', shopOpen?: boolean }} props
 *   bonds: the owner's m.private.bonds (counts / tiers of the bond chips); offBonds: the bonds this mode never activates
 *   (gameLogic modeOffBonds — their chips and the 变形同构体 pairing lines read 本局禁用); loadout: m.private.loadout (DESIGN §16) for
 *   the player's own operators and shop cards; a teammate's unit gets its owner's choice (gameLogic unitLoadout); null
 *   = the defaults
 *   live: the unit's live stats (unitStatsEntry + src 'battle' | 'prep') — an object, or a getter the panel re-reads 4×
 *   a second (the battle's own sim, battle/runner.js unitStats); null ⇒ the record's numbers
 *   voice: whether the panel may speak — 选中干员 (audio.voice 'select') plays only while a battle runs (user request:
 *   整备期不播干员语音), so the game screen passes its combat flag
 */
export function DetailPanel({ detail, editable, snapHp, onClose, onSell, onDestroy, bonds = [], offBonds = null, loadout = null, onBond = null, side = 'left', shopOpen = false, live = null, voice = false, previewSkill = false, onToggleRange = null }) {
  const getter = typeof live === 'function' ? live : null;
  useTicker(detail && getter ? 250 : 0);
  // 选中干员 voice (audio.voice 'select'): once per opened operator — the panel stays mounted while the target changes,
  // so the key carries what identifies it (its chess record and its piece / battle unit id)
  const selectKey = voice && detail?.type === 'chess' ? `${detail.chess?.chessId || ''}:${detail.unitId ?? detail.piece?.uid ?? ''}` : null;
  // 0.2.0 补位: a chess fielded as its stand-in is spoken for by the stand-in (the operator on the field, whose model, name
  // and battle lines the card and audio.js show), never by the operator it replaces; a 自选 record is already the pick's
  const selectChar = voice && detail?.type === 'chess' ? detail.standIn?.charId || detail.chess?.charId || null : null;
  useEffect(() => {
    if (selectKey && selectChar) audio.voice(selectChar, 'select');
  }, [selectKey, selectChar]);
  if (!detail) return null;
  let liveNow = null;
  try { liveNow = getter ? getter() : live && typeof live === 'object' ? live : null; } catch { liveNow = null; }
  const sellIt = async (piece, chess) => {
    const golden = piece.golden || chess?.isGolden;
    if (golden) {
      const ok = await confirmDialog({ title: t('出售精锐干员'), text: t('确定要出售精锐干员「{name}」吗？出售后获得 {price} 资金。', { name: chess?.name || '', price: chess?.sellPrice ?? 1 }), okText: t('出售'), danger: true });
      if (!ok) return;
    }
    onSell(piece);
  };
  const destroyIt = async (piece, item) => {
    const ok = await confirmDialog({ title: t('销毁道具'), text: t('道具无法出售。确定要销毁「{name}」吗？', { name: item?.name || '' }), okText: t('销毁'), danger: true });
    if (ok) onDestroy(piece);
  };
  return html`<aside class=${cx('dpanel', 'brackets', `dpanel--${detail.type}`, side === 'right' && 'dpanel--right', side === 'right' && shopOpen && 'is-shop')} role="dialog" aria-label=${t('详情')}
      data-side=${side === 'right' ? 'right' : 'left'}>
    <button type="button" class="dpanel__close" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    <div class="dpanel__scroll">
      ${onToggleRange ? html`<div class="dpanel__range">
        <${Button} size="sm" active=${previewSkill} aria-pressed=${String(previewSkill)} onClick=${onToggleRange}>
          ${previewSkill ? t('显示攻击范围') : t('显示技能范围')}
        <//>
        <small>${t('技能范围预览（非官方功能），不含溅射范围')}</small>
      </div>` : null}
      ${detail.type === 'chess' ? html`<${ChessDetail} chess=${detail.chess} piece=${detail.piece} snapHp=${snapHp} editable=${editable} onSell=${sellIt}
        bonds=${bonds} offBonds=${offBonds} loadout=${loadout} onBond=${onBond} live=${liveNow} hint=${detail.hint || null} unitItems=${detail.unitItems || null}
        standIn=${detail.standIn || null} diy=${detail.diy || null} />` : null}
      ${detail.type === 'item' ? html`<${ItemDetail} item=${detail.item} piece=${detail.piece} editable=${editable} onDestroy=${destroyIt} offBonds=${offBonds} />` : null}
      ${detail.type === 'enemy' ? html`<${EnemyDetail} enemy=${detail.enemy} snapHp=${snapHp} count=${detail.count} live=${liveNow} />` : null}
      ${detail.type === 'token' ? html`<${TokenDetail} token=${detail.token} piece=${detail.piece} ownerId=${detail.ownerId ?? null} snapHp=${snapHp} live=${liveNow} />` : null}
      ${detail.type === 'terrain' ? html`<${TerrainDetail} terrain=${detail.terrain} />` : null}
    </div>
  </aside>`;
}
