@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  ᚠ  Awakening Ember Node...
echo.

set "BUNDLED_NODE=%~dp0runtime\node\node.exe"
set "BUNDLED_NPM=%~dp0runtime\node\npm.cmd"
set "NODE_SOURCE="

:: ── Resolve Node runtime (bundled first, then system) ───────────────────────
if exist "%BUNDLED_NODE%" (
    set "NODE_SOURCE=bundled"
) else (
    where node >nul 2>&1
    if %errorlevel% equ 0 (
        set "NODE_SOURCE=system"
    )
)

if not defined NODE_SOURCE (
    echo  Node.js runtime not found.
    echo  Ember Node can run with either:
    echo  1. Bundled portable Node in runtime/node/
    echo  2. System-installed Node.js
    echo  Install Node.js from:
    echo  https://nodejs.org
    echo  Then relaunch Awaken Ember Node.
    echo.
    pause
    exit /b 1
)

:: ── Check for dependencies ────────────────────────────────────────────────────
if not exist "node_modules\" (
    set "NPM_SOURCE="
    if exist "%BUNDLED_NPM%" (
        set "NPM_SOURCE=bundled"
    ) else (
        where npm >nul 2>&1
        if %errorlevel% equ 0 (
            set "NPM_SOURCE=system"
        )
    )

    if not defined NPM_SOURCE (
        echo  Dependencies are missing.
        echo  Run npm install from the app folder, or include npm with the bundled runtime.
        echo.
        pause
        exit /b 1
    )

    echo  Dependencies not found. Installing now...
    echo  This may take a moment on first run.
    echo.
    if /I "%NPM_SOURCE%"=="bundled" (
        call "%BUNDLED_NPM%" install
    ) else (
        npm install
    )
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: npm install failed.
        echo  Check your Node.js installation and try again.
        pause
        exit /b 1
    )
    echo.
    echo  Dependencies installed successfully.
    echo.
)

:: ── Optional: start Ollama if installed but not already responding ────────────
where ollama >nul 2>&1
if %errorlevel% equ 0 (
    :: Check if Ollama is already responding via HTTP (curl is available on Win10+)
    curl -s --max-time 2 http://localhost:11434/ >nul 2>&1
    if %errorlevel% equ 0 (
        echo  Ollama already running.
    ) else (
        echo  Starting Ollama in background...
        start "" /B ollama serve >nul 2>&1
        timeout /t 3 >nul
    )
) else (
    echo  Ollama not found - continuing without it.
    echo  Visit ollama.com to install a local AI model host.
)

:: ── Start Ember Node backend ─────────────────────────────────────────────────
echo.
echo  Starting Ember Node backend...
if /I "%NODE_SOURCE%"=="bundled" (
    start "Ember Node" cmd /k "\"%BUNDLED_NODE%\" app\server.js"
) else (
    start "Ember Node" cmd /k "npm run dev"
)

:: ── Brief pause to let the server initialise ─────────────────────────────────
timeout /t 3 >nul

:: ── Open the interface in the default browser ────────────────────────────────
echo  Opening interface at http://localhost:3477
start http://localhost:3477

echo.
echo  The Node is awake. You may close this window.
timeout /t 4 >nul
