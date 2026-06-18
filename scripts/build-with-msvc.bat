@echo off
REM Movie Cover Downloader - Build Script with MSVC Environment
REM This script automatically sets up the MSVC environment and builds the project

echo ========================================
echo Movie Cover Downloader Build Script
echo ========================================
echo.

REM Set up MSVC environment (Visual Studio 2026)
echo [1/5] Setting up MSVC environment...
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat"

if errorlevel 1 (
    echo [ERROR] Failed to set up MSVC environment
    pause
    exit /b 1
)

echo.
echo [2/5] Building sidecar...
call pnpm run build:sidecar

if errorlevel 1 (
    echo [ERROR] Sidecar build failed
    pause
    exit /b 1
)

echo.
echo [3/5] Preparing sidecar bundle...
call pnpm run prepare:sidecar-bundle

if errorlevel 1 (
    echo [ERROR] Sidecar bundle preparation failed
    pause
    exit /b 1
)

echo.
echo [4/5] Building desktop application...
call pnpm run build:desktop

if errorlevel 1 (
    echo [ERROR] Desktop build failed
    pause
    exit /b 1
)

echo.
echo [5/5] Build completed successfully!
echo.
echo ========================================
echo Build artifacts location:
echo   apps\desktop\src-tauri\target\release\bundle\
echo ========================================
echo.

pause
