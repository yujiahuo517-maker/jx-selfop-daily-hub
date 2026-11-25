<#
.SYNOPSIS
  自营 AI 作业中枢 · 每日自动执行入口（只生成执行单，不做平台写操作）

.DESCRIPTION
  由 Windows 计划任务在固定时间调用：生成当日执行单 Markdown + 打印执行顺序 + 写运行日志。
  它不会替你提交活动、不会改价、不会操作平台；真正的写操作仍要在会话里按 SOP 执行并回读。

.PARAMETER Erp
  执行人 ERP。省略时使用 init 时保存的本人配置。

.PARAMETER Date
  指定日期（YYYY-MM-DD），默认今天。

.PARAMETER StartDashboard
  顺带在后台启动本地看板服务。

.PARAMETER Port
  看板端口，默认 8080。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File automation\daily-run.ps1

.EXAMPLE
powershell -ExecutionPolicy Bypass -File automation\daily-run.ps1 -Erp <本人ERP> -StartDashboard
#>
param(
    [string]$Erp = "",
    [string]$Date = "",
    [switch]$StartDashboard,
    [int]$Port = 8080
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$cli = Join-Path $root "scripts\jx_task.py"
if (-not (Test-Path -LiteralPath $cli)) { throw "找不到 CLI：$cli" }

$homeDir = $env:JX_SELFOP_HOME
if (-not $homeDir) { $homeDir = Join-Path $env:USERPROFILE ".jx-selfop" }
$logDir = Join-Path $homeDir "logs"
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logFile = Join-Path $logDir ("daily-" + (Get-Date -Format "yyyyMMdd-HHmmss") + ".log")

$exe = $null
$pre = @()
$cmd = Get-Command python -ErrorAction SilentlyContinue
if ($cmd) {
    $exe = $cmd.Source
} else {
    $cmd = Get-Command py -ErrorAction SilentlyContinue
    if ($cmd) { $exe = $cmd.Source; $pre = @("-3") }
}
if (-not $exe) { throw "未找到 python。请安装 Python 3.11+ 并加入 PATH。" }

$cliArgs = @($cli, "plan", "--save")
if ($Erp) { $cliArgs += @("--erp", $Erp) }
if ($Date) { $cliArgs += @("--date", $Date) }

$output = & $exe @($pre + $cliArgs) 2>&1
$code = $LASTEXITCODE
$body = ($output | Out-String).TrimEnd()

$stamp = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
$logLines = @("[$stamp] command: $exe $($pre -join ' ') $($cliArgs -join ' ')", "[$stamp] exit=$code", $body)
$logLines | Set-Content -LiteralPath $logFile -Encoding UTF8

$dashboard = ""
if ($StartDashboard) {
    $nodeCmd = Get-Command node -ErrorAction SilentlyContinue
    if ($nodeCmd) {
        $listening = $null
        try { $listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue } catch { $listening = $null }
        if (-not $listening) {
            Start-Process -WindowStyle Hidden -FilePath $nodeCmd.Source -ArgumentList @("server.js", "--port", "$Port") -WorkingDirectory (Join-Path $root "dashboard") | Out-Null
            Start-Sleep -Seconds 2
            $dashboard = "started http://127.0.0.1:$Port/"
        } else {
            $dashboard = "already running http://127.0.0.1:$Port/"
        }
    } else {
        $dashboard = "node 未安装，已跳过看板"
    }
}

$summary = [ordered]@{
    ran_at    = $stamp
    erp       = $Erp
    exit      = $code
    log       = $logFile
    plan_file = Join-Path $homeDir ("daily\" + (Get-Date -Format "yyyy-MM-dd") + "-plan.md")
    dashboard = $dashboard
}
($summary | ConvertTo-Json -Compress) | Set-Content -LiteralPath (Join-Path $logDir "last-run.json") -Encoding UTF8
$summary | ConvertTo-Json | Write-Output

if ($code -ne 0) { Write-Output "执行单生成失败，退出码 $code，详见 $logFile" }
exit $code
