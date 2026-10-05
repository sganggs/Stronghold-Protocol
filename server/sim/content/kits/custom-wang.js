// server/sim/content/kits/custom-wang.js — 望 (char_2027_wang, SPECIAL / 陷阱师 traper) for the DIY catalog.
//
// Talent 1 铸子: 6 stones (7 held at once), stones link when they sit together, an enemy entering a stone's tile
//   triggers it; a MANUAL placement drops one extra stone next to it (up to 9). The remake has no mid-battle placement:
//   casting a stone skill auto-places its stones on free tiles of her range, drawn toward live enemies — [ASSUMED] the
//   extra stone of a manual deployment is not modelled (auto-placement stands in for the operation).
// Talent 2 料敌机先: every stone on the triggered stone's straight line gives +10% damage and 9 flat RES ignore (max 3).
//   The engine has no stone graph, so "相连的连续直线" is approximated by "other LIVING stones sharing the row or the
//   column" and every stone triggers on its own (no link required to activate). [ASSUMED]
// Stones: token_10064_wang_stone1 with an inline def (data/tokens.json holds no 望 variant) + a stone kit: it waits for
//   an ALIVE enemy on its tile (every 0.1 s), runs the SELECTED skill's trigger effect, then expires itself.
// Skills (E2 / Lv7 blackboards): S1 取势 — 2 stones; trigger: 停顿 + 120% ATK arts per second for 6.5 s. S2 连星 —
//   2 stones; trigger: 480% ATK arts to enemies within 3 tiles along the triggered stone's line + 40% move slow 6 s.
//   S3 天下劫 (MANUAL) — 8 stones, stops attacking, range expanded to the skill's own grid, 20 ammo (one per stone
//   deployed: the field is topped up while the skill runs), ends when the ammo or the stones run out; leftover ammo
//   returns as stones. [ASSUMED] its passive widens the trigger burst to the 3×3 block around the stone.
//
// fx kinds emitted (battle.fx(kind, {x, y, …})): summon {id, token} · aoe {radius, id, skill} — the engine's own.

import { num, talentBb } from './tier1.js';
import { COLS } from '../../constants.js';

const STONE_TOKEN = 'token_10064_wang_stone1';
const S1 = 'skchr_wang_1', S2 = 'skchr_wang_2', S3 = 'skchr_wang_3';

// 棋子: a marker on a tile — no HP worth losing, no attack, no block, no target (untargetable via spawnToken opts).
const STONE_DEF = {
  tokenId: STONE_TOKEN, kind: 'summon', name: '棋子', profession: 'TOKEN',
  stats: { maxHp: 1, atk: 0, def: 0, res: 0, moveSpeed: 0, blockCnt: 0, bat: 1, aspd: 100, respawnTime: 0, spRecovery: 0,
    hpRecoveryPerSec: 0, massLevel: 0, tauntLevel: 0, rangeRadius: 0 },
  rangeGrid: [[0, 0]], dmgType: 'phys', skill: null, talents: [], trait: { noAttack: true },
};

const enemy = (u) => !!u && u.side === 'enemy' && u.alive;

export default function wang(bb, chess, def) {
  const sid = chess?.skill?.skillId ?? def?.skill?.id ?? null;
  const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
  const recOf = (id) => (chess?.skills ?? []).find((s) => (s.skillId ?? s.id) === id) ?? null;
  const bbOf = (id) => recOf(id)?.bb ?? (id === sid ? bb : {});
  const capBase = Math.max(1, num(t0.cnt, 6) + 1);                       // 可以使用6枚棋子（最多拥有7枚）
  const s3Grid = recOf(S3)?.rangeGrid ?? (sid === S3 ? def?.skill?.rangeGrid : null) ?? null;
  const b1 = bbOf(S1), b2 = bbOf(S2), b3 = bbOf(S3);

  /** Her living, deployment-triggered stones. */
  const stonesOf = (battle, unit) => battle.allyUnits.filter((s) => s.kind === 'token' && s.alive && !s.removed && s.mem?.wangStone === unit.id);
  /** 7 held at once; S3's talent lets 3 more stand while it runs [ASSUMED]. */
  const capOf = (unit) => capBase + (unit.skill?.id === S3 && unit.skill.active ? 3 : 0);

  /**
   * Free tile of her current range for a new stone: closest to a live enemy, on the enemy's row/column first, then
   * continuing an existing stone line. Never a tile an enemy or a unit stands on (trait: 陷阱无法放置于敌人已在的格子中
   * — S3's excess stones take the nearest free tile to an enemy instead: the engine refuses an occupied tile, even with
   * `force` [ASSUMED]).
   */
  const pickTile = (battle, unit, near = false) => {
    const live = stonesOf(battle, unit), foes = battle.aliveEnemies();
    const out = [];
    for (const k of unit.rangeKeys || []) {
      const r = (k / COLS) | 0, c = k % COLS;
      if (!battle.grid.inRect(r, c) || !battle.grid.canStand(r, c, { ranged: false })) continue;
      if (battle.isReservedTile(r, c) || battle.unitAt(r, c)) continue;
      // trait: 陷阱无法放置于敌人已在的格子中 — S3's excess stones may take an enemy's tile (deployed under it) [ASSUMED]
      if (!near && foes.some((e) => Math.round(e.y) === r && Math.round(e.x) === c)) continue;
      let dist = Infinity, line = 1;
      for (const e of foes) {
        const er = Math.round(e.y), ec = Math.round(e.x);
        const d = Math.max(Math.abs(er - r), Math.abs(ec - c));
        if (d < dist) { dist = d; line = er === r || ec === c ? 0 : 1; }
        else if (d === dist && (er === r || ec === c)) line = 0;
      }
      if (near && foes.length && dist > 1) continue;                     // 超出上限的棋子优先部署在敌人所在位置
      const stack = live.some((s) => s.tileR === r || s.tileC === c) ? 0 : 1;   // 相连（同线）优先
      out.push([line, dist, stack, r, c]);
    }
    out.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3] || a[4] - b[4]);
    return out.length ? [out[0][3], out[0][4]] : null;
  };

  /** Stones on the straight line through `stone` (talent 2), capped at attack@max_trigger_cnt. */
  const lineStacks = (battle, unit, stone) => {
    let n = 0;
    for (const s of stonesOf(battle, unit)) if (s !== stone && (s.tileR === stone.tileR || s.tileC === stone.tileC)) n++;
    return Math.min(Math.max(0, num(t1['attack@max_trigger_cnt'], 3)), n);
  };

  /** Which lines of the stone's cross are connected to another stone (both when it is alone [ASSUMED]). */
  const chainAxes = (battle, unit, stone) => {
    let row = false, col = false;
    for (const s of stonesOf(battle, unit)) {
      if (s === stone) continue;
      if (s.tileR === stone.tileR) row = true;
      if (s.tileC === stone.tileC) col = true;
    }
    return row || col ? { row, col } : { row: true, col: true };
  };

  /** 连星: enemies on the stone's row/column within `radius` tiles (the stone's own tile included). */
  const lineVictims = (battle, stone, radius, axes) => battle.aliveEnemies().filter((e) => {
    if (e.hidden) return false;
    const r = Math.round(e.y), c = Math.round(e.x);
    return (axes.row && r === stone.tileR && Math.abs(c - stone.tileC) <= radius)
      || (axes.col && c === stone.tileC && Math.abs(r - stone.tileR) <= radius);
  });

  /** One stone trigger: talent-2 line stacks, then the selected skill's effect; the stone is spent either way. */
  const trigger = (battle, unit, stone, victim) => {
    if (stone.mem.wangFired) return;
    stone.mem.wangFired = true;
    const n = lineStacks(battle, unit, stone);
    const mul = 1 + num(t1['attack@per_atk_scale'], 0.1) * n;
    const pen = num(t1['attack@per_magic_resist_penetrate_fixed'], 9) * n;
    const atk = unit.s.atk;
    const hit = (target, scale, tags = ['skill', 'talent']) => {
      if (enemy(target)) battle.dealDamage(unit, target, { amount: atk * scale * mul, type: 'arts', isSkill: true, resIgnoreFlat: pen, tags });
    };
    const info = { t: battle.time, sid, n, mul, atk, resIgnoreFlat: pen, r: stone.tileR, c: stone.tileC };
    if (sid === S1) {
      // 取势: 停顿 + 每秒 120% 攻击力的法术伤害, 持续 6.5 s
      const dur = num(b1['attack@sluggish'], 6.5), scale = num(b1['attack@atk_scale'], 1.2);
      battle.applyStatus(victim, 'sluggish', { duration: dur, source: unit });
      battle.addBuff(victim, { key: `wang:dot:${unit.id}`, duration: dur, interval: 1, source: unit, visible: true,
        onTick: ({ unit: u }) => { if (u.alive) hit(u, scale, ['skill', 'dot']); } });
      info.mode = 'dot'; info.scale = scale; info.amount = atk * scale * mul;
    } else if (sid === S2) {
      // 连星: 480% 攻击力法术伤害 within 3 tiles of the stone's line + 移动速度降低40%, 持续6 s
      const scale = num(b2['attack@atk_scale'], 4.8);
      const victims = lineVictims(battle, stone, 3, chainAxes(battle, unit, stone));
      for (const e of victims) {
        hit(e, scale);
        battle.applyStatus(e, 'slow', { duration: num(b2['attack@duration'], 6), value: Math.abs(num(b2['attack@move_speed'], -0.4)), source: unit });
      }
      info.mode = 'line'; info.scale = scale; info.amount = atk * scale * mul; info.targets = victims.length;
    } else {
      // 天下劫 passive: 触发和伤害范围扩大 (the 3×3 block around the stone [ASSUMED]), 320% 攻击力法术伤害
      const scale = num(b3.atk_scale, 3.2);
      const victims = new Set([victim, ...battle.foesInRadius(stone.x, stone.y, 1.99)]);
      for (const e of victims) hit(e, scale);
      info.mode = 'burst'; info.scale = scale; info.amount = atk * scale * mul; info.targets = victims.size;
      battle.fx('aoe', { x: stone.x, y: stone.y, radius: 1, id: stone.id, skill: S3 });
    }
    unit.mem.wangLastTrigger = info;
    battle.retreat(stone, { reason: 'expired', permanent: true });
  };

  /** The stone's own kit: watch its tile, then spend it. */
  const stoneKit = (unit) => ({
    skill: null,
    trait: { noAttack: true, maxTargets: 0 },
    talents: [{ install(battle, stone) {
      stone.mem.wangStone = unit.id;
      battle.every(0.1, () => {
        if (!stone.alive || stone.removed || stone.mem.wangFired) return;
        const r = stone.tileR, c = stone.tileC;
        const victim = battle.aliveEnemies().find((e) => Math.round(e.y) === r && Math.round(e.x) === c);
        if (victim) trigger(battle, unit, stone, victim);
      }, { owner: stone });
    } }],
  });

  /** Place up to `count` stones (capped by capOf); returns how many made it. */
  const place = (battle, unit, count) => {
    let placed = 0;
    for (let i = 0; i < count; i++) {
      const live = stonesOf(battle, unit);
      if (live.length >= capOf(unit)) break;
      const tile = (live.length >= capBase ? pickTile(battle, unit, true) : null) ?? pickTile(battle, unit);
      if (!tile) break;
      const stone = battle.spawnToken(unit, STONE_TOKEN, tile[0], tile[1], { def: STONE_DEF, kit: stoneKit(unit), untargetable: true });
      if (!stone) break;
      battle.fx('summon', { x: stone.x, y: stone.y, id: stone.id, token: STONE_TOKEN });
      placed++;
    }
    return placed;
  };

  /** S3 ammo: one round is spent per stone deployed ("第一天赋额外至多部署3枚棋子并消耗等量弹药"). */
  const spendAmmo = (skill, unit, n) => {
    if (!(n > 0)) return;
    unit.mem.wangAmmo = Math.max(0, (unit.mem.wangAmmo ?? 0) - n);
    skill.addAmmo(-n);
  };

  const skills = {
    [S1]: { kind: 'instant', onStart({ battle, unit }) { place(battle, unit, num(b1.cnt, 2)); } },
    [S2]: { kind: 'instant', onStart({ battle, unit }) { place(battle, unit, num(b2.cnt, 2)); } },
    [S3]: {
      kind: 'ammo', ammo: num(b3.trigger_time, 20),
      ...(s3Grid ? { targeting: { rangeGrid: s3Grid } } : {}),
      attack: { noAttack: true },                                        // 停止攻击 (range stays expanded)
      onStart({ battle, unit, skill }) {
        unit.mem.wangAmmo = num(b3.trigger_time, 20);
        unit.mem.wangS3Top = 0;
        unit.mem.wangS3Idle = 0;
        spendAmmo(skill, unit, place(battle, unit, num(b3.cnt, 8)));     // 立即获得8枚棋子, 超出的部署在敌人附近
      },
      onTick({ battle, unit, skill, dt }) {
        const st = unit.mem;
        st.wangS3Idle = stonesOf(battle, unit).length ? 0 : (st.wangS3Idle ?? 0) + dt;
        st.wangS3Top = (st.wangS3Top ?? 0) + dt;
        if (st.wangS3Top >= 0.5) {                                       // the field is kept stocked (manual placement stands in)
          st.wangS3Top = 0;
          if (st.wangAmmo > 0) spendAmmo(skill, unit, place(battle, unit, 1));
        }
        if (st.wangAmmo <= 0) skill.end('ammo');
        else if (st.wangS3Idle > 3) skill.end('stones');
      },
      onEnd({ battle, unit }) {
        const left = Math.max(0, unit.mem.wangAmmo ?? 0);                // 剩余的弹药返还为棋子
        unit.mem.wangAmmo = 0;
        if (left > 0) place(battle, unit, left);
      },
    },
  };

  return { skill: skills[sid] ?? skills[S1], skills, talents: [] };
}
