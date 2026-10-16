# Adding an AI strategy

The strategy interface selects trusted server-side AI code per match. It keeps the original
[`bot.js`](../server/match/bot.js) as the default, named `legacy`; registering another strategy does not change
legacy's weights, RNG consumption, economy, placement or rehearsal. No alternative gameplay policy ships with this interface.

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

Draft pickers run synchronously. Prep hooks are generators: yield between complete, valid actions so the scheduler
can enforce its existing time slices. They are not async hooks. Return a rehearsal job from `prepBegin` only when
it follows the existing job protocol; use the legacy implementation when retaining its layout rehearsal.

```js
import { defineBotStrategy, LEGACY_BOT } from '../botStrategyContract.js';

export const myBot = defineBotStrategy({
  id: 'my-bot',
  *prepBegin(match, player, options) {
    // Perform custom legal PlayerState actions here; yield between complete actions.
    return yield* LEGACY_BOT.prepBegin(match, player, options);
  },
});
```

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

`opts.botStrategy` takes precedence over `SP_BOT_STRATEGY`; absent both, selection is `legacy`. The environment
accepts registered IDs only. Unknown IDs fail before play rather than silently selecting a different policy.
One match's selection does not change another match. The same strategy also handles humans under AI takeover.

```powershell
$env:SP_BOT_STRATEGY = 'my-bot'
npm start
node tools/matchrun.mjs --bot my-bot --mode coop --players 4 --seed 7 --check
node tools/botbench.mjs --bot legacy --configs solo:HARD --seed 7 --seeds 10 --json .cache/legacy.json
node tools/botbench.mjs --bot my-bot --configs solo:HARD --seed 7 --seeds 10 --json .cache/my-bot.json
node tools/botbench.mjs --compare .cache/legacy.json .cache/my-bot.json
```

Create `.cache/` first. The tools explicitly default to `legacy`; their `--bot` option chooses a registered ID.
Botbench records the implementation ID and uses its bounty estimator. Its solo `--band` option overrides only the
picker, leaving the real band metadata available to the selected AI. Keep seeds, difficulty and rehearsal counts
identical in comparisons; use `--jobs 1` for timing, since parallel load inflates the timings.

The match harness accepts `botStrategy` objects, so an implementation can be tested before registration. See
[`bot-strategies.test.js`](../test/match/bot-strategies.test.js) for real draft, sliced prep, personal-choice and
failure-cleanup tests; the existing delegated-rehearsal tests exercise the unchanged default path. Test legal actions
and actual effects as well as scores. Follow [CONTRIBUTING](../CONTRIBUTING.md): run related tests, full CI and Golden
before a PR; a framework-only change must leave all legacy Golden scenarios unchanged.
