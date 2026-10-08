# 13 · 推拉（击退 / 拖拽）的官方实现：冲量 + 摩擦

这份文档回答两个问题：**官方推拉到底怎么动**，以及**摩擦是谁的参数**。结论全部来自官方客户端本体的
`global-metadata.dat`（il2cpp 元数据）、官方 gamedata（社区镜像 Kengxxiao/ArknightsGameData）与官方 AB 资源包，
并附上每一步的验证方式，便于复核。

## 0. 结论速览

| 问题 | 答案 |
|---|---|
| 官方怎么动 | **冲量 + 摩擦**：给被推者一个力（`m_force` / `m_forceVectorX/Y`），速度**逐帧被摩擦衰减**直到停下 |
| 有固定时长/距离吗 | **没有**：数据里不存在 `move_duration` / `move_distance` / `move_tiles` 键（`moveDuration`、`moveTiles` 属于 UI 类）⇒ 位移量是**涌现**的，这也是社区只能给出"**推力-位移近似对应表**"的原因 |
| "力度"从哪来 | **官方数据**：`skill_table.json` 的 blackboard `force`（41 个技能带它），敌人侧在 `enemy_database.json`（8 条） |
| 摩擦是谁的参数 | **地板（地形）+ 单位质量**，**不是**技能参数：`GrasslandType { NORMAL_LAND, ICE_LAND, SLIME_LAND }`，每格是一条 `GrasslandData { modeIdx, grasslandType, additionalFriction }`，运行时还会被 `UpdateFrictionFactor` / `RestoreFrictionFactor` 临时改写 |
| 卫戍协议里有几种地板 | **实际只有普通地面**：11 张地图共 18 种格子字符，无冰面/黏液 ⇒ 本模式下摩擦恒定，滑行时长**不必按地板分档** |
| 飞行目标怎么算 | **没有独立的空中摩擦**（`boatAirFactor` / `m_airBase` 属于"船"玩法）：飞行用的是**同一套**公式（单位摩擦 × 所在格子的 `additionalFriction`）；差别只在**运动模式**（`ENEMY_MOTION_TYPE_FLY`、`HEIGHT_CHANGED_TO_FLY_BLOCK_MOTION_MODE` ⇒ 忽略地面阻挡），以及**失衡免疫 / 静态刚体**的空中单位根本不可位移 |
| 曲线形状 | 恒定减速 ⇒ `d/D = 2k − k²`（ease-out quad）、`T ∝ √D` |

## 1. 官方类与字段（`global-metadata.dat`）

推拉能力的类簇（与 PRTS 的"推与拉"术语逐字对应）：

```
Knockback · KnockBackWithDirection · KnockBackWithCharacterDirection · KnockBackTargetsByRootTile · DragTowardSource
_decreaseForceLevelWhenNotInDirection（PRTS"特殊修正"−2 力度）· _dontChangeFaceByDirection · _GetPushDir
TOO_CLOSE_TOLERANCE_SQR（PRTS"< 0.25 格转径向"）
```

运动学字段（同一批类里）：

```
m_force · m_forceVectorX/Y · forceScale · m_mass · m_velocity · get_mass · get_rigidbody2D
m_friction · m_frictionBase · m_frictionFactor · get_frictionFactor · m_frictionFactorAdditional · get_additionalFriction
UpdateFrictionFactor · RestoreFrictionFactor · _UpdateFrictionFactorAdditional · RestoreCached…
_ApplyForce · _UpdateVelocityAndPos · _UpdateAllUnitDeltaPos · _GetForceByDirectionAndDamage
m_bounceFrictionFactor · bounce · bounceease · _bounceTimesAsDamageTimes · _bounceBBKey · _bounceConditionValidator
unbalanceProtectDueTime
```

⇒ `m_force*`（冲量）+ `m_velocity` / `_UpdateVelocityAndPos`（逐帧速度积分）+ `m_friction*`（衰减）就是"冲量 + 摩擦"；
`UpdateFrictionFactor` / `RestoreFrictionFactor`（改完还要还原）说明摩擦**由外部临时提供**，不是能力自带。

## 2. 地板（地形）摩擦

地板系统就在**卫戍协议自己的格子类**里（同簇可见 `TileState { SHARED, MY_SIDE, MATE_SIDE }`、
`CooperateStartTile` / `CooperateEndTile` / `CoopFootballTile`、`get_modeIndex` / `get_tilePlayerSide` /
`_OnPlayerDying` / `_OnPlayerRevive`）：

```
_grasslandDatas · GrasslandType { NORMAL_LAND, ICE_LAND, SLIME_LAND } · GrasslandData { modeIdx, grasslandType, additionalFriction }
DynamicBuffQuickSandTile（流沙）· DynamicBuffTile · DirectionTile（带方向的格子）
```

⇒ 每格可带 `additionalFriction`，即"**地板提供摩擦**"。另有冰面相关因子（`iceFactor`、`iceTile`、`OnIce`、`Frozen`）
与"船/水/空"那套（`m_boatFrictionFactor`、`m_boatAirFactor`、`m_airBase`、`m_waterFlowForce*` —— 属于多索雷斯船玩法，
**不是**飞行单位）。

### 卫戍协议实际用到哪些地板

`docs/research/05-maps.json`（11 张地图）里出现过的全部格子字符：

```
# ×1776（墙/虚空）  r ×580（道路）  X ×477（分区隔断）  f ×448（地面）  a ×330  b ×250  A ×165
p ×77（预览栏）  d ×76（装置）  S ×66（起点）  I / E ×33（路线起/终）  h ×24（手牌栏）  O ×22  m ×12  i ×8  g ×8  R ×4
```

**没有冰面或黏液** ⇒ 本模式下所有可站地板摩擦一致。

## 3. 力度来自官方数据（不是我们拟定的）

`excel/skill_table.json` 的 blackboard 里 **`force` 出现 357 次、41 个技能**，例如：

| 技能 | 名称 | 力度（按等级） |
|---|---|---|
| `skchr_weedy_1` / `_3` | 温蒂 炮管敲击 / 液氮大炮 | 0,1,2 / 1,2,3 |
| `skchr_forcer_1` / `_2` | 见行者 护身射击 / 惊爆射击 | 0,1,2 / 1,2,3 |
| `skchr_panda_1` / `_2` | 食铁兽 铁意六合 / 崩拳式 | 0,1,2 / 1,2,3 |
| `skchr_rope_1` / `_2` | 崖心 勾爪发射 / 复式勾爪 | 0,1,2 / 0,1,2 |
| `skchr_glady_1` / `_3` | 歌蕾蒂娅 缺水的大洋裂断 / 缺水的碎漩狂舞 | 0,1,2 / 0,1,2 |
| `skchr_sqrrel_1` / `_2` | 阿消 水蒸气泵 / 高压水炮 | 0,1,2 / 0,1,2 |
| `skchr_moeshd_2` | 可颂 磁爆锤 | 1,2,3 |
| `sktok_archook` | 钩索 token 发射 | **11** |

同一张表里 **没有** `friction` / `mass` / `knockback` 键 ⇒ **力度是数据（可查表），摩擦与质量在引擎里**。

### 靠"职业"就能推拉的干员

`character_table.json` 的 `subProfessionId` 有两个专门职业，**普通攻击**即推/拉，力不在技能 blackboard 里：

- **`pusher`（推击手）**：阿消 · 见行者 · 食铁兽 · 温蒂
- **`hookmaster`（钩索师）**：暗索 · 歌蕾蒂娅 · 杏仁 · 雪雉 · 崖心

其余靠技能/天赋推拉的还有：Misery、灰烬、黑键、燧石、溯光星源、可颂、焰狐龙梓兰、傀影、莱伊、罗宾、圣聆初雪、
琳琅诗怀雅、乌尔比安，以及 `勾爪` / `暴风雪` / `喷拒器` / `猎潮的骑士` / `流形` / `weedy_token` 等 token 与装置。

## 4. 顺带查清的两条官方机制（尚未建模）

- **撞墙弹跳**：`bounce` / `bounceease` / `m_bounceFrictionFactor` / `_bounceBBKey`，并且 **`_bounceTimesAsDamageTimes`
  —— 弹跳次数计入伤害次数**（温蒂 / 推击手那类撞墙伤害的官方口径）。
- **失衡保护**：`unbalanceProtectDueTime` —— 连续推拉之间有保护窗口。

### 4.1 推完的「停一下不动」= 失衡硬直（**0.1 s，官方文档明载**）

玩家确认：官方把敌人推/拉完之后，它会**站住不动一小会儿**再继续走。官方状态机是互斥的 ——
**UNBALANCE（失衡）→ DEFAULT → MOVE** —— 所以位移会**结束**它当时站着的攻击姿势
（sim 自己的注释："失衡 ends the attack clip it stood for"）。

**数值有官方文档**：PRTS《失衡位移机制》（参考客户端 2.7.61，最后更新 2026-08-06）原文 ——

> 单位进入失衡（`UNBALANCE`）状态机时：激活刚体，进行相关的物理运算… **立刻拥有 0.1 s 的「失衡硬直」**
> ——此期间无法解除失衡状态机，哪怕已经没有被移动或者受力。
>
> 失衡状态机会在单位发生以下这些情况中的任一时结束：该单位陷入浮空状态；**该单位速度 ≤ 0.1 m/s，且不处于
> 「失衡硬直」期间**；该单位被强制切换至其他状态机（例如复活、触发技能）。
>
> 失衡状态机正常结束后：刚体将被停用…；清除所有正在拉动自己的「拖拽弹道」；**清除运动速度（归零）**。

⇒ 本作的 `constants.js UNBALANCE_STAGGER = 0.1` **就是官方值**（不再标 `[ASSUMED]`）。

实现：`displacement.js` 位移后写 `e.unbalanceUntil = now + 0.1`，`ai.js` 的走路判据与攻击判据都读它
⇒ 硬直期间既不走路也不攻击（对应官方状态的互斥）。「清除拖拽弹道」「停用刚体」在本作没有对应物；
官方的「速度归零」等价于我们清路线后重新出发。

### 4.1.1 官方的物理模型（同页给出，可直接推导时长与形状）

> 所有的敌人被视为质量为 **1 kg** 的胶囊形状刚体；每个方格的边长为 **1 m**；重力加速度 **g = 9.81 m/s²**；
> 平面的动摩擦因数 **μ = 0.5**。（并注明"明日方舟使用了 Unity 引擎的默认运动效果…可参考经典物理学模型"）

⇒ 恒定减速 `a = μg = 4.905 m/s²`、`v(T) = 0` ⇒ **`T = √(2D/a) = 0.6387·√D` 游戏秒**
（战斗按 2× 真实时间推进）⇒ **`0.3194·√D` 真实秒** —— 这正是客户端 `DISPLACE_SLIDE` 的取值来源，
同时**证实了形状**：恒定减速（ease-out quad）+ `T ∝ √D`。

> 这也再次印证：**摩擦是引擎级的全局参数**（μ = 0.5 是平面属性），不是每个技能的数据 —— 与本文件 §2 一致。
> 同页「动摩擦计算 / 碰撞、停止 / 转弯」三节标注**待补充** ⇒ 撞墙弹跳与"转弯"目前**没有**官方文档口径。

### 4.2 位移**不会**改变朝向

`_dontChangeFaceByDirection` 是**部分能力主动选择「不转向」**用的开关，**不是**位移会转向 —— 官方被推拉的敌人
**保持原朝向**（玩家指正，本 PR 早期一版做错过）。所以客户端的滑行**不得**替它转向：
`render/units.js` 的 `slideTo` 与 `update` 都不碰 `visFacing`，朝向照旧来自快照的 `vx`，
`test/render/unitview.test.js` 有一条测试钉住这点。

## 5. 客户端的做法（本次实现）

`render/units.js`：模拟位移是**瞬时**的（`sim/battle/displacement.js` 在一次调用里走完 0.1 格步进），快照只带终点，
所以客户端补上中间帧——`UnitView.slideTo(x, y, { friction })` 建立一次滑行，`update()` **逐帧做速度积分**
（`v ← max(0, v − a·dt)`、`d ← d + v·dt`），终点由模拟给出（**权威**），`v0 = 2D/T`、`a = v0/T` 保证
`T` 秒内正好走完 `D` 且速度归零 —— 即官方"冲量 + 摩擦"的等效形式；`T = 0.14·√D`（夹 0.12–0.45 s），
`friction` 是**地板因子**（本模式恒为 1；将来有冰面就乘 < 1 ⇒ 滑得更久）。
`render/app.js` 用 `displace` fx 触发它。**模拟层、协议、golden 一律未改。**

死亡保护：滑行途中死亡 / 倒地会**取消滑行并回到出发格**（尸体不移动，更不会穿过地形）。

## 6. 复核方式

1. 元数据：`node` 读 `global-metadata.dat`，搜上列标识符（本文件所有类名/字段名都是这样得到的）。
2. 力度表：`zh_CN/gamedata/excel/skill_table.json` → 各技能的 `levels[].blackboard` 里 `key === 'force'`；
   敌人侧 `levels/enemydata/enemy_database.json`。
3. 职业：`excel/character_table.json` 的 `subProfessionId ∈ {pusher, hookmaster}`。
4. 地板：`docs/research/05-maps.json` 的格子字符统计（本文件 §2）。

## 7. 附：官方 AB 资源包的读取要点（踩过的坑）

供以后要读官方战斗配置时参考（本次为定位"摩擦是不是数据"而打通）：

- `Flags` 里的 `0x200`（`UsesAssetBundleEncryption`）在本客户端上是**虚设**：blocksInfo 既没有 70 字节加密前导，
  也不需要任何 16 字节 key（暴力扫 `global-metadata.dat` 144 万候选、`GameAssembly.dll` 5 万候选均无命中即因此）。
- blocksInfo 位置 = `align16(headerEnd)`；**块数据是连续存储**的（不要逐块对齐）。
- 压缩：`comp 3` = 普通 LZ4 ✓；`comp 4 / 5` = Arknights 自定义 LZ4AK（nibble 交换后按 LZ4 解，
  终止条件是 `op === uncompressedSize`，**严格相等**）。
- 包内官方配置是**带 `$type` 的 JSON**（如 `Torappu.Battle.Action.Nodes+SetBodyDirection`），
  内嵌类型树 ⇒ 字段名可直接读；但**摩擦不在其中**（本文档 §2 已说明原因）。
