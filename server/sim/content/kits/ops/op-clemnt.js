// server/sim/content/kits/ops/op-clemnt.js — 克莱门莎 (char_4231_clemnt) 自选 operator kit: 6★ 本源近卫, an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4231_clemnt, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, no module (char_4231_clemnt has no official module yet). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 克莱门莎
// (第一天赋 生死定夺 "造成物理伤害时有25%概率攻击力提升至150%，目标防御力低于初始值时概率提升至50%";
// 第二天赋 习得性防御 "受到来自自身前方单位造成的物理和法术伤害降低35%，若伤害来源为【海怪】，则降低55%" — PRTS 特殊机制 点积 "任何相对坐标在干员自身朝向矢量上的投影长度 >= 0 的地块，均可被视为自身前方";
// S1 冲蚀 "下次攻击的攻击力提升至225%，并额外造成相当于物理伤害30%的侵蚀损伤";
// S2 风暴潮 "攻击范围扩大，攻击速度+100，每次攻击对目标及其周围最多5名地面敌人造成相当于攻击力230%的物理伤害；向前方召唤浮游放逐舱，放逐舱使周围累计不超过8重量的最多15名地面敌人不断向前移动；放逐舱在移动3格后消失并留下漩涡，处于漩涡的所有敌人移动速度-70%且每秒受到200点侵蚀损伤和相当于攻击力285%的物理伤害" — PRTS 备注 "发射放逐仓弹道并进入强制缴械（放逐仓停止时提前结束）…放逐仓停止后释放旋涡，旋涡效果半径1.5，可对空";
// S3 与海为敌 "攻击范围扩大，攻击目标数+2，每次攻击对目标造成相当于攻击力200%的物理伤害并额外造成相当于物理伤害20%的侵蚀损伤；当全场有敌人侵蚀损伤爆发时，消耗1发弹药对目标所在位置及其周围四格内所有地面敌人造成3次相当于攻击力270%的物理伤害与相当于攻击力200%的元素伤害。技能装有10发弹药，打完后结束" — PRTS 备注 "此技能的损伤于技能期间的普通攻击成功造成伤害时产生…成功发射舰船轰炸弹道时消耗1发弹药…普通攻击不消耗弹药").

import { num, talentBb, traitBb, skillRec, up } from '../shared/tier1.js';
import { frontOf, toLocal } from '../../../dir.js';
import { bodyInKeys } from '../../../body.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_clemnt_1';
const S2 = 'skchr_clemnt_2';
const S3 = 'skchr_clemnt_3';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

const CROSS_OFFSETS = Object.freeze([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);

/** Spend 1 ammo from an active ammo skill, triggering ammoUsed and ending the skill if empty. */
function spendAmmo(battle, unit) {
  const sk = unit.skill;
  if (!sk || !sk.active || sk.kind !== 'ammo') return false;
  if (sk.ammoLeft <= 0) return false;
  sk.ammoLeft--;
  if (battle._hooks.ammoUsed) battle.emit('ammoUsed', { unit, left: sk.ammoLeft, skill: sk });
  if (sk.ammoLeft <= 0) sk.end('ammo');
  return true;
}

export default {
  char_4231_clemnt: (bb, chess) => {
    const t0 = talentBb(chess, 0); // 生死定夺: t1_atk_scale, prob_normal, prob_special
    const t1 = talentBb(chess, 1); // 习得性防御: damage_resistance_normal, damage_resistance_seamonster
    const b1 = bbOf(chess, S1);
    const b2 = bbOf(chess, S2);
    const b3 = bbOf(chess, S3);

    return {
      skills: {
        [S1]: {
          kind: 'instant',
          attack: {
            atkScale: num(b1.atk_scale, 2.25),
            onEachHit({ battle, unit, target, dealt }) {
              if (dealt > 0 && target && target.alive && target.side === 'enemy') {
                const ratio = num(b1.ep_damage_ratio, 0.3);
                if (ratio > 0) {
                  battle.dealDamage(unit, target, {
                    type: 'element',
                    element: 'erosion',
                    amount: dealt * ratio,
                    tags: ['skill', 'clemnt:s1'],
                  });
                }
                battle.fx('slash', { x: target.x, y: target.y, id: unit.id, skill: 'clemnt:s1' });
              }
            },
          },
        },
        [S2]: {
          kind: 'duration',
          mods: { aspd: num(b2.attack_speed, 100) },
          attack: {
            atkScale: num(b2['attack@aoe_atk_scale'], 2.3),
            afterHit(battle, unit, target) {
              if (!target) return;
              const maxSurrounding = Math.max(1, Math.floor(num(b2['attack@max_target'], 5)));
              let count = 0;
              for (const e of battle.foesInRadius(target.x, target.y, 1.5, true)) {
                if (e === target || e.isFlying || !e.alive || e.s.flags.untargetable) continue;
                battle.dealDamage(unit, e, {
                  amount: unit.s.atk * num(b2['attack@aoe_atk_scale'], 2.3),
                  type: 'phys',
                  isAttack: true,
                  isSplash: true,
                  isSkill: true,
                  tags: ['skill', 'clemnt:s2:aoe'],
                });
                count++;
                if (count >= maxSurrounding) break;
              }
              battle.fx('aoe', { x: target.x, y: target.y, radius: 1.5, id: unit.id, skill: 'clemnt:s2' });
            },
          },
          onStart({ battle, unit }) {
            // Disarm during exile pod travel (1.5s = 3 tiles / 2.0 tiles/s)
            battle.addBuff(unit, {
              key: 'clemnt:disarm',
              duration: 1.5,
              flags: { disarm: true },
              visible: true,
              tags: ['skill'],
            });

            // Calculate destination tile (up to 3 tiles ahead, stopped by boundary/impassable tile)
            let stopDist = 3;
            for (let d = 1; d <= 3; d++) {
              const [r, c] = frontOf(unit.tileR, unit.tileC, unit.dir, d);
              if (!battle.grid.inRect(r, c) || !battle.grid.groundPassable(r, c)) {
                stopDist = d - 1;
                break;
              }
            }
            const [destR, destC] = frontOf(unit.tileR, unit.tileC, unit.dir, stopDist);

            // Collect exile candidates along the path
            const pathKeys = new Set();
            for (let d = 1; d <= stopDist; d++) {
              const [r, c] = frontOf(unit.tileR, unit.tileC, unit.dir, d);
              pathKeys.add(r * COLS + c);
            }
            let remMass = num(b2['attack@max_passenger_mass'], 8);
            let remCnt = num(b2['attack@max_passenger_cnt'], 15);
            const exiled = [];
            for (const e of battle.enemies) {
              if (!e.alive || e.hidden || e.isFlying || e.s.flags.selfBound || e.s.flags.invulnerable) continue;
              if (!bodyInKeys(e, pathKeys)) continue;
              const m = e.s.massLevel ?? 1;
              if (m <= remMass && remCnt > 0) {
                remMass -= m;
                remCnt--;
                exiled.push(e);
              }
            }

            // Exiled enemies displaced to destination after 1.5s
            battle.after(1.5, () => {
              for (const e of exiled) {
                if (e.alive) {
                  e.x = destC;
                  e.y = destR;
                  e.tileR = destR;
                  e.tileC = destC;
                  if (e.route) e.route.pts = null;
                }
              }
            });

            // Vortex at destination
            const totalDur = num(skillRec(chess, S2)?.duration, 16);
            const vortexDur = Math.max(0, totalDur - 1.5);
            battle.fx('zone', {
              x: destC,
              y: destR,
              radius: 1.5,
              dur: vortexDur,
              id: unit.id,
              skill: 'clemnt:vortex',
            });
            unit.mem.clemntVortex = {
              r: destR,
              c: destC,
              x: destC,
              y: destR,
              radius: 1.5,
              acc: 0,
              activeAt: battle.time + 1.5,
            };
          },
          onTick({ battle, unit, dt }) {
            const v = unit.mem.clemntVortex;
            if (!v || battle.time < v.activeAt) return;
            v.acc += dt;
            while (v.acc >= 1.0 && unit.alive) {
              v.acc -= 1.0;
              const victims = battle.foesInRadius(v.x, v.y, v.radius, true);
              for (const e of victims) {
                if (!e.alive || e.s.flags.untargetable) continue;
                battle.addBuff(e, {
                  key: 'clemnt:vortex:slow',
                  duration: 1.1,
                  refresh: 'replace',
                  mods: { moveMul: Math.max(0, 1 + num(b2['attack@move_speed'], -0.7)) },
                  visible: true,
                  tags: ['skill'],
                });
                battle.dealDamage(unit, e, {
                  type: 'element',
                  element: 'erosion',
                  amount: num(b2['attack@water_element'], 200),
                  tags: ['skill', 'clemnt:vortex'],
                });
                battle.dealDamage(unit, e, {
                  type: 'phys',
                  amount: unit.s.atk * num(b2['attack@physical_atk_scale'], 2.85),
                  isSkill: true,
                  tags: ['skill', 'clemnt:vortex'],
                });
              }
              battle.fx('ripple', { x: v.x, y: v.y, radius: v.radius, id: unit.id });
            }
          },
          onEnd({ unit }) {
            unit.mem.clemntVortex = null;
          },
        },
        [S3]: {
          kind: 'ammo',
          ammo: Math.max(1, Math.floor(num(b3.trigger_time, 10))),
          targeting: { maxTargets: Math.max(1, Math.floor(num(b3['attack@max_target'], 3))) },
          attack: {
            atkScale: num(b3['attack@atk_scale'], 2),
            onEachHit({ battle, unit, target, dealt }) {
              if (dealt > 0 && target && target.alive && target.side === 'enemy') {
                const ratio = num(b3['attack@ep_damage_ratio'], 0.2);
                if (ratio > 0) {
                  battle.dealDamage(unit, target, {
                    type: 'element',
                    element: 'erosion',
                    amount: dealt * ratio,
                    tags: ['skill', 'clemnt:s3'],
                  });
                }
                battle.fx('slash', { x: target.x, y: target.y, id: unit.id, skill: 'clemnt:s3' });
              }
            },
          },
          onAttack(ctx) {
            // Normal attacks do not consume ammo
            ctx.noAmmo = true;
          },
          onEnd({ unit }) {
            unit.mem.clemntBombs?.clear();
          },
        },
      },
      talents: [
        {
          install(battle, unit) {
            // 生死定夺: 造成物理伤害时有25%概率攻击力提升至150%，目标防御力低于初始值时概率提升至50%
            const scale = num(t0.t1_atk_scale, 1.5);
            const pNorm = num(t0.prob_normal, 0.25);
            const pSpec = num(t0.prob_special, 0.5);
            if (!(scale > 1) || !(pNorm > 0 || pSpec > 0)) return;

            battle.on('hit', (ctx) => {
              const d = ctx.dmg;
              if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy' || d.type !== 'phys') return;
              const curDef = ctx.target.s?.def ?? ctx.target.stats?.def ?? 0;
              const baseDef = ctx.target.base?.def ?? ctx.target.statsBase?.def ?? ctx.target.def?.stats?.def ?? curDef;
              const prob = curDef < baseDef ? pSpec : pNorm;
              if (prob > 0 && battle.rng.chance(prob)) {
                d.amount *= scale;
                battle.fx('crit', { x: ctx.target.x, y: ctx.target.y, id: unit.id });
              }
            }, { owner: unit });
          },
        },
        {
          install(battle, unit) {
            // 习得性防御: 受到来自自身前方单位造成的物理和法术伤害降低35%，若伤害来源为【海怪】，则降低55%
            const resNorm = num(t1.damage_resistance_normal, 0.35);
            const resSea = num(t1.damage_resistance_seamonster, 0.55);
            if (!(resNorm > 0 || resSea > 0)) return;

            battle.on('hit', (ctx) => {
              if (ctx.target !== unit || !up(unit)) return;
              const d = ctx.dmg;
              if (!d || (d.type !== 'phys' && d.type !== 'arts')) return;
              const src = ctx.source;
              if (!src || src.side !== 'enemy') return;

              // Check if source is in front of unit (dot product / local forward >= 0)
              const [, fwd] = toLocal(src.y - unit.y, src.x - unit.x, unit.dir);
              if (fwd < -1e-6) return;

              const isSea = Array.isArray(src.def?.tags) && src.def.tags.includes('seamonster');
              const cut = isSea ? resSea : resNorm;
              if (cut > 0) d.mul *= Math.max(0, 1 - cut);
            }, { owner: unit });
          },
        },
      ],
      install(battle, unit) {
        // S3: 当全场有敌人侵蚀损伤爆发时，消耗1发弹药对目标所在位置及其周围四格内所有地面敌人造成3次相当于攻击力270%的物理伤害与相当于攻击力200%的元素伤害
        battle.on('elementBurst', (c) => {
          if (c.element !== 'erosion' || !c.target || c.target.side !== 'enemy' || c.target.isFlying) return;
          const sk = unit.skill;
          if (!sk || !sk.active || sk.id !== S3 || sk.ammoLeft <= 0 || !up(unit)) return;

          const br = Math.round(c.target.y ?? c.target.tileR);
          const bc = Math.round(c.target.x ?? c.target.tileC);
          const tileKey = br * COLS + bc;
          const activeBombs = unit.mem.clemntBombs ??= new Set();
          if (activeBombs.has(tileKey)) return;

          if (!spendAmmo(battle, unit)) return;
          activeBombs.add(tileKey);

          battle.fx('bombard', { x: bc, y: br, dur: 3, id: unit.id, skill: 'clemnt:s3' });

          const crossKeys = new Set(CROSS_OFFSETS.map(([dr, dc]) => (br + dr) * COLS + (bc + dc)));
          const physScale = num(b3.s3_atk_scale, 2.7);
          const elemScale = num(b3.ep_damage_scale, 2.0);

          for (let pulse = 0; pulse < 3; pulse++) {
            battle.after(pulse * 1.0, () => {
              if (!unit.alive) return;
              for (const e of battle.enemies) {
                if (!e.alive || e.hidden || e.isFlying || e.s.flags.untargetable) continue;
                if (!bodyInKeys(e, crossKeys)) continue;
                battle.dealDamage(unit, e, {
                  amount: unit.s.atk * physScale,
                  type: 'phys',
                  isSkill: true,
                  tags: ['skill', 'clemnt:s3:bomb'],
                });
                battle.dealDamage(unit, e, {
                  amount: unit.s.atk * elemScale,
                  type: 'elemental',
                  element: 'erosion',
                  isSkill: true,
                  tags: ['skill', 'clemnt:s3:bomb'],
                });
              }
              battle.fx('aoe', { x: bc, y: br, radius: 1.5, id: unit.id, skill: 'clemnt:s3:pulse' });
            });
          }

          battle.after(3.0, () => {
            activeBombs.delete(tileKey);
          });
        }, { owner: unit });
      },
    };
  },
};
