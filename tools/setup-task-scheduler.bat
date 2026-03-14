@echo off
REM Run this once as Administrator to set up daily Amazon sync at 8:30am

set PROJECT_DIR=C:\Users\ethan.atchley\creator-metrics
set PYTHON=C:\Program Files\PyManager\python3.exe
set SCRIPT=%PROJECT_DIR%\tools\amazon-data-sync.py
set LOGFILE=%PROJECT_DIR%\logs\amazon-sync.log

REM Create logs directory
mkdir "%PROJECT_DIR%\logs" 2>nul

REM Delete existing task if present
schtasks /delete /tn "AmazonDataSync" /f 2>nul

REM Create daily task at 8:30am for all creators
schtasks /create /tn "AmazonDataSync" ^
  /tr "\"%PYTHON%\" \"%SCRIPT%\" --creator all --months 6 --days 90 >> \"%LOGFILE%\" 2>&1" ^
  /sc daily /st 08:30 ^
  /ru "%USERNAME%" ^
  /rl HIGHEST ^
  /f

echo.
echo Task created. Verify with:
echo   schtasks /query /tn "AmazonDataSync" /fo LIST
echo.
echo Test run now with:
echo   schtasks /run /tn "AmazonDataSync"
