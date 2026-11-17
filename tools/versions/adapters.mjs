// tools/versions/adapters.mjs — field adapters for an older activity_table (docs/DATA.md "Official versions (M0)"): pure
// functions that rewrite a loaded season section in place into the shape tools/build-data.mjs reads (the 下半 schema),
// or into the state of the sub-version a profile builds.
// tools/build-data.mjs applies a profile's `adapters` right after it finds the season section, never for the default
// profile. Each one throws on a shape it does not know, so a new table cannot pass through half-converted.
//
//   bondActiveType    上半's bondInfoDict activates by `activeType` (BATTLE / ALL / MANI) + `isActiveInDeck`; 下半 by
//                     `activeCondition` + `activeConditionTemplate` + `activeParamList` + `maxInactiveBondCount`. The three
//                     上半 shapes map to what 下半 writes for the same bonds (checked on 21b1f240 / 8303c922 against
//                     86da4cfa): ALL + deck (投资人, 远见, 奇迹) → BOARD_AND_DECK; BATTLE → BOARD; MANI (调和, maniShip) →
//                     BOARD; every one count_threshold_upward on [activeCount], maxInactiveBondCount −1.
//   selfBackupPreset  a NORMAL shop row that backs itself up (backupCharId = charId) is a PRESET: 下半 marks it so, and
//                     like every PRESET row of both halves its backup carries the default skill and module (上半 left the
//                     module out). In 上半 only chess_char_1_15 (盟约·辅助干员, hidden, granted by 优等生) qualifies; 下半's
//                     row reads PRESET with backupCharUniEquipId uniequip_002_pithst. [ASSUMED]
//   launchModes       the modes open at the season's launch: a launch-state table (下半 V2_1 @1457587e) already lists the
//                     终极 modes mode_single_abyss / mode_multi_abyss, with startTime 1774598400 (2026-03-27 16:00, the
//                     start of V2_2 in autoChessData.versionInfoDict; PRTS 卫戍协议：盟约 下半, 3-27: 终极模拟开放). Every mode
//                     whose startTime is later than the earliest mode's leaves modeDataDict and battleDataDict, and the
//                     stages' mode lists. A mode without a numeric startTime throws.
//   launchMilestones  the 功勋 levels open at the season's launch: milestoneList lists all 60 levels in both seasons'
//                     launch tables, and levels 36–60 carry the availableTime of the second sub-version (1764057600 =
//                     2025-11-25 16:00 at 8303c922 / ea164ef7, V1_2; 1774598400 = 2026-03-27 16:00 at 1457587e, V2_2).
//                     Every level whose availableTime is later than the earliest level's leaves milestoneList, so the
//                     settlement's LV strip (config.rewards.milestones) stops at 35. A level without a numeric
//                     availableTime throws.

/** activeType (+ isActiveInDeck) → 下半's activeCondition. */
const ACTIVE_CONDITION = Object.freeze({ 'ALL+deck': 'BOARD_AND_DECK', BATTLE: 'BOARD', MANI: 'BOARD' });

/**
 * @param {{ bondInfoDict: Record<string, any> }} act the season section (activity.AUTOCHESS_SEASON[season])
 */
export function bondActiveType(act) {
  for (const [id, b] of Object.entries(act.bondInfoDict || {})) {
    if (b.activeCondition !== undefined) continue;
    const key = b.activeType === 'ALL' && b.isActiveInDeck === true ? 'ALL+deck'
      : b.isActiveInDeck === false && b.activeType !== 'ALL' ? b.activeType : null;
    const cond = key && ACTIVE_CONDITION[key];
    if (!cond || !Number.isInteger(b.activeCount) || b.activeCount < 1) {
      throw new Error(`adapter bondActiveType: bond ${id} has an unknown shape (activeType ${b.activeType}, isActiveInDeck ${b.isActiveInDeck}, activeCount ${b.activeCount})`);
    }
    b.activeCondition = cond;
    b.activeConditionTemplate = 'count_threshold_upward';
    b.activeParamList = [String(b.activeCount)];
    b.maxInactiveBondCount = -1;
  }
}

/**
 * @param {{ charShopChessDatas: Record<string, any> }} act
 */
export function selfBackupPreset(act) {
  for (const [id, s] of Object.entries(act.charShopChessDatas || {})) {
    if (!s || typeof s.chessType !== 'string') throw new Error(`adapter selfBackupPreset: shop row ${id} has no chessType`);
    if (s.chessType !== 'NORMAL' || !s.charId || s.backupCharId !== s.charId) continue;
    s.chessType = 'PRESET';
    s.backupCharSkillIndex = s.defaultSkillIndex ?? 0;
    s.backupCharUniEquipId = s.defaultUniEquipId ?? null;
  }
}

/**
 * @param {{ modeDataDict: Record<string, any>, battleDataDict: Record<string, any>, stageDatasDict: Record<string, any> }} act
 */
export function launchModes(act) {
  const modes = Object.entries(act.modeDataDict || {});
  for (const [id, m] of modes) if (!Number.isFinite(m?.startTime)) throw new Error(`adapter launchModes: mode ${id} has no startTime`);
  if (!modes.length) throw new Error('adapter launchModes: no modes');
  const launch = Math.min(...modes.map(([, m]) => m.startTime));
  const later = new Set(modes.filter(([, m]) => m.startTime > launch).map(([id]) => id));
  for (const id of later) {
    delete act.modeDataDict[id];
    delete act.battleDataDict?.[id];
  }
  for (const sd of Object.values(act.stageDatasDict || {})) if (Array.isArray(sd?.mode)) sd.mode = sd.mode.filter((id) => !later.has(id));
}

/**
 * @param {{ milestoneList: any[] | Record<string, any> }} act
 */
export function launchMilestones(act) {
  const list = Array.isArray(act.milestoneList) ? act.milestoneList : Object.values(act.milestoneList || {});
  for (const m of list) if (!Number.isFinite(m?.availableTime)) throw new Error(`adapter launchMilestones: level ${m?.milestoneLvl} has no availableTime`);
  if (!list.length) throw new Error('adapter launchMilestones: no levels');
  const launch = Math.min(...list.map((m) => m.availableTime));
  if (Array.isArray(act.milestoneList)) act.milestoneList = list.filter((m) => m.availableTime <= launch);
  else for (const [k, m] of Object.entries(act.milestoneList)) if (m.availableTime > launch) delete act.milestoneList[k];
}

/** Every adapter by the name a profile lists. */
export const ADAPTERS = Object.freeze({ bondActiveType, selfBackupPreset, launchModes, launchMilestones });

/**
 * Apply a profile's adapters, in order, to the season section.
 * @param {object} act
 * @param {readonly string[]} names
 */
export function applyAdapters(act, names) {
  for (const name of names) {
    const fn = ADAPTERS[name];
    if (!fn) throw new Error(`unknown adapter ${name} (known: ${Object.keys(ADAPTERS).join(', ')})`);
    fn(act);
  }
}
