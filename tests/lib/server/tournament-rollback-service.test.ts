import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/bg-survie");
jest.mock("@/lib/server/tournaments/phases");
jest.mock("@/lib/server/tournaments/phases-repository");
jest.mock("@/lib/server/tournaments/repository");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/bot-logs");

import { getDatabase } from "@/lib/server/database";
import { rollbackCurrentRound } from "@/lib/server/tournaments/rollback";
import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { reconcilePhases } from "@/lib/server/tournaments/phases";
import { loadPhases } from "@/lib/server/tournaments/phases-repository";
import { resetRegistrationRanks } from "@/lib/server/tournaments/repository";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";
import type { PhaseFormat, TournamentFormat, TournamentState } from "@/lib/shared/types";

type MatchSeed = {
  id: number;
  round_number: number;
  bracket?: string;
  phase_id?: number;
  phase_position?: number | null;
  team1_id?: number | null;
  team2_id?: number | null;
  team1_score?: number | null;
  team2_score?: number | null;
  winner_team_id?: number | null;
  forfeit_team_id?: number | null;
  status?: string;
  next_winner_match_id?: number | null;
  next_loser_match_id?: number | null;
};

/** Ligne complète telle que la lit `loadRollbackMatches`. */
function row(seed: MatchSeed) {
  return {
    bracket: "UPPER",
    phase_id: 0,
    phase_position: null,
    team1_id: 10,
    team2_id: 20,
    team1_score: null,
    team2_score: null,
    winner_team_id: null,
    forfeit_team_id: null,
    status: "READY",
    team1_reported_at: null,
    team2_reported_at: null,
    next_winner_match_id: null,
    next_loser_match_id: null,
    ...seed,
  };
}

/** Une rencontre jouée : deux scores, un vainqueur, close. */
function playedRow(seed: MatchSeed) {
  return row({
    team1_score: 3,
    team2_score: 1,
    winner_team_id: 10,
    status: "COMPLETED",
    ...seed,
  });
}

type ExecuteMock = jest.Mock;

/** Requêtes émises, normalisées sur une ligne. */
function statements(execute: ExecuteMock): string[] {
  return execute.mock.calls.map((call) => String((call as [string])[0]).replace(/\s+/g, " ").trim());
}

/** Toutes les requêtes contenant `needle`, avec leurs paramètres. */
function statementsWith(execute: ExecuteMock, needle: string): Array<[string, unknown[]]> {
  return execute.mock.calls
    .filter((entry) =>
      String((entry as [string])[0])
        .replace(/\s+/g, " ")
        .includes(needle),
    )
    .map((entry) => {
      const call = entry as [string, unknown[]];
      return [call[0].replace(/\s+/g, " ").trim(), call[1] ?? []] as [string, unknown[]];
    });
}

/** Requête (SQL + paramètres) dont le texte contient `needle`. */
function statementWith(execute: ExecuteMock, needle: string): [string, unknown[]] | undefined {
  return statementsWith(execute, needle)[0];
}

function setup(options: {
  format: TournamentFormat;
  matches: ReturnType<typeof row>[];
  state?: TournamentState;
  name?: string;
  missing?: boolean;
  phases?: Array<{ id: number; position: number; format: PhaseFormat }>;
  /** Rencontres d'arbre final restant après suppression (BG Survie). */
  remainingPlayoffMatches?: number;
}) {
  const execute = jest.fn(async (sql: string) => {
    if (/SELECT id, name, format FROM bg_tournaments/.test(sql)) {
      return [
        options.missing
          ? []
          : [{ id: 7, name: options.name ?? "BlueGenji Open", format: options.format }],
      ];
    }
    if (/COUNT\(\*\) AS remaining/.test(sql)) {
      return [[{ remaining: options.remainingPlayoffMatches ?? 0 }]];
    }
    if (/LEFT JOIN bg_tournament_phases/.test(sql)) return [options.matches];
    return [{ affectedRows: 1 }];
  }) as unknown as ExecuteMock;

  const connection = {
    execute,
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  (getDatabase as jest.Mock).mockResolvedValue({
    execute: jest.fn(),
    getConnection: jest.fn(async () => connection),
  } as never);
  (syncTournamentState as jest.Mock).mockResolvedValue({
    row: options.missing ? null : { id: 7, state: options.state ?? "RUNNING" },
    stateChanged: false,
  } as never);
  (loadPhases as jest.Mock).mockResolvedValue((options.phases ?? []) as never);

  return { execute, connection };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of [
    tryAutoResolveByes,
    reconcileSurvival,
    reconcileSwiss,
    reconcileEndurance,
    reconcilePhases,
    resetRegistrationRanks,
  ]) {
    (fn as jest.Mock).mockResolvedValue(undefined as never);
  }
});

describe("rollbackCurrentRound — gardes", () => {
  it("refuse un tournoi inconnu", async () => {
    setup({ format: "SWISS", matches: [], missing: true });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("refuse un tournoi qui n'a pas commencé", async () => {
    // Rien n'y a été joué : il n'a aucune manche à défaire, et le refus le dit
    // mieux qu'un « plus rien à défaire » qui laisserait croire à un terminus.
    const { connection } = setup({
      format: "SWISS",
      state: "REGISTRATION",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("ROLLBACK_TOURNAMENT_NOT_STARTED");
    expect(connection.rollback).toHaveBeenCalled();
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("verrouille la ligne du tournoi en toute première instruction", async () => {
    // Sous `REPEATABLE READ`, c'est la première lecture ordinaire qui fige
    // l'instantané : une lecture du plateau placée avant le verrou rendrait le
    // plateau d'avant l'attente.
    const { execute } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    expect(statements(execute)[0]).toContain("FOR UPDATE");
  });

  it("remonte le refus du module pur quand plus rien n'est saisi", async () => {
    const { connection } = setup({
      format: "SWISS",
      matches: [row({ id: 1, round_number: 1 })],
    });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("ROLLBACK_NOTHING_TO_UNDO");
    expect(connection.rollback).toHaveBeenCalled();
  });

  it("refuse quand le stade a bougé depuis l'écran", async () => {
    // Le dialogue *montre* les rencontres qu'il efface : effacer les autres
    // serait effacer des scores que personne n'a vus.
    const { connection } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 }), playedRow({ id: 2, round_number: 2 })],
    });

    await expect(rollbackCurrentRound(7, { expectedStage: "0:1" })).rejects.toThrow(
      "ROLLBACK_ROUND_CHANGED",
    );
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("accepte le stade que l'écran a annoncé", async () => {
    const { connection } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 }), playedRow({ id: 2, round_number: 2 })],
    });

    const result = await rollbackCurrentRound(7, { expectedStage: "0:2" });

    expect(result.stageKey).toBe("0:2");
    expect(connection.commit).toHaveBeenCalled();
  });

  it("s'en remet à la base sans stade annoncé", async () => {
    const { connection } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    expect(connection.commit).toHaveBeenCalled();
  });
});

describe("rollbackCurrentRound — écritures", () => {
  it("vide les rencontres du stade sans toucher aux engagées", async () => {
    // Elles vont se rejouer entre les mêmes équipes, à la même heure, sur la
    // même chaîne : seul ce qui a été *saisi* part.
    const { execute } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 }), playedRow({ id: 2, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    const cleared = statementWith(execute, "SET team1_score = NULL");
    expect(cleared?.[0]).toContain("winner_team_id = NULL");
    expect(cleared?.[0]).toContain("forfeit_team_id = NULL");
    expect(cleared?.[0]).toContain("score_deadline_at = NULL");
    expect(cleared?.[0]).not.toContain("team1_id = NULL");
    expect(cleared?.[0]).not.toContain("start_at");
    expect(cleared?.[1]).toEqual([1, 2]);
  });

  it("recalcule le statut sur les engagées, pour ne pas rendre un bye jouable", async () => {
    const { execute } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    const cleared = statementWith(execute, "SET team1_score = NULL");
    expect(cleared?.[0]).toContain(
      "status = CASE WHEN team1_id IS NOT NULL AND team2_id IS NOT NULL THEN 'READY' ELSE 'PENDING' END",
    );
  });

  it("détache la suite d'un plateau au lieu de la supprimer", async () => {
    const { execute } = setup({
      format: "SINGLE",
      matches: [
        playedRow({ id: 1, round_number: 1, next_winner_match_id: 3 }),
        playedRow({ id: 2, round_number: 1, next_winner_match_id: 3 }),
        row({ id: 3, round_number: 2 }),
      ],
    });

    await rollbackCurrentRound(7);

    const detached = statementWith(execute, "SET team1_id = NULL");
    expect(detached?.[0]).toContain("live_started_at = NULL");
    expect(detached?.[1]).toEqual([3]);
    expect(statements(execute).some((sql) => sql.startsWith("DELETE FROM bg_matches"))).toBe(false);
  });

  it("supprime les manches suivantes d'un format à classement, rappels compris", async () => {
    const { execute } = setup({
      format: "SURVIVAL",
      matches: [
        playedRow({ id: 1, round_number: 1 }),
        row({ id: 2, round_number: 2 }),
        row({ id: 3, round_number: 3 }),
      ],
    });

    await rollbackCurrentRound(7);

    expect(statementWith(execute, "DELETE FROM bg_match_reminders")?.[1]).toEqual([2, 3]);
    expect(statementWith(execute, "DELETE FROM bg_referee_alerts")?.[1]).toEqual([2, 3]);
    expect(statementWith(execute, "DELETE FROM bg_matches")?.[1]).toEqual([2, 3]);
    expect(statements(execute).some((sql) => sql.includes("SET team1_id = NULL"))).toBe(false);
  });
});

describe("rollbackCurrentRound — curseur de manche", () => {
  it.each([
    ["SWISS", "swiss_current_round"],
    ["SURVIVAL", "survival_current_round"],
    ["BG_SURVIE", "endurance_current_round"],
  ] as const)("recule le curseur d'un tournoi %s", async (format, column) => {
    // Le curseur n'est pas dérivé des matchs : le moteur pose la manche
    // « compteur + 1 ». Sans ce recul, défaire la manche 1 d'une ronde suisse à
    // huit créait une « ronde 3 » pendant que la 1 restait vierge.
    const { execute } = setup({
      format,
      matches: [playedRow({ id: 1, round_number: 2 }), row({ id: 2, round_number: 3 })],
    });

    await rollbackCurrentRound(7);

    expect(statementWith(execute, `SET ${column} = ?`)?.[1]).toEqual([2, 7]);
  });

  it("laisse le curseur tranquille sur un plateau", async () => {
    const { execute } = setup({
      format: "SINGLE",
      matches: [
        playedRow({ id: 1, round_number: 1, next_winner_match_id: 2 }),
        row({ id: 2, round_number: 2 }),
      ],
    });

    await rollbackCurrentRound(7);

    expect(statements(execute).some((sql) => sql.includes("_current_round = ?"))).toBe(false);
  });

  it("ne recule pas le curseur qualificatif sur un tour d'arbre final", async () => {
    // L'arbre vit à partir de 1000 : ramener le curseur à 1002 ferait repartir
    // la qualification mille manches plus loin.
    const { execute } = setup({
      format: "BG_SURVIE",
      remainingPlayoffMatches: 2,
      matches: [
        playedRow({ id: 1, round_number: 2 }),
        playedRow({ id: 2, round_number: PLAYOFF_ROUND_OFFSET }),
      ],
    });

    await rollbackCurrentRound(7);

    expect(statements(execute).some((sql) => sql.includes("endurance_current_round"))).toBe(false);
  });

  it("recule le curseur d'une phase sur sa propre ligne", async () => {
    const { execute } = setup({
      format: "MULTI",
      phases: [{ id: 30, position: 1, format: "SWISS" }],
      matches: [
        playedRow({ id: 1, round_number: 2, phase_id: 30, phase_position: 1 }),
        row({ id: 2, round_number: 3, phase_id: 30, phase_position: 1 }),
      ],
    });

    await rollbackCurrentRound(7);

    const cursor = statementWith(execute, "UPDATE bg_tournament_phases SET swiss_current_round");
    expect(cursor?.[1]).toEqual([2, 30]);
  });
});

describe("rollbackCurrentRound — arbre final d'endurance", () => {
  it("referme le drapeau quand l'arbre vient de disparaître", async () => {
    // Deux pas mènent ici : le premier vide le tour d'arbre, le second vise la
    // dernière manche qualificative et emporte l'arbre entier.
    const { execute } = setup({
      format: "BG_SURVIE",
      remainingPlayoffMatches: 0,
      matches: [
        playedRow({ id: 1, round_number: 2 }),
        row({ id: 2, round_number: PLAYOFF_ROUND_OFFSET }),
      ],
    });

    await rollbackCurrentRound(7);

    expect(statementWith(execute, "endurance_playoffs_started = 0")?.[1]).toEqual([7]);
  });

  it("laisse le drapeau levé tant qu'un tour reste posé", async () => {
    const { execute } = setup({
      format: "BG_SURVIE",
      remainingPlayoffMatches: 2,
      matches: [
        playedRow({ id: 1, round_number: PLAYOFF_ROUND_OFFSET }),
        row({ id: 2, round_number: PLAYOFF_ROUND_OFFSET + 1 }),
      ],
    });

    await rollbackCurrentRound(7);

    expect(statements(execute).some((sql) => sql.includes("endurance_playoffs_started"))).toBe(
      false,
    );
  });

  it("ne consulte pas l'arbre sur un autre format", async () => {
    const { execute } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    expect(statements(execute).some((sql) => sql.includes("AS remaining"))).toBe(false);
  });
});

describe("rollbackCurrentRound — multi-phases", () => {
  const phases = [
    { id: 30, position: 1, format: "SWISS" as PhaseFormat },
    { id: 31, position: 2, format: "SINGLE" as PhaseFormat },
  ];

  /** Ronde suisse jouée en phase 1, plateau posé en phase 2. */
  function twoPhaseMatches() {
    return [
      playedRow({ id: 1, round_number: 1, phase_id: 30, phase_position: 1 }),
      row({ id: 20, round_number: 1, phase_id: 31, phase_position: 2, next_winner_match_id: 21 }),
      row({ id: 21, round_number: 2, phase_id: 31, phase_position: 2 }),
    ];
  }

  it("rend la phase visée courante et la rouvre", async () => {
    const { execute } = setup({ format: "MULTI", phases, matches: twoPhaseMatches() });

    await rollbackCurrentRound(7);

    expect(
      statementWith(execute, "SET state = 'RUNNING', finished_at = NULL WHERE id")?.[1],
    ).toEqual([30]);
    expect(statementWith(execute, "SET current_phase_id = ?")?.[1]).toEqual([30, 7]);
  });

  it("efface les rangs et les qualifications de la phase rouverte", async () => {
    // Les laisser afficherait des qualifiées que plus rien ne désigne ; ils
    // seront réécrits quand la phase s'achèvera de nouveau.
    const { execute } = setup({ format: "MULTI", phases, matches: twoPhaseMatches() });

    await rollbackCurrentRound(7);

    const cleared = statementWith(execute, "UPDATE bg_tournament_phase_teams SET");
    expect(cleared?.[0]).toContain("qualified = 0");
    expect(cleared?.[1]).toEqual([30]);
  });

  it("remet à zéro les phases suivantes et leur plateau d'engagées", async () => {
    // `insertPhaseTeams` est un upsert : une ancienne liste de qualifiées
    // survivrait à la nouvelle et la phase repartirait avec des équipes que plus
    // rien ne qualifie.
    const { execute } = setup({ format: "MULTI", phases, matches: twoPhaseMatches() });

    await rollbackCurrentRound(7);

    expect(statementWith(execute, "DELETE FROM bg_tournament_phase_teams")?.[1]).toEqual([31]);
    expect(statementWith(execute, "DELETE FROM bg_swiss_standings")?.[1]).toEqual([7, 31]);
    expect(statementWith(execute, "DELETE FROM bg_survival_standings")?.[1]).toEqual([7, 31]);

    const reset = statementWith(execute, "SET state = 'PENDING'");
    expect(reset?.[0]).toContain("started_at = NULL");
    expect(reset?.[0]).toContain("bracket_size = NULL");
    expect(reset?.[0]).toContain("swiss_current_round = 0");
    expect(reset?.[1]).toEqual([31]);
  });

  it("supprime le plateau de la phase suivante", async () => {
    const { execute } = setup({ format: "MULTI", phases, matches: twoPhaseMatches() });

    await rollbackCurrentRound(7);

    expect(statementWith(execute, "DELETE FROM bg_matches")?.[1]).toEqual([20, 21]);
  });

  it("ne touche à aucune phase quand on recule à l'intérieur de la dernière", async () => {
    const { execute } = setup({
      format: "MULTI",
      phases,
      matches: [
        playedRow({ id: 1, round_number: 1, phase_id: 30, phase_position: 1 }),
        playedRow({
          id: 20,
          round_number: 1,
          phase_id: 31,
          phase_position: 2,
          next_winner_match_id: 21,
        }),
        row({ id: 21, round_number: 2, phase_id: 31, phase_position: 2 }),
      ],
    });

    await rollbackCurrentRound(7);

    expect(statements(execute).some((sql) => sql.includes("SET state = 'PENDING'"))).toBe(false);
    expect(statementWith(execute, "SET current_phase_id = ?")?.[1]).toEqual([31, 7]);
  });

  it("ne lit pas les phases d'un tournoi à format unique", async () => {
    setup({ format: "SWISS", matches: [playedRow({ id: 1, round_number: 1 })] });

    await rollbackCurrentRound(7);

    expect(loadPhases).not.toHaveBeenCalled();
  });
});

describe("rollbackCurrentRound — tournoi terminé", () => {
  const finished = {
    format: "SINGLE" as TournamentFormat,
    state: "FINISHED" as TournamentState,
    matches: [
      row({ id: 1, round_number: 1, next_winner_match_id: 2 }),
      playedRow({ id: 2, round_number: 2 }),
    ],
  };

  it("rouvre le tournoi et efface son classement final", async () => {
    // Sans cela, la seule erreur qu'on ne pouvait plus rattraper était celle de
    // la finale — exactement celle qui compte le plus.
    const { execute } = setup(finished);

    const result = await rollbackCurrentRound(7);

    expect(
      statementWith(execute, "SET state = 'RUNNING', finished_at = NULL WHERE id")?.[1],
    ).toEqual([7]);
    expect(resetRegistrationRanks).toHaveBeenCalledWith(expect.anything(), 7);
    expect(result.reopenedTournament).toBe(true);
  });

  it("rouvre avant d'écrire, pour que la réconciliation voie un tournoi en cours", async () => {
    const { execute } = setup(finished);

    await rollbackCurrentRound(7);

    const sqls = statements(execute);
    const reopenAt = sqls.findIndex((sql) => sql.includes("state = 'RUNNING', finished_at = NULL"));
    const clearAt = sqls.findIndex((sql) => sql.includes("SET team1_score = NULL"));
    expect(reopenAt).toBeGreaterThanOrEqual(0);
    expect(reopenAt).toBeLessThan(clearAt);
  });

  it("ne rouvre rien sur un tournoi déjà en cours", async () => {
    const { execute } = setup({ ...finished, state: "RUNNING" });

    const result = await rollbackCurrentRound(7);

    expect(statements(execute).some((sql) => sql.includes("state = 'RUNNING'"))).toBe(false);
    expect(resetRegistrationRanks).not.toHaveBeenCalled();
    expect(result.reopenedTournament).toBe(false);
  });
});

describe("rollbackCurrentRound — entretien et diffusion", () => {
  it("rejoue la chaîne de réconciliation d'une correction de score", async () => {
    // Aucun mode n'a de branche « retour en arrière » : les trois formats à
    // classement rejouent depuis l'historique des matchs, il suffit d'effacer.
    const { connection } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    expect(tryAutoResolveByes).toHaveBeenCalledWith(connection, 7);
    expect(reconcileSurvival).toHaveBeenCalledWith(7, connection);
    expect(reconcileSwiss).toHaveBeenCalledWith(7, connection);
    expect(reconcileEndurance).toHaveBeenCalledWith(7, connection);
    expect(reconcilePhases).toHaveBeenCalledWith(7, connection);
  });

  it("publie une seule fois, après le commit", async () => {
    // `publishUpdatedEvent` vide déjà l'instantané, l'aperçu, les listes, les
    // agrégats et le classement du site : une invalidation de plus ici donnerait
    // à croire que ce module a une règle de cache à lui.
    const { connection } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    expect(connection.commit).toHaveBeenCalled();
    expect(publishUpdatedEvent).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
    expect(flushBotLogs).toHaveBeenCalledWith(connection);
  });

  it("ne publie ni ne journalise quand la transaction échoue", async () => {
    const { connection, execute } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });
    (execute as jest.Mock).mockImplementation(async (sql: string) => {
      if (/SELECT id, name, format FROM bg_tournaments/.test(sql)) {
        return [[{ id: 7, name: "BlueGenji Open", format: "SWISS" }]];
      }
      if (/LEFT JOIN bg_tournament_phases/.test(sql)) {
        return [[playedRow({ id: 1, round_number: 1 })]];
      }
      throw new Error("Deadlock found when trying to get lock");
    });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("Deadlock");
    expect(connection.rollback).toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
    expect(flushBotLogs).not.toHaveBeenCalled();
  });

  it("rend la connexion au pool quoi qu'il arrive", async () => {
    const { connection } = setup({ format: "SWISS", matches: [], missing: true });

    await expect(rollbackCurrentRound(7)).rejects.toThrow();
    expect(connection.release).toHaveBeenCalled();
  });
});

describe("rollbackCurrentRound — compte rendu", () => {
  it("nomme le stade défait et compte ses rencontres", async () => {
    const { execute } = setup({
      format: "SWISS",
      name: "BlueGenji Open",
      matches: [playedRow({ id: 1, round_number: 4 }), playedRow({ id: 2, round_number: 4 })],
    });

    const result = await rollbackCurrentRound(7);

    expect(result).toMatchObject({
      tournamentId: 7,
      tournamentName: "BlueGenji Open",
      stageKey: "0:4",
      roundNumber: 4,
      phaseRank: 0,
      label: "la manche 4",
      clearedMatches: 2,
      reopenedTournament: false,
    });
    expect(statementsWith(execute, "SET team1_score = NULL")).toHaveLength(1);
  });

  it("nomme un tour d'arbre final par son rang", async () => {
    setup({
      format: "BG_SURVIE",
      remainingPlayoffMatches: 2,
      matches: [playedRow({ id: 1, round_number: PLAYOFF_ROUND_OFFSET + 1 })],
    });

    const result = await rollbackCurrentRound(7);

    expect(result.label).toBe("le tour 2 des play-offs");
  });

  it("nomme la phase d'un tournoi multi-phases", async () => {
    setup({
      format: "MULTI",
      phases: [{ id: 31, position: 2, format: "SWISS" }],
      matches: [playedRow({ id: 1, round_number: 3, phase_id: 31, phase_position: 2 })],
    });

    const result = await rollbackCurrentRound(7);

    expect(result.label).toBe("la manche 3 de la phase 2");
    expect(result.phaseRank).toBe(2);
  });

  it("nomme le stade d'un plateau par son rang, pas par son numéro de manche", async () => {
    // En double élimination, « manche 2 » désigne deux stades sans rapport : le
    // libellé compte les stades du plateau entier.
    setup({
      format: "DOUBLE",
      matches: [
        row({ id: 1, round_number: 1, next_winner_match_id: 3, next_loser_match_id: 4 }),
        row({ id: 2, round_number: 1, next_winner_match_id: 3, next_loser_match_id: 4 }),
        playedRow({ id: 3, round_number: 2, next_winner_match_id: 6, next_loser_match_id: 5 }),
        playedRow({ id: 4, round_number: 1, bracket: "LOWER", next_winner_match_id: 5 }),
        row({ id: 5, round_number: 2, bracket: "LOWER", next_winner_match_id: 6 }),
        row({ id: 6, round_number: 1, bracket: "GRAND" }),
      ],
    });

    const result = await rollbackCurrentRound(7);

    expect(result.label).toBe("la manche 2");
    expect(result.clearedMatches).toBe(2);
  });
});
