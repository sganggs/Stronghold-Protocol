# 15 · 水面：官方的水位、按格查询与"水下单位"是怎么做的

参考客户端 2.7.61；证据来自 `global-metadata.dat` 的标识符、社区 gamedata 的关卡 JSON，以及无头浏览器实拍对比。
结论按"官方怎么做 / 数据里有什么 / 我们怎么对应"三栏写。

## 1 官方：水是一个场景平面，不是一个格子属性

| 官方标识符 | 说明了什么 |
|---|---|
| `_HGWaterSurfaceZ` / `get_currentWaterHeight` / `currentWaterHeight` | 水面有**自己的高度**，是**场景级**的值（运行时给出），不是格子数据 |
| `HGWater_HGWaterDepthTex_HGWaterReflTex_HGWaterSurfaceZ_` | 水面着色器带**深度贴图 / 反射贴图 / 水面高度**三样：水下物体是按水面**平面**比较 Z 来染色的 |
| `CheckTileIsWaterField` / `GetTileWater` / `GetWaterMode` | 同时提供**按格查询**（是不是水、水是什么模式） |
| `CheckWaterEffectAffecting` / `AdjustWaterMat` / `_showWaterEffectValue` | 对**水下单位**施加的是**材质级**水效果 —— 改它自己的材质，**不是**拿水面去盖 |
| 着色器参数 `CustomWaterAlpha` / `Cyan` / `NoiseTime` / `Darkness` | 那层效果的可调项：水量、青色、随时间动的噪声、暗度 |
| `AddWaterRippleMask` | 涟漪是有的（掩码式） |
| `CreateWaterObjects` / `HGSceneWaterEffect` / `HGSceneTileWaterEffect` / `GetSceneWaterAnimator` | 场景级水对象与动画器 |
| `_COOPERATE_RAFT_WATER_FLOW_*` | 联机木筏的水流（与本模式无关） |

**所以官方的"水里单位"观感 = 单位材质被水色压低 + 水面平面在它前面**，而不是把单位裁掉、也不是拿一块贴片盖上去。

## 2 数据里有什么（很有限）

- 关卡 JSON（`levels/activities/act1autochess/level_*.json`，如 m05）的 `mapData.tiles[]` 字段只有：
  `tileKey` / **`heightType`** / `buildableType` / `passableMask` / `playerSideMask` / `blackboard` / `effects`；
- `heightType` 的取值只有 **`HIGHLAND` / `LOWLAND`** —— **没有水**，也**没有水深/水面高度**；
- 水是某种 `tileKey`（本作图集里 `tile_deepsea → 'd'`），宫格表里 m05 有 64 格 `tile_deepsea`。

⇒ **水深与水面高度都不在 gamedata 里**，只能来自场景资源（本仓库没解析那部分），或按观感给定。

## 3 本作怎么对应

| 官方 | 本作 | 位置 |
|---|---|---|
| 水面高度（场景平面） | `WATER_SURFACE_Z`（相对地面；3D 板的水面网格直接用它） | `tiles.js` → `board3d/scene.js` |
| 水底（盆地深度） | `WATER_DEPTH`（水格的地形高度取 `-WATER_DEPTH`；3D 的 `BASIN` 引用它，两层高度一致，有测试盯着） | `tiles.js` → `board3d/layout.js` |
| 按格查水 | `tiles.waterAt(r, c)`（与 `tile` / `heightAt` / `levels` 并列的网格查询） | `tiles.js` |
| 水下单位被水色压低（材质级） | 该单位**自身 tint** 上做正片叠底：`mixTint(tint, mulTint(tint, WATER_DEEP_TINT), WATER_DEEP_MIX)`，只影响模型像素 | `units.js` |
| 涟漪（`AddWaterRippleMask`） | **未做** | — |
| 场景水动画器 | 使用本作地形层自己的水面精灵（`_buildAnim` 的 `sea`） | `tiles.js` |

- 水系地形规则：`groundZ` 允许**负高度**（凹陷是有效地形）；**地面敌人**取 `min(0, floor)` —— 既不会被高台抬起
  （既有规则，GitHub #277），又会跟随水格下沉；**飞行单位**按路面（高台不抬升、凹陷也不下沉）；**干员**站在格子
  给出的面上；水上平台（`trap_040_canoe`）的 `devH` 加上 `WATER_DEPTH`，使它浮在水面而不是沉在坑底。
- 盆壁配色：3D 层水格侧面原为 `graySide` + 浅灰 tint，观感像一块突兀的灰板；现改为深蓝灰 `[0.16, 0.22, 0.26]`。

## 4 未做：地面遮挡（"水里的单位被前方地板挡住"）

官方那种"被地板挡住"来自**水面/地板都在同一个 3D 场景里**，深度关系天然成立。本作的单位是叠在 three.js
画布**之上**的 Pixi 精灵，因此：

- three.js 的地板**结构上不可能**遮住 Pixi 单位（无论怎么排渲染顺序）；
- 在 Pixi 里重画前方地板会用到**另一套图集**，与 3D 地板不是同一套美术，做不到无缝；
- 用裁剪（把被挡住的像素不画）在 2D 板里可行且无缝，但在 3D 板里"前方地板"的搜索方向/覆盖关系需要逐图核对，
  且投影用的是覆盖格自己的边缘行（水面内部的近邻同样是水，覆盖它的地板在更前面几格）。

⇒ 2026-08 按玩家决定**整段撤回**，留待后续；真要做的前提是**把单位渲进 3D 场景**（另一个量级的工作）。
