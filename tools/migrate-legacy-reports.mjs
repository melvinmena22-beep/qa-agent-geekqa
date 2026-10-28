#!/usr/bin/env node
// Convierte los execution-report.json con formatos antiguos (suites/specs o detailedResults) al
// esquema único schemas/execution-report.schema.json y normaliza los IDs de los planes a SC_NNN.
// Conserva el original como execution-report.legacy.json. Uso: node tools/migrate-legacy-reports.mjs

import fs from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { normalizePlanScenarioIds, validateExecutionReport } from "./qa-guards.mjs";

const workspaceRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const runRoot = path.join(workspaceRoot, "3-outputs", "run");

const readJson = async file => JSON.parse(await fs.readFile(file, "utf8"));
const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");

function legacyResults(report) {
  if (Array.isArray(report.suites)) {
    return report.suites.flatMap(suite => suite.specs || []).map(spec => ({
      id: spec.id,
      status: spec.status,
      reason: spec.blockedReason,
      error: spec.description,
      screenshot: spec.screenshots?.[0]?.path || null,
      browser: spec.screenshots?.[0]?.browser
    }));
  }
  if (Array.isArray(report.detailedResults)) {
    return report.detailedResults.map(item => ({ id: item.id, status: item.status, reason: null, error: item.errorDetails, screenshot: null, bugId: item.bugId }));
  }
  return null;
}

export async function migrateStory(storyDirName) {
  const directory = path.join(runRoot, storyDirName);
  const planPath = path.join(directory, "planning", `${storyDirName}-plan.json`);
  const reportPath = path.join(directory, "execution", "execution-report.json");
  const changes = [];

  let plan = null;
  if (existsSync(planPath)) {
    plan = await readJson(planPath);
    if (normalizePlanScenarioIds(plan)) {
      await writeJson(planPath, plan);
      changes.push("plan: IDs normalizados a SC_NNN");
    }
  }
  if (!existsSync(reportPath)) return changes;

  const report = await readJson(reportPath);
  const results = legacyResults(report);
  if (!results) return changes;

  const byLegacyId = new Map((plan?.testScenarios || []).map(scenario => [scenario.legacyId || scenario.id, scenario]));
  const byId = new Map((plan?.testScenarios || []).map(scenario => [scenario.id, scenario]));
  const normalizeStatus = status => (/^PASS/i.test(status) ? "PASS" : /^FAIL/i.test(status) ? "FAIL" : "BLOCKED");
  const scenarios = results.map(result => {
    const scenario = byId.get(result.id) || byLegacyId.get(result.id) || {};
    const status = normalizeStatus(result.status);
    const reasonCode = String(result.reason || "").toUpperCase().replace(/[^A-Z_]/g, "_");
    return {
      id: scenario.id || result.id,
      title: scenario.title || result.id,
      browser: ["chromium", "firefox", "webkit"].includes(result.browser) ? result.browser : "chromium",
      testPolarity: scenario.testPolarity || null,
      requirementRefs: scenario.requirementRefs || [],
      technique: scenario.technique || null,
      status,
      reason: status === "BLOCKED" ? `BLOCKED/${reasonCode || "LEGACY"}` : null,
      failureType: status === "FAIL" ? "ASSERTION" : null,
      flaky: false,
      durationMs: null,
      error: result.error || null,
      screenshot: result.screenshot,
      bugId: result.bugId && result.bugId !== "N/A" ? result.bugId : null
    };
  });
  const count = status => scenarios.filter(item => item.status === status).length;
  const migrated = {
    storyId: storyDirName,
    projectName: plan?.projectName || storyDirName,
    url: plan?.url || null,
    executedAt: (await fs.stat(reportPath)).mtime.toISOString(),
    skill: "run-tests-browser",
    engine: "Formato anterior migrado con tools/migrate-legacy-reports.mjs",
    executionMode: "legacy",
    selectedTestTypes: ["functional"],
    selectedBrowsers: [...new Set(scenarios.map(item => item.browser))],
    selectedScenarioIds: [...new Set(scenarios.map(item => item.id))],
    durationMs: null,
    playwrightExitCode: null,
    playwrightErrors: [],
    summary: {
      total: scenarios.length,
      passed: count("PASS"),
      failed: count("FAIL"),
      blocked: count("BLOCKED"),
      flaky: 0,
      successRate: scenarios.length ? Math.round((count("PASS") / scenarios.length) * 100) : 0
    },
    scenarios,
    findings: [],
    triage: count("FAIL") ? "pending" : "not_required"
  };
  const errors = await validateExecutionReport(workspaceRoot, migrated);
  if (errors.length) throw new Error(`${storyDirName}: la migración no cumple el esquema: ${errors.join("; ")}`);
  await fs.rename(reportPath, reportPath.replace(/\.json$/, ".legacy.json"));
  await writeJson(reportPath, migrated);
  changes.push(`execution-report.json migrado (${scenarios.length} resultados; original en execution-report.legacy.json)`);
  return changes;
}

const isMainModule = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (isMainModule) {
  const stories = (await fs.readdir(runRoot, { withFileTypes: true })).filter(entry => entry.isDirectory() && /^US-\d+$/.test(entry.name));
  for (const story of stories) {
    const changes = await migrateStory(story.name);
    console.log(`${story.name}: ${changes.length ? changes.join("; ") : "sin cambios"}`);
  }
}
