$ErrorActionPreference = "Stop"

# Ensure node_modules/.bin is in PATH
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:PATH = "$ScriptDir\..\node_modules\.bin;$env:PATH"

# Derive PASEO_HOME: stable name for worktrees, temporary dir otherwise
if (-not $env:PASEO_HOME) {
    $GitDir = git rev-parse --git-dir 2>$null
    $GitCommonDir = git rev-parse --git-common-dir 2>$null

    if ($GitDir -and $GitCommonDir -and ($GitDir -ne $GitCommonDir)) {
        # Inside a worktree — derive a stable home from the worktree name
        $WorktreeRoot = git rev-parse --show-toplevel
        $WorktreeName = (Split-Path -Leaf $WorktreeRoot).ToLower() -replace '[^a-z0-9-]', '-' -replace '-+', '-' -replace '^-|-$', ''
        $env:PASEO_HOME = "$env:USERPROFILE\.paseo-$WorktreeName"
        New-Item -ItemType Directory -Force -Path $env:PASEO_HOME | Out-Null
    } else {
        $env:PASEO_HOME = Join-Path ([System.IO.Path]::GetTempPath()) "paseo-dev-$([System.Guid]::NewGuid().ToString('N').Substring(0,6))"
        New-Item -ItemType Directory -Force -Path $env:PASEO_HOME | Out-Null
        # Register cleanup on exit
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
if (-not $TailscaleIp) { $TailscaleIp = "localhost" }

$DaemonPort = if ($env:PASEO_DEV_DAEMON_PORT) { $env:PASEO_DEV_DAEMON_PORT } else { "6768" }
$MetroPort = if ($env:EXPO_PORT) { $env:EXPO_PORT } else { "8081" }

Write-Host @"
======================================================
  Paseo Dev (Windows)
======================================================
  Home:    $($env:PASEO_HOME)
  Models:  $($env:PASEO_LOCAL_MODELS_DIR)
  Daemon:  $($TailscaleIp):$DaemonPort
  Metro:   http://localhost:$MetroPort
  Tailnet: http://$($TailscaleIp):$MetroPort
======================================================
"@

# Allow any origin and hostname in dev so Electron on random ports and tailnet
# clients all work. SECURITY: wildcard CORS/hostnames are unsafe in production —
# only acceptable here because this script is never used for production.
$env:PASEO_CORS_ORIGINS = "*"
$env:PASEO_HOSTNAMES = "true"

# Configure the app to auto-connect to this daemon through the tailnet address.
$env:APP_VARIANT = "development"
$env:EXPO_PUBLIC_LOCAL_DAEMON = "$TailscaleIp`:$DaemonPort"
$env:EXPO_PUBLIC_PASEO_DEV_BUILD_LABEL = (git branch --show-current).Trim()
$env:PASEO_LISTEN = "0.0.0.0:$DaemonPort"
$env:BROWSER = "none"

# Run both with concurrently
concurrently `
    --names "daemon,metro" `
    --prefix-colors "cyan,magenta" `
    "npm run dev:server:watch" `
    "cd packages/app && npx expo start --host lan --port $MetroPort"
