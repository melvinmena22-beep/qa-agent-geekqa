// Modo híbrido: el agente genera el spec Playwright una vez; este módulo lo ejecuta
// directamente con Playwright Test y arma el execution-report.json y el test-report.html
// sin consultar al modelo, para que la ejecución quede por debajo de 2 minutos.

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { validateExecutionReport } from "./qa-guards.mjs";

const PLAYWRIGHT_HARD_LIMIT_MS = Number(process.env.QA_PLAYWRIGHT_LIMIT_MS || 150_000);

function storyDir(workspaceRoot, storyId) {
  return path.join(workspaceRoot, "3-outputs", "run", `US-${storyId}`);
}

export function specPath(workspaceRoot, storyId) {
  return path.join(storyDir(workspaceRoot, storyId), "tests", `US-${storyId}.spec.ts`);
}

// El spec de una historia puede estar dividido en partes que generan agentes en paralelo:
// US-{id}.spec.ts (parte 1), US-{id}.p2.spec.ts, US-{id}.p3.spec.ts…
export function partSpecPath(workspaceRoot, storyId, part) {
  return part === 1 ? specPath(workspaceRoot, storyId) : path.join(storyDir(workspaceRoot, storyId), "tests", `US-${storyId}.p${part}.spec.ts`);
}

// Partes existentes del spec, en orden.
export async function specFiles(workspaceRoot, storyId) {
  const directory = path.join(storyDir(workspaceRoot, storyId), "tests");
  const pattern = new RegExp(`^US-${storyId}(?:\\.p(\\d+))?\\.spec\\.ts$`);
  let names = [];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return names.map(name => ({ name, part: Number(name.match(pattern)?.[1] || (pattern.test(name) ? 1 : 0)) }))
    .filter(item => item.part > 0)
    .sort((a, b) => a.part - b.part)
    .map(item => ({ part: item.part, file: path.join(directory, item.name) }));
}

// Devuelve los escenarios seleccionados que todavía no tienen un test "SC_XXX: ..." en ninguna parte del spec.
export async function findMissingScenarios(workspaceRoot, storyId, scenarioIds) {
  const covered = new Set();
  for (const { file } of await specFiles(workspaceRoot, storyId)) {
    const source = await fs.readFile(file, "utf8");
    for (const match of source.matchAll(/\btest(?:\.only)?\(\s*['"`]\s*(SC_\d+)\s*:/g)) covered.add(match[1]);
  }
  return scenarioIds.filter(id => !covered.has(id));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripAnsi(value) {
  return String(value || "").replace(/\u001b\[[0-9;]*m/g, "");
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

// Ejecuta solo los escenarios y navegadores seleccionados. Resuelve con la ruta del JSON de resultados.
export function runPlaywright({ workspaceRoot, storyId, scenarioIds, browsers, onSpawn, env = {} }) {
  const outputDir = path.join(storyDir(workspaceRoot, storyId), "execution", "playwright");
  const jsonPath = path.join(outputDir, "results.json");
  // Todas las partes del spec (tests/US-{id}.spec.ts y tests/US-{id}.pN.spec.ts). Playwright trata el filtro
  // como expresión regular sobre la ruta; se ancla al nombre exacto para no incluir, p. ej., US-890.
  const relativeSpecs = `US-${storyId}(\\.p\\d+)?\\.spec\\.ts$`;
  const cli = path.join(workspaceRoot, "node_modules", "@playwright", "test", "cli.js");
  if (!existsSync(cli)) {
    return Promise.reject(new Error("No se encontró @playwright/test. Ejecuta npm install en la raíz del proyecto."));
  }
  const args = [
    cli, "test", relativeSpecs,
    "--grep", `\\b(?:${scenarioIds.map(escapeRegExp).join("|")}):`,
    ...browsers.map(browser => `--project=${browser}`),
    "--reporter=line,json",
    "--output", path.join(outputDir, "artifacts")
  ];
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const child = spawn(process.execPath, args, {
      cwd: workspaceRoot,
      env: { ...process.env, ...env, PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath, FORCE_COLOR: "0" },
      stdio: ["ignore", "inherit", "inherit"]
    });
    onSpawn?.(child);
    const hardLimit = setTimeout(() => child.kill(), PLAYWRIGHT_HARD_LIMIT_MS);
    child.on("error", error => { clearTimeout(hardLimit); reject(error); });
    // Playwright sale con código 1 cuando hay fallos; eso es un resultado válido, no un error.
    child.on("close", code => {
      clearTimeout(hardLimit);
      resolve({ code, jsonPath, durationMs: Date.now() - startedAt });
    });
  });
}

function collectSpecs(suites, specs = []) {
  for (const suite of suites || []) {
    specs.push(...(suite.specs || []));
    collectSpecs(suite.suites, specs);
  }
  return specs;
}

// Pasos de primer nivel del test. El reporte JSON de Playwright solo incluye los creados con test.step.
function collectSteps(steps = []) {
  return steps.map(step => ({ title: step.title, status: step.error ? "FAIL" : "PASS", durationMs: step.duration ?? null }));
}

function mapStatus(status) {
  if (status === "passed") return "PASS";
  if (status === "failed" || status === "timedOut") return "FAIL";
  return "BLOCKED";
}

// Sin ejecución de Playwright (todos los casos seleccionados fueron rechazados por la auditoría del spec).
export const NO_RUN = { code: null, jsonPath: null, durationMs: 0 };

// Convierte el JSON de Playwright al formato execution-report.json del agente y copia las capturas.
// invalid: escenarios rechazados por la auditoría del spec (qa-guards), que se registran como BLOCKED/SCRIPT_INVALID.
// notGenerated: escenarios que el agente no alcanzó a generar (BLOCKED/NOT_GENERATED; se completan en la siguiente ejecución).
// persist: false devuelve el reporte sin escribirlo (p. ej. para fusionarlo con el anterior).
export async function buildExecutionReport({ workspaceRoot, storyId, plan, scenarioIds, browsers, run, testTypes, invalid = new Map(), specAudit = [], notGenerated = new Set(), persist = true }) {
  const directory = storyDir(workspaceRoot, storyId);
  const screenshotsDir = path.join(directory, "execution", "screenshots");
  await fs.mkdir(screenshotsDir, { recursive: true });

  let raw = null;
  try {
    if (run.jsonPath) raw = JSON.parse(await fs.readFile(run.jsonPath, "utf8"));
  } catch {}
  const globalErrors = (raw?.errors || []).map(error => stripAnsi(error.message).split("\n")[0]).filter(Boolean);
  const results = new Map();
  for (const spec of collectSpecs(raw?.suites)) {
    const scenarioId = spec.title.match(/^\s*(SC_\d+)\s*:/)?.[1];
    if (!scenarioId) continue;
    for (const test of spec.tests || []) {
      const last = test.results?.[test.results.length - 1];
      const browser = test.projectName || "chromium";
      let screenshot = null;
      const attachment = last?.attachments?.find(item => item.name === "screenshot" && item.path && existsSync(item.path));
      if (attachment) {
        const target = path.join(screenshotsDir, `${scenarioId}-${browser}.png`);
        await fs.copyFile(attachment.path, target);
        screenshot = path.relative(directory, target).split(path.sep).join("/");
      }
      let error = stripAnsi(last?.error?.message || last?.errors?.[0]?.message || "");
      let reason = null;
      if (last?.status === "skipped") {
        // El spec bloquea el caso con test.skip(true, "BLOCKED/MOTIVO: detalle"); se usa ese motivo.
        const skip = [...(last.annotations || []), ...(test.annotations || [])].find(item => item.type === "skip" && item.description);
        const [, code, detail] = skip?.description.match(/^\s*(BLOCKED\/[A-Z_]+)\s*:?\s*([\s\S]*)$/) || [];
        reason = code || "BLOCKED/SKIPPED";
        error = code ? detail : skip?.description || "El spec omitió este caso sin indicar el motivo.";
      } else if (last?.status === "interrupted") {
        reason = "BLOCKED/TIME_BUDGET";
      }
      // Con reintentos, Playwright marca como "flaky" el test que falló y luego pasó.
      const flaky = test.status === "flaky";
      if (flaky) {
        reason = "FLAKY";
        const firstFailure = test.results.find(item => item.status === "failed" || item.status === "timedOut");
        error = `Intermitente: falló en el intento ${test.results.indexOf(firstFailure) + 1} y pasó al reintentar. ${stripAnsi(firstFailure?.error?.message || "")}`;
      }
      // TIMEOUT solo cuando se agota el tiempo del test o de la navegación; una aserción que espera
      // ("Timed out … waiting for expect") es un fallo de verificación real.
      // Evidencias del fallo para el bug: captura, video, trace y estado de la página de Playwright.
      const evidence = screenshot ? [{ type: "screenshot", path: screenshot }] : [];
      if (last?.status === "failed" || last?.status === "timedOut") {
        const evidenceDir = path.join(directory, "execution", "evidence", `${scenarioId}-${browser}`);
        for (const item of last.attachments || []) {
          const type = { video: "video", trace: "trace", "error-context": "page-snapshot" }[item.name];
          if (!type || !item.path || !existsSync(item.path)) continue;
          await fs.mkdir(evidenceDir, { recursive: true });
          const target = path.join(evidenceDir, `${type}${path.extname(item.path)}`);
          await fs.copyFile(item.path, target);
          evidence.push({ type, path: path.relative(directory, target).split(path.sep).join("/") });
        }
      }
      // Resultado de cada paso del escenario (test.step "N. texto" en el spec).
      const steps = collectSteps(last?.steps);
      const failureType = last?.status === "timedOut" || (last?.status === "failed" && /Test timeout of \d+ms exceeded|page\.goto: Timeout|navigation timeout/i.test(error)) ? "TIMEOUT"
        : last?.status === "failed" ? "ASSERTION" : null;
      results.set(`${scenarioId}|${browser}`, {
        status: last ? mapStatus(last.status) : "BLOCKED",
        reason,
        failureType,
        flaky,
        durationMs: last?.duration ?? null,
        error: error ? error.split("\n").slice(0, 6).join("\n") : null,
        screenshot,
        evidence,
        steps
      });
    }
  }

  const scenariosById = new Map((plan.testScenarios || []).map((scenario, index) => [scenario.id || `SC_${String(index + 1).padStart(3, "0")}`, scenario]));
  const scenarios = [];
  for (const scenarioId of scenarioIds) {
    const scenario = scenariosById.get(scenarioId) || {};
    for (const browser of browsers) {
      const result = notGenerated.has(scenarioId) ? {
        status: "BLOCKED",
        reason: "BLOCKED/NOT_GENERATED",
        failureType: null,
        flaky: false,
        durationMs: null,
        error: "El agente no alcanzó a generar este test en el tiempo asignado. Vuelve a ejecutar: solo se generarán los casos que faltan.",
        screenshot: null
      } : invalid.has(scenarioId) ? {
        status: "BLOCKED",
        reason: "BLOCKED/SCRIPT_INVALID",
        failureType: null,
        flaky: false,
        durationMs: null,
        error: `El test no se ejecutó porque el spec no es fiable: ${invalid.get(scenarioId)}. Regenera el script.`,
        screenshot: null
      } : results.get(`${scenarioId}|${browser}`) || {
        status: "BLOCKED",
        reason: globalErrors.length ? "BLOCKED/SCRIPT_ERROR" : "BLOCKED/NOT_RUN",
        failureType: null,
        flaky: false,
        durationMs: null,
        error: globalErrors[0] || "Playwright no ejecutó este caso (presupuesto de tiempo agotado o test no encontrado).",
        screenshot: null
      };
      scenarios.push({
        id: scenarioId,
        title: scenario.title || scenarioId,
        browser,
        testPolarity: scenario.testPolarity || null,
        requirementRefs: scenario.requirementRefs || [],
        technique: scenario.technique || null,
        ...result
      });
    }
  }

  const passed = scenarios.filter(item => item.status === "PASS").length;
  const failed = scenarios.filter(item => item.status === "FAIL").length;
  const blocked = scenarios.length - passed - failed;
  const report = {
    storyId: `US-${storyId}`,
    projectName: plan.projectName || `US-${storyId}`,
    url: plan.url || null,
    executedAt: new Date(Date.now() - run.durationMs).toISOString(),
    skill: "run-tests-browser",
    engine: "Playwright Test (modo híbrido, sin modelo durante la ejecución)",
    executionMode: "playwright",
    selectedTestTypes: testTypes,
    selectedBrowsers: browsers,
    selectedScenarioIds: scenarioIds,
    durationMs: run.durationMs,
    playwrightExitCode: run.code,
    playwrightErrors: globalErrors,
    specAudit: specAudit.map(item => ({ id: item.id, title: item.title, issues: item.issues })),
    summary: {
      total: scenarios.length,
      passed,
      failed,
      blocked,
      flaky: scenarios.filter(item => item.flaky).length,
      successRate: scenarios.length ? Math.round((passed / scenarios.length) * 100) : 0
    },
    scenarios,
    findings: [],
    triage: failed > 0 ? "pending" : "not_required"
  };
  const schemaErrors = await validateExecutionReport(workspaceRoot, report);
  if (schemaErrors.length) throw new Error(`execution-report.json no cumple schemas/execution-report.schema.json: ${schemaErrors.slice(0, 5).join("; ")}`);
  if (persist) await fs.writeFile(path.join(directory, "execution", "execution-report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

// Sustituye en el reporte anterior los resultados de los casos que se repitieron (p. ej. tras aportar
// un dato pendiente) y recalcula los totales.
export function mergeExecutionReports(previous, partial) {
  if (!previous?.scenarios) return partial;
  const key = item => `${item.id}|${item.browser}`;
  const updated = new Map(partial.scenarios.map(item => [key(item), item]));
  const scenarios = previous.scenarios.map(item => updated.get(key(item)) || item);
  for (const item of partial.scenarios) {
    if (!previous.scenarios.some(existing => key(existing) === key(item))) scenarios.push(item);
  }
  const count = status => scenarios.filter(item => item.status === status).length;
  const passed = count("PASS");
  const failed = count("FAIL");
  return {
    ...previous,
    executedAt: partial.executedAt,
    durationMs: (previous.durationMs || 0) + (partial.durationMs || 0),
    playwrightExitCode: partial.playwrightExitCode,
    playwrightErrors: partial.playwrightErrors,
    specAudit: [...(previous.specAudit || []).filter(item => !partial.selectedScenarioIds.includes(item.id)), ...(partial.specAudit || [])],
    summary: {
      total: scenarios.length,
      passed,
      failed,
      blocked: scenarios.length - passed - failed,
      flaky: scenarios.filter(item => item.flaky).length,
      successRate: scenarios.length ? Math.round((passed / scenarios.length) * 100) : 0
    },
    scenarios,
    triage: scenarios.some(item => item.status === "FAIL" && !item.triage) ? "pending" : failed ? previous.triage : "not_required"
  };
}

async function readStoryDescription(workspaceRoot, storyId) {
  try {
    const story = await fs.readFile(path.join(workspaceRoot, "2-inputs", `US-${storyId}`, "historia.md"), "utf8");
    return story.split(/\r?\n/).find(line => line.trim())?.replace(/^#+\s*/, "").trim() || `US-${storyId}`;
  } catch {
    return `US-${storyId}`;
  }
}

// Rellena la plantilla de log-results con los resultados de Playwright.
export async function writeHtmlReport({ workspaceRoot, storyId, report }) {
  const templatePath = path.join(workspaceRoot, ".agents", "skills", "99.log-results", "templates", "test-report-template.html");
  let html = await fs.readFile(templatePath, "utf8");
  const assets = `/reports/${storyId}/assets`;
  const statusClass = { PASS: "passed", FAIL: "failed", BLOCKED: "skipped" };
  const browserLabel = { chromium: "Chromium", firefox: "Firefox", webkit: "WebKit" };

  const rows = report.scenarios.map(item => `
                <tr class="color-${statusClass[item.status]}">
                    <td>${escapeHtml(item.id)}</td>
                    <td>${escapeHtml(item.title)}</td>
                    <td>${escapeHtml(`${item.testPolarity || "Sin clasificar"} · ${browserLabel[item.browser] || item.browser}`)}</td>
                    <td>${escapeHtml(item.requirementRefs.join(" | ") || "N/A")}</td>
                    <td>Funcional E2E</td>
                    <td>Automatizada (Playwright)</td>
                    <td class="status-${statusClass[item.status]}">${item.status}</td>
                    <td>${escapeHtml(item.reason ? `${item.reason}. ${item.error || ""}` : item.error || `OK en ${Math.round((item.durationMs || 0) / 100) / 10}s`)}</td>
                    <td>${item.status === "FAIL" ? (item.failureType === "TIMEOUT" ? "Pendiente de triage (tiempo de espera)" : "Pendiente de triage") : item.flaky ? "Intermitente: revisar estabilidad" : "N/A"}</td>
                    <td>${item.screenshot ? `<a href="${assets}/${escapeHtml(item.screenshot)}" target="_blank">Ver captura</a>` : "Sin captura"}</td>
                </tr>`).join("");

  const gallery = report.scenarios.filter(item => item.screenshot).map(item => `
            <figure class="evidence-item">
                <img src="${assets}/${escapeHtml(item.screenshot)}" alt="Estado final de ${escapeHtml(item.id)} en ${escapeHtml(browserLabel[item.browser] || item.browser)} (${item.status})">
                <figcaption>${escapeHtml(item.id)} · ${escapeHtml(browserLabel[item.browser] || item.browser)} · ${item.status}: captura tomada por Playwright al finalizar el caso.</figcaption>
            </figure>`).join("") || "<p>No se generaron capturas en esta ejecución.</p>";

  const failed = report.scenarios.filter(item => item.status === "FAIL");
  const bugsSection = failed.length
    ? `<div class="summary-card"><p>${failed.length} caso(s) fallaron. El triage con el agente QA clasifica cada fallo como defecto del producto o del script y documenta los bugs en <code>bugs/US-${storyId}-bugs.json</code>; esta sección se actualiza al terminar.</p></div>`
    : `<div class="summary-card"><p>No se identificaron bugs: todos los casos ejecutados pasaron.</p></div>`;

  const pendingGeneration = new Set(report.scenarios.filter(item => item.reason === "BLOCKED/NOT_GENERATED").map(item => item.id));
  const recommendations = pendingGeneration.size
    ? `Vuelve a ejecutar la historia: el agente generará solo los ${pendingGeneration.size} caso(s) que faltan (${[...pendingGeneration].join(", ")}) y conservará los ya generados.`
    : report.specAudit?.length
    ? `Regenerar el script: ${report.specAudit.length} test(s) se rechazaron por no ser fiables (${report.specAudit.map(item => `${item.id || item.title}: ${item.issues.join(", ")}`).join("; ")}) y sus casos quedaron como BLOCKED/SCRIPT_INVALID.`
    : failed.length
    ?"Revisar el triage de los casos fallidos antes de reportar. Si un fallo es del script (localizador o tiempos), corregir el spec y repetir solo ese caso."
    : report.summary.blocked
      ? "Repetir los casos bloqueados; si persisten, revisar el presupuesto de tiempo o la disponibilidad del ambiente."
      : "Mantener el spec como suite de regresión y repetirla en cada despliegue.";

  const durationMinutes = (report.durationMs / 60_000).toFixed(2);
  const fill = {
    "project_name": report.projectName,
    "projectName": report.projectName,
    "urlTested": report.url || "N/A",
    "storyDescription": await readStoryDescription(workspaceRoot, storyId),
    "timestamp": new Date(report.executedAt).toLocaleString("es-DO"),
    "usage.model": "No aplica: ejecución directa con Playwright Test (modo híbrido)",
    "testPlanLink": `${assets}/planning/US-${storyId}-plan.html`,
    "testCasesLink": `${assets}/tests/US-${storyId}.spec.ts`,
    "summary.total": report.summary.total,
    "summary.passed": report.summary.passed,
    "summary.failed": report.summary.failed,
    "summary.successRate": report.summary.successRate,
    "recommendations": recommendations
  };

  html = html
    .replace(/{{#each detailedResults}}[\s\S]*?{{\/each}}/, rows)
    .replace(/{{#each bugs}}[\s\S]*?{{\/each}}/, bugsSection)
    .replace("{{evidence_gallery}}", gallery)
    .replace(/{{#if accessibility\.executed}}[\s\S]*?{{else}}([\s\S]*?){{\/if}}/, "$1")
    .replace(/{{#if visual\.executed}}[\s\S]*?{{else}}([\s\S]*?){{\/if}}/, "$1")
    .replace(/{{accessibility\.reason}}/g, report.selectedTestTypes.includes("accessibility") ? "Se ejecuta a continuación con el agente QA." : "No se seleccionó esta modalidad.")
    .replace(/{{visual\.reason}}/g, "No se seleccionó esta modalidad.")
    .replace(/{{lighthouse\.reportLink}}/g, `${assets}/lighthouse/US-${storyId}-lighthouse.json`)
    .replace(/{{lighthouse\.[a-zA-Z]+}}/g, "N/A")
    .replace(/{{formatTime executionTime}}/g, durationMinutes)
    .replace(/{{usage\.totalCost}}/g, "0.00")
    .replace(/{{usage\.(?!model)[a-zA-Z]+}}/g, "0");
  for (const [key, value] of Object.entries(fill)) {
    html = html.split(`{{${key}}}`).join(escapeHtml(value));
  }

  const reportPath = path.join(storyDir(workspaceRoot, storyId), "test-report.html");
  await fs.writeFile(reportPath, html, "utf8");
  return reportPath;
}
