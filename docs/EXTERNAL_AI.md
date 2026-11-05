# External AI API (`sp-ai/1`)

**Development only for now (maintainer 2026-10-23, §35.66).** This API is not in a release package, an update
package or the Docker image. A packaged server ignores `SP_BOT_STRATEGY=external` and the `SP_EXTERNAL_AI_*` /
`SP_LLM_*` settings, logs one line, and uses the built-in bot. The pages below describe a development checkout.

**Shelved since 2026-11-05 (maintainer, §37.85).** In paired 终极 co-op runs no kind of model decision beat the
same-code bot. The code stays on the development branch with no further tuning and no paid runs; only the maintainer
reopens it.

This implements the maintainer's **2026-10-17 decision**, requested on 2026-10-19: “observation → intents,
validated like a human, timeout → built-in bot, runs on the host or a third-party service”, as a strategy of
PR #673 by **@HankDUMPLINGZhong**. `legacy` remains the default. Nothing connects or spawns unless the server
operator selects `external` and supplies its configuration. Room clients cannot select a URL, command or token.

This is an extension of the remake, not an official AI protocol. Existing game rules and their sources remain
in [DESIGN §6](design/match.md), [META](META.md) and [PRTS help](https://prts.wiki/w/卫戍协议/帮助).
No economy, pool, placement, timer, draft-order or battle rule changes. All wire format, limits, action scope,
transport lifecycle and example-policy choices below are **[ASSUMED] engineering policy**. The observation /
human-validation / fallback requirements themselves are the maintainer's decision.

## Enable it

Environment configuration follows [the bot strategy selector](BOT_STRATEGIES.md). An explicit
`new Match({ botStrategy: 'external', externalAI: { transport, url, command, seats, timeoutMs, maxIntents,
maxBytes, failureLimit, backoffMs, reserveMs, reserveScale }, ... })` overrides the environment configuration as a whole. Omitted
numeric fields use the defaults below. The bearer token is read only from `SP_EXTERNAL_AI_TOKEN`.
Configuration is validated before server startup; an invalid configuration fails without printing credentials.

| Variable | Meaning / default / bounds |
|---|---|
| `SP_BOT_STRATEGY` | `external` to enable; unset / empty selects `legacy` |
| `SP_BOT_STRATEGY_SEATS` | Optional per-seat strategies, `seat:id,…` (e.g. `1:external`); enables external for the listed seats only ([strategy guide](BOT_STRATEGIES.md#per-seat-selection)) |
| `SP_EXTERNAL_AI_TRANSPORT` | Required: `http` or `stdio` |
| `SP_EXTERNAL_AI_URL` | HTTP(S) endpoint; no URL credentials or fragment |
| `SP_EXTERNAL_AI_TOKEN` | Optional HTTP bearer token; environment only |
| `SP_EXTERNAL_AI_COMMAND` | Required for stdio: JSON argv array, no shell; 1–64 nonempty strings, each ≤4096 characters |
| `SP_EXTERNAL_AI_SEATS` | Optional comma-separated seat indices, 0–3; omitted means all bot-controlled seats |
| `SP_EXTERNAL_AI_TIMEOUT_MS` | 1000; integer 1–300000, both request timeout and total decision budget |
| `SP_EXTERNAL_AI_MANUAL_WAIT` | `1` (dev manual seats, direct mode): unlimited waits in untimed solo windows; timed windows (co-op, timed solo versions) get the whole remaining window and the built-in bot never plays the seat (§37.30); default off |
| `SP_EXTERNAL_AI_MAX_INTENTS` | 64; integer 1–256, cumulative across replies in one decision |
| `SP_EXTERNAL_AI_MAX_BYTES` | 65536; integer 1–1048576, raw response bytes / stdio line, excluding newline |
| `SP_EXTERNAL_AI_FAILURES` | 3; integer 1–20 consecutive failed decisions before match-long fallback (plan mode: protocol/transport errors only) |
| `SP_EXTERNAL_AI_BACKOFF_MS` | 1000; integer 1–60000 before the next demand can restart a failed stdio child |
| `SP_EXTERNAL_AI_RESERVE_MS` | Plan mode, timed windows (§37.72): unset uses the per-round reserve described under budgets below; an integer 0–120000 replaces it with one value for every prep and turn. Never more than half of what is left |
| `SP_EXTERNAL_AI_RESERVE_SCALE` | Plan mode: 1; a number 0–10 that multiplies that reserve (a slower machine, or a bench whose timers are scaled) |
| `SP_EXTERNAL_AI_TEAM` | Plan mode, co-op (§37.84): on; `0` switches the shared plans off (`digest.team`), for a paired comparison |

Seat selection applies to AI teammates, opponent seats in modes that use them, and humans under AI takeover.
Unselected seats use `legacy`. With `SP_BOT_STRATEGY_SEATS=1:external` (default strategy left unset or local),
the match creates the same single external host and only seat 1 asks it; the other seats play their local
strategies. A seat must select `external` and, when `SP_EXTERNAL_AI_SEATS` is set, be listed there too. INFO_CHECK acknowledgement and combat simulation remain engine-owned; decision
points are band turns, common card turns, prep (including personal choices/rewards), and plugin offer windows.

Example HTTP service (two terminals, POSIX shell):

```sh
node tools/ai/http.mjs 8765
```

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=http \
SP_EXTERNAL_AI_URL=http://127.0.0.1:8765 SP_EXTERNAL_AI_SEATS=1 npm start
```

Example stdio (the game server starts and stops the child):

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=stdio \
SP_EXTERNAL_AI_COMMAND='["node","tools/ai/stdio.mjs"]' npm start
```

In PowerShell set each variable with `$env:NAME = 'value'`, then run `npm start`. For a service installation use
an absolute command / script path, since relative argv paths resolve against the server's working directory.
The examples choose an untaken universal band, the first unsold card / available offer, personal choice zero,
then Ready. They demonstrate the protocol, not strong play. The four example band IDs come from the public
static `data/bands.json` catalogue; static game catalogues can be installed alongside any AI, just as clients
load them. They are not hidden match state. The service binds only `127.0.0.1`; port `0` prints its assigned port.

## Manual seats (development only, §37.26)

The manual tools use the same direct-mode validator and `sp-ai/1` stdio transport, with no API or key.
Run from the repository root. Use a **new, empty directory** for each match:

```sh
node tools/ai/manual-match.mjs --dir /tmp/sp-manual-solo --mode solo --difficulty ABYSS --seed 7
```

In another terminal, inspect the current observation and answer one decision:

```sh
node tools/ai/manual-act.mjs /tmp/sp-manual-solo --status
node tools/ai/manual-act.mjs /tmp/sp-manual-solo '["a1"]'
```

`a1` means the action shown in that observation, not a stable action across requests. Read the printed
`obs-N.md` before answering. §37.32: add `--obs N` (the page you read) to bind the answer to it. If obs-N's window
ended and a newer page is live, the answer is refused instead of landing on that page, where the same IDs mean other
actions. The page also names the match's Final Assault leader under its header, tags merge rewards with class and
tier, says whose summon a token is (placeable while its owner is on the board; not counted in the deploy cap), says
when a full deploy cap needs a raw `g.move` swap, and lists eliminated teammates under "Teammates". A raw batch also works, e.g. `'[{"t":"g.buy","slot":0}]'`, or pass
`@/absolute/path/answer.json`. During prep, `'{"done":true}'` submits `g.ready` through the human validator;
a rejected Ready produces another observation. It never delegates an unfinished prep just because `done` was used.
Each batch gets the next `obs-N` / `act-N` pair, including several exchanges within one prep. The cumulative
limit is 256 intents per decision (remaining count is printed); reaching it without completion leaves the decision to
the phase timer, as for a human (§37.30).

Four simultaneous manual seats, each with its own directory:

```sh
node tools/ai/manual-match.mjs --dir /tmp/sp-manual-coop --mode coop --difficulty ABYSS --seed 7 --seats 0,1,2,3
node tools/ai/manual-act.mjs /tmp/sp-manual-coop/seat-0 --status
node tools/ai/manual-act.mjs /tmp/sp-manual-coop/seat-0 '["a1"]'
```

Assign `/tmp/sp-manual-coop/seat-0` through `seat-3` to separate players/agents. Co-op always has four seats;
`--seats 0,2` makes just those two manual and leaves the others on the built-in bot. Draft turns remain ordered;
prep requests can be concurrent. The launcher uses the **real wall clock in co-op** and the normal phase timers.
§37.30 [ASSUMED]: a manual seat is never played by the built-in bot. Each decision gets the whole remaining phase
or turn (capped at 300000 ms), not the share other external seats leave for legacy (half in direct mode, the §37.72
reserve in plan mode). When it runs out, the phase timer
decides exactly as for a human: prep readies with the current board (temp resolved, a pending personal card picked
at random), a band turn takes the highlighted strategy (`g.bandFocus`) or the default, a card turn a random card, an
offer its timeout pick. A late answer is ignored and the next observation shows `TIMEOUT` with `fallback: false`. An
invalid reply produces a fresh observation with `EXTERNAL_ERROR` while the window lasts (at most three in a row); the
seat is never switched to legacy. §37.31: an untimed window (untimed solo, a lone human's co-op) has no timer to hand
over to, so a used-up intent budget starts a fresh observation with a new budget, and only three broken replies in a
row let the built-in bot finish that one decision (`fallback: true` in the next observation; the seat stays manual).
A newer request cancels that seat's old file waiter; stale files and another seat's files never answer it.

Solo uses botbench's virtual scheduler and waits for file IO. It selects the existing `soloUnlimited` option
for historical versions too. `--version act1autochess --difficulty HARD` (or another supported version/difficulty pair) loads that version
before the match. Historical versions do not offer ABYSS; unsupported combinations fail before creating session files.
`SP_EXTERNAL_AI_MANUAL_WAIT=1` / explicit `externalAI.manualWait: true` is a dev-only, direct-mode switch
that removes the host and transport decision timeout **only in untimed windows** (untimed solo, a lone human's
co-op), represented by `context.deadline: 0`. Timed windows and all co-op matches keep their phase timers with the whole window and no bot
fallback (above). The launcher sets this option explicitly. The knowledge handshake remains bounded. Abort, phase validity and disposal still apply.
Release packages ignore this setting with the other `SP_EXTERNAL_AI_*` variables; the unchanged
`LLM_RELEASE_EXCLUDE` / `tools/package.mjs` gate excludes all of `tools/ai/`, including these tools.

Each seat gets compact `obs-N.md` (roughly a 3–4k-token target, capped at 9000 characters), the exact raw
`digest` in `obs-N.json`, the full wire observation in `obs-N.request.json`, and every shortcut with its
intent in `obs-N.actions.md`. Placements are one line per piece (`tile=aN`: aN faces RIGHT, aN+1 UP, aN+2 DOWN,
aN+3 LEFT; letters mark partial lists), so pages stay under the cap (§37.31); anything cut is explicitly marked. A
batch may end with `{"done":true}`, which becomes Ready.
`knowledge.json` holds the public catalogue and effects. The compact page includes economy, owned pieces and
equipment, bond counts/thresholds/layers and short effect excerpts, band progress exposed by the human view,
public enemy gates/fliers, choices, teammate public boards, and accepted/rejected intents. Gate names describe
the human preview, not a newly inferred route. No private teammate shop/hand, future rolls or stock is exposed.

The helper publishes a complete answer atomically and refuses overwriting an answered observation. A malformed
handwritten file is retained as `act-N.invalid-K.json`; `--status` reports the error so it can be corrected.
`result.md` is written by the launcher at match end (the host terminates its stdio child): win/loss, reached/passed
rounds, LP, Final Assault damage/pool, banked layers by round, spending by kind and fallback count. `result.json`
retains the settlement and layer/spending ledger for auditing; FA damage is captured before any Hidden Core.
Ctrl-C stops the match and marks the directories stopped; existing files remain, but this is not a resume format.
All file naming, compact limits, polling and launcher choices are **[ASSUMED] tooling policy**, requested by
the round54 manual-seat brief and the owner's co-op extension. Gameplay and built-in strategy are unchanged.

## Observation and response

Each request is a complete JSON observation:

```js
{
  v: 'sp-ai/1',
  id: 'ai-3',                         // opaque request ID, unique within this match
  public: { t: 'm.public', /* existing publicView() fields */ },
  private: { t: 'm.private', /* this seat's privateView() fields */ },
  digest: { /* readable state and short actions; see §35.9 below */ },
  // knowledgeVersion: '<sha256>' when knowledge is enabled,
  context: {
    kind: 'prep',                     // band | card | prep | offer
    mode: 'direct',                   // owner-selected direct | plan
    phase: 'PREP', round: 1,
    deadline: 1234567890000,          // absolute server clock ms: decision expires here
    remaining: 64,                    // remaining intent budget for this decision
    legalActions: ['g.buy', /* ... */ 'g.ready'],
    // gameVersion: 'act1autochess' — only in a room of another official version than 第二期下半 (act2autochess)
  },
  results: [
    { intent: { t: 'g.freeze' }, ok: true },
    { intent: { t: 'g.buy', slot: 15 }, error: 'BAD_TARGET' }
  ]
}
```

`public` and `private` are JSON copies of the existing human wire-view builders, including their exact keys;
see [META §5](META.md). No RNG/seed, match object, shared stock counts, future rolls, or another seat's private
view is added. Information already public, including public plugin offer cards, stays public. The normal
public view's `serverNow` gives the clock reference; its `deadline` remains the phase deadline (zero if untimed).
`context.deadline` is the adapter's earlier deadline. `results` carries accepted / rejected intents since the
last observation of this seat, including the preceding decision's last batch; retained results are bounded to
`maxIntents`. Validation returns the same `ok` / `error` / optional `detail` as human intents. The AI should
inspect results and the new views rather than assume a submitted action worked.

Respond with exactly these envelope fields:

```json
{"v":"sp-ai/1","id":"ai-3","intents":[{"t":"g.ready","ready":true}],"done":true}
```

`v` and `id` must match; `done` must be boolean; `intents` must be an array within the remaining budget.
Unknown envelope keys, non-JSON replies, empty `done:false` batches and oversized batches fail the decision
before applying any intent. `done:false` requests another observation after the batch. An accepted terminal
action ends the decision even if `done:false`; subsequent intents in that batch receive `WRONG_PHASE`.
Malformed individual intents are rejected with `BAD_MSG` and still count against the cap. Invalid legal-looking
actions return their actual human error (`NO_FUNDS`, `SOLD_OUT`, `BAD_TARGET`, `WRONG_PHASE`, etc.).

Intent objects use [shared/protocol.js](../shared/protocol.js), including optional `rid`. Each is checked with
`validateC2S`, then the same `_handleSeatIntent` / `_handle` path as `Match.handle`. Bot-seat authorization is
internal to the adapter: network clients still cannot call `handle` for a bot.

| Decision | Allowed action kinds | Completion |
|---|---|---|
| `band` | `g.band`, `g.bandSkip`, `g.bandFocus` | Accepted band or skip ending this turn |
| `card` | `g.choice` | Accepted common draft pick |
| `offer` | `g.offer`, `g.offerRefresh` | Accepted pick in this window |
| `prep` | `g.buy`, `g.sell`, `g.move`, `g.refresh`, `g.freeze`, `g.levelUp`, `g.equip`, `g.unequip`, `g.art`, `g.destroy`, `g.reward`, `g.choice`, `g.ready`, `g.offer`, `g.offerRefresh` | Accepted `g.ready { ready:true }` |

`g.move` covers placement and movement, with the human `uid`, `to` and optional `dir` fields. Personal choices
use `g.choice { idx, choiceId }`; offers require `offerId`, `pluginId`, `seq`, `idx` and optional `cardId`.
`legalActions` lists kinds admitted for the context, not a promise that any target is affordable or legal now.
Ownership, phase, funds, stock, board geometry, equipment, ready state, draft turn and offer freshness are all
checked by existing handlers. Admin/test actions, pause, autoplay changes, leaving and battle-result reports
are outside the API. No remote code is evaluated.

## Transports, timing and fallback

HTTP sends one `POST` per observation with `Content-Type: application/json` and optional
`Authorization: Bearer …`. Only status 200 succeeds. All redirects are rejected, even to the same host;
credentials are never forwarded. The raw response has the configured size cap and total request timeout
(including connection and trickled bodies); compressed responses are not decoded.

Stdio launches argv directly, without a shell, with one long-lived child per match. Each observation and reply
occupies one UTF-8 JSON line. Several seats/windows may be in flight; echo IDs to correlate replies. Stdout is
protocol-only. Stderr is discarded to avoid leaking secrets through server logs. A crash, bad/oversized line or a
reply ID that was never sent kills the child and fails outstanding requests. A cancellation (the host dropped that
decision) or a timeout ends only that request; its late reply is ignored by ID (history §35.62). The exception is a
plan-mode prep request whose budget its window cut short (§37.72): the host keeps it open and still reads its reply
until the seat's next prep supersedes it (a cancellation), the match ends, or the transport's own `timeoutMs` ends it.
A timeout kills the child only when the child wrote no line at all since that request was sent, so an LLM adapter
should keep its own provider limit below `timeoutMs` and always answer, with `{plan: null}` if need be (the measured
150000 / 170000 ms below do). A subsequent demand after a kill
restarts it only after `backoffMs`; requests during backoff fail immediately. Shutdown uses SIGKILL to bound
cleanup, including programs that ignore SIGTERM. The operator remains responsible for any grandchildren its
own program starts. Match end and disposal terminate the child and cancel pending HTTP requests.

A decision has one total budget across all batches: at most `timeoutMs`, further limited to the remaining
phase/turn/offer time minus what is kept for the built-in fallback. A direct-mode seat keeps half. §37.72 [ASSUMED]: a
plan-mode seat keeps only what the built-in bot needs to carry its plan out, never more than half of what is left:
5 s of an R1–R5 prep, 9 s in R6–R8, 12 s from R9, 36 s at the Final Assault prep and 24 s at the Hidden Core prep (plus
the host's answer window when bot rehearsals are delegated, `SP_BOT_REHEARSAL=host`), and 1 s of a band, 机变 or offer
turn. The table (`BOT_PREP_RESERVE_MS` in `server/match/match/prep.js`) is 1.5 × the p99 of four bot seats' summed prep
wall time in the round-62 co-op 终极 benchmark. It depends only on the round and the configuration
(`SP_EXTERNAL_AI_RESERVE_MS` / `SP_EXTERNAL_AI_RESERVE_SCALE`), never on a clock, so a journal replays the same
deadlines. Seat 0 of a co-op prep now gets 59.1 s in R1–R3 (half was 32.05 s), 89.1 s in R4–R5, 90.1 s in R6, 95.1 s in
R7–R8, 112.1 s in R9–R12, 137.1 s in R13 and 158.1 s at the Final Assault prep, each later seat 0.35 s less; a band
turn 49 s, a 机变 turn 28.1 / 14.1 s. Untimed phases still use the adapter budget, except for the opt-in solo manual wait above. Existing phase
timers stay armed. Requests are asynchronous; no scheduler callback waits on network or child IO. No AI request
can extend a phase. A reply after a phase/turn change, seat elimination or manual takeover cannot mutate state.

Timeout, transport/protocol failure, reaching the intent cap without completion, or `done:true` without the
required terminal action runs the unchanged legacy decision for that seat. Prep fallback retains sliced
shopping/placement, the existing rehearsal/delegation path, cleanup and Ready. Accepted actions before a failure
stay applied, so legacy continues from the current seat state. Offer fallback retains the existing window default.
Three consecutive failed decisions (configurable) disable external decisions for that seat for the rest of the
match and log the switch once; a completed decision resets the streak. Other seats keep their own counters.
In plan mode (§35.62) only protocol and transport errors count: a decision whose budget ran out, or a reply
`{plan: null}` from an agent that could not plan in time, falls back the same way without touching the streak.
A plan seat whose prep call fails or is still waiting keeps the last accepted plan's bonds, buy / keep / sell,
items and the funds direction of its economy (`saveForInterest`, `reserve`; since §35.63 not `level`, `maxRefreshes`,
`refreshAbove` or `freezeSearch`, and never `choice`, `placements` or a one-prep `holdLevel`).

§37.72 [ASSUMED]: a plan-mode prep request whose budget its window cut short (a budget below `timeoutMs`) is not
cancelled when the budget runs out. Its prep falls back as before; a reply that comes later is still validated. A valid
late plan becomes the seat's accepted direction (`feedback.acceptedPlan` with `late: true`): while that prep's fallback
is still running (the seat is not Ready yet) its remaining steps read it at once, otherwise the next prep carries it as
above. Its `choice` is never executed. A late `{plan: null}` or transport failure only closes it; a late protocol error
still counts toward the streak, and a valid late plan does not reset it. A request still open when the seat's next prep
asks is superseded (cancelled; its reply is ignored by ID); elimination, manual takeover, the legacy switch and the
match end close it as well. A reply that arrives at the deadline, before the deadline's timer ran, is such a late reply.
The metrics `late`, `lateSteered`, `lateCarried` and `superseded` count them, also per seat.

## Journals, security and tests

Test mode's [§34.8 journal](history/0.3.1.md) records external replies (including produced/rejected intents),
transport failure outcomes and ordinary scheduler execution/slice counts. Init records only non-secret policy
limits and seat indices, never URL, argv or token. Replay builds pending decisions but performs no IO: recorded
inputs drive the same validators and legacy fallback. It does not need the original program, credentials or
environment. Existing journal size limits still apply. Older journals select `legacy`; normal golden scenarios
remain unchanged. Virtual-time tools that advance without yielding for IO will naturally hit timeout/fallback;
use the running server to try an external service, or replay a captured test journal offline.

Only configure a service/program you intend to trust. Third parties receive the same public/own-private seat
view a human could see, including player names and private shop/hand. Prefer HTTPS off the host. Local programs
run with the server's OS permissions and inherited environment; this is not a script sandbox. Permission-limited
plugin match hosts can refuse process/network access, in which case the normal bounded fallback applies.
Tokens, transport errors, response bodies and commands are not written to normal server logs. Test journals
intentionally contain AI replies and gameplay inputs; treat them as private debugging records.

Tests: [external-ai.test.js](../test/match/external-ai.test.js),
[external-transports.test.js](../test/match/external-transports.test.js),
[bot-strategy-startup.test.js](../test/bot-strategy-startup.test.js). They cover the envelope and human validation,
view equality / isolation, both examples, bounds, timeouts, failure fallback, seat cutoff, cancellation, and full
real-simulation matches with one external seat plus a legacy peer, replayed offline with matching state and RNG.

## Advisor mode and readable observations (§35.9)

The maintainer approved this opt-in extension on **2026-10-19**. Set `SP_EXTERNAL_AI_MODE=plan`
(or `externalAI.mode: 'plan'`). The default external mode remains `direct`; the default strategy remains
`legacy`. `SP_EXTERNAL_AI_LANGUAGE` / `language` selects `zh-CN` (default), `en`, `ja`, `ko` or `zh-TW`.
`SP_EXTERNAL_AI_KNOWLEDGE=1` / `knowledge: true` enables the primer for direct agents too; it defaults on in
plan mode and off in direct mode so older services need not implement a hello exchange.

A plan agent receives one request per seat/prep round, plus each band turn, common-card turn and plugin offer
window. A rescheduled prep does not call again. Personal choices and merge rewards produced during procurement
are handled by legacy within that plan. A typical normal-length match needs roughly 15–20 decisions per seat;
extra plugin windows/skips add calls, elimination/short modes remove calls. This is not a fixed call allowance.

Answer with this envelope (no `intents` or `done`):

```json
{"v":"sp-ai/1","id":"ai-3","plan":{"bonds":[{"id":"siracusaShip","priority":4}],"buy":["chess_char_3_01_a"],"keep":[],"sell":[],"economy":{"saveForInterest":true,"level":3,"maxRefreshes":8,"refreshAbove":2,"freezeSearch":false},"items":{"buy":["chess_item_1_01_e_a"],"keep":[],"equip":[]},"placements":[]},"usage":{"inputTokens":1500,"outputTokens":100,"cachedTokens":1000}}
```

IDs in this example illustrate the schema, not a recommended build. Use the actual knowledge/digest IDs.
Every plan field is optional; `{}` executes unchanged legacy. The schema and scoring choices below are
**[ASSUMED] engineering policy**, not official strategy advice:

- `bonds`: at most 8 `{id, priority: 1..5}` entries; +6 points per priority to useful member purchase/lineup values.
  Normal copies of an owned elite receive no bond priority bonus; the elite retains its lineup bonus.
- `buy`, `keep`, `sell`: at most 32 operator IDs each. `keep` and `sell` match **exact IDs**: a normal `_a`
  means normal copies only, `_b` means the elite only. Keep +18 and sell −24 remain scoring preferences;
  `keep` protects owned pieces and does not itself request another copy. `buy` accepts either form, adding
  +24 only to normal copies that progress a merge toward an unowned elite (the first copy starts progress),
  or add a distinct plan-bond member. Neither explicit buys nor incidental prioritized bonds request copies
  of an already owned elite. Unknown/unavailable IDs have no effect.
- `economy`: `level` 0..6 is a minimum target for this prep, subject to funds; 0 adds no minimum. Affordable
  floor upgrades precede fill-only purchases, but completing a merge comes first. Once reached,
  the bot resumes its legacy upgrade curve. Only `holdLevel:true` plus `level` 1..6 and a nonblank `why`
  (at most 360 characters, inside `economy`) caps upgrades, including free upgrades. Example:
  `{"level":4,"holdLevel":true,"why":"Finish the 谢拉格 pair this prep; level next prep."}`. The protocol accepts
  `level` 0..6; the example adapter clamps it to 5, the bots' cap (§37.38: L6 measured solo −7.8, co-op −4.4 points).
  Plans last one prep: a hold is also valid for a one-round delay, and must be renewed to keep holding.
  `maxRefreshes` 0..16 and `refreshAbove` 0..100 are first-pass preferences. Expiring funds override them in
  the final spending pass. `reserve` 0..100 overrides discretionary
  savings **only for a carry-over band**. `saveForInterest:false` releases its normal interest reserve.
  Board filling/merges can spend the reserve. Carry bands keep their existing interest logic. Non-carry seats
  buy wanted/useful operators, freeze unaffordable explicit `buy` targets or merge completions, refresh while
  a stocked purchase can still be afforded, then buy cheap spare operators for later sale. Incidental bond
  members, `keep` entries and copies of owned elites never trigger freezing.
  `freezeSearch` is an optional boolean (default false): when an eligible explicit buy target is absent and
  unaffordable after a refresh, still search while funds cover the effective refresh cost, then freeze it if
  found unaffordable. This extra search respects `maxRefreshes` across the entire prep (default 16, including
  free refreshes and previous ordinary refreshes); it cannot exceed the cap through repeated spending passes.
  Ordinary affordable-purchase searches retain §35.13's expiring-funds override. A manual refresh would discard frozen
  offers, so those offers block further searching. Only these marked, still-disposable bench operators are
  sold to fund a wanted purchase; deployed/equipped/now-wanted operators and merge pairs are protected.
  Empty plans and seats without a plan retain the original legacy execution.

The §35.13 spending order is maintainer guidance (2026-10-19), not official strategy text. **[ASSUMED]**
implementation choices: existing lineup gain >2 defines usefulness; explicit buys or prioritized-bond
members define wanted operators under the copy rules above (except exact sell targets),
bank cheapest distinct singles with positive sale value and available shared stock, keep one free bench
slot, and bound each extra pass to 64 actions for free-refresh/effect loops. Sale-value estimates exclude
unexecuted sale hooks. Bank ownership is internal policy memory, reconstructed by offline replay. No hidden
pool counts are sent to the model. Unsuitable/unaffordable offers, a full bench, preserving a freeze or the
action bound can leave unusable funds; there is no gratuitous refresh solely to drive the loss metric to zero.

- `items`: `buy` contains up to **8 item IDs** to purchase from the shop when affordable and room remains;
  `keep` contains item IDs (32 max); `equip` contains `{id: itemId, target: operatorId}` (16 max; either
  operator form matches its base). Purchases use the usual handlers, followed by planned or legacy equipment selection. Explicit
  requests may leave one free hand slot; an incidental item that cannot be equipped immediately must leave
  at least two. Equipment is attempted between purchases so carrier slots are not promised twice.
  Existing inventory, slot and effect validators remain authoritative; invalid targets revert to ordinary selection.
- `placements`: up to 16 `{id, row, col, dir?}` preferences, rows 0..12, columns 0..10, four uppercase cardinal
  directions. A legal matching tile/direction adds 0.05 to the exposure score; normal terrain/role preferences
  and real rehearsal still choose the final layout. Impossible tiles are ignored.
- `choice`: one short action ID for band/card/offer/reward selection, e.g. `"a2"`. A missing/unusable choice lets
  the normal legacy/default picker finish the window. The plan's choice is checked through the same human path.
- Optional `usage` works in **both modes**: nonnegative integer `inputTokens`, `outputTokens`, `cachedTokens`,
  each at most 1 billion. Missing usage means unknown, not a claim of zero provider consumption.
- Optional `note` beside `plan` (a string of at most 300 characters, plan mode, §37.84): a line for the teammates'
  plan seats. It changes nothing in the game. A longer or non-string note is a protocol error like a malformed plan.

**Shared plans (§37.84, maintainer 2026-11-04: the LLM seats may share their plans, like voice chat).** In a co-op
plan-mode match each observation's `digest.team` lists the living teammates' plan seats with their latest accepted
prep plan and note: `{playerId, round?, bonds?, buy?, keep?, sell?, note?, noteRound?}`. Economy, items, placements and
choices stay private, a seat never sees its own row, and a human seat (also one a human took back from the AI) or a
built-in bot is never listed. A plan accepted
this round reaches the seats asked after it, the others read it at the next prep. The field is omitted when there is
nothing to show, in solo and with `SP_EXTERNAL_AI_TEAM=0`. It is **[ASSUMED]** tooling, no official rule, and a human
teammate sees none of it.

**Advisor hand-room protection (§35.14, §37.71).** A plan protects pieces only through its fields: an explicit
`buy` target actually purchased this prep, an exact `keep` id (from R9 with at most one free hand slot, a benched
normal `keep` of tier ≤ 4 that completes no merge is not protected), or a member whose removal lowers an active
plan-bond tier (the real distinct/hand/morph bond counting rules). The 2026-10-20 classes (every elite and tier ≥4
piece of an advisor seat) and the bank operators are gone (round 65): the bot's own guards (pairs, pieces gained
since its last prep, item carriers, Final Assault keeps, the 杰西卡 pager keeps) hold for every seat, and `sell` ids
go first. Bench shedding, junk sales, board withdrawal, the temp row, 缪尔赛思's sale on arrival and the Final
Assault bench sale skip protected pieces. When a protected piece must leave the board or the temp row and no
operator can be sold, a bot's own seat (not AI 托管) destroys its cheapest hand item costing at most 2 that is not a
突变细胞 and not in `items.keep`. A protected piece can still be benched. These priorities and the cheap-item cutoff
are **[ASSUMED]** executor policy, not official strategy. Prices, merge forms, bond thresholds
and hand/overflow/freeze mechanics retain their official `activity_table.json` / PRTS sources (§6.2–6.3).
A bot's own seat starts each prep with its focus as its plan's main at priority 5 (§37.75); an external
plan's own `bonds` replace it, and a plan naming no bonds keeps the seat's (an empty plan still plays the bot).

Malformed plans fail atomically and clear preferences before legacy. Accepted plans reset the failure streak
and resume the #673 prep continuation, preserving slicing, rehearsal, Ready and deadline behavior. Preferences
expire with the round; transport/malformed failures use ordinary legacy. Limits include the hello exchange;
there is also a wall-clock decision cap so virtual-time benchmarks cannot wait indefinitely. A late plan request
(§37.72) no longer holds `waitForIdle`, so a benchmark never waits for it; its reply lands when the benchmark next waits
for another request. Benchmarks serve the seats one after another and run battles in no time, so they undercount late
plans that steer a fallback or are carried. Journals record plans/short IDs/usage and the
mode/language/knowledge/reserve settings, without endpoints, argv, API keys or remote errors.
Replay rebuilds short IDs from the recorded state and applies the same plan with no transport IO.

### Knowledge handshake

`server/ai/knowledge.js` generates an immutable `sp-knowledge/1` pack from the active room data, room rule
switches and authored plugin offers, with SHA-256 `version`. It contains the PLAYING §1–§7 rules summary and
source digest, bonds/thresholds/effects, normal and elite operator costs/classes/skills/traits (§37.32: also catalogue
`stats` {hp, atk, def, res, block, attackInterval, aspd}, `dmgType`, `hitsAir` and `range`, the attack tiles as
[dRow, dCol] facing RIGHT with dCol forward and UP = +row, rotated for other facings), item effects,
bands, enemy notes/stats, boss HP by difficulty and difficulty scaling. The cache is keyed by immutable content,
mode, content identity, language, rules and offers (at most 16 variants per content object). Existing stale-checked language
overlays localize available game text; missing translations retain Chinese. Every named record also has `nameZh`.

Sources: local official `activity_table.json` (`autoChessData`, `activity.AUTOCHESS_SEASON.act2autochess`:
`bandDataListDict`, `shopLevelDataDict`, `charChessDataDict`, `trapChessDataDict`, `bondInfoDict`, `bossInfoDict`),
`character_table.json`, `skill_table.json`, `enemy_handbook_table.json`, the generated `data/*.json`, and
[PLAYING](PLAYING.md) / [DATA](DATA.md). Economy follows the existing implementation and its recorded evidence:
no EXP; base upgrade costs from the selected mode, −1 per round; normally funds expire. `band_cannot`'s
`aceffect_band_34` / `coin_carry_over` has capital 5, interest 1, max 1. Shop odds are **copy-weighted**, not a
fixed tier table: per-level eligibility/slot counts and pristine-catalogue tier shares are given, explicitly
before random bans, purchases and DIY stock. The formula is included; hidden live pool counts are never sent.
These game rules are unchanged. Plugin descriptions/rules may differ from the vanilla summary.

**Official versions (0.3.2, DESIGN §35.23).** A server may offer earlier official versions (docs/DEPLOY.md §11). A match
of a room that plays one carries `context.gameVersion` (its registry id: `act2autochess@V2_1`, `act1autochess`,
`act1autochess@V1_1`) and its knowledge pack a top-level `gameVersion` with that version's own tables (its bonds,
strategies, operators and modes — 第一期 has 18 bonds and no 终极); a match of 第二期下半 (`act2autochess`, the default)
carries neither key, so its observations and its pack's hash are unchanged. Do not reuse a cached pack across versions:
the hash differs, and chess ids name other operators in other versions (`chess_char_1_02` is 角峰 in 第二期, 讯使 in
第一期). Names in such a pack stay Chinese until the version has its own translations.

Before its first decision, the connection sends:

```js
{v:'sp-ai/1', type:'hello', id:'hello-ai-1', knowledge:{schema:'sp-knowledge/1', version:'<sha256>', /* ... */}}
// agent acknowledges:
{v:'sp-ai/1', type:'hello', id:'hello-ai-1', knowledgeVersion:'<same sha256>'}
```

HTTP uses a hello POST to the same endpoint; stdio uses an acknowledged NDJSON hello. Concurrent seats share
one handshake per match. A restarted stdio child receives it again. Decisions contain only `knowledgeVersion`;
a service may cache packs across matches by hash, but must acknowledge each match's hello. Bad/missing
acknowledgements use the same failure budget. Direct mode with knowledge disabled has no extra request.

Round 65 (§37.73): mergeable equipment rows carry `mergeCopies` (the copies that merge into the golden form,
`player/acquire.js` `_itemMergeable`); `playbook` carries the mode's `difficulty`; the community overlay has no
`bossCounters` (leader-specific drafting was rejected); `recommendedSchedule` stops at L5.

### Digest and short IDs

The original `public` and `private` views keep their exact fields. Each observation additionally has `digest`
and `context.mode`. Digest includes named shop prices/tiers, board coordinates, bench/overflow, bond count/next
threshold, gold and band-specific interest now/at the next threshold, level/upgrade cost and explicit `exp:null`,
current enemy/boss previews and opponents' **public scouted boards only**. No other private view or pool counts.
§35.13 adds `economy.expiringFunds` (0 for carry bands), effective `refreshPrice` (0 for a free charge),
`upgradePrice` (cost to the next level) and `frozenSlots` (unsold slot indices); `bankOperators` was removed with
the bank in round 65 (§37.71).
These fields and per-offer `frozen` survive the example's compact digest.
§35.15 adds further optional fields, omitted when unknown: chess on the board, bench, overflow and shop
gain `name`, `class` (the official profession) and `caps:{air,block,sustain,elementRecovery}` from
`canHitFly`, `dmgType`, `position`, `stats.blockCnt`, `profession` and `subProfessionId`
(`charChessDataDict` / `data/chess.json`). Items gain `name`. Two operators share the name 锡人, so the id
stays the key. Bounty cards gain `killChance` when the seat strategy's `bountyKillChance` returns a finite
number (the existing legacy exposure model, not a new combat rule) and `enemy:{hp,def,res,motion,fly,effect}`
from the catalogue row. `compactDigest` and `compactChoices` keep these fields. `sp-ai/1` and `sp-knowledge/1`
otherwise keep their schemas. The example's system prompt uses a slim view of the pack; the hello still
sends the full pack, and `strategyCandidates` still reads the full local playbook. The knowledge pack explains costs,
no EXP, carry/interest per band, normal/elite sale values, freeze consumption at next round start, and manual
refresh cancellation. Its playbook contains a recommended data-cost schedule and a labeled measured legacy
reference; candidate curves state stage-key tiers, inaccessible keys and public copy shares. See
[advisor economy](AI-STRATEGY.md#advisor-economy-3513) for sources, assumptions and the offline benchmark.
§35.11 adds own LP, operator base IDs/bonds and `stars` (1 normal, 2 elite), public factions/bans, and, in
plan mode only, `context.matchId` (opaque, unrelated to game RNG) and `digest.feedback`. Feedback retains the
last 256 own successful buy/sell/merge events with monotonic `seq`, `through`, the last battle's round/LP/
LP loss/counted leaks, and the last accepted prep plan `{id,round,plan}`. Buy/sell/merge events observe the
existing meta hooks, including legacy's execution; inventory disappearance is never called a sale. The original
human wire views keep exactly their existing fields. Feedback is scoped to the requested seat and match.

`digest.actions` enumerates current-state shortcuts as `{id:'a1',text:'buy shop slot 2 (… , 3 gold)',intent:{…}}`.
Shop/hand indices are zero-based. Direct agents can mix raw intents and IDs in `intents`, e.g. `["a1",{"t":"g.ready","ready":true}]`.
IDs are local to the request ID, not stable across observations; never infer an ID from a previous response.
The saved mapping goes through the same C2S and human validation, so a previously affordable or available choice
can still fail after another action/seat changes the state. Unknown IDs yield `BAD_MSG` and consume budget.
A buy or reward ID also stands for the operator/item its slot showed: when an earlier action of the same reply (a
refresh, a level-up, a new reward offer) has put something else in that slot, the ID fails with `STALE_ACTION`
(the detail names both) instead of buying the newcomer. A reward ID is also bound to the offer it came from: once
that offer was taken, the next queued offer is another card even when its slot shows the same operator (§37.31).
Raw `g.buy`/`g.reward` intents carry no such check.

§37.29 [ASSUMED] Both modes also carry `digest.geometry.routes` (prep only): the round's routes over the own field as the
built-in placement model traces them from the preview's gates and the map's roads, `[{fly, tiles: [[row, col], …]}]`
(gate → objective, objective tile excluded, a boss round mapped from the boss field), and `digest.lastBattle`: the seat's
last own battle as the battle statistics panel shows it, `{round, boss?, lp, lpLoss, killed, total, leaks: [{enemyKey,
name, count, counted, gates}], units: [{uid, id, name, kind, dmg, kills, taken, heal}]}` (units by damage, at most 24;
`gates` are the preview gates of that enemy kind). Leader and elite `upcoming` entries carry the catalogue brief that
bounty cards use (`enemy: {hp, def, res, motion, fly, effect}`).

[ASSUMED] The shortcut list is conservative, not exhaustive: it includes purchases, economy, sells, ordinary
equipment, permitted unequip, empty-tile placements/facing/withdrawal, rewards and available draft/offer picks.
Swaps, Arts, effect-dependent consumables, band focus and offer refresh retain the complete **raw intent API**.
Arbitrary plugin effects cannot prove eligibility without executing; observation building never executes them
as a legality probe. `actionScope` explicitly communicates this limitation. The LLM adapter omits low-level
placement shortcuts and duplicate raw views from its provider request; legacy handles those actions.

### Example language-model adapter

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_MODE=plan SP_EXTERNAL_AI_TRANSPORT=stdio \
SP_EXTERNAL_AI_COMMAND='["node","tools/ai/llm-agent.mjs"]' SP_EXTERNAL_AI_TIMEOUT_MS=30000 \
SP_LLM_BASE_URL=http://127.0.0.1:8000/v1 SP_LLM_MODEL=your-model \
SP_LLM_API_KEY="$YOUR_KEY" npm start
```

`SP_LLM_BASE_URL`, `SP_LLM_MODEL`, `SP_LLM_API_KEY` are required environment values; the endpoint and key are
never logged or journaled. `SP_LLM_TIMEOUT_MS` defaults to 20000 (1..300000). The adapter has no default provider or model.
`SP_LLM_MAX_TOKENS` caps one reply (default 16000, 256–32000; reasoning models spend completion tokens before the plan, so a small cap returns an empty reply); a reply cut off by that cap before any JSON is asked once more with a short "decide now, JSON only" turn while half of `SP_LLM_TIMEOUT_MS` remains (the limit covers both requests; history §35.63); `SP_LLM_REASONING_EFFORT` (minimal / low / medium / high) is sent as `reasoning_effort` when set, `SP_LLM_RETRY_EFFORT` (the same four fixed values, not adaptive) only on that retry; 机变 / offer / reward calls get a choice-only task and may echo `choiceName`, which corrects a mismatched choice ID when it names exactly one other card; `SP_LLM_DEBUG_FILE` appends one line per request with the failing stage, the reply head and the accepted plan, never the key or request headers.
It keeps eight knowledge versions in memory as stable system prompts, with an original general-principles
strategy prompt, and sends only compact digest/choices/continuity per decision. Provider prompt caching can reuse that prefix;
it is provider-dependent and still requires sending the prefix with the compatible stateless chat API.
By default it POSTs `/chat/completions`, uses `response_format:{type:'json_object'}`, validates the parsed plan locally,
rejects truncation/redirects/oversized output, and forwards numeric usage only. JSON mode does not guarantee
schema adherence ([official OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)).
[ASSUMED] Example limits: 16000 output tokens (`SP_LLM_MAX_TOKENS`, 256–32000), 256 KiB provider replies, 2 MiB input frames and 16 concurrent
requests (four seats plus requests the host abandoned that are still finishing). Debug lines carry the provider's
usage, so abandoned replies still show their tokens. Catalogue effect summaries retain at most 500 characters each. Tests use a loopback mock; no real API
is used for repository validation.

**Adapter v2 (round 65, §37.73; [AI-STRATEGY](AI-STRATEGY.md#example-llm-adapter-v2-round-65)).** The built-in bot is the
floor: an empty plan plays like it and the model only overrides. Band turns are choice-only calls: a table of the
offered bands with LP, the bot's share (`digest.bot.bands` when the host sends it, else LP³ × the §37.46 strength
table), the 职业队 bond and the bot's rule pick (`forced`, first); no leader. `{"choice":"bot"}` (or
`choiceName:"bot"`) leaves the window to the built-in bot, also for card / offer / reward calls, which keep only
`plan.choice`. Prep calls carry no strategy candidates; the compact digest adds `bot`, `fa` (with `budgetSec` and
`dpsNeeded`), `lastBattle` and `mainBonds` (owned, missing by tier, in the shop), and the model answers `{}` to agree.
Local repairs: `economy.level` ≤ 5; a `maxRefreshes` below 3 only with a saving reason in `economy.why`; `keep` at most
8 owned elites, pairs or members of the plan's bonds or the bot's focus; `items.buy` only to complete an equipment
merge or for a Final Assault carrier named in `items.equip`; no `placements`. `SP_LLM_CALL_ROUNDS` (comma list of
prep rounds, 1..99; default every prep) calls the model only on those preps; the others are answered at once with the
last accepted plan's `bonds` and `keep` (or `{}`). The system prefix stays within 50 000 characters (zh-CN 终极
32 840, English 46 826; it was 182 045). `SP_LLM_KINDS` (comma list of band, card, offer, reward, prep; default all) calls the model only for those decision kinds; the others answer `{}` and the built-in bot decides (single-decision measurements).

#### Anthropic Messages and extra headers (§37.25, in development)

`SP_LLM_API_FORMAT=openai|anthropic` selects the wire format; omitted means `openai` and preserves the existing
request. `anthropic` appends `/messages` to `SP_LLM_BASE_URL` (include the provider's `/v1`, omit `/messages`).
It sends `model`, `max_tokens`, a top-level text `system` block, and user `messages`; it does not send OpenAI's
`response_format` or a system-role message. Requests include `anthropic-version: 2023-06-01`.
`SP_LLM_AUTH_TYPE=bearer|x-api-key` chooses exactly one credential header, using `SP_LLM_API_KEY` in either case.
Bearer is the default for both formats, matching [OpenCode's documented authentication](https://dev.opencode.ai/v2/docs/console/api/inference).
Direct Anthropic uses `x-api-key`; selecting a format never guesses authentication from a hostname.

The stable system block includes `cache_control:{type:"ephemeral"}` by default. Set `SP_LLM_CACHE_SYSTEM=0`
to omit it for an Anthropic-compatible gateway without prompt caching (`1` restores it; OpenAI is unaffected).
Actual cache hits depend on the provider, model, minimum prefix length and expiry; they are not guaranteed.
See [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
Only response `text` blocks are joined into the existing JSON/brace-recovery/choice-check/plan-validation path;
thinking and redacted-thinking blocks are neither parsed nor logged. `end_turn` is a completed reply;
`max_tokens` uses the existing one-follow-up budget, while other stop reasons fail closed.
Both formats share the same response cap, deadline, rate-limit retries and redirect refusal.

Anthropic `inputTokens` is `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`;
`outputTokens` is `output_tokens`, and `cachedTokens` is the cache-read count. Cache writes are already included
in input, not counted as hits. Optional debug `cacheWriteTokens` reports writes separately; the host's three-field
usage schema stays unchanged. Retry usage is accumulated once per response, without adding the 5-minute/1-hour
cache-write breakdown again. Missing usage remains unknown; reasoning, when reported, is part of output.

Anthropic controls (model support is provider-specific; omitted controls remain omitted):

| Setting | Anthropic request |
|---|---|
| `SP_LLM_THINKING=disabled` | `thinking:{type:"disabled"}`; cannot combine with either effort variable |
| `SP_LLM_THINKING=enabled` | `thinking:{type:"adaptive"}` |
| `SP_LLM_REASONING_EFFORT=low|medium|high` | `output_config:{effort:...}` |
| `SP_LLM_REASONING_EFFORT=minimal` | `output_config:{effort:"low"}` ([ASSUMED] compatibility mapping) |
| `SP_LLM_REASONING_EFFORT=adaptive` | Existing per-observation budget policy selects `low` or omits effort; this is distinct from `thinking.type` |
| `SP_LLM_RETRY_EFFORT` | Same fixed-effort mapping, only for the token-limit follow-up |
| `SP_LLM_THINKING_BUDGET=N` with `SP_LLM_THINKING=enabled` | Legacy `thinking:{type:"enabled",budget_tokens:N}`; integer `1024 ≤ N < SP_LLM_MAX_TOKENS`, Anthropic only, incompatible with either effort variable |

[Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview) supports adaptive thinking.
The [legacy manual budget](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) is for models
that support it, not Haiku 5.5; the adapter does not infer capabilities or silently change controls after an error.

`SP_LLM_HEADERS` is an optional JSON object of extra request headers, for example:

```sh
export SP_LLM_HEADERS='{"HTTP-Referer":"https://example.org/","X-Title":"Stronghold local experiment"}'
```

It uses the transport's `safeHeaders` rules in strict mode: invalid JSON/objects, duplicate names ignoring case,
non-string/empty values, control characters, names outside `[a-z0-9-]` (case-insensitive, 1–64 characters), and
values over 256 characters or outside printable HTTP Latin-1 are rejected with a generic configuration error
before IO. Authorization (including `proxy-authorization` and `x-api-key`), `content-*`, `host`, cookies and
connection/framing controls are forbidden. The transport also filters unsafe caller headers defensively.
The adapter's user agent, generated session ID and Anthropic version take precedence over extra headers.
Headers never enter capture/debug records; use the dedicated credential setting for authentication.

#### Provider presets (configuration examples, not live compatibility measurements)

Set the common stdio/plan settings above, then choose one row. Load credentials into the environment securely.
The base URLs exclude the final method path. Clear provider-specific thinking/effort/extra-header settings when
switching providers; supported models, JSON mode and context limits vary.

| Provider | `SP_LLM_API_FORMAT` | `SP_LLM_BASE_URL` | Model / additional settings |
|---|---|---|---|
| [DeepSeek](https://api-docs.deepseek.com/quick_start/agent_integrations/) | `openai` | `https://api.deepseek.com` | `SP_LLM_MODEL=deepseek-flash`; Bearer |
| [OpenCode Go](https://opencode.ai/docs/go/), Chat Completions | `openai` | `https://opencode.ai/inference/go/openai/v1` | `SP_LLM_MODEL=deepseek-v4.1-flash`; Bearer; `SP_LLM_SESSION_HEADER=x-opencode-session` |
| OpenCode Go, Messages | `anthropic` | `https://opencode.ai/inference/go/anthropic/v1` | `SP_LLM_MODEL=claude-haiku-5-5`; Bearer; same session header |
| Direct Anthropic | `anthropic` | `https://api.anthropic.com/v1` | Available Claude model; `SP_LLM_AUTH_TYPE=x-api-key` |
| [OpenRouter](https://openrouter.ai/docs/quickstart) | `openai` | `https://openrouter.ai/api/v1` | Available `provider/model` slug; Bearer; optional attribution via `SP_LLM_HEADERS` |
| [Local Ollama](https://github.com/ollama/ollama/blob/main/docs/api/introduction.mdx) | `openai` | `http://127.0.0.1:11434/v1` | Installed local model; `SP_LLM_API_KEY=local-unused` if authentication is disabled |
| [Local vLLM](https://github.com/vllm-project/vllm/blob/main/docs/serving/online_serving/openai_compatible_server.md) | `openai` | `http://127.0.0.1:8000/v1` | Served model name with chat template; configured server key, or `local-unused` if authentication is disabled |

`SP_LLM_AUTH_TYPE=bearer` is implicit except in the direct Anthropic row. Local servers still need a nonempty
adapter key setting; the placeholder is only for a server that does not require authentication. OpenRouter's
current attribution example uses `HTTP-Referer` and `X-OpenRouter-Title`; the generic header option also accepts
`X-Title`. No subscription entitlement is implied by these presets: some subscriptions restrict use to their own
tools. Check the plan's terms and permitted traffic; identify this adapter honestly rather than impersonating
an approved client. OpenCode Go describes coding-agent traffic, an own user agent, and a stable conversation ID.
The owner cancelled the paid Haiku replay/co-op probe; §37.25 verifies mocks only, with no Haiku speed or quality claim.

#### Gateway client identification (0.3.4, in development)

Every request sends `user-agent: stronghold-protocol-llm-agent` (override with `SP_LLM_USER_AGENT`, one line,
≤ 256 characters). `SP_LLM_SESSION_HEADER` names an extra `x-…` header whose value is a 32-hex hash of the
match, seat and knowledge version — the same for every request of one seat's match, different for another seat.
Gateways that ask for this, such as [OpenCode Go](https://opencode.ai/docs/go/) (`x-opencode-session`), can
then group a seat's requests as one conversation. Caller headers never replace `authorization` or the content
headers. OpenCode Go example (its OpenAI-compatible endpoint; DeepSeek models need the account's Privacy → Regions
set to Global; the plan is designed for coding agents and its traffic is monitored for abuse):
`SP_LLM_BASE_URL=https://opencode.ai/inference/go/openai/v1 SP_LLM_MODEL=deepseek-v4.1-flash
SP_LLM_SESSION_HEADER=x-opencode-session` plus the plan's key in `SP_LLM_API_KEY`.

#### Thinking controls and JSON diagnostics (0.3.4, in development)

HTTP 429/503 responses may retry at most three times per decision. The existing one-call token-limit
follow-up does not reset that rate-limit retry counter.
The transport exposes only numeric `status` and parsed `retryAfterMs`, never the remote error body or headers.
`Retry-After` accepts seconds or an HTTP date ([RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after)).
[ASSUMED] Waits are capped at 30 seconds, defaulting to 10 seconds when absent/invalid. A retry requires a
full half of the original `SP_LLM_TIMEOUT_MS` budget after the wait, checked again on wake; all attempts share
the original deadline. The initial attempt keeps its existing timeout. Debug stage `rate-limit` records
`status`, `waitMs` (proposed delay), `retry` (whether scheduled), and `attempt`; exhausted retries/budget still
produce the generic `LLM request` failure and existing host fallback. Other HTTP errors are not retried.

In the default OpenAI format, `SP_LLM_THINKING=enabled|disabled` optionally sends `thinking:{type:...}`. Omitted means the provider's
default, as before; the adapter does not infer a switch from the model name. `disabled` cannot be combined
with either effort variable, since providers can give those conflicting switches different precedence.
The 16000-token cap is independent of thinking effort. No faster setting is made the default until a
same-observation quality replay and full ABYSS benchmark support it.

DeepSeek's [thinking documentation](https://api-docs.deepseek.com/guides/thinking_mode/) and
[Chat Completions reference](https://api-docs.deepseek.com/api/create-chat-completion/) checked on 2026-10-26
map `minimal` to `low`, and `medium` to `high`; thinking defaults to enabled/high. The explicit non-thinking
switch is `thinking:{type:"disabled"}`. These are provider facts, not portable promises for other services.
The small round54 probe found lower latency with low effort, but non-thinking made worse spending choices;
the first replay and A/B attempt were blocked by HTTP 402 (insufficient balance). Cycle 5 below completed
the comparison on OpenCode Go. See
[the measurement and limitations](history/0.3.4.md#371-llm-latency-and-json-recovery-round54-in-development).

Optional local diagnostics (never enabled by default):

- `SP_LLM_DEBUG_FULL_REPLY=1`, together with `SP_LLM_DEBUG_FILE`, records the entire final failed
  content, within the existing provider response size cap. It does not record reasoning text.
- `SP_LLM_CAPTURE_FILE` records the exact provider request body, including messages, model and controls,
  with match/player/request/round metadata. It includes private seat state and the knowledge prefix; store it
  outside git. It never records transport configuration, endpoint, headers or credentials.
- Debug usage includes optional top-level `reasoningTokens` when the provider reports it. `outputTokens`
  already includes these tokens; do not add them again for cost. The wire `usage` schema is unchanged.
  Cache hits accept both `prompt_tokens_details.cached_tokens` and DeepSeek's `prompt_cache_hit_tokens`.
- Both local writers redact an exact credential echoed in model/game text; new files use mode 0600.
  Transport exceptions remain generic even when an injected transport throws remote text.

Round54 full replies reproduced a complete `plan.items.equip` array ending in `]}}`, missing only the final
outer wrapper `}` despite `finish_reason:"stop"`. [ASSUMED] The parser may add that one brace only when
the wrapper ends in `plan`, the plan ends in `items`, and items ends in `equip`; a successful JSON parse and
the existing plan validation are still required. It records the syntax repair. Missing array elements,
strings, fields, inner braces, arbitrary syntax errors and token-limit replies are not completed or guessed.
This recovers both captured nonempty syntax failures; it cannot recover the captured empty reply, and it
does not establish that all 35 head/tail-only cycle-3 failures had the same defect.

#### Fixed default/low match comparison (cycle 5)

Same code, OpenCode Go deepseek-v4.1-flash, default content version, ABYSS; eight solo and four co-op matches
per side.

| Setting | Wins | Reached FA | Mean FA share | Leaks/match | Applied | Valid-plan p50/p90 (s) |
|---|---:|---:|---:|---:|---:|---:|
| solo default | 0/8 | 4/8 | 23.69% | 45.50 | 132/134 (98.51%) | 28.610/67.540 |
| solo low | 0/8 | 3/8 | 6.22% | 53.50 | 131/138 (94.93%) | 21.315/36.585 |
| coop4 default | 0/4 | 1/4 | 2.05% | 202.00 | 142/221 (64.25%) | 30.270/75.282 |
| coop4 low | 0/4 | 2/4 | 8.81% | 222.00 | 212/233 (90.99%) | 21.664/46.331 |

Keep provider-default thinking for solo: low was faster but had lower FA share and more leaks. Solo prep has
no phase countdown; the existing external-request cap still applies. Low did not meet all predeclared
conditions (no worse FA share/leaks and more co-op replies applied), so fixed co-op low is not recommended
from this run.
Adaptive effort is an explicit next experiment: keep default when the budget permits, use low only for short
co-op budgets. It has no real-match result yet. This is a descriptive small sample, not a win-rate or causal
claim; outages and sequential service conditions affect latency. The release target remains unmet. See
[§37.23](history/0.3.4.md#373-bounded-llm-rate-limit-retries-round54-cycle-5) for counts, costs, selection and limits.

#### Adaptive effort (experimental opt-in, cycle 5)

`SP_LLM_REASONING_EFFORT=adaptive` selects effort independently for each observation. For a co-op knowledge
pack (`modeId` starts with `mode_multi_`), a known positive initial budget below 90000 ms selects `low`;
otherwise it omits `reasoning_effort`, leaving the provider's default. The budget is the smaller of
`SP_LLM_TIMEOUT_MS` and `context.deadline - public.serverNow`. Since §37.72 a co-op budget is longer: adaptive still
selects `low` for R1–R5 preps (59.1–89.1 s) and for band and 机变 turns, but not from R6 (90.1 s and more). These two
host timestamps share a clock;
the adapter never compares a virtual bench timestamp with local wall time. Solo, unknown modes, missing,
nonfinite or expired timing keep the provider default. Timers, token caps, prompts and host fallback are unchanged.

[ASSUMED] 90 seconds is an experimental threshold, informed by the measured default co-op prep p90 of
77.460 seconds with some margin; it guarantees neither timely replies nor better play. Selection stays fixed
for that decision's retries. An explicit `SP_LLM_RETRY_EFFORT` still overrides the existing token-limit follow-up;
leave it unset to keep the adaptive choice throughout. `adaptive` is not accepted as a retry effort or with
`SP_LLM_THINKING=disabled`. The adapter never sends the literal value `adaptive` as an effort value. Adaptive debug
lines add `reasoningEffort: "default" | "low"`; other configurations keep their existing request bodies.
On the recorded default co-op observations, this threshold would choose low for 220/221 decisions. It does
not establish that adaptive avoids the measured co-op quality tradeoff.
This option was checked with mocks only; no paid adaptive match was run. Its use is an experiment, not a
validated quality recommendation or a default change. The measured provider/model is OpenCode Go
`deepseek-v4.1-flash`; do not extrapolate its effort behavior to another service.

To try the option after configuring the gateway, use the measured host/provider caps of 170000/150000 ms
and 16000 output tokens shown below; set `SP_LLM_REASONING_EFFORT=adaptive` and leave
`SP_LLM_RETRY_EFFORT` / `SP_LLM_THINKING` unset. The fixed-effort comparison below did **not** enable it.

#### Reproduce the fixed-effort comparison

Load the key securely into `SP_LLM_API_KEY` without printing or saving it. Set `LLM_RESULTS` to a private results
directory outside the checkout; each command below must finish before starting the next. The two sides use
identical settings except for effort. Files must be unique; retain failed attempts and their usage when resuming.

```sh
export SP_LLM_BASE_URL=https://opencode.ai/inference/go/openai/v1
export SP_LLM_MODEL=deepseek-v4.1-flash SP_LLM_SESSION_HEADER=x-opencode-session
export SP_EXTERNAL_AI_MODE=plan SP_EXTERNAL_AI_TRANSPORT=stdio
export SP_EXTERNAL_AI_COMMAND='["node","tools/ai/llm-agent.mjs"]'
export SP_EXTERNAL_AI_TIMEOUT_MS=170000 SP_LLM_TIMEOUT_MS=150000 SP_LLM_MAX_TOKENS=16000
unset SP_EXTERNAL_AI_SEATS SP_LLM_REASONING_EFFORT SP_LLM_RETRY_EFFORT SP_LLM_THINKING
unset SP_LLM_CAPTURE_FILE SP_LLM_DEBUG_FULL_REPLY
SP_LLM_DEBUG_FILE="$LLM_RESULTS/default-solo-debug.jsonl" node tools/botbench.mjs \
  --bot external --configs solo:ABYSS --seed 1 --seeds 8 --jobs 2 --json "$LLM_RESULTS/default-solo.json"
SP_LLM_DEBUG_FILE="$LLM_RESULTS/default-coop4-debug.jsonl" node tools/botbench.mjs \
  --bot external --configs coop4:ABYSS --seed 1 --seeds 4 --jobs 1 --json "$LLM_RESULTS/default-coop4.json"
export SP_LLM_REASONING_EFFORT=low
SP_LLM_DEBUG_FILE="$LLM_RESULTS/low-solo-debug.jsonl" node tools/botbench.mjs \
  --bot external --configs solo:ABYSS --seed 1 --seeds 8 --jobs 2 --json "$LLM_RESULTS/low-solo.json"
SP_LLM_DEBUG_FILE="$LLM_RESULTS/low-coop4-debug.jsonl" node tools/botbench.mjs \
  --bot external --configs coop4:ABYSS --seed 1 --seeds 4 --jobs 1 --json "$LLM_RESULTS/low-coop4.json"
```

These are paid commands, not repository tests. The cycle-5 local harness additionally collected host acceptance,
provider `usage.opencode.list_cost`, and stopped new requests at a reported $8 total or a repeated fast transport
failure. That harness is not part of the shipped adapter: the commands above do not enforce a money budget.
After machine/network outages, only affected data was replaced: solo seed 7 at jobs 1 on both sides and the
interrupted default co-op batch. Ordinary slow/invalid replies stayed in the comparison. See history §37.23.

### Committed round plans and private reasoning (§35.11)

The example also receives a versioned, data-derived playbook (§35.12). Round 65 replaced the candidate lists: the
band draft is the choice-only table above and prep calls carry no candidates. `strategyCandidates` remains the offline
audit (`tools/ai/playbook.mjs --observation`), its draft ranked by the same measured prior. See [AI strategy method and regeneration](AI-STRATEGY.md) for
official field sources, the maintainer's 2026-10-19 community guidance, band implications, stage keys,
public teammate contention, enemy coverage and [ASSUMED] score/timing formulas. `knowledge.playbook` is static;
prep calls carry no `strategy.candidates` (round 65), and a plan's bond targets still pass the held/reachable
three-target gate. Regenerate offline with
`node tools/ai/playbook.mjs --data-dir data --mode mode_multi_normal`; optional `--community` and `--observation`
JSON inputs support other versions and saved observations. Output includes input/policy hashes and score evidence.

The maintainer requested this example-policy change on **2026-10-19** after the solo HARD seed-7 run kept
changing targets, bought unrelated operators and rejected one plan. All behavior here is **[ASSUMED] advisor
policy**, not an official strategy or a change to the generic eight-bond plan protocol or gameplay rules.
The sources remain the local official `activity_table.json`: `autoChessData` and
`activity.AUTOCHESS_SEASON.act2autochess`'s `bondInfoDict`, `charChessDataDict`, `shopLevelDataDict` and
band/effect records, as described above. Public bans, visible prices, actual bond counts and band interest use
the existing game builders. No live stock or other seat's private transactions are inspected.

The model is asked for:

```json
{"why":"Agree with the bot; keep the 谢拉格 pair for the merge.","pivot":false,"pivotReason":"","plan":{"keep":["chess_char_1_02_a"]}}
```

- `why` is at most three short sentences (stored at most 360 characters). `pivot` is a boolean;
  `pivotReason` is one line, at most 160 characters. These are adapter-only metadata. Only `plan` reaches
  the game's validator, legacy executor and journal; metadata is never sent to another seat.
- Keep at most **three** targets with priorities 1..5, highest first. Candidates must already have board/bench
  members and a completed or publicly reachable threshold. Prefer finishing thresholds, preserving pairs and
  core units. With no candidates, build the board first. The mains a seat may name before it holds a member are the
  bot's focus / second, the band's 职业队 bond and the main-bond panels (round 65; they were the candidates' mains).
  Changing the primary bond (the highest priority)
  requires `pivot:true` and a reason (unreachable bond, strong merge, boss/enemy needs). Adding, removing or
  reordering sub-bonds does not. Without both, retain viable old targets; removing unreachable old targets
  produces an explicit automatic pivot reason in diagnostics.
  An explicitly empty plan remains unweighted legacy delegation, preserving §35.9's escape hatch.
- The example caches the last confirmed and pending prep snapshots separately per match/player/knowledge version
  (32 seat scopes). Host acknowledgement prevents rejected/late plans being presented as accepted. Drafts and
  failed replies do not overwrite the prep direction. Each request includes the previous accepted plan and
  observed buy/sell/merge events, bond counts before→after, LP before→after and the last battle; current board,
  bench and overflow are in the digest. Old choice IDs are removed. Restart/eviction loses the local baseline:
  the host still supplies the accepted plan and retained events, but missing baseline counts are `null` and
  `eventsComplete:false`. Event sequence gaps are likewise explicit.
- The compact digest lists shop cost/tier/bonds, owned stars/equipment/positions, bond count/next threshold/layers,
  gold/interest/upgrade costs, enemies/factions/boss and public teammate bond summaries. §35.15 also keeps
  chess `name` / `class` / `caps` and item `name`, because ids alone are ambiguous, and bounty `killChance`
  plus compact enemy stats. Choice cards retain their visible effects and prices. Raw duplicate views, geometry,
  placement alternatives, cosmetic fields and long trait text stay out; that text lives in the slim prefix.
  The full knowledge pack stays the hello payload. The example system prompt is the slim view, at most 50 000
  characters (round 65): column rows for bonds, the pool's normal operators, bands and items, no enemy or leader rows;
  a larger content set sheds the trait and item-effect columns first.
- Reachability is a conservative **estimate**: use public catalogue members eligible at the current shop level,
  excluding public bans, plus owned/displayed copies, capped by deployment capacity (except deck-counting bonds).
  Golden-only targets require already owned elites; special bonuses/plugin effects are not forecast. Bench
  members are potential, not activated count. `poolOptions` counts catalogue entries, **not remaining copies**;
  actual stock and future rolls remain unknown. This cannot guarantee a threshold will be completed.
- Local repairs drop unknown/wrong-kind IDs, duplicate/capped entries and stale choices; clamp finite numeric
  values to existing schema bounds (numeric strings/fractions normalize); normalize placement directions.
  The resulting plan still passes the strict `validPlan`. Apart from the narrow 0.3.4 missing-wrapper recovery above, malformed structures, invalid JSON,
  incomplete replies and transport errors still fail and use the existing bounded fallback. Bare §35.9 plans
  remain accepted. No retry or extra provider request is introduced.
  Round 65 also removes what the bots measured as harmful: L6 (level clamped to 5, no L6 hold floor), refresh caps
  below 3 without a saving reason, keeps beyond 8 core ids, shop equipment that completes no merge, placements.

Set `SP_LLM_DEBUG_FILE` to a local NDJSON path to record match/player/request/round, bounded `why`, pivot/reason,
accepted output plan, repairs (field and dropped ID/value, up to 128 details plus total count), stage and latency.
The plan is the adapter's validated output; the next host observation confirms acceptance. Failure entries
may include a short reply head. Keep this file private; it contains seat strategy and model text. API keys,
headers and the knowledge prefix are not written to this debug file (the separate opt-in capture includes the prefix). `SP_LLM_REASONING_EFFORT` optionally passes
`minimal|low|medium|high`; provider cache hits and latency improvements are not guaranteed.

Offline evaluation: `test/fixtures/llm-advisor.json` is an authored recorded mock trace of the observed failure
patterns using synthetic IDs, not a copied official table or a real model benchmark.
`test/match/external-llm-continuity.test.js` checks continuity, host-observed execution, isolation, pivots,
three targets, private reasoning, repairs and prompt size. Existing transport, advisor and replay suites still
exercise the unchanged execution path. No win-rate or real-provider latency improvement is claimed.

### Benchmarks

Both tools now wait for in-flight HTTP/stdio replies before stepping virtual time, while real matches continue
using their ordinary timers. Fix seeds/config/rehearsal/content and change only the strategy. `--bot external`
uses the same owner environment as the server; `SP_EXTERNAL_AI_SEATS` allows legacy peers. `botbench --json -`
prints just JSON; `--json file.json` still writes the comparison artifact. Matchrun's `--json` includes the same
per-seat `strategyMetrics`: strategy, survival round (elimination round or final round), passed rounds, final LP,
damage dealt, leader damage, wins and external calls, reported tokens, usage-report count, latency and fallbacks.
`external.helloCalls` counts handshakes separately. `calls` counts decision attempts, including failed hellos;
latency includes handshake time. `fallbacks` counts failed decisions, not successful `{}` delegation or later
decisions after the seat is disabled. Summary outcomes are means per seat; wins and IO counters are totals.
No usage report means tokens are unknown; compare coverage alongside the totals. Wall time varies with load.
