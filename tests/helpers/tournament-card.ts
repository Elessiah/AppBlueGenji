import { DEFAULT_REGISTRATION_FILTERS } from "@/lib/shared/registration-filters";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Une `TournamentCard` **complète**, surchargée champ par champ.
 *
 * Chaque fichier de test écrivait la sienne, et un champ ajouté au type n'était
 * reporté dans aucune : tant que les tests n'étaient pas type-vérifiés, dix
 * fabriques rendaient des cartes sans `image` ni `registrationFilters`, que le
 * code réel ne reçoit jamais. Une fabrique locale garde ses valeurs propres et
 * délègue le reste ici — un champ ajouté demain ne se reporte qu'une fois.
 */
export function tournamentCard(overrides: Partial<TournamentCard> = {}): TournamentCard {
  return {
    id: 1,
    name: "Tournoi",
    description: null,
    format: "SINGLE",
    game: "OW",
    participantType: "TEAM",
    maxTeams: 8,
    registeredTeams: 0,
    state: "UPCOMING",
    startVisibilityAt: "2026-05-01T10:00:00.000Z",
    registrationOpenAt: "2026-05-02T10:00:00.000Z",
    registrationCloseAt: "2026-05-10T10:00:00.000Z",
    startAt: "2026-05-12T10:00:00.000Z",
    hasThirdPlaceMatch: false,
    survivalRoundsBeforeFirstCut: null,
    survivalRoundsPerCut: null,
    phases: null,
    matchFormat: null,
    endurancePlayoffFormat: null,
    registrationFilters: { ...DEFAULT_REGISTRATION_FILTERS },
    liveUrl: null,
    image: null,
    finishedAt: null,
    championName: null,
    ...overrides,
  };
}
