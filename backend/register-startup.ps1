$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $scriptDir 'start-backend.bat'
$taskName = 'DiscordVoiceBotBackend'

if (-not (Test-Path $batPath)) {
    throw "Missing start-backend.bat at $batPath"
}

$exists = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($exists) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction -Execute $batPath -WorkingDirectory $scriptDir
$trigger = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Force | Out-Null

Write-Host "Startup task registered: $taskName"
Write-Host "Backend will start automatically when this Windows user logs in."
