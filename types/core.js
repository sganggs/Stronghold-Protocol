/**
 * Core shapes for the sim and the wire protocol.
 *
 * Taken from docs/DESIGN.md §5.2 (Unit), §5.4 (DamageInfo), §8 (envelope, b.snap)
 * and docs/SIM.md §4 (DamageInfo as makeDamageInfo builds it) and §9 (snapshot tuples).
 * The sim does not import this file. It is here so the shapes have one JSDoc home
 * while server/sim is still being split.
 */

/**
 * A unit inside one battle. Minimum fields from DESIGN §5.2.
 * Stats (`maxHp`, `atk`, …) are recomputed by the sim and are not all listed here.
 *
 * @typedef {Object} Unit
 * @property {number} id unique per battle
 * @property {'ally'|'enemy'} side
 * @property {'op'|'token'|'enemy'|'device'} kind
 * @property {string} defId
 * @property {string|number} ownerId player id; enemies use the field owner or the source player
 * @property {number} x
 * @property {number} y
 * @property {number} [tileR] operators
 * @property {number} [tileC] operators
 * @property {'UP'|'RIGHT'|'DOWN'|'LEFT'} [dir] allies: deploy direction. Enemies are not meaningful here.
 * @property {number} facing horizontal sign, +1 or −1 (LEFT is −1)
 * @property {number} hp
 * @property {boolean} alive
 * @property {number} sp
 * @property {Object[]} [buffs]
 * @property {number} [statusFlags]
 * @property {number[]} [blocking] operators: ids of enemies they block
 * @property {number|null} [blockedBy] enemies: blocker id
 * @property {number[][]} [liveRangeGrid] the attack range the detail card shows
 * @property {string} [form] model form (enemy mode, or a doll's `'doll'`)
 */

/**
 * One damage instance, after `makeDamageInfo` (server/sim/attack/helpers.js).
 * DESIGN §5.4 and SIM §4 distinguish `'elemental'` HP damage from `'element'` gauge fill, which removes no HP.
 *
 * @typedef {Object} DamageInfo
 * @property {number} amount pre-mitigation
 * @property {'phys'|'arts'|'true'|'elemental'|'element'} type
 * @property {'burn'|'necrosis'|'neural'|'apoptosis'|string|null} [element]
 * @property {number} [atkScale] legacy metadata; amount already contains attack scaling
 * @property {number} [defIgnoreFlat]
 * @property {number} [defIgnorePct]
 * @property {number} [resIgnoreFlat]
 * @property {number} [resIgnorePct]
 * @property {number} [mul]
 * @property {boolean} [canDodge]
 * @property {boolean} [isSkill]
 * @property {boolean} [isSplash]
 * @property {boolean} [isAttack]
 * @property {'NONE'|'NORMAL'|'SPLASH'|'BUFF'|'ADDITION'} [attackType] independent of source and attack behavior
 * @property {'NONE'|'MELEE'|'RANGED'|'ALL'} [applyWay] this damage instance's delivery route
 * @property {boolean} [isProjectile]
 * @property {string[]} [tags]
 * @property {boolean} [cancel] set by a `hit` hook to drop the instance
 * @property {('dodge'|'block'|'miss')[]} [ignoreCancelReasons] attempts still occur, but these reasons cannot cancel
 * @property {boolean} [missed] an actual miss occurred, including when its cancellation was rejected
 * @property {boolean} [noSp]
 * @property {boolean} [ignoreSleep]
 * @property {boolean} [ignoreSelect] reaches an airborne ally; the hit selected nobody
 * @property {boolean} [sourceless] 无来源: source stats add nothing
 * @property {number} [attackId] shared by every instance of one normal attack; 0 otherwise
 * @property {DamageInfo|null} [origin] immediate parent descriptor for carried damage; independent of source/credit
 * @property {Unit|null} [traitAlly]
 */

/**
 * One living unit in a snapshot.
 * `[id, x, y, hp, maxHp, sp, spMax, flags, anim]` (SIM §9, DESIGN §8.2).
 * `flags` is the UF bitmask. `anim` is the ANIM code.
 *
 * @typedef {[number, number, number, number, number, number, number, number, number]} UnitSnap
 */

/**
 * A knocked-out operator waiting to redeploy.
 * `[id, respawnAt, respawnTime, state, row, col]`.
 * `state`: 0 counting, 1 timer done and DP short, 2 timer done and the tile is taken.
 *
 * @typedef {[number, number, number, number, number, number]} DownSnap
 */

/**
 * Element gauge or burst cooldown on one unit.
 * `[id, element, fill, cooldownEnd, cooldown]`.
 *
 * @typedef {[number, string, number, number, number]} ElemSnap
 */

/**
 * One HP-bar readout of a unit: `[id, left, max]` — the rounds left of a running ammo skill and its magazine (`ammo`), or the
 * 狼影 left of 伺夜's 狼群 and the talent's maximum (`wolves`). Whole numbers.
 *
 * @typedef {[number, number, number]} CountSnap
 */

/**
 * A negative-HP pool as a share of its cap (`neg`, 斩业星熊's 我执): `[id, fill]`, fill 0.01–1.
 *
 * @typedef {[number, number]} NegSnap
 */

/**
 * `snapshot()` (SIM §9). On the wire this object is the payload of `b.snap`,
 * and `t` is sent as `gt` because the frame's `t` is the message type (DESIGN §8.2).
 * `dp` is one number. `down`, `elem`, `ammo`, `wolves`, `neg`, `stand` and `standCut` are omitted when empty: `stand`
 * [id, until] = the game time an enemy's attack recovery ends, `standCut` [id, at] = the latest time it was cut or
 * ignored (enemies in the snapshot's death window included).
 *
 * @typedef {Object} FieldSnapshot
 * @property {string} fieldId
 * @property {number} t game seconds
 * @property {UnitSnap[]} units
 * @property {number} dp
 * @property {number} killed
 * @property {number} total
 * @property {Object<string, number>} [dps]
 * @property {Object} [boss]
 * @property {DownSnap[]} [down]
 * @property {ElemSnap[]} [elem]
 * @property {CountSnap[]} [ammo]
 * @property {CountSnap[]} [wolves]
 * @property {CountSnap[]} [coins] 琳琅诗怀雅 skill balance and cap, including zero
 * @property {NegSnap[]} [neg]
 * @property {[number, number][]} [stand]
 * @property {[number, number][]} [standCut]
 */

/**
 * One WebSocket JSON frame (DESIGN §8). Client requests may carry `rid`.
 * The server's `ok` or `error` echoes it. Server pushes omit it.
 * Other own fields are the payload. Inbound frames are capped at 64 KB.
 *
 * @typedef {Object} ProtocolMessage
 * @property {string} t message type
 * @property {number} [rid] request id
 */

export {};
