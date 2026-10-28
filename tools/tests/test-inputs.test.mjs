// Pruebas de los datos que el usuario aporta para desbloquear casos. Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { derivePendingInputs, inputEnvForTests, validateInputValues } from "../test-inputs.mjs";
import { mergeExecutionReports } from "../hybrid-executor.mjs";

const blocked = (id, reason, error, browser = "chromium") => ({ id, browser, status: "BLOCKED", reason, error });
const report = {
  scenarios: [
    blocked("SC_002", "BLOCKED/NO_TEST_USER", "no hay usuario de perfil restringido (AMB-003)"),
    blocked("SC_003", "BLOCKED/NO_TEST_USER", "no hay usuario sin acceso a Bodeguita (AMB-003)"),
    blocked("SC_003", "BLOCKED/NO_TEST_USER", "no hay usuario sin acceso a Bodeguita (AMB-003)", "firefox"),
    blocked("SC_007", "BLOCKED/NO_TEST_USER", "no hay usuario sin acceso a Bodeguita (AMB-003)"),
    blocked("SC_010", "BLOCKED/NEEDS_INPUT", "SOLPED_SIN_EVENTO [text]: número de solped sin evento en SAP QA"),
    blocked("SC_026", "BLOCKED/CLARIFICATION_REQUIRED", "AMB-004 no define el destinatario"),
    blocked("SC_013", "BLOCKED/MODULE_NOT_FOUND", "el menú no ofrece Bodeguita"),
    blocked("SC_020", "BLOCKED/TIME_BUDGET", "sin tiempo"),
    { id: "SC_001", browser: "chromium", status: "PASS", reason: null }
  ]
};

test("convierte los casos bloqueados por datos en peticiones al usuario", () => {
  const inputs = derivePendingInputs({ storyId: "89", report });
  assert.deepEqual(inputs.map(item => [item.name, item.type, item.scenarios.join(",")]), [
    ["NO_TEST_USER_SC_002", "credentials", "SC_002"],
    ["NO_TEST_USER_SC_003", "credentials", "SC_003,SC_007"],
    ["SOLPED_SIN_EVENTO", "text", "SC_010"],
    ["CLARIFICATION_REQUIRED_SC_026", "text", "SC_026"]
  ]);
  assert.equal(inputs[2].label, "número de solped sin evento en SAP QA");
  assert.match(inputs[3].description, /comportamiento esperado aprobado/);
});

test("marca como aportados los datos que ya están en .env", () => {
  // Del usuario solo se guarda la sesión: una contraseña en el entorno no cuenta como dato aportado.
  const env = { QA_US89_INPUT_NO_TEST_USER_SC_003_STORAGE_STATE: ".auth/us89-input-no_test_user_sc_003.json", QA_US89_INPUT_NO_TEST_USER_SC_002_PASSWORD: "x", QA_US89_INPUT_SOLPED_SIN_EVENTO: "4500001" };
  const inputs = derivePendingInputs({ storyId: "89", report, env });
  const byName = Object.fromEntries(inputs.map(item => [item.name, item]));
  assert.equal(byName.NO_TEST_USER_SC_003.provided, true);
  assert.equal("username" in byName.NO_TEST_USER_SC_003, false);
  assert.equal(byName.SOLPED_SIN_EVENTO.provided, true);
  assert.equal(byName.NO_TEST_USER_SC_002.provided, false);
});

test("los tests reciben los datos como QA_INPUT_* con rutas de sesión absolutas, nunca usuarios ni contraseñas", () => {
  const env = { QA_US89_INPUT_X_USERNAME: "u", QA_US89_INPUT_X_PASSWORD: "p", QA_US89_INPUT_X_STORAGE_STATE: ".auth/us89-input-x.json", QA_US89_INPUT_W: "4500001", QA_US88_INPUT_Y: "otra historia", QA_US89_INPUT_Z: "" };
  const result = inputEnvForTests("89", env, "C:/ws");
  assert.deepEqual(Object.keys(result).sort(), ["QA_INPUT_W", "QA_INPUT_X_STORAGE_STATE"]);
  assert.equal(result.QA_INPUT_X_STORAGE_STATE, path.resolve("C:/ws", ".auth/us89-input-x.json"));
});

test("valida lo que envía la interfaz y omite lo que se dejó vacío", () => {
  const pending = derivePendingInputs({ storyId: "89", report });
  const { values, errors } = validateInputValues(pending, {
    NO_TEST_USER_SC_002: { username: "", password: "" },
    NO_TEST_USER_SC_003: { username: "sin.acceso@example.com", password: "" },
    SOLPED_SIN_EVENTO: { value: "  4500001  " },
    CLARIFICATION_REQUIRED_SC_026: { value: "x".repeat(2001) },
    INVENTADO: { value: "no se pidió" }
  });
  assert.deepEqual(values.map(item => [item.request.name, item.value]), [["SOLPED_SIN_EVENTO", "4500001"]]);
  assert.deepEqual(Object.keys(errors), ["NO_TEST_USER_SC_003", "CLARIFICATION_REQUIRED_SC_026"]);
});

test("al repetir casos, el reporte conserva los demás y recalcula los totales", () => {
  const previous = {
    storyId: "US-89", triage: "done", durationMs: 1000, specAudit: [{ id: "SC_003", title: "x", issues: ["y"] }],
    scenarios: [{ id: "SC_001", browser: "chromium", status: "PASS" }, { id: "SC_003", browser: "chromium", status: "BLOCKED", reason: "BLOCKED/NO_TEST_USER" }],
    summary: { total: 2, passed: 1, failed: 0, blocked: 1, successRate: 50 }
  };
  const partial = {
    executedAt: "2026-10-28T10:00:00Z", durationMs: 500, playwrightExitCode: 1, playwrightErrors: [], selectedScenarioIds: ["SC_003"], specAudit: [],
    scenarios: [{ id: "SC_003", browser: "chromium", status: "FAIL", reason: null }]
  };
  const merged = mergeExecutionReports(previous, partial);
  assert.deepEqual(merged.scenarios.map(item => `${item.id}:${item.status}`), ["SC_001:PASS", "SC_003:FAIL"]);
  assert.deepEqual(merged.summary, { total: 2, passed: 1, failed: 1, blocked: 0, flaky: 0, successRate: 50 });
  assert.equal(merged.triage, "pending");
  assert.equal(merged.durationMs, 1500);
  assert.deepEqual(merged.specAudit, []);
});
