# Final local settlement verification (S95)

The local implementation and regression verification are complete. This is a reviewable experiment, not
maintainer merge approval or a guarantee of original-client frame equivalence. The primary Chinese deliverable
is [旧行为、新行为与修改依据](settlement-behavior-comparison.md). The [value assessment](settlement-evaluation.md)
separates API clarity from code size and the gameplay-review cost.

## Final checks

Command, from this worktree with locked local dependencies and the temporary Python first on PATH:

```sh
env PATH="/private/tmp/attack-python312/python/bin:$PATH" node tools/ci.mjs --keep-going
npm run golden
```

The first command is the full `npm run ci` runner with all steps retained and keep-going enabled. It includes
all tests; the accepted 20 full-match seeds are unchanged. No failing test was excluded to obtain this result.

| Check | Actual result | Scope / limitation |
|---|---|---|
| Setup | pass | Optional game art is absent; no download or asset commit |
| Unit/integration | 9010 tests, 8949 pass, 0 fail, 61 skip, 0 cancelled | Default CI switches; optional Chrome/art suites are not represented as executed |
| Server smoke | pass | Real server boot, required HTTP routes and doctor |
| Full lint | 0 errors, 148 warnings | Repository allows warnings; not a zero-diagnostic result |
| Import checker | exit 0, but **3 violations** | nodeData.js imports node:fs/path/url; same findings reproduced in clean v0.3.1. Not a clean strict import boundary |
| Configured typecheck | pass | jsconfig slice; not every engine implementation file is checked JS |
| Independent API compiler probes | 9 new/legacy calls resolve; 3 invalid HP-loss calls rejected | Same-name overload deprecation strike-through is not promised |
| Separate full golden | 288 scenarios match, 0 differences from updated files | All six families, including 21 full matches; not only fast tests |
| Final baseline inventory audit | 118 changed scenarios vs v0.3.1, 4946 uncapped paths | Every id/path equals the recorded inventory; snapshots are opaque hashes |
| Legacy oracle | executable AST equals released v0.3.1 | Comments and locations excluded; old implementation is not a wrapper |
| Branch/conflicts | refactor/settlement-api; v0.3.1 merged; 0 unmerged files | Unrelated passenger commit fbc52d0f absent; old branch preserved, no force push |

All stored summaries equal the independent S94 recomputation, with every simulation error field zero.
S95's zero-delta hpChanged correction changes no complete summary; the fresh full golden establishes this
on the final runtime. Regression baseline acceptance is local, not proof that every ASSUMED native detail
is correct. The Chinese comparison explicitly retains the unresolved sharing, scheduler, display, mask,
priority and mode-limit questions.

## Initial failures and what resolved them

The first sandboxed full CI could not bind real service ports. Three specific service-test child processes
remained waiting after their failed setup; their process states were inspected and they were terminated so
the parent could summarize. That interrupted run is not counted as passed. Complete subsequent runs occur
outside the sandbox, allowing local server/WebSocket fixtures.

The first unrestricted run reports **8880 pass / 69 fail / 61 skip**. Those failures were classified:

- 51 Python extraction/render/setup/emote cases fail under system Python 3.9.6 syntax parsing. A clean v0.3.1
  model test reproduces the error. A temporary Python 3.12.15 runtime resolves the affected targeted group:
  126 pass, 13 skip, zero fail. No Python tool source or system installation is changed.
- 16 plugin/worker/package cases depend on ses and its packages, absent from the main checkout's older shared
  node_modules. The original symlink is preserved at /private/tmp/stronghold-damage-shared-node-modules-20261018;
  npm ci installs 200 packages in this independent worktree from its own lockfile. Main dependencies and the
  repository package/lock files remain untouched. Related API/loop-cap/SES checks then pass all 45 tests.
- Two refactor integration regressions are actually addressed: Narant's huge-count test invokes the new
  damageBeforeApply hook rather than the removed damaged listener, retaining its count/time assertions;
  Chen3's accumulator loop documents its fixed-dt/subtract-one bound. All 14 loop-cap cases pass.

A final API review also catches the refactor's own zero-delta healing notification inconsistency. hpChanged
now only reports an actual HP change; full-HP heal/regen/restore cases verify this without suppressing ordinary
modifier or eligible overheal behavior. API/incantation/differential checks pass all 43 cases. This is a new
API contract correction, not a fabricated original-game defect.

## Evidence receipts

Artifacts remain under /private/tmp; these are audit receipts, not required runtime files:

| Artifact | SHA-256 |
|---|---|
| attack-final-ci-ready.log | fbd797ec1c4ea19bf5de11610d2063931012186e4220c6dbb3f133bfbc7d41ce |
| attack-s95-final-golden.log | 2372d0339f4b8eaf20ec290fe036e56740f4d9e982b26cda041d37dd46f4b13b |

`attack-final-audit.mjs` independently checks the terminal CI summary, full golden output, all scenario
ids/uncapped paths/error fields, branch ancestry and conflict status; its output is attack-final-audit.json.
`attack-final-oracle-verification.json` records the independently parsed legacy AST comparison. Earlier
source/native/control hashes remain in the chronological behavior ledger.

The isolated Python asset is from [python-build-standalone release 20261013](https://github.com/astral-sh/python-build-standalone/releases/tag/20261013),
CPython 3.12.15 aarch64-apple-darwin install-only stripped, SHA-256
9866e11cf2ae9caa1e671383786f248859a52dd8bfb702fb4c0dc2c65f1d36de, verified against release metadata before extraction.
It is only used through this command's PATH; no shell profile or system Python is modified.

Documentation consistency/path checks after final reporting: **32 pass / 0 fail**
(`node --test test/docs-consistency.test.js test/docs-paths.test.js`).
No executable behavior is changed after the final CI/golden runs. Three changed stress-test lines are indented
with tabs afterward; acorn confirms their executable AST is identical, and scoped lint passes. Verification
records are finalized and documentation checks pass. All delivery is local;
no push, force push or PR publication is performed.
