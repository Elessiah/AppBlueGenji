import type {
  TournamentDetail,
  TournamentSnapshot,
  TournamentViewerContext,
} from "@/lib/shared/types";
import { tournamentCard } from "./tournament-card";

/**
 * Un `TournamentSnapshot` **complet** : tournoi sans plateau ni inscrite. La
 * carte passe par `tournamentCard()`, qui garde la même règle — un champ ajouté
 * au type ne se reporte qu'une fois.
 */
export function tournamentSnapshot(overrides: Partial<TournamentSnapshot> = {}): TournamentSnapshot {
  return {
    card: tournamentCard(),
    matches: [],
    registrations: [],
    survival: null,
    swiss: null,
    endurance: null,
    phases: null,
    currentPhaseId: null,
    phaseStandings: null,
    soloUserIds: {},
    seedingSource: "REGISTRATION",
    version: "v1",
    ...overrides,
  };
}

/** Le contexte d'un lecteur sans aucun droit ni engagement. */
export function tournamentViewerContext(
  overrides: Partial<TournamentViewerContext> = {},
): TournamentViewerContext {
  return {
    preview: null,
    canRegister: false,
    canRegisterEntrant: true,
    registrationBlock: null,
    myTeamId: null,
    canCreateReportsForTeamIds: [],
    isAdmin: false,
    canDelete: false,
    canManageLive: false,
    ...overrides,
  };
}

/** Leur intersection, telle que la rend `getTournamentDetail`. */
export function tournamentDetail(overrides: Partial<TournamentDetail> = {}): TournamentDetail {
  return { ...tournamentSnapshot(), ...tournamentViewerContext(), ...overrides };
}
