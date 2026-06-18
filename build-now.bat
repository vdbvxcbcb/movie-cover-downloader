@echo off
echo Setting up MSVC environment and building...
call "C:\Program Files (x86)\Microsoft Visual Studio\18\BuildTools\VC\Auxiliary\Build\vcvars64.bat" > nul 2>&1
if errorlevel 1 (
    echo ERROR: Failed to set up MSVC environment
    exit /b 1
)

echo MSVC environment ready
echo Building desktop application...
cd /d "d:\claude blog\new\movie-cover-downloader"
pnpm run build:desktop

echo Done!
