// Pruebas de los controles deterministas del agente. Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  auditSpec, baseDomain, checkBugGate, invalidScenarios, isTrustedRequest, loginGateMessage, loginPlaceholders,
  normalizePlanScenarioIds, resolveLoginRequirement, validateExecutionReport
} from "../qa-guards.mjs";

const workspaceRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const ids = ["SC_001", "SC_002", "SC_003"];
const hosts = ["portal.example.com.do"];

test("rechaza un test sin aserciones aunque tenga el código comentado", () => {
  const source = `
    test('SC_001: Ver columna', async ({ page }) => {
      await page.goto('https://portal.example.com.do/login');
      // await expect(page.locator('th')).toBeVisible();
      /* expect(true).toBeTruthy(); */
    });`;
  const [result] = auditSpec(source, { planIds: ids, allowedHosts: hosts }).tests;
  assert.equal(result.valid, false);
  assert.match(result.issues.join(), /ninguna aserción/);
});

test("rechaza aserciones tautológicas", () => {
  const source = `test('SC_002: Cuadre', async ({ page }) => { expect(true).toBeTruthy(); });`;
  const [result] = auditSpec(source, { planIds: ids, allowedHosts: hosts }).tests;
  assert.equal(result.valid, false);
  assert.match(result.issues.join(), /tautológica/);
});

test("rechaza la navegación a un dominio distinto del de la historia", () => {
  const source = `
    test.beforeEach(async ({ page }) => { await page.goto('https://uniwebpro.geekqa.net/estudiantes'); });
    test('SC_001 - Compensación', async ({ page }) => { await expect(page.locator('x')).toBeVisible(); });
    test('SC_002: Otro', async ({ page }) => { await expect(page.locator('y')).toBeVisible(); });`;
  const audit = auditSpec(source, { planIds: ids, allowedHosts: hosts });
  assert.ok(audit.tests.every(item => item.issues.some(issue => /dominio ajeno/.test(issue))));
  assert.match(audit.tests[0].issues.join(), /SC_XXX:/);
});

test("acepta aserciones dentro de funciones auxiliares y subdominios del mismo dominio", () => {
  const source = `
    const url = 'https://app.example.com.do/estudiantes';
    const register = async (page) => { await page.goto(url); await expect(page.getByRole('table')).toBeVisible(); };
    const registerTwice = async (page) => { await register(page); await register(page); };
    test('SC_001: Registrar', async ({ page }) => { await registerTwice(page); });
    test('SC_002: Buscar', async ({ page }) => { await page.goto('https://api.example.com.do/x'); await expect(page).toHaveURL(/x/); });`;
  const audit = auditSpec(source, { planIds: ids, allowedHosts: hosts });
  assert.deepEqual(audit.invalid, []);
});

test("marca como placeholder el skip incondicional, pero no el condicional", () => {
  const source = `
    test('SC_001: Pendiente', async ({ page }) => { await open(page); test.skip(true, 'BLOCKED/LOCATORS_PENDING: sin sesión'); });
    test('SC_002: Con credenciales', async ({ page }) => {
      if (!process.env.USER_EMAIL) {
        test.skip(true, 'BLOCKED/CREDENTIALS: faltan');
      }
      await expect(page.getByRole('heading')).toBeVisible();
    });`;
  const [pending, conditional] = auditSpec(source, { planIds: ids, allowedHosts: hosts }).tests;
  assert.equal(pending.placeholder, true);
  assert.equal(pending.valid, true);
  assert.match(pending.skipReason, /LOCATORS_PENDING/);
  assert.equal(conditional.placeholder, false);
  assert.equal(conditional.valid, true);
});

test("señala los tests que no están en el plan y solo invalida los seleccionados", () => {
  const source = `
    test('SC_001: Ok', async ({ page }) => { await expect(page).toHaveTitle(/x/); });
    test('SC_011: Fuera del plan', async ({ page }) => { await expect(page).toHaveTitle(/x/); });`;
  const audit = auditSpec(source, { planIds: ids, allowedHosts: hosts });
  assert.match(audit.invalid[0].issues.join(), /no existe en el plan/);
  assert.equal(invalidScenarios(audit, ["SC_001"]).size, 0);
});

test("normaliza los IDs del plan a SC_NNN y conserva el original", () => {
  const plan = { testScenarios: [{ id: "S001" }, { id: "SC_02" }], selectedScenarioIds: ["SC_02"] };
  assert.equal(normalizePlanScenarioIds(plan), true);
  assert.deepEqual(plan.testScenarios.map(item => [item.id, item.legacyId]), [["SC_001", "S001"], ["SC_002", "SC_02"]]);
  assert.deepEqual(plan.selectedScenarioIds, ["SC_002"]);
  assert.equal(normalizePlanScenarioIds(plan), false);
});

test("calcula el dominio base con dominios de segundo nivel", () => {
  assert.equal(baseDomain("sideraqa.gruposid.com.do"), "gruposid.com.do");
  assert.equal(baseDomain("uniwebpro.geekqa.net"), "geekqa.net");
});

const scenario = (overrides = {}) => ({ id: "SC_001", title: "Caso", browser: "chromium", status: "PASS", reason: null, failureType: null, flaky: false, durationMs: 10, error: null, screenshot: null, ...overrides });
const report = scenarios => ({
  storyId: "US-1", projectName: "P", url: "https://portal.example.com.do", executedAt: "2026-10-27T00:00:00Z",
  executionMode: "playwright", selectedTestTypes: ["functional"], selectedBrowsers: ["chromium"], selectedScenarioIds: ["SC_001"],
  durationMs: 10, summary: { total: scenarios.length, passed: scenarios.filter(item => item.status === "PASS").length, failed: scenarios.filter(item => item.status === "FAIL").length, blocked: scenarios.filter(item => item.status === "BLOCKED").length, successRate: 100 },
  scenarios, findings: [], triage: "not_required"
});

test("valida execution-report.json contra el esquema único", async () => {
  assert.deepEqual(await validateExecutionReport(workspaceRoot, report([scenario()])), []);
  const legacy = { stats: {}, suites: [] };
  assert.ok((await validateExecutionReport(workspaceRoot, legacy)).length > 0);
  const badTotals = report([scenario()]);
  badTotals.summary.failed = 1;
  assert.match((await validateExecutionReport(workspaceRoot, badTotals)).join(), /totales/);
  const freeTextReason = report([scenario({ status: "FAIL", reason: "Defecto del producto" })]);
  freeTextReason.summary = { total: 1, passed: 0, failed: 1, blocked: 0, successRate: 0 };
  assert.match((await validateExecutionReport(workspaceRoot, freeTextReason)).join(), /reason/);
});

test("solo permite registrar bugs de escenarios fallidos, en el ambiente de la historia y con evidencia", () => {
  const failed = report([scenario({ status: "FAIL", failureType: "ASSERTION" })]);
  const base = { report: failed, scenarioId: "SC_001", environment: "https://portal.example.com.do/login · Chromium", evidenceFiles: [{ type: "screenshot", path: "execution/screenshots/SC_001-chromium.png" }], allowedHosts: hosts };
  assert.doesNotThrow(() => checkBugGate(base));
  assert.throws(() => checkBugGate({ ...base, evidenceFiles: [] }), /no dejó evidencias/);
  assert.throws(() => checkBugGate({ ...base, environment: "https://uniwebpro.geekqa.net/estudiantes" }), /no corresponde/);
  assert.throws(() => checkBugGate({ ...base, environment: "Chromium en Windows" }), /URL/);
  assert.throws(() => checkBugGate({ ...base, report: report([scenario()]) }), /no figura como FAIL/);
  const timeout = report([scenario({ status: "FAIL", failureType: "TIMEOUT" })]);
  assert.throws(() => checkBugGate({ ...base, report: timeout }), /tiempo de espera/);
  assert.doesNotThrow(() => checkBugGate({ ...base, report: timeout, timeoutReproduced: true }));
});

test("el runner rechaza peticiones de otros orígenes", () => {
  const port = 8787;
  const local = { host: "localhost:8787" };
  assert.equal(isTrustedRequest({ method: "GET", headers: local }, port), true);
  assert.equal(isTrustedRequest({ method: "POST", headers: { ...local, origin: "http://localhost:8787", "content-type": "application/json" } }, port), true);
  assert.equal(isTrustedRequest({ method: "POST", headers: { ...local, origin: "https://evil.example", "content-type": "application/json" } }, port), false);
  assert.equal(isTrustedRequest({ method: "POST", headers: { ...local, "content-type": "text/plain" } }, port), false);
  assert.equal(isTrustedRequest({ method: "GET", headers: { host: "attacker.example:8787" } }, port), false);
  assert.equal(isTrustedRequest({ method: "GET", headers: { ...local, "sec-fetch-site": "cross-site" } }, port), false);
  assert.equal(isTrustedRequest({ method: "POST", headers: { ...local, "content-type": "application/x-www-form-urlencoded" } }, port), false);
});

test("la historia requiere login si lo indica la web, el plan o el spec", () => {
  assert.equal(resolveLoginRequirement({}).required, false);
  assert.equal(resolveLoginRequirement({ detected: { requiresLogin: false } }).required, false);
  // La portada pública de Odoo no pide login, pero el plan sí lo declara.
  const fromPlan = resolveLoginRequirement({ detected: { requiresLogin: false }, planAuthentication: { required: true, evidence: "usuario autorizado de Bodeguita" } });
  assert.equal(fromPlan.required, true);
  assert.deepEqual(fromPlan.sources.map(item => item.source), ["plan"]);
  assert.equal(resolveLoginRequirement({ detected: { requiresLogin: true, evidence: "Sitio Odoo" } }).required, true);
  assert.equal(resolveLoginRequirement({ specRequiresLogin: true }).required, true);
  // Si la detección falla, no se asume nada: decide el plan o el spec.
  assert.equal(resolveLoginRequirement({ detected: { ok: false, requiresLogin: null } }).required, false);
});

test("no se ejecuta sin usuario válido cuando la historia requiere login", () => {
  const required = resolveLoginRequirement({ detected: { requiresLogin: true, evidence: "Sitio Odoo: /odoo exige iniciar sesión." } });
  assert.match(loginGateMessage(required, { ready: false }), /No se ejecutan pruebas sin un usuario válido: Sitio Odoo/);
  assert.equal(loginGateMessage(required, { ready: true }), null);
  assert.equal(loginGateMessage(resolveLoginRequirement({}), { ready: false }), null);
});

test("detecta specs rellenos de casos bloqueados por credenciales", () => {
  const source = `
    const CREDENTIALS = 'BLOCKED/CREDENTIALS: el backend de Odoo redirige a /web/login';
    test('SC_001: Crear registro', async () => { test.skip(true, \`\${CREDENTIALS} (usuario autorizado).\`); });
    test('SC_002: Buscar', async ({ page }) => { await expect(page).toHaveTitle(/x/); });`;
  const audit = auditSpec(source, { planIds: ids });
  assert.deepEqual(loginPlaceholders(audit).map(item => item.id), ["SC_001"]);
  assert.deepEqual(loginPlaceholders(audit, ["SC_002"]), []);
});
