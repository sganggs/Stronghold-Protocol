# Simulation slice permits

With room processes enabled, a positive `SP_SIM_PERMITS` from 1 to 64 enables an in-memory permit broker in that
supervisor. Unset or `0` leaves it disabled. Invalid values warn and disable it. The count belongs to one supervisor
instance, including its room children and their content process/worker hosts. Other server instances have independent
counts. Reading the environment outside a room supervisor does not configure a simulation gate.

## Cooperative slice hook

The existing bounded entry points call `runSimulationSlice` explicitly: finite-budget `HeadlessJob.run`, live
`FieldRunner` and `HeadlessPacer` pumps, and `RehearsalRun.run` with an external slice budget. The hook is unconfigured
by default and directly executes its callback. Room children and content hosts install their own remote permit
client only when their supervisor enables it. Nested work shares its caller's lease; no class prototype is replaced.
Synchronous tools retain direct execution and are outside this live cooperative scheduling contract.

An unavailable permit returns false without executing a slice. Existing intervals or continuations retry. Acquisition
and release errors do not throw into the job and cannot skip its reschedule. This bounds concurrent selected slices,
not CPU time, memory or arbitrary plugin code. JavaScript already inside a slice is not interrupted. A battle step
or candidate build remains indivisible, just as under the current wall-clock slice budget; throttling can delay combat
completion. A throttled bot rehearsal can reach its prep deadline and keep its default layout, as it can on a slow CPU.

## Broker and IPC lifecycle

The primary records each lease by slot generation, executor identity and request generation. A room process and each
content host have one executor identity. A worker thread uses its room's process ID for liveness but a distinct
executor identity. Acquisitions are non-waiting; one owner cannot accumulate multiple grants. Messages travel over
the existing private room and content-host IPC channels, including sandbox content hosts. After a denial, transport
failure or expired claim, the client delays its next IPC acquisition by 25, 50, 100 and then at most 200 ms. Local
continuations can keep polling during that interval; consuming a grant resets the delay. This backoff bounds retry
traffic under saturation but does not guarantee FIFO fairness.

An unclaimed acquisition has a one-second timer in the primary, so a lost reply or blocked client cannot retain it
indefinitely before its local timer even starts. Begin atomically checks that the exact lease still exists, clears
this broker timer and claims it. Begin also checks a monotonic deadline, so a delayed expiry callback cannot make an
expired grant valid. An expired begin is denied; the client cannot execute that slice. A timer callback
already queued before begin also checks the active state and lease generation before reclaiming anything.

The local client holds at most one pending request and one unused grant. A one-second timeout resets waiting and
cancels only that request generation. Late replies return their obsolete lease and cannot release a replacement.
An acquired grant must receive an exact-lease begin acknowledgement before it can run. The broker marks a claimed
lease active and ignores cancellation of that active lease, even for the same request generation. An unused grant,
including a claim awaiting acknowledgement, returns after one second. The acknowledgement and slice entry also check
the local monotonic deadline. A claim timeout or unused-grant expiry invalidates
its continuation and sends exact-lease completion because no slice started; a late acknowledgement can never make
that obsolete lease runnable or release its replacement. Once a slice consumes a ready grant, its idle timer is
cleared. While its room broker is alive, a running lease has no expiry timer and remains held until completion or
confirmed executor exit. Transport failure
while sending a cancellation or release retires that executor's channel so it can recover through normal failure
handling.

Stopping a content host closes its permit peer immediately, ignoring buffered acquire/release messages, but retains
any active lease until the actual process/worker exit event. Permit-enabled room shutdown terminates and awaits every
content host, including hosts already removed from the active map during termination. A room's IPC failure or requested
termination is insufficient to reclaim a potentially active independent content process. After the room actually exits,
the primary retains that executor's lease and checks once per second; `ESRCH` confirms its absence. A 30-second orphan
deadline also reclaims it when liveness remains ambiguous, including zombies and reused PIDs. The deadline is checked
by a dedicated timer and during pruning; event-loop stalls can delay cleanup. This recovery bound applies only after
the room broker exits. An independent executor that survives beyond the orphan deadline can overlap a replacement
slice; the permit is an application scheduling bound, not process isolation. A successful actual-exit notification
releases the specific executor earlier. All releases are idempotent and check their owner and lease generation.

Broker state and its normal operations use in-memory maps and private IPC. `/healthz.simulationPermits` appears only
when enabled, with `limit`, `held` and
`orphaned`. Shutdown stops the children before disposing the broker.

## Verification

Unit coverage checks independent brokers, wrong-owner and stale releases, conservative orphan liveness, synchronous
transport failure, bounded retry backoff, waiting timeout, late replies, deadline checks under delayed callbacks,
unused-grant expiry, active-lease retention, bounded orphan recovery, all four slice hooks
and nested calls. Separate real executor processes contend for one permit; content process/worker tests hold an
actual running slice across a delayed termination request and verify release only after exit. An independently
launched executor stays alive after its broker process is killed, exercising conservative reclamation against real
process liveness. The room-process suite can also run with `SP_SIM_PERMITS=1` to cover actual room/content-host IPC.
Each acquired slice adds acquire and begin/claim request/reply exchanges plus a completion message; content hosts
forward those exchanges through their room process. This IPC cost and waiting time are opt-in. Golden results and
browser simulations verify that the default direct path keeps existing outcomes.

`node tools/measure-simulation-permits.mjs` runs a finite two-hop JSON-IPC fixture using the production broker,
client and peer modules. Four executors poll every millisecond through a relay. The saturation comparison holds one
active permit and compares immediate retry with the configured 25–200 ms backoff. The lag comparison inserts a
250 ms synchronous relay stall after each positive grant and compares 100 ms and 1000 ms broker windows. Both
controls configure the same modules through their options; the runtime uses backoff and a 1000 ms window.

The output includes request counts and rates for both hops, grant-to-begin ages, accepted claims, completed slices,
child exit results, logical core count and observed system CPU load. Rates include requests already in flight when
polling stops. The campaign makes one observation per condition and measures synthetic retry traffic and claim
acceptance. Deadline unit tests cover delayed timer callbacks separately. Longer stalls can still expire grants and
retry through backoff.
