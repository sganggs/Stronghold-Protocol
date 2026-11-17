# Bot strategy summary (2026-10-22)

Measurements behind the optional strategies of [BOT_STRATEGIES](../BOT_STRATEGIES.md). Every number below comes from
the repository's own `tools/botbench.mjs` and `tools/matchrun.mjs`; raw outputs are not committed (rerun the
commands to regenerate them under `.cache/`).

| | |
|---|---|
| Base | 0.3.2 dev (`218647c6`, after the Wild Mane push §35.10 and the advisor execution changes §35.13–35.15) + this PR's strategies |
| Measured on | the same base and head |
| Strategies | `legacy` (default), `ioleta`, `adaptive` (placement only), `ioleta-adaptive` (Russell procurement + adaptive placement) |
| Rehearsal | Match default (3 candidates; adaptive extends to at most 8) |
| Host | Windows 11, Node 24.15.0 |

## Default behavior is unchanged

- Base change: the 2026-10-18 figures were measured on v0.3.1 + #673. All tables below were rerun on dev
  `218647c6`. Only two cells moved, both through dev itself (the `legacy` side moves with them): Touch ABYSS
  `legacy` 139 → 140 leaks (`adaptive` better on 7 seeds instead of 6), and `ioleta`'s co-op run 4327 → 4326 rule
  checks / 204 → 203 invariant passes. Every other outcome, including the regression list, is unchanged.
- Selecting `legacy`, `ioleta`, `adaptive` or `ioleta-adaptive` never starts the external AI adapter: no network or
  process IO.
- `npm run golden`: roster 49 / bonds 46 / fields 22 / matches 21 / standins 10 / diy 140 — all 288 scenarios match.
- `legacy` botbench at dev `218647c6` and at this head, `solo:HARD,solo:ABYSS,coop4:HARD`, seeds 1001–1005: all 15
  matches identical in every recorded field except wall-clock and CPU timings.

## Strength (single seat, paired seeds)

Solo, band forced with `--band`, seeds 1001–1010 per cell. Leaks are counted leaks plus bounty leaks, summed over the
rounds that both matches of a seed pair reached, up to R11. "better / worse" counts seeds against `legacy`.

| Difficulty | Band | legacy | ioleta | adaptive | ioleta-adaptive |
|---|---|---:|---:|---:|---:|
| HARD | Russell (伊奥莱塔·罗素) | 23 | 19 (3 / 2) | 12 (4 / 0) | 7 (4 / 1) |
| HARD | Amiya (阿米娅) | 7 | 7 (0 / 0) | 0 (2 / 0) | 0 (2 / 0) |
| HARD | Cannot (坎诺特) | 23 | 23 (0 / 0) | 14 (3 / 0) | 14 (3 / 0) |
| HARD | Touch (`band_amedic`) | 2 | 2 (0 / 0) | 1 (1 / 0) | 1 (1 / 0) |
| ABYSS | Russell (伊奥莱塔·罗素) | 177 | 150 (6 / 3) | 128 (9 / 0) | 118 (8 / 2) |
| ABYSS | Amiya (阿米娅) | 96 | 96 (0 / 0) | 52 (7 / 0) | 52 (7 / 0) |
| ABYSS | Cannot (坎诺特) | 223 | 223 (0 / 0) | 164 (10 / 0) | 164 (10 / 0) |
| ABYSS | Touch (`band_amedic`) | 140 | 140 (0 / 0) | 111 (7 / 3) | 111 (7 / 3) |

`ioleta` only changes Russell seats, so other bands equal `legacy`; `ioleta-adaptive` equals `adaptive` outside
Russell. All 320 matches finished without engine, meta or sim errors.

### Regressions (seed pairs where a strategy leaked more than `legacy`)

| Strategy | Band | Difficulty | Seed | Leaks legacy → strategy | Rounds passed |
|---|---|---|---:|---|---|
| ioleta | Russell | HARD | 1001 | 4 → 11 | 13 → 13 |
| ioleta | Russell | HARD | 1006 | 4 → 8 | 13 → 13 |
| ioleta | Russell | ABYSS | 1001 | 16 → 19 | 13 → 13 |
| ioleta | Russell | ABYSS | 1004 | 5 → 10 | 13 → 12 |
| ioleta | Russell | ABYSS | 1006 | 31 → 40 | 11 → 11 |
| adaptive, ioleta-adaptive | Touch (`band_amedic`) | ABYSS | 1003 | 6 → 8 | 13 → 13 |
| adaptive, ioleta-adaptive | Touch (`band_amedic`) | ABYSS | 1006 | 14 → 15 | 12 → 12 |
| adaptive, ioleta-adaptive | Touch (`band_amedic`) | ABYSS | 1010 | 10 → 11 | 13 → 13 |
| ioleta-adaptive | Russell | HARD | 1006 | 4 → 7 | 13 → 13 |
| ioleta-adaptive | Russell | ABYSS | 1004 | 5 → 10 | 13 → 12 |
| ioleta-adaptive | Russell | ABYSS | 1010 | 20 → 21 | 12 → 13 |

## Rules and scenarios

`matchrun --mode coop --players 4 --humans 2 --difficulty HARD --seeds 3 --seed 2001 --layers 60 --check --errors`
per strategy: co-op with two human seats on AI 托管, 联防 helpers, the shared pool, the boss round, Final Assault and
the Hidden Core (`--layers`). Every run: 0 engine / meta / sim errors and no audit violations.

| Strategy | Rule checks | Invariant passes | Wins | Hidden Core reached |
|---|---:|---:|---:|---:|
| legacy | 3743 | 198 | 1 / 3 | 1 |
| ioleta | 4326 | 203 | 3 / 3 | 3 |
| adaptive | 4058 | 200 | 2 / 3 | 2 |
| ioleta-adaptive | 4289 | 203 | 3 / 3 | 3 |

`test/match/bot-strategies-scenarios.test.js` repeats this for every strategy in CI (fake battles, engine audit) and
checks that a gameplay-plugin room (`requireCs`) never delegates rehearsal to the host browser.

## Compute cost (four AI seats)

`coop4:HARD,coop4:ABYSS`, seeds 3001–3005, `--jobs 1` on an otherwise idle host. Prep time is one seat's prep
(procurement, candidate construction and rehearsal), all measured on the server (host-browser delegation is off by
default). "Round" sums the four seats' preps of one round: the extra server work grows with the number of AI seats.

| Difficulty | Strategy | Preps | Prep mean / p95 / max (ms) | Round total mean / p95 (ms) | Match wall (s) |
|---|---|---:|---|---|---:|
| HARD | legacy | 278 | 170 / 402 / 647 | 675 / 1559 | 13.5 |
| HARD | ioleta | 281 | 160 / 363 / 773 | 632 / 1253 | 13.0 |
| HARD | adaptive | 279 | 276 / 828 / 1182 | 1101 / 2991 | 19.1 |
| HARD | ioleta-adaptive | 284 | 240 / 664 / 1200 | 959 / 2578 | 17.4 |
| ABYSS | legacy | 226 | 166 / 344 / 538 | 605 / 1158 | 10.0 |
| ABYSS | ioleta | 249 | 179 / 374 / 615 | 665 / 1298 | 11.9 |
| ABYSS | adaptive | 239 | 302 / 789 / 1169 | 1093 / 2410 | 17.1 |
| ABYSS | ioleta-adaptive | 250 | 298 / 789 / 1101 | 1130 / 2952 | 17.8 |

Adaptive placement raises mean prep time by about 60–80 % and the per-seat p95 to about 0.8 s (max about 1.2 s);
`ioleta` alone costs about the same as `legacy`. Sample sizes differ because matches survive for different
numbers of rounds. All 40 matches finished without errors.

## Reproduce

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
npm run golden
# strength: repeat for each --bot (legacy ioleta adaptive ioleta-adaptive) and --band
#           (band_ioleta band_amiya band_cannot band_amedic)
node tools/botbench.mjs --bot adaptive --band band_ioleta --configs solo:HARD,solo:ABYSS --seeds 10 --seed 1001 --jobs 6 --json .cache/str-adaptive-band_ioleta.json
node tools/botbench.mjs --compare .cache/str-legacy-band_ioleta.json .cache/str-adaptive-band_ioleta.json
# rules and scenarios
node tools/matchrun.mjs --bot adaptive --mode coop --players 4 --humans 2 --difficulty HARD --seeds 3 --seed 2001 --layers 60 --check --errors
# compute cost: one job, nothing else running
node tools/botbench.mjs --bot adaptive --configs coop4:HARD,coop4:ABYSS --seeds 5 --seed 3001 --jobs 1 --json .cache/cost-adaptive.json
```

Outcomes are deterministic for a given seed and head; wall-clock timings depend on the host and its load.
