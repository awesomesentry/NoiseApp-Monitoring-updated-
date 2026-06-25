# ============================================================
# Smart Classroom Noise Monitor - Scheduled Task Setup
# ============================================================
# Run this PowerShell script as Administrator to create a
# daily scheduled task that runs the cleanup cron job.
#
# Usage:
#   Right-click -> Run with PowerShell (as Administrator)
# ============================================================

# Get the absolute path to the cleanup-cron directory
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NodePath = (Get-Command node).Source
$CleanupScript = Join-Path $ScriptDir "cleanup.js"

Write-Host "Setting up Scheduled Task for NoiseApp Cleanup..." -ForegroundColor Cyan
Write-Host "Node path: $NodePath" -ForegroundColor Gray
Write-Host "Script path: $CleanupScript" -ForegroundColor Gray

# Create a scheduled task that runs daily at 3:00 AM
$Action = New-ScheduledTaskAction `
    -Execute "$NodePath" `
    -Argument "`"$CleanupScript`" --once" `
    -WorkingDirectory "$ScriptDir"

$Trigger = New-ScheduledTaskTrigger `
    -Daily `
    -At "03:00AM"

$Principal = New-ScheduledTaskPrincipal `
    -UserId "$env:USERDOMAIN\$env:USERNAME" `
    -LogonType S4U `
    -RunLevel Limited

$Settings = New-ScheduledTaskSettingsSet `
    -StartWhenAvailable `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
    -MultipleInstances IgnoreNew

Register-ScheduledTask `
    -TaskName "NoiseApp Cleanup" `
    -Action $Action `
    -Trigger $Trigger `
    -Principal $Principal `
    -Settings $Settings `
    -Description "Daily cleanup of expired noise events (older than retention period) for Smart Classroom Noise Monitor. Runs node cleanup.js --once at 3:00 AM." `
    -Force

Write-Host ""
Write-Host "Task 'NoiseApp Cleanup' registered successfully!" -ForegroundColor Green
Write-Host "It will run daily at 3:00 AM." -ForegroundColor Green
Write-Host ""
Write-Host "To test it immediately, run:" -ForegroundColor Yellow
Write-Host "  Start-ScheduledTask -TaskName 'NoiseApp Cleanup'" -ForegroundColor Yellow
Write-Host ""
Write-Host "To view the task in Task Scheduler:" -ForegroundColor Yellow
Write-Host "  taskschd.msc /create" -ForegroundColor Yellow