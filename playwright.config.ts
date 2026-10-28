import { defineConfig } from '@playwright/test';

// Los specs se ejecutan en serie dentro de su archivo salvo que declaren
// test.describe.configure({ mode: 'parallel' }); los navegadores corren en paralelo.
export default defineConfig({
  testDir: './3-outputs/run',
  testMatch: '**/tests/*.spec.ts',
  respectGitIgnore: false,
  fullyParallel: false,
  workers: Number(process.env.QA_WORKERS || 4),
  // Un reintento por fallo: si el caso pasa al reintentar, el reporte lo marca como intermitente (FLAKY)
  // en vez de reportarlo como bug. QA_RETRIES=0 lo desactiva.
  retries: Number(process.env.QA_RETRIES ?? 1),
  // Margen sobre el objetivo de 12 s por test, para que una respuesta lenta del ambiente no se cuente como fallo.
  timeout: 15_000,
  globalTimeout: 105_000,
  expect: { timeout: 2_500 },
  reporter: 'line',
  outputDir: './test-results/generated-playwright',
  use: {
    // Sesión de login de la historia (la define el runner); un spec puede sobrescribirla con test.use.
    storageState: process.env.QA_STORAGE_STATE || undefined,
    actionTimeout: 3_000,
    navigationTimeout: 10_000,
    screenshot: 'on',
    // Evidencias para los bugs: trace y video se conservan solo de los intentos que fallan
    // (se adjuntan al bug de Azure DevOps junto con la captura).
    trace: 'retain-on-failure',
    video: 'retain-on-failure'
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    { name: 'firefox', use: { browserName: 'firefox' } },
    { name: 'webkit', use: { browserName: 'webkit' } }
  ]
});
