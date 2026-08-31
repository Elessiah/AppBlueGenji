import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { loadEditableTournament, updateTournament } from "@/lib/server/tournaments/edit";

const HOUR = 3600_000;
const future = new Date(Date.now() + 48 * HOUR);
const past = new Date(Date.now() - 48 * HOUR);

/** Ligne SQL d'un tournoi encore invisible. */
function hiddenRow(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Coupe test",
    description: null,
    format: "SINGLE",
    game: "OW2",
    participant_type: "TEAM",
    max_teams: 16,
    state: "UPCOMING",
    start_visibility_at: future,
    registration_open_at: future,
    registration_close_at: new Date(future.getTime() + HOUR),
    start_at: new Date(future.getTime() + 2 * HOUR),
    has_third_place_match: 0,
    survival_rounds_before_first_cut: null,
    survival_rounds_per_cut: null,
    swiss_total_rounds: null,
    swiss_points_win: 3,
    swiss_points_draw: 1,
    swiss_points_loss: 0,
    endurance_start_points: null,
    endurance_win_delta: null,
    endurance_loss_delta: null,
    endurance_playoff_size: null,
    match_format_type: null,
    match_format_value: null,
    ...over,
  };
}

const executed: { sql: string; params: unknown[] }[] = [];
let rowToReturn: Record<string, unknown> | null;

const connection = {
  beginTransaction: jest.fn(async () => undefined),
  commit: jest.fn(async () => undefined),
  rollback: jest.fn(async () => undefined),
  release: jest.fn(() => undefined),
  execute: jest.fn(async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params });
    if (/FROM bg_tournaments/i.test(sql)) return [rowToReturn ? [rowToReturn] : []];
    if (/FROM bg_tournament_phases/i.test(sql)) return [[]];
    return [{ affectedRows: 1, insertId: 1 }];
  }),
};

beforeEach(() => {
  executed.length = 0;
  rowToReturn = hiddenRow();
  jest.clearAllMocks();
  (getDatabase as jest.Mock).mockResolvedValue({
    getConnection: async () => connection,
    execute: connection.execute,
  } as never);
});

describe("loadEditableTournament", () => {
  it("rend la fenêtre et les valeurs d'un tournoi caché", async () => {
    const loaded = await loadEditableTournament(1);
    expect(loaded?.window).toBe("FULL");
    expect(loaded?.values.name).toBe("Coupe test");
    expect(loaded?.values.maxTeams).toBe(16);
    expect(loaded?.values.swissPointsWin).toBe(3);
    expect(typeof loaded?.values.startAt).toBe("string");
  });

  it("rend RESTRICTED sur un tournoi visible", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });
    expect((await loadEditableTournament(1))?.window).toBe("RESTRICTED");
  });

  it("rend null sur un tournoi inconnu", async () => {
    rowToReturn = null;
    expect(await loadEditableTournament(1)).toBeNull();
  });
});

describe("updateTournament", () => {
  it("écrit un champ autorisé et publie l'événement une fois", async () => {
    await updateTournament(1, { name: "Nouveau nom" });
    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    expect(update).toBeDefined();
    expect(update!.params).toContain("Nouveau nom");
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(1);
  });

  it("verrouille la ligne pendant la modification", async () => {
    await updateTournament(1, { name: "X" });
    const select = executed.find((q) => /FROM bg_tournaments/i.test(q.sql));
    expect(select!.sql).toMatch(/FOR UPDATE/i);
  });

  it("refuse un tournoi inconnu", async () => {
    rowToReturn = null;
    await expect(updateTournament(1, { name: "X" })).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("refuse toute modification d'un tournoi lancé", async () => {
    rowToReturn = hiddenRow({ state: "RUNNING", start_visibility_at: past });
    await expect(updateTournament(1, { name: "X" })).rejects.toThrow("TOURNAMENT_LOCKED");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse un champ hors fenêtre en le nommant", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });
    await expect(updateTournament(1, { format: "DOUBLE" })).rejects.toThrow(
      "FIELD_NOT_EDITABLE:format",
    );
  });

  it("refuse une baisse d'effectif sur un tournoi visible", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });
    await expect(updateTournament(1, { maxTeams: 8 })).rejects.toThrow(
      "MAX_TEAMS_CANNOT_DECREASE",
    );
  });

  it("refuse une clôture au passé pendant les inscriptions", async () => {
    rowToReturn = hiddenRow({ state: "REGISTRATION", start_visibility_at: past });
    await expect(
      updateTournament(1, { registrationCloseAt: past.toISOString() }),
    ).rejects.toThrow("REGISTRATION_CLOSE_IN_PAST");
  });

  it("valide l'ordre des dates sur les valeurs résultantes", async () => {
    // Seul `startAt` change, et il passe avant la clôture conservée en base.
    await expect(
      updateTournament(1, { startAt: new Date(future.getTime() - HOUR).toISOString() }),
    ).rejects.toThrow("INVALID_DATE_ORDER");
  });

  it("valide les valeurs métier du patch", async () => {
    await expect(updateTournament(1, { maxTeams: 1 })).rejects.toThrow("INVALID_MAX_TEAMS");
  });

  it("laisse intacts les champs absents du patch", async () => {
    rowToReturn = hiddenRow({ description: "Description d'origine", max_teams: 24 });
    await updateTournament(1, { name: "Nouveau nom" });
    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql))!;
    // Ordre des colonnes de l'UPDATE : name, description, game, format,
    // participant_type, max_teams, … Les champs absents du patch sont réécrits
    // à leur valeur d'origine, pas effacés.
    expect(update.params[0]).toBe("Nouveau nom");
    expect(update.params[1]).toBe("Description d'origine");
    expect(update.params[5]).toBe(24);
  });

  it("remplace les phases d'un tournoi MULTI", async () => {
    rowToReturn = hiddenRow({ format: "MULTI" });
    await updateTournament(1, {
      format: "MULTI",
      phases: [
        {
          position: 1,
          format: "SWISS",
          name: null,
          qualifierMode: "COUNT",
          qualifierValue: 8,
          hasThirdPlaceMatch: false,
          swissTotalRounds: 4,
          survivalRoundsBeforeFirstCut: null,
          survivalRoundsPerCut: null,
        },
        {
          position: 2,
          format: "SINGLE",
          name: null,
          qualifierMode: "COUNT",
          qualifierValue: 1,
          hasThirdPlaceMatch: false,
          swissTotalRounds: null,
          survivalRoundsBeforeFirstCut: null,
          survivalRoundsPerCut: null,
        },
      ],
    });
    expect(executed.some((q) => /DELETE FROM bg_tournament_phases/i.test(q.sql))).toBe(true);
    expect(executed.some((q) => /INSERT INTO bg_tournament_phases/i.test(q.sql))).toBe(true);
  });

  it("efface les phases quand le format quitte MULTI", async () => {
    rowToReturn = hiddenRow({ format: "MULTI" });
    await updateTournament(1, { format: "SINGLE" });
    expect(executed.some((q) => /DELETE FROM bg_tournament_phases/i.test(q.sql))).toBe(true);
    expect(executed.some((q) => /INSERT INTO bg_tournament_phases/i.test(q.sql))).toBe(false);
  });

  it("ne publie rien quand la transaction échoue", async () => {
    rowToReturn = null;
    await expect(updateTournament(1, { name: "X" })).rejects.toThrow();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});
