// server/sim/content/kits/tier3.js — hand-authored kits for the 21 tier-3 chess (19 visible + 见行者/巫恋 hidden).
//
// export default { [baseChessId]: (bb, chess, def) => Kit } (docs/SIM.md §7.2). `bb` is the skill blackboard at the
// chess's level (normal Lv4 `_a` / elite Lv7 `_b`), `chess` the data/chess.json record (talents incl. module upgrades,
// trait incl. module trait bb), `def` the normalised def. Every number comes from a blackboard; the few values that
// only exist in the text ("三连击", "至多5个", "初始两只", "至多3只") are parsed from the description with fallbacks.
// Profession defaults (server/sim/professions.js) are kept and extended: fastshot fly bonus, instructor, reaperrange,
// hunter ammo, funnel ramp, phalanx guard, merchant drain, tactician reinforcement, underminer module weaken.
// Summons: the match hands 伺夜's 狼群 and 巫恋's 诅咒娃娃 to the player as placeable board pieces (tokens.js kits);
// 伺夜's kit adopts his pack piece instead of adding a second pack, 巫恋's S2 brings her placed doll onto its tile
// (tokens.js releaseSkillSummon), and every summon tile avoids the home tile of an ally that has not (re)deployed yet
// (freeTile). Offensive skills whose own range differs from the attack
// range trigger on that skill range (CUSTOM_RANGE: 松果 shortened range, 见行者 push row — research 03 §1.4).
//
// Client VFX (battle.fx kinds used here, all `{x, y, id, …extra}`): 'aoe' (radius, dmgType), 'strike' (special single
// hit), 'volley' (multi-target shot), 'push', 'pull', 'summon' (token), 'coin' (n), 'dp' (n), 'revive', 'buff',
// 'shield', 'shieldBreak', 'camouflage', 'explode'.
//
// Operator loadouts (DESIGN §16): the kit is built for the SELECTED skill (`bb`, `chess.skill`, `def.skill`) and module
// (talents / trait bb). `skill` is the default skill's spec; `skills: { [skillId]: SkillSpec }` holds every other
// selectable skill of the visible chess, each built from its OWN record at the chess's level (skillData: Lv4 normal /
// Lv7 elite blackboard, range, charges) — the loader picks the selected one. Talents / trait / install are shared: the
// parts that belong to one skill only (琳琅诗怀雅 bombs, 菲莱 counters, 雪猎 special bullets…) check the selected skill id.
// Triggers come from the data record of each skill (skills[i].trigger: tools/build-data.mjs resolveTrigger — the official
// 技能策略 incl. SKILL_RANGE for a MANUAL skill's own 技能范围 and the class rows for every MANUAL skill), except
// 薄绿 S1 (the 阵法术师 row SEARCH = "在初始攻击范围内存在敌人时" ⇒ the engine's DEFAULT for a phalanx, checked every
// tick) and the kits' own automatic casts (雪猎 special bullets). Non-default modules: 能天使 MAR-Y (ASPD vs ground), 琳琅诗怀雅 MER-Y (ATK per payment),
// 斯卡蒂 DRE-X (× vs blocked), 瑕光 GUA-X (heal × under 50 %), 伺夜 TAC-Y (×165 % trait, pack-blocked enemies taunt +1),
// 空弦 MAR-X (fly ×, profession layer). No in-battle effect here: 忍冬 SOL-Y "首次部署时部署费用-4" (the initial
// deployment is free) and the 集成战略-only ISW-A modules of 琳琅诗怀雅 / 空弦 (their stats and trait cost still apply).

import { absoluteRangeKeys, sortEnemyTargets, canTargetEnemy } from '../../targeting.js';
import { COLS, PUSH_DIRECTIONAL_MIN_DIST } from '../../constants.js';
import { bodyDist, bodyInKeys, bodyOnTile } from '../../body.js';
import { normalizeChess, normalizeSkill } from '../../simdata.js';
import { tacticalPoint as sharedTacticalPoint, releaseSkillSummon } from '../tokens.js';

// ---------------------------------------------------------------------------------------------------------------
// helpers

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const defOf = (chess, def) => def ?? normalizeChess(chess);
const talentBb = (d, i) => d?.talents?.[i]?.bb ?? {};
const traitBb = (d) => d?.traitBb ?? {};
/** Module-only talent (data: `hidden && fromModule`, e.g. 空弦 精锐 "范围内存在地面敌人时攻击速度+8"). */
const moduleTalentBb = (chess) => (chess?.talents ?? []).find((t) => t && t.hidden && t.fromModule)?.bb ?? null;
/** Id of the SELECTED skill the kit is built for (DESIGN §16: `bb`, `chess.skill` and `def.skill` belong to it). */
const selectedId = (chess, d) => d?.skill?.id ?? chess?.skill?.skillId ?? null;
/**
 * Normalised record (simdata normalizeSkill shape: bb, rangeGrid, maxCharges, duration, description, trigger) of the
 * selectable skill `id` at this chess's level: the selected one is `def.skill` with the kit's `bb`, any other comes
 * from `chess.skills[]` (DATA §2.2) — every spec of `skills` is built from its own numbers whichever skill is selected.
 */
function skillData(chess, d, bb, id) {
  if (id != null && selectedId(chess, d) === id && d?.skill) return { ...d.skill, bb: bb ?? d.skill.bb ?? {} };
  const rec = (chess?.skills ?? []).find((s) => s && s.skillId === id);
  return (rec && normalizeSkill({ skill: rec })) || { id, bb: {}, rangeGrid: null, maxCharges: 1, duration: 0, description: '' };
}
/** `{ [skillId]: SkillSpec }` of the non-default selectable skills: `builders[id](skillData(id))` each. */
function altSkills(chess, d, bb, builders) {
  const out = {};
  for (const [id, build] of Object.entries(builders)) out[id] = build(skillData(chess, d, bb, id));
  return out;
}
/** instant, or charges when the skill stores several (可充能N次). */
const instantKindOf = (s) => ((s?.maxCharges ?? 1) > 1 ? 'charges' : 'instant');
/** Timed stat skill (迅捷打击 / 攻击力强化 / 防御力强化 …): bb atk / def / max_hp / attack_speed on the operator. */
const statSkill = (s) => {
  const b = s.bb || {};
  const mods = {};
  if (num(b.atk)) mods.atkPct = num(b.atk);
  if (num(b.def)) mods.defPct = num(b.def);
  if (num(b.max_hp)) mods.hpPct = num(b.max_hp);
  if (num(b.attack_speed)) mods.aspd = num(b.attack_speed);
  return { kind: 'duration', mods };
};
/** The unit's own profile damage multiplier on `target` (fastshot fly bonus …) for damage a kit deals itself. */
function profileMul(battle, unit, target) {
  const f = unit.profile?.dmgMul;
  const m = typeof f === 'function' ? f(battle, unit, target) : f;
  return typeof m === 'number' && Number.isFinite(m) ? m : 1;
}
/** Targetable enemies within `r` tiles of (x, y), nearest first (spawn order breaks ties), excluding `skip`. */
function enemiesAround(battle, unit, x, y, r, skip = null) {
  const out = battle.foesInRadius(x, y, r).filter((e) => !(skip && skip.has(e)) && canTargetEnemy(unit, e, { canHitFly: true }));
  const d = (e) => bodyDist(e, x, y);
  return out.sort((a, b) => d(a) - d(b) || (a.spawnSeq ?? a.id) - (b.spawnSeq ?? b.id));
}
/**
 * "范围内存在地面敌人时攻击速度+N" (能天使 MAR-Y trait, 空弦 MAR-Y talent): ASPD buff `key` while at least `cnt` ground
 * enemies stand in the current range.
 */
function groundAspd(key, aspd, cnt = 1) {
  return (battle, unit) => {
    let on = false;
    battle.every(0.1, () => {
      const n = alive(unit) ? battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).filter((e) => !e.isFlying).length : 0;
      const want = n >= Math.max(1, cnt);
      if (want === on && (!want || unit.findBuff(key))) return;
      on = want;
      if (want) battle.addBuff(unit, { key, mods: { aspd } });
      else battle.removeBuff(unit, key);
    }, { owner: unit });
  };
}
/** 周围 (around a target) for 空弦's scatter / bounce arrows [ASSUMED radius, tiles: not in the data]. */
const AROUND_R = 1.5;
const alive = (u) => !!(u && u.alive && u.deployed);
const tileKeyOf = (u) => (u.side === 'ally' ? u.tileR * COLS + u.tileC : Math.round(u.y) * COLS + Math.round(u.x));
/** On a tile of `set`: an ally by its tile, an enemy by its body (every tile a huge enemy occupies — sim/body.js). */
const onTiles = (x, set) => (x.side === 'ally' ? set.has(tileKeyOf(x)) : bodyInKeys(x, set));
const gridKeys = (grid, u, ext = 0) => absoluteRangeKeys(grid || [[0, 0]], u.tileR, u.tileC, u.dir, ext);
const fx = (battle, kind, u, extra = {}) => battle.fx(kind, { x: u.x, y: u.y, id: u.id, ...extra });
const copyGrid = (g) => (Array.isArray(g) && g.length ? g.map((p) => [p[0], p[1]]) : null);
const NINE = [[1, -1], [1, 0], [1, 1], [0, -1], [0, 0], [0, 1], [-1, -1], [-1, 0], [-1, 1]];
/** 琳琅诗怀雅 S3's coin range (PRTS 备注 "前方范围2-4"; range_table "2-4", facing right). */
const SWIRE2_COIN_GRID = Object.freeze([[1, 1], [0, 0], [0, 1], [0, 2], [-1, 1]]);
/** Two enemy bodies touch within this distance (tiles) — 见行者 collision stun. */
const COLLIDE = 0.6;
/** 忍冬 S3's 迷彩 (until her next cast): its own buff key, never merged with another unit status. */
const CAMOU_KEY = 'vulpis:camou';
const CN_NUM = { 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
/** Number captured by `re` (arabic or a single chinese numeral) in `text`, else `fallback`. */
function textNum(text, re, fallback) {
  const m = String(text ?? '').match(re);
  if (!m) return fallback;
  return /^\d+(\.\d+)?$/.test(m[1]) ? +m[1] : (CN_NUM[m[1]] ?? fallback);
}
/**
 * A tile a summon may take: inside the field and not reserved (Battle.isReservedTile: nobody on it, no knocked-out
 * operator lying there, not the home tile of an ally that has not deployed yet / waits to redeploy — the initial
 * deployment runs one unit after another: a summon placed while it runs must not steal a later board unit's tile).
 */
function freeTile(battle, r, c) {
  return Number.isInteger(r) && Number.isInteger(c) && battle.grid.inRect(r, c) && !battle.isReservedTile(r, c);
}
/** Walkable ground tile a melee summon can stand on. */
const groundTile = (battle, r, c) => battle.grid.groundPassable(r, c) && battle.grid.canStand(r, c);
/**
 * Tactical point (战术点) of a tactician: `prefer` (the board piece's tile, i.e. the player's choice) when usable —
 * free, standable ground (never 深水区: grid.canStand) inside her initial range ("只能部署在召唤者攻击范围内"; the prep
 * already keeps the piece there, PlayerState._legal) —, else the shared tactical point (tokens.js tacticalPoint =
 * Battle.findTacticalPoint: a free walkable tile of its initial range on an enemy ground path first, then the nearest).
 */
function tacticalPoint(battle, unit, prefer = null) {
  const inRange = (r, c) => (unit.baseRangeKeys || unit.rangeKeys || []).includes(r * COLS + c);
  if (prefer && freeTile(battle, prefer[0], prefer[1]) && groundTile(battle, prefer[0], prefer[1]) && inRange(prefer[0], prefer[1])) return prefer;
  return sharedTacticalPoint(battle, unit);
}
/** Tokens `tokenId` summoned by / placed for `owner` (board pieces included). */
const tokensOf = (battle, owner, tokenId) => battle.allyUnits.filter((t) => t.kind === 'token' && t.defId === tokenId && t.ownerUnit === owner && !t.mem.isClone);

/** Non-elite, non-leader enemy (海霓 "非精英和领袖敌人"). */
const isNormalEnemy = (e) => !e.isBoss && String(e.def?.rank ?? 'NORMAL').toUpperCase() === 'NORMAL';
/** Abyssal Hunters (character_table groupId `abyssal`, not in data/chess.json): 深海掠食者 targets. */
const ABYSSAL = new Set(['char_263_skadi', 'char_143_ghost', 'char_218_cuttle', 'char_474_glady', 'char_1023_ghost2', 'char_4145_ulpia']);

/** Targetable enemies on `keys`, sorted by the unit's priority (at most `n` when n > 0). */
function enemiesOn(battle, unit, keys, n = 0, profile = null) {
  const list = battle.enemiesInKeys(keys, unit, profile ?? { canHitFly: true });
  sortEnemyTargets(battle, unit, list, (profile ?? unit.profile)?.priority ?? null);
  return n > 0 && list.length > n ? list.slice(0, n) : list;
}

/**
 * Tile aura: every `interval` s (0 ⇒ call the returned update() yourself, e.g. from a skill onTick) buffs the
 * units of `side` standing on `tiles()` (filter/mods per unit, mods null ⇒ skipped) and drops the buff from units
 * that left. update.clear() removes everything this aura applied. Same-key auras of several sources do not stack.
 */
function aura(battle, unit, o) {
  let cur = new Set();
  const iv = o.interval ?? 0.2;
  const dur = Math.max(iv * 2, 0.1) + 0.05;
  const drop = (x) => { const b = x.findBuff(o.key); if (b && b.source === unit) battle.removeBuff(x, b); };
  const update = () => {
    const next = new Set();
    if (alive(unit) && (!o.active || o.active())) {
      const keys = o.tiles();
      const set = keys instanceof Set ? keys : new Set(keys || []);
      const list = o.side === 'ally' ? battle.allyUnits : battle.enemies;
      for (const x of list) {
        if (!x.alive || !x.deployed || x.hidden || x.kind === 'device') continue;
        if (o.side === 'ally' && !battle.allySelectable(x, unit)) continue; // never a 孤立 unit (炎佑)
        if (!onTiles(x, set) || (o.filter && !o.filter(x))) continue;
        const mods = typeof o.mods === 'function' ? o.mods(x) : o.mods;
        if (!mods) continue;
        battle.addBuff(x, { key: o.key, duration: dur, refresh: 'extend', mods, source: unit, tags: ['aura'] });
        next.add(x);
      }
    }
    for (const x of cur) if (!next.has(x)) drop(x);
    cur = next;
  };
  update.clear = () => { for (const x of cur) drop(x); cur = new Set(); };
  // immediate: installed at construction ⇒ first runs right after the initial deployment (t = 0), not 1 interval later
  if (iv > 0) battle.every(iv, update, { owner: unit, immediate: true });
  return update;
}

/** Buff present exactly while `cond()` holds (checked every tick). */
function whileTrue(battle, unit, key, cond, mods) {
  battle.on('tick', () => {
    const on = alive(unit) && cond();
    const has = !!unit.findBuff(key);
    if (on && !has) battle.addBuff(unit, { key, mods: typeof mods === 'function' ? mods() : mods });
    else if (!on && has) battle.removeBuff(unit, key);
  }, { owner: unit });
}

/** Team-wide talents never stack: only the lowest-id living carrier of `tag` of this player applies them. */
function isLeader(battle, unit, tag) {
  let best = null;
  for (const a of battle.allyUnits) if (alive(a) && a.ownerId === unit.ownerId && a.mem[tag] && (!best || a.id < best.id)) best = a;
  return best === unit;
}

/** SP gain that respects "no SP while a timed skill runs". */
function giveSp(u, n, reason = 'talent') {
  const sk = u?.skill;
  if (!sk || sk.noSkill || !(n > 0) || (sk.active && sk.isTimed)) return 0;
  return sk.gainSp(n, reason);
}

/**
 * Funnel ramp tracked per target (耶拉's 2 drones each ramp on their own lock; 1 drone = profession behaviour). Two
 * drones locked on the same enemy land in the same tick: they ramp in parallel (one step per volley, same scale).
 */
function funnelMap(battle, unit, target) {
  const f = unit.profile.funnel || { init: 0.2, delta: 0.15, max: 1.1 };
  const m = unit.trait.funnelMap || (unit.trait.funnelMap = new Map());
  const prev = m.get(target.id);
  if (prev && prev.t === battle.time) return prev.s;
  const s = prev == null ? f.init : Math.min(f.max, prev.s + f.delta);
  m.set(target.id, { s, t: battle.time });
  return s;
}
/** Drones return when their lock is dropped: forget ramps of enemies no longer attacked. */
function installFunnelPrune(battle, unit) {
  battle.on('beforeAttack', (ctx) => {
    if (ctx.attacker !== unit || !unit.trait.funnelMap) return;
    const ids = new Set(ctx.targets.map((t) => t.id));
    for (const k of [...unit.trait.funnelMap.keys()]) if (!ids.has(k)) unit.trait.funnelMap.delete(k);
  }, { owner: unit, priority: -100 });
}

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

// ---------------------------------------------------------------------------------------------------------------
// kits

const KITS = {
  // ---- 3_01 能天使 · 速射手 — S3 过载模式: 5 连射 + 攻击间隔缩短; 快速弹匣 ASPD; 天使的祝福 (self + one random ally)
  //      S1 冲锋模式: next attack = 3 shots × atk_scale; S2 扫射模式: 4 shots × attack@atk_scale per attack for 15 s;
  //      精锐 module MAR-Y: ASPD + while a ground enemy is in range (MAR-X fly × = profession layer)
  chess_char_3_01_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const bless = { atkPct: num(t1.atk), hpPct: num(t1.max_hp) };
    const shots = (v) => Math.max(1, Math.floor(num(v, 1)));
    const kit = {
      skill: {
        kind: 'duration',
        mods: { batPct: num(bb.base_attack_time) },
        attack: { atkScale: num(bb['attack@atk_scale'], 1), hits: Math.max(1, Math.floor(num(bb['attack@times'], 1))) },
      },
      skills: altSkills(chess, d, bb, {
        skchr_angel_1: (s) => ({ kind: instantKindOf(s), attack: { atkScale: num(s.bb.atk_scale, 1), hits: shots(s.bb.times) } }),
        skchr_angel_2: (s) => ({ kind: 'duration', attack: { atkScale: num(s.bb['attack@atk_scale'], 1), hits: shots(s.bb['attack@times']) } }),
      }),
      talents: [
        { install(battle, unit) { battle.addBuff(unit, { key: 'talent:angel_mag', mods: { aspd: num(t0.attack_speed) }, persist: true, allowDead: true }); } },
        { install(battle, unit) {
          battle.addBuff(unit, { key: 'talent:angel_bless', mods: { ...bless }, persist: true, allowDead: true });
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            // after the whole board is deployed (the initial deployment goes one unit after another)
            battle.after(0, () => {
              if (!alive(unit)) return;
              const cands = battle.allies(unit.ownerId).filter((a) => a !== unit && a.kind === 'op' && !a.findBuff('talent:angel_bless_ally'));
              const pick = battle.rng.pick(cands);
              if (!pick) return;
              battle.addBuff(pick, { key: 'talent:angel_bless_ally', mods: { ...bless }, persist: true, source: unit, visible: true });
              fx(battle, 'buff', pick, { src: unit.id, talent: 'angel_bless' });
            }, { owner: unit });
          }, { owner: unit });
        } },
      ],
    };
    // MAR-Y trait "范围内存在地面敌人时攻击速度+8" (bb attack_speed, cnt = ground enemies needed)
    if (num(tb.attack_speed) > 0) kit.install = groundAspd('trait:angel_ground', num(tb.attack_speed), Math.floor(num(tb.cnt, 1)));
    return kit;
  },

  // ---- 3_02 断崖 · 领主 — S2 浮游刃启动: arts, wider range, each attack hits every enemy blocked by allies around her
  chess_char_3_02_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const tGrid = copyGrid(d.talents?.[0]?.rangeGrid) ?? NINE;
    const extra = num(bb.atk_scale, 1);
    const moduleArts = num(tb.atk_scale_m, 0);
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const kit = {
      skill: {
        kind: 'duration',
        attack: { dmgType: 'arts', atkScale: num(bb['attack@atk_scale'], 1) },
        onAttack({ battle, unit }) {
          // "周围8格友方单位阻挡的所有敌人": the 8 tiles around her (her own tile is not one of them — the talent
          // says "自身与周围8格" when it means both)
          const seen = new Set();
          for (const a of battle.allyUnits) {
            if (a === unit || !alive(a) || a.kind === 'device' || !a.blocking.length) continue;
            if (Math.abs(a.tileR - unit.tileR) > 1 || Math.abs(a.tileC - unit.tileC) > 1) continue;
            for (const e of a.blocking) {
              if (!e.alive || seen.has(e)) continue;
              seen.add(e);
              battle.dealDamage(unit, e, { amount: unit.s.atk * extra, type: 'arts', isSkill: true, tags: ['skill', 'melee', 'ayerBlade'] });
              fx(battle, 'strike', e, { src: unit.id, skill: 'ayer_2' });
            }
          }
        },
      },
      // S1 多导向散射弹丸: next attack hits up to max_target enemies in range for atk_scale arts + 停顿
      skills: altSkills(chess, d, bb, {
        skchr_ayer_1: (s) => {
          const slug = num(s.bb.sluggish, 0);
          return {
            kind: instantKindOf(s),
            targeting: { maxTargets: Math.max(1, Math.floor(num(s.bb.max_target, 1))) },
            attack: {
              dmgType: 'arts', atkScale: num(s.bb.atk_scale, 1),
              onEachHit({ battle, unit, target }) {
                if (slug > 0 && target && target.alive && target.side === 'enemy') battle.applyStatus(target, 'sluggish', { duration: slug, source: unit });
              },
            },
          };
        },
      }),
      talents: [{ install(battle, unit) {
        aura(battle, unit, { key: 'talent:ayer_aspd', side: 'ally', tiles: () => gridKeys(tGrid, unit), filter: (a) => a.kind === 'op', mods: { aspd: num(t0.attack_speed) } });
      } }],
    };
    if (skillGrid) kit.skill.targeting = { rangeGrid: skillGrid };
    // 精锐 module LOR-X: "攻击附带10%攻击力的法术伤害"
    if (moduleArts > 0) {
      kit.trait = { afterHit: (battle, unit, target) => {
        if (target && target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * moduleArts, type: 'arts', tags: ['module'] });
      } };
    }
    return kit;
  },

  // ---- 3_03 诗怀雅 · 教官 — S2 协同作战: ATK +, first talent ×talent_scale; 近距离作战指导 melee ATK aura
  //      S1 指挥调度: the talent covers the skill's range (x-1 normal / x-2 elite) at ×talent_scale while it runs
  chess_char_3_03_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tGrid = copyGrid(d.talents?.[0]?.rangeGrid) ?? NINE;
    const scale = num(bb.talent_scale, 1);
    // "第一天赋生效范围扩大" (talent_range_flag): the selected skill's range replaces the talent's while it is active
    const skillTGrid = num(bb.talent_range_flag) > 0 ? copyGrid(d.skill?.rangeGrid) : null;
    const refresh = ({ unit }) => unit.mem.swireAura?.();
    return {
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        onStart: refresh,
        onEnd: refresh,
      },
      skills: altSkills(chess, d, bb, {
        skchr_swire_1: () => ({ kind: 'duration', onStart: refresh, onEnd: refresh }),
      }),
      talents: [{ install(battle, unit) {
        unit.mem.swireAura = aura(battle, unit, {
          key: 'talent:swire_guide', side: 'ally', tiles: () => gridKeys(skillTGrid && unit.skill?.active ? skillTGrid : tGrid, unit),
          filter: (a) => String(a.def?.position ?? 'MELEE').toUpperCase() === 'MELEE',
          mods: () => ({ atkPct: num(t0.atk) * (unit.skill?.active ? scale : 1) }),
        });
      } }],
    };
  },

  // ---- 3_04 琳琅诗怀雅 · 行商 — S2 “见面礼” (passive): each attack spends a coin to drop a champagne bomb in range;
  //      大买家: coin at skill start + coin & ATK stack per trait payment; 破财消灾: DP-paid revive (cost doubles)
  //      S1 仗义疏财 (passive, 2 coins): a coin heals the most injured ally (< 70 % HP) of the 8 surrounding tiles for
  //      attack@heal_scale × ATK — on her attack, or with no enemy to attack on her own attack timer (owner's decision
  //      2026-10-04, against the official 「下一次攻击会为…」; installS1). S3 千金一掷 (持续时间无限): attacks hit twice, kills give a coin;
  //      closing it spends every coin on random ground enemies of range 2-4 in front and those she blocks (atk_scale phys +
  //      a small push, radial despite the text's 向前 — PRTS 备注 "推开效果为径向推动"; client charpack char_1033_swire2:
  //      the RandomGold ability (Skill_3_End) carries swire2_s_3[knockback] of template knockback[relative]; 地面敌方单位,
  //      弹道不可对空). It does not close itself when the purse is full (PRTS 卫戍协议/帮助 「通常不会自动关闭技能」; the skill
  //      text is 「可随时主动关闭」). Owner 2026-10-04: at the cap (金币上限为10) she shoots once an enemy is in the skill's
  //      attack range (the 1-tile range, not the coin-mark 2-4 grid). Below the cap, or with nobody there, it stays open.
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
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const addCoins = (battle, unit, n) => {
      const before = unit.mem.coins ?? 0;
      unit.mem.coins = Math.min(coinMax, before + n);
      if (unit.mem.coins > before) fx(battle, 'coin', unit, { n: unit.mem.coins });
    };
    const bombKit = (owner, switchT) => ({
      skill: null,
      trait: { noAttack: true },
      install(battle, bomb) {
        battle.on('tick', () => {
          if (!bomb.alive || !bomb.deployed) return;
          for (const e of battle.enemies) {
            if (!e.alive || e.hidden || e.isFlying || e.s.flags.untargetable) continue;
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
     * she attacks or not. Same target (the lowest HP ratio below 70 % of the 8 surrounding tiles, no 禁疗 / 孤立 unit, no
     * device), coin and heal_scale × ATK. Cadence [ASSUMED]: at most one heal per attack cycle (her attack interval, ASPD
     * included) — while she attacks, on the attack as before; when her last attack attempt found no target, on her own
     * timer (the 'tick' hook runs after the attacks, so an attack due in the same tick takes it).
     */
    const installS1 = (battle, unit) => {
      const hs = num(bb['attack@heal_scale'], num(bb.heal_scale, 0));
      let nextAt = -Infinity;
      const healTarget = () => {
        let best = null;
        for (const a of battle.allyUnits) {
          if (a === unit || !alive(a) || a.hidden || a.kind === 'device' || a.hpRatio >= healRatio) continue;
          if (a.s.flags.noHeal || a.profile?.noHeal) continue; // 禁疗 / 孤立: never a heal target
          if (Math.max(Math.abs(a.tileR - unit.tileR), Math.abs(a.tileC - unit.tileC)) !== 1) continue; // 周围八格
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
    const installS3 = (battle, unit) => { // 千金一掷: "击倒敌人时获得一枚金币"
      battle.on('kill', (ctx) => {
        if (ctx.killer === unit && ctx.victim.side === 'enemy' && unit.skill?.active) addCoins(battle, unit, 1);
      }, { owner: unit });
    };
    return {
      skill: { kind: 'passive' },
      skills: altSkills(chess, d, bb, {
        [S1]: () => ({ kind: 'passive' }), // (coins → heals: installS1)
        [S3]: (s) => {
          const cash = num(s.bb.atk_scale, 1), force = num(s.bb.force, 0);
          // the 【金币标记】 targets: ground enemies on range 2-4 in front of her (range_table "2-4") and every unit she blocks
          const coinMarks = (battle, unit) => {
            const list = enemiesOn(battle, unit, gridKeys(SWIRE2_COIN_GRID, unit), 0, { ...unit.profile, canHitFly: false });
            for (const e of unit.blocking || []) if (e.alive && !e.isFlying && !list.includes(e)) list.push(e);
            return list;
          };
          const purseCap = Math.max(1, Math.floor(num(s.bb.sp, 10)));
          return {
            kind: 'toggle',
            attack: { hits: 2 },
            // Owner 2026-10-04: at the cap, shoot once a ground enemy is in the skill attack range (data rangeGrid,
            // the same 1-tile range as her attack). The coin marks (前方 2-4) are who the burst pays, not the trigger.
            // Nobody in that range: stay open and keep the coins. Below the cap: stay open.
            onTick({ battle, unit, skill }) {
              if (!skill.active || (unit.mem.coins ?? 0) + 1e-9 < purseCap) return;
              const keys = gridKeys(skillGrid ?? unit.rangeGrid, unit);
              if (enemiesOn(battle, unit, keys, 0, { ...unit.profile, canHitFly: false }).length) skill.end('manual');
            },
            onEnd({ battle, unit, reason }) {
              if (reason !== 'manual' || !unit.alive) return;
              const n = unit.mem.coins ?? 0;
              unit.mem.coins = 0;
              let spent = 0;
              // PRTS 备注: closing it "立即对前方范围2-4内的地面敌方单位与自身阻挡的所有单位施加【金币标记】", the coins going to
              // marked units at random — 弹道（不可对空）: air units (FLY, 近地悬浮, 浮空) are never paid. Until 0.1.1 the
              // coins went to her attack range (1-1) instead of range 2-4.
              const marked = coinMarks(battle, unit);
              for (let i = 0; i < n; i++) {
                const e = battle.rng.pick(marked.filter((x) => x.alive && !x.isFlying));
                if (!e) break;
                spent++;
                battle.dealDamage(unit, e, { amount: unit.s.atk * cash, type: 'phys', isSkill: true, tags: ['skill', 'swire2Cash'] });
                // "将目标小力地向前推开" — PRTS 备注 "金币弹道…推开效果为径向推动", client knockback[relative]: a radial push
                // away from her centre (not along her direction, so no 45° / 0.25-tile 特殊修正), official 力度 − 重量
                // distance (Battle.push)
                if (e.alive) battle.push(e, force, { from: unit });
              }
              fx(battle, 'coin', unit, { n: 0, spent, skill: 'swire2_3' });
            },
          };
        },
      }),
      trait: { install: merchantInstall((battle, unit) => {
        // MER-Y "每次特性消耗费用时攻击力+4%，最多可以叠加5次" (any time, not only during the skill)
        if (modTal && num(modTal.atk) > 0) {
          battle.addBuff(unit, { key: 'trait:swire2_module', refresh: 'stack', stacks: 1, maxStacks: Math.max(1, num(modTal.max_stack_cnt, 5)), mods: { atkPct: num(modTal.atk) } });
        }
        if (!unit.skill?.active) return; // "技能期间"
        addCoins(battle, unit, num(t0.trait_sp, 1));
        battle.addBuff(unit, { key: 'talent:swire2_buyer', refresh: 'stack', stacks: 1, maxStacks: Math.max(1, num(t0.max_stack_cnt, 8)), mods: { atkPct: num(t0.atk) } });
      }) },
      install(battle, unit) {
        if (sel === S1) { installS1(battle, unit); return; }
        if (sel === S3) { installS3(battle, unit); return; }
        if (sel !== S2 && sel != null) return;
        const switchT = num(battle.tokenDef(tokenId, unit)?.skill?.bb?.duration_switch, 3);
        battle.on('attack', (ctx) => {
          if (ctx.attacker !== unit || !alive(unit) || (unit.mem.coins ?? 0) < coinCost) return;
          const tiles = [];
          for (const k of gridKeys(skillGrid ?? unit.rangeGrid, unit)) {
            const r = (k / COLS) | 0, c = k % COLS;
            // (never on the home tile of a dead operator: it could not redeploy until an enemy triggers the bomb)
            if (freeTile(battle, r, c) && groundTile(battle, r, c)) tiles.push([r, c]);
          }
          const tile = battle.rng.pick(tiles);
          if (!tile) return;
          const bomb = battle.spawnToken(unit, tokenId, tile[0], tile[1], { untargetable: true, kit: bombKit(unit, switchT) });
          if (!bomb) return;
          unit.mem.coins -= coinCost;
          fx(battle, 'summon', bomb, { src: unit.id, token: tokenId, coins: unit.mem.coins });
        }, { owner: unit, priority: -10 });
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
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented) return;
            const n = unit.mem.saveCount ?? 0;
            const cost = Math.abs(num(t1.cost, -5)) * Math.pow(num(t1.cost_multi, 2), n);
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

  // ---- 3_05 斯卡蒂 · 无畏者 — S3 涌潮悲歌: ATK/DEF/HP +; 深海掠食者 (Abyssal Hunters ATK); 迅捷出击 (redeploy −10 s)
  //      精锐 module DRE-Y: once per deployment, a lethal hit instead restores full HP with max HP −60 % and ASPD +30
  //      S1 迅捷打击·γ型: ATK/ASPD +; S2 跃浪击 (passive): ATK + for `duration` s after every deployment;
  //      精锐 module DRE-X: ×atk_scale on blocked enemies
  chess_char_3_05_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const kit = {
      skill: { kind: 'duration', mods: { atkPct: num(bb.atk), defPct: num(bb.def), hpPct: num(bb.max_hp) } },
      skills: altSkills(chess, d, bb, {
        'skcom_quickattack[3]': statSkill,
        skchr_skadi_2: (s) => ({
          kind: 'duration', activateOnDeploy: true, duration: num(s.bb.duration, 20), spCost: 0, spType: 'none', trigger: 'NEVER',
          mods: { atkPct: num(s.bb.atk) },
        }),
      }),
      talents: [
        { install(battle, unit) { // "编入队伍时": every Abyssal Hunter of this player, for the whole battle
          for (const a of battle.allyUnits) {
            if (a.kind === 'op' && a.ownerId === unit.ownerId && ABYSSAL.has(a.def?.charId)) {
              battle.addBuff(a, { key: 'talent:skadi_predator', mods: { atkPct: num(t0.atk) }, persist: true, allowDead: true, source: unit });
            }
          }
        } },
        { install(battle, unit) {
          if (unit.mem.skadiSwift) return; // base stats are per unit; never apply twice
          unit.mem.skadiSwift = true;
          unit.base.respawnTime = Math.max(0, unit.base.respawnTime + num(t1.respawn_time));
        } },
      ],
    };
    if (tb.value != null || tb.hp_ratio != null) {
      kit.install = (battle, unit) => {
        battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.mem.tideUsed = false; }, { owner: unit });
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== unit || ctx.prevented || unit.mem.tideUsed) return;
          unit.mem.tideUsed = true;
          ctx.prevented = true;
          const hpMul = tb.value != null ? 1 - num(tb.value) : num(tb.max_hp, 0.4);
          battle.addBuff(unit, { key: 'trait:skadi_tide', mods: { hpMul: Math.max(0.05, hpMul), aspd: num(tb.attack_speed) }, visible: true });
          unit.hp = Math.max(1, unit.s.maxHp * num(tb.hp_ratio, 1));
          fx(battle, 'revive', unit, { module: true });
        }, { owner: unit, priority: -50 });
      };
    }
    // DRE-X "攻击被阻挡的敌人时攻击力提升至115%" (blocked by anyone)
    if (num(tb.atk_scale) > 0) kit.trait = { dmgMul: (battle, unit, target) => (target && target.blockedBy ? num(tb.atk_scale, 1) : 1) };
    return kit;
  },

  // ---- 3_06 菲莱 · 本源铁卫 — S2 冥河诅咒: stops attacking, HP +; when attacked blasts the ground enemies of the 3×3
  //      around her (PRTS 备注: range x-4; arts + ep_damage_ratio × ATK apoptosis, aoe_cd); ATK + once hit by element
  //      damage; 神河谕使: 元素损伤 taken −damage_resistance, +SP on apoptosis
  //      精锐 module PRP-X "阻挡敌人时，自身造成的元素损伤提升15%": EVERY element fill she deals (the S2 blast, a 灼燃维式重锤
  //      she carries …) ×ep_damage_scale while she blocks — an `elementHit` multiplier, like 余's
  //      S1 灵河护佑 (TAKE_DAMAGE): HP +, clears her element gauges and gives a shield_value 损伤屏障 (absorbs element
  //      damage — gauge fills — until spent or the skill ends)
  // 神河谕使 and the barrier act on the element hit before it lands (PRTS 备注: "减伤与技力回复效果于伤害计算前处理；即使
  // 受到0点的凋亡损伤依然可以回复技力", "损伤屏障于伤害计算前、第一天赋后处理"): the talent's cut and SP first (priority 20),
  // then the barrier absorbs what is left (`dmg.amount × dmg.mul`). The cut is a 元素损伤 multiplier (PRTS 元素 "受到的
  // 元素损伤 = 损伤值 × (1 − 损伤抵抗 × 0.01)，后续可应用元素损伤倍率提升/降低等效果"), not `elemTakenMul` (元素伤害 / 元素脆弱).
  chess_char_3_06_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const sel = selectedId(chess, d);
    const S1 = 'skchr_philae_1', S2 = 'skchr_philae_2';
    const isS2 = sel === S2 || sel == null;
    const scale = num(bb.atk_scale, 1);
    const ep = num(bb.ep_damage_ratio, 0);
    const cd = num(bb.aoe_cd, 2);
    const epScale = num(tb.ep_damage_scale, 1);
    const cut = Math.max(0, Math.min(1, num(t0.damage_resistance)));
    // 损伤屏障 of S1: absorbs the gauge gain an element hit would add (after 神河谕使)
    const installBarrier = (battle, unit) => {
      battle.on('elementHit', (ctx) => {
        if (ctx.target !== unit || !(unit.mem.philaeBarrier > 0) || !unit.skill?.active) return;
        const dmg = ctx.dmg;
        const eff = num(dmg.amount) * num(dmg.mul, 1);
        if (!(eff > 0)) return;
        const take = Math.min(unit.mem.philaeBarrier, eff);
        unit.mem.philaeBarrier -= take;
        if (take >= eff - 1e-9) dmg.cancel = true;
        else dmg.amount *= (eff - take) / eff;
        if (!(unit.mem.philaeBarrier > 0)) fx(battle, 'shieldBreak', unit, { element: true });
      }, { owner: unit });
    };
    return {
      skill: {
        kind: 'duration',
        mods: { hpPct: num(bb.max_hp) },
        attack: { noAttack: true },
        onStart({ unit }) { unit.mem.philaeCd = -Infinity; },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'skill:philae_rage'); },
      },
      skills: altSkills(chess, d, bb, {
        [S1]: (s) => ({
          kind: 'duration',
          mods: { hpPct: num(s.bb.max_hp) },
          onStart({ battle, unit }) {
            battle.reduceElement(unit, 1e12); // "立刻清除自身的元素损伤" (a gauge locked by a running burst stays)
            unit.mem.philaeBarrier = num(s.bb.shield_value, 0);
            fx(battle, 'shield', unit, { element: true, n: unit.mem.philaeBarrier });
          },
          onEnd({ unit }) { unit.mem.philaeBarrier = 0; },
        }),
      }),
      talents: [{ install(battle, unit) {
        // 神河谕使 (every skill): 元素损伤 taken ×(1 − damage_resistance); "受到凋亡损伤时回复2点技力" — even for 0 damage
        battle.on('elementHit', (ctx) => {
          const dmg = ctx.dmg;
          if (ctx.target !== unit || !dmg || dmg.type !== 'element') return;
          if (dmg.element === 'apoptosis' && !unit.skill?.active) giveSp(unit, num(t0.sp), 'talent');
          if (cut > 0) dmg.mul *= 1 - cut;
        }, { owner: unit, priority: 20 });
      } }],
      install(battle, unit) {
        if (sel === S1) installBarrier(battle, unit);
        // module PRP-X: her element damage ×ep_damage_scale while she blocks
        if (epScale > 1) {
          battle.on('elementHit', (ctx) => {
            if (ctx.source === unit && ctx.dmg?.type === 'element' && ctx.target?.side === 'enemy' && unit.blocking.length) ctx.dmg.mul *= epScale;
          }, { owner: unit });
        }
        battle.on('damaged', (ctx) => {
          if (ctx.target !== unit || !unit.alive) return;
          const sk = unit.skill;
          if (ctx.type === 'element') {
            if (isS2 && sk && sk.active && !unit.findBuff('skill:philae_rage')) battle.addBuff(unit, { key: 'skill:philae_rage', mods: { atkPct: num(bb.atk) }, visible: true });
            return;
          }
          if (!isS2 || !sk || !sk.active || !ctx.dmg?.isAttack || !ctx.source || ctx.source.side !== 'enemy') return;
          if (battle.time < (unit.mem.philaeCd ?? -Infinity)) return;
          unit.mem.philaeCd = battle.time + cd;
          // "周围的地面敌人" = range x-4, the 3×3 tiles around her (PRTS 备注)
          for (const e of battle.unitsInGrid(unit, NINE, { side: 'enemy' })) {
            if (e.isFlying) continue;
            battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'arts', canDodge: false, isSkill: true, tags: ['skill', 'counter'] });
            if (ep > 0 && e.alive) battle.dealDamage(unit, e, { type: 'element', element: 'apoptosis', amount: unit.s.atk * ep, tags: ['skill'] });
          }
          fx(battle, 'aoe', unit, { radius: 1.5, tiles: 'box', dmgType: 'arts', skill: 'philae_2' }); // box: the 3×3 tiles
        }, { owner: unit });
      },
    };
  },

  // ---- 3_07 见行者 · 推击手 (hidden) — S2 惊爆射击: push every enemy in the skill range forward + stun (longer when
  //      slammed into a wall, collided enemies stunned too; air units too [ASSUMED: "范围内所有敌人", no 对空 note on
  //      PRTS] — a 失衡免疫 enemy or a 静态刚体 (the drones) is not pushed but still stunned); 技巧射击: ignore DEF vs heavy enemies;
  //      精锐 module PUS-X: redeployed on a ranged tile ⇒ half the deployment cost back
  chess_char_3_07_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const force = num(bb.force, 1);
    const sDirect = num(bb['forcer_s_2[hit_directly].stun'], num(bb.stun, 1));
    const sWall = num(bb.stun, sDirect);
    const sBrush = num(bb['forcer_s_2[brush].stun'], sDirect);
    const kit = {
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const keys = new Set(gridKeys(skillGrid ?? unit.rangeGrid, unit));
          const victims = battle.enemies.filter((e) => e.alive && !e.hidden && !e.s.flags.untargetable && onTiles(e, keys));
          const pushed = new Set(victims);
          for (const e of victims) {
            // "往身前方向…推开": a directional push whose angle is fixed — PRTS 备注 "不会因为角度过大而改变推动的方向或削减力度"
            // (only the angle: a target nearer than 0.25 tile still turns radial at 受力等级 −2) — by the official
            // 力度 − 重量 distance of a 特效 push (PRTS 推与拉 names 见行者's skills 特效类; Battle.push / pushDistance);
            // stopped short of it ⇒ it hit a wall
            const near = Math.hypot(e.x - unit.x, e.y - unit.y) < PUSH_DIRECTIONAL_MIN_DIST;
            const expect = battle.pushDistance(e, near ? force - 2 : force, { effect: true });
            const moved = battle.push(e, force, { from: unit, dir: { x: unit.fwd[1], y: unit.fwd[0] }, fixedAngle: true, effect: true });
            const wall = expect > 0 && moved + 0.05 < expect;
            battle.applyStatus(e, 'stun', { duration: wall ? sWall : sDirect, source: unit });
          }
          for (const e of victims) {
            for (const o of battle.enemiesInRadius(e.x, e.y, COLLIDE)) {
              if (pushed.has(o)) continue;
              pushed.add(o);
              battle.applyStatus(o, 'stun', { duration: sBrush, source: unit });
            }
          }
          fx(battle, 'push', unit, { skill: 'forcer_2', n: victims.length });
        },
        // "立即将范围内所有敌人…": the data rule SKILL_RANGE fires it once an enemy is inside the skill range (PRTS 技能
        // 策略 "仅在技能范围内存在敌人（无视其不可选中）时释放技能"), not only when one stands on her 2-tile attack range
      },
      talents: [{ install(battle, unit) {
        battle.on('hit', (ctx) => {
          if (ctx.source === unit && ctx.target.side === 'enemy' && ctx.target.s.massLevel >= num(t0.value, 3)) ctx.dmg.defIgnoreFlat += num(t0.def_penetrate_fixed);
        }, { owner: unit });
      } }],
    };
    if (num(tb.value) > 0) {
      kit.install = (battle, unit) => {
        battle.on('deploy', (ctx) => {
          // ranged position = not a ground tile (a high tile, or a platform that elevates it: unit.ground false)
          if (ctx.unit !== unit || ctx.initial || unit.ground) return;
          battle.addDp(unit.ownerId, unit.base.cost * num(tb.value));
          fx(battle, 'dp', unit, { n: unit.base.cost * num(tb.value) });
        }, { owner: unit });
      };
    }
    return kit;
  },

  // ---- 3_08 薄绿 · 阵法术师 — S2 聚能涡旋: each attack strikes every enemy on her range (the trait's 群体法术伤害) and
  //      pushes each one towards her, end-of-skill burst on
  //      every enemy in range; 地质学者: DEF aura (skill off) / less likely targeted (skill on);
  //      精锐 module PLX-X: keeps part of the guard (DEF/RES) while the skill runs
  //      S1 风语: wider range (skill grid), attacks every enemy on it at attack@atk_scale. Auto-cast: the data
  //      rule SEARCH is the 阵法术师 row (PRTS 卫戍协议/帮助 "不受基础策略影响，在初始攻击范围内存在敌人时释放技能"; it
  //      covers every MANUAL skill of the class — user playtest #6) = an enemy inside her INITIAL range — the engine's
  //      DEFAULT rule, checked every tick for a unit that does not attack while its skill is off — not any enemy on the
  //      field: she would burn the skill on enemies that just spawned.
  chess_char_3_08_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const tGrid = copyGrid(d.talents?.[0]?.rangeGrid) ?? [[1, 0], [0, -1], [0, 0], [0, 1], [-1, 0]];
    const pullForce = num(bb['attack@force'], num(bb.force, 0));
    const endScale = num(bb.atk_scale, 0);
    const keepDef = num(tb['soil_e_002[buff].def'], 0), keepRes = num(tb['soil_e_002[buff].magic_resistance'], 0);
    // every skill: PLX-X keeps part of the guard, 地质学者 taunt −1 while it runs, DEF aura only while it does not
    const guardOn = ({ battle, unit }) => {
      if (keepDef || keepRes) battle.addBuff(unit, { key: 'trait:mint_keep', mods: { defPct: keepDef, resFlat: keepRes } });
      battle.addBuff(unit, { key: 'talent:mint_taunt', mods: { taunt: num(t0.taunt_level, -1) } });
      unit.mem.mintAura?.();
    };
    const guardOff = ({ battle, unit }) => {
      battle.removeBuff(unit, 'trait:mint_keep');
      battle.removeBuff(unit, 'talent:mint_taunt');
      unit.mem.mintAura?.();
    };
    return {
      skills: altSkills(chess, d, bb, {
        skchr_mint_1: (s) => {
          const grid = copyGrid(s.rangeGrid);
          return {
            kind: 'duration',
            trigger: { rule: 'DEFAULT' },
            attack: { atkScale: num(s.bb['attack@atk_scale'], num(s.bb.atk_scale, 1)) },
            ...(grid ? { targeting: { rangeGrid: grid } } : {}),
            onStart: guardOn,
            onEnd: guardOff,
          };
        },
      }),
      skill: {
        kind: 'duration',
        attack: {
          atkScale: num(bb['attack@atk_scale'], 1),
          onHit({ battle, unit, target }) {
            if (!target || !target.alive || target.side !== 'enemy') return;
            // PRTS 备注: "此技能的“拖拽”机制实际为反方向（指向薄绿方向）的推开" — a radial push towards her by the
            // official 力度 − 重量 push distance (小力 vs weight 1: 0.44 tiles), never past her (Battle.push inward). Her
            // attack reaches air units (阵法术师 "攻击时可对空"), but the drones of the mode are 静态刚体 (PRTS 特殊机制): hit,
            // never dragged (player report after 0.1.0, "飞机可以被薄绿的技能拉走")
            if (battle.push(target, pullForce, { from: unit, inward: true }) > 0) fx(battle, 'pull', target, { src: unit.id });
          },
        },
        onStart: guardOn,
        onEnd(ctx) {
          const { battle, unit, reason } = ctx;
          if (reason !== 'death' && unit.alive && endScale > 0) {
            for (const e of enemiesOn(battle, unit, unit.rangeKeys)) battle.dealDamage(unit, e, { amount: unit.s.atk * endScale, type: 'arts', isSkill: true, tags: ['skill', 'burst'] });
            fx(battle, 'aoe', unit, { radius: 2, dmgType: 'arts', skill: 'mint_2' });
          }
          guardOff(ctx);
        },
      },
      talents: [{ install(battle, unit) {
        unit.mem.mintAura = aura(battle, unit, {
          key: 'talent:mint_geo', side: 'ally', tiles: () => gridKeys(tGrid, unit), active: () => !unit.skill?.active, mods: { defPct: num(t0.def) },
        });
      } }],
    };
  },

  // ---- 3_09 海霓 · 削弱者 — S2 阻滞性显色剂: ATK +, 2 targets, slows non-elite enemies in range, their deaths raise the
  //      talent up to max_talent_up; 测绘器材的奇用: non-elite enemies in range are fragile
  chess_char_3_09_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const slow = num(bb['attack@move_speed'], 0);
    const up = num(bb['attack@talent_up'], 0), upMax = num(bb['attack@max_talent_up'], 1);
    const mt = Math.floor(num(bb['attack@max_target'], 1));
    const kit = {
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        onStart({ battle, unit }) {
          unit.mem.hainiMul = 1;
          if (!unit.mem.hainiSlow) {
            unit.mem.hainiSlow = aura(battle, unit, { key: 'skill:haini_slow', side: 'enemy', interval: 0, tiles: () => unit.rangeKeySet, filter: isNormalEnemy, mods: { moveMul: Math.max(0, 1 + slow) } });
          }
          unit.mem.hainiSlow();
        },
        onTick({ unit }) { unit.mem.hainiSlow?.(); },
        onEnd({ unit }) { unit.mem.hainiSlow?.clear(); unit.mem.hainiMul = 1; },
      },
      // S1 迷惑性洋流图: next attack ×atk_scale on max_target enemies at once
      skills: altSkills(chess, d, bb, {
        skchr_haini_1: (s) => ({
          kind: instantKindOf(s),
          targeting: { maxTargets: Math.max(1, Math.floor(num(s.bb.max_target, 1))) },
          attack: { atkScale: num(s.bb.atk_scale, 1) },
        }),
      }),
      talents: [{ install(battle, unit) {
        unit.mem.hainiMul = 1;
        aura(battle, unit, {
          key: 'talent:haini_fragile', side: 'enemy', tiles: () => unit.rangeKeySet, filter: isNormalEnemy,
          mods: () => ({ dmgTakenMul: 1 + (num(t0.damage_scale, 1) - 1) * (unit.mem.hainiMul ?? 1) }),
        });
        battle.on('kill', (ctx) => {
          const v = ctx.victim;
          if (!unit.skill?.active || !alive(unit) || v.side !== 'enemy' || !isNormalEnemy(v)) return;
          if (!unit.rangeKeySet || !onTiles(v, unit.rangeKeySet)) return;
          unit.mem.hainiMul = Math.min(upMax, (unit.mem.hainiMul ?? 1) + up);
        }, { owner: unit });
      } }],
    };
    if (mt > 1) kit.skill.targeting = { maxTargets: mt };
    return kit;
  },

  // ---- 3_10 松果 · 散射手 — S2 电能过载: ATK + growing with each use (a→d), shorter range; 便携电源: SP regen for 60 s
  chess_char_3_10_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const sel = selectedId(chess, d);
    const steps = Object.keys(bb).filter((k) => /\[[a-z]\]\.atk$/.test(k)).sort().map((k) => num(bb[k]));
    if (!steps.length) steps.push(num(bb.atk));
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const kit = {
      skill: {
        kind: 'duration',
        onStart({ battle, unit, skill }) {
          const atk = steps[Math.min(steps.length - 1, Math.max(0, skill.activations - 1))];
          battle.addBuff(unit, { key: 'skill:pinecn_atk', mods: { atkPct: atk } });
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'skill:pinecn_atk'); },
      },
      // S1 RMA长钉 (charges): "立即以165%的攻击力进行一次攻击，无视敌人180的防御力" — an extra shot fired at once (all
      // enemies in range, front-row × of the trait), on top of the normal attack it was cast before
      skills: altSkills(chess, d, bb, {
        skchr_pinecn_1: (s) => ({
          kind: instantKindOf(s),
          // (the DEF ignore rides on the shots' tag: they land after the instant skill has ended)
          attack: { atkScale: num(s.bb.atk_scale, 1), tags: ['skill', 'pinecnSpike'] },
          onStart({ battle, unit }) { battle.forceAttack(unit); },
        }),
      }),
      talents: [{ install(battle, unit) {
        battle.on('deploy', (ctx) => {
          if (ctx.unit === unit) battle.addBuff(unit, { key: 'talent:pinecn_power', duration: num(t0.duration, 60), mods: { spRecoveryFlat: num(t0.sp_recovery_per_sec) } });
        }, { owner: unit });
      } }],
    };
    if (sel === 'skchr_pinecn_1') {
      const pen = num(bb.def_penetrate_fixed, 0);
      kit.install = (battle, unit) => battle.on('hit', (ctx) => {
        if (ctx.source === unit && pen > 0 && ctx.dmg.tags?.includes('pinecnSpike')) ctx.dmg.defIgnoreFlat += pen;
      }, { owner: unit });
    }
    if (skillGrid) {
      kit.skill.targeting = { rangeGrid: skillGrid };
      // "攻击范围缩短": offensive skills fire with an enemy inside the SKILL range (research 03 §1.4) — with the
      // initial (wider) range she would open the skill on enemies the shortened range cannot reach
      kit.skill.trigger = { rule: 'CUSTOM_RANGE', grid: skillGrid };
    }
    return kit;
  },

  // ---- 3_11 雪猎 · 猎手 — S2 风雪连弩: instant special-bullet double shot (higher vs non-moving targets), charges;
  //      裂云一击: the skill also sends 裂云兽 (ATK% phys + cold); 精锐 module HUN-X: reload from empty adds extra rounds
  //      S1 强力击·β型: next attack ×atk_scale (a normal shot: needs a round); 裂云兽 hits the enemy it is cast on
  chess_char_3_11_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const sel = selectedId(chess, d);
    const S2 = 'skchr_snhunt_2';
    const s1 = num(bb.atk_scale_1, 1), s2 = num(bb.atk_scale_2, s1);
    const charges = Math.max(1, Math.floor(num(d.skill?.maxCharges, num(bb.ct, 1))));
    const shots = textNum(d.skill?.description, /(\d+|[一二两三四五])连击/, 2);
    const still = (e) => !!(e.blockedBy || e.s.flags.stun || e.s.flags.noMove || !e.moving);
    const extra = num(tb.extra_add, 0);
    return {
      skill: {
        kind: charges > 1 ? 'charges' : 'instant',
        onStart({ battle, unit }) {
          const t = enemiesOn(battle, unit, unit.rangeKeys, 1, unit.profile)[0] ?? null;
          unit.mem.snTarget = t;
          if (!t) return;
          battle.addProjectile({
            from: unit, target: t, speed: 16, visual: 'arrow', source: unit,
            onHit: ({ target }) => {
              if (!target || !target.alive) return;
              const sc = still(target) ? s2 : s1;
              for (let i = 0; i < shots && target.alive; i++) battle.dealDamage(unit, target, { amount: unit.s.atk * sc, type: 'phys', isSkill: true, tags: ['skill', 'snhunt'] });
            },
          });
          fx(battle, 'volley', unit, { target: t.id, skill: 'snhunt_2' });
        },
      },
      skills: altSkills(chess, d, bb, {
        skchr_snhunt_1: (s) => ({ kind: instantKindOf(s), attack: { atkScale: num(s.bb.atk_scale, 1) } }),
      }),
      talents: [{ install(battle, unit) {
        battle.on('skillStart', (ctx) => {
          if (ctx.unit !== unit) return;
          // S2 aims its special bullets itself (mem.snTarget); another skill is cast on the enemy about to be shot
          const t = sel === S2 || sel == null ? unit.mem.snTarget : (enemiesOn(battle, unit, unit.rangeKeys, 1, unit.profile)[0] ?? null);
          if (!t || !t.alive) return;
          battle.dealDamage(unit, t, { amount: unit.s.atk * num(t0.atk_scale, 1), type: 'phys', isSkill: true, tags: ['talent', 'cloudbeast'] });
          if (t.alive) battle.applyStatus(t, 'cold', { duration: num(t0.cold, 3), source: unit });
          fx(battle, 'strike', t, { src: unit.id, talent: 'snhunt_beast' });
        }, { owner: unit });
      } }],
      install(battle, unit) {
        // special bullets (S2 only): the skill also fires while the magazine is empty (the attack loop cannot run then)
        if (sel === S2 || sel == null) {
          battle.on('tick', () => {
            const sk = unit.skill;
            if (!alive(unit) || !unit.canAct || !sk || !sk.ready || sk.opCooling || unit.s.flags.silence || (unit.trait.ammo ?? 1) > 0) return;
            if (battle.enemiesInKeys(unit.baseRangeKeys || unit.rangeKeys, unit, unit.profile).length) sk.activate('DEFAULT');
          }, { owner: unit });
        }
        if (extra > 0) {
          battle.on('tick', () => {
            const a = unit.trait.ammo ?? 0;
            if (unit.mem.prevAmmo === 0 && a === 1) unit.trait.ammo = Math.min(Math.max(1, unit.profile.ammoMax ?? 8), a + extra);
            unit.mem.prevAmmo = unit.trait.ammo;
          }, { owner: unit });
        }
      },
    };
  },

  // ---- 3_12 瑕光 · 守护者 — S3 先贤化身: ATK/DEF +, bonus arts per hit, heals another nearby ally per attack;
  //      剑盾骑士: hurt-SP skills of the team also gain SP on attack; 仁慈: attacks sleeping enemies (first, ×atk_scale);
  //      精锐 module GUA-Y: damage taken −15 %
  //      S1 光芒涌动 (自动触发 ⇒ DEFAULT, charges): next attack ×atk_scale phys + heals the most injured ally of the 3×3 (herself
  //      included) for heal_scale × ATK; S2 慑敌辉光: ATK +, puts every ground enemy on her own tile and every enemy she
  //      blocks to sleep (PRTS 备注; for the skill's duration: no own value in the data) and heals every ally of the
  //      skill range by ATK × ratio each second;
  //      精锐 module GUA-X: her heals on allies under hp_ratio HP × heal_scale
  chess_char_3_12_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const bonus = num(bb['attack@blemsh_s_3_extra_dmg[magic].atk_scale'], 0);
    const heal = num(bb.heal_scale, 0);
    const healGrid = copyGrid(d.skill?.rangeGrid) ?? NINE;
    const mercy = num(t1.atk_scale, 1);
    const sleepersInRange = (battle, unit) => {
      const set = unit.rangeKeySet;
      return set ? battle.enemies.filter((e) => e.alive && !e.hidden && e.s.flags.sleep && !e.s.flags.untargetable && !e.isFlying && onTiles(e, set)) : [];
    };
    const kit = {
      trait: { hitSleep: true }, // 仁慈: 自身可以攻击…沉睡的目标 (沉睡 = 无敌 for everyone else)
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk), defPct: num(bb.def) },
        heal: false,
        attack: { onHit({ battle, unit, target }) {
          if (bonus > 0 && target && target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * bonus, type: 'arts', isSkill: true, tags: ['skill', 'blemshBonus'] });
        } },
        onAttack({ battle, unit }) {
          if (!(heal > 0)) return;
          const ally = battle.injuredAlliesInKeys(new Set(gridKeys(healGrid, unit)), unit).find((a) => a !== unit);
          if (ally) battle.heal(unit, ally, unit.s.atk * heal);
        },
      },
      skills: altSkills(chess, d, bb, {
        skchr_blemsh_1: (s) => {
          const grid = copyGrid(s.rangeGrid) ?? NINE;
          const hs = num(s.bb.heal_scale, 0);
          return {
            kind: instantKindOf(s),
            heal: false,
            attack: {
              atkScale: num(s.bb.atk_scale, 1),
              onHit({ battle, unit }) { // "恢复周围一名友方单位"
                const ally = hs > 0 ? battle.injuredAlliesInKeys(new Set(gridKeys(grid, unit)), unit)[0] : null;
                if (ally) battle.heal(unit, ally, unit.s.atk * hs);
              },
            },
          };
        },
        skchr_blemsh_2: (s) => {
          const grid = copyGrid(s.rangeGrid) ?? NINE;
          const ratio = num(s.bb['attack@atk_to_hp_recovery_ratio'], num(s.bb.atk_to_hp_recovery_ratio, 0));
          return {
            kind: 'duration',
            heal: false,
            mods: { atkPct: num(s.bb.atk) },
            onStart({ battle, unit, skill }) {
              const dur = skill.timeLeft > 0 ? skill.timeLeft : Math.max(0.1, num(s.duration, 10));
              let n = 0;
              // PRTS 备注: "技能生效对象实际为“自身这格内的所有地面敌人及自身阻挡的敌人”，即使阻挡的是飞行敌人" — a blocked
              // enemy stands at the block radius, outside her tile (Battle._checkBlock)
              for (const e of battle.enemies) {
                if (!e.alive || e.hidden) continue;
                if (e.blockedBy !== unit && (e.isFlying || !bodyOnTile(e, unit.tileR, unit.tileC))) continue;
                if (battle.applyStatus(e, 'sleep', { duration: dur, source: unit })) n++;
              }
              fx(battle, 'aoe', unit, { radius: 0.5, skill: 'blemsh_2', status: 'sleep', n });
              unit.mem.blemshRegen = 0;
            },
            onTick({ battle, unit, dt }) { // "周围的所有友方单位每秒恢复相当于攻击力N%的生命值"
              if (!(ratio > 0)) return;
              unit.mem.blemshRegen = (unit.mem.blemshRegen ?? 0) + dt;
              while (unit.mem.blemshRegen >= 1 - 1e-9) {
                unit.mem.blemshRegen -= 1;
                for (const a of battle.injuredAlliesInKeys(new Set(gridKeys(grid, unit)), unit)) battle.heal(unit, a, unit.s.atk * ratio);
              }
            },
          };
        },
      }),
      talents: [
        { install(battle, unit) {
          unit.mem.blemshKnight = true;
          battle.on('attack', (ctx) => {
            const a = ctx.attacker;
            if (!a || a.kind !== 'op' || a.ownerId !== unit.ownerId || a.skill?.spType !== 'hurt') return;
            if (!alive(unit) || !isLeader(battle, unit, 'blemshKnight')) return;
            giveSp(a, num(t0.sp, 1), 'talent');
          }, { owner: unit });
        } },
        { install(battle, unit) {
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit) return;
            const s = sleepersInRange(battle, unit);
            if (s.length) ctx.targets = [s[0], ...ctx.targets.filter((t) => t !== s[0])].slice(0, Math.max(1, ctx.targets.length));
          }, { owner: unit });
          battle.on('hit', (ctx) => {
            if (ctx.source === unit && ctx.target.side === 'enemy' && ctx.target.s.flags.sleep) ctx.dmg.mul *= mercy;
          }, { owner: unit });
          // (a lone sleeper is found by the engine's own target search: `trait.hitSleep` makes sleepers targetable
          // and damageable for her only)
        } },
      ],
    };
    if (num(tb.damage_resistance) > 0) {
      kit.install = (battle, unit) => battle.addBuff(unit, { key: 'trait:blemsh_guard', mods: { dmgTakenMul: 1 - num(tb.damage_resistance) }, persist: true, allowDead: true });
    } else if (num(tb.heal_scale) > 0) {
      // GUA-X "治疗生命值低于50%的友方单位时治疗量提升15%" (the HP before the heal)
      kit.install = (battle, unit) => battle.on('heal', (ctx) => {
        if (ctx.source === unit && ctx.target && ctx.target.hpRatio < num(tb.hp_ratio, 0.5)) ctx.amount *= num(tb.heal_scale, 1);
      }, { owner: unit });
    }
    return kit;
  },

  // ---- 3_13 至简 · 驭械术师 — S2 神工意匠: next attack ATK% arts twice (charges); 忽有所悟: prob of ATK ×atk_scale per attack
  chess_char_3_13_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const charges = Math.max(1, Math.floor(num(d.skill?.maxCharges, num(bb.ct, 1))));
    const hits = textNum(d.skill?.description, /连续攻击(\d+|[一二两三四五])次/, 2);
    const insight = (battle) => (battle.rng.chance(num(t0.prob, 0)) ? num(t0.atk_scale, 1) : 1);
    return {
      trait: { dmgMul: (battle, unit, target) => funnelMap(battle, unit, target) * insight(battle) },
      skill: {
        kind: charges > 1 ? 'charges' : 'instant',
        attack: { atkScale: num(bb.atk_scale, 1), hits, dmgType: 'arts', dmgMul: (battle) => insight(battle) },
      },
      // S1 迅捷打击·γ型: ATK / ASPD + (the drones' ramp and 忽有所悟 stay on every attack through the trait)
      skills: altSkills(chess, d, bb, { 'skcom_quickattack[3]': statSkill }),
      install: installFunnelPrune,
    };
  },

  // ---- 3_14 初雪 · 削弱者 — S2 自然震慑: DEF/RES shred aura on every enemy in range; 虚弱化: low-HP enemies fragile;
  //      双响: 2 targets
  chess_char_3_14_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const mr = num(bb.magic_resistance, 0);
    const shred = { defPct: num(bb.def) };
    if (mr) {
      if (Math.abs(mr) < 1) shred.resMul = Math.max(0, 1 + mr);
      else shred.resFlat = mr;
    }
    const mt = Math.floor(num(t1['attack@max_target'], 1));
    const kit = {
      skill: {
        kind: 'duration',
        onStart({ battle, unit }) {
          if (!unit.mem.slbellAura) unit.mem.slbellAura = aura(battle, unit, { key: 'skill:slbell_shred', side: 'enemy', interval: 0, tiles: () => unit.rangeKeySet, mods: shred });
          unit.mem.slbellAura();
        },
        onTick({ unit }) { unit.mem.slbellAura?.(); },
        onEnd({ unit }) { unit.mem.slbellAura?.clear(); },
      },
      // S1 传音回响: 2 targets, every enemy in range ASPD + attack_speed (negative) while it runs
      skills: altSkills(chess, d, bb, {
        skchr_slbell_1: (s) => {
          const slow = { aspd: num(s.bb.attack_speed) };
          return {
            kind: 'duration',
            targeting: { maxTargets: Math.max(1, Math.floor(num(s.bb['attack@max_target'], num(s.bb.max_target, 1)))) },
            onStart({ battle, unit }) {
              if (!unit.mem.slbellSlow) unit.mem.slbellSlow = aura(battle, unit, { key: 'skill:slbell_aspd', side: 'enemy', interval: 0, tiles: () => unit.rangeKeySet, mods: slow });
              unit.mem.slbellSlow();
            },
            onTick({ unit }) { unit.mem.slbellSlow?.(); },
            onEnd({ unit }) { unit.mem.slbellSlow?.clear(); },
          };
        },
      }),
      talents: [{ install(battle, unit) {
        aura(battle, unit, {
          key: 'talent:weak_fragile', side: 'enemy', tiles: () => unit.rangeKeySet, filter: (e) => e.hpRatio < num(t0.hp_ratio, 0.4),
          mods: { dmgTakenMul: num(t0.damage_scale, 1) }, interval: 0.1,
        });
      } }],
    };
    if (mt > 1) kit.trait = { maxTargets: mt };
    return kit;
  },

  // ---- 3_15 巫恋 · 削弱者 (hidden) — S2 诅咒娃娃 "获得一个诅咒娃娃（最多可库存1个）": the doll is a hand piece the player
  //      places (user playtest #6; PRTS 卫戍协议/帮助); each cast gives one and the placed piece takes the field on its
  //      own tile (tokens.js releaseSkillSummon: not at the battle start; not placed ⇒ no doll); its token kit keeps the
  //      3×3 ATK/DEF aura (the token skill's bb) for 15 s; 溃败暗示: low-HP enemies fragile
  chess_char_3_15_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tokenId = chess?.skill?.overrideTokenKey ?? (d.tokens || []).find((t) => /doll/.test(String(t))) ?? 'token_10006_vodfox_doll';
    return {
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) { releaseSkillSummon(battle, unit, tokenId); },
      },
      talents: [{ install(battle, unit) {
        aura(battle, unit, {
          key: 'talent:weak_fragile', side: 'enemy', tiles: () => unit.rangeKeySet, filter: (e) => e.hpRatio < num(t0.hp_ratio, 0.4),
          mods: { dmgTakenMul: num(t0.damage_scale, 1) }, interval: 0.1,
        });
      } }],
    };
  },

  // ---- 3_16 蛇屠箱 · 铁卫 — S2 壳状防御: stops attacking, block +1, DEF +, regen; 防御专精: DEF +;
  //      精锐 module PRO-X: DEF + while blocking
  chess_char_3_16_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const tb = traitBb(d);
    const kit = {
      skill: {
        kind: 'duration',
        mods: { defPct: num(bb.def), blockCnt: num(bb.block_cnt), hpRegenRatio: num(bb.hp_recovery_per_sec_by_max_hp_ratio) },
        attack: { noAttack: true },
      },
      // S1 防御力强化·β型 (TAKE_DAMAGE): DEF + (she keeps attacking)
      skills: altSkills(chess, d, bb, { 'skcom_def_up[2]': statSkill }),
      talents: [{ install(battle, unit) { battle.addBuff(unit, { key: 'talent:snakek_def', mods: { defPct: num(t0.def) }, persist: true, allowDead: true }); } }],
    };
    if (num(tb.def) > 0) kit.install = (battle, unit) => whileTrue(battle, unit, 'trait:snakek_block', () => unit.blocking.length > 0, { defPct: num(tb.def) });
    return kit;
  },

  // ---- 3_17 流星 · 速射手 — S2 碎甲击·扩散: instant ATK% phys on ≤5 enemies in range + DEF shred for `duration` s;
  //      空射专精: ×atk_scale vs flying (stacks with the module fly bonus)
  chess_char_3_17_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const n = textNum(d.skill?.description, /至多(\d+)个/, 5);
    const flyMul = (unit, t) => (t.isFlying ? (unit.profile.flyScale ?? 1) * num(t0.atk_scale, 1) : 1);
    return {
      trait: { dmgMul: (battle, unit, target) => flyMul(unit, target) },
      skill: {
        kind: 'instant',
        onStart({ battle, unit }) {
          const list = enemiesOn(battle, unit, unit.rangeKeys, n, unit.profile);
          for (const e of list) {
            battle.dealDamage(unit, e, { amount: unit.s.atk * num(bb.atk_scale, 1) * flyMul(unit, e), type: 'phys', isSkill: true, tags: ['skill', 'burst'] });
            if (e.alive) battle.addBuff(e, { key: 'skill:shotst_shred', duration: num(bb.duration, 5), refresh: 'extend', mods: { defPct: num(bb.def) }, source: unit, visible: true });
          }
          if (list.length) fx(battle, 'volley', unit, { targets: list.map((e) => e.id), skill: 'shotst_2' });
        },
      },
      // S1 碎甲击: next attack ×atk_scale (fly × of the trait kept) and the target's DEF − for `duration` s
      skills: altSkills(chess, d, bb, {
        skchr_shotst_1: (s) => ({
          kind: instantKindOf(s),
          attack: {
            atkScale: num(s.bb.atk_scale, 1),
            onHit({ battle, unit, target }) {
              if (target && target.alive && target.side === 'enemy') battle.addBuff(target, { key: 'skill:shotst_shred', duration: num(s.bb.duration, 5), refresh: 'extend', mods: { defPct: num(s.bb.def) }, source: unit, visible: true });
            },
          },
        }),
      }),
    };
  },

  // ---- 3_18 忍冬 · 尖兵 — S3 隐狐之艺: +DP, range +1, ATK +, decaying ASPD, hits all blocked, 0.2 s stun per hit,
  //      after a kill during the skill 迷彩 from its end until the next cast ("进入迷彩状态，直至下一次开启技能") — the
  //      `camou` status under its own key (ba.camou "不阻挡时不成为敌方普通攻击的目标": only the enemy she blocks attacks
  //      her, as with 隐匿; it used to be the generic `stealth` = 隐匿 under the key `stealth`, shared with 伪装服's timed
  //      隐匿, which the unending one then made permanent, and it counted as 隐匿 for 叙拉古 / 家族徽章 — user playtest #6
  //      "叙拉古阵营隐身不会结束": the bond's 隐匿 ends on time, this 迷彩 officially lasts); 追凶: bonus arts on marked
  //      enemies; 蓄势: DP regen + out-of-combat
  //      regen; 精锐 module SOL-X: ATK/DEF + while blocking
  //      S1 小施惩戒 (charges): next attack + extra_damage_ratio × ATK arts and +cost DP; S2 坠刃拷问 (charges, the data rule
  //      SKILL_RANGE: fires once an enemy is inside its own range 3-12, charges 3 s apart): +cost DP, ≤ max_target enemies of that range take atk_scale arts and
  //      停顿 — the ones already 停顿 are also stunned. (SOL-Y "首次部署时部署费用-4": the initial deployment is free.)
  chess_char_3_18_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const tb = traitBb(d);
    const skillGrid = copyGrid(d.skill?.rangeGrid);
    const aspd0 = num(bb.attack_speed, 0);
    const kit = {
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        attack: { hitAllBlocked: true, onHitStatus: { key: 'stun', duration: num(bb['attack@stun'], 0.2) } },
        onStart({ battle, unit, skill }) {
          battle.removeBuff(unit, CAMOU_KEY);
          unit.mem.vulpisKill = false;
          const dp = num(bb.cost, 0);
          if (dp > 0) { battle.addDp(unit.ownerId, dp); fx(battle, 'dp', unit, { n: dp }); }
          battle.addBuff(unit, { key: 'skill:vulpis_aspd', mods: { aspd: aspd0 } });
          unit.mem.vulpisDur = skill.timeLeft;
        },
        onTick({ battle, unit, skill }) {
          const b = unit.findBuff('skill:vulpis_aspd');
          const dur = unit.mem.vulpisDur || skill.duration || 1;
          if (b) { b.mods = { aspd: aspd0 * Math.max(0, skill.timeLeft) / dur }; unit.markDirty(); }
        },
        onEnd({ battle, unit, reason }) {
          battle.removeBuff(unit, 'skill:vulpis_aspd');
          if (reason !== 'death' && unit.alive && unit.mem.vulpisKill) {
            battle.addBuff(unit, { key: CAMOU_KEY, flags: { camou: true }, status: 'camou', source: unit });
            fx(battle, 'camouflage', unit);
          }
        },
      },
      skills: altSkills(chess, d, bb, {
        skchr_vulpis_1: (s) => ({
          kind: instantKindOf(s),
          attack: { onHit({ battle, unit, target }) {
            if (target && target.alive) battle.dealDamage(unit, target, { amount: unit.s.atk * num(s.bb.extra_damage_ratio), type: 'arts', isSkill: true, tags: ['skill', 'vulpisPunish'] });
            const dp = num(s.bb.cost, 0);
            if (dp > 0) { battle.addDp(unit.ownerId, dp); fx(battle, 'dp', unit, { n: dp }); }
          } },
        }),
        skchr_vulpis_2: (s) => { // 坠刃拷问 — air units too (PRTS 备注 "※可对空"); data trigger SKILL_RANGE (its 3-12 range)
          const grid = copyGrid(s.rangeGrid);
          const n = Math.max(1, Math.floor(num(s.bb.max_target, 6)));
          return {
            kind: instantKindOf(s),
            onStart({ battle, unit }) {
              const dp = num(s.bb.cost, 0);
              if (dp > 0) { battle.addDp(unit.ownerId, dp); fx(battle, 'dp', unit, { n: dp }); }
              const list = enemiesOn(battle, unit, gridKeys(grid ?? unit.rangeGrid, unit), n);
              for (const e of list) {
                const was = !!e.findBuff('sluggish'); // "若敌人已经处于停顿状态" (before this cast)
                battle.dealDamage(unit, e, { amount: unit.s.atk * num(s.bb.atk_scale, 1), type: 'arts', isSkill: true, tags: ['skill', 'vulpisTorture'] });
                if (!e.alive) continue;
                battle.applyStatus(e, 'sluggish', { duration: num(s.bb.sluggish, 0), source: unit });
                if (was && e.alive) battle.applyStatus(e, 'stun', { duration: num(s.bb.stun, 0), source: unit });
              }
              if (list.length) fx(battle, 'aoe', unit, { radius: 1.5, dmgType: 'arts', skill: 'vulpis_2', n: list.length });
            },
          };
        },
      }),
      talents: [
        { install(battle, unit) { // 追凶
          const marks = new Map();
          // re-entrancy guard: content that turns a hit into HP loss credited to her (频次 enemies: every instance
          // = 1 HP) would otherwise feed the bonus back into itself until the hook-depth limit
          let busy = false;
          battle.on('damaged', (ctx) => {
            const e = ctx.target;
            if (busy || ctx.source !== unit || e.side !== 'enemy' || ctx.type === 'element' || ctx.dmg?.tags?.includes('vulpisHunt')) return;
            const t = marks.get(e.id);
            if (t == null) { marks.set(e.id, battle.time); return; }
            if (battle.time - t <= num(t0.interval, 10) + 1e-9 && e.alive) {
              busy = true;
              // PRTS 备注 "伤害类型为法术附加伤害": tag addition (no 叙拉古 6 roll)
              try { battle.dealDamage(unit, e, { amount: unit.s.atk * num(t0.atk_scale), type: 'arts', canDodge: false, tags: ['talent', 'vulpisHunt', 'addition'] }); } finally { busy = false; }
            }
          }, { owner: unit });
          battle.on('kill', (ctx) => { if (ctx.killer === unit && unit.skill?.active) unit.mem.vulpisKill = true; }, { owner: unit });
        } },
        { install(battle, unit) { // 蓄势
          unit.mem.vulpisDp = true;
          const bonus = num(t1.delta_cost_increase_time, 1) - 1;
          const quiet = num(t1.interval, 4);
          const regen = num(t1['vulpis_t_2[heal][interval].hp_recovery_per_sec_by_max_hp_ratio'], 0);
          battle.on('tick', (ctx) => {
            if (!alive(unit)) return;
            if (bonus > 0 && isLeader(battle, unit, 'vulpisDp')) battle.addDp(unit.ownerId, battle.flags.dpPerSec * ctx.dt * bonus);
            const on = battle.time - unit.lastHitAt >= quiet && regen > 0;
            const has = !!unit.findBuff('talent:vulpis_regen');
            if (on && !has) battle.addBuff(unit, { key: 'talent:vulpis_regen', mods: { hpRegenRatio: regen } });
            else if (!on && has) battle.removeBuff(unit, 'talent:vulpis_regen');
          }, { owner: unit });
        } },
      ],
    };
    if (skillGrid) kit.skill.targeting = { rangeGrid: skillGrid };
    if (num(tb.atk) > 0 || num(tb.def) > 0) {
      kit.install = (battle, unit) => whileTrue(battle, unit, 'trait:vulpis_block', () => unit.blocking.length > 0, { atkPct: num(tb.atk), defPct: num(tb.def) });
    }
    return kit;
  },

  // ---- 3_19 伺夜 · 战术家 — the tactical reinforcement is the wolf pack (狼群领袖: 2 wolves, +1 every 25 s up to 3, each
  //      wolf = +1 block and one more bite, a wolf is lost instead of the pack dying); 狼群天性: DEF ignore vs pack-blocked
  //      enemies; S3 领袖的尊严: DP over time, 三连击, bonus arts vs pack-blocked enemies; 精锐 module: pack takes less
  //      damage from the enemies it blocks (token module talent). A 狼群 piece placed in the prep phase is the pack.
  //      S1 领袖的呼唤 (ALWAYS): +cost DP and one more “狼影” (≤ the talent's maximum); S2 领袖的馈赠: +cost DP, the pack
  //      recovers hp_ratio of its max HP and its next attack hits ×atk_scale — a kill by that attack gives +cost DP.
  //      精锐 module TAC-Y: trait ×165 % (profession layer) and "援军阻挡的敌人更容易受到我方的攻击": the pack's token module
  //      talent taunt_level (+1) goes to the enemies it blocks — the enemy-side 嘲讽等级 our operators target first
  //      (targeting.js; research 05: "更容易受到我方的攻击" = enemy taunt.taunt_level), never to the pack itself.
  chess_char_3_19_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const sel = selectedId(chess, d);
    const t0 = d.talents?.[0] ?? {}, t1 = talentBb(d, 1);
    const wolfId = t0.tokenKey ?? (d.tokens || []).find((t) => /wolf/.test(String(t))) ?? 'token_10028_vigil_wolf';
    const initial = textNum(t0.description, /初始(\d+|[一二两三四五])只/, 2);
    const maxWolves = textNum(t0.description, /至多(\d+|[一二两三四五])只/, 3);
    const hits = textNum(d.skill?.description, /(\d+|[一二两三四五])连击/, 3);
    const bonus = num(bb['attack@vigil_s_3.atk_scale'], 0);
    const pen = num(t1.def_penetrate_fixed, 0);
    const wolfOf = (u) => (u.trait.reinforcement && u.trait.reinforcement.alive ? u.trait.reinforcement : null);
    const wolfKit = (vigil) => ({
      skill: null,
      trait: { hitsFn: (b, w) => Math.max(1, w.mem.wolves || 1) },
      install(battle, w) {
        const tal = w.def.talents || [];
        const wb = tal[0]?.bb ?? {};
        const per = num(wb.block_cnt, num(wb['vigil_wolf_t_1_enhance[trigger].block_cnt'], 1));
        const grow = num(wb.interval, num(wb['vigil_wolf_t_1_enhance[trigger].interval'], 25));
        // (mem.shadows mirrors the count for content reading tokens.js wolfShadows())
        const apply = () => { w.mem.shadows = w.mem.wolves; battle.addBuff(w, { key: 'token:wolves', mods: { blockCnt: per * w.mem.wolves }, allowDead: true }); };
        w.mem.wolves = Math.max(1, Math.min(maxWolves, initial));
        apply();
        w.mem.addWolf = () => {
          if (!w.alive || w.mem.wolves >= maxWolves) return false;
          w.mem.wolves++;
          apply();
          fx(battle, 'summon', w, { src: vigil.id, wolves: w.mem.wolves });
          return true;
        };
        battle.every(grow, () => w.mem.addWolf(), { owner: w });
        battle.on('fatal', (ctx) => {
          if (ctx.unit !== w || ctx.prevented || w.mem.wolves <= 1) return;
          w.mem.wolves--;
          apply();
          ctx.prevented = true;
          w.hp = w.s.maxHp;
          fx(battle, 'revive', w, { wolves: w.mem.wolves });
        }, { owner: w });
        const mod = tal.find((t) => t && t.bb && t.bb.damage_scale != null);
        if (mod) {
          battle.on('hit', (ctx) => {
            if (ctx.target === w && ctx.source && ctx.source.blockedBy === w) ctx.dmg.mul *= num(mod.bb.damage_scale, 1);
          }, { owner: w });
        }
      },
    });
    // TAC-Y token module talent (taunt_level) of the pack — whichever kit runs it (this one or a tokens.js board piece):
    // the enemies it blocks carry that taunt level while they stay blocked (short refreshed buff: nothing lingers when
    // the pack or 伺夜 leaves)
    const packTaunt = (w) => {
      if (w.mem.packTaunt == null) {
        const t = (w.def?.talents || []).find((x) => x && x.bb && x.bb.taunt_level != null);
        w.mem.packTaunt = t ? num(t.bb.taunt_level) : 0;
      }
      return w.mem.packTaunt;
    };
    const installPackMark = (battle, unit) => {
      let cur = new Set();
      const levelOf = (w) => (w && alive(w) && alive(unit) ? packTaunt(w) : 0);
      const mark = (e, w, lvl) => battle.addBuff(e, { key: 'token:pack_mark', duration: 0.25, refresh: 'extend', mods: { taunt: lvl }, source: w, visible: true });
      // at once when the pack blocks (the operators attacking this tick already see it), kept / dropped every 0.1 s
      battle.on('blocked', (ctx) => {
        const w = wolfOf(unit), lvl = ctx.blocker === w ? levelOf(w) : 0;
        if (lvl && ctx.enemy.alive) { mark(ctx.enemy, w, lvl); cur.add(ctx.enemy); }
      }, { owner: unit });
      battle.every(0.1, () => {
        const w = wolfOf(unit);
        const lvl = levelOf(w);
        const next = new Set();
        if (lvl) {
          for (const e of w.blocking) {
            if (!e.alive || e.side !== 'enemy' || e.blockedBy !== w) continue;
            mark(e, w, lvl);
            next.add(e);
          }
        }
        for (const e of cur) {
          if (next.has(e)) continue;
          const b = e.findBuff('token:pack_mark');
          if (b) battle.removeBuff(e, b);
        }
        cur = next;
      }, { owner: unit, immediate: true });
    };
    /** One more “狼影” (S1): this kit's pack, or a 狼群 board piece run by content/tokens.js (same 'wolf:shadows' buff). */
    const addShadow = (battle, vigil, w) => {
      if (typeof w.mem.addWolf === 'function') return w.mem.addWolf();
      const n = Math.max(1, w.mem.shadows ?? 1);
      if (n >= maxWolves) return false;
      const wb = w.def?.talents?.[0]?.bb ?? {};
      const per = num(wb['vigil_wolf_t_1_enhance[trigger].block_cnt'], num(wb.block_cnt, 1));
      w.mem.shadows = n + 1;
      battle.addBuff(w, { key: 'wolf:shadows', persist: true, allowDead: true, refresh: 'replace', mods: { blockCnt: w.mem.shadows * per } });
      fx(battle, 'summon', w, { src: vigil.id, wolves: w.mem.shadows });
      return true;
    };
    const dpGain = (battle, unit, n) => { if (n > 0) { battle.addDp(unit.ownerId, n); fx(battle, 'dp', unit, { n }); } };
    // S2: the pack's empowered next attack (armed by the cast; ×scale on its hits; a kill pays once)
    const installGift = (battle, unit) => {
      battle.on('beforeAttack', (ctx) => {
        const w = wolfOf(unit);
        if (!w || ctx.attacker !== w || !w.mem.vigilGift) return;
        w.mem.vigilGiftOn = w.mem.vigilGift;
        w.mem.vigilGift = null;
      }, { owner: unit, priority: -100 });
      battle.on('hit', (ctx) => {
        const g = ctx.source?.mem?.vigilGiftOn;
        if (g && ctx.dmg.isAttack && ctx.source === wolfOf(unit)) ctx.dmg.mul *= g.scale;
      }, { owner: unit });
      battle.on('kill', (ctx) => {
        const g = ctx.killer?.mem?.vigilGiftOn;
        if (!g || g.paid || ctx.victim.side !== 'enemy' || ctx.killer !== unit.trait.reinforcement) return;
        g.paid = true;
        dpGain(battle, unit, g.dp);
      }, { owner: unit });
      battle.on('attack', (ctx) => { if (ctx.attacker?.mem?.vigilGiftOn && ctx.attacker === unit.trait.reinforcement) ctx.attacker.mem.vigilGiftOn = null; }, { owner: unit });
    };
    return {
      trait: { install(battle, unit) {
        // The pack is the tactician's 援军. The match also hands the player the 狼群 token to place in the prep phase
        // (= choosing the tactical point): that board piece (tokens.js kit, owner-coupled effects left to this kit) is
        // the pack when present — deployed early on its own tile if 伺夜 deploys first — never a second pack.
        const spawn = () => {
          if (!alive(unit) || wolfOf(unit)) return;
          const pieces = tokensOf(battle, unit, wolfId);
          const live = pieces.find((t) => alive(t));
          if (live) { unit.trait.reinforcement = live; return; }
          const waiting = pieces.find((t) => !t.alive && !t.removed);
          if (waiting && battle.redeploy(waiting, { free: true })) {
            unit.trait.reinforcement = waiting;
            fx(battle, 'summon', waiting, { src: unit.id, token: wolfId });
            return;
          }
          const board = pieces.find((t) => t.uid != null);
          const tile = tacticalPoint(battle, unit, board ? [board.homeR, board.homeC] : null);
          if (!tile) return;
          const w = battle.spawnToken(unit, wolfId, tile[0], tile[1], { kit: wolfKit(unit) });
          unit.trait.reinforcement = w;
          if (!w) return;
          fx(battle, 'summon', w, { src: unit.id, token: wolfId, wolves: w.mem.wolves });
          const again = Math.max(0, w.base.respawnTime || 0);
          battle.on('death', (c) => { if (c.unit === w && c.reason === 'killed') battle.after(again, spawn, { owner: unit }); }, { owner: w });
        };
        battle.on('deploy', (c) => { if (c.unit === unit) spawn(); }, { owner: unit });
        installPackMark(battle, unit);
        battle.on('death', (c) => {
          if (c.unit !== unit) return;
          const w = wolfOf(unit);
          if (w) battle.retreat(w, { reason: 'expired', permanent: true });
        }, { owner: unit });
      } },
      skill: {
        kind: 'duration',
        attack: { hits },
        onStart({ unit }) { unit.mem.vigilAcc = 0; unit.mem.vigilDp = 0; },
        onTick({ battle, unit, dt }) {
          const iv = num(bb.interval, 1.5), step = num(bb.cost, 1), cap = num(bb.value, 0);
          if (!(iv > 0) || !(step > 0)) return; // (junk blackboard: never spin)
          unit.mem.vigilAcc += dt;
          while (unit.mem.vigilAcc >= iv - 1e-9 && unit.mem.vigilDp + step <= cap + 1e-9) {
            unit.mem.vigilAcc -= iv;
            unit.mem.vigilDp += step;
            battle.addDp(unit.ownerId, step);
          }
        },
        onEnd({ battle, unit, reason }) {
          // the whole `value` is granted over a full duration (精锐: 11 × 1.364 s ends a hair after 15 s)
          const rest = num(bb.value, 0) - (unit.mem.vigilDp ?? 0);
          if (reason === 'duration' && rest > 1e-9) { battle.addDp(unit.ownerId, rest); unit.mem.vigilDp += rest; }
          fx(battle, 'dp', unit, { n: unit.mem.vigilDp ?? 0 });
        },
      },
      skills: altSkills(chess, d, bb, {
        // (自动触发: an AUTO skill takes no 技能策略 — the 战术家 row is for MANUAL skills — and this DP skill fires as soon
        // as it is ready, as before)
        skchr_vigil_1: (s) => ({
          kind: 'instant',
          trigger: 'SP_FULL',
          onStart({ battle, unit }) {
            dpGain(battle, unit, num(s.bb.cost, 0));
            const w = wolfOf(unit);
            if (w) addShadow(battle, unit, w);
          },
        }),
        skchr_vigil_2: (s) => ({
          kind: 'instant',
          onStart({ battle, unit }) {
            dpGain(battle, unit, num(s.bb.cost, 0));
            const w = wolfOf(unit);
            if (!w) return;
            const hr = num(s.bb['vigil_wolf_s_2.hp_ratio'], 0);
            if (hr > 0) battle.heal(w, w, w.s.maxHp * hr, { self: true });
            w.mem.vigilGift = { scale: num(s.bb['vigil_wolf_s_2.atk_scale'], 1), dp: num(s.bb['vigil_wolf_s_2.cost'], 0), paid: false };
            fx(battle, 'buff', w, { src: unit.id, skill: 'vigil_2' });
          },
        }),
      }),
      install(battle, unit) { if (sel === 'skchr_vigil_2') installGift(battle, unit); },
      talents: [
        { install() { /* 狼群领袖: the pack itself (trait.install / wolfKit) */ } },
        { install(battle, unit) {
          battle.on('hit', (ctx) => {
            const w = wolfOf(unit);
            // "伺夜和狼群对其的攻击无视其175防御力": their attacks only (not item procs or other non-attack damage)
            if (!w || pen <= 0 || !ctx.dmg.isAttack || (ctx.source !== unit && ctx.source !== w) || ctx.target.blockedBy !== w) return;
            ctx.dmg.defIgnoreFlat += pen;
          }, { owner: unit });
          battle.on('damaged', (ctx) => {
            const w = wolfOf(unit);
            if (!w || !(bonus > 0) || !unit.skill?.active || !ctx.dmg?.isAttack || (ctx.source !== unit && ctx.source !== w)) return;
            const e = ctx.target;
            if (e.side !== 'enemy' || !e.alive || e.blockedBy !== w) return;
            // "狼群与伺夜攻击…时，额外造成…": the extra hit belongs to that attack's dealer (a bite's bonus is the pack's
            // damage — never re-typed by 伺夜's 弱点伤害 特质), its size to 伺夜's ATK (same as tokens.js unmanaged mode)
            battle.dealDamage(ctx.source, e, { amount: unit.s.atk * bonus, type: 'arts', canDodge: false, isSkill: true, tags: ['skill', 'vigilBonus'] });
          }, { owner: unit });
        } },
      ],
    };
  },

  // ---- 3_20 耶拉 · 驭械术师 — S2 心随意动: +1 drone (2 locks; a lone enemy gets both), ATK +, cold procs; 低眉: ATK +
  //      (more with ≥cnt ground tiles in range)
  chess_char_3_20_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0);
    const extra = Math.floor(num(bb['attack@cnt'], 0));
    const prob = num(bb['attack@prob'], 0), cold = num(bb['attack@cold'], 0);
    const kit = {
      trait: { dmgMul: funnelMap },
      skill: {
        kind: 'duration',
        mods: { atkPct: num(bb.atk) },
        attack: { onHit({ battle, unit, target }) {
          if (target && target.alive && cold > 0 && battle.rng.chance(prob)) battle.applyStatus(target, 'cold', { duration: cold, source: unit });
        } },
      },
      // S1 攻击力强化·γ型: ATK + (one drone, the trait ramp as usual)
      skills: altSkills(chess, d, bb, { 'skcom_atk_up[3]': statSkill }),
      install(battle, unit) {
        installFunnelPrune(battle, unit);
        // "浮游单元+1": every drone locks an enemy — with fewer enemies in range than drones, the spare drone joins a
        // lock (both attack it, each hit rolls the cold proc; they ramp in parallel, see funnelMap)
        if (extra > 0) {
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || !unit.skill?.active || !ctx.targets.length) return;
            const n = 1 + extra;
            if (ctx.targets.length >= n) return;
            const base = ctx.targets.slice();
            const out = base.slice();
            for (let i = 0; out.length < n; i++) out.push(base[i % base.length]);
            ctx.targets = out;
          }, { owner: unit, priority: -50 });
        }
      },
      talents: [{ install(battle, unit) {
        battle.on('deploy', (ctx) => {
          if (ctx.unit !== unit) return;
          let low = 0;
          for (const k of unit.baseRangeKeys || []) {
            const r = (k / COLS) | 0, c = k % COLS;
            if (battle.grid.inRect(r, c) && battle.grid.isLow(r, c)) low++;
          }
          const atk = low >= num(t0.cnt, 2) ? num(t0['kjera_t_1[high].atk'], num(t0.atk)) : num(t0.atk);
          battle.addBuff(unit, { key: 'talent:kjera_brow', mods: { atkPct: atk } });
        }, { owner: unit });
      } }],
    };
    if (extra > 0) kit.skill.targeting = { maxTargets: 1 + extra };
    return kit;
  },

  // ---- 3_21 空弦 · 速射手 — S3 箭矢·暴风: ATK +, range +1, 3 hits × 2 targets; 兰登战术: attack-SP snipers +1 SP / 2.5 s;
  //      铁弦: one-hit shield at deployment, +7 SP when it breaks; 精锐 module MAR-Y: ASPD + with ground enemies in range
  //      S1 箭矢·散逸: next attack ×atk_scale + up to max_target−1 other enemies around the target × atk_scale_2;
  //      S2 箭矢·追猎 (charges): an arrow fired at once hits its target `times` times, then bounces to the nearest enemy
  //      around not hit yet with one hit fewer each bounce (5, 4, 3, 2, 1). 精锐 MAR-X: fly × (profession layer);
  //      ISW-A (集成战略 only): no range bonus here.
  chess_char_3_21_a: (bb, chess, def) => {
    const d = defOf(chess, def);
    const t0 = talentBb(d, 0), t1 = talentBb(d, 1);
    const mod = moduleTalentBb(chess);
    const skill = {
      kind: 'duration',
      mods: { atkPct: num(bb.atk) },
      attack: { hits: Math.max(1, Math.floor(num(bb['attack@times'], 1))) },
    };
    const tg = {};
    if (num(bb.ability_range_forward_extend) > 0) tg.rangeExtend = Math.round(bb.ability_range_forward_extend);
    if (num(bb['attack@max_target']) > 1) tg.maxTargets = Math.floor(bb['attack@max_target']);
    if (Object.keys(tg).length) skill.targeting = tg;
    const physHit = (battle, unit, e, scale, tag) => battle.dealDamage(unit, e, { amount: unit.s.atk * scale * profileMul(battle, unit, e), type: 'phys', isSkill: true, tags: ['skill', tag] });
    const kit = {
      skill,
      skills: altSkills(chess, d, bb, {
        skchr_archet_1: (s) => {
          const more = Math.max(0, Math.floor(num(s.bb.max_target, 4)) - 1);
          const sc2 = num(s.bb.atk_scale_2, 1);
          return {
            kind: instantKindOf(s),
            attack: {
              atkScale: num(s.bb.atk_scale, 1),
              onHit({ battle, unit, target, x, y }) {
                const cx = target ? target.x : x, cy = target ? target.y : y;
                if (!Number.isFinite(cx) || !Number.isFinite(cy) || !(more > 0)) return;
                const others = enemiesAround(battle, unit, cx, cy, AROUND_R, new Set([target])).slice(0, more);
                for (const e of others) physHit(battle, unit, e, sc2, 'archetScatter');
                if (others.length) fx(battle, 'volley', unit, { targets: others.map((e) => e.id), skill: 'archet_1' });
              },
            },
          };
        },
        skchr_archet_2: (s) => {
          const times = Math.max(1, Math.floor(num(s.bb.times, 5)));
          const sc = num(s.bb.atk_scale, 1);
          return {
            kind: instantKindOf(s),
            onStart({ battle, unit }) {
              const first = enemiesOn(battle, unit, unit.rangeKeys, 1, unit.profile)[0];
              if (!first) return;
              const seen = new Set();
              const fire = (from, target, n) => {
                seen.add(target);
                battle.addProjectile({
                  from, target, speed: 16, visual: 'arrow', source: unit, hitDead: true,
                  onHit: ({ target: t, x, y }) => {
                    if (t && t.alive) for (let i = 0; i < n && t.alive; i++) physHit(battle, unit, t, sc, 'archetPursuit');
                    if (n <= 1) return;
                    const next = enemiesAround(battle, unit, x, y, AROUND_R, seen)[0];
                    if (next) fire({ x, y }, next, n - 1);
                  },
                });
              };
              fire(unit, first, times);
              fx(battle, 'volley', unit, { target: first.id, skill: 'archet_2' });
            },
          };
        },
      }),
      talents: [
        { install(battle, unit) { // 兰登战术
          unit.mem.archetTactics = true;
          battle.every(num(t0.interval, 2.5), () => {
            if (!alive(unit) || !isLeader(battle, unit, 'archetTactics')) return;
            for (const a of battle.allies(unit.ownerId)) {
              if (a.kind === 'op' && a.def?.profession === 'SNIPER' && a.skill?.spType === 'attack') giveSp(a, num(t0.sp, 1), 'talent');
            }
          }, { owner: unit });
        } },
        { install(battle, unit) { // 铁弦
          battle.on('deploy', (ctx) => {
            if (ctx.unit !== unit) return;
            battle.addBuff(unit, {
              key: 'talent:archet_shield', shieldHits: 1, visible: true,
              onRemove: ({ unit: u, buff }) => {
                if (buff.shieldHits > 0 || !u.alive) return;
                giveSp(u, num(t1.sp), 'talent');
                fx(battle, 'shieldBreak', u);
              },
            });
            fx(battle, 'shield', unit);
          }, { owner: unit });
        } },
      ],
    };
    if (mod && num(mod.attack_speed) > 0) kit.install = groundAspd('trait:archet_ground', num(mod.attack_speed));
    return kit;
  },
};

export default KITS;
