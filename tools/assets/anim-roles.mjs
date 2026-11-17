// Animation-role resolver for Arknights battle Spine models (research 07 §5.4).
//
// Model animation names vary a lot (Attack vs Attack_Begin/Loop/End vs Combat,
// Skill_2_Loop vs Skill2_Loop vs Skill_2, Die missing on Back models, enemies
// with several "forms" such as A_Idle/B_Idle or Idle_grey/Idle_red, …). The
// renderer should not guess at runtime, so tools/fetch-assets.mjs resolves each
// model once and stores the result in data/assets.json.
//
// A "clip" is { begin: string|null, loop: string, end: string|null, via?: string }:
// play `begin` once (if any), then `loop` (once per attack / repeatedly while a
// skill or move lasts), then `end` (if any). `via` is set when the clip is a
// fallback borrowed from another role ('combat', 'attackAny', 'skill', 'idle',
// 'attack'), so the renderer can add e.g. a flash when an attack is just Idle.
//
// Resolution order (names matched exactly first, then case-insensitively; the
// research order comes first, the generic patterns after it are extensions for
// models the research table did not cover):
//   idle   : Idle → first idle-like (Idle_A, A_Idle, Idle01; not Skill/Stun; animated ones first when
//            durations are given) → Default → first animation
//   deploy : Start → <form>Start → idle
//   attack : Attack → Attack_Start|Attack_Begin + Attack_Loop + Attack_End
//            → Attack_Begin + first numbered Attack_A + Attack_End (via attackAny) → Attack_Begin alone
//            → Combat → <form>Attack → first non-Down /^Attack/ (Attack_01, Attack_A) (via attackAny)
//            → first non-skill …_Attack (B_Attack) (via attackAny)
//            → Skill_1_Loop → Skill_Loop → Skill…Attack → Skill…_Loop (via skill) → idle (via idle)
//   attackDown: Attack_Down → Attack_Down_Begin/Loop/End → Combat_Down → first /^Attack.*Down/ → null
//   skill (0-based skill index i, n = i + 1), for each prefix P in Skill_n, Skilln, Skill_0n, then Skill:
//            loop = P_Loop → P_Attack… → P → P_Idle → P_Begin; begin = P_Begin|P_Start; end = P_End;
//            idle = P_Idle (replaces idle while the skill is active);
//            else the same over directional-only clips (Skill_Right_Loop, Skill_Loop_Up; Right before Up);
//            else attack (via attack); with `numberedSkills` (enemies) every numbered skill clip of the skeleton
//            (Skill_01, Skill_2_Loop …) adds its index after the caller's, giving `skills` (a multi-skill boss)
//   die    : Die → <form>Die → first /^Die/ → first /_Die$/ → null (renderer: Front model's Die, else fade)
//   move   : Move_Begin|Move_Start + (Move_Loop → Move) + Move_End → <form>Move → Run_Begin/Loop/End
//            → Run → first /^Move/ → null
//   run    : Run_Begin/Loop/End → Run → <form>Run → absent (only a model with its own Run cycle has the role)
//   stun   : (Stun_Begin | Dizzy_Begin) + (Stun → Stun_1 → Dizzy_Loop) (+ Stun_End | Dizzy_End) → Stun_Begin alone
//            → null (renderer: freeze the track)

/**
 * @typedef {{ begin: string|null, loop: string, end: string|null, via?: string }} Clip
 * @typedef {Clip & { index: number, idle: string|null }} SkillClip
 * @typedef {{ idle: string|null, deploy: string|null, attack: Clip|null, attackDown: Clip|null,
 *   skill: SkillClip|null, skills?: Record<string, SkillClip>, die: string|null, move: Clip|null, run?: Clip,
 *   stun: Clip|null }} Roles
 */

function makeFinder(names) {
  const exact = new Set(names);
  const lower = new Map();
  for (const n of names) {
    const k = n.toLowerCase();
    if (!lower.has(k)) lower.set(k, n);
  }
  return (name) => (name && exact.has(name) ? name : lower.get(String(name).toLowerCase()) ?? null);
}

function clip(begin, loop, end, via) {
  const c = { begin: begin ?? null, loop, end: end ?? null };
  if (via) c.via = via;
  return c;
}

const isDown = (n) => /down/i.test(n);
const isEdge = (n) => /_(begin|start|end)$/i.test(n);

/** First name (sorted) matching `re` and passing `ok`. */
function firstLike(names, re, ok = () => true) {
  return names.filter((n) => re.test(n) && ok(n)).sort()[0] ?? null;
}

/**
 * begin/loop/end triple for a prefix, e.g. prefix 'Move' → Move_Begin|Move_Start, Move_Loop (else the
 * plain 'Move'), Move_End. Begin-only models play the begin clip as the action.
 */
function triple(find, prefix) {
  const begin = find(`${prefix}_Begin`) ?? find(`${prefix}_Start`);
  const loop = find(`${prefix}_Loop`) ?? find(prefix);
  const end = find(`${prefix}_End`);
  if (loop) return clip(begin, loop, end);
  if (begin) return clip(null, begin, end);
  return null;
}

/**
 * Directional variants as virtual names: 'Skill_Right_Loop' → 'Skill_Loop', 'Skill_Loop_Up' → 'Skill_Loop'
 * (Right preferred over Up; `_Down` variants are never aliased). Used only as a last resort for skills
 * of models that have no undirected skill clips (char_279_excu, char_431_ashlok Back).
 * @param {string[]} names
 * @returns {{ names: string[], real: (name:string|null)=>string|null }}
 */
function directionalAliases(names) {
  const have = new Set(names.map((n) => n.toLowerCase()));
  const alias = new Map();
  for (const dir of ['Right', 'Up']) {
    const re = new RegExp(`_${dir}(?=_|$)`, 'i');
    for (const n of names) {
      if (isDown(n) || !re.test(n)) continue;
      const k = n.replace(re, '');
      const lk = k.toLowerCase();
      if (!have.has(lk) && !alias.has(lk)) alias.set(lk, { virtual: k, real: n });
    }
  }
  const virtuals = [...alias.values()].map((a) => a.virtual);
  return {
    names: [...names, ...virtuals],
    real: (name) => (name == null ? null : alias.get(name.toLowerCase())?.real ?? name),
  };
}

/** Form tag of multi-form enemies, from the idle name: 'A_Idle' → A_x, 'Idle_grey' → x_grey. */
function formFinder(find, idle) {
  if (!idle || /^idle$/i.test(idle)) return () => null;
  let m = /^(.+)_idle$/i.exec(idle);
  if (m) { const pre = m[1]; return (base) => find(`${pre}_${base}`); }
  m = /^idle(_?)(.+)$/i.exec(idle);
  if (m) { const sep = m[1]; const suf = m[2]; return (base) => find(`${base}${sep}${suf}`); }
  return () => null;
}

function resolveIdle(names, find, durations) {
  // Among generic idle-like clips prefer an animated one: 'Idle_A' of enemy_9014_acstma is a 0 s pose.
  const idleLike = (animated) => firstLike(names, /(^|_)idle/i,
    (n) => !/skill|stun|down/i.test(n) && (!animated || !(Number(durations?.[n]) <= 0)));
  return find('Idle')
    ?? (durations ? idleLike(true) : null)
    ?? idleLike(false)
    ?? find('Default')
    ?? firstLike(names, /^default/i)
    ?? names[0] ?? null;
}

function resolveAttack(names, find, form, idle) {
  const a = find('Attack');
  if (a) return clip(null, a, null);
  const begin = find('Attack_Begin') ?? find('Attack_Start');
  const end = find('Attack_End');
  const loop = find('Attack_Loop');
  if (loop) return clip(begin, loop, end);
  const numbered = firstLike(names, /^attack/i, (n) => !isDown(n) && !isEdge(n));
  if (begin) {
    // Attack_Begin + Attack_A/B/C + Attack_End (char_1045_svash2): the numbered clips are the attacks.
    return numbered ? clip(begin, numbered, end, 'attackAny') : clip(null, begin, end);
  }
  const c = find('Combat');
  if (c) return clip(null, c, null, 'combat');
  const fa = form('Attack') ?? form('Combat');
  if (fa) return clip(null, fa, null, 'attackAny');
  const any = numbered
    ?? firstLike(names, /(^|_)attack/i, (n) => !isDown(n) && !isEdge(n) && !/skill/i.test(n));
  if (any) return clip(null, any, null, 'attackAny');
  const s = find('Skill_1_Loop') ?? find('Skill1_Loop') ?? find('Skill_Loop')
    ?? firstLike(names, /^skill.*attack/i, (n) => !isDown(n) && !isEdge(n))
    ?? firstLike(names, /^skill.*_loop$/i, (n) => !isDown(n));
  if (s) return clip(null, s, null, 'skill');
  return idle ? clip(null, idle, null, 'idle') : null;
}

function resolveAttackDown(names, find) {
  const a = find('Attack_Down');
  if (a) return clip(null, a, null);
  const t = triple(find, 'Attack_Down');
  if (t) return t;
  const c = find('Combat_Down');
  if (c) return clip(null, c, null, 'combat');
  const any = firstLike(names, /^attack.*down/i, (n) => !isEdge(n));
  if (any) return clip(null, any, null, 'attackAny');
  return null;
}

/** Skill clip for one prefix (Skill_2, Skill2, Skill_02, Skill), or null. */
function skillFamily(names, find, P, numbered) {
  const begin = find(`${P}_Begin`) ?? find(`${P}_Start`);
  const end = find(`${P}_End`);
  const idle = find(`${P}_Idle`);
  const attack = find(`${P}_Attack`)
    ?? firstLike(names, new RegExp(`^${P}_Attack`, 'i'), (n) => !isDown(n) && !isEdge(n));
  const single = find(P);
  // Numbered prefixes only: any other P_* variant (e.g. Skill_1_A). Never for plain 'Skill',
  // which would otherwise grab another skill's animations.
  const variant = numbered
    ? firstLike(names, new RegExp(`^${P}_`, 'i'), (n) => !isDown(n) && !isEdge(n) && !/_idle$/i.test(n))
    : null;
  const loop = find(`${P}_Loop`) ?? attack ?? single ?? variant ?? idle ?? begin;
  if (!loop) return null;
  return { ...clip(loop === begin ? null : begin, loop, loop === end ? null : end), idle: idle ?? null };
}

function resolveSkill(names, find, index, attack) {
  const n = index + 1;
  const pad = String(n).padStart(2, '0');
  const prefixes = [`Skill_${n}`, `Skill${n}`, `Skill_${pad}`, 'Skill'];
  for (const P of prefixes) {
    const c = skillFamily(names, find, P, P !== 'Skill');
    if (c) {
      const { idle, ...rest } = c;
      return { ...rest, index, idle };
    }
  }
  // Last resort: directional-only skill clips (Skill_Right_Loop, Skill_Loop_Up).
  const dir = directionalAliases(names);
  if (dir.names.length > names.length) {
    const findDir = makeFinder(dir.names);
    for (const P of prefixes) {
      const c = skillFamily(dir.names, findDir, P, P !== 'Skill');
      if (c) {
        return { begin: dir.real(c.begin), loop: dir.real(c.loop), end: dir.real(c.end), index, idle: dir.real(c.idle) };
      }
    }
  }
  if (attack) return { ...attack, via: 'attack', index, idle: null };
  return null;
}

function resolveMove(names, find, form) {
  const t = triple(find, 'Move');
  if (t) return t;
  const m = find('Move') ?? form('Move');
  if (m) return clip(null, m, null);
  const r = triple(find, 'Run');
  if (r) return r;
  const run = find('Run') ?? form('Run');
  if (run) return clip(null, run, null);
  const any = firstLike(names, /^move/i, (n) => !isEdge(n)) ?? firstLike(names, /(^|_)move/i, (n) => !isEdge(n));
  return any ? clip(null, any, null) : null;
}

/**
 * The model's own run cycle, when it has one (猎狗pro: Move_Loop 0.80 s next to Run_Loop 0.53 s): a role of its own, not
 * the move choice — the renderer walks a fast enemy on it (render/units.js `moveFast`; PR #275 by @xcdoge).
 */
function resolveRun(find, form) {
  const t = triple(find, 'Run');
  if (t) return t;
  const r = find('Run') ?? form('Run');
  return r ? clip(null, r, null) : null;
}

/**
 * The stun family is spelled two ways and sometimes numbered (PR #275 by @xcdoge): Stun / Stun_Begin / Stun_End
 * (吉兆飞鳞, 乌顶巨角卢鲁), Stun_1 / Stun_2 (巨大的丑东西: its first and its second form — render/units.js FORMS gives the
 * second form Stun_2), Dizzy_Begin / Dizzy_Loop / Dizzy_End (斩胄之剑 / 破胄之锤, stun-immune in this mode). Without a role
 * a stunned enemy freezes its current clip.
 */
function resolveStun(find) {
  const stun = find('Stun') ?? find('Stun_1') ?? find('Dizzy_Loop');
  const begin = find('Stun_Begin') ?? find('Dizzy_Begin');
  if (stun) return clip(begin, stun, find('Stun_End') ?? find('Dizzy_End'));
  if (begin) return clip(null, begin, null);
  return null;
}

function resolveDie(names, find, form) {
  return find('Die') ?? form('Die')
    ?? firstLike(names, /^die/i)
    ?? firstLike(names, /_die$/i, (n) => !/stun/i.test(n))
    ?? null;
}

/**
 * Resolve animation roles for one Spine model.
 * @param {string[]} animationNames all animation names in the skeleton
 * @param {object} [opts]
 * @param {number[]} [opts.skillIndices] 0-based skill indices to resolve (first = primary); default [0]
 * @param {boolean} [opts.numberedSkills] also resolve every numbered skill clip of the skeleton (Skill_01, Skill_2_Loop …)
 *   after the caller's indices: an enemy's per-skill clips (a multi-skill boss such as 盐风主教昆图斯, Skill_01..04).
 *   One numbered clip is still a slot map (`skills`): 无畏掷弹兵 / 马特奥的近卫 have a single Skill_1.
 * @param {Record<string, number>} [opts.durations] animation durations in seconds (prefers animated idles)
 * @returns {Roles}
 */
export function resolveRoles(animationNames, opts = {}) {
  const names = Array.isArray(animationNames) ? animationNames.filter((n) => typeof n === 'string' && n.length) : [];
  const find = makeFinder(names);
  const durations = opts.durations && typeof opts.durations === 'object' ? opts.durations : null;
  const idle = resolveIdle(names, find, durations);
  const form = formFinder(find, idle);
  const deploy = find('Start') ?? form('Start') ?? idle;
  const attack = resolveAttack(names, find, form, idle);
  const attackDown = resolveAttackDown(names, find);
  const indices = [...new Set((opts.skillIndices?.length ? opts.skillIndices : [0])
    .filter((i) => Number.isInteger(i) && i >= 0 && i < 10))];
  if (!indices.length) indices.push(0);
  // an enemy's numbered skill clips (PR #275 by @xcdoge: its manifest only ever had index 0, so a multi-skill boss could
  // show one cast clip): appended after the caller's indices, whose first stays the primary `skill`.
  // One numbered clip is still that slot. 无畏掷弹兵 Bomb and 马特奥的近卫 CrossBomb (fx/index.json
  // units.enemy_1405_boomer_2 / enemy_1409_bdguad_2, prefab battle/enm_pfb_16.ab) each name Skill_1;
  // Skill_1_Down / Skill_1_Up match the same index and are that slot's facing variants.
  let numberedFound = false;
  if (opts.numberedSkills) {
    const found = new Set();
    for (const n of names) {
      const m = /^Skill_?0*(\d+)(?:$|_)/i.exec(n);
      if (m && Number(m[1]) >= 1 && Number(m[1]) <= 10) found.add(Number(m[1]) - 1);
    }
    numberedFound = found.size > 0;
    for (const i of [...found].sort((a, b) => a - b)) if (!indices.includes(i)) indices.push(i);
  }
  /** @type {Record<string, SkillClip>} */
  const skills = {};
  for (const i of indices) {
    const s = resolveSkill(names, find, i, attack);
    if (s) skills[String(i)] = s;
  }
  const roles = {
    idle,
    deploy,
    attack,
    attackDown,
    skill: skills[String(indices[0])] ?? null,
    die: resolveDie(names, find, form),
    move: resolveMove(names, find, form),
    stun: resolveStun(find),
  };
  const run = resolveRun(find, form);
  if (run) roles.run = run;
  if (indices.length > 1 || numberedFound) roles.skills = skills;
  return roles;
}

/**
 * All animation names referenced by a Roles object (for validation).
 * @param {Roles} roles
 * @returns {string[]}
 */
export function roleAnimationNames(roles) {
  const out = new Set();
  const addClip = (c) => {
    if (!c) return;
    for (const k of ['begin', 'loop', 'end', 'idle']) if (typeof c[k] === 'string') out.add(c[k]);
  };
  if (!roles) return [];
  for (const k of ['idle', 'deploy', 'die']) if (typeof roles[k] === 'string') out.add(roles[k]);
  for (const k of ['attack', 'attackDown', 'skill', 'move', 'run', 'stun']) addClip(roles[k]);
  if (roles.skills) for (const c of Object.values(roles.skills)) addClip(c);
  return [...out];
}
