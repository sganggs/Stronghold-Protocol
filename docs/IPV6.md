# 自己开一台公网 IPv6 服务器（给朋友看的）

目标：在**你自己的 Windows 电脑**上开一台《卫戍协议：盟约》服务器，让朋友通过公网 IPv6 连进来玩。

一条命令搞定：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Serve
```

它会依次：检查 Node → 检查依赖/素材 → 找你的公网 IPv6 → 查/加防火墙规则 → 检查端口 → 启动服务器
→ 打印要发给朋友的地址。

## 准备工作

1. **Windows 10/11**
2. **Node.js 22 或更高**：`winget install OpenJS.NodeJS.LTS`，装完重开终端
3. **游戏本体**：从 [Releases](https://github.com/sganggs/Stronghold-Protocol/releases) 下完整包解压
   （已含素材，省掉 270 MB 下载），或 `git clone` 后跑 `node tools\setup.mjs`
4. **宽带要有 IPv6**。国内三大运营商的家宽基本都支持。自检：脚本第 3 步会说
   「公网 IPv6: 240e:...」还是「这台电脑没有公网 IPv6 地址」

## 跑起来之后

脚本会打印类似：

```
发给朋友的地址（方括号不能少）:
  http://[240e:47f:9240:abd0:22c7:d29c:ca82:2472]:3000
```

**把这个整条发给朋友**（方括号不能少，那是 IPv6 地址在 URL 里的写法）。

朋友那边只需要：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Join "http://[240e:47f:9240:abd0:22c7:d29c:ca82:2472]:3000"
```

脚本会测 TCP → 拉一次 `/healthz` 确认对面真是这个游戏 → 打开浏览器。
**或者更简单**：让朋友用**手机流量**直接打开那个地址（手机作为访问方没有任何限制）。

默认绑定已经就是双栈，所以**不用改任何配置**。想自己确认的话：

```powershell
node tools\doctor.mjs                  # 「朋友如何访问」会列出 IPv4 和 IPv6 地址（IPv6 带方括号）
curl.exe "http://[::1]:3000/healthz"   # 本机 IPv6 回环
```

代码里对应三处：`server/http/config.js` 的 `DEFAULT_BIND_HOST = '::'`（绑定地址，含 IPv6 不可用时的
IPv4 回退）、`server/http/boot.js` 的 `lanUrls()`（开机横幅里的地址清单：IPv6 加方括号、跳过 `fe80::`、
按 /64 去重）、`tools/doctor.mjs` 的 `classifyAddresses()`（把地址分成局域网 / VPN / 公网 / 虚拟网卡）。

## 常用参数

| 参数 | 说明 |
|---|---|
| `-Port 8080` | 换端口（默认 3000） |
| `-NoStart` | 只做检查并打印结果，不启动服务器 |
| `-Firewall` | 只加防火墙规则后退出（自己会请求管理员权限，弹 UAC） |
| `-Install` | 注册开机自启（需管理员；长期开服用） |
| `-Join "<地址>"` | 玩家模式：验证并加入别人的服务器 |

## 连不上时按顺序排查

脚本已经把大部分原因指出来了，对应关系：

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 第 3 步说「没有公网 IPv6」 | 宽带没开 IPv6，或光猫/路由器没下发 | 找运营商开通；或改用 Tailscale / cloudflared（见 `docs/DEPLOY.md` 第 2 节） |
| 第 4 步说「没有放行规则」 | Windows 防火墙挡着 | 跑 `-Firewall`，或用管理员 PowerShell 手动加（脚本会打印命令） |
| 朋友那显示 **超时** | 包被静默丢弃 | **多半是光猫/路由器的 IPv6 防火墙**（很多默认开着且普通账号关不掉）。关掉它，或把光猫改**桥接**由自己路由器拨号 |
| 朋友那**立刻失败** | 包到了但服务没监听 | 确认服务器在跑、端口对得上、地址没抄错 |
| 昨天还能连，今天不行 | **家宽 IPv6 前缀变了**（重拨/租期到期） | 重新跑 `-Serve` 拿新地址发给朋友；长期开服配 DDNS（域名 AAAA 记录） |

## 三个必须知道的点

1. **IPv6 没有 NAT，不需要端口转发。** 只要放行入站就行 —— 这比公网 IPv4 那套省事得多。
2. **家宽 IPv6 前缀会变**（通常几十小时一次）。地址变了，朋友收藏的链接就失效。
   长期开服建议配 DDNS。
3. **游戏没有账号系统，知道地址的人都能进来。** 只发给朋友，别公开发布。

## 其他可选的

- **想放自己的曲子**：见 `docs/BGM.md`
- **想让服务器开机自动跑**：`-Install`，之后用 `scripts\install-service-windows.ps1 -Status` 看状态
- **想让电脑不休眠**：`powercfg /change standby-timeout-ac 0`
