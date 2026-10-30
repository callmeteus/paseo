$ErrorActionPreference = "Continue"
$log = "C:\Users\Gio\Documents\Projetos\paseo\.tmp\install-paseo.log"
$installer = "C:\Users\Gio\Documents\Projetos\paseo\packages\desktop\release\Paseo-Setup-0.13.1-x64.exe"
$app = "$env:LOCALAPPDATA\Programs\Paseo\Paseo.exe"

"$(Get-Date -Format o) start" | Out-File -FilePath $log -Append -Encoding utf8
Start-Sleep -Seconds 10

"$(Get-Date -Format o) stopping Paseo" | Out-File -FilePath $log -Append -Encoding utf8
Get-Process -Name Paseo -ErrorAction SilentlyContinue | Stop-Process -Force
Start-Sleep -Seconds 3

if (-not (Test-Path -LiteralPath $installer)) {
  "$(Get-Date -Format o) installer missing: $installer" | Out-File -FilePath $log -Append -Encoding utf8
  exit 1
}

"$(Get-Date -Format o) running installer" | Out-File -FilePath $log -Append -Encoding utf8
$install = Start-Process -FilePath $installer -ArgumentList "/S" -Wait -PassThru
"$(Get-Date -Format o) installer exit $($install.ExitCode)" | Out-File -FilePath $log -Append -Encoding utf8
Start-Sleep -Seconds 5

if (Test-Path -LiteralPath $app) {
  "$(Get-Date -Format o) launching $app" | Out-File -FilePath $log -Append -Encoding utf8
  Start-Process -FilePath $app
} else {
  "$(Get-Date -Format o) app missing after install: $app" | Out-File -FilePath $log -Append -Encoding utf8
}

"$(Get-Date -Format o) done" | Out-File -FilePath $log -Append -Encoding utf8
