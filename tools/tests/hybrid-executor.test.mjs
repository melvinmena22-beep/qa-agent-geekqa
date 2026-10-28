// Pruebas del spec dividido en partes (generación por lotes en paralelo). Ejecutar con: npm test
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { findMissingScenarios, partSpecPath, specFiles } from "../hybrid-executor.mjs";

async function workspaceWith(files) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-parts-"));
  const tests = path.join(root, "3-outputs", "run", "US-7", "tests");
  await fs.mkdir(tests, { recursive: true });
  for (const [name, content] of Object.entries(files)) await fs.writeFile(path.join(tests, name), content, "utf8");
  return root;
}

test("las partes del spec se listan en orden e ignoran versiones anteriores y otras historias", async () => {
  const root = await workspaceWith({
    "US-7.p3.spec.ts": "", "US-7.spec.ts": "", "US-7.p2.spec.ts": "",
    "US-7.previous.ts": "", "US-7.p2.previous.ts": "", "US-70.spec.ts": ""
  });
  assert.deepEqual((await specFiles(root, "7")).map(item => [item.part, path.basename(item.file)]),
    [[1, "US-7.spec.ts"], [2, "US-7.p2.spec.ts"], [3, "US-7.p3.spec.ts"]]);
  assert.equal(path.basename(partSpecPath(root, "7", 1)), "US-7.spec.ts");
  assert.equal(path.basename(partSpecPath(root, "7", 4)), "US-7.p4.spec.ts");
});

test("un escenario cuenta como generado si está en cualquier parte del spec", async () => {
  const root = await workspaceWith({
    "US-7.spec.ts": "test('SC_001: Uno', async () => {});",
    "US-7.p2.spec.ts": "test('SC_003: Tres', async () => {});",
    "US-7.previous.ts": "test('SC_002: Dos', async () => {});"
  });
  assert.deepEqual(await findMissingScenarios(root, "7", ["SC_001", "SC_002", "SC_003"]), ["SC_002"]);
});

test("sin carpeta de tests, todos los escenarios faltan", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "qa-parts-"));
  assert.deepEqual(await findMissingScenarios(root, "7", ["SC_001"]), ["SC_001"]);
});
