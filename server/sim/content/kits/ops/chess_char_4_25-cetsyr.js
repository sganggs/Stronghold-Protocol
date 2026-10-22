// server/sim/content/kits/ops/chess_char_4_25-cetsyr.js — 魔王 (char_4134_cetsyr) kit, tier 4.
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { canTargetEnemy } from '../../../targeting.js';
import { aggregateMods } from '../../../buffs.js';
import {
  AURA, AURA_DUR, num, tbb, moduleBb, grid, enemyHasTag, whileDeployed, toggleBuff, skillActive, isSel, alt,
  withDefaults,
} from '../shared/tier4.js';

/**
 * 鼓舞 (ba.inspire "获得额外附加的基础属性加成（同类属性取最高）"): +`val` ATK (or max HP) on top of the target's own
 * percentage multipliers (the flat mod is compensated, so an ATK+% skill does not scale it), the strongest source wins
 * (the ATK key `inspire` is shared with 浊心斯卡蒂's 鼓舞); units flagged `mem.noInspire` (bards: 自身不受鼓舞影响) never
 * receive it. Refreshed by an aura: lapses within AURA_DUR once the source stops.
 */
function inspire(battle, target, val, src, stat = 'atk') {
  if (!(val > 0) || !target || !target.alive || target.mem?.noInspire) return;
  const key = stat === 'hp' ? 'inspire:hp' : 'inspire';
  const cur = target.findBuff(key);
  if (cur && cur.data && cur.data.src !== src.id && cur.data.val > val && cur.timeLeft > 1e-6) return;
  const { add, mul } = aggregateMods(target.buffs.filter((b) => b.key !== key));
  const f = stat === 'hp' ? Math.max(0, 1 + (add.hpPct ?? 0)) * (mul.hpMul ?? 1) : Math.max(0, 1 + (add.atkPct ?? 0)) * (mul.atkMul ?? 1);
  const flat = f > 1e-6 ? val / f : val;
  battle.addBuff(target, { key, mods: stat === 'hp' ? { hpFlat: flat } : { atkFlat: flat }, duration: AURA_DUR, source: src, visible: true, data: { src: src.id, val } });
}

export default withDefaults({
  // ===== 魔王 (bard) S3 编织重构现世 — wider range, trait 65 %, motes stay, 鼓舞 +65 % of her max HP, HP redistribution
  //       S1 往昔萦绕身旁 (SP_FULL toggle, 持续时间无限: trait 20 %/28 %, motes respawn in `talent_cool_down` s); S2 明日渺远不及
  //       (motes cap +3 and 6 at once, wider orbit — enemies within outside_radius — no longer touch operators: a mote
  //       hitting an enemy deals 220 %/260 % ATK true damage + 3 s bind and respawns like any mote [ASSUMED]; 鼓舞: other
  //       allies in range ATK + 65 %/80 % of her ATK)
  chess_char_4_25_a: (bb, chess, def) => {
    const t0 = tbb(def, 0), t1 = tbb(def, 1), mb = moduleBb(def);
    const g = grid(def.skill?.rangeGrid);
    const redistIv = Math.max(0.5, num(bb['attack@cetsyr_s_3[cal_hp_ratio].interval'], 2));
    const S1 = isSel(def, 'skchr_cetsyr_1'), S2 = isSel(def, 'skchr_cetsyr_2'), S3 = isSel(def, 'skchr_cetsyr_3');
    const baseCnt = Math.max(0, Math.floor(num(t0.cnt, 3)));
    const MOTE_GAP = 0.5; // [ASSUMED] minimal time between two motes hitting the same enemy (s)
    const setTrait = (unit, v) => { unit.mem.bardBase ??= unit.profile.auraRatio; unit.profile.auraRatio = num(v, unit.mem.bardBase); };
    const resetTrait = (unit) => { if (unit.mem.bardBase != null) unit.profile.auraRatio = unit.mem.bardBase; };
    return {
      skills: alt(def, {
        skchr_cetsyr_1: () => ({
          kind: 'toggle',
          trigger: 'SP_FULL', // 自动触发 (no 技能策略: the 吟游者 row is for MANUAL skills): on as soon as it is ready
          onStart({ battle, unit }) { setTrait(unit, bb['attack@atk_to_hp_recovery_ratio']); battle.fx('mote', { x: unit.x, y: unit.y, id: unit.id }); },
          onEnd({ unit }) { resetTrait(unit); },
        }),
        skchr_cetsyr_2: () => ({
          kind: 'duration',
          onStart({ battle, unit }) {
            // “微尘”上限+3，立刻获得6枚“微尘”
            unit.mem.motes = new Array(baseCnt + 3).fill(-Infinity);
            unit.mem.moteHit = new Map();
            battle.fx('reweave', { x: unit.x, y: unit.y, id: unit.id, n: unit.mem.motes.length });
          },
          onTick({ battle, unit }) { // 鼓舞: other allies in range ATK + x % of her ATK
            for (const a of battle.alliesInGrid(unit)) if (a !== unit) inspire(battle, a, unit.s.atk * num(bb['attack@atk'], 0.65), unit);
          },
          onEnd({ battle, unit }) {
            // back to the normal cap: the motes that come back first are kept
            unit.mem.motes = (unit.mem.motes || []).slice().sort((a, b) => a - b).slice(0, baseCnt);
            unit.mem.moteHit = null;
          },
        }),
      }),
      skill: {
        kind: 'duration',
        targeting: g ? { rangeGrid: g } : undefined,
        onStart({ battle, unit }) {
          setTrait(unit, bb['attack@atk_to_hp_recovery_ratio']);
          unit.mem.redist = 0;
          battle.fx('reweave', { x: unit.x, y: unit.y, id: unit.id });
        },
        onTick({ battle, unit, dt }) {
          const others = battle.alliesInGrid(unit).filter((a) => a !== unit);
          for (const a of others) inspire(battle, a, unit.s.maxHp * num(bb.max_hp, 0.65), unit, 'hp');
          unit.mem.redist += dt;
          if (unit.mem.redist + 1e-9 < redistIv) return;
          unit.mem.redist -= redistIv;
          const pool = battle.alliesInGrid(unit).filter((a) => !(a.s.flags.noHeal || a.profile?.noHeal) || a === unit);
          let hp = 0, max = 0;
          for (const a of pool) { hp += a.hp; max += a.s.maxHp; }
          if (!(max > 0) || pool.length < 2) return;
          const ratio = Math.min(1, hp / max);
          for (const a of pool) a.hp = Math.max(1, Math.min(a.s.maxHp, a.s.maxHp * ratio));
          battle.fx('redistribute', { x: unit.x, y: unit.y, id: unit.id, ratio: Math.round(ratio * 1000) / 1000 });
        },
        onEnd({ unit }) { if (unit.mem.bardBase != null) unit.profile.auraRatio = unit.mem.bardBase; },
      },
      talents: [
        { install(battle, unit) { // 过往尘埃: 3 motes; touching an operator ⇒ her trait regen ×1.5 on it for 6 s; mote back after 6 s
          unit.mem.motes = new Array(baseCnt).fill(-Infinity);
          unit.mem.noInspire = true; // trait: 自身不受鼓舞影响 (another bard's 鼓舞 skips her)
          // The orbiting 「微尘」 for the client (render/motes.js; snapshot.js moteView): how many are out right now and
          // whether S2's 旋转半径扩大 is up. Display only — the mote logic below stays the sim's own.
          unit.moteRing = () => [unit.mem.motes.reduce((k, t) => k + (t <= battle.time + 1e-9 ? 1 : 0), 0), S2 && skillActive(unit) ? 1 : 0];
          const cooldown = () => (S1 && skillActive(unit) ? num(bb.talent_cool_down, 3) : num(t0.cooldown, 6)); // S1: 重生速度加快
          const takeMote = () => {
            const i = unit.mem.motes.findIndex((t) => t <= battle.time + 1e-9);
            if (i < 0) return false;
            unit.mem.motes[i] = battle.time + cooldown();
            return true;
          };
          whileDeployed(battle, unit, 0.25, () => {
            if (S2 && skillActive(unit)) {
              // S2: motes orbit wider and hit enemies instead of operators
              const hitAt = unit.mem.moteHit || (unit.mem.moteHit = new Map());
              const foes = battle.foesInRadius(unit.x, unit.y, num(bb.outside_radius, 2)).filter((e) => canTargetEnemy(unit, e, { canHitFly: true }))
                .sort((a, b) => a.id - b.id);
              for (const e of foes) {
                if ((hitAt.get(e.id) ?? -Infinity) > battle.time + 1e-9) continue;
                if (!takeMote()) break;
                hitAt.set(e.id, battle.time + MOTE_GAP);
                battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 2.2), type: 'true', isSkill: true, tags: ['skill', 'mote'] });
                if (e.alive) battle.applyStatus(e, 'bind', { duration: num(bb.unmoveable_duration, 3), source: unit });
                battle.fx('mote', { x: e.x, y: e.y, id: e.id });
              }
              return;
            }
            const keep = S3 && skillActive(unit); // S3: “微尘”不再消失
            for (const a of battle.alliesInRadius(unit.x, unit.y, num(t0.range_radius, 1.15), unit.ownerId)) {
              if (a === unit || a.kind !== 'op' || a.findBuff(`cetsyr:mote:${unit.id}`)) continue;
              if (!keep && !takeMote()) break;
              battle.addBuff(a, { key: `cetsyr:mote:${unit.id}`, duration: num(t0.talent_duration, 6), visible: true, source: unit });
              battle.fx('mote', { x: a.x, y: a.y, id: a.id });
            }
          });
          // "受到魔王特性效果提升至1.5倍": her trait's 生命回复速度 on that operator (professions.js bardRegen hook)
          battle.on('bardRegen', (c) => {
            if (c.unit === unit && c.target.findBuff(`cetsyr:mote:${unit.id}`)) c.value *= num(t0['attack@trait_mul'], 1.5);
          }, { owner: unit });
        } },
        { install(battle, unit) { // 魔王残响: every ally takes −10 % damage from 萨卡兹 enemies (while she is in the squad)
          battle.on('hit', (c) => {
            if (c.target.side === 'ally' && c.target.ownerId === unit.ownerId && enemyHasTag(c.source, 'sarkaz')) c.dmg.mul *= 1 - num(t1.damage_resistance, 0.1);
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const a = num(mb.atk, 0), cnt = num(mb.cnt, 2); // module (elite): ≥ 2 other operators in her normal range ⇒ ATK +8 %
        if (!a) return;
        whileDeployed(battle, unit, AURA, () => {
          const set = new Set(unit.baseRangeKeys || []);
          const n = battle.allies(unit.ownerId).filter((o) => o !== unit && o.kind === 'op' && set.has(o.tileR * COLS + o.tileC)).length;
          toggleBuff(battle, unit, 'cetsyr:module', n >= cnt, { atkPct: a });
        });
      },
    };
  },
});
