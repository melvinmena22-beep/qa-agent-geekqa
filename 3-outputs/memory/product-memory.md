# Product Memory — UniWebPro

> Última actualización: 2026-10-26 | Historia: US-79

---

## Historias Ejecutadas

| Historia | Módulo | Fecha | Veredicto | Bugs |
|----------|--------|-------|-----------|------|
| US-79 | Módulo Estudiantes — Registro | 2026-10-12 | ❌ FAIL | Bug #84 (Alta) |
| US-79 | Módulo Estudiantes — Registro | 2026-10-21 | ❌ FAIL (9/10) | Bug #87 (Alta) — #84 y #85 no reproducidos |
| US-79 | Módulo Estudiantes — Registro (funcional + a11y + Lighthouse) | 2026-10-26 | ❌ FAIL (9/10; a11y Fallido; LH 82/90/100/83) | Bug #87 (Alta) reconfirmado; sin bugs nuevos |

---

## Áreas Inestables

### Módulo de Estudiantes (`/estudiantes`)

- **Campo "Carrera" en el formulario de registro**: No es un `<input type="text">` estándar — es un elemento tipo dropdown/combobox/select customizado. Los specs que usen `.nth(2)` dentro de `div[role="dialog"] input` fallarán con timeout. Usar `getByRole('combobox')` o `selectOption()`.

- **Campo de búsqueda ambiguo**: La página contiene **dos** campos de búsqueda:
  1. Buscador global del sistema: `placeholder="Buscar en el sistema..."` (en la navbar)
  2. Buscador del módulo: `placeholder="Buscar por nombre o documento..."`
  El locator `input[placeholder*="Buscar"]` resuelve ambos en strict mode. Usar siempre el selector específico del módulo.

- **Documento duplicado → HTTP 500 sin mensaje (Bug #87, 2026-10-21)**: POST /api/estudiantes con un Número de Documento existente responde 500; el modal queda abierto sin feedback. No se crea duplicado.

- **Carrera es un <select> nativo** (opciones reales: Ingeniería de Sistemas, Administración de Empresas, Derecho, Arquitectura, Ingenieria Mecanica, Medicina, Comunicación Social, Diseño Gráfico, Ingeniería Electronica). La primera opción "Seleccione carrera" es placeholder: excluirla al elegir.

- **Formulario usa validación HTML5 required** (2026-10-21): Nombres, Apellidos, Número de Documento, Correo y Carrera son required; type=email valida "@". Los mensajes son tooltips nativos (no aparecen en capturas).

- **Sidebar se superpone al modal** en viewport ~930px (observación, sin bug).

- **Validación de formulario ausente (Bug #84 — NO reproducido el 2026-10-21)**: El formulario de Registro de Estudiantes acepta el envío con todos los campos vacíos sin mostrar mensajes de error. Defecto de integridad de datos confirmado y reproducible.

---

## Patrones de Defectos Comunes

| Patrón | Frecuencia | Área |
|--------|-----------|------|
| Selector ambiguo de búsqueda | 4 escenarios (SC_001, SC_004, SC_005, SC_008) | Módulo Estudiantes |
| Campo tipo no-input en formulario (Carrera) | 4 escenarios (SC_003, SC_007, SC_009, SC_010) | Módulo Estudiantes |
| Ausencia de validación de campos obligatorios | 1 bug confirmado (SC_006) | Módulo Estudiantes |

---

## Defectos Críticos de Accesibilidad (WCAG 2.1 AA)

- **button-name (Critical)**: Todos los botones de acción de la tabla de estudiantes (editar, eliminar por fila) y botones de la navbar no tienen texto discernible. Afecta 3 breakpoints (375px, 768px, 1440px). 85+ instancias.
- **color-contrast (Serious)**: Etiqueta "Administrador" en sidebar con contraste insuficiente (`text-slate-400` sobre fondo blanco). Solo Desktop (1440px).
- **label / select-name (Critical, 2026-10-26)**: En el modal de registro ningún `<label>` tiene `for` ni envuelve su control. Documento, Correo, Teléfono, Fecha y Dirección no tienen nombre accesible; los selects Tipo de Documento y Carrera tampoco; Nombres y Apellidos solo tienen el placeholder (falla 2.5.3).
- **Modal sin semántica de diálogo (Serious, 2026-10-26)**: el contenedor no tiene role="dialog" ni aria-modal (no existe `[role=dialog]` en el DOM); el foco no entra al modal al abrirlo (Tab recorre la tabla de fondo) y Escape no lo cierra. Locators basados en `div[role="dialog"]` no funcionan: usar el `form` del modal.
- **`<html lang="en">` con contenido en español (Serious, WCAG 3.1.1)**: axe no lo detecta; verificar manualmente.
- **button-name**: 194 nodos con 96 filas en la tabla (96 Editar + 96 Eliminar + notificaciones/ayuda; en 375px también el botón de menú `.md:hidden`).

## Rendimiento (Lighthouse 12.2.1, móvil simulado, 2026-10-26)

- Performance 82 · Accesibilidad 90 · Mejores prácticas 100 · SEO 83. FCP 3.0 s, LCP 3.7 s, TBT 20 ms, CLS 0.033, SI 4.0 s.
- Oportunidades: JS no usado ~89 KiB, preconnect ~370 ms, caché de estáticos, DOM de 2,646 nodos (tabla sin paginar). SEO: sin meta description y robots.txt inválido (14 errores).
- Lighthouse no es dependencia del proyecto; se ejecutó con `npx lighthouse@12.2.1` usando `CHROME_PATH` = Chromium de Playwright.

---

## Componentes UI Identificados

| Componente | Selector / Evidencia | Notas |
|------------|---------------------|-------|
| Botón Registrar Estudiante | Texto: "Registrar Estudiante" | Funciona correctamente (SC_002 PASS) |
| Modal/Dialog de registro | `div[role="dialog"]` | Contiene inputs de texto para Nombre, Documento, Contacto, Email |
| Campo Carrera | Dentro de `div[role="dialog"]` | **No es input de texto** — dropdown/select/combobox |
| Buscador del módulo | `input[placeholder="Buscar por nombre o documento..."]` | Usar este selector específico |
| Buscador global | `input[placeholder="Buscar en el sistema..."]` | Navbar — no usar en tests del módulo Estudiantes |
| Tabla de resultados | Tabla con filas de estudiantes | Botones de editar/eliminar por fila sin aria-label |

---

## Bugs en Azure DevOps

| Bug ID | AzDO ID | Título | Severidad | Historia | Estado |
|--------|---------|--------|-----------|---------|--------|
| BUG-US79-01 | [#84](https://dev.azure.com/GSID-Autogestion/9a29ac17-af10-48ab-88cd-1a7193a3900a/_workitems/edit/84) | Formulario de Registro permite guardar con campos vacíos sin validación | Alta | US-79 | Activo |
| BUG-US-79-02 | [#87](https://dev.azure.com/GSID-Autogestion/9a29ac17-af10-48ab-88cd-1a7193a3900a/_workitems/edit/87) | Documento duplicado devuelve HTTP 500 sin mensaje de duplicidad | Alta | US-79 | New |

---

## SIDERA — Módulo Licitaciones / Quick Event (US-88)

- **URL QA:** https://sideraqa.gruposid.com.do/home → redirige a `/login?callbackUrl=...` (SSO corporativo y "Acceso para proveedores"). Sin sesión SSO (storage state de comprador/proveedor) no es posible auditar ni probar el módulo; las corridas sin sesión quedan `BLOCKED/AUTH` o `BLOCKED/CREDENTIALS`.
- **Accesibilidad página de acceso (2026-10-22):** axe-core 4.10.2 WCAG 2.1 AA sin violaciones en 375/768/1440. Hallazgo manual A11Y-06 (moderate, WCAG 1.4.11): los botones suprimen el outline y el foco solo muestra `box-shadow rgba(0,70,139,0.18) 0 0 0 3px` (contraste 1.37:1). Revisar el mismo patrón en componentes compartidos.
- **Página de acceso:** h1 "Bienvenido a SIDERA", lang `es-DO`, landmarks main/header/footer, sin campos de formulario; `/favicon.ico` devuelve 404.
