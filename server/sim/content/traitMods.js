// server/sim/content/traitMods.js — trait (特性) modifiers the ENGINE consumes for every operator (DESIGN §5, §16).
//
// WHY THIS FILE EXISTS. Several modules add a line to the operator's TRAIT, and the official tables split that line in
// two: `battle_equip_table` `overrideTraitDataBundle.candidates[].blackboard` carries the NUMBER
// (`{key:'attack_speed', value:12}`) while the CONDITION exists only in the candidate's sentence
// (`additionalDescription` / `overrideDescripton` → data/chess.json `trait.moduleDesc` / `trait.desc`). build-data.mjs
// (`applyModuleTraitParts`) folds that blackboard into `trait.bb` unconditionally, so the number reached
// `resolveProfile` (professions.js:655; 665 spreads `def.traitBb` into the profile) and stopped there: no sim file read
// `profile.attack_speed` (every other reader of an `attack_speed` blackboard — bonds, devices, enemies — maps it to
// `mods.aspd` itself), and a module reading 「攻击范围内存在2名及以上敌人时攻击速度+12」 therefore did nothing at all.
//
// THE RULE (engine-level, no operator-id whitelist). Any operator whose resolved def carries `attack_speed` on a
// trait-level blackboard AND whose own trait text states a condition this file can evaluate gets that stat while — and
// only while — the condition holds. The condition is read from the clause the official sentence puts BEFORE 「攻击速度」.
//
// THIS FILE EVALUATES EXACTLY ONE CONDITION SHAPE, on purpose:
//   「攻击范围内存在N名及以上敌人时」 — the REA-Y module line (圣约送葬人 chess_char_5_01_b +12, 隐德来希
//   chess_char_5_06_b +12). It is the shape the engine was missing, and its state is a pure function of the battlefield
//   (the engine's own targeting), so it needs nothing from a kit.
// A condition this file does not evaluate installs NOTHING — never a permanently-on stat. `traitAttackSpeedRule(def)`
// reports what it found (`clause`, `value`, `condition`, `reason`) so callers and tests can see the decision.
//
// WHY NOT MORE — the other trait attack-speed lines already have a hand-written implementation in the owning kit, and
// adding a generic rule for them would apply the same stat TWICE. Each is listed here with where it lives (one kit file
// per operator since 0.2.0, `kits/ops/<chessId>-<codename>.js`):
//   被击倒时不撤退…攻击速度+30（单次部署只触发1次）  斯卡蒂 chess_char_3_05_b (DRE-Y)   → ops/chess_char_3_05-skadi.js
//                                                    耀骑士临光 6_17_b (DRE-Y) 同理 → ops/chess_char_6_17-nearl2.js
//   未阻挡敌人时攻击速度+8                            史尔特尔 5_07_b (AFT-X)         → ops/chess_char_5_07-surtr.js
//   未阻挡敌人时攻击速度+8                            维娜·维多利亚 6_07_b (AFT-X)    → ops/chess_char_6_07-siege2.js
//   不阻挡敌人时…攻击速度+10                          号角 5_08_b (FOR-Y)             → ops/chess_char_5_08-horn.js
//   能够阻挡一个敌人，生命值高于50%时攻击速度+10      山 5_17_b (FGT-Y)               → ops/chess_char_5_17-f12yin.js
//   范围内存在地面敌人时攻击速度+8                    空弦 3_21_b (MAR-Y)             → shared/tier3.js groundAspd
//                                                    能天使 3_01_b (MAR-Y) 同理      → ops/chess_char_3_01-angel.js
//   攻击范围内存在受到元素损伤的友方单位时攻击速度+8  纯烬艾雅法拉 6_20_b (WDM-Y)     → ops/chess_char_6_20-agoat2.js
// Generalising one of those means deleting the kit implementation in the same change; until then this file refuses them
// (`condition: null`), which is also what keeps them bit-for-bit unchanged.
//
// Two more boundaries found by scanning every record × every module choice (the scan is pinned by
// test/sim/trait_attack_speed.test.js):
//   * 仇白 (chess_char_6_15_b) LOR-Y states the same 「攻击范围内存在2名及以上敌人时攻击速度+12」, but its build-data
//     candidate targets a NAMED talent, so the number lands in `talents[i]` and never on a trait-level blackboard — her
//     kit reads exactly that. This file therefore does not see the line at all, which is the right outcome: applying it
//     here as well would double it.
//   * A module that ALREADY wanted its line applied here can carry the number on a hidden talent (index −1) instead
//     of the trait blackboard — 圣约送葬人 REA-Y does (`uniequip_003_excu2` `talentChanges[0].bb.attack_speed`), while
//     隐德来希 REA-Y carries it straight on `trait.bb`. Both routes are read (see `attackSpeedSources`).
//
// Tests: test/sim/trait_attack_speed.test.js.
// This change is the v0.2.0 redo of the v0.1.4 work (commit 6946d9f), where the same rule lived in
// server/sim/content/traitMods.js and was wired from Battle._setupUnit — 0.2.0 split that method into
// server/sim/battle/players.js (see the wiring note there).

/** Finite number or `d` (blackboard values may be strings). Kept local: this file is imported by the engine itself
 *  (battle/players.js), so it must not pull a kit file into the static import graph — the kits load through guarded
 *  dynamic imports (content/kits/index.js) precisely so a broken kit degrades instead of breaking the server. */
const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

/** Trait blackboard of a raw chess record (`chess.trait.bb`, the module's lines folded in by build-data.mjs). */
const traitBb = (chess) => (chess && typeof chess.trait === 'object' && chess.trait ? chess.trait.bb ?? {} : {});

/**
 * The condition shapes this file evaluates, in match order. Each takes the clause before 「攻击速度」 and returns
 * `(battle, unit) => boolean`, or null when the clause is not that shape.
 */
const CONDITIONS = [
  /**
   * 「攻击范围内存在N名及以上敌人时」 (modules REA-Y). N is read from the SENTENCE and defaults to 2: the official
   * module's own blackboard does carry the same count (`trigger_cnt[equip]` / `cnt` = 2 on the two REA-Y records), but
   * the number that decides what the TEXT promises has to come from the text — a blackboard count is a kit-side
   * implementation detail (records carry `cnt` / `trigger_cnt[equip]` for other talents too). Reading it here instead
   * would make this file's decision depend on the module's internal layout.
   * Counted through the engine's own targeting — `battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile)`: the unit's
   * live range keys (a skill that widens the range widens this too) and its own profile, so 隐匿 / 不可选中 / 飞行 follow
   * the operator's real attack rules. That is the call the two REA-Y kits used before this file took the line over
   * (shared/tier5.js `crowdAspd`, deleted in the same change so the stat is counted once).
   */
  function crowdInRange(clause) {
    if (!/攻击范围内(?:存在|有)/.test(clause)) return null;
    if (!/敌人/.test(clause)) return null;   // excludes 「…存在受到元素损伤的友方单位时」
    const m = clause.match(/存在\s*(\d+)\s*名/);
    const need = m ? Math.max(1, +m[1]) : 2;
    return (battle, unit) => battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile).length >= need;
  },
];

/**
 * Trait attack-speed conditions a hand-written kit already owns (documented above; refused here, never applied).
 * Every entry is one that a real record in data/chess.json hits — the closed list is checked against the shipped data
 * by test/sim/trait_attack_speed.test.js, so a new record that carries one of these lands in 'kit', and anything else
 * lands in 'unknown' (nothing installed either way; both are inert, the difference is only in the report).
 */
const KIT_OWNED = [
  /被击倒时不撤退/,                    // DRE-Y — 斯卡蒂 3_05_b / 耀骑士临光 6_17_b
  /未阻挡敌人时/,                      // AFT-X — 史尔特尔 5_07_b / 维娜·维多利亚 6_07_b
  /不阻挡敌人时/,                      // FOR-Y — 号角 5_08_b
  /生命值高于\s*\d+(?:\.\d+)?\s*%/,    // FGT-Y — 山 5_17_b
  /存在地面敌人/,                      // MAR-Y — 空弦 3_21_b / 能天使 3_01_b (shared/tier3.js groundAspd)
  /受到元素损伤的友方单位/,            // WDM-Y — 纯烬艾雅法拉 6_20_b
];

/**
 * Lines that only ever apply in another game mode — 集成战略 (ISW modules, e.g. 水月 ISW-A `attack_speed: 50`). This
 * mode is 卫戍协议, and the rest of the repo already ignores their mode-gated halves (shared/loadoutRecord.js
 * `traitRangeExtend` skips 空弦 ISW-A for exactly this reason), so they are refused here too.
 */
const MODE_SPECIFIC = [/在集成战略中/];

/** The buff key the engine rule installs (one per operator; `refresh:'keep'` so a check never extends its duration). */
export const TRAIT_ASPD_BUFF = 'trait:attack_speed';

/** Strip the official inline markup (`<@ba.vup>+12</>`, `<$ba.dt.element>元素损伤</>`) from a trait sentence. */
export const plainText = (s) => String(s ?? '').replace(/<[^>]*>/g, '');

/**
 * The clause a trait sentence puts before its LAST 「攻击速度」 mention — the condition. '' when the sentence has no
 * 「攻击速度」 at all (e.g. 圣约送葬人's REA-Y record, whose own trait sentence is about the reaper self-heal), or when
 * the attack-speed part comes first and is unconditional (「攻击速度+18，攻击力+3%」 → clause '', since nothing
 * precedes it).
 */
export function conditionClause(text) {
  const s = plainText(text);
  const i = s.lastIndexOf('攻击速度');
  return i <= 0 ? '' : s.slice(0, i).trim();
}

/** The trait/statement texts of `def` a condition may be read from, most specific (the module's added line) first. */
function traitClauses(def) {
  const raw = def?.raw ?? {};
  const t = raw.trait && typeof raw.trait === 'object' ? raw.trait : {};
  const out = [];
  for (const s of [t.moduleDescRaw, t.moduleDesc, t.descRaw, t.desc, typeof raw.trait === 'string' ? raw.trait : null]) {
    const p = plainText(s).trim();
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * The blackboards of `def` a trait-level attack-speed line may live on, most authoritative first: the trait blackboard
 * (the module line build-data folds in — 隐德来希 REA-Y), then the hidden module talents (data index −1) — the route
 * 圣约送葬人 REA-Y and the MAR-Y / WDM-Y lines above take. A line merged into a NAMED talent is deliberately not read
 * here (仇白 LOR-Y: her kit owns it).
 */
function attackSpeedSources(def) {
  const out = [];
  const tb = traitBb(def?.raw ?? {});
  if (Number.isFinite(tb.attack_speed)) out.push(tb);
  const talents = def?.raw?.talents;
  if (Array.isArray(talents)) {
    for (const t of talents) {
      if (!t || t.index !== -1 || !t.bb || !Number.isFinite(t.bb.attack_speed)) continue;
      if (!out.includes(t.bb)) out.push(t.bb);
    }
  }
  return out;
}

/**
 * The trait attack-speed line of `def` as the engine will apply it.
 * @param {object} def normalised unit def (sim/simdata.js)
 * @returns {{value:number, condition:((battle:object, unit:object)=>boolean)|null, clause:string,
 *            source:string|null, reason:string}|null}
 *   null = this def has no trait attack-speed line at all.
 *   `condition !== null` = the engine applies `value` while it holds.
 *   `condition === null` = nothing is installed; `reason` says why: 'kit' (a hand-written kit owns the condition),
 *   'mode' (the line only applies in 集成战略), 'unknown' (a clause shape this file does not know), 'no-text' (the data
 *   build dropped the sentence).
 */
export function traitAttackSpeedRule(def) {
  const sources = attackSpeedSources(def);
  if (!sources.length) return null;
  const value = num(sources[0].attack_speed);
  if (!value) return null;
  for (const text of traitClauses(def)) {
    const clause = conditionClause(text);
    if (!clause) continue;
    for (const match of CONDITIONS) {
      const condition = match(clause);
      if (condition) return { value, condition, clause, source: text, reason: 'ok' };
    }
    if (MODE_SPECIFIC.some((re) => re.test(clause))) return { value, condition: null, clause, source: text, reason: 'mode' };
    if (KIT_OWNED.some((re) => re.test(clause))) return { value, condition: null, clause, source: text, reason: 'kit' };
    return { value, condition: null, clause, source: text, reason: 'unknown' };
  }
  return { value, condition: null, clause: '', source: null, reason: 'no-text' };
}

/**
 * Apply a def's trait attack-speed line to an operator: the stat is on exactly while its condition holds. Called once
 * per operator from `BattlePlayers._setupUnit` (after `kit.install`). Evaluated on the engine's `tick` hook (one step =
 * constants.TICK) so entering / leaving the condition changes the real attack cadence — ai.js `updateAlly` sets
 * `u.atkCd = u.s.interval`, and `unit.s.interval = bat × 100 / aspd` (units.js). The buff is `refresh:'keep'` — a
 * re-check can never extend or blank the stat, and the engine drops non-`persist` buffs on death, while the
 * `deploy` / `battleStart` checks put it back on the next deployment.
 * @param {object} battle
 * @param {object} unit
 * @returns {object|null} the rule it resolved (`condition: null` when it installed nothing), or null without a line
 */
export function installTraitAttackSpeed(battle, unit) {
  if (!unit || unit.kind !== 'op' || unit._traitAspdInstalled) return null;
  let rule = null;
  try { rule = traitAttackSpeedRule(unit.def); } catch { rule = null; }
  if (!rule || !rule.condition) return rule;
  unit._traitAspdInstalled = true;
  const mods = { aspd: rule.value };
  const check = () => {
    const want = !!unit.alive && !!unit.deployed && rule.condition(battle, unit);
    const has = !!unit.findBuff(TRAIT_ASPD_BUFF);
    if (want && !has) battle.addBuff(unit, { key: TRAIT_ASPD_BUFF, mods, refresh: 'keep', tags: ['trait'] });
    else if (!want && has) battle.removeBuff(unit, TRAIT_ASPD_BUFF);
  };
  battle.on('tick', check, { owner: unit });
  battle.on('battleStart', check, { owner: unit });
  battle.on('deploy', (ctx) => { if (ctx.unit === unit) check(); }, { owner: unit });
  return rule;
}
