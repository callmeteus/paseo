<#
.SYNOPSIS
  Rebuilds the Paseo desktop app and reinstalls it without ever leaving the machine without it.

.DESCRIPTION
  Order is the guarantee. Everything that can fail runs while the old app is still up: the build,
  the installer check, the snapshot of what is running. Only a verified installer stops Paseo.
  From that point a detached phase (the agent that asked for the reinstall dies with the app)
  waits for the reply to drain, stops Paseo, installs, relaunches, and retries until the desktop
  process and every port it was listening on are back. If the install itself fails, it relaunches
  the app that is still installed, so the machine returns in the state it was in.

  What the reinstall does not touch is daemon-owned state: PASEO_HOME keeps the daemon
  configuration and the Hub relationship, so a Hub that was connected reconnects when the daemon
  starts again, and any standalone daemon on another port keeps running throughout.

.PARAMETER SkipBuild
  Reinstall the installer already present in packages/desktop/release.

.PARAMETER DrainSeconds
  How long the detached phase waits before stopping Paseo, so the reply that asked for the
  reinstall can finish.

.PARAMETER RestoreTimeoutSeconds
  How long the detached phase keeps retrying the relaunch and the port checks.

.PARAMETER ResumePath
  Internal. The detached phase re-runs this script with the state file the foreground wrote.
#>
[CmdletBinding()]
param(
  [switch]$SkipBuild,
  [int]$DrainSeconds = 90,
  [int]$RestoreTimeoutSeconds = 300,
  [string]$ResumePath
)

$ErrorActionPreference = "Stop"

$RepoRoot = Split-Path -Parent $PSScriptRoot
$StateDir = Join-Path $RepoRoot ".tmp"
$LogPath = Join-Path $StateDir "reinstall-desktop.log"
$StatusPath = Join-Path $StateDir "reinstall-desktop.status.json"
$StatePath = Join-Path $StateDir "reinstall-desktop.state.json"
$ReleaseDir = Join-Path $RepoRoot "packages\desktop\release"
$InstallDir = Join-Path $env:LOCALAPPDATA "Programs\Paseo"
$Exe = Join-Path $InstallDir "Paseo.exe"

New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format o), $Message
  Add-Content -Path $LogPath -Value $line
  Write-Host $line
}

function Get-PaseoProcesses {
  return @(Get-Process -Name "Paseo" -ErrorAction SilentlyContinue)
}

function Get-PaseoPorts {
  $ids = @(Get-PaseoProcesses | Select-Object -ExpandProperty Id)
  if ($ids.Count -eq 0) { return @() }
  # Service ports, not the OS-assigned loopback ports Electron opens and never reuses.
  return @(
    Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
      Where-Object { ($ids -contains $_.OwningProcess) -and ($_.LocalPort -lt 49152) } |
      Select-Object -ExpandProperty LocalPort -Unique
  )
}

function Test-ListenPort([int]$Port) {
  $listener = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $_.LocalPort -eq $Port } |
    Select-Object -First 1
  return $null -ne $listener
}

function Get-InstallerArch {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "ARM64" { return "arm64" }
    "AMD64" { return "x64" }
    default { return "x86" }
  }
}

function Select-Installer {
  $pattern = "Paseo-Setup-*-{0}.exe" -f (Get-InstallerArch)
  return Get-ChildItem -Path $ReleaseDir -Filter $pattern -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTime -Descending |
    Select-Object -First 1
}

function Stop-Paseo {
  Get-PaseoProcesses | ForEach-Object {
    try { $_.CloseMainWindow() | Out-Null } catch { }
  }
  Start-Sleep -Seconds 3
  for ($attempt = 0; $attempt -lt 60; $attempt++) {
    $remaining = Get-PaseoProcesses
    if ($remaining.Count -eq 0) { return $true }
    $remaining | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
  }
  return (Get-PaseoProcesses).Count -eq 0
}

function Invoke-Restore {
  $state = Get-Content -Path $ResumePath -Raw | ConvertFrom-Json
  $recordedPorts = @($state.Ports)

  Write-Log ("restore phase: waiting {0}s for the reply to drain" -f $DrainSeconds)
  Start-Sleep -Seconds $DrainSeconds

  if (-not (Stop-Paseo)) {
    Write-Log "WARNING: Paseo processes survived the stop; the installer may fail to replace files"
  }

  $installerOk = $false
  try {
    Write-Log ("running installer {0}" -f $state.Installer)
    $process = Start-Process -FilePath $state.Installer -ArgumentList "/S" -PassThru -Wait
    Write-Log ("installer exit code {0}" -f $process.ExitCode)
    $installerOk = ($process.ExitCode -eq 0) -and (Test-Path -LiteralPath $Exe)
  } catch {
    Write-Log ("installer failed: {0}" -f $_.Exception.Message)
  }
  if (-not $installerOk) {
    Write-Log "install did not complete; the previously installed app is relaunched so the machine comes back"
  }

  if (-not $state.DesktopWasRunning) {
    Write-Log "desktop was not running before this reinstall; leaving it installed and stopped"
    $summary = @{
      FinishedAt = (Get-Date).ToString("o")
      Installer = $state.Installer
      InstallerOk = $installerOk
      DesktopRunning = $false
      PortsRestored = $false
      MissingPorts = @($recordedPorts)
    }
    $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $StatusPath -Encoding UTF8
    return
  }

  $deadline = (Get-Date).AddSeconds($RestoreTimeoutSeconds)
  $portsRestored = $false
  while ((Get-Date) -lt $deadline) {
    if (-not (Test-Path -LiteralPath $Exe)) {
      Write-Log ("waiting for {0} to exist" -f $Exe)
      Start-Sleep -Seconds 5
      continue
    }
    if ((Get-PaseoProcesses).Count -eq 0) {
      Write-Log ("starting {0}" -f $Exe)
      try { Start-Process -FilePath $Exe | Out-Null } catch { Write-Log ("start failed: {0}" -f $_.Exception.Message) }
      Start-Sleep -Seconds 12
      continue
    }
    $missing = @($recordedPorts | Where-Object { -not (Test-ListenPort ([int]$_)) })
    if ($missing.Count -eq 0) {
      $portsRestored = $true
      break
    }
    Write-Log ("desktop is up; waiting for ports {0}" -f ($missing -join ", "))
    Start-Sleep -Seconds 5
  }

  $missingPorts = @($recordedPorts | Where-Object { -not (Test-ListenPort ([int]$_)) })
  $desktopRunning = (Get-PaseoProcesses).Count -gt 0
  $summary = @{
    FinishedAt = (Get-Date).ToString("o")
    Installer = $state.Installer
    InstallerOk = $installerOk
    DesktopRunning = $desktopRunning
    PortsRestored = $portsRestored
    MissingPorts = $missingPorts
  }
  $summary | ConvertTo-Json -Depth 4 | Set-Content -Path $StatusPath -Encoding UTF8
  Write-Log ("restore phase finished: install={0}, desktop={1}, ports={2}, missing={3}" -f `
      $installerOk, $desktopRunning, $portsRestored, (($missingPorts -join ", ")))
  if (-not $desktopRunning -or -not $portsRestored) {
    Write-Log "ERROR: the machine did not return to the state it was in; see the log above"
  }
}

if ($ResumePath) {
  $restored = $false
  try {
    Invoke-Restore
    $restored = $true
  } catch {
    # Last line of defense: whatever broke, leave the machine with Paseo running.
    Write-Log ("restore phase failed: {0}" -f $_.Exception.Message)
    if (((Get-PaseoProcesses).Count -eq 0) -and (Test-Path -LiteralPath $Exe)) {
      Write-Log "fallback: starting the installed app so the machine is not left without Paseo"
      try { Start-Process -FilePath $Exe | Out-Null } catch { }
    }
  }
  if ($restored) { exit 0 }
  exit 1
}

function Invoke-Build {
  # Start-Process owns the streams. PowerShell 5.1 turns a native command's stderr into a
  # terminating error when it is piped with `2>&1`, which aborts a build that is actually
  # succeeding; electron-builder writes deprecation warnings to stderr.
  $outLog = Join-Path $StateDir "reinstall-desktop.build.log"
  $errorLog = Join-Path $StateDir "reinstall-desktop.build.error.log"
  Write-Log ("building the desktop app; output goes to {0}" -f $outLog)
  $build = Start-Process -FilePath "npm.cmd" `
    -ArgumentList @("run", "build:desktop") `
    -WorkingDirectory $RepoRoot `
    -NoNewWindow -PassThru -Wait `
    -RedirectStandardOutput $outLog `
    -RedirectStandardError $errorLog
  if ($build.ExitCode -ne 0) {
    $tail = @(Get-Content -Path $errorLog -Tail 20 -ErrorAction SilentlyContinue)
    Write-Log ("build stderr tail: {0}" -f ($tail -join " | "))
    throw ("npm run build:desktop failed with exit code {0}" -f $build.ExitCode)
  }
}

try {
  Write-Log ("=== reinstall requested (skipBuild={0}, drain={1}s) ===" -f $SkipBuild, $DrainSeconds)

  $buildStarted = Get-Date
  if (-not $SkipBuild) { Invoke-Build }

  $installer = Select-Installer
  if ($null -eq $installer) {
    throw ("no Paseo-Setup installer found in {0}" -f $ReleaseDir)
  }
  if (-not $SkipBuild -and $installer.LastWriteTime -lt $buildStarted) {
    throw ("the installer {0} predates this build; refusing to stop anything" -f $installer.FullName)
  }
  Write-Log ("installer ready: {0} ({1})" -f $installer.FullName, $installer.LastWriteTime)

  $state = @{
    Installer = $installer.FullName
    DesktopWasRunning = ((Get-PaseoProcesses).Count -gt 0)
    Ports = @(Get-PaseoPorts)
    StartedAt = (Get-Date).ToString("o")
    RestoreTimeoutSeconds = $RestoreTimeoutSeconds
  }
  $state | ConvertTo-Json -Depth 4 | Set-Content -Path $StatePath -Encoding UTF8
  Write-Log ("snapshot: desktop={0}, ports={1}" -f $state.DesktopWasRunning, (($state.Ports) -join ", "))

  $powershell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $restoreArguments = @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-File", ('"{0}"' -f $PSCommandPath),
    "-ResumePath", ('"{0}"' -f $StatePath),
    "-DrainSeconds", "$DrainSeconds",
    "-RestoreTimeoutSeconds", "$RestoreTimeoutSeconds"
  )
  Start-Process -FilePath $powershell -ArgumentList $restoreArguments -WindowStyle Hidden | Out-Null
  Write-Log ("restore phase spawned; it stops Paseo in {0}s, installs, relaunches and retries" -f $DrainSeconds)

  Write-Output ("installer=" + $installer.FullName)
  Write-Output ("log=" + $LogPath)
} catch {
  Write-Log ("ABORTED: {0}. Nothing was stopped; Paseo is still running." -f $_.Exception.Message)
  Write-Output ("ABORTED: " + $_.Exception.Message)
  exit 1
}
