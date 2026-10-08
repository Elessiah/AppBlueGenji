import type { MatchMapResult } from "./match-maps";
import type { EnduranceRoundCell } from "./bg-survie/replay";
import type { EnduranceStatus } from "./bg-survie/standings";
import type { AccountSuspensionView } from "./account-suspension";
import type { ConnectionMethod } from "./account-connections";
import type { MatchFormat } from "./match-format";
import type { MatchLiveTrigger } from "./live-streams";
import type { CastBlock } from "./match-launch";
import type { ParticipantType } from "./participants";
import type {
  RegistrationFilterError,
  RegistrationFilters,
} from "./registration-filters";
import type { PlatformRole } from "./permissions";
import type { TournamentPreview } from "./tournament-preview";
import type { TournamentImage } from "./tournament-image";
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
  /** Manches closes sans vainqueur (map nulle). */
  draws: number;
  status: EnduranceStatus;
  eliminatedRound: number | null;
  rank: number;
  /**
   * Capital manche par manche, aligné sur `EnduranceMeta.rounds` — la lecture
   * « feuille de calcul » du mode. Une équipe déclarée forfait y porte « FF »
   * sur la manche de sa sortie et sur toutes les suivantes.
   */
  rounds: EnduranceRoundCell[];
  /**
   * Points retirés par pénalité d'arbitrage, cumulés — `0` si l'engagé n'a
   * jamais été sanctionné. C'est la **baisse réelle** du capital : une sanction
   * visant une équipe déjà sortie n'ampute rien, et une sanction plus lourde
   * que le capital n'en retire que ce qu'il restait.
   */
  penaltyPoints: number;
};

/**
 * Pénalité d'endurance telle qu'elle s'affiche (`lib/shared/endurance-penalty.ts`).
 *
 * Le motif et l'auteur ne sont pas décoratifs : une sanction se conteste, et
 * « −3 » sans un mot ni un nom n'est adressable à personne.
 */
export type EndurancePenaltyRow = {
  id: number;
  teamId: number;
  teamName: string;
  /** Manche à laquelle la sanction a été prononcée. */
  round: number;
  /** Points retirés. */
  points: number;
  reason: string;
  /** Arbitre qui l'a prononcée, `null` si son compte a été supprimé. */
  authorPseudo: string | null;
  createdAt: string | null;
  /**
   * La sanction peut-elle encore être retirée ?
   *
   * Faux dès qu'une manche **postérieure** porte une saisie : lui rendre ses
   * points remettrait alors en lice une équipe qui n'a pas joué les manches
   * écoulées depuis, et le moteur ne réapparie que la manche courante. C'est la
   * règle de `lib/shared/match-lock.ts`, décidée par le serveur — le drapeau
   * n'existe que pour ne pas proposer un bouton voué au refus.
   */
  removable: boolean;
};

export type EnduranceMeta = {
  /** Capital de départ (défaut 9). */
  startPoints: number;
  /** Points gagnés par map gagnée. */
  winDelta: number;
  /** Points perdus par map perdue. */
  lossDelta: number;
  /**
   * Maps portées au vainqueur d'un forfait : le score plein du format du
   * tournoi (FT3 → 3), 1 en saisie libre.
   */
  forfeitMaps: number;
  /** Effectif de la phase éliminatoire (8 par le règlement). */
  playoffSize: number;
  /**
   * Plafond de manches qualificatives, `null` s'il n'y en a pas — la phase
   * s'arrête alors sur le seul effectif.
   */
  maxRounds: number | null;
  /** Dernière manche générée en phase qualificative. */
  currentRound: number;
  /** Vrai dès que l'arbre des play-offs a été construit. */
  playoffsStarted: boolean;
  /** Manches qualificatives jouées, dans l'ordre : colonnes du tableau. */
  rounds: number[];
  /**
   * Pénalités infligées, de la plus ancienne manche à la plus récente. Vide
   * dans l'immense majorité des tournois : une sanction reste l'exception.
   */
  penalties: EndurancePenaltyRow[];
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

export type TournamentGame = "OW" | "MR";

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
  /**
   * Tag Discord visible des autres joueurs connectés. **Seulement s'il est
   * certifié** : le réglage ne publie jamais un tag que personne n'a prouvé
   * (`canViewDiscordTag`). Indépendant de la certification, qui ouvre le tag à
   * l'organisation et pas aux joueurs.
   */
  discord: boolean;
};

// eslint-disable-next-line sonarjs/redundant-type-aliases -- voir le NOSONAR ci-dessous
export type PlayerRole = TeamRole; // NOSONAR typescript:S6564 — alias de domaine (rôle vu depuis le joueur), importé par plusieurs modules

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
  /**
   * Tag Discord, **filtré à la sortie** par `visibleDiscordTag`
   * (`lib/shared/discord-identity.ts`) : le propriétaire du compte, les
   * administrateurs si le tag est certifié, l'arbitrage si le joueur est en plus
   * engagé dans un tournoi vivant, tout joueur connecté si le titulaire l'a
   * rendu visible (`visibility.discord`). `null` partout ailleurs.
   */
  discordPseudo?: string | null;
  /**
   * Le tag a-t-il été prouvé par son titulaire ?
   *
   * **Ne suit pas `discordPseudo`**, et c'est délibéré : le tag dit *comment*
   * joindre le joueur (coordonnée, filtrée), la certification dit seulement
   * *qu'il est joignable* par l'organisation — un fait qui ne nomme personne.
   * D'où « Masqué ✅ » sur une fiche dont le tag est filtré, et la possibilité
   * pour un capitaine de voir qui de son roster remplit la condition
   * d'inscription. Voir `canSeeDiscordVerification`.
   */
  discordVerified?: boolean;
  // Enriched fields for /joueurs listing
  /**
   * Compte anonymisé (`bg_users.is_deleted`).
   *
   * Rendu par `listPlayers`, dont l'annuaire masque ces lignes **par défaut**
   * derrière un bouton discret — la ligne restant nécessaire à qui remonte un
   * ancien match —, et par `getFullProfile`, dont la fiche doit **annoncer** le
   * compte supprimé : son pseudo d'emprunt (`lib/shared/anonymous-pseudos.ts`)
   * se lit comme un pseudo ordinaire.
   *
   * Absent de `getUserById`, qui ne filtre pas `is_deleted`.
   */
  isDeleted?: boolean;
  team?: {
    id: number;
    name: string;
    colorIndex: number;
  } | null;
  roles?: PlayerRole[];
  games?: ("OW" | "MR")[];
  tournamentsCount?: number;
  wins?: number;
  losses?: number;
};

export type TeamListItem = {
  id: number;
  name: string;
  /**
   * Sigle de l'équipe (2 à 4 caractères alphanumériques, majuscules), unique
   * sur tout le site. `null` tant que l'équipe n'en a pas choisi : l'affichage
   * retombe alors sur les initiales du nom (`displayTeamTag`).
   */
  tag: string | null;
  logoUrl: string | null;
  membersCount: number;
  createdAt: string;
  rank: number;
  points: number;
  wins: number;
  losses: number;
  form: ("w" | "l" | "d")[];
  games: ("OW" | "MR")[];
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
  /**
   * Compte anonymisé : l'anonymisation ne détache pas de l'équipe. Il reste au
   * roster (l'historique en dépend), mais ne peut plus recevoir la propriété.
   */
  isDeleted: boolean;
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

/**
 * D'où vient l'ordre qui décidera du tirage — la même distinction que la colonne
 * `bg_tournaments.manual_seeding` :
 *
 * - `MANUAL` — ordre fixé à la main par le staff, il fait autorité partout ;
 * - `RANKING` — classement du site (survie, ronde suisse, BG Survie, multi-phases) ;
 * - `REGISTRATION` — ordre d'arrivée des inscriptions (formats à plateau).
 *
 * La règle qui le calcule vit dans `lib/shared/seeding.ts` ; le type est ici
 * parce que l'instantané du tournoi le transporte.
 */
export type SeedingSource = "MANUAL" | "RANKING" | "REGISTRATION";

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
   * « BlueGenji Survie » : format de l'**arbre final**, quand il diffère de
   * celui de la qualification. `null` = celui du tournoi, égalités fermées.
   *
   * Le mode est le seul à en jouer deux : sa qualification peut clore un match
   * sans vainqueur (map nulle), pas son élimination directe. Voir
   * `tournamentMatchFormat` (`lib/shared/bg-survie/rounds.ts`), qui tranche pour les
   * deux côtés.
   */
  endurancePlayoffFormat: MatchFormat | null;
  /**
   * Conditions d'inscription (`lib/shared/registration-filters.ts`) : effectif
   * minimal, exigence de tag Discord certifié et de compte Blizzard rattaché.
   *
   * Sur la carte, donc **publiques** : ce sont des conditions d'accès, elles
   * doivent se lire avant de tenter une inscription, et non se découvrir dans un
   * refus. Les équipes fantômes n'y sont pas soumises.
   */
  registrationFilters: RegistrationFilters;
  /**
   * Matchs planifiés par l'arbitrage (`lib/shared/match-planning.ts`) : un
   * match sans horaire est « à planifier » plutôt qu'en lancement. Public,
   * comme les conditions d'inscription : c'est une règle du tournoi que les
   * engagés doivent connaître.
   */
  refereeScheduling: boolean;
  /**
   * Chaîne officielle du tournoi (Twitch, YouTube, Kick). `null` = pas de
   * diffusion annoncée. Les matchs n'en héritent jamais (`lib/shared/live-streams.ts`).
   */
  liveUrl: string | null;
  /**
   * Illustration ou logo du tournoi, **facultatif** (`null` = aucune image).
   * Toujours un fichier du site ; le cadrage (mode, point focal) voyage avec
   * lui — voir `lib/shared/tournament-image.ts`.
   */
  image: TournamentImage | null;
  /**
   * Instant de clôture (`bg_tournaments.finished_at`), `null` tant que le
   * tournoi n'est pas terminé. Distinct de `startAt` : une carte « terminé »
   * datait sinon la fin d'un tournoi par son coup d'envoi.
   */
  finishedAt: string | null;
  /**
   * Vainqueur d'un tournoi **terminé** — l'unique engagé classé premier
   * (`pickChampion`, `lib/shared/tournament-card-summary.ts`). `null` hors
   * `FINISHED`, et aussi quand le classement final n'en désigne pas un seul
   * (finale en double forfait, ex æquo).
   */
  champion: TournamentChampion | null;
  /**
   * Avancement interne d'un tournoi **en cours**, de 0 à 1 : la mesure de
   * `computeRunningRatio` (`lib/shared/tournament-progress.ts`), propre à
   * chaque famille de formats. `null` hors `RUNNING`, ou quand rien ne permet
   * encore de situer le déroulement.
   *
   * Dans la liste, il suit la durée de vie du cache (15 s) et non chaque
   * score : un score ne vide pas les listes, par choix (`notifications.ts`).
   */
  runningProgress: number | null;
};

/** Vainqueur annoncé sur la carte d'un tournoi terminé. */
export type TournamentChampion = {
  teamId: number;
  /** Nom de l'engagé : une équipe, ou le pseudo d'un joueur en individuel. */
  name: string;
};

export type TournamentBuckets = {
  upcoming: TournamentCard[];
  registration: TournamentCard[];
  running: TournamentCard[];
  finished: TournamentCard[];
  /**
   * Présent **seulement** quand `finished` est tronqué aux plus récents
   * (`FINISHED_TOURNAMENTS_LIST_LIMIT`, liste publique mutualisée) : le
   * nombre de tournois terminés qu'elle aurait portés en entier, en tout et
   * par jeu. Absent, `finished` est complet.
   */
  finishedTotals?: FinishedTournamentTotals;
};

/** Décompte des tournois terminés d'une liste dont le panier est tronqué. */
export type FinishedTournamentTotals = {
  all: number;
  byGame: Record<TournamentGame, number>;
};

/**
 * Score **proposé** par une engagée, en attente de l'autre (cycle de report,
 * `lib/shared/player-score-report.ts`). Toujours dans l'orientation du plateau
 * — équipe 1, équipe 2 —, quelle que soit l'engagée qui l'a proposé : c'est
 * ainsi que la carte les affiche, et la conversion depuis le « mon score /
 * score adverse » stocké n'est écrite qu'une fois, à la sérialisation.
 */
export type MatchScoreReport = {
  team1Score: number;
  team2Score: number;
  reportedAt: string;
  /**
   * Détail map par map de la proposition (`docs/features/MAP_SCORES.md`),
   * orientation du plateau ; vide dans l'instantané diffusé, rempli par le
   * contexte du lecteur (`matchProposals`).
   */
  maps: MatchMapResult[];
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
  /**
   * Les **deux** engagées ont déclaré forfait : la rencontre est close sans
   * vainqueur, sans perdant désigné et sans score, et compte comme une défaite
   * pour chacune (`lib/shared/double-forfeit.ts`). Exclusif de `forfeitTeamId`,
   * qui ne nomme qu'une équipe.
   */
  doubleForfeit: boolean;
  nextWinnerMatchId: number | null;
  nextWinnerSlot: number | null;
  nextLoserMatchId: number | null;
  nextLoserSlot: number | null;
  scoreDeadlineAt: string | null;
  /** Proposition de score de l'équipe 1 en attente ; `null` = aucune. */
  team1Report: MatchScoreReport | null;
  /** Proposition de score de l'équipe 2 en attente ; `null` = aucune. */
  team2Report: MatchScoreReport | null;
  /**
   * Détail map par map du résultat **retenu** (`docs/features/MAP_SCORES.md`) :
   * code de replay (vide quand l'arbitrage s'en est passé) et score de chaque
   * map. Vide pour un forfait ou une exemption, et tant qu'aucun score n'est
   * posé.
   */
  maps: MatchMapResult[];
  updatedAt: string;
  /** ID de la phase du tournoi (0 pour un tournoi sans phases). */
  phaseId: number;
  /** Position de la manche au sein de la phase (null pour les tournois sans phases). */
  phasePosition: number | null;
  /**
   * Date de début programmée du match (ISO), fixée par le staff `tournaments` ;
   * `null` = aucun horaire annoncé. Purement descriptive côté moteur — elle
   * n'avance ni ne bloque le match — mais elle déclenche l'antenne des matchs
   * castés en mode `START_TIME` (`lib/shared/match-schedule.ts`).
   */
  startAt: string | null;
  /** Mode de passage à l'antenne ; `null` = match non casté. */
  liveTrigger: MatchLiveTrigger | null;
  /** Chaîne diffusant ce match ; `null` = casté sans lien public. */
  liveUrl: string | null;
  /** Ouverture d'antenne (mode `MANUAL`) ; `null` = antenne fermée. */
  liveStartedAt: string | null;
  /**
   * Équipe qui héberge la partie, **résolue** : celle que l'arbitrage a
   * désignée, sinon l'équipe 1 (`resolveHostTeamId`, `lib/shared/match-launch.ts`).
   */
  hostTeamId: number | null;
  /** Caster inscrit sur ce match ; `null` = aucun. */
  casterUserId: number | null;
  /** Pseudo du caster (public, comme tout pseudo du site). */
  casterPseudo: string | null;
  /** Ouverture du lancement (ISO), posée à la première observation. */
  lobbyOpenedAt: string | null;
  /** Lancement du match (ISO) ; `null` = pas encore lancé. */
  launchedAt: string | null;
  /** « Prêt » de chaque partie ; une fantôme est prête d'office. */
  team1Ready: boolean;
  team2Ready: boolean;
  casterReady: boolean;
  /**
   * Lien YouTube de la rediff, posé par la permission `live` une fois le match
   * joué ; `null` = aucune. Stocké tel quel : son **affichage** est décidé par
   * `visibleReplayUrl` (`lib/shared/match-replay.ts`), qui le tait sur un match
   * rouvert par un retour en arrière.
   */
  replayUrl: string | null;
};

/**
 * Partie du détail d'un tournoi **identique pour tout le monde** : le plateau,
 * les inscrites, les classements.
 *
 * C'est la scission qui rend le temps réel tenable. Auparavant, un score
 * rapporté réveillait chaque spectateur, qui rechargeait alors *son* détail
 * complet : cent spectateurs, cent calculs identiques. Le serveur n'en fait plus
 * qu'un, qu'il pousse tel quel dans le flux SSE ; ce qui dépend du lecteur vit
 * à part dans {@link TournamentViewerContext} et ne change presque jamais.
 */
export type TournamentSnapshot = {
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
   * D'où vient l'ordre de seeding effectif. Sert à l'interface pour dire si la
   * liste des inscrites est bien celle que jouera le moteur. En `RANKING`, avant
   * le coup d'envoi, l'instantané range `registrations` par le classement du
   * site, rangs renumérotés (`registrationsFollowRanking`) : la liste est alors
   * le tirage prévu. Une fois lancé, elle suit les rangs figés au coup d'envoi
   * (`registrationsFollowFrozenDraw`) : `registrations[].seed` est alors ce
   * rang, `null` pour une engagée sans rang figé (rangée en dernier).
   */
  seedingSource: SeedingSource;
  /**
   * Empreinte du contenu ci-dessus. Deux instantanés de même version portent la
   * même information : le serveur s'abstient alors de les envoyer, et le client
   * de se redessiner.
   */
  version: string;
};

/** Partie du détail qui dépend de **qui regarde**. Change rarement. */
export type TournamentViewerContext = {
  /**
   * Aperçu du plateau avant le lancement (`docs/features/TOURNAMENT_PREVIEW.md`).
   * `null` pour qui n'a ni la permission `tournaments` ni `casting`, et pour un
   * tournoi déjà lancé — le plateau réel fait alors foi.
   *
   * Ici, et non dans l'instantané : l'instantané est **diffusé tel quel à tous
   * les abonnés du flux**, et cet aperçu est réservé au staff et au cast.
   */
  preview: TournamentPreview | null;
  canRegister: boolean;
  /**
   * Le viewer a-t-il **qualité pour engager** son engagé ? En tournoi par
   * équipes : porte-t-il `OWNER` ou `MANAGER` dans son équipe active
   * (`lib/shared/team-roles.ts`) ? En individuel : toujours vrai, il n'engage
   * que lui-même.
   *
   * Distinct de `canRegister`, qui y ajoute l'état du tournoi et l'absence
   * d'inscription préalable. Ce champ-ci ne dépend que de la personne : un
   * instantané ne connaît pas les rosters, il ne peut donc ni l'accorder ni le
   * retirer — le client le rejoue tel quel d'un instantané à l'autre, comme
   * `canManageLive` ou `canDelete`.
   *
   * Sert aussi à **expliquer** l'absence de bouton : un joueur du roster doit
   * lire pourquoi il ne peut pas inscrire son équipe, plutôt que de chercher un
   * bouton qui n'apparaît pas.
   */
  canRegisterEntrant: boolean;
  /**
   * Pourquoi l'engagé du lecteur ne remplit-il pas les **conditions
   * d'inscription** du tournoi (`lib/shared/registration-filters.ts`) ?
   * `null` = il les remplit, ou la question ne se pose pas (inscriptions
   * fermées, déjà engagé, pas d'engagé, pas la qualité pour l'engager).
   *
   * Distinct de `canRegister`, qui dit seulement *non* : le bouton se ferme sur
   * ce champ, et la phrase qui prend sa place en vient — sans quoi le lecteur
   * verrait un bouton disparaître sans savoir s'il doit recruter ou certifier un
   * tag. Il dépend du **roster**, donc du lecteur, donc il vit dans son contexte
   * et non dans l'instantané diffusé.
   */
  registrationBlock: RegistrationFilterError | null;
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
   * son historique (`docs/features/TOURNAMENT_DELETION.md`).
   */
  canDelete: boolean;
  /**
   * Droit d'annuler l'abandon d'un engagé (`docs/features/FORFEIT_CANCELLATION.md`).
   * Administrateur strict, comme `canDelete` : un arbitre déclare un abandon,
   * seul un administrateur remet en lice l'équipe qui l'a déclaré.
   */
  canCancelForfeit: boolean;
  /**
   * Le viewer porte-t-il la permission `live` (ADMIN, ARBITRE, CASTER) ? Ouvre
   * les contrôles de diffusion des matchs, distincts des droits d'arbitrage.
   */
  canManageLive: boolean;
  /** Identifiant du lecteur : reconnaître « c'est moi qui caste ce match ». */
  viewerUserId: number;
  /**
   * Ce qui empêche le lecteur de s'inscrire pour caster un match, `null` s'il
   * le peut : permission `live` **et** tag Discord certifié **et** compte
   * Battle.net rattaché (`castBlockReason`, `lib/shared/match-launch.ts`).
   */
  castBlock: CastBlock | null;
  /**
   * Détail map par map des propositions **en attente** que ce lecteur a le
   * droit de lire (`docs/features/MAP_SCORES.md`) : celles des matchs de son
   * engagé s'il mène le match (`canCreateReportsForTeamIds`), toutes pour
   * l'arbitrage. Jamais dans l'instantané diffusé : les codes de replay d'une
   * proposition ne regardent que les deux engagés et le staff.
   */
  matchProposals: MatchProposalMaps[];
};

/** Proposition map par map d'un engagé, datée de son dépôt. */
export type ProposalMaps = { reportedAt: string; maps: MatchMapResult[] };

/** Détail des propositions en attente sur un match, par côté du plateau. */
export type MatchProposalMaps = {
  matchId: number;
  team1: ProposalMaps | null;
  team2: ProposalMaps | null;
};

/** Détail complet d'un tournoi pour un lecteur donné. */
export type TournamentDetail = TournamentSnapshot & TournamentViewerContext;

/**
 * Fréquentation du site, telle que servie à la commande Discord `/stats-site`.
 *
 * `visits*` compte les visites (une arrivée d'un visiteur, fenêtre de session de
 * 30 min) ; `uniqueVisitors*` compte les empreintes de visiteur distinctes.
 * `identifiedVisitors` isole les comptes connectés — le sous-ensemble sûrement
 * dédoublonné « par utilisateur ».
 *
 * `uniqueVisitors` et `identifiedVisitors` ne sont **pas** des totaux depuis la
 * mise en service : une empreinte est effacée `SITE_VISITOR_RETENTION_MONTHS`
 * (25) mois après sa dernière visite, si bien qu'ils comptent les visiteurs des
 * vingt-cinq derniers mois — et peuvent baisser. `totalVisits` et
 * `firstVisitAt`, eux, remontent à la mise en service.
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
  messagesLast7Days: number;
  relayedMessagesLast7Days: number;
  uniqueUsersLast7Days: number;
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
  /** `null` : aucune période de comparaison (tuiles « messages » et « relais »). */
  delta: string | null;
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
  relays7j: number;
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
  /**
   * Le lecteur a la permission `moderation` : il peut retirer l'avatar sans
   * lien avec ce compte — même geste que `TeamDetailResponse.canModerate`.
   */
  canModerate: boolean;
  /**
   * Le compte a un avatar **réel**, indépendamment du réglage de visibilité —
   * `profile.avatarUrl` est filtré par `visible_avatar` et rend `null` pour un
   * avatar masqué à ce lecteur, ce qui masquerait aussi le bouton de retrait à
   * la modération sur l'avatar même qu'un signalement viserait. Toujours
   * `false` hors modération (`canModerate`) : une case qui ne vaudrait jamais
   * `true` pour un visiteur ordinaire ne lui apprend rien qu'il ne pourrait
   * déjà déduire.
   */
  moderationAvatarPresent: boolean;
  /**
   * Suspension en cours du compte (`lib/shared/account-suspension.ts`) —
   * toujours `null` hors modération (`canModerate`) et pour un compte supprimé.
   */
  moderationSuspension: AccountSuspensionView | null;
  /**
   * La modération peut suspendre ce compte : ni le sien, ni un administrateur,
   * ni un compte supprimé. Toujours `false` hors modération.
   */
  moderationSuspendable: boolean;
};

/**
 * Export RGPD (droit à la portabilité, art. 20) de l'intégralité des données
 * personnelles d'un utilisateur, dans un format lisible par machine (JSON).
 * Contient les identifiants bruts (Discord, Google, Blizzard) réservés au
 * propriétaire du compte — ne jamais exposer à un tiers. Aucune adresse
 * e-mail : le site n'en collecte plus, et la colonne qui portait celles d'avant
 * a été supprimée.
 */
export type PersonalDataExport = {
  exportedAt: string;
  account: {
    id: number;
    pseudo: string;
    discordId: string | null;
    discordPseudo: string | null;
    /** Date de certification du tag Discord (`null` = jamais prouvé). */
    discordVerifiedAt: string | null;
    /**
     * La porte par laquelle le rattachement Discord a été noué — le bouton
     * (`OAUTH`) ou le code en message privé (`DM_CODE`). `null` quand rien
     * n'est rattaché, ou quand le rattachement est antérieur à
     * l'enregistrement de cette information.
     */
    discordLinkMethod: ConnectionMethod | null;
    googleSub: string | null;
    /** Identifiant Battle.net (`null` si aucun compte Blizzard n'est rattaché). */
    blizzardSub: string | null;
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
  /**
   * Changements du traitement des données dont le joueur a pris connaissance,
   * avec leur date — la trace de l'information (`lib/shared/privacy-changes.ts`).
   * Le champ garde le nom `acceptedAt` : le format de l'export ne change pas.
   */
  privacyAcknowledgments: { changeId: string; acceptedAt: string }[];
  /** Acceptations des conditions d'utilisation, avec la version et l'écran (`lib/shared/terms-of-use.ts`). */
  termsAcceptances: { version: number; context: string; acceptedAt: string }[];
  /**
   * Signalements et contestations envoyés depuis ce compte, tant qu'ils sont
   * conservés (`lib/shared/content-reports.ts`).
   */
  reports: {
    id: number;
    category: string;
    status: string;
    description: string;
    pagePath: string | null;
    contactName: string | null;
    contactEmail: string | null;
    rightsRelation: string | null;
    /** Signalement contesté, pour une contestation. */
    parentReportId: number | null;
    createdAt: string;
  }[];
  /**
   * Notifications push (`lib/shared/push-notifications.ts`) : les appareils
   * abonnés — **tout** ce que la ligne garde, clés comprises — et les sujets
   * coupés par le compte.
   */
  pushNotifications: {
    devices: {
      endpoint: string;
      p256dh: string;
      auth: string;
      createdAt: string;
      lastSuccessAt: string | null;
    }[];
    disabledTopics: string[];
  };
  /**
   * Journal des données de connexion (`lib/shared/connection-logs.ts`) : une
   * ligne par ouverture de session, gardée un an au titre de l'obligation
   * légale de l'hébergeur — porte, adresse IP et date.
   */
  connectionLogs: { event: string; ip: string | null; createdAt: string }[];
  /**
   * Détail map par map que le titulaire a saisi (`bg_match_maps`) : match,
   * jeu de lignes (proposition `TEAM1`/`TEAM2` ou résultat `FINAL`), code de
   * replay et scores de chaque map.
   */
  mapEntries: {
    matchId: number;
    tournamentId: number;
    source: string;
    mapNumber: number;
    replayCode: string;
    team1Score: number;
    team2Score: number;
    submittedAt: string | null;
  }[];
  /**
   * Suspensions du compte encore conservées (`lib/shared/account-suspension.ts`) :
   * faits retenus, clause invoquée et dates — jamais qui les a prononcées.
   */
  suspensions: {
    reason: string;
    ground: string;
    startsAt: string;
    endsAt: string | null;
    liftedAt: string | null;
  }[];
};

export type TeamDetailResponse = {
  team: {
    id: number;
    name: string;
    /** Sigle unique de l'équipe, ou `null` si elle n'en a pas — cf. `TeamListItem.tag`. */
    tag: string | null;
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
  /**
   * Compte qui lit la fiche. La page le relisait par un second appel
   * (`/api/profile`), si bien que ses propres boutons s'affichaient d'abord
   * comme ceux d'un autre membre — « Exclure » sur sa propre ligne — le temps
   * que la réponse arrive.
   */
  viewerUserId: number;
  // Relation du viewer à l'équipe (self-service / invitations).
  viewerMembership: "MEMBER" | "OWNER" | "NONE";
  viewerInvitation: "INVITED" | "REQUESTED" | "NONE";
  /** Invitation ou demande en attente du viewer — ce qui permet de retirer sa demande. */
  viewerInvitationId: number | null;
  /**
   * Le lecteur a la permission `moderation` : il peut retirer le logo sans
   * gérer l'équipe. Posé par la seule lecture de la fiche (`GET`), absent des
   * réponses des routes de mutation — la page relit la fiche après chacune.
   */
  canModerate?: boolean;
};

/** Invitation envoyée par une équipe, encore sans réponse (vue gestion). */
export type TeamSentInvitation = {
  id: number;
  userId: number;
  pseudo: string;
  roles: TeamRole[];
  createdAt: string;
};

/** Demande d'adhésion reçue par une équipe, encore sans réponse (vue gestion). */
export type TeamJoinRequest = {
  id: number;
  userId: number;
  pseudo: string;
  createdAt: string;
};
