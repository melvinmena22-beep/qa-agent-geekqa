#!/usr/bin/env node

import fs from "node:fs/promises";import path from "node:path";
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

async function createAzureBug({ sourceStoryId, title, reproSteps, expectedResult, actualResult, environment, severity = "3 - Medium", impact = "No especificado", evidence = "", evidenceFilePath = "" }) {
  if (!/^\d+$/.test(String(sourceStoryId))) throw new Error("El ID de la historia relacionada debe ser numérico.");
  if (!title?.trim() || !reproSteps?.trim() || !expectedResult?.trim() || !actualResult?.trim()) {
    throw new Error("El bug requiere título, pasos de reproducción, resultado esperado y resultado actual.");
  }
  const allowedSeverities = new Set(["1 - Critical", "2 - High", "3 - Medium", "4 - Low"]);
  if (!allowedSeverities.has(severity)) throw new Error("La severidad debe ser 1 - Critical, 2 - High, 3 - Medium o 4 - Low.");

  const source = await getWorkItem(sourceStoryId);
  const fields = source.fields || {};
  const evidenceFile = await resolveBugEvidence(sourceStoryId, evidenceFilePath);
  const escapedTitle = title.trim().replace(/'/g, "''");
  const duplicates = await searchWorkItems(`SELECT [System.Id], [System.Title] FROM WorkItems WHERE [System.TeamProject] = @project AND [System.WorkItemType] = 'Bug' AND [System.Parent] = ${Number(sourceStoryId)} AND [System.Title] = '${escapedTitle}'`);
  if (duplicates.workItems?.length) {
    const existing = await getWorkItem(duplicates.workItems[0].id);
    let attachedEvidence = false;
    if (evidenceFile && !existing.relations?.some(relation => relation.rel === "AttachedFile" && relation.attributes?.name === evidenceFile.name)) {
      const attachment = await uploadBugEvidence(evidenceFile);
      await adoRequest(apiUrl(`/_apis/wit/workitems/${existing.id}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json-patch+json" },
        body: JSON.stringify([{ op: "add", path: "/relations/-", value: attachedFileRelation(attachment, `Evidencia del bug: ${title.trim()}`) }])
      });
      attachedEvidence = true;
    }
    return {
      id: existing.id,
      title: field(existing.fields, "System.Title"),
      url: existing._links?.html?.href || `${organizationUrl}/${encodeURIComponent(project)}/_workitems/edit/${existing.id}`,
      sourceStoryId: Number(sourceStoryId),
      alreadyExists: true,
      ...(evidenceFile ? { evidenceAttached: attachedEvidence || existing.relations?.some(relation => relation.rel === "AttachedFile" && relation.attributes?.name === evidenceFile.name), evidenceFileName: evidenceFile.name } : {})
    };
  }

  async function resolveBugEvidence(sourceStoryId, evidenceFilePath) {
    if (!evidenceFilePath) return null;
    const runDirectory = path.resolve(workspaceRoot, "3-outputs", "run", `US-${sourceStoryId}`);
    const requestedPath = path.resolve(workspaceRoot, evidenceFilePath);
    const realRunDirectory = await fs.realpath(runDirectory);
    const realEvidencePath = await fs.realpath(requestedPath);
    const relativePath = path.relative(realRunDirectory, realEvidencePath);
    if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
      throw new Error("La evidencia debe estar dentro de 3-outputs/run/US-{id}/.");
    }
    const extension = path.extname(realEvidencePath).toLowerCase();
    const contentTypes = new Map([[".png", "image/png"], [".jpg", "image/jpeg"], [".jpeg", "image/jpeg"], [".webp", "image/webp"], [".gif", "image/gif"]]);
    const contentType = contentTypes.get(extension);
    if (!contentType) throw new Error("La evidencia adjunta debe ser una imagen PNG, JPG, WEBP o GIF.");
    const stats = await fs.stat(realEvidencePath);
    if (!stats.isFile() || stats.size === 0 || stats.size > 40 * 1024 * 1024) {
      throw new Error("La evidencia debe ser un archivo de imagen no vacío de hasta 40 MB.");
    }
    return { path: realEvidencePath, name: path.basename(realEvidencePath), contentType };
  }

  async function uploadBugEvidence(evidenceFile) {
    const url = apiUrl("/_apis/wit/attachments", { fileName: evidenceFile.name });
    const token = Buffer.from(`:${requirePat()}`).toString("base64");
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Basic ${token}`,
        "Content-Type": "application/octet-stream"
      },
      body: await fs.readFile(evidenceFile.path)
    });
    const body = await response.text();
    if (response.status >= 300 || response.status === 203) {
      throw new Error(`Azure DevOps no pudo subir la evidencia (${response.status}): ${body.slice(0, 500)}`);
    }
    try {
      const uploaded = JSON.parse(body);
      if (!uploaded.url) throw new Error("Azure DevOps no devolvió la URL del adjunto.");
      return uploaded;
    } catch (error) {
      throw new Error(`No se pudo interpretar la respuesta de carga de evidencia: ${error.message}`);
    }
  }

  function attachedFileRelation(attachment, comment) {
    return {
      rel: "AttachedFile",
      url: attachment.url,
      attributes: { comment, name: attachment.name }
    };
  }
  const acceptanceCriteria = stripHtml(field(fields, "Microsoft.VSTS.Common.AcceptanceCriteria"));
  const description = [
    `<b>Historia relacionada:</b> US-${sourceStoryId}`,
    `<b>Impacto:</b> ${escapeHtml(impact)}`,
    `<b>Resultado esperado:</b><br>${escapeHtml(expectedResult).replace(/\r?\n/g, "<br>")}`,
    `<b>Resultado actual:</b><br>${escapeHtml(actualResult).replace(/\r?\n/g, "<br>")}`,
    `<b>Ambiente:</b> ${escapeHtml(environment || "No especificado")}`,
    `<b>Usuario tester:</b> No especificado`,
    `<b>Actividad, resolución, compromiso y Build:</b> No disponibles al crear el bug`,
    acceptanceCriteria ? `<b>Criterios de aceptación de la historia:</b><br>${escapeHtml(acceptanceCriteria).replace(/\r?\n/g, "<br>")}` : "",
    evidence ? `<b>Evidencia:</b><br>${escapeHtml(evidence).replace(/\r?\n/g, "<br>")}` : "",
    evidenceFile ? `<b>Captura adjunta:</b> ${escapeHtml(evidenceFile.name)}` : ""
  ].filter(Boolean).join("<br><br>");
  const patch = [
    { op: "add", path: "/fields/System.Title", value: title.trim() },
    { op: "add", path: "/fields/System.Description", value: description },
    { op: "add", path: "/fields/Microsoft.VSTS.TCM.ReproSteps", value: `<ol>${reproSteps.split(/\r?\n/).filter(Boolean).map(step => `<li>${escapeHtml(step.replace(/^\s*\d+[.)]\s*/, ""))}</li>`).join("")}</ol>` },
    { op: "add", path: "/fields/Microsoft.VSTS.TCM.SystemInfo", value: escapeHtml(environment || "No especificado") },
    { op: "add", path: "/fields/Microsoft.VSTS.Common.Severity", value: severity }
  ];
  if (fields["System.AreaPath"]) patch.push({ op: "add", path: "/fields/System.AreaPath", value: fields["System.AreaPath"] });
  if (fields["System.IterationPath"]) patch.push({ op: "add", path: "/fields/System.IterationPath", value: fields["System.IterationPath"] });
  if (evidenceFile) {
    const attachment = await uploadBugEvidence(evidenceFile);
    patch.push({ op: "add", path: "/relations/-", value: attachedFileRelation(attachment, `Evidencia del bug: ${title.trim()}`) });
  }
  patch.push({
    op: "add",
    path: "/relations/-",
    value: {
      rel: "System.LinkTypes.Hierarchy-Reverse",
      url: `${organizationUrl}/${encodeURIComponent(project)}/_apis/wit/workItems/${sourceStoryId}`,
      attributes: { comment: `Bug encontrado durante pruebas de US-${sourceStoryId}` }
    }
  });

  const created = await adoRequest(apiUrl("/_apis/wit/workitems/$Bug"), {
    method: "POST",
    headers: { "Content-Type": "application/json-patch+json" },
    body: JSON.stringify(patch)
  });
  return {
    id: created.id,
    title: field(created.fields, "System.Title"),
    url: created._links?.html?.href || `${organizationUrl}/${encodeURIComponent(project)}/_workitems/edit/${created.id}`,
    sourceStoryId: Number(sourceStoryId),
    ...(evidenceFile ? { evidenceAttached: true, evidenceFileName: evidenceFile.name } : {})
  };
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
      { name: "create_azure_bug", description: "Crea un Bug reproducible en Azure DevOps con Repro Steps, System Info, Acceptance Criteria y Details; hereda área e iteración, lo vincula como hijo de la historia origen y adjunta una captura local de evidencia si se proporciona.", inputSchema: { type: "object", properties: { sourceStoryId: { type: "integer" }, title: { type: "string" }, reproSteps: { type: "string" }, expectedResult: { type: "string" }, actualResult: { type: "string" }, environment: { type: "string" }, severity: { type: "string", enum: ["1 - Critical", "2 - High", "3 - Medium", "4 - Low"] }, impact: { type: "string" }, evidence: { type: "string" }, evidenceFilePath: { type: "string", description: "Ruta absoluta o relativa al workspace de una captura dentro de 3-outputs/run/US-{sourceStoryId}/; se adjunta al Bug de Azure DevOps." } }, required: ["sourceStoryId", "title", "reproSteps", "expectedResult", "actualResult", "environment"] } }
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
  } else if (command === "search") {
    searchWorkItems(argument).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
  } else {
    runMcpServer().catch(error => { console.error(error.message); process.exitCode = 1; });
  }
}
