<#
.SYNOPSIS
  注册 / 移除「自营作业每日执行单」Windows 计划任务

.DESCRIPTION
  把 automation\daily-run.ps1 挂到 Windows 计划任务，每天固定时间生成当日执行单并写日志。
  只做清单与提醒，不代替人做平台写操作。

.PARAMETER Erp
  执行人 ERP，写进计划任务参数。

.PARAMETER Time
  每天触发时间 HH:mm，默认 08:55。

.PARAMETER TaskName
  计划任务名称，默认 JX-Selfop-Daily。

.PARAMETER StartDashboard
  触发时顺带启动本地看板服务。

.PARAMETER Unregister
  删除该计划任务。

.PARAMETER RunNow
  注册后立刻跑一次验证。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Erp zhangsan1 -Time 08:55

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Unregister
#>
param(
    [string]$Erp = "",
    [string]$Time = "08:55",
    [string]$TaskName = "JX-Selfop-Daily",
    [switch]$StartDashboard,
    [int]$Port = 8080,
    [switch]$Unregister,
    [switch]$RunNow
)

$ErrorActionPreference = "Stop"
$runner = Join-Path $PSScriptRoot "daily-run.ps1"
if (-not (Test-Path -LiteralPath $runner)) { throw "找不到 $runner" }

if ($Unregister) {
    $removed = schtasks.exe /Delete /TN $TaskName /F 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "删除计划任务失败（退出码 $LASTEXITCODE）：$removed" }
    Write-Output $removed.Trim()
    Write-Output "已移除计划任务：$TaskName"
    return
}

if ($Time -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw "时间格式应为 HH:mm，例如 08:55，实际：$Time" }

$inner = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`""
if ($Erp) { $inner += " -Erp $Erp" }
if ($StartDashboard) { $inner += " -StartDashboard -Port $Port" }
if ($inner.Length -gt 261) { throw "计划任务命令 $($inner.Length) 字符，超过 schtasks 上限 261；请把技能装到更短路径。" }

$created = schtasks.exe /Create /TN $TaskName /SC DAILY /ST $Time /TR $inner /F 2>&1 | Out-String
if ($LASTEXITCODE -ne 0) { throw "注册计划任务失败（退出码 $LASTEXITCODE）：$created" }
Write-Output $created.Trim()
Write-Output ""
Write-Output "--- 任务详情 ---"
schtasks.exe /Query /TN $TaskName /FO LIST /V 2>&1 | Out-String | Write-Output

if ($RunNow) {
    Write-Output "--- 立即运行一次 ---"
    schtasks.exe /Run /TN $TaskName 2>&1 | Out-String | Write-Output
    Start-Sleep -Seconds 5
}

$homeDir = $env:JX_SELFOP_HOME
if (-not $homeDir) { $homeDir = Join-Path $env:USERPROFILE ".jx-selfop" }
Write-Output ""
Write-Output "已注册：每天 $Time 生成执行单；日志目录 $homeDir\logs"
Write-Output "移除：powershell -ExecutionPolicy Bypass -File automation\register-task.ps1 -Unregister"
Write-Output "注意：机器休眠或关机时任务不会执行，醒来后手动跑一次 daily-run.ps1 即可补上。"
Write-Output "注意：任务以「仅交互式」注册（Logon Mode: Interactive only），需本人登录桌面才会触发。"
