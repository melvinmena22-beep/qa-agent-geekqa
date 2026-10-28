// Datos que solo el usuario puede aportar (otro usuario con un perfil concreto, un registro existente,
// la respuesta a una ambigüedad). Un caso que los necesita queda BLOCKED; qa-runner.html los pide y,
// al guardarlos, el runner adapta y repite solo esos casos.
//
// El spec los declara así:  test.skip(!valor, "BLOCKED/NEEDS_INPUT: NOMBRE [credentials|text]: descripción")
// y los lee de process.env.QA_INPUT_NOMBRE (text) o QA_INPUT_NOMBRE_STORAGE_STATE (credentials: la sesión iniciada;
// el usuario y la contraseña solo se usan para iniciar sesión y nunca se guardan).
// También se reconocen los motivos que ya usan los specs (NO_TEST_USER, MISSING_TEST_DATA, CLARIFICATION_REQUIRED…).

import path from "node:path";

const CREDENTIAL_CODES = /^(NO_TEST_USER|TEST_USER|NO_USER|USER_REQUIRED|SECOND_USER|MISSING_TEST_USER|NO_RESTRICTED_USER)$/;
const TEXT_CODES = /^(MISSING_TEST_DATA|NO_TEST_DATA|TEST_DATA|MISSING_DATA|DATA_REQUIRED|NO_DATA|CLARIFICATION_REQUIRED)$/;
const NEEDS_INPUT = /^\s*([A-Z][A-Z0-9_]*)\s*\[(credentials|text)\]\s*:\s*([\s\S]*)$/;

export function inputEnvBase(storyId, name) {
  return `QA_US${storyId}_INPUT_${name}`;
}

export function inputKind(code) {
  if (CREDENTIAL_CODES.test(code)) return "credentials";
  if (TEXT_CODES.test(code)) return "text";
  return null;
}

// Agrupa los casos bloqueados por falta de datos en peticiones al usuario (una por dato distinto).
export function derivePendingInputs({ storyId, report, env = {} }) {
  const byName = new Map();
  for (const scenario of report?.scenarios || []) {
    if (scenario.status !== "BLOCKED" || !scenario.reason?.startsWith("BLOCKED/")) continue;
    const code = scenario.reason.slice("BLOCKED/".length);
    const detail = String(scenario.error || "").trim();
    let request = null;
    if (code === "NEEDS_INPUT") {
      const [, name, type, label] = detail.match(NEEDS_INPUT) || [];
      if (name) request = { name, type, label: label.trim() || name, code };
    } else {
      const type = inputKind(code);
      if (type) {
        // Mismo motivo y misma descripción = mismo dato (p. ej. el mismo usuario para varios casos).
        const existing = [...byName.values()].find(item => item.code === code && item.label === (detail || code));
        request = existing || { name: `${code}_${scenario.id}`, type, label: detail || code, code };
      }
    }
    if (!request) continue;
    const current = byName.get(request.name) || {
      ...request,
      description: code === "CLARIFICATION_REQUIRED"
        ? "Indica el comportamiento esperado aprobado por negocio; el agente ajustará el caso con tu respuesta."
        : request.type === "credentials"
          ? "Usuario de prueba con el perfil indicado. Se usa solo para iniciar sesión: se guarda la sesión, no el usuario ni la contraseña."
          : "Dato de prueba que el caso necesita; se guarda en 2-inputs/US-" + storyId + "/datos-prueba.md.",
      scenarios: []
    };
    if (!current.scenarios.includes(scenario.id)) current.scenarios.push(scenario.id);
    byName.set(request.name, current);
  }
  return [...byName.values()].map(item => {
    const base = inputEnvBase(storyId, item.name);
    // Un usuario cuenta como aportado si existe su sesión iniciada (su usuario y contraseña no se guardan).
    const provided = item.type === "credentials" ? Boolean(env[`${base}_STORAGE_STATE`]) : Boolean(env[base]);
    return { ...item, provided };
  });
}

// Variables QA_INPUT_* que reciben los tests a partir de las QA_US{id}_INPUT_* de .env.
export function inputEnvForTests(storyId, env, workspaceRoot) {
  const prefix = `QA_US${storyId}_INPUT_`;
  const result = {};
  for (const [name, value] of Object.entries(env)) {
    // Usuarios y contraseñas nunca llegan a los tests: solo la sesión iniciada.
    if (!name.startsWith(prefix) || !value || /_(USERNAME|PASSWORD)$/.test(name)) continue;
    const target = `QA_INPUT_${name.slice(prefix.length)}`;
    result[target] = target.endsWith("_STORAGE_STATE") ? path.resolve(workspaceRoot, value) : value;
  }
  return result;
}

// Valida lo que envía qa-runner.html para las peticiones pendientes. Devuelve { values, errors }.
export function validateInputValues(pending, submitted = {}) {
  const values = [];
  const errors = {};
  for (const request of pending) {
    const value = submitted[request.name];
    if (!value) continue;
    if (request.type === "credentials") {
      const username = String(value.username || "").trim();
      const password = String(value.password || "");
      if (!username && !password) continue;
      if (!username || !password) errors[request.name] = "Escribe el usuario y la contraseña.";
      else if (/[\r\n]/.test(username + password) || username.length > 300 || password.length > 300) errors[request.name] = "El usuario o la contraseña tienen un formato no válido.";
      else values.push({ request, username, password });
    } else {
      const text = String(value.value || "").trim();
      if (!text) continue;
      if (text.length > 2000) errors[request.name] = "El dato no puede superar 2000 caracteres.";
      else values.push({ request, value: text });
    }
  }
  return { values, errors };
}
