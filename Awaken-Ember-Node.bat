@echo off
cd /d %~dp0

echo.
echo  ᚠ  Awakening Ember Node...
echo.

:: ── Optional: start Ollama if installed but not already running ──────────────
where ollama >nul 2>&1
if %errorlevel% equ 0 (
    tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /I "ollama.exe" >nul 2>&1
    if errorlevel 1 (
        echo  Starting Ollama in background...
        start "" /B ollama serve >nul 2>&1
        timeout /t 2 >nul
    ) else (
        echo  Ollama already running.
    )
) else (
    echo  Ollama not found — continuing without it.
    echo  Visit ollama.com to install a local AI model host.
)

:: ── Start Ember Node backend ─────────────────────────────────────────────────
echo.
echo  Starting Ember Node backend...
start "Ember Node" cmd /k "npm run dev"

:: ── Brief pause to let the server initialise ─────────────────────────────────
timeout /t 3 >nul

:: ── Open the interface in the default browser ────────────────────────────────
echo  Opening interface at http://localhost:3477
start http://localhost:3477

echo.
echo  The Node is awake. You may close this window.
timeout /t 4 >nul
