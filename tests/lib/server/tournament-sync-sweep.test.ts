import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { type SqlQuery, connectionMock, fakeConnection, fakePool } from "../../helpers/sql-double";

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
  execute: jest.Mock<(sql: string, params?: unknown[]) => Promise<unknown>>;
  beginTransaction: jest.Mock;
  commit: jest.Mock;
  rollback: jest.Mock;
  release: jest.Mock;
  destroy: jest.Mock;
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
  launchesChanged?: number[];
  /** Le `ROLLBACK` échoue (connexion peut-être encore en transaction). */
  rollbackFails?: boolean;
  /** Tentatives en échec par tournoi, sous un code du serveur (interblocage…). */
  failWithCode?: Record<number, { code: string; times: number }>;
  /** État stocké vu par le repérage, par tournoi (`RUNNING` par défaut). */
  states?: Record<number, string>;
}): Promise<{
  connection: Connection;
  synced: number[];
  /** Publications observées, avec le nombre de commits déjà faits à cet instant. */
  published: { tournamentId: number; commits: number }[];
  /** Publications « match seul » (lancements), mêmes conventions. */
  matchPublished: { tournamentId: number; commits: number }[];
}> {
  const synced: number[] = [];
  const published: { tournamentId: number; commits: number }[] = [];
  const matchPublished: { tournamentId: number; commits: number }[] = [];
  let connection!: Connection;

  await jest.isolateModulesAsync(async () => {
    jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
      findSyncCandidates: jest.fn(async () =>
        options.candidates.map((id) => ({
          id,
          lockFirst: ["UPCOMING", "REGISTRATION"].includes(options.states?.[id] ?? "RUNNING"),
        })),
      ),
    }));

    jest.doMock("@/lib/server/tournaments/notifications", () => ({
      publishUpdatedEvent: jest.fn((tournamentId: number) => {
        published.push({ tournamentId, commits: connection.commit.mock.calls.length });
      }),
      publishMatchUpdatedEvent: jest.fn((tournamentId: number) => {
        matchPublished.push({ tournamentId, commits: connection.commit.mock.calls.length });
      }),
      publishScoreReportedEvent: jest.fn(),
      publishScoreResolvedEvent: jest.fn(),
    }));

    jest.doMock("@/lib/server/tournaments/state", () => ({
      computeTournamentState: () => "UPCOMING",
      hasPendingStateTransition: async () => false,
      syncTournamentState: jest.fn(async (_conn: unknown, tournamentId: number) => {
        synced.push(tournamentId);
        if (options.failOn?.includes(tournamentId)) throw new Error("boom on pseudo Nova");
        const coded = options.failWithCode?.[tournamentId];
        if (coded && coded.times > 0) {
          coded.times -= 1;
          throw Object.assign(new Error("Deadlock found when trying to get lock; pseudo Joueur"), { code: coded.code });
        }
        return {
          row: null,
          stateChanged: options.changed?.includes(tournamentId) ?? false,
          contentChanged: options.contentChanged?.includes(tournamentId) ?? false,
          launchesChanged: options.launchesChanged?.includes(tournamentId) ?? false,
        };
      }),
    }));

    jest.doMock("@/lib/server/database", () => {
      connection = {
        execute: jest.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(async () => [[], undefined]),
        beginTransaction: jest.fn(async () => undefined),
        commit: jest.fn(async () => undefined),
        rollback: jest.fn(async () => {
          if (options.rollbackFails) throw new Error("ROLLBACK perdu");
        }),
        release: jest.fn(() => undefined),
        destroy: jest.fn(() => undefined),
      };
      return {
        getDatabase: jest.fn(async () => ({
          execute: jest.fn(async () => [[], undefined]),
          getConnection: jest.fn(async () => connection),
        })),
        withConnection: jest.fn(),
      };
    });

    const { syncVisibleTournaments } = await import("@/lib/server/tournaments");
    await syncVisibleTournaments();
  });

  return { connection, synced, published, matchPublished };
}

beforeEach(() => {
  jest.clearAllMocks();
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("syncVisibleTournaments — une transaction par tournoi", () => {
  it("ouvre et referme une transaction pour chaque candidat", async () => {
    const { connection, synced } = await runSweep({ candidates: [3, 7, 11] });

    expect(synced).toEqual([3, 7, 11]);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(3);
    expect(connection.commit).toHaveBeenCalledTimes(3);
    expect(connection.rollback).not.toHaveBeenCalled();
  });

  // Tirage au sort et semis au coup d'envoi (`RANDOM_SEEDING.md`) : avant le
  // départ, verrou du tournoi en première instruction de la transaction.
  it("verrouille le tournoi en tête de transaction avant le départ, pas en cours", async () => {
    const { connection } = await runSweep({ candidates: [3, 7], states: { 3: "UPCOMING", 7: "RUNNING" } });

    const locks = connection.execute.mock.calls.filter((call) => /FOR UPDATE/.test(String(call[0])));
    expect(locks.map((call) => (call[1] as unknown[])[0])).toEqual([3]);
    // Première instruction de la transaction du tournoi 3 : avant son entretien.
    const lockIndex = connection.execute.mock.calls.findIndex((call) => /FOR UPDATE/.test(String(call[0])));
    const lockOrder = connection.execute.mock.invocationCallOrder[lockIndex]!;
    expect(connection.beginTransaction.mock.invocationCallOrder[0]).toBeLessThan(lockOrder);
    expect(connection.commit.mock.invocationCallOrder[0]).toBeGreaterThan(lockOrder);
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

  // Revue #591 : après un `ROLLBACK` raté, le `START TRANSACTION` du tournoi
  // suivant aurait validé en silence les écritures défaites du précédent.
  it("syncVisibleTournaments_rollbackFails_stopsPassAndDestroysConnection", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const { connection, synced } = await runSweep({ candidates: [1, 2, 3], failOn: [2], rollbackFails: true });

    expect(synced).toEqual([1, 2]);
    expect(connection.beginTransaction).toHaveBeenCalledTimes(2);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
    logged.mockRestore();
  });

  // Revue sécurité #591 : l'entretien des lancements relit l'éligibilité sous
  // verrou partagé après celui du match (ordre inverse de la suppression de
  // compte) — un interblocage défaisait toute la passe du tournoi, sans rejeu
  // ni trace.
  it("syncVisibleTournaments_deadlockThenSuccess_replaysAndPublishesOnce", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const { connection, synced, published } = await runSweep({
      candidates: [1, 2],
      contentChanged: [2],
      failWithCode: { 2: { code: "ER_LOCK_DEADLOCK", times: 1 } },
    });

    expect(synced).toEqual([1, 2, 2]);
    expect(connection.rollback).toHaveBeenCalledTimes(1);
    expect(published).toEqual([{ tournamentId: 2, commits: 2 }]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("syncVisibleTournaments_deadlockOnEveryAttempt_givesUpAfterThreeAndWarnsCodeOnly", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const { synced } = await runSweep({
      candidates: [2, 3],
      failWithCode: { 2: { code: "ER_LOCK_DEADLOCK", times: 99 } },
    });

    expect(synced).toEqual([2, 2, 2, 3]);
    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0][0]);
    expect(line).toContain("tournoi 2");
    expect(line).toContain("ER_LOCK_DEADLOCK");
    // Le texte du serveur peut citer une valeur de ligne : jamais au journal.
    expect(line).not.toContain("pseudo");
  });

  it("syncVisibleTournaments_nonContentionError_noReplayAndWarns", async () => {
    const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const { synced } = await runSweep({ candidates: [2], failOn: [2] });

    expect(synced).toEqual([2]);
    expect(String(warn.mock.calls[0][0])).toContain("abandonnée : Error at ");
    expect(String(warn.mock.calls[0][0])).not.toContain("Nova");
  });

  it("syncVisibleTournaments_deadlockWithFailedRollback_noReplayAndStopsPass", async () => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.spyOn(console, "warn").mockImplementation(() => undefined);

    const { connection, synced } = await runSweep({
      candidates: [1, 2],
      rollbackFails: true,
      failWithCode: { 1: { code: "ER_LOCK_DEADLOCK", times: 1 } },
    });

    expect(synced).toEqual([1]);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
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
    const { published, matchPublished } = await runSweep({ candidates: [4, 5] });

    expect(published).toEqual([]);
    expect(matchPublished).toEqual([]);
  });

  // Un délai de lancement ouvert ou un match lancé d'office tombe à l'heure de
  // chaque manche. Publié comme une mise à jour du tournoi, il vidait la liste
  // publique, la vitrine et le classement du site à chaque fois — alors qu'il
  // ne change que le plateau de ce tournoi.
  it("publie un lancement comme un changement de match, après le commit", async () => {
    const { published, matchPublished } = await runSweep({
      candidates: [4],
      launchesChanged: [4],
    });

    expect(published).toEqual([]);
    expect(matchPublished).toEqual([{ tournamentId: 4, commits: 1 }]);
  });

  it("ne double pas la publication quand le tournoi a aussi changé d'état", async () => {
    const { published, matchPublished } = await runSweep({
      candidates: [4],
      changed: [4],
      launchesChanged: [4],
    });

    // La mise à jour complète vide déjà l'instantané et réveille la salle.
    expect(published).toEqual([{ tournamentId: 4, commits: 1 }]);
    expect(matchPublished).toEqual([]);
  });

  it("ne publie pas le lancement d'un tournoi dont la transaction a échoué", async () => {
    const { matchPublished } = await runSweep({
      candidates: [1, 2],
      launchesChanged: [1, 2],
      failOn: [2],
    });

    expect(matchPublished).toEqual([{ tournamentId: 1, commits: 1 }]);
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
        findSyncCandidates: jest.fn(async () => {
          openWhenScoped = connection.beginTransaction.mock.calls.length;
          return [{ id: 1, lockFirst: false }];
        }),
      }));
      jest.doMock("@/lib/server/tournaments/state", () => ({
        computeTournamentState: () => "UPCOMING",
        hasPendingStateTransition: async () => false,
        syncTournamentState: jest.fn(async () => ({
          row: null,
          stateChanged: false,
          contentChanged: false,
          launchesChanged: false,
        })),
      }));
      jest.doMock("@/lib/server/database", () => {
        connection = {
          execute: jest.fn(async () => [[], undefined]),
          beginTransaction: jest.fn(async () => undefined),
          commit: jest.fn(async () => undefined),
          rollback: jest.fn(async () => undefined),
          release: jest.fn(() => undefined),
          destroy: jest.fn(() => undefined),
        };
        return {
          getDatabase: jest.fn(async () => ({
            execute: jest.fn(async () => [[], undefined]),
            getConnection: jest.fn(async () => connection),
          })),
          withConnection: jest.fn(),
        };
      });

      const { syncVisibleTournaments } = await import("@/lib/server/tournaments");
      await syncVisibleTournaments();
    });

    expect(openWhenScoped).toBe(0);
  });

  // L'entretien est de l'arrière-plan : son échec ne doit pas vider `/tournois`.
  it("sert la liste même si le repérage échoue", async () => {
    await expect(
      jest.isolateModulesAsync(async () => {
        jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
          findSyncCandidates: jest.fn(async () => {
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

        const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
        const { clearCache } = await import("@/lib/server/cache");
        clearCache();
        const buckets = await listTournamentBuckets(null);
        clearCache();
        expect(buckets).toBeDefined();
        await settleTournamentListMaintenanceForTests();
      }),
    ).resolves.toBeUndefined();
  });

  // La passe tombait sur la requête de lecture toutes les 15 s : rendu de
  // l'accueil et `GET /api/tournaments` attendaient la fin de l'entretien de
  // tous les tournois à entretenir, alors que l'affichage n'en dépend plus.
  it("sert la liste sans attendre la passe d'entretien", async () => {
    let releaseSweep!: () => void;
    const sweepStarted = jest.fn();

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
        findSyncCandidates: jest.fn(
          () =>
            new Promise<{ id: number; lockFirst: boolean }[]>((resolve) => {
              sweepStarted();
              releaseSweep = () => resolve([]);
            }),
        ),
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

      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      const buckets = await listTournamentBuckets(null);
      clearCache();

      expect(buckets).toBeDefined();
      // La passe est bien partie, et la liste a été servie avant qu'elle finisse.
      expect(sweepStarted).toHaveBeenCalledTimes(1);
      releaseSweep();
      await settleTournamentListMaintenanceForTests();
    });
  });
});

// Les entretiens lancés par une lecture de la liste ne sont pas attendus par
// elle, mais suivis : un test les laisse finir au lieu de les voir journaliser
// après sa fin sur une base factice remise à zéro (ERREUR.txt, EF-74).
describe("settleTournamentListMaintenanceForTests — fin des entretiens d'une lecture", () => {
  // `jest.doMock` survit à `isolateModulesAsync` : un double resté en place
  // (entretien jamais réglé) fausserait le cas suivant.
  afterEach(() => {
    jest.dontMock("@/lib/server/tournaments/sync-scope");
    jest.dontMock("@/lib/server/tournaments/match-voice");
    jest.dontMock("@/lib/server/site-visits-service");
  });

  /** Base factice qui répond à tout par un résultat vide. */
  function emptyDatabase() {
    const connection = connectionMock();
    connection.execute.mockResolvedValue([[], undefined]);
    const execute = jest.fn<SqlQuery>().mockResolvedValue([[], undefined]);
    return {
      getDatabase: jest.fn(async () =>
        fakePool({ execute, getConnection: jest.fn(async () => fakeConnection(connection)) }),
      ),
      withConnection: jest.fn(),
    };
  }

  it("settleTournamentListMaintenance_nothingLaunched_resolvesImmediately", async () => {
    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");

      await expect(settleTournamentListMaintenanceForTests()).resolves.toBeUndefined();
    });
  });

  it("settleTournamentListMaintenance_sweepStillRunning_waitsForItsEnd", async () => {
    let releaseSweep!: () => void;

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
        findSyncCandidates: jest.fn(
          () =>
            new Promise<{ id: number; lockFirst: boolean }[]>((resolve) => {
              releaseSweep = () => resolve([]);
            }),
        ),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      await listTournamentBuckets(null);
      clearCache();
      const settled = jest.fn();

      const settling = settleTournamentListMaintenanceForTests().then(settled);
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).not.toHaveBeenCalled();
      releaseSweep();
      await settling;

      expect(settled).toHaveBeenCalledTimes(1);
    });
  });

  it("settleTournamentListMaintenanceForTests_afterRelease_secondCallResolvesImmediately", async () => {
    let releaseSweep!: () => void;

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
        findSyncCandidates: jest.fn(
          () =>
            new Promise<{ id: number; lockFirst: boolean }[]>((resolve) => {
              releaseSweep = () => resolve([]);
            }),
        ),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      await listTournamentBuckets(null);
      clearCache();
      releaseSweep();
      await settleTournamentListMaintenanceForTests();

      // Rien ne reste suivi : même un délai nul ne peut pas expirer.
      await expect(settleTournamentListMaintenanceForTests(0)).resolves.toBeUndefined();
    });
  });

  it("settleTournamentListMaintenanceForTests_jobStartedDuringWait_waitsForItToo", async () => {
    const releases: (() => void)[] = [];

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/match-voice", () => ({
        ...jest.requireActual<typeof import("@/lib/server/tournaments/match-voice")>("@/lib/server/tournaments/match-voice"),
        dispatchMatchVoiceChannels: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              releases.push(resolve);
            }),
        ),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      await listTournamentBuckets(null);
      clearCache();
      const settled = jest.fn();
      const settling = settleTournamentListMaintenanceForTests().then(settled);

      // Une seconde lecture lance un nouvel entretien pendant l'attente, puis le premier se termine.
      await listTournamentBuckets(null);
      clearCache();
      releases[0]();
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).not.toHaveBeenCalled();
      releases[1]();
      await settling;

      expect(settled).toHaveBeenCalledTimes(1);
    });
  });

  it("settleTournamentListMaintenanceForTests_retentionRollUpRunning_waitsForIt", async () => {
    let releaseRetention!: () => void;

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/site-visits-service", () => ({
        maintainSiteVisitRetention: jest.fn(
          () =>
            new Promise<void>((resolve) => {
              releaseRetention = resolve;
            }),
        ),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      await listTournamentBuckets(null);
      clearCache();
      const settled = jest.fn();

      const settling = settleTournamentListMaintenanceForTests().then(settled);
      await new Promise((resolve) => setImmediate(resolve));
      expect(settled).not.toHaveBeenCalled();
      releaseRetention();
      await settling;

      expect(settled).toHaveBeenCalledTimes(1);
    });
  });

  it("listTournamentBuckets_backgroundJobRejects_logsAndUntracks", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/match-voice", () => ({
        ...jest.requireActual<typeof import("@/lib/server/tournaments/match-voice")>("@/lib/server/tournaments/match-voice"),
        dispatchMatchVoiceChannels: jest.fn(async () => {
          throw new Error("BOT DOWN");
        }),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();

      await listTournamentBuckets(null);
      clearCache();
      await settleTournamentListMaintenanceForTests();

      expect(errorSpy).toHaveBeenCalledWith("[tournaments] entretien de la liste en échec (match-voice)", expect.any(String));
      await expect(settleTournamentListMaintenanceForTests(0)).resolves.toBeUndefined();
    });
    errorSpy.mockRestore();
  });

  it("settleTournamentListMaintenanceForTests_jobNeverSettles_rejectsAfterTimeout", async () => {
    let releaseSweep!: () => void;

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
        findSyncCandidates: jest.fn(
          () =>
            new Promise<{ id: number; lockFirst: boolean }[]>((resolve) => {
              releaseSweep = () => resolve([]);
            }),
        ),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      await listTournamentBuckets(null);
      clearCache();

      await expect(settleTournamentListMaintenanceForTests(20)).rejects.toThrow(/jamais terminé\(s\) après \d+ ms : sync$/);

      // Les entretiens pendus sont oubliés : l'appel suivant ne rejette pas à son tour.
      await expect(settleTournamentListMaintenanceForTests(20)).resolves.toBeUndefined();
      releaseSweep();
    });
  });

  it("listTournamentBuckets_productionEnv_tracksNothing", async () => {
    let releaseSweep!: () => void;
    const env = process.env as Record<string, string | undefined>;
    const previous = env.NODE_ENV;

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/sync-scope", () => ({
        findSyncCandidates: jest.fn(
          () =>
            new Promise<{ id: number; lockFirst: boolean }[]>((resolve) => {
              releaseSweep = () => resolve([]);
            }),
        ),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();
      env.NODE_ENV = "production";
      try {
        await listTournamentBuckets(null);
        clearCache();
        // Un entretien pend, mais rien n'est suivi : l'attente rend la main aussitôt.
        await expect(settleTournamentListMaintenanceForTests(0)).resolves.toBeUndefined();
      } finally {
        env.NODE_ENV = previous;
      }
      releaseSweep();
    });
  });

  it("listTournamentBuckets_repeatedRejections_logsOncePerMinute", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/match-voice", () => ({
        ...jest.requireActual<typeof import("@/lib/server/tournaments/match-voice")>("@/lib/server/tournaments/match-voice"),
        dispatchMatchVoiceChannels: jest.fn(async () => {
          throw new Error("BOT DOWN");
        }),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      for (let read = 0; read < 3; read += 1) {
        clearCache();
        await listTournamentBuckets(null);
        await settleTournamentListMaintenanceForTests();
      }

      const strayLogs = errorSpy.mock.calls.filter(([message]) => message === "[tournaments] entretien de la liste en échec (match-voice)");
      expect(strayLogs).toHaveLength(1);
    });
    errorSpy.mockRestore();
  });

  it("listTournamentBuckets_twoJobsRejectWithinAMinute_logsEach", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/match-voice", () => ({
        ...jest.requireActual<typeof import("@/lib/server/tournaments/match-voice")>("@/lib/server/tournaments/match-voice"),
        dispatchMatchVoiceChannels: jest.fn(async () => {
          throw new Error("BOT DOWN");
        }),
      }));
      jest.doMock("@/lib/server/site-visits-service", () => ({
        ...jest.requireActual<typeof import("@/lib/server/site-visits-service")>("@/lib/server/site-visits-service"),
        maintainSiteVisitRetention: jest.fn(async () => {
          throw new Error("ROLL-UP DOWN");
        }),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      for (let read = 0; read < 3; read += 1) {
        clearCache();
        await listTournamentBuckets(null);
        await settleTournamentListMaintenanceForTests();
      }

      const messages = errorSpy.mock.calls.map(([message]) => message);
      expect(messages.filter((message) => message === "[tournaments] entretien de la liste en échec (match-voice)")).toHaveLength(1);
      expect(messages.filter((message) => message === "[tournaments] entretien de la liste en échec (site-visits)")).toHaveLength(1);
    });
    errorSpy.mockRestore();
  });

  it("listTournamentBuckets_jobThrowsSynchronously_readStillResolves", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/tournaments/match-voice", () => ({
        ...jest.requireActual<typeof import("@/lib/server/tournaments/match-voice")>("@/lib/server/tournaments/match-voice"),
        dispatchMatchVoiceChannels: jest.fn(() => {
          throw new Error("SYNC THROW");
        }),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();

      await expect(listTournamentBuckets(null)).resolves.toBeDefined();
      clearCache();
      await settleTournamentListMaintenanceForTests();

      expect(errorSpy).toHaveBeenCalledWith("[tournaments] entretien de la liste en échec (match-voice)", expect.any(String));
    });
    errorSpy.mockRestore();
  });

  it("listTournamentBuckets_jobReturnsUndefined_readStillResolves", async () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => undefined);

    await jest.isolateModulesAsync(async () => {
      jest.doMock("@/lib/server/site-visits-service", () => ({
        ...jest.requireActual<typeof import("@/lib/server/site-visits-service")>("@/lib/server/site-visits-service"),
        maintainSiteVisitRetention: jest.fn(),
      }));
      jest.doMock("@/lib/server/database", () => emptyDatabase());
      const { listTournamentBuckets, settleTournamentListMaintenanceForTests } = await import("@/lib/server/tournaments");
      const { clearCache } = await import("@/lib/server/cache");
      clearCache();

      await expect(listTournamentBuckets(null)).resolves.toBeDefined();
      clearCache();
      await settleTournamentListMaintenanceForTests();

      const strayLogs = errorSpy.mock.calls.filter(([message]) => String(message).startsWith("[tournaments] entretien de la liste en échec"));
      expect(strayLogs).toHaveLength(0);
    });
    errorSpy.mockRestore();
  });
});
