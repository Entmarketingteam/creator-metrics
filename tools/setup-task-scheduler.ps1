# Amazon Associates daily sync — Task Scheduler setup
# Run once as Administrator to register the task

$ProjectDir = "C:\Users\ethan.atchley\creator-metrics"
$Wrapper    = "$ProjectDir\tools\run-amazon-sync.bat"
$LogDir     = "$ProjectDir\logs"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# Remove any old version
Unregister-ScheduledTask -TaskName "AmazonDataSync" -Confirm:$false -ErrorAction SilentlyContinue

$action = New-ScheduledTaskAction `
    -Execute "cmd.exe" `
    -Argument "/c `"$Wrapper`"" `
    -WorkingDirectory $ProjectDir

# Run at 8:00am daily; StartWhenAvailable catches up if PC was off
$trigger = New-ScheduledTaskTrigger -Daily -At "08:00AM"

$settings = New-ScheduledTaskSettingsSet `
    -ExecutionTimeLimit (New-TimeSpan -Minutes 30) `
    -RestartCount 3 `
    -RestartInterval (New-TimeSpan -Minutes 3) `
    -StartWhenAvailable `
    -RunOnlyIfNetworkAvailable

# Run as logged-in user so Chrome can open a real window + Doppler creds are available
$principal = New-ScheduledTaskPrincipal `
    -UserId ([System.Security.Principal.WindowsIdentity]::GetCurrent().Name) `
    -LogonType Interactive `
    -RunLevel Highest

Register-ScheduledTask `
    -TaskName "AmazonDataSync" `
    -Action $action `
    -Trigger $trigger `
    -Settings $settings `
    -Principal $principal `
    -Force

Write-Host ""
Write-Host "Task registered. Daily at 8:00am, starts when available if missed." -ForegroundColor Green
Write-Host "Logs: $LogDir\amazon-sync-YYYY-MM-DD.log"
Write-Host ""
Write-Host "Test run (runs immediately):"
Write-Host "  Start-ScheduledTask -TaskName AmazonDataSync"
Write-Host ""
Write-Host "Check status:"
Write-Host "  Get-ScheduledTask -TaskName AmazonDataSync | Select State, LastRunTime, LastTaskResult"
