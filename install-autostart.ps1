# Registra una tarea de Windows que mantiene el QA Runner disponible:
# - lo inicia al iniciar sesión;
# - cada 10 minutos comprueba que siga en marcha y, si alguien cerró su ventana, lo vuelve a iniciar.
# start-runner.ps1 no duplica un runner que ya responde, así que las repeticiones no tienen efecto mientras funciona.
# Uso: .\install-autostart.ps1            (instalar o actualizar)
#      .\install-autostart.ps1 -Uninstall (quitar)

param([switch]$Uninstall)

$ErrorActionPreference = "Stop"
$TaskName = "QA Runner (GeekQA)"

if ($Uninstall) {
    Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false -ErrorAction SilentlyContinue
    Write-Host "Tarea '$TaskName' eliminada. El runner ya no se iniciará solo." -ForegroundColor Yellow
    return
}

$StartScript = Join-Path $PSScriptRoot "start-runner.ps1"
$User = "$env:USERDOMAIN\$env:USERNAME"
$Action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument "-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$StartScript`"" `
    -WorkingDirectory $PSScriptRoot
$AtLogon = New-ScheduledTaskTrigger -AtLogOn -User $User
$Watchdog = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 10) -RepetitionDuration (New-TimeSpan -Days 3650)
$Settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 5)
$Principal = New-ScheduledTaskPrincipal -UserId $User -LogonType Interactive -RunLevel Limited

Register-ScheduledTask -TaskName $TaskName -Action $Action -Trigger @($AtLogon, $Watchdog) -Settings $Settings -Principal $Principal `
    -Description "Mantiene el QA Runner en http://localhost:8787 (inicio de sesión y comprobación cada 10 minutos)." -Force | Out-Null
Write-Host "Tarea '$TaskName' registrada: el QA Runner se inicia al iniciar sesión y se revisa cada 10 minutos." -ForegroundColor Green
