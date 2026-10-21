# CI（持续集成）

目标：把「跑完整个测试套件要多久」压到能在 PR 上等得起，同时保证任何一次 CI 跑的都是**同一份**文件集合——分片只改变谁跑，不改变跑什么。

`.github/workflows/ci.yml` 现在有两个 job 组：

- `test (os, node)`：矩阵在 Ubuntu / Windows / macOS × Node 22 / 24 上跑 `npm run test`，外加 `node tools/setup.mjs --check --no-local` 与 doctor。
- `tooling`：只在 ubuntu 上跑一次 `lint`、`check:imports`、`typecheck`；lint 警告不失败（`npm run lint` 不带 `--max-warnings=0`）。

本机一条命令复跑同样的步骤：`npm run ci`（`node tools/ci.mjs`），`--only`、`--keep-going`、`--list` 见 `CONTRIBUTING.md`。CI 单 job 超时由 `timeout-minutes` 控制，余量口径见下文「超时」。

## 测试分片

`ci-shards.json` 把 `npm run test` 的全量测试文件切成 `SHARD_COUNT = 4` 片。契约有四条，任何一条被破坏都会让 CI 静默少跑：

1. **文件全覆盖**：`node --test` 展开的每个测试文件恰好属于一片，不多不少。
2. **负载均衡**：最慢一片不超过最快一片的 `MAX_IMBALANCE = 1.3` 倍。
3. **确定性**：分配不含时钟、网络与随机数——按权重降序排、逐个放进当时最轻的一片，同权重归片号小的。同样的表在任何机器上产生同样的切分。
4. **同源**：`matrix.shard` 的取值与表里的片号同源；改片数必须同时改 `SHARD_COUNT`、表和 workflow 矩阵。

`test/ci-shards.test.js` 守着 1 和 2。少写一个片号不会报错，只会少跑四分之一——所以守卫测试比脚本本身更重要。

常用命令：

```bash
npm run shards -- --check                 # 每片负载与偏差；超过 1.3× 退出 1
npm run shards -- --print 0               # 第 0 片的文件清单
npm run shards -- --run 0                 # 本机只跑第 0 片（等价于一个 CI job）
npm run shards -- --list                  # 每片一行
```

## 权重从哪来

权重是**一个文件在一次完整并发跑里报告的测试时间之和**（它的各个用例耗时相加），所以「负载」是工作量，不是墙钟——runner 在一个 job 内会并发跑多个文件，全部文件的权重和是整轮墙钟的好几倍。均衡负载等于让各 job 忙同样久，这正是分片唯一的目的。

**不要用本机耗时当权重**：同一份套件本机测 8297 s，GitHub runner 上是 2754 s，本机把重文件堆进同一片会得出错误的均衡结论。正确的做法是取 CI 产物里同一文件在多个 job 的中位数，再写回表。

新增测试文件不需要测量：它按 `defaultMs` 兜底，落进当时最轻的一片。一个文件明显变慢之后才重新计权：

```bash
node --test --test-reporter=junit --test-reporter-destination=report.xml $(node tools/ci-shards.mjs --print 0)
node tools/ci-shards.mjs --write --timings report.xml
```

## 本地复现单个 job

`SHARD` 未设时 `npm test` 仍然是**全量**——本地语义不因 CI 分片而改变。设置后只跑那一片：

```bash
SHARD=2 npm test        # 只跑第 2 片，用于复现某个 job 的失败
```

## 超时

单 job 的 `timeout-minutes` 取**实测最慢 job 的 1.5 倍以上**。当前最慢 job 约 567 s，设 20 分钟（2.4 倍）是为了容纳 runner 机型差异（实测不同机器能差 1.6 倍）。

注释里写「最慢 job 多少秒 + 哪个 run」，不要写「某片固定值」——那会把一次测量固化成常量。分片表变了就要重新看最慢 job，而不是沿用旧数字。

## 测量方法的坑

- **`--test-reporter` 必须排在测试文件之前**：`node --test` 会忽略排在文件后面的 reporter 参数，junit 文件根本不生成；`upload-artifact` 的 `if-no-files-found: warn` 又让 job 照样绿，artifact 却是 0 个。看起来全过，实际没有任何报告。
- **Node 22 的 junit 不写 `file` 属性**（22 时无、25 起有）：解析报告时不能假设每个用例都带文件路径，得从 `classname`/`name` 或外部文件清单推。
- **路径归一必须与 OS 无关**：CI 报告里出现 `/home/runner/...` 和 `D:\a\...`，先在报告里比本机 root，再退到 `/test/`、`/plugins/` 这样的稳定片段。
- **工作量等于 `node --test` 展开的文件集合**：`tools/ci-shards.mjs` 的 `testFileList()` 直接取 `tools/ci.mjs` 的 `TEST_FILES`，两者同源，新增文件会自动进表。

## 改 CI 的注意事项

- 改共享 CI 配置前先核对该仓库的**真实分支**（`gh api repos/<owner>/<repo>/branches`），不要把自己 fork 的分支名写进上游配置——上游没有那个分支，还会把在用的分支踢出 CI。
- 判断「某个事件是否浪费 CI 时间」要在目标仓库核对（`gh run list --repo <目标> --branch <b> --event push`）：fork 上的 push 跑在 fork 的 Actions，不占上游 runner。
- 与本 PR 无关的红不要在这个 PR 里顺手改，单独开 Issue，并在 PR 正文点名「与本次改动无关的红」并链接该 Issue。
- 没有目标仓库 admin 权限时无法重跑 CI：`gh run rerun` / `gh workflow run` 都会 403，只能推一个新提交触发；空提交要在提交信息里写明「重跑 CI」及原因。
