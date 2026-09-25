import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * `MatchRow` et `page.tsx` ne peuvent pas se monter dans ce harnais (Jest
 * tourne en environnement `node`, sans DOM) : ce que décide `myTeamId` — quel
 * champ vient en premier, quand afficher « Signaler un problème » — se teste
 * dans le module pur (`tests/lib/shared/match-card-viewer.test.ts`).
 *
 * Restent les branchements : que les deux fichiers appellent bien ce module
 * pur plutôt que de recopier la comparaison d'identifiants chacun de leur
 * côté, ce qui les ferait diverger sans qu'aucun test ne s'en aperçoive.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const TOURNAMENT_DIR = join("app", "(secured)", "tournois", "[id]");
const MATCH_ROW = read(join(TOURNAMENT_DIR, "_components", "MatchRow.tsx"));
const BRACKET_TREE = read(join(TOURNAMENT_DIR, "_components", "BracketTree.tsx"));
const PAGE = read(join(TOURNAMENT_DIR, "page.tsx"));
const ISSUE_REPORT_CONTEXT = read(join(TOURNAMENT_DIR, "_lib", "issue-report-context.tsx"));

describe("bouton « Signaler un problème » — réservé au match du lecteur", () => {
  it("MatchRow calcule la visibilité avec le module pur, pas une comparaison recopiée", () => {
    expect(MATCH_ROW).toContain('from "@/lib/shared/match-card-viewer"');
    expect(MATCH_ROW).toContain("canReportOwnMatch(canReport, myTeamId, match.team1Id, match.team2Id)");
  });

  it("le contexte de signalement porte l'identifiant de l'équipe du lecteur", () => {
    // Sans cette valeur, `canReportOwnMatch` ne pourrait distinguer « le
    // lecteur est engagé dans le tournoi » de « ce match est le sien ».
    expect(ISSUE_REPORT_CONTEXT).toContain("myTeamId: number | null");
  });

  it("la page fournit myTeamId au contexte", () => {
    expect(PAGE).toMatch(/<IssueReportProvider[\s\S]{0,120}myTeamId=\{detail\.myTeamId\}/);
  });
});

describe("formulaire de score — champs ordonnés comme la carte", () => {
  it("MatchRow ordonne ses deux champs avec le module pur", () => {
    expect(MATCH_ROW).toContain(
      "orderedScoreFields(myTeamIsTeam1, myScore, opponentScore, team1Display, team2Display)",
    );
  });

  it("chaque champ porte le nom de son équipe, pas « Moi »/« Eux »", () => {
    expect(MATCH_ROW).not.toContain('placeholder="Moi"');
    expect(MATCH_ROW).not.toContain('placeholder="Eux"');
    expect(MATCH_ROW).toContain("placeholder={field.label}");
    expect(MATCH_ROW).toContain("aria-label={`Score de ${field.label}`}");
  });

  it("le bouton d'envoi porte un nom accessible", () => {
    // Avant : un « ✓ » nu, sans nom pour un lecteur d'écran.
    expect(MATCH_ROW).not.toMatch(/<button className="btn" type="submit"[^>]*>\s*✓/);
    expect(MATCH_ROW).toContain("Envoyer le score");
  });
});

describe("notification d'envoi — nomme les équipes, pas l'identifiant du match", () => {
  it("page.tsx construit le message avec le module pur", () => {
    expect(PAGE).toContain('from "@/lib/shared/match-card-viewer"');
    expect(PAGE).toContain("scoreSubmittedMessage(");
    // Le repli exact que dénonçait ERREUR.txt.
    expect(PAGE).not.toMatch(/Score transmis pour le match #\$\{match\.id\}/);
  });
});

describe("libellé d'un tour profond du tableau — français, comme l'accueil", () => {
  it("BracketTree replie sur « Manche N », pas « Round N »", () => {
    expect(BRACKET_TREE).toContain("`Manche ${globalIdx + 1}`");
    expect(BRACKET_TREE).not.toMatch(/`Round \$\{/);
  });
});
