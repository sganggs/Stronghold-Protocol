# Settlement refactor: compatibility and fidelity ledger

Historical baseline: `fbc52d0f`. Research checked 2026-10-15. Worktree: `refactor/damage-api`.
This is an implementation audit, not a claim that every Arknights mechanic has been reproduced.

## Upstream synchronization (2026-10-16)

Merged `v0.3.0` (`c24e17ee`) in `8d39e762`, then restored the in-progress settlement work. The upstream
passenger implementation/tests and all upstream golden baselines are retained. Range checks use upstream's
`bodyInRange` API; Flametail retains upstream's bounded plugin step calculation while using native injury dodge.
Upstream SDK/callback documentation is retained alongside the new settlement contracts. There are no unresolved
Git conflicts. The original dirty work remains preserved in the named pre-sync stash until verification finishes.

Post-sync engine/content verification: 3349 total, 3346 passed, zero failures, 3 skipped
(`/private/tmp/attack-v030-areas.log`). The first focused passenger/Chen/Lee/delivery/docs run passed 92 tests.
This is intermediate verification, not final CI. A separate clean `v0.3.0` archive at
`/private/tmp/stronghold-damage-v030-original` provides the new comparison baseline; historical S1–S30 values and
46 changed golden scenarios below remain evidence against `fbc52d0f`, not measurements against 0.3.0.
The clean 0.3.0 archive passes all 288 shipped golden scenarios (49 roster, 46 bonds, 22 fields, 21 matches,
10 standins, 140 DIY), without regenerating baselines (`/private/tmp/attack-v030-original-golden.log`).
Scoped settlement/content lint reports zero errors and eight warnings (`/private/tmp/attack-v030-lint.log`).
The independent refactor probe against unchanged 0.3.0 goldens reports 43 differences: 17 roster, 2 bonds,
11 fields, 6 matches, 2 standins and 5 DIY (`/private/tmp/attack-v030-diffs.json`). This is not a passing golden
run and does not accept the differences. Compared with the historical 46-name set, `roster-014` and
`boss-boss_2-pair` are newly different; `bond-kazimierzShip-high`, `solo-NORMAL-2`, `solo-HARD-2`,
`coop2-NORMAL-5-coverage-diy` and `standin-05` no longer differ from their upstream baselines. Attribution must
be refreshed on this version before accepting any gameplay changes. Upstream golden files remain byte-identical.

## Revised design verdict (2026-10-15)

The useful simplification is a shared ordered settlement model, not a smaller list of public function names.
The prototype is not a complete faithful replacement. At the pre-S20 checkpoint its 819 lines (`attack.js` plus `attack/*.js`,
including the adapter, excluding the retained original) exceed the baseline engine's 669 lines. This comparison
does not include the migrated content or measure behavioral complexity; it cannot support a claim of code-size savings.

Keep five semantic operations: HP damage, gauge damage, typed HP loss, healing and gauge recovery. In particular,
`dealElementDamage` prevents the ambiguity between elemental HP damage and element-gauge accumulation. Source
and attribution are independent request fields; a source-less request uses `source: null` without a second public
entry or a contradictory `sourceless` switch. The compatibility adapter alone interprets old switches.

Before accepting the replacement, tighten these contracts:

1. **One ordered injury pass, with explicit outcomes.** Effects are ordered by priority and acquisition sequence.
   Cancellation must distinguish dodge, block and other rejection from an ordinary zero amount. Later defensive
   effects stop consuming charges or RNG; eligible observation effects still run at their own ordered positions.
   Do not send all cancelled instances through a generic `damaged` hook to simulate those observers. The initial
   unconditional loop break could not implement this contract; S20 introduces ordered observers and shares the
   existing callback frames/depth guard for nested native counters.
2. **Effect-owned applicability.** Ordinary physical/arts dodge is a default filter on the relevant effect, not
   an engine-wide ban on every other damage type. [PRTS damage classification](https://prts.wiki/w/伤害分类)
   explicitly allows unqualified injury effects to affect true damage. The initial `dodge` helper hard-coded
   phys/arts; S26 removes that engine-level restriction, with per-effect filters and a sourced all-type example. This does not imply that any named operator's
   dodge or block applies to true damage; each effect still requires its own source evidence.
3. **Distinct request types.** HP loss should not inherit the entire ordinary damage descriptor: fields such as
   dodge policy, attack behavior and ordinary damage multipliers advertise behavior its path ignores. Define
   the small allowed request explicitly (implemented in S25). Internally HP loss selects a skip-modifier policy and shares mitigation
   and HP application with damage; it is not an unrelated alternative HP engine.
4. **Explicit calculation/event boundaries.** Base, precomputed and post-calculation damage are not synonyms.
   [PRTS damage classification](https://prts.wiki/w/伤害分类) distinguishes the calculation event and mitigation
   that each omits. The prototype's `calculation: 'resolved'` currently still reaches `damageCalculated`;
   that project event is after formula calculation and must not be advertised as the official pre-formula
   `ON_CALCULATE_DAMAGE`. Either use a clearly named internal event or model those policies explicitly when
   their first real caller is migrated. Do not expose arbitrary combinations of bypass switches.
5. **Shared HP bookkeeping is not a shared game trigger.** Actual HP change, injury observation, successful
   damage, block, dodge and kill must retain their separate trigger meanings. An absorbed hit can remove no HP;
   an HP-loss operation can remove HP without ordinary damage triggers. The existing legacy notification remains
   an adapter contract until its callers are individually classified.

[PRTS injury effects](https://prts.wiki/w/伤判效果) and [PRTS events](https://prts.wiki/w/事件) support the ordered
pass and trigger distinctions. Do not turn all earlier hit hooks into injury effects: hit accuracy, projectile
delivery and selection immunity can have different original timings. Likewise, do not infer source, attack
behavior or application route solely from a periodic/DoT label.

Concrete simplifications already demonstrated by the experiment:

- A shield acquired before an ordinary same-priority dodge consumes the shield without a dodge draw. Reversing
  acquisition order lets dodge preserve the shield. The baseline's fixed dodge-first branch cannot express both.
- Barrier overflow is the actual input to later modifiers; enemy shields no longer need to predict final damage
  and reverse it into a multiplier. Protection no longer needs to reconstruct damage already absorbed.
- Transfer callbacks reserve actual remaining damage instead of dividing the victim's final HP loss by a retained
  ratio. The receiver's damage/loss policy remains explicit; simultaneous sharing still has the documented
  project-specific assumption and must not be described as verified original-game behavior.

Acceptance requires removal of the corresponding content workarounds, independent sourced interaction tests,
and explanation of every golden change. Passing old/new equivalence tests alone is insufficient because both
engines can implement the same wrong behavior. A formula correction which also fits the old engine is a gameplay
fix, not proof that the architecture is necessary. Retain the old implementation as a development comparison;
long-term production should have one settlement engine with a thin deprecated adapter, not two evolving engines.

Fresh focused verification for this verdict: `node --test test/sim/damage-api.test.js
test/sim/attack-effects.test.js test/sim/attack-fidelity.test.js` — 41 passed, 0 failed, 0 skipped.
No full CI or full-original-mechanics equivalence is claimed by this verdict.

### S20–S21: ordered observations and Hoshiguma migration

| ID | Baseline behavior | New behavior | PRTS standard / evidence |
|---|---|---|---|
| S20 | Dodge returns early; late injury processing has no continuation policy | Buff `observeInjury` retains its priority/acquisition position after zero/block/dodge, while later defensive callbacks, charges and RNG stop. `block` and `dodge` are distinct outcomes | [伤判效果](https://prts.wiki/w/伤判效果): most observers, including inverse damage and injury counts, continue after cancellation; [事件](https://prts.wiki/w/事件): block and dodge trigger distinct immediate events |
| S21 | 星熊 blocks only phys/arts with enemy source/credit in early `hit`; S2 counter uses late `damaged`, so dodge/block suppress it | Armor is an ordinary unqualified block across HP damage types, independent of attribution; thorns observes sourced enemy injury before HP application, including cancelled instances | [星熊](https://prts.wiki/w/星熊): 战术装甲 grants unqualified damage block, thorns directly selects enemy source; [伤害分类](https://prts.wiki/w/伤害分类): unqualified injury effects can affect true damage; [伤判效果](https://prts.wiki/w/伤判效果): reflection continues after block/dodge |

This implements the observation/outcome portion of the revised verdict, not every remaining completion gate.
`injury` and `observeInjury` use the existing `_safe` callback frames: a nested native counter remains inside its
parent frame, so callback recursion is bounded without adding a second battle-level nesting counter.
Existing exception reporting is preserved. A depleted shield carrying an observer is retained for that observer.

Focused verification: 159 passed, 0 failed, 0 skipped across the API/effects/fidelity and tier-4/base-alternate suites.
New regressions assert observers before/after each cancellation cause, no extra defensive rolls/charges, no revival
by changing an observer snapshot, depleted-shield observer retention, recursion guard recovery, and actual 星熊
true/elemental block plus thorns after block/dodge. The former test claiming true damage always lands was replaced
with deterministic original-rule assertions. Scoped lint has 0 errors and 2 existing unused-variable warnings.
No golden update or final full-CI pass is claimed here.

Expanded verification after S21: `node --test test/sim/*.test.js test/content/*.test.js` — 3265 tests,
3262 passed, 0 failed, 3 skipped (`/private/tmp/attack-observer-areas-verified.log`). This includes an independent
fatal-order test: thorns kills the attacker before incoming fatal processing, while that already-delivered damage
still kills 星熊. The first expanded run exposed two stale test assumptions: the pulse counter expected only
uncancelled `damaged` notifications, and the burst fixture stubbed only the old `rng.chance` hook. The former now
counts incoming `hit` instances for the migrated counter; the latter controls the native RNG draw as well. Their
24 focused regressions pass. Docs consistency/path checks: 32 passed. Scoped lint still has 0 errors and the same
2 existing warnings. The 35-difference golden probe predates S20–S21; current golden movement has not been measured
or accepted. Other counters/conditional shields and the remaining fidelity gates still require migration/audit.

### S22–S25: native skill dodge and one-use block

| ID | Baseline behavior | New behavior | Source / status |
|---|---|---|---|
| S22 | 拉普兰德 S1 owns a priority-5 early hit listener; enemy source/credit is required and the effect reports block, independently of dodge policy | The skill's native `dodgePhys` owns probability, acquisition order and lifetime; normal/ignore/uncancellable policies apply without borrowing credit | [拉普兰德](https://prts.wiki/w/拉普兰德) explicitly corrects 抵挡 to 闪避; [伤判效果](https://prts.wiki/w/伤判效果) supplies ordering |
| S23 | 雷蛇 S1 consumes its charge in a priority-50 early hit cancellation, even before an earlier barrier/dodge | One-use buff-owned block runs at ordinary injury priority, retains the charge after an earlier zero/cancel, expires at skill end, and still gives no tactical-defense/hurt-SP | [雷蛇](https://prts.wiki/w/雷蛇), [伤判效果](https://prts.wiki/w/伤判效果): next damage is blocked, eight-second skill duration; ordinary injury effects follow acquisition order |
| S24 | Every elemental-burst HP instance explicitly ignores ordinary dodge, while the old 拉普兰德 hit listener nevertheless blocks physical bursts | Burst HP instances use the normal damage-type policy consistently; statuses/cooldown remain applied when the HP damage is dodged | [元素](https://prts.wiki/w/元素) classifies these as ordinary source-less physical/arts damage, without listing a dodge exception. **[ASSUMED]** Applying ordinary dodge follows that classification; the page does not explicitly settle dodge flags, and original-client flags are not available in the local cache |
| S25 | `HPLossRequest` inherits ordinary damage fields, advertising dodge/calculation behaviors which its implementation ignores | Explicit small request type contains supported mitigation, attribution and bookkeeping fields only | Interface tightening; runtime HP-loss rules remain as S3. [伤害分类](https://prts.wiki/w/伤害分类) distinguishes mitigation from skipped modifier events |

Removed the two early-hit listeners rather than maintaining parallel native and kit-specific mechanisms. Native
skill buff removal owns 拉普兰德 cleanup, eliminating its separate onStart/onEnd subscription state. 雷蛇 retains
the project's existing skill-duration ownership of the charge. Earlier PRTS-informed burst tests exposed the
baseline's contradictory dodge policies rather than proving the old ignore flag correct. S24 remains explicitly
an inference, not original-client verification. Generic zero-amount settlement notifications and unrelated legacy
counter timings are not claimed resolved by this migration.

Focused migration run: 107 passed, 0 failed, 0 skipped (API fidelity, tier-1/2 alternates, element behavior and solvent
regressions). New independent cases cover dodge versus block events, ignore/uncancellable behavior, source-less
credit, shield-before-skill acquisition, skill cleanup, HP-loss/gauge bypass, 雷蛇 true block without SP, and burst
status/cooldown retention after HP dodge. Expanded area verification and current golden attribution remain pending.

Expanded S22–S25 checkpoint: `node --test test/sim/*.test.js test/content/*.test.js` — 3270 total,
3267 passed, 0 failed, 3 skipped (`/private/tmp/attack-defensive-areas.log`). This adds the earlier-barrier preservation
and unused-charge expiry regression. Docs checks: 32 passed. Scoped lint: 0 errors, 1 pre-existing unused-variable
warning. Scoped TypeScript usage checks accept the 9 representative object/legacy calls, and a separate probe
requires compiler rejection of ordinary dodge/calculation fields and a missing amount on HP-loss requests
(`/private/tmp/attack-hploss-interface.log`). This is not full-engine type coverage. The canonical engine formula
description is updated to fixed-before-percentage penetration, removing a stale contradiction with S9 and SIM.md.
Full CI, all-current golden attribution and the remaining conditional injury/observer migrations are still open.

### S26–S27: condition-owned dodge and held-dodge order

| ID | Baseline behavior | New behavior | PRTS standard |
|---|---|---|---|
| S26 | 圣约送葬人 S2 cancels in early `hit`, requires `isAttack`, guesses melee from source profile/range/blocking, ignores request dodge policy; generic engine dodge forbids true/elemental | Skill-owned injury buff at +2000 filters actual enemy source and the instance's application route, attempts all four HP types, and refills only its own successful dodge. Explicit ignore skips; uncancellable attempts/refills without cancelling | [圣约送葬人](https://prts.wiki/w/圣约送葬人): explicit +2000, source and all-four-type notes, “近战攻击” means melee-route damage. [伤害分类](https://prts.wiki/w/伤害分类): route is independent of source tags and attack type; NONE matches either restriction |
| S27 | 赤刃明霄陈 held dodge re-rolls aggregated ordinary dodge in early `hit`; emits credited unit as dodge source; generic `damaged` resets timer even for full absorption | A non-stacking -1000 held buff executes after ordinary effects, needs no probability draw, consumes only on its own attempt, preserves real source/credit, reacquires on move, clears on death/ordinary deploy; positive `damageApplied` resets timer | [赤刃明霄陈](https://prts.wiki/w/赤刃明霄陈): priority -1000, non-stacking, physical/arts, S2 movement re-grant. [伤判效果](https://prts.wiki/w/伤判效果) and [事件](https://prts.wiki/w/事件): full block/dodge is not successful damage application |

`applyWay` is explicit request metadata; legacy inference is RANGED for a projectile, MELEE for a non-projectile
attack, otherwise NONE. ALL matches either route filter. This replaces the incorrect source-profile inference;
it does not claim every existing content-authored projectile/area ability already has perfect official metadata.
Those callers can supply the original route explicitly. The old independent `damage.js` implementation is unchanged.
Ordinary phys/arts dodge attributes and other custom dodge effects retain their own type filters. Requests permit
all HP types to reach eligible effects by default; explicit ignore still skips them, so enabling a true-type
request does not grant ordinary physical dodge an ability to evade it.

Focused verification: 183 passed, 0 failed, 0 skipped before two further boundary regressions. Expanded current
`test/sim/*.test.js` + `test/content/*.test.js`: 3280 total, 3277 passed, 0 failed, 3 skipped
(`/private/tmp/attack-conditional-areas.log`). The independent matrix covers all HP types × routes, route/profile
disagreement, non-attack damage, legacy projectile inference, actual-source versus credit, +2000 shield ordering,
ignore/uncancellable refill, and skill cleanup. Held-dodge cases assert one ordinary draw rather than two, no draw
for the held guarantee, source-null credited events, full-absorption timer preservation, move re-acquisition,
non-stacking and death/redeploy cleanup. Scoped lint: 0 errors, 1 existing redundant-initial-assignment warning.
Current golden movement has not yet been accepted or attributed after these migrations; full CI remains pending.

### Post-S27 golden measurement (not an accepted update)

Fresh independent digest computation against unchanged fbc52d0f goldens reports 45 changed scenarios:
16 roster, 3 bonds, 10 fields, 8 matches, 3 stand-ins and 5 DIY. Artifacts:
`/private/tmp/attack-conditional-digests.json`, `/private/tmp/attack-conditional-diffs.json`,
`/private/tmp/attack-conditional-golden.log`. No golden file was changed. The independently exported original
passed all 287 scenarios; the current 45 movements are not reported as a passing golden run.

Ten scenes were added to the previous 35-difference set. Independent old/new Battle traces locate their first
meaningful divergence; reading cached metadata avoids changing lazy-stat/HP state during instrumentation.

| Newly moved scenes | First observed divergence | Rule / attribution status |
|---|---|---|
| `roster-010`, `roster-012` | At 53.4333s / 117.2333s both versions block the same incoming instance on 星熊; only new settles her immediate counter (278.718 / 26.026 HP) | S21: reflection still observes a blocked instance |
| `bond-emptyShip-high`, `bond-suntShip-low` | At 26.6667s / 39.8667s an identically blocked incoming hit now gets 星熊's counter before the next ordinary attack | S21 |
| `boss-boss_4-solo` | At 1.1s incoming physical HP loss is identical (37.025623); new counter runs before the enemy's element rider, rather than after the enclosing enemy damaged dispatch | S21: injury observation precedes HP/post-application callbacks |
| `hidden-boss_8-solo` | At 1.4s identical blocked input now produces 星熊's 26.026 counter before the next attack | S21 |
| `roster-029`, `boss-boss_2-solo` | Same source-less true hit on 星熊 at 80.9667s / 0.9667s has the same HP result but now attempts her unqualified block; the next instance starts from a different RNG state | S21: true/source-independent block is eligible even if that draw fails |
| `hidden-boss_10-pair` | At 53.9667s source-less apoptosis 100 arts hits an ally with 50% arts dodge; HP loss is still 70 on the failed draw, but the next attack starts from a different RNG state | S24 **[ASSUMED]**, ordinary arts burst dodge is now attempted; explicit original-client flags remain unverified |
| `hidden-boss_10-solo` | At 81.4s the same outer hit removes one frequency HP; nested 星熊 counters leave the enemy at 0 instead of 4 | S21 nested continuation: old trace has 8 incoming arts instances (1 blocked) and 7 counters; new has 12 incoming (2 blocked) and 11 counters, with no new counter after source death |

The nested trace is separately saved in `/private/tmp/attack-conditional-nested-counter.json`. First-divergence
evidence explains the trigger of the changed execution path, not every downstream statistic or full-match outcome.
The other 35 moved scenes still need their current-state attribution completed before accepting golden updates.
Docs checks after S27: 32 passed. The scoped interface probe still passes representative new/legacy calls and
required negative HP-loss cases. Final full CI and complete golden acceptance remain open.

### S28–S30: melee shield and projectile delivery boundary

| ID | Baseline behavior | New behavior | PRTS standard / uncertainty |
|---|---|---|---|
| S28 | 薇薇安娜's shield cancels in an early hit listener, treating projectile marker as the route; updating layers replaces its buff/sequence | Ordinary injury block tests actual enemy source and damage route. Adding layers retains the original buff/sequence; earlier dodge/full absorption preserve them | [薇薇安娜](https://prts.wiki/w/薇薇安娜): enemy-source melee-route shield, no damage-type limit. [伤判效果](https://prts.wiki/w/伤判效果): ordinary priority and acquisition order |
| S29 | 余's wall lies through his tile; at impact, ranged-enemy attack damage crossing it is randomly cancelled. Other effects of that projectile can still run | Wall sits half a tile ahead. A removable enemy projectile enters a width-0.3 strip during flight and may be removed once per entry, preventing its entire impact callback, independent of damage type, range or target | [余](https://prts.wiki/w/余): position, width, removable-projectile meaning, possible fast/zero-speed misses. **[ASSUMED]** Sim-tick endpoint sampling and no stationary trigger approximate that collision; exact original physics is unverified |
| S30 | Projectile entries do not distinguish speed-change/removal eligibility; 逻各斯 slows/clears every enemy shot in range | Independent speedChangeable/removable flags resolve explicit overrides and automatic visible-VFX behavior; 逻各斯 honours both. Flight cancellation cannot leak the impact's damage/gauge riders; hook-created shots wait until next update | [弹道](https://prts.wiki/w/弹道): automatic speed-change uses visual effects; automatic removal follows speed-change eligibility, explicit modes may differ |

This deliberately separates delivery from ordered injury effects. A direct `dealDamage` call is already an
arrived instance, even if it carries a projectile marker; it does not recreate a projectile's flight. The engine
does not reinterpret projectile interception as dodge/block or trigger recipient injury observers for a shot
that never arrives. The damage source and projectile creator remain separate caller responsibilities.

Projectile properties are resolved booleans rather than a second set of game-state modes: callers set explicit
speedChangeable/removable overrides when original data uses YES/NO; omission uses automatic defaults. This adds
representation for those distinctions without claiming every existing content-created projectile's official
flags have already been extracted. A zero speed is retained rather than replaced with standard speed; invalid
negative/non-finite speeds still fall back. Existing target-death/redeployment fizzle and lifetime behavior remain.

Initial affected-area run: 3289 total, 3286 passed, 0 failed, 3 skipped, including actual 逻各斯 override cases.
After adding the field-boundary regression, focused delivery/薇薇安娜/逻各斯/余/robustness verification: 123 passed,
0 failed, 0 skipped (`/private/tmp/attack-delivery-final-targeted.log`). New cases cover all HP types and explicit
route overrides, layer sequence preservation, prior dodge, source-less credit, HP-loss/gauge bypass, all four wall
directions, complete suppression of multiple damage/gauge impacts, one draw per entry, independent flag overrides,
fast/stationary shots, inactive walls, field bounds, and safe next-tick spawning from flight hooks. The prior
45-scene golden measurement predates S28–S30; no new baseline acceptance is implied by those passing tests.

Latest S28–S30 checkpoint before upstream 0.3.0 synchronization: the full engine/content run reports 3290 total,
3287 passed, zero failures and 3 skips (`/private/tmp/attack-delivery-areas-final.log`). The independent golden
probe now reports 46 changed scenarios: 16 roster, 3 bonds, 10 fields, 9 matches, 3 standins and 5 DIY
(`/private/tmp/attack-delivery-diffs.json`). No baseline was updated or accepted.

The additional `solo-NORMAL-2` difference is traced to S29's corrected wall plane. Both versions first apply
1874.54784 arts damage at time 35.3333333333, leaving the same target at 17565.45216 HP with identical RNG state.
The new version then adds Yu's 83.511912 elemental-gauge rider at that same time; the old version proceeds to
the next arts instance at 35.4333333333. This identifies the first changed path, not every subsequent match
outcome (`/private/tmp/attack-delivery-added-match-first.json`). These measurements refer to fbc52d0f-era content;
after synchronizing 0.3.0, comparison must use a separately verified upstream baseline.

### S31: Kal'tsit physical block

| Baseline behavior | New behavior | PRTS standard |
|---|---|---|
| S1 rolls physical block in a `hit` listener at -500, before every acquired barrier/dodge, with its own cancellation/FX | A skill-owned ordinary `injury` callback calls `ctx.block(prob)` for physical damage; skill end removes it, and an earlier full barrier/dodge prevents its roll | [凯尔希](https://prts.wiki/w/凯尔希) specifies physical block, not dodge. [伤判效果](https://prts.wiki/w/伤判效果) gives default ordinary priority and acquisition order, with later defensive effects skipped after zero/cancellation |

The callback retains the physical-only condition and existing probability and block FX. Actual source is not a
condition. Dodge ignore/uncancellable modes do not disable a block. Gauge accumulation and HP loss do not enter
this effect. Native block also emits the common `block` event; the former private cancellation did not.
Focused real-kit/native-effect/fidelity verification: 51 passed, zero failures
(`/private/tmp/attack-kalts-native.log`). The new real-kit regression checks an earlier full barrier consumes no
random draw, an earlier dodge rolls only itself, both dodge policies still permit physical block, unrelated
domains do not attempt it, and skill end removes it. Existing all-form probability/stat/Mon3tr tests still pass.

After S31 the full engine/content run reports 3350 total, 3347 passed, zero failures and 3 skips
(`/private/tmp/attack-kalts-areas.log`). Docs checks: 32 passed; scoped Kal'tsit code/test lint: no diagnostics.

### First-divergence evidence against 0.3.0

`/private/tmp/attack-v030-first.json` traces all 43 differing scenarios against the clean 0.3.0 archive, including
full matches. It compares HP-damage calls, returns, HP and pre-call RNG, without reading dirty lazy stats. Nested
calls can change trace order; these first paths identify causes to audit, not proof that every downstream change
is correct. `roster-005` and `roster-006` have identical HP-call traces despite differing hook/status/snapshot
digests, so they still need an event-domain trace. Do not classify them as equivalent because HP calls match.

Two scenarios newly different after synchronization have additional input/after-RNG instrumentation
(`/private/tmp/attack-v030-added-detail.json`):

| Scenario | Direct observation | Attribution / limit |
|---|---|---|
| `roster-014` | At 67.2s `enemy_1272_nhtank` hits Executor with 1328.67075 physical input, `isAttack:true`, `isProjectile:false`. Pre-call HP/RNG match. Old removes 1803.7415 HP without a draw; new removes zero and draws once | S26: the instance is melee even though the source has a ranged profile. Existing native-route regression covers this distinction; the old range inference prevented this dodge |
| `boss-boss_2-pair` | At 153.0667s the boss's physical projectile into Mizuki removes the same 1235.89175 HP, but the complete call (including nested gauge/burst work) changes RNG from 1482482999 to old 3314048812 / new 850647329. The source-less erosion 800 physical child removes the same 538.2 HP | S24: the new burst attempts ordinary stalker dodge. The nested trace confirms the erosion child alone changes RNG from 3314048812 to 850647329 in the new engine while the old child draws nothing; its draw fails, so HP remains equal. Original-client dodge flags remain [ASSUMED] |

These traces predate S31; a fresh final golden probe remains required after all migrations.
The additional nested trace is `/private/tmp/attack-v030-boss2-nested.json` (parent HP damage → sourced gauge
application → source-less erosion child), and distinguishes the extra burst draw from the parent's ordinary dodge.

An event trace (`/private/tmp/attack-v030-notification-first.json`, full traces in
`attack-v030-notifications-roster-005.json` / `-006.json`) explains why HP-call comparison alone misses two scenes:
`roster-005` adds nine zero-amount `damaged` notifications from arts instances fully absorbed by Mouse King's
barrier (first at 120s). `roster-006` first reorders the same Stead receiving losses before the victim's own
notification at 34.3667s; it also adds eight zero-amount arts notifications against enemy Mudrock. The ordering
is S14 forward transfer; the extra zero notifications expose an unresolved success-event problem, not an
automatically accepted gameplay improvement. Snapshot/status differences still need causal attribution.

### S32: success notifications are not generic injury notifications

The direct pre-S32 probe (`/private/tmp/attack-zero-success-probe.log`) observed a zero-HP barrier/hit-shield/flat
reduction calling hurt-SP and emitting `damageApplied`, unlike native block. The prior audit incorrectly treated
both as the same defect. [事件](https://prts.wiki/w/事件) and [伤判效果](https://prts.wiki/w/伤判效果) establish that
zeroed/blocked injury is not successful damage; their Liskarm example concerns her extra talent SP, and does not
by itself settle the skill's basic hurt-SP behavior. [技能](https://prts.wiki/w/技能) describes that separate skill
SP mechanism. Existing project tests explicitly expect basic hurt-SP through generic barriers. Those expectations
are preserved until directly verified; neither the test nor a generic success-event rule proves the original flag.

New behavior: `damageApplied` requires a positive applied damage amount; `hpChanged` requires actual HP removal.
Legacy `damaged`, `lastHitAt` and basic hurt-SP retain their existing zero-instance contract. This deliberately
separates API semantics from pending old-hook migration. Injury observers still run at their own ordered positions
for zero/block/dodge. New engine regressions cover a full barrier, hit shield, native block and flat reduction,
checking HP, native observation, new success notifications and the distinct legacy notification contract.

An exploratory blanket zero-amount early return was rejected after exposing unrelated preexisting event timing
requirements (Penance's basic hurt-SP, Lin's glass wall and talent, shield-break notifications, negative-HP handling,
and barrier-based counters). Its failing run is `/private/tmp/attack-zero-areas.log`; it is not the current design
or a reported pass. Counter effects need injury observation; basic skill SP needs its own original-client audit.

### S33: Bubble and Penance counter observation

| Baseline behavior | New behavior | Standard / qualification |
|---|---|---|
| Bubble S2 reflection and spike talent run in `damaged`, after HP, and miss cancelled dodge/block | Spike talent has a permanent ordinary injury observer; S2 owns a separate observer acquired on cast and removed on skill end. Both retain actual enemy-source/non-counter filters | [泡泡](https://prts.wiki/w/泡泡), native `bubble_s_2` / `bubble_t_1` event classifications recorded in tier1, and [伤判效果](https://prts.wiki/w/伤判效果): observation can continue after prior cancellation |
| Penance arms a WeakSet in early hit then reflects in `damaged`; a cancelled instance never reaches it | One permanent ordinary observer checks her own barrier before its -1000 absorption, including the breaking instance; no separate WeakSet/early listener | [斥罪](https://prts.wiki/w/斥罪): own-barrier condition and enemy-source reflection; [伤判效果](https://prts.wiki/w/伤判效果) and [事件](https://prts.wiki/w/事件) distinguish injury observation from success |

Both reflections directly select the actual enemy source (`ignoreSelect:true`), retain their amount/type/tag
contracts, and skip HP loss/gauge accumulation. Independent `credit` is not a reflection target. Six real-kit
regressions combine each kit with an earlier +3000 barrier, guaranteed dodge and native block; they require one
counter with zero target HP removal and no successful `damageApplied`. A separate Penance case verifies the own
barrier-breaking instance reflects once and the next unshielded instance does not. Other late counter kits still
require migration; this stage does not claim that all observers are fixed.

S32–S33 verification: the full engine/content run reports 3361 total, 3358 passed, zero failures and 3 skips
(`/private/tmp/attack-observer-areas.log`). Docs checks: 32 passed. The new counters/effects and existing
Penance/Bubble tests are included in that full affected-area run. No golden baselines were changed. Remaining
counter migrations include Nian, Hoshiguma alter, Mlynar's receiving aura, Vendela's protégé, Yu S1 and Philae S2;
each needs its correct acquisition/lifetime and source rules rather than a global late callback rename.

### S34–S35: self-owned counter lifetimes and output versus success

| Baseline behavior | New behavior | PRTS standard / limit |
|---|---|---|
| Nian S2, Hoshiguma alter S1 and Yu S1 listen to late `damaged`; earlier dodge/native block bypasses them | Each skill acquires its own ordinary `observeInjury` buff on cast and removes it on end. Actual enemy source and non-counter filters remain; source-less credit is not a target | [年](https://prts.wiki/w/年), [斩业星熊](https://prts.wiki/w/斩业星熊), [余](https://prts.wiki/w/余) explicitly directly select enemy damage sources; native event classifications are recorded in tier1. [伤判效果](https://prts.wiki/w/伤判效果) permits observation after prior cancellation |
| Hoshiguma alter AST-X incoming reflection listens to `damaged` | A permanent module-owned ordinary injury observer reflects even after prior dodge/block | PRTS 斩业星熊 module: enemy-source reflection, arts normal damage; ordinary priority in absence of an override |
| AST-X's attack extra damage waits for `damaged`, so a dodged/blocked primary instance can lose its output rider | The existing `damageCalculated` source output stage produces the separate arts rider before the primary target's injury effects | PRTS 斩业星熊 explicitly classifies this as output-damage checking with normal-attack/attached-damage, self-source and non-module conditions. This migration preserves the existing `isAttack` filter; complete attached-damage flag propagation still needs a separate caller audit |
| Nian PRO-X layer-break bonus polls shield count only on late `damaged` | `block` checks actual loss of her own layer, grants the same stacks/SP immediately; an unrelated earlier block consumes no own layer and grants nothing | PRTS 年 module gives a bonus per lost layer, independent of successful HP damage. This is extra module SP, not the basic skill hurt-SP policy under audit |

Yu S1 uses explicit `dealElementDamage` with the actual source as target, `ignoreSelect:true`, and counter tags;
it is gauge application, not HP damage. Its carried-skill taunt remains independent of active counter lifetime.
Yu S3's wall rider now uses positive `damageApplied` rather than re-filtering legacy `damaged`; its existing
positive arts-damage/source/crossing conditions are unchanged. Hoshiguma alter's outgoing module damage retains
its own tags and does not recursively produce another copy.

Real-kit regressions now cover six receiving-counter configurations with earlier +3000 dodge/barrier/block,
actual versus credited source, HP loss/gauge/counter exclusion, skill-end cleanup, Nian silence, Yu gauge gain,
and the independent AST-X incoming module effect. Two output regressions prove a primary physical dodge still
permits the arts rider, and a one-layer shield is consumed by the rider before the primary damage. Nian's module
case verifies unrelated cancellation grants nothing while each of her own three layers grants one bonus even
without successful HP damage. Focused affected-kit/counter suites: 110 passed, zero failures
(`/private/tmp/attack-self-observers-final-targeted.log`).

Source finding retained for the next audit: current PRTS 余 talent notes say its blocked-target pulse applies burn
gauge before arts damage. The existing talent loop still applies arts then gauge. S34 changes S1 observation only;
this newly observed order mismatch is not silently accepted or described as fixed.

Final S34–S35 area checkpoint: 3376 total tests, 3373 passed, zero failures, 3 skipped
(`/private/tmp/attack-self-observers-areas-final.log`). Docs: 32 passed; scoped changed-kit/counter-test lint:
zero errors and warnings. Full CI and a new golden measurement remain deferred until the migration audit finishes.

### S36–S37: receiving-unit counter ownership and continuous aura coverage

| Baseline behavior | New behavior | Source / qualification |
|---|---|---|
| Mlynar's global late `damaged` listener reflects for Kazimierz operators; it misses cancelled injury and has no receiver buff/acquisition position | Active receiving operators hold an ordinary source-owned injury observer. Continuous coverage keeps that instance; provider/receiver deployment or departure synchronizes coverage immediately | [玛恩纳](https://prts.wiki/w/玛恩纳): field-wide Kazimierz reflection, source is Mlynar, direct enemy-source selection; [伤判效果](https://prts.wiki/w/伤判效果): reflection is injury observation, including cancellation. Existing first-living-same-operator provider policy is retained and explicitly [ASSUMED] for multiple copies |
| Vendela stores a protégé at cast but listens globally to late `damaged`; after receiver redeployment its identity can start reflecting again without a new grant | A source-specific ordinary observer is granted to the cast-selected receiver and cleared on skill end/receiver departure. Redeployment alone does not recreate the cast-time grant | [刺玫](https://prts.wiki/w/刺玫): choose and grant at skill start, highest max HP then; receiver-owned effect uses normal buff removal on departure. The no-regrant conclusion follows that grant/lifetime model, not a claimed direct original-client redeployment experiment |
| Ending one Vendela skill unconditionally removes the shared taunt key even if another provider now owns it | Cleanup removes its own observer and removes taunt only if its recorded source is that provider | Source ownership must not make one provider remove another provider's current grant. Counter grants retain independent source keys; overlapping taunt composition otherwise retains the existing shared-key/latest-grant policy, not an asserted original-client stacking rule |

`shared/injury.js` now owns continuous injury-aura synchronization for Mlynar and Skadi's flat-reduction module:
deploy/death/skill changes, tick coverage, and same-tick pre-hit coverage. It reuses an existing held buff instead
of replacing its sequence on every refresh. Skadi's eligibility/range/per-type strongest reduction rules remain
unchanged. This shares lifecycle bookkeeping without merging game-specific target selection or damage arithmetic.

Both new receiving-counter callbacks retain actual enemy-source and counter/reflection exclusion rules, and directly
select that source. Vendela still names the receiver as `traitAlly`, so her counter's successful damage heals only
that ally; her ordinary damage retains the ordinary trait selector. Counter/trait-heal timing now occurs in injury
processing before the receiving instance changes HP. This follows the native injury/after-output sequence rather
than preserving a late-heal side effect as a compatibility rule. Mlynar's precomputed-damage classification from
PRTS is recorded; the existing true-damage arithmetic is retained here, while the engine's broader precomputed
event/source-modifier contract still requires completion of the calculation-stage audit.

Focused receiving-counter/affected-content/fidelity verification: 147 passed, zero failures
(`/private/tmp/attack-receiver-regressions.log`), followed by the overlapping-provider cleanup regression.
The historical nest test now counts eight injury attempts into the protected Hoshiguma rather than five successful
legacy notifications; all eight must trigger Vendela's answer, including three armor-blocked attempts. New
real-kit tests cover prior +3000 dodge/block/barrier, no HP success event, provider departure, continuous sequence
preservation, receiver redeployment, independent source/credit, loss/gauge/reflection exclusion, immediate Mlynar
provider handover and reacquisition, and source-specific Vendela cleanup.

S36–S37 area checkpoint: 3386 total, 3383 passed, zero failures and 3 skips
(`/private/tmp/attack-receiver-areas.log`). The dedicated receiver lifecycle/copy suite passes all 10 cases.
Docs: 32 passed. The first scoped lint exposed an unused Skadi talent binding; it was removed, with no behavior
change. Final scoped lint output is `/private/tmp/attack-receiver-lint-final.log`. No golden baselines were changed.

### S38–S41: native event evidence, Philae/Rmixer and Yu pulse order

Direct native evidence is now available: public extracted client data
[ArknightsGameResource at 9bf239661e37766fba585806fb9fa67e79bb679e](https://github.com/yuanyan3060/ArknightsGameResource/blob/9bf239661e37766fba585806fb9fa67e79bb679e/gamedata/battle/buff_template_data.json)
(snapshot commit dated 2026-10-09). The local file is `/private/tmp/attack-native-buff-templates.json`, SHA-256
`6786d60fa1f081346f7885a0a9782e201c942017588b09830afb011e16c6df3c`. Selected records are stored separately in
`/private/tmp/attack-native-selected-templates.json`. No extracted resources or generated tables are added to git.
HTTPS retrieval failed; a blob-filtered, non-checked-out SSH clone supplied only the requested JSON blob.

| ID | Baseline / previous prototype | New behavior | Native / PRTS standard |
|---|---|---|---|
| S38 | Philae S2 waits for late `damaged`; full cancellation hides injury. Rage waits until a positive gauge was already applied. Her arts counter unconditionally ignores dodge | S2 owns an ordinary injury observer, preserving cooldown and source-less trigger support. Rage uses the applying-gauge stage, including zero and a later blocked gauge. The blast uses ordinary dodge; its separate gauge rider still applies | `philae_s_2` has `ON_TAKE_DAMAGE` and `ON_APPLYING_MODIFIER`; `philae_s_2[ep]` applies MAGICAL damage with `_ignoreMissFlag:NONE` / `_ignoreCancelReasonMask:NONE`, then element damage. [菲莱](https://prts.wiki/w/菲莱) defines S2 counter/cooldown and S1 gauge barrier |
| S39 | Rmixer S3 counters only in late `damaged`; its successful-damage talent also reads the generic event | A skill-owned injury observer handles counters, including prior dodge/block, source-less injury and no target. Existing action/disarm/ammo/interval guards remain. T1 uses positive `damageApplied` | `rmixer_sk3.ON_TAKE_DAMAGE` calls `TriggerAbility` (ordinary branch checks ability flags); `rmixer_t1.ON_AFTER_OUTPUT_DAMAGE` is a separate success event. [信仰搅拌机](https://prts.wiki/w/信仰搅拌机) explicitly describes any-damage/no-target counters as normal attacks |
| S40 | Yu's blocked-enemy talent applies arts first, then burn gauge; that same pulse cannot use its own burst's RES reduction | Gauge first, then arts if the target remains alive. Arts instance explicitly carries MELEE route and DoT tag | [余](https://prts.wiki/w/余) talent note explicitly gives gauge-before-arts order and melee-route arts continuous damage |
| S41 | S24 ordinary-burst dodge was supported only by PRTS classification; apoptosis ticks had no explicit no-SP/DoT descriptor | Ordinary burst dodge remains the default, now backed by native configured flags. Operator/enemy apoptosis ticks carry `noSp:true` and DoT metadata; immediate burn keeps ordinary SP eligibility | `ep_break_water_char` / `ep_break_fire_char` use ordinary PHYSICAL/MAGICAL `NoSourceDamage`, no cancellation override and `_ignoreForSp:false`. Apoptosis child templates `periodic_magic_damage` / `periodic_element_damage` use BUFF damage and `_ignoreForSp:true` |

S41 supersedes the earlier claim that native burst flags were unavailable locally. The snapshot has no configured
dodge-cancellation override for those ordinary bursts. This is data-backed classification, not a claim that the
compiled native action implementation, timing/rounding or every caller has been reproduced. It does not settle
the separate basic skill hurt-SP policy: `modify_sp[take_damage]` is an ordinary ON_TAKE_DAMAGE buff template,
but seeing that generic template does not establish every skill controller's implementation.

Philae S1 now calls `healElement` with the actual gauge capacity instead of an arbitrary `1e12`; pre-calculation
talent/elemental-barrier ordering is retained. Her counter gauge rider retains its previous tags to avoid counting
one counter's HP damage and gauge application as two counter attacks. The preexisting project counter/reflection
loop filter remains qualified; no new global suppression rule is inferred from the native template.

New real-kit cases cover both skill observers after earlier dodge/block/full barriers, cooldown and skill-end
cleanup, Philae zero/later-blocked gauge rage, dodgeable blast with independent gauge rider, target-less Rmixer
ammo spending, and both actor classes' periodic no-SP versus immediate burn eligibility. Yu's regression forces
a burn burst and requires gauge → burst → arts order with the arts pulse using already reduced RES. Initial
test-only setup errors (an out-of-contact enemy and counting an empty-target counter solely by attack hooks)
were corrected; they are not accepted engine failures. Focused native-stage/element/solvent run: 45 passed,
zero failures (`/private/tmp/attack-native-flags-targeted.log`). The affected existing content/counter run before
those final flag fixtures passed 206 tests (`/private/tmp/attack-native-observers-targeted.log`).

### S42: native counter flags and AST-X skill conditions

The same pinned native snapshot gives `hsgma2_s_1` and `vendla_s_2[extra_damage]` ordinary MAGICAL/NORMAL
instances with `_ignoreMissFlag:NONE` and `_ignoreCancelReasonMask:NONE`; Vendela explicitly uses RANGED.
The previous implementation forced both counters to ignore dodge. They now use ordinary dodge, and Vendela
carries the actual ranged route independently of whether a projectile is animated.

Both `hsgma2_e_003_tr_output` and `hsgma2_e_003_tr_take` first check `CheckCharSkillAffecting`, with a fallback
for `hsgma2_s_3[before_dead]`. The baseline and previous prototype enabled both module branches even outside a
skill. The new implementation requires an active skill or the S3 dying mode. This supersedes the kit's earlier
[ASSUMED] no-skill-period interpretation; [PRTS 斩业星熊](https://prts.wiki/w/斩业星熊) describes the updated trait
but the native branch conditions resolve the period explicitly. Outgoing ADDITION versus incoming NORMAL
classification remains distinct: this correction does not change the outgoing rider's existing no-dodge behavior.
Normal-attack attached-damage propagation and source calculation-event suppression remain separate open audits.

Regression coverage verifies both dodgeable Hoshiguma alter counters, Vendela route/dodge, no module proc outside
a skill, and continued outgoing/incoming procs in the S3 dying mode. The existing every-form module test now
activates the skill explicitly instead of asserting the superseded always-on behavior. Targeted receiver/self
counter and Hoshiguma alter kit run: 48 passed, no failures (`/private/tmp/attack-native-counter-flags.log`).
The preceding S38–S41 complete engine/content checkpoint reported 3398 total, 3395 passed, 3 skips and no failures;
documentation checks passed 32 tests. Neither checkpoint is final CI or acceptance of changed golden baselines.

S42 complete affected-area verification: 3402 total, 3399 passed, 3 skipped, no failures
(`/private/tmp/attack-s42-areas.log`); scoped lint has no diagnostics and documentation checks pass 32 tests.
The import scanner lists exactly the same three `server/sim/nodeData.js` Node imports in both the independent
0.3.0 archive and this worktree. They are the documented/pinned Node-loader exception, not a clean-zero scanner
result (`attack-s42-imports.log`, `attack-v030-original-imports.log`; `test/check-imports.test.js` pins the list).

A fresh complete probe against unchanged 0.3.0 baselines now reports **58 changed scenarios**: 21 roster, 5 bonds,
12 fields, 10 matches, 2 standins and 8 DIY. Digests and differences are preserved separately as
`/private/tmp/attack-s42-v030-digests.json` and `attack-s42-v030-diffs.json`. This supersedes the pre-S31 count of
43 for current comparison; no stored golden has been updated. First-divergence tracing completed against this exact
code state (`/private/tmp/attack-s42-v030-first.json` and `.log`) before further gameplay edits. The larger count includes later native-observer and flag/skill-condition
corrections and is not accepted merely because those corrections have focused passing tests.

Examples from the refreshed first-instance trace (full scenario attribution remains open):

- `roster-001` at 28.8 s has identical incoming input, HP and RNG and removes 262.02 HP in both engines, but the
  final HP is 2680.805925 old versus 2598.48 new. The receiver has Vendela S2: her counter trait heal formerly
  ran after HP removal and now runs at injury observation before that removal (S36). Likewise `roster-002`,
  `bond-deputShip-high` and the `coop2-NORMAL-8-serverrun` match first differ in post-call HP while the triggering
  damage amount is unchanged. These are observable event-timing effects, not floating-point dust.
- `diy-051` starts with a 744.7 physical attack; both primary results remove 37.235 HP, but old final enemy HP is
  38783.189 versus 38842.765 new. The 59.576 difference is the prior always-on AST-X rider removed outside skill
  time (S42); source/target HP and RNG are identical before this first instance.
- `roster-016` at 76 s applies Yu's 94.0368 burn gauge before his 313.456 arts input in the new path, reversing the
  old order (S40). A linear call trace sees the gauge in the old arts slot: that is call reordering, not gauge being
  treated as HP damage. The independent pulse-order fixture asserts the actual sequence and burst/RES interaction.

A nested replay of `roster-001` confirms the timing explanation directly
(`/private/tmp/attack-s42-vendela-detail.json`): old Vendela trait healing restores 82.325925 after the
262.02 loss; new healing attempts the same amount while the receiver is still full and restores zero. A separate
50-base heal restores 55.5 after the injury in both engines. A new full-HP receiver fixture locks that order;
receiver tests now report 12 passes (`attack-s42-vendela-timing.log`). Production code is unchanged since the
58-scenario probe, so that test addition does not invalidate its measurements.

Remaining enemy-shield inventory: `ab.hitShield` still cancels in early `onHitIn`, produced by
`enemy_1249_lysdb_2` and the regeneration aura. Native `enemy_lysdb[damage_block_once]` and
`enemy_lysdb[damage_block_fixed]` explicitly use ordinary-priority ON_TAKE_DAMAGE and PHYSICAL/MAGICAL filters.
Moving these into injury effects needs to resolve the existing boss-cap interaction first:
`test/sim/playtest6_limits.test.js` currently asserts aura shield consumption before the cap, while generic
barriers run after it. That existing assertion is a project contract, not independent proof of the original
mode's cap event priority. Do not silently rewrite that test from the template priority alone.

### S43: enemy count shields share the native injury path

| Old | New | Native / PRTS standard |
|---|---|---|
| Rhine defence personnel and regeneration aura store `mem.ab.hitShield`; `onHitIn` cancels before formula/other injury effects, consuming its own count even before an earlier barrier | One `ab:hitShield` buff stores the phys/arts `shieldHits`. Stronger grants update the held instance without changing its sequence; ordinary injury order and zero/cancel continuation apply | Native `enemy_lysdb[damage_block_once]` / `[damage_block_fixed]` use DEFAULT ON_TAKE_DAMAGE with PHYSICAL or MAGICAL BlockDamage. [PRTS 莱茵生命防卫科高级成员](https://prts.wiki/w/莱茵生命防卫科高级成员) / [假想敌：再生](https://prts.wiki/w/假想敌：再生) specify phys/arts count shields |
| Boss_10's aura shield consumes a charge before the mode cap, unlike generic HP shields | The existing pre-injury cap now preserves both count and HP shields on an over-limit instance | **[ASSUMED]** The old research 11 explicitly assumed before-HP-shields/after-count-blocks; it did not establish original call order. Native shield priority establishes its injury stage, but not the separate mode manager's relative call position. The common pre-injury policy removes the unsupported count-shield-only exception |

`grantHitShield` reuses the shared buff representation and depletion lifecycle; the separate ability-state counter
and early engine branch are removed. No proxy getter or second synchronized shield counter is introduced.
The helper retains the existing strongest-count policy for overlapping grants; that overlap policy is inherited,
not a newly verified original-client stacking result. Depletion keeps the previous shield-break FX, while early
full absorption/dodge avoids consuming a layer. Typed HP loss, gauge fill, true and elemental HP damage bypass
the phys/arts-only shield.

Targeted real-enemy, regeneration/transform and boss-limit run: **328 passed, zero failures**
(`/private/tmp/attack-enemy-native-shields.log`). New cases check earlier barrier/block/dodge preserving the count,
later observer continuation, no successful-damage event on absorption, type/loss/gauge filters, stronger/weaker
regrants preserving the exact instance, and no later dodge draw after shield absorption. The boss-limit fixture
now explicitly asserts the shared [ASSUMED] cap order and proves an under-limit hit still consumes the preserved
layer. This test is a regression for the chosen policy, not evidence that native cap order was discovered.

### S44: Penance's empty barrier retains its lifetime and acquisition position

Old and previous prototype behavior removed the shield-only buff when its amount reached zero. A later kill/S3
then created another instance with a later acquisition sequence. [PRTS 斥罪](https://prts.wiki/w/斥罪) explicitly
states a single -1000-priority buff whose amount is replenished; running out removes only absorption, not the
buff. Native `judge_t_1` likewise keeps its dynamic pool, removes only `judge_shield[mark]` at zero, and handles
later ON_TARGET_KILLED gains in the existing host.

The shared buff descriptor now supports `keepEmptyShield`; ordinary shields keep their default depletion-removal
behavior. Penance opts in, so a later gain updates the same instance. Normal expiry/removal/deployment lifecycle
still owns the buff: this is not the separate `persist` flag and does not carry her barrier across withdrawal.
The zero pool does not report a shield in the snapshot (positive amount/count still controls that indicator).

New engine coverage distinguishes `(100 - 10) × 0.5 = 45` before and after refill, proving the retained shield
stays before a later same-priority multiplier; replacing it would instead yield `100 × 0.5 - 10 = 40`.
The actual Penance fixture checks empty identity, kill refill, removal on withdrawal and a new instance on
redeployment. The previous S43 affected-area checkpoint passed 3404 tests with 3 skips (3407 total), plus 32
documentation checks. Its scoped lint had no errors and three preexisting/deprecation warnings; an unused import
introduced by retiring the old test state reference was removed.

S44 focused engine/counter/Penance validation: **60 passed, no failures** (`attack-empty-barrier.log`).
Documentation checks pass 32 tests. Scoped lint has no errors and one preexisting unused-import warning in
`buffs.js` (`attack-empty-barrier-lint.log`); no default barrier lifecycle is changed.

### S45: source calculation, target calculation and output are separate

The previous `damageCalculated` event was after formula/source multipliers; calling it calculation could confuse
it with the original ON_CALCULATE_DAMAGE. It is renamed `damageOutput`, including the Hoshiguma alter module's
ON_OUTPUT_DAMAGE observer. No compatibility alias is added for this unreleased prototype-only hook.

| Old / previous prototype | New | Native / PRTS standard |
|---|---|---|
| Only early `hit` and post-formula `damageCalculated`; resolved input still enters the latter and the name does not identify an output stage | Source `damageCalculate` → target `damageCalculateTarget` → formula/source arithmetic → `damageOutput`. Base input runs both calculation hooks; precomputed skips source calculation; resolved skips both plus mitigation/source multipliers. Output remains distinct | [PRTS 伤害分类](https://prts.wiki/w/伤害分类) distinguishes precomputed and post-calculation damage, and explicitly separates calculation-event omission from absence of mitigation. Native source/target calculation events are independently named |
| Logos T2 marks only `isAttack` inputs in early hit, and target arts addition also runs in early hit, even on resolved damage | Mark creation runs on source calculation; the held mark's addition runs on target calculation and does not re-add to resolved damage. Lexicon child explicitly uses precomputed input | `logos_t_2` is unqualified ON_CALCULATE_DAMAGE; `logos_t_2[core]` is ON_BEING_CALCULATE_DAMAGE and its AtkAdditionUpBeforeCalcDamage filters MAGICAL. Lexicon AdvancedApplyDamage nodes explicitly `_emitSourceOnCalculateDamage:false` |
| S1's inherited-HP arts follow-up cannot acquire its own T2 mark because it is not `isAttack` | Normal source calculation marks the new target, so the existing 165 addition applies before RES to that follow-up | `logos_s_1.FixedValueDamage` explicitly `_triggerOnCalculateDamage:true`. The T2 source template has no normal-attack filter. This differs from its source-less execution and lexicon children |

The existing every-form S1 fixture exposed the intentional difference: its normal T5 follow-up is now
605.748 instead of 440.748, exactly +165 before RES. The fixture now requires the new target's mark and the
form's `atk_addition`, rather than weakening the numerical assertion. The new engine fixtures independently
exercise source/target/output order for all three policies, source-less target calculation, precomputed attacks
not acquiring the mark, precomputed arts using an existing mark, and resolved arts avoiding the addition.

These event policies do not automatically classify all legacy `hit` listeners or every precomputed caller.
The legacy delivery hook remains separate; its remaining source modifiers and hit-count units still require
classification before claiming complete original-game event equivalence. Native Logos S1 also configures an
ignore-cancel mask for execution; its block-versus-dodge policy is a separate pending audit, not resolved by
this calculation-stage change. Lexicon's native elemental child uses ordinary dodge flags, so its previous
forced dodge bypass is removed alongside its explicit source-calculation policy.

S45 focused calculation/native-counter/Logos/Hoshiguma alter verification: **88 passed, no failures**
(`attack-calculation-stages-final.log`). Complete affected engine/content run: **3414 total, 3411 passed,
3 skipped, zero failures** (`attack-s45-areas.log`). Documentation checks pass 32; scoped lint and the project
JSDoc TypeScript slice report no diagnostics (`attack-s45-lint.log`, `attack-s45-types.log`). These are intermediate
checks, not final full CI.

A fresh full comparison after S43–S45 reports **87 changed scenarios** against unchanged 0.3.0 baselines:
23 roster, 8 bonds, 15 fields, 11 matches, 3 standins and 27 DIY. Artifacts are
`/private/tmp/attack-s45-v030-digests.json`, `attack-s45-v030-diffs.json` and `attack-s45-v030-probe.log`.
The earlier 58-scene count belongs to S42. The count increase is not blanket accepted: native count-shield
migration now exposes legacy zero-damage observers that used to be skipped by early cancellation, so those
callers' original source/target/output/success events require classification. No stored golden file is changed.

An additional open boundary is directly visible in the current code: hit-count units still replace the amount
with one before mitigation/output, and `official-damage-numbers.test.js` explicitly expects a displayed one.
[PRTS 假想敌：再生](https://prts.wiki/w/假想敌：再生) explains that special HP handling changes the final HP delta,
not the damage itself; damage-based healing/gauges still use the actual damage. The engine must separate the
damage amount from the HP decrement rather than preserve that old early replacement. The arts-only tea filter
and legacy `damaged`/stats/return contracts require their own explicit assertions during that migration.
This is identified remaining work, not a completed or verified fix.

The complete first-instance trace for all 87 S45 differences finished successfully
(`/private/tmp/attack-s45-v030-first.json`, `attack-s45-v030-first.log`). In `diy-029` (the Logos lineup), at
102.7 s the same 1395.9205 arts input into an unmarked `enemy_1061_zomshd` removes 1395.9205 old versus
1560.9205 new: exactly the newly enabled +165 target-calculation addition (S45). This is concrete numerical
first-divergence evidence, not attribution of every later digest field.

`diy-026` first differs at 4.1 s on the same Typhon input: 949.9 versus 968.8 HP, with a new earlier
`narant:stolen` buff containing DEF -21. The native inventory gives Naran Tuya's stealing effect
`narant_t_1[steal]` / `narant_e_t_1` an ON_BEFORE_TARGET_APPLY_MODIFIER event. It must be classified at that
actual stage rather than guessed to be a successful-damage event just because its old listener uses `damaged`.
Several newly differing scenes have no significant dealDamage call difference at all; their notification/status
and snapshot effects still need separate tracing before any baseline acceptance.

### S46: special HP changes the final HP delta, not the damage amount

| Baseline / previous prototype | New | PRTS standard / qualification |
|---|---|---|
| Hit-count units replace damage with 1 (or 0) before formula/source/output and run a separate injury path with target modifiers disabled | All HP damage uses the ordinary formula/output/ordered-injury/HP-guard path. Shared HP application alone maps a positive accepted instance to one HP; damage notifications retain the actual amount and `hpRemoved` records the separate delta | [PRTS 游戏数据基础](https://prts.wiki/w/游戏数据基础) and [假想敌：再生](https://prts.wiki/w/假想敌：再生): special HP does not alter damage; damage-derived healing/gauges use its actual value |
| A 1000 barrier absorbs only 1 from a 200 arts input into a hit-count target; a full early barrier bypasses ordinary formula/output | The same 200 arts input against 20 RES consumes 160 barrier and spends no HP count while fully absorbed | Barriers absorb damage before the final HP change. [缇缇](https://prts.wiki/w/缇缇) distinguishes injury modifiers from special HP when determining incantation healing |
| Tea accepts every HP type except physical, including elemental | Tea's HP rule accepts arts and true only; physical and elemental HP instances retain their computed damage but do not decrease its special HP | [PRTS 青瓷茶器](https://prts.wiki/w/青瓷茶器) explicitly limits acceptance to arts/true. Gauge damage still does not decrement HP |
| Display fixture expects the early rewritten 1 even for 1000 true damage | The common event reports 1000 damage while the API returns 1 HP removed | The code retains its existing [ASSUMED] display mapping from settled damage to number; no direct original-client number/colour experiment is claimed |

The separate hit-count fast path and injury `modifiers:false` option are removed. Internal shared bookkeeping is
named `applyHpDecrease`, avoiding the implication that ordinary damage becomes the public HP-loss operation.
Original descriptor identity, source/credit, fatal/kill handling, actual-HP statistics and return values remain
shared. Damage-oriented `amount` and actual `hpRemoved`/`hpChanged.delta` intentionally differ on these targets.
A positive fraction also costs one accepted hit; an amount reduced to zero or cancelled before HP application
costs none. The type restriction is a final HP rule, not a new block/dodge cancellation.

Independent regression: `200 × 0.8 RES × 2 source × 1.5 target − 50 barrier = 430` damage, one HP removed,
215 incantation healing and 43 gauge damage. Additional cases verify full-barrier consumption, earlier dodge,
accepted/rejected types, positive fractions, zero instances, original descriptor and independent kill attribution.
Targeted special-HP, number, robustness, profession and real-enemy run: **336 passed, zero failures**
(`/private/tmp/attack-special-hp-targeted.log`). The existing tea expectation is changed from elemental acceptance
to explicit rejection; the number fixture retains its numerical assertion with the actual damage amount.

HP loss keeps its existing separate final-amount behavior, outside the ordinary hit-count damage mapping.
**[ASSUMED]** The interaction of SKIP_MODIFIER_EVENT loss with every native special-HP class is not settled by
the general PRTS wording or the available buff templates; this stage does not claim a native experiment proving
that inherited policy. Full source/event equivalence and changed-golden attribution are still open.

S46 complete affected-area checkpoint: **3418 total, 3415 passed, 3 skipped, zero failures**
(`attack-s46-areas.log`); documentation checks pass 32. Scoped lint has no errors and two preexisting unused
`eslint-disable` warnings in `robustness.test.js`. The API/number/special-HP run after the internal-helper rename
passes 30 tests (`attack-special-hp-final-targeted.log`). That rename initially omitted the legacy adapter import;
it was corrected before these passing runs, not accepted as a runtime limitation.

An independent replay of the exact same fixture in the clean 0.3.0 archive and the new engine records:

| Metric | 0.3.0 | S46 |
|---|---:|---:|
| API actual HP removed | 0 | 1 |
| Target HP (initial 10) | 10 | 9 |
| Remaining barrier (initial 50) | 49 | 0 |
| Damage notification amount | 0 | 430 |
| Incantation healer HP (initial 1000) | 1000 | 1215 |
| Elemental HP damage accepted by tea | 1 HP | 0 HP |

Script and result: `/private/tmp/attack-s46-special-hp-comparison.mjs` / `.json`. This comparison imports each
checkout's own production harness and modules; it does not call the old oracle through new-engine callbacks.
The 430/215 expectations are also independently asserted by arithmetic in the new regression.

The fresh full probe after S46 reports **92 changed scenarios** against unchanged 0.3.0 goldens: 26 roster,
8 bonds, 16 fields, 12 matches, 3 standins and 27 DIY (`attack-s46-v030-digests.json`, `attack-s46-v030-diffs.json`,
`attack-s46-v030-probe.log`). The former 87-scene count is S45 evidence. No golden file has been modified;
first-instance traces are refreshed again before further gameplay edits.

### Native audit evidence first identified at S46

- `tinman_t_2` uses ordinary ON_TAKE_DAMAGE, filters attack type BUFF and applies DamageScale. Current Tinman
  instead tests string tags in early `hit`, altering the pre-DEF input. The same native snapshot's
  `tinman_s_2[buff]` / `tinman_s_1[dot]` use MAGICAL/BUFF NoSourceDamage with no cancellation override. Current
  S46 kit S2 named Tinman as actual source and forced dodge bypass; S48 implements the corrected damage path. [PRTS 锡人](https://prts.wiki/w/锡人) explicitly
  states alchemy units cache attributes and deal source-less damage. This is a concrete next caller for explicit
  attack-type classification, source/credit separation and ordered injury modifiers; its existing regen remains
  a recovery attribute.
- [PRTS 逻各斯](https://prts.wiki/w/Logos) now explicitly describes S1 execution's independent no-cancel rules
  for dodge, block and hit failure. In particular full shield absorption can consume the layer/pool while failing
  to cancel; partial HP-barrier reduction is still effective. Native `logos_s_1.NoSourceDamage` lists MISS,
  BLOCKED, BLOCKED_WITH_DAMAGE_NUMBER and HIT_FAILED. The S46 dodge-only policy could not implement that
  block distinction. S47 below implements the three supported reason groups; this was not behavior claimed
  implemented by S45/S46.

The S46 first-instance tracing run completed for all 92 changed scenarios
(`/private/tmp/attack-s46-v030-first.json`, `attack-s46-v030-first.log`). At 29.9333 s in `roster-026`, the same
source/target/HP/RNG produces gauge input 0.1 old versus 112.43375 new: the old rider used the early rewritten
one, while the new rider uses actual damage. In `hidden-boss_8-pair` at 70.0667 s the analogous source-gauge
input is 0.22 old versus 1173.97104 new against the same 13-HP hit-count target.

`roster-008` and `roster-013` have identical dealDamage call traces despite differing digests, so event-number
and notification fields still need their own attribution. The newly differing full match `coop2-NORMAL-3`
first shows an already-existing Vendela timing difference at 40.4 s; that first call alone does not prove why
S46 now changes the final match digest. No full-match attribution or baseline acceptance is inferred from it.

A tracked-file source snapshot preserves this checkpoint separately in `/private/tmp/stronghold-damage-s46`,
with dependency linkage only. Archive `/private/tmp/attack-s46-checkpoint.tar` SHA-256:
`9845f02dd4c62876fff30e329c1072768c55d6a48de6091cfb08dd19cd57df8d`.
It provides an independent prior-stage source tree for subsequent differential work without changing branch
history or accepting golden files. The retained original 0.3.0 archive remains the final baseline oracle.

### S47: cancellation reasons are independent of damage type and dodge skipping

The previous Logos S1 request used source-less true damage with `canDodge: false`. This skipped ordinary
physical/arts dodge, but a count shield or a fully absorbing barrier still stopped execution. Early accuracy
handlers and Tippi's special dodge wrote `cancel` directly, so they could not respect reason-specific immunity.
The new request uses `source: null`, separate Logos credit and `ignoreCancelReasons: ['dodge', 'block', 'miss']`.
A common cancellation helper preserves an actual `missed` result even if its cancellation is counteracted.

[PRTS 游戏数据基础](https://prts.wiki/w/游戏数据基础#伤害机制) distinguishes cancellation from zero damage:
block cancellation immunity still spends shield counts/pools, while partial barrier absorption still reduces
the amount. Dodge cancellation immunity attempts the effect; ignoring dodge skips it. Accuracy cancellation
immunity does not erase the attack's actual miss. [PRTS 逻各斯](https://prts.wiki/w/逻各斯) describes S1's
9999999 source-less true execution and its single attempt on survivors. The pinned native
`logos_s_1.NoSourceDamage` template supplies `MISS, BLOCKED, BLOCKED_WITH_DAMAGE_NUMBER, HIT_FAILED`.
The project maps the two block reasons to `block` and the dodge-related reason to `dodge`; this is a small
supported policy, not an assertion that every native cancellation reason is implemented.

Generic full shields now consume resources and restore the amount entering that shield when block cancellation
is counteracted. Partial barriers keep their reduction; subsequent flat reductions can still produce zero.
Custom `injury.block()` callbacks keep their successful attempt return value, allowing charge consumption even
when cancellation is rejected. Block/dodge events include `cancelled: false` in that case. Explicit
`dodgeMode: 'ignore'` takes precedence over the dodge cancellation mask and skips the attempt.
Invulnerability, ordinary unrelated `dmg.cancel` and the mode's single-hit refusal remain effective.

Ascalon, Narant, Crownslayer and stand-in Raidian's accuracy handlers now use the helper. Their attack-ID caches still perform
one draw per attack; Ascalon's own miss-heal still occurs once per missed attack. This does not reclassify her
sourced DoT or change its attack-event exception. Tippi still activates S2 and restarts her damage timer,
but her special dodge now respects skipped attempts and rejected cancellation. Attempt visuals retain the
project's existing emission behavior; their precise original-game rendering is not claimed verified.

Focused new regressions: **26 passed, zero failures** (`attack-cancel-policy-real.log`), covering the initial three
real accuracy handlers, Tippi's three dodge modes, Logos execution against count/full/partial barriers and
special HP, resource consumption and unaffected refusal. Earlier combined generic/Logos tests passed 58.
The final Raidian/cancellation run passes **39 tests** (`attack-s47-accuracy-final.log`), including two
additional real stand-in accuracy/cache cases. A raw-cancellation search found this fourth handler after the
first area run; status immunity, gauge immunity and independent damage refusal are not relabelled as misses.

Independent production-harness comparison against clean 0.3.0 uses a 10-HP enemy, real Logos S1 and these
barriers (`/private/tmp/attack-s47-execution-comparison.mjs` / `.json`); every run reports zero engine errors:

| Protection | 0.3.0 result | S47 result | Shared resource effect |
|---|---|---|---|
| One count shield | Survives at 10 HP; damage notification 0 | Dies; notification 9999999 | One layer consumed |
| Pool 10000000 | Survives at 10 HP; notification 0 | Dies; notification 9999999 | Pool reduced to 1 |
| Pool 40 | Dies; notification 9999959 | Dies; notification 9999959 | Pool emptied |
| Special hit-count HP | Survives at 9 HP; notification 1 | Survives at 9 HP; notification 9999999 | No barrier; S46 amount/HP distinction |

No golden baseline is accepted by this checkpoint. The retained `missed` marker is available to later
miss-sensitive riders; this stage does not claim all such content listeners have been audited.

S47 final area verification (including Raidian): **3446 total, 3443 passed, 3 skipped, zero failures**
(`/private/tmp/attack-s47-final-areas.log`). Documentation checks pass 32 tests. Scoped S47 lint and the
additional Raidian lint report no diagnostics; checked-JS typechecking exits zero. These are intermediate
checks, not final CI.

The final independent golden probe still reports **92 differences** against unchanged 0.3.0 baselines
(`attack-s47-final-v030-digests.json` / `-diffs.json` / `-probe.log`). S47 changes three already-different
scenarios relative to the preserved S46 snapshot. The initial and final S47 digests are byte-equivalent as
parsed JSON; adding Raidian's helper migration does not change these golden scenarios.

- `roster-004`: every digest field except the dodge-hook counter is unchanged from S46; that counter rises 0→3.
- `roster-006`: the same isolated counter changes 3→8. Tippi now emits actual dodge-attempt events, previously
  absent from her special handler. These are event-reporting differences, with no HP/RNG/call-trace difference.
- `coop2-NORMAL-1-unowned-roster`: at 29.8667 s, skullshatterer's physical 456.7992 instance explicitly has
  `canDodge: false`; Tippi has the same 1985.5 HP and RNG state before both calls. S46 cancels it in her special
  handler; S47 respects the skipped dodge and removes 22.83996 HP (the 5% formula floor). Full first-call
  evidence is in `attack-s47-stage-first.json` / `.mjs`; this identifies the new causal divergence, not a claim
  that the entire match's downstream changes have been individually attributed.

The 92 baseline differences still require the broader outstanding attribution audit before acceptance.

### S48: explicit attack type and source-less Tinman alchemy damage

The preceding public request could express HP/gauge type, source/credit and delivery route, but not native
attack type. It now accepts `attackType: 'NONE' | 'NORMAL' | 'SPLASH' | 'BUFF' | 'ADDITION'`, defaulting to
NORMAL independently of descriptive tags. This field does not imply an attack behavior, damage source,
calculation stage or dodge policy. Legacy normalization alone infers BUFF from the previous dot/necrosis/
apoptosis markers (or SPLASH from its old splash flag); explicit values win. A pre-existing normalized
object keeps identity and can still use that fallback. This fallback is a compatibility convention, not a
claim that arbitrary legacy tags prove native class. Native `attackType` is distinct from the existing
`isAttack` behavior and legacy `isSplash` main/secondary-hit marker. New callers should set the native field.
Necrosis and both actor classes' apoptosis ticks now set BUFF explicitly; instantaneous bursts remain NORMAL.

The pinned native `tinman_t_2` uses DEFAULT ON_TAKE_DAMAGE with a BUFF-only FilterDamageModifier and
non-stacking DamageScale. `tinman_s_2[buff]` and `tinman_s_1[dot]` use MAGICAL/BUFF NoSourceDamage,
`cached_atk`, no cancellation override and `ignoreForSp: false`. [PRTS 锡人](https://prts.wiki/w/锡人)
confirms cached ATK, source-less alchemy damage that outlives the caster, a BUFF-only non-stacking talent
which also persists after departure, and S2's attribute-based regeneration. [PRTS 伤害分类](https://prts.wiki/w/伤害分类)
identifies cached-ATK damage as precomputed; target mitigation still applies.

| Detail | 0.3.0 behavior | S48 behavior / original standard |
|---|---|---|
| Alchemy S1/S2 damage source | Tinman; live source multipliers/penetration can alter cached input | `source: null`, `credit: Tinman`, cached ATK, precomputed BUFF arts; ordinary target-side calculation/mitigation |
| Alchemy dodge | Forced `canDodge: false` | Ordinary eligibility; native cancellation mask is NONE |
| Talent amplification | Global early `hit`, tag filter, multiplies the pre-DEF input | Held buff's ordinary injury position, explicit BUFF filter, post-mitigation scaling |
| Repeated/overlapping talent | Each pulse replaces one keyed buff; last copy wins | One held copy per zone; refresh retains acquisition position; strongest active copy applies once and weaker copies resume on expiry |
| Damage after departure | Zone persists but still consults its source's current damage attributes | Same cached source-less input before/after departure; separate credit remains available for stats/kills |

S2's recovery remains an ATK-cached `hpRegen` attribute, not ordinary healing. Existing pulse cadence,
landing approximation and range-coverage refresh timing are retained; their client-exact timing is not
established by these damage templates. In particular S2's talent currently bridges one-second zone pulses
with a 1.05-second buff; immediate removal on leaving the radius was an identified coverage item, resolved for talent/regen in S49.
No source-unsettled timing should be inferred faithful merely because the damage-class fixtures pass.

Independent old/new production-harness results are recorded in `/private/tmp/attack-s48-comparison.mjs` / `.json`.
With 100 physical input, 50 DEF and talent ×1.22, old damage is **72**, new is **61**: `(100−50)×1.22`.
With cached ATK 461, S2 scale 0.8, target RES 30, a live source-only ×3 multiplier and 100 flat RES penetration,
old first-pulse damage is **1349.808** and drops to **314.9552** after the source dies. New first/after-death
damage is **314.9552** in both cases (`461×0.8×0.7×1.22`); every new instance has null actual source and
Tinman credit. All comparison runs have zero engine errors.

Focused existing/API/type-class verification passes **127 tests** (`attack-s48-targeted.log`). The final dedicated
attack-type suite passes **12 tests**, including an added unequal-strength overlap/expiry regression
(`attack-s48-final-targeted.log`). The preceding complete engine/content run passed **3454**, skipped 3,
failed 0 (3457 total; `attack-s48-areas.log`); that run preceded the one additional strongest-copy fixture.
Checked-JS typechecking exits zero. Scoped lint has zero errors and one pre-existing unused import warning in
`kits_t1t2.test.js`; the new attack-type suite has no diagnostics.

The full golden probe remains **92 changed scenarios** against unchanged upstream 0.3.0 baselines
(`attack-s48-v030-digests.json` / `-diffs.json` / `-probe.log`). Only `roster-005` and `roster-006` differ from
the preserved S47 snapshot. No golden baseline has been updated or accepted.

Stage comparisons use the independently preserved `/private/tmp/stronghold-damage-s47` source snapshot,
archive `attack-s47-checkpoint.tar` SHA-256
`81fac581f31962db5ab1d1ab5121e56310fa02859ff0286fa13f076afa9c9ac7`.
The first-instance traces (`attack-s48-stage-first.json`, `-numeric.json`, `-output.json`) identify:

- `roster-005`, 19.0333 s: equal initial HP, RNG, 408.2364 raw arts and 204.1182 HP removal, but source changes
  from Tinman to null. The old source-only element rider then adds 20.41182 gauge; that rider is absent in S48.
- `roster-006`, 29.7667 s: equal raw 738.3376, initial HP and RNG. The old Tinman talent first raises input to
  900.771872; source-dependent weakness conversion chooses physical, producing 500.771872. S48 keeps the
  source-less arts classification, applies 60 RES and then ×1.22, producing 360.3087488. Output instrumentation
  confirms old `type: phys` and new `type: arts`; the global weakness hook requires an actual source.

These are concrete stage-level divergences. Full downstream match/golden acceptance remains a separate gate.
Documentation verification passes 32 tests (`attack-s48-docs.log`).

### S49: alchemy-unit coverage and lifetime own their held effects

S48 corrected damage classification but still attached talent amplification for 1.05 seconds at each S2 pulse
(or 0.3 seconds at each S1 refresh) and S2 regeneration for one second plus two ticks. Leaving the radius
could retain those effects, entering between pulses could miss them, and regeneration refreshes repeatedly
replaced its buff. The alchemy-unit counter also stopped at the last scheduled damage pulse rather than the
end of the declared lifetime.

The new zone-owned coverage controller holds each talent/regen buff while its target is currently covered,
removes it on exit, and acquires a new instance on re-entry. Continuous coverage retains the acquisition
sequence. Overlapping units retain separate regeneration buffs and independently expiring talent copies.
The controller and its expiry timer have no caster owner, so departure does not clear the unit; declared
lifetime expiry removes its buffs, unregisters its hit/tick handlers and decrements the active-unit counter.
The existing damage pulse count/cadence remains separate from the zone's lifetime. S1 and S2 share this
coverage/lifetime implementation; their distinct damage, regeneration and weaken behavior remains explicit.

[PRTS 锡人](https://prts.wiki/w/锡人) limits the talent to ground enemies inside the alchemy unit, states
that it can continue after Tinman's departure, and limits S2's regeneration attribute to its radius and
lifetime. Native `tinman_s_2[buff]` creates a derived regeneration buff with
`_finishDerivedBuffIfParentFinish: true`. The controller now models that parent/child lifetime relationship.
The project still approximates landing as instant and synchronizes coverage on ticks and before a hit;
original-client projectile travel and selector polling timing are **[ASSUMED]**, not verified equivalent.
S1's existing 0.25-second weaken-status refresh is a separate status-composition path, not silently claimed
fixed by the talent/regen coverage change.

The dedicated suite passes **18 tests**, including six new real-kit coverage/lifetime cases
(`/private/tmp/attack-s49-targeted.log`). Cases cover both skills' exit/re-entry before the next damage pulse,
new acquisition ordering after re-entry, live talent after caster death through the declared last second,
expiry of buffs and owner-less handlers, S2 regeneration through healing prohibition and departure, and
separate expiry of overlapping regeneration buffs. The initial existing type-class/tier-1/tier-2 run passed
106 tests. Scoped lint and checked-JS typechecking exit zero with no diagnostics.

S49 complete engine/content verification: **3464 total, 3461 passed, 3 skipped, zero failures**
(`/private/tmp/attack-s49-areas.log`). After Tab formatting and explicit timing-assumption comments, the
focused type/tier-1/tier-2 run passes **112 tests** (`attack-s49-final-targeted.log`), and scoped lint still
has no diagnostics. Documentation checks pass 32 tests. This is not final full CI.

An independent S48/S49 production-harness comparison (`attack-s49-coverage-comparison.mjs` / `.json`)
measures 122 BUFF damage inside both units, **122 old versus 100 new outside**, and 122 again on re-entry.
The old buff identity survives the excursion; the new instance is reacquired. Regeneration outside is
present old / absent new. In the declared last second, the active-unit counter is **0 old / 1 new**.
Every comparison run reports zero engine errors. The preserved S48 source is
`/private/tmp/stronghold-damage-s48`, from `attack-s48-checkpoint.tar` SHA-256
`51e53fde5e390c92d1056d550c9146db5d96423be86b6b3c6a4b062cb9327eb2`.

The fresh full probe still reports **92 differences** against unchanged 0.3.0 baselines
(`attack-s49-v030-digests.json` / `-diffs.json` / `-probe.log`). Only `roster-006` changes from S48:
its 599 damage calls, HP/RNG traces and final unit/enemy results are identical, while SP-gain events fall
19739→19730 and snapshot hashes differ. Independent SP-event instrumentation
(`attack-s49-sp-comparison.mjs` / `.json`) isolates the module condition: at 41.5667 seconds, equal incoming
0.0333333 and prior SP 0.3433333 produce **0.0333333 old / 0.0366667 new**, with active-unit counter **0 / 1**.
The module bonus now lasts for the remaining declared lifetime, filling the bar sooner; Tinman's own SP-gain
notifications fall 3029→3020, accounting for the full nine-event reduction. No golden baseline is accepted.

### S50: verify current upstream source semantics before migrating historical fixes

The current 0.3.0 item implementation already handles carrier damage (including sourced DoT, skills and
splash) through `onDamageEnemies`, a guarded damage notification. Its `item-damage-procs.test.js` explicitly
requires poison to proc normal/golden tear gas and unmelted ice without another `attack` behavior event.
Historical isolated commit `9de7dc1d` used an earlier attack-event workaround for #489; that historical patch
is not the current upstream contract. A first attempted port failed four existing item tests because it
added an attack event. The port was withdrawn; no baseline generated by that attempt is accepted.

Final behavior retains the current upstream event distinction. Death Sentencing ticks now use the explicit
request with actual Ascalon source (and default Ascalon credit), `attackType: 'BUFF'`, `applyWay: 'MELEE'`
and the retained ignore-dodge policy. They do not emit an attack event or become ordinary attack damage.
The pinned native `ascln_t_1[debuff]` uses `DamageViaAttr` with `BUFF_SOURCE`, MAGICAL, BUFF and MELEE;
[PRTS Ascalon](https://prts.wiki/w/Ascalon) identifies the talent as arts sustained damage, based on her
current ATK and ending on departure. Neither page alone proves an extra project attack event; sourced
carrier-damage effects are already represented by the upstream item path. Ascalon must not be made
source-less merely because the damage is BUFF, just as source-less Tinman damage must not acquire
Tinman's source-dependent effects merely because it retains his credit.

The normalized legacy `canDodge` view now follows an explicit `dodgeMode` (`ignore` false, normal/
uncancellable true), and only falls back to the old flag when no mode is supplied. This keeps old content
and plugin readers consistent with the explicit policy. A new conflict-precedence test checks all three
modes. Existing item regressions now also assert actual source, credit, BUFF/MELEE classification and the
non-attack flag. The corrected focused item/Ascalon/API/cancellation/classification run passes **84 tests**
(`/private/tmp/attack-s50-final-targeted.log`). The failed initial full-area output
`attack-s50-areas.log` and initial `attack-s50-v030-*` probe predate the correction and are draft evidence,
not validation of this final stage.

A parser-based inventory now records **396 static registrations** across `server/sim/` in
`/private/tmp/attack-s50-listeners.json` (script `attack-listener-inventory.mjs`): hit 145, damaged 112,
hpDamage 8, source/target calculation 1 each, output 1, applied 3, attack 34, beforeAttack 58, dodge 5,
block 1 and heal 27. It includes the three named hit/damaged wrappers and records callback text/hashes.
It excludes dynamic event names and SkillSpec callbacks, and includes wrapper definitions as well as
uses; these counts are an audit index, not proof that all native timings are correct.

One concrete next migration is supported by native templates: `zuole_t_2`, `zuole_s_3` and `zuole_trait`
use ON_OUTPUT_DAMAGE, not ON_AFTER_OUTPUT_DAMAGE. Their current legacy success-looking callbacks must
be evaluated at output (before target injury), not mechanically renamed to `damageApplied`. This native
counterexample rules out a blanket source-listener migration based on callback names or positive HP loss.

Corrected S50 full affected-area verification: **3465 total, 3462 passed, 3 skipped, zero failures**
(`attack-s50-final-areas.log`). Scoped lint and checked-JS typechecking report no diagnostics; docs pass 32.
The fresh corrected full golden probe (`attack-s50-final-v030-*`) still has **92 differences** against
unchanged 0.3.0 baselines. Its computed digests are identical to S49 across every family/scenario, confirming
that the explicit Ascalon metadata/normalization changes do not move these 288 scenarios. This does not
accept the older 92 differences or substitute for the final full CI/golden gates.

### S51: source output is earlier than target injury and HP settlement

Native `zuole_t_2` uses ON_OUTPUT_DAMAGE for its ordinary SP chance. Its stage-3 Y-module replacement
`zuole_e_003_talent` instead uses ON_CALCULATE_DAMAGE for both SP and the attack scale. `zuole_s_3`
creates/charges its barrier at ON_OUTPUT_DAMAGE. Native `helage_trait`, `utage_trait`, `akafyu_trait` and
`zuole_trait` heal on ON_OUTPUT_DAMAGE and do not filter BUFF attack type. [PRTS 左乐](https://prts.wiki/w/左乐)
explicitly places Musha healing at each output, and [PRTS 事件](https://prts.wiki/w/事件) places source output
before target dodge/block/reduction. These are not success-after-HP triggers.

| Detail | S50 behavior | S51 behavior |
|---|---|---|
| Base Zuole SP chance | Legacy `damaged`: absent on dodge; after injury on full absorption | Positive computed source output, before target injury |
| Y-module scale/SP | Early generic `hit`, even for precomputed/resolved requests | Source calculation only; skipped by precomputed/resolved damage |
| S3 barrier gain | Legacy `damaged`; absent on dodge, too late for target injury observers | Each source output gains its barrier before target injury |
| Held S3 barrier | Replaced at each gain, reacquiring the injury position | Native EXTEND behavior: update the pool, cap/lifetime on the held instance |
| Musha trait heal | Legacy post-HP notification; ignores all talent/dot/periodic tags by assumption | Source output before dodge/barriers; no generic BUFF exclusion |
| Weakness conversion stage | Late generic `hit`, before the newly separated Y-module calculation | Source `damageCalculate`, after default-priority source scaling; skipped by precomputed/resolved damage |

S3's native existing-pool branch first writes the dynamic pool, then creates the same shield with override
EXTEND. Updating the existing instance is therefore required to retain acquisition order; refilling must
still cap downwards when current maximum HP decreases. S3 continues suppressing its ordinary trait heal.
The retained relative priority of trait healing (-10 after kit output callbacks) remains **[ASSUMED]**;
the templates establish event stages, not the client's full initial buff-acquisition sequence. Tests at the
half-HP boundary preserve that stated project order rather than claiming native priority proof.

The weakness event move is necessary for consistency: leaving conversion on `hit` would choose its type
before the Y-module's now-correct source-calculation scale. [PRTS 伤害分类](https://prts.wiki/w/伤害分类) places
weakness conversion at ON_CALCULATE_DAMAGE. The existing weakness arithmetic (including its theoretical
factor selection and Logos target-addition handling) was a separately identified audit item, resolved in S52; S51
fixed the stage dependency without claiming that full formula audit.

Independent prior-stage/current production-harness fixtures (`attack-s51-comparison.mjs` / `.json`, using
preserved S50 source `/private/tmp/stronghold-damage-s50`) show:

- Base T2, guaranteed target dodge: old trait heal 0 / SP gain 0; new heal **70** / SP gain **1**, one roll.
- Full barrier: both eventually heal 70 / gain 1 SP, but only the new target injury observer sees those
  source effects already applied. This isolates timing rather than only comparing final numbers.
- Y-module precomputed 100 physical input: old damage **120** / SP gain 1; new damage **100** / SP gain 0,
  with the ordinary output heal still 70.
- Seven guaranteed-dodged S3 slashes (normal tier-6 form): old barrier **0**, new barrier **1225**; neither
  heals. Ordinary S3 slashes retain the same final 1225 pool, but the new observer sees one stable held
  barrier position rather than replacement between slashes. Every fixture reports zero engine errors.

The focused native-stage/garrison/Musha/API verification passes **92 tests** (`attack-s51-final-targeted.log`).
The first full area run exposed one old regression expecting no heal on a dodged hit or BUFF damage; that
expectation followed the old generic assumption and contradicts the cited source-output templates. It was
updated to assert one heal per output before dodge, while retaining negative cases for HP loss and gauges.
The full-area failure log `attack-s51-areas.log` precedes that corrected source-based test. Scoped lint now
has no diagnostics; the touched profession helper imports `isHpLoss` from attack helpers instead of the
retained deprecated oracle. Checked-JS typechecking exits zero.

Corrected full engine/content verification passes **3477**, skips 3 and fails 0 (**3480 total**;
`attack-s51-final-areas.log`). Documentation checks pass 32. The fresh full golden probe remains **92 changed
scenarios** against unchanged 0.3.0 (`attack-s51-v030-*`); only `coop2-NORMAL-14-standins` differs from S50.
No baseline is accepted. The preserved S50 archive `attack-s50-checkpoint.tar` has SHA-256
`dad3629c7f62c22f7b64b41031abdd541365bb9de634c6a3822b8239547370e1`.

The independent full-match stage trace (`attack-s51-stage-first.json`) first sees an API-call timing change
for elite Utage against Lucien, 4.8667 old / 4.9 new, with equal damage input, target HP, RNG and HP removed.
Additional source-HP/heal/attack instrumentation (`attack-s51-utage-trace.mjs` / `.json`) isolates the earlier
cause: at 3.1667 seconds, the same output is dodged in both runs (zero HP removed). Old Utage remains at
**1984.7 HP**, while new output healing raises her to **2054.7 HP**. Before the next attack, her existing
HP-dependent talent gives ASPD **216.0076358 old / 213.2971679 new**, intervals **0.5555359 / 0.5625954**.
After the subsequent outputs this produces the one-tick attack delay at 4.8667 / 4.9. This explains the new
stage divergence through output healing and the existing HP→ASPD feedback, rather than misattributing it
to the nominally identical target-damage values. It does not accept all earlier changes in that full match.

### S52: weakness theory and actual target ATK addition share pure arithmetic

[PRTS 伤害分类](https://prts.wiki/w/伤害分类) explicitly limits weakness's theoretical physical/arts
comparison to the attack input/scales, target ATK addition (Logos), DEF/RES and penetration. It excludes
source damage multipliers, all target injury effects and HP rewrites, and does not trigger extra calculation
events. S51 still included source phys/arts dealt multipliers and target type-taken multipliers, and could
not see Logos's addition before choosing a type.

S52 removes those multipliers from `weaknessType`. The existing attack input already includes ATK scales:
normal `resolveHit` multiplies ATK by the profile attack scale and `atkScaleMul`, and source-calculation
callbacks have already run before weakness selection. Multiplying that input again would be wrong.
The unused legacy `DamageInfo.atkScale` metadata is now omitted from the modern request type rather than
advertised as an additional arithmetic input; old descriptors retain it unchanged.

Logos's strongest target mark now exposes its current value as the derived additive mod
`artsAttackAddition`. A pure `attackInput` helper combines this post-attack-scale/pre-RES value with the
instance input. Weakness theory uses that helper without changing the instance or firing hooks. Actual
target calculation applies it once after the target-calculation callbacks and before mitigation; resolved
damage skips it, while precomputed damage still receives it. The old global once-installed Logos target
callback is removed. This shares the mathematical input without hard-coding Logos into the garrison engine
or speculatively executing arbitrary target callbacks. Existing mark duration, strongest-value fallback,
RES reduction and source-calculation acquisition remain on the target buff.

| Interaction | S51 | S52 / PRTS restriction |
|---|---|---|
| Source type-dealt and target type-taken multipliers favor arts | These can change weakness's chosen type | They change actual damage after the choice, not the theoretical comparison |
| Logos mark changes arts input | Actual arts hit receives it, but weakness compares without it | Both use the same addition; it is applied only once to the actual instance |
| ATK scales already folded into amount | They are present in the input | Kept as-is; no extra descriptor/source multiplier is applied |
| Speculative physical/arts comparison | Pure mitigation, but wrong factor set | Pure allowed-factor calculation; one source/target event pair for the real instance |

Independent S51/S52 production-harness results (`attack-s52-comparison.mjs` / `.json`) show two numerical
counterexamples, all with zero engine errors and exactly one source and one target calculation event:

- Raw 100, DEF 10, RES 50: theory is physical 90 versus arts 50. With source physical ×0.1 / arts ×10 /
  overall ×5, target arts ×10 / overall ×2 and instance damage scale ×20, old chooses arts and applies
  **1000000**; new chooses the native theoretical winner physical and applies **1800**. The lower actual
  outcome is intentional: weakness does not optimize damage after those excluded factors.
- Raw 100, DEF 25, original RES 80 and a real Logos mark (+165 input / −10 RES): old chooses physical
  and applies **75**; new compares physical 75 against arts 79.5 and applies **79.5**. A precomputed zero
  arts input still becomes 165 before 70 RES (49.5); a resolved input remains unchanged. Removing the mark
  restores zero derived addition and the physical choice.

The focused Logos/garrison/native-stage/number run passes **61 tests** (`attack-s52-targeted.log`). Tests
also hold flat physical reduction and a physical barrier without letting those effects change the choice.
Checked-JS typechecking exits zero. Scoped lint has zero errors and one existing unused-import warning in
buffs.js; both HEAD and this worktree contain exactly one reference to that imported COLD_FREEZE_DURATION.

Full affected-area verification passes **3479**, skips 3 and fails 0 (**3482 total**;
`attack-s52-areas.log`). Documentation checks pass 32. The fresh full golden probe remains **92 differences**
against unchanged 0.3.0 (`attack-s52-v030-*`). Only `coop2-NORMAL-3` and `coop2-NORMAL-14-standins` change
from the preserved S51 snapshot, archive `attack-s51-checkpoint.tar` SHA-256
`1de78b2472c18ae7b049a1eecfbb7e837de68fc9412d21e2b2af9efa8b3553f5`.

Stage input/output/stat traces (`attack-s52-stage-first.json`, `attack-s52-stage-output.json` and scripts)
identify the same excluded factor in both full matches: target `bond:arcaneShip` artsTakenMul.

- `coop2-NORMAL-3`, 25.2667 s: equal input **1943.271**, target DEF **100**, RES **20**, HP and RNG. Old
  selects arts by including target ×1.36, producing **2114.278848**; new theoretical physical **1843.271**
  exceeds theoretical arts **1554.6168**, so the new output is physical **1843.271**. Target injury still
  exists; it simply no longer influences the type choice.
- `coop2-NORMAL-14-standins`: at 14 s, equal input **645.7**, DEF **0**, RES **20**, and target arts ×1.27
  cause old arts output **516.56** versus new physical **645.7** before injury. Both remove the same remaining
  **586.8144 HP** on that overkill, hiding the type change from an HP-only trace. At 25.3667 s, against the
  same later target HP/RNG, the corresponding unclamped old/new removals are **656.0312 / 645.7**.

These traces attribute the new stage-level changes to excluding target injury from weakness theory.
No golden baseline has been modified or accepted; earlier full-match differences still require the broader audit.

A separate TypeScript compiler probe (`attack-s52-request-typing.mjs`, `attack-s52-typecheck.mjs`) verifies
modern requests accept precomputed input and reject the unused atkScale literal, while legacy DamageInfo
still accepts that metadata. An expected-error directive guards the negative case; the probe reports
**request typing diagnostics: 0** (`attack-s52-request-typing.log`). This supplements the checked-JS slice;
it does not claim all implementation files or external plugins are typechecked.

### S53: Reaper admission and healing are separate source-output stages

[PRTS 隐德来希](https://prts.wiki/w/隐德来希), branch notes, specifies output-triggered healing,
a 0.05 s window capped by block count, and 0.12 s between individual heals. Her operator-specific remark
excludes her continuous damage. [PRTS 圣约送葬人](https://prts.wiki/w/圣约送葬人) shares the branch rules.
The pinned native buff table cited in S51/S52 confirms the distinction: `excu2_trait`, `highmo_trait` and
`humus_trait` create `heal_fake` on ON_OUTPUT_DAMAGE without an attack-class filter; `etlchi_trait` first
negates FilterDamageModifier attackType BUFF. This is a kit exception, not a profession-wide DoT exclusion.

Native `heal_fake` has a 0.05 s lifetime, sets its stack count from block number on start, and admits a
heal stack on trigger. The separate `heal` buff stacks without a fixed maximum, has 0.12 s trigger interval,
and FixedValueHeal ignores healFree. Both set waitFirstTriggerInterval=false. These fields support distinct
admission and delivery stages; they do not establish the original client's exact scheduler phase.

| Detail | S52 / old path | S53 |
|---|---|---|
| Normal attack | `attack` notification immediately heals one combined value | Each positive source output requests a separate heal; no bare-event heal |
| Other output | Legacy `damaged` success notification, excludes dot/necrosis/apoptosis | `damageOutput`, before target dodge/barriers; no generic BUFF filter |
| Admission cap | Same-time counters; attack aggregation and other damage use separate paths | One 0.05 s window, initial block count shared across eligible output kinds |
| Delivery | Immediate / combined | Individual queued heals with 0.12 s deadlines |
| Entlechia | Generic tag exclusion | Explicit native BUFF filter in her kit |
| Lifecycle | No pending queue | Death/deployment clears pending delivery and admission state |

[ASSUMED] First delivery occurs at the next existing simulator scheduler phase, without adding a wait interval;
later deadlines are quantized to 30 Hz. Each admission snapshots the current trait heal value. Native pending
stack inheritance when a skill changes that value, exact first-phase ordering, and idle timer restart behavior
are not established by these data. Existing owner timer/victory policy is retained; this audit does not prove
that pending heals at the end of battle are flushed by the original client. Relative trait callback priority
remains -10 as qualified in S51. These limitations must not be advertised as original-client frame equivalence.

Independent preserved-S52/current harness (`attack-s53-comparison.mjs` / `.json`) demonstrates:

- Two outputs at 0.033333 s, another at 0.066667 s, then two at 0.1 s produce old **five** heals (250 total),
  versus new **four** (200): adjacent ticks inside the 0.05 s admission window share its cap. New deliveries
  occur at 0.033333, 0.166667, 0.3 and 0.433333 s in this external-call fixture, after scheduler advancement.
- Two subsequently dodged outputs produce old zero heals versus new two 50-point heals.
- A bare attack event produces old one combined 100-point heal versus new none.
- Excu2 BUFF output produces old none versus new one 50-point heal; Entlechia BUFF remains excluded in both.
- All independent fixtures report no engine errors. No original-client timing comparison is claimed.

Thirteen focused cases cover shared windows, block 0/1/3, serial delivery, dodge/full barriers, non-damage and
source-less credit, explicit class versus tags, real Excu2/Entlechia kits and death/redeployment cleanup.
Existing profession/Entlechia tests now advance through admitted deliveries before checking totals. Final
focused tests report **141 pass, 0 fail** (`attack-s53-final-targeted.log`); full engine/content area tests report
**3495 total, 3492 pass, 3 skipped, 0 fail** (`attack-s53-final-areas.log`). These are intermediate checks.

The independent final golden probe reports **103** differences against unchanged 0.3.0: 31 roster, 12 bonds,
18 fields, 12 matches, 3 standins and 27 DIY (`attack-s53-final-v030-diffs.json`). No golden is accepted or updated.
The final zero-wait first-phase version has identical complete digests to the earlier S53 probe. Relative to
S52, 24 scenarios change (`attack-s53-stage-diffs.json`):

- Roster: 004, 005, 013, 014, 015, 019, 023, 032, 033, 038, 042, 043.
- Bonds: indomShip-high, investShip-high, raidShip-low, raidShip-high.
- Fields: boss-boss_1-solo, boss-boss_3-pair, boss-boss_5-pair, boss-boss_5-solo,
  boss-boss_7-solo, hidden-boss_9-pair, hidden-boss_9-solo.
- Match: solo-ABYSS-2. No standin or DIY changes relative to S52.

Per-call traces (`attack-s53-stage-first.json`) find first damage-call HP divergence in fourteen of these.
For example roster-014 at 19.2 s retains the same 31.0023-point incoming hit but target Excu2 starts at
1087.8150417 old versus 907.8150417 new HP; roster-032 at 19.9667 s has the same 16-point hit but Entlechia
starts at 3617.72262 old versus 3667.72262 new HP. Admission and delivery can reduce or increase survival HP;
there is no blanket assertion of a healing buff. Roster-023 first differs in incoming damage at 24.2333 s
(53.22408 versus 62.4), showing healing-dependent defensive feedback.

The other ten have identical damage API calls/results/RNG in this trace. Field-level digest comparison
(`attack-s53-stage-fields.json`) distinguishes their changes: roster-005/015, investShip-high, raidShip-low/high
and boss-boss_5-solo/boss-boss_7-solo change only heal hook counts; roster-013 adds heal event/count differences;
roster-019 and boss-boss_1-solo also change snapshots. Thus an unchanged damage trace is not evidence of an
unchanged golden or identical end state. Full attribution of pre-existing differences remains a completion gate.

S53 final scoped lint reports no diagnostics, scoped type checking reports no diagnostics, documentation
checks pass **32/32**, and `git diff --check` passes. The source checkpoint before this validation note is
`/private/tmp/attack-s53-checkpoint.tar`, SHA-256
`8630e30c6d26e84a92f7c81c443726d9f21a1428faf1ec96e645d66a047555b2`.
Final CI, migration audit and acceptance of gameplay/golden changes remain pending.

### S54: successful source damage replaces Incantation Medic's ambiguous notification

[PRTS events](https://prts.wiki/w/事件) identifies ON_AFTER_OUTPUT_DAMAGE as successful source damage,
distinct from output before injury. Pinned native `vendla_tr`, `reed2_tr` and `titi_tr` register their healing
on that event. AssignDamageValueToBlackboard sets `_assignRealDelta: false`, `_assignValueWithoutCalculate:
false`, and a `scale` key; it does not request actual HP removed. Vendla/Reed additionally gate IsDamage.
Their native selectors preserve targeted S2 healing; the existing traitAlly contract models that distinction.
PRTS's event page explicitly qualifies its ordering as a reference; this stage does not claim full native
fatal/kill callback ordering. Its successful-heal callback remains before the existing legacy damaged event,
within shared HP bookkeeping, and after the engine's existing fatal handling.

S53 listened to legacy damaged, which deliberately also reports HP loss and zero instances, and rejected
both element gauges and elemental HP damage by name. S54 uses damageApplied's positive ordinary-HP-damage
contract. This removes local type/amount/null-descriptor checks, excludes HP loss and retains true elemental
HP damage. Source-less credit still cannot trigger a source trait. Vendla's identical kit-specific installer
is removed; the default profession trait already handles her named S2 ally and module heal ratio.

Independent S53/current harness results (`attack-s54-comparison.mjs` / `.json`):

| Request | HP removed | Old heal | New heal |
|---|---:|---:|---:|
| 100 true HP loss | 100 | 50 | 0 |
| 100 elemental HP damage | 100 | 0 | 50 |
| 100 ordinary true damage | 100 | 50 | 50 |
| 100 damage, hit-count target | 1 | 50 | 50 |
| 100 damage, 40 shield, 10 remaining HP | 10 | 30 | 30 |

All comparison fixtures have no engine errors. Fifteen new focused cases include real Vendla and the shared
profession, typed physical/arts/true loss, gauges, source-less attribution, all four HP damage types, BUFF
output, dodge/full shields/flat-to-zero, named ally, overkill and special HP. Initial real-Vendla assertions
incorrectly omitted her 11% highest-max-HP ally healing talent; the fixture expectation now includes it,
while independently asserting exactly one trait heal. No production multiplier was changed to satisfy it.

Focused existing/new tests pass **154/154** (`attack-s54-final-targeted.log`). Scoped lint reports no
diagnostics (`attack-s54-lint.log`). Complete independent golden digests are identical to S53
(`attack-s54-v030-digests.json`): still **103** differences against unchanged 0.3.0, none newly introduced
by this migration, none accepted. Final engine/content area tests pass **3507**, with **3 skips**,
**3510 total** (`attack-s54-final-areas.log`); documentation checks pass **32/32** and diff whitespace checks
pass. An initial area invocation supplied directory names unsupported by this Node test runner and loaded no
tests; the reported result comes from the corrected explicit test-file glob invocation. These shipped scenarios do not exercise the corrected synthetic loss /
elemental source combinations, so unchanged goldens cannot prove those fixes; the independent fixtures do.

### S55: Logos CCR-Δ uses successful arts damage rather than typed HP loss

[PRTS Logos](https://prts.wiki/w/逻各斯) lists the Δ module's arts-to-necrosis trait. The pinned native
template `logos_e_002_tr` specifically registers ON_AFTER_OUTPUT_DAMAGE, filters MAGICAL damage, assigns
its damage value with `_assignRealDelta: false` and `_assignValueWithoutCalculate: true`, multiplies by
`ep_damage_ratio`, then applies sourced DARK element damage to MODIFIER_TARGET. It does not filter attack
class, so sourced BUFF arts output remains eligible; credit without an actual source does not qualify.

The old legacy damaged listener accepts typed arts HP loss. The new damageApplied listener excludes it by
contract, allowing local positivity/gauge checks to disappear. This is an event-specific migration, not
an assertion that every remaining Logos/gear source listener belongs to this phase.

Independent preserved S54/current production harness (`attack-s55-comparison.mjs` / `.json`) confirms:

| Request | HP removed | Old gauge fill | New gauge fill |
|---|---:|---:|---:|
| 100 arts HP loss | 100 | 8 | 0 |
| 100 arts, 40 shield | 60 | 4.8 | 4.8 |
| 100 arts, special hit-count target | 1 | 8 | 8 |
| 100 arts, 10 remaining HP | 10 | 0 | 0 |
| 100 source-less arts, Logos credit | 100 | 0 | 0 |

All independent fixtures report no engine errors. Existing elementDmg / gauge `hasHp` rules still reject
killing-blow riders. The first new overkill test incorrectly expected a gauge fill on that corpse; inspection
identified the existing policy, and the expectation was corrected without changing production gauge behavior.
This stage preserves that policy; it does not establish the native dead-target selector from the Δ template alone.
Eight new regression cases cover loss, gauges, source-less credit, dodge/full/partial shields, overkill and
special HP. The complete Logos suite passes **23/23** (`attack-s55-final-targeted.log`); scoped lint reports
no diagnostics. Final engine/content area verification reports **3518 total, 3515 pass, 3 skipped,
0 fail** (`attack-s55-final-areas.log`); documentation checks pass **32/32**. Complete golden digests equal S54 (`attack-s55-v030-digests.json`), still 103 unaccepted
0.3.0 differences and no newly affected scenarios.

CCR-Y's separate normal-attack SP listener remains under audit. PRTS states that Lexicon can trigger it,
but the Δ template does not establish the generic Y module's event/filter, and its native class must not
be inferred solely from the old isAttack flag or a logosLexicon tag. No Y behavior was changed in this stage.

### S56: red classification follows actual ordered damage, not a barrier-free prediction

[PRTS combat mechanics, red damage numbers](https://prts.wiki/w/作战机制#伤害红字（暴击）) compares final
damage against a penetration-free expected value. Post-calculation buffs, absorption and final rewrites
are omitted from that expectation; actual HP loss may still differ through special HP, overkill or undying.
The old/new inherited classifier used all target multipliers before shields and hpDamage guards, leaving
red marks even when the final damage was below threshold.

The new pipeline keeps expected arithmetic but compares it after ordered injury and hpDamage guards.
Special-HP mapping and actual HP delta still do not replace that damage basis. A successful cancelling dodge
reports its current ordered amount to the display callback; the callback no longer reruns mitigation or reads
source stats for a hypothetical result. Later multipliers cannot make an earlier dodge appear to have stopped
a red hit. Non-cancelling attempts do not display MISS, though their existing generic dodge effect remains
[ASSUMED] presentation policy. Removed the now-unused calculateDamage wrapper and source-stat peek.

Independent S55/current harness (`attack-s56-comparison.mjs` / `.json`) preserves HP results, event counts and
RNG while changing only display fields:

| Fixture | Old | New |
|---|---|---|
| 100 input, source ×2, fragile ×2, pool 300 | 100 damage, red | 100 damage, ordinary |
| 100 input, source ×2, final hpDamage guard sets 1 | 1 damage, red | 1 damage, ordinary |
| Dodge before later fragile ×2 | MISS text | Generic dodge without MISS |
| Fragile ×2 before dodge | MISS text | MISS text |

Both dodge fixtures draw once in both versions; no extra damage/hook replay occurs. The independent
uncancellable fixture has ordinary damage and no MISS in both versions; the new focused regression separately
uses penetration to make its hypothetical hit red and verifies that landing damage does not display MISS.

Four display regressions were added and the prior pre-rewrite-red expectation corrected. The first area run
also caught the original-oracle differential fixture expecting old red marks after a partial barrier. It now
checks the new mark against independent fixture arithmetic and compares every HP, attribution, barrier,
callback and remaining wire field with the original engine across all 72 cases. No original module was edited.
The focused suite passes **64/64** (`attack-s56-final-targeted.log`). Complete golden digests equal S55
(`attack-s56-v030-digests.json`), still 103 unaccepted upstream differences: the golden summary counts events
and hashes state, so unchanged digests do not prove unchanged individual wire payloads. The independent wire
fixtures above establish the intended display changes.

Final engine/content area verification reports **3522 total, 3519 pass, 3 skipped, 0 fail**
(`attack-s56-final-areas.log`); scoped lint has no diagnostics, documentation checks pass **32/32**,
and whitespace checks pass. These are intermediate results, not final CI acceptance.

Remaining qualifications: cached-ATK expectation metadata, baked attack-scale distinctions, forced-red/blue/BLOCK
styles and invulnerable zero-number emission remain the explicitly documented pre-existing presentation limits
in calculation.js/hit.js. This stage does not claim those fields were added. Boss-cap ordering remains the
S43 [ASSUMED] pre-injury policy because no stronger mode-specific ordering evidence has been obtained; it is
now explicitly independent of red classification rather than a supposed final-damage prediction.

### S57: consolidated scenario evidence, without accepting golden movements

[The per-scenario audit](13-settlement-golden-audit.md) and its JSON inventory preserve all 103 current
0.3.0 differences. Stage-digest provenance is explicitly association, not full causal attribution. A refreshed
current-versus-clean-0.3.0 damage-call trace covers all 103 scenarios (`attack-s56-first.json`): 80 show a
significant call/HP/RNG difference; 23 do not. Field-level comparison separates 75 scenarios with other
summary fields, 17 with counts/snapshots only and 11 with counts only. A no-call-delta result does not imply
unchanged healing, HP loss, events or snapshots. Causal review remains pending except the isolated diy-010 projection finding in the linked audit.

The follow-up eight-event notification trace covers the 23 no-call-delta scenes. Its first differences
include Reaper delivery timing, Musha output healing before legacy notification, special-HP amount metadata,
and additional zero-valued barrier notifications. diy-010 remains identical even with hit events included;
full snapshot comparison isolates only shield flags/layers (first t=4, flags 0→32 on unit 17). The native
count-shield migration exposes a real held shield through snapshot.js. That scene is attributed as projection
only; exact original rendering and all other pending causal reviews are not inferred from it. Evidence is
preserved in the linked JSON, with full temporary traces hashed in its companion document.

No golden file was modified. Remaining causal review must use the mechanism ledger and exact scene evidence;
changing a summary or finding the first differing call alone does not establish fidelity of the entire match.
The source-evidence inventory deliberately preserves these gaps instead of treating green area tests as
permission to regenerate baselines. Architecture guidance now points engine changes to attack.js/attack/.

### S58: Narant steals after calculation but before target injury (2026-10-17)

[PRTS Narant](https://prts.wiki/w/娜仁图亚) specifies per-attack stealing, independent per-source caps and
strongest enemy reduction; X module adds a second steal within the surrounding eight tiles. Native pinned
`narant_t_1[steal]` and `narant_e_t_1` register ON_BEFORE_TARGET_APPLY_MODIFIER, gate IsDamage / live target,
then trigger ATK and DEF steal abilities with checkCanUseAbilityFlag=false. The elite template repeats both
inside range x-4. The original stage is before target injury, not ON_AFTER_OUTPUT_DAMAGE; simply migrating
the old listener to damageApplied would remain wrong.

A sourced damageBeforeApply phase now follows calculation/output and precedes ordered target injury.
It carries context plus mutable amount and honors cancellation/deployment guards. Attribute changes do not
rerun the already completed formula; target injury sees the new held state. Base, precomputed and resolved
sourced HP damage reach it; HP loss, gauge fill and source-less attribution do not. Boss-limit refusal follows
it under the separately qualified S43 mode ordering. Relative source callback ordering uses the existing
registration/priority contract; exact original-client scheduling is not claimed.

Narant's attack eligibility, strongest loss maps, independent caps, range repetition and departure cleanup
remain. Only the event moves; the live-target gate is explicit. The existing per-attack gate represents the
attack-bound steal ability, not a claim that arbitrary non-attack output receives a native projectile buff.
She now steals on a hit subsequently dodged or blocked. Her new source ATK/target DEF cannot change this
already computed hit, but nested injury observers/counters can see those updated attributes.

Independent S57/current production harness (`attack-s58-comparison.mjs` / `.json`):

| Fixture | S57 | S58 |
|---|---|---|
| First 1000 physical input versus 300 DEF | 700 HP; injury sees loot 0, DEF 300 | 700 HP; injury sees loot 27, DEF 279 |
| Next same input | 721 HP | 721 HP |
| Target physical dodge | 0 HP, no steal | 0 HP, steals 27 ATK / 21 DEF |
| Count shield | 0 HP, injury sees old stats; steal later in damaged | 0 HP, injury already sees stolen stats |
| Physical HP loss | 700 HP, no steal | 700 HP, no steal |

All independent fixtures report no engine errors. The old regression explicitly required that dodged hits
steal nothing; that expectation is corrected using the native event, not preserved as an intended rule.
Four new real-kit cases verify normal/dodge/shield ordering and non-damage/non-attack/source-less exclusions.
Four phase cases verify base/precomputed/resolved event order, no formula replay, mutable amount and
cancellation preserving target defenses. The focused suite passes **36/36** (`attack-s58-final-targeted.log`).
The initial area run before the last four phase-only cases reports **3526 total, 3523 pass, 3 skipped, 0 fail**
(`attack-s58-areas.log`). Final current-area verification reports **3530 total, 3527 pass, 3 skipped,
0 fail** (`attack-s58-final-areas.log`); final scoped lint has no diagnostics and docs pass **32/32**.

Complete recomputed golden digests equal S56 (`attack-s58-v030-digests.json`): 103 differences against
unchanged 0.3.0, no newly differing scene, no baseline acceptance. The S56 scenario inventory remains a
historical trace checkpoint with equal summary values, not proof that every internal callback is unchanged.
This migration resolves the Narant event audit identified by S45 without claiming that the first differing
call in diy-026 alone attributes every downstream scene change.

S58 architecture cost checkpoint: attack.js plus its nine internal modules total **907 lines**, including the
26-line adapter, versus clean 0.3.0 damage.js **669**. The retained deprecated oracle adds **693** lines
(including annotations), giving **1600** lines while both engines coexist. These include comments and are
not a complexity score. The evidence supports clearer operation/event ownership and removal of specific
caller inversions/duplicate implementations; it does not support a smaller core or cheaper overall migration.
A final value verdict must weigh those benefits against the additional phase vocabulary, compatibility surface,
changed scenarios and remaining unclassified listeners. This is still a prototype checkpoint, not merge readiness.

### S59: reject an unproven common item success-phase migration

[PRTS mode records](https://prts.wiki/w/卫戍协议：盟约/PRTS盟约记录) explicitly corrects the descriptions of
催泪瓦斯 / 谢拉格不融冰 from attack-triggered to damage-triggered. This establishes damage eligibility,
not their exact native callback order relative to other effects. Mode/version-specific probabilities and
durations continue to come from the existing generated records; this experiment did not replace them with
numbers from another mode's page.

The shared onDamageEnemies helper already requires positive sourced damage, an enemy with remaining HP,
no gauge and no HP loss. An experimental move from legacy damaged to damageApplied removed redundant
filters and passed 105 focused tests plus 3555 area tests (3 skipped). Independent S58/experiment harness
(`attack-s59-comparison.mjs` / `.json`) runs 24 cases (both items, both qualities, six eligibility fixtures):
HP removed, probability draws and eventual statuses match in every case. However, a low-priority success
observer sees the proc earlier: old [damageApplied:false, damaged:true], new [damageApplied:true, damaged:true].
This is a real ordering change, not merely a shorter predicate.

The complete experimental probe (`attack-s59-v030-digests.json`) changes seven scenario digests relative
to S58: roster-040; solo-NORMAL-1, solo-HARD-1, solo-ABYSS-1, coop4-ABYSS-7, coop2-NORMAL-70-diy and
coop2-NORMAL-5-coverage-diy. Five were previously equal to the upstream baseline; the unaccepted upstream
difference count rises from 103 to 108. These include actual killed/RNG/match-result changes, not just trace
counters. No available native item template establishes that the new relative order is correct. Passing area
tests and PRTS's general damage-trigger wording therefore do not justify accepting this migration.

**Decision: withdraw the production move.** The common helper retains its old notification, guards and owner
registration order. [ASSUMED] That exact inherited item timing remains the simplest supported policy until
stronger evidence is available; it is now qualified in its code comment. Other source-specific native migrations
with direct event evidence remain in place. No rollback of S54/S55/S58 is implied by this item-specific result.

The experiment is preserved as `/private/tmp/attack-s59-experiment.tar`, SHA-256
`7e71dcdc8cf6d2858ddc92c4f52dbab5071aa097b806bb7cb691edd1f263ab62`.
Twenty-eight additional cases remain, checking all qualities against full shield, dodge, zero, HP loss, killing
blow, partial barrier and special HP. They assert old notification visibility rather than the rejected earlier
success placement. Existing source-less, ally, bare-attack and real Ascalon DoT tests remain. Restored focused
verification passes **105/105** (`attack-s59-restored-targeted.log`).

A 496-file byte comparison of server/shared/data plus tools/golden.mjs matched S58 exactly after restoration;
the subsequent production edit only adds the explicit assumption comment. An AST comparison verifies that
comment did not change the item module's code. Thus the preserved S58 golden result remains the applicable
production result (103 unaccepted differences), not the rejected experiment's 108. Final restored-area checks
report **3558 total, 3555 pass, 3 skipped, 0 fail** (`attack-s59-restored-areas.log`).
Docs pass **32/32**; scoped lint has zero errors and two pre-existing warnings (deprecated helper import and
unused argument). Whitespace checks pass. These remain intermediate checks, not final CI. This is a rejected simplification with useful boundary coverage, not
a completed migration or a claim that all item phases have been reproduced from the original client.

### S60: production code no longer loads the independent legacy oracle

Thirty-eight sim imports used damage.js only for helpers: hasHp/isHpLoss/periodicDamage, elementView,
palsyBuff, burstLocked or reduceElement. They now import attack/helpers.js or attack/element.js, with the
AI's internal recovery call renamed healElement. The remaining server/match/bot.js import moves to pure
attack/calculation.js. That bot passes no penetration options; its default mitigation is unchanged even
though the newer function supports S9's corrected combined-penetration formula. No original export is deleted
or redirected, preserving an independent oracle and compatibility hints for old external consumers.

AST parameter/body comparisons are equal for eight relevant functions, including the private burstLockOf
and reduceElement→healElement (`attack-s60-helper-ast.json`). Constants/dependencies were inspected separately;
identical source alone would not establish closure equivalence. An independent value probe reports zero
failures across **784** default phys/arts mitigation inputs, **48** gauge recovery/view/lock combinations,
**7** palsy constructors and **7** periodic descriptors (`attack-s60-helper-comparison.json`). NaN/infinity,
zero/negative inputs and all/matching gauges are included where applicable.

periodicDamage's constructor dependency deliberately differs: new normalized descriptors explicitly carry
applyWay NONE and attackType BUFF. Stripping only those two added metadata fields gives exact old/new
descriptor equality. Old consumers already inferred these values from isAttack/isProjectile and dot tags;
this is explicit metadata, not a change to actual source, independent credit, type, amount or dodge policy.
No new gameplay rule/source claim is introduced by this dependency cleanup.

A source-wide production import search finds no damage.js imports under server/shared/public. An Acorn
relative-static-import graph from Battle.js and server/match/bot.js traverses **88 modules**, finds no missing
relative import and cannot reach the oracle (`attack-s60-graph.json`). This proves those static paths only;
it does not claim that arbitrary external plugins or nonliteral dynamic imports were traversed. Import
migration paths and file hashes are preserved in `attack-s60-imports.json` (39 modules). The ESLint warning
for external legacy usage remains; this stage does not turn compatibility into a runtime refusal.

Focused engine/item/gauge/profession/differential tests pass **74/74** (`attack-s60-targeted.log`), and bot
suites pass **62/62** (`attack-s60-bots.log`). Complete affected-area tests pass **3555**, with **3 skipped**,
**3558 total**, zero failures (`attack-s60-areas.log`). Complete recomputed golden digests equal S58
(`attack-s60-v030-digests.json`), still 103 unaccepted differences against 0.3.0. The S59 rejected timing
experiment is not restored. Scoped lint has zero errors and seven existing unused-argument/assignment
warnings after removing the deprecated-import warnings. Final bot-inclusive lint likewise has zero errors
and seven warnings (`attack-s60-final-lint.log`); documentation checks pass **32/32**, whitespace checks pass.
The complete digest probe began before the final bot import-path edit; default mitigation equivalence and
62 bot tests separately cover that final edit. Final all-input-frozen CI/golden acceptance is still required.

This is concrete dependency decoupling: the old 693-line oracle remains in the repository for compatibility
and verification but is not statically loaded by the checked production entrypoints. It is not a claim that
907 lines of new core became fewer than 669, nor a measured browser transfer/parse-time benchmark.

### S61: close observed attribution for all 23 no-call-delta scenes

The [scenario inventory](13-settlement-golden-audit.md) now separates **23 attributed scene scopes** from
**80 pending scenes**. No baseline is accepted. Fresh complete snapshot and nine-event notification probes
use current S60 production against clean 0.3.0, rather than treating the historical first-call report as
proof that the scenes have no changes. Their exact counts/categories and witnesses are preserved in the
inventory JSON; full temporary artifacts have SHA-256 receipts in the companion Markdown.

Snapshot classification covers all leaves: 13 scenes change only unit SHIELD bit 32 and optional layer
projection, eight have identical full snapshots, and two change only HP at Reaper healing phases. All
observed flag XORs are exactly 32. Positions, other flags, skill bars and other snapshot fields agree in
these 23 scenes. This is specific measured coverage, not original-rendering or universal hook equivalence.

| Measured difference | Mechanism evidence already recorded | Scene observation |
|---|---|---|
| Native count-shield projection / additional zero compatibility notifications | S32 separates compatibility notification from success; S43 holds real shield buffs | Complete leaf differences limited to shield flag/layers; event deltas identify absorbed zero amounts |
| Special-HP damage metadata and damage-number count | S46; PRTS special HP changes HP decrement, not damage | roster-008 reports positive physical amounts while the actual forbidden-type HP delta remains zero; damage API/HP snapshots agree |
| Reaper heal counts/timing | S53 native admission/delivery; frame/value qualifications remain | roster-019 has a single 50-HP snapshot gap at 137 s; boss-boss_1-solo has ten HP-only gaps; other affected scenes have unchanged snapshots |
| Titi healing basis plus Reaper queue | S46 damage basis; S53 queue | roster-013 at 42.233333 s: identical target/prior HP, old healing input 0.5 versus new 535.92; her heal-call count drops 215→208 while Entlechia's queue changes separately |
| Held Penance barrier status projection | S44 preserves sequence/held empty buff | diy-056 has identical full snapshots and notification category counts; barrier gain/loss wire events for units 2/5 each fall 3→1, explaining all eight removed status events |

The Titi witness avoids falsely attributing every roster-013 heal-count change to the first Reaper difference.
The Penance wire probe avoids guessing from a reordered first counter event when the only digest movement is
status-event count. PRTS [combat events](https://prts.wiki/w/事件) and the native stage evidence remain the
mechanism sources; this inventory does not equate legacy damaged with native successful damage. The S59
item timing experiment stays rejected.

Validation checks the 103-scenario set against the current 103-difference digest inventory, all 23 snapshot
classifications/flag masks and the precise Titi/Penance witnesses. Remaining 80 causal reviews, unclassified
legacy listeners, migration guidance and final all-input-frozen CI/golden acceptance are still required.
Documentation checks pass **32/32** (`attack-s61-docs.log`); exact scenario-set, mask/category and witness
validation passes. Whitespace checks pass; `git diff HEAD -- test/golden` is empty. No production edit or
full CI run is claimed for this evidence-consolidation stage.

### S62: isolate penetration order with independent whole-scene counterfactuals

PRTS [physical and arts damage formulas](https://prts.wiki/w/游戏数据基础#伤害公式), rechecked 2026-10-17,
subtract fixed penetration before applying percentage penetration. S9 already implements this. The audit
now verifies its numerical and scenario-level consequences rather than relying on a first differing call.
Native fixed-point precision is still outside the simulator's verified equivalence claim.

A diagnostic getter records stats only when the engine itself reads them; it does not force lazy stat reads
before a hit. Eleven selected calls retain identical input/target HP/pre-call RNG in the baseline trace.
Independent arithmetic using captured DEF/RES, instance/source penetration and source/target multipliers
matches both old and current actual HP returns within 1e-6 (`attack-s62-formula.json`). For example:

| Scene | Input / defence / fixed / percent | Old effective defence | New effective defence | Old / new HP removed |
|---|---|---:|---:|---:|
| roster-003 | 989.1981 phys / 120 / 95 / 30% | 0 | 17.5 | 989.1981 / 971.6981 |
| roster-045 | 3106.1184 phys / 800 / 175 / 60% | 145 | 250 | 2961.1184 / 2856.1184 |
| diy-005 | 1140.48 phys / 2000 / 70 / 50% | 930 | 965 | 210.48 / 175.48 |
| diy-006 | 765.765 phys / 100 / 70 / 50% | 0 | 15 | 765.765 / 750.765 |

An isolated copy of S60 source at `/private/tmp/stronghold-damage-s62-old-penetration` changes only the two
penetration expressions in attack/calculation.js. A production/data file comparison confirms no other module
changed. Its complete run summaries exactly equal original 0.3.0 (not merely the diff tool's tolerance) for
six scenes: roster-003, roster-045, unite-1, standin-04, diy-005 and diy-006. This establishes the whole
recorded-summary cause for those six. Neither the working implementation nor golden baselines are reverted.

Two combined cases receive separate residual verification:

- **roster-017:** after restoring the old formula only one snapshot SHIELD-bit difference remains. At 108 s,
  old global ×0.78 reduction consumes **92.664** from angel2's barrier; ordered injury consumes **118.8**
  before the later reduction (barrier seq 7155, reduction seq 7234). Both remove zero HP. At 135 s the old
  decaying pool has **20.8559999999961**, new zero, while HP is the same. This accounts for the one remaining
  flag 32→0. It is an actual ordered-pool-consumption difference with a projection-only summary consequence,
  not a claim that both barrier pools are equal. S20 / PRTS injury acquisition order supplies the rule.
- **roster-018:** the restored-formula residual is only eight heal-hook / four heal-event count differences;
  all snapshots and healing totals agree. Reed's healing method receives **0.6** old versus
  **1477.4152643712005** new at 54.133333 s on the same target/prior HP. Special HP's preserved damage basis
  (S46/S54) explains the larger heal and fewer subsequent healing method calls (**58→50**).

The remaining three first-call matches are kept pending: boss-boss_3-pair, boss-boss_5-pair and standin-09
retain other counterfactual differences. Numerical agreement on their first call is explicitly not whole-scene
approval. The inventory now attributes **31** recorded scene scopes and keeps **72** pending, all 103 baselines
unaccepted. All 11 input/formula witnesses and remaining counterfactual paths are preserved in its JSON;
temporary detailed artifacts have SHA-256 receipts. The current production code is unchanged in this stage.
Documentation checks pass **32/32** (`attack-s62-docs.log`); scenario-set/formula/counterfactual inventory
validation and whitespace checks pass. Golden files remain unchanged. These checks do not constitute final CI.


### S63: Pegasus uses a source-less carried instance before the parent injury

Source checked 2026-10-17: [PRTS lower-half equipment notes](https://prts.wiki/w/卫戍协议：盟约_下半/PRTS盟约记录),
天马之枪. These mode-specific notes settle the eligibility, source, basis and relative order; the generic
item description alone does not. Generated item data supplies the 0.3 coefficient; no generated data is edited.

| Dimension | Original 0.3.0 / pre-S63 behavior | S63 behavior and source standard |
|---|---|---|
| Eligibility | Late `damaged` listener excludes item tags | Actual carrier's non-ADDITION damage; descriptive item tags alone do not disqualify it |
| Source / class | Carrier is actual source; no explicit carried class | `source: null`, carrier `credit`, true HP damage, `attackType: ADDITION`, `applyWay: NONE` |
| Basis | Current carrier ATK times 0.3; source amplification can apply again | Parent input after attack scaling/calculation additions, before DEF/RES and injury effects, times 0.3 |
| Order | Parent finishes before the extra instance | Child finishes before parent injury; it can consume the shield or kill the target first |

The existing `damageBeforeApply` boundary expresses this without another event. Parent post-mitigation
`mul` does not enter the basis. Typed HP loss, element gauges, and source-less parents credited to the carrier
do not emit that carrier event. ADDITION children cannot recurse through the equipment listener. A resolved
request has no recoverable pre-defense origin amount: using its supplied amount is explicitly `[ASSUMED]`.
No assertion is made about unobserved original-client fixed-point precision.

Ordinary descriptors now retain an optional immediate-parent `origin`, separate from actual `source` and
statistical `credit`. This is needed by a real integration: Pegasus can kill before Mlynar's parent `damaged`
notification. His own/carried attack kill tracking recognizes the credited child's parent descriptor. It still
excludes reflection and damage carried by another operator's mark. A nested reflection regression ensures
that a previous own child cannot leave stale eligibility and convert a later reflection kill into an own kill.
Credit alone is insufficient to establish that a kill belongs to the operator's own attack.

Independent preserved-S60/current real-equipment fixtures use base ATK 500, equipped ATK 700, input 1000:

| Interaction | Old total HP removed | New total HP removed |
|---|---:|---:|
| Ordinary unmitigated hit | 1210 | 1300 |
| Carrier damage amplification ×2 | 2420 | 2300 |
| One count shield | 210 | 1000 |
| Parent physical dodge | 0 | 300 |
| Target initially has 100 HP | 100 (parent kills, late child notification) | 100 (child kills, parent returns 0) |
| Parent already ADDITION | 1210 | 1000 |

These fixtures compare the observed code paths, rather than treating an old/new difference as proof of the
rule. The PRTS ordering/source/class statements and independent shield, dodge, multiplier and lethal tests
supply the rule evidence. `attack-s63-pegasus-comparison.json` predates the origin/ownership metadata fix;
its numeric fixtures use no Mlynar and remain applicable. Final tests below include that integration fix.

Initial area verification exposed two obsolete tests filtering carried effects by actual source. Updating
those assertions to separate `source` and `credit` then exposed the real Mlynar ownership failure, fixed in
production with the parent descriptor and the nested-reflection exclusion. No failure was hidden by merely
relaxing the expected kill count.

Final focused run: **131 pass, 0 fail** (`attack-s63-final-scoped.log`). Engine/content run: **3572 total,
3569 pass, 3 skipped, 0 fail** (`attack-s63-final-areas.log`). Scoped lint reports **0 errors, 3 existing unused
variable warnings** (`attack-s63-final-lint.log`). `npm run typecheck` passes its configured checked-JS slice;
this is not a claim that all settlement/content implementation is type checked (`attack-s63-types.log`).

Final full golden probe reports **104 differences** from unchanged 0.3.0, with exactly five field scenarios
moving since S60; the linked inventory lists them and refreshes their first-call traces. None of the 31
previously attributed scene scopes moves. There are **73 pending reviews** and no accepted/updated baselines.
The three residual investigations from S62 remain pending; Pegasus does not explain standin-09, whose digest
is unchanged by S63. Full CI and final acceptance have not been performed.

The rejected S59 common-item timing move stays withdrawn. The lower-half page also documents tear-gas and
cold-item effects, but their wording does not establish an exact phase relative to every damage callback.
Pegasus's explicit before-parent statement cannot be generalized to those other equipment effects.


### S64: Kazimierz distinguishes ordinary instances from attack behavior

Checked 2026-10-17 against [PRTS lower-half bond notes](https://prts.wiki/w/卫戍协议：盟约_下半/PRTS盟约记录),
卡西米尔. The blocking pulse is sourced NORMAL true damage; the unblocked rider is source-less true ADDITION,
triggered by NORMAL damage rather than only normal-attack behavior. The original implementation conflated
these axes, emitting an inferred SPLASH pulse and an actual-carrier-source rider gated by `isAttack`.

The pulse retains its existing AoE observation flag but explicitly sets NORMAL and NONE application route.
The rider now separates null actual source from carrier credit, retains `origin`, and uses precomputed input.
Its amount remains 30% current carrier ATK; unlike Pegasus it does not read parent damage. Carrier damage
amplification is not borrowed by a source-less child; target modifiers still apply. ADDITION, BUFF, SPLASH,
NONE, HP loss and element-gauge requests cannot generate it merely by setting `isAttack: true`. A NORMAL
non-attack direct hit can; descriptive item tags alone do not change its class.

[ASSUMED] The legacy `damaged`-listener timing, including zero-amount notifications and its placement relative
to other late listeners, is retained. This source establishes class/source/eligibility, but does not settle
that precise callback phase. No blanket move to `damageApplied` or `damageBeforeApply` is inferred. The
own-tag recursion guard is retained. Existing tests still require no unblocked rider while blocking.

Independent real-bond fixtures against clean 0.3.0 use base ATK 1000, post-deployment ATK 1200, carrier damage
amplification ×2, true parent input 100, no target modifiers:

| Parent | Original total HP removed | S64 total HP removed |
|---|---:|---:|
| Ordinary attack | 920 (200 + sourced child 720) | 560 (200 + source-less child 360) |
| NORMAL non-attack | 200 | 560 |
| Explicit ADDITION with attack flag | 920 | 200 |

Both implementations return 200 for the parent call and produce no simulation errors. Event-listener
observation order in this probe is nested listener order, not HP application order. Receipt:
`/private/tmp/attack-s64-kaz-comparison.json`. The original's ignored new `attackType` field is intentional
in that last compatibility fixture; it demonstrates why the old attack-flag shortcut cannot represent the
new explicit classification, rather than asserting that 0.3.0 previously understood that field.

Seven new eligibility/source fixtures plus real blocking, Mlynar S2/S3 carried-kill and nested-reflection
integration checks pass: **58 pass, 0 fail** (`attack-s64-scoped.log`). Scoped lint passes without warnings
(`attack-s64-lint.log`). The full engine/content run passes **3576 tests, 3 skipped, 0 failures (3579 total)**
(`attack-s64-areas.log`). The complete golden probe has **105 differences**, only one scene moving from S63:
`bond-kazimierzShip-high`. A separate current-source copy restoring only `core.js` from preserved S63
reproduces that scene's entire original 0.3.0 summary exactly (`attack-s64-kaz-counterfactual.json`).
Together with the independent interaction fixtures this attributes its recorded summary scope, without
accepting a baseline or proving the assumed relative phase. Prior 31 attributed scopes have identical
complete digests to S63. The inventory now has **32 attributed scopes and 73 pending reviews**.
Further unresolved classification consumers include Siracusa's old tag/`isSplash` inference and Logos Y's
legacy damage listener. S64 does not claim to complete those audits or the full refactor.


### S65: Logos Y rejects inherited HP-loss tags; its zero-damage phase remains unsettled

[PRTS Logos](https://prts.wiki/w/逻各斯), CCR-Y and Lexicon notes, establishes the normal-attack elite/boss SP
bonus and explicitly permits Lexicon to trigger it. [PRTS damage classification](https://prts.wiki/w/伤害分类)
places HP loss outside damage events apart from calculation. A carried `logosLexicon` description is not an
exception to that loss policy. The previous listener accepted a loss inheriting this tag and granted SP.
The listener now rejects `isHpLoss` before interpreting attack behavior or the Lexicon tag. Both the new
request's `origin` tags and the retained positional adapter's `from` tags are covered.

The pinned native template capture contains Logos's Δ trait, but does not establish the generic CCR-Y event
or its cancellation filters. In particular, `logos_e_002_tr` cannot be used as evidence for this other module.
The implementation explicitly retains `[ASSUMED]` legacy zero-input/full-shield SP eligibility. It is not
moved wholesale to `damageApplied`. An ordinary dodge cancels before that legacy notification in the new
ordered pipeline and gives no SP. This is an observed compatibility boundary, not universal native proof.

Independent clean-0.3.0/current fixtures use the real elite tier-6 DIY Logos Y module and an elite dummy:
ordinary attack SP gain **1→1**, legacy HP loss inheriting Lexicon's tag **1→0**, literal zero attack **1→1**,
full count-shield attack **1→1**, no simulation errors (`attack-s65-logos-comparison.json`). The legacy
comparison uses the original `loseHp` API, not a fictitious damage `hpLoss` boolean. New tests also cover
modern loss with inherited origin tags, normal loss, actual-source versus credit, skill damage, Lexicon and
ordered cancellation. Initial exploratory expectations for a cancelled notification were corrected after
observing the actual pipeline; the compatibility tests are not asserted as original-client evidence.

Final Logos/API/attack-class focused run: **73 pass, 0 fail** (`attack-s65-scoped.log`). Scoped lint reports
no diagnostics (`attack-s65-lint.log`). The Logos header's Δ explanation is also corrected to post-injury
amount rather than overkill-clamped HP removed, consistent with S55's existing implementation. The complete S65 golden digests equal S64 exactly across all 288 scenarios
(`attack-s65-v030-digests.json`): still **105 unaccepted differences, 32 attributed scopes, 73 pending**.
Documentation checks pass **32/32** (`attack-s65-docs.log`). Full CI and the remaining
native-event/classification audit are not complete.


### S66: six scene scopes closed by isolated Reaper restoration and residual tracing

No production change. The current source matches the preserved S65 archive byte-for-byte across server/shared
JS. In two copied trees, restore only the 0.3.0 `installReaperHeal` function, or that function plus the two
old penetration expressions. Verified source differences are limited to the intended one/two modules.
Run all 15 pending S53-associated scenes in each copy: all 30 report zero simulation errors.

Restoring Reaper alone produces full summaries deep-equal to original 0.3.0 for **roster-032, roster-033,
roster-043 and bond-indomShip-high**. This attributes all their recorded summary changes to the old/new
healing admission/delivery behavior documented in S53, rather than only their first damage-call difference.
The combined formula restoration adds no further whole-summary matches. Rechecked [PRTS Entelechia branch
notes](https://prts.wiki/w/Entelechia) confirm the 0.05 s admission cap and 0.12 s heal interval. Existing
first-phase, mixed-value and 30 Hz qualifications remain: the counterfactual is not native frame proof.

Two further mixed scopes are closed. **roster-042** after Reaper restoration has only one extra absorbed-zero
`damaged` notification and two snapshot leaves (SHIELD bit 32 and corresponding layer). **roster-005** has
24 extra shield-zero notifications minus six Tinman source-triggered gauge fills (net damaged +18); the six
absent burn numbers explain dmg-event count -6. All 237 snapshot leaf differences are SHIELD bit/layers.
These independently measured residual categories are supported by S32/S43 and S48, not inferred from a
historical stage label.

Its remaining two status tuples are traced to **93.266667 s**, target `chess_char_2_12_b`, a 376 arts input.
Both versions start with a Papyrus pool **108.9** and a later drone count shield. Old seq 1624 < 1633,
new seq 1611 < 1619. Old early drone cancellation preserves the pool; ordered injury consumes the earlier
pool before cancelling on the later drone shield. Both remove zero HP. Pool loss at that time plus its
next gain at 94 s explains the extra on/off pair; this is an ordered-shield interaction (S20/S43), not a
healing-stat change. Wire tracing additionally preserves true special-HP numbers **1→40** twice and one
removed arts red marker; those payload changes are documented by S46/S56 and do not alter event counts.

The full counterfactual summaries, snapshot leaves, notification categories, wire tuples and exact ordered
shield witness are linked in the inventory with hashed receipts. Six scopes move from pending to attributed:
**38 attributed scopes, 67 pending, 105 unchanged/unaccepted baseline differences**. Other nine tested scenes
remain pending. Restoring both mechanisms leaves boss-boss_3-pair with ten summary paths; this is reduced
scope, not proof of completion. No new full CI or baseline update is performed in this evidence-only stage.


### S67: special-HP rider basis, isolated reconstruction, and seven scoped attributions

Production remains byte-identical to S65. All 67 pending scenes are run in two copied trees (134 runs):
(a) quantize only the special-HP notification amount to its final HP amount after ordinary injury, and
(b) that plus the S66 old-Reaper and old-penetration restorations. Verified source differences are the intended
one/three modules. Every battle reports zero count errors, and every match's engine/logged/sim/dispatcher
categories is zero. The counterfactual does not claim to reproduce the entire original early special-HP branch:
it intentionally isolates the damage basis exposed to successful-damage/legacy/fatal/number observers.

**roster-026** deep-equals original 0.3.0 after (a) alone. Full original/current snapshots differ at one leaf,
element gauge projection 0.01→0.11. [PRTS special-HP notes](https://prts.wiki/w/假想敌：再生) explicitly retain
the damage basis for derived healing/gauges; [Titi](https://prts.wiki/w/缇缇) independently states that distinction.
This is a gauge observation, not a claim that its HP or final healing changed.

Three more residual scenes require no speculative phase changes. **roster-035** has four removed hit hooks
for transferred true HP loss (all four still notify with hpLoss/transfer), one added zero Mudrock-barrier
notification, and one red-number marker change with the same count. **roster-046** at 35 s: old Yu deals
1051.248 arts, then 362.68056 gauge and a lethal 7000 burst; new gauge/burst kills the 5646.443675-HP target
first, so that arts hit is absent. Exactly one hit, damaged and number disappear. **diy-058** emits one fewer
Penance barrier on/off pair for unit 2 (54→52 status events). Each of these counterfactual full digests equals
current production, so their residual checks cover the actual current summaries. Existing S10/S14/S32/S40/
S44/S56 sources supply the rules; no stronger native callback equivalence is inferred from reordered events.

**roster-037** requires the combined mechanisms: it leaves only 58 removed hit hooks, and all 58 corresponding
new true notifications are explicitly hpLoss/transfer. Penetration-only restoration still leaves seven paths,
so this scene must not be attributed to the formula alone. [PRTS Skadi](https://prts.wiki/w/浊心斯卡蒂) states
that transferred damage is HP loss and cannot itself be transferred; the lack of ordinary hit events follows
that policy. The combined counterfactual is sufficient within this scene's recorded summary, not a claim of
minimal independent influence of each mechanism.

**boss-boss_3-pair** reduces to exactly three additional firewall gauge/number events. Their source is the S29
geometry correction: at 66.233333 s Reed is at x=3, enemy x≈6.253893, old wall x=3 versus new x=3.5. Only the
new wall crosses the damage. The later two fills share that geometry at 82.233333/82.566667 s; all are
167.244 gauge. [PRTS Yu](https://prts.wiki/w/Yu) explicitly places the wall 0.5 tile forward. This witness
avoids incorrectly assigning the gauge difference to the new event name or to pulse order.

**hidden-boss_8-pair** reduces to fatal count 43→42. At 40.433333 s the original 2370.3888 physical parent
already emits fatal at HP zero; its late Pegasus child emits another (394.383). The new child is processed
before the parent and does not produce that late zero-HP fatal. Wire amount 394→631 and the child's null
source retain S63's independent evidence. No generic fatal-controller rewrite is made to hide this difference.

The inventory now attributes **45 recorded scene scopes**, with **60 pending** and all **105** baseline
differences unaccepted. Full JSON witnesses and SHA receipts are in the linked audit. S53 frame/value,
S46 special-HP/loss, and other original-client precision/event qualifications remain. No new production
change, full CI claim, or golden update is made in this evidence-only stage.


### S68: Vendla's counter phase explains six complete scene scopes

No production change. Two independent copies alter only Vendla's receiver counter stage, or that stage
plus the three S67 restorations. The experimental late counter retains the current held receiver grant
and lifetime, actual enemy source/action guards, RANGED route and normal dodge. It is not a wholesale old
kit replacement. All 60 pending scenes are run in both variants. Three further registration-order probes
bring the total to **123**, every battle/match error field zero; **11** restored summary instances are
checked with deep equality rather than relying only on a capped difference report.

Stage-only restoration exactly reproduces **bond-deputShip-high, bond-suntShip-high, bond-victoriaShip-low**.
Combined restoration additionally reproduces **roster-002** and the complete **coop2-NORMAL-8-serverrun**
match. This independently attributes the observed S36 healing timing and the documented combined mechanisms
at the full recorded-summary scope. It does not require changing the production injury-stage observer.

**roster-001** requires faithful registration in the counterfactual too. Registering the late observer on
each skill cast initially leaves two **12.32** healing gaps at 30.266667/34.266667 s. Input is still 74.1675;
old prior HP 2792.68 admits 12.32 to reach 2805, experimental prior HP already 2805 admits none. Moving that
experimental listener to the original talent-install position, while keeping current receiver-grant checks,
restores the whole summary exactly. The 24.64 discrepancy is an experimental listener-order artifact, not
rounding dust or an accepted defect in production. Registration strategy must not be silently changed when
isolating a callback's old phase.

Fresh original/current production tracing at **28.8 s** confirms the intended S36 difference: input 74.1675
in both, old post-incoming HP **2542.98** accepts **82.325925** after the ×1.11 healing talent; new injury-time
receiver is still full at **2805** and accepts zero. Independent pinned native templates register
`vendla_s_2` on ON_TAKE_DAMAGE and `vendla_tr` on ON_AFTER_OUTPUT_DAMAGE. [PRTS Vendla](https://prts.wiki/w/Vendela)
identifies the cast-selected grant and her counter damage's targeted trait heal. These support the new
injury-time treatment; full native callback acquisition/priority and fixed-point equivalence are not inferred
from those data. Current route/dodge and no-regrant rules remain unchanged.

Six scene scopes move to attributed. Current review: **51 attributed, 54 pending**, all **105** golden
differences unaccepted. The linked audit preserves exact restoration groups, fresh healing traces and hashes.
No production reversion, baseline regeneration, or full-CI completion is claimed in this review stage.


### S69: six Hoshiguma scene scopes isolated without changing production

Two copied trees restore only the original Hoshiguma kit, or that kit plus the S68 combined reconstruction.
All 54 pending scenes run in each, with no reported battle/match errors. This is a grouped kit experiment:
it restores the old armor's phys/arts/source gate and early cancellation, plus late thorns that miss cancelled
instances. It must not be described as a single event rename. [PRTS injury effects](https://prts.wiki/w/伤判效果)
explicitly retain eligible reflection after cancellation, and [Hoshiguma](https://prts.wiki/w/星熊) describes
unqualified damage block; [damage classification](https://prts.wiki/w/伤害分类) permits unqualified injury
cancellation for true damage. These are the S21 source standards, not reasons to revert production.

Original-kit-only restoration deep-equals complete original 0.3.0 summaries for **roster-012, roster-029,
bond-emptyShip-high, boss-boss_4-solo, hidden-boss_8-solo**. This attributes their recorded whole-scene
scope to the grouped S21 block/reflection correction, beyond the historical first-call evidence.

**roster-010** with that same kit restoration retains only dmg-number count **1241→1259**. A further
separate copy restores just the special-HP observer basis (S67) alongside Hoshiguma, producing full deep
equality; old Reaper, penetration and Vendla are unnecessary for this scene. Wire inspection identifies
all changed normalized number tuples at unit 38, `enemy_1204_msfhu_2`, whose special HP accepts arts/true:
**18** positive physical damage numbers appear without reducing its HP. Eleven old arts numbers of 1 become
six 506 and five 446, changing payload but not number count. This is S46's damage/HP distinction; original
number precision/rendering is still qualified as in S46/S56, not independently certified by the scene audit.

The 108 broad probes plus one reduced reconstruction all report zero errors; **12** restored summary
instances are deep-compared to original payloads across six scenes. Production remains byte-identical to
S65 and no golden is edited. The inventory now has **57 attributed recorded scopes and 48 pending**, all
**105** baseline differences unaccepted. Raw counterfactual results and number traces have hashed receipts
in the linked audit. Full CI and the remaining migration/native-classification work are still required.


### S70: ordinary burst dodge probe, then AST-X descriptor/calculation correction

Two counterfactual trees run all 48 pending scenes with old burst-helper dodge suppression, alone or atop
the S69 combined reconstruction. All **96** report zero errors; **none** restores a whole original summary.
Relative to the combined S69 version, only boss-boss_2-pair, hidden-boss_10-pair and hidden-boss_10-solo move.
These remain pending. This is negative causal evidence: ordinary burst dodge is not a sufficient explanation
for those full scenes. The production burst policy stays native. Rechecked [PRTS elements](https://prts.wiki/w/元素)
identifies sourced gauge/burst versus source-less HP damage and ordinary/continuous classes. The pinned
`ep_break_water_char`/`ep_break_fire_char` use NORMAL and no cancellation override; periodic magic/element
nodes use BUFF, ignoreForSp=true and no cancellation override. No old dodge immunity is accepted.

The subsequent descriptor audit found a concrete unresolved S42/S34 migration error in **Hoshiguma alter AST-X**:

| Detail | Pre-S70 production | S70 / native standard |
|---|---|---|
| Outgoing rider | Inferred NORMAL, forced dodge bypass, base calculation | Explicit ADDITION, NONE route, precomputed, ordinary dodge |
| Incoming reflection | Inferred NORMAL, base calculation | Explicit NORMAL, NONE route, precomputed, ordinary dodge |
| Source calculation | Both repeat source damageCalculate hooks | Both omit source calculation, retaining actual source/credit and ordinary source damage modifiers |
| Outgoing eligible class | Any isAttack value, no explicit class guard | NORMAL plus existing own-attack behavior; own module tag excluded |

Pinned `hsgma2_e_003_tr_output` and `hsgma2_e_003_tr_take` AdvancedApplyDamage specify these distinct attack
classes, `_applyWay:NONE`, `_emitSourceOnCalculateDamage:false`, `_ignoreMissFlag:NONE` and cancellation
mask NONE. Both retain the existing skill/dying gate. [PRTS Hoshiguma alter](https://prts.wiki/w/斩业星熊)
distinguishes the extra arts ADDITION from incoming NORMAL reflection. S42's preserved outgoing no-dodge
statement describes that old checkpoint and is superseded here; a label in a comment was not implementation.

Independent preserved-S69/current production harness fixtures report zero errors:

| Fixture | S69 | S70 |
|---|---|---|
| Source calculation callback ×2, ordinary body | 2 source calculations; module 393.12 arts | 1; module 196.56 arts |
| Same source callback, target arts dodge 100% | Module 393.12 lands | Module is dodged; physical body still lands |
| Incoming reflection, source calculation ×2 | 1 source calculation; reflection 393.12 | 0; reflection 196.56 |
| AST-X plus Pegasus, scaled physical body | Two Pegasus children, including one derived from wrongly NORMAL module | One Pegasus child from the original attack; ADDITION module cannot retrigger it |

These compare the immediate prior prototype, **not** clean 0.3.0 (whose source-calculation machinery differs).
The prior tree is extracted from the frozen S69 archive. Full request/amount/source/class receipts are
`attack-s70-module-comparison.json`. New output retains parent `origin` independently of source/credit.
Eight focused cases cover classification, omitted source calculation, normal dodge, incoming/outgoing
non-recursion, incompatible attack classes and the real equipment combination.

Final focused run **77 pass, 0 fail** (`attack-s70-final-scoped.log`), scoped lint has no diagnostics.
Engine/content verification **3596 total, 3593 pass, 3 skipped, 0 fail** (`attack-s70-areas.log`) precedes
only the final equipment-combination test/helper input, subsequently covered by that 77-test focused run.
No production change followed the broad run. The complete 288-scene S70 digests equal S65 exactly; current
baseline differences remain **105 unaccepted, 57 attributed scopes, 48 pending**. Golden coverage alone
would not have caught this metadata/dodge/source-calculation defect. Final all-input-frozen CI is still required.

AST-X's native ability-owner/family filter permits owned attack attachments; current `isAttack` alone does
not completely propagate that provenance to every NORMAL child. Do not infer ability ownership from credit
or blindly enable every NORMAL source output. S71 corrects an earlier mistaken actor-class audit note:
S11 already selects burst rules with `target.isEnemyEntity`, independently of team, and the existing fidelity
fixture compares an allied enemy entity's old 1200 versus new 7000 burn plus its 2000 leader gauge. Supported
actor-class selection is resolved within that stated model; no new side-based defect is claimed here.


### S71: AST-X period is not its whole notification difference; correct the actor audit

No production edit. Two copied trees restore AST-X's old always-on period gate, alone or with the prior
combined reconstruction. All 48 pending scenes run in each. No whole summary restores from the gate alone;
**diy-051** and **diy-052** reduce to only hit, damaged and damage-number counts. Restoring just the original
AST-X install block (not the entire Hoshiguma alter kit) in another copy deep-equals both complete original
0.3.0 summaries. All **98** counterfactual runs report zero battle/match errors. This attributes the recorded
module scope to the S34/S42/S70 changes as a group, not to the skill gate alone.

The remaining count movements after gate restoration are **+9 hit/+7 damaged/+7 numbers** in diy-051 and
**+6** in all three fields for diy-052. At **168.066667 s**, target 104 starts at about **58.189191** HP:
old main input 1289.784178 removes that HP; the new early module input 128.978418 kills first and the main
call returns zero. Target 106 at **174.466667 s** similarly has about **71.297229** HP, main input
1309.068705 versus early module 130.906871. These two main calls still enter hit but have no later damage
notification/number, explaining why the additional hit count exceeds additional successful notifications.
Wire raw numbers (old 774/785 versus module 77/79) are damage amounts, not extra HP removed. Native
ON_OUTPUT_DAMAGE and the instance classifications/gates recorded in S34/S42/S70 remain the standard;
production is not reverted to fit old counts. Exact original-client ordering beyond the stated event model
and floating-point qualifications remain unclaimed.

**Audit correction:** S70 mistakenly listed actor/team selection as still side-based. Direct current-source
inspection confirms `applyBurst` already uses `target.isEnemyEntity`, and Unit's leader gauge capacity does
too. This was implemented in S11. The existing `attack-fidelity.test.js` fixture changes an enemy entity to
ally team and independently observes original burn **1200** versus current **7000**, plus leader gauge
**2000**; the full file passes **20/20** (`attack-s71-actor-fidelity.log`). No redundant regression or runtime
change is required. The S70 note is corrected in place and linked here; unsupported native actor classes
remain outside the explicitly supported model, rather than becoming a fictitious new side-selection bug.

Two additional scopes are attributed: **59 recorded scopes, 46 pending, 105 unaccepted baseline differences**.
Production remains S70 with its complete digest equivalence to S65. All evidence and hashes are linked in
the scenario audit. Full migration/classification review, unreviewed scene attribution and final CI remain.


### S72: Tinman source/coverage reconstruction and an uncovered lord-module boundary

No production change. Restore the two original Tinman kit modules alone, or together with the prior combined
reconstruction. All 46 pending scenes run in each copy: **92** runs, every battle/match error field zero.
No scene directly restores in this grouped source/classification/coverage/lifetime experiment. Rechecked
[PRTS Tinman](https://prts.wiki/w/Tin_Man) confirms cached ATK, source-less continuous arts damage, persistent
landed units and in-radius regeneration as an attribute. S48/S49's native injury amplification and declared
lifetime evidence remain; instant landing and tick/pre-hit coverage sampling remain explicitly [ASSUMED].

**roster-006** is attributed after its residuals are fully checked. Both copied trees yield identical full
summaries; normalizing just damaged/dodge counters produces deep equality to original 0.3.0. The residual
**damaged 583→591** is exactly eight zero-amount hits absorbed by enemy Mudrock's barrier: source
chess_char_2_18_b four, Tippi one, chess_char_3_04_a three. **dodge 3→8** is five real Tippi attempts newly
reported by S47 (enemy_1006_shield_3, enemy_1121_lifbos, enemy_1170_dushld_2, enemy_1404_msnip,
enemy_1511_mdrock). These are reporting changes: the reconstruction's HP, RNG, stats and every snapshot
field match. The Tinman mechanism group plus S14/S32/S47 therefore explains the entire recorded scope,
not merely its historical first amount divergence.

**boss-boss_2-solo remains pending.** After combined restoration it retains five paths, including four
additional arts-module hits from chess_char_4_22_b (SilverAsh), five zero compatibility notifications, one
additional fatal and HP/shield snapshot changes. Current SilverAsh's module still uses late `damaged` and
filters physical attack hits; [PRTS SilverAsh](https://prts.wiki/w/SilverAsh) explicitly specifies source
calculation and precomputed arts ADDITION. The shared-family native example `thorns_e_002_tr` directly
registers DamageViaAttr (ATK, MAGICAL, NONE route, ADDITION) on ON_CALCULATE_DAMAGE, without a nested
source-calculation replay. This is an implementation audit finding, not a claim that that one record proves
every other lord's filters or full-scene behavior.

Next migration candidates are SilverAsh, Lappland, Ayer, Qiubai and Thorns: their existing module paths use
late damaged, afterHit or manual post-hit additions. Their secondary talent/poison precomputed policies must
be inspected before installing a shared source-calculation handler; blindly moving every module would risk
new re-entry and duplicate additions. The APIs can express precomputed ADDITION cleanly, but those callers
have not yet all adopted that contract. No baseline or boss scene is accepted before the migration.

One scene scope closes: **60 attributed recorded scopes, 45 pending**, all **105** differences unaccepted.
Counterfactual results and complete residual notification/snapshot evidence have hashes in the linked audit.
Production and golden baselines remain unchanged; final CI is not yet performed.



### S73: Lappland LOR-X source-calculation migration; lord-specific exceptions preserved

Production change: Lappland's module is no longer a trait `afterHit` call. A small shared installer subscribes
only to this unit's actual-source `damageCalculate` and emits sourced arts **ADDITION**, **NONE** route,
**precomputed**, with immediate parent `origin`. No source event repeats for the child. Source-less credit,
HP loss, gauges and precomputed/resolved parents do not satisfy this source-calculation contract. The native
`whitew_e_002_tr` record has no HP-type, NORMAL-class or attack-family condition; no invented `isAttack`
filter is added. Ordinary child cancellation and target mitigation remain in the common pipeline.

Evidence: the pinned native buff templates listed in Sources contain `whitew_e_002_tr` ON_CALCULATE_DAMAGE
→ DamageViaAttr (ATK, MAGICAL, ADDITION, NONE, atk_scale_m, no multiplier-by-key). [PRTS Lappland](https://prts.wiki/w/拉普兰德)
is the operator/module reference. The web text extractor did not expose the module's precomputed tooltip in
this pass; the exact phase/classification finding above is directly from the native record, not a quotation
of the extracted PRTS page.

Independent real-attack comparison of S72/current copies (ATK **689**, no target resistance):

| Fixture | Old behavior | New behavior |
|---|---|---|
| Plain attack | 689 physical, then 68.9 arts NORMAL | 68.9 arts ADDITION, then 689 physical; same HP |
| Source calculation callback doubles input | Two callbacks; 1378 physical +137.8 arts | One callback; 68.9 arts +1378 physical |
| One count shield | Blocks primary; module removes 68.9 HP | Blocks module; primary removes 689 HP |
| Physical dodge | Four attempted attacks leave four 68.9 arts hits; eight calculation callbacks | Same HP; four callbacks, four ADDITION hits |
| Target HP 1 | Primary kills; module omitted | Module kills first; primary stops; one credited kill |

All ten independent fixture runs have zero errors. Twelve new regressions plus existing tier-1/2 and alternate
tier-2 suites report **106 passes**, zero failures. Scoped ESLint has no diagnostics. The engine/content run reports **3609 total, 3606 passes, 3 skips, zero failures**; docs report **32 passes**.
A final natural-AI-attack regression also excludes any remaining afterHit duplicate: all **13** lord tests pass.
This final test adds no production change after the broad run. Golden recomputation runs all **288** shipped
scenarios with every battle/match error field zero. Three summaries move relative to S70: **roster-006**,
**bond-siracusaShip-high**, **coop2-NORMAL-1-coverage-standins**. The bond scene is newly different from 0.3.0;
all its differences are hit/damaged/dmg counts (+2). No full causal attribution is inferred from those counts.
Current inventory: **106 unaccepted differences; 59 attributed scopes, 47 pending**. S72's roster-006 attribution
is historical and reopened for its changed digest; old evidence is preserved. First-call traces for all three
scenes are refreshed. No golden file is edited.

**Do not generalize the helper to every lord unchanged.** Inspecting actual per-operator templates corrects
the earlier shorthand that `svrash_e_002_tr` was another module: it does implement the relevant arts rider,
with extra conditions. `ayer_e_002_tr` excludes ability **HitBlockee** and conditionally multiplies the rider
by the skill's **atk_scale**; `svrash_e_002_tr` conditionally uses skill atk_scale and a separate elite/boss
multiplier. A future migration must preserve these branches. `qiubai_e_002_tr` and `thorns_e_002_tr` are plain
riders, but their currently base-classified secondary damage also needs auditing before the source hook is
installed. Native Thorns poison is FixedValueDamage, BUFF, no calculation event; Qiubai talent's DamageViaAttr
is ADDITION. This stage migrates **only Lappland**, leaving the other four explicitly outstanding. Sharp's typed
HP-loss module remains separate. This is not completion of the settlement refactor or original-client equivalence.


S73 evidence SHA-256 receipts:

- `attack-s73-module-comparison.json`: `5989ef2d3e667f22b5d7b3772bbf27a7341a5eec535847f8f6baa6838515ef8f`.
- `attack-s73-v030-digests.json`: `6f3d12910d4b081a54d4e800c2da2206fd9bf1acda166c28fc39fe44ae80262f`.
- `attack-s73-v030-diffs.json`: `051446412d62736ebd927fbadeec090d3979ebeac60a4e910b6f546166eafd0d`.
- `attack-s73-first.json`: `7639f029be268b8c094be29a44a407c1f7f8c5f6c0a37624cf3269dee3c884a3`.



### S74: Ayer module, pending-skill projectiles and self-blocked S2 targets

Production migration: Ayer no longer appends an ordinary base arts hit in `trait.afterHit`. The common lord
installer now accepts either a constant ATK ratio or a caller-owned ratio callback (zero omits the rider).
Ayer supplies its own **HitBlockee exclusion** and **skill atk_scale** multiplier. The child is sourced arts
**ADDITION**, **NONE**, **precomputed**, with parent origin; source calculation is not replayed.

[PRTS Ayer](https://prts.wiki/w/Ayerscarpe) specifies source-calculation/precomputed arts ADDITION in the
module notes, explicitly says S1's attack multiplier improves its base value, and excludes S2's blocked-target
extra hit from producing the module rider. Native **ayer_e_002_tr** matches: ON_CALCULATE_DAMAGE, skip
FilterAbilityName **HitBlockee**, CheckCharacterNextAttackOrCombatSkill, copy skill **atk_scale** into value,
then DamageViaAttr ATK/MAGICAL/ADDITION/NONE with or without that multiplier. The existing authored
`ayerBlade` tag identifies this single ability's damage; an arbitrary `isAttack` filter would be wrong.

A real S1 attack regression initially failed: `skill.active` is false when its projectile arrives. The code now
also recognizes the parent damage's retained **isAttack && isSkill** flags before reading the fixed loadout's
skill blackboard. The natural-attack test verifies the multiplier after launch and its absence on the following
ordinary attack. This is Ayer's authored skill-attack mapping, not a new universal ability-owner model; complete
nested/attachment ownership remains a separate outstanding audit.

Another original caller behavior was directly contradicted by PRTS: S2 text is corrected to **自身与周围8格**
allied blockers, whereas old code explicitly skipped Ayer herself. That skip is removed. Its dedicated previous
test asserting self exclusion is updated to require both own and adjacent blocked enemies; a new real-blocking
S2 test confirms one HitBlockee hit plus one primary module child, with no rider from HitBlockee.

Independent S73/current copies use ATK **701**, no RES, one natural attack per fixture:

| Fixture | Old | New |
|---|---|---|
| Ordinary | 701 physical then 70.1 arts NORMAL, 2 source calculation callbacks | 70.1 arts ADDITION then 701 physical, 1 callback; same HP |
| S1, multiplier 1.4 | 981.4 primary +70.1 module | 98.14 module +981.4 primary; skill already ended at impact |
| S2, atk_scale 1.3 | 701 primary +70.1 module | 91.13 module +701 primary |
| One count shield | Primary 0, module 70.1 | Module 0, primary 701 |
| S1, source callback ×2 | Primary 1962.8, module 140.2; 2 callbacks | Module 98.14, primary 1962.8; 1 callback |
| Own blocked target, S2 | No blade; primary 701 +module 70.1 | One 911.3 blade, module 91.13, primary 701; only 2 callbacks (blade +primary) |

All **12** independent runs have zero errors. Initial scoped tests exposed both the pending-S1 omission and
old assertions expecting unscaled module/self exclusion; these were corrected from the evidence rather than
by reducing assertions. The full engine/content run reports **3614 total, 3611 pass, 3 skipped, zero failures**.
Scoped ESLint is clean. All **288** golden scenarios recompute with every battle/match error field zero.
Only **roster-008** changes against S73. The isolated copy restores only Ayer's old production file, verifies
all other server JS matches current, and **deep-equals the entire S73 roster-008 digest**. S61 already reviewed
that earlier digest's S46 zero-notification-only residual against 0.3.0. Together these establish the new recorded
scope, retaining historical evidence; no baseline is accepted. Current inventory: **106 differences, 59 attributed
recorded scopes, 47 pending**. Its category changes from counts-only to summary; all first-call data is refreshed.
SilverAsh, Qiubai and Thorns module/talent migrations remain outstanding. This stage does not complete the goal.

S74 evidence SHA-256 receipts:

- `attack-s74-module-comparison.json`: `38ef4bef56c2a418c3c89c491848d25fcc5b648513c41cf597a73b9d8b0eb88d`.
- `attack-s74-counterfactual.json`: `51dcba51b8b4f73ae080d8e2783d7f1aeb2a958f480046a6babe042c3298fc7d`.
- `attack-s74-v030-digests.json`: `8a0bf9a2c08acf836b6a14cd6e937c2c04c65f7dea9fd0b67750ee9dafacd438`.
- `attack-s74-v030-diffs.json`: `388d0c3c5c10865b1c1021f22f09c50c1db6943ed6e2c5d22e61b435dfed77b0`.
- `attack-s74-first.json`: `31143885a5b09f8205363bffd090746652c8fa8b47dd521e3ac73c10d9ee4b71`.



### S75: SilverAsh source calculation, skill and elite multipliers

SilverAsh's old module is a `damaged` observer limited to physical `isAttack` hits. It emits a base arts NORMAL
instance without skill scaling. New: source `damageCalculate` triggers the common arts rider installer, emitting
sourced arts **ADDITION**, **NONE**, **precomputed**, with parent origin. There is no invented physical, NORMAL
or attack-family filter; the native **svrash_e_002_tr** has none. Precomputed/resolved parents, source-less credit,
gauges and HP loss do not enter this source callback. The precomputed child does not repeat source calculation.

[PRTS SilverAsh](https://prts.wiki/w/SilverAsh) explicitly places X's extra damage at calculation and describes it
as precomputed arts ADDITION; S1's notes say its attack multiplier improves the module's base value, and talent
notes say the elite/boss multiplier also improves that base. Native **svrash_e_002_tr** has the matching
CheckCharacterNextAttackOrCombatSkill → skill **atk_scale** branch and independent ELITE_AND_BOSS branch
reading **svrash_e_002_t[atk]**. That talent template applies AtkScaleUp only on source calculation, so the child
includes the same factor in its input rather than replaying the parent's source callback.

Implementation separates these two factors. Like Ayer, an S1 projectile's retained **isAttack && isSkill** flags
preserve eligibility after launch ends the pending skill. Elite/boss detection reads actual boss/rank metadata;
the talent's **atk_scale** is distinct from the lord trait's ranged **atk_scale**. Shipped SilverAsh chess forms
use stage 1, whose talent has no such multiplier (factor 1). Injected stage-3 blackboard **1.15** tests independently
exercise NORMAL/ELITE/BOSS, both ordinary and natural pending-S1 attacks, checking that primary and child each
receive the elite factor exactly once. This is native branch coverage, not a claim to have added or validated a
higher-stage selectable SilverAsh loadout. Complete nested ability ownership remains separately outstanding.

Independent S74/current real-attack fixtures (ATK **826.56**, no RES; Pegasus equipment raises ATK to **1121.76**):

| Fixture | Old | New |
|---|---|---|
| Ordinary | 826.56 physical +82.656 arts NORMAL; 2 source calculations | Same HP, arts ADDITION; 1 source calculation |
| S1 at 2.25 | Primary 1859.76 +module 82.656 | Module 185.976 +primary 1859.76 |
| One count shield | Primary absorbed; module 82.656 removes HP | Module absorbed; primary 826.56 removes HP |
| Physical dodge | No module; no HP removed | Primary dodges, module independently removes 82.656 HP |
| Source callback ×2 | Primary 1653.12 +module 165.312; 2 callbacks | Module 82.656 +primary 1653.12; 1 callback |
| Pegasus | Two source-less item children (336.528 and 33.6528), module NORMAL | One 336.528 item child; ADDITION module cannot cause the second |

All **12** independent runs have zero errors. The comparator logs `damaged` notifications; old SilverAsh's nested
observer already emits its child notification before the logger sees the parent notification. That logging order
must not be mistaken for pre-injury settlement: the one-shield HP values independently prove the changed phase.
The default/alternate tier-4, lord and Pegasus run reports **155 passes**. Engine/content: **3626 total, 3623 pass,
3 skips, zero failures**. Scoped ESLint is clean. Additional final lord assertions combine skill and elite factors;
only test code changed after the broad run. Final lord suite: **29 passes**; docs: **32 passes**; final scoped ESLint has no diagnostics.

All **288** golden scenarios recompute with every battle/match error field zero. Relative to S74, nine summaries
move: **roster-012, roster-042, bond-emptyShip-high, bond-sargonShip-high, boss-boss_2-solo, boss-boss_4-solo,
boss-boss_6-solo, hidden-boss_8-solo, hidden-boss_10-solo**. An isolated old-SilverAsh copy verifies all other
server JS equals current, and **deep-restores all nine full S74 digests**, zero errors. The five previously reviewed
scopes (012, 042, emptyShip, boss4 solo, hidden8 solo) retain historical evidence and extend it by this independently
verified delta. The two new scenes (sargon high, boss6 solo) have complete S74 digests **deep-equal shipped 0.3.0**,
so their entire changed scope is attributable to this migration. The two earlier pending fields (boss2 and hidden10
solo) remain pending; isolating this delta does not explain their older unresolved mechanisms.

Current inventory: **108 unaccepted differences, 61 attributed recorded scopes, 47 pending**; 78 summary,
17 counts/snapshot and 13 count-only scenes. First-call traces for all nine are refreshed. No baseline is edited.
Qiubai and Thorns remain to migrate; this is not completion of the settlement refactor.

S75 evidence SHA-256 receipts:

- `attack-s75-module-comparison.json`: `5fe366ef83b40cbdf09a0d9bd99c57a40fff5623506c537541e3e3a2e1a9598d`.
- `attack-s75-counterfactual.json`: `400a8c4474637435c20a2f09de20d376ac8bf5b2b25f069abadcb5ffa9ce7e90`.
- `attack-s75-baseline-proof.json`: `3099c90d487239505e498c0bdd7375e2a42099dc5c1452f329291075772ea3ab`.
- `attack-s75-v030-digests.json`: `76eaead295db3aff9d2196dc6842a39812bb8657d7382c7723196b24b4020bf0`.
- `attack-s75-v030-diffs.json`: `3ed9e1e071e5dae0caa119ac30c15f0eca02e23a29d00c7cfe08b9c4c360cf8f`.
- `attack-s75-first.json`: `6b71009c3186e3349fbc0e2b1ca79bd8bd6997841c573b5a9b0defa6e6ba905a`.



### S76: Thorns module, fixed poison, injury observer and Delta output

Thorns now adopts the settlement contracts directly rather than leaving ambiguous legacy calls:

- **X**: source calculation emits sourced arts **ADDITION**, **NONE**, **precomputed**, with parent origin.
  One common installer replaces both trait afterHit and the manually repeated S2-spike rider. Its optional
  descriptive tags preserve `thorns:lorx`; this does not change eligibility. Native **thorns_e_002_tr** directly
  registers DamageViaAttr ATK/MAGICAL/ADDITION/NONE on ON_CALCULATE_DAMAGE, without an attack-family filter.
- **Poison**: fixed input is sourced **BUFF**, **NONE**, **precomputed**; no source-calculation callback and no
  X re-entry. Native **thorns_t_1**, **thorns_e_002_t**, **thorns_e_003_t** use FixedValueDamage, BUFF,
  `_triggerOnCalculateDamage:false`, `_noSourceDamage:false`, `_ignoreCancelReasonMask:NONE`. Old calls
  were base calculation with `canDodge:false`; that unsupported ignore policy is removed. Ordinary applicable
  cancellation effects now remain available. [PRTS Thorns](https://prts.wiki/w/Thorns) confirms precomputed
  arts/elemental continuous damage, fixed refresh value, X stack basis and Delta's normal-attack-only poison.
- **S2**: an observer held by the actual skill buff replaces late `damaged`. Native **thorns_s_2** listens to
  ON_TAKE_DAMAGE from the enemy side, filters **NORMAL**, has no HP-damage-type filter and does **not** filter
  cancelled instances. The code uses explicit damageAttackType, not dot/addition/splash labels. It excludes HP
  loss and actual source-less damage. The observer is acquired on cast and removed on skill end, preserving
  cooldown, 0.5 s launch delay, per-cast/deployment cancellation and target limits. Acquisition-order fixtures
  cover shield/dodge effects both before and after the skill. Literal-zero injury dispatch remains the shared
  simulator **[ASSUMED]** event policy; that fixture does not prove the client emits a modifier for a zero request.
- **Delta**: **thorns_e_003_tr** registers ApplyElementDamageBasedOnDamageValue at **ON_AFTER_OUTPUT_DAMAGE**.
  Use `damageOutput` and explicit dealElementDamage; the basis precedes target injury and remaining-HP clamp.
  A count-shielded parent therefore still fills the gauge. The old late damaged observer lost that fill.
- **HP loss**: T1 explicitly rejects it even if a legacy origin carries `isAttack`/spike labels; loss is not the
  ordinary attack that applies poison. This retains ordinary blocked-zero behavior rather than blanket-requiring
  positive HP damage. Post-departure ability ownership/timing beyond existing declared assumptions remains
  part of the separate provenance audit, not newly claimed as solved here.

Independent S75/current copies produce **16** error-free fixtures:

| Fixture | Old | New |
|---|---|---|
| X, ATK 730, source calculation ×2 | Primary 1460; module 146 NORMAL; 2 callbacks | Module 73 ADDITION; primary 1460; 1 callback |
| Poison, source callback ×2 | Fixed 140 tick becomes 280; callback runs for it | Tick stays 140; no tick source callback |
| Poison against 100% arts dodge | 140 tick lands due forced ignore | Tick is cancelled; poison remains held |
| S2 against physical dodge | No spike | One 773.92 spike after 0.5 s |
| S2 receiving ADDITION without tags | Incorrect spike | No spike |
| S2 receiving NORMAL with dot/addition/splash labels | Incorrectly filtered | One spike |
| Delta with fully shielded 1000 true parent | Gauge 0 | Gauge 100, parent still removes 0 HP |
| Attack-shaped HP loss origin | Incorrectly installs poison | No poison |

Scoped lord/Thorns tests initially report **60 passes**; added acquisition-order assertions follow the broad
run and change only tests. Final scoped suite: **62 passes**. Documentation checks: **32 passes**. Engine/content: **3645 total, 3642 passes, 3 skips, zero failures**. Scoped ESLint has
no diagnostics. New coverage includes five poison/module forms, real X-spike interaction, shield ordering,
ordinary cancellation, output-before-injury/overkill, independent explicit classes, observer cleanup, and both
modern/legacy HP-loss origins. Earlier failed probes used a wrong test property (`el` rather than `elem`) and
allowed a valid new ordinary attack after ending S2; fixtures were corrected to inspect the actual gauge and
stop that unrelated attack. No production behavior was weakened to pass those probes.

All **288** shipped scenarios are recomputed after the final production edit; every battle/match error field is
zero. Only **diy-072** and **diy-073** change from S75. Restoring only the old Thorns file, with all other server
JS byte-equal to current (including the revised shared installer), **deep-restores both full S75 digests**.
The S75 diy-072 digest additionally deep-equals shipped 0.3.0, so its entire current scope is attributable here.
The older diy-073 scope remains pending; its independently isolated new delta is retained as partial evidence.
Both first-call traces are refreshed. Inventory: **109 unaccepted differences, 62 attributed recorded scopes,
47 pending** (78 summary, 17 counts/snapshot, 14 count-only). Baseline files remain unchanged. Qiubai's module/
secondary damage migration and the other completion gates remain outstanding.

S76 evidence SHA-256 receipts:

- `attack-s76-comparison.json`: `20b33252820bb1d9dee885dfe7181105e3fcbcd0cc637130e729f666448ae585`.
- `attack-s76-counterfactual.json`: `98fea2357f47022fe12e4a0bfbad3fa238514b1093c0ec23c66d72a9bd5c338f`.
- `attack-s76-v030-digests.json`: `0de80e8615e3b0c6676f45bab5376f8b978d8ce485bd3fc513636a5e01f74928`.
- `attack-s76-v030-diffs.json`: `36921048f9cc376423129878e74c8c50db975cd902e022aad1e5b1429401d720`.
- `attack-s76-first.json`: `7eadd57996bcc632a9bee58824ee9fe21d3359bc29c5199b282cd97219b39c4c`.



### S77: Qiubai source calculation, delayed status test and deployment marks

Qiubai's original `trait.afterHit` emits module damage, immediately tests the target's control for 入隙, and only
then rolls/applies 落英. Both children are ambiguous base arts NORMAL. It cannot handle non-attack base damage,
and its WeakSet Y first mark survives later deployments. New code removes this afterHit route:

- Native **qiubai_e_002_tr** is the common source-calculation arts rider: sourced **ADDITION**, **NONE**,
  **precomputed**, parent origin. No HP-type/attack-family filter is invented.
- Native **qiubai_t_1 / qiubai_e_002_t** creates a **0.1 s target-held effect** at source calculation. Its
  **ON_BUFF_FINISH** checks UNMOVABLE or `sluggish`/`sluggish[inf]`, then emits precomputed arts ADDITION.
  The X upgrade multiplies its ATK ratio only when both conditions hold. The predicate is evaluated at finish,
  not at parent damage. Exact native keys **qiubai_talent_1[damage]** and **qiubai_e_002_t[damage]** remain distinct,
  so a base/Y and upgraded-X talent on the same target do not overwrite each other merely because both are Qiubai.
- Native **qiubai_t_2 / qiubai_e_003_t** also listens to source calculation: all sourced non-precomputed HP
  damage can try to bind, not only `isAttack`. A bind applied in that same calculation can enable the delayed
  gap. Y's immutable first mark is per source deployment; a per-target WeakMap stores deploySeq. This preserves
  repeat hits during one deployment and resets when the source redeploys. Source-less credit, HP loss and gauges
  never enter this ordinary source-calculation path; precomputed/resolved parents skip it.

[PRTS Qiubai](https://prts.wiki/w/Qiubai) independently states the **0.1 s later status check**, precomputed arts
ADDITION, all non-precomputed source damage eligibility, and the Y non-first mark's source-deployment lifetime.
The native default/upgrade pending templates use maxStackCnt 1, DEFAULT override and no independent source.
Reapplication is implemented with the engine's simplest **replace** policy **[ASSUMED]**; exact client override/
finish behavior for repeated same-key applications remains unsettled. Relative acquisition order of the
DEFAULT-priority talent and module listeners uses talent registration before module **[ASSUMED]**. Neither
assumption is represented as proven game equivalence. Multiple-source competition on a same pending key uses
that same qualified policy; separate native keys have independent real-copy coverage.

The finish callback is tied to the held target effect. An absolute scheduler removes only that exact instance
at its deadline, invoking the same finish on explicit removal. This corrects a real experimental timing error:
the general buff pass can immediately decrement a buff created before it, making a direct base request at t=1/30
resolve at t=0.1 (only **0.0667 s later**). The final absolute deadline resolves at t=0.133333 (**0.1 s later**).
Natural attack at t=0.1 resolves at t=0.2. Identity checks prevent an old scheduled expiry removing a replacement;
removal/expiry cannot resolve the same instance twice. This is local effect scheduling, not a global buff-timing
rewrite. Tests assert actual event timestamps, not just a frame count. Deferred source-attribute/lifetime details
outside existing Unit semantics remain subject to the separate ability/provenance completion gate.

Independent S76/current fixtures (**14** runs, every error field zero; X ATK **753**, Y **748**):

| Fixture | Old | New |
|---|---|---|
| Bound natural attack, source callback ×2 | Primary 1506, module 150.6 NORMAL, immediate gap 722.88 NORMAL; 3 source calculations | Module 75.3 ADDITION, primary 1506, gap 361.44 ADDITION at +0.1 s; 1 calculation |
| Control added after the primary | No gap | Status at +0.1 s enables gap |
| Sluggish expires in 0.05 s after calculation | Immediate gap 361.44 | No gap at +0.1 s |
| Y first attack physically dodged | Bind applied late but no same-instance gap | Bind at calculation, gap 321.64 at +0.1 s |
| Non-attack base true damage | Only primary 100 | Module 75.3 +primary 100; guaranteed bind fixture enables gap 361.44 at +0.1 s |
| Precomputed parent on bound target | Only primary 100 | Same; zero source calculations, no module/gap |
| Y target revisited after source redeployment | WeakSet prevents new first bind | New deploySeq gets guaranteed first bind and delayed gap |

Scoped tier-6/alternate/lord tests: **153 passes**; documentation checks: **32 passes**; final scoped ESLint is clean. Engine/content on final production: **3659 total, 3656 passes,
3 skips, zero failures**. Coverage includes delayed added/expired statuses, ordinary dodge, precomputed/resolved
exclusion without a bind RNG roll, all-source base damage, source-less credit/loss/gauges, source re-entry, Y
redeployment, pending replacement as an explicit simulator assumption, separate native keys from real copies,
explicit removal and the infinite sluggish key. Native default acquisition/reapplication uncertainty remains as
stated above; passing tests establish the implemented contract rather than settle those client details.

All **288** scenarios recompute after final production changes with every battle/match error field zero.
Thirteen summaries move against S76: **roster-017,019,036,037,046,047; boss-boss_1-pair, boss-boss_3-pair,
boss-boss_5-pair, boss-boss_7-pair, hidden-boss_9-pair, unite-2; solo-NORMAL-2**. An isolated old-Qiubai tree
verifies every other server JS equals current and **deep-restores all 13 complete S76 summaries**, including the
full match's separate engine/logged/sim/dispatcher error fields. Four new scenes (036,047,boss1 pair,solo NORMAL2)
have full prior S76 digests **deep-equal shipped 0.3.0**. Five prior reviewed scopes (017,019,037,046,boss3 pair)
retain historical evidence plus the isolated current delta. Four earlier pending fields stay pending; proving
this delta alone is insufficient to attribute their older deviations. All 13 first-call traces are refreshed.

Current audit: **113 unaccepted differences, 66 attributed recorded scopes, 47 pending**; 84 summary,
16 counts/snapshot and 13 count-only, with 21 historical-wrapper no-significant-call-delta scenes. No golden
baseline is changed. The five lord riders now use the explicit settlement contracts, but remaining caller/
provenance, scenario review, migration-guide and final CI/golden gates are still required before completion.

S77 evidence SHA-256 receipts:

- `attack-s77-comparison.json`: `07a21b0f3b4ac5361977edcf9d30fac3a4656a40dff9189dcb5eba8739dc84ec`.
- `attack-s77-counterfactual.json`: `ddf1184f8863390511e61ba9901a3245f78fcd0fc258b2dbe7f25cb0495e1f98`.
- `attack-s77-v030-digests.json`: `7641834b61b7265040837a3504d78e1db9b6b8e128750ee1dab631476067eab2`.
- `attack-s77-v030-diffs.json`: `a3ba3cbb0378663a5e50129c4cc71aec7fdbf17e7216c847f5196fa5735dcc1d`.
- `attack-s77-first.json`: `12db0f3dbd9d39e59e807853337afae56b47b5ba47ea7122a381c17a22d8ad12`.



### S78: Current pending-scene reconstruction, isolated Lappland/Pegasus and restored S72 scope

**No production change.** The latest production/digests remain S77. This review first tests all **47** pending
scenes in a current-source copy restoring only twelve controlled files: old Reaper behavior, special-HP
notification basis (not the whole old early pipeline), reversed penetration order, Vendela counter phase/
registration (retaining current grant lifetime/route), old Hoshiguma armor/thorns kit, both Tinman kits and the
five old lord callers. All other server JS is byte-equal to S77. These are known named mechanism reversals,
not replacement of the settlement engine with its original implementation. The full diff of the three core
files and Vendela was inspected before using the result. All 47 scenarios have zero runtime errors.

That group restores **bond-siracusaShip-high** only; **roster-006** reduces to damaged/dodge counts and several
full matches reduce to Boss/LP/stat residuals. A second controlled copy extends only the old Pegasus handler,
old Kazimierz behavior and corresponding old Mlynar kill eligibility. Their precise diffs are inspected; no
other item or bond handler is rolled back. All 47 scenes run again, every battle/match error field zero.
The extension additionally restores **boss-boss_3-solo**, but grouped restoration alone is not the final proof.

**Lappland isolation:** a current S77 copy restoring just `chess_char_2_16-whitew.js` (every other server JS
byte-equal) deep-restores the complete bond-siracusaShip-high summary to shipped 0.3.0, and the complete
roster-006 summary to S70/S72 production. Native **whitew_e_002_tr**/S73 already establish source-calculation
precomputed arts ADDITION, independent child injury and no source-calculation replay. Old afterHit versus
new source phase/classification are thus isolated here; the counts-only bond has no unexplained other field.
No client mechanism is newly invented to fit these results.

**roster-006 retained proof:** the current twelve-file reconstruction's entire digest is deep-identical to
S72's combined Tinman reconstruction, not merely similar in two counters. Its only remaining fields against
0.3.0 are **damaged 583→591** and **dodge 3→8**. After normalizing those two **HOOKS-indexed columns**, the
whole digest deep-equals original, including every snapshot/RNG/stat field. S72's independently retained
notification proof enumerates all eight Mudrock absorbed-zero notifications (2_18_b ×4, Tippi ×1, 3_04_a ×3)
and all five new Tippi dodge reports; it is not inferred again from count differences. Combined with the isolated
Lappland delta, this re-attributes the current roster-006 scope. S72's native/source/lifetime qualifications
remain intact; no baseline is accepted. The first verification attempt addressed hooks as object properties,
whereas serialized golden hooks are positional. It failed and was corrected to the exported HOOKS indexes;
only the corrected full deep-equality result is used as evidence.

**Pegasus isolation:** a thirteen-file copy (first group plus old Pegasus) restores boss-boss_3-solo. A fresh
process is then used for each of thirteen removal trials, replacing one old file with current production.
All **twelve** other restorations can be dropped; only the Pegasus item handler is retained. A final complete
scenario run still deep-equals original 0.3.0. Source verification confirms every other server JS is byte-equal
to current, and the item-file change is limited to **chess_item_6_01_e**. The result is therefore stronger than
an association with an old first damage trace or restoration of a broad mechanism bundle. The S63 independent
[PRTS lower-half Pegasus](https://prts.wiki/w/卫戍协议：盟约_下半/PRTS盟约记录) evidence establishes the new
source-less credited true ADDITION, scaled parent input, exclusion of ADDITION and settlement before parent
injury; its resolved-input qualification remains [ASSUMED]. All boss-scene statistics, HP, fatal/report counts
and snapshots restore in the isolated experiment. No additional old bond/Mlynar behavior is needed for it.

In total **112** counterfactual scenario runs: 47 +47 grouped, two Lappland isolation, one initial thirteen-file
Pegasus check and fifteen minimization runs (initial +13 trials +final). Every recorded runtime error field is
zero, including all four full-match error fields. Deep comparisons verify every fully restored summary rather
than relying on compareFamily's bounded path output. The three current scopes above close; the other **44**
remain pending. The grouped full-match Boss/LP residuals are findings for further investigation, not an approval
or proof of native equivalence. Review count: **69 attributed scopes, 44 pending, 113 unaccepted differences**.
Production remains S77: all **435 server JS files** are verified byte-equal to the preserved S77 archive.
Documentation checks report **32 passes**. No full CI or golden-baseline update is claimed for this review-only stage.

S78 evidence SHA-256 receipts:

- `attack-s78-source.json`: `2652f4be2ae17e7aa11d5363fa75ac9d3a1672f0ba78ec7ac5440fb97c7d8f94`.
- `attack-s78-extended-source.json`: `71d512f7521f23375be2b5f35aa1726dad8b4ebc72f40e45eaff9022be5fe8c7`.
- `attack-s78-combined.json`: `bd0c1a4743a67daf80a904f6de3d44b385cb0a20f7fe0bf17b91ed68f8e281d8`.
- `attack-s78-extended.json`: `198c4c27cecddae35f0899e8e6db4d9a393fe062edef27720e65fa43ab537a92`.
- `attack-s78-whitew.json`: `585914293ad005f826e60abfd64a98dd57cf0a8c7f217477f444160e3d073665`.
- `attack-s78-pegasus.json`: `0ebd506d0f693a07689947862a0763494f529996e34183bf8bb39e2e558ebcc1`.
- `attack-s78-minimize.json`: `f75e452ff5d49c50ae5e467c3b773a4b795aac169d07c567cc1ed2ac8128b06e`.
- `attack-s78-minimize-source.json`: `5eb4229d3f3164b042bfeb7d4e7168ee608666aa7cdd51e5af6cfcb249d1334a`.
- `attack-s78-verify.json`: `b658d00412e691c186c381c4c547739f6394465e14fb08a8dd6025b98be873a6`.

- `attack-s78-production-proof.json`: `38584190622d3bf1ae9a4c7b1aba862500a4cb57fa17329b6127ebfd2ec81b60`.



### S79: Yu precomputed contract, isolated pulse order and migration guide

Investigating roster-016's first divergence returns to **礼尚往来**. The original 0.3.0 caller dealt arts before
burn gauge. S40 already corrected this to gauge first and melee-route BUFF; the S78 prototype still omitted
`calculation: 'precomputed'`, however. This is an important distinction: original 0.3.0 did not expose the new
source-calculation event, whereas the pre-S79 prototype could now replay it for this unchanged legacy call.

The pinned native **yu_t_1[enemy]** action list is unambiguous: ApplyElementDamage FIRE first, then
AdvancedApplyDamage MAGICAL, **BUFF**, **MELEE**, `_emitSourceOnCalculateDamage:false`, `_noSource:false`,
`_skipModifierEvent:false`, `_ignoreMissFlag:NONE`, `_ignoreCancelReasonMask:NONE`. [PRTS Yu](https://prts.wiki/w/Yu)
also explicitly states gauge-before-arts and melee-route arts continuous damage. S79 makes the HP pulse an
explicit object request with **precomputed / BUFF / MELEE**, preserving actual source, amount and ordinary
applicable defenses. This suppresses only the source calculation event; target calculation and injury remain.
It does not reverse the already verified S40 order.

Independent pre-S79/current fixtures add a deliberate source-calculation callback that doubles input. Normal
ATK **548**: S78 has one source calculation and arts **438.4**, current zero calculations and arts **219.2**.
Elite ATK **724**: old **579.2**, new **289.6**. Gauge amounts are unchanged (**65.76 /99.912**, elite includes
its existing element multiplier), actual source retained. All four runs have zero errors. Six new real-blocking
fixtures cover both forms through no defense, 100% arts dodge and a count shield: zero source calculation,
one target calculation, separate gauge intake, correct class/route and ordinary defense behavior. A first
fixture used a guessed unprefixed blackboard field; its NaN expectation was corrected to the actual official
`yu_t_1[enemy].atk_scale` key. Production behavior was not changed to accommodate that failed expectation.

Scoped Yu/tier-6/native-stage tests: **136 passes**. Full engine/content: **3665 total, 3662 passes, 3 skips,
zero failures**. Scoped ESLint is clean; documentation checks report **32 passes**. All **288** scenarios recompute after the final source edit; every
battle/match error field is zero. The **entire digest object deep-equals S77**, not merely the difference set.
Thus this source-event contract correction is fixture-visible but introduces no new shipped-summary movement;
no golden file is edited. Earlier recorded scenario scopes remain valid for their observed summaries.

**roster-016 isolated order proof:** a current copy reverses only these two pulse operations, retaining the
current precomputed BUFF/MELEE descriptor. Every other server JS is byte-equal to S79. Its complete digest
**deep-equals original shipped 0.3.0**. This is stronger than the earlier six-path residual or first-call hint:
S40's action order explains all recorded HP/stat/snapshot differences in this scene. The counterfactual is not
a proposed gameplay fix: PRTS and native require the production gauge-first order, which can let that pulse's
arts damage use the burst's RES reduction. roster-016 now closes as an attributed scope, baseline unaccepted.

A controlled sixteen-file extension adds this old-order-only Yu to S78's fifteen-file reconstruction. All **44**
previously pending scenes run, every error field zero (including the four full-match error fields). Against the
prior reconstruction, only roster-016 and coop2-NORMAL-14-standins change. Only roster-016 fully restores;
the stand-in match and all other **43** scopes remain pending. Boss/LP/stat residuals in the other matches are
not explained by this experiment; no generic shared-pool claim or blanket acceptance is made.

The new [settlement migration guide](../SETTLEMENT.md), linked from SIM/ARCHITECTURE, consolidates the five
operations and actual source versus credit, HP elemental damage versus gauges, native class versus attack
flags, precomputed versus resolved input, cancellation policies, injury observers versus legacy notifications,
healing modes and the already-mitigated positional loss boundary. It explicitly states original-module/alias
deprecation versus same-name positional overload support, and that parent origin is not complete ability
ownership. The guide describes current behavior; final acceptance and unresolved native assumptions remain
in this ledger, not hidden by the guide's examples.

Current inventory: **113 unaccepted differences, 70 attributed recorded scopes, 43 pending**. Production
checkpoint is S79; summary data is deep-equal S77. Full final CI, remaining scenario/caller/provenance review
and the final migration acceptance gate remain outstanding.

S79 evidence SHA-256 receipts:

- `attack-s79-yu-comparison.json`: `0dc2edd6200fa28d473a580c152c00c107af6359350be2c6a5e2bbfb19713e81`.
- `attack-s79-yu-order.json`: `18730e55b85e093b4981b5bf0162b68ac659c6cee95e4c488afa82fbf327532a`.
- `attack-s79-combined-source.json`: `c408be632b0860c711d57ccb2fc42aa09d5ec84cd363355347fe36940f44d9f5`.
- `attack-s79-combined-yu.json`: `f905c1768cf2f69ed322933bb15489a76c51a6e47351bf727202eaff7d67a43e`.
- `attack-s79-v030-digests.json`: `7641834b61b7265040837a3504d78e1db9b6b8e128750ee1dab631476067eab2`.
- `attack-s79-v030-diffs.json`: `a3ba3cbb0378663a5e50129c4cc71aec7fdbf17e7216c847f5196fa5735dcc1d`.
- `attack-s79-verification.json`: `85e89f77ced08b204a57bf9b5b4077987ffb6d01dc496496d33639ceddd71c61`.



### S80: Ordered target multipliers, generic dodge isolation and cancellation metadata

The historical first differences of **diy-102/124/131** point to held shield amounts: Phantom, Silence alter
and Nasti. The same HP/RNG/input can encounter different shield capacity because a later vulnerability or
protection was previously multiplied globally before every shield. [PRTS injury effects](https://prts.wiki/w/伤害规避效果)
explicitly orders effects by priority then acquisition, and skips later avoidance effects after cancellation/
zero while observers can remain. Native generic **evade_physical** and **shield_physical** are DEFAULT
ON_TAKE_DAMAGE effects; Phantom's existing skill provides those held effects. Production keeps the ordered
pass; it is not changed to fit the old baselines.

**Target-formula isolation:** a two-file copy aggregates the target's taken multipliers into calculateBaseDamage
using the old formula multiplication order, and suppresses only their repeated per-buff multiplication in
injuryEffects. It retains current penetration, shield ordering/resources, specialized injury callbacks, observers,
source classification and cancellation policy. All other server JS is byte-equal to S79. All **43** pending
scenes run. **diy-102, diy-124, diy-131** each **deep-equal their entire 0.3.0 baseline**, including every
snapshot/HP/stat/RNG field. The first-call shield examples are old/new Phantom **415.998/498.19**, Silence
alter **465.4579375/310.232732**, Nasti **18.6912/288.7632**; these are held capacities at the divergence, not
initial grant amounts. Restoring the old aggregate formula explains their subsequent full scene scope.
A second group adds this formula to the prior sixteen known-mechanism reversals; its same three restorations
confirm no extra reversal is required. Both sets of 43 runs have every error field zero.

**Generic dodge isolation:** two further copies add old generic aggregate dodge before calculation/injury and
suppress only generic per-buff dodge rolls. Current specialized callbacks remain. The resulting groups use
three/eighteen controlled files and run all 43 pending scenes each, every error field zero. These are limited
counterfactuals, not aliases to the original engine. They use generic dodge FX to study counts/state; complete
golden digests do not encode yellow-MISS payload. Production's display classification remains separately
covered by S56, so a restored summary must not be called original-client render equivalence.

A smaller independent copy keeps **current target multiplier order**, changes only generic dodge placement/
aggregation and the **old special-HP notification basis** (not the whole old early special-HP pipeline).
It **deep-restores roster-034 and roster-041** completely. The generic-dodge-only group had exactly seven/
eleven extra damage-number events; the basis reversal removes those residuals. These scopes therefore need
neither the broad sixteen-file bundle nor the target-formula reversal. PRTS's per-effect priority/acquisition
rule and S46's special-HP damage basis are the named production corrections; old early aggregate rolls and
HP-delta-as-damage notifications are counterfactual only.

**roster-028** reduces to just **hooks.damaged 665→666** in that same small copy. After normalizing only the
HOOKS-indexed damaged column, the complete digest deep-equals 0.3.0. Independent notification capture has
**2061/2062** events and every runtime error field zero. The sole count difference is a **zero arts** damaged
notification at **52.5 s**, source **chess_char_4_02_a**, target **enemy_1509_mousek** (Mouse King), whose native
arts barrier fully absorbs the instance. Old early hit cancellation emitted no legacy notification; the new
absorbed-zero compatibility path emits one. All other HP/RNG/stat/snapshot fields agree after the generic-dodge
reconstruction. This is the retained S14/S32 legacy reporting contract, not a positive damageApplied event
or a claim that a client native success trigger runs for absorbed damage. The scope closes with that qualification.

**Actual core correction:** inspecting this result exposed inconsistent observer metadata. Numeric full shields
already emitted `block` with cancellation accepted, but observeInjury saw `cancelled:false` because the same
internal flag also decided whether to call legacy zero bookkeeping. Full count/pool absorption now sets the
canonical cancellation state. A separate private **notifyZero** continuation preserves existing absorbed-zero
HP/bookkeeping/legacy behavior; explicit callback block and dodge still stop it. Ignoring block cancellation
keeps amount and observer cancellation false. This makes the observer contract agree with the block event,
without conflating a compatibility notification with successful damage. Six count/pool/callback, accepted/
rejected-cancellation cases now assert observer amount/outcome/cancelled, the legacy notification list and
absence/presence of positive damageApplied. This is an interface consistency fix, not new evidence for an
unobserved native callback order or complete client cancellation internals.

Scoped effect/cancellation/API tests: **75 passes**. Full engine/content: **3665 total, 3662 passes, 3 skips,
zero failures**. Scoped ESLint is clean; documentation checks report **32 passes**. All **288** current scenarios recompute; every error field is zero and
the **entire digest object deep-equals S79**. Before the correction all 435 server JS files were byte-equal to
the S79 archive; after it the only production JS difference is effects.js. Counterfactual source manifests
are explicitly against S79, and the full S80 summary identity carries these recorded scopes forward.

The four broad groups total **172** controlled scenario runs, plus three smaller dodge/basis runs; separately
verified old/new notification traces identify the one roster-028 residual. Every complete restoration is
checked with deepStrictEqual rather than trusting bounded compareFamily paths. No golden file changes.
Six scopes close: **113 unaccepted differences, 76 attributed recorded scopes, 37 pending**. The migration
guide now explicitly separates observer cancellation from a possible later legacy zero notification. Remaining
caller/provenance and scenario reviews, final migration acceptance and full CI/golden gates remain outstanding.

S80 evidence SHA-256 receipts:

- `attack-s80-legacy-taken-source.json`: `a40861736a016a72fadbb0e9e9dcc37ff0d244ce9bb3eec30c4f3d0d316d9f65`.
- `attack-s80-combined-legacy-taken-source.json`: `64d47e09cfa8ff0169ad141129899c00895949a4fa04b2c9d92d573bb0893934`.
- `attack-s80-legacy-taken-dodge-source.json`: `0f447ca0a9ce19597f4f1ae136745c56446f75af73774216b7fcb62b7ceabad5`.
- `attack-s80-combined-legacy-taken-dodge-source.json`: `759e149e1a7509e405a7153e341000360db86b291a9d38116ccccc0557d6124b`.
- `attack-s80-legacy-taken.json`: `3bb6c5c7b8169d408c1ce6be5fbdc19be2a88f03be8464cb373de6df199aaa3f`.
- `attack-s80-combined-legacy-taken.json`: `aa681832518abf6a0b1cdef1a0faff7149a754a13743b9ce86cc47c1ab691bb2`.
- `attack-s80-legacy-taken-dodge.json`: `e29af71af64e160678c1cab698ef02b586f3959ec9b767883585cfa66cd36ac1`.
- `attack-s80-combined-legacy-taken-dodge.json`: `daa8ddbce01a5e130145e4becfdd979df9ea98203683fbc3d52159bb281b1082`.
- `attack-s80-verification-legacy-taken.json`: `adce6592002a907ee93c55256dce1622400e90ae0d6b6ce360c98085898745ae`.
- `attack-s80-verification-legacy-taken-dodge.json`: `fa02da82897e9527fc3bd04cb7d0057d2ce07241e71f8f548155af82b3661c8d`.
- `attack-s80-dodge-count.json`: `3db4c176170bb2e7c9557c51f8a75f6eb3311fdd934e06d2f10e70c3a4eaa64a`.
- `attack-s80-dodge-count-source.json`: `96af505af751fb387609e58777bd7906bf6313b77b071df0e8aaee9289cc9ab1`.
- `attack-s80-roster028-notifications.json`: `7d24fcabe527005fcf0642d8aaa140eb4ffa7eccd4b1b9c638727b420220394f`.
- `attack-s80-production-proof.json`: `08a64e00ed3a4ebb19745b1d388334fa95f29d5089526aeab83b9100709ff0f3`.
- `attack-s80-current-source.json`: `679529af7f23b31906835846b104fbcc19ef279de7c76ac6552b37991ce0f196`.
- `attack-s80-production-verification.json`: `d3c28574a4dd59730ebda6ec39de4aea458b9ea8a96f06be1299254662f1db81`.

- `attack-s80-v030-digests.json`: `7641834b61b7265040837a3504d78e1db9b6b8e128750ee1dab631476067eab2`.
- `attack-s80-v030-diffs.json`: `a3ba3cbb0378663a5e50129c4cc71aec7fdbf17e7216c847f5196fa5735dcc1d`.


### S81: Enemy count shields, early-cancellation propagation and complete scene reconstruction

**No production change.** All 435 server JS files are byte-equal to the S80 archive, SHA-256
`68e3c7fff3e7437489eecbb3323cc46dd15b40ef9ab1dcef7b2861cd96cad3bb`.
S80 remains the production/digest checkpoint; S81 is a causal review and one integration regression.

A narrow two-file counterfactual restores the old enemy count-shield state in `mem.ab.hitShield` and its
late-hit cancellation, retaining every other current mechanism. Both the Rhine personnel's spawn and the
regeneration aura still call the shared grant helper. All **37** pending scenes run without simulation errors,
including every full-match error field. Six full summaries deep-equal the shipped 0.3.0 baselines:

- `bond-swiftShip-low`, `coop2-NORMAL-70-diy`, `standin-08`, `diy-026`, `diy-086`, `diy-114`.

The restored early branch is evidence of the cause, not the production choice. Native
`enemy_lysdb[damage_block_once]` and `[damage_block_fixed]` use DEFAULT ON_TAKE_DAMAGE, with separate
PHYSICAL/MAGICAL BlockDamage filters. [PRTS Rhine defence personnel](https://prts.wiki/w/莱茵生命防卫科高级成员)
confirms one layer of physical/arts shielding and links its interactions to [伤判效果](https://prts.wiki/w/伤判效果).
The ordered production path (S43) therefore remains. It does not silently suppress earlier source calculation,
output or before-target-apply events, and observers can still see absorbed injury. Legacy zero `damaged`
notifications remain distinct from positive `damageApplied` (S32/S80).

For example, the existing diy-026 first witness has identical Typhon input **1219.9** and 10% DEF ignore,
but an earlier shielded Naran Tuya hit now steals DEF **21**. The next input removes **968.8** instead of
**949.9**: `(300 - 21) × 0.9` instead of `300 × 0.9`. A separate old/current real-kit/real-enemy fixture
reproduces these values for both T5 normal and T6 elite Naran Tuya. The first shielded 1000-physical hit removes
zero HP in both; old theft remains `{a:0,d:0}`, current theft is `{a:27,d:21}`. No engine errors occur.
Native `narant_t_1[steal]` / `narant_e_t_1` explicitly use ON_BEFORE_TARGET_APPLY_MODIFIER and require a live
target; [PRTS 娜仁图亚](https://prts.wiki/w/娜仁图亚) documents the full-potential 27/21 theft. The buff template
establishes the before-apply stage; it does not independently establish complete ability attachment ownership.

Restoring only Naran Tuya's old late `damaged` listener, including its lack of a live-target condition, restores
**none** of the 37 complete summaries, alone or with the prior known-mechanism reconstruction. This is why
an earlier first differing call was insufficient to approve diy-026. Combined with the old early shield, that
old Naran Tuya listener drops out of every reduced successful group below.

Adding old count-shield cancellation to the previous known-mechanism reconstruction restores eight additional
summaries. Each starts from current production and only the 21 manifest-listed old files; a fresh process tests
each ordered per-file removal. The final retained files still deep-restore the entire shipped summary, and every
non-retained server JS file is byte-equal to S80. These are greedily reduced groups, not globally minimal proofs. **S84 supersedes the split-stage raw candidates with verified coherent repairs**; see the S84 correction below and the current per-scene evidence:

| Scene | Retained reversals besides the two enemy count-shield files |
|---|---|
| roster-038 | Reaper timing; penetration/target multiplier formula and injury application |
| bond-suntShip-low | Penetration/target multiplier formula and injury application; Hoshiguma |
| boss-boss_2-solo | Generic dodge; Hoshiguma; SilverAsh module |
| boss-boss_7-pair | Penetration/target multiplier formula and injury application; Qiubai |
| unite-2 | Penetration/target multiplier formula and injury application; Qiubai |
| coop4-FUNNY-6 | Penetration/target multiplier formula and injury application |
| standin-09 | Penetration/target multiplier formula and injury application; generic dodge |
| diy-073 | Special-HP notification basis; Thorns |

The retained arithmetic file combines the already documented old penetration and target-taken expressions;
no finer single-expression necessity is inferred. Hoshiguma/Reaper/SilverAsh/Qiubai/Thorns retain their
previously recorded native evidence and timing/ownership qualifications. The old generic-dodge reconstruction
uses generic FX; full summaries do not verify the yellow-MISS payload. The separate mode cap's pre-injury
position remains [ASSUMED], not newly established by shield template data.

Four initial groups run all 37 scenes (148 runs); eight greedy reductions each run initial + 21 trials + final
(184 runs). All **332** runs have zero simulation errors. An independent receipt verifier checks every complete
restoration with deep equality and checks every retained source hash/non-retained server file. Four independent
real-kit fixture runs also report no errors. Production summaries and golden files are unchanged.

One real-enemy Naran Tuya regression covers two forms: theft before absorption, cancelled zero observer state,
no positive-damage event, and the next source-less input using reduced DEF without stealing again. Focused
Naran Tuya/cancellation tests report **43 passes**; expanded enemy/Naran Tuya/cancellation tests report
**319 passes**, zero failures/skips. Scoped lint reports no diagnostics. Documentation consistency/path checks report **32 passes**. These are intermediate checks.

Current inventory: **113 unaccepted differences, 90 attributed recorded scopes, 23 pending**. Neither the
native caller/provenance completion gates nor final CI/golden acceptance is claimed complete.

S81 evidence SHA-256 receipts:

- `attack-s81-production-proof.json`: `eb2a50e4c0adabc980f981706dd48120add4577f825c788a1f64bec755953fff`.
- `attack-s81-narant-source.json`: `4308ae2d1d8e0cf933fab9f18fcce1c413f3c38f0fdcc1c532414c2a0b306ca1`.
- `attack-s81-combined-narant-source.json`: `b16126d31414ad1b561c59bacc537a4535d2293832bf8a952f678949fdda234b`.
- `attack-s81-early-shield-source.json`: `7bcbeca54162bbc060af4bdf20c4d1d72b8e183de628f2a7d0b91e72ba155a37`.
- `attack-s81-combined-early-shield-source.json`: `9999ff619656b3b323f1b2ef2b8bafb9ebdc66192385fac4c863ebcc7c625bf2`.
- `attack-s81-verification-narant.json`: `36036de7f2d9f713104ee387256c95f61e388a22d387d81366690af75c2262a1`.
- `attack-s81-verification-early-shield.json`: `88f51dba551af03988a4d94fe104f4e3d5b85be54e1d1519e51f02f4ba6f2bc2`.
- `attack-s81-min-verification.json`: `cd84d4a5ab93877b37dc08a170ddde80432139b688ec3ac47bfdf8c07a3ca96a`.
- `attack-s81-narant-comparison.json`: `ef97cd6c02ebcb827e9e9c928d5f8dff4caa366d31f8fb2c6935925e8d2ed436`.

### S82: Logos T2 source/target calculation and special-HP input basis

Production remains S80. Two controlled groups each run all **23** pending scenarios with every simulation
error field zero. Restoring only Logos T2's old isAttack/early-hit mark and global early-hit arts addition
restores the complete `diy-029` baseline. Other Logos execution, trait, projectile flags and calculation
policies remain current. The prior combined group plus that T2 restoration also restores `diy-030`.
A separate **two-file** reconstruction (only old T2 plus old special-HP notification basis) then deep-restores
all of diy-030, with every other server JS file byte-equal to production. No broad kit reversion is needed.

Native `logos_t_2` creates the mark at ON_CALCULATE_DAMAGE without an attack filter; `logos_t_2[core]` uses
MAGICAL AtkAdditionUpBeforeCalcDamage at ON_BEING_CALCULATE_DAMAGE. Native `logos_s_1.FixedValueDamage`
explicitly enables source calculation, so its inherited-HP follow-up can mark a new target.
[PRTS 逻各斯](https://prts.wiki/w/逻各斯) confirms the addition is after attack scaling/before RES and applies
to that same damage. The recorded diy-029 witness remains **1395.9205→1560.9205**, exactly the new **165**
addition; the whole-scene counterfactual establishes more than that first-call arithmetic. The diy-030
reconstruction additionally reverses S46's special-HP amount/HP-delta distinction, not its production policy.

No production/golden file changes in S82. These two complete scopes bring the review to **113 unaccepted
differences, 92 attributed scopes, 21 pending**. This establishes recorded summary attribution, not client
projectile/priority/ability ownership equivalence. A separate native S1 ordering audit follows before acceptance.

S82 evidence SHA-256 receipts:

- `attack-s82-logos-source.json`: `9f3f8868a0a6e5a89f84af3a58802b2d83b42b3d44a0208f8738da87097be0f3`.
- `attack-s82-combined-logos-source.json`: `c936d08319c19d0a320aca314eba48be1e52b25ddea89300b56a8a1b60dcafcf`.
- `attack-s82-verification-logos.json`: `94b5aece03b18dca6649e7d8cc2d4999329ddb103e8c84bd6c543d2320f1cd6c`.
- `attack-s82-logos-count-source.json`: `6f3062a96edd04e5da863cb1a2a96d1242af4d652e9c3e84fed6df2eb749a63c`.
- `attack-s82-logos-count-basis.json`: `0a04affb470546893b5a7aac5050fd0c21c710a30a846178f44bd5378b1a13bf`.

### S83: Logos S1 talent trigger is death-conditioned and precedes follow-up emission

The S82 native caller audit exposed another difference, not explained by T2: the existing S1 executes the
inherited-HP follow-up first, then calls `lexicon` unconditionally. It therefore grants the talent roll even
when the execution target survives, and omits it when no follow-up target exists.

| Old and S80 | S83 | Native / PRTS standard |
|---|---|---|
| Pick/deal inherited-HP arts, then talent; no target means no talent | After execution, only a dead target triggers the talent, before selecting the inherited-HP follow-up. Surviving targets retain their independent follow-up and once-only spared guard | Native `logos_s_1` orders CheckUnitAlive → IfNot → TriggerBuffsByKeys(`logos_t_1`) → AlwaysNext → EmitProjectileUseAbilitySelector. [PRTS 逻各斯](https://prts.wiki/w/逻各斯) confirms S1 can trigger T1 and separately describes its inherited-HP follow-up |

**[ASSUMED]** The kit already delivers both talent and follow-up immediately. That simulator convention is
retained, now in native action/emission order. Native template data does not establish their relative projectile
arrival times. The new numeric consequences of immediate delivery are measured simulator behavior, not a claim
that the client talent always impacts before the follow-up. This qualification is explicit at the source site;
complete ability ownership and original-client projectile timing are not newly verified here.

Three new regressions each exercise T5 normal and T6 elite Y-module forms: a kill triggers one/two talent
attempts before the follow-up, a fatal-prevented survivor triggers none while keeping its follow-up, and a kill
with no remaining target still attempts the talent. One scheduler tick refreshes spatial/range caches; ordinary
attacks are held off so they cannot supply extra talent rolls. An initial direct-callback fixture skipped those
caches and failed before reaching execution; it was corrected to exercise the actual scheduler.

A separate S80/S83 fixture runs all twelve form/outcome combinations without engine errors. With forced-success
rolls and a single high-HP follow-up target, the old sequence marks it first, yielding talent **695.53 / 1020.61**;
the new immediate sequence yields **530.53 / 855.61**, then applies the inherited-HP hit **465**. These are
consequences of the retained immediate-delivery assumption, not source-proven client impact values. Old survivors
roll once/twice, new survivors zero; old target-less kills roll zero, new kills once/twice.

All **288** current scenario runs have every simulation error field zero. Only **diy-029 / diy-030** change
relative to S80; all other 286 complete digests deep-equal S80. A controlled copy restoring only the Logos file
from S80 deep-restores both changed summaries, with every other server JS file byte-equal to current. S82's
complete old-scope evidence is retained in historicalReviews and this isolated S83 delta is added. Thus the
inventory remains **113 unaccepted differences, 92 attributed recorded scopes, 21 pending**.

The inventory's previously stored paths used the ordinary report's 40-path cap. Current S83 paths are now
independently recomputed with `diffDigest(..., Infinity)`, so every differing serialized summary path is recorded;
prior/current complete deep-equality checks were already uncapped. This does not inspect inside snapshot hashes
or upgrade native-client equivalence claims. No golden file is edited.

Focused source/target-stage and Logos tests report **54 passes**. The complete engine/content area reports
**3669 total, 3666 passed, 3 skipped, zero failures**; scoped lint has no diagnostics. These are intermediate
checks, not final full CI. Documentation consistency/path checks report **32 passes**. Source, history and API reference notes follow this caller correction.

S83 evidence SHA-256 receipts:

- `attack-s83-counterfactual-source.json`: `871d55f8ea11569d984ba126af4e9bed3dbad92c16c49dbc447ce6faec0c5d21`.
- `attack-s83-counterfactual.json`: `5c78b8bea93c1e061a8d176c159ff59c6d1f3b2491471418c7c400850430a795`.
- `attack-s83-comparison.json`: `654b36476dc171ecc705f099dd90dadb1b948247089c2c2be78186396f6fc853`.
- `attack-s83-verification.json`: `cae8ecb7b44e1a74d3742f76dbb676906858e0f1b04a24d8d35665918c3a252c`.
- `attack-s83-v030-digests.json`: `1511a090317deca1d411eb5d452056106fb605b226182155caf410b01b42fb1b`.
- `attack-s83-v030-full-diffs.json`: `7f074fe6455a766b19d6841f1b2981453acf24086ffb722f20c0b7e2e52ef723`.
- `attack-s83-first.json`: `26e2379ac51804d5535cb5a328b6e559d5a2907cd8a08d2f134ed544b66084e6`.

### S84: Executor, Penance, Zuole and Rmixer complete-scene review; paired experiment correction

**No production change.** All 435 server JS files byte-equal the S83 archive (`9a6fd7938ba4f3bb30874748bfb95c10a45b7a80305d89e3f6a542631a0024c7`).
All 288 S83 summaries remain current. Eight counterfactual groups each run the 21 pending scenes with every
simulation error field zero: old Executor S2, old Penance, old Zuole and old Rmixer, alone and with the prior
known-mechanism reconstruction. A one-file Rmixer restoration deep-restores boss4-pair; combinations restore
five more. Every complete restoration is independently deep-compared to the shipped 0.3.0 baseline.

| Scene | Final coherent restoration besides the named operator file |
|---|---|
| roster-014 | Executor S2; old Reaper timing, special-HP basis, penetration/target formula, early generic dodge and enemy count shield |
| solo-ABYSS-2 | Executor S2; old Reaper timing, penetration/target formula, early generic dodge and enemy count shield |
| diy-057 | Penance barrier priority/lifetime and late reflection; old penetration/target formula; current generic injury dodge retained |
| diy-035 | Zuole's old hit/success listeners, barrier refill and reverse protection; old enemy count shield |
| boss-boss_4-pair | Only Rmixer's old late counter/success listener file |
| coop3-ABYSS-5 | Rmixer and Vendela; old special-HP basis and penetration/target formula; current generic injury dodge and current enemy count shields retained |

The last match has a final five-file reconstruction: health, calculation, effects, Rmixer and Vendela. Removing
the previously retained but inert old enemy hit branch still deep-restores the complete match. Each other server
JS file is byte-equal to S83. The rows describe successful known-mechanism groups, not globally minimal causes.

Native/PRTS support for production (earlier ledger stages remain authoritative for exact fixtures):

- `excu2_s_2` uses enemy-source ON_TAKE_DAMAGE and MELEE Evade; [PRTS 圣约送葬人](https://prts.wiki/w/圣约送葬人)
  explicitly gives +2000 priority, four HP types and melee-route semantics. The old early listener additionally
  required isAttack and inferred route from the source profile. NONE matches either route restriction per
  [伤害分类](https://prts.wiki/w/伤害分类); ALL includes either. S26's production policy stays.
- `judge_t_2` observes ON_TAKE_DAMAGE without filtering prior cancellation; `judge_t_1` retains its pool host.
  [PRTS 斥罪](https://prts.wiki/w/斥罪) explicitly gives -1000, one buff and no removal on depletion. S33/S44
  retain the breaking instance's reflection and the original acquisition sequence after replenishment. This
  establishes the trigger/pool audit, not the hidden runtime defaults of InverseDamage: the template exposes
  skipSourceEvent=false / skipModifierEvent=false but no dodge mask. The inherited forced no-dodge policy is
  still **[ASSUMED]**, source-unsettled and must not be presented as newly verified by this review.
- `zuole_t_2` and `zuole_s_3` use output, while `zuole_e_003_talent` uses source calculation. The old hit/success
  listeners interact differently with early count shields. [PRTS 左乐](https://prts.wiki/w/左乐) also explicitly
  places reacquired protection behind S2's barrier. Source output and actual ordered injury (S51/S17) stay.
- `rmixer_sk3` uses ON_TAKE_DAMAGE; T1 separately uses ON_AFTER_OUTPUT_DAMAGE. [PRTS 信仰搅拌机](https://prts.wiki/w/信仰搅拌机)
  specifies any-damage/no-target counters as normal attacks. S39's observer preserves cast-owned lifetime,
  ammo, action and cooldown guards. Restoring its old late listeners explains boss4-pair with no other reversion.

#### Correction to greedy per-file experiment decomposition

The first greedy candidates could split two coupled engine changes: suppressing injury generic dodge requires
an earlier aggregate hit roll; suppressing injury target multipliers requires aggregation in calculation.
An isolated effects.js restoration could suppress either stage even after the corresponding earlier file
was removed. Such raw file-removal results do not by themselves implement the named old mechanism.

Eight affected candidates were rebuilt with the appropriate current injury behavior restored whenever the
pre-stage stayed current: six historical S81 scopes and the new diy-057 / coop3-ABYSS-5 scopes. **All eight**
coherent variants independently deep-restore their complete baselines, with all source hashes/non-controlled
server files checked. S81's six per-scene evidence records now point to these repaired groups; original raw
candidates remain in historicalReviews only. The prior complete broad reconstructions already kept both halves
and remain valid. No causal approval is based on the split-stage artifact, and no production behavior changed.

There are 168 initial broad runs, 10 targeted hypotheses, 120 exploratory per-file runs, 8 paired repairs and
one final five-file match run: **307 successful simulation runs, all engine error fields zero**. The exploratory
candidates are not all approved old-mechanism implementations; only the complete coherent groups above support
attribution. An initial missing temporary runner path was corrected before rerunning the reductions; those
failed launches did not start simulations and are excluded. Generic FX receipts still do not prove native
MISS payload equality or original-client frame timing.

The Mlynar-only / combined-Mlynar hypotheses restore neither tested boss2-pair nor boss4-pair. Reverting only
the fixed-reduction inverse handler, alone or in the prior group, also fails to restore hidden-boss10-pair.
Those complete scopes remain pending; an observed numerical witness is not a whole-scene explanation.

Current inventory: **113 unaccepted differences, 98 attributed recorded scopes, 15 pending**. Production stays
S83; golden files are unchanged. Remaining caller/provenance/flag audits and final CI/golden acceptance remain
open. Documentation consistency/path checks report **32 passes**. This review does not claim all original-game mechanics or InverseDamage runtime defaults are settled.

S84 evidence SHA-256 receipts:

- `attack-s84-production-proof.json`: `6f8dad7d0345d0710a27b21e4932db34650c10a222b8212db77140b88dc8a380`.
- `attack-s84-all-verification.json`: `5c72be174b2c820280cbb521ab916c90663cfcb59b81dc06387438d5efb42a15`.
- `attack-s84-min-verification.json`: `2106776d27689cd8e4e9640f43412b9151fd895ada4a9256020b20f6e961b6c8`.
- `attack-s84-paired-cases.json`: `3c8589f3651ac4677633f0cbc9be35f49c31f8fa1cbafc7fadaffb0c0a7efecb`.
- `attack-s84-paired.json`: `ba56d72a00362debda4d7e8177894ecc9c6630f74a13365a01d4c8850f14ad82`.
- `attack-s84-paired-verification.json`: `00dfd038f9dd868778770fc8d3ccb825b49463237a479ead00eba10c7a5857ac`.
- `attack-s84-rmixer-vendla-source.json`: `ed0e18b48cf2069a6970a9659a7ac5b50a462047ed891aa61fd73f79e5e46240`.
- `attack-s84-rmixer-vendla.json`: `e0f32691876351b4291c7f5376fe8ade49079721a29e23e5115125c382bebe7f`.

- `attack-s84-final-match-verification.json`: `2965d7ee9a51f950f32756942ec53e95086be95e314bab62c5928ba6640456fa`.

### S85: Spring defences reuse native injury effects; reentrant buff removal is safe

The S84 remaining-field trace led to a native audit of the three spring defences. This is a real caller
migration and mechanism correction, not approval of the prior pending complete scenes.

| Old / S83 | S85 | Native / PRTS standard |
|---|---|---|
| Arts pool is a private counter; full subtraction does not report native block cancellation | Held arts-only `shield`, shared full/partial absorption, cancellation mask and legacy-zero contract; observer handles depletion | `actrpa_t_1` has DEFAULT ON_TAKE_DAMAGE dynamic MAGICAL BlockDamage |
| Every physical class is reduced and causes an early actual-source, dodge-ignoring counter | Only physical NORMAL is reduced; its observer also reacts after prior cancellation. Counter is source-less phys ADDITION/NONE/precomputed, ordinary dodge; erosion rider remains separately sourced by the spring | `actrpa_t_1` filters NORMAL+PHYSICAL, modifierCancelled=false, then AdvancedApplyDamage(noSource=true, emitSourceOnCalculateDamage=false, attackType=ADDITION, applyWay=NONE, miss/cancel masks NONE), followed by sourced ApplyElementDamage |
| Element-shield reduction modifies input in early hit | Physical/arts scaling at the held buff's ordinary injury position | `actrpb_t_1`: DEFAULT ON_TAKE_DAMAGE FilterDamageModifer(PHYSICAL_AND_MAGICAL) → ModifierScaleUp |
| Private count cancels phys/arts/true in early hit; elemental HP bypasses it | Shared `shieldHits` accepts all HP types, preserves charges after earlier absorption/dodge, consumes after a rejected block cancellation | `actrpc_t_1`: DEFAULT ON_TAKE_DAMAGE BlockDamage(filterDamageType=false), then decrement and finish |
| Losing a shield also makes the spring blockable | Separate persistent unblockable state survives regeneration | [PRTS “碎铳之簧”](https://prts.wiki/w/“碎铳之簧”) explicitly corrects the handbook's shield-only wording and confirms physical NORMAL for the arts shield |

Both private numeric pool/count fields and their early hit branches are removed. Generic shield machinery now
owns depletion input, block metadata, ignored cancellation, earlier-zero preservation and type filters. The
held observer removes only its depleted defence; it does not remove the permanent unblockable state. The
counter's credit stays the spring for project statistics; that is independent of its actual source=null.
No extra damage engine or compensating inverse formula was introduced.

An independent S83/S85 real-part fixture records these concrete values, with no simulation errors:

| Input / setup | S83 | S85 |
|---|---:|---:|
| 10000 physical BUFF, DEF 1100 | 890 HP and a 120-point counter | 8900 HP, no counter |
| 1000 elemental HP against count shield | 1000 HP | 0 HP, one charge |
| Physical 8900 after DEF, earlier 500 barrier, element-shield scale 0.1 | 390 HP | 840 HP: `(8900 - 500) × 0.1` |
| NORMAL counter with spring output ×2 | 240 HP, actual spring source, NORMAL/base | 120 HP, source=null, spring credit, ADDITION/precomputed |
| Arts overflows and breaks its pool | 7500 HP; blockable | 7500 HP; still unblockable |

Fourteen new real-part regressions cover all five attack classes, count filters/loss/gauges, earlier barriers,
block cancellation masks, target-multiplier/barrier order, counter-after-cancellation, dodgeable source-less
counter with an independent gauge rider, and permanently unblockable regeneration. Existing burst-sharing
coverage now explicitly spends count shields before testing the unshielded transfer: elemental HP can no
longer bypass the shield. The real healer field audit retains its 200-second roaming window (first spring
contact can be at 145 seconds) and verifies healers never block springs, including after shields are broken.

#### Buff removal during nested settlement

The initial full probe exposed one real engine error in hidden-boss9-pair: Qiubai's finishing pending buff
settles damage, depletes/removes an earlier spring pool, and returns to an outer removeBuff loop whose array
index is now stale. Reading that stale entry's key throws. removeBuff now traverses a reverse identity
snapshot and locates each still-held buff at removal time. Nested removals are invoked once; replacements
acquired during callbacks are outside the original selection. This is ordinary lifecycle safety, not a new
native-game timing assumption. Three regressions exercise earlier removal, nested same-key removal and a new
replacement surviving the call. The same-key fixture explicitly permits two independent instances.

Final complete engine/content tests: **3686 total, 3683 passed, 3 skipped, zero failures**. Focused spring/
limit/cancellation tests report **343 passes**; final lifecycle/healer/element coverage reports **28 passes**,
including the 200-second field audit. Documentation consistency/path checks report **32 passes**. Initial validation exposed two obsolete gameplay assumptions
and a one-instance lifecycle fixture setup; they were corrected before the final passing results. Scoped lint
has **0 errors, 6 existing unused-variable warnings** in bosses.js. These are intermediate checks, not final CI.

All **288** final probe scenes have every simulation error field zero. Only hidden-boss9-pair,
hidden-boss9-solo and coop2-ABYSS-10-boosted change relative to S83; other 285 complete digests deep-equal S83.
Restoring only bosses.js from S83 while retaining the reentrant-removal fix deep-restores all three previous
summaries. The earlier failed probe and its error are retained separately as before-lifecycle evidence; it is
not represented as a passing measurement. Current serialized summary differences are recorded without a cap.

The new delta is isolated, but the earlier scope of all three scenes remains pending. Inventory stays
**113 unaccepted differences, 98 attributed recorded scopes, 15 pending**. No golden file is edited.

**Remaining source audit:** `actrpa_passive` uses ON_APPLIED_MODIFIER, whereas `actrpb_passive` /
`actrpc_passive` use ON_TAKE_DAMAGE; current sharing still uses the legacy late taken dispatcher. Their
relative acquisition order and damage/HP-loss event policy need explicit migration. `actrpb_t_1` also drops
at ON_BEFORE_EP_BREAK_START; the retained legacy burst adapter is not claimed equivalent. These newly exposed
boundaries remain completion gates, alongside the earlier provenance/InverseDamage/CI acceptance work.

S85 evidence SHA-256 receipts:

- `attack-s85-production-source.json`: `2b289dc1e2dcb2f516c5cf144826889bbbaac05fb3e0686466437dfd50e55ee1`.
- `attack-s85-comparison.json`: `d866839c3cc363ba20a51be18b9cdc4c0731262ee9a6be37be8edcb12007b626`.
- `attack-s85-counterfactual-source.json`: `1f44631d6fb87fe77cd2da38c1dd82414ea8ac1b103fa17cae242858e6bb477f`.
- `attack-s85-counterfactual.json`: `6ceb08624a3b5a9edfb0400661f03a3164f0288a7d9535e955ebd5da4bc4a080`.
- `attack-s85-before-lifecycle-v030-digests.json`: `3920f10bb21934136fe620158a56abf055bb7622c84376c649c348a416803967`.
- `attack-s85-verification.json`: `3d8ef62c1c7cc49ef300a4990e9e5b6aec95e276e127ca3e3e3fb46ad296e714`.
- `attack-s85-v030-digests.json`: `05a65277d95c83c47c4f64b8a5537cc4ec410df46f1138c0a9e68e0405d6e951`.
- `attack-s85-v030-full-diffs.json`: `9ebf6b6a1f77ef5822921d87fd39935edd53ab40c710ee214683c5b54b588392`.
- `attack-s85-first.json`: `8aa20f7addf7371f78cbfeddc3cac3297bf1422929f7af5ccb3581fc8222083b`.

- `attack-s85-final-verification.json`: `c8b11fbf8ec09a6ebbbc2b61b19971d127bf724fc841daa791738bf90e96d0d1`.

### S86: Native spring passive stages and successful counter riders

This stage corrects the remaining spring passive audit. It also corrects S85's erroneous independent erosion
rider: the PRTS detailed arts-shield row explicitly requires the counter to successfully cause damage first.
The historical S85 results remain measurements of that checkpoint, not current correctness claims.

| S85 behavior | S86 behavior | Native / PRTS standard |
|---|---|---|
| All three variants share late legacy `taken`, including HP loss | Arts variant listens to target `modifierApplied`; element/count variants retain a permanent acquired injury observer | `actrpa_passive`: DEFAULT ON_APPLIED_MODIFIER; `actrpb_passive` / `actrpc_passive`: DEFAULT ON_TAKE_DAMAGE; all filter cancelled modifiers |
| Arts sharing ignores ordinary healing and gauge intake | Ordinary damage/heal/gauge applications report modifier amount, with actual HP/gauge delta separately; HP loss, regen and restoration omit this event | [PRTS detailed arts row](https://prts.wiki/w/“碎铳之簧”) explicitly includes healing and element injury in applied modifiers; [event order](https://prts.wiki/w/事件) puts target ON_APPLIED_MODIFIER before source ON_AFTER_OUTPUT_DAMAGE |
| Every late share uses the final HP-damage guard amount | Arts observes the applied amount; the other two observe their held injury position before the final guard | Native passive event positions; this is not an HP-loss-based formula |
| Select nearest gun | Select highest-hatred live gun across field; movement fallback remains independently nearest | PRTS explicitly names highest-hatred gun; native BossSelector |
| Counter always adds erosion even after child dodge/full block | `dealDamage` request `onApplied` runs the erosion child only after positive ordinary damage successfully settles | PRTS detailed row: successful counter damage precedes erosion. Special HP can remove zero HP while damage is positive; numeric return alone is insufficient |
| Pre-burst adapter equivalence not established | Existing `elementBurst` notification already precedes cooldown lock/status/HP; regression verifies defence is removed before those steps | `actrpb_t_1`: ON_BEFORE_EP_BREAK_START; no redundant event added |

`modifierApplied` is emitted by three supported ordinary producers (HP damage, ordinary healing, gauge damage).
It is not a promise that every native modifier subtype is modeled: direct element recovery currently has no
verified native modifier subtype/flags and synthesizes no event. Ordinary healing reports its unclamped
modifier amount, so a 100 heal restoring only 10 HP still transfers 100 through the arts passive. Existing
`hpChanged`, source `damageApplied`, legacy notifications and scalar return contracts remain distinct.
`onApplied` is synchronous after the particular damage's fatal/kill handling; it is not a new top-level operation
or a universal native event. Damage cancellation suppresses it; positive special-HP damage does not.

#### Explicit evidence limits

Initial relative acquisition of the DEFAULT passive and defence buffs is unavailable in the supplied prefab
sources. The current element/count passive is installed after the initial defence [ASSUMED]; regeneration
reacquires only defence, so a surviving passive can precede the refreshed shield. A regression documents this
convention rather than presenting it as client-proven. Equal splitting to other springs is preserved [ASSUMED]:
PRTS's explicit passive describes the gun only. The pinned `actrpc_t_1` BlockDamage has filterDamageType=false;
current all-HP filtering follows that flag [ASSUMED interpretation], while PRTS's detailed count-shield row says
physical/arts. Both sides of this discrepancy are recorded; no claim of settled client behavior is made.

Independent S85-bosses/current-bosses fixtures use the same current engine and zero-error real kits:

| Input | S85 gun-pool loss | S86 gun-pool loss |
|---|---:|---:|
| 100 HP loss on any variant | 100 | 0 |
| 100 ordinary heal restoring 10 HP, arts variant | 0 | 100 |
| 100 burn gauge, arts variant | 0 | 100 |
| Same heal/gauge on element/count variant | 0 | 0 |
| 100 true damage reduced to 1 by final HP guard, arts variant | 1 | 1 |
| Same damage on element/count variant after spending initial count shield | 1 | 100 |

A dodged arts counter previously added 30 erosion; now adds 0. A separate special-HP regression verifies
positive counter damage with zero HP removal still adds erosion. Additional real-kit cases cover HP-loss
exclusion, later dodge cancellation, highest-hatred gun selection, persistent passive lifetime, and pre-burst
shield removal. Core tests cover target/source event order, lethal settlement, overheal and special-HP success.

Final focused suites: **353 passed**. Complete engine/content areas: **3705 total, 3702 passed, 3 skipped,
zero failures**. Typecheck passes its configured shared/types slice (it does not typecheck all engine/content
implementation). Scoped lint: **0 errors, 6 existing unused-variable warnings**. These are intermediate checks.

All **288** probe scenes have every simulation error field zero. Only hidden-boss9-pair, hidden-boss9-solo and
coop2-ABYSS-10-boosted change from S85; other **285 complete digests deep-equal S85**. Restoring only S85
bosses.js while retaining all current core events/callbacks deep-restores all three complete S85 summaries;
other 434 server JS files are byte-identical to current production. The full serialized comparison against
0.3.0 contains **113 scenarios / 4901 paths** without truncation. All three earlier entire-scene scopes remain
pending: inventory stays **98 attributed recorded scopes / 15 pending**, no baseline accepted or edited.

S86 SHA-256 receipts:

- `attack-s86-production-source.json`: `b60f8ed4448b93ff4ebf36f4eb1a0fa74f0fc6cf50ffebf148d1483e34370e65`.
- `attack-s86-comparison.json`: `399669627fd65cb12d6a4321b8fa95c4aef30eab1e98cca535fbffd287e69fb7`.
- `attack-s86-counterfactual-source.json`: `f8d43a5117db21fc22c841ee1dffcc2135818e1dc38491361a2a9618df88e27e`.
- `attack-s86-counterfactual.json`: `b16bd83e1ab61a9a8f0567c37b490fd71f70d8e9762a9698e614d72f5cfc8975`.
- `attack-s86-verification.json`: `17bb310e3380cabe0c4cf6dcab05a34f61fa1ba6d61939d18dc5a38dab1a0155`.
- `attack-s86-v030-digests.json`: `bc6c7069baeb9289497d7416e0b6abf2cecb5ded01200b65c6233bf9df56b49f`.
- `attack-s86-v030-full-diffs.json`: `0325c46db808ab3a3348218387d6b3c304280532a9c875bf96c5efcf4e6a5879`.
- `attack-s86-first.json`: `15b7f2976c9eec4b4ea7ccd5b9072db06fd0578a821a7a635c01c5e5650d8e13`.

- `attack-s86-final-verification.json`: `cd69c0f820506a13ccc24a7554cb58d3f8794311b5e142e94ef760c95820e01b`.

Documentation consistency/path checks: **32 passed**; whitespace check passes; no golden file edited.

### S87: Stead barrier placement closes three complete scenario scopes

**Production remains S86:** all 435 server JS files byte-equal the S86 source archive
`ce49583553463243bf0ee4577e0f44d8ab9d5e11b3a90cef6fcf8893fcebc84e`.
This is a causal review and one explicit policy regression, not a new gameplay implementation or baseline acceptance.

The previously used broad reconstruction omitted addon/battle.js. Its Stead sharing migration is material even
when HP initially stays unchanged: in roster-023 the first arts hits have the same 104 input and zero HP loss,
but the 360-point Humus barrier loses only 62.4 in 0.3.0 and 104 in the refactor. Old Stead cuts the input to
60% before barriers. Current forward reservations use the post-barrier remaining amount. This earlier shield
state difference eventually causes a visible HP difference; the prior first-HP-difference trace missed its cause.
Humus itself was not rewritten for this experiment.

| Detail | 0.3.0 | Current S86 | Standard / qualification |
|---|---|---|---|
| Stead: 100 input, target barrier 200 | Barrier ends at 140; no target/receiver HP loss | Barrier ends at 100; no target/receiver HP loss | Mode PRTS confirms 40% sharing; it does not settle placement relative to barriers. Current post-barrier policy remains [ASSUMED] |
| Stead: 100 input, target barrier 75 | Barrier ends at 15; target/members lose 0 | Barrier depleted; target loses 15, each of two members loses 5 | Same unresolved placement; numeric example is a measured simulator difference, not client evidence |
| Stead with no barrier | Target loses 60; members lose 20 each | Same 60/20/20 | PRTS mode 40% sharing |
| Reaper healing | Bare attack/late damage aggregation | Output admission window and serial delivery | Humus PRTS specifies 0.05 s admission / 0.12 s delivery; S53 scheduler qualifications retained |
| Bubble reflection | Late successful `damaged` listener | Acquired injury observers continue after cancellation | Native bubble_s_2 / bubble_t_1 ON_TAKE_DAMAGE; PRTS injury effects |
| Enemy count shields | Late early-hit cancellation | Acquired injury filters/block cancellation | S43/S81 native enemy_lysdb BlockDamage audit |
| Tippi's three cancellations in roster-004 | Dodge FX with no dodge notification | Explicit cancellation reason plus dodge event | PRTS describes dodge; event page specifies the dodge cancellation event. The skill's early phase remains distinct from ordinary injury |
| Special-HP notification / Vendla counter | Notification amount replaced by 1; counter after parent HP | Positive damage retains magnitude; acquired counter can run before parent HP | S46 special-HP and S68 Vendla native-source audits |

Independent old/current real-bond fixtures validate the three Stead rows above with zero engine errors.
A new regression explicitly labels the post-barrier choice [ASSUMED], checks full/partial absorption,
source-less receiver events and all actual HP/barrier values. It locks down the current policy without
presenting the unresolved native ordering as a confirmed standard.

Fresh-process removal trials isolate these complete baseline reconstructions:

| Scene | Retained old mechanisms / files | Complete 0.3.0 digest |
|---|---|---|
| roster-023 | Stead addon + Reaper profession helper | Deep equal |
| roster-004 | Stead addon + Reaper helper + Bubble + Tippi + two-file enemy count-shield grant/dispatch | Deep equal |
| coop4-ABYSS-7 | Stead addon + special-HP notification basis + Vendla | Deep equal |

The aggregate formula/dodge/effect triple was kept atomic throughout removal experiments, avoiding S84's
split-stage experiment flaw. That entire triple drops out of all three final groups. All other production
server JS files are independently byte-verified current. There are **86 minimization simulations**, including
initial and final runs; every run validates all simulation error fields, including the four match counters.
Independent approved comparisons use assert.deepStrictEqual on the full digest, not the report's truncated paths.

Earlier broad results are exploratory: only original Stead alone restores none of the 12 examined scenes;
adding it to the old known-mechanism reconstruction restores roster-023 and coop4-ABYSS-7. The first Bubble
combination still has three extra dodge events. Original Tippi then restores the entire roster-004 digest;
the final six-file group above is the approved evidence. Current production is never replaced by these old groups.

**Source follow-up, not silently declared solved:** current PRTS Tippi notes that successful S2 dodge skips
subsequent injury effects, including talent-timer restart, and that talent dodge is a persistent one-use injury
effect acquired when its timer matures. Current kit combines skill/talent checks in early hit and always resets
its timer. This requires a separate source-backed migration; closing roster-004's recorded cause does not
prove the current Tippi implementation fully correct. Stead's exact placement/receiver type and mixed sharing
remain qualified, rather than being accepted merely because tests pass.

Focused bond/injury suites: **105 passed, 0 failed**; scoped lint has no diagnostics. Full S86 288-scene
results remain applicable to unchanged production; this stage does not claim a new final CI run. Inventory:
**113 unaccepted differences, 101 attributed recorded scopes, 12 pending**. Golden files remain unedited.

S87 SHA-256 receipts:

- `attack-s87-verification.json`: `1001fe0e7cedc87b52f0514783808dafe1055147b83e49379e0c149d1bdcf752`.
- `attack-s87-stead-comparison.json`: `755ebb3155fe63f21f149cae4597e27bd69c20056414e7f63cd9f31769da5b46`.
- `attack-s87-humus-trace.json`: `0c25bf634d53b5924522335422119d19d9a1a8af575c5a519cd1f3d821a58589`.
- `attack-s87-humus-stats.json`: `fe4fb8605f3f1481ba3727ee43310b59c961558bd3d5c311ad8b622702450ab6`.
- `attack-s87-dodge.json`: `e48e758915282de47c2e184cafabfbc0a80528f465a516678c1600852f5e0f5d`.
- `attack-s87-combined-first.json`: `0b527e0b1ff79489c4e6fc6625b9b466c0480ab768793fccc92d907bd8436aeb`.
- `attack-s87-min-roster-023.json`: `c646549c2b8d205bab4dccf9513346bb736c0b44be907f0dfedd0040b3c3f894`.
- `attack-s87-min-roster-004.json`: `726ba110cf6eb58532fdbad0f8f5532d0f027c945117377412a57bec0c907d8a`.
- `attack-s87-min-coop4-ABYSS-7.json`: `1ab2889bd30e282674f16c57e9c1d4b351a4af2961150bdb8a734f3c71108787`.

S87 documentation consistency/path checks: **32 passed**; whitespace check passes.

#### S87 expanded review: weakness conversion and three more matches

Adding original garrisons/battle.js to the same diagnostic reconstruction restores three more complete matches.
This isolates a second omitted broad-reconstruction variable: S51/S52 weakness calculation phase and allowed
factor set. PRTS [damage classification](https://prts.wiki/w/伤害分类) explicitly excludes source damage
multipliers and target injury effects from the theoretical type comparison and puts it at ON_CALCULATE_DAMAGE.

The independent event trace confirms Utage's hit handler first converts physical to arts in both versions.
In the current calculation phase, weakness then selects physical: input 1943.271 versus DEF 100 gives
1843.271, while RES 20 gives theoretical arts 1554.6168. The old selector included target Arcane arts ×1.36,
so applied 2114.278848 arts. This is S52's already documented numerical witness; it now participates in
complete-scene reconstructions rather than being mistaken for proof of the whole match. The phase trace also
rules out an unproven Utage skill-state or descriptor mutation explanation.

| Additional match | Final old-mechanism reconstruction | Complete 0.3.0 digest |
|---|---|---|
| coop2-NORMAL-3 | Special-HP notification basis + weakness garrison | Deep equal |
| coop2-NORMAL-14-standins | Atomic old aggregate formula/dodge/injury group + coherent two-file count-shield grant/dispatch + weakness garrison | Deep equal |
| coop2-NORMAL-1-unowned-roster | Vendla counter phase + Tippi cancellation/notification | Deep equal |

Every other server JS file byte-equals current S86 for each final case. All six final groups also pass an
explicit coherence check for aggregate formula/dodge/effects and enemy shield grant/dispatch. The six
minimizations total **179 error-free simulations** (initial + all trials + final, fresh process each).
The broad weakness run restored the same six scenes, but reduced final groups are the approval evidence.
No production code changed. Final inventory: **113 unaccepted differences, 104 attributed recorded scopes,
9 pending**. Tippi timing/held dodge and earlier source-unsettled completion gates remain open.

- `attack-s87-six-verification.json`: `3c78ea8e91feb6f5e98dd63b54e4e2300835591d4e5edaee8547e13916509fdf`.
- `attack-s87-utage-events.json`: `19ea6037c5a0fc6637a7cc06583339493a7891baf7646c89c6b1d082f3eb88c6`.
- `attack-s87-utage-first.json`: `963ad87d8bcd1e0c126eb5c2d893f918191b1ab64b70575bddd743dd9c76fc39`.
- `attack-s87-min-coop2-NORMAL-3.json`: `6d33a51ebb08126733d1dbb3d3ff1b01c0058f7777f72b998b82e8ec8701c237`.
- `attack-s87-min-coop2-NORMAL-14-standins.json`: `ae4d9c187ba6be099311c3605cf3117e4058d30e6252cc54f187aa530cc87d3d`.
- `attack-s87-min-coop2-NORMAL-1-unowned-roster.json`: `fdafd73b8226369670ee5ddcc9f67aff1ae940bd5f57127bd0bc3eb29af92dc5`.

S87 receipts, scripts and the six controlled file sets are preserved in `attack-s87-evidence.tar.gz`, SHA-256
`0371af387d955c8e7bf5cbe0d9615a4250c6b7f40f8f752af6ede7a80b8f946d`; the production base is commit `8fc44c15`.

## Sources

- [PRTS 伤害分类](https://prts.wiki/w/伤害分类): independent damage / attack / delivery types, source versus kill
  attribution, precomputed and post-calculation damage, HP loss flag.
- [PRTS 作战机制](https://prts.wiki/w/作战机制#伤害及其处理): typed HP loss retains defence / resistance calculation,
  skips ordinary modifier events, barriers and hurt-SP; true HP loss is the default.
- [PRTS 盟约记录](https://m.prts.wiki/w/卫戍协议：盟约/PRTS盟约记录): Egir devour is physical HP loss; source is the
  victim itself, kill attribution is the mark's owner. The displayed game's physical-damage text is corrected by PRTS.
- [PRTS 骋风](https://prts.wiki/w/骋风): damage that cannot be cancelled by dodge still allows the dodge attempt;
  that differs from ignoring dodge.
- [PRTS 元素](https://prts.wiki/w/元素): gauges / HP damage differ, burst cooldown locks all gauges, burst damage
  usually has no damage source while the burst retains its originating element application.
- [PRTS 莱欧斯](https://prts.wiki/w/莱欧斯): HP restoration (生命复原) bypasses healing prohibition and healing events,
  cannot produce overheal. This is distinct from ordinary healing and regeneration attributes.
- [PRTS 游戏数据基础](https://prts.wiki/w/游戏数据基础#伤害公式): mathematical formula reference; see open audit below.

## Changes and their standards

| ID | Baseline behavior | New behavior | Standard / compatibility decision | Evidence |
|---|---|---|---|---|
| S1 | `source` parameter also holds statistics / kill credit; source hooks are masked by `sourceless` | Context always stores actual `source` and independent `credit`; object requests can name different units even for sourced damage | Implemented in Egir: the victim is source, marker is credit; typed loss owns mitigation. Required for source-less credited bursts too | `damage-api.test.js`: independent attacker/credit, typed loss, fatal/kill and source-less gauge conversion |
| S2 | Source-less gauge path still sends its credited unit as `elementHit.source` and uses that unit's sleep override | Explicit gauge requests keep source null across hooks, conversion and bursts; statistics use credit | Consistent with source-less meaning; old explicitly source-less gauge calls also take the corrected path | `damage-api.test.js`: source-less element case; no global DoT reclassification |
| S3 | `loseHp` receives final loss; Egir caller mitigates first; descriptor says true even for physical loss | `dealHPLose` takes typed pre-mitigation amount; source / credit separate; old `loseHp` adapter keeps final-amount semantics | Physical / arts / true HP loss supported; old calls must not be mitigated twice | `damage-api.test.js`: typed loss under shields and damage multipliers; old aliases remain |
| S4 | `canDodge=false` skips the dodge roll and event | `dodgeMode=normal/ignore/uncancellable`; uncancellable still rolls/emits attempt and then applies damage | 骋风 distinguishes a successful dodge attempt from cancellation; defaults retain baseline roll count | `damage-api.test.js`: draws, events, HP for every mode; client dodge FX policy still needs audit |
| S5 | No explicit HP-restoration mode; ordinary heal, `regen`, and ignore-heal-free flags exist | `heal({mode:'restore'})` changes HP without heal multipliers/events, forbidden-healing restrictions or overheal | PRTS HP restoration is not ordinary healing; does not count as a heal in this project's statistics | `damage-api.test.js`: restore under prohibition and multipliers; no heal hook/shield |
| S6 | `damaged` also reports HP loss and gauge fill; content repeatedly filters tags/types | New `hpChanged`, `damageApplied`, `elementApplied` events; compatibility `damaged` retained in original order | Engine notifications have explicit domains; game content must still choose its correct original trigger timing | `damage-api.test.js`: event-domain separation |
| S7 | Pre-barrier arithmetic is duplicated in enemy estimates; some effects reverse a final estimate into base damage | Shared pure calculation; `damageCalculated` exposes the formula/source amount before ordered target effects; `calculation:'resolved'` skips defence and source multipliers, retaining target modifiers/barriers | A resolved amount is not automatically source-less or HP loss; no automatic migration of sharing rules without source verification | API calculation-stage tests; differential damage cases |
| S8 | `dealDamage(type:'element')` returns calculated gauge damage, unlike actual HP-loss returns | Dedicated `dealElementDamage`; numerical legacy return remains calculated intake, not capacity-clamped fill | Explicit units; overflow behavior preserved (900/1000 + 300 returns 300, not 100) | Existing element suites; differential sourced-burst test |

## Preserved contracts

- Normalized legacy damage objects keep identity and custom fields; mutable hit callbacks still work.
- Fatal protection precedes `damaged`; kill follows hurt-SP processing. Boss pools use attributed player damage.
- Special HP changes the final HP delta (S46); boss cancellation remains a separate guard. Barrier/dodge/modifier ordering intentionally changes as S12–S18 document.
- An attack event is not synthesized by dealing damage. Sourced DoT remains sourced where the kit specifies it.
- Red-number expected damage differs intentionally from applied / weakness-theory damage.
- Burst pending lock, cooldown reset, status order, post-lethal gauge refusal, and independent element recovery stay intact.
- The original `damage.js` implementation remains available for side-by-side comparisons, annotated deprecated;
  it is not rewritten into a wrapper that would make the differential oracle compare the new implementation to itself.

## Verification performed so far

- Targeted baseline damage / element / boss-limit / regen suites: 66 tests passed.
- API plus Phatm2 / Haruka / Egir suites: 47 tests passed at the context stage.
- Independent differential suite: 72 combinations of HP damage (types, attribution, barriers, lethal values),
  sourced gauges / bursts / cooldown and ordinary / regen / overheal match baseline outcomes, event order and wire events.
- No full-suite or full-golden result is claimed for this revised implementation yet. A previous split-only draft's
  golden pass is not evidence for this version.

## Current completion gates

The implementation stages and old checkpoints below are chronological evidence, not a substitute for these gates.

1. Finish classifying/migrating remaining conditional shields, held-dodge handlers and cancelled-hit observers,
   including legacy source-calculation/output/success listeners exposed by count-shield migration. Special-HP
   damage now retains its amount (S46); loss-specific class behavior remains source-unsettled and qualified.
   Attack accuracy/miss mechanics and selection immunity must retain their distinct pre-settlement timing.
   S87 exposes Tippi S2/talent timer and acquired one-use dodge as a remaining migration; current PRTS distinguishes their phases.
   S85–S86 migrate spring held defences/passives and verify existing pre-burst timing; initial acquisition
   order, parallel sharing and count-filter interpretation remain explicitly source-unsettled qualifications.
2. Display classification now follows actual ordered damage (S56); non-cancelling attempts retain the generic
   visual without MISS text [ASSUMED]. Boss-limit ordering retains the explicitly qualified S43 pre-injury policy.
   Do not infer successful damage from a generic legacy notification alone.
3. Review every changed golden scenario against a named ledger row, including full matches. The latest probe is
   113 changed scenarios against 0.3.0 at S86; S87 attributes 104 recorded scopes, with 9 causal reviews pending. S86 moves two hidden boss9 scenes and coop2-ABYSS-10-boosted relative to S85; other 285 complete digests deep-equal S85.
   No updated baselines have been accepted yet. S41 adds native
   configured-flag evidence for S24; the current comparison still requires full attribution.
4. Complete interface/migration documentation and the final full CI + full golden run. Missing assets or other
   environment limitations must be separated from implementation failures; no pass claim may rely on an exit code
   that still printed boundary violations or skipped relevant coverage.

Resolved within the current project scope: fixed-before-percentage penetration (S9), supported actor-class element
selection (S11), Skadi/Stead forward reservations, Skadi named flat reduction, enemy arts-barrier estimates and
Philae's intentionally pre-calculation gauge barrier. Source-unsettled parallel sharing is explicitly [ASSUMED];
Friston support is a typed-effect fixture, not an added operator kit. This audit does not establish original-client
fixed-point equivalence or add unsupported neutral-entity classes.


## Egir migration observation

Baseline: `source` and kill attribution both named the marker; the caller applied physical mitigation before
`loseHp`, which labeled the instance true. New: `source` is the victim, `credit` the marker, the instance is physical,
and `dealHPLose` applies mitigation. PRTS's devour notes explicitly require these separate identities. Tests that
track marking order now observe `credit`, while new assertions check actual source/type. HP magnitude, mark ordering,
layer gains and kill attribution are required to remain unchanged; any broader movement needs investigation.

Egir migration verification: 61 tests pass across core bonds, facing, down-state chains, cross-player unite,
block-count inheritance, deployment pinning and unite carry. Existing mark order / HP / shield / revive / kill-credit
assertions remain in place; observations of the mark owner now read `credit` instead of the actual loss `source`.


## 2026-10-15 design evaluation: fidelity before migration

This section evaluates the prototype; it does not declare the refactor complete or ready to merge.

### What the current experiment proves

- The baseline `fbc52d0f:server/sim/damage.js` contains 669 lines. The new `attack.js` plus `attack/*.js`
  contain 794 lines, including the compatibility adapter. The retained oracle is excluded from this comparison.
  Splitting files and introducing semantic requests has therefore not demonstrated a reduction in engine size.
  Lines include comments and are a coarse maintenance indicator, not a complexity score.
- 126 focused tests pass in the evaluation run: API, independent differential comparisons, fidelity examples,
  tier-6 alternate kits and addon bonds. No full CI or golden result is claimed for these uncommitted experiments.
- The penetration experiment records baseline physical 900 versus revised 875, and baseline arts 900 versus
  revised 850, with combined fixed/percentage penetration. The revised formula follows
  [PRTS data basics](https://prts.wiki/w/游戏数据基础#伤害公式). This numerical correction can also be made in the old
  engine; it is not evidence that the new architecture is necessary.
- Skadi S1 now operates on the remaining actual damage after the patient's barrier and calls typed HP loss for
  the receiver. Tests cover fully absorbed damage, receiver shields/modifiers, overlapping copies and refusal
  to transfer ordinary HP loss. [PRTS Skadi](https://prts.wiki/w/浊蒂) explicitly documents priority -2000,
  no transfer of HP loss, and HP loss for the received share. The basic migration itself removes only two net lines;
  it improves semantics, but does not establish a large code-size saving. The module's reverse-calculation hook
  remains and still needs its own audit.

### A counterexample that rejects the current pipeline as a complete replacement

Reproduction: give a synthetic ally a one-hit shield, then a 100% physical-dodge buff; apply one physical instance.
Both the independent baseline and the new pipeline leave one shield charge and draw dodge RNG once.
[PRTS injury effects](https://prts.wiki/w/伤判效果) gives this exact acquisition-order distinction: for ordinary
same-priority shield/dodge effects, obtaining the shield first consumes the shield before dodge can be attempted.
The correct result for this reproduction is zero shield charges and no dodge roll.

The existing fixed sequence `dodge -> all hit shields -> all HP barriers` is insufficient. Moving Skadi to a later
hook fixes that particular interaction but does not fix the general model. Likewise, aggregating all dodge buffs
into one stat discards the effect acquisition order needed for shield/dodge interactions. Compatibility tests alone
cannot establish fidelity, because both engines can share the same wrong behavior.

### Revised design recommendation

Keep five public operations: `dealDamage`, `dealElementDamage`, `dealHPLose`, `heal`, `healElement`. These select
mechanical domains. `source: null` expresses source-less application; independent `credit` expresses attribution.
Do not add `dealNonSourceDamage`. Ordinary content should specify the amount, type and meaningful source, leaving
mitigation and bookkeeping to the engine. Keep healing versus regeneration/restoration as explicit healing modes.

The useful internal simplification would be a small settlement context and one ordered injury-effect pass:

1. Normalize the request and snapshot the attributes required for this instance.
2. Compute the damage formula once; distinguish attribute calculations from injury-effect multipliers.
3. Apply eligible injury effects by game priority, then their actual buff acquisition order. A shield, dodge,
   damage modifier, reflection or transfer owns its own conditions and cancellation behavior. Preserve the distinction
   between effects that stop after cancellation and effects that must still observe a cancelled instance.
4. Apply final HP changes, fatal protection, attribution and notifications in one shared place.

HP loss skips ordinary injury effects; elemental gauge application has its own gauge/burst path; healing has its
own restrictions. They may share HP bookkeeping without pretending to be one interchangeable damage operation.
Keep attack delivery/attack-trigger notifications separate from settlement. Do not encode these mechanisms as a
large collection of independent bypass booleans, or force every mechanic through one general event bus.

The ordered pass is a recommendation, not an implemented feature of this prototype. Legacy adapters and duplicate
notifications are temporary migration cost; they cannot count as simplification until real callers migrate and
redundant branches can be retired. Source-specific hooks for resolved damage, hit-count units, enemy barriers,
zero/cancelled damage notifications and visual dodge reporting still require explicit audits.

### Decision

There is enough evidence to justify a fidelity-oriented prototype of the ordered effect model. There is not yet
enough evidence to justify replacing the current engine across the project, or to promise less total code while
reproducing more mechanics. Acceptance requires representative migrations that remove reverse estimates and
special flags, correct acquisition-order tests against PRTS, explicit old/new/standard ledgers, and finally full
CI and golden review. A bug fix that is equally easy in the old design must not be counted as a refactor benefit.


## Ordered injury effects implementation, first stage

The preceding design evaluation describes the state before this stage. `attack/effects.js` now executes buff-owned
target damage multipliers, shields and dodge in one priority/acquisition-ordered pass. `damageCalculated` now
exposes the formula/source amount before those target effects. The earlier fixed-order counterexample is fixed
in the new engine and remains reproducible in the independent original engine.

| ID | Baseline | New | PRTS standard / limits |
|---|---|---|---|
| S9 | Fixed penetration after percentage | Fixed before percentage | 游戏数据基础 formula; the physical 900/875 and arts 900/850 comparisons are regression assertions |
| S10 | Skadi reconstructs pre-transfer shares and receives a new true-damage instance | Remaining post-barrier amount is transferred as HP loss; ordinary loss cannot be transferred | 浊心斯卡蒂 S1 notes, priority -2000; module and mixed redirects still require audit |
| S11 | Element bursts classify by current team | Enemy-class allies retain enemy-class bursts and leader gauge capacity | 元素 table distinguishes actor class from faction; current supported allied/enemy classes only |
| S12 | Aggregated dodge rolls once before all shields; all hit shields before all barriers | Each eligible buff effect runs in descending priority, then its actual acquisition sequence | 伤判效果 shield/dodge example; independent rolls change RNG consumption intentionally |
| S13 | All target injury multipliers apply before barriers | Each buff multiplier applies at its own injury position | 伤判效果 enemy-Mudrock/fragile example; old estimates remain estimates, not the applied pipeline |

`attack-effects.test.js` covers both shield/dodge acquisition orders, priority overrides, full/partial absorption,
independent uncancellable attempts, typed shields, modifier/barrier acquisition order and HP-loss bypass.
The core still has legacy hit cancellations and after-barrier hooks. Reflections/observers which must continue
after cancellation are not implemented by the blocking-effects loop and need their own timing audit. Multi-effect
synthetic buffs use modifier -> shield -> dodge inside that buff [ASSUMED], without inventing a claim about an
original-game compound buff. Boss-limit/red-number estimates and hit-count replacement remain separate contracts.


Intermediate validation of the ordered stage:

- Engine suite: 927 tests, 924 pass, 3 skipped, no failures. The subsequent migration change removes Zuole's
  workaround that divided out protection before the barrier and reapplied it afterwards. The ordered pass provides
  that behavior directly; 29 focused Irene/Zuole/ordered-effect tests pass. Irene assertions now independently use
  fixed-before-percentage penetration rather than the old formula.
- The broader content run exposed four failures: two old-formula Irene expectations and the obsolete Zuole workaround
  are resolved by the preceding migrations; the Skadi/Stead conservation failure is still unresolved. Its old
  simultaneous-share contract is recorded in history §29.2, while PRTS specifies Skadi's -2000 priority and receiver
  HP loss but does not settle this particular composition. Do not weaken the conservation test or silently redefine
  the simultaneous-share contract while that audit is pending.
- Exploratory full golden comparison: 33 scenarios differ, with no files updated. Temporarily restoring the prior
  hit pipeline (and restoring the working copy in a `finally` block after the comparison) leaves 21 mismatches.
  This is an intervention to localize differences, not complete attribution of any individual scenario. Logs:
  `/private/tmp/attack-effects-golden.log` and `/private/tmp/attack-without-ordered-effects.log`.
- Documentation checks: 32 pass. Scoped lint: no errors, four warnings (including an existing deprecated helper
  import). No completion/full-CI claim and no golden acceptance/update is made at this stage.


### Forward transfer reservations

The mixed Skadi/Stead failure is fixed without weakening its existing conservation assertions. `reserveTransfer`
records each share against the actual post-barrier base, subtracts it from the victim's remaining amount, then
`applyTransfers` distributes the reserved amounts after all handlers have declared their shares. Every callback
receives the complete transfer ancestry. This removes Stead's `hit`-time scalar cut, `steadCut` bookkeeping and
`damaged`-time reverse reconstruction. Skadi requests true HP loss; Stead retains the legacy source-less true-damage
receiver behavior, including receiver modifiers/barriers. The source-less receiver cannot apply attacker bonuses twice.

PRTS confirms Skadi's -2000 priority and HP-loss receiver, and the mode page confirms Stead's 40% sharing, but does not
settle their exact composition or Stead's receiver kind. `[ASSUMED]` The parallel-share rule from project §29.2 is
retained, with Stead in the same -2000 reservation group. No claim is made that this composition has been verified
in the original client. The new group also makes both shares post-barrier; standalone Stead's previous pre-barrier
cut and reduced barrier consumption therefore intentionally change (source audit remains open).

92 focused API/differential/fidelity/ordered-effect/bond/community tests pass, including all three existing
Skadi/Stead conservation modes and bounded transfer-tree assertions. Core and content-wide rechecks follow.

Tooling observation: `check-imports.mjs` exits zero but reports three pre-existing Node imports in unchanged
`sim/nodeData.js`; zero exit status is not described as a clean boundary scan. `npm run typecheck` passes, but its
configured include list covers shared primitives and request typedefs, not a full checked-JS audit of the new engine.


Latest checkpoint after forward reservations: the complete `test/sim` + `test/content` run reports 3247 tests,
3244 pass, 3 skipped, zero failures. Subsequent transfer guard tests (post-barrier basis, complete ancestry, full
absorption and callback-error isolation) pass in a 28-test focused run. Documentation reports 32 passes; scoped
lint reports no errors and three warnings. These supersede the earlier unresolved-conservation result, not the
remaining original-game composition uncertainty. Golden results have not been updated and full CI remains pending.


## Custom enemy barriers and independent skill dodge

| ID | Baseline | New | Standard / qualification |
|---|---|---|---|
| S14 | Enemy arts barrier estimates the final hit and scales its base amount back down in `hitIn` | Buff-owned `injury` subtracts the actual amount at its acquisition position; `absorbArts` is removed | PRTS 伤判效果 explicitly gives enemy-Mudrock/fragile acquisition-order examples; fully absorbed hits now have zero-amount settlement notifications, rather than early cancellation |
| S15 | Enemy barrier HP bonuses removed immediately on full absorption, or via an `a.breaking` flag in `taken` on overflow | `defer` removes the precise buff after the instance, even if a later dodge cancels overflow | Retains the baseline's post-overflow HP rescaling policy; cleanup-on-later-cancellation fixes the previously missing case; exact original-client bonus-removal notification timing remains [ASSUMED] |
| S16 | Flametail S3 independently rolls in an early hit hook; her summary dodge stat excludes the skill | Skill dodge is an ordinary independent buff at its acquisition position; summary includes skill + talent; S1's held dodge uses `ctx.dodge` | PRTS 伤判效果 includes Flametail's count/probability dodge in the acquisition-order model; S1 ignore/uncancellable modes now use the same engine semantics |

Sources: [伤判效果](https://prts.wiki/w/伤判效果), [enemy 泥岩](https://prts.wiki/w/泥岩%28敌方%29),
[碎铳之簧](https://prts.wiki/w/“碎铳之簧”), [焰尾](https://prts.wiki/w/焰尾).
The custom injury callback is limited to ordered settlement behavior, not a general replacement event bus.
`defer` owns cleanup needed across normal, absorbed and later-cancelled outcomes; each callback is guarded.

Validation: initial enemy/core/element comparison run 307 pass. Added an actual mouse-king barrier/fragile acquisition
regression and a deferred HP-bonus cleanup/cancellation regression: 283 tests pass in the enemy/effects run.
Flametail's former `s.dodgePhys == talent-only` assertion is updated to the independent combined summary; this is
a stat representation change, not a change from independent rolls to an aggregated roll.


### Conditional dodge migration and golden-baseline evidence

Old Lee S3 installed an early `hit` handler, rolled its own probability and emitted a dodge whose source could be
replaced by credit. It now owns a skill-lifetime `injury` buff and calls `ctx.dodge(probability)` only when the actual
source is outside the current range; null source remains outside. [PRTS Lee](https://prts.wiki/w/老鲤) explicitly
specifies source-current-position and source-less-as-outside. Acquisition order and ignore/uncancellable semantics
come from the shared engine; source and credit remain separate on dodge notifications. 132 focused Lee/Flametail/
effect tests pass. A subsequent held-charge test distinguishes guaranteed `ctx.dodge()` (no random draw) from an
actual probability roll; ignored dodge preserves the charge and uncancellable dodge consumes it without cancelling
the hit. The corresponding focused run reports 133 passes.

The now-unused inverse redirect helpers were removed from the new engine, and both enemy estimate helpers
`expectedFinal`/`absorbArts` were removed after their production callers migrated. The original deprecated
`damage.js` remains independent. The element-resistance regression now asserts the actual applied value directly
against `1000 * 0.7 * 1.2`, rather than comparing it to an engine estimate that shares its implementation.

An independent archive of the exact baseline `fbc52d0f` was exported under
`/private/tmp/stronghold-damage-original`, with dependencies linked locally. Its complete golden comparison passes:
49 roster + 46 bonds + 22 fields + 20 matches + 10 standins + 140 DIY = 287 scenarios. Neither the main worktree's
unrelated changes nor the refactor files are used by that baseline.

A full probe before the final Lee/guaranteed-charge cleanup found 37 changed scenarios; stored golden files are
unchanged. Current digests and full field differences were saved separately under `/private/tmp/attack-current-*`.
First-divergence tracing against the independent baseline records concrete examples:

| Scenario | First relevant instance | Old | New | Explanation |
|---|---|---|---|---|
| roster-003 | 74.2 s, chess_char_2_01_a into enemy_1502_crowns; fixed penetration 95 plus 30% | 989.1981 HP | 971.6981 HP | S9, fixed-before-percentage calculation; identical source/target HP and RNG state before the instance |
| roster-017 | 97.1667 s, Rosmontis into enemy_1404_msnip; fixed penetration 175 plus 30% | 826.94304 HP | 823.44304 HP | S9, the same penetration correction |
| diy-124 | 22.5667 s, enemy_1010_demon_2 into Silence alter; barrier precedes 18% protection | 605.850448 HP | 788.92611476 HP | S13, protection is after the older barrier; earlier barrier consumption has already diverged |

These are substantive numerical differences, not an inference from snapshot hashes or a blanket floating-point
explanation. The trace captures cached attributes and buff state without reading lazy `.s` getters during
observation. Detailed traces for the 29 changed non-match scenarios were saved to
`/private/tmp/attack-all-first-divergence.json`; first-call traces alone do not prove full scenario attribution.
The eight changed full matches and remaining notification-only differences still require their own audit.


Latest custom-injury checkpoint: all engine/content tests report 3252 total, 3249 pass, 3 skipped, no failures;
documentation checks report 32 passes. Scoped lint has no errors (ten existing/deprecation warnings in the selected
files). Core production implementation excluding the retained old oracle is now 814 lines; the first prototype was
794 lines. New ordered effects/cleanup add shared machinery while enemy helpers, Flametail, Lee, Stead and Zuole
lose duplicated prediction, cancellation and reverse-compensation code. This is evidence of simpler callers, not a
claim that total engine size has fallen below the original 669-line file.

An additional PRTS check confirms Skadi Y-module's flat reduction is a same-named strongest effect with Friston-3
([浊心](https://prts.wiki/w/浊心)); its current negative-penetration/reverse-RES hook still needs migration. It must
not simply become another stacking flat buff or a formula-stage subtraction. That remaining source-backed audit,
conditional shield/held-dodge hooks, elemental barrier adjustments, and complete golden attribution precede final CI.


## Flat-reduction and elemental-barrier audit

| ID | Baseline | New | PRTS standard / qualification |
|---|---|---|---|
| S17 | Skadi Y-module raises effective DEF or reverses RES into the incoming amount; overlapping sources repeat that rewrite | An actual aura buff grants `damageReduction: {phys: 30, arts: 30}`; the per-type strongest source subtracts once at its own acquisition/priority position | PRTS 伤害减免 is flat and same-named strongest; Skadi/Friston-3 share that group independently per damage type. Friston's +2000 priority is supported/tested as a fixture, not a claim that a Friston kit was added |
| S18 | 海沟实验体 estimates mitigated damage and reverses a scalar cut into `dmg.mul`; source multipliers can rescale its nominal flat subtraction | A persistent item-owned `injury` callback subtracts 180/300 from the actual amount; no prediction or inverse scalar | PRTS item states damage minus 180/300. It remains independent of the Skadi/Friston named group, as the terminology page names only those two sources. Ordinary priority 0 is used in absence of an explicit override |
| S19 | Eyja alter S2 appends another pool on every cast and uses element-hit priority -50 | Recasting replaces that source's old pool; shared absorption hook uses -2000 | PRTS explicitly says recast resets pool/duration/absorption and gives -2000 priority; other sources retain independent pools |

Sources: [PRTS 术语释义](https://prts.wiki/w/术语释义), [浊心](https://prts.wiki/w/浊心),
[Friston-3](https://m.prts.wiki/w/Friston-3), [海沟实验体](https://prts.wiki/w/海沟实验体),
[纯烬艾雅法拉](https://prts.wiki/w/纯烬艾雅法拉).

Native named reduction is a map over phys/arts/true/elemental, not a Unit attribute folded into the damage formula.
Selecting the greatest entry independently per type avoids stacking Skadi copies and permits all-type Friston
reduction without leaking it into elemental gauge damage or HP loss. Flat reduction may remove the formula's 5%
floor because it is a later injury effect. Buff acquisition sequence survives continuous aura refresh; leaving the
range, ending the skill or dying removes the source's buff. Skill/deployment/death/tick synchronization and a pre-hit
coverage refresh prevent stale coverage in the same tick.

The item buff is created before initial deployment, so it explicitly uses the engine's existing `allowDead`/persist
installation contract. A first targeted run caught that omission; it was corrected rather than weakening the
item-value or equipment-coverage assertions.

### Element barriers intentionally retain their pre-calculation stage

[PRTS Philae](https://prts.wiki/w/Philae) explicitly places her damage-injury barrier before damage calculation and
after her first talent. Her existing `elementHit` treatment therefore stays in the raw gauge domain; moving it into
HP injury effects or after `elementIntake` would be wrong. Eyja's shared pool likewise stays on the element path.
A new recast fixture verifies 50% damage-injury resistance is applied only to the overflow after the raw shared pool.
The module's `healElement` usage is migrated to the explicit object request. No HP barrier is used to intercept gauges.

Focused validation: 142 flat/native-effect/module/item tests pass, including per-type strongest values, +2000 versus
acquisition order, mitigation-floor removal, combined penetration/source scaling, overlapping real Skadi copies,
movement in/out of coverage and immediate skill-end cleanup. A separate 104-test Philae/Eyja/module run passes,
including replacement of a partially consumed S2 pool. Full engine/content and golden probes follow.


### Interface typing and ambiguous legacy calls

Battle settlement methods now document distinct object-request and positional overloads. A TypeScript 5.9.3 compiler
probe resolves nine representative new/old calls using a real Unit instance with no usage-file diagnostics. This
is scoped interface verification, not a claim that the whole implementation is under checked JS. Legacy positional
overloads have migration descriptions; actual deprecation annotations remain on the original module exports and
old aliases, with import lint warnings. No per-overload deprecated strike-through is claimed for the same-name
JSDoc overloads. Reference: [TypeScript JSDoc overload support](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html#overload-support-in-jsdoc).

Dispatch uses the number of arguments: exactly one argument is a request; old positional calls continue through
the adapter. Previously checking `target === undefined` could reinterpret a source Unit with an AI `target` field
as a request when an old caller omitted its target. The new regression requires a zero result with no hit hooks
for such an invalid legacy call. This is an API-compatibility guard, not a new game-rule claim.

The latest full area run passes 3254 tests with 3 skips (3257 total). The subsequent API/differential/robustness run
passes 56 tests, including the new missing-argument guard; its performance/determinism checks pass. Docs report
32 passes; scoped lint reports no errors and six warnings at the flat-reduction checkpoint.

The new full golden probe reports 35 differences (13 roster, 1 bond, 5 fields, 8 matches, 3 standins, 5 DIY), stored
separately as `/private/tmp/attack-flat-digests.json` and `attack-flat-diffs.json`. No golden file was updated. Earlier
37-scenario exploratory output predates guaranteed-charge cleanup and is historical evidence, not the latest count.


Final checkpoint for S17–S19 and wrapper typing (not completion of the full refactor): the complete engine/content
run reports 3258 tests, 3255 pass, 3 skipped, zero failures. This includes the real-item source-scaling regression
and the legacy missing-target guard. The independent original archive was also run with identical real equipment
fixtures: a 1000 true instance from a source with ×2 damage removes 1640/1400 HP under the original normal/golden
海沟实验体, versus 1820/1700 HP under the new pipeline. These directly observed old/new values show that the old
180/300 flat subtraction was itself doubled by the source; the new values preserve the nominal flat subtraction.
The fixtures have enough HP to avoid overkill clamping; actual HP removed remains the API return contract.
