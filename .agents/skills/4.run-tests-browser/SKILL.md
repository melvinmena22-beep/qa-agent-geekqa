---
name: run-tests-browser
description: Ejecuta pruebas de navegación en navegador con todas las interacciones usando MCP Playwright.
compatibility:
  gemini: ">=2.5.0"
metadata:
    version: 1.1.0
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
- Respeta exactamente `selectedScenarioIds`, `selectedBrowsers` y `selectedTestTypes` del plan. No infieras valores faltantes.
- Usa solo los navegadores seleccionados; si no hay ninguno definido, usa Chromium. No recorras todos los servidores MCP configurados.
- Usa las herramientas MCP Playwright disponibles en la sesión. Si falta una capacidad necesaria, marca el caso `BLOCKED` y registra cuál falta; no la sustituyas por shell.
- Reutiliza la sesión autenticada por el usuario. No solicites ni inventes credenciales; sin sesión, registra `BLOCKED/AUTH_REQUIRED`.

## Entrada

- **Plan de Pruebas:** El archivo `{story-id}-plan.json`, que contiene la URL objetivo y otro contexto.
- **Escenarios de Prueba:** El archivo `{story-id}-plan.json`, que contiene los casos de prueba detallados.
- **Historia de Usuario:** El archivo de historia de usuario que contiene la URL y descripción de la característica a probar.

## Pasos

### Presupuesto estricto de ejecución

- El skill completo debe finalizar en un máximo de **115 segundos** desde la primera navegación; reserva los últimos 15 segundos para guardar capturas, JSON y el resumen. No excedas nunca 120 segundos.
- Usa un único navegador salvo que el usuario o el plan haya seleccionado explícitamente varios. Antes de ejecutar, calcula el presupuesto por caso según escenarios y navegadores seleccionados; distribúyelo para completar la navegación, los casos y las capturas dentro de los primeros 100 segundos.
- Limita cada navegación a 10 segundos, cada acción a 3 segundos y cada aserción a 2.5 segundos. No uses esperas fijas (`waitForTimeout`) ni esperes `networkidle`; usa `domcontentloaded` y espera únicamente el control o estado requerido.
- No reintentes automáticamente un caso. Si el presupuesto restante no alcanza para ejecutar y capturar el siguiente caso, detén la ejecución, registra los casos pendientes como `BLOCKED` con motivo `TIME_BUDGET`, y genera el reporte dentro del tiempo reservado. Un límite de tiempo no es un fallo funcional ni debe crear un bug.
- Prioriza los casos seleccionados en el orden del plan. Evita acciones redundantes, volver a navegar al mismo host si la sesión/página se puede reutilizar y explorar elementos que no forman parte del escenario.

1.  **Configuración y Navegación**:
    -   Extrae la URL objetivo de la historia de usuario o plan de pruebas.
    -   Abre únicamente los navegadores seleccionados; si no hay selección, usa Chromium.
    -   Navega con un límite de 10 segundos y espera solo el control requerido, nunca `networkidle`.

2.  **Autenticación**:
    -   Reutiliza la sesión autenticada por el usuario. Sin sesión disponible, registra `BLOCKED/AUTH_REQUIRED` y detén los casos que la requieran.

3.  **Análisis Inicial de Página**:
    -   **Analizar Animaciones:** No esperes pausas fijas. Espera un selector o estado estable concreto con el presupuesto de aserción indicado.
    -   **Errores de consola:** Registra los errores reproducibles relacionados con el escenario. No marques fallos por mensajes no relacionados con el resultado esperado.

4.  **Ejecutar Escenarios de Prueba**:
    -   Lee y analiza el archivo `{story-id}-plan.json`.
    -   Ejecuta exclusivamente los escenarios enumerados en `selectedScenarioIds`. No ejecutes otros; registra cuántos quedaron omitidos.
    -   Si un escenario tiene `clarificationRequired: true`, no afirmes como defecto el resultado de una regla no aprobada. Márcalo `BLOCKED/CLARIFICATION_REQUIRED` y explica la pregunta pendiente; solo ejecuta observaciones que no dependan de esa regla y no generes un bug por una expectativa asumida.
    -   Para cada escenario de prueba:
        -   Registra el ID del escenario antes de ejecutarlo y realiza sus pasos en el orden definido.
        -   Usa timeout máximo de 3 segundos por acción y 2.5 segundos por aserción. Espera solo el cambio de UI que valida el paso; no combines `networkidle`, `waitForTimeout` y esperas de selector para la misma interacción.
        -   Antes de interactuar, usa un locator específico que coincida con exactamente un elemento. Prioriza rol y nombre accesible exactos; si faltan, inspecciona el DOM y usa el atributo o contenedor visible más específico.
        -   No uses texto parcial genérico, `nth()` ni roles que no hayas comprobado. Si el locator encuentra cero o varios elementos, inspecciona y corrígelo antes de seguir.
        -   Opera los elementos `<select>` con `selectOption`; nunca uses `fill` en una lista desplegable.
        -   Para specs Playwright ejecutables, fija un timeout máximo de 12 segundos por caso en suites de hasta 10 escenarios; configura además `globalTimeout` en 105 segundos para detener la suite antes de dos minutos. Si el timeout global impide iniciar casos restantes, regístralos como `BLOCKED/TIME_BUDGET`, no como fallos. La suma de casos seleccionados y navegadores nunca debe superar el presupuesto total del skill.
        -   Captura una screenshot de página completa al terminar cada escenario ejecutado, tanto si pasa como si falla. En caso de fallo, captura también inmediatamente después del error y antes de continuar o cerrar el navegador.
        -   Guarda las capturas en `3-outputs/run/{story-id}/execution/screenshots/` con nombres estables que incluyan el ID del escenario y, si aplica, navegador e intento (por ejemplo, `SC_001-chromium-attempt-1.png`). No reemplaces evidencia de intentos anteriores.
        -   En `execution-report.json`, agrega a cada resultado un arreglo `screenshots` con la ruta relativa desde el directorio de la historia, el navegador, el intento y una leyenda que indique el ID del caso y si es evidencia final o de fallo. Cada escenario ejecutado debe tener al menos una captura; cada fallo debe tener una captura tomada en el momento del error.

5.  **Generar Reporte**:
    -   Todos los archivos temporales y evidencia deben crearse dentro del directorio `3-outputs/run/{story-id}/execution/`.
    -   Crea un archivo único `execution-report.json` resumiendo los resultados (acciones realizadas, hallazgos, estado de cada caso de prueba) y enlazando a evidencia capturada.
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
