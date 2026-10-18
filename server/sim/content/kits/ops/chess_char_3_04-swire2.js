// server/sim/content/kits/ops/chess_char_3_04-swire2.js — 琳琅诗怀雅 (char_1033_swire2) kit, tier 3.
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { bodyOnTile } from '../../../body.js';
import {
  num, defOf, talentBb, moduleTalentBb, selectedId, altSkills, alive, gridKeys, fx, textNum, freeTile,
  groundTile, enemiesOn,
} from '../shared/tier3.js';
import { powi } from '../../../detmath.js';
import { champagneHold, CHAMPAGNE_TRIGGER } from '../../tokens.js';
import { canTargetEnemy } from '../../../targeting.js';

/**
 * 琳琅诗怀雅 S2 “见面礼”'s placement range: range_table "x-6" — her tile and the two tiles beyond it in each of the four
 * directions (symmetric: her facing does not matter). PRTS 备注 "香槟炸弹放置范围：x-6"; the client charpack (char_1033_swire2,
 * mode S2) gives its SpawnToken selector `_rangeId` "x-6". The skill's own rangeId (1-1) is her attack range, not this.
 */
const SWIRE2_BOMB_GRID = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);

/** Merchant trait with a callback on every successful DP payment (琳琅诗怀雅 大买家). Same rules as professions.js. */
function merchantInstall(onPay) {
  return (battle, unit) => {
    const iv = unit.profile.merchantInterval ?? 3;
    const cost = unit.profile.merchantCost ?? 3;
    battle.every(iv, () => {
      if (!alive(unit)) return;
      const pl = battle.getPlayer(unit.ownerId);
      if (!pl) return;
      if (pl.dp >= cost) {
        battle.addDp(unit.ownerId, -cost);
        onPay(battle, unit, cost);
        battle.emit('merchantPay', { unit, cost });
      } else battle.retreat(unit, { reason: 'merchant' });
    }, { owner: unit });
  };
}

export default {
  // ---- 3_04 琳琅诗怀雅 · 行商 — S2 “见面礼” (passive): with a coin and a free tile of range x-6 her attack's turn
  //      throws a champagne bomb instead (onto an enemy's tile when one stands there; installS2);
  //      大买家: coin at skill start + coin & ATK stack per trait payment; 破财消灾: DP-paid revive (cost doubles)
  //      S1 仗义疏财 (passive, 2 coins): a coin heals the most injured ally (< 70 % HP) of the 3×3 around her — herself
  //      included — for attack@heal_scale × ATK — on her attack, or with no enemy to attack on her own attack timer (owner's decision
  //      2026-10-04, against the official 「下一次攻击会为…」; installS1). S3 千金一掷 (持续时间无限): attacks hit twice, kills give a coin;
  //      stays open until she leaves the field, keeping its coins (cap bb.sp = 10). PRTS 卫戍协议/帮助 技能操作
  //      https://prts.wiki/w/卫戍协议/帮助: 「通常不会自动关闭技能」; skill_table skchr_swire2_3 spends coins only on
  //      「主动关闭」, which this mode never performs. Maintainer 2026-10-17 withdrew the 2026-10-04 cap-triggered close.
  //      精锐 module MER-Y: ATK +4 % per trait payment (≤ 5 stacks).
  chess_char_3_04_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const sel = selectedId(chess, d);
    const S1 = 'skchr_swire2_1', S2 = 'skchr_swire2_2', S3 = 'skchr_swire2_3';
    // "携带此技能时金币上限为N": the SELECTED skill's cap
    const coinMax = num(bb.sp, 3);
    const coinCost = Math.abs(num(bb['attack@sp'], -1)) || 1;
    const modTal = moduleTalentBb(chess);
    const scale = num(bb.atk_scale, 1);
    const slug = num(bb.sluggish, 2);
    const tokenId = chess?.skill?.overrideTokenKey ?? (d.tokens || []).find((t) => /gdtrap/.test(String(t))) ?? 'token_10031_swire2_gdtrap';
    const addCoins = (battle, unit, n) => {
      const before = unit.mem.coins ?? 0;
      unit.mem.coins = Math.min(coinMax, before + n);
      if (unit.mem.coins > before) fx(battle, 'coin', unit, { n: unit.mem.coins });
    };
    const bombKit = (owner, switchT) => ({
      skill: null,
      trait: { noAttack: true },
      install(battle, bomb) {
        champagneHold(battle, bomb);   // 禁疗, no HP loss, never gone because of its HP (the owner's decision D2 of 2026-10-08)
        battle.on('tick', () => {
          if (!bomb.alive || !bomb.deployed) return;
          for (const e of battle.enemies) {
            // a ground enemy it may select — no 隐匿 one that is neither revealed nor blocked (tokens.js CHAMPAGNE_TRIGGER)
            if (!canTargetEnemy(bomb, e, CHAMPAGNE_TRIGGER)) continue;
            if (!bodyOnTile(e, bomb.tileR, bomb.tileC)) continue;
            // first enemy touching it; after switchT s on the field the bomb deals its damage one extra time
            const hits = battle.time - bomb.deployedAt >= switchT - 1e-9 ? 2 : 1;
            for (let i = 0; i < hits && e.alive; i++) {
              battle.dealDamage(owner, e, { amount: owner.s.atk * scale, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'trap'] });
            }
            if (e.alive) battle.applyStatus(e, 'sluggish', { duration: slug, source: owner });
            // `consumed`: the bomb is used up by its own blast — clients play its impact sound, not a death sound
            fx(battle, 'explode', bomb, { src: owner.id, target: e.id, hits, consumed: true });
            battle.retreat(bomb, { reason: 'expired', permanent: true });
            break;
          }
        }, { owner: bomb });
      },
    });
    const healRatio = textNum(d.skill?.description, /血量不足(\d+)%/, 70) / 100;
    /**
     * 仗义疏财 — official text 「消耗一枚金币，下一次攻击会为周围八格内血量不足70%的一名友方单位恢复相当于攻击力40%的生命」: the heal rides on an
     * attack, so with no enemy around she never healed (community report #5 「琳琅诗怀雅1技能不会主动奶身边受伤的干员」). Owner's
     * decision 2026-10-04 (a deliberate deviation, like §21.29's 重装 casts): she heals an injured ally beside her whether
     * she attacks or not. Same target (the lowest HP ratio below 70 % of the 3×3 around her, no 禁疗 / 孤立 unit, no
     * device), coin and heal_scale × ATK. Cadence [ASSUMED]: at most one heal per attack cycle (her attack interval, ASPD
     * included) — while she attacks, on the attack as before; when her last attack attempt found no target, on her own
     * timer (the 'tick' hook runs after the attacks, so an attack due in the same tick takes it).
     * 「周围八格」 includes herself: the client charpack (char_1033_swire2, mode S1, ability HealAlly) selects with range
     * x-4 — the 3×3 with her own tile — ally side, `_excludeOwner` 0, max HP ratio 0.7, one target. Until 0.2.0 she was
     * left out and never healed herself (community report of 2026-10-06 「琳琅诗怀雅不会治疗自己」).
     */
    const installS1 = (battle, unit) => {
      const hs = num(bb['attack@heal_scale'], num(bb.heal_scale, 0));
      let nextAt = -Infinity;
      const healTarget = () => {
        let best = null;
        for (const a of battle.allyUnits) {
          if (!alive(a) || a.hidden || a.kind === 'device' || a.hpRatio >= healRatio) continue;
          if (a !== unit && (a.s.flags.noHeal || a.profile?.noHeal)) continue; // 禁疗 / 孤立: never a heal target
          if (a === unit && a.s.flags.healFree) continue; // her own 禁疗 (HEAL_FREE) stops a heal of herself too
          if (Math.max(Math.abs(a.tileR - unit.tileR), Math.abs(a.tileC - unit.tileC)) > 1) continue; // x-4: the 3×3, her tile too
          if (!best || a.hpRatio < best.hpRatio || (a.hpRatio === best.hpRatio && a.deploySeq < best.deploySeq)) best = a;
        }
        return best;
      };
      const tryHeal = () => {
        if (!alive(unit) || (unit.mem.coins ?? 0) < coinCost || !(hs > 0) || battle.time < nextAt - 1e-9) return;
        const best = healTarget();
        if (!best) return;
        unit.mem.coins -= coinCost;
        nextAt = battle.time + unit.s.interval;
        battle.heal(unit, best, unit.s.atk * hs);
        fx(battle, 'coin', unit, { n: unit.mem.coins, heal: best.id, skill: 'swire2_1' });
      };
      battle.on('attack', (ctx) => { if (ctx.attacker === unit) tryHeal(); }, { owner: unit, priority: -10 });
      battle.on('tick', () => { if (unit.deployed && unit.canAct && !unit.trait?.hadTarget) tryHeal(); }, { owner: unit });
    };
    /**
     * “见面礼” — 「消耗一枚金币在范围内一个可放置且可通行的地面放置香槟炸弹」. The client charpack (char_1033_swire2, mode S2)
     * makes her attack a priority composite: first the SpawnToken ability (animation Skill_2) whose trigger needs BOTH a
     * tile of its selector (range x-6; melee-buildable, walkable, low ground — the tile options of the selector) and her
     * coin buff (swire2_can_use_gold), else her normal attack (which needs a target). So a bomb takes her attack's turn,
     * enemies or not: with no enemy around she still spends her coins on the free tiles of x-6 (PRTS 备注 「否则随机放置香槟
     * 至可部署的地块」), and only a full x-6 (or no coin) lets her coins pile up to the cap. Tile (PRTS 备注 「放置香槟动画进行
     * 前若放置范围内存在敌人，则按攻击索敌规律放置香槟至其所在地块」; the selector's `_targetMotion` WALK): the ground enemies
     * standing on a free tile of x-6, in her attack's target order (blocked first, …, nearest the goal) — the first one's
     * tile; with none, a random free tile of x-6. A free tile: inside the field, nobody on it, no knocked-out operator's
     * tile (freeTile; an enemy on it does not count), walkable ground a melee unit may stand on (groundTile).
     * [ASSUMED] timing: the throw is instant and costs her attack one tick (PRTS 备注 「每次放置香槟时若正在攻击敌人，会短暂
     * 延长攻击抬手间隔」 — the composite clears its cooldown when the throw ends; the length of the Skill_2 animation is in
     * no table): `canAttack` holds her attack back while a throw is due and the 'tick' hook (after the attacks) throws
     * when her attack is ready. Until 0.2.0 every attack also dropped a bomb on her 1-1 range, at random.
     */
    const bombTiles = (battle, unit) => {
      const out = [];
      for (const k of gridKeys(SWIRE2_BOMB_GRID, unit)) {
        const r = (k / COLS) | 0, c = k % COLS;
        if (freeTile(battle, r, c) && groundTile(battle, r, c)) out.push(k);
      }
      return out;
    };
    // (`bombHold`: a refused spawn — a tile freeTile let through — never holds her attack back for longer than one cycle)
    const hasCoin = (battle, unit) => (unit.mem.coins ?? 0) >= coinCost && !(battle.time < (unit.mem.bombHold ?? -1));
    const throwDue = (battle, unit) => hasCoin(battle, unit) && bombTiles(battle, unit).length > 0;
    const installS2 = (battle, unit) => {
      const switchT = num(battle.tokenDef(tokenId, unit)?.skill?.bb?.duration_switch, 3);
      const ground = { ...unit.profile, canHitFly: false };
      battle.on('tick', () => {
        if (!alive(unit) || !unit.canAct || unit.atkCd > 1e-9 || unit.s.flags.disarm || !hasCoin(battle, unit)) return;
        const keys = bombTiles(battle, unit);
        if (!keys.length) return;
        const free = new Set(keys);
        let key = null;
        for (const e of enemiesOn(battle, unit, keys, 0, ground)) {
          const k = Math.round(e.y) * COLS + Math.round(e.x);
          if (!e.isFlying && free.has(k)) { key = k; break; }
        }
        if (key == null) key = battle.rng.pick(keys);
        const bomb = battle.spawnToken(unit, tokenId, (key / COLS) | 0, key % COLS, { untargetable: true, kit: bombKit(unit, switchT) });
        if (!bomb) { unit.mem.bombHold = battle.time + unit.s.interval; return; }
        unit.mem.coins -= coinCost;
        fx(battle, 'summon', bomb, { src: unit.id, token: tokenId, coins: unit.mem.coins });
      }, { owner: unit });
    };
    const installS3 = (battle, unit) => { // 千金一掷: "击倒敌人时获得一枚金币"
      battle.on('kill', (ctx) => {
        if (ctx.killer === unit && ctx.victim.side === 'enemy' && unit.skill?.active) addCoins(battle, unit, 1);
      }, { owner: unit });
    };
    return {
      skill: { kind: 'passive' },
      skills: altSkills(chess, d, bb, {
        [S1]: () => ({ kind: 'passive' }), // (coins → heals: installS1)
        // Official 卫戍协议 never closes this toggle: no coin burst, push or coin spending on end/retreat.
        [S3]: () => ({ kind: 'toggle', attack: { hits: 2 } }),
      }),
      trait: {
        // S2: a throw due takes her attack's turn (installS2)
        ...(sel === S2 || sel == null ? { canAttack: (battle, unit) => !throwDue(battle, unit) } : {}),
        install: merchantInstall((battle, unit) => {
          // MER-Y "每次特性消耗费用时攻击力+4%，最多可以叠加5次" (any time, not only during the skill)
          if (modTal && num(modTal.atk) > 0) {
            battle.addBuff(unit, { key: 'trait:swire2_module', refresh: 'stack', stacks: 1, maxStacks: Math.max(1, num(modTal.max_stack_cnt, 5)), mods: { atkPct: num(modTal.atk) } });
          }
          if (!unit.skill?.active) return; // "技能期间"
          addCoins(battle, unit, num(t0.trait_sp, 1));
          battle.addBuff(unit, { key: 'talent:swire2_buyer', refresh: 'stack', stacks: 1, maxStacks: Math.max(1, num(t0.max_stack_cnt, 8)), mods: { atkPct: num(t0.atk) } });
        }),
      },
      install(battle, unit) {
        if (sel === S1) { installS1(battle, unit); return; }
        if (sel === S3) { installS3(battle, unit); return; }
        if (sel !== S2 && sel != null) return;
        installS2(battle, unit);
      },
      talents: [
        { install(battle, unit) { // 大买家: "开启技能时获得1枚金币" (a passive starts at every deployment, S3 when cast)
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            unit.mem.coins = 0;
            if (unit.skill?.kind === 'passive') addCoins(battle, unit, num(t0.sp, 1));
          }, { owner: unit });
          battle.on('skillStart', (ctx) => { if (ctx.unit === unit && unit.skill?.kind !== 'passive') addCoins(battle, unit, num(t0.sp, 1)); }, { owner: unit });
        } },
        { install(battle, unit) { // 破财消灾
          // the doubling cost restarts at 5 with every deployment: PRTS 备注 「再部署时重置本天赋费用消耗」 — the client buff
          // swire2_t_2 keeps the doubled `cost` in its own blackboard, built anew when she is deployed (a battle start, 联防
          // included — a new battle —, a redeploy, a 突袭 再部署). Until 0.2.0 a redeploy kept the doubled cost (community
          // report of 2026-10-06 「正常对局中死亡之后再部署复活费用也应该重置」)
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.mem.saveCount = 0; }, { owner: unit });
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented) return;
            const n = unit.mem.saveCount ?? 0;
            const cost = Math.abs(num(t1.cost, -5)) * powi(num(t1.cost_multi, 2), n);
            const pl = battle.getPlayer(unit.ownerId);
            if (!pl || pl.dp + 1e-9 < cost) return;
            battle.addDp(unit.ownerId, -cost);
            unit.mem.saveCount = n + 1;
            ctx.prevented = true;
            unit.hp = Math.max(1, unit.s.maxHp * num(t1.hp_ratio, 0.7));
            fx(battle, 'revive', unit, { cost });
          }, { owner: unit });
        } },
      ],
    };
  },
};
