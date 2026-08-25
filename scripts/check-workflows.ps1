$ErrorActionPreference = "Stop"

$version = "1.7.12"
$expectedSha256 = "6e7241b51e6817ea6a047693d8e6fed13b31819c9a0dd6c5a726e1592d22f6e9"
$root = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$toolDirectory = Join-Path $root ".local\actionlint-$version"
$archive = Join-Path $toolDirectory "actionlint_${version}_windows_amd64.zip"
$executable = Join-Path $toolDirectory "actionlint.exe"

if (-not (Test-Path -LiteralPath $executable)) {
  New-Item -ItemType Directory -Path $toolDirectory -Force | Out-Null
  Invoke-WebRequest `
    -Uri "https://github.com/rhysd/actionlint/releases/download/v$version/actionlint_${version}_windows_amd64.zip" `
    -OutFile $archive
  $actualSha256 = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($actualSha256 -ne $expectedSha256) {
    throw "Downloaded actionlint checksum does not match the pinned release"
  }
  Expand-Archive -LiteralPath $archive -DestinationPath $toolDirectory -Force
}

& $executable (Join-Path $root ".github\workflows\quality.yml") (Join-Path $root ".github\workflows\release-windows.yml")
if ($LASTEXITCODE -ne 0) { throw "GitHub workflow validation failed" }
