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
 * côté, ce qui les ferait diverger sans qu'aucun test ne s'en aperçoive — et
 * que `myTeamId` vienne du contexte qui le porte déjà (`LiveContext`), plutôt
 * que d'en garder une seconde copie sur le contexte de signalement.
 */
const ROOT = join(__dirname, "..", "..");
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

const TOURNAMENT_DIR = join("app", "(secured)", "tournois", "[id]");
const MATCH_ROW = read(join(TOURNAMENT_DIR, "_components", "MatchRow.tsx"));
const BRACKET_TREE = read(join(TOURNAMENT_DIR, "_components", "BracketTree.tsx"));
const PAGE = read(join(TOURNAMENT_DIR, "page.tsx"));
const PLAYER_DIALOG = read(join(TOURNAMENT_DIR, "_components", "PlayerScoreDialog.tsx"));
const ADMIN_DIALOG = read(join(TOURNAMENT_DIR, "_components", "AdminScoreDialog.tsx"));
const ISSUE_REPORT_CONTEXT = read(join(TOURNAMENT_DIR, "_lib", "issue-report-context.tsx"));
const HEADER = read(join(TOURNAMENT_DIR, "_components", "TournamentHeader.tsx"));

describe("bouton « Signaler un problème » — réservé au match du lecteur", () => {
  it("MatchRow calcule la visibilité avec le module pur, pas une comparaison recopiée", () => {
    expect(MATCH_ROW).toContain('from "@/lib/shared/match-card-viewer"');
    expect(MATCH_ROW).toContain("canReportOwnMatch(canReport, myTeamId, match.team1Id, match.team2Id)");
  });

  it("lit myTeamId depuis LiveContext, qui le porte déjà, plutôt que de le dupliquer", () => {
    // `LiveProvider` enveloppe déjà `IssueReportProvider` dans `page.tsx` et
    // reçoit `myTeamId={detail.myTeamId}` : une seconde copie sur le contexte
    // de signalement décrirait la même donnée depuis deux sources.
    expect(MATCH_ROW).toContain('from "../_lib/live-context"');
    expect(MATCH_ROW).toContain("useLiveControls()");
    expect(ISSUE_REPORT_CONTEXT).not.toContain("myTeamId");
    expect(PAGE).not.toMatch(/<IssueReportProvider[\s\S]{0,120}myTeamId=/);
  });

  it("n'ouvre le signalement qu'aux engagés inscrits, pas à qui a seulement une équipe", () => {
    // `myTeamId` est l'équipe active, inscrite ou non : le bouton de
    // l'en-tête comme ceux des cartes passent par `isViewerEntrant`.
    expect(PAGE).toContain("canReport={isViewerEntrant(detail.myTeamId, detail.registrations) && !frozen}");
    expect(HEADER).toContain("isViewerEntrant(detail.myTeamId, detail.registrations) && (");
    expect(HEADER).not.toContain("{detail.myTeamId !== null && (");
  });
});

describe("saisie du score par un engagé — modale, plus de formulaire en ligne", () => {
  it("MatchRow n'a plus de champ de score, mais un bouton qui ouvre la modale joueur", () => {
    expect(MATCH_ROW).not.toContain('type="number"');
    expect(MATCH_ROW).not.toContain("<form");
    expect(MATCH_ROW).toContain("usePlayerScore()");
    expect(MATCH_ROW).toContain("playerScore.open(match)");
    // Le libellé annonce le geste attendu (saisir, confirmer, corriger), décidé
    // par le module pur plutôt qu'écrit sur place.
    expect(MATCH_ROW).toContain("playerScoreButtonLabel(playerReportView(match, myTeamId)");
  });

  it("la carte annonce la proposition en attente, lisible de tous", () => {
    expect(MATCH_ROW).toContain("pendingReportNotice(match)");
  });

  it("la modale saisit map par map, colonnes ordonnées comme la carte (MAP_SCORES.md)", () => {
    // Une ligne par map : équipe 1 puis équipe 2, dans l'orientation du plateau.
    expect(PLAYER_DIALOG).toMatch(/<MapScoreList[\s\S]{0,300}team1Name=\{team1\}[\s\S]{0,40}team2Name=\{team2\}/);
    // Le message d'envoi parle depuis l'engagé : la conversion passe par le
    // module pur, jamais par une inversion recopiée.
    expect(PLAYER_DIALOG).toContain("toReporterScores(myTeamIsTeam1,");
    expect(PLAYER_DIALOG).toContain(
      "confirmsAsIs && view?.theirs ? { maps, confirm: { reportedAt: view.theirs.reportedAt } } : { maps }",
    );
  });

  it("la liste de maps est celle de l'arbitrage : une seule implémentation", () => {
    expect(PLAYER_DIALOG).toContain('from "./MapScoreList"');
    expect(ADMIN_DIALOG).toContain('from "./MapScoreList"');
  });
});

describe("nom d'équipe — même repli sur la carte et dans la modale", () => {
  it("MatchRow et la modale passent par le même repli à trois niveaux", () => {
    expect(MATCH_ROW).toMatch(/teamLabel\(\s*match\.team1Name,\s*match\.team1Placeholder,/);
    expect(PLAYER_DIALOG).toMatch(/teamLabel\(match\.team1Name, match\.team1Placeholder,/);
  });
});

describe("notification d'envoi — nomme les équipes, pas l'identifiant du match", () => {
  it("la modale construit le message avec le module pur", () => {
    expect(PLAYER_DIALOG).toContain('from "@/lib/shared/match-card-viewer"');
    expect(PLAYER_DIALOG).toContain("scoreSubmittedMessage(");
    expect(PLAYER_DIALOG).toContain("isMyTeamTeam1(myTeamId, match.team1Id)");
    expect(PLAYER_DIALOG).not.toMatch(/Score transmis pour le match #\$\{match\.id\}/);
  });
});

describe("libellé d'un tour profond du tableau — français, comme l'accueil", () => {
  it("BracketTree replie sur « Manche N », pas « Round N »", () => {
    expect(BRACKET_TREE).toContain("`Manche ${globalIdx + 1}`");
    expect(BRACKET_TREE).not.toMatch(/`Round \$\{/);
  });
});
