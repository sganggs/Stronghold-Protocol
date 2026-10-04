# Events on the socket

This document shows the messages that the client and the server send during a match. The order is the order of a
match. It is the map for a new socket backend (the planned Cloudflare Worker) that the client can use without a
change.

The rules are in the original project. If this document and a source below are different, the source is correct.

- `shared/protocol.js` has each client message with its field checks (`C2S`) and the list of the server messages (`S2C`).
- `docs/DESIGN.md` has the protocol in section 8 and the client-side combat in section 14.
- `public/js/net.js` shows how the client connects, tries again, and resumes a session.

The sizes and the counts in this document come from two full matches. The section
[Measured traffic](#measured-traffic) shows the method.

## 1. Message rules

- The client opens one socket (a WebSocket) for each tab, at `/ws` of the origin of the page.
- The socket carries text frames only. Each frame holds one JSON message: `{ "t": "<type>", … }`.
- **Request and reply.** A client message can have a `rid` (an integer). Such a message is a request. The server
  sends one reply for each request: `ok { rid }` or `error { rid, code, msg, detail? }`. The client waits 8 s for the
  reply. Then the request fails.
- **Push.** A server message without a `rid` is a push: the client did not ask for it. Most of the traffic is pushes.
- **Limits for the client.**
  - A message has a maximum size of 64 KB.
  - A socket can send 40 messages each second. The server discards the excess and sends `error RATE`.
  - The messages `g.watch`, `room.loadout`, and `room.spectate` also have a lower limit: 2 each second.
- **Heartbeat.** The client sends `ping { c }` one time each 4 s. The server sends `pong { c, s }`, where `s` is the clock of
  the server in milliseconds. If the client gets no message for 15 s, it closes the socket and connects again. If a
  socket sends no `hello` for 30 s, the server closes it.
- **Close codes.**
  - `4001`: a different tab connected with the same `token`. The client must not connect again.
  - `4002`: the socket sent no `hello` in time.
  - `1008`: the socket sent too many messages.
  - `1001`: the server stops.
- **Trust.** The server makes each decision itself. The one exception is the result of a battle. The server compares
  that result with the description of the battle (section 3.6).

## 2. The receivers of a server message

| Receiver | Description | Messages |
|---|---|---|
| **one** | The server sends the message to one player only. | `m.private` `m.result` `m.toast` `m.unitStats` `m.field` `b.start` `b.end` `welcome` `pong` `ok` `error` |
| **all** | The server sends the message to each connected human player of the room, and to each connected spectator. | `m.public` `m.ticker` `m.emote` `b.pool` `room.state` |

A spectator has a spectator seat of the room (section 3.3). It is not a player. It gets each message for **all**. As
**one**, it gets only `m.public`, `m.field`, `b.start`, `b.end`, and `m.result`. It never gets `m.private`.

A disconnected player gets no messages. When the player comes back, the server sends the full state again
(section 3.8).

## 3. The order of a match

### 3.1 The page loads

The client opens the socket before it shows the title screen. The client has no player name at this time. Thus the
socket carries the heartbeat only.

- From the client to the server: `ping { c }`
- From the server to the client: `pong { c, s }`

### 3.2 The player enters

The player enters with the 开始 button. When the page loads again, the player enters automatically.

- From the client to the server: `hello { name, token?, version? }`. The `token` comes from an earlier `welcome`. The client keeps
  it. With the `token`, the client asks for the earlier session.
- From the server to the client: `welcome { playerId, token, name, serverNow, version, resumed }`
  - `resumed: true`: the server found the earlier session. Then the server sends `room.state`, and the match sends its
    state again.
  - A new `playerId` while the client shows a room: the server lost the session (for example, after a restart). The
    client shows “服务器会话已重置，上一局模拟已结束” and goes back to the lobby.

### 3.3 The lobby and the room

Each client message in this section is a request. The server sends `ok` or `error` for each one.

From the client to the server:

- `room.create { mode: "solo" | "coop", difficulty }`
- `room.join { code }`. The client also sends it automatically for a `?room=CODE` link.
- `room.leave`
- `room.ready { ready }`
- `room.setDifficulty { difficulty }`, from the host only
- `room.addBot`, from the host only
- `room.removeBot { seat }`, from the host only
- `room.kick { seat, playerId }`, from the host only, before the match. It removes a different human player.
  `playerId` is the player that the host saw in that seat. If a different player has the seat now, the server refuses
  the request. The removed player can join again with the code.
- `room.spectate { code }`: the sender takes a spectator seat of a co-op room. The room can be in the lobby or in a
  match. A room has two spectator seats.
- `room.removeSpectator { playerId }`, from the host only, at all times
- `room.start`, from the host only
- `room.loadout { entries }`: the skills and the modules that the player selected. The client sends it after each
  `welcome` and after each change.

From the server to the client:

- `room.state { code, hostId, mode, difficulty, inMatch, seats, spectators }` to **all**, after each change. `seats`
  has four entries. Each entry is `{ seat, playerId, name, isBot, ready, connected }` or `null`. `spectators` has zero,
  one, or two entries. Each entry is `{ playerId, name, connected }`.
- `room.closed { reason }`:
  - `timeout` to **one**: the server removed the player from a lobby room while the player was away.
  - `kicked` to **one**: the host removed the player (`room.kick`) or the spectator (`room.removeSpectator`).
  - `empty` to each spectator: the last player left the room.
  - `shutdown` to **all**: the server stops.

A spectator can send only these messages: `g.watch`, `g.leave`, `room.leave`, `room.loadout`, and `room.join` with the
code of its room. The server answers each other message with `error SPECTATOR`. `room.join` gives the spectator a
free player seat while the room is in the lobby.

`room.start` makes the match. The server sends `room.state` with `inMatch: true`. Then the match sends the first
`m.public` and the first `m.private`.

### 3.4 Before the first round

Two messages describe the match. The server sends each of them again when it changes.

- `m.public` to **all**: the full state that all players see (for example, the phase, the round, and the deadline).
  The server sends a maximum of 10 each second.
- `m.private` to **one**: the state of that player only (for example, the funds, the shop, and the board). The server
  sends it only when it changed.

The client does not change its own state after a request. It waits for the next `m.private` or `m.public`.

| Phase | From the client to the server | From the server to the client |
|---|---|---|
| `INFO_CHECK` | `g.infoReady`; `room.loadout` | `m.public`; `m.private` |
| `BAND_DRAFT` | `g.band { bandId }`; `g.bandFocus { bandId? }`; `g.bandSkip` | `m.public` with `draft`; `m.private` |
| `BATTLE_CHECK` | none | `m.public` |

- `room.loadout`: the server accepts it for the last time in `INFO_CHECK`.
- `g.bandSkip`: a co-op match only.
- `draft` shows the state of the draft (for example, the order and the turn).
- `BATTLE_CHECK` continues for 3 s.

### 3.5 Each round: the preparation

| Phase | From the client to the server | From the server to the client |
|---|---|---|
| `ROUND_START` | `g.unitStats { seq? }` | `m.private`; `m.public` |
| `SP_DRAFT` | `g.choice { idx }`; `g.unitStats` | `m.public` with `sp`; `m.private` |
| `PREP` | the shop messages; the board messages; `g.ready { ready }`; `g.unitStats`; `g.watch { fieldId }` | `m.private`; `m.public`; `m.ticker`; `m.toast`; `m.unitStats`; `m.field` |

- In `ROUND_START`, `m.private` has the income and the new shop.
- `SP_DRAFT` occurs in some rounds only. `sp` shows the state of the card draft.

The server accepts the shop messages and the board messages in `PREP` only. After the player is ready, the server
refuses them with `WRONG_PHASE`.

The shop messages:

- `g.buy { slot }`
- `g.refresh`
- `g.freeze`
- `g.levelUp`
- `g.sell { uid }`
- `g.reward { idx }`: the free pick after a merge

The board messages:

- `g.move { uid, to, dir? }`. `to` is `{ area: "board", row, col }` or `{ area: "hand", idx }`.
- `g.equip { itemUid, targetUid, replaceUid? }`
- `g.art { itemUid, row, col, dir? }`
- `g.destroy { uid }`

The pushes of this section:

- `m.ticker { text, id, type, priority, playerId }` to **all**: one line of the news strip (for example, a shop
  upgrade or an elite operator).
- `m.toast { kind, text }` to **one**: a short notice.
- `m.unitStats { seq, round, units }` to **one**: the answer to `g.unitStats`. It is a push, and it has the same
  `seq`.
- `m.field { fieldId, kind, rect, stageId, units, prep: true, nextEnemies }` to **one**: the board of a different
  player, after `g.watch`. The server sends it again each time that board changes, until the battles start.

### 3.6 Each round: the battles

The clients do the battles. Each battle occurs on a field. In `COMBAT`, the field of a player is the board of that
player.

The server describes each battle. One client simulates the battle and sends reports. That client is the authority of
the field. The server checks the result.

The battle phases are:

- `COMBAT`
- `UNITE`
- `FINAL_ASSAULT`
- `HIDDEN_CORE`

The last two are the boss phases.

From the server to the client, at the start of a battle phase:

- `b.start { battleId, fieldId, kind, spec, authoritative, startAt, serverNow, elapsed, speed, watch, done }` to
  **one**
  - `spec` is the description of the battle as JSON (for example, the units, the enemies, and the seed).
  - `authoritative: true`: this client is the authority of the field.
  - `authoritative: false`: this client only shows the battle.
  - This message is the largest of a match. Its maximum size was 12 KB in the measured matches.

From the client to the server, from the authority only:

- `b.progress { battleId, gt, killed, total, leaks?, left?, bossDmg?, by?, done? }`. The authority sends it one time
  each second. In the boss phases, it sends it four times each second. The message has no `rid`, and the server
  sends no reply.
- `b.result { battleId, result }`. The authority sends it one time, at the end of the battle. Its average size was
  2.4 KB, and its maximum size was 5.2 KB.

From the server to the client, during a battle:

- `m.public` with `fields[].progress`: the progress of each field, for the other players.
- `b.end { battleId, fieldId, reason }` to **one**:
  - `takeover`: this client is no longer the authority. It stops its reports and continues to show the battle.
  - `cleared` or `forced` (the boss phases only): the client stops its battle and sends the result.
- `b.pool { hp, max, teamLp, acked }` to **all**, in the boss phases only. It has the HP of the boss and the life
  points of the team. The server sends a maximum of four each second.

If the authority is too slow, sends nothing, or disconnects, the server simulates the same `spec` itself. If a
result does not agree with its `spec`, the server discards it and simulates the battle itself.

| Phase | The authority | Notes |
|---|---|---|
| `COMBAT` | each connected human player, for the field of that player | One battle for each player, all at the same time. |
| `UNITE` | the connected human player with the lowest seat on the field | A co-op match only, when a player let enemies through. Each human player gets `b.start`. |
| `SETTLE` | none | The server sends `m.private`, `m.public`, and `m.ticker` with the result of the round. |
| `FINAL_ASSAULT`, `HIDDEN_CORE` | the connected human player with the lowest seat of each pair | The server sends `b.pool`. It sends `m.public` one time each second. |

- `g.watch { fieldId }`: the server refuses it while the battle of the player continues. After that battle, the
  server sends a `b.start` for that field. The client then only shows the battle.
- `g.pause { on }`: it stops the clock of a battle in a solo match, in each battle phase. A co-op match refuses it.

### 3.7 The end of the match

- From the server to the client: `m.result { victory, roundsPassed, reason, teamLp, players, … }` to **one**. Each human player
  gets its own result.
- From the server to the client: `m.public` with `phase: "RESULT"` to **all**.
- The room goes back to the lobby. The server sends `room.state` with `inMatch: false`.

### 3.8 At all times in a match

- From the client to the server:
  - `g.emote { id }`, with a maximum of one each second
  - `g.autoplay { on }`: the AI plays this seat
  - `g.leave`: the player leaves the match permanently
- From the server to the client: `m.emote { playerId, id }` to **all**

**A socket that closes.** The server keeps the seat:

- for 10 min in a co-op match
- for 24 h in a solo match
- for 60 s in a lobby room

When the player comes back, the client sends `hello` with its `token`. The server sends these messages:

- `welcome { resumed: true }`
- `room.state`
- `m.public` and `m.private`
- `b.start`, if a battle continues

A spectator that comes back gets `welcome`, `room.state`, and `m.public`. If a battle continues, it also gets the
`b.start` of the field that it watches. That `b.start` does not have the funds of the players.

## 4. Errors

The message is `error { rid?, code, msg, detail? }`. `msg` is the Chinese text that the client shows. The codes are:

```
BAD_MSG  RATE  NOT_IN_ROOM  ROOM_NOT_FOUND  ROOM_FULL  ROOM_STARTED  NOT_HOST  NOT_READY  WRONG_PHASE
NO_FUNDS  HAND_FULL  BOARD_FULL  BAD_TILE  BAD_TARGET  SOLD_OUT  MAX_LEVEL  NOT_YOUR_TURN  ALREADY
TEMP_NOT_EMPTY  ELIMINATED  INTERNAL
```

## Measured traffic

The numbers come from two matches with a fixed seed. The test harness of the project (`test/match/harness.js`) ran
each match to the result screen. The matches used the real engine and real battles, in virtual time.

Two conditions of the test change the numbers:

- The human players were on auto-play. Thus the client rows have no shop messages and no board messages. They have
  the battle reports only.
- In virtual time, an authority sends one `b.progress` for each battle of a normal round. In real time, it sends one
  each second.

In the tables, a message to **all** counts one time.

**Co-op match: 2 human players and 1 AI player, difficulty 险境 (`NORMAL`), 14 rounds, a victory.**

| Message | Count | Average | Largest |
|---|---|---|---|
| `m.private` to one | 161 | 4.6 KB | 7.1 KB |
| `m.public` to all | 152 | 4.2 KB | 5.6 KB |
| `b.start` to one | 44 | 7.4 KB | 12.0 KB |
| `b.pool` to all | 91 | 115 B | 121 B |
| `m.ticker` to all | 49 | 119 B | 132 B |
| `m.toast` to one | 3 | 52 B | 52 B |
| `m.result` to one | 2 | 7.3 KB | 7.3 KB |
| `b.end` to one | 2 | 71 B | 71 B |
| **from the server to the client, total** | **504** | | **1.66 MB** |
| `b.progress` | 122 | 158 B | 183 B |
| `b.result` | 33 | 2.4 KB | 4.6 KB |
| **from the client to the server, total** | **155** | | **0.09 MB** |

**Solo match: difficulty 绝境 (`HARD`), 14 rounds, a victory.**

| Message | Count | Average | Largest |
|---|---|---|---|
| `m.public` to all | 168 | 2.1 KB | 2.8 KB |
| `m.private` to one | 81 | 4.1 KB | 6.2 KB |
| `b.pool` to all | 353 | 94 B | 96 B |
| `b.start` to one | 14 | 6.4 KB | 10.0 KB |
| `m.ticker` to all | 11 | 120 B | 121 B |
| `m.toast` to one | 5 | 52 B | 52 B |
| `m.result` to one | 1 | 2.3 KB | 2.3 KB |
| `b.end` to one | 1 | 71 B | 71 B |
| **from the server to the client, total** | **634** | | **0.77 MB** |
| `b.progress` | 377 | 154 B | 160 B |
| `b.result` | 14 | 2.5 KB | 5.2 KB |
| **from the client to the server, total** | **391** | | **0.09 MB** |

The numbers show these facts:

- **The server sends much more than the client.** Most of it is `m.public` and `m.private`. Each one is a full state
  of 2 KB to 7 KB. The protocol has no partial updates.
- **Each message is small.** The largest was 12 KB (`b.start`), much less than the limit of 64 KB.
- **The server sends pushes at its own times.** Examples are a phase change on a timer, an action of a different
  player, and the boss pool. A backend that can only send replies cannot do this protocol.
- **The boss phases have the most traffic.** `b.progress` comes in four times each second, and `b.pool` goes out four times each second.

## Messages that the default mode does not use

`b.snap` and `b.ev` occur only with `SP_COMBAT=server`. In that mode, the server simulates the battles and sends them
at 20 Hz. The default mode is client-side combat. A new backend does not need these two messages.
