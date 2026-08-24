param(
  [Parameter(Mandatory = $true)]
  [string]$InstallerPath
)

$ErrorActionPreference = "Stop"
if ($env:CI -ne "true" -or -not $env:RUNNER_TEMP) {
  throw "Installer smoke is restricted to an isolated CI runner"
}

$resolvedInstaller = (Resolve-Path -LiteralPath $InstallerPath).Path
$installRoot = Join-Path $env:RUNNER_TEMP "ChessMateSmoke"
$dataRoot = Join-Path $env:APPDATA "app.chessmate.desktop"
$preservationMarker = Join-Path $dataRoot "installer-preservation-smoke.txt"

New-Item -ItemType Directory -Path $dataRoot -Force | Out-Null
Set-Content -LiteralPath $preservationMarker -Value "preserve-me" -Encoding UTF8

function Invoke-Installer {
  $process = Start-Process -FilePath $resolvedInstaller -ArgumentList @("/S", "/D=$installRoot") -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)" }
}

Invoke-Installer
$application = Get-ChildItem -LiteralPath $installRoot -Filter "ChessMate.exe" -Recurse | Select-Object -First 1
if (-not $application) { throw "ChessMate.exe was not installed" }

$running = Start-Process -FilePath $application.FullName -PassThru -WindowStyle Hidden
Start-Sleep -Seconds 8
if ($running.HasExited) { throw "Installed ChessMate exited during launch smoke" }
Stop-Process -Id $running.Id
$running.WaitForExit()

# A second pass exercises the install/update preservation contract without needing an older public build.
Invoke-Installer
if ((Get-Content -LiteralPath $preservationMarker -Raw).Trim() -ne "preserve-me") {
  throw "Application data changed during reinstall"
}

$uninstaller = Get-ChildItem -LiteralPath $installRoot -Filter "uninstall*.exe" -Recurse | Select-Object -First 1
if (-not $uninstaller) { throw "NSIS uninstaller was not installed" }
$uninstall = Start-Process -FilePath $uninstaller.FullName -ArgumentList "/S" -Wait -PassThru -WindowStyle Hidden
if ($uninstall.ExitCode -ne 0) { throw "Uninstaller exited with code $($uninstall.ExitCode)" }
if (-not (Test-Path -LiteralPath $preservationMarker)) { throw "Uninstall removed ChessMate user data" }

Write-Output "Installer launch, reinstall and data-preserving uninstall smoke passed"
