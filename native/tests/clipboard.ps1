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
