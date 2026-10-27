# 卫戍协议：盟约 — Web Remake · Architecture & Contracts (DESIGN.md)

This is the **single source of truth** for every implementer. Research lives in `docs/research/` (start with `00-INDEX.md`; where a research file's body and its "Addendum (critic)" disagree, the addendum wins). When this document and research disagree, **this document wins**; when this document is silent, follow research; when both are silent, choose the simplest faithful behaviour and write it down in the module's header comment.

Language: player-facing text is **Simplified Chinese** by default, with an English switch since 0.2.0 (§25.2, docs/I18N.md: UI strings through `t('中文')`, game texts from the official Chinese data or the official EN client's). Code, comments and identifiers are English.

Versions: the first public release was **0.1.0** (2026-10-02, the state of §0–§20.15); the releases after it add the player feedback and GitHub reports — 0.1.1 §21, 0.1.2 §22, 0.1.3 §23, 0.1.4 §24 — and **0.2.0** (2026-10-07; `CHANGELOG.md`) the maintainability refactor, two languages, 补位, 自选编队 and their fidelity work — §25 — **0.2.1** (2026-10-07) the 联防 battlefield restored, full potential and the GitHub fixes after it — §26 — and **0.2.2** (2026-10-09) per-operator 潜能 / 练度, Japanese voices, the statistics page, 失衡, whole-frame attack timing and the GitHub fixes after 0.2.1 — §27. **0.2.3** (2026-10-10; `package.json`, `shared/constants.js APP_VERSION`) 克莱门莎 and new modules, community fixes, text size, per-operator voices, installation, the opening reroll and local match recovery — §28. **0.2.4** (2026-10-11) the official shared card pool and item stock, Raid revival and #475, and the community fixes after 0.2.3 — §29. **0.2.5** (2026-10-12) fixed gifts and already displayed operator offers under the shared stock, random boss pairing, the official battlefield scenes on the 3D board (optional local art: the full bundle includes them when extracted, a missing scene keeps the metal board; §15, §30.21), the official damage-number option, the 驭械术师 / hit-tile / bot ports and the community fixes after 0.2.4 — §30; its rules supersede the corresponding 0.2.4 ones. **0.2.6** (2026-10-13) the host-bandwidth layers 0 and 1 (no BGM download while the music is silent, WebSocket compression, content-hashed asset URLs with long caching, brotli, WebP guide pages), the official scene light gains, the impostor bounds, the deploy-animation replays, the optional ammo count and the community fixes after 0.2.5 — §31; its rules supersede the corresponding 0.2.5 ones. **0.3.0** (2026-10-14) the plugin system (插件) and the fixes after 0.2.6 — §32; **0.3.1** (2026-10-18) the Forge-pack additions, the studio templates and the fixes after 0.3.0 — §34; **0.3.2** (2026-10-24) the fixes after 0.3.1 — [§35](history/0.3.2.md); **0.3.3** (2026-10-25) is its three-fix hotfix — [§36](history/0.3.3.md), the state this document describes; it includes the first two milestones of the official version switch: M0 (§35.22: the version registry, the builds of the earlier versions, behaviour keyed by charId / effectId, the default pinned by tests), invisible to players, and M1 (§35.23: the lobby's version button, the room's version switched by the host's vote, version match hosts, settings by operator and statistics by version), enabled by default for all four official versions (`SP_VERSIONS` narrows the list, §35.23.11). The labels v1 / v2 / v2.1–v2.5.2 in §0, §14–§20 and in the BALANCE / SIM comparisons name the design generations and the private playtest builds that came before it; they are kept as history.

---

0.3.4 work in development is recorded in [§37](history/0.3.4.md); the latest released version remains 0.3.3.

The 0.3.1 Forge integration/browser polish is [§34.27](history/0.3.1.md#3427-plugin-polish-after-the-end-to-end-checks):
companion cosmetic hints, accurate import reports, record DSL permission checks and usable result panels (§32.8/§32.12).

Studio presentation authoring extends §32.9 in [§34.30](history/0.3.1.md#3430-studio-templates-for-the-031-presentation-features): theme, notices, fx and skins forms reuse the existing validators, slots and trial routes.

Blemishine S2 attack clips extend §9 in [§34.31](history/0.3.1.md#3431-official-effects-and-a-skill-clip-the-maintainer-reported-after-030):
a verified mode mapping for 瑕光 S2 only, with or without the effects index; held skill loops and every other skill keep their roles.

The verified list expands in [§35.20](history/0.3.2.md#3520-verified-skill-attack-clips): 德克萨斯 S1/S2, 伺夜 S1/S2,
归溟幽灵鲨 S1, 焰影苇草 S2 and 耀骑士临光 S2 use their model's normal attack role across facings and skins.
The earlier 郁金香 S2 candidate remains unimplemented for the identity mismatch documented in
[§35.21](history/0.3.2.md#3521-tulips-s2-candidate-remains-unimplemented). Current contract: [design/client.md](design/client.md).

The 0.3.1 sim investigation and rule correction are [§34.32](history/0.3.1.md#3432-瑕光-attacks-the-enemies-she-put-to-sleep-琳琅诗怀雅s-s3-keeps-its-coins):
瑕光 S2 retains sleeper targeting and attack replay events; 琳琅诗怀雅 S3 keeps double attacks and coins at the cap,
following the official mode's no-auto-close rule. Current contracts: [design/engine.md](design/engine.md).

Q / X prefer the selected operator, otherwise the hovered operator (PR #859, the maintainer's decision of 2026-10-23) in
[§35.31](history/0.3.2.md#3531-q--x-prefer-the-selected-operator-otherwise-use-hover-pr-859-felixsion28).
Current interaction contract: [design/client.md](design/client.md).

设置 → 异形屏适配 →「界面大小」 (75–100 %, manual, default 100 %, at 文字大小 小 only) scales the layout root and every
px floor while the touch floor stays: [§35.43](history/0.3.2.md#3543-界面大小-in-异形屏适配-837-pr-838-reworked-zasx77771); contract:
[design/client.md](design/client.md).

The damage settlement follows PRTS 伤判效果 / 伤害分类 since 0.3.2 (@Siornya's series): the public entry
server/sim/attack.js and fixed before percentage penetration in
[§35.30](history/0.3.2.md#3530-settlement-penetration-order-prs-796-and-798-siornya), the ordered pipeline and the
consumers that depend on it in [§35.32](history/0.3.2.md#3532-ordered-settlement-pipeline-and-dependent-consumers-pr-802-siornya)–§35.34,
the contract and the series' verification in [§35.35](history/0.3.2.md#3535-settlement-contract-and-the-series-verification-pr-856-siornya).
Current contracts: [design/engine.md](design/engine.md) §5.5 and [SIM.md](SIM.md) §4. The batch's merge review
(burst damage dodgeable, fixed reductions by name, #848's manifest, 界面大小 at 小 only) is
[§35.44](history/0.3.2.md#3544-merge-review-of-the-pr-batch-2026-10-23); its second review (the injury fields in SIM §3,
the 界面大小 reading) is [§35.45](history/0.3.2.md#3545-second-review-of-the-pr-batch-2026-10-23), the third
[§35.46](history/0.3.2.md#3546-third-review-of-the-pr-batch-2026-10-23), the fourth (界面大小's disabled row and the lobby
dialogs at 75 %, #796's credit, one dodge notice per masked hit, the single-human reroll throttle)
[§35.47](history/0.3.2.md#3547-fourth-review-of-the-pr-batch-2026-10-23).

Picture-only outfits become wearable under the maintainer's 2026-10-18 option A in
[§35.4](history/0.3.2.md#354-picture-only-outfits-b6): per-seat pictures with default battle models;
current rendering rules are in [design/client.md](design/client.md) and [SKINS.md](SKINS.md).

Re-entrant buff removal is specified in [§35.5](history/0.3.2.md#355-re-entrant-buff-removal): reverse-order candidates,
current object lookup and actual removal counts; [ASSUMED] extension API policy. Current contract: [design/engine.md](design/engine.md) §5.3 and [SIM.md](SIM.md) §3.

Wild Mane S2's rear-target exception is superseded by the maintainer's official recordings in
[§35.10](history/0.3.2.md#3510-wild-mane-s2-rear-push-782): radial away, force level −2, about 0.09 tile at weight 1.
Front distances stay unchanged; using the effect column only behind her is [ASSUMED] scope, not an official
direction-dependent classification. Current contract: [design/engine.md](design/engine.md) §5.4 and [SIM.md](SIM.md) §6.

盐风主教昆图斯's attack-class 大潮 / 崩坍 take the normal attack's turn under PRTS's skill rules in
[§35.19](history/0.3.2.md#3519-quintuss-tide-takes-the-attacks-turn-maintainer-recordings-2026-10-22): cooldowns
from the clip's end, equal priorities at random, 断裂生殖 limited to its level branch. The other leaders and enemies
follow the same turns in §35.29 / §35.52; longer clips hold the next attack and “自在”'s 破桎而出 needs an attack target
in §35.54. 昆图斯's 断裂生殖 / 物种爆发 join the turns in §35.55. Current contract: [SIM.md](SIM.md) §1.2 and
[design/engine.md](design/engine.md) §7. Attack-turn casts play their official clips in §35.57
([design/client.md](design/client.md)); the draft and briefing headers and the 机变 overlay fit larger text in §35.56.

The official version switch starts in 0.3.2 with M0, recorded in
[§35.22](history/0.3.2.md#3522-official-versions-groundwork-m0): four versions named by period, as the maintainer named
them on 2026-10-22 — 第一期 is the official `act1autochess` (「卫戍协议：盟约」 上半期活动), 第二期 `act2autochess` (下半期活动),
and each period's 上半 / 下半 its sub-versions V1_1 / V1_2 and V2_1 / V2_2; 第二期下半, today's game, stays the default
byte for byte. M1, recorded in [§35.23](history/0.3.2.md#3523-official-versions-the-version-switch-m1), makes them
playable by default (all four; `SP_VERSIONS` narrows the list, [§35.23.11](history/0.3.2.md#352311-every-official-version-is-enabled-unless-the-list-is-narrowed)): each player's lobby switch, the room's version
switched before the match by a unanimous vote of the seated humans (the host proposes, as in 重刷), one match process per
version; the earlier versions still play with 第二期下半's rules where they differ (M2). Current contract:
[DATA.md](DATA.md) "Official versions (M0)" (registry, profiles, builds) and "Serving the versions (M1)",
[design/network.md](design/network.md) §8.5 (the messages), [design/client.md](design/client.md) "Official versions"
and [SIM.md](SIM.md) §7.2 (behaviour keyed by charId / effectId).

Versions' intentional deviations / 有意偏差: the remake's deliberate conveniences carry across versions
(§35.22). Since 0.3.3, full-bench swaps are also allowed in 第一期上／下半 by the maintainer's 2026-10-25 decision,
after reviewing [official news 5114](https://ak.hypergryph.com/news/5114): the official first period did not allow
this swap; the second period added it. This is an **INTENTIONAL DEVIATION**, recorded in
[§36.2](history/0.3.3.md), [design/match.md](design/match.md), [META.md](META.md) and [DATA.md](DATA.md).

0.3.4 未发布变更见 [§37](history/0.3.4.md)。名片干员的可选范围扩展到本版本的自选编队池（#877）见 [§37.32](history/0.3.4.md)：候选 = 可见、非自选的 chess 干员 ∪ `backups.diy.ownedPool`，服务器白名单与 `ui/loadoutSync.js installCardSync` 共用同一份名单；跨时期干员本次不做。

## Where each section lives


0.3.3（2026-10-25 发布，0.3.2 热修复）的第一期商店装备核查与空栏显示修正见 [§36.1](history/0.3.3.md)，满休整区互换修正见同文件 §36.2。
0.3.3 跨版本装备贴图与渲染查表缓存修正见 [§36.3](history/0.3.3.md)；当前缓存身份约定见
[design/client.md](design/client.md)「Official versions」与 [ASSETS.md](ASSETS.md)「Id scope」。
当前规则见 [design/match.md](design/match.md)，空栏布局字段见 [design/network.md](design/network.md)。

The sourced freeze/redeployment advisor recipes in [§35.12](history/0.3.2.md#3512-regenerable-advisor-strategy-playbook)
require reachable named core roles and distinct thresholds; current data overrides community shorthand.
These are [ASSUMED] recommendations, specified in [AI-STRATEGY §9](AI-STRATEGY.md#9-sourced-freeze-and-redeployment-builds-assumed).

Optional selected-unit bond timers (#746, maintainer approved 2026-10-18) extend §9 in
[§35.3](history/0.3.2.md#353-optional-selected-unit-bond-timers-746): default-off convenience HUD, independent Sargon
stack expiry and separate Siracusa deployment/stealth/post-stealth effects, all read from simulation snapshots.
The official game has no numeric timer HUD; the presentation is [ASSUMED]. Current contract: [design/client.md](design/client.md).

Studio §32.9 gains five graphical gameplay templates and isolated Match exercises in
[§34.29](history/0.3.1.md#3429-studio-templates-for-the-031-gameplay-features); the current UI contract is in
[design/client.md](design/client.md#plugin-studio-gameplay-previews-3291).

Section numbers are global and never change: code, tests and the other documents cite them as "DESIGN §N". The
current rules by area are in `docs/design/`, the per-release revisions (the evidence behind each rule) in
`docs/history/`. When a revision changes a rule, the rule in `docs/design/` is rewritten too (the revision lists the
normative lines it rewrote).

Optional official art for plugin operators outside the roster is specified in [§34.28](history/0.3.1.md#3428-official-art-for-plugin-operators-outside-the-roster), updating §32.3's installation-manifest composition.
Its review fixes keep §32.3 permission classification on the original manifest while references use merged art;
discovery requires official-table membership, caps distinct operators, and full extraction uses explicit art consent.

Official tables for out-of-roster plugin operators are downloaded on demand during Forge import and setup's
startup/update gap preparation, per the maintainer's 2026-10-17 decision in
[§34.33](history/0.3.1.md#3433-official-tables-for-plugin-operators-outside-the-roster-downloaded-when-needed).
Offline checks and game runtime never fetch them; derived records and the plugin format are unchanged.

| sections | file | content |
|---|---|---|
| §0, §1, §2, §11, §12 | [design/overview.md](design/overview.md) | Scope, stack, repository layout, quality bar |
| §3, §4 | [design/geometry-time.md](design/geometry-time.md) | Coordinates, fields, geometry and time |
| §5, §7 | [design/engine.md](design/engine.md) | The battle engine (server/sim) and content modules |
| §6, §16 | [design/match.md](design/match.md) | The match and meta engine (server/match), operator loadouts |
| §8, §14 | [design/network.md](design/network.md) | The network protocol and client-side combat |
| §9, §10, §13, §15 | [design/client.md](design/client.md) | Rendering, UI, local-client art, the 3D board |
| §17 | [history/v2.2-playtest3.md](history/v2.2-playtest3.md) | User playtest #3 (v2.2) |
| §18 | [history/v2.3-playtest4.md](history/v2.3-playtest4.md) | User playtest #4 (v2.3) |
| §19 | [history/v2.4-playtest5.md](history/v2.4-playtest5.md) | User playtest #5 (v2.4) |
| §20 | [history/v2.5-playtest6.md](history/v2.5-playtest6.md) | User playtest #6 (v2.5) and its follow-ups, up to 0.1.0 |
| §21 | [history/0.1.1.md](history/0.1.1.md) | 0.1.1 — player feedback after 0.1.0 |
| §22 | [history/0.1.2.md](history/0.1.2.md) | 0.1.2 — GitHub issues after 0.1.1 |
| §23 | [history/0.1.3.md](history/0.1.3.md) | 0.1.3 — community reports after 0.1.2 |
| §24 | [history/0.1.4.md](history/0.1.4.md) | 0.1.4 — community reports after 0.1.3 |
| §25 | [history/0.2.0.md](history/0.2.0.md) | 0.2.0 |
| §26 | [history/0.2.1.md](history/0.2.1.md) | 0.2.1 — after the 0.2.0 release |
| §27 | [history/0.2.2.md](history/0.2.2.md) | 0.2.2 — after the 0.2.1 release (2026-10-09) |
| §28 | [history/0.2.3.md](history/0.2.3.md) | 0.2.3 — after the 0.2.2 release (2026-10-10) |
| §29 | [history/0.2.4.md](history/0.2.4.md) | 0.2.4 — after the 0.2.3 release (2026-10-11) |
| §30 | [history/0.2.5.md](history/0.2.5.md) | 0.2.5 — after the 0.2.4 release (2026-10-12) |
| §31 | [history/0.2.6.md](history/0.2.6.md) | 0.2.6 — after the 0.2.5 release (2026-10-13) |
| §32 | [history/0.3.0.md](history/0.3.0.md) | 0.3.0 — the plugin system (插件) and the fixes after 0.2.6 (2026-10-14) |
| §33 | [design/vfx-format.md](design/vfx-format.md) | Official battle effects (特效): the extracted format the runtime reads |
| §34 | [history/0.3.1.md](history/0.3.1.md) | 0.3.1 — released 2026-10-18, after the 0.3.0 release (2026-10-16): the effects audit's R18–R21, Forge import U1–U6, settings, Spine skill loops, lingering areas and standing effects under the official effects, 阻隔工事's client model (#663), the test console, 高台 placement in every language (#676), skill attack sounds by mode (#679), local-extract checks (#665), lossless scene maps and emission (#658), theme variables and announcements (§34.14), four plugin rule switches (§34.15), new gameplay records and official operators outside the roster (§34.16), a Forge panel compatibility layer (§34.17), plugin operator effects (§34.18), the 联防 billing of the escaped wave only (§34.19, #675), plugin interaction windows (§34.20, #682), the boss centre-column check warning (§34.21, #659), 凯瑟琳's 突变细胞 once per player per match (§34.22, #677), operator skins (§34.23, #685 / #686), exactly duplicated scene renderers dropped (§34.24, #684), attack / hit sounds by the official audio pools (§34.25, #680), custom operator traits (§34.26, #671), plugin polish after the end-to-end checks (§34.27), official art for plugin operators outside the roster (§34.28), studio templates for the gameplay features (§34.29), studio templates for the presentation features (§34.30), reported effects and 瑕光's skill clip (§34.31), 瑕光's sleepers and 琳琅诗怀雅's coins (§34.32), official tables when needed (§34.33), the split of the old UI PR #643 (§34.34) |
| §35 | [history/0.3.2.md](history/0.3.2.md) | 0.3.2 — released 2026-10-24, fixes after 0.3.1; AI strategy framework (§35.7), external AI (§35.8; [API](EXTERNAL_AI.md), development-only and omitted from release packages, §35.66); opt-in advisor plans, knowledge and benchmarks (§35.9); committed example LLM plans and private diagnostics (§35.11); regenerable [strategy playbook](AI-STRATEGY.md) and staged candidates (§35.12); advisor level floors, reasoned holds and expiring-fund spending (§35.13); advisor execution fidelity, exact IDs and hand-room protection (§35.14); advisor input for skilled play (§35.15); the event UI splits of #643 by @isomerpoi — loadout card view, lobby hub, seat cards with synced outfits, own lobby backdrop and music, match top bar, pre-game flow (§35.18); the official versions groundwork M0 (§35.22); the version switch M1 (§35.23); strategy grants at the prep start (§35.24); 终极 bot cycles and the Final Assault rehearsal (§35.62–§35.64); one 鸭爵 draw per round (§35.26); the Hidden Core's pairs drawn anew (§35.27); 火力电台 by the PRTS notes (§35.28); the other leaders' attack-class skills in the attack's turn (§35.29); enemy skill clips by the official ability (§35.48); the §35.18 UI leftovers (§35.51); the bounty leaders' and normal enemies' attack-class skills in the attack's turn (§35.52); the operators' 「进入休整期时」 traits at the prep start (§35.53); long skill clips and 自在's attack target (§35.54); 昆图斯's remaining skill turns (§35.55); pre-game text fit (§35.56); attack-turn cast clips (§35.57); the PR batch — settlement (§35.30–§35.35), open rosters (§35.36), the art-index lock (§35.37), skill-mode sounds (§35.38), 蕾缪安's crosshair (§35.39), zip errors (§35.40), 重刷本局 (§35.41), literal msgids in PR #850 (§35.42), 界面大小 (§35.43) and the batch reviews (§35.44–§35.47) |
| §36 | [history/0.3.3.md](history/0.3.3.md) | 0.3.3 — released 2026-10-25，0.3.2 的热修复；第一期商店装备核查与空栏显示（§36.1）、满休整区互换（§36.2）、跨版本装备图标缓存（§36.3） |
| §37 | [history/0.3.4.md](history/0.3.4.md) | 0.3.4 — 未发布：round54 的问题修正、小功能、人机与合入的 PR；开发中的 LLM 顾问（§37.21–§37.23，不随版本发布）、名片干员可选自选编队干员（§37.32） |

Default-off spectator AI handover (maintainer decision 2026-10-24, §35.100): [AI handover rules](history/0.3.2/ai-handover.md).

0.3.3 之后面向 **0.3.4（未发布）** 的修正记录在 [§37](history/0.3.4.md)。
