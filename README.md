# QA Agent GeekQA

Este repositorio contiene un prototipo de agente de QA orientado a analizar, diseñar, ejecutar pruebas sobre una  aplicaciones web mediante Playwright MCP, accesibilidad y reportes de bugs automatizados. El flujo está guiado por las instrucciones de [GEMINI.md](GEMINI.md) y por la configuración de [.agents/mcp_config.json].

Este recurso forma parte del curso de IA para QA y automatización disponible en Udemy: https://www.udemy.com/course/ai-powered-qa-automatizacion-y-agentes-inteligentes-en-qe/

## Qué incluye este proyecto

- Planificación de pruebas basada en historias de usuario.
- Ejecución de pruebas funcionales, accesibilidad y Lighthouse.
- Generación de artefactos en carpetas estructuradas bajo [3-outputs](3-outputs).
- Integración con Antigravity CLI y servidores MCP de Playwright.
- Importación de historias desde Azure DevOps mediante REST y MCP.

## Requisitos previos

- Git instalado
- Node.js 18+ recomendado
- npm
- Antigravity CLI instalado
- Acceso a la terminal o PowerShell
- 1 + mas cuentas de correo de Gmail para autenticación en Antigravity CLI

## Instalación

1. Clona el repositorio:
   ```bash
   git clone <url-del-repositorio>
   ```
2. Entra en la carpeta del proyecto:
   ```bash
   cd qa-agent-geekqa
   ```


## Estructura del proyecto

- [2-inputs](2-inputs): archivos de entrada, historias de usuario y materiales de contexto.
- [3-outputs](3-outputs): resultados generados por el flujo de QA.
- [.agents]: configuración de Antigravity, skills y MCP.
- [GEMINI.md](GEMINI.md): instrucciones principales para el agente.

## Uso recomendado

1. Prepara la entrada en [2-inputs](2-inputs).
2. Asegura que [GEMINI.md] y [.agents/mcp_config.json] estén presentes.
3. Desde la raíz del proyecto, ejecuta Antigravity CLI:
   ```bash
   agy --dangerously-skip-permissions
   ```
4. Realice setup inicial de Antgravity, permisos etc y autenticatión con tu cuenta de correo de Gmail
5. Puedes correr el flujo de QA E2E para una historia de usuario de esta manera:
  
   ```bash
   Ejecuta todo el flujo de QA para la historia de usuario de la carpeta (nombre carpeta)
   ```
6. Puedes correr solo uno de los skills del agente si deseas,  así:
  
 
  Ejecuta el skill de run-exploratory-test para el sitio en esta url http://geeqak.net
  
  Para probar el código fuente de un repositorio en cualquier lenguaje (Java, Python, .NET, Go, etc.), usa el skill `qa-polyglot`:

  Ejecuta el skill qa-polyglot sobre el proyecto C:\ruta\al\repositorio

  El agente detecta los lenguajes y frameworks con evidencia, muestra el Mapa Tecnológico y ejecuta lint, build y pruebas con la herramienta nativa de cada uno. Deja los resultados en `3-outputs/run/REPO-{nombre}/`.


7. El agente leerá las instrucciones y prompts y generará resultados en [3-outputs/run](3-outputs/run).

Para usar la interfaz web del runner, inicia el servidor desde la raíz de `qa-agent-geekqa`:

```powershell
.\start-runner.ps1
```

El runner queda en una ventana minimizada llamada **QA Runner (no cerrar)**, independiente de la terminal o de VS Code. Lo vigila `tools/runner-supervisor.mjs`:

- si el runner se detiene por un error, lo reinicia en segundos;
- si cambia `tools/*.mjs` o `.env` (por ejemplo, tras una corrección del agente), lo recarga solo, esperando a que termine cualquier ejecución en curso;
- si el código nuevo tiene un error de sintaxis, no recarga y sigue con la versión anterior.

Si el script dice que el runner ya está en marcha, basta con abrir la página. Para detenerlo, cierra esa ventana. `npm start` hace lo mismo en la terminal actual.

Para que el runner arranque solo, ejecuta una vez:

```powershell
.\install-autostart.ps1
```

El script registra la tarea de Windows **QA Runner (GeekQA)**. La tarea inicia el runner al iniciar sesión y cada 10 minutos lo vuelve a levantar si se cerró su ventana. Para quitarla: `.\install-autostart.ps1 -Uninstall`.

Después abre `http://localhost:8787/qa-runner.html`. No abras `qa-runner.html` directamente desde el explorador de archivos, porque necesita el servidor para ejecutar las llamadas `/api/run` y `/api/status`.

## Integración con Azure DevOps

El servidor MCP `azure-devops` está configurado para la organización `GSID-Autogestion` y el proyecto `Pruebas-TI IA`. Antes de iniciar Antigravity, configura un PAT con permiso de lectura de Work Items en la sesión de PowerShell:

```powershell
Copy-Item .env.example .env
notepad .env
agy --dangerously-skip-permissions
```

Completa `AZDO_PAT` en `.env`. Este archivo está excluido de Git y el importador lo carga automáticamente. El PAT no debe guardarse en el repositorio. El agente dispone de estas herramientas MCP:

Si el runner muestra `spawn ENOENT`, comprueba la ruta real de `agy` en una PowerShell nueva:

```powershell
Get-Command agy
```

Añade el resultado a `.env`, por ejemplo:

```env
AGY_COMMAND=C:\Users\tu-usuario\AppData\Local\agy\bin\agy.exe
```

No uses literalmente `C:\ruta\real\agy.cmd`; es solo un ejemplo.

- `import_work_item`: obtiene una historia por ID y la guarda en `2-inputs/US-{id}/historia.md`.
- `search_work_items`: busca historias mediante WIQL.

También puedes importar una historia directamente desde PowerShell:

```powershell
node tools/azure-devops-importer.mjs import 123
```

Después, ejecuta el flujo habitual indicando `US-123` como historia de usuario. Para consultar las historias recientes:

```powershell
node tools/azure-devops-importer.mjs search
```

### Enlace para repetir pruebas por número de tarea

Inicia la aplicación local desde la raíz del repositorio:

```powershell
.\start-runner.ps1
```

Abre la interfaz web en [http://localhost:8787/qa-runner.html](http://localhost:8787/qa-runner.html), introduce el número de la tarea y pulsa **Ejecutar QA**. Cuando `agy` termine, la aplicación mostrará el enlace al `test-report.html` generado.

Abre la aplicación en el navegador:

```text
http://localhost:8787
```

Escribe el número de la tarea y pulsa **Ejecutar QA**. También puedes abrir directamente este enlace, sustituyendo `123` por el número de la tarea:

```text
http://localhost:8787/run/123
```

El enlace directo muestra una confirmación: la ejecución empieza al pulsar **Sí, ejecutar**. Así otra página web no puede lanzar pruebas abriendo el enlace sin que lo notes. El runner importa la tarea y lanza el agente QA. Solo permite una ejecución a la vez y funciona mientras la terminal del runner permanezca abierta.

## Agente y modo de ejecución

En `.env` puedes elegir:

- `QA_AGENT=claude` (Claude Code) o `QA_AGENT=agy` (Antigravity CLI): agente que planifica, genera scripts y analiza fallos.
- `QA_EXECUTION_MODE=playwright` (por defecto) o `QA_EXECUTION_MODE=agent`.

En el modo `playwright` (híbrido), al ejecutar desde el runner:

1. Si el spec no cubre los casos seleccionados, el agente lo genera o completa. Esto solo ocurre la primera vez. Los casos se reparten en lotes de 6, y hasta 3 agentes trabajan en paralelo, cada uno en su propia parte (`US-{id}.spec.ts`, `US-{id}.p2.spec.ts`…). Si un lote agota su tiempo, se ejecutan los casos ya generados, los que falten aparecen como `BLOCKED/NOT_GENERATED` y la siguiente ejecución genera solo esos. Se ajusta con `QA_GENERATION_BATCH_SIZE`, `QA_GENERATION_PARALLEL` y `QA_GENERATION_BUDGET_MS`.
2. Playwright ejecuta solo los casos y navegadores seleccionados, sin usar el modelo. Suele tardar menos de 1 minuto.
3. El runner crea `execution/execution-report.json` y `test-report.html` a partir de los resultados.
4. Si algún caso falla, el agente hace el triage en segundo plano: corrige el spec si el fallo es del script, o documenta el bug si es del producto.

Accesibilidad y rendimiento siguen ejecutándose con el agente. El runner se recarga solo al cambiar `.env`.

### Controles que garantizan resultados verídicos

El runner no confía ciegamente en el spec que genera el agente. Antes de ejecutar, `tools/qa-guards.mjs` revisa cada test y rechaza los que:

- no tienen ninguna aserción real (incluido el código comentado);
- usan aserciones constantes como `expect(true).toBeTruthy()`;
- navegan a un dominio distinto del de la URL de pruebas de la historia (añade dominios extra, como un SSO, con `QA_ALLOWED_HOSTS`);
- no corresponden a un escenario del plan o no siguen el formato `SC_NNN: título`.

Si hay tests rechazados, el runner pide al agente que regenere el spec una vez. Los que sigan sin ser fiables no se ejecutan y aparecen como `BLOCKED/SCRIPT_INVALID`. El runner también regenera el spec cuando hay casos bloqueados por login y ya existe una sesión guardada.

Otros controles:

- **Intermitencias:** cada caso fallido se reintenta una vez (`QA_RETRIES`). Si pasa al reintentar, queda como `FLAKY` y no como bug. Los fallos por tiempo de espera se marcan con `failureType: "TIMEOUT"`.
- **Bugs en Azure DevOps:** `create_azure_bug` rechaza el bug si el escenario no figura como `FAIL`, si el ambiente no es la URL de pruebas de la historia, si la ejecución no dejó evidencias o si el fallo fue solo por tiempo de espera sin reproducirlo.

### Bugs con paso a paso y evidencias

Cuando un caso falla y el triage confirma que es un defecto del producto, el agente registra el bug en Azure DevOps con `create_azure_bug`. El agente solo decide el título, la severidad y el impacto; el contenido se arma con datos verificables:

- **Repro Steps:** login (si la historia lo exige), precondiciones y pasos del plan. El paso que falló aparece en rojo con el error y la captura incrustada (los specs envuelven cada paso del plan en `test.step`).
- **Evidencias adjuntas:** captura del fallo, video, trace de Playwright y estado de la página, de cada navegador donde falló. Playwright conserva video y trace solo de los intentos fallidos.
- **System Info y descripción:** URL, navegador, sistema operativo, usuario de prueba, fecha, criterios relacionados, resultado esperado frente a obtenido y resultado de cada paso.
- **Sin duplicados:** cada bug lleva la etiqueta `QA-US{id}-SC_NNN`. Si ya hay uno abierto para el escenario, se le adjunta la evidencia nueva como re-test.
- **Registro local:** `bugs/US-{id}-bugs.json` y `.md`, con las evidencias en `bugs/evidence/`; el bug queda vinculado en `execution-report.json`.

Para ver un bug antes de crearlo, sin escribir en Azure DevOps:

```powershell
node tools/azure-devops-importer.mjs bug-preview 79 SC_010
```

Para crearlo a mano desde la terminal: `node tools/azure-devops-importer.mjs bug 79 SC_010 "Título del bug" "2 - High"`.
- **Formato único de resultados:** `execution-report.json` debe cumplir `schemas/execution-report.schema.json`. Si el agente lo deja con otro formato, el runner guarda los errores en `execution/schema-errors.json`. Los reportes con formatos antiguos se convierten con `node tools/migrate-legacy-reports.mjs`.
- **Permisos del agente:** Claude corre en modo `dontAsk`: solo escribe en `3-outputs/` y solo ejecuta Playwright y Lighthouse (`QA_AGENT_PERMISSIONS`). Antigravity no tiene una opción equivalente y sigue sin restricciones.
- **Peticiones al runner:** solo se aceptan desde `http://localhost:8787`; las de otras webs se rechazan con 403.

Para comprobar estos controles:

```powershell
npm test
```

### Datos que pide la prueba

Algunos casos necesitan un dato que solo tú puedes aportar: otro usuario con un perfil concreto, un registro existente o la respuesta de negocio a una ambigüedad. Esos casos quedan bloqueados (por ejemplo, `BLOCKED/NO_TEST_USER`) y `qa-runner.html` abre la ventana **La prueba necesita datos**, al terminar la ejecución o al volver a cargar la historia. Al pulsar **Guardar y continuar la prueba**:

1. Los usuarios se validan iniciando sesión en la aplicación. Si uno no entra, se marca el error en su campo y no se guarda nada.
2. Los datos se guardan sin credenciales: de cada usuario solo se conserva su sesión iniciada en `.auth/` (`QA_US{id}_INPUT_*_STORAGE_STATE`), nunca su usuario ni su contraseña. Los textos se guardan en `.env` y en `2-inputs/US-{id}/datos-prueba.md`.
3. El agente adapta solo esos casos para que lean el dato y el runner los repite automáticamente. El reporte se actualiza con el resultado, sin repetir el resto.

### Datos de prueba

Si una historia necesita datos concretos (registros existentes, archivos, buzones), escríbelos en `2-inputs/US-{id}/datos-prueba.md`. El agente los usa al generar el spec y no inventa los que falten: esos casos quedan bloqueados con su motivo. Hay una plantilla en `2-inputs/US-88/datos-prueba.md`.

### Aplicaciones con login (SSO, MFA o credenciales)

Al pulsar **Validar conexión y cargar casos**, el runner comprueba si la URL pide login. Si lo pide y no hay un usuario guardado, se abre la ventana **Inicia sesión para continuar** antes de generar los casos. Cuando el usuario queda validado, la ventana se cierra y los casos se generan solos. La misma ventana ofrece:

- **Usuario y contraseña:** el runner inicia sesión de verdad con los datos que escribas. **El usuario y la contraseña nunca se guardan**: solo se conserva la sesión iniciada (cookies en `.auth/`, excluida de Git, con su ruta en `.env` como `QA_US{id}_STORAGE_STATE`). Mientras el runner sigue en marcha, los mantiene en memoria para renovar la sesión; al reiniciarse, los olvida.
- **Iniciar sesión en el navegador (SSO/MFA):** se abre un navegador visible. Cuando termines el login, la sesión se guarda sola.

**Si la aplicación requiere login, las pruebas solo se ejecutan con un usuario y contraseña válidos** (o una sesión SSO válida); no hay opción para ejecutar sin ellos. La historia se marca como "requiere login" si lo indica cualquiera de estas fuentes:

- **La web:** el runner detecta el login aunque la URL de pruebas sea una portada pública. Por ejemplo, en un sitio Odoo comprueba `/odoo`, que redirige a `/web/login`.
- **El plan:** el agente declara `authentication.required` cuando la historia habla de usuarios autorizados, perfiles, roles o módulos internos.
- **El spec:** si al generarlo el agente encuentra login y no hay usuario, la ejecución se detiene en lugar de producir casos `BLOCKED/CREDENTIALS`.

Antes de cada ejecución, el runner comprueba que la sesión siga activa (o la renueva si el usuario sigue en memoria). Si caducó, descarta la sesión y abre la ventana de inicio de sesión para que vuelvas a entrar.

Las pruebas de Playwright empiezan con la sesión de la historia ya iniciada. Para borrarla, usa **Cerrar sesión guardada**.

También puedes guardar una sesión desde la terminal:

1. Guarda una sesión iniciada. Se abre un navegador: inicia sesión y vuelve a la terminal para pulsar Enter.

   ```powershell
   node tools/save-session.mjs https://sideraqa.gruposid.com.do/home SIDERA_BUYER_STORAGE_STATE
   ```

   La sesión se guarda en `.auth/`, que está excluida de Git, y su ruta se registra en `.env`.
2. Prefiere siempre la sesión guardada. Solo si un test necesita escribir usuario y contraseña (por ejemplo, para probar el propio login), puedes añadirlos tú a mano en `.env` con un nombre que termine en `_EMAIL`, `_USER`, `_USERNAME` o `_PASSWORD`. El runner nunca los escribe ahí.
3. No hace falta reiniciar el runner: se recarga solo al cambiar `.env`.
4. En `qa-runner.html`, marca **↻ Regenerar script** y ejecuta. Claude inspecciona las pantallas internas con la sesión guardada y reescribe el spec. La versión anterior queda como `tests/US-{id}.previous.ts`.

Si las pruebas vuelven a pedir login, la sesión caducó: repite el paso 1.

Para repetir la suite manualmente:

```powershell
npx playwright test 3-outputs/run/US-79/tests/US-79.spec.ts --project=chromium
```

## Salida esperada

Los artefactos de QA se almacenan normalmente en carpetas por story o caso, por ejemplo:

- [3-outputs/run](3-outputs/run)/{story-id}/planning
- [3-outputs/run](3-outputs/run)/{story-id}/execution
- [3-outputs/run](3-outputs/run)/{story-id}/accessibility
- [3-outputs/run](3-outputs/run)/{story-id}/bugs
- [3-outputs/run](3-outputs/run)/{story-id}/test-report.html


## Copyright

Recurso creado por GeekQA con fines educativos.
www.geekqa.net