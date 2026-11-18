# MapEffect 与有限粒子的独立生命周期

官方客户端 `battle/prefabs/effects/map.ab` 的 `map_promote_01` 根为 MapEffect；四片静态 Quad 使用 `map_promote_04` 滚动材质，`_MainUSpeed=0.5`。附带的非循环粒子系统持续 2 秒，粒子渲染器禁用，并不代表静态网格应在两秒后消失。

原 compileEffect 不识别 MapEffect，播放完有限粒子后回收整个实例。现在识别启用的 MapEffect，由地图持有至 stop／kill／clear；粒子照常结束，材质时间连续，不反复重播或按 effect ID 特判。保留结束延迟、最大时长、销毁、池复用和普通特效完成规则。

本 PR 仅修复通用播放器，不新增地图地块声明或第二套地形特效管理器，不复制本服 TerrainFx，也不与主线 syncGrassFx 重复播放。源石／沼泽等新地形接入属于后续地图系列；开发特效查看器可用真实 map_promote_01 独立复现和截图。

这是客户端字段确定的生命周期语义，不改变 shader、深度或模拟规则，不提交提取出的游戏资源。
