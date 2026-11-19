/**
 * Ce que la page « Planning » reçoit (`GET /api/planning`) — types seuls,
 * importables côté client. Règles : `lib/shared/planning.ts`,
 * `docs/features/CAST_PLANNING.md`.
 */
import type {
  AssignmentReason,
  AssignmentSource,
  AvailabilityStatus,
  Coverage,
  PlanningEntryKind,
  PlanningRole,
} from "./planning";
import type { PlanningDurationSettings } from "./planning-durations";

/** Un engagé d'un match : équipe, ou entrée solo (fiche du joueur, jamais d'équipe). */
export type PlanningEntrant = { teamId: number; name: string; soloUserId: number | null };

/**
 * Une attribution affichée. `source` : `AUTO` / `MANUAL` pour celles du
 * planning ; `CAST` pour un caster inscrit sur le match (`bg_match_casters`) ;
 * `MATCH` pour un arbitre désigné hors du planning (fenêtre « Arbitrage »).
 */
export type PlanningAssignmentView = {
  userId: number;
  role: PlanningRole;
  source: AssignmentSource | "CAST" | "MATCH";
  reason: AssignmentReason;
  /** Proposition du calcul pas encore confirmée : le prochain calcul peut la remplacer. */
  provisional: boolean;
};

/**
 * Une attribution telle qu'un lecteur la reçoit : pour un lecteur sans la
 * permission `tournaments`, la raison d'une proposition du calcul faite à un
 * autre (« Préférence », « Charge ») devient `AUTO` — elle dirait ce que
 * l'autre a demandé.
 */
export type PlanningAssignmentShown = Omit<PlanningAssignmentView, "reason"> & { reason: AssignmentReason | "AUTO" };

export type PlanningAvailabilityView = {
  userId: number;
  role: PlanningRole;
  status: AvailabilityStatus;
  preferred: boolean;
};

/**
 * Un désistement (`CAST_PLANNING.md` § Désistement), montré au seul staff des
 * tournois : qui, quel rôle, s'il était tardif (moins de 24 h avant), son
 * motif facultatif, et si l'attribution quittée était confirmée.
 */
export type PlanningWithdrawalView = {
  userId: number;
  role: PlanningRole;
  late: boolean;
  reason: string | null;
  confirmed: boolean;
  createdAt: string;
};

export type PlanningEntryView = {
  key: string;
  kind: PlanningEntryKind;
  tournamentId: number;
  tournamentName: string;
  game: "OW" | "MR";
  matchId: number | null;
  roundNumber: number | null;
  team1: PlanningEntrant | null;
  team2: PlanningEntrant | null;
  startAt: string;
  /** Fin estimée (durées réglées par le staff) : deux entrées qui se chevauchent ne se tiennent pas ensemble. */
  endAt: string;
  /** Entrée qui reçoit encore des disponibilités et des attributions (à venir, non jouée). */
  open: boolean;
  /** Le staff peut encore y désigner quelqu'un (match non joué, tournoi non terminé). */
  editable: boolean;
  /** Tournoi pas encore publié : vu par le staff des tournois seul. */
  hidden: boolean;
  /** Chaîne de diffusion connue : premier stream du match, sinon la chaîne du tournoi. */
  channelUrl: string | null;
  /** Autogestion posée par le staff sur le match. */
  selfManaged: boolean;
  assignments: PlanningAssignmentShown[];
  coverage: Coverage;
  /** Disponibilités du lecteur sur cette entrée, par rôle tenu. */
  mine: PlanningAvailabilityView[];
  /** Disponibilités de tous (staff des tournois seul ; vide sinon). */
  availability: PlanningAvailabilityView[];
  /**
   * Rôles « à pourvoir » : une attribution confirmée en a été quittée par un
   * désistement, et personne ne la tient plus (entrée encore modifiable).
   */
  unfilled: PlanningRole[];
  /** Désistements de l'entrée (staff des tournois seul ; vide sinon). */
  withdrawals: PlanningWithdrawalView[];
};

export type PlanningMember = {
  userId: number;
  pseudo: string;
  roles: PlanningRole[];
  soloCaster: boolean;
  /** Voit les tournois encore cachés (permission `tournaments`) : rendu au staff des tournois seul, pour ses choix. */
  seesHidden?: boolean;
};

export type PlanningView = {
  me: number;
  myRoles: PlanningRole[];
  /** Attribution manuelle et calcul automatique (permission `tournaments`). */
  canManage: boolean;
  entries: PlanningEntryView[];
  members: PlanningMember[];
  /** Durées estimées qui servent aux chevauchements. */
  durations: PlanningDurationSettings;
};

/** Issue d'un désistement (`POST /api/planning/withdrawal`). */
export type WithdrawalResponse = { late: boolean; replaced: boolean; unfilled: boolean; streamLost: boolean; stillSignedUp: boolean };

/** Bilan d'un calcul automatique : ce qui est posé, et ce que le match a refusé. */
export type AutoAssignReport = {
  /** Entrées du lot (ouvertes, dans la fenêtre). */
  entries: number;
  /** Propositions posées par ce calcul. */
  proposed: number;
  /** Propositions provisoires du lot remplacées (recalculées). */
  replaced: number;
};

/** Bilan d'une confirmation : propositions confirmées, et celles que le match a refusées (retirées). */
export type ConfirmReport = { confirmed: number; refused: number };

/** Fenêtre d'un lot du calcul, au plus {@link PLANNING_BATCH_MAX_DAYS} jours. */
export const PLANNING_BATCH_MAX_DAYS = 31;

