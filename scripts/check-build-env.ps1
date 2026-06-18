# Build Environment Check Script
# Validates Windows development environment for Tauri builds

$ErrorActionPreference = "Continue"

Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "Movie Cover Downloader Build Environment Check" -ForegroundColor Cyan
Write-Host "========================================`n" -ForegroundColor Cyan

$allPassed = $true

function Test-Command($cmdName) {
    try {
        $null = Get-Command $cmdName -ErrorAction Stop
        return $true
    }
    catch {
        return $false
    }
}

function Write-CheckResult($name, $passed, $details = "", $solution = "") {
    if ($passed) {
        Write-Host "[OK] " -ForegroundColor Green -NoNewline
        Write-Host "$name" -ForegroundColor White
        if ($details) {
            Write-Host "    $details" -ForegroundColor Gray
        }
    }
    else {
        Write-Host "[X] " -ForegroundColor Red -NoNewline
        Write-Host "$name" -ForegroundColor White
        if ($details) {
            Write-Host "    $details" -ForegroundColor Yellow
        }
        if ($solution) {
            Write-Host "    Solution: $solution" -ForegroundColor Cyan
        }
        $script:allPassed = $false
    }
}

Write-Host "`n[1] Node.js Environment" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor DarkGray

if (Test-Command "node") {
    $nodeVersion = node --version
    $versionNum = [int]($nodeVersion -replace 'v(\d+)\..*', '$1')
    $passed = $versionNum -ge 20
    Write-CheckResult "Node.js" $passed "Version: $nodeVersion" "Require Node.js >= 20.x"
}
else {
    Write-CheckResult "Node.js" $false "Not installed" "Visit https://nodejs.org/"
}

if (Test-Command "pnpm") {
    $pnpmVersion = pnpm --version
    Write-CheckResult "pnpm" $true "Version: $pnpmVersion"
}
else {
    Write-CheckResult "pnpm" $false "Not installed" "Run: npm install -g pnpm"
}

Write-Host "`n[2] Rust Toolchain" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor DarkGray

if (Test-Command "rustc") {
    $rustcVersion = rustc --version
    Write-CheckResult "rustc" $true $rustcVersion
}
else {
    Write-CheckResult "rustc" $false "Not installed" "Visit https://rustup.rs/"
}

if (Test-Command "cargo") {
    $cargoVersion = cargo --version
    Write-CheckResult "cargo" $true $cargoVersion
}
else {
    Write-CheckResult "cargo" $false "Not installed" "Rust includes Cargo automatically"
}

Write-Host "`n[3] C++ Compiler" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor DarkGray

if (Test-Command "cl") {
    $clPath = (Get-Command cl).Source
    Write-CheckResult "MSVC (cl.exe)" $true "Path: $clPath"
}
else {
    Write-CheckResult "MSVC (cl.exe)" $false "Not found" "Install Visual Studio Build Tools"
}

Write-Host "`n[4] WebView2 Runtime" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor DarkGray

try {
    $webview2 = Get-ItemProperty -Path "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}" -Name pv -ErrorAction Stop
    Write-CheckResult "WebView2" $true "Version: $($webview2.pv)"
}
catch {
    Write-CheckResult "WebView2" $false "Not installed" "Download from Microsoft"
}

Write-Host "`n[5] Project Dependencies" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor DarkGray

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..")

$nodeModulesPath = Join-Path $repoRoot "node_modules"
$hasNodeModules = Test-Path $nodeModulesPath
Write-CheckResult "Root dependencies" $hasNodeModules "node_modules installed" "Run: pnpm install"

$sidecarDistPath = Join-Path $repoRoot "apps\sidecar\dist"
$hasSidecarDist = Test-Path $sidecarDistPath
Write-CheckResult "Sidecar build" $hasSidecarDist "dist directory exists" "Run: pnpm run build:sidecar"

$sidecarBundlePath = Join-Path $repoRoot "apps\desktop\src-tauri\resources\sidecar"
$hasSidecarBundle = Test-Path $sidecarBundlePath
$hasNodeExe = Test-Path (Join-Path $sidecarBundlePath "node.exe")
$bundleReady = $hasSidecarBundle -and $hasNodeExe

Write-CheckResult "Sidecar bundle" $bundleReady "resources/sidecar ready" "Run: pnpm run prepare:sidecar-bundle"

$frontendDistPath = Join-Path $repoRoot "apps\desktop\dist"
$hasFrontendDist = Test-Path $frontendDistPath
Write-CheckResult "Frontend build" $hasFrontendDist "dist directory exists" "Run: pnpm run build:web"

Write-Host "`n[6] System Resources" -ForegroundColor Yellow
Write-Host "-------------------------------------" -ForegroundColor DarkGray

$drive = (Get-Item $repoRoot).PSDrive.Name
$driveInfo = Get-PSDrive $drive
$freeSpaceGB = [math]::Round($driveInfo.Free / 1GB, 2)
$hasSpace = $freeSpaceGB -ge 5

Write-CheckResult "Disk space" $hasSpace "$freeSpaceGB GB available" "Need at least 5 GB for first build"

Write-Host "`n========================================" -ForegroundColor Cyan
if ($allPassed) {
    Write-Host "All checks passed!" -ForegroundColor Green
    Write-Host "`nYou can start building:" -ForegroundColor White
    Write-Host "  pnpm run build:desktop" -ForegroundColor Cyan
}
else {
    Write-Host "Some checks failed" -ForegroundColor Red
    Write-Host "`nPlease resolve the issues above." -ForegroundColor Yellow
    Write-Host "See: docs\WINDOWS_SETUP.md" -ForegroundColor Cyan
}
Write-Host "========================================`n" -ForegroundColor Cyan

exit $(if ($allPassed) { 0 } else { 1 })
