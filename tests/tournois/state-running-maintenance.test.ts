import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/bracket-generator");
jest.mock("@/lib/server/tournaments/finalization");
jest.mock("@/lib/server/tournaments/byes");
// Lancement des matchs : entretien propre, hors du sujet de ces tests.
jest.mock("@/lib/server/tournaments/match-launch");

import { syncTournamentState } from "@/lib/server/tournaments/state";
import { loadTournamentRow, updateTournamentState } from "@/lib/server/tournaments/repository";
import { createBracketIfMissing } from "@/lib/server/tournaments/bracket-generator";
import {
  finalizeTournamentIfDone,
  resolveExpiredScoreReports,
} from "@/lib/server/tournaments/finalization";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { maintainMatchLaunches } from "@/lib/server/tournaments/match-launch";
import type { TournamentRow } from "@/lib/server/tournaments/_internal";
import type { RowOverrides } from "../helpers/row-overrides";
import { tournamentRow } from "../helpers/tournament-rows";

/**
 * Tournoi déjà en cours : les dates sont dans le passé, donc `computeTournamentState`
 * renvoie RUNNING et aucune transition n'a lieu — on isole l'entretien passif.
 */
function runningRow(overrides: RowOverrides<TournamentRow> = {}): TournamentRow {
  const past = new Date(Date.now() - 86_400_000);
  return tournamentRow({
    id: 5,
    state: "RUNNING",
    format: "SINGLE",
    finished_at: null,
    registration_open_at: past,
    registration_close_at: past,
    start_at: past,
    bracket_size: null,
    ...overrides,
  });
}

const connection = {} as never;

describe("syncTournamentState — entretien d'un tournoi en cours", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createBracketIfMissing).mockResolvedValue({ finished: false, created: false });
    jest.mocked(resolveExpiredScoreReports).mockResolvedValue(0);
    jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
    jest.mocked(finalizeTournamentIfDone).mockResolvedValue(undefined);
    jest.mocked(maintainMatchLaunches).mockResolvedValue(0);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each<TournamentRow["format"]>(["SINGLE", "DOUBLE"])(
    "génère le plateau manquant d'un tournoi %s en cours",
    async (format) => {
      const row = runningRow({ format });
      jest.mocked(loadTournamentRow).mockResolvedValue(row);

      await syncTournamentState(connection, 5);

      expect(createBracketIfMissing).toHaveBeenCalledWith(connection, row as never);
      // Sans transition d'état, rien ne doit être réécrit sur le tournoi.
      expect(updateTournamentState).not.toHaveBeenCalled();
    },
  );

  it.each<TournamentRow["format"]>(["SWISS", "SURVIVAL", "MULTI"])(
    "ne construit aucun plateau pour un tournoi %s (orchestration dédiée)",
    async (format) => {
      jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ format }));

      await syncTournamentState(connection, 5);

      expect(createBracketIfMissing).not.toHaveBeenCalled();
    },
  );

  it("tranche les reports expirés, résout les byes puis finalise", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow());

    await syncTournamentState(connection, 5);

    expect(resolveExpiredScoreReports).toHaveBeenCalledWith(connection, 5);
    expect(tryAutoResolveByes).toHaveBeenCalledWith(connection, 5);
    expect(finalizeTournamentIfDone).toHaveBeenCalledWith(connection, 5);
  });

  it("renvoie la ligne rechargée après entretien", async () => {
    const before = runningRow();
    const after = runningRow({ bracket_size: 8 });
    jest.mocked(loadTournamentRow)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(after);

    const result = await syncTournamentState(connection, 5);

    expect(result.row).toBe(after);
    expect(result.stateChanged).toBe(false);
  });

  // Un lancement ne change que le plateau de ce tournoi. Compté dans
  // `contentChanged`, il faisait publier une mise à jour complète — liste
  // publique, vitrine et classement du site vidés à l'heure de chaque manche.
  it("signale un lancement à part, sans le compter comme un changement de contenu", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ bracket_size: 8 }));
    jest.mocked(maintainMatchLaunches).mockResolvedValue(2);

    const result = await syncTournamentState(connection, 5);

    expect(result.launchesChanged).toBe(true);
    expect(result.contentChanged).toBe(false);
  });

  it("garde `contentChanged` pour une manche tranchée par le délai", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(runningRow({ bracket_size: 8 }));
    jest.mocked(resolveExpiredScoreReports).mockResolvedValue(1);

    const result = await syncTournamentState(connection, 5);

    expect(result.contentChanged).toBe(true);
    expect(result.launchesChanged).toBe(false);
  });

  it("ne touche à rien tant que le tournoi n'a pas démarré", async () => {
    const future = new Date(Date.now() + 86_400_000);
    jest.mocked(loadTournamentRow).mockResolvedValue(
      runningRow({
        state: "UPCOMING",
        registration_open_at: future,
        registration_close_at: future,
        start_at: future,
      }),
    );

    await syncTournamentState(connection, 5);

    expect(createBracketIfMissing).not.toHaveBeenCalled();
    expect(tryAutoResolveByes).not.toHaveBeenCalled();
    expect(finalizeTournamentIfDone).not.toHaveBeenCalled();
  });

  it("laisse les modes auto-pilotés clore eux-mêmes leur tournoi", () => {
    // Régression : la finalisation générique doit refuser de trancher pour les
    // formats qui écrivent leur propre classement final — sinon un instant où
    // tous les matchs sont terminés suffirait à clore le tournoi et à écraser
    // leur classement.
    const source = readFileSync(
      join(__dirname, "..", "..", "lib", "server", "tournaments", "finalization.ts"),
      "utf8",
    );
    for (const format of ["SURVIVAL", "SWISS", "MULTI", "BG_SURVIE"]) {
      expect(source).toMatch(new RegExp(`format === "${format}"`));
    }
  });

  it("renvoie null pour un tournoi inconnu", async () => {
    jest.mocked(loadTournamentRow).mockResolvedValue(null);

    const result = await syncTournamentState(connection, 5);

    expect(result).toEqual({
      row: null,
      stateChanged: false,
      contentChanged: false,
      launchesChanged: false,
    });
    expect(createBracketIfMissing).not.toHaveBeenCalled();
  });
});

describe("syncTournamentState — ce que `stateChanged` doit rapporter", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(createBracketIfMissing).mockResolvedValue({ finished: false, created: false });
    jest.mocked(resolveExpiredScoreReports).mockResolvedValue(0);
    jest.mocked(tryAutoResolveByes).mockResolvedValue(undefined);
    jest.mocked(finalizeTournamentIfDone).mockResolvedValue(undefined);
    jest.mocked(maintainMatchLaunches).mockResolvedValue(0);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("signale la clôture décidée par l'entretien lui-même", async () => {
    // `finalizeTournamentIfDone` peut passer le tournoi à FINISHED bien après la
    // comparaison d'entrée. Ses appelants s'appuient sur ce drapeau pour
    // rafraîchir la liste publique : sans lui, un tournoi clos par un bye résolu
    // à la lecture resterait annoncé « En cours » — et le reclassement client ne
    // rattrape pas ce cas, une clôture ne se déduisant d'aucune date.
    const before = runningRow();
    jest.mocked(loadTournamentRow)
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce({ ...before, state: "FINISHED" });

    const result = await syncTournamentState(connection, 5);

    expect(result.stateChanged).toBe(true);
    expect(result.row?.state).toBe("FINISHED");
  });

  it("ne signale rien quand l'entretien n'a rien changé", async () => {
    const row = runningRow();
    jest.mocked(loadTournamentRow)
      .mockResolvedValueOnce(row)
      .mockResolvedValueOnce(row);

    expect((await syncTournamentState(connection, 5)).stateChanged).toBe(false);
  });

  it("supporte un tournoi disparu pendant l'entretien", async () => {
    // La relecture peut ne rien rendre (suppression concurrente) : on ne doit ni
    // lever, ni annoncer un changement d'état imaginaire.
    jest.mocked(loadTournamentRow)
      .mockResolvedValueOnce(runningRow())
      .mockResolvedValueOnce(null);

    const result = await syncTournamentState(connection, 5);

    expect(result.row).toBeNull();
    expect(result.stateChanged).toBe(false);
  });
});
