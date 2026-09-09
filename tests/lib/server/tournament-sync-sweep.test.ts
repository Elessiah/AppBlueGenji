import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

/**
 * La passe d'entretien elle-même : **une transaction par tournoi**.
 *
 * L'ancienne n'en ouvrait qu'une, pour tous les tournois non terminés : sa
 * durée était la somme des entretiens, et le verrou qu'elle tenait sur
 * `bg_tournaments` aussi — sur une base de démonstration, toute écriture
 * concurrente attendait plusieurs minutes derrière elle.
 *
 * Les tournois sont indépendants : le découpage ne perd aucune garantie et
 * borne le verrou à un seul d'entre eux. Corollaire testé ici — l'échec d'un
 * tournoi n'emporte plus les suivants.
 */

type Connection = {
  execute: jest.Mock;
  beginTransaction: jest.Mock;
  commit: jest.Mock;
  rollback: jest.Mock;
  release: jest.Mock;
};

/**
 * Lance une passe complète avec un jeu de candidats donné, dans un registre de
 * modules neuf : l'étranglement de la passe (`lastSyncAt`) est un état de
 * module, et deux cas d'affilée n'en verraient qu'un.
 */
async function runSweep(options: {
  candidates: number[];
  failOn?: number[];
  changed?: number[];
  contentChanged?: number[];
}): Promise<{
  connection: Connection;
  synced: number[];
  /** Publications observées, avec le nombre de commits déjà faits à cet instant. */
  published: { tournamentId: number; commits: number }[];
}> {
  const synced: number[] = [];
  const published: { tournamentId: number; commits: number }[] = [];
  let connection!: Connection;

  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
      findTournamentsNeedingSync: jest.fn(async () => options.candidates),
    }));

    jest.doMock("@/lib/server/tournaments/notifications", () => ({
      publishUpdatedEvent: jest.fn((tournamentId: number) => {
        published.push({ tournamentId, commits: connection.commit.mock.calls.length });
      }),
      publishScoreReportedEvent: jest.fn(),
      publishScoreResolvedEvent: jest.fn(),
    }));

    jest.doMock("@/lib/server/tournaments/state", () => ({
      computeTournamentState: () => "UPCOMING",
      hasPendingStateTransition: async () => false,
      syncTournamentState: jest.fn(async (_conn: unknown, tournamentId: number) => {
        synced.push(tournamentId);
        if (options.failOn?.includes(tournamentId)) throw new Error("BOOM");
        return {
          row: null,
          stateChanged: options.changed?.includes(tournamentId) ?? false,
          contentChanged: options.contentChanged?.includes(tournamentId) ?? false,
        };
      }),
    }));

    jest.doMock("@/lib/server/database", () => {
      connection = {
        execute: jest.fn(async () => [[], undefined]),
        beginTransaction: jest.fn(async () => undefined),
        commit: jest.fn(async () => undefined),
        rollback: jest.fn(async () => undefined),
        release: jest.fn(() => undefined),
      };
      return {
        getDatabase: jest.fn(async () => ({
          execute: jest.fn(async () => [[], undefined]),
          getConnection: jest.fn(async () => connection),
        })),
        withConnection: jest.fn(),
      };
    });

    const { listTournamentBuckets } = await import("@/lib/server/tournaments");
    const { clearCache } = await import("@/lib/server/cache");
    clearCache();
    await listTournamentBuckets(null);
    clearCache();
  });

  return { connection, synced, published };
}

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

describe("syncVisibleTournaments — une transaction par tournoi", () => {
  it("ouvre et referme une transaction pour chaque candidat", async () => {
    const { connection, synced } = await runSweep({ candidates: [3, 7, 11] });

    expect(synced).toEqual([3, 7, 11]);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(3);
    expect(connection.commit).toHaveBeenCalledTimes(3);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  it("n'ouvre aucune transaction quand il n'y a rien à faire", async () => {
    const { connection } = await runSweep({ candidates: [] });

    expect(connection.beginTransaction).not.toHaveBeenCalled();
    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  // Un tournoi en échec défaisait toute la passe : les 45 suivants attendaient
  // le prochain balayage, et le même échec les y attendait.
  it("isole l'échec d'un tournoi et poursuit la passe", async () => {
    const { connection, synced } = await runSweep({ candidates: [1, 2, 3], failOn: [2] });

    expect(synced).toEqual([1, 2, 3]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(connection.commit).toHaveBeenCalledTimes(2);
  });

  // Le moteur ne publiait pas seulement à la bascule d'état : `createBracketIfMissing`
  // appelait `publishUpdatedEvent` **depuis la transaction ouverte**, si bien que
  // la salle SSE reconstruisait l'instantané sur une autre connexion — qui ne
  // voit pas le plateau en cours d'écriture — et diffusait « en cours, sans
  // plateau ». L'information remonte désormais par `contentChanged`, et c'est
  // ici qu'elle est publiée : après le commit.
  it("publie ce qu'un entretien a écrit sans changer l'état", async () => {
    const { published } = await runSweep({ candidates: [4], contentChanged: [4] });

    expect(published).toEqual([{ tournamentId: 4, commits: 1 }]);
  });

  it("publie une seule fois un tournoi dont l'état ET le contenu ont bougé", async () => {
    const { published } = await runSweep({
      candidates: [4],
      changed: [4],
      contentChanged: [4],
    });

    expect(published).toHaveLength(1);
  });

  it("ne publie rien quand l'entretien n'a rien fait", async () => {
    const { published } = await runSweep({ candidates: [4, 5] });

    expect(published).toEqual([]);
  });

  it("ne publie pas un tournoi dont la transaction a échoué", async () => {
    const { published } = await runSweep({
      candidates: [1, 2],
      contentChanged: [1, 2],
      failOn: [2],
    });

    expect(published).toEqual([{ tournamentId: 1, commits: 1 }]);
  });

  it("rend toujours la connexion au pool", async () => {
    const { connection } = await runSweep({ candidates: [1, 2], failOn: [1, 2] });

    expect(connection.release).toHaveBeenCalledTimes(1);
  });

  // La lecture de repérage précède la première transaction : l'ouvrir dedans
  // rendrait à celle-ci la durée qu'on vient de lui retirer.
  it("repère les candidats hors de toute transaction", async () => {
    let openWhenScoped: number | null = null;

    await jest.isolateModulesAsync(async () => {
      let connection!: Connection;

      jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
        findTournamentsNeedingSync: jest.fn(async () => {
          openWhenScoped = connection.beginTransaction.mock.calls.length;
          return [1];
        }),
      }));
      jest.doMock("@/lib/server/tournaments/state", () => ({
        computeTournamentState: () => "UPCOMING",
        hasPendingStateTransition: async () => false,
        syncTournamentState: jest.fn(async () => ({ row: null, stateChanged: false })),
      }));
      jest.doMock("@/lib/server/database", () => {
        connection = {
          execute: jest.fn(async () => [[], undefined]),
          beginTransaction: jest.fn(async () => undefined),
          commit: jest.fn(async () => undefined),
          rollback: jest.fn(async () => undefined),
          release: jest.fn(() => undefined),
        };
        return {
          getDatabase: jest.fn(async () => ({
            execute: jest.fn(async () => [[], undefined]),
            getConnection: jest.fn(async () => connection),
          })),
          withConnection: jest.fn(),
        };
      });

      const { listTournamentBuckets } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      await listTournamentBuckets(null);
      clearCache();
    });

    expect(openWhenScoped).toBe(0);
  });

  // L'entretien est de l'arrière-plan : son échec ne doit pas vider `/tournois`.
  it("sert la liste même si le repérage échoue", async () => {
    await expect(
      jest.isolateModulesAsync(async () => {
        jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
          findTournamentsNeedingSync: jest.fn(async () => {
            throw new Error("DB DOWN");
          }),
        }));
        jest.doMock("@/lib/server/database", () => ({
          getDatabase: jest.fn(async () => ({
            execute: jest.fn(async () => [[], undefined]),
            getConnection: jest.fn(async () => ({
              execute: jest.fn(async () => [[], undefined]),
              beginTransaction: jest.fn(async () => undefined),
              commit: jest.fn(async () => undefined),
              rollback: jest.fn(async () => undefined),
              release: jest.fn(() => undefined),
            })),
          })),
          withConnection: jest.fn(),
        }));

        const { listTournamentBuckets } = await import("@/lib/server/tournaments");
        const { clearCache } = await import("@/lib/server/cache");
        clearCache();
        const buckets = await listTournamentBuckets(null);
        clearCache();
        expect(buckets).toBeDefined();
      }),
    ).resolves.toBeUndefined();
  });
});
