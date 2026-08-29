import type { MatchFormat } from "./match-format";
import type { MatchLiveTrigger } from "./live-streams";
import type { ParticipantType } from "./participants";
import type { PlatformRole } from "./permissions";
import type { TournamentPreview } from "./tournament-preview";
import type { DeepStats, TeamRankingPosition } from "./stats";

export type TournamentFormat =
  | "SINGLE"
  | "DOUBLE"
  | "SWISS"
  | "SURVIVAL"
  | "MULTI"
  /** « BlueGenji Survie » : endurance puis play-offs à 8 (`docs/features/BG_SURVIE_MODE.md`). */
  | "BG_SURVIE";

export type PhaseFormat = "SINGLE" | "DOUBLE" | "SWISS" | "SURVIVAL";
export type PhaseQualifierMode = "COUNT" | "PERCENT";
export type PhaseState = "PENDING" | "RUNNING" | "FINISHED" | "SKIPPED";

export type TournamentPhase = {
  id: number;
  position: number;
  name: string | null;
  format: PhaseFormat;
  qualifierMode: PhaseQualifierMode;
  qualifierValue: number;
  hasThirdPlaceMatch: boolean;
  swissTotalRounds: number | null;
  survivalRoundsBeforeFirstCut: number | null;
  survivalRoundsPerCut: number | null;
  state: PhaseState;
  entrants: number | null;
  qualifiers: number | null;
  maxRounds: number | null;
  startedAt: string | null;
  finishedAt: string | null;
};

export type TournamentPhaseStanding = {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  seed: number;
  rank: number | null;
  qualified: boolean;
};

export type SurvivalStandingRow = {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  seed: number;
  wins: number;
  losses: number;
  status: "ACTIVE" | "ELIMINATED" | "FORFEIT";
  eliminatedRound: number | null;
  rank: number;
};

export type SurvivalMeta = {
  /** Manches jouées avant la première coupe. */
  roundsBeforeFirstCut: number;
  /** Manches entre deux coupes suivantes. */
  roundsPerCut: number;
  currentRound: number;
  /**
   * Nombre de rounds de barrage d'équilibrage joués (0 ou 1). Un barrage précède
   * le premier round complet quand les inscriptions sont en nombre impair ; il
   * ne compte pas dans la cadence des coupes.
   */
  barrageRounds: number;
  standings: SurvivalStandingRow[];
};

/** Ligne du classement d'endurance (mode « BlueGenji Survie »). */
export type EnduranceStandingRow = {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  /** Rang de départ, fixé par l'ordre de seeding. */
  seed: number;
  /** Capital d'endurance restant. */
  points: number;
  wins: number;
  losses: number;
  status: "ACTIVE" | "ELIMINATED" | "FORFEIT";
  eliminatedRound: number | null;
  rank: number;
};

export type EnduranceMeta = {
  /** Capital de départ (défaut 9). */
  startPoints: number;
  /** Points gagnés par victoire de map. */
  winDelta: number;
  /** Points perdus par défaite de map. */
  lossDelta: number;
  /** Effectif de la phase éliminatoire (8 par le règlement). */
  playoffSize: number;
  /** Dernière manche générée en phase qualificative. */
  currentRound: number;
  /** Vrai dès que l'arbre des play-offs a été construit. */
  playoffsStarted: boolean;
  standings: EnduranceStandingRow[];
};

export type SwissTiebreaker = "buchholz" | "sonneborn-berger" | "opponent-mwp" | "head-to-head";

export type SwissStandingRow = {
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  /** Seed initial (1 = meilleure équipe au classement du site). */
  seed: number;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  /** Victoires d'office reçues (effectif impair). */
  byes: number;
  /** Départage principal : somme des points des adversaires rencontrés. */
  buchholz: number;
  status: "ACTIVE" | "FORFEIT";
  rank: number;
};

export type SwissMeta = {
  /** Nombre de rondes prévues, fixé au lancement. */
  totalRounds: number;
  currentRound: number;
  pointsForWin: number;
  pointsForDraw: number;
  pointsForLoss: number;
  pointsForBye: number;
  /** Ordre des départages appliqués à points égaux. */
  tiebreakers: SwissTiebreaker[];
  standings: SwissStandingRow[];
};

export type TournamentState = "UPCOMING" | "REGISTRATION" | "RUNNING" | "FINISHED";

export type TournamentGame = "OW2" | "MR";

export type BracketType = "UPPER" | "LOWER" | "GRAND" | "THIRD_PLACE";

export type MatchStatus = "PENDING" | "READY" | "AWAITING_CONFIRMATION" | "COMPLETED";

export type TeamRole =
  | "COACH"
  | "TANK"
  | "DPS"
  | "HEAL"
  | "CAPITAINE"
  | "MANAGER"
  | "OWNER";

/**
 * Réglages de confidentialité d'un profil.
 *
 * Le **pseudo n'y figure pas** : c'est l'identité de base du joueur sur la
 * plateforme (brackets, rosters, feuilles de match), il reste toujours visible.
 * Seules les données de contact et d'état civil peuvent être masquées.
 */
export type VisibilitySettings = {
  avatar: boolean;
  overwatch: boolean;
  marvel: boolean;
  major: boolean;
};

export type PlayerRole = TeamRole;

export type PublicUserProfile = {
  id: number;
  pseudo: string;
  avatarUrl: string | null;
  overwatchBattletag: string | null;
  marvelRivalsTag: string | null;
  isAdult: boolean | null;
  visibility: VisibilitySettings;
  /**
   * Ouvert au recrutement : le joueur accepte d'être démarché par les équipes.
   * À `false`, il n'apparaît plus dans le filtre « Free agents » de `/joueurs`
   * même s'il n'a pas d'équipe.
   */
  openToRecruitment: boolean;
  createdAt: string;
  // Privé — uniquement renseigné quand le viewer consulte son propre profil.
  discordPseudo?: string | null;
  // Enriched fields for /joueurs listing
  team?: {
    id: number;
    name: string;
    colorIndex: number;
  } | null;
  roles?: PlayerRole[];
  games?: ("OW2" | "MR")[];
  tournamentsCount?: number;
  wins?: number;
  losses?: number;
};

export type TeamListItem = {
  id: number;
  name: string;
  logoUrl: string | null;
  membersCount: number;
  createdAt: string;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  form: ("w" | "l" | "d")[];
  games: ("OW2" | "MR")[];
  rosterPreview: { userId: number; pseudo: string; avatarUrl: string | null }[];
  region: string | null;
  /** Équipe fantôme : créée par le staff, sans joueur rattaché. */
  isGhost: boolean;
};

export type TeamMember = {
  membershipId: number;
  userId: number;
  pseudo: string;
  avatarUrl: string | null;
  roles: TeamRole[];
  joinedAt: string;
};

export type TeamHistoryRow = {
  tournamentId: number;
  tournamentName: string;
  state: TournamentState;
  finalRank: number | null;
  wins: number;
  losses: number;
  playedAt: string;
};

export type TournamentCard = {
  id: number;
  name: string;
  description: string | null;
  format: TournamentFormat;
  game: TournamentGame;
  /** `SOLO` = tournoi individuel : les joueurs s'inscrivent sans équipe. */
  participantType: ParticipantType;
  maxTeams: number;
  registeredTeams: number;
  state: TournamentState;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
  /** Mode Survie : nombre de rounds joués avant la première coupe. */
  survivalRoundsBeforeFirstCut: number | null;
  /** Mode Survie : nombre de rounds joués entre les coupes suivantes. */
  survivalRoundsPerCut: number | null;
  /** Phases du tournoi multi-mode (null pour les tournois mono-mode). */
  phases: TournamentPhase[] | null;
  /**
   * Format des matchs (BO5, FT3…) appliqué à la saisie des scores. `null` =
   * score libre, comme les tournois créés avant cette fonctionnalité.
   */
  matchFormat: MatchFormat | null;
  /**
   * Chaîne officielle du tournoi (Twitch, YouTube, Kick). `null` = pas de
   * diffusion annoncée. Les matchs n'en héritent jamais (`lib/shared/live-streams.ts`).
   */
  liveUrl: string | null;
};

export type TournamentBuckets = {
  upcoming: TournamentCard[];
  registration: TournamentCard[];
  running: TournamentCard[];
  finished: TournamentCard[];
};

export type BracketMatch = {
  id: number;
  tournamentId: number;
  bracket: BracketType;
  roundNumber: number;
  matchNumber: number;
  status: MatchStatus;
  team1Id: number | null;
  team2Id: number | null;
  team1Name: string | null;
  team2Name: string | null;
  team1Placeholder: string | null;
  team2Placeholder: string | null;
  team1Score: number | null;
  team2Score: number | null;
  winnerTeamId: number | null;
  loserTeamId: number | null;
  forfeitTeamId: number | null;
  nextWinnerMatchId: number | null;
  nextWinnerSlot: number | null;
  nextLoserMatchId: number | null;
  nextLoserSlot: number | null;
  scoreDeadlineAt: string | null;
  updatedAt: string;
  /** ID de la phase du tournoi (0 pour un tournoi sans phases). */
  phaseId: number;
  /** Position de la manche au sein de la phase (null pour les tournois sans phases). */
  phasePosition: number | null;
  /** Mode de passage à l'antenne ; `null` = match non casté. */
  liveTrigger: MatchLiveTrigger | null;
  /** Chaîne diffusant ce match ; `null` = casté sans lien public. */
  liveUrl: string | null;
  /** Ouverture d'antenne (mode `MANUAL`) ; `null` = antenne fermée. */
  liveStartedAt: string | null;
};

export type TournamentDetail = {
  card: TournamentCard;
  matches: BracketMatch[];
  registrations: {
    teamId: number;
    teamName: string;
    logoUrl: string | null;
    seed: number | null;
    registeredAt: string;
    finalRank: number | null;
  }[];
  canRegister: boolean;
  /**
   * Engagé du viewer dans **ce** tournoi : son équipe active en tournoi par
   * équipes, son entrée solo en tournoi individuel (null s'il n'est pas
   * inscrit).
   */
  myTeamId: number | null;
  canCreateReportsForTeamIds: number[];
  isAdmin: boolean;
  /**
   * Droit de supprimer définitivement le tournoi. Volontairement plus étroit
   * que `isAdmin` (qui vaut en réalité la permission `tournaments`, portée
   * aussi par les arbitres) : seul un administrateur efface un tournoi et tout
   * son historique.
   */
  canDelete: boolean;
  /**
   * Le viewer porte-t-il la permission `live` (ADMIN, ARBITRE, CASTER) ? Ouvre
   * les contrôles de diffusion des matchs, distincts des droits d'arbitrage.
   */
  canManageLive: boolean;
  /** Métadonnées du mode Survie (null pour les autres formats). */
  survival: SurvivalMeta | null;
  /** Métadonnées du mode Ronde suisse (null pour les autres formats). */
  swiss: SwissMeta | null;
  /** Métadonnées du mode BlueGenji Survie (null pour les autres formats). */
  endurance: EnduranceMeta | null;
  /** Phases du tournoi multi-mode (null pour les tournois mono-mode). */
  phases: TournamentPhase[] | null;
  /** ID de la phase actuellement en cours (null si aucune phase n'est en cours). */
  currentPhaseId: number | null;
  /** Classements par phase (null pour les tournois mono-mode). */
  phaseStandings: Record<number, TournamentPhaseStanding[]> | null;
  /**
   * Engagés qui sont en réalité des joueurs : `team_id → user_id`. Vide pour un
   * tournoi par équipes ; sert à lier vers `/joueurs/[id]` plutôt que
   * `/equipes/[id]`.
   */
  soloUserIds: Record<number, number>;
  /**
   * Aperçu du plateau avant le lancement (`docs/features/TOURNAMENT_PREVIEW.md`).
   * `null` pour qui n'a ni la permission `tournaments` ni `casting`, et pour un
   * tournoi déjà lancé — le plateau réel fait alors foi.
   */
  preview: TournamentPreview | null;
};

/**
 * Fréquentation du site, telle que servie à la commande Discord `/stats-site`.
 *
 * `visits*` compte les visites (une arrivée d'un visiteur, fenêtre de session de
 * 30 min) ; `uniqueVisitors*` compte les empreintes de visiteur distinctes.
 * `identifiedVisitors` isole les comptes connectés — le sous-ensemble sûrement
 * dédoublonné « par utilisateur ».
 */
export type SiteVisitStats = {
  totalVisits: number;
  uniqueVisitors: number;
  visitsLast24h: number;
  uniqueVisitorsLast24h: number;
  visitsLast7Days: number;
  uniqueVisitorsLast7Days: number;
  visitsLast30Days: number;
  uniqueVisitorsLast30Days: number;
  identifiedVisitors: number;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
};

export type BotStats = {
  affiliatedServers: number;
  affiliatedChannels: number;
  messagesLast30Days: number;
  relayedMessagesLast30Days: number;
  uniqueUsersLast30Days: number;
};

export type BotStatus = {
  startupTs: number;
  uptimeMs: number;
  version: string;
  buildHash: string;
  buildDate: string;
  gatewayLatency: number;
  shardCount: { active: number; total: number };
  cpuUsage: number;
  ramUsage: number;
  status: "OPERATIONAL" | "DEGRADED" | "DOWN";
};

export type BotKpiEntry = {
  value: number;
  delta: string;
  series: number[];
};

export type BotKpis = {
  servers: BotKpiEntry;
  channels: BotKpiEntry;
  messages: BotKpiEntry;
  relays: BotKpiEntry;
};

export type BotServerEntry = {
  id: string;
  name: string;
  memberCount: number;
  relays30j: number;
  status: "ok" | "lag" | "off";
  sparkline: number[];
  accentColor: string;
  sigil: string;
};

export type BotServersPayload = {
  servers: BotServerEntry[];
  total: number;
  limit: number;
  offset: number;
};

export type BotActivity = {
  range: string;
  labels: string[];
  relays: number[];
  scrims: number[];
  avgPerDay: number;
};

export type BotModuleKey = "annonces" | "scrims" | "recrutement" | "notifications" | "oauth" | "stats";

export type BotModuleEntry = {
  key: BotModuleKey;
  enabled: boolean;
  count30j: number;
};

export type BotModulesPayload = {
  guildId: string;
  modules: BotModuleEntry[];
};

export type BotFeedEvent = {
  id: number;
  ts: string;
  type: 'relay' | 'scrim' | 'recr' | 'auth' | 'warn';
  summary: string;
  guildId?: string;
  userId?: string;
};

/**
 * Statistiques d'un joueur. Alias de `DeepStats` : joueurs et équipes exposent
 * exactement le même bloc, calculé par `lib/shared/stats.ts`.
 */
export type ProfileStats = DeepStats;

export type UserTeamTimeline = {
  teamId: number;
  teamName: string;
  joinedAt: string;
  leftAt: string | null;
  roles: TeamRole[];
};

export type FullProfileResponse = {
  profile: PublicUserProfile;
  stats: ProfileStats;
  teamsTimeline: UserTeamTimeline[];
  tournaments: TeamHistoryRow[];
  isSelf: boolean;
  // Statut administrateur du profil consulté.
  isAdmin: boolean;
  // Rôles de permission du profil consulté (uniquement renseigné pour un viewer admin).
  roles: PlatformRole[];
  // Rôles de permission publics (titres staff) affichés à tous les visiteurs.
  displayRoles: PlatformRole[];
  // Vrai lorsque le viewer est administrateur (débloque la gestion des rôles).
  viewerIsAdmin: boolean;
};

/**
 * Export RGPD (droit à la portabilité, art. 20) de l'intégralité des données
 * personnelles d'un utilisateur, dans un format lisible par machine (JSON).
 * Contient les identifiants bruts (email, Discord, Google) réservés au
 * propriétaire du compte — ne jamais exposer à un tiers.
 */
export type PersonalDataExport = {
  exportedAt: string;
  account: {
    id: number;
    pseudo: string;
    email: string | null;
    discordId: string | null;
    discordPseudo: string | null;
    googleSub: string | null;
    isAdult: boolean | null;
    isAdmin: boolean;
    createdAt: string;
  };
  profile: {
    avatarUrl: string | null;
    overwatchBattletag: string | null;
    marvelRivalsTag: string | null;
    visibility: VisibilitySettings;
    openToRecruitment: boolean;
  };
  stats: ProfileStats;
  teamsTimeline: UserTeamTimeline[];
  tournaments: TeamHistoryRow[];
};

export type TeamDetailResponse = {
  team: {
    id: number;
    name: string;
    logoUrl: string | null;
    description: string | null;
    createdAt: string;
    deletedAt: string | null;
    /** Équipe fantôme : créée par le staff, sans joueur rattaché. */
    isGhost: boolean;
  };
  members: TeamMember[];
  tournaments: TeamHistoryRow[];
  /** Statistiques approfondies de l'équipe (mêmes définitions que le joueur). */
  stats: DeepStats;
  /**
   * Place de l'équipe au classement du site. `null` sur les réponses des
   * routes de mutation, qui ne la calculent pas : le classement demande une
   * agrégation sur toutes les équipes, hors de propos pour un ajout de membre.
   */
  ranking: TeamRankingPosition | null;
  canManage: boolean;
  /**
   * Vrai si le viewer administre cette équipe au titre de la permission
   * `tournaments` (équipe fantôme) et non parce qu'il en est membre.
   */
  managedAsGhost: boolean;
  // Relation du viewer à l'équipe (self-service / invitations).
  viewerMembership: "MEMBER" | "OWNER" | "NONE";
  viewerInvitation: "INVITED" | "REQUESTED" | "NONE";
};
