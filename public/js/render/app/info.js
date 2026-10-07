// public/js/render/app/info.js — battle-unit info handed to a view, and which deaths draw particles.

/**
 * 'die' reason of an operator that enters the battle already knocked out — a 联防 helper's operator down at the end of
 * its own combat, deployed and forced out at once (server/sim/constants.js FORCED_EXIT, user playtest #5 item 2): its
 * view goes straight to the held knocked-down pose (UnitView.die(true)) without the death burst; b.snap `down` keeps it.
 */
export const FORCED_EXIT = 'forcedExit';

/**
 * Generic death particles for a battle unit's 'die' event: never for stage devices, nor for a summon used up by its
 * own effect (user playtest #2 item 4: 香槟炸弹's blast — sim fx `{ consumed: true, id }` before its 'die' — is its end,
 * not a knock-out), nor for an operator entering the battle knocked out (FORCED_EXIT).
 */
export const showsDeathFx = (info, consumed = false, reason = null) => !consumed && reason !== FORCED_EXIT && info?.kind !== 'device';

/**
 * The views' info of a battle unit from its UnitInfo (m.field / fieldMeta `units`, a 'spawn' event; snapshot.js
 * unitInfo), sanitised; null for a malformed entry. `form` — the unit's current model form (an enemy's, content/enemies.js
 * setForm: 转译基底·α's forms, a 逐火 余烬, a leader after its 重生, 掠海漂移体's crawl; a 傀儡师 fighting as its 替身, sim
 * professions.js) — makes a view built mid-battle (a teammate's
 * field watched later, 联防 observers, a reconnect, server-run watchers: no fx of the change is replayed) start on that
 * clip set (render/units.js FORMS); it used to be dropped here, so such views drew the first form (player report #5).
 */
export function renderInfo(u) {
  if (!u || typeof u !== 'object' || (typeof u.id !== 'number' && typeof u.id !== 'string')) return null;
  return {
    id: u.id, uid: u.uid ?? null, kind: u.kind || 'enemy', side: u.side === 'ally' ? 'ally' : 'enemy', ownerId: u.ownerId ?? null,
    defId: u.defId ?? null, name: u.name ?? '', tier: u.tier ?? 1, golden: !!u.golden, spine: u.spine ?? u.defId ?? null,
    avatar: u.avatar ?? u.defId ?? null, x: Number(u.x) || 0, y: Number(u.y) || 0, facing: u.facing === -1 ? -1 : 1,
    maxHp: Number(u.maxHp) || 1, boss: !!u.boss, motion: u.motion,
    // deploy direction of allies (UnitInfo.dir, DESIGN §3): the model (Back for UP, mirrored for LEFT) and the
    // ground wedge follow it; absent = unknown (legacy frames) → derived from `facing`, no wedge
    dir: typeof u.dir === 'string' ? u.dir : undefined,
    // the unit's current model form (UnitInfo.form: an enemy's mode, a 傀儡师's 替身): the view starts in it (UnitView reads info.form)
    form: typeof u.form === 'string' ? u.form : undefined,
    // DESIGN §16 loadout of an ally (UnitInfo.skillIndex / moduleId): the Spine actor plays that skill's clip, and a
    // tap hands them to the detail card (a teammate's unit shows its owner's skill / module)
    skillIndex: Number.isInteger(u.skillIndex) ? u.skillIndex : undefined,
    ammoSkill: u.ammoSkill === true,
    moduleId: typeof u.moduleId === 'string' ? u.moduleId : undefined,
    // the ally's equipped item ids (UnitInfo.items, DESIGN §16 / §21.11): the detail card needs them for a teammate's
    // unit (resolveDetail `unitItems` → the read-only 装备 section and the 变形同构体 pairing chips); the owner's own
    // unit takes its items from the piece instead, so only other players' boards ever read this field
    items: Array.isArray(u.items) ? u.items.filter((x) => typeof x === 'string') : undefined,
    // 0.2.0 补位: the replaced operator's charId of a chess fighting as its stand-in (UnitInfo.standInFor; spine / avatar /
    // name are already the stand-in's) — the detail card and the view's data lookups (attack interval, splash FX) follow it
    standInFor: typeof u.standInFor === 'string' && u.standInFor ? u.standInFor : undefined,
    // 0.2.0 自选编队: the pick of a DIY slot's unit (UnitInfo.diy { charId, skillIndex, uniEquipId }; spine / avatar / name
    // are already the operator's) — the detail card composes the operator from it, the data lookups follow it
    diy: u.diy && typeof u.diy === 'object' && typeof u.diy.charId === 'string'
      ? { charId: u.diy.charId, skillIndex: Number.isInteger(u.diy.skillIndex) ? u.diy.skillIndex : null, uniEquipId: typeof u.diy.uniEquipId === 'string' ? u.diy.uniEquipId : null }
      : undefined,
  };
}
