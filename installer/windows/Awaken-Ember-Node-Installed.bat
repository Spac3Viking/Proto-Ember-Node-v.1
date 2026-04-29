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
set "BUNDLED_NODE=%~dp0runtime\node\node.exe"
set "BUNDLED_NPM=%~dp0runtime\node\npm.cmd"
set "NODE_SOURCE="

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

:: ── Ensure runtime dependencies exist ─────────────────────────────────────────
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

    echo  Dependencies not found. Installing runtime dependencies...
    echo.
    if /I "%NPM_SOURCE%"=="bundled" (
        call "%BUNDLED_NPM%" install --omit=dev
    ) else (
        npm install --omit=dev
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
    where curl >nul 2>&1
    if %errorlevel% equ 0 (
        curl -s --max-time 2 http://localhost:11434/ >nul 2>&1
        if %errorlevel% equ 0 (
            echo  Ollama already running.
        ) else (
            echo  Starting Ollama in background...
            start "" /B ollama serve >nul 2>&1
            timeout /t 3 >nul
        )
    ) else (
        echo  curl not found; attempting to start Ollama in background...
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

:: ── Start Ember Node backend (if not already running) ─────────────────────────
set "SERVER_READY=0"
where curl >nul 2>&1
if %errorlevel% equ 0 (
    curl -s --max-time 2 http://localhost:3477/api/status >nul 2>&1
    if %errorlevel% equ 0 (
        set "SERVER_READY=1"
    )
)
if "%SERVER_READY%"=="0" (
    netstat -ano | findstr /R /C:":3477 " >nul 2>&1
    if %errorlevel% equ 0 (
        set "SERVER_READY=1"
    )
)

echo.
if "%SERVER_READY%"=="1" (
    echo  Ember Node backend already running.
) else (
    echo  Starting Ember Node backend...
    if /I "%NODE_SOURCE%"=="bundled" (
        start "Ember Node" cmd /c "set \"EMBER_NODE_DATA_ROOT=%DATA_ROOT%\" && \"%BUNDLED_NODE%\" app/server.js"
    ) else (
        start "Ember Node" cmd /c "set \"EMBER_NODE_DATA_ROOT=%DATA_ROOT%\" && node app/server.js"
    )
    timeout /t 3 >nul
)

:: ── Open the interface in the default browser ────────────────────────────────
echo  Opening interface at http://localhost:3477
start http://localhost:3477

if "%IS_FIRST_RUN%"=="1" (
    echo first-run-complete>"%SETUP_FLAG%"
)

echo.
echo  The Node is awake. You may close this window.
timeout /t 4 >nul
