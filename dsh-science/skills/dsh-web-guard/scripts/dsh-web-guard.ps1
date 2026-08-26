# dsh-web-guard.ps1 — Windows-native self-healing guard for `dsh web`.
#
# Windows 版守护，对应原仓库 dsh-web-guard.sh（macOS launchd / Linux systemd 版）。
# 目标：dsh web 进程（agent 运行在其中）被 kill / 崩溃 / 机器重启杀死后，
# 由本守护在端口空闲的 10 秒内自动重新拉起来；配合已安装的
# dsh-restart-recover 插件，被中断的 agent turn 会自动续接（用户零输入）。
#
# 关键设计（逐条踩坑所得，勿改）：
#  1. 只认 LISTEN 态 socket 才是"web 活着"——浏览器对端口建立的
#     ESTABLISHED/重连连接不算数，否则 web 死后守护会被浏览器连接挡住，
#     永远不拉起。
#  2. 全部绝对路径 + 显式 PATH——计划任务环境 PATH 极简，.ps1 可能在任何 cwd 下跑。
#  3. Start-Process 直接跑 node <dsh>/lib/bin.js —— 绕开 dsh.cmd 批处理包装
#     （其 `endLocal & goto ... 2>NUL` 与外部重定向相互作用会静默退出）。
#     新 web 进程彻底脱离守护会话，守护退出不影响它；stdout/stderr 分文件重定向。
#  4. 常驻 while 循环——守护本身不死；由 Windows 任务计划程序(等价 launchd/systemd
#     KeepAlive)负责在守护崩溃时重启守护，不会形成"web 起不来→反复拉起"的循环。
#  5. 端口空闲才拉起——有 LISTEN 就不动（与手动启动、ab.sh switch 等协调，不会抢）。
#
# 环境变量（均可用 DGW_* 覆盖；注册计划任务时写入）：
#   DGW_PORT   要守护的端口（默认 3081，与当前 GUI 一致）
#   DGW_LOG    守护与 web 的日志文件（默认 $env:TEMP\dsh-web-guard.log）
#   DGW_WS     web 启动的工作目录（默认 D:\AGENT LEARING）
#   DGW_WEBARG 除了 --port 以外固定的 web 参数（含 --profile web ...）
#   DGW_INTERVAL  轮询间隔秒（默认 10）
#   DGW_DSH    显式指定 dsh 启动器（默认用 PATH 解析的 dsh.cmd）
#
# 用法（必须用 PowerShell 7 — pwsh，见 BOM/UTF-8 说明）：
#   pwsh -NoProfile -ExecutionPolicy Bypass -File dsh-web-guard.ps1      # 前台常驻
#   安装为开机自启：以管理员运行 install-windows.ps1（注册计划任务，内部用 pwsh）
param(
  [int]$Port = $null
)

$ErrorActionPreference = 'Stop'

function NLog([string]$msg) {
  $line = "$([DateTime]::Now.ToString('HH:mm:ss')) guard: $msg"
  try { Add-Content -Path $script:LOG -Value $line -Encoding UTF8 } catch {}
}

# ── 1. 解析参数与环境 ──────────────────────────────────────────────────────
if ($null -eq $Port) {
  $Port = if ($env:DGW_PORT) { [int]$env:DGW_PORT } else { 3081 }
}
$LOG    = if ($env:DGW_LOG)   { $env:DGW_LOG } else { Join-Path $env:TEMP 'dsh-web-guard.log' }
$WS     = if ($env:DGW_WS)    { $env:DGW_WS }  else { 'D:\AGENT LEARING' }
# web 固定参数（除 --port N 以外）。默认与当前 GUI 的一致（含 trusted-host）。
$WEBDEF = '--profile web --host 0.0.0.0 --trusted-host 10.17.65.175:{PORT} --trusted-host 172.30.208.149:{PORT} --trusted-host 172.30.80.1:{PORT}'
$WEBARG = if ($env:DGW_WEBARG) { $env:DGW_WEBARG } else { $WEBDEF }
$INTERV = if ($env:DGW_INTERVAL) { [int]$env:DGW_INTERVAL } else { 10 }

# dsh 启动方式：直接跑 node <dsh>/lib/bin.js，绕开 .cmd 批处理包装。
# 为什么不用 dsh.cmd：它为 `SETLOCAL/endLocal & goto #_undefined_# 2>NUL`，
# 与外部 `cmd /c "... >> log 2>&1"` 的重定向相互作用会导致静默退出（踩坑）。
# 直接起 node 进程，Start-Process 用两个独立文件分别重定向 stdout/stderr。
$NodeExe = $env:DGW_NODE
if (-not $NodeExe) {
  $n = Get-Command 'node.exe' -ErrorAction SilentlyContinue
  if ($n) { $NodeExe = $n.Source }
}
if (-not $NodeExe) {
  $n = Get-Command 'node' -ErrorAction SilentlyContinue
  if ($n) { $NodeExe = $n.Source }
}
if (-not (Test-Path $NodeExe)) { NLog "node.exe not found — aborting"; exit 1 }

$DshBin = $env:DGW_DSH
if (-not $DshBin) {
  $c = Get-Command 'dsh.cmd' -ErrorAction SilentlyContinue
  if ($c) {
    # C:\...\npm\dsh.cmd -> C:\...\npm\node_modules\@deepseek-ai\dsh\lib\bin.js
    $DshBin = Join-Path (Split-Path $c.Source) 'node_modules\@deepseek-ai\dsh\lib\bin.js'
  }
}
if (-not (Test-Path $DshBin)) { NLog "dsh bin.js not found at $DshBin — aborting"; exit 1 }
$WsAbs = $WS
if (-not [System.IO.Path]::IsPathRooted($WsAbs)) { $WsAbs = (Join-Path (Get-Location) $WsAbs) }
if (-not (Test-Path $WsAbs)) {
  NLog "workspace $WsAbs missing — falling back to HOME"
  $WsAbs = $env:USERPROFILE
}
NLog "guard up port=$Port node=$NodeExe bin=$DshBin ws=$WsAbs interval=${INTERV}s"

# ── 2. 常驻循环 ───────────────────────────────────────────────────────────
# 只认 LISTEN 态 socket（踩坑点 1）：`Get-NetTCPConnection -State Listen`。
while ($true) {
  $listening = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue
  if (-not $listening) {
    NLog "port $Port free — starting dsh web"
    # 完全脱离会话启动：隐藏窗口，输出重定向，cwd=workspace。
    # 参数 = 固定参数(WEBARG，{PORT} 已替换) + --port N；Start-Process 不以
    # 双引号为分隔词，只按空格切分，因此绝不把含空格的路径塞进 ArgumentList。
    $outLog = $LOG
    $errLog = "$LOG.err"
    # 固定参数拆成词条（按空格），再拼上 --port N。
    $webArgs = ($WEBARG -replace '\{PORT\}', "$Port").Split(' ')
    $argList = @()
    foreach ($a in $webArgs) { if ($a.Trim() -ne '') { $argList += $a } }
    $argList += @('--port', "$Port")
    try {
      # 直接 node <bin.js> ... —— 两路日志分文件（Start-Process 不允许同文件）。
      $nodeArgs = @($DshBin) + $argList
      Start-Process -FilePath $NodeExe `
        -ArgumentList $nodeArgs `
        -WorkingDirectory $WsAbs -WindowStyle Hidden `
        -RedirectStandardOutput $outLog -RedirectStandardError $errLog
      NLog "spawn issued for $Port (node $NodeExe)"
    } catch {
      NLog "spawn failed: $($_.Exception.Message)"
    }
  }
  Start-Sleep -Seconds $INTERV
}
