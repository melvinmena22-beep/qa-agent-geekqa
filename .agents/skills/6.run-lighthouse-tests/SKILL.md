---
name: run-lighthouse-tests
description: Ejecuta una auditoría Lighthouse para rendimiento, accesibilidad, buenas prácticas y SEO, con varias corridas y umbrales de aprobación.
compatibility:
  gemini: ">=2.5.0"
metadata:
  version: 2.0.0
  author: Gemini
allowed-tools: "MCP Playwright, run_shell_command (solo npx -y lighthouse@12.2.1)"
---
# Habilidad: Ejecutar Pruebas Lighthouse

> **Condicional:** Esta habilidad solo se ejecuta si `run-lighthouse-tests` está listado en el arreglo `selectedSkills` del archivo `{story-id}-plan.json`.

## Cuándo Usar

Usa esta habilidad para auditar una página web en rendimiento, accesibilidad, buenas prácticas y SEO, con un resultado PASS o FAIL según umbrales definidos.

## Entrada

- **Plan de Pruebas:** El archivo `{story-id}-plan.json`, que contiene la URL objetivo y, opcionalmente, `performanceBudgets`.

## Reglas

- Usa siempre la versión fijada: `npx -y lighthouse@12.2.1`. No uses `lighthouse` sin versión ni `@latest`: los puntajes cambian entre versiones y dejarían de ser comparables.
- Una sola corrida no es fiable (el puntaje de rendimiento varía varios puntos entre corridas). Haz **3 corridas por dispositivo** y usa la **mediana**.
- Audita dos dispositivos: `mobile` (configuración por defecto) y `desktop` (`--preset=desktop`).
- Si la página exige login, Lighthouse no puede reutilizar la sesión del runner: registra `BLOCKED/AUTH_REQUIRED` en el resumen y no audites la pantalla de login en su lugar.
- El agente corre sin nadie delante: no pidas confirmaciones al usuario.

## Umbrales (performanceBudgets)

Si el plan no define `performanceBudgets`, usa estos mínimos sobre la mediana (puntaje de 0 a 1):

| Categoría | Mínimo |
|---|---|
| performance | 0.80 |
| accessibility | 0.90 |
| best-practices | 0.90 |
| seo | 0.80 |

Una categoría por debajo del mínimo en cualquier dispositivo hace que el estado global sea `FAIL`.

## Pasos

1.  **Preparación**:
    -   Extrae la URL objetivo del plan. Si falta o no es válida, registra el bloqueo y no inventes una URL.
    -   Crea `3-outputs/run/{story-id}/lighthouse/raw/`. Todos los archivos, incluidos temporales, van dentro de `3-outputs/run/{story-id}/lighthouse/`.

2.  **Corridas** (3 por dispositivo):
    -   Mobile: `npx -y lighthouse@12.2.1 {url} --quiet --chrome-flags="--headless=new" --output=json --output=html --output-path=3-outputs/run/{story-id}/lighthouse/raw/{story-id}-mobile-run{n}`
    -   Desktop: el mismo comando con `--preset=desktop` y el nombre `{story-id}-desktop-run{n}`.
    -   Si una corrida falla, reintenta una vez; si vuelve a fallar, registra el error y continúa con las demás.

3.  **Consolidar**:
    -   Por dispositivo, calcula la mediana de cada categoría y elige como corrida representativa la de rendimiento mediano.
    -   Compara cada mediana con su umbral.
    -   Escribe el resumen `{story-id}-lighthouse.json`. El reporte final enlaza el HTML de la corrida representativa (`raw/{story-id}-mobile-run{n}.report.html`); no copies archivos con la shell.

## Salida

-   **Resumen:** `3-outputs/run/{story-id}/lighthouse/{story-id}-lighthouse.json`, con este formato:

```json
{
  "storyId": "US-79",
  "url": "https://...",
  "lighthouseVersion": "12.2.1",
  "runsPerDevice": 3,
  "budgets": { "performance": 0.8, "accessibility": 0.9, "best-practices": 0.9, "seo": 0.8 },
  "devices": {
    "mobile": {
      "median": { "performance": 0.82, "accessibility": 0.9, "best-practices": 1, "seo": 0.83 },
      "runs": [{ "file": "raw/US-79-mobile-run1.report.json", "performance": 0.8 }],
      "representativeRun": "raw/US-79-mobile-run2.report.json",
      "failedCategories": []
    },
    "desktop": { "median": {}, "runs": [], "representativeRun": null, "failedCategories": [] }
  },
  "status": "PASS | FAIL | BLOCKED",
  "reason": null
}
```

-   **Corridas crudas (JSON y HTML):** `3-outputs/run/{story-id}/lighthouse/raw/`; el HTML de referencia es el de `representativeRun`.

## Criterios de Finalización

- ✅ Se completaron 3 corridas por dispositivo (o se registró por qué no).
- ✅ `{story-id}-lighthouse.json` contiene las medianas, los umbrales y el estado PASS/FAIL.
- ✅ El reporte final cita las medianas, no una corrida aislada.

## Si Falla

| Problema | Acción |
|----------|--------|
| `npx` no puede descargar Lighthouse | Registrar `BLOCKED/ENVIRONMENT` con el error y detener la habilidad. |
| No hay Chrome instalado | Registrar `BLOCKED/ENVIRONMENT` e indicar que se instale Chrome o se defina `CHROME_PATH`. |
| Página inalcanzable | Registrar el error y marcar la habilidad como `BLOCKED`. |
| La página exige login | Registrar `BLOCKED/AUTH_REQUIRED`; no auditar la pantalla de login como si fuera la funcionalidad. |
