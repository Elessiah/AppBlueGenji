import type { BracketMatch, MatchCaster } from "@/lib/shared/types";

/**
 * Un `BracketMatch` **complet** (match vierge d'un tournoi sans phases),
 * surchargé champ par champ — même raison d'être que `tournamentCard` : un champ
 * ajouté au type ne se reporte qu'ici, pas dans chaque fichier de test.
 */
export function bracketMatch(overrides: Partial<BracketMatch> = {}): BracketMatch {
  return {
    id: 1,
    tournamentId: 1,
    bracket: "UPPER",
    roundNumber: 1,
    matchNumber: 1,
    status: "PENDING",
    team1Id: null,
    team2Id: null,
    team1Name: null,
    team2Name: null,
    team1Placeholder: null,
    team2Placeholder: null,
    team1Score: null,
    team2Score: null,
    winnerTeamId: null,
    loserTeamId: null,
    forfeitTeamId: null,
    doubleForfeit: false,
    nextWinnerMatchId: null,
    nextWinnerSlot: null,
    nextLoserMatchId: null,
    nextLoserSlot: null,
    scoreDeadlineAt: null,
    scoreAutoValidationPaused: false,
    team1Report: null,
    team2Report: null,
    maps: [],
    updatedAt: "2026-01-01T00:00:00.000Z",
    phaseId: 0,
    phasePosition: null,
    startAt: null,
    liveTrigger: null,
    liveUrl: null,
    streams: [],
    liveStartedAt: null,
    hostTeamId: null,
    firstBanTeamId: null,
    refereeAssigned: false,
    refereeKey: null,
    selfManaged: false,
    firstMap: null,
    mapPicks: {},
    casters: [],
    lobbyOpenedAt: null,
    launchedAt: null,
    team1Ready: false,
    team2Ready: false,
    replayUrl: null,
    ...overrides,
  };
}

/** Un caster de match (`BracketMatch.casters`), sur le stream 1 par défaut. */
export function matchCaster(overrides: Partial<MatchCaster> = {}): MatchCaster {
  return { userId: 900, pseudo: "Caster", streamId: 1, ready: false, ...overrides };
}
