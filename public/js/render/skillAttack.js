// §34.31 / §35.20: verified skill-mode animation keys; never fetch an effects index here.
// Official source: charpack/char_423_blemsh.ab, Modes/S2/Body/Attack: Attack, down Attack_Down;
// Modes/S3/Body/Attack: Skill_3. chararts/char_423_blemsh.ab DefaultSkin maps those keys identically.
// skchr_blemsh_2's blemsh_s_2[switch] uses switch_mode → S2; Skill_2 is its Sleep cast.
import { resolveSkill, skillRecordOf } from './vfx/skills.js';

// Official charpack/<id>.ab Modes + chararts/<id>.ab DefaultSkin._animations, checked with
// character/skill_table and the local fx index's skills/uses (full evidence: history §35.20):
// Texas Default attack's _oneshotAnim=Attack maps to Attack_Loop; neither skill switches its attack.
// Vigil Default _oneshotAnim=Attack maps identically; Skill1/2 are AnimatedActionToOwnerAbility casts.
// Specter S1's initial switch is Empty; the S1 attack after ExchangeHp is Attack, with no AnimatorHooker.
// Reed S2's Skill_2 is the fireball cast; Default Attack is unchanged (S3 has its own hook/held loop).
// Nearl S2 attacks with Attack_Loop; its hook replaces Die with Skill_2_Die, never Attack.
// 'Attack' below selects the model's normal attack ROLE, including its skin-specific Begin/End/facing.
// [ASSUMED] Cosmetic models use their declared normal role; a missing role keeps the old skill fallback.
// [ASSUMED] Keep the existing downward-role convention, including Specter's Attack_Down despite S1's empty down key.
// Tulip (char_513_apionr) has only S1; Skill_2 is that skill's Empty ability, not evidence of an S2.
const NORMAL_ATTACK_SKILLS = {
  char_102_texas: { 0: 'skcom_charge_cost', 1: 'skchr_texas_2' },
  char_427_vigil: { 0: 'skchr_vigil_1', 1: 'skchr_vigil_2' },
  char_1023_ghost2: { 0: 'skchr_ghost2_1' },
  char_1020_reed2: { 1: 'skchr_reed2_2' },
  char_1014_nearl2: { 1: 'skchr_nearl2_2' },
};

/**
 * The legacy effects index omits mode AnimatorHooker._replaceAnimPairs and skin _animations.
 * Do not generalize its raw animKey to other units: e.g. Humus S2 remaps Attack to Skill_2_Loop,
 * Gavial the Invincible S3 to Skill_3. Only the explicitly verified skills may override role selection.
 * [ASSUMED] Until those fields are exported, unverified units retain their existing roles, including §34.4.
 * This function does no I/O; a missing index also uses the verified S2 mapping, since her cast DOES have
 * OnAttack (manifest hits.Skill_2 = [0.5]) and cannot be distinguished by the no-event heuristic.
 */
export function skillAttackMode(index, { info = null, rec = null, skillIndex } = {}) {
  const charId = info?.diy?.charId || info?.spine || rec?.charId;
  if (!charId || info?.form) return null;
  const slot = Number.isInteger(skillIndex) ? skillIndex
    : Number.isInteger(info?.diy?.skillIndex) ? info.diy.skillIndex
      : Number.isInteger(info?.skillIndex) ? info.skillIndex : skillRecordOf(rec)?.index;
  const verified = NORMAL_ATTACK_SKILLS[charId]?.[slot];
  if (verified) {
    const srec = skillRecordOf(rec, slot);
    const id = srec?.prefabId || srec?.skillId;
    // [ASSUMED] An explicitly replaced plugin skill must not inherit an official slot's cast/attack mapping.
    if (id && String(id).toLowerCase().replace(/\[\d+\]$/, '') !== verified) return null;
    // These modes use the normal role with AND without the legacy index. Its raw key can be empty
    // (Texas/Vigil use an attack animator), or its first switch can be non-attacking (Specter's Empty).
    return { animKey: 'Attack' };
  }
  const unit = index?.units?.[charId];
  const resolved = unit ? resolveSkill(index, { info, rec, unitKey: charId, skillIndex: slot }) : null;
  // A known skill with unverified animation mappings keeps the pre-§34.31 roles. There is no generic
  // no-OnAttack heuristic: cast/strike semantics must be verified even without a unit/skill index entry.
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
