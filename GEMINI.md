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
- Cuando esté disponible el servidor MCP `graphify`, úsalo para localizar símbolos, dependencias, callers y pruebas relacionadas antes de leer archivos completos. Solicita resultados acotados y resumidos; no lo uses para reemplazar la ejecución funcional, accesibilidad o performance.
- Guarda todos los resultados en la ruta [3-outputs/run](3-outputs/run)/{story-id}/.
- No generes reportes, capturas ni archivos temporales fuera de esa estructura.
- Si aparecen fallos, registra bugs en la carpeta bugs/ del story correspondiente.
- Modos de ejecución funcional:
  - **Modo agente** (por defecto fuera del runner): ejecuta las pruebas tú mismo con MCP Playwright; no las delegues a otro agente, proceso ni shell.
  - **Modo híbrido** (`QA_EXECUTION_MODE=playwright`): la ejecución la hace `tools/qa-runner.mjs` con Playwright Test sobre `tests/{story-id}.spec.ts` y sus partes `tests/{story-id}.pN.spec.ts` (el spec se genera por lotes en paralelo; cada agente escribe solo la parte que se le asigna). Tú solo generas el spec o haces el triage cuando el runner te lo pide, y puedes ejecutar `npx playwright test` sobre ese archivo para validarlo o reproducir un caso.
- Los specs deben verificar de verdad: cada test con al menos una aserción real (nunca `expect(true)` ni código comentado), solo escenarios del plan con ID `SC_NNN` y solo navegación al dominio de la URL de pruebas de la historia. `tools/qa-guards.mjs` rechaza los tests que no cumplen y los registra como `BLOCKED/SCRIPT_INVALID`; nunca fuerces un fallo para generar un bug.
- `execution/execution-report.json` debe cumplir `schemas/execution-report.schema.json`; el runner lo valida.
- **Datos que solo el usuario puede aportar** (otro usuario con un perfil concreto, un registro existente, la respuesta a una ambigüedad): no los inventes ni dejes el caso bloqueado sin más. El test los lee de `process.env.QA_INPUT_{NOMBRE}` (texto) o, si es un usuario, usa su sesión iniciada `process.env.QA_INPUT_{NOMBRE}_STORAGE_STATE`, y mientras falten se bloquea con `test.skip(!valor, "BLOCKED/NEEDS_INPUT: {NOMBRE} [credentials|text]: {qué hace falta}")`. qa-runner.html pide el dato, valida los usuarios iniciando sesión y repite automáticamente solo esos casos.
- **Usuarios y contraseñas no se guardan:** el runner solo los usa para iniciar sesión y conserva únicamente la sesión (`storageState`). En los specs, usa siempre la sesión; nunca escribas, registres ni pidas usuarios o contraseñas, y no inicies sesión desde los tests.
- **Aplicaciones con login:** las pruebas solo se ejecutan con un usuario y contraseña válidos (o una sesión SSO válida). El runner detecta el login aunque la URL de pruebas sea una portada pública (por ejemplo, `/odoo` → `/web/login` en Odoo), comprueba las credenciales iniciando sesión antes de cada ejecución y se niega a ejecutar sin ellas. Por eso:
  - En el plan, declara `authentication.required: true` (con `reason` y `evidence`) cuando la funcionalidad no sea pública: usuarios autorizados, perfiles, roles, permisos, backoffice o módulos internos.
  - Al generar el spec, si las pantallas exigen login y no tienes sesión, no rellenes el spec con casos `BLOCKED/CREDENTIALS`: el runner detiene la ejecución y pide el usuario. Con sesión disponible, empieza los tests en la zona privada (la sesión ya la aplica `playwright.config.ts`) y no omitas casos por credenciales.
- En el runner, el agente Claude corre con permisos restringidos: solo escribe en `3-outputs/` y solo ejecuta Playwright y Lighthouse. No intentes otros comandos de shell.
- Ejecuta solo `selectedScenarioIds`, `selectedBrowsers` y `selectedTestTypes` del plan/solicitud. Si `selectedBrowsers` falta o está vacío, usa Chromium. Si se seleccionó `functional` y `selectedScenarioIds` falta o está vacío, registra `BLOCKED/NO_SCENARIOS`; las auditorías sin modalidad funcional no requieren casos. No infieras casos ni modalidades faltantes.
- Usa solo la habilidad de ejecución incluida en `selectedSkills`; `report-bugs` solo corre tras un fallo funcional confirmado.
- Si `clarificationRequired` es `true`, **no bloquees la ejecución**: ejecuta el escenario aplicando el comportamiento más conservador documentado en la historia (por ejemplo, campo requerido = error visible). Registra la ambigüedad como hallazgo informativo `AMB-NNN` en el reporte con severidad `Low`, pero **continúa** y entrega resultado PASS o FAIL. Solo registra `BLOCKED/CLARIFICATION_REQUIRED` si el comportamiento esperado es completamente indeterminado y ninguna heurística razonable puede aplicarse.
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
- lighthouse/{story-id}-lighthouse.json (medianas de 3 corridas por dispositivo y estado según umbrales)
- bugs/{story-id}-bugs.json
- tests/{story-id}.spec.ts

## Skills recomendadas
- qa-automator-azure-devops para convertir criterios de aceptación de Azure DevOps en pruebas trazables, automatizadas y reportadas.
- qa-test-planner para analizar requisitos y planificar la estrategia de QA.
- run-tests-browser para pruebas funcionales.
- run-accessibility-tests para auditoría de accesibilidad.
- run-lighthouse-tests para performance y calidad.
- report-bugs si aparecen fallos en pruebas funcionales.
- log-results para consolidar el reporte final.
- qa-polyglot (`.agents/skills/13.qa-polyglot/SKILL.md`) cuando se pida probar el código fuente de un repositorio en lugar de una historia con URL: detecta lenguajes y frameworks con evidencia y ejecuta sus pruebas nativas (lint, build, unitarias, integración, E2E). Usa `REPO-{nombre}` como story-id en 3-outputs/run.

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

