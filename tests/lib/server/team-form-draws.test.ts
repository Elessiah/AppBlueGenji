import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { playedMatchSql } from "@/lib/shared/ranking";

/**
 * La barre de forme des cartes de `/equipes` se construit en SQL, dans une
 * requête qui a besoin d'une base : elle se garde donc à la source, comme le
 * fait déjà `endurance-match-format-wiring.test.ts` pour le branchement d'une
 * vue.
 *
 * Ce que le garde-fou protège : `playedMatchSql` admet désormais les matchs
 * nuls, si bien qu'un `CASE WHEN winner_team_id = t.id THEN 'w' ELSE 'l'` les
 * rangeait en **défaites**. La carte d'annuaire affichait alors une case rouge
 * là où la fiche de la même équipe annonçait « N » — deux écrans se
 * contredisant sur la même rencontre, sans qu'aucune erreur ne le signale.
 */
const SERVICE = readFileSync(
  join(__dirname, "..", "..", "..", "lib", "server", "teams-service.ts"),
  "utf8",
);

describe("barre de forme de l'annuaire — matchs nuls", () => {
  it("range un match sans vainqueur en nul, avant de tester l'équipe", () => {
    // L'ordre compte : `winner_team_id = t.id` est faux sur un `NULL`, donc la
    // branche du nul doit passer en premier pour ne pas tomber dans le `ELSE`.
    const drawBranch = SERVICE.indexOf("WHEN m.winner_team_id IS NULL THEN 'd'");
    const winBranch = SERVICE.indexOf("WHEN m.winner_team_id = t.id THEN 'w'");

    expect(drawBranch).toBeGreaterThan(-1);
    expect(winBranch).toBeGreaterThan(-1);
    expect(drawBranch).toBeLessThan(winBranch);
  });

  it("déclare la lettre du nul dans le type de la ligne", () => {
    // Sans elle, la requête peut rendre `'d'` et le typage promettre autre chose.
    expect(SERVICE).toContain(`result: "w" | "l" | "d"`);
  });

  it("lit bien la même assiette que le classement", () => {
    // C'est ce qui rend le nul atteignable ici : `rankingMatchJoinSql` porte
    // `playedMatchSql`, qui l'admet.
    expect(SERVICE).toContain("rankingMatchJoinSql");
    expect(playedMatchSql()).toContain("m.team1_score = m.team2_score");
  });
});
