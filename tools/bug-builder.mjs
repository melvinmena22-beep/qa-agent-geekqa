// Arma el contenido de un bug a partir de datos verificables, sin depender de lo que redacte el modelo:
// pasos del plan (marcando el que falló), resultado de cada paso de la ejecución, evidencias de Playwright
// (captura, video, trace, estado de la página), System Info y criterios de aceptación.
// Lo usan create_azure_bug (Azure DevOps) y el registro local bugs/US-{id}-bugs.json|md.

import os from "node:os";

export const EVIDENCE_LABELS = {
  screenshot: "Captura en el momento del fallo",
  video: "Video de la ejecución",
  trace: "Trace de Playwright (abrir con npx playwright show-trace)",
  "page-snapshot": "Estado de la página (árbol de accesibilidad) al fallar",
  extra: "Evidencia adicional"
};

const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
const stripNumber = text => String(text).replace(/^\s*(paso\s*)?\d+\s*[.):-]\s*/i, "").trim();

// Resultados FAIL del escenario (uno por navegador).
export function failedEntries(report, scenarioId) {
  return (report?.scenarios || []).filter(item => item.id === scenarioId && item.status === "FAIL");
}

// Índice (0-based) del paso del plan que falló, según los test.step de la ejecución ("N. texto").
export function failingStepIndex(entries, planSteps) {
  for (const entry of entries) {
    const failed = (entry.steps || []).find(step => step.status === "FAIL");
    if (!failed) continue;
    const number = Number(String(failed.title).match(/^\s*(?:paso\s*)?(\d+)/i)?.[1]);
    if (number >= 1 && number <= planSteps.length) return number - 1;
    const byText = planSteps.findIndex(step => stripNumber(step).toLowerCase() === stripNumber(failed.title).toLowerCase());
    if (byText >= 0) return byText;
  }
  return -1;
}

export function buildBug({ storyId, scenario = {}, entries, report = {}, input = {}, acceptanceCriteria = "", login = null, extraEvidence = [] }) {
  const scenarioId = scenario.id || entries[0]?.id;
  const planSteps = Array.isArray(scenario.steps) ? scenario.steps.filter(Boolean) : [];
  const failingIndex = failingStepIndex(entries, planSteps);
  const providedSteps = String(input.reproSteps || "").split(/\r?\n/).map(stripNumber).filter(Boolean);

  // Paso a paso: precondiciones + pasos del plan (fuente fiable); los del modelo solo si el plan no los tiene.
  const reproSteps = [];
  if (login?.requiresLogin) reproSteps.push({ text: `Iniciar sesión en ${login.appUrl || report.url || "la aplicación"} con un usuario de prueba autorizado${login.username ? ` (${login.username})` : ""}.`, kind: "precondition" });
  for (const prerequisite of scenario.prerequisites || []) reproSteps.push({ text: `Precondición: ${stripNumber(prerequisite)}`, kind: "precondition" });
  const actions = planSteps.length ? planSteps.map(stripNumber) : providedSteps;
  actions.forEach((text, index) => reproSteps.push({ text, kind: "step", failing: index === failingIndex }));

  const browsers = [...new Set(entries.map(item => item.browser))];
  const executedAt = report.executedAt ? new Date(report.executedAt) : new Date();
  const expected = String(input.expectedResult || scenario.expectedResult || "").trim();
  const actual = String(input.actualResult || entries[0]?.error || "").trim();
  const failureLine = String(entries[0]?.error || "").split("\n")[0];

  const systemInfo = [
    ["Ambiente/URL", report.url || "No disponible"],
    ["Navegador", browsers.map(browser => ({ chromium: "Chromium", firefox: "Firefox", webkit: "WebKit (Safari)" }[browser] || browser)).join(", ") + " (Playwright)"],
    ["Sistema operativo", `${os.type()} ${os.release()}`],
    ["Resolución", "1280 × 720 (viewport de Playwright)"],
    ["Usuario tester", login?.username || (login?.requiresLogin ? "Usuario de prueba de la historia" : "No requiere login")],
    ["Fecha de ejecución", executedAt.toLocaleString("es-DO")],
    ["Escenario", `${scenarioId} · ${scenario.title || ""}`.trim()],
    ["Criterios relacionados", (scenario.requirementRefs || []).join(" | ") || "No especificados"]
  ];

  const evidence = [];
  for (const entry of entries) {
    if (entry.screenshot) evidence.push({ type: "screenshot", path: entry.screenshot, browser: entry.browser });
    for (const item of entry.evidence || []) {
      if (item.type !== "screenshot" || item.path !== entry.screenshot) evidence.push({ ...item, browser: entry.browser });
    }
  }
  for (const path of extraEvidence) evidence.push({ type: "extra", path, browser: null });

  const stepResults = (entries[0]?.steps || []).map(step => `${step.status === "FAIL" ? "✗" : "✓"} ${step.title}`);
  const title = String(input.title || `${scenarioId}: ${scenario.title || "fallo en la ejecución"}`).trim();

  return {
    scenarioId, title, reproSteps, expected, actual, failureLine, systemInfo, evidence, stepResults, browsers,
    severity: input.severity || "3 - Medium",
    impact: input.impact || "No especificado",
    notes: String(input.evidence || input.notes || "").trim(),
    acceptanceCriteria: String(acceptanceCriteria || "").trim(),
    tags: ["QA-Agente", `US-${storyId}`, scenarioId, `QA-US${storyId}-${scenarioId}`]
  };
}

// Repro Steps en HTML; la captura del fallo se incrusta debajo del paso que falló (o al final).
export function reproStepsHtml(bug, screenshotUrl = null) {
  const image = screenshotUrl ? `<br><img src="${escapeHtml(screenshotUrl)}" alt="Captura del fallo" style="max-width:720px;border:1px solid #ccc">` : "";
  const failingPlaced = bug.reproSteps.some(step => step.failing);
  const items = bug.reproSteps.map(step => step.failing
    ? `<li><b>${escapeHtml(step.text)}</b> <span style="color:#b00020"><b>← falla aquí:</b> ${escapeHtml(bug.failureLine)}</span>${image}</li>`
    : `<li>${escapeHtml(step.text)}</li>`).join("");
  const tail = failingPlaced ? "" : `<p><b>Resultado observado:</b> ${escapeHtml(bug.failureLine || bug.actual)}</p>${image}`;
  return `<ol>${items}</ol>${tail}`;
}

export function descriptionHtml(bug, { storyId, attachments = [] }) {
  const section = (label, value) => value ? `<b>${label}:</b><br>${escapeHtml(value).replace(/\r?\n/g, "<br>")}` : "";
  return [
    `<b>Historia relacionada:</b> US-${storyId} · escenario ${escapeHtml(bug.scenarioId)}`,
    `<b>Impacto:</b> ${escapeHtml(bug.impact)}`,
    section("Resultado esperado", bug.expected),
    section("Resultado actual", bug.actual),
    bug.stepResults.length ? `<b>Resultado por paso:</b><br>${bug.stepResults.map(escapeHtml).join("<br>")}` : "",
    section("Criterios de aceptación de la historia", bug.acceptanceCriteria),
    section("Notas del análisis", bug.notes),
    attachments.length ? `<b>Evidencias adjuntas:</b><br>${attachments.map(item => `${escapeHtml(EVIDENCE_LABELS[item.type] || item.type)}${item.browser ? ` (${escapeHtml(item.browser)})` : ""}: ${escapeHtml(item.name)}`).join("<br>")}` : ""
  ].filter(Boolean).join("<br><br>");
}

export function systemInfoHtml(bug) {
  return bug.systemInfo.map(([label, value]) => `<b>${escapeHtml(label)}:</b> ${escapeHtml(value)}`).join("<br>");
}

// Sección Markdown del bug para bugs/US-{id}-bugs.md (plantilla de report-bugs).
export function bugMarkdown(bug, { storyId, bugId, azure = null, localEvidence = [] }) {
  const steps = bug.reproSteps.map((step, index) => `${index + 1}. ${step.failing ? `**${step.text}** ← falla aquí: ${bug.failureLine}` : step.text}`).join("\n");
  return [
    `## ${bugId} — ${bug.title}`,
    "",
    `**Historia relacionada:** US-${storyId} · ${bug.scenarioId}`,
    `**Severidad:** ${bug.severity}`,
    `**Impacto:** ${bug.impact}`,
    `**Azure DevOps:** ${azure ? `[#${azure.id}](${azure.url})${azure.alreadyExists ? " (ya existía)" : ""}` : "no registrado"}`,
    "",
    "### Repro Steps",
    steps,
    "",
    "### System Info",
    bug.systemInfo.map(([label, value]) => `- **${label}:** ${value}`).join("\n"),
    "",
    "### Expected Result",
    bug.expected || "No especificado",
    "",
    "### Actual Result",
    bug.actual || "No especificado",
    ...(bug.stepResults.length ? ["", "### Resultado por paso", bug.stepResults.map(step => `- ${step}`).join("\n")] : []),
    "",
    "### Evidence",
    localEvidence.length ? localEvidence.map(item => `- ${EVIDENCE_LABELS[item.type] || item.type}${item.browser ? ` (${item.browser})` : ""}: [${item.path}](${item.path})`).join("\n") : "- Sin evidencias disponibles",
    ""
  ].join("\n");
}
