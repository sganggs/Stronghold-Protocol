# SIM.md — battle simulation engine reference (server/sim)

Audience: **content authors** (kits, bonds, garrisons, items, bands, enemies, bosses, devices, choices) and the
**match owner** who drives `Battle`. The normative contract is DESIGN.md §5 ([design/engine.md](design/engine.md));
this file documents the concrete implementation, every hook and helper, the SkillSpec schema with worked examples,
the profession defaults and the test harness. Everything here is deterministic: the only randomness is `battle.rng()`,
and the only floating-point functions are correctly rounded ones (`detmath.js` below), so a battle gives the same bits in
every browser and on the server.

```
server/sim/
  Battle.js        one field (normal / unite / boss / hidden) — the class: constructor, method install, public API
  battle/          Battle's methods by concern: players, lifecycle (start / step / end), hooks (bus, timers, callback
                   isolation), spawns, deploy, blocking, status (buffs, statuses), combat, queries (+ ranges), summons,
                   tiles (relocation, bodies, tactical points), displacement, economy (DP, layers, coins), events
  constants.js     TICK, MOVE_SCALE, ATTACK_PAUSE, element numbers, tuning knobs
  rng.js           mulberry32 PRNG (+ int/range/chance/pick/shuffle/weighted)
  detmath.js       hypot / powi / sin / cos / atan2 with the same bits on every engine — the sim never calls the
                   implementation-approximated Math functions (hypot, sin, cos, atan2, pow, ** …; lint + test enforce it)
  grid.js          stage grid, tile semantics, 8-dir A* (no corner cutting), obstacles
  units.js         Unit model + stat aggregation
  buffs.js         Buff model, mod keys, status catalogue
  damage.js        damage / heal pipeline, shields, dodge, element gauges
  targeting.js     range grids (rotated by the unit direction), target filters, priorities
  body.js          where a unit can be hit: huge units' hit rectangles — the helper of every range test on enemies
  dir.js           the 4 deploy directions: vectors, rotation, mirror (shared with server/match and browsers)
  projectiles.js   projectile flight & impact
  skills.js        SkillRuntime (SP, charges, triggers, kinds, SkillSpec)
  ai.js            operator attack loop, enemy route following / blocking / attacks
  fear.js          恐惧 movement of enemies: reachable-tile fan away from the source, random checkpoints, self-fear flutter
  professions.js   default behaviour per subProfessionId
  snapshot.js      wire format (UnitInfo, snapshot tuples, flags, anim codes)
  simdata.js       data access + normalisation (data/*.json, research fallback)
  content/index.js installContent / setupUnitKit / registerAllMeta
  content/enemies/ helpers.js, archetypes.js, one kit file per special type + leaders.js (content/enemies.js builds KITS)
  content/generic.js  generic kit from skill blackboards
  content/kits/index.js + kits/ops/*.js (one operator kit per file) + kits/shared/*.js,
  content/{tokens,bonds,garrisons,items,bands,enemies,bosses,devices,choices}.js  (content phase)
```

---

## 1. Driving a battle (match owner)

```js
import { Battle } from './sim/Battle.js';
const b = new Battle({
  seed, kind: 'normal' | 'unite' | 'boss' | 'hidden', modeId, round,
  stageId | stage,              // data/stages.json id or entry
  rect,                         // optional; defaults: normal rows 9–12 × cols 0–10, unite cols 0–20, boss rows 0–5 × cols 0–20
  timeLimit,                    // game seconds (the match passes 2 × the round's combatTimeLimit, which data gives in
                                // real seconds of the forced-2× battle — DESIGN §4); boss/hidden default Infinity (match force-ends)
  players: [PlayerBattleInput], // DESIGN §5.1
  spawns: [SpawnSpec], routes: [RouteSpec],
  sharedBoss,                   // { hp, maxHp, damage(playerId, amount) } or null
  flags: { layerGainsEnabled, dpInit: 10, dpPerSec: 1, dpMax: 99 },
  fieldId,                      // echoed in snapshots
  enemyOverrides,               // waves.json `overrides` ({ [enemyKey]: { stats: {…partial} } })
  // optional: data (DataSource or raw maps), content ('full'|'generic'|'none'), kits ({baseId: kitFn}),
  // extraContent ([{install(battle)}]), setup(battle) (runs after content install, before deployment),
  // recordEvents (default true), autoFinish (default true), logger, quiet, verbose, devices (false = no stage crates)
});
while (!b.finished) b.step();      // 1 TICK = 1/30 game s; live battles run at the forced 2× = 60 ticks per real second
b.snapshot();  b.drainEvents();   // every 3 ticks for watchers (§8.2 wire format)
b.result();                        // BattleResult (DESIGN §5.1) — see §1.3
b.forceEnd('forced' | 'timeout'); // 'timeout' converts remaining enemies to leaks
b.fieldMeta();                     // { fieldId, kind, rect, stageId, units: UnitInfo[] } for m.field
```

Construction creates every ally unit (not yet deployed) and installs content (kits, then domain modules). The first
`step()` (or `b.start()`) spawns stage crates, deploys all board units for free — per player the **operators by column, the
left column first, top to bottom within a column** (right boss side: from its own left, the highest field column),
**then the summon pieces** the same way (PRTS 卫戍协议/帮助 "按从上到下>从左到右的顺序部署。优先部署干员，随后为召唤物", a
scan down each column — the 阿戈尔 devour's "更靠左和靠上"; row-major until 0.1.3; a skill's summon — 赫默's 医疗探机, 巫恋's
诅咒娃娃 — included, once, free: content/tokens.js `dockSkillSummons` / `releaseSkillSummon`, user playtest #6) — except a
summon piece content flags `deferDeploy` (one its owner's loadout does not make, e.g. 赫默 on S1; with
`SKILL_SUMMON_START_DEPLOY` off also a skill's summon, which then waits on its reserved tile until the skill gives
one) — firing `deploy {initial:true}` for
each, forces out the operators that enter knocked out (`carryState.down`, 联防 — §1.1), then fires `battleStart`. Every
summon that came in during the initial deployment (also one an operator's deploy brought along) then ranks after all
the operators in the aggro order (`unit.aggroSeq`, §1.2). On a shared field (联防, the boss field)
the players' fields deploy side by side: the i-th operators of all players come in together (in `players` order), then
the summons the same way, and the summons rank after the operators of all players **[ASSUMED]** (PRTS describes one
field — units deploy one after another with a fixed delay from the battle start — and "两处阵地将前后拼接为一处阵地"). Register hooks before the first step (e.g. `opts.setup(battle)` or right after `new Battle`).

**Tick order:** scheduled callbacks → spawns → DP → buffs (+HP regen) → enemies (attack, move, block) →
enemy tile index → allies (skill tick, attack) → projectiles → auto-redeploys → boss pool sync → `tick` hook →
release hooks/timers of units removed this tick (§1.4) → `time += TICK` → end checks.

**Knocked-out operators** (PRTS 卫戍协议/帮助 §作战阶段 单位部署; player report F5 after 0.1.0): "干员退场后…原地留下一个
“倒地干员”…满足再部署条件时，移除场上的该倒地干员并自动部署至该位置" — an operator knocked out (`isDown`) lies on the tile it
fell on (`unit.body`, `Battle._layBody`; b.snap `down` carries it) and its redeploy — the timed one (`_checkRedeploys`:
timer done, tile free, DP ≥ cost), 不屈's, 阿戈尔's — comes back there (`restTile`); "若干员被击倒的位置为其他干员或召唤物的
初始位置，则在被击倒后，尝试返回其自身的初始位置": one that fell on another board piece's home (a 突袭 member after its jump,
乌尔比安 off his anchor; the piece on the field or not — a summon leaves its home free only once it has expired or been
killed) lies on its own home instead when that is free (else it stays [ASSUMED: one attempt]); x / y / tileR / tileC keep
where it fell for the `kill` / `death` handlers. One deliberate deviation, the owner's decision of 2026-10-07 (community
report 28): 乌尔比安 knocked out while his S3 has moved him lies on his deployment tile (his home) wherever he fell, when it
is free (`Unit.downAtHome`, set by his kit for that 【移动】, cleared by the return and by every deployment; DESIGN §25.17.3). "倒地干员所在地块视为可部署，但所有我方单位在此处的部署
行为将被阻止": `downOn(r, c)` — `_deploy` (redeploys, the 突袭 landing, summons), `spawnDevice` and `relocate` refuse that
tile and `isReservedTile` reports it, so every automatic picker skips it. The rule covers every 退场 (GitHub #60): an
operator forced out by its own effects (`retreat` reason `'retreat'`: 史尔特尔's 余烬, 耀骑士临光 S2, 骑士戒律 + 竞技旗,
伊内丝 S3; `'merchant'`: a 商人 that cannot pay) lies down and comes back the same way — still no kill (its death reason is
not `'killed'`: no 被击倒 effects, 阿戈尔 or knock-down count — except Touch's 超脱 on a `dying` exit, a knock-out put off
by the operator's own effect that plays its death animation: 史尔特尔's 余烬, 骑士戒律 + 竞技旗; PRTS Touch(卫戍协议) 备注
"部分有死亡动画的强制撤退（如史尔特尔的天赋效果）也能触发这一天赋"), but 不屈 rolls on it (PRTS 盟约记录 不屈 修正 "被击倒、撤退、
切换<替身>与<本体>时": a hit redeploys it at once, free, where it lies; addon/battle.js); only the 突袭 retreat (`'raid'`,
redeployed at once on its landing tile — no 不屈 roll) and permanent removals leave nothing.

### 1.1 Coordinates (PlayerBattleInput units)

`units[].row/col` are **board coordinates** (rows 9–12, cols 2–10) unless `abs: true` (or player
`coords: 'field'`). Mapping:

| field | row | col | direction |
|---|---|---|---|
| normal | row | col + colOffset (0) | unit `dir` (default RIGHT) |
| unite | row | col + colOffset (0 or 8) | unit `dir` |
| boss/hidden, side L | row − 7 when row ≥ 7 (board 9–12 → boss 2–5) | col + colOffset | unit `dir` |
| boss/hidden, side R | same | **20 − col** (mirrored; colOffset ignored) | **mirrored**: RIGHT ↔ LEFT, UP / DOWN unchanged (`battle.mapDir`) |

`rowOffset` on the player overrides the boss row mapping. Unit input `dir` ∈ `'UP'|'RIGHT'|'DOWN'|'LEFT'` (the board
piece's facing, research 09 §1.2; absent/junk ⇒ RIGHT; with `abs` / `coords:'field'` it is a field direction as given).
A merge's elite is an ordinary board piece to the sim: when the merge consumed a deployed copy it stands on that copy's
tile with its facing (PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置"; `PlayerState._mergeChess`), with
its loadout's `skillIndex` / `moduleId` and no equipment (the copies' items went back to the hand).
Token pieces: `{ kind:'token', tokenId, ownerUid, row, col, dir? }` — the manually deployable summons the player placed
(data `placeable`, PRTS 卫戍协议/帮助 §战斗部署; user playtest #6). A piece marks the tile its summon deploys on: a talent
summon the owner holds from the start (狼群, 海嗣, 流形, 凯瑟琳's 爬行号·防护单元 — facing the operator it shields) deploys
with the board (望's 棋子 too, each one occupying her stock while it stands and going back into it as it leaves — the
owner's decision of 2026-10-06, kits/ops/op-wang.js); a skill's summon (赫默 S2 医疗探机, 巫恋 S2 诅咒娃娃, "获得一个…") deploys once at the battle start, free
and regardless of the holding (PRTS §作战阶段 "所有手动部署的召唤物，无视所属干员的持有状态…作战开始时立即部署一次"), then
waits on its tile and takes the field there each time the skill gives one (stock ≤ 1, after the token's redeploy time
once it left, free; never while its owner is off the field [ASSUMED] — a stocked one deploys as soon as the owner is
back; the doll also leaves when 巫恋 leaves, the drone stays when 赫默 leaves: PRTS token 备注). The countdown summons —
those that "不会受到攻击" and leave after a fixed time (医疗探机, 诅咒娃娃, 海嗣; 自选: 工程蓄水炮, 沙地兽, “打字机”, 本能的召唤;
content/tokens.js `COUNTDOWN_SUMMONS`) — hold 无敌 + 禁疗 from each deployment (`startCountdown`) and their snapshot hp is
maxHp × the share of their life left (`unit.countdown`; community report of 2026-10-06, 0.2.0). A skill's summon, a
device or 海嗣 that was not placed never appears (the hidden 待部署区 deploys nothing by itself); the tacticians' 狼群 /
流形 still come as their 援军 on a tactical point without a piece (content/tokens.js `tacticalPoint`). Their piece stands
inside the tactician's attack range — the prep enforces "只能部署在召唤者攻击范围内" (tokens.json `ownerRange`, player
report #9 after 0.1.0) — and the kits re-use the piece's tile for a re-summoned pack only while it is a free, standable
tile of her initial range (kits/shared/tier3.js `tacticalPoint`, tokens.js `ensureReinforcement`). A 狼群 whose last 狼影
falls (or that is retreated) is not re-summoned: it stays its tile's piece in its 战术点形态 — off the fight, the tile
reserved — for the 狼影 interval and comes back there with one 狼影 (tokens.js `installWolfTacticalPoint`, the piece and
the 伺夜 kit's own pack alike; 伺夜 S1 ① ends the form at once, 伺夜 leaving ends it without a return). The start deploy
is the user's call after playtest #6 (DESIGN §20); `shared/constants.js SKILL_SUMMON_START_DEPLOY = false` would bring
back the playtest #4 reading (only with the skill) in the sim and the summon card's hint (docs/PLAYING.md §4 and this
passage must follow; test/ui/playtest6_summons.test.js checks).

**Facing (DESIGN §3, `sim/dir.js`).** Every ally has `unit.dir`; `unit.fwd` = its forward vector `[dRow, dCol]` (UP
`[1,0]`, RIGHT `[0,1]`, DOWN `[−1,0]`, LEFT `[0,−1]`; row 0 is the bottom). Range grids and every relative offset
`[dRow, dCol]` are authored facing RIGHT and rotated: RIGHT `(dr,dc)`, UP `(dc,−dr)`, LEFT `(−dr,−dc)`, DOWN `(−dc,dr)`
(`rotateOffset`; the inverse `toLocal` turns an absolute delta into the unit's frame); `rangeExtend` adds tiles along
+dCol **before** rotating. `unit.facing` (±1) survives only as the derived horizontal sign for sprite flipping (a legacy
`facing = ±1` assignment sets RIGHT / LEFT). Content rules: "身前 k 格" = `frontOf(r, c, dir, k)` (`support.frontTile`);
"左右两格" = `offsetTile(r, c, ±1, 0, dir)` (`support.sideTiles`); kit pushes / pulls use `unit.fwd`; blowers compare
directions (same ⇒ `equal`, reverse ⇒ `opposite`, perpendicular ⇒ `vertical`); board-position rules ("更靠左", "最右边",
"同一行最右边") stay board positions in the player's own frame (mirrored FA side: counted from the field's other end),
independent of the units' directions. Enemies keep their own horizontal facing logic (content/enemies/archetypes.js frontGuard).
"First tile" tie-breaks relative to a unit (tactical points `findTacticalPoint`, summon tiles `findSummonTile`, the 突袭
landing tile) compare offsets in the unit's facing-RIGHT frame (`localOrder` / `localBefore`; for a RIGHT unit exactly
the old tile-key order), so a rotated layout plays the same (test/sim/facing-invariance.test.js: every chess × 4
directions on an open field). 余 S3's fire wall runs through his tile perpendicular to his direction (his column facing
RIGHT / LEFT, his row facing UP / DOWN; fx `firewall.axis` = `'col'|'row'`).
`carryState: { hpPct, sp }` restores unite helpers' operators (HP ratio, and the SP = the official 技力, stored charges
included: `unitsEnd` reports `skill.spTotal`, reset rebuilds the charges from it, and `skill.setSpTotal` sets it again after
the `deploy` hook — PRTS "部署完成后…技力修改至与上一阶段结束时相同", so 独行 / 黄沙罗盘's deploy-time SP does not add to it;
later redeploys keep those gifts); `carryState: { sp }` a board summon
piece's SP only (PRTS "召唤物仅修改技力"). Nothing else is carried: a skill running at the end of the own combat enters
switched off with the SP it had left — spent at its activation, 0 for a one-charge skill (`unitsEnd.skillActive` is
reported, never carried; community report #34 — it used to restart for free).
Timed deployment skills (`activateOnDeploy`) trigger once from the new deployment, consuming their deployment charge;
they do not resume the previous skill state.
`carryState: { down: true }` = an operator knocked out at the end of the helper's own combat (PRTS 卫戍协议/帮助 "上一阶段为
退场状态的干员强制退场", user playtest #5 item 2): `start()` deploys it with everyone (initial `deploy` fires), then — before
`battleStart` — withdraws it with reason `FORCED_EXIT` (constants.js `'forcedExit'`) and HP 0 (the end-of-phase HP ratio, as after
`kill`): it is down on its tile (`isDown`, b.snap `down`) with its full redeploy timer and redeploys by the normal rule; no `kill` hook, no `'killed'` death (knock-out
effects such as 深海 / 不屈 revives or 崇高牺牲 layers fired in its own combat), no `deaths` count. Right after `battleStart`
its timer is re-read (`deathAt + respawnTime × persist.redeployMul × s.redeployMul`), so a redeploy-time effect switched on
by a `battleStart` handler covers it like a later knock-out (机变 征召 −50 %; 征召's row check does not count it [ASSUMED]).

### 1.2 Enemies, routes, ownership

`SpawnSpec = { time, enemyKey, routeIndex, count=1, interval=0, mods:{hpMul,atkMul,defMul,resMul,speedMul}, sourcePlayerId?,
bounty?:{coins, ownerPlayerId}, tag?:'boss'|'part'|'escort'|'bounty', ownerPlayerId?, pos?:[r,c], route?:RouteSpec, countInTotal? }`.
A spec entry the battle queues (`_queueSpawn`) is `inTotal` when it counts (`countInTotal`, `tag`, data `notCountInTotal`):
that is the HUD capsule's own set (§1.3); everything content spawns at runtime (a split, a summon — a boss's included —,
a part) is not, even when it counts for LP (`counted`).
`RouteSpec` accepts data/waves.json routes (`{motion, start, end, checkpoints:[[r,c]…], steps:[{t:'move',p},{t:'wait',s},{t:'disappear'},{t:'appear',p}]}`)
and research routes (`{m, s, e, cp:[['MOVE',r,c]…]}`). `spawnsFromTemplate(waveEntry, {mods})` (simdata.js) converts a
template into `{ routes, spawns, maxPlayTime, overrides, extraRoutes }` (non-spawn `action` entries are skipped; `unharmful`
and `tag:'part'` spawns don't count in `total`). The boss templates' 传送门 reads as "reappear on the far side" (GitHub
#336, PR #337): four official routes write the crossing as `disappear → wait → move` to the exit with no `appear` (their
twins spell the `appear` out), so normalizeRoute re-inserts the exit `appear` ahead of that move — otherwise the enemy
walks the rest of its route hidden and leaks unseen (test/sim/portal-appear.test.js). A route that ENDS on an entrance
(`tile_telin`; the boss / Hidden Core circuits end on [1,3] / [1,17]) does not leak there: the enemy vanishes, comes
out of the far exit (`tile_telout`; both entrances feed [5,10], the pairing of every explicit `disappear`/`appear` pair
of the data) after 3 s hidden inside — the wait of the explicit crossings (85 of 95) — and walks on to the blue door
on the entrance's side, where it leaks (ai.js portalPickup; [ASSUMED] the pairing and the 3 s).

A `bounty` pays `coins` once, when the enemy really dies (not a knock-out it survives; a leak pays nothing), to
`Battle._bountyPayee`: the player of the operator or summon that dealt the blow, if that player is in the battle; any
other death (无来源 damage such as 活性源石, its own HP loss, another enemy, an ownerless unit) pays `ownerPlayerId` when
that player is in the battle, else — 联防, where it is the leaker — the helper whose half the enemy fell on (0.2.0).

Leader parts (`tag:'part'`) pass damage to their leader with `loseHp(leader, share, { source, from, sourceless: true })`
(无来源, credited to the attacker's `bossDamage`): `PART_TRANSFER` 1 for 斩胄之剑 / 破胄之锤 (`BLADE_TRANSFER`, the same
constant) and 碎铳之簧 (PRTS "受到伤害时令假想敌：胄/铳受到等量的无来源生命流失"; DESIGN §20.10, §20.13). Content may replace a part mid-battle: every 剑/锤 sortie (content/bosses.js `kitBlade`)
ends by spawning a new 初始模式 copy on its level branch route (`left_hand_origin` / `right_hand_origin`) with the old
HP, then `kill(old, null)` — uncounted, no bounty; the client sees a `die` and a `spawn`. The Hidden Core 铳's 【末日布道】
puts every 碎铳之簧 into 追逐模式 for its whole 5 s gain (`dog_duration`; invulnerable, no ordinary attacks): the spring
keeps following the casting gun after reaching it (PR #347; until 0.2.1 arrival or 1 tile ended the chase), and each
gun casts on its own data timer (20 s after it spawns, then every 45 s), so on a pair field the later call retargets
every spring to that gun for a new 5 s (PRTS: 「持续召唤场上所有“碎铳之簧”向自身移动」).

WALK legs pathfind on the stage grid inside the rect with the official flow field (grid.js: 4-direction SPFA from the
destination, crates cost 1000, then Bresenham line-of-sight smoothing — research 08 §3.4). The official route stays
unless 0.1.0's road-over-floor preference route (the fewest non-blockable tiles among equal-length chains, a line of
sight that never covers floor — diagonal-step corners included — its grid route does not walk; user playtest #2 item 2)
crosses strictly fewer non-blockable tiles (floor / gate lanes) and no more 深水区 (GitHub #375: on 战场#08(下半) the
patrolling 铳 / 卢西恩 waded through two water tiles to dodge one floor tile; the official upper road crosses one);
"crosses" = passes through the tile's interior, a
corner touch does not count (`grid.js` `segmentTiles`; community report D5 after 0.1.0: 战场#04's lower-gate enemies cut
diagonally from row 9 into row 10 as officially), and on equal counts the official route stays.
test/sim/pathing-official.test.js lists the 21 of 154 stage routes that still differ from the official ones (战场#01's
col-8 road, the boss exits of 战场#01 / #02 …, and 7 on the inactive 战场#05(上半), whose 深水区 counts as non-blockable
since it refuses deployment — the sim does not model the canoes over it); test/sim/pathing-blockable.test.js audits the floor crossed. Enemies
re-path whenever
an obstacle changes (`grid.version`), after a displacement and when 诱导 / 恐惧 ends (the 恐惧 and 诱导 walks likewise
re-plan from where the enemy stands after an obstacle change or when something else moved it — a push, or for 诱导 an
outranking 恐惧); the smoothed chain is only line-of-sight
clear from a tile centre, so an enemy re-planning off-centre first steps back to its tile centre when the straight line
to its first waypoint would cut a tile it cannot walk or a crate (a pushed enemy never clips a fence corner or breaks
the decorative crate on it — act1 m03 (11,5); test/sim/pathing.test.js). If crates cut every path the enemy walks through them, gets blocked by the crate
and destroys it. FLY legs fly straight between checkpoints. `disappear` hides
the enemy (untargetable, not in snapshots), `wait` pauses, `appear` teleports.

**恐惧 movement** (`fear.js`, user playtest #6; PRTS 诱发移动 §恐惧): a feared enemy leaves its route. Each application
(`Battle.applyStatus` stamps it on the buff) lists the 恐惧可达地块 — tile centres within 10 of where it was hit, inside the
±45° fan pointing away from the source, passable for its motion (obstacles or not), able to reach its goal, not the
objective. The enemy moves (own speed) to a random one of them, offset at random inside a 0.5-side square, then picks
again; a pick more than 5 path steps away (or on an obstacle tile, which has no path) is dropped for good and its own
tile is used instead. No source, the unit itself as source (自惧: the “萨科塔” enemies' SelfFear) or a source on the hit
point ⇒ no tile ⇒ it flutters inside its own tile. Ground units walk the flow-field waypoints to the checkpoint (back to
their tile centre first when an off-centre straight line would clip a wall, as route legs); pushed / pulled or after an
obstacle change, that walk re-plans from where the unit stands — to the same checkpoint while it stays reachable, else
to a new pick. A `wait` leg keeps counting; when the fear ends the route re-plans from where it stands. 恐惧 outranks 诱导.

**Blocking** (`Battle._checkBlock`, official contact rule — PRTS 游戏数据基础 §阻挡半径, 作战机制 "中点判定 … 案例: 阻挡";
user playtest #5 item 4): an unblocked, blockable enemy is blocked by an ally (or device) whose centre is within its
block radius of the enemy's position — `constants.js BLOCK_RADIUS`: ground 0.7071 (compared as d² < 0.49999037, the
tile's circumscribed circle), air 0.8944 × the blocker's 阻挡半径倍率 (blockFly units against flyers; an airborne 起飞
unit — flag `liftoff` — blocks flyers only, PRTS 术语释义 起飞 "阻挡模式变为空中阻挡"; mod `blockRadiusScale` = 倍率 − 1,
PRTS 游戏数据基础 "飞行阻挡半径 = 0.8944 × 阻挡半径倍率": 凯尔希·思衡托's 遗尘守望 and S1, +0.23 — ground blocking ignores it),
devices 0.4472 — while that blocker has free
capacity for the enemy's `blockWeight` (data `blockCnt`). A unit standing on a tile ground units cannot pass — the
fenced 围墙 / 围栏 tiles (`b`: low, deployable, flyers only; the only low tiles of that kind on the stages) — blocks no
ground enemy (PRTS 围墙 / 围栏 地形机制 "部署在其中的单位，若当前阻挡类型为'地面阻挡'则无法阻挡敌人";
`Battle._blockerFor`). Nothing walks onto those tiles, but a push or pull stops an enemy at the fence edge, 0.5 from the
unit; it walks on from there (found while checking community report F4 after 0.1.0, 深巡 on a fenced tile: 薄绿 S2 held
the enemies she dragged against the fence; test/sim/feedback1f-fence.test.js). Air blocking (blockFly against flyers)
stays [ASSUMED: PRTS restricts the rule to 地面阻挡], and a unit on a fenced tile still attacks whatever stands on its
range tiles. Never blocked: an enemy holding 不可阻挡 (PRTS 异常效果 BLOCK_FREE 「无法阻挡/被阻挡，自动解除阻挡」) —
the `unblockable` flag (恐惧, 诱导 and many enemy abilities carry it), 浮空, and 沉睡 (SLEEPING = 无法行动+无敌+不可阻挡: an
enemy falling asleep is released at once, its slot freeing for the next enemy, and stays where it is; once awake it is
blocked again only by a blocker with room, else it walks on — DESIGN §24.9). It is checked every tick for every
unblocked enemy, moving or not: an enemy that overlaps an operator when its blocker dies / is withdrawn / is stunned, or when the operator's
blocked enemy dies, is taken over at once; an enemy that finds no room walks on (pass-through). A stunned or frozen
enemy is checked too — 晕眩 / 冻结 hold no 不可阻挡 (PRTS 异常效果: the STUN / FROZEN state machines stop its moves and
attacks) —, so an operator redeployed beside a held enemy blocks it where it stands and lifts its 隐匿; one held short of
contact is blocked once it walks in after the status (GitHub #232; until 0.2.0 the check waited for the status to end).
Several blockers in contact → the nearest [ASSUMED]. A head-on enemy therefore stops at contact, ~0.71 tile from the blocker's centre, on the
tile in front of it (PRTS 作战机制: a blocked enemy's collider does not enter the blocker's tile; the official few
hundredths of a tile of deceleration are not modelled), and **every blocker** — melee units (要塞 / 领主 / 哨戒铁卫
included), summons (流形's melee copy) and a ranged operator standing on a melee tile alike — may always target the
enemies it blocks, in range or not, whatever its facing, and targets them first ("可以选择且优先选择阻挡单位", PRTS 选择器;
the user's rule after playtest #6, "阻挡了就一定要能打到": officially the collision pushes a blocked enemy to its blocker's
front — `Battle.blockedTargets`, used by `ai.js acquireTargets` and the skills' DEFAULT trigger, and
`sortEnemyTargets`; one exception, the owner's decision of 2026-10-08 (GitHub #220): the 速射手 air priority —
priority 'fly', trait 优先攻击空中单位 — comes before its own blocked enemy, so a 速狙 on a melee tile shoots a flyer in its
range first, PRTS 索敌的概念 「阻挡（近战限定）→特殊优先级→…」; every other priority keeps the blocked enemy first; "自身这格内" rules name the blocked enemies separately — 瑕光 S2, PRTS 备注). A kit that picks its own
targets from the range (`beforeAttack`) adds `battle.blockedTargets` to its candidates (深靛, 迷迭香 S3, 荒芜拉普兰德 S2,
佩佩 S2, 灵知 S3, 远牙 S3); only skill texts that exclude targets keep their rule (普罗旺斯 S2: none above 80 % HP; 寒檀
S2: icicles on random tiles of her range). This replaces the
playtest #5 QA's melee-only reading (PRTS 索敌的概念 "我方索敌优先级：阻挡（近战限定）"; "远程位干员…无法攻击到这个敌人");
DESIGN §20 keeps the one-line flip (`Battle.blockedTargets` / `sortEnemyTargets` gated on a melee position again).
The every-blocker rule is for units whose attack hits enemies (咒愈师 included: "攻击造成法术伤害"). A healer — dmgType
`heal` (医师 / 群愈师 / 疗养师 / 链愈师 / 行医, the map characters 预备干员-医疗 / Touch) or a skill attack turned into a
heal (古米 S1 / S2, 塞雷娅 S1, 波登可 S1) — selects injured allies only and keeps healing while it blocks; it never targets
the enemy it blocks (PRTS 卫戍协议/帮助 "对于医疗干员（咒愈师分支除外），攻击目标为需要治疗的单位"; PRTS 仇恨
HP_RATIO_NOT_FULL_ASC; PRTS 选择器 adds only the blocked units the selector's side can pick): `ai.js acquireTargets`
returns its heal targets before the blocked targets, and the heal skills' DEFAULT trigger looks at injured allies
(test/sim/feedback1e-healers.test.js).

**Enemy attacks:** blocked melee enemies hit their blocker; enemies with `rangeRadius > 0` **and `applyWay` ≠ `MELEE`**
attack allies whose collider touches their range circle — centre distance ≤ `rangeRadius` + `ALLY_COLLIDER_RADIUS` 0.25
(PRTS 作战机制 §碰撞体积与位置识别: "我方干员碰撞体积基本均为以0.25格为半径的圆形", 索敌 uses the colliders; user playtest #6
follow-up: 萨卡兹枯朽战车's 2.2 reaches 2.45; enemy skills / zones of content keep their own point radius [ASSUMED]) (a
MELEE enemy only ever hits its blocker — data/enemies.json already zeroes their `rangeRadius`, the engine enforces it
for any source; content may set `enemy.profile.melee = false`). Target order
(targeting.js `sortAllyTargets`, PRTS 作战机制 索敌 "阻挡→特殊优先级→仇恨值（更容易被攻击→…→最后部署的目标→不容易被攻击）"):
its blocker → highest taunt level → latest deployed (`aggroSeq` = the deploy order: a redeploy or a mid-battle summon is the
latest) — except an enemy whose 索敌不受阻挡影响 (`enemy.profile.blockFree`: 自制投石机), which selects among the allies in
reach as if unblocked, no blocker first (DESIGN §25.18). `enemy.profile.canTarget(ally)` (content: 萨卡兹枯朽战车 "只攻击位于低地的我方单位，且不会攻击飞行单位", 掠海漂移体 / “萨科塔之眼” 不会攻击飞行单位 …) filters the candidates before the order;
a special priority (假想敌：铳 / 昆图斯 highest DEF, 假想敌：胄 highest / lowest ATK, “自在” nearest …) sorts by its key and
breaks ties by taunt, then latest deployed (`aggroCmp`); `untargetable` / sleeping allies and devices are never targets;
an airborne ally (起飞, flag `liftoff`: 蒂比's skills) never for a ground enemy (对地规避 — `targeting.js evadesGround`,
PRTS 术语释义 起飞 "无法被不同阵营行动方式为地面的单位选中"; flyers, 近地悬浮 and 浮空 enemies still pick it; the enemy
area selections skip it too (below); not selections, so they still reach it (`ignoreSelect`): abilities PRTS marks
"无视无法选择 / 无视(目标)可选性" (【污染秽蚀】, 假想敌：铳's 【盲信之誓】, 萨卡兹悖谬暴虐兵长's 暴击 splash, 假想敌：淤困's
burst spread), direct picks (碎铳之簧's 法术护盾 counter and 重装侦察兵's 暴露 on their attacker — PRTS 异常效果
"'直接选中'的能力…不受这些仅在选择时生效的异常效果制约"), the blasts of flying units credited to the ground 胄 (刺胄之弹,
斩胄之剑 / 破胄之锤 — whose 掷剑 / 掷锤 pick "（无视无法选择）") and the ticks of a debuff a ground enemy put on it before it
took off (出血, 沙狱, burning DoTs, 淤困, 【自然涌动】 — a tick selects nobody); the buff auras of ground enemies and the
sourceless 毒雾 of 假想敌：蚀裂 still reach it [ASSUMED]; a ground enemy's area skill whose cast depends on allies nearby counts only the targets of its trigger
selection — 卢西恩's 【aoe】 ("需要目标"), 锏's CircleAttack (`targetsNear`, PRTS 选择器 "所有触发选择器通常不无视迷彩");
a stealthed ally (隐匿, 排气格栅) only for the enemy it blocks — our operators keep 隐匿 while blocking (PRTS 作战机制
§隐匿; 索敌的概念: a blocked enemy "强行无视对方可选性" attacks its blocker) — except an enemy whose 索敌不受阻挡影响
(profile `blockFree`: 自制投石机 — it selects as if unblocked, by 仇恨值, so a 隐匿 blocker is no target; DESIGN §25.18); a camouflaged one (迷彩, flag `camou`: ba.camou
"不阻挡时不成为敌方普通攻击的目标") likewise (PRTS 异常效果: neither anomaly is "阻挡时解除") — for every target selection
(attacks, skill picks, cast conditions, a normal attack on every operator in range — 斩胄之剑 / 破胄之锤's hover attack,
“灵幛”). **Enemy area effects** — splash, death and self blasts, area skills and statuses, pulses, the zones an enemy
leaves, chain / bounce jumps, 周围四格 additions, whole-column / whole-field skills — select with `targeting.js
areaSelectable` (`content/enemies/helpers.js areaAllies` / `areaAlliesInTiles` / `fieldAllies`; PRTS 作战机制 §AOE伤害判定
"AOE的判定是对攻击范围内的每个可以被选中的敌人进行判定"; PRTS 异常效果 §无法选择: 隐匿, 不可选中, 无敌 and 对地规避 make
"常见的、来自不同阵营的“选择”行为" skip a unit unless the ability "无视可选性"): no 隐匿 ally, the one blocking that enemy included
(GitHub #97, owner 2026-10-04; the 0.1.2 [ASSUMED] that the blocker's area also hit is withdrawn — the blocked enemy's attack still lands), no untargetable or sleeping one, no
airborne 起飞 one for a ground enemy; an invulnerable one still [ASSUMED, as for attacks — §21.22]. 迷彩 is not checked:
splash-type damage, 中点判定 / 格子判定 effects and auras ignore it (ba.camou "无法躲避溅射类攻击"; PRTS 异常效果 迷彩
"所有光环类能力、以及涉及中点判定/格子判定的效果均不受迷彩制约") or the enemy's PRTS page says "无视迷彩" — the few sites
with none of these hit it [ASSUMED] (DESIGN §22.12). A target the ability locked beforehand (an attack's target, 死亡之眼's
channel, a C4, an 爆炸箭) is a direct pick — a 隐匿 it gained meanwhile does not save it (PRTS 异常效果 "'直接选中'的能力
…不受这些仅在选择时生效的异常效果制约"); only the units around it are an area selection (`targetAndArea`). An enemy's
buff aura (深池伙友卫队's field, 扎罗's 远古威慑) takes the allies `targeting.js auraSelectable` accepts — 隐匿 kept out, the blocker included,
(PRTS 作战机制 §隐匿与Buff的关系 "隐匿状态下的单位一般无法被敌方的索敌机制和Buff选择器选中为目标"), an airborne 起飞 ally
not [ASSUMED, §21.22]. Until 0.1.2 they took every ally in the area (GitHub issue #32 item 6; DESIGN §22.12). Still on
every ally there: the "无视无法选择 / 无视可选性" abilities above (and 远眺's death 暴露, 圆仔's facing count), 寒霜's aura
(PRTS names its 攻速下降 Debuff among the effects that "无视隐匿状态起作用") and map / tile / terrain effects (“墓碑”'s
halving — PRTS: a map effect —, 【国度】, a chimera's 源石污染区 aura [ASSUMED for the last two])
and, unblocked, stand for each attack's clip — `attackStand`: data/enemies.json `attackAnim`, through its wind-up
(cooldown ≤ the strike frame, a target in range) and the rest of the clip after the strike, shortened when the attacks
come quicker than the clip; `ATTACK_PAUSE` (0.35 s) after the strike when no clip is known; an `attackMoves`
(「不停止移动」) enemy never stops; a stun or a displacement (失衡, 0.2.0) ends the stand; only the walking waits — a route WAIT keeps running and
DISAPPEAR / APPEAR legs still happen, hiding ends the stand; GitHub #58 — then walk on. Any enemy whose block ends after
its strike — its blocker stunned by that strike (流泪小子), knocked out or retreated — stands for the rest of that clip
before it walks on (PRTS 状态机: an enemy's ATTACK / COMBAT state "攻击结束后回退到MOVE状态"; only a character's COMBAT
drops when its blocker is gone; 0.2.0 — until then it walked on at once). Every normal attack strikes at its clip's damage frame (`attackWindup`: `attackAnim.hit`, shortened like the clip; 0 with no clip known — the strike as the swing starts): the cooldown runs down to the frame and the swing (`enemy.swing`) starts when it reaches the wind-up with a target in reach — the whole wind-up from that tick when the cooldown ran out before (it walked ready, its swing was cut); a stun / freeze / sleep / 浮空, hiding, 缴械, 恐惧, 战栗 while blocked or losing every target before the frame cuts the swing — no strike, the next one starts from its wind-up (PRTS 状态机 ATTACK / COMBAT "每帧检查异常状态", 异常效果 STUNNED / DISARMED "正在进行的普通攻击将被中断"; GitHub #187 / #170, 0.2.0) —, a strike already made stays made (its shot lands); the targets are taken at the frame [ASSUMED]; `fear`/`disarm` stop attacks; `dmgType 'none'` enemies
never attack — unless content arms them through `enemy.profile` (`noAttack: false`, `melee`, `dmgType`, `maxTargets`:
转译基底·α's 寻仇者 / 特战术师 forms, which then attack like any enemy); `dmgType 'heal'` enemies heal the lowest-HP% enemy in their radius instead. A `noMove` enemy stands (not `moving`, drawn idle). Content can take over an
enemy's attack: `enemy.profile.deferHit` = the engine makes the attack (target, timing, the `'atk'` event) but deals no
damage — the content's `attack` handler resolves it (帝国炮火先兆者's shells landing 3 s later, `content/enemies/fly.js
kitShell`); `enemy.profile.shot` = the `'atk'` event's projectile kind (`'mortar'`: no projectile drawn). 暴鸰 (`kitBombd`,
no normal attack) drops its one bomb as a projectile: the cast (trigger: an ally within its range 2; the drone hovers
through it) releases it `BOMBD_RELEASE` (8 ticks, the Attack clip's OnAttack on frame 8) later — `'atk'` kind
`'droneBomb'` and setForm `'bombed'` (fx `'phase'` {kind, form `'bombed'`}; `unit.form` → `UnitInfo.form`; the model flies on without it) — and
it hits on arrival (target 100 % ATK, the other allies of the 8 tiles around its landing tile 100 % splash, camouflage
ignored; a target gone mid-flight: it lands where it was). The cast ends once the bomb has landed and at least
`BOMBD_POST_DELAY` (0.667 s) after the release: the drone's speed ×2, and it moves again. A stun / freeze / sleep
before the release interrupts the cast: nothing leaves the drone and the skill re-arms with its 1 s cooldown (feedback
D4 after 0.1.0: the damage used to land in the trigger tick with the bomb still on the drone). Crates (stage devices with
role `crate`, 100 HP) are ground obstacles; an enemy forced through one is blocked by it and destroys it. A device is
present when data/stages.json says `active: true` (this wins over the level file's `hidden`: act1 m02's crates);
research stages without `active` use `!hidden`. Active platforms/mounds (射击台, act1 m03) [ASSUMED, DATA §15.11] are
ground obstacles, and an operator standing on one is elevated (`unit.ground = false`: never blocks).

**Enemy damage zones** (`content/enemies/helpers.js zone`, `archetypes.js dmgZone` / `pollution`): a zone ticks on the allies inside it
that it selects — an enemy's zone through its area selection (`areaAllies`, above; the sourceless 毒雾 with no selecting
enemy: 隐匿 kept out, 起飞 not), 【污染秽蚀】 on every ally inside (flyers, stealthed and untargetable ones included;
`alliesInRadius`) — through `dealDamage`, so shields absorb a damage
tick, damage-taken modifiers scale it and it counts for 受击回复 SP and TAKE_DAMAGE skills like any hit (§4; element fills
excepted). 【污染秽蚀】 (萨卡兹枯朽战车's 秽蚀轰击,
萨卡兹枯朽战士's death — none when it dies silenced, its client template checks 沉默, DESIGN §25.18) is **true** damage, 50 / 25 per second on low / high ground (PRTS "每秒受到50/25点真实普通伤害 …
同名效果不叠加", user playtest #6): a unit covered by several zones takes one tick per second (`unit.mem.pollutedAt`), so
a crowd of dying 萨卡兹枯朽战士 totals 50 / s, not 50 × n. It is "可对空，无视无法选择": it also burns an airborne 起飞 ally
(`ignoreSelect`), at the low-ground rate on a low tile. The other zones are no exception to 对地规避: a ground enemy's
燃烧区域 (集团军重型火炮, PRTS "碰撞不受迷彩制约，不可对空" — 迷彩 only) skips an airborne 起飞 ally and a 隐匿
one; the sourceless 毒雾 of 假想敌：蚀裂 skips a 隐匿 one but still reaches an airborne one (PRTS 作战机制's "可以受到无来源的
毒雾伤害" is the stage hazard; until 0.1.2 the cloud took everyone inside). An activated 孽罪奇美拉's aura (`kitChimera`, PRTS "自身半径1.2
范围内的所有单位持续视为受到源石污染区影响，技力自然回复速度倍率-80%，每0.5秒受到50真实持续伤害（同类效果取最高）") is the same
kind of damage — 无来源 true (like the terrain it stands for [ASSUMED]), the chimera credited — not a 流失 (player report
D1 audit): radius 1.2, a tick every 0.5 s, one tick per unit per 0.5 s however many chimeras reach it (`mem.chimeraAt`).
Every enemy effect PRTS marks "不可对空" skips a flying ally (the 炎佑 dragon, `isFlying`): the 死亡爆炸 of 高能源石虫 / 冰爆源石虫 /
卷心籽 (archetypes.js `deathBoom`, `noAir` by default), 水遁忍者's 漩涡形态, 鼎沸's pulses, “萨科塔昂首”'s 祈祷邀约, the attack of
“斩胄之剑” / “破胄之锤”, the splash and blast of 烹泉 / 沏虹, 庞贝's blast and 集团军重型火炮's shell and 燃烧区域 (the first six
reached it until 0.2.1 — a community report).

**Knock-outs that are not deaths** (`content/enemies/archetypes.js`; player reports after 0.1.0): a `killed` ability that keeps the
enemy alive hides the knock-out from every later `kill` handler, the kill count, kill credit and the bounty — they all
wait for the real death, the only one with a `die` event. Every 重生 (`reborn()`, `husk()`, `statue()`) clears what
operators put on the enemy — the buffs with an ally source and source-less catalogue statuses (PRTS 特殊机制 §重生
"清空自身身上除白名单外所有Buff"; `rebirthCleanse`), restarts its skills from their initial cooldown when the 重生 ends
("重生结束时，重置自身的通用技能与当前形态的技能冷却为初始冷却"; `rebirthCooldowns`, since 0.1.1) — and keeps [ASSUMED: the
whitelist] its `persist` talents, what it or
another enemy gave it (锏's self-applied 抵抗, enemy auras) and source-less field state (on-tile terrain, airflow, element
burst locks). 活性源石's lasting effect (`terrain:infection`, a timed buff that outlives the tile) is no field state: the
重生 clears it (PRTS 特殊机制 非首次标记 "如无特殊说明，也默认同常规Buff一样可被重生清除"), and contact gives it again on the
tile [ASSUMED] — kept, its ticks broke a 逐火 ember's hits (DESIGN §22.4). A 逐火 knocked out while feared is no
unblockable ember — nor one feared by the knocking-out hit itself (the 重生's 无敌 + 无法选中 refuses it,
`Battle.applyStatus`). 重生 / form changes: `reborn()` (first knock-out → second
form; fx forms 'reborn' → 'form2'), `statue()` (守墓石像: melee only while blocked; first knock-out → 10 s unblockable,
immobile statue → a flyer with ranged arts attacks that skip flyers; forms 'stone' → 'fly'), `husk()` (talent
Revive[Trigger], every knock-out: 1 s 重生 — 无敌, 无法阻挡, immobile — then a hit-count husk that
walks its route on: the 深池逐火 余烬 / 火灰 are 隐匿 and disarmed, so only a blocked one — or one within 3 s of a block's
end, the warrior's own block that the knock-out releases included (§22.8 [ASSUMED] order) — can be targeted or struck by
operators (radius area damage too: `Battle.foesInRadius`, PRTS 作战机制 §AOE伤害判定 — until 0.1.1 it reached an unblocked
one); 假想敌：再生's 傀儡 is unblockable and, as it begins, shields the other enemies within 1.8; a husk
still standing after `Revive[Trigger].interval` s stands up again with full HP),
转译基底·α (its original form cancels every damage instance, and an HP loss stops at 1 HP; the 4th physical / arts
instance or a block starts a 2 s change). Each form change goes through `setForm(b, e, form, fxKind, params)`: the
unit keeps it (`e.form`, published as UnitInfo `form`, so a view built mid-battle from `fieldMeta()` — a watched
teammate's field, 联防 observers, a reconnect — starts in it: `render/app/info.js renderInfo` hands it to the view) and the
fx announces it as its `form`: a 'phase' fx (crawl, translator_*, a prisoner's 'warning' — also its `kind`), 'ember'
('husk'), 'revive' ('revived' / 'form2' / 'fly'), 'telegraph' ('reborn'), 'stone' ('stone') or 'liberate' (a prisoner's
'liberty') — render/units.js FORMS. An operator has one
form too: a 傀儡师's <替身> (`professions.js installDollkeeper`: `u.form` 'doll' from the switch to it — fx 'substitute'
`{ form: 'doll', dur }` — until the switch back, fx 'swap' `{ form: null }`, or its knock-out, fx 'dollEnd' `{ form: null }`
after the 'die' event). Barrier / charge
'phase' kinds carry no `form` and are no forms. A form is state, not decoration (b.snap tuples carry none): the client
keeps every fx with a `form` (`shared/protocol.js fxForm`) where it drops other events — the runner's catch-up frames
and its hidden-tab backlog (`battle/runner.js keepsState`; a backlog past `HELD_MAX` drops only superseded status /
skill toggles, and a battle that ended while hidden delivers it when the tab is shown), the game screen's events
buffered before a field is entered (`screens/game/early.js keepEarly`, also while a re-sent field meta re-enters the field on
screen) and the render engine's event queue (`render/interp.js isCosmeticEvent`: a form fx is never dropped as stale,
more than 1.5 game s behind the render clock, nor shed from a full queue; one handed out late switches the model
without its telegraph or a change clip that would already have ended); dropping them was report #5's look again after a stall or a background tab.

**Ownership** (`enemy.ownerId`, used for `killed/total` and leak attribution): `ownerPlayerId` if given, else the
player whose half contains the spawn tile (cols ≥ 11 = right half / player with colOffset 8 or side R). A leak is
recorded for the player whose half contains the goal it reached, with `sourcePlayerId` preserved for unite LP.

### 1.3 BattleResult

```js
{ time, reason: 'cleared'|'timeout'|'forced', killed, total, resolved, errors, unspawned?: [{enemyKey,time,tag}], bossHpLeft?,
  perPlayer: { [playerId]: { killed, total, resolved, killedInTotal, leakedInTotal, perfect,
      leaked: [{ enemyKey, mods, lpr, sourcePlayerId, tag, counted, boss?, spawned }],
      layerGains: {bondId: n}, coins, damageDealt, bossDamage, healingDone, deaths,
      unitsEnd: [{ uid, id, defId, hpPct, sp, skillActive, alive }],   // operators + board summon pieces; sp = skill.spTotal
      unitStats: [{ id, uid, defId, name, kind, dmg, kills, heal, taken, attacks }] } } }
```
- **Two sets of counters, and they never cross.** `counted` drives the official LP / 完美作战 / `killed` reading (master's,
  untouched): every counted enemy — a runtime split child, a summon, a boss's summon included — is in it. `inTotal` (the
  new flag, `spawns.js`) is the HUD capsule's own set (DESIGN §14 顶栏胶囊): only the enemies the field itself scheduled
  (`_queueSpawn`, and only those that `counted` — `countInTotal: false`, `tag: 'boss'` / `'part'`, data `notCountInTotal`
  stay out) are `inTotal`. Everything a runtime `spawnEnemy` makes defaults to `inTotal: false` (an explicit
  `inTotal: true` is the content back door); a 变身 / 重生 (`setForm`, a revive) is the same enemy and keeps its flag.
- `total` counts the `inTotal` enemies (the capsule's denominator), `killedInTotal` / `leakedInTotal` (battle level and per
  player) count those that were knocked down or leaked, and `resolved = min(total, killedInTotal + leakedInTotal)` is the
  capsule's numerator (official: 开局 0/3 → 漏一个 1/3 → 打死一个 2/3 → 打死会分裂的 3/3). A leaked split child or summon
  moves none of them, while `leakedCount` / `leaked[]` still charge its LP and break 完美作战. The per-player numbers are
  attributed like their `counted` twins — a knock-out to the enemy's owner (as `total`), a leak to the player whose half it
  reached (`_recordLeak`) — so in a two-half field (the 联防 lane, col 18 → col 2; the boss pair's crossing routes) an enemy
  that spawns on one half and leaks on the other is in one player's `total` and in the other's `leakedInTotal`, and each
  player's own `resolved` clamps it away (0 and 0 for an enemy the field resolved). Only the battle-level numbers are exact:
  the match never sums the per-player `resolved` — `validateClientResult` keeps the result's own and `m.public` publishes
  it (design/network.md 顶栏胶囊).
- `killed` therefore may **exceed** `total` (it counts runtime children, they do not): 4 磨砻 killed plus one of their 8
  木制瑞印 reads `killed` 5 with `total` 4 and a capsule of 4/4. `spec.js compactResult` and the match's validation bound
  `killed` by the spec's content-spawn allowance (`4·spawns + 100`) instead of by `total`.
- `cleared`: no spawns pending and no enemy alive (or the shared boss pool reached 0 — a pool never holds less than
  `BOSS_POOL_MIN_HP` (1): the hit that would leave less takes the rest and the browser's `LocalBossPool` reads less as
  0, so float dust of the pool sync can never keep a leader alive; user playtest #6). A boss/hidden battle **with a
  `sharedBoss`** ends only when the pool reaches 0 or on `forceEnd` (DESIGN §5.5) — an emptied field keeps running
  (the h07_04 pair leader has no wait step and can walk into the objective: the leak costs its `lpr`, then the field
  idles while another field may still empty the pool or the match's overtime drain — team LP, from 150 real s — ends it); without a pool
  (sandboxes, tools) it still ends `cleared` when empty. `timeout`: `time ≥ timeLimit` —
  every living non-boss enemy becomes a leak; spawns that never happened are dropped from `total` and listed in `unspawned`.
- `leaked[].counted = false` for `notCountInTotal`/`unharmful`/boss parts (LP rules: normal rounds count only `counted`
  leaks, cap 10; boss rounds use `lpr`). `perfect = no counted leak`.
- `battleEnd {result}` fires before the result is frozen: handlers may still call `addLayers`/`addCoins`.
- `layerGains` holds what `addLayers` actually added — never more than a bond's room under `BOND_LAYER_CAP` (999) from
  its starting layers; `bossDamage` / `damageDealt` never include a leader hit cancelled by 限伤 (§4).
- `damageDealt` and `unitStats[].dmg` count only HP removed from the other side: a unit's own drain or 流失 (源石溶剂,
  史尔特尔 S3 …) and friendly damage (the drain on 炎佑) count as the target's `taken`, never as damage dealt; the kill
  credit is unchanged (`damage.js applyHpLoss`).

### 1.4 Robustness

Every content callback (hooks, buffs, timers, kits, projectiles, skill callbacks) runs inside try/catch: the error is
logged once per (label, unit, message) into `battle.errors` and the battle continues. Engine-phase errors
(`internal:*`) are counted separately; after 200 of them the battle force-ends as a timeout. `step()` never throws.

Guarantees content can rely on (pinned by `test/sim/robustness.test.js`):
- **Re-entrancy.** `forceEnd()` called while a step runs (from any hook/callback) is deferred to the end of the current
  phase: the remaining phases are skipped, `time` does not advance and the result is built once (never mutated later).
  Enemies/units created by hooks during the enemy loop or the buff pass start acting next tick. A skill `onEnd` that runs
  because its unit is dying cannot redeploy it (use the `death` hook). `gainSp` / `dealDamage` re-read cost and stats
  after their `spGain` / `hit` hooks.
- **Recursion.** Hook emits and content callbacks share one nesting counter; deeper than `MAX_HOOK_DEPTH` (32) the
  handler/callback is skipped and a `hookDepth:*` content error is logged (deterministic — no stack overflow). Its message
  lists the open frames (`chain: hit(enemy_x→chess_y) > damaged(chess_y) > …`) so the looping pair is named; see the
  re-entrancy rule in §5. A tripped guard is always a content bug, never a limit to raise.
- **Bad numbers.** Helpers sanitize their inputs: DP flags and non-boss `timeLimit` (0/NaN ⇒ 60 s) fall back to defaults;
  unit rows/cols are coerced to integers (junk ⇒ unit skipped); `spawnEnemy` mods must be finite ≥ 0 (else ×1), the spawn
  point is clamped into the rect; `spawnDevice`/`spawnToken`/`relocate` accept only integer in-rect free tiles
  (`spawnToken` returns null and leaves nothing behind when the tile is busy, `relocate` only moves living deployed allies,
  `redeploy {tile}` refuses a non-integer / out-of-rect / occupied tile — or one a knocked-out operator lies on —
  without falling back to the home tile);
  non-finite `hp`/`stats`/`duration`/`extend`/`addAmmo`/`addCharge`/`addLayers`/`addCoins`/`spCostMul` values are ignored;
  aggregated stats that overflow (stacked `*Mul`) fall back to base values; a revive written by a `kill` handler is
  clamped to max HP (NaN/≤ 0 ⇒ the unit dies with hp 0); projectiles with non-finite coordinates are re-aimed at their
  origin; a NaN shared-boss pool shows the boss at full HP and counts 0 damage.
- **Runaway content.** At most `MAX_ALIVE_ENEMIES` (600) living enemies per field (`spawnEnemy` returns **null** beyond —
  content must handle it); a SpawnSpec `count` is capped the same way and `time: Infinity` spawns are never scheduled.
- **Movement.** Route legs outside the rect are clamped onto it (h07_01's extra fly route runs along row 6, outside the
  boss rect: without the clamp the flyer hovered at the border forever). An enemy that gains `unblockable`/`levitate`/`sleep`
  through a plain buff is released by its blocker on its next update.
- **Listener hygiene.** When a unit is removed for good (enemy killed/leaked, token expired or dead, device destroyed,
  permanent retreat) its hooks and periodic `every` timers registered with `{ owner: unit }` are dropped at the end of
  that step — after its own `death`/`enemyLeak` handlers ran; one-shot `after` callbacks still run. Register global
  handlers without an owner (or with a longer-lived owner) if they must outlive the unit.

---

## 2. Units

`Unit` fields: `id, side ('ally'|'enemy'), kind ('op'|'token'|'enemy'|'device'), defId, def (normalised), name, ownerId
(playerId), uid (board piece), ownerUnit (tokens), x, y (floats; x = col, y = row), tileR, tileC (allies), homeR, homeC
(board tile: a retreated operator's redeploys land there; a knocked-out one's on its `body` tile, §1), dir ('UP'|'RIGHT'|'DOWN'|'LEFT'; getters `fwd` = forward vector, `facing` =
horizontal sign ±1 for sprites only), hp, alive, deployed, removed, hidden, base {…}, buffs[],
rangeKeys / rangeKeySet (current range, absolute tile keys `r × 21 + c`), baseRangeKeys (initial range, §7.1),
liveRangeGrid (the 攻击范围 the detail card shows, through `shared/protocol.js unitStatsEntry` `range`: the relative grid
behind rangeKeys — a running skill's range, rangeExtend grown on (`extendedGrid`, shared/loadoutRecord.js, re-exported
by targeting.js; the grid itself when nothing extends it), no extra keys — or the unit's own range while a skill's grid
only selects targets, `targeting.showOwnRange`; at deployment it equals the record's `attackRangeGrid`, the range the
board overlay / deploy wheel preview),
extraRangeKeys (content extra targets, `battle.setExtraRange`), blocking[] (allies), blockedBy (enemies), motion
('WALK'|'FLY' enemies), profile, skill (SkillRuntime), kit, items (itemIds), lpr/mods/tag/bounty/sourcePlayerId (enemies),
stats {dmg,kills,heal,taken,attacks}, mem {} and trait {} (free scratch space), persist {redeployMul, …}.`
Getters: `s` (aggregated stats), `maxHp`, `atk`, `hpRatio`, `sp`, `spMax`, `canAct`, `isFlying`, `statusFlags` (UF bits),
`dmgType`, `weight`. `isFlying` = an **air unit** for every targeting / ground-only rule: `motion` FLY, or an enemy with
flag `float` (近地悬浮, PRTS 术语释义 "算作空中单位") or `levitate` (浮空 "变为空中单位") — never an enemy under 缚地 (flag
`groundbind`, "目标变为地面单位") unless a 浮空 lifts it again; movement and pathing read `motion` (a hovering enemy keeps
walking the ground path). `deploySeq` counts deployments (and identifies one: `seq === u.deploySeq`);
`aggroSeq` is the aggro order (= deploySeq, except the summons of the initial deployment, §1).

克莱门莎 S2's kit stores its cabin in `unit.mem.clemntCabin`. Before boarding each tick, it removes passengers
that died, became hidden / uncarryable or cannot path to the next cabin position, removes their carry buff and
returns their current `weight` (including modifiers). The same tick's count and weight limits use that cleaned
list and budget (DESIGN §28.27); this is local to the kit, not a change to general displacement.

**Hit areas (`body.js`, user playtest #5 item 10).** A regular enemy is a point: in a grid range when the tile of its
position (`round(y)`, `round(x)`) is a range tile, in a radius when its position is (DESIGN §3). A huge enemy (巨型单位:
`enemy.hitArea` from data/enemies.json `hitArea` — 假想敌：胄 / 管 / 盐风主教昆图斯 / 阿利斯泰尔 / “萨米的意志”, PRTS
"受击判定区域为长4.95、宽2.95的长方形，向上偏移1.0") is hit anywhere on a rectangle `w` × `h` tiles centred on its position
moved `dx` columns right / `dy` rows up: it occupies every tile the rectangle overlaps (`bodyKeys` — 5 × 3 tiles; PRTS
作战机制 "巨型BOSS单位的每一个占据的格子都可以让其本身通过格子判定"), and radius rules measure to the rectangle (`bodyDist`, 0
inside) [ASSUMED: PRTS 作战机制 calls collider tests the most common one] — except **splash around a struck / marked
target**, a 中点判定 (PRTS 作战机制 "中点判定…案例：阻挡，酒神1天赋的1.3溅射半径"): `enemiesInRadius(x, y, r, true)` counts
every enemy, a huge one too, by its position (the engine's profession splash and 炮手 aftershocks, and the kits' splash
centred on an enemy — 焰影苇草 S3's 灼痕 burst, 新约能天使 火力电台, 仇白 S1 留羽). Its position stays its 判定中心 (projectiles fly to it; its own
attacks, and splash centred on it, measure from it); body size plays no part in blocking or movement: every huge leader is 自缚 + 无法被阻挡 (PRTS 天赋; content/bosses.js
`SELF_BOUND` gives it a persistent `noMove` + `unblockable` buff at spawn — it stands where it spawns, its route is never
walked, so the rectangle stays on the pipe block). Content tests enemies only through the engine
queries above or `body.js` (`bodyInKeys`, `bodyOnTile`, `bodyInRadius`, `bodyDist`, `bodyTileReach`; wave-B modules via
`support/index.js` `onKeys` / `inRange`), never `rangeKeySet.has(tileKey(enemy))`; distance-scaled numbers (farther
targets take more damage, pull strength), movement, pathing, terrain under the enemy, tile-entry tracking, placement
heuristics and the range keys taken from blocked enemies (a huge enemy is never blocked) keep the position.

`unit.s` (lazy, recomputed after any buff change): `maxHp, atk, def, res, aspd, bat, interval, blockCnt, moveSpeed,
rangeExtend, blockRadiusScale (阻挡半径倍率 − 1: the air-block radius, §1.2), baseRangeExtend (its permanent part: persist +
never-expiring buffs), massLevel (base + ΣmassFlat, ≥ 0 —
`unit.weight`), maxTargets (+n), taunt, dodgePhys, dodgeArts, defIgnoreFlat/Pct, resIgnoreFlat/Pct, dmgDealtMul,
physDealtMul, artsDealtMul, dmgTakenMul, physTakenMul, artsTakenMul, trueTakenMul, elemTakenMul (元素损伤倍率: gauge fills),
elementalTakenMul (元素脆弱: 元素伤害), healingDealtMul, healingTakenMul, atkScaleMul, spRecovery, spCostFlat, redeployMul,
hpRegen, shield, flags{…}`.

Aggregation: `ATK/DEF/maxHp = (base + Σflat) × (1 + Σpct) × Πmul`, for ATK with the 最终加算 `ΣatkFinal` after the
percentages: `ATK = ((base + ΣatkFlat) × (1 + ΣatkPct) + ΣatkFinal) × ΠatkMul`; `res = clamp((base + ΣresFlat) × ΠresMul, 0, 100)`;
`aspd = clamp(base + Σaspd, 20, 600)` (floor 20: PRTS 数值范围 ATTACK_SPEED 默认下限; user playtest #6); `interval = bat × (1 + ΣbatPct) × 100 / aspd`; `moveSpeed = (base + ΣmoveFlat) × ΠmoveMul`;
tiles/s = `moveSpeed × MOVE_SCALE (0.5)`. A maxHp change keeps the HP ratio. Elite stats (module included) come from data.
The attack cooldown `atkCd` starts at `interval` and counts down by `TICK`; what is left within 1e-9 of 0 is 0
(`ai.js attackCountdown`, the tolerance of skill `timeLeft`, buff intervals and `every()`; PR #402 by @Cloudnyco, 0.2.2),
so an interval of a whole number of ticks takes exactly that many: 1 s = 30 ticks, 3 s = 90 (floating point alone left
2.1e-16 after thirty steps of 1/30, and every such attack came a tick late — 31, 91). The same countdown runs the 双眼皮
turrets (`content/devices.js`) and 寒檀's S2 icicles; the drones of 澄闪 / 荒芜拉普兰德 and 电弧's 赛柯 volleys compared
with 1e-9 already. Content clocks that count up and restart from 0 (the boss self-timers of `content/bosses.js`, kit auras)
are not covered. Official (PRTS 作战机制/sandbox 「帧对齐机制对攻速的影响」): the time unit is one frame, 1/30 s, and since
the 2019-12-24 update a non-integer frame count is rounded (四舍五入; before, 进一取整); an exact one stays. Here a
non-integer count still ends on the tick that crosses 0 — ⌈30 × interval⌉ ticks (1.2 s = 36, 1.25 s = 38; 能天使's
0.678 s is 21 here, 20 frames officially): an older difference from the official rounding, not changed by this rule.

**Which bucket (PRTS 游戏数据基础 属性基本公式 / 作战机制, DESIGN §20.10).** `Σpct` is the official **直接乘算** class — its
values are summed (`A = (A₀ + D_p)(1 + D_t)`, D_t = t₁ + … + tₙ): a skill's or talent's "攻击力+X%" **and** every "+X%"
ATK / DEF / max HP bonus of the 卫戍 systems — 盟约, 策略 (bands), 装备, 机变 cards, the per-layer 特质 (PRTS
卫戍协议：盟约 下半/PRTS盟约记录 "盟约效果，策略效果，装备效果提供的属性加成均为直接乘算"). Content builds those with
`content/support directMods({ atk, def, hp })` (constants.js `DIRECT_BONUS_STACKING` 'add'; 'multiply' = the v2.5
per-source ×(1 + x), which compounded with layers: user report after playtest #6). `Πmul` is for 最终乘算 / "提升至X%"
effects (炎佑 ×1.5 at 9 炎, 虚弱, 停顿 …), the char_attribute_mul 特质 ("攻击力和生命值+20%", a rune on the base
attributes) and the unit's 练度 `cultMul` (自持有, the same char_attribute_mul key, 0.2.2: ATK / DEF / max HP of the owned
operator's tier, §12). `atkFinal` is the **最终加算** (PRTS `A_f = F_t[(A + D_p)(1 + D_t) + F_p]`: added after the 直接乘算, inside
the 最终乘算): 阿戈尔's devoured base ATK ("基础攻击力（最终加算）", DESIGN §24.7) — a skill's ATK +% does not scale it.
Damage multipliers (`dmgDealtMul`, "伤害提升至X%"; `*TakenMul`, 脆弱 / "受到的伤害+X%") multiply each other
(PRTS 游戏数据基础 "同种倍率间叠乘"), same-named statuses keep the strongest — catalogue statuses (§3) and the content
effects routed through `battle.applyStrongest` (§3: 奥术, 灵知 坚冰, 莱恩哈特 / 缄默德克萨斯 RES cuts), also across the two
players of a pair field or two copies of one operator. A content buff keyed per unit (`key:${unit.id}`) still stacks
per source — DoTs and slows do that on purpose; a damage-taken / DEF / RES modifier on enemies should not.

---

## 3. Buffs, mods, statuses

`battle.addBuff(unit, { key, duration=Infinity, refresh='replace'|'extend'|'stack'|'independent'|'keep', stacks, maxStacks,
mods, flags, onTick(ctx), interval, onExpire(ctx), onRemove(ctx), tags, shield, shieldHits, shieldType, persist, visible, data, allowDead })`
- `replace`: new instance replaces the old; `extend`: keep the longer remaining time, take the new mods; `stack`: +stacks
  up to maxStacks, timer reset; `independent`: separate timers, at most `maxStacks` alive (oldest dropped); `keep`: ignore.
- Additive mods scale with stacks (`value × stacks`), `*Mul` mods multiply (`value ^ stacks`).
- `onTick({battle, unit, buff, dt})` every tick, or every `interval` s. `persist: true` survives death/redeploy.
- `shield` = HP absorbed (consumed, buff removed when empty); `shieldHits` = number of damage instances fully negated;
  `shieldType` ('phys' | 'arts' | 'true' | 'elemental') = a 屏障 that absorbs that damage type only (夜莺 S2 法术护盾 "能吸收…
  法术伤害"), or a list of them = those types only (机械师's 屏障 `['phys', 'arts']`: BlockDamage PHYSICAL_AND_MAGICAL — true
  damage passes); none = every type (PRTS 术语释义 屏障 "若无特殊说明，屏障可吸收全种类伤害"). Shields are spent oldest first.
- `visible: true` emits `['status', id, key, 1/0]` client events. `battle.removeBuff(unit, key|buff)`.

**Mod keys** — additive: `atkFlat atkPct atkFinal defFlat defPct hpFlat hpPct resFlat aspd batPct blockCnt rangeExtend
defIgnoreFlat defIgnorePct resIgnoreFlat resIgnorePct dodgePhys dodgeArts spRecoveryFlat maxTargets taunt hpRegen
hpRegenRatio spCostFlat moveFlat massFlat blockRadiusScale` (重量 levels: 失重 = `massFlat: −1`; never edit `base.massLevel`;
`blockRadiusScale` = 阻挡半径倍率 − 1, the air-block radius of §1.2);
multiplicative: `atkMul defMul hpMul resMul moveMul dmgDealtMul dmgTakenMul physTakenMul artsTakenMul trueTakenMul
elemTakenMul elementalTakenMul healingDealtMul healingTakenMul spRecoveryMul redeployMul atkScaleMul physDealtMul artsDealtMul`.
A `rangeExtend` on a `persist` never-expiring buff is **permanent**: it also widens the initial range (§7.1). It widens
a running skill's range too, unless that skill's range ignores 攻击距离 (`targeting.noRangeExtend`; PRTS 数值范围 "根据配置
不同，任何范围都可以受/不受该属性影响" — 信仰搅拌机 S3 "此技能的攻击范围不受“攻击距离”属性影响").
**Flags:** `stun freeze sleep silence disarm stealth stealthOff invulnerable unblockable levitate fear cold reveal bind noHeal
healFree untargetable blockFly noMove noSp burstLock hidden attract float noDisplace isolated groundbind camou liftoff` (`float` = 近地悬浮 (an air
unit, `Unit.isFlying`), `groundbind` = 缚地 (the status below: an enemy air unit counts as a ground unit), `liftoff` = an ally's 起飞 (蒂比's skills; gamedata_const ba.liftoff "不阻挡地面敌人且不会被地面敌人攻击，
可以阻挡飞行敌人"): it blocks no ground enemy (`Battle._blockerFor`) and has 对地规避 — no ground enemy (not `isFlying`)
selects it, so no selected damage or status of one lands on it (`targeting.js evadesGround`), while what selects nobody
still does (`ignoreSelect` / 无来源: 无视无法选择 abilities, direct picks, flying units' blasts, a debuff's ticks); flyers,
近地悬浮 and 浮空 enemies still select it,
with no 对空 check, since it stays a ground unit on its tile (`unit.ground` unchanged; PRTS 行动方式 "起飞的干员仍然是地面单位"),
`noDisplace` = 失衡免疫 (`displace()` moves nothing), `isolated` = 孤立 ("无法被同阵营选中": no ally
ability selects it — no heal, buff, aura or talent pick from another ally (`battle.allySelectable` / `alliesFor`,
`alliesInGrid`; PRTS 选择器 可选判定), enemies still target it; a summon's tokens.json `abnormal` 'isolated' also sets
`noHeal`, 'healFree' (禁疗) sets `noHeal` — Battle._setupUnit, DATA.md tokens.json; 禁疗 keeps heals off only — an HP-regen
attribute such as 安洁莉娜's 兼职工作 still applies, PRTS 异常效果; no self-heal reaches those summons but 伺夜 S2's 恢复 of
its 禁疗 狼群, which the skill text grants), flag `healFree` = 禁疗 that also stops the unit's own heals (`noHeal` stops
only other units' heals and heal picks): 史尔特尔's 余烬 sets both, shown as the status 'healFree' — only an HP-regen
attribute (`heal` opts `regen`) and a heal that "无视禁疗" (`ignoreHealFree`: her S3's start heal) reach her (PRTS 异常效果
HEAL_FREE "受到的治疗量变为0"; DESIGN §22.7), `stealthOff` = an enemy 隐匿 source switched off after a block
(`stealthOff:<source buff key>`, below), `camou` = 迷彩 (below)). `taunt: true` as a flag counts
as +1 taunt level (DESIGN §5.3).

**Statuses** — `battle.applyStatus(target, key, { duration, source, value, force, refresh, point, stackAs })` (returns true if
applied); a unit that is 无敌 and 无法选中 at once (flags `invulnerable` + `untargetable`: a 重生 in progress, a hovering or
永久无敌 leader part) takes no status from the other side, `force` included (PRTS 无敌 "无法被不同阵营选中" — so the status
a knocking-out hit carries, 妮芙 S2's fear say, does not land after the 重生's cleanse; since 0.1.1's QA); refused when
`source` is a ground enemy and the target an airborne 起飞 ally (对地规避, unless `ignoreSelect`); honours
enemy/op immunities (`stun`, `silence`, `sleep`, `frozen`, `levitate`, `feared`) unless `force`; fires
`beforeStatus` (cancellable; handlers may also change `ctx.duration` / `ctx.value`), then applies 抵抗 (`resist`, below)
and the 浮空 weight rule, then `statusApplied { source, target, status, duration (final), value, entered }` — `entered`
= the target carried no buff of that status before (a refresh / a weaker "取最高" application is not an entry: "进入…时"). Effects follow the official term table
(`gamedata_const.termDescriptionDict`, `ba.*`). Same-key statuses refresh to the longer duration, except the
"同名效果取最高" ones marked *strongest* below: the strongest value wins, a weaker application never overrides it and,
if it outlasts it, resumes when the strong one expires (pass `refresh` to opt out) — every such waiting application keeps
its own end, and they resume strongest first (`buff.data.tail` is a chain ordered by strength: of 30 % / 25 % / 20 %
applied one after another, the 25 % follows the 30 %, then the 20 % — GitHub #342, PR #348); `stackAs` = the strength such an
application competes with instead of its `value`, which stays its effect (Raidian S3's 虚弱: PRTS 备注 "在叠加时视为90%…的
虚弱（仅影响叠加优先级，不影响实际效果）").
`battle.applyStrongest(target, key, { duration, value, mods: (v) => mods, source })` gives a content effect that is not a
catalogue status the same rule (one invisible buff `key` per target whatever applies it — no immunity, 抵抗, status hooks
or icon): the engine default for two same-named buffs (PRTS 作战机制 "同名buff的默认叠加策略buff只能表现出一个"). 奥术 uses
it, so the two players of a pair field compete for one instance instead of multiplying, and so do 灵知's 坚冰 and the
莱恩哈特 / 缄默德克萨斯 RES cuts, once keyed per unit (DESIGN §20.10). 庇护 (gamedata_const ba.protect "受到的物理和法术伤害降低相应比例（同名效果取最高）") is one such effect whoever grants it: every kit holds it under the shared key (`kits/shared/tier1.js` `PROTECT` / `holdProtect`, mods phys / artsTakenMul ×(1 − v)) — 宴, 余, 缪尔赛思, 赫拉格, 左乐 and 赫德雷 since 0.2.0 (they used private multipliers that multiplied with each other) —, except 遥's bubbles (the client's damage_resistance[bonus], which multiplies with the common damage_resistance[inf]). "Strongest" = the largest |value|. PRTS 盟约记录's
奥术 note "※同一单位仅可对同一目标同时施加1个该盟约法术伤害提升效果" limits each unit to one instance per target; read with
the engine default — a newer same-named buff waits inert until the earlier ones end (PRTS 常见同名状态 "默认叠加方式") — and
巴哈姆特 12316 ("共享型buff會跟對面搶"), one instance is effective at a time, which is what applyStrongest keeps; strongest
rather than earliest is [ASSUMED]. Known deviation [ASSUMED]: an earlier revision of that note (oldid 386936) read
"同一单位在对同一目标施加的“法术伤害提升”效果的持续期间内，无法对该目标施加新的该盟约的法术伤害提升效果" — no re-application
while the unit's own instance lasts, so it would lapse 3 s after the first hit and return with the next arts hit —
whereas an equal-value hit here refreshes the instance to a fresh 3 s; slightly stronger (at most one attack interval
of coverage per 3 s), kept because the current wording no longer says so (feedback after 0.1.0).

| key | effect | value |
|---|---|---|
| `stun` | cannot act / move; **a stunned operator blocks nothing** (its blocked enemies are released: taken over by another operator in contact with room, else they walk on — §1.2 Blocking); a stunned enemy is still blocked by contact (晕眩 holds no 不可阻挡 — GitHub #232) | – |
| `freeze` | stun (a frozen enemy is still blocked by contact, as a stunned one); **enemies** also RES −15 | – |
| `cold` | ASPD −30; a 2nd cold while cold ⇒ `freeze` for max(remaining cold, the incoming cold after 抵抗) — PRTS 术语释义 寒冷 「持续时间取双方之中最高」 (`COLD_FREEZE_DURATION` 3 s only when neither side has a duration; unless frozen-immune). On an enemy (友方寒冷) the pair becomes that freeze and no cold is left — 「两两一对产生友方冻结」, so a lone cold on a frozen enemy waits for a partner (0.2.0; the 谢拉格 wind no longer freezes for good); on an operator (敌方寒冷) the longer cold stays on with the freeze. [ASSUMED] the one catalogue cold uses the 友方 max for an enemy-applied cold too | – |
| `sleep` | 无敌且无法行动: inactive, untargetable, **takes no damage** (unless the attacker profile has `hitSleep` or the damage `ignoreSleep`), blocks nothing; PRTS 异常效果 SLEEPING = 无法行动+无敌+**不可阻挡**: an enemy asleep **cannot be blocked and takes no block slot** — its blocker lets go at once (the slot frees for the next enemy), it stays where it is, and when it wakes it is blocked again only by a blocker with room, else it walks on (DESIGN §24.9) | – |
| `slow` | moveMul 1 − value (*strongest*) | default 0.5 |
| `sluggish` (停顿) | moveMul 0.2 | – |
| `bind` (束缚) | cannot move | – |
| `fragile` / `artsFragile` / `physFragile` / `elemFragile` | taken ×(1+value) (*strongest*); `elemFragile` = 元素脆弱 ("受到的元素伤害提升"): `elementalTakenMul`, 元素伤害 only — never the gauge | 0.3 / 0.3 / 0.3 / 0.2 |
| `silence` | no skill activation | – |
| `fear` (恐惧) | 无法被阻挡并四散逃跑: enemy cannot attack, is unblockable (released) and leaves its route: it runs between random checkpoints of the fan away from the source (§1.2 恐惧 movement; no source / itself ⇒ inside its own tile) | – |
| `tremble` (战栗) | 被阻挡后无法进行普通攻击: no normal attack **while blocked** (abilities still fire) | – |
| `palsy` (麻痹) | each stack cancels one enemy normal attack (max 3, lasts until consumed); refused by 麻痹免疫 (data `palsyImmune`); each cancel fires the hook `palsyTrigger` (§5) | stacks, default 1 |
| `disarm` | no normal attacks | – |
| `stealth` / `reveal` | 隐匿: untargetable unless blocked (an ally: only the enemy it blocks attacks it, and an enemy's area effects and buff auras skip it even when it blocks that enemy — `targeting.js areaSelectable` / `auraSelectable`, GitHub #97, owner 2026-10-04; 0.1.2 made an exception for that blocker) / cancels stealth. An enemy's 隐匿 also stays off after a block: each block's end (`Battle._stealthSwitch`, every release path) switches each of its 隐匿 sources off for `STEALTH_RESTORE` (3) s — PRTS 作战机制 §隐匿 "不被阻挡的3秒后重新进入隐匿" — or the source's own "（解除阻挡N秒后恢复）" (buff `data.stealthRestore`: 0 s for 业余竞演者, 节日爵士乐手, 假想敌：骨刺, 流泪小子, 访问团强攻冠军 and 清明's veil, 1 s for the 家族灭迹人 — and no less than 1 s for a 鸭爵 swap, spawn tag `'duck'`: `content/enemies/helpers.js DUCK_STEALTH_RESTORE`, the owner's decision of 2026-10-07, a deliberate deviation for its 流泪小子); a new block inside it lifts it again and its end restarts the window; our operators' 隐匿 / 迷彩 never lift by blocking (DESIGN §22.8). `targeting.js enemyStealthed` is the one test: the b.snap stealth bit is set only while its 隐匿 is on (drawn solid otherwise); an operator's radius area damage (`foesInRadius`) skips it too (PRTS 作战机制 §AOE伤害判定 "对攻击范围内的每个可以被选中的敌人进行判定"; until 0.1.1 the splash still hit it) | – |
| `camou` (迷彩) | an ally's camouflage (ba.camou "不阻挡时不成为敌方普通攻击的目标（无法躲避溅射类攻击）"): like `stealth` for enemy targeting (only the enemy it blocks attacks it) — but an enemy's splash and other area effects still hit it (`areaSelectable` does not check it) — and on screen (b.snap stealth bit, `snapshot.js flagsOf`), but not 隐匿 for 隐匿-conditions (叙拉古, 家族徽章) and under its own buff keys. 忍冬 S3 (key `vulpis:camou`, until her next cast), 寒芒克洛丝 S1 | – |
| `invulnerable` | ignores damage | – |
| `levitate` (浮空) | stun + unblockable (unblocks enemies) + 失衡免疫 (`noDisplace`); an air unit meanwhile (`isFlying`: melee cannot hit it); **half duration on units with (current) massLevel > 3**; refused on data flyers (`motion` FLY) that hold no 缚地 and on units already levitated (PRTS 异常效果 "若单位数据上为飞行单位且不持有缚地异常或是持有浮空异常则Buff取消") — a 近地悬浮 enemy is WALK in its data, so it can be levitated; 浮空 is not one of the 近地悬浮 enemies' drop triggers | – |
| `groundbind` (缚地) | gamedata_const ba.groundbind "目标变为地面单位，无法移动；使部分近地悬浮敌人掉落；对重量大于3的单位持续时间减半": an enemy air unit (data flyer, 近地悬浮) counts as a ground unit (`isFlying` false: melee operators hit it, ground blockers block it) and cannot move (`noMove`); **half duration on units with (current) massLevel > 3**; one of 抵抗's statuses [ASSUMED, as 束缚]; the drop trigger of 掠海漂移体 / 吉兆飞鳞 (content/enemies: "受…缚地影响后"). 予愿安洁莉娜 S2 (kits/ops/op-aglna2.js) | – |
| `attract` (诱导) | 无法被阻挡并向目标位置移动: unblockable (released); the engine walks it (own speed, grid path re-planned on obstacle changes, after a push and after an outranking 恐惧; flyers straight) to `opts.point` (`[r, c]` or `{x, y}`, default the source's tile, clamped to the rect) and keeps it there; stun/bind/sleep stop it; its route re-plans from where it stands when the status ends. A new application moves the point | point |
| `resist` (抵抗) | the control statuses of `RESIST_STATUSES` (晕眩 冻结 寒冷 沉睡 恐惧 战栗 诱导 浮空 束缚 沉默 缴械 停顿 减速 缚地) applied to the unit last ×(1 − value); a resisting unit loses one 麻痹 stack every 5 s. **同名效果不叠加** — `battle.resistOf(u)` = the strongest `status: 'resist'` buff (never a product): several sources (灵知, 流明, 寒檀, enemy talents) never compound. *strongest*; a permanent one that survives death is a `persist` buff with `status: 'resist', data: { value }` | 0.5 (≤ 0.95) |
| `taunt` | taunt level +value | 1 |
| `weaken` | atkMul 1 − value (*strongest*) | 0.3 |
| `aspdDown` | aspd + value (*strongest*) | −30 |
| `defDown` / `resDown` | defMul 1 − value / RES −value (*strongest*) | 0.3 / 20 |

Unknown keys become a flag buff `{ [key]: true }`. Flags `noBlock` (blocks nothing) and `tremble` exist for custom buffs;
a custom buff with `flags.sleep` also blocks nothing, is untargetable/invulnerable and, on an enemy, cannot be blocked
(its blocker lets go on the enemy's next update: `ai.js updateEnemy`) like the status. `noNewBlock` = the
unit takes no new enemy by contact (`Battle._blockerFor`) and keeps the blocks it holds — content hands it its blockees
(酒神's 迷狂牢笼, kits/ops/op-phatm2.js: PRTS "只在生成/刷新时判定阻挡新的敌人"); `undying` = a content 不死 window (淬羽赫默 S3,
kits/ops/op-slent2.js — its own `fatal` hook holds it), which items/battle.js `holdsUndying` reports like 坚固维式重锤's.

**Element gauges** (`unit.elem = {burn, neural, apoptosis, erosion, necrosis}`; capacity `unit.gaugeMax` = 1000, enemy
leaders (rank BOSS / boss units) 2000): deal `{ type:'element', element, amount }` (fires `elementHit` first; the gauge
gain is amount × `dmg.mul` × `elemTakenMul` (元素损伤倍率: "受到的元素损伤提高/降低…") × max(5 %, 1 − 损伤抵抗 / 100),
损伤抵抗 = the target's data `epResistance` — PRTS 元素 "受到的元素损伤 = 损伤值 × (1 − 损伤抵抗 × 0.01)，
后续可应用元素损伤倍率", with the 5 % floor of DMG_e (PRTS 游戏数据基础 "目标受到元素损伤时也可以使用该公式计算，只需要将 D 值
改为目标的损伤抵抗即可"); `elementIntake(unit)` in damage.js returns that factor, applied after `elementHit`). 元素脆弱 never
scales it, no gauge decays (EP_RECOVERY_PER_SEC 0), and every enemy in data/enemies.json has 损伤抵抗 0 except 转译基底·α
(10); operators have none.
Enemies deal ATK × their talent's `ep_damage_ratio` per hit (content/enemies/archetypes.js `ep`). A full gauge bursts with the
official effects, which depend on the side hit (constants.js `ELEMENT`); burst damage is **无来源** (DamageInfo
`sourceless`, PRTS 伤害分类 "无法被追溯伤害来源": no damage-dealt multiplier or penetration of the unit that filled the
gauge, and the `hit` / `damaged` / `fatal` hooks see `source: null` — no attacker-keyed content applies — while the ctx's
`credit`, the stats and the kill keep that unit; target-side reactions with no source condition read `source || credit`:
damage sharing — 圣杯, 盲信之誓, 余音 — and 抵挡 — 星熊 战术装甲, 拉普兰德 日晷, whose "enemy damage" guard is otherwise
the source's side):

| element | operator hit by enemies (ba.dt.*) | enemy hit by operators ("·我方" ba.dt.*2) |
|---|---|---|
| `burn` 灼燃 | 1200 arts + RES −20, 10 s lock | 7000 元素伤害 + RES −20, 10 s lock |
| `neural` 神经 | stun 10 s, then 1000 true (10 s lock) | 3 `palsy` (none with 麻痹免疫), then 6000 元素伤害, 10 s lock |
| `apoptosis` 凋亡 | 15 s: 阻回 (`noSp`: no SP gain of any kind, skills.js) + 静默 (no skill activation), −1 技力/s — of `spTotal`, stored charges included (PRTS 技能 可充能 "当持有者的技力流失时，充能次数也会实时降低"; `setSpTotal`, a running timed skill untouched; PR #262), 100 arts/s | 15 s: 50 % weaken recovering over the burst, 800 元素伤害/s |
| `erosion` 侵蚀 | permanent DEF −100 (stacking `erosionDown`) then 800 phys, 10 s lock | permanent DEF −120 then 5000 元素伤害, 8 s lock |
| `necrosis` (legacy spare gauge) | 12 s: 100 true/s, ATK −20 % | same |

The lock (`<el>Burst` buff, flag `burstLock`) is the official **爆发冷却**: while it runs NO element of the unit fills or
can be recovered (`battle.reduceElement(unit, amount, el?)` removes nothing) and the bursting gauge shows full; when it
ends EVERY gauge of the unit resets to 0. A burst that is still resolving counts as locked too (`unit.burstPending[el]`,
`burstLocked(unit)` in damage.js — it takes no element): the `elementBurst` hook fires before the lock buff exists, so
fills of that unit are refused until the burst has resolved — an `elementBurst` handler that spreads the element to
neighbours (淤困 parasite) cannot bounce it back into a second burst. `elementView(u, now)` (damage.js) is the one gauge
a unit shows (b.snap `elem`, §9): the fullest one, ties by the official element id (`constants.js ELEMENT_ORDER`: 神经,
侵蚀, 灼燃, 凋亡, then the legacy `necrosis`), with its fill rounded DOWN to 1 % and kept within 0.01–0.99 — the remainder
the client draws (the white bar, 1 − fill) is never less than what is left (except that a first chip of less than 1 %
already shows as 1 % taken), so it only runs out when the gauge bursts (user playtest #6); during a 爆发冷却 the bursting
element with fill 1 and the cooldown's end (the client draws that refill in the element's colour, not white).
**元素伤害** (element HP damage, e.g. "每秒受到…元素伤害") is the DamageInfo type `'elemental'` (+ optional `element` for the
client colour): no DEF/RES/dodge — 元素抗性 instead (the target's data `epDamageResistance`, `max(A × (1 − D/100), 5 %A)`,
PRTS 游戏数据基础 DMG_e; 0 on every enemy in data/enemies.json) —, × source `dmgDealtMul` × target `elementalTakenMul`
(元素脆弱) only — the target's `dmgTakenMul` (脆弱, ba.fragile "受到的物理、法术、真实伤害提升", and the other "受到的伤害±"
effects [ASSUMED: they share that multiplier]) does not scale it —, shields absorb it. An element fill on a target with no
HP left is refused (damage.js `hasHp`: a lethal hit's `damaged` hook runs before `battle.kill`, while the target is still
`alive` at 0 HP — no burst on the corpse). **Element healing** (`battle.reduceElement(unit, amount, el?)`) lowers element
`el`, or every element type, each by `amount` on its own (PRTS 菲莱 备注: 清除元素损伤 = "一次等同于自身最大元素值的全类型元素
损伤治疗").

---

## 4. Damage & heal pipeline

`battle.dealDamage(source, target, dmg)` → HP removed. `DamageInfo = { amount, type:'phys'|'arts'|'true'|'elemental'|'element',
element?, defIgnoreFlat, defIgnorePct, resIgnoreFlat, resIgnorePct, mul=1, canDodge (phys/arts), isSkill, isSplash,
isAttack, isProjectile, attackId, ignoreSleep, ignoreSelect, sourceless, tags[], cancel }` (`isProjectile`: 远程途径 — an
enemy normal attack that flew as a projectile (ai.js enemyAttack; PRTS 作战机制 "有弹道的攻击固定为10，无弹道的攻击固定为01")
and 怒潮凛冬's 高台 splash (PRTS "被视为远程途径伤害"); every other hit is 近战途径 — what only melee-path damage triggers
reads it: 薇薇安娜's 散华 护盾, kits/ops/op-vvana.js; `ignoreSelect`: no selection 无法选择
effects stop — an ability "无视无法选择", a direct pick such as a counter on the attacker, a flying unit's blast credited to
a ground leader, the tick of a debuff already on the unit — it reaches an airborne 起飞 ally whatever its source;
`sourceless`: 无来源 damage — the source's stats add nothing and the hooks get `source: null` plus `credit` = the source,
which keeps the stats and the kill; a `loseHp` whose `from` is 无来源 is 无来源 too; element bursts, leader-part transfers and 坚守 thorns use it — content damage that has a
responsible unit should pass it as `source` with `sourceless: true` rather than `source: null`, which credits nobody)
(`battle.makeDamage(d)` normalises). `attackId` is the same for every
damage instance of one normal attack (all targets, splash, chain, projectile impacts; 0 for non-attack damage) — use it
for "本次攻击" procs that must roll once per attack. **Dodge** from several buffs rolls independently: the unit's
`s.dodgePhys` = 1 − Π(1 − pᵢ) (a single source keeps its exact value).
Order: invulnerable / asleep / 对地规避? (a ground enemy's damage or element fill on an airborne 起飞 ally — flag `liftoff`,
`targeting.js evadesGround` — is refused unless `ignoreSelect` or 无来源: it cannot select her, so its splash and area
abilities skip her and a shot in flight when she took off lands on nothing [ASSUMED: PRTS 伤害流程 7 "取消掉隐匿/无敌状态
下的攻击" read for 对地规避]; the ticks of a debuff already on her select nobody and land (content passes `ignoreSelect`;
PRTS 异常效果: 无法选择 effects "仅在选择时生效"); checked before `hit` only — 蒂比 S2 takes off inside the
`hit` of the attack that set it off, which resolves as usual) → **`hit`** (mutate `dmg`, set `dmg.cancel`) → dodge
(`rng()`) → mitigation (phys
`max(A − max(0, D×(1−defIgnorePct) − defIgnoreFlat), 5 %A)`, arts `max(A×(1 − R′/100), 5 %A)`, elemental
`max(A×(1 − 元素抗性/100), 5 %A)`, true = A; source ignore mods are added) → × source `dmgDealtMul` (× phys/artsDealtMul)
× target `dmgTakenMul` (not for elemental) × type-taken mul × `dmg.mul` (a `sourceless` hit skips every source term) →
**限伤** (`leaderHitCancelled`: on a leader — `isBoss`, the tag-'boss' units: data/bosses.json `enemyKey`, the official
`IsBossEnemy` list, and their mirrored copies; never parts, escorts, drones — in a `'boss'` / `'hidden'` battle, a hit
with `ceil(final) ≥ BOSS_HIT_LIMIT` (300000, shared/constants.js) is cancelled whole: returns 0 before shields (阿利斯泰尔's
`boss:vest` barrier stays untouched; a `hit`-step block such as 假想敌：再生's aura acts earlier) [ASSUMED order], no HP /
pool loss, no credit or stats, no `dmg` event, no `damaged` / `fatal` / kill; an fx `hitCap` `{ id, n }` marks it and
draws nothing; research 11) → shields (a typed one — buff `shieldType` — only for its damage type) → **`hpDamage`** (what
passed the shields; a handler may only lower `amount` — the 伤判效果 that act after a barrier: 煌's 紧急除颤 HP floor, PRTS
备注 "该伤害减少(伤害值-煌当前生命值+煌最大生命值×50%)点"; 左乐's 庇护 re-applied after his 行险 barrier; never for a 流失) → HP loss
(boss units: routed to `sharedBoss.damage(playerId, amount)`; a pool left under 1 HP is emptied) → if HP ≤ 0: **`fatal`** (`ctx.prevented = true` keeps the
unit at ≥ 1 HP) → **`damaged`** → SP-on-hurt / TAKE_DAMAGE → `kill` + `death`.

`battle.heal(source, target, amount, { overheal=false, self, silent, regen, ignoreHealFree })`: no-op on `noHeal` targets
(unless self — 禁疗 / 孤立 summons carry the flag, §3) and on `healFree` ones, self included (史尔特尔's 余烬), unless `regen`
(an HP-regen attribute tick) or `ignoreHealFree` (a heal that "无视禁疗"); a healer whose profile names the target in
`healThrough(healer, target)` heals it through the `noHeal` flag and `healFree` (not a profile's `noHeal`), and its heal
selection (`injuredAlliesInKeys`) takes it — 凯尔希 on her Mon3tr (PRTS "持有禁疗（可被凯尔希…无视）");
× source `healingDealtMul` × target `healingTakenMul`; **`heal`** hook (mutable amount); capped at max HP; a `regen` tick
— the unit's own 生命回复速度 (`s.hpRegen`, applied in the buffs phase) — is no 治疗 (PRTS 调香师 / 瑕光 / 铃兰 / 锡人 备注
"不受治疗加成和禁疗影响"): no multiplier, and the hook sees it (`opts.regen`) but cannot change its amount. Effects PRTS
describes as raising the target's 生命回复速度 are hpRegen buffs, never `heal` calls, so 禁疗 and 无法被友方治疗 (`noHeal`:
收割者 / 不屈者 / 武者) do not stop them: the 吟游者 trait (professions.js `bardRegen`, 分支特性信息 吟游者; 魔王's 微尘 ×1.5
through its `bardRegen` hook; 浊心斯卡蒂 and her 海嗣), 调香师's 熏衣草, 瑕光 S2, 铃兰 S3 (none in its first second, refreshed
every second), 锡人's 炼金单元 (GitHub #96 / #137) and 引星棘刺's S1 / S2 炼金单元 (the same wording and blackboard key as
锡人 S2; a community report, 0.2.2); `overheal`
turns the excess into an `overheal` shield. `battle.loseHp(target, amount, { source, from, tags, silent, sourceless })` = HP
loss ignoring DEF/RES/shields/dodge (流失); `sourceless: true` makes it 无来源 ("受到等量的无来源生命流失": hooks see no source,
`source` keeps the credit — stats and the per-player shared-pool tally), as does a 无来源 `from`. A 流失 skips the damage
events (PRTS 作战机制 "生命流失不会触发反伤、受击回复等受到攻击触发的时点"): no `hit`, no 受击回复 SP, no TAKE_DAMAGE; its
`damaged` ctx carries the tag `'hpLoss'` (and `noSp`; `damage.js isHpLoss`), and "受到伤害时" content skips it (信仰搅拌机 S3
counters, 雷蛇 战术防御, 乌尔比安 本性的坚守, 录武官's guard, 远牙's 未受伤害 timer, 伪装服, 坚守 thorn chances, 机变 自愈) —
while it counts every real damage instance, 无来源 ones included (a zone tick, the 源石溶剂 drain; 蒂比 S2 "受到伤害前
触发"). Use it only for what the official calls 流失 — operator skill / trait 流失 (华法琳, 史尔特尔, 瑰盐 …), 阿戈尔's 物理流失,
a leader part's 传递 and the 胄 drone link ("无来源生命流失") — and, [ASSUMED] for want of an official word, 心烛's transfer
and 扎罗's 溶血骇惧; "受到N真实伤害" over time is damage (PRTS 伤害分类: BUFF damage, "自残类型" included) — the official
`periodic_damage` template (源石溶剂: PRTS 盟约记录 修正 "并非流失", "造成无来源真实持续环境伤害"; 狂暴宿主 "自身每秒受到N无来源
真实伤害"), 码头水手's drowning ("每秒受到1000点无来源真实伤害"), 弧光锋卫's 失衡 bleed (修正 "失衡移动时持续受到真实伤害") and
孽罪奇美拉's aura are `dealDamage(credit, target, damage.js periodicDamage(n))`: 无来源 true, `canDodge: false`, tags
`'dot'` / `'periodic'` (player report D1). Terrain ticks (`content/devices.js`): 深水区's 【水蚀】 is the same kind (PRTS 涨潮控制
深水 "无来源真实持续伤害（不属于环境伤害，不会触发受击回复）": `noSp`, tags `'dot'` / `'periodic'` / `'deepsea'`); 活性源石's is
无来源 true damage tagged `'terrain'` — 环境伤害 (PRTS 自然环境), what "受到来自自然环境的伤害" content (纠缠藤蔓) reads — and
not `'dot'` [ASSUMED] (DESIGN §22.4). The 源石溶剂 drain also ticks on every 敌人类我方单位 of the field (炎佑, a
partner's too: PRTS 备注 "全场范围内的所有敌人类我方单位也会获得此装备的…效果…无视目标可选性"), credited to nobody, once per
second however many carriers (PRTS 作战机制 "同名buff的默认叠加策略buff只能表现出一个"), while a carrier is on the field
[ASSUMED]. 奥术法阵 has the same 备注 for its rider: while a carrier is on the field, every damage instance of such a unit
silences its target for the item's 5 s ("造成伤害时使目标失去特殊能力5秒"; since 0.1.1). On a leader
in a boss / hidden battle a loss of ≥ `BOSS_HIT_LIMIT` (a part's 传递) is cancelled like a hit; 胄's drone link — 2 % of the
pool, a share that is no hit — passes it (`loseHp` `noHitLimit`, DESIGN §25.13.4 [ASSUMED]). Every HP-damage kind
meets the limit (phys / arts / true / 元素伤害 incl. element bursts, DoT ticks); element 损伤 (the gauge, `type: 'element'`)
removes no HP and never does.

---

## 5. Hook bus

`battle.on(name, fn(ctx, battle), { priority=0, owner, once })` → handle; handlers run in descending priority, then
registration order. `battle.off(handle)` / `battle.off(name, fn)` / `battle.offOwner(owner)` (also cancels timers);
`battle.emit(name, ctx)` (custom events allowed); `ctx.stopPropagation = true` stops later handlers.

| name | ctx | notes |
|---|---|---|
| `battleStart` | `{}` | after the initial deployment |
| `deploy` | `{ unit, initial, move? }` | ops/tokens (initial & redeploy), enemies (`initial:false`), devices; `move: true` = a 【移动】 (`moveRedeploy`: 乌尔比安 S3 — no exit before it, the unit keeps its buffs) |
| `tick` | `{ dt }` | end of every tick |
| `beforeAttack` | `{ attacker, targets, isSkill, profile }` | allies **and** enemies; replace/filter `ctx.targets` |
| `enemyAttackStart` | `{ enemy, targets }` | an enemy starts a normal attack (it has targets), **before** 麻痹 may interrupt it (ai.js enemyAttack; the client's ON_BEFORE_ABILITY_SPELL_ON): a burst a handler causes interrupts that very attack (酒神 堕梦, PRTS 备注 "触发的元素爆发可打断当次普攻"); a handler that kills or stuns the enemy ends it |
| `attack` | `{ attacker, targets, isSkill, targetDeployments? }` | an attack/heal was performed (projectiles may still be in flight). Normal enemy attacks provide a `Map<Unit, deploySeq>` captured before their damage; post-attack control effects must not cross a target redeployment. |
| `hit` | `{ source, target, dmg, credit }` | before mitigation; mutate `dmg` (not fired for gauge fills — see `elementHit`). `source` may be null (terrain; 无来源 `dmg.sourceless` bursts, whose `credit` names the unit credited) |
| `elementHit` | `{ source, target, dmg }` | before a gauge fill (`dmg.type === 'element'`); mutate `dmg.amount`/`dmg.mul`, set `dmg.cancel` |
| `damaged` | `{ source, target, amount, type, dmg, credit }` | after application (`amount` may be 0 when shielded); element fills too (with their source); 无来源: `source` null, `credit` set |
| `hpDamage` | `{ source, target, amount, dmg, credit }` | a damage instance after shields, before the HP loss (§4; not a 流失): lower `amount` only (a raise is ignored) — HP floors / reductions ordered after a barrier (kits/ops/op-huang.js, op-zuole.js) |
| `heal` | `{ source, target, amount, opts }` | mutable `amount` |
| `fatal` | `{ unit, source, credit, dmg, amount, prevented }` | HP would reach 0 — set `prevented` (substitutes, kit savers, 不死 items; the 复活 — M3茧甲, 埃芒加德 — and 不屈 are `death` hooks). Fired by every HP loss of a unit without a boss pool — hits of any type, element bursts, 无来源 damage, `loseHp` 流失. Order: kits' own savers (10 … −60) → items' 不死 (坚固维式重锤 — once per deployment: `items/battle.js deploymentOf`, a key every deploy changes (a 复活's redeploy too); one battle-level hook holds the running windows (`holdsUndying`), so a window outlasts a lend, DESIGN §21.21 — the lock `PRIO_REVIVE` −100 after the substitutes (−100, registered first), the running windows `PRIO_UNDYING_HELD` −99 before them: a 傀儡师 holding 不死 does not switch, PRTS 分支特性信息 傀儡师 "未持有不死的情况下", DESIGN §22.11) → 淬羽赫默 S3's 不死 (−100.5: PRTS 衍生生命 "无畏者协议提供的不死效果仅在目标没有不死效果时才会触发"; its running windows held at −99 like the hammer's). The 复活 act on the knock-out after this step (PRTS "复活" acts on a knock-out, which a 不死 prevents): `death`, below |
| `dollSwitch` | `{ unit, reason, done }` | content switches a 傀儡师 to its <替身> now (归溟幽灵鲨 S2 "技能结束后立刻切换为<替身>": no lethal HP loss); its trait does it unless it already is one or is not on the field, and sets `done` |
| `dollSwap` | `{ unit, form }` | a 傀儡师 starts a switch — to its <替身> (`form` `'doll'`) or back to its <本体> (`null`); not when it is knocked out as the 替身 (不屈 rolls on it: "切换<替身>与<本体>时"). 远牙's granted `garrison_108_a/b` gains on it too (player-confirmed, DESIGN §28.5), sharing its deployment cap and active-bond checks. |
| `kill` | `{ killer, victim }` | victim HP reached 0 (a handler may revive by restoring HP) |
| `death` | `{ unit, reason:'killed'|'leak'|'retreat'|'merchant'|'expired'|'forcedExit', killer, dying, revivedBy? }` | unit removed (`'forcedExit'`: an operator entering 联防 knocked out, §1.1; `dying`: a `retreat` that plays the death animation — 史尔特尔's 余烬, 骑士戒律 + 竞技旗). Revives of a knock-out redeploy the operator inside it, free, where it lies — PRTS "“复活”的实现方式为：受益者因移动之外的原因退场时下次部署的再部署时间和费用归零", so the 被击倒时 and 部署时 effects both run (a deploy-timed skill — `activateOnDeploy` — starts anew: a 突袭 member with one jumps at once, DESIGN §25.17.5): M3茧甲 (`PRIO_RESPAWN` 13) → 埃芒加德 (`PRIO_BAND_REVIVE` 12) — `items/battle.js reviveNow`, which sets `revivedBy` ('item' / 'band'; 阿戈尔 5 does not count such a knock-out as the member's first) — → 阿戈尔 5 (11; a knock-out by the battle-start devour waits for the last devour pass, then the knocked-out members go by board position, DESIGN §25.22.5) → 不屈 (10); until 0.2.0 the two 复活 were `fatal` savers that kept the unit standing |
| `skillStart` / `skillEnd` | `{ unit, skill, reason }` | mutate `skill.ammoLeft` / `skill.timeLeft` in skillStart (bullets added there raise `skill.ammoMax`, the ammo bar's full mark) |
| `ammoUsed` | `{ unit, left, skill }` | per ammo consumed |
| `spGain` | `{ unit, amount, reason:'time'|'attack'|'hurt'|'init'|…, skill }` | mutable `amount` (time gains fire every tick) |
| `beforeStatus` | `{ source, target, status, duration, value, cancel }` | set `cancel` (e.g. 浓缩嗅盐) |
| `statusApplied` | `{ source, target, status, duration, value, entered }` | after immunity check; `duration` = final (after 抵抗 / weight); `entered` = newly started (not a refresh) |
| `blocked` | `{ blocker, enemy }` | enemy became blocked |
| `enemySpawn` / `enemyLeak` | `{ enemy }` | |
| `elementBurst` | `{ source, target, element }` | before the burst's lock/effects; same-element fills of `target` are already refused |
| `palsyTrigger` | `{ enemy, buff, keep }` | a 麻痹 stack interrupts the enemy's normal attack ("触发麻痹"), before the stack is used: set `keep` to leave it (真言 噤声限域); a handler may kill the enemy (its turn ends) |
| `dodge` | `{ source, target, dmg }` | an attack was dodged |
| `boomerangCaught` | `{ unit, attackId, isSkill, x, y }` | a 回环射手 boomerang came back to its thrower (`ai.js throwBoomerang`; `isSkill` = thrown by a skill attack): 娜仁图亚 LPS-Y "每回收5次回旋投射物", S3 "投射物全部回收时" |
| `layerGain` | `{ playerId, bondId, n, reason, source, tile }` | mutable `n` before recording (魔王 +1 …), then clamped to the room left under `BOND_LAYER_CAP` (999); not emitted for a bond already at the cap; `tile` = `[r, c]` where `source` stands — or was knocked out this very instant ("被击倒时" gains) — else null (`addLayers` opts.tile overrides) |
| `merchantPay` | `{ unit, cost, cancel }` | a merchant (行商) is about to pay its periodic DP; change `cost` or set `cancel` |
| `battleEnd` | `{ result }` | may still add layer gains / coins |

**Re-entrancy rule for content.** A handler that deals damage from `hit`/`damaged` (counters, reflection, sharing,
"bonus damage on hit") must not react to its own output or to other reactive damage, or two such effects ping-pong
until the nesting guard trips (the guard then skips *every* nested handler, including `kill`/`death` bookkeeping of
content). Respond only to `dmg.isAttack` (normal attacks), tag your damage (`tags: ['counter']`) and skip tagged damage,
or guard with a per-unit flag while dealing it. The "受到攻击时" counters take the second way: the official ones fire on
every damage instance from an enemy (ON_TAKE_DAMAGE — its attack, a skill hit, 深溟巢涌者's pulse; never a 流失), so they
answer `kits/shared/tier1.js byEnemyAttack` (星熊 S2, 泡泡, 刺玫 S2, 余 S1, 玛恩纳 无动于衷, 年 S2, 斩业星熊; 菲莱 S2 any
instance) and skip `'counter'` / `'reflect'` damage. When the guard trips, the logged error names the open frames
(`chain: hit(enemy_x→chess_y) > damaged(chess_y) > …`).

---

## 6. Engine helpers (content must use these)

| helper | notes |
|---|---|
| `dealDamage(src, tgt, dmg)`, `heal(src, tgt, amount, opts)`, `loseHp(tgt, amount, {source, from, tags, sourceless})` | §4 |
| `applyStatus(tgt, key, {duration, source, value, force, point, stackAs})`, `removeStatus(tgt, key)`, `resistOf(unit)` | §3 |
| `applyStrongest(tgt, key, {duration, value, mods, source})` | §3 — "同名效果取最高" for a non-catalogue effect |
| `addBuff(unit, buff)`, `removeBuff(unit, key)` | §3 |
| `spawnToken(ownerUnit | playerId, tokenId, row, col, { def, stats, hp, duration, untargetable, dir, kit, force, anySource })` | field tiles; def from data/tokens.json `variants[ownerChessId]` for the owner unit's selected skill / module (`tokenDef`); `dir` defaults to the owner unit's (else the player's: RIGHT, mirrored side LEFT; a legacy `facing` ±1 is still read); returns the token or null (tile busy; or the owner runs a **non-default** skill that does not produce the token — `producesToken` — unless `anySource`: kit install hooks written for the default skill run under every skill). `spawnDevice(key, row, col, { …, dir })` likewise |
| `tokenDef(tokenId, ownerUnit | chessId)`, `producesToken(ownerUnit, tokenId)` | the token def a summon of that owner gets — `getToken(id, owner.defId, owner.def.loadout)`, exact even when two players of one field give the same chess different loadouts (prefer it over an id-only `battle.data.getToken(id, unit.defId)` for summon stats / blackboards); whether the owner's loadout makes the token (DATA.md §14 `sources` has 'skill' or 'talent'; true when the data does not tell: no own variant, player-owned summons) |
| `spawnEnemy(enemyKey, { routeIndex, route, pos, mods, tag, sourcePlayerId, ownerPlayerId, bounty, countInTotal, inTotal, def })` | returns the enemy, or null past `MAX_ALIVE_ENEMIES`; `def` = inline record (enemies.json shape or normalised) for keys missing from data. A runtime spawn is never `inTotal` (§1.3 — the HUD capsule's own set) unless content passes `inTotal: true` explicitly |
| `spawnDevice(key, row, col, { hp, obstacle, blockCnt, name, def, res, atk, bat, aspd })`, `setObstacle(r, c, on)` | obstacles re-path enemies; spawnDevice returns null outside the rect, on a living unit or on a knocked-out operator's tile |
| `isReservedTile(r, c)` | true when a living unit stands there or it is the rest tile (`restTile`) of an ally piece that has not deployed yet / waits to redeploy — the tile a knocked-out operator lies on, else the home tile — every automatic picker (the 突袭 landing tile, tactical points, summon / device tiles) must skip these (`findTacticalPoint` does) |
| `downOn(r, c, except?)`, `restTile(u)` | the down operator (`isDown`: knocked out or forced out) lying on a tile (no ally deploys / moves there: `_deploy`, `spawnDevice`, `relocate`); the tile a withdrawn ally comes back on — its `body` tile when down, else its home (§1) |
| `addProjectile({ from, target | to:{x,y}, speed, onHit(ctx), visual, source, hitDead })` | homing; fizzles if the target dies unless `hitDead` |
| `allySelectable(ally, by)`, `alliesFor(by, ownerId?)` | may an ability of ally `by` select `ally` — never a 孤立 unit (炎佑, 从不混淆的方向) but `by` itself (PRTS 选择器: "若掩码中孤立为1，且选择器的阵营与目标为友好关系，则不可选中"); `allies()` without the 孤立 ones — content picks ally targets (buffs, auras, 全场 talents, heal picks) through these, `alliesInGrid` too |
| `unitsInGrid(unit, grid, {side, extend})`, `alliesInGrid(unit)`, `enemiesInRadius(x, y, r, centre?)`, `foesInRadius(x, y, r, centre?)`, `alliesInRadius(x, y, r, ownerId?)` | grid offsets are relative to facing RIGHT, rotated by `unit.dir`; enemies by their body (§2 hit areas: a huge enemy on every tile it occupies / within `r` of its rectangle; `centre` = splash around a target, a 中点判定 by position; `foesInRadius` = the enemies an operator's area effect can select — no untargetable enemy, none whose 隐匿 is on (`targeting.js enemyStealthed`: not blocked, not revealed, not within 3 s of its last block), PRTS 作战机制 §AOE伤害判定 — while enemy-side auras / heals and collisions keep `enemiesInRadius`) |
| `enemiesInKeys(keys, attacker, profile)`, `blockedTargets(unit, profile)` | targetable enemies whose body is on the tiles (a huge one listed once); the enemies a unit blocks — always selectable by it, a ranged operator on a melee tile included (§1.2 Blocking) |
| `setAllyTarget(unit, on)`, `allyTargetsInKeys(keys, attacker)`, `isAllyTarget(unit)` | an **ally target**: an ally unit our attacks select like an enemy — 白铁's 铁钳号·原型机, a summon of the enemy camp ("可被我方干员攻击但不受伤害", PRTS; kits/ops/op-ironmn.js). The attack loop (ai.js `acquireTargets`) appends the registered ones standing on the attacker's range after every enemy (their 嘲讽等级 −2 puts them last: one target ⇒ an enemy first; all in range / more targets ⇒ them too) and ranged attacks fly to them; heals, skills that pick their own victims and enemies never select them (the kit gives it `untargetable` against enemies and cancels the damage it takes in its `hit` hook). A skill that acts on them counts the registered ones like enemies for its automatic start (skills.js `_allyTargetIn` / `allyTargetsOk`, every enemy condition of the trigger rules — the owner's rule of 2026-10-08): one that acts through the unit's own attacks, or whose kit flags `allyTargets: true` because its selectors take them too (`allyTargetsInKeys` / `allyTargetsInRadius`: 蕾缪安 S3's locks, 艾丽妮 S3, 陈 S2, 引星棘刺 S2); [ASSUMED] a skill that picks its victims among enemies only (or whose kit says `allyTargets: false`) is not opened by them and waits for an enemy. None registered ⇒ the loop is unchanged |
| `allies(ownerId?)`, `aliveEnemies()`, `unitAt(r, c)`, `unitById(id)`, `tileInfo(r, c)`, `lowestHpAllyInRange(unit)` | |
| `addLayers(playerId, bondId, n, reason, {source})`, `addCoins(playerId, n)` | layers are a no-op when `flags.layerGainsEnabled` is false (unite/boss); a gain adds at most the room left under `BOND_LAYER_CAP` (999, shared/constants.js `layerGainRoom`: the client's `AddBondCount` min(L + n, 999)) on the live copy — or, without one, on the battle's own gains — and returns what it added (0 at the cap: no hook, no event) |
| `getPlayer(playerId)` | `{ playerId, seat, side, colOffset, mirror, dir (default unit direction: RIGHT, mirrored side LEFT), facing (its sign), bonds (live copy, layers updated by addLayers), bandId, playerEffects, lpForBoss, dp, units }` |
| `mapTile(ps, row, col, abs?)` / `mapDir(ps, dir, abs?)` | board → field tile / direction of a player (the FA right-side mirror) |
| `onOwnBoard(ps, r, c)` | whether a field tile lies on the player's own board — GEO.FIELD (rows 9–12, cols 2–10) mapped onto this field: the 联防 right-hand helper's +8 columns, the boss field's rows 2–5 (never its hand / 临时整备区 rows 0–1), the mirrored right half; 乌尔比安's S3 【移动】 takes only such tiles (DESIGN §25.17.2) |
| `onFieldBoard(r, c)` | whether a field tile lies on the board of a player of this field — `onOwnBoard` of any of `players` (the players whose units the battle holds; an eliminated or absent teammate is not one): both halves of the two-helper 联防 field and of a Final Assault / Hidden Core pair field, the own half only for a lone 联防 helper and on a solo boss field, never a boss field's hand / 临时整备区 rows; the 突袭 landing takes only such tiles (DESIGN §25.18, §26.1) |
| `addDp(playerId, n)`, `retreat(unit, {reason, permanent, dying})`, `relocate(unit, r, c)` | `relocate` only changes the tile (state kept, no event) |
| `moveRedeploy(unit, r, c, { clearSp })` | a 【移动】 (PRTS 术语释义: "不退场，以当前血量在目标位置部署", a special retreat + redeploy): `relocate`'s checks (false = refused, nothing changed), then a new deployment (`deploySeq` / `aggroSeq` / `deployedAt`) and `deploy {initial:false, move:true}` (deploy effects fire again); no `die` / `death`, timer or cost (不屈 / 阿戈尔's revive never see it); HP, buffs and a running skill are kept (owner's deviation, DESIGN §22.3); `clearSp` empties the SP before the deploy handlers run — 乌尔比安 S3's move (kits/ops/chess_char_5_05-ulpia.js) and 【返回】 (`clearSp`; also the 从不混淆的方向 fallback, content/tokens.js) |
| `redeploy(unit, { free=true, tile, keepSp })` | immediate (re)deployment of a dead/retreated ally (full HP, `deploy {initial:false}`); `free: false` pays `base.cost` DP (refused without it); without `tile` it lands on the unit's rest tile (`restTile`: where a knocked-out operator lies, else home); `tile: [r, c]` lands on that tile once (home unchanged; refused when off-rect, occupied or a knocked-out operator's tile, no fallback); `keepSp` keeps SP/charges (保留技力), restored before `deploy` fires — but not for a skill that costs no SP, which the reset re-arms as at every deployment (伊内丝 S3 casts again on a 突袭 landing) — 突袭 raids, 阿戈尔 / 不屈 revives where the unit lies |
| `refreshRange(unit)`, `setExtraRange(unit, keys)`, `rangeChanged(unit)` | rebuild the ranges after changing `unit.rangeGrid` (流形 copies); extra targetable tiles (absolute keys; merged into every later rebuild until set again; `null` clears; never in `baseRangeKeys`): 蕾缪安 wanted, 维娜 S3 |
| `push(enemy, force, {from, dir, fixed, fixedAngle, inward, effect, keepFacing})`, `pull(enemy, force, {to, center, stop, keepFacing})`, `pullToFront(enemy, unit, force)`, `forceLevel(enemy, force)`, `pushDistance(enemy, force, {effect})` | the official 位移 (PRTS 游戏数据基础 §重量公式 / 推与拉; user playtest #6 item 14): 受力等级 = 力度 (微小力 −1, 小力 0, 中力 1, 较大力 2, 大力 3 …) − current 重量等级 (massLevel, 失重 counts). Push distance per level (`constants.js PUSH_TILES`, PRTS 推与拉's 弹道 column): ≤ −3 → 0, −2 → 0.12, −1 → 0.44, 0 → 1.7, 1 → 2.14, 2 → 2.96, ≥ 3 → 3.53 tiles; `effect` = a 特效 push (`PUSH_TILES_EFFECT`: −2 → 0.085, −1 → 0.374, 0 → 1.562, 1 → 1.987, 2 → 2.773, ≥ 3 → 3.331 — 见行者 S1 / S2, `PUSH_EFFECT_SKILLS`; every other pusher uses the 弹道 column [ASSUMED]); radial (away from `from`; the client's buff template `knockback[relative]`: 莫斯提马 S3, 山 S3, 琳琅诗怀雅 S3 — also PRTS 备注 "推开效果为径向推动") unless `dir` (directional; template `knockback[dir]` = Knockback {`_useSourceDirection` true, `_decreaseForceLevelWhenNotInDirection` 2}: 推击手, 野鬃 S2 "往攻击方向" (charpack char_496_wildmn: buff `wildmn_s_2[force]`) — > 45° off or < 0.25 tile ⇒ radial and level −2; `fixed` waives both (圣聆初雪 S1 朝部署方向, `KnockBackWithCharacterDirection`), `fixedAngle` only the angle (见行者 S2)); `inward` = a push towards `from` (薄绿 S2), stopping at the 急停 radius. Pull: level ≥ 0 → to `to` / the 急停 radius around `center`, −1 → 35 % of the way, −2 → 0.03, ≤ −3 → 0; `pullToFront` aims at the 拉力起点 0.5 tile ahead of the unit with the 急停 radius 0.6708 around it (never moves an enemy the unit itself blocks — nor does a pull towards an ally's centre, e.g. the 流形 S3 pulse) A 静态刚体 (data `staticBody`: every air unit of the mode except “炎佑”, plus 昆图斯 — PRTS 特殊机制 "可以进入失衡状态…但物理层面上无法产生任何速度或移动", "与单位的行动方式无关") moves 0 from every source while the skills that reach it still hit it (薄绿 S2, 锏 S3, the 钩索师 …; player report after 0.1.0). **失衡 (UNBALANCE)** (PR #392's idea, its timing re-done from the sources): the move stays instant, then the enemy is held in the 失衡 state — a state machine, not a status (PRTS 失衡位移机制; 异常效果 「失衡…不属于异常效果」: no stun, no immunity, SP untouched), `enemy.unbalanceUntil`, read by `ai.js updateEnemy`: no walking (恐惧 / 诱导 included — no fear exemption) and no normal attack started, a swing short of its frame cut, the attack clip's stand ended; and no skill (失衡免疫 「失衡期间无法自主移动、发动攻击、使用技能」): content skills wait (`enemies/helpers.js canCast(e, sil, battle)`, `unbalancedNow`), so do blinks (`blinkForward`) and scripted moves (枯朽之种's dive, the 碎铳之簧 / 铳 charges), and 乌顶巨角卢鲁's clash waits for its end. Left running on purpose: checks the state does not stop (异常效果: 水遁忍者's damage — 「仍然能正常造成伤害」), passive auras and terrain / periodic effects (no skills), death / damage-taken triggers, skill cooldowns (only the cast waits) — and 弧光锋卫's bleed, which is the state's own (天赋 「处于失衡状态时，每0.066s受到400点无来源真实持续伤害」: every 0.066 s for as long as it lasts — until 0.2.2 one hit per tile moved [ASSUMED]). Length, game seconds: a push — the 位移时间 of its 受力等级, PRTS 游戏数据基础 推力-位移近似对应表 (`constants.js PUSH_UNBALANCE`: −2 → 0.2, −1 → 0.4, 0 → 0.8, 1 → 0.9, 2 → 32/30, ≥ 3 → 35/30), the level push() computes (the −2 correction included), kept when the 特效 column or a wall shortens the slide ([ASSUMED] for the wall; a wall at the first step → the 0.1 s floor [ASSUMED]); a pull — its force window, 推与拉 「作用时间默认为 1 s；若本次受力等级 < −1，作用时间改为 0.5 s」 (`PULL_UNBALANCE` / `_WEAK`), to its end after the 急停 too (「目标将仍保持失衡状态至拉力作用时间结束为止」), none at ≤ −3; a 静态刚体 hit by a force > 0 — no movement, the state while the force acts (特殊机制 静态刚体: 「在失去施力后立刻」 out, 「0.1 秒保底」): a push 0.1 s (`UNBALANCE_MIN`; a push's force is instant), a pull its window; 失衡免疫 and leaders never. 浮空 ends it (术语释义 浮空), so do a 重生 (重生 / 逐火's 余烬) and a route APPEAR relocation — forced state switches (失衡位移机制). The end compares with 1e-9 so a float-summed 35/30 s keeps its 35 frames. The `displace` fx carries the length (`dur`): the client's slide takes as long (render/units.js slideTo). PR #392's 0.6387·√tiles (from the page's μ = 0.5 单位假设) and its fear exemption are not taken |
| `displace(enemy, {x, y}, tiles, {dur, keepFacing})` | the raw mover behind push / pull: along passable tiles (by `motion`: FLY in the rect, else ground-passable), no weight rule, no 失衡 state of its own (push / pull add it; `dur` only rides on its `displace` fx); nothing for 失衡免疫 (`noDisplace`: 近地悬浮 incl. 喷气人's 飞行模式, 浮空, the 胄 parts, 守墓石像's statue and flight), 静态刚体 (`def.staticBody`) and leaders (`_displaceable`); unblocks + re-paths |
| `after(seconds, fn, {owner})`, `every(seconds, fn, {owner, immediate})` | return `{cancel()}`; fn(battle, sched) |
| `fx(kind, params)`, `rng()` (+ `rng.int/range/chance/pick/shuffle/weighted`) | never use Math.random; for distances, angles and powers use `hypot`, `sin`, `cos`, `atan2`, `powi` from `server/sim/detmath.js`, never `Math.hypot` / `sin` / `cos` / `atan2` / `pow` / `**` (their last bits differ between browsers) |
| `forceAttack(unit, targets?, { noAmmo })` | an immediate attack with the current profile (hooks, attack SP, a running ammo skill's bullet); `noAmmo: true` = spends no bullet and emits no `ammoUsed` (圣约送葬人 extra attack). Returns true when it attacked |
| `findTacticalPoint(unit)`, `groundPathTiles()` | tactical point (战术点, tactician 援军 / talent tokens): a free (`isReservedTile`) walkable, standable (`canStand`: never the 深水区) tile of the initial range **on an enemy ground path first** (`groundPathTiles`: grid paths of every non-FLY route, cached per grid version), then nearest (Chebyshev, rows break ties), then the lowest tile key |
| `effectiveProfile(unit)`, `reduceElement(unit, amount, el?)` | |
| `battle.grid` | `tile(r,c)` → `{glyph, key, height:'LOW'|'HIGH', build, pass:'ALL'|'FLY'|'NONE', terrain, special}`, `inRect`, `canStand(r,c,{ranged})` (every automatic placement: the 突袭 landing tile, tactical points, summon tiles — `build` is the effective deploy type, so never the 深水区 `tile_deepsea` (PRTS 深水区 地形信息 "拒绝部署（待补充）"; the 特制水上平台 of the inactive act1 m05 is not modelled, its tiles stay NONE here [ASSUMED]); no melee unit on a hard-blocked 射击台 / mound tile), `groundPassable`, `isLow`, `findPath(sr,sc,er,ec)`, `specialTiles('start'|'end'|…)`; `battle.rect`, `battle.stage` (normalised stage incl. `special` terrain params) |
| `battle.data` | DataSource: `getChess(id, loadout?)`, `getEnemy(key)`, `getToken(id, ownerChessId, ownerLoadout?)`, `getStage(id)`, `getWave(id)` (normalised defs; raw record in `def.raw`; the per-battle loadout view, §12) |

`keepFacing` is presentation metadata emitted by `push` and `pull` by default: `displace` includes it in the fx so the
client retains the enemy's pre-hit facing through its slide. Directional Wild Mane S2 (#418) and radial Mostima S3 have
official footage directly showing unchanged facing. Mint S2 uses `push({ inward: true })`, while hook pulls such as
Gladiia S1/S2 use `pullToFront` → `pull`; the supplied drag clips directly show unchanged facing before and after the
shown pulls. Applying that observation to pulls against prior facing and other sources is [ASSUMED]. Either method can
pass `keepFacing: false` for a documented exception. Raw `displace` calls still face their travel direction. No facing
flag alters movement or 失衡.

---

## 7. Skills

### 7.1 Runtime rules (skills.js)
- SP types: `time` (+`s.spRecovery`/s), `attack` (+1 per attack), `hurt` (+1 per hit taken); starts at `initSp`; **no SP
  gain while a duration/ammo/toggle skill is active, or with the `noSp` flag** (阻回); a stunned / frozen / levitated unit
  (`canAct` false) neither attacks nor casts, but its time SP keeps recovering (PRTS 技能: only 阻回 pauses the SP cooldown;
  PRTS 异常效果 晕眩 names no SP effect — community report #18). Attack-type SP: attacks made
  by the skill (the pending "next attack" of an instant/charge skill, every shot of a timed skill including the one that
  ends it) recover nothing, so a cost-N skill fires every **N+1** attacks (AK). Charges (`maxChargeTime > 1`):
  SP fills to cost → +1 charge (SP restarts) until charges are full (then SP stays full). SP within 1e-9 of the cost is
  the cost (`gainSp`, `_normalize`; a tiny negative remainder is 0): the float sum of the 1/30-SP time gains can stop
  2.5e-14 short of it — a 10-SP skill at 1 SP/s took 301 ticks, now 300 (PR #402, 0.2.2).
- Triggers (`skill.trigger.rule` in data — the official 技能策略, PRTS 卫戍协议/帮助 §作战阶段 技能操作, resolved by
  `tools/build-data.mjs resolveTrigger`: charId rows by skill index; the class rows (重装 / 执旗手 / 战术家 / 吟游者 / 解放者 /
  阵法术师) for **every MANUAL skill** of the class; SKILL_RANGE for a MANUAL skill with a 技能范围 of its own; ACTIVE_RANGE
  for a MANUAL skill on the basic strategy or the SEARCH row whose running attack range strictly contains the own range;
  AUTO skills take no row — they keep their own rule, DEFAULT or a kit override): `DEFAULT` — the basic strategy: ready
  **and** about to attack/heal **and** an enemy (heal skills: an injured ally) inside the **initial** range
  (`unit.baseRangeKeys`: its own grid + its permanent rangeExtend — "攻击范围扩大" modules/talents as persist never-expiring
  `rangeExtend` buffs; no skill range, no temporary extend, no extra keys) or blocked by the melee unit — or, checked
  **every tick**, an enemy (flyers included) inside a content trigger range (`unit.skill.addTriggerRange(fn, { attackOnly: false })`,
  `fn(battle, unit)` → list of ally units (their current range), tile-key arrays or `{ keys, profile }` (tile keys with
  the enemy profile the effect selects by — `canHitFly` false: ground enemies only); returns an unregister fn; not for
  heal skills: 海嗣 "攻击范围视为自身攻击范围的延伸", 流形, 谬因 S2's beam, and the areas a skill acts through around its
  owner's standing summons — 麦哲伦 S1 (her drones' ranges), 令 S3 (each summon's x-5, ground), 电弧 S2 (赛柯's range,
  ground) / S3 (桑特拉's range): the owner's larger-range rule of 2026-10-06, kits/shared/summoner.js
  `summonTriggerArea`). 赤刃明霄陈 S3 uses an air-capable content range on its expanded grid for `ACTIVE_RANGE` too
  (§28.26): the wave can hit flyers, its normal attacks remain ground-only. [ASSUMED] This activation area includes
  permanent range extension but not the wave's eventual route. With `{ attackOnly: true }`, the extra range is checked only at the normal attack opportunity, not each tick: 蕾缪安’s own wanted targets and 死芒’s own living summons’ blocked targets (S1/S2); normal selectability and the skill’s actual effect range remain intact (§28.13). `SKILL_RANGE` — "不通过普通攻击/治疗触发技能，仅在技能范围内存在敌人（无视其不可选中）时释放技能": any
  living enemy (stealthed, untargetable, flying included) on `trigger.customRangeGrid` (= the skill's rangeGrid), every
  tick, no attack needed; `trigger.allies` (+ `hpAtMost`, default 1) — set by a kit, or by the data for an ally row (黍 S3's
  official `TRY_SEARCH_ALLY_SKILL`, "技能范围内存在可治疗的我方单位时释放技能": tools/build-data.mjs `TRIGGER_ALLY_RULES`,
  simdata passes `allies` on) — asks for an injured, healable ally of the grid at or below that HP ratio instead (the AUTO
  heal skill 古米 S1: PRTS 备注 "此技能在存在生命值不满的可治疗角色时可触发…直至古米完成一次普通攻击的治疗" — her heal mode
  waits for its heal); `ACTIVE_RANGE` — the owner's rule of 2026-10-05
  (a deliberate deviation): a MANUAL skill on the basic strategy (深巡 S2's DEFAULT deviation included) or on the SEARCH
  row (薄绿 S1, 蜜蜡 S1, 卡涅利安 S3, 玛恩纳 S2, 安洁莉娜 S3) whose attack range while it runs strictly contains the
  unit's own range checks the DEFAULT condition — a targetable enemy (or one it blocks), a heal skill an injured ally —
  on `trigger.customRangeGrid` (= that running range, grown by the unit's permanent rangeExtend unless the skill's
  `targeting.noRangeExtend`), every tick, no attack needed (the 外勤医疗 map character Touch's 恳切福音 too, on its 5-2:
  set by its kit, content/tokens.js `touchKit` — the map character's record keeps DEFAULT, build-data widens operators'
  skills only; GitHub #260). A mixed attack/heal skill may set `trigger.enemies` to also open for a selectable enemy
  on that range (凯尔希·思衡托 S2), retaining the injured-ally condition; `DEFAULT` with `trigger.allies` (+ `hpAtMost`,
  `grid`) = an attack interval ready **and** such an ally on the grid, without requiring an enemy:
  the cast replaces that attack with a heal (塞雷娅 / 黍 S1, ≤ half HP). The check follows cooldown decrement
  and control/disarm checks, preserving the same cadence with or without enemies; a cast whose ally condition fails before that attack is withdrawn, its charge returned;
  `TAKE_DAMAGE` — ready and just hit (重装: "不受技能范围影响，受到伤害时释放技能"; in the data every MANUAL 重装 skill but
  the six of DESIGN §21.29 — 深巡 / 雷蛇 S2, 号角 S2 / S3, 灰毫 S1 / S2 — which are `DEFAULT`, a deliberate deviation (深巡
  S2 then `ACTIVE_RANGE` on its 3-2), and 余 S2 厚礼上宾, `SKILL_RANGE` on its own x-1 since DESIGN §22.10);
  `SP_FULL` (`ALWAYS`) — immediately;
  `CUSTOM_RANGE` — an enemy inside `trigger.customRangeGrid` (rotated by the unit direction like every grid); `SEARCH` — an
  enemy inside the INITIAL range, checked every tick (no attack needed: "不受基础策略影响，在初始攻击范围内存在敌人时释放技能");
  `GDGLOW_SKILL_2` — "全场存在可选目标时释放技能": a targetable enemy anywhere (a heal skill: an ally that needs healing),
  every tick; `NEVER` (alias `MANUAL`) — never auto-casts: the kit calls `unit.skill.activate(reason)` itself;
  `MLYSS_WTRMAN` and any unknown rule behave like DEFAULT. Units that never attack (bard, phalanx, librator) check
  DEFAULT every tick. In every enemy condition above a registered ally target (`setAllyTarget`: 白铁's 铁钳号·原型机, an
  enemy-camp summon) counts like an enemy for a skill that acts on it (`_allyTargetIn`, `allyTargetsOk` — the owner's rule
  of 2026-10-08: with the device alone in range such a skill opens and spends itself, its bullets included, on it): one
  acting through the unit's own attacks, or flagged `allyTargets` by its kit; [ASSUMED] one that picks enemies only waits.
  Silence blocks activation. The automatic operations cool down (`constants.js AUTO_OP_COOLDOWN` 3 s,
  "自动操作具有3s冷却，在完成一次操作或作战开始时部署的单位将进入冷却"): a MANUAL skill is auto-cast no sooner than 3 s
  after its previous cast (a charged skill spends its charges 3 s apart) or after its battle-start deployment
  (`Battle._deploy` initial; `battle.flags.startOpCooldown`, default 3 — the test harness sets 0 unless told otherwise);
  AUTO skills are exempt; kits with their own automatic cast of a MANUAL skill check `skill.opCooling` (波登可 S1, 雪猎
  special bullets, 流形 copy). While a cast "next attack" (instant / charges with an attack override) waits for its
  attack, no further charge is cast. An instant / charges skill with no attack override of its own (a throw, a heal, a
  buff, a DP gain …) is cast from the tick (the rules above, the DEFAULT of units that never attack, content trigger
  ranges) at most once per attack interval of its unit — `skill.nextCastAt`, set by such a cast, reset on deployment —:
  attack speed paces it, and an SP refund that refills the bar at once (迅捷) no longer recasts it every tick (GitHub #298,
  引星棘刺 S1; [ASSUMED] one attack interval: PRTS prints no 前后摇 for such casts). The cast is no attack: the unit's
  attacks and heals keep their own rhythm, and its first cast comes as soon as it is ready (#124). `gainSp` is ignored while a duration/ammo/toggle skill
  runs (its bar shows the skill), and while the unit has `noSp` (阻回; the operators' 凋亡 burst, §3), except for
  deployment initialization (`reason: 'init'`) and explicitly documented bypasses.
  `gainSp(n, reason, silent, { ignoreLock: true })` bypasses both locks while retaining the source reason, charge cap
  and `spGain` hook; used by 黄沙罗盘 (PRTS says all its SP ignores 阻回), including its caster's +3 SP.
- Kinds: `duration` (mods for `duration` s), `ammo` (mods until `ammo` attacks were made, optional duration cap),
  `instant` (onStart + optional one-shot attack override applied to the next attack), `charges` (instant with charges),
  `passive` (always on from deployment, no SP), `toggle` (stays on until death once activated).
- Timed deployment skills use `duration`, `activateOnDeploy: true`, `spCost: 0`, `spType: 'none'`, `trigger: 'NEVER'`.
  Landing state is set before `reset()` synchronously calls `activate('deploy')`; `skillStart` precedes the `deploy`
  hooks. Each deployment grants and consumes one charge. Duration end clears effects and fires `skillEnd('duration')`;
  staying deployed or receiving SP never refills that charge. Early removal ends the active window with `death`;
  removing an expired skill emits no second end. `activations` accumulates across deployments.
- `end()`: `active` turns false, then **onEnd runs while the skill's mods / range are still applied** (finishers and
  end bursts use the skill's stats and range), then they are removed (kept when onEnd re-activated the skill), then
  `skillEnd` fires. `onAttack` ctx carries `noAmmo` (set it to true: this attack spends no bullet, no `ammoUsed` — 流明's
  free heals).
- Runtime helpers on `unit.skill`: `activate(reason, {free})`, `end(reason)`, `stop()`, `addAmmo(n)`, `extend(s)`,
  `addCharge(n)`, `gainSp(n, reason)`, `addTriggerRange(fn, { attackOnly?: boolean })`, `setTrigger(rule, grid)` (a kit's own rule change mid-battle —
  薇薇安娜 S3's ACTIVE_RANGE on 3-2 after its first cast; 0.2.0); fields `sp, spCost (= floor(base×spCostMul + spCostFlat)), spCostMul, charges,
  maxCharges, active, timeLeft, ammoLeft, ammoMax, activations, kind, rule, bb` (`ammoMax`: the most bullets the running ammo skill
  has held — set at activation, raised by skillStart additions and `addAmmo` above it; 0 when inactive).

### 7.2 Kits

```js
// server/sim/content/kits/ops/<chessId>-<codename>.js — one kit per file, listed in kits/index.js (kits/README.md)
export default {
  [baseChessId]: (bb, chess, def) => Kit,   // bb = flattened blackboard of the SELECTED skill (normal Lv4 / elite Lv7)
};                                           // chess = the record as the unit's loadout makes it (simdata loadoutRecord),
                                             // def = normalised def (def.skill = selected skill, def.talents[].bb, def.loadout)
Kit = {
  skill: SkillSpec | null,      // the chess's DEFAULT skill; null ⇒ unit never casts
  skills: { [skillId]: SkillSpec },          // optional: specs of the other selectable skills (DESIGN §16 operator loadout)
  talents: [{ install(battle, unit) {} }],   // hooks with { owner: unit }; check unit.alive in handlers
  trait: { ...profile overrides },           // e.g. { priority: 'lowDef', maxTargets: 2, splashRadius: 1.2 }
  install(battle, unit) {},                  // optional extra per-unit setup (runs under EVERY selected skill)
}
```
Keys: the data `baseId` (`chess_char_1_01_a`, also used for the elite `_b`), the exact chess id, or the suffix-less id of the
DESIGN §5.6 example (`chess_char_1_01`) — all three are looked up.
Missing kit ⇒ `content/generic.js` builds one from the blackboard (§7.4), so every chess always fights.
补位 stand-ins (DATA.md §18; a PlayerBattleInput entry with `standIn: true` ⇒ the def of `getChess(chessId, { standIn:
true })`, §12): the def keeps the chess's ids, so `content/index.js kitOf` looks the kit up by `def.charId` only — the
stand-in's own, `kits/ops/standin-<codename>.js` registered under that charId (kits/README.md "Stand-in kits") — never
by the chess id, which names the replaced operator's kit. A stand-in has no default skill: its kit authors each skill in
`skills` (`skill` is ignored); without a kit it gets the generic kit plus `genericTalents(def)` (§7.4).
自选 pieces (DATA.md §18; a PlayerBattleInput entry of a DIY slot with `diy: { charId, skillIndex, uniEquipId }` ⇒ the def
of `getChess(slotId, { diy })`, §12) take their kit the same way, `KITS[def.charId]` only (`content/index.js isDiyDef`): an
owned 6★'s `kits/ops/op-<codename>.js` (kits/index.js `OPERATOR_KIT_FILES`, kits/README.md "How to add an operator
(自选)"), a prototype's stand-in kit, a 预备干员's generic kit; no default skill either (the pick chooses any of the
three). `KITTED_CHARS` lists who has one — shared/diy.js offers no other pick.
Operator loadouts (DESIGN §16): the unit's def is `getChess(chessId, { skillIndex, moduleId })` of its PlayerBattleInput
entry (no loadout fields = the default). The skill spec is `kit.skills[selectedSkillId]` when authored, else `kit.skill`
only when the selected skill is the default one, else the GENERIC spec of the selected skill (its generic install is
chained after the kit's; `kit.skillSource` = 'skills' | 'generic', absent for the default spec) — talents, trait and
`install` always come from the kit, so keep default-skill logic inside `skill` (or check `unit.skill.id`). Under a
non-default skill `spawnToken` refuses summons that skill does not make (琳琅诗怀雅 S1/S3: no 香槟炸弹), and the
tokens.js skill-summon fallback (a table of skill summons, e.g. 迷迭香 S3's two 战术装备) runs while the selected skill
has the generic spec. Summons: `battle.tokenDef(tokenId, unit)` / `battle.spawnToken(unit, …)` resolve the owner's loadout
(token skill of that slot: `variants[owner].bySkill[i]`, module attributes: `.byModule[id]`). Coverage of the selectable
skills: `node tools/kit-coverage.mjs --missing [--tier N] [--strict]`.

Timed deployment kits: 宴 S2 uses `bb.duration` and skill ATK mods, loses current HP once on landing, and converts normal
physical attacks to arts only while S2 is active; S1 has no such conversion. 斯卡蒂 S2 uses its own record's
`s.bb.duration` / `s.bb.atk`; DRE-Y revival in place does not restart it. 野鬃 S1 uses its record's `duration` /
`bb.attack_speed`, with the existing deploy discount talent. 砾 S1/S2 retain their one-second DEF/barrier decay steps
(damaged barrier scales with capacity); skill end removes the decay buff. 伊内丝 S3's first deployment places the sentry
with zero effect time and retreats with a refreshed redeploy timer; later deployments recall it and open the full
ATK/DP window, then stay deployed. 缄默德克萨斯 S1/S2/S3's first kill per deployment heals and explicitly ends/restarts
the skill for a full duration, including a synchronous kill inside its deploy burst; S3 rain is cancelled on end,
while enemy silence/DoT/RES cuts keep their own expiry. 耀骑士临光 S2 ends naturally by retreating with the preceding
operator's faction-based redeploy multiplier; an early death only cleans the skill and shields.

Element conventions of the kits (user playtest #5 #3; official term dictionary: 元素损伤 = the gauge, 元素伤害 = HP damage):
- **元素损伤 dealt** = `{ type: 'element', element, amount }` with the official base: "N%攻击力的…损伤" ⇒ `N × ATK` at that
  moment, "伤害N%的…损伤" / "相当于法术伤害N%" ⇒ `N ×` the HP damage just dealt (post-mitigation, `damaged` ctx.amount).
  No damage buff or 脆弱 scales it (the attached-to damage already carries them).
- **"自身造成的元素损伤提升N%"** (菲莱 / 余 PRP-X while blocking, 塑心 RIT-X vs elite / leader) multiplies EVERY element fill
  of the unit — kit talents, a carried 灼燃维式重锤 — in an `elementHit` handler (`ctx.source === unit` ⇒ `ctx.dmg.mul *=`);
  a talent-ratio upgrade (盟约·辅助干员 RIT-X `ep_damage_ratio_boss`) touches its talent only (PRTS 备注).
- **"受到的元素损伤±N%"** is also an `elementHit` multiplier (PRTS 元素 "…后续可应用元素损伤倍率提升/降低等效果") — not the
  mod `elemTakenMul` (the gauge's generic 元素损伤倍率 in `elementIntake`, applied after every `elementHit` handler, so
  after the 损伤屏障; 元素脆弱 is `elementalTakenMul`). On operators (菲莱 神河谕使, 哈洛德 我即军营, 纯烬艾雅法拉 火山灰疗愈,
  and the host of 假想敌：淤困, "受到的元素损伤提高至130%") it runs at priority 20, before the 损伤屏障 (菲莱 S1, 纯烬 S2 at −50:
  "损伤屏障于伤害计算前、第一天赋后处理"); the enemy-side amplifier 塑心 精神逆构 (×1.2 凋亡 in her range) has no ordering
  constraint (priority 0 — enemies carry no 损伤屏障).
- **Element attached to a damage** (a `damaged` hook: 迭代元素, 灼燃维式重锤, 炎佑, 妮芙 S2, 余 S3 火墙): the hook runs before
  `battle.kill`, so a killing blow still sees the target `alive` at 0 HP — these riders check HP left (damage.js `hasHp`,
  boss: pool HP; kits/shared/tier6.js `elementDmg`) and applyElement itself refuses such a target, so nothing bursts on the corpse.
  塑心 S2 (安魂的弥撒) is the exception: PRTS "…凋亡损伤生效于当次触发的伤害之前，该造成的凋亡损伤的来源始终为塑心" — a late
  `hit` handler (priority −1000, after any cancel), so its 凋亡 lands (and may burst) before the damage; a hit dodged or
  absorbed after that still carried it [ASSUMED].
- **盟约·辅助干员 迭代元素** (kits/ops/chess_char_1_15-pithst.js `pithst`): every damage she deals (HP damage > 0; "造成伤害时") attaches `ep_damage_ratio
  × ATK` of 神经, then 灼燃, then 凋亡 (`PITHST_ELEMENTS`); the element applied first bursts, so alone she bursts 神经.

### 7.3 SkillSpec schema

```js
{
  kind: 'duration'|'ammo'|'instant'|'charges'|'passive'|'toggle',
  activateOnDeploy: bool, // optional: reset activates synchronously and consumes a deployment charge
  duration,              // s (duration kind; optional cap for ammo)
  ammo,                  // attacks (ammo kind)
  spCost, initSp, charges, spType: 'time'|'attack'|'hurt'|'none',   // optional overrides of the data values
  trigger: 'DEFAULT' | { rule, grid, allies?, hpAtMost?, enemies? },     // optional override (allies / hpAtMost: an injured ally condition, §7.1)
  heal: bool,            // heal-type skill for the DEFAULT trigger (default: unit is a healer); trigger.enemies also permits enemies
  mods: { …mod keys },   // buff while active (instant: only during the pending attack)
  flags: { …flags },
  targeting: { maxTargets, rangeGrid, rangeExtend, priority, allInRange, canHitFly,
               noRangeExtend /* the skill's range ignores the unit's 攻击距离 (rangeExtend): 信仰搅拌机 S3, PRTS 备注 */,
               showOwnRange /* rangeGrid only selects targets, no official range change: the card keeps the unit's own range */ },
  attack: { dmgType, atkScale, healScale, splashRadius, splashScale, hits, projectile, maxTargets, dmgMul,
            chain: {count, falloff, radius, sluggish}, heal: {mode, count, falloff, hpAtMost /* targets at or below this HP ratio only */}, onHitStatus: {key, duration, value},
            onHit(ctx),                           // once per attack (main target; target may be null for a splash landing)
            onEachHit(ctx) },                     // per victim: main, every splash / chain victim — ctx += { dealt, kind:'main'|'splash'|'chain', isSplash, isChain, main, attackId }
                                                  // (overrides the profession profile while active; profiles may define onEachHit(b, u, victim, hctx) too)
  onStart(ctx), onEnd(ctx) /* mods & range still applied */, onHit(ctx), onAttack(ctx) /* ctx.noAmmo */, onTick(ctx),
}
ctx = { battle, unit, skill, bb, target?, dealt?, heal?, targets?, dt?, reason?, x?, y? }
```

### 7.4 Generic kit (content/generic.js)
Kind: PASSIVE (or a free skill without duration/ammo) ⇒ passive; AMMO ⇒ ammo; duration > 0 ⇒ duration; duration < 0 ⇒
ammo if an ammo key exists, **toggle only when the text says 持续时间无限** (史尔特尔) — the data also uses −1 for instant/charge
skills (塑心, 妮芙, 夕, 流星, 莱恩哈特 …); else instant (charges when maxChargeTime > 1).
Keys → spec (stat keys prefer the plain key, attack/targeting keys prefer `attack@`: 薄绿 hits for `attack@atk_scale` 1.1,
its `atk_scale` 2.1 is the end burst): `atk→atkPct, def→defPct, max_hp→hpPct` (values > 5 are flat: 史尔特尔 +5000 HP),
`attack_speed→aspd, base_attack_time→batPct, magic_resistance→resMul` (|v| < 1, "法术抗性+60%") or `resFlat`,
`damage_scale→dmgDealtMul, block_cnt→blockCnt, taunt_level→taunt, damage_resistance→dmgTakenMul (1−v)`, positive
`hp_recovery_per_sec(_by_max_hp_ratio)→hpRegen(Ratio)`, `sp_recovery_per_sec→spRecoveryFlat, magic_resist_penetrate_fixed→
resIgnoreFlat, def_penetrate_fixed→defIgnoreFlat, ability_range_forward_extend→targeting.rangeExtend, max_target→
targeting.maxTargets, atk_scale→attack.atkScale, heal_scale→attack.healScale, times→attack.hits, attack@range_radius→
attack.splashRadius, trigger_time/ammo→ammo`.
Text-aware rules: negative atk/def/RES described on enemies debuff the **targets** (aura over the range while a timed skill
runs — 初雪; on hit for bb.duration otherwise — 流星, 莱恩哈特); statuses (`stun cold sleep fear sluggish root unmovable`, ×
`prob`): `attack@` keys on hit, plain keys on hit for instant/charges but **once at start** on ≤ max_target enemies in range
for timed skills (小满), a plain `stun` described "…结束后…晕眩" = self-stun at the end; "立即…造成…" / "技能结束时…造成…" =
one AoE burst of the plain atk_scale at start / end (乌尔比安, 薄绿); "额外造成攻击力N%…" is bonus damage, never the attack
scale (烛煌); "停止攻击…" (duration skills) ⇒ `attack.noAttack` (泡泡, 蛇屠箱, 凯瑟琳, 菲莱, 铃兰); "受到攻击时…攻击力/防御力N%的X伤害"
⇒ counter-damage while the skill is active (星熊, 泡泡; 周围 ⇒ AoE, `aoe_cd` cooldown: 菲莱) via `kit.install`; a non-healer
whose skill "恢复…友方/友军…生命" heals the most injured ally in range on each hit (古米, 瑕光; 所有友军 ⇒ all: 塞雷娅);
`ep_damage_ratio` + "附带…凋亡/灼燃/神经损伤" ⇒ element damage on hit (凋亡 → `apoptosis`; × damage dealt when the text says
"伤害N%的…损伤", else × ATK); "屏障" + `shield_max_hp_ratio`/`hp_ratio` ⇒ decaying self shield at start (砾, 新约能天使);
"立即流失N%当前生命" ⇒ self HP loss at start (宴, 风丸); `hp_ratio` + "恢复/回复…生命" ⇒ self heal at start; `force` ⇒ on-hit
displacement by the official 力度 − 重量 rules (拖拽/hookmaster: `pullToFront`; else `push`, directional for 往攻击方向 / 朝部署方向 /
向前 / 身前方向 and 推击手, radial otherwise — §6; only a fallback: hand-written kits follow the client templates
`knockback[dir]` / `knockback[relative]`, e.g. 琳琅诗怀雅 S3's "向前推开" is radial). A passive with self stat mods,
positive `bb.duration` and "N秒内" uses a deployment duration (宴 +65 % ATK for 14 s), and so does an ON_DEPLOY passive
that says "部署后…" with no `duration` key, for the skill's own `duration` (一击即退, 10 s); its mods, targeting, arts
conversion and attack/status overrides follow that window. Other **passive** skills apply permanent stat mods and
self/counter effects — their scales describe procs that need a kit.
"立即获得N点部署费用" + `cost` ⇒ +cost DP at the start (冲锋号令); such an AUTO skill with nothing else to do fires at full
SP (`trigger: 'SP_FULL'`, as 德克萨斯's kit casts it). `genericTalents(def)` — for 补位 stand-ins without a kit only — applies
every unconditional stat talent ("攻击力+8%", "防御力+10%", "攻击速度+9"; `statTalentMods`: only stat clauses whose numbers
are the blackboard's) as a persistent `talent:generic:<i>` buff; any other talent is left to a kit. Instant skills with
mods/targeting but no attack override apply them to the next attack (the skill range is switched in for that attack).

### 7.5 Worked examples (real operators, numbers from blackboards)

**1. Ammo sniper — 隐现 `chess_char_1_01_a` “解决麻烦”** (bb `atk 0.8, base_attack_time −0.3, attack@trigger_time 14`;
text: prefers ranged enemies, less likely to be targeted; talent: +2 ammo after 20 s on field):
```js
chess_char_1_01_a: (bb, chess, def) => ({
  skill: {
    kind: 'ammo', ammo: bb['attack@trigger_time'],
    mods: { atkPct: bb.atk, batPct: bb.base_attack_time, taunt: -1 },
    targeting: { priority: 'ranged' },
  },
  talents: [{ install(battle, unit) {
    const t = def.talents[0].bb;                          // { self_ammo: 2, duration: 20 }
    battle.on('skillStart', ({ unit: u, skill }) => {
      if (u === unit && battle.time - unit.deployedAt >= t.duration) skill.ammoLeft += t.self_ammo;
    }, { owner: unit });
  } }],
}),
```

**2. Duration ATK buff guard — 幽灵鲨 `chess_char_2_07_a` 肉斩骨断** (bb `atk 0.7, stun 10`: HP never below 1 during the
skill, self-stun 10 s afterwards):
```js
chess_char_2_07_a: (bb) => ({
  skill: {
    kind: 'duration',                                     // duration comes from the data (11 s)
    mods: { atkPct: bb.atk },
    onStart({ battle, unit }) {
      unit.mem.undying = battle.on('fatal', (c) => { if (c.unit === unit) c.prevented = true; }, { owner: unit });
    },
    onEnd({ battle, unit, reason }) {
      battle.off(unit.mem.undying);
      if (reason !== 'death') battle.applyStatus(unit, 'stun', { duration: bb.stun, source: unit });
    },
  },
}),
```

**3. Instant burst caster — 至简 `chess_char_3_13_a` 神工意匠** (bb `atk_scale 1.3, ct 2`; next attack 130 % arts, hits
twice; 2 charges; the funnel profile already ramps damage on the same target):
```js
chess_char_3_13_a: (bb) => ({
  skill: { kind: 'charges', attack: { atkScale: bb.atk_scale, hits: 2, dmgType: 'arts' } },
}),
```
An AoE instant (德克萨斯 剑雨, bb `stun 2`: two hits of 120 % arts around her + stun) uses `onStart` instead:
```js
onStart({ battle, unit, bb }) {
  for (const e of battle.enemiesInRadius(unit.x, unit.y, 1.5)) for (let i = 0; i < 2; i++) {
    battle.dealDamage(unit, e, { amount: unit.s.atk * 1.2, type: 'arts', isSkill: true });
    battle.applyStatus(e, 'stun', { duration: bb.stun, source: unit });
  }
  battle.addDp(unit.ownerId, 10);
}
```

**4. Healer — 调香师 `chess_char_2_14_a` 精调** (bb `atk 1.8, attack_speed −50`, 30 s; the ringhealer profile heals 3 allies):
```js
chess_char_2_14_a: (bb) => ({
  skill: { kind: 'duration', heal: true, mods: { atkPct: bb.atk, aspd: bb.attack_speed } },
}),
```
and 华法琳 紧急包扎 (charges, bb `hp_ratio 0.15`: next heal +15 % of the target's max HP if it is below half):
```js
skill: { kind: 'charges', heal: true, attack: { onHit({ battle, unit, target, bb }) {
  if (target && target.hpRatio < 0.5) battle.heal(unit, target, target.s.maxHp * bb.hp_ratio);
} } },
```

**5. Summoner — 赫默 `chess_char_2_02_a` 医疗无人机** (bb `cnt 1`: "获得一个医疗无人机…10秒后自动销毁"; the drone is a hand
piece the player placed — user playtest #6 —, so the skill only brings that piece onto its tile):
```js
import { releaseSkillSummon } from '../tokens.js';
chess_char_2_02_a: (bb) => ({
  skill: {
    kind: 'instant', heal: true,
    onStart({ battle, unit }) { releaseSkillSummon(battle, unit, 'token_10000_silent_healrb', { cap: bb.cnt }); },
  },
}),
```
(the placed piece deploys once with the board — `SKILL_SUMMON_START_DEPLOY` — and then waits on its tile for the
skill; the drone's stats come from `tokens.json variants[chess_char_2_02_a]`; it is untargetable, uses the heal profile
and its token kit withdraws it after 10 s. A kit whose summon is not a hand piece spawns it itself:
`battle.spawnToken(unit, tokenId, r, c, { duration })`. A summon past its data `deployLimit` per owner withdraws the
oldest one, except the skill summons of `tokens.js SKILL_SUMMON_UNCAPPED`, whose data limit is a hand count the skill
ignores: 维娜 S3 places a 黄金盟誓 on every free deployable melee tile of her talent-1 area, fences included.)

**6. AUTO heal skill — 古米 `chess_char_1_10_a` 备用军粮** (自动触发, bb `heal_scale 1.15`; PRTS 备注: cast once a
healable ally of the skill range is injured — no enemy needed — then her next normal attack heals that ally):
```js
chess_char_1_10_a: (bb, chess, def) => ({
  skill: {
    kind: 'instant', heal: true,
    trigger: { rule: 'SKILL_RANGE', grid: def.skill.rangeGrid, allies: true },   // an AUTO skill: its own rule
    targeting: { rangeGrid: def.skill.rangeGrid },                               // the heal-mode attack: its skill range
    attack: { dmgType: 'heal', heal: { mode: 'single' }, healScale: bb.heal_scale },
  },
}),
```

**7. Bond hook example — 精准 3-tier** (`bonds.js`): members + ranged ops ignore 30 % DEF/RES:
```js
export function install(battle) {
  battle.on('battleStart', () => {
    for (const p of battle.players) {
      const bond = p.bonds.preciShip;
      if (!bond?.active || bond.tier < 2) continue;
      for (const u of p.units) if (u.def.bonds?.includes('preciShip') || u.def.position === 'RANGED')
        battle.addBuff(u, { key: 'bond:preci', persist: true, allowDead: true, mods: { defIgnorePct: 0.3, resIgnorePct: 0.3 } });
    }
  });
}
```

**8. Timed follow-ups — 蕾缪安 `chess_char_6_01` S3 礼炮·强制追思** (user playtest #3; bb `attack@emit_offset 0.2`,
`dist_1` / `dist_2`, `proj_atk_scale_1` / `_2`; PRTS S3 note: after the skill ends one bombardment every 0.3 s in lock
order on a random point of the 0.4-side square around each lock mark, ATK cached at the end, ≤ 33 in 10 s). Content that
unfolds over time chains `battle.after` callbacks owned by the unit (they run even if it dies later — check what the
official text says and bail out yourself); random numbers come from `battle.rng`, drawn in the unit's facing frame
(`dir.js rotateOffset`) so a turned board plays alike:
```js
const bombard = (battle, unit, locks) => {
  const atk = unit.s.atk, seq = unit.deploySeq;                        // ATK cached at the skill's end
  const n = Math.min(locks.length, Math.floor(10 / 0.3 + 1e-9));        // ≤ 33 shells
  const fire = (i) => {
    if (!(unit.alive && unit.deployed && unit.deploySeq === seq)) return;  // knocked out: no further shell
    const L = markOf(locks[i]);                                         // follows the enemy / stays where it left
    const [oy, ox] = rotateOffset(battle.rng.range(-spread, spread), battle.rng.range(-spread, spread), unit.dir);
    const x = L.x + ox, y = L.y + oy;
    battle.fx('bombardShell', { x, y, id: unit.id, r: d2, t: 0.3, i });  // the renderer drops a shell there
    battle.after(0.3, () => blast(battle, unit, atk, x, y), { owner: unit });   // lands 0.3 s later [ASSUMED]
    if (i + 1 < n) battle.after(0.3, () => fire(i + 1), { owner: unit });
  };
  if (n > 0) fire(0);
};
```
(`blast` emits fx `'bombard'` at (x, y) and deals `proj_atk_scale_1` / `_2` × the cached ATK to every enemy within
`dist_2`, once each; the full kit is `content/kits/ops/chess_char_6_01-lemuen.js`.)

---

## 8. Professions (server/sim/professions.js)

Profile resolution: `PROFESSION_DEFAULTS[profession] → SUB[subProfessionId] → trait tunables (trait text + data
trait.bb, elites include module upgrades) → data fields (dmgType / attackKind / projectile / canHitFly / targetPriority)
→ kit.trait`. Defaults: SNIPER ranged phys arrow · CASTER ranged arts bolt · MEDIC ranged heal · SUPPORT ranged arts ·
TANK/WARRIOR/PIONEER/SPECIAL melee phys (melee cannot hit air units: FLY, 近地悬浮, 浮空 — `Unit.isFlying`). Skill and
talent effects that pick their own victims follow the skill's text and PRTS 备注 (the official per-ability `targetMotion`,
PRTS 选择器, is not in the data): "地面敌人" / "不可对空" ⇒ `!e.isFlying` (e.g. 隐德来希 S2 血镰, 归溟幽灵鲨 拥抱自我,
琳琅诗怀雅 S3 cash-out, 乌尔比安 S1 捕网 [ASSUMED like 雪雉's]); "可对空" or no note ⇒ air units too (no note = [ASSUMED]:
风丸 折纸生花, 乌尔比安 S3, 缄默德克萨斯 S2, 余 S2, 见行者 S2, 耀骑士临光 不畏苦暗 and the token appear bursts — “耀阳”,
沙之碑, 迷迭香的战术装备's stun, 纸偶). A melee skill whose attacks PRTS marks "可对空" sets `targeting.canHitFly` (玛恩纳
S3 未照耀的荣光 — its CUSTOM_RANGE trigger also counts flyers). A stun / freeze / sleep from any of them drops a hovering 掠海漂移体 for good. Ranged attacks fly as projectiles
(`constants.js PROJECTILE_SPEEDS`: arrow 14, bolt 11, bomb/lob 8, orb 10, drone 16, enemy 10 tiles/s; boomerang 15 out,
3.75 back = `BOOMERANG_RETURN_SPEED`, PRTS 跃跃; droneBomb 5 = 暴鸰's bomb, the official projectile_bombd); melee/`none` hits are
instant, and so are `'beam'` hits (a 锁定攻击范围 AoE without a projectile — `rangeAoe` profiles: "在攻击前摇结束时选取范围内的全体目标，同时造成伤害", PRTS 作战机制). Kit-settable profile flags beyond the
table: `hitSleep` (targets and damages sleeping enemies — "可以攻击沉睡的敌人"), `onEachHit(b, u, victim, hctx)`, `dmgMul`,
`afterHit`, `afterAttack`, `canAttack`, `hitsFn(b, u, info)`, `hitDmgMul` (the 伤害倍率 of each of the `hits` instances on the
main target — DamageInfo `mul`, after DEF / RES; the later instances give no 受击回复: 砾's two 50 % hits, PRTS 砾 特性备注),
`storeEnergy` / `releaseEnergy` (the 秘术师 store, below), `priority` (targeting.js PRIORITY_FNS — `'heaviest'`: the 攻城手 trait
"优先攻击重量最重的敌人", the highest current 重量等级 first: 早露 / 提丰; `'elite'`: "优先攻击精英或领袖敌人", an ELITE / BOSS
rank enemy or a leader first: 薇薇安娜 S3), `blockFly`, `noHeal`, `skipEnemy(e)` (an enemy the unit never
selects — its attacks, the enemies it blocks and its skill-trigger targets: targeting.js canTargetEnemy; 嵯峨 "不攻击重伤
单位"), `healThrough(healer, ally)` (a healer that selects and heals that ally through its 禁疗 — §4; 凯尔希's Mon3tr), `boomerang` (the projectile stays
`'boomerang'` whatever the data's generic ranged projectile says), `boomerangOnward(ctx)` (a boomerang's flight after its
first hit belongs to content: ctx `hit(target, x, y)` / `comeBack(x, y)` — 娜仁图亚 S1's bounces, S2's dash; the loopshooter
row), `rangeAoe` (applied after every override: sets `allInRange` and, on a ranged profile, the instant `'beam'`) (see the
header of professions.js).

| sub | behaviour |
|---|---|
| fastshot | FLY first; module `atk_scale` vs FLY |
| closerange, underminer, primcaster, corecaster, ritualist, summoner, counsellor, pioneer, fearless, fighter, protector, guardian, primprotector, executor, duelist | plain profile (numbers from data; skills/talents via kits). underminer module: weaken 10 % ATK 2 s on hit |
| longrange | lowest DEF first |
| aoesniper / splashcaster | splash 1.1 tiles around the struck target at full damage (PRTS 溅射半径一览: 扩散术师 1.1; Arknights Terra Wiki, Splash Caster); 格雷伊 1.0 (the same table's 特殊 row; TUNE.splashcaster, 1.1 until 0.1.1). The table's 炮手 1.0 has no chess in the pool; the 自选 炮手 kits (W `op-cqbw.js`, 菲亚梅塔 `op-phenxi.js`) set it in their kit trait |
| blastcaster | `rangeAoe`: every selectable enemy on its line at once, the same damage near and far, instant (`'beam'`) — "超远距离的群体法术伤害" is the whole line, not a splash (primary: PRTS 作战机制 §AOE伤害判定 names 伊芙利特's 炎爆 a 锁定攻击范围 AoE, and 炎爆 is her next-attack skill "下次攻击造成…" (PRTS 伊芙利特 S2), so a 轰击术师 normal attack; secondary: Terra Wiki, Blast Caster; supporting: PRTS 溅射半径一览 documents no splash radius for it; community report E3). A stealthed enemy is not struck unless it is revealed or blocked (a 锁定范围 AoE cannot hit a 隐匿 unit, PRTS 作战机制) |
| bombarder | ground-only splash 0.9 (PRTS 溅射半径一览: 投掷手 0.9; 1.0 until 0.1.1) + aftershock(s) at 50 % ATK (bb append_atk_scale / times); 迷迭香's S2 末梢阻断 1.5 (the same table) |
| hunter | 8 bullets (bb value), ×1.2 ATK (bb atk_scale), reloads 1/s after 1 s without attacking; can't attack when empty |
| loopshooter | 回环射手 (user playtest #3): every attack throws a boomerang (`ai.js throwBoomerang`, projectile `'boomerang'`) out to the target at 15 tiles/s — it hits on arrival — and back to the thrower's current position at 3.75 tiles/s without damage (PRTS 跃跃 "投射物飞行速度15，返回时飞行速度3.75"); attacks only while holding it (every boomerang thrown caught — "必须回收全部回旋投掷物才可以进行下一次攻击", `unit.trait.boomerangsOut`) and with the attack cooldown ready, so the real interval is the longer of the two; a target dead mid-flight is not hit (it still flies to the last position and back); knocked out / withdrawn ⇒ lost, a redeployed thrower holds a fresh one; 跃跃 S2's extra boomerangs share the one flight (cnt hits); each catch fires `boomerangCaught`, and an attack profile's `boomerangOnward(ctx)` flies it on after the first hit before it turns back — ctx `hit` (a hit of the same attack), `comeBack(x, y)` once (a content error sends it back from the hit point): 娜仁图亚 S1 bounces, S2 dashes on and hits on its way back (kits/ops/op-narant.js) |
| reaperrange | hits every enemy in range; ×1.5 (bb atk_scale) on the trait front grid (or its own line ahead) — both along its direction |
| chain | chain N (trait text/bb max_target) with −15 % per jump (bb chain.atk_scale), 1.7-tile jumps (constants.js CHAIN_RADIUS, PRTS 溅射半径一览: 链术师 1.7; 1.8 until 0.1.1), sluggish on each hit |
| funnel | drone damage 20 % → +15 %/hit on the same target → 110 % (bb init/delta/max) |
| mystic | 秘术师 (PRTS 分支特性信息 秘术师, GitHub #181): at its attack check (the attack ready, able to act, not disarmed) with no valid target — no target, or its kit's `canAttack` false (深靛 never picks a bound enemy) — it stores one energy (`storeEnergy`, up to bb times: 3, 深靛's MSC-X 4), an attack action: the attack interval restarts; a full store idles with the attack ready. The energies leave with its next attack that happens (`releaseEnergy` in `performAttack`, after `beforeAttack`: an attack cancelled before its shot keeps them) and land with the main hit, one arts attack hit each (`hitsFn` reads the hit's `info.energy`); a redeployment holds none [ASSUMED]. 维伊 / 黑键 plug their own `storeEnergy` (转置能量, elite energies) into the same check |
| phalanx | no attack & DEF +200 %, RES +20 (bb) while the skill is off; while on, `rangeAoe`: each attack strikes every selectable enemy on its range at once (blocked enemies included; a stealthed one only when revealed or blocked), the same damage near and far, instant (`'beam'`) — "群体法术伤害" (secondary: Terra Wiki, Phalanx Caster: "attacks hit all enemies within their range"; supporting: PRTS 林 S3 备注 "单次普攻最多触发1次效果" — one normal attack can kill several — the same 锁定攻击范围 shape as the 轰击术师, and PRTS 溅射半径一览 documents no splash radius for it (it omits the 撼地者 too, so this is not proof); no primary source states a target cap; community report E3: it used to be one bolt + a 1.1 splash). 卡涅利安's charged S1 keeps the skill-off trait, 不攻击 included (kit `canAttack`, PRTS 备注) |
| physician | heal the lowest HP% injured ally in range (a skill `targeting.maxTargets` widens any heal profile) |
| ringhealer | heal 3 allies |
| chainhealer | the heal jumps on to 3 units in all (−25 % per jump, bb chain.*), each jump inside the 3×3 of tiles around the last one healed (range x-4), never twice to one unit, the lowest HP ratio first — a full-HP ally too (healed for nothing, the chain goes on from it) — then the latest deployed; no 禁疗 / 孤立 unit (a healer's `healThrough` summon excepted) — PRTS 分支特性信息 链愈师 (`ai.js chainHealNext`, shared with Mon3tr's kit; until 0.2.0: the most injured ally within 2.5 tiles) |
| healer (流明) | heal ×0.8 (bb heal_scale) beyond 2 tiles |
| wandermedic | heal + reduce element gauges by 50 % ATK (bb ep_heal_ratio); also targets uninjured allies with gauge |
| incantationmedic | arts attack; EVERY damage the unit deals heals the lowest ally in range for 50 % (bb scale) of it — the official trait buff (`vendla_tr` / `reed2_tr` / `titi_tr`) is ON_AFTER_OUTPUT_DAMAGE, so skill and DoT damage heals too (缇缇's 凝固的时光 ticks, 焰影苇草's S2 fireballs while she is disarmed); a skill that triggers it for one named ally says so ("仅对该角色触发…特性") and the damage instance carries that ally (`DamageInfo.traitAlly`) |
| slower | sluggish 0.8 s on hit (bb sluggish) |
| bard | no attack; allies in range get 生命回复速度 +10 % ATK (bb atk_to_hp_recovery_ratio) — an hpRegen buff refreshed every 0.25 s (`bardRegen`), no heal |
| craftsman | melee phys (support devices via kit) |
| shotprotector | ranged phys, can hit FLY, blocks 3 |
| fortress | melee single target while blocking, ranged 1.0 splash otherwise, ground only (never hits FLY) |
| unyield / musha / reaper | cannot be healed by others. musha: one heal of 50 (bb value) per damage instance it deals to an enemy (PRTS 分支特性信息 武者 "特性治疗于干员每次输出伤害时触发（不局限于攻击）"; the official `utage_trait` / `helage_trait` / `zuole_trait` ON_OUTPUT_DAMAGE): every hit of a normal attack — a double strike heals twice, a dodged hit not at all — and every skill / item / bond damage instance; not a 流失, an element 损伤 or a talent / DoT damage. reaper: 50 × min(enemies hit, block) per normal attack and 50 per other damage instance it outputs that no buff produced (the official trait's ON_OUTPUT_DAMAGE, which is why 隐德来希's S2 血镰 cuts heal her while she is disarmed), capped at the block count per instant. Both trait heals ignore 禁疗 (PRTS 分支特性信息 武者 / 收割者 "通过自身特性/天赋/技能产生的作用于自身的治疗效果会无视自身的禁疗") |
| centurion / crusher / pusher | "同时攻击阻挡的所有敌人" (`hitAllBlocked`): each attack takes up to the block count of targets (never fewer than 1) from the range and the enemies it blocks, the blocked ones first — PRTS 分支特性信息 "普通攻击最大目标数等于阻挡数（不会低于1）", PRTS 作战机制 §AOE伤害判定 (强攻手: a 锁定人数 AoE taking the targets of its range up to its cap); the client's selector flag `_limitedMaxTargetNumToBlockedCnt`, carried by every skill worded so too (忍冬 S3, 左乐 S2, Mon3tr S3, 凯尔希's Mon3tr under S2 … — kits set `attack.hitAllBlocked`). Until 0.2.0 it struck the blocked enemies only |
| hammer | 50 % splash (bb atk_scale_2) to others within 1 tile |
| instructor | ×1.2 (bb atk_scale) vs enemies it doesn't block |
| librator | no attack & block 0 while the skill is off; ATK +5 %/s up to +200 % (bb atk / max_stack_cnt), reset at skill end; elite module starts at +100 % (bb init_atk) |
| lord | can hit FLY at range; ×0.8 (bb atk_scale) unless the target is on its tile / the tile in front (along its direction) or blocked by it |
| sword / swordmaster | 2 hits per attack |
| artsfghter | melee arts |
| charger | +1 DP (bb cost) per kill |
| tactician | spawns a 援军 token (70 % HP, 50 % ATK, block 1) on the nearest walkable tile in range at each deployment; ×1.5 vs enemies it blocks |
| agent / hookmaster | can hit FLY (ranged reach); hook displacement comes from skills (generic: `force`) |
| bearer | block 0 while the skill is active |
| alchemist | ranged lob, can hit FLY |
| dollkeeper | fatal damage (no 不死 — a running 坚固维式重锤 window comes first) ⇒ a 1 s switch animation [ASSUMED length, also on a direct switch] (无敌, 不死, 阻回, 禁疗, 孤立, 缴械, 眩晕 / 冻结 / 睡眠 immune; ends the running skill and removes the statuses; the HP is set to the max at its start and again at its end — PRTS "切换途中重设自身生命至最大值" —, so a lethal 流失 inside it, held at 1 HP, never outlasts it), then the <替身> for 20 s (bb duration): block 0 from the switch on, 阻回, HP = its own 替身 token's (风丸 纸偶), else its own max HP (归溟幽灵鲨: PRTS resets it "至最大值", the trait's 替身 HP bonus `max_hp` is 0, 风丸's 纸偶 has her HP); then the switch back (the same animation) at full HP; dies if the 替身 dies. Kit flag `dollNoAttack` (归溟幽灵鲨): the 替身 makes no normal attack and casts no skill. Hook `dollSwitch` switches it at once (归溟幽灵鲨 S2's end). Model form `'doll'` (PRTS 分支特性信息 傀儡师, DESIGN §22.11) |
| geek | loses 1–3 % max HP per second (bb hp_ratio), never lethal on its own |
| merchant | −3 DP every 3 s (bb cost/interval); retreats when DP runs out |
| skywalker | can block FLY enemies (蒂比's and 予愿安洁莉娜's kits: only while airborne — 起飞, flag `liftoff`, which also releases the ground enemies she blocked) |
| stalker | hits every enemy in range; 50 % dodge (bb prob), taunt −1 |
| traper | ranged; the table's ground-only default never applies to a unit with data, whose `canHitFly` decides (PRTS 分支特性信息 陷阱师 "可对空": 望 and 多萝西 hit air units). Their pieces: 望's 棋子 / 跟子 in kits/ops/op-wang.js, 多萝西's 共振装置 in kits/ops/op-doroth.js |

Unknown subprofessions fall back to the profession default (test `professions.test.js` checks every pool subprofession).

---

## 9. Wire format (snapshot.js, DESIGN §8.2)

- `snapshot()` → `{ fieldId, t, units: [[id, x, y, hp, maxHp, sp, spMax, flags, anim]], dp, killed, total, resolved, dps?, boss?, down?, elem?, ammo?, wolves?, neg?, stand?, standCut? }`.
  `killed` counts every `counted` knock-out (§1.3) and `total` only the enemies this field scheduled (`inTotal`), so it may
  exceed it; `resolved = min(total, killedInTotal + leakedInTotal)` is the HUD capsule's numerator (DESIGN §14 顶栏胶囊).
  `sp/spMax` show remaining duration/ammo as a draining bar while a timed skill is active (ammo: `ammoLeft / ammoMax`, the
  activation's real total — 拉特兰's and 逃犯引渡手续's extra bullets included, community report #35). Units in DIE state stay 0.8 s.
  Active finite zero-SP duration skills display `timeLeft/duration` using `duration` as `spMax`; after end they show
  `0/0`. This display capacity leaves runtime SP/cost unchanged; active skills carry `UF.SKILL`.
  `down: [[id, respawnAt, respawnTime, state, row, col]]` (only when non-empty) = operators lying down waiting to redeploy
  (`Battle.isDown(u)`: reason `'killed'` or `FORCED_EXIT` (§1.1 carryState `down`), or a forced exit `'retreat'` /
  `'merchant'` (GitHub #60) — every removal but the 突袭 `'raid'` —, not removed for good, deployed at least once, a finite
  respawn timer; `state` = constants.js
  `DOWN_STATE`: 0 counting, 1 timer done / DP short, 2 timer done / its tile taken — a safeguard: no ally deploys on a
  knocked-out operator's tile, §1; `row, col` = the tile it lies on and comes back on, `unit.body`); `elem: [[id, element, fill,
  cooldownEnd, cooldown]]` (only when non-empty) = `elementView` of every unit with a gauge or a running 爆发冷却 (§3);
  `ammo: [[id, left, magazine]]`, `wolves: [[id, left, max]]` and `neg: [[id, fill]]` (each only when non-empty; display only) = the HP-bar
  readouts of `snapshot.js` `ammoView` (an ally's running ammo skill: whole rounds, the magazine = `ammoMax`), `wolfView` (伺夜's 狼群:
  `mem.shadows` of `mem.wolfCapacity`) and `negView` (`unit.negFill()`, set by 斩业星熊's T1 业火: the 我执 pool as a share of its cap);
  UnitInfo `ammoSkill` marks an ally whose skill is an ammo magazine (DESIGN §8.2).
  `fieldMeta()` lists the knocked-out operators too (a client joining mid-battle shows them; DESIGN §18.3).
  `stand: [[id, until]]` (only when non-empty) = the game time each enemy's attack recovery ends (`atkStandUntil`: it
  stands for the rest of its attack clip, §1.2 `attackStand`) — enemies alive, deployed, visible, neither feared nor stunned;
  display metadata the battle never reads (PR #381). When `until` falls between two snapshots the renderer holds the older
  position until then and interpolates the rest of the interval (HP / SP keep the whole interval); a newer snapshot that
  moved before `until` is interpolated linearly; while the newest snapshot still holds a stand nothing is extrapolated
  (the next one confirms the move). A snapshot without the field interpolates over the whole interval, a teleport or a
  redeploy still snaps first, and nothing is inferred from the attack animation. `standCut: [[id, at]]` (only when
  non-empty) = the latest game time each enemy's recovery was cut or ignored (a displacement — 失衡 —, fear, a stun, hiding,
  leaving the field), one per enemy: an interval whose newer snapshot carries a cut inside it is interpolated linearly even
  when the older stand ended inside it too, and an older cut leaves a later stand alone. It covers the enemies listed in
  `units` (the 0.8 s death window included), never a hidden or unlisted one. The newest snapshot showing a death, a stun
  (freeze, sleep, 浮空 included) or a block is not extrapolated until a later snapshot shows it moving again; the
  extrapolated velocity uses the same moving span as the interpolation (the stand is not in its denominator).
- `drainEvents()` tuples: `['spawn', UnitInfo]` (first appearance), `['deploy', id]` (every (re)deploy and 【移动】 — the client plays the deploy and its interpolation snaps instead of sliding), `['atk', src, tgt, projKind]`
  (`none|arrow|bolt|bomb|lob|orb|drone|enemy|boomerang|droneBomb|chain|chainHeal`; a boomerang's way back has no event — the
  renderer flies it back to the thrower at `BOOMERANG_RETURN_SPEED`; an enemy's `profile.shot` may name another kind,
  e.g. `mortar` for 帝国炮火先兆者, which the renderer does not draw — its fx `bombardShell` is the shell), `['dmg', tgt, amount, type]` (`phys|arts|true|burn|neural|necrosis|apoptosis`),
  `['heal', tgt, amount]`, `['skill', id, 1|0]`, `['engage', id]` (an ally's first attack that hits an enemy — the client's
  行动开始 voice, DESIGN §21.30), `['die', id, reason]`, `['leak', id]`, `['status', id, key, 1|0]`,
  `['fx', kind, x, y, extra]` (`hitCap` `{ id, n }`: a leader's hit cancelled by 限伤 — the renderer draws nothing;
  `extra.form` = the unit's model form from then on — an enemy's `content/enemies/helpers.js setForm`, a 傀儡师's 替身 — `shared/protocol.js fxForm`),
  `['layer', playerId, bondId, n]` (n = the layers actually added, capped at 999), `['bounty', playerId, coins]`.
- `UnitInfo = { id, kind, side, ownerId, defId, name, tier, golden, spine, avatar, x, y, facing, dir, maxHp, motion?, boss?, uid?, form?, skillIndex?, moduleId?, items?, standInFor?, diy?, potential?, cultivate? }` (`potential` / `cultivate`: an ally operator's potential below 6 and its 练度 tier, 0.2.2 — a teammate's card composes its numbers from them) (`standInFor`: a 补位 stand-in's replaced operator charId — `spine` / `avatar` / `name` are the stand-in's, DATA.md §18; the prep scouting units of `Match.prepFieldMeta` carry it too, board and held pieces alike with the stand-in's art (the owner's recall of the official mode, 2026-10-06), and so do the m.result lineups; `diy`: a 自选 piece's pick `{ charId, skillIndex, uniEquipId }` — `defId` is its slot, `spine` / `avatar` / `name` the operator's; the prep scouting units of `Match.prepFieldMeta` and the m.result lineups carry it too (server/match/player/diy.js, the client composes the operator's card from it); `skillIndex`: an ally's equipped skill, DESIGN §16; `form`: the unit's current model form — `content/enemies/helpers.js setForm`: 掠海漂移体 `'crawl'`, 暴鸰 `'bombed'` after its drop, 转译基底·α's forms …; a 傀儡师 fighting as its 替身 `'doll'` — so a view built mid-battle from `fieldMeta()` starts on that clip set; `items`: an ally operator's equipped item ids — a 变形同构体 wearer is a member of the bond it grants on the client too, the bond popup and the detail card's chips)
  (`dir` = the unit direction, allies meaningful, enemies 'RIGHT'; `facing` = its horizontal sign for sprite flipping)
  (`spine`/`avatar` are asset ids from data).
- flags: UF bits (blocked 1, stunned 2, frozen 4, stealth 8 — 隐匿 (an enemy's only while not blocked / revealed and not within 3 s of a block's end) or an ally's 迷彩 — skill 16, shield 32, invuln 64, cold 128, sleep 256, flying 512);
  anim: ANIM codes (idle 0, move 1, attack 2, skill 3, die 4, stun 5, deploy 6).

---

## 10. Testing content (test/helpers/battleHarness.js)

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec, enemyRec, checkInvariants } from '../helpers/battleHarness.js';

test('隐现 S2: 14 shots then the skill ends', () => {
  const h = makeBattle({
    defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 1e7, speed: 0 }) } },  // synthetic target
    units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 4 }],                                // board coords
    enemies: [{ key: 'enemy_dummy', pos: [10, 6] }],
    hooks: ['ammoUsed', 'skillEnd'],
  });
  const u = h.unit('chess_char_1_01_a');
  assert.ok(h.runUntil(() => u.skill.activations === 1, 60));
  h.runUntil(() => !u.skill.active, 60);
  assert.equal(h.hooksOf('ammoUsed').length, 14);
  checkInvariants(h.b);
});
```
`makeBattle(opts)` options: `stageId` (default `'flat'`: synthetic open lanes, gates (9,10)/(12,10), goal (9,2); `flat:
{ rows, crates }` to customise) or `stage`; `kind`; `seed`; `units` (board coords, player `p1`; each may carry
`dir: 'UP'|'RIGHT'|'DOWN'|'LEFT'`, default RIGHT — facing tests: test/sim/facing.test.js, test/sim/facing-invariance.test.js,
test/content/facing.test.js)
or `players`; `enemies:
[{ key, time, route (index | RouteSpec), pos, count, interval, mods, tag, bounty, sourcePlayerId }]` or `waveTemplate`
(id or object ⇒ routes, spawns, time limit); `routes` (flat defaults: 0 walk low gate, 1 walk high gate, 2/3 fly);
`timeLimit`; `content` (`'full'|'generic'|'none'`); `kits` (inject `{ baseId: kitFn }`; a stand-in's by its charId); a unit's
`standIn: true` fields a NORMAL chess as its 补位 stand-in (the production path, the chess's backup skill / module; `_a` =
normal, `_b` = elite), `standIn: { skillIndex?, moduleId? }` another skill / module of it (the composed record `standInRec(chessId,
sel)` replaces that chess's record for the battle; kits/README.md "How to test a stand-in kit"); a unit `{ diy: { slot,
charId, skillIndex?, uniEquipId? }, elite?, row, col }` fields a 自选 piece the production way (`slot` = a DIY slot's base
id or its tier 5 / 6, `elite` = its `_b` form; `getChess(slotId, { diy })`, kits/README.md "How to add an operator
(自选)"); `defs: { chess, enemies, tokens }`
(extra/override records; build them with `chessRec({...})` / `enemyRec({...})`); `bonds`, `bandId`, `playerEffects`,
`flags`, `sharedBoss`, `setup(battle)`, `hooks` (names to capture; `captureNoisy` to keep tick/hit/damaged/heal/spGain/
attack contexts), `autoFinish` (default: true when enemies are scheduled).
Harness API: `battle`/`b`, `step(n)`, `run(seconds)`, `runUntil(pred | seconds, maxSeconds)`, `runToEnd(max)`,
`unit(uid | chessId | baseId | id)`, `allies()`, `enemies()`, `enemy(key)`, `spawn(key, opts)`, `events` /
`eventsOf(kind)` (client tuples), `hooks` / `hooksOf(name)` (captured ctx copies with `t`), `result()`, `snapshot()`,
`invariants()`. `checkInvariants(b)` (no NaN, hp ∈ [0, maxHp], positions inside the rect, SP/charge bounds, finite skill
timers, occupancy map in sync with deployed allies, block links, DP, finite projectiles and per-player result counters,
no open hook emit between steps), `hashOf(v)`, `flatStage()`, `flatRoutes(kind)`, `standInRec(chessId, sel)` are exported too.

Soaks: `SIM_FUZZ_N=3000 SIM_FUZZ_CHECK_EVERY=3 node --test test/sim/fuzz.test.js` (random real battles) and
`SIM_CHAOS_N=500 SIM_CHAOS_SEED=<n> node --test --test-name-pattern="chaos fuzz" test/sim/robustness.test.js` (content that
abuses every helper from every hook with junk numbers; asserts invariants and zero engine errors).
Normalised defs from `battle.data` are **deep-frozen** (shared by every battle in the process): never mutate `bb`, `def`,
`def.stats` or range grids in a kit — copy them (`{ ...bb }`, `grid.map(…)`).

Rules for content tests: seed everything, prefer synthetic `enemyRec` targets for exact numbers, assert on ids (not unit
objects), and call `checkInvariants` at the end. Run: `node --test test/sim/*.test.js test/content/*.test.js`.

## 11. Tools

`node tools/simrun.mjs --mode mode_multi_normal --round 5 --stage act2autochess_m01 --lineup "角峰@9,7 隐现@10,4 艾丝黛尔*@12,5" --ascii 10`
prints a per-unit damage/DPS/kills/heal table (+ ASCII frames: letters = operators, digits = ground enemies per tile,
`^` = flyers, `■` = crates). `--wave <template>`, `--seed`, `--content generic`, `--hpMul/--atkMul/--speedMul`,
`--time`, `--bossHp`, `--json`, `--events`, or a scenario JSON file (see the file header).

Golden results (`tools/golden.mjs`, `test/golden/README.md`): a fixed corpus of seeded battles — every chess record ×
skill × module, every bond at its threshold and at 999 layers, every leader field, 联防 — and bot-only matches,
reduced to digests in `test/golden/*.json`; `test/golden.test.js` fails, naming the scenario and the field, when a
digest moves. A refactor must leave them unchanged; `npm run golden:update` records an intended gameplay change.

## 12. Data notes (simdata.js)

Defs are normalised from data/*.json (DATA.md) with research JSON as a fallback. Chess: `stats {maxHp, atk, def, res, aspd,
bat, blockCnt, cost, respawnTime, spRecovery, tauntLevel, massLevel, hpRecoveryPerSec}`, `rangeGrid`, `dmgType`,
`attackKind`, `projectile`, `canHitFly`, `targetPriority`, `trait` (text), `traitBb`, `immune` (Set), `skill {id, name,
skillType, durationType, duration, spType, spCost, initSp, maxCharges, rangeGrid, trigger {rule, grid}, bb, description}`,
`talents [{name, description, bb, bbStr, rangeGrid, tokenKey}]`, `raw`. Enemy: `maxHp, atk, def, res, aspd, bat,
rangeRadius, moveSpeed, massLevel, lpr, motion, applyWay, dmgType, immune, tauntLevel, blockCnt, epResistance,
epDamageResistance, hpRecoveryPerSec, notCountInTotal, hitArea (huge units only, §2; else null), staticBody (静态刚体:
never displaced, §6), tags, abilities, skills, talent, raw`. Tokens use `variants[ownerChessId]` (owner-level stats).
`skcom_withdraw` token skills are ignored.
Operator loadouts (DESIGN §16, DATA.md §2.2 / §14): `getChess(id, { skillIndex, moduleId })` = the def with the selected
skill (`def.skill`, its bb / SP / trigger) and, for elites, the module's stats / trait / talents; `def.loadout` = the
resolved loadout `{ skillIndex, moduleId, potential, skillIsDefault, moduleIsDefault, potentialIsDefault, isDefault }`
(illegal choices fall back to the default; cached per loadout; the default loadout is the same object as `getChess(id)`).
Potential (0.2.2, DATA.md §2.3, shared/potential.js): a loadout's `potential` (潜能 1–6; default 6 = the data's full
potential) composes the record at it first (`loadoutRecord` → `atPotential`: stats, statsBase, talents, module talent
changes); `getToken` composes the owner variant at the owner's `loadout.potential` (talents; a 自选 summon's deploy
limit / holding / count) and `getDiy(slotId, pick, potential)` an owned pick's form (a prototype has none: `diyProto`);
the kits that read a summon variant raw (content/tokens.js `ownVariant`, `kits/shared/summoner.js tokenStat`, 多萝西,
麦克尼斯特) compose it the same way. `getToken(id, ownerChessId,
ownerLoadout)` = the summon for that owner loadout (`bySkill` / `byModule` merged; `def.sources` ⊆ ['talent', 'skill',
'display'] and `def.count` of that loadout — `[]` / `['display']`: the owner does not make it). Every Battle gets a
per-battle view (`withUnitLoadouts`: id-only `getChess(id)` / `getToken(id, owner)` use the loadout the inputs give that
chess id — the first player's when two players of one field differ, `view.loadoutConflicts`); Battle itself always passes
the unit's own loadout (`_createAllyFromInput`, `tokenDef` / `spawnToken`, the dollkeeper substitute), so it is exact.
补位 (DATA.md §18): `getChess(id, { standIn: true })` = `getStandIn(id)` — shared/standIn.js `standInRecord` of the chess over
the source's `backups` (data/backups.json; `rawBackups()` follows the fallback chain), normalised: `id` / `baseId` / `golden` /
`tier` / `bonds` / `raw.garrisonIds` of the chess, every combat field of the stand-in, `charId` the stand-in's, `standInFor`
the replaced operator's, `loadout` the backup selection (`standIn: true`); its skill / module ignore the loadout's
("对于补位干员其技能不可更改", shared/standIn.js). A PRESET / DIY chess or a source without backups (a browser that did not
fetch backups.json) gives the chess's own def. A PlayerBattleInput entry carries it as `standIn: true` (spec.js keeps
nothing else — no `potential` / `cultivate`: a stand-in has neither); the per-battle view maps id-only lookups of that
chess id to the stand-in.
潜能 / 练度 in a PlayerBattleInput operator entry (0.2.2; the owner's decision of 2026-10-08 — the player's 干员调配 settings,
PlayerState.battleInput states both for every owned operator, bots the defaults 6 / 3): `potential` (1–6) → the def of
`getChess(chessId, { …, potential })`; `cultivate` (0–3) → `unit.cultivate` and `unit.cultMul` = `data.cultivateMul(n)`,
the effects.json CHAR_MAP `aceffect_char_<n+1>` `char_attribute_mul` (×ATK / ×DEF / ×max HP: 1 / 1.05·1.05·1 / 1.1·1.05·1.05
/ 1.1 each), a multiplier of its own in the Πmul of §2 (never summed with the 直接乘算 percentages: PRTS 盟约记录
「…与自持有干员的属性加成独立」); a stand-in or a prototype 自选 def never takes it, summons neither [ASSUMED: the official
buff names the operator]. spec.js keeps each only when well-formed (never on a stand-in or a summon); absent = full
potential and no 练度 (a raw unit: tests, tools). `unitStatsEntry` counts the 练度 in the unit's own numbers (`base`), as
the record cards do; UnitInfo carries `potential` (below 6) and `cultivate`.
自选 (DATA.md §18): `getChess(slotId, { diy })` = `getDiy(slotId, pick)` — shared/diy.js `diyRecordOf` of the DIY slot
record (`_a` normal, `_b` elite) with the pick over this source, normalised: `id` / `baseId` / `golden` / `tier` of the
slot, `bonds` the pick's derived ones, `raw.garrisonIds` `[]` (no 特质), every combat field of the operator at the slot's
status with the pick's skill and module (a prototype's locked ones), `charId` the operator's, `diyFor` the slot's base
id, `loadout` the selection with `diy` = the checked pick `{ charId, skillIndex, uniEquipId }`, `tokenOwner` =
`<charId>@<statusKey>`; null for an illegal pick (shared/diy.js `checkDiyPick`); cached per (id, pick). Its summons:
`getToken(id, slotId, def.loadout)` reads `rawBackups().tokens[id].variants[tokenOwner]` with `bySkill[skillIndex]` /
`byModule[uniEquipId]` merged (`getDiyToken`); `rawToken(id)` falls back to `backups.tokens`, and content/tokens.js /
`Battle.producesToken` key a 自选 owner's variant by `def.tokenOwner`. A PlayerBattleInput entry carries the pick as
`diy` (spec.js keeps `charId` / `skillIndex` / `uniEquipId` when well-formed); Battle fields a DIY slot only with a legal
pick (none ⇒ no unit), and each unit resolves its own pick — two players filling one slot id differently are exact.
Assumptions taken here (documented choices): element burst numbers for necrosis/apoptosis; unspawned enemies at timeout
are dropped (not leaks); geek drain is non-lethal; tactician reinforcement stats; displacement is instantaneous, followed by the 失衡 hold (push: the 位移时间 table; pull: the force
window — `push` / `pull`; a wall-shortened slide keeps its row time, a wall at the first step gets the 0.1 s floor); pushes PRTS does not classify use the 弹道 distance column (`PUSH_TILES`);
platforms/mounds are ground obstacles that elevate operators; the generic kit maps 凋亡 to `apoptosis` (侵蚀 has no element key
yet — enemy content must pick one); 抵抗 covers the control statuses of `RESIST_STATUSES` (the official term lists 晕眩/寒冷/
冻结/恐惧/诱导…, the rest follow the operator kits that grant it) and caps at 0.95; tactical points prefer enemy path tiles.


“余音” owns a same-call pulse queue (DESIGN §28.24): reflected hits enqueue their earned pulses instead of recursively
entering another pulse. This retains the lethal-hit pulse and prevents valid high hit-count chains from tripping the
general hook guard. The queue is emptied in `finally`; it introduces no timer or simulation RNG.
