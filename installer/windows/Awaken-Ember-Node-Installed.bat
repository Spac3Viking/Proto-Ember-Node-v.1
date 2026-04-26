@echo off
setlocal EnableExtensions
cd /d "%~dp0"

echo.
echo  ᚠ  Awakening Ember Node...
echo.

set "DATA_ROOT="
if defined EMBER_NODE_DATA_ROOT (
    set "DATA_ROOT=%EMBER_NODE_DATA_ROOT%"
) else (
    if defined EMBER_DATA_ROOT (
        set "DATA_ROOT=%EMBER_DATA_ROOT%"
    ) else (
        set "DATA_ROOT=%USERPROFILE%\Documents\Ember-Node-Data"
    )
)

set "SETUP_FLAG=%DATA_ROOT%\system\.ember-first-run-complete"

if not exist "%DATA_ROOT%" (
    mkdir "%DATA_ROOT%" >nul 2>&1
)
if not exist "%DATA_ROOT%\system" (
    mkdir "%DATA_ROOT%\system" >nul 2>&1
)

set "IS_FIRST_RUN=0"
if not exist "%SETUP_FLAG%" (
    set "IS_FIRST_RUN=1"
)

:: ── Check for Node.js / npm ───────────────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: Node.js not found.
    echo  Please install Node.js 18+ to run Ember Node.
    echo  Visit https://nodejs.org to download the installer.
    echo.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  ERROR: npm not found.
    echo  Please reinstall Node.js so npm is available on PATH.
    echo.
    pause
    exit /b 1
)

:: ── Ensure runtime dependencies exist ─────────────────────────────────────────
if not exist "node_modules\" (
    echo  Dependencies not found. Installing runtime dependencies...
    echo.
    npm install --omit=dev
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

:: ── First-run setup guidance ──────────────────────────────────────────────────
if "%IS_FIRST_RUN%"=="1" (
    echo  First run detected.
    echo  Data root initialised at:
    echo    %DATA_ROOT%
    echo.
    echo  Ember Node keeps user data outside the install folder so updates do not overwrite it.
    echo.
)

:: ── Optional: start Ollama if installed but not already responding ───────────
set "OLLAMA_FOUND=0"
where ollama >nul 2>&1
if %errorlevel% equ 0 (
    set "OLLAMA_FOUND=1"
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
)

if "%IS_FIRST_RUN%"=="1" if "%OLLAMA_FOUND%"=="0" (
    echo.
    set /p OPEN_OLLAMA=Open Ollama download page now? [Y/N]:
    if /I "%OPEN_OLLAMA%"=="Y" (
        start https://ollama.com/download/windows
    )
)

:: ── Start Ember Node backend ──────────────────────────────────────────────────
echo.
echo  Starting Ember Node backend...
start "Ember Node" cmd /k "set \"EMBER_NODE_DATA_ROOT=%DATA_ROOT%\" && npm run dev"

:: ── Brief pause to let the server initialise ──────────────────────────────────
timeout /t 3 >nul

:: ── Open the interface in the default browser ────────────────────────────────
echo  Opening interface at http://localhost:3477
start http://localhost:3477

if "%IS_FIRST_RUN%"=="1" (
    > "%SETUP_FLAG%" echo first-run-complete
)

echo.
echo  The Node is awake. You may close this window.
timeout /t 4 >nul

