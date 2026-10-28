#!/usr/bin/env node
// Abre un navegador visible para que inicies sesión a mano (SSO, OTP, MFA) y guarda la sesión
// como storageState de Playwright. Las pruebas y el agente reutilizan esa sesión sin pedir credenciales.
//
// Uso: node tools/save-session.mjs <url-de-la-aplicación> <NOMBRE_VARIABLE>
// Ej.: node tools/save-session.mjs https://sideraqa.gruposid.com.do/home SIDERA_BUYER_STORAGE_STATE

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const workspaceRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const [targetUrl, variableName] = process.argv.slice(2);

if (!targetUrl || !/^https?:\/\//i.test(targetUrl) || !/^[A-Z][A-Z0-9_]*_STORAGE_STATE$/.test(variableName || "")) {
  console.error("Uso: node tools/save-session.mjs <url> <NOMBRE_STORAGE_STATE>");
  console.error("El nombre debe terminar en _STORAGE_STATE, p. ej. SIDERA_BUYER_STORAGE_STATE.");
  process.exit(2);
}

const authDir = path.join(workspaceRoot, ".auth");
const statePath = path.join(authDir, `${variableName.replace(/_STORAGE_STATE$/, "").toLowerCase()}.json`);
await fs.mkdir(authDir, { recursive: true });

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();
await page.goto(targetUrl);

console.log("\nInicia sesión en la ventana del navegador (incluido MFA si lo pide).");
console.log("Cuando veas la pantalla principal de la aplicación, vuelve aquí.");
const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
await prompt.question("Pulsa Enter para guardar la sesión... ");
prompt.close();

await context.storageState({ path: statePath });
await browser.close();

// Registra la ruta en .env para que el runner, las pruebas y el agente la encuentren.
const envPath = path.join(workspaceRoot, ".env");
let env = "";
try { env = await fs.readFile(envPath, "utf8"); } catch {}
const relativeState = path.relative(workspaceRoot, statePath).split(path.sep).join("/");
const line = `${variableName}=${relativeState}`;
const pattern = new RegExp(`^\\s*${variableName}\\s*=.*$`, "m");
env = pattern.test(env) ? env.replace(pattern, line) : `${env.replace(/\s*$/, "")}\n${line}\n`;
await fs.writeFile(envPath, env, "utf8");

console.log(`\nSesión guardada en ${relativeState} y registrada en .env como ${variableName}.`);
console.log("Reinicia el runner (node tools/qa-runner.mjs) para que la use.");
console.log("La sesión caduca como cualquier login: si las pruebas vuelven a pedir login, repite este paso.");
