// server/sim/content/kits/ops/chess_char_5_14-svash2.js — 凛御银灰 (char_1045_svash2) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { bodyKeys } from '../../../body.js';
import { toLocal } from '../../../dir.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import {
  AURA_IV, AURA_DUR, num, on, talent, talentRec, skillGrid, mods, inFaction, isOp, selectedId, lazySkills, instantKind,
  skillRange, whileOn, enemiesInGrid,
} from '../shared/tier5.js';

const isKjerag = (u) => inFaction(u, 'kjeragShip', ['kjerag']);
/** The enemy profile the skill's range selection uses: his own, lifted to air (PRTS 备注 可对空) — canHitFly false is a melee PIONEER's. */
const AIR = Object.freeze({ canHitFly: true });

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 凛御银灰 — S2 御敌的锋锐 (2 charges; PRTS 备注 "可对空"): the 6 front-most enemies in the skill range take 260 % ATK
  // phys, cold + reveal for 4 s; the waiting (knocked-out) op nearest to 风雪之眼 by cost gets −11 redeploy cost (right
  // side guard/caster/sniper first); waiting ops left of the eye (cost < eye cost) cast the AoE with their own ATK when
  // they redeploy (≤2).
  // T1 开放性开局: ops left of the eye and himself: +4 SP at deployment, redeploy time −20 %.
  // T2 雪境先驱: Kjerag ops freeze-immune, DEF +60, 1.5 % max HP/s regen; doubled after 15 s on the field.
  // The eye follows the selected skill (its overrideTokenKey: S1 eagle1 cost 16, S2 eagle2 14, S3 eagle3 19).
  // S1 周旋的谋略 (instant): +cost DP at once; the waiting op nearest to the eye gets −[deck].cost redeploy cost (same pick
  // as S2) and a barrier of [deck].shield × his max HP when it redeploys.
  // S3 变革已至 (duration 48 s): skill range — 可对空 (PRTS 备注), so a wave of flyers alone fires it: the data's
  // ACTIVE_RANGE condition asks the unit's own attack profile, which for a melee PIONEER never counts a flyer, so the
  // kit adds the skill's grid as a content trigger range selected with an air profile — the way 赤刃明霄陈 S3 does
  // (op-chen3.js; user playtest: it never cast against air-only waves); enemies in it lose 隐匿; every attack hits
  // every enemy of the range on the target's line (his facing) for bird_atk_scale × ATK phys + 脆弱 (damage_scale − 1,
  // weak[limit] s [ASSUMED duration]); +[start_cost] DP at once, then +[cost].cost DP every [cost].interval s; the first
  // activation of the battle swaps the base costs of the most (guard/caster/sniper first) and least expensive waiting
  // ops. "风雪之眼变为可部署" is not modelled (nobody deploys by hand in the auto battle).
  chess_char_5_14_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const grid = skillGrid(chess, def) ?? [[0, 0], [0, 1]];
    const eyeId = chess?.skill?.overrideTokenKey ?? talentRec(chess, 0)?.tokenKey ?? 'token_10057_svash2_eagle2';
    const n = Math.max(1, num(bb.max_target, 6)), maxStacks = Math.max(1, num(bb.max_stack_cnt, 2));
    const PREF = ['WARRIOR', 'CASTER', 'SNIPER'];
    /** Waiting (knocked-out) ops of his player split around the eye cost, and the one nearest to the eye (right side first). */
    const waitingArea = (battle, unit) => {
      const eye = unit.mem.eyeCost ?? 0;
      const waiting = battle.allyUnits.filter((a) => isOp(a) && a !== unit && a.ownerId === unit.ownerId && !a.alive && !a.removed);
      const right = waiting.filter((a) => a.base.cost >= eye).sort((a, b) => a.base.cost - b.base.cost || a.id - b.id);
      const left = waiting.filter((a) => a.base.cost < eye).sort((a, b) => b.base.cost - a.base.cost || a.id - b.id);
      const pick = right.find((a) => PREF.includes(a.def?.profession)) ?? right[0] ?? left[0] ?? null;
      return { waiting, right, left, pick };
    };
    const cutCost = (a, v) => {
      if (!a || !(v > 0)) return;
      a.mem.svashCostBase ??= a.base.cost;
      a.base.cost = Math.max(0, a.base.cost - v);
    };
    const slash = (battle, caster, atk) => {
      // PRTS 备注: the slash ignores 隐匿 and hits flying enemies (and its reveal makes them targetable afterwards)
      for (const e of enemiesInGrid(battle, caster, grid, n, { ignoreStealth: true })) {
        battle.dealDamage(caster, e, { amount: atk * num(bb.atk_scale, 1), type: 'phys', isSkill: true, tags: ['skill', 'svash2'] });
        if (!e.alive) continue;
        battle.applyStatus(e, 'cold', { duration: num(bb.cold), source: caster });
        battle.applyStatus(e, 'reveal', { duration: num(bb.cold), source: caster });
      }
      battle.fx('aoe', { x: caster.x + caster.fwd[1] * 1.5, y: caster.y + caster.fwd[0] * 1.5, id: caster.id, r: 2, skill: 'svash2' });
    };
    return {
      skills: lazySkills({
        // (自动触发: an AUTO skill takes no 技能策略 — an AUTO DP skill fires as soon as it is ready, like 伺夜 S1)
        skchr_svash2_1: () => ({
          kind: instantKind(chess, def),
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb.cost));
            const { pick } = waitingArea(battle, unit);
            cutCost(pick, num(bb['svash2_s_1[deck].cost']));
            if (pick) pick.mem.svashShield = unit.s.maxHp * num(bb['svash2_s_1[deck].shield']);
            battle.fx('aoe', { x: unit.x, y: unit.y, id: unit.id, r: 1, skill: 'svash2Plan' });
          },
        }),
        skchr_svash2_3: () => ({
          kind: 'duration',
          targeting: skillRange(chess, def, { canHitFly: true }),
          attack: {
            atkScale: num(bb.bird_atk_scale, 1),
            onEachHit({ battle, unit, target }) {
              if (!target || !target.alive || target.side !== 'enemy') return;
              const v = num(bb.damage_scale, 1) - 1;
              if (v > 0) battle.applyStatus(target, 'fragile', { duration: num(bb['weak[limit]'], 2), value: v, source: unit });
            },
          },
          onStart({ battle, unit }) {
            battle.addDp(unit.ownerId, num(bb['svash2_s_3[start_cost].cost']));
            unit.mem.svashDpAcc = 0;
            unit.mem.svashReveal = AURA_IV;
            if (!unit.mem.svashSwapped) { // 首次开启时交换…基础部署费用
              unit.mem.svashSwapped = true;
              const { waiting } = waitingArea(battle, unit);
              const baseCost = (a) => a.mem.svashCostBase ?? a.base.cost;
              const byCost = waiting.slice().sort((a, b) => baseCost(b) - baseCost(a) || a.id - b.id);
              const hi = byCost.find((a) => PREF.includes(a.def?.profession)) ?? byCost[0];
              const lo = byCost.filter((a) => a !== hi).pop();
              if (hi && lo && baseCost(hi) !== baseCost(lo)) {
                const ch = baseCost(hi), cl = baseCost(lo);
                for (const [a, v] of [[hi, cl], [lo, ch]]) {
                  if (a.mem.svashCostBase != null) { a.base.cost = Math.max(0, v - (a.mem.svashCostBase - a.base.cost)); a.mem.svashCostBase = v; } else a.base.cost = v;
                }
              }
            }
          },
          onTick({ battle, unit, dt }) {
            const iv = Math.max(0.1, num(bb['svash2_s_3[cost].interval'], 2));
            unit.mem.svashDpAcc += dt;
            while (unit.mem.svashDpAcc >= iv - 1e-9) { unit.mem.svashDpAcc -= iv; battle.addDp(unit.ownerId, num(bb['svash2_s_3[cost].cost'], 1)); } // loop-cap: interval floored before the loop
            unit.mem.svashReveal += dt;
            if (unit.mem.svashReveal < AURA_IV - 1e-9) return;
            unit.mem.svashReveal = 0;
            for (const e of enemiesInGrid(battle, unit, grid, 0, { ignoreStealth: true })) battle.applyStatus(e, 'reveal', { duration: AURA_DUR, source: unit });
          },
        }),
      }),
      skill: {
        kind: 'charges', // DEFAULT (data): cast right before an attack on an enemy in his initial (melee) range
        onStart({ battle, unit }) {
          slash(battle, unit, unit.s.atk);
          // cost cut: nearest to the eye, right side guard/caster/sniper preferred
          const { left, pick } = waitingArea(battle, unit);
          cutCost(pick, num(bb.cost));
          for (const a of left) a.mem.svashCasts = Math.min(maxStacks, num(a.mem.svashCasts) + 1);
        },
      },
      talents: [
        { install(battle, unit) { // 开放性开局
          const sp = num(t0.sp), mul = num(t0.respawn_time, 1);
          const left = (a) => isOp(a) && a.ownerId === unit.ownerId && (a === unit || a.base.cost < num(unit.mem.eyeCost));
          battle.on('battleStart', () => {
            if (!on(unit) || !(sp > 0)) return;
            for (const a of battle.allies(unit.ownerId)) if (left(a) && a.skill) a.skill.gainSp(sp, 'talent');
          }, { owner: unit });
          battle.on('deploy', (c) => {
            const a = c.unit;
            if (c.initial || !left(a) || !(a === unit || on(unit))) return;
            if (sp > 0 && a.skill) a.skill.gainSp(sp, 'talent');
          }, { owner: unit });
          battle.on('death', (c) => {
            const a = c.unit;
            if (!left(a) || a.removed || !(a === unit || on(unit)) || !Number.isFinite(a.respawnAt) || !(mul > 0 && mul < 1)) return;
            a.respawnAt = a.deathAt + (a.respawnAt - a.deathAt) * mul;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 雪境先驱
          const defv = num(t1.def), regen = num(t1.hp_recovery_per_sec_by_max_hp_ratio), after = num(t1.interval, 15);
          whileOn(battle, unit, AURA_IV, () => {
            const m = battle.time - unit.deployedAt >= after - 1e-9 ? 2 : 1;
            for (const a of battle.allies()) {
              if (isOp(a) && isKjerag(a)) battle.addBuff(a, { key: 'svash2:snow', duration: AURA_DUR, mods: mods({ defFlat: defv * m, hpRegenRatio: regen * m }) });
            }
          });
          battle.on('beforeStatus', (c) => {
            if (c.status === 'freeze' && c.target.side === 'ally' && c.target.findBuff('svash2:snow')) c.cancel = true;
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        const tok = battle.tokenDef(eyeId, unit); // the owner's skill variant (DESIGN §16)
        unit.mem.eyeCost = num(tok?.stats?.cost, 14);
        if (selectedId(chess, def) === 'skchr_svash2_3') {
          // PRTS 备注 (S3): 「此技能的攻击（包括自身与赋予的攻击效果）无视目标的隐匿效果，可对空」 and 「技能期间，自身在可攻击时
          // （可对空）不直接攻击，而是请【丹增】进行攻击」 — the attacks are the eagle's, not his melee PIONEER ones. The data's
          // ACTIVE_RANGE condition asks the UNIT's profile (canHitFly false), so a wave of flyers alone left the ready
          // skill closed forever (reported playtest; the same hole 赤刃明霄陈 S3 had, op-chen3.js). Add those selectable
          // targets to the existing ACTIVE_RANGE automation through a content trigger range, exactly as she does:
          // [ASSUMED] its attack grid (plus permanent range extension), not the eagle's whole projectile path; the
          // operation cooldown and control checks stay the engine's.
          unit.skill.addTriggerRange(() => [{
            keys: absoluteRangeKeys(grid, unit.tileR, unit.tileC, unit.dir, unit.s.baseRangeExtend || 0), profile: AIR,
          }]);
          // S3: every attack hits the enemies of the skill range on the target's line (his facing frame): the line of
          // the target's position; another enemy is on it when its body is (a huge one: any tile — body.js)
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active || !c.targets.length) return;
            const main = c.targets[0];
            const lat = (r, cc) => toLocal(r - unit.tileR, cc - unit.tileC, unit.dir)[0];
            const l0 = lat(Math.round(main.y), Math.round(main.x));
            const onLine = (e) => bodyKeys(e).some((k) => lat(Math.floor(k / COLS), k % COLS) === l0);
            const line = battle.enemiesInKeys(unit.rangeKeys, unit, { ...unit.profile, canHitFly: true }).filter((e) => e !== main && onLine(e));
            if (line.length) c.targets = [main, ...line];
          }, { owner: unit, priority: 10 });
        }
        // waiting-area effects resolve when the op (re)deploys
        battle.on('deploy', (c) => {
          const a = c.unit;
          if (!isOp(a) || a.ownerId !== unit.ownerId) return;
          if (a.mem.svashCostBase != null) { a.base.cost = a.mem.svashCostBase; a.mem.svashCostBase = null; }
          if (num(a.mem.svashShield) > 0 && !c.initial) { // S1: 部署后获得…屏障
            battle.addBuff(a, { key: 'svash2:barrier', shield: a.mem.svashShield, visible: true });
            a.mem.svashShield = 0;
          }
          const casts = num(a.mem.svashCasts);
          if (casts > 0 && !c.initial) {
            a.mem.svashCasts = 0;
            for (let i = 0; i < casts; i++) slash(battle, a, a.s.atk);
          }
        }, { owner: unit });
      },
    };
  },
};
