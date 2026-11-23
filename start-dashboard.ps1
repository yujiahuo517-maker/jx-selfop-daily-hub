param(
  [int]$Port = 8080,
  [string]$Bind = "0.0.0.0",
  [switch]$Demo
)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Server = Join-Path $Root "dashboard\server.js"

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "未找到 Node.js。请安装 Node.js 18+ 后重试；看板零依赖，不需要 npm install。"
}
if (-not (Test-Path -LiteralPath $Server)) {
  throw "未找到看板服务：$Server"
}

$nodeArgs = @($Server, "--port", "$Port", "--host", $Bind)
if ($Demo) { $nodeArgs += "--demo" }

Write-Host "启动自营 AI 作业完成看板：http://127.0.0.1:$Port/" -ForegroundColor Cyan
Write-Host "局域网访问：http://<本机IP>:$Port/ （仅 -Bind 0.0.0.0 时对外开放）"
Write-Host "采集接口：POST http://<本机IP>:$Port/api/report"
if ($Bind -eq "0.0.0.0") {
  Write-Host "首次对外开放需放通防火墙（管理员 PowerShell 执行一次）：" -ForegroundColor DarkGray
  Write-Host ('  New-NetFirewallRule -DisplayName "JX Selfop Dashboard" -Direction Inbound -Protocol TCP -LocalPort ' + $Port + ' -Action Allow')
}
Write-Host "按 Ctrl+C 停止。"
& node @nodeArgs
