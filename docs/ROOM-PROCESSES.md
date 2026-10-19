# Optional room processes

`SP_ROOM_PROCS` defaults to `1`, which runs the existing HTTP, session, lobby and match stack in the current process.
Values `2`–`32` start that many room children behind the same HTTP listener. An empty, non-numeric or out-of-range
value logs a warning and uses `1`. One room and its match stay in one child, retaining the existing game rules and
simulation.

## Ownership and communication

The primary owns reconnect identities, the room directory, placement reservations, aggregate connection admission
and per-network room/match admission. Children keep local session replicas for the lobby and match APIs. Named
session-authority, message-dispatch and change-observer hooks default to the current in-process behavior.

Session and room changes enter a coalescing publisher. Each IPC update contains only dirty identities and room
summaries, plus removals. Applied intents and welcome are answered independently of the publisher, which retries
failed delivery.
Socket-close events use ordered one-way IPC outside the bounded request queue. Placement and match-start completion
piggyback pending and in-flight changes and are acknowledged before the client can start another admission on a
different child. They bypass the ordinary request cap and retain a timeout; a failed completion invalidates the
slot without rewriting an applied intent's result. Channel failure releases the slot's admissions, and ordinary
request saturation cannot drop admission cleanup. Queries retain bounded request/reply timeouts.

The next placement request also carries dirty and in-flight source changes before its directory lookup and room-limit
checks. A completed leave can therefore grant replacement credit immediately while ordinary publication stays asynchronous.
Rollback waits for a critical target-cleanup acknowledgment containing its pending changes before answering the source.
This removes even an already published target room from admission counts. Cleanup has a ten-second deadline within the
source's fifteen-second completion budget; failure retires the target without rewriting the source intent's result.

A closed peer ignores subsequent deliveries from that child generation. Placement receipts expire after 30 seconds;
uncommitted transfers roll back, and accepted disconnected members use the existing lobby/reconnect grace. Pending
match-start admission is kept separately from room summaries. Completion sends the room's running state together
with release of that admission, so a delayed directory update cannot open a gap in the global match limit.

## Sockets and routing

Only `/ws` upgrades are handed off. The primary pauses the socket, drains its readable buffer and includes those
bytes with the HTTP parser's upgrade head. The handoff adapter uses the socket handle's `reading` / `readStop`
controls to stop native reads immediately before IPC detachment. The child owns the normal handshake, game frames,
payload checks, compression, heartbeat and backpressure handling. Each upgrade holds admission until socket close,
missing-handle notification or child exit. Per-slot and per-network counters are updated once on admission and
release. A saved route uses its ready, accepting slot; otherwise one pass over the slots selects the lowest
connection count. Intentional stops and restarts are excluded throughout their exit wait.

`room.route {slot, retry?}` selects the same origin with a `roomSlot` query. The browser preserves only an exact
matching outstanding request when a route explicitly requests a retry. A reconnect token resolves to its owning
child. A transfer first admits a disconnected member on the target, then obtains acknowledgment of a provisional
primary ownership transition while retaining the source seat. Rejection, an expired acknowledgment, a changed source
socket, a newly started source match or lost replacement credit rolls back target admission and source ownership.
Hello waits on this bounded completion barrier rather than adopting a provisional identity; child failure, rollback,
completion, receipt expiry and shutdown settle it. Receipts name both child generations so stale replies cannot
change a later owner's state. After successful rechecks the source leaves, completes admission, and answers the
accepted request before sending the route. That route carries no retry because target admission already applied the
intent. The acknowledgment's `routeSlot` hint makes the client reconnect while holding the accepted result; its
request promise resolves only after destination welcome, and queued later intents use that destination. An accepted
intent is applied once. Socket identity checks discard late frames from the source; close, hello error and the
original request timeout settle held results through the normal pending-request policy. A later target failure uses
the existing shutdown/reconnect recovery for an accepted entry.

The HTTP listener forwards child-owned `/cs/` and `/vs/` files to the child holding the set, including conditional
and HEAD requests. A directory miss queries only ready child generations through their public set managers, so a new
content URL works before ordinary publication arrives. Misses for the same kind/hash share work, with at most four
concurrent distinct lookups and a one-second deadline per child. Locally held sets use the primary handler; unknown
sets retain its 404, and a busy or unavailable lookup returns 503 without invalidating a responsive child. Miss results
are discarded so later requests can find a newly created set. Child script and test-mode gates use the primary's bound address. Trusted server extensions
activate once in the primary; the room/player/match-start events from children reach that runtime over IPC.

## Health and shutdown

A failed child releases its directory entries, admissions and reservations. Only active seated or spectating members
receive a pending shutdown notice. Its slot restarts automatically, initially after 100 ms, doubling to a maximum of
5 seconds. Thirty seconds of healthy uptime resets its consecutive-failure count. If every slot fails six times
without staying alive, the primary stops listening and exits nonzero. The primary schedules probes once per second,
with at most one outstanding probe per ready, accepting child. Each probe has a five-second deadline. Three
consecutive failed or non-ready replies retire the child and start the same recovery path; a successful ready reply
resets that slot's miss count.

`/healthz` reports `roomProcesses.requested`, `ready` and per-slot readiness, connection count, drain/restart status,
failure count, consecutive `healthMisses`, last exit and successful probe time. With no ready child it reports
`ok: false` and HTTP 503 while recovery runs.
Room, match, member, connection and active-content-set counts are aggregated. Detailed traffic and match-host
diagnostics remain process-local.

An initialization rejection retires and stops that replacement generation before retrying the slot. Shutdown and
intentional child exits do not create replacement processes.

`roomSupervisor.drain(slot)` excludes a child from new-room placement and persists across crash recovery and manual
replacement. `restart(slot, {force})` refuses live rooms unless forced and restores its previous drain state on refusal.
It waits for exit before replacing the child and preserves an undrained slot's ordinary placement policy. A
saved route to a dead slot falls back to a ready child and retains the reconnect identity. Group SIGINT / SIGTERM
are ignored by children on systems that deliver catchable signals; the primary drains rooms with
`room.closed {reason:'shutdown'}` and WebSocket close code 1001, then stops the children and HTTP listener. Listener
shutdown uses public close methods and a bounded local-connection grace after every receiving child has exited.

## Limits and verification

This is a single-supervisor, single-host process model. Room state stays in memory; a failed child ends its rooms.
Each child initializes its own data and plugin views, increasing boot time and memory. After installed plugin changes,
drain and restart affected slots to load them. Multi-process startup accepts
JSON-serializable options; injected constructors and seed functions are rejected.

The purpose is to separate rooms' event loops. Useful process counts depend on CPU, memory and workload.
Real-socket tests cover immediate hello bursts, the HTTP upgrade
head and an explicitly populated paused Socket readable buffer, cross-slot admission, joins, spectators, reconnect
identities, aggregate limits, stale generations, plugin HTTP access, drain, child replacement and fatal crash loops.
Lifecycle and publisher tests cover a saturated request queue, coalescing, retry after failed delivery, persistent drain,
intentional-stop routing, exact admission accounting and consecutive health misses. The tests exercise the production
IPC and socket paths.

`node tools/measure-room-processes.mjs --heavy 4 --light 2 --duration-ms 60000` compares one process with two room
processes. Seeded four-bot HARD matches run through the production Match API with headless combat, eight rehearsal
candidates, 10 ms slice budgets and phase timers scaled to 5%. Light rooms use the real lobby and repeatedly change
difficulty over WebSocket. In the two-process case the heavy matches share one child and the light rooms use the
other. Tool-only IPC instrumentation is preloaded into the children; the server's normal startup is unchanged.

The output includes the light rooms' event-loop delay and operation latency at p50/p99, sample counts, match progress
and errors, logical core count, system CPU load and N=2/N=1 ratios. It makes one observation per condition. Placement,
phase mix, timer resolution and competing CPU load affect the ratios; this fixture measures that placement's isolation.
The cause of a higher median operation latency with two processes has not been isolated.
