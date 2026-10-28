#!/usr/bin/env node
// Genera el PDF de un reporte servido por el runner y lo escribe en stdout.
// Se ejecuta en un proceso aparte para no cargar Playwright dentro del runner.
import process from "node:process";
import { chromium } from "@playwright/test";

const reportUrl = process.argv[2];
if (!reportUrl) {
  console.error("Uso: node tools/report-pdf.mjs <url-del-reporte>");
  process.exit(2);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.goto(reportUrl, { waitUntil: "load", timeout: 20_000 });
  const pdf = await page.pdf({ format: "A4", printBackground: true, margin: { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" } });
  process.stdout.write(pdf);
} finally {
  await browser.close();
}
