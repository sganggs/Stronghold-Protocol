// server/sim/content/kits/ops/op-oblvns.js — 丰川祥子 (char_4182_oblvns) 自选 operator kit: 6★ 领主 (近卫), an owned-6★ pick of
// the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and module (LOR-Y) at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4182_oblvns, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, module at stage 1 (tier 5) or 3 (tier 6). Full potential.
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 丰川祥子.
// - Trait (领主) "可以进行远程攻击，但此时攻击力降低至80%": lord profile, range 3-12, canHitFly: true, blocks 2.
//   Module LOR-Y “无言的约定” adds:
//   - "攻击范围内存在2名及以上敌人时攻击速度+12": handled by the engine (content/traitMods.js crowdInRange).
//   - "技能期间远程攻击不再降低攻击力": during active skills, attacks suffer no 80% ranged penalty (dmgMul = 1).
// - T1 颂乐音符: Continuous attack; attacks create tracking notes that float and expire after `delay` (1 s).
//   For each note present, Ave Mujica members penetrate def_penetrate_ratio DEF and magic_resist_penetrate_ratio RES
//   (up to max_cnt: 10 base, 12 under module LOR-Y).
// - T2 毋畏遗忘: Dealing damage increases Fever (+cnt, 3). Fever caps at 100 and lasts FEVER_DURATION (20 s).
//   Allies in attack range gain ASPD +attack_speed (+16 / +12 without pot 5).
// - S1 新月的苏醒 (AUTO, charge 2; auto-casts at max charges): fires 8 notes dealing arts damage with decaying
//   multipliers (atk_scale through atk_scale_8).
// - S2 满月的舞会 (MANUAL, toggle): switches between Piano (initial) and Organ.
//   - Piano: ATK +attack@atk, faster projectiles, physical damage.
//   - Organ: ASPD +attack@attack_speed, slower projectiles, arts damage.
//   - During Fever: double strike (2 hits).
// - S3 残月的余响 (MANUAL, 25 s, range 3-21): plays both Piano and Organ simultaneously. Each attack fires 2 Piano notes
//   (physical damage, tracking highest DEF enemy in range) and 2 Organ notes (arts damage, tracking highest RES enemy
//   in range), each dealing atk_scale × ATK.
//   - During Fever: Ave Mujica members withstand lethal damage without retreating until Fever ends.

import { num, talentBb, traitBb, skillRec, up, moduleOn, installAura, alliesInGridOf, enemiesInGrid, enemyInRange } from '../shared/tier1.js';
import { bodyOnTile } from '../../../body.js';
import { frontOf } from '../../../dir.js';
import { hasHp } from '../../../damage.js';

const S1 = 'skchr_oblvns_1';
const S2 = 'skchr_oblvns_2';
const S3 = 'skchr_oblvns_3';
const MOD_LORY = 'uniequip_002_oblvns';

/** Range 3-21 when a record carries none. */
const R3_21 = Object.freeze([
  [2, 0], [2, 1],
  [1, 0], [1, 1], [1, 2], [1, 3],
  [0, 0], [0, 1], [0, 2], [0, 3],
  [-1, 0], [-1, 1], [-1, 2], [-1, 3],
  [-2, 0], [-2, 1],
]);

const FEVER_MAX = 100;
const FEVER_DURATION = 20;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const isAveMujica = (u) => u && (u.def?.charId === 'char_4182_oblvns' || u.def?.nationId === 'mujica' || (u.def?.bonds || []).includes('mujica'));

export default {
  char_4182_oblvns: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const grid3 = skillRec(chess, S3)?.rangeGrid ?? R3_21;

    const rangedScale = num(tb.atk_scale, 0.8);
    const loryOn = moduleOn(chess, MOD_LORY);

    // T1 颂乐音符
    const defPen = num(t0.def_penetrate_ratio, 0.03);
    const resPen = num(t0.magic_resist_penetrate_ratio, 0.02);
    const maxNotes = Math.max(1, Math.floor(num(t0.max_cnt, 10)));
    const noteDelay = num(t0.delay, 1);

    // T2 毋畏遗忘
    const feverGain = num(t1.cnt, 3);
    const aspdBuff = num(t1.attack_speed, 16);

    const updatePenetration = (battle, unit) => {
      const stacks = unit.mem.notes || 0;
      const defIgn = stacks * defPen;
      const resIgn = stacks * resPen;
      const key = `talent:oblvns:pen:${unit.id}`;
      for (const a of battle.allyUnits) {
        if (!a.alive || !a.deployed || !isAveMujica(a)) continue;
        if (stacks > 0) {
          battle.addBuff(a, {
            key,
            mods: { defIgnorePct: defIgn, resIgnorePct: resIgn },
            tags: ['talent'],
            visible: true,
          });
        } else {
          battle.removeBuff(a, key);
        }
      }
    };

    const addNote = (battle, unit) => {
      if (!up(unit)) return;
      unit.mem.notes = Math.min(maxNotes, (unit.mem.notes || 0) + 1);
      updatePenetration(battle, unit);
      battle.after(noteDelay, () => {
        if (!up(unit)) return;
        unit.mem.notes = Math.max(0, (unit.mem.notes || 0) - 1);
        updatePenetration(battle, unit);
      }, { owner: unit });
    };

    const addFever = (battle, unit, amt) => {
      const mem = unit.mem;
      if (mem.feverActive) return;
      mem.fever = Math.min(FEVER_MAX, (mem.fever || 0) + amt);
      if (mem.fever >= FEVER_MAX) {
        mem.feverActive = true;
        battle.fx('burst', { x: unit.x, y: unit.y, id: unit.id, duration: FEVER_DURATION });
        battle.after(FEVER_DURATION, () => {
          mem.feverActive = false;
          mem.fever = 0;
          if (Array.isArray(mem.feverPendingRetreat)) {
            for (const u of mem.feverPendingRetreat) {
              if (u.alive) battle.kill(u, 'killed');
            }
            mem.feverPendingRetreat = [];
          }
        }, { owner: unit });
      }
    };

    const updateS2Buff = (battle, unit) => {
      const key = `skill:oblvns:s2:${unit.id}`;
      battle.removeBuff(unit, key);
      const stance = unit.mem.oblvnsStance || 'piano';
      if (stance === 'piano') {
        battle.addBuff(unit, { key, mods: { atkPct: num(b2['attack@atk'], 0.75) }, tags: ['skill'], visible: true });
      } else {
        battle.addBuff(unit, { key, mods: { aspd: num(b2['attack@attack_speed'], 110) }, tags: ['skill'], visible: true });
      }
    };

    return {
      trait: {
        // Lord trait: ranged attacks deal 80 % damage unless on current / front tile or blocked.
        // LOR-Y adds: "技能期间远程攻击不再降低攻击力"
        dmgMul(battle, unit, target) {
          if (loryOn && unit.skill?.active) return 1;
          if (target.blockedBy === unit) return 1;
          const [fr, fc] = frontOf(unit.tileR, unit.tileC, unit.dir);
          return bodyOnTile(target, unit.tileR, unit.tileC) || bodyOnTile(target, fr, fc) ? 1 : rangedScale;
        },
      },
      skills: {
        [S1]: {
          kind: 'instant',
          charges: 2,
          trigger: { rule: 'DEFAULT' },
          onStart({ battle, unit }) {
            const enemies = enemiesInGrid(battle, unit);
            if (!enemies.length) return;
            battle.fx('sonic', { x: unit.x, y: unit.y, id: unit.id, skill: S1, count: 8 });
            const scales = [
              num(b1.atk_scale, 0.8),
              num(b1.atk_scale_2, 0.73),
              num(b1.atk_scale_3, 0.6),
              num(b1.atk_scale_4, 0.47),
              num(b1.atk_scale_5, 0.33),
              num(b1.atk_scale_6, 0.27),
              num(b1.atk_scale_7, 0.13),
              num(b1.atk_scale_8, 0.04),
            ];
            for (let i = 0; i < 8; i++) {
              battle.after(i * 0.06, () => {
                if (!up(unit)) return;
                const targets = enemiesInGrid(battle, unit);
                const tgt = targets[0];
                if (!tgt || !tgt.alive) return;
                battle.dealDamage(unit, tgt, {
                  amount: unit.s.atk * scales[i],
                  type: 'arts',
                  isSkill: true,
                  tags: ['skill', 'oblvns:note', 'oblvns:s1'],
                });
                addNote(battle, unit);
              }, { owner: unit });
            }
          },
        },
        [S2]: {
          kind: 'toggle',
          attack: {
            hitsFn: (battle, unit) => (unit.mem.feverActive ? 2 : 1),
            dmgType: (battle, unit) => (unit.mem.oblvnsStance === 'organ' ? 'arts' : 'phys'),
            onHit({ battle, unit }) {
              addNote(battle, unit);
            },
          },
          onStart({ battle, unit }) {
            unit.mem.oblvnsStance = unit.mem.oblvnsStance === 'organ' ? 'piano' : 'organ';
            updateS2Buff(battle, unit);
          },
          onEnd({ battle, unit }) {
            battle.removeBuff(unit, `skill:oblvns:s2:${unit.id}`);
          },
        },
        [S3]: {
          kind: 'duration',
          targeting: { rangeGrid: grid3 },
          attack: {
            dmgMul: () => 1,
            hitsFn: () => 0,
            onEachHit({ battle, unit }) {
              const inRange = enemiesInGrid(battle, unit, grid3);
              if (!inRange.length) return;
              const defTarget = inRange.reduce((max, e) => (e.s.def > max.s.def ? e : max), inRange[0]);
              const resTarget = inRange.reduce((max, e) => (e.s.res > max.s.res ? e : max), inRange[0]);
              const scale = num(b3['attack@atk_scale'], 1.8);

              battle.fx('strike', { x: unit.x, y: unit.y, id: unit.id, skill: S3 });

              // 2 Piano notes (physical damage, tracking highest DEF)
              for (let i = 0; i < 2; i++) {
                if (defTarget.alive) {
                  battle.dealDamage(unit, defTarget, {
                    amount: unit.s.atk * scale,
                    type: 'phys',
                    isSkill: true,
                    tags: ['skill', 'oblvns:note', 'oblvns:piano'],
                  });
                  addNote(battle, unit);
                }
              }

              // 2 Organ notes (arts damage, tracking highest RES)
              for (let i = 0; i < 2; i++) {
                if (resTarget.alive) {
                  battle.dealDamage(unit, resTarget, {
                    amount: unit.s.atk * scale,
                    type: 'arts',
                    isSkill: true,
                    tags: ['skill', 'oblvns:note', 'oblvns:organ'],
                  });
                  addNote(battle, unit);
                }
              }
            },
          },
        },
      },
      talents: [
        {
          install(battle, unit) {
            // T1 颂乐音符: normal attack hits add notes
            battle.on('damaged', (c) => {
              if (c.source === unit && c.target?.side === 'enemy' && c.dmg?.isAttack && !c.dmg.tags?.includes('oblvns:note')) {
                addNote(battle, unit);
              }
            }, { owner: unit });
          },
        },
        {
          install(battle, unit) {
            // T2 毋畏遗忘: damage increases Fever (+3)
            battle.on('damaged', (c) => {
              if (c.source === unit && c.target?.side === 'enemy' && hasHp(c.target) && c.type !== 'element') {
                addFever(battle, unit, feverGain);
              }
            }, { owner: unit });

            // Allies in range gain ASPD aura
            installAura(battle, unit, {
              key: 'talent:oblvns:aspd',
              select: (a) => alliesInGridOf(battle, unit).includes(a),
              mods: { aspd: aspdBuff },
              value: aspdBuff,
            });
          },
        },
      ],
      install(battle, unit) {
        unit.mem.notes = 0;
        unit.mem.fever = 0;
        unit.mem.feverActive = false;
        unit.mem.feverPendingRetreat = [];
        unit.mem.oblvnsStance = 'piano';

        battle.on('deploy', (c) => {
          if (c.unit === unit) {
            unit.mem.notes = 0;
            unit.mem.fever = 0;
            unit.mem.feverActive = false;
            unit.mem.feverPendingRetreat = [];
            unit.mem.oblvnsStance = 'piano';
          }
        }, { owner: unit });

        // S1: auto-cast when charges reached max (charges >= 2)
        if (unit.skill?.id === S1) {
          battle.on('tick', () => {
            const sk = unit.skill;
            if (!sk || sk.id !== S1 || !up(unit) || !unit.canAct) return;
            if (sk.charges >= 2 && enemyInRange(battle, unit)) {
              sk.activate();
            }
          }, { owner: unit });
        }

        // S2 initial stance setup
        if (unit.skill?.id === S2) {
          updateS2Buff(battle, unit);
        }

        // S3: Ave Mujica members avoid retreat on lethal damage during Fever
        battle.on('fatal', (c) => {
          if (!c.prevented && unit.skill?.active && unit.skill?.id === S3 && unit.mem.feverActive && isAveMujica(c.unit)) {
            c.prevented = true;
            if (!unit.mem.feverPendingRetreat) unit.mem.feverPendingRetreat = [];
            if (!unit.mem.feverPendingRetreat.includes(c.unit)) unit.mem.feverPendingRetreat.push(c.unit);
            battle.fx('undying', { x: c.unit.x, y: c.unit.y, id: c.unit.id });
          }
        }, { owner: unit, priority: 10 });
      },
    };
  },
};
