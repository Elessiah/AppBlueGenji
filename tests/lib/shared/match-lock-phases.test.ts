import { describe, expect, it } from "@jest/globals";
import {
  dependentMatches,
  hasScoreInput,
  isScoreEditLocked,
  type MatchScoreState,
} from "@/lib/shared/match-lock";

/** Extended match state with phase information. */
interface PhaseMatchState extends MatchScoreState {
  phaseId: number;
}

function match(overrides: Partial<PhaseMatchState> = {}): PhaseMatchState {
  return {
    id: 1,
    roundNumber: 1,
    team1Id: 10,
    team2Id: 20,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    forfeitTeamId: null,
    hasPendingReport: false,
    nextWinnerMatchId: null,
    nextLoserMatchId: null,
    phaseId: 1,
    ...overrides,
  };
}

describe("match-lock — verrouillage cross-phase", () => {
  it("verrouille un match de phase 1 quand un match de phase 2 a un score", () => {
    const phase1Match = match({ id: 1, phaseId: 1, winnerTeamId: 10 });
    const phase2Match = match({ id: 2, phaseId: 2, team1Score: 2, team2Score: 1 });

    const allMatches = [phase1Match, phase2Match] as MatchScoreState[];

    // Un match de phase 2 avec score ne bloque normalement que via dépendances de bracket.
    // En contexte cross-phase, la phase 2 dépend toujours de la phase 1 :
    // une modification de phase 1 réécrirait les participants de phase 2.
    // Donc : si phase 2 a un score, phase 1 est verrouillée.
    expect(isScoreEditLocked(phase1Match, allMatches, "SINGLE")).toBe(true);
  });

  it("ne verrouille pas une phase 2 par une phase 1", () => {
    const phase1Match = match({ id: 1, phaseId: 1, team1Score: 2, team2Score: 1 });
    const phase2Match = match({ id: 2, phaseId: 2, winnerTeamId: 10 });

    const allMatches = [phase1Match, phase2Match] as MatchScoreState[];

    // La phase 1 n'impacte pas la phase 2 directement.
    // Seule une modification de phase 2 vers phase 3 (ou plus) la verrouille.
    expect(isScoreEditLocked(phase2Match, allMatches, "SINGLE")).toBe(false);
  });

  it("verrouille un match de phase 1 quand n'importe quel match de phase suivante a un score", () => {
    const phase1 = match({ id: 1, phaseId: 1, winnerTeamId: 10 });
    const phase2Vierge = match({ id: 2, phaseId: 2 });
    const phase3 = match({ id: 3, phaseId: 3, team1Score: 1, team2Score: 0 });

    const allMatches = [phase1, phase2Vierge, phase3] as MatchScoreState[];

    // Phase 1 est verrouillée dès qu'une phase ultérieure a du contenu.
    expect(isScoreEditLocked(phase1, allMatches, "SURVIVAL")).toBe(true);
  });

  it("n'empêche pas une phase 2 d'être éditée si phase 1 est vierge", () => {
    const phase1 = match({ id: 1, phaseId: 1 });
    const phase2 = match({ id: 2, phaseId: 2, winnerTeamId: 10 });

    const allMatches = [phase1, phase2] as MatchScoreState[];

    // Aucun match de phase 3+ n'a de score.
    expect(isScoreEditLocked(phase2, allMatches, "SURVIVAL")).toBe(false);
  });

  it("applique les règles intra-phase pour élimination simple/double", () => {
    const match1 = match({ id: 1, phaseId: 1, winnerTeamId: 10, nextWinnerMatchId: 5 });
    const match2 = match({ id: 5, phaseId: 1, roundNumber: 2 });
    const match3 = match({ id: 6, phaseId: 1, roundNumber: 2, team1Score: 2, team2Score: 1 });

    const allMatches = [match1, match2, match3] as MatchScoreState[];

    // La règle de bracket s'applique au sein de la phase 1.
    expect(isScoreEditLocked(match1, allMatches, "SINGLE")).toBe(true);
  });

  it("applique les règles intra-phase pour survie et ronde suisse", () => {
    const phase1Round1 = match({ id: 1, phaseId: 1, roundNumber: 1, winnerTeamId: 10 });
    const phase1Round2a = match({ id: 2, phaseId: 1, roundNumber: 2 });
    const phase1Round2b = match({ id: 3, phaseId: 1, roundNumber: 2, team1Score: 1, team2Score: 0 });

    const allMatches = [phase1Round1, phase1Round2a, phase1Round2b] as MatchScoreState[];

    // En survie/suisse, tous les rounds ultérieurs dépendent.
    expect(isScoreEditLocked(phase1Round1, allMatches, "SURVIVAL")).toBe(true);
    expect(isScoreEditLocked(phase1Round1, allMatches, "SWISS")).toBe(true);
  });
});

describe("match-lock — tournois sans phases (retrocompatibilité)", () => {
  it("se comporte comme avant quand tous les matches ont la même phase", () => {
    const match1 = match({ id: 1, phaseId: 1, winnerTeamId: 10, nextWinnerMatchId: 5 });
    const match2 = match({ id: 5, phaseId: 1, roundNumber: 2 });
    const match3 = match({ id: 6, phaseId: 1, roundNumber: 2, team1Score: 2, team2Score: 1 });

    const allMatches = [match1, match2, match3] as MatchScoreState[];

    // Comportement identical à avant : verrouillage sur lien de bracket
    expect(isScoreEditLocked(match1, allMatches, "SINGLE")).toBe(true);
    expect(isScoreEditLocked(match2, allMatches, "SINGLE")).toBe(false);
  });

  it("ignore les phases quand le phaseId est identique partout", () => {
    const base = {
      teams: [
        { teamId: 1, seed: 1, phaseId: 1 },
        { teamId: 2, seed: 2, phaseId: 1 },
      ],
      matches: [match({ phaseId: 1 }), match({ phaseId: 1, id: 2 })],
    };

    const m1 = base.matches[0];
    const m2 = base.matches[1];

    // Sans dépendances cross-phase, les deux règles se chevauchent
    // mais le résultat reste cohérent.
    expect(isScoreEditLocked(m1, base.matches as MatchScoreState[], "SURVIVAL")).toBe(false);
  });
});

describe("match-lock — cas limites cross-phase", () => {
  it("gère un tournoi multi-phase où phase 2 dépend de phase 1", () => {
    const p1m1 = match({ id: 1, phaseId: 1, roundNumber: 1, winnerTeamId: 10 });
    const p2m1 = match({ id: 2, phaseId: 2, roundNumber: 1 });

    const allMatches = [p1m1, p2m1] as MatchScoreState[];

    // Phase 1 match 1 est vierge en apparence (pas de dépendance bracket).
    // Mais phase 2 commence : phase 1 ne doit plus être éditable.
    expect(isScoreEditLocked(p1m1, allMatches, "SINGLE")).toBe(false);

    // Ajoutons un score à phase 2 : phase 1 se verrouille.
    const p2m1WithScore = { ...p2m1, team1Score: 1 };
    expect(isScoreEditLocked(p1m1, [p1m1, p2m1WithScore], "SINGLE")).toBe(true);
  });

  it("verrouille la phase 1 si la phase 2 débute, même sans phase 3", () => {
    const phase1 = match({ id: 1, phaseId: 1, winnerTeamId: 10 });
    const phase2Started = match({ id: 2, phaseId: 2, team1Score: 0 });

    const allMatches = [phase1, phase2Started] as MatchScoreState[];

    expect(isScoreEditLocked(phase1, allMatches, "SURVIVAL")).toBe(true);
  });

  it("ne verrouille pas les phases supérieures sur les inférieures", () => {
    const phase1 = match({ id: 1, phaseId: 1 });
    const phase2 = match({ id: 2, phaseId: 2, team1Score: 2 });
    const phase3 = match({ id: 3, phaseId: 3, winnerTeamId: 10 });

    const allMatches = [phase1, phase2, phase3] as MatchScoreState[];

    // Phase 2 n'est pas verrouillée par phase 1 (aucun contenu en phase 1).
    expect(isScoreEditLocked(phase2, allMatches, "SURVIVAL")).toBe(false);

    // Phase 3 n'est verrouillée que par elle-même (via dépendances intra-phase).
    expect(isScoreEditLocked(phase3, allMatches, "SURVIVAL")).toBe(false);
  });
});

describe("dependentMatches — cross-phase logic", () => {
  it("inclut les phases ultérieures entières comme dépendantes", () => {
    const phase1 = match({ id: 1, phaseId: 1, roundNumber: 1 });
    const phase2a = match({ id: 2, phaseId: 2, roundNumber: 1 });
    const phase2b = match({ id: 3, phaseId: 2, roundNumber: 2 });
    const phase3 = match({ id: 4, phaseId: 3, roundNumber: 1 });

    const allMatches = [phase1, phase2a, phase2b, phase3] as MatchScoreState[];

    // En SURVIVAL, tous les rounds ultérieurs de la même phase dépendent.
    // Mais ici, les phases suivantes sont aussi dépendantes.
    const deps = dependentMatches(phase1, allMatches, "SURVIVAL");
    const depIds = deps.map((m) => m.id);

    // Tous les matchs de phase 2 et 3 devraient être dépendants.
    expect(depIds).toContain(2);
    expect(depIds).toContain(3);
    expect(depIds).toContain(4);
  });

  it("respecte l'ordre des phases dans les dépendances cross-phase", () => {
    const phase1 = match({ id: 1, phaseId: 1 });
    const phase2 = match({ id: 2, phaseId: 2 });

    const allMatches = [phase1, phase2] as MatchScoreState[];

    // Phase 2 dépend de phase 1 (elle reçoit les qualifiés de phase 1).
    const deps = dependentMatches(phase1, allMatches, "SINGLE");
    expect(deps.map((m) => m.id)).toContain(2);

    // Phase 1 ne dépend pas de phase 2.
    const depsRev = dependentMatches(phase2, allMatches, "SINGLE");
    expect(depsRev.length).toBe(0);
  });
});
