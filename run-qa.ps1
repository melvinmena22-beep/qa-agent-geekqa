param(
    [Parameter(Mandatory=$true)]
    [string]$StoryId
)

Write-Host "Iniciando flujo de QA para US-$StoryId..." -ForegroundColor Cyan

# 1. Importar la historia
node tools/azure-devops-importer.mjs import $StoryId

if ($LASTEXITCODE -ne 0) {
    Write-Host "Error al importar la historia desde Azure DevOps. Revisa tu token y el ID." -ForegroundColor Red
    exit 1
}

# 2. Invocar al agente Antigravity para que haga el trabajo
Write-Host "Llamando a Antigravity para que genere el plan y los reportes..." -ForegroundColor Cyan
agy "Realiza el flujo de QA completo para la historia US-$StoryId, basándote en GEMINI.md. Genera el plan, el esqueleto de pruebas y el reporte final."

