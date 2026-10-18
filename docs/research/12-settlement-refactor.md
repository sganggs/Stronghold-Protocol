# Settlement refactor: compatibility and fidelity ledger

Baseline: `fbc52d0f`. Research checked 2026-10-15. Worktree: `refactor/damage-api`.
This is an implementation audit, not a claim that every Arknights mechanic has been reproduced.

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
| S7 | Pre-barrier arithmetic is duplicated in enemy estimates; some effects reverse a final estimate into base damage | Shared pure calculation; `damageCalculated` exposes actual pre-barrier amount; `calculation:'resolved'` skips defence and source multipliers, retaining target modifiers/barriers | A resolved amount is not automatically source-less or HP loss; no automatic migration of sharing rules without source verification | API calculation-stage tests; differential damage cases |
| S8 | `dealDamage(type:'element')` returns calculated gauge damage, unlike actual HP-loss returns | Dedicated `dealElementDamage`; numerical legacy return remains calculated intake, not capacity-clamped fill | Explicit units; overflow behavior preserved (900/1000 + 300 returns 300, not 100) | Existing element suites; differential sourced-burst test |

## Preserved contracts

- Normalized legacy damage objects keep identity and custom fields; mutable hit callbacks still work.
- Fatal protection precedes `damaged`; kill follows hurt-SP processing. Boss pools use attributed player damage.
- Barrier order, hit-count units, boss cancellation and their exceptions stay on their original branches.
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

## Open audit before completion

1. Egir devour now uses one typed object request instead of caller-side mitigation plus an overloaded source. Continue
   representative staged-effect migrations and measure reverse calculations / filters removed.
2. Verify shield / dodge / redirect ordering against the PRTS injury-effect priority model. Do not move an effect to a
   convenient stage without checking its actual original-game timing.
3. Resolve the penetration-order discrepancy: baseline computes `D*(1-pct)-flat`; current PRTS formula states
   `(D-flat)*(1-pct)`. First map the repository's ignore fields to the official penetration / ignore attributes;
   do not silently change both formulas based on a terminology match. Fixed-point rounding is a separate question.
4. Verify actor-kind versus side-based element burst selection for enemy-class allied units and mode-version rules.
5. Verify visual reporting of successful but non-cancelling dodge; the engine behavior is sourced, its MISS display is not.
6. Check every golden change against a named ledger row and source; update only intended scenarios, then run complete CI
   and full golden checks. Missing local art / network or sandbox limitations must be reported separately from code failures.


## Egir migration observation

Baseline: `source` and kill attribution both named the marker; the caller applied physical mitigation before
`loseHp`, which labeled the instance true. New: `source` is the victim, `credit` the marker, the instance is physical,
and `dealHPLose` applies mitigation. PRTS's devour notes explicitly require these separate identities. Tests that
track marking order now observe `credit`, while new assertions check actual source/type. HP magnitude, mark ordering,
layer gains and kill attribution are required to remain unchanged; any broader movement needs investigation.

Egir migration verification: 61 tests pass across core bonds, facing, down-state chains, cross-player unite,
block-count inheritance, deployment pinning and unite carry. Existing mark order / HP / shield / revive / kill-credit
assertions remain in place; observations of the mark owner now read `credit` instead of the actual loss `source`.
