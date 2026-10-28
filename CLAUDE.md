# Instrucciones del proyecto para Claude Code

Las reglas del agente QA son las mismas para Claude Code y Antigravity CLI. La fuente única es GEMINI.md:

@GEMINI.md

## Adaptación para Claude Code
- Las skills del agente viven en `.agents/skills/`. Cuando una instrucción o un plan mencione una skill por nombre, lee su `SKILL.md` antes de ejecutarla:
  - `qa-test-planner` → `.agents/skills/qa-test-planner/SKILL.md`
  - `qa-automator-azure-devops` → `.agents/skills/qa-automator-azure-devops/SKILL.md`
  - `run-exploratory-tests` → `.agents/skills/3.run-exploratory-tests/SKILL.md`
  - `run-tests-browser` → `.agents/skills/4.run-tests-browser/SKILL.md`
  - `run-accessibility-tests` → `.agents/skills/5.run-accessibility-tests/SKILL.md`
  - `run-lighthouse-tests` → `.agents/skills/6.run-lighthouse-tests/SKILL.md`
  - `report-bugs` → `.agents/skills/10.report-bugs/SKILL.md`
  - `generate-automated-tests` → `.agents/skills/12.generate-automated-tests/SKILL.md`
  - `log-results` → `.agents/skills/99.log-results/SKILL.md`
  - `qa-polyglot` → `.agents/skills/13.qa-polyglot/SKILL.md`
- Los servidores MCP para Claude Code están en `.mcp.json` (equivalente a `.agents/mcp_config.json`). Las herramientas MCP de Playwright aparecen como `mcp__playwright-chromium__*`, `mcp__playwright-firefox__*` y `mcp__playwright-webkit__*`; usa el servidor que corresponda a cada navegador de `selectedBrowsers`.
- Las herramientas de Azure DevOps aparecen como `mcp__azure-devops__import_work_item`, `mcp__azure-devops__search_work_items` y `mcp__azure-devops__create_azure_bug`.
- El QA Runner corre bajo `tools/runner-supervisor.mjs`, que lo reinicia si falla y lo recarga al cambiar `tools/*.mjs` o `.env` (espera a que termine cualquier ejecución y no recarga si el código nuevo no compila). Después de corregir el agente **no detengas ni relances el runner a mano** (`Stop-Process`, `node tools/qa-runner.mjs`): un runner lanzado desde la sesión del agente muere cuando esa sesión termina y la página deja de responder. Si el runner no responde, ejecuta `.\start-runner.ps1`, que lo inicia fuera de la sesión y no duplica uno que ya esté en marcha. Los cambios en `qa-runner.html`, skills y specs no requieren recarga.
- Cuando se ejecuta en modo no interactivo (`claude -p`, lanzado por `tools/qa-runner.mjs` o `run-qa.ps1`), no hagas preguntas al usuario: aplica las reglas de GEMINI.md y termina con el formato de salida obligatorio.
