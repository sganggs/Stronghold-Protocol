// server/sim/content/kits/ops/chess_char_4_20-fartth.js — 远牙 (char_430_fartth) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { bodyInRange } from '../../../body.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { isHpLoss } from '../../../attack.js';
import { num, tbb, whileDeployed, toggleBuff, skillActive, isSel, alt, withDefaults } from '../shared/tier4.js';
import { hypot } from '../../../detmath.js';

const LINE = Object.freeze(Array.from({ length: COLS }, (_, i) => Object.freeze([0, i])));
const tileKey = (u) => Math.round(u.y) * COLS + Math.round(u.x);
/** HP at 0 (boss pool: pool HP) — a `damaged` hook sees the lethal hit before the kill, while the unit is still `alive`. */
const downed = (u) => (u.bossPool ? !(u.bossPool.hp > 0) : !(u.hp > 0));

export default withDefaults({
  // ===== 远牙 (longrange) S3 光羽箭 — infinite line, +ATK, ×1.25 beyond the normal range; talents 凝神 / 屏息; module
  //       S1 迅捷打击·γ型; S2 同盟支援 (ASPD up; enemies blocked by any ally anywhere on the field are in range — their
  //       tiles are extra range keys while the skill runs). Talent 屏息 (taunt −1, ignores dodge) covers every skill.
  //       Module DEA-Y (支持者来信): +1 SP when an attacked enemy survives the hit
  chess_char_4_20_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1);
    const tb = def.traitBb || {};
    const S3 = isSel(def, 'skchr_fartth_3');
    const taunt = num(t1.taunt_level, -1);
    const setAllied = (battle, unit, keys) => {
      const sig = keys ? keys.join(',') : '';
      if (sig === (unit.mem.alliedSig ?? '')) return;
      unit.mem.alliedSig = sig;
      battle.setExtraRange(unit, keys);
    };
    return {
      skills: alt(def, {
        'skcom_quickattack[3]': () => ({ kind: 'duration', mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed), taunt } }),
        skchr_fartth_2: () => ({
          kind: 'duration',
          mods: { aspd: num(bb.attack_speed), taunt },
          onStart({ battle, unit }) { battle.fx('link', { x: unit.x, y: unit.y, id: unit.id }); },
          onTick({ battle, unit }) {
            const keys = [];
            for (const e of battle.enemies) if (e.alive && !e.hidden && e.blockedBy && e.blockedBy.side === 'ally' && e.blockedBy.alive) keys.push(tileKey(e));
            keys.sort((a, b) => a - b);
            setAllied(battle, unit, keys.length ? keys : null);
          },
          onEnd({ battle, unit }) { setAllied(battle, unit, null); },
        }),
      }),
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk), taunt: num(t1.taunt_level, -1) }, targeting: { rangeGrid: LINE },
        onStart({ battle, unit }) { battle.fx('featherArrow', { x: unit.x, y: unit.y, id: unit.id }); } },
      talents: [
        { install(battle, unit) { // 凝神: ATK +15 % when not hurt for 10 s
          battle.on('damaged', (c) => { if (c.target === unit && c.amount > 0 && !isHpLoss(c.dmg)) unit.mem.lastHurt = battle.time; }, { owner: unit }); // (a 流失 is not 受伤害)
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.lastHurt = -Infinity; }, { owner: unit });
          whileDeployed(battle, unit, 0.1, () => toggleBuff(battle, unit, 'fartth:focus', battle.time - (unit.mem.lastHurt ?? -Infinity) >= num(t0.delay, 10) - 1e-9, { atkPct: num(t0.atk, 0.15) }));
        } },
        { install(battle, unit) { // 屏息 (2nd half): skill attacks ignore physical dodge
          battle.on('hit', (c) => { if (c.source === unit && skillActive(unit) && c.dmg.type === 'phys') c.dmg.canDodge = false; }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        if (isSel(def, 'skchr_fartth_2')) {
          // 同盟支援 reaches BLOCKED enemies outside her range only: the blocked enemies' tiles are extra range keys, so an
          // unblocked enemy (a flyer…) standing on such a tile outside her own range is dropped for the next valid target
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !skillActive(unit) || !unit.extraRangeKeys) return;
            const own = new Set(absoluteRangeKeys(unit.rangeGrid, unit.tileR, unit.tileC, unit.dir, unit.s.rangeExtend));
            const ok = (e) => bodyInRange(e, own) || !!(e.blockedBy && e.blockedBy.side === 'ally' && e.blockedBy.alive);
            if (c.targets.every(ok)) return;
            const cands = battle.enemiesInKeys(unit.rangeKeys, unit, c.profile);
            for (const e of battle.blockedTargets(unit, c.profile)) if (!cands.includes(e)) cands.push(e); // DESIGN §20.3
            for (let i = cands.length - 1; i >= 0; i--) if (!ok(cands[i])) cands.splice(i, 1);
            sortEnemyTargets(battle, unit, cands, c.profile?.priority ?? null);
            c.targets = cands.slice(0, Math.max(1, c.targets.length));
          }, { owner: unit, priority: 5 });
        }
        const sp = num(tb.sp, 0); // module DEA-Y: 攻击的敌人未被击倒时自身额外获得1点技力
        if (sp > 0) {
          // (`damaged` fires before the kill: a lethal hit leaves the target `alive` with 0 HP — that one gives no SP)
          battle.on('damaged', (c) => {
            if (c.source === unit && c.dmg?.isAttack && !c.dmg.isSplash && c.target.side === 'enemy' && c.target.alive && !downed(c.target)) unit.skill?.gainSp(sp, 'module');
          }, { owner: unit });
        }
        const ds = num(tb.damage_scale, 0), lo = num(tb.min_dist, 1), hi = num(tb.max_dist, 4.5);
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.dmg.isAttack) return;
          if (S3 && skillActive(unit) && unit.baseRangeKeys && !bodyInRange(c.target, unit.baseRangeKeys)) c.dmg.mul *= num(bb.damage_scale, 1.25);
          if (ds > 0) { const d = hypot(c.target.x - unit.x, c.target.y - unit.y); c.dmg.mul *= 1 + ds * Math.max(0, Math.min(1, (d - lo) / Math.max(1e-6, hi - lo))); }
        }, { owner: unit });
      },
    };
  },
});
