import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/state");
jest.mock("@/lib/server/tournaments/byes");
jest.mock("@/lib/server/tournaments/survival");
jest.mock("@/lib/server/tournaments/swiss");
jest.mock("@/lib/server/tournaments/bg-survie");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/list-cache");
jest.mock("@/lib/server/tournaments/bot-logs");

import { getDatabase } from "@/lib/server/database";
import { rollbackCurrentRound } from "@/lib/server/tournaments/rollback";
import { reconcileEndurance } from "@/lib/server/tournaments/bg-survie";
import { tryAutoResolveByes } from "@/lib/server/tournaments/byes";
import { flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { invalidateTournamentLists } from "@/lib/server/tournaments/list-cache";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { syncTournamentState } from "@/lib/server/tournaments/state";
import { reconcileSurvival } from "@/lib/server/tournaments/survival";
import { reconcileSwiss } from "@/lib/server/tournaments/swiss";
import { PLAYOFF_ROUND_OFFSET } from "@/lib/shared/bg-survie";
import type { TournamentFormat, TournamentState } from "@/lib/shared/types";

type MatchSeed = {
  id: number;
  round_number: number;
  bracket?: string;
  team1_id?: number | null;
  team2_id?: number | null;
  team1_score?: number | null;
  team2_score?: number | null;
  winner_team_id?: number | null;
  forfeit_team_id?: number | null;
  status?: string;
};

/** Ligne complète telle que la lit `loadRollbackMatches`. */
function row(seed: MatchSeed) {
  return {
    bracket: "UPPER",
    team1_id: 10,
    team2_id: 20,
    team1_score: null,
    team2_score: null,
    winner_team_id: null,
    forfeit_team_id: null,
    status: "READY",
    team1_reported_at: null,
    team2_reported_at: null,
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

/** Requête (SQL + paramètres) dont le texte contient `needle`. */
function statementWith(execute: ExecuteMock, needle: string): [string, unknown[]] | undefined {
  const call = execute.mock.calls.find((entry) =>
    String((entry as [string])[0])
      .replace(/\s+/g, " ")
      .includes(needle),
  ) as [string, unknown[]] | undefined;
  if (!call) return undefined;
  return [call[0].replace(/\s+/g, " ").trim(), call[1] ?? []];
}

function setup(options: {
  format: TournamentFormat;
  matches: ReturnType<typeof row>[];
  state?: TournamentState;
  name?: string;
  missing?: boolean;
}) {
  const execute = jest.fn(async (sql: string) => {
    if (/SELECT id, name, format FROM bg_tournaments/.test(sql)) {
      return [
        options.missing
          ? []
          : [{ id: 7, name: options.name ?? "BlueGenji Open", format: options.format }],
      ];
    }
    if (/FROM bg_matches\s+WHERE tournament_id = \?/.test(sql)) return [options.matches];
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

  return { execute, connection };
}

beforeEach(() => {
  jest.clearAllMocks();
  for (const fn of [tryAutoResolveByes, reconcileSurvival, reconcileSwiss, reconcileEndurance]) {
    (fn as jest.Mock).mockResolvedValue(undefined as never);
  }
});

describe("rollbackCurrentRound — gardes", () => {
  it("refuse un tournoi inconnu", async () => {
    setup({ format: "SWISS", matches: [], missing: true });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("TOURNAMENT_NOT_FOUND");
  });

  it("refuse un tournoi qui n'est pas en cours", async () => {
    // Un tournoi terminé garde son palmarès : effacer sa finale le laisserait
    // « terminé » sans championne, et la clôture ne se rejoue pas.
    const { connection } = setup({
      format: "SWISS",
      state: "FINISHED",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("TOURNAMENT_NOT_RUNNING");
    expect(connection.commit).not.toHaveBeenCalled();
    expect(connection.rollback).toHaveBeenCalledTimes(1);
  });

  it("remonte le refus du module pur sans rien écrire", async () => {
    const { connection, execute } = setup({
      format: "DOUBLE",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("ROLLBACK_UNSUPPORTED_FORMAT");
    expect(statements(execute).join("\n")).not.toContain("UPDATE bg_matches");
    expect(connection.commit).not.toHaveBeenCalled();
  });

  it("verrouille la ligne du tournoi avant toute autre lecture", async () => {
    // Sous `REPEATABLE READ`, la première lecture ordinaire fige l'instantané :
    // lire le plateau avant le verrou le lirait tel qu'il était avant l'attente.
    const { execute } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    expect(statements(execute)[0]).toContain("FOR UPDATE");
  });
});

describe("rollbackCurrentRound — formats à classement", () => {
  it("vide la manche courante et supprime celle que le moteur avait posée", async () => {
    const { execute } = setup({
      format: "SWISS",
      matches: [
        playedRow({ id: 1, round_number: 1 }),
        playedRow({ id: 2, round_number: 2 }),
        row({ id: 3, round_number: 3 }),
      ],
    });

    const result = await rollbackCurrentRound(7);

    expect(result).toEqual({
      tournamentId: 7,
      tournamentName: "BlueGenji Open",
      roundNumber: 2,
      clearedMatches: 1,
    });

    const cleared = statementWith(execute, "SET team1_score = NULL");
    expect(cleared?.[1]).toEqual([2]);
    const deleted = statementWith(execute, "DELETE FROM bg_matches");
    expect(deleted?.[1]).toEqual([3]);
  });

  it("efface tout ce qui a été saisi, et rien de ce qui a été annoncé", async () => {
    const { execute } = setup({
      format: "SURVIVAL",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    const [sql] = statementWith(execute, "SET team1_score = NULL") ?? [""];
    for (const column of [
      "winner_team_id = NULL",
      "loser_team_id = NULL",
      "forfeit_team_id = NULL",
      "team1_reported_at = NULL",
      "team2_reported_at = NULL",
      "score_deadline_at = NULL",
    ]) {
      expect(sql).toContain(column);
    }
    // Les engagées, l'horaire et la diffusion décrivent une rencontre qui va se
    // rejouer entre les mêmes équipes : ils survivent.
    expect(sql).not.toContain("team1_id = NULL");
    expect(sql).not.toContain("start_at = NULL");
    expect(sql).not.toContain("live_started_at = NULL");
  });

  it("rend son statut à une rencontre selon ses engagées", async () => {
    // Un bye ne doit pas repasser `READY` : il s'annoncerait jouable sans
    // adversaire.
    const { execute } = setup({
      format: "SURVIVAL",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    const [sql] = statementWith(execute, "SET team1_score = NULL") ?? [""];
    expect(sql).toContain("WHEN team1_id IS NOT NULL AND team2_id IS NOT NULL THEN 'READY'");
  });

  it("emporte les rappels et les réservations d'alerte des manches supprimées", async () => {
    const { execute } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 }), row({ id: 2, round_number: 2 })],
    });

    await rollbackCurrentRound(7);

    const sql = statements(execute).join("\n");
    expect(sql).toContain("DELETE FROM bg_match_reminders WHERE match_id IN");
    expect(sql).toContain("DELETE FROM bg_referee_alerts WHERE match_id IN");
  });

  it("refuse de défaire une manche qualificative une fois l'arbre tiré", async () => {
    setup({
      format: "BG_SURVIE",
      matches: [
        playedRow({ id: 1, round_number: 4 }),
        row({ id: 2, round_number: PLAYOFF_ROUND_OFFSET }),
      ],
    });

    await expect(rollbackCurrentRound(7)).rejects.toThrow("ROLLBACK_PLAYOFFS_STARTED");
  });
});

describe("rollbackCurrentRound — élimination simple", () => {
  it("vide les qualifiées des rencontres suivantes sans les supprimer", async () => {
    const { execute } = setup({
      format: "SINGLE",
      matches: [
        playedRow({ id: 1, round_number: 1 }),
        playedRow({ id: 2, round_number: 1 }),
        row({ id: 3, round_number: 2 }),
      ],
    });

    await rollbackCurrentRound(7);

    const detached = statementWith(execute, "SET team1_id = NULL");
    expect(detached?.[1]).toEqual([3]);
    // La structure du plateau est créée au lancement : la supprimer détruirait
    // le tournoi.
    expect(statements(execute).join("\n")).not.toContain("DELETE FROM bg_matches");
  });

  it("referme l'antenne d'une affiche qui perd ses deux camps", async () => {
    const { execute } = setup({
      format: "SINGLE",
      matches: [playedRow({ id: 1, round_number: 1 }), row({ id: 2, round_number: 2 })],
    });

    await rollbackCurrentRound(7);

    const [sql] = statementWith(execute, "SET team1_id = NULL") ?? [""];
    expect(sql).toContain("live_started_at = NULL");
  });
});

describe("rollbackCurrentRound — après l'écriture", () => {
  it("rejoue le tournoi par la chaîne ordinaire, puis publie", async () => {
    const { connection } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });

    await rollbackCurrentRound(7);

    // Aucun mode n'a de branche « retour en arrière » : les trois
    // réconciliations rejouent depuis l'historique des matchs, et celle qui ne
    // concerne pas le format sort d'elle-même.
    expect(tryAutoResolveByes).toHaveBeenCalledWith(connection, 7);
    expect(reconcileSurvival).toHaveBeenCalledWith(7, connection);
    expect(reconcileSwiss).toHaveBeenCalledWith(7, connection);
    expect(reconcileEndurance).toHaveBeenCalledWith(7, connection);

    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(flushBotLogs).toHaveBeenCalledWith(connection);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
    expect(invalidateTournamentLists).toHaveBeenCalledTimes(1);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("n'annonce rien si la transaction échoue", async () => {
    const { connection } = setup({
      format: "SWISS",
      matches: [playedRow({ id: 1, round_number: 1 })],
    });
    (reconcileSwiss as jest.Mock).mockRejectedValue(new Error("ER_LOCK_DEADLOCK") as never);

    await expect(rollbackCurrentRound(7)).rejects.toThrow("ER_LOCK_DEADLOCK");

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(flushBotLogs).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });
});
