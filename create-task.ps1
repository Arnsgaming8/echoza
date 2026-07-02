$action = New-ScheduledTaskAction -Execute "C:\ProgramData\pion-turn\turn-server.exe" -Argument "--port 3478 --users echoza=echoza123 --realm echoza.local --public-ip 76.155.153.25 --relay-min 50000 --relay-max 50000"
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName "PionTURN" -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
Write-Host "Task created"
