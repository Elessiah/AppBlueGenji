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
    expect(buttons).toMatch(/<a\s+href=\{oauthStartPath\(provider, \{ redirect, termsAccepted \}\)\}/);
  });

  it("garde la page de connexion capable d'annoncer le refus qu'elle reçoit", () => {
    // L'autre moitié du même mécanisme : la navigation complète ne sert à rien
    // si la page ne lit plus l'URL au montage.
    const page = source(join("app", "connexion", "_components", "LoginForm.tsx"));
    expect(page).toMatch(/oauthErrorMessage\(params\.get\("error"\), params\.get\("provider"\), environment\)/);
  });
});

/**
 * Les aides de la page de connexion sont des phrases : elles étaient en mono
 * 10 px `--ink-dim`, illisibles sur mobile. Toutes passent par le même style de
 * texte courant, et la sortie vers l'accueil est une cible de 44 px en tête de
 * carte plutôt qu'un sur-titre de 11 px sous le pli.
 */
describe("lisibilité de la page de connexion", () => {
  const form = source(join("app", "connexion", "_components", "LoginForm.tsx"));
  const buttons = source(join("app", "connexion", "_components", "OAuthButtons.tsx"));
  const styles = source(join("app", "connexion", "_lib", "login-styles.ts"));

  it("n'écrit plus aucune aide en 10 px", () => {
    expect(form).not.toMatch(/fontSize: 10, color/);
    expect(buttons).not.toMatch(/fontSize: 10/);
  });

  it("rend les aides en Inter 13 px, hors de la teinte la plus pâle", () => {
    expect(styles).toMatch(/fontFamily: "var\(--font-sans\)"/);
    expect(styles).toMatch(/fontSize: 13/);
    expect(styles).not.toMatch(/color: "var\(--ink-dim\)"/);
    // L'import, puis les trois aides du formulaire par code.
    expect(form.match(/LOGIN_HELP_TEXT_STYLE/g)).toHaveLength(4);
    expect(buttons).toMatch(/style=\{\{ \.\.\.LOGIN_HELP_TEXT_STYLE/);
  });

  it("offre un retour à l'accueil lisible, en tête de carte", () => {
    expect(form).not.toMatch(/RETOUR ACCUEIL/);
    const back = form.indexOf("← Retour à l&apos;accueil");
    expect(back).toBeGreaterThan(-1);
    expect(back).toBeLessThan(form.indexOf("BLUEGENJI · ACCÈS MEMBRE"));
    expect(form).toMatch(/minHeight: 44,\s*fontSize: 14/);
  });
});
