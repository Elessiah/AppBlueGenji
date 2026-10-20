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

/** Laisse la chaîne d'envoi avancer jusqu'au bout. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(notifyScoreAutoValidated).mockResolvedValue(1);
});

describe("auto-validated-notices", () => {
  it("prévient une fois par manche validée, après le commit", async () => {
    const conn = connection();
    queueAutoValidatedNotice(conn, 31);
    queueAutoValidatedNotice(conn, 31);
    queueAutoValidatedNotice(conn, 32);
    expect(notifyScoreAutoValidated).not.toHaveBeenCalled();

    flushAutoValidatedNotices(conn);
    await flushMicrotasks();

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

  it("ne rejoue rien d'une transaction à la suivante sur la même connexion", async () => {
    const conn = connection();
    queueAutoValidatedNotice(conn, 31);
    flushAutoValidatedNotices(conn);
    flushAutoValidatedNotices(conn);
    await flushMicrotasks();
    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(1);
  });
  it("envoie les avis l'un après l'autre, sans rafale sur le pool", async () => {
    const conn = connection();
    let release: ((value: number) => void) | undefined;
    jest.mocked(notifyScoreAutoValidated).mockImplementationOnce(
      () => new Promise<number>((resolve) => { release = resolve; }),
    );
    queueAutoValidatedNotice(conn, 31);
    queueAutoValidatedNotice(conn, 32);

    flushAutoValidatedNotices(conn);
    await flushMicrotasks();
    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(1);

    release?.(1);
    await flushMicrotasks();
    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(2);
    expect(notifyScoreAutoValidated).toHaveBeenLastCalledWith(32);
  });

  it("continue après un envoi en échec et n'en perd aucun, même au-delà de 256", async () => {
    const conn = connection();
    jest.mocked(notifyScoreAutoValidated).mockRejectedValueOnce(new Error("push"));
    for (let id = 1; id <= 300; id += 1) queueAutoValidatedNotice(conn, id);

    flushAutoValidatedNotices(conn);
    for (let i = 0; i < 50; i += 1) await flushMicrotasks();

    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(300);
    expect(notifyScoreAutoValidated).toHaveBeenLastCalledWith(300);
  });
  it("enchaîne les flushs de plusieurs transactions dans une seule file", async () => {
    const first = connection();
    const second = connection();
    let release: ((value: number) => void) | undefined;
    jest.mocked(notifyScoreAutoValidated).mockImplementationOnce(
      () => new Promise<number>((resolve) => { release = resolve; }),
    );
    queueAutoValidatedNotice(first, 41);
    queueAutoValidatedNotice(second, 42);

    flushAutoValidatedNotices(first);
    flushAutoValidatedNotices(second);
    await flushMicrotasks();
    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(1);
    expect(notifyScoreAutoValidated).toHaveBeenCalledWith(41);

    release?.(1);
    await flushMicrotasks();
    expect(notifyScoreAutoValidated).toHaveBeenCalledTimes(2);
    expect(notifyScoreAutoValidated).toHaveBeenLastCalledWith(42);
  });
});
