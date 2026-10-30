param(
  [string]$Title = 'Visual Studio Code',
  [string]$Out = 'preview\vscode-window.png',
  [string]$Process = 'Code'
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinCap2 {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT r);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int cmd);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
}
"@
$target = Get-Process -Name $Process -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$Title*" } |
  Select-Object -First 1
if (-not $target) { throw "no window" }
$handle = $target.MainWindowHandle
[void][WinCap2]::ShowWindow($handle, 3)
[void][WinCap2]::SetWindowPos($handle, [IntPtr]::Zero, 0, 0, 0, 0, 0x0043)  # TOP|SHOWWINDOW|NOSIZE|NOMOVE
[void][WinCap2]::SetForegroundWindow($handle)
try { (New-Object -ComObject WScript.Shell).AppActivate($target.Id) | Out-Null } catch {}
Start-Sleep -Milliseconds 1200
$rect = New-Object WinCap2+RECT
[void][WinCap2]::GetWindowRect($handle, [ref]$rect)
$width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
$bmp = New-Object System.Drawing.Bitmap($width, $height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, (New-Object System.Drawing.Size($width, $height)))
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Host "captured $width x $height -> $Out"
