import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/snapshot");
jest.mock("@/lib/server/tournaments/round-maps-notice");

import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { invalidateSpectatorSnapshot } from "@/lib/server/tournaments/snapshot";
import { queueRoundMapsNotice, scheduleRoundMapsNotice } from "@/lib/server/tournaments/round-maps-notice";
import { loadEditableTournament, updateTournament } from "@/lib/server/tournaments/edit";
import { fakePool } from "../../helpers/sql-double";

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
    game: "OW",
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
/** Phases lues pour un tournoi MULTI. Vide par défaut : la plupart des cas sont mono-format. */
let phaseRowsToReturn: Record<string, unknown>[] = [];
/** Matchs lus par le verrou des points par carte (`assertMapPointsUnlocked`). */
let matchRowsToReturn: Record<string, unknown>[] = [];
let roundMapRowsToReturn: Record<string, unknown>[] = [];

const connection = {
  beginTransaction: jest.fn(async () => undefined),
  commit: jest.fn(async () => undefined),
  rollback: jest.fn(async () => undefined),
  release: jest.fn(() => undefined),
  execute: jest.fn(async (sql: string, params: unknown[] = []) => {
    executed.push({ sql, params });
    if (/^\s*SELECT[\s\S]*FROM bg_tournament_round_maps/i.test(sql)) return [roundMapRowsToReturn];
    if (/FROM bg_tournaments/i.test(sql)) return [rowToReturn ? [rowToReturn] : []];
    if (/FROM bg_tournament_phases/i.test(sql)) return [phaseRowsToReturn];
    if (/FROM bg_match_maps/i.test(sql)) return [[]];
    if (/FROM bg_matches/i.test(sql)) return [matchRowsToReturn];
    return [{ affectedRows: 1, insertId: 1 }];
  }),
};

beforeEach(() => {
  executed.length = 0;
  rowToReturn = hiddenRow();
  phaseRowsToReturn = [];
  matchRowsToReturn = [];
  roundMapRowsToReturn = [];
  jest.clearAllMocks();
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    getConnection: async () => connection,
    execute: connection.execute,
  }));
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

  // L'option ne fait pas partie des valeurs éditables (route dédiée), mais le
  // formulaire doit la préremplir — et savoir si elle est encore réglable.
  it("rend l'état et l'option de planification à côté des valeurs", async () => {
    rowToReturn = hiddenRow({ state: "RUNNING", referee_scheduling: 1 });
    const loaded = await loadEditableTournament(1);
    expect(loaded?.state).toBe("RUNNING");
    expect(loaded?.refereeScheduling).toBe(true);
    expect(loaded?.window).toBe("LOCKED");
    expect(executed.some((q) => /referee_scheduling/.test(q.sql))).toBe(true);
  });

  it("lit l'option éteinte par défaut", async () => {
    rowToReturn = hiddenRow({ referee_scheduling: 0 });
    expect((await loadEditableTournament(1))?.refereeScheduling).toBe(false);
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

  it("repousse la visibilité dans le futur : évince la réponse publique et la carte d'encart", async () => {
    await updateTournament(1, { startVisibilityAt: new Date(Date.now() + 24 * HOUR).toISOString() });
    expect(invalidateSpectatorSnapshot).toHaveBeenCalledTimes(1);
    expect(invalidateSpectatorSnapshot).toHaveBeenCalledWith(1);
  });

  it("updateTournament_visibleTournamentDescriptionEdit_evictsSpectatorCopy", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });

    await updateTournament(1, { description: "Description corrigée" });

    expect(invalidateSpectatorSnapshot).toHaveBeenCalledTimes(1);
    expect(invalidateSpectatorSnapshot).toHaveBeenCalledWith(1);
  });

  it("updateTournament_refusedEdit_evictsNothing", async () => {
    rowToReturn = null;

    await expect(updateTournament(1, { name: "Autre nom" })).rejects.toThrow("TOURNAMENT_NOT_FOUND");

    expect(invalidateSpectatorSnapshot).not.toHaveBeenCalled();
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

  it("laisse les phases tranquilles quand le patch ne les concerne pas", async () => {
    // Renommer un tournoi MULTI reposait ses phases à neuf — un DELETE + INSERT
    // pour un résultat identique. Le DELETE n'est sûr que parce qu'aucune phase
    // n'est en cours d'usage tant que le tournoi n'est pas RUNNING, et aucune
    // clé étrangère ne protège cet invariant : ne pas y toucher hors de propos
    // réduit d'autant la surface de cette dépendance.
    rowToReturn = hiddenRow({ format: "MULTI" });
    phaseRowsToReturn = [
      {
        position: 1,
        name: null,
        format: "SWISS",
        qualifier_mode: "COUNT",
        qualifier_value: 4,
        has_third_place_match: 0,
        swiss_total_rounds: 3,
        survival_rounds_before_first_cut: null,
        survival_rounds_per_cut: null,
      },
      {
        position: 2,
        name: null,
        format: "DOUBLE",
        qualifier_mode: "COUNT",
        qualifier_value: 1,
        has_third_place_match: 0,
        swiss_total_rounds: null,
        survival_rounds_before_first_cut: null,
        survival_rounds_per_cut: null,
      },
    ];

    await updateTournament(1, { name: "Nouveau nom" });

    expect(executed.some((q) => /DELETE FROM bg_tournament_phases/i.test(q.sql))).toBe(false);
    expect(executed.some((q) => /INSERT INTO bg_tournament_phases/i.test(q.sql))).toBe(false);
    // Le reste de la mise à jour a bien eu lieu.
    expect(executed.some((q) => /UPDATE bg_tournaments/i.test(q.sql))).toBe(true);
  });

  it("neutralise la petite finale quand le format quitte SINGLE", async () => {
    // La règle ne vivait que dans `createTournament` : une édition la laissait
    // cochée en base, et `rankEliminationPhase` la relit aussi en DOUBLE.
    rowToReturn = hiddenRow({ has_third_place_match: 1 });

    await updateTournament(1, { format: "DOUBLE" });

    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    // La petite finale est le 11e paramètre du `SET`, juste après les dates.
    expect(update?.params[10]).toBe(0);
  });

  it("ne publie rien quand la transaction échoue", async () => {
    rowToReturn = null;
    await expect(updateTournament(1, { name: "X" })).rejects.toThrow();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});

describe("phase de lancement des matchs", () => {
  const indexOf = (sql: string) => sql.split("?").findIndex((part) => /match_launch_phase = $/.test(part));

  it("se lit éteinte sur une ligne migrée (défaut 0)", async () => {
    rowToReturn = hiddenRow({ match_launch_phase: 0 });
    expect((await loadEditableTournament(1))?.values.launchPhase).toBe(false);
    expect(executed.some((q) => /match_launch_phase/.test(q.sql))).toBe(true);
  });

  it("se lit allumée", async () => {
    rowToReturn = hiddenRow({ match_launch_phase: 1 });
    expect((await loadEditableTournament(1))?.values.launchPhase).toBe(true);
  });

  it("s'allume et s'éteint à l'édition", async () => {
    rowToReturn = hiddenRow({ match_launch_phase: 0 });
    await updateTournament(1, { launchPhase: true });
    let update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    expect(update!.params[indexOf(update!.sql)]).toBe(1);
    executed.length = 0;
    rowToReturn = hiddenRow({ match_launch_phase: 1 });
    await updateTournament(1, { launchPhase: false });
    update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    expect(update!.params[indexOf(update!.sql)]).toBe(0);
  });

  it("reste modifiable sur un tournoi publié, avant son départ", async () => {
    rowToReturn = hiddenRow({ start_visibility_at: past });
    await expect(updateTournament(1, { launchPhase: true })).resolves.toEqual({ previousName: "Coupe test", name: "Coupe test" });
  });

  it.each(["RUNNING", "FINISHED"])("est figée sur un tournoi %s, sans rien écrire", async (state) => {
    rowToReturn = hiddenRow({ state, start_visibility_at: past });
    await expect(updateTournament(1, { launchPhase: true })).rejects.toThrow("TOURNAMENT_LOCKED");
    expect(executed.some((q) => /UPDATE bg_tournaments/i.test(q.sql))).toBe(false);
  });
});

describe("sortie anticipée « hors course » (BG Survie)", () => {
  const bgsRow = (over: Record<string, unknown> = {}) =>
    hiddenRow({ format: "BG_SURVIE", endurance_max_rounds: 5, ...over });

  it("se lit éteinte sur une ligne d'avant la colonne (défaut 0)", async () => {
    rowToReturn = bgsRow({ endurance_early_exit: 0 });
    expect((await loadEditableTournament(1))?.values.enduranceEarlyExit).toBe(false);
    expect(executed.some((q) => /endurance_early_exit/.test(q.sql))).toBe(true);
  });

  it("se lit allumée", async () => {
    rowToReturn = bgsRow({ endurance_early_exit: 1 });
    expect((await loadEditableTournament(1))?.values.enduranceEarlyExit).toBe(true);
  });

  it("s'écrit à l'édition", async () => {
    rowToReturn = bgsRow({ endurance_early_exit: 0 });
    await updateTournament(1, { enduranceEarlyExit: true });
    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    expect(update!.sql).toMatch(/endurance_early_exit = \?/);
    const index = update!.sql.split("?").findIndex((part) => /endurance_early_exit = $/.test(part));
    expect(update!.params[index]).toBe(1);
  });

  it("se décoche à l'édition", async () => {
    rowToReturn = bgsRow({ endurance_early_exit: 1 });
    await updateTournament(1, { enduranceEarlyExit: false });
    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    const index = update!.sql.split("?").findIndex((part) => /endurance_early_exit = $/.test(part));
    expect(update!.params[index]).toBe(0);
  });

  // Comme le reste du barème d'endurance : figée dès la publication.
  it("est refusée sur un tournoi publié", async () => {
    rowToReturn = bgsRow({ start_visibility_at: past });
    await expect(updateTournament(1, { enduranceEarlyExit: true })).rejects.toThrow(
      "FIELD_NOT_EDITABLE:enduranceEarlyExit",
    );
  });

  // Allumée en pleine qualification, elle écarterait des équipes au prochain
  // rejeu : un tournoi lancé ou terminé la refuse, sans rien écrire.
  it.each(["RUNNING", "FINISHED"])("est refusée sur un tournoi %s, sans rien écrire", async (state) => {
    rowToReturn = bgsRow({ state, start_visibility_at: past });
    await expect(updateTournament(1, { enduranceEarlyExit: true })).rejects.toThrow("TOURNAMENT_LOCKED");
    expect(executed.some((q) => /UPDATE bg_tournaments/i.test(q.sql))).toBe(false);
  });
});

describe("updateTournament — format Duel / Arcade", () => {
  const scored = { id: 9, team1_score: null, team2_score: null, team1_reported_at: new Date(), team2_reported_at: null };

  it("updateTournament_duelTurnedOnDuringRegistration_writesTarget", async () => {
    rowToReturn = hiddenRow({ state: "REGISTRATION", start_visibility_at: past });

    await updateTournament(1, { mapPointTarget: 5 });

    const update = executed.find((q) => /UPDATE bg_tournaments/i.test(q.sql));
    expect(update!.sql).toMatch(/map_point_target = \?/);
    expect(update!.params).toContain(5);
  });

  it("updateTournament_matchFormatDuringRegistration_editable", async () => {
    rowToReturn = hiddenRow({ state: "REGISTRATION", start_visibility_at: past, match_format_type: "BO", match_format_value: 9 });

    await expect(updateTournament(1, { matchFormat: { type: "BO", value: 1 }, mapPointTarget: 5 })).resolves.toBeDefined();
  });

  it("updateTournament_targetChangedWithAReport_throwsLocked", async () => {
    matchRowsToReturn = [scored];

    await expect(updateTournament(1, { mapPointTarget: 5 })).rejects.toThrow("MAP_POINTS_LOCKED");

    expect(executed.some((q) => /UPDATE bg_tournaments/i.test(q.sql))).toBe(false);
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("updateTournament_targetUnchanged_skipsTheScoreLock", async () => {
    matchRowsToReturn = [scored];
    rowToReturn = hiddenRow({ map_point_target: 5 });

    await updateTournament(1, { name: "Autre nom", mapPointTarget: 5 });

    expect(executed.some((q) => /FROM bg_matches/i.test(q.sql))).toBe(false);
  });

  it("updateTournament_invalidTarget_throwsInvalidMapPointTarget", async () => {
    await expect(updateTournament(1, { mapPointTarget: 0 })).rejects.toThrow("INVALID_MAP_POINT_TARGET");
  });

  it("updateTournament_duelTurnedOff_clearsRoundTargets", async () => {
    rowToReturn = hiddenRow({ map_point_target: 5 });

    await updateTournament(1, { mapPointTarget: null });

    const clear = executed.find((q) => /UPDATE bg_tournament_round_maps SET map_point_target = NULL/.test(q.sql));
    expect(clear!.params).toEqual([1]);
    const remove = executed.find((q) => /DELETE FROM bg_tournament_round_maps/.test(q.sql));
    expect(remove!.sql).toMatch(/slots_json = '\[\]' AND tiebreak_map IS NULL AND map_point_target IS NULL/);
  });

  it("updateTournament_duelTurnedOff_announcesEachClearedRound", async () => {
    rowToReturn = hiddenRow({ map_point_target: 5 });
    roundMapRowsToReturn = [{ phase_id: 0, bracket: "UPPER", round_number: 3, map_point_target: 7 }];

    await updateTournament(1, { mapPointTarget: null });

    expect(jest.mocked(queueRoundMapsNotice)).toHaveBeenCalledWith(
      expect.anything(),
      1,
      [expect.objectContaining({ phaseId: 0, bracket: "UPPER", roundNumber: 3 })],
      { points: true },
    );
    expect(jest.mocked(scheduleRoundMapsNotice)).toHaveBeenCalledTimes(1);
  });

  it("updateTournament_duelTurnedOffWithoutRoundTargets_schedulesNothing", async () => {
    rowToReturn = hiddenRow({ map_point_target: 5 });

    await updateTournament(1, { mapPointTarget: null });

    expect(jest.mocked(scheduleRoundMapsNotice)).not.toHaveBeenCalled();
  });

  it("updateTournament_formatChangedToSingle_prunesUnplayableRoundTargets", async () => {
    rowToReturn = hiddenRow({ format: "DOUBLE", map_point_target: 5 });
    roundMapRowsToReturn = [
      { phase_id: 0, bracket: "GRAND", round_number: 1, map_point_target: 7 },
      { phase_id: 0, bracket: "UPPER", round_number: 2, map_point_target: 3 },
    ];

    await updateTournament(1, { format: "SINGLE" });

    const cleared = executed.filter((q) => /UPDATE bg_tournament_round_maps SET map_point_target = NULL/.test(q.sql));
    expect(cleared).toHaveLength(1);
    expect(cleared[0].params).toEqual([1, 0, "GRAND", 1]);
    expect(executed.some((q) => /DELETE FROM bg_tournament_round_maps/.test(q.sql))).toBe(true);
    expect(jest.mocked(scheduleRoundMapsNotice)).toHaveBeenCalledTimes(1);
  });

  it("updateTournament_formatChangedAllRoundsStillPlayable_writesNothing", async () => {
    rowToReturn = hiddenRow({ format: "SINGLE", map_point_target: 5 });
    roundMapRowsToReturn = [{ phase_id: 0, bracket: "UPPER", round_number: 2, map_point_target: 3 }];

    await updateTournament(1, { format: "DOUBLE" });

    expect(executed.some((q) => /UPDATE bg_tournament_round_maps|DELETE FROM bg_tournament_round_maps/.test(q.sql))).toBe(false);
    expect(jest.mocked(queueRoundMapsNotice)).not.toHaveBeenCalled();
  });

  it("updateTournament_multiPhasesReplaced_prunesOldPhaseTargets", async () => {
    rowToReturn = hiddenRow({ format: "MULTI", map_point_target: 5 });
    phaseRowsToReturn = [{ id: 12, format: "SINGLE", has_third_place_match: 0 }];
    roundMapRowsToReturn = [
      { phase_id: 4, bracket: "UPPER", round_number: 1, map_point_target: 7 },
      { phase_id: 12, bracket: "UPPER", round_number: 1, map_point_target: 3 },
      { phase_id: 12, bracket: "THIRD_PLACE", round_number: 1, map_point_target: 3 },
    ];

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

    const cleared = executed.filter((q) => /UPDATE bg_tournament_round_maps SET map_point_target = NULL/.test(q.sql));
    expect(cleared.map((q) => q.params)).toEqual([
      [1, 4, "UPPER", 1],
      [1, 12, "THIRD_PLACE", 1],
    ]);
  });

  it("updateTournament_duelKept_leavesRoundTargets", async () => {
    rowToReturn = hiddenRow({ map_point_target: 5 });

    await updateTournament(1, { mapPointTarget: 7 });

    expect(executed.some((q) => /bg_tournament_round_maps/.test(q.sql))).toBe(false);
  });

  it("loadEditableTournament_storedTarget_readsIt", async () => {
    rowToReturn = hiddenRow({ map_point_target: 5 });

    expect((await loadEditableTournament(1))?.values.mapPointTarget).toBe(5);
  });
});
