import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import { withConnection } from "@/lib/server/database";
import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";
import { publishMatchUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { connectionMock, fakeConnection } from "../../helpers/sql-double";

type Row = {
  id: number;
  tournament_id: number;
  status: string;
  team1_id: number | null;
  team2_id: number | null;
  start_at: Date | null;
  launched_at: Date | null;
  launch_pairing: string | null;
  team1_score: number | null;
  team2_score: number | null;
};

function matchRow(overrides: Partial<Row> = {}): Row {
  return {
    id: 42,
    tournament_id: 7,
    status: "READY",
    team1_id: 1,
    team2_id: 2,
    start_at: null,
    launched_at: null,
    launch_pairing: "1:2",
    team1_score: null,
    team2_score: null,
    ...overrides,
  };
}

/**
 * Base simulée : la ligne du match (sous verrou), l'option du tournoi, puis les
 * écritures. Les requêtes sont reconnues à leur texte, pas à leur rang.
 */
function world(options: { row?: Row | null; refereeScheduling?: boolean; failReminders?: boolean } = {}) {
  const connection = connectionMock();
  connection.rollback.mockResolvedValue(undefined);
  const row = options.row === undefined ? matchRow() : options.row;
  const writes: { sql: string; params: unknown[] }[] = [];
  connection.execute.mockImplementation(async (raw: string, params?: unknown) => {
    const sql = raw.replace(/\s+/g, " ").trim();
    if (sql.startsWith("SELECT id, tournament_id, status")) {
      expect(sql).toContain("FOR UPDATE");
      return [row ? [row] : []];
    }
    if (sql.startsWith("SELECT referee_scheduling FROM bg_tournaments")) {
      return [[{ referee_scheduling: options.refereeScheduling ? 1 : 0 }]];
    }
    if (sql.startsWith("DELETE FROM bg_match_reminders") && options.failReminders) {
      throw new Error("base injoignable");
    }
    writes.push({ sql, params: (params as unknown[]) ?? [] });
    return [{ affectedRows: 1 }];
  });
  jest.mocked(withConnection).mockImplementation(async (run) => run(fakeConnection(connection)));
  return { connection, writes };
}

const FUTURE = "2099-08-29T18:30:00Z";

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("setMatchStartAt", () => {
  it("enregistre une date normalisée, sous transaction, et réveille les pages ouvertes", async () => {
    const { connection, writes } = world();

    const result = await setMatchStartAt(42, "2026-08-29T18:30:00Z");

    expect(result).toBe("2026-08-29T18:30:00.000Z");
    const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
    expect(update?.sql).toMatch(/SET start_at = \?/);
    expect(update?.params[0]).toBeInstanceOf(Date);
    expect((update?.params[0] as Date).toISOString()).toBe("2026-08-29T18:30:00.000Z");
    expect(update?.params[1]).toBe(42);
    expect(connection.beginTransaction).toHaveBeenCalled();
    expect(connection.commit).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { onAir: true });
  });

  it("accepte la valeur brute d'un champ datetime-local", async () => {
    world();
    const result = await setMatchStartAt(42, "2026-08-29T20:30");
    expect(result).toBe(new Date(2026, 7, 29, 20, 30).toISOString());
  });

  it("efface l'horaire sur null", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });

    expect(await setMatchStartAt(42, null)).toBeNull();
    const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
    expect(update?.params[0]).toBeNull();
    expect(publishMatchUpdatedEvent).toHaveBeenCalledWith(7, { onAir: true });
  });

  it("traite une chaîne vide comme un effacement — le formulaire renvoie « »", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });
    expect(await setMatchStartAt(42, "   ")).toBeNull();
    expect(writes.find((w) => w.sql.startsWith("UPDATE bg_matches"))?.params[0]).toBeNull();
  });

  it("efface les rappels déjà envoyés quand la date change vraiment", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });

    await setMatchStartAt(42, "2026-08-30T18:30:00Z");

    const reminders = writes.find((w) => w.sql.startsWith("DELETE FROM bg_match_reminders"));
    expect(reminders?.params).toEqual([42]);
  });

  it("laisse les rappels en place quand la date est réécrite à l'identique", async () => {
    const { writes } = world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }) });
    await setMatchStartAt(42, "2026-08-29T18:30:00Z");
    expect(writes.some((w) => w.sql.startsWith("DELETE"))).toBe(false);
  });

  it("n'échoue pas quand le ménage des rappels échoue", async () => {
    world({ row: matchRow({ start_at: new Date("2026-08-29T18:30:00Z") }), failReminders: true });
    await expect(setMatchStartAt(42, "2026-08-30T18:30:00Z")).resolves.toBe(
      "2026-08-30T18:30:00.000Z",
    );
    expect(publishMatchUpdatedEvent).toHaveBeenCalled();
  });

  it("refuse une date inexploitable avant même de lire le match", async () => {
    const { connection } = world();
    await expect(setMatchStartAt(42, "demain soir")).rejects.toThrow("INVALID_MATCH_START_AT");
    expect(connection.execute).not.toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse une date hors bornes", async () => {
    const { connection } = world();
    await expect(setMatchStartAt(42, "1970-01-01T00:00:00Z")).rejects.toThrow(
      "INVALID_MATCH_START_AT",
    );
    expect(connection.execute).not.toHaveBeenCalled();
  });

  it("signale un match introuvable sans rien écrire, et défait la transaction", async () => {
    const { connection, writes } = world({ row: null });

    await expect(setMatchStartAt(999, "2026-08-29T18:30:00Z")).rejects.toThrow("MATCH_NOT_FOUND");
    expect(writes).toHaveLength(0);
    expect(connection.rollback).toHaveBeenCalled();
    expect(publishMatchUpdatedEvent).not.toHaveBeenCalled();
  });

  it("programme un match déjà joué — la date ne verrouille rien", async () => {
    world({ row: matchRow({ status: "COMPLETED" }) });
    await expect(setMatchStartAt(42, "2020-06-01T12:00:00Z")).resolves.toBe(
      "2020-06-01T12:00:00.000Z",
    );
  });

  describe("remise à zéro du lancement quand le match le quitte", () => {
    const resets = (writes: { sql: string }[]) =>
      writes.some((w) => w.sql.includes("lobby_opened_at = NULL"));

    it("date reportée dans le futur, match non lancé : ouverture et « Prêt » effacés", async () => {
      const { writes } = world();
      await setMatchStartAt(42, FUTURE);
      const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
      expect(update?.sql).toContain("team1_ready_at = NULL");
      expect(update?.sql).toContain("caster_ready_at = NULL");
      expect(resets(writes)).toBe(true);
    });

    it("date effacée, option allumée : le match repasse à planifier, lancement défait", async () => {
      const { writes } = world({
        row: matchRow({ start_at: new Date("2020-01-01T10:00:00Z") }),
        refereeScheduling: true,
      });
      await setMatchStartAt(42, null);
      expect(resets(writes)).toBe(true);
    });

    it("date effacée, option éteinte : le match reste en lancement, rien n'est défait", async () => {
      const { writes } = world({ row: matchRow({ start_at: new Date("2020-01-01T10:00:00Z") }) });
      await setMatchStartAt(42, null);
      expect(resets(writes)).toBe(false);
    });

    it("date passée : le match entre ou reste en lancement, ses « Prêt » restent", async () => {
      const { writes } = world({ refereeScheduling: true });
      await setMatchStartAt(42, "2020-06-01T12:00:00Z");
      expect(resets(writes)).toBe(false);
    });

    it("match déjà lancé : jamais défait, même reporté", async () => {
      const { writes } = world({ row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z") }) });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(false);
    });

    it("lancement posé pour un autre appariement : il ne compte pas, le report le défait", async () => {
      const { writes } = world({
        row: matchRow({ launched_at: new Date("2026-01-01T10:00:00Z"), launch_pairing: "3:4" }),
      });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(true);
    });

    it("score déjà noté : le match est tenu pour lancé, jamais renvoyé en attente", async () => {
      const { writes } = world({ row: matchRow({ team1_score: 1, team2_score: 0 }) });
      await setMatchStartAt(42, FUTURE);
      const update = writes.find((w) => w.sql.startsWith("UPDATE bg_matches"));
      expect(update?.sql).toContain("launched_at = NOW()");
      expect(update?.sql).toContain("launch_pairing = CONCAT(team1_id, ':', team2_id)");
      expect(resets(writes)).toBe(false);
    });

    it("match sans ses deux engagées : rien à défaire", async () => {
      const { writes } = world({ row: matchRow({ status: "PENDING", team2_id: null }) });
      await setMatchStartAt(42, FUTURE);
      expect(resets(writes)).toBe(false);
    });
  });
});
