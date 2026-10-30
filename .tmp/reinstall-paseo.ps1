$ErrorActionPreference = "Stop"
$log = Join-Path $PSScriptRoot "reinstall-paseo.log"
function Log($message) {
  Add-Content -Path $log -Value "[$(Get-Date -Format o)] $message"
}

$exe = Join-Path $env:LOCALAPPDATA "Programs\Paseo\Paseo.exe"

try {
  Start-Sleep -Seconds 12
  Log "Stopping Paseo"
  Get-Process Paseo -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 5

  try {
    $installer = Join-Path $PSScriptRoot "..\packages\desktop\release\Paseo-Setup-0.13.1-x64.exe"
    $installer = (Resolve-Path $installer).Path
    Log "Running installer $installer"
    $process = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru -Wait
    Log "Installer exit code $($process.ExitCode)"
  } catch {
    Log "Installer failed: $($_.Exception.Message)"
  }

  Start-Sleep -Seconds 3
  Log "Starting $exe"
  Start-Process -FilePath $exe
  Log "Done"
} catch {
  Log "ERROR: $($_.Exception.Message)"
}
