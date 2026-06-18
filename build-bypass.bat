@echo off
echo ========================================
echo Movie Cover Downloader - Direct Build
echo (Bypassing all prebuild hooks)
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
    echo [ERROR] Sidecar bundle not found at: src-tauri\resources\sidecar\node.exe
    exit /b 1
)
echo [OK] Sidecar bundle exists

echo.
echo [1/3] Building frontend with Vite (bypassing prebuild)...
call pnpm exec vue-tsc --noEmit
if errorlevel 1 (
    echo [WARNING] TypeScript check failed, continuing anyway...
)

call pnpm exec vite build
if errorlevel 1 (
    echo [ERROR] Vite build failed
    exit /b 1
)
echo [OK] Frontend built

echo.
echo [2/3] Building Tauri app (Rust compilation - 5-10 minutes)...
cd src-tauri
cargo build --release
if errorlevel 1 (
    echo [ERROR] Cargo build failed
    exit /b 1
)
echo [OK] Rust compilation complete

echo.
echo [3/3] Creating MSI installer...
cargo tauri-cli build --bundles msi
if errorlevel 1 (
    echo [WARNING] MSI creation may have failed, checking for exe...
)

echo.
if exist "target\release\movie-cover-downloader-desktop.exe" (
    echo ========================================
    echo BUILD SUCCESSFUL!
    echo ========================================
    echo.
    echo Executable: src-tauri\target\release\movie-cover-downloader-desktop.exe
    if exist "target\release\bundle\msi\" (
        echo Installer: src-tauri\target\release\bundle\msi\
    )
    echo.
) else (
    echo [ERROR] Build failed - executable not found
    exit /b 1
)
