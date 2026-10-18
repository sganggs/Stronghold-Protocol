// render/vfx/talents.js — a battle unit's talents and abilities (index.json version 3, DESIGN §33.17; the runtime's
// reading: §33.16) as bindings render/vfx/talentfx.js plays: which talents are in force (the data record's talents →
// `talentKeys`, the trait; every one of an enemy), each talent node's and ability's uses planned like a skill's
// (skills.js planUses — the same shape) and bound by `when`. Pure logic over index.json and our data: no GL, no DOM,
// Node-importable.
//
//   talentBindings(idx, unitKey, { info, rec })   → [Binding] (below)
//   activeTalentKeys(idx, unitKey, { info, rec }) → Set of the talent prefab keys in force, or null (every one: an enemy,
//                                                   a unit without talentKeys)
//   formModes(idx, unitKey)                        → { sim form: mode name } the data ties (doll, form2, husk, revived …)
//   toggleOn(binding, v, mem, now)                → whether its toggle checkers hold now (true / false), null when no
//                                                   client signal shows one of them
//   triggerKinds(binding)                          → the sim 'fx' kinds that cast a node a buff template action triggers
//   bindingKeys(binding)                           → every key it can play (preloading)
//
// Binding = { id, source ('talent' | 'ability'), key (the talent prefab key / the ability's name), kind (an ability's:
//   'common' | 'general' | 'trait'), node, class, ability, when, mode (the mode holding the node, or null), modes (a
//   general ability's), skills (the skill indexes it is valid with), toggle, reborn, triggers, stops, switchMode, bb (an
//   enemy talent's blackboard prefix), plan (skills.js plan of its uses), uses (how many) }
//
// How a talent's uses find their node: a use names its node's path (`node`); where several nodes share one path (a
// talent's PassiveBuffAbility and its AppearTalent's MeleeAttack, a RebornTalent beside its handler) the use's
// `ability`, else the class its field belongs to (`from` 'RebornTalent._buffs'), else the first; a mode's copy marked
// `same` plays the uses of the node it copies. The planner's `mode` filter is off: a node's uses name the mode holding it.
//
// When a binding plays (talentfx.js): `deploy` — its one-shots at the unit's 'deploy' (an enemy's or a summon's 'spawn'),
// its loops while the unit stands; `passive` — its loops from the deploy until the unit leaves the field, a node in a
// mode (a general ability's `modes`) only while that mode is on; `toggle` — while its checkers hold (toggleOn); `reborn`
// — an enemy's 重生: the knock-out's handler rows from the sim's knock-out fx to its stand-up fx, then its end rows and
// the talent's buffs (the 无敌 loop for its blackboard time); null — the sim fx kinds its template triggers name
// (triggerKinds: a fatal blow → 'substitute' / 'undying', a stand-in buff's end → 'swap' / 'dollEnd', a skill start, the
// owner's birth); `attack` — the attack it adds or replaces only where a kit fx marks it ('extraAttack'), else nothing.

import { planUses, emptyPlan, planKeys, resolveSkill } from './skills.js';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);

/** The class a use's field belongs to ('RebornTalent._buffs' → RebornTalent; 'X._buffs → template t' → X). */
const fromClass = (u) => (typeof u?.from === 'string' ? u.from.split(/[.\s]/)[0] || null : null);

/** The uses of talent node i (module header). */
export function nodeUses(t, i) {
  const nodes = Array.isArray(t?.nodes) ? t.nodes : [];
  const n = nodes[i];
  if (!isObj(n)) return [];
  const src = Number.isInteger(n.same) && isObj(nodes[n.same]) ? nodes[n.same] : n;
  const sib = nodes.filter((x) => isObj(x) && x.node === src.node);
  const owner = (u) => {
    if (sib.length <= 1) return sib[0];
    const c = fromClass(u);
    return (u.ability && sib.find((x) => x.ability === u.ability)) || sib.find((x) => x.class === c || x.ability === c) || sib[0];
  };
  return (Array.isArray(t.uses) ? t.uses : []).filter((u) => isObj(u) && u.node === src.node && owner(u) === src
    // two copies of a mode-free node: each keeps the uses without a mode or of its own mode
    && (src !== n || !u.mode || !n.mode || u.mode === n.mode));
}

/**
 * The talent prefab keys a unit has in force (module header): an operator's or a summon's — its data record's talents
 * by index (`fromModule` ones by the record's module) through `units[id].talentKeys`, and its trait's; null (every
 * talent) for an enemy, a unit without talentKeys or without a record.
 */
export function activeTalentKeys(idx, unitKey, { rec = null } = {}) {
  const unit = unitKey ? idx?.units?.[unitKey] : null;
  const tk = unit?.talentKeys;
  if (!isObj(tk) || unit.kind === 'enemy' || !isObj(rec)) return null;
  const out = new Set((Array.isArray(tk.trait) ? tk.trait : []).filter((k) => typeof k === 'string'));
  // [ASSUMED] Borrowed visuals use the borrower's equipped talent indices and active module, just like its own unit.
  const modId = rec.module && rec.module.active !== false ? rec.module.id : null;
  for (const t of Array.isArray(rec.talents) ? rec.talents : []) {
    if (!isObj(t) || !Number.isInteger(t.index)) continue;
    const table = t.fromModule ? (modId && isObj(tk.modules) ? tk.modules[modId] : null) : tk.base;
    for (const k of (isObj(table) ? table[String(t.index)] : null) || []) if (typeof k === 'string') out.add(k);
  }
  return out;
}

/** The equipped skill index of a unit view's info (a 自选 pick's, else its own). */
const skillIndexOf = (info) => (Number.isInteger(info?.diy?.skillIndex) ? info.diy.skillIndex : Number.isInteger(info?.skillIndex) ? info.skillIndex : null);

/**
 * Every talent node and ability of a unit as a binding (module header): talents in force only (activeTalentKeys), and
 * only the nodes valid with the equipped skill (`skills`).
 * @returns {any[]}
 */
export function talentBindings(idx, unitKey, { info = null, rec = null } = {}) {
  const unit = unitKey ? idx?.units?.[unitKey] : null;
  if (!unit) return [];
  const out = [];
  const active = activeTalentKeys(idx, unitKey, { info, rec });
  let sk = skillIndexOf(info);
  if (rec?.fx?.unit === unitKey) {
    const mapped = resolveSkill(idx, { info, rec }).skillId;
    // [ASSUMED] Official skchr ids end with their one-based slot; shared skills keep the owner's slot.
    const slot = /^skchr_.+_([1-9])$/.exec(mapped || '');
    if (slot) sk = Number(slot[1]) - 1;
  }
  for (const [key, t] of Object.entries(isObj(unit.talents) ? unit.talents : {})) {
    if (active && !active.has(key)) continue;
    (Array.isArray(t.nodes) ? t.nodes : []).forEach((n, i) => {
      if (!isObj(n)) return;
      if (Array.isArray(n.skills) && n.skills.length && !(sk != null && n.skills.includes(sk))) return;
      const uses = nodeUses(t, i);
      const plan = planUses(idx, emptyPlan(unitKey, key), uses, { mode: null, abilities: t.abilities });
      out.push({
        id: `t:${key}#${i}`, source: 'talent', key, kind: null, node: n.node ?? null, class: n.class ?? null, ability: n.ability ?? null,
        when: n.when ?? null, mode: typeof n.mode === 'string' ? n.mode : null, modes: null, skills: n.skills ?? null,
        toggle: n.toggle ?? null, reborn: n.reborn ?? null, triggers: n.triggers ?? null, stops: n.stops ?? null,
        switchMode: n.switchMode ?? null, bb: typeof t.bb === 'string' ? t.bb : null, plan, uses: uses.length,
      });
    });
  }
  (Array.isArray(unit.abilities) ? unit.abilities : []).forEach((a, i) => {
    if (!isObj(a)) return;
    const uses = Array.isArray(a.uses) ? a.uses : [];
    const plan = planUses(idx, emptyPlan(unitKey, a.name ?? `ability${i}`), uses, { mode: null, abilities: a.abilities });
    out.push({
      id: `a:${a.name ?? i}#${i}`, source: 'ability', key: a.name ?? null, kind: a.kind ?? null, node: a.node ?? null, class: a.class ?? null,
      ability: a.class ?? null, when: a.when ?? null, mode: typeof a.mode === 'string' ? a.mode : null,
      modes: Array.isArray(a.modes) && a.modes.length ? a.modes : null, skills: null, toggle: a.toggle ?? null, reborn: null,
      triggers: a.triggers ?? null, stops: a.stops ?? null, switchMode: a.switchMode ?? null, bb: null, plan, uses: uses.length,
    });
  });
  return out;
}

/** Sim fx kinds a template action at a buff event casts through (module header). */
const FATAL = ['substitute', 'undying'];
const STAND_IN_END = ['swap', 'dollEnd'];

/**
 * The sim 'fx' kinds (with the unit's id) that cast a node a buff template action triggers (`triggers`): the fatal blow
 * (ON_BEFORE_TRY_SET_HP_ZERO) is a 傀儡师's 'substitute' or a kit's 'undying'; a stand-in buff's end (ON_BUFF_FINISH of a
 * `*standin*` buff) the 'swap' / 'dollEnd' back; 'skill' — the owner's skill start (ON_SKILL_START, the 'skill' event); 'born'
 * — its deploy (ON_OWNER_BORN). Other events have no client signal.
 */
export function triggerKinds(b) {
  const out = new Set();
  for (const t of Array.isArray(b?.triggers) ? b.triggers : []) {
    if (!isObj(t)) continue;
    if (t.event === 'ON_BEFORE_TRY_SET_HP_ZERO') for (const k of FATAL) out.add(k);
    else if (t.event === 'ON_BUFF_FINISH' && /standin/i.test(`${t.template || ''} ${t.buff || ''}`)) for (const k of STAND_IN_END) out.add(k);
    else if (t.event === 'ON_SKILL_START') out.add('skill');
    else if (t.event === 'ON_OWNER_BORN') out.add('born');
  }
  return [...out];
}

/**
 * The modes the sim's forms put a unit in, as the data says (module header): a reborn talent's knock-out and stand-up
 * (RebornTalent: 'form2' → its `reborn.mode`; ManualTriggerRebornTalent — a husk revived —: 'husk' → the mode holding it,
 * 'revived' → its `reborn.mode`), a 傀儡师's 'doll' → the mode the node a fatal blow casts switches to (风丸 → Stand).
 * A form named like a mode needs no entry (skillfx.js formMode).
 * @returns {Record<string, string>}
 */
export function formModes(idx, unitKey) {
  const unit = unitKey ? idx?.units?.[unitKey] : null;
  const out = {};
  if (!unit) return out;
  const hasMode = (m) => typeof m === 'string' && (unit.modes || []).some((x) => x?.name === m);
  const nodes = [];
  for (const t of Object.values(isObj(unit.talents) ? unit.talents : {})) for (const n of Array.isArray(t.nodes) ? t.nodes : []) if (isObj(n)) nodes.push(n);
  for (const a of Array.isArray(unit.abilities) ? unit.abilities : []) if (isObj(a)) nodes.push(a);
  for (const n of nodes) {
    const r = n.reborn;
    if (isObj(r) && hasMode(r.mode)) {
      if (n.class === 'ManualTriggerRebornTalent') { if (hasMode(n.mode)) out.husk ??= n.mode; out.revived ??= r.mode; }
      else if (n.class === 'RebornTalent') out.form2 ??= r.mode;
    }
    const fatal = (n.triggers || []).some((t) => t?.event === 'ON_BEFORE_TRY_SET_HP_ZERO');
    const sw = (n.switchMode || []).find((x) => hasMode(x?.mode));
    if (fatal && sw) out.doll ??= sw.mode;
  }
  return out;
}

/** Blackboard value of `key` (case aside) under an enemy talent's prefix, or undefined. */
function bbValue(bb, prefix, key) {
  if (!isObj(bb) || typeof key !== 'string') return undefined;
  const want = [prefix ? `${prefix}.${key}` : null, key].filter(Boolean).map((k) => k.toLowerCase());
  for (const w of want) for (const [k, v] of Object.entries(bb)) if (k.toLowerCase() === w && typeof v === 'number') return v;
  return undefined;
}

/**
 * Whether a binding's toggle checkers hold for view v (index v3 `toggle`, DESIGN §33.17): HpRatioToggleChecker — the HP
 * ratio within [min, max] (`useLTForMax`: below max), the bounds from the record's blackboard when it says so;
 * BlockedToggleChecker — blocking (an operator) / blocked (an enemy): UF.BLOCKED for a minimum of 1 or more, its absence
 * for a 0–0 range [ASSUMED: the snapshot has the flag, not the count]; AdvancedCompoundToggleChecker — 隐匿 (the node
 * casts `common_invisible`, or the key names it) follows UF.STEALTH, which the sim already turns off while blocked and
 * for the restore delay after; one that only turns off while blocked: off while UF.BLOCKED and `restoreDelay` s after.
 * Any other checker or setting (filters, ranges, professions, attacks, modifiers …): null — no client signal.
 * `mem`: the binding's own memory (the time it was last blocked); `bbs`: { bb (the record's), prefix }.
 */
export function toggleOn(b, v, mem, now, bbs = null, UF = { BLOCKED: 1, STEALTH: 8 }) {
  const list = Array.isArray(b?.toggle) ? b.toggle : [];
  if (!list.length) return null;
  const flags = v?.flags | 0;
  const blocked = !!(flags & UF.BLOCKED);
  let on = true;
  for (const c of list) {
    if (!isObj(c)) return null;
    if (c.class === 'HpRatioToggleChecker') {
      const hp = Number(v?.hp), max = Number(v?.maxHp);
      if (!(max > 0) || !Number.isFinite(hp)) return null;
      const r = hp / max;
      let lo = Number(c.minHpRatio) || 0, hi = Number.isFinite(Number(c.maxHpRatio)) ? Number(c.maxHpRatio) : 1;
      const fromBb = bbValue(bbs?.bb, bbs?.prefix, 'hp_ratio');
      if (c.loadMinHpRatioFromBlackboard && typeof fromBb === 'number') lo = fromBb;
      // a checker left at the full range whose talent has a `hp_ratio` blackboard value (鼠王's 'enrage' 0–1 beside
      // enrage.hp_ratio 0.5, the sim's lowHpBuff): that value is its upper bound [ASSUMED: the client loads it]
      else if ((c.loadMaxHpRatioFromBlackboard || (lo === 0 && hi === 1)) && typeof fromBb === 'number') hi = fromBb;
      on = on && r >= lo - 1e-9 && (c.useLTForMax ? r < hi : r <= hi + 1e-9);
    } else if (c.class === 'BlockedToggleChecker') {
      const min = Number(c.blockMinCnt) || 0, max = Number(c.blockMaxCnt);
      on = on && (min >= 1 ? blocked : max === 0 ? !blocked : true);
    } else if (c.class === 'AdvancedCompoundToggleChecker') {
      const invis = /invis/i.test(b.key || '') || (b.plan?.loop || []).some((e) => e.key === 'common_invisible');
      if (invis) { on = on && !!(flags & UF.STEALTH); continue; }
      const others = ['disableWhenAttack', 'disableWhenInAttackState', 'disableWhenInCombatState', 'disableWhenOutputHeal', 'disableWhenTakeDamage',
        'disableWhenAppliedModifier', 'disableWhenAppliedDamageModifier', 'disableWhenMoving'];
      if (others.some((k) => c[k]) || !c.disableWhenBlocked) return null;
      if (blocked && mem) mem.blockedAt = now;
      const since = mem && Number.isFinite(mem.blockedAt) ? now - mem.blockedAt : Infinity;
      on = on && !blocked && since >= (Number(c.restoreDelay) || 0);
    } else return null;
  }
  return on;
}

/** Every key a binding can play (preloading). */
export function bindingKeys(b) {
  return b?.plan ? planKeys(b.plan) : [];
}

/** Whether a binding can ever play on this client (talentfx.js binds it), with the reason it cannot. */
export function bindable(b) {
  if (!b || !b.plan) return { ok: false, reason: 'no-plan' };
  const p = b.plan;
  const draws = p.start.length || p.loop.length || p.end.length || p.range.length || p.attacks.some((a) => a.cast.length || a.range.length || a.hit.some((g) => g.length));
  if (!draws) return { ok: false, reason: p.targets.length ? 'targets-only' : p.unmapped.length ? 'unmapped' : 'no-effects' };
  if (b.when === 'toggle') {
    const probe = toggleOn(b, { flags: 0, hp: 1, maxHp: 1 }, {}, 0);
    return probe === null ? { ok: false, reason: 'toggle-no-signal' } : { ok: true, reason: null };
  }
  if (b.when === 'attack') return { ok: false, reason: 'attack' };
  if (b.when === null || b.when === undefined) return triggerKinds(b).length ? { ok: true, reason: null } : { ok: false, reason: 'no-trigger-signal' };
  if (b.when === 'reborn') return { ok: true, reason: null };
  return { ok: true, reason: null };
}

export { lc as _lc };
