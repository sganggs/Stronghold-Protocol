# State changes for each client message

This document answers three questions for each message that the client sends:

1. Which states change in the server?
2. How does the server update the states in the Durable Object?
3. Does the server answer with `send()` or with `broadcast()`?

[WS-EVENTS.md](WS-EVENTS.md) shows the messages in the order of a match. This document shows the effect of each
client message. The words have the same meanings in the two documents.

The sources are the files of the original project. If this document and a source are different, the source is
correct. The section [Method](#8-method) shows the source of each fact.

## 1. The state objects

The server has seven state objects. The column "Properties" has the names from the code.

| Object | Properties | Code |
|---|---|---|
| Session | `playerId` `token` `name` `connected` `lastSeen` `roomCode` `loadout` | `server/net.js` |
| Room | `code` `mode` `difficulty` `hostId` `seats` `matchCount` | `server/lobby.js` |
| Seat | `seat` `playerId` `name` `isBot` `ready` `connected` `left` | `server/lobby.js` |
| Match | `phase` `round` `deadline` `draft` `sp` `fields` `bossPool` `teamLp` `paused` | `server/match/Match.js` |
| Player | `funds` `lp` `shop` `hand` `temp` `board` `bonds` `effects` `ready` `autoplay` | `server/match/PlayerState.js` |
| Pool | the copies of each operator that all players share | `server/match/pool.js` |
| Field | `battleId` `spec` `authority` `progress` `result` | `server/match/Match.js` |

- A Session is one player identity. It continues when the socket closes and opens again.
- A Room has four Seats. A Seat holds one human player or one AI player.
- A Match has one Player for each Seat that is in use, and one Pool.
- A Field is one battle. The server makes the Fields at the start of each battle phase.

## 2. The state in the Durable Object

The Durable Object keeps the state in two places.

**The memory.** The seven objects are objects in the memory of the Durable Object. The engine changes them. The
engine is the code of the original project for the rules of a match (`server/match/` and `server/sim/`). The Worker
adds no rule of the game.

**The storage.** The Durable Object has an SQLite database. This design is a proposal: no code exists for it. The
database has four tables.

| Table | One row for | Columns |
|---|---|---|
| `session` | each Session | `player_id` `token` `name` `room_code` `loadout` `last_seen` |
| `room` | each Room | `code` `mode` `difficulty` `host_id` `seats` `match_count` |
| `match` | each Match | `id` `room_code` `seed` `options` `started_at` |
| `input` | each client message that a Match accepts | `match_id` `seq` `at_ms` `player_id` `message` |

The tables `session` and `room` hold the state itself. The tables `match` and `input` do not hold the state of a
Match. The engine has no function that saves a Match and no function that loads one. Thus the storage keeps the
inputs of a Match:

- The `match` row has the `seed` and the options. With these, the engine makes the same Match again.
- Each `input` row has one client message and its time.

These steps occur for each client message of a Match:

1. The Durable Object writes the `input` row.
2. The Durable Object gives the message to the engine.
3. The engine changes the objects in the memory.
4. The engine calls `send()` or `broadcast()`.

After a restart, the Durable Object makes each Match again from its `match` row. Then it gives each `input` row to
the engine in the same order.

CAUTION: Do not use the tables `match` and `input` without a test. The test must show that the same inputs make the
same Match. No test shows this at this time.

The prototype has two steps. Step 1 uses the memory only: a restart stops each Match. Step 2 adds the four tables.

## 3. The three ways to answer

| Name | Receiver | Messages |
|---|---|---|
| reply | the socket of the sender | `ok` `error` `welcome` `pong` |
| `send()` | one player | `m.private` `m.result` `m.toast` `m.unitStats` `m.field` `b.start` `b.end` |
| `broadcast()` | each connected human player of the room | `m.public` `m.ticker` `m.emote` `b.pool` `room.state` |

Two rules apply to each message of a Match (`g.*` and `b.*`). The sections below do not show them again.

- **`m.private`.** After each message, the Match compares the private state of each human player with the last
  `m.private` of that player. If they are different, the Match calls `send()` with the new `m.private`.
- **`m.public`.** If the public state changed, the Match calls `broadcast()` with the new `m.public`. The Match
  sends a maximum of 10 each second. Thus an `m.public` can come a short time after the reply.

Each request also gets a reply: `ok`, or `error` with a code. An `error` changes no state and causes no push.

## 4. Session messages

### `ping { c }`

- **State:** Session `lastSeen`.
- **Storage:** none.
- **Answer:** reply `pong { c, s }`.

### `hello { name, token?, version? }`

- **State:** With no `token`, or with a `token` that the server does not know, the server makes a new Session. With
  a known `token`, the server uses the earlier Session and sets `connected`. If that Session has a Seat, the server
  sets `connected` on the Seat and on the Player.
- **Storage:** the server adds or updates one `session` row.
- **Answer:** reply `welcome`.
  - If the Session is in a Room: `room.state` to the sender.
  - If the Session is in a Match: `send()` with `m.public` and `m.private`, and with `b.start` if a battle
    continues.
  - If the Seat changed: `broadcast()` with `room.state` and `m.public`.

A second `hello` on the same socket asks for the state again. The server sends these messages to the sender only:

- `welcome`
- `room.state`
- `m.public`
- `m.private`

### The socket closes

This is not a message, but it changes state.

- **State:** Session `connected`. Seat `connected`. Player `connected`. If the player was the authority of a Field,
  the server or a different client becomes the authority.
- **Storage:** the server updates the `session` row. In a Match, it adds one `input` row.
- **Answer:** `broadcast()` with `m.public` and `room.state`.

## 5. Lobby messages

Each lobby message is a request. The sender gets `ok` or `error`. The lines "Errors" do not show `NOT_IN_ROOM`.

### `room.create { mode, difficulty }`

- **State:** a new Room. Seat 0 holds the sender. Room `hostId` is the sender. Session `roomCode`.
- **Storage:** the server adds one `room` row and updates the `session` row.
- **Answer:** `broadcast()` with `room.state`. At this time the sender is the only receiver.
- **Errors:** `RATE`, `ROOM_STARTED`.

### `room.join { code }`

- **State:** Room `seats`: the sender gets the free Seat with the lowest number. Session `roomCode`.
- **Storage:** the server updates the `room` row and the `session` row.
- **Answer:** `broadcast()` with `room.state`.
- **Errors:** `ROOM_NOT_FOUND`, `ROOM_FULL`, `ROOM_STARTED`.

### `room.leave`

- **State:** In the lobby, the server removes the Seat. If the sender was the host, a different human player
  becomes the host. If no human player stays, the server deletes the Room. In a Match, the effect is the effect of
  `g.leave`.
- **Storage:** the server updates or deletes the `room` row, and updates the `session` row.
- **Answer:** `broadcast()` with `room.state` to the players that stay.

### `room.ready { ready }`

- **State:** Seat `ready`.
- **Storage:** the server updates the `room` row.
- **Answer:** `broadcast()` with `room.state`.

### `room.setDifficulty { difficulty }`

- **State:** Room `difficulty`. Seat `ready` becomes `false` for each other human player.
- **Storage:** the server updates the `room` row.
- **Answer:** `broadcast()` with `room.state`.
- **Errors:** `NOT_HOST`.

### `room.addBot`

- **State:** Room `seats`: a new Seat with `isBot: true`.
- **Storage:** the server updates the `room` row.
- **Answer:** `broadcast()` with `room.state`.
- **Errors:** `NOT_HOST`, `ROOM_FULL`.

### `room.removeBot { seat }`

- **State:** Room `seats`: the server removes that Seat.
- **Storage:** the server updates the `room` row.
- **Answer:** `broadcast()` with `room.state`.
- **Errors:** `NOT_HOST`, `BAD_TARGET`.

### `room.loadout { entries }`

- **State:** Session `loadout`. Seat `loadout`. In `INFO_CHECK`, also Player `loadout`.
- **Storage:** the server updates the `session` row. In `INFO_CHECK`, it adds one `input` row.
- **Answer:** the reply only. The server sends no push.
- **Errors:** `BAD_MSG`, `BAD_TARGET`.

After `INFO_CHECK`, the Match refuses the loadout. The Session keeps it for the next Match.

### `room.start`

- **State:** a new Match with a new `seed`. Room `matchCount` increases by 1. The Match makes one Player for each
  Seat, the Pool, and the first phase (`INFO_CHECK`).
- **Storage:** the server adds one `match` row and updates the `room` row.
- **Answer:** in this order:
  1. `broadcast()` with `room.state` (`inMatch: true`)
  2. `send()` with `m.private` to each human player
  3. `broadcast()` with `m.public`
  4. reply `ok`
- **Errors:** `NOT_HOST`, `NOT_READY`, `RATE`.

## 6. Match messages

Each message in this section goes to `Match.handle()`. The two rules of section 3 apply. The line "Storage" has one
`input` row for each message that changes state. The lines "Errors" do not show `WRONG_PHASE` and `ELIMINATED`.

### 6.1 Before the first round

#### `g.infoReady`

- **Phase:** `INFO_CHECK`.
- **State:** Player `infoReady`. When each human player is ready, Match `deadline` becomes the current time, and the
  phase stops on the next timer.
- **Storage:** one `input` row.
- **Answer:** `broadcast()` with `m.public`.

#### `g.bandFocus { bandId? }`

- **Phase:** `BAND_DRAFT`.
- **State:** Match `draft`: the strategy that the player shows. The Match uses it only if the turn of the player
  stops on the timer.
- **Storage:** one `input` row.
- **Answer:** the reply only.
- **Errors:** `ALREADY`, `BAD_TARGET`.

#### `g.bandSkip`

- **Phase:** `BAND_DRAFT`, in a co-op match.
- **State:** Match `draft` (the skips, the turn) and `deadline`.
- **Storage:** one `input` row.
- **Answer:** `broadcast()` with `m.public`.
- **Errors:** `NOT_YOUR_TURN`, `ALREADY`.

#### `g.band { bandId }`

- **Phase:** `BAND_DRAFT`, in the turn of the sender.
- **State:** Match `draft` (the picks, the turn) and `deadline`. Player `bandId`, `lp`, and `effects`.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`. `broadcast()` with `m.public`.
- **Errors:** `NOT_YOUR_TURN`, `ALREADY`, `BAD_TARGET`.

### 6.2 The preparation of a round

#### `g.choice { idx }`

- **Phase:** `SP_DRAFT`, in the turn of the sender.
- **State:** Match `sp` (the cards that players took, the turn) and `deadline`. Player `effects`. The card can also
  change more properties of the Player (for example, `funds`, `hand`, or `nextEnemies`).
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`. `broadcast()` with `m.public`.
- **Errors:** `NOT_YOUR_TURN`, `ALREADY`, `BAD_TARGET`.

#### `g.unitStats { seq? }`

- **Phase:** `ROUND_START`, `SP_DRAFT`, or `PREP`.
- **State:** none.
- **Storage:** none.
- **Answer:** `send()` with `m.unitStats`.

The messages below are the shop messages and the board messages. The server accepts them in `PREP` only. After the
player is ready, the server refuses them with `WRONG_PHASE`.

#### `g.buy { slot }`

- **State:** Player `funds`, `shop`, `hand`, and `stats`. The Pool loses one copy of that operator. If the player
  now has three copies, the server merges them into an elite operator.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`. After a merge, also `broadcast()` with `m.ticker`.
- **Errors:** `NO_FUNDS`, `SOLD_OUT`, `HAND_FULL`, `BAD_TARGET`.

#### `g.refresh`

- **State:** Player `funds`, `shop`, and `stats`. The server takes the new shop from the Pool at random.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`.
- **Errors:** `NO_FUNDS`.

#### `g.freeze`

- **State:** Player `shop` (the `frozen` flag of the shop and of each slot).
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`.

#### `g.levelUp`

- **State:** Player `funds`, `shop` (`level`, `upgradePrice`), and `stats`.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`. `broadcast()` with `m.ticker` and with `m.public`.
- **Errors:** `NO_FUNDS`, `MAX_LEVEL`.

#### `g.sell { uid }`

- **State:** Player `funds`, and `hand` or `board`. If the operator was on the board, also `deployCount` and
  `bonds`. The items of the operator go back to `hand`. The copies go back to the Pool.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`. If the board changed, `broadcast()` with `m.public`.
- **Errors:** `BAD_TARGET`, `HAND_FULL`.

#### `g.reward { idx }`

- **State:** Player `shop` (the reward offer) and `hand`.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`.
- **Errors:** `BAD_TARGET`, `HAND_FULL`, `SOLD_OUT`.

#### `g.move { uid, to, dir? }`

- **State:** Player `hand`, `board`, `deployCount`, and `bonds`. A move to the same tile changes only the direction
  of the operator on `board`.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`. If the number of operators on the board or the bonds changed,
  `broadcast()` with `m.public`.
- **Errors:** `BAD_TILE`, `BOARD_FULL`, `HAND_FULL`, `BAD_TARGET`.

#### `g.equip { itemUid, targetUid, replaceUid? }`

- **State:** Player `hand` and `board`: the item goes from `hand` to the operator. The server removes an item that
  the new item replaces. Some items have their effect immediately and change more properties (for example, `funds`).
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`.
- **Errors:** `BAD_TARGET`.

#### `g.art { itemUid, row, col, dir? }`

- **State:** Player `hand` (the server removes the Art) and `effects`. The Art can also change more properties (for
  example, `nextEnemies`).
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`.
- **Errors:** `BAD_TARGET`, `BAD_TILE`.

#### `g.destroy { uid }`

- **State:** Player `hand` or `temp`: the server removes the item.
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`.
- **Errors:** `BAD_TARGET`.

#### `g.ready { ready }`

- **Phase:** `PREP`.
- **State:** Player `ready`. When each player that is alive is ready, `PREP` stops on the next timer (section 7).
- **Storage:** one `input` row.
- **Answer:** `send()` with `m.private`. `broadcast()` with `m.public`.
- **Errors:** `TEMP_NOT_EMPTY`.

### 6.3 The battles

#### `b.progress { battleId, gt, killed, total, … }`

- **Phase:** a battle phase. The server uses the message only if the sender is the authority of the Field.
- **State:** Field `progress`. In the boss phases, also Match `bossPool` and `teamLp`.
- **Storage:** one `input` row.
- **Answer:** no reply.
  - In `COMBAT` and `UNITE`: `broadcast()` with `m.public`.
  - In the boss phases: `broadcast()` with `b.pool`, a maximum of four each second. `broadcast()` with `m.public`,
    one time each second. If the pool is empty or `teamLp` is 0, `send()` with `b.end` to each human player on the
    Field.

#### `b.result { battleId, result }`

- **Phase:** a battle phase. The server uses the message only if the sender is the authority of the Field.
- **State:** Field `result`. The server first compares the result with the `spec`.
  - A correct result: the Field is complete.
  - An incorrect result in `COMBAT` or `UNITE`: the server simulates the battle itself.
  - An incorrect result in a boss phase: a different client or the server becomes the authority.
- **Storage:** one `input` row.
- **Answer:** the reply only. When each Field is complete, the phase stops on the next timer (section 7).

### 6.4 At all times in a match

#### `g.emote { id }`

- **State:** Player `lastEmoteAt`. It has no effect on the match.
- **Storage:** none.
- **Answer:** `broadcast()` with `m.emote`.
- **Errors:** `RATE` (a maximum of one each second).

#### `g.watch { fieldId }`

- **State:** Match `watchers`: the Field that the player shows. It has no effect on the match.
- **Storage:** none.
- **Answer:** In `PREP`: `send()` with `m.field` (the board of that player). In a battle phase: `send()` with
  `b.start` for that Field.
- **Errors:** `WRONG_PHASE` while the battle of the sender continues. `BAD_TARGET`.

#### `g.autoplay { on }`

- **State:** Player `autoplay`. With `on: true`, the AI plays the Seat immediately, and its actions change the
  Player.
- **Storage:** one `input` row.
- **Answer:** `broadcast()` with `m.public`.

#### `g.pause { on }`

- **Phase:** a battle phase of a solo match.
- **State:** Match `paused`. With `on: true`, the timers of the battle stop. With `on: false`, the server moves
  `deadline` and the clock of each Field by the time of the pause.
- **Storage:** one `input` row.
- **Answer:** `broadcast()` with `m.public`.
- **Errors:** `WRONG_PHASE` in a co-op match, or when no battle continues.

#### `g.leave`

- **State:** Seat `left`. Player `left`, `connected`, and `autoplay`. In a co-op match, Player `lp` becomes 0 and the
  player is out of the match. The Field of the player stops. If no human player stays, the Match stops.
- **Storage:** one `input` row. The server updates the `room` row.
- **Answer:** reply `ok` to the sender. `broadcast()` with `m.ticker`, `m.public`, and `room.state` to the players
  that stay.

## 7. State changes with no client message

The server also changes state on its timers. Each change below uses the two rules of section 3.

| Timer | State | Answer |
|---|---|---|
| A phase stops | Match `phase`, `round`, `deadline`. Each Player at the start of a round: `funds`, `shop`. | `send()` with `m.private`. `broadcast()` with `m.public`. |
| A battle phase starts | Match `fields`: one Field for each battle. | `send()` with `b.start` to each human player. |
| The turn of a player stops | Match `draft` or `sp`. The Player gets a default. | `send()` with `m.private`. `broadcast()` with `m.public`. |
| An AI player acts | the Player of that Seat, and the Pool. | `broadcast()` with `m.public`. |
| The authority sends nothing | Field `authority`: the server simulates the battle. | `send()` with `b.end` (`takeover`). |
| A round stops (`SETTLE`) | Each Player: `lp`, `funds`, `bonds`, `stats`. | `send()` with `m.private`. `broadcast()` with `m.public` and `m.ticker`. |
| The boss clock, each 250 ms | Match `teamLp`, `bossPool`. | `broadcast()` with `b.pool`. `send()` with `b.end`. |
| The match stops | Match `phase` (`RESULT`). Room: no match. | `send()` with `m.result`. `broadcast()` with `m.public` and `room.state`. |
| A Session is away too long | the effect of `g.leave`. | the answer of `g.leave`. |

The storage keeps no row for a timer. Each `input` row has its time. After a restart, the engine does the same
timers again between the inputs.

## 8. Method

Two tests on the real code gave the facts of sections 4, 5, and 6.

- **The match messages.** A test made a co-op match with two human players in the test harness of the project
  (`test/match/harness.js`). It sent each message one time. For each message, it recorded the calls of `send()` and
  `broadcast()`. It also compared the private state and the public state before and after the message.
- **The session messages and the lobby messages.** A test started the real server and connected two sockets. For
  each message, it recorded the messages that each socket got.

These facts come from the code only, not from a test:

- the effect of `g.pause`
- the effect of `g.watch` in a battle phase
- the `b.pool` and the `b.end` after `b.progress` in a boss phase
- the properties of the Pool
- the table of section 7
- the lists of error codes

The tests are not in the repository.
