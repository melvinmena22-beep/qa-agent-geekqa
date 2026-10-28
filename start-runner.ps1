# Inicia el QA Runner supervisado (tools/runner-supervisor.mjs) en su propia ventana minimizada.
# El supervisor reinicia el runner si falla y lo recarga solo al cambiar tools/*.mjs o .env,
# así que después de una corrección no hace falta reiniciarlo a mano.
# Se crea con WMI para que no dependa de la terminal, VS Code o el agente que lo lanzó:
# si esa sesión se cierra, el runner sigue funcionando.
# Uso: .\start-runner.ps1   (si ya está en marcha, solo lo confirma)

$ErrorActionPreference = "Stop"
$Root = $PSScriptRoot
$Port = if ($env:QA_RUNNER_PORT) { $env:QA_RUNNER_PORT } else { 8787 }
$PageUrl = "http://localhost:$Port/qa-runner.html"

function Test-Runner {
    try {
        return (Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/runner-state" -TimeoutSec 2).StatusCode -eq 200
    } catch {
        return $false
    }
}

if (Test-Runner) {
    Write-Host "QA Runner ya está en marcha: $PageUrl" -ForegroundColor Green
    return
}

$Node = (Get-Command node -ErrorAction Stop).Source
$Command = "Set-Location -LiteralPath '$Root'; `$Host.UI.RawUI.WindowTitle = 'QA Runner (no cerrar)'; & '$Node' tools/runner-supervisor.mjs"
$Result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = "powershell.exe -NoProfile -NoExit -WindowStyle Minimized -Command `"$Command`""
    CurrentDirectory = $Root
}
if ($Result.ReturnValue -ne 0) { throw "No se pudo iniciar el supervisor (Win32_Process.Create devolvió $($Result.ReturnValue))." }

for ($Attempt = 1; $Attempt -le 40; $Attempt++) {
    if (Test-Runner) {
        Write-Host "QA Runner disponible: $PageUrl" -ForegroundColor Green
        Write-Host "Queda en la ventana minimizada 'QA Runner (no cerrar)'." -ForegroundColor DarkGray
        return
    }
    Start-Sleep -Milliseconds 250
}
throw "El QA Runner no respondió en $PageUrl. Revisa la ventana 'QA Runner (no cerrar)'."
