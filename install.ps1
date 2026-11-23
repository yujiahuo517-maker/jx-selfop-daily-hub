param(
  [Parameter(Mandatory = $false)][string]$Erp = "",
  [Parameter(Mandatory = $false)][string]$Name = "",
  [Parameter(Mandatory = $false)][string]$Server = "",
  [Parameter(Mandatory = $false)][string]$Token = "",
  [switch]$NoInit
)

$ErrorActionPreference = "Stop"
$Source = $PSScriptRoot
$SkillRoot = Join-Path $env:USERPROFILE ".joycode\skills"
$Dest = Join-Path $SkillRoot "jx-selfop-daily-hub"

Write-Host "自营 AI 作业中枢 · 安装" -ForegroundColor Cyan
Write-Host "源目录：$Source"
Write-Host "目标：  $Dest"

if (-not (Test-Path -LiteralPath $SkillRoot)) {
  New-Item -ItemType Directory -Path $SkillRoot -Force | Out-Null
}

$same = ([System.IO.Path]::GetFullPath($Source).TrimEnd('\') -ieq [System.IO.Path]::GetFullPath($Dest).TrimEnd('\'))
if (-not $same) {
  if (-not (Test-Path -LiteralPath $Dest)) {
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  }
  $reportsPath = Join-Path $Dest "data\reports.jsonl"
  $reportsBytes = $null
  if (Test-Path -LiteralPath $reportsPath) {
    $reportsBytes = [System.IO.File]::ReadAllBytes($reportsPath)
  }
  Get-ChildItem -LiteralPath $Source -Force | ForEach-Object {
    if ($_.Name -eq ".git") { return }
    if ($_.Name -eq "dashboard-preview.png") { return }
    if ($_.Name -eq "__pycache__") { return }
    Copy-Item -LiteralPath $_.FullName -Destination $Dest -Recurse -Force
  }
  if ($null -ne $reportsBytes) {
    [System.IO.File]::WriteAllBytes($reportsPath, $reportsBytes)
  } elseif (-not (Test-Path -LiteralPath $reportsPath)) {
    New-Item -ItemType File -Path $reportsPath -Force | Out-Null
  }
  Write-Host "已复制技能文件。" -ForegroundColor Green
} else {
  Write-Host "当前已在目标目录，跳过复制。" -ForegroundColor Yellow
}

function Resolve-Python {
  foreach ($candidate in @("python", "py")) {
    $cmd = Get-Command $candidate -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
  }
  throw "未找到 Python。请先安装 Python 3.11+，再重新运行安装。"
}

$python = Resolve-Python
$cli = Join-Path $Dest "scripts\jx_task.py"

if (-not $NoInit) {
  if (-not $Erp -or -not $Name) {
    Write-Host ""
    Write-Host "未提供 -Erp / -Name，跳过初始化。" -ForegroundColor Yellow
    Write-Host "稍后运行："
    Write-Host ('  python "' + $cli + '" init --erp <ERP> --name <姓名> --server http://<管理员IP>:8080')
  } else {
    $initArgs = @($cli, "init", "--erp", $Erp, "--name", $Name)
    if ($Server) { $initArgs += @("--server", $Server) }
    if ($Token) { $initArgs += @("--token", $Token) }
    & $python @initArgs
    if ($LASTEXITCODE -ne 0) { throw "初始化失败，退出码 $LASTEXITCODE" }
  }
}

Write-Host ""
Write-Host "安装完成。日常使用：" -ForegroundColor Green
Write-Host ('  python "' + $cli + '" today')
Write-Host ('  python "' + $cli + '" start --task <task_id>')
Write-Host ('  python "' + $cli + '" done  --task <task_id> --summary "..."')
Write-Host ""
Write-Host "管理员看板："
Write-Host ('  powershell -ExecutionPolicy Bypass -File "' + $Dest + '\start-dashboard.ps1" -Port 8080')
