import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database");
jest.mock("@/lib/server/tournaments/notifications");
jest.mock("@/lib/server/tournaments/registration");
jest.mock("@/lib/server/tournaments/bot-logs");

import { registerGhostTeams } from "@/lib/server/tournaments";
import { getDatabase } from "@/lib/server/database";
import { publishUpdatedEvent } from "@/lib/server/tournaments/notifications";
import { registerTeamsByIds } from "@/lib/server/tournaments/registration";
import { discardBotLogs, flushBotLogs } from "@/lib/server/tournaments/bot-logs";
import { fakePool } from "../../helpers/sql-double";

/**
 * Le lot est **tout ou rien**, et c'est ce niveau-ci qui le tient : une seule
 * transaction pour toute la sélection, défaite entière au premier refus.
 *
 * Un seul évènement de flux après le commit, aussi : le panneau d'inscriptions
 * et l'aperçu du plateau se refont une fois, sur l'état final, plutôt que N fois
 * sur des états intermédiaires qui n'ont jamais existé hors de la transaction.
 */
function mockConnection() {
  const connection = {
    execute: jest.fn(),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
    release: jest.fn(),
  };
  jest.mocked(getDatabase).mockResolvedValue(fakePool({
    execute: jest.fn(),
    getConnection: jest.fn(async () => connection),
  }));
  return connection;
}

describe("registerGhostTeams", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(flushBotLogs).mockReturnValue(undefined);
    jest.mocked(discardBotLogs).mockReturnValue(undefined);
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("écrit tout le lot dans une seule transaction, et publie une seule fois", async () => {
    const connection = mockConnection();
    jest.mocked(registerTeamsByIds).mockResolvedValue(undefined);

    await registerGhostTeams(5, [900, 901, 902]);

    expect(connection.beginTransaction).toHaveBeenCalledTimes(1);
    expect(registerTeamsByIds).toHaveBeenCalledTimes(1);
    expect(registerTeamsByIds).toHaveBeenCalledWith(connection as never, 5, [900, 901, 902]);
    expect(connection.commit).toHaveBeenCalledTimes(1);
    expect(connection.rollback).not.toHaveBeenCalled();
    expect(flushBotLogs).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).toHaveBeenCalledWith(5);
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("défait tout le lot au premier refus, sans rien publier", async () => {
    const connection = mockConnection();
    jest.mocked(registerTeamsByIds).mockRejectedValue(
      Object.assign(new Error("ALREADY_REGISTERED"), { teamId: 901 }),
    );

    await expect(registerGhostTeams(5, [900, 901])).rejects.toThrow("ALREADY_REGISTERED");

    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).not.toHaveBeenCalled();
    // Rien n'a été écrit : ni ligne de journal Discord, ni évènement de flux.
    expect(flushBotLogs).not.toHaveBeenCalled();
    expect(discardBotLogs).toHaveBeenCalledTimes(1);
    expect(publishUpdatedEvent).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  it("laisse remonter l'engagé nommé par le refus", async () => {
    mockConnection();
    jest.mocked(registerTeamsByIds).mockRejectedValue(
      Object.assign(new Error("NOT_A_GHOST_TEAM"), { teamId: 901 }),
    );

    const error = await registerGhostTeams(5, [900, 901]).catch((e) => e);

    expect((error as { teamId?: number }).teamId).toBe(901);
  });
});
