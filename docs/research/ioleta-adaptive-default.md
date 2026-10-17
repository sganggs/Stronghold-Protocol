# 罗素专项采购与 adaptive 站位（可选）

默认保留原版 AI。设置环境变量 SP_BOT_IOLETA_POLICY=experimental，或向 Match 传入 botIoletaPolicy: 'experimental'，启用罗素专项采购及其默认 adaptive 站位。显式传入 botIoletaPolicy: 'legacy' 可覆盖环境变量。其他策略默认仍使用 legacy 采购和站位；botFormationMode 可单独指定，botFormationEnabled: false 关闭示教候选。

启用后，AI 队友与自动托管优先选择可用且未被占用的罗素，排除歌利亚（band_sarkazb）和杜宾（band_doberm）的自动选择；真人手动选择不受影响。

## 设计和来源

[ASSUMED] 采购和站位是 AI 决策启发式，并非官方规则。采购参考用户提供的凌溯／眠屿“精助坚 4.0”攻略，并根据禁用盟约、实际资金、合成机会及阶段目标调整。详细策略见 [IOLETA-POLICY](../IOLETA-POLICY.md)。机制、价格和盟约阈值仍取现有生成数据。

42 个匿名布局覆盖七张地图：每图五个示教、一个留出。只在已知普通 R1–13 地图生效，不用于 Boss、隐藏关或未知地图。adaptive 保留原候选优先，补充 learned、contact、refined 及参数变体，按位置和朝向去重，以实际演习选优。首批三个候选产生完整零漏结果后停止扩展；否则按单候选 tick 上限的 12 倍总预算，在候选之间检查预算。委派与本地执行共享限制；失败回退。预演开战效果异常在 experimental 下丢弃候选，不把部分执行当作有效结果。guards／medics 开关默认关闭。

装备购买修复：仅当刷新预算及资金确实允许刷新后买牌时，才为搜牌目标延后装备购买；判断在卖出腾位后计算，保留可负担升级的优先级。

## 历史证据

以下是此前实验，非本次适配分支的重新跑分。原版 c24e17ee bot 与 experimental＋adaptive 在共用战斗引擎、队友使用原版策略、跳过联防、只评价罗素至 R11 的条件下对比。每难度每方案十种子（2001–2010），合计 40 次。

| 难度 | 原版漏怪 | experimental＋adaptive | 降幅 |
|---|---:|---:|---:|
| HARD | 159 | 30 | 81.1% |
| ABYSS 共同到达回合 | 386 | 144 | 62.7% |

ABYSS R1–8 十对、R9 九对、R10 七对、R11 四对；限定完整 R11 四对则 127→79（37.8%）。这是漏怪统计，不是通关率。完整 R11 样本准备耗时均值 HARD 134→227 ms、ABYSS 148→296 ms。另一组固定 experimental 采购的 17 对 ABYSS R11，combined→adaptive 漏怪为 96→118，不能推断所有场景都改善。

[逐波结果和指纹](ioleta-upstream030-quick-2026-10-16.json)。

羁绊层数图使用不同历史实验：legacy＋legacy 对 experimental＋learned，NORMAL/HARD/ABYSS 各二十种子；按 config＋seed 配对，R10 六十对均值 55.33→104.75，R13 五十八对 74.62→158.84。不能单独归因于采购或视作 adaptive 的测量。[可移植配对摘录](ioleta-bond-layers-paired.json)。

## 验证边界

保持原版默认，golden 不应变更；启用路径单独测试。浏览器 E2E 未运行。布局工具见 [layout-lab](../../tools/layout-lab/README.md)。
