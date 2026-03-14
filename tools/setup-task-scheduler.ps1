# Run this in PowerShell as Administrator
# Sets up daily Amazon sync at 8:30am

$ProjectDir = "C:\Users\ethan.atchley\creator-metrics"
$Python = "C:\Program Files\PyManager\python3.exe"
$Script = "$ProjectDir\tools\amazon-daily-sync.py"
$LogFile = "$ProjectDir\logs\amazon-sync.log"

New-Item -ItemType Directory -Path "$ProjectDir\logs" -Force | Out-Null

$action = New-ScheduledTaskAction `
    -Execute $Python `
    -Argument $Script `
    -WorkingDirectory $ProjectDir

$trigger = New-ScheduledTaskTrigger -Daily -At "08:30AM"

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 2 `
    -RestartInterval (New-TimeSpan -Minutes 5) `
    -StartWhenAvailable

Unregister-ScheduledTask -TaskName "AmazonDataSync" -Confirm:$false -ErrorAction SilentlyContinue

Register-ScheduledTask `
    -TaskName "AmazonDataSync" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -RunLevel Highest `
    -Force

Write-Host "Task created. Verify:"
Write-Host "  Get-ScheduledTask -TaskName AmazonDataSync"
Write-Host ""
Write-Host "Test run now:"
Write-Host "  Start-ScheduledTask -TaskName AmazonDataSync"
