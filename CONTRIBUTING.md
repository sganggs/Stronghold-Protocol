# 参与贡献

欢迎提 Issue 和 Pull Request：bug、和官方规则不一致的地方、新干员的战斗逻辑、翻译、文档都可以。动手之前先看一眼
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)（代码地图：哪个规则在哪个文件）。English summary at the end.

## 1. 准备环境

需要 Node.js 22 或 24（CI 在这两个版本上跑）。

```bash
git clone https://github.com/sganggs/Stronghold-Protocol.git
cd Stronghold-Protocol
npm install        # postinstall 把 pixi / preact / three 复制到 public/vendor
npm run setup      # 下载美术 / 音频（只跑测试可以不下载，缺素材的用例会自动跳过）
npm run dev        # 启动服务器（node --watch，改了服务器代码自动重启）：http://localhost:3000
```

`npm run doctor` 检查 Node 版本、素材、端口。官方数据表由 `tools/build-data.mjs` 下载到 `.cache/gamedata/`，改数据时才需要。

## 2. 运行测试

只跑和改动相关的测试，提交 PR 前再跑一次全部：

```bash
node --test test/content/op_siege.test.js                        # 一个文件
node --test --test-name-pattern="S3" test/content/op_siege.test.js  # 文件里的部分用例
npm test                                                         # 全部（需要浏览器 / 素材的用例自动跳过；不带文件的 node --test 还会跑 test/ 下的辅助模块和夹具）
npm run golden                                                   # 黄金结果：整套固定种子的战斗和对局
GOLDEN_FULL=1 node --test test/golden.test.js                    # 同上，node:test 形式
npm run golden:update                                            # 有意改变玩法时重新生成
npm run lint && npm run check:imports && npm run typecheck       # 代码检查、导入边界、类型
```

提交 PR 前可以一条命令跑一遍 GitHub CI（`.github/workflows/ci.yml`）的 test、node24 守卫和 tooling 检查：`npm run ci`（或 `node tools/ci.mjs`）。
依次是 setup 检查、`npm test`、服务器冒烟测试（在空闲端口启动、请求 `/healthz` 和首页、运行 doctor，然后关掉）、CI 守卫、lint、导入边界、
类型；第一步失败就停下并打印每步结果和耗时。`--keep-going` 失败后继续，`--only lint,test` 只跑指定步骤，`--list` 列出步骤。
不包含 `npm ci`（依赖请自己装），也不跑 Node 版本 × 系统的矩阵。
全量 Golden 在独立的 Ubuntu / Node 22 job 中运行，本地另跑 `npm run golden`。发现差异直接失败并列出场景和字段，CI 不更新期望结果。

另有独立检查 `local-extract (Python 3.8 syntax)`（`.github/workflows/local-extract-python.yml`）：用 setup 接受的最低 Python 3.8 执行 `python -m compileall -q -f tools/local-extract`，不安装提取依赖、不需要官方素材。

`ci-shards.json` 是把 `npm test` 的全量切成 4 片的权重表，每个测试文件恰好属于一片，按测到的耗时均衡：`npm run shards -- --check`
打印每片的负载和偏差，`--print 0` 列出某片的文件，`--run 0` 只跑那一片。新增测试文件不用重新测量，按默认权重落进最轻的一片；
一个文件明显变慢之后用 `node tools/ci-shards.mjs --write --timings report.xml` 重新计权（report 由
`node --test --test-reporter=junit --test-reporter-destination=report.xml …` 生成）。`test/ci-shards.test.js` 守着
「每个文件恰好一片」和「偏差不超过 1.3×」。权重来源、超时口径与测量上的坑见 [docs/CI.md](docs/CI.md)。

CI 测试矩阵为 Ubuntu/Windows × Node 22 × 四片（8 个任务），Node 24 只跑 `test:guards`。本地 `npm run ci` 的测试步骤清掉继承的 `SHARD`/`JUNIT`，仍跑全量；`SHARD=2 npm test` 可手动复现一片。

浏览器测试默认不跑，需要本机 Chrome（路径不标准时设置 `CHROME_PATH`），用环境变量打开：

```bash
SP_E2E=1 node --test test/ui/mock.e2e.test.js                    # 界面端到端（不需要素材）
SP_REAL_E2E=1 node --test test/ui/real.e2e.test.js               # 真实对局（需要已下载的素材）
RENDER_E2E=1 node --test 'test/render/*.browser.test.js'         # 渲染
SIM_E2E=1 node --test 'test/sim/*.browser.test.js'               # 浏览器里的战斗模拟
```

改了模拟（`server/sim/`）之后，可以检查各浏览器算出的战斗和服务器是否仍然逐位一致：`node tools/sim-check.mjs`
在 Node 里记录黄金结果的整套战斗，然后在任意设备（包括手机）的浏览器里打开服务器的 `/dev/sim-check.html` 重放比较；
加 `--engines chromium,firefox,webkit` 直接在无界面的浏览器里跑（Firefox 和 WebKit 需要先装 playwright）。不一致时
页面指出首次检测到差异的区间，以及结果、抽样快照或已记录状态的差别。`--diff` 可定位导出的状态向量字段；仅快照或深层状态差异不保证能定位字段。
参考数据含运行代码、数据与场景内容指纹，修改后必须重新生成；空筛选、未完成或运行异常均不算通过。细节见 docs/SIM.md
「11. Tools」。

**黄金结果**（[test/golden/README.md](test/golden/README.md)）：只重构、不改玩法的提交不能改变
`test/golden/*.json`；有意改变玩法时运行 `npm run golden:update`，把新文件和改动放在同一个提交里，并在提交说明里写清
哪些场景变了、为什么。

## 3. 忠实原则

这是官方玩法的复刻，规则以官方为准：

- **出处**：官方数据表（`.cache/gamedata/excel/`：character_table、skill_table、uniequip_table / battle_equip_table、
  activity_table 的 act2autochess、enemy_database、关卡文件）和 [PRTS](https://prts.wiki/)（干员页、技能和天赋的「备注」、
  卫戍协议相关页面）。数值尽量取 blackboard，不要凭记忆写数字。官方实测的截图或录像也很有价值，请附在 Issue / PR 里。
- **查不到出处**的细节按最简单、最接近官方的方式实现，在代码注释和 PR 描述里标 `[ASSUMED]`。维护者拍板的写成
  “the owner's decision of YYYY-MM-DD”。有意和官方不同的规则只能由维护者决定，并写进设计文档（[docs/DESIGN.md](docs/DESIGN.md)
  是索引：现行规则在 `docs/design/`，各版本的修订与依据在 `docs/history/`）。
- **版权**：不要把技能描述、剧情等受版权保护的文本大段复制进代码、文档或 PR，引一小句并注明出处即可。不要提交任何游戏
  素材文件（`public/assets/` 已被 `.gitignore` 排除）。
- **数据**：不要手改 `data/*.json`。改 `tools/build-data.mjs`，用 `node tools/build-data.mjs --offline` 重新生成，再比较
  JSON，确认只变了想改的部分。

## 4. 提交与 PR

- 一个 PR 只做一件事；干员的 kit 一个 PR 只放一名，便于审阅。
- 提交信息一行写清改了什么（中文或英文都可以），相关的 Issue 写上编号，例如 `余 S2 casts with an enemy on its x-1 (#32)`。
  只写改动本身，不加 `Co-Authored-By:`、`Generated with …` 这类署名尾行（维护者的约定）。合并的 PR 会在 CHANGELOG
  里写明并致谢作者。
- PR 描述写：改了什么、为什么、出处（数据表字段、PRTS 链接）、`[ASSUMED]` 的地方、跑了哪些测试、黄金结果里哪些场景变了。
  界面改动附截图。
- 规则改了，相关文档一起改：`docs/design/` 里对应的规则（章节号与文件见 docs/DESIGN.md 的索引）、`docs/history/` 里当前版本的
  修订记录、docs/SIM.md、docs/META.md、docs/DATA.md 等。
  `test/docs-consistency.test.js` 固定了文档里的一些句子，改文档后跑一下。
- JavaScript 用两个空格缩进，不要引入 Tab。
- 战斗结算：内容代码调用 `battle` 上的操作（`dealDamage`、`dealElementDamage`、`dealHPLose`、`heal`、`healElement`），
  公共辅助函数只从 `server/sim/attack.js` 导入，不直接引用 `server/sim/attack/` 的内部文件（ESLint 会报错）。简短示例见
  [server/sim/AGENTS.md](server/sim/AGENTS.md)，阶段与钩子的完整约定见 docs/SIM.md §4。
- 代码和注释用英文；玩家文档（README、PLAYING、DEPLOY）用简体中文，技术文档用英文。界面上的文字写中文并用 `t('…')`
  包起来，英文放进 `public/i18n/en.json`（[docs/I18N.md](docs/I18N.md)）。
- 翻译成新的语言：一个语言就是 `public/i18n/` 里的一个文件，不用改代码。`node tools/i18n.mjs template <语言代码>` 生成骨架，
  翻译后用 `node tools/i18n.mjs check <语言代码>` 检查，步骤见 [docs/I18N.md](docs/I18N.md)「Adding a language」；语言包是
  内容包的第一种，格式见 [docs/PACKS.md](docs/PACKS.md)。
- 提交的代码以 GPL-3.0-or-later 发布。本项目坚持非商业，请不要加入广告、付费、打赏等任何变现功能。

## 5. 添加干员（自选编队）

自选编队里的每名 6★ 干员都需要一个自己的战斗文件（kit），写法见
[server/sim/content/kits/README.md](server/sim/content/kits/README.md) 的「How to add an operator (自选)」。简要步骤：

1. 数据已经生成好：`data/backups.json` 的 `units[charId]`（各形态的数值、技能、天赋、模组）和 `tokens`（召唤物）。
   先对照官方数据表和 PRTS 核对。
2. 新建 `server/sim/content/kits/ops/op-<codename>.js`（codename 是 charId 去掉 `char_<n>_`），默认导出只有一个键：charId。
3. 把文件名加进 `server/sim/content/kits/index.js` 的 `OPERATOR_KIT_FILES`，这名干员就能在自选编队里选了。
4. 写测试 `test/content/op_<codename>.test.js`（照 `test/content/op_siege.test.js` 的写法：每个形态、每个模组、每个技能），
   跑 `node --test test/content/kits_layout.test.js`，再 `npm run golden:update`（只应新增 `test/golden/diy.json` 的场景）。
5. PR 里逐项勾选 README 里的「Fidelity checklist」。

目前池子里的 71 名干员都已经有 kit；改进现有的 kit 也按同样的清单来。相关讨论见 GitHub issue #136。

---

## English summary

- **Setup**: Node.js 22 or 24; `npm install`, `npm run setup` (art and audio — optional for tests), `npm run dev`.
  The code map is [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
- **Tests**: run the targeted files (`node --test <file>`, `--test-name-pattern`), then `npm test` and
  `npm run golden` before a pull request (a bare `node --test` also runs the helpers and fixtures under test/);
  `npm run lint`, `npm run check:imports`, `npm run typecheck`.
  `npm run ci` (or `node tools/ci.mjs`) runs the test and tooling checks of `.github/workflows/ci.yml` in one go and stops at the first
  failure (`--keep-going`, `--only <steps>`, `--list`); it does not run `npm ci`. The full Golden corpus runs in a separate
  Ubuntu / Node 22 job; run `npm run golden` separately locally. Differences fail with scenario and field details;
  CI never updates expected results. Browser suites
  are opt-in: `SP_E2E=1`, `SP_REAL_E2E=1` (needs downloaded art), `RENDER_E2E=1`, `SIM_E2E=1` (a local Chrome,
  `CHROME_PATH`). A refactor never changes `test/golden/*.json`; an intended gameplay change runs
  `npm run golden:update` and commits the digests with the change, naming the scenarios that moved.
  After a sim change, `node tools/sim-check.mjs` checks that browsers still give the server's bits: it traces the golden
  battle corpus in Node; `/dev/sim-check.html` replays it on any device (`--engines chromium,firefox,webkit` headless).
- **Fidelity**: the official tables (`.cache/gamedata/excel/`) and PRTS (including the 备注 notes) are the sources;
  numbers come from the blackboards. Anything no source settles is marked `[ASSUMED]` in the code and the pull
  request; owner decisions are cited with their date; deliberate deviations are the owner's call and go into the design
  document (docs/DESIGN.md is its index: the rules in `docs/design/`, the per-release revisions in `docs/history/`).
  Do not paste copyrighted game text at length (quote briefly, cite) and never commit game assets.
  Never hand-edit `data/*.json`: change `tools/build-data.mjs`, rebuild with `--offline`, compare the JSON.
- **Code**: two-space indentation, no tabs. Battle content calls the settlement operations on `battle` (`dealDamage`,
  `dealElementDamage`, `dealHPLose`, `heal`, `healElement`) and imports helpers only from `server/sim/attack.js`, never
  from `server/sim/attack/` (ESLint refuses it); short examples in [server/sim/AGENTS.md](server/sim/AGENTS.md), the
  stages and hooks in docs/SIM.md §4.
- **Commits and pull requests**: one change per pull request, one operator per kit pull request. A one-line commit
  message saying what changed, with the issue number; no attribution trailers such as `Co-Authored-By:` or
  `Generated with …` (the maintainers' convention) — merged pull requests are credited in the CHANGELOG. Describe the
  sources, the `[ASSUMED]` items, the tests and the golden scenarios that moved; update the docs a rule change makes
  wrong. Code and comments in English; player-facing text in Chinese through `t('…')` with the English in
  `public/i18n/en.json`. A new language is one file in `public/i18n/` and no code: `node tools/i18n.mjs template <code>`,
  translate, `node tools/i18n.mjs check <code>` (docs/I18N.md "Adding a language"; packs in general: docs/PACKS.md).
  Code is GPL-3.0-or-later; no monetisation features.
- **Adding an operator (自选)**: follow "How to add an operator (自选)" in
  [server/sim/content/kits/README.md](server/sim/content/kits/README.md): `op-<codename>.js` keyed by the charId,
  registered in `OPERATOR_KIT_FILES`, a test `test/content/op_<codename>.test.js`, the fidelity checklist in the pull
  request. All 71 operators of the current pool have kits; improvements follow the same checklist (GitHub issue #136).
