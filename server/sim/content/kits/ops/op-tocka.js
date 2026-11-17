// server/sim/content/kits/ops/op-tocka.js — 冻河 (char_4244_tocka) 自选 operator kit: 6★ 游击手 (辅助, supportiveranger), an
// owned-6★ pick of the tier-5 and tier-6 自选 slots; every skill, both talents and the trait at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4244_tocka): normal = E2 Lv1, skills at rank 4; elite = E2 Lv60, rank 7 (tiers 5 and
// 6 alike: no module was released with her). Talents at the player's potential (`chess.talents`: 夜的哑然 80 % below 潜能 3,
// 雪的印痕 6 s below 潜能 5). Sources: character_table / skill_table of CN 2.7.91 as built into backups.json; gamedata_const
// ba.triggereffect "施加于敌方/友方单位的一次性减益/增益效果，该效果仅在满足特定条件时触发"; PRTS 冻河
// (https://prts.wiki/w/冻河 oldid 447330), the skill 备注 quoted below.
//
// - Trait (游击手) "可以使用触发型效果协助作战": no number of its own — the trigger effects below are the branch. Ranged,
//   physical arrows that reach air units (the data's attackKind / dmgType / canHitFly); range 3-18 under every skill.
// - Trigger effects (触发型效果), shared by the three skills: a one-time effect she places on an ally operator, held there as
//   a buff `tocka:<s1|s2|s3>:<her id>` until its condition is met; then it fires once and is gone (`fire`). One per kind
//   and 冻河 on a holder, so two 冻河 each place their own [ASSUMED for S1 / S3; S2 per PRTS "不同冻河间…互相独立"].
//   [ASSUMED] An effect leaves the field with its holder (a holder's buffs go with it; nothing transfers), and stays on
//   its holder when 冻河 leaves (an applied buff outlives its source; no PRTS note says otherwise) — while she is away its
//   firing gives no talent part and S3's effect finds no one to move to.
// - T1 夜的哑然 "自身的触发型效果触发时回复2点技力，并为攻击范围内一名友方干员治疗攻击力100%的生命" (t0 sp / heal_scale): each
//   firing gives her `sp` SP (none while S3 runs: no SP during a timed skill) and heals heal_scale × her ATK on the injured
//   ally operator of her range with the lowest HP ratio, then the latest created [ASSUMED: S1's order; none injured ⇒ no
//   heal]; only while she is on the field [ASSUMED].
// - T2 雪的印痕 "施加触发型效果后的下次普通攻击造成范围伤害，并使目标获得20%的虚弱效果，持续8秒，期间每秒受到攻击力80%的法术伤害"
//   (t1 attack@projectile_range / attack@t2_atk / attack@t2_buff_duration / attack@t2_magic_atk_scale): placing an effect
//   (施加 — a 转移 is not one [ASSUMED: S3's text names the two apart]) arms her next attack (`tocka:snow`, a buff: lost
//   when she leaves the field [ASSUMED]). Every arrow of that attack bursts on its target: the enemies within
//   attack@projectile_range of it (a 中点判定 like the profession splash [ASSUMED]) take the arrow's damage (its attack
//   scale, physical splash; an S3 attack's stun too [ASSUMED: an attack's on-hit stun reaches its whole area]), and everyone
//   it hits gets 虚弱 −attack@t2_atk (the catalogue status: 同名效果取最高) for attack@t2_buff_duration s and
//   t2_magic_atk_scale × her current ATK as arts damage every second meanwhile (BUFF damage, not dodgeable; first tick at
//   1 s, ticking on after she leaves, one per 冻河 [ASSUMED]); an arrow that fizzles spends it [ASSUMED]. The attack is
//   chosen at launch: every target of each of her attacks queues a shot record (`mem.tockaShots`, one FIFO per enemy as
//   黑键's stored energies, op-ebnhlz.js), shifted when that arrow lands (profile onEachHit).
// - S1 一无所有之人 (AUTO, bb shield_atk_scale / shield_time / stun / max_target): "对范围内2名干员施加触发型效果（只选择未持有该
//   效果的目标）" — PRTS "优先选择生命比例最低＞创建时间最晚的单位": the max_target ally operators of her range not holding
//   her S1 effect, herself included [ASSUMED: unlike S2 "非自身" and S3 "另一名", no exclusion is written]. Effect:
//   "受到攻击时，获得相当于冻河160%攻击力的屏障（在10秒内衰减），并使攻击者晕眩3秒" — [ASSUMED] 受到攻击时 = every damage
//   instance its holder takes, as the engine's ON_TAKE_DAMAGE observers (an injury observer: SIM §5 / DESIGN §35.32 — a
//   dodged or barrier-absorbed hit too), whatever its source (PRTS: the stun needs a living enemy source, so sourceless /
//   ally hits trigger it), "触发型效果不会响应元素伤害" (no 元素伤害; a 流失 or an element fill never reaches the injury step).
//   The barrier = her ATK when it fires × shield_atk_scale ("根据触发时（而非施加时）冻河的攻击力计算"), losing initial /
//   shield_time every second ("固定为初始屏障量/10") [ASSUMED: in one-second steps, as 砾's]; firing again "会先清除原有的此
//   技能屏障…新的屏障量在原有屏障量与新计算的屏障量间取高" — one S1 barrier per holder whatever 冻河 gave it [ASSUMED]. The
//   hit that fires it is not absorbed by it [ASSUMED]. The source is stunned `stun` s unless it is missing, dead or ours.
// - S2 意欲呼啸之心 (AUTO, bb attack_speed / buff_duration / max_target): "对全场1名干员施加触发型效果" — PRTS "优先选择场上创建
//   时间最晚、未开启技能且非自身的我方干员…不会选择已持有冻河提供的此攻击速度加成的干员…技能类型为“被动”或未携带技能的干员":
//   the latest created ally operator of the field [ASSUMED: aggroSeq, the deployment order — as the 链愈师 chain reads 部署
//   时间点最晚] whose skill is not running, that is not her, holds neither her effect nor her ASPD (another 冻河's does not
//   bar it [ASSUMED: the buffs are independent]), and has a non-passive skill. Effect: "技能可开启时，在15秒内攻击速度+25，
//   期间技能变为自动开启" — PRTS: on the holder's skill start, or a check every 0.2 s "技力充足、未持有阻止能力类异常效果、
//   不需要目标/满足目标条件" (`castable`: SP ready, can act, not silenced; and `targetMet`: the target condition the engine
//   asks of that skill's automatic cast — the range rules' own range, DEFAULT's initial range or a blocked enemy, a heal
//   skill's injured ally [ASSUMED: the 技能策略's condition stands for the skill's own target need]; the cast stays the
//   engine's). The owner tested it in a normal stage (2026-11-03): "干员技力一满并且技能/攻击范围内有敌人就自动放，没敌人不会放"
//   — so the rules whose cast asks no target of its own (SP_FULL / NEVER / TAKE_DAMAGE, PRTS's "不需要目标") wait for an
//   enemy in the holder's attack or skill range, or one it blocks (`enemyInReach`). Then ASPD +attack_speed for
//   buff_duration s (per 冻河).
//   "期间技能变为自动开启" ("每6帧尝试触发…手动触发技能"): this remake already opens every MANUAL skill itself — the 技能策略
//   (skills.js trigger rules) plays the player, and the only part left manual is the 3 s operation cooldown that holds a
//   MANUAL skill but never an AUTO one (constants.js AUTO_OP_COOLDOWN). So while one of her ASPD buffs lasts the holder's
//   MANUAL skill counts as an AUTO skill (`skill.manual` off: no operation cooldown, its trigger rule unchanged), and
//   MANUAL again after (the owner's test above: opening it the moment it is ready would cast skills at nothing).
// - S3 踽踽独行之春 (MANUAL, 20 s, the data's DEFAULT; bb attack_speed / attack@max_target / attack@atk_scale / attack@stun /
//   bonus_init_atk / bonus_atk_dec_per_sec / bonus_duration / bonus_sp): ASPD +attack_speed; attacks hit attack@max_target
//   enemies for attack@atk_scale × ATK physical and stun each attack@stun s. At its start "立刻对范围内另一名干员施加触发型
//   效果（已存在时改为将其触发）": her S3 effect still held anywhere on the field fires [ASSUMED: anywhere]; else it goes to
//   another ally operator of her range by the transfer's order [ASSUMED]. Effect: "开启技能时自身和冻河攻击力+70%（在15秒内
//   衰减），并将该触发型效果转移给冻河攻击范围内技力比例最高的另一名干员" — on the holder's skill start (after its own start
//   effects: the skillStart hook [ASSUMED]) the holder and 冻河 get ATK +bonus_init_atk, falling by bonus_atk_dec_per_sec
//   every second to 0 at bonus_duration (PRTS "在15s内每秒线性衰减固定值，在第15s时衰减至0") [ASSUMED: one-second steps; a
//   new one restarts it], then it moves to the ally operator of her range with the highest true SP ratio (PRTS: stored
//   charges count — 技力上限 = 最大充能数 × 技力需求 —, a running skill that spent its SP is at 0; ties: the latest created
//   [ASSUMED]) other than its holder and her; "若没有合法的转移对象…则会消失". "冻河技能期间拥有该效果的干员每秒获得1点技力":
//   while S3 runs its holder gets bonus_sp SP every second of it (no SP during the holder's own timed skill).
// - 干员 = operators: summons and devices are never picked [ASSUMED: the kits' reading of 干员].
// - The two AUTO skills act on allies, so each fires as soon as its SP is full — no enemy needed (the owner's AUTO rule,
//   kits/README.md checklist 5) — but only with a legal target ([ASSUMED] none ⇒ it waits full): the kit's own cast
//   (trigger NEVER + a tick check), paced like the engine's casts of an instant skill without an attack (`nextCastAt`).

import { num, talentBb, skillRec, up, giveSp, alliesInGridOf, once } from '../shared/tier1.js';

const S1 = 'skchr_tocka_1', S2 = 'skchr_tocka_2', S3 = 'skchr_tocka_3';
/** PRTS 冻河 S2 备注 "每0.2秒检测一次": how often a held S2 effect checks whether its holder's skill can open. */
const S2_POLL = 0.2;
/** The S1 barrier: one per holder whatever 冻河 gave it ("此技能屏障", PRTS S1 备注) [ASSUMED]. */
const BARRIER = 'tocka:s1:barrier';
/** S2's ASPD and S3's ATK bonus on a unit: + her id (two 冻河 never share them). */
const ASPD = 'tocka:s2:aspd:', ATK = 'tocka:s3:atk:';
/** 雪的印痕: her armed next attack (on her), and its arts DoT on an enemy (+ her id). */
const SNOW_READY = 'tocka:snow', SNOW_DOT = 'tocka:snow:';
/** A projectile lands within its maxAge (projectiles.js: 10 s by default): an older shot record is stale. */
const SHOT_MAX_AGE = 10;

const effectKey = (kind, tocka) => `tocka:${kind}:${tocka.id}`;
const isOp = (a) => !!a && a.kind === 'op';
const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** "创建时间最晚" first: the latest deployment (aggroSeq) [ASSUMED], then the later unit. */
const later = (a, b) => b.aggroSeq - a.aggroSeq || b.id - a.id;
/** A skill that can become castable: not missing, not passive ("技能类型为“被动”或未携带技能的干员" are never S2's picks). */
const activeSkill = (u) => !!u.skill && !u.skill.noSkill && u.skill.kind !== 'passive'
  && String(u.skill.def?.skillType ?? '').toUpperCase() !== 'PASSIVE';
/** "技能可开启时" (PRTS S2 备注): SP ready, no running cast, able to act and not silenced. */
const castable = (u) => activeSkill(u) && u.skill.ready && !u.skill.active && u.canAct && !u.s.flags.silence;
/** Trigger rules whose cast asks no target of its own ("不需要目标"): at full SP, a kit's own cast, a hit taken. */
const NO_TARGET_RULES = new Set(['SP_FULL', 'NEVER', 'TAKE_DAMAGE']);
/** The rules the engine checks on their own range every tick (skills.js TICK_RULES but SP_FULL). */
const RANGE_RULES = new Set(['SEARCH', 'CUSTOM_RANGE', 'SKILL_RANGE', 'ACTIVE_RANGE', 'GDGLOW_SKILL_2']);
/**
 * "满足目标条件" (PRTS S2 备注): the target condition the engine asks of an automatic cast of `u`'s skill — the range rules'
 * own check (skills.js `_tickRuleSatisfied`), else DEFAULT's: an enemy in the initial range or one it blocks, a heal skill
 * an injured ally (`_defaultCondition`; a DEFAULT cast bound to an ally: `_allyTriggerSatisfied`); the NO_TARGET_RULES an
 * enemy within reach (`enemyInReach`, the owner's test). The cast itself stays the engine's.
 */
function targetMet(u) {
  const sk = u.skill;
  if (NO_TARGET_RULES.has(sk.rule)) return enemyInReach(u);
  if (RANGE_RULES.has(sk.rule)) return !!sk._tickRuleSatisfied();
  return sk.triggerAllies ? !!sk._allyTriggerSatisfied() : !!sk._defaultCondition();
}

/**
 * "技能/攻击范围内有敌人" (the owner's test, 2026-11-03): an enemy `u` can target in its initial range or in its skill's own
 * trigger range, or one it blocks — DEFAULT's enemy part (skills.js `_defaultCondition`), a heal skill's too.
 */
function enemyInReach(u) {
  const sk = u.skill, b = sk.battle;
  if (b.rangeChanged(u)) b._refreshRange(u);
  const keys = u.baseRangeKeys || u.rangeKeys;
  if (keys && b.enemiesInKeys(keys, u, u.profile).length > 0) return true;
  if (sk.triggerGrid && b.anyEnemyInKeys(sk._triggerKeys(), u)) return true;
  return u.blocking.length > 0 && b.blockedTargets(u, u.profile).length > 0;
}

/**
 * The true 技力 ratio (PRTS S3 备注): the stored charges count (技力上限 = 最大充能数 × 技力需求 — skills.js spTotal), and a
 * running skill that spent its SP is at 0; no SP skill ⇒ 0.
 */
function spRatio(u) {
  const sk = u.skill;
  if (!activeSkill(u)) return 0;
  const cap = sk.maxCharges * sk.spCost;
  return cap > 0 ? sk.spTotal / cap : 0;
}

/** Fire a held trigger effect once: off its holder first (一次性), then what it does (`data.fire`). */
function fire(battle, holder, buff, ctx) {
  if (!buff || !holder.buffs.includes(buff)) return false;
  battle.removeBuff(holder, buff);
  buff.data.fire(battle, holder, ctx);
  return true;
}

/** The unit on the field holding 冻河 `tocka`'s effect `kind`, with its buff, or null. */
function heldEffect(battle, tocka, kind) {
  const key = effectKey(kind, tocka);
  for (const a of battle.allyUnits) {
    if (!a.alive || !a.deployed) continue;
    const buff = a.findBuff(key);
    if (buff) return { holder: a, buff };
  }
  return null;
}

/**
 * S2 "期间技能变为自动开启": while one of the 冻河 ASPD buffs lasts, the holder's MANUAL skill counts as an AUTO skill for
 * the engine (`skill.manual` off: no 3 s operation cooldown — skills.js `_opCooling`); MANUAL again once none is left or
 * the holder left the field (its buffs then go without callbacks: the shared `death` hook).
 */
function syncAutoOpen(u) {
  const sk = u && u.skill;
  if (!sk) return;
  const on = u.alive && u.buffs.some((b) => b.key.startsWith(ASPD));
  if (on && sk.manual && !u.mem.tockaAutoOpen) {
    u.mem.tockaAutoOpen = true;
    sk.manual = false;
  } else if (!on && u.mem.tockaAutoOpen) {
    u.mem.tockaAutoOpen = false;
    sk.manual = true;
  }
}

/** The hooks every 冻河 of a battle shares, installed once: skill starts fire S2 / S3 effects; a holder leaving the field. */
function installShared(battle) {
  once(battle, 'tocka:effects', () => {
    battle.on('skillStart', ({ unit }) => {
      for (const b of unit.buffs.slice()) if (b.data && b.data.tockaOn === 'skillStart') fire(battle, unit, b, { reason: 'skillStart' });
    });
    battle.on('death', ({ unit }) => syncAutoOpen(unit));
  });
}

/**
 * S1's barrier on `holder`: max(its S1 barrier left, `amount`) — the old one cleared first (PRTS S1 备注) — losing a fixed
 * initial / `dur` every second until it is gone [ASSUMED: one-second steps].
 */
function barrier(battle, holder, amount, dur, source) {
  const old = holder.findBuff(BARRIER);
  const total = Math.max(amount, old ? old.shield : 0);
  if (old) battle.removeBuff(holder, old);
  if (!(total > 0)) return;
  const step = dur > 0 ? total / dur : 0;
  battle.addBuff(holder, {
    key: BARRIER, shield: total, duration: dur > 0 ? dur : Infinity, source, tags: ['skill'],
    interval: step > 0 ? 1 : 0,
    onTick: step > 0 ? ({ battle: b, unit, buff }) => {
      buff.shield = Math.max(0, buff.shield - step);
      unit.markDirty();
      if (!(buff.shield > 1e-9)) b.removeBuff(unit, buff);
    } : null,
  });
  battle.fx('shield', { x: holder.x, y: holder.y, id: holder.id });
}

/** S3's ATK +init on `u`, falling by `dec` every second to 0 [ASSUMED: one-second steps]; a new one restarts it. */
function decayingAtk(battle, u, key, init, dec, dur, source) {
  if (!(init > 0) || !(dur > 0)) return;
  battle.addBuff(u, {
    key, duration: dur, mods: { atkPct: init }, interval: 1, source, data: { v: init }, tags: ['skill'],
    onTick: ({ unit, buff }) => {
      buff.data.v = Math.max(0, buff.data.v - dec);
      buff.mods = { atkPct: buff.data.v };
      unit.markDirty();
    },
  });
}

export default {
  char_4244_tocka: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const kindOf = (id) => (num(skillRec(chess, id)?.maxChargeTime, 1) > 1 ? 'charges' : 'instant');
    const snowRadius = num(t1['attack@projectile_range']);
    const weakVal = Math.abs(num(t1['attack@t2_atk'])), weakDur = num(t1['attack@t2_buff_duration']);
    const dotScale = num(t1['attack@t2_magic_atk_scale']);

    /** Ally operators on her range (no device, hidden or 孤立 unit — tier1 alliesInGridOf). */
    const opsInRange = (battle, unit) => alliesInGridOf(battle, unit).filter(isOp);
    /** S1's picks: not holding her S1 effect; the lowest HP ratio, then the latest created. */
    const s1Picks = (battle, unit) => opsInRange(battle, unit).filter((a) => !a.findBuff(effectKey('s1', unit)))
      .sort((a, b) => a.hpRatio - b.hpRatio || later(a, b));
    /** S2's picks: anywhere on the field (PRTS S2 备注 above), the latest created first. */
    const s2Picks = (battle, unit) => battle.alliesFor(unit).filter((a) => isOp(a) && a !== unit && !a.hidden && activeSkill(a)
      && !a.skill.active && !a.findBuff(effectKey('s2', unit)) && !a.findBuff(ASPD + unit.id)).sort(later);
    /** S3's pick / transfer: another ally operator of her range than `holder`, the highest true SP ratio first. */
    const byRatio = (battle, unit, holder) => opsInRange(battle, unit).filter((a) => a !== unit && a !== holder)
      .sort((a, b) => spRatio(b) - spRatio(a) || later(a, b));

    /** T1 夜的哑然: `sp` SP to her and a heal of heal_scale × her ATK to the most injured ally operator of her range. */
    const night = (battle, tocka) => {
      if (!up(tocka)) return;
      giveSp(tocka, num(t0.sp), 'talent');
      const hs = num(t0.heal_scale);
      const t = battle.injuredAlliesInKeys(tocka.rangeKeySet ?? tocka.rangeKeys, tocka)
        .filter((a) => isOp(a) && battle.allySelectable(a, tocka)).sort((a, b) => a.hpRatio - b.hpRatio || later(a, b))[0];
      if (t && hs > 0) battle.heal(tocka, t, tocka.s.atk * hs);
    };

    /** What each effect does when it fires (`ctx`: the injury event for S1). */
    const effects = {
      s1(battle, tocka, holder, ctx) {
        barrier(battle, holder, tocka.s.atk * num(b1.shield_atk_scale), num(b1.shield_time), tocka);
        const src = ctx && ctx.source;
        if (src && src.alive && src.side === 'enemy') battle.applyStatus(src, 'stun', { duration: num(b1.stun), source: tocka });
      },
      s2(battle, tocka, holder) {
        const dur = num(b2.buff_duration);
        if (!(dur > 0)) return;
        battle.addBuff(holder, {
          key: ASPD + tocka.id, duration: dur, mods: { aspd: num(b2.attack_speed) }, source: tocka, tags: ['skill'],
          onRemove: ({ unit }) => syncAutoOpen(unit), onExpire: ({ unit }) => syncAutoOpen(unit),
        });
        syncAutoOpen(holder);
      },
      s3(battle, tocka, holder) {
        const init = num(b3.bonus_init_atk), dec = num(b3.bonus_atk_dec_per_sec), dur = num(b3.bonus_duration);
        decayingAtk(battle, holder, ATK + tocka.id, init, dec, dur, tocka);
        if (!up(tocka)) return;
        decayingAtk(battle, tocka, ATK + tocka.id, init, dec, dur, tocka);
        const next = byRatio(battle, tocka, holder)[0];
        if (next) place(battle, tocka, next, 's3', false); // 转移: no 施加 for 雪的印痕
      },
    };

    /** Place 冻河 `tocka`'s effect `kind` on `holder`; `applied` (施加, not a 转移) arms 雪的印痕. */
    function place(battle, tocka, holder, kind, applied = true) {
      const buff = {
        key: effectKey(kind, tocka), source: tocka, tags: ['skill', 'tocka:effect'],
        data: {
          tocka, kind, tockaOn: kind === 's1' ? 'damage' : 'skillStart',
          fire: (b, h, ctx) => { effects[kind](b, tocka, h, ctx); night(b, tocka); },
        },
      };
      // S1: 受到攻击时 — every damage instance but 元素伤害 (see the header)
      if (kind === 's1') buff.observeInjury = (ev) => { if (ev.type !== 'elemental' && ev.target.alive) fire(battle, ev.target, ev.buff, ev); };
      // S2: 技能可开启时 — SP ready and its own target condition met, checked every 0.2 s (its skill start: the shared
      // skillStart hook)
      if (kind === 's2') {
        buff.interval = S2_POLL;
        buff.onTick = ({ battle: b, unit, buff: held }) => { if (castable(unit) && targetMet(unit)) fire(b, unit, held, { reason: 'ready' }); };
      }
      battle.addBuff(holder, buff);
      battle.fx('buff', { x: holder.x, y: holder.y, id: holder.id, kind: 'tocka' });
      if (applied && up(tocka)) battle.addBuff(tocka, { key: SNOW_READY, tags: ['talent'] });
    }

    /** 雪的印痕's burst where one arrow of the armed attack landed on `main` (`hc`: resolveHit's per-victim context). */
    const snowBurst = (battle, unit, main, hc) => {
      const s3 = !!hc.isSkill && unit.skill?.id === S3; // an S3 attack: its scale and its stun
      const scale = (s3 ? num(b3['attack@atk_scale'], 1) : 1) * unit.s.atkScaleMul;
      const type = unit.profile?.dmgType === 'arts' ? 'arts' : 'phys';
      const hit = main.alive ? [main] : [];
      if (snowRadius > 0) {
        for (const e of battle.foesInRadius(main.x, main.y, snowRadius, true)) {
          if (e === main) continue;
          battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type, isAttack: true, isSplash: true, isSkill: !!hc.isSkill,
            attackId: hc.attackId, tags: ['talent', 'tocka:snow'] });
          if (e.alive) hit.push(e);
        }
        battle.fx('aoe', { x: main.x, y: main.y, radius: snowRadius, id: unit.id, skill: 'tocka:snow' });
      }
      for (const e of hit) {
        if (weakVal > 0 && weakDur > 0) battle.applyStatus(e, 'weaken', { duration: weakDur, value: weakVal, source: unit });
        if (dotScale > 0 && weakDur > 0) {
          battle.addBuff(e, {
            key: SNOW_DOT + unit.id, duration: weakDur, interval: 1, source: unit, tags: ['talent', 'dot'],
            onTick: ({ battle: b, unit: t }) => b.dealDamage({ source: unit, target: t, amount: unit.s.atk * dotScale, type: 'arts',
              attackType: 'BUFF', dodgeMode: 'ignore', tags: ['talent', 'dot', 'tocka:snow'] }),
          });
        }
        // [ASSUMED] the attack's on-hit stun reaches every victim of its area (the main target has it from the attack)
        if (s3 && e !== main) battle.applyStatus(e, 'stun', { duration: num(b3['attack@stun']), source: unit });
      }
    };

    return {
      skills: {
        [S1]: {
          kind: kindOf(S1), trigger: 'NEVER', // cast by the kit at full SP with a legal target (install)
          onStart({ battle, unit }) {
            for (const a of s1Picks(battle, unit).slice(0, Math.max(1, Math.floor(num(b1.max_target, 1))))) place(battle, unit, a, 's1');
          },
        },
        [S2]: {
          kind: kindOf(S2), trigger: 'NEVER',
          onStart({ battle, unit }) {
            for (const a of s2Picks(battle, unit).slice(0, Math.max(1, Math.floor(num(b2.max_target, 1))))) place(battle, unit, a, 's2');
          },
        },
        [S3]: {
          kind: 'duration',
          mods: { aspd: num(b3.attack_speed) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(b3['attack@max_target'], 1))) },
          attack: { atkScale: num(b3['attack@atk_scale'], 1), onHitStatus: { key: 'stun', duration: num(b3['attack@stun']) } },
          onStart({ battle, unit }) {
            unit.mem.tockaSpAcc = 0;
            const held = heldEffect(battle, unit, 's3');
            if (held) { fire(battle, held.holder, held.buff, { reason: 'tocka' }); return; }
            const a = byRatio(battle, unit, null)[0];
            if (a) place(battle, unit, a, 's3');
          },
          // 冻河技能期间拥有该效果的干员每秒获得1点技力
          onTick({ battle, unit, dt }) {
            unit.mem.tockaSpAcc = (unit.mem.tockaSpAcc ?? 0) + dt;
            while (unit.mem.tockaSpAcc >= 1 - 1e-9) { // loop-cap: one-second step
              unit.mem.tockaSpAcc -= 1;
              const held = heldEffect(battle, unit, 's3');
              if (held) giveSp(held.holder, num(b3.bonus_sp), 'skill');
            }
          },
        },
      },
      talents: [
        { install(battle, unit) { // 雪的印痕: the armed attack's shots are queued at launch, burst when they land (trait)
          battle.on('attack', ({ attacker, targets }) => {
            if (attacker !== unit || !targets.length) return;
            const snow = !!unit.findBuff(SNOW_READY);
            if (snow) battle.removeBuff(unit, SNOW_READY);
            const q = unit.mem.tockaShots ?? (unit.mem.tockaShots = new Map());
            for (const t of targets) {
              if (!q.has(t.id)) q.set(t.id, []);
              q.get(t.id).push({ snow, t: battle.time });
            }
          }, { owner: unit });
          battle.on('death', ({ unit: e }) => { if (e.side === 'enemy') unit.mem.tockaShots?.delete(e.id); }, { owner: unit });
        } },
      ],
      trait: {
        // her arrow landed on its target: the shot it was (its queue's first record) — the armed attack's arrows burst
        onEachHit(battle, unit, victim, hc) {
          if (hc.kind !== 'main' || !victim) return;
          const shots = unit.mem.tockaShots, q = shots && shots.get(victim.id);
          if (!q) return;
          while (q.length && q[0].t < battle.time - SHOT_MAX_AGE) q.shift(); // loop-cap: shrinks the queue
          const shot = q.shift();
          if (!q.length) shots.delete(victim.id);
          if (shot && shot.snow) snowBurst(battle, unit, victim, hc);
        },
      },
      install(battle, unit) {
        installShared(battle);
        const sid = unit.skill?.id;
        if (sid !== S1 && sid !== S2) return;
        // the AUTO skills: at full SP, with at least one legal target, no enemy needed (see the header)
        battle.on('tick', () => {
          const sk = unit.skill;
          if (!up(unit) || !unit.canAct || !sk || !sk.ready || sk.active || unit.s.flags.silence) return;
          if (battle.time < sk.nextCastAt - 1e-9) return;
          if ((sid === S1 ? s1Picks(battle, unit) : s2Picks(battle, unit)).length) sk.activate('SP_FULL');
        }, { owner: unit });
      },
    };
  },
};
