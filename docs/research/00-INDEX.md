# 00 · Research index and key numbers: 卫戍协议：盟约 (act2autochess, 盟约·下半)

Written 2026-09-27 by the completeness critic, after reading every file in this folder.

**Precedence rule:** where a file's body and its `## Addendum (critic)` disagree, **the addendum wins**. In JSON, `_criticAddendum` wins over the older fields.

Tags: **[DATA]** client game data · **[VERIFIED]** official or wiki rule text, or a screenshot · **[ASSUMED]** a proposal, kept in config.

## 1. Files

| File | What it holds | Key machine paths |
|---|---|---|
| `01-core-rules.md` / `01-core-data.json` | Modes, round schedule and timers, economy, shop, merging, LP, Final Assault and Hidden Core, 40 strategies (bands), 机变 choice events, scoring and tips. **Addendum A1–A5** has the verified rules, the ban rule and the enemy-multiplier table. | `modes`, `rounds`, `shopLevels`, `bands`, `choiceEvents`, `choiceAndEnemyEffects`, **`_criticAddendum`** (income, freeze, hand, bandDraft, bannedOperators, enemyStatMultipliers, specialPhase…) |
| `02-bonds.md` / `02-bonds.json` | All 23 bonds (8 core, 15 add-on): activation, layer formulas, tier effects, layer sources and readers, band/choice/item interactions. Addendum: 华法琳 cap 12/24, ban interplay. | `bonds[*]`, `layerGarrisons`, `layerScalingGarrisons`, `bondGrantingItems` |
| `03-operators.md` / `03-operators.json` | 133 chess ×2 (normal/elite): stats at the tier's status, range grids, the default skill with blackboard, talents, module, 特质 (garrison) blackboards, tokens, distribution. Addendum: **skill-trigger correction**, summons and hand, deploy rules, DIY. | `chess[*].stats/rangeGrid/skill/talents/garrisons/module`, `tokensUsedByPool`, `skillTriggerDataList` |
| `04-items.md` / `04-items.json` | 56 equipment ×2 + 3 Arts: effects, formulas, merge, sources, 变形同构体 table, VI-tier combos. Addendum: **items can't be sold**, 机变 item card formats. | `items[*]`, `itemSources`, `bondGrantTable_for_变形同构体` |
| `05-enemies-levels.md` / `05-enemies.json` / `05-maps.json` | Stage terrains (8 active), 38 wave templates with routes, 326 enemies, special-enemy pools, generation algorithm, bosses, bounties, LP rules. Addendum: DP, hidden-core thresholds, multi FUNNY rounds, stat scaling. | `05-maps.json: stages, roundLevels`; `05-enemies.json: enemies, specialEntries, bosses, bountyEffects, generation, _criticAddendum` |
| `06-multiplayer-ux.md` | Co-op flow and state machine, 联防, shared vs individual, shared pool, cross-player effects, emotes and broadcasts, settlement, per-screen UI layout, style guide, server notes. Addendum: TL;DR fixes, banned-operator UI. | – |
| `07-assets.md` / `07-assets.json` | Verified URL patterns and resolved URLs for avatars, portraits, skills, bond/item/band icons, UI, Spine (ops + enemies), BGM/SFX, fonts; build plan. Addendum: spot check 40/40 OK. | `operators[*]`, `enemies[*]`, `bonds`, `items`, `bands`, `autochessUi`, `audio` |
| `11-limits-official.md` | Official limits read from the client (2.7.71 il2cpp) and the community: bond layers cap at **999** per bond (`MAX_GARRISON_STACK`, `AddBondCount` = min(L + n, 999)); in boss battles outside training a single hit of **≥ 300000** on a leader (`IsBossEnemy` = an `autoChessData.bossInfoDict` enemyId) is **cancelled** ("限伤", `MAX_BATTLE_DAMAGE`); implemented in DESIGN §20.12. | `shared/constants.js BOND_LAYER_CAP / BOSS_HIT_LIMIT` |

## 2. Match structure

| Item | Value | Tag |
|---|---|---|
| Players | Co-op 1–4 (PvE, no PvP). Solo 1. Tutorial = 1 human + 3 NPCs. | DATA/VERIFIED |
| Modes | FUNNY 标准, NORMAL 险境, HARD 绝境, ABYSS 终极 (×solo/multi), plus training. FUNNY disables 10 bonds (laterano, egir, kazimierz, skillful, arcane, mira, invest, raid, solo, sunt) and 18 enemy keys; NORMAL disables the same 18 enemy keys. | DATA |
| Rounds | Multi: FUNNY 14; NORMAL/HARD/ABYSS 14 + hidden R15. Solo: FUNNY **9** (boss R9); others 14 + R15. | DATA |
| Pre-game | INFO_CHECK 25 s → BAND_CHECK 50 s (co-op: random-order sequential picks, one skip each, duplicates allowed, timeout → 华法琳) → BATTLE_CHECK 3 s | DATA/VERIFIED |
| SP (机变) rounds (`isSpPrepare`) | multi FUNNY 3, 9 · multi NORMAL 3, 6, 9 · HARD/ABYSS 3, 9, 11 · solo NORMAL 6, 9 · solo FUNNY none | DATA |
| 机变 format | Multi: 6 shared cards of one family; random pick order; 30 s first, 16 s others; timeout auto-assign. Solo: 3 cards, no timer. Opens at prep start, after income. | DATA/VERIFIED |
| Round flow | round start (income, −1 upgrade price, wipe temp hand, refresh unfrozen slots, <进入休整期时> effects) → [机变] → prep → <休整期结束时> → combat (all boards in parallel, 2× speed) → 联防 if needed → LP loss → next | VERIFIED |

**Timers, co-op (s)** [DATA]. Solo in 下半 has **no** prep or 机变 timer.

| Round | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14 | 15 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Prep | 65 | 65 | 65 | 95 | 95 | 100 | 105 | 105 | 125 | 125 | 125 | 125 | 150 | 195 | 195 (HARD/ABYSS 215) |
| Combat limit (`maxPlayTime`, game s [ASSUMED unit]) | 45 | 45 | 55 | 55 | 55 | 70 | 85 | 85 | 95 | 95 | 115 | 115 | 115 | boss | boss |
| Wave level | 01 | 02 | 03 | 04 | 05 | 06 | 07 | h01 | h02 | h03 | h04 | h05 | h06 | h07_0X | h08_0X |

Boss rounds: the battle continues past the timer. Merged team LP drains **1/s after 150 s** (`bossTurnHpReduceTime`).

## 3. Economy

| Item | Value | Tag |
|---|---|---|
| Income per round | **4, 5, 6, 7, 8, 9, 10, 11, 12, 12…** = `min(3+r, 12)`. The same in every mode (no FUNNY bonus). Paid at round start. | R1–R3 VERIFIED; +1/round and cap 12 ASSUMED (alt cap 10) |
| Leftover funds | Lost at prep end, except band 坎诺特 (carry over; +1 if ≥5 left) | VERIFIED |
| Buy operator | T1 **2** · T2 **3** · T3 **3** · T4 **3** · T5 **4** · T6 **4** | DATA |
| Buy item | 1–5 by item (`purchasePrice` of the `_a` entry). Golden items are never sold in the shop. | DATA |
| Refresh | **1** (rerolls all slots, including frozen ones) | DATA/VERIFIED |
| Freeze | Free. **One toggle freezes all unsold slots** until the next round start. | VERIFIED |
| Sell operator | **+1** (normal or elite, from board or hand) | DATA/VERIFIED |
| Sell item | **Not possible.** Destroy only, for 0. | VERIFIED |
| Upgrade price (Lk→k+1) | NORMAL/HARD/ABYSS: **5, 8, 11, 12, 13** · multi FUNNY: 5, 8, 10, 11, 11 · solo FUNNY: 1, 1, 5, 8, 10 · training: 4, 4, 6, 9, 12. **−1 per round start (floor 0); resets to the next base after upgrading.** | DATA/VERIFIED |
| Shop slots (ops + item) | NORMAL+: 3/4/4/5/5/5 + 1 · FUNNY: 3/4/4/4/4/5 + 1 · training: 3 ×6, item from L5 | DATA |
| Shop cleared | Unfrozen slots are emptied at combat start and refilled at round start. | VERIFIED |
| Bounty coins | 1–6 per bounty enemy, to its killer (a 联防 helper counts). 战术特训: paid only on a perfect clear in your own phase. | DATA |

**Shared pool (co-op), copies per operator:** T1 **12**, T2 **14**, T3 **18**, T4 **16**, T5 **8**, T6 **5** (缪尔赛思 4). An elite counts as 3. Every owned copy counts; shop displays don't. Eliminated or quitting players return their copies. [COMM, two independent sources]

**Shop odds [ASSUMED; the official odds are unpublished].** Each slot draws 1 copy uniformly from all remaining pool copies of unbanned, non-hidden chess with tier ≤ shop level. Duplicates in one roll are allowed; a screenshot shows 2× 蛇屠箱 in one roll. Resulting tier shares with full pools and no bans:

| Shop Lv | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| 1 | 100 % | – | – | – | – | – |
| 2 | 44.7 % | 55.3 % | – | – | – | – |
| 3 | 24.9 % | 30.8 % | 44.3 % | – | – | – |
| 4 | 17.1 % | 21.2 % | 30.4 % | 31.3 % | – | – |
| 5 | 15.0 % | 18.7 % | 26.8 % | 27.6 % | 11.9 % | – |
| 6 | 14.0 % | 17.4 % | 25.0 % | 25.7 % | 11.1 % | 6.9 % |

The visible chess per tier are 16/17/19/22/19/19. The item slot uses the same tier shares, then picks uniformly within the tier [ASSUMED].

**Merge:** 3 copies of the same chess (board or hand) merge into 1 elite (`_b`), sent to the **hand** — or, when a consumed copy was deployed, to **that copy's board position** (PRTS 卫戍协议/帮助 "若消耗已部署至作战区的干员，则发送至作战区对应位置"; 01 A1 row 7). 风丸 needs 2. Elites never merge. The equipment of the merged copies returns to the hand. Reward: the shop temporarily shows 3 operators of tier min(shopLv+1, 6) at price **0**; take 1; no refresh or freeze; gone at round end. A purchase that completes a merge is allowed with a full hand. [VERIFIED]

## 4. Board, hand, combat

| Item | Value | Tag |
|---|---|---|
| Deploy cap | **8** (`characterLimit`); **9** with 人事部文档. Summons don't use a slot (PRTS token pages of the pool's hand summons: 部署占用数 0; user playtest #6). | DATA/VERIFIED |
| Hand (整备区) | **10 regular + 5 temporary**, shared by operators, items and summon stacks. Full ⇒ no buy or withdraw. Passive overflow goes to temp; **temp blocks Ready**; temp is wiped at the next phase. Board↔hand swap is allowed when full. | VERIFIED |
| Equipment | 2 per operator (board **or** hand). Locked; 3rd = replace, and the old one is destroyed. 2 identical normal items (equipped or not) merge into golden. | VERIFIED |
| Deployment | Free, at t=0, order **从上到下>从左到右** = down each column, the columns left to right (right-side boss player mirrored; research 01 §4.3). Ranged units may use melee tiles. | VERIFIED |
| DP | Start **10**, **+1/s**, cap **99**. Used only for auto-redeploy (original tile, respawn timer done, DP ≥ `cost`). | DATA/VERIFIED |
| Skill auto-cast | Default: SP ready + about to attack/heal + an enemy in the **initial** range. ~~`skillTriggerDataList` rows with `skillIndex` 0 = skill 1 only (TANK S1 → on damage: only 古米 and 灰毫 this season)~~ — Superseded by user playtest #6 (DESIGN §20): the class rows apply to **every MANUAL skill** of the class and never to an AUTO skill (PRTS 卫戍协议/帮助 names whole classes; the 阵法术师 row must cover 薄绿's default S2, a phalanx that never attacks with its skill off); a MANUAL skill with its own 技能范围 (not an attack-range change) uses SKILL_RANGE; automatic operations have a 3 s cooldown. charId rows per 03. The TANK row came with 下半 (上半 had none); 深巡 S2, 雷蛇 S2, 号角 S2 / S3 and 灰毫 S1 / S2 deliberately cast with an enemy in range instead (the owner's decision, DESIGN §21.29); 余 S2 too, on its x-1 (SKILL_RANGE, the owner, 2026-10-04, DESIGN §22.10). | VERIFIED (class-row reading superseded; six 重装 skills deviate on purpose) |
| Speed | 2× forced, no manual control | VERIFIED |
| Board geometry | 19×21 stage. Player board rows 9–12, cols 2–10. Gates (9,10) and (12,10); R1–3 use only the lower one. Goal (9,2). Col 9 is a non-deployable lane. Hand row 7 cols 0–9. Temp hand row 8 cols 4–8. Boss field rows 1–5. | DATA |
| Bond counting | Distinct operators on board. 远见/奇迹/投资人 also count the hand. 绝技 counts elites. Layers persist all match; **no IN_BATTLE layer gains in 联防 or boss rounds**; each bond's layers stop at **999** (research 11). | DATA/VERIFIED |

## 5. LP, 联防, Final Assault, Hidden Core

| Item | Value | Tag |
|---|---|---|
| Starting LP | Band `totalHp`: 20 (铃兰) … 45 (歌利亚); default 华法琳 28 | DATA |
| Normal-round loss | 1 per enemy not killed (reached the goal or alive at timeout), **max 10 per round per player** | DATA/VERIFIED |
| 联防 | Runs if ≥1 player leaked and ≥1 was perfect. **≤2 perfect helpers** keep HP%, SP and positions, and fight the union of leaked enemies (`escaped_single` / `escaped_multi`). No layer gains. Survivors cost their **source** player LP (cap 10). | VERIFIED |
| Elimination | LP ≤ 0: out; copies return to the pool | VERIFIED/COMM |
| Final Assault (R14) | LP of all alive players **merged**, no cap. Players in pairs, and an **odd player alone**. Movable bosses spawn one per alive player's side and share one HP pool. Overtime −1 LP/s after 150 s. Wave leaks cost `lifePointReduce`. | VERIFIED |
| Boss HP pool (`bloodPoint`, F/N/H/A) | boss_1 247.5k/675k/1.8M/3.6M · boss_2 225k/400k/800k/3M · boss_3 285k/708.75k/2M/4M · boss_4 307.5k/708.75k/2.1M/4.2M · boss_5 200k/390k/780k/3M · boss_6 285k/705k/1.99M/3.98M · boss_7 277.5k/787.5k/2M/4M. Pick weights 6/6/6/5/10/5/5. | DATA |
| Boss-hit limit (限伤) | Final Assault / Hidden Core: one hit of ≥ 300000 on a leader deals **0** (cancelled, not clamped); minions, normal rounds and 联防 unaffected (research 11). | DATA/COMM |
| Hidden Core (R15, 险境+) | Solo: activated layers **> 350** and LP > 1. Co-op: team sum **> 1200** and merged LP > 1. Bosses boss_8/9/10 (weights 50/40/40; HP N 937.5k/900k/1.0125M, H 3.6M/2.8M/3.8M, A 7.2M/3.95M/7.6M). Failure doesn't affect the clear. | VERIFIED/DATA |

**Enemy scaling (non-boss)**, per mode and round [VERIFIED via PRTS, user-sourced]:
- `atk × base × 1.1^k`, `hp × base × 1.2^k`.
- Base values: solo FUNNY/NORMAL 0.7 (HP 0.75 per data), solo HARD 0.8, solo ABYSS 1.0, multi FUNNY/NORMAL 0.8, multi HARD/ABYSS 1.0.
- k climbs to 5 (solo NORMAL), 4 (solo HARD), 7 (solo ABYSS), 1 (multi FUNNY), 7 (multi NORMAL) and 8 (multi HARD/ABYSS) by R14.
- ABYSS also gets move speed ×1.15 from R3.
- Full round-by-round arrays: `01-core-data.json → _criticAddendum.enemyStatMultipliers`.

## 6. Per-match bans (VERIFIED rule)

The server draws a disabled bond set **D**: **3 core + 4 add-on** in NORMAL/HARD/ABYSS (observed in ABYSS; [ASSUMED] for NORMAL/HARD), and **the static list + 0 core + 1 add-on** in FUNNY. Weight-0 bonds are never drawn.

**An operator is banned iff all its bonds ∈ D.** At 3 + 4 that averages ≈22 banned operators. The briefing shows lit and greyed bonds plus the banned list; the in-match dropdown shows banned counts per bond. The rule reproduces a real screenshot's counts (7/6/5/5/5/4/3) exactly (01 A2).

## 7. Contradictions found and resolved

| Topic | Conflict | Resolution |
|---|---|---|
| Hidden-core thresholds | 05: 300/1000 vs 01/02/06: 350/1200 | **350/1200** (下半); 300/1000 was 上半 |
| DP | 05: initialCost 0 vs 01/06: 10 | **10**. 05 read the terrain file, not the round level. |
| FUNNY round count | 05: 9 | Solo 9, **multi 14** |
| Enemy multipliers | 06: flat 0.7/0.8; 01: per-mode table; 05: invented mapping | Per-round table (§5) |
| Freeze | 01: per slot | **Whole shop, one toggle** |
| Item sell | 04: 1 fund | **Not sellable** (destroy for 0) |
| 机密商店 | 04: 3 items of tier ≥ IV | **6 cards (multi), any tier I–VI, duplicates allowed** |
| Band choice | 01: 3 random + reroll; 06: full grid draft | **Full grid, random order, one skip, duplicates allowed** |
| Banned bonds | 01: 1 core + 1 add-on | **3 + 4 (NORMAL+), subset rule** |
| TANK skill rule | 03: any skill index | **Skill 1 only** |
| 联防 partner rule | 01: fewest leaks | Meaningless; **highest LP, then seat** [ASSUMED] |
| FUNNY income bonus | 01: +2 | **None** (official intro shows 4 at R1 in 标准) |
| 华法琳 granted cap | data 7/14 vs patch 12/24 | **12/24** (official 3/27 notice) |

## 8. Remaining open questions, with recommended defaults

| # | Question | Default (config) |
|---|---|---|
| 1 | Income after R3 and its cap | +1/round, **cap 12** (alt 10) |
| 2 | Shop tier odds | Copy-weighted pool draw (table in §3); a per-level odds table as an optional override |
| 3 | Item slot odds and server pools `pool_equip_*` | Same tier shares; pool contents as in 04 §8 |
| 4 | Disabled-bond counts for NORMAL/HARD | 3 core + 4 add-on |
| 5 | 机变 family per SP round, card pools, 道具补给 tiers | 01 A4 table: HARD+ R3/R9 悬赏, R11 道具补给/机密商店. 道具补给 tier windows R3 I–IV, R6 II–V, R9 III–VI, R11 IV–VI. |
| 6 | Boss HP pool vs alive players | `bloodPoint × alive/4`; solo ×0.25 |
| 7 | Pair order in the Final Assault | Alive players by seat: (1,2), (3,4); an odd player gets an `_s` map |
| 8 | 联防 helper choice when >2 are perfect; leaked-enemy HP | Highest LP, then seat; leaked enemies re-enter at full HP |
| 9 | Per-turn band-draft timer | 12 s, with the 50 s step cap |
| 10 | Unit of `maxPlayTime` | Game seconds (the sim runs 2× real-time) |
| 11 | Do summons use deploy slots? | No |
| 12 | Special-enemy replacement counts and faction pick | 05 §3.2 algorithm (`k = clamp(round(be_t/be_new), 1, 5)`) |
| 13 | Do A3 multipliers apply to bounty and special enemies? | Yes, the current round's k |
| 14 | Title (评语) criteria | 06 §10.5 mapping; one title per player, each title used once |
| 15 | 炎佑 spawn, AI and model; token Spines | 02 §3.1 assumptions; 07 §5.6 fallbacks |
| 16 | DIY (甄选) slots | Disabled in v1; curated 6★ list in v2 |
| 17 | Co-op disconnect | Keep the seat; auto-ready at the deadline; auto-pick drafts; optional AI takeover |
| 18 | Hidden boss selection | Weighted 50/40/40, independent of the R14 boss |
| 19 | Tile rendering | Procedural (no 2D map art exists); see 07 §7 |
