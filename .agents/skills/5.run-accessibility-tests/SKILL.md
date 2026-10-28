---
name: run-accessibility-tests
description: Audita accesibilidad WCAG 2.1 AA con axe-core y comprobaciones manuales usando exclusivamente MCP Playwright.
compatibility:
  gemini: ">=2.5.0"
metadata:
  version: 1.2.0
  author: Gemini
allowed-tools: "MCP Playwright"
---
# Habilidad: Ejecutar Pruebas de Accesibilidad

> **Condicional:** Esta habilidad solo se ejecuta si `run-accessibility-tests` está listado en el arreglo `selectedSkills` del archivo `{story-id}-plan.json`.
> **Restricción:** Usa únicamente capacidades de MCP Playwright para navegar, inyectar axe-core, inspeccionar la página y recopilar resultados. No uses shell, scripts locales, paquetes instalados ni herramientas externas. No modifiques el contenido de la página ni envíes formularios de negocio; la navegación con teclado se limita a mover el foco.

## Cuándo Usar

Usa esta habilidad para auditar la URL del ambiente indicada en el plan de pruebas contra WCAG 2.1 nivel AA. Limita la auditoría a esa URL y a los estados que puedan inspeccionarse sin cambiar datos.

## Entrada

- **Plan de Pruebas:** El archivo `{story-id}-plan.json`, que contiene la URL objetivo.

## Pasos

1.  **Configuración y Navegación**:
    -   Extrae la URL objetivo del plan de pruebas. Si falta o no es válida, registra el bloqueo y no inventes una URL.
    -   Abre Chromium mediante MCP Playwright y navega a la URL indicada. No uses `run_shell_command`, ejecución local, `@axe-core/playwright` ni herramientas fuera de MCP Playwright.
    -   Si el runner o el navegador informa que no puede comprobar el ambiente por VPN, proxy, certificado o autenticación, ofrece al usuario abrir la URL en una pestaña del navegador para que inicie sesión directamente en el portal. Pausa y continúa solo después de que el usuario confirme que terminó.
    -   Nunca solicites que comparta usuario o contraseña en el chat, nunca captures los campos de credenciales, y no guardes, registres ni transmitas credenciales al runner, al agente o a reportes. El usuario debe escribirlas directamente en el sitio de destino.
    -   Tras la confirmación, reutiliza la página/contexto de MCP Playwright donde el usuario autenticó. Si la sesión no está disponible para MCP Playwright, registra el bloqueo de autenticación y no intentes sortearlo.
    -   Registra URL final, fecha/hora, viewport y cualquier estado de autenticación o carga que limite la cobertura.

2.  **Ejecutar Auditoría Axe**:
    -   Inyecta axe-core mediante la capacidad de evaluación/inyección de scripts de MCP Playwright. La inyección agrega únicamente el motor de auditoría en memoria; no cambies contenido, atributos, estilos ni datos de la aplicación.
    -   Ejecuta las reglas `wcag21a` y `wcag21aa`. Reporta el estándar solicitado como WCAG 2.1 nivel AA; no sustituyas esa cobertura por otra versión.
    -   Ejecuta en el viewport disponible y en viewports móvil, tablet y escritorio si MCP Playwright permite cambiar el tamaño. Registra las dimensiones efectivamente examinadas.
    -   Recopila todas las `violations` y `incomplete`. No presentes `incomplete` como incumplimiento confirmado: márcalo como pendiente de revisión manual y conserva su regla, impacto, nodos, selector y motivo.
    -   Para cada problema registra ID de regla/check, impacto (`critical`, `serious`, `moderate`, `minor` o `sin clasificar`), selector, descripción clara, criterio WCAG, evidencia, sugerencia concreta para desarrollo y estado. Usa `Fallido` para incumplimientos confirmados y `Pendiente de revisión` para resultados incomplete.

3.  **Realizar Verificaciones Manuales con MCP Playwright**:
    -   Recorre el foco con `Tab` y `Shift+Tab` sin activar controles. Registra orden observado, elementos enfocables y visibilidad del foco.
    -   Busca trampas de foco con un número acotado de pulsaciones; observa si el foco queda atrapado o no puede salir de un componente. No escribas, envíes formularios ni actives controles que cambien datos. Documenta las rutas no probadas.
    -   Inspecciona la jerarquía de encabezados `h1` a `h6`, incluidos encabezados ausentes, saltos de nivel y orden confuso. Registra selector, nivel y texto cuando aplique.
    -   Comprueba que cada control de formulario tenga nombre accesible mediante etiqueta asociada, `aria-label`, `aria-labelledby` u otro mecanismo válido. Registra los controles sin nombre y una sugerencia de corrección.
    -   Mantén la auditoría en modo observacional: no modifiques el estado de la aplicación ni su contenido.

4.  **Generar Reporte**:
    -   Guarda artefactos solo en `3-outputs/run/{story-id}/accessibility/`.
    -   Genera reportes CSV separado por comas y HTML legible, agrupando problemas por severidad en orden crítico, serio, moderado y menor. Escapa correctamente comas, comillas, saltos de línea y contenido HTML.
    -   Cada registro debe incluir tipo (`violación axe`, `incomplete` o `verificación manual`), ID de regla/check, impacto, selector, descripción, criterio WCAG, evidencia, sugerencia de solución y estado (`Fallido`, `Pendiente de revisión` o `Aprobado`). No marques un incumplimiento confirmado como aprobado.
    -   Incluye resumen con conteos por impacto, violaciones, incomplete, comprobaciones manuales, viewports, limitaciones y estado global. Usa `Aprobado` solo si no quedan incumplimientos confirmados ni verificaciones bloqueantes pendientes; de lo contrario usa `Fallido` o `Bloqueado` y explica el criterio.
    -   Mantén también los reportes JSON y Markdown existentes para compatibilidad. Los cuatro formatos deben contener los mismos hallazgos y estados.
    -   Adjunta capturas solo si MCP Playwright permite capturarlas directamente y son evidencia útil; guárdalas en la misma carpeta.

## Salida

-   **Reporte JSON:** `3-outputs/run/{story-id}/accessibility/{story-id}-report.json`.
-   **Reporte Markdown:** `3-outputs/run/{story-id}/accessibility/{story-id}-report.md`.
-   **Reporte CSV:** `3-outputs/run/{story-id}/accessibility/{story-id}-report.csv`.
-   **Reporte HTML:** `3-outputs/run/{story-id}/accessibility/{story-id}-report.html`.
-   **Capturas de Pantalla:** Capturas de pantalla de cualquier elemento fallido se guardan en el mismo directorio.

## Criterios de Finalización

- ✅ Se usó exclusivamente MCP Playwright y no se modificó la página ni sus datos.
- ✅ La auditoría cubrió WCAG 2.1 AA y documentó violaciones, resultados incomplete y limitaciones.
- ✅ Se probaron Tab/Shift+Tab, trampas de foco, jerarquía de encabezados y etiquetas accesibles de formularios.
- ✅ Se generaron reportes CSV, HTML, JSON y Markdown con severidades y estados consistentes.
- ✅ El estado global distingue incumplimientos confirmados de verificaciones pendientes.

## Si Falla

| Problema | Acción |
|----------|--------|
| Página inalcanzable | Registrar el error y marcar la habilidad como OMITIDA. |
| Inyección de script Axe falla | Reintentar una vez mediante MCP Playwright. Si falla de nuevo, documentar el error y marcar la auditoría como BLOQUEADA; no usar ejecución local como alternativa. |
| Excepciones durante auditoría | Documentar excepción y viewport afectados y continuar con las comprobaciones posibles mediante MCP Playwright. |
| Autenticación requerida | No iniciar sesión ni buscar credenciales. Registrar el bloqueo y limitar la auditoría al contenido público accesible. |
