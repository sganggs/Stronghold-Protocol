// 潜能 / 练度 controls of the 干员调配 overlay (0.2.2, the owner's decision of 2026-10-08: 「调配干员里自己设置吧，默认满潜
// 满加成」): per operator (by charId — the normal, elite and 自选 forms share them), 潜能 1–6 and the 自持有 练度 tier
// (effects.json CHAR_MAP aceffect_char_1…4: 未精英化 / 精英阶段1 / 精英阶段2 / 精英阶段2-60级 — their official names and
// texts, localized by the data overlay), default 潜能 6 / 精英阶段2-60级. Official: 调度手册 「卫戍协议中干员潜能由自身已
// 持有干员潜能决定」 and 「提升已持有的干员，将为卫戍协议中同名的干员提供加成」 (an operator the player does not own fights
// at 潜能 1 with no bonus: set by hand for a 特许 one; a NORMAL one not owned is its stand-in, which has neither).
// CultivationSelects: two compact selects (a roster row, a 自选 slot card); CultivationSection: the detail's segmented
// controls with the tier's effect. Hook-free views (the tests draw them). The settings live in ui/loadoutSync.js
// (`ops`, synced with room.loadout); the model is ui/loadoutModel.js opsOf / setOps.

import { html, MicroLabel } from '../ui/components.js';
import { data } from '../data.js';
import { opsOf } from '../ui/loadoutModel.js';
import { CULTIVATE_EFFECTS, POTENTIAL_MIN, POTENTIAL_MAX, POTENTIAL_DEFAULT, CULTIVATE_DEFAULT } from '../../../shared/potential.js';
import { charPotentialChanges } from '../../../shared/protocol.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const POTENTIALS = Array.from({ length: POTENTIAL_MAX - POTENTIAL_MIN + 1 }, (_, i) => POTENTIAL_MIN + i);
const TIERS = CULTIVATE_EFFECTS.map((_, i) => i);
/** Names while effects.json is not loaded (msgids; the data's own names win). */
const FALLBACK_NAMES = Object.freeze([N_('未精英化'), N_('精英阶段1'), N_('精英阶段2'), N_('精英阶段2-60级')]);
/** The short names a row's select shows (the full official name is its title and the detail's). */
const SHORT_NAMES = Object.freeze([N_('未精英化'), N_('精英1'), N_('精英2'), N_('精英2 Lv.60')]);

/** The official name of 练度 tier `n` (effects.json `name`, localized), else its fallback. */
export function cultivateName(n) {
  return data.lookup('effects', CULTIVATE_EFFECTS[n])?.name || t(FALLBACK_NAMES[n] || '');
}

/** The official effect text of 练度 tier `n` (effects.json `desc`: 「攻击力、防御力和最大生命值+10%」 …), or ''. */
export function cultivateDesc(n) {
  return data.lookup('effects', CULTIVATE_EFFECTS[n])?.desc || '';
}

/**
 * Whether 调配 / 自选 may edit potential. Official ids stay editable. A plugin `char_x_` with no curve does not:
 * the server accepts only potential 6 (shared/protocol.js charPotentialChanges). `tables` overrides the loaded data.
 * @param {string} charId
 * @param {{ chess?: Record<string, any>, backups?: any }|null} [tables]
 */
export function potentialEditable(charId, tables = null) {
  const src = tables ?? { chess: data.get('chess'), backups: data.get('backups') };
  return charPotentialChanges(src, charId);
}

/**
 * The cultivation row the screens draw. A potential the control does not show is not a visible change; 练度 still is.
 * @param {string} charId
 * @param {Record<string, any>|null|undefined} ops
 * @param {{ chess?: Record<string, any>, backups?: any }|null} [tables]
 */
export function cultivationView(charId, ops, tables = null) {
  const cur = opsOf(ops, charId);
  const potentialOn = potentialEditable(charId, tables);
  return {
    potential: cur.potential,
    cultivate: cur.cultivate,
    potentialOn,
    changed: cur.cultivate !== CULTIVATE_DEFAULT || (potentialOn && cur.potential !== POTENTIAL_DEFAULT),
  };
}

/**
 * Two compact selects — 潜能 and 练度 — of operator `charId` under the stored settings `ops` (a roster row, a 自选 slot).
 * @param {{ charId: string, ops: Record<string, any>, onSet: (charId: string, patch: { potential?: number, cultivate?: number }) => void,
 *   note?: string|null, disabled?: boolean }} props `note`: why the settings do not apply now (a 补位 stand-in), shown as
 *   the tooltip; `disabled`: the controls are not the player's to change here (a 自选 pick another slot already holds)
 */
export function CultivationSelects({ charId, ops, onSet, note = null, disabled = false }) {
  if (!charId) return null;
  const cur = cultivationView(charId, ops);
  const set = (patch) => onSet(charId, patch);
  // a setting off the default stands out (mint); the default stays quiet — it is the same on every row
  return html`<span class=${cx('lo-cult', cur.changed && 'is-changed', note && 'is-moot')} data-char=${charId} title=${note || undefined}>
    ${cur.potentialOn ? html`<span class=${cx('lo-select', 'lo-cult__sel', 'lo-cult__pot', cur.potential !== POTENTIAL_DEFAULT && 'is-off')}>
      <select value=${String(cur.potential)} aria-label=${t('潜能')} data-cult="potential" disabled=${disabled}
        onChange=${(e) => set({ potential: Number(e.currentTarget.value) })}>
        ${POTENTIALS.map((n) => html`<option key=${n} value=${String(n)}>${t('潜能 {n}', { n })}</option>`)}
      </select>
    </span>` : null}
    <span class=${cx('lo-select', 'lo-cult__sel', 'lo-cult__tier', cur.cultivate !== TIERS.length - 1 && 'is-off')} title=${note ? undefined : cultivateName(cur.cultivate)}>
      <select value=${String(cur.cultivate)} aria-label=${t('练度')} data-cult="cultivate" disabled=${disabled}
        onChange=${(e) => set({ cultivate: Number(e.currentTarget.value) })}>
        ${TIERS.map((n) => html`<option key=${n} value=${String(n)}>${t(SHORT_NAMES[n])}</option>`)}
      </select>
    </span>
  </span>`;
}

/**
 * The detail's 潜能 / 练度 section: 潜能 1–6 and the four 练度 tiers as segmented buttons, the tier's official effect,
 * the rule in one line, and — for a chess the player marked not owned — that its stand-in has neither.
 * @param {{ charId: string, ops: Record<string, any>, onSet: (charId: string, patch: object) => void, standIn?: boolean }} props
 */
export function CultivationSection({ charId, ops, onSet, standIn = false }) {
  if (!charId) return null;
  const cur = cultivationView(charId, ops);
  const set = (patch) => onSet(charId, patch);
  return html`<section class=${cx('lo-sec', 'lo-sec--cult', standIn && 'is-moot')} aria-label=${t('潜能与练度')} data-char=${charId}>
    <header class="lo-sec__head">
      <h3>${t('潜能与练度')}<${MicroLabel}>POTENTIAL<//></h3>
      ${cur.changed ? html`<span class="lo-badge lo-badge--changed">${t('已调整')}</span>` : html`<span class="lo-badge lo-badge--plain">${t('满潜能 · 精英2 Lv.60')}</span>`}
    </header>
    ${cur.potentialOn ? html`<div class="lo-cult__row">
      <span class="lo-cult__k">${t('潜能')}</span>
      <div class="lo-seg lo-seg--pot" role="radiogroup" aria-label=${t('潜能')}>
        ${POTENTIALS.map((n) => html`<button key=${n} type="button" role="radio" aria-checked=${cur.potential === n ? 'true' : 'false'}
          class=${cx(cur.potential === n && 'is-on')} data-potential=${n} onClick=${() => set({ potential: n })}><span class="num">${n}</span></button>`)}
      </div>
    </div>` : null}
    <div class="lo-cult__row">
      <span class="lo-cult__k">${t('练度')}</span>
      <div class="lo-seg lo-seg--tier" role="radiogroup" aria-label=${t('练度')}>
        ${TIERS.map((n) => html`<button key=${n} type="button" role="radio" aria-checked=${cur.cultivate === n ? 'true' : 'false'}
          class=${cx(cur.cultivate === n && 'is-on')} data-cultivate=${n} onClick=${() => set({ cultivate: n })}>${cultivateName(n)}</button>`)}
      </div>
    </div>
    <p class="lo-cult__eff" data-cultivate=${cur.cultivate}><b>${cultivateName(cur.cultivate)}</b> <span>${cultivateDesc(cur.cultivate)}</span></p>
    <p class="lo-cult__note">${standIn
      ? t('干员持有中标记为未持有：替补干员没有潜能与练度；这里的设置在改回「持有」后生效')
      : t('默认满潜能、精英2 Lv.60（满加成）。官方的潜能取你自己的潜能，练度是自持有加成（已持有的同名干员的养成，攻击 / 防御 / 生命单独乘算）；未持有的特许干员在官方按潜能1、没有加成，要照官方打请手动设为潜能1、未精英化。')}</p>
  </section>`;
}
