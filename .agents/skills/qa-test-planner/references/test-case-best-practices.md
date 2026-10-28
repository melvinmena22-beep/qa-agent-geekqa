# Mejores Prácticas para la Generación de Casos de Prueba

## 1. Analizar Criterios de Aceptación y Contexto Empresarial

- Trata la historia de usuario y todos sus adjuntos como la única fuente de verdad para requisitos y resultados esperados.
- No inventes requisitos ni completes vacíos con convenciones de interfaz, memoria del producto, contexto empresarial o conocimiento general.
- Si los artefactos se contradicen, registra la inconsistencia y conserva ambas evidencias sin elegir una interpretación no confirmada.
- El contexto adicional puede orientar riesgos o técnicas, pero nunca establecer por sí solo comportamiento esperado.

## 2. Seguir Mejores Prácticas de Pruebas

- No incluir casos relacionados con validación pixel-perfect o UI estática.
- Cada caso de prueba debe ser parte de un solo grupo de pruebas.
- Debes escribirlos paso a paso, estructurados y detallados.
- Los casos de prueba deben ser creados considerando los requisitos del cliente.
- Los casos de prueba deben ser precisos, claros y directos.
- Usar lenguaje asertivo al escribir los casos de prueba.
- Escribe pasos secuenciales, precisos y verificables, con una acción observable por paso y resultados esperados comprobables.
- Usa lenguaje profesional, directo y sin adornos. Redacta los pasos para que cualquier QA, sin importar su seniority, pueda reproducirlos sin conocimiento tácito.
- El título describe el objetivo del caso y no incluye IDs ni prefijos numerados. Si hace falta numerar casos, usa una etiqueta separada como `Caso #1`, fuera del título.
- No presumas resultados: cada resultado esperado debe estar autorizado por un requisito o criterio de aceptación trazable.
- Registra vacíos en `Ambigüedades y supuestos`, junto con supuestos mínimos, explícitos y verificables. Marca los casos afectados como pendientes de aclaración; no conviertas un supuesto en requisito.
- Proporciona `Prerrequisitos` claros, incluyendo el setup común y los datos/estados necesarios.
- Si reutilizas pasos o setup de otro caso, referencia el caso por su título exacto en `Prerrequisitos`; no dupliques esos pasos ni lo refieras solo por ID.
- Asegura que cada criterio de aceptación esté cubierto por uno o más casos trazables.
- Declara explícitamente la cobertura de casos positivos, negativos y edge cases aplicables; cada caso debe estar trazado a sus criterios de aceptación.
- Marca explícitamente cada vacío de información en `Ambigüedades y supuestos`. Registra supuestos solo cuando sean mínimos y verificables; si no existe ninguno, indica `Ninguno`.
- Mantén cada caso dentro de un solo grupo de pruebas y evita redundancias.
- Cuando sea necesario, si los casos de prueba son parte de un flujo, agruparlos en un caso de prueba con múltiples resultados esperados por paso.

## 3. Incluir Técnicas de Pruebas

Incluir Técnicas de Pruebas según la complejidad de la historia de usuario.
- Análisis de Valores Límite
- Particionamiento en Clases de Equivalencia
- Técnicas de Transición de Estados
- Tablas de Decisión
- Técnica de Adivinación de Errores

Selecciona las técnicas que aporten cobertura al requisito y registra su justificación en `testTechniques` del plan JSON. Aplica, según corresponda, Análisis de Valores Límite, Particiones de Equivalencia, Transición de Estados, Tablas de Decisión, Error Guessing u otras técnicas de pruebas modernas apropiadas. Asocia la técnica al escenario mediante `technique` cuando corresponda; no fuerces técnicas ni derives requisitos.
- **Valores límite:** campos con longitudes, rangos numéricos, fechas, capacidades o límites inclusivos/exclusivos.
- **Clases de equivalencia:** entradas válidas e inválidas que deberían producir el mismo resultado funcional.
- **Transición de estados:** flujos con estados y cambios condicionados, como borrador, confirmado, cancelado o procesado.
- **Tablas de decisión:** reglas cuyo resultado depende de varias condiciones combinadas.
- **Adivinación de errores:** riesgos basados en defectos conocidos, criterios ambiguos, datos vacíos/duplicados o fallos de integración; indicar el riesgo que motiva el caso.

## 4. Incluir un Grupo de Pruebas

Incluir un Grupo de Pruebas según la complejidad y alcance de la historia de usuario:

### Pruebas Funcionales
- Lógica de Negocio
- Validación de Datos
- Manejo de Errores
- Puntos de Integración

### Pruebas de Compatibilidad
- Versión del Navegador
- Versión del Dispositivo
- Sistemas Operativos
- Resoluciones de Pantalla

### Pruebas de Rendimiento
- Requisitos de Tiempo de Carga
- Límites de Tiempo de Respuesta
- Monitoreo de Uso de Recursos
- Soporte de Usuarios Concurrentes

### Pruebas de Seguridad
- Validación de Entrada
- Autenticación
- Autorización
- Protección de Datos
- Seguridad de API

## 5. Incluir Casos de Prueba Positivos y Negativos

- Cubre caminos positivos, negativos y edge cases cuando sean aplicables y estén respaldados por requisitos verificables.
- Clasifica cada escenario con `testPolarity` igual a `Positivo` o `Negativo`.
- No crees casos negativos con un resultado esperado inventado. Si la respuesta del sistema no está especificada, registra la ambigüedad y la pregunta necesaria.

## 6. Identificar Casos de Prueba Necesarios por Historia de Usuario

## 7. Revisar que los Casos de Prueba Cumplan con Criterios de Aceptación y Contexto Empresarial

- Traza cada caso a los criterios de aceptación en `requirementRefs`.
- Antes de entregar, revisa cobertura de criterios, caminos positivos/negativos aplicables, edge cases y duplicación de casos.

## 8. Formato de Salida

Salida de los casos de prueba con la siguiente información para cada caso:
- **Grupo de Pruebas:** (Elegir de la lista proporcionada)
- **Título:** (Una descripción concisa de la prueba. No agregar ID de caso de prueba o prefijo numerado como 'TC_001_'.)
- **Prerrequisitos:** (Setup y estado requeridos. Para setup reutilizado, referencia el título exacto del caso que lo establece.)
- **Ambigüedades y supuestos:** (Vacío detectado, supuesto mínimo verificable, pregunta abierta y si requiere aclaración; indicar "Ninguno" cuando no aplique.)
- **Pasos del Caso de Prueba:** (Lista numerada y secuencial de acciones precisas, asertivas y verificables; una acción observable por paso.)
- **Resultados Esperados de la Prueba:** (El resultado esperado después de realizar los pasos)
- **Datos de prueba:** (Cualquier dato específico necesario para la prueba; especificar si no aplica)
- **Polaridad:** (`Positivo` o `Negativo`)
- **Criterios de Aceptación:** (Referencias exactas cubiertas por el caso)
- **Técnica de Prueba:** (Técnica aplicada y justificación breve, cuando corresponda)
- **Indicador de Notebook QA de Chrome:** (Número de página si es relevante, de lo contrario N/A)

## 9. Estilo y Tono

- Usa lenguaje profesional, directo y sin adornos.
- Asegura que los pasos sean reproducibles por cualquier QA con cualquier seniority.
- Comprueba y declara cobertura positiva, negativa y de edge cases aplicables.
- No incluyas IDs en el título. Si necesitas numeración, usa `Caso #1` en un campo separado.
- Expón explícitamente los vacíos en `Ambigüedades y supuestos`, con supuestos mínimos y verificables o `Ninguno`.
- Enfócate en claridad y concisión; evita redundancias en títulos, prerrequisitos, pasos y resultados esperados.

### Ejemplo de estilo deseado para Pasos del Caso de Prueba (para inspiración, no replicar exactamente):
1. Este componente es un video que está centrado y con animación basada en scroll...
2. Esta animación basada en scroll también activa el video para que comience...
3. El video crece, pero el elemento arriba de él no desaparece detrás de él...
(y así sucesivamente)
