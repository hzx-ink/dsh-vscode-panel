<#
.SYNOPSIS
  安装 DeepSeek Harness 的 VS Code 面板：桥接插件（装进桌面版 profile）+ VS Code 扩展。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1

.EXAMPLE
  # 只装桥接插件（桌面版侧）
  powershell -ExecutionPolicy Bypass -File scripts\install.ps1 -SkipExtension
#>
param(
  [string]$DshRoot = 'D:\dsh',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [switch]$SkipBridge,
  [switch]$SkipExtension
)

$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot

function Write-Step($text) { Write-Host "`n== $text" -ForegroundColor Cyan }

if (-not $SkipBridge) {
  Write-Step '打包桥接插件'
  Push-Location (Join-Path $repo 'bridge')
  try {
    npm pack --silent | Out-Null
    $tgz = Get-ChildItem -Filter '*.tgz' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $tgz) { throw 'npm pack 没有产出 .tgz' }

    # 装到 DSH_HOME 下的稳定位置：项目目录以后移动也不影响 profile
    $store = Join-Path $DshHome 'vscode-panel\bridge'
    New-Item -ItemType Directory -Force $store | Out-Null
    $target = Join-Path $store $tgz.Name
    Copy-Item $tgz.FullName $target -Force
    Get-ChildItem $store -Filter 'dsh-vscode-panel-bridge-*.tgz' |
      Where-Object { $_.FullName -ne $target } |
      Remove-Item -Force
  }
  finally {
    Pop-Location
  }

  Write-Step '安装桥接插件到桌面版 profile'
  $cli = Join-Path $DshRoot 'resources\runtime\cli\bin\dsh.cmd'
  if (-not (Test-Path $cli)) { throw "找不到 dsh CLI：$cli（用 -DshRoot 指定 DeepSeek Harness 安装目录）" }

  $env:DSH_HOME = $DshHome
  & $cli plugin --profile desktop add $target
  if ($LASTEXITCODE -ne 0) { throw "桥接插件安装失败（退出码 $LASTEXITCODE）" }

  $manifest = Get-Content (Join-Path $DshHome 'profiles\desktop\package.json') -Raw | ConvertFrom-Json
  if ($manifest.dsh.profile.bundles -notcontains 'dsh-vscode-panel-bridge') {
    throw '桥接插件没有出现在 profile bundles 里，安装未生效'
  }
  Write-Host '✓ 桥接插件已进入桌面版 profile' -ForegroundColor Green
}

if (-not $SkipExtension) {
  Write-Step '构建 VS Code 扩展'
  Push-Location (Join-Path $repo 'extension')
  try {
    if (-not (Test-Path 'node_modules')) { npm install --no-audit --no-fund }
    node esbuild.mjs

    Write-Step '打包并安装 VSIX'
    npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository | Out-Null
    $vsix = Get-ChildItem -Filter '*.vsix' | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $vsix) { throw 'vsce 没有产出 .vsix' }
    code --install-extension $vsix.FullName --force
    if ($LASTEXITCODE -ne 0) { throw "VS Code 安装扩展失败（退出码 $LASTEXITCODE）" }
    Write-Host "✓ 已安装 $($vsix.Name)" -ForegroundColor Green
  }
  finally {
    Pop-Location
  }
}

Write-Host "`n完成。" -ForegroundColor Green
Write-Host '1) 重启桌面版 DeepSeek Harness（桥接插件在启动时挂载）'
Write-Host '2) VS Code 里执行 “Developer: Reload Window”'
Write-Host '3) VS Code 右侧栏（辅助侧边栏）顶部的图标条里点击 DeepSeek Harness'
