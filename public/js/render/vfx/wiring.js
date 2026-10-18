// render/vfx/wiring.js — the battle's events → official effects, generated from index.json (DESIGN §33.12): every
// unit's normal attack (its mode `Default`, or the mode its skill switches to while the skill is on — the skill plan's
// `modeName`, else `S<n>` for skill n; a mode's facing variant for the unit's facing) casts its `cast` effects at their
// spawn location or FollowMountPoint's point on the unit (a point a BoneFollower keeps on a Spine bone — the muzzle, a
// Special point — where the model draws that bone, at the attack clip's strike frame for the strike: mounts.js), flies
// its projectile's own flying effect from the muzzle along the sim's flight (the sim's speed: the visual lands with the
// sim's damage; flight.js: the projectile class's own `_mainEffect`, a harpoon's rope stretched from the shooter to the
// head, the client's Paracurve arc and AmiyaS2 wobble), plays what the projectile puts on its target and the target's
// tile as it starts (`toTargetOnStart` / `toTileOnStart`: 溯光星源 S3's lightning) and the projectile's `onHit` at the
// target's HitPoint on arrival (`onReached` where it lands; a timer projectile's at the end of its life) with the
// attack's own hit rows (round 46 R12), the damage or heal the sim lands for it before the flight ends covered meanwhile
// (R3 / R9: `_expect`); a chain's bounces draw its lightning line between the targets (`chain`, R14); a melee
// attack's `hit` effects play when its damage lands; status loops (generic.status by the sim's status names) follow the
// unit's mount point while the status lasts; deaths and deploys play the unit's own dead / start effect or the generic
// one. Index version 2 (DESIGN §33.16): a blocked (or blocking) unit's melee blow plays its mode's `combat`, a group
// attack the sub-abilities that fire (pickAttacks), a MultiHit emitter's hit groups by the hit's order (skillfx.js
// pickGroup), an UberAnimation emitter's replace groups with their animation, an InCertainMode emitter's rows in its mode
// only (_rowOk). The skill, talent and charge effects (render/vfx/skills.js plans) are played by `this.skills`
// (render/vfx/skillfx.js SkillFx): the skill's start / loop / end / ready / range, its attacks' rows, hit groups and
// projectile, its trigger, the 秘术师 charge, an enemy's skill window and the kit 'fx' tuples it stands for. What
// index.json cannot drive (an unknown unit, an enemy skill no signal opens) stays procedural: each entry point returns
// whether it drew the official effect.
//
//   const w = new FxWiring(ofx, { unitKey: (info) => string|string[]|null, record: (info) => data record,
//                                 view: (id) => view, speed: (kind) => tiles per game s })
//   await w.begin(infos)          preload the battle's units' effects (prep → battle); w.more(infos) those who join later
//   w.castStart(src, tgt, kind, { skip, left, skillOn }) / w.attack(src, tgt, kind, time, wound) / w.chain(prev, next,
//   kind, time) / w.damage(v, type, src, time) / w.heal(v, time) / w.status(v, name, on) / w.death(v) / w.deploy(v) /
//   w.skill(v, on) / w.enemyCast(v, slot) / w.sync(views) / w.simFx(kind, x, y, extra) / w.clear()
//
// The cast rows follow their ability events (DESIGN §33.12, resolved): ON_CAST_START rows play when the attack's wind-up
// begins (render/app.js starts the attacker's Spine clip ahead of the 'atk' event: `castStart`), ON_SPELL_ON rows at the
// strike (the 'atk' event), a looping row until the attack clip ends; NONE rows play their first slot, directional rows
// the slot for the owner's facing; `onlyOnce` and `hookEffectAfterFirstAttack` count the unit's attacks.
// [ASSUMED] (index.json does not say): the facing a directional row reads (`_dirIndex`); a looping cast without a wind-up
// stops after CAST_LOOP_S; `delayIfFirstAttack` is not applied (the field view's first attack has no lead-in clip);
// a FLIP_TWO_SIDE hit is mirrored when the blow comes from the right; the generic hit by damage type for a melee attack
// that lists none (an enemy's: `enemy`); a heal that came by no official projectile plays the generic heal hit; a
// 领主's ranged-kind 'atk' on the enemy it blocks is its Combat blow (`_combatKind`); a sim-melee attack whose official
// ability shoots flies its projectile for show (蒂比: `attack`); a chain's line stays CHAIN_LINE_S (`chain`).

import { spawnPoint, mountPoint, unitPoint, spawnKind, mountKind, spawnRotation, mountRotation, graphicRotation } from './mounts.js';
import { projectileParts, paracurve, arcHeight, wobble } from './flight.js';
import { GROUND_SPAWNS } from './effect.js';
import { SkillFx, fitsAttack, pickGroup, formMode } from './skillfx.js';
import { TalentFx } from './talentfx.js';
import { FunnelFx } from './funnelfx.js';
import { YuWall, YU_WALL_SOURCE } from './yuwall.js';
import { formModes } from './talents.js';
import { shotOf } from './skills.js';
import { UF } from '../../../../shared/constants.js';

/** Battle seconds a non-oneshot cast effect lasts without its end event. */
export const CAST_LOOP_S = 0.6;
/** Battle seconds a melee blow waits for its damage. */
const MELEE_WINDOW = 0.4;
/** Battle seconds a projectile's arrival covers the damage event it stands for. */
const ARRIVAL_WINDOW = 0.35;
/**
 * Battle seconds at most a projectile without a flying effect (a timer: SimpleProjectile with a LIMITED life — 溯光星源
 * S3, 迷迭香, 德克萨斯 S1's swords) holds its hit for the effect it put on its target to land (its `lifeTime`).
 */
export const TIMER_HIT_MAX = 1.5;
/**
 * Battle seconds before an official hit's arrival from which an HP 'dmg' (or 'heal') on its target is that hit's (R3: the
 * sim moves a shot in its firing tick and lands it about a tick before the drawn flight ends); an event in the attack's
 * own frame is always (a heal, a chain bounce, a sim-melee blow flown for show: the sim lands those at once).
 */
const CLAIM_LEAD = 0.2;
/** Battle seconds a chain's lightning line shows between two of its targets (its prefab loops) [ASSUMED]. */
export const CHAIN_LINE_S = 0.2;
/** Battle seconds after its shot's hit a chain stays open for the sim's bounces (it bounces in the hit's tick). */
const CHAIN_WINDOW = 0.5;
/** Tiles from a blocker's centre a blocked enemy stands within (the sim's block radius: ground 0.7071, air 0.8944). */
const BLOCK_REACH = 0.75, BLOCK_REACH_AIR = 0.95;
/** 'dmg' types of HP damage (shared/protocol.js; an element gauge fill names its element instead). */
const HP_TYPES = new Set(['phys', 'arts', 'true']);
/** The identity rotation: the root of a projectile's flying effect (the client parents it to the projectile's body). */
const ID_ROT = Object.freeze([0, 0, 0, 1]);

const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);
/** Torappu.SharedConsts.Direction order (a directional emitter row's `slots`). */
const DIRS = ['UP', 'RIGHT', 'DOWN', 'LEFT'];
/** Cast rows starting at these ability events start with the cast (0 ON_ATTACHED, 2 ON_CAST_START); 4 ON_SPELL_ON … at the strike. */
const CAST_START_EVENTS = new Set([0, 2]);
/** Bounces of a chain: no attack of the unit's own. */
const CHAIN = new Set(['chain', 'chainHeal']);
/** A point past `b` on the line from `a` (an effect on the target turned along the blow). */
const beyond = (a, b) => ({ x: b.x + (b.x - a.x), y: b.y + (b.y - a.y) });
/** Group abilities whose sub-abilities all cast together (index v2). */
const PARALLEL = /Parallel/;
/** Group abilities that pick one sub-ability at random per cast. */
const RANDOM = /Random/;
/** Attacks whose child abilities are funnels firing on their own (MultiFunnelRemoteAttack, MultiFunnelsNormalAttack). */
const FUNNEL = /Funnel/;
/** A selectable group's sub-ability for a unit that blocks (its node 'Blocked…': BlockedMeleeAttack, BlockedRangedAttack). */
const BLOCKED_NODE = /(?:^|\/)Blocked[A-Z]\w*$/;
/**
 * A mode name's facing variant (index.json modes: 'S2[Down]', 'S3[D]', 'S2+[DOWN]', 灰毫's 'S2(U)' / 'S2(D)' /
 * 'S2(LR)', 号角's 'S3(D)'): [1] the base name, [2] / [3] the facing.
 */
const MODE_VARIANT = /^(.*?)(?:\[(down|d|up|u|lr)\]|\((down|d|up|u|lr)\))$/i;

/**
 * The 狼群's buffs its VigilWolfEffectEmitter rows are bound to (`buffKey`), by the pack's wolves as the snapshot gives
 * them (b.snap `wolves` [left, max]: the view's `wolves`). The client plays such a row only while the owner holds that
 * buff (VigilWolfCastEffectOptions.PlayEffect calls Entity.ContainsBuff — GameAssembly.dll of 2026-09-13). The
 * 狼群领袖 talent's buffs (config/buff_template_holder.ab): every 狼影 beyond the pack itself is a
 * `vigil_wolf_t_1_enhance[holder]` whose derived `…[damage]` adds the attack's extra hit (`…[born]` makes one at the
 * deploy), and `…[trigger_override]` is created when the holders reach max_stack_cnt (2) and finished as soon as one is
 * lost — the pack at its most. So `…[damage]` while 2 wolves or more stand (vigil_token_sub_attack_1), `…[trigger_override]`
 * while all of them do (vigil_token_sub_attack_2) [ASSUMED: the sim's count is the pack's wolves, the client's holders
 * plus one — its initial 2 is `[born]`'s holder, its 至多3只 max_stack_cnt 2 + 1].
 */
export const WOLF_BUFFS = Object.freeze({
  'vigil_wolf_t_1_enhance[damage]': (left) => left >= 2,
  'vigil_wolf_t_1_enhance[trigger_override]': (left, max) => left >= 2 && left >= max,
});

/** Whether a 狼群 view holds a buff of WOLF_BUFFS now (its `wolves` [left, max]); false for any other buff or view. */
export function wolfHolds(v, buffKey) {
  const f = WOLF_BUFFS[buffKey];
  const w = v?.wolves;
  if (!f || !Array.isArray(w) || w.length < 2) return false;
  const left = Number(w[0]), max = Number(w[1]);
  return Number.isFinite(left) && Number.isFinite(max) && f(left, max);
}

/** A deterministic 32-bit seed of a unit and its attack count (random picks of groups and sub-abilities: replayable). */
export function seedOf(id, n) {
  let h = 2166136261;
  for (const c of String(id ?? '')) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  h = Math.imul(h ^ (n | 0), 2654435761);
  return (h ^ (h >>> 15)) >>> 0;
}

/** Whether an ability — or a group holding one — is the kind of attack the sim made. */
function abilityFits(a, kind, depth = 0) {
  if (!a || depth > 4) return false;
  if (Array.isArray(a.abilities) && a.abilities.length && !FUNNEL.test(a.class || '')) return a.abilities.some((x) => abilityFits(x, kind, depth + 1));
  return fitsAttack(a.class, kind);
}

/**
 * The attacks one 'atk' plays of an ability (index v2 / v3, DESIGN §33.12, §33.17): the ability itself and, of a group,
 * the sub-abilities that fire. Index v3's `select` says how: `parallel` (and a `sequence`'s steps) — every one, its
 * `main` first (its projectile is the attack's); `random` — a seeded pick (unit id × attack count: the same in a
 * replay; `diffFromLast` — never the previous one, `mem` keeping it per unit; weights by `probKeys` are not read: equal
 * odds [ASSUMED]); `loop` / `sequential` — in turn by the unit's attack count; `trigger` / `firstSucceed` — the first
 * whose trigger finds its target: the first of the attack's kind (a heal, a shot, a blow) — a `Blocked…` node (号角's
 * BlockedRangedAttack, the blocking unit's own blow: its trigger asks for a blocked enemy) only while the unit blocks
 * (`kind.blocked`), and then before the others —; a BurstAttackGroup's `burst` attack is left out (no signal marks
 * it). Without `select` (index v2) the class decides: Parallel all, Random a seeded pick, the others the first of the
 * kind. A funnel attack is itself (its funnels fire on their own). [ASSUMED]
 * @param {any} a an Attack of index.json
 * @param {{ heal?: boolean, ranged?: boolean, blocked?: boolean }} kind
 * @param {number} seed seedOf(unit, attack count)
 * @param {number} depth
 * @param {number} nth the unit's attack count
 * @param {Map<any, number>|null} mem the unit's last random picks by group
 */
export function pickAttacks(a, kind, seed = 0, depth = 0, nth = 0, mem = null) {
  if (!a) return [];
  const subs = Array.isArray(a.abilities) ? a.abilities.filter(Boolean) : [];
  if (!subs.length || FUNNEL.test(a.class || '') || depth > 4) return [a];
  const sel = a.select && typeof a.select === 'object' ? a.select : null;
  const method = sel?.method || (PARALLEL.test(a.class || '') ? 'parallel' : RANDOM.test(a.class || '') ? 'random' : 'first');
  const next = (x) => pickAttacks(x, kind, seed >>> 3, depth + 1, nth, mem);
  if (method === 'parallel' || method === 'sequence') {
    const main = Number.isInteger(sel?.main) ? subs[sel.main] : null;
    return [a, ...(main ? [main, ...subs.filter((x) => x !== main)] : subs).flatMap(next)];
  }
  const burst = Number.isInteger(sel?.burst) ? subs[sel.burst] : null;
  const cand = burst && subs.length > 1 ? subs.filter((x) => x !== burst) : subs;
  const fit = cand.filter((x) => abilityFits(x, kind));
  const held = fit.filter((x) => BLOCKED_NODE.test(x.node || ''));
  const free = fit.filter((x) => !BLOCKED_NODE.test(x.node || ''));
  const pick = kind.blocked && held.length ? held : free.length ? free : fit;
  const pool = pick.length ? pick : cand;
  let i = 0;
  if (method === 'random') {
    i = seed % pool.length;
    if (sel?.diffFromLast && mem && pool.length > 1) {
      const last = mem.get(a);
      if (last === i) i = (i + 1 + ((seed >>> 7) % (pool.length - 1))) % pool.length;
      mem.set(a, i);
    }
  } else if (method === 'loop' || method === 'sequential') i = nth % pool.length;
  return [a, ...next(pool[i])];
}

/**
 * The mode `name` (with an attack) of `modes`, or its facing variant (MODE_VARIANT) for `facing` — DOWN: [Down] / [D] /
 * (D), UP: [Up] / (U), LEFT / RIGHT: (LR) — when the unit has one; `variantsOnly`: a variant or nothing (a plain
 * mode is the plan's to name). [ASSUMED] the variants are per facing, by their names (the skill data that switches
 * between them is not exported); before DESIGN §32.14.36 only the plain name counted.
 * @param {any[]} modes
 * @param {string} name
 * @param {string} facing 'UP' | 'DOWN' | 'LEFT' | 'RIGHT'
 * @param {boolean} [variantsOnly]
 */
export function modeVariant(modes, name, facing, variantsOnly = false) {
  const want = facing === 'DOWN' ? ['down', 'd'] : facing === 'UP' ? ['up', 'u'] : ['lr'];
  let plain = null, fit = null, other = null;
  for (const m of modes || []) {
    if (!m || !(m.attack || m.combat)) continue;
    if (m.name === name) { plain = m; continue; }
    const g = MODE_VARIANT.exec(String(m.name || ''));
    if (!g || g[1] !== name) continue;
    if (want.includes((g[2] || g[3]).toLowerCase())) fit = fit || m;
    else other = other || m;
  }
  if (fit) return fit;
  if (variantsOnly) return plain ? null : other;
  return plain || null;
}

export class FxWiring {
  /**
   * @param {import('./system.js').OfficialFx} ofx
   * @param {{ unitKey?: (info: any) => string|string[]|null, record?: (info: any) => any, view?: (id: any) => any,
   *           speed?: (kind: string) => number }} [opts]  record: the unit's data record (render/app.js ctx.lookupDef — the
   *   skill plans read its skill); view: a battle view by id (the skill bindings place effects on a kit fx's target)
   */
  constructor(ofx, opts = {}) {
    this.ofx = ofx;
    this.opts = opts;
    this.idx = null;
    this.flights = new Set();     // projectile flights in the air
    this.walls = new Set();       // skill-held Yu S3 controller handles
    this.loops = new Map();       // `${unitId}|${status}` → handle
    this.melee = new Map();       // target id → the waiting blow { hits, modeGroups?, groups?, buffs?, src, t, n, hitT, window, seed }
    this.forms = new Map();       // unit id → its sim form (the form fx: render/app.js → form())
    this.formMaps = new Map();    // index unit key → { form: mode } (talents.js formModes)
    this.lastTargets = new Map(); // attacker id → the view its last attack named (a talent's added attack: TalentFx.fx)
    this.picks = new Map();       // unit id → Map(group ability → its last random pick: select.diffFromLast)
    this.arrived = new Map();     // target id → battle time of an official projectile hit
    this.pendingHit = new Map();  // target id → battle time until which an official hit still to come covers its damage
    this.healed = new Map();      // target id → battle time of an official heal projectile hit
    this.inAir = new Map();       // target id → official hits on their way [{ from, until, frame, t }] (_expect)
    this.chains = new Map();      // target id → the chain an official shot opened on it { proj, rows, src, line, at, until }
    this.keyCache = new Map();    // unit id → index unit key | null
    this.attackN = new Map();     // unit id → attacks so far (onlyOnce / hookEffectAfterFirstAttack rows)
    this.castFrame = new Map();   // unit id → the frame of its last attack (several targets of one attack cast once)
    this.skills = new SkillFx(this);
    this.talents = new TalentFx(this);
    this.funnels = new FunnelFx(this);
  }

  get index() { return this.idx; }

  /** index.json, once. */
  async ready() {
    if (!this.idx) this.idx = await this.ofx.lib.index();
    return !!this.idx;
  }

  /** The index unit key of a view (by its info), cached per battle id; null when index.json does not list it. */
  unitKeyOf(v) {
    if (!v || !this.idx) return null;
    const id = v.info?.id ?? v.id;
    let k = this.keyCache.get(id);
    if (k === undefined) {
      k = null;
      // (a point on the ground — a kit fx's tile, SkillFx — has no info and no unit)
      const cands = this.opts.unitKey && v.info ? [].concat(this.opts.unitKey(v.info) || []) : [];
      const rec = v.info ? this.opts.record?.(v.info) : null;
      if (this.idx.pluginUnits?.[rec?.charId]) cands.unshift(this.idx.pluginUnits[rec.charId]);
      if (rec?.fx?.unit) {
        this.ofx.lib.notePluginUnit?.(rec.fx.unit);
        // Explicit fx.unit uses exact keys only; the fallback art candidates below still accept suffixes.
        if (Object.hasOwn(this.idx.units || {}, rec.fx.unit)) cands.unshift(rec.fx.unit);
      }
      cands.push(v.info?.spine, v.info?.defId);
      for (const c of cands) {
        if (!c) continue;
        if (this.idx.units[c]) { k = c; break; }
        const base = String(c).replace(/_\d+$/, '');
        if (base !== c && this.idx.units[base]) { k = base; break; }
      }
      this.keyCache.set(id, k);
    }
    return k;
  }

  /** The index unit of a view (by its info), cached per battle id. */
  unitOf(v) {
    const k = this.unitKeyOf(v);
    return k ? this.idx.units[k] : null;
  }

  /** A battle view by id (opts.view), or null. */
  view(id) {
    if (id == null || typeof this.opts.view !== 'function') return null;
    const v = this.opts.view(id);
    return v && !v.destroyed ? v : null;
  }

  /** Whether the status wiring draws `key` on v now (a status loop whose generic key it is). */
  statusShows(v, key) {
    const st = this.idx?.generic?.status;
    if (!st) return false;
    const id = v?.id ?? v?.info?.id;
    for (const [name, k] of Object.entries(st)) {
      if (lc(k) !== key) continue;
      const h = this.loops.get(`${id}|${name}`);
      if (h && h.alive) return true;
    }
    return false;
  }

  skinOf(u) { return u && u.skin && this.idx ? this.idx.skins[u.skin] || null : null; }

  /**
   * Where a view stands, as mounts.js reads it: board feet + facing, the view itself (its model's bones: the
   * BoneFollower points) and the camera's tilt (the plane the drawn model faces).
   */
  pose(v) {
    return { x: v.x, y: v.y, z: (v.z || 0) + (v.hover || 0), left: (v.visFacing ?? v.facing ?? 1) < 0, back: typeof v._wantsBack === 'function' ? !!v._wantsBack() && !!v.entryBack : false, view: v, tilt: this._camTilt() };
  }

  /** The battle camera's tilt (degrees from straight down), or undefined (mounts.js SKELETON_TILT). */
  _camTilt() {
    const c = typeof this.ofx?.ctx?.cam === 'function' ? this.ofx.ctx.cam() : null;
    return c && Number.isFinite(c.tilt) ? c.tilt : undefined;
  }

  /** The battle's units' effect keys (for preloading; `generic` false: the units' own only). */
  keysFor(views, generic = true) {
    const keys = new Set();
    const g = generic ? this.idx?.generic : null;
    if (g) {
      for (const k of Object.values(g.hit || {})) if (k) keys.add(k);
      for (const k of Object.values(g.die || {})) if (k) keys.add(k);
      for (const k of Object.values(g.birth || {})) if (k) keys.add(k);
      for (const k of Object.values(g.status || {})) if (k) keys.add(k);
    }
    // an attack's rows and projectiles, its sub-abilities' too (index v2: a group's, a funnel attack's)
    const walk = (a, depth = 0) => {
      if (!a || depth > 4) return;
      for (const list of [a.cast, a.hit, a.castTarget, a.inputTarget]) {
        for (const e of list || []) {
          for (const k of e.effects || []) keys.add(k);
          for (const k of e.slots || []) if (k) keys.add(k);
          if (e.hookEffectAfterFirstAttack) keys.add(e.hookEffectAfterFirstAttack);
        }
      }
      for (const pk of [a.projectileKey, ...(a.extraProjectileKeys || [])]) {
        const p = pk && this.idx.projectiles[lc(pk)];
        if (p) for (const k of p.effects || []) keys.add(k);
      }
      for (const sub of a.abilities || []) walk(sub, depth + 1);
    };
    for (const v of views) {
      const u = this.unitOf(v);
      if (!u) continue;
      for (const m of u.modes || []) {
        walk(m.attack);
        walk(m.combat);   // index v2: the blow on a blocker (most enemies' only attack)
        if (m.overrideStartEffect) keys.add(m.overrideStartEffect);
        if (m.overrideDeadEffect) keys.add(m.overrideDeadEffect);
      }
      if (u.startEffect) keys.add(u.startEffect);
      if (u.deadEffect) keys.add(u.deadEffect);
    }
    // the skill, talent and charge effects (render/vfx/skillfx.js keys: plans, the skills' projectiles, bindings) and the
    // talents' and abilities' (render/vfx/talentfx.js, index v3)
    for (const k of this.skills.keys(views)) keys.add(k);
    for (const k of this.talents.keys(views)) keys.add(k);
    for (const k of this.funnels.keys(views)) keys.add(k);   // the 驭械术士's floating units (render/vfx/funnelfx.js)
    return [...keys].map(lc).filter((k) => k && this.ofx.lib.has(k));
  }

  /** Preload the effects of the battle's units (views) — the prep → battle switch. */
  async begin(views) {
    if (!this.ofx.active) return 0;
    await this.ready();
    if (!this.idx) return 0;
    const keys = this.keysFor(views);
    const n = await this.ofx.lib.preload(keys, { half: this.ofx.lite });
    this.ofx.warm?.(keys);
    return n;
  }

  /** Units that joined the battle (spawn events): their prefabs not loaded yet load now, without blocking. */
  more(views) {
    if (!this.ofx.active || !this.idx) return;
    const keys = this.keysFor(views, false).filter((k) => !this.ofx.lib.defs?.has(k));
    if (!keys.length) return;
    this.ofx.lib.preload(keys, { half: this.ofx.lite }).then(() => this.ofx.warm?.(keys), () => {});
  }

  /**
   * The attack mode of a unit now: while its skill is on (`skillOn`, else the skill's events, else UF.SKILL —
   * SkillFx.state), the mode its skill plan names (`modeName`, skills.js) or, without a plan, `S<n>` for skill n; an
   * enemy in a form the index names a mode for (skillfx.js formMode: Reborn, Stone, Fly …), that mode; else `Default`.
   */
  mode(u, v, skillOn) {
    const modes = u?.modes || [];
    if (!modes.length) return null;
    const st = this.skills.state(v, skillOn);
    const sn = Number.isInteger(v?.info?.skillIndex) ? `S${v.info.skillIndex + 1}` : null;
    const name = st.plan ? st.plan.modeName : sn;
    if (st.on && (name || sn)) {
      // the mode, or its variant for the unit's facing; a skill whose plan names no mode switches to the facing variants of
      // S<n> when the unit has them (灰毫 S2: S2(U) / S2(D) / S2(LR), no plain S2 — the extractor's name rule missed them)
      const m = modeVariant(modes, name || sn, this._facing(v), !name);
      if (m) return m;
    }
    // a form the data ties to a mode (talents.js formModes: a 重生's second form, a husk, a 傀儡师's 替身 → 风丸's Stand),
    // else a form named like a mode
    const fm = formMode(u, this.formOf(v), this.formMap(this.unitKeyOf(v)));
    if (fm) { const m = modes.find((x) => x.name === fm); if (m && (m.attack || m.combat)) return m; }
    return modeVariant(modes, 'Default', this._facing(v)) || modes.find((x) => x.name === 'Default') || modes[0];
  }

  /** The facing a mode variant is chosen by: an operator's deploy direction, else left / right by its facing. */
  _facing(v) {
    const d = typeof v?.dir === 'string' ? v.dir.toUpperCase() : null;
    return d === 'UP' || d === 'DOWN' || d === 'LEFT' || d === 'RIGHT' ? d : this.pose(v).left ? 'LEFT' : 'RIGHT';
  }

  /** A unit's sim form now: the last form fx (form()), else the view's / its info's (a view built mid-battle). */
  formOf(v) {
    const id = v?.id ?? v?.info?.id;
    if (id != null && this.forms.has(id)) return this.forms.get(id);
    return v?.form ?? v?.info?.form ?? null;
  }

  /** The form → mode map the data gives an index unit (talents.js formModes), cached. */
  formMap(key) {
    if (!key || !this.idx) return null;
    let m = this.formMaps.get(key);
    if (m === undefined) { m = formModes(this.idx, key); this.formMaps.set(key, m); }
    return m;
  }

  /**
   * A form fx of a unit (shared/protocol.js fxForm — render/app.js passes every one, a late one too): its mode from now
   * on (mode()), and the talents' 重生 rows (TalentFx.form). Returns true when something official drew.
   */
  form(v, form, extra = null) {
    if (!v) return false;
    const id = v.id ?? v.info?.id;
    if (id != null) this.forms.set(id, typeof form === 'string' ? form : null);
    if (!this.idx || !this.ofx.active || typeof form !== 'string') return false;
    return this.talents.form(v, form, extra);
  }

  /** The view an attacker's last attack named (TalentFx: the target of a talent's added attack), or null. */
  lastTarget(id) {
    const t = this.lastTargets.get(id);
    return t && !t.destroyed && t.alive !== false ? t : null;
  }

  /**
   * The facing variant a prefab names for its owner (SwitchableBackEffect for a unit facing up, SwitchableRightEffect,
   * SwitchableEffectByFaceDirection), or null to keep it; 'common_empty' means none.
   */
  _variant(sw, v, pose) {
    const dir = typeof v?.dir === 'string' ? v.dir.toUpperCase() : null;
    if (sw.back && (pose.back || dir === 'UP')) return sw.back;
    if (sw.right && (!pose.left !== !!sw.reverse)) return sw.right;
    if (dir === 'UP' && sw.up) return sw.up;
    if (dir === 'DOWN' && sw.down) return sw.down;
    if (dir === 'LEFT' && sw.left) return sw.left;
    return null;
  }

  /**
   * PauseEffectIf: whether the effect hides now. Each kept condition pauses by its CheckType (1: while it holds, 2:
   * while it does not); one the renderer cannot answer (a flag no view shows, an immunity, a buff …) never pauses it,
   * and so fails `_requireAllConditions`.
   */
  _paused(pz, v, pose) {
    let any = false, all = !pz.unknown;
    for (const q of pz.conds) {
      let h = null;
      switch (q.kind) {
        case 'flag': if (q.flags.some((f) => SEEN_FLAGS.has(f))) h = q.flags.some((f) => abnormal(v, f)); break;
        case 'notFlag': if (SEEN_FLAGS.has(q.flags[0])) h = !abnormal(v, q.flags[0]); break;
        case 'combo': if (q.combo === 0) h = abnormal(v, 43); break; // AbnormalCombo SLEEPING
        case 'back': h = pose.back || (typeof v?.dir === 'string' && v.dir.toUpperCase() === 'UP'); break;
        case 'right': h = !pose.left; break;
        default: break;
      }
      const p = h !== null && (q.no ? !h : h);
      if (p) any = true; else all = false;
    }
    return pz.all ? all && pz.conds.length > 0 : any;
  }

  /**
   * Spawn an effect key on a view (o: { toward (view|point), flipFrom (view), track, follow, stick, strike, loop,
   * important, skip, data }): at its FollowMountPoint's point when it has one — the client keeps it there from its first
   * frame, with the point's rotation unless `_keepOriginRotation` (a weapon effect rides its bone: 安洁莉娜's staff glow,
   * 灰毫's muzzle flash; a 驭械术士's floating unit its Special point) —, else at its spawn location (MUZZLE_POINT and the
   * Special points with the point's rotation; DESIGN §33.11). `follow`: a held effect (a status, an aura, a skill's or
   * a talent's loop) keeps to the unit — a FollowOwner / FollowTileHeight one to its feet, any other moves with it as
   * a `_holdByOwner` prefab does —; `stick`: the effect keeps to the view's spawn point while it lives (what a projectile
   * places on its target); `strike`: the points as the attack clip poses them at its strike frame. A prefab not loaded
   * yet is placed by index.json's summary (`prefabs[key].spawn`, and `follow`: its FollowMountPoint's point, followed
   * from the first frame) and takes up its rotation, direction and pause behaviours once it has loaded (an idle loop
   * started in the battle's first frames used to sit at the HitPoint for good).
   */
  playOn(key, v, o = {}) {
    let k = lc(key);
    if (!k || !this.ofx.lib.has(k)) return null;
    if (k === YU_WALL_SOURCE) {
      const wall = new YuWall(this, v);
      this.walls.add(wall);
      return wall;
    }
    let def = this.ofx.lib.def(k);
    if (def && def.switchable) {
      const alt = lc(this._variant(def.switchable, v, this.pose(v)));
      if (alt === 'common_empty') return null;
      if (alt && alt !== k && this.ofx.lib.has(alt)) { k = alt; def = this.ofx.lib.def(k); }
    }
    const u = this.unitOf(v);
    const skin = this.skinOf(u);
    const pose = this.pose(v);
    pose.strike = !!o.strike;
    let P = this._placing(def, def ? null : this.idx?.prefabs?.[k] || null, o);
    // (a point on the ground — a kit fx's tile, a projectile's target tile — is a map position, no unit: the client's
    // Effect._InitLocation sets no rotation, the prefab root keeps its own)
    if (!v.info) P.loaded = false;
    const pos = P.fmp ? mountPoint(skin, P.fmp.mount, pose) : spawnPoint(skin, P.spawn, pose);
    const ground = (v.z || 0);
    if (P.onGround) pos[2] = -ground;
    const place = { pos, groundZ: -ground, yaw: 0, mirror: false, flipY: false, mountRot: null, rootRot: null };
    this._rotate(P, place, skin, pose);
    this._orient(def, place, pose, o, v);
    const opts = { track: o.track || null, data: o.data ?? null, loop: !!o.loop, important: !!o.important, skip: o.skip > 0 ? o.skip : 0, owner: v };
    // the owner each frame: FollowMountPoint keeps the effect on the unit's point (and its rotation), a held effect
    // moves with the unit (`keep`), FollowDirection turns it with the unit, PauseEffectIf hides it while the unit shows
    // a condition; a prefab with chained effects (OnPlayEmitter: system.js FxHandle._start hands them this track) has
    // one for them
    const stick = !!o.stick;
    if (!o.track && (P.follow || P.keep || stick || !def || def.direction || def.pause || def.onPlay?.length)) {
      let d = def;
      const at0 = [pose.x, pose.y, pose.z], kept = new WeakMap(), chained = new Map();
      opts.track = (fx) => {
        if (!v || v.destroyed) return;
        if (!d) {
          d = this.ofx.lib.def(k);
          if (d) {
            // loaded now: its own placement (a FollowOwner, `_keepOriginRotation`), and once the rotation and the
            // direction it takes at its spawn (a mount point's, FLIP_TWO_SIDE, towards the target)
            P = this._placing(d, null, o);
            if (!v.info) P.loaded = false;
            const pl = { yaw: fx.yaw, mirror: fx.mirror, flipY: fx.flipY, mountRot: null, rootRot: null };
            this._rotate(P, pl, skin, pose);
            this._orient(d, pl, pose, o, v);
            fx.yaw = pl.yaw; fx.mirror = pl.mirror; fx.flipY = pl.flipY; fx.mountRot = pl.mountRot; fx.rootRot = pl.rootRot;
          }
        }
        const p = this.pose(v);
        // a chained effect by its own prefab: its FollowMountPoint keeps it on its point, its `_holdByOwner` with the unit
        let Q = P;
        if (d && fx.def && fx.def !== d) {
          Q = chained.get(fx.def);
          if (!Q) {
            chained.set(fx.def, Q = this._placing(fx.def, null, {}));
            if (!v.info) Q.loaded = false;
            // its rotation is its own spawn location's (the client plays it on the unit as any other effect), not its
            // parent's
            const pl = { mountRot: null, rootRot: null };
            this._rotate(Q, pl, skin, p);
            fx.mountRot = pl.mountRot; fx.rootRot = pl.rootRot;
          }
        }
        const G = Q.fmp ? Q : P;
        if (G.follow) {
          mountPoint(skin, G.follow.mount, p, fx.anchor);
          if (G.onGround) fx.anchor[2] = -(v.z || 0);
          fx.groundZ = -(v.z || 0);
          if (Q.rotFollow && Q.loaded) fx.mountRot = mountRotation(skin, Q.rotKind, p, fx.mountRot || [0, 0, 0, 1]);
        } else if (stick && v.alive !== false) {
          const sp = spawnPoint(skin, P.spawn, p);
          fx.anchor[0] = sp[0]; fx.anchor[1] = sp[1]; fx.anchor[2] = P.onGround ? -(v.z || 0) : sp[2];
          fx.groundZ = -(v.z || 0);
        } else if ((P.keep || Q.keep) && v.alive !== false) {
          // held by the unit: it moves with the unit, its offset from the feet as it started (the client holds such an
          // effect on its owner: `_holdByOwner`) [ASSUMED]
          let at = kept.get(fx);
          if (!at) kept.set(fx, at = at0.slice());
          fx.anchor[0] += p.x - at[0]; fx.anchor[1] += p.y - at[1];
          fx.anchor[2] = P.onGround ? -(v.z || 0) : fx.anchor[2] - (p.z - at[2]);
          at[0] = p.x; at[1] = p.y; at[2] = p.z;
          fx.groundZ = -(v.z || 0);
        }
        if (d && d.direction) {
          const pl = { yaw: fx.yaw, mirror: fx.mirror, flipY: fx.flipY, mountRot: fx.mountRot };
          this._orient(d, pl, p, {}, v);
          fx.yaw = pl.yaw; fx.mirror = pl.mirror; fx.flipY = pl.flipY;
        }
        if (d && d.pause) fx.hidden = this._paused(d.pause, v, p);
      };
    }
    return this.ofx.spawn(k, place, opts);
  }

  /**
   * Where an effect sits on its unit, from its descriptor or — not loaded yet — index.json's summary `sum` (`spawn`,
   * `follow`: a FollowMountPoint's MountPointType): `spawn` its spawn location (HIT without either); `fmp` its
   * FollowMountPoint, followed from the first frame; `follow` the point it keeps to — the FollowMountPoint's, else for a
   * held loop (o.follow) a FollowOwner's / FollowTileHeight's (the feet); `rotKind` the rotation it takes (_rotate): a
   * FollowMountPoint without `_keepOriginRotation` its point's every frame (`rotFollow`; FOOT: 'foot', the face's
   * skeleton root), else its spawn location's once (mounts.js spawnRotation: 'graphic' — FOOT / HIT / HEAD, the
   * unit's Graphic tilt —, MUZZLE_POINT's or a Special point's, else none: the identity), which a FollowMountPoint with
   * `_keepOriginRotation` keeps; `loaded` false for a summary (no rotation until the descriptor says); `onGround` a
   * ground spawn; `keep` no point to keep to, but the unit holds it — a held effect (o.follow), a `_holdByOwner`
   * prefab —: it moves with the unit.
   */
  _placing(def, sum, o) {
    const spawn = def ? def.spawn : Number.isInteger(sum?.spawn) ? sum.spawn : 2;
    const fmp = def ? (def.follow && !def.follow.owner ? def.follow : null) : Number.isInteger(sum?.follow) ? { mount: sum.follow } : null;
    const follow = fmp || (o.follow && def?.follow) || null;
    let rotKind = null, rotFollow = false;
    if (def) {
      if (fmp && !fmp.keepRot) { rotKind = fmp.mount === 0 ? 'foot' : mountKind(fmp.mount); rotFollow = !!rotKind; }
      else rotKind = spawnRotation(spawn);
    }
    const keep = !follow && (!!o.follow || !!def?.holdByOwner);
    return { spawn, fmp, follow, rotKind, rotFollow, loaded: !!def, onGround: GROUND_SPAWNS.has(spawn) && !fmp, keep };
  }

  /**
   * The rotation of an effect on a unit (_placing): a point's world rotation — the Graphic tilt, the facing turn, the
   * bone's angle — as `mountRot` (it faces with the unit: FLIP_TWO_SIDE adds no flip, _orient), else the spawn
   * location's as `rootRot`: the unit's Graphic tilt for FOOT / HIT / HEAD — no facing turn: FLIP_TWO_SIDE still flips
   * it — and the identity for the others (both replace the prefab root's own rotation, as the client's
   * Effect._InitLocationFromEntity does). Before 0.3.1 (history §34.6) FOOT / HIT / HEAD effects took no tilt: an effect
   * authored standing lay on the board (荒芜拉普兰德 S3's seal, 能天使 S3's light bars, 灰毫 S2's smoke over her legs).
   */
  _rotate(P, place, skin, pose) {
    place.mountRot = null; place.rootRot = null;
    if (!P.loaded) return;
    if (P.rotKind === 'graphic') place.rootRot = graphicRotation(skin);
    else if (P.rotKind) place.mountRot = mountRotation(skin, P.rotKind, pose);
    else place.rootRot = ID_ROT;
  }

  /**
   * Direction of an effect (ParticleEffect `_rotateType`): FLIP_TWO_SIDE turns the `_rotationY` helper 180° (or
   * mirrors the effect without one) for a left-facing owner — a hit by the blow's side —; FOUR_DIRECTION / ANY_DIR
   * turn towards the target, or along the owner's body direction (`_useBodyRotation`: an operator's deploy direction,
   * an enemy's facing); FOUR_DIRECTION snaps to the four directions.
   */
  _orient(def, place, pose, o, v) {
    if (!def) return;
    const rt = def.rotateType;
    // an effect that takes its mount point's rotation faces with the unit already (the FaceSwitcher's turn is part of
    // that rotation): FLIP_TWO_SIDE adds no flip of its own [ASSUMED]
    if (rt === 1 && place.mountRot) return;
    if (rt === 1) {
      let left = pose.left;
      if (o.flipFrom) left = o.flipFrom.x > pose.x; // a blow from the right splashes to the left
      const flip = left !== def.leftIsDefault;
      if (def.rotY >= 0) place.flipY = flip; else place.mirror = flip;
    } else if (rt === 2 || rt === 4) {
      let a;
      // CastEffectOptions.CreateEffect (official client): useFourDirectionalFace selects the owner's
      // four-direction vector, not owner→target. Wild Mane S2 sets it; her hit row does not.
      if (o.fourFace || def.useBodyRotation || !o.toward) a = bodyYaw(v, pose);
      else {
        const dx = o.toward.x - pose.x, dy = o.toward.y - pose.y;
        a = Math.abs(dx) + Math.abs(dy) > 1e-4 ? Math.atan2(dy, dx) : bodyYaw(v, pose);
      }
      if (rt === 2) a = Math.round(a / (Math.PI / 2)) * (Math.PI / 2);
      place.yaw = a;
    }
  }

  /**
   * The keys an emitter row plays now (index.json Emit, DESIGN §33.12): nothing after the unit's first attack for an
   * `onlyOnce` row, `hookEffectAfterFirstAttack` from its second attack on; directionType 0 (NONE) its first slot; a
   * directional row its slot for the owner's facing (`slots`, Torappu.SharedConsts.Direction: 0 UP, 1 RIGHT, 2 DOWN,
   * 3 LEFT; null = nothing), its first key without `slots` (an index written before Phase 1b).
   */
  _rowKeys(e, v, nth) {
    if (!e) return [];
    if (nth > 0 && e.onlyOnce) return [];
    if (nth > 0 && e.hookEffectAfterFirstAttack) return [e.hookEffectAfterFirstAttack];
    const keys = (e.effects || []).filter(Boolean);
    if (!e.directionType || !Array.isArray(e.slots)) return keys.slice(0, 1);
    const k = e.slots[this._dirIndex(e.directionType, v)];
    return k ? [k] : [];
  }

  /**
   * The facing a directional row picks its slot by: L_OR_R (1) the side the unit faces, U_OR_D (2) its back view
   * (facing up) or front view, the four-direction types (3 FOUR_DIR, 4 UD_OR_LR, 5 FOUR_DIR_FIXED) an operator's deploy
   * direction, else the view's facing. [ASSUMED] (the client's choice is engine code).
   */
  _dirIndex(type, v) {
    const pose = this.pose(v);
    const d = typeof v?.dir === 'string' ? v.dir.toUpperCase() : null;
    if (type === 1) return pose.left ? 3 : 1;
    if (type === 2) return pose.back || d === 'UP' ? 0 : 2;
    const i = d ? DIRS.indexOf(d) : -1;
    return i >= 0 ? i : pose.back ? 0 : pose.left ? 3 : 1;
  }

  /**
   * An attack's cast rows (`cast` on the attacker, `castTarget` / `inputTarget` on its target) for a phase: 'start' —
   * the rows that start with the cast (ON_CAST_START; the wind-up began), 'strike' — the others (ON_SPELL_ON: the
   * attack fires), 'all' — both at the strike (an attack nobody wound up). A looping row stops when the attack clip
   * ends (`info.left` s, from the wind-up) or after CAST_LOOP_S; `info.skip` starts the effects that far in;
   * `info.owner` false: the target rows only (another target of the same attack).
   */
  _casts(a, src, tgt, phase, info = {}) {
    const nth = this.attackN.get(src.id ?? src.info?.id) || 0;
    for (const [rows, onTarget] of [[a.cast, false], [a.castTarget, true], [a.inputTarget, true]]) {
      if (!onTarget && info.owner === false) continue;
      for (const e of rows || []) {
        const first = e.startEvent == null || CAST_START_EVENTS.has(e.startEvent);
        if ((phase === 'start' && !first) || (phase === 'strike' && first) || (onTarget && !tgt)) continue;
        const skip = phase === 'start' ? info.skip : 0;
        for (const k of this._rowKeys(e, src, nth)) {
          // the rows of the strike sit where its attack clip poses the unit's points at the strike frame
          const h = onTarget
            ? this.playOn(k, tgt, { toward: beyond(src, tgt), flipFrom: src, skip })
            : this.playOn(k, src, { toward: tgt, fourFace: !!e.useFourDirectionalFace, skip, strike: phase !== 'start' });
          // a looping row stops at its end event (the cast's end); so does a looping prefab on a one-shot row, which
          // would otherwise never end (known once loaded: decided when the time comes)
          if (h) {
            const loopRow = !e.oneshot;
            setTimeout0(this.ofx, { stop: () => { if (loopRow || this.ofx.lib.def(h.key)?.isLoop) h.stop(); } }, phase === 'start' && info.left > 0 ? Math.min(3, info.left) : CAST_LOOP_S, true);
          }
        }
      }
    }
  }

  /**
   * What one 'atk' of a unit plays from its mode (index v2, DESIGN §33.12): the mode's `combat` — the blow on a blocker —
   * for a melee blow of a unit that blocks or is blocked (UF.BLOCKED) or when the mode has no `attack`, else its
   * `attack`; the attacks that fire (pickAttacks: a group's sub-abilities); their rows as their emitters allow (_rowOk);
   * a MultiHit emitter's grouped hit rows as the hit groups (with its loop / random / once settings; its rows without a
   * group only with `keepBaseHitEffect`); the first projectile, and (index v3) the shots of the ability firing it — its
   * mount, a mount group's points, its follow-up shots (skills.js shotOf) — and its class (`shotClass`: a ranged ability
   * flies for show when the sim makes the attack melee, attack()). Index v1's attacks have none of these fields and pass
   * through unchanged.
   * @returns {{ cast: any[], castTarget: any[], inputTarget: any[], hit: any[], groups: any[][]|null, hitOpts: any, projectileKey: string|null, shot: any, shotClass: string|null }|null}
   */
  _attackSet(u, m, src, tgt, kind, nth) {
    if (!m) return null;
    let a = m.attack || null;
    if (m.combat && (!a || (kind === 'none' && ((src.flags | 0) & UF.BLOCKED)))) a = m.combat;
    if (!a) return null;
    const heal = !!tgt && !tgt.isEnemy && !src.isEnemy;
    const id = src.id ?? src.info?.id;
    let mem = this.picks.get(id);
    if (!mem) { mem = new Map(); this.picks.set(id, mem); }
    const list = pickAttacks(a, { heal, ranged: !!kind && kind !== 'none', blocked: !!((src.flags | 0) & UF.BLOCKED) }, seedOf(id, nth), 0, nth, mem);
    const set = { cast: [], castTarget: [], inputTarget: [], hit: [], groups: null, hitOpts: null, projectileKey: null, shot: null, shotClass: null };
    const modeIdx = (u?.modes || []).indexOf(m);
    for (const x of list) {
      const ems = Array.isArray(x.emitters) ? x.emitters : [];
      const ok = (r) => this._rowOk(r, ems[r?.emitter], src, nth, modeIdx);
      for (const f of ['cast', 'castTarget', 'inputTarget']) for (const r of x[f] || []) if (ok(r)) set[f].push(r);
      for (const r of x.hit || []) {
        if (!ok(r)) continue;
        const em = ems[r.emitter];
        const multi = em?.class === 'MultiHitUberEffectEmitter';
        if (multi && Number.isInteger(r.group)) {
          if (!set.groups) {
            set.groups = Array.from({ length: Math.max(r.group + 1, Number(em.groups?.hitGroups) | 0) }, () => []);
            set.hitOpts = { loop: em.useLoopHitEffect === 1, random: em.useRandomHitEffect === 1, once: em.oncePerTarget === 1 };
          }
          (set.groups[r.group] || (set.groups[r.group] = [])).push(r);
        } else if (multi && (Number(em.groups?.hitGroups) | 0) > 0 && em.keepBaseHitEffect !== 1) {
          // a MultiHit emitter's own rows without a group give way to its groups unless it keeps them (none in this client)
        } else set.hit.push(r);
      }
      if (!set.projectileKey && lc(x.projectileKey)) { set.projectileKey = lc(x.projectileKey); set.shot = shotOf(x, this.idx.projectiles); set.shotClass = x.class || null; }
    }
    return set;
  }

  /**
   * Whether an emitter row plays on this attack (index v2): an UberAnimation replace group's row (`anim`) when the
   * attack plays its animation — the group animations replace `sourceAnimKey` in turn by the unit's attack count for
   * `loopType` 0 (LOOP), at random for 1 (RANDOM: index v3's `loopTypeName`; a seeded pick by unit id × attack count, the
   * same in a replay); an InCertainMode emitter's in its mode (`activeMode`: the mode's index); a VigilWolf row bound to
   * a buff of its owner (`buffKey`) while the 狼群 holds that buff by its 狼影 count (wolfHolds); a row bound to a buff no
   * view shows never.
   */
  _rowOk(r, em, src, nth, modeIdx) {
    if (!r) return false;
    if (r.buffKey) return em?.class === 'VigilWolfEffectEmitter' && wolfHolds(src, r.buffKey);
    if (em?.class === 'UberEffectEmitterInCertainMode' && Number.isInteger(em.activeMode) && modeIdx >= 0 && em.activeMode !== modeIdx) return false;
    if (r.anim && em?.class === 'UberAnimationEffectEmitter') {
      const anims = Array.isArray(em.replaceAnims) ? em.replaceAnims : [];
      if (!anims.length) return true;
      const random = typeof em.loopTypeName === 'string' ? em.loopTypeName === 'RANDOM' : em.loopType === 1;
      return r.anim === anims[(random ? seedOf(src.id ?? src.info?.id, nth) : nth) % anims.length];
    }
    return true;
  }

  /**
   * An attack's wind-up began (render/app.js: the attacker's Spine clip starts so that its strike frame lands with the
   * 'atk' event): the cast rows that start with the cast play now. info: { skip (s of the clip the wind-up started
   * past), left (s until the clip ends), skillOn (whether the owner's skill is on at the strike: the look-ahead saw its
   * 'skill' event queued before the 'atk') }. While the skill is on, its own attack's rows replace the mode's
   * (SkillFx.attackFx).
   */
  castStart(src, tgt, kind, info = {}) {
    if (!this.ofx.active || !src || !this.idx || CHAIN.has(kind)) return false;
    kind = this._combatKind(src, tgt, kind, info.skillOn);
    const sk = this.skills.attackFx(src, tgt, kind, info.skillOn);
    const u = this.unitOf(src);
    const nth = this.attackN.get(src.id ?? src.info?.id) || 0;
    const set = sk?.replace ? null : this._attackSet(u, this.mode(u, src, info.skillOn), src, tgt, kind, nth);
    // a funnel shot's casts on its floating unit (耶拉's token) start with the owner's wind-up
    const fun = this.funnels.castStart(src, tgt, kind, info);
    if (!set && !sk) return fun;
    if (set) this._casts(set, src, tgt, 'start', info);
    if (sk) this.skills.casts(sk, src, tgt, 'start', info);
    return true;
  }

  /**
   * b.ev 'atk': the casts (those that start with the cast only when its wind-up did not play them: `wound`), the
   * projectile and the blow's hits, which wait for its damage (a melee or direct attack's hit rows on every HP hit of
   * its frame, a MultiHit emitter's groups by the hit's order; a projectile attack's rows with its projectile's hit). While
   * the owner's skill is on, the skill's part (SkillFx.attackFx): its own attack's rows, hit groups and projectile replace
   * the mode's, or its `each` rows join them; a 秘术师's stored energies leave with the attack (SkillFx.released). Round
   * 46: a 领主's ranged-kind 'atk' on the enemy it blocks is its Combat blow (_combatKind, R15); an attack the sim makes
   * melee whose official ability is a ranged one with a projectile (蒂比: RangedAttack, the sim's 天空行者 melee) flies
   * that projectile for show, at its own speed (R16) [ASSUMED: display only — the sim's damage lands at the blow, covered
   * until the drawn hit]; a direct ranged attack (no projectile of its own: 能天使's, a 阵法术师's beam) is drawn by its
   * official rows alone when it has any (R4). Returns true when the unit's official attack was drawn (the procedural
   * shot is skipped).
   */
  attack(src, tgt, kind, time, wound = false) {
    if (!this.ofx.active || !src || !this.idx) return false;
    kind = this._combatKind(src, tgt, kind);
    const u = this.unitOf(src);
    const sk = this.skills.attackFx(src, tgt, kind);
    const id = src.id ?? src.info?.id;
    // one attack on several targets is one 'atk' per target in one tick: the attacker casts once (its target rows play
    // on each target), and it counts as one attack [ASSUMED: the same frame = the same attack]
    const again = this.castFrame.get(id) === this.skills.frame;
    const nth = Math.max(0, (this.attackN.get(id) || 0) - (again ? 1 : 0));
    const set = this._attackSet(u, this.mode(u, src), src, tgt, kind, nth);
    const a = sk?.replace ? null : set;
    if (tgt) this.lastTargets.set(id, tgt);
    // the 驭械术士's floating units (render/vfx/funnelfx.js): they leave home and hit with the attack, or fly the funnel
    // shot from their point; the body shot of another target of the same attack is not flown (`skipBody`)
    const fun = this.funnels.attack(src, tgt, kind, time, again, wound);
    if (!a && !sk) return !!fun;
    this.castFrame.set(id, this.skills.frame);
    const phase = wound ? 'strike' : 'all';
    if (a) this._casts(a, src, tgt, phase, { owner: !again });
    if (sk) { this.skills.casts(sk, src, tgt, phase, { owner: !again }); if (!again) this.skills.attacked(sk); }
    if (!again) this.attackN.set(id, nth + 1);
    // the hit rows wait for the damage (each target hit: HitEffectOptions); useOwnerToTargetDirection turns the hit
    // along the blow
    const keysOf = (rows) => rows.flatMap((e) => this._rowKeys(e, src, nth).map((k) => ({ k, along: !!e.useOwnerToTargetDirection })));
    const hits = keysOf(a?.hit || []);
    // the projectile: a ranged skill attack's own, else the mode's (a sub-ability's)
    const pk = sk?.projectile || set?.projectileKey || null;
    const proj = pk ? this.idx.projectiles[pk] : null;
    const isShot = kind && kind !== 'none';
    const tid = tgt ? tgt.id ?? tgt.info?.id : null;
    // the hit groups (the mode's MultiHit ones, the skill's) and the buffs the skill's attack puts on the target wait
    // for the damage, ranged or not
    const rec = { hits, src, t: time, n: 0, hitT: null, window: MELEE_WINDOW, seed: seedOf(id, nth) };
    if (a?.groups) { rec.modeGroups = a.groups.map(keysOf); rec.modeOpts = a.hitOpts; }
    if (sk && (sk.fx.hit.length || sk.buffs.length)) { rec.groups = sk.fx.hit; rec.hitOpts = sk.fx.hitOpts; rec.buffs = sk.buffs; rec.U = sk.U; }
    const grouped = !!(rec.groups || rec.modeGroups);
    // a sim-melee attack whose official ability is a ranged one with a projectile (蒂比): the projectile flies for show
    const heal = !!tgt && !tgt.isEnemy && !src.isEnemy;
    const display = !isShot && !!proj && !!tgt && !src.isEnemy && !sk?.projectile && fitsAttack(set?.shotClass, { heal, ranged: true });
    const flies = !!proj && !!tgt && (isShot || display);
    if (flies && fun?.skipBody) return true;
    if (flies) {
      // index v3: where the shot leaves (mount, a mount group's points) and its follow-up shots (skills.js shotOf); the
      // attack's hit rows play with its projectile's hit (none of the index's projectiles has an onHit and rows both:
      // 能天使 S2/S3, 录武官, 烛煌 S3 have only rows), its hit groups on the damage
      const shot = sk?.projectile ? sk.shot : set?.shot;
      const mount = this._shotMount(shot, id, nth);
      const fo = { hits: grouped ? [] : hits };
      if (mount != null) fo.mount = mount;
      if (display) fo.dur = this._displayTime(proj, src, tgt);
      const hitAt = this._fly(proj, src, tgt, kind, time, fo);
      if (!again) this._followUps(shot, pk, src, tgt, kind, time, mount);
      this.skills.released(src, tgt, kind, time);
      if (grouped) { rec.hits = []; rec.window = (fo.dur || this._flightTime(src, tgt, kind)) + ARRIVAL_WINDOW; this.melee.set(tid, rec); }
      // a chain lightning's shot: its bounces (the sim's 'chain' / 'chainHeal' events) draw its line from here (chain())
      const line = projectileParts(proj).chain;
      if (line && tid != null) this.chains.set(tid, { proj, rows: fo.hits, src, line, at: this.ofx.time + hitAt, until: this.ofx.time + hitAt + CHAIN_WINDOW });
      return true;
    }
    if (!isShot && tgt) {
      // melee: the hit effects wait for the damage (else the generic hit by damage type)
      this.melee.set(tid, rec);
      return true;
    }
    // a ranged attack without a projectile of its own (a direct shot, a beam): the hits play on its damage, which the sim
    // lands after its own flight; its official rows stand for the attack when it has any (no procedural shot over them) —
    // not when its projectile is missing from the index (the procedural shot stands for that one)
    if (tgt && (hits.length || grouped)) {
      rec.window = this._flightTime(src, tgt, kind) + ARRIVAL_WINDOW;
      this.melee.set(tid, rec);
    }
    return !pk && this._drawable(a, sk, src, nth);
  }

  /**
   * Whether an attack's official part draws anything (a direct ranged attack, R4): the mode's rows — its casts in any
   * phase (a wound-up attack played its first ones already), hit rows, hit groups — or the skill's cast, range, aim and
   * hit rows, with a key the library has. Without any (the data missing) the procedural shot stays.
   */
  _drawable(a, sk, src, nth) {
    const has = (k) => { const kk = lc(k); return !!kk && this.ofx.lib.has(kk); };
    const rowHas = (e) => this._rowKeys(e, src, nth).some(has);
    const entryHas = (e) => !!e && (has(e.key) || (Array.isArray(e.slots) && e.slots.some(has)));
    if (a) {
      for (const f of ['cast', 'castTarget', 'inputTarget', 'hit']) if ((a[f] || []).some(rowHas)) return true;
      if ((a.groups || []).some((g) => (g || []).some(rowHas))) return true;
    }
    if (sk) {
      for (const list of [sk.fx.cast, sk.fx.range, sk.fx.aim]) if ((list || []).some(entryHas)) return true;
      if ((sk.fx.hit || []).some((g) => (g || []).some(entryHas))) return true;
    }
    return false;
  }

  /**
   * The kind an 'atk' is drawn as (R15). The sim names every attack of a 领主 — and of a 情报官 (伊内丝), whose modes hold
   * a ranged Attack and a melee Combat too — by its ranged kind, the enemy it blocks included; the client strikes that
   * enemy with the Combat ability (the mode's `combat`) and shoots the others. A ranged-kind 'atk' of an operator on an
   * enemy while both show UF.BLOCKED and the enemy stands within the block reach of its centre (BLOCK_REACH: the sim's
   * block radius) is drawn as a melee blow ('none') when its mode has both. [ASSUMED: the snapshot does not say who
   * blocks whom — an enemy that close is the operator's]
   */
  _combatKind(src, tgt, kind, skillOn) {
    if (!kind || kind === 'none' || CHAIN.has(kind) || !src || !tgt || src.isEnemy || !tgt.isEnemy) return kind;
    if (!((src.flags | 0) & UF.BLOCKED) || !((tgt.flags | 0) & UF.BLOCKED)) return kind;
    const reach = (tgt.flags | 0) & UF.FLYING ? BLOCK_REACH_AIR : BLOCK_REACH;
    if (!(Math.hypot(tgt.x - src.x, tgt.y - src.y) <= reach)) return kind;
    const u = this.unitOf(src);
    const m = u ? this.mode(u, src, skillOn) : null;
    return m && m.attack && m.combat ? 'none' : kind;
  }

  /**
   * The flight of a projectile flown for show (a sim-melee attack, R16): the distance at the projectile's own speed
   * (index.json movement `speed`, tiles per s), else the sim's arrow speed.
   */
  _displayTime(proj, src, tgt) {
    const sp = Number(proj?.movement?.speed);
    const speed = sp > 0 ? sp : this.opts.speed ? this.opts.speed('arrow') : 12;
    return Math.max(0.04, Math.min(1.5, Math.hypot(tgt.x - src.x, tgt.y - src.y) / speed));
  }

  /** The MountPointType a shot leaves from (a mount group's point in turn or at random by attack count), or null (muzzle). */
  _shotMount(shot, id, nth) {
    if (!shot) return null;
    const g = shot.mountGroup;
    if (g && g.mounts.length) return g.mounts[(g.random ? seedOf(id, nth) : nth) % g.mounts.length];
    return shot.mount;
  }

  /**
   * A multi attack's follow-up shots (index v3 `additionalTimes`, every `triggerDelta` s, flying `additionalProjectile(s)`
   * else the attack's own): drawn only — the sim deals all of the attack's hits with the attack (its 'dmg' events) [ASSUMED].
   */
  _followUps(shot, pk, src, tgt, kind, time, mount) {
    if (!shot || !(shot.times > 0)) return;
    for (let i = 1; i <= shot.times; i++) {
      const key = shot.additional[i - 1] || pk;
      const proj = key ? this.idx.projectiles[key] : null;
      if (!proj) continue;
      const go = () => { if (tgt && !tgt.destroyed && tgt.alive !== false && src && !src.destroyed) this._fly(proj, src, tgt, kind, this.ofx.time, mount != null ? { mount, later: shot.delta > 0, followUp: true } : { later: shot.delta > 0, followUp: true }); };
      if (!(shot.delta > 0)) go();
      else setTimeout0(this.ofx, { stop: go }, shot.delta * i, true);
    }
  }

  /** The sim's flight time of a shot of `kind` from src to tgt (battle s). */
  _flightTime(src, tgt, kind) {
    const speed = this.opts.speed ? this.opts.speed(kind) : 12;
    return Math.max(0.04, Math.min(3, Math.hypot(tgt.x - src.x, tgt.y - src.y) / Math.max(0.1, speed)));
  }

  /**
   * A projectile's flight (DESIGN §33.12 Projectile, render/vfx/flight.js): its own flying effect (projectileParts
   * `main`: the projectile class's `_mainEffect`) from the shot's mount point as the attacker's model draws it now — the
   * muzzle bone at the strike frame (o.mount: a MountPointType instead — a 秘术师's stored energy leaves its slot, a
   * mount group's point) — to the target's HitPoint in the sim's flight time, homing on it; a ParacurveMovement lobs it
   * along the client's arc (`paracurve`: `raiseHeight` above the start), an AmiyaS2Movement wobbles it across its path
   * (`wobble`), and a HarpoonRenderer's rope (`rope`) runs from the mount point as it is drawn to the head while it
   * flies, then fades from the shooter to the target. A chain lightning's line (`chain`) is not flown: the client plays
   * it between the chain's targets as the shot reaches them (the sim's 'chain' bounces: chain()). As it starts,
   * the effects the projectile puts on its target and on the target's tile (index.json `toTargetOnStart` /
   * `toTileOnStart`: EffectBehaviour _effectsToTargetWhenStart / _effectsToTileWhenStart — 溯光星源 S3's lightning
   * falling on the target, 迷迭香's blades) play there, turned by the shot's side and kept on the target. A projectile
   * with no flying effect of its own is a timer whose hit lands at the end of its life (_alwaysHitTraceTargetInTheEnd):
   * its hit waits for its life when that is longer than the sim's flight (up to TIMER_HIT_MAX), the target's damage
   * meanwhile covered (no procedural spark) [ASSUMED: the sim keeps its own flight time for the damage]. The hit plays the
   * projectile's onHit and `o.hits`, the attack's own hit rows (R12); the damage or heal the sim lands for the shot before
   * the drawn hit is the shot's (`_expect`, R3 / R9; not for a drawn follow-up shot, `o.followUp`). `o.dur`: a flight
   * time of its own (a shot flown for show, R16). Returns the battle seconds until the hit.
   */
  _fly(proj, src, tgt, kind, time, o = {}) {
    const su = this.unitOf(src), tu = this.unitOf(tgt);
    const sSkin = this.skinOf(su), tSkin = this.skinOf(tu);
    // the start: the mount point as the attack clip poses it at its strike frame (a follow-up shot: as it is drawn then);
    // a rope's end on the shooter follows the point as it is drawn
    const startAt = (out, strike = false) => {
      const pose = this.pose(src);
      pose.strike = strike;
      return Number.isInteger(o.mount) ? mountPoint(sSkin, o.mount, pose, out) : unitPoint(sSkin, 'muzzle', pose, out);
    };
    const from = startAt([0, 0, 0], !o.later);
    const to0 = unitPoint(tSkin, 'hit', this.pose(tgt));
    const dur = o.dur > 0 ? o.dur : this._flightTime(src, tgt, kind);
    const mv = proj.movement || {};
    const id = src.id ?? src.info?.id;
    const seed = seedOf(id, this.attackN.get(id) || 0);
    const arc = paracurve(mv, -from[2], -to0[2], Math.hypot(to0[0] - from[0], to0[1] - from[1]), seed);
    const wob = wobble(mv, seed);
    const parts = projectileParts(proj);
    for (const k of proj.onStart || []) this.playOn(k, src, { toward: tgt, strike: !o.later });
    const placed = this._startOnTarget(proj, src, tgt);
    const mainKey = parts.main && this.ofx.lib.has(parts.main) ? parts.main : null;
    const ropeKey = parts.rope && this.ofx.lib.has(parts.rope) ? parts.rope : null;
    // a timer (no flying effect: 溯光星源 S3): its hit when the effect it put on its target lands, at the end of its life
    let hitAt = dur;
    if (!mainKey) {
      const life = Number(parts.life);
      if (placed && life > dur && life <= TIMER_HIT_MAX) hitAt = life;
      if (hitAt > dur && tgt) this.pendingHit.set(tgt.id ?? tgt.info?.id, this.ofx.time + hitAt);
    }
    // the hit's time on the effects' clock (the render time `time` is another clock), the attack's rows, the damage covered
    const t0 = this.ofx.time;
    const rows = Array.isArray(o.hits) && o.hits.length ? o.hits : null;
    if (tgt && !o.followUp) this._expect(tgt, hitAt);
    if (!mainKey && !ropeKey) { this._arrive(proj, tgt, to0, t0 + hitAt, rows, src); return hitAt; }
    const flight = { t: -1, dur, from, to: to0.slice(), pos: from.slice(), next: from.slice(), done: false, rope: null };
    // the flight at t battle s: the head and a point a little further on (its direction), homing on the target's point
    const step = (t) => {
      if (t === flight.t) return;
      if (tgt && !tgt.destroyed && tgt.alive !== false) unitPoint(tSkin, 'hit', this.pose(tgt), flight.to);
      flight.t = t;
      const k = Math.min(1, t / flight.dur);
      this._flightPoint(flight, arc, wob, k, t, flight.pos);
      this._flightPoint(flight, arc, wob, Math.min(1, k + 0.02), t + 0.02 * flight.dur, flight.next);
    };
    // a 回环射手's boomerang (the movement's `comeBack`): the hit, then the way back to the thrower (comeBack())
    const back = this._comeBack(proj, kind);
    const finish = (fx) => {
      if (back && !flight.back) {
        // the end of its way out: its hit, then (a flying effect, the thrower still there) the way back
        this._arrive(proj, tgt, flight.to, hitAt > dur ? t0 + hitAt : null, rows, src);
        if (flight.rope !== fx && this._turnBack(flight, fx, back, src, sSkin, mv, seed)) return;
      }
      flight.done = true;
      // caught: the client clears a projectile's main effect as it stops (Projectile.ClearMainEffectIfNot → Effect.FinishMe),
      // and one without a `_delayToFinish` is recycled there and then — the boomerang does not fade on in the thrower's hands
      if (flight.back && !(fx.def?.delayToFinish > 0) && typeof fx.kill === 'function') fx.kill();
      else fx.stop(back ? {} : { hit: true });
      if (flight.rope && flight.rope !== fx) flight.rope.stop();
      this.flights.delete(flight);
      if (!back) this._arrive(proj, tgt, flight.to, hitAt > dur ? t0 + hitAt : null, rows, src);
    };
    const def = mainKey ? this.ofx.lib.def(mainKey) : null;
    const flipIfLeft = def ? def.flipIfLeft : false;
    const handle = mainKey ? this.ofx.spawn(mainKey, { pos: from.slice(), groundZ: -(src.z || 0), rootRot: ID_ROT }, {
      important: true,
      track: (fx) => {
        if (flight.done) return;
        if (flight.back) { if (!this._stepBack(flight, fx.time, src, sSkin)) { finish(fx); return; } } else step(Math.min(flight.dur, fx.time));
        // direction of travel (Unity frame): yaw in the board plane, pitch with the climb
        const p = flight.pos, q = flight.next;
        const dx = q[0] - p[0], dy = q[1] - p[1], dz = q[2] - p[2];
        const horiz = Math.hypot(dx, dy);
        fx.anchor[0] = p[0]; fx.anchor[1] = p[1]; fx.anchor[2] = p[2];
        if (flipIfLeft && dx < 0) { fx.mirror = true; fx.yaw = Math.atan2(dy, -dx); } // mirrored art: +x after the mirror
        else { fx.mirror = false; fx.yaw = Math.atan2(dy, dx); }
        fx.pitch = horiz > 1e-5 || Math.abs(dz) > 1e-5 ? Math.atan2(-dz, horiz) : 0;
        if (flight.back ? flight.back.done : fx.time >= flight.dur) finish(fx);
      },
    }) : null;
    if (ropeKey) {
      // the rope: its LineRenderers from the shooter's mount point now to the head (effect.js linkLines; a world-space
      // line draws nothing before); without a head it flies the shot itself
      const drive = !handle;
      flight.rope = this.ofx.spawn(ropeKey, { pos: from.slice(), groundZ: -(src.z || 0), rootRot: ID_ROT }, {
        important: true,
        track: (fx) => {
          if (flight.done) return;
          step(Math.min(flight.dur, fx.time));
          fx.linkLines(startAt(fx.anchor), flight.pos);
          if (fx.time >= flight.dur) { if (drive) finish(fx); else fx.stop(); }
        },
      });
    }
    if (handle || flight.rope) this.flights.add(flight);
    else this._arrive(proj, tgt, to0, t0 + hitAt, rows, src);
    return hitAt;
  }

  /**
   * A point of a flight at fraction k (t battle s in): the ground track from the start to the target's point now, the
   * height of the Paracurve arc (else straight), the AmiyaS2 wobble across the path — perpendicular to it in the plane
   * the camera sees [ASSUMED: the projectile body faces its flight and the camera] — into `out`.
   */
  _flightPoint(f, arc, wob, k, t, out) {
    const a = f.from, b = f.to;
    out[0] = a[0] + (b[0] - a[0]) * k;
    out[1] = a[1] + (b[1] - a[1]) * k;
    out[2] = arc ? -arcHeight(arc, k, -b[2]) : a[2] + (b[2] - a[2]) * k;
    if (wob) {
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const tl = (this._camTilt() ?? 30) * Math.PI / 180;
      const fy = Math.sin(tl), fz = Math.cos(tl);   // the camera's forward in the Unity frame
      const px = fy * dz - fz * dy, py = fz * dx, pz = -fy * dx;
      const l = Math.hypot(px, py, pz);
      if (l > 1e-6) {
        const w = wob.amp * Math.sin(wob.phase + 2 * Math.PI * wob.hz * t) / l;
        out[0] += px * w; out[1] += py * w; out[2] += pz * w;
      }
    }
    return out;
  }

  /**
   * The way back of a projectile whose movement comes back (index.json movement `comeBack` — the 回环射手 跃跃 and
   * 娜仁图亚: AdvancedMovement / ParacurveMovement.Comeback, GameAssembly of 2026-09-13): after its hit the client gives the
   * movement a new leg from where it is to the thrower's HitPoint (the source's hitMountPoint, followed) at its speed ×
   * `comeBackSpeedScale` (0.25: 15 → 3.75 tiles/s — PRTS 跃跃 "返回时飞行速度3.75", the sim's BOOMERANG_RETURN_SPEED), a
   * ParacurveMovement's again along its arc, and the flying effect plays on until the thrower catches it (before 0.3.1 it
   * stopped at the hit). The leg steps at that speed toward her HitPoint as it is now — a duration locked at the turn
   * reaches a thrower who has moved on the original ETA, faster than the come-back speed. Returns { speed } (tiles per
   * battle s: the sim's return speed for its boomerang kind) or null.
   * The client's pause at the hit is not 1 s. On a ParacurveMovement / NarantS3Movement `delayAfterReached` is only 0
   * or 1 (a flag, the same pair as AttachToTarget's `_delayAfterReached`) and `delayTime` is the seconds — 0.01 for
   * projectile_chr_caper_s2 / _s2_1 and projectile_chr_narant_s3 / _s3_1 / _s3_2. An AdvancedMovement has no
   * `delayTime`; its `delayAfterReached` is the seconds (0.01 for the come-back ones; 0 for narant_s2, whose onward
   * dash is `moveAheadTime`). amUpdateAfterReach waits the fixed-point at +0x110; pmUpdateAfterReach waits the raw
   * float at +0xec [ASSUMED: that float is `delayTime`]. 0.01 s is under one sim tick (1/30): the return projectile is
   * added in the hit's onHit and first moves on the next tick. 跃跃 S2 fires an extra projectile and 娜仁图亚 S3's blast
   * is the catch — neither skill hovers — so a drawn pause would put the effect behind the sim's catch. The visual
   * turns back on the hit, on the sim's timing. A 娜仁图亚 S1 bounce / S2 dash comes straight back from its first target.
   */
  _comeBack(proj, kind) {
    const mv = proj?.movement;
    if (!mv || !(Number(mv.comeBack) > 0)) return null;
    const sim = kind === 'boomerang' && this.opts.speed ? Number(this.opts.speed('boomerangReturn')) : NaN;
    const own = Number(mv.speed) * (Number.isFinite(Number(mv.comeBackSpeedScale)) ? Number(mv.comeBackSpeedScale) : 1);
    const speed = sim > 0 ? sim : own > 0 ? own : 3.75;
    return { speed };
  }

  /**
   * Turn a come-back flight around at its hit (comeBack): its new leg from the hit point toward the thrower's HitPoint
   * at `back.speed` every frame (not a duration locked here); false when the thrower is gone (the client stops a
   * boomerang with no source: it is not drawn back).
   */
  _turnBack(flight, fx, back, src, sSkin, mv, seed) {
    if (!src || src.destroyed || src.alive === false) return false;
    flight.back = {
      last: fx.time, speed: back.speed, from: flight.pos.slice(), to: unitPoint(sSkin, 'hit', this.pose(src)),
      mv, seed: seed ^ 0x3c6ef372, arc: null, travelled: 0, done: false,
    };
    this._stepBack(flight, fx.time, src, sSkin);
    return true;
  }

  /** Rebuild a Paracurve come-back's arc when its start height, end height or ground distance has changed. */
  _syncArc(b) {
    if (!b.mv || b.mv.class !== 'ParacurveMovement') { b.arc = null; return; }
    const dist = Math.hypot(b.to[0] - b.from[0], b.to[1] - b.from[1]);
    const hs = -b.from[2], ht = -b.to[2];
    if (b.arc && b.hs === hs && b.ht === ht && b.dist === dist) return;
    b.hs = hs; b.ht = ht; b.dist = dist;
    b.arc = paracurve(b.mv, hs, ht, dist, b.seed);
  }

  /**
   * A come-back flight's way back at t (its effect's clock): step `speed · dt` toward the thrower's HitPoint now, and
   * stop on reaching it (`done`). A Paracurve one keeps its arc over the ground still left; false once she is gone.
   */
  _stepBack(flight, t, src, sSkin) {
    const b = flight.back;
    if (!src || src.destroyed || src.alive === false) return false;
    unitPoint(sSkin, 'hit', this.pose(src), b.to);
    const dt = Math.max(0, t - b.last);
    b.last = t;
    const dx = b.to[0] - flight.pos[0], dy = b.to[1] - flight.pos[1];
    const dist = Math.hypot(dx, dy);
    const step = b.speed * dt;
    if (!(dist > 1e-4) || (dt > 0 && step >= dist)) {
      flight.pos[0] = b.to[0]; flight.pos[1] = b.to[1]; flight.pos[2] = b.to[2];
      flight.next[0] = b.to[0]; flight.next[1] = b.to[1]; flight.next[2] = b.to[2];
      b.done = true;
      return true;
    }
    const ux = dx / dist, uy = dy / dist;
    const moved = dt > 0 ? step : 0;
    flight.pos[0] += ux * moved; flight.pos[1] += uy * moved;
    b.travelled += moved;
    const left = dist - moved;
    const ahead = Math.min(0.02 * b.speed, Math.max(left, 1e-4));
    flight.next[0] = flight.pos[0] + ux * ahead; flight.next[1] = flight.pos[1] + uy * ahead;
    if (b.mv && b.mv.class === 'ParacurveMovement') {
      this._syncArc(b);
      const total = b.travelled + left;
      const k = total > 1e-6 ? b.travelled / total : 1;
      flight.pos[2] = b.arc ? -arcHeight(b.arc, k, -b.to[2]) : flight.pos[2];
      const kn = Math.min(1, k + (total > 1e-6 ? ahead / total : 0));
      flight.next[2] = b.arc ? -arcHeight(b.arc, kn, -b.to[2]) : flight.pos[2];
    } else {
      if (moved > 0) flight.pos[2] += (b.to[2] - flight.pos[2]) * (moved / dist);
      flight.next[2] = flight.pos[2] + (b.to[2] - flight.pos[2]) * (ahead / left);
    }
    return true;
  }

  /**
   * A projectile's start on its target: `toTargetOnStart` on the target (FLIP_TWO_SIDE by the side the shot comes from,
   * a directional effect along it; it stays on the target while it lives: `_holdByOwner`), `toTileOnStart` on the
   * target's tile. Returns whether anything played.
   */
  _startOnTarget(proj, src, tgt) {
    if (!tgt || (!proj.toTargetOnStart?.length && !proj.toTileOnStart?.length)) return false;
    let n = 0;
    const toward = src ? beyond(src, tgt) : undefined;
    for (const k of proj.toTargetOnStart || []) if (this.playOn(k, tgt, { toward, flipFrom: src, stick: true })) n++;
    if (proj.toTileOnStart?.length) {
      const tile = { x: Math.round(tgt.x), y: Math.round(tgt.y), z: tgt.z || 0, visFacing: tgt.visFacing ?? 1 };
      for (const k of proj.toTileOnStart) if (this.playOn(k, tile, { toward, flipFrom: src })) n++;
    }
    return n > 0;
  }

  /**
   * A projectile reached its target (at `laterAt` on the effects' clock, else now): onHit at the target's HitPoint with
   * the attack's own hit rows (`rows` { k, along }: turned along the shot from `src` when the row says; a key the onHit
   * plays already is not played twice), onReached where it landed.
   */
  _arrive(proj, tgt, at, laterAt, rows = null, src = null) {
    const go = () => {
      const now = this.ofx.time;
      if (tgt && !tgt.destroyed) {
        for (const k of proj.onHit || []) this.playOn(k, tgt, {});
        if (rows) {
          const own = new Set((proj.onHit || []).map(lc));
          for (const h of rows) if (!own.has(lc(h.k))) this.playOn(h.k, tgt, { flipFrom: src || undefined, toward: h.along && src ? beyond(src, tgt) : undefined });
        }
        const id = tgt.id ?? tgt.info?.id;
        this.arrived.set(id, now);
        if ((proj.onHit || []).some((k) => /heal/.test(k))) this.healed.set(id, now);
      }
      // a skill binding places these where the kit's area fx says, for the area's time (SkillFx.bindsReached: 锡人's
      // flask, 波登可's spores …) — not a second copy at the flight's end (0.3.1)
      if (src && this.skills.bindsReached(src, proj)) return;
      for (const k of proj.onReached || []) {
        const kk = lc(k);
        if (kk && this.ofx.lib.has(kk)) this.ofx.spawn(kk, { pos: at.slice(), groundZ: at[2] }, {});
      }
    };
    if (laterAt == null) go();
    else setTimeout0(this.ofx, { stop: go }, Math.max(0, laterAt - this.ofx.time), true);
  }

  /**
   * An official hit on `tgt` lands in `s` battle s (R3 / R9): the HP damage or heal the sim lands for it is the hit's — in
   * the attack's frame (a heal, a chain bounce, a blow flown for show: the sim lands those at once) or from CLAIM_LEAD s
   * before the hit until ARRIVAL_WINDOW after (a shot: the sim lands it about a tick before the drawn flight ends). One
   * entry per target and frame (an attack's shots — a group's, a 秘术师's energies — stand for its hits of that frame).
   */
  _expect(tgt, s) {
    const id = tgt?.id ?? tgt?.info?.id;
    if (id == null) return;
    const now = this.ofx.time, frame = this.skills.frame;
    const at = now + Math.max(0, s);
    const list = this.inAir.get(id);
    const last = list ? list[list.length - 1] : null;
    if (last && last.frame === frame && last.t == null) { last.until = Math.max(last.until, at + ARRIVAL_WINDOW); return; }
    const f = { from: at - CLAIM_LEAD, until: at + ARRIVAL_WINDOW, frame, t: null };
    if (list) list.push(f); else this.inAir.set(id, [f]);
  }

  /**
   * Whether an official hit on its way (_expect) stands for an event on target `id` at render time `time`: one that took
   * an event of this frame before (an attack's several hits in one tick), else — `claim`: an HP hit or a heal — the
   * oldest one open now takes it.
   */
  _inAir(id, time, claim = true) {
    const list = this.inAir.get(id);
    if (!list) return false;
    const now = this.ofx.time, frame = this.skills.frame;
    let n = 0;
    for (const f of list) if (now <= f.until) list[n++] = f;
    list.length = n;
    if (!n) { this.inAir.delete(id); return false; }
    if (list.some((f) => f.t === time)) return true;
    if (!claim) return false;
    const f = list.find((x) => x.t == null && (x.frame === frame || now >= x.from));
    if (!f) return false;
    f.t = time;
    return true;
  }

  /**
   * The waiting record of a blow on target `id` for an event at `time` (null once its window passed, or — a skill
   * attack's hit groups — once a later frame's damage arrives: those hits were all dealt in one frame).
   */
  _pending(id, time) {
    const m = this.melee.get(id);
    if (!m) return null;
    if (time - m.t > (m.window ?? MELEE_WINDOW) || (m.hitT != null && m.hitT !== time)) { this.melee.delete(id); return null; }
    return m;
  }

  /**
   * b.ev 'dmg' on view v: a hit of the waiting blow (_landed), or nothing more when an official projectile just arrived;
   * the owner's skill `trigger` (SkillFx.trigger). Returns true when the official effect stands for this damage (no
   * procedural spark).
   */
  damage(v, type, src, time) {
    if (!this.ofx.active || !v || !this.idx) return false;
    // an element gauge fill ('dmg' typed by its element: a rider, a 灼燃 tick …) is no hit of the attack and no damage
    // taken in the skills' sense (the sim's TAKE_DAMAGE skips it too)
    const hpHit = type == null || HP_TYPES.has(type);
    if (hpHit) this.skills.trigger(v);
    const id = v.id ?? v.info?.id;
    const m = this._pending(id, time);
    // an attached floating unit's hit lands with its damage (荒芜拉普兰德's wolves: render/vfx/funnelfx.js)
    const fun = hpHit ? this.funnels.damage(v, time, type) : false;
    const drawn = (m && hpHit ? this._landed(m, v, time, type) : false) || fun;
    // an official shot on its way stands for the damage it brings (R3: the sim lands it before the drawn flight ends)
    const flying = this._inAir(id, time, hpHit);
    // a skill's kit hit (SkillFx.seen: no attack owns it — the frame's order names the skill): its hit stands for the spark
    if (hpHit && this.skills.seen(v, false, !!(m || src || fun || flying))) return true;
    // an enemy aura's tick on it (SkillFx.auraHit: 深溟巢涌者's pulse, 鼎沸's boil — the aura's buff effect on the unit)
    if (hpHit && this.skills.auraHit(v, !!(m || src || fun || flying))) return true;
    if (flying) return true;
    const arr = this.arrived.get(id);
    if (arr != null && this.ofx.time - arr < ARRIVAL_WINDOW) return true;
    const ph = this.pendingHit.get(id);
    if (ph != null && this.ofx.time <= ph) return true;
    return drawn;
  }

  /**
   * Hit k of the blow `m` on v — the k-th HP 'dmg' (or 'heal') on it in the blow's frame (the sim deals every hit of one
   * attack in one tick; a later frame's damage is no hit of it: _pending): the attack's hit rows without a group (every
   * hit), its MultiHit group (pickGroup), the skill's group and, the first hit, the buffs on the target (SkillFx.landed);
   * an attack with no hit rows of its own plays the generic hit by damage type (an enemy's: `enemy`; a heal's: `heal`).
   */
  _landed(m, v, time, type) {
    const k = m.hitT === time ? m.n : 0;
    m.hitT = time;
    m.n = k + 1;
    let drawn = false;
    const play = (list) => { for (const h of list) if (this.playOn(h.k, v, { flipFrom: m.src, toward: h.along && m.src ? beyond(m.src, v) : undefined })) drawn = true; };
    play(m.hits);
    if (m.modeGroups) play(pickGroup(m.modeGroups, k, m.modeOpts, m.seed));
    if (m.groups && this.skills.landed(m, v, k)) drawn = true;
    const own = m.hits.length || (m.modeGroups && m.modeGroups.some((g) => g.length)) || (m.groups && m.groups.some((g) => g.length));
    if (!own) {
      const g = this.idx.generic?.hit || {};
      const key = type === 'heal' ? g.heal : m.src?.isEnemy ? g.enemy : (type === 'arts' ? g.arts : g.phys);
      if (key) play([{ k: key, along: false }]);
    }
    return drawn;
  }

  /**
   * b.ev 'heal' on view v at `time` (the event's render time, as attack's): a hit of a waiting heal (_landed: its rows,
   * a skill heal's group); covered by an official heal on its way (_expect) or just arrived, else the generic heal hit.
   */
  heal(v, time) {
    if (!this.ofx.active || !v || !this.idx) return false;
    const id = v.id ?? v.info?.id;
    const m = Number.isFinite(time) ? this._pending(id, time) : null;
    if (m && this._landed(m, v, time, 'heal')) return true;
    // an official heal on its way stands for it (R9: the sim heals at the 'atk', the projectile's hit plays on arrival)
    const flying = this._inAir(id, time);
    if (this.skills.seen(v, true, !!m || flying)) return true;   // a skill's kit heal (SkillFx.seen)
    if (flying) return true;
    const t = this.healed.get(id) ?? this.arrived.get(id);
    if (t != null && this.ofx.time - t < ARRIVAL_WINDOW) return true;
    const k = this.idx.generic?.hit?.heal;
    return !!(k && this.playOn(k, v, {}));
  }

  /**
   * b.ev ['atk', prev, next, 'chain' | 'chainHeal']: a bounce of a chain (the sim names the previous target as its source
   * and bounces in the tick its shot hits — a heal's at once). A chain an official shot opened (attack: its projectile's
   * ChainLightningEffectBehaviour, projectileParts `chain` — 惊蛰, 异客, 莎草) draws the bounce as the client does when the
   * shot reaches its first target (ChainLightningHitBehaviour → PlayLineEffect): the line from the previous target's
   * HitPoint to the next one's and the projectile's hit — with the attack's rows — on the next; its damage or heal is the
   * bounce's meanwhile (_expect). Returns true when drawn (else the procedural arc). [ASSUMED: every bounce at the first
   * hit (`_interval` 0), the line between HitPoints for `_playEffectOnHitPoint` 0 too, shown CHAIN_LINE_S]
   */
  chain(prev, next, kind, time) {
    if (!this.ofx.active || !prev || !next || prev === next || !this.idx || !CHAIN.has(kind)) return false;
    const c = this.chains.get(prev.id ?? prev.info?.id);
    if (!c || this.ofx.time > c.until) return false;
    const nid = next.id ?? next.info?.id;
    if (nid != null) this.chains.set(nid, c);
    const delay = Math.max(0, c.at - this.ofx.time);
    this._expect(next, delay);
    const go = () => this._bounce(c, prev, next);
    if (delay > 0) setTimeout0(this.ofx, { stop: go }, delay, true);
    else go();
    return true;
  }

  /** A chain's bounce lands: its line from prev to next (kept on their HitPoints while it shows), its hit on next. */
  _bounce(c, prev, next) {
    if (!next || next.destroyed) return;
    const ps = this.skinOf(this.unitOf(prev)), ns = this.skinOf(this.unitOf(next));
    const a = unitPoint(ps, 'hit', this.pose(prev)), b = unitPoint(ns, 'hit', this.pose(next));
    if (c.line && this.ofx.lib.has(c.line)) {
      const h = this.ofx.spawn(c.line, { pos: a.slice(), groundZ: -(prev.z || 0) }, {
        important: true,
        track: (fx) => {
          if (!prev.destroyed && prev.alive !== false) unitPoint(ps, 'hit', this.pose(prev), a);
          if (!next.destroyed && next.alive !== false) unitPoint(ns, 'hit', this.pose(next), b);
          fx.anchor[0] = a[0]; fx.anchor[1] = a[1]; fx.anchor[2] = a[2];
          fx.linkLines(a, b);
        },
      });
      if (h) setTimeout0(this.ofx, h, CHAIN_LINE_S);
    }
    this._arrive(c.proj, next, b, null, c.rows, prev);
  }

  /**
   * b.ev 'status' on / off: the status loop follows the unit's mount point while it lasts (a skill's target loop of the
   * same key hands over to it: SkillFx.status).
   */
  status(v, name, on) {
    if (!v || !this.idx) return false;
    const id = v.id ?? v.info?.id;
    const slot = `${id}|${name}`;
    const prev = this.loops.get(slot);
    if (!on) { if (prev) { prev.stop(); this.loops.delete(slot); } return !!prev; }
    if (!this.ofx.active) return false;
    if (prev && prev.alive) return true;
    const key = this.idx.generic?.status?.[name];
    if (!key) return false;
    this.skills.status(v, lc(key));
    const h = this.playOn(key, v, { follow: true, loop: true, important: true });
    if (h) this.loops.set(slot, h);
    return !!h;
  }

  /** Stop every loop of a unit (it died / left): its status loops, its skill / charge loops, the skills' loops on it. */
  release(v) {
    const id = v?.id ?? v?.info?.id;
    for (const [slot, h] of this.loops) if (slot.startsWith(`${id}|`)) { h.stop(); this.loops.delete(slot); }
    this.skills.release(v);
    this.talents.release(v);
    this.funnels.release(v);
  }

  /** b.ev ['skill', id, on] (SkillFx.skill): true when the official layer shows the skill (no procedural burst / aura). */
  skill(v, on) {
    if (!v || !this.idx) return false;
    const drew = this.skills.skill(v, !!on);
    this.talents.skill(v, !!on);   // the talents a skill start casts (ON_SKILL_START)
    this.funnels.skill(v, !!on);   // the floating units of the skill's mode (render/vfx/funnelfx.js)
    return drew;
  }

  /** b.ev ['cast', id, slot, dur?] (an enemy's skill slot, SkillFx.cast): that skill's window. */
  enemyCast(v, slot, dur = 0) {
    if (!v || !this.idx || !Number.isInteger(slot)) return false;
    return this.skills.cast(v, slot, dur);
  }

  /** Once per frame after the views took the frame's sample (SkillFx.sync: mid-battle, passive, ready and charge loops). */
  sync(views) {
    if (!this.idx) return;
    const list = Array.isArray(views) ? views : [...views];   // (render/app.js passes the views Map's iterator)
    this.skills.sync(list);
    this.talents.sync(list);
    this.funnels.sync(list);
  }

  /**
   * b.ev 'fx' of a kit: the talents' and abilities' nodes it casts (TalentFx.fx: a fatal blow's 替身 / 不死, a stand-in's
   * end, a talent's added attack) and the skills' bindings (SkillFx.simFx): true when the official layer stands for it
   * (the procedural fx is skipped).
   */
  simFx(kind, x, y, extra) {
    if (!this.idx) return false;
    const t = this.talents.fx(kind, extra);
    // the floating units stand for the kit's 'drone' / 'drones' / 'droneLock' / 'overload' (render/vfx/funnelfx.js)
    const f = this.funnels.simFx(kind, x, y, extra);
    return this.skills.simFx(kind, x, y, extra) || t || f;
  }

  /** b.ev 'die': the unit's own death effect or the generic one. */
  death(v) {
    if (!v) return false;
    this.release(v);
    if (!this.ofx.active || !this.idx) return false;
    const u = this.unitOf(v);
    const m = u ? this.mode(u, v) : null;
    const g = this.idx.generic?.die || {};
    const key = lc(m?.overrideDeadEffect) || lc(u?.deadEffect) || (v.isEnemy ? g.enemy : g.char);
    return !!(key && this.playOn(key, v, {}));
  }

  /**
   * b.ev 'deploy': the unit's start effect (the client's Character.GetStartEffect: its skill's own — an AppearSkill's
   * `_overrideStartEffect`, SkillFx.birthOf —, else its mode's override, its own, else the generic deploy) — operators
   * and summons. A passive skill's start one-shots play the skill's own (SkillFx.deployed) and nothing else does
   * (0.3.1, audit R21: 缄默德克萨斯 S1–S3 and 斯卡蒂 S2 showed the generic pillar too).
   */
  deploy(v) {
    if (!v || !this.idx) return false;
    this.skills.deployed(v);   // a passive's loops and start one-shots (it is drawn whatever the deploy effect is)
    this.talents.deployed(v);  // the deploy talents' one-shots (耀骑士临光's birth), once per life
    if (!this.ofx.active || v.isEnemy) return false;
    const b = this.skills.birthOf(v);
    if (b && b.drawn) return b.own || b.empty ? true : !!this.playOn(b.key, v, {});
    const u = this.unitOf(v);
    const m = u ? this.mode(u, v) : null;
    const key = lc(m?.overrideStartEffect) || lc(u?.startEffect) || this.idx.generic?.birth?.char;
    return !!(key && this.playOn(key, v, {}));
  }

  /**
   * b.ev 'spawn' (an enemy, a summon, an operator's first deploy — its 'deploy' follows): the unit's deploy talents
   * (TalentFx.deployed, once per life: an enemy's AppearSyncedTalent auras, its birth effects). Returns true when drawn.
   */
  spawned(v) {
    if (!v || !this.idx) return false;
    return this.talents.deployed(v);
  }

  /** Battle reset. */
  clear() {
    for (const wall of this.walls) wall.kill();
    this.walls.clear();
    this.flights.clear();
    this.loops.clear();
    this.melee.clear();
    this.arrived.clear();
    this.pendingHit.clear();
    this.healed.clear();
    this.inAir.clear();
    this.chains.clear();
    this.keyCache.clear();
    this.attackN.clear();
    this.castFrame.clear();
    this.skills.clear();
    this.talents.clear();
    this.funnels.clear();
    this.forms.clear();
    this.lastTargets.clear();
    this.picks.clear();
    this.ofx.timers = [];
  }

  /** Called once per frame: delayed actions on the battle clock (and the frame count the skills' same-frame rules use). */
  tick() {
    this.skills.frame++;
    for (const wall of this.walls) { wall.update(); if (!wall.alive) this.walls.delete(wall); }
    const T = this.ofx.timers;
    if (!T || !T.length) return;
    const now = this.ofx.time;
    let w = 0;
    for (const t of T) {
      if (now >= t.at) { try { t.fn(); } catch { /* ignore */ } }
      else T[w++] = t;
    }
    T.length = w;
  }
}

/** The abnormal flags a client view can show (abnormal() below); PauseEffectIf ignores the others. */
export const SEEN_FLAGS = new Set([0, 9, 11, 12, 16, 17, 23, 25, 33, 43]);

/**
 * Whether a view shows an abnormal flag (Torappu.AbnormalFlag): the ones a client view knows from its b.snap flags
 * and statuses — STUNNED 0, INVISIBLE 9 / CAMOUFLAGE 17 (stealth), FROZEN 16, COLD 23, LEVITATE 25, SILENCED 12,
 * DISARMED 11, FEARED 33, DOZE 43 (sleep; also the SLEEPING combo). Others read as absent.
 */
function abnormal(v, flag) {
  const f = v?.flags | 0, st = v?.statuses;
  const has = (k) => !!(st && (typeof st.has === 'function' ? st.has(k) : st[k]));
  switch (flag) {
    case 0: return !!(f & UF.STUNNED) || has('stun');
    case 9: case 17: return !!(f & UF.STEALTH);
    case 16: return !!(f & UF.FROZEN) || has('freeze');
    case 23: return !!(f & UF.COLD) || has('cold');
    case 25: return has('levitate');
    case 12: return has('silence');
    case 11: return has('disarm');
    case 33: return has('fear');
    case 43: return !!(f & UF.SLEEP) || has('sleep');
    default: return false;
  }
}

/** The world yaw a unit faces: an operator's deploy direction (UP = +row), else its facing (±x). */
function bodyYaw(v, pose) {
  const d = typeof v?.dir === 'string' ? v.dir.toUpperCase() : null;
  if (d === 'UP') return Math.PI / 2;
  if (d === 'DOWN') return -Math.PI / 2;
  if (d === 'LEFT') return Math.PI;
  if (d === 'RIGHT') return 0;
  return pose.left ? Math.PI : 0;
}

/** Run `h.stop()` (or a function) after `s` battle seconds on the effects' clock. */
function setTimeout0(ofx, h, s, isFn = false) {
  if (!ofx.timers) ofx.timers = [];
  ofx.timers.push({ at: ofx.time + s, fn: isFn ? h.stop : () => h.stop() });
}

export { spawnKind };
