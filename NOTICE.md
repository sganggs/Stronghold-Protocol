# 版权与使用声明（NOTICE）

**卫戍协议：盟约 · Stronghold Protocol** 是《明日方舟》限时玩法「卫戍协议：盟约」的**非官方同人复刻**，与上海鹰角网络科技有限公司（Hypergryph）、Yostar 及其关联方**没有任何关联**，也未获得其授权或认可。

## 1. 代码许可证：GPL-3.0-or-later

Copyright (C) 2026 Stronghold-Protocol contributors

本项目自己编写的源代码与文档文字（`server/`、`shared/`、`public/` 下的 JS / CSS / HTML、`tools/`、`scripts/`、`test/`、`docs/` 等）以 **GNU 通用公共许可证第 3 版或（由你选择）任何更新版本**（GPL-3.0-or-later）发布，全文见 [LICENSE](LICENSE)。你可以在该许可证的条件下使用、修改和再分发这些代码。

例外：

- `tools/local-extract/aklz4.py` 来自 [isHarryh/Ark-Unpacker](https://github.com/isHarryh/Ark-Unpacker)，保持 BSD-3-Clause 许可（见 `tools/local-extract/LICENSE-Ark-Unpacker.txt`）。
- 通过 npm 安装的第三方库（PixiJS、pixi-spine、Preact、htm、three.js、ws 等）和字体各自保留原许可证，见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。

**英文翻译致谢**：界面英文文本 `public/i18n/en.json` 与游戏文本的补充译文 `tools/i18n/fallback-pr70.json` 以 GitHub PR #70（分支 `en-translation`）中 **@YuriRestia** 的翻译为基础，经项目所有者决定（2026-10-05）署名沿用，随本项目一同以 GPL-3.0-or-later 发布；PR #70 中取自 ak-spa-database.pages.dev（未声明许可）的文本未被采用。英文游戏文本 `data/i18n/en.json` 本身是官方英文服数据（见第 2 节）。规程（act3）版本英文游戏文本 `data/versions/act3autochess-v3_1/i18n/en.json` 以 [Terra Archive](https://terra-archive.net/) 的 TL 词典（`files.terra-archive.net/assets/tl/en/`）为主来源，条款见其 [README](https://files.terra-archive.net/assets/tl/en/README.md)（2026-11-21 查阅）；词典中不带 `"x":1` 的条目为官方英文服文本；干员技能文本暂不导入（Terra 2026-11-22 另行提供了 `autochess-kits.json`，适用同一条款，尚未接入）——*English text: Terra Archive (terra-archive.net), unofficial (partly machine-translated) translation*。

**附加许可（GPL-3.0 第 7 条）** — Additional permission under GNU GPL version 3 section 7:

> If you modify this Program, or any covered work, by linking or combining it with the Spine Runtimes (as shipped in
> pixi-spine, or a modified version of them), containing parts covered by the terms of the Spine Runtimes License
> Agreement, the licensors of this Program grant you additional permission to convey the resulting work.
> Corresponding Source for a non-source form of such a combination shall include the source code for the parts of
> the Spine Runtimes used as well as that of the covered work.

（大意：允许把本项目与 pixi-spine 中的 Spine Runtimes 组合后再分发；Spine Runtimes 本身仍受其自己的许可证约束。）

## 2. 不属于本项目、不受 GPL 约束的内容

《明日方舟》及「卫戍协议」相关的全部**名称、角色、美术、Spine 模型、界面图、音乐音效、文本与游戏数据**，版权归上海鹰角网络科技有限公司及其授权方（Yostar 等）所有。具体包括：

- Release 完整包中的 `public/assets/**`（含从官方客户端本地提取的 3D 棋盘模型与贴图、官方战斗特效 `public/assets/local/**`）和 `public/fonts/**`（字体归各自作者）；
- 由官方数据表生成的 `data/*.json` 与 `data/i18n/*.json`（官方英文服文本），以及含有或派生自游戏数据的 `docs/research/*.json`、`test/fixtures/official-waves.json`、`public/dev/recordings/*.json`、`public/js/render/faceModes.js`（干员逐能力的朝向表，@Seals-awa 从官方客户端提取，PR #730）；
- `docs/img/` 中的游戏截图；
- `docs/` 中引用的 PRTS、BWIKI、NGA、巴哈姆特等社区页面的文字（仍按其来源的许可，维基文本为 CC BY-NC-SA）。

这些内容**不在 GPL-3.0 授权范围内**，本项目也无权就它们向任何人授予任何权利。

官方战斗特效（0.3.0「官方特效」）：特效的粒子系统、网格、贴图和动画从《明日方舟》官方客户端本地提取（`tools/local-extract`，完整包附带一份），同样属于上面所说、不受 GPL 约束的内容；播放它们的着色器（`public/js/render/vfx/glsl.js`）是本项目按官方客户端着色器的计算自己重写的 GLSL 代码，仓库里不含官方着色器源码。

## 3. 仅限非商业用途

- 本项目仅供**学习、研究和个人非商业娱乐**。
- 游戏素材与数据的权利人没有授权本项目或其使用者进行任何商业使用，因此包含或依赖这些素材的一切内容——Release 完整包、架设的服务器、截图、录像与直播等——都**不得用于任何形式的盈利**。包括但不限于：
  - 出售或付费分发；
  - 收费开服、付费房间或会员；
  - 植入广告；
  - 与本项目挂钩的打赏、赞助或众筹；
  - 打包进任何收费产品或服务。
- 再分发完整包时，请保留本声明、[LICENSE](LICENSE) 和 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)，并同样注明非官方、非商业。
- GPL 本身允许商业使用**代码**，上述限制针对的是不属于本项目的游戏素材与数据。

## 4. 权利人通知与删除

如果你是相关权利人，认为本项目的任何内容不妥，请在本仓库提交 Issue（或通过 GitHub 联系仓库所有者），我们会尽快删除相关内容，或下架完整包乃至整个仓库。

## 5. 免责声明

- 本项目按「原样」提供，**不附带任何明示或暗示的担保**（见 LICENSE 第 15、16 条）。
- 使用、架设或公开本项目的风险，包括网络安全、第三方联机工具与服务、当地法律法规，由使用者自行承担。
- 本项目不需要也不会索取任何游戏账号；可选的本地提取只读取你本机已安装的客户端文件。

---

**English summary.** Unofficial, non-commercial fan remake; not affiliated with or endorsed by Hypergryph or Yostar.
The project's own code is GPL-3.0-or-later (with the Spine Runtimes linking permission above). All Arknights names,
art, models, audio and data — including everything under `public/assets/` in the release bundle — are © Hypergryph /
Yostar and their licensors, are **not** covered by the GPL, and may be used for study and personal non-commercial
purposes only: no selling, paid distribution, paid hosting, ads, donations or any other monetisation. Rights holders
can request removal through a GitHub issue and the content will be taken down. No warranty of any kind.
The English UI strings were seeded from GitHub PR #70 by @YuriRestia (credited, released with the project under
GPL-3.0-or-later); the English game texts (`data/i18n/en.json`) are official EN client data like `data/*.json`.
Act3 (规程) version English (`data/versions/act3autochess-v3_1/i18n/en.json`) is primarily from Terra Archive’s TL
dictionary (terms: https://files.terra-archive.net/assets/tl/en/README.md, read 2026-11-21; entries without "x":1 are
official Global EN) — English text: Terra Archive (terra-archive.net), unofficial (partly machine-translated) translation.
