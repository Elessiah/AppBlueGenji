import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");

import { setMatchStartAt } from "@/lib/server/tournaments/match-schedule";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";

async function mockDb(execute: jest.Mock) {
  const { getDatabase } = await import("@/lib/server/database");
  (getDatabase as jest.Mock).mockResolvedValue({ execute });
}

/**
 * Base : la lecture du match trouve une ligne, l'UPDATE réussit, puis le ménage
 * des rappels déjà envoyés (`bg_match_reminders`) passe.
 */
function found(startAt: Date | null = null) {
  return jest
    .fn()
    .mockResolvedValueOnce([[{ id: 42, tournament_id: 7, start_at: startAt }]])
    .mockResolvedValue([{ affectedRows: 1 }]);
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("setMatchStartAt", () => {
  it("enregistre une date normalisée et réveille les pages ouvertes", async () => {
    const execute = found();
    await mockDb(execute);

    const result = await setMatchStartAt(42, "2026-08-29T18:30:00Z");

    expect(result).toBe("2026-08-29T18:30:00.000Z");
    const [sql, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(sql).toMatch(/UPDATE bg_matches SET start_at = \?/);
    expect(params[0]).toBeInstanceOf(Date);
    expect((params[0] as Date).toISOString()).toBe("2026-08-29T18:30:00.000Z");
    expect(params[1]).toBe(42);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("accepte la valeur brute d'un champ datetime-local", async () => {
    const execute = found();
    await mockDb(execute);

    const result = await setMatchStartAt(42, "2026-08-29T20:30");

    expect(result).toBe(new Date(2026, 7, 29, 20, 30).toISOString());
  });

  it("efface l'horaire sur null", async () => {
    const execute = found(new Date("2026-08-29T18:30:00Z"));
    await mockDb(execute);

    expect(await setMatchStartAt(42, null)).toBeNull();
    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params[0]).toBeNull();
    expect(publishUpdatedEvent).toHaveBeenCalledWith(7);
  });

  it("traite une chaîne vide comme un effacement — le formulaire renvoie « »", async () => {
    const execute = found(new Date("2026-08-29T18:30:00Z"));
    await mockDb(execute);

    expect(await setMatchStartAt(42, "   ")).toBeNull();
    const [, params] = execute.mock.calls[1] as [string, unknown[]];
    expect(params[0]).toBeNull();
  });

  it("efface les rappels déjà envoyés quand la date change vraiment", async () => {
    const execute = found(new Date("2026-08-29T18:30:00Z"));
    await mockDb(execute);

    await setMatchStartAt(42, "2026-08-30T18:30:00Z");

    const [sql, params] = execute.mock.calls[2] as [string, unknown[]];
    expect(sql).toMatch(/DELETE FROM bg_match_reminders WHERE match_id = \?/);
    expect(params).toEqual([42]);
  });

  it("laisse les rappels en place quand la date est réécrite à l'identique", async () => {
    const execute = found(new Date("2026-08-29T18:30:00Z"));
    await mockDb(execute);

    await setMatchStartAt(42, "2026-08-29T18:30:00Z");

    // Deux requêtes seulement : la lecture et l'UPDATE. Rien à réannoncer.
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("refuse une date inexploitable avant même de lire le match", async () => {
    const execute = jest.fn();
    await mockDb(execute);

    await expect(setMatchStartAt(42, "demain soir")).rejects.toThrow("INVALID_MATCH_START_AT");
    expect(execute).not.toHaveBeenCalled();
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("refuse une date hors bornes", async () => {
    const execute = jest.fn();
    await mockDb(execute);

    await expect(setMatchStartAt(42, "1970-01-01T00:00:00Z")).rejects.toThrow(
      "INVALID_MATCH_START_AT",
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it("signale un match introuvable sans rien écrire", async () => {
    const execute = jest.fn().mockResolvedValueOnce([[]]);
    await mockDb(execute);

    await expect(setMatchStartAt(999, "2026-08-29T18:30:00Z")).rejects.toThrow("MATCH_NOT_FOUND");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
  });

  it("programme un match déjà joué — la date est descriptive, pas prescriptive", async () => {
    // Aucune garde d'état : corriger l'horaire d'archive d'une manche passée est
    // légitime, et la date n'entre dans aucune règle du moteur.
    const execute = found();
    await mockDb(execute);

    await expect(setMatchStartAt(42, "2020-06-01T12:00:00Z")).resolves.toBe(
      "2020-06-01T12:00:00.000Z",
    );
  });
});
