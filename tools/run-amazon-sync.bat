@echo off
setlocal

set PROJECT_DIR=C:\Users\ethan.atchley\creator-metrics
set LOG_DIR=%PROJECT_DIR%\logs
set PYTHON=C:\Program Files\PyManager\python3.exe

:: Build dated log file (YYYY-MM-DD)
for /f "skip=1 tokens=1-3" %%a in ('wmic os get LocalDateTime /value ^| find "="') do set DT=%%a
set YMD=%DT:~0,4%-%DT:~4,2%-%DT:~6,2%
set LOG_FILE=%LOG_DIR%\amazon-sync-%YMD%.log

if not exist "%LOG_DIR%" mkdir "%LOG_DIR%"

echo. >> "%LOG_FILE%"
echo ============================================================ >> "%LOG_FILE%"
echo [%DATE% %TIME%] Amazon sync starting >> "%LOG_FILE%"

:: Run with all Doppler secrets injected as env vars
doppler run --project ent-agency-analytics --config prd -- ^
  "%PYTHON%" "%PROJECT_DIR%\tools\amazon-daily-sync.py" >> "%LOG_FILE%" 2>&1

set EXIT_CODE=%ERRORLEVEL%

if %EXIT_CODE% neq 0 (
    echo [%DATE% %TIME%] FAILED exit=%EXIT_CODE% >> "%LOG_FILE%"
    powershell -NoProfile -WindowStyle Hidden -Command ^
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show('Amazon Associates sync FAILED. Check: %LOG_FILE%', 'ENT Agency Alert', 'OK', 'Error') | Out-Null"
) else (
    echo [%DATE% %TIME%] SUCCESS >> "%LOG_FILE%"
)

:: Keep only last 30 log files
powershell -NoProfile -WindowStyle Hidden -Command ^
  "Get-ChildItem '%LOG_DIR%\amazon-sync-*.log' | Sort-Object LastWriteTime -Descending | Select-Object -Skip 30 | Remove-Item -Force"

exit /b %EXIT_CODE%
