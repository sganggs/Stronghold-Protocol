# AI handover revision for 0.3.2 — PR #691 (§35.100)

Accepted by the maintainer on 2026-10-24 with a host room toggle defaulting to off. The host can change it before play; disabled rooms omit the option and votes from their state and refuse takeover requests. Five interface languages include the setting and help. No official combat/data rule changes.

- The original server is one room of at most four players. All online, non-autoplay human room teammates vote;
  the downstream fork's multi-group wording does not apply. If no eligible teammates remain, the online host decides.
- [ASSUMED] Requests are bound to one match, round and electorate. A spectator leaving/disconnecting, target AI
  elimination, voter eligibility changes (including disconnect, reconnect and autoplay), expiry, phase/round changes,
  match end or disposal cancels the request. Every removal clears its timer. No automatic approval when voters leave.
- [ASSUMED] Keep inherited seat ID, funds, inventory and accumulated seat metrics. Bind the applicant's original
  token to that seat; remove the old spectator/session ID and resynchronize via the ordinary welcome/reconnect flow.
  The result and reconnect snapshots carry `aiTakeoverRound`. A takeover is not a fresh game under another name.
- [ASSUMED] Preserve inherited matches as marked local history, including earlier AI performance, but exclude the
  inheritor's record from personal aggregates, peak layers and strategy achievements. Award no personal title,
  trophies or reward for that inherited seat; other players are unaffected. This conservative attribution policy is part of the accepted remake-only option. The request panel and result details explain it; metadata survives history export/import.
- Default-version vanilla co-op rooms only; isolated gameplay-plugin and historical-version matches remain unsupported. Test-room
  acknowledgement and host-only test powers remain unchanged.

Verification: lifecycle WebSocket tests, result/history attribution, token/socket binding, result replay and reconnect;
existing stats regressions; real browser request/approval/reload; current upstream dev integration checked separately.
The PR reports exact executed commands and results, and does not claim a complete CI pass without evidence.
