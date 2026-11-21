# 盐坨子炮：载客炮弹与落地续路

基线 dev bb117230 已有炮台创建、主关卡数值及周期：60000 HP、900 ATK、18 秒，默认嘲讽 −1。
本次修正的是开炮时立即爆炸／传送，以及缺少载客、释放路线和 1 HP 销毁流程。

## 来源

- [PRTS 盐坨子炮](https://prts.wiki/w/盐坨子炮)：敌方默认实体、载客、落地物理溅射、1 HP 销毁及免疫。
- [PRTS 寻险水手](https://prts.wiki/w/寻险水手)：卸载后 1 秒移动速度提升至 200%。
- 官方表固定 [6f63c14e 的 MAP10](https://github.com/Kengxxiao/ArknightsGameData/blob/6f63c14e27b847ef74b53b00fe51fc322b3cd7ff/zh_CN/gamedata/levels/activities/act3autochess/level_act3autochess_m10.json)，
  以及同版 sub_02／sub_03 的装置、extraRoutes；主关卡 rune 保留原有最终数值。
- 用户安装的 PC 客户端热更新 26-11-06-12-42-25-70182449：`pkgrps/btl_pfb_tokens_2.ab` 的
  `trap_196_cnnon`、`projectile_trap_cnnon_small` 与 buff_template_holder。

原版 Eat 选择器半径 1.0，加敌人碰撞半径 0.1 后按 1.1 匹配；最多 1 人、地面、重量 ≤3。炮弹速度 5，落地按 `_rangeId x-4` 的 3×3 格判断，物理溅射可对空、
忽略迷彩；选中仍尊重隐匿与不可选中。释放区域为落点 ±0.2 方形，释放后 0.1 秒免再次装载。
`_clearProjectileWhenDead=0`，已发炮弹不会随炮台消失。普通炮弹只有 `_ev 1` 的 DurBusAbilityReleasePassenger，乘客由炮本身的 Eat 持有；
只有 `*_death` 最终炮弹含 `_ev 4` 的 DurBusAbilityKillPassengers。清除最终炮弹才击杀乘客。
[ASSUMED] 普通炮弹被清除后，乘客继续留在炮内，随下一发出去。

本机官服录像 `01 盐坨子炮.mp4` 为约 2.965 秒／30 fps 的普通战场片段，能观察到发射、飞行与落地。
录像未明确倍速，不用它反推游戏秒、周期或多个合格乘客的选择顺序。

## 数据与运行时

生成器保持 `role:cannon`，为装置补充 cannon 的等级、距离、SP、原 branchId 和已解析的落地路线。
子场景共享的 branch placeholder 索引不能直接索引本地 extraRoutes，按装置落点找到对应路线后随坐标一起平移。
[ASSUMED] 主关卡对 prefab key 的 rune 计算一次；平行 alias 选择器视为同一修正，不重复应用。已有 stage.runes 保留。

炮台为 enemy-side 的 device，供干员正常索敌；它不是波次敌人，不占总量、击杀或漏怪计数，不阻碍清场。
固定装置留在隔断原格；战斗不对其执行敌人行走或道路边界夹取。测试仍检查它没有离开合法原格。

乘客保留原单位、HP、归属、悬赏和增益，装载时进入消失状态。炮弹落地才结算伤害、取消消失，并把乘客切换
到该装置的 extraRoute；寻险水手从此时获得原黑板给出的移动倍率和持续时间。

首次致命伤害留 1 HP。之后受伤时，空炮死亡；有乘客则额外发射一次、不可选中且停止正常装载／充能，
等最终炮弹结束后死亡；空炮由自身 InstantKill 结算，不归因于攻击干员。嵯峨的重伤直接附加路径尊重目标的 dying 免疫。

[ASSUMED] 多个合格乘客同时进入时按稳定生成顺序选择；沉睡的敌人沿通用 canTargetEnemy 排除；释放时清除失衡。飞行时长沿固定点弹道的棋盘距离／速度，原生炮口挂点
与飞行弧线的精确时序交由后续表现校准；这里不从单次录像推断精确帧数。

## 验证

定向回归覆盖准备／实战数值、四种战场、装载筛选、飞行前后伤害、释放路线／随机边界、弹道清除、残血销毁、
寻险水手、嵯峨、正常干员索敌、固定位置及清场／超时。原 regulation-g4 测试按“落地才造成伤害”更新旧瞬移断言。
完整本机模拟及 golden 按用户安排暂停，完整 CI／golden 交主线 Actions；没有用旧黄金替代新组合。

渲染等待首个快照时保持单位、影子和命中区域透明，修正出生后立刻装载的乘客仍显示在炮身处；落地快照到达后正常恢复，准备单位不受影响。
