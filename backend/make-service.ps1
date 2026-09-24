$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$batPath = Join-Path $scriptDir 'start-backend.bat'
$serviceName = 'DiscordVoiceBotBackendSvc'

$exists = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
if ($exists) {
    Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    sc.exe delete $serviceName | Out-Null
}

$cmd = "sc.exe create `"$serviceName`" binPath= \"\"C:\\Windows\\System32\\cmd.exe\" /c \"\"$batPath\"\"\" start= auto";
Invoke-Expression $cmd

sc.exe failure $serviceName reset= 0 actions= restart/5000
sc.exe start $serviceName | Out-Null

Write-Host "Windows service created and started: $serviceName"
Write-Host "This keeps the backend running automatically in the background."
