// server/sim/content/kits/ops/chess_char_5_08-horn.js — 号角 (char_4039_horn) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { bodyInRadius } from '../../../body.js';
import {
  AURA_IV, AURA_DUR, num, talent, traitBb, batPct, mods, isOp, selectedId, lazySkills, instantKind, whileOn,
} from '../shared/tier5.js';

/** 号角 S2 过载: the second half of the ammo (PRTS 术语 过载: "弹药剩余量降至初始弹药量的一半时"). */
const HORN_S2_OVERLOAD_AT = 0.5;

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 号角 — S3 终极防线 (24 s in total, a two-segment gauge — PRTS 备注: "技能进行到一半时触发额外效果"): ATK +, BAT −1.2 s
  // for the first 12 s, then 过载 for the remaining damage_duration (12) s: ATK changes to +50 %, HP loss ramping to 12 %
  // max HP/s at the end. T1 军事要塞: all Defenders ATK +20 % while she is on the field.
  // T2 血战: once per deployment, lethal damage → full heal, max HP −50 %, ASPD +18, DEF +18 %.
  // Module (elite): ×1.1 vs blocked enemies.
  // S1 照明榴弹 (instant / 2 charges elite, 自动触发 ⇒ DEFAULT): next attack atk_scale × ATK; a ranged (unblocked) one also
  // splashes projectile_range and lights the impact for projectile_delay_time s (enemies within projectile_range lose
  // 隐匿). S2 暴风号令 (ammo 10): every attack attack@s2.atk_scale × ATK phys splash; 过载 for the second half of the
  // ammo (PRTS 术语 过载): + attack@s2.magic_atk_scale × ATK arts to every enemy hit (manual close never happens in the
  // auto battle). Module FOR-Y (elite): ASPD +10 while not blocking.
  // S2 and S3 cast with an enemy in range (data DEFAULT, rawRule TAKE_DAMAGE): the owner's deliberate deviation from the
  // official 重装 TAKE_DAMAGE row (DESIGN §21.29, tools/build-data.mjs TRIGGER_DEVIATIONS).
  chess_char_5_08_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess), tm = talent(chess, -1);
    const sid = selectedId(chess, def);
    const s2Ammo = Math.max(1, num(bb['attack@s2.trigger_time'], 10));
    const total = Math.max(0.1, num(def?.skill?.duration, num(chess?.skill?.duration, 24)));
    const ovAtk = num(bb['horn_s_3[overload_start].atk'], num(bb.atk));
    const ovIv = Math.max(0.05, num(bb['horn_s_3[overload_start].interval'], 0.2));
    const ovPeak = num(bb['horn_s_3[overload_start].hp_ratio']);
    const ovRamp = Math.max(0.1, Math.min(total, num(bb['horn_s_3[overload_start].damage_duration'], total / 2)));
    const main = total - ovRamp;
    const blockedMul = num(tb.atk_scale);
    return {
      skills: lazySkills({
        skchr_horn_1: () => ({
          kind: instantKind(chess, def), // 自动触发 "下次攻击": the data rule DEFAULT (an AUTO skill takes no 技能策略)
          attack: {
            atkScale: num(bb.atk_scale, 1),
            onHit({ battle, unit, x, y }) {
              if (!unit.mem.hornFlare) return;
              unit.mem.hornFlare = false;
              (unit.mem.flares ??= []).push({ x, y, until: battle.time + num(bb.projectile_delay_time, 6) });
              battle.fx('zone', { x, y, id: unit.id, r: num(bb.projectile_range, 1.7), duration: num(bb.projectile_delay_time, 6) });
            },
          },
        }),
        skchr_horn_2: () => ({
          kind: 'ammo', ammo: s2Ammo,
          attack: { atkScale: num(bb['attack@s2.atk_scale'], 1) },
          onStart({ unit }) { unit.mem.hornS2Over = false; },
          onEnd({ unit }) { unit.mem.hornS2Over = false; },
        }),
      }),
      skill: {
        kind: 'duration', duration: total,
        mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
        onStart({ unit }) { unit.mem.hornT = 0; unit.mem.hornAcc = 0; unit.mem.overload = false; },
        onTick({ battle, unit, dt }) {
          unit.mem.hornT += dt;
          if (!unit.mem.overload && unit.mem.hornT >= main - 1e-9) {
            unit.mem.overload = true;
            const delta = ovAtk - num(bb.atk);
            battle.addBuff(unit, { key: 'horn:overload', visible: true, mods: mods({ atkPct: delta }) });
            battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
          }
          if (!unit.mem.overload || !(ovPeak > 0)) return;
          unit.mem.hornAcc += dt;
          while (unit.mem.hornAcc >= ovIv && unit.alive) {
            unit.mem.hornAcc -= ovIv;
            const rate = ovPeak * Math.min(1, (unit.mem.hornT - main) / ovRamp);
            if (rate > 0) battle.loseHp(unit, unit.s.maxHp * rate * ovIv, { source: unit, silent: true });
          }
        },
        onEnd({ battle, unit }) { unit.mem.overload = false; battle.removeBuff(unit, 'horn:overload'); },
      },
      trait: blockedMul > 1 ? { dmgMul: (b, u, t) => (t && t.blockedBy ? blockedMul : 1) } : undefined,
      talents: [
        { install(battle, unit) { // 军事要塞
          const atk = num(t0.atk);
          if (!atk) return;
          whileOn(battle, unit, AURA_IV, () => {
            for (const a of battle.allies()) if (isOp(a) && a.def?.profession === 'TANK') battle.addBuff(a, { key: 'horn:fortress', duration: AURA_DUR, mods: { atkPct: atk } });
          });
        } },
        { install(battle, unit) { // 血战
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.bloodBattle = false; }, { owner: unit });
          battle.on('fatal', (c) => {
            if (c.unit !== unit || c.prevented || unit.mem.bloodBattle) return;
            c.prevented = true;
            unit.mem.bloodBattle = true;
            battle.addBuff(unit, { key: 'horn:bloodBattle', visible: true, mods: mods({ hpMul: 1 - num(t1.max_hp), aspd: num(t1.attack_speed), defPct: num(t1.def) }) });
            unit.hp = Math.max(1, unit.hp);
            battle.heal(unit, unit, unit.s.maxHp * num(t1.hp_ratio, 1), { self: true });
            battle.fx('bloodBattle', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: -40 });
        } },
      ],
      install(battle, unit) {
        const aspd = num(tm.attack_speed); // FOR-Y: 不阻挡敌人时…攻击速度+10
        if (aspd) whileOn(battle, unit, 0.2, () => { if (!unit.blocking.length) battle.addBuff(unit, { key: 'horn:moduleY', duration: 0.3, mods: { aspd } }); });
        if (sid === 'skchr_horn_1') {
          // the pending shot: a ranged (unblocked) attack widens its splash and lights the impact
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.pending || !c.profile) return;
            unit.mem.hornFlare = !c.profile._fortressMelee;
            if (unit.mem.hornFlare) c.profile.splashRadius = Math.max(num(c.profile.splashRadius), num(bb.projectile_range, 1.7));
          }, { owner: unit, priority: -100 });
          battle.every(AURA_IV, () => {
            const fl = unit.mem.flares;
            if (!fl || !fl.length) return;
            unit.mem.flares = fl.filter((f) => f.until > battle.time + 1e-9);
            const r = num(bb.projectile_range, 1.7);
            for (const f of unit.mem.flares) for (const e of battle.enemies) {
              if (e.alive && !e.hidden && bodyInRadius(e, f.x, f.y, r)) battle.applyStatus(e, 'reveal', { duration: AURA_DUR, source: unit });
            }
          }, { owner: unit });
        }
        if (sid === 'skchr_horn_2') {
          const magic = num(bb['attack@s2.magic_atk_scale']);
          battle.on('beforeAttack', (c) => { // 过载: the second half of the ammo
            if (c.attacker !== unit || !unit.skill?.active || !c.profile) return;
            const shot = s2Ammo - num(unit.skill.ammoLeft) + 1;
            const over = shot > s2Ammo * HORN_S2_OVERLOAD_AT + 1e-9;
            if (over && !unit.mem.hornS2Over) battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id });
            unit.mem.hornS2Over = over;
            if (!over || !(magic > 0)) return;
            // decided at the shot (a shell still in flight when the skill ends keeps it): the effective profile of this
            // attack (a per-attack copy while the skill runs) carries the extra arts splash on every enemy it hits
            const prev = c.profile.onEachHit;
            c.profile.onEachHit = (b, u, victim, hc) => {
              if (prev) prev(b, u, victim, hc);
              if (victim && victim.alive && victim.side === 'enemy') b.dealDamage(unit, victim, { amount: unit.s.atk * magic, type: 'arts', isSkill: true, isSplash: true, tags: ['skill', 'hornOverload'] });
            };
          }, { owner: unit, priority: -100 });
        }
      },
    };
  },
};
