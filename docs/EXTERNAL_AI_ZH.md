# 服主接入外部 AI

**目前仅开发分支（维护者 2026-10-23，§35.66）。** 发布包、更新包和 Docker 镜像都不带这份接入。发布包里的服务器遇到 `SP_BOT_STRATEGY=external` 和 `SP_EXTERNAL_AI_*` / `SP_LLM_*` 时忽略它们，打一行日志，用内置 AI。下面的步骤只适用于从源码运行的开发分支。

这是维护者 2026-10-17 决定、2026-10-19 要求实现的扩展，基于 @HankDUMPLINGZhong 的 PR #673
策略框架。默认仍是原来的 `legacy`；玩家不能从房间里指定程序或网址。

先在一个终端运行示例 HTTP AI：

```sh
node tools/ai/http.mjs 8765
```

在另一个终端启动服务器（以下为 macOS / Linux shell）：

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=http \
SP_EXTERNAL_AI_URL=http://127.0.0.1:8765 SP_EXTERNAL_AI_SEATS=1 npm start
```

`SEATS=1` 只接管编号 1 的 AI 席位（编号从 0 开始）；省略则接管全部 AI 席位与真人 AI 托管。
也可以不设 `SP_BOT_STRATEGY`，改用 `SP_BOT_STRATEGY_SEATS=1:external` 只让 1 号席位走外部 AI，其余席位仍用各自的内置策略；
整局只连接一个外部 AI，配置同样来自 `SP_EXTERNAL_AI_*`。两个变量同时设置时，席位须同时选了 `external` 并在 `SP_EXTERNAL_AI_SEATS` 里才会接管。
第三方服务可填 HTTPS 地址；若需要鉴权，在环境变量 `SP_EXTERNAL_AI_TOKEN` 设置令牌。
不要把令牌放进网址。程序收到的只有已有公开视图、该席位的私有视图和决策上下文，没有随机种子或其他人的私有数据。

也可让服务器启动本机程序，用标准输入／输出逐行 JSON 通信：

```sh
SP_BOT_STRATEGY=external SP_EXTERNAL_AI_TRANSPORT=stdio \
SP_EXTERNAL_AI_COMMAND='["node","tools/ai/stdio.mjs"]' npm start
```

PowerShell 用 `$env:SP_BOT_STRATEGY = 'external'` 的形式逐个设置同名变量，再运行 `npm start`。
服务部署建议把命令和脚本写成绝对路径。本机程序拥有服务器的系统权限与环境变量；只运行自己信任的程序。
每局复用一个子进程，结束时关闭；程序崩溃后，下次请求在退避时间过后重新启动。

示例只选择策略／机变／交互卡并准备，不会精细经营。自行实现 AI 时，可以分批买入、移动、刷新、处理奖励等，
每批后读取新视图与上一批的结果，所有操作都经过真人相同的协议和规则校验。
超时、断线、格式错误或没有完成准备，会由原内置 AI 接着完成；回合倒计时不延长。
主机放弃某个决策（取消或超时）时只结束这一个请求，子进程照常为其他席位服务，迟到的回复按编号丢弃；
只有协议错误、崩溃或发出请求后子进程一行都没回的超时才会结束子进程（§35.62）。
默认每次决策 1000 毫秒、64 个操作、回复 64 KiB、连续失败 3 次后本局该席位固定用内置 AI，
子进程重启退避 1000 毫秒；这些工程参数及预留半个阶段剩余时间给回退均为 **[ASSUMED]**，可按英文文档调整。
顾问模式（plan）下只有协议和传输错误计入连续失败：预算用完或模型来不及给出计划（回复 `{plan: null}`）照常回退，
但不计数；休整计划失败或仍在等待时沿用上一份已采用计划的盟约、买／留／卖、物品和资金方向（`saveForInterest`、`reserve`；自 §35.63 起不含目标等级、刷新上限，也不含选项、站位和单回合停级）。

测试模式会记录外部回复与回退，回放不再访问外部服务。取消 `SP_BOT_STRATEGY` 或设为 `legacy` 即恢复默认。
完整协议、配置范围、错误处理与安全说明见 [External AI API](EXTERNAL_AI.md)；框架见
[AI 策略开发文档](BOT_STRATEGIES.md)。没有改动官方经济、部署、轮次或战斗规则。

## 语言模型玩家：顾问模式（§35.9）

维护者于 **2026-10-19** 批准，仍然全部可选：默认机器人是 `legacy`，外部 AI 默认仍为
`direct`（直接提交操作）。服主设置 `SP_EXTERNAL_AI_MODE=plan` 后，模型每个休整回合只回答一次
计划，选策略、公共机变和插件选项窗口各回答一次；采购过程中新增的私人选择、晋升奖励由原 AI
继续处理。通常每席约 15–20 次决策，具体取决于模式、存活回合和插件窗口。

计划可指定盟约及优先级、想买／保留／出售的干员、升级目标、最多刷新次数、刷新后最低余额、
装备购买／保留和携带者、可选站位。原 AI 用这些偏好调整评分，再完成采购、试算摆阵和准备；它们不强制
跳过真人合法性检查。无效结构会回退原 AI；不存在、不可买、不可摆的目标不强制执行。
空计划 `{}` 表示让原 AI 自行决定。完整字段与数值范围见 [API 顾问模式](EXTERNAL_AI.md#advisor-mode-and-readable-observations-359)。
§35.13 将 `economy.level` 改为本回合的最低目标，达标后仍按原 AI 节奏升级；只有
`holdLevel:true`、1–6 的 `level` 和非空 `economy.why`（最多 360 字符）一起提供才停级。
计划只作用于一次休整，也可以仅延后一回合升级，例如 `{"level":5,"holdLevel":true,"why":"本回合找卡，下回合降价再升6级。"}`；下回合需重新声明才能继续停级。
§35.14 的可负担最低目标在补位采购前升级，能完成的合成仍优先。
`maxRefreshes`、`refreshAbove`、`reserve` 是偏好，不得让可用的过期资金白白丢弃：先买目标／有用干员，
只有买不起的显式 `buy` 目标或完成合成的副本触发冻结；普通盟约成员、`keep` 和已有精锐的重复副本不触发。
不破坏冻结地刷新找卡，最后买便宜备用干员保存出售价值；缺钱买目标时再出售这些储备。
保留一个手牌空位，并遵守共享库存；可继承资金的策略保留原利息逻辑。这是维护者 2026-10-19 的建议，
具体执行阈值为 [ASSUMED]。摘要新增即将清零资金、实际刷新／升级价、冻结栏位和可变现储备。
§35.14（维护者 2026-10-20 实战复盘）的字段与执行约定：

- `buy`／`keep`／`sell` 各最多 32 个干员 ID。`keep` 和 `sell` **精确匹配形态**：普通 `_a` 只指普通副本，
  `_b` 只指精锐。`keep` 保护已有干员，不是追加采购要求。`buy` 可写任一形态，但只买能推进未持有精锐的
  合成（第一张也是进度）、或增加计划盟约不同成员的普通副本；已有该精锐后不再追买。盟约优先级的采购／
  阵容加分也不给已有精锐的普通重复副本，精锐自身保留阵容加分。`bonds` 最多 8 项，优先级 1–5。
- `economy.freezeSearch` 为布尔值，默认 false：商店没有可刷出的 `buy` 目标、刷新后也买不起它时，只要还能
  支付实际刷新费就继续找，刷到买不起的目标则冻结。此额外搜索按整个休整累计 `maxRefreshes`（0–16，默认16），
  含免费与之前的正常刷新，多次执行不重置；正常的可购买搜索仍保留 §35.13 的过期资金偏好覆盖。
- `items.buy` 最多 8 个道具 ID，按实际价格购买；`items.keep` 最多32个，`items.equip` 最多16项
  `{id:道具ID,target:干员ID}（携带者仍按普通／精锐同一干员匹配）`。买后按计划或原 AI 配装，并在连续购买之间执行配装以更新槽位。
  未指定的道具若不能立即装备，买后至少剩2个手牌空位；显式指定也至少保留1个空位。
- 满手牌腾位先卖未保护的干员：已有精锐的普通重复副本、储备、计划外 T1–T3 单张、其余未保护棋子；
  同类按价值从低到高、UID 打破平局。随后销毁手牌中最便宜且价格不超过2的未装备道具，最后才回退原逻辑。
  精锐、T4以上、精确 `keep`、本休整实际买入的 `buy` 目标、移除会降低已激活计划盟约档位的成员受保护；
  档位判断沿用去重、整备区计数、变形同构体等正式规则。卖弱牌、清理备选、撤回棋盘、最后腾位、临时区清理共用保护。
  保护不代表必定上场；没有便宜道具和未保护候选时仍可回退出售。腾位每次最多32步。

这些采购／出售排序、阈值与空间余量均为 **[ASSUMED]** 执行策略；维护者明确限定非空顾问计划席位，
无外部顾问的原 AI／AI 托管行为不变。实际价格、合成和盟约仍按本地官方表，手牌和冻结按 PRTS（§6.2–6.3）。
例如回复：

```json
{"v":"sp-ai/1","id":"ai-3","plan":{"bonds":[{"id":"yanShip","priority":4}],"economy":{"level":3,"maxRefreshes":6,"refreshAbove":2,"freezeSearch":true},"buy":["chess_char_1_06_a"],"items":{"buy":["chess_item_1_01_e_a"]}}}
```

这些权重、限额和提示词是 **[ASSUMED] 工程／策略选择**，不是官方推荐阵容。
经济仍按官方数据及项目已核实的规则：没有经验值系统；升级价每回合减一；通常不继承剩余资金，
不要套用其他自走棋的通用利息。坎诺特的 `aceffect_band_34 / coin_carry_over` 是满 5 资金加 1、
利息上限 1。商店按等级允许的剩余副本数加权，不是固定各阶概率表。知识包提供初始卡池各级占比，
明确标注未扣除随机禁用、购买和自选库存，绝不发送实际隐藏库存。来源：本地官方
`activity_table.json` 的 `autoChessData` 与 `activity.AUTOCHESS_SEASON.act2autochess`、干员／技能／
敌人表，以及 [玩法说明](PLAYING.md)、[数据说明](DATA.md)；这次没有改动玩法规则。

顾问模式默认先发一次带内容哈希的知识包（HTTP hello POST 或 stdio hello 行，服务必须回应相同
`knowledgeVersion`）；并发席位共用，stdio 子进程重启才重发。包含当前玩法插件的数据、规则和
公开选项卡，资料更新后哈希也变。`SP_EXTERNAL_AI_LANGUAGE` 可选 `zh-CN/en/ja/ko/zh-TW`，名称始终
附 `nameZh`，缺翻译保留中文；原始玩法表、规则说明和中文经济表是参考，插件效果以当前数据为准。
旧 direct 服务不需要 hello；需要知识包时设置 `SP_EXTERNAL_AI_KNOWLEDGE=1`。

官方版本（0.3.2，DESIGN §35.23）：服务器可以提供更早的官方版本（[部署指南](DEPLOY.md) 第 11 节）。玩这些版本的房间里，
观察的 `context` 多一项 `gameVersion`（版本 id：`act2autochess@V2_1`、`act1autochess`、`act1autochess@V1_1`），知识包顶层
也多一项 `gameVersion`，内容是该版本自己的数据（第一期只有 18 个盟约、没有终极模式）；第二期下半（`act2autochess`，默认）
两处都没有这一项，观察和知识包哈希都不变。不同版本的知识包不要混用：哈希不同，同一个棋子 id 在不同版本里可能是另一名
干员（`chess_char_1_02` 在第二期是角峰，在第一期是讯使）。这些版本的知识包暂时只有中文名称。

每次观察保留原始视图并增加 `digest`：有名字的商店、费用与等阶、手牌／棋盘坐标、盟约进度、
当前利息与下一档、升级费用、敌人／领袖预览、其他玩家公开棋盘，以及本次可用的短操作编号。
§35.15 在棋盘、整备区、临时区和商店的干员上追加 `name`、`class`（官方职业）和
`caps`（对空／阻挡／治疗／元素回复，来自 `canHitFly`、`dmgType`、`position`、`stats.blockCnt`、
`profession`、`subProfessionId`），物品追加 `name`。悬赏卡在席位策略的 `bountyKillChance` 返回有限数时
追加 `killChance`（沿用原 AI 的暴露估算，不是新的战斗规则），并附目录敌人的
`hp`、`def`、`res`、`motion`、`fly` 和短效果。这些字段可缺省，不改变 `sp-ai/1` 的原有字段。
直接模式可回复 `"intents":["a1","a3"]`，顾问选卡可写 `"plan":{"choice":"a2"}`；编号只在当前
请求有效，服务端仍重新校验，不能假定一批中的前一步执行后后一步仍合法。快捷列表保守列出能
无副作用判断的操作；交换、法术、依赖效果的消耗品、策略高亮和选项刷新继续支持原始 intent。
不为了预判任意插件效果而执行它。模型示例省去重复原始视图和大量逐格摆阵操作，交给原 AI 试算。
§37.29／§37.31：购买和奖励编号记住观察时该槽位的干员／装备；同一回复里前面的动作（刷新、升级调度中心、新的奖励）
让该槽位换了内容，或奖励所在的报价已被领走（排队的下一份报价即使显示同一名干员也算另一张），编号返回
`STALE_ACTION`，不会买到新来的那张。原始 `g.buy`／`g.reward` 不做此检查。两种模式的 digest 还带
`geometry.routes`（仅休整：人机布阵模型按预告入口与地图道路推出的本回合路线）、`lastBattle`（自己上一场战斗的
单位伤害／击倒／承伤／治疗与按敌人种类合计的漏怪及其入口），首领与精英的 `upcoming` 条目带图鉴摘要 `enemy`。

## 示例语言模型适配器

`tools/ai/llm-agent.mjs` 通过 stdio 接入游戏，默认通过兼容的 `/chat/completions` 接口调用模型。
需显式设置 `SP_LLM_BASE_URL`（包含服务商需要的 `/v1`）、`SP_LLM_MODEL`、`SP_LLM_API_KEY`，没有默认付费服务。
密钥只从环境读取，不写日志／测试回放。`SP_LLM_MAX_TOKENS` 是单次回复的输出上限（默认 16000，256–32000）：会先“思考”的推理模型如果上限太小，思考就把额度用完，回复是空的；回复在给出 JSON 之前就被截断时，只要 `SP_LLM_TIMEOUT_MS` 还剩一半，会追问一次“现在决定、只回 JSON”（两次请求共用这个时限），`SP_LLM_RETRY_EFFORT` 可只给这次追问设较低的 `reasoning_effort`；机变／报价／奖励只问选择，模型可附上所选卡名 `choiceName`，与编号对不上且正好对应另一张卡时以卡名为准（§35.63）；`SP_LLM_REASONING_EFFORT`（minimal / low / medium / high）可显式指定强度；另有下文默认关闭的 adaptive 预算策略；`SP_LLM_DEBUG_FILE` 指定一个本地文件后，每次请求的失败环节、模型回复开头和采用的计划会逐行写进去，方便判断它为什么回退、每回合怎么想，从不写入密钥或请求头。`SP_LLM_TIMEOUT_MS` 默认 20000，上限 300000（`SP_EXTERNAL_AI_TIMEOUT_MS` 上限同为 300000）；游戏侧的
总预算还包括握手，并保留一半阶段时间给回退。示例配置（先在本地或可信服务端设置环境变量）：

```sh
export SP_BOT_STRATEGY=external SP_EXTERNAL_AI_MODE=plan SP_EXTERNAL_AI_TRANSPORT=stdio
export SP_EXTERNAL_AI_COMMAND='["node","tools/ai/llm-agent.mjs"]'
export SP_EXTERNAL_AI_TIMEOUT_MS=30000
export SP_LLM_BASE_URL=http://127.0.0.1:8000/v1
export SP_LLM_MODEL=your-model
export SP_LLM_API_KEY="$YOUR_KEY"
npm start
```

知识包作为稳定系统提示词前缀缓存在内存，是否命中服务端提示词缓存由模型提供方决定；兼容
无状态接口仍须发送该前缀。自写策略提示词强调可达盟约、合理角色、晋升收益、存活与长期投入，
没有复制攻略，也没有声称胜过原 AI。回复使用下述 JSON 包装，本地验证计划后才转给游戏；错误时只返回
通用失败，不回显服务端响应。测试只连接回环模拟服务器，不调用任何真实模型 API。

### Anthropic Messages 与额外请求头（§37.25，开发中）

`SP_LLM_API_FORMAT=openai|anthropic` 选择协议，未设时为 `openai`，保留既有请求。
`anthropic` 向 `SP_LLM_BASE_URL` 追加 `/messages`（base 包含服务商需要的 `/v1`，不含 `/messages`），
发送 `model`、`max_tokens`、顶层文字 `system` 块与用户 `messages`，不发送 OpenAI 的
`response_format` 或 system-role 消息；附带 `anthropic-version: 2023-06-01`。
`SP_LLM_AUTH_TYPE=bearer|x-api-key` 从两种认证头中选择一种，两者都从 `SP_LLM_API_KEY` 读取凭据。
默认均为 Bearer，依据 [OpenCode 认证文档](https://dev.opencode.ai/v2/docs/console/api/inference)；
直连 Anthropic 设为 `x-api-key`。适配器不根据域名猜认证方式。

稳定系统块默认带 `cache_control:{type:"ephemeral"}`；兼容网关不支持时用 `SP_LLM_CACHE_SYSTEM=0`
去掉，`1` 恢复，OpenAI 格式不受影响。是否命中由服务商、模型、最小前缀和过期时间决定，
参见 [Anthropic 缓存文档](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)，不保证命中。
回复只拼接 text 块，经过原有 JSON／单括号修复／choiceName／计划校验；thinking 与 redacted-thinking
块不解析、不写诊断。`end_turn` 才算完整回复，`max_tokens` 走原有一次有预算的追问；其他停止原因拒绝。
响应大小、总时限、限流重试和禁止重定向的规则由两种格式共用。

Anthropic 的 `inputTokens = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`，
`outputTokens = output_tokens`，`cachedTokens = cache_read_input_tokens`。
缓存写入已计入输入，不算命中；可选诊断 `cacheWriteTokens` 单列写入量，游戏 usage 三字段协议不扩展。
重试按每次回复累加，5 分钟／1 小时写入明细不重复计数；缺 usage 仍表示未知，思考 token 已包含在输出中。

Anthropic 的思考控制如下；支持范围由所选模型决定，未设置的控制字段仍不发送：

| 环境变量 | Anthropic 请求 |
|---|---|
| `SP_LLM_THINKING=disabled` | `thinking:{type:"disabled"}`，不可与两种 effort 变量合用 |
| `SP_LLM_THINKING=enabled` | `thinking:{type:"adaptive"}` |
| `SP_LLM_REASONING_EFFORT=low|medium|high` | `output_config:{effort:...}` |
| `SP_LLM_REASONING_EFFORT=minimal` | 映射为 `output_config:{effort:"low"}`（[ASSUMED] 兼容选择） |
| `SP_LLM_REASONING_EFFORT=adaptive` | 既有预算策略逐观察选 low 或不发 effort，与 `thinking.type` 的 adaptive 是两件事 |
| `SP_LLM_RETRY_EFFORT` | 同样的固定强度映射，仅作用于输出截断追问 |
| `SP_LLM_THINKING_BUDGET=N` 且 `SP_LLM_THINKING=enabled` | 旧式 `thinking:{type:"enabled",budget_tokens:N}`；仅 Anthropic，整数 `1024 ≤ N < SP_LLM_MAX_TOKENS`，不与两种 effort 合用 |

[Haiku 5.5](https://platform.claude.com/docs/en/models/haiku-5-5/overview) 使用 adaptive thinking；
[旧式手动预算](https://platform.claude.com/docs/en/build-with-claude/extended-thinking) 仅用于支持它的模型，
不用于 Haiku 5.5。适配器不从模型名猜能力，也不在报错后悄悄切换思考设置。

`SP_LLM_HEADERS` 是额外请求头的 JSON 对象，例如：

```sh
export SP_LLM_HEADERS='{"HTTP-Referer":"https://example.org/","X-Title":"Stronghold local experiment"}'
```

它严格使用 transport 的 `safeHeaders` 规则：非法 JSON／非对象、忽略大小写后重名、非字符串／空值、
控制字符、超出 `[a-z0-9-]` 的头名（忽略大小写，1–64 字符）、超过 256 字符或不可打印 HTTP Latin-1
的值均在 IO 前以通用配置错误拒绝。禁止认证头（含 `proxy-authorization`、`x-api-key`）、`content-*`、
`host`、cookie 以及连接／分帧控制头；transport 本身也过滤不安全的调用方头。
适配器的 user-agent、生成的会话 ID 和 Anthropic 版本优先于额外头。请求头不进入捕获／诊断文件，
认证使用专用配置项。

### 服务商预设（配置示例，未实测兼容性）

先设置上面的通用 stdio／plan 选项，安全地从环境提供密钥，再选一行。base 不包含最终方法路径。
换服务商时清理旧的 thinking／effort／额外请求头；可用模型、JSON 模式和上下文上限由服务商决定。

| 服务商 | `SP_LLM_API_FORMAT` | `SP_LLM_BASE_URL` | 模型／附加设置 |
|---|---|---|---|
| [DeepSeek](https://api-docs.deepseek.com/quick_start/agent_integrations/) | `openai` | `https://api.deepseek.com` | `SP_LLM_MODEL=deepseek-flash`；Bearer |
| [OpenCode Go](https://opencode.ai/docs/go/)，Chat Completions | `openai` | `https://opencode.ai/inference/go/openai/v1` | `SP_LLM_MODEL=deepseek-v4.1-flash`；Bearer；`SP_LLM_SESSION_HEADER=x-opencode-session` |
| OpenCode Go，Messages | `anthropic` | `https://opencode.ai/inference/go/anthropic/v1` | `SP_LLM_MODEL=claude-haiku-5-5`；Bearer；相同会话头 |
| 直连 Anthropic | `anthropic` | `https://api.anthropic.com/v1` | 可用 Claude 模型；`SP_LLM_AUTH_TYPE=x-api-key` |
| [OpenRouter](https://openrouter.ai/docs/quickstart) | `openai` | `https://openrouter.ai/api/v1` | 可用的 `provider/model`；Bearer；可通过 `SP_LLM_HEADERS` 附加署名头 |
| [本机 Ollama](https://github.com/ollama/ollama/blob/main/docs/api/introduction.mdx) | `openai` | `http://127.0.0.1:11434/v1` | 已安装的本机模型；未启用认证时 `SP_LLM_API_KEY=local-unused` |
| [本机 vLLM](https://github.com/vllm-project/vllm/blob/main/docs/serving/online_serving/openai_compatible_server.md) | `openai` | `http://127.0.0.1:8000/v1` | 有 chat template 的已加载模型名；服务端配置的密钥，未启用认证时可用 `local-unused` |

除直连 Anthropic 外，表中均隐含 `SP_LLM_AUTH_TYPE=bearer`。本机服务也需要适配器的非空 key 设置，
占位值只适用于无需认证的服务。OpenRouter 当前文档使用 `HTTP-Referer` 与 `X-OpenRouter-Title`，
通用头选项也接受 `X-Title`。配置示例不代表订阅使用许可：部分订阅只允许在自己的工具内使用。
应核对套餐条款与允许的流量，如实标识此适配器，不伪装成已批准的客户端；OpenCode Go 文档要求编程代理
流量、自有 user-agent 与稳定会话 ID。维护者已取消本轮付费 Haiku 回放／合作探针，§37.25 仅有 mock
验证，不作 Haiku 速度或质量结论。

### 网关客户端标识（0.3.4，开发中）

每个请求都带 `user-agent: stronghold-protocol-llm-agent`（可用 `SP_LLM_USER_AGENT` 改，单行、不超过 256 字符）。
`SP_LLM_SESSION_HEADER` 指定一个 `x-…` 请求头，值是对局、席位和知识版本的 32 位十六进制哈希：同一席位同一局的
请求都相同，换席位就不同。[OpenCode Go](https://opencode.ai/docs/go/) 这类网关要求的 `x-opencode-session` 就用它。
调用方的请求头不能替换 `authorization` 和内容相关的请求头。OpenCode Go 示例（OpenAI 兼容端点；DeepSeek 模型需要在
账户的 Privacy → Regions 里打开 Global；该订阅为编程代理设计，流量有滥用监控）：
`SP_LLM_BASE_URL=https://opencode.ai/inference/go/openai/v1 SP_LLM_MODEL=deepseek-v4.1-flash
SP_LLM_SESSION_HEADER=x-opencode-session`，密钥放在 `SP_LLM_API_KEY`。

### 思考开关与 JSON 诊断（0.3.4，开发中）

HTTP 429／503 每个决策最多重试三次；原有一次输出截断追问不会重置这个限流重试计数，所有调用共用原始时限。
transport 错误只增加数字 `status` 和解析后的 `retryAfterMs`，不保留远端正文或请求头。
`Retry-After` 支持秒数与 HTTP 日期（[RFC 9110 §10.2.3](https://www.rfc-editor.org/rfc/rfc9110.html#name-retry-after)）。
[ASSUMED] 等待上限 30 秒，缺失／无效时等 10 秒；等待后必须还留有完整的原请求预算一半，
醒来后再次检查。首次请求时限不变，所有尝试不延长 `SP_LLM_TIMEOUT_MS` 的总时限。
调试 stage `rate-limit` 记录 `status`、拟等待 `waitMs`、是否安排重试 `retry` 和 `attempt`；
重试次数／预算不足仍走原有通用 `LLM request` 失败与主机回退，其他 HTTP 状态不重试。

默认 OpenAI 格式下，`SP_LLM_THINKING=enabled|disabled` 显式发送 `thinking:{type:...}`；不设置仍使用服务商默认。
`disabled` 不可与 `SP_LLM_REASONING_EFFORT` 或 `SP_LLM_RETRY_EFFORT` 同设，避免相互覆盖。
输出上限仍为 16000，降低上限不等同于降低思考强度。

2026-10-26 核对 [DeepSeek 思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)：
`minimal` 映射到 `low`，`medium` 映射到 `high`，默认启用思考且强度为 high；关闭思考用
`thinking:{type:"disabled"}`。这些映射只适用于该服务商。round54 小探针测到低强度更快，但关闭
思考出现较差的资金选择；首轮回放和 A/B 曾因 HTTP 402（余额不足）中断，后续 cycle5 完整结果如下。
数字和限制见 [0.3.4 历史记录](history/0.3.4.md#371-llm-latency-and-json-recovery-round54-in-development)。

可选诊断均默认关闭：`SP_LLM_DEBUG_FULL_REPLY=1` 配合 `SP_LLM_DEBUG_FILE` 保存最终失败回复的完整
content（受原响应大小限制），不保存思考正文；`SP_LLM_CAPTURE_FILE` 保存实际请求 body（含完整
messages、模型和控制参数）及对局／席位／请求／回合，用于同状态回放。后者含知识前缀和私人局面，
放在 git 外；两者从不保存请求头、地址、密钥，文字即使回显密钥也会脱敏，新文件权限为 0600。
服务商提供的 `reasoningTokens` 单独记入诊断；它已包含在 `outputTokens` 中，估算费用不要重复相加。
游戏消息里的 usage 字段不变；兼容 DeepSeek 的另一种缓存命中字段。

完整捕获发现：`finish_reason:stop` 的回复在完整 `plan.items.equip` 后以 `]}}` 结束，少了最外层
包装的一个 `}`。[ASSUMED] 仅对最后三个字段依次为 plan／items／equip 的这一完整结构补一个括号，
仍须通过 JSON 与原计划校验，并记录修复；截断的字符串／数组／字段、内部括号或 token 上限截断不修。
捕获的两条非空语法错误均恢复，另一条空回复仍拒绝；不据此推断 cycle3 的 35 条全部同因。

### 固定 default／low 完整对局（cycle5）

同一代码、OpenCode Go deepseek-v4.1-flash，第二期下半终极；每侧单人8局／四人合作4局。

| 设置 | 胜场 | 到达 FA | 平均 FA share | 漏怪／场 | 采用 | 有效计划 p50/p90 秒 |
|---|---:|---:|---:|---:|---:|---:|
| solo 默认 | 0/8 | 4/8 | 23.69% | 45.50 | 132/134 (98.51%) | 28.610/67.540 |
| solo low | 0/8 | 3/8 | 6.22% | 53.50 | 131/138 (94.93%) | 21.315/36.585 |
| coop4 默认 | 0/4 | 1/4 | 2.05% | 202.00 | 142/221 (64.25%) | 30.270/75.282 |
| coop4 low | 0/4 | 2/4 | 8.81% | 222.00 | 212/233 (90.99%) | 21.664/46.331 |

单人保留默认思考：low 虽更快，FA share 更低、漏怪更多。单人准备阶段没有回合倒计时，仍遵守原外部请求时限。
low 没有同时满足 FA share／漏怪不差、合作回复采用更多的预定条件，暂不推荐固定合作 low。
自适应可作为下一步显式实验：预算充裕时保留默认，短合作预算才用 low；尚无自适应真实对局结果。
这是描述性小样本，不能证明总体胜率或因果；中断和分时服务负载会影响延迟，仍未达到发布目标。
完整计数、费用、选样和限制见[§37.23](history/0.3.4.md#373-bounded-llm-rate-limit-retries-round54-cycle-5)。

### 自适应思考（cycle5，实验性选项）

显式设置 `SP_LLM_REASONING_EFFORT=adaptive` 才启用，每条观察独立选择。知识包的 `modeId`
以 `mode_multi_` 开头、初始可用预算有效且大于 0、低于 90000 ms 时发 `reasoning_effort:low`；
其他情况不发此字段，使用服务商默认。预算取 `SP_LLM_TIMEOUT_MS` 与
`context.deadline - public.serverNow` 中较小者；两时间戳来自同一主机时钟，不把 bench 虚拟时间与
本机墙钟相减。单人、未知模式、缺失／非有限／过期时钟均保留默认。时限、输出上限、提示词和回退不变。

[ASSUMED] 90 秒参考默认合作 prep 实测 p90 77.460 秒并留余量，是待验证阈值，不能保证按时或更强。
同一决策的重试保留这次选择；显式 `SP_LLM_RETRY_EFFORT` 仍会覆盖原有的输出截断追问，使用自适应时
建议留空。retry effort 不接受 `adaptive`，`SP_LLM_THINKING=disabled` 也不能与其同设；服务商的 effort
字段不会收到字面量 `adaptive`。自适应诊断行增加 `reasoningEffort:default|low`，固定配置的请求体保持不变。
该阈值在已记录的默认合作观察上会给 220/221 条决策选 low，不能据此认为自适应已解决合作质量取舍。
只做了本地 mock 验证，**未做付费自适应对局**；这是实验选项，尚不是已证实的质量改进。测量对象仅为
OpenCode Go 的 `deepseek-v4.1-flash`，不外推其他服务商。配置网关后沿用本次 host/provider
170000/150000 ms、16000 输出 token，设置上述变量并清空 retry effort／thinking 即可尝试；本轮固定 default／low A/B 没有启用此选项。

固定 A/B 的完整顺序命令见[英文接入说明](EXTERNAL_AI.md#reproduce-the-fixed-effort-comparison)：
两侧均 host/provider 170000/150000 ms、16000 token；默认 solo:ABYSS seeds1–8/jobs2 → 默认
coop4:ABYSS seeds1–4/jobs1 → low 的同两组。每条完成后才启动下一条，密钥只放环境，工件放 git 外。
这些命令需要付费，普通 adapter 不设美元停机线；本轮额外的本地测量器累计全部尝试的
`usage.opencode.list_cost`，到 $8 停止新请求，遇连续快速传输失败也停止。中断后只替换受影响数据：
两侧单人 seed7 均降到 jobs1，默认合作批次重跑；正常慢回复、无效计划都保留。详见 §37.23。

### 连续规划与简短理由（§35.11）

示例还接收从当前数据生成的策略手册（§35.12）。§35.15 在选策略时最多给出 8 个方向，优先列入没有队友争用的
社区／维护者主核；休整把同一策略、同一主核的不同副核收成一个候选，并用 `subOptions` 列出各副核与分数
（合法空间不足时更少）。[策略方法与跨版本再生成说明](AI-STRATEGY.md)记录官方字段来源、维护者 2026-10-19 的社区／
亲历建议、策略机制、分阶段关键干员、公开队友争卡、敌人补盲与 [ASSUMED] 评分／时点估计。静态手册在
`knowledge.playbook`，适配器仅从席位可见摘要与已确认计划计算 `strategy.candidates`；远期目标不能绕过已有
进展、公开可达与最多三个优先盟约的限制。离线运行 `node tools/ai/playbook.mjs --data-dir data --mode mode_multi_normal`
可重建；可选 `--community`、`--observation` JSON 输入用于其他版本和已保存战况，输出保留输入／策略哈希与评分依据。

维护者 2026-10-19 首次实际运行（单人 HARD、种子 7）发现目标反复变动、采购分散和一次计划校验失败，
因此要求示例顾问保持方向。以下均为 [ASSUMED] 顾问工程策略，不改变官方玩法、通用协议的八盟约上限、
真人校验、legacy 执行／回退或离线回放。规则数据沿用本机官方 `activity_table.json` 的 `autoChessData`、
`activity.AUTOCHESS_SEASON.act2autochess` 下 `bondInfoDict`、`charChessDataDict`、`shopLevelDataDict`
和策略／效果记录；盟约计数、购买费用、利息仍由现有实现提供。

模型回复示例：

```json
{"why":"先完成已有对子，补到最近的盟约档位。","pivot":false,"pivotReason":"","plan":{"bonds":[],"keep":[],"economy":{"maxRefreshes":2}}}
```

- `why` 最多三句短句，保存最多 360 字符；`pivot` 为转向标记，`pivotReason` 是最多 160 字符的一行理由。
  三者只供适配器和本地诊断使用；游戏、其他席位和测试回放只收到校验后的 `plan`。
- 示例最多保留三个目标盟约，优先级 1–5（5 最高）。目标必须在棋盘／整备区已有进展，且已激活或按公开
  信息仍有可达档位；优先补档、保护对子与核心干员。空阵容先建阵，不凭空铺开目标。只有更换优先级最高的
  主核才需要 `pivot:true` 和理由，例如原目标不可达、出现强力合成、首领／敌人阵营要求转向。增删或重排
  副核不是转向。缺任一项就保留仍可行的旧目标。若旧目标已不可达，适配器移除它并在诊断中明确记录自动转向
  及原因。显式空计划仍按 §35.9
  完整委托 legacy，不自动补入旧偏好。
- 按对局、席位、知识版本保存上一份已接受与待确认的休整计划和快照，最多 32 个席位范围。服务端确认后才
  把计划视为已采用；选卡、失败或未接受的回复不替换原方向。每次发送上轮计划、实际购买／出售／合成记录、
  盟约计数前后值、LP 前后值与上一战漏怪／扣血；棋盘、整备区和临时区放在当前摘要中。旧短操作编号不复用。
- 顾问观察增加不含种子的 `context.matchId` 和本席位 `digest.feedback`。成交来自现有已发生事件，包括
  legacy 的执行，不把物品消失猜成出售；最近 256 条事件带序号。子进程重启或缓存淘汰后，服务端仍提供上份
  已接受计划与保留事件，缺失的本地快照记 `null`、`eventsComplete:false`；事件缺口也明确标注。
- 紧凑摘要保留商店费用／等阶／盟约，棋盘与手牌星级（1 普通、2 精锐）／装备／位置，盟约计数／下一档／层数，
  金币／利息／升级费、敌人／阵营／首领、队友公开盟约。§35.15 另保留干员 `name`／`class`／`caps` 和物品
  `name`（只看 id 会分不清两个「锡人」），悬赏卡在旧估算器给出有限数时附 `killChance`，并附敌人
  `hp`／`def`／`res`／`motion`／`fly` 和短效果。选项保留当前可见效果与价格；省去重复视图、地形、逐格摆阵
  候选和外观字段。长特质留在精简系统提示里。发给第三方的 hello 仍是完整 `sp-knowledge/1` 包；示例系统提示
  是不超过 200000 字符的精简视图，只有译文目录超限时才去掉紧凑敌人表。
- 可达性只做保守估计：按当前商店等级、公开禁用名单与目录，加上已持有／已展示棋子，考虑部署上限（含手牌
  计数的盟约除外）。精锐计数目标要求已持有精锐，不预测特殊加成或任意插件效果。整备区进度不冒充已激活计数。
  `poolOptions` 是目录候选数量，绝非剩余库存；隐藏库存与未来刷新仍未知，不保证最终能凑齐。
- 未知／类型错误的 ID、重复或超长条目、过期短编号会被删除；有限数值夹到原校验范围，数字字符串与小数
  规范化，朝向统一大小写。修复后仍过严格 `validPlan`。除上述 0.3.4 单个外括号恢复外，错误结构、非 JSON、截断及网络错误仍走原回退；
  旧版裸计划兼容，不为修复再请求一次模型。

`SP_LLM_DEBUG_FILE` 的每行包含对局／席位／请求／回合、`why`、转向标记与原因、输出计划、被删 ID／字段及
修复理由（最多 128 条详情并记录总数）、阶段和耗时；输出计划是否被游戏接受由下次观察确认。失败可能记录
回复开头；文件包含私人策略与模型文字，请作为本地诊断保管。密钥、请求头不写入任何诊断；知识前缀仅写入另行启用的 capture 文件。
固定夹具 `test/fixtures/llm-advisor.json` 使用自写模拟目录，复现本次散买／换方向模式，测试只走回环 mock；
它不是实际模型胜率或延迟基准，不能据此声称更强或更快。

## 先和 legacy 比较，再决定是否启用

两个工具都等待外部异步决策结束才推进虚拟时间，避免把正常网络响应误判成超时；线上对局计时
照常。用同一内容版本、种子范围、难度、人数、试算次数，分别跑基线和候选。先用不联网示例检查
协议，再换模型适配器：

```sh
node tools/botbench.mjs --configs solo:FUNNY,coop4:HARD --seed 7 --seeds 10 --jobs 1 --bot legacy --json legacy.json
SP_EXTERNAL_AI_MODE=plan SP_EXTERNAL_AI_TRANSPORT=stdio \
SP_EXTERNAL_AI_COMMAND='["node","tools/ai/stdio.mjs"]' \
node tools/botbench.mjs --configs solo:FUNNY,coop4:HARD --seed 7 --seeds 10 --jobs 1 --bot external --json advisor.json
node tools/botbench.mjs --compare legacy.json advisor.json
```

改用 `llm-agent.mjs` 时再按上节配置提供方。`SP_EXTERNAL_AI_SEATS=0` 可只测一席，其余仍由 legacy
控制。`--json -` 可直接输出 JSON；`tools/matchrun.mjs --bot external --json` 也包含相同的逐席指标。
输出按策略列出存活回合、最终 LP、累计伤害、领袖伤害、胜场，及外部调用、模型报告的输入／输出／
缓存 token、延迟、回退次数；hello 次数单列。缺少 token 报告代表未知，不能当作免费。回退计数是
失败决策次数，不含成功的空计划委托；禁用后的整局 legacy 也不继续计数。种子固定不代表远程模型
确定性，建议多种子、重复试验，同时检查异常和回退率，不能只看一次胜利。

`strategyMetrics` 是逐席真实结算数据，汇总的生存／LP／伤害为平均值，胜场和调用计数是总数。
比较时也记录模型版本和配置，但不要把 API key、带凭证的 URL 写入结果文件。

## 手动席位（仅开发版，§37.26）

无需 API／密钥；在仓库根目录启动，目录必须为空。一局一目录：

```sh
node tools/ai/manual-match.mjs --dir /tmp/sp-manual-solo --mode solo --difficulty ABYSS --seed 7
```

另一终端查看状态、阅读打印路径中的 `obs-N.md`，再回答当前决策：

```sh
node tools/ai/manual-act.mjs /tmp/sp-manual-solo --status
node tools/ai/manual-act.mjs /tmp/sp-manual-solo '["a1"]'
```

也接受原始意图数组，如 `'[{"t":"g.buy","slot":0}]'`，或 `@/absolute/path/answer.json`。
`aN` 仅在当前观察有效；每批后产生新观察与新 `act-N.json`，同一次休整可以交互多次。
休整的 `'{"done":true}'` 转成经过真人校验的 Ready；若有临时区／待选卡等阻碍，会显示拒绝并继续等输入。
每次决策累计最多 256 个意图，观察中显示剩余额度；耗尽后该决策交给阶段倒计时，和真人一样（§37.30）。

四席合作，每席各读写自己的子目录：

```sh
node tools/ai/manual-match.mjs --dir /tmp/sp-manual-coop --mode coop --difficulty ABYSS --seed 7 --seats 0,1,2,3
node tools/ai/manual-act.mjs /tmp/sp-manual-coop/seat-0 --status
node tools/ai/manual-act.mjs /tmp/sp-manual-coop/seat-0 '["a1"]'
```

可将 `seat-0` 到 `seat-3` 分配给四个独立代理；`--seats 0,2` 则另两席仍由内置人机控制。
合作固定四席，使用真实时钟和现有阶段倒计时；选策略／公共机变仍按顺序，休整请求可以并发。
§37.30 [ASSUMED]：手动席位从不交给内置人机。每个决策可用剩余的整个阶段或回合（至多 300000 ms），不再像其他外部席位
那样留一半给人机；用完后由阶段倒计时按真人规则处理：休整以当前阵容准备（临时区照常处理，待选个人卡随机选），
选策略取高亮的策略（`g.bandFocus`）或默认，公共机变随机选，商店报价按超时规则。超时动作不落地，下次观察显示
TIMEOUT 且 `fallback: false`。回复无效时在窗口内重新给一份带 `EXTERNAL_ERROR` 的观察（连续至多三次），不会禁用该席位。
§37.31：不限时窗口（单人不限时、只有一名真人的合作）没有倒计时可以交接，意图额度用完会给一份带新额度的观察，只有连续
三次无效回复才由内置人机完成这一个决策（下次观察显示 `fallback: true`，席位仍是手动）。
旧文件不能回答新请求，也不能串到其他席位。

单人用虚拟时钟等待文件，并为历史版本选择现有 `soloUnlimited` 不限时选项。
`--version act1autochess --difficulty HARD` 或其他支持的版本／难度组合会在对局导入前加载对应数据；
历史版本没有 ABYSS，不支持的组合会在创建会话文件前拒绝。
默认关闭的 `SP_EXTERNAL_AI_MANUAL_WAIT=1`（显式配置 `manualWait: true`）只取消
**不限时窗口（单人不限时、只有一名真人的合作）、direct 模式**的主机和传输决策超时，`context.deadline=0`；握手仍有界。
合作或有时限的窗口仍按阶段倒计时，但可用整个窗口且不由人机接手（见上）。启动器自动配置此开关，发布包忽略该设置，原发布门禁继续排除全部 `tools/ai/`。

观察以约 3–4k token 为目标、最多 9000 字符：包括商店／持有数、整备／临时／场上位置与精锐／装备、
盟约计数／阈值／存层与短效果摘录、真人视图已有的策略计数、敌人入口／飞行预告、选项和校验反馈。
合作仅显示队友公开阵容。摆位每个棋子一行（`格子=aN`：aN 朝右、aN+1 朝上、aN+2 朝下、aN+3 朝左；带字母的只列出这些方向），
页面不再被截断（§37.31），仍有截断时会明确提示查看旁边完整 `obs-N.actions.md`；一批动作可以以 `{"done":true}` 结尾（转为准备）；
`obs-N.json` 为原始 digest，`obs-N.request.json` 为完整线协议观察，`knowledge.json` 为公开图鉴。
动作文件原子写入且不覆盖；手写坏文件保留为 `act-N.invalid-K.json`，状态显示错误，可以更正重交。

结束由启动器写 `result.md` 与完整 `result.json`：胜负、到达／通过回合、LP、最终攻势伤害／血池
（隐秘核心前保存）、逐回合盟约存层、分类资金支出和回退次数。Ctrl-C 停止并保留文件，不提供断点续局。
上述文件协议、长度上限、轮询与启动器选择均为 [ASSUMED] 开发工具策略，来自 round54 manual brief
与维护者追加的多人手动席位需求，不修改游戏规则或内置人机策略。
