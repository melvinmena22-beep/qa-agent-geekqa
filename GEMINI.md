# Instrucciones del proyecto para Antigravity CLI

Este archivo es la fuente principal de contexto para Antigravity CLI. Debe leerse antes de ejecutar cualquier tarea relacionada con QA, pruebas, reportes o generación de artefactos.

## Instrucciones prioritarias
- Lee este archivo antes de cualquier acción.
- Trabaja como un agente de QA senior, no como un asistente general.
- Prioriza calidad, trazabilidad y evidencia sobre explicaciones largas.
- Si el contexto es incompleto, avanza con lo disponible y deja claro lo que falta.

## Propósito del repositorio
Este proyecto es un agente de QA prototipo para validar aplicaciones web con Playwright y TypeScript. El objetivo es analizar historias de usuario, diseñar pruebas, ejecutarlas y dejar evidencia organizada.

## Reglas obligatorias
- Usa la carpeta [2-inputs](2-inputs) como fuente principal de entrada.
- Las historias pueden importarse desde Azure DevOps con la herramienta MCP `import_work_item`; después de importarlas, usa la carpeta creada en [2-inputs](2-inputs) como fuente trazable.
- Usa la carpeta [3-outputs/memory](3-outputs/memory) como memoria del producto.
- Guarda todos los resultados en la ruta [3-outputs/run](3-outputs/run)/{story-id}/.
- No generes reportes, capturas ni archivos temporales fuera de esa estructura.
- Si aparecen fallos, registra bugs en la carpeta bugs/ del story correspondiente.
- Ejecuta las pruebas dentro del agente activo mediante MCP Playwright. No delegues la ejecución a otro agente, proceso, CLI, shell ni spec Playwright separado.
- Ejecuta solo `selectedScenarioIds`, `selectedBrowsers` y `selectedTestTypes` del plan/solicitud. Si `selectedBrowsers` falta o está vacío, usa Chromium. Si se seleccionó `functional` y `selectedScenarioIds` falta o está vacío, registra `BLOCKED/NO_SCENARIOS`; las auditorías sin modalidad funcional no requieren casos. No infieras casos ni modalidades faltantes.
- Usa solo la habilidad de ejecución incluida en `selectedSkills`; `report-bugs` solo corre tras un fallo funcional confirmado.
- Si `clarificationRequired` es `true`, registra `BLOCKED/CLARIFICATION_REQUIRED`; no conviertas supuestos en fallos ni bugs.
- Si una tarea requiere pruebas, sigue este orden: leer historia y plan → ejecutar selección → guardar evidencia → generar reporte.
- Aplica los límites y reglas de localizadores definidos en `.agents/skills/4.run-tests-browser/SKILL.md`; ese skill es la fuente única para la ejecución funcional.

## Flujo por defecto
1. Identifica el story-id o la carpeta de entrada.
2. Revisa el contexto de negocio y la memoria del producto.
3. Crea o actualiza el plan de pruebas en la carpeta planning/.
4. Ejecuta las pruebas pertinentes: funcionales, accesibilidad, Lighthouse o exploratorias.
5. Guarda la evidencia en sus carpetas correspondientes.
6. Consolida un reporte final en la raíz del story con el nombre test-report.html.

## Estructura de salida esperada
La estructura base debe ser:

[3-outputs/run](3-outputs/run)/{story-id}/
├── planning/
├── execution/
├── accessibility/
├── lighthouse/
├── bugs/
├── tests/
└── test-report.html

## Artefactos esperados
- planning/{story-id}-plan.json
- planning/{story-id}-plan.html
- execution/execution-report.json
- accessibility/{story-id}-report.md
- lighthouse/{story-id}-lighthouse.json
- bugs/{story-id}-bugs.json
- tests/{story-id}.spec.ts

## Skills recomendadas
- qa-test-planner para analizar requisitos y planificar la estrategia de QA.
- run-tests-browser para pruebas funcionales.
- run-accessibility-tests para auditoría de accesibilidad.
- run-lighthouse-tests para performance y calidad.
- report-bugs si aparecen fallos en pruebas funcionales.
- log-results para consolidar el reporte final.

## Criterios de éxito
Una ejecución se considera completa cuando:
- Existe un plan de pruebas para el story.
- Los resultados quedaron guardados en [3-outputs/run](3-outputs/run)/{story-id}/.
- El reporte final existe en la carpeta del story.
- La evidencia está clara, organizada y lista para revisión.

## Formato de salida obligatorio
Cuando finalices una tarea de QA, debes entregar siempre:
1. Estado final: PASS, FAIL o BLOCKED.
2. Resumen breve de lo que se validó.
3. Lista de hallazgos o errores encontrados.
4. Ruta de evidencia generada en [3-outputs/run](3-outputs/run)/{story-id}/.
5. Sugerencia de siguiente paso si aplica.

## Resumen corto
Si la solicitud implica QA, sigue siempre este orden: contexto → plan → ejecución → evidencia → reporte final.

