#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { importWorkItem } from "./azure-devops-importer.mjs";

const port = Number(process.env.QA_RUNNER_PORT || 8787);
let activeRun = null;
let activePreparation = null;
const completedRuns = new Map();
const preparations = new Map();
const preparedRuns = new Map();
const workspaceRoot = process.cwd();

function page(title, content, status = 200) {
  return { status, body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>:root{font-family:system-ui,sans-serif;color:#17202a;background:#eef2f3}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.app{width:min(560px,100%);background:#fff;border:1px solid #d9e0e2;border-radius:18px;box-shadow:0 18px 50px #17202a18;overflow:hidden}.header{padding:28px 30px;background:#173b4d;color:#fff}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a9d7d1;font-weight:700}.header h1{margin:10px 0 0;font-size:28px}.body{padding:30px}.label{display:block;font-weight:700;margin-bottom:9px}.field{display:flex;gap:10px}.input{flex:1;min-width:0;border:1px solid #b7c5ca;border-radius:10px;padding:14px 15px;font-size:18px;outline:none}.input:focus{border-color:#16877c;box-shadow:0 0 0 3px #16877c22}.button{border:0;border-radius:10px;padding:0 20px;background:#16877c;color:#fff;font-weight:800;font-size:15px;cursor:pointer}.button:hover{background:#106d65}.hint{color:#5b6870;font-size:14px;margin:12px 0 0}.result{margin-top:24px;padding:16px;border-radius:10px;background:#eef7f5;border:1px solid #b8ded8;color:#155c57}.error{background:#fff2f0;border-color:#f2b8b1;color:#8c241b}code{background:#eef2f3;padding:2px 5px;border-radius:5px}.footer{padding:0 30px 26px;color:#7b878c;font-size:12px}</style></head><body><main class="app"><header class="header"><div class="eyebrow">GeekQA Runner</div><h1>Ejecutar pruebas por tarea</h1></header><section class="body"><form method="get" action="/run"><label class="label" for="taskId">Número de tarea de Azure DevOps</label><div class="field"><input class="input" id="taskId" name="id" inputmode="numeric" pattern="[0-9]+" placeholder="Ej. 123" required autofocus><button class="button" type="submit">Ejecutar QA</button></div><p class="hint">Importa la historia y arranca todo el plan de pruebas desde <code>agy</code>.</p></form>${content}</section><footer class="footer">La terminal del runner debe permanecer abierta durante la ejecución.</footer></main></body></html>` };
}

async function saveTestUrl(storyId, testUrl) {
  const storyPath = path.join(workspaceRoot, "2-inputs", `US-${storyId}`, "historia.md");
  const content = await fs.readFile(storyPath, "utf8");
  const withoutTestUrl = content.replace(/^\s*- URL de pruebas:.*(?:\r?\n|$)/gim, "").trimEnd();
  await fs.writeFile(storyPath, `${withoutTestUrl}\n\n- URL de pruebas: ${testUrl}\n`, "utf8");
}

async function readTestPlan(storyId, testUrl) {
  const planPath = path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "planning", `US-${storyId}-plan.json`);
  let plan;
  try {
    plan = JSON.parse(await fs.readFile(planPath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  if (!Array.isArray(plan.testScenarios) || plan.testScenarios.length === 0 || !Array.isArray(plan.testTechniques) || plan.testTechniques.length === 0
    || !plan.staticAnalysis || !Array.isArray(plan.staticAnalysis.findings)) return null;
  const polarities = new Set(plan.testScenarios.map(scenario => scenario.testPolarity));
  if (!polarities.has("Positivo") || !polarities.has("Negativo")
    || plan.testScenarios.some(scenario => !["Positivo", "Negativo"].includes(scenario.testPolarity))) return null;
  plan.url = testUrl;
  await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");
  return {
    storyId: plan.storyId || `US-${storyId}`,
    testScenarios: plan.testScenarios,
    testTechniques: plan.testTechniques || [],
    riskAnalysis: plan.riskAnalysis || null,
    staticAnalysis: plan.staticAnalysis || null
  };
}

async function validateTestUrl(value) {
  let target;
  try {
    target = new URL(value);
  } catch {
    throw new Error("Introduce una URL válida para el ambiente de pruebas.");
  }
  if (!["http:", "https:"].includes(target.protocol) || target.username || target.password) {
    throw new Error("La URL debe usar http:// o https:// y no incluir credenciales.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const result = await fetch(target, { signal: controller.signal, redirect: "follow" });
    return {
      status: result.status,
      reachable: true,
      protected: result.status === 401 || result.status === 403,
      warning: result.status >= 400 && result.status !== 401 && result.status !== 403
        ? `El servidor respondió HTTP ${result.status}; confirma que la página destino sea la correcta.`
        : null,
      url: result.url || target.href
    };
  } catch (error) {
    return {
      status: null,
      reachable: false,
      protected: false,
      warning: error.name === "AbortError"
        ? "El runner no recibió respuesta en 8 segundos. Puede requerir VPN o proxy; abre el enlace para comprobarlo manualmente."
        : "El runner no pudo comprobar el enlace desde el servidor. Puede requerir VPN, proxy o un certificado corporativo; abre el enlace para comprobarlo manualmente.",
      url: target.href
    };
  } finally {
    clearTimeout(timeout);
  }
}

function startPlanner(storyId, testUrl) {
  const prompt = `Actúa como Quality Engineer Senior con certificaciones ISTQB CTFL v4.0, CTFL-ATT y CT-MAT, y experiencia en Shift-Left, revisión estática, análisis de requisitos, INVEST y prevención temprana de defectos en SDLC/STLC ágiles, CI/CD y productos Web, Mobile, Desktop, Base de Datos, Cloud, Big Data, APIs e IA. Tu objetivo en esta preparación es detectar defectos, ambigüedades, inconsistencias y omisiones en los artefactos de requisitos antes de diseñar los casos.

Antes de crear los casos de prueba, realiza un análisis estático exhaustivo de la historia de usuario y los documentos adjuntos de 2-inputs/US-${storyId}/. Evalúa claridad, consistencia, completitud, trazabilidad y testabilidad. Basa cada hallazgo exclusivamente en evidencia de esos artefactos solicitados: indica archivo y sección o texto que lo sustenta; no inventes reglas ni conviertas supuestos en requisitos. Señala explícitamente la información faltante y las preguntas que requieren respuesta.

Prepara el plan de pruebas siguiendo qa-test-planner, references/test-case-best-practices.md y las instrucciones del proyecto. Usa la URL ${testUrl}. Incluye el análisis estático en el JSON como staticAnalysis, con summary, overallAssessment y findings; cada hallazgo debe incluir id, category, severity, source, evidence, impact y recommendation. Refleja el resumen y los hallazgos en una sección visible del HTML. Después deriva todos los escenarios relevantes de requisitos verificables, incluye requirementRefs como arreglo de criterios o fuentes por escenario y clarificationRequired como booleano cuando aplique; cada escenario debe tener testPolarity igual a Positivo o Negativo. Cubre los caminos positivos y negativos de cada criterio cuando apliquen, sin inventar comportamiento ante requisitos ambiguos. El plan debe incluir ambas polaridades para poder ejecutarse. Incluye testTechniques con las técnicas ISTQB realmente aplicables (valores límite, clases de equivalencia, transición de estados, tablas de decisión y adivinación de errores), cada una con justificación breve; no agregues técnicas irrelevantes. Asocia technique a cada escenario cuando corresponda. Genera únicamente planning/US-${storyId}-plan.json y planning/US-${storyId}-plan.html en 3-outputs/run/US-${storyId}/. No ejecutes pruebas; la ejecución queda pendiente de revisión humana.`;
  const agentCommand = process.env.AGY_COMMAND || (process.platform === "win32" ? "agy.exe" : "agy");
  const agentArgs = ["--dangerously-skip-permissions", "--add-dir", workspaceRoot, "--prompt", prompt];
  const agent = spawn(agentCommand, agentArgs, {
    cwd: workspaceRoot,
    detached: false,
    shell: process.platform === "win32" && agentCommand.toLowerCase().endsWith(".cmd"),
    stdio: ["ignore", "inherit", "pipe"]
  });
  let agentErrorOutput = "";
  agent.stderr.on("data", chunk => { agentErrorOutput += chunk.toString(); });
  agent.on("close", async code => {
    if (code !== 0) {
      preparations.set(String(storyId), { status: "failed", message: `No se pudo generar el plan. ${agentErrorOutput.trim() || `agy terminó con código ${code}.`}` });
      if (activePreparation?.storyId === String(storyId)) activePreparation = null;
      return;
    }
    try {
      const plan = await readTestPlan(storyId, testUrl);
      if (!plan) throw new Error("El agente terminó, pero el plan no contiene escenarios de prueba y un análisis estático válido.");
      preparedRuns.set(String(storyId), { testUrl, plan });
      preparations.set(String(storyId), { status: "prepared", access: preparations.get(String(storyId)).access, plan });
    } catch (error) {
      preparations.set(String(storyId), { status: "failed", message: error.message });
    }
    if (activePreparation?.storyId === String(storyId)) activePreparation = null;
  });
  agent.on("error", error => {
    preparations.set(String(storyId), { status: "failed", message: `No se pudo iniciar agy (${agentCommand}): ${error.message}` });
    if (activePreparation?.storyId === String(storyId)) activePreparation = null;
  });
}

async function ensureReport(storyId) {
  const reportDirectory = path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`);
  const reportPath = path.join(reportDirectory, "test-report.html");
  try {
    await fs.access(reportPath);
    return reportPath;
  } catch {
    await fs.mkdir(reportDirectory, { recursive: true });
    let projectName = `US-${storyId}`;
    try {
      const planPath = path.join(reportDirectory, "planning", `US-${storyId}-plan.json`);
      const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
      if (typeof plan.projectName === "string" && plan.projectName.trim()) projectName = plan.projectName.trim();
      else {
        const executionPath = path.join(reportDirectory, "execution", "execution-report.json");
        const execution = JSON.parse(await fs.readFile(executionPath, "utf8"));
        const suiteName = execution.suites?.[0]?.title?.replace(new RegExp(`^US-${storyId}\\s*-\\s*`), "").trim();
        if (suiteName) projectName = suiteName;
      }
    } catch {}
    const reportTitle = `Reporte de Pruebas E2E — ${projectName}`;
    const report = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Pruebas TI | Reporte E2E</title><style>body{font-family:system-ui,sans-serif;max-width:900px;margin:40px auto;padding:0 24px;color:#17202a;background:#f3f7f5}header{background:#173b4d;color:#fff;padding:28px;border-radius:10px}header img{width:176px;margin-bottom:16px}h1{margin:0;font-size:28px}section{margin-top:24px;padding:22px;background:#fff;border:1px solid #d9e0e2;border-radius:10px}.status{color:#8c241b;font-weight:800}.summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.metric{padding:16px;background:#eef7f5;border-radius:8px}.metric strong{display:block;font-size:26px;color:#106d65}.bar{height:18px;background:#d9e0e2;border-radius:999px;overflow:hidden}.bar span{display:block;width:0%;height:100%;background:#16877c}li{margin:10px 0}</style></head><body><header><img src="/grupo-sid-logo.svg" alt="GRUPO SID"><h1>Pruebas TI | Reporte de Pruebas E2E — UniWebPro Estudiantes (Clase 33)</h1></header><section><p><strong>Historia:</strong> US-${storyId}</p><p><strong>Estado final:</strong> <span class="status">BLOCKED</span></p><div class="summary"><div class="metric"><strong>0</strong>Pruebas aprobadas</div><div class="metric"><strong>0</strong>Pruebas fallidas</div><div class="metric"><strong>0%</strong>Porcentaje de aprobación</div></div><p><strong>Progreso de pruebas</strong></p><div class="bar" role="progressbar" aria-valuenow="0" aria-valuemin="0" aria-valuemax="100"><span></span></div></section><section><p>Se analizaron los criterios de aceptación y se prepararon los escenarios de prueba.</p><h2>Hallazgos</h2><ul><li>No se pudo completar la ejecución funcional, de accesibilidad y performance.</li><li>El ambiente de pruebas no estaba disponible durante esta ejecución.</li></ul><h2>Siguiente paso</h2><p>Verificar la URL del ambiente y repetir la ejecución.</p></section></body></html>`;
    const reportWithBrand = report.replace(
      '<header><img src="/grupo-sid-logo.svg" alt="GRUPO SID">',
      '<header><img src="/grupo-sid-logo.png?v=1" alt="Logo SID"><span style="display:block;color:#f1d978;font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">Pruebas TI</span>'
    );
    const titledReport = reportWithBrand
      .replace("<title>Pruebas TI | Reporte E2E</title>", `<title>${reportTitle}</title>`)
      .replace("<h1>Pruebas TI | Reporte de Pruebas E2E — UniWebPro Estudiantes (Clase 33)</h1>", `<h1>${reportTitle}</h1>`);
    await fs.writeFile(reportPath, titledReport, "utf8");
    return reportPath;
  }
}

function startAgent(storyId, selectedScenarioIds, selectedBrowsers, selectedTestTypes) {
  const prompt = `Ejecuta el flujo de QA para US-${storyId} exclusivamente en las modalidades seleccionadas por el usuario: ${selectedTestTypes.join(", ")}. Conserva estas modalidades en planning/US-${storyId}-plan.json.selectedTestTypes y configura las habilidades de pruebas: functional=run-tests-browser, accessibility=run-accessibility-tests, performance=run-lighthouse-tests. No ejecutes ninguna de esas habilidades si su modalidad no fue seleccionada; conserva otras habilidades auxiliares del plan que no correspondan a estas modalidades. Presupuesto estricto: run-tests-browser debe finalizar en máximo 115 segundos desde la primera navegación (nunca excedas 120 segundos), reservando 15 segundos para guardar evidencias y el reporte. Navegación máximo 10 segundos, acción 3 segundos, aserción 2.5 segundos; no uses esperas fijas ni networkidle. Si el presupuesto se agota, registra lo pendiente como BLOCKED/TIME_BUDGET, no como fallo ni bug. Si se seleccionó functional, ejecuta exclusivamente los escenarios ${selectedScenarioIds.join(", ")} y solo en estos navegadores: ${selectedBrowsers.join(", ")}; si no se seleccionó functional, omite la ejecución de escenarios y no inventes casos. Omite cualquier otro escenario y conserva el plan original. Usa la URL indicada en 2-inputs/US-${storyId}/historia.md. Genera los artefactos en 3-outputs/run/US-${storyId}/. Crea el reporte en 3-outputs/run/US-${storyId}/test-report.html usando .agents/skills/99.log-results/templates/test-report-template.html. Deriva el nombre correcto del proyecto del plan y el contexto funcional de la historia (campo "Nombre del Proyecto"); no uses nombres de proyectos de otras historias ni un nombre fijo. El título debe ser "Reporte de Pruebas E2E — {Nombre del Proyecto}" tanto en <title> como en <h1>. Incrusta las capturas disponibles bajo execution/, accessibility/ y lighthouse/ en una galería con rutas /reports/${storyId}/assets/{ruta-relativa}, alt y leyendas precisas; no presentes una captura como evidencia de algo que no muestra. Registra en Azure DevOps solo bugs reproducibles encontrados en pruebas fallidas, con la plantilla de report-bugs; no dupliques bugs ni reportes bloqueados por ambiente.`;
  const agentCommand = process.env.AGY_COMMAND || (process.platform === "win32" ? "agy.exe" : "agy");
  const agentArgs = ["--dangerously-skip-permissions", "--add-dir", workspaceRoot, "--prompt", prompt];
  const agent = spawn(agentCommand, agentArgs, {
    cwd: workspaceRoot,
    detached: false,
    shell: process.platform === "win32" && agentCommand.toLowerCase().endsWith(".cmd"),
    stdio: ["ignore", "inherit", "pipe"]
  });
  let agentErrorOutput = "";
  agent.stderr.on("data", chunk => { agentErrorOutput += chunk.toString(); });
  agent.on("close", async code => {
    if (code !== 0) {
      const quotaError = /quota|resource_exhausted|code 429|individual quota/i.test(agentErrorOutput);
      const message = quotaError
        ? `agy no pudo ejecutar la tarea porque se agotó la cuota de la cuenta (RESOURCE_EXHAUSTED / 429). Espera el reinicio indicado por agy o utiliza una cuenta con cuota disponible. Detalle: ${agentErrorOutput.trim()}`
        : `agy terminó con código ${code}. ${agentErrorOutput.trim() || "Verifica que agy esté instalado y disponible en PATH."}`;
      completedRuns.set(String(storyId), { status: "failed", message });
      if (activeRun?.storyId === storyId) activeRun = null;
      return;
    }
    const reportPath = await ensureReport(storyId);
    completedRuns.set(String(storyId), { status: "completed", reportPath });
    if (activeRun?.storyId === storyId) activeRun = null;
  });
  agent.on("error", error => {
    console.error(`No se pudo iniciar agy: ${error.message}`);
    completedRuns.set(String(storyId), { status: "failed", message: `No se pudo iniciar agy (${agentCommand}). Verifica que agy esté instalado y disponible en PATH.` });
    if (activeRun?.storyId === storyId) activeRun = null;
  });
  return agent.pid;
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);

  if (url.pathname === "/qa-runner.html") {
    const body = await fs.readFile(path.join(workspaceRoot, "qa-runner.html"), "utf8");
    response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    response.end(body);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/healthcheck") {
    const target = url.searchParams.get("url") || "";
    const startedAt = Date.now();
    try {
      const access = await validateTestUrl(target);
      access.latencyMs = Date.now() - startedAt;
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(access));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: error.message }));
    }
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/prepare") {
    let requestBody;
    try {
      let rawBody = "";
      for await (const chunk of request) rawBody += chunk;
      requestBody = JSON.parse(rawBody);
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "La solicitud no contiene JSON válido." }));
      return;
    }
    const id = String(requestBody.id || "");
    const testUrl = String(requestBody.testUrl || "").trim();
    if (!/^\d+$/.test(id)) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "El número de tarea debe ser numérico." }));
      return;
    }
    if (activeRun || activePreparation) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: `Hay una tarea en curso: US-${activeRun?.storyId || activePreparation.storyId}.` }));
      return;
    }
    activePreparation = { storyId: id };
    try {
      const access = await validateTestUrl(testUrl);
      await importWorkItem(id);
      await saveTestUrl(id, testUrl);
      const plan = await readTestPlan(id, testUrl);
      if (plan) {
        const result = { status: "prepared", access, plan };
        preparedRuns.set(id, { testUrl, plan });
        preparations.set(id, result);
        activePreparation = null;
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify(result));
        return;
      }
      preparations.set(id, { status: "planning", access });
      startPlanner(id, testUrl);
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "planning" }));
    } catch (error) {
      activePreparation = null;
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: error.message }));
    }
    return;
  }

  const preparationMatch = url.pathname.match(/^\/api\/prepare\/(\d+)$/);
  if (request.method === "GET" && preparationMatch) {
    const preparation = preparations.get(preparationMatch[1]);
    response.writeHead(preparation ? 200 : 404, { "Content-Type": "application/json" });
    response.end(JSON.stringify(preparation || { status: "not_found" }));
    return;
  }

  if (url.pathname === "/grupo-sid-logo.svg") {
    const logo = await fs.readFile(path.join(workspaceRoot, "grupo-sid-logo.svg"), "utf8");
    response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
    response.end(logo);
    return;
  }

  if (url.pathname === "/grupo-sid-logo.png") {
    const logo = await fs.readFile(path.join(workspaceRoot, "grupo-sid-logo.png"));
    response.writeHead(200, { "Content-Type": "image/png", "Cache-Control": "no-cache", "X-Content-Type-Options": "nosniff" });
    response.end(logo);
    return;
  }

  if (url.pathname === "/test-executor-background.svg" || url.pathname === "/test-executor-logo.svg") {
    const assetName = url.pathname.slice(1);
    const assetPath = path.join(workspaceRoot, assetName);
    const asset = await fs.readFile(assetPath, "utf8");
    response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-cache" });
    response.end(asset);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/run") {
    let body = "";
    let reviewed = false;
    let selectedScenarioIds = [];
    let selectedBrowsers = [];
    let selectedTestTypes = [];
    for await (const chunk of request) body += chunk;
    let id;
    let testUrl;
    try {
      ({ id, testUrl, reviewed, selectedScenarioIds, selectedBrowsers, selectedTestTypes } = JSON.parse(body));
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "La solicitud no contiene JSON válido." }));
      return;
    }
    if (!/^\d+$/.test(String(id))) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "El número de tarea debe ser numérico." }));
      return;
    }
    if (!/^https?:\/\/\S+$/i.test(String(testUrl || ""))) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "El link de pruebas debe comenzar por http:// o https://." }));
      return;
    }
    const prepared = preparedRuns.get(String(id));
    if (reviewed !== true || !prepared || prepared.testUrl !== String(testUrl).trim()) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Primero valida el ambiente, revisa los casos y confirma que tienes acceso al enlace." }));
      return;
    }
    const supportedTestTypes = new Set(["functional", "accessibility", "performance"]);
    if (!Array.isArray(selectedTestTypes) || selectedTestTypes.length === 0 || selectedTestTypes.some(type => !supportedTestTypes.has(type))) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Selecciona al menos una modalidad válida: funcional, accesibilidad o rendimiento." }));
      return;
    }
    const functionalSelected = selectedTestTypes.includes("functional");
    if (!Array.isArray(selectedScenarioIds) || (functionalSelected && selectedScenarioIds.length === 0)) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Selecciona casos de prueba para la modalidad funcional." }));
      return;
    }
    const supportedBrowsers = new Set(["chromium", "firefox", "webkit"]);
    if (!Array.isArray(selectedBrowsers) || (functionalSelected && selectedBrowsers.length === 0) || selectedBrowsers.some(browser => !supportedBrowsers.has(browser))) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Selecciona al menos un navegador compatible para las pruebas funcionales: Chromium, Firefox o WebKit." }));
      return;
    }
    const availableScenarioIds = new Set(prepared.plan.testScenarios.map((scenario, index) => scenario.id || `SC_${String(index + 1).padStart(3, "0")}`));
    if (selectedScenarioIds.some(scenarioId => !availableScenarioIds.has(scenarioId))) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "La selección contiene casos que no pertenecen al plan preparado." }));
      return;
    }
    const selectedPolarity = new Set(functionalSelected ? prepared.plan.testScenarios.flatMap((scenario, index) => {
      const scenarioId = scenario.id || `SC_${String(index + 1).padStart(3, "0")}`;
      return selectedScenarioIds.includes(scenarioId) ? [scenario.testPolarity] : [];
    }) : []);
    if (functionalSelected && (!selectedPolarity.has("Positivo") || !selectedPolarity.has("Negativo") || selectedPolarity.has("Sin clasificar"))) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Selecciona al menos un caso positivo y uno negativo para ejecutar la validación completa." }));
      return;
    }
    if (activeRun) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: `Ya se está ejecutando la tarea ${activeRun.storyId}.` }));
      return;
    }
    activeRun = { storyId: String(id), pid: null };
    preparedRuns.delete(String(id));
    try {
      const imported = await importWorkItem(id);
      await saveTestUrl(id, String(testUrl).trim());
      const planPath = path.join(workspaceRoot, "3-outputs", "run", `US-${id}`, "planning", `US-${id}-plan.json`);
      const fullPlan = JSON.parse(await fs.readFile(planPath, "utf8"));
      fullPlan.selectedScenarioIds = selectedScenarioIds;
      fullPlan.selectedTestTypes = selectedTestTypes;
      fullPlan.selectedBrowsers = functionalSelected ? selectedBrowsers : [];
      const selectedSkillByType = {
        functional: "run-tests-browser",
        accessibility: "run-accessibility-tests",
        performance: "run-lighthouse-tests"
      };
      const testSkills = new Set(Object.values(selectedSkillByType));
      const otherSkills = Array.isArray(fullPlan.selectedSkills) ? fullPlan.selectedSkills.filter(skill => !testSkills.has(skill)) : [];
      fullPlan.selectedSkills = [...new Set([...otherSkills, ...selectedTestTypes.map(type => selectedSkillByType[type])])];
      await fs.writeFile(planPath, `${JSON.stringify(fullPlan, null, 2)}\n`, "utf8");
      const pid = startAgent(id, selectedScenarioIds, functionalSelected ? selectedBrowsers : [], selectedTestTypes);
      activeRun = { storyId: String(id), pid };
      completedRuns.delete(String(id));
      response.writeHead(202, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ id: imported.id, status: "running" }));
    } catch (error) {
      if (activeRun?.storyId === String(id)) activeRun = null;
      response.writeHead(500, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: error.message }));
    }
    return;
  }

  const statusMatch = url.pathname.match(/^\/api\/status\/(\d+)$/);
  if (request.method === "GET" && statusMatch) {
    const id = statusMatch[1];
    if (activeRun?.storyId === id) {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: "running" }));
      return;
    }
    const completed = completedRuns.get(id);
    if (completed) {
      if (completed.status === "failed") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "failed", message: completed.message }));
        return;
      }
      try { await fs.access(completed.reportPath); } catch { completed.status = "completed_without_report"; }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: completed.status, reportUrl: completed.status === "completed" ? `/reports/${id}` : null, message: completed.status === "completed" ? null : "agy terminó, pero no encontró test-report.html." }));
      return;
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "not_found" }));
    return;
  }

  const reportMatch = url.pathname.match(/^\/reports\/(\d+)$/);
  if (request.method === "GET" && reportMatch) {
    const reportPath = path.join(workspaceRoot, "3-outputs", "run", `US-${reportMatch[1]}`, "test-report.html");
    try {
      const report = await fs.readFile(reportPath, "utf8");
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(report);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Reporte todavía no disponible.");
    }
    return;
  }

  const reportAssetMatch = url.pathname.match(/^\/reports\/(\d+)\/assets\/(.+)$/);
  if (request.method === "GET" && reportAssetMatch) {
    const reportDirectory = path.resolve(workspaceRoot, "3-outputs", "run", `US-${reportAssetMatch[1]}`);
    const requestedPath = path.resolve(reportDirectory, reportAssetMatch[2]);
    if (!requestedPath.startsWith(`${reportDirectory}${path.sep}`)) {
      response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Ruta de evidencia inválida.");
      return;
    }
    const contentTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8" };
    try {
      const asset = await fs.readFile(requestedPath);
      response.writeHead(200, { "Content-Type": contentTypes[path.extname(requestedPath).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
      response.end(asset);
    } catch {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Evidencia no encontrada.");
    }
    return;
  }
  const match = url.pathname.match(/^\/run(?:\/(\d+))?\/?$/);

  if (url.pathname === "/") {
    const result = page("QA Runner", "");
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    return;
  }

  const storyId = match?.[1] || url.searchParams.get("id");
  if (!storyId || !/^\d+$/.test(storyId)) {
    const result = page("Número inválido", "<div class=\"result error\">Introduce un número de tarea válido.</div>", 400);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    return;
  }

  if (activeRun) {
    const result = page("Ejecución en curso", `<div class="result">Ya se está ejecutando la tarea <strong>${activeRun.storyId}</strong>.</div>`, 409);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    return;
  }

  try {
    const imported = await importWorkItem(storyId);
    const pid = startAgent(storyId);
    activeRun = { storyId, pid };
    const result = page("Pruebas iniciadas", `<div class="result">La tarea <strong>${storyId}</strong> fue importada y el agente QA se inició con el proceso <strong>${pid}</strong>.<br><br>Puedes cerrar esta pestaña; deja abierta la terminal del runner.</div>`);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    console.log(`QA iniciado para US-${imported.id}: ${imported.title}`);
  } catch (error) {
    const result = page("No se pudo iniciar", `<div class="result error">${error.message}</div>`, 500);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`QA Runner listo: http://localhost:${port}/run/<numero-de-tarea>`);
});
