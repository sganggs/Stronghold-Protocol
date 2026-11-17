# 11 · Official limits: the 999 bond-layer cap and the 300000 boss-hit limit ("限伤")

Written 2026-10-01 as research (no code changed then). It follows the boss-HP review (DESIGN §20.10), where
community first-hand reports pointed at two official mechanics the remake lacked: bond layers that stop at 999, and a
"限伤" that makes very large hits deal nothing. **Implemented** the same day after the user asked for the co-op leaders to
be as hard to kill as officially — §6 below and DESIGN §20.12; §2.3 (who counts as a leader) was read from the client
while implementing.

**Tags** (as in research 09)
- **[DATA]**: read from the official client. Here that is the local Windows client 2.7.71 (Unity 2021.3.39f1, files dated
  2026-08-20): `global-metadata.dat` (il2cpp v29: class, field and method names, constant values) and `GameAssembly.dll`
  (x86-64 machine code, disassembled with `llvm-objdump`; method addresses mapped to names through the
  `Assembly-CSharp.dll` code-gen module's method-pointer table and the metadata method tokens).
- **[COMM]**: community posts (Bahamut, NGA, bilibili).
- **[ASSUMED]**: our inference or proposal.

---

## 0. TL;DR

| # | Question | Official answer | Tag |
|---|---|---|---|
| 1 | Do bond layers cap? | **Yes, at 999.** `Torappu.Battle.AutoChessBattleConst.MAX_GARRISON_STACK = 999`. The client's bond-layer counter (`AutoChessPlayerDataModel/ScenePlayerData.AddBondCount`) adds the gain and then clamps: `count = min(count + n, 999)`. | DATA + COMM |
| 2 | Is there a damage limit? | **Yes, on boss leaders in boss battles: a single hit of 300000 or more is cancelled (0 damage).** It is not a clamp and not an integer overflow. `AutoChessBattleConst.MAX_BATTLE_DAMAGE = 300000`; `AutoChessStepModeManager._OnBossEnemyTakeDamage` computes `d = ceil(hit)` and calls `modifier.Cancel()` when `d ≥ 300000`. | DATA + COMM |
| 2a | Where does it apply? | Only in **boss battles outside training** (the Final Assault and the Hidden Core: `AutoChessGameStatus.inBossBattleState && !isTrainingMode` starts "step mode"), and only to enemies that `AutoChessBattleUtil.IsBossEnemy(enemyId)` accepts (the leaders). Normal rounds, 联防, minions in boss battles and training are not affected. | DATA |
| 2b | What does a player see? | The hit does nothing: no HP loss, nothing counted toward the shared pool. Bigger multipliers therefore *lower* the damage of hits pushed past the line, which is why the community advice is to *not* light extra damage bonds on a 999-layer board. | DATA + COMM |

---

## 1. The 999 layer cap

### 1.1 Constant

`Torappu.Battle.AutoChessBattleConst` (metadata field default values; ints are compressed in v29):

| Field | Value |
|---|---|
| `MAX_GARRISON_STACK` | **999** |
| `MAX_BATTLE_DAMAGE` | **300000** |
| `MAX_BATTLE_DEPLOY_CNT` | 12 |
| `MAX_WEAR_EQUIP_CNT` | 2 |
| `SPEED_LEVEL_IN_BATTLE` | 2 |
| `BATTLE_WAIT_UI_TIME` / `HELP_BATTLE_WAIT_UI_TIME` | 1.5 / 2.5 (float) |

(`Torappu.UI.AutoChess.AutoChessCountDownView.COUNT_DOWN_MAX_NUM = 999` is an unrelated UI countdown.)

### 1.2 Where it is used

C# constants are inlined, so the use sites were found by scanning the il2cpp code section for the immediate. In every
`AutoChess` method, 999 appears as a clamp only in
`Torappu.Battle.AutoChess.AutoChessPlayerDataModel/ScenePlayerData::AddBondCount(bondId, n)`:

```
TryGetValue(bondId, out bond); if (!bond.valid) return false;   // [rcx+0x20]
bond.stack += n;                                                 // add  edx, edi ; [rcx+0x18]
bond.stack = bond.stack < 999 ? bond.stack : 999;                // mov eax,0x3e7 ; cmp ; cmovl
return true;
```

Its only caller is `AutoChessGarrisonManager._TriggerGarrisonStatusRefresh`, the in-battle 特质 / bond layer gain on the
viewed player's data (`AutoChessDataCenter.viewPlayerData`). The prep-side gains are computed by the scene server, whose
code is not in the client; the client clamp, the constant's home (`AutoChessBattleConst`) and the community reports
(§3) say the cap is the same there. [ASSUMED: the server clamps every gain the same way, `min(L + n, 999)`.]

### 1.3 Reading

- A hard gameplay cap, not a display cap: the clamped value is the one stored (and the layer readers — `GetBondStackCount`,
  `AutoChessAssignBondStackCntToBB` — read the stored value).
- Per bond: each bond's layer counter stops at 999 on its own.
- The per-battle gain limits of individual 特质 (e.g. 锏 ≤ 24, 凛御银灰 ≤ 200; blackboard `max_add…`,
  `AutoChessGarrisonManager.BOND_ADD_MAX_PER_BATTLE`) are separate and unchanged.

## 2. The 300000 boss-hit limit

### 2.1 The code

`Torappu.Battle.AutoChess.AutoChessGameManager.StartBattle`:

```
if (gameStatus.inBossBattleState && !isTrainingMode) {   // [this+0x18] = get_isTrainingMode
    inStepMode = true;
    BattleController.ReqChangeDeltaTimeFPInStepMode();
    stepModeManager.Start();
}
```

`AutoChessStepModeManager.OnEnemyRegistered(enemy)`: `if (AutoChessBattleUtil.IsBossEnemy(enemy.id)) bosses[enemy.instId] = enemy`.

`AutoChessGameManager.OnEntityApplyModifier(entity, modifier)`: `if (inStepMode) stepModeManager.OnEntityApplyModifier(...)`,
which forwards to `_OnBossEnemyTakeDamage` when the entity is a registered boss.

`AutoChessStepModeManager._OnBossEnemyTakeDamage(enemy, modifier)`:

```
int d = (int)Math.Ceiling(modifier.value.AsFloat());   // roundsd …, 0xA (toward +∞)
if (enemy == null || modifier.isCancelled || !modifier.isDamage) return;
if (d <= 0) return;
if (d >= 300000) { modifier.Cancel(); return; }        // cmp ebp, 0x493e0 ; jge → Modifier::Cancel(0)
bossDamage[localPlayer] += d;                           // TryGetValue / set
actions.Add(new StepAction { type = 3, d, killedInfo… }); // the step relayed to the server / partner
```

There is no other use of 300000 (or 299999, or the float 300000.0) in the autochess code; the other three hits of the
immediate in the binary are `HttpWebRequest` / `FtpWebRequest` timeouts.

### 2.2 Reading

- **Cancel, not clamp.** `Modifier.Cancel` is the engine's ordinary damage cancel (the same call as for invulnerability):
  unless the modifier carries an ignore-cancel mask for reason 0, the hit is dropped. So a hit worth 299999 lands, a hit
  worth 300000 deals **0**.
- **The value checked is the hit about to be applied** (`modifier.value` at apply time: after DEF / RES and every
  multiplier). [ASSUMED: before HP shields, after hit-negating blocks.] Only two leader defences in our data are
  affected by this order:
  - 阿利斯泰尔 (boss_6) gets an HP shield, the 5000-HP barrier of 莫非王土's shield equipment (`boss:vest`, skill
    `store` / `storeA` `dynamic` 5000 in data/enemies.json). The order decides only its hits within 5000 of the line:
    with the limit first, a hit of 300000–304999 is cancelled and the barrier stays; with shields first, 5000 would be
    absorbed and 295000–299999 would land. The vest's ×0.2 on hits from its side is a multiplier, so it counts before
    the check.
  - 假想敌：管 (boss_10, hidden template h08_03) can stand in 假想敌：再生's aura (`Aura.max_damage_block_cnt` 5), which
    negates a whole phys / arts hit in the `hit` step, before the limit. So a hit past the line spends one block
    instead of being cancelled by the limit; either way it deals 0.
- **Who:** the leaders only (`IsBossEnemy`, §2.3). Minions in the boss battle, every enemy in normal rounds and 联防, and
  everything in training are uncapped.
- **Why it exists [ASSUMED]:** in step mode every boss hit is relayed as an action so both players of a pair and the
  server keep one shared pool; the limit looks like a sanity guard on those reports. It still decides real fights:
  the co-op leader pools (`bloodPoint`, data/bosses.json) run from 200000 (FUNNY) to 7600000 (ABYSS), so in the easy
  modes one hit over the line would be a whole pool.
- **Not an overflow.** Nothing wraps at 2³¹; the line is a deliberate constant.

### 2.3 Who is a leader: `AutoChessBattleUtil.IsBossEnemy(enemyId)` [DATA]

Read while implementing (metadata token 0x6013192, method pointer 0x180b058e0 in the same build; `Il2CppCodeGenModule`
method-pointer table of research 08 Appendix B):

```
foreach (var kv in <activity data>.autoChessData.bossInfoDict)   // Dictionary<string, AutoChessBossInfoData>
    if (string.Equals(kv.Value.enemyId, enemyId)) return true;   // [value+0x18]; the class's fields: bossId 0x10,
return false;                                                    //   enemyId 0x18, handbookEnemyId 0x20
```

So a leader is an enemy whose id is a `bossInfoDict[*].enemyId` — the 10 keys of data/bosses.json `enemyKey`
(enemy_9013_acstmk, enemy_9017_achunt, enemy_9021_acduml, enemy_1521_dslily, enemy_2016_csphtm, enemy_9032_aclionk,
enemy_9033_acdeer and the hidden enemy_9013_acstmk_2 / enemy_9017_achunt_2 / enemy_9021_acduml_2). It matches by id, so
every instance counts — the second copy a pair field spawns (boss_battle_multi_player) included. The hidden leaders'
parts (“斩胄之剑” / “破胄之锤” enemy_9014/9015, “碎铳之簧” enemy_9018–9020, 假想敌：弦 enemy_9022 and “裂管之音” /
“断弦之音” enemy_9023), 假想敌：胄's 刺胄之弹 (enemy_9016_acstmr) and drones (enemy_1005_yokai), escorts and bounty enemies
are not in the list: hits on them are never cancelled — the share a part passes on to its leader ("被击落时受到伤害以一定
比例传递") is a hit on the leader and is checked [ASSUMED: the transfer is an ordinary damage modifier on the leader].
In the remake's wave data the tag-'boss' spawns of the boss / hidden templates are exactly those keys and nothing else
(test/sim/playtest6_limits.test.js checks it).

## 3. Community reports

Paraphrased; only key terms are quoted.

### 3.1 Layers stop at 999 [COMM]

- **Bahamut** [C.php?bsn=33651&snA=12522](https://forum.gamer.com.tw/C.php?bsn=33651&snA=12522) (2026-06-28): the text says
  999 layers are usually reached within 2 rounds, and that 精准 and 萨尔贡 were stacked full at 999. Its screenshots:
  R12 谢拉格 696 → R13 谢拉格 **999**, 灵巧 301, 炎 122 → R14 谢拉格 still **999** while the author kept feeding it,
  灵巧 671, 炎 537 → R15 炎 / 谢拉格 / 灵巧 all **999**, 迅捷 222. Each bond stops on its own.
- **bilibili** [BV16bU7BTEX1](https://www.bilibili.com/video/BV16bU7BTEX1) (2025-11-22): 萨尔贡 filled from 0 in one round, the
  surplus wasted; a commenter lists the 「层数上限」 among what holds 瑰盐 back.
- **TapTap** [moment 747932824320870144](https://www.taptap.cn/moment/747932824320870144) (2025-12-10): 谢拉格 from 100 to 999
  in one round.
- More videos treating 999 as full: bilibili BV1xVdBBWEuu, BV1vUyJB4Ero ("all bonds 999"), BV1eoCSBzEde (拉特兰 999 by
  R11); YouTube thG4eVPnSnM. No source shows a bond above 999.
- Not stated anywhere official: the excel tables (`activity_table` act2autochess / `autoChessData`: no cap field,
  `maxInactiveBondCount = -1`), PRTS (卫戍协议：盟约, 下半, 帮助, PRTS盟约记录), BWIKI and the in-game help.

### 3.2 "限伤" [COMM]

- **Bahamut** [C.php?bsn=33651&snA=12316](https://forum.gamer.com.tw/C.php?bsn=33651&snA=12316) (【心得】衛戍協議:盟約上下差異整理,
  2026-05-04): some big bond combinations make the output too high, and the 「限傷」 then keeps it from coming out; with
  999 谢拉格 do not light 奥术, or 大初雪 (圣聆初雪, tier 6, S3) is limited away; 瑪 (玛恩纳) should not switch to 谢拉格
  for the same reason; the same warning for 阿戈尔. No number given.
- **bilibili** 【卫戍攻略#1】维多利亚&谢拉格篇 [BV19UXZBJExQ](https://www.bilibili.com/video/BV19UXZBJExQ) (comments, 2026-04):
  a high-layer 圣雪 easily hits the limit and her damage goes to zero; at 999 谢 do not light 奥术, maybe drop 灵知; a
  teammate's 奥术 in the boss fight zeroes her too. Asked what 限伤 means, a reply gives the number:
  「一次超过30w会被卡掉」 (a single hit over 300k is cut) — the client's `MAX_BATTLE_DAMAGE`.
- **bilibili** 每把都能999层 谢拉格 [BV1xVdBBWEuu](https://www.bilibili.com/video/BV1xVdBBWEuu): bullet comments call an on-screen
  hit of 272451 "nearly at the limit" and warn that the damage "overflows to zero"; in the comments 160k hits are said
  to be safe, and a player's 0 damage *on the boss* is discussed.
- **bilibili** 【卫戍攻略#4】什么叫叠到999层反而亏输出 [BV1nrdqBLERz](https://www.bilibili.com/video/BV1nrdqBLERz): comments mention
  "炎999限伤" and ask whether 仇白 S3 reaches it.
- JP wikiru (堅守協定：盟約 2nd) says the damage limit wastes layers beyond a point.
- Not the main game's overflow: PRTS 定点数与浮点数 / 数值范围 — battle values are a 64-bit fixed point (the client's
  `Torappu.FP`), max ≈ 2³¹; a main-game hit past 2.1 billion shows 0 (bilibili BV1bhgz6DEKS, Integrated Strategies).
  That is ~7000× the 卫戍 line; PRTS 作战机制 records ordinary hits in the millions, so the 300000 rule is mode-specific.

Why the hits get that big (data blackboards): 谢拉格 ×(1.35 + 0.01·L) vs cold / frozen = ×11.34 at 999; 奥术 arts taken
×(1.2 + 0.01·L) = ×11.19 at 999, a debuff on the target (so the partner's 奥术 boosts your hits); 灵知 +27–29 % taken on
cold targets, doubled on frozen; 圣聆初雪's 特质 +1 % ATK (elite +2 %) per 3 layers of her bonds; 炎 ATK
+(0.23 + 0.009·L).
- NGA [tid=46592301](https://bbs.nga.cn/read.php?tid=46592301) "卫戍协议BUG汇总&神秘机制": every endpoint answers 403
  「访客不能直接访问」 (login required); not read.

These reports fit §2 exactly: the advice is to *avoid* extra multipliers, which only makes sense if a hit past the
line is lost rather than clamped.

## 4. What the remake did before the implementation, and what it does now

| | Remake before (master 7094892) | Remake now (§6) | Official |
|---|---|---|---|
| Layers | uncapped: `PlayerState.addLayers` (prep), `Match.js` settle (`ps.layers[b] += layerGains`), `Battle.addLayers` (live in-battle copy) | per bond `min(L + n, 999)` at every writer (`layerGainRoom`) | per bond `min(L + n, 999)` |
| Boss hits | no limit (`sim/attack/hit.js resolveDamage` → `attack/health.js applyHpDecrease` → `bossPool.damage`) | leader hit in a 'boss' / 'hidden' battle with `ceil(d) ≥ 300000` → cancelled, 0 (`leaderHitCancelled`) | leader hit with `ceil(d) ≥ 300000` → 0 |

## 5. Proposal (as written before the implementation; §6 is what was built)

- `shared/constants.js`: `BOND_LAYER_CAP = 999` and `BOSS_HIT_LIMIT = 300000` (each `0`/`Infinity` = off), the switches.
- Layers: clamp in `PlayerState.addLayers`, the settle in `Match.js`, and `Battle.addLayers` (the live copy, as the
  client's `AddBondCount`); `onLayers` reports the clamped `to`; a gain at the cap adds 0.
- Boss hits: in `dealDamage`, after the multipliers and before shields, `if (target.isBoss && (battle.kind === 'boss' ||
  battle.kind === 'hidden') && Math.ceil(final) >= BOSS_HIT_LIMIT) final = 0` (with a `capped` event so the client can show it) [ASSUMED: shown as
  no number, like the official].
- Tests, docs (META / SIM / BALANCE / PLAYING) and a DESIGN draft.

## 6. Implementation (2026-10-01, DESIGN §20.12)

- `shared/constants.js`: `BOND_LAYER_CAP = 999` and `BOSS_HIT_LIMIT = 300000` (0 / Infinity = off), plus
  `layerGainRoom(before, n)` = min(n, cap − before), never negative.
- Layers: every writer clamps with it — `PlayerState.addLayers` (every prep-side gain: 特质, items, bands, 机变 cards,
  bonds), the settle of the in-battle gains (`Match.settle`, `server/match/match/settle.js`), `Battle.addLayers` (the live in-battle copy, after the
  `layerGain` hook, as the client's `AddBondCount`); a gain at the cap adds 0 (no onLayers, no 'layer' event, no hook),
  so the per-N milestones (远见, 奇迹, 维多利亚 …) stop with the count; the client-result check (`fields.js`) bounds a
  reported gain by the room left from the bond's starting layers; `invariants.js` flags a bond above the cap. The dev
  tools write through the same helper: `tools/matchrun.mjs --layers N` (a raw boost, no milestones) and
  `tools/balance.mjs applyBoard` (any `--profile`) stop at 999 too.
- 限伤: `sim/attack/health.js leaderHitCancelled` in `attack/hit.js resolveDamage` (after DEF / RES and every multiplier,
  before the ordered injury effects — shields, barriers, dodges) and in `Battle.dealHPLose` (losses passed on to a leader): a leader (`isBoss`, the tag-'boss' units = §2.3) in a 'boss' / 'hidden'
  battle with `ceil(amount) ≥ 300000` → the hit returns 0 before shields (阿利斯泰尔's 5000 `boss:vest` barrier stays
  untouched; 再生's hit blocks act earlier, in the `hit` step, §2.2), HP / pool loss, stats, the damage number, the
  `damaged` / `fatal` hooks and the kill; what ran before it (the attack, its SP, the `hit` hook, separate element 损伤
  hits) stays. Element bursts (元素伤害) and DoT ticks are checked like any hit; element 损伤 (gauge fill) removes no HP
  and is not. The sim emits `['fx', 'hitCap', x, y, { id, n }]`; the client draws nothing for it (no number, like the
  official [ASSUMED]).
- Fixed-ratio losses on a leader scale with the pool, so the pool size decides whether they meet the line. The one that
  can: 【死亡集群】 (boss_1 / boss_8 skill 2, bb `hp_ratio 0.02`): a drone killed by an operator costs the leader
  0.02 × its max HP, and a leader's max HP is the shared pool's max (`Battle` syncs it). Today's largest such pool,
  boss_8 ABYSS 7.2M, gives 144000, which lands. A pool above 14999950 (≈ 2.08 × that; ceil(0.02 × max) = 300000)
  would turn every drone kill into a cancelled hit [ASSUMED: the official routes this loss through the same
  `_OnBossEnemyTakeDamage` check]. Any change to the pool size (an alive-scaled pool, a new difficulty) should keep this
  in view; a real-kit test pins the line (`test/sim/playtest6_limits.test.js`, 【死亡集群】).
