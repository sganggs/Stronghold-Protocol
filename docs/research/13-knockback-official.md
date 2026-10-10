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
| 曲线形状 | 恒定减速 ⇒ `d/D = 2k − k²`（ease-out quad） |
| 推多久 / 拉多久 | **失衡（UNBALANCE）状态机**的时长（0.2.2，PR #392 的思路、按来源重做）：推 = PRTS 游戏数据基础「推力-位移近似对应表」的**位移时间**（受力等级 −2/−1/0/1/2/≥3 → 0.2 / 0.4 / 0.8 / 0.9 / 32⁄30 / 35⁄30 游戏秒，正好是 30 fps 的整帧）；拉 = 推与拉的**拉力作用时间**（1 s，受力等级 < −1 时 0.5 s，急停后仍保持到结束）；静态刚体受力 > 0 时 0.1 s 保底。客户端滑行用同一段游戏时间（默认 2 倍速 ⇒ 现实时间减半）；`T = 0.14·√D` 只留作旧录像（fx 不带 `dur`）的回退 [ASSUMED] |

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

## 5. 客户端的做法（本次实现）

`render/units.js`：模拟位移是**瞬时**的（`sim/battle/displacement.js` 在一次调用里走完 0.1 格步进），随后敌人处于
**失衡状态**（0.2.2：不走路、不发动普通攻击，时长见 §0「推多久 / 拉多久」），快照只带终点，
所以客户端补上中间帧——`UnitView.slideTo(x, y, { dur, friction })` 建立一次滑行，`update()` **逐帧做速度积分**
（`v ← max(0, v − a·dt)`、`d ← d + v·dt`），终点由模拟给出（**权威**），`v0 = 2D/T`、`a = v0/T` 保证
`T` 秒内正好走完 `D` 且速度归零 —— 即官方"冲量 + 摩擦"的等效形式；`T` = `displace` fx 带来的失衡时长 `dur`（游戏秒）÷
播放倍率（`ctx.animRate`，默认 2 ⇒ 受力等级 0 的推 0.8 游戏秒 = 0.4 现实秒），滑行结束时模拟的失衡也正好结束；fx 不带
`dur`（0.2.2 以前的录像）时才回退到 `T = 0.14·√D`（夹 0.12–0.45 s）[ASSUMED]。`friction` 是**地板因子**（本模式恒为 1；将来有冰面就乘
< 1 ⇒ 滑得更久）。PR #392 的 `0.6387·√格` / `0.3194` 是用 PRTS 页面的「μ = 0.5 单位假设」推出来的，页面没有写出、也对不上
位移时间表（每档高约一帧），未采用。`render/app.js` 在插值器开始显示「以带终点的快照结尾」的那一段时就用 `displace` fx 启动滑行：
到达那张快照之前画面停在原处，之后从原处减速滑入模拟的实时位置（终点，以及敌人随后继续走的路），落地不跳。
（PR #380 的渲染方案由 0.2.2 的 `2669b6a` 移植，并非该 PR 直接合入；当时模拟层、协议、golden 未改。
0.2.2 的失衡状态另改了模拟层，`displace` fx 多带一个 `dur`。）

推击模型朝向的原版对照有两类：[野鬃 S2 原版约 1:29](https://b23.tv/jMhl7xx) 的
[关键片段](https://github.com/user-attachments/assets/28acc81e-7ade-4245-b4d8-70be52546257) 显示方向推击时“火与钢”继续面朝原方向，
[复刻录屏](https://github.com/user-attachments/assets/7383bdb8-3974-47f2-b5b3-303af609cd4d) 显示其滑行时翻转（#418）；
[莫斯提马 S3 原版 p2 约 34:33](https://b23.tv/EguihiI) 的用户截取片段在相邻帧中显示，持斧敌人受径向击退并向右滑时仍保持原来的模型朝向。
PRTS「推与拉」把推力分为方向力和径向力；官方 `knockback[dir]` / `knockback[relative]` 均使用 `Knockback` 动作类。
拖拽有不同实现：[薄绿 S2 原版约 4:26](https://b23.tv/v5QQ6uv) 对应 PRTS「推与拉」所称的反向径向推击，
本项目用 `Battle.push({ inward: true })`；[歌蕾蒂娅 S1/S2 原版录像](https://b23.tv/YLYYSPJ) 展示钩索拖拽，
本项目走 `Battle.pullToFront` → `Battle.pull`。用户截取的两段视频直接展示被拖拽目标在动作前后没有转身，
作为这些实例的画面证据。歌蕾蒂娅片段的目标原本就面朝拖拽方向，因此这段画面无法单独区分
「始终保持原朝向」和「始终面朝拖拽方向」两种全局规则；将所见外推到反向拉拽属于推断。
官方客户端模板的 `DragTowardSource` 动作节点没有显式朝向参数，但这一点也不能排除引擎内部的转向处理。

因此 `Battle.push` 与 `Battle.pull` 默认在 `displace` fx 带 `keepFacing`，从等待终点快照到滑行结束保留原朝向。
其他未录制的推击来源及朝向与拉拽方向相反的拉力来源均属 **[ASSUMED]**，技能描述中的「推开」「击退」「拖拽」本身
没有规定模型朝向。`KnockBackWithCharacterDirection` 另有 `_dontChangeFaceByDirection` true / false，
若当前或未来技能明确要求转向，调用方可设置 `keepFacing: false`。直接 `displace` 的朝向逻辑不变；
位移位置与失衡时间也不变。

滑行途中死亡：滑行照常走完，尸体停在被推到的位置（模拟里它已经在那里；0.2.2 合入时改掉了原 PR 的「回到出发格」）；
倒地的单位交给 `setDown` 放到它的格子上。

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
