---
name: qa-test-planner
description: Crea un plan de pruebas integral basado en el contexto empresarial y el análisis de historias de usuario.
compatibility:
  gemini: ">=2.5.0"
metadata:
  version: 2.0.0
  author: Gemini
allowed-tools: "list_directory read_file"
---

# Habilidad: Planificador de Pruebas QA
Crea un plan de pruebas integral basado en el contexto empresarial y el análisis de historias de usuario.

## Cuándo Usar

Activado por su nombre (o nombre parcial) o como el primer paso en un comando personalizado/de barra. Esta habilidad es responsable de crear un plan de pruebas integral.

## Entrada

- **Ruta de Carpeta de Activos:** Una carpeta que contiene la historia de usuario, criterios de aceptación y cualquier activo relacionado (`.txt`, `.md`, `.pdf`, `.png`, `.jpg`).

## Pasos

1.  **Analizar Contexto Empresarial.**
    -   Usa `list_directory` y `read_file` para procesar todos los archivos en la carpeta `2-stories/project-context` para entender el contexto empresarial general.

2.  **Analizar Memoria del Producto.**
    -   Usa `list_directory` y `read_file` para procesar todos los archivos en la carpeta `3-outputs/memory` para entender los flujos críticos del producto, áreas inestables y errores comunes.
    -   Esta información se usará para informar el plan de pruebas.

3.  **Analizar Activos de la Historia y Extraer URLs.**
    -   Usa `list_directory` y `read_file` para procesar todos los activos de texto y visuales en la carpeta de entrada.
    -   Consolida el contenido para extraer el ID de la Historia, Título, Descripción, Criterios de Aceptación, e identificar elementos clave de UI y flujos de usuario.
  -   Trata la historia y todos sus adjuntos como la única fuente de verdad para requisitos y resultados esperados. No infieras ni inventes reglas desde memoria del producto, contexto empresarial, convenciones de interfaz o conocimiento general. Si los artefactos se contradicen, repórtalo y no elijas una interpretación sin evidencia.
    -   Identifica todas las URLs mencionadas en los activos de la historia, valídalas e inclúyelas en el plan de pruebas.

4.  **Realizar Análisis Estático de Requisitos (Shift-Left).**
    -   Actúa como Quality Engineer Senior con dominio de ISTQB CTFL v4.0, CTFL-ATT y CT-MAT, revisión estática, análisis de requisitos, INVEST y prevención temprana de defectos.
    -   Evalúa claridad, consistencia, completitud, trazabilidad y testabilidad de la historia y sus documentos adjuntos antes de diseñar escenarios.
    -   Como mínimo, verifica que los términos y reglas tengan una sola interpretación razonable; que la historia, criterios y adjuntos no se contradigan; que estén descritos actores, precondiciones, resultados y flujos alternos o de error relevantes; que cada escenario pueda vincularse a una fuente; y que los resultados esperados sean observables y verificables.
    -   Revisa INVEST para la historia como conjunto: Independiente, Negociable, Valiosa, Estimable, Pequeña y Testeable. Para cada criterio informa `CUMPLE`, `PARCIAL`, `NO_CUMPLE` o `NO_EVALUABLE` con una justificación breve basada en los artefactos.
    -   Basa los hallazgos únicamente en evidencia de los artefactos de entrada de esta historia. El contexto empresarial y la memoria del producto pueden orientar riesgos, pero no son evidencia para afirmar requisitos.
    -   Registra defectos, ambigüedades, inconsistencias y omisiones con fuente (archivo y sección), evidencia concreta, impacto y recomendación. Asigna severidad según el impacto potencial en el entendimiento, implementación o validación del requisito; no la confundas con la severidad de ejecución de un caso. Distingue lo confirmado de supuestos y preguntas pendientes; no inventes reglas.
    -   Formula preguntas abiertas concretas para resolver requisitos ambiguos o incompletos. No bloquees el análisis cuando la respuesta no esté disponible: registra la incertidumbre y marca como dependiente cualquier escenario afectado.
    -   Como entregable de validación de la historia, identifica exactamente 5 posibles ambigüedades o puntos ciegos y redáctalos como preguntas concretas que un desarrollador necesitaría resolver. Para cada pregunta incluye referencia al archivo/sección o criterio, evidencia, impacto de no resolverla y si bloquea la definición del resultado esperado. Basa las preguntas en vacíos, términos vagos, reglas incompletas, actores, estados, datos, permisos, errores o límites que realmente aparezcan o falten en la historia; no presentes una suposición como hecho.
    -   Genera exactamente 10 escenarios diversos de validación de requisitos, cubriendo casos positivos, negativos y de borde cuando sean aplicables. Incluye acciones reproducibles, datos/precondiciones y un resultado observable. Cada escenario debe trazar a criterios existentes o a una de las ambigüedades identificadas. Si el resultado depende de una respuesta pendiente, marca `clarificationRequired: true` y expresa el resultado como pendiente de aclaración; no inventes comportamiento para completar la cuota. Distingue explícitamente los escenarios bloqueados de los ejecutables.
    -   Propón exactamente 5 criterios de aceptación nuevos o refinados, claros, medibles y verificables, orientados a cerrar las ambigüedades. Cada propuesta debe referenciar las preguntas que resuelve y explicar cómo se mide. Márcalos siempre como `proposed` / `Pendiente de aprobación`: no los agregues a los requisitos fuente, no los uses como resultado esperado confirmado y no reemplaces los criterios existentes. Si una propuesta necesita una decisión de negocio, conserva esa decisión como variable explícita o pregunta abierta en vez de escoger un valor arbitrario.
    -   Si la historia falta, está vacía o contiene solo un placeholder (por ejemplo, `****`), no fabriques cinco preguntas, diez escenarios específicos ni cinco criterios. Registra `NO_TESTEABLE`, explica que falta la historia y solicita el contenido real. Puedes conservar los arreglos vacíos y enumerar la limitación, pero no simules haber completado los conteos.
    -   Usa `APTO_CON_OBSERVACIONES` cuando los requisitos sean verificables y no haya aclaraciones que impidan diseñar casos; `REQUIERE_ACLARACIONES` cuando existan preguntas o ambigüedades que cambien resultados esperados; y `NO_TESTEABLE` cuando falte información esencial para definir resultados observables. Explica siempre el dictamen en `summary`.
    -   Si no hay hallazgos, indícalo explícitamente junto con cualquier limitación del análisis.

5.  **Analizar y Asociar Activos.**
    -   Usando las capacidades multimodales de Gemini, analiza los activos (imágenes, PDFs, etc.) y asócialos con la historia de usuario por su nombre o contenido.
    -   Para cada activo, genera un objeto con su `name`, `path`, y `relation` a la historia de usuario.
    -   Esta información se usará para poblar la sección 'Activos Analizados' del plan de pruebas.

6.  **Definir Estrategia de Pruebas y Seleccionar Habilidades.**
    -   Basado en el contexto empresarial, la historia de usuario y el análisis de contenido de URL, realiza un análisis de riesgo (ISTQB) para determinar los tipos de pruebas necesarios (ej. funcional, accesibilidad, visual, analíticas).
    -   Para cada tipo de prueba requerido, agrega el nombre de la habilidad correspondiente a una lista `selectedSkills`. Proporciona una breve justificación para cada selección.
    -   **Determinar Estrategia de Navegador**: Decide si probar en múltiples motores de navegador (Chromium, Firefox, Webkit) basado en el tipo de historia, riesgo (ej. UI compleja, dependencias de estilo), y contexto del proyecto. Por defecto a `["chromium"]` si no se encuentran elementos de UI de alto riesgo.
    -   La justificación debe ser detallada y alineada con el conocimiento del agente de la historia de usuario y contexto del proyecto.
    -   Las habilidades `log-results` deben siempre incluirse.
    -   **Definir Skills Condicionales**: Configura `conditionalSkills` para skills que se ejecutan solo bajo ciertas condiciones:
        - `report-bugs`: Se ejecuta automáticamente si `run-tests-browser` encuentra fallos
        - Otros skills condicionales pueden agregarse según necesidad

7.  **Generar Escenarios de Prueba.**
    -   Basado en la historia de usuario, criterios de aceptación y activos analizados, genera una lista de escenarios de prueba.
    -   Deriva escenarios solo de requisitos verificables. Incluye `requirementRefs` con los criterios o fuentes que cubre cada escenario; usa `clarificationRequired` cuando un escenario dependa de una ambigüedad y no presentes el comportamiento supuesto como confirmado.
    -   Para este entregable de validación genera exactamente 10 escenarios diversos. Cubre con ellos todos los criterios existentes y comportamientos verificables; usa un escenario para varios criterios cuando sea coherente, y distribuye casos positivos, negativos y de borde según aplique. Incluye datos inválidos o ausentes, límites, permisos, estados e integración solo cuando estén sustentados por los requisitos o por un riesgo trazable. Si los 10 casos no pueden cubrir la especificación sin inventar comportamiento, registra el vacío y marca los casos dependientes para aclaración.
    -   Cada escenario debe incluir obligatoriamente `testPolarity` con el valor `Positivo` o `Negativo`. Un caso positivo verifica el comportamiento esperado con condiciones válidas; un caso negativo verifica el rechazo, control o resultado definido ante una condición inválida o no permitida. Si falta definición para concretar un caso, registra `clarificationRequired: true` y no inventes su resultado esperado.
    -   Antes de guardar el plan, verifica cobertura: cada criterio tiene escenarios trazados y la suite incluye casos positivos y negativos siempre que la especificación ofrezca comportamientos aplicables de ambos tipos. Si una polaridad no aplica, documéntalo en `coverageNotes`. Conserva exactamente los 10 escenarios de análisis solicitados; cuando uno dependa de una respuesta pendiente, márcalo `clarificationRequired: true`, deja el resultado esperado pendiente y no lo presentes como ejecutable ni inventes una regla.
    -   Registra vacíos y ambigüedades en `ambiguitiesAndAssumptions`: describe el vacío, indica supuestos mínimos y verificables, y marca si el caso depende de una aclaración. Un supuesto nunca se convierte silenciosamente en requisito ni en resultado esperado.
    -   Cada escenario debe incluir un `title`, `prerequisites`, `steps` secuenciales y `expectedResult`. El `title` describe la prueba sin IDs ni prefijos numerados; si se requiere numeración interna, muéstrala como `Caso #1` fuera del título.
    -   Escribe pasos precisos, observables y verificables, con lenguaje profesional, directo, asertivo y sin adornos. Deben ser reproducibles por cualquier QA, independientemente de su seniority, sin conocimiento tácito: especifica navegación, acciones, datos y comprobaciones necesarias. Evita pasos vagos, acciones compuestas innecesarias y redundancia. Si incluyes `description` además de `steps`, úsalo solo como resumen breve que no repita las acciones.
    -   Mantén el setup común en `prerequisites`. Si un caso reutiliza preparación o pasos de otro caso, referencia el otro por su título exacto en `prerequisites`; no dupliques los pasos ni dependas solo de un ID.
    -   Clasifica cada escenario con `testType` (por ejemplo, Funcional, Validación de datos, Integración, Compatibilidad, Rendimiento o Seguridad), `severity` (Crítica, Alta, Media o Baja según el impacto potencial de que falle el caso) y `severityRationale` (justificación breve). La severidad del caso expresa riesgo/impacto de la funcionalidad, no un defecto observado.
    -   Los escenarios deben cubrir requisitos funcionales, comportamiento UI/UX, y casos extremos potenciales.
    -   Incluye `testTechniques` en el JSON. Selecciona y justifica, según los requisitos verificables y sus riesgos, las técnicas pertinentes: análisis de valores límite, particionamiento en clases de equivalencia, transición de estados, tablas de decisión, adivinación de errores u otras técnicas modernas apropiadas (por ejemplo, pruebas basadas en propiedades o combinatorias). No fuerces técnicas ni derives reglas no documentadas.
    -   Incluye `projectName` con el nombre funcional del producto/proyecto bajo prueba; no lo infieras del nombre de otra historia ni de una plantilla fija.
    -   Cuando sea útil, incluye `technique` en cada escenario para trazar la técnica aplicada.
    -   Sigue las mejores prácticas descritas en `references/test-case-best-practices.md`.
    -   Antes de entregar, confirma que la suite cubra explícitamente positivos, negativos y edge cases aplicables, que todos los casos tengan trazabilidad a criterios de aceptación, que los vacíos estén identificados en `Ambigüedades y supuestos`, y que ningún título incluya IDs.

8.  **Generar Archivos del Plan de Pruebas.**
    -   Produce un reporte HTML detallado (`-plan.html`) usando la plantilla en la carpeta `templates`, incluyendo las técnicas ISTQB justificadas y los escenarios de prueba generados. Cada fila de escenario debe mostrar el valor `testPolarity` junto con su ID, descripción, tipo de prueba y criterios cubiertos.
    -   El HTML debe mostrar la evaluación INVEST, el resumen del análisis estático, sus hallazgos, preguntas abiertas y limitaciones antes de los escenarios. Mapea `staticAnalysis` a `{{static_analysis_assessment}}`, `{{static_analysis_summary}}`, `{{static_analysis_invest}}`, `{{static_analysis_findings}}`, `{{static_analysis_questions}}` y `{{static_analysis_limitations}}` en la plantilla. Genera filas HTML para los hallazgos escapando el contenido; si no hay hallazgos, preguntas o limitaciones, presenta explícitamente ese estado en vez de dejar la sección vacía.
    -   Genera un archivo de metadatos JSON (`-plan.json`) que contiene `staticAnalysis` (con `summary`, `overallAssessment`, `investAssessment`, `findings`, `openQuestions`, `limitations`, `ambiguityQuestions` y `proposedAcceptanceCriteria`), los arreglos `selectedSkills` y `testScenarios`, y cualquier otra información clave para habilidades posteriores. `testScenarios` contiene los 10 escenarios de validación cuando hay una historia suficiente para evaluarlos. Cada hallazgo incluye `id`, `category`, `severity`, `source`, `evidence`, `impact` y `recommendation`.
    -   El HTML debe incluir secciones explícitas de preguntas de ambigüedad/puntos ciegos y criterios de aceptación propuestos, indicando que estos últimos requieren aprobación y no son requisitos vigentes. Mapea `staticAnalysis.ambiguityQuestions` a `{{static_analysis_ambiguity_questions}}` y `staticAnalysis.proposedAcceptanceCriteria` a `{{static_analysis_proposed_acceptance_criteria}}`; genera filas o listas HTML con contenido escapado e indica explícitamente cuando no haya datos por falta de historia.

## Habilidades Disponibles para el Plan de Pruebas
Cuando selecciones habilidades para el plan de pruebas, elige de la siguiente lista:
- `run-tests-browser`
- `run-accessibility-tests`
- `run-lighthouse-tests`
- `generate-automated-tests`

## Salida

- **Plan de Pruebas HTML:** `3-outputs/run/{story-id}/planning/{story-id}-plan.html`
- **Metadatos JSON:** `3-outputs/run/{story-id}/planning/{story-id}-plan.json` (Este archivo impulsa la ejecución condicional de habilidades posteriores. Debe incluir arreglos `selectedSkills`, `conditionalSkills`, `testScenarios`, y cualquier otra información clave para habilidades posteriores).

## Criterios de Finalización

- ✅ Un plan de pruebas HTML es generado desde la plantilla.
- ✅ El plan documenta el análisis estático y la revisión INVEST, incluso cuando no hay hallazgos.
- ✅ Cuando la historia es suficiente, el plan contiene 5 preguntas de ambigüedad, 10 escenarios de validación y 5 criterios de aceptación propuestos, claramente marcados como pendientes de aprobación.
- ✅ Si falta la historia o solo hay un placeholder, el plan indica `NO_TESTEABLE` y solicita la historia real sin fabricar esos entregables.
- ✅ Un archivo `plan.json` con arreglos `selectedSkills` y `testScenarios` es creado.
- ✅ Ambos archivos son guardados en la carpeta de planificación correcta.

## Si Falla

| Problema | Acción |
|----------|--------|
| Activos de historia ilegibles | Solicita al usuario la ruta correcta y reintenta. |
| Ninguna habilidad parece aplicable | Por defecto a `["run-tests-browser", "log-results"]` y documenta la razón. |
| Error de escritura de salida | Verifica que el directorio de salida existe y es escribible. |
| Contexto empresarial no encontrado | Continúa con el análisis de la historia de usuario y documenta el contexto faltante en el plan. |

## Notas Importantes

### Para el Orquestador

El archivo `{story-id}-plan.json` DEBE tener esta estructura mínima para que el orquestador funcione:

```json
{
  "storyId": "US_001",
  "projectName": "Nombre del Proyecto",
  "url": "https://example.com",
  "selectedSkills": [
    "run-tests-browser",
    "run-accessibility-tests",
    "log-results"
  ],
  "conditionalSkills": {
    "report-bugs": {
      "condition": "run-tests-browser has failures",
      "dependsOn": "run-tests-browser",
      "description": "Genera reportes de bugs si se encuentran fallos en las pruebas funcionales"
    }
  },
  "selectedBrowsers": ["chromium"],
  "testTechniques": [
    { "name": "Particionamiento en clases de equivalencia", "justification": "Agrupa entradas válidas e inválidas con el mismo comportamiento esperado." }
  ],
  "testScenarios": [
    {
      "id": "SC_001",
      "title": "Descripción del escenario",
      "description": "Pasos detallados...",
      "testPolarity": "Positivo|Negativo",
      "requirementRefs": ["CA-01"],
      "clarificationRequired": false,
      "prerequisites": ["Setup necesario o referencia por título a otro caso"],
      "ambiguitiesAndAssumptions": ["Ninguno"],
      "steps": ["Acción precisa, secuencial y verificable"],
      "expectedResult": "Resultado observable autorizado por CA-01.",
      "testType": "Funcional",
      "severity": "Media",
      "severityRationale": "Impacto potencial si falla el comportamiento...",
      "technique": "Técnica aplicada y justificación, cuando corresponda"
    }
  ],
  "coverageNotes": [],
  "staticAnalysis": {
    "summary": "Resumen ejecutivo de la revisión estática.",
    "overallAssessment": "APTO_CON_OBSERVACIONES|REQUIERE_ACLARACIONES|NO_TESTEABLE",
    "investAssessment": {
      "overall": "CUMPLE|PARCIAL|NO_CUMPLE|NO_EVALUABLE",
      "criteria": {
        "independent": { "status": "CUMPLE|PARCIAL|NO_CUMPLE|NO_EVALUABLE", "notes": "..." },
        "negotiable": { "status": "CUMPLE|PARCIAL|NO_CUMPLE|NO_EVALUABLE", "notes": "..." },
        "valuable": { "status": "CUMPLE|PARCIAL|NO_CUMPLE|NO_EVALUABLE", "notes": "..." },
        "estimable": { "status": "CUMPLE|PARCIAL|NO_CUMPLE|NO_EVALUABLE", "notes": "..." },
        "small": { "status": "CUMPLE|PARCIAL|NO_CUMPLE|NO_EVALUABLE", "notes": "..." },
        "testable": { "status": "CUMPLE|PARCIAL|NO_CUMPLE|NO_EVALUABLE", "notes": "..." }
      }
    },
    "findings": [
      {
        "id": "REQ-001",
        "category": "Ambigüedad|Omisión|Inconsistencia|Claridad|Trazabilidad|Testabilidad",
        "severity": "Crítica|Alta|Media|Baja",
        "source": "historia.md, sección Criterios de aceptación",
        "evidence": "Fragmento o descripción precisa de la evidencia.",
        "impact": "Riesgo de interpretación o defecto resultante.",
        "recommendation": "Pregunta o cambio recomendado para resolverlo."
      }
    ],
    "openQuestions": ["¿Cuál es el resultado esperado cuando...?"],
    "ambiguityQuestions": [
      {
        "id": "AMB-001",
        "question": "¿Qué resultado debe observarse cuando...?",
        "source": "historia.md, sección Criterios de aceptación",
        "evidence": "Descripción concreta del vacío detectado o del término ambiguo.",
        "impact": "Cómo afecta el desarrollo, la prueba o el resultado esperado.",
        "blocksExpectedResult": true
      }
    ],
    "proposedAcceptanceCriteria": [
      {
        "id": "PROP-CA-001",
        "criterion": "Dado ..., cuando ..., entonces ... dentro de una medida verificable.",
        "measure": "Métrica, límite o condición observable; no inventar un valor de negocio.",
        "resolvesAmbiguityRefs": ["AMB-001"],
        "status": "Pendiente de aprobación"
      }
    ],
    "limitations": []
  },
  "riskAnalysis": {
    "overallRisk": "HIGH|MEDIUM|LOW",
    "justification": "..."
  }
}
```

**El orquestador ejecutará:**
1. **Skills Iniciales**: Los listados en `selectedSkills`
2. **Skills Condicionales**: Solo si se cumplen las condiciones especificadas en `conditionalSkills`
3. **Siempre**: `log-results` al final para consolidar resultados

