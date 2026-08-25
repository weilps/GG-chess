$ErrorActionPreference = "Stop"

$version = "8.30.1"
$expectedSha256 = "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$toolDirectory = Join-Path $root ".local\gitleaks-$version"
$archive = Join-Path $toolDirectory "gitleaks_${version}_windows_x64.zip"
$executable = Join-Path $toolDirectory "gitleaks.exe"

if (-not (Test-Path -LiteralPath $executable)) {
  New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
  Invoke-WebRequest `
    -Uri "https://github.com/gitleaks/gitleaks/releases/download/v$version/gitleaks_${version}_windows_x64.zip" `
    -OutFile $archive
  $actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "Downloaded gitleaks checksum does not match the pinned release"
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $toolDirectory -Force
}

& $executable git --no-banner --no-color --redact --timeout 120 $root
if ($LASTEXITCODE -ne 0) { throw "Secret scan failed" }
