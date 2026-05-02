$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$sidecarResources = Join-Path $repoRoot "apps\desktop\src-tauri\resources\sidecar"
$tempRoot = Join-Path $env:TEMP ("mcd-sidecar-bundle-" + [guid]::NewGuid().ToString("N"))
$tempSidecar = Join-Path $tempRoot "sidecar"

function Remove-DirectoryIfExists($path) {
  if (Test-Path -LiteralPath $path) {
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

try {
  Remove-DirectoryIfExists $tempRoot
  New-Item -ItemType Directory -Path $tempRoot | Out-Null

  pnpm --filter "@movie-cover-downloader/sidecar" deploy --prod --legacy --config.node-linker=hoisted $tempSidecar
  if ($LASTEXITCODE -ne 0) {
    throw "pnpm deploy sidecar production dependencies failed"
  }

  $nodeCommand = Get-Command node -ErrorAction Stop
  Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $tempSidecar "node.exe") -Force

  Remove-DirectoryIfExists (Join-Path $tempSidecar "src")
  Remove-Item -LiteralPath (Join-Path $tempSidecar "README.md") -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath (Join-Path $tempSidecar "tsconfig.json") -Force -ErrorAction SilentlyContinue
  Get-ChildItem -LiteralPath (Join-Path $tempSidecar "dist") -Recurse -Filter "*.test.js" |
    Remove-Item -Force

  $resourceParent = Split-Path -Parent $sidecarResources
  New-Item -ItemType Directory -Path $resourceParent -Force | Out-Null
  Remove-DirectoryIfExists $sidecarResources
  Copy-Item -LiteralPath $tempSidecar -Destination $sidecarResources -Recurse -Force

  Write-Host "Prepared bundled sidecar runtime at $sidecarResources"
} finally {
  Remove-DirectoryIfExists $tempRoot
}
