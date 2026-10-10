// server/sim/content/kits/ops/chess_char_5_05-ulpia.js — 乌尔比安 (char_4145_ulpia) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.

import { COLS } from '../../../constants.js';
import { frontOf } from '../../../dir.js';
import { isHpLoss } from '../../../damage.js';
import {
  RING1, num, on, inRange, talent, traitBb, skillGrid, mods, dist, isAbyssal, isOp, selectedId, lazySkills, instantKind,
  permBuff, enemiesInGrid,
} from '../shared/tier5.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 乌尔比安 — S3 必须开辟的通路 (25 s, CUSTOM_RANGE row ahead): max HP/ATK +, throws an anchor forward that stops on the
  // first enemy or at max distance — on his own tile while he blocks: 135 % ATK phys + 6 s stun around it
  // (projectile_range); moves onto the anchor tile when deployable (a tile of his own board) and not his own (a 从不混淆的方向
  // marker keeps his tile)
  // and returns at skill end — both 【移动】, i.e. free redeploys (Battle.moveRedeploy; the return empties his SP).
  // Knocked out while moved, he lies and redeploys on his deployment tile (Unit.downAtHome — the owner's decision of
  // 2026-10-07, a deliberate deviation from PRTS's "where it fell", DESIGN §25.17.3).
  // T1 本性的坚守: heal 100 (160 below 50 %) on every hit taken. T2 血脉的哺养: per kill +120 max HP / +30 ATK (×9),
  // other Abyssal Hunters +50 %. Module (elite): healing received ×1.2.
  // S1 必须促成的接触 (instant): the anchor lands on the best enemy of the skill range (beyond his own range, unblocked
  // first) and drags up to max_target enemies around it (RING1) in front of him (中等力度), atk_scale × ATK phys each;
  // a 捕网 — ground enemies only ([ASSUMED] like 雪雉's "不对空" net). S3's anchor blast has no such note: it hits air
  // units too [ASSUMED].
  // S2 必须维系的界限 (toggle, 持续时间无限): T1 ×talent_scale, block +1, max HP +, ATK +.
  chess_char_5_05_a: (bb, chess, def) => {
    const t0 = talent(chess, 0), t1 = talent(chess, 1), tb = traitBb(chess);
    const sid = selectedId(chess, def);
    const t0Scale = sid === 'skchr_ulpia_2' ? num(bb.talent_scale, 1) : 1;
    const tokenId = chess?.skill?.overrideTokenKey ?? def?.skill?.raw?.overrideTokenKey ?? 'token_10039_ulpia_block';
    const trig = def?.skill?.trigger?.grid ?? chess?.skill?.trigger?.customRangeGrid ?? [[0, 1], [0, 2], [0, 3], [0, 4], [0, 5], [0, 6]];
    const reach = Math.max(1, ...trig.filter((p) => p[0] === 0).map((p) => p[1]));
    const radius = num(bb.projectile_range, 1.5);
    return {
      skills: lazySkills({
        skchr_ulpia_1: () => ({
          kind: instantKind(chess, def),
          onStart({ battle, unit }) {
            // "向前方扔出船锚": the anchor goes beyond his own reach first (pulling what he already hits is moot), then
            // unblocked ground enemies, then the usual target order
            const list = enemiesInGrid(battle, unit, skillGrid(chess, def) ?? unit.rangeGrid);
            const reach = (e) => inRange(unit, e);
            // the anchor is a 捕网 (PRTS 备注 "实际效果为捕网而非拖拽"); 雪雉's 捕网 is "不对空" (PRTS 雪雉 备注) — [ASSUMED] the same
            // for this one: it never lands on or catches air units (FLY, 近地悬浮, 浮空)
            const main = list.find((e) => !reach(e) && !e.blockedBy && !e.isFlying) ?? list.find((e) => !e.blockedBy && !e.isFlying) ?? list.find((e) => !e.isFlying);
            if (!main) return;
            const near = battle.foesInRadius(main.x, main.y, RING1).filter((e) => !e.isFlying && !e.s.flags.untargetable && !e.s.flags.sleep)
              .sort((a, b) => (a === main ? -1 : b === main ? 1 : 0) || dist(a, main) - dist(b, main) || a.spawnSeq - b.spawnSeq)
              .slice(0, Math.max(1, num(bb.max_target, 2)));
            const force = num(bb.force, 1);
            battle.fx('anchor', { x: main.x, y: main.y, id: unit.id, fromX: unit.x, fromY: unit.y, r: RING1 });
            for (const e of near) {
              // "中等力度地拖拽至面前": the 捕网's pull uses the 拖拽 rules (PRTS 推与拉 §捕网 "力的大小：同拖拽") —
              // Battle.pullToFront, the official 力度 − 重量 pull
              battle.pullToFront(e, unit, force);
              if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'anchorPull'] });
            }
          },
        }),
        skchr_ulpia_2: () => ({
          kind: 'toggle',
          mods: mods({ atkPct: num(bb.atk), hpPct: num(bb.max_hp), blockCnt: num(bb.block_cnt) }),
        }),
      }),
      skill: {
        kind: 'duration',
        mods: mods({ hpPct: num(bb.max_hp), atkPct: num(bb.atk) }),
        onStart({ battle, unit }) {
          // PRTS 备注 ② — the anchor's target: his own tile while he blocks an enemy (e.g. just after a 突袭 landing),
          // else the nearest tile ahead in the skill range (straight along his direction) with an enemy on it, else the
          // farthest one. His own tile is a candidate only while he blocks ("自身所在地块（仅阻挡敌人时）"); not taken: the
          // reading of the range's own tile (6-1 starts at [0,0]) as distance 0 for the second rule (a flyer over him)
          let stop = 0;
          if (!unit.blocking.some((e) => e.alive && e.blockedBy === unit)) {
            for (let d = 1; d <= reach; d++) {
              const [r, c] = frontOf(unit.tileR, unit.tileC, unit.dir, d);
              // the anchor stops at the field edge and in front of a ground obstacle (crates, roadblocks)
              if (!battle.grid.inRect(r, c) || battle.grid.isObstacle(r, c)) break;
              stop = d;
              if (battle.enemiesInKeys([r * COLS + c], unit, { canHitFly: true }).length) break;
            }
          }
          const [sr, sc] = frontOf(unit.tileR, unit.tileC, unit.dir, stop);
          const fromX = unit.x, fromY = unit.y;
          battle.fx('anchor', { x: sc, y: sr, id: unit.id, fromX, fromY, r: radius });
          for (const e of battle.foesInRadius(sc, sr, radius)) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'anchor'] });
            if (e.alive) battle.applyStatus(e, 'stun', { duration: num(bb.stun), source: unit });
          }
          // ③ 【移动】 — only a change of tile moves him and leaves the 从不混淆的方向 ("若目标地块不为当前地块，会在原地部署"): an
          // anchor on his own tile leaves him where he stands, no marker, nothing to return from [ASSUMED: the "tile one
          // beyond the landing" is not tried when the landing is his own tile]
          if (stop === 0 || !unit.alive) return;
          // PRTS 备注: landing tile > the tile one beyond it > his own tile (a deployable, free, unreserved melee tile).
          // "可部署" is a tile his player may deploy on: his own board (Battle.onOwnBoard) — never the other half of a 联防 or
          // boss field nor a boss field's hand / 临时整备区 rows; a teammate's half stays closed to him even where the 突袭
          // landing may take it (Battle.onFieldBoard, DESIGN §26.1). Community report of 2026-10-06 (item 27) 「乌尔比安使用3技能会在
          // 联防阶段跳到红门后」: in a one-helper 联防 (escaped_single's enemies come out of the middle gate at col 10) an anchor
          // that met no enemy flew on to the right half, where no enemy ever walks, and he moved there for the whole skill
          const ok = ([r, c]) => (r !== unit.tileR || c !== unit.tileC) && battle.grid.inRect(r, c) && battle.onOwnBoard(unit.player, r, c) && battle.grid.canStand(r, c) && !battle.grid.isObstacle(r, c) && !battle.isReservedTile(r, c);
          const dest = [[sr, sc], frontOf(unit.tileR, unit.tileC, unit.dir, stop + 1)].find(ok);
          if (dest == null) return;
          const home = [unit.tileR, unit.tileC];
          // the 【移动】 is a redeploy on the new tile (Battle.moveRedeploy: a new deployment, deploy effects fire again,
          // no exit) that keeps the running skill — "【移动】后仅继承下列效果：技能进度、第二天赋叠加层数"; the rest of
          // his buffs are kept too (owner's deviation, DESIGN §22.3). The marker is deployed after the move (备注 ③)
          if (!battle.moveRedeploy(unit, dest[0], dest[1]) || !unit.alive || !unit.skill?.active) return;
          // knocked out while moved, he lies and redeploys on his deployment tile (Battle._layBody) — the owner's decision
          // of 2026-10-07 (community report 28 「乌尔比安3技能期间死亡…应回到初始部署位复活」), a deliberate deviation from
          // PRTS's "where it fell" (帮助 「原地留下一个“倒地干员”」), for this 【移动】 only; the return or his next
          // deployment clears it
          unit.downAtHome = true;
          const marker = battle.spawnToken(unit, tokenId, home[0], home[1], { untargetable: true, kit: { skill: null, trait: { noAttack: true } } });
          unit.mem.anchorHome = { r: home[0], c: home[1], marker };
          battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
        },
        onEnd({ battle, unit }) {
          const h = unit.mem.anchorHome;
          unit.mem.anchorHome = null;
          // the skill over with him standing: no longer moved by it (knocked out, the flag stays for Battle._layBody)
          if (unit.alive) unit.downAtHome = false;
          if (!h) return;
          if (h.marker && h.marker.alive) battle.retreat(h.marker, { reason: 'expired', permanent: true });
          if (unit.alive && unit.deployed) {
            // ④ 【返回】: a 【移动】 back to his tile "【返回】时将清空技力，但仍可以享受后续由其他效果提供的技力" — the SP is
            // emptied before the deploy effects of the return run (迅捷作战粮, 黄沙罗盘 … still give theirs, so do skillEnd
            // effects after it: 迅捷). Here in onEnd the skill's mods are still on (skills.js end) [ASSUMED: officially the
            // return comes "技能结束后"; none of the deploy effects that can reach him reads his stats]
            const fromX = unit.x, fromY = unit.y;
            if (battle.moveRedeploy(unit, h.r, h.c, { clearSp: true })) battle.fx('teleport', { x: unit.x, y: unit.y, id: unit.id, fromX, fromY });
          }
        },
      },
      talents: [
        { install(battle, unit) { // 本性的坚守
          battle.on('damaged', (c) => {
            if (c.target !== unit || !on(unit) || unit.hp <= 0 || !(c.amount > 0) || c.type === 'element' || isHpLoss(c.dmg)) return; // (not a 流失)
            const v = (unit.hpRatio < num(t0.hp_ratio, 0.5) ? num(t0.value2) : num(t0.value1)) * (unit.skill?.active ? t0Scale : 1);
            if (v > 0) battle.heal(unit, unit, v, { self: true });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 血脉的哺养
          battle.on('kill', (c) => {
            // CRU-Y stages 2/3: kills credited to any 深海猎人 count while Ulpianus is on the field.
            const hunterKill = num(t1.add_block_cnt_stack_cnt) > 0 && isOp(c.killer) && isAbyssal(c.killer);
            if ((c.killer !== unit && !hunterKill) || c.victim.side !== 'enemy' || !on(unit)) return;
            battle.addBuff(unit, { key: 'ulpia:blood', refresh: 'stack', maxStacks: Math.max(1, num(t1.max_stack_cnt, 9)), mods: mods({ hpFlat: num(t1.max_hp), atkFlat: num(t1.atk) }) });
            const threshold = num(t1.add_block_cnt_stack_cnt);
            if (threshold > 0 && unit.findBuff('ulpia:blood')?.stacks >= threshold) {
              battle.addBuff(unit, { key: 'ulpia:bloodBlock', mods: { blockCnt: num(t1.block_cnt) }, tags: ['talent'] });
            }
            const share = mods({ hpFlat: num(t1['ulpia_t_1[abyssal].max_hp']), atkFlat: num(t1['ulpia_t_1[abyssal].atk']) });
            if (!Object.keys(share).length) return;
            for (const a of battle.allies()) {
              if (a !== unit && isOp(a) && isAbyssal(a)) battle.addBuff(a, { key: 'ulpia:bloodShare', refresh: 'stack', maxStacks: Math.max(1, num(t1['ulpia_t_1[abyssal].max_stack_cnt'], 9)), mods: share });
            }
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // CRU-Y: all his damage against a blocked enemy is scaled, including anchor hits.
        const blockedScale = num(tb.damage_scale, 1);
        if (blockedScale !== 1) battle.on('hit', (c) => {
          if (c.source === unit && c.target?.side === 'enemy' && c.target.blockedBy) c.dmg.mul *= blockedScale;
        }, { owner: unit });
        if (num(tb.heal_scale) > 0) permBuff(battle, unit, 'ulpia:module', { healingTakenMul: num(tb.heal_scale) });
      },
    };
  },
};
