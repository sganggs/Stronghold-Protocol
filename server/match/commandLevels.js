// Pure command unlock resolution shared by selected-command upgrades and replacement candidates.

/** @param {any} ps @returns {any[]} */
export function commandSkillRows(ps) {
  return Object.values(ps.gd.raw.bands || {}).flatMap(band => band.skills || []);
}

/** @param {any} ps @param {any} skill */
export function commandUnlockMet(ps, skill) {
  const [a, b] = Array.isArray(skill?.unlockParam) ? skill.unlockParam : [];
  switch (skill?.unlockType) {
    case 'band_skill_load_by_round': return ps.m.round >= Number(a);
    case 'band_skill_load_by_shop_lv': return ps.shop.level >= Number(a);
    case 'band_skill_load_by_coin_cost': return ps.stats.gold >= Number(a);
    case 'band_skill_load_by_bond_act_count': return (ps.bonds[a]?.count || 0) >= Number(b);
    default: return false;
  }
}

/** @param {any} ps @param {any} skill @param {Map<string, any>} rowsById */
export function nextUnlockedCommandSkill(ps, skill, rowsById) {
  if (!skill?.next || !commandUnlockMet(ps, skill)) return null;
  return rowsById.get(skill.next) || null;
}

/**
 * Resolve a strategy's one currently unlocked row from its first skill.
 * @param {any} ps
 * @param {any} band
 * @param {Map<string, any>} rowsById
 */
export function commandSkillAtPlayerLevel(ps, band, rowsById) {
  let skill = band?.skills?.[0] || null;
  const seen = new Set();
  // loop-cap: each effectId is visited once; next rows are limited by rowsById, plus at most the initial row.
  while (skill?.next && !seen.has(skill.effectId)) {
    seen.add(skill.effectId);
    const next = nextUnlockedCommandSkill(ps, skill, rowsById);
    if (!next || seen.has(next.effectId)) break;
    skill = next;
  }
  return skill;
}

const FIXED_ROUND_EFFECTS = new Set([
  'give_coin_in_round',
  'prep_start_gain_chess_from_pool_in_round',
  'prep_start_random_equip_in_round',
  'preparation_start_gain_chess_from_round',
  'round_start_bond_check_gain_layer',
]);
const TEAM_UNIQUE_EFFECT_KEYS = new Set(['round_start_all_player_change_enemy_2']);
const playerRound = ps => Math.max(1, Math.trunc(Number(ps?.m?.round) || 1));
const buffParams = buff => ({ ...(buff?.bb || {}), ...(buff?.bbStr || {}) });

function lastPrepRound(ps) {
  const gd = ps?.gd;
  for (const value of [gd?.hiddenRound, gd?.bossRound, gd?.lastRound]) {
    const round = Number(value);
    if (Number.isInteger(round) && round > 0) return round;
  }
  return null;
}

function playerCurrentSkill(player, rowsById) {
  if (player?.command) return rowsById.get(player.command.currentEffectId) || null;
  const gd = player?.gd;
  return typeof gd?.band === 'function' ? gd.band(player.bandId) : gd?.raw?.bands?.[player?.bandId] || null;
}

function hasCurrentBuff(player, key, rowsById) {
  return playerCurrentSkill(player, rowsById)?.buffs?.some(buff => buff.key === key) || false;
}

function hasMedicalMapBuff(player, rowsById) {
  const raw = player?.gd?.raw || {};
  return (playerCurrentSkill(player, rowsById)?.buffs || []).some(buff => {
    if (buff.key !== 'auto_chess_change_map') return false;
    return Object.entries(buffParams(buff)).some(([key, value]) => {
      if (!key.startsWith('char_') || !key.includes('#') || !(Number(value) > 0)) return false;
      const tokenId = key.slice(0, key.indexOf('#'));
      return raw.tokens?.[tokenId]?.profession === 'MEDIC';
    });
  });
}

function teammates(ps, includeDeparted) {
  const m = ps?.m;
  if (includeDeparted) return Array.isArray(m?.order) ? m.order.filter(player => player !== ps) : [];
  if (typeof m?.alivePlayers === 'function') return m.alivePlayers().filter(player => player !== ps);
  return Array.isArray(m?.order) ? m.order.filter(player => player !== ps && player.alive !== false) : [];
}

function conflictsWithTeamEffect(ps, skill, rowsById) {
  const keys = new Set((skill?.buffs || []).map(buff => buff.key));
  if (keys.has('auto_chess_change_map')) {
    // The match helper is the same runtime gate used by battle/prep; scan current rows to distinguish a teammate
    // grant from the candidate player's own current row, and still work with narrow match stubs.
    const hasTeamMedic = typeof ps?.m?.teamMedicGranted !== 'function' || ps.m.teamMedicGranted();
    if (hasTeamMedic && teammates(ps, true).some(player => hasMedicalMapBuff(player, rowsById))) return true;
  }
  for (const key of TEAM_UNIQUE_EFFECT_KEYS) {
    if (keys.has(key) && teammates(ps, false).some(player => hasCurrentBuff(player, key, rowsById))) return true;
  }
  return false;
}

/**
 * Whether a candidate row still has a future automatic trigger, or another ongoing passive effect.
 * Drafts are opened after onIncome, onRoundStart and this prep's onPrepStart have run.
 * @param {any} ps
 * @param {any} band
 * @param {any} skill
 */
export function commandHasFutureEffects(ps, band, skill) {
  const buffs = Array.isArray(skill?.buffs) ? skill.buffs : [];
  if (skill?.type === 'PASSIVE' && !buffs.length) return false;
  const current = playerRound(ps);
  if (band?.bandId === 'band_damaztic') {
    const last = lastPrepRound(ps);
    return last == null || current + 4 <= last;
  }
  let onlyExpiredSchedules = true;

  for (const buff of buffs) {
    const params = buffParams(buff);
    if (FIXED_ROUND_EFFECTS.has(buff.key)) {
      if (Number.isInteger(Number(params.round)) && Number(params.round) > current) return true;
      continue;
    }

    // Action-driven or unclassified passives may still trigger after the draft; do not infer expiry from a round field.
    onlyExpiredSchedules = false;
  }
  return !onlyExpiredSchedules;
}

/**
 * Transform “变形者集群”'s five-round gifts to the selected command's acquisition-round anchor.
 * @param {any} ps
 * @param {any} band
 * @param {any} skill
 * @param {number|null|undefined} acquiredRound
 */
export function commandRuntimeSkill(ps, band, skill, acquiredRound) {
  if (band?.bandId !== 'band_damaztic' || !Number.isInteger(acquiredRound)) return skill;
  const round = playerRound(ps);
  const age = round - Math.max(1, acquiredRound) + 1;
  const source = (skill.buffs || []).find(buff => buff.key === 'preparation_start_gain_chess_from_round');
  if (!source) return skill;
  const buffs = (skill.buffs || []).filter(buff => buff.key !== 'preparation_start_gain_chess_from_round');
  if (age > 0 && age % 5 === 0)
    buffs.push({ ...source, bb: { ...(source.bb || {}), round }, bbStr: { ...(source.bbStr || {}), round } });
  return { ...skill, buffs };
}

/**
 * Current one-row-per-strategy pool, before the caller shuffles it. This helper reads state only.
 * @param {any} ps
 * @param {string|null} [currentEffectId]
 */
export function commandCandidatePool(ps, currentEffectId = ps.command?.currentEffectId) {
  const bands = Object.values(ps.gd.raw.bands || {});
  const rows = bands.flatMap(band => band.skills || []);
  const rowsById = new Map(rows.map(skill => [skill.effectId, skill]));
  const excludedBuffs = new Set(['auto_chess_effect_replace', 'gain_band_skill_from_pool_in_prep']);
  const pool = [];
  for (const band of bands) {
    const skill = commandSkillAtPlayerLevel(ps, band, rowsById);
    if (!skill || !['ACTIVE', 'PASSIVE'].includes(skill.type) || skill.effectId === currentEffectId) continue;
    if (skill.buffs?.some(buff => excludedBuffs.has(buff.key))) continue;
    if (!commandHasFutureEffects(ps, band, skill)) continue;
    if (conflictsWithTeamEffect(ps, skill, rowsById)) continue;
    pool.push(skill);
  }
  return pool;
}
