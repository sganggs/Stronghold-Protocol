// server/sim/content/kits/ops/op-wang.js — 望 (char_2027_wang) 自选 operator kit: 6★ 陷阱师 (特种), an owned-6★ pick of the
// tier-5 and tier-6 自选 slots; every skill, both talents, the trait, the module TRP-X 兽形棋盒 at every form, and the kit of
// her summon 棋子 (token_10064_wang_stone1) with its 跟子. Kit contract and the 自选 rules: ../README.md ("How to add an
// operator (自选)").
//
// Forms (data/backups.json units.char_2027_wang, the DIY slot statuses): normal = E2 Lv1, skills at rank 4, no module;
// elite = E2 Lv60, rank 7, TRP-X at stage 1 (tier 5) or 3 (tier 6). Full potential (the owner's decision of 2026-10-07).
// Sources: character_table / skill_table / battle_equip_table / token_table (zh_CN, as built into backups.json; the 棋子
// owner-form / skill / module variants) and PRTS 望 (铸子 备注: the 跟子 are 望's own projectiles — no unit, they take no
// tile, act and connect like a 棋子; they go on deployable tiles and on undeployable ground with no character unit; order
// "有敌人的>没有敌人的；不可部署地块>可部署地面地块>可部署高台地块…相同优先级时按棋子上>右>下>左"; a 棋子 deals its damage as
// itself, a 跟子 as 望. 料敌机先 备注: the RES ignore is the source's 法术穿透 for that damage. S1 备注 "棋子持有库存达到上限的情况下
// 具有阻回 / 法术伤害效果可独立叠加生效（每个效果会独立记录触发棋子的第二天赋层数）…可对空 / …由望依自身属性预计算伤害后、以无来源
// 的形式施加给目标". S2 备注 "若相连棋子/跟子在上下侧则激活垂直效果范围（自身及上下3格），左右侧则激活水平效果范围…效果范围不因相连
// 棋子/跟子消失而取消激活 / 移动速度降低为直接乘算，可无限叠加，每层独立计时（但移动速度存在0.1数值下限）". S3 备注 "棋子与跟子的
// 攻击范围/触发范围为…，触发时对范围内所有敌方单位造成伤害（可对空） / 技能开启时自动“部署”的为第一天赋的跟子"), PRTS 棋子 (备注
// "技能伤害始终借用持有者的攻击力计算，但伤害来源于自身"), PRTS 分支特性信息 陷阱师 ("可对空 / “敌人已在”…地面行动敌人… / 干员离场
// 后，附属的陷阱随之消失"), PRTS 卫戍协议/帮助 §作战阶段 (placed summons deploy with the board "无视所属干员的持有状态，不消耗持有数量";
// "若召唤物在战斗期间退场，将在满足条件后立即原地再部署1个").
// - Trait (陷阱师): ranged physical arrows, 3-3, hits air units (PRTS 分支特性信息 "可对空"), blocks 1, ground-targetable.
//   "陷阱无法放置于敌人已在的格子中": a 棋子 does not come back while a ground enemy stands on its tile (S3: inside her range it
//   may). Module TRP-X "部署费用更低（-1）…可同时部署的陷阱数量提升（+1）": the 棋子 variant's cost 2 (the DP of its returns) and
//   deploy limit 8 (the hand count — the match's); its attributes in the stats.
// - T1 铸子 (cnt / attack@max_spawn_cnt; "最多拥有7枚", full potential: 8): the 棋子 are hand pieces the player places; they
//   deploy with the board for free. Her stock (持有库存: the 棋子 in her hand — cnt at the start, at most STOCK_CAP; the
//   skills add to it) counts them — the owner's decision of 2026-10-06, a deliberate deviation from PRTS 卫戍协议/帮助 (placed
//   summons "无视所属干员的持有状态，不消耗持有数量", which left her stock at cnt: one S1 / S2 cast reached the cap and 阻回
//   held her SP for the rest of the battle): every deployment of a 棋子 (the battle start's and each return) takes one from
//   it, like one she deployed herself (never below 0 [ASSUMED: an 8th placed piece of TRP-X's deploy limit takes none]), and
//   a 棋子 that leaves the field (set off, or gone with her) goes back into it at once by the official summon rule — its
//   card back in her hand while its redeploy time runs (as shared/summoner.js's recall) —, at most the cap [ASSUMED: one
//   over the cap is lost].
//   So "立即获得两枚棋子" and the 阻回 at the cap keep cycling through the battle. 棋子 / 跟子
//   that touch on a side (上下 / 左右) activate each other and stay active once activated [ASSUMED from the S2 备注]; an
//   enemy (air units too) on an active one's tile sets it off: its effect, then it is used up (a 棋子 leaves the field; a
//   跟子 is gone) [ASSUMED: a trap is spent by its trigger]. A spent 棋子 comes back on its tile ("原地再部署") after its
//   redeploy time (2 s), paying its cost and one of her stock, while 望 is on the field. 铸子 "手动部署棋子时，望在相邻位置额外
//   部署一枚棋子": the 棋子 the player placed deploy at the battle start (PRTS 卫戍协议/帮助: a placement in 休整 fires no
//   deployment effect, the piece deploys when the combat starts) — that deployment drops one 跟子 on a tile next to it (the
//   PRTS order above; community report, 0.2.2 — until 0.2.1 the battle start dropped none, so a lone 棋子 never set off), at
//   most attack@max_spawn_cnt on the field; each later return counts as one too [ASSUMED]. The battle start deploys one
//   piece after another (Battle.start), so a 跟子 may land on the tile of a piece still to come: "跟子所在格进行部署（或进行类似
//   部署的行为）时，该跟子会随之消失" (PRTS 铸子 备注) — any deployment on its tile removes it. When 望 leaves the field her 棋子
//   and 跟子 vanish (PRTS 分支特性信息); the 棋子 come back with her.
// - T2 料敌机先 (attack@per_atk_scale / attack@per_magic_resist_penetrate_fixed / attack@max_trigger_cnt): an active 棋子 / 跟子
//   gets one stack per piece of the unbroken line it is part of (itself included; the longer of its lines; ≤ the cap),
//   kept once reached [ASSUMED]; its damage ×(1 + n × per) and n × pen RES ignored. TRP-X stage 3: 15 % / 13.
// - S1 取势 (AUTO): passive — a triggered piece puts 停顿 attack@sluggish s on the enemy that set it off and a 法术 DoT of
//   attack@atk_scale × her ATK every second for attack@sluggish s (precomputed at the trigger with the piece's stacks and
//   her damage multipliers; 无来源, credited to her; each one independent). Active — "立即获得两枚棋子": +cnt stock (≤ the
//   cap); with the stock full she holds 阻回. An AUTO skill acting on nobody fires at full SP (`trigger: 'SP_FULL'`, the
//   owner's AUTO rule).
// - S2 连星 (AUTO, SP_FULL): passive — a triggered piece deals attack@atk_scale × her ATK arts to every enemy on its active
//   lines (its tile ± 3 along each side it was ever connected on; air units too) and a 直接乘算 slow attack@move_speed for
//   attack@duration s, each one on its own timer, added up (speed ≥ 0.1). Active as S1.
// - S3 天下劫 (MANUAL, data ACTIVE_RANGE on its 4-12; ammo trigger_time): passive — the pieces' trigger and damage area is the
//   token skill's range (x-6 in the data; PRTS writes x-1), atk_scale × her ATK arts on every enemy there. Active — no
//   attacks, range 4-12; +cnt stock, the part over the cap placed at once as 跟子 on the tiles of her range by the 铸子 order
//   (S3 备注 "采用相同的位置选择优先顺序"): enemy tiles first, then 不可部署 > 可部署地面 > 高台 [ASSUMED for the ties: her target
//   order among enemy tiles, then nearest to her, then by tile]; a 棋子
//   coming back inside her range during it drops up to 3 跟子, one bullet each ("第一天赋额外至多部署3枚棋子并消耗等量弹药");
//   it ends when the bullets are spent ("棋子耗尽" [ASSUMED]); bullets left at another end return to the stock.

import { num, talentBb, skillRec, up } from '../shared/tier1.js';
import { absoluteRangeKeys, sortEnemyTargets } from '../../../targeting.js';
import { bodyOnTile } from '../../../body.js';
import { COLS, ROWS } from '../../../constants.js';

const S1 = 'skchr_wang_1';
const S2 = 'skchr_wang_2';
const S3 = 'skchr_wang_3';
export const STONE = 'token_10064_wang_stone1';
/** 铸子 "最多拥有7枚" (the 棋子's max deck stack at E2 at potential 0; the talent text — 8 at full potential, read below). */
export const STOCK_CAP_FALLBACK = 7;
/** 料敌机先's stack cap when the data carries none. */
const T2_CAP_FALLBACK = 3;
/** 连星 "两侧3格" (the token blackboard's tile_count 6, both sides). */
const LINE_FALLBACK = 6;
/** The S3 token skill's range when the data carries none (range_table x-6). */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);
/** 跟子 neighbours in the PRTS order 上 > 右 > 下 > 左 (UP = +row; the mirrored field swaps 右 / 左). */
const SIDES = Object.freeze([[1, 0], [0, 1], [-1, 0], [0, -1]]);
const SIDES_MIRRORED = Object.freeze([[1, 0], [0, -1], [-1, 0], [0, 1]]);
/** "额外至多部署3枚棋子" (S3, no blackboard key). */
const S3_EXTRA = 3;
/** Seconds between two tries of a spent 棋子 to come back. */
const RETRY = 0.25;
const SLOW_KEY = 'wang:slow';
const DOT_KEY = 'wang:qushi';
const TAG = 'wang:stone';
/** Profile the pieces select enemies with: air units too. */
const ANY = Object.freeze({ canHitFly: true });

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const keyOf = (r, c) => (r >= 0 && r < ROWS && c >= 0 && c < COLS ? r * COLS + c : -1);

/**
 * The 跟子 placement class of a tile: 0 undeployable ground (walkable, nothing may be deployed there), 1 deployable
 * ground, 2 deployable 高台; null where no 跟子 may go (outside the field, walls, flyer-only tiles that take nobody).
 */
function tileClass(battle, r, c) {
  if (!battle.grid.inRect(r, c)) return null;
  const t = battle.grid.tile(r, c);
  if (t.build === 'NONE') return t.height === 'LOW' && t.pass === 'ALL' ? 0 : null;
  if (t.height === 'LOW' && (t.build === 'ALL' || t.build === 'MELEE')) return 1;
  if (t.build === 'RANGED' || t.build === 'ALL') return 2;
  return null;
}

/**
 * 连星's slow (PRTS 备注 "移动速度降低为直接乘算，可无限叠加，每层独立计时（但移动速度存在0.1数值下限）"): one buff per enemy holding
 * every application (its value, its end); moveMul = max(0.1 ÷ base speed, 1 + Σ values).
 */
function addSlow(battle, src, e, value, duration) {
  if (!e.alive || !(duration > 0) || !value) return;
  const refresh = (unit, b) => {
    const now = battle.time;
    b.data.list = b.data.list.filter((x) => x.until > now + 1e-9);
    if (!b.data.list.length) { battle.removeBuff(unit, b); return; }
    const sum = b.data.list.reduce((a, x) => a + x.v, 0);
    const floor = Math.min(1, 0.1 / Math.max(1e-6, unit.base.moveSpeed));
    const mul = Math.max(floor, 1 + sum);
    if (b.mods?.moveMul !== mul) { b.mods = { moveMul: mul }; unit.markDirty(); }
  };
  let b = e.findBuff(SLOW_KEY);
  if (!b) b = battle.addBuff(e, { key: SLOW_KEY, source: src, tags: ['skill'], data: { list: [] }, mods: { moveMul: 1 }, onTick: ({ unit, buff }) => refresh(unit, buff) });
  if (!b) return;
  b.data.list.push({ v: value, until: battle.time + duration });
  refresh(e, b);
}

export default {
  char_2027_wang: (bb, chess) => {
    const t0 = talentBb(chess, 0);                    // 铸子: cnt, attack@max_spawn_cnt
    const t1 = talentBb(chess, 1);                    // 料敌机先 (TRP-X stage 2+: its change)
    const t0desc = String((chess?.talents ?? []).find((t) => t && t.index === 0)?.desc ?? '');
    // the text at full potential carries the potential step after the number: "最多拥有8（+1）枚"
    const capText = /最多拥有(\d+)(?:（[+-]\d+）)?枚/.exec(t0desc);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s3 = skillRec(chess, S3);
    const per = num(t1['attack@per_atk_scale']), pen = num(t1['attack@per_magic_resist_penetrate_fixed']);
    const t2cap = Math.max(1, Math.floor(num(t1['attack@max_trigger_cnt'], T2_CAP_FALLBACK)));
    const followCap = Math.max(0, Math.floor(num(t0['attack@max_spawn_cnt'])));
    const stock0 = Math.max(0, Math.floor(num(t0.cnt)));
    const stockCap = capText ? +capText[1] : STOCK_CAP_FALLBACK;

    /** Every live piece of 望: her deployed 棋子 and her 跟子, in the order they came. */
    const piecesOf = (battle, unit) => {
      const out = [];
      for (const a of battle.allyUnits) {
        if (a.kind !== 'token' || a.defId !== STONE || a.ownerUnit !== unit || !a.alive || !a.deployed || !a.mem.wangNode) continue;
        const n = a.mem.wangNode;
        n.r = a.tileR; n.c = a.tileC; n.stone = a;
        out.push(n);
      }
      for (const f of unit.mem.wang.followers) out.push(f);
      return out.sort((a, b) => a.seq - b.seq);
    };
    const groundFoeOn = (battle, r, c) => battle.enemies.some((e) => e.alive && !e.hidden && !e.isFlying && bodyOnTile(e, r, c));
    const anyFoeOn = (battle, r, c) => battle.enemies.some((e) => e.alive && !e.hidden && bodyOnTile(e, r, c));

    /** Place a 跟子 on (r, c) (the caller checked the tile). */
    const addFollower = (battle, unit, r, c) => {
      const w = unit.mem.wang;
      const f = { r, c, seq: ++w.seq, act: false, h: false, v: false, stacks: 0, follower: true };
      w.followers.push(f);
      battle.fx('summon', { x: c, y: r, id: unit.id, src: unit.id, token: STONE, follower: true });
      return f;
    };
    /** Tiles a 跟子 may take: in the field, a class, no character unit or knocked-out operator, no piece. */
    const followerFree = (battle, unit, r, c, taken) => {
      const k = keyOf(r, c);
      return k >= 0 && !taken.has(k) && tileClass(battle, r, c) != null && !battle.unitAt(r, c) && !battle.downOn(r, c);
    };
    /** 铸子: up to `n` 跟子 next to (r, c) in the PRTS order; returns how many were placed. */
    const dropFollowers = (battle, unit, r, c, n) => {
      const w = unit.mem.wang;
      let placed = 0;
      for (let i = 0; i < n && w.followers.length < followCap; i++) {
        const taken = new Set(piecesOf(battle, unit).map((p) => keyOf(p.r, p.c)));
        const sides = battle.getPlayer(unit.ownerId)?.mirror ? SIDES_MIRRORED : SIDES;
        const cands = [];
        sides.forEach(([dr, dc], idx) => {
          const rr = r + dr, cc = c + dc;
          if (!followerFree(battle, unit, rr, cc, taken)) return;
          cands.push({ rr, cc, rank: [anyFoeOn(battle, rr, cc) ? 0 : 1, tileClass(battle, rr, cc), idx] });
        });
        if (!cands.length) break;
        cands.sort((a, b) => a.rank[0] - b.rank[0] || a.rank[1] - b.rank[1] || a.rank[2] - b.rank[2]);
        addFollower(battle, unit, cands[0].rr, cands[0].cc);
        placed++;
      }
      return placed;
    };
    /** S3 bullets: spend `n` (the skill ends with the last). */
    const spendAmmo = (battle, unit, n) => {
      const sk = unit.skill, w = unit.mem.wang;
      if (!sk || sk.id !== S3 || !sk.active || !(n > 0)) return;
      w.ammo = Math.max(0, w.ammo - n);
      sk.ammoLeft = w.ammo;
      if (battle.hasHook('ammoUsed')) battle.emit('ammoUsed', { unit, left: w.ammo, skill: sk });
      if (w.ammo <= 0) sk.end('ammo');
    };
    const inHerRange = (unit, r, c) => !!unit.rangeKeySet?.has(keyOf(r, c));

    /** A spent 棋子 comes back on its tile ("原地再部署"); its return drops the 铸子 跟子. */
    const scheduleReturn = (battle, unit, stone) => {
      const at = battle.time + Math.max(0, num(stone.base.respawnTime));
      battle.every(RETRY, (b, sched) => {
        if (stone.alive || stone.removed || b.finished) { sched.cancel(); return; }
        if (b.time + 1e-9 < at || !up(unit) || unit.mem.wang.stock < 1) return;   // (one of her stock: the deployment takes it)
        const r = stone.homeR, c = stone.homeC;
        const s3on = unit.skill?.id === S3 && unit.skill.active && inHerRange(unit, r, c);
        if (groundFoeOn(b, r, c) && !s3on) return;   // "陷阱无法放置于敌人已在的格子中"
        // (a 跟子 on its tile goes: "跟子所在格进行部署…时，该跟子会随之消失")
        const w = unit.mem.wang;
        const before = w.followers.length;
        w.followers = w.followers.filter((f) => f.r !== r || f.c !== c);
        if (!b.redeploy(stone, { free: false })) { if (w.followers.length !== before) b.fx('disappear', { x: c, y: r, id: unit.id }); return; }
        sched.cancel();
        if (s3on) spendAmmo(b, unit, dropFollowers(b, unit, r, c, Math.min(S3_EXTRA, w.ammo)));
        else dropFollowers(b, unit, r, c, 1);
      }, { owner: unit });
    };

    /** The 棋子's kit: no attack, untargetable, its node data per deployment, its return when spent. */
    const stoneKit = (owner) => ({
      skill: null,
      trait: { noAttack: true },
      install(battle, unit) {
        // [ASSUMED] a trap: no enemy selects it
        battle.addBuff(unit, { key: 'trait:wangStone', flags: { untargetable: true }, persist: true, allowDead: true });
        // PRTS 棋子 实体类型 "装置": map terrain does not act on it, as on the map's devices (content/devices.js refreshUnit) —
        // 活性源石 burned a 1000-HP 棋子 down in ~15 s (community report via the owner, 2026-11-14 「望的棋子会被烫死」, §37.205)
        unit.mem.terrainImmune = true;
        battle.on('deploy', (ctx) => {
          if (ctx.unit !== unit) return;
          const w = owner.mem.wang;
          unit.mem.wangNode = { seq: ++w.seq, act: false, h: false, v: false, stacks: 0 };
          w.stock = Math.max(0, w.stock - 1);   // it occupies her stock (the owner's decision of 2026-10-06)
          // 铸子: the battle-start deployment of a placed 棋子 is its 手动部署 — one 跟子 next to it (a return drops its own in
          // scheduleReturn)
          if (ctx.initial && up(owner)) dropFollowers(battle, owner, unit.tileR, unit.tileC, 1);
        }, { owner: unit });
        battle.on('death', (ctx) => {
          if (ctx.unit !== unit || battle.finished) return;
          unit.removed = false;   // the piece is kept (Battle.redeploy accepts it; its hooks stay)
          unit.mem.wangNode = null;
          const w = owner.mem.wang;
          w.stock = Math.min(stockCap, w.stock + 1);   // its card goes back into her stock (the official summon rule)
          scheduleReturn(battle, owner, unit);
        }, { owner: unit, priority: -10 });
      },
    });

    return {
      skills: {
        [S1]: {
          kind: 'instant', trigger: { rule: 'SP_FULL' },
          onStart({ unit }) { const w = unit.mem.wang; w.stock = Math.min(stockCap, w.stock + Math.max(0, Math.floor(num(b1.cnt)))); },
        },
        [S2]: {
          kind: 'instant', trigger: { rule: 'SP_FULL' },
          onStart({ unit }) { const w = unit.mem.wang; w.stock = Math.min(stockCap, w.stock + Math.max(0, Math.floor(num(b2.cnt)))); },
        },
        [S3]: {
          kind: 'ammo',
          ammo: Math.max(1, Math.floor(num(b3.trigger_time, 20))),
          targeting: { rangeGrid: s3?.rangeGrid ?? null },
          attack: { noAttack: true },
          onStart({ battle, unit, skill }) {
            const w = unit.mem.wang;
            w.ammo = skill.ammoLeft;
            const total = w.stock + Math.max(0, Math.floor(num(b3.cnt)));
            const over = Math.max(0, total - stockCap);
            w.stock = Math.min(stockCap, total);
            // "将超出上限的棋子优先部署在范围内敌人所在位置" and the 备注's "采用相同的位置选择优先顺序" (铸子): the free tiles of her
            // (4-12) range, those holding an enemy she can target first, then 不可部署 > 可部署地面 > 高台; [ASSUMED] ties: her
            // target order among enemy tiles, then nearest to her, then by tile
            const n = Math.min(over, followCap - w.followers.length);
            if (!(n > 0)) return;
            const taken = new Set(piecesOf(battle, unit).map((p) => keyOf(p.r, p.c)));
            const foes = sortEnemyTargets(battle, unit, battle.enemiesInKeys(unit.rangeKeys, unit, ANY), unit.profile?.priority ?? null);
            const cands = [];
            for (const k of unit.rangeKeys ?? []) {
              const r = Math.floor(k / COLS), c = k % COLS;
              if (!followerFree(battle, unit, r, c, taken)) continue;
              const fi = foes.findIndex((e) => e.alive && bodyOnTile(e, r, c));
              cands.push({ r, c, k, foe: fi >= 0 ? 0 : 1, fi: fi >= 0 ? fi : 0, cls: tileClass(battle, r, c), d: Math.max(Math.abs(r - unit.tileR), Math.abs(c - unit.tileC)) });
            }
            cands.sort((a, b) => a.foe - b.foe || a.cls - b.cls || a.fi - b.fi || a.d - b.d || a.k - b.k);
            for (const t of cands.slice(0, n)) addFollower(battle, unit, t.r, t.c);
          },
          onEnd({ unit, reason }) {
            const w = unit.mem.wang;
            if (reason !== 'ammo' && w.ammo > 0) w.stock = Math.min(stockCap, w.stock + w.ammo);   // "剩余的弹药返还为棋子"
            w.ammo = 0;
          },
        },
      },
      talents: [
        // 铸子 (and the 棋子's own kit): her 棋子 pieces run the stone kit — set up here, before the battle starts
        { install(battle, unit) {
          unit.mem.wang = { stock: stock0, followers: [], seq: 0, ammo: 0 };
          for (const t of battle.allyUnits) {
            if (t.kind !== 'token' || t.defId !== STONE || t.ownerUnit !== unit || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t);
            battle._setupUnit(t, stoneKit(unit));
          }
        } },
        { install() {} },   // 料敌机先 — the pieces' stacks (kit install)
      ],
      install(battle, unit) {
        const sid = unit.skill?.id;
        const tok = battle.tokenDef(STONE, unit);
        const tbb = tok?.skill?.bb ?? {};
        const line = Math.max(0, Math.floor(num(tbb.tile_count, LINE_FALLBACK) / 2));
        const trigGrid = sid === S3 ? (tok?.skill?.rangeGrid ?? X6) : null;
        /** Trigger / damage tiles of a piece: its own tile, or S3's area around it. */
        const trigKeys = (n) => (trigGrid ? absoluteRangeKeys(trigGrid, n.r, n.c, 'RIGHT', 0) : [keyOf(n.r, n.c)].filter((k) => k >= 0));
        /** 连星's lines of a piece: its tile ± `line` along each side it was connected on. */
        const lineKeys = (n) => {
          const out = new Set();
          for (let k = -line; k <= line; k++) {
            if (n.h) { const x = keyOf(n.r, n.c + k); if (x >= 0) out.add(x); }
            if (n.v) { const x = keyOf(n.r + k, n.c); if (x >= 0) out.add(x); }
          }
          return [...out];
        };
        const hitOpts = (n) => ({ type: 'arts', isSkill: true, mul: 1 + per * n.stacks, resIgnoreFlat: pen * n.stacks, tags: ['skill', TAG] });
        /** A piece sets off: its effect (the picked skill's passive) on `foes` (the enemies of its trigger tiles). */
        const fire = (n, foes) => {
          const src = n.stone ?? unit;
          battle.fx('explode', { x: n.c, y: n.r, r: trigGrid ? 2 : 0.5, id: src.id, src: unit.id, dmgType: 'arts', skill: sid === S3 ? 'wang_3' : sid === S2 ? 'wang_2' : 'wang_1' });
          if (sid === S1) {
            const e = sortEnemyTargets(battle, src, foes.slice(), null)[0];
            if (!e) return;
            const dur = num(b1['attack@sluggish']);
            battle.applyStatus(e, 'sluggish', { duration: dur, source: unit });
            // precomputed by 望 at the trigger (her ATK and damage multipliers, the piece's stacks), dealt as 无来源
            const s = unit.s;
            const amount = s.atk * num(b1['attack@atk_scale']) * (1 + per * n.stacks) * s.dmgDealtMul * s.artsDealtMul;
            const rif = pen * n.stacks + s.resIgnoreFlat, rip = s.resIgnorePct;
            if (amount > 0 && dur > 0) {
              battle.addBuff(e, {
                key: DOT_KEY, refresh: 'independent', maxStacks: 999, duration: dur, interval: 1, source: unit, tags: ['skill', 'dot'],
                onTick: ({ unit: t }) => { if (t.alive) battle.dealDamage(unit, t, { amount, type: 'arts', canDodge: false, isSkill: true, sourceless: true, resIgnoreFlat: rif, resIgnorePct: rip, tags: ['skill', 'dot', DOT_KEY] }); },
              });
            }
            return;
          }
          const victims = sid === S2 ? battle.enemiesOnTiles(lineKeys(n), src, ANY) : foes;
          const scale = sid === S2 ? num(b2['attack@atk_scale']) : num(b3.atk_scale);
          for (const e of victims) {
            if (!e.alive) continue;
            battle.dealDamage(src, e, { amount: unit.s.atk * scale, ...hitOpts(n) });
            if (sid === S2 && e.alive) addSlow(battle, unit, e, num(b2['attack@move_speed']), num(b2['attack@duration']));
          }
        };
        /** The piece is spent: a 棋子 leaves the field (it comes back on its own), a 跟子 is gone. */
        const spend = (n) => {
          n.gone = true;
          if (n.stone) { if (n.stone.alive) battle.retreat(n.stone, { reason: 'expired', permanent: true }); return; }
          const w = unit.mem.wang;
          w.followers = w.followers.filter((f) => f !== n);
        };
        // "跟子所在格进行部署（或进行类似部署的行为）时，该跟子会随之消失" (PRTS 铸子 备注): any ally deploying on a 跟子's tile
        // (priority 50: before that piece's own 铸子 drop)
        battle.on('deploy', (ctx) => {
          const a = ctx.unit, w = unit.mem.wang;
          if (!a || a.side !== 'ally' || !w || !w.followers.length) return;
          const n0 = w.followers.length;
          w.followers = w.followers.filter((f) => f.r !== a.tileR || f.c !== a.tileC);
          if (w.followers.length !== n0) battle.fx('disappear', { x: a.tileC, y: a.tileR, id: unit.id });
        }, { owner: unit, priority: 50 });
        battle.on('tick', () => {
          if (!up(unit) || battle.finished) return;
          const nodes = piecesOf(battle, unit);
          if (!nodes.length) return;
          const at = new Map(nodes.map((n) => [keyOf(n.r, n.c), n]));
          for (const n of nodes) {    // 棋子相连时相互激活 (kept once active)
            for (const [dr, dc] of SIDES) {
              const k = keyOf(n.r + dr, n.c + dc);
              if (k < 0 || !at.has(k)) continue;
              n.act = true;
              if (dr) n.v = true; else n.h = true;
            }
          }
          if (per > 0 || pen > 0) {
            for (const n of nodes) {    // 料敌机先: one stack per piece of its unbroken line (≤ the cap)
              if (!n.act) continue;
              for (const [dr, dc] of [[0, 1], [1, 0]]) {
                let run = 1;   // (keyOf is −1 off the stage: never a piece)
                for (let k = 1; at.has(keyOf(n.r + dr * k, n.c + dc * k)); k++) run++;
                for (let k = 1; at.has(keyOf(n.r - dr * k, n.c - dc * k)); k++) run++;
                if (run >= 2) n.stacks = Math.max(n.stacks, Math.min(t2cap, run));
              }
            }
          }
          for (const n of nodes) {
            if (!n.act || n.gone) continue;
            const src = n.stone ?? unit;
            const foes = battle.enemiesOnTiles(trigKeys(n), src, ANY);
            if (!foes.length) continue;
            fire(n, foes);
            spend(n);
          }
        }, { owner: unit });
        // 阻回 while the stock is full (S1 / S2 备注)
        if (sid === S1 || sid === S2) {
          battle.on('tick', () => {
            const want = up(unit) && unit.mem.wang.stock >= stockCap;
            const has = unit.findBuff('wang:stockFull');
            if (want && !has) battle.addBuff(unit, { key: 'wang:stockFull', flags: { noSp: true }, tags: ['skill'] });
            else if (!want && has) battle.removeBuff(unit, 'wang:stockFull');
          }, { owner: unit });
        }
        // "干员离场后，附属的陷阱随之消失": her 棋子 leave (and come back with her), her 跟子 are gone
        battle.on('death', (ctx) => {
          if (ctx.unit !== unit || battle.finished) return;
          unit.mem.wang.followers = [];
          for (const a of battle.allyUnits) {
            if (a.kind === 'token' && a.defId === STONE && a.ownerUnit === unit && a.alive) battle.retreat(a, { reason: 'expired', permanent: true });
          }
        }, { owner: unit });
      },
    };
  },
};
