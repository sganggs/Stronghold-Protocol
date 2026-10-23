# 战斗倍速（定制版 0.3.1）

## 使用与兼容

独立的 battle-speed 1.0.0 玩法插件，默认关闭。需要本分支的 battleSpeedControl 核心支持及插件 API 2，不能仅将 ZIP 安装到原版服务器。旧服务器的闭合规则校验会拒绝这个未知规则。插件不含脚本或官方游戏素材。

房主在房间插件中启用“战斗倍速”。正常 / 两倍 / 四倍相对于原版速度，内部模拟时钟为 2 / 4 / 8 倍，固定步长仍为 1/30 秒。支持单人及多人普通作战和联防；最终攻势、隐秘核心、休整不支持。每个战斗阶段从正常档开始。

普通作战需全体仍在场且未淘汰真人同意，包括已经打完自己战场的人；联防只需本次协防真人同意。AI 不投票，仅 AI 不主动加速。只有一个真人时发起即通过。观战和非协防者只读。

所有改速（包括降速和恢复正常）均需全票。发起者自动同意，每次仅一个目标档投票；15 秒真实时间未通过、拒绝、撤回同意或发起者取消均结束投票，速度不变。断线或参与名单变化取消投票，不自动降速；存在断线投票人时不允许新投票。重连读取服务器状态。

与快进联防独立开关。快速结算锁定时取消倍速投票并拒绝新请求；计算失败恢复当前阶段时保留原倍速，成功结束后下一阶段复位。

## 实现与协议

这是服主明确要求的自定义规则，不是官方规则变更。规则 `battleSpeedControl: off | unanimous` 纳入内容哈希。原有 sim 算法、时间限制和结算公式不变。

`g.battleSpeed`：phaseId、revision、action（propose/agree/reject/withdraw/cancel）；propose 另带 target（1/2/4），其他动作带 voteId。身份由连接决定；阶段、修订号、投票 ID、名单和真实截止时间均由服务器校验。拒绝过期重发，不重复切速。投票关闭时 revision 增加。

`m.public.battleSpeed`：当前 multiplier/speed、阶段与修订号、合资格名单、可操作状态、当前投票和最近结果。`b.speed`：battleId、fieldId、phaseId、revision、speed、elapsed、serverNow。重连的 b.start 增加 speedRevision。

切速时服务器先将未处理的墙钟时间按旧速度记入累积器，再重定位字段时钟起点，重排结果截止和释放计时器。客户端保留 Battle 与在途模拟任务，只重定位时间锚点；旧修订消息不覆盖新速度。暂停不推进游戏时间。网络宽限和投票期限不随速度缩放。服务器高倍速的剩余 tick 分批处理，不丢弃累积模拟时间。

渲染跟随速度，BGM 不变。高倍速不能保证低性能手机达到理论倍率；所有模拟 tick 仍会执行，不能用丢失伤害或漏怪换取表面流畅。

## 验证

```sh
node --test test/match/battleSpeed.test.js test/match/runner.test.js test/match/uniteFast.test.js
node --test test/docs-consistency.test.js test/docs-paths.test.js
node tools/i18n.mjs check --all --strict
node tools/plugin.mjs check battle-speed --strict
npm run ci
npm run golden
```

浏览器控件测试：设置 SP_SPEED_UI=1 和 CHROME_PATH，再运行 test/ui/battleSpeed.browser.test.js。实际检查结果见交付的验证报告；本地通过不能替代手机真机或云上 2 核 4 GB 性能测试。

## 部署与回滚

保留当前分支及快进联防功能，构建新镜像 stronghold-protocol:battle-speed-1.0.0；按项目 Dockerfile 构建，可用 `docker build --build-arg FETCH_ASSETS=0 -t stronghold-protocol:battle-speed-1.0.0 .`，素材沿用外部挂载。

部署前在服务器保存 docker inspect stronghold 的完整输出、现有镜像 ID 和插件目录副本。对局中不切换。当前 assets、fonts、data/assets.json 的只读挂载及插件可写挂载必须保留。特别注意 local-assets.json 与 local-fx.json：若仍只存在于容器可写层，先导出至 /root/stronghold-unite-runtime/local-art-manifests，再为新容器挂载到 /app/data/ 下对应文件，不能直接重建后丢失清单。

先以独立容器运行新镜像，仅绑定 127.0.0.1:3001:3000；使用插件目录副本和现有只读素材，保留现有环境变量。通过 SSH 隧道或网页远程方式访问测试端口。安装 battle-speed-1.0.0.zip 使用 `node tools/plugin.mjs install <ZIP路径>`，在新房间启用并分别验证两种战斗与快进联防共存。

验证成功且无进行中对局时，保留旧容器和旧镜像，切换正式端口。不要用文档中的示例省略当前实例的其他启动参数。新容器异常时停止它并启动原容器；素材挂载不改动，插件目录有独立备份。只关闭功能可在新房间取消“战斗倍速”，已开始的房间保持原来的内容集直至结束。
