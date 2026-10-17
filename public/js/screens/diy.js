// 自选编队 (0.2.0 DIY; research 0.2.0 §2, the owner's decisions of 2026-10-05): the third tab of the 干员调配 overlay
// (screens/loadout.js). Four slots — 5阶 ×2, 6阶 ×2 — each filled with an operator: a 6★ the player owns outside the
// chess pool (any of its three skills, any module of its elite form but a 集成战略 one) or a prototype (原型干员, its skill
// and module locked as when it stands in). Only operators with a kit are listed (the server's welcome.diyKitted). The
// slot picker lists the legal picks of the slot's tier — avatar, name, class, the bonds derived from its factions, a
// 原型 / 已持有 tag —, an operator held by another slot greyed out with where it is. In the match the operator is sold
// only in this player's shop, from 调度中心 level 5 (tier 5) / 6 (tier 6), and fights with the pick (server/match/player
// /diy.js). Out of match: the next match takes the picks. The picks live in ui/loadoutSync.js (localStorage + room.diy);
// the model is ui/diyModel.js. Styles: css/screens/loadout.css (diy-*). An owned pick's card carries its operator's 潜能 /
// 练度 selects (0.2.2, screens/cultivation.js — the same per-operator settings as 干员调配, `ops`); a prototype has neither.
//
// Since 0.2.2 the picker is the roster's own screen (screens/loadoutSections.js holds the detail sections both draw): its
// one semantic difference is the DRAFT — a row's quick choice writes it (确认 saves it, 取消 / Esc drop it) while a 潜能 /
// 练度 write stays immediate like the roster's; a taken option disables its row, a prototype's locked cells are static.

import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, TierChip, TextField } from '../ui/components.js';
import { Img, BondGlyph } from '../ui/gameComponents.js';
import { chessAvatarUrl, chessPortraitUrl, profIconUrl, subProfIconUrl, bondIconUrl, skillRecordIconUrl, moduleTypeIconUrl } from '../ui/assetUrls.js';
import { data } from '../data.js';
import { MODULE_NONE, PROF_NAME, skillLabel, moduleBadge, quickSkillTags, opsOf, chessOptions } from '../ui/loadoutModel.js';
import { diySlotList, pickChoices, pickOptions, slotRecord, defaultPick } from '../ui/diyModel.js';
import { OperatorVoice } from '../ui/operatorVoice.js';
import { LoadoutStats } from '../ui/loadoutStats.js';
import { CultivationSelects, CultivationSection } from './cultivation.js';
import { SkillIcon, ModuleGlyph, SkillSection, ModuleSection, ProfFilter, rowControlHit } from './loadoutSections.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/** The data the 自选 rules read (shared/diy.js): chess.json + backups.json (localized copies). */
export const diyData = () => ({ chess: data.get('chess'), backups: data.get('backups') });

/** A unit summary's avatar / portrait URL (a backups.json unit or a composed record). */
const avatarOf = (m, unit, elite = false) => chessAvatarUrl(m, unit && { charId: unit.charId, assets: { avatar: elite ? unit.assets?.avatarGolden : unit.assets?.avatar } });
const classLine = (u) => `${t(PROF_NAME[u?.profession] || '') || ''}${u?.subProfessionName ? ` · ${u.subProfessionName}` : ''}`;
const bondName = (id) => data.lookup('bonds', id)?.name || id;

/** Square profession glyph (manifest prof.large: black glyph on white, drawn as a white glyph by loadout.css). The roster
 *  keeps the same helper private (screens/loadout.js), which imports this screen — so it is repeated here. */
function profGlyphUrl(m, prof) {
  const k = String(prof || '').toLowerCase();
  const v = m && m.prof && m.prof.large ? m.prof.large[k] : null;
  return typeof v === 'string' ? v : null;
}

/** The 原型 / 已持有 tag of a pick. */
function KindTag({ proto }) {
  return html`<span class=${cx('diy-tag', proto ? 'diy-tag--proto' : 'diy-tag--own')}>${proto ? t('原型') : t('已持有')}</span>`;
}

/** Bond chips (the bonds derived from the operator's factions; 协防 when none matches). */
function Bonds({ bonds }) {
  return html`<span class="diy-bonds">${(bonds || []).map((b) => html`<span key=${b} class="diy-bond"><${BondGlyph} bondId=${b} /><span>${bondName(b)}</span></span>`)}</span>`;
}

/** One slot: the pick (operator, class, bonds, skill, module, an owned pick's 潜能 / 练度) or an empty slot to fill. */
function SlotCard({ m, slot, pick, illegal, onOpen, onClear, ops = {}, onOps = null }) {
  const D = diyData();
  const rec = pick ? slotRecord(slot.slotId, pick, D) : null;
  const elite = pick ? slotRecord(slot.slotId, pick, D, { elite: true }) : null;
  const label = t('{tier}阶 自选', { tier: slot.tier });
  if (!rec) {
    return html`<div class=${cx('diy-slot', `diy-slot--t${slot.tier}`, 'is-empty', pick && 'is-bad')} data-slot=${slot.slotId}>
      <button type="button" class="diy-slot__fill" onClick=${() => onOpen(slot.slotId)} aria-label=${t('{slot}：选择干员', { slot: label })}>
        <${TierChip} tier=${slot.tier} size="sm" />
        <span class="diy-slot__plus"><${Icon} name="plus" /></span>
        <b>${t('选择干员')}</b>
        <small>${t('调度中心等级 {level} 起出现在商店', { level: slot.shopLevel })}</small>
      </button>
      ${pick ? html`<p class="diy-slot__bad"><${Icon} name="warn" />${t('这项自选在当前版本不可用，开局时会被移除')}</p>` : null}
    </div>`;
  }
  const proto = !!pick && D.backups?.diy?.prototypes?.[slot.tier]?.includes(pick.charId);
  const sk = rec.skill;
  const mod = elite?.module?.active ? elite.module : null;
  return html`<div class=${cx('diy-slot', `diy-slot--t${slot.tier}`, illegal && 'is-bad')} data-slot=${slot.slotId} data-char=${rec.charId}>
    <div class="diy-slot__art"><${Img} src=${chessPortraitUrl(m, elite || rec)} fallback=${html`<b>${[...(rec.name || '?')][0]}</b>`} /></div>
    <div class="diy-slot__body">
      <div class="diy-slot__head"><${TierChip} tier=${slot.tier} size="sm" /><span class="diy-slot__label">${label}</span><${KindTag} proto=${proto} /></div>
      <b class="diy-slot__name">${rec.name}</b>
      <small class="diy-slot__class">${classLine(rec)}</small>
      <${Bonds} bonds=${rec.bonds} />
      <span class="diy-slot__kit" data-skill=${sk?.index ?? ''}>
        <${Img} src=${skillRecordIconUrl(m, sk, { empty: false })} class="diy-slot__sicon" fallback=${html`<b class="num">${skillLabel(sk?.index)}</b>`} />
        <span><b class="num">${skillLabel(sk?.index)}</b> ${sk?.name || ''}${proto ? html` <small class="t-dim">${t('（锁定）')}</small>` : null}</span>
      </span>
      <span class="diy-slot__kit" data-module=${mod ? mod.id : 'none'}>
        ${mod ? html`<${Img} src=${moduleTypeIconUrl(data.get('local'), mod.type)} class="diy-slot__micon" fallback=${html`<b class="num">${moduleBadge({ typeName: mod.type })}</b>`} />` : html`<span class="diy-slot__micon diy-slot__micon--none">—</span>`}
        <span>${mod ? html`<b class="num">${mod.type || ''}</b> ${mod.name || ''}` : t('不装备模组')} <small class="t-dim">${t('（精锐时生效）')}</small></span>
      </span>
      ${proto ? html`<small class="diy-slot__cult t-dim">${t('原型干员没有潜能与练度')}</small>`
        : onOps ? html`<span class="diy-slot__cult"><${CultivationSelects} charId=${rec.charId} ops=${ops} onSet=${onOps} /></span>` : null}
      <${OperatorVoice} charId=${rec.charId} />
      ${illegal ? html`<p class="diy-slot__bad"><${Icon} name="warn" />${t('这项自选在当前版本不可用，开局时会被移除')}</p>` : null}
    </div>
    <div class="diy-slot__acts">
      <${Button} variant="secondary" size="sm" icon="refresh" data-testid="diy-change" onClick=${() => onOpen(slot.slotId)}>${t('更换')}<//>
      <${Button} variant="ghost" size="sm" icon="close" data-testid="diy-clear" onClick=${() => onClear(slot.slotId)}>${t('清空')}<//>
    </div>
  </div>`;
}

// ---- the picker's list (the roster's rows) ----------------------------------------------------------------------------

/**
 * The choices of one picker row (ui/diyModel.js pickChoices) behind a memo: the tier-6 list holds ~81 operators and every
 * row draws its skills and modules, so a search keystroke must not recompose all of them. The memo belongs to the loaded
 * backups.json — a language switch or a data reload replaces that object and drops the memo with it; nothing is cached
 * while the data is absent.
 */
let choicesOf = null;
const choicesMemo = new Map();
function rowChoices(charId, slotId, D) {
  const backups = D?.backups ?? null;
  if (!backups) return pickChoices(charId, slotId, D);
  if (choicesOf !== backups) { choicesOf = backups; choicesMemo.clear(); }
  const key = `${slotId}|${charId}`;
  if (!choicesMemo.has(key)) choicesMemo.set(key, pickChoices(charId, slotId, D));
  return choicesMemo.get(key);
}

/** One skill to tap: the roster's quick choice (screens/loadout.js QuickSkill) — it writes the draft. */
function QuickSkill({ m, opt, on, elite, onPick, disabled = false }) {
  const rec = elite ? opt.elite || opt.normal : opt.normal || opt.elite;
  const tags = quickSkillTags(rec);
  const label = `${skillLabel(opt.index)} · ${rec?.name || t('未知技能')} · ${tags.sp} · ${t('初始')} ${tags.init ?? '—'} / ${t('消耗')} ${tags.cost ?? '—'} · ${t('持续')} ${tags.duration}`;
  return html`<button type="button" class=${cx('lo-q', 'lo-q--skill', on && 'is-on')} data-skill=${opt.index} aria-pressed=${on ? 'true' : 'false'}
      aria-label=${label} title=${label} disabled=${disabled} onClick=${() => onPick(opt.index)}>
    <${SkillIcon} m=${m} rec=${rec} index=${opt.index} on=${on} size="q" />
  </button>`;
}

/** One module to tap (不装备 first): the roster's quick choice (screens/loadout.js QuickModule). */
function QuickModule({ m, opt, on, onPick, disabled = false }) {
  const label = opt.id === MODULE_NONE ? t('不装备模组') : `${opt.rec?.typeName || ''} · ${opt.rec?.name || opt.id}`;
  return html`<button type="button" class=${cx('lo-q', 'lo-q--mod', on && 'is-on')} data-module=${opt.id} aria-pressed=${on ? 'true' : 'false'}
      aria-label=${label} title=${label} disabled=${disabled} onClick=${() => onPick(opt.id)}>
    <${ModuleGlyph} m=${m} rec=${opt.rec} id=${opt.id} size="q" />
    ${opt.id !== MODULE_NONE ? html`<b class="lo-q__type num" aria-hidden="true">${moduleBadge(opt.rec, opt.id)}</b>` : null}
  </button>`;
}

/** A prototype's locked skill: the quick choice's cell with no handler — there is nothing to choose (shared/diy.js). */
function LockedSkill({ m, s, level }) {
  const rec = level === 'elite' ? s.elite || s.normal : s.normal || s.elite;
  const label = `${skillLabel(s.index)} · ${rec?.name || ''} · ${t('锁定')}`;
  return html`<span class="lo-q lo-q--skill is-on" title=${label} aria-label=${label}>
    <${SkillIcon} m=${m} rec=${rec} index=${s.index} on=${true} size="q" />
  </span>`;
}

/** A prototype's locked module (「不装备」 when its 补位 row carries none). */
function LockedModule({ m, id, rec }) {
  const label = id === MODULE_NONE ? t('不装备模组') : `${rec?.typeName || ''} · ${rec?.name || id}`;
  return html`<span class="lo-q lo-q--mod is-on" title=${label} aria-label=${label}>
    <${ModuleGlyph} m=${m} rec=${rec} id=${id} size="q" />
    ${id !== MODULE_NONE ? html`<b class="lo-q__type num" aria-hidden="true">${moduleBadge(rec, id)}</b>` : null}
  </span>`;
}

/** The list's column heads — the roster's own (screens/loadout.js RosterHead), whose grid the picker's rows share. */
function DiyHead() {
  return html`<div class="lo-list__head" aria-hidden="true">
    <span class="lo-list__h lo-list__h--op">${t('干员')}</span>
    <span class="lo-list__h lo-list__h--skills">${t('技能')}</span>
    <span class="lo-list__h lo-list__h--mods" title=${t('模组仅在精锐形态生效')}>${t('模组')}<small>${t('精锐')}</small></span>
    <span class="lo-list__h lo-list__h--cult">${t('潜能')} · ${t('练度')}</span>
  </div>`;
}

/** The 不装备 option and a module record as a quick choice's option (loadout.js chessOptions' shape). */
const noneOpt = { id: MODULE_NONE, rec: null };
const moduleOpt = (x) => ({ id: x.uniEquipId, rec: x.rec });

/**
 * One operator of the picker's list: the roster's row (RosterRow) whose quick choices write the draft through `onQuick`
 * instead of the stored loadout; `level` 'elite' shows the quick skills' Lv.7 tags. A taken option disables every control
 * and a prototype's locked cells are static.
 */
function DiyRow({ m, slot, opt, ch, takenTier, draft, selected, ops, onOps, onSel, onQuick, level }) {
  const u = opt.unit;
  const name = u?.name || opt.charId;
  const taken = takenTier != null;
  const note = taken ? t('已在{tier}阶自选中', { tier: takenTier }) : null;
  // what the row shows as chosen: a prototype's locked selection, the draft's choice for the drafted operator, else the
  // operator's own default pick (what a fresh selection would start with — ui/diyModel.js defaultPick)
  const def = ch ? { skill: ch.skills.length ? ch.skills[ch.skills.length - 1].index : null, module: ch.modules[0]?.uniEquipId ?? null } : null;
  const cur = (ch?.proto ? { skill: ch.locked?.skillIndex ?? null, module: ch.locked?.uniEquipId ?? null } : null)
    || (draft && draft.charId === opt.charId
      ? { skill: draft.skillIndex ?? def?.skill ?? null, module: draft.uniEquipId === undefined ? def?.module ?? null : draft.uniEquipId }
      : def) || { skill: null, module: null };
  const curMod = cur.module ?? MODULE_NONE;
  const slots = [0, 1, 2].map((i) => (ch && ch.skills[i]) || null);
  const pick = (patch) => onQuick(opt.charId, patch);
  // the row itself picks the operator too (RosterRow's onRowClick and the shared, row-anchored guard in
  // screens/loadoutSections.js); a taken option does nothing
  const onRowClick = (e) => { if (!taken && !rowControlHit(e)) onSel(opt.charId); };
  return html`<div role="listitem" data-char=${opt.charId}
      class=${cx('diy-opt', 'lo-card', `lo-card--t${slot.tier}`, selected && 'is-sel', taken && 'is-taken')} onClick=${onRowClick}>
    <button type="button" class="diy-opt__pick lo-card__pick" aria-pressed=${selected ? 'true' : 'false'} disabled=${taken}
        title=${note || name} onClick=${() => onSel(opt.charId)}>
      <span class="lo-card__art"><${Img} src=${avatarOf(m, u)} fallback=${html`<span class="lo-card__glyph">${[...name][0]}</span>`} /></span>
      <span class="lo-card__id">
        <span class="lo-card__name">${name}</span>
        <span class="lo-card__bonds">${(opt.bonds || []).map((b) => html`<${Img} key=${b} src=${bondIconUrl(m, b)} class="lo-card__bond" alt=${bondName(b)}
          fallback=${html`<i class="lo-bond__dot" title=${bondName(b)}></i>`} />`)}</span>
        <span class="diy-opt__sub"><${KindTag} proto=${opt.proto} /><span class="diy-opt__class"><${Img} src=${profIconUrl(m, u?.profession)} class="diy-opt__prof" />${classLine(u)}</span>
          ${note ? html`<span class="diy-opt__taken">${note}</span>` : null}</span>
      </span>
    </button>
    <div class="lo-card__skills lo-quick" role="group" aria-label=${t('选择技能')}>
      ${ch && ch.proto
        ? slots.map((s, i) => (s && s.index === cur.skill
          ? html`<${LockedSkill} key=${s.index} m=${m} s=${s} level=${level} />`
          : html`<span key=${`e${i}`} class="lo-q lo-q--empty" aria-hidden="true"></span>`))
        : slots.map((s, i) => (s
          ? html`<${QuickSkill} key=${s.index} m=${m} opt=${s} elite=${level === 'elite'} on=${s.index === cur.skill} disabled=${taken}
              onPick=${(index) => pick({ skillIndex: index })} />`
          : html`<span key=${`e${i}`} class="lo-q lo-q--empty" aria-hidden="true"></span>`))}
    </div>
    <div class="lo-card__mods lo-quick" role="group" aria-label=${t('选择模组')} title=${t('模组仅在精锐形态生效')}>
      ${ch && ch.proto
        ? [html`<${LockedModule} key="locked" m=${m} id=${curMod} rec=${ch.modules.find((x) => x.uniEquipId === cur.module)?.rec || null} />`]
        : [html`<${QuickModule} key="none" m=${m} opt=${noneOpt} on=${curMod === MODULE_NONE} disabled=${taken}
              onPick=${(id) => pick({ uniEquipId: id === MODULE_NONE ? null : id })} />`,
          ...(ch?.modules || []).map((x) => html`<${QuickModule} key=${x.uniEquipId} m=${m} opt=${moduleOpt(x)} on=${curMod === x.uniEquipId} disabled=${taken}
              onPick=${(id) => pick({ uniEquipId: id === MODULE_NONE ? null : id })} />`)]}
    </div>
    ${opt.proto || !onOps
      ? html`<span class="lo-cult diy-opt__nocult t-dim" title=${opt.proto ? t('原型干员没有潜能与练度') : undefined}>—</span>`
      : html`<${CultivationSelects} charId=${opt.charId} ops=${ops} onSet=${onOps} note=${note} disabled=${taken} />`}
  </div>`;
}

/**
 * The slot picker: the legal operators of the slot's tier (prototypes first, then the owned 6★; a 原型 / 已持有 filter, the
 * roster's 职业 chips and a search), the chosen one's skill / module (an owned pick) or its locked selection (a prototype),
 * 确认 / 取消. The state (filter, profession, search, the draft pick, the narrow-screen detail) lives here; DiyPickerView
 * draws it.
 * @param {{ m: any, slot: any, picks: Record<string, any>, kitted: string[]|null, onDone: (pick: any) => void, onClose: () => void,
 *   ops?: Record<string, any>, onOps?: Function|null }} props
 */
export function DiyPicker(props) {
  const [previewLevel, setPreviewLevel] = useState('elite');
  const [narrowDetail, setNarrowDetail] = useState(false); // phones: the detail slides over the list
  const cur = props.picks[props.slot.slotId] || null;
  const [filter, setFilter] = useState('all');
  const [prof, setProf] = useState(null);
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState(cur ? { ...cur } : null);
  // Esc cancels only the picker, like its 取消 (GitHub #284, idea from PR #286); the 干员调配 overlay's own Esc skips
  // while a picker is open, and a dialog over the picker (导入) still takes Esc first. A layout effect: the listener is
  // attached in the same commit as the picker (a plain effect waits for the next frame, and an Esc pressed in between
  // was swallowed — the overlay skipped it, the picker did not hear it yet; the 0.2.2 full browser pass)
  useLayoutEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal')) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      props.onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [props.onClose]);
  return DiyPickerView({ ...props, previewLevel, onPreviewLevel: setPreviewLevel, narrowDetail, onNarrowDetail: setNarrowDetail,
    filter, prof, query, draft, onFilter: setFilter, onProf: setProf, onQuery: setQuery, onDraft: setDraft });
}

/**
 * The picker's view (no hooks: the tests draw it): `filter` 'all' | 'proto' | 'owned', `prof` the profession the roster's
 * chips select (null = every one), `query`, `draft` the pick being made (null = none chosen yet) and their setters,
 * `narrowDetail` the phone layout (the detail over the list).
 */
export function DiyPickerView({ m, slot, picks, kitted, onDone, onClose, filter, prof = null, query, draft, onFilter: setFilter,
  onProf = () => {}, onQuery: setQuery, onDraft: setDraft,
  ops = {}, onOps = null, previewLevel = 'elite', onPreviewLevel = () => {}, narrowDetail = false, onNarrowDetail = () => {} }) {
  const D = diyData();
  const cur = picks[slot.slotId] || null;
  const options = pickOptions(slot.slotId, picks, D, kitted);
  const tiers = new Map(diySlotList(D).map((s) => [s.slotId, s.tier]));
  const q = query.trim().toLowerCase();
  const list = options.filter((o) => (filter === 'all' || (filter === 'proto') === o.proto)
    && (!prof || o.unit?.profession === prof)
    && (!q || [o.unit?.name, o.unit?.appellation, o.unit?.subProfessionName, t(PROF_NAME[o.unit?.profession] || ''), ...o.bonds.map(bondName)].some((x) => typeof x === 'string' && x.toLowerCase().includes(q))));
  const ch = draft ? rowChoices(draft.charId, slot.slotId, D) : null;
  // Selecting a row keeps the draft's edits when it is already the chosen operator (the picker's own rule, 0.2.0). On a
  // phone the first tap only selects: the detail slides over on the next tap of the row that is already selected, so a
  // tap that means "pick this operator" never replaces the list with a pane the player did not ask for.
  const sel = (charId) => {
    if (draft?.charId !== charId) {
      setDraft(cur && cur.charId === charId ? { ...cur } : defaultPick(charId, slot.slotId, D));
      return;
    }
    onNarrowDetail(true);
  };
  // a row's quick choice: it writes the DRAFT (确认 saves it, 取消 drops it) — starting from the saved pick when the
  // operator is the slot's own, else from what selecting it would give it (ui/diyModel.js defaultPick)
  const quick = (charId, patch) => {
    const from = draft && draft.charId === charId ? draft
      : cur && cur.charId === charId ? { ...cur } : defaultPick(charId, slot.slotId, D);
    setDraft({ ...from, ...patch });
  };
  const lk = ch?.locked || null;
  const def = ch ? { skill: ch.skills.length ? ch.skills[ch.skills.length - 1].index : null, module: ch.modules[0]?.uniEquipId ?? null } : null;
  const skillOn = !ch ? null : ch.proto ? lk?.skillIndex ?? null : draft.skillIndex ?? def?.skill ?? null;
  const modOn = !ch ? null : ch.proto ? lk?.uniEquipId ?? null : draft.uniEquipId === undefined ? def?.module ?? null : draft.uniEquipId;
  const unit = draft ? D.backups?.units?.[draft.charId] : null;
  const potential = draft ? opsOf(ops, draft.charId).potential : null;
  const label = t('{tier}阶 自选', { tier: slot.tier });
  // the tier's own hint: it rides the picker's filter row on every width (a row of its own in the header cost the list a
  // whole row on a phone and left the search box on a line of its own on the desktop)
  const note = slot.tier === 5 ? t('6★ 原型干员与持有的 6★ 干员，另有 4★ 原型干员（先锋、特种除外）') : t('6★ 原型干员与持有的 6★ 干员');
  const base = draft ? slotRecord(slot.slotId, draft, D, { potential }) : null;
  const golden = draft ? slotRecord(slot.slotId, draft, D, { elite: true, potential }) : null;
  const previewEntries = base ? { [base.baseId || base.chessId]: { skill: skillOn, module: modOn || 'none' } } : {};
  const previewChess = (id) => id === golden?.chessId ? golden : base;
  // the 默认 badge is suppressed: on a slot record `isDefault` marks the CURRENT pick (shared/standIn.js composeUnitRecord),
  // not the operator's official default; the module list itself is the DIY one (ui/diyModel.js), 不装备 first
  const skillOptions = !ch ? []
    : (ch.proto ? ch.skills.filter((s) => s.index === skillOn) : base ? chessOptions(base, golden).skillOptions : []).map((s) => ({ ...s, isDefault: false }));
  const moduleOptions = !ch ? []
    : ch.proto ? [{ id: lk?.uniEquipId ?? MODULE_NONE, rec: ch.modules.find((x) => x.uniEquipId === lk?.uniEquipId)?.rec ?? null }]
      : [noneOpt, ...ch.modules.map(moduleOpt)];
  // a prototype's skill and module are its locked selection: the shared cards are drawn disabled (loadoutSections.js
  // `locked`) and the handlers refuse a draft edit as well, so neither a tap nor a stray call can change them
  const pickSkill = (i) => { if (!ch?.proto) setDraft({ ...draft, skillIndex: i }); };
  const pickModule = (id) => { if (!ch?.proto) setDraft({ ...draft, uniEquipId: id === MODULE_NONE ? null : id }); };
  return html`<section class=${cx('diy-pick', narrowDetail && 'is-detail')} role="dialog" aria-label=${t('{slot}：选择干员', { slot: label })} data-testid="diy-picker" data-slot=${slot.slotId}>
    <div class=${cx('diy-pick__main', narrowDetail && 'is-detail')}>
      <section class="diy-pick__col">
        <header class="lo-filters diy-pick__head">
          <div class="lo-frow">
            <div class="lo-chips diy-pick__filters" role="group" aria-label=${t('筛选')}>
              ${[['all', t('全部')], ['proto', t('原型')], ['owned', t('已持有')]].map(([k, text]) => html`<button key=${k} type="button" class=${cx('lo-chip', filter === k && 'is-on')}
                aria-pressed=${filter === k ? 'true' : 'false'} data-filter=${k} onClick=${() => setFilter(k)}>${text}</button>`)}
            </div>
            <${TierChip} tier=${slot.tier} size="sm" class="diy-pick__tier" /><b class="diy-pick__label">${label}</b>
            <span class="diy-pick__note" title=${note}>${note}</span>
            <${TextField} size="sm" icon="search" value=${query} placeholder=${t('搜索干员 / 职业 / 盟约')} class="lo-search"
              onInput=${(v) => setQuery(String(v).slice(0, 24))} />
            <button type="button" class="diy-pick__x" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
          </div>
          <div class="lo-frow diy-pick__profrow"><${ProfFilter} m=${m} prof=${prof} onProf=${onProf} /></div>
        </header>
        <div class="lo-list diy-pick__list">
          <${DiyHead} />
          <div class="lo-list__rows" role="list" aria-label=${t('可选干员')}>
            ${kitted == null ? html`<p class="lo-empty t-dim">${t('连接服务器后才能选择自选干员')}</p>`
              : list.length ? list.map((o) => html`<${DiyRow} key=${o.charId} m=${m} slot=${slot} opt=${o} ch=${o.charId === draft?.charId ? ch : rowChoices(o.charId, slot.slotId, D)}
                  takenTier=${o.taken ? tiers.get(o.taken) ?? slot.tier : null} draft=${draft} selected=${draft?.charId === o.charId}
                  ops=${ops} onOps=${onOps} onSel=${sel} onQuick=${quick} level=${previewLevel} />`)
                : html`<p class="lo-empty t-dim">${t('没有符合条件的干员')}</p>`}
          </div>
        </div>
      </section>
      <div class="lo-detail-wrap">
        <div class="diy-pick__backrow">
          <button type="button" class="lo-detail-back diy-pick__back" onClick=${() => onNarrowDetail(false)}><${Icon} name="chevronLeft" />${t('干员列表')}</button>
        </div>
        <div class="lo-detail">
          ${ch && unit && base ? html`
            <div class="lo-dhead">
              <div class=${cx('lo-dhead__art', `lo-dhead__art--t${slot.tier}`)}>
                <${Img} src=${chessPortraitUrl(m, golden || base)} fallback=${html`<b class="diy-pick__glyph">${[...(unit.name || '?')][0]}</b>`} />
              </div>
              <div class="lo-dhead__info">
                <div class="lo-dhead__chips"><${TierChip} tier=${slot.tier} size="md" /><${KindTag} proto=${ch.proto} /></div>
                <h2 class="lo-dhead__name">${base.name || unit.name}</h2>
                <span class="lo-dhead__en">${base.appellation || unit.appellation || ''}</span>
                <span class="lo-dhead__class">
                  <${Img} src=${profGlyphUrl(m, base.profession)} class="lo-dhead__prof lo-profglyph" />${t(PROF_NAME[base.profession] || '')}
                  <i class="lo-sep"></i><${Img} src=${subProfIconUrl(m, base)} class="lo-dhead__prof" />${base.subProfessionName || ''}
                </span>
                <span class="lo-dhead__bonds">${(base.bonds || []).map((b) => html`<span key=${b} class="lo-bond">
                  <${Img} src=${bondIconUrl(m, b)} class="lo-bond__icon" fallback=${html`<i class="lo-bond__dot"></i>`} />${bondName(b)}</span>`)}</span>
              </div>
            </div>
            <div class="diy-pick__detail">
              <${OperatorVoice} charId=${draft.charId} />
              ${ch.proto
                ? html`<p class="lo-locknote"><${Icon} name="info" />${t('原型干员没有潜能与练度')}</p>`
                : onOps ? html`<${CultivationSection} charId=${draft.charId} ops=${ops} onSet=${onOps} />` : null}
              <${SkillSection} m=${m} chess=${base} golden=${golden} skillOptions=${skillOptions} skill=${skillOn} level=${previewLevel}
                onLevel=${onPreviewLevel} onPick=${pickSkill} locked=${!!ch.proto} />
              <${LoadoutStats} base=${base} golden=${golden} entries=${previewEntries} level=${previewLevel}
                onLevel=${onPreviewLevel} getChess=${previewChess} ops=${ch.proto ? null : ops} />
              <${ModuleSection} m=${m} golden=${golden} moduleOptions=${moduleOptions} module=${modOn ?? MODULE_NONE}
                onPick=${pickModule} potential=${ch.proto ? null : potential} locked=${!!ch.proto} />
              ${ch.proto ? html`<p class="lo-locknote"><${Icon} name="info" />${t('原型干员的技能与补位时一致，不可更改')}</p>` : null}
            </div>` : html`<div class="diy-pick__detail"><p class="lo-empty t-dim">${t('从左侧选择一名干员')}</p></div>`}
        </div>
      </div>
    </div>
    <footer class="diy-pick__foot">
      <${Button} variant="ghost" onClick=${onClose}>${t('取消')}<//>
      <${Button} variant="primary" icon="check" data-testid="diy-confirm" disabled=${!ch} onClick=${() => onDone(ch.proto ? { charId: draft.charId } : draft)}>${t('确认')}<//>
    </footer>
  </section>`;
}

/**
 * The tab's body: the four slots by tier, and the picker of the slot being filled (`picking`, kept here).
 * @param {{ m: any, picks: Record<string, any>, legal: Record<string, any>, kitted: string[]|null,
 *   onSet: (slotId: string, pick: any) => void, ops?: Record<string, any>,
 *   onOps?: ((charId: string, patch: { potential?: number, cultivate?: number }) => void) | null }} props
 *   `ops` / `onOps`: the stored 潜能 / 练度 and their setter (0.2.2 — an owned pick's card shows its selects)
 */
export function DiyPanel(props) {
  const [picking, setPicking] = useState(null);
  return DiyPanelView({ ...props, picking, onPicking: setPicking });
}

/** The tab's view (no hooks: the tests draw it): `picking` = the slot being filled, or null. */
export function DiyPanelView({ m, picks, legal, kitted, onSet, picking, onPicking: setPicking, ops = {}, onOps = null }) {
  const slots = diySlotList(diyData());
  const slot = picking ? slots.find((s) => s.slotId === picking) : null;
  const tiers = [...new Set(slots.map((s) => s.tier))];
  return html`<main class="diy" data-testid="diy">
    <div class="own__bar">
      <p class="own__lead">${t('5阶与6阶各有两个自选名额：选择持有的 6★ 干员（任选技能与模组）或原型干员（技能锁定）。自选干员只出现在你自己的商店里，调度中心达到该阶等级后才会刷新，价格与同阶干员相同；盟约按干员实际所属阵营分配，没有特质。')}</p>
    </div>
    <div class="diy__body">
      ${tiers.map((tier) => html`<section key=${tier} class="own-tier diy-tier" data-tier=${tier} aria-label=${t('{tier}阶', { tier })}>
        <h3 class="own-tier__head"><${TierChip} tier=${tier} size="sm" /><span class="num">${ROMAN[tier]}</span><span>${t('阶')}</span></h3>
        <div class="diy-grid">
          ${slots.filter((s) => s.tier === tier).map((s) => html`<${SlotCard} key=${s.slotId} m=${m} slot=${s} pick=${picks[s.slotId] || null}
            illegal=${!!picks[s.slotId] && !legal[s.slotId]} onOpen=${setPicking} onClear=${(id) => onSet(id, null)} ops=${ops} onOps=${onOps} />`)}
        </div>
      </section>`)}
    </div>
    ${slot ? html`<${DiyPicker} m=${m} slot=${slot} picks=${picks} kitted=${kitted} ops=${ops} onOps=${onOps} onClose=${() => setPicking(null)}
      onDone=${(pick) => { onSet(slot.slotId, pick); setPicking(null); }} />` : null}
  </main>`;
}
