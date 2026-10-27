# Adding an AI strategy

The strategy interface selects trusted server-side AI code per match. It keeps the original
[`bot.js`](../server/match/bot.js) as the default, named `legacy`; registering another strategy does not change
legacy's weights, RNG consumption, economy, placement or rehearsal. The framework is PR #673 by
@HankDUMPLINGZhong. The optional `external` adapter is documented in [External AI API](EXTERNAL_AI.md)
and the [Chinese server-owner guide](EXTERNAL_AI_ZH.md). Until LLM-played seats clear 终极, that adapter is
development-only and is not in a release package (maintainer 2026-10-23, §35.66). A packaged server keeps
`legacy` and ignores `SP_BOT_STRATEGY=external`.
The opt-in `ioleta`, `adaptive` and `ioleta-adaptive` strategies (PR #742) are described below.

The contract lives in [`botStrategyContract.js`](../server/match/botStrategyContract.js); the built-in registry is
[`botStrategies.js`](../server/match/botStrategies.js). Implementations import the contract, not the registry, to
avoid a cycle when the registry imports them. This is not a plugin/DSL API or a client-supplied JavaScript loader.

## Define and register a strategy

Create a module, for example `server/match/botStrategies/first-card.js`:

```js
import { defineBotStrategy } from '../botStrategyContract.js';

export const firstCard = defineBotStrategy({
  id: 'first-card',
  pickCard(match, player, cards, available) {
    return available[0];
  },
});
```

This deliberately simple example changes only the card picker. Unspecified hooks retain the original function
objects; no copy of the original bot or its shopping/layout engine is necessary. For an existing custom base,
pass `base: otherStrategy`. Use an ID starting with a lowercase letter, followed by lowercase letters, digits or hyphens.

Import the module into `server/match/botStrategies.js` and add it to the registry:

```js
import { firstCard } from './botStrategies/first-card.js';
export const BOT_STRATEGIES = createBotRegistry([firstCard]);
```

The registry includes `legacy` automatically and rejects duplicate IDs, including replacing `legacy`. Definitions
reject unknown fields, non-function hooks and invalid bases at construction. Both definitions and registries are
frozen; `createBotRegistry` is pure, so tests can build a local registry without changing other matches.

## Hooks and lifecycle

| Hook | Arguments | Result |
|---|---|---|
| `pickBand` | `(match, player)` | An available opening band ID; ordinary uniqueness checks still apply |
| `pickCard` | `(match, player, cards, available)` | An index from `available`; used for common drafts and private Pointing Stick choices |
| `prepBegin` | `(match, player, { delegate })` | A synchronous iterator, returning a rehearsal job or `null` when done |
| `prepEnd` | `(match, player, job)` | A synchronous iterator applying the finished layout and completing cleanup/Ready |
| `bountyKillChance` | `(match, player, card)` | The strategy's kill estimate, or `null` if unavailable, for benchmark calibration |
| `decide` (optional) | `(match, player, decision)` | Return `true` when an asynchronous adapter owns this decision, else use the existing hooks |

Draft pickers run synchronously. The optional `decide` hook is a synchronous handoff before a band/card turn,
prep or offer: its descriptor has `kind`, `valid()`, `complete()`, `fallback()` and optional window `key` / `deadline`.
An adapter owns bounded asynchronous IO, stale-input rejection and invoking fallback; it must not return a Promise
from a picker/generator or delay a phase timer. The built-in external runtime is match-owned and disposed at match end.
Prep hooks are generators: yield between complete, valid actions so the scheduler
can enforce its existing time slices. They are not async hooks. Return a rehearsal job from `prepBegin` only when
it follows the existing job protocol; use the legacy implementation when retaining its layout rehearsal.

```js
import { defineBotStrategy, LEGACY_BOT } from '../botStrategyContract.js';

export const myBot = defineBotStrategy({
  id: 'my-bot',
  *prepBegin(match, player, options) {
    // Optional non-procurement setup; the following call runs the full legacy prep.
    return yield* LEGACY_BOT.prepBegin(match, player, options);
  },
});
```

The legacy call above includes buying and layout. A replacement procurement policy must compose the shared
prep actions once, as `createIoletaPrepSteps` does; calling a complete legacy prep after custom buying repeats
the economy flow. Procurement and adaptive candidate generation are internal implementations, not extra hooks.

Forward `options` when delegating: the `delegate` flag controls the existing host-browser rehearsal. Match still
owns time slicing, pending delegated jobs, takeover, cancellation and the prep deadline. Do not simulate a pending
host job a second time. `prepEnd` can receive `null` when no job is needed or prep fails. A throwing prep hook is
reported through the match's error path; the engine still attempts cleanup and Ready.

Keep mutable per-match/per-player state on that match/player, using a strategy-specific namespace, rather than on
the shared frozen definition or in module globals. Use the seeded match RNG and validated PlayerState intents;
do not grant resources, inspect future rolls or change data tables to implement an AI preference. A sub-route or
formation recipe can be an implementation detail of a strategy; this interface does not prescribe its policy.

## Select, test and compare

For programmatic use, pass a registered ID or an imported definition:

```js
new Match({ ...matchOptions, botStrategy: myBot });
```

With `SP_BOT_STRATEGY` unset or empty, the server uses the original bot (`legacy`); no configuration is needed.
For programmatic matches, `opts.botStrategy` takes precedence over `SP_BOT_STRATEGY`; absent both, selection is `legacy`.
The environment accepts registered IDs only. `startServer()` validates it before loading data or listening for
connections. An unknown ID prevents startup with an error naming `SP_BOT_STRATEGY`, the rejected value and available
IDs, plus a reminder to unset the variable to use the original bot. Match construction also validates its selection.
One match's selection does not change another match. The same strategy also handles humans under AI takeover.
Strategy selection does not grant an AI seat priority in the band draft: the existing seat order and the room's
existing AI-last option still apply. `legacy` is always registered. On a development checkout, operator-enabled
`external` is registered too; it inherits all legacy hooks for fallback and requires transport configuration before
startup. A release package does not register it (§35.66).
The three opt-in local strategies are also registered. External fallback remains legacy; advisor plans apply only to seats that external plays.

### Per-seat selection

`SP_BOT_STRATEGY_SEATS` overrides the strategy of individual seats (#816 P1); `SP_BOT_STRATEGY` stays the
match-wide default and accepts a single ID. The value is a comma-separated list of `seat:id` entries: room seats
0–3, the numbering of `SP_EXTERNAL_AI_SEATS`, and registered IDs, e.g. `SP_BOT_STRATEGY_SEATS=1:ioleta,3:adaptive`.
Spaces around entries are ignored. A seat that is not listed plays `SP_BOT_STRATEGY` (or `legacy`); unset or
empty means no overrides. A seat outside 0–3, a seat listed twice, an entry without `:` or without an ID, more than
four entries and an unknown ID all prevent startup: `startServer()` validates the variable next to
`SP_BOT_STRATEGY`, and the error names `SP_BOT_STRATEGY_SEATS`, the rejected entry and the available IDs.
Programmatic matches pass `opts.botStrategySeats` (`{ [seat]: id | definition }` or the same text), which takes
precedence over the environment like `opts.botStrategy`.

An override belongs to the seat number, not to who sits there: an AI teammate and a human under AI takeover on that
seat both play it, as both play `SP_BOT_STRATEGY` on a seat without one. Every hook of a seat (band and card
picks, private bounty choices, both prep stages, plugin offers and the bounty estimate shown to an advisor) comes
from the same strategy. Without overrides, every seat uses the one match strategy object, as before.

When the default or any seat selects `external`, the match creates one external host with the one `SP_EXTERNAL_AI_*`
configuration, shared by every external seat. Only seats whose strategy is `external` ask it, and
`SP_EXTERNAL_AI_SEATS`, when set, still narrows them: an external seat outside that list plays the legacy hooks
`external` inherits. Startup validates the external configuration when any seat selects it. A release package maps
`external` back to `legacy` for each seat and logs the one ignore line (§35.66).

Test input journals record the resolved strategy ID as `init.options.botStrategy`, rather than serializing hooks.
Replay uses that ID, or `legacy` for older journals without it, regardless of the replay host's environment.
A match with seat overrides also records `init.options.botStrategySeats` (`{ "1": "ioleta" }`, resolved IDs); a
journal without the field, including every older one, replays without overrides.
An unavailable recorded ID fails explicitly. A custom definition must be registered under the same ID and run
with the same code to be replayed. Prep generators and rehearsal jobs retain the journal's slice step counts.
External journals additionally record replies / failure outcomes and non-secret adapter limits; replay disables
transport IO and feeds the recorded intents through the same validation path.

```powershell
$env:SP_BOT_STRATEGY = 'my-bot'
$env:SP_BOT_STRATEGY_SEATS = '1:ioleta'   # optional: seat 1 plays ioleta, the other seats my-bot
npm start
node tools/matchrun.mjs --bot my-bot --mode coop --players 4 --seed 7 --check
node tools/botbench.mjs --bot legacy --configs solo:HARD --seed 7 --seeds 10 --json .cache/legacy.json
node tools/botbench.mjs --bot my-bot --configs solo:HARD --seed 7 --seeds 10 --json .cache/my-bot.json
node tools/botbench.mjs --compare .cache/legacy.json .cache/my-bot.json
```

Create `.cache/` first. The tools explicitly default to `legacy`; their `--bot` option chooses a registered ID.
They read neither `SP_BOT_STRATEGY` nor `SP_BOT_STRATEGY_SEATS` and have no per-seat option.
Botbench records the implementation ID and uses its bounty estimator. Its solo `--band ID` option overrides only
the opening `pickBand` hook; it leaves `gd.bandIds()` and `gd.bandBondIds()` unchanged, including the bands available
to later game effects. Previously, `--band` replaced `gd.bandIds()` with `[ID]` and `gd.bandBondIds()` with `[]`,
restricting the entire match's band catalogue and bypassing the picker's inactive-bond filtering. These are different
experiments: old and new `--band` results are not directly comparable, even with the same seed (the forced hook also
skips the original picker's RNG draw). Regenerate both comparison runs with this version.
Keep seeds, difficulty and rehearsal counts
identical in comparisons; use `--jobs 1` for timing, since parallel load inflates the timings.

终极 (ABYSS) is the hard target for both kinds of seat (history §35.62): compare with
`node tools/botbench.mjs --configs solo:ABYSS,coop4:ABYSS --seeds 20 --seed 1 --json …`, and keep FUNNY / NORMAL /
HARD from getting worse (`--configs solo:FUNNY,solo:NORMAL,solo:HARD,coop4:FUNNY,coop4:NORMAL,coop4:HARD --seeds 10`).
A win is clearing the round-14 Final Assault (`victory`); round 15 is the optional Hidden Core. An `external` seat in
plan mode runs the legacy executor with the plan's weights, so a legacy change moves plan seats too: since §35.62 the
plan's primary core bond is legacy's focus, and legacy lineups can field a 6-member core bond.
Since §35.63 legacy also levels to L5 at R9 and L6 at R11, trades 获得时 layer units (`tradeOnce`), commits to a
6-member core (`coreGap`), values a healer from R5 and spends expiring funds on refreshes (`spendDown`). Since §35.64
a boss round rehearses the same layout variants against the already-planned wave, on `deriveSeed(0xA11CE, fa:round:seat)`,
for the visible countdown (`faRehearsalTicks`); counted leaks still rank first. 终极 needs 100
seeds per mode to separate such rules from noise (seeds 1–40 to develop, the rest to check), and a per-match "share of
the leader pool" (0 before the Final Assault, 1 for a win) moves long before the win count does.

The match harness accepts `botStrategy` objects, so an implementation can be tested before registration. See
[`bot-strategies.test.js`](../test/match/bot-strategies.test.js) for real draft, sliced prep, personal-choice and
failure-cleanup tests; the existing delegated-rehearsal tests exercise the unchanged default path. Test legal actions
and actual effects as well as scores. Follow [CONTRIBUTING](../CONTRIBUTING.md): run related tests, full CI and Golden
before a PR; a framework-only change must leave all legacy Golden scenarios unchanged.

## Opt-in Russell procurement

`ioleta` prefers available `band_ioleta` at the opening; its other-band prep is legacy. It adds no exclusions for
Goliath or Dobermann. Procurement uses the shared prep executor once, with an explicit policy passed through
economic contexts. Placement scoring and the rehearsal budget retain their existing defaults.

[ASSUMED] The policy targets staged core merges, substitutes available Arcane/Swift bonds when core bonds are
disabled, and stops pursuing completed elites. L1 relaxes at R6 and exits at R7; L2 exits at R9 and L3 at R11.
Every upgrade still requires the actual price. Affordable core merges and their rewards precede upgrades.
Equipment yields to search only with room, a remaining refresh and enough money for refresh plus a target.
Shown cards retain the engine's overdraw semantics; future searches read public stock. Real PlayerState return
values govern success, and equipment uses the room's morph-slot rules.

The committed plan is JSON-safe `player.botStrategyState.ioleta.plan`, recomputed at prep entry using that seat's
previous plan. A fresh match/player has fresh state. Offline journal replay records the registered strategy ID
and regenerates the state from inputs; pre-framework journals select legacy explicitly. A journal recorded with a
`botStrategy` object replays through the strategy registered under its ID, so it replays only when that ID is
registered with the same code (see above). Snapshot consumers must copy the namespace
alongside player state when restoring mid-match.

For independent local placement comparisons, compose the explicit actions:

```js
import { arrangeSteps, contactCandidatePlansSteps } from '../server/match/bot.js';
import { createIoletaPrepSteps } from '../server/match/botIoleta.js';
import { getBotStrategy } from '../server/match/botStrategies.js';

const combined = {
  id: 'ioleta-contact', base: getBotStrategy('ioleta'),
  ...createIoletaPrepSteps({
    arrangeSteps: (m, ps, options = {}) => arrangeSteps(m, ps,
      { ...options, candidatePlans: contactCandidatePlansSteps }),
  }),
};
// new Match({ ...matchOptions, botStrategy: combined });
```

The registered `ioleta` strategy selects procurement alone; measurements are in the
[strategy summary](research/bot-strategies-summary.md).

## #673 compatibility audit (2026-10-18)

The registered Russell definition passes through createBotRegistry → defineBotStrategy. The resulting frozen
object has exactly the five hooks above; pickCard and bountyKillChance inherit the legacy function references.
Match resolves one strategy object for all AI and autoplay seats. Russell procurement branches on each player's
bandId inside the prep hooks; mutable plans live on that player. Per-seat strategy selection is a proposal.

The current contact implementation enters arrangeSteps → createRehearsalSteps and uses the existing job and
scheduler lifecycle. The optional adaptive strategy retains synchronous iterators, delegate forwarding,
job.run(budget, control), pending/done handling, takeover, cancellation and prepEnd cleanup. Apply identical
deterministic stopping rules in server and browser rehearsal. The current protocol accepts candidate indices
0–7. Any expansion must respect that limit or explicitly update and test the protocol.

Audit coverage includes registered hook inheritance, a single Match containing AI and human takeover seats,
one pair of purchasing passes per prep, non-Russell fallback, replay, contact delegation and real Worker
completion/timeout/cancellation.

Audit validation: targeted integration and documentation tests 67/67; real Chrome rehearsal Worker tests 3/3
with zero skipped; changed tests pass lint. Runtime code is unchanged by this audit.

## Optional adaptive strategies (P4)

Two registered strategies share one map-independent placement search (`botAdaptive.js`):

| ID | Opening band | Procurement | Placement |
|---|---|---|---|
| `adaptive` | legacy picker | legacy | adaptive search |
| `ioleta-adaptive` | prefers Russell (as `ioleta`) | Russell procurement for Russell seats, legacy otherwise | adaptive search |

Select `SP_BOT_STRATEGY=adaptive` (or `ioleta-adaptive`) or `opts.botStrategy`. `adaptive` is placement-only: its
base is legacy, so it inherits the legacy band picker, pickCard and bountyKillChance and builds its prep from legacy
procurement with the adaptive `arrangeSteps`. `ioleta-adaptive` takes ioleta as base and composes Russell procurement
once with the same placement. A Match still shares one frozen strategy across AI and autoplay seats; the shared
executor runs one procurement sequence (the usual two purchasing passes), then rehearses and finishes.

[ASSUMED] Candidate order: the fixed-three contact list as a prefix, remaining legacy geometry variants, then contact
repairs of the remaining variants, deduplicated by unit/tile/direction and capped at eight. Every candidate uses
current routes, legal tiles and attack ranges. No taught map profile participates. Rehearsal disabled/one candidate
keeps the configured off/single behavior. Boss and hidden geometry retain their existing fallback.

[ASSUMED] Search always considers the initial three distinct candidates when available. It expands while none of
the completed, error-free, non-synthetic `cleared` results has zero counted personal leaks. Natural timeout,
forced/capped, failed, missing and synthetic results cannot certify zero. A total of six per-candidate tick caps is
a strict bound, checked on every tick; a partially evaluated candidate cannot displace a completed candidate.
The usual beaten-candidate pruning and score/tie ordering remain. The old taught implementation used twelve caps
of total tick allowance, checked between candidates; twelve was not its candidate count. This version deliberately
registers six strict caps and at most eight candidates, within the existing choice 0–7 protocol.

Optional `limits: { stage, tickBudget }` travels with b.rehearsal to the production Worker. Both paths construct
RehearsalRun with the same limits. A takeover starts the same deterministic run from the same specs. Job state,
synchronous generators, delegate forwarding, run(budget, control), per-call replay counts (`spent`), pending/done,
cancellation and prepEnd remain on the existing lifecycle. Total ticks use a separate `totalTicks` counter.
Worker diagnostic stats stay inside the page; the C2S response remains taskId plus choice/error.

`test/match/ioleta-adaptive-ws-delegation.browser.test.js` (`SIM_E2E=1`, `CHROME_PATH`) runs this path over a real
websocket: startServer configured only by `SP_BOT_STRATEGY=ioleta-adaptive` and `SP_BOT_REHEARSAL=host`, a co-op
room with three AI seats, and the production Worker in headless Chrome answering, staying silent (timeout takeover) or
holding its result back (cancellation of a running task). The host's socket is a Node ws client bridged to the page;
the game UI is not part of it.

`test/match/bot-strategies-scenarios.test.js` runs every registered strategy through a four-seat co-op match to its
end under the engine audit (联防 helpers, shared pool and equipment stock, AI 托管, boss round, Final Assault) and
through a gameplay-plugin room, whose rehearsal stays on the server. Measured strength and compute cost, with the
configuration, seeds, version and commands to reproduce them, are in the
[strategy summary](research/bot-strategies-summary.md).

Legacy and adaptive prep retain §35.63 `spendDown` between advisor spending and freezing, without another yield.
[ASSUMED] Ioleta procurement owns its refresh budget and omits that legacy sweep. Framework by @HankDUMPLINGZhong; strategies by @Lidong1793.
