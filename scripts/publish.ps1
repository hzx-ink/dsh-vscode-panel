param(
  [switch]$OpenVsx,
  [string]$Pat = $env:VSCE_PAT,
  [string]$OvsxPat = $env:OVSX_PAT,
  [switch]$SkipBuild
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

Write-Host '== 1/3 打包桥接插件 =='
node scripts\bundle-bridge.mjs

Write-Host '== 2/3 编译并生成 VSIX =='
Push-Location extension
try {
  npx tsc -p tsconfig.json --noEmit
  if ($LASTEXITCODE -ne 0) { throw '类型检查失败' }
  node esbuild.mjs
  $vsix = (Get-ChildItem *.vsix -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
  npx --yes @vscode/vsce package --no-dependencies --allow-missing-repository | Out-Host
  $vsix = (Get-ChildItem *.vsix | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
} finally {
  Pop-Location
}
Write-Host "VSIX: $vsix"

if ($OpenVsx) {
  if (-not $OvsxPat) { throw '未设置 OVSX_PAT。在 https://open-vsx.org 生成 token 后重试。' }
  Write-Host '== 3/3 发布到 Open VSX =='
  npx --yes ovsx publish $vsix -p $OvsxPat
  exit $LASTEXITCODE
}

if (-not $Pat) {
  Write-Warning '未设置 VSCE_PAT，已完成打包但未发布。'
  Write-Warning '设置 $env:VSCE_PAT 后重跑，或把 VSIX 发给别人手动安装。'
  exit 2
}

Write-Host '== 3/3 发布到 VS Code Marketplace =='
npx --yes @vscode/vsce publish --packagePath $vsix -p $Pat
exit $LASTEXITCODE