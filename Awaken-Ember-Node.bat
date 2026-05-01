@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "PROJECT_DIR=%~dp0"
if not exist "%PROJECT_DIR%package.json" (
    set "PROJECT_DIR=%CD%\"
)
if not exist "%PROJECT_DIR%package.json" (
    echo.
    echo  ERROR: Could not locate Ember Node project directory.
    echo  Expected package.json in launcher directory.
    echo.
    pause
    exit /b 1
)
cd /d "%PROJECT_DIR%"

set "PORT=3477"
set "LOG_DIR=%PROJECT_DIR%logs"
set "LOG_FILE=%LOG_DIR%\launcher.log"
if not exist "%LOG_DIR%" mkdir "%LOG_DIR%" >nul 2>&1

set "BUNDLED_NODE=%PROJECT_DIR%runtime\node\node.exe"
set "BUNDLED_NPM=%PROJECT_DIR%runtime\node\npm.cmd"
set "NODE_EXE="
set "NPM_CMD="
set "NODE_SOURCE=missing"
set "NPM_SOURCE=missing"
set "LAUNCH_CMD="
set "START_SCRIPT=none"

call :log "------------------------------------------------------------"
call :log "timestamp=%DATE% %TIME%"
call :log "working_directory=%CD%"
call :log "port=%PORT%"

if exist "%BUNDLED_NODE%" (
    set "NODE_EXE=%BUNDLED_NODE%"
    set "NODE_SOURCE=bundled"
) else (
    where node >nul 2>&1
    if %errorlevel% equ 0 (
        for /f "delims=" %%I in ('where node') do (
            if not defined NODE_EXE set "NODE_EXE=%%I"
        )
        set "NODE_SOURCE=system"
    )
)

if exist "%BUNDLED_NPM%" (
    set "NPM_CMD=%BUNDLED_NPM%"
    set "NPM_SOURCE=bundled"
) else (
    where npm >nul 2>&1
    if %errorlevel% equ 0 (
        for /f "delims=" %%I in ('where npm') do (
            if not defined NPM_CMD set "NPM_CMD=%%I"
        )
        set "NPM_SOURCE=system"
    )
)

call :log "node_source=%NODE_SOURCE%"
call :log "node_path=%NODE_EXE%"
call :log "npm_source=%NPM_SOURCE%"
call :log "npm_path=%NPM_CMD%"

if "%NODE_SOURCE%"=="missing" (
    echo.
    echo  ERROR: Node.js runtime not found.
    echo  Install Node.js or place bundled runtime at runtime\node\node.exe.
    echo.
    call :log "startup=failure reason=node_not_found"
    pause
    exit /b 1
)

if not exist "node_modules\" (
    if "%NPM_SOURCE%"=="missing" (
        echo.
        echo  ERROR: npm was not found, so dependencies cannot be installed.
        echo.
        call :log "startup=failure reason=npm_not_found_for_install"
        pause
        exit /b 1
    )
    echo.
    echo  Dependencies missing. Installing now...
    call :log "dependency_install=started"
    if /I "%NPM_SOURCE%"=="bundled" (
        call "%NPM_CMD%" install
    ) else (
        npm install
    )
    if %errorlevel% neq 0 (
        echo.
        echo  ERROR: npm install failed.
        call :log "startup=failure reason=npm_install_failed"
        pause
        exit /b 1
    )
    call :log "dependency_install=success"
)

if exist "package.json" (
    for /f "usebackq delims=" %%I in (`"%NODE_EXE%" -e "const p=require('./package.json'); if(p&&p.scripts&&p.scripts.start){process.stdout.write('start')} else if(p&&p.scripts&&p.scripts.dev){process.stdout.write('dev')}"`) do (
        if not "%%I"=="" set "START_SCRIPT=%%I"
    )
)

if /I "%START_SCRIPT%"=="start" (
    if not "%NPM_SOURCE%"=="missing" (
        if /I "%NPM_SOURCE%"=="bundled" (
            set "LAUNCH_CMD=cd /d ""%PROJECT_DIR%"" ^&^& call ""%NPM_CMD%"" start"
        ) else (
            set "LAUNCH_CMD=cd /d ""%PROJECT_DIR%"" ^&^& npm start"
        )
    ) else (
        set "LAUNCH_CMD=cd /d ""%PROJECT_DIR%"" ^&^& ""%NODE_EXE%"" app\server.js"
    )
) else if /I "%START_SCRIPT%"=="dev" (
    if not "%NPM_SOURCE%"=="missing" (
        if /I "%NPM_SOURCE%"=="bundled" (
            set "LAUNCH_CMD=cd /d ""%PROJECT_DIR%"" ^&^& call ""%NPM_CMD%"" run dev"
        ) else (
            set "LAUNCH_CMD=cd /d ""%PROJECT_DIR%"" ^&^& npm run dev"
        )
    ) else (
        set "LAUNCH_CMD=cd /d ""%PROJECT_DIR%"" ^&^& ""%NODE_EXE%"" app\server.js"
    )
) else (
    set "LAUNCH_CMD=cd /d ""%PROJECT_DIR%"" ^&^& ""%NODE_EXE%"" app\server.js"
)

set "SERVER_READY=0"
where curl >nul 2>&1
if %errorlevel% equ 0 (
    curl -s --max-time 2 http://localhost:%PORT%/api/status >nul 2>&1
    if %errorlevel% equ 0 set "SERVER_READY=1"
)
if "%SERVER_READY%"=="0" (
    netstat -ano | findstr /R /C:":%PORT% " >nul 2>&1
    if %errorlevel% equ 0 set "SERVER_READY=1"
)

echo.
if "%SERVER_READY%"=="1" (
    echo  Ember Node already running on port %PORT%.
    call :log "command_used=already_running"
) else (
    echo  ᚠ  Awakening Ember Node...
    echo  Starting backend...
    call :log "command_used=%LAUNCH_CMD%"
    start "Ember Node" cmd /k "%LAUNCH_CMD%"
    timeout /t 3 >nul
)

set "STARTUP_OK=0"
where curl >nul 2>&1
if %errorlevel% equ 0 (
    curl -s --max-time 4 http://localhost:%PORT%/api/status >nul 2>&1
    if %errorlevel% equ 0 set "STARTUP_OK=1"
)
if "%STARTUP_OK%"=="0" (
    netstat -ano | findstr /R /C:":%PORT% " >nul 2>&1
    if %errorlevel% equ 0 set "STARTUP_OK=1"
)

if "%STARTUP_OK%"=="1" (
    call :log "startup=success"
    echo  Opening interface at http://localhost:%PORT%
    start http://localhost:%PORT%
    echo.
    echo  The Node is awake. You may close this window.
    timeout /t 4 >nul
    exit /b 0
)

call :log "startup=failure reason=server_not_reachable"
echo.
echo  ERROR: Ember Node did not confirm startup on port %PORT%.
echo  Check logs and server terminal:
echo    %LOG_FILE%
echo.
pause
exit /b 1

:log
>>"%LOG_FILE%" echo [%DATE% %TIME%] %~1
exit /b 0
