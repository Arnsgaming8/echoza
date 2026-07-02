$task = Get-ScheduledTask -TaskName "PionTURN"
$task.Settings | Format-List *
Write-Host "---"
$task.Principal | Format-List *
Write-Host "---"
$task.Triggers | Format-List *
