# DESIGN §5, §7 — The battle engine (server/sim) and content modules

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

## 5. Simulation (server/sim) — engine contract

联防 restoration (§30.13): the initial setup establishes buffs and devour attributes before restoring living
operators' exact HP ratio and total SP; summons restore SP only. Opening Egir devour does not damage a carried
survivor a second time. Forced-down carry stays out without spending an Egir revival; subsequent real knock-outs
and redeploys are unchanged. No 1% / 1-HP floor is added to a positive carried ratio.

Expanded automatic skill areas (§30.11) include 司霆惊蛰 S2's current low-terrain flood when it strictly contains the
initial area, 斩业星熊 S3's selectable air targets, and 予愿安洁莉娜 S3's initial 3-9 ∪ x-4.
Permanent range extension, control/operation cooldown and targetability still apply; normal attacks are unchanged.

Prepared 外勤医疗 map characters (§30.22) keep an earlier aggro order than ordinary initial operators. Preparation
can open their detail card and board-space range. Their `deploySeq` is still the later runtime spawn. The retained
team grant (§30.14) is unchanged.

Historical core (0.3.2 M2, history §35.22.7): `config.version.rules` is authoritative for deployment order and boss
mirror branches. First-season deployments order rows bottom to top, then columns left to right (mirrored halves use
local column order). Explicit BattleSpec version identity must match its DataSource. Historical AUTO_STOP closes
manually after half duration when the running range contains an enemy. Paid deployments compose `costMul` (default 1).
Historical content uses its own blackboards/text; gaps and assumptions are enumerated in the version audit review.

### 5.1 Battle API (implemented by the sim-core owner; consumed by match & content)

```js
import { Battle } from './sim/Battle.js'
const b = new Battle({
  seed,                       // uint32
  kind,                       // 'normal' | 'unite' | 'boss' | 'hidden'
  modeId, round,
  stage,                      // data/stages.json entry (full 19×21 grid)
  rect: { r0, r1, c0, c1 },   // inclusive field bounds
  timeLimit,                  // game seconds; boss/hidden: Infinity (overtime handled by match)
  players: [ PlayerBattleInput ],   // 1 (normal), 1–2 (unite, boss)
  spawns: [ SpawnSpec ],            // enemy schedule for this field
  routes: [ RouteSpec ],            // from the wave template, resolved to this field
  sharedBoss: SharedBossPool | null,// { hp, maxHp, damage(playerId, amount) } for boss rounds
  flags: { layerGainsEnabled: bool, dpInit: 10, dpPerSec: 1, dpMax: 99 },
})
b.step()                 // advance exactly one TICK
b.finished               // true when: all enemies dead & no spawns pending, or time limit reached, or all players' LP pools say stop (boss: match decides via b.forceEnd())
b.forceEnd(reason)
b.time                   // game seconds elapsed
b.result()               // BattleResult (below), valid once finished
b.snapshot()             // compact full snapshot (§8.4) of this field
b.drainEvents()          // array of client-facing events since last drain (§8.4)
b.on(event, fn, { priority=0, owner } ) / b.off(...)   // hook bus (§5.4)
```

`PlayerBattleInput`:
```js
{ playerId, seat, side: 'L'|'R',
  colOffset,                 // 0 for own field; +8 for the right half in unite/boss
  units: [ { uid, kind: 'chess'|'token', chessId /* golden id if elite */, tokenId?, row, col,
             items: [itemId...],                  // equipped items (golden ids when merged)
             carryState?: { hpPct, sp } | { sp } | { down: true } } ],   // unite: an operator keeps its end-of-combat HP ratio + SP, a summon its SP (no running skill);
                                                  // { down: true } = knocked out at its end: deployed, then forced out (§19.3)
  bonds: { [bondId]: { count, active, tier, layers } },   // snapshot from bondsMeta at combat start (联防: with the layers the
                                                          // helper's own combat reached, PlayerState.bondsView — §20.15)
  bandId, playerEffects: [ EffectRef ],                   // active band/choice/team effects with battle parts
  lpForBoss?: number }
```

`SpawnSpec`: `{ time, enemyKey, routeIndex, count=1, interval=0, mods: { hpMul, atkMul, defMul, speedMul }, sourcePlayerId?, bounty?: { coins, ownerPlayerId } , tag?: 'escort'|'boss'|'bounty' }`

`BattleResult`:
```js
{ time, reason: 'cleared'|'timeout'|'forced',
  perPlayer: { [playerId]: {
     killed, total,                       // enemies attributed to this player's field/half
     leaked: [ { enemyKey, mods, lpr, sourcePlayerId } ],   // for unite aggregation & LP
     perfect: bool,                       // no leaks
     layerGains: { [bondId]: n },         // IN_BATTLE gains (0 if flags.layerGainsEnabled false); what was added — capped at
                                          // the bond's room under BOND_LAYER_CAP 999 (§6.3, §20.12)
     coins: n,                            // bounty coins earned
     damageDealt: n, bossDamage: n, healingDone: n, deaths: n,
     unitsEnd: [ { uid, hpPct, sp, alive } ] } },   // operators + board summon pieces; sp = 技力 incl. stored charges
  bossHpLeft? }
```

### 5.2 Units & stats

`Unit` fields (minimum): `id` (int, unique per battle), `side` ('ally'|'enemy'), `kind` ('op'|'token'|'enemy'|'device'), `defId`, `ownerId` (playerId; enemies: the field owner / source), `x, y`, `tileR, tileC` (ops), `dir` (allies: UP|RIGHT|DOWN|LEFT deploy direction, §3; `sim/dir.js`), `facing` (derived horizontal sign +1 / −1: LEFT ⇒ −1), `hp`, `alive`, `sp`, `buffs[]`, `statusFlags`, `blocking[]` (ops), `blockedBy` (enemies), `liveRangeGrid` (allies: the 攻击范围 the detail card shows — the running skill's grid, else the unit's own, plus `rangeExtend`; never a kit's target-selection grid, §21.16), `form` (the model form it is in — an enemy's mode, §21.4, a 傀儡师's 替身 `'doll'`, §22.11 — UnitInfo `form`), `skin` (the owning player's skinId, display only: copied from the battle input onto the unit and published on UnitInfo; no rule reads it, and a battle's result does not include it — docs/SKINS.md, §34.23).

Base stats (from data): `maxHp, atk, def, res` (0–100), `aspd` (100 base), `bat` (base attack time, s), `blockCnt`, `rangeGrid` (ops) / `rangeRadius` (enemies, 0 = melee), `moveSpeed`, `massLevel`, `weight`, `lpr` (enemies), `dmgType` ('phys'|'arts'|'heal'|'true'), `motion` ('WALK'|'FLY'), `cost`, `respawnTime`, `spRecovery`.

**Aggregation** (`units.js`, recomputed lazily when buffs change):
- `ATK = ((base + Σflat) × (1 + Σpct) + ΣatkFinal) × Πmul` — `atkFinal` is the 最终加算 (阿戈尔's devoured base ATK, §24.7); the same shape without it for `maxHp`, `def`; the 卫戍 systems' "+X%" ATK / DEF / max HP (盟约, 策略, 装备, 机变 cards, per-layer 特质) are 直接乘算 and go into `Σpct` with the skills' "+X%" (`sim/constants.js DIRECT_BONUS_STACKING 'add'`, content/support `directMods`; PRTS 盟约记录 / 游戏数据基础, §20.10) — "提升至X%" effects (炎佑 ×1.5) and the char_attribute_mul 特质 stay in `Πmul`; `res = clamp((base + Σflat) × Πmul, 0, 100)`; `aspd = clamp(100 + Σaspd + base-100, 20, 600)` (`constants.js ASPD_MIN` 20: PRTS 数值范围 "ATTACK_SPEED 默认下限 20", §20.3).
- `interval = bat × (1 + ΣbatPct) × 100 / aspd` (blackboard `base_attack_time` is treated as `batPct`, e.g. −0.3 → 70%).
- Changing `maxHp` keeps the HP **ratio**.
- Stats are rounded only for display; the sim keeps floats.

**Elite (精锐) chess** have their own stats in data (golden chess id). The module bonus is already folded into data stats by build-data.

### 5.3 Buffs & statuses

`Buff = { key, source, duration /*s, Infinity*/, stacks=1, maxStacks=1, refresh: 'replace'|'extend'|'stack', mods, flags, onTick?, onExpire?, tags[] }`

- `removeBuff(unit, key|buff)` snapshots matching instances in reverse order, re-finds each by object identity in
  the current list, and removes/calls `onRemove` only while it is present. Its return value counts only this call's
  actual removals; nested removals are counted by their own calls. Each removal retains dirty stats, flags and
  last-instance status events; it does not invoke `onExpire`. New instances added by callbacks wait for a later call.
  [ASSUMED] Re-entrant extension API policy, not an official gameplay rule (§35.5; SIM §3).
- `mods` keys (all optional, additive within a key): `atkFlat, atkPct, atkFinal (最终加算: after the percentages), atkMul, defFlat, defPct, defMul, hpFlat, hpPct, hpMul, resFlat, resMul, aspd, batPct, blockCnt, rangeExtend (tiles), moveMul, dmgDealtMul (multiplicative, e.g. 1.2), dmgTakenMul, physTakenMul, artsTakenMul, trueTakenMul, defIgnoreFlat, defIgnorePct, resIgnoreFlat, resIgnorePct, dodgePhys, dodgeArts, healingDealtMul, healingTakenMul, spRecoveryFlat, spRecoveryMul, maxTargets (+n), shield (absorbs damage; consumed)`.
- `flags`: `stun, freeze, sleep, silence (no skills), disarm (no attacks), stealth (untargetable by enemies/ops unless blocked or revealed — an operator's radius area damage skips it too, `Battle.foesInRadius`, PRTS 作战机制 §AOE伤害判定, §21.19, and so do an enemy's area effects and buff auras unless the 隐匿 ally blocks that enemy, `targeting.js areaSelectable` / `auraSelectable`, §22.12; an enemy's 隐匿 returns only 3 s after a block ends, or after its PRTS page's "（解除阻挡N秒后恢复）" — `stealthOff` buffs, `targeting.js enemyStealthed`, §22.8; an enemy's b.snap stealth bit is set only while its 隐匿 is on, §21.4), camou (an ally's 迷彩: like stealth for enemy targeting and on screen, but not 隐匿 for 隐匿 conditions — 叙拉古, 家族徽章; §20.2 — and an enemy's splash and other area effects still hit it, ba.camou "无法躲避溅射类攻击", §22.12), liftoff (an ally's 起飞, 蒂比's skills: it blocks flyers only and has 对地规避 — no ground enemy selects it, so no selected damage or status of one lands, while what selects nobody still does: `ignoreSelect` / 无来源 — 无视无法选择 abilities, direct picks, flying units' blasts, a debuff's ticks; it stays a ground unit on its tile; `targeting.js evadesGround`, §21.22), invulnerable, unblockable, levitate, fear (enemy: cannot attack, unblockable, runs to random tiles of the ±45° fan away from the source; no source or itself as source = inside its own tile — `fear.js`, §20.4), taunt (+aggro), cold, noHeal (no heals from others: 禁疗 summons and 孤立 units; an HP-regen attribute still applies — PRTS 安洁莉娜 备注), healFree (禁疗 that stops the unit's own heals too, shown as the status 'healFree': 史尔特尔's 余烬 sets it with noHeal — only an HP-regen attribute and her S3's "无视禁疗" start heal pass, §22.7), isolated (孤立: no friendly selector picks it — no heal, buff, aura or talent of an ally, `Battle.allySelectable`; §20.3)`.
- **Status catalogue** (`buffs.js`, keys used by content): `stun`, `freeze` (stun + res −15), `cold` (aspd −30; a second cold while cold ⇒ freeze for the longer of the two unless immune — on an enemy the pair becomes the freeze, no cold left; SIM.md), `sleep` (stun; ends on damage? no: in AK sleep = untargetable & unable to act; keep AK: untargetable & inactive), `slow` (moveMul), `bind` (moveMul 0), `fragile` (dmgTakenMul), `artsFragile` (artsTakenMul), `silence`, `fear` (the 恐惧 walk, `fear.js`), `burnGauge`/`necrosis`/`neural` element gauges (see damage), `stealth`, `camou` (迷彩, its own keys: 忍冬 S3 `vulpis:camou` until her next cast, 寒芒克洛丝 S1), `reveal`.
- Immunities from enemy data (`stunImmune`, `silenceImmune`, `sleepImmune`, `frozenImmune`, `levitateImmune`) are honoured by `applyStatus`; a unit both `invulnerable` and `untargetable` (a 重生, a 永久无敌 leader part) takes no status from the other side at all (PRTS 无敌 "无法被不同阵营选中", §21.19). Flag `selfBound` = 自缚 (守墓石像's 转换模式, the 自缚 leaders) beside its `noMove`: 余 S2 never teleports such a unit (束缚 sets `noMove` only).
- Same-named debuffs on an enemy (奥术's arts damage taken, 灵知 坚冰, the 莱恩哈特 / 缄默德克萨斯 RES cuts): one instance per target whoever applies it, the strongest wins (`Battle.applyStrongest`; PRTS 作战机制 "同名buff…只能表现出一个" — strongest rather than latest [ASSUMED], §20.10). PRTS 盟约记录's current 奥术 note fits this under the default overlap; an equal re-hit refreshes the instance (an earlier PRTS wording forbade re-applying while one's own lasts) [ASSUMED, slightly stronger] (§21.7).

### 5.4 Hook bus (the only way content plugs in)

`battle.on(name, handler, { priority, owner })`; handlers run in descending priority, then registration order. Handlers receive a mutable `ctx`. Events:

| name | ctx | notes |
|---|---|---|
| `battleStart` | `{}` | after initial deployment |
| `deploy` | `{ unit, initial }` | ops/tokens/enemies spawn |
| `tick` | `{ dt }` | every tick after movement & attacks |
| `beforeAttack` | `{ attacker, targets }` | may modify `targets` |
| `attack` | `{ attacker, targets, isSkill }` | an attack was performed |
| `hit` | `{ source, target, dmg }` | before mitigation; mutate `dmg` (DamageInfo) |
| `damaged` | `{ source, target, amount, type, dmg }` | after application |
| `heal` | `{ source, target, amount }` | before application (mutable amount) |
| `fatal` | `{ unit, source, credit, dmg, amount, prevented }` | HP would reach 0 — fired by every HP loss of a unit without a boss pool (hits of any type, element bursts, 无来源 damage, `loseHp`); set `prevented`. Order: kits' own savers (10 … −60) → items' 不死 (坚固维式重锤, once per deployment) `PRIO_REVIVE` −100; a running 坚固 window's hook sits at `PRIO_UNDYING_HELD` −99, before a 傀儡师's switch to its 替身 (−100, ahead of the lock — a 本体 holding 不死 does not switch, §22.11). The 复活 are no `fatal` savers since 0.2.0: they answer the knock-out (`death`, below) |
| `kill` | `{ killer, victim }` | victim hp reached 0; a `killed` ability that keeps the enemy alive (a knock-out into a 重生 / form change, §21.4) hides it from every later handler, the kill count, credit and the bounty |
| `death` | `{ unit }` | unit removed (ops may redeploy later); the `die` event and the death hooks fire only on removal. Knock-out revives redeploy the operator at once inside it, free, where it lies (PRTS "“复活”的实现方式为：…下次部署的再部署时间和费用归零": the 被击倒时 and 部署时 effects both run, a deploy-timed skill (`activateOnDeploy`) started anew: §25.17.5): items' 复活 (M3茧甲) `PRIO_RESPAWN` 13 → 埃芒加德 `PRIO_BAND_REVIVE` 12 (both `items/battle.js reviveNow`, ctx `revivedBy`) → 阿戈尔 5's first-knock-out revive 11 (a knock-out by the battle-start devour waits for the last devour pass, then the knocked-out members go by board position: §25.22.5) → 不屈 10 |
| `skillStart` / `skillEnd` | `{ unit, skill }` | |
| `ammoUsed` | `{ unit, left }` | per ammo consumed |
| `spGain` | `{ unit, amount }` | mutable |
| `statusApplied` | `{ source, target, status, duration }` | after immunity check |
| `blocked` | `{ blocker, enemy }` | enemy became blocked |
| `enemySpawn` / `enemyLeak` | `{ enemy }` | |
| `battleEnd` | `{ result }` | may add layer gains / coins |

Settlement operations take object requests; [short examples](../../server/sim/AGENTS.md) and
[request types](../../types/attack.js) define their supported options. `source` is actual source; `credit` defaults
to it and independently owns damage/kill statistics. HP damage (`phys/arts/true/elemental`), element-gauge intake,
typed HP loss, healing and gauge recovery are separate operations. `DamageInfo` is the normalized instance;
native class (`attackType`), instance route (`applyWay`) and attack behavior (`isAttack`) are independent.
Legacy positional calls remain supported; true damage does not replace HP loss.
The ignoreSelect (no selection) option bypasses the relevant selection-immunity guard for direct or existing effects.

DamageInfo: `{ amount (pre-mitigation), type: 'phys'|'arts'|'true'|'elemental'|'element', element?: 'burn'|'necrosis'|'neural'|'apoptosis', atkScale, defIgnoreFlat, defIgnorePct, resIgnoreFlat, resIgnorePct, mul (multiplier), canDodge, attackType ('NONE'|'NORMAL'|'SPLASH'|'BUFF'|'ADDITION', PRTS 伤害分类), applyWay ('NONE'|'MELEE'|'RANGED'|'ALL'), dodgeMode?, calculation? ('base'|'precomputed'|'resolved'), isSkill, isSplash, isAttack (attack behaviour only), ignoreSelect (no selection — a 无视无法选择 ability, a direct pick, a debuff's tick: it reaches an airborne 起飞 ally, §21.22), tags[] }` (server/sim/attack/helpers.js makeDamageInfo; object requests: types/attack.js).

Engine helpers (content must use these, never touch internals): `battle.dealDamage({ source, credit?, target, amount, type, … })` (or the positional `battle.dealDamage(source, target, dmgInfo)`), `battle.dealElementDamage({ source, target, amount, element })`, `battle.dealHPLose({ source, target, amount, type? })` (流失; positional `(target, amount, opts)`, `opts.type` likewise), `battle.heal({ source, target, amount, mode? })` / `battle.heal(source, target, amount, {overheal=false})`, `battle.healElement({ target, amount, element? })`, `battle.applyStatus(target, key, { duration, source, value })`, `battle.addBuff(unit, buff)`, `battle.removeBuff(unit, key)`, `battle.spawnToken(ownerUnit|playerId, tokenId, row, col, opts)`, `battle.spawnEnemy(enemyKey, { routeIndex, pos, mods, tag })`, `battle.addProjectile({ from, to|target, speed, onHit, visual })`, `battle.push(e, force, { from, dir, fixed, fixedAngle, inward, effect })` / `battle.pull(e, force, { to, center, stop })` / `battle.pullToFront(e, unit, force)` / `battle.forceLevel(e, force)` / `battle.pushDistance(e, force, { effect })` (the official 力度 − 重量 tables, §20.3; a 静态刚体 — data `staticBody` — is never moved, §21.9; a push / pull then holds the enemy in its 失衡 state — no walking, normal attack or skill — for the PRTS 位移时间 / force window, 0.2.2, SIM.md §6; `battle.displace(e, dir, distance)` is the raw mover), `battle.allySelectable(a, by)` / `battle.alliesFor(by, ownerId)` (friendly selection, skipping 孤立 units, §20.3), `battle.unitsInGrid(unit, grid)`, `battle.enemiesInRadius(x, y, r)` (every enemy: enemy-side auras / heals, collisions), `battle.foesInRadius(x, y, r)` (the enemies an operator's area effect can select — no untargetable, no unblocked unrevealed 隐匿 enemy; PRTS 作战机制 §AOE伤害判定, §21.19), `battle.alliesInRadius(x, y, r, ownerId?)`, `battle.addLayers(playerId, bondId, n, reason)` (no-op when gains disabled; at most the room left under `BOND_LAYER_CAP` 999 — `shared/constants.js layerGainRoom`, §20.12; records into result), `battle.loseHp(target, amount, { source, from, sourceless })` (流失 — it skips the damage events: no 受击回复, TAKE_DAMAGE, shield or counter, `attack.js isHpLoss`; only for what the official calls 流失 — "N 真实伤害 per second" effects such as 源石溶剂 are `periodicDamage` damage, §21.12; a 物理流失 is first reduced by the target's DEF, 阿戈尔's devour, §21.19; `sourceless` = 无来源, `source` keeps the credit — leader parts pass damage on 1:1 with it, §20.10), `battle.addCoins(playerId, n)`, `battle.fx(kind, params)` (client VFX event), `battle.rng()` (never `Math.random`), `battle.getPlayer(playerId)` (bonds/band/effects view), `battle.redeploy(unit)` (on its rest tile: where a knocked-out operator lies, else its home; `battle.isReservedTile(r, c)` = a tile no automatic placement takes, `battle.downOn(r, c)` = the knocked-out operator lying there, whose tile no ally deploys or moves onto — §21.24), `battle.after(seconds, fn)` (scheduled callbacks), `battle.every(seconds, fn)`.

Wild Mane S2 (`skchr_wildmn_2`, force 1 in the official skill table) uses the directional push correction
even behind her: >45° off deployment or <0.25 tile becomes radial away with force level −2 (client
`knockback[dir]`, `_useSourceDirection: true`, `_decreaseForceLevelWhenNotInDirection: 2`; PRTS 推与拉).
The maintainer's 2026-10-19 official recordings (#782, §35.10) supersede §32.14.9's `keepDir` exception;
no other kit used it. Rear means a negative dot product against her field deployment direction, including the
mirrored right boss half; attack animation turns never change it. Rear weight-1 hits measure about 0.09 tile,
matching `PUSH_TILES_EFFECT[-2] = 0.085`; weight 0 uses 0.374, weight ≥2 moves zero.
**[ASSUMED]** This change preserves front/side/near-front distances by task scope and selects the effect column
only for rear hits. The footage also suggests a 1.56-tile front push; it does not establish an official
rear-only effect classification. Other weights and unrecorded rear angles use the same PRTS column [ASSUMED].

### 5.5 Combat rules (engine)

- **Prepared 外勤医疗 slot**: 预备干员-医疗 is visible on the field during preparation. At `battleStart`, the elite count
  chooses either that medic or its Touch replacement for the same slot. [ASSUMED] This replacement does not move the
  slot behind the ordinary starting operators in effective deployment priority: both variants receive an earlier
  `aggroSeq`, while their actual `deploySeq` still records the later runtime creation and guards deployment-scoped
  effects. On a shared field, prepared slots follow player order [ASSUMED]. An ad-hoc map-character spawn during
  combat retains ordinary summon priority. See §30.22 and SIM.md §1.
- **Initial deployment** at t=0, free: operators by column — the left column first, top to bottom within a column (right-side boss player: from its own left, the highest field column) — then the summons (PRTS 卫戍协议/帮助 "按从上到下>从左到右的顺序部署。优先部署干员，随后为召唤物", read as a scan: down each column, the columns left to right — the order PRTS gives the 阿戈尔 devour, "更靠左和靠上"; row-major until 0.1.3, §23.23; `aggroSeq` ranks every start-of-battle summon after all operators) — a skill's placed summon (赫默 医疗探机, 巫恋 诅咒娃娃) included, once and free ("所有手动部署的召唤物，无视所属干员的持有状态…作战开始时立即部署一次"; afterwards it re-appears on its tile each time the owner's skill gives one, §20.1); on a shared field (联防, boss) the players' i-th operators deploy together [ASSUMED]. Deploy effects fire (`deploy` with `initial: true`). Then operators carried into 联防 knocked out (`carryState.down`) are forced out (`FORCED_EXIT`, HP 0, §19.3). Then `battleStart`, after which the forced-out operators' timers are re-read (redeploy-time effects that start with the battle, e.g. 机变 征召, cover them too).
- **DP**: per player, start 10, +1/s, cap 99; used only for auto-redeploy (dead op: after `respawnTime`, if the tile it lies on is free and DP ≥ cost ⇒ redeploy there with full HP, SP = initSp). A knocked-out operator (and, since 0.1.2, one forced out by its own effects, §22.15) stays **down** on the tile it fell on — its own home when it fell on another board piece's home (that piece on the field or not) and its home is free, and 乌尔比安 knocked out while his S3 has moved him always on his deployment tile when it is free (the owner's deviation of 2026-10-07, `Unit.downAtHome`, §25.17.3) — until it redeploys there, and no ally deploys or moves onto that tile meanwhile (PRTS 卫戍协议/帮助 §作战阶段 单位部署; `Battle.downOn` / `restTile` / `_layBody`, §21.24; b.snap `down`, §18.3: counting / waiting for DP / its tile taken, a safeguard) — also one that entered 联防 knocked out (`FORCED_EXIT`, its full redeploy timer — confirmed by the user — with the battle-start redeploy effects, §19.3); summons, devices and enemies leave at once.
- **Operator exit recalls its summons**: an operator leaving the field — struck down, retreated, sold out or handed over in 联防 — takes its summons with it: `deploy.js` `_remove` calls `_recallSummons(unit)` in front of `die` / `death`, so every living token whose `ownerUnit` is that operator is withdrawn (or dies in place when it cannot stand on its tile, e.g. the path-blocking 香槟炸弹) and fires the same `die` / `death` events a retreat does; the order also keeps a token a death effect places from being swept up. The summons the original game leaves standing are exempt through `Unit.keepOnOwnerExit`, stamped by the content layer (`content/tokens.js` `KEPT_ON_OWNER_EXIT`: 医疗探机 `token_10003_cgbird_bird`, 夜莺's 幻影, 鸿雪's 打字机 `token_10026_bgsnow_subbow`, 死魂灵's 魂灵之影 `token_10035_wisdel_wward`, 卡尔茨's 战术锚点 `token_10068_kalts2_mtship`; 娜斯提's 高台 only in its level-3 form, which its kit stamps by level). [ASSUMED] the official token tables carry no field for it (`tokens.json` `desc` is empty), so the default is recall plus the exemptions above, per the maintainer's playtest of 2026-10-23 (琳琅诗怀雅 S2's 香槟炸弹 had stayed on the field after she was knocked out).
- **Blocking** (contact radius, PRTS 游戏数据基础 §阻挡半径 / 作战机制 "中点判定…案例：阻挡"; `constants.js BLOCK_RADIUS`, `Battle._checkBlock`, §19.2): an operator with free capacity blocks an unblocked, blockable enemy whose position lies within its block radius of its centre — ground 0.7071 (squared 0.49999037), 0.8944 × the blocker's 阻挡半径倍率 for blockFly units vs flyers (起飞; mod `blockRadiusScale` = 倍率 − 1 — PRTS 游戏数据基础 "飞行阻挡半径 = 0.8944 × 阻挡半径倍率", 凯尔希·思衡托 +0.23), devices 0.4472 (阻隔工事 / 障碍物); air units (FLY, 近地悬浮, 浮空) only by blockFly units. A ground enemy is never blocked by a unit standing on a tile ground units cannot pass (围墙 / 围栏: PRTS 地形机制 "部署在其中的单位，若当前阻挡类型为'地面阻挡'则无法阻挡敌人" — an enemy pushed or pulled against the fence walks on; air blocking there stays [ASSUMED], §21.23) nor by an airborne (起飞) unit, which blocks flyers only (§21.22). An enemy holding 不可阻挡 (PRTS 异常效果 BLOCK_FREE 「无法阻挡/被阻挡，自动解除阻挡」) — `unblockable` (恐惧, 诱导, enemy abilities), 浮空, and 沉睡 (SLEEPING = 无法行动+无敌+不可阻挡) — is never blocked and is released at once: a sleeping enemy frees its blocker's slot, stays where it is and, once awake, is blocked again only by a blocker with room (§24.9). The nearest such operator wins (ties: scan order [ASSUMED]). It is re-checked every tick, moving or not, so another operator in contact with room takes the enemy over when its blocker dies, is withdrawn or is stunned, and an operator whose capacity frees up grabs an overlapping enemy; one that finds no room walks on. A stunned or frozen enemy is checked too — 晕眩 / 冻结 hold no 不可阻挡 (PRTS 异常效果: the STUN / FROZEN state machines stop its moves and attacks) —, so an operator redeployed beside a held enemy blocks it where it stands and lifts its 隐匿; one held short of contact is blocked once it walks in after the status (GitHub #232; until 0.2.0 the check waited for the status to end). A head-on enemy stops at contact (≈ 0.71 tile), outside the blocker's tile. Enemy uses `blockCnt` capacity (default 1). Blocked enemies stop moving and attack their blocker if melee (or anyone in range if ranged, blocker first). **Every blocker** — melee units (重装要塞 / 领主 / 哨戒铁卫 included), summons and a ranged operator on a melee tile alike — whose attack hits enemies may always target the enemies it blocks, in range or not, whatever its facing, and targets them first — a 速射手's air priority (优先攻击空中单位) excepted, which comes before the enemy it blocks (the owner's decision of 2026-10-08, GitHub #220) — ("可以选择且优先选择阻挡单位", PRTS 选择器; the user's rule after playtest #6, "阻挡了就一定要能打到", where the enemy stands; `Battle.blockedTargets`, `targeting.js sortEnemyTargets`; §20.3 — it replaces the playtest #5 QA's melee-only restriction of §19.2). A healer (dmgType `heal`, or a skill attack turned into a heal) selects injured allies only and keeps healing while it blocks (PRTS 卫戍协议/帮助 "对于医疗干员（咒愈师分支除外），攻击目标为需要治疗的单位"; §21.17); 咒愈师 follow the blocker rule. The huge leaders are 自缚 + unblockable (§7).
- **Operator attacks**: every `interval` s if a valid target exists; targets = up to `maxTargets` (default 1) from `unitsInGrid(rangeGrid)` (a `rangeAoe` profile — 阵法术师, 轰击术师 — takes every selectable enemy in range, §21.18; 「同时攻击阻挡的所有敌人」 — 强攻手 / 重剑手 / 推击手 and the skills worded so, `hitAllBlocked` — up to the block count, never fewer than 1, since 0.2.0: PRTS 分支特性信息 "普通攻击最大目标数等于阻挡数（不会低于1）"), priority: (1) the enemies it blocks (every blocker, in range or not, §20.3), (2) profession/trait priorities (e.g. fly-first snipers, `trait` text parsed by build-data into `targetPriority`), (3) enemy with the **least remaining path distance** to its goal, ties → earliest spawned. Melee (no ranged trait) and ground-only attacks cannot hit air units (`Unit.isFlying`: FLY, or a 近地悬浮 / 浮空 enemy — PRTS "算作空中单位", §19.1). Stealthed enemies can't be targeted unless blocked or revealed — or within 3 s of a block's end (§22.8). Ranged ops fire projectiles (speed ~12 tiles/s, instant for melee/arts-beam classes as data indicates); damage applies on impact; a 锁定攻击范围 AoE (`rangeAoe`) strikes every selectable enemy on its range at once with instant hits (§21.18). An attack whose cooldown reaches 0 on this tick is committed before enemies move (`noteAttackCommit`, §32.14.9): if the search after that move is empty, the attack still fires at the committed target and the projectile chases. Operators have no multi-tick wind-up (§30.7). `rangeAoe`, `allInRange` and heals still select at the strike. A target that died or became unselectable is dropped.
- **Healers** (`dmgType heal`): target the ally in range with the lowest HP% below 100%, never a 禁疗 / 孤立 unit (tokens.json `abnormal`, `noHeal`; §20.3; 史尔特尔 during 余烬, §22.7), and never the enemies they block — also while blocking (§21.17); do nothing otherwise (SP still regenerates).
- **Enemy AI**: follow the route (checkpoints; WALK paths recomputed on the grid when devices change); when blocked stop & fight (`dmgType 'none'` enemies never attack unless content arms them through `e.profile` — 转译基底's armed forms, §21.4); ranged enemies (`rangeRadius > 0`) attack ops whose 0.25 collider touches their radius (centre distance ≤ `rangeRadius` + 0.25, §3, §20.4): the enemy's own target rule filters the candidates first (`profile.canTarget`: 只攻击地面单位 …), then priority blocker → special priority → highest taunt → **latest deployed** (`aggroSeq`) — PRTS 索敌 "阻挡→特殊优先级→仇恨值→最早出现"; a stealthed ally is attacked only by the enemy it blocks (§19.1) — and not even by that one when its 索敌不受阻挡影响 (自制投石机, `profile.blockFree`: it selects as if unblocked, §25.18) —, and an enemy's area effects — splash, blasts, area skills, zones, jumps — and buff auras skip it unless it blocks that enemy, while 迷彩 does not protect from splash and the other area effects (`targeting.js areaSelectable` / `auraSelectable`, §22.12); an airborne (起飞) ally is never a ground enemy's selection — picks, area damage, zones and statuses skip it, while 无视无法选择 abilities, direct picks, debuff ticks and flying units still reach it (§21.22); unblocked, they stand for each attack's clip (enemies.json `attackAnim`: its wind-up before the strike and the rest of the clip after it, shortened when the attacks come quicker than the clip; `ATTACK_PAUSE = 0.35 s` after the strike when no clip is known; a 「不停止移动」 attacker never stops; §22.14); any enemy whose block ends after its strike (its blocker stunned by it, knocked out, retreated) stands for the rest of that clip too — PRTS 状态机: the enemy's COMBAT state ends with its attack — and a displacement ends a stand (0.2.0) and holds the enemy in its 失衡 state (0.2.2: no walking, no attack started, no skill — PRTS 失衡位移机制). Every enemy attack strikes at its clip's damage frame after its swing starts — the first one of a contact too —, and a stun / freeze / sleep / 浮空, hiding, 缴械, 恐惧 or 战栗 (blocked) before that frame cuts the swing: no strike, the next swing starts from its wind-up (0.2.0, `ai.js attackWindup`; PRTS 状态机 / 异常效果 STUNNED; no clip known: no wind-up). The swing locks the allies it had when it started (PRTS 作战机制 §AOE伤害判定: a locked attack still hits them when the wind-up ends, §32.14.9). Leaving range does not cut it: melee settles on the locked ally, a ranged shot chases. A dead or unselectable target (隐匿, 沉睡, 无法选择) is skipped and the cooldown still elapses. FLY enemies ignore ground obstacles (only blockFly units block them) and follow their checkpoint route. A feared enemy runs between random 恐惧可达地块 away from the source (PRTS 诱发移动; `fear.js`); 恐惧 outranks 诱导; the 恐惧 / 诱导 walks re-plan from where the enemy stands after a push or an obstacle change, and the route re-plans when they end (§20.4).
- **枯朽之种 self-destruct** (`enemy_1269_nhfly`): within its data range of 2 tiles it locks an operator and becomes an enemy projectile moving at 10 tiles/s (PRTS 枯朽之种). Its model follows the projectile and is not selectable, blockable or damageable during that flight. The hit deals its cached physical ATK and removes the seed. 逻各斯 S3 slows the projectile to 5% while it is in his attack range and clears it when the skill ends (PRTS 逻各斯 S3). [ASSUMED] If the locked operator leaves before impact, the seed bursts harmlessly at the last position.
- **Damage** (the ordered settlement, 0.3.2: §35.30–§35.32; SIM §4): phys `max(A − (1 − defIgnorePct)·max(0, D − defIgnoreFlat), 0.05·A)`; arts `max(A × (1 − R′/100), 0.05·A)` with `R′ = min(100, (1 − resIgnorePct)·max(0, R − resIgnoreFlat))` — fixed penetration before the percentage (PRTS 游戏数据基础 伤害公式); true = A; 元素伤害 ('elemental') `max(A × (1 − 元素抗性/100), 0.05·A)`; `A` already carries the caller's attack scale and, for arts, the target's 法术攻击加算 (`artsAttackAddition`, target calculation). The stages: `hit` → the source's calculation (`damageCalculate`; not for `calculation: 'precomputed'` / `'resolved'` requests) → the target's (`damageCalculateTarget`) → the formula × `dmg.mul` × the source's `dmgDealtMul` (× phys / artsDealtMul) → `damageOutput` → `damageBeforeApply` (source) → `damageApplying` (target) → **限伤** → the target's injury effects in priority, then acquisition order (PRTS 伤判效果: 脆弱 / 庇护 and the other damage-taken multipliers — 元素伤害 takes 元素脆弱 (`elementalTakenMul`) alone, not `dmgTakenMul`, 脆弱 = "受到的物理、法术、真实伤害提升" —, fixed reductions — the strongest per name and HP type; differently named ones stack (name = `reductionGroup`, else the buff key) —, barriers and count shields (a typed one only its types), held dodge / block effects; a cancellation stops the later defences, observers still run) → `hpDamage` and transfer reservations → the HP step (special HP maps only the HP delta). **限伤**: on a leader (`isBoss` — the 10 bossInfoDict enemyIds and their mirrored copies; never parts, drones or escorts) in a `'boss'` / `'hidden'` battle a hit whose estimate (after the source multipliers and the target's damage-taken multipliers) has `ceil(estimate) ≥ 300000` is cancelled — no HP or pool loss, no credit, no damage number, no `damaged` / kill (`shared/constants.js BOSS_HIT_LIMIT`, `attack/health.js leaderHitCancelled`, before the injury effects, its exact position [ASSUMED]; `dealHPLose` too — a part's 传递, but not 胄's drone link, a share of the pool that is no hit (`noHitLimit`, §25.13.4); the client's `MAX_BATTLE_DAMAGE`, §20.12). Typed HP loss applies its mitigation once and skips the injury effects. The red number compares that final damage, after barriers and `hpDamage`, with the expected damage (PRTS 作战机制 「伤害红字」). Element damage fills a gauge (1000; enemy leaders 2000) × `elemTakenMul` × max(0.05, 1 − 损伤抵抗/100), 损伤抵抗 = data `epResistance` (PRTS 元素; the 5 % floor of DMG_e, PRTS 游戏数据基础). An element fill on a target with no HP left is refused (attack.js `hasHp`: no burst on a corpse). A full gauge bursts with the official effects of the unit's entity class — enemy-class allies keep the enemy burst and the leader capacity, independent of the current side (§35.32) —, as **无来源** damage (no damage-dealt multiplier or penetration of the unit that filled the gauge, which keeps the kill and the stats; §19.5) of the ordinary kind — on an operator a phys / arts dodge or an injury dodge cancels the burst's HP damage while the burst status and cooldown stay (native `ep_break_*` NoSourceDamage without a cancellation mask; v0.3.1 made it undodgeable, §35.32) (sim/constants.js `ELEMENT`; operators: 灼燃 1200 arts + RES −20, 神经 stun 10 s then 1000 true, 凋亡 15 s of 阻回 (`noSp`: no SP gain of any kind) + 静默 with −1 SP/s and 100 arts/s, 侵蚀 DEF −100 then 800 phys; enemies: the "·我方" terms). Every burst starts a **爆发冷却** = its duration (灼燃 / 神经 / 侵蚀 10 s — enemies' 侵蚀 8 s — 凋亡 15 s) during which NO element of the unit fills or can be recovered; when it ends every gauge of the unit resets (§18.3).
- **Leak**: an enemy reaching its goal is removed, counted as leaked for its field owner (`sourcePlayerId` for unite). LP accounting is done by the match, not the battle.
- **Results**: `damageDealt` / a unit's `dmg` count only HP removed from the other side — a unit's own drain or 流失 and friendly damage are the target's `taken` only (§21.12).
- **End**: all spawns done and no enemies alive ⇒ `cleared`; `time ≥ timeLimit` ⇒ `timeout` (remaining enemies = leaked). Boss battles end when the shared boss pool reaches 0 (victory) or the match forces an end (team LP 0). A pool holding less than 1 HP is empty (`constants.js BOSS_POOL_MIN_HP`: the hit, or the per-player credit, that would leave less takes the rest; §20.5).

### 5.6 Skills (skills.js + kits)

SP: `spType` `INCREASE_WITH_TIME` (+`spRecovery`/s), `INCREASE_WHEN_ATTACK` (+1 per attack), `INCREASE_WHEN_TAKEN_DAMAGE` (+1 per hit taken); starts at `initSp`; no SP gain while a duration skill is active. `maxChargeTime > 1` ⇒ charges.

Timed deployment skills use `kind: 'duration'`, `activateOnDeploy: true`, `spCost: 0`, `spType: 'none'`, `trigger: 'NEVER'`.
Deployment sets landing state, then `reset()` consumes one charge through `activate('deploy')`, then emits `deploy`;
`skillStart` fires before deploy hooks. In 联防 this is a fresh deployment activation; no previous active skill state is restored.
Duration end cleans the window and emits `skillEnd`; it leaves zero charges and `ready=false`, even after SP gifts.
Redeployment opens a new full window. Permanent passives retain `passive`; first-kill recasts of 缄默德克萨斯 explicitly
restart a full window. Special timed kits and their effect rules are described in SIM §7.2.

Auto-trigger rules (`skillTrigger.rule` in data — the official 技能策略, PRTS 卫戍协议/帮助 §作战阶段 技能操作; §20.2): `DEFAULT` (SP ready AND about to attack/heal AND an enemy/injured ally inside the **initial** range, or an enemy the unit blocks; with `trigger.allies` + `hpAtMost`, attack cadence ready and a healable ally of the skill grid at or below that HP ratio suffice without an enemy — 塞雷娅 / 黍 S1 (§28.10), whose cast replaces that attack and is withdrawn with its charge if the ally recovers first), `SKILL_RANGE` (a MANUAL skill with a 技能范围 of its own, not an attack-range change: any living enemy, stealthed ones included, on the skill range, checked every tick — "仅在技能范围内存在敌人（无视其不可选中）时释放技能"; 13 skills / 26 records by the official rule, 14 / 28 in the data with 余 S2's deviation, §22.10), `ACTIVE_RANGE` (the owner's deliberate deviation of 2026-10-05, 0.2.0: a MANUAL skill on the basic strategy — or, by the owner's further decisions of the same day, on the `SEARCH` row, and 深巡 S2 on top of its §21.29 DEFAULT — whose attack range while it runs strictly contains the operator's own range — its rangeId grid, or the own range grown by `ability_range_forward_extend` — checks the DEFAULT condition on that running range every tick, no attack needed; `customRangeGrid` = the running range, `rawRule` the official row (DEFAULT, SEARCH, 深巡's TAKE_DAMAGE); 39 skills / 78 records, of them 薄绿 S1, 蜜蜡 S1, 卡涅利安 S3, 玛恩纳 S2 and 安洁莉娜 S3 from SEARCH; 烛煌 S2 / S3, whose ranges do not contain her 3-1, keep DEFAULT), `TAKE_DAMAGE` (on taking damage — any damage, 无来源 included, never a 流失; every MANUAL 重装 skill, §21.12 — but the six of the deliberate deviation, §21.29: 深巡 / 雷蛇 S2, 号角 S2 / S3 and 灰毫 S1 / S2 are `DEFAULT`, `rawRule` keeping the official TAKE_DAMAGE — 深巡 S2 then `ACTIVE_RANGE` on its 3-2; and 余 S2, `SKILL_RANGE` on its x-1 (§22.10); the 重装 of data/backups.json — the 补位 stand-ins 预备干员-重装 / Mechanist and every 自选 重装 — cast with an enemy in range, `DEFAULT` (or `ACTIVE_RANGE` when the skill's running range is larger), by the owner's decisions of 2026-10-05), `SP_FULL` (immediately — 执旗手 / 战术家 / 吟游者 MANUAL skills, AUTO DP skills such as 焰尾 S1, 凛御银灰 S1 (伺夜 S1 / S2 too, but only while his pack is on the field — PRTS 备注 「仅场上存在狼群时可触发技能」, the kit's own cast; the owner's decision of 2026-10-05 for S1; S1 also while the pack sits in its 战术点形态, which the cast ends — S2 too since 0.2.0: its DP at once, its gift kept for the returning pack [ASSUMED: S2's 备注 uses S1's words]; 黑键 S2 荒芜回响 likewise only while one placeable tile of his range is free, no enemy needed — PRTS 备注 「攻击范围内不存在可部署位时，技能不会被触发」, its kit's cast, 0.2.0), and, by their kits, AUTO skills whose effects act on allies only: 引星棘刺 S1, 浊心斯卡蒂 S2, 纯烬艾雅法拉 S1 — the owner's decision of 2026-10-05 for the last), `CUSTOM_RANGE` (enemy inside the custom grid), `SEARCH` (an enemy inside the initial range, checked every tick — no attack needed; 解放者 / 阵法术师 MANUAL skills and 安洁莉娜 S2, those without a larger running range), `GDGLOW_SKILL_2` (a valid target anywhere on the field: 荒芜拉普兰德, 纯烬艾雅法拉 S3), special ids. In every enemy condition a registered ally target (白铁's 铁钳号·原型机, an enemy-camp summon our attacks select) counts like an enemy for a skill that acts on it (the owner's rule of 2026-10-08): one acting through the unit's own attacks, or whose kit flags `allyTargets` (its selectors take the device too — 蕾缪安 S3, 艾丽妮 S3, 陈 S2, 引星棘刺 S2); [ASSUMED] a skill that picks enemies only is not opened by it. The class rows cover **every MANUAL skill** of the class and never an AUTO skill (AUTO skills keep their own rule — an inference: PRTS names whole classes; the data's `skillIndex 0` / `-1` sentinel argues the other way, §20.2). **Operation cooldown**: the engine auto-casts a MANUAL skill no sooner than `AUTO_OP_COOLDOWN` (3 s) after its previous cast and after the unit's battle-start deployment ("自动操作具有3s冷却，在完成一次操作或作战开始时部署的单位将进入冷却"; `Battle._deploy` initial, `battle.flags.startOpCooldown`); kits with an automatic cast of their own check `skill.opCooling`; a pending "next attack" never takes a second charge. Permanent passive skills are always on; finite deployment effects use the duration lifecycle above.

琳琅诗怀雅 S3 千金一掷 (§34.32) is a permanent toggle with double attacks and coin gains from kills / 大买家
payments up to blackboard `sp` (10). It never automatically closes, spends coins, bursts or pushes, even at the cap
with an enemy in range. Sources: `skill_table skchr_swire2_3` (infinite duration, spending only on 主动关闭),
[PRTS 卫戍协议/帮助 技能操作](https://prts.wiki/w/卫戍协议/帮助) (通常不会自动关闭技能); maintainer 2026-10-17
withdrew the 2026-10-04 cap-close deviation (§23.34). S1 healing and S2 champagne coin uses are unchanged.

瑕光 S2 keeps attacking sleepers: `trait.hitSleep` admits them to target search and damage for her alone; 仁慈
prioritizes them and uses the form's `atk_scale` (`character_table char_423_blemsh talents[1]`). Sleep releases blocks
(§24.9), so her S2-only extra sleeper tiles remain necessary [ASSUMED, §32.14.8]; neither S2 nor sleep disables her own
attack. `gamedata_const ba.sleep` means invincible and unable to act for the sleeping target, not its caster.
The deterministic own-sleep / actual-block / four-facing regressions and replay event checks are in §34.32.

**SkillSpec** (authored per chess in `sim/content/kits/tierN.js`; values come from the chess's skill blackboard at its level — normal Lv4, elite Lv7 — so a spec is a *function of the blackboard*):
```js
// kits map: baseChessId -> (bb, chess) => Kit
export default {
  chess_char_1_01: (bb, chess) => ({
    skill: {
      kind: 'duration' | 'ammo' | 'instant' | 'charges' | 'passive' | 'toggle',
      activateOnDeploy: false,         // optional boolean: consume a deployment charge synchronously in reset
      duration: bb.duration,            // duration kind
      ammo: bb['attack@trigger_time'],  // ammo kind
      mods: { atkPct: bb.atk, batPct: bb.base_attack_time },    // applied while active
      targeting: { maxTargets, rangeGrid, priority: 'fly'|'ranged'|'lowestHp'|'highestHp'|..., noRangeExtend, showOwnRange },  // noRangeExtend: the range ignores 攻击距离; showOwnRange: the grid only selects targets (the card keeps the unit's own, §21.16)
      attack: { dmgType, atkScale, splashRadius, hits, projectile: 'arrow'|'bolt'|'none'|'beam', onHit(ctx) },
      onStart(ctx) {}, onEnd(ctx) {},    // bursts, summons, heals, statuses (use engine helpers only)
    },
    talents: [ { install(battle, unit) {} } ],   // passive/conditional talents via hooks
    trait: { ... }                              // optional overrides of profession trait behaviour
  }),
}
```
The kit loader passes `bb` = flattened blackboard `{ key: value }` of the chess's skill (normal or elite), and `chess` = data record (for talents' blackboards). Missing kit ⇒ a **generic kit** derived from blackboard keys (atk/attack_speed/def/max_hp/base_attack_time/atk_scale/max_target/duration/ammo) so every chess always works.

P1b data plugins (DESIGN §32.5): kit lookup resolves the empty extension seam, DSL seam, JSON SkillSpec, official `kitRef`, then the normal official registry and generic fallback. JSON fields are allowlisted; no third-party function runs. Explicit test-kit injection retains its precedence.

Profession traits (default behaviours implemented once in the engine, keyed by `subProfessionId`): e.g. `fastshot` (fly priority), `aoesniper`/`splashcaster` (splash 1.1 tiles around the target; 格雷伊 1.0), `bombarder` (ground splash 0.9 + aftershock), `chain` caster (bounce ×3, −15%, 1.7-tile jumps — PRTS 溅射半径一览, §21.19), `phalanx`/`blastcaster` (`rangeAoe`: every selectable enemy in range at once, instant; §21.18), `funnel`, `physician` (single heal), `ringhealer` (aoe heal), `bard` (aura heal, no attack), `slower` (slow on hit), `loopshooter` (回环射手: a boomerang out to the target and back, attacks again only once it is caught — §17.4), `underminer`, `instructor`, `lord` (ranged attack ×0.8 when not melee), `centurion`/`fighter`/`musha`/`swordmaster`/`reaper` etc., `protector`/`guardian`/`fortress`/`duelist`, `pioneer`/`charger`/`tactician`/`bearer`/`agent`, `executor`, `merchant`, `hookmaster`, `pusher`, `stalker`, `geek`, `dollkeeper`, `traper`, `craftsman`, `summoner` … (build-data provides the list of subprofessions present in the pool; the sim-core owner implements all present ones with simplified faithful behaviour).

---

Unreleased funnel drones deal additional arts damage alongside the ordinary attack (PRTS 分支特性信息 驭械术师, §30.24).
The engine keeps a 100 % ATK body instance and a separate drone instance, each through mitigation and shields.
`funnelMul` holds only the drone ramp; the attack's `dmgMul` (至简's talent) is shared once. Extra attached drones
raise `hits`, not the body count; 至简's charged S2 sets `funnelBodyHits` to two. Both share one `attackId`, attack
hook and SP / charge use; additions have `addition` and `funnel` tags and do not count as `isAttack`. [ASSUMED] Body
instances precede additions at the existing projectile impact; consecutive hits keep one ramp per volley. A skill
that only buffs or retargets the normal attack keeps the body; `isSkill` is not the switch. `funnelBodyHits === 0`
is drone-only (荒芜拉普兰德 S2): the ramp stays inside those hits. 耶拉 S2 detaches `funnelMul` the way 洛洛 S2 does:
one 100 % body inside her range, the unreleased addition off, and the released drones as separate skill hits that
keep the lock until the enemy dies or the skill ends (§30.24). 澄闪's skills stay on their own `dealDamage` paths.

Funnel ramps return to the initial scale on a normal deployment, including automatic revival against the same living
target (§30.25). The reset clears the current target, the scale and any per-target ramp map, and leaves other trait
state alone. A free move (`moveRedeploy`, the same carry as a 秘术师's stored energy and 乌尔比安 S3) keeps the ramp.
An in-flight shot recomputes the ramp when it lands, so a projectile launched before the reset can still step the new
ramp.

洛洛 S2 releases its trait drone into an independent skill tick (§30.26). Acquisition uses the body's normal target
selection; a living selectable lock stays valid outside the body's range and returns only when that enemy dies or the
skill ends. The body retains its own ranged ordinary attacks. The released ramp inherits the trait state but is
isolated from older projectiles, and while it is out the unreleased addition is off. Ending the skill returns that
ramp to the trait and restores the normal multiplier and the overload cap. S1 and other operators' funnel attacks keep
their existing paths. [ASSUMED] There is no flight delay; an untargetable lock is dropped and retargeted; body control
does not pause the released drone.

---

## 7. Content modules (server/sim/content + match/effectsMeta handlers)

Each domain file `server/sim/content/{tokens,bonds,garrisons,items,bands,enemies,bosses,devices,choices}.js` exports `install(battle)` (battle side; called once per Battle by `content/index.js → installContent`) and `registerMeta(registry)` (prep side; called once at server boot by `match/effectsMeta.js`, API documented in `docs/META.md`). Kits live one per file in `content/kits/ops/` (`export default { [baseChessId]: (bb, chess, def) => Kit }`), listed in `content/kits/index.js` (guide: `content/kits/README.md`). Content must be **data-driven from blackboards** (numbers never hard-coded when a blackboard key exists). Every effect gets at least one unit test in `test/content/*.test.js` using the `test/helpers/battleHarness.js` harness (provided by sim-core).

- kits: all 112 visible chess + hidden ones used by effects (盟约·辅助干员), default skill + talents + trait specifics; tokens. The 72 non-collaboration 6★ DIY operators include 克莱门莎 (§28.1); her launch-day provisional mechanics are local to her kit. 黍 GUA-Y and 乌尔比安 CRU-Y follow the generated module blackboards and existing module-level rules (§28.2).
  忍冬's 追凶 adds arts damage on the first qualifying instance too; the per-enemy window starts on that instance,
  and repeated hits do not extend it. The addition keeps its own tag and re-entrancy guard (§30.3).
  克莱门莎 S2 removes dead, hidden, self-bound / teleport-immune and unreachable passengers before checking new
  boarding in the same tick. Each released passenger returns its current weight to the cabin's remaining budget
  and frees its slot (§28.27); neither corpses nor failed carries reserve capacity.
- bonds: 23 (battle + meta), exact per-layer formulas from research 02.
- garrisons: 43 effect keys (IN_BATTLE via hooks; SERVER_* via meta registry).
  远牙's granted `garrison_108_a/b` additionally gains on both directions of `dollSwap`, sharing its deployment
  cap and active-bond checks (player-confirmed, §28.5). This extra trigger is specific to that granted trait.
- items: 56 equipment (+golden) + 3 Arts; 变形同构体 bond grant; VI-tier set/combos.
- bands: 40 strategies (meta + battle). 鸭爵 “神秘顾客” swaps 0–2 ground enemies (not the leader, its parts or bounties; on a pair boss field only the player's half — the boss / hidden `onBattleStart` event carries `routes` and `side`) in every teammate's normal / Final Assault / Hidden Core battle from R5 into the act2 鸭爵 / 高普尼克 / 流泪小子 / 圆仔 (lpr 1, 1 fund to the killer, 联防 included) (§21.5); the swaps carry the spawn tag `'duck'`, and the swapped 流泪小子 hides again 1 s after a block ends, not the official 0 s (the owner's decision of 2026-10-07, §25.22.6).
- **假想敌：镜膜** (#481): 折射 gives +70 RES while not silenced and returns after silence ends. Its +100% max HP bonus is permanently removed by the first silence; current HP keeps its ratio. The fan permanently switches to the stopped B animation set, including for late observers. Source: [PRTS 假想敌：镜膜](https://prts.wiki/w/假想敌：镜膜), which corrects the game text: the HP bonus cannot recover.
- enemies: special-type behaviours (FLY, TIMES, ELEMENT, DOT, INVISIBLE, REFLECTION, SPECIAL) and notable individual abilities from `data/enemies.json`; 血珀 (`enemy_1367_dseed`) is 自缚, 失衡免疫, 不攻击 and 无法被阻挡, and with no 唤血祭坛 or 沥血王座 in this mode it loses `Passive.hp_ratio` (10%) of max HP each second as true 流失 until it dies — the torturer still leaves the two uncounted, and the altar rebirth is not modelled (`Passive.damage_resistance` 0 is unused) (#720, §35.107); 心虚设计师 (`enemy_10097_crshd`) while blocked faces its blocker, otherwise its walk, and that sign is also `b.snap` `face` so the model turns with the front cut (display only, outside the golden tuple; a blocker on the same column keeps the last sign [ASSUMED]) (#869, §35.108); bosses 1–10 scripted — the huge leaders (假想敌：胄 ×2, 假想敌：管 ×2, 盐风主教昆图斯, 阿利斯泰尔, “萨米的意志”) are 自缚 + 无法被阻挡 (PRTS 天赋; `content/bosses.js SELF_BOUND`: a persistent noMove + unblockable buff from spawn) with their hit area (§19.4); 圆仔 and 鸭爵 are 无法被阻挡 (PRTS 天赋, §21.5); the knock-out forms follow PRTS — 深池逐火 余烬 (5 / 10 hits, 隐匿, blockable, back after 10 s), 转译基底·α (damage cancelled until its 2 s change into 寻仇者 / 特战术师 / 幽灵), the leaders' 重生, 守墓石像's statue and flight — and every 重生 clears what operators put on the enemy and restarts its skills from their initial cooldown (§21.4, §21.19); the mode's air units are 静态刚体, never moved (§21.9); leader parts (斩胄之剑 / 破胄之锤 / 碎铳之簧) pass every damage they take to their leader 1:1 as 无来源 HP loss (`PART_TRANSFER` 1, PRTS "等量"), a 假想敌：胄 drone that dies costs it 2 % of the pool (`DRONE_LINK_BASE 'pool'`) (§20.10, §20.13); 盐风主教昆图斯's attack-class 大潮 / 崩坍 take the place of a normal attack, 断裂生殖 / 物种爆发 also take an attack turn with their own no-target trigger (§35.55), every one of its skills is ready again its cooldown after its clip's end (the clip not stretched by a slow [ASSUMED]: past a 5.167 s attack interval — 寒冷 plus any further cut — the third-form tide takes every turn), and 断裂生殖 stops once its level branch's 7 squad actions are used (§35.19); devices/terrain.
- choices: 机变 families (悬赏决策 bounties, 道具补给, 机密商店, 战术决策 team/personal buffs). 悬赏决策 = the official structure of its round (choices.json `bountyDrafts`, 86 drafted cards: R3 a fixed set of six 两场 cards, R9 6 of a boss group's list, R11 6 of a seen 7-card list; §21.2); 机密商店 (R11 the official composition) and 战术决策 can offer the same card twice (`shopDraft` / `tacticDraft`); bounty cards carry `descRaw`; no draft offers a multi-round card, and 教鞭's lasts two battles (`choices.js MULTI_ROUND_BOUNTY_BATTLES`, §20.6). Pointing Stick (教鞭) offers up to three private Tactical Training cards during PREP; the owner confirms one through `g.choice` with its `choiceId`, with Ready blocked until confirmation or the existing prep deadline's auto-pick. “神秘顾客” remains random (META §2.5).

假想敌：淤困 (`enemy_9007_acelem`) is an exception to the usual block-contact position: on attachment it blinks to
the blocker's tile centre and holds 自缚 until the block ends (PRTS 假想敌：淤困). Its content kit clears the cached
route from that new position and emits a `teleport` fx with `kind: 'parasite'`; the client snaps only this sub-tile
attachment blink instead of sliding it.

---

蕾缪安's wanted tiles extend both attacks and the existing content skill-trigger range (§28.4). New detection
requires selectability; an attached timer needs continuous detection range, and each on-field source owns its timers
and marks. Leaving clears that source's state without clearing another still-deployed source's marks.

凯尔希·思衡托 S2 uses its mixed attack/heal target condition for automatic activation: either an injured, healable ally
or a selectable enemy in its expanded running range; operation cooldown and other controls still apply (§28.10).

### Enemy passengers (§32.14.4, #564)

伊利昂的木驮兽 / “越长尘” load up to 5 / 4 non-leader, non-machine ground enemy units within 0.5 tiles
(PRTS 载客半径; ordinary and elite enemies of any faction and mass qualify). Hidden enemies cannot board. A carrier
cannot pick up while hidden, unbalanced, stunned, frozen, sleeping or levitated. Silence does not stop it.
Passengers disappear (existing `hidden`: omitted from the snapshot, skipped by targeting), retain their identity,
HP and bounty, and stop moving, attacking and running their enemy-kit tick. They are pinned to the carrier so they
do not stay on the boarding tile. [ASSUMED] While hidden they also take no new damage (the attack/ pipeline returns 0).
Removal (kill or leak, both `death`) unloads surviving passengers; they then walk and settle on their own. Timeout
does not unload them: each living unit is counted once.
The camel loses 20% movement speed per passenger, added in one `moveMul` (`max(0, 1 + n · bus.move_speed)`), then
an absolute 0.1 floor (`unit.mem.moveSpeedFloor`, after every other modifier). It unloads inside a 0.4-side square
at its position, drawing x then y from the battle RNG in boarding order, and gives each passenger an independent
copy of its remaining route. “越长尘” unloads at the centre of its tile and draws nothing.
Both skip a current wait checkpoint on unloading. [ASSUMED] That skip, the spawn-order priority when seats run
out, and “越长尘” keeping each passenger's own remaining route (PRTS names a replacement only for the camel).
[ASSUMED] Stun, freeze, sleep, 浮空, 失衡 and fear on the passenger do not block boarding.
`bus.half_cnt` is the PRTS model threshold (≥2, and at the cap). No snapshot field selects a Spine skin, so it is
not applied. No shipped stage has 云梯, so “越长尘” does not unload early and does not permanently lose pickup;
no substitute tile is used. `enemy_10159_mntrjn_2` is not this kit.

### Additional DEFAULT trigger targets (§28.13)

`addTriggerRange(fn, { attackOnly: true })` extends the DEFAULT target check at the owner's next attack opportunity.
It does not create a per-tick trigger. 蕾缪安 S1–S3 use only their own wanted targets; 死芒 S1/S2 use targets blocked by
living summons owned by that operator. Sleeping or otherwise unselectable enemies do not count. This only changes
the condition for activation: 死芒 S2 still links inside its own effect range. Other registered summon areas retain
the existing per-tick behavior. The optional flag defaults to false for compatibility.

赤刃明霄陈 S3 also registers selectable air targets in its expanded attack grid for `ACTIVE_RANGE` automation
(§28.26): its sword wave can hit flyers while its normal attacks remain ground-only. The existing operation cooldown,
silence and control checks apply. [ASSUMED] The activation area is that grid plus permanent attack-range extension,
not every tile the roaming wave might eventually reach.

凛御银灰 S3 变革已至 does the same for its skill grid (§35.84): PRTS 备注：技能期间由丹增进行攻击判定，允许空中目标 — the attacks are the
eagle's. The same content range on his attack grid with an air profile, and `targeting.canHitFly` so those attacks and the
enemies they add on the target's line reach flyers. [ASSUMED] The same activation area — the grid plus permanent range
extension.


0.2.3 echo/counter interaction (DESIGN §28.24): recursively earned “余音” pulses are drained FIFO by that echo in the
same call, retaining the earned attack value and the lethal-hit pulse. [ASSUMED] This local order avoids exhausting
the hook-depth guard on scaled hit-count HP; the guard remains unchanged for other recursive handlers.

### Community corrections (2026-10-10, §28.25)

- A normal enemy attack's post-hit status belongs to the target's deployment at the strike. If lethal damage
  immediately redeploys the target (不屈), that old attack cannot stun the new deployment.
- Bard continuous regeneration, including 浊心斯卡蒂's replacement trait, continues through stun; leaving the field
  stops refreshing its aura. Stun still prevents attacks and skill use.
- 黄沙罗盘 SP ignores both an active skill's recovery lock and `noSp`, including the caster and other 萨尔贡 recipients
  of the 浓茶 combination. Other SP gifts retain their existing restrictions.
- 克莱门莎's 崇高牺牲 strategy requires 阿戈尔 to be active before a knock-out grants layers.
- 隐秘核心 铳 takes 20% physical/arts damage while another gun or spring remains. The condition is checked on each hit
  as well as by its aura tick, including the first hit and immediately after the last companion leaves.

Sources and the feedback items requiring no simulation change are recorded in [§28.25](../history/0.2.3.md#2825-community-feedback-of-2026-10-10).

Community corrections in §29 are normative: Raid's one reselect after a revive uses taunt then route distance and jumps while unblocked, after refreshing contact on the current tile; ordinary polls stay on route distance and the empty-range rule. Healing cast conditions include curable elemental injury; Pinecone S2 growth restarts per deployment; crest consumption is checked on damage. Mixed Skadi/Stead redirects preserve ancestry and reserve shares from one post-barrier amount; Skadi receives HP loss; Stead recipients receive resolved true damage without repeating calculation. The combined parallel-sharing policy is [ASSUMED], including Stead/barrier order; see §35.32. Clementia S2 secondary splash is 100% ATK within a 1.1 collision radius (four additional ground targets), while its main hit and 1.5-radius vortex keep their own coefficients. Final-mode leaders retain their erosion immunity, explicitly stated in the PRTS mode tips. 整备 does not upgrade a purchase when the golden's second copy would exceed shared item stock, and it does not spend its charge in that case.

Raid alone may land on an empty deployment half in multiplayer (`mode_multi_*`) Final Assault / Hidden Core battles
(#475, maintainer-approved, §29.13): rows 2–5, cols 2–18, subject to the existing field rect, terrain, occupied/downed
tile and attack-reach checks. Hand/temp rows, empty halves in single-player mode or lone-helper 联防 stay excluded.
The general `onOwnBoard`/`onFieldBoard` contracts, other movement, summons and preparation placement remain unchanged.

Raid's landing search window is measured to the tiles the enemy occupies (`body.js`; a huge unit's `hitArea`), not to the
tile the enemy's position rounds to: a leader's `hitArea` offset and its route anchor may split one and the same body
differently (假想敌：管 stands at `dx` 0 in the Final Assault and one column left at `dx` 1 in the Hidden Core — the same
rectangle either way), and an anchor-relative window lost the landings on the far side of that body, which stopped the
Hidden Core's 管 from being jumped to at all (community report of 2026-10-13). The landing preference, the block
preference and their tie-breaks stay relative to the position's tile.

香槟炸弹 also rejects ordinary allied auras and inspiration as a device, through its shared internal selection barrier (§29.11). This does not isolate other unhealable summons or alter its detonation.

§30.3 corrections: fortress targeting is blocked → ordinary range → own tile (selectable ground targets only).
Automatic skill checks include that extra tile. Melee attacks are single-target unless the skill explicitly gives
melee splash (Horn S2). Each shot retains its launch-time melee mode while flying. The bounty catapult's normal
triple attack is three physical attacks `hit_interval` (0.3 s) apart, each splashing at radius 1.5 (PRTS 天赋; the
blackboard `projectile_range` 0.5 is the 入戏 stone). Each stone passes DEF, shields and 「每次受到攻击」 on its own.
The volley still finishes if the target is lost, and a scheduled stone still lands if the catapult dies. 入戏(敌方)
is an `inPlay` flag this mode never grants (§32.14.9). Clementia S3 accepts enemy erosion bursts only.
Kjerag Ice and Tear Gas proc on actual carrier damage to enemies, including DoT/skill/splash; elemental gauge fill,
HP loss, bare attack events and zero damage do not qualify. These changes do not alter other items' attack hooks.

Xi alone opts into hostile selection immunity during its ten-second post-rebirth invincibility (§30.8).
The generic `invulnerable` flag remains damage protection only; other rebirth kits retain their existing choices.
Presence-only and SP-only skill triggers are not suppressed merely because their enemies are unselectable.


P3a script registrations (DESIGN §32.10; PLUGINS §13) fill C2's first kit-dispatch branch only for script compositions.
The ordered extension registry also installs enemy/battle modules and prep handlers. Script hooks/actions share the
DSL plugin budget and attribution. Vanilla registrations remain empty; no official kit or golden behavior changes.

The same SDK and scriptGuard apply inside SES in sandbox mode (DESIGN §32.11); the evaluator consumes verified
script descriptors. SDK-owned results are frozen copies; live Battle/Unit objects are not hardened.

### Settlement consumers and evidence

The damage pipeline and event contracts are specified in [SIM §4](../SIM.md#4-damage--heal-pipeline).
Injury effects follow priority then acquisition order; cancellation stops later defensive resource consumption
while eligible observers retain their position. Fixed reduction applies at its injury position, after source
scaling. Special HP changes the final HP delta, not barrier consumption or damage-based riders.
Sources: [伤判效果](https://prts.wiki/w/伤判效果), [伤害分类](https://prts.wiki/w/伤害分类),
[游戏数据基础](https://prts.wiki/w/游戏数据基础), and the fixed
[buff templates](https://github.com/yuanyan3060/ArknightsGameResource/blob/9bf239661e37766fba585806fb9fa67e79bb679e/gamedata/battle/buff_template_data.json).

| Consumer | Rule and reference |
|---|---|
| Defense/counters | Each held effect owns its injury filter, priority and lifetime. Enemy-source filters inspect actual source, not credit or counter/reflect tags. Ordinary reflection observers may run after cancellation; success-only effects may not. Template examples: `inverse_damage`, `bubble_s_2`, `judge_t_2`, `hsgma2_s_1`. |
| Profession healing | Musha uses source output; reaper output admits up to block count in a 0.05 s window and delivers heals at 0.12 s intervals. Incantationmedic uses successful HP damage amount, not actual HP removed; HP loss and gauge intake do not qualify. Templates: `helage_trait`, `excu2_trait[heal_fake]/[heal]`, `vendla_tr/reed2_tr/titi_tr`. |
| [纯烬艾雅法拉](https://prts.wiki/w/纯烬艾雅法拉) S2 | Reapplication from one source resets its shared elemental pool and duration; different sources keep independent pools. Absorption has priority −2000. |
| [浊心斯卡蒂](https://prts.wiki/w/浊心斯卡蒂) S1 | Priority −2000; reserve a share after the patient's barriers, then apply HP loss to Skadi. Ordinary HP loss cannot be transferred again. |
| [锡人](https://prts.wiki/w/锡人) | Cached ATK produces source-less, precomputed BUFF arts damage with independent statistical credit and ordinary dodge. The talent uses its authored injury type/position and strongest applicable source. Templates: `tinman_t_2`, `tinman_s_1[dot]`, `tinman_s_2[buff]`. |
| [逻各斯](https://prts.wiki/w/逻各斯) | Source calculation, target arts addition and successful arts-damage riders use separate stages; HP loss does not generate the damage rider. S1 checks execution death before the talent and inherited-HP follow-up. Templates: `logos_t_2/core`, `logos_s_1`. |
| [娜仁图亚](https://prts.wiki/w/娜仁图亚) | Attribute theft follows calculation but precedes target injury; it does not recalculate this instance's already computed base damage. |
| Lord additions | Use each operator's template inputs and eligibility; precomputed ADDITION skips the source calculation event, retains target calculation and DEF/RES, and remains distinct from attack behavior. No profession-wide guess replaces per-template filters. |
| [棘刺](https://prts.wiki/w/棘刺) | Fixed BUFF poison is precomputed and ordinarily dodgeable; S2 filters native type and counters after 0.5 s; Delta derives gauge intake from source output. |
| [仇白](https://prts.wiki/w/仇白) | Check control after the authored 0.1 s delay, then issue precomputed ADDITION; first-hit marks are deployment-local. |
| Weakness selection | The 混乱 trait (`garrisons/battle.js weaknessType`): at each source calculation of phys / arts damage (not precomputed or source-less damage), compare the theoretical phys and arts damage from attack input/scales, the target's arts input addition, penetration and DEF/RES only — no damage multiplier or injury effect, no speculative event; near-equal keeps the type. 双模机械臂, 以己之长 and 赤刃明霄陈 still decide in `hit` with the mitigation-only comparison (`items/battle.js weaknessRetype`). Sources: [术语释义 弱点伤害](https://prts.wiki/w/术语释义), [下半盟约记录](https://prts.wiki/w/卫戍协议：盟约_下半/PRTS盟约记录) (混乱 备注). |
| [“碎铳之簧”](https://prts.wiki/w/“碎铳之簧”) | Ordered barriers/count shields; permanently unblockable, including after shield loss. The arts variant's physical counter filters NORMAL and issues source-less ADDITION. Each variant uses its modifier-application/injury filter; ordinary healing and elemental modifiers may qualify, HP loss/regen/restoration do not. Select the highest-hatred gun; apply erosion only after successful counter damage. Templates: `actrpa/b/c_t_1`, `actrpa/b/c_passive`. |

[ASSUMED] Mode hit-limit placement, Stead/barrier order and mixed parallel sharing, initial acquisition/reapplication
ties, some inherited cancellation masks, literal-zero dispatch, exact 30 Hz deadlines and projectile sampling remain
qualified in code. Template filters and delays do not prove every client frame; Skadi's sourced split rule does not
establish the native algorithm for combining it with Stead. Regression tests under `test/sim/attack-*.test.js` and
`test/content/` specify the implemented edge cases.

Enemy skill turns (§35.54): after a cast the engine's attack cooldown is max(attack interval, skill clip), counted
from the cast, so a longer clip holds the next strike [ASSUMED: the ability occupies the unit]. “自在”'s two 破桎而出
need an attack target (`own: false`); skills with their own selectors may take a ready turn without a swing, subject
to the normal attack's 恐惧 / 缴械 / blocked 战栗 refusals. 管 / 弦 and “萨米的意志”'s custom attack loops hold
until the cast clip ends too. `attackTurnSkill` returns the selected ability or null.

瑕光 S3 先贤化身 is a sourced guardian exception (§35.91, #789): DEFAULT activates with an attackable enemy in her
attack range, even at full HP. The official TAKE_DAMAGE row remains rawRule for provenance. The maintainer accepted
the author video BV1UdAHzNEVj and their recall on 2026-10-24; other guardian skills keep their class rule.
