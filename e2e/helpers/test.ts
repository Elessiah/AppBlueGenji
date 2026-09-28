import { test as base, expect, type Page } from "@playwright/test";

/**
 * `test` et `expect` de la suite E2E : ceux de Playwright, plus un garde contre
 * les fenêtres que le site ouvre de lui-même sur n'importe quelle page.
 *
 * Deux fenêtres sont rendues par `app/layout.tsx` sans qu'aucun geste du test
 * ne les demande, et leur voile intercepte tout clic sur la page :
 *
 * - l'**annonce de recrutement prioritaire** (`components/recruitment-highlight.tsx`),
 *   dès que la base porte une annonce « Prioritaire » — c'est le cas d'une base
 *   seedée, jamais de la CI, qui n'a pas de base ;
 * - les **conditions d'utilisation** (`components/legal/TermsAcceptanceModal.tsx`),
 *   pour un compte qui gère une équipe sans les avoir acceptées — le compte
 *   `E2E_AUTH_USER` d'un parcours authentifié, typiquement.
 *
 * Aucune des deux n'est l'objet d'un test : elles les faisaient échouer au
 * premier clic, sur un `intercepts pointer events` qui ne nomme pas la cause.
 * Chaque page les referme donc par « Plus tard » — le seul geste qu'elles
 * partagent, et qui n'enregistre rien : ni acceptation, ni annonce lue au-delà
 * du cookie du navigateur de test.
 *
 * Tout spec importe `test` et `expect` d'ici, jamais de `@playwright/test` :
 * un parcours qui l'oublierait retrouverait la panne sur une base seedée
 * seulement, donc invisible en CI.
 */
export async function dismissSiteOverlays(page: Page): Promise<void> {
  const overlay = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "Plus tard", exact: true }) });

  await page.addLocatorHandler(
    overlay,
    async (dialog) => {
      // La fenêtre est dans le HTML initial : un clic reçu avant l'hydratation
      // ne fait rien. On reclique donc jusqu'à ce qu'elle soit fermée.
      await expect(async () => {
        await dialog.getByRole("button", { name: "Plus tard", exact: true }).click({ timeout: 2_000 });
        await expect(dialog).toBeHidden({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
    },
    { noWaitAfter: true },
  );
}

export const test = base.extend<{ page: Page }>({
  page: async ({ page }, provide) => {
    await dismissSiteOverlays(page);
    await provide(page);
  },
});

export { expect };
export type { Page } from "@playwright/test";
