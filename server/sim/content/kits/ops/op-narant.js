// server/sim/content/kits/ops/op-narant.js — 娜仁图亚 (char_4138_narant) 自选 operator kit: 6★ 回环射手 (狙击), an owned-6★ pick
// of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and both modules at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4138_narant, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, the picked module at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json); PRTS 娜仁图亚 (备注 of 旋刃
// and 恶魇); PRTS 分支特性信息 回环射手; gamedata_const ba.steal 偷取; PRTS 命中率.
// - Trait (回环射手) "持有回旋投射物时才能够攻击（投射物需要时间回收）": the profession's boomerang (professions.js loopshooter,
//   ai.js throwBoomerang: out 15, back 3.75 tiles/s; she attacks again once every boomerang is caught); hits air units.
// - Module LPS-X “吹尽狂沙”: trait "攻击周围8格的敌人时攻击力提升至110%" (trait bb atk_scale; the hidden module talent repeats it):
//   ×atk_scale on her attack hits on an enemy within one tile (3 × 3, as 跃跃's LPS-X). Stage 2+ “我见，我得” (below).
// - Module LPS-Y “致我们的老大”: trait "每回收5次回旋投射物时获得1点技力" (come_back_cnt / sp): every come_back_cnt boomerangs caught
//   (hook boomerangCaught; an S3 flight carries cnt) give sp SP — none while a skill of hers runs (the AK rule: giveSp)
//   [ASSUMED: the catches count all the same]. Stage 2+ 婀娜虚影 (below).
// - T1 “我见，我得” "在场时，每次攻击到敌人偷取其25点攻击力（最高250点）与20点防御力（最高200点）" (full potential: 27 (at most
//   270) / 21 (210)): every attack hit of hers that lands (normal attacks, S1 bounces, S2 hits and its way back, each S3
//   boomerang — not S3's recall blast [ASSUMED]) steals: the enemy loses steal_atk ATK / steal_def DEF of its base (flat, at
//   most steal_atk_max / steal_def_max in all) and she gains as much (flat, the same caps) — ba.steal "减少目标的基础属性作为
//   自身加成，目标减少和自身加成的属性不超过指定上限（同类属性取最高）": one loss per enemy, the largest of the 娜仁图亚 that stole
//   from it. Both last while she is on the field (在场时) [ASSUMED: they end when she leaves]; each steal adds to both sides,
//   each capped on its own [ASSUMED]. LPS-X stage 2+ (caps 297 / 231 → 324 / 252) "攻击到周围8格的敌人时偷取触发2次": the count
//   is parsed from the talent text (no blackboard key).
// - T2 婀娜虚影 "获得35%的物理与法术闪避，周围8格内敌人的物理与法术命中率-20%" (full potential: 38 %): dodgePhys / dodgeArts
//   +prob; every physical / arts attack of an enemy within one tile of her misses with damage_hitrate_* (PRTS 命中率: one
//   roll when the attack's first damage instance comes — as Raidian's 诱引, standin-acsupo.js —, a miss cancels every
//   instance and its riders; two 娜仁图亚 never add up). LPS-Y stage 3 −30 % and "6秒内未受到伤害时，攻击力+15%" (hidden atk /
//   interval): ATK +atk while she has taken no damage (流失 aside) for `interval` s — from her deployment on, as 远牙's 专注
//   [ASSUMED].
// - S1 旋刃 (切换: a toggle that stays on until she leaves — the kits' reading, 银灰 S2 [ASSUMED]): her range loses its far
//   column (攻击距离-1: ability_range_forward_extend −1; the engine's rangeExtend only grows), her boomerang hits for
//   attack@atk_scale × ATK and then bounces up to attack@times times (PRTS 备注: radius BOUNCE_RADIUS from the boomerang,
//   an enemy this attack has not hit first, then the nearest; BOUNCE_SPEED tiles/s), each bounce a hit of the same attack;
//   then it flies back. The data's DEFAULT trigger (the running range is smaller).
// - S2 恶魇 (30 s, attack SP): each hit attack@atk_scale × ATK + 停顿 attack@sluggish s; the boomerang then flies on
//   move_ahead_time s at DASH_SPEED tiles/s (PRTS 备注 "抵达目标所在位置后以1.0的速度再向前运动0.5s，随后返回") and on its way
//   back hits every enemy within attack@projectile_range (备注 "投射物碰撞半径1.0") once for attack@atk_scale_comeback × ATK.
// - S3 吞日 (20 s): each attack throws cnt boomerangs at the target (each attack@atk_scale × ATK; they fly together, as
//   跃跃's S2 [ASSUMED: the text names no other targets]); when they are caught she deals atk_scale_aoe × ATK physical to at
//   most attack@aoe.max_target enemies within one tile (her order) and 停顿 `sluggish` s — a skill hit, not an attack.

import { boundedCount } from '../../../../../shared/plugins/limits.js';
import { bbCap } from '../../../../../shared/plugins/officialBounds.js';
import { textCount } from '../../../../../shared/plugins/textNumber.js';
import { num, talentBb, moduleBb, traitBb, skillRec, statBuff, toggleBuff, onHitBy, enemiesInGrid, cheb, up, giveSp } from '../shared/tier1.js';
import { canTargetEnemy } from '../../../targeting.js';
import { isHpLoss, cancelDamage } from '../../../attack.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_narant_1';
const S2 = 'skchr_narant_2';
const S3 = 'skchr_narant_3';
/** PRTS 旋刃 备注: "弹射半径1.7…弹射期间投射物移动速度6.0". */
const BOUNCE_RADIUS = 1.7;
const BOUNCE_SPEED = 6;
/** PRTS 恶魇 备注: "以1.0的速度再向前运动0.5s" (the time is the blackboard's move_ahead_time). */
const DASH_SPEED = 1;
/** "周围8格": her tile and the eight around it. */
const AROUND = Object.freeze([[-1, -1], [-1, 0], [-1, 1], [0, -1], [0, 0], [0, 1], [1, -1], [1, 0], [1, 1]].map(Object.freeze));
/** 婀娜虚影's battle-wide `hit` handler runs before the enemy content's own riders (200), as Raidian's 诱引. */
const MISS_PRIORITY = 300;
const LOOT_KEY = 'talent:narant:loot';
const STOLEN_KEY = 'narant:stolen';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const count = (v, d) => Math.max(1, Math.floor(num(v, d)));
/** The named talent record `i` (data index ≥ 0) of the composed record. */
const talentRec = (chess, i) => (chess?.talents ?? []).filter((t) => t && t.index !== -1)[i] ?? null;

/** A range grid whose rows lose their `n` farthest tiles ("攻击距离-n"). */
function shortenGrid(grid, n) {
  const far = new Map();
  for (const [dr, dc] of grid) far.set(dr, Math.max(far.get(dr) ?? -Infinity, dc));
  return grid.filter(([dr, dc]) => dc <= far.get(dr) - n).map(([dr, dc]) => [dr, dc]);
}

// ---- T1 偷取: the losses of the enemies, one battle-wide table (同类属性取最高 over several thieves) ----------------------
/** battle → Map(enemy → Map(thief id → { a, d })). */
const STOLEN = new WeakMap();
const stolenOf = (battle) => { let m = STOLEN.get(battle); if (!m) STOLEN.set(battle, (m = new Map())); return m; };
function applyLoss(battle, e, per) {
  let a = 0, d = 0;
  for (const v of per.values()) { a = Math.max(a, v.a); d = Math.max(d, v.d); }
  if (!(a > 0) && !(d > 0)) { battle.removeBuff(e, STOLEN_KEY); return; }
  battle.addBuff(e, { key: STOLEN_KEY, mods: { atkFlat: -a, defFlat: -d }, tags: ['steal'] });
}

// ---- T2 命中率: one battle-wide handler over every 娜仁图亚 of the battle -------------------------------------------------
/** battle → { srcs: [{ unit, phys, arts }], last: WeakMap(enemy → { id, miss }) }. */
const MISS = new WeakMap();
function missCut(st, e, type) {
  let cut = 0;
  for (const s of st.srcs) {
    const v = type === 'arts' ? s.arts : s.phys;
    if (v > cut && up(s.unit) && cheb(s.unit, e) <= 1) cut = v;
  }
  return Math.min(1, cut);
}
function missHit(battle, st, ctx) {
  const e = ctx.source, d = ctx.dmg;
  if (!e || e.side !== 'enemy' || !d || !d.isAttack || d.cancel || (d.type !== 'phys' && d.type !== 'arts')) return;
  // one roll per attack: every damage instance of it shares the first instance's result
  const prev = d.attackId ? st.last.get(e) : null;
  let miss;
  if (prev && prev.id === d.attackId) miss = prev.miss;
  else {
    const cut = missCut(st, e, d.type);
    miss = cut > 0 && battle.rng() < cut;
    if (d.attackId) st.last.set(e, { id: d.attackId, miss });
  }
  if (!miss) return;
  const cancelled = cancelDamage(d, 'miss');
  if (cancelled) ctx.stopPropagation = true;
  if (ctx.target) battle.fx('dodge', { x: ctx.target.x, y: ctx.target.y, id: ctx.target.id });
}
function installMiss(battle, unit, phys, arts) {
  if (!(phys > 0) && !(arts > 0)) return;
  let st = MISS.get(battle);
  if (!st) {
    st = { srcs: [], last: new WeakMap() };
    MISS.set(battle, st);
    // no owner: it serves every 娜仁图亚 of the battle, whichever is on the field
    battle.on('hit', (ctx) => missHit(battle, st, ctx), { priority: MISS_PRIORITY });
  }
  st.srcs.push({ unit, phys, arts });
}

export default {
  char_4138_narant: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const hidden = moduleBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const cnt = Math.max(1, Math.floor(boundedCount(num(b3.cnt, 3), bbCap('cnt'), 3)));

    /** S1: the boomerang bounces from (ctx.x, ctx.y) — at most attack@times jumps — then flies back. */
    const bounce = (ctx) => {
      const { battle, unit } = ctx;
      const hit = new Set(ctx.target ? [ctx.target] : []);
      let on = ctx.target, x = ctx.x, y = ctx.y, left = count(b1['attack@times'], 3);
      const next = () => {
        if (left <= 0 || !ctx.home()) { ctx.comeBack(x, y); return; }
        const cands = battle.foesInRadius(x, y, BOUNCE_RADIUS).filter((e) => e !== on && canTargetEnemy(unit, e, ctx.profile));
        if (!cands.length) { ctx.comeBack(x, y); return; }
        const d2 = (e) => (e.x - x) * (e.x - x) + (e.y - y) * (e.y - y);
        cands.sort((a, b) => (hit.has(a) ? 1 : 0) - (hit.has(b) ? 1 : 0) || d2(a) - d2(b) || a.spawnSeq - b.spawnSeq);
        const tgt = cands[0];
        left--;
        battle.addProjectile({ from: { x, y }, target: tgt, speed: BOUNCE_SPEED, visual: 'boomerang', source: unit, hitDead: true,
          onHit: (c) => {
            x = c.x; y = c.y;
            on = c.target;
            if (c.target) { hit.add(c.target); ctx.hit(c.target, c.x, c.y); }
            next();
          } });
        battle.fx('bounce', { x, y, id: unit.id, target: tgt.id });
      };
      next();
    };

    /** S2: the boomerang dashes on, then hits every enemy it passes on its way back (once each). */
    const dash = (ctx) => {
      const { battle, unit } = ctx;
      let dx = ctx.x - unit.x, dy = ctx.y - unit.y;
      const len = hypot(dx, dy);
      if (len > 1e-9) { dx /= len; dy /= len; } else { const [fr, fc] = unit.fwd; dx = fc; dy = fr; }
      const ahead = DASH_SPEED * Math.max(0, num(b2['attack@move_ahead_time'], 0.5));
      battle.addProjectile({ from: { x: ctx.x, y: ctx.y }, to: { x: ctx.x + dx * ahead, y: ctx.y + dy * ahead }, speed: DASH_SPEED, visual: 'boomerang', source: unit, hitDead: true,
        onHit: (c) => {
          const back = ctx.comeBack(c.x, c.y);
          if (!back) return;
          const r = num(b2['attack@projectile_range'], 1), scale = num(b2['attack@atk_scale_comeback'], 1);
          const passed = new Set();
          const h = battle.on('tick', () => {
            for (const e of battle.foesInRadius(back.x, back.y, r)) {
              if (passed.has(e) || !canTargetEnemy(unit, e, ctx.profile)) continue;
              passed.add(e);
              battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isAttack: true, isSkill: true, attackId: ctx.attackId, tags: ['skill', 'narant:comeback'] });
            }
            if ((back.x === back.tx && back.y === back.ty) || !ctx.home()) battle.off(h);
          }, { owner: unit });
        } });
    };

    /** S3: the recall blast on at most attack@aoe.max_target enemies around her. */
    const blast = (battle, unit) => {
      if (!up(unit)) return;
      const n = count(b3['attack@aoe.max_target'], 3), scale = num(b3.atk_scale_aoe, 1), slug = num(b3.sluggish);
      battle.fx('aoe', { x: unit.x, y: unit.y, radius: 1, id: unit.id, skill: 'narant:sunswallower' });
      for (const e of enemiesInGrid(battle, unit, AROUND, { n, canHitFly: true })) {
        battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, tags: ['skill', 'narant:blast'] });
        if (e.alive && slug > 0) battle.applyStatus(e, 'sluggish', { duration: slug, source: unit });
      }
    };

    return {
      skills: {
        [S1]: {
          kind: 'toggle',
          targeting: { rangeGrid: shortenGrid(chess.rangeGrid ?? [[0, 1]], Math.max(0, -Math.round(num(b1.ability_range_forward_extend, -1)))) },
          attack: { atkScale: num(b1['attack@atk_scale'], 1), boomerangOnward: bounce },
        },
        [S2]: {
          kind: 'duration',
          attack: { atkScale: num(b2['attack@atk_scale'], 1), onHitStatus: { key: 'sluggish', duration: num(b2['attack@sluggish'], 1) }, boomerangOnward: dash },
        },
        [S3]: { kind: 'duration', attack: { atkScale: num(b3['attack@atk_scale'], 1), hits: cnt } },
      },
      talents: [
        { install(battle, unit) { // “我见，我得”: each landing attack hit steals ATK / DEF (LPS-X stage 2+: twice within one tile)
          const sa = num(t0['attack@steal_atk']), sd = num(t0['attack@steal_def']);
          if (!(sa > 0) && !(sd > 0)) return;
          const capA = num(t0['attack@steal_atk_max'], Infinity), capD = num(t0['attack@steal_def_max'], Infinity);
          const nearTimes = Math.max(1, Math.floor(textCount(String(talentRec(chess, 0)?.desc ?? ''), /偷取触发(\d+)次/, 1, 'steal')));
          const losses = stolenOf(battle);
          const victims = new Set();
          const reset = () => { unit.mem.narantLoot = { a: 0, d: 0 }; };
          reset();
          battle.on('deploy', (c) => { if (c.unit === unit) reset(); }, { owner: unit });
          battle.on('damageBeforeApply', (c) => {
            const e = c.target;
            if (c.source !== unit || !c.dmg?.isAttack || !e || !e.alive || e.side !== 'enemy' || !up(unit)) return;
            const times = nearTimes > 1 && cheb(unit, e) <= 1 ? nearTimes : 1;
            const me = unit.mem.narantLoot;
            let per = losses.get(e);
            if (!per) losses.set(e, (per = new Map()));
            const loss = per.get(unit.id) ?? { a: 0, d: 0 };
            for (let i = 0; i < times; i++) { // loop-cap: textCount steal
              me.a = Math.min(capA, me.a + sa); me.d = Math.min(capD, me.d + sd);
              loss.a = Math.min(capA, loss.a + sa); loss.d = Math.min(capD, loss.d + sd);
            }
            per.set(unit.id, loss);
            victims.add(e);
            battle.addBuff(unit, { key: LOOT_KEY, mods: { atkFlat: me.a, defFlat: me.d }, tags: ['talent'] });
            if (e.alive) applyLoss(battle, e, per);
          }, { owner: unit });
          // 在场时: off the field she keeps nothing (her buff goes with the removal) and the enemies get back what she took
          battle.on('death', (c) => {
            if (c.unit !== unit) return;
            for (const e of victims) {
              const per = losses.get(e);
              if (!per || !per.delete(unit.id)) continue;
              if (e.alive) applyLoss(battle, e, per);
            }
            victims.clear();
          }, { owner: unit });
        } },
        { install(battle, unit) { // 婀娜虚影: dodge; enemies within one tile miss; LPS-Y stage 3: ATK + while unhurt
          const p = num(t1.prob);
          statBuff(battle, unit, 'talent:narant:dodge', { dodgePhys: p, dodgeArts: p });
          installMiss(battle, unit, Math.abs(num(t1.damage_hitrate_physical)), Math.abs(num(t1.damage_hitrate_magical)));
          const atk = num(hidden.atk), iv = num(hidden.interval);
          if (!(atk > 0) || !(iv > 0)) return;
          unit.mem.narantHurt = -Infinity;
          battle.on('damaged', (c) => { if (c.target === unit && c.amount > 0 && !isHpLoss(c.dmg)) unit.mem.narantHurt = battle.time; }, { owner: unit });
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.narantHurt = -Infinity; }, { owner: unit });
          toggleBuff(battle, unit, 'talent:narant:calm', () => battle.time - unit.mem.narantHurt >= iv - 1e-9, { atkPct: atk });
        } },
      ],
      install(battle, unit) {
        // LPS-X: ×atk_scale on attack hits within one tile
        const near = num(tb.atk_scale, 1);
        if (near !== 1) onHitBy(battle, unit, ({ target, dmg }) => { if (dmg.isAttack && cheb(unit, target) <= 1) dmg.amount *= near; });
        // LPS-Y: sp SP every come_back_cnt boomerangs caught; S3: the recall blast
        const every = Math.floor(num(tb.come_back_cnt)), sp = num(tb.sp);
        const s3 = unit.skill?.id === S3;
        if (!(every > 0 && sp > 0) && !s3) return;
        unit.mem.narantCaught = 0;
        battle.on('boomerangCaught', (c) => {
          if (c.unit !== unit) return;
          const flightS3 = s3 && c.isSkill;
          if (every > 0 && sp > 0) {
            unit.mem.narantCaught += flightS3 ? cnt : 1;
            while (unit.mem.narantCaught >= every) { unit.mem.narantCaught -= every; giveSp(unit, sp, 'module'); } // loop-cap: integer come_back_cnt; cnt capped by bbCap
          }
          if (flightS3) blast(battle, unit);
        }, { owner: unit });
      },
    };
  },
};
