// server/sim/content/kits/ops/chess_char_3_12-blemsh.js — 瑕光 (char_423_blemsh) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { bodyKeys, bodyOnTile } from '../../../body.js';
import {
  num, defOf, talentBb, traitBb, altSkills, instantKindOf, alive, onTiles, gridKeys, fx, copyGrid, NINE, isLeader,
  giveSp,
} from '../shared/tier3.js';

/** Refresh period (s) of 瑕光 S2's 生命回复速度 buff (it lasts two periods, so it never lapses while the skill runs). */
const REGEN_IV = 0.25;

export default {
  // ---- 3_12 瑕光 · 守护者 — S3 先贤化身: ATK/DEF +, bonus arts per hit, heals another nearby ally per attack;
  //      剑盾骑士: hurt-SP skills of the team also gain SP on attack; 仁慈: attacks sleeping enemies (first, ×atk_scale);
  //      精锐 module GUA-Y: damage taken −15 %
  //      S1 光芒涌动 (自动触发 ⇒ DEFAULT, charges): next attack ×atk_scale phys + heals the most injured ally of the 3×3 (herself
  //      included) for heal_scale × ATK; S2 慑敌辉光: ATK +, puts every ground enemy on her own tile and every enemy she
  //      blocks to sleep (PRTS 备注; for the skill's duration: no own value in the data) and gives every ally of the
  //      skill range 生命回复速度 +ATK × ratio while it runs (PRTS 技能2 备注 "生命恢复的提供方式为基于自己的攻击力，增加目标的
  //      “生命回复速度”属性，不受治疗加成和禁疗影响": an hpRegen buff, no heal — GitHub #137). While S2 runs, a sleeping
  //      ground enemy on the rotated x-1 is extra attack range; 1-1 itself is unchanged and an awake enemy in the diamond
  //      is not [ASSUMED] (community 2026-10-14, §32.14.8);
  //      精锐 module GUA-X: her heals on allies under hp_ratio HP × heal_scale
  chess_char_3_12_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const bonus = num(bb['attack@blemsh_s_3_extra_dmg[magic].atk_scale'], 0);
    const heal = num(bb.heal_scale, 0);
    const healGrid = copyGrid(d.skill?.rangeGrid) ?? NINE;
    const mercy = num(t1.atk_scale, 1);
    const sleepersInRange = (battle, unit) => {
      const set = unit.rangeKeySet;
      return set ? battle.enemies.filter((e) => e.alive && !e.hidden && e.s.flags.sleep && !e.s.flags.untargetable && !e.isFlying && onTiles(e, set)) : [];
    };
    const kit = {
      trait: { hitSleep: true }, // 仁慈: 自身可以攻击…沉睡的目标 (沉睡 = 无敌 for everyone else)
      skill: {
        kind: 'duration',
        // Source: author video BV1UdAHzNEVj + maintainer confirmation 2026-10-24 (§35.91).
        // 技能开启: with an attackable target in range — the basic strategy, DEFAULT —
        // at full HP too. The data's 重装 row (TAKE_DAMAGE: "受到伤害时释放技能") made a full-HP 瑕光 hold S3 with its SP
        // ready: she opened it only after a hit, so an untouched guardian never cast. The condition is the engine's own
        // target search (the DEFAULT rule: acquireTargets / the enemies she blocks), not a check of the kit's own.
        trigger: 'DEFAULT',
        mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
        heal: false,
        attack: { onHit({ battle, unit, target }) {
          if (bonus > 0 && target && target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * bonus, type: 'arts', isSkill: true, tags: ['skill', 'blemshBonus'] });
        } },
        onAttack({ battle, unit }) {
          if (!(heal > 0)) return;
          const ally = battle.injuredAlliesInKeys(new Set(gridKeys(healGrid, unit)), unit).find((a) => a !== unit);
          if (ally) battle.heal(unit, ally, unit.s.atk * heal);
        },
      },
      skills: altSkills(chess, d, bb, {
        skchr_blemsh_1: (s) => {
          const grid = copyGrid(s.rangeGrid) ?? NINE;
          const hs = num(s.bb.heal_scale, 0);
          return {
            kind: instantKindOf(s),
            heal: false,
            attack: {
              atkScale: num(s.bb.atk_scale, 1),
              onHit({ battle, unit }) { // "恢复周围一名友方单位"
                const ally = hs > 0 ? battle.injuredAlliesInKeys(new Set(gridKeys(grid, unit)), unit)[0] : null;
                if (ally) battle.heal(unit, ally, unit.s.atk * hs);
              },
            },
          };
        },
        skchr_blemsh_2: (s) => {
          const grid = copyGrid(s.rangeGrid) ?? NINE;
          const ratio = num(s.bb['attack@atk_to_hp_recovery_ratio'], num(s.bb.atk_to_hp_recovery_ratio, 0));
          // "周围的所有友方单位每秒恢复相当于攻击力N%的生命值": an hpRegen buff on every ally on the skill range's tiles (no
          // device, no 孤立 unit), refreshed every REGEN_IV while the skill runs and removed at its end [ASSUMED: from the
          // start of the skill — unlike 铃兰's, the note names no delay]
          const regenKey = (unit) => `blemsh:regen:${unit.id}`;
          const regen = (battle, unit) => {
            if (!(ratio > 0)) return;
            const keys = new Set(gridKeys(grid, unit));
            const v = unit.s.atk * ratio;
            for (const a of battle.allyUnits) {
              if (!a.alive || !a.deployed || a.hidden || a.kind === 'device' || !onTiles(a, keys) || !battle.allySelectable(a, unit)) continue;
              battle.addBuff(a, { key: regenKey(unit), duration: REGEN_IV * 2, source: unit, mods: { hpRegen: v } });
            }
          };
          // [ASSUMED] The skill text does not change her attack range (1-1). rangeId x-1 is the 技能范围 (the ally
          // 生命回复速度 aura, and — while the skill runs — where a sleeping ground enemy stays hittable). A sleeper she
          // was blocking stands off her tile; 沉睡 releases the block (§24.9) and 1-1 facing the other way does not
          // cover that side tile, so 仁慈 could not acquire them (community report 2026-10-14: facing down, the sleeping
          // enemies on her left and right). Only those sleepers' tiles are extra range — an awake enemy in the diamond
          // is not. x-1 also contains the tile behind her, so a sleeper there is hittable only during S2.
          const sleepRange = (battle, unit) => {
            const area = new Set(gridKeys(grid, unit));
            const extra = [];
            const seen = new Set();
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || e.isFlying || !e.s.flags.sleep || e.s.flags.untargetable) continue;
              for (const k of bodyKeys(e)) {
                if (!area.has(k) || seen.has(k)) continue;
                seen.add(k);
                extra.push(k);
              }
            }
            extra.sort((a, b) => a - b);
            const sig = extra.join(',');
            if (sig === (unit.mem.blemshSleepSig ?? '')) return;
            unit.mem.blemshSleepSig = sig;
            battle.setExtraRange(unit, extra.length ? extra : null);
          };
          return {
            kind: 'duration',
            heal: false,
            mods: { atkPct: num(s.bb.atk) },
            onStart({ battle, unit, skill }) {
              const dur = skill.timeLeft > 0 ? skill.timeLeft : Math.max(0.1, num(s.duration, 10));
              let n = 0;
              // PRTS 备注: "技能生效对象实际为“自身这格内的所有地面敌人及自身阻挡的敌人”，即使阻挡的是飞行敌人" — a blocked
              // enemy stands at the block radius, outside her tile (Battle._checkBlock). Asleep they are no longer blocked
              // (沉睡 = 不可阻挡, DESIGN §24.9; GitHub #140): her slots free for the next enemies, and a sleeper that wakes
              // is held again only while she has room
              for (const e of battle.enemies) {
                if (!e.alive || e.hidden) continue;
                if (e.blockedBy !== unit && (e.isFlying || !bodyOnTile(e, unit.tileR, unit.tileC))) continue;
                if (battle.applyStatus(e, 'sleep', { duration: dur, source: unit })) n++;
              }
              fx(battle, 'aoe', unit, { radius: 0.5, skill: 'blemsh_2', status: 'sleep', n });
              unit.mem.blemshRegen = 0;
              unit.mem.blemshSleepSig = null;
              sleepRange(battle, unit);
              regen(battle, unit);
            },
            onTick({ battle, unit, dt }) {
              sleepRange(battle, unit);
              unit.mem.blemshRegen = (unit.mem.blemshRegen ?? 0) + dt;
              if (unit.mem.blemshRegen < REGEN_IV - 1e-9) return;
              unit.mem.blemshRegen = 0;
              regen(battle, unit);
            },
            onEnd({ battle, unit }) {
              unit.mem.blemshSleepSig = '';
              battle.setExtraRange(unit, null);
              for (const a of battle.allyUnits) if (a.findBuff(regenKey(unit))) battle.removeBuff(a, regenKey(unit));
            },
          };
        },
      }),
      talents: [
        { install(battle, unit) {
          unit.mem.blemshKnight = true;
          battle.on('attack', (ctx) => {
            const a = ctx.attacker;
            if (!a || a.kind !== 'op' || a.ownerId !== unit.ownerId || a.skill?.spType !== 'hurt') return;
            if (!alive(unit) || !isLeader(battle, unit, 'blemshKnight')) return;
            giveSp(a, num(t0.sp, 1), 'talent');
          }, { owner: unit });
        } },
        { install(battle, unit) {
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit) return;
            const s = sleepersInRange(battle, unit);
            if (s.length) ctx.targets = [s[0], ...ctx.targets.filter((t) => t !== s[0])].slice(0, Math.max(1, ctx.targets.length));
          }, { owner: unit });
          battle.on('hit', (ctx) => {
            if (ctx.source === unit && ctx.target.side === 'enemy' && ctx.target.s.flags.sleep) ctx.dmg.mul *= mercy;
          }, { owner: unit });
          // (a lone sleeper is found by the engine's own target search: `trait.hitSleep` makes sleepers targetable
          // and damageable for her only)
        } },
      ],
    };
    if (num(tb.damage_resistance) > 0) {
      kit.install = (battle, unit) => battle.addBuff(unit, { key: 'trait:blemsh_guard', mods: { dmgTakenMul: 1 - num(tb.damage_resistance) }, persist: true, allowDead: true });
    } else if (num(tb.heal_scale) > 0) {
      // GUA-X "治疗生命值低于50%的友方单位时治疗量提升15%" (the HP before the heal; strictly below — the client's blemsh_e_trait
      // is set_heal_scale_by_hpratio, FilterByTargetHpRatio LT, unlike 黍's heal_scale_up[hpratio][LE])
      kit.install = (battle, unit) => battle.on('heal', (ctx) => {
        if (ctx.source === unit && ctx.target && ctx.target.hpRatio < num(tb.hp_ratio, 0.5)) ctx.amount *= num(tb.heal_scale, 1);
      }, { owner: unit });
    }
    return kit;
  },
};
