// server/sim/content/kits/ops/chess_char_6_02-sbell2.js — 圣聆初雪 (char_1046_sbell2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { bodyInKeys } from '../../../body.js';
import { num, tbb, moduleBb, live, keyOf, enemiesIn, isTok, instantKind, AROUND8, aura } from '../shared/tier6.js';
import { hypot } from '../../../detmath.js';

// ------------------------------------------------------------------------------------------------------------------
// 圣聆初雪 chess_char_6_02 (阵法术师) — S3 群山俯首; 无垠的雪景; 圣山的祝福; module 千分之一的心

function sbell2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), mod = moduleBb(chess);
  const skillGrid = def?.skill?.rangeGrid?.length ? def.skill.rangeGrid : null;
  const maxL = Math.max(1, Math.floor(num(t0.max_cast_cnt, 5)));
  const iceId = (chess?.tokens || []).find((t) => /icetgt/.test(String(t))) || 'token_10058_sbell2_icetgt';
  /**
   * S2 霜涛覆岭 while it runs (`unit.mem.sbellS2`): a layer landing on a tile already at max snow spreads one layer to
   * a neighbouring ground tile (at most max_cast_tile_count spreads per activation); ground enemies on snow take
   * s2_magic_scale × ATK arts per second; an enemy leaving snow gets `cold` s of 寒冷; "积雪在目标点积累至5层时，使目标点变为
   * 冻结状态": a protection point (the blue gate) reaching max snow turns into the frozen 保护目标 (freezeTile).
   */
  const addSnow = (battle, unit, k) => {
    const snow = unit.mem.snow;
    if (!snow) return false;
    const r = (k / COLS) | 0, c = k % COLS;
    if (!battle.grid.inRect(r, c) || !battle.grid.groundPassable(r, c, true)) return false;
    // PRTS 备注 "存在自身的该召唤物的地块不会积雪"
    if (battle.allyUnits.some((t) => isTok(t, iceId, unit) && t.alive && t.tileR === r && t.tileC === c)) return false;
    const S2 = unit.mem.sbellS2;
    const cur = snow.get(k) ?? 0;
    // a protection point already at max snow (its freeze waited for her other token to go) freezes on its next layer
    if (S2 && cur >= maxL && freezeTile(battle, unit, k)) return true;
    if (cur >= maxL) {
      if (!S2 || S2.spreadLeft <= 0) return false;
      // "积雪超过5层时会向周围扩散一层": the thinnest neighbouring ground tile gets the layer
      let best = null, bl = Infinity;
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nr = r + dr, nc = c + dc;
        if (!battle.grid.inRect(nr, nc) || !battle.grid.groundPassable(nr, nc, true)) continue;
        const L = snow.get(nr * COLS + nc) ?? 0;
        if (L < maxL && L < bl) { bl = L; best = nr * COLS + nc; }
      }
      if (best == null) return false;
      S2.spreadLeft--;
      return addSnow(battle, unit, best);
    }
    snow.set(k, cur + 1);
    if (S2 && cur + 1 >= maxL) freezeTile(battle, unit, k);
    return true;
  };
  /**
   * "使目标点变为冻结状态" — PRTS 圣聆初雪 S2 备注: "目标点冻结的实际效果为令圣聆初雪在该地块上召唤一个保护目标（冻结状态）（无视部署
   * 属性），并去除相应地块上的积雪", "可以被'变为冻结状态'的目标点包括常规的保护目标点与促融共竞的保护目标点"; the token's page:
   * "技能发动后于保护目标叠加5层积雪". So only a protection point (a goal tile, glyph E) freezes, whatever its deploy attributes
   * (nobody may stand on a gate): her token icetgt (blocks 3; one at a time, maxDeployCount 1) appears on it and blocks the
   * enemies walking in, and that tile's snow is used up. Until 0.1.3 (community report #32): any free tile a melee
   * operator could stand on froze at max snow, and the gate never did. Returns true when the token appeared.
   */
  const freezeTile = (battle, unit, k) => {
    const r = (k / COLS) | 0, c = k % COLS;
    if (battle.grid.tile(r, c).special !== 'end') return false;
    if (battle.allyUnits.some((t) => isTok(t, iceId, unit) && t.alive)) return false;
    if (battle.isReservedTile(r, c)) return false;
    const ice = battle.spawnToken(unit, iceId, r, c);
    if (!ice) return false;
    unit.mem.snow.delete(k);
    battle.fx('summon', { x: c, y: r, id: ice.id, src: unit.id });
    return true;
  };
  const talents = [
    { install(battle, unit) { // 无垠的雪景 (+ S2 snow rules)
      const ivN = num(t0.interval, 5.5), ivS = num(bb.interval, ivN);
      const slow = num(t0.move_speed), scale = num(t0.talent_magic_scale);
      const snow = new Map();
      unit.mem.snow = snow;
      const last = new WeakMap();
      let acc = 0, dotAcc = 0;
      const lay = () => {
        let n = 0;
        for (const k of unit.rangeKeys || []) if (addSnow(battle, unit, k)) n++;
        if (n) battle.fx('snow', { x: unit.x, y: unit.y, id: unit.id, tiles: n });
      };
      battle.on('deploy', ({ unit: u }) => {
        if (u !== unit) return;
        snow.clear();
        acc = 0;
        if (num(t0.first_snow) > 0) lay();
      }, { owner: unit });
      battle.on('tick', ({ dt }) => {
        if (!live(unit)) return;
        acc += dt;
        if (acc + 1e-9 >= (unit.skill && unit.skill.active ? ivS : ivN)) { acc = 0; lay(); }
        if (!snow.size) return;
        const S2 = unit.mem.sbellS2;
        for (const e of battle.enemies) {
          if (!e.alive || e.hidden) continue;
          const k = keyOf(e);
          const prev = last.get(e);
          if (prev !== k) {
            last.set(e, k);
            const hadSnow = prev !== undefined && !e.isFlying && snow.has(prev);
            if (hadSnow) snow.delete(prev); // first enemy leaving clears it
            if (!e.isFlying && snow.has(k) && scale > 0) battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', tags: ['talent', 'snow'] });
            if (S2 && hadSnow && !snow.has(k) && e.alive && S2.cold > 0) battle.applyStatus(e, 'cold', { duration: S2.cold, source: unit });
          }
          const L = snow.get(k);
          if (L && e.alive && slow) battle.addBuff(e, { key: 'sbell2:snow', duration: 0.2, refresh: 'replace', mods: { moveMul: Math.max(0, 1 + slow * L) }, source: unit });
        }
        if (!S2 || !(S2.dot > 0)) { dotAcc = 0; return; }
        dotAcc += dt;
        if (dotAcc + 1e-9 < 1) return;
        dotAcc -= 1;
        for (const e of battle.enemies) {
          if (e.alive && !e.hidden && !e.isFlying && bodyInKeys(e, snow)) battle.dealDamage(unit, e, { amount: unit.s.atk * S2.dot, type: 'arts', isSkill: true, tags: ['skill', 'snow'] });
        }
      }, { owner: unit });
    } },
    { install(battle, unit) { // 圣山的祝福
      const cold = num(t1.cold), selfFreeze = num(t1.freeze), eFreeze = num(t1.c2e_freeze), hr = num(t1.hp_ratio, 1);
      battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.blessUsed = false; }, { owner: unit });
      battle.on('damaged', (ctx) => {
        if (ctx.target !== unit || !(cold > 0) || ctx.type === 'element') return;
        const s = ctx.source;
        if (s && s.side === 'enemy' && s.alive) battle.applyStatus(s, 'cold', { duration: cold, source: unit });
      }, { owner: unit });
      battle.on('fatal', (ctx) => {
        if (ctx.unit !== unit || ctx.prevented || unit.mem.blessUsed) return;
        ctx.prevented = true;
        unit.mem.blessUsed = true;
        unit.hp = Math.max(1, unit.s.maxHp * hr);
        if (selfFreeze > 0) battle.applyStatus(unit, 'freeze', { duration: selfFreeze, source: unit, force: true });
        if (eFreeze > 0) for (const e of enemiesIn(battle, unit)) battle.applyStatus(e, 'freeze', { duration: eFreeze, source: unit });
        battle.fx('blessing', { x: unit.x, y: unit.y, id: unit.id });
      }, { owner: unit, priority: -50 });
    } },
  ];
  if (num(mod.damage_scale) > 0) {
    talents.push({ install(battle, unit) { // module: +3 % damage per enemy in range (max 5)
      const per = num(mod.damage_scale), cap = Math.max(1, Math.floor(num(mod.max_valid_stack_cnt, 5)));
      aura(battle, unit, 0.25, () => {
        const n = Math.min(cap, enemiesIn(battle, unit).length);
        if (n > 0) battle.addBuff(unit, { key: 'sbell2:heart', mods: { dmgDealtMul: 1 + per * n }, duration: 0.4, refresh: 'replace' });
      });
    } });
  }
  const skills = {
    // S1 铃音吹雪 (SEARCH trigger, 2 charges): atk_scale × ATK arts + `cold` s of 寒冷 on every enemy in range, pushed
    // (force 1 = 中力) along her direction — PRTS 备注 "固定方向推动（不会因角度过大或距离过近而变化方向与力度），且仅对地面
    // 单位产生推力" (Battle.push fixed, official 力度 − 重量 distance); then one snow layer spreads forward over the ground
    // (≤ trig_cnt tiles)
    skchr_sbell2_1: {
      kind: instantKind(def),
      // data trigger SEARCH (the 阵法术师 row, every MANUAL skill of the class: "在初始攻击范围内存在敌人时释放技能") =
      // an enemy inside her initial range, checked every tick — what the engine's DEFAULT does for a phalanx
      // (noAttackUnlessSkill); an enemy anywhere on the field would dump both charges on an enemy spawning at the gate
      trigger: 'DEFAULT',
      onStart({ battle, unit }) {
        const [fr, fc] = unit.fwd;
        const force = num(bb.force);
        for (const e of enemiesIn(battle, unit)) {
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill'] });
          if (!e.alive) continue;
          if (num(bb.cold) > 0) battle.applyStatus(e, 'cold', { duration: num(bb.cold), source: unit });
          if (!e.isFlying) battle.push(e, force, { from: unit, dir: { x: fc, y: fr }, fixed: true });
        }
        const n = Math.max(0, Math.floor(num(bb.trig_cnt, 5)));
        let laid = 0;
        for (let d = 1; d <= n; d++) {
          const r = unit.tileR + fr * d, c = unit.tileC + fc * d;
          if (!battle.grid.inRect(r, c)) break;
          if (addSnow(battle, unit, r * COLS + c)) laid++;
        }
        battle.fx('frostNova', { x: unit.x, y: unit.y, id: unit.id, tiles: laid });
      },
    },
    // S2 霜涛覆岭 (toggle, 持续时间无限): group attacks at attack@atk_scale_s2 × ATK + the S2 snow rules (addSnow / talent)
    skchr_sbell2_2: {
      kind: 'toggle',
      attack: { atkScale: num(bb['attack@atk_scale_s2'], 1) },
      onStart({ unit }) {
        unit.mem.sbellS2 = { spreadLeft: Math.floor(num(bb['talent@max_cast_tile_count'], 20)), dot: num(bb['talent@s2_magic_scale']), cold: num(bb['talent@cold']) };
      },
      onEnd({ battle, unit }) {
        unit.mem.sbellS2 = null;
        for (const t of battle.allyUnits) if (isTok(t, iceId, unit) && t.alive) battle.retreat(t, { reason: 'expired', permanent: true });
      },
    },
  };
  return {
    skills,
    skill: {
      kind: 'duration',
      mods: { atkPct: num(bb.atk), aspd: num(bb.attack_speed), resIgnoreFlat: num(bb.magic_resist_penetrate_fixed) },
      ...(skillGrid ? { targeting: { rangeGrid: skillGrid } } : {}),
      attack: { atkScale: num(bb['attack@atk_scale_s3'], 1) },
      onStart({ battle, unit }) { // 立即诱导攻击范围内的所有敌人至自身周围的可达地面，持续 attract_time 秒
        const dur = num(bb.attract_time);
        if (!(dur > 0)) return;
        let n = 0;
        // 诱导 = the engine `attract` status: unblockable, walked (own speed, grid path) to the point, then its route
        // resumes; it runs its full time even if she falls meanwhile
        for (const e of enemiesIn(battle, unit)) {
          if (e.isFlying || e.isBoss || !e.alive) continue;
          const goal = lureGoal(battle, unit, e);
          if (goal && battle.applyStatus(e, 'attract', { duration: dur, source: unit, point: goal })) n++;
        }
        battle.fx('mountainBow', { x: unit.x, y: unit.y, id: unit.id, n });
      },
    },
    talents,
  };
}

/** The nearest ground tile around `unit` to `e` ("自身周围的可达地面"), or null. */
function lureGoal(battle, unit, e) {
  let goal = null, bd = Infinity;
  for (const [dr, dc] of AROUND8) {
    const r = unit.tileR + dr, c = unit.tileC + dc;
    if (!battle.grid.groundPassable(r, c)) continue;
    const d = hypot(e.x - c, e.y - r);
    if (d < bd - 1e-9) { bd = d; goal = [r, c]; }
  }
  return goal;
}

export default {
  chess_char_6_02_a: sbell2,
};
