// server/sim/content/kits/ops/chess_char_4_01-rmixer.js — 信仰搅拌机 (char_4194_rmixer) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { isHpLoss } from '../../../damage.js';
import { holdsUndying } from '../../items/battle.js';
import {
  AURA, num, tbb, grid, nationOf, enemiesOnRange, targetsInRange, whileDeployed, reveal, skillActive, isSel, alt,
  instantKind, withDefaults,
} from '../shared/tier4.js';

/** Is module `id` the active one? (elites; `'none'` / normal chess ⇒ false) */
const moduleIs = (def, id) => !!(def?.raw?.module?.active && def.raw.module.id === id);
/**
 * Permanent forward range extension (攻击距离 +n): every range, skill ranges included — except a skill whose range ignores
 * 攻击距离 (`targeting.noRangeExtend`). SPT-Y's "攻击距离+1（不受技能攻击范围变化影响）" reads, as PRTS 修正 it, "（部分技能不受
 * 此影响）" (原因: 语序颠倒、表述模糊) — 信仰搅拌机 S3 备注 "此技能的攻击范围不受'攻击距离'属性影响".
 */
const rangeUp = (battle, unit, n = 1) => battle.addBuff(unit, { key: 'module:range', mods: { rangeExtend: n }, persist: true, allowDead: true });

export default withDefaults({
  // ===== 信仰搅拌机 (shotprotector) S3 退休前布道 — ammo 30 counters; talents 扫射迎宾仪礼 / 架盾送客仪礼; module: reveal
  //       S1 铳骑主考官 (自动触发 ⇒ DEFAULT: next attack ×3 hits + reload an adjacent 拉特兰 ammo skill), S2 八臂电锯侠 (ammo;
  //       a fatal hit is blocked for `ammo_cost` bullets); module SPT-Y 老朋友: range +1 (not on S3's range, PRTS 备注)
  chess_char_4_01_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const counterMax = Math.max(1, Math.floor(num(bb['attack@max_target'], 3)));
    const counterRatio = num(bb.base_attack_time, 0.6); // 反击最小间隔 = 实际攻击间隔 × ratio (not a BAT change)
    const g = grid(def.skill?.rangeGrid);
    const S2 = isSel(def, 'skchr_rmixer_2'), S3 = isSel(def, 'skchr_rmixer_3');
    return {
      skills: alt(def, {
        // 铳骑主考官: the next attack is a triple hit of atk_scale each and reloads `charge` bullet(s) into ONE other
        // 拉特兰 operator around him (8 tiles, PRTS: latest deployment first) whose ammo skill runs
        skchr_rmixer_1: () => ({
          kind: instantKind(def),
          attack: {
            atkScale: num(bb.atk_scale, 1.3), hits: 3,
            onHit({ battle, unit }) {
              const n = num(bb.charge, 1);
              const cand = battle.alliesInRadius(unit.x, unit.y, 1.5, unit.ownerId)
                .filter((a) => a !== unit && a.kind === 'op' && nationOf(a) === 'laterano' && a.skill && a.skill.active && a.skill.kind === 'ammo')
                .sort((a, b) => b.deploySeq - a.deploySeq || a.id - b.id);
              if (!cand[0] || !(n > 0)) return;
              cand[0].skill.addAmmo(n);
              battle.fx('reload', { x: cand[0].x, y: cand[0].y, id: cand[0].id, n });
            },
          },
        }),
        // 八臂电锯侠: ATK/DEF up, 42/45 bullets; the fatal-hit guard is installed below
        skchr_rmixer_2: () => ({
          kind: 'ammo', ammo: num(bb['attack@trigger_time'], 42),
          mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
          onStart({ battle, unit }) { battle.fx('overload', { x: unit.x, y: unit.y, id: unit.id }); },
        }),
      }),
      skill: {
        kind: 'ammo', ammo: num(bb['attack@trigger_time'], 30),
        mods: { hpPct: num(bb.max_hp), atkPct: num(bb.atk), defPct: num(bb.def) },
        // 3-13 exactly: SPT-Y's 攻击距离+1 does not reach it (PRTS 备注; reviewer of community report E1 after 0.1.0)
        targeting: g ? { rangeGrid: g, noRangeExtend: true } : undefined,
        attack: { noAttack: true },                 // 停止主动攻击敌人 (ammo is spent by counters)
        onStart({ battle, unit }) {
          unit.mem.counterReady = -Infinity;
          for (const a of battle.allies(unit.ownerId)) {
            if (a === unit || a.kind !== 'op' || nationOf(a) !== 'laterano') continue;
            if (a.skill && a.skill.active && a.skill.kind === 'ammo') { a.skill.addAmmo(num(bb.ammo, 0)); battle.fx('reload', { x: a.x, y: a.y, id: a.id, n: num(bb.ammo, 0) }); }
          }
          battle.fx('sermon', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
      talents: [
        { install(battle, unit) { // 扫射迎宾仪礼: every damage dealt → DEF +30 / ASPD +3 for 10 s, ≤ 3 stacks
          battle.on('damaged', (c) => {
            if (c.source !== unit || !unit.alive || c.target.side !== 'enemy' || !(c.amount > 0)) return;
            battle.addBuff(unit, { key: 'rmixer:t1', duration: num(t0.duration, 10), refresh: 'stack', maxStacks: Math.max(1, num(t0.max_stack_cnt, 3)),
              mods: { defFlat: num(t0.def), aspd: num(t0.attack_speed) } });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 架盾送客仪礼: no active attack for 8 s → shield 15 % max HP; timer restarts when it breaks
          const since = () => Math.max(unit.deployedAt, unit.mem.lastActiveAtk ?? -Infinity, unit.mem.shieldLostAt ?? -Infinity);
          battle.on('attack', (c) => { if (c.attacker === unit && !unit.mem.inCounter) unit.mem.lastActiveAtk = battle.time; }, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit) { unit.mem.lastActiveAtk = -Infinity; unit.mem.shieldLostAt = -Infinity; } }, { owner: unit });
          whileDeployed(battle, unit, 0.1, () => {
            if (unit.findBuff('rmixer:shield') || battle.time - since() < num(t1.interval, 8) - 1e-9) return;
            battle.addBuff(unit, { key: 'rmixer:shield', shield: unit.s.maxHp * num(t1.shield, 0.15), visible: true,
              onRemove: () => { unit.mem.shieldLostAt = battle.time; } });
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id });
          });
        } },
      ],
      install(battle, unit) {
        if (S2) {
          // S2 "技能期间若受到致命伤害，立即消耗N发弹药抵挡这次伤害": the lethal hit is negated (HP back to its value
          // before the hit) and N bullets go; with fewer left it still blocks, spends them all and the skill ends (PRTS 备注
          // "弹药量不足时仍可抵挡致命伤害，此时将消耗所有剩余弹药并退出技能状态"). "自身持有不死时此效果不会生效": a 不死
          // that runs before it (骑士戒律, priority 20) has already prevented the hit; 坚固维式重锤's held window
          // (items/battle.js holdsUndying: this deployment's, not run out) runs last, so the guard steps aside while it lasts
          const cost = Math.max(1, Math.floor(num(bb.ammo_cost, 30)));
          battle.on('hit', (c) => { if (c.target === unit) unit.mem.rmixerPre = { dmg: c.dmg, hp: unit.hp }; }, { owner: unit, priority: -100 });
          battle.on('fatal', (c) => {
            const sk = unit.skill;
            if (c.unit !== unit || c.prevented || !sk || !sk.active || sk.kind !== 'ammo' || !(sk.ammoLeft > 0)) return;
            if (holdsUndying(battle, unit)) return;
            c.prevented = true;
            const pre = unit.mem.rmixerPre;
            unit.hp = pre && pre.dmg === c.dmg ? Math.max(1, Math.min(unit.s.maxHp, pre.hp)) : 1;
            const spent = Math.min(cost, sk.ammoLeft);
            sk.ammoLeft -= spent;
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, n: spent });
            if (sk.ammoLeft <= 0) sk.end('ammo');
          }, { owner: unit });
        }
        // module SPT-Y (elite, 老朋友): 攻击距离+1 — S1 / S2 keep it, S3's 3-13 does not (noRangeExtend above)
        if (num(def.traitBb?.ability_range_forward_extend, 0) > 0) rangeUp(battle, unit, num(def.traitBb.ability_range_forward_extend, 1));
        // module SPT-X (elite default): 攻击范围内敌人的隐匿效果失效
        if (moduleIs(def, 'uniequip_002_rmixer')) whileDeployed(battle, unit, AURA, () => reveal(battle, enemiesOnRange(battle, unit)));
        if (!S3) return;
        // S3 counter (PRTS 备注 "反击受到任何伤害后均可触发，无需目标，视为普通攻击，受各类无法触发普通攻击效果的影响"): ANY damage
        // she takes — an enemy's attack, a zone, the 无来源 源石溶剂 tick (items/battle.js periodic_damage) — fires one volley at
        // ≤ 3 enemies in range (the attacker first), at most once per actual interval × ratio. With no enemy in range the
        // counter still happens and spends its bullet (无需目标: the drain alone empties the skill — 莫斯提马's 特质 turns those
        // bullets into 拉特兰 layers, player report D1). A 流失 (Battle.loseHp, tag 'hpLoss': it skips every damage event —
        // PRTS 作战机制) and an element 损伤 never counter; stunned / disarmed: no counter
        battle.on('damaged', (c) => {
          const d = c.dmg;
          if (c.target !== unit || !unit.canAct || unit.s.flags.disarm || !skillActive(unit) || !d || c.type === 'element') return;
          if (isHpLoss(d)) return;
          if (battle.time < (unit.mem.counterReady ?? -Infinity) - 1e-9) return;
          const list = targetsInRange(battle, unit);
          const i = c.source ? list.indexOf(c.source) : -1;
          if (i > 0) { list.splice(i, 1); list.unshift(c.source); }
          const targets = list.slice(0, counterMax);
          unit.mem.counterReady = battle.time + unit.s.interval * counterRatio;
          unit.mem.inCounter = true;
          try {
            if (targets.length) battle.forceAttack(unit, targets);
            else { unit.stats.attacks++; unit.skill.onAttackPerformed([], true); } // a counter into nothing: its bullet goes
          } finally { unit.mem.inCounter = false; }
          battle.fx('counter', { x: unit.x, y: unit.y, id: unit.id, n: targets.length });
        }, { owner: unit });
      },
    };
  },
});
