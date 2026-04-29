# Amazon Associates daily sync — Task Scheduler setup
# No admin required — registers for current user

$ProjectDir = "C:\Users\ethan.atchley\creator-metrics"
$Wrapper    = "$ProjectDir\tools\run-amazon-sync.bat"
$LogDir     = "$ProjectDir\logs"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# Remove old version if exists
& schtasks /delete /tn "AmazonDataSync" /f 2>$null

# Register via schtasks.exe — works without admin for current-user tasks
$result = & schtasks /create `
    /tn "AmazonDataSync" `
    /tr "`"$Wrapper`"" `
    /sc daily `
    /st 08:00 `
    /f 2>&1

if ($LASTEXITCODE -eq 0) {
    Write-Host "Task registered. Daily at 8:00am, starts when available if missed." -ForegroundColor Green
    Write-Host "Logs: $LogDir\amazon-sync-YYYY-MM-DD.log"
    Write-Host ""
    Write-Host "Run test now:"
    Write-Host "  schtasks /run /tn AmazonDataSync"
    Write-Host ""
    Write-Host "Check status:"
    Write-Host "  schtasks /query /tn AmazonDataSync /fo LIST"
} else {
    Write-Host "FAILED: $result" -ForegroundColor Red
}
