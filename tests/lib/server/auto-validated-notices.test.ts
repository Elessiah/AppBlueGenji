import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import type { PoolConnection } from "mysql2/promise";

jest.mock("@/lib/server/tournaments/player-pushes");

import {
  discardAutoValidatedNotices,
  flushAutoValidatedNotices,
  queueAutoValidatedNotice,
} from "@/lib/server/tournaments/auto-validated-notices";
import { notifyScoreAutoValidated } from "@/lib/server/tournaments/player-pushes";

/** Avis « score validé automatiquement » : partis après le commit, jamais sans lui. */
function connection(): PoolConnection {
  return {} as unknown as PoolConnection;
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(notifyScoreAutoValidated).mockResolvedValue(1);
});

describe("auto-validated-notices", () => {
  it("prévient une fois par manche validée, après le commit", () => {
    const conn = connection();
    queueAutoValidatedNotice(conn, 31);
    queueAutoValidatedNotice(conn, 31);
    queueAutoValidatedNotice(conn, 32);
    expect(notifyScoreAutoValidated).not.toHaveBeenCalled();

    flushAutoValidatedNotices(conn);

    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(2);
    expect(notifyScoreAutoValidated).toHaveBeenCalledWith(31);
    expect(notifyScoreAutoValidated).toHaveBeenCalledWith(32);
  });

  it("ne prévient de rien quand la transaction échoue", () => {
    const conn = connection();
    queueAutoValidatedNotice(conn, 31);
    discardAutoValidatedNotices(conn);
    flushAutoValidatedNotices(conn);
    expect(notifyScoreAutoValidated).not.toHaveBeenCalled();
  });

  it("ne rejoue rien d'une transaction à la suivante sur la même connexion", () => {
    const conn = connection();
    queueAutoValidatedNotice(conn, 31);
    flushAutoValidatedNotices(conn);
    flushAutoValidatedNotices(conn);
    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(1);
  });
});
