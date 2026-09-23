import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/bot-logs");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/bracket-generator");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/byes");

import { syncTournamentState } from "@/lib/server/tournaments/state";
import { queueBotLog } from "@/lib/server/tournaments/bot-logs";
import { loadTournamentRow } from "@/lib/server/tournaments/repository";
import { createBracketIfMissing } from "@/lib/server/tournaments/bracket-generator";
import {
  finalizeTournamentIfDone,
  finalizeUnderfilledTournament,
  resolveExpiredScoreReports,
} from "@/lib/server/tournaments/finalization";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "../../helpers/row-overrides";
import { tournamentRow } from "../../helpers/tournament-rows";

const connection = {} as never;

const PAST = new Date(Date.now() - 86_400_000);
const FUTURE = new Date(Date.now() + 86_400_000);

function row(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  return tournamentRow({
    id: 5,
    state: "REGISTRATION",
    format: "SINGLE",
    finished_at: null,
    registration_open_at: PAST,
    registration_close_at: PAST,
    start_at: PAST,
    bracket_size: 8,
    ...overrides,
  });
}

function queuedKinds(): string[] {
  return jest.mocked(queueBotLog).mock.calls.map(
    (call) => (call[1] as { kind: string }).kind,
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(createBracketIfMissing).mockResolvedValue({ finished: false, created: false });
  jest.mocked(resolveExpiredScoreReports).mockResolvedValue(0);
  jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
  jest.mocked(finalizeTournamentIfDone).mockResolvedValue(undefined);
  jest.mocked(finalizeUnderfilledTournament).mockResolvedValue(false);
});

describe("syncTournamentState — coup d'envoi", () => {
  it("réserve la ligne de lancement quand le tournoi passe en cours", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(row());

    await syncTournamentState(connection, 5);

    expect(queuedKinds()).toEqual(["tournament_started"]);
  });

  it("la réserve aussi quand le tournoi part d'UPCOMING", async () => {
    // Le cas le plus courant, et celui qu'une condition sur l'état *de départ*
    // manquerait : entre la clôture des inscriptions et l'heure de début, un
    // tournoi repasse par UPCOMING.
    jest.mocked(loadTournamentRow).mockResolvedValue(row({ state: "UPCOMING" }));

    await syncTournamentState(connection, 5);

    expect(queuedKinds()).toEqual(["tournament_started"]);
  });

  it("ne réserve rien à l'ouverture des inscriptions", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(
      row({
        state: "UPCOMING",
        registration_close_at: FUTURE,
        start_at: FUTURE,
      }),
    );

    await syncTournamentState(connection, 5);

    expect(queueBotLog).not.toHaveBeenCalled();
  });

  it("ne réserve rien sur un tournoi déjà en cours", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(row({ state: "RUNNING" }));

    await syncTournamentState(connection, 5);

    expect(queueBotLog).not.toHaveBeenCalled();
  });

  it("n'annonce aucun lancement pour un tournoi clos faute d'adversaires", async () => {
    // La clôture sur-le-champ précède toute initialisation : elle sort de la
    // synchronisation avant même que l'état ne bascule, et c'est
    // `finalizeUnderfilledTournament` qui pose sa propre ligne.
    jest.mocked(finalizeUnderfilledTournament).mockResolvedValue(true);
    jest.mocked(loadTournamentRow).mockResolvedValue(row());

    await syncTournamentState(connection, 5);

    expect(queueBotLog).not.toHaveBeenCalled();
  });
});
