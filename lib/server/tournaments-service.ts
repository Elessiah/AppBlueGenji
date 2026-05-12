// Backward compatibility: re-export all from the new tournaments module
export type {
  // Types
  TournamentRow,
  RegistrationRow,
  MatchRow,
  TournamentListRow,
} from "./tournaments";

export {
  // Mappers
  mapCard,
  mapMatch,
  statusFromTeams,
  // State
  computeTournamentState,
  syncTournamentState,
  hasPendingStateTransition,
  // Registration
  registerCurrentUserTeam,
  canUserRegister,
  // Bracket
  createBracketIfMissing,
  // Scoring (internal)
  finalizeMatch,
  // Scoring - public API
  reportMatchScorePublic as reportMatchScore,
  // Admin
  checkDownstreamMatchesHaveNoScores,
  // Public API (matching old API expectations)
  adminSaveMatchScoresPublic as adminSaveMatchScores,
  adminResolveMatchPublic as adminResolveMatch,
  // Notifications
  publishUpdatedEvent,
  publishScoreReportedEvent,
  publishScoreResolvedEvent,
  sendBotLogAsync,
  // Repository
  loadTournamentRow,
  loadRegisteredTeamIds,
  createMatch,
  setMatchParticipants,
  updateTournamentState,
  updateTournamentBracketSize,
  finishTournament,
  getRegistrationRows,
  getMatchRows,
  getTournamentListRow,
  hasExistingMatches,
  deleteAllMatches,
  resetRegistrationRanks,
  // Byes
  tryAutoResolveByes,
  // Finalization
  finalizeTournamentIfDone,
  resolveExpiredScoreReports,
  // Public API
  createTournament,
  listTournamentBuckets,
  getTournamentDetail,
  reportMatchScorePublic,
  adminResolveMatchPublic,
} from "./tournaments";
