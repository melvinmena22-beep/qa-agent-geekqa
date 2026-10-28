// Controles deterministas que no dependen del modelo: validan specs generados, planes,
// reportes y bugs antes de que un resultado del agente se considere verídico.

import fs from "node:fs/promises";
import path from "node:path";

// ---------------------------------------------------------------------------
// IDs de escenarios
// ---------------------------------------------------------------------------

export const SCENARIO_ID = /^SC_\d{3}$/;

// Normaliza los IDs del plan a SC_NNN (los planes antiguos usan SC_01 o S001).
// Conserva el ID original en legacyId y actualiza selectedScenarioIds. Devuelve true si cambió algo.
export function normalizePlanScenarioIds(plan) {
  if (!Array.isArray(plan?.testScenarios)) return false;
  const renamed = new Map();
  plan.testScenarios.forEach((scenario, index) => {
    const id = `SC_${String(index + 1).padStart(3, "0")}`;
    if (scenario.id === id) return;
    if (scenario.id) renamed.set(scenario.id, id);
    scenario.legacyId = scenario.legacyId || scenario.id || null;
    scenario.id = id;
  });
  if (!renamed.size) return false;
  if (Array.isArray(plan.selectedScenarioIds)) {
    plan.selectedScenarioIds = plan.selectedScenarioIds.map(id => renamed.get(id) || id);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Auditoría estática del spec generado
// ---------------------------------------------------------------------------

const ASSERTION = /\bexpect(?:\.soft|\.poll)?\s*\(|\.to(?:Be|Have|Contain|Match|Equal|Throw)\w*\s*\(/;
const TAUTOLOGY = /\bexpect(?:\.soft)?\s*\(\s*(?:true|false|null|undefined|-?\d+(?:\.\d+)?|(['"`])[^'"`]*\1)\s*\)/;
const TEST_DECLARATION = /\btest(?:\.(?:only|skip|fixme|fail))?\(\s*(['"`])((?:(?!\1)[\s\S])*?)\1/g;
const DESCRIBE_DECLARATION = /\btest\.describe(?:\.\w+)?\(/g;
const HELPER_DECLARATION = /(?:\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>|\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\()/g;

// Quita comentarios para que el código comentado no cuente como aserción.
export function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map(line => (/^\s*\/\//.test(line) ? "" : line.replace(/([;{}(),])\s*\/\/.*$/, "$1")))
    .join("\n");
}

// Dominio base de un host: sideraqa.gruposid.com.do → gruposid.com.do; uniwebpro.geekqa.net → geekqa.net.
export function baseDomain(host) {
  const labels = String(host || "").toLowerCase().split(".").filter(Boolean);
  if (labels.length <= 2) return labels.join(".");
  const secondLevel = labels.length >= 3 && labels[labels.length - 2].length <= 3 && labels[labels.length - 1].length === 2;
  return labels.slice(secondLevel ? -3 : -2).join(".");
}

export function hostAllowed(host, allowedHosts) {
  const domain = baseDomain(host);
  return allowedHosts.some(allowed => baseDomain(allowed) === domain);
}

function hostsIn(text) {
  return [...text.matchAll(/(['"`])https?:\/\/([^/'"`\s:?#]+)/g)].map(match => match[2].toLowerCase());
}

function unconditionalSkip(body) {
  const lines = body.split("\n");
  return lines.some((line, index) => {
    if (!/\btest\.(?:skip|fixme)\(\s*(?:true\s*,|\))/.test(line) || /\bif\s*\(/.test(line)) return false;
    const previous = lines.slice(0, index).reverse().find(item => item.trim());
    return !(previous && /\bif\s*\(.*\)\s*\{?\s*$/.test(previous));
  });
}

// Revisa cada test del spec. Un test es inválido si no tiene aserciones reales, usa aserciones
// tautológicas o navega a un dominio distinto del ambiente de la historia. Los tests bloqueados con
// test.skip(true, "BLOCKED/...") son válidos, pero se marcan como placeholder.
export function auditSpec(source, { planIds = [], allowedHosts = [] } = {}) {
  const code = stripComments(source);
  const declarations = [...code.matchAll(TEST_DECLARATION)].map(match => ({ index: match.index, end: match.index + match[0].length, title: match[2] }));
  const describes = [...code.matchAll(DESCRIBE_DECLARATION)].map(match => match.index);
  const boundaries = [...declarations.map(item => item.index), ...describes, code.length].sort((a, b) => a - b);
  const nextBoundary = from => boundaries.find(index => index > from) ?? code.length;

  // Funciones auxiliares que contienen aserciones (directamente o llamando a otras que las tienen).
  const helperStarts = [...code.matchAll(HELPER_DECLARATION)].map(match => ({ name: match[1] || match[2], index: match.index }));
  const helperBodies = helperStarts.map((helper, position) => {
    const end = Math.min(helperStarts[position + 1]?.index ?? code.length, nextBoundary(helper.index));
    return { name: helper.name, body: code.slice(helper.index, end) };
  });
  const asserting = new Set(helperBodies.filter(helper => ASSERTION.test(helper.body)).map(helper => helper.name));
  for (let changed = true; changed;) {
    changed = false;
    for (const helper of helperBodies) {
      if (asserting.has(helper.name)) continue;
      if ([...asserting].some(name => new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*\\(`).test(helper.body))) {
        asserting.add(helper.name);
        changed = true;
      }
    }
  }
  const callsAssertingHelper = body => [...asserting].some(name => new RegExp(`\\b${name.replace(/\$/g, "\\$")}\\s*\\(`).test(body));

  // Constantes de texto del spec (p. ej. const CREDENTIALS = 'BLOCKED/CREDENTIALS: …') para leer el motivo real de cada skip.
  const constants = new Map([...code.matchAll(/\bconst\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])((?:(?!\2)[^\\]|\\.)*)\2/g)].map(match => [match[1], match[3]]));
  const resolveConstants = text => text
    .replace(/\$\{\s*([A-Za-z_$][\w$]*)\s*\}/g, (whole, name) => constants.get(name) ?? whole)
    .replace(/\b[A-Za-z_$][\w$]*\b/g, name => constants.get(name) ?? name);

  const topLevel = code.slice(0, declarations[0]?.index ?? code.length);
  const foreignTopLevel = allowedHosts.length ? hostsIn(topLevel).filter(host => !hostAllowed(host, allowedHosts)) : [];
  const knownIds = new Set(planIds);

  const tests = declarations.map(declaration => {
    const body = code.slice(declaration.end, nextBoundary(declaration.index));
    const id = declaration.title.match(/^\s*(SC_\d+)\s*:/)?.[1] || null;
    const issues = [];
    const placeholder = unconditionalSkip(body);
    if (!id) issues.push(`el título no empieza por "SC_XXX:" ("${declaration.title.slice(0, 60)}")`);
    else if (!SCENARIO_ID.test(id)) issues.push(`el ID ${id} no tiene el formato SC_NNN`);
    else if (knownIds.size && !knownIds.has(id)) issues.push(`${id} no existe en el plan de pruebas`);
    if (TAUTOLOGY.test(body)) issues.push("usa una aserción tautológica (expect de un valor constante)");
    if (!placeholder && !ASSERTION.test(body) && !callsAssertingHelper(body)) issues.push("no tiene ninguna aserción que verifique el resultado");
    const foreign = [...new Set([...foreignTopLevel, ...(allowedHosts.length ? hostsIn(body).filter(host => !hostAllowed(host, allowedHosts)) : [])])];
    if (foreign.length) issues.push(`navega a un dominio ajeno al ambiente de la historia (${foreign.join(", ")})`);
    const skipReason = placeholder ? resolveConstants(body.match(/\btest\.(?:skip|fixme)\(\s*true\s*,\s*([^\n]*)/)?.[1]?.trim() || "") : "";
    return { id, title: declaration.title, valid: issues.length === 0, placeholder, skipReason, issues };
  });
  return { tests, invalid: tests.filter(test => !test.valid) };
}

// Mapa escenario → motivo de invalidez para los escenarios seleccionados.
export function invalidScenarios(audit, scenarioIds) {
  const result = new Map();
  for (const test of audit.invalid) {
    if (test.id && scenarioIds.includes(test.id)) result.set(test.id, test.issues.join("; "));
  }
  return result;
}

// ---------------------------------------------------------------------------
// Esquema de execution-report.json
// ---------------------------------------------------------------------------

// Validador mínimo de JSON Schema (type, required, enum, properties, items, minimum, pattern).
export function validateSchema(value, schema, at = "$") {
  const errors = [];
  const types = [].concat(schema.type || []);
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
  if (types.length && !types.some(type => type === actual || (type === "number" && actual === "integer"))) {
    return [`${at}: se esperaba ${types.join(" | ")} y se recibió ${actual}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${at}: valor ${JSON.stringify(value)} fuera de ${JSON.stringify(schema.enum)}`);
  if (schema.pattern && typeof value === "string" && !new RegExp(schema.pattern).test(value)) errors.push(`${at}: "${value}" no cumple ${schema.pattern}`);
  if (schema.minimum !== undefined && typeof value === "number" && value < schema.minimum) errors.push(`${at}: ${value} < ${schema.minimum}`);
  if (actual === "object") {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${at}: falta la propiedad "${key}"`);
    for (const [key, child] of Object.entries(schema.properties || {})) {
      if (key in value) errors.push(...validateSchema(value[key], child, `${at}.${key}`));
    }
  }
  if (actual === "array" && schema.items) value.forEach((item, index) => errors.push(...validateSchema(item, schema.items, `${at}[${index}]`)));
  return errors;
}

let cachedSchema = null;
export async function loadExecutionReportSchema(workspaceRoot) {
  cachedSchema ||= JSON.parse(await fs.readFile(path.join(workspaceRoot, "schemas", "execution-report.schema.json"), "utf8"));
  return cachedSchema;
}

export async function validateExecutionReport(workspaceRoot, report) {
  const schema = await loadExecutionReportSchema(workspaceRoot);
  const errors = validateSchema(report, schema);
  const { total, passed, failed, blocked } = report?.summary || {};
  if (!errors.length && Array.isArray(report.scenarios)) {
    const count = status => report.scenarios.filter(item => item.status === status).length;
    if (total !== report.scenarios.length || passed !== count("PASS") || failed !== count("FAIL") || blocked !== count("BLOCKED")) {
      errors.push("$.summary: los totales no coinciden con los escenarios");
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Bugs de Azure DevOps
// ---------------------------------------------------------------------------

// URLs del ambiente de la historia: "URL de pruebas" de historia.md y url del plan.
export async function storyEnvironmentHosts(workspaceRoot, storyId) {
  const hosts = new Set();
  try {
    const story = await fs.readFile(path.join(workspaceRoot, "2-inputs", `US-${storyId}`, "historia.md"), "utf8");
    for (const match of story.matchAll(/URL de pruebas:\s*(https?:\/\/\S+)/gi)) hosts.add(new URL(match[1]).hostname);
  } catch {}
  try {
    const plan = JSON.parse(await fs.readFile(path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "planning", `US-${storyId}-plan.json`), "utf8"));
    if (plan.url) hosts.add(new URL(plan.url).hostname);
  } catch {}
  return [...hosts];
}

// Un bug solo se registra si el escenario falló en la ejecución registrada, el ambiente es el de la
// historia y hay evidencia (captura, video o trace de esa ejecución). Lanza un error con el motivo cuando no se cumple.
export function checkBugGate({ report, scenarioId, environment, evidenceFiles = [], allowedHosts, timeoutReproduced = false }) {
  if (!scenarioId || !SCENARIO_ID.test(scenarioId)) throw new Error("Bug rechazado: indica scenarioId (SC_NNN) del escenario que falló.");
  if (!report) throw new Error("Bug rechazado: no existe execution/execution-report.json de esta historia.");
  const failures = (report.scenarios || []).filter(item => item.id === scenarioId && item.status === "FAIL");
  if (!failures.length) throw new Error(`Bug rechazado: ${scenarioId} no figura como FAIL en execution-report.json.`);
  if (!evidenceFiles.length) throw new Error(`Bug rechazado: la ejecución de ${scenarioId} no dejó evidencias (captura, video o trace). Vuelve a ejecutar el caso.`);
  if (failures.every(item => item.failureType === "TIMEOUT") && !timeoutReproduced) {
    throw new Error(`Bug rechazado: ${scenarioId} solo falló por tiempo de espera. Reprodúcelo manualmente y reintenta con timeoutReproduced: true.`);
  }
  const hosts = [...String(environment || "").matchAll(/https?:\/\/([^/\s:?#'"`]+)/g)].map(match => match[1].toLowerCase());
  if (!allowedHosts.length) throw new Error("Bug rechazado: la historia no tiene URL de pruebas registrada.");
  if (!hosts.length) throw new Error("Bug rechazado: environment debe incluir la URL donde se reprodujo el fallo.");
  const foreign = hosts.filter(host => !hostAllowed(host, allowedHosts));
  if (foreign.length) throw new Error(`Bug rechazado: el ambiente (${foreign.join(", ")}) no corresponde a la URL de pruebas de la historia (${allowedHosts.join(", ")}).`);
}

// ---------------------------------------------------------------------------
// Login obligatorio
// ---------------------------------------------------------------------------

// Motivos de bloqueo que indican que el spec no pudo automatizar un caso por falta de login.
export const LOGIN_BLOCK = /BLOCKED\/(CREDENTIALS|AUTH_REQUIRED|LOCATORS_PENDING)|PENDING_UI/;

// Tests del spec bloqueados por falta de login (placeholders generados sin credenciales).
export function loginPlaceholders(audit, scenarioIds = null) {
  return audit.tests.filter(test => test.placeholder && LOGIN_BLOCK.test(test.skipReason) && (!scenarioIds || scenarioIds.includes(test.id)));
}

// Una historia requiere login si lo indica cualquiera de sus fuentes: la detección en la web
// (login-probe), el plan (la IA lo deduce de la historia) o el spec (el agente encontró login al generarlo).
export function resolveLoginRequirement({ detected = null, planAuthentication = null, specRequiresLogin = false } = {}) {
  const sources = [];
  if (detected?.requiresLogin === true) sources.push({ source: "web", evidence: detected.evidence || "La URL de pruebas exige iniciar sesión." });
  if (planAuthentication?.required === true) sources.push({ source: "plan", evidence: planAuthentication.evidence || planAuthentication.reason || "El plan indica que la funcionalidad requiere usuario autenticado." });
  if (specRequiresLogin) sources.push({ source: "spec", evidence: "Al generar el script, el agente encontró que las pantallas exigen iniciar sesión." });
  return { required: sources.length > 0, sources };
}

// Mensaje de bloqueo si la historia requiere login y no hay credenciales o sesión válidas; null si se puede ejecutar.
export function loginGateMessage(requirement, status) {
  if (!requirement?.required || status?.ready) return null;
  const why = requirement.sources?.map(item => item.evidence).join(" ") || "La aplicación exige iniciar sesión.";
  return `No se ejecutan pruebas sin un usuario válido: ${why} Guarda un usuario y contraseña de prueba con "Validar y guardar" (o inicia sesión en el navegador si usa SSO/MFA) y vuelve a ejecutar.`;
}

// ---------------------------------------------------------------------------
// Peticiones HTTP al runner
// ---------------------------------------------------------------------------

// Solo se aceptan peticiones dirigidas a localhost (evita DNS rebinding) y, si vienen de un navegador,
// desde la propia página del runner (evita que otra web lance ejecuciones).
export function isTrustedRequest({ method = "GET", headers = {} }, port) {
  const allowedHosts = new Set([`localhost:${port}`, `127.0.0.1:${port}`]);
  if (!allowedHosts.has(String(headers.host || "").toLowerCase())) return false;
  const origin = headers.origin;
  if (origin && !allowedHosts.has(origin.replace(/^http:\/\//i, "").toLowerCase())) return false;
  const site = headers["sec-fetch-site"];
  if (site && !["same-origin", "none"].includes(site)) return false;
  if (!["GET", "HEAD"].includes(method)) {
    const type = String(headers["content-type"] || "").toLowerCase();
    if (!type.startsWith("application/json") && !type.startsWith("application/x-www-form-urlencoded")) return false;
    if (type.startsWith("application/x-www-form-urlencoded") && !origin) return false;
  }
  return true;
}
