# install-windows.ps1 — 把 dsh-web-guard 自启挂到 Windows（等价 macOS launchd / Linux systemd）。
#
# PowerShell 7 (pwsh) 专用。幂等。
#
# 两种自启机制：
#   A) 启动文件夹 / Run 注册表（默认，无需管理员）：用户登录时启动守护。
#      守护脚本自身是不死循环（web dead -> 拉起 web），等价 systemd Restart=always。
#   B) 计划任务（可选，需管理员）：额外提供"守护进程崩溃也由系统重启守护"。
#      `-RegisterTask` 并已管理员运行时走这条。
#
# 用法：
#   pwsh -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1                  # 装自启(A)，立即启动守护
#   pwsh -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 -Port 3081
#   pwsh -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 -RegisterTask    # 额外注册计划任务(需管理员)
#   pwsh -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 -Uninstall
#   pwsh -NoProfile -ExecutionPolicy Bypass -File install-windows.ps1 -Status
param(
  [int]$Port = 3081,
  [switch]$Uninstall,
  [switch]$Status,
  [switch]$RegisterTask
)

$ErrorActionPreference = 'Stop'

$GuardPs1 = Join-Path $env:USERPROFILE '.dsh\skills\dsh-web-guard\scripts\dsh-web-guard.ps1'
$Pwsh     = "$env:ProgramFiles\PowerShell\7\pwsh.exe"
$TaskName = 'dsh-web-guard'
# 启动文件夹里的启动器（.cmd 调 pwsh 跑守护）。
$StartupDir = [Environment]::GetFolderPath('Startup')
$StartupVbs = Join-Path $StartupDir 'dsh-web-guard.launcher.cmd'
$RunKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
$RunName = 'dsh-web-guard'

function Test-AutoStart {
  $byStartup = Test-Path $StartupVbs
  $byRun = $null -ne (Get-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue)
  return ($byStartup -or $byRun)
}

function Remove-AutoStart {
  Remove-Item $StartupVbs -ErrorAction SilentlyContinue
  Remove-ItemProperty -Path $RunKey -Name $RunName -ErrorAction SilentlyContinue
}

if ($Status) {
  Write-Host ("[status] autostart: " + $(if (Test-AutoStart) { 'installed' } else { 'not installed' }))
  if (Test-AutoStart) { Write-Host ("         startup: $StartupVbs") }
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Write-Host ("[status] scheduled task '{0}': {1}" -f $TaskName, (Get-ScheduledTask -TaskName $TaskName).State)
  } else {
    Write-Host "[status] scheduled task: not installed"
  }
  # 守护进程本身是否在跑
  $g = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
         Where-Object { $_.CommandLine -match 'dsh-web-guard\.ps1' }
  Write-Host ("[status] guard running: " + $(if($g){"yes (pid $($g.ProcessId -join ','))"}else{'no'}))
  exit 0
}

if ($Uninstall) {
  Remove-AutoStart
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  }
  # 杀掉正在跑的守护
  Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'dsh-web-guard\.ps1' } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  Write-Host "[uninstall] removed autostart + task + running guard"
  exit 0
}

# ── 前置校验 ────────────────────────────────────────────────────────────────
if (-not (Test-Path $Pwsh)) { Write-Host "error: pwsh 7 not found at $Pwsh"; exit 1 }
if (-not (Test-Path $GuardPs1)) { Write-Host "error: guard script missing at $GuardPs1"; exit 1 }

# ── A) 启动文件夹启动器（无需管理员）──────────────────────────────────────
$startupCmd = "@echo off`r`nstart ""dsh-web-guard"" /min `"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$GuardPs1`" -Port $Port`r`n"
Set-Content -Path $StartupVbs -Value $startupCmd -Encoding Ascii
# 同时写 Run 键（两者启动器等价；Run 键更稳，startup 目录作冗余/可视化）
New-ItemProperty -Path $RunKey -Name $RunName -PropertyType String -Value "`"$Pwsh`" -NoProfile -ExecutionPolicy Bypass -File `"$GuardPs1`" -Port $Port" -Force | Out-Null
Write-Host "[install] autostart (Run key + startup .cmd) for port $Port — no admin needed"
Write-Host "         guard: $GuardPs1"

# ── B) 计划任务（可选，需管理员）──────────────────────────────────────────
if ($RegisterTask) {
  Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue |
    ForEach-Object { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false }
  $action  = New-ScheduledTaskAction -Execute $Pwsh -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$GuardPs1`" -Port $Port"
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 9999 `
    -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0) `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "[install] scheduled task '$TaskName' registered + started (needs admin)"
} else {
  Write-Host "[install] (Task Scheduler 需要管理员；当前用 Run 键自启。) 也可加 -RegisterTask 以管理员运行。"
}

# ── 立即启动守护（web 活着就不动，只启动循环）──────────────────────────
$running = Get-CimInstance Win32_Process -Filter "Name='pwsh.exe'" -ErrorAction SilentlyContinue |
             Where-Object { $_.CommandLine -match 'dsh-web-guard\.ps1.*Port ?-? ?' }
if (-not $running) {
  Start-Process -FilePath $Pwsh -ArgumentList "-NoProfile","-ExecutionPolicy","Bypass","-File",$GuardPs1,"-Port","$Port" -WindowStyle Hidden
  Write-Host "[install] guard started now"
} else {
  Write-Host "[install] guard already running"
}
