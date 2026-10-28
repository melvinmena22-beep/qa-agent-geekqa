// Pruebas del armado de bugs (paso a paso y evidencias). Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { bugMarkdown, buildBug, descriptionHtml, failedEntries, failingStepIndex, reproStepsHtml } from "../bug-builder.mjs";

const scenario = {
  id: "SC_004",
  title: "Guardar con documento duplicado",
  prerequisites: ["Existe un estudiante con documento 123"],
  steps: ["1. Abrir el formulario.", "2. Ingresar el documento 123.", "3. Pulsar Guardar.", "4. Verificar el mensaje de duplicidad."],
  expectedResult: "Se muestra un mensaje de documento duplicado.",
  requirementRefs: ["CA-06"]
};
const failing = {
  id: "SC_004", status: "FAIL", browser: "chromium", screenshot: "execution/screenshots/SC_004-chromium.png",
  error: "Error: expected 4xx\nReceived: 500",
  evidence: [
    { type: "screenshot", path: "execution/screenshots/SC_004-chromium.png" },
    { type: "video", path: "execution/evidence/SC_004-chromium/video.webm" },
    { type: "trace", path: "execution/evidence/SC_004-chromium/trace.zip" }
  ],
  steps: [
    { title: "1. Abrir el formulario.", status: "PASS" },
    { title: "2. Ingresar el documento 123.", status: "PASS" },
    { title: "3. Pulsar Guardar.", status: "FAIL" }
  ]
};
const report = { url: "https://app.example.com/estudiantes", executedAt: "2026-10-27T15:00:00Z", scenarios: [failing, { ...failing, status: "PASS", browser: "firefox" }] };

test("solo toma los resultados fallidos del escenario", () => {
  assert.deepEqual(failedEntries(report, "SC_004").map(item => item.browser), ["chromium"]);
  assert.deepEqual(failedEntries(report, "SC_009"), []);
});

test("identifica el paso que falló por su número o por su texto", () => {
  assert.equal(failingStepIndex([failing], scenario.steps), 2);
  assert.equal(failingStepIndex([{ steps: [{ title: "Pulsar Guardar.", status: "FAIL" }] }], scenario.steps), 2);
  assert.equal(failingStepIndex([{ steps: [] }], scenario.steps), -1);
});

test("el paso a paso sale del plan, con login y precondiciones, y marca el paso que falla", () => {
  const bug = buildBug({ storyId: "7", scenario, entries: [failing], report, input: { title: "Duplicado devuelve 500" }, login: { requiresLogin: true, appUrl: "https://app.example.com/odoo", username: "qa@example.com" } });
  assert.deepEqual(bug.reproSteps.map(step => step.text), [
    "Iniciar sesión en https://app.example.com/odoo con un usuario de prueba autorizado (qa@example.com).",
    "Precondición: Existe un estudiante con documento 123",
    "Abrir el formulario.", "Ingresar el documento 123.", "Pulsar Guardar.", "Verificar el mensaje de duplicidad."
  ]);
  assert.equal(bug.reproSteps.find(step => step.failing).text, "Pulsar Guardar.");
  assert.equal(bug.expected, scenario.expectedResult);
  assert.match(bug.actual, /Received: 500/);
  assert.deepEqual(bug.evidence.map(item => item.type), ["screenshot", "video", "trace"]);
  assert.ok(bug.tags.includes("QA-US7-SC_004"));
  assert.deepEqual(bug.stepResults, ["✓ 1. Abrir el formulario.", "✓ 2. Ingresar el documento 123.", "✗ 3. Pulsar Guardar."]);
});

test("el HTML incrusta la captura en el paso que falla y lista las evidencias", () => {
  const bug = buildBug({ storyId: "7", scenario, entries: [failing], report, input: { title: "Duplicado" } });
  const html = reproStepsHtml(bug, "https://dev.azure.com/attachments/abc");
  assert.match(html, /<li><b>Pulsar Guardar\.<\/b> <span[^>]*><b>← falla aquí:<\/b> Error: expected 4xx<\/span><br><img src="https:\/\/dev\.azure\.com\/attachments\/abc"/);
  const description = descriptionHtml(bug, { storyId: "7", attachments: [{ type: "video", browser: "chromium", name: "BUG-US-7-SC_004-video-chromium.webm" }] });
  assert.match(description, /Video de la ejecución \(chromium\): BUG-US-7-SC_004-video-chromium\.webm/);
  assert.match(description, /✗ 3\. Pulsar Guardar\./);
});

test("sin pasos en el plan usa los del agente y deja el resultado observado al final", () => {
  const bug = buildBug({ storyId: "7", scenario: { id: "SC_004" }, entries: [{ ...failing, steps: [] }], report, input: { title: "X", reproSteps: "1. Abrir\n2. Guardar" } });
  assert.deepEqual(bug.reproSteps.map(step => step.text), ["Abrir", "Guardar"]);
  assert.match(reproStepsHtml(bug), /<p><b>Resultado observado:<\/b> Error: expected 4xx<\/p>/);
  assert.match(bugMarkdown(bug, { storyId: "7", bugId: "BUG-US-7-SC_004" }), /## BUG-US-7-SC_004 — X/);
});
