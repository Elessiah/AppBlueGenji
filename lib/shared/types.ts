export type TournamentFormat = "SINGLE" | "DOUBLE";

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

export type VisibilitySettings = {
  avatar: boolean;
  pseudo: boolean;
  overwatch: boolean;
  marvel: boolean;
  major: boolean;
};

export type PublicUserProfile = {
  id: number;
  pseudo: string;
  avatarUrl: string | null;
  overwatchBattletag: string | null;
  marvelRivalsTag: string | null;
  isAdult: boolean | null;
  visibility: VisibilitySettings;
  createdAt: string;
};

export type TeamListItem = {
  id: number;
  name: string;
  logoUrl: string | null;
  membersCount: number;
  createdAt: string;
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
  maxTeams: number;
  registeredTeams: number;
  state: TournamentState;
  startVisibilityAt: string;
  registrationOpenAt: string;
  registrationCloseAt: string;
  startAt: string;
  hasThirdPlaceMatch: boolean;
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
  myTeamId: number | null;
  canCreateReportsForTeamIds: number[];
  isAdmin: boolean;
};

export type BotStats = {
  affiliatedServers: number;
  affiliatedChannels: number;
  messagesLast30Days: number;
  relayedMessagesLast30Days: number;
  uniqueUsersLast30Days: number;
};

export type ProfileStats = {
  tournamentsPlayed: number;
  tournamentsWon: number;
  matchesWon: number;
  matchesLost: number;
  bestRank: number | null;
  averageRank: number | null;
};

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
};

export type TeamDetailResponse = {
  team: {
    id: number;
    name: string;
    logoUrl: string | null;
    createdAt: string;
  };
  members: TeamMember[];
  tournaments: TeamHistoryRow[];
  canManage: boolean;
};
