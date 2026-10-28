#!/usr/bin/env node
// Detecta si una URL exige login y valida credenciales, guardando la sesión como storageState.
// Lo usa tools/qa-runner.mjs en un proceso aparte. Escribe una sola línea JSON en stdout.
//
//   node tools/login-probe.mjs detect <url>
//   node tools/login-probe.mjs form <url> <storageState>         (QA_LOGIN_USERNAME y QA_LOGIN_PASSWORD por entorno)
//   node tools/login-probe.mjs interactive <url> <storageState>  (abre un navegador visible para SSO/MFA)
//   node tools/login-probe.mjs check <url> <storageState>        (comprueba que una sesión guardada sigue activa)
//
// La URL de pruebas puede ser pública (por ejemplo, la portada de un sitio Odoo) aunque la funcionalidad
// esté detrás de un login. Por eso, si la URL no pide login, se busca la zona privada de la aplicación:
// rutas conocidas de la plataforma y enlaces de "Iniciar sesión".

import fs from "node:fs/promises";
import process from "node:process";
import { chromium } from "@playwright/test";

const [mode, targetUrl, statePath] = process.argv.slice(2);
const LOGIN_PATH = /\/(login|signin|sign-in|iniciar-sesion|auth|sso|acceso|account\/login|users\/sign_in)(\/|\?|#|$)/i;
const SSO_HOST = /(login\.microsoftonline\.com|login\.live\.com|accounts\.google\.com|\.okta\.com|\.auth0\.com|adfs\.)/i;
const SSO_BUTTON = /(cuenta corporativa|microsoft|google|single sign|sso|office 365|azure ad|entra)/i;
const SUBMIT_BUTTON = /^(ingresar|iniciar sesi[oó]n|entrar|acceder|login|log in|sign in|continuar|ingresar al portal)/i;
const LOGIN_LINK = /^\s*(iniciar sesi[oó]n|inicia sesi[oó]n|ingresar|acceder|entrar|login|log in|sign in|mi cuenta)\s*$/i;

// Plataformas cuya aplicación interna vive en rutas conocidas aunque la portada sea pública.
const PLATFORMS = [
  {
    name: "Odoo",
    detect: page => page.evaluate(() => Boolean(
      document.querySelector('meta[name="generator"][content*="Odoo" i]')
      || document.querySelector('script[src*="/web/assets/"], link[href*="/web/assets/"]')
      || document.documentElement.outerHTML.includes("odoo.__session_info__")
    )).catch(() => false),
    appPaths: ["/odoo", "/web"]
  }
];

const print = result => process.stdout.write(`${JSON.stringify(result)}\n`);

async function passwordVisible(page) {
  return page.locator('input[type="password"]:visible').count().then(count => count > 0).catch(() => false);
}

function onLoginPage(page, appHost) {
  const current = new URL(page.url());
  return SSO_HOST.test(current.host) || LOGIN_PATH.test(current.pathname) || current.host !== appHost;
}

async function open(page, url) {
  // 30 s: los ambientes de pruebas (p. ej. instancias dev de Odoo) pueden estar dormidos y tardan en despertar.
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
  // Las SPA redirigen al login después de cargar: se da un margen corto.
  await page.waitForURL(current => LOGIN_PATH.test(current.pathname) || SSO_HOST.test(current.host), { timeout: 3_000 }).catch(() => {});
}

async function loginShown(page) {
  const current = new URL(page.url());
  return (await passwordVisible(page)) || SSO_HOST.test(current.host) || LOGIN_PATH.test(current.pathname);
}

// Busca dónde está el login de la aplicación. Devuelve null si no hay ninguno.
//   protectedUrl: página interna que redirige al login (para comprobar después que la sesión funciona).
//   loginUrl:     página con el formulario o el botón de SSO.
async function findLoginEntry(page) {
  await open(page, targetUrl);
  if (await loginShown(page)) {
    return { source: "target", loginUrl: page.url(), protectedUrl: LOGIN_PATH.test(new URL(targetUrl).pathname) ? null : targetUrl, evidence: `La URL de pruebas muestra la pantalla de login (${page.url()}).` };
  }

  const origin = new URL(targetUrl).origin;
  const candidates = [];
  for (const platform of PLATFORMS) {
    if (await platform.detect(page)) {
      candidates.push(...platform.appPaths.map(appPath => ({ url: `${origin}${appPath}`, evidence: `Sitio ${platform.name}: su aplicación interna (${appPath}) exige iniciar sesión.` })));
    }
  }
  const links = await page.locator("a[href]").evaluateAll((anchors, pattern) => {
    const regex = new RegExp(pattern, "i");
    return anchors.filter(anchor => regex.test(anchor.textContent || "")).map(anchor => anchor.href).slice(0, 3);
  }, LOGIN_LINK.source).catch(() => []);
  candidates.push(...links.filter(href => href.startsWith(origin)).map(href => ({ url: href, link: true, evidence: `La página enlaza a un inicio de sesión (${href}).` })));

  for (const candidate of candidates.slice(0, 5)) {
    try {
      await open(page, candidate.url);
      if (await loginShown(page)) {
        return { source: candidate.link ? "link" : "platform", loginUrl: page.url(), protectedUrl: candidate.link ? null : candidate.url, evidence: candidate.evidence };
      }
    } catch {}
  }
  return null;
}

async function detect(page) {
  const entry = await findLoginEntry(page);
  if (!entry) return { requiresLogin: false, loginType: "none", finalUrl: page.url(), ssoAvailable: false };
  // El formulario puede pintarse después de la redirección al login.
  await page.locator('input[type="password"]').first().waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});
  const hasPassword = await passwordVisible(page);
  const ssoButton = await page.getByRole("button", { name: SSO_BUTTON }).or(page.getByRole("link", { name: SSO_BUTTON })).count().catch(() => 0);
  const onSso = SSO_HOST.test(new URL(page.url()).host);
  return {
    // Un simple enlace de "Iniciar sesión" en un sitio público no obliga a tener credenciales (lo decide
    // el plan según la historia); la URL que muestra el login o la zona interna de la plataforma, sí.
    requiresLogin: entry.source !== "link",
    loginAvailable: true,
    loginType: hasPassword ? "form" : "sso",
    loginUrl: entry.loginUrl,
    protectedUrl: entry.protectedUrl,
    evidence: entry.evidence,
    finalUrl: page.url(),
    ssoAvailable: onSso || ssoButton > 0
  };
}

async function fillForm(page) {
  const username = process.env.QA_LOGIN_USERNAME || "";
  const password = process.env.QA_LOGIN_PASSWORD || "";
  if (!username || !password) return { ok: false, reason: "Faltan usuario o contraseña." };
  const entry = await findLoginEntry(page);
  if (!entry) return { ok: false, reason: "No se encontró la pantalla de login de la aplicación desde la URL de pruebas." };
  const passwordField = page.locator('input[type="password"]:visible').first();
  await passwordField.waitFor({ timeout: 8_000 }).catch(() => {});
  if (!(await passwordField.count())) return { ok: false, reason: "La aplicación usa inicio de sesión corporativo (SSO): usa \"Iniciar sesión en el navegador\"." };
  const appHost = new URL(page.url()).host;
  const loginUrl = page.url();

  // Campo de usuario: el más específico disponible antes del de contraseña.
  const userField = page.locator([
    'input[autocomplete="username"]:visible',
    'input[type="email"]:visible',
    'input[name*="user" i]:visible', 'input[name*="email" i]:visible', 'input[name*="correo" i]:visible', 'input[name*="login" i]:visible',
    'input[id*="user" i]:visible', 'input[id*="email" i]:visible', 'input[id*="login" i]:visible',
    'input[type="text"]:visible'
  ].join(", ")).first();
  if (!(await userField.count())) return { ok: false, reason: "No se encontró el campo de usuario o correo." };
  await userField.fill(username);
  await passwordField.fill(password);

  const submit = page.getByRole("button", { name: SUBMIT_BUTTON }).or(page.locator('button[type="submit"], input[type="submit"]')).first();
  if (await submit.count()) await submit.click({ timeout: 5_000 }).catch(() => passwordField.press("Enter"));
  else await passwordField.press("Enter");

  // Éxito: se sale de la pantalla de login (cambia la URL o desaparece el campo de contraseña).
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(500);
    const left = page.url() !== loginUrl && !LOGIN_PATH.test(new URL(page.url()).pathname);
    if (left || !(await passwordVisible(page))) {
      await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
      if (!(await passwordVisible(page)) && new URL(page.url()).host === appHost) {
        // Se confirma en un contexto limpio que la sesión abre la zona privada.
        const checkUrl = entry.protectedUrl || page.url();
        const check = await sessionWorks(await page.context().storageState(), checkUrl);
        if (!check.works) return { ok: false, reason: `El login pareció completarse, pero al abrir ${checkUrl} con la sesión la aplicación volvió al login.` };
        return { ok: true, finalUrl: page.url(), loginUrl, appUrl: checkUrl };
      }
    }
  }
  const message = await page.locator('[role="alert"]:visible, .error:visible, .alert:visible, .alert-danger:visible, .invalid-feedback:visible, .text-danger:visible').first().textContent({ timeout: 1_000 }).catch(() => "");
  const cleanMessage = (message || "").replace(/[×✕✖]/g, "").replace(/\s+/g, " ").trim();
  return { ok: false, reason: cleanMessage ? `La aplicación rechazó el login: ${cleanMessage.slice(0, 200)}` : "El login no avanzó: revisa usuario y contraseña, o usa el inicio de sesión en el navegador si pide SSO/MFA." };
}

// Página de la aplicación tras el login: el parámetro callbackUrl/returnUrl de la URL de login, o la raíz del sitio.
function appUrlAfterLogin(fromUrl = targetUrl) {
  const url = new URL(fromUrl);
  for (const name of ["callbackUrl", "returnUrl", "returnTo", "redirect", "redirect_uri", "next"]) {
    const value = url.searchParams.get(name);
    if (value) {
      try {
        const candidate = new URL(value, url.origin);
        if (candidate.host === url.host) return candidate.href;
      } catch {}
    }
  }
  return LOGIN_PATH.test(url.pathname) ? `${url.origin}/` : url.href;
}

// Comprueba en un contexto limpio que la sesión guardada abre la aplicación sin volver al login.
async function sessionWorks(state, checkUrl) {
  const checkContext = await browser.newContext({ storageState: state });
  try {
    const checkPage = await checkContext.newPage();
    await open(checkPage, checkUrl);
    return { works: !onLoginPage(checkPage, new URL(checkUrl).host) && !(await passwordVisible(checkPage)), url: checkPage.url() };
  } finally {
    await checkContext.close();
  }
}

async function interactive(page, context) {
  // Se abre directamente la pantalla de login de la aplicación (aunque la URL de pruebas sea pública).
  const entry = await findLoginEntry(page).catch(() => null);
  const startUrl = entry?.protectedUrl || entry?.loginUrl || targetUrl;
  if (page.url() !== startUrl) await page.goto(startUrl, { waitUntil: "domcontentloaded", timeout: 20_000 });
  const appHost = new URL(targetUrl).host;
  const checkUrl = entry?.protectedUrl || appUrlAfterLogin(entry?.loginUrl || targetUrl);
  const deadline = Date.now() + 10 * 60_000;
  let closed = false;
  let manualSave = false;
  context.on("close", () => { closed = true; });
  page.on("close", () => { closed = true; });
  // El runner escribe "save" por stdin cuando el usuario pulsa "Ya inicié sesión" en qa-runner.html.
  process.stdin.on("data", chunk => { if (/save/.test(chunk.toString())) manualSave = true; });
  process.stdin.on("error", () => {});
  // Espera a que el usuario termine el login y vuelva a la aplicación, o a que confirme manualmente.
  let finished = false;
  while (!closed && !manualSave && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 1_000));
    if (closed || manualSave) break;
    try {
      const current = context.pages().find(item => !item.isClosed() && !onLoginPage(item, appHost)) || page;
      if (!onLoginPage(current, appHost) && !(await passwordVisible(current))) {
        await current.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
        await new Promise(resolve => setTimeout(resolve, 1_500));
        if (!onLoginPage(current, appHost) && (await sessionWorks(await context.storageState(), checkUrl)).works) { finished = true; break; }
      }
    } catch {}
  }
  if (closed && !manualSave) return { ok: false, reason: "Se cerró el navegador antes de guardar la sesión." };
  if (!finished && !manualSave) return { ok: false, reason: "No se completó el login en 10 minutos." };

  const state = await context.storageState();
  const check = await sessionWorks(state, checkUrl);
  if (!check.works) {
    return { ok: false, reason: `La sesión no quedó iniciada: al abrir ${checkUrl} la aplicación volvió al login (${check.url}). Inicia sesión en la ventana que abrió el runner, no en tu navegador habitual, y vuelve a intentarlo.` };
  }
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
  return { ok: true, finalUrl: check.url, appUrl: checkUrl, manual: manualSave, saved: true };
}

// La sesión guardada sigue activa si abre la zona privada sin volver al login.
async function checkSession(page) {
  const entry = await findLoginEntry(page).catch(() => null);
  const checkUrl = entry?.protectedUrl || appUrlAfterLogin(entry?.loginUrl || targetUrl);
  const result = await sessionWorks(statePath, checkUrl);
  return result.works
    ? { ok: true, appUrl: checkUrl }
    : { ok: false, reason: `La sesión guardada caducó: al abrir ${checkUrl} la aplicación pide iniciar sesión otra vez.` };
}

if (!["detect", "form", "interactive", "check"].includes(mode) || !/^https?:\/\//i.test(targetUrl || "") || (mode !== "detect" && !statePath)) {
  print({ ok: false, reason: "Uso: login-probe.mjs detect|form|interactive|check <url> [storageState]" });
  process.exit(2);
}

const browser = await chromium.launch({ headless: mode !== "interactive" });
try {
  const context = await browser.newContext();
  const page = await context.newPage();
  const result = mode === "detect" ? await detect(page)
    : mode === "form" ? await fillForm(page)
    : mode === "check" ? await checkSession(page)
    : await interactive(page, context);
  if (mode === "form" && result.ok) await context.storageState({ path: statePath });
  print(result);
  process.stdin.destroy();
} catch (error) {
  print({ ok: false, requiresLogin: null, reason: error.message.split("\n")[0] });
} finally {
  await browser.close().catch(() => {});
}
