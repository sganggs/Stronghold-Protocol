# 插件 DSL（P2）

给插件作者。这里只描述数据，不执行任何插件代码。编译器是 `server/sim/content/dsl/compile.js` 的 `compileDsl(spec, { bb, chess, def })`，返回的东西和官方 kit 函数返回的 Kit 相同。备战效果走 `server/match/dslMeta.js`。词表的机器可读副本是 `schemas/dsl.schema.json`。设计记录在 DESIGN §32.7。

原版对局不读这些文件。数据插件把战斗规格放在干员记录的 `dsl` 上，`kitOf` 用同一个 `compileDsl` 编译；备战规格在清单的 `dsl` 部件里，由 match 宿主登记。见第 9 节。测试仍可以把编译结果放进 `makeBattle({ kits })`。

## 1. 一份规格长什么样

```json
{ "dsl": 1,
  "pluginId": "my-plugin",
  "budget": 8000,
  "skill": { "kind": "duration", "mods": { "atkPct": { "bb": "atk" } } },
  "talents": [ { "when": "battleStart", "do": [ { "dp": { "amount": 1, "fx": false } } ] } ],
  "meta": { "key": "effect:my-plugin:income", "on": [ { "when": "income", "if": { "round": 3 }, "do": [ { "funds": { "amount": 15, "setIncome": true } } ] } ] } }
```

- `dsl` 只能是 `1`。
- `pluginId` 是 1–64 位字母、数字、下划线或连字符。编译必须由宿主给出这个 id（`opts.pluginId`，或内容组合写在 `def.raw.pluginId` 上、且与前者相同的 id）。作者写在规格里的 `pluginId` 不能覆盖宿主。两边不一致、两个可信来源互相不一致，或宿主没给 id，都是 `PLUGIN_DSL_PLUGIN_ID`。没有「省略就按 `dsl` 计预算」：那样所有没写 id 的规格会挤在同一个槽里，截断时互相卸 buff。
- [ASSUMED] 表达式嵌套和节点数各封顶 64。再深是 `PLUGIN_DSL_LOOP`（超过 64 层）或 `PLUGIN_DSL_VALUE`（超过 64 个节点），校验器返回错误，不会把调用栈打爆。`schemas/dsl.schema.json` 不数这个深度，也不数 `then` 的 4 层。只信 schema 的工作台仍可能放行，`compileDsl` / `validateDsl` 会拒绝。
- [ASSUMED] 内容组合在构建时已经拒绝坏规格。若编译仍抛错（码是 `PLUGIN_DSL_*`，或这条记录带了 `dsl`，包括 `PLUGIN_DATA_BOUND`），这场战斗立刻以 `forced` 结束：日志标签 `content:dsl`，`result.errors > 0`。不会换成空 kit，也不会换成通用 kit，干员不会上场打。玩家看到的是原来的战斗结束框，没有单独的 DSL 文案。这不是房间的 `plugin-start`。其它与 DSL 无关的异常仍走原来的通用 kit。
- `budget` 可省略。[ASSUMED] 省略时每场战斗、每个插件 8000 次动作。写了就必须是 1 到 10000000 的整数。
- `skill` 是当前选中的默认技能。`skills` 按技能 id 再给别的技能。持续、技力、初始技力省略时沿用干员数据；弹药省略会被引擎当成 0，所以弹药技能必须写 `ammo`。`kind` 不要省，省了引擎会当成瞬发。
- 技能回调写在 `on` 里：`start` / `end` / `hit` / `attack` / `tick`。`on.start` 在引擎发出 `skillStart` 之前运行，不要再写一条 `skillStart` 天赋去做同一件事。

不接受 `loop`、`while`、`for`、`code`、`js`、`eval`、`external`、`script`、`import`。没有循环，也没有战斗之外的状态。

## 2. 触发器

`always`、`deploy`、`battleStart`、`attack`、`hitDealt`、`hitTaken`、`kill`、`allyDeath`、`skillStart`、`skillEnd`、`every`、`hpBelow`。

[ASSUMED] 对应关系：

| 触发器 | 引擎钩子 |
|---|---|
| `always` | 已经在场的单位安装时跑一次。构造时单位还没活着，就改到这个单位第一次 `deploy` 再跑，只此一次，再次部署不跑 |
| `deploy` | `deploy`，且就是这个单位 |
| `battleStart` | `battleStart` |
| `attack` | `attack`，攻击者是这个单位，目标取第一个 |
| `hitDealt` | `hit`，来源是这个单位；带 `dsl` 标签的伤害不再进入 |
| `hitTaken` | `damaged`，目标是这个单位，并且是敌方的一次攻击（流失、元素、无来源、反击、反射不算）；带 `dsl` 的也不进入 |
| `kill` | `kill`，击杀者是这个单位 |
| `allyDeath` | 另一个友方死亡，且属于同一个主人 |
| `skillStart` / `skillEnd` | 同名钩子，单位是这个单位 |
| `every` | `battle.every`。`seconds` 不能小于 1/30。第一次在一个间隔之后 |
| `hpBelow` | `hpRatio` 跌破 `below` 的那一下；回到线以上之前不会再触发 |

`cooldown` 是秒，记在这次安装上，重新部署（`deploySeq` 变了）就清掉。两个相同干员不共用冷却。单位已经倒下时，除了 `battleStart`、`allyDeath`、`deploy`，动作不跑。`always` 不会在单位还没活着时跑（见上表）。

条件全部成立才跑动作。`chance` 用这场战斗的 `battle.rng`，并且最后才抽：前面的条件没过，不会消耗随机数。随机没中不扣动作预算。

## 3. 条件、目标、取值

条件：`chance`、`targetHas`（状态或同名 buff）、`selfHpBelow`、`enemiesInRange`（当前范围内的敌人数 ≥ n）、`bondActive`（`{ "id", "tier" }`，层数达到 `tier` 且盟约开着）、`skillActive`（`true` 表示技能开着；字符串表示技能 id 正好是它）。

目标：`self`、`target`、`source`、`alliesInRange`、`enemiesInRange`、`enemiesInRadius`、`lowestHpAlly`、`allAllies`。

[ASSUMED] `enemiesInRadius` 写成 `{ "enemiesInRadius": 1.5 }` 时，圆心是操作者，走技能可选的半径（不能选不可选中的，也不能选没被揭露的隐匿）。可以再写 `at`（`self` / `target` / `source` / `lastSpawn`）、`shape`（`radius` 或 `chebyshev`）、`includeStealth`。`at` 省略等于操作者。`lastSpawn` 还没有召唤物时谁也不选，不会退回操作者脚下。`shape` 为 `chebyshev`，或 `includeStealth` 为 true 时，按场上敌人的顺序扫描：跳过死亡、隐藏、不可选中；隐匿默认跳过，只有 `includeStealth: true` 才打中。切比雪夫用 `cheb`，距离小于等于半径算命中。风丸折纸是替身周围切比雪夫 1（周围 8 格），隐匿也吃伤害；特效的 `radius` 仍可以写成 1.5，那是表现，不是判定。`lowestHpAlly` 只含范围内已经受伤的友方。`allAllies` 只含同一个主人的友方，联防战场上打不到另一位玩家的干员。省略目标时动作打在自己身上。

一个取值对象恰好一个运算。`{ "bb": "atk", "mul": [2, 3] }` 是 `PLUGIN_DSL_VALUE`，中文说明「取值对象恰好一个运算」。运行时不会悄悄只读 `bb`。

取值只做加减乘除：

- 数字。
- `{ "bb": "atk" }`，读这次技能的黑板。可以带 `default`。
- `{ "talent": [0, "cost"] }`，第 0 个具名天赋的黑板（跳过 index 为 −1 的项）。
- `{ "mul": [ ... ] }`、`{ "add": [ ... ] }`、`{ "min": [ ... ] }`、`{ "max": [ ... ] }`。
- [ASSUMED] `{ "sub": [ ... ] }`、`{ "div": [ ... ] }` 表示减和除。字面量除以 0 在校验阶段就拒绝。运行时除以 0 得到 0，不会得到无穷大。
- [ASSUMED] `{ "trait": "atk" }` 读特性黑板。`{ "stat": "atk", "of": "self" }` 在动作发生时读单位当前属性，`of` 可以是 `self`、`target`、`source`、`lastSpawn`。`{ "batMod": { "bb": "base_attack_time" } }` 走引擎的攻击间隔换算，并带上技能说明，因为原始的 `base_attack_time` 是秒数而不是百分比。

非有限数当成 0。空的 `min` / `max` 是 0。

## 4. 动作

每个动作都走引擎已有的助手，不新开一条伤害管线。

| 动作 | 助手 | 要点 |
|---|---|---|
| `buff` | `addBuff` | 带 `plugin:<id>` 标签。不写持续时间就是引擎的默认（一直在） |
| `status` | `applyStatus` | `key`、`duration`，可选 `value` |
| `damage` | `dealDamage` | 自动加上 `dsl` 标签，因此不会再触发本插件的 `hitDealt`。`isSkill`、`canDodge`、`isAttack` 只有写了才传。不要默认当成普攻 |
| `heal` | `heal` | |
| `sp` | 给技力 | 原因按天赋回复 |
| `dp` | `addDp` | [ASSUMED] `fx: true` 时即使费用是 0 也播 `dp` 特效 |
| `push` / `pull` | `push` / `pull` | |
| `spawnToken` | `spawnToken` | 见下文 |
| `layers` | `addLayers` | `bond` 是盟约 id |
| `shield` | `addBuff` 的护盾 | [ASSUMED] 默认可见，`visible: false` 才隐藏 |
| `fx` | `fx` | `kind`，可选 `at`（`self` / `target` / `source` / `lastSpawn`）、`radius`、`skill`、`token`、`n`、`dur`。`id: false` 时不写单位 id |

0.3.1 的插件特效可以写 `{ "fx": { "kind": "plugin", "id": "flash", "at": "self", "dur": 0.4 } }`。
`flash` 是本插件 `assets.fx.flipbooks` 或编译索引中的本地特效名。加载器校验名称，把地址写进既有事件的
`skill: "plugin:<插件 id>:flash"`，单位 `id` 仍由引擎填写；作者不得同时指定 `skill`。
事件仍是普通 `fx`，不改变无插件的事件流和内容哈希。[ASSUMED] 缺图或关闭“官方特效”时不画；视觉持续时间最多 30 秒，
不改变战斗计时。客户端准备及合并时也校验预制体和单位归属；非法素材不参与合并。
[ASSUMED] `bind.hit` 只有在识别来源并播出效果时才替代该次伤害火花；远程预估抵达不抢占无来源事件，射手死亡取消待播命中。
绑定、PNG 图集和编译特效的限制见 [PLUGINS.md §9](PLUGINS.md#operator-effects-031)。

[ASSUMED] `damage.lose: true` 改为生命流失（`loseHp`）。`minRemain` 表示流失后生命会低于这个数时，这次不流失。`damage.from` 为 `"lastSpawn"` 时，伤害来源是刚召唤的单位。

[ASSUMED] `then` 可以写在动作旁边，也可以写在该动作的参数里（德克萨斯「打两下再晕眩」用的是参数里的写法）。两处都写，校验报 `PLUGIN_DSL_ACTION`。对伤害、状态、buff、治疗、技力、推、拉、护盾，它在每个目标结算完之后、下一个目标之前跑。其他动作整个做完再跑一次。`then` 最多套 4 层。`times` 是这一个伤害节点重复 1 到 8 次，目标倒下就停；它不是循环语法。

[ASSUMED] `spawnToken` 的 `tile` 是 `"around"`（周围能站的空格）或绝对坐标 `{ "r", "c" }`，没有相对偏移。绝对坐标必须在战场矩形内、不是保留格、并且站得上去（`canStand`）。起点、终点这类不能部署的格子会被拒绝。失败时和 `"around"` 一样，只有 `stop: true` 才停下后面的动作。坐标不按主人的半场再切一刀：[ASSUMED] 联防另一半上能站的道路格仍然可以召唤。`token` 可以是字符串，也可以是 `{ "override": true, "match": ["shadow", "doll"], "fallback": "…" }`：先用干员的 `overrideTokenKey`，再用子串匹配自己的 token 列表。`mem` 把召唤物记到单位内存。`fx: true` 播 `summon`。

技能上的 `mods`、`ammo`、攻击倍率在编译 Kit 时就算成数字，因为引擎要把数字存在技能规格上。动作列表里的 `{ "stat" }` 仍在触发时再算。

## 5. 预算和重入

按执行次数，不按时间，所以每台机器结果一样。一个动作节点算 1 次，打中几个人都算 1 次。超出之后只停这个插件在这一场里的效果：取消它的计时器，卸掉它打过 `plugin:<id>` 标签的 buff，已经由引擎挂上的技能 buff 保留到技能结束。记一条 `plugin:<id>` 错误（`battle._handlerError`，对局会抄进 `m.simErrorLog`）。超出的那一次动作不执行。别的插件继续。

自己造成的伤害带 `dsl`，默认不再进入自己的 `hitDealt` / `hitTaken`，避免一条触发链把自己打成循环。这是引擎重入规则的 DSL 侧做法。紧凑事件流里的 `dmg` 元组不带这个标签；伤害信息本身带。和官方对照时，标签比官方多一个 `dsl`。

[ASSUMED] 截断卸的是带 `plugin:<id>` 的 buff，并取消这个插件的计时器。`applyStatus` 加上的状态，以及已经落地的召唤，没有这个标签，不会收回。预算表是战斗对象上的 WeakMap，快照里没有它。本分支不从半场快照续算；如果以后续算，次数会从 0 再计。共享战场（联防 / boss）一场战斗一份计数。

## 6. 备战

`meta.on` 的每一条：`when` 是 `roundStart`、`income`、`buy`、`sell`、`refresh`、`merge`、`levelUp`、`battleResult` 之一，`do` 里是 `funds`、`layers`、`gainItem`。`meta.key` 如果写了，必须是 `effect:<插件 id>:<本地名>`，例如 `effect:my-plugin:income`。`band:`、`global:` 以及其他前缀都不是插件键。schema 只检查这个形状，不核对中间那段 id 是不是宿主的。`registerDslMeta(registry, spec, opts)` 用宿主 id 核对，对不上就 `PLUGIN_DSL_META`，并且不调用 `register`，所以盖不掉已经在册的官方处理器。

`funds` 默认调用 `addFunds`。[ASSUMED] `setIncome: true` 改为直接写这次收入事件的 `ev.income`（截成整数，最小是 0），条件不成立时不动原来的数。这是「某一回合的收入等于某个数」的写法，包括写成 0。`layers` 调用 `addLayers`，`gainItem` 调用 `grantItem`。

[ASSUMED] 备战侧没有按次数计的动作预算。条件里可以写 `round`（整数，等于 `ctx.round`）、`chance`，以及 `bondActive`。`bondActive` 读备战 ctx：优先 `ctx.bond(id)`，否则 `ctx.bonds[id]`；`active` 用记录上的字段，记录没有这个字段时再看 `ctx.bondActive(id)`；`tier` 用记录上的层数。必须有单位才成立的条件（`selfHpBelow`、`enemiesInRange`、`skillActive`、`targetHas`）在校验时就是 `PLUGIN_DSL_CONDITION`，说明里有「备战条件不能用这一条」，不会静默当成假。

调用 `registerDslMeta(registry, spec, opts)` 注册。它不会在加载时写进默认注册表。老鲤的收入对照直接用 `compileDslMeta` 的返回值，不往 `band:band_lmlee` 上注册。

## 7. 和官方效果对齐过的写法

这些规格在测试里和官方 kit 打同一场，事件流一致。官方 kit 本身没有改。

持续：地灵，攻击力提升。不写 `duration`，沿用数据里的 25 秒。

```json
{ "dsl": 1, "pluginId": "rewrite-skgoat", "skill": { "kind": "duration", "mods": { "atkPct": { "bb": "atk" } } } }
```

弹药：隐现的默认技能。弹药必须写出来。攻击间隔用 `batMod`。对照窗口短于 20 秒，所以不写「上场一段时间后加弹药」的天赋。

```json
{ "dsl": 1, "pluginId": "rewrite-inside",
  "skill": { "kind": "ammo", "ammo": { "bb": "attack@trigger_time" },
    "mods": { "atkPct": { "bb": "atk" }, "batPct": { "batMod": { "bb": "base_attack_time" } }, "taunt": -1 },
    "targeting": { "priority": "ranged" } } }
```

天赋触发：德克萨斯。剑雨先加费用并播特效，再对技能范围内每个敌人打两下法术伤害，然后晕眩。开场天赋加 1 点费用且不播特效。技能范围用 `targeting.rangeGrid: "skill"` 且 `noRangeExtend: true`，这样 `enemiesInRange` 用的是技能格子、扩展为 0，和官方把格子传进助手的结果相同。

召唤：风丸。流失当前生命的一半（剩余不足 1 时不流失），在周围召唤替身，播召唤和折纸特效。折纸的伤害圆心是替身，形状是切比雪夫距离 ≤ 1，隐匿敌人也吃到，不是操作者脚下的 `foesInRadius`。技能结束时收回替身仍然没有对应动作；对照停在 20 秒之内。把敌人放在两边都打不中的远处，不能写成折纸伤害已经逐位一致。窗口内打得中的那一格（替身远侧，再加一名隐匿）才是这次对照。打满技能时长时，官方替身会被 `onEnd` 收回，DSL 的替身还在。

备战：老鲤。第 1、2 回合收入写成 0，第 3 回合写成 15，用 `setIncome: true`。这不是战斗事件流，而是备战派发里 `ev.income` 的结果。

## 8. 错误码

校验器返回 `{ ok, problems: [{ code, path, zh }] }`，不抛错。编译时才抛，信息里带有这些码。这些码在 `shared/plugins/errors.js` 的目录里（`node tools/plugin.mjs errors`）。

`PLUGIN_DSL_SHAPE`、`PLUGIN_DSL_VERSION`、`PLUGIN_DSL_PLUGIN_ID`、`PLUGIN_DSL_BUDGET`、`PLUGIN_DSL_LOOP`、`PLUGIN_DSL_TRIGGER`、`PLUGIN_DSL_CONDITION`、`PLUGIN_DSL_ACTION`、`PLUGIN_DSL_TARGET`、`PLUGIN_DSL_EVERY`、`PLUGIN_DSL_NUMBER`、`PLUGIN_DSL_DIV0`、`PLUGIN_DSL_VALUE`、`PLUGIN_DSL_SKILL`、`PLUGIN_DSL_META`、`PLUGIN_DSL_TALENT`。

说明文字是给作者看的中文，不是对局里的界面文案。

## 9. 放进数据插件

战斗规格写在紧凑干员的 `kit` 里：`{ "dsl": { "dsl": 1, "skill": { … } } }`。备战规格写在清单部件 `"dsl": ["dsl/income.json", …]`，每个文件一份带 `meta` 的规格。权限是 `"dsl"`（干员记录还要 `"data.add"`）。

构建内容组合时用 `validateDsl` 校验。坏规格整套拒绝，码是 `PLUGIN_DSL_*`。通过后，战斗规格写进棋子记录的 `dsl`（`def.raw.dsl`）。构建器另外写入 `pluginId`，不改作者写在规格里的 `pluginId`。作者写了就必须和宿主插件一致，否则 `PLUGIN_DSL_PLUGIN_ID`。省略规格里的 `pluginId` 是允许的 [ASSUMED]。

备战文件必须带 `meta` [ASSUMED]。它们进内容组合的 `data.dsl[<插件 id>]`，因此进 `cs`。原版组合没有这个表。match 宿主在 `setData` 之后、导入 Match 之前，对每份规格调用 `registerDslMeta`。键必须是 `effect:<本插件 id>:<本地名>`。

[ASSUMED] 一份内容组合里的备战规格对该组合的每个玩家都生效：宿主在 Match 构造完玩家之后，给每人挂一条 `{ key, battle: false }` 的 EffectRef。作者不能登记 `global:`。只登记、不挂这条引用，收入钩子不会跑。

[ASSUMED] 构建已经拒绝坏规格。编译仍抛错时，战斗在 `setupUnitKit` 记 `contentFault`（`content:dsl`）并以 `forced` 结束，不部署、不换成空 kit 或通用 kit。玩家看到原来的战斗结束框。绕过构建器、但哈希仍对得上的备战规格，在宿主 `boot` 失败（`boot-error` / 房间 `plugin-start`，`PLUGIN_DSL_META`）。`plugin check` 只查形状，不查键里的插件 id，也不查数值上限；这两项由 `buildContentSet` 拒绝。直接字面量超过官方上限是 `PLUGIN_DATA_BOUND`（`max(10 × 原版最大, 64)`）。`{mul}` 里的因子不逐个拒绝，结果钳到同一上限。`duration`、动作数值、`rangeExtend` 不在这张表里。`potDown` 不能写 `dsl` / `pluginId`。别的插件不能改这条记录的 DSL。`data.dsl` 是保留表，数据包补丁不能写它。

`plugins/_template/content/` 里有一个 DSL 干员（被动攻击力 +50%）和一份把第 1 回合收入写成 15 的备战文件。`node tools/plugin.mjs new dsl <id>` 生成同样的例子，并且 `check --strict` 能过。把模板目录复制到 `plugins/data-demo/` 时，文件夹名要和清单里的 id 一致。


## 10. 干员特质（0.3.1，#671）

数据插件可声明 `trait: { "desc": "中文特质说明", "dsl": "data/trait.json", "translations": { "en": "Trait text" } }`。
`dsl` 也可直接写对象。它描述盟约模式的**特质**，不会替换职业／模组的**特性**、技能或天赋。
规格仍为 `dsl: 1`，战斗条目放 `talents`，备战条目放 `meta.on`（不写 `meta.key`）。
也可在 `kit.dsl.trait` 写 `{ "desc": "中文说明", "on": [战斗条目], "meta": { "on": [备战条目] } }`，
与技能 `talents` 和全局 `meta` 分开；两种写法不可同时使用。普通／精锐分别用 `forms.normal.trait`、`forms.elite.trait`，
缺省继承记录上的 `trait`。翻译支持 en、ja、ko、zh-TW；缺省显示中文。Schema：`schemas/operator-trait.schema.json`。

在 `operators` 中修改现有干员只需 `{ "op": 1, "charId": "char_4145_ulpia", "trait": { … } }`；
权限为 `data.add`、`data.patch`、`dsl`。新干员仍用完整紧凑记录（`data.add`、`dsl`）。
[ASSUMED] 默认叠加官方特质；同一记录显式写 `"overrides": ["trait:char_4145_ulpia"]` 才关闭该干员原有的模式驻守特质，
保留其他插件追加的特质、职业特性、模组和天赋。不是清单的脚本 kit override。移除插件后重新组合，原版完全恢复。

乌尔比安（本项目 id 是 `char_4145_ulpia`）普通获得一件阿戈尔重刃；精锐把 count 改成 2：

```json
{ "dsl": 1, "meta": { "on": [
  { "when": "gain", "do": [{ "gainItem": { "item": "chess_item_3_07_e_a", "count": 1 } }] }
] } }
```

[ASSUMED] `gain` 每次实际获得一个副本触发一次：购买、奖励、自选棋子的获得、测试指令赠送均走同一路径。
凑齐合并的最后一张按获得的普通副本触发，合并产出的精锐、直接晋升不额外触发 gain。自选名单的选择本身没有获得棋子。
`deploy` 仅从手牌／临时区成功进入棋盘触发；换位、转向及战斗内再部署不是备战 deploy。
其余 `roundStart`、`buy`、`sell`、`merge`、`levelUp`、`battleResult` 是该玩家的现有备战事件；
`levelUp` 指调度中心升级。[ASSUMED] 这些事件对每名仍持有的角色每次执行一次，精锐优先，副本不倍增；
手牌／临时区也算持有。[ASSUMED] `sell` 的自身特质按 `ev.piece` 的出售形态执行一次，即使这是最后一张；
同角色留下的副本不再重复执行，也不改用留下的精锐形态。其他角色的售出监听仍按持有规则执行。
获得时的实际入账仍只算一次；`SERVER_GAIN` 发现与强制触发另走既有驻守通道，铃兰／御守之力与复制特质可触发自定义 gain，
强制触发保留投资人倍率，既不新增棋子，也不增加获得次数。实际获得的自定义 gain 保持原有一次规则 [ASSUMED]。
`gainItem.count` 默认 1，[ASSUMED] 必须是 1–64 的整数，逐件走既有库存、整备区和自动合并规则。

克莱门莎式侵蚀叠层（精锐 amount=2、maxPerBattle=24）：

```json
{ "dsl": 1, "talents": [
  { "when": "elementBurst", "if": { "element": "erosion", "targetOnField": true, "selfOnField": true },
    "do": [{ "layers": { "bond": "selfActive", "amount": 1, "maxPerBattle": 12 } }] }
] }
```

`elementBurst` 使用 attack/element.js 已有爆发事件，携带 `target` 和 `source`；不再造伤害或爆发事件。
[ASSUMED] `element` 是封闭词表：neural（神经，SANITY/1）、erosion（侵蚀，WATER/2）、burn（灼燃，FIRE/3）、
apoptosis（凋亡，DARK/4）、necrosis（引擎旧有坏死，无新增官方数字 id）。不得用 WATER 等别名或猜测的新元素。
`targetOnField`、`selfOnField` 必须为布尔值：在场表示存活、未隐藏／移除，友方还必须已部署。
这三个条件只用于 elementBurst；省略时不筛选，`selfOnField: false` 可在持有者倒下时观察爆发。
其余既有条件仍全部成立才触发，chance 最后抽签。

`layers.bond` 必填，可写现有盟约 id；[ASSUMED] `selfActive` 遍历持有者自身当前已激活的盟约（含装备配对赋予的盟约，沿用官方 self-bond 助手）。
`maxPerBattle` 可用于特质里任意既有战斗触发器的 layers 动作，按每个持有者／动作节点／盟约分别累计，
再部署不清零，新战斗清零。剩余额度不足时只给剩余量。[ASSUMED] cap 及带 cap／selfActive 的 amount 都是 1–1000000 的整数，
不用黑板表达式；不扩展其他动作的 cap。备战 layers 不接受 maxPerBattle 或 selfActive。
特质 layers 走既有 `garrison` 增层通道，保留持有者来源和位置，魔王的身前加层可正常生效。
[ASSUMED] 节点 cap 限制基础授予量，魔王加成另计，最终仍受 999 总层数上限约束；动作预算仍按同一战斗／插件计。
爆发冷却与既有触发器同用 `elapsed < cooldown - 1e-9` 判断，避免浮点舍入漏触发。
[ASSUMED] 启用增层且实际上场角色／形态含战斗 layers 特质的战场，由服务器从 BattleSpec 开始推演并结算，
即使 `SP_VERIFY=off` 也不接受其客户端战果；普通／联防走既有分片推演，允许增层的领袖场走共享池服务器路径。
代价是这些战场每场一次服务器完整模拟；浏览器继续回放，层数禁用或无相关特质的战场保持原路径。
声明 cap 只描述可能值，不能证明触发已发生，不再扩大客户端允许额度；自选／补位按实际战斗形态识别。
[ASSUMED] 补位单位的战斗特质按实际战斗者的 charId 匹配。

校验会读取已声明的特质权限，`check --strict` 不再误报 `dsl`／`data.patch` 未使用，旧的一键修复也不能删除它们。
物品、动作盟约和条件盟约引用在 `check` 时对照组合数据检查；[ASSUMED] 所需依赖从同级插件文件夹读取，
缺失依赖明确报错。此检查只组合数据，不运行依赖脚本或其 preflight。

实现位于服务端组合器及客户端加载适配器，沿用现有 DSL 动作预算、引擎助手和确定性随机数。
不加载插件 JavaScript；不会为原版增加事件或改写 sim/shared 文件。仅使用新字段的组合包含运行时指纹；页面校验后交给禁止联网的 Worker。
机器人、服务端 match host、浏览器及工作台试打使用相同运行时；独立测试台只模拟战斗，获得物品请用房间测试指令。
