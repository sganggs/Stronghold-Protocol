// render/vfx/skills.js — the official skill, talent and charge effects of a battle unit as plans the wiring plays
// (DESIGN §33.12 `skills`, §33.16; 0.3.0 Phase 3a–3c). Pure logic over index.json and our data: no GL, no DOM,
// Node-importable.
//
//   resolveSkill(idx, { info, rec })        → { unitKey, skillId, skill, via, reason } — the official skill a unit uses
//   skillPlan(idx, unitKey, skillId, opts)  → SkillPlan (below): what to play on which client signal, and where
//   planFor(idx, { info, rec })             → { unitKey, skillId, reason, srec, plan, charge, enemy } — in one call (the wiring)
//   enemySkillsOf(idx, unitKey, rec)        → an enemy's skills by its record's slots (index v2), [{ slot, prefabKey, skill }]
//   hitGroups(rows) / hitOptsOf(rows)       → a MultiHit emitter's rows as hit groups / its choice flags
//   attackFx(plan, { heal, ranged })        → the effects of one attack of the owner while the skill is on
//   skillProjectile(idx, plan)              → the projectile a ranged attack of the skill's own ability flies, or null
//   targetsOf(idx, plan)                    → the `targets` entries the client can place: { status, hit, none }
//   buffDuration(srec)                      → a skill's buff duration from our record's blackboard, or null
//   slotKey(entry, dir)                     → the key of a directional row for a facing ('UP' | 'RIGHT' | 'DOWN' | 'LEFT')
//   planKeys(plan) / chargeKeys(plan)       → every key of a plan (preloading)
//   anchorOf(desc)                          → where a prefab descriptor places its effect (_spawnLocation, FollowMountPoint)
//   chargePlan(idx, unitKey)                → a 秘术师's stored-energy effects (chargeSource: the index's export —
//                                             chargeFromIndex for version 2 —, else CHARGE_EMITTERS), null for other units
//   chargeStep(plan, prev, next)            → what changes when the stored count goes prev → next
//   FX_BINDINGS / bindingKeys(idx, skillId) → kit 'fx' tuples bound to a skill's official effect (Phase 3b, below)
//   FX_COVER / coverOf(owner, kind)         → kit 'fx' kinds a skill's official effects stand for (no procedural fx; below)
//   ENEMY_FX_BINDINGS / ENEMY_FX_KINDS      → an enemy's kit 'fx' tuples bound to its official effect — its zones, its
//                                             aura's ticks, a mode's loops (0.3.1: lingering areas; below);
//                                             enemyBindingKeys / auraTargets / modeLoopKeys their prefabs
//   eventNum(e)                             → an ability event (name or number) → Torappu.Battle.AbilityStandard/Event
//
// ---- Resolving a battle unit (resolveSkill) --------------------------------------------------------------------------
// Fields relied on — the view's info (render/app/info.js renderInfo of the sim's UnitInfo, server/sim/snapshot.js):
// `kind`, `side`, `defId`, `spine`, `skillIndex` (an ally's equipped skill: the official skill slot, 0-based — the sim's
// `def.skill.index`; absent for enemies), `diy.charId` / `diy.skillIndex` (a 自选 pick); and the unit's data record —
// what render/app.js `ctx.lookupDef(info)` returns: the chess record (data/chess.json), the 补位 / 自选 record
// (shared/standIn.js composeUnitRecord: the same `skill` / `skills[]` shape), a token record (data/tokens.json), an enemy
// record (data/enemies.json): `charId`, `skill` { skillId, prefabId, index } and `skills[]` (each with `index`).
//   * the index unit: the first of [diy.charId, spine, rec.charId, defId] that index.json has (a `_<n>` suffix dropped),
//     the order of FxWiring.unitOf;
//   * the skill record: `rec.skills[]` with `index === skillIndex` (the loadout's pick), else `rec.skill`; a token's
//     record (data/tokens.json) carries only `{ skillId, bb }` at its top — its owners' `variants` hold the full skill
//     records (`skill`, `bySkill[i].skill`: one per index of the owner's skill choice, the def the sim merges for the
//     token, whose UnitInfo skillIndex is that record's `index`): the variant record with the unit's skillIndex, else
//     the top record completed from the variant record of its id (0.3.1, audit R18: 诅咒娃娃's PASSIVE record made its
//     plan 'passive' — it read as 'instant' without a type, and the sim sends no skill event for a passive with a
//     duration, so its aura never played);
//   * the skill id: its `prefabId`, else `skillId` (lower case; a `[n]` variant suffix such as 预备干员's
//     `skcom_charge_cost[1]` dropped), looked up in the unit's `skills`, then in index.skills; without a record, the
//     client's naming `skchr_<code>_<skillIndex + 1>` of a `char_<n>_<code>` unit (`via: 'name'`; not when a record names
//     a skill the index lacks — the naming could hit another skill: 琴柳's slot 0, skcom_assist_cost[3], is no
//     skchr_sleach_1).
// Tokens: version 1 has no summon skills (`reason: 'token-skill'`); version 2 lists them (`sktok_*` in the unit's
// `skills`): the token's record names its skill, else it casts the only one its unit has (`via: 'only'` [ASSUMED]). A
// token's own `S1` / `S2` / `S3` modes follow its summoner's skill (麦哲伦's drones, 凯尔希's Mon3tr) [ASSUMED from the
// mode names]; UnitInfo carries no summoner link (ownerId is the player), so FxWiring.mode's `S<skillIndex + 1>` cannot
// be right for them yet. Enemies: version 1 has no enemy skills (`reason: 'enemy-skill'`); version 2's
// `units[enemy].skills` are keyed by the lower-case `prefabKey` of data/enemies.json `skills[]` — enemySkillsOf lists them
// by slot (the sim's `['cast', id, slot]`, PR #275), planFor plans them (`enemy`: the Default mode's), and skillPlan's
// `opts.mode` gives another mode's copy (a use with `mode` belongs to that mode's copy; one without to every copy).
//
// ---- The plan (skillPlan) ------------------------------------------------------------------------------------------
//   { unitKey, skillId, mode, modeName, kind,
//     start, loop, end, ready, range,      skill-level: on the owner
//     attacks: [{ node, ability, cast, range, aim, hit, when? }],  the skill prefab's own attack abilities (each attack
//                                          while on; `when` 'start' / 'end': the skill's own cast at its start / end —
//                                          tagCasts, history §32.14.43 —, never a normal attack)
//     each: { cast, hit },                 any attack of the owner while on (buff template actions)
//     trigger,                             reactive: the owner taking damage while on
//     cond,                                `[eff_cond]` state loops on the owner (COND_BUFFS, condState)
//     targets,                             on other units (the skill's buffs on targets / aura members): no client signal
//     unmapped: [{ key, role, reason, from }] }
// `hit` lists are hit groups: [[entry…]…] — the k-th hit of one attack plays group min(k, last) (a plain attack has one
// group; `hitOpts` { indexed, loop, random, once }: index v2's exported groups and the emitter's flags — skillfx.js
// pickGroup); `aim` plays on the attack's targets at its cast, once. Entry = { key, role, at, loop, hold, from, node?,
// ability?, list?, startEvent?, endEvent?, directionType?, slots?, firstOnly?, afterFirst?, event?, action?, buff?,
// on?, byName?, point?, follow?, birth?, and index v2's group?, groups?, anim?, mode?, useLoopHitEffect?, useRandomHitEffect?,
// keepBaseHitEffect?, oncePerTarget? }:
//   at    'owner' (placed on the owner by the prefab's own _spawnLocation: feet, HitPoint, Muzzle, a Special point, its
//         ground centre — the wiring's playOn reads it), 'target' (on the target hit; HIT_POINT for most), 'targets'
//         (the carriers of a buff the client cannot name);
//   loop  the prefab loops (index.json prefabs[key].looping) — someone has to stop it;
//   hold  'skill' (stop on skill off / death), 'cast' (stop when the cast ends: an attack's or the skill's single cast —
//         FxWiring's CAST_LOOP_S; a looping prefab in a one-shot role gets it too, except a skill-level begin effect —
//         `_beginEffect`, a buff's start action —, which lasts the skill [ASSUMED]), 'ready' (stop when the skill stops
//         being ready), null (a one-shot: it plays out);
//   point / follow  the prefab's SpawnLocation / FollowMountPoint names: index v2's prefab summary (`spawn` / `follow`),
//         else — with `opts.describe` — the descriptor's (anchorOf; it wins when given).
// `mode` / `modeName`: the owner's attack mode the skill switches to (index.json skills[id].mode — from the skill's data
// or `S<n>` by name); the normal attacks then use that mode's cast / hit / projectile (FxWiring.attack): Phase 3b should
// take it from here instead of `S<skillIndex + 1>` (204 of 210 skills agree; the plan is right for the other 6). That
// mode's attach rows (AttachEffectOptions: attached with the mode, i.e. for the skill — attachUses) join the plan as
// skill-held `range` / `loop` entries (溯光星源 S3's area, 薄绿 S1's range, 普罗旺斯 S2's buff).
// `kind` (with `opts.rec`, our skill record): 'passive' (skillType PASSIVE — the sim starts it at deploy and sends no
// skill window for one with a duration: its loops run while the unit is deployed [ASSUMED]), 'ammo', 'lasting'
// (duration > 0), 'instant' (else: 'skill' on and off in one tick, around the skill's attack if it has one). Index v2's
// `rootClass`: a ReplacementSkill* is 'instant' whatever the record (its single attack is the skill), a PassiveSkill
// without a record 'passive'.
//
// How a use of index.json (skills[id].uses) is placed — the extractor's roles (DESIGN §33.12) refined by its fields:
//   * emitter rows (a use with `ability`, the ability the emitter serves): an attack ability (/Attack|Heal/, not
//     Channeling*) → `attacks` — `start` / `loop` / `end` rows to `cast` (on each attack's cast; a non-one-shot row is
//     held for that cast), `range` rows to its `range`, `hit` rows to `hit` (MultiHitUberEffectEmitter._hitGroups → hit
//     groups, below; plain `_hitEffects` rows play on every hit — a MultiHit emitter's own only with
//     `keepBaseHitEffect` when it has groups), `castTarget` / `inputTarget` rows to `aim` (on the
//     targets at the cast). Any other ability is the skill's own action → skill level: a row held past its cast — Channeling*
//     (the channel lasts the skill), or ActiveBuffAbility / BuffDuring* / Passive* / *Aura* not ending at ON_CAST_END —
//     is a `loop`; other non-one-shot rows are `start` held for the cast. Their `hit` rows have no event naming the
//     targets (unmapped 'hit-no-attack' / 'channel-hit').
//     Why attack rows go per attack, also in a one-cast skill: the sim sends ['skill', id, 1], the skill's attack
//     ['atk', …], then ['skill', id, 0] — the rows play with that attack (version 1 does not say which skills are one
//     cast; version 2's root class does — `kind` above).
//   * buffs (a buff's effect: overrideEffectKey, else its template's effectKey) loop on their carrier: `on: 'owner'` (or
//     unknown) → `loop` (hold 'skill'), `on: 'targets'` → `targets`, a token's → unmapped 'token'.
//   * buff template actions (`event`): at ON_BUFF_START / ENABLE / LATE_ENABLE / ON_SKILL_START / ON_TOGGLE_SKILL_START →
//     as the role says (the template's buff is the skill's [ASSUMED]: its start is the skill start); at ON_BUFF_FINISH /
//     DISABLE / ON_SKILL_FINISH → `end` (a buff created there outlives the skill: unmapped 'after-end'); at
//     ON_TAKE_DAMAGE on the owner → `trigger`; at an output event (ON_OUTPUT_DAMAGE, ON_AFTER_ATTACK, …) → `each.hit`;
//     at an ability event (ON_ABILITY_START / SPELL_ON, ON_BEFORE_ATTACK) → `each.cast`; an effect or damage action at
//     ON_BUFF_TRIGGER is the buff's periodic tick (unmapped 'tick': no tick reaches the client); a buff created there is
//     a condition's visual state — `cond` (hold 'cond') for the `[eff_cond]` templates whose client graph COND_BUFFS
//     transcribes (卡涅利安's sand armour; skillfx.js plays the state's loops), else unmapped 'conditional' — like any
//     other event (ON_APPLYING_MODIFIER, ON_BEFORE_TRY_SET_HP_ZERO, ON_OWNER_KILLED, ON_OWNER_LOCATE,
//     ON_CALCULATE_DAMAGE, …) → unmapped 'conditional'. Actions on targets follow `on: 'targets'` (a target's buff start
//     is its hit → `each.hit`).
//   * effect fields: ReadySkillEffect → `ready`; `_beginEffect` / `_startEffect` / … → `start` (a looping one is held
//     for the skill); an AppearSkill's (or MultiAppearSkill's) `_overrideStartEffect` → a `start` entry with `birth`:
//     the unit's deploy effect while it fights with that skill (0.3.1, audit R21 — the client's Character.GetStartEffect
//     returns it before the mode's `overrideStartEffect` and the unit's own `_startEffect`; `common_empty` for
//     缄默德克萨斯 S2 / S3: no deploy effect) — FxWiring.deploy plays no other (SkillFx.birthOf); `_endEffect` → `end`;
//     aura `_effects` → `loop`; `_hitEffect(Key)` / `_effectOnEliminatePos` → `each.hit`; points of a path or a line
//     (`_lineEffectKey`, `_startPointEffectKey`, `_waypointEffectKey`, `_endPointEffectKey`, `_edgeLineRendererEffectKey`)
//     and `_tileEffectKey` need positions the client is not given: unmapped 'path' / 'tiles'.
//   * `by: 'name'` (placed by the key's name) keeps that placement with `byName` [ASSUMED]; role `other` → unmapped.
//   * one buff template action's facing variants (`<base>_up` / `_down` / `_left` / `<base>` …: the client's
//     CheckCharacterDefaultDirection branches, written as a use each) are one entry with `slots` (dirFamilies).
//   * hookEffectAfterFirstAttack: the row's key on the first attack (`firstOnly`), the hook's from the second on
//     (`afterFirst`).
//   * MultiHitUberEffectEmitter._hitGroups: version 2 gives each row its `group`, the list's length (`groups`) and the
//     emitter's flags — hitGroups keeps every group (an empty one too: that hit plays nothing), hitOptsOf the flags.
//     Version 1 has them flattened: a row starts a new group
//     unless its key names a range (`_range`), which joins the group before it. This reproduces the client's groups of
//     all 10 skills of the used set that have them (client 26-09-13, [uc]skills.ab: skchr_acpion_3 8, ascln_1 2,
//     blkkgt_1 2, chen_3 10, chen3_2 6, irene_1 2, phatm2_1 2 (hit + hit_range each), vvana_1 2 + 3, zuole_1 2 / 3,
//     zuole_3 7); [ASSUMED] for other sets — version 2's `group` wins.
//   * `pulse`: the entries left unmapped as 'tick' / 'channel-hit' / 'hit-no-attack' (the skill's periodic or non-attack
//     hits) are also listed here with their reason: no event of the engine names them, but a kit may send an 'fx' of its
//     own for that moment (the wiring binds them to it, Phase 3b — below). They stay in `unmapped` (the static count).
//   * `projectiles`: the skill's own projectile keys that index.json has (skills[id].projectiles); `rootClass`: the
//     skill's root class (index v2: ReplacementSkill, CastSkill, …), else null.
//
// ---- Role → client signal (render/app.js handleEvent; b.ev tuples, DESIGN §8.2; b.snap via render/interp.js) ---------
//   start     ['skill', id, 1]. An instant skill sends 1 and 0 in one tick (its attack, if any, between them); a passive
//             without a duration sends 1, then 0 after the 0.5 s clip window (server/sim/skills.js _startPassive); a
//             passive with a duration sends nothing — its loops belong to the deploy (`kind: 'passive'`).
//   loop      ['skill', id, 1] … ['skill', id, 0] (or 'die' / 'leak' / the battle's end). Level signal: b.snap flags & UF.SKILL
//             (a view built mid-battle — a reconnect, a watched field — starts its loops from it; passives never set it).
//   end       ['skill', id, 0].
//   range     as start (a one-shot) or as loop (hold 'skill').
//   ready     no event: the snapshot — sp ≥ spMax > 0 and not UF.SKILL (interp sample(): o.sp, o.spMax, o.flags)
//             [ASSUMED for a multi-charge skill, whose stored charges the snapshot does not show].
//   attacks / each .cast, attacks .aim   ['atk', ownerId, tgtId, kind] while the owner's skill is on (not a chain bounce,
//             CHAIN_KINDS; `aim` on tgtId).
//   attacks / each .hit    that attack landing on its target: the ['dmg', tgtId, …] after a melee 'atk' (app.js meleePending /
//             FxWiring's melee window), the projectile's arrival for a ranged one (FxWiring._arrive), ['heal', tgtId, n]
//             after a heal 'atk'. Hit k of a multi-hit attack: the sim deals all hits of one attack in one tick — the
//             k-th 'dmg' on that target (the order is the only link).
//   trigger   ['dmg', ownerId, …] while the skill is on (ON_TAKE_DAMAGE on the owner).
//   charge    b.snap `energy` [[id, stored, cap]] → view `o.energy` (PR #636; sent whatever 设置「秘术师能量」 says).
//   targets   (only) the buffs of the skill's own attack abilities: their carriers are that attack's 'atk' targets
//             (targetsOf `hit`, Phase 3b).
// No client-visible signal today (and so `targets` / unmapped):
//   * who carries a skill's buff when it is not the owner and no attack of the skill put it there — the members of an
//     aura / a global aura, a skill's selector targets: ['status', id, key, on] names only the sim's statuses (drawn by
//     generic.status), never a source or a skill;
//   * a buff given to the unit's summons (CreateBuffToToken, _buffsToToken): UnitInfo has no summoner link;
//   * the source of damage that is no attack (a kit's AoE, a DoT, a channel's ticks): 'dmg' carries no source; only the
//     kits' own 'fx' tuples name a caster (`extra.id`; `extra.skill` in 97 sim call sites), without a shared contract
//     (Phase 3b binds them where they stand for a plan's `pulse` rows or an FX_BINDINGS entry);
//   * buff events past start / finish / take-damage (periodic ticks, condition checks, would-die, kills, moves);
//   * the tiles / path of an area or line effect (_tileEffectKey, Aphris's path, range outlines);
//   * the moment of an enemy's skill, unless ['cast', id, slot] arrives (the sim on this line sends none) or a
//     single-skill enemy's snapshot shows SKILL (skillfx.js); the hit index of a multi-hit attack (only the event order);
//   * 维伊's and 黑键's stores (kit-private: the charge section).
//
// ---- The 秘术师 charge (CHARGE_EMITTERS, chargePlan, chargeStep; GitHub #633) --------------------------------------
// Version 1 of index.json does not carry the charge emitters: they sit on the unit prefab's Trait/Charge*Group (AbilityChargeableGroup /
// AbilityExChargeGroup with MultiChargeUberEffectEmitter, MultiExChargeUberEffectEmitter, MergeableChargeUberEffectEmitter),
// which the extractor's attack reader skips (it takes a mode's `UberEffectEmitter` only — so 深靛's, 黑键's and 维伊's
// attack `cast` rows, a MultiChargeUberEffectEmitter's, are missing from their modes too; client 26-09-13, the operators'
// mode attacks: MultiChargeUberEffectEmitter 9 of 3 operators, MultiHitUberEffectEmitter 11 of 8 — 41 rows / hit groups
// of blkkgt, chen3, crosly, hsgma2, irene, mlynar, texas2, vvana —, UberAnimationEffectEmitter 14 of 9, and a few
// classes without standard rows). CHARGE_EMITTERS transcribes the charge groups from the client's charpacks
// (26-09-13); chargePlan checks every key against index.json. What the data says:
//   * per stored energy k (1-based) the k-th group of the trait group's emitter plays at the store's ON_SPELL_ON (event
//     4) — its looping prefab (_isLoop 1, _holdByOwner 1, FollowMountPoint on a Special point) stays while the energy is
//     stored —, and the k-th group of the store ability's own emitter (ChargeRangedAttack / ExChargeRangedAttack /
//     MergeableChargeRangeAttack, one per mode) plays at its ON_CAST_START (event 2): one-shots;
//   * a release fires the stored energies as projectiles from _mountPointForProjectiles[k − 1] (MountPointType) to the
//     attack's target — the store ability's _projectileKey of the current mode (Default / S1 / S2 …);
//   * 深靛 (char_469_indigo): 3 energies (4 with MSC-X — the sim's cap); slot k loops indigo_attack_charge_0{k+1} at
//     Special1, Special2, Special3, Special0 (mounts 6, 8, 9, 5) and every store plays indigo_attack_charge_01_start
//     (FxDelay 0.2 s, at Special0). So: count n → the loops of slots 1…n; each +1 → the one-shot and the next loop;
//     a release → the loops stop and n projectiles leave from those points;
//   * 黑键 (char_4046_ebnhlz): normal energies (orange, mounts 5, 6, 8, 9; up to 4 with MSC-X): store cast →
//     ebnhlz_attack_start_02_orange[_k], spell → ebnhlz_attack_charge_orange[_k] (a 6 s one-shot) + the loop
//     ebnhlz_attack_buff_orange[_k]; elite energies (red): the talent's extra one is slot 5 (…_red_5, Special4) outside S3;
//     during S3 every energy is elite, red … red_5 (_forceExCharge). Our sim keeps his count kit-private
//     (op-ebnhlz.js unit.trait.ebn { n, e }); the only client event is the release's ['fx', 'volley', x, y,
//     { id, target, n }] (n = normal + elite released) — nothing could drive the stored display today;
//   * 维伊 (char_4226_veen): 5 energy slots (veen_telent_01_rank_01[_k] loops + …_rank_01_change[_k] one-shots, mounts
//     5, 6, 8, 9, 10), every 3 merge (_mergeSize) into a 转置能量 slot (…_rank_02[_k] + …_rank_02_change[_k]); her kit
//     (op-veen.js) keeps its own store: no signal either.
//
// Version 2 exports them (Phase 1c, DESIGN §33.12 Charge): `chargeSource` turns `units[id].charge` (the chargeable
// groups) into CHARGE_EMITTERS' shape (chargeFromIndex: the reference store ability is the one whose `modes` hold
// Default — its emitters' and the group node's groups are the slots, at its `mountPointForProjectiles`; the ex emitters
// at `exMounts` the elite slots, a `forceExCharge` ability's for its modes; `mergeSize` the merged slots; each ability's
// projectiles for its `modes`) — for the three units the same as the table —, else reads an object of the table's shape
// ({ cap, slots: [{ spell, cast, mount }], projectiles, … }), else falls back to the table.
//
// ---- What the client can place beyond the signals above (Phase 3b; render/vfx/skillfx.js plays it) --------------------
//   * targetsOf: a `targets` entry carried by the buffs an attack ability of the skill applies (`<Attack>._activeBuffs`)
//     sits on that attack's targets, which the 'atk' events name — `hit` (from the hit, for buffDuration(srec) s, else
//     while the skill lasts [ASSUMED]; when the sim reports a status whose generic loop is the same key, the status
//     wiring's loop takes over — never drawn twice); another whose key is a generic status loop (index.json
//     generic.status: buff_stun, buff_burn, …) is drawn by the status wiring when the sim reports that status —
//     `status`; the rest — auras, global auras, selectors, other abilities' targets — `none`.
//   * skillProjectile: a ranged attack ability of the skill flies the skill's own projectile (index.json does not say
//     which ability fires which projectile): the only one, else the one named `_s<n>` / `_sk<n>` after the skill's number
//     (the shortest such key), else the first [ASSUMED].
//   * FX_BINDINGS: a kit 'fx' tuple that stands for an official effect of the skill which no plan row places (the skill's
//     projectile reaching a target the kit picks, …), by skill id and fx kind — see the table.
//   * FX_COVER: a kit 'fx' kind the skill's official effects stand for although nothing official is placed at that fx (the
//     client shows the skill's own effects there and no such cue) — the procedural fx is skipped while the skill lasts.
//
// [ASSUMED] (the data does not say): the placements marked above; a looping prefab in a one-shot role is held for one
// cast (a skill-level begin effect for the skill); buff loops on the owner last the skill (a buff's own duration is not
// in index.json); hit groups beyond the last repeat the last; passive skills' loops follow the deploy.

/** Torappu.Battle.AbilityStandard/Event (DESIGN §33.12): index.json's skill uses write the names, units' Emit rows the numbers. */
export const ABILITY_EVENTS = Object.freeze({
  ON_ATTACHED: 0, ON_DETACHED: 1, ON_CAST_START: 2, ON_CAST_END: 3, ON_SPELL_ON: 4, ON_SPELL_END: 5, ON_ATTACK_FINISH: 6,
  ON_ATTACK_CHECK_POINT: 7, ON_OVERLOAD: 8,
});

/** An ability event as its number (a name of ABILITY_EVENTS or a number); null when absent or unknown. */
export function eventNum(e) {
  if (Number.isInteger(e)) return e;
  return typeof e === 'string' && Object.prototype.hasOwnProperty.call(ABILITY_EVENTS, e) ? ABILITY_EVENTS[e] : null;
}

/** Ability classes whose emitter rows follow each attack (the skill prefab's own attack). */
const isAttack = (a) => typeof a === 'string' && /Attack|Heal/.test(a) && !/^Channeling/.test(a);
const isChannel = (a) => typeof a === 'string' && /^Channeling/.test(a);
/** Abilities whose cast lasts the skill (a held row lasts it too, unless it ends at ON_CAST_END). */
const isLong = (a) => typeof a === 'string' && (/^(Active(OneOf)?BuffAbility|BuffDuring|Passive|ToggleablePassive)/.test(a) || /Aura/.test(a));

/** Buff events of a template action (Torappu.Battle.Buff/Event names, as index.json writes them) by timing. */
const START_EVENTS = new Set(['ON_BUFF_START', 'ON_BUFF_ENABLE', 'ON_BUFF_LATE_ENABLE', 'ON_SKILL_START', 'ON_TOGGLE_SKILL_START']);
const END_EVENTS = new Set(['ON_BUFF_FINISH', 'ON_BUFF_DISABLE', 'ON_SKILL_FINISH']);
const HIT_EVENTS = new Set(['ON_OUTPUT_DAMAGE', 'ON_AFTER_OUTPUT_DAMAGE', 'ON_ABILITY_CAST_ON_TARGET', 'ON_OUTPUT_ATK_OR_HEAL',
  'ON_OUTPUT_ATK_OR_HEAL_EACH_SPELL', 'ON_AFTER_ATTACK', 'ON_AFTER_OUTPUT_HEAL', 'ON_AFTER_OUTPUT_ELEMENT_DAMAGE']);
const CAST_EVENTS = new Set(['ON_ABILITY_START', 'ON_ABILITY_SPELL_ON', 'ON_BEFORE_ABILITY_SPELL_ON', 'ON_BEFORE_ATTACK']);

/** Effect fields whose positions come from the game (unmapped). */
const PATH_FIELD = /\.(_lineEffectKey|_startPointEffectKey|_waypointEffectKey|_endPointEffectKey|_edgeLineRendererEffectKey)$/;
const TILE_FIELD = /\._tileEffectKey$/;
const HOOK = '._hookEffectAfterFirstAttack';

/** The unmapped reasons (coverage tool, tests). */
export const UNMAPPED = Object.freeze({
  'no-prefab': 'the key has no extracted prefab',
  token: "a buff on the unit's summons: UnitInfo has no summoner link",
  tick: "a periodic tick of the skill's buff (ON_BUFF_TRIGGER): the sim sends no tick event (some kits send their own 'fx')",
  conditional: 'a buff template action at an event the client never sees (a condition check, would-die, a kill …)',
  'after-end': 'a buff created when the skill ends: its duration is not in index.json',
  'hit-no-attack': "hits of a non-attack ability: no 'atk' event names its targets",
  'channel-hit': "a channel's damage ticks: the sim sends them without a source",
  path: 'a line / path effect: its points come from the game',
  bound: 'created on the target of the ability: a kit fx binding places it there (FX_BINDINGS `at: \'target\'`)',
  tiles: 'tile effects on tiles the client is not told',
  other: 'the extractor could not place it in time',
});

/** Role → the client signal that drives it (module header; the coverage tool prints it). */
export const SIGNALS = Object.freeze({
  start: "b.ev ['skill', id, 1]",
  loop: "b.ev ['skill', id, 1] … ['skill', id, 0] (level: b.snap flags & UF.SKILL)",
  end: "b.ev ['skill', id, 0]",
  range: 'as start (one-shot) or loop (hold skill)',
  ready: 'b.snap sp >= spMax > 0 and not UF.SKILL (no event)',
  cast: "b.ev ['atk', ownerId, tgt, kind] while the skill is on",
  hit: "that attack's damage on its target (melee 'dmg' window / projectile arrival / 'heal')",
  trigger: "b.ev ['dmg', ownerId, …] while the skill is on",
  targets: "the buffs of the skill's own attacks: that attack's 'atk' targets; the others none (the client is not told who carries them)",
  charge: 'b.snap energy [[id, stored, cap]] (PR #636; char_469_indigo / the shared mystic store only)',
});

const lc = (k) => (typeof k === 'string' && k ? k.toLowerCase() : null);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---- resolution -----------------------------------------------------------------------------------------------------

/** The index unit key among candidate ids (FxWiring.unitOf's order; a `_<n>` suffix dropped), or null. */
export function unitKeyOf(idx, cands) {
  const units = idx?.units;
  if (!isObj(units)) return null;
  for (const c of [].concat(cands || [])) {
    if (!c || typeof c !== 'string') continue;
    if (units[c]) return c;
    const base = c.replace(/_\d+$/, '');
    if (base !== c && units[base]) return base;
  }
  return null;
}

/**
 * Our data's skill record a unit fights with: `rec.skills[]` with that index, else `rec.skill` — for a token's record
 * (data/tokens.json: a top `skill` without its type, the full records in its owners' `variants`) the variant record
 * (tokenSkillRecord).
 */
export function skillRecordOf(rec, skillIndex) {
  if (!isObj(rec)) return null;
  if (isObj(rec.variants) && isObj(rec.skill) && typeof rec.skill.skillType !== 'string') {
    const t = tokenSkillRecord(rec, skillIndex);
    if (t) return t;
  }
  const list = Array.isArray(rec.skills) ? rec.skills : [];
  if (Number.isInteger(skillIndex)) {
    const s = list.find((x) => isObj(x) && x.index === skillIndex);
    if (s) return s;
    if (isObj(rec.skill) && (rec.skill.index == null || rec.skill.index === skillIndex)) return rec.skill;
    return null;
  }
  return isObj(rec.skill) ? rec.skill : list.find((x) => isObj(x) && x.isDefault) || null;
}

/**
 * A token's skill record from its owners' variants (data/tokens.json `variants[owner].skill` and `.bySkill[i].skill`,
 * the full records — skillType, duration, prefabId, the owner skill's blackboard): the one whose `index` is the unit's
 * skillIndex (the sim's token def merges the owner's choice and UnitInfo sends its `index`: 浊心斯卡蒂 S1 / S2 / S3 give
 * her 海嗣 sktok_skadi2_1 / _2 / _3), else — no index — the top record completed with the type fields of the variant
 * record of its id; null when no variant record fits (the top record stays as it is). [ASSUMED] the first owner's
 * record of that index (data order: the base piece `_a` before its elite `_b` — UnitInfo names no summoner): the
 * owners' records of one index differ only in level, text, blackboard values and (蜜蜡's 沙之碑) SP cost, and the top
 * record carries the base piece's too.
 */
export function tokenSkillRecord(rec, skillIndex) {
  const all = [];
  for (const v of Object.values(rec?.variants || {})) {
    if (!isObj(v)) continue;
    if (isObj(v.skill)) all.push(v.skill);
    for (const b of Object.values(isObj(v.bySkill) ? v.bySkill : {})) if (isObj(b?.skill)) all.push(b.skill);
  }
  const typed = all.filter((s) => typeof s.skillType === 'string');
  if (Number.isInteger(skillIndex)) {
    const s = typed.find((x) => x.index === skillIndex);
    if (s) return s;
  }
  const top = isObj(rec?.skill) ? rec.skill : null;
  if (!top) return null;
  const ids = skillIdsOf(top);
  const same = typed.find((x) => skillIdsOf(x).some((k) => ids.includes(k)));
  if (!same) return null;
  const { skillType, durationType, duration, spType } = same;
  return { ...top, skillType, durationType, duration, spType };
}

/** Candidate index skill ids of a skill record (prefabId, skillId; lower case, a `[n]` suffix dropped). */
export function skillIdsOf(srec) {
  const out = [];
  for (const v of [srec?.prefabId, srec?.skillId]) {
    const k = lc(v);
    if (!k) continue;
    for (const x of [k, k.replace(/\[\d+\]$/, '')]) if (!out.includes(x)) out.push(x);
  }
  return out;
}

/**
 * The official skill of a battle unit.
 * @param {any} idx index.json
 * @param {{ info?: any, rec?: any, unitKey?: string|null, skillIndex?: number }} unit  the view's info, its data record
 *   (ctx.lookupDef(info)); `unitKey` / `skillIndex` override what the info says
 * @returns {{ unitKey: string|null, skillId: string|null, skill: any, via: 'record'|'name'|'plugin'|null, reason: string|null }}
 */
export function resolveSkill(idx, { info = null, rec = null, unitKey = null, skillIndex } = {}) {
  // Explicit mappings require an exact extracted key; art candidates retain their legacy suffix fallback.
  const requested = rec?.fx?.unit;
  const mappedUnit = typeof requested === 'string' && Object.hasOwn(idx?.units || {}, requested) ? requested : null;
  const key = mappedUnit || idx?.pluginUnits?.[rec?.charId || info?.diy?.charId] || unitKey || unitKeyOf(idx, [info?.diy?.charId, info?.spine, rec?.charId, info?.defId]);
  const out = { unitKey: key, skillId: null, skill: null, via: null, reason: null };
  if (!key) { out.reason = 'no-unit'; return out; }
  const unit = idx.units[key];
  const kind = unit.kind;
  const index = Number.isInteger(skillIndex) ? skillIndex
    : Number.isInteger(info?.diy?.skillIndex) ? info.diy.skillIndex : Number.isInteger(info?.skillIndex) ? info.skillIndex : undefined;
  const find = (id) => (isObj(unit.skills) && unit.skills[id]) || (isObj(idx.skills) && idx.skills[id]) || null;
  const srec = skillRecordOf(rec, index);
  const mapping = mappedUnit === key ? rec?.fx?.skills : null;
  // [ASSUMED] An explicit slot wins over an id; a missing mapping falls through to the old resolver.
  const mapped = mapping?.[String(index ?? srec?.index)] ?? mapping?.[srec?.skillId] ?? mapping?.[srec?.prefabId];
  if (typeof mapped === 'string' && find(mapped)) return { ...out, skillId: mapped, skill: find(mapped), via: 'plugin' };
  const ns = key.startsWith('plugin:') ? key.slice(0, key.lastIndexOf(':') + 1) : '';
  for (const id of skillIdsOf(srec).flatMap(id => ns ? [ns + id, id] : [id])) {
    const s = find(id);
    if (s) return { ...out, skillId: id, skill: s, via: 'record' };
  }
  const m = /^char_\d+_(.+)$/.exec(key);
  if (!srec && m && Number.isInteger(index)) {   // the naming only stands in for a missing record (it could name another skill)
    const id = `skchr_${m[1]}_${index + 1}`;
    const s = find(id);
    if (s) return { ...out, skillId: id, skill: s, via: 'name' };
  }
  // a summon without a record of its skill (index v2 has the summons' skills): the only one its unit has [ASSUMED]
  const own = isObj(unit.skills) ? Object.keys(unit.skills) : [];
  if (!srec && kind === 'token' && own.length === 1) return { ...out, skillId: own[0], skill: unit.skills[own[0]], via: 'only' };
  out.skillId = skillIdsOf(srec)[0] || null;
  out.reason = kind === 'enemy' || info?.side === 'enemy' ? 'enemy-skill' : kind === 'token' ? 'token-skill' : srec ? 'not-in-index' : 'no-skill';
  return out;
}

// ---- the plan -------------------------------------------------------------------------------------------------------

/**
 * The rows of a MultiHitUberEffectEmitter's _hitGroups → groups. Index v2 gives each row its `group` and the list's
 * length (`groups`): every group is kept, an empty one too (that hit plays nothing). Index v1 lists them flattened in use
 * order: a row starts a new group unless its key names a range (`_range`), which joins the group before it (header).
 */
export function hitGroups(rows) {
  if (rows.some((r) => Number.isInteger(r.group))) {
    let n = 0;
    for (const r of rows) n = Math.max(n, Number.isInteger(r.groups) ? r.groups : 0, Number.isInteger(r.group) ? r.group + 1 : 0);
    const groups = Array.from({ length: n }, () => []);
    for (const r of rows) if (Number.isInteger(r.group) && r.group >= 0) groups[r.group].push(r);
    return groups;
  }
  const groups = [];
  let last = null;
  for (const r of rows) {
    if (last && /_range/.test(r.key)) last.push(r);
    else groups.push((last = [r]));
  }
  return groups;
}

/**
 * How a hit-group list plays (the MultiHit emitter's settings on its rows, index v2): `indexed` (the groups are the
 * client's, empty ones included), `loop` (hit k plays group k mod n), `random` (a random group per hit), `once` (once
 * per target per cast).
 */
export function hitOptsOf(rows) {
  const f = (k) => rows.some((r) => r[k] === 1 || r[k] === true);
  return { indexed: rows.some((r) => Number.isInteger(r.group)), loop: f('useLoopHitEffect'), random: f('useRandomHitEffect'), once: f('oncePerTarget') };
}

/** SpawnLocation names (ParticleEffect._spawnLocation, DESIGN §33.11 metadata). */
export const SPAWN_LOCATIONS = Object.freeze(['NONE', 'FOOT_POINT', 'HIT_POINT', 'MUZZLE_POINT', 'HEAD_POINT', 'GROUND_CENTER',
  'MUZZLE_POINT_WITHOUT_ROTATION', 'GROUND_CENTER_WITH_ZERO_HEIGHT', 'MP_SPECIAL_0', 'MP_SPECIAL_1', 'MP_SPECIAL_2', 'MP_SPECIAL_3',
  'CAMERA', 'MP_SPECIAL_4', 'MP_SPECIAL_5', 'MP_SPECIAL_6', 'MP_SPECIAL_7', 'TILE_CENTER', 'MP_SPECIAL_8', 'MP_SPECIAL_9',
  'MP_SPECIAL_10', 'MP_SPECIAL_11', 'MP_SPECIAL_12', 'MP_SPECIAL_13', 'MP_SPECIAL_14', 'MP_SPECIAL_15', 'GROUND_CENTER_WITH_TILE_HEIGHT',
  'MP_SPECIAL_16', 'MP_SPECIAL_17', 'MP_SPECIAL_18', 'MP_SPECIAL_19', 'MP_SPECIAL_20', 'MP_SPECIAL_21', 'MP_SPECIAL_22',
  'MP_SPECIAL_23', 'GROUND_CENTER_WITH_HIGHLAND_HEIGHT']);

/** A FollowMountPoint MountPointType's name (DESIGN §33.11 metadata: 0 FOOT, 1 HIT, 2 MUZZLE, 3 HEAD, 4 UI, 5 SPECIAL_0 …). */
export function mountPointName(t) {
  if (!Number.isInteger(t) || t < 0) return null;
  const fixed = ['FOOT', 'HIT', 'MUZZLE', 'HEAD', 'UI', 'SPECIAL_0', 'SPECIAL_1', 'GROUND', 'SPECIAL_2', 'SPECIAL_3'];
  if (t < fixed.length) return fixed[t];
  return t <= 29 ? `SPECIAL_${t - 6}` : null;
}

/**
 * Where a prefab places its effect: its root ParticleEffect's `_spawnLocation` (name), FollowMountPoint's point, and
 * whether it loops. `desc` = a prefab descriptor (prefabs/<file>.json) or a compiled def with `desc`.
 * @returns {{ spawn: number|null, point: string|null, follow: string|null, loop: boolean|null, projectile: boolean } | null}
 */
export function anchorOf(desc) {
  const d = isObj(desc?.desc) ? desc.desc : desc;
  if (!isObj(d) || !Array.isArray(d.nodes)) return null;
  let pe = null, follow = null, projectile = false;
  for (const n of d.nodes) {
    for (const b of Array.isArray(n?.behaviours) ? n.behaviours : []) {
      if (!b || b.enabled === false) continue;
      if (!pe && (b.class === 'ParticleEffect' || b.class === 'EmptyEffect')) pe = b.fields || {};
      else if (b.class === 'ProjectileEffect') projectile = true;
      else if (b.class === 'FollowMountPoint' && follow == null) follow = b.fields?._mountPointType;
    }
  }
  const spawn = Number.isInteger(pe?._spawnLocation) ? pe._spawnLocation : null;
  return {
    spawn, point: spawn != null ? SPAWN_LOCATIONS[spawn] || null : null, follow: mountPointName(follow),
    loop: pe ? !!pe._isLoop : (typeof d.stats?.looping === 'boolean' ? d.stats.looping : null), projectile,
  };
}

/**
 * Our skill record (and the skill's root class, index v2) → plan.kind (header): a PASSIVE record is 'passive', a
 * `ReplacementSkill*` root one cast that replaces the next attack ('instant'), else the record's duration type.
 */
function kindOf(srec, rootClass = null) {
  if (isObj(srec) && srec.skillType === 'PASSIVE') return 'passive';
  if (typeof rootClass === 'string' && /^ReplacementSkill/.test(rootClass)) return 'instant';
  if (!isObj(srec)) return rootClass === 'PassiveSkill' ? 'passive' : null;
  if (srec.durationType === 'AMMO') return 'ammo';
  return Number(srec.duration) > 0 ? 'lasting' : 'instant';
}

/** An empty plan (the shape skillPlan returns; render/vfx/talents.js fills one per talent node with planUses). */
export const emptyPlan = (unitKey, skillId) => ({
  unitKey, skillId, mode: null, modeName: null, kind: null, rootClass: null, projectiles: [],
  start: [], loop: [], end: [], ready: [], range: [], attacks: [], each: { cast: [], hit: [[]] }, trigger: [], targets: [],
  pulse: [], unmapped: [], cond: [],
});

/**
 * The client's condition graphs of `[eff_cond]` buffs (config/buff_template_holder.ab, the template's ON_BUFF_TRIGGER —
 * every 0.1 s, index v3 life.tick —; read from the client of 2026-10-15): the buffs each state keeps on the owner, by
 * the template (a use's `buff`). index.json lists their keys only, not the branches. States, in the graph's order:
 * `charged` — the skill runs, cast with every charge stored (CheckCharSkillAffecting + billro_talent_enhance_mark);
 * `on` — it runs; `full` — it waits with 2 charges stored (CompareCharSkillAvailableCnt ≥ 2); `ready` — with 1 (≥ 1);
 * none below (FinishDerivedBuff). render/vfx/skillfx.js plays the state's loops (plan.cond).
 */
export const COND_BUFFS = Object.freeze({
  'billro_s_1[eff_cond]': Object.freeze({
    charged: ['billro_skill_01_buff_02', 'billro_skill_01_buff_01_02'], on: ['billro_skill_01_buff_01_02'],
    full: ['billro_skill_01_buff_02', 'billro_skill_01_buff_01_02'], ready: ['billro_skill_01_buff_01'],
  }),
  'billro_s_2[eff_cond]': Object.freeze({
    charged: ['billro_skill_02_buff_02', 'billro_skill_02_buff_01_02'], on: ['billro_skill_02_buff_01_02'],
    full: ['billro_skill_02_buff_02', 'billro_skill_02_buff_01_02'], ready: ['billro_skill_02_buff_01'],
  }),
  'billro_s_3[eff_cond]': Object.freeze({
    charged: ['billro_skill_03_buff_01_02', 'billro_skill_03_buff_01_01_02', 'billro_skill_03_buff_02_02', 'billro_skill_03_buff_02_01'],
    on: ['billro_skill_03_buff_02_01', 'billro_skill_03_buff_01_01_02'],
    full: ['billro_skill_03_buff_01_02', 'billro_skill_03_buff_01_01_02'], ready: ['billro_skill_03_buff_01_01'],
  }),
});

/**
 * The `[eff_cond]` state of a charge skill now (COND_BUFFS): `on` — the skill runs; `charged` — its cast took every
 * charge; `charges` — [stored, maximum] (b.snap `charges`), null when unknown. Returns 'charged' | 'on' | 'full' |
 * 'ready' | null.
 */
export function condState({ on = false, charged = false, charges = null } = {}) {
  if (on) return charged ? 'charged' : 'on';
  const n = Array.isArray(charges) ? Number(charges[0]) || 0 : 0;
  return n >= 2 ? 'full' : n >= 1 ? 'ready' : null;
}

/** Unmapped reasons whose entries a kit's own 'fx' of the skill may stand for (plan.pulse). */
const PULSE = new Set(['tick', 'channel-hit', 'hit-no-attack']);

/** An effect key's facing suffix (a buff template's direction branches name their effects so): [1] base, [2] facing. */
const DIR_SUFFIX = /^(.*?)_(up|down|left|right|back|front)$/;

/**
 * Facing variants among a list of uses (history §32.14.43): the rows of one buff template action — same `from`, `event`,
 * `action`, `buff`, `node`, `on`, `role` and `mode`, no emitter `ability` — whose keys are one effect's variants by name
 * (`<base>_up` / `_down` / `_left` / `_right`, `_back` for a unit facing up, `_front`, and the plain `<base>`) are one
 * effect picked by the owner's facing: one use with `slots` (0 UP, 1 RIGHT, 2 DOWN, 3 LEFT; a facing without a variant of
 * its own plays the plain key, else `_front`) and directionType 5, the owner's deploy direction (wiring.js _dirIndex).
 * The client picks them with CheckCharacterDefaultDirection branches of the template's graph (仇白 S2's
 * qiubai_s_2[sword_wind_effect]: UP `_up`, DOWN `_down`, RIGHT the plain key, else `_left`; 号角's overload switch: UP
 * `_back`, else `_front`; 鸿雪's token buff) — index.json writes each branch's buff as a use of its own, without the
 * condition; every such family of index v3 is one of those branches (client 26-09-13). Other uses are returned as they are.
 */
export function dirFamilies(uses) {
  if (!Array.isArray(uses) || uses.length < 2) return uses || [];
  const groups = new Map();
  uses.forEach((u, i) => {
    if (!isObj(u) || u.ability || !Array.isArray(u.keys) || u.keys.length !== 1 || (Array.isArray(u.slots) && u.slots.some(Boolean))) return;
    const g = [u.from, u.event, u.action, u.buff, u.node, u.on, u.role, u.mode].map((x) => (x == null ? '' : String(x))).join('|');
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(i);
  });
  const repl = new Map();
  const drop = new Set();
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const fams = new Map();   // base → { dir → use index }
    for (const i of list) {
      const k = lc(uses[i].keys[0]);
      const m = k ? DIR_SUFFIX.exec(k) : null;
      const base = m ? m[1] : k;
      if (!base) continue;
      if (!fams.has(base)) fams.set(base, {});
      const f = fams.get(base);
      const d = m ? m[2] : 'plain';
      if (f[d] == null) f[d] = i;
    }
    for (const f of fams.values()) {
      const dirs = Object.keys(f);
      if (dirs.length < 2 || !dirs.some((d) => d !== 'plain')) continue;
      const key = (d) => (f[d] != null ? lc(uses[f[d]].keys[0]) : null);
      const def = key('plain') || key('front') || null;
      const slots = [key('up') || key('back') || def, key('right') || def, key('down') || def, key('left') || def];
      const first = Math.min(...Object.values(f));
      repl.set(first, { ...uses[first], keys: [def || slots.find(Boolean)], slots, directionType: 5, dirBy: 'name' });
      for (const i of Object.values(f)) if (i !== first) drop.add(i);
    }
  }
  if (!repl.size) return uses;
  return uses.flatMap((u, i) => (repl.has(i) ? [repl.get(i)] : drop.has(i) ? [] : [u]));
}

/** An attack ability of a skill that its end casts (by name: FinalAttack, EndAttack …) [ASSUMED from the node names]. */
const END_ATTACK = /^(?:Final|End)(?:[A-Z_]\w*)?$/;

/**
 * The skill's own casts among its attack abilities (history §32.14.43) — `when` on plan.attacks: 'end' for a final
 * attack (END_ATTACK, or one whose cast rows are all `end`: 灵知 S3, 薄荷 S2, 歌蕾蒂娅 S3, 锏 S3), 'start' for the attacks
 * of a lasting / passive skill whose root ability is a sequence (AbilitySequenceGroup: the skill runs it once as it
 * starts — 缄默德克萨斯 S2 / S3's appear strike, 仇白 S2's sword split, 余 S2's teleport, 焰影苇草 S2's fire balls); the
 * normal attacks while the skill is on are then the mode's (or the unit's own), not these. Our record decides `kind`:
 * without one nothing is tagged.
 */
function tagCasts(plan, skill) {
  const once = plan.kind != null && plan.kind !== 'instant' && /Sequence/.test(String(skill?.rootAbility || ''));
  for (const a of plan.attacks) {
    if (END_ATTACK.test(String(a.node || '')) || (a.cast.length && a.cast.every((e) => e.role === 'end'))) a.when = 'end';
    else if (once) a.when = 'start';
  }
}

/**
 * The plan of a skill (module header).
 * @param {any} idx index.json
 * @param {string|null} unitKey  the owner's index unit (its modes name `modeName`)
 * @param {string} skillId
 * @param {{ rec?: any, describe?: (key: string) => any }} [opts]  rec: our skill record (plan.kind); describe: key →
 *   prefab descriptor or summary, for each entry's `point` / `follow` (anchorOf)
 */
export function skillPlan(idx, unitKey, skillId, opts = {}) {
  const id = lc(skillId);
  const plan = emptyPlan(unitKey || null, id);
  plan.kind = kindOf(opts.rec);
  const unit = unitKey && isObj(idx?.units) ? idx.units[unitKey] : null;
  const skill = (id && isObj(unit?.skills) && unit.skills[id]) || (id && isObj(idx?.skills) && idx.skills[id]) || null;
  if (!skill) return plan;
  plan.kind = kindOf(opts.rec, skill.rootClass);
  let attach = [];
  if (Number.isInteger(skill.mode)) {
    plan.mode = skill.mode;
    plan.modeName = unit?.modes?.[skill.mode]?.name ?? null;
    attach = attachUses(unit?.modes?.[skill.mode]);
  }
  if (typeof skill.rootClass === 'string' && skill.rootClass) plan.rootClass = skill.rootClass;
  const projs = isObj(idx.projectiles) ? idx.projectiles : {};
  for (const k of Array.isArray(skill.projectiles) ? skill.projectiles : []) {
    const kk = lc(k);
    if (kk && projs[kk] && !plan.projectiles.includes(kk)) plan.projectiles.push(kk);
  }
  let uses = Array.isArray(skill.uses) ? skill.uses : [];
  if (id === 'skchr_yu_3') {
    // Official ProjectileProbElimateBehaviour places annex_01 at the removed bullet, never on Yu's attacks.
    // GlobalAuraAbility's annex_02 requires the ally buff's ON_TAKE_DAMAGE trigger; no matching sim event exists.
    uses = uses.filter((u) => !(u.keys || []).some((k) => /^yu_skill3_annex_0[12]$/i.test(k)));
    plan.unmapped.push({ key: 'yu_skill3_annex_01', role: 'hit', reason: 'bound', from: 'ProjectileProbElimateBehaviour._effectOnEliminatePos' });
    plan.unmapped.push({ key: 'yu_skill3_annex_02', role: 'trigger', reason: 'conditional', from: 'GlobalAuraAbility._buffs' });
  }
  planUses(idx, plan, [...uses, ...attach], { ...opts, abilities: skill.abilities });
  // EmptyEffect has no particles/loop flag, but FinishEffectViaOwnerBuff holds this controller for yu_s_3[effect].
  if (id === 'skchr_yu_3') for (const role of ['start', 'loop', 'range']) for (const e of plan[role]) {
    if (e.key === 'yu_skill3_range_01_source') { e.hold = 'skill'; e.loop = true; }
  }
  // a key a kit fx binding plays on the unit that fx names is no row on the owner (FX_BINDINGS `at: 'target'`)
  const bound = targetBound(id);
  if (bound.size) {
    for (const role of ['start', 'loop', 'range', 'end']) {
      plan[role] = plan[role].filter((e) => !bound.has(e.key) || (plan.unmapped.push({ key: e.key, role: e.role, reason: 'bound', from: e.from }), false));
    }
  }
  if (isObj(opts.rec)) tagCasts(plan, skill);
  return plan;
}

/**
 * The attach rows of the mode a skill switches to (index.json Attack `attach`: AttachEffectOptions, from the ability's
 * attach to its detach — the mode's attack is attached while the mode is on, i.e. while the skill lasts): uses of the
 * plan, held for the skill — `range` for a `*_range*` effect (溯光星源 S3's area, 薄绿 S1's), else `loop` (普罗旺斯 S2,
 * 百炼嘉维尔's chainsaw glow). Rows `onlyAttachOnDummy` are the client's preview dummy's. Sub-abilities' rows join.
 */
export function attachUses(mode) {
  const out = [];
  const walk = (a, depth = 0) => {
    if (!isObj(a) || depth > 4) return;
    for (const r of Array.isArray(a.attach) ? a.attach : []) {
      if (!isObj(r) || r.onlyAttachOnDummy === 1 || r.onlyAttachOnDummy === true) continue;
      const keys = (Array.isArray(r.effects) ? r.effects : []).map(lc).filter(Boolean).slice(0, 1);
      for (const k of keys) out.push({ role: /_range/.test(k) ? 'range' : 'loop', keys: [k], from: 'Attack.attach', node: a.node ?? null });
    }
    for (const sub of Array.isArray(a.abilities) ? a.abilities : []) walk(sub, depth + 1);
  };
  if (isObj(mode)) { walk(mode.attack); if (mode.combat !== mode.attack) walk(mode.combat); }
  return out;
}

/** A MountPointType number of its name (mountPointName's inverse: 'MUZZLE' → 2, 'SPECIAL_6' → 12), or null. */
export function mountPointType(name) {
  if (typeof name !== 'string' || !name) return null;
  const fixed = { FOOT: 0, HIT: 1, MUZZLE: 2, HEAD: 3, UI: 4, SPECIAL_0: 5, SPECIAL_1: 6, GROUND: 7, SPECIAL_2: 8, SPECIAL_3: 9 };
  if (Object.hasOwn(fixed, name)) return fixed[name];
  const m = /^SPECIAL_(\d+)$/.exec(name);
  return m && Number(m[1]) >= 4 && Number(m[1]) <= 23 ? Number(m[1]) + 6 : null;
}

/**
 * The shots of an attack ability (index v3, DESIGN §33.17): where its projectile leaves (`mount`, a `mountGroup`'s
 * points taken in turn or at random) and the follow-up shots of a multi attack (`additionalTimes` after the first, every
 * `triggerDelta` s, flying `additionalProjectile(s)` — one key for all, one per shot — else the attack's own); null for
 * a plain one-shot from the muzzle.
 */
export function shotOf(ab, projs = {}) {
  if (!isObj(ab)) return null;
  const keyOk = (k) => { const kk = lc(k); return kk && projs[kk] ? kk : null; };
  const mount = mountPointType(ab.mount);
  const group = isObj(ab.mountGroup) && Array.isArray(ab.mountGroup.mounts) ? ab.mountGroup.mounts.map(mountPointType).filter((x) => x != null) : [];
  const times = Number.isInteger(ab.additionalTimes) && ab.additionalTimes > 0 ? Math.min(12, ab.additionalTimes) : 0;
  const extra = Array.isArray(ab.additionalProjectiles) ? ab.additionalProjectiles : Array.isArray(ab.additionalProjectile) ? ab.additionalProjectile
    : ab.additionalProjectile != null ? [ab.additionalProjectile] : [];
  const additional = extra.map(keyOk);
  const shot = {
    mount: mount != null && mount !== 2 ? mount : null,
    mountGroup: group.length ? { random: ab.mountGroup.loop === 'RANDOM', mounts: group } : null,
    times, delta: Number(ab.triggerDelta) > 0 ? Math.min(2, Number(ab.triggerDelta)) : 0,
    // the key of follow-up shot i (1-based): its own, the one key given for all, else the attack's projectile (null)
    additional: additional.length > 1 ? additional : additional.length === 1 ? Array(times).fill(additional[0]) : [],
  };
  return shot.mount == null && !shot.mountGroup && !shot.times ? null : shot;
}

/**
 * Fill `plan` from a list of uses — a skill's, a talent node's, an ability's: the same shape (DESIGN §33.12, §33.17).
 * opts.mode: the copy of an enemy skill held in several modes (default 'Default': that copy's uses and the ones without
 * a `mode`; null keeps every use — a talent node's uses name the mode that holds the node); opts.abilities: the prefab's
 * attack abilities (index v3 `abilities`: an attack's projectile, mount and follow-up shots; one firing a projectile
 * without rows of its own is an attack of the plan too); opts.describe: as skillPlan's.
 */
export function planUses(idx, plan, uses, opts = {}) {
  const prefabs = isObj(idx?.prefabs) ? idx.prefabs : {};
  const projs = isObj(idx?.projectiles) ? idx.projectiles : {};
  const attacks = new Map();   // node|ability → { node, ability, cast, range, aim, all (every hit), grouped (_hitGroups), projectile }
  const attackOf = (u) => {
    const k = `${u.node ?? ''}|${u.ability}`;
    let a = attacks.get(k);
    if (!a) { a = { node: u.node ?? null, ability: u.ability, cast: [], range: [], aim: [], all: [], grouped: [], projectile: null, shot: null }; attacks.set(k, a); }
    // index v3: an emitter use of a projectile-firing ability names that ability's projectile
    const pk = lc(u.projectileKey);
    if (!a.projectile && pk && projs[pk]) a.projectile = pk;
    return a;
  };
  const eachHit = [];
  const miss = (key, role, reason, u) => { plan.unmapped.push({ key, role, reason, from: u.from }); };

  // an enemy skill held in several modes (index v2): its copies' uses name their `mode` — the plan of `opts.mode`
  // (default 'Default') keeps that copy's and the uses without one
  const mode = opts.mode === null ? null : typeof opts.mode === 'string' ? opts.mode : 'Default';
  // one buff template action's facing variants are one effect picked by facing (dirFamilies)
  uses = dirFamilies(uses);
  for (let i = 0; i < uses.length; i++) {
    const u = uses[i];
    if (!isObj(u) || !Array.isArray(u.keys)) continue;
    if (mode !== null && typeof u.mode === 'string' && u.mode !== mode) continue;
    const role = u.role;
    const hook = typeof u.from === 'string' && u.from.endsWith(HOOK);
    const hooked = !hook && uses[i + 1]?.from === `${u.from}${HOOK}` && uses[i + 1]?.node === u.node;
    // a directional row is one effect picked by facing (slotKey): one entry carrying the slots; other rows play every key
    const directional = Array.isArray(u.slots) && u.slots.some(Boolean);
    for (const key0 of directional ? u.keys.slice(0, 1) : u.keys) {
      const key = lc(key0);
      if (!key) continue;
      if (!prefabs[key]) { miss(key, role, 'no-prefab', u); continue; }
      const e = entryOf(key, role, u, prefabs, opts.describe);
      if (hook) e.afterFirst = true;
      if (hooked) e.firstOnly = true;
      const placed = place(plan, e, u, { attackOf, eachHit });
      if (placed) {
        miss(key, role, placed, u);
        // a facing family's other variants are unmapped with it (dirFamilies)
        if (u.dirBy === 'name') for (const s of new Set(e.slots || [])) if (s && s !== key) miss(s, role, placed, u);
        // a tick of the owner's buff plays on the owner, the others on what they hit
        if (PULSE.has(placed)) plan.pulse.push({ ...e, at: placed === 'tick' && e.on !== 'targets' ? 'owner' : 'target', hold: oneShotHold(e), reason: placed });
      }
    }
  }
  // index v3: the prefab's attack abilities — their projectile (the naming guess of skillProjectile only without one),
  // mount and follow-up shots; an ability firing a projectile with no rows of its own still flies it
  for (const ab of Array.isArray(opts.abilities) ? opts.abilities : []) {
    if (!isObj(ab) || !isAttack(ab.class)) continue;
    const k = `${ab.node ?? ''}|${ab.class}`;
    const pk = lc(ab.projectileKey);
    let a = attacks.get(k);
    if (!a) {
      if (!(pk && projs[pk])) continue;
      a = { node: ab.node ?? null, ability: ab.class, cast: [], range: [], aim: [], all: [], grouped: [], projectile: null, shot: null };
      attacks.set(k, a);
    }
    if (!a.projectile && pk && projs[pk]) a.projectile = pk;
    if (!a.shot) a.shot = shotOf(ab, projs);
  }
  for (const a of attacks.values()) {
    const groups = hitGroups(a.grouped);
    const hitOpts = hitOptsOf(a.grouped);
    // a MultiHit emitter's own `_hitEffects` give way to its groups unless it keeps them (`keepBaseHitEffect`)
    const keep = a.grouped.some((e) => e.keepBaseHitEffect === 1 || e.keepBaseHitEffect === true);
    const all = groups.length && !keep ? a.all.filter((e) => e.from !== 'MultiHitUberEffectEmitter._hitEffects') : a.all;
    const hit = groups.length ? groups.map((g) => [...g, ...all]) : [all];
    // the client's own groups keep their empty ones (that hit plays nothing); v1's rebuilt groups drop them
    plan.attacks.push({
      node: a.node, ability: a.ability, cast: a.cast, range: a.range, aim: a.aim, hit: hitOpts.indexed ? hit : hit.filter((g) => g.length), hitOpts,
      projectile: a.projectile, shot: a.shot,
    });
  }
  plan.each.hit = [eachHit];
  return plan;
}

/** A plan entry of one key of a use (`prefabs`: index.json prefabs, the key's summary among them). */
function entryOf(key, role, u, prefabs, describe) {
  const e = { key, role, at: 'owner', loop: !!prefabs[key].looping, hold: null, from: u.from };
  // (v2: a group list's `group` / `groups`, a replace group's `anim`, the MultiHit choice flags, an enemy copy's `mode`)
  // (v3: a buff use's `life`, an emitter use's `projectileKey`)
  for (const f of ['node', 'ability', 'list', 'startEvent', 'endEvent', 'directionType', 'event', 'action', 'buff', 'on',
    'group', 'groups', 'anim', 'useLoopHitEffect', 'useRandomHitEffect', 'keepBaseHitEffect', 'oncePerTarget', 'mode', 'life', 'projectileKey']) {
    if (u[f] != null) e[f] = u[f];
  }
  // where it sits on its owner: index v2's prefab summary (`spawn` / `follow`), without loading the descriptor
  const sum = prefabs[key];
  if (Number.isInteger(sum.spawn)) e.point = SPAWN_LOCATIONS[sum.spawn] || null;
  if (Number.isInteger(sum.follow)) e.follow = mountPointName(sum.follow);
  // a slot without an extracted prefab plays nothing (null)
  if (Array.isArray(u.slots) && u.slots.length) e.slots = u.slots.map((x) => { const k = lc(x); return k && prefabs[k] ? k : null; });
  if (u.by === 'name') e.byName = true;
  // the start effect a skill that appears with its unit gives the unit's deploy (Character.GetStartEffect)
  if (/AppearSkill\._overrideStartEffect$/.test(String(u.from || ''))) e.birth = true;
  if (typeof describe === 'function') {
    const a = anchorOf(describe(key));
    if (a) { e.point = a.point; e.follow = a.follow; }
  }
  return e;
}

/** Hold of an entry in a one-shot role: none, unless its prefab loops (then the cast's) [ASSUMED]. */
const oneShotHold = (e) => (e.loop ? 'cast' : null);

/**
 * Put one entry into the plan; returns an unmapped reason, or null when placed.
 * @returns {string|null}
 */
function place(plan, e, u, { attackOf, eachHit }) {
  const role = e.role;
  if (role === 'other') return 'other';
  if (PATH_FIELD.test(u.from)) return 'path';
  if (TILE_FIELD.test(u.from)) return 'tiles';
  if (role === 'ready') { e.hold = 'ready'; plan.ready.push(e); return null; }
  // emitter rows: relative to the cast of the ability they serve
  if (u.ability) {
    const held = u.oneshot === false || role === 'loop';
    if (isAttack(u.ability)) {
      const a = attackOf(u);
      if (role === 'hit') {
        e.at = 'target';
        e.hold = held ? 'cast' : oneShotHold(e);
        if (u.list === 'castTarget' || u.list === 'inputTarget') a.aim.push(e);   // on the targets at the cast, once
        else if (/_hitGroups$/.test(u.from)) a.grouped.push(e);
        else a.all.push(e);
        return null;
      }
      e.hold = held ? 'cast' : oneShotHold(e);
      if (role === 'range') a.range.push(e);
      else a.cast.push(e);
      return null;
    }
    if (role === 'hit') return isChannel(u.ability) ? 'channel-hit' : 'hit-no-attack';
    const skillLong = isChannel(u.ability) || (isLong(u.ability) && u.endEvent !== 'ON_CAST_END');
    if (role === 'range') {
      e.hold = held ? (skillLong ? 'skill' : 'cast') : oneShotHold(e);
      plan.range.push(e);
      return null;
    }
    if (role === 'end') { e.hold = oneShotHold(e); plan.end.push(e); return null; }
    if (held && skillLong) { e.hold = 'skill'; plan.loop.push(e); return null; }
    if (role === 'loop' || role === 'start') { e.hold = held ? 'cast' : oneShotHold(e); plan.start.push(e); return null; }
    if (role === 'cast') { e.hold = oneShotHold(e); plan.each.cast.push(e); return null; }
    return 'other';
  }
  // buffs, buff template actions, effect fields
  if (e.action === 'CreateBuffToToken' || u.on === 'token' || /_buffsToToken/.test(u.from)) return 'token';
  const onTargets = u.on === 'targets';
  const ev = u.event;
  if (ev && !START_EVENTS.has(ev)) {
    if (END_EVENTS.has(ev)) {
      if (role === 'loop') return 'after-end';
      if (onTargets) { e.at = 'targets'; e.hold = oneShotHold(e); plan.targets.push(e); return null; }
      e.hold = oneShotHold(e);
      plan.end.push(e);
      return null;
    }
    if (ev === 'ON_TAKE_DAMAGE') {
      if (onTargets) return 'conditional';
      e.hold = oneShotHold(e);
      plan.trigger.push(e);
      return null;
    }
    if (HIT_EVENTS.has(ev) && role === 'hit') { e.at = 'target'; e.hold = oneShotHold(e); eachHit.push(e); return null; }
    if (CAST_EVENTS.has(ev) && role !== 'loop') { e.hold = oneShotHold(e); plan.each.cast.push(e); return null; }
    // a periodic tick of the buff (an effect / damage action; a buff created there is a condition's visual state —
    // played by state where the client's condition graph is known: COND_BUFFS, 卡涅利安's sand armour)
    if (ev === 'ON_BUFF_TRIGGER' && !/^CreateBuff/.test(u.action || '')) return 'tick';
    if (ev === 'ON_BUFF_TRIGGER' && role === 'loop' && COND_BUFFS[u.buff]) { e.hold = 'cond'; plan.cond.push(e); return null; }
    return 'conditional';
  }
  // at the skill (or its buff's) start, or no event
  if (role === 'hit') {
    if (/(ChannelingEffect\w*Emitter)\./.test(u.from)) return 'channel-hit';
    e.at = 'target';
    e.hold = oneShotHold(e);
    eachHit.push(e);
    return null;
  }
  if (role === 'cast') { e.hold = oneShotHold(e); plan.each.cast.push(e); return null; }
  if (role === 'trigger') return 'conditional';
  if (onTargets) { e.at = 'targets'; e.hold = role === 'loop' ? 'skill' : oneShotHold(e); plan.targets.push(e); return null; }
  if (role === 'loop') { e.hold = 'skill'; plan.loop.push(e); return null; }
  // a skill's begin effect (or its buff's start action) whose prefab loops lasts the skill: no cast stops it [ASSUMED]
  if (role === 'start') { e.hold = e.loop ? 'skill' : null; plan.start.push(e); return null; }
  if (role === 'end') { e.hold = oneShotHold(e); plan.end.push(e); return null; }
  if (role === 'range') { e.hold = e.loop ? 'skill' : null; plan.range.push(e); return null; }
  return 'other';
}

/**
 * The effects of one attack of the owner while the skill is on: the skill prefab's attack ability that fits the attack
 * (a heal → a /Heal/ ability, a ranged shot → /Ranged/, a melee blow → /Melee/; else the first), plus `each`.
 * @param {ReturnType<typeof skillPlan>} plan
 * @param {{ heal?: boolean, ranged?: boolean }} [what]
 * @returns {{ node: string|null, ability: string|null, cast: any[], range: any[], aim: any[], hit: any[][], hitOpts: any, projectile: string|null, shot: any }}
 */
export function attackFx(plan, { heal = false, ranged = false } = {}) {
  const list = plan?.attacks || [];
  const want = heal ? /Heal/ : ranged ? /Ranged/ : /Melee/;
  const a = list.find((x) => want.test(x.ability)) || (heal ? null : list.find((x) => !/Heal/.test(x.ability))) || list[0] || null;
  const each = plan?.each || { cast: [], hit: [[]] };
  const extra = each.hit?.[0] || [];
  const groups = a && a.hit.length ? a.hit.map((g) => [...g, ...extra]) : [extra];
  const hitOpts = a?.hitOpts || { indexed: false, loop: false, random: false, once: false };
  return {
    node: a ? a.node : null, ability: a ? a.ability : null,
    cast: [...(a ? a.cast : []), ...(each.cast || [])], range: a ? a.range : [], aim: a ? a.aim : [],
    hit: hitOpts.indexed ? groups : groups.filter((g) => g.length), hitOpts,
    // index v3: the projectile the ability fires (else skillProjectile's naming guess) and its shots
    projectile: a?.projectile || null, shot: a?.shot || null,
  };
}

/**
 * How long a buff an entry carries lasts (index v3 `life`, DESIGN §33.17 Buff lives): { s } for a LIMITED buff — its
 * `time`, else our record's blackboard value of its `key` (`srec.bb[key]`; an enemy talent's `${bb}.${key}`) —, { skill:
 * true } for INFINITY (while the skill or its carrier lasts), { once: true } for IMMEDIATELY (its effect plays once);
 * null without a life or for a LIMITED one whose time no blackboard gives (the caller keeps its own rule).
 * @param {any} life  a use's life { type, time?, key?, tick? }
 * @param {any} bb    the blackboard to read `key` in (our skill record's bb, an enemy record's talents.bb)
 * @param {string|null} [prefix]  an enemy talent's blackboard prefix (index v3 talents[key].bb)
 */
export function lifeOf(life, bb = null, prefix = null) {
  if (!isObj(life) || typeof life.type !== 'string') return null;
  if (life.type === 'IMMEDIATELY') return { once: true };
  if (life.type === 'INFINITY') return { skill: true };
  if (life.type !== 'LIMITED') return null;
  if (Number(life.time) > 0) return { s: Number(life.time) };
  if (typeof life.key === 'string' && life.key && isObj(bb)) {
    const want = [prefix ? `${prefix}.${life.key}` : null, life.key].filter(Boolean).map((k) => k.toLowerCase());
    for (const w of want) for (const [k, v] of Object.entries(bb)) if (k.toLowerCase() === w && typeof v === 'number' && Number.isFinite(v)) return { s: Math.max(0, v) };
  }
  return null;
}

/**
 * The projectile a ranged attack ability of the skill flies (module header: the only one of the skill's projectiles, else
 * the shortest key named `_s<n>` / `_sk<n>` after the skill's number, else the first) — null without one.
 * @param {any} _idx index.json (unused for now: the plan carries the keys it has)
 * @param {ReturnType<typeof skillPlan>} plan
 */
export function skillProjectile(_idx, plan) {
  const list = Array.isArray(plan?.projectiles) ? plan.projectiles : [];
  if (list.length <= 1) return list[0] || null;
  const n = /_(\d+)$/.exec(plan.skillId || '')?.[1];
  if (n) {
    const re = new RegExp(`_(s|sk)${n}(?![0-9])`);
    const named = list.filter((k) => re.test(k)).sort((a, b) => a.length - b.length);
    if (named.length) return named[0];
  }
  return list[0];
}

/** Attack abilities whose `_activeBuffs` sit on the targets an 'atk' names (targetsOf `hit`). */
const ACTIVE_BUFFS = /^(\w+)\._activeBuffs\b/;

/**
 * The `targets` entries the client can place (module header): `hit` — carried by an attack ability's `_activeBuffs`, on
 * that attack's targets (the 'atk' events name them; a status loop the status wiring draws for the same key takes over);
 * `status` — another carrier, but the key is a generic status loop the status wiring draws when the sim reports it;
 * `none` — no client signal names the carrier.
 * @returns {{ status: any[], hit: any[], none: any[] }}
 */
export function targetsOf(idx, plan) {
  const generic = new Set(Object.values(isObj(idx?.generic?.status) ? idx.generic.status : {}).map(lc).filter(Boolean));
  const out = { status: [], hit: [], none: [] };
  for (const e of plan?.targets || []) {
    const m = ACTIVE_BUFFS.exec(e.from || '');
    if (m && isAttack(m[1])) out.hit.push(e);
    else if (generic.has(e.key)) out.status.push(e);
    else out.none.push(e);
  }
  return out;
}

/** Blackboard keys of a buff's duration in our skill records (the first found wins): `duration`, `…_duration`, `….duration`. */
const DURATION_KEY = /(^|[._])duration$/;

/**
 * A skill's buff duration (s) from our record's blackboard — `duration`, else the first `…_duration` / `….duration` key
 * (not a `max_duration`) — or null [ASSUMED: the buffs a skill's attacks apply last that long].
 */
export function buffDuration(srec) {
  const bb = isObj(srec?.bb) ? srec.bb : null;
  if (!bb) return null;
  const ok = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;
  if (ok(bb.duration)) return bb.duration;
  for (const [k, v] of Object.entries(bb)) if (DURATION_KEY.test(k) && !/max_duration$/.test(k) && ok(v)) return v;
  return null;
}

/**
 * An enemy's skills by its data record's slots (index v2: `units[enemy].skills`, keyed by the lower-case node name —
 * data/enemies.json `skills[].prefabKey`; the sim's ['cast', id, slot] names a slot): [{ slot, prefabKey, skill }] for
 * the slots the index has.
 */
export function enemySkillsOf(idx, unitKey, rec) {
  const unit = unitKey ? idx?.units?.[unitKey] : null;
  const out = [];
  if (!isObj(unit?.skills)) return out;
  (Array.isArray(rec?.skills) ? rec.skills : []).forEach((s, slot) => {
    const key = lc(s?.prefabKey);
    if (key && unit.skills[key]) out.push({ slot, prefabKey: key, skill: unit.skills[key] });
  });
  return out;
}

/**
 * Everything the wiring needs of a battle unit, in one call: its official skill (resolveSkill), our skill record, the
 * plan (with `kind` from the record) and its charge plan; for an enemy its skills' plans by slot (`enemy`: [{ slot,
 * prefabKey, plan }], the Default mode's — SkillFx builds another mode's when the enemy takes it).
 * @param {any} idx index.json
 * @param {{ info?: any, rec?: any, unitKey?: string|null }} unit
 * @returns {{ unitKey: string|null, skillId: string|null, reason: string|null, srec: any, plan: ReturnType<typeof skillPlan>|null, charge: ReturnType<typeof chargePlan>, enemy: Array<{ slot: number, prefabKey: string, plan: ReturnType<typeof skillPlan> }> }}
 */
export function planFor(idx, { info = null, rec = null, unitKey = null } = {}) {
  const res = resolveSkill(idx, { info, rec, unitKey });
  const index = Number.isInteger(info?.diy?.skillIndex) ? info.diy.skillIndex : Number.isInteger(info?.skillIndex) ? info.skillIndex : undefined;
  const srec = skillRecordOf(rec, index);
  const plan = res.skill ? skillPlan(idx, res.unitKey, res.skillId, { rec: srec }) : null;
  const isEnemy = info?.side === 'enemy' || idx?.units?.[res.unitKey]?.kind === 'enemy';
  const enemy = isEnemy ? enemySkillsOf(idx, res.unitKey, rec).map(({ slot, prefabKey }) => ({ slot, prefabKey, plan: skillPlan(idx, res.unitKey, prefabKey) })) : [];
  return { unitKey: res.unitKey, skillId: res.skillId, reason: res.reason, srec, plan, charge: res.unitKey ? chargePlan(idx, res.unitKey) : null, enemy };
}

/** Torappu SharedConsts.Direction: the slot of a facing. */
const DIR_SLOT = Object.freeze({ UP: 0, RIGHT: 1, DOWN: 2, LEFT: 3 });

/**
 * The key a directional row plays for a unit facing `dir` (UnitInfo.dir: 'UP' | 'RIGHT' | 'DOWN' | 'LEFT'): `slots`
 * indexed 0 UP, 1 RIGHT, 2 DOWN, 3 LEFT; an L_OR_R row (directionType 1) takes LEFT or RIGHT, a U_OR_D row (2) UP or
 * DOWN for the other facings [ASSUMED]; a row without slots plays its key.
 */
export function slotKey(entry, dir) {
  const slots = entry?.slots;
  if (!Array.isArray(slots) || !slots.length) return entry?.key ?? null;
  const d = DIR_SLOT[dir] ?? 1;
  let k = slots[d] || null;
  if (!k && entry.directionType === 1) k = slots[dir === 'LEFT' ? 3 : 1] || null;
  if (!k && entry.directionType === 2) k = slots[dir === 'UP' ? 0 : 2] || null;
  return k || slots.find(Boolean) || entry.key;
}

/** Every key a plan can play (slots included) — for preloading. */
export function planKeys(plan) {
  const out = new Set();
  const add = (e) => { if (!e) return; out.add(e.key); for (const s of e.slots || []) if (s) out.add(s); };
  for (const g of ['start', 'loop', 'end', 'ready', 'range', 'trigger', 'targets']) for (const e of plan?.[g] || []) add(e);
  for (const a of plan?.attacks || []) {
    for (const e of [...a.cast, ...a.range, ...(a.aim || [])]) add(e);
    for (const g of a.hit) for (const e of g) add(e);
  }
  for (const e of plan?.each?.cast || []) add(e);
  for (const g of plan?.each?.hit || []) for (const e of g) add(e);
  for (const e of plan?.pulse || []) add(e);
  for (const e of plan?.cond || []) add(e);
  return [...out];
}

// ---- the 秘术师 charge ------------------------------------------------------------------------------------------------

/** Charge slots: one per stored energy — `spell` / `cast` keys and the MountPointType its projectile leaves from. */
const slotsOf = (names, mounts, spell, cast) => names.map((n, i) => ({ spell: spell(n), cast: cast(n), mount: mounts[i] }));

/**
 * The charge emitters of the roster's 秘术师, transcribed from the client's charpacks (26-09-13; module header). Slot k:
 * `spell` = the trait group emitter's _chargeEffectGroups[k] (played at the store's ON_SPELL_ON), `cast` = the store
 * ability's own groups (_chargeEffectGroups / _chargeCastGroups[k], at its ON_CAST_START), `mount` =
 * _mountPointForProjectiles[k] (the ability's, else the FollowMountPoint of the slot's effects); `cap` =
 * _maxChargeTimes; `projectiles` = the store abilities' _projectileKey by mode (a mode without a store ability of its
 * own uses Default [ASSUMED]).
 */
export const CHARGE_EMITTERS = Object.freeze({
  // Trait/ChargableAttackGroup: AbilityChargeableGroup (3) + MultiChargeUberEffectEmitter; ChargeAttack{Default,S1,S2}:
  // ChargeRangedAttack (_mountPointForProjectiles [6, 8, 9, 5]) + MultiChargeUberEffectEmitter (every group:
  // indigo_attack_charge_01_start at ON_CAST_START)
  char_469_indigo: {
    cap: 3,
    slots: slotsOf(['02', '03', '04', '05'], [6, 8, 9, 5], (n) => [`indigo_attack_charge_${n}`], () => ['indigo_attack_charge_01_start']),
    projectiles: { Default: 'projectile_chr_indigo', S1: 'projectile_chr_indigo_s1', S2: 'projectile_chr_indigo_s2' },
  },
  // Trait/ChargeAttackGroup: AbilityExChargeGroup; ExChargeAttack{Default,S1}: ExChargeRangedAttack (3, [5, 6, 8, 9],
  // _exProjectileKey …_elite) + two MultiExChargeUberEffectEmitters (normal: orange; _isExEffectEmitter: the talent's elite
  // energy, red_5 at Special4); ExChargeAttackS3: _forceExCharge, groups red … red_5 (no mounts of its own: the effects')
  char_4046_ebnhlz: {
    cap: 3,
    slots: slotsOf(['', '_2', '_3', '_4'], [5, 6, 8, 9], (n) => [`ebnhlz_attack_charge_orange${n}`, `ebnhlz_attack_buff_orange${n}`], (n) => [`ebnhlz_attack_start_02_orange${n}`]),
    elite: slotsOf(['_5'], [10], (n) => [`ebnhlz_attack_charge_red${n}`, `ebnhlz_attack_buff_red${n}`], (n) => [`ebnhlz_attack_start_02_red${n}`]),
    eliteS3: slotsOf(['', '_2', '_3', '_4', '_5'], [5, 6, 8, 9, 10], (n) => [`ebnhlz_attack_charge_red${n}`, `ebnhlz_attack_buff_red${n}`], (n) => [`ebnhlz_attack_start_02_red${n}`]),
    projectiles: { Default: 'projectile_chr_ebnhlz_charge', S1: 'projectile_chr_ebnhlz_s1_charge', S3: 'projectile_chr_ebnhlz_s3_elite_charge' },
    eliteProjectiles: { Default: 'projectile_chr_ebnhlz_elite', S1: 'projectile_chr_ebnhlz_s1_elite', S3: 'projectile_chr_ebnhlz_s3_elite_charge' },
  },
  // Trait/ChargeableGroup: AbilityChargeableGroup (9) + MergeableChargeUberEffectEmitter (_mergeSize 3: every 3 stored
  // energies merge into one 转置能量 slot — _mergedChargeEffectGroups / _mergedChargeCastGroups); ChargeAttack{Default,S2,S3}:
  // MergeableChargeRangeAttack ([5, 6, 8, 9, 10], _mergeProjectileKey …_merged)
  char_4226_veen: {
    cap: 9,
    slots: slotsOf(['', '_2', '_3', '_4', '_5'], [5, 6, 8, 9, 10], (n) => [`veen_telent_01_rank_01${n}`, `veen_telent_01_rank_01_change${n}`], (n) => [`veen_telent_01_rank_01_change${n}`]),
    merged: slotsOf(['', '_2', '_3', '_4'], [5, 6, 8, 9], (n) => [`veen_telent_01_rank_02${n}`, `veen_telent_01_rank_02_change${n}`], (n) => [`veen_telent_01_rank_02_change${n}`]),
    mergeSize: 3,
    projectiles: { Default: 'projectile_chr_veen', S2: 'projectile_chr_veen_s2', S3: 'projectile_chr_veen_s3' },
    mergedProjectiles: { Default: 'projectile_chr_veen_merged', S2: 'projectile_chr_veen_s2_merged' },
  },
});

/** One slot list of a charge emitter → plan slots, keys checked against the index (absent ones go to `missing`). */
function chargeSlots(list, prefabs, missing) {
  return (list || []).map((s) => {
    const ok = (k) => { if (k && prefabs[k]) return true; if (k) missing.push(k); return false; };
    const spell = s.spell.map(lc).filter(ok), cast = s.cast.map(lc).filter(ok);
    return {
      hold: spell.filter((k) => prefabs[k].looping),     // stays while the energy is stored
      // one-shots of the store (cast start, spell on: one effect named at both plays once — one store moment here)
      gain: [...new Set([...cast, ...spell.filter((k) => !prefabs[k].looping)])],
      mount: mountPointName(s.mount),                     // where its projectile leaves from
      mountType: Number.isInteger(s.mount) ? s.mount : null,   // the same as a MountPointType (render/vfx/mounts.js)
    };
  });
}

/** A charge-emitter description of CHARGE_EMITTERS' shape (an exported one is checked before it is used). */
const isChargeSource = (c) => isObj(c) && Number.isInteger(c.cap) && Array.isArray(c.slots) && c.slots.length > 0
  && c.slots.every((s) => isObj(s) && Array.isArray(s.spell) && Array.isArray(s.cast));

/** The keys of a charge emitter's group k (index v2 rows), by when they play: ON_SPELL_ON (4) → spell, else cast. */
function chargeRows(emitters, field, k, out) {
  for (const em of emitters) {
    for (const row of (Array.isArray(em?.[field]) ? em[field][k] : null) || []) {
      const keys = (Array.isArray(row?.effects) ? row.effects : []).map(lc).filter(Boolean);
      (eventNum(row.startEvent) === 4 ? out.spell : out.cast).push(...keys);
    }
  }
  return out;
}

/** Slots of a list of charge emitters (index v2): group k of `effects` / `casts` → { spell, cast, mount }. */
function chargeSlotsOf(emitters, effects, casts, mounts, prefabs) {
  let n = 0;
  for (const em of emitters) for (const f of [effects, casts]) n = Math.max(n, Array.isArray(em?.[f]) ? em[f].length : 0);
  const out = [];
  for (let k = 0; k < n; k++) {
    const sl = chargeRows(emitters, casts, k, chargeRows(emitters, effects, k, { spell: [], cast: [] }));
    sl.spell = [...new Set(sl.spell)];
    sl.cast = [...new Set(sl.cast)];
    // where its projectile leaves from: the ability's mount, else where the slot's loop follows (index v2 summary)
    const loopKey = sl.spell.find((key) => prefabs[key]?.looping);
    sl.mount = Number.isInteger(mounts?.[k]) ? mounts[k] : (Number.isInteger(prefabs[loopKey]?.follow) ? prefabs[loopKey].follow : null);
    out.push(sl);
  }
  return out;
}

/**
 * Index v2's chargeable groups of a unit (`units[id].charge`: the 秘术师's stored energies, DESIGN §33.12 Charge) in
 * CHARGE_EMITTERS' shape: per energy the group node's and the store ability's emitter groups (`chargeEffectGroups` /
 * `chargeCastGroups`; the normal ones — 黑键's `isExEffectEmitter` emitter gives `elite`, an ability with
 * `forceExCharge` `eliteS3`, 维伊's merged groups `merged`), the mounts of the ability the Default mode releases (its
 * `mountPointForProjectiles`, else the loops' FollowMountPoint), the cap and every ability's projectiles by its modes.
 */
export function chargeFromIndex(groups, prefabs = {}) {
  const g = Array.isArray(groups) ? groups.find((x) => isObj(x) && Array.isArray(x.abilities)) : null;
  if (!g) return null;
  const abil = g.abilities.filter(isObj);
  const ref = abil.find((a) => (a.modes || []).includes('Default')) || abil.find((a) => !a.forceExCharge) || abil[0] || null;
  const ems = (list, ex) => (Array.isArray(list) ? list : []).filter((e) => isObj(e) && !!e.isExEffectEmitter === ex);
  const normal = [...ems(g.emitters, false), ...ems(ref?.emitters, false)];
  const slots = chargeSlotsOf(normal, 'chargeEffectGroups', 'chargeCastGroups', ref?.mountPointForProjectiles, prefabs);
  if (!slots.length) return null;
  const src = {
    cap: Number.isInteger(g.maxChargeTimes) && g.maxChargeTimes > 0 ? g.maxChargeTimes : Number.isInteger(ref?.maxChargeTimes) && ref.maxChargeTimes > 0 ? ref.maxChargeTimes : slots.length,
    slots, projectiles: {},
  };
  const elite = chargeSlotsOf([...ems(g.emitters, true), ...ems(ref?.emitters, true)], 'chargeEffectGroups', 'chargeCastGroups', ref?.exMounts, prefabs);
  if (elite.length) src.elite = elite;
  const forced = abil.find((a) => a.forceExCharge);
  if (forced) {
    const s3 = chargeSlotsOf(ems(forced.emitters, true), 'chargeEffectGroups', 'chargeCastGroups', forced.exMounts, prefabs);
    if (s3.length) src.eliteS3 = s3;
  }
  const merged = chargeSlotsOf(normal, 'mergedChargeEffectGroups', 'mergedChargeCastGroups', ref?.mountPointForProjectiles, prefabs);
  if (merged.length) { src.merged = merged; src.mergeSize = Number.isInteger(ref?.mergeSize) ? ref.mergeSize : null; }
  for (const a of abil) {
    for (const m of Array.isArray(a.modes) ? a.modes : []) {
      if (lc(a.projectileKey)) src.projectiles[m] = lc(a.projectileKey);
      if (lc(a.exProjectileKey)) (src.eliteProjectiles || (src.eliteProjectiles = {}))[m] = lc(a.exProjectileKey);
      if (lc(a.mergeProjectileKey)) (src.mergedProjectiles || (src.mergedProjectiles = {}))[m] = lc(a.mergeProjectileKey);
    }
  }
  return src;
}

/**
 * The charge emitters of a unit: index v2's chargeable groups (`units[id].charge`, chargeFromIndex), else an export in
 * CHARGE_EMITTERS' shape, else — a version-1 index — the transcribed table; null for a unit without one.
 */
export function chargeSource(idx, unitKey) {
  const own = idx?.units?.[unitKey]?.charge;
  if (Array.isArray(own)) { const v2 = chargeFromIndex(own, isObj(idx.prefabs) ? idx.prefabs : {}); if (v2) return v2; }
  if (isChargeSource(own)) return own;
  return CHARGE_EMITTERS[unitKey] || null;
}

/**
 * A 秘术师's stored-energy plan, or null for a unit without a charge emitter (chargeSource) or one index.json lacks.
 * byCount[n]: the loops lit with n stored (cumulative: slots 1…n); onGain[n]: the one-shots of the n-th store; onRelease:
 * the loops stop and n projectiles leave from `mounts[0…n−1]` (the mode's `projectiles` key). `elite` / `eliteS3` /
 * `merged`: 黑键's and 维伊's other stores (no client signal drives them — header).
 */
export function chargePlan(idx, unitKey) {
  if (!isObj(idx?.units?.[unitKey])) return null;
  const src = chargeSource(idx, unitKey);
  if (!src) return null;
  const prefabs = isObj(idx.prefabs) ? idx.prefabs : {};
  const missing = [];
  const slots = chargeSlots(src.slots, prefabs, missing);
  // projectile keys by mode, lower case (an exported source may keep the client's case)
  const byMode = (set) => Object.fromEntries(Object.entries(isObj(set) ? set : {}).map(([m, k]) => [m, lc(k)]).filter(([, k]) => k));
  const plan = {
    unitKey, cap: src.cap, slots, byCount: {}, onGain: {},
    onRelease: { stop: 'hold', mounts: slots.map((s) => s.mount), mountTypes: slots.map((s) => s.mountType), projectiles: byMode(src.projectiles) },
    elite: src.elite ? chargeSlots(src.elite, prefabs, missing) : null,
    eliteS3: src.eliteS3 ? chargeSlots(src.eliteS3, prefabs, missing) : null,
    merged: src.merged ? chargeSlots(src.merged, prefabs, missing) : null,
    mergeSize: src.mergeSize ?? null,
    missing: [...new Set(missing)],
  };
  if (src.eliteProjectiles) plan.onRelease.eliteProjectiles = byMode(src.eliteProjectiles);
  if (src.mergedProjectiles) plan.onRelease.mergedProjectiles = byMode(src.mergedProjectiles);
  const projs = isObj(idx.projectiles) ? idx.projectiles : {};
  for (const set of [plan.onRelease.projectiles, plan.onRelease.eliteProjectiles, plan.onRelease.mergedProjectiles]) {
    for (const k of Object.values(set || {})) if (!projs[k] && !plan.missing.includes(k)) plan.missing.push(k);
  }
  for (let n = 1; n <= slots.length; n++) {
    plan.byCount[n] = slots.slice(0, n).flatMap((s) => s.hold);
    plan.onGain[n] = slots[n - 1].gain.slice();
  }
  return plan;
}

/**
 * What changes when the stored count goes `prev` → `next` (both clamped to the plan's slots): `gain` one-shots to play
 * (the stores in order), `light` / `dim` the slot indexes (0-based) whose loops start / stop, `released` the energies
 * that left (a drop — a release with an attack, or a reset on redeploy).
 * @returns {{ gain: string[], light: number[], dim: number[], released: number }}
 */
export function chargeStep(plan, prev, next, slots = plan?.slots) {
  const n = Array.isArray(slots) ? slots.length : 0;
  const a = Math.max(0, Math.min(n, Math.floor(Number(prev) || 0)));
  const b = Math.max(0, Math.min(n, Math.floor(Number(next) || 0)));
  const out = { gain: [], light: [], dim: [], released: 0 };
  for (let i = a; i < b; i++) { out.gain.push(...slots[i].gain); out.light.push(i); }
  for (let i = b; i < a; i++) out.dim.push(i);
  out.released = Math.max(0, a - b);
  return out;
}

/** Every key of a charge plan (preloading). */
export function chargeKeys(plan) {
  const out = new Set();
  for (const list of [plan?.slots, plan?.elite, plan?.eliteS3, plan?.merged]) {
    for (const s of list || []) for (const k of [...s.hold, ...s.gain]) out.add(k);
  }
  return [...out];
}

// ---- kit 'fx' tuples bound to official effects (Phase 3b) ---------------------------------------------------------------

/**
 * Kit 'fx' tuples (b.ev ['fx', kind, x, y, extra] of server/sim/content/kits) that stand for an official effect of a skill
 * which no plan row places, by skill id → fx kind. render/vfx/skillfx.js plays the binding and the field view skips the
 * procedural fx (it is drawn when none of the binding's prefabs is installed). A binding:
 *   owner       the extra field naming the skill's owner ('id' | 'src'), or 'skill': the fx names no owner (焰影苇草's
 *               fire strikes from its carrier) — the unit whose skill of that id lasts
 *   projectile  the skill projectile whose reached effects (onReached, else onHit) play where the fx happens
 *   keys        else these prefabs (an official effect our projectile records do not list as reached: a projectile's
 *               main effect, a skill row the kit's moment stands for; a one-shot of the skill's own: its `at` 'target')
 *   at          'point': the fx's (x, y) on the ground (the unit `extra.id` names stands there: its feet); 'target': once
 *               on the unit the fx names in `extra[target]` (`target`, default 'target'; else at the fx's point), turned
 *               by the owner's side (FLIP_TWO_SIDE) — such a key is no row of the skill on its owner (targetBound: the
 *               client creates it on the ability's target, the index writes it as a start row); else on the view
 *               `extra.id` names (the fx's point without one)
 *   hold        how long a looping reached effect stays: a blackboard key of our skill record (seconds), 'fx' — the
 *               fx's own `duration` / `dur` / `hold` (the kit's area or lock time) —, else `holdS`
 *   cover       fx kinds of the same owner at that tile that the reached effect draws (skipped while it plays)
 *   during      only while the skill lasts (SkillFx._lasts: on, its activation frame, COVER_AFTER_S after its end, or a
 *               binding of its owner still held — a lasting area's strikes); another fx of that kind is the kit's own
 * or, instead of a projectile (history §32.14.43):
 *   attack      the node of the plan attack the fx stands for: its cast / range rows play on the owner at the fx, its hit
 *               groups and aims on the damage the fx's frame deals after it (SkillFx kit hits)
 * The R11 entries (0.3.0 official-effects audit, history §32.14.44) bind a kit area or strike to the official prefab
 * the client plays there: the areas are the skill projectiles' reached effects (the projectile stays where it lands —
 * AuraHitBehaviour — for the area's life), the strikes their hit effects.
 */
const binding = (o) => Object.freeze({ ...o, ...(o.cover ? { cover: Object.freeze(o.cover) } : {}), ...(o.keys ? { keys: Object.freeze(o.keys) } : {}) });
export const FX_BINDINGS = Object.freeze({
  // Existing kit event supplies the elimination position (no invented projectile collision or ally trigger).
  skchr_yu_3: Object.freeze({ firewallBlock: binding({ owner: 'id', at: 'point', oneshot: true, keys: ['yu_skill3_annex_01'] }) }),
  // 克莱门莎 S3 (op-clemnt.js bombard): the kit marks an enemy's tile ('lock': id = the enemy, src = her) and strikes it
  // three times ('blast', id = her, 0.5 / 1.5 / 2.5 s later). The client fires projectile_chr_clemnt_s3 at the marked
  // enemy (AttachToTarget, _immediatelyReach), whose reached effect clemnt_skill_03_mark_all_01 is the mark and its three
  // strikes (clips Mark_01_start 4.13 s and three Mark_trail_01), cleared when the projectile stops
  // (_clearReachedEffectWhenStop; its life time from the blackboard: projectile_life_time — the kit's tile lock)
  skchr_clemnt_3: Object.freeze({
    lock: binding({ owner: 'src', projectile: 'projectile_chr_clemnt_s3', at: 'point', hold: 'projectile_life_time', holdS: 5, cover: ['blast'] }),
  }),
  // 锡人 S1 / S2 (chess_char_2_19-tinman.js: the 'zone' on the struck tile, id = him, dur = the area's time): the client's
  // flask (projectile_chr_tinman_s1 / _s2) lands there — its reached effects are the ring (tinman_skill_0N_range_01,
  // looping), the flask on the ground (_token_01, looping) and the splash (_start_01 / _02)
  skchr_tinman_1: Object.freeze({ zone: binding({ owner: 'id', projectile: 'projectile_chr_tinman_s1', at: 'point', hold: 'fx', holdS: 8, during: true, cover: ['zone'] }) }),
  skchr_tinman_2: Object.freeze({ zone: binding({ owner: 'id', projectile: 'projectile_chr_tinman_s2', at: 'point', hold: 'fx', holdS: 8, during: true, cover: ['zone'] }) }),
  // 引星棘刺 S1 / S3 (chess_char_5_15-thorn2.js: a 'zone' on each chosen ally's tile, id = her, duration): the unit she
  // throws (projectile_chr_thorn2_s1 / _s3) lands there — thorn2_token_start, the unit (thorn2_skill_0N_token, looping),
  // S1's ring (thorn2_skill_01_range). S2's unit drifts (its zone re-sent every second): not bound — the procedural area
  // stays (open)
  skchr_thorn2_1: Object.freeze({ zone: binding({ owner: 'id', projectile: 'projectile_chr_thorn2_s1', at: 'point', hold: 'fx', holdS: 6, during: true, cover: ['zone'] }) }),
  skchr_thorn2_3: Object.freeze({ zone: binding({ owner: 'id', projectile: 'projectile_chr_thorn2_s3', at: 'point', hold: 'fx', holdS: 19, during: true, cover: ['zone'] }) }),
  // 波登可 S2 ('zone' of her spores, id = her, dur): projectile_chr_podego_s2's reached podego_skill_02_range
  skchr_podego_2: Object.freeze({ zone: binding({ owner: 'id', projectile: 'projectile_chr_podego_s2', at: 'point', hold: 'fx', holdS: 5, during: true, cover: ['zone'] }) }),
  // 歌蕾蒂娅 S3 ('tornado', id = her, duration): projectile_chr_glady_s3_2's reached glady_skill_03_range / _02
  skchr_glady_3: Object.freeze({ tornado: binding({ owner: 'id', projectile: 'projectile_chr_glady_s3_2', at: 'point', hold: 'fx', holdS: 10, during: true, cover: ['tornado'] }) }),
  // 异客 S3 ('storm', id = him, duration): projectile_chr_pasngr_s3's reached pasngr_skill_03_range; the storm's strikes
  // ('lightning': id = the enemy, src = him) — its _specialHitEffect pasngr_skill_03_hit on that enemy
  skchr_pasngr_3: Object.freeze({
    storm: binding({ owner: 'id', projectile: 'projectile_chr_pasngr_s3', at: 'point', hold: 'fx', holdS: 10, during: true, cover: ['storm'] }),
    lightning: binding({ owner: 'src', keys: ['pasngr_skill_03_hit'], holdS: 2, during: true }),
  }),
  // 溯光星源 S2 (chess_char_6_16-halo2.js: a 'link' from her target to each enemy it pulls, id = her, ids = the pair, at
  // the pulled one): projectile_chr_halo2_s2_link's hit halo2_skill_02_hit_02 there
  skchr_halo2_2: Object.freeze({ link: binding({ owner: 'id', projectile: 'projectile_chr_halo2_s2_link', at: 'point', holdS: 2, during: true }) }),
  // 焰影苇草 S2 (a 'strike' from a fireball's carrier every cooldown: id = the enemy, src = the carrier): the fireball
  // projectile_chr_reed2_fire's hit reed2_skill_02_hit on the enemy
  skchr_reed2_2: Object.freeze({ strike: binding({ owner: 'skill', projectile: 'projectile_chr_reed2_fire', holdS: 2, during: true }) }),
  // 蕾缪安 S3: a 'lock' (id = the enemy, src = her, hold) is the aim projectile on it (projectile_chr_lemuen_s3_aim: its
  // main lemuen_skill_03_crosshair_range and lemuen_skill_03_crosshair_02), held for the lock [ASSUMED 1.5 s without
  // one]; a 'bombard' (id = her, its point) is projectile_chr_lemuen_s3_attack's reached lemuen_skill_03_hit_01. The
  // falling shell ('bombardShell': the attack projectile's flight, not flown here) stays procedural
  skchr_lemuen_3: Object.freeze({
    lock: binding({ owner: 'src', keys: ['lemuen_skill_03_crosshair_range', 'lemuen_skill_03_crosshair_02'], hold: 'fx', holdS: 1.5, during: true }),
    bombard: binding({ owner: 'id', projectile: 'projectile_chr_lemuen_s3_attack', at: 'point', holdS: 2, during: true }),
  }),
  // 泡泡 S2 (chess_char_2_08-bubble.js): she makes no attack; every damage instance she takes strikes back at its source
  // ('counter': id = her, target = the attacker). The client's bubble_s_2 does it at ON_TAKE_DAMAGE — DamageViaAttr and
  // CreateEffect on MODIFIER_SOURCE with the blackboard's `effect` bubble_skill_02_hit (index.json's use 'hit' by name,
  // planned as each.hit, which no attack of hers ever plays)
  skchr_bubble_2: Object.freeze({
    counter: binding({ owner: 'id', keys: ['bubble_skill_02_hit'], at: 'target' }),
  }),
  // 归溟幽灵鲨 S1 (chess_char_5_13-ghost2.js: 'hpShare' as she swaps HP ratios with an ally, id = her, to = the ally,
  // at the ally): the skill's ExchangeHp ability (AnimatedActionToTargetAbility, [uc]skills.ab skchr_ghost2_1) runs
  // ExchangeHpRatio, CreateEffect ghost2_skill_01_start on SOURCE and CreateEffect ghost2_skill_01_hit on TARGET — the
  // hit plays on the ally, not on her (0.3.1, audit R20: index v3 writes both action effects as start rows without
  // their target, so the plan put the hit on her too; a key bound `at: 'target'` is no owner row — targetBound)
  skchr_ghost2_1: Object.freeze({
    hpShare: binding({ owner: 'id', keys: ['ghost2_skill_01_hit'], at: 'target', target: 'to' }),
  }),
  // 锏 S3 (op-blkkgt.js): each slash of the kit ('slash', id = her, every 0.3 s while the skill lasts) is the skill's
  // Damage ability (MultiMeleeAttack: blkkgt_skill_03_start_01 / _02 on her); the finale is its EndAttack (`when: 'end'`)
  skchr_blkkgt_3: Object.freeze({
    slash: binding({ owner: 'id', attack: 'Damage' }),
  }),
  // 号角 S1 (chess_char_5_08-horn.js: the flare's 'zone' where her S1 shot lands, id = her, r = projectile_range, duration =
  // projectile_delay_time): the skill's RangedAttackGroup (AbilityParallelGroup) fires the shell projectile_chr_horn_s1 —
  // the shot the wiring flies — and RangedAttack_Light's projectile_chr_horn_s1_light, whose reached effects are the flare
  // (horn_skill_01_hit_02_buff, looping, and horn_skill_01_hit_02) at the landing point (0.3.1, lingering areas)
  skchr_horn_1: Object.freeze({ zone: binding({ owner: 'id', projectile: 'projectile_chr_horn_s1_light', at: 'point', hold: 'fx', holdS: 6, cover: ['zone'] }) }),
  // 琴柳 S2 (a 自选 pick; op-sleach.js: the flag's 'zone' on the ally's tile it is planted on, id = her, dur = the skill's
  // duration): the skill's FlagBuff (RangedAttack) puts projectile_chr_sleach_s2 there — AttachToTarget, AuraHitBehaviour —:
  // its flying effect is the flag (sleach_skill_02_flag_01) and its reached effect the ground (sleach_skill_02_ground_01),
  // both looping for its life (0.3.1)
  skchr_sleach_2: Object.freeze({ zone: binding({ owner: 'id', keys: ['sleach_skill_02_flag_01', 'sleach_skill_02_ground_01'], at: 'point', hold: 'fx', holdS: 15, during: true, cover: ['zone'] }) }),
  // 琴柳 S3 (the thrown flag's 'zone' on its tile, id = her, dur; its strike 'aoe' there FLAG_FLIGHT s later): the skill's
  // DamageFlag group (AbilityParallelGroup of ProjectileToTileAbility) puts Debuff's projectile_chr_sleach_s3 on the tile —
  // the flag sleach_skill_03_flag_01 and, on the tile as it starts, sleach_skill_03_range_loop_01 / _02 (looping) — and
  // Damage's projectile_chr_sleach_s3_2, whose sleach_skill_03_range_start_01 / _02 (one-shots) are the strike
  skchr_sleach_3: Object.freeze({
    zone: binding({ owner: 'id', keys: ['sleach_skill_03_flag_01', 'sleach_skill_03_range_loop_01', 'sleach_skill_03_range_loop_02'], at: 'point', hold: 'fx', holdS: 10, during: true, cover: ['zone'] }),
    aoe: binding({ owner: 'id', keys: ['sleach_skill_03_range_start_01', 'sleach_skill_03_range_start_02'], at: 'point', holdS: 7.5, during: true }),
  }),
});

/**
 * The prefabs a binding plays: its `keys`, else its projectile's reached effects (onReached, else onHit) — or the
 * projectile field its `part` names (`toTargetOnStart`: a projectile that plays its area on its target as it starts,
 * 萨卡兹枯朽战士's) —, lower case; [] without them.
 */
export function bindingEffects(idx, bind) {
  if (Array.isArray(bind?.keys)) return bind.keys.map(lc).filter(Boolean);
  const p = bind?.projectile ? idx?.projectiles?.[lc(bind.projectile)] : null;
  if (!p) return [];
  const list = bind.part ? (Array.isArray(p[bind.part]) ? p[bind.part] : [])
    : Array.isArray(p.onReached) && p.onReached.length ? p.onReached : Array.isArray(p.onHit) ? p.onHit : [];
  return list.map(lc).filter(Boolean);
}

/**
 * The keys a skill's bindings play on the unit their fx names (`at: 'target'` with `keys`, lower case): the client
 * creates them on the ability's target, so they are no rows on the owner (skillPlan drops them from its start, loop,
 * range and end rows).
 */
export function targetBound(skillId) {
  const out = new Set();
  for (const bind of Object.values(FX_BINDINGS[lc(skillId)] || {})) {
    if (bind.at === 'target' && Array.isArray(bind.keys)) for (const k of bind.keys) if (lc(k)) out.add(lc(k));
  }
  return out;
}

/** The fx kinds whose binding names no owner ('skill'), by kind → the skill ids that bind it. */
export const BOUND_BY_SKILL = Object.freeze((() => {
  const out = {};
  for (const [sid, kinds] of Object.entries(FX_BINDINGS)) for (const [kind, b] of Object.entries(kinds)) if (b.owner === 'skill') (out[kind] ||= []).push(sid);
  return out;
})());

/**
 * Kit 'fx' kinds a skill's official effects stand for although no official effect is placed at the fx (render/vfx/
 * skillfx.js rule 5: with 官方特效 on and the skill's plan drawable, the procedural fx is skipped while the skill lasts —
 * the client shows the skill's own effects then, and no such cue). By skill id; decided per case from the client data
 * (0.3.0 official-effects audit R11, history §32.14.44). Areas, locks and links stay procedural where the client shows
 * such a cue that is not placed here (引星棘刺 S2's drifting unit, 新约能天使's strikes, 扎罗's
 * fear cage on its targets — open), and so do the cues of a talent (刺玫's and 雪猎's) or 泡泡 S2's counter (R17).
 */
export const FX_COVER = Object.freeze({
  skchr_yu_3: Object.freeze(['firewall']), // YuS3EffectBehaviour's per-grid wall, held for the skill
  // 莫斯提马 S2: the zone at her feet — the skill's range rows (mostma_skill_02_range / _range_02) and loop show it
  skchr_mostma_2: Object.freeze(['zone']),
  // 白面鸮 S2: the heal field at her — the client shows the skill's loop on her (plosis_attack_01_start), no area
  skchr_plosis_2: Object.freeze(['healField']),
  // 流明 S1: the heal field on his patient — the skill's buff on its target (lumen_skill_01_range) plays there with the heal
  skchr_lumen_1: Object.freeze(['healField']),
  // 凛御银灰 S2: the blast in front of her — her skill attack's own cast / range / hit (svash2_skill_02_*_01)
  skchr_svash2_2: Object.freeze(['aoe']),
  // 远牙 S2, 溯光星源 S3: the link at the cast — the skills' loops (fartth_skill_02_buff; halo2_skill_03_buff_01 / _03)
  skchr_fartth_2: Object.freeze(['link']),
  skchr_halo2_3: Object.freeze(['link']),
  // 空弦 S1 / S2, 流星 S2, 雪猎 S2: the volley — the skills' casts, projectiles and hits
  skchr_archet_1: Object.freeze(['volley']),
  skchr_archet_2: Object.freeze(['volley']),
  skchr_shotst_2: Object.freeze(['volley']),
  skchr_snhunt_2: Object.freeze(['volley']),
  // 信仰搅拌机 S3: a counter is an attack of hers (its official casts and hits) under the skill's loops
  skchr_rmixer_3: Object.freeze(['counter']),
  // 歌蕾蒂娅 S3: the tornado's pulls — the tornado itself is bound (FX_BINDINGS)
  skchr_glady_3: Object.freeze(['tornadoPulse']),
  // 伺夜 S1 (a wolf more: the 'summon' on her wolf, src = her), 迷迭香 S3 (the 'summon' at her): the skills' start rows
  // (vigil_skill_01_start_01–03; rosmon_skill_03_start) — a summon born in that frame is covered by its own birth
  skchr_vigil_1: Object.freeze(['summon']),
  skchr_rosmon_3: Object.freeze(['summon']),
  // 卡涅利安 S2: the chains — her skill's loops, once they are drawable (audit R6: her conditional buffs)
  skchr_billro_2: Object.freeze(['sandChains', 'sandChainsCharged']),
  // 浊心斯卡蒂 S3: the tide at the cast — the skill's Aura `_effects` loop on her while it lasts (skadi2_skill_03_buff on the
  // ground, _02 / _03 on her) and its start (skadi2_skill_03_begin_start) (0.3.1, lingering areas)
  skchr_skadi2_3: Object.freeze(['tide']),
  // 银灰 S2: the snow at the switch — the skill's own loop (svrash_skill_02_buff) on him, no area (0.3.1)
  skchr_svrash_2: Object.freeze(['snow']),
  // 珊比 S3 (a 自选 pick): the conveyor's zone — the skill's range loop on her (thumpy_skill_03_range_01, its template
  // thumpy[skill_3_buff] at ON_BUFF_START; _end at its finish) shows the belt (0.3.1)
  skchr_thumpy_3: Object.freeze(['zone']),
  // 假日威龙陈 S2 / S3 (a 自选 pick): the slime zone — every attack of the skill's mode puts its projectile on the target
  // (projectile_chr_chen2_s2 / _s3: AttachToTarget, AutoLoadBoxRange), whose reached chen2_skill_02 / 03_range_01 is the
  // slime there; the client shows no area at her (0.3.1)
  skchr_chen2_2: Object.freeze(['zone']),
  skchr_chen2_3: Object.freeze(['zone']),
});

/** Whether a skill's official effects stand for a kit fx kind (FX_COVER). */
export function coverOf(skillId, kind) {
  const list = skillId ? FX_COVER[lc(skillId)] : null;
  return !!list && list.includes(kind);
}

/** Every key a skill's bindings can play (preloading). */
export function bindingKeys(idx, skillId) {
  const out = new Set();
  for (const bind of Object.values(FX_BINDINGS[lc(skillId)] || {})) for (const k of bindingEffects(idx, bind)) out.add(k);
  return [...out];
}

// ---- enemies' kit 'fx' tuples bound to official effects (0.3.1: lingering areas) -------------------------------------

/** Tiles from a kit fx's point within which its owner stands (an enemy's death zone, an aura's tick at its feet). */
export const OWNER_NEAR = 1;

/**
 * Kit 'fx' tuples of an enemy (server/sim/content/enemies) that stand for an official effect of its own the client plays
 * there — its areas that keep acting (0.3.1, the maintainer's report of 2026-10-16: 萨卡兹枯朽战士's 污染秽蚀) —, by the
 * enemy's index unit key → fx kind → binding. render/vfx/skillfx.js plays them (SkillFx.simFx → _enemyFx) and the field
 * view skips the procedural fx; with 官方特效 off, or none of a binding's prefabs installed, the procedural fx stays. A
 * zone names no source (content/enemies/helpers.js zone) except 【污染秽蚀】, whose fx carries `pollution`'s src. A binding
 * says how its fx finds the enemy:
 *   xkind      the fx's `extra.kind` (the sim's zone kind: 'pollution', 'poison', 'barrel', 'sandStorm', 'boil')
 *   owner      'id' — `extra.id` names it; 'died' — an enemy of this key that died in the fx's frame within OWNER_NEAR
 *              tiles of its point (a death zone: the sim makes it in the death hook, right after the 'die' event); 'cast'
 *              — an enemy of this key whose skill `skill` (its data record's prefabKey) was cast in the fx's frame (the
 *              sim's castSlot comes in the same tick); 'near' — a standing enemy of this key within OWNER_NEAR tiles of the
 *              point (an fx at its feet that names no one); 'any' — the kind is this enemy's alone (假想敌：蚀裂's cloud lands
 *              on its killer after its death: no id, no frame of its own). A zone whose `extra.id` is that unit (【污染秽蚀】
 *              carries `pollution`'s src) matches as 'id' even when the field says 'cast'. SkillFx tries a 'died' owner
 *              within OWNER_NEAR before a cast the zone does not name, and a binding that draws nothing does not claim it.
 *   projectile / part / keys    the prefabs (bindingEffects; `part`: the projectile field to read)
 *   hold / holdS               how long the looping ones stay at the fx's point: 'fx' — the fx's `dur` (the zone's time) —,
 *              else `holdS`; `once`: the prefabs play once there, for their own life (a one-shot)
 *   talent     instead of prefabs: the talent (prefab key) whose aura the fx is a tick of — while the unit's talent loops
 *              (render/vfx/talentfx.js) are drawn they stand for it, and one unclaimed HP hit in that frame on a unit
 *              inside the sim radius plays the aura's buff effects on it, offered to each aura (auraTargets)
 *   modeLoops  or: the fx starts a mode of the unit whose talent (this prefab key) loops on it meanwhile — its loop uses
 *              (a buff it creates at its tick: a condition talents.js cannot read, here the mode's own) — for its record's
 *              blackboard value `bbKey` (talents.bb), else `holdS` s; `endMode`: the fx ends it early
 */
const ebind = (o) => Object.freeze({ ...o, ...(o.keys ? { keys: Object.freeze(o.keys) } : {}) });
const POLLUTED_DIE = Object.freeze({
  // the client's PollutedDie talent (Talent/BslimeTalent_1) fires projectile_enemy_nhpbr_polluted where the unit falls: an
  // EffectBehaviour that plays enemy_nhpbr_attack_range on its target as it starts (_effectsToTargetWhenStart, looping)
  // and clears it as it stops (_clearPlayEffectOnStop), its life from the blackboard (projectile_life_time)
  zone: ebind({ xkind: 'pollution', owner: 'died', projectile: 'projectile_enemy_nhpbr_polluted', part: 'toTargetOnStart', hold: 'fx', holdS: 8 }),
});
const POLLUTED_ATK = Object.freeze({
  // the skill PollutedRangedAtk (AbilityParallelGroup) fires the shell projectile_enemy_nhtank and AttackPolluted's
  // projectile_enemy_nhtank_polluted, whose reached effect enemy_nhtank_attack_range (looping) is the pool, cleared when
  // it stops (its life from the blackboard: projectile_life_time)
  zone: ebind({ xkind: 'pollution', owner: 'cast', skill: 'pollutedrangedatk', projectile: 'projectile_enemy_nhtank_polluted', hold: 'fx', holdS: 10 }),
});
const NEST_AURA = Object.freeze({
  // the AOE talent (AppearSyncedTalent / AuraAbility): its `_effects` loop while the unit stands (talentfx.js), and the
  // aura's buff enemy_dsubrl_aoe[aura] plays enemy_dsubrl_attack_hit on every unit in it at each tick (ON_BUFF_TRIGGER)
  pulse: ebind({ owner: 'id', talent: 'AOE' }),
});
export const ENEMY_FX_BINDINGS = Object.freeze({
  // 萨卡兹枯朽战士 / 组长 (content/enemies/archetypes.js kitPolluted: the 'zone' of kind 'pollution' where it fell — r =
  // PollutedDie.projectile_range, dur = PollutedDie.projectile_life_time —, after its 'die')
  enemy_1267_nhpbr: POLLUTED_DIE,
  enemy_1267_nhpbr_2: POLLUTED_DIE,
  // 萨卡兹枯朽战车 / 尖端 (content/enemies/dot.js kitTank: 秽蚀轰击's 'zone' of kind 'pollution' at its target, r 1.7, dur =
  // projectile_life_time, in the tick of its 'cast')
  enemy_1272_nhtank: POLLUTED_ATK,
  enemy_1272_nhtank_2: POLLUTED_ATK,
  // 假想敌：蚀裂 (dot.js: the 'zone' of kind 'poison' where its lob lands — on its killer — or where it fell, r =
  // 1.projectile_range, dur = 1.projectile_life_time): its talent 1 (BslimeTalent_1) fires projectile_enemy_actoxi at its
  // killer, whose reached effect enemy_actoxi_idle (looping) is the cloud
  enemy_9006_actoxi: Object.freeze({ zone: ebind({ xkind: 'poison', owner: 'any', projectile: 'projectile_enemy_actoxi', hold: 'fx', holdS: 8 }) }),
  // 咸鳞汁推荐者 (special.js: its barrel blow's 'zone' of kind 'barrel' where it stands, dur = fixed_duration, in the tick of
  // its 'cast'): the skill BlockedBoom (ProjectileToTileAbility) puts projectile_enemy_wintun_range on its tile —
  // AuraHitBehaviour, its reached effect enemy_wintun_range (looping) the zone
  enemy_10044_wintun: Object.freeze({ zone: ebind({ xkind: 'barrel', owner: 'cast', skill: 'blockedboom', projectile: 'projectile_enemy_wintun_range', hold: 'fx', holdS: 30 }) }),
  // 鼠王 (leaders.js: 【沙狱】's 'zone' of kind 'sandStorm' on its target, id = it, dur): its skill SandStorm's emitter plays
  // mousek_skill_02_range on that target as it casts (_castTargetEffects) — the sandstorm itself, a one-shot of 21 s
  // (its root's FxDelay 0.7 s); the 沙狱's hits are projectile_mousek_s2 attached to the target (no flying effect)
  enemy_1509_mousek: Object.freeze({ zone: ebind({ xkind: 'sandStorm', owner: 'id', keys: ['mousek_skill_02_range'], once: true }) }),
  // 深溟巢涌者 / 富营养的巢涌者 (dot.js kitDsubrl: a 'pulse' each second it hurts, id = it, r = its range)
  enemy_1234_dsubrl: NEST_AURA,
  enemy_1234_dsubrl_2: NEST_AURA,
  // 鼎沸 (dot.js: an 'explode' of kind 'boil' every attack interval at its feet, r = its range, no id): its aoe talent
  // (AppearSyncedTalent / AuraAbility) — its `_effects` loop while it stands, and the units in it carry enemy_cjhot_debuff
  // (its buff enemy_cjhot_t[aoe], INFINITY, tick 1)
  enemy_10054_cjhot: Object.freeze({ explode: ebind({ xkind: 'boil', owner: 'near', talent: 'aoe' }) }),
  // 水遁忍者 (special.js: its 漩涡形态 — a 'telegraph' of kind 'spin' as it starts, id = it; then damage every
  // RotateDamage.interval s around it for EndRotate.rotate_duration s, ended early by 失衡's 'phase' of kind 'spinStop'):
  // the client's SwitchModeTrigger puts it in its mode M1 (RotateAttack), whose RotateEffect talent's buff
  // (ymgtop_m1_t[rotate_effect], created every 0.1 s) is enemy_ymgtop_skill_01_buff_01 at its feet while it spins
  enemy_10116_ymgtop: Object.freeze({
    telegraph: ebind({ xkind: 'spin', owner: 'id', modeLoops: 'RotateEffect', bbKey: 'EndRotate.rotate_duration', holdS: 60 }),
    phase: ebind({ xkind: 'spinStop', owner: 'id', endMode: true }),
  }),
});

/**
 * The enemy unit keys with a binding of each fx kind (SkillFx._enemyFx's candidates). The list order is an id, a cast,
 * a death, a unit at the point, the kind alone; the fx itself is ranked again — the unit `extra.id` names, then a death
 * within OWNER_NEAR, then a cast the zone does not name (skillfx.js _fxRank).
 */
const OWNER_ORDER = Object.freeze({ id: 0, cast: 1, died: 2, near: 3, any: 4 });
export const ENEMY_FX_KINDS = Object.freeze((() => {
  const out = {};
  for (const [key, kinds] of Object.entries(ENEMY_FX_BINDINGS)) for (const kind of Object.keys(kinds)) (out[kind] ||= []).push(key);
  for (const [kind, keys] of Object.entries(out)) out[kind] = Object.freeze(keys.sort((a, b) => (OWNER_ORDER[ENEMY_FX_BINDINGS[a][kind].owner] ?? 9) - (OWNER_ORDER[ENEMY_FX_BINDINGS[b][kind].owner] ?? 9)));
  return out;
})());

/**
 * The effects an aura talent's buff plays on the units in it (its uses `on: 'targets'`, lower case): `shots` once per tick
 * (a 'trigger' / 'hit' use — an action at ON_BUFF_TRIGGER), `loops` while the unit stays in it (a looping buff effect).
 */
export function auraTargets(idx, unitKey, talent) {
  const t = idx?.units?.[unitKey]?.talents?.[talent];
  const shots = new Set(), loops = new Set();
  for (const u of Array.isArray(t?.uses) ? t.uses : []) {
    if (!isObj(u) || u.on !== 'targets') continue;
    for (const k of Array.isArray(u.keys) ? u.keys : []) {
      const key = lc(k);
      if (!key) continue;
      if (u.role === 'loop' && idx.prefabs?.[key]?.looping !== false) loops.add(key);
      else shots.add(key);
    }
  }
  return { shots: [...shots], loops: [...loops] };
}

/** Every key an enemy's kit-fx bindings can play (preloading). */
export function enemyBindingKeys(idx, unitKey) {
  const out = new Set();
  for (const bind of Object.values(ENEMY_FX_BINDINGS[unitKey] || {})) {
    if (bind.talent) { const a = auraTargets(idx, unitKey, bind.talent); for (const k of [...a.shots, ...a.loops]) out.add(k); }
    else if (bind.modeLoops) for (const k of modeLoopKeys(idx, unitKey, bind.modeLoops)) out.add(k);
    else for (const k of bindingEffects(idx, bind)) out.add(k);
  }
  return [...out];
}

/** The loop effects of a unit's talent (its uses with role 'loop', lower case): a binding's `modeLoops`. */
export function modeLoopKeys(idx, unitKey, talent) {
  const t = idx?.units?.[unitKey]?.talents?.[talent];
  const out = new Set();
  for (const u of Array.isArray(t?.uses) ? t.uses : []) if (isObj(u) && u.role === 'loop') for (const k of Array.isArray(u.keys) ? u.keys : []) if (lc(k)) out.add(lc(k));
  return [...out];
}
