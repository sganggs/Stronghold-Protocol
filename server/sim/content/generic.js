// server/sim/content/generic.js — generic kit derived from a chess's skill blackboard + skill metadata.
//
// Used for every chess without a hand-authored kit (and for tokens with skills), so every unit fights sensibly.
// Kind: PASSIVE (or a free skill without duration/ammo) ⇒ passive · durationType AMMO ⇒ ammo · duration > 0 ⇒
//   duration · duration < 0 ⇒ ammo when an ammo key exists, toggle only for an explicitly endless skill
//   ("持续时间无限", 史尔特尔) — the official data also uses −1 for instant/charge skills ("立即…", "下一次攻击…",
//   "可充能N次": 夕, 塑心, 妮芙, 莱恩哈特, 流星 …) · otherwise instant (charges when maxCharges > 1).
// Blackboard keys → SkillSpec (stat keys prefer the plain key, attack/targeting keys prefer the `attack@` key —
//   e.g. 薄绿 `attack@atk_scale` 1.1 per hit vs `atk_scale` 2.1 at skill end):
//   atk→mods.atkPct · def→defPct · max_hp→hpPct (values > 5 are flat: 史尔特尔 "生命上限+5000") · attack_speed→aspd
//   base_attack_time→batPct · magic_resistance→resMul (|v| < 1, "法术抗性+60%") or resFlat · damage_scale→dmgDealtMul
//   block_cnt→blockCnt · taunt_level→taunt · damage_resistance→dmgTakenMul (1−v) · hp_recovery_per_sec(_by_max_hp_ratio)
//   →hpRegen(Ratio) · sp_recovery_per_sec→spRecoveryFlat · magic_resist_penetrate_fixed→resIgnoreFlat ·
//   def_penetrate_fixed→defIgnoreFlat · ability_range_forward_extend→targeting.rangeExtend · max_target→targeting.maxTargets
//   atk_scale→attack.atkScale · heal_scale→attack.healScale · times→attack.hits · attack@range_radius→attack.splashRadius
//   trigger_time / ammo→ammo.
// Negative atk/def/magic_resistance described on enemies ("攻击范围内所有敌人防御力-40%", "命中目标的防御力-30%") debuff
//   the targets (aura while the skill runs, or on hit for bb.duration s) instead of the operator.
// Statuses stun/cold/sleep/fear/sluggish/root/unmovable (× prob): `attack@` keys → on hit; plain keys → on hit for
//   instant/charge skills, once at skill start on the enemies in range (≤ max_target) for timed skills (小满 sleeps 3
//   enemies once, not on every attack); a plain `stun` described "…结束后…晕眩" (幽灵鲨, 雷蛇) stuns the operator itself
//   when the skill ends.
// Bursts: a timed skill whose text says "立即…造成…" deals its plain atk_scale once at start (乌尔比安's anchor); "技能结束时
//   …造成…" deals it at the end (薄绿). Those plain scales never become the per-attack scale.
// Text rules: "停止攻击…" (duration skills; not "…之后…") ⇒ no attacks while active (泡泡, 蛇屠箱, 凯瑟琳, 铃兰, 菲莱);
//   "受到攻击时…造成…攻击力/防御力N%的X伤害" ⇒ counter-damage to the attacker (or around the operator when the text says
//   周围) while the skill is active (星熊, 泡泡, 菲莱; aoe_cd = cooldown), never a per-attack scale;
//   "附带…凋亡/灼燃/神经损伤" + ep_damage_ratio ⇒ element damage on hit (× damage dealt when the text says "伤害N%的…损伤",
//   else × ATK); "屏障" + shield_max_hp_ratio / hp_ratio ⇒ self shield at start decaying over its duration (砾, 新约能天使);
//   "立即流失N%当前生命" + hp_ratio ⇒ self HP loss at start (宴, 风丸); hp_ratio + "恢复/回复…生命" ⇒ self heal at start.
// Passive skills with stat mods + bb.duration + "N秒内" use a deployment duration; other passives apply stat mods and the self/counter effects
//   above — their scales describe procs (bombs, sword rain, counters) that need a hand-authored kit.
// force→onHit displacement with the official 力度 − 重量 rules (Battle.push / pullToFront): a pull "至面前" when the text says
//   拖拽 or for hookmasters, else a push — along the unit's direction when the text says 往攻击方向 (the 推击手 wording, PRTS
//   推与拉 方向力) / 朝部署方向 / 向前 / 身前方向 or for 推击手 (directional), otherwise away from the unit (radial); a skill of
//   constants.js PUSH_EFFECT_SKILLS (见行者 S1) pushes by PRTS 推与拉's 特效 column. These keywords are only a fallback:
//   the hand-written kits follow the client's buff templates (knockback[dir] = directional, knockback[relative] = radial),
//   and the text can mislead — 琳琅诗怀雅 S3's "向前推开" is knockback[relative] (kits/tier3.js). No pool skill pushes
//   through this path with 向前 / 往攻击方向; the only generic push is 见行者 S1, a 推击手.

import { normalizeSkill } from '../simdata.js';
import { sortEnemyTargets } from '../targeting.js';
import { PUSH_EFFECT_SKILLS } from '../constants.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v !== '' && Number.isFinite(+v) ? +v : undefined));

/** Plain key first, then `attack@` / `skill@` (stat modifiers). */
function getter(bb) {
  return (k) => {
    for (const key of [k, 'attack@' + k, 'skill@' + k]) {
      const v = num(bb[key]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
}

/** `attack@` key first (per-attack values), then plain / `skill@`. */
function attackGetter(bb) {
  return (k) => {
    for (const key of ['attack@' + k, k, 'skill@' + k]) {
      const v = num(bb[key]);
      if (v !== undefined) return v;
    }
    return undefined;
  };
}

const ENDLESS = /持续时间无限|无限持续/;
const STOP_ATTACK = /(^|[，；。,;])停止(主动)?攻击(敌人)?([，；。,;]|$)/;
const ELEMENTS = [[/凋亡损伤/, 'apoptosis'], [/灼燃损伤/, 'burn'], [/神经损伤/, 'neural']];
const STATUS_KEYS = [['stun', 'stun'], ['cold', 'cold'], ['sleep', 'sleep'], ['fear', 'fear'], ['sluggish', 'sluggish'], ['root', 'bind'], ['unmovable', 'bind']];

/** Decide the skill kind from metadata. */
export function genericKind(sk, bb = {}) {
  if (!sk) return null;
  const g = getter(bb);
  if (sk.kind) return sk.kind;
  if (sk.skillType === 'PASSIVE') return 'passive';
  // a skill that costs no SP and has no duration/ammo is effectively always on (e.g. 迷迭香's shield token)
  if (!(sk.spCost > 0) && sk.durationType !== 'AMMO' && !(sk.duration > 0)) return 'passive';
  if (sk.durationType === 'AMMO') return 'ammo';
  if (sk.duration > 0) return 'duration';
  if (sk.duration < 0) {
    if (g('trigger_time') !== undefined || g('ammo') !== undefined) return 'ammo';
    if (ENDLESS.test(String(sk.description || ''))) return 'toggle';
  }
  return sk.maxCharges > 1 ? 'charges' : 'instant';
}

function dmgTypeFromText(text, fallback) {
  if (/法术伤害/.test(text)) return 'arts';
  if (/物理伤害/.test(text)) return 'phys';
  if (/真实伤害/.test(text)) return 'true';
  return fallback === 'heal' || fallback === 'none' || !fallback ? 'phys' : fallback;
}

/** Enemies currently in the unit's range, best targets first (at most `n`). */
function enemiesInRange(battle, unit, n) {
  const list = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
  sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}

/** Build a SkillSpec from a normalised skill def and its blackboard. `def` (optional) = normalised unit def. */
export function genericSkillSpec(sk, bb = sk?.bb ?? {}, def = null) {
  if (!sk) return null;
  const g = getter(bb);
  const ga = attackGetter(bb);
  let kind = genericKind(sk, bb);
  const desc = String(sk.description || '');
  // "受到攻击时…造成…" numbers belong to a counter effect (the operator's own, or an ally's: 刺玫 "该角色受到攻击时")
  const counterCtx = /受到(敌人的)?攻击时/.test(desc);
  const counterText = counterCtx && !/该(角色|干员|单位)受到攻击时/.test(desc);

  // ---- stat mods (self) and target debuffs
  const mods = {};
  const debuff = {};
  const set = (k, v) => { if (v !== undefined && Number.isFinite(v) && v !== 0) mods[k] = (mods[k] ?? 0) + v; };
  const onEnemies = (stat) => new RegExp(`(敌人|目标|敌方)[^。；]*${stat}-`).test(desc);
  const pctOrFlat = (v, pctKey, flatKey, target) => { if (v === undefined || v === 0) return; if (Math.abs(v) > 5) target[flatKey] = (target[flatKey] ?? 0) + v; else target[pctKey] = (target[pctKey] ?? 0) + v; };
  const atk = g('atk');
  if (atk !== undefined && atk < 0 && onEnemies('攻击力')) pctOrFlat(atk, 'atkPct', 'atkFlat', debuff); else pctOrFlat(atk, 'atkPct', 'atkFlat', mods);
  const defv = g('def');
  if (defv !== undefined && defv < 0 && onEnemies('防御力')) pctOrFlat(defv, 'defPct', 'defFlat', debuff); else pctOrFlat(defv, 'defPct', 'defFlat', mods);
  pctOrFlat(g('max_hp'), 'hpPct', 'hpFlat', mods);
  set('aspd', g('attack_speed'));
  const bat = g('base_attack_time');
  if (bat !== undefined && bat !== 0) mods.batPct = Math.max(-0.9, bat);
  const mr = g('magic_resistance');
  if (mr !== undefined && mr !== 0) {
    const tgt = mr < 0 && onEnemies('法术抗性') ? debuff : mods;
    if (Math.abs(mr) < 1) tgt.resMul = (tgt.resMul ?? 1) * Math.max(0, 1 + mr);
    else tgt.resFlat = (tgt.resFlat ?? 0) + mr;
  }
  const ds = g('damage_scale');
  if (ds !== undefined && ds > 0) mods.dmgDealtMul = ds;
  set('blockCnt', g('block_cnt'));
  set('taunt', g('taunt_level'));
  const dr = g('damage_resistance');
  if (dr !== undefined && dr > 0 && dr < 1) mods.dmgTakenMul = 1 - dr;
  // negative regen keys describe enemies ("受到的治疗和回复效果降低50%", 引星棘刺): never a self drain
  const hrs = g('hp_recovery_per_sec'), hrr = g('hp_recovery_per_sec_by_max_hp_ratio');
  if (hrs > 0) set('hpRegen', hrs);
  if (hrr > 0) set('hpRegenRatio', hrr);
  set('spRecoveryFlat', g('sp_recovery_per_sec'));
  set('resIgnoreFlat', g('magic_resist_penetrate_fixed'));
  set('defIgnoreFlat', g('def_penetrate_fixed'));

  // Effect inference keeps the original kind; a deployment window only changes the lifecycle.
  const passive = kind === 'passive';
  const timed = kind === 'duration' || kind === 'ammo' || kind === 'toggle';
  const passiveTimed = passive && Object.keys(mods).length && num(bb.duration) > 0 && /\d+(\.\d+)?秒内/.test(desc) ? num(bb.duration) : 0;
  if (passiveTimed) kind = 'duration';

  // ---- targeting / attack override (never for passives: their scales describe procs)
  const targeting = {};
  const attack = {};
  if (passiveTimed && /攻击[^。；]*(造成|变为|变成)[^。；]*法术伤害|伤害类型变为法术/.test(desc)) attack.dmgType = 'arts';
  const mt = ga('max_target');
  if (!passive && mt !== undefined && mt > 0) targeting.maxTargets = Math.floor(mt);
  const ext = g('ability_range_forward_extend');
  if (!passive && ext !== undefined && ext > 0) targeting.rangeExtend = Math.round(ext);
  if (!passive && sk.rangeGrid && sk.rangeGrid.length) targeting.rangeGrid = sk.rangeGrid;

  const atkAt = num(bb['attack@atk_scale']);
  const atkPlain = num(bb.atk_scale) ?? num(bb['skill@atk_scale']);
  const startBurst = timed && atkPlain !== undefined && /立即[^。]*造成/.test(desc) ? atkPlain : undefined;
  const endBurst = timed && atkPlain !== undefined && /技能结束时[^。]*造成[^。]*攻击力/.test(desc) ? atkPlain : undefined;
  const counterScale = counterText && atkPlain !== undefined && atkAt === undefined ? atkPlain : undefined;
  // "额外造成攻击力N%的…伤害" is bonus damage on top of the attack (烛煌), not the attack's own scale
  const isExtra = (v) => v !== undefined && [...desc.matchAll(/额外(造成|附带)[^。；]*?攻击力(\d+(\.\d+)?)%/g)].some((m) => Math.abs(+m[2] - v * 100) < 1e-6);
  // a non-healer whose skill "恢复…一名(其他)友方…生命" (古米, 瑕光): its hits heal the most injured ally nearby
  const healerUnit = !!def && (def.dmgType === 'heal' || def.profession === 'MEDIC');
  const allyHealScale = ga('heal_scale');
  const allyHeal = !passive && !!def && !healerUnit && allyHealScale > 0 && /(恢复|治疗)[^。]*友(方|军)[^。]*生命/.test(desc);
  const allyHealOthersOnly = /其他友(方|军)/.test(desc);
  const allyHealAll = /所有友(方|军)/.test(desc); // 塞雷娅: heals every injured ally in the skill range
  if (!passive) {
    let as = isExtra(atkAt) ? undefined : atkAt;
    if (as === undefined && atkAt === undefined && atkPlain !== undefined && !counterCtx && !isExtra(atkPlain) && startBurst === undefined && endBurst === undefined) as = atkPlain;
    if (as !== undefined && as > 0) attack.atkScale = as;
    const hs = ga('heal_scale');
    if (hs !== undefined && hs > 0 && !allyHeal) attack.healScale = hs;
    const times = ga('times');
    if (times !== undefined && times > 1) attack.hits = Math.min(10, Math.floor(times));
    const rr = num(bb['attack@range_radius']);
    if (rr !== undefined && rr > 0 && rr < 5) attack.splashRadius = rr;
    if (kind === 'duration' && STOP_ATTACK.test(desc) && !/之后/.test(desc)) attack.noAttack = true;
  }

  // ---- statuses
  const hitStatuses = [];
  const startStatuses = [];
  let selfStunOnEnd = 0;
  if (!passive) {
    for (const [key, status] of STATUS_KEYS) {
      const onAtk = num(bb['attack@' + key]);
      const plain = num(bb[key]) ?? num(bb['skill@' + key]);
      if (onAtk !== undefined && onAtk > 0) hitStatuses.push({ key: status, duration: onAtk });
      if (plain !== undefined && plain > 0 && !(onAtk > 0 && plain === onAtk)) {
        if (key === 'stun' && /结束后[^，。；]*晕眩/.test(desc)) selfStunOnEnd = plain;
        else if (timed) startStatuses.push({ key: status, duration: plain });
        else if (!(onAtk > 0)) hitStatuses.push({ key: status, duration: plain });
      }
    }
  }
  const prob = g('prob');
  const rollProb = (battle) => !(prob !== undefined && prob > 0 && prob < 1) || battle.rng.chance(prob);

  // ---- element damage attached to hits / counters
  let element = null;
  const epr = g('ep_damage_ratio');
  if (epr !== undefined && epr > 0 && /附带/.test(desc) && !/其他友方/.test(desc)) {
    const el = ELEMENTS.find(([re]) => re.test(desc));
    if (el) element = { el: el[1], ratio: epr, ofDamage: /伤害\d+(\.\d+)?%的[^。，；]{0,3}损伤/.test(desc) };
  }
  const applyElement = (battle, unit, target, dealt) => {
    if (!element || !target || !target.alive) return;
    const amount = element.ofDamage ? (dealt || 0) * element.ratio : unit.s.atk * element.ratio;
    if (amount > 0) battle.dealDamage(unit, target, { type: 'element', element: element.el, amount, tags: ['skill'] });
  };

  // ---- displacement
  const forceRaw = g('force');
  const hasForce = !passive && forceRaw !== undefined;
  const force = forceRaw ?? 0; // 力度 (微小力 −1 … 特大力 5)
  const pull = /拖拽/.test(desc) || (!/推开|击退/.test(desc) && def && def.subProf === 'hookmaster');
  const directional = !pull && (/攻击方向|朝部署方向|向前|身前方向/.test(desc) || (def && def.subProf === 'pusher'));
  const effectPush = PUSH_EFFECT_SKILLS.has(sk.id);
  const hitElement = element && !counterText;

  const healAlly = (battle, unit) => {
    if (allyHealAll) {
      for (const a of battle.injuredAlliesInKeys(unit.rangeKeys, unit)) if (!(allyHealOthersOnly && a === unit)) battle.heal(unit, a, unit.s.atk * allyHealScale);
      return;
    }
    let best = null;
    for (const a of battle.injuredAlliesInKeys(unit.rangeKeys, unit)) if (!(allyHealOthersOnly && a === unit)) { best = a; break; }
    if (!best) best = battle.alliesInRadius(unit.x, unit.y, 1.5, null).filter((a) => a.hp < a.s.maxHp && !(allyHealOthersOnly && a === unit) && (a === unit || !(a.s.flags.noHeal || a.profile?.noHeal))).sort((a, b) => a.hpRatio - b.hpRatio)[0] ?? null;
    if (best) battle.heal(unit, best, unit.s.atk * allyHealScale);
  };
  const onHit = hitStatuses.length || hasForce || hitElement || allyHeal
    ? (ctx) => {
      if (allyHeal) healAlly(ctx.battle, ctx.unit);
      if (!ctx.target || !ctx.target.alive) return;
      if (hitElement) applyElement(ctx.battle, ctx.unit, ctx.target, ctx.dealt);
      if (hitStatuses.length && rollProb(ctx.battle)) {
        for (const s of hitStatuses) ctx.battle.applyStatus(ctx.target, s.key, { duration: s.duration, source: ctx.unit });
      }
      if (hasForce && ctx.target.alive && ctx.target.side === 'enemy') {
        const u = ctx.unit;
        if (pull) ctx.battle.pullToFront(ctx.target, u, force);
        else ctx.battle.push(ctx.target, force, { from: u, dir: directional && u.fwd ? { x: u.fwd[1], y: u.fwd[0] } : null, effect: effectPush });
      }
    }
    : null;

  // target debuffs: aura over the range while a timed skill runs, else on hit for bb.duration (default 5 s)
  const hasDebuff = Object.keys(debuff).length > 0 && !passive;
  const debuffKey = `generic:debuff:${sk.id ?? 'skill'}`;
  const aura = hasDebuff && timed && /攻击范围内[^。；]*敌人/.test(desc);
  const debuffDur = timed ? 5 : (num(bb.duration) > 0 ? num(bb.duration) : 5);
  let onHitFinal = onHit;
  if (hasDebuff && !aura) {
    const base = onHit;
    onHitFinal = (ctx) => {
      if (base) base(ctx);
      if (ctx.target && ctx.target.alive) ctx.battle.addBuff(ctx.target, { key: debuffKey, duration: debuffDur, mods: { ...debuff }, refresh: 'extend', source: ctx.unit });
    };
  }
  if (onHitFinal) attack.onHit = onHitFinal;

  let ammo;
  if (kind === 'ammo') ammo = Math.max(1, Math.floor(g('trigger_time') ?? g('ammo') ?? g('cnt') ?? 8));

  const spec = {
    id: sk.id,
    name: sk.name,
    kind,
    duration: kind === 'duration' ? (passiveTimed || sk.duration) : (kind === 'ammo' && sk.duration > 0 ? sk.duration : undefined),
    ammo,
  };

  if (passiveTimed) Object.assign(spec, { activateOnDeploy: true, spCost: 0, spType: 'none', trigger: 'NEVER' });
  if (Object.keys(mods).length) spec.mods = mods;
  if (Object.keys(targeting).length) spec.targeting = targeting;
  // instant/charges skills act on the next attack: mods/targeting without an explicit attack still need one
  if (!Object.keys(attack).length && (kind === 'instant' || kind === 'charges') && (spec.mods || spec.targeting)) spec.attack = {};
  if (Object.keys(attack).length) spec.attack = attack;

  // ---- start / end effects
  const starts = [];
  const ends = [];
  const hr = g('hp_ratio');
  if (hr !== undefined && hr > 0 && hr <= 1 && /立即流失\d+(\.\d+)?%(的)?当前生命/.test(desc)) {
    starts.push(({ battle, unit }) => { const loss = unit.hp * hr; if (loss > 0 && unit.hp - loss >= 1) battle.loseHp(unit, loss, { source: unit }); });
  } else if (hr !== undefined && hr > 0 && hr <= 1 && /(恢复|回复)[^。，]*生命/.test(desc) && !/流失/.test(desc)) {
    starts.push(({ battle, unit }) => battle.heal(unit, unit, unit.s.maxHp * hr, { self: true }));
  }
  const shieldRatio = /屏障/.test(desc) ? (g('shield_max_hp_ratio') ?? (/生命(上限|值)?\d+(\.\d+)?%的屏障/.test(desc) ? hr : undefined)) : undefined;
  if (shieldRatio !== undefined && shieldRatio > 0) {
    const dur = g('shield_max_duration') ?? num(bb.duration) ?? (sk.duration > 0 ? sk.duration : 0);
    const decays = /衰减/.test(desc) && dur > 0;
    starts.push(({ battle, unit }) => {
      const total = unit.s.maxHp * shieldRatio;
      battle.addBuff(unit, {
        key: `generic:shield:${sk.id ?? 'skill'}`, shield: total, duration: dur > 0 ? dur : Infinity, visible: true, interval: decays ? 0.5 : 0,
        onTick: decays ? ({ unit: u, buff }) => { buff.shield = Math.max(0, buff.shield - total * 0.5 / dur); u.markDirty(); } : null,
      });
    });
  }
  const burst = (scale) => ({ battle, unit }) => {
    const type = dmgTypeFromText(desc, unit.profile?.dmgType ?? 'phys');
    for (const e of enemiesInRange(battle, unit, 0)) {
      const dealt = battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type, isSkill: true, tags: ['skill', 'burst'] });
      applyElement(battle, unit, e, dealt);
    }
  };
  if (startBurst !== undefined && startBurst > 0) starts.push(burst(startBurst));
  if (startStatuses.length) {
    const n = mt !== undefined && mt > 0 ? Math.floor(mt) : 0;
    starts.push(({ battle, unit }) => {
      for (const e of enemiesInRange(battle, unit, n)) for (const s of startStatuses) battle.applyStatus(e, s.key, { duration: s.duration, source: unit });
    });
  }
  if (endBurst !== undefined && endBurst > 0) {
    const b = burst(endBurst);
    ends.push((ctx) => { if (ctx.reason !== 'death' && ctx.unit.alive) b(ctx); });
  }
  if (selfStunOnEnd > 0) {
    ends.push((ctx) => { if (ctx.reason !== 'death' && ctx.unit.alive) ctx.battle.applyStatus(ctx.unit, 'stun', { duration: selfStunOnEnd, source: ctx.unit }); });
  }
  if (starts.length) spec.onStart = (ctx) => { for (const f of starts) f(ctx); };
  if (ends.length) spec.onEnd = (ctx) => { for (const f of ends) f(ctx); };
  if (aura) {
    const m = { ...debuff };
    spec.onTick = ({ battle, unit }) => {
      for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) battle.addBuff(e, { key: debuffKey, duration: 0.5, mods: m, refresh: 'extend', source: unit });
    };
  }

  // ---- counter-damage while the skill is active ("受到攻击时对目标造成…攻击力/防御力N%的X伤害")
  if (counterText && (counterScale !== undefined || element)) {
    const m = desc.match(/受到(敌人的)?攻击时[^。]*?(攻击力|防御力)(\d+(\.\d+)?)%的(物理|法术|真实)伤害/);
    spec.counter = {
      scale: counterScale ?? 0,
      stat: m && m[2] === '防御力' ? 'def' : 'atk',
      type: m ? dmgTypeFromText(m[5] + '伤害', 'phys') : 'phys',
      around: /受到(敌人的)?攻击时对周围/.test(desc),
      groundOnly: /周围的地面敌人/.test(desc),
      cooldown: num(bb.aoe_cd) ?? 0,
      applyElement: element ? applyElement : null,
    };
  }
  return spec;
}

/** Per-unit hooks for the generic spec (counter-damage). */
function installGeneric(spec) {
  const c = spec && spec.counter;
  if (!c) return null;
  return (battle, unit) => {
    let readyAt = -Infinity;
    battle.on('damaged', (ctx) => {
      if (ctx.target !== unit || !unit.alive || !unit.skill?.active || battle.time < readyAt) return;
      const src = ctx.source;
      if (!src || src.side !== 'enemy' || !ctx.dmg || !ctx.dmg.isAttack) return;
      readyAt = battle.time + c.cooldown;
      const amount = (c.stat === 'def' ? unit.s.def : unit.s.atk) * c.scale;
      const victims = c.around ? battle.foesInRadius(unit.x, unit.y, 1.5).filter((e) => !(c.groundOnly && e.isFlying)) : (src.alive ? [src] : []);
      for (const e of victims) {
        const dealt = amount > 0 ? battle.dealDamage(unit, e, { amount, type: c.type, canDodge: false, isSkill: true, tags: ['counter'] }) : 0;
        if (c.applyElement) c.applyElement(battle, unit, e, dealt);
      }
    }, { owner: unit });
  };
}

/**
 * Generic kit: `(bb, chess, def?) => Kit`. `chess` is the data record; `def` the normalised def when available.
 */
export function genericKit(bb, chess, def = null) {
  const sk = def?.skill ?? normalizeSkill(chess);
  if (!sk) return { skill: null, talents: [], generic: true };
  const spec = genericSkillSpec(sk, bb && Object.keys(bb).length ? bb : sk.bb, def);
  const kit = { skill: spec, talents: [], generic: true };
  const inst = installGeneric(spec);
  if (inst) kit.install = inst;
  return kit;
}

export default genericKit;
