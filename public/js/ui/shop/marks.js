// The project's own marks on a shop card — the DOM ChessCard's 「替补」 / 「自选」 / owned-copy pips /
// skill badge / 「可晋升」 — as one pure model. The canvas draws them as a DOM overlay on the card
// hotspot (host.js syncCardMarks), sized and placed by game-shop-canvas.css; the same fields are what
// shopBar's ChessCard renders, so the two shops keep one definition (the maintainer's review of
// 2026-11-22 asked for readable, localized marks over the canvas card instead of a second WebGL copy).
//
// Positions and sizes come from the owner's PSD (card-base-4x.psd, 2026-11-22): every mark is anchored
// by its left/top percentage of the card box, and the text marks grow to the right as the language needs.

import { data } from '../../data.js';
import {
  mergeProgress, mergeHint, chessLoadout, ownStandIn, standInLoadout, standInLabel, standInTip,
  ownDiyRecord, diyGetter,
} from '../gameLogic.js';
import { skillIconUrl, skillRecordIconUrl } from '../assetUrls.js';
import { t } from '../../../../shared/i18n.js';

const DATA_CHESS = () => data.get('chess');
const DATA_BACKUPS = () => data.get('backups');

/**
 * One card's marks. `null` marks are not drawn; the caller filters them by the player's settings.
 * @param {any} priv m.private (the shop owner's own view)
 * @param {any} slot the display slot (`null` on an empty front, a sold slot, or an item slot)
 * @param {{ lookups?: { getChess: Function }, backups?: any, effects?: any }} [o]
 * @returns {{ skill: any, pips: any, standIn: any, diy: any, merge: any }} every field null without marks
 */
export function cardMarkModel(priv, slot, o = {}) {
  const empty = { skill: null, pips: null, standIn: null, diy: null, merge: null };
  if (!slot || slot.sold || slot.kind === 'item') return empty;
  const lookups = o.lookups || { getChess: (id) => data.lookup('chess', id) };
  const backups = o.backups !== undefined ? o.backups : DATA_BACKUPS();
  const base = lookups.getChess(slot.id);
  if (!base) return empty;
  const diyData = { chess: DATA_CHESS(), backups };
  const dr = ownDiyRecord(base, priv, diyData);
  const si = dr ? null : ownStandIn(base, priv, backups);
  const record = dr || si || base;
  const m = data.get('assets');
  const loader = dr ? diyGetter(lookups.getChess, priv, diyData) : lookups.getChess;
  const lo = si
    ? standInLoadout(si, lookups.getChess, backups)
    : chessLoadout(record, priv && priv.loadout, loader, {
      ops: (priv && priv.ops) || null,
      effects: o.effects !== undefined ? o.effects : data.get('effects'),
    });
  const progress = mergeProgress(priv, slot.id, lookups.getChess);
  const hint = mergeHint(priv, slot.id);
  const mod = lo && lo.module && !lo.module.none ? lo.module : null;
  // The canvas skill mark is the sprite box only: the DOM SkillBadge's module chip (`.scard__mod`) stays in the
  // tooltip here — the owner's PSD reserves the box for the skill icon, and the module is not in the requested
  // mark list (2026-11-22).
  const skill = lo && lo.skill
    ? {
      file: !lo.defaultSkill && !si ? skillRecordIconUrl(m, lo.skill, { empty: false }) : skillIconUrl(m, record),
      slot: Number.isInteger(lo.skill.index) ? `S${lo.skill.index + 1}` : null,
      custom: !lo.defaultSkill && !si,
      aria: lo.skill.name
        ? t('技能：{name}', { name: lo.skill.name })
        : t('技能'),
      title: `${Number.isInteger(lo.skill.index) ? t('技能 {slot}：{name}', { slot: `S${lo.skill.index + 1}`, name: lo.skill.name || '' }) : t('技能：{name}', { name: lo.skill.name || '' })}`
        + `${!lo.defaultSkill && !si ? t('（已调配）') : ''}`
        + `${mod ? t(' · 模组：{name}', { name: mod.name }) : lo.module && lo.module.none ? t(' · 未装备模组') : ''}`,
    }
    : null;
  return {
    skill,
    pips: progress.copies > 0
      ? {
        copies: progress.copies,
        need: progress.need,
        aria: t('已拥有 {copies}/{need}', { copies: progress.copies, need: progress.need }),
        title: t('已拥有 {copies}/{need}', { copies: progress.copies, need: progress.need }),
      }
      : null,
    standIn: si && standInLabel(si)
      ? {
        label: standInLabel(si),
        aria: t('{name}的替补', { name: base.name || '' }),
        title: standInTip(si, base.name),
      }
      : null,
    diy: dr
      ? {
        label: t('自选'),
        aria: t('自选编队：{name}', { name: dr.name || '' }),
        title: t('自选编队：{name}（只在你的商店出现）', { name: dr.name || '' }),
      }
      : null,
    merge: hint
      ? { label: t('可晋升'), aria: t('可晋升'), title: hint }
      : null,
  };
}

/**
 * Marks for a whole display row, index-aligned with the slots the renderer paints.
 * @param {any} priv m.private
 * @param {any[]} slots the display slots (shopDisplayPrivate's row)
 * @param {{ lookups?: any, backups?: any, effects?: any }} [o]
 */
export function shopCardMarks(priv, slots, o = {}) {
  const list = Array.isArray(slots) ? slots : [];
  return list.map((slot) => cardMarkModel(priv, slot, o));
}

/**
 * Drop the marks the player switched off; an empty model is `null` (the hotspot then draws nothing).
 * 可晋升 and the owned-copy pips are one group (`progress`), 替补 and 自选 are one (`standIn`).
 * @param {any} marks cardMarkModel output
 * @param {{ skill?: boolean, standIn?: boolean, progress?: boolean }} [switches]
 */
export function filterCardMarks(marks, switches) {
  if (!marks) return null;
  const on = switches || {};
  const out = {
    skill: on.skill === false ? null : marks.skill,
    standIn: on.standIn === false ? null : marks.standIn,
    diy: on.standIn === false ? null : marks.diy,
    pips: on.progress === false ? null : marks.pips,
    merge: on.progress === false ? null : marks.merge,
  };
  return out.skill || out.standIn || out.diy || out.pips || out.merge ? out : null;
}
