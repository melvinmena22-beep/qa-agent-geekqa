---
name: report-bugs
description: Analiza fallos de pruebas, genera reportes de errores y crea Bugs en Azure DevOps.
compatibility:
  gemini: ">=2.5.0"
metadata:
  version: 2.0.0
  author: Gemini
allowed-tools: "MCP Playwright, azure-devops.create_azure_bug, azure-devops.search_work_items"
---
# Habilidad: Reportar Errores

> **Condicional:** Esta habilidad se ejecuta automáticamente si `run-tests-browser` encuentra fallos en las pruebas. No necesita estar listada en `selectedSkills` del plan inicial.

## Cuándo Usar

Usa esta habilidad después de la ejecución de pruebas para analizar fallos y generar reportes de errores formales. Se activa automáticamente cuando el orquestador detecta fallos en `execution-report.json`.

## Entrada

- **Reporte de Ejecución:** El archivo `execution/execution-report.json` (formato de `schemas/execution-report.schema.json`), que contiene los escenarios fallidos y rutas a evidencia.

## Pasos

1.  **Analizar Fallos**:
    -   Lee el archivo `execution-report.json` y filtra los escenarios con `status` igual a `FAIL`.
    -   Si no se encuentran fallos, sale de la habilidad.
    -   Antes de reportar, comprueba que el test que falló es fiable: tiene aserciones reales (no `expect(true)`), navega al dominio de la URL de pruebas de la historia y corresponde a un escenario del plan. Un fallo de un test que no cumple esto es un defecto del script, no un bug.
    -   Un fallo con `failureType: "TIMEOUT"` o un caso con `flaky: true` no es un bug salvo que lo reproduzcas dos veces de forma idéntica.
2.  **Decidir los datos del bug** (lo único que aporta el agente):
    -   `title`: breve y observable (qué falla, dónde), sin especular la causa.
    -   `severity`: `1 - Critical` (bloquea el proceso o pierde datos), `2 - High` (función principal incorrecta sin alternativa), `3 - Medium` (falla con alternativa), `4 - Low` (cosmético).
    -   `impact`: usuarios, proceso o datos afectados, según la evidencia.
    -   Opcional: `expectedResult`, `actualResult` o `evidence` solo para precisar lo que el plan y el error no dicen (p. ej. la respuesta HTTP observada al reproducirlo con MCP Playwright).
3.  **Crear el bug con `azure-devops.create_azure_bug`** (uno por escenario fallido, aunque falle en varios navegadores), pasando `sourceStoryId`, `scenarioId` y los datos anteriores. La herramienta hace el resto de forma determinista:
    -   **Paso a paso:** login si la historia lo exige, precondiciones y los pasos del plan, marcando en rojo el paso que falló (según los `test.step` de la ejecución) con el error observado.
    -   **Evidencias adjuntas:** captura del fallo (también incrustada en el paso que falla), video, trace de Playwright y estado de la página, de todos los navegadores donde falló.
    -   **System Info y descripción:** URL, navegador, sistema operativo, usuario de prueba, fecha, escenario, criterios relacionados, resultado esperado frente a obtenido, resultado de cada paso y criterios de aceptación de la historia.
    -   **Sin duplicados:** etiqueta `QA-US{id}-SC_NNN`. Si ya existe un bug abierto para el escenario, adjunta las evidencias nuevas como re-test y añade un comentario, sin crear otro.
    -   **Registro local:** `bugs/{story-id}-bugs.json`, `bugs/{story-id}-bugs.md` y `bugs/evidence/BUG-{story-id}-SC_NNN/`, y vincula `bugId` y `azureDevOpsId` en `execution-report.json`. No escribas esos archivos a mano.
    -   La herramienta rechaza el bug si el escenario no figura como `FAIL`, si la ejecución no dejó evidencias o si solo falló por tiempo de espera (pasa `timeoutReproduced: true` únicamente después de reproducirlo).
    -   Para revisar el bug sin crearlo, usa `dryRun: true` (o `node tools/azure-devops-importer.mjs bug-preview {id} SC_NNN`).
    -   No crees bugs por pruebas omitidas, bloqueadas por ambiente o errores no reproducibles.
4.  **Informar:** cita en tu salida el ID y la URL de Azure DevOps que devuelve la herramienta y si el bug ya existía (`alreadyExists`). Si la herramienta falla, no afirmes que el bug se creó.

## Salida

-   **Azure DevOps:** un Bug por escenario fallido, hijo de la historia, con Repro Steps, System Info, descripción, etiquetas y evidencias adjuntas.
-   **Reportes locales:** `3-outputs/run/{story-id}/bugs/{story-id}-bugs.json` y `.md`, con las evidencias en `bugs/evidence/`.

## Criterios de Finalización

- ✅ Cada escenario con fallo confirmado del producto tiene su bug (nuevo o re-test del existente) en Azure DevOps.
- ✅ El bug tiene el paso a paso del plan, el paso que falla marcado y las evidencias adjuntas (captura, video, trace).
- ✅ `bugs.json`, `bugs.md` y `execution-report.json` reflejan el ID y la URL del bug.

## Si Falla

| Problema | Acción |
|----------|--------|
| Reporte de ejecución no encontrado | Registra un error y detiene. Esta habilidad no puede ejecutarse sin un reporte de ejecución de pruebas. |
| La herramienta rechaza el bug por falta de evidencias | Vuelve a ejecutar el caso para que Playwright genere captura, video y trace; no crees el bug sin ellas. |
| MCP de Azure DevOps no disponible | Registra una advertencia, conserva el reporte local y no afirmes que el bug fue creado en Azure. |
