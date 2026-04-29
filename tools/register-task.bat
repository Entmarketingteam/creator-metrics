@echo off
schtasks /delete /tn "AmazonDataSync" /f 2>nul
schtasks /create /tn "AmazonDataSync" /tr "\"C:\Users\ethan.atchley\creator-metrics\tools\run-amazon-sync.bat\"" /sc daily /st 08:00 /f
if %ERRORLEVEL% equ 0 (
    echo.
    echo Task registered successfully.
    echo Run now to test: schtasks /run /tn "AmazonDataSync"
) else (
    echo.
    echo FAILED - try running as Administrator.
)
