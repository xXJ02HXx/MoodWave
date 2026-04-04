@echo off
cd /d "%~dp0"
start "MoodWave Server" cmd /k ""C:\Program Files\nodejs\node.exe" server.js"
timeout /t 1 >nul
start "" "http://localhost:3000/login.html"
