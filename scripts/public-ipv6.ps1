<#
  卫戍协议：盟约 · 公网 IPv6 开服助手（Windows）

  把「用 IPv6 让朋友连进来玩」变成两条命令。

  ── 开服的人（服务器那台电脑）──────────────────────────────────────────────
      powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Serve
    找公网 IPv6 → 查/加防火墙规则 → 启动服务器（双栈）→ 打印要发给朋友的地址

      -Port 8080     换端口
      -NoStart       只检查和报告，不启动
      -Firewall      只加防火墙规则后退出（需要时脚本自己请求管理员权限）
      -Install       注册开机自启（需管理员）

  ── 玩的人（朋友那台电脑）──────────────────────────────────────────────────
      powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Join "http://[240e:xxxx::1]:3000"
    测 TCP → 拉一次 /healthz 确认对面真是这个游戏 → 打开浏览器

  为什么要做这个：v0.1.3 的启动窗口和 node tools\doctor.mjs 只列 IPv4 地址，开服的人
  看不到自己的公网 IPv6 是多少。v0.1.4 起 server/http/config.js（HOST 默认 ::）、
  server/http/boot.js（LAN/公网地址清单）、scripts\launch.mjs 和 tools\doctor.mjs 都已经
  能给出 IPv6（默认 :: 双栈，见 docs/IPV6.md），但那些入口只是「列出来」；这个脚本仍然
  负责一键菜单、防火墙放行、开机自启和「朋友那边能不能连」的自检，所以照旧有用。

  前提：双方宽带都要有 IPv6（国内三大运营商的家宽基本都有，手机流量也有）。
#>
[CmdletBinding()]
param(
  [switch]$Serve,
  [string]$Join = '',
  [int]$Port = 3000,
  [switch]$Firewall,
  [switch]$Install,
  [switch]$NoStart,
  # 交互菜单（scripts\start-public-ipv6.bat 用）。所有中文菜单都放这里而不是 .bat 里 ——
  # CMD 按「当前代码页」逐行解析批处理文件，UTF-8 的中文在 GBK 控制台下会把 rem 行解成乱码命令；
  # 所以 .bat 保持纯 ASCII，只负责转发。
  [switch]$Menu
)

$ErrorActionPreference = 'Continue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent $PSScriptRoot
$RuleName = 'Stronghold Protocol'

function Say($text, $color = 'Gray') { Write-Host $text -ForegroundColor $color }
function Line { Write-Host ('-' * 62) -ForegroundColor DarkGray }
function Ok($t) { Write-Host "  [OK] $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [!!] $t" -ForegroundColor Yellow }
function Bad($t) { Write-Host "  [XX] $t" -ForegroundColor Red }

function Test-Admin {
  try {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    $pr = New-Object Security.Principal.WindowsPrincipal($id)
    return $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch { return $false }
}

function Format-Url([string]$addr, [int]$p) {
  if ($addr.Contains(':')) { return 'http://[' + $addr + ']:' + $p }
  return 'http://' + $addr + ':' + $p
}

# ---------------------------------------------------------------------------------------------------
# 公网 IPv6
# ---------------------------------------------------------------------------------------------------

function Get-PublicIPv6 {
  $all = @(Get-NetIPAddress -AddressFamily IPv6 -ErrorAction SilentlyContinue)
  $best = @{}
  foreach ($a in $all) {
    $ip = [string]$a.IPAddress
    if (-not $ip) { continue }
    if ($ip.StartsWith('fe80')) { continue }
    if ($ip -eq '::1') { continue }
    if ($a.PrefixOrigin -eq 'WellKnown') { continue }
    if ($ip -notmatch '^[23]') { continue }
    $parts = $ip.Split(':')
    if ($parts.Count -lt 4) { continue }
    $prefix = ($parts[0..3] -join ':')
    # 0 = 稳定地址（RA 下发，SuffixOrigin Link），1 = 临时隐私地址（Random，约 24h 轮换）。
    # 同一个 /64 只留排名更好的那条：Windows 隐私扩展会给同一前缀配多个地址，
    # 而要发给朋友的是稳定那条 —— 临时地址会轮换，收藏的链接随后就失效了。
    $rank = 1
    if ($a.SuffixOrigin -eq 'Link') { $rank = 0 }
    if ($best.ContainsKey($prefix)) {
      if ($best[$prefix].Rank -le $rank) { continue }
    }
    $best[$prefix] = [pscustomobject]@{ Address = $ip; Rank = $rank }
  }
  # 稳定地址排前；其次运营商常见前缀（240e/2409/2408）优先
  $sorted = @($best.Values | Sort-Object Rank, @{ Expression = { if ($_.Address -match '^(240e|2409|2408)') { 0 } else { 1 } } })
  $result = New-Object System.Collections.ArrayList
  foreach ($x in $sorted) { $null = $result.Add($x.Address) }
  return $result
}

# ---------------------------------------------------------------------------------------------------
# 解析玩家给的地址
# ---------------------------------------------------------------------------------------------------

function Parse-JoinTarget([string]$raw) {
  $s = $raw.Trim()
  $i = $s.IndexOf('://')
  if ($i -ge 0) { $s = $s.Substring($i + 3) }
  while ($s.EndsWith('/')) { $s = $s.Substring(0, $s.Length - 1) }

  $hostPart = $s
  $port = $Port

  if ($s.StartsWith('[')) {
    $end = $s.IndexOf(']')
    if ($end -lt 0) { throw '地址里的 [ 没有对应的 ] : ' + $raw }
    $hostPart = $s.Substring(1, $end - 1)
    $after = $s.Substring($end + 1)
    if ($after.StartsWith(':')) {
      $pn = 0
      if (-not [int]::TryParse($after.Substring(1), [ref]$pn)) { throw '端口不是数字: ' + $after }
      $port = $pn
    } elseif ($after.Length -gt 0) {
      throw '无法解析: ' + $after
    }
  } else {
    $colons = ($s.ToCharArray() | Where-Object { $_ -eq ':' }).Count
    if ($colons -eq 1) {
      $idx = $s.IndexOf(':')
      $hostPart = $s.Substring(0, $idx)
      $pn2 = 0
      if (-not [int]::TryParse($s.Substring($idx + 1), [ref]$pn2)) { throw '端口不是数字: ' + $s }
      $port = $pn2
    }
  }

  if (-not $hostPart) { throw '地址为空: ' + $raw }
  if (-not $hostPart.Contains(':')) { throw '这不是 IPv6 地址（本脚本只处理 IPv6）: ' + $hostPart }
  return @{ Host = $hostPart; Port = $port; Url = (Format-Url $hostPart $port) }
}

# ---------------------------------------------------------------------------------------------------
# 防火墙
# ---------------------------------------------------------------------------------------------------

function Get-PortRules([int]$p) {
  $raw = ''
  try { $raw = (netsh advfirewall firewall show rule name=all dir=in verbose 2>$null | Out-String) } catch { return @() }
  $list = New-Object System.Collections.ArrayList
  if (-not $raw) { return $list }
  $chunks = $raw -split "(?m)^\s*$"
  foreach ($c in $chunks) {
    $mPort = [regex]::Match($c, 'LocalPort:\s*(\S+)')
    if (-not $mPort.Success) { continue }
    $isPort = $false
    foreach ($tok in $mPort.Groups[1].Value.Split(',')) {
      $n = 0
      if ([int]::TryParse($tok.Trim(), [ref]$n) -and $n -eq $p) { $isPort = $true }
    }
    if (-not $isPort) { continue }
    $name = [regex]::Match($c, 'Rule Name:\s*(.+)').Groups[1].Value.Trim()
    $act = [regex]::Match($c, 'Action:\s*(.+)').Groups[1].Value.Trim()
    $prof = [regex]::Match($c, 'Profiles:\s*(.+)').Groups[1].Value.Trim()
    $en = [regex]::Match($c, 'Enabled:\s*(.+)').Groups[1].Value.Trim()
    $null = $list.Add([pscustomobject]@{ Name = $name; Action = $act; Profiles = $prof; Enabled = $en })
  }
  return $list
}

function Get-AllowRules([int]$p) {
  $all = @(Get-PortRules $p)
  $keep = New-Object System.Collections.ArrayList
  foreach ($r in $all) {
    if ($r.Action -match 'Allow' -and $r.Enabled -match 'Yes') { $null = $keep.Add($r) }
  }
  return $keep
}

function Add-FirewallRuleElevated([int]$p) {
  $inner = 'netsh advfirewall firewall add rule name="' + $RuleName + '" dir=in action=allow protocol=TCP localport=' + $p + ' profile=any'
  Say '需要管理员权限添加防火墙规则，正在请求…（会弹 UAC，请点「是」）' 'Yellow'
  try {
    $pa = @('-NoProfile', '-Command', $inner)
    $proc = Start-Process -FilePath 'powershell' -Verb RunAs -Wait -PassThru -ArgumentList $pa
    return ($proc.ExitCode -eq 0)
  } catch {
    Warn ('提权被取消或失败: ' + $_.Exception.Message)
    return $false
  }
}

function Show-Firewall([int]$p) {
  $rules = @(Get-AllowRules $p)
  if ($rules.Count -gt 0) {
    foreach ($r in $rules) { Ok ('已有入站放行规则「' + $r.Name + '」(' + $r.Profiles + ')') }
    return $true
  }
  Warn ('没有放行 TCP ' + $p + ' 入站的防火墙规则。')
  Say '    加一条（会弹 UAC）：' 'DarkGray'
  Say ('      powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Firewall') 'Cyan'
  Say '    或管理员 PowerShell 手动：' 'DarkGray'
  Say ('      ' + 'netsh advfirewall firewall add rule name="' + $RuleName + '" dir=in action=allow protocol=TCP localport=' + $p + ' profile=any') 'DarkGray'
  return $false
}

# ---------------------------------------------------------------------------------------------------
# 连通性
# ---------------------------------------------------------------------------------------------------

function Test-Tcp6([string]$addr, [int]$p, [int]$timeoutMs = 8000) {
  $tcp = New-Object System.Net.Sockets.TcpClient([System.Net.Sockets.AddressFamily]::InterNetworkV6)
  try {
    $iar = $tcp.BeginConnect($addr, $p, $null, $null)
    if (-not $iar.AsyncWaitHandle.WaitOne($timeoutMs)) { return @{ Ok = $false; Why = 'timeout' } }
    $tcp.EndConnect($iar)
    return @{ Ok = $true; Why = 'connected' }
  } catch {
    return @{ Ok = $false; Why = $_.Exception.Message }
  } finally {
    try { $tcp.Close() } catch { }
  }
}

function Get-Health([string]$url, [int]$timeoutSec = 10) {
  try {
    $r = Invoke-WebRequest -Uri ($url + '/healthz') -UseBasicParsing -TimeoutSec $timeoutSec
    $j = $null
    try { $j = $r.Content | ConvertFrom-Json } catch { }
    return @{ Ok = $true; Status = $r.StatusCode; Json = $j }
  } catch {
    return @{ Ok = $false; Why = $_.Exception.Message }
  }
}

# ---------------------------------------------------------------------------------------------------
# 玩家模式
# ---------------------------------------------------------------------------------------------------

function Invoke-Join([string]$raw) {
  Line
  Say '卫戍协议：盟约 · 加入游戏 (IPv6)' 'White'
  Line

  try { $t = Parse-JoinTarget $raw } catch { Bad $_.Exception.Message; return 1 }
  Say ('目标: ' + $t.Url)
  Say ''

  Say '[1/3] 本机有没有公网 IPv6 …'
  $mine = @(Get-PublicIPv6)
  if ($mine.Count -eq 0) {
    Bad '本机没有公网 IPv6 地址。'
    Say '    -> 你的宽带可能没开 IPv6。换个网络（手机热点/流量）再试，' 'DarkGray'
    Say '       或让开服的人改用 Tailscale / cloudflared 隧道（docs\DEPLOY.md 第 2 节）。' 'DarkGray'
    return 1
  }
  Ok ('有: ' + $mine[0])

  Say ('[2/3] TCP 连接 ' + $t.Host + ' ' + $t.Port + ' …')
  $r = Test-Tcp6 $t.Host $t.Port
  if (-not $r.Ok) {
    if ($r.Why -eq 'timeout') {
      Bad '超时：连不上。'
      Say '    -> 多半是对方光猫/路由器的 IPv6 防火墙挡了入站（不是你的问题）。' 'DarkGray'
      Say '       也可能是对方服务器没在跑，或地址变了（家宽 IPv6 前缀会变）。' 'DarkGray'
    } else {
      Bad ('失败: ' + $r.Why)
      Say '    -> 立刻失败通常说明包到了对方电脑但服务没监听，或地址写错了。' 'DarkGray'
    }
    return 1
  }
  Ok 'TCP 已连接'

  Say '[3/3] 确认对面是这个游戏 …'
  $h = Get-Health $t.Url
  if (-not $h.Ok) { Bad ('拿不到 /healthz: ' + $h.Why); return 1 }
  if ($h.Json -and $h.Json.ok) {
    Ok ('确认: v' + $h.Json.app + ' · 运行 ' + $h.Json.uptimeSec + 's · 房间 ' + $h.Json.rooms + ' · 对局 ' + $h.Json.matches)
  } else {
    Warn '端口通了，但回应不像这个游戏服务器（可能被别的程序占用）。'
    return 1
  }

  Say ''
  Ok '可以玩。正在打开浏览器 …'
  try { Start-Process $t.Url } catch { Say ('请手动打开: ' + $t.Url) 'Cyan' }
  return 0
}

# ---------------------------------------------------------------------------------------------------
# 开服模式
# ---------------------------------------------------------------------------------------------------

function Invoke-Serve([int]$p, [bool]$OnlyFirewall, [bool]$NoStartServer, [bool]$InstallService) {
  Line
  Say '卫戍协议：盟约 · 公网 IPv6 开服助手' 'White'
  Line

  if ($OnlyFirewall) {
    if (Show-Firewall $p) { Say '规则已存在，无需改动。'; return 0 }
    if (Test-Admin) {
      try { netsh advfirewall firewall add rule name="$RuleName" dir=in action=allow protocol=TCP localport=$p profile=any | Out-Null } catch { }
    } elseif (-not (Add-FirewallRuleElevated $p)) {
      Bad '没有加成。请用管理员 PowerShell 手动执行上面那条 netsh。'
      return 1
    }
    if (Show-Firewall $p) { Ok '规则已添加。'; return 0 }
    Bad '添加失败。'
    return 1
  }

  Say '[1/6] Node.js …'
  $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
  if (-not $nodeCmd) {
    Bad '没找到 Node.js（需要 22+）。先装: winget install OpenJS.NodeJS.LTS'
    return 1
  }
  $nv = (& node -v) -replace '^v', ''
  $major = 0
  [void][int]::TryParse(($nv.Split('.')[0]), [ref]$major)
  if ($major -lt 22) { Bad ('Node.js ' + $nv + ' 太旧，需要 22+。升级: winget upgrade OpenJS.NodeJS.LTS'); return 1 }
  Ok ('v' + $nv)

  Say '[2/6] 依赖与素材 …'
  $wsPkg = Join-Path $Root 'node_modules\ws\package.json'
  if (-not (Test-Path $wsPkg)) {
    Warn '依赖没装，正在 npm ci（第一次会慢）…'
    Push-Location $Root
    & npm.cmd ci --no-audit --no-fund 2>&1 | Out-Null
    if ($LASTEXITCODE -ne 0) { & npm.cmd install --no-audit --no-fund 2>&1 | Out-Null }
    Pop-Location
    if (-not (Test-Path $wsPkg)) { Bad '依赖安装失败（网络？）。'; return 1 }
  }
  Ok '依赖就绪'
  if (Test-Path (Join-Path $Root 'public\assets')) {
    Ok '素材目录存在'
  } else {
    Warn '素材还没下载（能用占位图跑，但不完整）。补下载: node tools\setup.mjs'
  }

  Say '[3/6] 公网 IPv6 …'
  $addrs = @(Get-PublicIPv6)
  if ($addrs.Count -eq 0) {
    Bad '这台电脑没有公网 IPv6 地址。'
    Say '    -> 宽带没有 IPv6，或路由器/光猫没下发。' 'DarkGray'
    Say '       没有 IPv6 时的替代方案见 docs\DEPLOY.md 第 2 节（Tailscale / cloudflared）。' 'DarkGray'
    return 1
  }
  $share = Format-Url $addrs[0] $p
  Ok ('公网 IPv6: ' + $addrs[0])

  Say '[4/6] 防火墙 …'
  $fwOk = Show-Firewall $p
  if (-not $fwOk) {
    if (Test-Admin) {
      try { netsh advfirewall firewall add rule name="$RuleName" dir=in action=allow protocol=TCP localport=$p profile=any | Out-Null } catch { }
      $fwOk = Show-Firewall $p
    } elseif (Add-FirewallRuleElevated $p) {
      $fwOk = Show-Firewall $p
    }
    if (-not $fwOk) { Warn '防火墙没放行 —— 仍会启动，但外网大概连不进来。' }
  }

  Say '[5/6] 端口 …'
  $busy = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue
  if ($busy) {
    Warn ('端口 ' + $p + ' 已被占用（可能已经开着一个服务器）。')
    $h = Get-Health ('http://[::1]:' + $p)
    if ($h.Ok -and $h.Json.ok) {
      Ok ('看起来已经有一个在跑: v' + $h.Json.app + '，运行 ' + $h.Json.uptimeSec + 's')
    } else {
      Bad ('但 ' + $p + ' 上的东西不响应 /healthz，可能是别的程序。换端口: -Port 3001')
      return 1
    }
  } else {
    Ok ('端口 ' + $p + ' 空闲')
  }

  Say '[6/6] 结果 …'
  Say ''
  Line
  if ($fwOk) { Ok '入站已放行' } else { Warn '入站未放行（外面可能连不进来）' }
  Say ''
  Say '发给朋友的地址（方括号不能少）:' 'White'
  foreach ($a in $addrs) { Say ('  ' + (Format-Url $a $p)) 'Cyan' }
  Say ''
  Say '朋友那边怎么验证:' 'White'
  Say ('  powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Join "' + $share + '"') 'DarkGray'
  Say '或让他用手机流量直接打开上面的地址。' 'DarkGray'
  Line
  Say '注意:' 'White'
  Say '  * 家宽 IPv6 前缀会变（重拨/租期到期，通常几十小时一次）。地址变了要重发。' 'DarkGray'
  Say '    长期开服建议配 DDNS（把域名的 AAAA 记录指向这台主机）。' 'DarkGray'
  Say '  * 很多光猫默认开着 IPv6 防火墙并静默丢弃入站。若朋友超时连不上、而你这里' 'DarkGray'
  Say '    已放行，那就是光猫的问题：关掉它，或改桥接由自己路由器拨号。' 'DarkGray'
  Say '  * 游戏没有账号系统，知道地址的人都能进来。别公开发布。' 'DarkGray'
  Line

  if ($NoStartServer) { Say '(-NoStart: 不启动服务器)'; return 0 }

  if ($InstallService) {
    $isvc = Join-Path $Root 'scripts\install-service-windows.ps1'
    if (-not (Test-Path $isvc)) { Bad ('找不到 ' + $isvc); return 1 }
    Say ''
    Say '注册开机自启（需要管理员，会弹 UAC）…' 'Yellow'
    $svcArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $isvc, '-Port', "$p", '-BindHost', '::')
    try {
      $proc = Start-Process -FilePath 'powershell' -Verb RunAs -Wait -PassThru -ArgumentList $svcArgs
      if ($proc.ExitCode -eq 0) { Ok '已注册。查看状态: scripts\install-service-windows.ps1 -Status'; return 0 }
      Bad ('注册返回 ' + $proc.ExitCode)
    } catch {
      Bad ('提权失败: ' + $_.Exception.Message)
    }
    return 1
  }

  Say ''
  Say '正在启动服务器（双栈，Ctrl+C 停止）…' 'White'
  Push-Location $Root
  try {
    $env:HOST = '::'
    $env:PORT = "$p"
    & node scripts\launch.mjs --host '::' --port "$p"    return $LASTEXITCODE
  } finally {
    Pop-Location
  }
}

# ---------------------------------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------------------------------

function Show-Menu {
  while ($true) {
    Clear-Host
    Write-Host ''
    Say '  ============================================================' 'DarkGray'
    Say '     卫戍协议：盟约 - 公网 IPv6' 'White'
    Say '  ============================================================' 'DarkGray'
    Write-Host ''
    Say '    [1]  开服：启动服务器，让朋友用 IPv6 连进来'
    Say '    [2]  加入：连接朋友的服务器'
    Say '    [3]  只放行防火墙（加一条入站规则，会弹 UAC）'
    Say '    [4]  注册开机自启（服务器长期开着时用，会弹 UAC）'
    Say '    [5]  环境诊断（只检查，不启动）'
    Write-Host ''
    Say '    [0]  退出'
    Write-Host ''
    Say '  ============================================================' 'DarkGray'
    Write-Host ''
    $ch = Read-Host '  请选择 [0-5]'
    switch ($ch) {
      '1' { Invoke-Serve -p $Port -OnlyFirewall $false -NoStartServer $false -InstallService $false; Write-Host ''; Read-Host '  按回车返回菜单' | Out-Null }
      '2' {
        $a = Read-Host '  地址（形如 http://[240e:1234::1]:3000，方括号不能少）'
        if ($a) { Write-Host ''; Invoke-Join $a }
        Write-Host ''; Read-Host '  按回车返回菜单' | Out-Null
      }
      '3' { Invoke-Serve -p $Port -OnlyFirewall $true -NoStartServer $true -InstallService $false; Write-Host ''; Read-Host '  按回车返回菜单' | Out-Null }
      '4' { Invoke-Serve -p $Port -OnlyFirewall $false -NoStartServer $true -InstallService $true; Write-Host ''; Read-Host '  按回车返回菜单' | Out-Null }
      '5' { Invoke-Serve -p $Port -OnlyFirewall $false -NoStartServer $true -InstallService $false; Write-Host ''; Read-Host '  按回车返回菜单' | Out-Null }
      '0' { return 0 }
      default { }
    }
  }
}

if ($Menu) { exit (Show-Menu) }
if ($Join) { exit (Invoke-Join $Join) }
if ($Serve -or $Firewall -or $Install) {
  exit (Invoke-Serve -p $Port -OnlyFirewall:$Firewall.IsPresent -NoStartServer:$NoStart.IsPresent -InstallService:$Install.IsPresent)
}

Line
Say '卫戍协议：盟约 · 公网 IPv6 助手' 'White'
Line
$addrs = @(Get-PublicIPv6)
if ($addrs.Count -gt 0) {
  Ok ('这台电脑有公网 IPv6: ' + $addrs[0])
  Say ''
  Say '看起来你是开服的那一方。跑这个启动服务器:' 'White'
  Say '  powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Serve' 'Cyan'
} else {
  Warn '这台电脑没有公网 IPv6。'
  Say ''
  Say '如果你是开服方: 宽带可能没 IPv6，见 docs\DEPLOY.md 第 2 节的替代方案。' 'White'
  Say '如果你是玩的一方: 让开服的人把地址发你，然后跑:' 'White'
  Say '  powershell -ExecutionPolicy Bypass -File scripts\public-ipv6.ps1 -Join "http://[对方的地址]:3000"' 'Cyan'
}
Line
exit 0
