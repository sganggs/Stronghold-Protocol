# Settlement API migration

Content authors normally call these methods on `battle`. The same object requests are exported from
[`server/sim/attack.js`](../server/sim/attack.js), with `battle` as the first argument. Request types live in
[`types/attack.js`](../types/attack.js). This describes the current refactor; final acceptance is still pending in
the [behavior ledger](research/12-settlement-refactor.md) and [scenario review](research/13-settlement-golden-audit.md).

## Choose the operation by mechanism

| Operation | Meaning | Return value |
|---|---|---|
| `dealDamage` | Ordinary HP damage: physical, arts, true or elemental | HP actually removed |
| `dealElementDamage` | Element injury: fill a gauge, possibly causing a burst | Gauge intake accepted by the element pipeline |
| `dealHPLose` | HP loss, optionally physical/arts mitigation; no ordinary injury effects | HP actually removed |
| `heal` | HP healing, regeneration tick or restoration, selected by `mode` | HP actually restored |
| `healElement` | Recover the selected gauge, or each gauge independently | Sum of gauge values actually recovered |

`type: 'elemental'` is HP damage. A burn/neural gauge is a different quantity and uses `dealElementDamage`.
True damage is still ordinary damage; it does not replace HP loss, which omits ordinary damage/injury events,
barriers, dodge and hurt-SP. HP loss still produces HP bookkeeping and the legacy `damaged` notification.

```js
battle.dealDamage({ source: attacker, target, amount: attacker.s.atk, type: 'phys',
	attackType: 'NORMAL', applyWay: 'MELEE', isAttack: true });
battle.dealDamage({ source: null, credit: owner, target, amount: 300, type: 'true',
	attackType: 'ADDITION', applyWay: 'NONE', calculation: 'precomputed' });
battle.dealHPLose({ source: target, credit: owner, target, amount: 100, type: 'phys' });
battle.dealElementDamage({ source: attacker, target, amount: 100, element: 'burn' });
battle.heal({ source: medic, target, amount: 200 });
battle.healElement({ target, amount: 100 }); // each gauge, not a shared 100-point budget
```

`source` is the actual source recognized by modifiers/events. `credit` defaults to `source` and independently
owns damage statistics/kills. `source: null, credit: owner` expresses source-less damage with attribution;
there is no separate non-source damage function. Do not substitute the credited unit for the actual source.

## Describe an instance explicitly

| Field | Meaning |
|---|---|
| `type` | HP-damage family (`phys`, `arts`, `true`, `elemental`) |
| `attackType` | Native class (`NONE`, `NORMAL`, `SPLASH`, `BUFF`, `ADDITION`); object requests default to NORMAL |
| `applyWay` | Instance route (`NONE`, `MELEE`, `RANGED`, `ALL`) |
| `isAttack` | Whether this instance belongs to the authored attack behavior; independent of native class |
| `origin` | Immediate parent damage descriptor for a child instance |

Descriptive `tags`, `isSplash` and the source's position do not establish native class/route. For example, a
NORMAL pulse can be AoE; a sourced ADDITION can have no route; continuous damage can use the melee route.
`origin` neither changes attribution nor supplies complete ability/action ownership. Follow the operator's
native filters rather than inferring ownership from `credit` or the existence of a parent alone.

Callers include their authored ATK ratio in `amount`. Select the calculation stage from the source mechanism:

| `calculation` | Input and behavior |
|---|---|
| `base` (default) | Input before DEF/RES; source and target calculation events run |
| `precomputed` | Already selected/scaled input before DEF/RES; source calculation is omitted; target calculation and later stages remain |
| `resolved` | Already calculated amount; formula and calculation events are omitted; output, injury and HP settlement remain |

Precomputed is not “ignore armor”, “ignore dodge”, “source-less” or “skip every modifier”. Do not pass a value
already reduced by DEF/RES as precomputed input. Conversely, a native fixed-value or DamageViaAttr child
that omits source calculation must not accidentally run that event again just because it still has a source.
Use resolved only when the mechanism explicitly supplies an already calculated amount.

Ordinary dodge remains the default. `dodgeMode: 'ignore'` skips the attempt; `'uncancellable'` lets the attempt
occur but rejects its cancellation. `ignoreCancelReasons` independently selects `dodge`, `block`, or `miss`.
Choose those policies from native flags; `type: 'true'` does not establish them.

## Place triggers at their native stage

| Native intent | Current hook/effect |
|---|---|
| Source damage calculation | `damageCalculate` |
| Target damage calculation | `damageCalculateTarget` |
| After damage output, before target injury | `damageOutput` |
| Before target applies the modifier | `damageBeforeApply` |
| Receive modifier at an acquired injury position | A held buff's `injury` / `observeInjury` |
| Target after an ordinary damage/heal/gauge modifier is applied | `modifierApplied`; inspect `kind` and the actual HP/gauge delta separately |
| Positive ordinary damage settlement | `damageApplied`; `amount` and `hpRemoved` are distinct |
| HP bookkeeping | `hpChanged`; inspect `kind` and `delta` |

`observeInjury` also sees earlier cancellation; its writes cannot revive the damage. Attach the observer to
the buff that actually grants the effect so acquisition order and lifetime remain meaningful. `damaged` is a
compatibility notification including zero amounts and HP loss; it is not a universal successful-hit event.
Full barrier absorption reports `outcome: 'blocked', cancelled: true` to observers, even when compatibility
bookkeeping subsequently emits `damaged` with zero. Cancellation state and legacy notification policy are separate.
Positive damage can remove no HP under special-HP rules. Check `hpRemoved` when the rule concerns actual loss.

`modifierApplied` precedes source `damageApplied`. Ordinary healing reports its modifier amount even when
maximum HP clamps the restored amount; gauge intake likewise reports both `amount` and `gaugeAdded`.
HP loss, regeneration and direct HP restoration omit this ordinary-modifier event. Element recovery currently
changes gauges directly; it does not synthesize a native modifier event whose subtype/flags are unverified.

For a child effect conditional on successful ordinary damage, supply `dealDamage({ ..., onApplied(result) {} })`.
The synchronous callback runs after that damage's settlement and fatal/kill processing; it receives `amount`
and `hpRemoved`. It runs for positive special-HP damage even when no HP was removed, and does not run for
cancelled/fully absorbed damage. The numeric return alone cannot express this distinction. The callback is
not an attack event; choose it only when the authored effect follows completion of that damage instance.

Healing defaults to `mode: 'heal'`. Prefer `hpRegen` / `hpRegenRatio` buffs for regeneration attributes;
the engine delivers their self-regeneration ticks. `mode: 'regen'` represents those ticks and bypasses healing
multipliers/`healFree`, while retaining the existing regen notification/statistics contract. `mode: 'restore'` bypasses healing modifiers, heal events and healing
statistics. None of these revives a dead unit; deployment/revival belongs to the lifecycle API.

## Migrate compatibility calls carefully

Existing positional Battle calls remain supported by [`attack/legacy.js`](../server/sim/attack/legacy.js).
New code should use object requests. The original [`damage.js`](../server/sim/damage.js) stays independent for
comparison; its exports and the `loseHp` / `reduceElement` aliases carry deprecation annotations. The same-name
positional overloads have migration descriptions; a per-overload IDE deprecation strike-through is not guaranteed.

Old positional `loseHp(target, amount, opts)` assumes the caller already applied mitigation. The new typed
`dealHPLose({ type: 'phys'|'arts', amount, ... })` performs mitigation once: recover the original raw input and
remove the caller's manual mitigation, rather than relabeling a post-mitigation amount and reducing it twice.
Object requests deliberately do not use legacy tag inference for native damage classes.

For each migrated effect, preserve source/credit, class, route, calculation stage, cancellation flags and trigger
phase. Record intentional old/new differences with native/PRTS evidence. The regression patterns in
[`damage-api.test.js`](../test/sim/damage-api.test.js), [`attack-native-stages.test.js`](../test/sim/attack-native-stages.test.js)
and [`lord-module.test.js`](../test/content/lord-module.test.js) cover these boundaries; passing the old magnitude
test alone does not establish correct timing, classification or attribution.
