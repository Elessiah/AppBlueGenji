import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const source = (relative: string) => readFileSync(join(ROOT, relative), "utf8");

/**
 * **Les boutons de connexion sont des `<a>`, jamais des `next/link`.**
 *
 * Une route de départ OAuth n'est pas une page de l'application, et la
 * différence n'est pas cosmétique : `Link` fait une transition **côté client**,
 * si bien que la redirection de retour vers `/connexion?error=…` change l'URL
 * **sans remonter la page**. L'effet qui lit `window.location.search` ne se
 * rejoue alors pas, et *aucun* refus n'est annoncé — ni la configuration
 * manquante, ni l'état expiré, ni l'échange raté. Le joueur clique, revient sur
 * la même page, et rien ne lui est dit.
 *
 * La panne est muette par nature : la page se rend, le lien est valide, le
 * serveur fait son travail. Seul un clic réel la montre, et aucun test de rendu
 * ne la verrait. D'où ce garde-fou, qui lit la source — le même procédé que
 * `tests/lib/shared/safe-redirect.test.ts` pour les trois portes du filtrage.
 */
describe("boutons OAuth de la page de connexion", () => {
  const buttons = source(join("app", "connexion", "_components", "OAuthButtons.tsx"));

  it("n'importe pas `next/link`", () => {
    expect(buttons).not.toMatch(/from "next\/link"/);
  });

  it("pose des ancres ordinaires vers la route de départ", () => {
    expect(buttons).toMatch(/<a\s+href=\{oauthStartPath\(provider, \{ redirect \}\)\}/);
  });

  it("garde la page de connexion capable d'annoncer le refus qu'elle reçoit", () => {
    // L'autre moitié du même mécanisme : la navigation complète ne sert à rien
    // si la page ne lit plus l'URL au montage.
    const page = source(join("app", "connexion", "page.tsx"));
    expect(page).toMatch(/oauthErrorMessage\(params\.get\("error"\), params\.get\("provider"\)\)/);
  });
});
