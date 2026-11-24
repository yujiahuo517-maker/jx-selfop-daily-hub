param(
  [Parameter(Mandatory = $false)][string]$Erp = "",
  [Parameter(Mandatory = $false)][string]$Name = "",
  [Parameter(Mandatory = $false)][string]$Server = "https://jx-selfop-board.joyapp.jd.com",
  [Parameter(Mandatory = $false)][string]$Token = "",
  [switch]$NoInit,
  [switch]$SkipDoctor
)

$ErrorActionPreference = "Stop"
$Source = $PSScriptRoot
$SkillRoot = Join-Path $env:USERPROFILE ".joycode\skills"
$Dest = Join-Path $SkillRoot "jx-selfop-daily-hub"

Write-Host "自营 AI 作业中枢 · 安装" -ForegroundColor Cyan
Write-Host "源目录：$Source"
Write-Host "目标：  $Dest"
Write-Host "看板：  $Server"

if (-not (Test-Path -LiteralPath $SkillRoot)) {
  New-Item -ItemType Directory -Path $SkillRoot -Force | Out-Null
}

$same = ([System.IO.Path]::GetFullPath($Source).TrimEnd('\') -ieq [System.IO.Path]::GetFullPath($Dest).TrimEnd('\'))
if (-not $same) {
  if (-not (Test-Path -LiteralPath $Dest)) {
    New-Item -ItemType Directory -Path $Dest -Force | Out-Null
  }
  # 覆盖安装时保留历史上报数据
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
  throw "未找到 Python。请先安装 Python 3.11+（勾选 Add to PATH），再重新运行安装。"
}

$python = Resolve-Python
$pyVersion = & $python -c "import sys; print('%d.%d' % sys.version_info[:2])"
if ($LASTEXITCODE -ne 0) { throw "Python 无法执行，请检查安装。" }
$pyOk = $false
try { $pyOk = ([version]("$pyVersion.0") -ge [version]"3.10.0") } catch { $pyOk = $false }
if (-not $pyOk) {
  throw "Python 版本过低：$pyVersion，需要 3.10+（建议 3.11+）。请升级后重跑安装。"
}
Write-Host "Python：$pyVersion" -ForegroundColor Green

$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
  $nodeVersion = (& $node.Source -v).Trim()
  $nodeMajor = 0
  if ($nodeVersion -match "^v(\d+)") { $nodeMajor = [int]$Matches[1] }
  if ($nodeMajor -ge 18) {
    Write-Host "Node：  $nodeVersion" -ForegroundColor Green
  } else {
    Write-Host "Node：  $nodeVersion（看板需要 18+，日常留痕不受影响）" -ForegroundColor Yellow
  }
} else {
  Write-Host "Node：  未安装（只有本地看板/云端部署需要，日常留痕不依赖它）" -ForegroundColor Yellow
}

$cli = Join-Path $Dest "scripts\jx_task.py"

if (-not $NoInit) {
  if (-not $Erp -or -not $Name) {
    Write-Host ""
    Write-Host "未提供 -Erp / -Name，跳过初始化。" -ForegroundColor Yellow
    Write-Host "稍后运行："
    Write-Host ('  python "' + $cli + '" init --erp <ERP> --name <姓名> --server ' + $Server)
  } else {
    $initArgs = @($cli, "init", "--erp", $Erp, "--name", $Name, "--server", $Server)
    if ($Token) { $initArgs += @("--token", $Token) }
    & $python @initArgs
    if ($LASTEXITCODE -ne 0) { throw "初始化失败，退出码 $LASTEXITCODE" }
    if (-not $Token) {
      Write-Host ""
      Write-Host "提示：还没配置上报令牌，线上看板不会自动汇总你的记录。" -ForegroundColor Yellow
      Write-Host ('      向管理员要本 ERP 的令牌，再跑一次：install.ps1 -Erp ' + $Erp + ' -Name ' + $Name + ' -Token <令牌>')
    }
  }
}

if (-not $SkipDoctor) {
  Write-Host ""
  Write-Host "安装自检：" -ForegroundColor Cyan
  & $python $cli doctor
}

Write-Host ""
Write-Host "安装完成。日常使用：" -ForegroundColor Green
Write-Host ('  python "' + $cli + '" plan            # 今天的作业按时间排好，带 SOP / 依赖 / 完成标准')
Write-Host ('  python "' + $cli + '" start --task <task_id>')
Write-Host ('  python "' + $cli + '" done  --task <task_id> --summary "..."')
Write-Host ('  python "' + $cli + '" fail  --task <task_id> --error "<平台原始原因>"')
Write-Host ""
Write-Host "作业完成看板（全员共用）：$Server"
Write-Host "本机看板（可选，需要 Node 18+）："
Write-Host ('  powershell -ExecutionPolicy Bypass -File "' + $Dest + '\start-dashboard.ps1" -Port 8080')
