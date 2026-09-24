import { describe, expect, it } from "@jest/globals";
import { readSource } from "../helpers/read-source";

/**
 * Ordre des titres de `/connexion` et repères de `/association`
 * (ACCESSIBILITE.md, tâche 8 — RGAA 9.1 / 12.6).
 *
 * Contrôle au niveau de la source : `LoginForm` dépend du routeur et de la
 * session, et la page de l'association lit la base ; ni l'une ni l'autre ne se
 * rend sans eux.
 */
describe("/connexion — ordre des titres", () => {
  const source = readSource("app/connexion/_components/LoginForm.tsx");

  it("rend la modale de consentement après le h1 de la page", () => {
    const heading = source.indexOf("<h1");
    const modal = source.indexOf("<RgpdConsentModal");
    expect(heading).toBeGreaterThan(-1);
    expect(modal).toBeGreaterThan(heading);
  });

  it("ne rend la modale qu'une fois", () => {
    expect(source.match(/<RgpdConsentModal/g)).toHaveLength(1);
  });

  it("garde un h2 dans la modale : le titre de la page reste le seul h1", () => {
    const modal = readSource("components/cyber/RgpdConsentModal.tsx");
    expect(modal).toContain("<h2");
    expect(modal).not.toContain("<h1");
  });
});

describe("/association — repères", () => {
  it("n'imbrique aucun repère complémentaire dans le contenu principal", () => {
    // Les deux blocs de faits font partie de leur section : ce ne sont pas des
    // contenus complémentaires, et un `<aside>` dans `<main>` n'est pas au
    // premier niveau.
    expect(readSource("app/association/page.tsx")).not.toMatch(/<aside[\s>]/);
  });
});
