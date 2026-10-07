# scripts\check-public-ipv6.ps1 — 「公网 IPv6 能不能连进来」一键自查（只读，不改任何设置）
#
# 用法（在项目根目录；任意一台能上网的 Windows 电脑上都可以跑）：
#   powershell -ExecutionPolicy Bypass -File scripts\check-public-ipv6.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\check-public-ipv6.ps1 -Address 240e:47f:9240:abd0::1 -Port 3000
#
# 它做三件事：
#   1. 找出本机的公网 IPv6 地址（如果有）；
#   2. 测 TCP 3000 能不能连上（.NET 直连，不依赖浏览器）；
#   3. 用 HTTP 拉一次 /healthz 确认对端真的是这个游戏服务器。
#
# 判断标准（docs\DEPLOY.md 2.5）：
#   * 显示「连不上 / 超时」→ 入站被静默丢弃，多半是光猫 / 路由器的 IPv6 防火墙（不是电脑的问题）；
#   * 显示 200 与版本号 → 通了，把 -Address 显示的那个地址发给朋友即可。
#
# 服务器那边的默认绑定就是 '::' 双栈（server/http/config.js DEFAULT_BIND_HOST），所以这里不用改任何配置，
# 只要 Windows 防火墙放行了端口（scripts\public-ipv6.ps1 -Firewall，或 docs\IPV6.md）。

[CmdletBinding()]
param(
  [string]$Address = '',
  [int]$Port = 3000,
  [int]$TimeoutMs = 8000
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

function Find-PublicV6 {
  $cands = Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -notlike 'fe80*' -and $_.IPAddress -ne '::1' -and $_.PrefixOrigin -ne 'WellKnown' }
  # 2000::/3 是全球单播；240e/2409/2408 是国内三大运营商的常见前缀
  $global = $cands | Where-Object { $_.IPAddress -match '^[23]' }
  if ($global) { return ($global | Sort-Object -Property @{Expression={ if ($_.IPAddress -match '^(240e|2409|2408)') { 0 } else { 1 } }})[0].IPAddress }
  if ($cands) { return $cands[0].IPAddress }
  return $null
}

if (-not $Address) {
  $Address = Find-PublicV6
  if (-not $Address) {
    Write-Host '没有找到公网 IPv6 地址：这台电脑的宽带可能没有 IPv6。' -ForegroundColor Yellow
    Write-Host '（链路本地 fe80:: 开头的地址不能用，需要 240e: / 2409: / 2408: 这类全球地址。）'
    exit 2
  }
  Write-Host "本机公网 IPv6：$Address" -ForegroundColor Cyan
}

$url = "http://[$Address]:$Port"
Write-Host "目标：$url"
Write-Host ''

Write-Host "[1/2] TCP 连接 $Address $Port ..."
# 必须显式指定 IPv6：默认构造的 TcpClient 只认 IPv4，BeginConnect 会报 address family 不匹配
$tcp = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]::InterNetworkV6)
try {
  $iar = $tcp.BeginConnect($Address, $Port, $null, $null)
  if (-not $iar.AsyncWaitHandle.WaitOne($TimeoutMs)) {
    Write-Host '  ✘ 超时：入站被静默丢弃 —— 通常是光猫 / 路由器的 IPv6 防火墙，或宽带没有公网 IPv6。' -ForegroundColor Red
    Write-Host '    （docs\DEPLOY.md 2.5：需要在光猫里放行或关闭 IPv6 防火墙，或改桥接由自己的路由器拨号。）' -ForegroundColor DarkGray
    exit 1
  }
  $tcp.EndConnect($iar)
  Write-Host '  ✔ TCP 已连接' -ForegroundColor Green
} catch {
  Write-Host "  ✘ 连接被拒绝 / 失败：$($_.Exception.Message)" -ForegroundColor Red
  Write-Host '    立刻失败（而不是超时）通常说明包到了电脑但服务没在监听：确认服务器正在运行。' -ForegroundColor DarkGray
  exit 1
} finally { $tcp.Close() }

Write-Host "[2/2] HTTP GET $url/healthz ..."
try {
  $resp = Invoke-WebRequest -Uri "$url/healthz" -TimeoutSec ([int]($TimeoutMs / 1000) + 2) -UseBasicParsing
  Write-Host "  ✔ HTTP $($resp.StatusCode)" -ForegroundColor Green
  $json = $null
  try { $json = $resp.Content | ConvertFrom-Json } catch { }
  if ($json -and $json.ok) {
    Write-Host "  ✔ 确认是游戏服务器：v$($json.app) · 运行 $($json.uptimeSec)s · 房间 $($json.rooms) · 对局 $($json.matches) · 连接 $($json.sockets)" -ForegroundColor Green
    Write-Host ''
    Write-Host "把它发给朋友：$url" -ForegroundColor Cyan
    exit 0
  }
  Write-Host '  ! 端口通了，但回应不像这个游戏服务器（可能被别的程序占用）。' -ForegroundColor Yellow
  exit 1
} catch {
  Write-Host "  ✘ 失败：$($_.Exception.Message)" -ForegroundColor Red
  exit 1
}
