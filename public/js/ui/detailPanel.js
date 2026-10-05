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
// interval) with the difference beside it, red when it hurts — and a 实时 / 开战时 tag says which it is. The 攻击范围
// mini-map follows the live entry's `range` too (cardRangeGrid: the grid the unit attacks with now — a running skill's
// range such as 烛煌 S3's 4-11, rangeExtend included; community report E1 after 0.1.0, it used to stay the base grid);
// a grid larger than the box (RANGE_FIT) draws smaller cells (rangeGridStyle), a whole-field one reads 全场.
// The stats block (chessStatsBlock), the 特性 text (traitText) and the talent list (chessTalents) are exported: the 干员调配
// screen's 局内数值 section draws the same ones for the chosen skill / module, without a live entry (GitHub issue #64).

import { useEffect } from '../../vendor/hooks.module.js';
import { html, Icon, TierChip, MicroLabel, Button, confirmDialog, useTicker } from './components.js';
import { Img, RichText, UnitThumb, BondGlyph, GIcon } from './gameComponents.js';
import { attackInterval, rangeGridBox, fmtNum, tileKey, chessLoadout, nextThreshold, bondTier, briefingBondTip, pieceBondIds, grantedBonds, morphPairings } from './gameLogic.js';
import { chessPortraitUrl, skillIconUrl, skillRecordIconUrl, profIconUrl, subProfIconUrl, itemIconUrl, enemyIconUrl, tokenAvatarUrl, factionIconUrl, uiUrl, moduleTypeIconUrl } from './assetUrls.js';
import { abilityRows } from './abilityLines.js';
import { data } from '../data.js';
import { attackRangeGrid } from '../../../shared/loadoutRecord.js';
import { SKILL_SUMMON_START_DEPLOY } from '../../../shared/constants.js';
import { moduleBadge } from './loadoutModel.js';
import { audio } from '../audio.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

const PROF_NAME = { PIONEER: '先锋', WARRIOR: '近卫', TANK: '重装', SNIPER: '狙击', CASTER: '术师', MEDIC: '医疗', SUPPORT: '辅助', SPECIAL: '特种', TOKEN: '召唤物' };
const SP_TYPE = { INCREASE_WITH_TIME: '自动回复', INCREASE_WHEN_ATTACK: '攻击回复', INCREASE_WHEN_TAKEN_DAMAGE: '受击回复', ON_DEPLOY: '被动' };
const SKILL_TYPE = { MANUAL: '自动触发', AUTO: '自动触发', PASSIVE: '被动' };
/** Fallback type icon by trigger, for a garrison record without its official `eventTypeIcon` (garrisonTypeIconKey). */
const EVENT_ICON = { IN_BATTLE: 's_icon_battle', SERVER_GAIN: 's_icon_bond', SERVER_PREP_START: 's_icon_bond', SERVER_PREP_FIN: 's_icon_bond', SERVER_CHESS_SOLD: 's_icon_gold', SERVER_PRICE: 's_icon_gold', SERVER_REFRESH_SHOP: 's_icon_gold' };
const RANK = { NORMAL: '普通', ELITE: '精英', BOSS: '领袖' };
const DMG = { phys: '物理', arts: '法术', heal: '治疗', true: '真实', none: '无' };

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
  if (Array.isArray(grid) && grid.length >= FIELD_WIDE_CELLS) return html`<span class=${cx('rgrid-all', cls)} aria-label="攻击范围">全场</span>`;
  const box = rangeGridBox(grid);
  if (!box.cells.size) return html`<span class="t-dim">—</span>`;
  const cells = [];
  for (let r = box.r0; r > box.r0 - box.rows; r--) {
    for (let c = box.c0; c < box.c0 + box.cols; c++) {
      const self = r === 0 && c === 0;
      cells.push(html`<i key=${`${r},${c}`} class=${cx(box.cells.has(tileKey(r, c)) && 'on', self && 'self')}></i>`);
    }
  }
  return html`<div class=${cx('rgrid', cls)} style=${rangeGridStyle(box)} aria-label="攻击范围">${cells}</div>`;
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
    <p class="dmorph__lead">搭配以下装备时，携带者视为对应盟约的成员：</p>
    <ul class="dmorph__list" aria-label="变形同构体对应关系">
      ${rows.map((r) => html`<li key=${r.bondId} class=${cx('dmorph__row', r.off && 'is-off', r.worn && 'is-worn')} data-bond=${r.bondId}
          title=${`${r.items.map((it) => it.name).join('、')} → 【${r.name}】${r.off ? '（本局禁用）' : ''}`}>
        <span class="dmorph__bond">【${r.name}】</span>
        <span class="dmorph__items">${r.items.map((it, i) => html`<span key=${it.id} class=${cx('dmorph__item', it.worn && 'is-worn')}>${i ? '、' : ''}${it.name}</span>`)}${r.worn
          ? html`<span class="dmorph__tag is-on">${r.off ? '已搭配' : '生效中'}</span>` : null}${r.off ? html`<span class="dmorph__tag is-off">本局禁用</span>` : null}</span>
      </li>`)}
    </ul>
    ${wearer && !rows.some((r) => r.worn) ? html`<p class="dmorph__none">暂未生效：需与上表中的一件装备一同携带</p>` : null}
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
    <${Icon} name="info" /><span>与${morph.name}一同装备时，携带者视为【${bond.name}】成员${isOff ? html`<span class="dmorph__tag is-off">本局禁用</span>` : null}${worn
      ? html`<span class="dmorph__tag is-on">${isOff ? '已搭配' : '生效中'}</span>` : null}</span>
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
  return html`<div class="dbonds dbonds--top" role="list" aria-label="所属盟约">
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
      const isoTag = iso.has(id) ? '（变形同构体）' : '';
      // the count holds 调和's +1 (the server's bond entry says so, DESIGN §21.26)
      const harmonyTag = !isOff && Number.isInteger(e?.harmony) && e.harmony > 0 ? `（含调和 +${e.harmony}）` : '';
      const label = isOff ? briefingBondTip(rec?.name || id, 'off')
        : `${rec?.name || id}${isoTag}：在场 ${count}${cap != null ? `/${cap}` : ''}${harmonyTag}${active ? `，已激活 ${tier} 阶` : '，未激活'}`;
      const body = isOff
        ? html`
        <${BondGlyph} bondId=${id} class="dbond__icon" />
        <span class="dbond__name">${rec?.name || id}</span>
        ${iso.has(id) ? html`<span class="dbond__iso">同构</span>` : null}
        <span class="dbond__off">本局禁用</span>`
        : html`
        <${BondGlyph} bondId=${id} class="dbond__icon" />
        <span class="dbond__name">${rec?.name || id}</span>
        ${iso.has(id) ? html`<span class="dbond__iso">同构</span>` : null}
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
  const base = t.descRaw || t.desc || '';
  if (!golden) return base;
  // the record's own module line, also for a record cloned for another skill or module (a 不装备 record carries none) —
  // until 0.1.2 a clone fell back to the class trait (Grok review of GitHub #64; the in-match card had it too)
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
        <${Stat} k="生命上限" ...${st.maxHp} />
        <${Stat} k="攻击" ...${st.atk} />
        <${Stat} k="防御" ...${st.def} />
        <${Stat} k="法术抗性" ...${st.res} />
        <${Stat} k="攻击间隔" ...${st.interval} />
        <${Stat} k="阻挡数" ...${st.blockCnt} />
        <${Stat} k="部署费用" v=${s.cost ?? '—'} />
        <${Stat} k="再部署" v=${s.respawnTime != null ? `${s.respawnTime}s` : '—'} />
      </div>
      <div class="drange"><span class="dstat__k">攻击范围</span><${RangeGrid} grid=${cardRangeGrid(live, rec, chess)} /></div>
    </div>`;
}

export function ChessDetail({ chess, piece, unit, snapHp, editable, onSell, bonds, offBonds = null, loadout, onBond, live = null, hint = null, unitItems = null }) {
  const m = data.get('assets');
  const hp = hpOf(live, snapHp);
  const lo = chessLoadout(chess, loadout, (id) => data.lookup('chess', id));
  const c = chess;
  // stats / talents the unit fights with: the chosen module's (or none — statsBase) for an elite (DESIGN §16)
  const fr = lo?.record || c;
  const golden = !!(c.isGolden || piece?.golden);
  const sk = lo?.skill || c.skill || null;
  // a chosen skill the manifest has no icon for (only the default skills' icons are fetched): its slot letter
  const skIcon = sk && lo && !lo.defaultSkill ? skillRecordIconUrl(m, sk, { empty: false }) : skillIconUrl(m, c);
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
        <${BondChips} bondIds=${bondIds} bonds=${bonds} off=${offBonds} onBond=${onBond} granted=${grantedIds} />
      </div>
    </div>`;
  blocks.garrison = garrison ? html`<${GarrisonBlock} key="garrison" garrison=${garrison} m=${m} />` : null;
  blocks.trait = c.trait?.desc ? html`<p key="trait" class="dtrait"><${Icon} name="info" /><${RichText} text=${traitText(c, golden, lo)} /></p>` : null;
  blocks.stats = chessStatsBlock({ rec: fr, chess: c, live });
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
  // (a 变形同构体 / bond item row shows its pairing against what this operator carries: ItemRow `carried`)
  blocks.equip = piece?.kind === 'chess' ? html`<${Section} key="equip" title="装备" micro=${`EQUIP ${items.length}/2`} class="dsec--equip">
      ${items.length ? items.map((it) => html`<${ItemRow} key=${it.uid} itemId=${it.id} carried=${items} off=${offBonds} />`) : html`<p class="t-dim dempty">拖拽装备至该干员以配发（最多 2 件）</p>`}
    <//>`
    // no own piece (a teammate's unit, a bond popup's 变形同构体 row): what it carries, read-only
    : !piece && carried.length ? html`<${Section} key="equip" title="装备" micro=${`EQUIP ${carried.length}/2`} class="dsec--equip">
      ${carried.map((id, i) => html`<${ItemRow} key=${`${i}:${id}`} itemId=${id} carried=${carried} off=${offBonds} />`)}
    <//>` : null;
  const talents = chessTalents(fr);
  blocks.talents = talents.length ? html`<${Section} key="talents" title="天赋" micro="TALENT" class="dsec--talent">
      ${talents.map((t, i) => html`<div key=${i} class="dtalent"><b>${t.name}</b><${RichText} text=${t.descRaw || t.desc} class="dtext" /></div>`)}
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
        <div class="dhead__chips"><${TierChip} tier=${item.tier} golden=${item.isGolden} size="lg" />${item.isGolden ? html`<span class="dtag-elite">进阶</span>` : null}
          <span class="dtag-kind">${item.itemType === 'MAGIC' ? '奇术' : '装备'}</span></div>
        <h3 class="dhead__name">${item.name}</h3>
        ${item.flavor ? html`<span class="dhead__flavor">${item.flavor}</span>` : null}
      </div>
    </div>
    <${Section} title="效果" micro="EFFECT"><${RichText} as="p" text=${item.descRaw || item.desc} class="dtext" /><//>
    ${item.canGiveBond ? html`<${Section} title="天赋" micro="TALENT" class="dsec--morph"><${MorphPairings} off=${offBonds} /><//>` : null}
    ${!item.canGiveBond && item.giveBondId ? html`<${MorphGrantLine} item=${item} off=${offBonds} />` : null}
    ${item.note ? html`<p class="dhint dhint--rule"><${Icon} name="info" />${item.note}</p>` : null}
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
      <ul class="dabil">${abilityRows(enemy.abilities, !!live?.silenced).map((a, i) => html`<li key=${i} class=${a.off ? 'is-off' : null}><${RichText} text=${a.text} /></li>`)}</ul>
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
  if (target.kind === 'chess') {
    // a bond popup's 变形同构体 row hands the wearer's item ids on (bondStrip onMember): the card shows the pair and the chip
    const c = data.lookup('chess', target.id);
    const items = Array.isArray(target.items) ? target.items.filter((x) => typeof x === 'string') : [];
    return c ? { type: 'chess', chess: c, hint: target.hint || null, ...(items.length ? { unitItems: items } : {}) } : null;
  }
  if (target.kind === 'item') { const it = data.lookup('items', target.id); return it ? { type: 'item', item: it } : null; }
  if (target.kind === 'enemy') { const en = data.lookup('enemies', target.id); return en ? { type: 'enemy', enemy: en, count: target.count } : null; }
  if (target.kind === 'token') { const t = data.lookup('tokens', target.id); return t ? { type: 'token', token: t } : null; }
  if (target.kind === 'unit') {
    const u = target.unit || {};
    const own = Number.isInteger(u.uid) ? pieces?.get(u.uid) : null;
    if (u.side === 'enemy') { const en = data.lookup('enemies', u.defId); return en ? { type: 'enemy', enemy: en, unitId: u.id } : null; }
    // a hand item on a scouted prep board (m.field units, kind 'item'): the item's own card
    if (u.kind === 'item') { const it = data.lookup('items', u.defId); return it ? { type: 'item', item: it } : null; }
    const c = data.lookup('chess', u.defId);
    if (c) return { type: 'chess', chess: c, piece: own?.piece || null, unitId: u.id, unitItems: Array.isArray(u.items) ? u.items : null };
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
export function DetailPanel({ detail, editable, snapHp, onClose, onSell, onDestroy, bonds = [], offBonds = null, loadout = null, onBond = null, side = 'left', shopOpen = false, live = null, voice = false }) {
  const getter = typeof live === 'function' ? live : null;
  useTicker(detail && getter ? 250 : 0);
  // 选中干员 voice (audio.voice 'select'): once per opened operator — the panel stays mounted while the target changes,
  // so the key carries what identifies it (its chess record and its piece / battle unit id)
  const selectKey = voice && detail?.type === 'chess' ? `${detail.chess?.chessId || ''}:${detail.unitId ?? detail.piece?.uid ?? ''}` : null;
  const selectChar = voice && detail?.type === 'chess' ? detail.chess?.charId || null : null;
  useEffect(() => {
    if (selectKey && selectChar) audio.voice(selectChar, 'select');
  }, [selectKey, selectChar]);
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
        bonds=${bonds} offBonds=${offBonds} loadout=${loadout} onBond=${onBond} live=${liveNow} hint=${detail.hint || null} unitItems=${detail.unitItems || null} />` : null}
      ${detail.type === 'item' ? html`<${ItemDetail} item=${detail.item} piece=${detail.piece} editable=${editable} onDestroy=${destroyIt} offBonds=${offBonds} />` : null}
      ${detail.type === 'enemy' ? html`<${EnemyDetail} enemy=${detail.enemy} snapHp=${snapHp} count=${detail.count} live=${liveNow} />` : null}
      ${detail.type === 'token' ? html`<${TokenDetail} token=${detail.token} piece=${detail.piece} ownerId=${detail.ownerId ?? null} snapHp=${snapHp} live=${liveNow} />` : null}
    </div>
  </aside>`;
}

