<#
.SYNOPSIS
  卸载 VS Code 面板：从桌面版 profile 移除桥接插件，并卸载扩展。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\uninstall.ps1
#>
param(
  [string]$DshRoot = 'D:\dsh',
  [string]$DshHome = (Join-Path $env:USERPROFILE '.dsh'),
  [switch]$KeepExtension
)

$ErrorActionPreference = 'Stop'

$cli = Join-Path $DshRoot 'resources\runtime\cli\bin\dsh.cmd'
if (Test-Path $cli) {
  $env:DSH_HOME = $DshHome
  & $cli plugin --profile desktop remove dsh-vscode-panel-bridge
}

$bridgeDir = Join-Path $DshHome 'vscode-panel'
if (Test-Path $bridgeDir) { Remove-Item $bridgeDir -Recurse -Force }

if (-not $KeepExtension) {
  code --uninstall-extension hzx-ink.dsh-vscode-panel
}

Write-Host '已卸载。重启桌面版 DeepSeek Harness 生效。' -ForegroundColor Green
