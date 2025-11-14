@echo off
REM Feuermelder - Start All Services

echo ==========================================
echo   Feuermelder - Fire Detection System
echo ==========================================
echo.

REM Kill any existing Mosquitto processes
taskkill /F /IM mosquitto.exe >nul 2>&1
timeout /t 1 /nobreak >nul

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed!
    echo Please install Node.js from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check if Mosquitto is installed
where mosquitto >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Mosquitto is not installed!
    echo Please install Mosquitto from: https://mosquitto.org/download/
    echo.
    pause
    exit /b 1
)

REM Start Mosquitto in separate window
echo Starting Mosquitto MQTT Broker...
start "Mosquitto MQTT Broker" mosquitto -c mqtt\config\mosquitto.conf

REM Wait for Mosquitto to start
timeout /t 3 /nobreak >nul

REM Install web dependencies if needed
if not exist "web\node_modules" (
    echo Installing web dependencies...
    cd web
    call npm install
    cd ..
    echo.
)

echo.
echo ==========================================
echo   Services Started!
echo ==========================================
echo   - MQTT Broker: localhost:1883
echo   - Web Server: http://localhost:3000
echo.
echo   ESP32 IP: 192.168.178.49
echo   Connect ESP32 to: 192.168.178.49:1883
echo.
echo   Press Ctrl+C to stop the web server
echo ==========================================
echo.

REM Start the web server
cd web
node src\server.js

REM Cleanup on exit
echo.
echo Stopping services...
taskkill /F /IM mosquitto.exe >nul 2>&1