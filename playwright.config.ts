import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright pour les tests E2E navigateur de BlueGenji Arena.
 *
 * Le serveur dev Next.js est démarré automatiquement (`npm run dev`) sauf si
 * `E2E_BASE_URL` pointe déjà vers une instance lancée. Voir `e2e/README.md`
 * pour les prérequis (DB, DEV_AUTH_USER_ID, seed).
 */
const baseURL = process.env.E2E_BASE_URL || "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",

  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  // Démarre le serveur dev seulement si on ne cible pas une URL externe déjà servie.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "npm run dev",
        url: "http://localhost:3000",
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
      },
});
