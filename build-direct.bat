@echo off
echo Setting up MSVC environment and building...
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" > nul 2>&1
if errorlevel 1 (
    echo ERROR: Failed to set up MSVC environment
    exit /b 1
)

echo MSVC environment ready
cd /d "d:\claude blog\new\movie-cover-downloader"

echo Checking sidecar bundle...
if not exist "apps\desktop\src-tauri\resources\sidecar\node.exe" (
    echo ERROR: Sidecar bundle not found!
    echo Please run: pnpm run prepare:sidecar-bundle
    exit /b 1
)
echo Sidecar bundle OK

echo.
echo Building Tauri application (this may take 5-10 minutes)...
cd apps\desktop
pnpm tauri build --bundles msi

if errorlevel 1 (
    echo.
    echo BUILD FAILED!
    exit /b 1
) else (
    echo.
    echo ========================================
    echo BUILD SUCCESSFUL!
    echo ========================================
    echo.
    echo Installation package location:
    echo   src-tauri\target\release\bundle\msi\
    echo.
)
