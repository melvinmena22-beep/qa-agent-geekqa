---
name: run-tests-browser
description: Ejecuta pruebas de navegación en navegador con todas las interacciones usando MCP Playwright.
compatibility:
  gemini: ">=2.5.0"
metadata:
  version: 1.2.0
  author: Gemini
allowed-tools: "MCP Playwright"
---
# Habilidad: Ejecutar Pruebas en Navegador

> **Condicional:** Esta habilidad solo se ejecuta si `run-tests-browser` está listado en el arreglo `selectedSkills` del archivo `{story-id}-plan.json`.

## Cuándo Usar

Esta habilidad se activa cuando se encuentra una URL en la historia de usuario y el plan de pruebas requiere interacción directa del navegador. Úsala para tareas que involucren:
- Explorar una página o flujo de usuario.
- Hacer clic en botones, enlaces y otros elementos.
- Llenar formularios.
- Tomar capturas de pantalla para evidencia.
- Navegación e interacción general.

## Regla de ejecución

- Ejecuta dentro del agente activo usando únicamente MCP Playwright. No uses shell, CLI, scripts, procesos Playwright externos ni otro agente.
- Excepción del modo híbrido (`QA_EXECUTION_MODE=playwright`): `tools/qa-runner.mjs` ejecuta el spec con Playwright Test y genera `execution-report.json`. En ese modo no ejecutes los casos tú mismo; solo genera el spec o haz el triage cuando el runner te lo pida.
- Respeta exactamente `selectedScenarioIds`, `selectedBrowsers` y `selectedTestTypes` del plan. No infieras valores faltantes.
- Usa solo los navegadores seleccionados; si no hay ninguno definido, usa Chromium. No recorras todos los servidores MCP configurados.
- Usa las herramientas MCP Playwright disponibles en la sesión. Si falta una capacidad necesaria, marca el caso `BLOCKED` y registra cuál falta; no la sustituyas por shell.
- Reutiliza la sesión autenticada que guardó el usuario en el runner: los servidores MCP `playwright-session-*` ya tienen esa sesión. No pidas al usuario que inicie sesión durante la ejecución (el agente corre sin nadie delante). Sin sesión disponible, registra `BLOCKED/AUTH_REQUIRED`.

## Entrada

- **Plan de Pruebas:** El archivo `{story-id}-plan.json`, que contiene la URL objetivo y otro contexto.
- **Escenarios de Prueba:** El archivo `{story-id}-plan.json`, que contiene los casos de prueba detallados.
- **Historia de Usuario:** El archivo de historia de usuario que contiene la URL y descripción de la característica a probar.

## Pasos

### Presupuesto estricto y alto rendimiento de ejecución (No más de 2 minutos sin omitir pruebas)

- **Optimización de Performance:** La ejecución completa de TODOS los escenarios de prueba debe completarse en **menos de 2 minutos (máximo 115 segundos)**, garantizando que **ninguna prueba quede sin ejecutar**.
- **Reglas clave para lograr la meta de tiempo sin saltar pruebas:**
  1. Reutilizar la misma instancia/página del navegador entre escenarios siempre que sea posible, evitando recargar todo el DOM desde cero en cada prueba.
  2. Ajustar los tiempos de espera a valores precisos: navegación máxima 6-8s (`domcontentloaded`), acciones y clics 1.5-2s, aserciones 1.5-2s.
  3. Prohibido el uso de esperas artificiales (`waitForTimeout`, sleep) o `networkidle`.
  4. Agrupar verificaciones visuales y capturas al final del paso clave para minimizar el overhead de I/O.
  5. Asegurar que cada prueba seleccionada sea ejecutada secuencial o concurrentemente dentro del margen de 115s, reservando los últimos 15s para la consolidación de evidencias y generación de reportes.

1.  **Configuración y Navegación**:
    -   Extrae la URL objetivo de la historia de usuario o plan de pruebas.
    -   Abre únicamente los navegadores seleccionados; si no hay selección, usa Chromium.
    -   Navega con un límite de 8 segundos y espera solo el control requerido, nunca `networkidle`.

2.  **Autenticación**:
    -   Al validar el enlace de prueba, verificar de inmediato si la aplicación requiere login.
    -   Si la página redirige a un formulario de login o requiere credenciales, usa la sesión guardada (servidor MCP `playwright-session-*`) o las credenciales de `.env` indicadas por el runner. Si no hay ninguna, registra los casos como `BLOCKED/AUTH_REQUIRED` y no esperes al usuario.

3.  **Análisis Inicial de Página**:
    -   **Analizar Animaciones:** No esperes pausas fijas. Espera un selector o estado estable concreto con el presupuesto de aserción indicado.
    -   **Errores de consola:** Registra los errores reproducibles relacionados con el escenario. No marques fallos por mensajes no relacionados con el resultado esperado.

4.  **Ejecutar Escenarios de Prueba**:
    -   Lee y analiza el archivo `{story-id}-plan.json`.
    -   Ejecuta exclusivamente los escenarios enumerados en `selectedScenarioIds`. No ejecutes otros; registra cuántos quedaron omitidos.
    -   Si un escenario tiene `clarificationRequired: true`, aplica la regla de `GEMINI.md`: ejecútalo con el comportamiento más conservador documentado en la historia, registra la ambigüedad como hallazgo `AMB-NNN` de severidad Low y no generes un bug por una expectativa asumida. Usa `BLOCKED/CLARIFICATION_REQUIRED` solo si el comportamiento esperado es completamente indeterminado.
    -   Para cada escenario de prueba:
        -   Registra el ID del escenario antes de ejecutarlo y realiza sus pasos en el orden definido.
        -   Usa timeout máximo de 3 segundos por acción y 2.5 segundos por aserción. Espera solo el cambio de UI que valida el paso; no combines `networkidle`, `waitForTimeout` y esperas de selector para la misma interacción.
        -   Antes de interactuar, usa un locator específico que coincida con exactamente un elemento. Prioriza rol y nombre accesible exactos; si faltan, inspecciona el DOM y usa el atributo o contenedor visible más específico.
        -   No uses texto parcial genérico, `nth()` ni roles que no hayas comprobado. Si el locator encuentra cero o varios elementos, inspecciona y corrígelo antes de seguir.
        -   Opera los elementos `<select>` con `selectOption`; nunca uses `fill` en una lista desplegable.
        -   Para specs Playwright ejecutables, diseña cada caso para terminar en menos de 12 segundos (`playwright.config.ts` corta a los 15 s y reintenta una vez para detectar intermitencias); `globalTimeout` está en 105 segundos para detener la suite antes de dos minutos. Si el timeout global impide iniciar casos restantes, regístralos como `BLOCKED/TIME_BUDGET`, no como fallos. La suma de casos seleccionados y navegadores nunca debe superar el presupuesto total del skill.
        -   Captura una screenshot de página completa al terminar cada escenario ejecutado, tanto si pasa como si falla. En caso de fallo, captura también inmediatamente después del error y antes de continuar o cerrar el navegador.
        -   Guarda las capturas en `3-outputs/run/{story-id}/execution/screenshots/` con nombres estables que incluyan el ID del escenario y, si aplica, navegador e intento (por ejemplo, `SC_001-chromium-attempt-1.png`). No reemplaces evidencia de intentos anteriores.
        -   En `execution-report.json`, registra en el campo `screenshot` de cada resultado la ruta relativa desde el directorio de la historia de su captura. Cada escenario ejecutado debe tener al menos una captura; cada fallo debe tener una captura tomada en el momento del error.

5.  **Generar Reporte**:
    -   Todos los archivos temporales y evidencia deben crearse dentro del directorio `3-outputs/run/{story-id}/execution/`.
    -   Crea un archivo único `execution-report.json` que cumpla `schemas/execution-report.schema.json`: un elemento en `scenarios` por escenario y navegador, con `status` PASS, FAIL o BLOCKED, `reason` (`BLOCKED/MOTIVO` o null), `error` y `screenshot`, y `summary` con totales que coincidan. No inventes otro formato: el runner lo valida.
    - si hay fallos documentarlos en el reporte de ejecución para que el orquestador pueda decidir ejecutar `report-bugs`.

## Salida

-   **Reporte de Ejecución:** `3-outputs/run/{story-id}/execution/execution-report.json`.
-   **Archivos de Evidencia:** Capturas de pantalla y logs guardados en el directorio `3-outputs/run/{story-id}/execution/`, con las screenshots por caso en `execution/screenshots/`.

## Criterios de Finalización

- ✅ El agente navegó exitosamente la URL y realizó las interacciones descritas.
- ✅ Un archivo `execution-report.json` es generado en el directorio de salida `execution`.
- ✅ Cada escenario ejecutado tiene al menos una screenshot y cada fallo tiene una screenshot tomada al ocurrir.
- ✅ Todas las capturas están enlazadas desde el resultado correspondiente en `execution-report.json`.
- ✅ La ejecución completa terminó en un máximo de 115 segundos; casos no iniciados por presupuesto aparecen como `BLOCKED/TIME_BUDGET`, no como fallidos.
