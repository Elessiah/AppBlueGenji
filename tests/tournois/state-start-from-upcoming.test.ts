import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/bracket-generator");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/bg-survie");
jest.mock("@/lib/server/tournaments/phases");
jest.mock("@/lib/server/tournaments/bot-logs");

import { syncTournamentState } from "@/lib/server/tournaments/state";
import { loadTournamentRow, updateTournamentState } from "@/lib/server/tournaments/repository";
import {
  finalizeUnderfilledTournament,
  finalizeTournamentIfDone,
  resolveExpiredScoreReports,
} from "@/lib/server/tournaments/finalization";
import { createBracketIfMissing } from "@/lib/server/tournaments/bracket-generator";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import {
  generateSwissRound,
  initializeSwissTournament,
  reconcileSwiss,
} from "@/lib/server/tournaments/swiss";
import {
  generateSurvivalRound,
  initializeSurvivalTournament,
  reconcileSurvival,
} from "@/lib/server/tournaments/survival";
import {
  generateEnduranceRound,
  initializeEnduranceTournament,
  reconcileEndurance,
} from "@/lib/server/tournaments/bg-survie";
import { initializeMultiTournament, reconcilePhases } from "@/lib/server/tournaments/phases";
import { queueBotLog } from "@/lib/server/tournaments/bot-logs";

type Row = Record<string, unknown>;

const DAY = 86_400_000;
const past = (days: number) => new Date(Date.now() - days * DAY);

/**
 * Tournoi dont le coup d'envoi vient de passer, **l'état stocké valant déjà
 * `UPCOMING`** : c'est la position réelle d'un tournoi entre la clôture de ses
 * inscriptions et son heure de début (`computeTournamentState` y rend
 * `UPCOMING`), et donc le point de départ le plus courant vers `RUNNING`.
 */
function fromUpcoming(format: string): Row {
  return {
    id: 7,
    state: "UPCOMING",
    format,
    finished_at: null,
    start_visibility_at: past(5),
    registration_open_at: past(4),
    registration_close_at: past(2),
    start_at: past(1),
    bracket_size: null,
  };
}

const connection = {} as never;

describe("syncTournamentState — coup d'envoi depuis UPCOMING", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (createBracketIfMissing as jest.Mock).mockResolvedValue({ finished: false } as never);
    (resolveExpiredScoreReports as jest.Mock).mockResolvedValue(undefined as never);
    (tryAutoResolveByes as jest.Mock).mockResolvedValue(undefined as never);
    (finalizeTournamentIfDone as jest.Mock).mockResolvedValue(undefined as never);
    // Plateau garni : la clôture pour cause de plateau désert ne s'en mêle pas.
    (finalizeUnderfilledTournament as jest.Mock).mockResolvedValue(false as never);
  });

  /** La ligne est relue une fois passée `RUNNING` (entretien du bloc final). */
  function starting(row: Row): void {
    (loadTournamentRow as jest.Mock)
      .mockResolvedValueOnce(row as never)
      .mockResolvedValue({ ...row, state: "RUNNING" } as never);
  }

  it.each([
    ["SWISS", initializeSwissTournament, generateSwissRound, reconcileSwiss],
    ["SURVIVAL", initializeSurvivalTournament, generateSurvivalRound, reconcileSurvival],
    ["BG_SURVIE", initializeEnduranceTournament, generateEnduranceRound, reconcileEndurance],
  ])(
    "initialise le moteur %s alors que l'état de départ n'est pas REGISTRATION",
    async (format, initialize, generate, reconcile) => {
      starting(fromUpcoming(format));

      await syncTournamentState(connection, 7);

      // Le coup d'envoi se reconnaît à l'état d'arrivée. Exiger le couple
      // `REGISTRATION → RUNNING` privait ces formats de leur amorce dès que la
      // clôture et le début n'étaient pas simultanés : classement jamais semé,
      // aucune manche générée, tournoi « en cours » sans rien à jouer.
      expect(initialize).toHaveBeenCalledWith(7, connection);
      expect(generate).toHaveBeenCalledWith(7, connection);
      expect(reconcile).toHaveBeenCalledWith(7, connection);
      expect(updateTournamentState).toHaveBeenCalledWith(connection, 7, "RUNNING");
    },
  );

  it("initialise le multi-phases depuis UPCOMING", async () => {
    starting(fromUpcoming("MULTI"));

    await syncTournamentState(connection, 7);

    expect(initializeMultiTournament).toHaveBeenCalledWith(7, connection);
    expect(reconcilePhases).toHaveBeenCalledWith(7, connection);
  });

  it("journalise le départ, quel que soit l'état de provenance", async () => {
    starting(fromUpcoming("SINGLE"));

    await syncTournamentState(connection, 7);

    expect(queueBotLog).toHaveBeenCalledWith(connection, {
      kind: "tournament_started",
      tournamentId: 7,
    });
  });

  it("n'initialise aucun moteur de classement pour un format à plateau", async () => {
    starting(fromUpcoming("DOUBLE"));

    await syncTournamentState(connection, 7);

    // L'élimination construit son plateau dans l'entretien, pas au départ.
    expect(initializeSwissTournament).not.toHaveBeenCalled();
    expect(initializeSurvivalTournament).not.toHaveBeenCalled();
    expect(initializeEnduranceTournament).not.toHaveBeenCalled();
    expect(initializeMultiTournament).not.toHaveBeenCalled();
    expect(createBracketIfMissing).toHaveBeenCalled();
  });

  it("initialise aussi depuis REGISTRATION — le cas d'origine reste couvert", async () => {
    starting({ ...fromUpcoming("SWISS"), state: "REGISTRATION" });

    await syncTournamentState(connection, 7);

    expect(initializeSwissTournament).toHaveBeenCalledWith(7, connection);
  });

  it("ne réinitialise rien sur un tournoi déjà en cours", async () => {
    // Aucun changement d'état : le bloc de départ n'est pas traversé, et une
    // seconde amorce écraserait le classement d'un tournoi entamé.
    (loadTournamentRow as jest.Mock).mockResolvedValue({
      ...fromUpcoming("SWISS"),
      state: "RUNNING",
    } as never);

    await syncTournamentState(connection, 7);

    expect(initializeSwissTournament).not.toHaveBeenCalled();
    expect(updateTournamentState).not.toHaveBeenCalled();
  });
});
