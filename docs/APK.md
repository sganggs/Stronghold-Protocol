# 卫戍协议 Android 壳（apk 分支）

非官方 Android 壳，把浏览器客户端装进手机：横屏全屏、资源全内嵌（首屏秒开）、
**内嵌游戏服务器**（房主模式：手机开房，朋友 ZeroTier / IPv6 / 局域网 / 打洞直连）、
**Ed25519 签名的服务器清单**，以及跟随上游仓库的**清单驱动内容热更新**。

上游是 server-authoritative 架构（DESIGN §1），因此"联机"始终有一台权威服务器；本壳把这台
服务器装进房主的手机（Termux Node 24 子进程），替代"所有人连远程盒子"的旧模型。战斗本身在
各自浏览器端 60tps 模拟（DESIGN §14），房主带宽压力只有 KB 级 WS 消息。

> 本文档是壳的**完整说明**（架构 / 信任链 / 构建 / 发布 / 运维）。改动壳层行为时请同步更新。

---

## 1. 分层总览

```
┌─ WebView（游戏客户端）──────────────────────────────────────────────┐
│  index.html / js / css / vendor / data / sim …  ← 本地树优先         │
│  ┌─ /__sp/shell-bridge.js, /__sp/dc-bridge.js  ← 始终由 APK 提供     │
│  └─ 注入的 CORS 守卫 + 桥接脚本（P0-2，对每个 HTML 响应生效）          │
└────────────────────────────────────────────────────────────────────┘
        ▲ 拦截器（MainActivity.ShellClient.shouldInterceptRequest）
        │   本地树（filesDir/webroot → APK assets）→ 命中即下发
        │   未命中 → /healthz、/ws、/assets/** 放行；其余需"免责声明"同意
┌─ 内嵌房主服务（HostService → NodeRunner）──────────────────────────┐
│  Termux Node 24 子进程（linker64 启动，配置走 filesDir/run/launch.json）│
│  物化的是 slim 集（≈45MB），不是全部 433MB 素材                       │
└────────────────────────────────────────────────────────────────────┘
        ▲
┌─ 信任链（Ed25519）────────────────────────────────────────────────┐
│  公钥钉进 APK：assets/shell/pubkey.bin                              │
│  服务器清单：dl → R2 → 内置快照（三源逐一验签，失败即弃用）            │
│  热更新清单：dl → R2 → 内置基线（同上）                              │
└────────────────────────────────────────────────────────────────────┘
```

---

## 2. 壳层行为

| 能力 | 说明 |
|---|---|
| 横屏全屏 | `sensorLandscape`（可 180° 双向）+ 沉浸式 sticky + 防息屏；`FrameLayout` 边到边（无预留黑带） |
| 资源内嵌 | webroot 打包进 APK：首屏秒开、进战斗零加载；冷启动**不物化、不起 Node** |
| 请求拦截 | 本地树优先；HTML 响应注入桥接脚本与 CORS 守卫 |
| Google Fonts | 拦截置空（内嵌字体已有，原外链在国内是渲染阻塞） |
| 版本护栏 | 启动对比所连服务器 `/healthz` 的 `app` 与内嵌客户端版本 |
| 服务器清单 | 签名清单 + 本机实测延迟/在线数 + 兼容徽标；不兼容禁止加入 |
| 内容热更新 | 清单驱动：镜像链下载 slim 包 → 只解 L1 → 重放外壳补丁 → 原子切换（失败自动回滚） |
| 房主模式 | 内嵌 Node 服务器，前台服务保活；自动发布房号到目录服务 |
| 崩溃取证 | Java 未捕获异常 + 页面 JS 错误 → `filesDir/crash.log`，下次启动提示一次 |
| 渲染崩溃 | 自动重建 WebView |

**壳菜单**：点击屏幕最顶边 12dp 隐形热区。菜单只保留「输房号加入 / 服务器 / 参数 / 检查更新 /
停止房主服务」，其余全部在页面内的游戏风格面板里（域名从不出现在界面）。

---

## 3. 信任链（v2.6.0 新增，核心）

### 3.1 为什么需要
服务器清单与热更新清单是**可热更新的远端 JSON**。若不做签名，任何能改到那份 JSON 的人
（镜像、CDN 缓存、劫持）都能给所有客户端塞任意服务器甚至任意客户端代码。因此两份文档都用
**Ed25519 签名**，公钥**钉进 APK**，客户端只信任能验签的内容。

### 3.2 密钥
| 项 | 位置 | 说明 |
|---|---|---|
| 私钥 | `~/.sp-sign/ed25519.key`（0600，**仓库外**） | 只在本机；**绝不入库、不进 CI** |
| 公钥 | `tools/apk/shell/pubkey.bin` → `assets/shell/pubkey.bin`（32 字节 raw） | 随 APK 分发 |

> ⚠️ **私钥必须离线备份**。丢失后无法再签发能被已发布 APK 接受的清单，只能换钥 + 重新发版。

### 3.3 规范化签名规则（定死）
签名对象 = **去掉 `sig` 字段**后的 JSON：UTF-8、**键递归字典序**、无多余空白、无尾随换行、
数组顺序保持。两端实现必须逐字节一致：

- JS：`tools/apk/canonical.mjs`（`JSON.stringify` 的转义规则）
- Java：`android/.../CanonicalJson.java`（**不能用 org.json 自己的 writer**，转义规则不同；只转义 `"`、`\` 与控制符，非 ASCII 原样输出）

> 改动任一侧都必须重跑互通测试，否则所有签名会静默失效。

### 3.4 验签实现（minSdk 26 的现实约束）
Android 原生 Ed25519（Conscrypt）**从 API 28 才有**，而壳的 `minSdk` 是 26。因此内置
`android/.../Ed25519.java`：纯 Java、TweetNaCl 的 16×16bit limb 布局、**仅实现验签**，
无第三方依赖。已用 **RFC 8032 §7.1 测试向量** + **JDK 17 原生 Ed25519** 双向交叉验证。

### 3.5 清单格式
```jsonc
// servers.json —— 服务器清单
{ "v":1, "updated":"…", "keyId":"sp-2026-10", "note":"…",
  "servers":[
    { "id":"weishu", "name":"站长服务", "url":"https://…", "probe":"/healthz",
      "region":"CN", "note":"官方", "enabled":true,
      "tier":10, "weight":100, "protocol":1, "app":"0.1.0" }
  ],
  "sig":"base64(ed25519)" }

// manifest.json —— 热更新清单
{ "buildTag":"shell-v2.6.0", "upstreamTag":"v0.1.0", "minApk":12,
  "slim":{ "url":"…", "sha256":"…", "size":0 },
  "art":{ "base":"https://…/assets/" },
  "servers":{ "url":"…", "sha256":"…" },
  "mirrors":["ghfast","ghproxy","llkk","ghproxynet","r2","box"],
  "keyId":"sp-2026-10", "sig":"base64(ed25519)" }
```

**读取顺序**（每源都必须验签，失败即弃用该源，继续下一源）：
`update.example.com/servers.json` → `weishucdn…/site/servers.json` → APK 内置快照。
远端验签通过且非空时**整体采用**（远端删除即删除；内置快照只用于离线兜底）。

**排序**：`tier` ↓ → `weight` ↓ → 本机成功率窗口（最近 10 次，<0.5 沉底）↓ → 延迟 ↑。

**兼容门禁**：只看**主仓库客户端自己的版本号** —— 内嵌 `shared/constants.js` 的
`PROTOCOL_VERSION` 与 `APP_VERSION`，对比服务器 `/healthz` 的 `version` / `app`。
不符即标「不兼容」并**禁止加入**。APK 的 `versionCode/versionName/buildTag` **不参与**兼容判定，
只管热更新与 `minApk`。

---

## 4. 本地树优先 + 免责声明

拦截器按路径分类（`MainActivity.ShellClient`）：

| 路径 | 行为 |
|---|---|
| 本地树命中（`filesDir/webroot` → APK assets） | **直接下发**；HTML 会被注入桥接脚本 |
| `/healthz`、`/ws` | 放行（游戏协议） |
| `/assets/**` | 放行（第三方美术） |
| 其余未命中路径（`*.html` / `js/**` / `css/**` / `data/**` …） | **首次弹免责声明**；同意后按 host 记忆（SharedPreferences），设置内可一键清除；拒绝则 404 |

所有出站请求：仅 `http/https`；构造前校验 host；**拒绝 localhost / 环回 / 私有 / 保留地址**
（`127/8`、`10/8`、`172.16/12`、`192.168/16`、`169.254/16`、`100.64/10`、`224+`、`::1`、`fc00::/7`、
`fe80::/10`）；重定向后重新校验。`/__sp/<name>` 由 APK 自身提供（`webroot/js/<name>`），
第三方无法顶替。

---

## 5. P0-2：服务时注入

上游替换 `index.html` / `assets.js` 会杀掉构建期打的补丁，因此壳在**每个 HTML 响应**里注入：

1. **CORS 守卫**（`window.__SP_CORS_HOOK`）：改写 `HTMLImageElement.prototype.src` 强制
   `crossOrigin='anonymous'` —— 没有它，跨域贴图会让 canvas 被污染，`texImage2D` 抛
   `SecurityError`，**3D 棋盘与 pixi 贴图会整体失效**。
2. **桥接脚本标签**（`window.__SP_SHELL` 守卫）：`/__sp/shell-bridge.js`、`/__sp/dc-bridge.js`。

两段都自带幂等守卫，页面已经加载过就不会重复注入。

---

## 6. 热更新流程

```
① 拉 manifest（验签；失败 → 用内置基线）
② buildTag 落后 → 按镜像链下载 slim 包（断点续传 + sha256）
③ staging 解压（仅 L1：index.html/data.js/js/css/vendor/fonts/shared/sim/data/server/package.json/node_modules）
④ 重放 assets/shell/extras/** + assets/shell/patches/*.json（锚点断言，任一失败即中止）
⑤ transformManifests（CDN 基址）→ 写 buildTag 戳 → 原子切换
⑥ 写健康标志；页面渲染后清除。下次冷启动若标志仍在 → 回滚到上一代
任一步失败 → 保留旧树 + 引导「前往下载最新 APK」
minApk > 当前 versionCode → 直接走 APK 下载，不做热更新
```

- **镜像链**：`<mirror-prefix>` → `gh-proxy.com` → `gh.llkk.cc` → `ghproxy.net` → **由 buildTag 推导的
  R2 直链** → 原始 URL。
- **第 ④ 步不可省**：slim 包是上游内容，不含本壳的桥接脚本与补丁；不重放就等于热更新后
  桥接/DC 接线全部消失（这正是方案里点名的回归）。
- **美术不参与热更新**：改图重传 R2 即全员生效。

---

## 7. 构建

### 7.1 工具链（本机）
JDK 17、Android SDK（platform-34 / build-tools 34.0.0）、Gradle 8.14.3、Node 18+。

```powershell
powershell -File scripts/build-apk.ps1     # fetch-termux-node → build-webroot → assembleRelease
```

### 7.2 各步骤
| 步骤 | 作用 |
|---|---|
| `tools/apk/fetch-termux-node.mjs` | 从 Termux 源拉 7 个 .deb（nodejs-lts 24 + libc++/openssl/libicu/c-ares/libsqlite/zlib，版本 pin；默认官方源，自动回退清华镜像）→ 解 ar+xz → `patch-elf-sonames.mjs` 改成 `lib*.so` 并改写 ELF DT_NEEDED/SONAME → 落 `jniLibs/`（gitignore） |
| `tools/apk/build-webroot.mjs` | 下载**上游** Release 整合包 → 裁剪 slim 集 + 素材 → 覆盖 `extras/` → 应用 `patches/*.json`（锚点找不到直接抛错）→ 安装 host 运行依赖 `{ws, werift}` → 清单改 CDN 基址 → 写 `stamp.txt` / `slim-manifest.txt` → **内置 `assets/shell/`（公钥 + 清单 + extras + patches）** |
| `tools/apk/make-bundle.mjs --slim-only --tag <buildTag>` | 产出 `content-slim-<buildTag>.zip`（L1，实测 ≈8.4MB） |
| `tools/apk/gen-manifest.mjs --tag <buildTag>` | 计算 slim 的 sha256/size，生成并**签名** manifest（同时写仓库副本与 APK 内置基线） |
| `gradle assembleRelease` | 双 ABI（arm64-v8a + x86_64），签名口令从 `local.properties` / `SP_STORE_PASSWORD` 读取（仓库零口令） |

> `build-webroot.mjs --reuse`：**跳过 268MB 上游重下与 npm install**，只重刷 `extras` 与签名资源
> —— 本地迭代必备。

### 7.3 门禁 `tools/apk/check-apk.mjs`（11 项，CI 必过）
签名可验 → 每 ABI 10 个运行库齐备 → 关键 webroot 资产 → DC 接线一致 → `stamp.txt` 进包 →
`node_modules` 只含 host 运行依赖 → 清单带 CDN 基址 → **内置签名资源可验** → **热更新 overlay 齐备** →
**P0-2/免责声明/Ed25519 源码在位**。

### 7.4 素材合规
热更新与内嵌内容都来自**上游官方 Release**（作者自己的分发渠道）；本仓库 Release 只发布壳
APK 与自产内容包（GPL 代码），不重发素材包。

---

## 8. 发布

| 产物 | 位置 |
|---|---|
| APK | R2 `apk/stronghold-<ver>.apk`（多分片上传可传 >300MB） |
| slim 内容包 | GitHub Release 资产 + R2 `apk/content-slim-<buildTag>.zip` |
| 签名清单 | R2 `site/servers.json`、`site/manifest.json`（网页端与 APK 共用同一份） |
| 源码 | fork 分支 `apk`（本工作区 `git push` 被安全扫描拦截 → 走 Git Data API 发布脚本） |

> 站点仓（下载页/清单管理）是**独立仓库**，有独立会话在维护。**`servers.json` 的任何增删改都必须
> 用 `tools/apk/sign.mjs` 重新签名**，否则客户端验签失败会静默回退到下一源。

---

## 9. 联机通道（朋友怎么连）

1. **ZeroTier / Tailscale 直连（推荐）**：同网络后朋友在「服务器」面板填 `http://<房主组网IP>:3000`。国内城际 RTT 15–60ms。
2. **IPv6 直连（朋友零安装）**：房主有全局 IPv6 时 `HOST=::` 双栈监听，朋友直连 `http://[v6]:3000`。
3. **房号直连（伪 P2P）**：房主自动把 {房号→地址} 发布到目录服务；玩家输 4 位房号 → 自动探测 → 直连。
4. **内嵌打洞（WebRTC DataChannel）**：TCP 探测失败时切 `dc-bridge.js`，主机侧 `webrtc-bridge.mjs`（werift）桥接到本机 `/ws`。
5. **隧道兜底**：连签名清单里的常驻服务器。

房主自身的 WebView 连 `http://127.0.0.1:3000`（离线服务）。玩家身份按 origin 隔离，换服需重输名字。

---

## 10. 运维要点

- **私钥备份**：`~/.sp-sign/ed25519.key` 是整条信任链的根，必须离线备份。
- **新增/修改服务器**：改 `servers.json` → `node tools/apk/sign.mjs sign <file>` → `node tools/apk/sign.mjs verify <file>` → 发布到 R2 与站点仓。**不重签 = 客户端弃用该源。**
- **发新版内容**：`make-bundle --slim-only --tag shell-vX.Y.Z` → `gen-manifest --tag shell-vX.Y.Z` → 上传 slim 到 R2/release → 上传 manifest 到 R2 → 客户端下次检查即可热更新（无需重装 APK）。
- **需要改原生层**（Java / 运行层）→ 只能重新发 APK（`minApk` 用来强制）。
- **域名不出现在界面**：线路只显示名称（国内线路 / 国际线路 1/2 / 离线服务 / 自定义线路）。

---

## 11. 已知限制

- 房主进程即房间：杀掉 App 全房解散（游戏状态只在服务器内存，DESIGN §6.7）。
- 换服务器地址 = 换 origin，玩家名字需重输（身份按 origin 存 localStorage）。
- `minSdk 26`：Ed25519 需自带纯 Java 实现（见 §3.4）；原生 Ed25519 要 API 28。
- 热更新只能更新 L1（代码+数据）；美术走 CDN；原生层必须重装 APK。
- 运行层为 Termux Node 24 子进程，Android 高版本的后台限制靠前台服务规避。

---

## 12. 版本历史

| 版本 | 要点 |
|---|---|
| v1.0.0 | 首个壳：URL 包装 + 资源内嵌 |
| v2.0.0 | 内嵌房主服务（nodejs-mobile libnode 18）+ 上游热更新通道 + 顶部热区菜单 |
| v2.1.0 | 房号直连（伪 P2P，盒子目录服务）+ WebRTC DataChannel 兜底 + 资源 CDN + 参数面板 |
| v2.2.0 | 标题页切服 + 设置齿轮 + 延迟→路径弹窗 + 第二隧道 + ICE 3s + 网页 DC 引导 |
| v2.3.0 | **运行层换 Termux Node 24 子进程**（`linker64` 启动、配置走 `launch.json`）+ 内嵌面板 + 双 ABI |
| v2.3.1 | 自适应满屏（`FrameLayout` 边到边，修掉底部 12dp 黑带） |
| v2.4.0 | 冷启动修复（`stamp.txt` 跳过重复物化 + 选线后再单次 `loadUrl`）+ 内置线路三变体启动链 + 参数热切换 + R2 静态托管 |
| v2.4.1 | 三端审计修复（dc-bridge 读键、线路单一源、check-apk 断言） |
| v2.5.0 | 房主 slim 包（45MB vs 433MB）+ 原子物化 + 版本迁移清理 + 崩溃取证 + 热重载 |
| v2.5.1 | 3D 棋盘跨域污染修复（全局 `crossOrigin` 守卫 + 拦截器去 CDN 化） |
| v2.5.2 | 同源资产 Worker（`/assets/*` 由 CF 边缘直读 R2）+ 脚本版本戳缓存破坏 |
| **v2.6.0** | **Ed25519 签名服务器清单（三源验签 + 兼容门禁）+ 本地树优先与免责声明 + P0-2 服务时注入 + 清单驱动热更新（镜像链 + sha256 + extras/patches 重放 + 回滚）** |
