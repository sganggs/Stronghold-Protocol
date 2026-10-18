// §34.31: verified skill-mode animation keys, using only the field's already loaded effects index.
// Official source: charpack/char_423_blemsh.ab, Modes/S2/Body/Attack: Attack, down Attack_Down;
// Modes/S3/Body/Attack: Skill_3. chararts/char_423_blemsh.ab DefaultSkin maps those keys identically.
// skchr_blemsh_2's blemsh_s_2[switch] uses switch_mode → S2; Skill_2 is its Sleep cast.
import { resolveSkill, skillRecordOf } from './vfx/skills.js';

/**
 * The legacy effects index omits mode AnimatorHooker._replaceAnimPairs and skin _animations.
 * Do not generalize its raw animKey to other units: e.g. Humus S2 remaps Attack to Skill_2_Loop,
 * Gavial the Invincible S3 to Skill_3. Blemishine's complete mapping above has been checked.
 * [ASSUMED] Until those fields are exported, unverified units retain their existing roles, including §34.4.
 * This function does no I/O; a missing index also uses the verified S2 mapping, since her cast DOES have
 * OnAttack (manifest hits.Skill_2 = [0.5]) and cannot be distinguished by the no-event heuristic.
 */
export function skillAttackMode(index, { info = null, rec = null, skillIndex } = {}) {
  const charId = info?.diy?.charId || info?.spine || rec?.charId;
  if (!charId || info?.form) return null;
  const slot = Number.isInteger(skillIndex) ? skillIndex
    : Number.isInteger(info?.skillIndex) ? info.skillIndex : skillRecordOf(rec)?.index;
  const unit = index?.units?.[charId];
  const resolved = unit ? resolveSkill(index, { info, rec, unitKey: charId, skillIndex: slot }) : null;
  // A known skill with unexported animation mappings keeps the pre-§34.31 roles. The no-event heuristic is
  // only for a missing unit/skill entry; it must not override an indexed skill's own cast/strike semantics.
  if (charId !== 'char_423_blemsh') return resolved?.skill ? { preserve: true } : null;
  // S1 is a replacement attack (Skill_1), not an attack while a lasting mode is running.
  if (slot !== 1 && slot !== 2) return null;
  if (resolved?.skill) {
    const modes = unit.modes || [];
    const mode = Number.isInteger(resolved.skill.mode) ? modes[resolved.skill.mode]
      : modes.find(m => m.name === 'Default');
    if (typeof mode?.attack?.animKey === 'string' && mode.attack.animKey) return { animKey: mode.attack.animKey };
  }
  return slot === 1 ? { animKey: 'Attack' } : null;
}
