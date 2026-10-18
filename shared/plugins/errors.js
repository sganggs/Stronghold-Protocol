// shared/plugins/errors.js — the plugin error catalogue (DESIGN §32.9, docs/PLUGINS.md §15; the 0.3.0 plan's shared
// interface C6): every code a check of a plugin can report — the manifest and file rules (shared/plugins/manifest.js),
// a cosmetic plugin's asset overlay and lock (shared/plugins/visual.js), the registry's scan (server/plugins/registry.js),
// the packer (server/plugins/pack.js), a room's refusals (the ERR codes PLUGIN_UNKNOWN … PLUGIN_LIMIT, shared/constants.js),
// the studio's API (server/studio/), a data plugin's checks (server/plugins/contentData.js, contentSet.js,
// shared/plugins/patch.js, records.js, validate.js, officialBounds.js, dataUtils.js), a DSL spec's check (server/sim/content/dsl/validate.js, server/match/dslMeta.js) and
// the host's answers to an interface plugin's page (shared/plugins/ui.js, level 'frame') — with its explanation in plain words, Chinese and English, what to do about it,
// and where the documents say more. No Node builtin: the validators, the CLI (tools/plugin.mjs check), the studio's page
// (public/studio/) and the server's log lines all read it, and the symptom tables of docs/PLUGINS.md §15 and
// docs/PLUGIN-GUIDE.md are generated from it (symptomTable; test/plugins/errors.test.js keeps them in step).
// (i18n-ignore-file: the catalogue is bilingual by design, 中文 · English — docs/I18N.md; the studio shows the Chinese text
// in a Chinese interface and the English one in the others [ASSUMED])
//
// An issue (what a check returns beside its plain `problems` / `warnings` strings, which stay as they were):
//   { level: 'problem' | 'warning', code: 'PLUGIN_…', text, at?, file?, params }
//   level   a problem keeps the plugin out (not listed, the start log says why); a warning does not
//   text    the technical English line the checks always wrote (kept: the tests and the logs read it)
//   at      where in the manifest, as a path (['version'], ['assets', 'chars', 'char_102_texas', 'avatar']) — the studio
//           shows the explanation beside that field
//   file    the plugin file it is about ('art/avatar.png')
//   params  what the explanation names ({ need: 'assets.override' } …)
// An entry of the catalogue: { level, zh, en, fix: { zh, en }, doc, symptom?, autofix? } — zh / en the explanation with
// {param} placeholders ({where} is `at` or `file`), fix what to do, doc the section that explains it, symptom what an
// author sees (the tables' first column; by level when absent), autofix the name of the studio's one-click fix
// (server/studio/edit.js) where one exists.
// Each plugin subsystem adds its codes here (PLUGIN_ prefix, unique names; test/plugins/errors.test.js fails on a code
// the code names that the catalogue lacks).

/** The documents the entries point to. */
const D = Object.freeze({
  manifest: 'docs/PLUGINS.md#3-the-manifest-manifest-2',
  rules: 'docs/PLUGINS.md#rule-switches',
  permissions: 'docs/PLUGINS.md#4-permissions',
  files: 'docs/PLUGINS.md#5-files-and-limits',
  lang: 'docs/PLUGINS.md#7-language-packs',
  cosmetic: 'docs/PLUGINS.md#9-cosmetic-plugins-p1a',
  data: 'docs/PLUGINS.md#10-data-plugins-p1b',
  rooms: 'docs/PLUGINS.md#11-room-content-sets-房间内容组合-p1c',
  ui: 'docs/PLUGINS.md#14-interface-plugins-p4',
  dsl: 'docs/PLUGIN-DSL.md#1-一份规格长什么样',
  dslTriggers: 'docs/PLUGIN-DSL.md#2-触发器',
  dslTerms: 'docs/PLUGIN-DSL.md#3-条件目标取值',
  dslActions: 'docs/PLUGIN-DSL.md#4-动作',
  dslBudget: 'docs/PLUGIN-DSL.md#5-预算和重入',
  dslMeta: 'docs/PLUGIN-DSL.md#6-备战',
  offers: 'docs/PLUGINS.md#10b-offers--interaction-windows',
  studio: 'docs/PLUGINS.md#15-the-studio-and-the-tools',
  catalog: 'docs/PLUGINS.md#17-the-catalogue-and-installing-by-address-目录与安装',
  forge: 'docs/PLUGINS.md#16-forge-import',
  guide: 'docs/PLUGIN-GUIDE.md',
});

/**
 * @typedef {{ zh: string, en: string }} Bilingual
 * @typedef {{ level: 'problem' | 'warning' | 'refusal' | 'studio' | 'frame', zh: string, en: string, fix: Bilingual, doc: string,
 *   symptom?: Bilingual, autofix?: string }} PluginErrorEntry
 * @typedef {{ level: 'problem' | 'warning', code: string, text: string, at?: string[], file?: string,
 *   params: Record<string, unknown> }} PluginIssue
 * @typedef {{ problems: string[], warnings: string[], issues: PluginIssue[],
 *   problem: (code: string, text: string, extra?: Record<string, unknown>) => void,
 *   warning: (code: string, text: string, extra?: Record<string, unknown>) => void,
 *   take: (r: { problems?: string[], warnings?: string[], issues?: PluginIssue[] } | null | undefined, opts?: { warningsToo?: boolean }) => void }} IssueList
 *   what issueList() returns
 */

/** @type {Readonly<Record<string, Readonly<PluginErrorEntry>>>} the catalogue, by code (see the header) */
export const PLUGIN_ERRORS = Object.freeze({
  PLUGIN_STUDIO_CHANGED: {"level": "studio", "doc": "docs/PLUGINS.md#15-the-studio-and-the-tools", "zh": "插件文件已被其他编辑器修改", "en": "The plugin changed in another editor", "fix": {"zh": "重新读取插件，再保存你的修改。", "en": "Reload the plugin before saving your changes."}},
  PLUGIN_STUDIO_TRIAL_BUSY: {"level": "studio", "doc": "docs/PLUGINS.md#15-the-studio-and-the-tools", "zh": "试验台正在运行其他对战", "en": "The trial bench is busy", "fix": {"zh": "等当前对战完成后再试。", "en": "Wait for a running trial to finish."}},
  PLUGIN_STUDIO_TRIAL_TIMEOUT: {"level": "studio", "doc": "docs/PLUGINS.md#15-the-studio-and-the-tools", "zh": "这次对战超过了试验台的时间上限", "en": "The trial exceeded its time limit", "fix": {"zh": "缩短场景时长，减少单位或检查插件效果。", "en": "Shorten the scenario, reduce units or check the plugin effects."}},
  PLUGIN_STUDIO_TRIAL_FAILED: {"level": "studio", "doc": "docs/PLUGINS.md#15-the-studio-and-the-tools", "zh": "试验台子进程未能完成对战", "en": "The trial process could not finish", "fix": {"zh": "重新检查插件；如果仍失败，请查看服务器日志。", "en": "Check the plugin again; consult the server log if it still fails."}},
  PLUGIN_STUDIO_TRIAL_LIMIT: {"level": "studio", "doc": "docs/PLUGINS.md#15-the-studio-and-the-tools", "zh": "这次对战的回放超过了大小上限", "en": "The trial replay exceeded its size limit", "fix": {"zh": "缩短对战时长或减少单位和特效。", "en": "Shorten the trial or reduce units and effects."}},
  PLUGIN_STUDIO_CONSOLE_SCENARIO: {"level": "studio", "doc": "docs/PLUGINS.md#15-the-studio-and-the-tools", "zh": "测试场景无效：{path}（{reason}）", "en": "Invalid test scenario: {path} ({reason})", "fix": {"zh": "检查场景字段、合法部署位置、所属干员与波次；不支持的字段不能运行。", "en": "Check scenario fields, legal tiles, summon owners and waves; unsupported fields cannot run."}},
  PLUGIN_STUDIO_TRIAL_SCENARIO: {"level": "studio", "doc": "docs/PLUGINS.md#15-the-studio-and-the-tools", "zh": "这个试验场景不能运行", "en": "This trial scenario cannot run", "fix": {"zh": "选择有效的干员、波次和 1–120 秒时长；界面插件用沙箱预览。", "en": "Select valid operators, a wave and 1–120 seconds; use the sandbox preview for UI plugins."}},

  PLUGIN_CONSENT: {"level": "refusal", "doc": "docs/PLUGINS.md#13-scripts-p3", "zh": "还有玩家未同意运行受信任插件", "en": "A player has not consented to trusted plugins", "fix": {"zh": "每个在座玩家须亲自确认当前内容组合的风险提示。", "en": "Every seated player must personally accept the risk for this content set."}},
  PLUGIN_TRUST_PUBLIC: {"level": "refusal", "doc": "docs/PLUGINS.md#13-scripts-p3", "zh": "公网监听默认禁止受信任插件", "en": "Trusted plugins are refused on a public listening address", "fix": {"zh": "改为监听本机或局域网；确认风险后可显式使用 trusted-force。", "en": "Bind to a local address, or explicitly opt into trusted-force after reviewing the risk."}},
  PLUGIN_TRUST_PIN: {"level": "refusal", "doc": "docs/PLUGINS.md#13-scripts-p3", "zh": "插件锁文件无效、文件已改变或受信任哈希不符", "en": "The lock is invalid, files changed, or the trusted pin does not match", "fix": {"zh": "重新打包以校验文件；受信任模式还需审核并在 plugins/config.json 的 trusted 中钉住锁文件 SHA-256。", "en": "Repack to verify files; in trusted mode also review and pin the lock SHA-256 in plugins/config.json trusted."}},
  PLUGIN_SCRIPTS_DISABLED: {"level": "refusal", "doc": "docs/PLUGINS.md#13-scripts-p3", "zh": "服主没有启用脚本插件", "en": "The server owner has not enabled script plugins", "fix": {"zh": "脚本隔离执行可设置 SP_PLUGIN_SCRIPTS=sandbox；受信任代码需设置 trusted 并审核、钉住 lock 哈希。", "en": "Set SP_PLUGIN_SCRIPTS=sandbox for isolated scripts; native trusted code requires trusted mode, review and a lock pin."}},
  PLUGIN_SCRIPT_CHECK: {"level": "refusal", "doc": "docs/PLUGINS.md#13-scripts-p3", "zh": "脚本未通过兼容性检查：{detail}", "en": "The script failed its portability check: {detail}", "fix": {"zh": "入口只导入 sp:sdk@1；导出同步 setup(sp)，使用 SDK 和确定性助手。", "en": "Import only sp:sdk@1; export synchronous setup(sp) and use deterministic helpers."}},
  PLUGIN_SCRIPT_OVERRIDE: {"level": "refusal", "doc": "docs/PLUGINS.md#13-scripts-p3", "zh": "插件未声明要替换的官方技能", "en": "The plugin did not declare the official kit it replaces", "fix": {"zh": "在清单 overrides 中列出要替换的官方 kit id。", "en": "List the official kit id in manifest overrides."}},
  PLUGIN_SCRIPT_CONFLICT: {"level": "refusal", "doc": "docs/PLUGINS.md#13-scripts-p3", "zh": "两个插件注册了同一个效果", "en": "Two plugins register the same effect", "fix": {"zh": "关闭其中一个插件，或让作者改用不同的 id。", "en": "Disable one plugin or use distinct registration ids."}},
  // ---- a room's refusals (room.setPlugins; ERR codes of shared/constants.js) ----------------------------------------
  PLUGIN_WORKER_TIMEOUT: { level: 'problem', zh: "插件模拟长时间无响应", en: "Plugin simulation did not respond", fix: { zh: "检查插件循环并降低每批模拟的负载", en: "Check plugin loops and reduce simulation work" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_WORKER_FAILED: { level: 'problem', zh: "插件模拟进程出错", en: "Plugin simulation failed", fix: { zh: "查看日志并修复插件", en: "Inspect the log and fix the plugin" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_WORKER_STOPPED: { level: 'problem', zh: "插件模拟已停止", en: "Plugin simulation stopped", fix: { zh: "重新开始本场模拟", en: "Start a new simulation" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_UNAVAILABLE: { level: 'problem', zh: "脚本沙箱未就绪", en: "Script sandbox is unavailable", fix: { zh: "安装依赖并检查 SDK 接口", en: "Install dependencies and check the SDK adapter" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_DISABLED: { level: 'problem', zh: "服务器未开启脚本沙箱", en: "Script sandbox is disabled", fix: { zh: "由服主设置 SP_PLUGIN_SCRIPTS=sandbox", en: "Ask the owner to set SP_PLUGIN_SCRIPTS=sandbox" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_CLASS: { level: 'problem', zh: "此插件类别不能进入脚本沙箱", en: "This plugin class cannot enter the sandbox", fix: { zh: "仅将 script 类插件交给沙箱", en: "Pass only script plugins to SES" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_HASH: { level: 'problem', zh: "脚本文件与内容哈希不符", en: "Script bytes do not match the content hash", fix: { zh: "重新应用插件并校验文件", en: "Reapply the plugin and verify the files" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_IMPORT: { level: 'problem', zh: "脚本导入超出沙箱范围", en: "Script import is outside the sandbox", fix: { zh: "只导入 sp:sdk@1 和插件内相对路径，避免循环导入", en: "Import only sp:sdk@1 and own relative files; avoid cycles" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_SYNTAX: { level: 'problem', zh: "脚本使用了不支持的模块语法", en: "Script uses unsupported module syntax", fix: { zh: "使用同步 setup 和静态导入，参见脚本文档", en: "Use synchronous setup and static imports; see the script reference" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_LIMIT: { level: 'problem', zh: "脚本文件超过沙箱上限", en: "Script source exceeds sandbox limits", fix: { zh: "缩减文件数量和代码体积", en: "Reduce source size and file count" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_SANDBOX_MATH: { level: 'problem', zh: "脚本数学运算超出确定性范围", en: "Script math is outside the deterministic domain", fix: { zh: "只用有限数字，幂指数必须是整数", en: "Use finite numbers and integer exponents" }, doc: 'docs/PLUGINS.md#13-scripts-p3' },
  PLUGIN_UNKNOWN: {
    level: 'refusal', doc: D.cosmetic,
    zh: '本服务器没有安装这个插件', en: 'This server has not installed that plugin',
    fix: { zh: '把插件文件夹放进服务器的 plugins/ 文件夹（文件夹名就是插件 id）；它不在了的话，在插件面板里把它关掉。', en: 'Put the plugin folder into the server\'s plugins/ folder (the folder name is the plugin id); if it is gone, switch it off in the 插件 panel.' },
  },
  PLUGIN_BLOCKED: {
    level: 'refusal', doc: D.cosmetic,
    zh: '这个插件不能在这里启用：这个版本不应用它的类别，或者它的作用范围不包括这里', en: 'That plugin cannot be switched on here: this version does not apply its class, or its scope does not include this place',
    fix: { zh: '外观插件的 class 写 "cosmetic"；scope 写 ["room"]（房主给整个房间开）或 ["personal"]（玩家只给自己开），两样都要就都写上。', en: 'A cosmetic plugin has "class": "cosmetic"; its scope is ["room"] (the host switches it on for the room), ["personal"] (a player for themself) or both.' },
  },
  PLUGIN_DEPENDENCY: {
    level: 'refusal', doc: D.manifest,
    zh: '缺少这个插件需要的其他插件（或者版本不对），或者几个插件的加载顺序互相指向、成了一个圈', en: 'A plugin it requires is missing or out of its version range, or the load-order hints of some plugins form a cycle',
    fix: { zh: '安装 requires 里写的插件（版本要在写的范围内）；或者删掉 loadAfter / loadBefore 里互相指向的那几条。', en: 'Install the plugins its "requires" names (within their ranges), or remove the loadAfter / loadBefore entries that point at each other.' },
  },
  PLUGIN_CONFLICT: {
    level: 'refusal', doc: D.manifest,
    zh: '选中的插件互相冲突，不能一起用', en: 'The chosen plugins conflict with each other',
    fix: { zh: '关掉其中一个；插件的 conflicts 写着它和谁不能一起用。', en: 'Switch one of them off; a plugin\'s "conflicts" says which ones it cannot be used with.' },
  },
  PLUGIN_RULE_CONFLICT: {
    level: 'refusal', doc: D.rules,
    zh: '两个插件把同一个规则开关设成了不同的选项（{path}）', en: 'Two plugins set the same rule switch to different options ({path})',
    fix: { zh: '只保留其中一个插件，或让它们选择同一个选项。', en: 'Keep only one of the plugins, or make them choose the same option.' },
  },
  PLUGIN_RULES: {
    level: 'problem', doc: D.rules,
    zh: '清单里的 rules 写错了：开关或选项不在规定的四种里，或者这个类别的插件不能声明规则', en: 'The manifest rules are wrong: an unknown switch or option, or this plugin class cannot declare rules',
    fix: { zh: 'rules 只能写 shopBias、prepLoadout、morphPairing、unequip，每个用规定的两个选项；只有 content、script、trusted 可以写。', en: 'rules may name only shopBias, prepLoadout, morphPairing and unequip, each with its two options; only content, script and trusted plugins may declare them.' },
  },
  PLUGIN_LIMIT: {
    level: 'refusal', doc: D.cosmetic,
    zh: '超出了本服务器的上限：{detail}', en: 'Over this server\'s limit: {detail}',
    fix: { zh: '少开几个插件，或者让插件小一点（压缩图片和声音、删掉没用到的文件、少用整条引用）。', en: 'Switch on fewer plugins, or make them smaller (compress pictures and sounds, remove unused files, fewer whole-record references).' },
  },

  PLUGIN_INCOMPATIBLE: {
    level: 'refusal', doc: D.rooms,
    zh: '这个玩法插件不适配本服务器的游戏版本（或插件接口版本）', en: 'That gameplay plugin is not made for this server\'s game version (or its plugin API)',
    fix: { zh: '换一个适配本版本的插件版本（清单的 "app" 写着它适配的游戏版本），或者请作者更新。', en: 'Use a version of the plugin made for this game version (its "app" says which), or ask its author for an update.' },
  },
  PLUGIN_BUSY: {
    level: 'refusal', doc: D.rooms,
    zh: '本服务器同时运行的插件组合已达上限', en: 'This server already runs as many plugin sets at once as it allows',
    fix: { zh: '稍后再试，或者和正在用插件的房间选同样的插件；服主可以在 plugins/config.json 里调高 maxSets。', en: 'Try again later, or pick the same plugins as a room already using some; the server owner can raise maxSets in plugins/config.json.' },
  },

  // ---- the manifest (plugin.json) ------------------------------------------------------------------------------------
  PLUGIN_NO_MANIFEST: {
    level: 'problem', doc: D.manifest,
    zh: '插件文件夹里没有 plugin.json', en: 'The plugin folder has no plugin.json',
    fix: { zh: '每个插件文件夹都要有一个 plugin.json（插件的清单）。在工作台点「新建插件」，或运行 node tools/plugin.mjs new，就会生成一个。旧式的 pack.json 是 packs/ 文件夹里的语言包用的。', en: 'Every plugin folder needs a plugin.json (its manifest). The studio\'s 新建插件 or node tools/plugin.mjs new writes one. The older pack.json belongs to a language pack in packs/.' },
  },
  PLUGIN_JSON: {
    level: 'problem', doc: D.files,
    zh: '{where} 读不出来：它不是有效的 JSON，或者太大', en: '{where} cannot be read: it is not valid JSON, or too large',
    fix: { zh: '检查有没有多写或少写逗号、引号、括号（最后一项后面不能有逗号）；单个 JSON 文件不能超过 8 MB。用工作台编辑可以避免手写出错。', en: 'Look for a missing or extra comma, quote or bracket (no comma after the last item); a JSON file may be 8 MB at most. Editing in the studio avoids typing mistakes.' },
  },
  PLUGIN_JSON_LIMIT: {
    level: 'problem', doc: D.files,
    zh: '{where} 超出了 JSON 的限制（嵌套太深，或数字太大）', en: '{where} is beyond the JSON limits (nested too deep, or a number too large)',
    fix: { zh: '嵌套不要超过 64 层，数字要是正常的有限数字，绝对值不超过 10 亿。', en: 'Nest at most 64 levels; numbers must be finite and within ±1,000,000,000.' },
  },
  PLUGIN_MANIFEST_SHAPE: {
    level: 'problem', doc: D.manifest,
    zh: 'plugin.json 的最外层不是 { … } 对象', en: 'plugin.json is not a JSON object at the top',
    fix: { zh: '整个文件要用一对大括号 { } 包起来，里面写 "名字": 值。', en: 'The whole file is one { } object of "name": value pairs.' },
  },
  PLUGIN_MANIFEST_VERSION: {
    level: 'problem', doc: D.manifest, autofix: 'setManifest',
    zh: '缺少 "manifest": 2，或者写成了别的数', en: '"manifest": 2 is missing or another number',
    fix: { zh: '在 plugin.json 里写上 "manifest": 2（这是清单格式的版本，现在只能是 2）。', en: 'Write "manifest": 2 in plugin.json (the version of the manifest format; 2 is the only one).' },
  },
  PLUGIN_ID: {
    level: 'problem', doc: D.manifest,
    zh: '文件夹名「{id}」不能当插件 id', en: 'The folder name “{id}” is not a plugin id',
    fix: { zh: '插件 id 就是文件夹名：2–32 个小写英文字母、数字或 -，不能以 - 开头（例如 texas-red）。把文件夹改个名就行。', en: 'The plugin id is the folder name: 2–32 lower-case letters, digits and -, not starting with - (e.g. texas-red). Rename the folder.' },
  },
  PLUGIN_ID_MISMATCH: {
    level: 'warning', doc: D.manifest, autofix: 'dropField',
    zh: '清单里写的 "id" 和文件夹名「{id}」不一样，以文件夹名为准', en: 'The "id" in the manifest is not the folder name “{id}”; the folder name decides',
    fix: { zh: '删掉清单里的 "id"（文件夹名就是 id），或者把它改得和文件夹名一样。', en: 'Remove "id" from the manifest (the folder name is the id) or make it the folder name.' },
  },
  PLUGIN_FIELD_UNKNOWN: {
    level: 'warning', doc: D.manifest, autofix: 'dropField',
    zh: '「{where}」不是清单里的字段，被忽略了', en: '“{where}” is not a field of the manifest and is ignored',
    fix: { zh: '检查拼写（大小写也要一样），或者删掉它。', en: 'Check its spelling (case matters) or remove it.' },
  },
  PLUGIN_CLASS: {
    level: 'problem', doc: D.manifest,
    zh: '没有写插件类别 "class"，或者写了不认识的类别', en: '"class" is missing or not a plugin class',
    fix: { zh: '外观插件写 "class": "cosmetic"。可选的类别：lang（语言）、cosmetic（外观）、content（数据）、script、ui、trusted。', en: 'A cosmetic plugin has "class": "cosmetic". The classes: lang, cosmetic, content, script, ui, trusted.' },
  },
  PLUGIN_TEXT: {
    level: 'warning', doc: D.manifest,
    zh: '「{where}」应该是一段文字，或者 { "语言": "文字" }，被忽略了', en: '“{where}” should be a text or { "<lang>": "text" }; it is ignored',
    fix: { zh: '写成 "名字"，或者 { "zh": "名字", "en": "Name" }。', en: 'Write "Name" or { "zh": "名字", "en": "Name" }.' },
  },
  PLUGIN_LANG_CODE: {
    level: 'problem', doc: D.manifest,
    zh: '「{where}」不是语言代码', en: '“{where}” is not a language code',
    fix: { zh: '用 zh、en、ja、ko、zh-TW 这样的语言代码。', en: 'Use a language code such as zh, en, ja, ko or zh-TW.' },
  },
  PLUGIN_VERSION: {
    level: 'problem', doc: D.manifest, autofix: 'setVersion',
    zh: '插件的版本号 "version" 没写，或者写法不对', en: 'The plugin\'s "version" is missing or not a version number',
    fix: { zh: '写成三段数字，例如 "1.0.0"；以后每次改了插件都把它调大一点（1.0.1、1.1.0 …）。', en: 'Write three numbers such as "1.0.0"; raise it whenever the plugin changes (1.0.1, 1.1.0 …).' },
  },
  PLUGIN_APP: {
    level: 'problem', doc: D.manifest, autofix: 'setApp',
    zh: '适配的游戏版本 "app" 没写，或者写法不对', en: 'The game versions the plugin is made for, "app", are missing or not a range',
    fix: { zh: '写成一个版本范围，例如 ">=0.3.0 <0.4.0"（本游戏现在是 {app}）。', en: 'Write a range such as ">=0.3.0 <0.4.0" (this game is {app}).' },
  },
  PLUGIN_APP_MISMATCH: {
    level: 'warning', doc: D.manifest, autofix: 'setApp',
    zh: '这个插件是给游戏 {range} 做的，本服务器是 {app}', en: 'The plugin is made for the game {range}; this server is {app}',
    fix: { zh: '外观插件照样能用（只是提醒）。在新版本里确认没问题后，把 "app" 改成包含 {app} 的范围。', en: 'A cosmetic plugin still works (a reminder only). Once it is checked with this version, widen "app" to include {app}.' },
  },
  PLUGIN_API: {
    level: 'problem', doc: D.manifest, autofix: 'setApi',
    zh: '插件接口级别 "api" 没写、不是整数，或者本游戏不支持', en: 'The plugin API level "api" is missing, not an integer, or not supported',
    fix: { zh: '写 "api": {current}（本游戏支持 {min}–{current}）。', en: 'Write "api": {current} (this game supports {min}–{current}).' },
  },
  PLUGIN_SCOPE: {
    level: 'problem', doc: D.manifest, autofix: 'setScope',
    zh: '作用范围 "scope" 写得不对', en: '"scope" is not one this class allows',
    fix: { zh: '外观插件写 ["room", "personal"]：room 是房主给整个房间开，personal 是玩家在设置里只给自己开。', en: 'A cosmetic plugin has ["room", "personal"]: room — the host switches it on for the whole room; personal — a player for themself in 设置.' },
  },
  PLUGIN_HOMEPAGE: {
    level: 'warning', doc: D.manifest,
    zh: '主页 "homepage" 不是 http(s) 网址，被忽略了', en: '"homepage" is not an http(s) address and is ignored',
    fix: { zh: '写完整的网址，例如 https://example.com/my-plugin，或者删掉它。', en: 'Write a full address such as https://example.com/my-plugin, or remove it.' },
  },
  PLUGIN_DEPS: {
    level: 'problem', doc: D.manifest,
    zh: '依赖关系（requires / optional / conflicts）写得不对：{where}', en: 'A dependency (requires / optional / conflicts) is not right: {where}',
    fix: { zh: '写成 { "其他插件的 id": "版本范围" }，例如 { "base-skin": ">=1.0.0" }；不能写自己，同一个插件不能既需要又冲突，最多 32 个。', en: 'Write { "<plugin id>": "<version range>" }, e.g. { "base-skin": ">=1.0.0" }; never the plugin itself, never one both required and in conflict, at most 32.' },
  },
  PLUGIN_ORDER_HINTS: {
    level: 'problem', doc: D.manifest,
    zh: '加载顺序（loadAfter / loadBefore / priority）写得不对：{where}', en: 'A load-order hint (loadAfter / loadBefore / priority) is not right: {where}',
    fix: { zh: 'loadAfter 和 loadBefore 是插件 id 的列表（同一个 id 不能两边都写，也不能写自己）；priority 是 -1000 到 1000 的整数，默认 0。', en: 'loadAfter and loadBefore are lists of plugin ids (never one in both, never the plugin itself); priority is an integer within ±1000, default 0.' },
  },
  PLUGIN_SETTING: {
    level: 'problem', doc: D.manifest,
    zh: '设置项 "settings" 写得不对：{where}', en: 'A setting is not right: {where}',
    fix: { zh: '每个设置项写 { "type": … }：boolean（开关）、integer / number（要写 min 和 max）、enum（要写 options 列表）；默认值要在范围内；最多 32 个，不能是自由文字。', en: 'Each setting is { "type": … }: boolean, integer / number (with min and max), enum (with options); its default within them; at most 32, no free text.' },
  },
  PLUGIN_SETTING_FIELD: {
    level: 'warning', doc: D.manifest,
    zh: '设置项里有不认识的字段「{where}」，被忽略了', en: 'A setting has a field it does not know, “{where}”; it is ignored',
    fix: { zh: '设置项只认 type、default、min、max、step、options、label 这几个字段。', en: 'A setting knows type, default, min, max, step, options and label only.' },
  },
  PLUGIN_PART_CLASS: {
    level: 'problem', doc: D.manifest,
    zh: '「{where}」不是 {class} 插件能带的东西', en: '“{where}” is not something a {class} plugin carries',
    fix: { zh: '外观插件只带 "assets"（素材）和 "theme"（主题）；界面插件带 "entry.client" 和 "slots"；改数值、加干员之类的要做成 content 插件。', en: 'A cosmetic plugin carries "assets" and "theme" only, a ui plugin "entry.client" and "slots"; numbers and new operators belong to a content plugin.' },
  },
  PLUGIN_PART_SHAPE: {
    level: 'problem', doc: D.manifest,
    zh: '「{where}」的写法不对', en: '“{where}” is not written the right way',
    fix: { zh: '写成插件文件夹里的一个 .json 文件路径（或这些路径的列表）；"assets" 和 "theme" 也可以直接写成 { … } 对象。', en: 'Write the path of a .json file of the plugin folder (or a list of them); "assets" and "theme" may also be the { … } object itself.' },
  },
  PLUGIN_ASSET_FILE: {
    level: 'problem', doc: D.cosmetic,
    zh: '素材「{where}」写的文件不对：不是插件文件夹里的路径，或者不是这个位置要的文件类型', en: 'The file of “{where}” is not right: not a path inside the plugin folder, or not the kind of file this place takes',
    fix: { zh: '写插件文件夹里的相对路径，例如 art/avatar.png。图片位置用 .png .jpg .webp，声音位置用 .mp3 .ogg，模型用 .skel 和 .atlas（贴图 .png）。', en: 'Write a path inside the plugin folder such as art/avatar.png. Pictures are .png .jpg .webp, sounds .mp3 .ogg, models .skel with .atlas (pages .png).' },
  },
  PLUGIN_THEME_URL: {
    level: 'problem', doc: D.cosmetic,
    zh: '主题「{where}」里写了网址', en: '“{where}” names a URL',
    fix: { zh: '主题变量只能写颜色、时间或缓动，不能写网址、var() 或其他表达式。', en: 'A theme variable is a colour, a time or an easing — never a URL, var() or another expression.' },
  },
  PLUGIN_THEME_UNUSED: {
    level: 'warning', doc: D.cosmetic,
    zh: '这条提示来自旧版本：这一版会在玩家自己的画面上应用主题变量', en: 'This note is from an older version: this version applies theme variables on the player\'s own screen',
    fix: { zh: '这一版不再发出这条提示。主题变量写在 theme.vars 里，只能用本安装的设计变量。', en: 'This version no longer raises this note. Write theme.vars, and only this installation\'s design tokens.' },
  },
  PLUGIN_THEME_NAME: {
    level: 'problem', doc: D.cosmetic,
    zh: '主题变量「{where}」不是本安装的设计变量', en: '“{where}” is not a design token of this installation',
    fix: { zh: '只能设置 public/css/theme.css 里 :root 的颜色、时间和缓动变量，例如 --text-hi、--t-fast、--ease-out。', en: 'Set only a colour, time or easing custom property of :root in public/css/theme.css, such as --text-hi, --t-fast or --ease-out.' },
  },
  PLUGIN_THEME_VALUE: {
    level: 'problem', doc: D.cosmetic,
    zh: '主题变量「{where}」的值不是这种变量允许的颜色、时间或缓动', en: '“{where}” is not a colour, a time or an easing this token allows',
    fix: { zh: '颜色用 #rgb、#rgba、#rrggbb、#rrggbbaa 或 rgb()/rgba()/hsl()/hsla()；时间用 0–2000ms 或 0–2s；缓动用关键字或 cubic-bezier()。不能写网址、引号或表达式。', en: 'A colour is #rgb, #rgba, #rrggbb, #rrggbbaa or rgb()/rgba()/hsl()/hsla(). A time is 0–2000ms or 0–2s. An easing is a keyword or cubic-bezier(). No URL, quotes or expression.' },
  },
  PLUGIN_THEME_LIMIT: {
    level: 'problem', doc: D.cosmetic,
    zh: '主题变量超过了 64 个', en: 'There are more than 64 theme variables',
    fix: { zh: '一个插件最多写 64 个主题变量。', en: 'One plugin sets at most 64 theme variables.' },
  },
  PLUGIN_THEME_SHAPE: {
    level: 'problem', doc: D.cosmetic,
    zh: '主题「{where}」不是变量表', en: '“{where}” is not a theme variable map',
    fix: { zh: '写成 "theme": { "vars": { "--text-hi": "#f4faf7" } }。键都是 -- 开头的扁平对象也可以。', en: 'Write "theme": { "vars": { "--text-hi": "#f4faf7" } }. A flat object whose every key starts with -- is also accepted.' },
  },
  PLUGIN_NOTICE_SHAPE: {
    level: 'problem', doc: D.manifest,
    zh: '公告「{where}」的写法不对', en: '“{where}” is not a notice',
    fix: { zh: 'notices 是列表，每条有 id（小写字母、数字和 -）、title、body，可以有 date（YYYY-MM-DD）和 i18n。', en: 'notices is a list. Each item has id (lower-case letters, digits and -), title and body, and may have date (YYYY-MM-DD) and i18n.' },
  },
  PLUGIN_NOTICE_LIMIT: {
    level: 'problem', doc: D.manifest,
    zh: '公告超过了条数或字数上限', en: 'A notice exceeds the count or the length limit',
    fix: { zh: '一个插件最多 20 条公告，标题最多 80 字，正文最多 2000 字。', en: 'One plugin has at most 20 notices, a title of at most 80 characters and a body of at most 2000.' },
  },
  PLUGIN_NOTICE_TEXT: {
    level: 'problem', doc: D.manifest,
    zh: '公告「{where}」的标题或正文不是纯文本，或是空的', en: '“{where}” has a title or a body that is empty or not plain text',
    fix: { zh: '标题和正文都要有字。正文可以换行。不要写控制字符。链接就当普通文字写。', en: 'Title and body must both contain text. The body may contain newlines. No control characters. Write a link as text.' },
  },
  PLUGIN_NOTICE_LANG: {
    level: 'problem', doc: D.manifest,
    zh: '公告「{where}」的语言代码不认识', en: '“{where}” names a language this game does not know',
    fix: { zh: 'i18n 的键用本游戏认识的语言代码，例如 en、ja、ko、zh-TW。', en: 'An i18n key is a language code this game knows, such as en, ja, ko or zh-TW.' },
  },
  PLUGIN_ENTRY: {
    level: 'problem', doc: D.manifest,
    zh: '入口 "entry" 写得不对，或者这个类别不能有入口：{where}', en: 'An entry point is not right, or this class has none: {where}',
    fix: { zh: '外观插件不需要 "entry"，删掉它。界面插件写 "entry": { "client": "ui/index.html" }（插件文件夹里的一个 .html 文件）。', en: 'A cosmetic plugin needs no "entry": remove it. A ui plugin has "entry": { "client": "ui/index.html" } (an .html file of the plugin folder).' },
  },
  PLUGIN_LANG_ONLY: {
    level: 'problem', doc: D.lang, autofix: 'dropField',
    zh: '「{where}」只属于语言包（lang 类），{class} 插件不能写', en: '“{where}” belongs to a language pack (class lang), not a {class} plugin',
    fix: { zh: '删掉它；要做语言包的话，把 class 改成 "lang"。', en: 'Remove it; for a language pack, make "class": "lang".' },
  },
  PLUGIN_PERMISSION: {
    level: 'problem', doc: D.permissions,
    zh: '权限写得不对：「{where}」不认识，或者 {class} 插件不能有', en: 'A permission is not right: “{where}” is unknown or not one a {class} plugin may have',
    fix: { zh: '外观插件能用的权限：assets.override（替换本安装已有的素材）、assets.add（新增一个本安装没有的条目）、theme；界面插件用 ui.frame。"permissions" 要写成列表。', en: 'A cosmetic plugin\'s permissions: assets.override (replace art the installation has), assets.add (a new entry), theme; a ui plugin\'s: ui.frame. "permissions" is a list.' },
  },
  PLUGIN_PERMISSION_MISSING: {
    level: 'problem', doc: D.permissions, autofix: 'addPermission',
    zh: '「{where}」需要权限 {need}，清单里没有声明', en: '“{where}” needs the permission {need}, which the manifest does not declare',
    fix: { zh: '在 "permissions" 里加上 "{need}"。', en: 'Add "{need}" to "permissions".' },
  },
  PLUGIN_PERMISSION_UNUSED: {
    level: 'warning', doc: D.permissions, autofix: 'dropPermission',
    zh: '声明了权限 {permission}，但插件里没有用到它的东西', en: 'The permission {permission} is declared but nothing in the plugin uses it',
    fix: { zh: '从 "permissions" 里删掉 "{permission}"（声明的权限越少，越容易让人放心）。', en: 'Remove "{permission}" from "permissions" (the fewer, the more trust).' },
  },
  PLUGIN_EMPTY: {
    level: 'warning', doc: D.cosmetic,
    zh: '这个插件什么都没带', en: 'The plugin carries nothing',
    fix: { zh: '外观插件要在 "assets" 里写要替换的素材。在工作台用模板开始最省事。', en: 'A cosmetic plugin lists the art it replaces in "assets". The studio\'s templates are the easiest start.' },
  },

  // ---- the files of the folder ----------------------------------------------------------------------------------------
  PLUGIN_FILE_LINK: {
    level: 'problem', doc: D.files,
    zh: '{where} 是符号链接（快捷方式），插件里只能放普通文件', en: '{where} is a symbolic link; a plugin holds plain files only',
    fix: { zh: '把真正的文件复制进插件文件夹，再删掉这个链接。', en: 'Copy the real file into the plugin folder and remove the link.' },
  },
  PLUGIN_FILE_NAME: {
    level: 'problem', doc: D.files,
    zh: '文件名「{where}」不能用', en: 'The file name “{where}” cannot be used',
    fix: { zh: '文件名和文件夹名只用英文字母、数字、. _ - 和空格；不要以 . 开头，也不要有 ".." 这样的部分。', en: 'Names of files and folders use letters, digits, . _ - and spaces; none starts with . or is "..".' },
  },
  PLUGIN_FILE_TYPE: {
    level: 'problem', doc: D.files, autofix: 'moveOut',
    zh: '{where}：这种文件不能放进 {class} 插件', en: '{where}: a {class} plugin may not carry this kind of file',
    fix: { zh: '图片用 .png .jpg .webp（不收 SVG），声音用 .mp3 .ogg，模型用 .skel .atlas，说明文档 .md .txt 和 README / LICENSE 可以放。把这个文件移出插件文件夹（一键修复会把它移到 plugins/_moved/ 里，不会删掉），或转换成能用的格式。', en: 'Pictures are .png .jpg .webp (no SVG), sounds .mp3 .ogg, models .skel .atlas; documents (.md, .txt, README, LICENSE) may sit beside them. Move the file out of the plugin folder (the one-click fix moves it to plugins/_moved/, never deletes it) or convert it.' },
  },
  PLUGIN_FILE_FRAME: {
    level: 'problem', doc: D.files,
    zh: '{where} 是界面文件，但不在 entry.client 所在的文件夹里', en: '{where} is a frame file outside the folder of entry.client',
    fix: { zh: '把界面插件的 .html .js .css 都放进 entry.client 那个文件夹。', en: 'Put a ui plugin\'s .html .js .css into the folder of entry.client.' },
  },
  PLUGIN_FILE_SIZE: {
    level: 'problem', doc: D.files,
    zh: '插件太大了：{where}', en: 'The plugin is too large: {where}',
    fix: { zh: '一个插件最多 200 MB、5000 个文件（文件夹最多 2000 个、12 层），单个 JSON 最多 8 MB。压缩图片和声音，删掉没用到的文件，或者拆成几个插件。', en: 'A plugin holds at most 200 MB in 5000 files (2000 folders, 12 levels deep), a JSON file at most 8 MB. Compress pictures and sounds, remove unused files, or split it.' },
  },
  PLUGIN_FILE_MISSING: {
    level: 'problem', doc: D.files,
    zh: '清单里写了 {file}，但插件文件夹里没有这个文件', en: 'The manifest names {file}, which the plugin folder does not hold',
    fix: { zh: '把文件放到这个位置（注意文件夹和大小写都要一样），或者改正清单里的路径。在工作台把文件拖到对应的格子里就会放对。', en: 'Put the file there (folders and case must match) or correct the path in the manifest. Dropping the file on its slot in the studio puts it in the right place.' },
  },
  PLUGIN_FILE_OUTSIDE: {
    level: 'problem', doc: D.files,
    zh: '{where} 指到了插件文件夹外面，或者在插件文件夹里读不出来', en: '{where} leads out of the plugin folder or cannot be read inside it',
    fix: { zh: '插件只能用自己文件夹里的普通文件：把文件复制进来，别用链接，并检查文件能不能打开。', en: 'A plugin uses plain files of its own folder only: copy the file in (no link) and check that it opens.' },
  },

  // ---- language packs and the older pack folders -------------------------------------------------------------------
  PLUGIN_LANG: {
    level: 'problem', doc: D.lang,
    zh: '语言包的语言写得不对：{where}', en: 'A language pack\'s language is not right: {where}',
    fix: { zh: '"lang" 写语言代码（en、ja、zh-TW …）；zh 是源语言，不能做成语言包；machineTranslated 写 true 或 false。', en: '"lang" is a language code (en, ja, zh-TW …); zh is the source language and never a pack; machineTranslated is true or false.' },
  },
  PLUGIN_LANG_FILES: {
    level: 'problem', doc: D.lang,
    zh: '语言包的文件表 "files" 写得不对：{where}', en: 'A language pack\'s "files" are not right: {where}',
    fix: { zh: '"files" 写 { "ui": "ui.json" }（必填）和可选的 { "data": "data.json" }，都是包里的 .json 文件。', en: '"files" is { "ui": "ui.json" } (required) and optionally "data", both .json files of the pack.' },
  },
  PLUGIN_PACK: {
    level: 'problem', doc: D.lang,
    zh: '旧式内容包（pack.json）写得不对，或者这个版本不加载它的类型：{where}', en: 'An older content pack (pack.json) is not right, or this version does not load its type: {where}',
    fix: { zh: 'packs/ 里只加载语言包（"type": "lang"）。外观和数据请做成 plugins/ 里的插件（plugin.json，"manifest": 2）。', en: 'packs/ loads language packs ("type": "lang") only. Art and data are plugins of plugins/ (plugin.json, "manifest": 2).' },
  },

  // ---- a cosmetic plugin's asset overlay and its lock ---------------------------------------------------------------
  PLUGIN_ASSETS_SHAPE: {
    level: 'problem', doc: D.cosmetic,
    zh: '素材表 "assets" 的写法不对：{where}', en: 'The asset overlay is not written the right way: {where}',
    fix: { zh: '按 data/assets.json 的样子写：chars → 干员 id → avatar / portrait / spine …，声音在 audio 里。用工作台的模板就不用手写。', en: 'Follow data/assets.json: chars → operator id → avatar / portrait / spine …, sounds under audio. The studio\'s templates write it for you.' },
  },
  PLUGIN_ASSET_KEY: {
    level: 'problem', doc: D.cosmetic,
    zh: '「{where}」不是这个位置能用的键名', en: '“{where}” is not a key this place takes',
    fix: { zh: '键名怎么写由它所在的位置决定：容器的键是条目的内部 id（字母、数字、_ . / -，例如 char_102_texas）；`skins` 这一层的键额外允许 @ # +，最多 64 个字符（条目的键最多 128 个）。照抄本安装清单里的名字，或按这个字符集取一个新名字。', en: 'The place decides the shape of a key: a container key is an entry\'s internal id (letters, digits, _ . / -, e.g. char_102_texas); a key of the `skins` map also allows @ # + and is at most 64 characters (an entry key takes up to 128). Copy a name from this installation\'s manifest, or make a new one within that character set.' },
  },
  PLUGIN_ASSET_IGNORED: {
    level: 'warning', doc: D.cosmetic, autofix: 'dropAsset',
    zh: '「{where}」不是外观插件能改的位置，被忽略了', en: '“{where}” is not something a cosmetic plugin changes; it is ignored',
    fix: { zh: '检查拼写；外观插件能改的位置见 PLUGINS.md §9 的表（头像、立绘、模型、图标、界面图、语音、音效、音乐）。', en: 'Check the spelling; PLUGINS.md §9 lists what a cosmetic plugin changes (avatars, portraits, models, icons, interface pictures, voices, sounds, music).' },
  },
  PLUGIN_REF: {
    level: 'problem', doc: D.cosmetic, autofix: 'dropAsset',
    zh: '引用「{where}」不对：写法不对，或者本安装没有它指向的素材', en: 'The reference at “{where}” is not right: not written as one, or the installation has no such art',
    fix: { zh: '{ "ref": "char_112_siege" } 借用本安装已有的同类条目。在工作台点「用已有的素材」从列表里选，就不会写错；或者删掉这条。', en: '{ "ref": "char_112_siege" } borrows an entry of the same kind the installation has. Pick it from the list with the studio\'s 用已有的素材, or remove the write.' },
  },
  PLUGIN_SPINE: {
    level: 'problem', doc: D.cosmetic,
    zh: 'Spine 模型「{where}」写得不对', en: 'The Spine model at “{where}” is not right',
    fix: { zh: '.skel 和 .atlas 放在同一个文件夹、用同一个名字（t.skel + t.atlas），贴图 .png 放在 atlas 旁边并写进 textures；动画数据不要手写，点「打包」自动生成。', en: 'The .skel and the .atlas sit side by side with one name (t.skel + t.atlas), the .png pages beside the atlas and in "textures"; clip data is never written by hand — 打包 makes it.' },
  },
  PLUGIN_SPINE_PAGES: {
    level: 'problem', doc: D.cosmetic, autofix: 'setTextures',
    zh: '{file} 用到的贴图没有写进 "textures"', en: '{file} uses a page that "textures" does not list',
    fix: { zh: '把 atlas 里每一页贴图都写进 "textures"（一键修复会按 atlas 自动填好）。', en: 'List every page of the atlas in "textures" (the one-click fix fills it from the atlas).' },
  },
  PLUGIN_SPINE_NOTE: {
    level: 'warning', doc: D.cosmetic,
    zh: '模型 {file} 有小问题：{detail}', en: 'The model {file} has a small issue: {detail}',
    fix: { zh: '多半是 "textures" 写了 atlas 没用到的图片，或者有部件在 atlas 里找不到。模型通常还能显示，在预览里看一下。', en: 'Usually "textures" names a picture the atlas does not use, or a part is missing from the atlas. The model usually still shows: look at it in the preview.' },
  },
  PLUGIN_SPINE_PARSE: {
    level: 'problem', doc: D.cosmetic,
    zh: '模型 {file} 读不出来：不是游戏能读的 Spine 3.8 二进制骨骼，或者里面没有动画', en: 'The model {file} cannot be read: not a Spine 3.8 binary skeleton the game reads, or it has no animations',
    fix: { zh: '用 Spine 3.8 导出二进制 .skel（不要 .json 骨骼），并确认导出时带了动画（Idle、Attack、Die …）。', en: 'Export a binary .skel with Spine 3.8 (not a .json skeleton), with its animations (Idle, Attack, Die …).' },
  },
  PLUGIN_LOCK: {
    level: 'problem', doc: D.cosmetic, autofix: 'pack',
    zh: 'plugin.lock.json 坏了，或者是旧格式', en: 'plugin.lock.json is broken or of another format',
    fix: { zh: '在工作台点「打包」，或运行 node tools/plugin.mjs pack，重新生成它；不要手改这个文件。', en: 'Make it again with the studio\'s 打包 or node tools/plugin.mjs pack; never edit it by hand.' },
  },
  PLUGIN_LOCK_MISSING: {
    level: 'problem', doc: D.cosmetic, autofix: 'pack',
    symptom: { zh: '插件没出现在列表里（被跳过），因为模型还没打包', en: 'The plugin is skipped: its model is not packed yet' },
    zh: '模型 {file} 还没有动画数据（plugin.lock.json 里没有它）', en: 'The model {file} has no clip data yet (plugin.lock.json lacks it)',
    fix: { zh: '点「打包」（或运行 node tools/plugin.mjs pack <插件>），它会读出模型的动画写进 plugin.lock.json。', en: 'Press 打包 (or run node tools/plugin.mjs pack <plugin>): it reads the model\'s clips into plugin.lock.json.' },
  },
  PLUGIN_LOCK_STALE: {
    level: 'problem', doc: D.cosmetic, autofix: 'pack',
    symptom: { zh: '换了模型文件后插件消失了', en: 'The plugin disappeared after a model file was replaced' },
    zh: '模型 {file} 改过了，plugin.lock.json 里还是旧模型的数据', en: 'The model {file} changed; plugin.lock.json still holds the old one\'s data',
    fix: { zh: '再点一次「打包」（或运行 node tools/plugin.mjs pack），锁文件就会跟上新模型。', en: 'Press 打包 again (or run node tools/plugin.mjs pack): the lock follows the new model.' },
  },

  // ---- the registry's scan ------------------------------------------------------------------------------------------
  PLUGIN_DUPLICATE: {
    level: 'problem', doc: D.manifest,
    zh: '插件 id 或语言重复了：{where}', en: 'A plugin id or a language is taken twice: {where}',
    fix: { zh: '换一个文件夹名（插件 id；Windows 和 macOS 上大小写不同也算同一个），或者删掉重复的那个。', en: 'Rename the folder (the plugin id; on Windows and macOS another case is the same name) or remove the duplicate.' },
  },
  PLUGIN_UNREADABLE: {
    level: 'problem', doc: D.files,
    zh: '读取插件时出错：{detail}', en: 'Reading the plugin failed: {detail}',
    fix: { zh: '检查文件的读取权限；如果有程序正在写这个文件夹，等它写完再试。', en: 'Check the files\' permissions; if a program is writing the folder, wait until it is done.' },
  },
  PLUGIN_REQUIRES_MISSING: {
    level: 'warning', doc: D.manifest,
    zh: '它需要的插件 {dep} 没有安装，或者版本不在 {range} 里', en: 'The plugin it requires, {dep}, is not installed or not within {range}',
    fix: { zh: '把需要的插件也装上（版本在范围内）；不然房主在房间里开它时会被拒绝。', en: 'Install the required plugin within its range; otherwise a host switching it on is refused.' },
  },

  // ---- the studio's API ---------------------------------------------------------------------------------------------
  PLUGIN_STUDIO_PATH: {
    level: 'studio', doc: D.studio,
    zh: '这个路径不能用：{detail}', en: 'This path cannot be used: {detail}',
    fix: { zh: '文件只能放在插件自己的文件夹里；路径不能有 ..、以 . 开头的部分或特殊字符，也不能经过链接跑到外面。', en: 'Files stay inside the plugin\'s own folder: no .., no part starting with ., no special characters, no link leading out.' },
  },
  PLUGIN_STUDIO_SIZE: {
    level: 'studio', doc: D.studio,
    zh: '文件太大了（上限 {max}）', en: 'The file is too large (at most {max})',
    fix: { zh: '把图片或声音压缩一下再拖进来（立绘用 1024 像素以内的 PNG/WebP 就够了）。', en: 'Compress the picture or sound first (a portrait within 1024 px as PNG / WebP is plenty).' },
  },
  PLUGIN_STUDIO_EXISTS: {
    level: 'studio', doc: D.studio,
    zh: '已经有一个叫「{id}」的插件了', en: 'There is a plugin “{id}” already',
    fix: { zh: '换一个 id，或者在列表里打开那个插件接着改。', en: 'Choose another id, or open that plugin from the list.' },
  },
  PLUGIN_STUDIO_TEMPLATE: {
    level: 'studio', doc: D.studio,
    zh: '不认识这个模板：{template}', en: 'No such template: {template}',
    fix: { zh: '从工作台的模板列表里选一个（node tools/plugin.mjs new 不带参数会列出全部模板）。', en: 'Pick one of the studio\'s templates (node tools/plugin.mjs new without arguments lists them).' },
  },
  PLUGIN_STUDIO_TARGET: {
    level: 'studio', doc: D.studio,
    zh: '找不到要替换的目标「{target}」', en: 'No target “{target}” to replace',
    fix: { zh: '用搜索框按官方名字找（例如「德克萨斯」），从结果里点一个。', en: 'Search by its official name (e.g. 德克萨斯) and pick one of the results.' },
  },
  PLUGIN_STUDIO_FILE_KIND: {
    level: 'studio', doc: D.studio,
    zh: '这个位置要放 {kind}，拖进来的文件是 {ext}', en: 'This place takes {kind}; the dropped file is {ext}',
    fix: { zh: '图片位置放 .png .jpg .webp，声音位置放 .mp3 .ogg，模型位置一次放 .skel、.atlas 和它的 .png。', en: 'A picture place takes .png .jpg .webp, a sound place .mp3 .ogg, a model place its .skel, .atlas and .png together.' },
  },
  PLUGIN_STUDIO_REQUEST: {
    level: 'studio', doc: D.studio,
    zh: '工作台的请求不对：{detail}', en: 'The studio\'s request is not right: {detail}',
    fix: { zh: '刷新工作台页面再试；还不行的话，到 GitHub 提问并附上这段文字。', en: 'Reload the studio and try again; if it stays, ask on GitHub with this text.' },
  },
  PLUGIN_STUDIO_KEY: {
    level: 'studio', doc: D.studio,
    symptom: { zh: '工作台只能查看，不能新建或修改插件', en: 'The studio only shows plugins; it cannot make or change one' },
    zh: '改动插件需要工作台钥匙，这个浏览器还没有（或者钥匙不对）', en: 'Changing a plugin needs the studio\'s key, which this browser does not have (or it is not the right one)',
    fix: { zh: '打开服务器窗口里「Studio」那一行的地址（它带着钥匙，钥匙也在 plugins/.studio-key 文件里），或把它粘贴到工作台顶部的输入框。', en: 'Open the address on the "Studio" line of the server\'s window (it carries the key, which is also in plugins/.studio-key), or paste it into the box at the top of the studio.' },
  },
  // the studio's 删除所选 (POST /studio/api/plugins/remove): a plugin it leaves where it is, refused one by one
  PLUGIN_STUDIO_IN_USE: {
    level: 'studio', doc: D.studio,
    symptom: { zh: '「删除所选」留下了某个插件：它正在使用', en: 'A plugin chosen for removal stays: it is in use' },
    zh: '插件「{id}」正在使用中（房间 {rooms}），没有删除', en: 'The plugin “{id}” is in use (room {rooms}) and was not removed',
    fix: { zh: '等这些房间解散，或者房主在房间的插件面板里关掉它（正在对局的房间要等这一局结束才能改）后再删除。', en: 'Wait until those rooms close, or until their host switches it off in the room\'s plugin panel (a room in a match can do so once the match is over), then remove it.' },
  },
  PLUGIN_STUDIO_REMOVE: {
    level: 'studio', doc: D.studio,
    symptom: { zh: '「删除所选」没能移走某个插件', en: 'A plugin chosen for removal could not be moved' },
    zh: '插件「{id}」没能移到 plugins/_removed/：{detail}', en: 'The plugin “{id}” could not be moved to plugins/_removed/: {detail}',
    fix: { zh: '关掉正在使用这个插件里文件的程序（图片编辑器、Spine 等），确认服务器能写 plugins/ 文件夹后再试；也可以自己把这个文件夹移出 plugins/。', en: 'Close programs that hold files of this plugin open (an image editor, Spine …), make sure the server may write the plugins/ folder and try again — or move the folder out of plugins/ yourself.' },
  },

  // ---- a data plugin (class content, P1b — DESIGN §32.5, PLUGINS §10) -------------------------------------------------
  PLUGIN_CONTENT_FILE: {
    level: 'problem', doc: D.data,
    zh: '数据文件「{where}」读不了：{detail}', en: 'The data file “{where}” cannot be read: {detail}',
    fix: { zh: '"data" 里写插件文件夹里的 .json 文件路径；不要用符号链接，也不要指到文件夹外面。', en: '"data" lists .json files inside the plugin folder; no symbolic links, nothing outside the folder.' },
  },
  PLUGIN_CONTENT_FORMAT: {
    level: 'problem', doc: D.data,
    zh: '数据文件「{where}」的格式不对：{detail}', en: 'The data file “{where}” is not in the right format: {detail}',
    fix: { zh: '补丁文件写 { "patch": 1, "ops": [ … ] }，记录文件写 { "records": 1, "entries": [ … ] }；plugins/_template/content/ 里各有一个例子。', en: 'A patch file is { "patch": 1, "ops": [ … ] }, a records file { "records": 1, "entries": [ … ] }; plugins/_template/content/ has one of each.' },
  },
  PLUGIN_CONTENT_PERMISSION: {
    level: 'problem', doc: D.permissions, autofix: 'addPermission',
    zh: '数据文件「{where}」要用的权限没有声明：{detail}', en: 'The data file “{where}” needs a permission the manifest does not declare: {detail}',
    fix: { zh: '改已有的数值要 "data.patch"，新增记录（新干员、新敌人等）要 "data.add"，写进 "permissions"。', en: 'Changing existing values needs "data.patch", adding records (new operators, enemies …) "data.add": list them in "permissions".' },
  },
  PLUGIN_DATA_LIMIT: {
    level: 'problem', doc: D.data,
    zh: '数据太大或者嵌套太深（{where}）：{detail}', en: 'The data is too large or nested too deep ({where}): {detail}',
    fix: { zh: '一个 JSON 文件不超过 8 MB、嵌套不超过 64 层，整套内容不超过 300 MB；把大文件拆开，删掉没用的部分。', en: 'One JSON file is at most 8 MB and 64 levels deep, a whole content set at most 300 MB: split large files, drop what is unused.' },
  },
  PLUGIN_DATA_NUMBER: {
    level: 'problem', doc: D.data,
    zh: '数字不合规（{where}）：要是有限的数，绝对值不超过 10 亿', en: 'A number is not allowed ({where}): it must be finite and within ±1,000,000,000',
    fix: { zh: '把这个数字改小；数据里不能写无穷大或者特别大的数。', en: 'Make the number smaller; data never holds infinities or huge numbers.' },
  },
  PLUGIN_DATA_TYPE: {
    level: 'problem', doc: D.data,
    zh: '「{where}」不是普通的 JSON 值：{detail}', en: '“{where}” is not a plain JSON value: {detail}',
    fix: { zh: '只写 JSON 支持的值：对象、列表、字符串、数字、true / false、null。', en: 'Write JSON values only: objects, lists, strings, numbers, true / false, null.' },
  },
  PLUGIN_DATA_PATH: {
    level: 'problem', doc: D.data,
    zh: '「{where}」用了不允许的键名', en: '“{where}” uses a key that is not allowed',
    fix: { zh: '__proto__、prototype、constructor 这类键名不能用（它们能改坏程序里的对象），换一个名字。', en: 'Keys such as __proto__, prototype and constructor cannot be used (they could corrupt the program\'s objects): rename it.' },
  },
  PLUGIN_DATA_BOUND: {
    level: 'problem', doc: D.data,
    zh: '数值超出了插件允许的范围（{where}）：{detail}', en: 'A value is outside what a plugin may set ({where}): {detail}',
    fix: { zh: '每个数值最多是原版同一个键最大值的 10 倍（至少允许到 64）；间隔、周期、费用这类步长不能小于原版最小值的十分之一。把数字改小一点——原版 3 倍以内的创意数值都能用。', en: 'A value may be up to 10 × the official maximum of the same key (at least 64); a step — an interval, a period, a cost — no smaller than a tenth of the official minimum. Make it smaller: creative values within 3 × the official ones always pass.' },
  },
  PLUGIN_DATA_REQUIRED: {
    level: 'problem', doc: D.data,
    zh: '合并后的数据缺东西或者写坏了（{where}）：{detail}', en: 'The merged data lacks something or is broken ({where}): {detail}',
    fix: { zh: '补丁不要删掉游戏必需的字段或者整张表；按后面的英文原文找到是哪一处。', en: 'A patch must not remove a field or a table the game needs; the original line says which one.' },
  },
  PLUGIN_BOSS_CENTRE_DEPLOYABLE: {
    level: 'warning', doc: D.data,
    zh: '地图「{stage}」的首领战中央列 10 可部署（战场行 {rows}）；双方会重叠部署，开战时只部署第一名干员',
    en: 'Stage {stage} allows deployment on boss centre column 10 (field rows {rows}); both players can overlap there and battle deploys only the first unit',
    fix: { zh: '将这些格子的有效 buildable 设为 NONE，移走中央列的部署平台；这是提示，不会改变插件规则。', en: 'Set these tiles\' effective buildable to NONE and move deployment platforms off the centre column; this warning does not change plugin rules.' },
  },
  PLUGIN_DATA_REFERENCE: {
    level: 'problem', doc: D.data,
    zh: '「{where}」引用了不存在的东西：{detail}', en: '“{where}” refers to something that does not exist: {detail}',
    fix: { zh: '检查拼写：引用的盟约、敌人、干员、效果等 id 要在原版或这个插件里存在（大小写一致）。', en: 'Check the spelling: the bond, enemy, operator or effect ids it names must exist in the game or in this plugin (same case).' },
  },
  PLUGIN_DATA_PAIR: {
    level: 'problem', doc: D.data,
    zh: '干员棋子的普通卡和精英卡对不上（{where}）', en: 'The normal and elite pieces of an operator do not match ({where})',
    fix: { zh: '新干员要成对：…_a 是普通卡、…_b 是精英卡（isGolden: true），两张的 charId 和 tier 一样；用紧凑记录（records 文件）写，工具会替你生成这一对。', en: 'A new operator comes in pairs: …_a the normal piece, …_b the elite one (isGolden: true), with the same charId and tier; a compact record (a records file) makes the pair for you.' },
  },
  PLUGIN_PATCH_OP: {
    level: 'problem', doc: D.data,
    zh: '不认识的补丁操作（{where}）', en: 'An unknown patch operation ({where})',
    fix: { zh: '"op" 只能是 set、merge、add、append、remove 之一。', en: '"op" is one of set, merge, add, append, remove.' },
  },
  PLUGIN_PATCH_PATH: {
    level: 'problem', doc: D.data,
    zh: '补丁的位置写错了（{where}）：{detail}', en: 'A patch points at the wrong place ({where}): {detail}',
    fix: { zh: '"file" 写数据表名（chess、bonds、enemies…），"id" 写记录 id，"path" 是键名或数组下标组成的列表，例如 ["bb", "atk"]。', en: '"file" names a data table (chess, bonds, enemies …), "id" a record, "path" a list of keys and array indexes such as ["bb", "atk"].' },
  },
  PLUGIN_PATCH_TYPE: {
    level: 'problem', doc: D.data,
    zh: '补丁的值类型不对（{where}）：{detail}', en: 'A patch value has the wrong type ({where}): {detail}',
    fix: { zh: '"set" 要保持原来的类型（数字还是数字，列表还是列表）；新记录必须是对象；"ops" 是列表。', en: '"set" keeps the old type (a number stays a number, a list a list); a new record is an object; "ops" is a list.' },
  },
  PLUGIN_PATCH_SETTING: {
    level: 'problem', doc: D.data,
    zh: '补丁用到的设置项不存在（{where}）', en: 'A patch uses a setting that does not exist ({where})',
    fix: { zh: '{ "$setting": "名字" } 里的名字要在清单的 "settings" 里声明。', en: 'The name in { "$setting": "<name>" } must be declared in the manifest\'s "settings".' },
  },
  PLUGIN_PATCH_OVERRIDE: {
    level: 'warning', doc: D.data,
    zh: '两个插件改了同一个数值（{where}），后加载的那个生效', en: 'Two plugins change the same value ({where}); the one loaded later wins',
    fix: { zh: '一般不用管；想让某个插件的值生效，用 loadAfter / loadBefore 调整加载顺序，或者只开其中一个。', en: 'Usually fine; to make one plugin\'s value win, order them with loadAfter / loadBefore, or switch one off.' },
  },
  PLUGIN_RECORD_EXISTS: {
    level: 'problem', doc: D.data,
    zh: '要新增的记录已经存在（{where}）', en: 'The record to add exists already ({where})',
    fix: { zh: '改已有的记录用补丁（patch 文件里的 set / merge）；新增的记录要起一个新的 id。', en: 'Change an existing record with a patch (set / merge); a new record needs a new id.' },
  },
  PLUGIN_RECORD_DELETE: {
    level: 'problem', doc: D.data,
    zh: '插件不能删除记录（{where}）', en: 'A plugin cannot delete a record ({where})',
    fix: { zh: '想让一个干员或敌人不出现，就改它在卡池、关卡或波次里的数据，不要删记录本身。', en: 'To keep an operator or an enemy out, change the pools, stages or waves that use it — never remove the record.' },
  },
  PLUGIN_RECORD_ID: {
    level: 'problem', doc: D.data,
    zh: '新记录的 id 不在这个插件的命名空间里（{where}）：{detail}', en: 'A new record\'s id is outside this plugin\'s namespace ({where}): {detail}',
    fix: { zh: '新记录的 id 要带上插件 id：插件 my-mod 的新干员写 char_x_my_mod_名字（插件 id 里的 - 换成 _），技能写 skx_my_mod_…；用 kitRef 借官方技能时可以保留官方技能 id。', en: 'A new record\'s id carries the plugin id: plugin my-mod\'s new operator is char_x_my_mod_<name> (its - becomes _), a skill skx_my_mod_…; with kitRef the official skill ids may stay.' },
  },
  PLUGIN_RECORD_HIDDEN: {
    level: 'problem', doc: D.data,
    zh: '隐藏标记必须是布尔值（{where}）', en: 'Hidden must be a boolean ({where})',
    fix: { zh: 'chess.hidden 写 true 或 false。', en: 'Set chess.hidden to true or false.' },
  },
  PLUGIN_RECORD_PAIR: {
    level: 'problem', doc: D.data,
    zh: '普通和精锐 id 配对不正确（{where}）', en: 'Normal and elite ids are invalid ({where})',
    fix: { zh: 'chess.ids 写本插件命名空间内不同的 normal 和 elite，不能同时写 chess.id。', en: 'Use distinct namespaced chess.ids.normal and elite; omit chess.id.' },
  },
  PLUGIN_RECORD_ART: {
    level: 'problem', doc: D.data,
    zh: '美术引用格式不正确（{where}）', en: 'Art references are invalid ({where})',
    fix: { zh: 'art.ref 或 art.assets 写素材 id，不能写路径或网址。', en: 'Use asset ids in art.ref or art.assets, never paths or URLs.' },
  },
  PLUGIN_RECORD_ORIGIN: {
    level: 'problem', doc: D.data,
    zh: '来源记录不存在或不一致（{where}）', en: 'Source records are missing or inconsistent ({where})',
    fix: { zh: 'origin 写本安装官方 charId 或 chessId，两个都写时必须匹配。', en: 'Use installed official charId or chessId in origin; both must agree.' },
  },
  PLUGIN_RECORD_TYPE: {
    level: 'problem', doc: D.data,
    zh: '紧凑记录的写法不对（{where}）：{detail}', en: 'A compact record is not written the right way ({where}): {detail}',
    fix: { zh: '干员要写 charId、名字、职业、位置、稀有度（1–6）；kit 只能选一种来源：generic、ref（借官方 kit）、dsl 或一份 JSON 技能规格。', en: 'An operator has a charId, a name, a profession, a position and a rarity (1–6); its kit has exactly one source: generic, ref (an official kit), dsl or a JSON SkillSpec.' },
  },
  PLUGIN_RECORD_SKILLS: {
    level: 'problem', doc: D.data,
    zh: '干员的技能列表不对（{where}）：{detail}', en: 'An operator\'s skills are not right ({where}): {detail}',
    fix: { zh: '技能列表里正好有一个默认技能（default: true），而且它和 "skill" 写的是同一个；改技能说明里的次数时，两处一起改。', en: 'The skills list has exactly one default (default: true), the same as "skill"; when a description\'s count changes, change both.' },
  },
  PLUGIN_KIT_REF: {
    level: 'problem', doc: D.data,
    zh: '"kitRef" 写的官方 kit 不存在（{where}）', en: 'The official kit that "kitRef" names does not exist ({where})',
    fix: { zh: 'kitRef 写官方干员的 id（例如 char_102_texas），它的技能逻辑会照搬过来；拼写要和官方一致。', en: 'kitRef names an official operator (char_102_texas for example), whose skill logic is reused; spell it as the game does.' },
  },
  PLUGIN_SKILL_SPEC: {
    level: 'problem', doc: D.data,
    zh: 'JSON 技能规格写得不对（{where}）：{detail}', en: 'A JSON SkillSpec is not right ({where}): {detail}',
    fix: { zh: '按 docs/PLUGINS.md §10 的 SkillSpec 写：kind 和 mods 里的已知字段；talentMods 只能和 JSON 技能规格一起用，不能和 kit.ref 一起。', en: 'Follow the SkillSpec of docs/PLUGINS.md §10: kind and the known fields of mods; talentMods go with a JSON SkillSpec, never with kit.ref.' },
  },
  PLUGIN_EFFECT_REF: {
    level: 'problem', doc: D.data,
    zh: '效果引用不对（{where}）：{detail}', en: 'An effect reference is not right ({where}): {detail}',
    fix: { zh: 'effectRef 要指向一个官方的道具或策略记录；驻守效果和 buff 的键要用游戏里已有的。', en: 'effectRef names an official item or tactic record; garrison effects and buff keys must be ones the game has.' },
  },
  PLUGIN_I18N: {
    level: 'problem', doc: D.data,
    zh: '插件的翻译文件不对（{where}）：{detail}', en: 'A translation file of the plugin is not right ({where}): {detail}',
    fix: { zh: '翻译文件写 { "version": 1, "lang": "en", "files": { … } }，lang 和文件名一致；只能替换已有的文字，不能新增字段。', en: 'A translation file is { "version": 1, "lang": "en", "files": { … } } with lang matching its name; it replaces existing text only, never adds a field.' },
  },
  // ---- an interface plugin's manifest (class ui, DESIGN §32.8) -------------------------------------------------------
  PLUGIN_UI_SLOTS: {
    level: 'problem', doc: D.ui,
    zh: '界面插件的 "slots" 写得不对：{detail}', en: 'The "slots" of a ui plugin are not right: {detail}',
    fix: { zh: '"slots" 是列表，从 hud.right、result.tab、stats.tab、room.panel 里选，每个最多写一次。', en: '"slots" is a list of hud.right, result.tab, stats.tab and room.panel, each at most once.' },
  },
  PLUGIN_UI_NO_SLOT: {
    level: 'warning', doc: D.ui,
    zh: '界面插件没有要任何位置，页面不会显示出来', en: 'The ui plugin asks for no slot, so its page is never shown',
    fix: { zh: '在 "slots" 里写上它要放的位置，例如 ["hud.right"]。', en: 'List where it goes in "slots", for example ["hud.right"].' },
  },

  // ---- the host's answers to an interface plugin's page (postMessage API v1, shared/plugins/ui.js) ------------------
  PLUGIN_SLOT: {
    level: 'frame', doc: D.ui,
    zh: '界面插件要的位置没有给它：清单的 "slots" 里没有这个位置，或者别的插件已经占了', en: 'The slot a ui plugin asked for was not granted: its manifest\'s "slots" does not list it, or another plugin holds it',
    fix: { zh: '在 plugin.json 的 "slots" 里写上这个位置（hud.right、result.tab、stats.tab、room.panel）。协议表同一时间只挂一个插件；同一个位置有多个时，对局里用标签切换。', en: 'List the slot in "slots" of plugin.json (hud.right, result.tab, stats.tab, room.panel). The protocol table grants one plugin at a time; when several ask for one slot, the match shows tabs to switch.' },
  },
  PLUGIN_UI_SLOT_SHARED: {
    level: 'warning', doc: D.ui,
    zh: '同一个位置有多个界面插件（{detail}）。对局里用标签切换，一次只显示一个', en: 'Several ui plugins ask for the same slot ({detail}). The match shows tabs and displays one at a time',
    fix: { zh: '这不是错误：玩家可以在这个位置里切换。若要各自独立显示，把它们写成不同的 slots。', en: 'This is not a failure: the player can switch within the slot. Give them different slots if each should be visible at once.' },
  },
  PLUGIN_RATE: {
    level: 'frame', doc: D.ui,
    zh: '界面插件发消息太快，被限流了', en: 'The ui plugin sends messages too fast and was throttled',
    fix: { zh: '每个插件每秒最多 20 条（连发最多 40 条）。把要发的东西攒一攒再发，或者只在数据变了的时候发。', en: 'A plugin sends at most 20 messages a second (bursts of 40). Batch them, or send only when something changed.' },
  },
  PLUGIN_STORAGE: {
    level: 'frame', doc: D.ui,
    zh: '界面插件的存储请求被拒绝：键名不合规，或者超出了容量', en: 'The ui plugin\'s storage request was refused: the key is not allowed or the space is used up',
    fix: { zh: '键名 1–64 个字符，只用字母、数字和 . _ -；一个值的 JSON 不超过 4096 字节；每个插件最多 32 个键、一共 32 KB。', en: 'A key is 1–64 characters of letters, digits and . _ -; a value\'s JSON is at most 4096 bytes; a plugin keeps at most 32 keys and 32 KB.' },
  },
  PLUGIN_INTENT: {
    level: 'frame', doc: D.ui,
    zh: '界面插件想发对局操作，被拒绝了', en: 'The ui plugin tried to send a match action, which is refused',
    fix: { zh: '界面插件只能看，不能操作对局（它不能成为自动操作或作弊工具）：不要发 hello、ping、room.*、g.*、b.* 这类消息，也不要把它们夹在别的消息里。', en: 'A ui plugin watches and never plays (it cannot become a bot or a cheat): do not send hello, ping, room.*, g.* or b.* messages, nor carry one inside another message.' },
  },
  PLUGIN_SHAPE: {
    level: 'frame', doc: D.ui,
    zh: '界面插件发来的消息格式不对，被丢弃了', en: 'A message from the ui plugin is not shaped right and was dropped',
    fix: { zh: '每条消息都是 { "v": 1, "t": 类型, … }，类型只能是 ready、slot、resize、storage、notice、stats，一条不超过 8 KB；格式见 schemas/ui.schema.json。', en: 'Every message is { "v": 1, "t": <type>, … } with a type of ready, slot, resize, storage, notice or stats, at most 8 KB; schemas/ui.schema.json has the shapes.' },
  },

  // ---- the declarative interaction windows of PLUGIN API v2 (shared/plugins/offers.js) ------------------------------
  PLUGIN_OFFER_REFERENCE: {
    level: 'problem', doc: D.offers,
    zh: '交互窗口引用了不可用的记录：{detail}', en: 'An offer references an unavailable record: {detail}',
    fix: { zh: '只使用官方数据或本插件在房间内容集内声明的物品、棋子和羁绊。', en: 'Use official records or this plugin’s own items, chess and bonds declared in the room content set.' },
  },
  PLUGIN_OFFER_SHAPE: {
    level: 'problem', doc: D.offers,
    zh: '这个交互窗口的写法不对：{detail}', en: 'This interaction window is not shaped right: {detail}',
    fix: { zh: '一份 offers/*.json 是 { "offer": 1, "id": "窗口名", "when": { "at": ["battleCheck" 或 "prep"], "rounds": 轮次 }, "windowSec": 秒数, "slots": 1–6, "options": { "source": "插件里的 .json" } }；windowSec 缺省 0（不开窗、不阻塞）。', en: 'One offers/*.json is { "offer": 1, "id": "<name>", "when": { "at": ["battleCheck" or "prep"], "rounds": <rounds> }, "windowSec": <seconds>, "slots": 1–6, "options": { "source": "<a .json in the plugin>" } }; windowSec defaults to 0 (no window, nothing held back).' },
  },
  PLUGIN_OFFER_ROUNDS: {
    level: 'problem', doc: D.offers,
    zh: '这个交互窗口的轮次表达式看不懂：{detail}', en: 'The round expression of this interaction window is not readable: {detail}',
    fix: { zh: '轮次写成 1–99 的列表（如 [1, 3, 6, 11]）、"any"（每一轮）、{ "every": N }（每 N 轮）或 { "from": R, "to": R }；窗口在该轮开始之前打开，任何一轮都可以，不必是官方固定节奏里的轮次。', en: 'Write rounds as a list of 1–99 ([1, 3, 6, 11]), "any" (every round), { "every": N } or { "from": R, "to": R }; the window opens before that round begins, on any round — not only the ones the official schedule uses.' },
  },

  // ---- a DSL spec (P2, DESIGN §32.7; the explanations of server/sim/content/dsl/validate.js are Chinese) -------------
  PLUGIN_DSL_SHAPE: {
    level: 'problem', doc: D.dsl,
    zh: 'DSL 规格的整体写法不对：{detail}', en: 'The DSL spec is not shaped right: {detail}',
    fix: { zh: '整份规格是一个对象：{ "dsl": 1, "pluginId": "插件 id", 然后是 "skill"、"skills"、"talents" 或 "meta" }。', en: 'The whole spec is one object: { "dsl": 1, "pluginId": "<plugin id>", then "skill", "skills", "talents" or "meta" }.' },
  },
  PLUGIN_DSL_VERSION: {
    level: 'problem', doc: D.dsl, symptom: { zh: '插件没出现在列表里（被跳过）；check 指出 DSL 版本', en: 'The plugin is not listed (skipped); check names the DSL version' },
    zh: '这个版本只认 "dsl": 1', en: 'This version reads "dsl": 1 only',
    fix: { zh: '在规格最外层写 "dsl": 1。', en: 'Put "dsl": 1 at the top of the spec.' },
  },
  PLUGIN_DSL_PLUGIN_ID: {
    level: 'problem', doc: D.dslBudget,
    zh: 'DSL 规格写的插件 id 和装着它的插件对不上：{detail}', en: 'The plugin id the DSL spec names is not the plugin that carries it: {detail}',
    fix: { zh: '"pluginId" 写装着这份规格的插件自己的 id（插件文件夹名），或者不写，由服务器填上。一个插件不能用别的插件的动作预算。', en: 'Write the id of the plugin that carries the spec (its folder name) as "pluginId", or leave it out and the server fills it in. A plugin cannot spend another plugin\'s action budget.' },
  },
  PLUGIN_DSL_BUDGET: {
    level: 'problem', doc: D.dslBudget,
    zh: '动作预算 "budget" 要是 1 到 10000000 的整数', en: '"budget" is a whole number from 1 to 10,000,000',
    fix: { zh: '写一个整数，或者删掉 "budget" 用默认的 8000。一场战斗里这个插件的动作执行次数超过预算，它的效果就在这一场里停下。', en: 'Write a whole number, or remove "budget" for the default of 8000. A plugin whose actions run more often than that in one battle stops for that battle.' },
  },
  PLUGIN_DSL_LOOP: {
    level: 'problem', doc: D.dslBudget,
    zh: 'DSL 里写了循环或外部代码，或者嵌套太深：{detail}', en: 'The DSL names a loop or outside code, or nests too deep: {detail}',
    fix: { zh: 'DSL 不支持循环和代码（loop、while、script 之类的字段）；"then" 最多嵌套 4 层，一个取值最多 64 层、64 个节点。复杂的逻辑做成脚本插件。', en: 'The DSL has no loops or code (loop, while, script …); "then" nests at most 4 deep and one value at most 64 levels and 64 nodes. Complex logic belongs to a script plugin.' },
  },
  PLUGIN_DSL_TRIGGER: {
    level: 'problem', doc: D.dslTriggers,
    zh: '不认识的触发器（{where}）：{detail}', en: 'An unknown trigger ({where}): {detail}',
    fix: { zh: '战斗里用 always、deploy、battleStart、attack、hitDealt、hitTaken、kill、allyDeath、skillStart、skillEnd、every、hpBelow；备战用 roundStart、income、buy、sell、refresh、merge、levelUp、battleResult。', en: 'In battle: always, deploy, battleStart, attack, hitDealt, hitTaken, kill, allyDeath, skillStart, skillEnd, every, hpBelow; in prep: roundStart, income, buy, sell, refresh, merge, levelUp, battleResult.' },
  },
  PLUGIN_DSL_CONDITION: {
    level: 'problem', doc: D.dslTerms,
    zh: '条件写得不对（{where}）：{detail}', en: 'A condition is not right ({where}): {detail}',
    fix: { zh: '条件写成 { "条件名": 值 }，条件名用 chance、targetHas、selfHpBelow、enemiesInRange、bondActive、skillActive；备战只能用 round、chance、bondActive。', en: 'A condition is { "<name>": value } with chance, targetHas, selfHpBelow, enemiesInRange, bondActive or skillActive; prep takes round, chance and bondActive only.' },
  },
  PLUGIN_DSL_ACTION: {
    level: 'problem', doc: D.dslActions,
    zh: '动作写得不对（{where}）：{detail}', en: 'An action is not right ({where}): {detail}',
    fix: { zh: '"do" 是动作的列表，每个动作是 buff、status、damage、heal、sp、dp、push、pull、spawnToken、layers、shield、fx 之一（备战是 funds、layers、gainItem），各自的字段见 docs/PLUGIN-DSL.md §4。', en: '"do" is a list of actions, each one of buff, status, damage, heal, sp, dp, push, pull, spawnToken, layers, shield, fx (prep: funds, layers, gainItem); docs/PLUGIN-DSL.md §4 has their fields.' },
  },
  PLUGIN_DSL_TARGET: {
    level: 'problem', doc: D.dslTerms,
    zh: '目标写得不对（{where}）：{detail}', en: 'A target is not right ({where}): {detail}',
    fix: { zh: '目标用 self、target、source、alliesInRange、enemiesInRange、enemiesInRadius、lowestHpAlly、allAllies；spawnToken 的 "tile" 写 "around" 或 { "r": 行, "c": 列 }。', en: 'A target is self, target, source, alliesInRange, enemiesInRange, enemiesInRadius, lowestHpAlly or allAllies; the "tile" of spawnToken is "around" or { "r": row, "c": column }.' },
  },
  PLUGIN_DSL_EVERY: {
    level: 'problem', doc: D.dslTriggers,
    zh: '"every" 的间隔太短（{where}）：{detail}', en: 'The interval of "every" is too short ({where}): {detail}',
    fix: { zh: '"seconds" 至少是一帧（1/30 秒）。', en: '"seconds" is at least one tick (1/30 s).' },
  },
  PLUGIN_DSL_NUMBER: {
    level: 'problem', doc: D.dslTerms,
    zh: '数值不在允许的范围里（{where}）：{detail}', en: 'A number is out of range ({where}): {detail}',
    fix: { zh: '写有限的数：hpBelow 的阈值大于 0、不超过 1，"times" 是 1 到 8 的整数。', en: 'Write finite numbers: the threshold of hpBelow is above 0 and at most 1, "times" a whole number from 1 to 8.' },
  },
  PLUGIN_DSL_DIV0: {
    level: 'problem', doc: D.dslTerms,
    zh: '除数是 0（{where}）', en: 'A division by 0 ({where})',
    fix: { zh: '"div" 的第二项不能是 0；要表示「不变」就乘以 1。', en: 'The second term of "div" cannot be 0; to keep a value as it is, multiply it by 1.' },
  },
  PLUGIN_DSL_VALUE: {
    level: 'problem', doc: D.dslTerms,
    zh: '取值写得不对（{where}）：{detail}', en: 'A value is not right ({where}): {detail}',
    fix: { zh: '取值是数字、{ "bb": "键" }、{ "talent": [序号, "键"] }，或者用 mul、add、sub、div、min、max 组合起来；列表只能写在这些组合里。', en: 'A value is a number, { "bb": "<key>" }, { "talent": [index, "<key>"] }, or mul, add, sub, div, min, max of them; a list appears only inside those.' },
  },
  PLUGIN_DSL_SKILL: {
    level: 'problem', doc: D.dsl,
    zh: '技能规格写得不对（{where}）：{detail}', en: 'A skill spec is not right ({where}): {detail}',
    fix: { zh: '"skill" 是一个对象，"kind" 用 instant、duration、ammo、charges、toggle、passive；几个技能就写 "skills": { "技能 id": { … } }。', en: '"skill" is an object whose "kind" is instant, duration, ammo, charges, toggle or passive; several skills are "skills": { "<skill id>": { … } }.' },
  },
  PLUGIN_DSL_META: {
    level: 'problem', doc: D.dslMeta,
    zh: '备战规格写得不对（{where}）：{detail}', en: 'The prep spec is not right ({where}): {detail}',
    fix: { zh: '写成 "meta": { "on": [ { "when": 触发器, "do": [ 动作 ] } ] }；"meta.key" 写成 effect:<插件 id>:<名字>，插件 id 是这个插件自己的。', en: 'Write "meta": { "on": [ { "when": <trigger>, "do": [ <actions> ] } ] }; "meta.key" is effect:<plugin id>:<name> with this plugin\'s own id.' },
  },
  PLUGIN_DSL_TALENT: {
    level: 'problem', doc: D.dslTriggers,
    zh: '天赋写得不对（{where}）：{detail}', en: 'A talent is not right ({where}): {detail}',
    fix: { zh: '"talents" 是列表，每一项是 { "when": 触发器, "if": 条件, "do": [ 动作 ] } 这样的对象。', en: '"talents" is a list of objects such as { "when": <trigger>, "if": <condition>, "do": [ <actions> ] }.' },
  },

  // ---- a community catalogue and installing by address (docs/PLUGINS.md §17) ------------------------------------
  PLUGIN_CATALOG_SHAPE: {
    level: 'problem', doc: D.catalog,
    zh: '目录文件的结构不对：{detail}', en: 'The catalogue file is not in the right shape: {detail}',
    fix: { zh: '目录是一个 JSON 对象，"catalog" 为 1，"name" 是名字，"plugins" 是插件列表。', en: 'A catalogue is a JSON object with "catalog": 1, a "name" and a "plugins" list.' },
  },
  PLUGIN_CATALOG_URL: {
    level: 'problem', doc: D.catalog,
    zh: '目录或插件地址不是可以下载的 https：{detail}', en: 'A catalogue or plugin address is not an https address this installer will fetch: {detail}',
    fix: { zh: '地址以 https:// 开头，主机名要有点，不能写账号密码。下载时只访问公网地址的 443 端口；内网、本机、链路本地和 .local 会被拒绝，除非服主在 allowDownloadHosts 里点名。', en: 'The address starts with https://, the host has a dot, and it has no user or password. A download uses a public address on port 443 only. Loopback, private, link-local and .local are refused unless the operator names the host in allowDownloadHosts.' },
  },
  PLUGIN_CATALOG_HASH: {
    level: 'problem', doc: D.catalog,
    zh: '目录条目缺少 sha256，或者不是 64 位小写十六进制：{detail}', en: 'A catalogue entry has no sha256, or it is not 64 lowercase hex digits: {detail}',
    fix: { zh: '每个插件都写上它的 zip 的 SHA-256（64 位小写十六进制）。', en: 'Each plugin names the SHA-256 of its zip (64 lowercase hex digits).' },
  },
  PLUGIN_CATALOG_ID: {
    level: 'problem', doc: D.catalog,
    zh: '插件 id 不合法或重复：{detail}', en: 'A plugin id is not valid, or it is repeated: {detail}',
    fix: { zh: 'id 是 2 到 32 位小写字母、数字和连字符，并且在这份目录里只出现一次。', en: 'An id is 2 to 32 lowercase letters, digits and hyphens, and it appears once in the catalogue.' },
  },
  PLUGIN_CATALOG_FIELD: {
    level: 'problem', doc: D.catalog,
    zh: '目录字段不合法：{detail}', en: 'A catalogue field is not valid: {detail}',
    fix: { zh: '按 docs/plugin-catalog.example.json 写：版本是 semver，class 是已知类别，过长的文字要缩短。', en: 'Follow docs/plugin-catalog.example.json: version is semver, class is a known class, and long text is shortened.' },
  },
  PLUGIN_CATALOG_SIZE: {
    level: 'studio', doc: D.catalog,
    zh: '目录文件太大：{detail}', en: 'The catalogue file is too large: {detail}',
    fix: { zh: '目录本身不超过 1 MB。插件 zip 另有 200 MB 的上限。', en: 'The catalogue document itself is at most 1 MB. A plugin zip has its own 200 MB cap.' },
  },
  PLUGIN_CATALOG_FETCH: {
    level: 'studio', doc: D.catalog,
    zh: '读不到这份目录：{detail}', en: 'The catalogue could not be fetched: {detail}',
    fix: { zh: '确认地址是公网 https 的 443 端口、服务器能访问它，并且没有被重定向到内网或非 https。这一次等待包含正文，不是每一跳重新计时。也可以改用本机的目录文件。', en: 'Check that the address is public https on port 443, that the server can reach it, and that it is not redirected to a non-public address or off https. The one deadline covers the body, not each redirect on its own. A local catalogue file works too.' },
  },
  PLUGIN_INSTALL_URL: {
    level: 'studio', doc: D.catalog,
    zh: '安装地址不是公网 https：{detail}', en: 'The install address is not a public https address: {detail}',
    fix: { zh: '只安装公网 https、443 端口的 zip。内网和本机地址默认拒绝。本机文件可以直接给出路径，包括 Windows 盘符和 UNC。', en: 'Install a public https zip on port 443 only. A private or loopback address is refused unless the operator allowlist names it. A file on this machine can be given as a path, including a Windows drive or a UNC path.' },
  },
  PLUGIN_INSTALL_HASH: {
    level: 'studio', doc: D.catalog,
    zh: 'zip 的 SHA-256 对不上，或者没有给出：{detail}', en: 'The zip SHA-256 does not match, or none was given: {detail}',
    fix: { zh: 'https 安装必须带 --sha256（或目录条目里的 sha256）。哈希不对就不要安装。', en: 'An https install needs --sha256 (or the sha256 of a catalogue entry). Do not install when the hash differs.' },
  },
  PLUGIN_INSTALL_SIZE: {
    level: 'studio', doc: D.catalog,
    zh: 'zip 超过大小上限，或和目录里写的字节数不一致：{detail}', en: 'The zip is over the size cap, or it is not the byte length the catalogue names: {detail}',
    fix: { zh: '一个插件不超过 200 MB。目录里的 bytes 要和 zip 的实际大小一致。', en: 'A plugin is at most 200 MB. When the catalogue gives bytes, it has to be the zip size.' },
  },
  PLUGIN_INSTALL_TIMEOUT: {
    level: 'studio', doc: D.catalog,
    zh: '下载超时：{detail}', en: 'The download timed out: {detail}',
    fix: { zh: '检查网络后重试。zip 最长等 60 秒，目录最长等 20 秒。这一次等待包含连接、重定向和正文，不是每一跳重新计时。', en: 'Check the network and try again. A zip waits up to 60 seconds, a catalogue up to 20. That one deadline covers the connection, the redirects and the body.' },
  },
  PLUGIN_INSTALL_FETCH: {
    level: 'studio', doc: D.catalog,
    zh: '下载失败：{detail}', en: 'The download failed: {detail}',
    fix: { zh: '确认地址能打开，并且返回的是 zip（HTTP 200）。', en: 'Check that the address opens and answers with the zip (HTTP 200).' },
  },
  PLUGIN_INSTALL_REDIRECT: {
    level: 'studio', doc: D.catalog,
    zh: '下载被重定向到了非公网地址、非 443 端口，或重定向次数太多：{detail}', en: 'The download was redirected to a non-public address, off port 443, or too many times: {detail}',
    fix: { zh: '只跟随公网 https、443 端口的重定向，最多 5 次。请换一个直接的 https 地址。', en: 'Only a public https redirect on port 443 is followed, at most 5. Use a direct https address.' },
  },
  PLUGIN_INSTALL_ZIP: {
    level: 'studio', doc: D.catalog,
    zh: '这个 zip 不能安装：{detail}', en: 'This zip cannot be installed: {detail}',
    fix: { zh: 'zip 里要有 plugin.json（可以包在一层以插件 id 命名的文件夹里）。不能有路径穿越、符号链接、加密或超量的文件。', en: 'The zip needs plugin.json (optionally inside one folder named with the plugin id). No path traversal, symbolic links, encryption or too many files.' },
  },
  PLUGIN_INSTALL_CHECK: {
    level: 'studio', doc: D.catalog,
    zh: '插件没通过检查，没有装进 plugins/：{detail}', en: 'The plugin failed its check and was not placed in plugins/: {detail}',
    fix: { zh: '按 node tools/plugin.mjs check 的提示改插件，再安装。失败时只删掉临时文件，不会动已经装好的插件。', en: 'Fix the plugin as node tools/plugin.mjs check says, then install again. A failed check deletes only the temporary files.' },
  },
  PLUGIN_INSTALL_EXISTS: {
    level: 'studio', doc: D.catalog,
    zh: 'plugins/ 里已经有这个 id：{detail}', en: 'plugins/ already has this id: {detail}',
    fix: { zh: '不加 --force 就不会覆盖。--force 会把旧文件夹挪到 plugins/_replaced/，不会删除。', en: 'Without --force nothing is overwritten. --force moves the old folder to plugins/_replaced/ and does not delete it.' },
  },

  // ---- Forge workshop packs (tools/plugin.mjs import-forge, server/plugins/forgeImport.js) --------------------------
  PLUGIN_FORGE_INPUT: {
    level: 'problem', doc: D.forge,
    zh: '这不是一份能读的 Forge 包：{detail}', en: 'This is not a Forge pack that can be read: {detail}',
    fix: { zh: '选一个含 pack.json 的工坊包目录，或那个目录打出来的 zip。', en: 'Choose a workshop folder that contains pack.json, or a zip of that folder.' },
  },
  PLUGIN_FORGE_ZIP: {
    level: 'problem', doc: D.forge,
    zh: '这个包的文件不安全，没有解压：{detail}', en: 'This pack\'s files are not safe to unpack: {detail}',
    fix: { zh: '路径不能跳出包目录，不能有符号链接，单个包最多 5000 个文件、一共 200 MB。换一份包再导入。', en: 'Paths must stay inside the pack, with no symbolic links, at most 5000 files and 200 MB. Import another pack.' },
  },
  PLUGIN_FORGE_JSON: {
    level: 'problem', doc: D.forge,
    zh: '包里的 JSON 读不了：{detail}', en: 'JSON in the pack cannot be read: {detail}',
    fix: { zh: 'JSON 要能解析，不超过 8 MB，嵌套不超过 64 层。读 Forge 包时，±1e9 以内的有限数和安全整数都可以；非有限数和超出安全整数范围的数仍然拒绝。写进插件或游戏数据的数仍须在 ±1e9 以内。', en: 'JSON must parse, stay within 8 MB and 64 levels. A Forge pack may contain finite numbers within ±1e9 and safe integers; non-finite numbers and values past the safe-integer range are still refused. A number written into a plugin or into game data must still stay within ±1e9.' },
  },
  PLUGIN_FORGE_ID: {
    level: 'problem', doc: D.forge,
    zh: '这个包的 id 变不成插件 id：{detail}', en: 'This pack\'s id cannot become a plugin id: {detail}',
    fix: { zh: '用 --id 指定一个插件 id：2–32 位小写字母、数字和 -，例如 rose-skin。', en: 'Pass --id with a plugin id: 2–32 lower-case letters, digits and -, for example rose-skin.' },
  },
  PLUGIN_FORGE_EXISTS: {
    level: 'problem', doc: D.forge,
    zh: '目标文件夹已经存在，没有写入：{detail}', en: 'The destination folder already exists, so nothing was written: {detail}',
    fix: { zh: '换一个 --out 或 --id，或者把已有的插件文件夹挪走后再导入。', en: 'Choose another --out or --id, or move the existing plugin folder aside and import again.' },
  },
  PLUGIN_FORGE_MOUNT: {
    level: 'warning', doc: D.forge,
    zh: '面板挂载点需要人工适配：{detail}', en: 'Panel mount needs manual adaptation: {detail}',
    fix: { zh: '按报告建议的插槽改写面板；建议位置不是原挂载点。', en: 'Rewrite for the suggested slot; it is not the original mount position.' },
  },
  PLUGIN_FORGE_PANEL_SCRIPT: {
    level: 'warning', doc: D.forge,
    zh: '面板脚本没有复制：{detail}', en: 'Panel script was not copied: {detail}',
    fix: { zh: '用 postMessage API v1 重写面板脚本；导入时没有执行脚本。', en: 'Rewrite the panel script with postMessage API v1; import never executed it.' },
  },
  PLUGIN_FORGE_SCRIPT: {
    level: 'problem', doc: D.forge,
    zh: '包里的脚本没有导入，也没有执行：{detail}', en: 'A script in the pack was not imported and was not run: {detail}',
    fix: { zh: 'kits/<id>.js 的 id 是包里导入的记录（或 overrides 里声明的官方 id），import 又能映射到 sp:sdk@1（@kit/tier1.js、@sim/constants.js、@sim/detmath.js、@sim/dir.js 与 @sim/targeting.js 的安全子集、包里的 ./ 文件）时，会变成沙箱里的脚本插件；不然就把技能逻辑改写成 JSON SkillSpec、DSL 或脚本插件。导入器不会运行包里的 .js。', en: 'A kits/<id>.js becomes the sandboxed script plugin when its id is an imported record (or an official id declared in overrides) and its imports map to sp:sdk@1 (@kit/tier1.js, @sim/constants.js, @sim/detmath.js, the safe subsets of @sim/dir.js and @sim/targeting.js, the pack\'s ./ files); otherwise rewrite the logic as a JSON SkillSpec, DSL or a script plugin. The importer never runs a .js from the pack.' },
  },

  // ---- anything a check reported without a code of its own ----------------------------------------------------------
  PLUGIN_INVALID: {
    level: 'problem', doc: D.guide,
    zh: '插件有问题：{detail}', en: 'The plugin has a problem: {detail}',
    fix: { zh: '看后面的英文原文；看不懂的话，可以到 GitHub 提问并附上这段文字。', en: 'Read the original line; if it is unclear, ask on GitHub with it.' },
  },
});

/** The codes that a room's refusals use (ERR codes, translated in the language packs: shared/constants.js ERR_TEXT). */
export const REFUSAL_CODES = Object.freeze(Object.keys(PLUGIN_ERRORS).filter((c) => PLUGIN_ERRORS[c].level === 'refusal'));

/** What an author sees, by level, when an entry names no symptom of its own (the tables' first column). */
const SYMPTOM_BY_LEVEL = Object.freeze({
  problem: { zh: '插件没出现在列表里（被跳过）；启动日志和 check 写着原因', en: 'The plugin is not listed (skipped); the start log and check say why' },
  warning: { zh: '插件能用，但检查时有提示', en: 'The plugin works, with a note in the check' },
  refusal: { zh: '房间里开不了这个插件，面板弹出提示', en: 'The room will not switch it on; the panel says why' },
  studio: { zh: '工作台里的操作被拒绝，旁边显示原因', en: 'The studio refuses the action and says why' },
  frame: { zh: '界面插件的页面收到拒绝（ok: false、rejected 或 limit 消息）', en: 'The ui plugin\'s page gets a refusal (ok: false, a rejected or a limit message)' },
});

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Is this a code of the catalogue? @param {unknown} code */
export const isPluginErrorCode = (code) => typeof code === 'string' && Object.hasOwn(PLUGIN_ERRORS, code);

/**
 * One issue (see the header). `extra`: `{ at, file, ...params }` — `at` a path into the manifest (strings), `file` a
 * path of the plugin folder; everything else goes to `params`.
 * @param {'problem' | 'warning'} level @param {string} code @param {string} text @param {Record<string, unknown>} [extra]
 * @returns {PluginIssue}
 */
export function makeIssue(level, code, text, extra = {}) {
  const { at, file, ...params } = isObj(extra) ? extra : {};
  /** @type {PluginIssue} */
  const issue = { level, code: isPluginErrorCode(code) ? code : 'PLUGIN_INVALID', text: String(text), params };
  if (Array.isArray(at) && at.length) issue.at = at.map(String);
  if (typeof file === 'string' && file) issue.file = file;
  if (issue.code !== code) issue.params = { ...params, detail: String(text), code: String(code) };
  return issue;
}

/**
 * A check's findings: its `problems` and `warnings` (the plain strings every caller has read since P0) and the same as
 * `issues` with their codes. `problem(code, text, extra)` / `warning(…)` add one; `take(result)` adds another check's
 * findings (its issues when it has them, else its strings as PLUGIN_INVALID).
 * @returns {IssueList}
 */
export function issueList() {
  /** @type {string[]} */ const problems = [];
  /** @type {string[]} */ const warnings = [];
  /** @type {PluginIssue[]} */ const issues = [];
  const add = (level, code, text, extra) => {
    (level === 'warning' ? warnings : problems).push(String(text));
    issues.push(makeIssue(level, code, text, extra));
  };
  return {
    problems, warnings, issues,
    /** @param {string} code @param {string} text @param {Record<string, unknown>} [extra] */
    problem: (code, text, extra) => add('problem', code, text, extra),
    /** @param {string} code @param {string} text @param {Record<string, unknown>} [extra] */
    warning: (code, text, extra) => add('warning', code, text, extra),
    /**
     * Add another check's findings.
     * @param {{ problems?: string[], warnings?: string[], issues?: PluginIssue[] } | null | undefined} r
     * @param {{ warningsToo?: boolean }} [opts] warningsToo: false to take its problems only
     */
    take(r, { warningsToo = true } = {}) {
      if (!r) return;
      for (const i of issuesOf(r)) {
        if (i.level === 'warning' && !warningsToo) continue;
        (i.level === 'warning' ? warnings : problems).push(i.text);
        issues.push(i);
      }
    },
  };
}

/**
 * The issues of a check's result: its own `issues` when it has them (one per problem and warning), else its plain strings
 * as PLUGIN_INVALID (a legacy check that has not adopted coded issues).
 * @param {{ problems?: string[], warnings?: string[], issues?: PluginIssue[] } | null | undefined} r
 * @returns {PluginIssue[]}
 */
export function issuesOf(r) {
  if (!r) return [];
  const problems = Array.isArray(r.problems) ? r.problems : [];
  const warnings = Array.isArray(r.warnings) ? r.warnings : [];
  if (Array.isArray(r.issues) && r.issues.length === problems.length + warnings.length) return r.issues;
  return [...problems.map((t) => makeIssue('problem', 'PLUGIN_INVALID', t, { detail: t })), ...warnings.map((t) => makeIssue('warning', 'PLUGIN_INVALID', t, { detail: t }))];
}

/** The language of the catalogue's texts for an interface language: Chinese for zh and zh-TW, else English [ASSUMED]. */
export const errorLang = (lang) => (/^zh/i.test(String(lang || 'zh')) ? 'zh' : 'en');

/** A param as text: a string, a number, a list of them — anything else (a value of a broken manifest) as short JSON. @param {unknown} v */
const paramText = (v) => {
  if (v === undefined || v === null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(paramText).join(', ');
  try { return String(JSON.stringify(v)).slice(0, 80); } catch { return '?'; }
};

/** `{name}` placeholders filled from `params` (a missing one: ''). @param {string} text @param {Record<string, unknown>} params */
export function fillText(text, params) {
  return String(text).replace(/\{(\w+)\}/g, (_, k) => paramText(params && Object.hasOwn(params, k) ? params[k] : ''));
}

/**
 * The placeholders of an entry's texts (its explanation and its fix, both languages): what an issue of the code passes.
 * @param {string} code @returns {string[]}
 */
export function placeholdersOf(code) {
  const e = PLUGIN_ERRORS[code];
  if (!e) return [];
  const all = [e.zh, e.en, e.fix.zh, e.fix.en].join('\n');
  return [...new Set([...all.matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort();
}

/** What an issue's `{where}` reads: its manifest path, else its file. @param {PluginIssue} issue */
export const issueWhere = (issue) => (issue.at && issue.at.length ? issue.at.join('.') : issue.file || '');

/**
 * An issue in plain words, in `lang` (errorLang): `{ code, level, message, fix, doc, detail, autofix }` — `detail` the
 * technical English line.
 * @param {PluginIssue} issue @param {string} [lang]
 */
export function describeIssue(issue, lang = 'zh') {
  const code = isPluginErrorCode(issue?.code) ? issue.code : 'PLUGIN_INVALID';
  const e = PLUGIN_ERRORS[code];
  const l = errorLang(lang);
  const params = { where: issueWhere(issue), file: issue?.file || issueWhere(issue), detail: issue?.text || '', ...(isObj(issue?.params) ? issue.params : {}) };
  return {
    code, level: issue?.level === 'warning' ? 'warning' : e.level === 'warning' ? 'warning' : 'problem',
    message: fillText(e[l], params), fix: fillText(e.fix[l], params), doc: e.doc, detail: issue?.text || '', autofix: e.autofix || null,
  };
}

/**
 * The plain-words line of an issue for a terminal or a log: `CODE message — fix (doc)`.
 * @param {PluginIssue} issue @param {string} [lang]
 */
export function issueLine(issue, lang = 'zh') {
  const d = describeIssue(issue, lang);
  return `${d.code} ${d.message}${errorLang(lang) === 'zh' ? '。改法：' : '. Fix: '}${d.fix} (${d.doc})`;
}

/**
 * A room's refusal in plain words (the ERR codes): `{ message, fix, doc }`, or null for another code.
 * @param {string} code @param {string} [lang] @param {Record<string, unknown>} [params]
 */
export function describeRefusal(code, lang = 'zh', params = {}) {
  if (!REFUSAL_CODES.includes(code)) return null;
  const e = PLUGIN_ERRORS[code];
  const l = errorLang(lang);
  return { message: fillText(e[l], params), fix: fillText(e.fix[l], params), doc: e.doc };
}

/** Markdown cell text: no line breaks, no table pipes. @param {string} s */
const cell = (s) => String(s).replace(/\s*\n\s*/g, ' ').replace(/\|/g, '\\|');

/**
 * The symptom table of the catalogue (docs/PLUGINS.md §15 in English, docs/PLUGIN-GUIDE.md in Chinese): one row per code
 * — what an author sees, the code, the cause, what to do. Placeholders stay as `{name}` (they are filled per issue).
 * @param {'zh' | 'en'} [lang]
 * @returns {string}
 */
export function symptomTable(lang = 'en') {
  const l = errorLang(lang);
  const head = l === 'zh' ? '| 症状 | 代码 | 原因 | 怎么改 |' : '| Symptom | Code | Cause | Fix |';
  const rows = Object.entries(PLUGIN_ERRORS).map(([code, e]) => {
    const symptom = (e.symptom || SYMPTOM_BY_LEVEL[e.level])[l];
    const fix = e.autofix ? `${e.fix[l]}${l === 'zh' ? '（工作台可一键修复）' : ' (the studio fixes it in one click)'}` : e.fix[l];
    return `| ${cell(symptom)} | \`${code}\` | ${cell(e[l])} | ${cell(fix)} |`;
  });
  return [head, '|---|---|---|---|', ...rows].join('\n');
}

/** The markers around a generated table in a document (test/plugins/errors.test.js, tools/plugin.mjs errors --write). */
export const TABLE_MARKERS = Object.freeze({ start: '<!-- plugin-errors:start (generated by node tools/plugin.mjs errors --write) -->', end: '<!-- plugin-errors:end -->' });
