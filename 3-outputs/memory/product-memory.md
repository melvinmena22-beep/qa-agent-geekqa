# Product Memory — UniWebPro

> Última actualización: 2026-10-12 | Historia: US-79

---

## Historias Ejecutadas

| Historia | Módulo | Fecha | Veredicto | Bugs |
|----------|--------|-------|-----------|------|
| US-79 | Módulo Estudiantes — Registro | 2026-10-12 | ❌ FAIL | Bug #84 (Alta) |

---

## Áreas Inestables

### Módulo de Estudiantes (`/estudiantes`)

- **Campo "Carrera" en el formulario de registro**: No es un `<input type="text">` estándar — es un elemento tipo dropdown/combobox/select customizado. Los specs que usen `.nth(2)` dentro de `div[role="dialog"] input` fallarán con timeout. Usar `getByRole('combobox')` o `selectOption()`.

- **Campo de búsqueda ambiguo**: La página contiene **dos** campos de búsqueda:
  1. Buscador global del sistema: `placeholder="Buscar en el sistema..."` (en la navbar)
  2. Buscador del módulo: `placeholder="Buscar por nombre o documento..."`
  El locator `input[placeholder*="Buscar"]` resuelve ambos en strict mode. Usar siempre el selector específico del módulo.

- **Validación de formulario ausente (Bug #84)**: El formulario de Registro de Estudiantes acepta el envío con todos los campos vacíos sin mostrar mensajes de error. Defecto de integridad de datos confirmado y reproducible.

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
