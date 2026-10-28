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
  

7. El agente leerá las instrucciones y prompts y generará resultados en [3-outputs/run](3-outputs/run).

Para usar la interfaz web del runner, inicia el servidor desde la raíz de `qa-agent-geekqa`:

```powershell
node tools/qa-runner.mjs
```

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
node tools/qa-runner.mjs
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

Al enviar el formulario o abrir el enlace directo, el runner importa la tarea y lanza automáticamente el agente QA. Solo permite una ejecución a la vez y funciona mientras la terminal del runner permanezca abierta.

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