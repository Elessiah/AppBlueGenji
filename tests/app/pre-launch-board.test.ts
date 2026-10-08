import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const PAGE = "app/(secured)/tournois/[id]/_components/TournamentSheet.tsx";
const PANEL = "app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx";

/** Retire commentaires de bloc et de ligne : ils citent le code en prose. */
function stripComments(code: string): string {
  return code
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
}

/**
 * Avant-course d'un tournoi — le câblage de la page.
 *
 * Les formats à classement (Survie, Ronde suisse, BG Survie) chargent leurs
 * métadonnées dès la création, vides. Une page qui ne réservait la branche
 * « avant le lancement » qu'à l'état `REGISTRATION` faisait donc tomber un
 * tournoi aux inscriptions closes (`UPCOMING`) dans la vue de son format :
 * aucun match, et plus d'aperçu du premier tour — au moment précis où le staff
 * relit le tirage. Panne muette, que seule la structure de la page montre.
 */
describe("page d'un tournoi — avant le coup d'envoi", () => {
  const page = stripComments(read(PAGE));

  it("aiguille tout l'avant-course, clôture comprise, vers l'aperçu", () => {
    expect(page).toContain("if (isPreLaunchState(detail.card.state)) {");
    expect(page).not.toMatch(/detail\.card\.state === "REGISTRATION" \? \(/);
  });

  it("teste l'avant-course avant les vues des formats à classement", () => {
    const branch = page.indexOf("if (isPreLaunchState(detail.card.state)) {");
    for (const view of ["<SurvivalView", "<EnduranceView", "<SwissView"]) {
      expect(page.indexOf(view)).toBeGreaterThan(branch);
    }
  });

  it("ne rend l'aperçu qu'à un seul endroit", () => {
    expect(page.match(/\{previewBlock\}/g)).toHaveLength(1);
  });

  it("ne dit plus que la BG Survie part de l'ordre des inscriptions quand le site seede", () => {
    expect(page).not.toContain("Le classement de départ est celui du seeding ci-dessous");
  });
});

describe("liste des inscrites — classement du site", () => {
  const panel = stripComments(read(PANEL));

  it("reprend la règle partagée plutôt qu'une condition recopiée", () => {
    expect(panel).toContain("registrationsFollowRanking(source, detail.card.state)");
  });

  it("montre, une fois lancé, les rangs figés et non l'ordre d'arrivée", () => {
    expect(panel).toContain("registrationsFollowFrozenDraw(source, detail.card.state)");
    expect(panel).toContain("followsFrozenDraw ? frozenSeedLabel(reg.seed)");
    expect(panel).not.toContain("ne seront pas ceux du");
  });
});
