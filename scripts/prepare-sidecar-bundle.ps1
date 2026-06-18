$ErrorActionPreference = "Stop"

# Get absolute paths
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$sidecarSource = Join-Path $repoRoot "apps\sidecar"
$sidecarResources = Join-Path $repoRoot "apps\desktop\src-tauri\resources\sidecar"

Write-Host "Preparing sidecar bundle..." -ForegroundColor Cyan
Write-Host "Source: $sidecarSource"
Write-Host "Target: $sidecarResources"

function Remove-DirectoryIfExists($path) {
  if (Test-Path -LiteralPath $path) {
    Write-Host "  Cleaning: $path" -ForegroundColor Gray
    Remove-Item -LiteralPath $path -Recurse -Force
  }
}

try {
  # Ensure target directory exists
  $resourceParent = Split-Path -Parent $sidecarResources
  New-Item -ItemType Directory -Path $resourceParent -Force | Out-Null

  # Try to clean, but continue if files are locked
  try {
    Remove-DirectoryIfExists $sidecarResources
  } catch {
    Write-Host "  Warning: Could not fully clean old sidecar (files in use), will overwrite" -ForegroundColor Yellow
  }

  New-Item -ItemType Directory -Path $sidecarResources -Force | Out-Null

  # Copy package.json
  Write-Host "`n[1/5] Copying package.json..." -ForegroundColor Yellow
  Copy-Item -Path (Join-Path $sidecarSource "package.json") -Destination $sidecarResources -Force

  # Create .npmrc to use hoisted node_modules (no symlinks)
  Write-Host "[1.5/5] Creating .npmrc for hoisted installation..." -ForegroundColor Yellow
  $npmrcContent = @"
enable-pre-post-scripts=true
node-linker=hoisted
shamefully-hoist=true
"@
  Set-Content -Path (Join-Path $sidecarResources ".npmrc") -Value $npmrcContent -Force

  # Copy built dist directory
  Write-Host "[2/5] Copying dist..." -ForegroundColor Yellow
  $distSource = Join-Path $sidecarSource "dist"
  $distTarget = Join-Path $sidecarResources "dist"
  if (-not (Test-Path $distSource)) {
    throw "Sidecar dist not found. Run 'pnpm run build:sidecar' first."
  }
  Copy-Item -Path $distSource -Destination $distTarget -Recurse -Force

  # Remove test files
  Get-ChildItem -Path $distTarget -Recurse -Filter "*.test.js" | Remove-Item -Force

  # Install production dependencies with hoisted structure (no symlinks)
  Write-Host "[3/5] Installing production dependencies with flat structure..." -ForegroundColor Yellow
  Push-Location $sidecarResources

  # Install with hoisted linker to avoid symlinks pointing to dev machine paths
  Write-Host "  Installing dependencies (this will create real files, not symlinks)..." -ForegroundColor Gray
  pnpm install --prod --no-lockfile --ignore-workspace
  $installExitCode = $LASTEXITCODE

  if ($installExitCode -ne 0) {
    Pop-Location
    throw "pnpm install failed"
  }

  Pop-Location

  # Copy node.exe
  Write-Host "[4/5] Copying Node.js runtime..." -ForegroundColor Yellow
  $nodeCommand = Get-Command node -ErrorAction Stop
  Copy-Item -LiteralPath $nodeCommand.Source -Destination (Join-Path $sidecarResources "node.exe") -Force

  # Verify sharp is installed with hoisted structure (no symlinks)
  Write-Host "[5/5] Verifying sharp installation..." -ForegroundColor Yellow
  $sharpPath = Join-Path $sidecarResources "node_modules\sharp"
  if (-not (Test-Path $sharpPath)) {
    throw "Sharp not installed correctly"
  }

  # Check if sharp is a real directory (not a symlink)
  $sharpItem = Get-Item -LiteralPath $sharpPath
  if ($sharpItem.LinkType) {
    Write-Host "  WARNING: Sharp is a symlink - this will break in production!" -ForegroundColor Red
    Write-Host "  Target: $($sharpItem.Target)" -ForegroundColor Red
    throw "Sharp installation used symlinks instead of hoisted structure"
  } else {
    Write-Host "  Sharp is a real directory (not a symlink)" -ForegroundColor Green
  }

  # Look for sharp native binary in the hoisted structure
  $sharpBinaries = Get-ChildItem -Path (Join-Path $sidecarResources "node_modules") -Recurse -Filter "*.node" -ErrorAction SilentlyContinue | Where-Object { $_.FullName -match "sharp" }

  if ($sharpBinaries) {
    Write-Host "  Sharp native binary found:" -ForegroundColor Green
    $sharpBinaries | ForEach-Object {
      $sizeKB = [math]::Round($_.Length/1KB)
      Write-Host "    $($_.FullName) - Size: $sizeKB KB" -ForegroundColor Gray
    }
  } else {
    Write-Host "  WARNING: Sharp native binary not found" -ForegroundColor Yellow
    throw "Sharp native binary (.node file) not found after installation"
  }

  Write-Host "`n========================================" -ForegroundColor Green
  Write-Host "Sidecar bundle prepared successfully!" -ForegroundColor Green
  Write-Host "========================================" -ForegroundColor Green
  Write-Host "Location: $sidecarResources" -ForegroundColor White
  Write-Host ""

} catch {
  Write-Host "`nERROR: Failed to prepare sidecar bundle" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  throw
}
