@echo off
echo ========================================
echo Movie Cover Downloader - Quick Build
echo (Skipping sidecar rebuild)
echo ========================================
echo.

REM Setup MSVC environment
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" > nul 2>&1
if errorlevel 1 (
    echo [ERROR] Failed to set up MSVC environment
    exit /b 1
)
echo [OK] MSVC environment ready

cd /d "d:\claude blog\new\movie-cover-downloader\apps\desktop"

REM Check sidecar exists
if not exist "src-tauri\resources\sidecar\node.exe" (
    echo [ERROR] Sidecar bundle not found!
    exit /b 1
)
echo [OK] Sidecar bundle exists

echo.
echo Building frontend...
call pnpm build
if errorlevel 1 (
    echo [ERROR] Frontend build failed
    exit /b 1
)

echo.
echo Building Tauri app (Rust compilation - this takes 5-10 minutes)...
cd src-tauri
cargo build --release --no-default-features
if errorlevel 1 (
    echo [ERROR] Cargo build failed
    exit /b 1
)

echo.
echo Creating MSI installer...
cd ..
call pnpm tauri build --bundles msi --no-bundle
if errorlevel 1 (
    echo [ERROR] Bundle creation failed
    exit /b 1
)

echo.
echo ========================================
echo BUILD SUCCESSFUL!
echo ========================================
echo.
echo Executable: src-tauri\target\release\movie-cover-downloader-desktop.exe
echo Installer: src-tauri\target\release\bundle\msi\
echo.
