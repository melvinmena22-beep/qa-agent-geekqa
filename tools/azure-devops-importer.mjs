#!/usr/bin/env node

import fs from "node:fs/promises";import path from "node:path";
import { checkBugGate, storyEnvironmentHosts } from "./qa-guards.mjs";
import { bugMarkdown, buildBug, descriptionHtml, EVIDENCE_LABELS, failedEntries, reproStepsHtml, systemInfoHtml } from "./bug-builder.mjs";
import process from "node:process";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

async function loadDotEnv() {
  try {
    const content = await fs.readFile(path.join(workspaceRoot, ".env"), "utf8");
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

await loadDotEnv();

const organizationUrl = (process.env.AZDO_ORG_URL || "https://dev.azure.com/GSID-Autogestion").replace(/\/$/, "");
const project = process.env.AZDO_PROJECT || "Pruebas-TI IA";
const apiVersion = "7.1";

function requirePat() {
  if (!process.env.AZDO_PAT) {
    throw new Error("Falta la variable de entorno AZDO_PAT. No guardes el PAT en el repositorio.");
  }
  return process.env.AZDO_PAT;
}

function apiUrl(route, query = {}) {
  const url = new URL(`${organizationUrl}/${encodeURIComponent(project)}${route}`);
  url.searchParams.set("api-version", apiVersion);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return url;
}

async function adoRequest(url, options = {}) {
  const token = Buffer.from(`:${requirePat()}`).toString("base64");
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      Authorization: `Basic ${token}`,
      ...(options.headers || {})
    }
  });
  const body = await response.text();
  if (response.status >= 300 || response.status === 203) {
    throw new Error(`Azure DevOps respondió ${response.status}: ${body.slice(0, 500)}`);
  }
  try {
    return body ? JSON.parse(body) : null;
  } catch (e) {
    throw new Error(`Error parsing JSON (Status ${response.status}): ${body.slice(0, 500)}`);
  }
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function field(fields, name) {
  return fields?.[name] == null ? "" : String(fields[name]);
}

function workItemToMarkdown(item) {
  const fields = item.fields || {};
  const id = item.id;
  const title = field(fields, "System.Title") || `Work Item ${id}`;
  const description = stripHtml(field(fields, "System.Description"));
  const acceptance = stripHtml(field(fields, "Microsoft.VSTS.Common.AcceptanceCriteria"));
  const lines = [
    `# US-${id} - ${title}`,
    "",
    "## Descripción",
    "",
    description || "No especificada en Azure DevOps.",
    "",
    "## Criterios de aceptación",
    "",
    acceptance || "No especificados en Azure DevOps.",
    "",
    "## Azure DevOps",
    "",
    `- ID: ${id}`,
    `- Tipo: ${field(fields, "System.WorkItemType")}`,
    `- Estado: ${field(fields, "System.State")}`,
    `- Prioridad: ${field(fields, "Microsoft.VSTS.Common.Priority") || "No especificada"}`,
    `- Área: ${field(fields, "System.AreaPath")}`,
    `- Iteración: ${field(fields, "System.IterationPath")}`,
    `- URL: ${item._links?.html?.href || ""}`,
    `- Última modificación: ${field(fields, "System.ChangedDate")}`,
    ""
  ];
  return lines.join("\n");
}

function storyDirectory(id) {
  return path.join(workspaceRoot, "2-inputs", `US-${id}`);
}

async function getWorkItem(id) {
  if (!/^\d+$/.test(String(id))) throw new Error("El ID del Work Item debe ser numérico.");
  return adoRequest(apiUrl(`/_apis/wit/workitems/${id}`, { "$expand": "all" }));
}

async function importWorkItem(id) {
  const item = await getWorkItem(id);
  const directory = storyDirectory(item.id);
  await fs.mkdir(directory, { recursive: true });
  const outputPath = path.join(directory, "historia.md");
  await fs.writeFile(outputPath, workItemToMarkdown(item), "utf8");
  return { id: item.id, title: field(item.fields, "System.Title"), outputPath };
}

async function searchWorkItems(query) {
  const wiql = query || "SELECT [System.Id], [System.Title], [System.State] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] IN ('User Story', 'Product Backlog Item') ORDER BY [System.ChangedDate] DESC";
  return adoRequest(apiUrl("/_apis/wit/wiql"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query: wiql })
  });
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]);
}

// Lee el execution-report.json de la historia para comprobar que el escenario del bug falló de verdad.
async function readExecutionReport(storyId) {
  try {
    return JSON.parse(await fs.readFile(path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "execution", "execution-report.json"), "utf8"));
  } catch {
    return null;
  }
}

// Tipos de evidencia que se adjuntan al bug (capturas, video, trace y estado de la página de Playwright).
const EVIDENCE_TYPES = new Map([
  [".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".gif", "image/gif"],
  [".webm", "video/webm"], [".mp4", "video/mp4"], [".zip", "application/zip"], [".md", "text/markdown"], [".txt", "text/plain"]
]);
const MAX_EVIDENCE_BYTES = 60 * 1024 * 1024;

function runDirectory(storyId) {
  return path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`);
}

async function readJsonFile(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return null;
  }
}

// La evidencia debe estar dentro de 3-outputs/run/US-{id}/. Las rutas del reporte son relativas a esa carpeta;
// las que empiezan por 3-outputs/ (o absolutas) se resuelven desde el workspace.
async function resolveEvidence(storyId, evidencePath) {
  const base = runDirectory(storyId);
  const candidate = path.isAbsolute(evidencePath) || /^3-outputs[\\/]/.test(evidencePath) ? path.resolve(workspaceRoot, evidencePath) : path.resolve(base, evidencePath);
  let real;
  try {
    real = await fs.realpath(candidate);
  } catch {
    return null;
  }
  const relative = path.relative(await fs.realpath(base), real);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new Error(`La evidencia ${evidencePath} debe estar dentro de 3-outputs/run/US-${storyId}/.`);
  const contentType = EVIDENCE_TYPES.get(path.extname(real).toLowerCase());
  const stats = await fs.stat(real);
  if (!contentType || !stats.isFile() || stats.size === 0 || stats.size > MAX_EVIDENCE_BYTES) return null;
  return { path: real, name: path.basename(real), contentType };
}

async function uploadAttachment(filePath, fileName) {
  const url = apiUrl("/_apis/wit/attachments", { fileName });
  const token = Buffer.from(`:${requirePat()}`).toString("base64");
  const response = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json", Authorization: `Basic ${token}`, "Content-Type": "application/octet-stream" },
    body: await fs.readFile(filePath)
  });
  const body = await response.text();
  if (response.status >= 300 || response.status === 203) throw new Error(`Azure DevOps no pudo subir ${fileName} (${response.status}): ${body.slice(0, 300)}`);
  const uploaded = JSON.parse(body);
  if (!uploaded.url) throw new Error("Azure DevOps no devolvió la URL del adjunto.");
  return uploaded;
}

function attachmentRelation(url, name, comment) {
  return { op: "add", path: "/relations/-", value: { rel: "AttachedFile", url, attributes: { comment, name } } };
}

// Guarda el bug en bugs/US-{id}-bugs.json (sustituye el del mismo escenario) y su sección en bugs/US-{id}-bugs.md.
async function saveLocalBug(storyId, record, markdown) {
  const bugsDir = path.join(runDirectory(storyId), "bugs");
  await fs.mkdir(bugsDir, { recursive: true });
  const jsonPath = path.join(bugsDir, `US-${storyId}-bugs.json`);
  const existing = await readJsonFile(jsonPath);
  const list = (Array.isArray(existing) ? existing : existing?.bugs || []).filter(item => item.id !== record.id && item.scenarioId !== record.scenarioId);
  await fs.writeFile(jsonPath, `${JSON.stringify([...list, record], null, 2)}\n`, "utf8");
  const mdPath = path.join(bugsDir, `US-${storyId}-bugs.md`);
  let md = "";
  try { md = await fs.readFile(mdPath, "utf8"); } catch {}
  const escapedId = record.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  md = md.replace(new RegExp(`\\n?## ${escapedId} —[\\s\\S]*?(?=\\n## |$)`), "").trimEnd();
  await fs.writeFile(mdPath, `${md ? `${md}\n\n` : `# Bugs de US-${storyId}\n\n`}${markdown}`, "utf8");
}

// Vincula el bug a los resultados fallidos del escenario en execution-report.json.
async function linkBugInReport(storyId, scenarioId, bugId, azureId) {
  const reportPath = path.join(runDirectory(storyId), "execution", "execution-report.json");
  const report = await readJsonFile(reportPath);
  if (!report) return;
  for (const item of report.scenarios || []) {
    if (item.id === scenarioId && item.status === "FAIL") Object.assign(item, { bugId, azureDevOpsId: azureId });
  }
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

async function storyAcceptanceCriteria(storyId) {
  try {
    const story = await fs.readFile(path.join(storyDirectory(storyId), "historia.md"), "utf8");
    return story.match(/## Criterios de aceptación\s*\n([\s\S]*?)(?=\n## |$)/)?.[1]?.trim() || "";
  } catch {
    return "";
  }
}

// Crea el bug en Azure DevOps con paso a paso y evidencias de la ejecución. El contenido se arma con
// datos verificables (plan, ejecución, artefactos de Playwright); el agente solo aporta título,
// severidad, impacto y, si quiere, matices del resultado esperado o actual.
async function createAzureBug({ sourceStoryId, scenarioId, title, severity = "3 - Medium", impact = "", expectedResult = "", actualResult = "", reproSteps = "", environment = "", evidence = "", evidenceFilePath = "", timeoutReproduced = false, dryRun = false }) {
  if (!/^\d+$/.test(String(sourceStoryId))) throw new Error("El ID de la historia relacionada debe ser numérico.");
  const allowedSeverities = new Set(["1 - Critical", "2 - High", "3 - Medium", "4 - Low"]);
  if (!allowedSeverities.has(severity)) throw new Error("La severidad debe ser 1 - Critical, 2 - High, 3 - Medium o 4 - Low.");
  const storyId = String(sourceStoryId);
  const report = await readExecutionReport(storyId);
  const plan = await readJsonFile(path.join(runDirectory(storyId), "planning", `US-${storyId}-plan.json`));
  const scenario = plan?.testScenarios?.find(item => item.id === scenarioId) || { id: scenarioId };
  const entries = failedEntries(report, scenarioId);
  const requirement = (await readJsonFile(path.join(workspaceRoot, ".auth", "login-requirements.json")))?.[storyId] || {};
  const login = {
    requiresLogin: Boolean(requirement.detected?.requiresLogin || requirement.specRequiresLogin || plan?.authentication?.required),
    appUrl: requirement.appUrl || requirement.detected?.protectedUrl || null,
    // El usuario no se guarda: el bug indica "usuario de prueba de la historia".
    username: null
  };
  const input = { title, severity, impact, expectedResult, actualResult, reproSteps, evidence };
  const draft = buildBug({ storyId, scenario, entries, report: report || {}, input, login, extraEvidence: evidenceFilePath ? [evidenceFilePath] : [] });

  const files = [];
  for (const item of draft.evidence) {
    const file = await resolveEvidence(storyId, item.path);
    if (file && !files.some(existing => existing.path === file.path)) files.push({ ...item, ...file });
  }
  // Evita bugs falsos: el escenario debe figurar como FAIL, en el ambiente de la historia y con evidencias.
  checkBugGate({
    report, scenarioId,
    environment: environment || report?.url || "",
    evidenceFiles: files,
    allowedHosts: await storyEnvironmentHosts(workspaceRoot, storyId),
    timeoutReproduced: timeoutReproduced === true
  });

  const bug = buildBug({ storyId, scenario, entries, report, input, login, acceptanceCriteria: await storyAcceptanceCriteria(storyId), extraEvidence: evidenceFilePath ? [evidenceFilePath] : [] });
  const bugId = `BUG-US-${storyId}-${scenarioId}`;
  // Vista previa: devuelve el bug completo sin escribir en Azure DevOps ni en bugs/.
  if (dryRun) {
    return {
      dryRun: true, bugId, title: bug.title, severity, tags: bug.tags,
      reproSteps: bug.reproSteps.map(step => `${step.text}${step.failing ? ` ← falla aquí: ${bug.failureLine}` : ""}`),
      expectedResult: bug.expected, actualResult: bug.actual, stepResults: bug.stepResults,
      systemInfo: Object.fromEntries(bug.systemInfo),
      evidence: files.map(file => ({ type: file.type, browser: file.browser, file: path.relative(workspaceRoot, file.path).split(path.sep).join("/") })),
      markdown: bugMarkdown(bug, { storyId, bugId, localEvidence: files.map(file => ({ type: file.type, browser: file.browser, path: path.relative(workspaceRoot, file.path).split(path.sep).join("/") })) })
    };
  }
  const fields = (await getWorkItem(storyId)).fields || {};
  const scenarioTag = `QA-US${storyId}-${scenarioId}`;

  // Copia local de las evidencias en bugs/evidence/{bugId}/.
  const evidenceDir = path.join(runDirectory(storyId), "bugs", "evidence", bugId);
  await fs.mkdir(evidenceDir, { recursive: true });
  const localEvidence = [];
  for (const file of files) {
    const name = `${file.type}${file.browser ? `-${file.browser}` : ""}${path.extname(file.name)}`;
    const target = path.join(evidenceDir, name);
    await fs.copyFile(file.path, target);
    localEvidence.push({ type: file.type, browser: file.browser, path: path.relative(path.join(runDirectory(storyId), "bugs"), target).split(path.sep).join("/"), source: target, uploadName: `${bugId}-${name}` });
  }

  // Duplicados: bug abierto con la etiqueta del escenario, el ID ya vinculado en el reporte o el mismo título bajo la historia.
  const escapedTitle = bug.title.replace(/'/g, "''");
  const byTag = await searchWorkItems(`SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Bug' AND [System.Tags] CONTAINS '${scenarioTag}' AND [System.State] NOT IN ('Closed', 'Removed', 'Done')`);
  const linkedId = entries.find(item => Number.isInteger(item.azureDevOpsId))?.azureDevOpsId;
  const byTitle = byTag.workItems?.length || linkedId ? null : await searchWorkItems(`SELECT [System.Id] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Bug' AND [System.Parent] = ${Number(storyId)} AND [System.Title] = '${escapedTitle}'`);
  const existingId = byTag.workItems?.[0]?.id || linkedId || byTitle?.workItems?.[0]?.id;

  let azure;
  if (existingId) {
    // El bug ya existe: se adjuntan las evidencias nuevas como re-test, sin duplicarlo.
    const existing = await getWorkItem(existingId);
    const attachedNames = new Set((existing.relations || []).filter(relation => relation.rel === "AttachedFile").map(relation => relation.attributes?.name));
    const retestName = name => name.replace(/^BUG-/, `RETEST-${new Date().toISOString().slice(0, 10)}-`);
    const patch = [];
    for (const item of localEvidence) {
      const name = retestName(item.uploadName);
      if (attachedNames.has(name)) continue;
      const uploaded = await uploadAttachment(item.source, name);
      patch.push(attachmentRelation(uploaded.url, name, `Re-test ${scenarioId}: ${EVIDENCE_LABELS[item.type] || item.type}`));
    }
    patch.push({ op: "add", path: "/fields/System.History", value: `El agente QA reprodujo de nuevo el fallo de ${escapeHtml(scenarioId)} el ${escapeHtml(new Date().toLocaleString("es-DO"))}: ${escapeHtml(bug.failureLine)}` });
    await adoRequest(apiUrl(`/_apis/wit/workitems/${existing.id}`), { method: "PATCH", headers: { "Content-Type": "application/json-patch+json" }, body: JSON.stringify(patch) });
    azure = { id: existing.id, url: existing._links?.html?.href || `${organizationUrl}/${encodeURIComponent(project)}/_workitems/edit/${existing.id}`, alreadyExists: true, attachments: patch.length - 1 };
  } else {
    const uploaded = [];
    for (const item of localEvidence) uploaded.push({ ...item, name: item.uploadName, url: (await uploadAttachment(item.source, item.uploadName)).url });
    const screenshot = uploaded.find(item => item.type === "screenshot");
    const patch = [
      { op: "add", path: "/fields/System.Title", value: bug.title },
      { op: "add", path: "/fields/Microsoft.VSTS.TCM.ReproSteps", value: reproStepsHtml(bug, screenshot?.url) },
      { op: "add", path: "/fields/Microsoft.VSTS.TCM.SystemInfo", value: systemInfoHtml(bug) },
      { op: "add", path: "/fields/System.Description", value: descriptionHtml(bug, { storyId, attachments: uploaded }) },
      { op: "add", path: "/fields/Microsoft.VSTS.Common.Severity", value: severity },
      { op: "add", path: "/fields/System.Tags", value: bug.tags.join("; ") }
    ];
    if (fields["System.AreaPath"]) patch.push({ op: "add", path: "/fields/System.AreaPath", value: fields["System.AreaPath"] });
    if (fields["System.IterationPath"]) patch.push({ op: "add", path: "/fields/System.IterationPath", value: fields["System.IterationPath"] });
    for (const item of uploaded) patch.push(attachmentRelation(item.url, item.name, `${scenarioId}: ${EVIDENCE_LABELS[item.type] || item.type}${item.browser ? ` (${item.browser})` : ""}`));
    patch.push({
      op: "add", path: "/relations/-",
      value: { rel: "System.LinkTypes.Hierarchy-Reverse", url: `${organizationUrl}/${encodeURIComponent(project)}/_apis/wit/workItems/${storyId}`, attributes: { comment: `Bug encontrado durante pruebas de US-${storyId}` } }
    });
    const created = await adoRequest(apiUrl("/_apis/wit/workitems/$Bug"), { method: "POST", headers: { "Content-Type": "application/json-patch+json" }, body: JSON.stringify(patch) });
    azure = { id: created.id, url: created._links?.html?.href || `${organizationUrl}/${encodeURIComponent(project)}/_workitems/edit/${created.id}`, alreadyExists: false, attachments: uploaded.length };
  }

  const record = {
    id: bugId, scenarioId, title: bug.title, severity, impact: bug.impact, status: "New",
    azureDevOpsId: azure.id, url: azure.url, alreadyExists: azure.alreadyExists,
    reproSteps: bug.reproSteps.map(step => `${step.text}${step.failing ? ` ← falla aquí: ${bug.failureLine}` : ""}`),
    expectedResult: bug.expected, actualResult: bug.actual,
    systemInfo: Object.fromEntries(bug.systemInfo),
    evidence: localEvidence.map(({ type, browser, path: evidencePath }) => ({ type, browser, path: evidencePath })),
    reportedAt: new Date().toISOString()
  };
  await saveLocalBug(storyId, record, bugMarkdown(bug, { storyId, bugId, azure, localEvidence }));
  await linkBugInReport(storyId, scenarioId, bugId, azure.id);
  return { ...azure, bugId, sourceStoryId: Number(storyId), reproSteps: record.reproSteps, evidence: record.evidence };
}

function mcpResult(text, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

async function handleMcp(message) {
  const { id, method, params = {} } = message;
  if (method === "initialize") {
    return { jsonrpc: "2.0", id, result: { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "azure-devops-importer", version: "1.0.0" } } };
  }
  if (method === "notifications/initialized") return null;
  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: [
      { name: "import_work_item", description: "Lee un Work Item de Azure DevOps y lo guarda en 2-inputs/US-{id}/historia.md.", inputSchema: { type: "object", properties: { id: { type: "integer", description: "ID del Work Item" } }, required: ["id"] } },
      { name: "search_work_items", description: "Busca User Stories y Product Backlog Items mediante WIQL.", inputSchema: { type: "object", properties: { wiql: { type: "string", description: "Consulta WIQL opcional" } } } },
      { name: "create_azure_bug", description: "Registra en Azure DevOps el bug de un escenario que falló, con paso a paso y evidencias. El paso a paso sale del plan (marcando el paso que falló), System Info y criterios de aceptación de la historia, y se adjuntan automáticamente la captura (incrustada en el paso que falla), el video, el trace y el estado de la página de execution-report.json. Evita duplicados (si ya existe, añade la evidencia como re-test), guarda el bug en bugs/US-{id}-bugs.json|md y lo vincula en execution-report.json. Se rechaza si el escenario no figura como FAIL, si no hay evidencias o si solo falló por tiempo de espera sin reproducirlo.", inputSchema: { type: "object", properties: { sourceStoryId: { type: "integer", description: "ID de la historia." }, scenarioId: { type: "string", description: "Escenario SC_NNN que falló en execution-report.json." }, title: { type: "string", description: "Título breve y observable del defecto." }, severity: { type: "string", enum: ["1 - Critical", "2 - High", "3 - Medium", "4 - Low"] }, impact: { type: "string", description: "Usuarios, proceso o datos afectados." }, expectedResult: { type: "string", description: "Opcional: por defecto, el resultado esperado del plan." }, actualResult: { type: "string", description: "Opcional: por defecto, el error de la ejecución." }, reproSteps: { type: "string", description: "Opcional: solo si el plan no tiene pasos para el escenario." }, evidence: { type: "string", description: "Opcional: notas del análisis (p. ej. respuesta HTTP observada)." }, evidenceFilePath: { type: "string", description: "Opcional: evidencia extra dentro de 3-outputs/run/US-{id}/." }, timeoutReproduced: { type: "boolean", description: "true solo si un fallo por tiempo de espera se reprodujo manualmente." }, dryRun: { type: "boolean", description: "true para ver el bug completo sin crearlo." } }, required: ["sourceStoryId", "scenarioId", "title"] } }
    ] } };
  }
  if (method === "tools/call") {
    try {
      const name = params.name;
      if (name === "import_work_item") return { jsonrpc: "2.0", id, result: mcpResult(JSON.stringify(await importWorkItem(params.arguments?.id), null, 2)) };
      if (name === "search_work_items") return { jsonrpc: "2.0", id, result: mcpResult(JSON.stringify(await searchWorkItems(params.arguments?.wiql), null, 2)) };
      if (name === "create_azure_bug") return { jsonrpc: "2.0", id, result: mcpResult(JSON.stringify(await createAzureBug(params.arguments || {}), null, 2)) };
      return { jsonrpc: "2.0", id, result: mcpResult(`Herramienta desconocida: ${name}`, true) };
    } catch (error) {
      return { jsonrpc: "2.0", id, result: mcpResult(error.message, true) };
    }
  }
  if (id === undefined) return null;
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Método no soportado: ${method}` } };
}

async function runMcpServer() {
  const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of input) {
    if (!line.trim()) continue;
    try {
      const response = await handleMcp(JSON.parse(line));
      if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
    } catch (error) {
      process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: error.message } })}\n`);
    }
  }
}

export { createAzureBug, importWorkItem, searchWorkItems };

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const [command, argument] = process.argv.slice(2);
  if (command === "import") {
    importWorkItem(argument).then(result => console.log(`Importada US-${result.id}: ${result.title}\n${result.outputPath}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
  } else if (command === "bug" || command === "bug-preview") {
    // node tools/azure-devops-importer.mjs bug-preview 79 SC_010 ["Título"] [severidad]
    const [, , storyId, scenarioId, title, severity] = process.argv.slice(1);
    createAzureBug({ sourceStoryId: storyId, scenarioId, title, severity: severity || "3 - Medium", dryRun: command === "bug-preview" })
      .then(result => console.log(command === "bug-preview" ? result.markdown : JSON.stringify(result, null, 2)))
      .catch(error => { console.error(error.message); process.exitCode = 1; });
  } else if (command === "search") {
    searchWorkItems(argument).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
  } else {
    runMcpServer().catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
