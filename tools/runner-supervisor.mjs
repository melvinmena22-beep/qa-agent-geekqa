#!/usr/bin/env node
// Mantiene tools/qa-runner.mjs siempre disponible en http://localhost:8787:
// - lo reinicia si se detiene por un error;
// - lo recarga cuando cambian tools/*.mjs o .env (después de una corrección del agente),
//   esperando a que no haya una ejecución en curso y solo si el código nuevo compila.
// Uso: npm start  (o .\start-runner.ps1 para dejarlo en su propia ventana).

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const workspaceRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const port = Number(process.env.QA_RUNNER_PORT || 8787);
const runnerScript = path.join(workspaceRoot, "tools", "qa-runner.mjs");
const stateUrl = `http://127.0.0.1:${port}/api/runner-state`;

let child = null;
let stopping = false;
let restartTimer = null;
let reloadTimer = null;
let startedAt = 0;
let crashDelayMs = 1_000;
const pendingChanges = new Set();

const log = message => console.log(`[supervisor ${new Date().toLocaleTimeString("es-DO")}] ${message}`);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function runnerState() {
  try {
    const response = await fetch(stateUrl, { signal: AbortSignal.timeout(2_000) });
    return response.ok ? await response.json() : null;
  } catch {
    return null;
  }
}

function start() {
  clearTimeout(restartTimer);
  startedAt = Date.now();
  child = spawn(process.execPath, [runnerScript], { cwd: workspaceRoot, stdio: "inherit" });
  child.on("exit", async (code, signal) => {
    child = null;
    if (stopping) return;
    if (code === 2) {
      // Puerto ocupado: si responde otro runner, este supervisor sobra.
      if (await runnerState()) {
        log(`Ya hay un runner respondiendo en el puerto ${port}. Ciérralo antes de iniciar el supervisor.`);
        process.exit(0);
      }
    }
    // Si estuvo en marcha más de un minuto, el fallo no es de arranque: se reinicia rápido.
    crashDelayMs = Date.now() - startedAt > 60_000 ? 1_000 : Math.min(crashDelayMs * 2, 30_000);
    log(`El runner se detuvo (código ${code ?? signal}). Reiniciando en ${crashDelayMs / 1000} s…`);
    restartTimer = setTimeout(start, crashDelayMs);
  });
}

async function stopChild() {
  if (!child) return;
  const exited = new Promise(resolve => child.once("exit", resolve));
  child.kill();
  await Promise.race([exited, sleep(5_000)]);
}

// El código nuevo debe compilar; si no, se mantiene el runner actual en marcha.
function syntaxErrors(files) {
  return files.filter(file => file.endsWith(".mjs") && fs.existsSync(file))
    .map(file => ({ file, result: spawnSync(process.execPath, ["--check", file], { encoding: "utf8" }) }))
    .filter(item => item.result.status !== 0)
    .map(item => `${path.relative(workspaceRoot, item.file)}: ${(item.result.stderr || "").trim().split("\n").slice(0, 4).join(" ")}`);
}

// ¿El .env actual lo escribió el propio runner (al guardar credenciales o sesiones)? Esos cambios ya están
// en su memoria; recargarlo borraría la preparación en curso y la ejecución pediría validar de nuevo.
function envWrittenByRunner() {
  try {
    const env = fs.readFileSync(path.join(workspaceRoot, ".env"));
    const written = fs.readFileSync(path.join(workspaceRoot, ".auth", "env-written-by-runner.sha256"), "utf8").trim();
    return createHash("sha256").update(env).digest("hex") === written;
  } catch {
    return false;
  }
}

async function reload() {
  const files = [...pendingChanges].filter(file => !(path.basename(file) === ".env" && envWrittenByRunner()));
  pendingChanges.clear();
  if (!files.length) return;
  const errors = syntaxErrors([runnerScript, ...files]);
  if (errors.length) {
    log(`No se recarga: el código nuevo tiene errores y el runner sigue con la versión anterior.\n  ${errors.join("\n  ")}`);
    return;
  }
  for (let state = await runnerState(); state?.busy; state = await runnerState()) {
    log("Hay una ejecución en curso; la recarga espera a que termine…");
    await sleep(10_000);
  }
  log(`Recargando el runner por cambios en: ${files.map(file => path.relative(workspaceRoot, file)).join(", ")}`);
  stopping = true;
  await stopChild();
  stopping = false;
  crashDelayMs = 1_000;
  start();
}

function watch(target, filter) {
  fs.watch(target, (event, name) => {
    if (!name || !filter(name)) return;
    pendingChanges.add(path.join(fs.statSync(target).isDirectory() ? target : path.dirname(target), name));
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => reload().catch(error => log(`Error al recargar: ${error.message}`)), 1_500);
  });
}

if (await runnerState()) {
  log(`Ya hay un runner en marcha en http://localhost:${port}/qa-runner.html; no se inicia otro.`);
  process.exit(0);
}

watch(path.join(workspaceRoot, "tools"), name => name.endsWith(".mjs"));
watch(workspaceRoot, name => name === ".env");
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    stopping = true;
    await stopChild();
    process.exit(0);
  });
}
log(`Supervisando el runner. Se reinicia solo si falla y se recarga al cambiar tools/*.mjs o .env. Ctrl + C para detenerlo.`);
start();
