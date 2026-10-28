#!/usr/bin/env node

import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { importWorkItem } from "./azure-devops-importer.mjs";
import { buildExecutionReport, findMissingScenarios, mergeExecutionReports, NO_RUN, partSpecPath, runPlaywright, specFiles, writeHtmlReport } from "./hybrid-executor.mjs";
import { derivePendingInputs, inputEnvBase, inputEnvForTests, validateInputValues } from "./test-inputs.mjs";
import { auditSpec, invalidScenarios, isTrustedRequest, loginGateMessage, loginPlaceholders, normalizePlanScenarioIds, resolveLoginRequirement, storyEnvironmentHosts, validateExecutionReport } from "./qa-guards.mjs";

// Versión fijada del servidor MCP de Playwright (la misma de .mcp.json) para que las ejecuciones sean reproducibles.
const PLAYWRIGHT_MCP_PACKAGE = "@playwright/mcp@0.0.83";

const port = Number(process.env.QA_RUNNER_PORT || 8787);
let activeRun = null;
let activePreparation = null;
const completedRuns = new Map();
const preparations = new Map();
const preparedRuns = new Map();
const packageDir = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const workspaceRoot = existsSync(path.join(process.cwd(), "tools", "qa-runner.mjs"))
  ? process.cwd()
  : packageDir;

// Proveedor del agente QA: "claude" (Claude Code, por defecto) o "agy" (Antigravity CLI).
function getAgentProvider() {
  const provider = String(process.env.QA_AGENT || "claude").trim().toLowerCase();
  if (!["claude", "agy"].includes(provider)) {
    throw new Error(`QA_AGENT="${provider}" no es válido. Usa "claude" o "agy".`);
  }
  return provider;
}

function resolveClaudeCommand() {
  if (process.env.CLAUDE_COMMAND && (existsSync(process.env.CLAUDE_COMMAND) || !process.env.CLAUDE_COMMAND.includes(path.sep))) {
    return process.env.CLAUDE_COMMAND;
  }
  const home = process.env.USERPROFILE || process.env.HOME || "";
  const executable = process.platform === "win32" ? "claude.exe" : "claude";
  const candidates = [
    path.join(home, ".local", "bin", executable),
    process.platform === "win32" && process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "claude.cmd") : null
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  // Binario incluido en la extensión "Claude Code for VS Code" (VS Code o Antigravity); se usa la versión más reciente.
  for (const editorDir of [".vscode", ".antigravity", ".cursor"]) {
    const extensionsDir = path.join(home, editorDir, "extensions");
    if (!existsSync(extensionsDir)) continue;
    const bundled = readdirSync(extensionsDir)
      .filter(name => name.startsWith("anthropic.claude-code-"))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map(name => path.join(extensionsDir, name, "resources", "native-binary", executable))
      .find(candidate => existsSync(candidate));
    if (bundled) return bundled;
  }
  return "claude";
}

// Las variables QA_US{id}_* pertenecen a una historia; si se indica storyId, se omiten las de otras historias.
function belongsToStory(name, storyId) {
  return storyId === undefined || !/^QA_US\d+_/.test(name) || name.startsWith(`QA_US${storyId}_`);
}

// Sesiones guardadas (save-session.mjs o qa-runner.html): variables *_STORAGE_STATE de .env cuyo archivo existe.
function savedSessions(storyId) {
  return Object.keys(process.env)
    .filter(name => /^[A-Z][A-Z0-9_]*_STORAGE_STATE$/.test(name) && belongsToStory(name, storyId))
    .map(name => ({ name, file: path.resolve(workspaceRoot, process.env[name]), server: `playwright-session-${name.replace(/_STORAGE_STATE$/, "").toLowerCase().replace(/_/g, "-")}` }))
    .filter(session => existsSync(session.file));
}

// Variables de credenciales de prueba definidas en .env (solo los nombres; los valores no se pasan al prompt).
function credentialVariables(storyId) {
  return Object.keys(process.env).filter(name => /^[A-Z][A-Z0-9_]*_(EMAIL|USER|USERNAME|PASSWORD)$/.test(name) && !name.startsWith("AZDO_") && !/^QA_US\d+_/.test(name) && belongsToStory(name, storyId));
}

// Sesión de login por historia. El usuario y la contraseña NUNCA se guardan en disco: solo se usan para
// iniciar sesión y quedan en memoria mientras el runner está en marcha (para renovar la sesión). En .env
// se registra únicamente la ruta de la sesión iniciada (.auth/, excluida de Git).
const memoryCredentials = new Map();

function storyCredentialNames(storyId) {
  return { state: `QA_US${storyId}_STORAGE_STATE` };
}

function storyLoginStatus(storyId) {
  const names = storyCredentialNames(storyId);
  const credentials = memoryCredentials.get(String(storyId));
  const hasCredentials = Boolean(credentials);
  const hasSession = Boolean(process.env[names.state] && existsSync(path.resolve(workspaceRoot, process.env[names.state])));
  return { hasCredentials, hasSession, ready: hasCredentials || hasSession, username: credentials?.username || null };
}

// Requisito de login por historia (detección en la web, plan y spec). Se guarda en .auth/ para que
// sobreviva a las recargas del runner; .auth/ está excluida de Git.
const loginRequirementsPath = path.join(workspaceRoot, ".auth", "login-requirements.json");

function readLoginRequirements() {
  try {
    return JSON.parse(readFileSync(loginRequirementsPath, "utf8"));
  } catch {
    return {};
  }
}

async function saveLoginRequirement(storyId, patch) {
  const all = readLoginRequirements();
  all[storyId] = { ...(all[storyId] || {}), ...patch, updatedAt: new Date().toISOString() };
  await fs.mkdir(path.dirname(loginRequirementsPath), { recursive: true });
  await fs.writeFile(loginRequirementsPath, `${JSON.stringify(all, null, 2)}\n`, "utf8");
}

function planAuthentication(storyId) {
  try {
    return JSON.parse(readFileSync(path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "planning", `US-${storyId}-plan.json`), "utf8")).authentication || null;
  } catch {
    return null;
  }
}

function storyLoginRequirement(storyId) {
  const stored = readLoginRequirements()[storyId] || {};
  return resolveLoginRequirement({ detected: stored.detected, planAuthentication: planAuthentication(storyId), specRequiresLogin: stored.specRequiresLogin === true });
}

// Estado de login que ve qa-runner.html: si la historia lo exige, por qué, y si hay credenciales o sesión.
function loginState(storyId) {
  const stored = readLoginRequirements()[storyId] || {};
  const detected = stored.detected || {};
  const requirement = storyLoginRequirement(storyId);
  return {
    ...storyLoginStatus(storyId),
    requiresLogin: requirement.required,
    evidence: requirement.sources.map(item => item.evidence),
    loginType: detected.loginType === "sso" ? "sso" : "form",
    ssoAvailable: Boolean(detected.ssoAvailable),
    appUrl: stored.appUrl || detected.protectedUrl || null
  };
}

// Mensaje que impide ejecutar si la historia exige login y no hay credenciales ni sesión; null si se puede.
function loginGate(storyId) {
  return loginGateMessage(storyLoginRequirement(storyId), storyLoginStatus(storyId));
}

// Antes de ejecutar, renueva la sesión con el usuario en memoria o comprueba que la sesión guardada sigue activa.
// Si caducó, se descarta para que qa-runner.html vuelva a pedir el inicio de sesión.
async function verifyStoryLogin(storyId, testUrl) {
  const status = storyLoginStatus(storyId);
  if (!storyLoginRequirement(storyId).required && !status.ready) return { ok: true };
  if (status.hasCredentials) {
    const login = await loginWithCredentials(storyId, testUrl);
    if (!login.ok) {
      memoryCredentials.delete(String(storyId));
      return { ok: false, message: `El usuario de US-${storyId} ya no puede iniciar sesión: ${login.reason} Vuelve a iniciar sesión y ejecuta de nuevo.` };
    }
    await setEnvValues({ [storyCredentialNames(storyId).state]: login.statePath });
    if (login.appUrl) await saveLoginRequirement(storyId, { appUrl: login.appUrl });
    return { ok: true };
  }
  if (status.hasSession) {
    const check = await runLoginProbe("check", testUrl, path.resolve(workspaceRoot, process.env[storyCredentialNames(storyId).state]));
    if (!check.ok) {
      await setEnvValues({ [storyCredentialNames(storyId).state]: null });
      return { ok: false, message: `${check.reason || "La sesión guardada ya no es válida."} Vuelve a iniciar sesión (el usuario y la contraseña no se guardan) y ejecuta de nuevo.` };
    }
    return { ok: true };
  }
  return { ok: false, message: loginGate(storyId) };
}

// Actualiza o añade variables en .env (y en este proceso) sin tocar las demás líneas; null las elimina.
async function setEnvValues(values) {
  const envPath = path.join(workspaceRoot, ".env");
  let env = "";
  try { env = await fs.readFile(envPath, "utf8"); } catch {}
  for (const [name, value] of Object.entries(values)) {
    const pattern = new RegExp(`^[ \\t]*${name}[ \\t]*=.*(?:\\r?\\n|$)`, "m");
    if (value === null) {
      env = env.replace(pattern, "");
      delete process.env[name];
      continue;
    }
    const line = `${name}=${value}\n`;
    env = pattern.test(env) ? env.replace(pattern, () => line) : `${env.replace(/\s*$/, "")}\n${line}`;
    process.env[name] = value;
  }
  await fs.writeFile(envPath, env, "utf8");
  // Huella del .env escrito por el runner: el supervisor no lo recarga por sus propios cambios
  // (ya están en process.env), lo que borraría la preparación en curso.
  await fs.mkdir(path.join(workspaceRoot, ".auth"), { recursive: true });
  await fs.writeFile(path.join(workspaceRoot, ".auth", "env-written-by-runner.sha256"), createHash("sha256").update(env).digest("hex"), "utf8");
}

// Ejecuta tools/login-probe.mjs en un proceso aparte y devuelve su resultado JSON.
function runLoginProbe(mode, targetUrl, statePath = null, env = {}, onSpawn = null) {
  return new Promise(resolve => {
    const args = [path.join(workspaceRoot, "tools", "login-probe.mjs"), mode, targetUrl, ...(statePath ? [statePath] : [])];
    // En modo interactivo el stdin queda abierto para recibir "save" cuando el usuario confirma el login.
    const child = spawn(process.execPath, args, { cwd: workspaceRoot, env: { ...process.env, ...env }, stdio: [mode === "interactive" ? "pipe" : "ignore", "pipe", "pipe"] });
    onSpawn?.(child);
    let output = "";
    child.stdout.on("data", chunk => { output += chunk.toString(); });
    child.on("error", error => resolve({ ok: false, reason: error.message }));
    child.on("close", () => {
      try {
        resolve(JSON.parse(output.trim().split(/\r?\n/).pop()));
      } catch {
        resolve({ ok: false, reason: "No se pudo comprobar el login de la aplicación." });
      }
    });
  });
}

// Inicia sesión con usuario y contraseña (los indicados o los que están en memoria) y guarda solo la sesión.
async function loginWithCredentials(storyId, testUrl, credentials = null) {
  const statePath = path.join(workspaceRoot, ".auth", `us${storyId}.json`);
  await fs.mkdir(path.dirname(statePath), { recursive: true });
  const known = credentials || memoryCredentials.get(String(storyId)) || {};
  const result = await runLoginProbe("form", testUrl, statePath, {
    QA_LOGIN_USERNAME: known.username || "",
    QA_LOGIN_PASSWORD: known.password || ""
  });
  return { ...result, statePath: path.relative(workspaceRoot, statePath).split(path.sep).join("/") };
}

// Un servidor MCP Playwright ya autenticado por cada sesión guardada, para que el agente inspeccione pantallas internas.
function writeSessionMcpConfig() {
  const sessions = savedSessions();
  if (!sessions.length) return null;
  const mcpServers = Object.fromEntries(sessions.map(session => [session.server, {
    command: "npx",
    args: ["-y", PLAYWRIGHT_MCP_PACKAGE, "--isolated", "--storage-state", session.file]
  }]));
  const configPath = path.join(workspaceRoot, ".auth", "mcp-sessions.json");
  mkdirSync(path.dirname(configPath), { recursive: true });
  writeFileSync(configPath, `${JSON.stringify({ mcpServers }, null, 2)}\n`, "utf8");
  return configPath;
}

function sessionInstructions(storyId) {
  const sessions = savedSessions(storyId);
  const credentials = credentialVariables(storyId);
  if (!sessions.length && !credentials.length) return "No hay sesiones ni credenciales de prueba configuradas en .env: si una pantalla requiere login, deja el caso bloqueado con test.skip(true, \"BLOCKED/CREDENTIALS: ...\") y no inventes selectores.";
  const parts = [];
  if (sessions.length) parts.push(`Sesiones iniciadas disponibles: ${sessions.map(session => `${session.name} (inspecciona con el servidor MCP ${session.server}, que ya tiene la sesión)`).join("; ")}. En el spec úsalas con test.use({ storageState: process.env.NOMBRE }) leyendo la variable de entorno, nunca una ruta fija.`);
  if (credentials.length) parts.push(`Credenciales de prueba disponibles en las variables ${credentials.join(", ")}: en el spec léelas con process.env; para inspeccionar puedes leer sus valores en .env, pero nunca los escribas en el spec, reportes, capturas ni logs.`);
  parts.push("Si aun así una pantalla no es accesible o faltan datos de prueba, bloquea solo ese caso con test.skip(true, \"BLOCKED/MOTIVO: detalle\").");
  return parts.join(" ");
}

// Herramientas que el agente Claude puede usar sin preguntar (modo dontAsk: lo demás se deniega).
// Solo escribe dentro de 3-outputs/ y solo ejecuta Playwright y Lighthouse; así el contenido de una
// historia o de una web probada no puede llevar al agente a ejecutar comandos arbitrarios.
// QA_AGENT_PERMISSIONS=unrestricted vuelve al modo anterior (--dangerously-skip-permissions).
function claudePermissionArgs(sessionServers = []) {
  if (process.env.QA_AGENT_PERMISSIONS === "unrestricted") return ["--dangerously-skip-permissions"];
  const shellCommands = ["npx playwright test", "npx playwright --version", "npx -y lighthouse@12.2.1", "mkdir"];
  return [
    "--permission-mode", "dontAsk",
    "--allowedTools",
    "Read", "Glob", "Grep", "TodoWrite", "Edit(./3-outputs/**)",
    ...shellCommands.flatMap(command => [`Bash(${command}:*)`, `PowerShell(${command}:*)`]),
    "mcp__playwright-chromium", "mcp__playwright-firefox", "mcp__playwright-webkit", "mcp__azure-devops", "mcp__graphify",
    ...sessionServers.map(server => `mcp__${server}`)
  ];
}

// Argumentos de cada CLI. En Claude el prompt se envía por stdin para evitar problemas de comillas en Windows.
function buildAgentInvocation(prompt) {
  if (getAgentProvider() === "claude") {
    const sessionConfig = writeSessionMcpConfig();
    const args = ["-p", ...claudePermissionArgs(savedSessions().map(session => session.server)), "--add-dir", workspaceRoot, "--mcp-config", path.join(workspaceRoot, ".mcp.json")];
    if (sessionConfig) args.push(sessionConfig);
    if (process.env.CLAUDE_MODEL) args.push("--model", process.env.CLAUDE_MODEL);
    return { command: resolveClaudeCommand(), args, stdin: prompt };
  }
  return { command: resolveAgyCommand(), args: ["--dangerously-skip-permissions", "--add-dir", workspaceRoot, "--prompt", prompt], stdin: null };
}

function spawnAgent(prompt, stdoutMode) {
  const { command, args, stdin } = buildAgentInvocation(prompt);
  const viaShell = process.platform === "win32" && (command.toLowerCase().endsWith(".cmd") || command.toLowerCase().endsWith(".bat"));
  // Con cmd.exe los argumentos con espacios o paréntesis (reglas de --allowedTools) deben ir entre comillas.
  const agent = spawn(viaShell ? `"${command}"` : command, viaShell ? args.map(arg => (/[\s()*&|<>^]/.test(arg) ? `"${arg}"` : arg)) : args, {
    cwd: workspaceRoot,
    detached: false,
    shell: viaShell,
    stdio: [stdin === null ? "ignore" : "pipe", stdoutMode, "pipe"]
  });
  if (stdin !== null) {
    agent.stdin.on("error", () => {});
    agent.stdin.end(stdin);
  }
  return { agent, command };
}

function resolveAgyCommand() {
  if (process.env.AGY_COMMAND && (existsSync(process.env.AGY_COMMAND) || !process.env.AGY_COMMAND.includes(path.sep))) {
    return process.env.AGY_COMMAND;
  }
  if (process.platform === "win32") {
    const candidates = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe") : null,
      process.env.USERPROFILE ? path.join(process.env.USERPROFILE, "AppData", "Local", "agy", "bin", "agy.exe") : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "agy.cmd") : null,
      process.env.APPDATA ? path.join(process.env.APPDATA, "npm", "agy.exe") : null
    ].filter(Boolean);

    for (const candidate of candidates) {
      if (existsSync(candidate)) {
        return candidate;
      }
    }
    return process.env.AGY_COMMAND || "agy.exe";
  }
  return process.env.AGY_COMMAND || "agy";
}
const QA_EXECUTION_BUDGET_MS = Number(process.env.QA_EXECUTION_BUDGET_MS || 600_000);
const AGY_MAX_CAPACITY_RETRIES = 2;
const AGY_CAPACITY_RETRY_DELAYS_MS = [5_000, 15_000];

function isAgyCapacityError(value) {
  return /(?:code\s*503|\b503\b|unavailable|no capacity|capacity available|temporarily unavailable)/i.test(value || "");
}

function stopProcessTree(child) {
  if (!child?.pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true, stdio: "ignore" });
  } else {
    child.kill("SIGTERM");
  }
}

function page(title, content, status = 200) {
  return { status, body: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title><style>:root{font-family:system-ui,sans-serif;color:#17202a;background:#eef2f3}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px}.app{width:min(560px,100%);background:#fff;border:1px solid #d9e0e2;border-radius:18px;box-shadow:0 18px 50px #17202a18;overflow:hidden}.header{padding:28px 30px;background:#173b4d;color:#fff}.eyebrow{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#a9d7d1;font-weight:700}.header h1{margin:10px 0 0;font-size:28px}.body{padding:30px}.label{display:block;font-weight:700;margin-bottom:9px}.field{display:flex;gap:10px}.input{flex:1;min-width:0;border:1px solid #b7c5ca;border-radius:10px;padding:14px 15px;font-size:18px;outline:none}.input:focus{border-color:#16877c;box-shadow:0 0 0 3px #16877c22}.button{border:0;border-radius:10px;padding:0 20px;background:#16877c;color:#fff;font-weight:800;font-size:15px;cursor:pointer}.button:hover{background:#106d65}.hint{color:#5b6870;font-size:14px;margin:12px 0 0}.result{margin-top:24px;padding:16px;border-radius:10px;background:#eef7f5;border:1px solid #b8ded8;color:#155c57}.error{background:#fff2f0;border-color:#f2b8b1;color:#8c241b}code{background:#eef2f3;padding:2px 5px;border-radius:5px}.footer{padding:0 30px 26px;color:#7b878c;font-size:12px}</style></head><body><main class="app"><header class="header"><div class="eyebrow">GeekQA Runner</div><h1>Ejecutar pruebas por tarea</h1></header><section class="body"><form method="get" action="/run"><label class="label" for="taskId">Número de tarea de Azure DevOps</label><div class="field"><input class="input" id="taskId" name="id" inputmode="numeric" pattern="[0-9]+" placeholder="Ej. 123" required autofocus><button class="button" type="submit">Ejecutar QA</button></div><p class="hint">Importa la historia y arranca todo el plan de pruebas desde <code>${getAgentProvider()}</code>.</p></form>${content}</section><footer class="footer">La terminal del runner debe permanecer abierta durante la ejecución.</footer></main></body></html>` };
}

// URL de pruebas registrada en 2-inputs/US-{id}/historia.md (la última guardada por saveTestUrl).
async function storyTestUrl(storyId) {
  try {
    const content = await fs.readFile(path.join(workspaceRoot, "2-inputs", `US-${storyId}`, "historia.md"), "utf8");
    return [...content.matchAll(/^\s*- URL de pruebas:\s*(\S+)/gim)].pop()?.[1] || null;
  } catch {
    return null;
  }
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

  // Algunos agentes devuelven las técnicas como un mapa
  // { "Técnica": "justificación" } en vez del arreglo esperado por la UI.
  // Normalizamos ese formato antes de validar y persistimos el plan corregido.
  if (!Array.isArray(plan.testTechniques) && plan.testTechniques && typeof plan.testTechniques === "object") {
    plan.testTechniques = Object.entries(plan.testTechniques).map(([name, justification]) => ({
      name,
      justification: typeof justification === "string" ? justification : String(justification ?? "")
    }));
  }

  // El runner, el spec y el reporte identifican los casos como SC_NNN.
  normalizePlanScenarioIds(plan);

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

Prepara el plan de pruebas siguiendo qa-test-planner, references/test-case-best-practices.md y las instrucciones del proyecto. Usa la URL ${testUrl}. Incluye el análisis estático en el JSON como staticAnalysis, con summary, overallAssessment y findings; cada hallazgo debe incluir id, category, severity, source, evidence, impact y recommendation. Refleja el resumen y los hallazgos en una sección visible del HTML. Después deriva todos los escenarios relevantes de requisitos verificables, con id SC_001, SC_002… (tres dígitos y consecutivos), incluye requirementRefs como arreglo de criterios o fuentes por escenario y clarificationRequired como booleano cuando aplique; cada escenario debe tener testPolarity igual a Positivo o Negativo. Cubre los caminos positivos y negativos de cada criterio cuando apliquen, sin inventar comportamiento ante requisitos ambiguos. El plan debe incluir ambas polaridades para poder ejecutarse. Incluye testTechniques como un ARREGLO JSON de objetos con las propiedades name y justification, usando únicamente técnicas ISTQB realmente aplicables (valores límite, clases de equivalencia, transición de estados, tablas de decisión y adivinación de errores); no uses un objeto clave/valor ni agregues técnicas irrelevantes. Asocia technique a cada escenario cuando corresponda. Aplica obligatoriamente la adivinación de errores: al menos 2 escenarios con technique "Adivinación de errores" y el campo errorGuessingRisk (defecto anticipado y por qué es probable), elegidos del catálogo de references/test-case-best-practices.md según lo que la historia expone (entradas, duplicados, doble envío, sesión, errores del backend, seguridad básica); si el comportamiento esperado no está definido, marca clarificationRequired en vez de inventarlo. Incluye en el JSON el objeto authentication con required (booleano), reason y evidence: required es true si la funcionalidad no es pública, es decir, si la historia o sus adjuntos mencionan usuarios autorizados, perfiles, roles, permisos, un backoffice o módulo interno (por ejemplo, un módulo de Odoo o SAP) o una pantalla a la que solo se llega tras iniciar sesión; evidence cita el texto que lo sustenta. Con required true el runner no ejecuta las pruebas hasta tener un usuario y contraseña válidos, así que no planifiques casos que dependan de no tener sesión salvo que la historia los pida. Genera únicamente planning/US-${storyId}-plan.json y planning/US-${storyId}-plan.html en 3-outputs/run/US-${storyId}/. No ejecutes pruebas; la ejecución queda pendiente de revisión humana.`;
  const { agent, command: agentCommand } = spawnAgent(prompt, "inherit");
  let agentErrorOutput = "";
  agent.stderr.on("data", chunk => { agentErrorOutput += chunk.toString(); process.stderr.write(chunk); });
  agent.on("close", async code => {
    if (code !== 0) {
      preparations.set(String(storyId), { status: "failed", message: `No se pudo generar el plan. ${agentErrorOutput.trim() || `${getAgentProvider()} terminó con código ${code}.`}` });
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
    preparations.set(String(storyId), { status: "failed", message: `No se pudo iniciar ${getAgentProvider()} (${agentCommand}): ${error.message}` });
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
      '<header><img src="/test-executor-logo.png?v=1" alt="Test Executor &amp; Automator" style="width:96px;height:96px;object-fit:contain;border-radius:18px"><span style="display:block;color:#f1d978;font-size:13px;font-weight:800;letter-spacing:.16em;text-transform:uppercase;margin-bottom:10px">Pruebas TI</span>'
    );
    const titledReport = reportWithBrand
      .replace("<title>Pruebas TI | Reporte E2E</title>", `<title>${reportTitle}</title>`)
      .replace("<h1>Pruebas TI | Reporte de Pruebas E2E — UniWebPro Estudiantes (Clase 33)</h1>", `<h1>${reportTitle}</h1>`);
    await fs.writeFile(reportPath, titledReport, "utf8");
    return reportPath;
  }
}

function startAgent(storyId, selectedScenarioIds, selectedBrowsers, selectedTestTypes, state = null, extraInstructions = "") {
  const runState = state || { timedOut: false, capacityRetries: 0, currentAgent: null, deadline: null, extraInstructions };
  const prompt = `Ejecuta el flujo de QA para US-${storyId} exclusivamente en las modalidades seleccionadas por el usuario: ${selectedTestTypes.join(", ")}. Conserva estas modalidades en planning/US-${storyId}-plan.json.selectedTestTypes y configura las habilidades de pruebas: functional=run-tests-browser, accessibility=run-accessibility-tests, performance=run-lighthouse-tests. No ejecutes ninguna de esas habilidades si su modalidad no fue seleccionada; conserva otras habilidades auxiliares del plan que no correspondan a estas modalidades. Presupuesto estricto: run-tests-browser debe finalizar en máximo 115 segundos desde la primera navegación (nunca excedas 120 segundos), reservando 15 segundos para guardar evidencias y el reporte. Navegación máximo 10 segundos, acción 3 segundos, aserción 2.5 segundos; no uses esperas fijas ni networkidle. Si el presupuesto se agota, registra lo pendiente como BLOCKED/TIME_BUDGET, no como fallo ni bug. Si se seleccionó functional, ejecuta exclusivamente los escenarios ${selectedScenarioIds.join(", ")} y solo en estos navegadores: ${selectedBrowsers.join(", ")}; si no se seleccionó functional, omite la ejecución de escenarios y no inventes casos. Omite cualquier otro escenario y conserva el plan original. Usa la URL indicada en 2-inputs/US-${storyId}/historia.md. Genera los artefactos en 3-outputs/run/US-${storyId}/. Crea el reporte en 3-outputs/run/US-${storyId}/test-report.html usando .agents/skills/99.log-results/templates/test-report-template.html. Deriva el nombre correcto del proyecto del plan y el contexto funcional de la historia (campo "Nombre del Proyecto"); no uses nombres de proyectos de otras historias ni un nombre fijo. El título debe ser "Reporte de Pruebas E2E — {Nombre del Proyecto}" tanto en <title> como en <h1>. Incrusta las capturas disponibles bajo execution/, accessibility/ y lighthouse/ en una galería con rutas /reports/${storyId}/assets/{ruta-relativa}, alt y leyendas precisas; no presentes una captura como evidencia de algo que no muestra. Registra en Azure DevOps solo bugs reproducibles encontrados en pruebas fallidas, con la plantilla de report-bugs; no dupliques bugs ni reportes bloqueados por ambiente. IMPORTANTE — escenarios con clarificationRequired true: NO los bloquees como BLOCKED/CLARIFICATION_REQUIRED; ejecútalos aplicando el comportamiento más conservador documentado en la historia (campo obligatorio vacío = error visible, etc.) y registra la ambigüedad como hallazgo informativo AMB-NNN en el reporte con severidad Low. Solo usa BLOCKED/CLARIFICATION_REQUIRED si el comportamiento esperado es completamente indeterminado y ninguna heurística razonable puede aplicarse.${runState.extraInstructions ? ` ${runState.extraInstructions}` : ""}`;
  const { agent, command: agentCommand } = spawnAgent(prompt, "pipe");
  const provider = getAgentProvider();
  runState.currentAgent = agent;
  let agentOutput = "";
  let agentErrorOutput = "";
  agent.stdout.on("data", chunk => {
    agentOutput += chunk.toString();
    process.stdout.write(chunk);
  });
  agent.stderr.on("data", chunk => {
    agentErrorOutput += chunk.toString();
    process.stderr.write(chunk);
  });
  agent.on("close", async code => {
    if (runState.timedOut) return;
    if (code !== 0) {
      const diagnostic = (agentErrorOutput.trim() || agentOutput.trim()).slice(-2000);
      if (isAgyCapacityError(diagnostic) && runState.capacityRetries < AGY_MAX_CAPACITY_RETRIES) {
        const retryIndex = runState.capacityRetries;
        runState.capacityRetries += 1;
        const delay = AGY_CAPACITY_RETRY_DELAYS_MS[retryIndex] || AGY_CAPACITY_RETRY_DELAYS_MS[AGY_CAPACITY_RETRY_DELAYS_MS.length - 1];
        console.warn(`agy no tiene capacidad temporal; reintento ${runState.capacityRetries}/${AGY_MAX_CAPACITY_RETRIES} en ${delay / 1000}s.`);
        setTimeout(() => {
          if (!runState.timedOut && activeRun?.storyId === String(storyId)) {
            startAgent(storyId, selectedScenarioIds, selectedBrowsers, selectedTestTypes, runState);
          }
        }, delay);
        return;
      }
      const quotaError = /quota|resource_exhausted|code 429|individual quota|usage limit|rate limit/i.test(diagnostic);
      const authError = /not logged in|token source|authentication|unauthenticated|invalid api key|\/login/i.test(diagnostic);
      const capacityError = isAgyCapacityError(diagnostic);
      const loginHint = provider === "claude"
        ? `ejecuta "${agentCommand}" en una terminal, usa /login con tu cuenta de Claude`
        : `ejecuta "agy" en una terminal con esta misma cuenta y completa el inicio de sesión en Antigravity`;
      const message = capacityError
        ? `El servicio de modelos de ${provider} no tiene capacidad disponible temporalmente (HTTP 503). Se agotaron ${AGY_MAX_CAPACITY_RETRIES} reintentos; espera unos minutos y vuelve a ejecutar. Detalle: ${diagnostic}`
        : quotaError
        ? `${provider} no pudo ejecutar la tarea porque se agotó la cuota de la cuenta. Espera el reinicio indicado, utiliza una cuenta con cuota disponible o cambia QA_AGENT en .env. Detalle: ${diagnostic}`
        : authError
          ? `${provider} no está autenticado. Para corregirlo, ${loginHint}; después vuelve a ejecutar las pruebas. Detalle: ${diagnostic}`
        : `${provider} terminó con código ${code}.${diagnostic ? ` Detalle: ${diagnostic}` : " El agente finalizó sin producir salida de diagnóstico en consola."}`;
      completedRuns.set(String(storyId), { status: "failed", message });
      if (runState.deadline) clearTimeout(runState.deadline);
      if (activeRun?.storyId === storyId) activeRun = null;
      return;
    }
    if (runState.deadline) clearTimeout(runState.deadline);
    try {
      const reportPath = await ensureReport(storyId);
      completedRuns.set(String(storyId), { status: "completed", reportPath });
    } catch (error) {
      completedRuns.set(String(storyId), { status: "failed", message: `${provider} terminó, pero no se pudo generar el informe HTML: ${error.message}` });
    } finally {
      if (activeRun?.storyId === storyId) activeRun = null;
    }
  });
  agent.on("error", error => {
    if (runState.timedOut) return;
    console.error(`No se pudo iniciar ${provider}: ${error.message}`);
    const pathHint = provider === "claude" ? "define CLAUDE_COMMAND en .env" : "define AGY_COMMAND en .env";
    completedRuns.set(String(storyId), { status: "failed", message: `No se pudo iniciar ${provider} (${agentCommand}). Verifica que esté instalado o ${pathHint}.` });
    if (activeRun?.storyId === storyId) activeRun = null;
  });
  if (!runState.deadline) runState.deadline = setTimeout(() => {
    if (activeRun?.storyId !== String(storyId)) return;
    runState.timedOut = true;
    completedRuns.set(String(storyId), {
      status: "failed",
      message: "La ejecución alcanzó el límite estricto de 120 segundos (BLOCKED/TIME_BUDGET)."
    });
    stopProcessTree(runState.currentAgent);
    activeRun = null;
  }, QA_EXECUTION_BUDGET_MS);
  return agent.pid;
}

// Modo de ejecución funcional: "playwright" (híbrido: el agente genera el spec y Playwright lo ejecuta)
// o "agent" (el agente ejecuta cada paso con MCP Playwright).
function getExecutionMode() {
  const mode = String(process.env.QA_EXECUTION_MODE || "playwright").trim().toLowerCase();
  if (!["playwright", "agent"].includes(mode)) {
    throw new Error(`QA_EXECUTION_MODE="${mode}" no es válido. Usa "playwright" o "agent".`);
  }
  return mode;
}

const QA_GENERATION_BUDGET_MS = Number(process.env.QA_GENERATION_BUDGET_MS || 600_000);
const activeTriages = new Set();
const interactiveLogins = new Map();

// Ejecuta una tarea del agente y espera a que termine (sin gestionar activeRun).
function runAgentTask(prompt, budgetMs, onSpawn) {
  return new Promise(resolve => {
    let output = "";
    let child;
    try {
      ({ agent: child } = spawnAgent(prompt, "pipe"));
    } catch (error) {
      resolve({ code: -1, output: error.message });
      return;
    }
    onSpawn?.(child);
    const deadline = setTimeout(() => { output += "\nBLOCKED/TIME_BUDGET: el agente superó el tiempo asignado."; stopProcessTree(child); }, budgetMs);
    child.stdout.on("data", chunk => { output += chunk.toString(); process.stdout.write(chunk); });
    child.stderr.on("data", chunk => { output += chunk.toString(); process.stderr.write(chunk); });
    child.on("error", error => { clearTimeout(deadline); resolve({ code: -1, output: `${output}\n${error.message}` }); });
    child.on("close", code => { clearTimeout(deadline); resolve({ code, output }); });
  });
}

// Escenarios por agente y agentes simultáneos al generar el spec. Lotes pequeños terminan dentro del
// presupuesto aunque haya que inspeccionar muchas pantallas (31 casos en un solo agente agotaban los 10 min).
const QA_GENERATION_BATCH_SIZE = Math.max(1, Number(process.env.QA_GENERATION_BATCH_SIZE || 6));
const QA_GENERATION_PARALLEL = Math.max(1, Number(process.env.QA_GENERATION_PARALLEL || 3));

// Reglas que cumple todo test generado o adaptado por el agente (el runner valida las principales).
function specRules() {
  return `<reglas>
- Importa test y expect de '@playwright/test'. Título exacto de cada test: "SC_XXX: {título del escenario}".
- Envuelve cada paso del plan en await test.step('N. {texto del paso del plan}', async () => { … }), con la misma numeración y texto que el plan: así el bug indica en qué paso falló.
- Localizadores robustos tomados de la página real (getByRole, getByLabel, getByPlaceholder); no inventes selectores.
- Tests independientes: cada uno crea sus datos con valores únicos y no depende del orden. Si todos lo son, añade test.describe.configure({ mode: 'parallel' }).
- Sin waitForTimeout ni networkidle. Navegación máximo 10 s, acción 3 s, aserción 2.5 s; cada test debe terminar en menos de 12 s.
- Cada test tiene al menos una aserción real sobre el resultado esperado del escenario. Nunca expect(true), tests vacíos ni código comentado; solo escenarios del plan; navega solo al dominio de la URL de la historia. El runner rechaza lo demás como BLOCKED/SCRIPT_INVALID.
- Si un caso no se puede automatizar, bloquéalo con test.skip(true, "BLOCKED/MOTIVO: detalle").
- No debilites aserciones para ocultar defectos reales del producto.
</reglas>`;
}

// Cómo pide el spec un dato que solo el usuario puede aportar: qa-runner.html lo solicita y repite el caso.
function userInputRules(storyId) {
  return `<datos-del-usuario>
Si un caso necesita un dato que solo el usuario puede aportar (otro usuario con un perfil concreto, un registro existente, un archivo, la respuesta a una ambigüedad), no lo inventes ni lo omitas: léelo de process.env y bloquea el caso mientras falte.
- Usuario: su sesión ya iniciada está en process.env.QA_INPUT_{NOMBRE}_STORAGE_STATE. Úsala con test.use({ storageState: … }) en un test.describe propio del caso. El usuario y la contraseña no están disponibles (no se guardan): nunca inicies sesión desde el test.
- Dato de texto: process.env.QA_INPUT_{NOMBRE}.
- Mientras falte: test.skip(!valor, "BLOCKED/NEEDS_INPUT: {NOMBRE} [credentials|text]: {qué dato hace falta y para qué}"). {NOMBRE} en MAYÚSCULAS_CON_GUIONES_BAJOS, p. ej. USUARIO_SIN_ACCESO.
- qa-runner.html pedirá ese dato al usuario y repetirá el caso automáticamente al guardarlo. Nunca escribas usuarios ni contraseñas en el archivo.
</datos-del-usuario>`;
}

// Prompt de un lote: escribe una parte del spec con solo esos escenarios, dentro de su presupuesto de tiempo.
function generationPrompt(storyId, scenarioIds, { target, regenerate = false, auditIssues = [] }) {
  const file = path.relative(workspaceRoot, target).split(path.sep).join("/");
  const testsDir = `3-outputs/run/US-${storyId}/tests`;
  const minutes = Math.floor(QA_GENERATION_BUDGET_MS / 60_000);
  const hasTestData = existsSync(path.join(workspaceRoot, "2-inputs", `US-${storyId}`, "datos-prueba.md"));
  const login = loginState(storyId);
  const sources = [
    `los escenarios ${scenarioIds.join(", ")} de 3-outputs/run/US-${storyId}/planning/US-${storyId}-plan.json`,
    `la URL de 2-inputs/US-${storyId}/historia.md`,
    hasTestData ? `los datos de prueba de 2-inputs/US-${storyId}/datos-prueba.md (no inventes datos que no estén ahí)` : null,
    regenerate ? `como referencia, la versión anterior en ${testsDir}/US-${storyId}*.previous.ts (reutiliza los localizadores que funcionen y elimina los bloqueos que ya puedan resolverse)` : null
  ].filter(Boolean);
  return `<tarea>
Escribe el archivo Playwright ${file} con un test por cada uno de estos escenarios: ${scenarioIds.join(", ")}. Sigue .agents/skills/12.generate-automated-tests/SKILL.md.
</tarea>

<alcance>
- Escribe solo ${file}. Otros agentes generan en paralelo el resto de escenarios en otros archivos de ${testsDir}/: no los leas ni los modifiques.
- No generes reportes, capturas ni bugs.
</alcance>

<eficiencia>
Tienes ${minutes} minutos. Al agotarse, el proceso se detiene y solo cuenta lo que ya esté guardado en ${file}.
1. Lee únicamente ${sources.join("; ")}. No explores el resto del repositorio.
2. Agrupa los escenarios por pantalla e inspecciona cada pantalla una sola vez con MCP Playwright (browser_snapshot); reutiliza esos localizadores en todos sus escenarios. Evita capturas de pantalla: el snapshot basta.
3. Crea el archivo en cuanto tengas el primer test y añade cada test apenas lo termines; no esperes al final.
4. Valida una vez al final con "npx playwright test ${file} --project=chromium --list". Ejecuta el archivo como máximo una vez ("--project=chromium --reporter=line") y solo para depurar un localizador.
</eficiencia>

${specRules()}

${userInputRules(storyId)}

<sesion>
${login.requiresLogin
    ? `La funcionalidad exige usuario autenticado y el runner ya validó el usuario de la historia. playwright.config.ts aplica la sesión guardada (storageState) a cada test: empieza los tests en ${login.appUrl || "la zona privada de la aplicación"} sin volver a iniciar sesión. No generes casos BLOCKED/CREDENTIALS: si una pantalla vuelve al login, el test debe fallar, no omitirse.`
    : "La aplicación no exige login."} ${sessionInstructions(storyId)}
</sesion>${auditIssues.length ? `

<correcciones>
La validación automática rechazó estos tests; corrígelos: ${auditIssues.map(item => `"${item.title}": ${item.issues.join("; ")}`).join(" | ")}.
</correcciones>` : ""}`;
}

// Genera el spec por lotes con varios agentes en paralelo; cada lote escribe su propia parte
// (US-{id}.spec.ts, US-{id}.p2.spec.ts…). Un lote que agota su tiempo no tumba la ejecución:
// lo generado se conserva y lo que falte se completa en la siguiente.
async function generateSpecParts(storyId, scenarioIds, { regenerate = false, auditIssues = [] } = {}) {
  const existing = await specFiles(workspaceRoot, storyId);
  if (regenerate) {
    for (const { file } of existing) await fs.rename(file, file.replace(/\.spec\.ts$/, ".previous.ts"));
  }
  const usedParts = new Set(regenerate ? [] : existing.map(item => item.part));
  const nextPart = () => {
    let part = 1;
    while (usedParts.has(part)) part += 1;
    usedParts.add(part);
    return part;
  };
  const batches = [];
  for (let index = 0; index < scenarioIds.length; index += QA_GENERATION_BATCH_SIZE) {
    batches.push({ ids: scenarioIds.slice(index, index + QA_GENERATION_BATCH_SIZE), part: nextPart() });
  }
  const results = [];
  let cursor = 0;
  const worker = async () => {
    while (cursor < batches.length) {
      const batch = batches[cursor++];
      const target = partSpecPath(workspaceRoot, storyId, batch.part);
      const prompt = generationPrompt(storyId, batch.ids, { target, regenerate, auditIssues: auditIssues.filter(item => batch.ids.includes(item.id)) });
      results.push({ ...batch, ...await runAgentTask(prompt, QA_GENERATION_BUDGET_MS) });
    }
  };
  await Promise.all(Array.from({ length: Math.min(QA_GENERATION_PARALLEL, batches.length) }, worker));
  return results;
}

async function specAuditOptions(storyId, plan) {
  return {
    planIds: plan.testScenarios.map(scenario => scenario.id),
    allowedHosts: [...await storyEnvironmentHosts(workspaceRoot, storyId), ...String(process.env.QA_ALLOWED_HOSTS || "").split(",").map(host => host.trim()).filter(Boolean)]
  };
}

// Variables de los tests: la sesión de la historia y los datos aportados por el usuario (QA_INPUT_*).
function playwrightEnv(storyId) {
  return {
    ...(storyLoginStatus(storyId).hasSession ? { QA_STORAGE_STATE: path.resolve(workspaceRoot, process.env[storyCredentialNames(storyId).state]) } : {}),
    ...inputEnvForTests(storyId, process.env, workspaceRoot)
  };
}

// Datos pendientes de la última ejecución: casos BLOCKED que esperan algo que solo el usuario puede aportar.
async function pendingInputs(storyId) {
  try {
    const report = JSON.parse(await fs.readFile(path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "execution", "execution-report.json"), "utf8"));
    return derivePendingInputs({ storyId, report, env: process.env });
  } catch {
    return [];
  }
}

// Prompt para adaptar los casos que ya tienen su dato: quita el bloqueo y los automatiza en su archivo.
function inputUpdatePrompt(storyId, file, work) {
  const relative = path.relative(workspaceRoot, file).split(path.sep).join("/");
  const ids = [...new Set(work.map(item => item.id))];
  const data = work.map(({ id, input }) => {
    const env = `QA_INPUT_${input.name}`;
    return input.type === "credentials"
      ? `- ${id}: ${input.label}. Su sesión ya iniciada está en process.env.${env}_STORAGE_STATE: úsala con test.use({ storageState: process.env.${env}_STORAGE_STATE }) en un test.describe propio para este caso, no la sesión del usuario principal. El usuario y la contraseña no se guardan: no inicies sesión desde el test. Para inspeccionar las pantallas como ese usuario, usa el servidor MCP de su sesión (playwright-session-${inputEnvBase(storyId, input.name).toLowerCase().replace(/_/g, "-")}).`
      : `- ${id}: ${input.label}. El valor está en process.env.${env} y en 2-inputs/US-${storyId}/datos-prueba.md${input.code === "CLARIFICATION_REQUIRED" ? "; es la respuesta aprobada a la ambigüedad: úsala como resultado esperado" : ""}.`;
  }).join("\n");
  return `<tarea>
En ${relative}, completa los tests ${ids.join(", ")}, que estaban bloqueados porque faltaba un dato que el usuario ya aportó. Quita su bloqueo y automatízalos según los pasos y el resultado esperado de 3-outputs/run/US-${storyId}/planning/US-${storyId}-plan.json. No modifiques los demás tests del archivo.
</tarea>

<datos>
${data}
- Lee siempre los datos de process.env; nunca escribas usuarios ni contraseñas en el archivo. Si un dato faltara al ejecutar, test.skip(!valor, "BLOCKED/NEEDS_INPUT: {NOMBRE} [credentials|text]: {descripción}").
</datos>

<eficiencia>
Tienes ${Math.floor(QA_GENERATION_BUDGET_MS / 60_000)} minutos. Inspecciona solo las pantallas de estos casos y guarda cada test en cuanto lo termines. Valida con "npx playwright test ${relative} --project=chromium --list" y, como máximo una vez, ejecútalos con --grep para depurar.
</eficiencia>

${specRules()}`;
}

// Audita todas las partes del spec.
async function auditSpecFiles(storyId, options) {
  const tests = [];
  for (const { file } of await specFiles(workspaceRoot, storyId)) tests.push(...auditSpec(await fs.readFile(file, "utf8"), options).tests);
  return { tests, invalid: tests.filter(test => !test.valid) };
}

function triagePrompt(storyId) {
  // El spec puede estar dividido en partes (US-{id}.spec.ts, US-{id}.p2.spec.ts…): se trabaja sobre la carpeta.
  const spec = `3-outputs/run/US-${storyId}/tests`;
  return `Realiza el triage de los fallos de la ejecución automatizada de US-${storyId}. Lee 3-outputs/run/US-${storyId}/execution/execution-report.json y las capturas de execution/screenshots/. Para cada escenario con status FAIL determina si es (a) un defecto del producto o (b) un defecto del script (localizador, tiempos o dependencia entre tests). Un fallo con failureType "TIMEOUT" o un caso con flaky true es (b) o un problema de ambiente salvo que lo reproduzcas dos veces de forma idéntica; nunca lo reportes como bug sin esa reproducción. En el caso (b), corrige el archivo de ${spec}/ que contiene ese test y vuelve a ejecutar solo ese caso con "npx playwright test ${spec} --grep \\"SC_XXX:\\" --project={navegador} --reporter=line"; no debilites aserciones para ocultar defectos reales. En el caso (a), confirma el comportamiento (con MCP Playwright si hace falta) y regístralo con create_azure_bug pasando sourceStoryId: ${storyId}, scenarioId, un title breve y observable, severity e impact; añade expectedResult, actualResult o evidence solo para precisar lo que el plan y el error no dicen (por ejemplo, la respuesta HTTP observada). La herramienta arma el paso a paso desde el plan marcando el paso que falló, adjunta la captura, el video, el trace y el estado de la página, evita duplicados (si ya existe, añade la evidencia como re-test), guarda el bug en bugs/US-${storyId}-bugs.json y .md y lo vincula en execution-report.json: no escribas esos archivos a mano. Registra un bug por escenario fallido aunque falle en varios navegadores. Actualiza execution-report.json respetando schemas/execution-report.schema.json (findings con el id de cada bug; en cada escenario, triage con PRODUCT_DEFECT, SCRIPT_DEFECT, ENVIRONMENT o FLAKY, triageNote con la explicación (bugId y azureDevOpsId ya los escribe create_azure_bug), sin modificar reason ni status; y triage: "done") y reemplaza en 3-outputs/run/US-${storyId}/test-report.html el contenido de la sección "Bugs y Defectos Identificados" y la columna "ID de Bug" con el resultado del triage, sin tocar el resto del reporte. Termina con el formato de salida obligatorio de GEMINI.md.`;
}

// Triage con el agente en segundo plano: el reporte ya está disponible mientras se ejecuta.
function startTriage(storyId) {
  if (activeTriages.has(storyId)) return;
  activeTriages.add(storyId);
  console.log(`Triage de fallos de US-${storyId} iniciado con ${getAgentProvider()}.`);
  runAgentTask(triagePrompt(storyId), QA_EXECUTION_BUDGET_MS).then(async ({ code }) => {
    activeTriages.delete(storyId);
    console.log(`Triage de US-${storyId} terminado (código ${code}).`);
    await checkReportSchema(storyId);
  });
}

// Comprueba que el agente dejó execution-report.json con el esquema único; si no, guarda los errores junto al reporte.
async function checkReportSchema(storyId) {
  const executionDir = path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "execution");
  try {
    const report = JSON.parse(await fs.readFile(path.join(executionDir, "execution-report.json"), "utf8"));
    const errors = await validateExecutionReport(workspaceRoot, report);
    const errorsPath = path.join(executionDir, "schema-errors.json");
    if (errors.length) {
      await fs.writeFile(errorsPath, `${JSON.stringify(errors, null, 2)}\n`, "utf8");
      console.warn(`US-${storyId}: execution-report.json no cumple el esquema (${errors.length} errores, ver ${path.relative(workspaceRoot, errorsPath)}).`);
    } else {
      await fs.rm(errorsPath, { force: true });
    }
  } catch (error) {
    console.warn(`US-${storyId}: no se pudo validar execution-report.json (${error.message}).`);
  }
}

async function startHybridRun(storyId, selectedScenarioIds, selectedBrowsers, selectedTestTypes, { regenerateSpec = false } = {}) {
  storyId = String(storyId);
  activeRun = { storyId, pid: null, message: `Preparando la ejecución de US-${storyId}…` };
  const fail = message => {
    completedRuns.set(storyId, { status: "failed", message });
    if (activeRun?.storyId === storyId) activeRun = null;
  };
  try {
    const planPath = path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "planning", `US-${storyId}-plan.json`);
    const plan = JSON.parse(await fs.readFile(planPath, "utf8"));
    if (normalizePlanScenarioIds(plan)) await fs.writeFile(planPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8");

    // 0. Login: si la historia lo exige, solo se continúa con un usuario o una sesión que entren de verdad.
    const gate = loginGate(storyId);
    if (gate) { fail(gate); return; }
    if (plan.url && (storyLoginRequirement(storyId).required || storyLoginStatus(storyId).ready)) {
      activeRun.message = `Comprobando el inicio de sesión en ${new URL(plan.url).host}…`;
      const login = await verifyStoryLogin(storyId, plan.url);
      if (!login.ok) { fail(login.message); return; }
    }

    // 1. Generar el spec con el agente si faltan escenarios (normalmente la primera vez) o si se pidió regenerarlo.
    // Devuelve los escenarios que quedaron sin generar, o null si no se generó ninguno (la ejecución no tiene sentido).
    const generate = async (regenerate, auditIssues = []) => {
      const pending = regenerate ? selectedScenarioIds : await findMissingScenarios(workspaceRoot, storyId, selectedScenarioIds);
      const agents = Math.min(QA_GENERATION_PARALLEL, Math.ceil(pending.length / QA_GENERATION_BATCH_SIZE));
      const startedAt = Date.now();
      const progress = async () => {
        const done = pending.length - (await findMissingScenarios(workspaceRoot, storyId, pending)).length;
        activeRun.message = `${regenerate ? "Regenerando" : "Generando"} el script de US-${storyId} con ${agents} agente(s) de ${getAgentProvider()} en paralelo: ${done} de ${pending.length} casos listos (${Math.round((Date.now() - startedAt) / 60_000)} min)…`;
      };
      await progress();
      const ticker = setInterval(() => progress().catch(() => {}), 10_000);
      let results;
      try {
        results = await generateSpecParts(storyId, pending, { regenerate, auditIssues });
      } finally {
        clearInterval(ticker);
      }
      const missing = await findMissingScenarios(workspaceRoot, storyId, selectedScenarioIds);
      if (missing.length === selectedScenarioIds.length) {
        const timedOut = results.some(result => /BLOCKED\/TIME_BUDGET/.test(result.output));
        const detail = results.map(result => result.output.trim()).filter(Boolean).pop()?.slice(-500) || "";
        fail(`${getAgentProvider()} no generó ningún test de US-${storyId}${timedOut ? ` en ${Math.floor(QA_GENERATION_BUDGET_MS / 60_000)} minutos por lote` : ""}. ${timedOut ? "Las pantallas pueden ser lentas o muy grandes: reduce QA_GENERATION_BATCH_SIZE o aumenta QA_GENERATION_BUDGET_MS en .env y vuelve a ejecutar." : detail}`);
        return null;
      }
      if (missing.length) console.warn(`US-${storyId}: faltan ${missing.length} test(s) por generar (${missing.join(", ")}); se ejecutan los demás y se completarán en la próxima ejecución.`);
      return new Set(missing);
    };
    let regenerated = regenerateSpec;
    let notGenerated = new Set();
    if (regenerateSpec || (await findMissingScenarios(workspaceRoot, storyId, selectedScenarioIds)).length) {
      notGenerated = await generate(regenerateSpec);
      if (!notGenerated) return;
    }

    // 1b. Auditoría determinista del spec: sin aserciones, tautologías, dominio ajeno o IDs fuera del plan.
    const auditOptions = await specAuditOptions(storyId, plan);
    let audit = await auditSpecFiles(storyId, auditOptions);
    let invalid = invalidScenarios(audit, selectedScenarioIds);
    // Casos que el agente dejó bloqueados por falta de login: sin usuario válido no se ejecuta nada
    // (y la historia queda marcada como "requiere login"); con usuario, se regenera el spec con la sesión.
    const blockedByLogin = loginPlaceholders(audit, selectedScenarioIds);
    if (blockedByLogin.length && !storyLoginStatus(storyId).ready) {
      await saveLoginRequirement(storyId, { specRequiresLogin: true });
      fail(loginGate(storyId));
      return;
    }
    if (!regenerated && (invalid.size || blockedByLogin.length)) {
      console.log(`US-${storyId}: se regenera el spec (${invalid.size} test(s) no fiables, ${blockedByLogin.length} bloqueado(s) por login con sesión disponible).`);
      notGenerated = await generate(true, audit.invalid.filter(test => selectedScenarioIds.includes(test.id)));
      if (!notGenerated) return;
      regenerated = true;
      audit = await auditSpecFiles(storyId, auditOptions);
      invalid = invalidScenarios(audit, selectedScenarioIds);
    }
    if (audit.invalid.length) console.warn(`US-${storyId}: tests rechazados por la auditoría del spec: ${audit.invalid.map(test => `${test.id || test.title}: ${test.issues.join("; ")}`).join(" | ")}`);
    const runnableIds = selectedScenarioIds.filter(id => !invalid.has(id) && !notGenerated.has(id));

    // 2. Ejecutar con Playwright, sin modelo.
    activeRun.message = `Ejecutando ${runnableIds.length} caso(s) con Playwright en ${selectedBrowsers.join(", ")}…`;
    const run = !runnableIds.length ? NO_RUN : await runPlaywright({
      workspaceRoot, storyId, scenarioIds: runnableIds, browsers: selectedBrowsers,
      onSpawn: child => { activeRun.pid = child.pid; },
      // Sesión de la historia como storageState por defecto de playwright.config.ts.
      env: playwrightEnv(storyId)
    });

    // 3. Reporte determinista.
    const report = await buildExecutionReport({ workspaceRoot, storyId, plan, scenarioIds: selectedScenarioIds, browsers: selectedBrowsers, run, testTypes: selectedTestTypes, invalid, specAudit: audit.invalid, notGenerated });
    const reportPath = await writeHtmlReport({ workspaceRoot, storyId, report });
    console.log(`US-${storyId}: ${report.summary.passed}/${report.summary.total} casos aprobados en ${(run.durationMs / 1000).toFixed(1)} s con Playwright.`);

    // 4. Accesibilidad y rendimiento siguen necesitando al agente (MCP Playwright / Lighthouse).
    const otherTypes = selectedTestTypes.filter(type => type !== "functional");
    if (otherTypes.length) {
      if (report.summary.failed && process.env.QA_TRIAGE !== "off") startTriage(storyId);
      const note = `Las pruebas funcionales ya se ejecutaron con Playwright: sus resultados están en 3-outputs/run/US-${storyId}/execution/execution-report.json y las capturas en execution/screenshots/. No las repitas; inclúyelas tal cual en test-report.html junto con los resultados de ${otherTypes.join(", ")}.`;
      activeRun = null;
      const pid = startAgent(storyId, [], [], otherTypes, null, note);
      activeRun = { storyId, pid, message: `Pruebas funcionales listas. Ejecutando ${otherTypes.join(", ")} con ${getAgentProvider()}…` };
      return;
    }

    completedRuns.set(storyId, { status: "completed", reportPath });
    if (activeRun?.storyId === storyId) activeRun = null;

    // 5. Solo si hubo fallos, el agente clasifica y documenta bugs (en segundo plano).
    if (report.summary.failed && process.env.QA_TRIAGE !== "off") startTriage(storyId);
  } catch (error) {
    fail(`La ejecución con Playwright no pudo completarse: ${error.message}`);
  }
}

async function startInputContinuation(storyId, inputs) {
  storyId = String(storyId);
  activeRun = { storyId, pid: null, message: `Preparando los casos con los datos aportados…` };
  const fail = message => {
    completedRuns.set(storyId, { status: "failed", message });
    if (activeRun?.storyId === storyId) activeRun = null;
  };
  try {
    const storyDir = path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`);
    const reportPath = path.join(storyDir, "execution", "execution-report.json");
    const previous = JSON.parse(await fs.readFile(reportPath, "utf8"));
    const plan = JSON.parse(await fs.readFile(path.join(storyDir, "planning", `US-${storyId}-plan.json`), "utf8"));
    const scenarioIds = [...new Set(inputs.flatMap(input => input.scenarios))];
    const browsers = previous.selectedBrowsers?.length ? previous.selectedBrowsers : ["chromium"];

    if (plan.url && (storyLoginRequirement(storyId).required || storyLoginStatus(storyId).ready)) {
      activeRun.message = `Comprobando el inicio de sesión en ${new URL(plan.url).host}…`;
      const login = await verifyStoryLogin(storyId, plan.url);
      if (!login.ok) { fail(login.message); return; }
    }

    // 1. Los tests que todavía no leen su dato se adaptan con el agente (un agente por archivo, en paralelo).
    const work = new Map();
    for (const { file } of await specFiles(workspaceRoot, storyId)) {
      const source = await fs.readFile(file, "utf8");
      const ids = new Set(auditSpec(source).tests.map(test => test.id));
      for (const input of inputs) {
        for (const id of input.scenarios) {
          if (ids.has(id) && !source.includes(`QA_INPUT_${input.name}`)) work.set(file, [...(work.get(file) || []), { id, input }]);
        }
      }
    }
    if (work.size) {
      activeRun.message = `Adaptando ${[...work.values()].flat().length} caso(s) con los datos aportados (${work.size} agente(s) de ${getAgentProvider()})…`;
      await Promise.all([...work].map(([file, items]) => runAgentTask(inputUpdatePrompt(storyId, file, items), QA_GENERATION_BUDGET_MS)));
    }

    // 2. Auditoría y ejecución solo de esos casos.
    const audit = await auditSpecFiles(storyId, await specAuditOptions(storyId, plan));
    const invalid = invalidScenarios(audit, scenarioIds);
    const runnable = scenarioIds.filter(id => !invalid.has(id));
    activeRun.message = `Ejecutando ${runnable.length} caso(s) con los datos aportados…`;
    const run = runnable.length ? await runPlaywright({ workspaceRoot, storyId, scenarioIds: runnable, browsers, onSpawn: child => { activeRun.pid = child.pid; }, env: playwrightEnv(storyId) }) : NO_RUN;
    const partial = await buildExecutionReport({ workspaceRoot, storyId, plan, scenarioIds, browsers, run, testTypes: previous.selectedTestTypes || ["functional"], invalid, specAudit: audit.invalid.filter(test => scenarioIds.includes(test.id)), persist: false });

    // 3. Reporte completo actualizado.
    const merged = mergeExecutionReports(previous, partial);
    const errors = await validateExecutionReport(workspaceRoot, merged);
    if (errors.length) throw new Error(`el reporte fusionado no cumple el esquema: ${errors.slice(0, 3).join("; ")}`);
    await fs.writeFile(reportPath, `${JSON.stringify(merged, null, 2)}\n`, "utf8");
    const htmlPath = await writeHtmlReport({ workspaceRoot, storyId, report: merged });
    console.log(`US-${storyId}: casos con datos aportados → ${partial.summary.passed} aprobados, ${partial.summary.failed} fallidos, ${partial.summary.blocked} bloqueados.`);
    completedRuns.set(storyId, { status: "completed", reportPath: htmlPath });
    if (activeRun?.storyId === storyId) activeRun = null;
    if (partial.summary.failed && process.env.QA_TRIAGE !== "off") startTriage(storyId);
  } catch (error) {
    fail(`No se pudieron repetir los casos con los datos aportados: ${error.message}`);
  }
}

// Punto único para lanzar una ejecución según QA_EXECUTION_MODE.
function launchRun(storyId, selectedScenarioIds, selectedBrowsers, selectedTestTypes, options = {}) {
  if (getExecutionMode() === "playwright" && selectedTestTypes.includes("functional")) {
    startHybridRun(storyId, selectedScenarioIds, selectedBrowsers, selectedTestTypes, options);
    return null;
  }
  return startAgent(storyId, selectedScenarioIds, selectedBrowsers, selectedTestTypes);
}

async function handleRequest(request, response) {
  if (!isTrustedRequest(request, port)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Petición rechazada: el runner solo acepta peticiones desde http://localhost:" + port + ".");
    return;
  }
  const url = new URL(request.url, `http://${request.headers.host}`);

  // Lo consulta tools/runner-supervisor.mjs para no reiniciar el runner en medio de una ejecución.
  if (request.method === "GET" && url.pathname === "/api/runner-state") {
    const waitingLogin = [...interactiveLogins.values()].some(login => login.status === "waiting");
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ busy: Boolean(activeRun || activePreparation || activeTriages.size || waitingLogin), pid: process.pid }));
    return;
  }

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
      // Detecta si la URL exige login para pedir credenciales en qa-runner.html antes de ejecutar.
      await saveLoginRequirement(id, { detected: await runLoginProbe("detect", testUrl), testUrl });
      access.login = loginState(id);
      await importWorkItem(id);
      await saveTestUrl(id, testUrl);
      // Si la aplicación exige login, primero se pide un usuario válido; los casos se generan después,
      // cuando qa-runner.html vuelve a llamar a /api/prepare con las credenciales ya validadas.
      if (access.login.requiresLogin && !access.login.ready) {
        const result = { status: "login_required", access, message: loginGate(id) };
        preparations.set(id, result);
        activePreparation = null;
        response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
        response.end(JSON.stringify(result));
        return;
      }
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

  // Credenciales de login por historia: se validan iniciando sesión de verdad antes de guardarlas en .env.
  if (request.method === "POST" && ["/api/credentials", "/api/login-browser", "/api/login-browser/done", "/api/credentials/clear"].includes(url.pathname)) {
    let body;
    try {
      let rawBody = "";
      for await (const chunk of request) rawBody += chunk;
      body = JSON.parse(rawBody);
    } catch {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ ok: false, message: "La solicitud no contiene JSON válido." }));
      return;
    }
    const id = String(body.id || "");
    const testUrl = String(body.testUrl || "").trim();
    const reply = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ...payload, login: /^\d+$/.test(id) ? loginState(id) : null }));
    };
    if (!/^\d+$/.test(id)) return reply(400, { ok: false, message: "El número de tarea debe ser numérico." });
    if (activeRun?.storyId === id) return reply(409, { ok: false, message: `US-${id} se está ejecutando; espera a que termine.` });
    const names = storyCredentialNames(id);

    if (url.pathname === "/api/credentials/clear") {
      memoryCredentials.delete(id);
      await setEnvValues({ [names.state]: null });
      await fs.rm(path.join(workspaceRoot, ".auth", `us${id}.json`), { force: true });
      return reply(200, { ok: true, message: `Se cerró la sesión guardada de US-${id}.` });
    }
    if (!/^https?:\/\/\S+$/i.test(testUrl)) return reply(400, { ok: false, message: "La URL de pruebas debe comenzar por http:// o https://." });

    if (url.pathname === "/api/credentials") {
      const username = String(body.username || "");
      const password = String(body.password || "");
      if (!username.trim() || !password) return reply(400, { ok: false, message: "Escribe el usuario y la contraseña." });
      if (/[\r\n]/.test(username + password) || username.length > 300 || password.length > 300) return reply(400, { ok: false, message: "El usuario o la contraseña tienen un formato no válido." });
      const result = await loginWithCredentials(id, testUrl, { username: username.trim(), password });
      if (!result.ok) return reply(422, { ok: false, message: result.reason || "No se pudo iniciar sesión con esas credenciales." });
      // Solo se guarda la sesión; el usuario y la contraseña quedan en memoria para renovarla mientras el runner siga en marcha.
      memoryCredentials.set(id, { username: username.trim(), password });
      await setEnvValues({ [names.state]: result.statePath });
      if (result.appUrl) await saveLoginRequirement(id, { appUrl: result.appUrl });
      return reply(200, { ok: true, message: "Login válido. Se guardó la sesión iniciada; el usuario y la contraseña no se guardan." });
    }

    // Inicio de sesión manual (SSO/MFA): abre un navegador visible y espera a que el usuario termine.
    const pending = interactiveLogins.get(id);
    if (url.pathname === "/api/login-browser/done") {
      if (pending?.status !== "waiting" || !pending.child) return reply(409, { ok: false, message: "No hay un navegador esperando el inicio de sesión. Pulsa primero \"Iniciar sesión en el navegador\"." });
      pending.child.stdin.write("save\n");
      pending.message = "Comprobando que la sesión quedó iniciada…";
      return reply(202, { ok: true, status: "waiting", message: pending.message });
    }
    if (pending?.status === "waiting") return reply(409, { ok: false, status: "waiting", message: "El navegador del runner sigue abierto. Termina el login en esa ventana y pulsa \"✔ Ya inicié sesión\"." });
    interactiveLogins.set(id, { status: "waiting", message: "Inicia sesión en la ventana del navegador que abrió el runner y pulsa \"✔ Ya inicié sesión\"." });
    const statePath = path.join(workspaceRoot, ".auth", `us${id}.json`);
    await fs.mkdir(path.dirname(statePath), { recursive: true });
    runLoginProbe("interactive", testUrl, statePath, {}, child => { interactiveLogins.get(id).child = child; }).then(async result => {
      if (result.ok) {
        await setEnvValues({ [names.state]: path.relative(workspaceRoot, statePath).split(path.sep).join("/") });
        if (result.appUrl) await saveLoginRequirement(id, { appUrl: result.appUrl });
        interactiveLogins.set(id, { status: "ok", message: "Sesión guardada para esta historia." });
      } else {
        interactiveLogins.set(id, { status: "failed", message: result.reason || "No se completó el inicio de sesión." });
      }
    });
    return reply(202, { ok: true, status: "waiting", message: "Se abrió un navegador: inicia sesión allí (incluido MFA si lo pide). Al terminar, pulsa \"✔ Ya inicié sesión\"." });
  }

  // Datos que la última ejecución necesita del usuario.
  const inputsMatch = url.pathname.match(/^\/api\/inputs\/(\d+)$/);
  if (request.method === "GET" && inputsMatch) {
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ inputs: await pendingInputs(inputsMatch[1]) }));
    return;
  }

  // Guarda los datos aportados (valida los usuarios iniciando sesión) y repite automáticamente esos casos.
  if (request.method === "POST" && url.pathname === "/api/inputs") {
    let body;
    try {
      let raw = "";
      for await (const chunk of request) raw += chunk;
      body = JSON.parse(raw);
    } catch {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ message: "La solicitud no contiene JSON válido." }));
      return;
    }
    const id = String(body.id || "");
    const reply = (status, payload) => {
      response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify(payload));
    };
    if (!/^\d+$/.test(id)) return reply(400, { message: "El número de tarea debe ser numérico." });
    if (activeRun || activePreparation) return reply(409, { message: `Hay una tarea en curso: US-${activeRun?.storyId || activePreparation.storyId}.` });
    const gate = loginGate(id);
    if (gate) return reply(409, { code: "LOGIN_REQUIRED", message: gate, login: loginState(id) });
    const pending = await pendingInputs(id);
    const { values, errors } = validateInputValues(pending, body.values || {});
    if (!values.length && !Object.keys(errors).length) return reply(400, { message: "Completa al menos uno de los datos solicitados." });

    // Los usuarios se validan iniciando sesión en la aplicación antes de guardarlos.
    const testUrl = await storyTestUrl(id);
    const toSave = {};
    const dataNotes = [];
    for (const item of values) {
      const base = inputEnvBase(id, item.request.name);
      if (item.request.type === "credentials") {
        if (!testUrl) { errors[item.request.name] = "La historia no tiene URL de pruebas registrada."; continue; }
        const statePath = path.join(workspaceRoot, ".auth", `us${id}-input-${item.request.name.toLowerCase()}.json`);
        await fs.mkdir(path.dirname(statePath), { recursive: true });
        const login = await runLoginProbe("form", testUrl, statePath, { QA_LOGIN_USERNAME: item.username, QA_LOGIN_PASSWORD: item.password });
        if (!login.ok) { errors[item.request.name] = login.reason || "No se pudo iniciar sesión con ese usuario."; continue; }
        // Solo la sesión de ese usuario; su usuario y contraseña no se guardan.
        Object.assign(toSave, { [`${base}_STORAGE_STATE`]: path.relative(workspaceRoot, statePath).split(path.sep).join("/") });
      } else {
        Object.assign(toSave, { [base]: item.value.replace(/\s*\r?\n\s*/g, " ") });
        dataNotes.push(`### ${item.request.name} (${item.request.scenarios.join(", ")})\n\n**Solicitado:** ${item.request.label}\n\n**Respuesta:** ${item.value}\n`);
      }
    }
    if (Object.keys(errors).length) return reply(422, { message: "Revisa los datos marcados.", errors });
    await setEnvValues(toSave);
    if (dataNotes.length) {
      const dataPath = path.join(workspaceRoot, "2-inputs", `US-${id}`, "datos-prueba.md");
      let current = "";
      try { current = await fs.readFile(dataPath, "utf8"); } catch {}
      const header = current.includes("## Datos aportados en qa-runner") ? "" : `${current ? "\n" : `# Datos de prueba — US-${id}\n`}\n## Datos aportados en qa-runner\n`;
      await fs.writeFile(dataPath, `${current.trimEnd()}${header}\n${dataNotes.join("\n")}`, "utf8");
    }
    const provided = values.map(item => item.request);
    startInputContinuation(id, provided);
    return reply(202, { status: "running", message: `Datos guardados. Repitiendo ${[...new Set(provided.flatMap(item => item.scenarios))].join(", ")}…` });
  }

  const loginBrowserMatch = url.pathname.match(/^\/api\/login-browser\/(\d+)$/);
  if (request.method === "GET" && loginBrowserMatch) {
    const { status = "idle", message = null } = interactiveLogins.get(loginBrowserMatch[1]) || {};
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status, message, login: loginState(loginBrowserMatch[1]) }));
    return;
  }

  const preparationMatch = url.pathname.match(/^\/api\/prepare\/(\d+)$/);
  if (request.method === "GET" && preparationMatch) {
    const preparation = preparations.get(preparationMatch[1]);
    if (preparation?.access) preparation.access.login = loginState(preparationMatch[1]);
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

  if (url.pathname === "/test-executor-logo.png") {
    const logo = await fs.readFile(path.join(workspaceRoot, "test-executor-logo.png"));
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
    let regenerateSpec = false;
    for await (const chunk of request) body += chunk;
    let id;
    let testUrl;
    try {
      ({ id, testUrl, reviewed, selectedScenarioIds, selectedBrowsers, selectedTestTypes, regenerateSpec } = JSON.parse(body));
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
    let prepared = preparedRuns.get(String(id));
    // La preparación vive en memoria y se pierde cuando el runner se recarga (p. ej. tras una corrección):
    // se recupera del plan guardado si la URL coincide con la registrada en la historia.
    if (!prepared && reviewed === true && await storyTestUrl(id) === String(testUrl).trim()) {
      const plan = await readTestPlan(id, String(testUrl).trim());
      if (plan) {
        prepared = { testUrl: String(testUrl).trim(), plan };
        preparedRuns.set(String(id), prepared);
      }
    }
    if (reviewed !== true || !prepared || prepared.testUrl !== String(testUrl).trim()) {
      response.writeHead(409, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ message: "Primero valida el ambiente, revisa los casos y confirma que tienes acceso al enlace." }));
      return;
    }
    const blockedByLogin = loginGate(String(id));
    if (blockedByLogin) {
      response.writeHead(409, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ code: "LOGIN_REQUIRED", message: blockedByLogin, login: loginState(String(id)) }));
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
      const pid = launchRun(id, selectedScenarioIds, functionalSelected ? selectedBrowsers : [], selectedTestTypes, { regenerateSpec: regenerateSpec === true });
      if (pid !== null) activeRun = { storyId: String(id), pid };
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
      response.end(JSON.stringify({ status: "running", message: activeRun.message || null }));
      return;
    }
    const completed = completedRuns.get(id);
    if (completed) {
      if (completed.status === "failed") {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "failed", message: completed.message }));
        return;
      }
      if (completed.status === "completed") {
        try {
          await fs.access(completed.reportPath);
        } catch {
          try {
            completed.reportPath = await ensureReport(id);
          } catch (error) {
            completed.status = "failed";
            completed.message = `${getAgentProvider()} terminó, pero no se pudo recuperar el informe HTML: ${error.message}`;
          }
        }
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ status: completed.status, triageRunning: activeTriages.has(id), reportUrl: completed.status === "completed" ? `/reports/${id}` : null, message: completed.status === "completed" ? null : completed.message || `${getAgentProvider()} terminó, pero no encontró test-report.html.` }));
      return;
    }
    // Sin estado en memoria (p. ej. el runner se reinició): si el reporte se escribió después
    // del inicio de la ejecución, se considera completada; si no, se avisa en vez de fallar en silencio.
    const since = Number(url.searchParams.get("since") || 0);
    try {
      const reportStat = await fs.stat(path.join(workspaceRoot, "3-outputs", "run", `US-${id}`, "test-report.html"));
      if (since && reportStat.mtimeMs >= since) {
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ status: "completed", triageRunning: activeTriages.has(id), reportUrl: `/reports/${id}`, message: null }));
        return;
      }
    } catch {}
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "not_found", message: `El runner no tiene registro de una ejecución activa de US-${id}: probablemente se reinició o se detuvo durante la ejecución. Vuelve a ejecutar las pruebas.` }));
    return;
  }

  // PDF del reporte: Chromium renderiza la misma página del runner con sus colores y evidencias.
  const reportPdfMatch = url.pathname.match(/^\/reports\/(\d+)\/pdf$/);
  if (request.method === "GET" && reportPdfMatch) {
    const storyId = reportPdfMatch[1];
    if (!existsSync(path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "test-report.html"))) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Reporte todavía no disponible.");
      return;
    }
    const child = spawn(process.execPath, [path.join(workspaceRoot, "tools", "report-pdf.mjs"), `http://127.0.0.1:${port}/reports/${storyId}`], {
      cwd: workspaceRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks = [];
    let errorOutput = "";
    child.stdout.on("data", chunk => chunks.push(chunk));
    child.stderr.on("data", chunk => { errorOutput += chunk.toString(); });
    child.on("close", code => {
      if (code !== 0 || chunks.length === 0) {
        response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(`No se pudo generar el PDF: ${errorOutput.trim() || `código ${code}`}`);
        return;
      }
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="US-${storyId}-reporte-pruebas.pdf"`
      });
      response.end(Buffer.concat(chunks));
    });
    return;
  }

  const reportMatch = url.pathname.match(/^\/reports\/(\d+)$/);
  if (request.method === "GET" && reportMatch) {
    const reportPath = path.join(workspaceRoot, "3-outputs", "run", `US-${reportMatch[1]}`, "test-report.html");
    try {
      const report = await fs.readFile(reportPath, "utf8");
      // Botón "Guardar en PDF" añadido al servir, para que aparezca en todos los reportes.
      const pdfToolbar = `<style>.qa-pdf-toolbar{position:fixed;top:16px;right:16px;z-index:1000}.qa-pdf-toolbar a{display:inline-flex;align-items:center;gap:8px;padding:10px 16px;border-radius:8px;background:#16877c;color:#fff;font:600 14px/1.2 system-ui,sans-serif;text-decoration:none;box-shadow:0 6px 18px #17202a33}.qa-pdf-toolbar a:hover{background:#106d65}.qa-pdf-toolbar a[aria-busy="true"]{opacity:.7;pointer-events:none}@media print{.qa-pdf-toolbar{display:none}}</style><div class="qa-pdf-toolbar"><a href="/reports/${reportMatch[1]}/pdf" id="qa-save-pdf">⬇ Guardar en PDF</a></div><script>document.getElementById('qa-save-pdf').addEventListener('click',function(){var b=this;b.setAttribute('aria-busy','true');b.textContent='Generando PDF…';setTimeout(function(){b.removeAttribute('aria-busy');b.textContent='⬇ Guardar en PDF';},8000);});</script>`;
      const withToolbar = /<\/body>/i.test(report) ? report.replace(/<\/body>/i, `${pdfToolbar}</body>`) : `${report}${pdfToolbar}`;
      response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      response.end(withToolbar);
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
    const contentTypes = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif", ".svg": "image/svg+xml", ".mp4": "video/mp4", ".webm": "video/webm", ".json": "application/json; charset=utf-8", ".txt": "text/plain; charset=utf-8", ".html": "text/html; charset=utf-8", ".ts": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8" };
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

  // Un GET no lanza nada: otra web podría abrir el enlace sin que el usuario lo note.
  if (request.method !== "POST") {
    const result = page("Confirmar ejecución", `<form method="post" action="/run/${storyId}" class="result"><input type="hidden" name="confirm" value="1">¿Repetir las pruebas de la tarea <strong>${storyId}</strong> con la última selección guardada?<br><br><button class="button" type="submit" style="padding:12px 20px">Sí, ejecutar</button></form>`);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    return;
  }

  // El enlace directo repite la última selección guardada en el plan (escenarios, navegadores y modalidades).
  let savedPlan = null;
  try {
    const planPath = path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`, "planning", `US-${storyId}-plan.json`);
    savedPlan = JSON.parse(await fs.readFile(planPath, "utf8"));
  } catch {}
  const supportedTestTypes = new Set(["functional", "accessibility", "performance"]);
  const savedTestTypes = Array.isArray(savedPlan?.selectedTestTypes) ? savedPlan.selectedTestTypes.filter(type => supportedTestTypes.has(type)) : [];
  const savedScenarioIds = Array.isArray(savedPlan?.selectedScenarioIds) ? savedPlan.selectedScenarioIds : [];
  const savedFunctional = savedTestTypes.includes("functional");
  if (savedTestTypes.length === 0 || (savedFunctional && savedScenarioIds.length === 0)) {
    const result = page("Sin selección previa", `<div class="result error">La tarea <strong>${storyId}</strong> no tiene una selección de pruebas guardada. Prepárala y elige los casos en <a href="/qa-runner.html">qa-runner.html</a>; después podrás repetirla con este enlace.</div>`, 409);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    return;
  }
  const supportedBrowsers = new Set(["chromium", "firefox", "webkit"]);
  const savedBrowsers = Array.isArray(savedPlan.selectedBrowsers) ? savedPlan.selectedBrowsers.filter(browser => supportedBrowsers.has(browser)) : [];
  const browsersToRun = savedFunctional ? (savedBrowsers.length ? savedBrowsers : ["chromium"]) : [];
  const blockedByLogin = loginGate(storyId);
  if (blockedByLogin) {
    const result = page("Requiere usuario válido", `<div class="result error">${blockedByLogin.replace(/[&<>"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[char]))}<br><br>Configúralo en <a href="/qa-runner.html">qa-runner.html</a>.</div>`, 409);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    return;
  }

  try {
    activeRun = { storyId, pid: null };
    const imported = await importWorkItem(storyId);
    const pid = launchRun(storyId, savedFunctional ? savedScenarioIds : [], browsersToRun, savedTestTypes);
    if (pid !== null) activeRun = { storyId, pid };
    completedRuns.delete(storyId);
    const result = page("Pruebas iniciadas", `<div class="result">La tarea <strong>${storyId}</strong> fue importada y el agente QA se inició con el proceso <strong>${pid}</strong>.<br><br>Puedes cerrar esta pestaña; deja abierta la terminal del runner.</div>`);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
    console.log(`QA iniciado para US-${imported.id}: ${imported.title}`);
  } catch (error) {
    if (activeRun?.storyId === storyId) activeRun = null;
    const result = page("No se pudo iniciar", `<div class="result error">${error.message}</div>`, 500);
    response.writeHead(result.status, { "Content-Type": "text/html; charset=utf-8" });
    response.end(result.body);
  }
}

// Un error inesperado en una petición responde 500, pero no detiene el runner.
const server = http.createServer((request, response) => {
  handleRequest(request, response).catch(error => {
    console.error(`Error atendiendo ${request.method} ${request.url}:`, error);
    if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    if (!response.writableEnded) response.end(`Error interno del runner: ${error.message}`);
  });
});

// Los fallos en tareas de fondo (triage, login, agentes) se registran sin tumbar el proceso.
process.on("unhandledRejection", error => console.error("Error no controlado en una tarea en segundo plano:", error));
process.on("uncaughtException", error => console.error("Excepción no controlada:", error));

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`El puerto ${port} ya está en uso: probablemente ya hay un runner en marcha. Abre http://localhost:${port}/qa-runner.html o deténlo antes de iniciar otro.`);
    process.exit(2);
  }
  console.error("Error del servidor:", error);
});

server.listen(port, "127.0.0.1", () => {
  console.log(`QA Runner listo: http://localhost:${port}/run/<número-de-tarea>`);
  console.log(`Agente QA: ${getAgentProvider()} (${getAgentProvider() === "claude" ? resolveClaudeCommand() : resolveAgyCommand()})`);
});
