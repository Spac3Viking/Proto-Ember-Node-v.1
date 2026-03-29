@echo off
cd /d %~dp0

echo.
echo  ᚠ  Awakening Ember Node...
echo.

:: ── Check for Node.js ────────────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js not found.
    echo  Please install Node.js to awaken this node.
    echo  Visit https://nodejs.org to download the installer.
    echo.
    pause
    exit /b 1
)

:: ── Check for dependencies ────────────────────────────────────────────────────
if not exist "node_modules\" (
    echo  Dependencies not found. Installing now...
    echo  This may take a moment on first run.
    echo.
    npm install
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
start "Ember Node" cmd /k "npm run dev"

:: ── Brief pause to let the server initialise ─────────────────────────────────
timeout /t 3 >nul

:: ── Open the interface in the default browser ────────────────────────────────
echo  Opening interface at http://localhost:3477
start http://localhost:3477

echo.
echo  The Node is awake. You may close this window.
timeout /t 4 >nul
