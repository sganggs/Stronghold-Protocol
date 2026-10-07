// server/sim/content/kits/ops/chess_char_5_12-dusk.js — 夕 (char_2015_dusk) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { sortEnemyTargets } from '../../../targeting.js';
import {
  HALF_HP, num, on, talent, talentRec, batPct, mods, selectedId, lazySkills, skillRange, moduleRangeUp,
} from '../shared/tier5.js';

/** 夕 S1 "下一次攻击溅射范围扩大" — expanded splash radius (tiles; the splash-caster default is 1.1). PRTS: "溅射半径扩大至1.7". */
const DUSK_SPLASH_RADIUS = 1.7;
/** 夕 S3 "攻击范围与溅射范围扩大" — PRTS S3 备注: "溅射半径扩大至1.7", the same as S1. */
const DUSK_S3_SPLASH = DUSK_SPLASH_RADIUS;

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 夕 — S1 工笔入化 (2 charges): next attack 180 % ATK with an expanded splash. T1 化境: a kill by 夕 or 小自在 → ATK +2 %
  // (×15). T2 点睛: first attack after deploying summons 小自在 (25 s) on the target's tile (deployable ground).
  // Module (elite): 攻击范围扩大.
  // S2 泼墨淋漓 (duration): skill range, ATK +, ASPD +, hits every enemy in range (one hit each: no splash on top);
  // arts damage ×damage_scale on enemies below hp_ratio. S3 写意胜形 (duration): skill range, BAT +0.4 s, prefers
  // unblocked enemies, splash 1.7, ATK +; every attack summons 小自在 on the target's tile (deployable ground) or moves /
  // refreshes the one already out (deployLimit 1: "召唤/刷新一个"), 25 s (the 点睛 token duration).
  chess_char_5_12_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1);
    const sid = selectedId(chess, def);
    const tokenId = talentRec(chess, 1)?.tokenKey ?? (chess?.tokens || [])[0] ?? 'token_10015_dusk_drgn';
    const tokenDur = num(t1['attack@tokenduration'], 25);
    const freeGround = (battle, r, c) => battle.grid.inRect(r, c) && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c);
    // 小自在 expiry follows tk.mem.duskUntil (a refresh pushes it back)
    const expire = (battle, tk) => {
      if (!tk.alive) return;
      const left = num(tk.mem.duskUntil) - battle.time;
      if (left > 1e-6) battle.after(left, () => expire(battle, tk), { owner: tk });
      else battle.retreat(tk, { reason: 'expired', permanent: true });
    };
    /** Summon 小自在 on (r, c), or move / refresh hers when one is out. */
    const summon = (battle, unit, r, c) => {
      const mine = battle.allyUnits.find((x) => x.kind === 'token' && x.ownerUnit === unit && x.defId === tokenId && x.alive && x.deployed);
      if (mine) {
        if (mine.tileR !== r || mine.tileC !== c) {
          const fromX = mine.x, fromY = mine.y;
          if (!freeGround(battle, r, c) || !battle.relocate(mine, r, c)) return null;
          battle.fx('teleport', { x: mine.x, y: mine.y, id: mine.id, fromX, fromY });
        }
        mine.mem.duskUntil = battle.time + tokenDur;
        return mine;
      }
      if (!freeGround(battle, r, c)) return null;
      const tk = battle.spawnToken(unit, tokenId, r, c);
      if (!tk) return null;
      tk.mem.duskUntil = battle.time + tokenDur;
      battle.after(tokenDur, () => expire(battle, tk), { owner: tk });
      battle.fx('summon', { x: tk.x, y: tk.y, id: tk.id, token: tokenId });
      return tk;
    };
    return {
      skills: lazySkills({
        skchr_dusk_2: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk), aspd: num(bb.attack_speed) }),
          targeting: skillRange(chess, def, { allInRange: true }),
          attack: { splashRadius: 0 },
        }),
        skchr_dusk_3: () => ({
          kind: 'duration', mods: mods({ atkPct: num(bb.atk), batPct: batPct(bb.base_attack_time, chess) }),
          targeting: skillRange(chess, def),
          attack: { splashRadius: DUSK_S3_SPLASH },
        }),
      }),
      skill: { kind: 'charges', attack: { atkScale: num(bb.atk_scale, 1), splashRadius: DUSK_SPLASH_RADIUS } },
      talents: [
        { install(battle, unit) { // 化境
          battle.on('kill', (c) => {
            const k = c.killer;
            if (!k || c.victim.side !== 'enemy' || !(k === unit || (k.kind === 'token' && k.ownerUnit === unit)) || !on(unit)) return;
            battle.addBuff(unit, { key: 'dusk:realm', refresh: 'stack', maxStacks: Math.max(1, num(t0.max_stack_cnt, 15)), mods: { atkPct: num(t0.atk) } });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 点睛
          battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.duskSummoned = false; }, { owner: unit });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || unit.mem.duskSummoned) return;
            const t = c.targets.find((x) => x.side === 'enemy');
            if (!t) return;
            unit.mem.duskSummoned = true;
            // "在目标位置（可部署地面）召唤": only on the target's own tile when it is free deployable ground — PRTS 备注:
            // otherwise nothing is summoned, and the talent is spent for this deployment either way
            summon(battle, unit, Math.round(t.y), Math.round(t.x));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        moduleRangeUp(battle, unit, chess);
        if (sid === 'skchr_dusk_2') {
          const cut = num(bb.hp_ratio, HALF_HP), mul = num(bb.damage_scale, 1);
          battle.on('hit', (c) => {
            if (c.source !== unit || !unit.skill?.active || c.dmg.type !== 'arts' || !c.target || c.target.side !== 'enemy') return;
            if (c.target.hpRatio < cut) c.dmg.mul *= mul;
          }, { owner: unit });
        }
        if (sid === 'skchr_dusk_3') {
          // 优先攻击未阻挡的敌人
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active || !c.targets.length || !c.targets[0].blockedBy) return;
            const list = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
            sortEnemyTargets(battle, unit, list, null);
            const alt = list.find((e) => !e.blockedBy);
            if (alt) c.targets = [alt, ...c.targets.slice(1).filter((x) => x !== alt)];
          }, { owner: unit, priority: 10 });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || !unit.skill?.active) return;
            const t = c.targets.find((x) => x.side === 'enemy');
            if (t) summon(battle, unit, Math.round(t.y), Math.round(t.x));
          }, { owner: unit });
        }
      },
    };
  },
};
