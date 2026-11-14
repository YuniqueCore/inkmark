$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bitmap = [System.Drawing.Bitmap]::new(1, 1)
try {
    $bitmap.SetPixel(0, 0, [System.Drawing.Color]::Red)
    [System.Windows.Forms.Clipboard]::SetImage($bitmap)
    if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) { throw 'Bitmap clipboard was not populated' }
    # SetImage provides a standard bitmap, not the registered PNG clipboard format.
    if ([System.Windows.Forms.Clipboard]::GetDataObject().GetDataPresent('PNG', $false)) { throw 'Expected a bitmap-only clipboard' }
} finally { $bitmap.Dispose() }

# A normal host is required: nsh test deliberately never reads the system clipboard.
$probe = Start-Process node -ArgumentList @('scripts/nsh.mjs', 'run', 'native/tests/clipboard.tsx', '--target', 'windows', '--verbose') -PassThru -RedirectStandardOutput '.local-build/clipboard-host.log' -RedirectStandardError '.local-build/clipboard-host-error.log'
try {
    $deadline = [DateTime]::UtcNow.AddSeconds(120)
    while ([DateTime]::UtcNow -lt $deadline) {
        $probe.Refresh()
        if ($probe.HasExited) { throw "Clipboard host exited with code $($probe.ExitCode)" }
        $window = Get-Process -Name 'nsh-windows-host' -ErrorAction SilentlyContinue | Where-Object {
            if (-not $_.MainWindowTitle.StartsWith('InkMarkClipboard:')) { return $false }
            # Accept a result only from this launch, never a previously open probe window.
            $ancestor = $_.Id
            while ($ancestor -and $ancestor -ne $probe.Id) {
                $parent = Get-CimInstance Win32_Process -Filter "ProcessId = $ancestor"
                if (-not $parent) { return $false }
                $ancestor = $parent.ParentProcessId
            }
            return $ancestor -eq $probe.Id
        } | Select-Object -First 1
        if ($window) {
            if ($window.MainWindowTitle -ne 'InkMarkClipboard:passed') { throw $window.MainWindowTitle }
            Write-Output 'Real Windows clipboard: NSH read the bitmap-only CF_DIB as a 1x1 BMP'
            return
        }
        Start-Sleep -Milliseconds 200
    }
    throw 'Timed out waiting for the native clipboard probe'
} finally {
    if (-not $probe.HasExited) { & taskkill.exe /PID $probe.Id /T /F | Out-Null }
}
