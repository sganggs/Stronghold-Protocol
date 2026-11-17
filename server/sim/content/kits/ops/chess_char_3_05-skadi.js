// server/sim/content/kits/ops/chess_char_3_05-skadi.js — 斯卡蒂 (char_263_skadi) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { num, defOf, talentBb, traitBb, altSkills, statSkill, fx } from '../shared/tier3.js';

/**
 * Abyssal Hunters (character_table groupId `abyssal`, not in data/chess.json): 深海掠食者 targets. It named 安哲拉 before
 * versions M0, so it applies on every data set and is not ../shared/tier5.js abyssalOf (default data: without 安哲拉).
 */
export const ABYSSAL = new Set(['char_263_skadi', 'char_143_ghost', 'char_218_cuttle', 'char_474_glady', 'char_1023_ghost2', 'char_4145_ulpia']);

export default {
  // ---- 3_05 斯卡蒂 · 无畏者 — S3 涌潮悲歌: ATK/DEF/HP +; 深海掠食者 (Abyssal Hunters ATK); 迅捷出击 (redeploy −10 s)
  //      精锐 module DRE-Y: once per deployment, a lethal hit instead restores full HP with max HP −60 % and ASPD +30
  //      S1 迅捷打击·γ型: ATK/ASPD +; S2 跃浪击 (passive): ATK + for `duration` s after every deployment;
  //      精锐 module DRE-X: ×atk_scale on blocked enemies
  chess_char_3_05_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const kit = {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk), defPct: num(bb.def), hpPct: num(bb.max_hp) } },
      skills: altSkills(chess, d, bb, {
        'skcom_quickattack[3]': statSkill,
        skchr_skadi_2: (s) => ({
          kind: 'duration', activateOnDeploy: true, duration: num(s.bb.duration, 20), spCost: 0, spType: 'none', trigger: 'NEVER',
          mods: { atkPct: num(s.bb.atk) },
        }),
      }),
      talents: [
        { install(battle, unit) { // "编入队伍时": every Abyssal Hunter of this player, for the whole battle
          for (const a of battle.allyUnits) {
            if (a.kind === 'op' && a.ownerId === unit.ownerId && ABYSSAL.has(a.def?.charId)) {
              battle.addBuff(a, { key: 'talent:skadi_predator', mods: { atkPct: num(t0.atk) }, persist: true, allowDead: true, source: unit });
            }
          }
        } },
        { install(battle, unit) {
          if (unit.mem.skadiSwift) return; // base stats are per unit; never apply twice
          unit.mem.skadiSwift = true;
          unit.base.respawnTime = Math.max(0, unit.base.respawnTime + num(t1.respawn_time));
        } },
      ],
    };
    if (tb.value != null || tb.hp_ratio != null) {
      kit.install = (battle, unit) => {
        battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.mem.tideUsed = false; }, { owner: unit });
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== unit || ctx.prevented || unit.mem.tideUsed) return;
          unit.mem.tideUsed = true;
          ctx.prevented = true;
          const hpMul = tb.value != null ? 1 - num(tb.value) : num(tb.max_hp, 0.4);
          battle.addBuff(unit, { key: 'trait:skadi_tide', mods: { hpMul: Math.max(0.05, hpMul), aspd: num(tb.attack_speed) }, visible: true });
          unit.hp = Math.max(1, unit.s.maxHp * num(tb.hp_ratio, 1));
          fx(battle, 'revive', unit, { module: true });
        }, { owner: unit, priority: -50 });
      };
    }
    // DRE-X "攻击被阻挡的敌人时攻击力提升至115%" (blocked by anyone)
    if (num(tb.atk_scale) > 0) kit.trait = { dmgMul: (battle, unit, target) => (target && target.blockedBy ? num(tb.atk_scale, 1) : 1) };
    return kit;
  },
};
