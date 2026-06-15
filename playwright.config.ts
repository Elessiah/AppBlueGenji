import { defineConfig, devices } from "@playwright/test";

/**
 * Configuration Playwright pour les tests E2E navigateur de BlueGenji Arena.
 *
 * Le serveur dev Next.js est démarré automatiquement sur un port dédié (3100 par
 * défaut, surchargeable via `E2E_PORT`) afin de NE PAS réutiliser un éventuel
 * `npm run dev` déjà lancé avec le `.env` du développeur. Cibler une instance
 * externe via `E2E_BASE_URL`. Voir `e2e/README.md` pour les prérequis.
 *
 * Déterminisme du bypass d'auth : `DEV_AUTH_USER_ID` est imposé explicitement au
 * serveur de test (et a priorité sur le `.env`, que Next.js n'écrase pas) :
 *  - non authentifié (défaut)        → `""`  → bypass désactivé, les routes
 *    `(secured)` redirigent vers /connexion (cf. `auth.spec.ts`) ;
 *  - authentifié (`E2E_AUTH_USER`)   → cet id → bypass actif (cf. `tournaments.spec.ts`).
 */
const PORT = process.env.E2E_PORT || "3100";
const baseURL = process.env.E2E_BASE_URL || `http://localhost:${PORT}`;

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

  // Démarre le serveur de test seulement si on ne cible pas une URL externe déjà servie.
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: `npm run dev -- --port ${PORT}`,
        url: `http://localhost:${PORT}`,
        // Toujours un serveur neuf : évite de réutiliser un dev server lancé
        // avec un bypass d'auth (DEV_AUTH_USER_ID) qui fausserait les assertions.
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
          DEV_AUTH_USER_ID: process.env.E2E_AUTH_USER ?? "",
        },
      },
});
