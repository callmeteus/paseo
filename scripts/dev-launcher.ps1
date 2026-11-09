param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("daemon", "app")]
    [string]$Target
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$env:PATH = "$RootDir\node_modules\.bin;$env:PATH"

# Derive PASEO_HOME: stable name for worktrees, temporary dir otherwise
if (-not $env:PASEO_HOME) {
    $GitDir = git rev-parse --git-dir 2>$null
    $GitCommonDir = git rev-parse --git-common-dir 2>$null

    if ($GitDir -and $GitCommonDir -and ($GitDir -ne $GitCommonDir)) {
        $WorktreeRoot = git rev-parse --show-toplevel
        $WorktreeName = (Split-Path -Leaf $WorktreeRoot).ToLower() -replace '[^a-z0-9-]', '-' -replace '-+', '-' -replace '^-|-$', ''
        $env:PASEO_HOME = "$env:USERPROFILE\.paseo-$WorktreeName"
        New-Item -ItemType Directory -Force -Path $env:PASEO_HOME | Out-Null
    } else {
        $env:PASEO_HOME = Join-Path ([System.IO.Path]::GetTempPath()) "paseo-dev-$([System.Guid]::NewGuid().ToString('N').Substring(0,6))"
        New-Item -ItemType Directory -Force -Path $env:PASEO_HOME | Out-Null
        $TempPaseoHome = $env:PASEO_HOME
        Register-EngineEvent PowerShell.Exiting -Action {
            Remove-Item -Recurse -Force $TempPaseoHome -ErrorAction SilentlyContinue
        } | Out-Null
    }
}

# Share speech models with the main install to avoid duplicate downloads
if (-not $env:PASEO_LOCAL_MODELS_DIR) {
    $env:PASEO_LOCAL_MODELS_DIR = "$env:USERPROFILE\.paseo\models\local-speech"
    New-Item -ItemType Directory -Force -Path $env:PASEO_LOCAL_MODELS_DIR | Out-Null
}

# Prefer the tailnet address so the same dev bundle works from this PC and from
# another Tailscale device.
$TailscaleIp = $null
if (Get-Command tailscale -ErrorAction SilentlyContinue) {
    $TailscaleIp = (tailscale ip -4 2>$null | Select-Object -First 1)
    if ($TailscaleIp) { $TailscaleIp = $TailscaleIp.Trim() }
}
$TailnetHost = if ($TailscaleIp) { $TailscaleIp } else { "localhost" }

$DaemonPort = if ($env:PASEO_DEV_DAEMON_PORT) { $env:PASEO_DEV_DAEMON_PORT } else { "6768" }
$MetroPort = if ($env:EXPO_PORT) { $env:EXPO_PORT } else { "8081" }

# Bind every interface and allow any origin/hostname in dev so Electron on random
# ports and tailnet clients all work. SECURITY: wildcard CORS/hostnames are unsafe
# in production - only acceptable here because this script never runs production.
$env:PASEO_CORS_ORIGINS = "*"
$env:PASEO_HOSTNAMES = "true"
$env:PASEO_LISTEN = "0.0.0.0:$DaemonPort"
$env:APP_VARIANT = "development"
$env:BROWSER = "none"

if ($Target -eq "daemon") {
    Write-Host @"
======================================================
  Paseo Dev Daemon (Windows)
======================================================
  Home:    $($env:PASEO_HOME)
  Models:  $($env:PASEO_LOCAL_MODELS_DIR)
  Daemon:  $($env:PASEO_LISTEN)
  Tailnet: http://$($TailnetHost):$DaemonPort
======================================================
"@
    npm run dev:server:watch
    exit $LASTEXITCODE
}

# The bundle points at the tailnet daemon so the same build works from this PC
# and from another Tailscale device.
$env:EXPO_PUBLIC_LOCAL_DAEMON = "$TailnetHost`:$DaemonPort"
$env:EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL = (git branch --show-current).Trim()

Write-Host @"
======================================================
  Paseo App Dev (Windows)
======================================================
  Home:    $($env:PASEO_HOME)
  Metro:   http://localhost:$MetroPort
  Tailnet: http://$($TailnetHost):$MetroPort
  Daemon:  $($env:EXPO_PUBLIC_LOCAL_DAEMON)
======================================================
"@

Push-Location (Join-Path $RootDir "packages\app")
try {
    npx expo start --host lan --port $MetroPort
} finally {
    Pop-Location
}
exit $LASTEXITCODE
