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

import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, TierChip } from '../ui/components.js';
import { Img, RichText, BondGlyph } from '../ui/gameComponents.js';
import { chessAvatarUrl, chessPortraitUrl, profIconUrl, skillRecordIconUrl, moduleTypeIconUrl } from '../ui/assetUrls.js';
import { data } from '../data.js';
import { PROF_NAME, skillLabel, moduleBadge, fullTraitText } from '../ui/loadoutModel.js';
import { diySlotList, pickChoices, pickOptions, slotRecord, defaultPick } from '../ui/diyModel.js';
import { OperatorVoice } from '../ui/operatorVoice.js';
import { CultivationSelects } from './cultivation.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI'];

/** The data the 自选 rules read (shared/diy.js): chess.json + backups.json (localized copies). */
export const diyData = () => ({ chess: data.get('chess'), backups: data.get('backups') });

/** A unit summary's avatar / portrait URL (a backups.json unit or a composed record). */
const avatarOf = (m, unit, elite = false) => chessAvatarUrl(m, unit && { charId: unit.charId, assets: { avatar: elite ? unit.assets?.avatarGolden : unit.assets?.avatar } });
const classLine = (u) => `${t(PROF_NAME[u?.profession] || '') || ''}${u?.subProfessionName ? ` · ${u.subProfessionName}` : ''}`;
const bondName = (id) => data.lookup('bonds', id)?.name || id;

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

/** One operator of the picker's list. */
function OptionCard({ m, opt, selected, onSel }) {
  const u = opt.unit;
  const name = u?.name || opt.charId;
  const takenBy = opt.taken ? diySlotList(diyData()).find((s) => s.slotId === opt.taken) : null;
  return html`<button type="button" role="option" aria-selected=${selected ? 'true' : 'false'} data-char=${opt.charId}
      class=${cx('diy-opt', selected && 'is-sel', opt.taken && 'is-taken')} disabled=${!!opt.taken} onClick=${() => onSel(opt.charId)}
      title=${takenBy ? t('已在{tier}阶自选中', { tier: takenBy.tier }) : name}>
    <span class="diy-opt__ava"><${Img} src=${avatarOf(m, u)} fallback=${html`<b>${[...name][0]}</b>`} /></span>
    <span class="diy-opt__txt">
      <span class="diy-opt__top"><b class="diy-opt__name">${name}</b><${KindTag} proto=${opt.proto} /></span>
      <small class="diy-opt__class"><${Img} src=${profIconUrl(m, u?.profession)} class="diy-opt__prof" />${classLine(u)}</small>
      <${Bonds} bonds=${opt.bonds} />
    </span>
    ${takenBy ? html`<span class="diy-opt__taken">${t('已在{tier}阶自选中', { tier: takenBy.tier })}</span>` : null}
  </button>`;
}

/** A skill choice of an owned pick (or the locked skill of a prototype). */
function SkillRow({ m, s, on, locked, onPick }) {
  const rec = s.elite || s.normal;
  return html`<button type="button" role="radio" aria-checked=${on ? 'true' : 'false'} data-skill=${s.index} disabled=${locked}
      class=${cx('diy-choice', on && 'is-on')} onClick=${() => onPick(s.index)}>
    <span class="diy-choice__icon"><${Img} src=${skillRecordIconUrl(m, rec, { empty: false })} fallback=${html`<b class="num">${skillLabel(s.index)}</b>`} /></span>
    <span class="diy-choice__body">
      <span class="diy-choice__head"><b class="num">${skillLabel(s.index)}</b><b>${rec?.name || ''}</b>${on ? html`<span class="lo-badge lo-badge--on"><${Icon} name="check" />${locked ? t('锁定') : t('已选择')}</span>` : null}</span>
      <${RichText} as="span" class="diy-choice__desc" text=${s.normal?.descRaw || s.normal?.desc || ''} />
    </span>
  </button>`;
}

/** A module choice of an owned pick (不装备 or a module of the elite form). */
function ModuleRow({ id, rec, on, locked, onPick }) {
  const none = id == null;
  const talents = rec && Array.isArray(rec.talentChanges) ? rec.talentChanges.filter((x) => x && x.desc && !x.hidden) : [];
  // the trait this module gives: the class trait (or the module's rewrite), then its extra line (item 16.2)
  const trait = rec?.traitOverride ? fullTraitText(rec.traitOverride) || null : null;
  return html`<button type="button" role="radio" aria-checked=${on ? 'true' : 'false'} data-module=${none ? 'none' : id} disabled=${locked}
      class=${cx('diy-choice', 'diy-choice--mod', on && 'is-on')} onClick=${() => onPick(id)}>
    <span class="diy-choice__icon">${none ? html`<b>—</b>` : html`<${Img} src=${moduleTypeIconUrl(data.get('local'), rec.typeName)} fallback=${html`<b class="num">${moduleBadge(rec)}</b>`} />`}</span>
    <span class="diy-choice__body">
      <span class="diy-choice__head">${none ? html`<b>${t('不装备')}</b>` : html`<b class="num">${rec.typeName || ''}</b><b>${rec.name || id}</b>`}${on ? html`<span class="lo-badge lo-badge--on"><${Icon} name="check" />${locked ? t('锁定') : t('已选择')}</span>` : null}</span>
      ${trait ? html`<${RichText} as="span" class="diy-choice__desc" text=${trait} />` : null}
      ${talents.map((x, i) => html`<${RichText} key=${i} as="span" class="diy-choice__desc" text=${x.descRaw || x.desc} />`)}
    </span>
  </button>`;
}

/**
 * The slot picker: the legal operators of the slot's tier (prototypes first, then the owned 6★; a 原型 / 已持有 filter and
 * a search), the chosen one's skill / module (an owned pick) or its locked selection (a prototype), 确认 / 取消. The
 * state (filter, search, the draft pick) lives here; DiyPickerView draws it.
 * @param {{ m: any, slot: any, picks: Record<string, any>, kitted: string[]|null, onDone: (pick: any) => void, onClose: () => void }} props
 */
export function DiyPicker(props) {
  const cur = props.picks[props.slot.slotId] || null;
  const [filter, setFilter] = useState('all');
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
  return DiyPickerView({ ...props, filter, query, draft, onFilter: setFilter, onQuery: setQuery, onDraft: setDraft });
}

/**
 * The picker's view (no hooks: the tests draw it): `filter` 'all' | 'proto' | 'owned', `query`, `draft` the pick being
 * made (null = none chosen yet) and their setters.
 */
export function DiyPickerView({ m, slot, picks, kitted, onDone, onClose, filter, query, draft, onFilter: setFilter, onQuery: setQuery, onDraft: setDraft }) {
  const D = diyData();
  const cur = picks[slot.slotId] || null;
  const options = pickOptions(slot.slotId, picks, D, kitted);
  const q = query.trim().toLowerCase();
  const list = options.filter((o) => (filter === 'all' || (filter === 'proto') === o.proto)
    && (!q || [o.unit?.name, o.unit?.appellation, o.unit?.subProfessionName, t(PROF_NAME[o.unit?.profession] || ''), ...o.bonds.map(bondName)].some((x) => typeof x === 'string' && x.toLowerCase().includes(q))));
  const ch = draft ? pickChoices(draft.charId, slot.slotId, D) : null;
  const sel = (charId) => {
    if (draft?.charId === charId) return;
    setDraft(cur && cur.charId === charId ? { ...cur } : defaultPick(charId, slot.slotId, D));
  };
  const lk = ch?.locked || null;
  const skillOn = ch ? (ch.proto ? lk?.skillIndex : draft.skillIndex) : null;
  const modOn = ch ? (ch.proto ? lk?.uniEquipId ?? null : draft.uniEquipId ?? null) : null;
  const unit = draft ? D.backups?.units?.[draft.charId] : null;
  const label = t('{tier}阶 自选', { tier: slot.tier });
  return html`<section class="diy-pick" role="dialog" aria-label=${t('{slot}：选择干员', { slot: label })} data-testid="diy-picker" data-slot=${slot.slotId}>
    <header class="diy-pick__head">
      <${TierChip} tier=${slot.tier} size="sm" /><b>${label}</b>
      <span class="diy-pick__note">${slot.tier === 5 ? t('6★ 原型干员与持有的 6★ 干员，另有 4★ 原型干员（先锋、特种除外）') : t('6★ 原型干员与持有的 6★ 干员')}</span>
      <button type="button" class="diy-pick__x" aria-label=${t('关闭')} onClick=${onClose}><${Icon} name="close" /></button>
    </header>
    <div class="diy-pick__bar">
      <div class="lo-chips" role="group" aria-label=${t('筛选')}>
        ${[['all', t('全部')], ['proto', t('原型')], ['owned', t('已持有')]].map(([k, text]) => html`<button key=${k} type="button" class=${cx('lo-chip', filter === k && 'is-on')}
          aria-pressed=${filter === k ? 'true' : 'false'} data-filter=${k} onClick=${() => setFilter(k)}>${text}</button>`)}
      </div>
      <input type="search" class="diy-pick__search" value=${query} placeholder=${t('搜索干员 / 职业 / 盟约')} aria-label=${t('搜索干员 / 职业 / 盟约')}
        onInput=${(e) => setQuery(String(e.currentTarget.value).slice(0, 24))} />
    </div>
    <div class="diy-pick__main">
      <div class="diy-pick__list" role="listbox" aria-label=${t('可选干员')}>
        ${kitted == null ? html`<p class="lo-empty t-dim">${t('连接服务器后才能选择自选干员')}</p>`
          : list.length ? list.map((o) => html`<${OptionCard} key=${o.charId} m=${m} opt=${o} selected=${draft?.charId === o.charId} onSel=${sel} />`)
            : html`<p class="lo-empty t-dim">${t('没有符合条件的干员')}</p>`}
      </div>
      <div class="diy-pick__detail">
        ${ch && unit ? html`
          <div class="diy-pick__who">
            <span class="diy-pick__ava"><${Img} src=${avatarOf(m, unit, true)} fallback=${html`<b>${[...(unit.name || '?')][0]}</b>`} /></span>
            <span class="diy-pick__wtxt"><b>${unit.name}</b><small>${classLine(unit)}</small></span>
            <${KindTag} proto=${ch.proto} />
          </div>
          <h4 class="diy-pick__sec">${t('技能')}${ch.proto ? html`<small>${t('原型干员的技能与补位时一致，不可更改')}</small>` : null}</h4>
          <div role="radiogroup" aria-label=${t('选择技能')} class="diy-pick__choices">
            ${ch.skills.filter((s) => !ch.proto || s.index === skillOn).map((s) => html`<${SkillRow} key=${s.index} m=${m} s=${s} on=${s.index === skillOn} locked=${ch.proto}
              onPick=${(i) => setDraft({ ...draft, skillIndex: i })} />`)}
          </div>
          <h4 class="diy-pick__sec">${t('模组')}<small>${t('精锐时生效 · 模组等级 {stage}', { stage: ch.stage })}</small></h4>
          <div role="radiogroup" aria-label=${t('选择模组')} class="diy-pick__choices">
            ${ch.proto
              ? html`<${ModuleRow} id=${modOn} rec=${modOn ? ch.elite.modules?.find((x) => x.uniEquipId === modOn) || null : null} on=${true} locked=${true} onPick=${() => {}} />`
              : [html`<${ModuleRow} key="none" id=${null} rec=${null} on=${modOn == null} locked=${false} onPick=${() => setDraft({ ...draft, uniEquipId: null })} />`,
                ...ch.modules.map((x) => html`<${ModuleRow} key=${x.uniEquipId} id=${x.uniEquipId} rec=${x.rec} on=${modOn === x.uniEquipId} locked=${false}
                  onPick=${(id) => setDraft({ ...draft, uniEquipId: id })} />`)]}
          </div>` : html`<p class="lo-empty t-dim">${t('从左侧选择一名干员')}</p>`}
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
    ${slot ? html`<${DiyPicker} m=${m} slot=${slot} picks=${picks} kitted=${kitted} onClose=${() => setPicking(null)}
      onDone=${(pick) => { onSet(slot.slotId, pick); setPicking(null); }} />` : null}
  </main>`;
}
