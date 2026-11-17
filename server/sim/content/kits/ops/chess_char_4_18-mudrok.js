// server/sim/content/kits/ops/chess_char_4_18-mudrok.js — 泥岩 (char_311_mudrok) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import {
  AURA, num, tbb, grid, batFlat, enemyHasTag, targetsInGrid, whileDeployed, pulse, toggleBuff, alt, lonely,
  withDefaults,
} from '../shared/tier4.js';

export default withDefaults({
  // ===== 泥岩 (unyield) S2 岩崩锤 — next attack: heal 4 %, 190 % phys to all ground enemies around, 30 % stun; talents
  //       S1 防御力强化·γ型 (TAKE_DAMAGE); S3 秽壤的血脉 (10 s dormant — PRTS 备注 "实际将会进入闭锁状态": 闭锁 = 强制缴械 +
  //       无敌 + 不可阻挡 (PRTS 异常效果: SHELTERING; 不可阻挡 BLOCK_FREE "无法阻挡/被阻挡，自动解除阻挡") — she makes no attack,
  //       takes no damage and blocks nobody: the enemies she held walk on (flag noBlock — "keeps blocking" until 0.2.0
  //       WV); the 备注's 眩晕 / 冻结 / 沉默 反制 are not modelled — with enemies around −60 % speed; then ground
  //       enemies around stunned 3 s/3.5 s and for the rest of the skill BAT −0.3 s, ATK/DEF up, attacks every blocked
  //       enemy); module UNY-Y (沃土的愿景): ATK/DEF +8 % with no ally on the 8 tiles around
  chess_char_4_18_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const g = grid(def.skill?.rangeGrid) || [[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]];
    const sleep = num(bb.sleep, 10);
    return {
      skills: alt(def, {
        'skcom_def_up[3]': () => ({ kind: 'duration', mods: { defPct: num(bb.def) } }),
        skchr_mudrok_3: () => ({
          kind: 'duration',
          attack: { hitAllBlocked: true },
          onStart({ battle, unit }) {
            unit.mem.mudS3 = { awake: false, t: 0 };
            // 闭锁: 强制缴械 + 无敌 + 不可阻挡 (her blocked enemies are released: ai.js lets go of a noBlock blocker)
            battle.addBuff(unit, { key: 'mudrok:dormant', duration: sleep + 1, flags: { invulnerable: true, disarm: true, noBlock: true }, visible: true });
            battle.fx('stone', { x: unit.x, y: unit.y, id: unit.id });
          },
          onTick({ battle, unit, dt }) {
            const M = unit.mem.mudS3;
            if (!M || M.awake) return;
            M.t += dt;
            for (const e of targetsInGrid(battle, unit, g)) pulse(battle, e, `mudrok:slow:${unit.id}`, { moveMul: Math.max(0, 1 + num(bb.move_speed, -0.6)) });
            if (M.t + 1e-9 < sleep) return;
            M.awake = true;
            battle.removeBuff(unit, 'mudrok:dormant');
            for (const e of targetsInGrid(battle, unit, g)) if (!e.isFlying && e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun, 3), source: unit });
            battle.addBuff(unit, { key: 'mudrok:awake', mods: { atkPct: num(bb.atk), defPct: num(bb.def), batPct: batFlat(def, bb.base_attack_time) } });
            battle.fx('rockfall', { x: unit.x, y: unit.y, id: unit.id });
          },
          onEnd({ battle, unit }) {
            unit.mem.mudS3 = null;
            battle.removeBuff(unit, 'mudrok:dormant');
            battle.removeBuff(unit, 'mudrok:awake');
          },
        }),
      }),
      skill: {
        kind: 'instant',
        targeting: { rangeGrid: g, allInRange: true, canHitFly: false },
        attack: {
          atkScale: num(bb.atk_scale, 1.9), groundOnly: true,
          onHit({ battle, unit, target }) {
            if (target && target.alive && battle.rng.chance(num(bb.buff_prob, 0.3))) battle.applyStatus(target, 'stun', { duration: num(bb.stun, 0.5), source: unit });
          },
        },
        onStart({ battle, unit }) {
          battle.heal(unit, unit, unit.s.maxHp * num(bb.hp_ratio, 0.04), { self: true });
          battle.fx('rockslide', { x: unit.x, y: unit.y, id: unit.id });
        },
      },
      talents: [
        { install(battle, unit) { // 沃土予身: a hit-negating layer every 9 s (≤ 3, 1 on deploy); each broken layer heals 20 %
          const setLayers = (n) => {
            unit.mem.layers = n;
            if (n > 0) battle.addBuff(unit, { key: 'mudrok:layers', shieldHits: n, visible: true });
            else battle.removeBuff(unit, 'mudrok:layers');
          };
          battle.on('deploy', (c) => {
            if (c.unit !== unit) return;
            setLayers(Math.min(num(t0.max_times, 3), num(t0.times, 1)));
            unit.mem.layerTimer?.cancel();
            unit.mem.layerTimer = whileDeployed(battle, unit, num(t0.interval, 9), () => {
              if ((unit.mem.layers ?? 0) < num(t0.max_times, 3)) setLayers(Math.min(num(t0.max_times, 3), (unit.mem.layers ?? 0) + num(t0.times, 1)));
            });
          }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.target !== unit || !unit.alive) return;
            const left = unit.findBuff('mudrok:layers')?.shieldHits ?? 0;
            const broken = (unit.mem.layers ?? 0) - left;
            if (broken <= 0) return;
            unit.mem.layers = left;
            battle.heal(unit, unit, unit.s.maxHp * num(t0.hp_ratio, 0.2) * broken, { self: true });
            // 第一期精英「沃土予身」returns `sp` per broken layer. Today's record has no such key (num → 0).
            if (num(t0.sp) > 0) unit.skill?.gainSp(num(t0.sp) * broken, 'talent');
            battle.fx('shieldBreak', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 手足相惜: −30 % damage from 萨卡兹 enemies
          battle.on('hit', (c) => { if (c.target === unit && enemyHasTag(c.source, 'sarkaz')) c.dmg.mul *= 1 - num(t1.damage_resistance, 0.3); }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const ds = num(tb.damage_scale, 0); // module (elite): −15 % damage from enemies it blocks
        if (ds > 0) battle.on('hit', (c) => { if (c.target === unit && c.source && c.source.blockedBy === unit) c.dmg.mul *= ds; }, { owner: unit });
        const ma = num(tb.atk, 0), md = num(tb.def, 0); // module UNY-Y: 周围8格没有友方干员时攻击力和防御力+8%
        if (ma || md) whileDeployed(battle, unit, AURA, () => toggleBuff(battle, unit, 'mudrok:module', lonely(battle, unit, true), { atkPct: ma, defPct: md }));
      },
    };
  },
});
