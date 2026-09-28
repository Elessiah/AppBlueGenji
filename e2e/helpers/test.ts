import { test as base, expect, type Page } from "@playwright/test";

/**
 * `test` et `expect` de la suite E2E : ceux de Playwright, plus un garde contre
 * les fenêtres que le site ouvre de lui-même sur n'importe quelle page.
 *
 * Trois fenêtres sont rendues par `app/layout.tsx` sans qu'aucun geste du test
 * ne les demande, et leur voile intercepte tout clic sur la page :
 *
 * - l'**annonce de recrutement prioritaire** (`components/recruitment-highlight.tsx`),
 *   dès que la base porte une annonce « Prioritaire » — c'est le cas d'une base
 *   seedée, jamais de la CI, qui n'a pas de base ;
 * - les **conditions d'utilisation** (`components/legal/TermsAcceptanceModal.tsx`),
 *   pour un compte qui gère une équipe sans les avoir acceptées — le compte
 *   `E2E_AUTH_USER` d'un parcours authentifié, typiquement ;
 * - les **changements du traitement des données**
 *   (`components/privacy/PrivacyChangesModal.tsx`), pour un compte créé avant
 *   la dernière entrée de `PRIVACY_CHANGES` — un compte de développement
 *   ancien, pris comme `E2E_AUTH_USER`.
 *
 * Aucune n'est l'objet d'un test : elles les faisaient échouer au premier
 * clic, sur un `intercepts pointer events` qui ne nomme pas la cause. Les deux
 * premières se referment par « Plus tard », qui n'enregistre rien (ni
 * acceptation, ni annonce lue au-delà du cookie du navigateur de test). La
 * troisième n'a pas de « plus tard » — elle ne se ferme qu'en acceptant ou en
 * supprimant le compte — : on l'**accepte**, seule écriture de ce garde, faite
 * au nom du compte de test (`bg_privacy_acknowledgments`, une fois par
 * compte et par changement).
 *
 * Tout spec importe `test` et `expect` d'ici, jamais de `@playwright/test` :
 * un parcours qui l'oublierait retrouverait la panne sur une base seedée
 * seulement, donc invisible en CI.
 */
export async function dismissSiteOverlays(page: Page): Promise<void> {
  const later = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "Plus tard", exact: true }) });

  // Playwright éprouve le déclencheur en mode strict : il est donc posé sur la
  // première fenêtre, et le traitement referme toutes les autres.
  await page.addLocatorHandler(
    later.first(),
    async () => {
      // Les deux fenêtres peuvent être ouvertes ensemble (l'annonce ne se tait
      // pas devant les conditions) : on les referme toutes, sans présumer
      // laquelle est au-dessus — un clic sur celle du dessous est intercepté,
      // il échoue court et le tour suivant le rejoue. La fenêtre est aussi
      // dans le HTML initial : un clic reçu avant l'hydratation ne fait rien,
      // d'où la répétition jusqu'à fermeture.
      await expect(async () => {
        const buttons = await later.getByRole("button", { name: "Plus tard", exact: true }).all();
        for (const button of buttons) {
          await button.click({ timeout: 1_000 }).catch(() => undefined);
        }
        await expect(later).toHaveCount(0, { timeout: 1_000 });
      }).toPass({ timeout: 20_000 });
    },
    { noWaitAfter: true },
  );

  const privacyChanges = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("button", { name: "Je refuse, je supprime mon compte" }) });

  await page.addLocatorHandler(
    privacyChanges.first(),
    async () => {
      await expect(async () => {
        // Un clic reçu pose « Enregistrement… » à la place du libellé, le
        // temps de la requête (longue en développement, la route se compile) :
        // on ne reclique que si le bouton dit encore « J'accepte ».
        const accept = privacyChanges.getByRole("button", { name: "J'accepte", exact: true });
        if (await accept.isVisible()) await accept.click({ timeout: 2_000 });
        await expect(privacyChanges).toHaveCount(0, { timeout: 5_000 });
      }).toPass({ timeout: 20_000 });
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
