param(
    [Parameter(Mandatory=$true)]
    [string]$StoryId,

    # Agente QA: claude (Claude Code) o agy (Antigravity CLI). Si se omite, usa QA_AGENT del entorno o de .env.
    [ValidateSet("claude", "agy")]
    [string]$Agent = ""
)

function Get-DotEnvValue([string]$Name) {
    $envFile = Join-Path (Get-Location).Path ".env"
    if (-not (Test-Path $envFile)) { return $null }
    $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$Name\s*=" } | Select-Object -First 1
    if ($line) { return ($line -split "=", 2)[1].Trim().Trim('"', "'") }
    return $null
}

if (-not $Agent) { $Agent = if ($env:QA_AGENT) { $env:QA_AGENT } else { Get-DotEnvValue "QA_AGENT" } }
if (-not $Agent) { $Agent = "claude" }
$Agent = $Agent.ToLower()
if ($Agent -notin @("claude", "agy")) { throw "QA_AGENT='$Agent' no es válido. Usa 'claude' o 'agy'." }
# El runner hereda esta variable para usar el mismo agente.
$env:QA_AGENT = $Agent

function Resolve-ClaudeCommand {
    $configured = if ($env:CLAUDE_COMMAND) { $env:CLAUDE_COMMAND } else { Get-DotEnvValue "CLAUDE_COMMAND" }
    if ($configured -and (Test-Path $configured)) { return $configured }
    $onPath = Get-Command claude -ErrorAction SilentlyContinue
    if ($onPath) { return $onPath.Source }
    $candidates = @(
        (Join-Path $env:USERPROFILE ".local\bin\claude.exe"),
        $(if ($env:APPDATA) { Join-Path $env:APPDATA "npm\claude.cmd" })
    ) | Where-Object { $_ -and (Test-Path $_) }
    if ($candidates) { return @($candidates)[0] }
    # Binario incluido en la extensión "Claude Code for VS Code" (VS Code o Antigravity).
    foreach ($editorDir in @(".vscode", ".antigravity", ".cursor")) {
        $extensionsDir = Join-Path $env:USERPROFILE "$editorDir\extensions"
        if (-not (Test-Path $extensionsDir)) { continue }
        $bundled = Get-ChildItem $extensionsDir -Directory -Filter "anthropic.claude-code-*" |
            Sort-Object { [version](($_.Name -replace '^anthropic\.claude-code-([\d.]+).*$', '$1')) } -Descending |
            ForEach-Object { Join-Path $_.FullName "resources\native-binary\claude.exe" } |
            Where-Object { Test-Path $_ } |
            Select-Object -First 1
        if ($bundled) { return $bundled }
    }
    throw "No se encontró el ejecutable 'claude'. Instala Claude Code o define CLAUDE_COMMAND en tu archivo .env."
}

function Ensure-QaRunner {
    # Mismo arranque que start-runner.ps1: runner supervisado e independiente de esta terminal.
    & (Join-Path $PSScriptRoot "start-runner.ps1")
}

Ensure-QaRunner

Write-Host "Iniciando flujo de QA para US-$StoryId..." -ForegroundColor Cyan

# 1. Importar la historia
node tools/azure-devops-importer.mjs import $StoryId

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error al importar la historia desde Azure DevOps. Revisa tu token y el ID." -ForegroundColor Red
    exit 1
}

$QaPrompt = "Realiza el flujo de QA completo para la historia US-$StoryId, basándote en GEMINI.md y aplicando la skill qa-automator-azure-devops. Genera trazabilidad CA -> casos -> scripts -> resultados, el plan, el esqueleto de pruebas y el reporte final. No inventes requisitos ni declares como ejecutadas las pruebas que no puedan correr."

# 2. Invocar al agente QA para que haga el trabajo
if ($Agent -eq "claude") {
    $ClaudeCmd = Resolve-ClaudeCommand
    # Mismos permisos que tools/qa-runner.mjs: solo escribe en 3-outputs/ y solo ejecuta Playwright y Lighthouse.
    # QA_AGENT_PERMISSIONS=unrestricted vuelve a --dangerously-skip-permissions.
    $Permissions = if ($env:QA_AGENT_PERMISSIONS) { $env:QA_AGENT_PERMISSIONS } else { Get-DotEnvValue "QA_AGENT_PERMISSIONS" }
    if ($Permissions -eq "unrestricted") {
        $PermissionArgs = @("--dangerously-skip-permissions")
    } else {
        $ShellCommands = @("npx playwright test", "npx playwright --version", "npx -y lighthouse@12.2.1", "mkdir")
        $PermissionArgs = @("--permission-mode", "dontAsk", "--allowedTools", "Read", "Glob", "Grep", "TodoWrite", "Edit(./3-outputs/**)") +
            ($ShellCommands | ForEach-Object { "Bash(${_}:*)"; "PowerShell(${_}:*)" }) +
            @("mcp__playwright-chromium", "mcp__playwright-firefox", "mcp__playwright-webkit", "mcp__azure-devops", "mcp__graphify")
    }
    $ClaudeArgs = @("-p") + $PermissionArgs + @("--add-dir", (Get-Location).Path, "--mcp-config", (Join-Path (Get-Location).Path ".mcp.json"))
    $ClaudeModel = if ($env:CLAUDE_MODEL) { $env:CLAUDE_MODEL } else { Get-DotEnvValue "CLAUDE_MODEL" }
    if ($ClaudeModel) { $ClaudeArgs += @("--model", $ClaudeModel) }
    Write-Host "Llamando a Claude Code ($ClaudeCmd) para que genere el plan y los reportes..." -ForegroundColor Cyan
    # El prompt va por stdin (UTF-8 para conservar acentos) para evitar problemas de comillas.
    $OutputEncoding = New-Object System.Text.UTF8Encoding $false
    $QaPrompt | & $ClaudeCmd @ClaudeArgs
    exit $LASTEXITCODE
}

# Resolver el comando agy
$localAgy = if ($env:LOCALAPPDATA) { Join-Path $env:LOCALAPPDATA "agy\bin\agy.exe" } else { $null }
$npmAgy = if ($env:APPDATA) { Join-Path $env:APPDATA "npm\agy.cmd" } else { $null }

$AgyCmd = if ($env:AGY_COMMAND -and (Test-Path $env:AGY_COMMAND)) {
    $env:AGY_COMMAND
} elseif (Get-Command agy -ErrorAction SilentlyContinue) {
    (Get-Command agy).Source
} elseif ($localAgy -and (Test-Path $localAgy)) {
    $localAgy
} elseif ($npmAgy -and (Test-Path $npmAgy)) {
    $npmAgy
} else {
    throw "No se encontró el ejecutable 'agy'. Verifica que Antigravity CLI esté instalado o define AGY_COMMAND en tu archivo .env."
}

Write-Host "Llamando a Antigravity ($AgyCmd) para que genere el plan y los reportes..." -ForegroundColor Cyan
& $AgyCmd --dangerously-skip-permissions --prompt $QaPrompt
