$task = Get-ScheduledTask -TaskName "PionTURN"
$task.Settings.ExecutionTimeLimit = "PT0S"
$task.Settings.RestartInterval = "PT1M"
$task.Settings.RestartCount = 999
Set-ScheduledTask -TaskName "PionTURN" -Settings $task.Settings
Write-Host "Updated - TURN will run 24/7 and restart if it crashes"
