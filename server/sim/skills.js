// server/sim/skills.js — skill runtime: SP, charges, trigger rules, kinds, SkillSpec interpretation (DESIGN §5.6).
//
// SP types: 'time' (+spRecovery/s), 'attack' (+1 per attack), 'hurt' (+1 per hit taken), 'none'.
// No SP gain while a duration/ammo/toggle skill is active, or while the unit has the noSp flag (阻回: no SP gain of any
// kind — time, attack, hurt or granted). A stunned / frozen / levitated unit (canAct false) neither attacks nor casts, but
// its time SP keeps recovering (PRTS: only 阻回 pauses the SP cooldown; 晕眩 does not — community report #18).
// Charges (maxCharges > 1): SP fills to spCost → +1 charge (SP restarts) until charges == max (SP stays full).
// Trigger rules (the official 技能策略, PRTS 卫戍协议/帮助 §作战阶段 技能操作; data: tools/build-data.mjs resolveTrigger):
//   DEFAULT — the basic strategy: ready + about to attack/heal + enemy / injured ally in the INITIAL range (or blocked by
//   a melee unit) — or, checked every tick, an enemy inside one of the content trigger ranges added with
//   addTriggerRange: 海嗣, 流形, 谬因 S2's beam, the summons' areas a skill acts through (麦哲伦 S1, 令 S3, 电弧 S2 / S3 —
//   the owner's larger-range rule, 2026-10-06: kits/shared/summoner.js summonTriggerArea);
//   SKILL_RANGE — a MANUAL skill with a 技能范围 of its own: "不通过普通攻击/治疗触发技能，仅在技能范围内存在敌人（无视其
//   不可选中）时释放技能": any living enemy on the trigger grid (the skill range; stealthed / untargetable / flying ones
//   too), checked every tick, no attack needed. Kit option `trigger.allies` (+ `hpAtMost`, default 1): a healable,
//   injured ally of the grid whose HP ratio is at most that instead (an AUTO heal skill's own rule — 古米 S1 waits in
//   its heal mode until it has healed);
//   ACTIVE_RANGE — the owner's rule (2026-10-05, a deliberate deviation): a MANUAL skill on the basic strategy (深巡 S2's
//   DEFAULT deviation included) or on the SEARCH row (薄绿 S1, 玛恩纳 S2, 安洁莉娜 S3 …) whose attack range while it runs
//   strictly contains the unit's own range checks the DEFAULT condition on that larger range (trigger grid = the running
//   range, grown by the unit's permanent rangeExtend unless the skill ignores 攻击距离), every tick, no attack needed —
//   an enemy the unit can target there (or one it blocks), a heal skill an injured ally;
//   TAKE_DAMAGE (ready + just took a hit: 重装 "不受技能范围影响，受到伤害时释放技能"), SP_FULL/ALWAYS (as soon as ready),
//   CUSTOM_RANGE (enemy inside the custom trigger grid), SEARCH (an enemy inside the INITIAL range, checked every tick
//   without waiting for an attack: "不受基础策略影响，在初始攻击范围内存在敌人时释放技能" — not any enemy on the field,
//   which burnt the skill on enemies that had just spawned), GDGLOW_SKILL_2 ("全场存在可选目标时释放技能": a targetable
//   enemy anywhere on the field — for a heal skill an ally that needs healing — every tick), NEVER/MANUAL (never
//   auto-cast: the kit calls skill.activate() itself); any unknown rule falls back to DEFAULT. Units that never attack
//   (noAttack profiles) evaluate DEFAULT every tick instead. DEFAULT with `trigger.allies` (+ `hpAtMost`): the basic
//   rule AND such an ally on the trigger grid — the cast replaces the attack about to be made (塞雷娅 S1 "触发时会替换当
//   次攻击"); should that ally condition fail before the attack, the cast is withdrawn and its charge returned.
//   A registered ally target (Battle.setAllyTarget: 白铁's 铁钳号·原型机, an enemy-camp summon our attacks select) counts
//   like an enemy in each of these enemy conditions for a skill that acts on it (`_allyTargetIn`, `allyTargetsOk` — the
//   owner's rule of 2026-10-08): one that acts through the unit's own attacks, or whose kit flags `allyTargets: true` (its
//   selectors take ally targets too); a skill that picks its own victims among enemies only is not opened by it.
// Automatic operations cool down (constants.js AUTO_OP_COOLDOWN, "自动操作具有3s冷却，在完成一次操作或作战开始时部署的单位
//   将进入冷却"): the engine auto-casts a MANUAL skill (def.skillType) no sooner than 3 s after its previous cast (so a
//   charged skill spends its charges 3 s apart) or after the unit's deployment at the battle start (Battle._deploy
//   `initial`). AUTO skills are exempt; a kit with its own automatic cast checks `opCooling`; a cast made by activate()
//   directly is not held back (it still starts the cooldown). While a cast "next attack" waits for its attack, no
//   further charge is cast.
// Kinds: duration (mods for `duration` s), ammo (mods until `ammo` attacks were made; optional duration cap),
//   instant (onStart + optional one-shot attack override for the next attack), charges (= instant with charges),
//   passive (always on from deployment, no SP), toggle (stays on until death once activated).
// SkillSpec fields (all optional): kind, duration, ammo, spCost, initSp, charges, spType, trigger,
//   mods, flags, targeting {maxTargets, rangeGrid, priority, allInRange, rangeExtend, noRangeExtend (the range ignores
//   the unit's 攻击距离), showOwnRange (rangeGrid only selects targets: the detail card keeps the unit's own range)},
//   attack {dmgType, atkScale, splashRadius, splashScale, hits, projectile, maxTargets, dmgMul, onHit, heal…},
//   heal (bool: heal-type skill for the trigger rule), allyTargets (bool: the skill acts on a registered ally target — see
//   `allyTargetsOk`), onStart(ctx), onEnd(ctx), onHit(ctx), onAttack(ctx), onTick(ctx).
// ctx passed to spec callbacks: { battle, unit, skill, bb, target?, dealt?, targets?, dt?, reason? }; onAttack's ctx
//   also carries `noAmmo` (set it to true: this attack spends no ammo). onEnd runs while the skill's mods / range are
//   still applied (`active` is already false); they are removed right after it (unless onEnd re-activated the skill).

import { absoluteRangeKeys, canTargetEnemy } from './targeting.js';
import { AUTO_OP_COOLDOWN, COLS, ROWS } from './constants.js';

const TICK_RULES = new Set(['SP_FULL', 'SEARCH', 'CUSTOM_RANGE', 'SKILL_RANGE', 'ACTIVE_RANGE', 'GDGLOW_SKILL_2']);
/** True when a SkillSpec `targeting` changes the unit's range while the skill runs (Battle._refreshRange). */
const changesRange = (tg) => !!(tg && (tg.rangeGrid || tg.rangeExtend || tg.noRangeExtend));
/** Enemies that satisfy a content trigger range (any targetable enemy, flyers included). */
const TRIGGER_PROFILE = Object.freeze({ canHitFly: true });
/** Every tile of the stage (GDGLOW_SKILL_2: the whole field). */
const ALL_TILES = new Set(Array.from({ length: ROWS * COLS }, (_, i) => i));

/**
 * The 'skill' animation window the sim reports to the client: `unit.skillAnimUntil` (snapshot.js `animOf` → ANIM.SKILL,
 * and the `['skill', id, 1]` / `0` events). An instant cast and a deploy-time passive both use it.
 */
const SKILL_ANIM_WINDOW = 0.5;

export class SkillRuntime {
  /**
   * @param {object} battle
   * @param {object} unit
   * @param {object|null} def normalised skill def (data)
   * @param {object|null} spec SkillSpec from the kit
   * @param {object} bb blackboard
   */
  constructor(battle, unit, def, spec, bb = {}) {
    Object.defineProperty(this, 'battle', { value: battle, writable: true, enumerable: false });
    Object.defineProperty(this, 'unit', { value: unit, writable: true, enumerable: false });
    this.def = def || {};
    this.spec = spec || {};
    this.bb = bb;
    const s = this.spec;
    const d = this.def;
    this.id = s.id ?? d.id ?? 'skill';
    this.name = s.name ?? d.name ?? '';
    this.kind = s.kind ?? 'instant';
    this.duration = Number.isFinite(+s.duration) ? +s.duration : (d.duration > 0 ? d.duration : 0);
    this.ammo = Math.max(0, Math.floor(+s.ammo || 0));
    this.baseSpCost = Math.max(0, Number.isFinite(+s.spCost) ? +s.spCost : (d.spCost ?? 0));
    this.initSp = Math.max(0, Number.isFinite(+s.initSp) ? +s.initSp : (d.initSp ?? 0));
    this.maxCharges = Math.max(1, Math.floor(s.charges ?? d.maxCharges ?? 1));
    this.spType = s.spType ?? d.spType ?? 'time';
    const trig = typeof s.trigger === 'string' ? { rule: s.trigger } : (s.trigger || d.trigger || {});
    this.rule = String(trig.rule ?? 'DEFAULT').toUpperCase();
    if (this.rule === 'ALWAYS') this.rule = 'SP_FULL';
    if (this.rule === 'MANUAL') this.rule = 'NEVER';
    if (this.rule.startsWith('CUSTOM_RANGE')) this.rule = 'CUSTOM_RANGE';
    this.triggerGrid = trig.grid ?? trig.rangeGrid ?? d.trigger?.grid ?? null;
    // kit options: an injured, healable ally of the trigger grid with an HP ratio of at most `hpAtMost` (SKILL_RANGE:
    // instead of an enemy; DEFAULT: a heal target at the normal attack cadence)
    this.triggerAllies = !!trig.allies;
    this.triggerEnemies = !!trig.enemies; // mixed attack/heal skills may also open for a selectable enemy
    this.triggerHpAtMost = Number.isFinite(+trig.hpAtMost) && +trig.hpAtMost > 0 ? +trig.hpAtMost : 1;
    this.healSkill = s.heal ?? (unit.profile && unit.profile.dmgType === 'heal' && !!unit.profile.heal);
    // the official skill strategies automate the manual 开启: only MANUAL skills wait for the operation cooldown
    this.manual = String(d.skillType ?? 'MANUAL').toUpperCase() === 'MANUAL';
    this.opReadyAt = -Infinity;   // no automatic cast before this battle time (AUTO_OP_COOLDOWN)
    this.nextCastAt = -Infinity;  // instant / charges with no attack of its own: no cast from the tick before (GitHub #298)
    if (this.kind === 'passive') this.baseSpCost = 0;
    this._spCostMul = 1;          // content may set spCostMul (e.g. 绝技 ×0.7) — see the accessor below
    this.sp = 0;
    this.charges = 0;
    this.active = false;
    this.timeLeft = 0;
    this.ammoLeft = 0;
    this.ammoMax = 0;             // ammo kind: the most bullets this activation held (snapshot's draining bar)
    this.pending = false;         // instant/charges: next attack uses spec.attack
    this.activations = 0;
    this.lastStart = -Infinity;
    this._buffKey = `skill:${unit.id}`;
    this._trigKeys = null;
    this._trigSet = null;
    this.triggerRanges = [];      // content trigger ranges (addTriggerRange)
    this.attackTriggerRanges = new Set(); // special targeting checked only at the next attack
    this.noSkill = !spec;         // unit without any skill spec
  }

  /**
   * Change the trigger rule and grid mid-battle — a kit whose skill's running range changes with its own use (薇薇安娜 S3:
   * "首次技能结束后，本技能的技能范围永久扩大至3-2" — ACTIVE_RANGE on 3-2 from then, DEFAULT again at her next deployment).
   * `grid`: a facing-RIGHT [dRow, dCol] grid (ACTIVE_RANGE / SKILL_RANGE / CUSTOM_RANGE), or null. (0.2.0 WE2, additive.)
   * @param {string} rule @param {number[][]|null} [grid]
   */
  setTrigger(rule, grid = null) {
    this.rule = String(rule ?? 'DEFAULT').toUpperCase();
    this.triggerGrid = Array.isArray(grid) && grid.length ? grid : null;
    this._trigKeys = null;
    this._trigSet = null;
  }

  /**
   * Extra DEFAULT-trigger range (海嗣 "攻击范围视为自身攻击范围的延伸", 流形): `fn(battle, unit)` returns a list whose
   * entries are ally units (their current `rangeKeys` count while they are on the field), arrays of absolute tile
   * keys, or `{ keys, profile }` — tile keys with the enemy profile the effect selects by (`canHitFly` false: ground
   * enemies only — the owner's larger-range rule through a summon's area, kits/shared/summoner.js summonTriggerArea;
   * 0.2.0 WV, additive). A targetable enemy (flyers included unless the entry's profile says otherwise) on those tiles
   * satisfies the DEFAULT rule (and unknown DEFAULT-like rules). Summon effect areas are checked every tick;
   * { attackOnly: true } is for special targeting that must wait for the next attack (蕾缪安, 死芒).
   * Returns an unregister fn.
   */
  addTriggerRange(fn, { attackOnly = false } = {}) {
    if (typeof fn !== 'function') return () => {};
    this.triggerRanges.push(fn);
    if (attackOnly) this.attackTriggerRanges.add(fn);
    return () => { this.attackTriggerRanges.delete(fn); const i = this.triggerRanges.indexOf(fn); if (i >= 0) this.triggerRanges.splice(i, 1); };
  }

  /** An enemy inside one of the content trigger ranges. */
  _extraTriggerSatisfied(allowAttackOnly = true) {
    const b = this.battle;
    const u = this.unit;
    for (const fn of this.triggerRanges) {
      if (!allowAttackOnly && this.attackTriggerRanges.has(fn)) continue;
      const list = b._safe(() => fn(b, u), 'skill.triggerRange', u);
      if (!list || typeof list[Symbol.iterator] !== 'function') continue;
      for (const x of list) {
        let keys = null, prof = TRIGGER_PROFILE;
        if (Array.isArray(x)) keys = x;
        else if (x && typeof x === 'object' && x.side === 'ally' && x.alive && x.deployed && !x.hidden) keys = x.rangeKeys;
        else if (x && typeof x === 'object' && Array.isArray(x.keys)) { keys = x.keys; if (x.profile) prof = x.profile; }
        if (keys && keys.length && (b.enemiesInKeys(keys, u, prof).length || this._allyTargetIn(keys))) return true;
      }
    }
    return false;
  }

  /**
   * A registered ally target (Battle.setAllyTarget: 白铁's 铁钳号·原型机, a summon of the enemy camp our attacks select) on
   * `keys` (tile keys or a Set): a non-heal skill's automatic start counts it like an enemy — the owner's rule of
   * 2026-10-08 (a community report and their recall of the official mode: 干员攻击范围/技能范围内有白铁的装置时技能也自动开、自动
   * 消耗，装置对干员的仇恨类似敌方单位; PRTS 铁钳号·原型机 备注 "该召唤物阵营为敌方"). It stays out of enemiesInKeys /
   * canTargetEnemy (every other selector keeps to enemies); a heal skill never counts it (禁疗: not a patient).
   */
  _allyTargetIn(keys) {
    if (!keys || !this.allyTargetsOk) return false;
    const b = this.battle;
    return !!(b._allyTargets && b._allyTargets.size) && b.allyTargetsInKeys(keys, this.unit).length > 0;
  }

  /**
   * Does this skill act on a registered ally target, so that one may start it (`_allyTargetIn`)? Never a heal skill.
   * SkillSpec `allyTargets` (true / false) answers for a kit: true where its selectors take ally targets too
   * (allyTargetsInKeys / allyTargetsInRadius — 蕾缪安 S3, 艾丽妮 S3, 陈 S2, 引星棘刺 S2), false where they never do although
   * the skill keeps attacking. Without it: a skill that acts through the unit's own attacks — which select the device
   * (ai.js acquireTargets) —, a timed one that keeps attacking (no `attack.noAttack`) or a cast that is the next attack
   * (`spec.attack`), on a unit that attacks. [ASSUMED] Any other skill picks its victims itself among the enemies
   * (enemiesInKeys, foesInRadius …) and would be spent on nothing: the device does not open it — it waits for an enemy.
   * (Grok's review of round 22: 蕾缪安 S3 / 艾丽妮 S3 / 陈 S2 / 引星棘刺 S2 opened on the device alone and did nothing.)
   */
  get allyTargetsOk() {
    if (this.healSkill || this.noSkill || this.kind === 'passive') return false;
    const s = this.spec;
    if (s.allyTargets != null) return !!s.allyTargets;
    const p = this.unit.profile;
    if (p && p.noAttack) return false;
    if (s.attack && s.attack.noAttack) return false;
    return this.isTimed || !!s.attack;
  }

  get spCost() {
    const c = Math.floor(this.baseSpCost * this.spCostMul + (this.unit.s ? this.unit.s.spCostFlat : 0));
    // content writes spCostMul / spCostFlat: a NaN/Infinity cost would freeze SP forever — use the base cost instead
    return Number.isFinite(c) ? Math.max(0, c) : this.baseSpCost;
  }

  /** SP cost multiplier (content-writable). Invalid values count as 1; SP/charges are re-normalised immediately. */
  get spCostMul() { return this._spCostMul; }
  set spCostMul(v) {
    this._spCostMul = typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 1;
    if (this.unit) this._normalize();
  }

  get ready() { return !this.noSkill && this.kind !== 'passive' && this.charges >= 1; }

  get isTimed() { return this.kind === 'duration' || this.kind === 'ammo' || this.kind === 'toggle'; }

  _ctx(extra) { return { battle: this.battle, unit: this.unit, skill: this, bb: this.bb, ...extra }; }

  _call(fnName, extra) {
    const fn = this.spec[fnName];
    if (typeof fn !== 'function') return undefined;
    return this.battle._safe(() => fn(this._ctx(extra)), `skill.${fnName}`, this.unit);
  }

  /**
   * The official 技力 (PRTS 技能: "可充能X次…当前技力上限等于该技能技力需求的X倍"): the stored charges × cost plus the SP
   * towards the next one — what 联防 carries (BattleResult unitsEnd `sp`; reset rebuilds the charges from it).
   */
  get spTotal() {
    if (this.noSkill || this.kind === 'passive') return 0;
    const cost = this.spCost;
    return this.charges >= this.maxCharges ? this.maxCharges * cost : this.charges * cost + this.sp;
  }

  /**
   * Set the official 技力 to `total` (charges rebuilt, nothing fired — a 修改, not a gain): the 联防 carry, applied again
   * once the deployment is done (Battle._deploy). A passive skill, or a timed one that runs already, is left as it is.
   */
  setSpTotal(total) {
    if (this.noSkill || this.kind === 'passive' || (this.active && this.isTimed) || !Number.isFinite(total)) return;
    this.sp = 0;
    this.charges = 0;
    this.gainSp(Math.max(0, total), 'init', true);
    if (this.spCost <= 0) this.charges = this.maxCharges;
  }

  /**
   * Called on every (re)deployment. `carry` = { sp } for unite (联防) helpers: their 技力 at the end of their own combat
   * (unitsEnd `sp` = spTotal, rebuilt into charges here). Nothing else of the skill is carried — PRTS 卫戍协议/帮助 §联防阶段
   * "将对应单位的生命比例、技力修改至与上一阶段结束时相同": a skill that was running enters 联防 switched off, with the SP it
   * had left (spent at its activation: 0 for a one-charge skill — PRTS 技能 "触发技能后…消耗相应的技力").
   */
  reset(carry = null) {
    this.active = false;
    this.pending = false;
    this.timeLeft = 0;
    this.ammoLeft = 0;
    this.ammoMax = 0;
    this.charges = 0;
    this.sp = 0;
    this._trigKeys = null;
    this._trigSet = null;
    this.opReadyAt = -Infinity;   // (Battle._deploy starts the operation cooldown of the battle-start deployment)
    this.nextCastAt = -Infinity;
    if (this.noSkill) return;
    if (this.kind === 'passive') {
      this._startPassive();
      return;
    }
    this.sp = 0;
    this.gainSp(carry && Number.isFinite(carry.sp) ? carry.sp : this.initSp, 'init', true);
    // a free (spCost 0) non-passive skill is available once per deployment
    if (this.spCost <= 0) this.charges = this.maxCharges;
    if (this.spec.activateOnDeploy) this.activate('deploy');
  }

  _startPassive() {
    this.active = true;
    this._applyMods();
    this._call('onStart', { reason: 'passive' });
    // A deploy-time passive (琳琅诗怀雅 S1 仗义疏财 / S2 “见面礼”: kind 'passive' with no duration) never goes through
    // `activate()`, so the client saw no 'skill' event at all and its model never played the skill clip the manifest
    // carries for it (player report follow-up: the 57 instant clips with no Begin / own Idle — 2 of them passives;
    // 凯瑟琳 S1 is `kind: instant` in the sim and already casts). Fire the same bounded window an instant cast uses, so
    // the actor plays that clip once and then goes back to its idle with attacks on the normal clip. A passive WITH a
    // duration (缄默德克萨斯 S1–S3, 野鬃 S1, 伊内丝 S3, 耀骑士临光 S2) is left alone: the sim keeps it active until
    // death, so "how long should its stance show" is a separate question.
    if (!this.noSkill && !(this.duration > 0)) {
      const b = this.battle;
      const u = this.unit;
      b._ev(['skill', u.id, 1]);
      u.skillAnimUntil = b.time + SKILL_ANIM_WINDOW;
      b.after(SKILL_ANIM_WINDOW, () => { if (u.alive) b._ev(['skill', u.id, 0]); }, { owner: u });
    }
  }

  _applyMods() {
    const s = this.spec;
    if (s.mods || s.flags) {
      this.battle.addBuff(this.unit, { key: this._buffKey, mods: s.mods || null, flags: s.flags || null, tags: ['skill'] });
    }
    if (changesRange(s.targeting)) this.battle._refreshRange(this.unit);
  }

  _removeMods() {
    this.battle.removeBuff(this.unit, this._buffKey);
    if (changesRange(this.spec.targeting)) this.battle._refreshRange(this.unit);
  }

  /** Add SP (fires the `spGain` hook). Ignored while a duration/ammo/toggle skill runs (its bar shows the skill). */
  // ignoreLock is reserved for explicitly documented exceptions (黄沙罗盘), not ordinary SP gifts.
  gainSp(amount, reason = 'time', silent = false, { ignoreLock = false } = {}) {
    if (this.noSkill || this.kind === 'passive' || !(amount > 0)) return 0;
    if (this.active && this.isTimed && reason !== 'init' && !ignoreLock) return 0;
    // 阻回 (the operators' 凋亡 burst, damage.js): "停止并阻止任意形式的技力回复" — no SP of any kind (time, attack, hurt, gifts)
    if (reason !== 'init' && !ignoreLock && this.unit.s.flags.noSp) return 0;
    let cost = this.spCost;
    if (this.charges >= this.maxCharges && this.sp >= cost) return 0;
    let amt = amount;
    const b = this.battle;
    if (!silent && b._hooks.spGain) {
      const ctx = { unit: this.unit, amount: amt, reason, skill: this };
      b.emit('spGain', ctx);
      amt = Number.isFinite(ctx.amount) ? ctx.amount : 0;
      if (!(amt > 0)) return 0;
      // handlers may change the cost (spCostMul), end the skill or kill the unit: re-read, never use a stale cost
      if (this.kind === 'passive' || this.noSkill) return 0;
      cost = this.spCost;
      if (this.charges >= this.maxCharges && this.sp >= cost) return 0;
    }
    if (cost <= 0) return 0; // free skills never recharge (see reset)
    this.sp += amt;
    // within 1e-9 of the cost is the cost (the timer tolerance of `timeLeft` below; PR #402): 300 time gains of 1/30 SP
    // add up to 9.999999999999975 in floating point, which held a 10-SP charge one tick
    while (this.sp > cost - 1e-9 && this.charges < this.maxCharges) {
      this.charges++;
      if (this.charges < this.maxCharges) this.sp = Math.max(0, this.sp - cost);
      else this.sp = cost;
    }
    if (this.charges >= this.maxCharges) this.sp = cost;
    return amt;
  }

  /** Re-establish sp/charges invariants after an SP-cost change (e.g. content sets spCostMul mid-battle). */
  _normalize() {
    if (this.noSkill || this.kind === 'passive') return;
    const cost = this.spCost;
    if (cost <= 0) { if (this.sp > 0) { this.sp = 0; this.charges = this.maxCharges; } return; } // became free
    while (this.sp > cost - 1e-9 && this.charges < this.maxCharges) {   // (the 1e-9 of gainSp)
      this.charges++;
      this.sp = this.charges < this.maxCharges ? Math.max(0, this.sp - cost) : cost;
    }
    if (this.sp > cost) this.sp = cost;
  }

  /** Per-tick update: durations, SP regen, tick-based triggers. */
  tick(dt) {
    if (this.noSkill) return;
    const u = this.unit;
    if (this.kind !== 'passive' && this.sp > this.spCost) this._normalize();
    if (this.active && this.kind !== 'passive') {
      if (this.spec.onTick) this._call('onTick', { dt });
      if (this.kind === 'duration' || (this.kind === 'ammo' && Number.isFinite(this.timeLeft))) {
        this.timeLeft -= dt;
        if (this.timeLeft <= 1e-9) { this.end('duration'); }
      }
    } else if (this.active && this.kind === 'passive' && this.spec.onTick) {
      this._call('onTick', { dt });
    }
    // natural SP recovery stops only under 阻回 (noSp; a running timed skill holds it too) — not while 晕眩 / 冻结 / 浮空
    // keep the unit from acting: PRTS 技能 "在阻回状态或技力条已满时，保留剩余冷却时间，计时暂停"; PRTS 异常效果 STUNNED
    // "无法攻击、释放技能、阻挡敌人类单位" says nothing of SP (community report #18: 洛洛's S2 self-stun froze her SP)
    if (this.spType === 'time' && !(this.active && this.isTimed) && !u.s.flags.noSp && u.alive && u.deployed && !u.hidden) {
      const rate = u.s.spRecovery;
      if (rate > 0) this.gainSp(rate * dt, 'time');
    }
    if (!u.canAct) return;
    // a DEFAULT cast bound to an ally condition (塞雷娅 S1) replaces the attack about to be made: should the condition
    // have failed before that attack (the ally healed meanwhile), the cast is withdrawn — no heal mode stays behind
    if (this.pending && this.triggerAllies && this.rule !== 'SKILL_RANGE' && !this._allyTriggerSatisfied()) {
      this.end('withdrawn');
      this.addCharge(1);
    }
    if (!this.ready || u.s.flags.silence) return;
    if (this.active && this.isTimed) return;
    // a cast "next attack" still waits for its attack: another charge now would be spent on the same attack
    if (this.pending || this._opCooling()) return;
    // an instant / charge skill with no attack of its own is cast at most once per attack interval of its unit
    // (activate sets nextCastAt; GitHub #298): the casts checked here wait for it — the unit's attacks are not touched
    if (!this.isTimed && !this.spec.attack && this.battle.time < this.nextCastAt - 1e-9) return;
    if (TICK_RULES.has(this.rule)) {
      if (this._tickRuleSatisfied()) this.activate(this.rule);
    } else if (this.rule !== 'TAKE_DAMAGE' && this.rule !== 'NEVER') {
      // DEFAULT (and unknown rules) for units that cannot attack right now: check the initial range every tick;
      // content trigger ranges are checked every tick for everyone (nothing may be in the unit's own range)
      const prof = u.profile;
      if (prof && (prof.noAttack || (prof.noAttackUnlessSkill && !this.active))) {
        if (this._defaultCondition()) this.activate('DEFAULT');
      } else if (this.triggerRanges.length && !this.healSkill && this._extraTriggerSatisfied(false)) this.activate('DEFAULT');
    }
  }

  /** The automatic operations of a MANUAL skill are cooling down (AUTO_OP_COOLDOWN). */
  _opCooling() { return this.manual && this.battle.time < this.opReadyAt - 1e-9; }

  /** Public form of the operation cooldown, for kits with their own automatic cast of a MANUAL skill. */
  get opCooling() { return this._opCooling(); }

  /**
   * Absolute tile keys of the trigger grid at the unit's current tile and direction (cached, with their Set). ACTIVE_RANGE
   * grows it by the unit's permanent rangeExtend (the range the skill would run with — Battle._refreshRange) unless the
   * skill's range ignores 攻击距离 (targeting.noRangeExtend).
   */
  _triggerKeys() {
    const u = this.unit;
    const tile = u.tileR * COLS + u.tileC;
    const ext = this.rule === 'ACTIVE_RANGE' && !this.spec.targeting?.noRangeExtend ? (u.s.baseRangeExtend || 0) : 0;
    if (!this._trigKeys || this._trigTile !== tile || this._trigDir !== u.dir || this._trigExt !== ext) {
      this._trigKeys = absoluteRangeKeys(this.triggerGrid, u.tileR, u.tileC, u.dir, ext);
      this._trigSet = new Set(this._trigKeys);
      this._trigTile = tile;
      this._trigDir = u.dir;
      this._trigExt = ext;
    }
    return this._trigKeys;
  }

  /** `trigger.allies`: an injured, healable ally on the trigger grid (the unit's own range without one) ≤ hpAtMost. */
  _allyTriggerSatisfied() {
    const b = this.battle;
    const u = this.unit;
    let keys;
    if (this.triggerGrid) { this._triggerKeys(); keys = this._trigSet; } else keys = u.baseRangeKeys || u.rangeKeys;
    const lim = this.triggerHpAtMost + 1e-9;
    return b.injuredAlliesInKeys(keys, u).some((a) => a.hpRatio <= lim);
  }

  _tickRuleSatisfied() {
    const b = this.battle;
    const u = this.unit;
    if (this.rule === 'SP_FULL') return true;
    // SEARCH: an enemy inside the initial attack range, every tick (librators / phalanxes and 安洁莉娜 do not attack
    // while the skill is off, so DEFAULT's "about to attack" never comes)
    if (this.rule === 'SEARCH') return this._defaultCondition();
    // (CUSTOM_RANGE / SKILL_RANGE / GDGLOW_SKILL_2 / the DEFAULT condition: a registered ally target — 白铁's 铁钳号·原型机 —
    // counts like an enemy for a non-heal skill, `_allyTargetIn`)
    if (this.rule === 'CUSTOM_RANGE') {
      if (!this.triggerGrid) return this._defaultCondition();
      const keys = this._triggerKeys();
      return b.enemiesInKeys(keys, u, { canHitFly: true }).length > 0 || this._allyTargetIn(this._trigSet);
    }
    if (this.rule === 'SKILL_RANGE') {
      if (this.triggerAllies) return this._allyTriggerSatisfied();
      if (!this.triggerGrid) return this._defaultCondition();
      return b.anyEnemyInKeys(this._triggerKeys()) || this._allyTargetIn(this._trigSet);
    }
    if (this.rule === 'ACTIVE_RANGE') return this._defaultCondition(this.triggerGrid ? this._triggerKeys() : null);
    // GDGLOW_SKILL_2 "全场存在可选目标时释放技能": a targetable enemy anywhere (heal skill: an ally that needs healing)
    if (this.rule === 'GDGLOW_SKILL_2') {
      if (this.healSkill) return b.injuredAlliesInKeys(ALL_TILES, u, !!u.profile?.heal?.elementHealRatio).length > 0;
      return b.enemies.some((e) => canTargetEnemy(u, e, TRIGGER_PROFILE)) || this._allyTargetIn(ALL_TILES);
    }
    return false;
  }

  /**
   * DEFAULT rule condition: an enemy (or injured ally for heal skills) inside the initial range (baseRangeKeys: own
   * grid + permanent rangeExtend) — a registered ally target there too (`_allyTargetIn`: 铁钳号·原型机; not for heal
   * skills) — or an enemy inside a content trigger range (addTriggerRange; not for heal skills).
   * `range` (ACTIVE_RANGE): those absolute tile keys instead of the initial range.
   */
  _defaultCondition(range = null) {
    const b = this.battle;
    const u = this.unit;
    if (b.rangeChanged(u)) b._refreshRange(u);
    const keys = range || u.baseRangeKeys || u.rangeKeys;
    if (keys) {
      if (this.healSkill) return b.injuredAlliesInKeys(keys, u).length > 0
        || (this.triggerEnemies && b.enemiesInKeys(keys, u, TRIGGER_PROFILE).length > 0);
      if (b.enemiesInKeys(keys, u, u.profile).length > 0 || this._allyTargetIn(keys)) return true;
    }
    // the enemies a unit blocks are always its targets (Battle.blockedTargets), in range or not — PRTS 卫戍协议/帮助
    // "敌人被近战干员自身阻挡" satisfies the target condition of the basic strategy (a ranged blocker too: user playtest #6)
    if (!this.healSkill && u.blocking.length && b.blockedTargets(u, u.profile).length > 0) return true;
    return !this.healSkill && this.triggerRanges.length > 0 && this._extraTriggerSatisfied();
  }

  /** Called by the attack loop right before a normal attack/heal. Returns true when the skill fired. */
  onAboutToAttack() {
    if (!this.ready || this.unit.s.flags.silence) return false;
    if (this.active && this.isTimed) return false;
    if (this.rule === 'TAKE_DAMAGE' || this.rule === 'NEVER' || TICK_RULES.has(this.rule)) return false;
    if (this.pending || this._opCooling()) return false;
    // Guardian charged heals supply their own attack target; no enemy is required (#406).
    if (this.triggerAllies ? !this._allyTriggerSatisfied() : !this._defaultCondition()) return false;
    this._beforeAttack = true;   // the attack follows this cast in the same check (ai.js updateAlly): attacks pace it
    try { return this.activate('DEFAULT'); } finally { this._beforeAttack = false; }
  }

  /** TAKE_DAMAGE trigger + INCREASE_WHEN_TAKEN_DAMAGE SP. */
  onDamaged() {
    if (this.noSkill) return;
    if (this.spType === 'hurt' && !(this.active && this.isTimed)) this.gainSp(1, 'hurt');
    if (this.rule === 'TAKE_DAMAGE' && this.ready && !this.pending && !(this.active && this.isTimed) && this.unit.canAct && !this.unit.s.flags.silence && !this._opCooling()) {
      this.activate('TAKE_DAMAGE');
    }
  }

  /** Activate now (consumes one charge). Returns true on success. */
  activate(reason = 'manual', { free = false } = {}) {
    if (this.noSkill || this.kind === 'passive') return false;
    if (!free && !this.ready) return false;
    if (this.active && this.isTimed) return false;
    const u = this.unit;
    if (!u.alive || !u.deployed) return false;
    if (!free) {
      const wasFull = this.charges >= this.maxCharges;
      this.charges--;
      if (this.maxCharges === 1 || wasFull) this.sp = 0;
    }
    this.activations++;
    this.lastStart = this.battle.time;
    const b = this.battle;
    if (this.manual) this.opReadyAt = b.time + AUTO_OP_COOLDOWN;
    if (this.isTimed) {
      this.active = true;
      this.timeLeft = this.kind === 'duration' ? Math.max(0.01, this.duration) : (this.kind === 'ammo' && this.duration > 0 ? this.duration : Infinity);
      this.ammoLeft = this.kind === 'ammo' ? Math.max(1, this.ammo) : 0;
      this.ammoMax = this.ammoLeft;
      this._applyMods();
    } else {
      // instant / charges
      this.active = true;
      this.pending = !!this.spec.attack;
      // (a targeting-only instant skill must still switch to its skill range for the pending attack)
      if (this.spec.mods || this.spec.flags || this.spec.targeting) this._applyMods();
    }
    b._ev(['skill', u.id, 1]);
    u.skillAnimUntil = b.time + SKILL_ANIM_WINDOW;
    this._call('onStart', { reason });
    if (b._hooks.skillStart) b.emit('skillStart', { unit: u, skill: this, reason });
    // bullets added in skillStart (拉特兰's ×(1.05 + 0.015 × layers), 逃犯引渡手续, talents): the bar's full mark
    // (community report #35: the extra bullets sat above a full bar until fewer than the base count were left)
    if (this.active && this.ammoLeft > this.ammoMax) this.ammoMax = this.ammoLeft;
    if (!this.isTimed && !this.pending) {
      this.end('instant');
      // an instant / charge skill with no attack of its own (no spec.attack: a throw, a heal, a buff, DP …) waits one
      // attack interval of its unit before it is cast again from the tick (GitHub #298: 引星棘刺 S1 度算浪波, an SP_FULL
      // cast, was recast every tick once 迅捷's refund refilled its bar at once, whatever the attack speed) — on the skill
      // only: the cast is no attack, the unit's attacks / heals keep their own rhythm. [ASSUMED] one attack interval: PRTS
      // prints no 前后摇 for such casts. A cast made right before an attack (DEFAULT) is paced by those attacks already;
      // a cast onEnd opened again owns its own gap.
      if (!this.active && !this.spec.attack && !this._beforeAttack && u.alive && u.s.interval > 0) this.nextCastAt = b.time + u.s.interval;
    }
    return true;
  }

  /**
   * Called after each attack/heal performed by the unit. `noAmmo` (Battle.forceAttack opts, or `ctx.noAmmo = true`
   * set by the spec's onAttack) = this attack spends no ammo of a running ammo skill (no `ammoUsed`).
   */
  onAttackPerformed(targets, usedOverride, noAmmo = false) {
    if (this.noSkill) return;
    const b = this.battle;
    // AK: attacks made by the skill (the "next attack" of an instant/charge skill, every attack of a running timed
    // skill — including the one that ends it) never recover attack-type SP ⇒ a cost-N skill fires every N+1 attacks.
    const skillAttack = this.active && (this.isTimed || (!!usedOverride && this.pending));
    if (this.active && typeof this.spec.onAttack === 'function') {
      const fn = this.spec.onAttack;
      const ctx = this._ctx({ targets, noAmmo: !!noAmmo });
      b._safe(() => fn(ctx), 'skill.onAttack', this.unit);
      noAmmo = !!ctx.noAmmo;
    }
    if (this.active && this.kind === 'ammo' && noAmmo) {
      // an extra attack that spends no bullet
    } else if (this.active && this.kind === 'ammo') {
      this.ammoLeft--;
      if (b._hooks.ammoUsed) b.emit('ammoUsed', { unit: this.unit, left: this.ammoLeft, skill: this });
      if (this.ammoLeft <= 0) this.end('ammo');
    } else if (usedOverride && this.pending && !this.isTimed) {
      this.pending = false;
      this.end('instant');
    }
    if (this.spType === 'attack' && !skillAttack && !(this.active && this.isTimed)) this.gainSp(1, 'attack');
  }

  /**
   * End the active skill. onEnd runs while the skill's mods / range are still applied (end-of-skill effects — finishers,
   * bombardments — use the skill's stats and range; `active` is already false), then they are removed and `skillEnd`
   * fires — neither when onEnd re-activated the skill (the new cast owns both).
   */
  end(reason = 'end') {
    if (!this.active || this.kind === 'passive' && reason !== 'death') return;
    const u = this.unit;
    const b = this.battle;
    this.active = false;
    this.pending = false;
    this.timeLeft = 0;
    this.ammoLeft = 0;
    this.ammoMax = 0;
    const n = this.activations;
    this._call('onEnd', { reason });
    // onEnd started the next cast (耀骑士临光 S2 retreats on its duration end and 不屈 redeploys her inside that call; the
    // deploy-timed skill starts again, PR #109): that cast owns the mods and its events — a trailing skillEnd would make
    // listeners (骑士戒律) clear the new cast and the client would see the skill off while it runs
    if (this.active || this.activations !== n) return;
    this._removeMods();
    if (b._hooks.skillEnd) b.emit('skillEnd', { unit: u, skill: this, reason });
    if (this.kind !== 'passive') b._ev(['skill', u.id, 0]);
  }

  /** The attack override to use for the next attack, or null. */
  attackOverride() {
    if (!this.active) return null;
    if (this.isTimed || this.kind === 'passive') return this.spec.attack || null;
    return this.pending ? (this.spec.attack || null) : null;
  }

  targetingOverride() {
    if (!this.active || !this.spec.targeting) return null;
    if (!this.isTimed && this.kind !== 'passive' && !this.pending) return null;
    return this.spec.targeting;
  }

  // ---- helpers for content -------------------------------------------------------------------------------
  // (non-finite arguments are ignored: a NaN timer/ammo count would keep the skill active forever)
  // (bullets added above the activation's most so far raise the bar's full mark: the bar drains one bullet at a time)
  addAmmo(n) {
    if (!this.active || this.kind !== 'ammo' || !Number.isFinite(n)) return;
    this.ammoLeft += n;
    if (this.ammoLeft > this.ammoMax) this.ammoMax = this.ammoLeft;
  }
  extend(seconds) { if (this.active && Number.isFinite(this.timeLeft) && Number.isFinite(seconds)) this.timeLeft += seconds; }
  addCharge(n = 1) { if (!Number.isFinite(n)) return; this.charges = Math.max(0, Math.min(this.maxCharges, this.charges + n)); if (this.charges >= this.maxCharges) this.sp = this.spCost; }
  stop() { this.end('stopped'); }

  [Symbol.for('nodejs.util.inspect.custom')]() {
    return `Skill<${this.id} ${this.kind} sp=${this.sp.toFixed(2)}/${this.spCost} ch=${this.charges}${this.active ? ' active' : ''}>`;
  }
}
