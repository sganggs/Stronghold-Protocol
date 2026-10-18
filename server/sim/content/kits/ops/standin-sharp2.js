// server/sim/content/kits/ops/standin-sharp2.js — 领主·Sharp (char_617_sharp2, 卫戍协议 6★ 近卫·领主) 补位 stand-in kit.
// Stands in for 水月 (tier 4), 玛恩纳 (tier 5, LOR-X) and 维娜·维多利亚 / 妮芙 (tier 6, LOR-X), always with S1 (her only
// skill): data/backups.json `units.char_617_sharp2.standsIn`. Kit contract: ../README.md "Stand-in kits".
// Numbers: the blackboards of data/backups.json (skill_table / character_table / battle_equip_table); what the data
// does not carry: PRTS 领主·Sharp, cited where used.

import { num, talentBb, moduleBb, skillRec, statBuff, toggleBuff } from '../shared/tier1.js';
import { hasHp, isHpLoss } from '../../../attack.js';

const S1 = 'skchr_sharp2_1';

export default {
  // 领主·Sharp — trait (the lord profile, professions.js): ranged attacks at atk_scale (80 %) unless the target stands on
  // her tile / the tile in front or she blocks it; range 3-12; hits air units (data canHitFly). Talent 1 无声之锋: ATK
  // +atk, arts dodge prob (LOR-X levels 2 / 3 upgrade both). Talent 2 陷阵勇气: ASPD +attack_speed while at least `cnt`
  // enemies she can target stand on her attack range [ASSUMED: targetable ones — a 隐匿 enemy she cannot select does not
  // count].
  // S1 沉默的爆发: ATK +atk, ASPD +attack_speed, attack@max_target targets, "远程攻击不再降低攻击力" (every attack at full
  // ATK; the shots stay ranged — unlike 银灰 S3, which "视为近距离攻击"). Range unchanged, data trigger DEFAULT.
  // Module LOR-X: a hidden talent `magic_atk_scale` (the trait part is display only). PRTS: "攻击附带10%攻击力的法术伤害
  // ※于输出伤害时触发，造成的伤害为法术生命流失" — the popup: it triggers almost no event (输出伤害时 / 受到伤害时) and
  // ignores 无敌, 屏障, 护盾, 减伤. So every damage instance she outputs makes its target lose magic_atk_scale × her ATK
  // (Battle.loseHp: no DEF / RES, shield, invulnerability or damage multiplier; its own `damaged` is an hpLoss and sets
  // off nothing). Unlike the LOR-X of 银灰 / 拉普兰德 / 断崖 / 仇白 (trait atk_scale_m, PRTS "于计算伤害时触发，造成预计算
  // 的法术附加伤害": arts damage). [ASSUMED] the client shows the loss in the 流失 (true-damage) colour, it follows a
  // fully shielded hit too (damage was output), and it stops when she leaves the field (a shot landing after that).
  char_617_sharp2: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const magic = num(moduleBb(chess).magic_atk_scale, 0);
    const b1 = skillRec(chess, S1)?.bb ?? {};
    return {
      skills: {
        [S1]: {
          kind: 'duration',
          mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) },
          targeting: { maxTargets: Math.max(1, Math.floor(num(b1['attack@max_target'], 2))) },
          attack: { dmgMul: () => 1 },
        },
      },
      talents: [
        { install(battle, unit) { statBuff(battle, unit, 'sharp2:t1', { atkPct: num(t0.atk), dodgeArts: num(t0.prob) }); } },
        { install(battle, unit) {
          const cnt = Math.max(1, Math.floor(num(t1.cnt, 2)));
          toggleBuff(battle, unit, 'sharp2:t2', () => battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile).length >= cnt, { aspd: num(t1.attack_speed) });
        } },
      ],
      install(battle, unit) {
        if (!(magic > 0)) return;
        battle.on('damaged', (c) => {
          const e = c.target;
          if (c.source !== unit || !unit.alive || !unit.deployed || !e || e.side !== 'enemy' || isHpLoss(c.dmg) || !hasHp(e)) return;
          battle.loseHp(e, unit.s.atk * magic, { source: unit, tags: ['module', 'sharp2:lorx'] });
        }, { owner: unit });
      },
    };
  },
};
