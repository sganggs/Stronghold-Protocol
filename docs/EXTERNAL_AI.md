# External AI API (`sp-ai/1`)

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
maxBytes, failureLimit, backoffMs }, ... })` overrides the environment configuration as a whole. Omitted
numeric fields use the defaults below. The bearer token is read only from `SP_EXTERNAL_AI_TOKEN`.
Configuration is validated before server startup; an invalid configuration fails without printing credentials.

| Variable | Meaning / default / bounds |
|---|---|
| `SP_BOT_STRATEGY` | `external` to enable; unset / empty selects `legacy` |
| `SP_EXTERNAL_AI_TRANSPORT` | Required: `http` or `stdio` |
| `SP_EXTERNAL_AI_URL` | HTTP(S) endpoint; no URL credentials or fragment |
| `SP_EXTERNAL_AI_TOKEN` | Optional HTTP bearer token; environment only |
| `SP_EXTERNAL_AI_COMMAND` | Required for stdio: JSON argv array, no shell; 1–64 nonempty strings, each ≤4096 characters |
| `SP_EXTERNAL_AI_SEATS` | Optional comma-separated seat indices, 0–3; omitted means all bot-controlled seats |
| `SP_EXTERNAL_AI_TIMEOUT_MS` | 1000; integer 1–30000, both request timeout and total decision budget |
| `SP_EXTERNAL_AI_MAX_INTENTS` | 64; integer 1–256, cumulative across replies in one decision |
| `SP_EXTERNAL_AI_MAX_BYTES` | 65536; integer 1–1048576, raw response bytes / stdio line, excluding newline |
| `SP_EXTERNAL_AI_FAILURES` | 3; integer 1–20 consecutive failed decisions before match-long fallback |
| `SP_EXTERNAL_AI_BACKOFF_MS` | 1000; integer 1–60000 before the next demand can restart a failed stdio child |

Seat selection applies to AI teammates, opponent seats in modes that use them, and humans under AI takeover.
Unselected seats use `legacy`. INFO_CHECK acknowledgement and combat simulation remain engine-owned; decision
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
    legalActions: ['g.buy', /* ... */ 'g.ready']
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
protocol-only. Stderr is discarded to avoid leaking secrets through server logs. A crash, bad/oversized line,
unknown reply ID, cancellation or timeout kills the child and fails outstanding requests. A subsequent demand
restarts it only after `backoffMs`; requests during backoff fail immediately. Shutdown uses SIGKILL to bound
cleanup, including programs that ignore SIGTERM. The operator remains responsible for any grandchildren its
own program starts. Match end and disposal terminate the child and cancel pending HTTP requests.

A decision has one total budget across all batches: at most `timeoutMs`, further limited to half the remaining
phase/offer time, reserving the rest for fallback. Untimed phases still use the adapter budget. Existing phase
timers stay armed. Requests are asynchronous; no scheduler callback waits on network or child IO. No AI request
can extend a phase. A reply after a phase/turn change, seat elimination or manual takeover cannot mutate state.

Timeout, transport/protocol failure, reaching the intent cap without completion, or `done:true` without the
required terminal action runs the unchanged legacy decision for that seat. Prep fallback retains sliced
shopping/placement, the existing rehearsal/delegation path, cleanup and Ready. Accepted actions before a failure
stay applied, so legacy continues from the current seat state. Offer fallback retains the existing window default.
Three consecutive failed decisions (configurable) disable external decisions for that seat for the rest of the
match and log the switch once; a completed decision resets the streak. Other seats keep their own counters.

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
  `{"level":5,"holdLevel":true,"why":"Search now; reach L6 next prep at a lower price."}`.
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

**Advisor hand-room protection (§35.14).** Only a nonempty advisor plan enables this policy; legacy and
AI takeover without an advisor retain their original execution (maintainer decision **2026-10-20**).
An elite, tier ≥4, exact `keep` piece, explicit buy target actually purchased this prep, or member whose
removal drops an active plan-bond threshold is protected. The last check uses the real distinct/hand/morph
bond counting rules. For room, sell unprotected copies of owned elites first, then bank operators, then
low-tier off-plan singles, then other unprotected pieces; within each class use lowest piece value and UID.
Next destroy the cheapest unequipped hand item costing at most 2 (UID breaks ties); only then fall back to
legacy cleanup if every remaining option is protected. The protection applies to bench shedding, junk sales,
board withdrawal, end-prep room and overflow resolution. A protected piece can still be benched.
These priorities, the cheap-item cutoff, item space margins and 32-action cleanup bound are **[ASSUMED]**
executor policy from the maintainer's seed-11 replay, not official strategy. Prices, merge forms, bond thresholds
and hand/overflow/freeze mechanics retain their official `activity_table.json` / PRTS sources (§6.2–6.3).

Malformed plans fail atomically and clear preferences before legacy. Accepted plans reset the failure streak
and resume the #673 prep continuation, preserving slicing, rehearsal, Ready and deadline behavior. Preferences
expire with the round; transport/malformed failures use ordinary legacy. Limits include the hello exchange;
there is also a wall-clock decision cap so virtual-time benchmarks cannot wait indefinitely. Journals record
plans/short IDs/usage and mode/language/knowledge settings, without endpoints, argv, API keys or remote errors.
Replay rebuilds short IDs from the recorded state and applies the same plan with no transport IO.

### Knowledge handshake

`server/ai/knowledge.js` generates an immutable `sp-knowledge/1` pack from the active room data, room rule
switches and authored plugin offers, with SHA-256 `version`. It contains the PLAYING §1–§7 rules summary and
source digest, bonds/thresholds/effects, normal and elite operator costs/classes/skills/traits, item effects,
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

### Digest and short IDs

The original `public` and `private` views keep their exact fields. Each observation additionally has `digest`
and `context.mode`. Digest includes named shop prices/tiers, board coordinates, bench/overflow, bond count/next
threshold, gold and band-specific interest now/at the next threshold, level/upgrade cost and explicit `exp:null`,
current enemy/boss previews and opponents' **public scouted boards only**. No other private view or pool counts.
§35.13 adds `economy.expiringFunds` (0 for carry bands), effective `refreshPrice` (0 for a free charge),
`upgradePrice` (cost to the next level), `frozenSlots` (unsold slot indices), and
`bankOperators:[{uid,id,sellValue}]` (marked disposable bench singles; base refund before sale hooks).
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

`SP_LLM_BASE_URL`, `SP_LLM_MODEL`, `SP_LLM_API_KEY` are required environment values; none are logged or
journaled. `SP_LLM_TIMEOUT_MS` defaults to 20000 (1..30000). The adapter has no default provider or model.
`SP_LLM_MAX_TOKENS` caps one reply (default 6000, 256–32000; reasoning models spend completion tokens before the plan, so a small cap returns an empty reply); `SP_LLM_REASONING_EFFORT` (minimal / low / medium / high) is sent as `reasoning_effort` when set; `SP_LLM_DEBUG_FILE` appends one line per request with the failing stage, the reply head and the accepted plan, never the key or request headers.
It keeps eight knowledge versions in memory as stable system prompts, with an original general-principles
strategy prompt, and sends only compact digest/choices/continuity per decision. Provider prompt caching can reuse that prefix;
it is provider-dependent and still requires sending the prefix with the compatible stateless chat API.
It POSTs `/chat/completions`, uses `response_format:{type:'json_object'}`, validates the parsed plan locally,
rejects truncation/redirects/oversized output, and forwards numeric usage only. JSON mode does not guarantee
schema adherence ([official OpenAI documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat)).
[ASSUMED] Example limits: 6000 output tokens (`SP_LLM_MAX_TOKENS`, 256–32000), 256 KiB provider replies, 2 MiB input frames and four concurrent
requests. Catalogue effect summaries retain at most 500 characters each. Tests use a loopback mock; no real API
is used for repository validation.

### Committed round plans and private reasoning (§35.11)

The example also receives a versioned, data-derived playbook (§35.12). §35.15 sends at most eight scored
band-draft directions, preferring uncontended community/maintainer mains, and collapses a prep band and main
into one candidate with `subOptions` (fewer only when legal alternatives run out). See [AI strategy method and regeneration](AI-STRATEGY.md) for
official field sources, the maintainer's 2026-10-19 community guidance, band implications, stage keys,
public teammate contention, enemy coverage and [ASSUMED] score/timing formulas. `knowledge.playbook` is static;
the adapter computes `strategy.candidates` from the seat digest and acknowledged prior plan. Future targets
guide purchases but do not bypass the held/reachable three-target gate. Regenerate offline with
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
{"why":"Complete the held pair and the nearest bond threshold.","pivot":false,"pivotReason":"","plan":{"bonds":[],"keep":[],"economy":{"maxRefreshes":2}}}
```

- `why` is at most three short sentences (stored at most 360 characters). `pivot` is a boolean;
  `pivotReason` is one line, at most 160 characters. These are adapter-only metadata. Only `plan` reaches
  the game's validator, legacy executor and journal; metadata is never sent to another seat.
- Keep at most **three** targets with priorities 1..5, highest first. Candidates must already have board/bench
  members and a completed or publicly reachable threshold. Prefer finishing thresholds, preserving pairs and
  core units. With no candidates, build the board first. Changing the primary bond (the highest priority)
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
  The full knowledge pack stays the hello payload. The example system prompt is the slim view, at most 200000
  characters, and drops compact enemies only when a translated catalogue would exceed that.
- Reachability is a conservative **estimate**: use public catalogue members eligible at the current shop level,
  excluding public bans, plus owned/displayed copies, capped by deployment capacity (except deck-counting bonds).
  Golden-only targets require already owned elites; special bonuses/plugin effects are not forecast. Bench
  members are potential, not activated count. `poolOptions` counts catalogue entries, **not remaining copies**;
  actual stock and future rolls remain unknown. This cannot guarantee a threshold will be completed.
- Local repairs drop unknown/wrong-kind IDs, duplicate/capped entries and stale choices; clamp finite numeric
  values to existing schema bounds (numeric strings/fractions normalize); normalize placement directions.
  The resulting plan still passes the strict `validPlan`. Malformed structures, invalid JSON,
  incomplete replies and transport errors still fail and use the existing bounded fallback. Bare §35.9 plans
  remain accepted. No retry or extra provider request is introduced.

Set `SP_LLM_DEBUG_FILE` to a local NDJSON path to record match/player/request/round, bounded `why`, pivot/reason,
accepted output plan, repairs (field and dropped ID/value, up to 128 details plus total count), stage and latency.
The plan is the adapter's validated output; the next host observation confirms acceptance. Failure entries
may include a short reply head. Keep this file private; it contains seat strategy and model text. API keys,
headers and the knowledge prefix are not logged. `SP_LLM_REASONING_EFFORT` optionally passes
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
