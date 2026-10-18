# Settlement branch cleanup and v0.3.1 integration

The active branch is `refactor/settlement-api`. Its initial commit uses the exact tree of the earlier v0.3.0
refactor merge and has v0.3.0 as its parent; the five later refactor/audit checkpoints are replayed in order.
The unrelated `fbc52d0f` passenger-fix commit is absent from its ancestry. Pre-merge old/new trees both equal
`4fd72d813e741d32a0f910621a7044bc1134e276`. The old branch remains available; no force push is needed.
The duplicate passenger history inherited from that commit is removed; upstream passenger code, tests and
its own §32.14.4 documentation remain unchanged. Clean-tree receipt: `2e19163f72a17a36a5767f367d487ac953df4500d44ca1bbd437f56e69e76ed0`.

The released v0.3.1 tag `b3deebdae4a92642c007d217a1a4573e5d3612c5` is merged. Both document conflicts
in SIM.md retain the settlement migration guide/notes and upstream test-room/plugin documentation. Code
merges without textual conflict; overlapping enemy helper, archetype, unit and bot changes retain both
upstream additions and refactor imports/effects. The integration makes no additional mechanism correction.
Upstream's existing carrier behavior is retained, rather than reintroducing the unrelated fix commit.

Upstream restores 琳琅诗怀雅 S3's always-open behavior and updates roster-039. Both changes are retained
verbatim. Every golden file is byte-identical to the released tag; no refactor baseline is regenerated.
The unchanged original damage.js implementation remains the historical oracle, not an updated v0.3.1 kit.

Verification is intermediate, not final acceptance:

- Engine/content: **3740 total, 3737 passed, 3 skipped, 0 failed**.
- Test-room/passenger/teammate-loadout integration: **75 passed, 0 failed**.
- Documentation: **32 passed**. Scoped lint: zero diagnostics. Configured JS type slice: passes;
  this does not claim all implementation files have checked-JS coverage.
- A separate clean v0.3.1 checkout reproduces all **288** shipped golden baselines.
- Current production recomputes all **288** scenes with zero simulation errors. Exactly roster-039 changes
  from pre-merge S90, and it matches upstream. Other 287 complete summaries are unchanged.
- Every one of the **118 unaccepted** complete serialized old/new differences deep-equals the pre-merge
  S90 comparison, including all **4929 uncapped paths**. Attribution remains **112 scopes / 6 pending**;
  this does not accept golden baselines or settle original-client assumptions.
- Import-boundary inspection reports **3 violations** in nodeData.js (node:fs/path/url). Strict checking
  of a separate clean v0.3.1 checkout reports exactly the same lines; both nodeData.js and the checker
  byte-equal upstream. These are existing upstream failures, not an import-check pass.
- Full CI, browser suites and final refactor/golden acceptance have not run at this intermediate stage.

An initial in-memory comparison of diff objects failed because parsed historical JSON omits undefined keys;
normalizing the new report through JSON serialization produces exact deep equality. Production digests and
scenario errors were independently checked before this report-format normalization.

Receipts (SHA-256, preserved under /private/tmp):

- `attack-v031-verification.json`: `1d5c8e934c33f412fe3c218fdaed532596d0c5cfe8eedabc20e7d4e380e37cdd`.
- `attack-v031-current-digests.json`: `9e1d52fc6a44115c4a9a75e5acab78fb63e27ddbb5e79c4c8b70ad0b18cb7ff6`.
- `attack-v031-original-digests.json`: `c82254407d7acdf75cff41ee8b1e32ba278e64b1527ed2d3bb376b85a6096c83`.
- `attack-v031-full-diffs.json`: `b9853713e70c9871737186bcdcb515e2e34c14b91bcafee154735b2417902e0d`.
- `attack-v031-original-imports.log`: `7fd0e436a30103f735c093167004e3688a6c3a5289b9126db1c4d5cf34746098`.
