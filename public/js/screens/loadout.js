import { skinsStore, setSkins } from '../ui/skins.js';
import { SkinSection } from '../ui/skinPicker.js';
// 干员调配 (Operator loadout, DESIGN §16): choose the equipped skill of every chess and the module of its elite before a
// match (official rule: "开始游戏前无法调整干员的等级，但可调整其所携带的技能和模组"). A full-screen overlay opened
// from the lobby, the room and the briefing (INFO_CHECK) — `openLoadout(from)` / <LoadoutButton/>; <LoadoutHost/> is
// mounted once by main.js. Styles: css/screens/loadout.css (official preset sprites from the local-client art when
// present: operator_preset, image_skill_select_outline, skill_select_deco, icon_equip_non; the module type icons of
// groups.module — lettered tiles without them).
//
// Left: the 112 visible chess as one list (tier / class / bond filters, search, 仅看已调整) — a row per operator, its columns
// aligned (0.2.2; the quick choices of PR #301 by @farridge, laid out as one list instead of three columns of cards — the
// owner's decision of 2026-10-08): portrait, name and bonds (a click opens the detail), the skills and the elite's modules
// to tap (不装备 first), the 潜能 and 练度 selects (screens/cultivation.js). Right: the selected chess — its 潜能 / 练度,
// its 特质 (the in-match card's block, PR #301), skills (icon, name, 默认,
// SP recovery, 初始 / 消耗 SP, duration, description at 普通 Lv.4 or 精锐 Lv.7), 局内数值 (the stats, 攻击范围, 特性 and
// 天赋 the chosen variant — 精锐 first, 普通 on the toggle — fights with under the chosen skill and module: the detail
// card's own block and pure functions, GitHub issue #64) and the elite's modules (不装备 / X / Y … with the stat bonus,
// the trait upgrade and the talent changes), 恢复默认; 全部恢复默认 in the top bar. The detail's 普通 / 精锐 skill toggle is one
// preview for the skills, the 特质 and the rows' skill details (display only: never stored).
// The loadout lives in ui/loadoutSync.js (localStorage + room.loadout); the model is ui/loadoutModel.js.
// The second tab, 干员持有 (0.2.0 补位, screens/ownership.js): which NORMAL chess the player owns — a chess marked 未持有 is
// deployed as its official stand-in (room.ownership; ui/ownershipModel.js) — with its own 导出 / 导入 / 全部持有.
// The third tab, 自选编队 (0.2.0 DIY, screens/diy.js): the operators of the four DIY slots (room.diy; ui/diyModel.js) —
// with its own 导出 / 导入 / 全部清空.
// Keyboard: Esc closes, ←/→ move through the (filtered) roster when focus is not in the search field (干员调配 tab).
// Motion (2026-10-13, the owner's request, as the hub's screens): the overlay darkens what is below, then comes up from
// black — the top bar, the tier groups one by one, the bottom bar; a tab's content comes up when opened; closing fades
// it and lifts the black (LoadoutHost keeps it mounted meanwhile: ui/transitions.js usePresence). css/screens/loadout.css.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { usePresence, LEAVE_MS } from '../ui/transitions.js';
import { html, Icon, MicroLabel, Button, TierChip, TextField, Countdown, Spinner, confirmDialog, hasDeadline, Modal, Fragment } from '../ui/components.js';
import { Img, RichText, UnitThumb } from '../ui/gameComponents.js';
import { chessAvatarUrl, chessPortraitUrl, subProfIconUrl, bondIconUrl, moduleTypeIconUrl, itemIconUrl } from '../ui/assetUrls.js';
import { GarrisonBlock } from '../ui/detailPanel.js';
import { data, useData, localAsset, DATA_FILES } from '../data.js';
import { useStore, loadPref, savePref } from '../store.js';
import { PHASE } from '../../../shared/constants.js';
import {
  MODULE_NONE, PROF_ORDER, PROF_NAME, rosterOf, filterRoster, recordsOf, chessOptions, effectiveChoice, setChoice, resetChoice,
  changedCount, skillLabel, moduleBadge, attrRows, skillTags, quickSkillTags, traitLines, serializeExport, parseImport, LOADOUT_IMPORT_MAX_BYTES, mergeSkins,
  opsOf, setOps, resetOps, moduleRecord,
} from '../ui/loadoutModel.js';
import { loadoutStore, openLoadout, closeLoadout, setEntries, setOpsMap, applyLoadoutEntries, setNotOwned, applyOwnershipImport, setDiyPicks, applyDiyImport } from '../ui/loadoutSync.js';
import { OperatorVoice } from '../ui/operatorVoice.js';
import { CultivationSelects, CultivationSection } from './cultivation.js';
import { cultivationCharIds } from '../../../shared/protocol.js';
import { atPotential } from '../../../shared/potential.js';
import { setOwned, notOwnedCount, serializeOwnership, parseOwnershipImport, OWNERSHIP_IMPORT_MAX_BYTES } from '../ui/ownershipModel.js';
import { OwnershipPanel, useOwnershipRoster } from './ownership.js';
import { DiyPanel, diyData } from './diy.js';
import { LoadoutStats } from '../ui/loadoutStats.js';
export { LoadoutStats, statsPreview } from '../ui/loadoutStats.js';
import { diyCount, sanitizeDiyPicks, setPick, serializeDiy, parseDiyImport, DIY_IMPORT_MAX_BYTES, diySlotList, slotRecord } from '../ui/diyModel.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';
import { copyText } from '../ui/clipboard.js';
import { toast } from '../ui/toasts.js';

export { openLoadout, closeLoadout };

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

// ---- export / import (干员调配 presets) -----------------------------------------------------------------------------
//
// The payload is the versioned envelope of ui/loadoutModel.js (exportPayload / parseImport): a downloaded file and a
// pasted string are the SAME object, so 导出 and 导入 both funnel through applyLoadoutEntries
// (sanitise → persist → room.loadout). The dialog is a shared Modal rendered next to the overlay, not inside it.

/** Save `text` as a download. Silent no-op when the browser refuses downloads — 复制 stays available. */
function downloadText(filename, text) {
  try {
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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

/** `stronghold-loadout-20261003-1245.json` (`stronghold-ownership-…` for the 干员持有 list, `stronghold-diy-…` for 自选编队) */
function exportFilename(now = new Date(), what = 'loadout') {
  const p = (n) => String(n).padStart(2, '0');
  return `stronghold-${what}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** Square profession glyph (manifest prof.large: black glyph on white, drawn as a white glyph by loadout.css). */
function profGlyphUrl(m, prof) {
  const k = String(prof || '').toLowerCase();
  const v = m && m.prof && m.prof.large ? m.prof.large[k] : null;
  return typeof v === 'string' ? v : null;
}

/** Skill icon URL for a SkillRecord (assets manifest `skills[iconId]` / `skillsById`), null when absent. */
function skillIconOf(m, rec) {
  const skills = m && typeof m === 'object' ? m.skills : null;
  if (!skills || !rec) return null;
  const id = rec.iconId || rec.skillId;
  if (id && typeof skills[id] === 'string') return skills[id];
  const alt = m.skillsById && rec.skillId ? m.skillsById[rec.skillId] : null;
  return alt && typeof skills[alt] === 'string' ? skills[alt] : null;
}

/**
 * Module icon URL: the official type icon from the local-client art (`local-assets.json` groups.module, matched
 * case-insensitively by typeName), else manifest `modules[icon]` / `uniequip[icon]` when the asset pipeline provides one.
 */
function moduleIconOf(m, rec) {
  if (!rec) return null;
  const local = moduleTypeIconUrl(data.get('local'), rec.typeName || rec.type);
  if (local) return local;
  if (!m) return null;
  for (const group of ['modules', 'uniequip', 'equip']) {
    const g = m[group];
    if (g && typeof g === 'object') {
      const v = g[rec.icon] || g[rec.uniEquipId] || g[rec.typeIcon];
      if (typeof v === 'string') return v;
    }
  }
  return null;
}

/** Skill icon with the official selection outline; falls back to a lettered tile. */
function SkillIcon({ m, rec, index, on = false, size = 'md' }) {
  const src = skillIconOf(m, rec);
  return html`<span class=${cx('lo-sicon', `lo-sicon--${size}`, on && 'is-on')}>
    <${Img} src=${src} fallback=${html`<span class="lo-sicon__glyph num">${skillLabel(index)}</span>`} />
    ${on && size !== 'xs' ? html`<${Img} src=${localAsset('ui/outer', 'image_skill_select_outline')} class="lo-sicon__outline" fallback=${html`<i class="lo-sicon__ring"></i>`} />` : null}
  </span>`;
}

/** Module badge tile: the official type icon when the local-client art has it, else the type letter; ⊘ for 不装备. */
export function ModuleGlyph({ m, rec, id, size = 'md' }) {
  const src = rec ? moduleIconOf(m, rec) : null;
  if (id === MODULE_NONE || !rec) {
    return html`<span class=${cx('lo-mglyph', 'lo-mglyph--none', `lo-mglyph--${size}`)}>
      <${Img} src=${localAsset('ui/outer', 'icon_equip_non')} fallback=${html`<i class="lo-mglyph__slash"></i>`} />
    </span>`;
  }
  return html`<span class=${cx('lo-mglyph', `lo-mglyph--${size}`)} data-type=${moduleBadge(rec)}>
    <${Img} src=${src} fallback=${html`<b class="lo-mglyph__t num">${moduleBadge(rec)}</b>`} />
  </span>`;
}

// ---- roster rows -----------------------------------------------------------------------------------------------------
//
// One list, one row per operator, its columns aligned (the head row names them): the quick choices of PR #301 (by
// @farridge) without its three columns of cards. Every row is the same few columns — tap a skill, a module, a 潜能 / 练度 —
// so the eye runs down a column; the portrait and name open the detail (on a phone it slides over; a quick choice keeps
// the list). Hook-free (the tests draw it).

/** One skill to tap: its icon, the equipped one ringed; the label / tooltip says slot, name, SP and duration (quickSkillTags). */
function QuickSkill({ m, opt, on, elite, onPick }) {
  const rec = elite ? opt.elite || opt.normal : opt.normal || opt.elite;
  const tags = quickSkillTags(rec);
  const label = `${skillLabel(opt.index)} · ${rec?.name || t('未知技能')} · ${tags.sp} · ${t('初始')} ${tags.init ?? '—'} / ${t('消耗')} ${tags.cost ?? '—'} · ${t('持续')} ${tags.duration}`;
  return html`<button type="button" class=${cx('lo-q', 'lo-q--skill', on && 'is-on')} data-skill=${opt.index} aria-pressed=${on ? 'true' : 'false'}
      aria-label=${label} title=${label} onClick=${() => onPick(opt.index)}>
    <${SkillIcon} m=${m} rec=${rec} index=${opt.index} on=${on} size="q" />
  </button>`;
}

/** One module to tap (不装备 first): the type icon with its letter in the corner; the elite's equipped one ringed. */
function QuickModule({ m, opt, on, onPick }) {
  const label = opt.id === MODULE_NONE ? t('不装备模组') : `${opt.rec?.typeName || ''} · ${opt.rec?.name || opt.id}`;
  return html`<button type="button" class=${cx('lo-q', 'lo-q--mod', on && 'is-on')} data-module=${opt.id} aria-pressed=${on ? 'true' : 'false'}
      aria-label=${label} title=${label} onClick=${() => onPick(opt.id)}>
    <${ModuleGlyph} m=${m} rec=${opt.rec} id=${opt.id} size="q" />
    ${opt.id !== MODULE_NONE ? html`<b class="lo-q__type num" aria-hidden="true">${moduleBadge(opt.rec, opt.id)}</b>` : null}
  </button>`;
}

/** The list's column heads (the rows share its grid). */
export function RosterHead() {
  return html`<div class="lo-list__head" aria-hidden="true">
    <span class="lo-list__h lo-list__h--op">${t('干员')}</span>
    <span class="lo-list__h lo-list__h--skills">${t('技能')}</span>
    <span class="lo-list__h lo-list__h--mods" title=${t('模组仅在精锐形态生效')}>${t('模组')}<small>${t('精锐')}</small></span>
    <span class="lo-list__h lo-list__h--cult">${t('潜能')} · ${t('练度')}</span>
  </div>`;
}

/**
 * One operator's row (`.lo-card`, like the cards before it): portrait + name + bonds (`.lo-card__pick`: selects it, opens
 * the detail), three skill slots (an empty one when the chess has two skills), the elite's modules, the 潜能 / 练度 selects.
 * `level` 'elite': the skills' details at 精锐 Lv.7 (the shared preview). A chess marked not owned (干员持有) shows the
 * 「替补」 tag: its stand-in fights with a fixed skill and no 潜能 / 练度, the choices here apply once it is owned again.
 */
export function RosterRow({ m, chess, golden, entries, ops = {}, selected, onPick, onChange, onOps, level = 'normal', notOwned = false }) {
  const choice = effectiveChoice(entries, chess, golden);
  const opt = chessOptions(chess, golden);
  const cv = opsOf(ops, chess.charId);
  const changed = choice.changed || cv.changed;
  const modules = [...opt.moduleOptions].sort((a, b) => Number(b.id === MODULE_NONE) - Number(a.id === MODULE_NONE));
  const elite = level === 'elite' && !!golden;
  const slots = [0, 1, 2].map((i) => opt.skillOptions[i] || null);
  const standInNote = notOwned ? t('未持有（干员持有）：由替补干员上场，替补干员没有潜能与练度') : null;
  return html`<div role="listitem" data-chess=${chess.chessId} data-variant=${elite ? 'elite' : 'normal'}
      class=${cx('lo-card', `lo-card--t${chess.tier}`, selected && 'is-sel', changed && 'is-changed', notOwned && 'is-standin')}>
    <button type="button" class="lo-card__pick" aria-pressed=${selected ? 'true' : 'false'} title=${chess.name} onClick=${() => onPick(chess.chessId)}>
      <span class="lo-card__art">
        <${Img} src=${chessAvatarUrl(m, chess)} fallback=${html`<span class="lo-card__glyph">${[...(chess.name || '?')][0]}</span>`} />
        <${TierChip} tier=${chess.tier} size="sm" class="lo-card__tier" />
      </span>
      <span class="lo-card__id">
        <span class="lo-card__name">${chess.name}</span>
        <span class="lo-card__bonds">${(chess.bonds || []).map((b) => html`<${Img} key=${b} src=${bondIconUrl(m, b)} class="lo-card__bond"
          alt=${data.lookup('bonds', b)?.name || b} fallback=${html`<i class="lo-bond__dot" title=${data.lookup('bonds', b)?.name || b}></i>`} />`)}</span>
        ${notOwned ? html`<span class="lo-card__sub" title=${t('未持有（干员持有）：由替补干员上场')}>${t('替补')}</span>` : null}
      </span>
    </button>
    ${changed ? html`<span class="lo-card__flag" aria-label=${t('已调整')}></span>` : null}
    <div class="lo-card__skills lo-quick" role="group" aria-label=${t('选择技能')}>
      ${slots.map((sk, i) => (sk ? html`<${QuickSkill} key=${sk.index} m=${m} opt=${sk} elite=${elite} on=${sk.index === choice.skill}
        onPick=${(skill) => onChange(chess.chessId, { skill })} />` : html`<span key=${`e${i}`} class="lo-q lo-q--empty" aria-hidden="true"></span>`))}
    </div>
    <div class="lo-card__mods lo-quick" role="group" aria-label=${t('选择模组')} title=${t('模组仅在精锐形态生效')}>
      ${golden ? modules.map((mo) => html`<${QuickModule} key=${mo.id} m=${m} opt=${mo} on=${mo.id === choice.module}
        onPick=${(module) => onChange(chess.chessId, { module })} />`) : null}
    </div>
    <${CultivationSelects} charId=${chess.charId} ops=${ops} onSet=${onOps} note=${standInNote} />
  </div>`;
}

// ---- detail --------------------------------------------------------------------------------------------------------------

/** The same attribute records and rich-text renderer as the in-match card, including literal trigger markers. */
export function LoadoutGarrisons({ chess, m }) {
  const records = (chess?.garrisonIds || []).map((id) => data.lookup('garrisons', id)).filter(Boolean);
  return records.length ? html`<section class="lo-garrisons" data-variant=${chess.isGolden ? 'elite' : 'normal'}>
    ${records.map((garrison) => html`<${GarrisonBlock} key=${garrison.garrisonId} garrison=${garrison} m=${m} />`)}
  </section>` : null;
}

function SkillOption({ m, opt, on, level, onPick }) {
  const rec = level === 'elite' ? opt.elite || opt.normal : opt.normal || opt.elite;
  const tags = skillTags(rec);
  return html`<button type="button" role="radio" aria-checked=${on ? 'true' : 'false'} class=${cx('lo-skill', on && 'is-on')}
      data-skill=${opt.index} onClick=${() => onPick(opt.index)}>
    ${on ? html`<span class="lo-skill__deco" aria-hidden="true"><${Img} src=${localAsset('ui/outer', 'skill_select_deco')} fallback=${html`<i></i>`} /></span>` : null}
    <${SkillIcon} m=${m} rec=${rec} index=${opt.index} on=${on} size="md" />
    <span class="lo-skill__body">
      <span class="lo-skill__head">
        <span class="lo-skill__slot num">${skillLabel(opt.index)}</span>
        <b class="lo-skill__name">${rec?.name || t('未知技能')}</b>
        ${opt.isDefault ? html`<span class="lo-badge lo-badge--def">${t('默认')}</span>` : null}
        ${on ? html`<span class="lo-badge lo-badge--on"><${Icon} name="check" />${t('已装备')}</span>` : null}
      </span>
      <span class="lo-skill__tags">
        <span class=${cx('lo-sp', `lo-sp--${tags.spKind}`)}>${tags.sp}</span>
        ${tags.init != null ? html`<span class="lo-tag">${t('初始')} <b class="num">${tags.init}</b></span>` : null}
        ${tags.cost != null ? html`<span class="lo-tag">${t('消耗')} <b class="num">${tags.cost}</b></span>` : null}
        ${tags.duration ? html`<span class="lo-tag">${t('持续')} <b class="num">${tags.duration}</b></span>` : null}
        ${tags.charges ? html`<span class="lo-tag">${t('充能')} <b class="num">${tags.charges}</b></span>` : null}
      </span>
      <${RichText} as="span" class="lo-skill__desc" text=${rec?.descRaw || rec?.desc || ''} />
    </span>
  </button>`;
}

/**
 * The chosen module's card: its stat bonus, the 特性 it fights with, its talent changes — read at the operator's 潜能
 * (`potential`, 0.2.2: the elite composed at it first, shared/potential.js atPotential, as 局内数值 and the battle do; the
 * data record is the full-potential one — 余's 闲云隐市 「生命上限2%（+0.5%）」 is 「1.5%」 at 潜能1). null = full potential.
 * @param {{ m: any, golden: any, opt: { id: string, rec: any, isDefault?: boolean }, potential?: number|null }} props
 */
export function ModuleInfo({ m, golden, opt, potential = null }) {
  if (!golden) return null;
  const at = atPotential(golden, potential);
  const rec = opt.id === MODULE_NONE ? null : at === golden ? opt.rec : moduleRecord(at, opt.id) || opt.rec;
  if (!rec) {
    const traitBase = golden.traitBase || null;
    return html`<div class="lo-minfo lo-minfo--none">
      <p class="lo-minfo__lead">${t('不装备模组：精锐干员以基础属性、特性与天赋作战。')}</p>
      ${traitBase?.desc ? html`<div class="lo-minfo__row"><span class="lo-minfo__k">${t('特性')}</span><${RichText} class="lo-minfo__v" text=${traitBase.descRaw || traitBase.desc} /></div>` : null}
    </div>`;
  }
  const rows = attrRows(rec.attr);
  // 特性: the trait the elite fights with under this module (the class trait, or the module's rewrite of it), then the
  // module's extra line under PRTS's own label 特性追加 — the line adds to the class trait (item 16.2)
  const lines = traitLines(rec.traitOverride);
  const talents = (Array.isArray(rec.talentChanges) ? rec.talentChanges : []).filter((t) => t && (t.name || t.desc) && !t.hidden);
  return html`<div class="lo-minfo">
    <div class="lo-minfo__title"><${Img} src=${moduleIconOf(m, rec)} class="lo-minfo__icon" /><span class="lo-minfo__type num">${rec.typeName || ''}</span><b>${rec.name || rec.uniEquipId}</b>
      ${opt.isDefault ? html`<span class="lo-badge lo-badge--def">${t('默认')}</span>` : null}</div>
    <div class="lo-minfo__row">
      <span class="lo-minfo__k">${t('属性')}</span>
      <span class="lo-minfo__v lo-attrs">${rows.length ? rows.map((r) => html`<span key=${r.key} class=${cx('lo-attr', r.positive ? 'is-up' : 'is-down')}>${r.label}<b class="num">${r.text}</b></span>`) : html`<span class="t-dim">${t('无属性加成')}</span>`}</span>
    </div>
    ${lines.base ? html`<div class="lo-minfo__row" data-trait="base"><span class="lo-minfo__k">${t('特性')}</span><${RichText} class="lo-minfo__v" text=${lines.base} /></div>` : null}
    ${lines.added ? html`<div class="lo-minfo__row" data-trait="added"><span class="lo-minfo__k">${t('特性追加')}</span><${RichText} class="lo-minfo__v" text=${lines.added} /></div>` : null}
    ${talents.map((tal, i) => html`<div key=${i} class="lo-minfo__row"><span class="lo-minfo__k">${t('天赋')}</span>
      <span class="lo-minfo__v">${tal.name ? html`<b class="lo-minfo__tname">${tal.name}</b>` : null}<${RichText} text=${tal.descRaw || tal.desc || ''} /></span></div>`)}
  </div>`;
}

/** The name of a chess's 补位 stand-in (data/backups.json), or null. */
const standInName = (chess) => data.get('backups')?.units?.[chess?.backup?.charId]?.name ?? null;


function Detail({ m, chess, golden, entries, ops = {}, onChange, onOps, onReset, locked, level = 'normal', onLevel, notOwned = false }) {
  const [statLevel, setStatLevel] = useState('elite'); // 局内数值: the 精锐 shows the chosen module's effect
  const setLevel = onLevel;
  const bodyRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [chess?.chessId]);
  if (!chess) return html`<aside class="lo-detail lo-detail--empty"><p class="t-dim">${t('没有符合条件的干员')}</p></aside>`;
  const opt = chessOptions(chess, golden);
  const choice = effectiveChoice(entries, chess, golden);
  const changed = choice.changed || opsOf(ops, chess.charId).changed;
  const modOpt = opt.moduleOptions.find((x) => x.id === choice.module) || null;
  const lv = (c) => c?.status?.skillLevel ?? '—';
  return html`<aside class="lo-detail" aria-label=${t('{name} 调配', { name: chess.name })}>
    <div class="lo-dhead">
      <div class=${cx('lo-dhead__art', `lo-dhead__art--t${chess.tier}`)}>
        <${Img} src=${chessPortraitUrl(m, golden || chess)} fallback=${html`<${UnitThumb} kind="chess" id=${chess.chessId} size="lg" />`} />
      </div>
      <div class="lo-dhead__info">
        <div class="lo-dhead__chips"><${TierChip} tier=${chess.tier} size="md" />
          ${changed ? html`<span class="lo-badge lo-badge--changed">${t('已调整')}</span>` : html`<span class="lo-badge lo-badge--plain">${t('默认配置')}</span>`}</div>
        <h2 class="lo-dhead__name">${chess.name}</h2>
        <span class="lo-dhead__en">${chess.appellation || ''}</span>
        <span class="lo-dhead__class">
          <${Img} src=${profGlyphUrl(m, chess.profession)} class="lo-dhead__prof lo-profglyph" />${t(PROF_NAME[chess.profession] || '')}
          <i class="lo-sep"></i><${Img} src=${subProfIconUrl(m, chess)} class="lo-dhead__prof" />${chess.subProfessionName || ''}
        </span>
        <span class="lo-dhead__bonds">${(chess.bonds || []).map((b) => html`<span key=${b} class="lo-bond">
          <${Img} src=${bondIconUrl(m, b)} class="lo-bond__icon" fallback=${html`<i class="lo-bond__dot"></i>`} />${data.lookup('bonds', b)?.name || b}</span>`)}</span>
      </div>
      <${Button} variant="ghost" size="sm" icon="refresh" class="lo-dhead__reset" disabled=${!changed} onClick=${onReset}>${t('恢复默认')}<//>
    </div>
    <div class="lo-detail__body" ref=${bodyRef}>
      <${OperatorVoice} charId=${chess.charId} />
      <${CultivationSection} charId=${chess.charId} ops=${ops} onSet=${onOps} standIn=${notOwned} />
      <${LoadoutGarrisons} chess=${level === 'elite' && golden ? golden : chess} m=${m} />
      <section class="lo-sec">
        <header class="lo-sec__head">
          <h3>${t('技能')}<${MicroLabel}>SKILL<//></h3>
          <div class="lo-seg" role="tablist" aria-label=${t('技能等级')}>
            <button type="button" role="tab" aria-selected=${level === 'normal' ? 'true' : 'false'} class=${cx(level === 'normal' && 'is-on')} onClick=${() => setLevel('normal')}>${t('普通')} <span class="num">Lv.${lv(chess)}</span></button>
            <button type="button" role="tab" aria-selected=${level === 'elite' ? 'true' : 'false'} class=${cx(level === 'elite' && 'is-on')} disabled=${!golden} onClick=${() => setLevel('elite')}>${t('精锐')} <span class="num">Lv.${lv(golden)}</span></button>
          </div>
        </header>
        <div class="lo-skills" role="radiogroup" aria-label=${t('选择技能')}>
          ${opt.skillOptions.map((s) => html`<${SkillOption} key=${s.index} m=${m} opt=${s} level=${level} on=${s.index === choice.skill}
            onPick=${(i) => onChange({ skill: i })} />`)}
        </div>
      </section>
      <${LoadoutStats} base=${chess} golden=${golden} entries=${entries} ops=${ops} level=${statLevel} onLevel=${setStatLevel} />
      ${golden ? html`<section class="lo-sec lo-sec--mod">
        <header class="lo-sec__head">
          <h3>${t('模组')}<${MicroLabel}>MODULE<//></h3>
          <span class="lo-sec__note">${t('仅精锐干员装备 · 模组等级')} <b class="num">${golden.status?.equipLevel ?? 1}</b></span>
        </header>
        <div class="lo-mods" role="radiogroup" aria-label=${t('选择模组')}>
          ${opt.moduleOptions.map((mo) => html`<button key=${mo.id} type="button" role="radio" aria-checked=${mo.id === choice.module ? 'true' : 'false'}
              data-module=${mo.id} class=${cx('lo-mod', mo.id === choice.module && 'is-on', mo.id === MODULE_NONE && 'lo-mod--none')}
              onClick=${() => onChange({ module: mo.id })}>
            <${ModuleGlyph} m=${m} rec=${mo.rec} id=${mo.id} />
            <span class="lo-mod__text">
              <span class="lo-mod__type num">${mo.id === MODULE_NONE ? 'NONE' : mo.rec?.typeName || ''}</span>
              <b class="lo-mod__name">${mo.id === MODULE_NONE ? t('不装备') : mo.rec?.name || mo.id}</b>
            </span>
            ${mo.isDefault ? html`<span class="lo-badge lo-badge--def lo-mod__def">${t('默认')}</span>` : null}
          </button>`)}
        </div>
        ${modOpt ? html`<${ModuleInfo} m=${m} golden=${golden} opt=${modOpt} potential=${opsOf(ops, chess.charId).potential} />` : null}
      </section>` : null}
      <${SkinSection} chess=${chess} />
      ${notOwned ? html`<p class="lo-locknote lo-locknote--standin" data-testid="loadout-standin-note"><${Icon} name="info" />${standInName(chess) ? t('干员持有中标记为未持有：此棋子由替补干员 {name} 上场，技能与模组固定（补位干员技能不可更改）；这里的调配在改回「持有」后生效', { name: standInName(chess) })
        : t('干员持有中标记为未持有：此棋子由替补干员上场，技能与模组固定（补位干员技能不可更改）；这里的调配在改回「持有」后生效')}</p>` : null}
      ${locked ? html`<p class="lo-locknote"><${Icon} name="info" />${t('本局的调配已锁定，修改将在下一局生效')}</p>` : null}
    </div>
  </aside>`;
}

// ---- filters -------------------------------------------------------------------------------------------------------------

function Filters({ m, filters, onFilters, bonds }) {
  const set = (patch) => onFilters({ ...filters, ...patch });
  return html`<div class="lo-filters">
    <div class="lo-frow">
      <div class="lo-chips" role="group" aria-label=${t('阶级')}>
        <button type="button" class=${cx('lo-chip', !filters.tier && 'is-on')} onClick=${() => set({ tier: null })}>${t('全部')}</button>
        ${[1, 2, 3, 4, 5, 6].map((tier) => html`<button key=${tier} type="button" class=${cx('lo-chip', 'lo-chip--tier', `lo-chip--t${tier}`, filters.tier === tier && 'is-on')}
          aria-pressed=${filters.tier === tier ? 'true' : 'false'} title=${t('{tier}阶', { tier })} onClick=${() => set({ tier: filters.tier === tier ? null : tier })}><span class="num">${ROMAN[tier]}</span></button>`)}
      </div>
      <${TextField} size="sm" icon="search" value=${filters.query} placeholder=${t('搜索干员 / 职业 / 盟约')} class="lo-search"
        onInput=${(v) => set({ query: String(v).slice(0, 24) })} />
    </div>
    <div class="lo-frow">
      <div class="lo-chips lo-chips--prof" role="group" aria-label=${t('职业')}>
        ${PROF_ORDER.map((p) => html`<button key=${p} type="button" class=${cx('lo-chip', 'lo-chip--prof', filters.prof === p && 'is-on')}
          aria-pressed=${filters.prof === p ? 'true' : 'false'} title=${t(PROF_NAME[p])} onClick=${() => set({ prof: filters.prof === p ? null : p })}>
          <${Img} src=${profGlyphUrl(m, p)} class="lo-chip__icon lo-profglyph" fallback=${html`<span>${t(PROF_NAME[p])[0]}</span>`} /><span class="lo-chip__lbl">${t(PROF_NAME[p])}</span></button>`)}
      </div>
      <label class="lo-select">
        <span class="lo-select__k">${t('盟约')}</span>
        <select value=${filters.bond || ''} onChange=${(e) => set({ bond: e.currentTarget.value || null })} aria-label=${t('按盟约筛选')}>
          <option value="">${t('全部盟约')}</option>
          ${bonds.map((b) => html`<option key=${b.bondId} value=${b.bondId}>${b.name}</option>`)}
        </select>
      </label>
      <button type="button" class=${cx('lo-toggle', filters.changedOnly && 'is-on')} aria-pressed=${filters.changedOnly ? 'true' : 'false'}
        onClick=${() => set({ changedOnly: !filters.changedOnly })}><i class="lo-toggle__box"><${Icon} name="check" /></i>${t('仅看已调整')}</button>
    </div>
  </div>`;
}

// ---- 物资调配处 deck (2026-10-13, the owner's request) ------------------------------------------------------------------
//
// The 干员调配 tab's default view, laid out after the event's 物资调配处: the roster as cards in tier groups scrolling
// sideways (two rows a group, a tall tier marker before each), the 甄选 (自选编队) slots closing tiers 5 and 6, a bottom bar
// (干员 / 道具, jump to a tier) and 快速配置 (skills, modules, or this game's 潜能 · 练度 beside every card). A card opens the
// same Detail as the list, in a drawer over the left of the deck. The list view (RosterRow) stays one toggle away in 筛选.
// 道具 is a codex of this game's equipment (data/items.json: what its shop sells and its sim runs).

const VIEW_PREF = 'loadout.view';
/** 'deck' (cards by tier, the default) or 'list' (the aligned rows of 0.2.2). */
export const loadoutViewPref = () => (loadPref(VIEW_PREF, 'deck') === 'list' ? 'list' : 'deck');
const TIERS = [1, 2, 3, 4, 5, 6];

/** 潜能 as six pips (the card's star row). */
function PotPips({ n }) {
  return html`<span class="lo-op__pot" title=${t('潜能 {n}', { n })}>${TIERS.map((i) => html`<i key=${i} class=${i <= n ? 'is-on' : ''}></i>`)}</span>`;
}

/**
 * One operator card of the deck: tier, the normal / elite levels, the half-body portrait with its branch icon, the equipped
 * skill and module, 潜能, name and bonds; a 替补 ribbon when marked not owned. `quick` ('skill' | 'module' | 'cult') adds a
 * column of quick choices beside the card — the same handlers as the list's RosterRow.
 */
export function OpCard({ m, chess, golden, entries, ops = {}, selected = false, quick = null, onPick, onChange, onOps, notOwned = false }) {
  const choice = effectiveChoice(entries, chess, golden);
  const opt = chessOptions(chess, golden);
  const cv = opsOf(ops, chess.charId);
  const changed = choice.changed || cv.changed;
  const sk = opt.skillOptions.find((s) => s.index === choice.skill) || opt.skillOptions[0] || null;
  const skRec = sk ? (golden ? sk.elite || sk.normal : sk.normal || sk.elite) : null;
  const mod = golden ? opt.moduleOptions.find((x) => x.id === choice.module) || null : null;
  const modules = [...opt.moduleOptions].sort((a, b) => Number(b.id === MODULE_NONE) - Number(a.id === MODULE_NONE));
  const standInNote = notOwned ? t('未持有（干员持有）：由替补干员上场，替补干员没有潜能与练度') : null;
  return html`<div role="listitem" data-chess=${chess.chessId}
      class=${cx('lo-op', `lo-op--t${chess.tier}`, selected && 'is-sel', changed && 'is-changed', notOwned && 'is-standin', quick && 'is-quick')}>
    <div class="lo-op__card" onClick=${(e) => { if (!e.target.closest?.('button, select, input')) onPick(chess.chessId); }}>
      <div class="lo-op__rail">
        <${TierChip} tier=${chess.tier} size="sm" class="lo-op__tier" />
        <span class="lo-op__lv" title=${t('普通 / 精锐等级')}>
          <span class="lo-op__lvrow"><i class="lo-op__chev"></i><b class="num">${chess.status?.level ?? '—'}</b></span>
          ${golden ? html`<span class="lo-op__lvrow is-elite"><i class="lo-op__chev"></i><b class="num">${golden.status?.level ?? '—'}</b></span>` : null}
        </span>
        ${changed ? html`<span class="lo-op__mark" title=${t('已调整')} aria-label=${t('已调整')}></span>` : null}
      </div>
      <button type="button" class="lo-op__pick" aria-pressed=${selected ? 'true' : 'false'} title=${chess.name} onClick=${() => onPick(chess.chessId)}>
        <span class="lo-op__art">
          <${Img} src=${chessPortraitUrl(m, chess) || chessAvatarUrl(m, chess)} fallback=${html`<span class="lo-op__glyph">${[...(chess.name || '?')][0]}</span>`} />
        </span>
        <${Img} src=${subProfIconUrl(m, chess)} class="lo-op__sub" />
        ${notOwned ? html`<span class="lo-op__ribbon" title=${t('未持有（干员持有）：由替补干员上场')}>${t('替补')}</span>` : null}
        <span class="lo-op__kit">
          <span class="lo-op__slot"><${SkillIcon} m=${m} rec=${skRec} index=${choice.skill} size="q" /></span>
          <span class="lo-op__slot">${golden ? html`<${ModuleGlyph} m=${m} rec=${mod?.rec} id=${choice.module} size="q" />` : null}</span>
        </span>
      </button>
      <span class="lo-op__meta"><${PotPips} n=${cv.potential} /><span class="lo-op__name">${chess.name}</span></span>
      <span class="lo-op__bonds">${(chess.bonds || []).map((b) => html`<span key=${b} class="lo-op__bond" title=${data.lookup('bonds', b)?.name || b}>
        <${Img} src=${bondIconUrl(m, b)} fallback=${html`<i class="lo-bond__dot"></i>`} /></span>`)}</span>
    </div>
    ${quick === 'skill' ? html`<div class="lo-op__quick lo-quick" role="group" aria-label=${t('选择技能')}>
        ${[0, 1, 2].map((i) => opt.skillOptions[i] || null).map((s, i) => (s ? html`<${QuickSkill} key=${s.index} m=${m} opt=${s} elite=${!!golden}
          on=${s.index === choice.skill} onPick=${(skill) => onChange(chess.chessId, { skill })} />` : html`<span key=${`e${i}`} class="lo-q lo-q--empty" aria-hidden="true"></span>`))}
      </div>`
      : quick === 'module' ? html`<div class="lo-op__quick lo-quick" role="group" aria-label=${t('选择模组')} title=${t('模组仅在精锐形态生效')}>
        ${golden ? modules.map((mo) => html`<${QuickModule} key=${mo.id} m=${m} opt=${mo} on=${mo.id === choice.module}
          onPick=${(module) => onChange(chess.chessId, { module })} />`) : html`<span class="lo-op__none">${t('无精锐')}</span>`}
      </div>`
      : quick === 'cult' ? html`<div class="lo-op__quick lo-op__quick--cult"><${CultivationSelects} charId=${chess.charId} ops=${ops} onSet=${onOps} note=${standInNote} /></div>` : null}
  </div>`;
}

/** The 甄选干员 card closing tiers 5 and 6: the 自选编队 slots of that tier, filled / total; opens the 自选编队 tab. */
function DiyDeckCard({ m, tier, slots, picks, onOpen }) {
  const mine = slots.filter((s) => s.tier === tier);
  if (!mine.length) return null;
  const D = diyData();
  const recs = mine.map((s) => (picks?.[s.slotId] ? slotRecord(s.slotId, picks[s.slotId], D) : null)).filter(Boolean);
  return html`<button type="button" class=${cx('lo-op', 'lo-op--diy', `lo-op--t${tier}`)} data-diy-tier=${tier} onClick=${onOpen}
      title=${t('{tier}阶 自选名额：持有的 6★ 干员或原型干员', { tier })}>
    <span class="lo-diy__frame">
      ${recs.length ? html`<span class="lo-diy__faces">${recs.map((r, i) => html`<${Img} key=${i} src=${chessAvatarUrl(m, r)} class="lo-diy__face" fallback=${html`<span class="lo-diy__face">${[...(r.name || '?')][0]}</span>`} />`)}</span>`
        : html`<svg class="lo-diy__glyph" viewBox="0 0 40 40" aria-hidden="true"><path d="M17 6a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM8 34c0-8 4-14 9-14s9 6 9 14z" fill="currentColor" /><path d="M31 21v10M26 26h10" stroke="currentColor" stroke-width="2.4" /></svg>`}
    </span>
    <span class="lo-diy__label">${t('甄选干员')}</span>
    <span class="lo-diy__n num"><b>${recs.length}</b>/${mine.length}</span>
  </button>`;
}

/**
 * Mouse drag scrolls a sideways deck (a desktop has no swipe): past a few pixels the press becomes a drag and the click
 * that ends it is swallowed, so a card is not picked by letting go. Touch and pen keep the browser's own scrolling.
 */
function useDragScroll() {
  const drag = useRef(null), swallow = useRef(false);
  const end = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d?.moved) return;
    e.currentTarget.classList.remove('is-dragging');
    swallow.current = true;
    setTimeout(() => { swallow.current = false; }, 0);
  };
  return {
    onPointerDown: (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0 || e.target?.closest?.('select, input, textarea, .lo-op__quick--cult')) return;
      drag.current = { id: e.pointerId, x: e.clientX, left: e.currentTarget.scrollLeft, moved: false };
    },
    onPointerMove: (e) => {
      const d = drag.current;
      if (!d || d.id !== e.pointerId) return;
      const dx = e.clientX - d.x;
      if (!d.moved) {
        if (Math.abs(dx) < 6) return;
        d.moved = true;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        e.currentTarget.classList.add('is-dragging');
      }
      e.currentTarget.scrollLeft = d.left - dx;
    },
    onPointerUp: end,
    onPointerCancel: end,
    onClickCapture: (e) => { if (swallow.current) { swallow.current = false; e.stopPropagation(); e.preventDefault(); } },
  };
}

/**
 * The deck: one group per tier present in `list` (a tall marker, then the cards flowing in two rows), the 甄选 card closing
 * tiers 5 / 6. A vertical wheel scrolls it sideways; `onTier` reports the tier group at the left edge (the bottom bar).
 */
function DeckView({ m, list, getChess, st, selId, quick, onPick, onChange, onOps, onDiy, diySlots, diyPicks, deckRef, drawer, onTier, filtered }) {
  const groups = TIERS.map((tier) => ({ tier, items: list.filter((c) => c.tier === tier) }))
    .filter((g) => g.items.length || (!filtered && diySlots.some((s) => s.tier === g.tier)));
  const raf = useRef(0);
  const dragScroll = useDragScroll();
  const onScroll = (e) => {
    const el = e.currentTarget;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const left = el.getBoundingClientRect().left + (drawer ? el.clientWidth * 0.4 : 24);
      let cur = groups[0]?.tier || 1;
      for (const sec of el.querySelectorAll('.lo-tgroup')) if (sec.getBoundingClientRect().left <= left) cur = Number(sec.dataset.tier);
      onTier(cur);
    });
  };
  const onWheel = (e) => {
    const el = e.currentTarget;
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    if (e.target?.closest?.('select, .lo-op__quick--cult')) return;
    el.scrollLeft += e.deltaY;
    e.preventDefault();
  };
  if (!groups.length) return html`<div class="lo-deck lo-deck--empty" ref=${deckRef}><p class="lo-empty t-dim">${t('没有符合条件的干员')}</p></div>`;
  return html`<div class=${cx('lo-deck', drawer && 'has-drawer', quick && 'is-quick')} ref=${deckRef} onScroll=${onScroll} onWheel=${onWheel} ...${dragScroll} role="list" aria-label=${t('干员列表')}>
    ${groups.map((g) => html`<section key=${g.tier} class=${cx('lo-tgroup', `lo-tgroup--t${g.tier}`)} data-tier=${g.tier}>
      <div class=${cx('lo-tmark', `tier--${g.tier}`)} aria-hidden="true">
        <span class="lo-tmark__no">NO.</span>
        <b class="lo-tmark__n">${ROMAN[g.tier]}</b>
        <span class="lo-tmark__cnt num">${g.items.length}</span>
      </div>
      <div class="lo-tgrid">
        ${g.items.map((c) => html`<${OpCard} key=${c.chessId} m=${m} chess=${c} golden=${c.goldenId ? getChess(c.goldenId) : null}
          entries=${st.entries} ops=${st.ops} selected=${c.chessId === selId} quick=${quick} onPick=${onPick} onChange=${onChange} onOps=${onOps}
          notOwned=${(st.notOwned || []).includes(c.chessId)} />`)}
        ${!filtered ? html`<${DiyDeckCard} m=${m} tier=${g.tier} slots=${diySlots} picks=${diyPicks} onOpen=${onDiy} />` : null}
      </div>
    </section>`)}
  </div>`;
}

/** The equipment of the codex: this game's shop items (data/items.json), base forms, by tier then shop order. */
export function codexItems(items) {
  return Object.values(items || {})
    .filter((x) => x && !x.isGolden && x.itemType === 'EQUIP' && !x.hideInShop)
    .sort((a, b) => (a.tier ?? 0) - (b.tier ?? 0) || (a.shopSortId ?? 0) - (b.shopSortId ?? 0));
}

/** 道具: the equipment codex — a tile per item (icon, tier, name, base effect), grouped by tier; a tile opens ItemDetail. */
function ItemCodex({ m, items, deckRef, onOpen, onTier }) {
  const groups = TIERS.map((tier) => ({ tier, items: items.filter((x) => x.tier === tier) })).filter((g) => g.items.length);
  const raf = useRef(0);
  const dragScroll = useDragScroll();
  const onScroll = (e) => {
    const el = e.currentTarget;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const left = el.getBoundingClientRect().left + 24;
      let cur = groups[0]?.tier || 1;
      for (const sec of el.querySelectorAll('.lo-tgroup')) if (sec.getBoundingClientRect().left <= left) cur = Number(sec.dataset.tier);
      onTier(cur);
    });
  };
  const onWheel = (e) => {
    if (e.ctrlKey || Math.abs(e.deltaX) >= Math.abs(e.deltaY)) return;
    e.currentTarget.scrollLeft += e.deltaY;
    e.preventDefault();
  };
  if (!items.length) return html`<div class="lo-deck lo-deck--empty" ref=${deckRef}><p class="lo-empty t-dim">${t('装备数据载入中…')}</p></div>`;
  let n = -1;
  return html`<div class="lo-deck lo-deck--items" ref=${deckRef} onScroll=${onScroll} onWheel=${onWheel} ...${dragScroll} role="list" aria-label=${t('装备一览')}>
    ${groups.map((g) => html`<section key=${g.tier} class=${cx('lo-tgroup', `lo-tgroup--t${g.tier}`)} data-tier=${g.tier}>
      <div class=${cx('lo-tmark', `tier--${g.tier}`)} aria-hidden="true">
        <span class="lo-tmark__no">NO.</span><b class="lo-tmark__n">${ROMAN[g.tier]}</b><span class="lo-tmark__cnt num">${g.items.length}</span>
      </div>
      <div class="lo-igrid">${g.items.map((it) => { n += 1; const idx = n; return html`<button key=${it.id} type="button" role="listitem" class="lo-item" data-item=${it.id} onClick=${() => onOpen(idx)}>
        <span class="lo-item__icon"><${Img} src=${itemIconUrl(m, it)} fallback=${html`<${Icon} name="box" />`} /></span>
        <span class="lo-item__body">
          <span class="lo-item__head"><${TierChip} tier=${it.tier} size="sm" /><b class="lo-item__name">${it.name}</b></span>
          <${RichText} class="lo-item__desc" text=${it.descRaw || it.desc || ''} />
        </span>
        ${it.shopExcluded ? html`<span class="lo-item__tag">${t('特殊获取')}</span>` : null}
        <span class="lo-item__zoom" aria-hidden="true"><${Icon} name="search" /></span>
      </button>`; })}</div>
    </section>`)}
  </div>`;
}

/** One item, base and advanced (the merged golden form), its flavour text and price; ‹ / › browse the codex. */
function ItemDetail({ m, items, index, all, onIndex, onClose }) {
  const it = items[index];
  if (!it) return null;
  const adv = it.goldenId ? all?.[it.goldenId] : null;
  const same = adv && (adv.descRaw || adv.desc) === (it.descRaw || it.desc);
  const go = (d) => onIndex((index + d + items.length) % items.length);
  return html`<div class="lo-idetail" role="dialog" aria-modal="true" aria-label=${it.name} onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <button type="button" class="lo-idetail__nav is-prev" onClick=${() => go(-1)} aria-label=${t('上一件')}><${Icon} name="chevronLeft" /></button>
    <div class="lo-idetail__box">
      <button type="button" class="lo-idetail__close" onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button>
      <header class="lo-idetail__head"><${TierChip} tier=${it.tier} size="md" /><h3>${it.name}</h3>
        <span class="lo-idetail__price">${t('售价')} <b class="num">${it.price ?? '—'}</b></span>
        ${it.shopExcluded ? html`<span class="lo-item__tag">${t('特殊获取')}</span>` : null}</header>
      <div class="lo-idetail__main">
        <span class="lo-idetail__icon"><${Img} src=${itemIconUrl(m, it)} fallback=${html`<${Icon} name="box" />`} /></span>
        <div class="lo-idetail__text">
          <span class="lo-idetail__chip">${same ? t('基础 & 进阶效果') : t('基础效果')}</span>
          <${RichText} as="p" class="lo-idetail__eff" text=${it.descRaw || it.desc || ''} />
          ${adv && !same ? html`<span class="lo-idetail__chip is-adv">${t('进阶效果')}</span>
            <${RichText} as="p" class="lo-idetail__eff" text=${adv.descRaw || adv.desc || ''} />` : null}
          ${it.flavor ? html`<p class="lo-idetail__flavor">${it.flavor}</p>` : null}
        </div>
      </div>
      <footer class="lo-idetail__foot num">${index + 1} / ${items.length}</footer>
    </div>
    <button type="button" class="lo-idetail__nav is-next" onClick=${() => go(1)} aria-label=${t('下一件')}><${Icon} name="chevronRight" /></button>
  </div>`;
}

/** The deck's bottom bar: 干员 / 道具, jump to a tier (the 自选 slots still open above 5 / 6), 确认配置 in 快速配置. */
function DeckBar({ deckTab, onDeckTab, counts, active, onJump, diyOpen, quick, onConfirm }) {
  return html`<nav class="lo-bbar" aria-label=${t('物资调配')}>
    <div class="lo-bbar__seg" role="tablist">
      <button type="button" role="tab" aria-selected=${deckTab === 'ops' ? 'true' : 'false'} class=${cx(deckTab === 'ops' && 'is-on')} onClick=${() => onDeckTab('ops')}>
        <${Icon} name="users" />${t('干员')}</button>
      <button type="button" role="tab" aria-selected=${deckTab === 'items' ? 'true' : 'false'} class=${cx(deckTab === 'items' && 'is-on')} onClick=${() => onDeckTab('items')}>
        <${Icon} name="box" />${t('道具')}</button>
    </div>
    <div class="lo-bbar__tiers">
      ${TIERS.map((tier) => html`<button key=${tier} type="button" class=${cx('lo-bbar__tier', active === tier && 'is-on')} disabled=${!counts[tier]}
          onClick=${() => onJump(tier)} title=${t('{tier}阶', { tier })}>
        ${deckTab === 'ops' && diyOpen[tier] ? html`<span class="lo-bbar__diy" title=${t('{tier}阶 还有 {n} 个自选名额', { tier, n: diyOpen[tier] })}><${Icon} name="user" /><b class="num">${diyOpen[tier]}</b></span>` : null}
        <span class="lo-bbar__roman num">${ROMAN[tier]}</span><span>${t('{tier}阶', { tier })}</span>
      </button>`)}
    </div>
    ${quick ? html`<button type="button" class="lo-confirm" onClick=${onConfirm}><${Icon} name="check" />${t('确认配置')}</button>` : null}
  </nav>`;
}

/** The ⓘ sheet: how the deck works, including what this game adds to the event's screen. */
function DeckHelp({ onClose }) {
  const rows = [
    ['干员', '按阶级横向排列；点干员卡在左侧打开详情：技能、模组、潜能与练度、局内数值、皮肤与语音。←/→ 切换干员。'],
    ['快速配置', '在每张卡旁直接切换技能、模组，或潜能·练度；改动即时保存，点「确认配置」收起。'],
    ['干员持有', '标记未持有的干员，开局时由官方替补干员上场；局外设置，下一局生效。'],
    ['甄选干员', '5阶、6阶末尾的卡片即自选编队：持有的 6★ 干员或原型干员，只出现在你自己的商店。'],
    ['道具', '本游戏商店出售的全部装备，点开查看基础 / 进阶效果；两件同名装备合成进阶。'],
    ['筛选与导入导出', '「筛选」按职业、盟约、名字查找，或切换为列表视图；「更多」里导出 / 导入调配、全部恢复默认。'],
  ];
  return html`<${Modal} open=${true} onClose=${onClose} title=${t('调度手册')} micro="DISPATCH MANUAL"
      actions=${html`<${Button} variant="primary" onClick=${onClose}>${t('知道了')}<//>`}>
    <dl class="lo-help">${rows.map(([k, v]) => html`<${Fragment} key=${k}><dt>${t(k)}</dt><dd>${t(v)}</dd><//>`)}</dl>
  <//>`;
}

// ---- screen -------------------------------------------------------------------------------------------------------------

const SYNC_TEXT = {
  idle: ['', ''], pending: [N_('保存中…'), 'is-busy'], sending: [N_('同步中…'), 'is-busy'], synced: [N_('已同步'), 'is-ok'],
  locked: [N_('本局已锁定 · 下一局生效'), 'is-warn'], error: [N_('同步失败'), 'is-bad'],
};
/** The 干员持有 tab's status line: the setting never applies to a running match. */
const OWN_SYNC_TEXT = { ...SYNC_TEXT, locked: [N_('下一局生效'), 'is-warn'] };
/** The 自选编队 tab's status line (msgids, translated where shown): out of match, like 干员持有. */
const DIY_SYNC_TEXT = { ...OWN_SYNC_TEXT };

/**
 * The game-data files a tab cannot work without — its roster and its import's sanitiser: chess.json, plus backups.json
 * for 自选编队 (its slots and the picks' forms) — that did not load. useData counts a file that never arrived (a 404, a
 * blocked request, bad JSON: status 'missing') as settled like a loaded one, so the tab drew an empty roster and an
 * import sanitised every entry away (GitHub #173). Empty while the files load and once they have.
 * @param {string} tab 'loadout' | 'ownership' | 'diy'
 * @param {(name: string) => string} [status] the data store's status (data.status)
 * @returns {string[]} data file names
 */
export function missingGameData(tab, status = data.status) {
  return (tab === 'diy' ? ['chess', 'backups'] : ['chess']).filter((name) => status(name) === 'missing');
}

/**
 * Why an import of `kind` cannot run now, as its toast — the files still loading, or the game data missing — or null.
 * Either way nothing is applied: sanitised against absent data, the 干员持有 / 自选编队 imports stored an empty list over
 * the saved one (GitHub #173).
 * @param {string} kind the dialog's tab @param {boolean} ready the screen's files are settled
 * @param {(name: string) => string} [status]
 * @returns {{ text: string, tone: 'warn'|'error' } | null}
 */
export function importRefusal(kind, ready, status = data.status) {
  if (!ready) return { text: t('干员数据仍在载入，请稍候再导入'), tone: 'warn' };
  if (missingGameData(kind, status).length) return { text: t('导入失败：游戏数据没有载入，未做任何改动。请刷新页面；仍不行时，请检查广告拦截插件和网络'), tone: 'error' };
  return null;
}

/**
 * A loadout payload that carries `ops` (including empty `ops`) replaces 潜能 / 练度. 自选 operators are in that list
 * and only backups.json names them, so the refusal is the 自选编队 one: chess.json and backups.json both loaded.
 * Null when the payload has no `ops` (an older file leaves the current 练度 alone) or that data is ready (GitHub #538).
 * @param {Record<string, any> | null | undefined} ops
 * @param {boolean} ready
 * @param {(name: string) => string} [status]
 * @returns {{ text: string, tone: 'warn'|'error' } | null}
 */
export function loadoutOpsImportRefusal(ops, ready, status = data.status) {
  if (ops == null) return null;
  return importRefusal('diy', ready, status);
}

/** In place of a tab whose game data did not load (missingGameData): which files, and what to try (GitHub #173). */
export function DataMissing({ files }) {
  const urls = files.map((name) => `/data/${DATA_FILES[name] || `${name}.json`}`);
  return html`<div class="lo-loading lo-missing" role="alert" data-testid="loadout-data-missing">
    <${Icon} name="warn" />
    <b>${t('游戏数据没有载入')}</b>
    <p>${t('{files} 没有下载成功，这一页无法显示；已保存的设置不受影响。请刷新页面；仍不行时，请检查广告拦截插件和网络。', { files: urls })}</p>
  </div>`;
}

/** The overlay screen (`leaving`: closed, fading out). */
function LoadoutScreen({ st, leaving = false }) {
  const ready = useData('chess', 'bonds', 'assets', 'local', 'backups', 'garrisons', 'effects', 'skins');
  const phase = useStore((s) => s.match?.public?.phase || null);
  const inMatch = useStore((s) => !!s.room?.inMatch);
  // co-op briefing (INFO_CHECK, 25 s): the overlay covers the briefing's own countdown, so it shows the time left — the
  // match locks the loadout when it runs out (review fix: edits were silently only for the next match)
  const infoDeadline = useStore((s) => (s.match?.public?.phase === PHASE.INFO_CHECK ? s.match.public.deadline : 0));
  const m = data.get('assets');
  const getChess = (id) => data.lookup('chess', id);
  const getBond = (id) => data.lookup('bonds', id);
  const roster = useMemo(() => rosterOf(data.list('chess')), [ready, data.locale()]); // (names follow a language switch)
  const bonds = useMemo(() => {
    const used = new Set(roster.flatMap((c) => c.bonds || []));
    return (data.list('bonds') || []).filter((b) => b && used.has(b.bondId))
      .sort((a, b) => (b.isCore ? 1 : 0) - (a.isCore ? 1 : 0) || (a.bondOrder ?? 0) - (b.bondOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'zh'));
  }, [ready, roster]);
  const list = filterRoster(roster, st.filters, st.entries, getChess, getBond, st.ops);
  const selId = st.sel && roster.some((c) => c.chessId === st.sel) ? st.sel : list[0]?.chessId || roster[0]?.chessId || null;
  const { base, golden } = selId ? recordsOf(selId, getChess) : { base: null, golden: null };
  const nChanged = changedCount(st.entries, getChess, st.ops, roster);
  const locked = (inMatch && phase && phase !== PHASE.INFO_CHECK && phase !== PHASE.LOBBY) || st.sync === 'locked';
  const gridRef = useRef(null);
  const fileRef = useRef(null);                            // hidden <input type=file> of the 导入 dialog
  const [narrowDetail, setNarrowDetail] = useState(false); // phones: the detail slides over the roster
  // the detail's 普通 / 精锐 skill toggle: one preview for its skills, its 特质 and the rows' skill details (display only)
  const [previewLevel, setPreviewLevel] = useState('normal');
  const [io, setIo] = useState(null);                      // 导出 / 导入 dialog: { mode, text } | null
  // the 物资调配处 deck (2026-10-13): the view, 干员 / 道具, 快速配置, the detail drawer, the 筛选 / 更多 popovers, ⓘ
  const [view, setViewState] = useState(loadoutViewPref);
  const setView = (v) => { setViewState(v); savePref(VIEW_PREF, v); };
  const [deckTab, setDeckTab] = useState('ops');
  const [quick, setQuick] = useState(null);                // null | 'skill' | 'module' | 'cult'
  // opened from a member of S.W.E.E.P.报告's 盟约报告 (screens/sweep.js): straight to that operator's detail
  const [drawer, setDrawer] = useState(() => st.from === 'sweep' && !!st.sel);
  const [menu, setMenu] = useState(null);                  // null | 'filter' | 'more'
  const [help, setHelp] = useState(false);
  const [activeTier, setActiveTier] = useState(1);
  const [itemIdx, setItemIdx] = useState(null);
  const deckRef = useRef(null);
  const ui = useRef({});
  ui.current = { drawer, menu, quick, setDrawer, setMenu, setQuick };
  const itemsReady = useData('items');
  const codex = useMemo(() => codexItems(data.get('items')), [itemsReady, data.locale()]);
  const diySlots = ready ? diySlotList(diyData()) : [];

  const tab = st.tab === 'ownership' || st.tab === 'diy' ? st.tab : 'loadout';
  const lost = ready ? missingGameData(tab) : [];
  const ownRoster = useOwnershipRoster(ready);
  const nNotOwned = notOwnedCount(st.notOwned, ownRoster);
  // 自选编队 (0.2.0 DIY): the stored picks, those the server would keep (the kit list of the last welcome)
  const nDiy = diyCount(st.diy);
  const diyLegal = ready ? sanitizeDiyPicks(st.diy, diyData(), st.diyKitted || []) : {};
  const setDiySlot = (slotId, pick) => setDiyPicks(setPick(loadoutStore.get().diy, slotId, pick));
  const clearDiy = async () => {
    if (!nDiy) return;
    const ok = await confirmDialog({ title: t('全部清空'), text: t('清空全部 {n} 个自选名额？', { n: nDiy }), okText: t('全部清空') });
    if (ok) setDiyPicks({});
  };
  const setTab = (t) => loadoutStore.set({ tab: t });
  const toggleOwned = (id, owned) => setNotOwned(setOwned(loadoutStore.get().notOwned, id, owned));
  const ownAll = async () => {
    if (!nNotOwned) return;
    const ok = await confirmDialog({ title: t('全部持有'), text: t('将 {nNotOwned} 名未持有的干员恢复为持有（由本人上场）？', { nNotOwned }), okText: t('全部持有') });
    if (ok) setNotOwned([]);
  };
  // the deck: a card opens the drawer, the open card again closes it
  const pick = (id) => {
    if (view === 'deck' && drawer && loadoutStore.get().sel === id) { setDrawer(false); return; }
    loadoutStore.set({ sel: id }); setNarrowDetail(true); setDrawer(true);
  };
  // a row's quick choice (PR #301): the same setChoice / setEntries path; the row becomes the selection, a phone stays on the list
  const quickChange = (id, patch) => {
    const recs = recordsOf(id, getChess);
    setEntries(setChoice(loadoutStore.get().entries, recs.base, recs.golden, patch));
    loadoutStore.set({ sel: id });
  };
  const change = (patch) => { if (base) setEntries(setChoice(loadoutStore.get().entries, base, golden, patch)); };
  // 0.2.2: an operator's 潜能 / 练度 (by charId: its normal, elite and 自选 forms share them)
  const setOpsOf = (charId, patch) => setOpsMap(setOps(loadoutStore.get().ops, charId, patch));
  const resetOne = () => {
    if (!base) return;
    setOpsMap(resetOps(loadoutStore.get().ops, base.charId));
    setEntries(resetChoice(loadoutStore.get().entries, base.chessId));
  };
  const resetAll = async () => {
    if (!nChanged) return;
    const ok = await confirmDialog({ title: t('全部恢复默认'), text: t('将 {nChanged} 名干员的技能、模组、潜能与练度恢复为默认配置？', { nChanged }), okText: t('恢复默认'), danger: true });
    if (!ok) return;
    // the roster's operators only: a 自选 pick's settings belong to the 自选编队 tab
    const rosterChars = new Set(roster.map((c) => c.charId));
    const keep = {};
    for (const [id, e] of Object.entries(loadoutStore.get().ops || {})) if (!rosterChars.has(id)) keep[id] = e;
    setOpsMap(keep);
    setEntries({});
  };

  // 导出 / 导入 the loadout (or, on the 干员持有 tab, the not-owned list) as the versioned payload (a downloaded file,
  // the clipboard, or the textarea); `io.kind` says which
  const ioText = io?.text ?? '';
  const ioOwn = io?.kind === 'ownership';
  const ioDiy = io?.kind === 'diy';
  const openExport = () => setIo(tab === 'ownership'
    ? { mode: 'export', kind: 'ownership', text: serializeOwnership(loadoutStore.get().notOwned) }
    : tab === 'diy' ? { mode: 'export', kind: 'diy', text: serializeDiy(loadoutStore.get().diy) }
      : { mode: 'export', kind: 'loadout', text: serializeExport(loadoutStore.get().entries, { ops: loadoutStore.get().ops, skins: skinsStore.get().entries }) });
  const openImport = () => setIo({ mode: 'import', kind: tab, text: '' });
  const ioCopy = async () => {
    const ok = await copyText(ioText);
    toast(ok ? t('已复制到剪贴板') : t('复制失败，请在文本框中手动全选复制'), ok ? 'success' : 'warn');
  };
  const ioDownload = () => downloadText(exportFilename(new Date(), ioOwn ? 'ownership' : ioDiy ? 'diy' : 'loadout'), ioText);
  const ioPick = () => fileRef.current?.click();
  const ioFile = async (e) => {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = ''; // picking the same file twice must fire again
    if (!f) return;
    // refuse a huge pick before reading it into memory (a real payload is a few KB)
    if (ioDiy && f.size > DIY_IMPORT_MAX_BYTES) { toast(t('文件过大，请选择「导出」下载的自选编队文件'), 'error'); return; }
    if (f.size > (ioOwn ? OWNERSHIP_IMPORT_MAX_BYTES : LOADOUT_IMPORT_MAX_BYTES)) { toast(ioOwn ? t('文件过大，请选择「导出」下载的干员持有文件') : t('文件过大，请选择「导出」下载的调配文件'), 'error'); return; }
    try { setIo({ ...io, mode: 'import', text: await readFileText(f) }); } catch { toast(t('读取文件失败'), 'error'); }
  };
  const ioApply = () => {
    // an import before chess.json is loaded, or when it never arrived, would sanitise every entry away — refuse instead
    // of wiping the loadout
    const refused = importRefusal(io.kind, ready);
    if (refused) { toast(refused.text, refused.tone); return; }
    if (ioDiy) {
      const r = parseDiyImport(ioText);
      if (!r.ok) { toast(t('导入失败：{error}', { error: t(r.error, r.params) }), 'error'); return; }
      const { applied, dropped } = applyDiyImport(r.picks, diyData(), loadoutStore.get().diyKitted || []);
      setIo(null);
      toast(applied ? t('已导入 {n} 个自选名额', { n: applied }) + (dropped ? t('（另有 {n} 项不可用，未导入）', { n: dropped }) : '') : t('已导入：全部名额为空'), dropped ? 'warn' : 'success');
      return;
    }
    if (ioOwn) {
      const r = parseOwnershipImport(ioText);
      if (!r.ok) { toast(t('导入失败：{error}', { error: r.error }), 'error'); return; }
      const { applied, dropped } = applyOwnershipImport(r.notOwned, getChess);
      setIo(null);
      toast(applied ? (dropped ? t('已导入：{applied} 名干员未持有（另有 {dropped} 项无效，未导入）', { applied, dropped }) : t('已导入：{applied} 名干员未持有', { applied }))
        : t('已导入：全部持有'), dropped ? 'warn' : 'success');
      return;
    }
    const res = parseImport(ioText);
    if (!res.ok) { toast(t('导入失败：{error}', { error: res.error }), 'error'); return; }
    // ops replaces 潜能 / 练度, including 自选 operators that only backups.json names. Missing data used to drop
    // them and still save, clearing a 练度 the file did not mean to erase (GitHub #538).
    const opsRefused = loadoutOpsImportRefusal(res.ops, ready);
    if (opsRefused) { toast(opsRefused.text, opsRefused.tone); return; }
    // 0.2.2: a payload with `ops` replaces the 潜能 / 练度 too (an older export leaves them alone)
    const opIds = res.ops ? cultivationCharIds(data.get('chess'), data.get('backups')) : null;
    const r = applyLoadoutEntries(res.entries, getChess, res.ops ? { ops: res.ops, isOperator: (id) => opIds.has(id) } : {});
    const { applied, dropped } = r;
    const nOps = r.ops ?? 0;
    const skinsApplied = res.skins ? Object.keys(res.skins).length : 0;
    if (skinsApplied) setSkins(mergeSkins(skinsStore.get().entries, res.skins));
    // nothing survived sanitising (unknown chess, or every choice already the default): keep the current loadout
    if (!applied && !nOps && !skinsApplied) { toast(t('导入失败：这份数据在当前版本没有可用的调配，未做任何改动'), 'error'); return; }
    setIo(null);
    if (skinsApplied) toast(`已导入 ${skinsApplied} 款皮肤`, 'success');
    toast(!applied ? t('已导入 {n} 名干员的潜能与练度', { n: nOps })
      : dropped ? t('已导入 {applied} 名干员（另有 {dropped} 项未导入）', { applied, dropped })
        : t('已导入 {applied} 名干员的调配', { applied }), dropped ? 'warn' : 'success');
  };

  // Esc closes; ←/→ browse the filtered roster (not while typing in the search field)
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal')) return; // a confirm dialog handles its own keys
      if (e.key === 'Escape' && document.querySelector('.diy-pick')) return; // the 自选 picker's Esc closes only the picker (diy.js)
      if (document.querySelector('.lo-idetail')) return; // the item detail's Esc / ←→ (ItemsTab)
      const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape') {
        e.preventDefault(); e.stopImmediatePropagation();
        // the deck peels back one layer at a time: a popover, 快速配置, the drawer, then the overlay
        const u = ui.current;
        if (u.menu) { u.setMenu(null); return; }
        if (u.quick) { u.setQuick(null); return; }
        if (u.drawer) { u.setDrawer(false); return; }
        closeLoadout(); return;
      }
      if (typing) return;
      // (a row's quick choices: ←/→ stay with the focused group, PR #301)
      if (e.target?.closest?.('.lo-quick') && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) return;
      if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && loadoutStore.get().tab !== 'ownership' && loadoutStore.get().tab !== 'diy') {
        const ids = filterRoster(rosterOf(data.list('chess')), loadoutStore.get().filters, loadoutStore.get().entries, getChess, getBond, loadoutStore.get().ops).map((c) => c.chessId);
        if (!ids.length) return;
        const cur = Math.max(0, ids.indexOf(loadoutStore.get().sel));
        const next = ids[(cur + (e.key === 'ArrowRight' ? 1 : -1) + ids.length) % ids.length];
        loadoutStore.set({ sel: next });
        e.preventDefault();
      }
      // swallow single-key game shortcuts (R / F / D / Space …) while the overlay is open
      if (e.key.length === 1 || e.key === ' ') { e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // keep the selected card in view (the list scrolls down, the deck sideways)
  useEffect(() => {
    const el = (view === 'deck' ? deckRef : gridRef).current?.querySelector(`[data-chess="${selId}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selId]);
  // the drawer: the deck makes room on its left (.has-drawer) and scrolls by the same width, so nothing jumps; the
  // selected card then comes into view beside the drawer (scroll-padding-left)
  const drawerW = useRef(0);
  const wasDrawer = useRef(false);
  useLayoutEffect(() => {
    const d = deckRef.current;
    const open = view === 'deck' && deckTab === 'ops' && drawer && !!base;
    if (d && open !== wasDrawer.current) {
      if (open) drawerW.current = d.parentElement?.querySelector('.lo-drawer')?.offsetWidth || 0;
      d.scrollLeft += open ? drawerW.current : -drawerW.current;
    }
    wasDrawer.current = open;
    if (d && open) d.querySelector(`[data-chess="${selId}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [drawer, selId, view, deckTab]);
  // the item detail: Esc closes it, ←/→ browse the codex (the screen's own handler steps aside while it is open)
  useEffect(() => {
    if (itemIdx == null) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); setItemIdx(null); return; }
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopImmediatePropagation();
      setItemIdx((i) => (i == null || !codex.length ? i : (i + (e.key === 'ArrowRight' ? 1 : -1) + codex.length) % codex.length));
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [itemIdx == null, codex.length]);
  // the lobby chat (z 180) floats above the overlay: it steps aside while the overlay is open
  useEffect(() => {
    document.body.classList.add('lo-open');
    return () => document.body.classList.remove('lo-open');
  }, []);
  // a popover closes on a press outside it
  useEffect(() => {
    if (!menu) return undefined;
    const onDown = (e) => { if (!e.target?.closest?.('.lo-pop, .lo-popbtn')) setMenu(null); };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [menu]);
  const jumpTier = (tier) => {
    const deck = deckRef.current;
    const sec = deck?.querySelector(`.lo-tgroup[data-tier="${tier}"]`);
    if (!deck || !sec) return;
    deck.scrollTo({ left: Math.max(0, sec.offsetLeft - (drawer && deckTab === 'ops' ? deck.clientWidth * 0.4 : 0)), behavior: 'smooth' });
    setActiveTier(tier);
  };
  const switchDeckTab = (k) => {
    setDeckTab(k); setQuick(null); setItemIdx(null); setActiveTier(1);
    if (deckRef.current) deckRef.current.scrollLeft = 0;
  };
  const nFilters = ['tier', 'prof', 'bond', 'changedOnly'].filter((k) => !!st.filters?.[k]).length + (String(st.filters?.query || '').trim() ? 1 : 0);
  const tierCounts = deckTab === 'items'
    ? Object.fromEntries(TIERS.map((tier) => [tier, codex.filter((x) => x.tier === tier).length]))
    : Object.fromEntries(TIERS.map((tier) => [tier, list.filter((c) => c.tier === tier).length + (nFilters ? 0 : diySlots.filter((s) => s.tier === tier).length)]));
  const diyOpen = Object.fromEntries(TIERS.map((tier) => [tier, diySlots.filter((s) => s.tier === tier && !diyLegal[s.slotId]).length]));

  const [syncText, syncCls] = tab === 'ownership' ? OWN_SYNC_TEXT[st.ownSync] || OWN_SYNC_TEXT.idle
    : tab === 'diy' ? DIY_SYNC_TEXT[st.diySync] || DIY_SYNC_TEXT.idle : SYNC_TEXT[st.sync] || SYNC_TEXT.idle;
  const fromText = st.from === 'briefing' ? t('确认本局信息阶段结束前可调整本局配置') : t('开始模拟前可调整干员携带的技能与模组，以及潜能与练度；干员的局内等级不可调整');
  // 干员持有 is out of match: a running match keeps the list its seat had at its start
  const ownLocked = inMatch && !!phase && phase !== PHASE.LOBBY;
  const ownText = ownLocked ? t('干员持有是局外设置：本局按开局时的设置进行，修改将在下一局生效')
    : t('局外设置，下一局生效 · 联机时只影响你自己的棋子 · 默认全部持有');
  const diyText = ownLocked ? t('自选编队是局外设置：本局按开局时的设置进行，修改将在下一局生效')
    : t('局外设置，下一局生效 · 联机时只进入你自己的商店');

  const deck = view === 'deck';
  const deckLoadout = deck && tab === 'loadout';
  const clearFilters = () => loadoutStore.set({ filters: { ...st.filters, tier: null, prof: null, bond: null, query: '', changedOnly: false } });
  const lockedText = t('本局的调配已锁定（确认本局信息后无法修改），修改将在下一局生效');
  const loadoutDetail = html`<${Detail} m=${m} chess=${base} golden=${golden} entries=${st.entries} ops=${st.ops} onChange=${change} onOps=${setOpsOf} onReset=${resetOne} locked=${locked}
    level=${golden ? previewLevel : 'normal'} onLevel=${setPreviewLevel}
    notOwned=${!!base && (st.notOwned || []).includes(base.chessId)} />`;

  return html`<${Fragment}>
  <div class=${cx('lo', deck && 'lo--deck', leaving && 'is-leaving')} role="dialog" aria-modal="true" aria-label=${t('干员调配')}>
    <div class="lo__bg" aria-hidden="true"></div>
    <header class=${cx('lo-top', deck && 'lo-top--deck')}>
      <div class="lo-top__left">
        ${deck && tab !== 'loadout'
          ? html`<${Button} variant="ghost" size="md" icon="chevronLeft" class="lo-back" onClick=${() => setTab('loadout')} title=${t('返回干员调配')}>${t('干员调配')}<//>`
          : html`<${Button} variant="ghost" size="md" icon="chevronLeft" class="lo-back" onClick=${closeLoadout} aria-label=${t('返回')} title=${t('返回 (Esc)')}>${t('返回')}<//>`}
        ${deck ? html`<button type="button" class="lo-info" onClick=${() => setHelp(true)} aria-label=${t('调度手册')} title=${t('调度手册')}><${Icon} name="info" /></button>` : null}
      </div>
      <div class="lo-top__center">
        ${deckLoadout ? html`<${MicroLabel} tone="mint">${quick ? 'QUICK ASSEMBLE' : 'OPERATOR LOADOUT'}<//>
          <p class=${cx('lo-top__note', locked && 'is-locked')}>${quick === 'cult' ? t('潜能与练度按干员保存，普通、精锐形态与自选共用')
            : quick ? t('快速编辑：展示干员精锐形态的技能与模组，改动即时保存') : locked ? lockedText : fromText}</p>`
        : deck ? html`<${MicroLabel} tone="mint">${tab === 'ownership' ? 'OPERATOR ROSTER' : 'SELF-SELECT SQUAD'}<//>
          <h2 class="lo-top__title">${tab === 'ownership' ? t('干员持有') : t('自选编队')}</h2>`
        : html`<${MicroLabel} tone="mint">${tab === 'ownership' ? 'OPERATOR ROSTER' : tab === 'diy' ? 'SELF-SELECT SQUAD' : 'OPERATOR LOADOUT'}<//>
        <div class="lo-tabs" role="tablist" aria-label=${t('干员调配 / 干员持有 / 自选编队')}>
          <button type="button" role="tab" aria-selected=${tab === 'loadout' ? 'true' : 'false'} data-tab="loadout" class=${cx('lo-tab', tab === 'loadout' && 'is-on')} onClick=${() => setTab('loadout')}>
            <${Img} src=${localAsset('ui/outer', 'operator_preset')} class="lo-top__icon" fallback=${html`<${Icon} name="edit" class="lo-top__icon" />`} />${t('干员调配')}</button>
          <button type="button" role="tab" aria-selected=${tab === 'ownership' ? 'true' : 'false'} data-tab="ownership" class=${cx('lo-tab', tab === 'ownership' && 'is-on')} onClick=${() => setTab('ownership')}
            title=${t('标记未持有的干员：由官方指定的替补干员上场')}>${t('干员持有')}${nNotOwned ? html`<span class="lo-tab__n num" aria-label=${t('{nNotOwned} 名未持有', { nNotOwned })}>${nNotOwned}</span>` : null}</button>
          <button type="button" role="tab" aria-selected=${tab === 'diy' ? 'true' : 'false'} data-tab="diy" class=${cx('lo-tab', tab === 'diy' && 'is-on')} onClick=${() => setTab('diy')}
            title=${t('5阶、6阶的自选名额：持有的 6★ 干员或原型干员')}>${t('自选编队')}${nDiy ? html`<span class="lo-tab__n num" aria-label=${t('{n} 个自选名额已选择', { n: nDiy })}>${nDiy}</span>` : null}</button>
        </div>`}
      </div>
      ${tab === 'diy' ? html`<div class="lo-top__right">
        ${syncText ? html`<span class=${cx('lo-sync', syncCls)} role="status" data-testid="diy-sync">${t(syncText)}</span>` : null}
        <span class="lo-count">${t('已选')} <b class="num">${nDiy}</b><span class="num t-dim">/4</span></span>
        <${Button} variant="ghost" size="sm" data-testid="diy-export" disabled=${!nDiy} onClick=${openExport} title=${t('导出自选编队（可复制或下载）')}>${t('导出')}<//>
        <${Button} variant="ghost" size="sm" data-testid="diy-import" disabled=${!ready} onClick=${openImport} title=${t('导入自选编队（粘贴或选择文件）')}>${t('导入')}<//>
        <${Button} variant="secondary" size="sm" icon="refresh" data-testid="diy-reset" disabled=${!nDiy} onClick=${clearDiy}>${t('全部清空')}<//>
      </div>` : tab === 'ownership' ? html`<div class="lo-top__right">
        ${syncText ? html`<span class=${cx('lo-sync', syncCls)} role="status" data-testid="ownership-sync">${t(syncText)}</span>` : null}
        <span class="lo-count">${t('未持有')} <b class="num">${nNotOwned}</b><span class="num t-dim">/${ownRoster.length}</span></span>
        <${Button} variant="ghost" size="sm" data-testid="ownership-export" disabled=${!nNotOwned} onClick=${openExport} title=${t('导出干员持有（可复制或下载）')}>${t('导出')}<//>
        <${Button} variant="ghost" size="sm" data-testid="ownership-import" disabled=${!ready} onClick=${openImport} title=${t('导入干员持有（粘贴或选择文件）')}>${t('导入')}<//>
        <${Button} variant="secondary" size="sm" icon="refresh" data-testid="ownership-reset" disabled=${!nNotOwned} onClick=${ownAll}>${t('全部持有')}<//>
      </div>` : deck ? html`<div class="lo-top__right">
        ${inMatch && hasDeadline(infoDeadline) ? html`<${Countdown} deadline=${infoDeadline} size="sm" gauge=${false} label=${t('调配截止')} class="lo-deadline" />` : null}
        ${quick ? html`<span class="lo-qbar__k">${t('快速编辑')}</span>
          <div class="lo-qseg" role="tablist" aria-label=${t('快速编辑')}>
            ${[['skill', N_('技能')], ['module', N_('模组')], ['cult', N_('潜能·练度')]].map(([k, l]) => html`<button key=${k} type="button" role="tab"
              aria-selected=${quick === k ? 'true' : 'false'} class=${cx(quick === k && 'is-on')} onClick=${() => setQuick(k)}>${t(l)}</button>`)}
          </div>`
        : html`${syncText ? html`<span class=${cx('lo-sync', syncCls)} role="status">${t(syncText)}</span>` : null}
          <span class="lo-count">${t('已调整')} <b class="num">${nChanged}</b><span class="num t-dim">/${roster.length}</span></span>
          <div class="lo-popwrap">
            <button type="button" class=${cx('lo-tbtn', 'lo-popbtn', (menu === 'filter' || nFilters) && 'is-on')} aria-expanded=${menu === 'filter' ? 'true' : 'false'}
                onClick=${() => setMenu(menu === 'filter' ? null : 'filter')} title=${t('筛选干员 · 切换列表视图')}>
              <${Icon} name="search" /><span class="lo-tbtn__l">${t('筛选')}</span>${nFilters ? html`<b class="lo-tbtn__n num">${nFilters}</b>` : null}</button>
            ${menu === 'filter' ? html`<div class="lo-pop lo-pop--filter">
              <${Filters} m=${m} filters=${st.filters} bonds=${bonds} onFilters=${(filters) => loadoutStore.set({ filters })} />
              <div class="lo-pop__row">
                <span class="lo-pop__k">${t('显示方式')}</span>
                <div class="lo-seg" role="tablist">
                  <button type="button" role="tab" aria-selected="true" class="is-on">${t('卡片')}</button>
                  <button type="button" role="tab" aria-selected="false" onClick=${() => { setMenu(null); setDrawer(false); setView('list'); }}>${t('列表')}</button>
                </div>
                ${nFilters ? html`<button type="button" class="lo-tbtn" onClick=${clearFilters}>${t('清除筛选')}</button>` : null}
              </div>
            </div>` : null}
          </div>
          <div class="lo-popwrap">
            <button type="button" class=${cx('lo-tbtn', 'lo-popbtn', menu === 'more' && 'is-on')} aria-expanded=${menu === 'more' ? 'true' : 'false'} aria-label=${t('更多')}
              title=${t('导出 / 导入 / 全部恢复默认')} onClick=${() => setMenu(menu === 'more' ? null : 'more')}><${Icon} name="dots" /></button>
            ${menu === 'more' ? html`<div class="lo-pop lo-pop--menu" role="menu">
              <button type="button" role="menuitem" data-testid="loadout-export" disabled=${!nChanged && !Object.keys(st.ops || {}).length}
                onClick=${() => { setMenu(null); openExport(); }}><${Icon} name="copy" />${t('导出调配')}</button>
              <button type="button" role="menuitem" data-testid="loadout-import" disabled=${!ready} onClick=${() => { setMenu(null); openImport(); }}><${Icon} name="link" />${t('导入调配')}</button>
              <button type="button" role="menuitem" class="is-danger" disabled=${!nChanged} onClick=${() => { setMenu(null); resetAll(); }}><${Icon} name="refresh" />${t('全部恢复默认')}</button>
            </div>` : null}
          </div>
          <button type="button" class="lo-assist" data-testid="loadout-ownership" onClick=${() => { setMenu(null); setTab('ownership'); }}
              title=${t('标记未持有的干员：由官方指定的替补干员上场')}>
            <span class="lo-assist__txt"><span class="lo-assist__k">${t('干员持有')}</span>
              <b class="lo-assist__v num">${nNotOwned ? t('未持有 {n}', { n: nNotOwned }) : t('全部持有')}</b></span>
            <span class="lo-assist__icon"><${Icon} name="users" /></span>
          </button>
          <button type="button" class="lo-quickbtn" data-testid="loadout-quick" disabled=${!ready || !!lost.length || deckTab !== 'ops'}
              onClick=${() => { setMenu(null); setQuick('skill'); }} title=${t('在每张卡旁直接切换技能、模组、潜能与练度')}>
            <span class="lo-quickbtn__txt"><span>${t('快速配置')}</span><small>QUICK ASSEMBLE</small></span>
            <span class="lo-quickbtn__icon"><${Icon} name="edit" /></span>
          </button>`}
      </div>` : html`<div class="lo-top__right">
        ${inMatch && hasDeadline(infoDeadline) ? html`<${Countdown} deadline=${infoDeadline} size="sm" gauge=${false} label=${t('调配截止')} class="lo-deadline" />` : null}
        ${syncText ? html`<span class=${cx('lo-sync', syncCls)} role="status">${t(syncText)}</span>` : null}
        <span class="lo-count">${t('已调整')} <b class="num">${nChanged}</b><span class="num t-dim">/${roster.length}</span></span>
        <${Button} variant="ghost" size="sm" onClick=${() => setView('deck')} title=${t('切换为卡片视图（物资调配处）')}>${t('卡片视图')}<//>
        <${Button} variant="ghost" size="sm" data-testid="loadout-export" disabled=${!nChanged && !Object.keys(st.ops || {}).length} onClick=${openExport} title=${t('导出当前调配（可复制或下载）')}>${t('导出')}<//>
        <${Button} variant="ghost" size="sm" data-testid="loadout-import" disabled=${!ready} onClick=${openImport} title=${t('导入调配（粘贴或选择文件）')}>${t('导入')}<//>
        <${Button} variant="secondary" size="sm" icon="refresh" disabled=${!nChanged} onClick=${resetAll}>${t('全部恢复默认')}<//>
      </div>`}
    </header>
    ${tab === 'diy'
      ? html`<p class=${cx('lo-note', ownLocked && 'is-locked')}><${Icon} name="info" />${diyText}</p>`
      : tab === 'ownership'
      ? html`<p class=${cx('lo-note', ownLocked && 'is-locked')}><${Icon} name="info" />${ownText}</p>`
      : deck ? null
      : html`<p class=${cx('lo-note', locked && 'is-locked')}><${Icon} name="info" />${locked ? lockedText : fromText}</p>`}
    ${!ready ? html`<div class="lo-loading"><${Spinner} size="sm" />${t('正在载入干员数据（打开页面后仅载入一次）…')}</div>`
      : lost.length ? html`<${DataMissing} files=${lost} />` : tab === 'diy'
      ? html`<${DiyPanel} m=${m} picks=${st.diy || {}} legal=${diyLegal} kitted=${st.diyKitted} onSet=${setDiySlot} ops=${st.ops} onOps=${setOpsOf} />`
      : tab === 'ownership'
      ? html`<${OwnershipPanel} m=${m} roster=${ownRoster} notOwned=${st.notOwned} onToggle=${toggleOwned} />`
      : deck ? html`<main class="lo-deckwrap">
        ${deckTab === 'items'
          ? html`<${ItemCodex} m=${m} items=${codex} deckRef=${deckRef} onOpen=${setItemIdx} onTier=${setActiveTier} />
            ${itemIdx != null ? html`<${ItemDetail} m=${m} items=${codex} index=${itemIdx} all=${data.get('items')} onIndex=${setItemIdx} onClose=${() => setItemIdx(null)} />` : null}`
          : html`<${DeckView} m=${m} list=${list} getChess=${getChess} st=${st} selId=${selId} quick=${quick} onPick=${pick} onChange=${quickChange} onOps=${setOpsOf}
              onDiy=${() => setTab('diy')} diySlots=${diySlots} diyPicks=${diyLegal} deckRef=${deckRef} drawer=${drawer && !!base} onTier=${setActiveTier} filtered=${nFilters > 0} />
            ${drawer && base ? html`<div class="lo-drawer" data-testid="loadout-drawer">
              <button type="button" class="lo-drawer__close" onClick=${() => setDrawer(false)} title=${t('收起 (Esc)')}><${Icon} name="chevronLeft" />${t('收起')}</button>
              ${loadoutDetail}
            </div>` : null}`}
      </main>
      <${DeckBar} deckTab=${deckTab} onDeckTab=${switchDeckTab} counts=${tierCounts} active=${activeTier} onJump=${jumpTier} diyOpen=${diyOpen} quick=${quick} onConfirm=${() => setQuick(null)} />`
      : html`<main class=${cx('lo-body', narrowDetail && 'is-detail')}>
      <section class="lo-roster">
        <${Filters} m=${m} filters=${st.filters} bonds=${bonds} onFilters=${(filters) => loadoutStore.set({ filters })} />
        <div class="lo-list" ref=${gridRef}>
          <${RosterHead} />
          <div class="lo-list__rows" role="list" aria-label=${t('干员列表')}>
            ${list.length ? list.map((c) => html`<${RosterRow} key=${c.chessId} m=${m} chess=${c} golden=${c.goldenId ? getChess(c.goldenId) : null}
              entries=${st.entries} ops=${st.ops} selected=${c.chessId === selId} onPick=${pick} onChange=${quickChange} onOps=${setOpsOf}
              level=${previewLevel} notOwned=${(st.notOwned || []).includes(c.chessId)} />`) : html`<p class="lo-empty t-dim">${t('没有符合条件的干员')}</p>`}
          </div>
        </div>
      </section>
      <div class="lo-detail-wrap">
        <button type="button" class="lo-detail-back tapx" onClick=${() => setNarrowDetail(false)}><${Icon} name="chevronLeft" />${t('干员列表')}</button>
        ${loadoutDetail}
      </div>
    </main>`}
  </div>
  ${help ? html`<${DeckHelp} onClose=${() => setHelp(false)} />` : null}
  ${io ? html`<${Modal} open=${true} onClose=${() => setIo(null)}
      title=${ioDiy ? t(io.mode === 'export' ? '导出自选编队' : '导入自选编队')
        : io.mode === 'export' ? (ioOwn ? t('导出干员持有') : t('导出干员调配')) : (ioOwn ? t('导入干员持有') : t('导入干员调配'))}
      micro=${ioOwn ? 'OPERATOR ROSTER' : ioDiy ? 'SELF-SELECT SQUAD' : 'OPERATOR LOADOUT'}
      actions=${io.mode === 'export'
        ? html`<${Button} variant="ghost" onClick=${() => setIo(null)}>${t('关闭')}<//>
            <${Button} variant="secondary" icon="copy" data-testid="loadout-io-copy" onClick=${ioCopy}>${t('复制')}<//>
            <${Button} variant="primary" data-testid="loadout-io-download" onClick=${ioDownload}>${t('下载文件')}<//>`
        : html`<${Button} variant="ghost" onClick=${() => setIo(null)}>${t('取消')}<//>
            <${Button} variant="secondary" data-testid="loadout-io-pick" onClick=${ioPick}>${t('选择文件')}<//>
            <${Button} variant="primary" icon="check" data-testid="loadout-io-apply" disabled=${!ioText.trim() || !ready} onClick=${ioApply}>${t('导入')}<//>`}>
      <p class="lo-io__hint">${ioDiy
        ? (io.mode === 'export'
          ? t('共 {n} 个自选名额已选择。复制或下载这份数据，即可在别的设备或浏览器上导入。', { n: nDiy })
          : t('把导出的自选编队数据粘贴到下方，或点「选择文件」。导入会覆盖当前的自选编队。'))
        : ioOwn
        ? (io.mode === 'export'
          ? html`${tParts('共 {n} 名干员未持有。复制或下载这份数据，即可在别的设备或浏览器上导入。', { n: html`<b class="num">${nNotOwned}</b>`, count: nNotOwned })}`
          : html`${tParts('把导出的干员持有数据粘贴到下方，或点「选择文件」。导入会{overwrite}当前的干员持有设置。', { overwrite: html`<strong>${t('覆盖')}</strong>` })}`)
        : io.mode === 'export'
          ? html`${tParts('共 {n} 名干员已调整。复制或下载这份数据，即可在别的设备或浏览器上导入。', { n: html`<b class="num">${nChanged}</b>`, count: nChanged })}`
          : html`${t('把导出的内容粘贴到下方，或点「选择文件」。')}${nChanged ? html`${tParts('导入会{overwrite}当前的 {nChanged} 名干员调配。', { overwrite: html`<strong>${t('覆盖')}</strong>`, nChanged })}` : null}`}</p>
      <textarea class="lo-io__text" data-testid="loadout-io-text" spellcheck=${false} readOnly=${io.mode === 'export'} value=${ioText}
        placeholder=${io.mode === 'export' ? '' : ioDiy ? t('在此粘贴导出的自选编队内容…') : ioOwn ? t('在此粘贴导出的干员持有内容…') : t('在此粘贴导出的调配内容…')}
        onInput=${(e) => setIo({ ...io, text: e.currentTarget.value })}></textarea>
      <input type="file" accept=".json,application/json,text/plain" class="lo-io__file" ref=${fileRef} onChange=${ioFile} />
    <//>` : null}
<//>`;
}

/**
 * Whether the overlay must close because its context moved on: opened from the briefing and the match left INFO_CHECK
 * (the strategy draft needs the player), or opened from the lobby / room and a match started (its briefing takes over).
 * @param {{ open: boolean, from: string|null }} st @param {string|null} phase @param {boolean} inMatch @param {boolean} wasInMatch
 */
export function shouldAutoClose(st, phase, inMatch, wasInMatch) {
  if (!st || !st.open) return false;
  if (st.from === 'briefing') return !!phase && phase !== PHASE.INFO_CHECK;
  return inMatch && !wasInMatch;
}

/** Mounted once (main.js): renders the overlay while open. */
export function LoadoutHost() {
  const st = useStore((s) => s, Object.is, loadoutStore);
  const phase = useStore((s) => s.match?.public?.phase || null);
  const inMatch = useStore((s) => !!s.room?.inMatch);
  const wasInMatch = useRef(inMatch);
  useEffect(() => {
    if (shouldAutoClose(st, phase, inMatch, wasInMatch.current)) closeLoadout();
    wasInMatch.current = inMatch;
  }, [phase, inMatch, st.open]);
  useEffect(() => {
    if (st.open) document.documentElement.classList.add('sp-loadout-open');
    else document.documentElement.classList.remove('sp-loadout-open');
  }, [st.open]);
  // closed: kept for its fade-out
  const [shown, leaving] = usePresence(st.open, LEAVE_MS);
  if (!shown) return null;
  return html`<${LoadoutScreen} st=${st} leaving=${leaving} />`;
}

/**
 * The entry button's badge: the same number as the screen's 已调整 N (a stored entry of a chess the data no longer offers
 * never applies) once chess.json is loaded; before that the stored entries (the badge alone must not trigger the 1.6 MB
 * download). Review fix: it counted stale entries the screen does not. With `ops` (0.2.2) the operators whose 潜能 / 练度
 * differ count too (before chess.json: the stored entries plus the stored settings, an operator possibly twice).
 * @param {Record<string, any>} entries @param {((id: string) => any) | null} getChess null while chess.json is not loaded
 * @param {Record<string, any>|null} [ops] @param {any[]|null} [roster] rosterOf(…) of the loaded data
 */
export function badgeCount(entries, getChess, ops = null, roster = null) {
  return getChess ? changedCount(entries, getChess, ops, roster) : Object.keys(entries || {}).length + Object.keys(ops || {}).length;
}

/**
 * Entry button (lobby / room / briefing).
 * @param {{ from: 'lobby'|'room'|'briefing', size?: string, variant?: string, class?: string, label?: string }} props
 */
export function LoadoutButton({ from, size = 'md', variant = 'secondary', class: cls, label = t('干员调配') }) {
  useData('local'); // the official preset icon (re-render once the local-art manifest arrives)
  const entries = useStore((s) => s.entries, Object.is, loadoutStore);
  const ops = useStore((s) => s.ops, Object.is, loadoutStore);
  const notOwned = useStore((s) => s.notOwned, Object.is, loadoutStore);
  const diy = useStore((s) => s.diy, Object.is, loadoutStore);
  const chessReady = data.status('chess') === 'ready';
  const n = badgeCount(entries, chessReady ? (id) => data.lookup('chess', id) : null, ops, chessReady ? rosterOf(data.list('chess')) : null);
  // 0.2.0 补位: how many operators the player marked as not owned (the 干员持有 tab) — easy to forget between sessions
  const off = Array.isArray(notOwned) ? notOwned.length : 0;
  // 0.2.0 自选编队: how many DIY slots the player filled
  const nDiy = diyCount(diy);
  return html`<button type="button" class=${cx('btn', `btn--${variant}`, `btn--${size}`, 'lo-entry', cls)} data-testid="loadout-open"
      onClick=${() => openLoadout(from)} title=${t('调整干员携带的技能与模组 · 干员持有')}>
    <${Img} src=${localAsset('ui/outer', 'operator_preset')} class="lo-entry__icon" fallback=${html`<${Icon} name="edit" class="btn__icon" />`} />
    <span class="btn__label">${label}</span>
    ${n ? html`<span class="lo-entry__n num" aria-label=${t('{n} 名干员已调整', { n })}>${n}</span>` : null}
    ${off ? html`<span class="lo-entry__own" aria-label=${t('{off} 名干员未持有，由替补干员上场', { off })} title=${t('{off} 名干员未持有（由替补干员上场）', { off })}>${t('替补')} <b class="num">${off}</b></span>` : null}
    ${nDiy ? html`<span class="lo-entry__own lo-entry__diy" aria-label=${t('{n} 个自选名额已选择', { n: nDiy })} title=${t('{n} 个自选名额已选择', { n: nDiy })}>${t('自选')} <b class="num">${nDiy}</b></span>` : null}
  </button>`;
}
