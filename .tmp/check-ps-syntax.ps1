$tokens = $null
$errors = $null
[System.Management.Automation.Language.Parser]::ParseFile(
  "C:\Users\Gio\Documents\Projetos\paseo\scripts\dev.ps1",
  [ref]$tokens,
  [ref]$errors
) | Out-Null
if ($errors.Count -gt 0) {
  $errors | ForEach-Object { $_.Message }
  exit 1
}
Write-Output "PS SYNTAX OK"
