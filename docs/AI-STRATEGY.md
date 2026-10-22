# Regenerating the example advisor's strategy playbook

This is an English strategy method with Chinese game names, for the opt-in example language-model advisor
([API](EXTERNAL_AI.md), [中文指南](EXTERNAL_AI_ZH.md)). It changes advice, not game rules or the legacy AI.
The model receives reproducible candidate evidence and returns a brief justification and a validated plan.
No claim of improved win rate is made. Every recommendation, estimate, role, score and stage boundary below is
**[ASSUMED]** unless explicitly identified as a mechanic or the maintainer's testimony. Test it against legacy
using the existing offline/mocked advisor tools before drawing performance conclusions.

## 1. Evidence and inputs

The **maintainer's expert guidance, 2026-10-19**, is first-hand/community knowledge, **not official text**.
Its editable entries, each with a `source`, live in
[`server/ai/strategy-community.js`](../server/ai/strategy-community.js). Mechanical evidence remains separate:

| Input | Rule source and verification |
|---|---|
| Bands, buffs and bond associations | Local `excel/activity_table.json`: `autoChessData.bandDataDict`, season `activity.AUTOCHESS_SEASON.act2autochess.bandDataListDict`, `effectInfoDataDict`, `effectBuffInfoDataDict`; generated `bands[].buffs.{key,bb,bbStr}`, `desc`, `bondIds`. `shared/bandBonds.js` derives associations from named bonds and effect pools; `server/sim/content/bands/{meta,battle}.js` implements triggers. |
| Operators, tiers, prices, bonds and merges | Season `charChessDataDict`, `charShopChessDatas`, `shopLevelDataDict`; `character_table.json`, `skill_table.json`, equipment tables; generated `chess.{visible,isGolden,bonds,tier,price,profession,canHitFly,dmgType,trait,skill,talents,garrisonIds}`, `garrisons.desc`. Normal visible pool members are the baseline; `GameData` resolves mode economy and merge overrides. |
| Bond thresholds and counting | Season `bondInfoDict`; `bonds.{thresholds,countMode,countsGoldenOnly,noStack}`, `server/match/bondsMeta.js`. Distinct identities count for ordinary bonds, deck-counting bonds include the bench, 绝技 counts elites. Duplicates do not create distinct members. |
| Shop access | `config.modes[modeId].{upgradePrices,shopSlots,maxShopLevel}`, `config.economy`, `GameData`, `player/economy.js`, `pool.js`; [DATA](DATA.md) §1 and [PLAYING](PLAYING.md) §2. No EXP. Upgrade cost discounts by one at round start since the last upgrade; no R1 discount. Only tiers up to shop level can roll. |
| Shop probability and shared stock | Existing copy-weighted reconstruction in `pool.js` / [DATA](DATA.md) §1.2 and [history §29.8](history/0.2.4.md): eligible remaining copies determine rolls, **no fixed level-to-tier probability table**. Co-op doubling is the maintainer's 2026-10-15 decision (#650), not a new official claim. The knowledge pack's `initialTierSharesBeforeBans` is a pristine-catalogue baseline, never live odds. |
| Enemies and leaders | `enemy_handbook_table.json`, enemy database, season `enemyInfoDict`, `specialEnemyInfoDict`, `specialEnemyRandomTypeDict`, `bossInfoDict`; generated `enemies.{acTypes,isFlyEnemy,stats}`, `factions.types`, `bosses.{enemyKey,abilities,escortsByTemplate}`. Implementation: `server/sim/content/enemies/` and `bosses.js`. |
| Leader hit limit | Official client `AutoChessBattleConst.MAX_BATTLE_DAMAGE`, documented in [official limits](research/11-limits-official.md) §2; `shared/constants.js BOSS_HIT_LIMIT`, `server/sim/damage.js`. |

The generator accepts an explicit data object and mode, without a match or RNG. `knowledgePack()` includes its
result in the content-addressed static prefix. `strategyCandidates()` accepts only that playbook and the existing
seat digest; it cannot consult another seat's hand, money, shop, private DIY stock, live shared pool, future rolls
or future unannounced enemies. The boss input is the public boss, not the hidden-core selection.

At band draft, inputs are legal observation-local band actions, announced disabled bonds/operator bans, mode,
announced factions/boss, and teammates' already chosen public bands/boards. At preparation, add the current band,
round, own board/bench, shop, funds/level, current bond counts/layers, previous acknowledged plan, transactions and
last battle outcome. The compact digest and continuity retain the latter details for the model; candidate scores
use catalogue access, owned identities and public team state. A score is not a substitute for the actual shop.

## 2. Community overlay

The maintainer recommends forming several directions at draft that avoid competing with teammates' professional
teams. His usual mains are 杜遥夜 → 炎, 埃芒加德 → 阿戈尔, 佩佩 → 萨尔贡, 潘格尼尼 → 拉特兰,
哈洛德 → 维多利亚, 贾维 → 叙拉古 and 大帝 → 卡西米尔. The S.W.E.E.P. strategy report's associations are
represented in `bands.bondIds`: additionally 娜仁图亚 → 萨尔贡, 休露丝 → 谢拉格, 克莱门莎 → 阿戈尔,
玛恩纳 → 卡西米尔. 埃芒加德 and 大帝 have no explicit data bond; their suggested mains remain community advice.

The maintainer's usual sub-bonds are:

| Main | Suggested alternatives (not all mandatory) |
|---|---|
| 拉特兰 | 精准 / 灵巧 |
| 萨尔贡 | 精准 / 迅捷 / 灵巧 |
| 维多利亚 / 叙拉古 / 炎 | 奥术 |
| 谢拉格 | 奥术 or 精准 / 灵巧 |
| 卡西米尔 / 阿戈尔 | 突袭 / 不屈 |

The maintainer supplied detailed 电表倒转 evidence on 2026-10-19 (§8), then required named builds to have
documented play or be removed. The unsupported two-core combination was removed: the supplied Bahamut
盟约下 summary leaves the Kazimierz section unfinished and contains no write-up of that pairing.
§9 records the separate 谢拉格冰冻叠层 and 卡西米尔部署叠层 recipes and their version differences.
A mechanical `bondIds` vs community-main
disagreement is emitted as `main-disagreement`; data wins for engine eligibility. Missing old-version bands,
bonds or pair entries produce warnings instead of fictional replacements. An empty mechanical association is
not a disagreement with a community suggestion.

The maintainer also suggests 罗素 with cheap elites and three 坚守 as the team's safety net when professional
teams have poor early enemy matchups but strong late potential, or 芬 supplying their missing key operators with
信标. These are **[ASSUMED] strategies based on community testimony**, not guarantees of carrying a team.

## 3. Mechanical implications

Numbers below were checked against current generated data and the implementation paths in §1. The generator
reads the blackboards, so changed numbers regenerate; unfamiliar effects still require human interpretation.

| Band / rule | Verified mechanic | [ASSUMED] planning implication |
|---|---|---|
| 余 | `round_start_bond_check_gain_layer`: at **R8 start**, exactly one active bond gets +36 layers; otherwise each active bond gets +12. `noStack` bonds are skipped by the maintainer's 2026-10-08 decision, but still count toward the active-bond condition. | Enter R8 from R7 with one stacking bond if concentrating layers is worthwhile, then widen after the check. One prioritized target does not ensure only one active bond. Three active stacking bonds can total the same 36 layers; concentration is a choice, not a universal optimum. |
| 阿米娅 | `act1autochess_band2_buff`: 3 / 4 / 5+ active bonds give all operators ATK and HP +20 / 30 / 40%, directly multiplied. | Cheap overlapping two-member thresholds can make a wide board. The adapter's three **priority** targets do not cap incidental active bonds. |
| 华法琳 | `prep_finish_char_bond_add_layer`: at prep end, pick **one random fielded operator of each distinct tier**, adding +2 to that operator's bonds without requiring activation. | Preserve useful mixed-tier members. Do not multiply every active bond by the tier count or assume a specific random recipient. |
| 夕 | `act2autochess_band12_buff`: at battle start, operators sharing a base name, normal or elite, receive +30% ATK. | Keep useful duplicates if they outweigh the lost distinct-member slot. Normal three-copy auto-merging still happens. |
| Touch | `auto_chess_change_map`, `condition_golden_chess_ge cnt=2`: each player's reserve medic becomes Touch if **that player's board** has ≥2 elites at battle start. | Build two useful elites on each board; one seat's elites do not satisfy another's check. |
| 坎诺特 | `coin_carry_over`, `capital=5, interest=1, max=1`; `GameData.leftoverKeptBands`, `player/round.js`: funds carry and earn at most 1 interest. Other vanilla bands lose leftover funds. | Save the useful five-fund threshold only if survival permits; spend expiring funds for other bands. Plugin effect aliases may also carry. |
| 伊奥莱塔·罗素 | `act2autochess_band3_buff`: each fielded elite gains ATK and HP +10% per fielded elite, directly multiplied at battle start. Normal operators do not receive it. | Assemble cheap elites and a stable defensive bond rather than chasing only high tiers. |
| 陈 | `act1autochess_band19_buff`, `items/battle.js weaknessRetype`: physical/Arts hits use weakness damage's favorable defense calculation. | Consider uneven DEF/RES matchups. This does not bypass the leader hit limit. |
| 芬 / 信标 | Grant buffs give beacons at R8/10/12/14. Item buff `use_equip_recruit_new_char_and_give_char_to_player_most_bond`, `builtinMeta.js`: consume carrier/item, choose one of two same-tier replacements; original goes **next prep** to the teammate with most matching members, random ties. DIY carriers are disallowed. | Buy a missing teammate core only with useful delivery timing and the correct likely automatic recipient. Buying a gift temporarily consumes shared stock; it is not an unlimited supply or a freely addressed transfer. |
| 限伤 | In Final Assault/Hidden Core outside training, a leader hit with `ceil(final damage) >= 300000` is **voided**, not clamped. Applies after defense/multipliers; not to normal enemies or ordinary escorts. | Repeated sub-limit hits can beat one oversized hit late. Do not assume every high-tier attacker violates the limit; actual equipment/layers and skill hit structure matter. |

## 4. Deriving the playbook

`buildPlaybook()` records normal visible members by bond and tier, prices, profession, damage type and trait
descriptions. Its co-occurrence graph connects every pair carried by the same operator; **[ASSUMED]** edge weight
is `sum(1 / tier)` over those operators. Each bond exposes its five strongest edges. This favors cheap bridges,
not measured combat strength; 拉特兰 + 精准 appears without curating that edge. Elites are not double-counted.

Coverage includes explicit `canHitFly` damage dealers, ground blocking, healing, and separate reveal,
element recovery and element offense hints. **[ASSUMED]** reveal is conservatively recognized from current
Chinese trait/default skill/talent text, and team element recovery from the wandering-medic branch. A caster
inflicting element damage is not an element healer. These are potential catalogue capabilities, not guarantees:
range, placement, skill uptime, owned/stand-in/DIY variants, optional skills, modules and plugin scripts can
change them. Missing recognition means review is needed, not proof that no counter exists. Static enemy type
catalogues describe possibilities; candidate needs come from announced factions, upcoming enemies and the
announced boss's catalogue escorts, never a future sampled wave.

Threshold `estimatedRound` is **[ASSUMED]**, an earliest expected crossing under this explicit baseline:

1. Start at shop L1. Each round, upgrade at most once if the discounted price fits after reserving the cheapest
   catalogue operator's price. Discard carry assumptions; read income, upgrade prices and slots from this mode.
2. Budget one paid refresh when affordable; otherwise use the ordinary shop only. Accumulate the remaining
   nominal purchase budget. Exclude sales, gifts, interest, band guarantees, equipment and count modifiers.
3. For each eligible operator, use pristine `copies(id) / eligible copies`. Over `slots × shop visits` draws,
   update expected distinct sightings as `1 - product((1-p)^draws)`. This with-replacement approximation ignores
   bans, depletion and slot correlations; it is not a confidence bound or a promise to own the piece.
4. First round where summed expected distinct sightings reach the threshold **and** cumulative budget covers
   the cheapest members is the estimate. Elites instead use conservative expected-encounter credit
   `clamp((encounters - mergeCopies + 1) / mergeCopies, 0, 1)` and full merge purchase cost; this is not a merge
   probability. Natural board thresholds also respect deploy capacity; deck bonds are exempt from that bound.
5. `null` means no crossing in this schedule, or capacity/member shortage, not impossible gameplay. For example,
   炎 9 needs counting/capacity effects beyond an ordinary eight-slot board. Band engines can arrive earlier;
   shared competition can delay any estimate. The generator's schedule is included for review.

Band role classes are **[ASSUMED]** mechanical summaries: explicit bond associations → `bond-engine`; currency
effects → `economy`; duplicate/elite effects → `elite-merge`; active-bond scaling → `wide-bond`; grants/selection
of items → `item`; team map characters/enemy changes/beacons → `team-support`; other effects →
`combat-modifier`. Several classes can apply. Class names are not new gameplay rules or proof that a band is
good against the current enemies. Exact special implications use recognized buff keys and their numeric values.

## 5. Candidate construction and scoring [ASSUMED]

Enumerate legal band actions at draft, or only the selected band in prep. Remove disabled mains/subs, publicly
banned operators, elite-only/no-stack main directions, and bonds lacking enough natural catalogue members for
their first threshold. Explicit band engines retain their data main. Other bands can consider any surviving
stacking bond. This is a conservative baseline: special count bonuses and custom scripts are not forecast.

For each main, rank legal sub-bonds by `4 × graph weight + 3 if community-preferred - 3 × competing teammates`.
Keep the best three positive sub scores; enumerate their two-bond pairs and the best single sub. Use at most two
subs. At the band draft, return at most eight directions (§35.15). [ASSUMED] Every uncontended
community/maintainer main that is still a legal draft action is preferred over a second sub-variant of a band
already listed. When more than eight qualify, keep the eight highest scores, one variant per band and main.
On the current 绝境 catalogue an empty round-1 draft therefore keeps 佩佩, 潘格尼尼 and 克莱门莎 and cuts
杜遥夜 (score 28.8, just under the eighth place at 29) and 埃芒加德 (no data bond engine, score 13). In prep,
generic variants that share a band and a main collapse into one candidate. Its id is `band:main`, so a later
sub change is not a new direction. `subOptions` lists each `{subs, score}`. Named community builds and cycle
recipes keep their own ids and may take a free slot. Fewer than two distinct directions are reported explicitly
when the legal space is too small. Never fabricate a banned alternative just to fill the list.

The additive `scoreParts` are saved with each candidate:

| Component | Weight |
|---|---|
| Mechanical engine / usual community main | +16 / +8 |
| Cheap natural members, tiers 1–3 | +2 each, up to five |
| Baseline first-threshold time | minus estimated round, or −16 if absent |
| Owned distinct main members / previous acknowledged main | +5 each / +14 |
| Teammate main contention | −24 per teammate; additionally −2 per main member present on another public board |
| Enemy coverage | +4 per covered required capability; −9 per absent capability; −3 per requirement absent from cheap main members |
| Pair support | sum of selected sub scores, capped at +6 |
| Safety net / supplier | +6 for the community safety-net main, plus +4 per early-weak teammate; supplier +5 per early-weak teammate |
| Defense mix | +2 for Arts availability against a preview DEF ≥500; +2 for physical availability against RES ≥50 or 折射 |

These numbers and defense cutoffs are **[ASSUMED] engineering policy**, exposed for reruns and tuning. Ties use
stable IDs. Teammate mains are inferred from public mechanical/community band associations and active public
bonds; they are not declarations of intent. A teammate is estimated early-weak if a main has fewer than three
tier-1–3 members or lacks an announced counter at those tiers. Contention penalties indicate risk in the shared
pool, never an estimate of remaining copies. A supplier can intentionally overlap for transfer, but must explain
that tradeoff. Banned sub-bond edges are excluded; graph weights retain pristine weighting even after bans.

Candidate keys are up to four eligible core members per stage, favoring already held identities, main members,
less public competition, then cheap tiers/cost. They are options, not a shopping list to buy in full. Missing
coverage carries separate cheap counter suggestions; the model must check deploy slots, price, shop availability,
range and incidental bonds before adding them. Supplier options show missing public-board members, with no claim
about what the teammate already has in hand. Current stage windows are recommendations; mode-specific boss timing
and actual previews take precedence (e.g. an earlier FUNNY leader).

## 6. Team roles and staged decision method [ASSUMED]

| Role | Job and decision test |
|---|---|
| Carry | Grow damage/layers without worsening team matchups. Prefer an unclaimed engine and preserve blocking, anti-air and healing. Avoid taking a teammate's scarce main pieces merely to add an incidental bond. |
| Safety net | 罗素/cheap elites/three 坚守 is the maintainer's example. Cover early leaks while professional teams develop; check the actual enemy counters instead of assuming every defensive board can stop flyers. |
| Supplier | 芬 buys a missing professional-team operator when the automatic beacon recipient and next-round timing make it useful. Preserve own survival; avoid speculative hoarding long before a beacon. |
| Economy | Convert band-specific discounts, grants or interest into later shop access and useful pieces. Only bands that carry funds can bank them. Save five for 坎诺特 only when the lost immediate board strength is acceptable. |

At each decision: inspect last outcome and accepted plan → check bans/team claims/enemy needs → compare candidate
scores and missing coverage → choose a role/main/sub set → verify what the current shop and board can accomplish
→ emit brief `why` and a bounded plan. Keep useful investments, including accumulated layers, through ordinary
bad shops. Change the primary bond (the highest priority) only with `pivot:true` and a concrete `pivotReason`.
Adding, removing or reordering sub-bonds is not a pivot (§35.15). Existing plan repair retains
viable previous targets when a primary change is unexplained. A future main can guide `buy/keep` but cannot be a prioritized
`plan.bonds` target until the existing held/reachable gate accepts it. An empty plan still delegates to legacy.

| Stage | Inputs and action priorities |
|---|---|
| R1–3 | Actual cheap offers, initial enemy preview, LP, blocking/healing/air gaps. Fill a functional board and take affordable pairs; avoid early high-tier wish lists. Identify the likely main and a fallback without opening every bond. |
| R4–7 | Main's next threshold, current layers, shop unlock costs, teammate claims and newly visible threats. Complete main thresholds and useful merges. For 余, prepare the **R8-start** active-bond condition before leaving R7. |
| R8–10 | Elite opportunities, sub-bond bridges, coverage and actual band triggers. Complete elites, add useful subs, widen after 余's check; 芬 has R8/10 beacons with next-round delivery. |
| Late game | Announced leader, final-assault partner/formation if visible, hit-count/air/stealth/element threats, sustain and hidden-core eligibility. Review single-hit size versus 限伤; retain multiple effective damage sources. Do not assume an unrevealed hidden boss. Preserve LP/layers if aiming for the existing hidden-core rule in `config.hiddenCore` / `GameData.hiddenCore`. |

Enemy checks precede each stage's preferred purchases: air needs an actual damage-capable anti-air unit in range;
stealth needs reveal uptime or a blockable target and a surviving blocker; element enemies need recovery/mitigation
and burst-aware placement, not merely element offense; 频次 needs attack frequency; 折射 needs damage-type review;
持续 needs sustain/spacing. The generator exposes hints and gaps; legacy rehearsal still handles detailed placement.

Additional rule-derived ideas, **[ASSUMED] and unbenchmarked**, to explore in reruns:

- Use cheap graph bridges to get 阿米娅's incidental wide activations while prioritizing only three invested bonds.
- Build a 华法琳 mixed-tier core whose selected tiers share the intended layer bond, reducing random recipient waste.
- For a team facing 元素, let a low-contention supplier cover a missing element healer as well as professional mains;
  verify matching-bond recipient rules first. This can be more useful than another damage-only bridge.
- A duplicate 夕 pair can provide frequency against 频次 and sub-limit leader hits, but the distinct-member and
  slot costs must be checked. Do not conclude duplicate retention always beats an elite merge.
- Keep reveal/air counters outside the main as explicit conditional repairs; choose the lowest-contention source
  instead of forcing every threat into an otherwise strong professional engine.

## 7. Regenerate for another version

`node tools/ai/playbook.mjs --data-dir data --mode mode_multi_normal` writes an audit JSON to stdout, without
network or game actions. Optional `--community path.json` replaces the editable overlay (same object shape);
`--observation path.json` accepts a seat digest or `{digest,previousPlan}` and includes candidates and score parts.
Archive output outside generated `data/`; it contains derived advice and optional private seat information.
The command records hashes of every consumed data file, policy/helper code and this method, the entire community
overlay, and the derived playbook. Identical inputs and code produce identical output; no timestamps or RNG.

1. Export that version's generated data into a separate directory using its matching offline data builder/schema.
   Keep official source files in the ignored cache; never copy them into tests or the repository. Record their
   revision privately alongside the audit. The CLI expects the generated schema described in [DATA](DATA.md).
2. Choose its actual mode. Check active/inactive bonds, visible operator roster, prices, merge exceptions,
   shop access, capacity, factions and bosses. The CLI rejects unknown modes instead of silently using defaults.
3. Review the community overlay against that version; retain per-entry sources/dates. Resolve disagreement and
   missing-reference warnings. Recheck 电表倒转's event timing, available members and economy thresholds (§8).
   Keep community advice distinct from official rules.
4. Check recognized buff keys against that version's implementation; changed numbers are automatic, changed
   semantics/new keys require updating the implication extractor and tests. Review language-dependent coverage
   detection, optional skills, effect aliases, stand-ins, DIY and plugin rules. This tool is not a universal schema
   migration engine; unknown semantics require review.
5. Run the generator and save its audit. Retain the matching code revision and dependency environment as well as
   hashes; hashes alone cannot reconstruct deleted source. Compare graph edges, coverage, baseline schedules,
   band classes and warnings with the prior audit before evaluating recommendations.
6. Replay representative **seat-visible** observations: banned main, competing professional teams, early weakness,
   air/stealth/element requirements, and each band-specific trigger. Save candidate score decomposition and the
   short model rationale/plan diagnostics when evaluating; no hidden match state or raw credentials are needed.
7. Run `node --test test/match/ai-playbook.test.js` and the external advisor/knowledge/LLM/continuity suites, docs
   checks, lint/import/typecheck, and golden verification. Use loopback mocks unless real API use is separately
   authorized. Golden should not move for a playbook-only change. Compare outcomes over seeds only after verifying
   that the regenerated rules and observations are correct.

This saves the reproducible decision method, evidence, assumptions and scored alternatives. The example still
requests only a brief justification, not an unrestricted model reasoning transcript.

## 8. 电表倒转 — economy/acquisition cycle [ASSUMED]

The maintainer's **2026-10-19 first-hand/community description** is to build 远见 and 投资人 layers early, then
repeatedly acquire and sell surplus operators (过牌) whose acquisition effects grow useful damage bonds. This
is a strategic hypothesis, not a claim of infinite funds. The maintainer supplied these community references and
summaries; this implementation could not independently retrieve the pages (timeout/403) or videos (412):

- [炎维 recipe](https://www.qieyou.com/content/148509): a level-four hold, economy-first purchasing and a
  packaging-assisted cycle. Its named operators and tempo must be checked against the chosen roster.
- [Part-one/part-two comparison and variants](https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316): changed
  远见/投资人 thresholds, 铃兰/焰尾, 叙拉古/忍冬 and 谢拉格/雪猎/银灰 variants.
- [攻略2.0](https://www.bilibili.com/video/BV126wqzqE7f/),
  [part-two demonstration](https://www.bilibili.com/video/BV1m2wuzfEMA/) and
  [layer-mechanics video](https://www.bilibili.com/video/BV1U3yVBtEan/): recorded as maintainer-provided references,
  not watched/transcribed or treated as independent proof of current mechanics.

The overlay retains these URLs, stages, preconditions, damage-bond variants and dated provenance. No article
text is copied. The build's generated rules and members come from **our data and handlers**, which take priority
when a community recipe describes another release. `playbook.cycles.disagreements` preserves the numeric,
roster and event-timing differences; the following are the verified current facts:

| Community claim / requirement | Our version and source |
|---|---|
| 远见 money and discounts | `bonds.visiShip`: two distinct board/bench members activate it; each new ten-layer milestone pays 2 funds while active. At 80 layers the permanent −1 applies to 远见 operators; at 150 it becomes −1 for all shop operators, replacing the earlier discount. Part-one's all-operator threshold of 100 does **not** apply. `bonds/addon/meta.js` latches the discounts; price floor 0 is the maintainer's 2026-10-04 decision. Milestone catch-up and prep-end funds deferral retain that module's existing [ASSUMED] timing. |
| 投资人 amplification | `bonds.investShip`: three distinct board/bench members; acquired-operator `SERVER_GAIN` traits run twice while active, three times at 100 layers (`effectsMeta.js investRepeat`). Part-one's 70-layer threshold does **not** apply. Repeated copies of one identity do not supply three members. |
| Hold L4; L2 at R3, L3 at R4, L4 at R6 | This is the community's tempo prescription, not a rule. Current visible investors are 锡人 T2, 琳琅诗怀雅 T3, 凛御银灰 T5 and 山 T5. Natural shop access to three distinct investors therefore needs **L5**. An already owned higher-tier gift/reward can permit L4; no future gift is assumed. The community R4/R6 upgrades can consume the entire ordinary round income, so survival and actual funds override the schedule. “Hold level” means stop upgrading, **not** the `g.freeze` shop-slot action. |
| 伊桑 + packaging, with 万顷 / 林 / 山 on the board | 伊桑、万顷、林 are absent from our generated chess roster. They are listed as missing, never silently renamed or proposed as buy IDs. 山 exists at T5. His `garrison_34_a` is **SERVER_PREP_FIN**, +1 active 投资人 layer per acquisition counted during that prep; elite +2. It is not an immediate on-every-acquisition listener. |
| Every acquisition fires all board gain effects | `effectsMeta.js _garrisons` fires only the gained piece's acquisition traits. `player/acquire.js` increments the acquisition tally and, when acquisition completes a merge, fires the resulting elite's traits. Current acquisition-tally supports are 小满 (prep-end 炎 +1/acquisition), 夕 (prep-end 炎/奥术 +2/acquisition), 山 (prep-end 投资人 +1/acquisition), with their own active/board requirements. |
| 琳琅诗怀雅 supplies funds | `garrison_98_a`: **prep end**, +1 fund **next round** (elite +2); on the bench it requires active 炎 or 投资人. Her battle talent's coins and deployment-cost consumption are not shop funds. She has no SERVER_GAIN trait. |
| 商业包装 returns 伊桑 / 炎 on selling | `items.chess_item_5_07_e_a/_b`, buff `sell_char_count_gain_equip_owner_bond`: every 8 sales (advanced 7), attempt one random normal sharing **any** carrier bond, at or below shop level. `builtinMeta.js rollSameBond` uses available shared stock; identity is not guaranteed. Both item forms are tier 5; 马克维茨 gives the normal item at R1. The carrier must remain equipped; selling it detaches the item before sold hooks. |
| Selling feeds the cycle | `player/economy.js sell` refunds `GameData.sellPrice`; `player/pieces.js returnCopies` returns only that piece's accounted copies to shared/private stock, not to hand or a guaranteed shop slot. Buys usually cost more than their refund. Packaging is a separate periodic grant, not an automatic repurchase. |
| 铃兰 repeatedly triggers 焰尾 | Current `band_lisa` re-triggers one eligible on-field acquisition trait **once at each round start**, prioritizing rightmost then bottommost. 投资人 multiplies that trigger. It is not a free repeat action during the same prep. 焰尾's `SERVER_POOL_CHAR` grants a pool-dependent normal from 野鬃 / 灰毫 / 远牙; the current 10/10/3 pool weights are the existing [ASSUMED] reconstruction. |

### Derive acquisition effects, not battle-cost prose

`server/ai/cycles.js operatorEvents` joins each normal/elite chess's `garrisonIds` to
`garrisons.{eventType,effectKey,bb,bbStr}`. These **mode-specific 特质** govern on-acquire behavior; ordinary
`talents` and `skill` descriptions describe combat abilities and cannot establish a `SERVER_GAIN` hook.
We checked the named operators' skills/talents alongside their special traits to avoid confusing combat SP,
deployment fees or Swire Alter's skill coins with shop income. No name whitelist determines cycle effects.
Unknown handlers retain raw evidence with `kind: unreviewed` and supply no invented benefit.

Recognized acquisition categories include own/explicit/multiple-bond layers, shop-level-scaled layers,
highest-active-bond layers, next-round funds, pool-dependent operator copies, item grants and free refreshes.
The data includes these normal-form examples (elite quantities are generated separately):

| Acquired operators | Effect per trigger, before 投资人 repeats |
|---|---|
| 角峰 / 艾丝黛尔 / 深靛 / 野鬃 | +2 to own bonds; no activation required. |
| 惊蛰 | +shop level to 炎. |
| 雪猎 / 灵知 | +5 to own bonds; no activation required. |
| 忍冬 / 星熊 / 锏 | +6 / +8 / +8 to own bonds respectively; no activation required. |
| 烛煌 / 录武官 | 炎+5 and 维多利亚+5 / 炎+6 and 奇迹+3. |
| 灰毫 | +3 to the active bond with most layers; conditional destination, not guaranteed to feed the desired main. |
| 能天使 / 新约能天使 | +1 / +2 funds **next round**, not usable immediately for another purchase. |
| 焰尾 | One random operator from the named pool, subject to availability; nested acquisition effects can fire. |
| 诗怀雅 / 耶拉 / 卡涅利安 / 缪尔赛思 | Specific item grants from their garrison records; these are not generic cash grants. |
| 洛洛 / 普罗旺斯 | Pool-dependent equipment / one free refresh, respectively. |

Foresight layer growers found in current event records include 赫默, 伊内丝, 风笛, 圣约送葬人 and 寒檀;
these grow layers through their prep/combat triggers, not immediate acquisition. 山 is the current natural
投资人 acquisition-tally grower. Acquiring many cards does not grow either bond by itself. Copied/custom traits,
room scripts, loadout changes and special counting equipment remain outside this conservative forecast.

### Current variant membership

`cycles.variants` separates the community's named members into `present` and `missing`, then derives additional
`cycleMembers` from layer targets and operator-grant pools. Pool links through 灰毫 are **conditional** on its
highest-active target; they do not promise that every copy grant feeds every listed damage bond.

| Variant | Named members present | Derived cycle options in our roster |
|---|---|---|
| 炎维 | 山, 琳琅诗怀雅; missing 伊桑, 万顷, 林 | 惊蛰, 深靛, 灰毫, 星熊, 烛煌, 录武官; 焰尾 can supply 灰毫. Acquisition-tally support: 小满, 夕, 山. Feeds 炎 / 维多利亚 / 奥术 where applicable. |
| 铃兰 / 焰尾 | 焰尾, with the 铃兰 band | 野鬃, 灰毫, 忍冬, 锏 and 焰尾's copy pool can feed 卡西米尔 / 迅捷. The purchased acquisition and the band's next-round retrigger are separate. |
| 叙拉古 | 忍冬 | 忍冬 directly feeds 叙拉古 / 迅捷; 野鬃, 锏 and the conditional 灰毫/焰尾 route can feed the sub-bond. |
| 谢拉格 | 雪猎, 银灰 | 角峰, 深靛, 灰毫, 雪猎, 灵知, 锏 and the conditional 焰尾 pool route feed 谢拉格 / 精准 / 灵巧. 银灰 is a combat/reveal/freeze support, not an acquisition cycler. |

Every variant additionally needs the derived economy members/growers and a feasible budget. Stage operator lists
are filtered by bans and the match's feasible hold level; for example the adapted L5 route cannot repeatedly buy
T6 锏. Existing high-tier owned supports can be kept at L4, but their existence does not make T5 shop rolls legal.
These alternatives are **[ASSUMED] adaptations**, not claims that the source recipe used this different roster.

### Candidate gate and staged advice [ASSUMED]

The generator exposes exact economy facts and provenance; `cycle-candidates.js` adds proposals to the same scored
shortlist as other archetypes. Its primary is one available damage bond, with 远见/投资人 as the two sub-targets.
The held/reachable gate still controls which may enter `plan.bonds`; other fed damage bonds can be incidental.

- Require both economy bonds enabled and enough unbanned natural members, a reachable layer grower for each,
  a gain-event feeder, and a funds source (operator deferred funds or the 远见 milestone engine). Missing current
  prep funds data refuses a proposal. The hold is the lowest level at least the community hold/current level
  satisfying those requirements, allowing **already owned** higher-tier engine/support exceptions. No forecast
  claims enough copies or layers by a particular round. The packaging variant also needs a reachable item:
  known owned item, normal catalogue access, or the band's recorded grant.
- Mark `setup` until both bonds are actually active, the held level is reached, funds are spendable, a feeder is
  held/displayed, and any required package is owned. Funds earned next round never count as spendable now;
  existing milestone layers do not pay the same milestone again. `ready` means basic preconditions hold,
  not that purchases are profitable or the board can win.
- Decline early setup at LP ≤10, after ≥3 observed leaks, or after any leak with uncovered announced counters.
  Decline a new engine after R10. Decline when a teammate publicly activates/claims either engine bond, has two
  of its cheap members on board, or claims the intended damage main. These are conservative policy cutoffs,
  not official difficulty limits or a hidden-stock estimate.
- Score = 18 base +16 for a matching mechanical band +3 per held engine member (max six) +14 when both engines
  are active +min(12, total engine layers/20) +8 for a variant's required band +6 for a packaging-grant band
  +14 for the previous main/engine direction +3 with spendable funds, minus 2 per missing shop level,
  4 per uncovered preview capability, and 3 per shop level above the source's L4 hold. These weights are
  **[ASSUMED]**, and scores/conditions are preserved in the optional observation audit. Ordinary builds remain alternatives.
- R1–3: survive, acquire cheap economy members and begin their actual layer triggers. R4–7: attain the feasible
  shop access and active engines, preserving critical blockers/healers. R8–10: hold level, buy useful cheap
  acquisition effects and sell only surplus copies; keep the package carrier and distinct engine members.
  Late: convert the budget into the relevant damage bonds and counters; stop the cycle when costs, stock or
  enemy pressure invalidate it. Earlier completion can start earlier; no stage requires unnecessary waiting.

The model prompt distinguishes this strategy from execution. The existing ID-level plan API cannot express an
arbitrary repeated buy/sell sequence or safely identify which duplicate to sell. It must not put every engine
or feeder ID into `sell` to imitate the cycle. This change proposes and explains the archetype; it does not add
an unbounded trade loop, guaranteed profit, hidden inventory access or a new gameplay mechanic.

## 9. Sourced freeze and redeployment builds [ASSUMED]

Maintainer decision **2026-10-19**: keep only named builds with detailed play. The following community summaries
and URLs were supplied with that request; this task used **no network**, so pages and videos were not independently
retrieved or transcribed. They support the strategy descriptions, not new official mechanics:

- 谢拉格冰冻叠层: [Bahamut 盟约下 summary](https://forum.gamer.com.tw/C.php?bsn=33651&snA=12770),
  [Bahamut comparison](https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316),
  [233乐园](https://www.233leyuan.com/post-detail/1993914451791876096),
  [video reference](https://www.bilibili.com/video/BV1xVdBBWEuu/), [切游](https://www.qieyou.com/content/146194).
- 卡西米尔部署叠层 / 突袭卡西米尔: the same Bahamut summary,
  [TapTap](https://www.taptap.cn/moment/782049742673676589),
  [video reference](https://www.bilibili.com/video/BV1XLwhz8ESa/).

Official verification used local `activity_table.json` → `activity.AUTOCHESS_SEASON.act2autochess`:
`bondInfoDict`, `effectInfoDataDict`/`effectBuffInfoDataDict`, `garrisonDataDict`, `charChessDataDict`,
`charShopChessDatas` and `shopLevelDataDict`; character/skill tables supply operator skills. Current generated
`data/bonds.json`, `chess.json`, `garrisons.json`, `items.json`, `bands.json` and the existing bond/garrison/item
handlers win over community shorthand. `community.builds[].mechanics` retains their current descriptions,
thresholds and effect parameters with record paths; `members` resolves names to visible normal IDs, preserves
hidden normal records separately, and emits `id:null` for unavailable names. Elite forms use the corresponding
`_b` IDs and their own data quantities; the numbers below describe normal forms unless stated otherwise.

| Source name / alias | Current buy ID | Tier / role |
|---|---|---|
| 初雪 | `chess_char_3_14_a` | 3, freeze collector |
| 银灰 | `chess_char_4_22_a` | 4, substitute collector / reveal |
| 灵知 | `chess_char_4_13_a` | 4, charged S2 wide cold/freeze |
| 耶拉 | `chess_char_3_20_a` | 3, grants 不融冰 on acquisition |
| 角峰 | `chess_char_1_02_a` | 1, early Kjerag blocker [ASSUMED] substitute |
| 空弦 | `chess_char_3_21_a` | 3, multi-hit ice carrier / prep-start layer support |
| 魔王 | `chess_char_4_25_a` | 4, front operator's battle trait +1 layer |
| 异鲨 / 归溟幽灵鲨 | `chess_char_5_13_a` | 5, optional Egir/Indomitable stacker, not innate Kjerag |
| 阿斯卡纶 | absent from `data/chess.json` | Never invented as a buy ID or assumed DIY pick |
| 异银 / 凛御银灰 | `chess_char_5_14_a` | 5, front Kjerag freeze-trait grant / Swift |
| 妮芙 | `chess_char_5_22_a` | 5, prep-end Swift layers from bench count |
| 远牙 | `chess_char_4_20_a` | 4, rightmost-in-row deployment-trait grant |
| 砾 | `chess_char_2_12_a` | 2, deployment/death stacker |
| 瑕光 | `chess_char_3_12_a` | 3, Kazimierz/Raid deployment stacker |
| 野鬃 | `chess_char_1_19_a` | 1, cheap Kazimierz/Swift |
| 灰毫 | `chess_char_2_18_a` | 2, cheap Kazimierz/Steadfast |
| 焰尾 | `chess_char_4_19_a` | 4, acquisition grants a pool-dependent operator |
| 铃兰 | `chess_char_5_10_a`; separately `band_lisa` | 5 operator / draft band, different timing and target |
| 耀骑士临光 | `chess_char_6_17_a` | 6, late Kazimierz/Raid option [ASSUMED] |

### Freeze play, stages and limits

**Core:** one collector (初雪, or 银灰) plus 灵知 S2 and a third distinct Kjerag. At L3 prioritize 耶拉/初雪/空弦;
at L4 add 灵知/魔王. Put freeze transitions inside the collector range; place that collector in front of 魔王
for the extra trait layer. 耶拉 provides 不融冰 for cold overlap. At L5 prefer useful 凛御银灰/妮芙 elite merges,
with 凛御银灰's recipient a Kjerag directly in front. These are purchase/positioning priorities, not promised rolls.

**Stages [ASSUMED]:** R1–3 survive and gather cheap distinct members; R4–7 reach L3–4 and establish the freeze
engine; R8–10 add L5 support/merges and secondary bonds; late aim for **谢讯** (Kjerag + Swift). Three Kjerag are
the economical baseline; add 迅捷 / 灵巧 / 奥术 and useful stackers rather than blindly chasing six. Near-permanent
freeze can contain melee enemies, but AoE can collapse the clustered engine and many stealth enemies require
reveal. Immunity, poor cold overlap and excessive single-hit damage against the leader are additional limits.
At high layers Arcane amplification can push hits into the existing 300000 leader void threshold.

**Substitutes:** 银灰 replaces 初雪 as collector; 角峰 fills early membership. The supplied no-灵知 route is
阿斯卡纶 plus two Kjerag 不融冰 carriers, but 阿斯卡纶 is absent here. Two owned ice-equipped attackers are only
an **[ASSUMED] conditional fallback** requiring cold overlap; the scorer does not silently replace 灵知 with
that unverified route. 异鲨 is optional support, not a replacement for a Kjerag collector.

### Redeployment play, stages and limits

**Core:** 远牙 + 砾 with at least three distinct active Kazimierz; put the redeploying receiver rightmost in
远牙's row at battle start. 瑕光 can receive that grant instead when Raid triggers are feasible. Preserve cheap
野鬃/灰毫 for thresholds and survival. Reach L3 for 瑕光 and L4 for 远牙/焰尾; the 铃兰 operator requires L5,
whereas the 铃兰 band is a draft choice. Repeated real deployments raise the attack bonus and trigger the
receiver's bounded trait gains; moving pieces during prep is not a battle deployment loop.
At six distinct Kazimierz, `kazimierzShip` adds 120% ATK true damage around blocking members every 2s with
0.1s stun; non-blocking members instead add 30% ATK true damage on attacks. Six is an optional threshold,
not a prerequisite for the three-member deployment engine [ASSUMED] recommendation.

**Stages [ASSUMED]:** R1–3 gather cheap members and blockers; R4–7 complete 远牙's positioning and prioritize
坚守 for the community's 铳骑 stage; R8–10 develop 突袭/迅捷 and conditional economy; late aim for
**卡突袭迅** (Kazimierz + Raid + Swift). The maintainer also recommends 不屈. Defensive 坚守 is situational:
three members share damage and can delay 砾's deaths, trading cycle speed for survival. Raid needs a legal
ground target and no enemy in range when its ten-second idle or skill-ready trigger occurs. AoE/ranged
pressure, absent landing targets, trait caps and the leader hit limit constrain the engine.

**Substitutes:** 瑕光 can replace 砾 as the receiver; without 远牙, both retain their own smaller deployment gains,
but the named candidate is withheld. Cheap 野鬃/灰毫 preserve membership. 耀骑士临光 is a late Raid option.
Giving 瑕光 Swift requires actual morph-plus-Swift equipment and an active Swift bond; do not sacrifice the
survival board for it. 铃兰 + 焰尾 is a conditional copy/sale route, not guaranteed 1–2 funds each round.

### Every community/data disagreement

| Claim / shorthand | Current data takes priority |
|---|---|
| Freeze in the freezer's range gives layers; one stacker + freezer starts it | Three distinct active Kjerag are required. `garrison_28_a` on 初雪/银灰 rolls 50% for +1 when an enemy **enters** freeze in the **collector's** range. 凛御银灰 grants `garrison_29_a` to the front Kjerag: 60%, +1, cap 200/battle. The freezer and collector need not be the same unit. |
| 空弦 / 异鲨 / 阿斯卡纶 are interchangeable engine members | 空弦 has no innate cold; `garrison_150_a` gives own/front active bonds +3 at prep start. 不融冰 gives 12% cold for 1.5s, elite item 20%. 异鲨's `garrison_40_a` gives active 阿戈尔/不屈 +5 on defeat or doll swaps, not Kjerag; a separately verified grant is needed to collect it. 阿斯卡纶 is absent. |
| Three Kjerag give near-permanent freeze | `kjeragShip` at three gives damage ×1.25 normally or **instead** ×(1.35 + 0.01×layers) versus cold/frozen. Only six give the 25s wind, cold duration 20 + 0.1×layers seconds. Three require another cold source; no control uptime is guaranteed. |
| Deployment produces unlimited stacking | `kazimierzShip`: +20% ATK per friendly deployment, capped at +(50 + layers)%; this is not itself a persistent layer grant. 砾 gives active Kazimierz +1; 远牙's `garrison_108_a` grants active Kazimierz/Precision +4, cap 24/battle; 瑕光's `garrison_106_a` grants own active bonds +4, cap 12/battle. |
| Feed 瑕光 Swift and it joins her deployment layers | Her native bonds are Kazimierz/Raid. `bondsMeta.js` and `shared/plugins/rules.js` require 变形同构体 (`canGiveBond`) plus Swift-tagged equipment (`giveBondId`); 迅捷作战粮 alone grants SP, not a bond. Only active owned bonds receive her layers. |
| 坚守 is essential everywhere | Community advice for 铳骑, not an official restriction. Two give HP, three share 40% of non-Steadfast damage. The older `bonds.kazimierzShip.spec.howToPlay` recommends avoiding it to accelerate 砾 deaths; neither recommendation overrides the mechanical survival/cycling tradeoff. |
| 铃兰 + L4 Kazimierz cards pays 1–2 funds/round | `band_lisa` replays one on-field `SERVER_GAIN` at round start, rightmost then bottommost; T5 铃兰's `garrison_60_a` replays the front operator at prep start. T4 焰尾 grants a stock-dependent 野鬃/灰毫/远牙; 远牙 has no acquisition trigger. Surplus sales return current `sellPrice` and consume copies, not free guaranteed income. `band_mlynar` separately pays +1 **next round** per Kazimierz purchase, cap 3. |

### Candidate eligibility [ASSUMED]

`community-candidates.js` requires one reachable member per core role and enough distinct unbanned natural
main-bond members. Reachability means future normal shop tiers up to the mode limit, or an already held
higher-tier gift; it never assumes future gifts, available stock, free equipment or current affordability.
The earliest feasible core level is exposed as `minimumShopLevel` (L4 for both vanilla recipes). Main bans,
ordinary/DIY member bans and incompatible mechanical bands exclude the recipe. Sub-bonds independently
need enough reachable members and at most two become priority targets; other listed subs remain alternatives.
Stage keys exclude banned/absent members; R1–3 keys are T1–3. The existing level curve reports inaccessible
keys so a later-stage recommendation cannot imply a free low-level roll.

Scores use 22 recipe points, +16 mechanical-band match, +8 community-main match, +5 per held named member
(up to five), +14 previous-main continuity, −2 per shop level short, −24 per public teammate main competitor,
−2 per contested named member, −9 per uncovered announced capability. The §35.15 draft cap of eight and the
prep collapse still apply. Explicit supplier/safety-net roles retain their existing policy. `core-held` means
role members are owned and the main bond is active; it does **not** assert correct positioning, equipment,
skill selection or successful combat. Sources, differences, substitutes and pivot conditions accompany the
candidate. No gameplay rules, legacy decisions or automatic redeployment/equipment actions change.

## Advisor economy (§35.13)

The maintainer's live 娜仁图亚 / co-op 绝境 diagnosis (2026-10-19) found every plan asking for zero refreshes
and L1 in R0–2, L2 in R3–6, L3 in R7–8. The executor treated those as hard caps. The maintainer's advice is
first-hand strategy guidance, **not official text**: spend expiring funds, search for needed operators, freeze
an unaffordable target, store sale value in cheap spare operators, and develop the shop on time. A deliberate
罗素 elite farm or established 电表倒转 cycle may hold a level with a stated reason.

Mechanical sources are the local official `activity_table.json`:

- `autoChessData.constData.noMoneyTipsBand` names 坎诺特 as the carry exception; his `aceffect_band_34`
  `coin_carry_over` parameters give interest. Inherited plugin bands follow `GameData.leftoverKeptBands`.
- `activity.AUTOCHESS_SEASON.act2autochess.constData.shopRefreshPrice` is 1; free-refresh effects override it.
  `shopLevelDataDict[mode]` gives upgrade prices/slot counts (绝境: 5/8/11/12/13); `shopCharChessInfoData`
  gives purchase and sale prices (normally sale +1, also for elites). There is no EXP system. Upgrade cost
  falls by 1 each round, resets after each upgrade, and opens empty slots (official footage BV1AXwuzdEys 1:39 / #332).
- Public catalogue tiers/copy counts and the existing sourced `pool.js` reconstruction determine odds:
  remaining eligible copies, tier ≤ level, no fixed tier-percentage table. An inaccessible tier has zero
  normal-shop probability. The playbook's shares are public estimates after bans, before purchases.
- Freeze is free, preserves unsold offers at the next round roll and is then consumed. Manual refresh
  replaces those offers and cancels freeze (maintainer's official play observation, §32.14.7 / #584).
  A full regular hand blocks purchases even if they would merge (PRTS 帮助, §6.2 / #82). Existing displayed
  offer overdraw remains legal (§29.8); speculative bank buys additionally require available stock.

**[ASSUMED] recommendations:** ordinary builds aim for access to T2/3/4/5/6 around R3/5/7/10/13. The
`recommendedSchedule` simulates current-mode income, upgrade prices and discounts, without sales, gifts or
carry; at these access deadlines it can spend the cheapest-piece reserve on the upgrade. In 绝境 its
R4/7/10/13 levels are 2/4/5/6. This differs from the conservative `schedule` used for threshold-sighting
estimates, which always reserves a purchase. Candidates limit suggested access to their main/sub roster and proposed counter tiers, and report required
stage-key tiers, inaccessible keys and their eligible public copy share, so the model can explain whether its plan needs faster access or a
reasoned hold. A cycle candidate's derived `shopHold` limits its recommendation; it must still explicitly
request `economy.holdLevel:true` and `economy.why` to stop execution upgrades. The model must explain falling
behind the recommended or measured legacy curve; the executor does not invent a cap from a small `level`.

The spending policy is also **[ASSUMED]**: buy/keep targets and prioritized-bond members count as wanted
(except explicit sell targets; bond-member acquisition stops after owning its elite). Existing lineup gain
>2, completing merges and filling the deploy cap count as useful. Buy those first; freeze unaffordable
wanted offers before another roll; refresh only with remaining eligible stock, bench room and funds for
an effective-price purchase; then bank cheapest distinct spare singles with positive sale value. Leave one
bench slot. Mark banks by UID; do not liquidate deployed, equipped, newly wanted or merge-completing copies,
and only sell when their base refunds can fund the purchase. Each extra pass is bounded to 64 actions to
contain free/effect cycles. Unspendable residuals can remain. Carry bands retain interest logic. Empty/absent
plans retain legacy decisions and RNG; no official gameplay rule changes.

Offline measurement, 2026-10-19, vanilla 1ca3921c baseline, seeds 1–3, rehearsal 0, one worker:

```sh
node tools/botbench.mjs --configs solo:HARD,coop4:HARD --seeds 3 --seed 1 --rehearsal 0 --jobs 1 --bot legacy --json "$BENCH_DIR/legacy.json"
SP_EXTERNAL_AI_MODE=plan SP_EXTERNAL_AI_TRANSPORT=stdio SP_EXTERNAL_AI_COMMAND='["node","tools/ai/stdio.mjs"]' \
  node tools/botbench.mjs --configs solo:HARD,coop4:HARD --seeds 3 --seed 1 --rehearsal 0 --jobs 1 --bot external --json "$BENCH_DIR/advisor.json"
node tools/botbench.mjs --compare "$BENCH_DIR/legacy.json" "$BENCH_DIR/advisor.json"
```

Set `BENCH_DIR` to a permitted scratch directory. Both runs use the real sim; the example makes no API calls.
The example picks first available draft choices, so bands differ from legacy and this is an integration
comparison, not an isolated strength test of the economy policy or a reproduction of the watched model.
`economy[]` in the benchmark JSON records every ended seat-prep, including eliminated seats' final prep;
loss and refresh averages use these records. Level checkpoints use surviving seats, as before.

| Mode | Agent | Funds lost/prep | Refreshes/prep | L at R4 / R7 / R10 / R13 | Mean survival round | Match wins |
|---|---|---:|---:|---|---:|---:|
| solo:HARD | legacy | 0.7143 | 1.7857 | 2 / 3.6667 / 5 / 6 | 14 | 2/3 |
| solo:HARD | stdio advisor | 0.4762 | 1.6190 | 2 / 4 / 5 / 6 | 14 | 1/3 |
| coop4:HARD | legacy | 0.6667 | 1.7358 | 2 / 3.9167 / 5 / 6 | 13.25 | 1/3 |
| coop4:HARD | stdio advisor | 0.5092 | 1.5521 | 1.9167 / 3.9167 / 5 / 6 | 13.5833 | 1/3 |

Advisor loses no more funds than legacy in either configuration (42/163 advisor preps versus 42/159 legacy).
All runs have zero match errors and advisor fallbacks. This small sample establishes the spending regression
check, not superior win rate; rerun for changed content. The knowledge pack labels these measured legacy
values as a historical reference only for matching vanilla solo/co-op hard modes.

## Advisor input (§35.15)

Maintainer playtest 2026-10-20 (coop4 HARD, seed 11, seat 0), played from the same JSON the example model
receives. The system string was the strategy prompt plus the whole `sp-knowledge/1` pack (about 622000
characters; measured runs were about 150–160k input tokens). Operators and enemies were stored twice, once
on the pack and again inside `playbook`. The compact digest named chess and items by id only. Two catalogue
rows share the name 锡人 (`chess_char_1_16_a` T1 and `chess_char_2_19_a` T2; character table /
`charChessDataDict`).

The example system prompt now uses `slimKnowledge`: one operator row (id, name, tier, cost, class, bonds,
`caps` from `canHitFly` / `dmgType` / `position` / `stats.blockCnt` / `profession` / `subProfessionId`, first
trait clipped to 120 characters, skill name), bonds, bands with insights, items, compact bosses, and compact
enemies (`id, name, hp, def, res, motion, fly`). The playbook copy omits its operator and enemy tables and
keeps community, cycles, graph, pairings, schedules, `legacyReference` and band insights. The hello pack
served to third parties is unchanged apart from enemy `effect` text. `strategyCandidates` still reads the
full local playbook. [ASSUMED] When the system text would exceed 200000 characters, compact enemies are
omitted; the English funny catalogue is the current case. The observation's `upcoming` list still names
that round's enemies.

Digest additions are optional `sp-ai/1` fields: `name`, `class` and `caps` on board, bench, overflow and shop
chess; `name` on items. Bounty cards add `killChance` from the seat strategy's existing `bountyKillChance`
when that hook returns a finite number, plus catalogue enemy `hp, def, res, motion, fly` and a short effect.
The exposure model is the legacy planner's, not a new combat rule. Handbook ability rows are `{text, textRaw,
format}`; joining them used to write `[object Object]`. `effectText` keeps `text` or `desc`.

The prompt also states the plan fields of history §35.14: `items.buy` (at most eight catalogue or current-shop
item ids), `economy.freezeSearch`, a one-round `holdLevel` with `economy.why`, exact `keep`/`sell` ids (a `*_b`
id is the elite), and `buy` only to finish a merge or add a distinct member; `repairPlan` keeps them after
checking the ids. Activated layers on every bond count; do not bench a stronger unit only to chase a
6-threshold. Each prep, compare `digest.upcoming` fly and elite counts with `caps.air`.
