// server/sim/content/kits/ops/op-thumpy.js — 珊比 (char_4235_thumpy) 自选 operator kit: 6★ 本源铁卫 (重装), an owned-6★
// pick of the tier-5 and tier-6 自选 slots; every skill, both talents, the trait and her module at every form.
// Kit contract and the 自选 rules: ../README.md ("How to add an operator (自选)").
//
// Forms (data/backups.json units.char_4235_thumpy, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, PRP-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table (zh_CN, as built into backups.json), gamedata_const
// ba.dt.erosion2 侵蚀损伤·我方 / ba.barrier 屏障 / ba.sluggish 停顿, PRTS 珊比 (talent 备注 "每次珊比成功造成伤害后，产生侵蚀
// 损伤/冷却减少效果；且实际上侵蚀损伤与冷却减少为互斥的效果…侵蚀损伤爆发期间将改为减少当前爆发持续时间", "每次珊比成功造成伤害后，
// 才会对目标施加用于检测侵蚀损伤爆发的【脚板标记】…珊比退场时清除所有已施加的标记", "若触发天赋时珊比已有来自此天赋的屏障，则改为
// 为已有屏障Buff累加伤害吸收量"; S1 备注 "推动效果为径向推力，攻击到未被阻挡的敌人时也会生效"; S2 备注 — the spraying order,
// "强力胶的效果施加无视无法选择，但其不会对隐藏、隐匿、无敌的单位产生停顿与伤害效果", "停顿效果先于此技能的物理伤害生效", "追加侵蚀
// 损伤的“其他干员”判断以伤害的来源为准，无来源伤害始终无法触发此效果"; S3 备注 — the conveyor "影响自身前方4格可通行地块（不包括
// 自身所在格，中心判定）内的所有未被阻挡的地面敌方敌人，可影响隐匿单位，无法影响自缚单位", "每帧…传送0.8/30格…卫戍协议为每秒20帧",
// "伤害效果影响自身所在格及正前方4格内所有地面敌方单位，以及所有被自身阻挡的敌方单位").
// - Trait (本源铁卫) "能够阻挡三个敌人，可以造成元素损伤": the profession default (block 3), ground-only physical melee on her
//   own tile (range 0-1). Module PRP-X 出发的勇气 adds "阻挡敌人时，自身造成的元素损伤提升15%" (trait bb ep_damage_scale):
//   every element fill she deals ×ep_damage_scale while she blocks — an `elementHit` multiplier (the kits' convention: 菲莱 /
//   余 PRP-X).
// - T1 探险理论: "珊比受到的元素损伤降低15%" (full potential: 20%; ep_damage_scale 0.8): an `elementHit` multiplier on her at
//   priority 20 (the operators' 受到的元素损伤 convention, docs/SIM.md §7.2). "珊比造成物理伤害时，附带攻击力10%的侵蚀损伤，
//   并使目标的侵蚀损伤冷却减少1秒" (full potential: 12%, 1.2秒; ep_damage_ratio[trigger] / duration_dec): after each physical damage
//   instance of hers that removes HP — attacks, the glue and conveyor ticks too ("每次珊比成功造成伤害后") — ep_damage_ratio[trigger]
//   × ATK 侵蚀损伤 on the target, or, while its 侵蚀 burst (爆发冷却) runs, that cooldown −duration_dec s instead. The skills' own
//   ep_damage_ratio[trigger] 0 is read as their ability carrying no rider of its own [ASSUMED: PRTS names no exception to the
//   talent].
// - T2 坚硬脚板: her HP damage marks the enemy (【脚板标记】, kept through a 重生, cleared when she leaves the field); a marked
//   enemy's 侵蚀 burst — whoever filled it — gives her one stack of DEF +def (PRP-X stage 3: and ATK +atk; flat, at most
//   max_stack_cnt, until she leaves the field [ASSUMED]) and shield_value 屏障 (one barrier buff: a further trigger adds to
//   it), at most scale × her max HP.
// - S1 “还不走？” (MANUAL; data DEFAULT — the owner's 重装 cast-in-range exception, rawRule TAKE_DAMAGE): `duration` s of
//   ATK / DEF +; she strikes every enemy she blocks at once and pushes each one she strikes with 小力 (attack@force 0) —
//   radially from her (PRTS 备注), Battle.push's official 力度 − 重量 distance.
// - S2 “慢慢走~” (MANUAL; DEFAULT): `duration` s of ATK / DEF +atk / +def. At the cast she sprays glue on her own tile (not
//   counted) and max_cnt − 1 (4, "占据4格") passable ground tiles by PRTS's order — front tile, its right, its left, its
//   front (front blocked: her left, her right), then spreading from the last sprayed tile not spread yet: right, left,
//   front — left / right / front being hers (glueTiles). Every `interval` s, the cast included [ASSUMED: the first pulse at
//   the cast], every ground enemy on the glue [ASSUMED: the glue lies on the ground; flyers pass over it] — untargetable
//   ones too, never a 隐藏 / 隐匿 / 无敌 one — takes 停顿 `sluggish` s, then atk_scale × ATK physical. While it lies,
//   another allied operator's physical damage that removes HP from an enemy on the glue adds ep_damage_ratio[damage] × her
//   ATK 侵蚀损伤 from her (her PRP-X scales it) [ASSUMED: the rider is hers]; 无来源 damage never does.
// - S3 “不准走！” (MANUAL; DEFAULT): `duration` s — block +block_cnt, strikes every blocked enemy at once, ATK / DEF +. The
//   conveyor: the passable tiles among the max_cnt − 1 tiles ahead of her (not hers); every tick each unblocked ground enemy
//   standing on one (by its centre tile), 重量 ≤ mass_level, not 自缚 — 隐匿 ones too — is carried towards her after its own
//   movement by CONVEYOR_FRAME × CONVEYOR_FPS × dt: the official 0.8 / 30 tile per frame at 卫戍协议's 20 frames per second
//   (PRTS: 0.533 tiles/s here, not the regular game's 0.8), never into an impassable tile (keeping 0.2 tile off its edge on a
//   horizontal belt). Every `interval` s, the cast included [ASSUMED], every targetable ground enemy on her tile and the
//   max_cnt − 1 tiles ahead and every enemy she blocks takes atk_scale × ATK physical; an enemy there whose 侵蚀 bursts
//   loses thumpy[ep_break_water].def DEF more — permanent and stacking, as the burst's own −120 [ASSUMED].

import { num, talentBb, traitBb, skillRec, up } from '../shared/tier1.js';
import { offsetTile, frontOf, dirVec } from '../../../dir.js';
import { bodyInKeys, bodyInRange } from '../../../body.js';
import { enemyStealthed, tileKeyOf } from '../../../targeting.js';
import { hasHp } from '../../../attack.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_thumpy_1';
const S2 = 'skchr_thumpy_2';
const S3 = 'skchr_thumpy_3';
/** PRTS S3 备注: the conveyor carries 0.8 / 30 tile per frame ("传送带矢量"; conveyor_speed / 30) … */
const CONVEYOR_FRAMES = 30;
/** … and 卫戍协议 runs 20 frames per second ("如果游戏的实际运行帧率发生改变（例如卫戍协议为每秒20帧），位移量也将随之变化"). */
const CONVEYOR_FPS = 20;
/** PRTS S3 备注: a horizontal belt keeps its enemies 0.2 tile off the edge of an impassable tile. */
const BELT_EDGE = 0.2;
/** "占据4格" / "向前展开4格" when the blackboard has no max_cnt (it counts her own tile too: max_cnt − 1). */
const TILES = 4;
/** Her facing-RIGHT frame: right hand, left hand, front ([dRow, dCol]; row 0 is the bottom row — sim/dir.js). */
const RIGHT = Object.freeze([-1, 0]);
const LEFT = Object.freeze([1, 0]);
const FRONT = Object.freeze([0, 1]);
const SOLE = 'talent:thumpy:sole';
const BARRIER = 'talent:thumpy:barrier';
const BELT_BREAK = 'skill:thumpy:beltBreak';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isFinite(v) && v !== 0));
/**
 * "可用地块" of the glue / belt: passable ground of the field with no obstacle on it (a 射击台 / mound / 阻隔工事 tile is no
 * ground an enemy stands on; the mode's stages have no 假高台 / 坑洞 tiles).
 */
const usable = (battle, r, c) => battle.grid.groundPassable(r, c);

/**
 * S2's glue tiles (PRTS 备注 order): her own tile when usable (not counted, never spreads), then `count` tiles — the front
 * tile, its right, its left and its front (front unusable: her left, then her right), then spreading from the last sprayed
 * tile that has not spread yet to its right, left and front, until `count` tiles or nothing left to spread. Absolute keys.
 */
function glueTiles(battle, unit, count) {
  const keys = [];
  const sprayed = new Set();
  const list = [];
  const abs = (lr, lc) => offsetTile(unit.tileR, unit.tileC, lr, lc, unit.dir);
  const spray = (lr, lc) => {
    if (list.length >= count || sprayed.has(`${lr},${lc}`)) return;
    const [r, c] = abs(lr, lc);
    if (!usable(battle, r, c)) return;
    sprayed.add(`${lr},${lc}`);
    list.push({ lr, lc, spread: false });
    keys.push(r * COLS + c);
  };
  const near = ([lr, lc], [dr, dc]) => [lr + dr, lc + dc];
  if (usable(battle, unit.tileR, unit.tileC)) { sprayed.add('0,0'); keys.push(unit.tileR * COLS + unit.tileC); }
  const front = [0, 1];
  if (usable(battle, ...abs(...front))) {
    for (const d of [[0, 0], RIGHT, LEFT, FRONT]) spray(...near(front, d));
  } else {
    for (const d of [LEFT, RIGHT]) spray(...near([0, 0], d));
  }
  while (list.length < count) { // loop-cap: spray stops when every tile is spread
    let at = null;
    for (let i = list.length - 1; i >= 0; i--) if (!list[i].spread) { at = list[i]; break; }
    if (!at) break;
    at.spread = true;
    for (const d of [RIGHT, LEFT, FRONT]) spray(...near([at.lr, at.lc], d));
  }
  return keys;
}

export default {
  char_4235_thumpy: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const glueCount = Math.max(0, Math.round(num(b2.max_cnt, TILES + 1)) - 1);
    const beltLen = Math.max(0, Math.round(num(b3.max_cnt, TILES + 1)) - 1);
    const beltRate = num(b3.conveyor_speed) / CONVEYOR_FRAMES * CONVEYOR_FPS;
    const massCap = num(b3.mass_level, 4);

    /** S2: one glue pulse — 停顿 first, then the physical hit (PRTS 备注), on every ground enemy on the glue. */
    const gluePulse = (battle, unit, glue) => {
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || !bodyInKeys(e, glue) || enemyStealthed(e) || e.s.flags.invulnerable) continue;
        battle.applyStatus(e, 'sluggish', { duration: num(b2.sluggish), source: unit });
        if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale), type: 'phys', isSkill: true, ignoreSelect: true, tags: ['skill', 'thumpy:glue'] });
      }
    };
    /** S3: the enemies the belt damages — targetable ground enemies on her tile and the tiles ahead, and every one she blocks. */
    const beltVictims = (battle, unit, belt) => {
      const out = battle.enemiesInKeys(belt.hurtKeys, unit, { canHitFly: false });
      for (const e of battle.blockedTargets(unit, unit.profile)) if (!out.includes(e)) out.push(e);
      return out;
    };
    /** S3: the conveyor carries the unblocked ground enemies on its tiles towards her (after their own movement). */
    const carry = (battle, unit, belt, dt) => {
      const [fr, fc] = belt.fwd;
      const step = beltRate * dt;
      if (!(step > 0)) return;
      for (const e of battle.enemies) {
        if (!e.alive || e.hidden || e.isFlying || e.blockedBy || e.s.flags.selfBound || e.s.massLevel > massCap) continue;
        if (!belt.carryKeys.has(tileKeyOf(e))) continue;
        let nx = e.x - fc * step, ny = e.y - fr * step;
        const r = Math.round(ny), c = Math.round(nx);
        if (!usable(battle, r, c)) {
          // never into an impassable tile; a horizontal belt keeps BELT_EDGE off its edge
          const er = Math.round(e.y), ec = Math.round(e.x);
          if (fc !== 0) nx = ec - fc * (0.5 - BELT_EDGE); else ny = er - fr * (0.5 - 1e-3);
          if (fc !== 0 ? (nx - e.x) * -fc <= 0 : (ny - e.y) * -fr <= 0) continue;
        }
        e.x = nx; e.y = ny;
        if (e.route) e.route.pts = null;
      }
    };

    return {
      skills: {
        [S1]: {
          kind: 'duration',
          mods: nz({ atkPct: num(b1.atk), defPct: num(b1.def) }),
          attack: {
            hitAllBlocked: true,
            onEachHit({ battle, unit, target }) {
              if (target && target.alive && target.side === 'enemy') battle.push(target, num(b1['attack@force']), { from: unit });
            },
          },
        },
        [S2]: {
          kind: 'duration',
          // [ASSUMED] its glue / belt act on ground enemies only: 白铁's 铁钳号 alone does not open it (skills.js allyTargetsOk)
          allyTargets: false,
          // the owner's rule for a skill whose area is larger than her range (her tile): cast as soon as a ground enemy she
          // can affect is on the glue's first five tiles — her tile, the front one, its two sides and the one beyond
          // (glueTiles' PRTS order), as 余 S2's x-1 (§22.10); the data's DEFAULT (重装 exception) only saw her own tile
          trigger: { rule: 'ACTIVE_RANGE', grid: [[0, 0], [0, 1], [1, 1], [-1, 1], [0, 2]] },
          mods: nz({ atkPct: num(b2.atk), defPct: num(b2.def) }),
          onStart({ battle, unit }) {
            const keys = glueTiles(battle, unit, glueCount);
            unit.mem.thumpyGlue = { keys: new Set(keys), acc: 0 };
            const mid = (f) => keys.reduce((s, k) => s + f(k), 0) / Math.max(1, keys.length);
            battle.fx('zone', { x: mid((k) => k % COLS), y: mid((k) => Math.floor(k / COLS)), radius: 1.2, dur: num(skillRec(chess, S2)?.duration), id: unit.id, skill: 'thumpy:glue' });
            gluePulse(battle, unit, unit.mem.thumpyGlue.keys);
          },
          onTick({ battle, unit, dt }) {
            const g = unit.mem.thumpyGlue;
            if (!g) return;
            const iv = Math.max(0.05, num(b2.interval, 0.7));
            g.acc += dt;
            while (g.acc + 1e-9 >= iv && unit.alive) { g.acc -= iv; gluePulse(battle, unit, g.keys); } // loop-cap: interval floored before the loop
          },
          onEnd({ unit }) { unit.mem.thumpyGlue = null; },
        },
        [S3]: {
          kind: 'duration',
          allyTargets: false,
          // likewise on the conveyor: her tile and the four ahead (the owner's larger-area rule; 余 S2 precedent)
          trigger: { rule: 'ACTIVE_RANGE', grid: [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
          mods: nz({ atkPct: num(b3.atk), defPct: num(b3.def), blockCnt: num(b3.block_cnt) }),
          attack: { hitAllBlocked: true },
          onStart({ battle, unit }) {
            const ahead = [];
            for (let k = 1; k <= beltLen; k++) ahead.push(frontOf(unit.tileR, unit.tileC, unit.dir, k));
            const inField = ahead.filter(([r, c]) => battle.grid.inRect(r, c));
            const belt = {
              fwd: dirVec(unit.dir), acc: 0,
              carryKeys: new Set(inField.filter(([r, c]) => usable(battle, r, c)).map(([r, c]) => r * COLS + c)),
              hurtKeys: [unit.tileR * COLS + unit.tileC, ...inField.map(([r, c]) => r * COLS + c)],
            };
            belt.hurtSet = new Set(belt.hurtKeys);
            unit.mem.thumpyBelt = belt;
            const [fr, fc] = belt.fwd, half = (beltLen + 1) / 2;
            battle.fx('zone', { x: unit.x + fc * half, y: unit.y + fr * half, radius: half, dur: num(skillRec(chess, S3)?.duration), id: unit.id, skill: 'thumpy:belt' });
            for (const e of beltVictims(battle, unit, belt)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(b3.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'thumpy:belt'] });
          },
          onTick({ battle, unit, dt }) {
            const belt = unit.mem.thumpyBelt;
            if (!belt) return;
            carry(battle, unit, belt, dt);
            const iv = Math.max(0.05, num(b3.interval, 1));
            belt.acc += dt;
            while (belt.acc + 1e-9 >= iv && unit.alive) { // loop-cap: interval floored before the loop
              belt.acc -= iv;
              for (const e of beltVictims(battle, unit, belt)) battle.dealDamage(unit, e, { amount: unit.s.atk * num(b3.atk_scale), type: 'phys', isSkill: true, tags: ['skill', 'thumpy:belt'] });
            }
          },
          onEnd({ unit }) { unit.mem.thumpyBelt = null; },
        },
      },
      talents: [
        { install(battle, unit) { // 探险理论: 元素损伤 taken ×ep_damage_scale; her physical damage ⇒ 侵蚀损伤 or the burst −duration_dec s
          const taken = num(t0.ep_damage_scale, 1);
          if (taken !== 1) {
            battle.on('elementHit', (c) => {
              if (c.target === unit && c.dmg?.type === 'element') c.dmg.mul *= taken;
            }, { owner: unit, priority: 20 });
          }
          const ratio = num(t0['ep_damage_ratio[trigger]']), dec = num(t0.duration_dec);
          battle.on('damaged', (c) => {
            const t = c.target;
            if (c.source !== unit || c.type !== 'phys' || !(c.amount > 0) || !t || t.side !== 'enemy' || !hasHp(t)) return;
            const lock = t.findBuff('erosionBurst');
            if (lock) { if (dec > 0) lock.timeLeft = Math.max(0, lock.timeLeft - dec); return; }
            if (ratio > 0) battle.dealDamage(unit, t, { type: 'element', element: 'erosion', amount: unit.s.atk * ratio, tags: ['talent', 'thumpy:theory'] });
          }, { owner: unit, priority: -10 });
        } },
        { install(battle, unit) { // 坚硬脚板: her HP damage marks; a marked enemy's 侵蚀 burst ⇒ DEF (+ATK) stack and 屏障
          const def = num(t1.def), atk = num(t1.atk), shield = num(t1.shield_value), cap = Math.max(1, Math.floor(num(t1.max_stack_cnt, 1)));
          const capHp = num(t1.scale, 3);
          if (!(def || atk || shield)) return;
          const marks = () => unit.mem.thumpyMarks ?? (unit.mem.thumpyMarks = new Set());
          battle.on('deploy', (c) => { if (c.unit === unit) marks().clear(); }, { owner: unit });
          battle.on('death', (c) => { if (c.unit === unit) marks().clear(); }, { owner: unit });
          battle.on('damaged', (c) => {
            if (c.source === unit && c.target && c.target.side === 'enemy' && c.type !== 'element' && c.amount > 0) marks().add(c.target);
          }, { owner: unit, priority: 10 });
          battle.on('elementBurst', (c) => {
            const t = c.target;
            if (c.element !== 'erosion' || !t || t.side !== 'enemy' || !up(unit) || !marks().has(t)) return;
            if (def || atk) battle.addBuff(unit, { key: SOLE, refresh: 'stack', stacks: 1, maxStacks: cap, mods: nz({ defFlat: def, atkFlat: atk }), visible: true, tags: ['talent'] });
            if (shield > 0) {
              const max = capHp * unit.s.maxHp;
              const cur = unit.findBuff(BARRIER);
              if (cur) { cur.shield = Math.min(max, (cur.shield || 0) + shield); unit.markDirty(); }
              else battle.addBuff(unit, { key: BARRIER, shield: Math.min(max, shield), visible: true, tags: ['talent'] });
            }
            battle.fx('shield', { x: unit.x, y: unit.y, id: unit.id, talent: 'thumpy:sole' });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // PRP-X: 阻挡敌人时，自身造成的元素损伤提升15%
        const epScale = num(tb.ep_damage_scale, 1);
        if (epScale !== 1) {
          battle.on('elementHit', (c) => {
            if (c.source === unit && c.dmg?.type === 'element' && c.target?.side === 'enemy' && unit.blocking.length > 0) c.dmg.mul *= epScale;
          }, { owner: unit });
        }
        // S2: another operator's physical damage on an enemy in the glue ⇒ ep_damage_ratio[damage] × her ATK 侵蚀损伤
        const rider = num(b2['ep_damage_ratio[damage]']);
        if (rider > 0) {
          battle.on('damaged', (c) => {
            const g = unit.mem.thumpyGlue, s = c.source, t = c.target;
            if (!g || !up(unit) || !s || s === unit || s.side !== 'ally' || s.kind !== 'op' || c.type !== 'phys' || !(c.amount > 0)) return;
            if (!t || t.side !== 'enemy' || t.isFlying || !hasHp(t) || !bodyInKeys(t, g.keys)) return;
            battle.dealDamage(unit, t, { type: 'element', element: 'erosion', amount: unit.s.atk * rider, tags: ['skill', 'thumpy:glue'] });
          }, { owner: unit });
        }
        // S3: an enemy on the belt's tiles (or blocked by her) whose 侵蚀 bursts ⇒ DEF −30 more, for good
        const breakDef = num(b3['thumpy[ep_break_water].def']);
        if (breakDef) {
          battle.on('elementBurst', (c) => {
            const belt = unit.mem.thumpyBelt, t = c.target;
            if (!belt || !up(unit) || c.element !== 'erosion' || !t || t.side !== 'enemy') return;
            if (t.blockedBy !== unit && (t.isFlying || !bodyInRange(t, belt.hurtSet))) return;
            battle.addBuff(t, { key: BELT_BREAK, refresh: 'stack', stacks: 1, maxStacks: 1e6, mods: { defFlat: breakDef }, source: unit });
          }, { owner: unit });
        }
      },
    };
  },
};
