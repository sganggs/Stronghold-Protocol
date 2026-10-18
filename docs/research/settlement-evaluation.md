# Settlement refactor evaluation

The maintainer-facing Chinese comparison is [旧行为、新行为与修改依据](settlement-behavior-comparison.md).

Status: local S95 implementation verified; full CI 8949 pass / 0 fail / 61 skip, full golden 288 match. See [final validation](settlement-validation.md). This is not a release or
an assertion of original-client frame equivalence. The detailed [behavior ledger](12-settlement-refactor.md)
and [scenario inventory](13-settlement-golden-audit.md) record old behavior, implemented behavior and sources.

## What improves

Five public operations distinguish ordinary HP damage, element-gauge intake, HP loss, HP healing and element
recovery. Actual source and statistical credit are independent. Damage class, route, calculation stage and
attack-action ownership are explicit rather than inferred from descriptive tags in new calls. Native injury
observation, success, gauge application and HP bookkeeping have different hooks and clear placement.

The 81-line public module delegates to calculation, injury effects, final HP application, gauges and healing.
The compatibility adapter is 26 lines; existing positional callers remain usable while authors migrate one
effect at a time. The old damage.js stays an independent deprecated implementation for comparison, with lint
warnings on new production imports. Same-name positional overloads have migration descriptions; reliable
per-overload IDE strike-through is not claimed. See [the API guide](../SETTLEMENT.md).

## What does not become smaller

The released v0.3.1 damage.js has 669 lines. The new attack.js plus its nine implementation/compatibility files
have 932 lines, counting comments and blank lines consistently. That is 263 additional lines, approximately
39%; retaining the independent old file adds further repository size. This is a decomposition and mechanism
correction, not a demonstrated reduction in total implementation size. Lines moved into buffs/content are
not counted as a saving. Ninety-seven server/sim paths differ from the released tag at this checkpoint.

The shorter entry points and separated responsibilities make new calls clearer, but the game still requires
source/credit, precomputed damage, distinct cancellation reasons, ordered held defences and several event
phases. Removing these choices merely to reduce arguments would lose native semantics. Existing positional
callers do not all become object calls in this branch; retaining them is an intentional migration boundary.

## Verification and remaining limits

S94 focused suites: 109 pass. Engine/content: 3770 pass, 3 skip, 0 fail. All 288 production summaries have
zero reported simulation errors. Against shipped v0.3.1, 118 summaries differ; all have recorded historical
attribution scopes, with S93/S94 additions isolated independently. These are intended mechanism corrections,
not evidence of a behavior-preserving refactor. Native/PRTS references and every affected scenario are listed
in the linked ledgers. Snapshots remain opaque hashes; counterfactual scopes do not prove every intermediate
frame of the original client.

The current configured JS type slice passes. Compiler probes validate nine representative new/legacy
signatures and three rejected HP-loss requests; this does not imply the entire engine is checked JS. No
production server/sim import of the old damage.js remains. The old byEnemyAttack alias remains available to
the author-facing DSL; descriptive DSL recursion prevention is separate from native damage-class semantics.

Source-unsettled points remain marked [ASSUMED], including native intra-frame scheduling, hidden cancellation
masks for some inherited counters, specific shield priority overrides not extracted from native instances,
and the placement of some damage-sharing effects. Tests establish the implemented contract, not missing
original-client evidence. Full CI and a fresh full golden run are recorded in the linked final report; the existing three upstream import-boundary violations remain explicit.

## Recommendation

Keep the five operations and the explicit source/credit model. Preserve the small compatibility boundary and
migrate only when a caller's native meaning is understood. The API is useful even when an old positional caller
remains. Do not require contributors to learn every option for ordinary attacks: the guide's defaults and
examples cover those calls, and special options belong in the kit that needs them.

Review the API/pipeline and the source-backed content corrections as distinct review scopes. The latter
account for 118 changed summaries and carry much greater gameplay review cost than moving functions into
modules. For a repository with concurrent contributors, a single large merge should not be justified as a
simple cleanup. The value is semantic clarity and corrected mechanics; fewer total lines has not been achieved.
