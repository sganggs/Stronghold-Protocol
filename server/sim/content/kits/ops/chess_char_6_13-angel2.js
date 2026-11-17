// server/sim/content/kits/ops/chess_char_6_13-angel2.js — 新约能天使 (char_1041_angel2) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { sortEnemyTargets, aggroCmp, absoluteRangeKeys } from '../../../targeting.js';
import { summonToken, TOKEN_IDS } from '../../tokens.js';
import { num, bv, tbb, live, hasBond, ANY, isTok, selectedSkill, batOf, aura } from '../shared/tier6.js';

/** Barrier of `total` HP decaying linearly to 0 over `dur` seconds. */
function decayingShield(battle, u, key, total, dur) {
  if (!(total > 0)) return null;
  const decays = dur > 0;
  return battle.addBuff(u, {
    key, shield: total, duration: decays ? dur : Infinity, visible: true, interval: decays ? 0.5 : 0,
    onTick: decays ? ({ unit, buff }) => { buff.shield = Math.max(0, buff.shield - (total * 0.5) / dur); unit.markDirty(); } : null,
  });
}

// ------------------------------------------------------------------------------------------------------------------
// 新约能天使 chess_char_6_13 (怪杰) — S2 开火成瘾症; 火力电台; 铳弹协约; module 新朋友圣城生活套组
// S2 (PRTS 备注): the ally is the friendly operator of her attack range with the highest 仇恨值 ("选择的友方干员为攻击范围内
// 仇恨值最高的我方干员": highest taunt level, then the latest deployed — targeting.js aggroCmp, the order enemies attack
// in; it used to be the highest ASPD, so the shield often went to a back-row shooter instead of the operator in front);
// both barriers are shield_max_hp_ratio × the holder's OWN max HP ("获得的屏障均以自身生命上限为标准计算"), losing
// initial/shield_max_duration per second ("屏障每秒衰减量为：初始屏障量/30"); a new one replaces the old one ("重复获得此
// 屏障时，重置屏障量与衰减速度").

/** S3's 投递坐标 splash radius [ASSUMED: not in data]. */
const AIRSTRIKE_RADIUS = 1;
/** 火力电台's bombing: PRTS 新约能天使 天赋 备注 「轰炸半径1.3，单轮多次轰炸之间间隔0.1s」 (fx TalentBomb additionalTimes /
 * triggerDelta 0.1). */
const BOMB_RADIUS = 1.3, BOMB_GAP = 0.1;

function angel2(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const sid = selectedSkill(chess, def);
  const steal = num(bb.steal), extra = Math.floor(num(bb.addtional_ammo_each));
  const shieldRatio = num(bb.shield_max_hp_ratio), shieldDur = num(bb.shield_max_duration);
  const coordId = (chess?.tokens || []).find((t) => /angel2_target/.test(String(t))) || TOKEN_IDS.deliveryTarget;
  const perAttack = 5; // S3 "每次攻击消耗5发" (the 5 连击)
  const coord = (battle, unit) => battle.allyUnits.find((t) => isTok(t, coordId, unit) && t.alive) ?? null;
  const placeCoord = (battle, unit) => {
    unit.mem.angelCoord = false;
    if (coord(battle, unit)) return;
    const t = summonToken(battle, unit, coordId, 'melee');
    if (t) battle.fx('anchor', { x: t.x, y: t.y, id: t.id, src: unit.id });
  };
  const skills = {
    // S1 天空大扫除: 8 bullets at attack@atk_scale × ATK, flyers first; stopped by hand ⇒ the remaining bullets are fired
    // at random enemies of her range
    skchr_angel2_1: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 8))),
      attack: { atkScale: num(bb['attack@atk_scale'], 1) },
      targeting: { priority: 'fly' },
      onAttack({ unit, skill }) { unit.mem.angelLeft = skill.ammoLeft - 1; },
      onEnd({ battle, unit, skill, reason }) {
        const left = Math.max(0, Math.floor(num(unit.mem.angelLeft)));
        unit.mem.angelLeft = 0;
        if (reason !== 'stopped' || !unit.alive || !left) return;
        for (let i = 0; i < left; i++) {
          const c = battle.enemiesInKeys(unit.rangeKeys, unit, ANY);
          const e = battle.rng.pick(c);
          if (!e) break;
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['attack@atk_scale'], 1), type: 'phys', isAttack: true, isSkill: true, tags: ['skill', 'volley'] });
          battle.emit('ammoUsed', { unit, left: left - i - 1, skill });
        }
      },
    },
    // S3 使命必达！: ATK +atk; attacks are 5 hits of attack@atk_scale × ATK spending 5 of the 50 bullets; at the start,
    // with a 投递坐标 (placed after each deployment, install): attack@cannon_atk_scale × ATK physical splash there and the
    // knocked-out ground operator with the longest remaining redeploy time lands on it with attack@sp SP
    skchr_angel2_3: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 50))),
      mods: { atkPct: num(bb.atk) },
      attack: { atkScale: num(bb['attack@atk_scale'], 1), hits: perAttack },
      onStart({ battle, unit }) {
        if (unit.mem.angelCoord) placeCoord(battle, unit);
        const c = coord(battle, unit);
        if (!c) return;
        const r = c.tileR, col = c.tileC;
        battle.fx('airstrike', { x: col, y: r, id: unit.id, r: AIRSTRIKE_RADIUS });
        for (const e of battle.foesInRadius(col, r, AIRSTRIKE_RADIUS)) {
          if (e.alive && !e.s.flags.untargetable) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb['attack@cannon_atk_scale'], 1), type: 'phys', isSkill: true, isSplash: true, tags: ['skill', 'delivery'] });
        }
        const waiting = battle.allyUnits.filter((a) => a.kind === 'op' && a.ownerId === unit.ownerId && !a.alive && !a.removed && a !== unit
          && a.def?.position !== 'RANGED' && battle.grid.canStand(r, col, { ranged: false }));
        if (!waiting.length) return;
        waiting.sort((a, b) => (b.respawnAt ?? 0) - (a.respawnAt ?? 0) || b.base.respawnTime - a.base.respawnTime || a.id - b.id);
        const a = waiting[0];
        battle.retreat(c, { reason: 'expired', permanent: true });
        if (battle.redeploy(a, { free: true, tile: [r, col] })) {
          if (a.skill) a.skill.gainSp(num(bb['attack@sp']), 'skill');
          battle.fx('appear', { x: col, y: r, id: a.id, src: unit.id });
        }
      },
      onAttack({ battle, unit, skill }) { // bullets 2..5 of the 5 连击 (the engine spends the 1st)
        for (let i = 1; i < perAttack && skill.ammoLeft > 1; i++) {
          skill.ammoLeft--;
          battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
        }
      },
    },
  };
  return {
    skills,
    install(battle, unit) {
      if (sid === 'skchr_angel2_1') { // bullets loaded at the start (after every skillStart ammo bonus: 逃犯引渡手续 …)
        battle.on('skillStart', ({ unit: u, skill }) => { if (u === unit) unit.mem.angelLeft = skill.ammoLeft; }, { owner: unit, priority: -500 });
      }
      if (sid !== 'skchr_angel2_3') return;
      // "部署后获得投递坐标": one coordinate per deployment, placed (the player's choice in the original) on a ground tile
      // of her range on the enemy path next to the first enemy that enters her range (at the latest when S3 starts)
      battle.on('deploy', ({ unit: u }) => { if (u === unit) unit.mem.angelCoord = !coord(battle, unit); }, { owner: unit });
      battle.on('tick', () => {
        if (!unit.mem.angelCoord || !live(unit) || !battle.enemiesInKeys(unit.rangeKeys, unit, ANY).length) return;
        placeCoord(battle, unit);
      }, { owner: unit });
    },
    skill: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 10))),
      mods: { batPct: batOf(bb.base_attack_time, def) },
      attack: { atkScale: num(bb['attack@atk_scale'], 1) },
      onStart({ battle, unit, skill }) {
        const cands = battle.alliesInGrid(unit).filter((a) => a !== unit && a.kind === 'op' && live(a));
        cands.sort(aggroCmp);
        const victim = steal > 0 ? cands[0] ?? null : null;
        unit.mem.angelVictim = victim;
        decayingShield(battle, unit, 'angel2:barrier', unit.s.maxHp * shieldRatio, shieldDur);
        if (victim) {
          battle.addBuff(victim, { key: 'angel2:stolen', mods: { aspd: -steal }, source: unit, visible: true });
          battle.addBuff(unit, { key: 'angel2:steal', mods: { aspd: steal } });
          decayingShield(battle, victim, 'angel2:barrier', victim.s.maxHp * shieldRatio, shieldDur);
          if (extra > 0) skill.addAmmo(extra);
          battle.fx('steal', { x: victim.x, y: victim.y, id: victim.id, src: unit.id });
        }
      },
      onEnd({ battle, unit }) {
        const v = unit.mem.angelVictim;
        unit.mem.angelVictim = null;
        if (v) battle.removeBuff(v, 'angel2:stolen');
        battle.removeBuff(unit, 'angel2:steal');
      },
    },
    talents: [
      { install(battle, unit) { // 火力电台
        // PRTS 备注: one round per consumption (the bullets one action spends: the engine's 1st and a kit's further ones
        // in the same tick); each bullet heals and rolls the chance, and each success adds a bombing to the round; the
        // target is chosen once per round, by her (her default targeting, 「始终使用默认索敌逻辑」) among the enemies of the
        // consumer's range (its own grid, 「不受对方的攻击距离增减」: no 攻击距离 change counts, nor the permanent 攻击距离 +N
        // extension of talents, modules and bonds — `s.baseRangeExtend`, baseRangeKeys' [ASSUMED: the note names no
        // exception]; a grid the unit's module or kit replaces, `u.rangeGrid` — tier4 applyModuleRange, op-aphris's path
        // —, is its own grid and counts; tier5 moduleRangeUp's no-grid fallback is a rangeExtend buff and is excluded);
        // the bombings land BOMB_GAP apart,
        // radius BOMB_RADIUS around the target (附着型弹道: it follows the target), with the damage computed when the round
        // is made (「预计算的物理普通伤害」). Until 0.3.2 every success chose its own target with the consumer's sort and hit
        // radius 1 at once (DESIGN §35.28).
        // [ASSUMED] a bombing whose target has died lands where it last stood; her 视野遮挡 rule is not modelled.
        const hr = num(t0.hp_ratio), prob = num(t0.prob), sc = num(t0.aoe_atk_scale, num(t0.damage_scale));
        const rounds = new Map(); // consumer → { t, target, n, amount }
        const bomb = (r) => {
          if (!live(unit)) return;
          const t = r.target;
          if (t.alive) { r.x = t.x; r.y = t.y; }
          battle.fx('airstrike', { x: r.x, y: r.y, id: unit.id, r: BOMB_RADIUS, talent: true });
          for (const e of battle.foesInRadius(r.x, r.y, BOMB_RADIUS, true)) { // splash around the target: 中点判定
            if (e.alive && !e.s.flags.untargetable) battle.dealDamage(unit, e, { amount: r.amount, type: 'phys', isSkill: true, isSplash: true, tags: ['talent', 'airstrike'] });
          }
        };
        battle.on('ammoUsed', ({ unit: u }) => {
          if (!live(unit) || !u || u.side !== 'ally') return;
          if (hr > 0) battle.heal(unit, unit, unit.s.maxHp * hr, { self: true, silent: true });
          if (!(prob > 0) || !(sc > 0) || battle.rng() >= prob) return;
          let r = rounds.get(u);
          if (!r || r.t !== battle.time) {
            const cands = battle.enemiesInKeys(absoluteRangeKeys(u.rangeGrid || [[0, 0]], u.tileR, u.tileC, u.dir, 0), unit, ANY);
            if (!cands.length) { rounds.delete(u); return; }
            sortEnemyTargets(battle, unit, cands, null);
            r = { t: battle.time, target: cands[0], x: cands[0].x, y: cands[0].y, n: 0, amount: unit.s.atk * sc };
            rounds.set(u, r);
          }
          const k = r.n++;
          if (k === 0) bomb(r);
          else battle.after(k * BOMB_GAP, () => bomb(r), { owner: unit });
        }, { owner: unit });
      } },
      { install(battle, unit) { // 铳弹协约
        const atk = num(t1.atk), mult = num(t1.mult, 1);
        if (atk) aura(battle, unit, 0.5, () => {
          for (const a of battle.allyUnits) {
            if (!live(a) || a.kind !== 'op' || !a.skill || a.skill.kind !== 'ammo') continue;
            battle.addBuff(a, { key: 'angel2:covenant', mods: { atkPct: atk * (hasBond(a, 'lateranoShip') ? mult : 1) }, duration: 0.75, refresh: 'replace' });
          }
        });
      } },
      { install(battle, unit) { // elite module: HP > 80 % ⇒ SP +0.25/s
        const thr = bv(tb, 'hp_ratio', 0), spr = bv(tb, 'sp_recovery_per_sec', 0);
        if (spr > 0 && tb['angel2_tr[e].hp_ratio'] != null) aura(battle, unit, 0.25, () => {
          if (unit.hpRatio > num(tb['angel2_tr[e].hp_ratio'], thr)) battle.addBuff(unit, { key: 'angel2:calm', mods: { spRecoveryFlat: spr }, duration: 0.4, refresh: 'replace' });
        });
      } },
    ],
  };
}

export default {
  chess_char_6_13_a: angel2,
};
