# 全部 Boss 受击区域核对（2026-11-12）

## 结论与修复

对五个已收录规则版本的全部 `rank=BOSS` 记录取并集：41 个敌人 ID、39 个 prefab。
所有实际波次中 `tag=boss` 的首领也包含在这个集合内；另纳入悬赏／普通波次 Boss 及召唤的后兽。
以本机官方 Windows 客户端 `26-11-06-12-42-25-70182449` 的实际根碰撞体逐个核对：

| 遗漏记录 | 官方 size / offset | 修复后的格子覆盖（整数站位） |
|---|---|---|
| 假想敌：械 `enemy_9029_acfnc` | `(4.95,2.95)` / `(0,1)` | 5×3，向上偏移一格 |
| 假想敌：械·隐秘核心 `enemy_9029_acfnc_2` | `(4.95,2.95)` / `(0,1)` | 5×3，向上偏移一格 |
| 后兽 `enemy_2123_dyjsww` | `(2.95,2.95)` / `(0,0)` | 以自身为中心的 3×3 |

全部 11 个矩形 prefab 中，补入茧两形态后已有 8 个正确，以上 3 个仍在 `HIT_AREAS` 中遗漏；其余 28 个为半径 0.1 的普通圆形判定。
三处仅存在于三期数据。后兽由矩兽的 `kitBeast.spawn` 召唤，虽不直接列入波次，确实参与战斗。
矩兽本身、假想敌：鳍（两形态）、假想敌：铳和卢西恩仍是普通圆形，不能根据模型大小扩大。

本次在生成器按 prefab 补齐三条，再用固定表离线生成；实际安装的 `enemies.json` 仅新增三个 `hitArea`。
其它输出逐文件比对不变。服务端生成实例、空间索引、格子命中、半径查询、客户端受击格预览复用既有逻辑。
不改攻击范围、攻击起点、模型位置、移动、阻挡、中心溅射或技能可选性；尤其不因后兽有大受击体而添加 `SELF_BOUND`，它仍可移动。

## 原始证据与复核方法

[字段快照](boss-hit-areas-20261112.json) 保留每个 prefab 的官方版本、bundle SHA-256、根对象／碰撞体 path ID、
坐标变换、原始浮点尺寸、敌人 ID 及所属数据文件。只保存相关字段，不提交游戏二进制。

根 `GameObject` 均为 layer 9；根上启用的 Trigger Collider2D 才是本体受击区域。
`ColliderHolder`（通常 layer 19）用于阻挡／物理碰撞；`Attack`、`Skills` 下的 `Selector` 是攻击／技能选区，均不作为本体范围。
例如械隐秘核心还有一个 2.95×2.95 的 `KillArmorAura`，它不是本体碰撞体。
全部根 scale 为 1、rotation 为单位四元数；根 prefab 的编辑器 position 不叠加到出生坐标。
旧胄、管、管隐秘核心、昆图斯、阿利斯泰尔及萨米的意志同批提取，确认原有坐标轴及偏移约定。

```sh
<UnityPy环境>/bin/python \
  tools/local-extract/enemy_hit_areas.py \
  --game '<客户端安装目录或 AB/Windows>' \
  --out .state/boss-hit-areas.json
```

工具使用 `client_bundles` 根据当前清单选择已安装的热更新／基础包，逐包读取并回收内存；
缺失 prefab、非预期碰撞体或缩放会失败，不用旧包或视觉估算代替。
本次官方字段提取在独立内存限额下串行运行，峰值约 294 MiB，无 OOM。

## 覆盖清单

`w×h; dx,dy` 单位为格；圆形条目均为半径 0.1、偏移 0。

| prefab | 名称 | 根受击体 | bundle |
|---|---|---|---|
| `enemy_1001_bigbo` | 大鲍勃 | 圆形 r=0.1 | `enm_pfb_0.ab` |
| `enemy_1050_lslime` | “庞贝” | 圆形 r=0.1 | `enm_pfb_4.ab` |
| `enemy_1500_skulsr` | 碎骨 | 圆形 r=0.1 | `enm_pfb_base_0.ab` |
| `enemy_1501_demonk` | 萨卡兹百夫长 | 圆形 r=0.1 | `enm_pfb_base_0.ab` |
| `enemy_1502_crowns` | 弑君者 | 圆形 r=0.1 | `enm_pfb_base_0.ab` |
| `enemy_1504_cqbw` | W | 圆形 r=0.1 | `enm_pfb_base_0.ab` |
| `enemy_1509_mousek` | 鼠王 | 圆形 r=0.1 | `enm_pfb_17.ab` |
| `enemy_1511_mdrock` | 泥岩 | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1512_mcmstr` | “巨大的丑东西” | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1513_dekght` | 腐败骑士 | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1513_dekght_2` | 凋零骑士 | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1516_jakill` | 杰斯顿·威廉姆斯 | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1517_xi` | “自在” | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1521_dslily` | 盐风主教昆图斯 | 4.95×2.95; 0.0,1.0 | `enm_pfb_18.ab` |
| `enemy_1525_blkswb` | 锏 | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1535_wlfmster` | 扎罗，“狼之主”  | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_1539_reid` | “复仇者” | 圆形 r=0.1 | `enm_pfb_18.ab` |
| `enemy_2003_rockman` | 迷路的巨像 | 圆形 r=0.1 | `enm_pfb_19.ab` |
| `enemy_2004_balloon` | 喷气人 | 圆形 r=0.1 | `enm_pfb_19.ab` |
| `enemy_2005_axetro` | “遗弃者” | 圆形 r=0.1 | `enm_pfb_19.ab` |
| `enemy_2008_flking` | “墓碑” | 圆形 r=0.1 | `enm_pfb_19.ab` |
| `enemy_2016_csphtm` | 卢西恩，“猩红血钻” | 圆形 r=0.1 | `enm_pfb_19.ab` |
| `enemy_2048_smgrd` | “邪魔的利刃” | 圆形 r=0.1 | `enm_pfb_19.ab` |
| `enemy_2050_smsha` | 陷落雪祀 | 圆形 r=0.1 | `enm_pfb_19.ab` |
| `enemy_2052_smgia` | 纠缠藤蔓 | 圆形 r=0.1 | `enm_pfb_20.ab` |
| `enemy_2123_dyjsww` | 后兽 | 2.95×2.95; 0.0,0.0 | `enm_pfb_27.ab` |
| `enemy_2124_dyjsfg` | 矩兽 | 圆形 r=0.1 | `enm_pfb_28.ab` |
| `enemy_9013_acstmk` | 假想敌：胄 | 4.95×2.95; 0.0,1.0 | `enm_pfb_28.ab` |
| `enemy_9017_achunt` | 假想敌：铳 | 圆形 r=0.1 | `enm_pfb_28.ab` |
| `enemy_9021_acduml` | 假想敌：管 | 4.95×2.95; 0.0,1.0 | `enm_pfb_28.ab` |
| `enemy_9021_acduml_2` | 假想敌：管 | 4.95×2.95; 1.0,1.0 | `enm_pfb_29.ab` |
| `enemy_9029_acfnc` | 假想敌：械 | 4.95×2.95; 0.0,1.0 | `enm_pfb_36.ab` |
| `enemy_9029_acfnc_2` | 假想敌：械 | 4.95×2.95; 0.0,1.0 | `enm_pfb_36.ab` |
| `enemy_9032_aclionk` | 阿利斯泰尔，帝国余晖 | 4.95×2.95; 0.0,1.0 | `enm_pfb_29.ab` |
| `enemy_9033_acdeer` | “萨米的意志” | 4.95×2.95; 0.0,1.0 | `enm_pfb_29.ab` |
| `enemy_9035_acspider` | 假想敌：茧 | 4.95×2.95; 0.0,1.0 | `enm_pfb_37.ab` |
| `enemy_9035_acspider_2` | 假想敌：茧 | 4.95×2.95; 0.0,1.0 | `enm_pfb_37.ab` |
| `enemy_9037_aceel` | 假想敌：鳍 | 圆形 r=0.1 | `enm_pfb_37.ab` |
| `enemy_9037_aceel_2` | 假想敌：鳍 | 圆形 r=0.1 | `enm_pfb_37.ab` |

## 验证边界

最新补丁继续暂缓本机测试与浏览器验证；没有运行新增回归、完整 golden 或截图。
已准备 `test/sim/boss-hit-areas.test.js`：全目录与官方独立快照对比、械两形态及后兽的真实逐格攻击与四侧越界、
半径／索引去重、中心溅射不变、准备预览以及后兽移动时受击矩形随动。
原茧测试中将械列为“无受击矩形”的旧范围断言同步移除。
本 PR 更新到主线 `f8a6619b`；原基线的三期 fields／matches 快照已撤回，保留新主线期望值。
新增受击体及茧的索敌变化可能移动三期 fields／roster／matches 等 golden，尚待重新计算并逐场解释，不能机械合并旧期望值冒充实跑。

这次核对证明的是客户端 prefab 的静态本体受击范围，不宣称已完整验证所有技能阶段动态碰撞体行为，
也不把本体区域大小当作技能范围或命中可选性证据。
