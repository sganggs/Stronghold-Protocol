// server/sim/content/kits/shared/borrow.js — a 自选 kit that reuses tier-kit builders (versions M2, DESIGN §35.22.9).
//
// A tier kit is called once, with the SELECTED skill's blackboard. `alt` (tier4) and `lazySkills` (tier5) put only that
// skill's spec where the shop chess expects it: a non-default id under `skills[id]`, the shop-default skill on `.skill`,
// and both close over the blackboard of THAT call. Copying the map would store every other skill built from the selected
// blackboard. Each skill is therefore rebuilt on its own: a shallow chess whose `.skill` is that skill's record (selectedId
// prefers `chess.skill.skillId`) and a def whose `skill.id` is that id. The first part that returns `skills[id]`, or
// `.skill` when the id is that part's shop-default skill, wins. A skill no tier kit authors (百炼嘉维尔 S1 is authored;
// an id none of the parts returns) is stored as genericSkillSpec so selectSkillSpec reports `skills`.
// The body (talents, install, trait) is ONE call of the owner builder with the real selected blackboard: the part whose
// shop-default skill is selected, else the part of the piece's tier, else the first. That is how the shop kit is invoked.

import { skillRec } from './tier1.js';
import { genericSkillSpec } from '../../generic.js';

/** A def/chess pair whose selected skill is `rec` (the tier builder reads both). */
function viewFor(chess, def, rec) {
  const skill = {
    ...(def?.skill || {}),
    id: rec.skillId,
    bb: rec.bb || {},
    duration: rec.duration,
    durationType: rec.durationType,
    spCost: rec.spCost,
    initSp: rec.initSp,
    maxCharges: rec.maxChargeTime ?? def?.skill?.maxCharges ?? 1,
    description: rec.desc ?? rec.descRaw ?? rec.description ?? '',
    rangeGrid: rec.rangeGrid ?? null,
    skillType: rec.skillType,
    trigger: rec.trigger,
  };
  return {
    bb: rec.bb || {},
    chess: { ...chess, skill: rec },
    def: { ...def, skill, raw: { ...(def?.raw || chess), skill: rec } },
  };
}

/** Skill-shaped record genericSkillSpec reads (`desc` on a built chess, `description` on a normalised skill). */
function asGenericSkill(rec) {
  return {
    id: rec.skillId,
    description: rec.desc ?? rec.descRaw ?? rec.description ?? '',
    maxCharges: rec.maxChargeTime ?? rec.maxCharges ?? 1,
    skillType: rec.skillType,
    durationType: rec.durationType,
    duration: rec.duration,
    spCost: rec.spCost,
    initSp: rec.initSp,
    bb: rec.bb || {},
    rangeGrid: rec.rangeGrid ?? null,
  };
}

/** The spec `part`'s builder produces for `id` when that skill is the selected one. Null when it does not author it. */
function specFrom(part, id, rec, chess, def) {
  const v = viewFor(chess, def, rec);
  const built = part.builder(v.bb, v.chess, v.def);
  if (!built || typeof built !== 'object') return null;
  const map = built.skills;
  if (map && Object.prototype.hasOwnProperty.call(map, id) && map[id]) return map[id];
  if (id === part.skillId && built.skill) return built.skill;
  return null;
}

/**
 * `(bb, chess, def) => Kit` borrowing `parts` (`{ builder, skillId, tier }`). `skillId` is the shop-default skill of
 * that tier file (the one it puts on `.skill`). `tier` picks the body when the selected skill is authored by none of them.
 */
export function borrowTierKits(parts) {
  return (bb, chess, def) => {
    const selected = chess?.skill?.skillId ?? def?.skill?.id ?? null;
    const owner = parts.find((p) => p.skillId === selected)
      ?? parts.find((p) => p.tier != null && p.tier === def?.tier)
      ?? parts[0];
    const body = owner.builder(bb || {}, chess, def) || {};
    const ids = [];
    for (const s of chess?.skills ?? []) if (s?.skillId && !ids.includes(s.skillId)) ids.push(s.skillId);
    if (selected && !ids.includes(selected)) ids.push(selected);
    const skills = {};
    for (const id of ids) {
      const rec = skillRec(chess, id);
      let spec = null;
      if (rec) {
        const ordered = [...parts.filter((p) => p.skillId === id), ...parts.filter((p) => p.skillId !== id)];
        for (const part of ordered) {
          try { spec = specFrom(part, id, rec, chess, def); } catch { spec = null; }
          if (spec) break;
        }
        if (!spec) spec = genericSkillSpec(asGenericSkill(rec), rec.bb || {}, def);
      }
      if (spec) skills[id] = spec;
    }
    const out = {};
    for (const k of Object.keys(body)) {
      if (k === 'skill' || k === 'skills') continue;
      out[k] = body[k];
    }
    out.skills = skills;
    out.skill = (selected && skills[selected]) || null;
    return out;
  };
}
