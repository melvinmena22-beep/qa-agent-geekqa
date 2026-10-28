---
name: report-bugs
description: Analiza fallos de pruebas, genera reportes de errores y crea Bugs en Azure DevOps.
compatibility:
  gemini: ">=2.5.0"
metadata:
  version: 1.1.0
  author: Gemini
allowed-tools: "MCP Playwright, azure-devops.create_azure_bug, azure-devops.search_work_items"
---
# Habilidad: Reportar Errores

> **Condicional:** Esta habilidad se ejecuta automáticamente si `run-tests-browser` encuentra fallos en las pruebas. No necesita estar listada en `selectedSkills` del plan inicial.

## Cuándo Usar

Usa esta habilidad después de la ejecución de pruebas para analizar fallos y generar reportes de errores formales. Se activa automáticamente cuando el orquestador detecta fallos en `execution-report.json`.

## Entrada

- **Reporte de Ejecución:** El archivo `execution-report.json` del skill `execute-tests`, que contiene la lista de pruebas fallidas y rutas a evidencia.

## Pasos

1.  **Analizar Fallos**:
    -   Lee el archivo `execution-report.json` y filtra todas las pruebas con estado "FAILED".
    -   Si no se encuentran fallos, sale de la habilidad.
2.  **Generar Reportes de Errores**:
    -   Para cada prueba fallida reproducible, crea un reporte usando `templates/bug_template.md` con título, pasos de reproducción, resultado esperado y actual, ambiente, severidad, impacto y evidencia.
    -   Asigna una severidad (Crítica, Alta, Media, Baja) basada en un análisis del fallo.
    -   Genera un ID de error único (ej. `BUG-{story-id}-{nn}`).
    -   Copia toda la evidencia asociada (capturas de pantalla, logs) en el directorio `bugs/evidence/`, renombrando los archivos para que coincidan con el ID del error.
    -   Selecciona la captura que muestra el estado fallido y conserva su ruta relativa al workspace, por ejemplo `3-outputs/run/US-78/bugs/evidence/BUG-US-78-01.png`.
3.  **Crear Bugs en Azure DevOps**:
  -   Usa el MCP `azure-devops.create_azure_bug` para cada fallo reproducible y confirmado.
  -   Pasa `evidenceFilePath` con la ruta de la captura guardada en `bugs/evidence/`, además del texto `evidence`. La herramienta sube la imagen y la agrega al work item como archivo adjunto; no basta con escribir el nombre o la ruta en la descripción.
  -   Mapea el título a `System.Title`, los pasos a `Microsoft.VSTS.TCM.ReproSteps`, el ambiente/navegador a `Microsoft.VSTS.TCM.SystemInfo`, y la severidad a `Microsoft.VSTS.Common.Severity`.
  -   Incluye resultado esperado, actual, impacto y evidencia en la descripción. La herramienta hereda Area e Iteration de la historia y vincula el bug con ella.
  -   No crees bugs por pruebas omitidas, bloqueadas por ambiente o errores no reproducibles. No dupliques un bug existente; registra su ID si se identifica.
  -   Registra el `azureDevOpsId`, URL, nombre de la evidencia y `evidenceAttached` devuelto por la herramienta en el reporte local.
  -   Confirma `evidenceAttached: true` en la respuesta de la herramienta antes de afirmar que la imagen quedó adjunta. Si no hay captura disponible o falla la carga, conserva el bug/reporte local y registra claramente la advertencia; nunca declares que se adjuntó.
4.  **Guardar Reportes**:
    -   Guarda los reportes de errores consolidados como un archivo JSON único (`{story-id}-bugs.json`) y un archivo Markdown (`{story-id}-bugs.md`) en el directorio de salida `bugs`.

## Salida

-   **Reportes de Errores:** Un archivo JSON y un archivo Markdown en el directorio `3-outputs/run/{story-id}/bugs/`.
-   **Evidencia:** Todos los archivos de evidencia copiados a `3-outputs/run/{story-id}/bugs/evidence/`.

## Criterios de Finalización

- ✅ Un reporte `bugs.json` y `bugs.md` es creado si alguna prueba falló.
- ✅ Toda la evidencia para pruebas fallidas es copiada y renombrada en el directorio `bugs/evidence/`.
- ✅ La captura asociada al bug se adjunta en Azure DevOps como archivo, y el reporte local indica si la carga quedó confirmada.
- ✅ Bugs reproducibles se crean en Azure DevOps cuando el MCP está configurado.

## Si Falla

| Problema | Acción |
|----------|--------|
| Reporte de ejecución no encontrado | Registra un error y detiene. Esta habilidad no puede ejecutarse sin un reporte de ejecución de pruebas. |
| Archivos de evidencia faltantes | Registra una advertencia y crea el reporte de error con una nota de que la evidencia no fue encontrada. |
| MCP de Azure DevOps no disponible | Registra una advertencia, conserva el reporte local y no afirmes que el bug fue creado en Azure. |
