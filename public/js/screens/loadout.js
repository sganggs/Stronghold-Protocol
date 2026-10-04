// 干员调配 (Operator loadout, DESIGN §16): choose the equipped skill of every chess and the module of its elite before a
// match (official rule: "开始游戏前无法调整干员的等级，但可调整其所携带的技能和模组"). A full-screen overlay opened
// from the lobby, the room and the briefing (INFO_CHECK) — `openLoadout(from)` / <LoadoutButton/>; <LoadoutHost/> is
// mounted once by main.js. Styles: css/screens/loadout.css (official preset sprites from the local-client art when
// present: operator_preset, image_skill_select_outline, skill_select_deco, icon_equip_non; the module type icons of
// groups.module — lettered tiles without them).
//
// Left: roster of the 112 visible chess (tier / class / bond filters, search, 仅看已调整) — each card shows the equipped
// skill (S1–S3) and, when changed, the elite's module badge. Right: the selected chess — skills (icon, name, 默认,
// SP recovery, 初始 / 消耗 SP, duration, description at 普通 Lv.4 or 精锐 Lv.7), 局内数值 (the stats, 攻击范围, 特性 and
// 天赋 the chosen variant — 精锐 first, 普通 on the toggle — fights with under the chosen skill and module: the detail
// card's own block and pure functions, GitHub issue #64) and the elite's modules (不装备 / X / Y … with the stat bonus,
// the trait upgrade and the talent changes), 恢复默认; 全部恢复默认 in the top bar.
// The loadout lives in ui/loadoutSync.js (localStorage + room.loadout); the model is ui/loadoutModel.js.
// Keyboard: Esc closes, ←/→ move through the (filtered) roster when focus is not in the search field.

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button, TierChip, TextField, Countdown, Spinner, confirmDialog, hasDeadline, Modal, Fragment } from '../ui/components.js';
import { Img, RichText, UnitThumb } from '../ui/gameComponents.js';
import { chessAvatarUrl, chessPortraitUrl, subProfIconUrl, bondIconUrl, moduleTypeIconUrl } from '../ui/assetUrls.js';
import { chessStatsBlock, traitText, chessTalents } from '../ui/detailPanel.js';
import { chessLoadout } from '../ui/gameLogic.js';
import { data, useData, localAsset } from '../data.js';
import { useStore } from '../store.js';
import { PHASE } from '../../../shared/constants.js';
import {
  MODULE_NONE, PROF_ORDER, PROF_NAME, rosterOf, filterRoster, recordsOf, chessOptions, effectiveChoice, setChoice, resetChoice,
  changedCount, skillLabel, moduleBadge, attrRows, skillTags, serializeExport, parseImport, LOADOUT_IMPORT_MAX_BYTES,
} from '../ui/loadoutModel.js';
import { loadoutStore, openLoadout, closeLoadout, setEntries, applyLoadoutEntries } from '../ui/loadoutSync.js';
import { copyText } from '../ui/clipboard.js';
import { toast } from '../ui/toasts.js';
import { T, TH } from '../i18n.js';

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

/** `stronghold-loadout-20261003-1245.json` */
function exportFilename(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `stronghold-loadout-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
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

// ---- roster card ---------------------------------------------------------------------------------------------------

function RosterCard({ m, chess, golden, entries, selected, onPick }) {
  const choice = effectiveChoice(entries, chess, golden);
  const opt = chessOptions(chess, golden);
  const skillRec = opt.skillOptions.find((s) => s.index === choice.skill)?.normal || chess.skill;
  const modRec = golden && choice.module !== MODULE_NONE ? opt.moduleOptions.find((x) => x.id === choice.module)?.rec || null : null;
  const modChanged = golden && choice.module !== opt.defaultModule;
  return html`<button type="button" role="option" aria-selected=${selected ? 'true' : 'false'} data-chess=${chess.chessId}
      class=${cx('lo-card', `lo-card--t${chess.tier}`, selected && 'is-sel', choice.changed && 'is-changed')} onClick=${() => onPick(chess.chessId)}
      title=${`${chess.name} · ${skillRec?.name || ''}`}>
    <span class="lo-card__art">
      <${Img} src=${chessAvatarUrl(m, chess)} fallback=${html`<span class="lo-card__glyph">${[...(chess.name || '?')][0]}</span>`} />
    </span>
    <${TierChip} tier=${chess.tier} size="sm" class="lo-card__tier" />
    ${choice.changed ? html`<span class="lo-card__flag" aria-label=${T('已调整')}></span>` : null}
    <span class="lo-card__name">${chess.name}</span>
    <span class="lo-card__kit">
      <span class=${cx('lo-card__sk', choice.skill !== opt.defaultSkill && 'is-alt')}>
        <${SkillIcon} m=${m} rec=${skillRec} index=${choice.skill} size="xs" />
        <b class="num">${skillLabel(choice.skill)}</b>
      </span>
      ${golden ? html`<span class=${cx('lo-card__mod', modChanged && 'is-alt')} title=${modRec ? `${modRec.typeName} ${modRec.name}` : T('不装备模组')}>
        ${choice.module === MODULE_NONE ? '—' : moduleBadge(modRec)}
      </span>` : null}
    </span>
  </button>`;
}

// ---- detail --------------------------------------------------------------------------------------------------------------

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
        <b class="lo-skill__name">${rec?.name || T('未知技能')}</b>
        ${opt.isDefault ? html`<span class="lo-badge lo-badge--def">${T('默认')}</span>` : null}
        ${on ? html`<span class="lo-badge lo-badge--on"><${Icon} name="check" />${T('已装备')}</span>` : null}
      </span>
      <span class="lo-skill__tags">
        <span class=${cx('lo-sp', `lo-sp--${tags.spKind}`)}>${tags.sp}</span>
        ${tags.init != null ? html`<span class="lo-tag">${T('初始')} <b class="num">${tags.init}</b></span>` : null}
        ${tags.cost != null ? html`<span class="lo-tag">${T('消耗')} <b class="num">${tags.cost}</b></span>` : null}
        ${tags.duration ? html`<span class="lo-tag">${T('持续')} <b class="num">${tags.duration}</b></span>` : null}
        ${tags.charges ? html`<span class="lo-tag">${T('充能')} <b class="num">${tags.charges}</b></span>` : null}
      </span>
      <${RichText} as="span" class="lo-skill__desc" text=${rec?.descRaw || rec?.desc || ''} />
    </span>
  </button>`;
}

function ModuleInfo({ m, golden, opt }) {
  if (!golden) return null;
  const rec = opt.id === MODULE_NONE ? null : opt.rec;
  if (!rec) {
    const traitBase = golden.traitBase || null;
    return html`<div class="lo-minfo lo-minfo--none">
      <p class="lo-minfo__lead">${T('不装备模组：精锐干员以基础属性、特性与天赋作战。')}</p>
      ${traitBase?.desc ? html`<div class="lo-minfo__row"><span class="lo-minfo__k">${T('特性')}</span><${RichText} class="lo-minfo__v" text=${traitBase.descRaw || traitBase.desc} /></div>` : null}
    </div>`;
  }
  const rows = attrRows(rec.attr);
  const trait = rec.traitOverride;
  const traitText = trait ? (trait.moduleDescRaw || trait.moduleDesc || trait.descRaw || trait.desc) : null;
  const talents = (Array.isArray(rec.talentChanges) ? rec.talentChanges : []).filter((t) => t && (t.name || t.desc) && !t.hidden);
  return html`<div class="lo-minfo">
    <div class="lo-minfo__title"><${Img} src=${moduleIconOf(m, rec)} class="lo-minfo__icon" /><span class="lo-minfo__type num">${rec.typeName || ''}</span><b>${rec.name || rec.uniEquipId}</b>
      ${opt.isDefault ? html`<span class="lo-badge lo-badge--def">${T('默认')}</span>` : null}</div>
    <div class="lo-minfo__row">
      <span class="lo-minfo__k">${T('属性')}</span>
      <span class="lo-minfo__v lo-attrs">${rows.length ? rows.map((r) => html`<span key=${r.key} class=${cx('lo-attr', r.positive ? 'is-up' : 'is-down')}>${r.label}<b class="num">${r.text}</b></span>`) : html`<span class="t-dim">${T('无属性加成')}</span>`}</span>
    </div>
    ${traitText ? html`<div class="lo-minfo__row"><span class="lo-minfo__k">${T('特性')}</span><${RichText} class="lo-minfo__v" text=${traitText} /></div>` : null}
    ${talents.map((t, i) => html`<div key=${i} class="lo-minfo__row"><span class="lo-minfo__k">${T('天赋')}</span>
      <span class="lo-minfo__v">${t.name ? html`<b class="lo-minfo__tname">${t.name}</b>` : null}<${RichText} text=${t.descRaw || t.desc || ''} /></span></div>`)}
  </div>`;
}

const getChessRec = (id) => data.lookup('chess', id);

/**
 * What 局内数值 shows (GitHub issue #64): the chess variant — the 精锐 record when asked for and the chess has one, else
 * the normal one — as the stored loadout makes it. chessLoadout (ui/gameLogic.js) resolves the skill and module the way
 * the in-match detail card and the sim do (shared/loadoutRecord.js): the elite's chosen module's stats / 特性 / talents
 * (不装备: the base ones), the chosen skill's passive range; a normal chess has no module, the skill does not change its
 * stats. Nothing is recomputed here.
 * @param {any} base normal chess record @param {any} golden its elite record or null
 * @param {Record<string, any>} entries the stored loadout @param {'normal'|'elite'} level
 * @param {(id: string) => any} getChess
 * @returns {{ elite: boolean, chess: any, lo: any, record: any, trait: string, talents: any[] } | null} null without a record
 */
export function statsPreview(base, golden, entries, level, getChess) {
  const elite = level === 'elite' && !!golden;
  const chess = elite ? golden : base;
  if (!chess) return null;
  const lo = chessLoadout(chess, entries, getChess);
  const record = lo?.record || chess;
  // (the card's own rule: the 特性 line exists when the chess has one; its text follows the chosen module)
  return { elite, chess, lo, record, trait: chess.trait?.desc ? traitText(chess, !!chess.isGolden, lo) || '' : '', talents: chessTalents(record) };
}

/**
 * 局内数值: the stats, 攻击范围, 特性 and 天赋 of the selected chess under its chosen skill and module — the detail
 * card's stats block (ui/detailPanel.js chessStatsBlock) without live numbers, so what a player reads here is what the
 * shop / board card shows before a battle (not the equipment, bond or skill-cast changes of a running match). The
 * toggle picks the 普通 or the 精锐 record; 精锐 is the default because the module only exists there.
 * @param {{ base: any, golden: any, entries: Record<string, any>, level: 'normal'|'elite', onLevel: (l: 'normal'|'elite') => void, getChess?: (id: string) => any }} props
 */
export function LoadoutStats({ base, golden, entries, level, onLevel, getChess = getChessRec }) {
  const pv = statsPreview(base, golden, entries, level, getChess);
  if (!pv) return null;
  return html`<section class="lo-sec lo-sec--stats" aria-label=${T('局内数值')} data-variant=${pv.elite ? 'elite' : 'normal'}>
    <header class="lo-sec__head">
      <h3>${T('局内数值')}<${MicroLabel}>STATS<//></h3>
      <div class="lo-seg" role="tablist" aria-label=${T('数值版本')}>
        <button type="button" role="tab" aria-selected=${pv.elite ? 'false' : 'true'} class=${cx(!pv.elite && 'is-on')} data-variant="normal" onClick=${() => onLevel('normal')}>${T('普通')}</button>
        <button type="button" role="tab" aria-selected=${pv.elite ? 'true' : 'false'} class=${cx(pv.elite && 'is-on')} data-variant="elite" disabled=${!golden} onClick=${() => onLevel('elite')}>${T('精锐')}</button>
      </div>
    </header>
    ${chessStatsBlock({ rec: pv.record, chess: pv.chess })}
    ${pv.trait || pv.talents.length ? html`<div class="lo-minfo lo-minfo--kit">
      ${pv.trait ? html`<div class="lo-minfo__row"><span class="lo-minfo__k">${T('特性')}</span><${RichText} class="lo-minfo__v" text=${pv.trait} /></div>` : null}
      ${pv.talents.map((t, i) => html`<div key=${i} class="lo-minfo__row"><span class="lo-minfo__k">${T('天赋')}</span>
        <span class="lo-minfo__v"><b class="lo-minfo__tname">${t.name}</b><${RichText} text=${t.descRaw || t.desc || ''} /></span></div>`)}
    </div>` : null}
    <p class="lo-stats__cap">${pv.elite ? T('数值含所选模组；') : golden ? T('普通干员没有模组，所选模组在「精锐」中生效；') : ''}${T('不含技能发动、装备、盟约等局内加成')}</p>
  </section>`;
}

function Detail({ m, chess, golden, entries, onChange, onReset, locked }) {
  const [level, setLevel] = useState('normal');
  const [statLevel, setStatLevel] = useState('elite'); // 局内数值: the 精锐 shows the chosen module's effect
  const bodyRef = useRef(null);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [chess?.chessId]);
  if (!chess) return html`<aside class="lo-detail lo-detail--empty"><p class="t-dim">${T('没有符合条件的干员')}</p></aside>`;
  const opt = chessOptions(chess, golden);
  const choice = effectiveChoice(entries, chess, golden);
  const modOpt = opt.moduleOptions.find((x) => x.id === choice.module) || null;
  const lv = (c) => c?.status?.skillLevel ?? '—';
  return html`<aside class="lo-detail" aria-label=${T('{0} 调配', chess.name)}>
    <div class="lo-dhead">
      <div class=${cx('lo-dhead__art', `lo-dhead__art--t${chess.tier}`)}>
        <${Img} src=${chessPortraitUrl(m, golden || chess)} fallback=${html`<${UnitThumb} kind="chess" id=${chess.chessId} size="lg" />`} />
      </div>
      <div class="lo-dhead__info">
        <div class="lo-dhead__chips"><${TierChip} tier=${chess.tier} size="md" />
          ${choice.changed ? html`<span class="lo-badge lo-badge--changed">${T('已调整')}</span>` : html`<span class="lo-badge lo-badge--plain">${T('默认配置')}</span>`}</div>
        <h2 class="lo-dhead__name">${chess.name}</h2>
        <span class="lo-dhead__en">${chess.appellation || ''}</span>
        <span class="lo-dhead__class">
          <${Img} src=${profGlyphUrl(m, chess.profession)} class="lo-dhead__prof lo-profglyph" />${PROF_NAME[chess.profession] || ''}
          <i class="lo-sep"></i><${Img} src=${subProfIconUrl(m, chess)} class="lo-dhead__prof" />${chess.subProfessionName || ''}
        </span>
        <span class="lo-dhead__bonds">${(chess.bonds || []).map((b) => html`<span key=${b} class="lo-bond">
          <${Img} src=${bondIconUrl(m, b)} class="lo-bond__icon" fallback=${html`<i class="lo-bond__dot"></i>`} />${data.lookup('bonds', b)?.name || b}</span>`)}</span>
      </div>
      <${Button} variant="ghost" size="sm" icon="refresh" class="lo-dhead__reset" disabled=${!choice.changed} onClick=${onReset}>${T('恢复默认')}<//>
    </div>
    <div class="lo-detail__body" ref=${bodyRef}>
      <section class="lo-sec">
        <header class="lo-sec__head">
          <h3>${T('技能')}<${MicroLabel}>SKILL<//></h3>
          <div class="lo-seg" role="tablist" aria-label=${T('技能等级')}>
            <button type="button" role="tab" aria-selected=${level === 'normal' ? 'true' : 'false'} class=${cx(level === 'normal' && 'is-on')} onClick=${() => setLevel('normal')}>${T('普通')} <span class="num">Lv.${lv(chess)}</span></button>
            <button type="button" role="tab" aria-selected=${level === 'elite' ? 'true' : 'false'} class=${cx(level === 'elite' && 'is-on')} disabled=${!golden} onClick=${() => setLevel('elite')}>${T('精锐')} <span class="num">Lv.${lv(golden)}</span></button>
          </div>
        </header>
        <div class="lo-skills" role="radiogroup" aria-label=${T('选择技能')}>
          ${opt.skillOptions.map((s) => html`<${SkillOption} key=${s.index} m=${m} opt=${s} level=${level} on=${s.index === choice.skill}
            onPick=${(i) => onChange({ skill: i })} />`)}
        </div>
      </section>
      <${LoadoutStats} base=${chess} golden=${golden} entries=${entries} level=${statLevel} onLevel=${setStatLevel} />
      ${golden ? html`<section class="lo-sec lo-sec--mod">
        <header class="lo-sec__head">
          <h3>${T('模组')}<${MicroLabel}>MODULE<//></h3>
          <span class="lo-sec__note">${T('仅精锐干员装备 · 模组等级')} <b class="num">${golden.status?.equipLevel ?? 1}</b></span>
        </header>
        <div class="lo-mods" role="radiogroup" aria-label=${T('选择模组')}>
          ${opt.moduleOptions.map((mo) => html`<button key=${mo.id} type="button" role="radio" aria-checked=${mo.id === choice.module ? 'true' : 'false'}
              data-module=${mo.id} class=${cx('lo-mod', mo.id === choice.module && 'is-on', mo.id === MODULE_NONE && 'lo-mod--none')}
              onClick=${() => onChange({ module: mo.id })}>
            <${ModuleGlyph} m=${m} rec=${mo.rec} id=${mo.id} />
            <span class="lo-mod__text">
              <span class="lo-mod__type num">${mo.id === MODULE_NONE ? 'NONE' : mo.rec?.typeName || ''}</span>
              <b class="lo-mod__name">${mo.id === MODULE_NONE ? T('不装备') : mo.rec?.name || mo.id}</b>
            </span>
            ${mo.isDefault ? html`<span class="lo-badge lo-badge--def lo-mod__def">${T('默认')}</span>` : null}
          </button>`)}
        </div>
        ${modOpt ? html`<${ModuleInfo} m=${m} golden=${golden} opt=${modOpt} />` : null}
      </section>` : null}
      ${locked ? html`<p class="lo-locknote"><${Icon} name="info" />${T('本局的调配已锁定，修改将在下一局生效')}</p>` : null}
    </div>
  </aside>`;
}

// ---- filters -------------------------------------------------------------------------------------------------------------

function Filters({ m, filters, onFilters, bonds }) {
  const set = (patch) => onFilters({ ...filters, ...patch });
  return html`<div class="lo-filters">
    <div class="lo-frow">
      <div class="lo-chips" role="group" aria-label=${T('阶级')}>
        <button type="button" class=${cx('lo-chip', !filters.tier && 'is-on')} onClick=${() => set({ tier: null })}>${T('全部')}</button>
        ${[1, 2, 3, 4, 5, 6].map((t) => html`<button key=${t} type="button" class=${cx('lo-chip', 'lo-chip--tier', `lo-chip--t${t}`, filters.tier === t && 'is-on')}
          aria-pressed=${filters.tier === t ? 'true' : 'false'} title=${T('{0}阶', t)} onClick=${() => set({ tier: filters.tier === t ? null : t })}><span class="num">${ROMAN[t]}</span></button>`)}
      </div>
      <${TextField} size="sm" icon="search" value=${filters.query} placeholder=${T('搜索干员 / 职业 / 盟约')} class="lo-search"
        onInput=${(v) => set({ query: String(v).slice(0, 24) })} />
    </div>
    <div class="lo-frow">
      <div class="lo-chips lo-chips--prof" role="group" aria-label=${T('职业')}>
        ${PROF_ORDER.map((p) => html`<button key=${p} type="button" class=${cx('lo-chip', 'lo-chip--prof', filters.prof === p && 'is-on')}
          aria-pressed=${filters.prof === p ? 'true' : 'false'} title=${PROF_NAME[p]} onClick=${() => set({ prof: filters.prof === p ? null : p })}>
          <${Img} src=${profGlyphUrl(m, p)} class="lo-chip__icon lo-profglyph" fallback=${html`<span>${PROF_NAME[p][0]}</span>`} /><span class="lo-chip__lbl">${PROF_NAME[p]}</span></button>`)}
      </div>
      <label class="lo-select">
        <span class="lo-select__k">${T('盟约')}</span>
        <select value=${filters.bond || ''} onChange=${(e) => set({ bond: e.currentTarget.value || null })} aria-label=${T('按盟约筛选')}>
          <option value="">${T('全部盟约')}</option>
          ${bonds.map((b) => html`<option key=${b.bondId} value=${b.bondId}>${b.name}</option>`)}
        </select>
      </label>
      <button type="button" class=${cx('lo-toggle', filters.changedOnly && 'is-on')} aria-pressed=${filters.changedOnly ? 'true' : 'false'}
        onClick=${() => set({ changedOnly: !filters.changedOnly })}><i class="lo-toggle__box"><${Icon} name="check" /></i>${T('仅看已调整')}</button>
    </div>
  </div>`;
}

// ---- screen -------------------------------------------------------------------------------------------------------------

const SYNC_TEXT = {
  idle: ['', ''], pending: [T('保存中…'), 'is-busy'], sending: [T('同步中…'), 'is-busy'], synced: [T('已同步'), 'is-ok'],
  locked: [T('本局已锁定 · 下一局生效'), 'is-warn'], error: [T('同步失败'), 'is-bad'],
};

/** The overlay screen. */
function LoadoutScreen({ st }) {
  const ready = useData('chess', 'bonds', 'assets', 'local');
  const phase = useStore((s) => s.match?.public?.phase || null);
  const inMatch = useStore((s) => !!s.room?.inMatch);
  // co-op briefing (INFO_CHECK, 25 s): the overlay covers the briefing's own countdown, so it shows the time left — the
  // match locks the loadout when it runs out (review fix: edits were silently only for the next match)
  const infoDeadline = useStore((s) => (s.match?.public?.phase === PHASE.INFO_CHECK ? s.match.public.deadline : 0));
  const m = data.get('assets');
  const getChess = (id) => data.lookup('chess', id);
  const getBond = (id) => data.lookup('bonds', id);
  const roster = useMemo(() => rosterOf(data.list('chess')), [ready]);
  const bonds = useMemo(() => {
    const used = new Set(roster.flatMap((c) => c.bonds || []));
    return (data.list('bonds') || []).filter((b) => b && used.has(b.bondId))
      .sort((a, b) => (b.isCore ? 1 : 0) - (a.isCore ? 1 : 0) || (a.bondOrder ?? 0) - (b.bondOrder ?? 0) || String(a.name).localeCompare(String(b.name), 'zh'));
  }, [ready, roster]);
  const list = filterRoster(roster, st.filters, st.entries, getChess, getBond);
  const selId = st.sel && roster.some((c) => c.chessId === st.sel) ? st.sel : list[0]?.chessId || roster[0]?.chessId || null;
  const { base, golden } = selId ? recordsOf(selId, getChess) : { base: null, golden: null };
  const nChanged = changedCount(st.entries, getChess);
  const locked = (inMatch && phase && phase !== PHASE.INFO_CHECK && phase !== PHASE.LOBBY) || st.sync === 'locked';
  const gridRef = useRef(null);
  const fileRef = useRef(null);                            // hidden <input type=file> of the 导入 dialog
  const [narrowDetail, setNarrowDetail] = useState(false); // phones: the detail slides over the roster
  const [io, setIo] = useState(null);                      // 导出 / 导入 dialog: { mode, text } | null

  const pick = (id) => { loadoutStore.set({ sel: id }); setNarrowDetail(true); };
  const change = (patch) => { if (base) setEntries(setChoice(loadoutStore.get().entries, base, golden, patch)); };
  const resetOne = () => { if (base) setEntries(resetChoice(loadoutStore.get().entries, base.chessId)); };
  const resetAll = async () => {
    if (!nChanged) return;
    const ok = await confirmDialog({ title: T('全部恢复默认'), text: T('将 {0} 名干员的技能与模组恢复为默认配置？', nChanged), okText: T('恢复默认'), danger: true });
    if (ok) setEntries({});
  };

  // 导出 / 导入 the loadout as the versioned payload (a downloaded file, the clipboard, or the textarea)
  const ioText = io?.text ?? '';
  const openExport = () => setIo({ mode: 'export', text: serializeExport(loadoutStore.get().entries) });
  const openImport = () => setIo({ mode: 'import', text: '' });
  const ioCopy = async () => {
    const ok = await copyText(ioText);
    toast(ok ? T('已复制到剪贴板') : T('复制失败，请在文本框中手动全选复制'), ok ? 'success' : 'warn');
  };
  const ioDownload = () => downloadText(exportFilename(), ioText);
  const ioPick = () => fileRef.current?.click();
  const ioFile = async (e) => {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = ''; // picking the same file twice must fire again
    if (!f) return;
    // refuse a huge pick before reading it into memory (a real payload is a few KB)
    if (f.size > LOADOUT_IMPORT_MAX_BYTES) { toast(T('文件过大，请选择「导出」下载的调配文件'), 'error'); return; }
    try { setIo({ mode: 'import', text: await readFileText(f) }); } catch { toast(T('读取文件失败'), 'error'); }
  };
  const ioApply = () => {
    // an import before chess.json is loaded would sanitise every entry away — refuse instead of wiping the loadout
    if (!ready) { toast(T('干员数据仍在载入，请稍候再导入'), 'warn'); return; }
    const res = parseImport(ioText);
    if (!res.ok) { toast(T('导入失败：{0}', res.error), 'error'); return; }
    const { applied, dropped } = applyLoadoutEntries(res.entries, getChess);
    // nothing survived sanitising (unknown chess, or every choice already the default): keep the current loadout
    if (!applied) { toast(T('导入失败：这份数据在当前版本没有可用的调配，未做任何改动'), 'error'); return; }
    setIo(null);
    toast(dropped
      ? T('已导入 {0} 名干员（另有 {1} 项未导入）', applied, dropped)
      : T('已导入 {0} 名干员的调配', applied), dropped ? 'warn' : 'success');
  };

  // Esc closes; ←/→ browse the filtered roster (not while typing in the search field)
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('.modal')) return; // a confirm dialog handles its own keys
      const typing = e.target && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); closeLoadout(); return; }
      if (typing) return;
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        const ids = filterRoster(rosterOf(data.list('chess')), loadoutStore.get().filters, loadoutStore.get().entries, getChess, getBond).map((c) => c.chessId);
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

  // keep the selected card in view
  useEffect(() => {
    const el = gridRef.current?.querySelector(`[data-chess="${selId}"]`);
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'nearest' });
  }, [selId]);

  const [syncText, syncCls] = SYNC_TEXT[st.sync] || SYNC_TEXT.idle;
  const fromText = st.from === 'briefing' ? T('确认本局信息阶段结束前可调整本局配置') : T('开始模拟前可调整干员携带的技能与模组，干员等级不可调整');

  return html`<${Fragment}>
  <div class="lo" role="dialog" aria-modal="true" aria-label=${T('干员调配')}>
    <div class="lo__bg" aria-hidden="true"></div>
    <header class="lo-top">
      <div class="lo-top__left">
        <${Button} variant="ghost" size="md" icon="chevronLeft" class="lo-back" onClick=${closeLoadout} aria-label=${T('返回')} title=${T('返回 (Esc)')}>${T('返回')}<//>
      </div>
      <div class="lo-top__center">
        <${MicroLabel} tone="mint">OPERATOR LOADOUT<//>
        <h1 class="lo-top__title"><${Img} src=${localAsset('ui/outer', 'operator_preset')} class="lo-top__icon" fallback=${html`<${Icon} name="edit" class="lo-top__icon" />`} />${T('干员调配')}</h1>
      </div>
      <div class="lo-top__right">
        ${inMatch && hasDeadline(infoDeadline) ? html`<${Countdown} deadline=${infoDeadline} size="sm" gauge=${false} label=${T('调配截止')} class="lo-deadline" />` : null}
        ${syncText ? html`<span class=${cx('lo-sync', syncCls)} role="status">${syncText}</span>` : null}
        <span class="lo-count">${T('已调整')} <b class="num">${nChanged}</b><span class="num t-dim">/${roster.length}</span></span>
        <${Button} variant="ghost" size="sm" data-testid="loadout-export" disabled=${!nChanged} onClick=${openExport} title=${T('导出当前调配（可复制或下载）')}>${T('导出')}<//>
        <${Button} variant="ghost" size="sm" data-testid="loadout-import" disabled=${!ready} onClick=${openImport} title=${T('导入调配（粘贴或选择文件）')}>${T('导入')}<//>
        <${Button} variant="secondary" size="sm" icon="refresh" disabled=${!nChanged} onClick=${resetAll}>${T('全部恢复默认')}<//>
      </div>
    </header>
    <p class=${cx('lo-note', locked && 'is-locked')}><${Icon} name="info" />${locked ? T('本局的调配已锁定（确认本局信息后无法修改），修改将在下一局生效') : fromText}</p>
    ${!ready ? html`<div class="lo-loading"><${Spinner} size="sm" />${T('正在载入干员数据（打开页面后仅载入一次）…')}</div>` : html`<main class=${cx('lo-body', narrowDetail && 'is-detail')}>
      <section class="lo-roster">
        <${Filters} m=${m} filters=${st.filters} bonds=${bonds} onFilters=${(filters) => loadoutStore.set({ filters })} />
        <div class="lo-grid" role="listbox" aria-label=${T('干员列表')} ref=${gridRef}>
          ${list.length ? list.map((c) => html`<${RosterCard} key=${c.chessId} m=${m} chess=${c} golden=${c.goldenId ? getChess(c.goldenId) : null}
            entries=${st.entries} selected=${c.chessId === selId} onPick=${pick} />`) : html`<p class="lo-empty t-dim">${T('没有符合条件的干员')}</p>`}
        </div>
      </section>
      <div class="lo-detail-wrap">
        <button type="button" class="lo-detail-back tapx" onClick=${() => setNarrowDetail(false)}><${Icon} name="chevronLeft" />${T('干员列表')}</button>
        <${Detail} m=${m} chess=${base} golden=${golden} entries=${st.entries} onChange=${change} onReset=${resetOne} locked=${locked} />
      </div>
    </main>`}
  </div>
  ${io ? html`<${Modal} open=${true} onClose=${() => setIo(null)}
      title=${io.mode === 'export' ? T('导出干员调配') : T('导入干员调配')} micro="OPERATOR LOADOUT"
      actions=${io.mode === 'export'
        ? html`<${Button} variant="ghost" onClick=${() => setIo(null)}>${T('关闭')}<//>
            <${Button} variant="secondary" icon="copy" data-testid="loadout-io-copy" onClick=${ioCopy}>${T('复制')}<//>
            <${Button} variant="primary" data-testid="loadout-io-download" onClick=${ioDownload}>${T('下载文件')}<//>`
        : html`<${Button} variant="ghost" onClick=${() => setIo(null)}>${T('取消')}<//>
            <${Button} variant="secondary" data-testid="loadout-io-pick" onClick=${ioPick}>${T('选择文件')}<//>
            <${Button} variant="primary" icon="check" data-testid="loadout-io-apply" disabled=${!ioText.trim() || !ready} onClick=${ioApply}>${T('导入')}<//>`}>
      <p class="lo-io__hint">${io.mode === 'export'
        ? TH('共 {0} 名干员已调整。复制或下载这份数据，即可在别的设备或浏览器上导入。', html`<b class="num">${nChanged}</b>`)
        : html`${T('把导出的内容粘贴到下方，或点「选择文件」。')}${nChanged ? TH('导入会{0}当前的 {1} 名干员调配。', html`<strong>${T('覆盖')}</strong>`, nChanged) : null}`}</p>
      <textarea class="lo-io__text" data-testid="loadout-io-text" spellcheck=${false} readOnly=${io.mode === 'export'} value=${ioText}
        placeholder=${io.mode === 'export' ? '' : T('在此粘贴导出的调配内容…')}
        onInput=${(e) => setIo({ mode: io.mode, text: e.currentTarget.value })}></textarea>
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
  if (!st.open) return null;
  return html`<${LoadoutScreen} st=${st} />`;
}

/**
 * The entry button's badge: the same number as the screen's 已调整 N (a stored entry of a chess the data no longer offers
 * never applies) once chess.json is loaded; before that the stored entries (the badge alone must not trigger the 1.6 MB
 * download). Review fix: it counted stale entries the screen does not.
 * @param {Record<string, any>} entries @param {((id: string) => any) | null} getChess null while chess.json is not loaded
 */
export function badgeCount(entries, getChess) {
  return getChess ? changedCount(entries, getChess) : Object.keys(entries || {}).length;
}

/**
 * Entry button (lobby / room / briefing).
 * @param {{ from: 'lobby'|'room'|'briefing', size?: string, variant?: string, class?: string, label?: string }} props
 */
export function LoadoutButton({ from, size = 'md', variant = 'secondary', class: cls, label = T('干员调配') }) {
  useData('local'); // the official preset icon (re-render once the local-art manifest arrives)
  const entries = useStore((s) => s.entries, Object.is, loadoutStore);
  const n = badgeCount(entries, data.status('chess') === 'ready' ? (id) => data.lookup('chess', id) : null);
  return html`<button type="button" class=${cx('btn', `btn--${variant}`, `btn--${size}`, 'lo-entry', cls)} data-testid="loadout-open"
      onClick=${() => openLoadout(from)} title=${T('调整干员携带的技能与模组')}>
    <${Img} src=${localAsset('ui/outer', 'operator_preset')} class="lo-entry__icon" fallback=${html`<${Icon} name="edit" class="btn__icon" />`} />
    <span class="btn__label">${label}</span>
    ${n ? html`<span class="lo-entry__n num" aria-label=${T('{0} 名干员已调整', n)}>${n}</span>` : null}
  </button>`;
}
