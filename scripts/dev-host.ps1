<#
.SYNOPSIS
  启动一个隔离的 DSH host，用来开发/测试桥接插件，不碰正在运行的桌面版。

.DESCRIPTION
  - 在 .test-home 建一个独立的 DSH_HOME
  - 复制当前用户的 .env / .credentials.yaml（模型 API Key）
  - 复制桌面版的 cordis.patch.yml（得到同一批模型）
  - 把 bridge/ 以 file: 方式装进 web profile，然后前台启动

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\dev-host.ps1

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\dev-host.ps1 -Port 3456 -Keep
#>
param(
  [string]$TestHome = (Join-Path (Split-Path -Parent $PSScriptRoot) '.test-home'),
  [string]$DshRoot = 'D:\dsh',
  [int]$Port = 0,
  [switch]$Keep
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$realHome = Join-Path $env:USERPROFILE '.dsh'
$cli = Join-Path $DshRoot 'resources\runtime\cli\bin\dsh.cmd'
if (-not (Test-Path $cli)) { throw "找不到 dsh CLI：$cli" }

if (-not $Keep -and (Test-Path $TestHome)) { Remove-Item $TestHome -Recurse -Force }
New-Item -ItemType Directory -Force $TestHome | Out-Null

foreach ($file in @('.env', '.credentials.yaml')) {
  $source = Join-Path $realHome $file
  if (Test-Path $source) { Copy-Item $source (Join-Path $TestHome $file) -Force }
}

$env:DSH_HOME = $TestHome
Write-Host "DSH_HOME = $TestHome" -ForegroundColor Cyan

& $cli plugin --profile web add (Join-Path $repo 'bridge')
if ($LASTEXITCODE -ne 0) { throw '桥接插件安装失败' }

$desktopPatch = Join-Path $realHome 'profiles\desktop\cordis.patch.yml'
if (Test-Path $desktopPatch) {
  Copy-Item $desktopPatch (Join-Path $TestHome 'profiles\web\cordis.patch.yml') -Force
  Write-Host '已复用桌面版的模型配置' -ForegroundColor Cyan
}

Write-Host '启动测试 host（Ctrl+C 结束）…' -ForegroundColor Cyan
& $cli web --port $Port --no-open
