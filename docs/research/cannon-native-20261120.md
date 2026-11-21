# 盐坨子炮原版模型与动画

基于盐坨子炮载客炮弹分支，沿主线 dev bb1172306 的 arena／pieces 场景结构接入。

## 模型与生命周期

原炮架没有 Animator／Animation，MeshRenderer 由 token prefab 的 Graphic/Mesh 持有。
提取器通过当前客户端 container 查找 trap_196_cnnon，读取其 Graphic 子树、原网格／材质／变换；
仅 MAP10 添加 device:trap_196_cnnon 组和 deviceModels 元数据，三块 sub 场景仍保持各自坐标。
输出原生 UP 图形转为关卡 DOWN 朝向的局部模型。运行时按装置格、地块表面高度和方向分别放置，
准备阶段与战斗实体交接所有权。销毁、地图重建、2D／3D 和迟到素材均走同一设备句柄释放流程。

没有素材时保持程序生成的设备和炮弹。旧包可继续加载；要获得新模型须显式重提取 MAP10 场景，
如 `python tools/local-extract/extract.py --only scene/act3autochess_m10`。场景网格格式和提取版本沿用 1／6。

## 动画来源与挂点

本机 PC 热更新 26-11-06-12-42-25-70182449，独立 trap_cnnon_* 共 11 份 prefab。
`trap_cnnon_attack_start` 为 0.233333 秒、11 条曲线的发射动画。绑定 SpecialPoint0／FixedMuzzle，
而非按同名猜测发射挂点。待机、出生、发射、抛物线飞弹、落地及销毁使用 OfficialFx；
TargetEffectManager 经 projectile_cnnon_target_mark 的到达效果指向 trap_cnnon_lockon，作为常驻落点标记。
标记按落点地块高度放置，炮身仍在自身表面高度。落地爆炸只消费模拟的到达事件，避免视觉计时器二次生成。

预加载将 Map iterator 固化为可重用列表，各收集器都能看到炮台；炮台不再同时走通用天赋出生发射器。
准备阶段沿准备帧时钟，战斗沿原战斗快照时钟。关闭／精简切换、2D、场景清理与销毁释放效果；
炮台消失不取消已发飞弹，符合原 _clearProjectileWhenDead=0。

[ASSUMED] 发射动画保存了编辑时位移，把 ball 首姿注册至炮口，并转向实际落点；保留原 clip 的全部关键帧。
此显示适配以及沿用 trapMaterial 的光照近似需要同视角录像继续校准，不称为精确原生挂点或原 shader 执行。
用户提供的 2.965 秒官服《01 盐坨子炮.mp4》可核对普通战场发射／落地及常驻标记。

## 验证记录

定向核验包含时钟、落点高度／方向、素材缺失、单次发射／爆炸、清理、迟到模型、资源释放及三个 arena 视图。
实际 MAP10 输出保留 sub_01／02／03，并新增 1030 三角形的独立模型；11 份 FX 已重新提取，
对既有完整 FX 索引的 units／skills／skins／projectiles／prefabs 比对无变化。

出生后立即装载的乘客沿依赖分支的首快照等待处理，避免图片出现在炮身处；落地快照后恢复显示。

使用真实渲染器与本分支 Battle 帧、受控编队，不作为完整 WS 对局的证明。完整本机模拟／golden 继续暂停。

## 评审补充

既有安装须显式重提取 `scene/act3autochess_m10` 与 `fx`，以获得炮架与挂点／动画；本次增加记录，格式版本保持不变。
模拟命中事件携带实际选中的单位 ID；每个命中单位播放原版 `_effectsWhenHit` 的 `trap_cnnon_explode_hit`，
地面爆炸仍只播放一次。2D 与 3D 均在战斗中隐藏静态炮台，由活的装置实体显示；准备阶段恢复。
