$ErrorActionPreference = "Stop"
$log = Join-Path $PSScriptRoot "reinstall-paseo-latest.log"
function Log($message) {
  Add-Content -Path $log -Value "[$(Get-Date -Format o)] $message"
}

$exe = Join-Path $env:LOCALAPPDATA "Programs\Paseo\Paseo.exe"
$installer = Join-Path $PSScriptRoot "..\packages\desktop\release\Paseo-Setup-0.13.1-x64.exe"

try {
  # Let the current agent response finish before the app and its daemon go down.
  Start-Sleep -Seconds 30
  Log "Stopping Paseo"
  Get-Process Paseo -ErrorAction SilentlyContinue | Stop-Process -Force
  Start-Sleep -Seconds 5

  $installer = (Resolve-Path $installer).Path
  Log "Running installer $installer"
  $process = Start-Process -FilePath $installer -ArgumentList "/S" -PassThru -Wait
  Log "Installer exit code $($process.ExitCode)"

  if (-not (Test-Path $exe)) {
    throw "Installed executable not found at $exe"
  }

  Start-Sleep -Seconds 3
  Log "Starting $exe"
  Start-Process -FilePath $exe
  Log "Done"
} catch {
  Log "ERROR: $($_.Exception.Message)"
}
