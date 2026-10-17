// The 干员调配 detail's building blocks (DESIGN §16), shared by two screens: the roster's detail (screens/loadout.js) and
// the 自选编队 picker (screens/diy.js). A 自选 pick is a normal chess record — shared/standIn.js composeUnitRecord composes
// the slot's identity with the operator's form, its statsBase / traitBase / modules[] / skills[] — so `chessOptions()`,
// `ModuleInfo` and these sections take it as they take a chess. They live here rather than in a screen because
// screens/loadout.js already imports screens/diy.js for its third tab: neither may import the other. Hook-free views (the
// tests draw them); the caller passes the current choice and its own onChange (the roster writes the stored loadout, the
// picker writes its draft). Both rows also share the click guard `rowControlHit`: a click on the row's own area picks its
// operator, a click inside one of its controls keeps that control's action.

import { html, Icon, MicroLabel } from '../ui/components.js';
import { Img, RichText } from '../ui/gameComponents.js';
import { moduleTypeIconUrl, profGlyphUrl } from '../ui/assetUrls.js';
import { data, localAsset } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { MODULE_NONE, PROF_ORDER, PROF_NAME, skillLabel, moduleBadge, attrRows, skillTags, traitLines, moduleRecord } from '../ui/loadoutModel.js';
import { atPotential } from '../../../shared/potential.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The controls a roster row holds: a 技能 / 模组 quick choice (a button) and a 潜能 / 练度 select (inside a `.lo-select`
 * wrapper). A click that lands inside one of them keeps that control's own action — the row's skill / module button
 * selects the row through its own handler and a phone stays on the list (PR #301), a select opens its own list
 * (`screens/loadout.js RosterRow` and `screens/diy.js DiyRow`, which share `rowControlHit`).
 */
export const ROW_CONTROL_SELECTOR = 'button, select, .lo-select, input, textarea, a';

/**
 * Whether a click on a row hit one of the row's own controls rather than the row itself. Anchored to the row: the match
 * must be inside the click's own `.lo-card`, so an ancestor that merely matches the selector (the list wrapped in a
 * button or a link) does not swallow the row's clicks. No usable target (a synthetic call) counts as a row click.
 * @param {any} e the click event
 * @returns {boolean}
 */
export function rowControlHit(e) {
  const target = e?.target;
  const hit = target?.closest?.(ROW_CONTROL_SELECTOR) ?? null;
  if (!hit) return false;
  const row = target.closest('.lo-card') ?? null;
  return !!row && row.contains(hit);
}

/**
 * The 职业 filter chips of the 干员调配 roster (screens/loadout.js `Filters`), drawn from here because the 自选编队 picker
 * filters its list by profession too: one markup, so the two rows cannot drift apart. Hook-free — the caller passes the
 * current profession and its setter. A chip toggles: the active one clears the filter.
 * @param {{ m: any, prof: string|null, onProf: (prof: string|null) => void }} props
 */
export function ProfFilter({ m, prof, onProf }) {
  return html`<div class="lo-chips lo-chips--prof" role="group" aria-label=${t('职业')}>
    ${PROF_ORDER.map((p) => html`<button key=${p} type="button" class=${cx('lo-chip', 'lo-chip--prof', prof === p && 'is-on')}
      aria-pressed=${prof === p ? 'true' : 'false'} title=${t(PROF_NAME[p])} onClick=${() => onProf(prof === p ? null : p)}>
      <${Img} src=${profGlyphUrl(m, p)} class="lo-chip__icon lo-profglyph" fallback=${html`<span>${t(PROF_NAME[p])[0]}</span>`} /><span class="lo-chip__lbl">${t(PROF_NAME[p])}</span></button>`)}
  </div>`;
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

/** Skill icon with the official selection outline; falls back to a lettered tile. */
export function SkillIcon({ m, rec, index, on = false, size = 'md' }) {
  const src = skillIconOf(m, rec);
  return html`<span class=${cx('lo-sicon', `lo-sicon--${size}`, on && 'is-on')}>
    <${Img} src=${src} fallback=${html`<span class="lo-sicon__glyph num">${skillLabel(index)}</span>`} />
    ${on && size !== 'xs' ? html`<${Img} src=${localAsset('ui/outer', 'image_skill_select_outline')} class="lo-sicon__outline" fallback=${html`<i class="lo-sicon__ring"></i>`} />` : null}
  </span>`;
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

/** One skill of the 技能 section: icon, slot, name, the 默认 / 已装备 badges, the SP tags and the description. */
export function SkillOption({ m, opt, on, level, onPick, locked = false }) {
  const rec = level === 'elite' ? opt.elite || opt.normal : opt.normal || opt.elite;
  const tags = skillTags(rec);
  return html`<button type="button" role="radio" aria-checked=${on ? 'true' : 'false'} class=${cx('lo-skill', on && 'is-on')}
      data-skill=${opt.index} disabled=${locked} onClick=${() => onPick(opt.index)}>
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

/**
 * 技能 section: the 普通 / 精锐 preview toggle (the elite's records at Lv.7) and one `SkillOption` card per selectable
 * slot. `onLevel` switches the preview, `onPick(index)` the choice. `locked` (a 自选 prototype's fixed skill) draws the
 * cards read-only — the toggle stays live, it only changes the preview.
 * @param {{ m: any, chess: any, golden: any, skillOptions: any[], skill: number|null, level: 'normal'|'elite',
 *   onLevel: (level: 'normal'|'elite') => void, onPick: (index: number) => void, locked?: boolean }} props
 */
export function SkillSection({ m, chess, golden, skillOptions, skill, level, onLevel, onPick, locked = false }) {
  const lv = (c) => c?.status?.skillLevel ?? '—';
  return html`<section class="lo-sec">
    <header class="lo-sec__head">
      <h3>${t('技能')}<${MicroLabel}>SKILL<//></h3>
      <div class="lo-seg" role="tablist" aria-label=${t('技能等级')}>
        <button type="button" role="tab" aria-selected=${level === 'normal' ? 'true' : 'false'} class=${cx(level === 'normal' && 'is-on')} onClick=${() => onLevel('normal')}>${t('普通')} <span class="num">Lv.${lv(chess)}</span></button>
        <button type="button" role="tab" aria-selected=${level === 'elite' ? 'true' : 'false'} class=${cx(level === 'elite' && 'is-on')} disabled=${!golden} onClick=${() => onLevel('elite')}>${t('精锐')} <span class="num">Lv.${lv(golden)}</span></button>
      </div>
    </header>
    <div class="lo-skills" role="radiogroup" aria-label=${t('选择技能')}>
      ${skillOptions.map((s) => html`<${SkillOption} key=${s.index} m=${m} opt=${s} level=${level} on=${s.index === skill} onPick=${onPick} locked=${locked} />`)}
    </div>
  </section>`;
}

/**
 * 模组 section: the module cards the caller offers (the roster: 不装备 + every module of the elite; the picker: its own
 * filtered list, 不装备 first) and the chosen one's `ModuleInfo`. Null without an elite form. `locked` (a 自选 prototype's
 * fixed module) draws the cards read-only.
 * @param {{ m: any, golden: any, moduleOptions: Array<{ id: string, rec: any, isDefault?: boolean }>,
 *   module: string|null, onPick: (id: string) => void, potential?: number|null, locked?: boolean }} props
 */
export function ModuleSection({ m, golden, moduleOptions, module, onPick, potential = null, locked = false }) {
  if (!golden) return null;
  const modOpt = moduleOptions.find((x) => x.id === module) || null;
  return html`<section class="lo-sec lo-sec--mod">
    <header class="lo-sec__head">
      <h3>${t('模组')}<${MicroLabel}>MODULE<//></h3>
      <span class="lo-sec__note">${t('仅精锐干员装备 · 模组等级')} <b class="num">${golden.status?.equipLevel ?? 1}</b></span>
    </header>
    <div class="lo-mods" role="radiogroup" aria-label=${t('选择模组')}>
      ${moduleOptions.map((mo) => html`<button key=${mo.id} type="button" role="radio" aria-checked=${mo.id === module ? 'true' : 'false'}
          data-module=${mo.id} disabled=${locked} class=${cx('lo-mod', mo.id === module && 'is-on', mo.id === MODULE_NONE && 'lo-mod--none')}
          onClick=${() => onPick(mo.id)}>
        <${ModuleGlyph} m=${m} rec=${mo.rec} id=${mo.id} />
        <span class="lo-mod__text">
          <span class="lo-mod__type num">${mo.id === MODULE_NONE ? 'NONE' : mo.rec?.typeName || ''}</span>
          <b class="lo-mod__name">${mo.id === MODULE_NONE ? t('不装备') : mo.rec?.name || mo.id}</b>
        </span>
        ${mo.isDefault ? html`<span class="lo-badge lo-badge--def lo-mod__def">${t('默认')}</span>` : null}
      </button>`)}
    </div>
    ${modOpt ? html`<${ModuleInfo} m=${m} golden=${golden} opt=${modOpt} potential=${potential} />` : null}
  </section>`;
}
