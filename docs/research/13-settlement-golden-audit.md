# Settlement golden audit: S88 against 0.3.0

This is a review inventory, not accepted gameplay or updated baselines. All 288 shipped scenarios were recomputed;
115 differ. The clean 0.3.0 oracle passes all 288 unchanged baselines. The current branch has no golden-file edits.
[Mechanism evidence and old/new behavior](12-settlement-refactor.md) remain the source ledger.

[Per-scenario evidence](13-settlement-golden-audit.json) records every changed scenario, all differing summary
paths (without the standard report's 40-path cap), changes across preserved stage digests and the first significant damage-call difference against clean
0.3.0. There are 106 currently attributed recorded scene scopes and 9 pending reviews after S88. Tippi's
early skill dodge, native deployment timer and acquired one-use injury dodge are separated. Eight summaries
move from S86; a one-file Tippi restoration retaining the new target applying stage deep-restores all eight.
Two are new baseline differences wholly attributable to this correction. Stage association and a
first differing call are insufficient to attribute every downstream match, status or snapshot change.

The inventory contains **86** scenarios with non-notification summary fields, **16** with counts/snapshot fields only, and **13** with event/hook/fx counts only.
**21** have no significant difference in the recorded damage-call inputs/results/HP/RNG. That is not a
proof of equivalence: HP loss, healing, notifications and snapshots are not completely observed by that wrapper.

The trace wrapper normalizes positional/object damage requests, records call order, input, actual source,
target HP, RNG state, return value and post-call HP. It compares numerical differences above 1e-6; metadata
and dirty flags are diagnostic only. Nested calls appear in entry order. A later main-call mismatch may be
caused by a nested counter or heal, so the first row is an investigation starting point, not necessarily a root cause.

Stage labels are deliberately coarse. S42 groups S31–S42; S45 groups S43–S45. “post-sync” means no later
preserved checkpoint changed that scenario, not that the upstream merge caused its difference. S50 and
S54–S56 have equal complete digests to their predecessors, despite focused fixtures proving request/display
changes outside summary coverage. No missing intermediate stage is inferred to be behaviorally identical.

| Last preserved stage that changed the digest | Scenarios |
|---|---:|
| S46 | 9 |
| post-sync | 12 |
| S88 | 8 |
| S53 | 17 |
| S74 | 1 |
| S75 | 9 |
| S42 | 8 |
| S77 | 12 |
| S45 | 24 |
| S64 | 1 |
| S73 | 1 |
| S63 | 4 |
| S86 | 3 |
| S52 | 2 |
| S83 | 2 |
| S76 | 2 |

The table below is a navigation index. “No call delta” requires notification/heal/loss/snapshot investigation.
“Call delta” requires the mechanism ledger plus exact per-scenario causal review; neither label accepts a baseline.

| Family | Scenario | Last stage | Summary scope | Damage trace | Review |
|---|---|---|---|---|---|
| roster | `roster-001` | S46 | summary | Call delta | Attributed scope |
| roster | `roster-002` | S46 | summary | Call delta | Attributed scope |
| roster | `roster-003` | post-sync | summary | Call delta | Attributed scope |
| roster | `roster-004` | S88 | summary | Call delta | Attributed scope |
| roster | `roster-005` | S53 | counts/snapshots | Call delta | Attributed scope |
| roster | `roster-006` | S88 | summary | Call delta | Attributed scope |
| roster | `roster-008` | S74 | summary | Call delta | Attributed scope |
| roster | `roster-010` | S46 | summary | Call delta | Attributed scope |
| roster | `roster-012` | S75 | summary | Call delta | Attributed scope |
| roster | `roster-013` | S53 | counts | No call delta | Attributed scope |
| roster | `roster-014` | S53 | summary | Call delta | Attributed scope |
| roster | `roster-015` | S53 | counts | No call delta | Attributed scope |
| roster | `roster-016` | S42 | summary | Call delta | Attributed scope |
| roster | `roster-017` | S77 | summary | Call delta | Attributed scope |
| roster | `roster-018` | S46 | summary | Call delta | Attributed scope |
| roster | `roster-019` | S77 | summary | Call delta | Attributed scope |
| roster | `roster-023` | S53 | summary | Call delta | Attributed scope |
| roster | `roster-026` | S46 | counts/snapshots | Call delta | Attributed scope |
| roster | `roster-028` | post-sync | summary | Call delta | Attributed scope |
| roster | `roster-029` | post-sync | summary | Call delta | Attributed scope |
| roster | `roster-032` | S53 | summary | Call delta | Attributed scope |
| roster | `roster-033` | S53 | summary | Call delta | Attributed scope |
| roster | `roster-034` | S46 | summary | Call delta | Attributed scope |
| roster | `roster-035` | post-sync | counts | Call delta | Attributed scope |
| roster | `roster-036` | S77 | summary | Call delta | Attributed scope |
| roster | `roster-037` | S77 | summary | Call delta | Attributed scope |
| roster | `roster-038` | S53 | summary | Call delta | Attributed scope |
| roster | `roster-041` | S46 | summary | Call delta | Attributed scope |
| roster | `roster-042` | S75 | summary | Call delta | Attributed scope |
| roster | `roster-043` | S53 | summary | Call delta | Attributed scope |
| roster | `roster-045` | post-sync | summary | Call delta | Attributed scope |
| roster | `roster-046` | S77 | summary | Call delta | Attributed scope |
| roster | `roster-047` | S77 | summary | Call delta | Attributed scope |
| bonds | `bond-deputShip-high` | S42 | summary | Call delta | Attributed scope |
| bonds | `bond-deputShip-low` | S45 | counts/snapshots | No call delta | Attributed scope |
| bonds | `bond-emptyShip-high` | S75 | summary | Call delta | Attributed scope |
| bonds | `bond-indomShip-high` | S53 | summary | Call delta | Attributed scope |
| bonds | `bond-investShip-high` | S53 | counts | No call delta | Attributed scope |
| bonds | `bond-kazimierzShip-high` | S64 | summary | Call delta | Attributed scope |
| bonds | `bond-preciShip-low` | S45 | counts/snapshots | No call delta | Attributed scope |
| bonds | `bond-raidShip-high` | S53 | counts | No call delta | Attributed scope |
| bonds | `bond-raidShip-low` | S53 | counts | No call delta | Attributed scope |
| bonds | `bond-sargonShip-high` | S75 | counts | Call delta | Attributed scope |
| bonds | `bond-siracusaShip-high` | S73 | counts | Call delta | Attributed scope |
| bonds | `bond-suntShip-high` | S42 | summary | Call delta | Attributed scope |
| bonds | `bond-suntShip-low` | S45 | summary | Call delta | Attributed scope |
| bonds | `bond-swiftShip-low` | S45 | summary | Call delta | Attributed scope |
| bonds | `bond-victoriaShip-low` | S42 | summary | Call delta | Attributed scope |
| fields | `boss-boss_1-pair` | S77 | summary | Call delta | Attributed scope |
| fields | `boss-boss_1-solo` | S53 | counts/snapshots | No call delta | Attributed scope |
| fields | `boss-boss_2-pair` | S63 | summary | Call delta | Pending |
| fields | `boss-boss_2-solo` | S75 | summary | Call delta | Attributed scope |
| fields | `boss-boss_3-pair` | S77 | summary | Call delta | Attributed scope |
| fields | `boss-boss_3-solo` | S63 | summary | Call delta | Attributed scope |
| fields | `boss-boss_4-pair` | S42 | summary | Call delta | Attributed scope |
| fields | `boss-boss_4-solo` | S75 | summary | Call delta | Attributed scope |
| fields | `boss-boss_5-pair` | S77 | summary | Call delta | Pending |
| fields | `boss-boss_5-solo` | S53 | counts/snapshots | No call delta | Attributed scope |
| fields | `boss-boss_6-solo` | S75 | counts | Call delta | Attributed scope |
| fields | `boss-boss_7-pair` | S77 | summary | Call delta | Attributed scope |
| fields | `boss-boss_7-solo` | S53 | counts | No call delta | Attributed scope |
| fields | `hidden-boss_10-pair` | S63 | summary | Call delta | Pending |
| fields | `hidden-boss_10-solo` | S75 | summary | Call delta | Pending |
| fields | `hidden-boss_8-pair` | S63 | summary | Call delta | Attributed scope |
| fields | `hidden-boss_8-solo` | S75 | summary | Call delta | Attributed scope |
| fields | `hidden-boss_9-pair` | S86 | summary | Call delta | Pending |
| fields | `hidden-boss_9-solo` | S86 | summary | Call delta | Pending |
| fields | `unite-1` | post-sync | summary | Call delta | Attributed scope |
| fields | `unite-2` | S77 | summary | Call delta | Attributed scope |
| matches | `coop2-ABYSS-10-boosted` | S86 | summary | Call delta | Pending |
| matches | `coop2-HARD-4` | S88 | summary | Call delta | Attributed scope |
| matches | `coop2-NORMAL-1-coverage-standins` | S88 | summary | Call delta | Pending |
| matches | `coop2-NORMAL-1-unowned-roster` | S88 | summary | Call delta | Attributed scope |
| matches | `coop2-NORMAL-14-standins` | S52 | summary | Call delta | Attributed scope |
| matches | `coop2-NORMAL-3` | S52 | summary | Call delta | Attributed scope |
| matches | `coop2-NORMAL-5-coverage-diy` | S88 | summary | Call delta | Attributed scope |
| matches | `coop2-NORMAL-70-diy` | S88 | summary | Call delta | Attributed scope |
| matches | `coop2-NORMAL-8-serverrun` | S46 | summary | Call delta | Attributed scope |
| matches | `coop3-ABYSS-5` | S88 | summary | Call delta | Attributed scope |
| matches | `coop4-ABYSS-7` | S46 | summary | Call delta | Attributed scope |
| matches | `coop4-FUNNY-6` | S45 | summary | Call delta | Attributed scope |
| matches | `solo-ABYSS-2` | S53 | summary | Call delta | Attributed scope |
| matches | `solo-FUNNY-2` | S42 | summary | Call delta | Pending |
| matches | `solo-NORMAL-2` | S77 | summary | Call delta | Attributed scope |
| standins | `standin-04` | post-sync | summary | Call delta | Attributed scope |
| standins | `standin-08` | S45 | summary | Call delta | Attributed scope |
| standins | `standin-09` | S45 | summary | Call delta | Attributed scope |
| diy | `diy-005` | post-sync | summary | Call delta | Attributed scope |
| diy | `diy-006` | post-sync | summary | Call delta | Attributed scope |
| diy | `diy-010` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-026` | S45 | summary | Call delta | Attributed scope |
| diy | `diy-029` | S83 | summary | Call delta | Attributed scope |
| diy | `diy-030` | S83 | summary | Call delta | Attributed scope |
| diy | `diy-035` | S45 | summary | Call delta | Attributed scope |
| diy | `diy-045` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-051` | S42 | summary | Call delta | Attributed scope |
| diy | `diy-052` | S42 | summary | Call delta | Attributed scope |
| diy | `diy-056` | S45 | counts | No call delta | Attributed scope |
| diy | `diy-057` | S45 | summary | Call delta | Attributed scope |
| diy | `diy-058` | S45 | counts | Call delta | Attributed scope |
| diy | `diy-068` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-072` | S76 | counts | Call delta | Attributed scope |
| diy | `diy-073` | S76 | summary | Call delta | Attributed scope |
| diy | `diy-083` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-086` | S45 | summary | Call delta | Attributed scope |
| diy | `diy-095` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-096` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-102` | post-sync | summary | Call delta | Attributed scope |
| diy | `diy-111` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-114` | S45 | summary | Call delta | Attributed scope |
| diy | `diy-119` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-121` | S45 | counts/snapshots | No call delta | Attributed scope |
| diy | `diy-124` | post-sync | summary | Call delta | Attributed scope |
| diy | `diy-131` | post-sync | summary | Call delta | Attributed scope |
| diy | `diy-135` | S45 | counts/snapshots | No call delta | Attributed scope |

A second independent trace examines damaged/heal/statusApplied/attack/skillStart/skillEnd/kill/death
notifications in the 23 scenes without a damage-call delta. It records callback entry, ignores numerical
crumbs within 1e-6, and preserves its first differing event in the JSON. It does not observe buff application,
all hit hooks or snapshot internals. A scene with no difference in this second trace still needs those paths.
This additional witness is not blanket causal approval of a later snapshot or match result.

For diy-010, even adding hit notifications yields identical observed event streams. Complete wire snapshots
show only two kinds of leaf change: unit flags field 7 and optional layers projection (2322 leaves across the
full run). The first is at t=4: unit 17 retains the same position/HP/maxHP but flags change 0→32 (SHIELD),
with one reported shield layer. S43's native count shield now lives in a real shieldHits Buff; flagsOf and
layerView in snapshot.js consequently expose it. Golden hashes include unit flags, explaining the snapshot-only
movement. No HP/gameplay change is inferred. This projection is attributed; exact native rendering remains
unverified, and no baseline is accepted. The JSON preserves that narrower conclusion separately from the
other pending reviews.

Evidence receipts (SHA-256):

- `attack-s56-v030-digests.json`: `7e9f3073c86ddb91e983b5d7b9604f76749fa9bdbbe428a4de7cb82c349f34d0`.
- `attack-s56-v030-diffs.json`: `3745115f2d856516bf87cf29c0ef7f694c711c270de93726c4aa4b9ba99cfa75`.
- `attack-s56-provenance.json`: `669629afadce0cc0d8b4f167d01c638d4e2e384b83cc424baea773a98cfde4a6`.
- `attack-s56-first.json`: `76027c6bb8e3c482a27527370f6f48fcf9c124a46fc3f0858bc174363d347217`.
- `attack-s57-notifications.json`: `f7bf839d9c2b941c697750b6fd23ee048c3bb008c33b26581eadb8d4ec9c4293`.
- `attack-s57-diy010-snapshot.json`: `0f1c6bf7f76e74196eff304a779380dc3f7958af47c28e9aa425e8edc0bec006`.

Temporary full traces remain outside git; this repository inventory preserves the relevant per-scenario result.
No extracted native data or art is included. Baseline acceptance and final full CI remain separate completion gates.

S58 verification: complete recomputed digests remain equal to this S56 checkpoint. Its Narant before-apply
callback migration has separately verified internal changes (Research 12 S58); the summary equality does not
upgrade the pending causal approvals or turn these historical traces into a new all-callback equivalence proof.

S59 experiment was withdrawn: its seven stage movements and 108 baseline differences are not current
production results. The restored production inputs match S58 (item module code verified by AST after a
comment-only edit). The rejected timing change is documented in Research 12 S59.

S60's complete helper-import migration probe remains equal to S58/S56 summary digests; explicit periodic
metadata and static dependency isolation are separately verified in Research 12 S60. Pending scene approvals
remain pending; this equality is not acceptance of the upstream differences.

S61 completed the no-call-delta review using fresh complete wire snapshots and hit/damage/heal/status/
attack/skill/death notifications against clean 0.3.0. Thirteen scenes differ only in SHIELD bit 32 and
optional shield layers; eight have identical snapshots. The two HP-snapshot cases are Reapers: roster-019
has one 50-HP difference at 137 s, boss-boss_1-solo has ten healing-phase differences. No movement, skill
bar or other snapshot field differs in these 23 scenes. The JSON preserves every difference category and
its mechanism-stage association. This closes their observed scene attribution, not baseline acceptance.

Two additional witnesses avoid misleading first-event conclusions. In roster-013, Titi's healing input at
42.233333 s changes 0.5→535.92 on the same target and prior HP, explaining fewer later heal calls from the
preserved full damage basis on special HP (S46), alongside Entlechia's changed queue (S53). In diy-056,
only barrier status-wire notifications differ: judge barrier gain/loss entries for units 2 and 5 each go
3→1, eight fewer events. Retaining the empty held barrier (S44) removes repeated remove/reacquire messages.

Zero-valued compatibility damaged notifications and special-HP damage amounts are recorded separately
from successful-damage semantics (S32/S43/S46). No item success-phase move is inferred: S59 remains rejected.
Scene attribution is limited to the measured paths and documented simulator policies; original render/frame
identity, arbitrary hooks and the other 80 scenes remain unproven. No golden JSON is modified.

S61 evidence receipts (SHA-256):

- `attack-s61-snapshots.json`: `85a9399debc4258c82916314edb185836f4758c52f235d5ae2f64021f1081b65`.
- `attack-s61-notifications.json`: `0c8a7a54de65b919cbaa09abc88944991b33ef22e2780c02371fa279e9f65804`.
- `attack-s61-titi-heals.json`: `7338f7f8fe3712603e5ac6271bea4079fa365f9ca913dc01ec93e6f7bd6baee0`.
- `attack-s61-penance-wire.json`: `23040053e6156e2757e60ff6adb31e2e78eaf1f6810cd34186a330c1f856b9b0`.

S62 isolates combined fixed/percentage penetration. For 11 first-divergent calls, captured input/stats and
independent old/new arithmetic reproduce observed HP returns within 1e-6. A separate source copy restores
only the two old penetration expressions. Six complete summaries then equal original 0.3.0: roster-003,
roster-045, unite-1, standin-04, diy-005 and diy-006. They are attributed to S9 rather than merely matched
at their first hit. No working-tree formula or baseline is reverted.

Two combined cases are also attributed. roster-017 retains only one snapshot SHIELD-bit difference after
formula restoration: a later ×0.78 reduction previously reduced damage before an earlier barrier. Ordered
injury instead consumes 118.8 barrier at 108 s versus old 92.664, leaving a different shield projection at
135 s; HP and all other summary fields match in that counterfactual. roster-018 retains only heal counts:
Reed's special-HP healing input at 54.133333 s changes 0.6→1477.4152643712005 on the same target/prior HP,
while total healing summaries and all snapshots match; fewer later heal calls follow (58→50).

The other three first-call formula witnesses remain pending as whole scenes: boss-boss_3-pair,
boss-boss_5-pair and standin-09 still have additional counterfactual summary differences. Their first formula
match does not establish their full attribution. No golden is accepted. The source rule is PRTS
[physical/arts damage formulas](https://prts.wiki/w/游戏数据基础#伤害公式): fixed penetration precedes percentage
penetration. Existing fixed-point and rendering qualifications remain.

S62 evidence receipts (SHA-256):

- `attack-s62-penetration.json`: `6f5a95868f1f6c75b5a0a98a37baa66eed2a028a246464ae4721d04015061428`.
- `attack-s62-formula.json`: `f8eb0e310b6d3a79e51b170e73a90011212859d1ac81c4216adfce65f3e695fc`.
- `attack-s62-counterfactual.json`: `7f2e04b27429390ef15cbaf19d2c686a41c1318868f5dced5b98b799747d7e74`.
- `attack-s62-residual-snapshots.json`: `274df5546a1309cc2eded4e9efb9957a4e58835020e1fed196a3448680d1783a`.
- `attack-s62-residual-notifications.json`: `0322ff64a968f853548a5ff90fbd35533d9dcc188a4cd4355fe8a0982c00a797`.
- `attack-s62-angel-barrier.json`: `f75296b20db4b4a73094e3e27e5adb4487f6a25196ac15a52ab579ee481202c2`.
- `attack-s62-shield-state.json`: `b93e52ab48b73c7b19c2f3bc15114e9ac7b3b9331372cf9c617f048940d74b45`.
- `attack-s62-reed-heals.json`: `9a76b20383a16019957ddef18de17cbfcf6f738e3295645c5bf4f392651dac94`.

### S63 refresh: Pegasus source, basis and order

The complete final S63 probe differs in 104 scenarios: 31 roster, 12 bonds, 19 fields, 12 matches,
3 standins and 27 DIY. Relative to S60, only boss-boss_2-pair, boss-boss_3-solo, boss-boss_5-pair,
hidden-boss_8-pair and hidden-boss_10-pair move; boss-boss_3-solo is newly different from 0.3.0.
All five remain pending. All 31 previously attributed scene scopes have byte-equivalent parsed summary
digests to S60 and retain their scoped evidence. This leaves 73 pending reviews; no baseline is accepted.
Updated first-call witnesses are diagnostic starting points, not complete attribution of those scenes.
The production behavior, independent interaction fixtures and source qualifications are recorded in S63
of the mechanism ledger. Evidence: `attack-s63-final-v030-{digests,diffs}.json`,
`attack-s63-final-stage-diffs.json`, and `attack-s63-final-first.json` under `/private/tmp`.

### S64 refresh: Kazimierz classification/source

The final S64 complete probe has 105 differences: 31 roster, 13 bonds, 19 fields, 12 matches, 3 standins,
27 DIY. Only bond-kazimierzShip-high moves from S63; all previous attributed scopes retain identical full
summary digests. The sole new scene is attributed within its recorded scope: a separate copy of current
production with only core.js restored from the preserved S63 source reproduces the complete original 0.3.0
summary exactly. The new interaction fixtures independently establish the rule differences; the callback
phase is still explicitly ASSUMED. This is 32 attributed scopes and 73 pending; all baselines remain unaccepted.
The first call witness at 3.866667 s changes a 651.42 true child from actual carrier source to null source,
with identical input HP/RNG and immediate HP delta. Later whole-scene cascades are not inferred from that
first witness alone: the isolated full-summary counterfactual supplies the causal check. Receipts under
`/private/tmp`: `attack-s64-v030-{digests,diffs}.json`, `attack-s64-stage-diffs.json`,
`attack-s64-first.json`, `attack-s64-kaz-comparison.json`, `attack-s64-kaz-counterfactual.json`.

### S65 refresh: Logos Y inherited loss tags

The complete S65 production digests equal S64 for all 288 scenes; no scene set or scoped attribution changes.
The focused loss-origin fixture establishes a correction outside shipped summary coverage. The native Y
zero/full-shield timing remains ASSUMED. Evidence: `attack-s65-v030-digests.json` and
`attack-s65-logos-comparison.json`. Counts remain 105 changed, 32 attributed scopes, 73 pending.

### S66 causal review: isolate Reaper admission/delivery

Production source is byte-identical to S65. Two separate copies restore (a) only installReaperHeal,
(b) that function plus the two old penetration expressions. Fifteen S53-associated pending scenes run in
each copy; all 30 report zero errors. Four whole summaries deep-equal original 0.3.0 after (a) alone:
roster-032, roster-033, roster-043, bond-indomShip-high. Penetration restoration is unnecessary for those four.

Two more recorded scopes are attributed after exhaustive residual checks. roster-042 retains only one
extra shield-zero damaged notification, with full snapshots differing only in SHIELD bit 32 and its layer
projection (two leaves). roster-005 retains six absent Tinman source-triggered burn gauges/numbers,
24 added shield-zero notifications (net damaged +18), shield bit/layer projection only (237 leaves), and
one extra Papyrus pool loss/gain pair. At 93.266667 s a 376 arts input removes zero HP in both engines:
old early drone cancellation preserves a 108.9 Papyrus pool; ordered injury consumes that earlier pool
then the later drone count shield. The pool's seq precedes the drone in both source copies. Its subsequent
gain at 94 s explains both extra status tuples. Special-HP numbers and one red marker also differ in
payload, without additional event-count movement; these remain covered by S46/S56's source qualifications.

The other nine of these fifteen scenes remain pending. In particular, restoring Reaper and penetration
reduces boss-boss_3-pair to ten summary paths; that is not complete attribution. No gameplay baseline is
accepted. Current inventory: 105 differences, 38 attributed recorded scopes, 67 pending. Native frame/value
qualifications of S53 remain; isolated restoration proves the measured cause, not exact client scheduling.

S66 evidence SHA-256 receipts:

- `attack-s66-old-reaper.json`: `350bc080ffaef5236e812901227b2f1b20428d1b17564eeee58396f58f359bbf`.
- `attack-s66-old-reaper-penetration.json`: `2356a02dc68e31057ee7113fc1dd35f022c32bf6c7d8d386ad2c6ed765657f76`.
- `attack-s66-residual-snapshots.json`: `ebe9153e2f86957d1ef15a79a0ee2add96e61465ae928db24f919c2393f43cf3`.
- `attack-s66-residual-notifications.json`: `bcff797ae79560705ddc6e44332c1a7f29b1714e3b714b25fa38273b46ec0282`.
- `attack-s66-wire.json`: `e144511d2c74d7510b4e0631c8436e144ef6f75731cb50cbcc2b5376ed8a7cd2`.
- `attack-s66-papyrs.json`: `dc02b0104530fbbf7d93d7b156dfb5a2a1a08cd5862d6abae1ca4726ceb6de6d`.

### S67 causal review: special-HP amount and seven scene scopes

Production remains S65. Two counterfactual copies run all 67 pending scenes: (a) only quantize the special-HP
notification basis to its final HP amount, (b) also restore old Reaper and penetration. All 134 summaries
have zero recorded errors (battle count and every match error category checked). Only roster-026 restores
completely in either variant; its sole full snapshot difference is element-gauge projection 0.01→0.11.
This deliberately isolates the amount used by riders; it does not recreate the whole old early-HP pipeline.

| Scene | Complete measured attribution |
|---|---|
| roster-026 | Amount-only restoration deep-equals 0.3.0; the full snapshot comparison differs in one element-gauge leaf |
| roster-035 | Production equals the counterfactual: four transferred losses no longer emit hit, plus one shield-zero damaged notification; one damage-number red marker changes payload, not event count |
| roster-037 | Combined restoration leaves only 58 removed hit hooks; all 58 corresponding true notifications have hpLoss + transfer tags. Penetration alone leaves seven paths, so it is not a one-formula explanation |
| roster-046 | Production equals the counterfactual: at 35 s Yu's gauge bursts first and kills the target; the old 1051.248 arts pulse used to occur first. Exactly one hit/damaged/number disappears; all other summary fields match |
| boss-boss_3-pair | Combined restoration leaves three firewall gauges/numbers. At 66.233333 s Reed x=3, enemy x≈6.253893: old wall x=3 does not cross; native half-tile wall x=3.5 does. Same geometry explains the two later fills (82.233333, 82.566667), each 167.244 |
| hidden-boss_8-pair | Combined restoration leaves fatal 43→42. At 40.433333 s the old already-lethal physical hit emits fatal then its late Pegasus child emits another at HP zero. The new pre-parent child avoids that late repeated fatal; S63 basis/source changes are separately retained in wire evidence |
| diy-058 | Production equals counterfactual; the held Penance barrier emits one fewer on/off pair for unit 2 (status count 54→52), all other summary fields and notification categories match |

The three firewall gauges are a geometry finding (S29), not evidence that changing event name alone created
them. Old special-HP rendering and source-event assumptions are not silently restored in production. Neither
partial counterfactual reconstructs every old damage effect; sufficiency is measured only for the recorded
scene scope above. All 105 baselines remain unaccepted: **45 attributed scopes, 60 pending**.

S67 evidence SHA-256 receipts:

- `attack-s67-old-count-basis.json`: `7260b78b723d13fd3b6b1def63cd713e622d879b6a457b7d7a72a97d971f2a4a`.
- `attack-s67-old-count-reaper-penetration.json`: `2587f3a4f0e5e5d34fdb6f6ce54b2d8d7870070ae8c58bc488b9a248d3d31015`.
- `attack-s67-residual-notifications.json`: `21ec8350f314b03a21f46397c4b77894d5faf197eb33fb252ebfe0c55d1b9407`.
- `attack-s67-residual-wire.json`: `bf86aa857a6334489f5465dc55ae096641e3ca935ddcaddfa02537c0399ba771`.
- `attack-s67-roster026-snapshots.json`: `0d616202ae4cdcf652e9479f04ac55257ecc77f1f94c30601112e627f57527d1`.
- `attack-s67-witnesses.json`: `61ba62be5298e9b88a57225e1855f59ffaaf28d8d87b15e06d5465cd82eb570f`.
- `attack-s67-wall.json`: `dc8c90bbb7986fe475939b5f5aaa214d6c02c213cfb02ef0110caff33b64a867`.
- `attack-s67-loss-tags.json`: `b0b0bec006f06cd7112da0128d488adb59e01c4d5c239b9c9012bcd5bca02138`.
- `attack-s67-roster037.json`: `d3df5d35891a31f11ff6a83fb8c9c5561092f5bab7ec9cf608b21be0da3e1c55`.

### S68 causal review: Vendla injury-time healing and six complete summaries

Production remains S65. Two copied trees restore only Vendla's counter stage, or that stage plus the three
S67 restorations. The experiment retains current receiver-grant lifetime, actual-source checks, ranged
route and ordinary dodge. It does not replace the whole kit with the old implementation. Each variant
runs all 60 pending scenes. A third registration-order variant runs three targeted scenes. All 123 runs
report zero errors; all 11 claimed restored summaries are deep-compared to the original golden payload.

Stage-only restoration exactly reproduces bond-deputShip-high, bond-suntShip-high and
bond-victoriaShip-low. Combined restoration additionally reproduces roster-002 and the complete
coop2-NORMAL-8-serverrun match. These are whole-summary results, not conclusions drawn from one changed heal.

roster-001 also restores after preserving the old late listener's original talent-install registration
position. Registering the experimental listener per cast was initially insufficient: it left two 12.32
actual-heal gaps (30.266667/34.266667 s) despite identical heal inputs and full HP at both ends. That is
an experiment registration-order artifact, not floating dust or a new production bug. Installing once at
the old talent position, while retaining the current grant check, yields full deep equality.

Fresh original/current production tracing confirms the real mechanism at 28.8 s: same 74.1675 input,
old receiver HP 2542.98 and actual heal 82.325925 (Vendla talent ×1.11), versus new receiver still full
at 2805 and actual heal zero before the incoming HP change. The native vendla_s_2 ON_TAKE_DAMAGE and
vendla_tr ON_AFTER_OUTPUT_DAMAGE support the injury-time counter/heal; production is not reverted.
Existing native scheduling/priority qualifications remain.

Current inventory: 105 changed baselines, **51 attributed recorded scopes, 54 pending**, none accepted.

S68 evidence SHA-256 receipts:

- `attack-s68-old-vendla-phase.json`: `5f7d603090e708784c39defad22070dd3ac8d8b45101c1b80e3163a9c9f44044`.
- `attack-s68-combined-vendla-phase.json`: `426586eb825419856d48b37bfed36e0b5de8ce4a462a3cf8a6caf7c8ea34cae1`.
- `attack-s68-registration.json`: `92885fbe7e3c3329391163e3eb9053242ba7b6530134e6f8e134634f47c2a0c5`.
- `attack-s68-heals.json`: `320435163186f12c2c4c8166604484690953cf32f148ca4f14933891a4cb76b2`.

### S69 causal review: Hoshiguma armor/thorns and six scene scopes

Production remains S65. Two copies restore only the original Hoshiguma kit, or that kit plus the S68
combined reconstruction. All 54 pending scenes run in each. The kit reversion deliberately includes the
armor's type/source filtering, early cancellation versus injury stage, and thorns' eligibility/timing;
it is not used to claim that a single callback-name change explains the result.

Kit-only restoration deep-equals original 0.3.0 for roster-012, roster-029, bond-emptyShip-high,
boss-boss_4-solo and hidden-boss_8-solo. roster-010 retains only dmg-event count 1241→1259. An additional
copy restoring just the old kit plus the S67 special-HP observer basis reproduces its complete summary.
No other S68 mechanism is needed there. Thus the whole-scene cause is S21 plus S46 for roster-010,
and S21 for the other five. Native-rule evidence remains the Hoshiguma/ordered-injury source notes.

Wire inspection isolates that extra count: all affected tuples target arts/true-only special-HP unit
38, enemy_1204_msfhu_2. Eighteen positive physical damage numbers now appear despite zero special-HP
decrement; eleven old arts numbers of 1 are replaced by six 506 and five 446 (no extra count from those
replacements). This is damage basis versus HP delta, not eighteen newly effective HP hits. The old-kit
reversion is confined to counterfactual trees; production keeps native injury observation and true blocking.

108 broad runs plus the one reduced reconstruction report zero errors; 12 claimed restored summaries
are deep-checked against original payloads. Current inventory: 105 differences, **57 attributed scopes,
48 pending**, no baselines accepted. Existing precision/rendering/phase qualifications remain.

S69 evidence SHA-256 receipts:

- `attack-s69-old-hsguma.json`: `4e7b5bfc5ecc23e036882eecfac85c6a1bba3e3b57b446d4a4b4e1bef1a1021d`.
- `attack-s69-combined-hsguma.json`: `d6e4cd8f06bd4569b4d1773dca6e6bccdab7e99c90cf78c41cf83f35b53e5317`.
- `attack-s69-roster010.json`: `c5f28a84c9fec9181300b3c145fa3992c26a4c099b662216b5da0c1cc65f4b4b`.
- `attack-s69-numbers.json`: `289293ee034e904f166d84853281557b28def5ed2fa3a497e7ae103a1df6430c`.

### S70 refresh: AST-X correction outside shipped summary coverage

The complete final S70 production digests equal S65 across all 288 scenes; all 57 attributed scopes retain
identical recorded summaries. No scope is newly accepted: 105 differences, 57 attributed, 48 pending.
Independent fixtures establish AST-X's ADDITION versus NORMAL classification, precomputed source-calculation
suppression, ordinary outgoing dodge and non-recursion with Pegasus; the broad golden summary does not expose
those corrected inputs/interactions. The earlier 96-run burst-dodge experiment restores no whole summary and
moves only three still-pending fields within its combined reconstruction. Production does not adopt that
old suppression. Native ability lineage remains open. S71 corrects the earlier actor-class note: S11 already uses entity class
independently of team, with an existing cross-team fidelity regression.

Evidence under `/private/tmp`: `attack-s70-v030-{digests,diffs}.json`,
`attack-s70-module-comparison.json`, `attack-s70-{old-burst-dodge,combined-burst-dodge}.json`.

### S71 causal review: AST-X period and output order, plus actor-note correction

Production remains S70. Two counterfactual trees enable the old always-on AST-X gate, alone and with the
prior combined reconstruction. All 48 pending scenes run in each, none restoring a whole summary from
that gate alone. diy-051/diy-052 reduce to three fields only: hit/damaged/dmg-number counts. Restoring only
the original AST-X install block in a third copy then deep-equals both complete original 0.3.0 summaries.
All 98 counterfactual runs report zero errors; other kit logic is unchanged in the reduced block experiment.

The residual count movements are diy-051 hit +9, damaged/number +7; diy-052 all three +6. A fresh nested
witness explains the two-entry gap: at 168.066667/174.466667 s, targets 104/106 start at about 58.189191/
71.297229 HP. Old parent removes that HP; new early module child removes it and the parent's call returns
zero, suppressing its later damaged/number tuple. This is order and overkill bookkeeping, not additional
HP removed. Full module reconstruction, not this single witness alone, establishes the recorded scope.
The native module period/output metadata sources remain those in S34/S42/S70; production is not reverted.

S71 also corrects S70's actor-model note. Current burst code already uses target.isEnemyEntity (S11), and
an existing fidelity fixture checks allied enemy-class burn 7000 versus the independent old 1200 path and
2000 leader capacity. That fixture is present and passes; no duplicate fixture or production fix is added.
The full existing attack-fidelity file passes 20 tests. The earlier side-based-defect statement was an audit
mistake, not a newly confirmed engine defect. Unsupported actor classes remain outside the stated model.

Current inventory: 105 differences, **59 attributed recorded scopes, 46 pending**, none accepted.

S71 evidence SHA-256 receipts:

- `attack-s71-old-astx-gate.json`: `5261ab1301b82fc89ac4d0d1d643a9b78d90e16e5041cca4bb33da66ee8ee3f2`.
- `attack-s71-combined-astx-gate.json`: `f0699d81e606a8a9863e500e09d244ea677bfe0976166df6bb130672ca79fe92`.
- `attack-s71-module-block.json`: `107b88eef02e54ea08c29d2d0bebb95955b9adcef0b7332567cf1d61aa8d3562`.
- `attack-s71-residual-notifications.json`: `c43f4d3628ed7ab0532983b3c0fe8bbb973adfed2831415e886448fe4e6d8fa1`.
- `attack-s71-residual-wire.json`: `af1d9ad64a6fd981434694016029eacff642f5144a0c6f8a80c70263257bfed7`.
- `attack-s71-module-order.json`: `8ab52e29106b23240dd75379d4b3cdc6d70d1832557eb0609a57549b459f0c6e`.

### S72 causal review: Tinman source/coverage and one complete recorded scope

Production remains S70. Two copies restore the original Tinman shared/S1 kit modules alone, or add that
restoration to the earlier combined reconstruction. Both run all 46 pending scenes: 92 zero-error runs,
no direct whole-summary restoration. This experiment groups source/classification, amplification stage,
coverage and lifetime; it is not evidence that a single source switch explains every resulting scene.

roster-006 reduces to two counters in both variants, with identical complete digests between variants.
Replacing only those two counters with original values produces deep equality to original 0.3.0.
The residuals are measured completely: damaged 583→591 is eight absorbed-zero notifications to enemy
Mudrock (sources 2_18_b ×4, Tippi ×1, 3_04_a ×3); dodge 3→8 is five newly reported Tippi attempts.
Their actual cancellation/HP/RNG and all snapshot/summary values agree in this reconstruction. The S47
attempt-reporting evidence and S14/S32 zero-notification policy explain these, independently of the
Tinman S48/S49 corrections. This closes one recorded scope: **60 attributed, 45 pending, 105 unaccepted**.

boss-boss_2-solo remains pending. Its reduced residual includes four additional SilverAsh arts-module
instances and snapshot HP changes. Current SilverAsh still subscribes to late damaged while PRTS explicitly
places LOR-X at source calculation with precomputed ADDITION damage. That caller must be migrated and
validated before this scene can be accepted. Other lord module afterHit/manual additions require the same
source/event inspection; no blanket assumption or partial scene acceptance is made here.

S72 evidence SHA-256 receipts:

- `attack-s72-old-tinman.json`: `8cac45074bc5299a38d36890b206068bef95ebee442470e72906de34928ef0c1`.
- `attack-s72-combined-tinman.json`: `00bbc1dc7a43771e083d2a3e72014d141dd542a8e1bf914a01ddf9fe17199437`.
- `attack-s72-residual-notifications.json`: `f01b4409ee8d20b3705f32dd1a4ed498b2ed8ffba570bfc3c5f8f845d10d633d`.
- `attack-s72-residual-snapshots.json`: `d3730d14df0e728452bf355a85440c941599b3eb9d314e1c8f0bdff2d169275b`.


### S73 checkpoint

Lappland LOR-X now runs on source calculation and emits precomputed arts ADDITION before its parent.
Three digests change against S70: roster-006, bond-siracusaShip-high (new against 0.3.0), and
coop2-NORMAL-1-coverage-standins. All three scopes are pending. The earlier S72 roster-006 explanation
is historical and does not approve this new digest. Full recomputation: 288 scenarios, zero simulation
errors, 106 unaccepted differences. Baseline files remain untouched. See the S73 ledger for exact native
records and independent old/new fixtures; first-call traces for all three were refreshed.

S73 evidence SHA-256 receipts:

- `attack-s73-module-comparison.json`: `5989ef2d3e667f22b5d7b3772bbf27a7341a5eec535847f8f6baa6838515ef8f`.
- `attack-s73-v030-digests.json`: `6f3d12910d4b081a54d4e800c2da2206fd9bf1acda166c28fc39fe44ae80262f`.
- `attack-s73-v030-diffs.json`: `051446412d62736ebd927fbadeec090d3979ebeac60a4e910b6f546166eafd0d`.
- `attack-s73-first.json`: `7639f029be268b8c094be29a44a407c1f7f8c5f6c0a37624cf3269dee3c884a3`.


### S74 checkpoint

Ayer now emits precomputed arts ADDITION at source calculation, reads skill atk_scale, and excludes
HitBlockee (ayerBlade). Pending S1 projectiles retain their skill attack eligibility after launch. PRTS also
corrects S2 targeting to include Ayer herself as well as adjacent allied blockers; the old self exclusion is
removed. Only roster-008 changes against S73. Restoring just the old Ayer production file (all other server
JS equal to current) deep-restores its full S73 digest. Combined with its retained S61/S46 notification
review, this attributes the new recorded scope without accepting a baseline. Current counts: 106 different
scenes, 59 attributed scopes, 47 pending; 288 runs have zero simulation errors. The engine/content suite
passes 3611 with 3 skips. See S74 native/PRTS and independent fixture evidence in the settlement ledger.

S74 evidence SHA-256 receipts:

- `attack-s74-module-comparison.json`: `38ef4bef56c2a418c3c89c491848d25fcc5b648513c41cf597a73b9d8b0eb88d`.
- `attack-s74-counterfactual.json`: `51dcba51b8b4f73ae080d8e2783d7f1aeb2a958f480046a6babe042c3298fc7d`.
- `attack-s74-v030-digests.json`: `8a0bf9a2c08acf836b6a14cd6e937c2c04c65f7dea9fd0b67750ee9dafacd438`.
- `attack-s74-v030-diffs.json`: `388d0c3c5c10865b1c1021f22f09c50c1db6943ed6e2c5d22e61b435dfed77b0`.
- `attack-s74-first.json`: `31143885a5b09f8205363bffd090746652c8fa8b47dd521e3ac73c10d9ee4b71`.


### S75 checkpoint

SilverAsh uses precomputed arts ADDITION at source calculation, with pending-S1 and independent elite/boss
base multipliers. Shipped forms have stage 1; higher-stage native talent scaling is injected fixture coverage,
not an added selectable loadout. Nine summaries change against S74. Restoring only the old SilverAsh file
with every other server JS equal to current deep-restores all nine complete S74 digests, errors zero.
Five previously reviewed scene scopes are extended by this isolated delta; bond-sargonShip-high and
boss-boss_6-solo are new and their prior full summaries deep-equal 0.3.0. boss-boss_2-solo and
hidden-boss_10-solo retain pending earlier scope. Thus 108 differences, 61 attributed scopes, 47 pending.
All 288 simulations have zero errors; baseline files remain unedited. First-call traces are refreshed for
all nine. Native/PRTS and independent real-attack evidence is in the S75 ledger.

S75 evidence SHA-256 receipts:

- `attack-s75-module-comparison.json`: `5fe366ef83b40cbdf09a0d9bd99c57a40fff5623506c537541e3e3a2e1a9598d`.
- `attack-s75-counterfactual.json`: `400a8c4474637435c20a2f09de20d376ac8bf5b2b25f069abadcb5ffa9ce7e90`.
- `attack-s75-baseline-proof.json`: `3099c90d487239505e498c0bdd7375e2a42099dc5c1452f329291075772ea3ab`.
- `attack-s75-v030-digests.json`: `76eaead295db3aff9d2196dc6842a39812bb8657d7382c7723196b24b4020bf0`.
- `attack-s75-v030-diffs.json`: `3ed9e1e071e5dae0caa119ac30c15f0eca02e23a29d00c7cfe08b9c4c360cf8f`.
- `attack-s75-first.json`: `6b71009c3186e3349fbc0e2b1ca79bd8bd6997841c573b5a9b0defa6e6ba905a`.


### S76 checkpoint

Thorns X uses source-calculation precomputed arts ADDITION; fixed poison uses precomputed BUFF with
ordinary cancellation, without another source-calculation/module trigger. S2 is a skill-held injury observer
filtered by explicit NORMAL, independent of tags/cancelled status; Delta reads output damage before injury.
Attack-shaped HP loss cannot apply poison. Only diy-072/073 move against S75. Restoring just the old
Thorns file (other server JS equal to current) deep-restores both complete S75 digests; diy-072 prior also
deep-equals 0.3.0. It closes as a new attributed scope; diy-073 retains its older pending scope, with the
S76 delta recorded separately. Current total: 109 differences, 62 attributed scopes, 47 pending. All 288
simulations have zero errors. Engine/content: 3642 passes, 3 skips. Baseline files remain unedited.
See the S76 ledger for the native/PRTS evidence, 16 independent old/new fixtures and explicit zero-event
qualification; no native zero-emission or complete client equivalence is claimed.

S76 evidence SHA-256 receipts:

- `attack-s76-comparison.json`: `20b33252820bb1d9dee885dfe7181105e3fcbcd0cc637130e729f666448ae585`.
- `attack-s76-counterfactual.json`: `98fea2357f47022fe12e4a0bfbad3fa238514b1093c0ec23c66d72a9bd5c338f`.
- `attack-s76-v030-digests.json`: `0de80e8615e3b0c6676f45bab5376f8b978d8ce485bd3fc513636a5e01f74928`.
- `attack-s76-v030-diffs.json`: `36921048f9cc376423129878e74c8c50db975cd902e022aad1e5b1429401d720`.
- `attack-s76-first.json`: `7eadd57996bcc632a9bee58824ee9fe21d3359bc29c5199b282cd97219b39c4c`.


### S77 checkpoint

Qiubai X and 落英 move to source calculation; 入隙 creates a target-held native-key effect which checks
control on finish after an absolute 0.1 s deadline. Module and talent children are precomputed ADDITION,
NONE route, with parent origin; neither repeats source calculation. Y first marks are per deployment.
Replacement of a repeated same pending key and relative DEFAULT listener acquisition order remain
[ASSUMED], not established native equivalence. Separate base/upgraded native keys are preserved.
Thirteen summaries change against S76; restoring only the old Qiubai file with all other server JS equal
to current deep-restores all 13 complete digests, every error field zero. Four newly different scenarios
(roster-036/047, boss-boss_1-pair, solo-NORMAL-2) had full S76 summaries equal to 0.3.0. Five previously
reviewed scopes retain their historical review plus this isolated delta; four earlier pending fields remain
pending. Thus 113 differences, 66 attributed scopes, 47 pending; all baselines unaccepted and unedited.
All 288 current scenarios have zero simulation errors; engine/content has 3656 passes, 3 skips. See the
S77 ledger for PRTS/native evidence, 14 independent old/new fixtures and exact timing tests.

S77 evidence SHA-256 receipts:

- `attack-s77-comparison.json`: `07a21b0f3b4ac5361977edcf9d30fac3a4656a40dff9189dcb5eba8739dc84ec`.
- `attack-s77-counterfactual.json`: `ddf1184f8863390511e61ba9901a3245f78fcd0fc258b2dbe7f25cb0495e1f98`.
- `attack-s77-v030-digests.json`: `7641834b61b7265040837a3504d78e1db9b6b8e128750ee1dab631476067eab2`.
- `attack-s77-v030-diffs.json`: `a3ba3cbb0378663a5e50129c4cc71aec7fdbf17e7216c847f5196fa5735dcc1d`.
- `attack-s77-first.json`: `12db0f3dbd9d39e59e807853337afae56b47b5ba47ea7122a381c17a22d8ad12`.


### S78 review checkpoint (production remains S77)

Two controlled reconstruction groups each run all 47 pending scenes, with every error field zero. The initial
12-file group restores bond-siracusaShip-high; a 15-file extension also restores boss-boss_3-solo. Subsequent
isolation is stronger: old Lappland alone deep-restores the bond to 0.3.0 and roster-006 to S70/S72 production;
old Pegasus alone deep-restores boss-boss_3-solo. Thirteen fresh-process removal trials drop every other
restoration from that boss scene. The final copy differs from current server JS only in the Pegasus handler.

roster-006's combined reconstruction is also deep-identical to the retained S72 reconstruction. Normalize just
the correctly indexed damaged/dodge hook columns (583→591 and 3→8) and the full digest deep-equals 0.3.0.
S72 already enumerated all eight zero notifications and five Tippi dodge reports. This exact chain carries
that review forward rather than inferring it from similar counters. Three scopes close: 69 attributed,
44 pending, 113 unaccepted differences. All current production and golden files remain unchanged.

This stage comprises 112 isolated scenario runs (94 grouped, two Lappland, one 13-file Pegasus check,
and 15 fresh-process minimization runs). All runtime error fields are zero. A verification script initially
used object properties for positional hook columns; it was corrected to HOOKS indexes before the full
deep-equality assertion passed. No production/test expectation was changed for that verification correction.

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

All 435 server JS files are byte-equal to the S77 archive; docs report 32 passes.

- `attack-s78-production-proof.json`: `38584190622d3bf1ae9a4c7b1aba862500a4cb57fa17329b6127ebfd2ec81b60`.


### S79 checkpoint

Yu's blocked-target arts pulse explicitly uses precomputed BUFF/MELEE. The native template disables source
calculation while keeping target calculation/injury; both forms have source-callback and shield/dodge fixtures.
All 288 complete summaries deep-equal S77, every error field zero. One pending scope closes: reversing just
the pulse order, while retaining the modern descriptor and all other production JS, deep-restores roster-016
to 0.3.0. PRTS/native require the new gauge-before-arts order; the reverse is counterfactual only.

A 16-file extension of the S78 known-mechanism reconstruction runs all 44 previously pending scenes, errors
zero. Compared with S78 reconstruction, only roster-016 and coop2-NORMAL-14-standins move; only roster-016
fully restores. The other 43 scopes remain pending, including the stand-in full match. No generic Boss-stat
explanation or approval is inferred. Current totals: 113 unaccepted differences, 70 attributed scopes,
43 pending. Engine/content: 3662 passes, 3 skips. The new settlement migration guide explains API choice,
source/credit, stage/class/route, receiver observers and the already-mitigated legacy loss conversion.

S79 evidence SHA-256 receipts:

- `attack-s79-yu-comparison.json`: `0dc2edd6200fa28d473a580c152c00c107af6359350be2c6a5e2bbfb19713e81`.
- `attack-s79-yu-order.json`: `18730e55b85e093b4981b5bf0162b68ac659c6cee95e4c488afa82fbf327532a`.
- `attack-s79-combined-source.json`: `c408be632b0860c711d57ccb2fc42aa09d5ec84cd363355347fe36940f44d9f5`.
- `attack-s79-combined-yu.json`: `f905c1768cf2f69ed322933bb15489a76c51a6e47351bf727202eaff7d67a43e`.
- `attack-s79-v030-digests.json`: `7641834b61b7265040837a3504d78e1db9b6b8e128750ee1dab631476067eab2`.
- `attack-s79-v030-diffs.json`: `a3ba3cbb0378663a5e50129c4cc71aec7fdbf17e7216c847f5196fa5735dcc1d`.
- `attack-s79-verification.json`: `85e89f77ced08b204a57bf9b5b4077987ffb6d01dc496496d33639ceddd71c61`.


### S80 checkpoint

Four controlled groups each run the 43 pending scenes: aggregate target formula alone / with prior known
mechanism reversals, then both with old early aggregate generic dodge. Every error field is zero. The isolated
two-file target-formula copy deep-restores diy-102/124/131 completely; target multipliers remain ordered in
production per PRTS. A smaller three-file generic-dodge/special-HP-basis copy (current target ordering kept)
deep-restores roster-034/041. roster-028 differs only by hooks.damaged 665→666; normalizing that sole column
deep-restores all fields. The extra event is one zero arts notification to Mouse King's barrier at 52.5 s,
source chess_char_4_02_a; independent event totals and errors are checked. All six scopes are attributed,
not accepted baselines. Counterfactual generic dodge FX does not establish yellow-MISS payload equality.

A real metadata inconsistency was corrected: full numeric absorption now marks the observer cancelled,
agreeing with block events; a separate private notifyZero flag retains legacy zero bookkeeping. Shield/pool/
callback blocks and accepted/rejected cancellation have explicit observer/legacy/positive-damage tests.
All 288 complete S80 summaries deep-equal S79, every error field zero. Engine/content: 3662 passes,
3 skips. Current review totals: 113 differences, 76 attributed scopes, 37 pending. Baseline files unedited.

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

Documentation checks report 32 passes.

- `attack-s80-v030-digests.json`: `7641834b61b7265040837a3504d78e1db9b6b8e128750ee1dab631476067eab2`.
- `attack-s80-v030-diffs.json`: `a3ba3cbb0378663a5e50129c4cc71aec7fdbf17e7216c847f5196fa5735dcc1d`.


### S81 review checkpoint

Production remains S80: all 435 server JS files byte-equal its archive. Four groups each run the 37 pending
scenes without errors. Restoring only the old enemy count-shield grant/early cancellation deep-restores six:
`bond-swiftShip-low`, `coop2-NORMAL-70-diy`, `standin-08`, `diy-026`, `diy-086`, `diy-114`.
Restoring only Naran Tuya's old late trigger restores none, alone or with prior known reversals.

Eight further complete restorations are verified after greedy per-file removal in fresh processes:
`roster-038`, `bond-suntShip-low`, `boss-boss_2-solo`, `boss-boss_7-pair`, `unite-2`, `coop4-FUNNY-6`,
`standin-09`, `diy-073`. Each retained group includes the old enemy count-shield branch; additional reversals
are documented in the [S81 mechanism ledger](12-settlement-refactor.md#s81-enemy-count-shields-early-cancellation-propagation-and-complete-scene-reconstruction)
and per-scene JSON. These are reduced groups, not globally minimal or whole-client equivalence proofs.
All 332 controlled runs have zero simulation errors; final deep equality and all source files are independently
verified. The ledger records hashes and the retained native timing/ownership/cap/rendering qualifications.

A separate old/current real-enemy Naran Tuya fixture reproduces the 949.9→968.8 next-hit difference from DEF
300→279 with 10% ignore. The integration regression checks both forms, absorbed-zero cancellation and no
positive-damage event. Focused tests: 43 passes; expanded tests: 319 passes. Scoped lint has no diagnostics; documentation consistency/path checks report 32 passes.
Native ON_TAKE_DAMAGE supports the production count shield rather than the counterfactual early branch.
Current inventory: **113 unaccepted differences, 90 attributed recorded scopes, 23 pending**. Golden files
and production summaries remain unchanged; final completion gates are open.

### S82 review checkpoint

Only restoring Logos T2's old mark/addition mechanism deep-restores diy-029. Adding old special-HP
notification basis, in a separately verified two-file group, deep-restores diy-030. All other server JS
remains current. Both broad initial groups run all 23 pending scenes without simulation errors. Native
source/target calculation events and PRTS support the production mark/addition behavior; old early-hit
behavior is retained only as a causal counterfactual. Detailed source hashes and qualifications are in the
[S82 ledger](12-settlement-refactor.md#s82-logos-t2-sourcetarget-calculation-and-special-hp-input-basis).
Current inventory: **113 unaccepted differences, 92 attributed scopes, 21 pending**; production remains S80.

### S83 checkpoint

Only Logos S1 changes in production: native death-conditioned T1 triggering now precedes follow-up emission,
including attempts without a follow-up target. Native projectile arrival order is unverified; the inherited
immediate-delivery convention remains explicitly ASSUMED. Three regressions cover six form/outcome combinations.
All 288 summaries are error-free; only diy-029/030 differ from S80. A single-file restoration deep-restores
both, preserving the S82 historical reviews plus this isolated delta. See [S83 native and old/new evidence](12-settlement-refactor.md#s83-logos-s1-talent-trigger-is-death-conditioned-and-precedes-follow-up-emission).
All serialized differing paths are now stored without the standard report's 40-path cap. Snapshot hashes remain
opaque. Engine/content: 3666 passes, 3 skips; focused: 54 passes; scoped lint clean. Inventory: **113 unaccepted
differences, 92 attributed scopes, 21 pending**. Golden files remain unchanged; final completion gates stay open.

### S84 review checkpoint

Production stays S83, all 435 server JS files byte-identical; golden files are unchanged. Eight broad groups
run all 21 pending scenes. A one-file Rmixer restoration deep-restores boss4-pair. Paired, coherent groups
also deep-restore roster-014, solo-ABYSS-2, diy-057, diy-035 and coop3-ABYSS-5. The last match has a final
five-file reconstruction retaining current injury generic dodge and current enemy count shields. All other
server files and every complete restored summary are independently verified.

A per-file experiment flaw was corrected: injury dodge suppression and target-multiplier suppression must
match the restored pre-stages. Eight affected reduced candidates were repaired; all eight still fully restore
their baselines. Six historical S81 evidence records now reference the coherent repairs. Initial broad groups
were coherent already. Original raw reductions remain historical experiments, not approval evidence.
There are 307 successful simulation runs, all engine error fields zero; raw exploratory candidates are
separated from approved mechanism groups. Mlynar and fixed-reduction hypotheses do not restore their tested
remaining fields. InverseDamage hidden dodge defaults remain source-unsettled. See the [S84 source/experiment
ledger](12-settlement-refactor.md#s84-executor-penance-zuole-and-rmixer-complete-scene-review-paired-experiment-correction).
Current inventory: **113 unaccepted differences, 98 attributed scopes, 15 pending**. No final CI/acceptance claim.

### S85 checkpoint

Spring defences now use the shared injury machinery: typed numeric/count shields, native physical NORMAL
filter and source-less ADDITION counter, ordered element-shield reduction, permanent unblockability. Nested
buff removal during Qiubai finish damage uses identity snapshots to avoid stale-index failure. Source-backed
old/new values and outstanding passive/pre-burst migrations are in the [S85 ledger](12-settlement-refactor.md#s85-spring-defences-reuse-native-injury-effects-reentrant-buff-removal-is-safe).
All 288 final scenes are error-free. Only hidden-boss9-pair, hidden-boss9-solo and coop2-ABYSS-10-boosted
move from S83; a one-file bosses.js restoration retains the lifecycle fix and deep-restores all three earlier
summaries. Earlier causal scopes remain pending, so these receive partialReviews only. Other 285 complete
digests deep-equal S83. Engine/content: 3683 passes, 3 skips; targeted: 343; final lifecycle/healer/element: 28.
Scoped lint: 0 errors, 6 existing warnings. Inventory remains **113 unaccepted differences, 98 attributed
scopes, 15 pending**. Golden files unedited; final CI and acceptance remain open.

### S86 checkpoint

Spring sharing now follows native post-modifier versus held injury stages. The arts variant includes ordinary
healing and gauge input; HP loss no longer feeds sharing. Highest-hatred gun selection replaces nearest-gun
selection. Counter erosion requires successful damage, correcting S85's independent-rider interpretation.
Existing burst notification timing is verified; initial acquisition order, parallel splitting and a native/PRTS
count-shield filter discrepancy remain qualified. See [S86 ledger](12-settlement-refactor.md#s86-native-spring-passive-stages-and-successful-counter-riders).
All 288 scenes have zero simulation error fields. Three scenes move from S85; restoring only S85 bosses.js
retaining the current generic modifier/callback engine deep-restores all three. Other 285 complete digests
are unchanged. Focused tests: 353; engine/content: 3702 passes / 3 skips; configured type slice passes;
scoped lint: 0 errors / 6 existing warnings. Inventory: **113 unaccepted differences / 98 attributed scopes /
15 pending**, with 4901 uncapped serialized paths. Golden files unedited; final CI/acceptance still open.

### S87 review checkpoint

Production remains S86, all 435 server JS files byte-identical. Old Stead's pre-barrier cut explains the
previously omitted shield-consumption difference. Fresh-process groups deep-restore roster-023 (two files),
roster-004 (six) and coop4-ABYSS-7 (three). Aggregate formula/dodge/effects remain atomic throughout removal
trials and drop from all final groups. All other production files and every complete digest are independently
verified. There are 86 error-free minimization runs; focused bond/injury suites pass 105 tests; scoped lint
has no diagnostics. Current native Stead ordering remains ASSUMED; Tippi skill/talent timer and held-dodge
migration are newly explicit gates. See [S87 mechanism and source limits](12-settlement-refactor.md#s87-stead-barrier-placement-closes-three-complete-scenario-scopes).
Inventory: **113 unaccepted differences / 101 attributed scopes / 12 pending**. No final CI/acceptance claim;
golden files unchanged.

S87 expanded review also closes coop2-NORMAL-3, coop2-NORMAL-14-standins and
coop2-NORMAL-1-unowned-roster. The missing garrison restoration concerns weakness's calculation phase and
restricted theoretical factor set; phase tracing confirms Utage conversion happens first in both versions.
Reduced final groups contain respectively two, six and two files; all other production files are byte-verified
current. The final six cases retain coherent aggregate formula/dodge/effects and count-shield grant/dispatch
pairs. All 179 minimization simulations are error-free, and every final complete summary deep-restores 0.3.0.
Production remains S86; inventory is **113 unaccepted differences / 104 attributed scopes / 9 pending**.
Original client/Tippi timing gates remain open; no final CI or baseline acceptance is claimed.

### S88 checkpoint

Tippi now starts its talent timer on deployment, acquires a held one-use dodge on completion, and distinguishes
ordinary injury timer restart from S2's earlier applying-modifier cancellation. Successful S2 dodge preserves
the talent/timer and still follows source calculation/output. Native templates and PRTS agree on these phases;
the existing 30 Hz scheduler qualification remains. See [S88 old/new/source evidence](12-settlement-refactor.md#s88-tippi-separates-early-skill-dodge-talent-timing-and-held-injury-dodge).
Eight summaries move from S86; restoring only the old Tippi kit retains the current core target applying stage
and deep-restores all eight. Two new baseline differences are entirely isolated this way. Other 280 complete
digests deep-equal S86; all 288 scenes have zero error fields. Focused suites: 157 passes; engine/content:
3710 passes / 3 skips; scoped lint: 0 errors / 1 existing warning. Inventory: **115 unaccepted differences /
106 attributed scopes / 9 pending**. Final CI and baseline acceptance remain open; golden files are unchanged.
