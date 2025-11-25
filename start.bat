@echo off
REM Windows wrapper for start.sh - runs the bash script using Git Bash or WSL

REM Try Git Bash first
where bash.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Running start.sh using Git Bash...
    bash.exe start.sh
    exit /b %ERRORLEVEL%
)

REM Try WSL as fallback
where wsl.exe >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo Running start.sh using WSL...
    wsl bash start.sh
    exit /b %ERRORLEVEL%
)

REM Neither found - show error
echo ERROR: No bash environment found!
echo.
echo Please install one of the following:
echo   1. Git for Windows (includes Git Bash): https://git-scm.com/download/win
echo   2. WSL (Windows Subsystem for Linux): https://aka.ms/wsl
echo.
pause
exit /b 1