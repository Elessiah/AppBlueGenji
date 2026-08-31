// Backward compatibility: re-export all from the new tournaments module
export type {
  // Types
  DeletedTournament,
  TournamentRow,
  RegistrationRow,
  MatchRow,
  TournamentListRow,
  EditableTournamentValues,
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
  registerGhostTeam,
  canUserRegister,
  getUserEntrantTeamId,
  // Bracket
  createBracketIfMissing,
  // Scoring (internal)
  finalizeMatch,
  // Scoring - public API
  reportMatchScorePublic as reportMatchScore,
  // Admin
  checkDownstreamMatchesHaveNoScores,
  // Suppression définitive (administrateurs)
  deleteTournament,
  // Instantané partagé + contexte du lecteur (voir tournaments/snapshot.ts)
  getTournamentSnapshot,
  getTournamentSnapshotFrame,
  getTournamentViewerContext,
  invalidateTournamentSnapshot,
  invalidateTournamentLists,
  // Public API (matching old API expectations)
  adminSaveMatchScoresPublic as adminSaveMatchScores,
  adminResolveMatchPublic as adminResolveMatch,
  // Notifications
  publishUpdatedEvent,
  publishScoreReportedEvent,
  publishScoreResolvedEvent,
  // Journal Discord
  queueBotLog,
  flushBotLogs,
  discardBotLogs,
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
  // Abandon (Survie / Ronde suisse)
  forfeitTournamentTeamPublic as forfeitTournamentTeam,
  // Édition
  loadEditableTournament,
  updateTournament,
} from "./tournaments";
