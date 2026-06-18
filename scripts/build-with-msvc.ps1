# Movie Cover Downloader - PowerShell Build Script with MSVC Environment
# This script automatically sets up the MSVC environment and builds the project

$ErrorActionPreference = "Stop"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Movie Cover Downloader Build Script" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$repoRoot = Split-Path -Parent $PSScriptRoot

try {
    # [1/5] Set up MSVC environment
    Write-Host "[1/5] Setting up MSVC environment..." -ForegroundColor Yellow

    $vcvarsPath = "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

    if (-not (Test-Path $vcvarsPath)) {
        throw "vcvars64.bat not found at: $vcvarsPath"
    }

    # Create a temporary batch file that calls vcvars and then runs the build commands
    $tempBatch = Join-Path $env:TEMP "build-movie-cover-downloader.bat"

    $batchContent = @"
@echo off
call "$vcvarsPath"
if errorlevel 1 exit /b 1

cd /d "$repoRoot"

echo.
echo [2/5] Building sidecar...
call pnpm run build:sidecar
if errorlevel 1 exit /b 1

echo.
echo [3/5] Preparing sidecar bundle...
call pnpm run prepare:sidecar-bundle
if errorlevel 1 exit /b 1

echo.
echo [4/5] Building desktop application...
call pnpm run build:desktop
if errorlevel 1 exit /b 1

echo.
echo [5/5] Build completed successfully!
"@

    Set-Content -Path $tempBatch -Value $batchContent -Encoding ASCII

    # Execute the batch file
    & cmd.exe /c $tempBatch

    if ($LASTEXITCODE -ne 0) {
        throw "Build process failed with exit code: $LASTEXITCODE"
    }

    # Clean up
    Remove-Item $tempBatch -ErrorAction SilentlyContinue

    Write-Host "`n========================================" -ForegroundColor Cyan
    Write-Host "Build completed successfully!" -ForegroundColor Green
    Write-Host "`nBuild artifacts location:" -ForegroundColor White
    Write-Host "  apps\desktop\src-tauri\target\release\bundle\" -ForegroundColor Cyan
    Write-Host "========================================`n" -ForegroundColor Cyan

    exit 0
}
catch {
    Write-Host "`n[ERROR] Build failed: $_" -ForegroundColor Red
    exit 1
}
