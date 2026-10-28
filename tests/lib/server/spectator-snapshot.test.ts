import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { gunzipSync } from "node:zlib";

jest.mock("@/lib/server/tournaments-service");

import { getVisibleTournamentCard, getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { tournamentCard } from "../../helpers/tournament-card";
import { cached, clearCache } from "@/lib/server/cache";
import { peekRateToken, SPECTATOR_REBUILD_RULE } from "@/lib/server/api-guard";
import { peekTokenBucket, resetRateLimit } from "@/lib/server/rate-limit";
import {
  getSpectatorPayload,
  gzippedSpectatorBody,
  isSpectatorTournamentPublic,
  publicTournamentSnapshot,
  SPECTATOR_MAX_CONCURRENT_REBUILDS,
  SpectatorRebuildRefused,
  staleSpectatorPayload,
} from "@/lib/server/spectator-snapshot";
import { invalidateSpectatorSnapshot, invalidateTournamentSnapshot } from "@/lib/server/tournaments/snapshot";
import { SPECTATOR_MAX_COPY_AGE_MS } from "@/lib/shared/spectator-view";
import { tournamentSnapshot } from "../../helpers/tournament-detail";
import type { TournamentSnapshot } from "@/lib/shared/types";

/** Réponse publique mutualisée : ce qui entre dans le cache partagé, et qui paie sa construction. */

const mockedSnapshot = jest.mocked(getVisibleTournamentSnapshot);
const CLIENT = "203.0.113.7";

/** Jetons de reconstruction restants au réseau. */
function tokensLeft(client: string = CLIENT): number {
  return peekTokenBucket(SPECTATOR_REBUILD_RULE, client).remaining;
}

/** Instantané des membres déjà en cache (salon SSE ouvert). */
async function warmMembers(id: number, snapshot: TournamentSnapshot): Promise<void> {
  await cached(`tournament-snapshot:${id}`, 60_000, async () => snapshot);
}

/** Vide le seau du réseau par des reconstructions réussies (tournois 1…capacité). */
async function spendAllTokens(client: string = CLIENT): Promise<void> {
  for (let id = 1; id <= SPECTATOR_REBUILD_RULE.capacity; id += 1) {
    await getSpectatorPayload(id, 0, client);
  }
}

async function refusalOf(promise: Promise<unknown>): Promise<SpectatorRebuildRefused> {
  const error = await promise.then(
    () => null,
    (caught: unknown) => caught,
  );
  if (!(error instanceof SpectatorRebuildRefused)) throw new Error("refus attendu");
  return error;
}

const FAKE_CLOCK: { doNotFake: Array<"nextTick" | "setImmediate" | "queueMicrotask"> } = {
  doNotFake: ["nextTick", "setImmediate", "queueMicrotask"],
};

beforeEach(() => {
  clearCache();
  resetRateLimit();
  jest.mocked(getVisibleTournamentCard).mockResolvedValue(tournamentCard({ id: 5 }));
});
afterEach(() => {
  jest.useRealTimers();
  jest.resetAllMocks();
});

describe("getSpectatorPayload", () => {
  it("garde un tournoi trouvé pour sa durée de vie", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot({ version: "v1" }));

    await getSpectatorPayload(5, 0, CLIENT);
    await getSpectatorPayload(5, 0, CLIENT);

    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("ne met jamais un « introuvable » dans le cache partagé", async () => {
    mockedSnapshot.mockResolvedValue(null);

    expect(await getSpectatorPayload(9, 0, CLIENT)).toBeNull();

    // La clé est vide : un chargeur témoin s'exécute, au lieu de relire un `null` rangé.
    const probe = jest.fn(async () => "témoin");
    expect(await cached("spectator-snapshot:9", 60_000, probe)).toBe("témoin");
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("survit aux écritures : sa durée de vie protège la machine d'un tournoi animé", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot({ version: "v1" }));
    await getSpectatorPayload(5, 0, CLIENT);

    invalidateTournamentSnapshot(5);
    await getSpectatorPayload(5, 0, CLIENT);

    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("part avec le tournoi supprimé, copie périmée comprise", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot({ version: "v1" }));
    await getSpectatorPayload(5, 0, CLIENT);

    invalidateSpectatorSnapshot(5);
    expect(staleSpectatorPayload(5)).toBeNull();
    await getSpectatorPayload(5, 0, CLIENT);

    expect(mockedSnapshot).toHaveBeenCalledTimes(2);
  });

  it("tient sa durée de vie de la charge, et la garde une fois en cache", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    expect((await getSpectatorPayload(5, 3, CLIENT))?.ttlMs).toBe(150_000);
    // Déjà en cache : la charge demandée ensuite ne la change pas.
    expect((await getSpectatorPayload(5, 0, CLIENT))?.ttlMs).toBe(150_000);
  });

  it("garde un tournoi terminé l'âge déclaré entier, même au calme", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot({ card: tournamentCard({ id: 5, state: "FINISHED" }) }));
    expect((await getSpectatorPayload(5, 0, CLIENT))?.ttlMs).toBe(SPECTATOR_MAX_COPY_AGE_MS);
  });

  it("sert une version vide dans le corps : l'empreinte ne voyage que dans l'ETag", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot({ version: "membres-v7" }));
    const payload = await getSpectatorPayload(5, 0, CLIENT);

    expect(JSON.parse(payload!.body).version).toBe("");
    expect(payload!.snapshot.version).toBe("");
    expect(payload!.version).toMatch(/^[\w-]{22}$/);
  });

  it("laisse remonter une vraie panne, et rend le jeton", async () => {
    mockedSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(getSpectatorPayload(5, 0, CLIENT)).rejects.toThrow("ECONNREFUSED");
    expect(tokensLeft()).toBe(SPECTATOR_REBUILD_RULE.capacity);
  });
});

describe("getSpectatorPayload — prix d'une reconstruction", () => {
  it("prend un jeton au réseau pour une reconstruction froide, carte puis instantané", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());

    await getSpectatorPayload(5, 0, CLIENT);

    expect(tokensLeft()).toBe(SPECTATOR_REBUILD_RULE.capacity - 1);
    expect(getVisibleTournamentCard).toHaveBeenCalledWith(5);
  });

  it("ne fait rien payer à une lecture servie par le cache", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    await getSpectatorPayload(5, 0, CLIENT);

    await getSpectatorPayload(5, 0, "198.51.100.1");

    expect(tokensLeft("198.51.100.1")).toBe(SPECTATOR_REBUILD_RULE.capacity);
  });

  it("ne fait payer qu'un jeton à deux lectures froides qui se croisent", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());

    await Promise.all([getSpectatorPayload(5, 0, CLIENT), getSpectatorPayload(5, 0, CLIENT)]);

    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
    expect(tokensLeft()).toBe(SPECTATOR_REBUILD_RULE.capacity - 1);
  });

  it("instantané des membres chaud : ni carte, ni jeton", async () => {
    const snapshot = tournamentSnapshot();
    await warmMembers(5, snapshot);
    mockedSnapshot.mockResolvedValue(snapshot);

    await expect(getSpectatorPayload(5, 0, CLIENT)).resolves.not.toBeNull();

    expect(getVisibleTournamentCard).not.toHaveBeenCalled();
    expect(tokensLeft()).toBe(SPECTATOR_REBUILD_RULE.capacity);
  });

  it("instantané chaud mais tournoi invisible : la porte de l'instantané tient", async () => {
    await warmMembers(5, tournamentSnapshot());
    mockedSnapshot.mockResolvedValue(null);

    await expect(getSpectatorPayload(5, 0, CLIENT)).resolves.toBeNull();
  });

  it("identifiant inconnu : la carte l'arrête, sans instantané, et le jeton revient", async () => {
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(null);

    await expect(getSpectatorPayload(5, 0, CLIENT)).resolves.toBeNull();

    expect(mockedSnapshot).not.toHaveBeenCalled();
    expect(tokensLeft()).toBe(SPECTATOR_REBUILD_RULE.capacity);
  });

  it("refuse la reconstruction du réseau sans jeton, avec le 429 à servir", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    await spendAllTokens();

    const refusal = await refusalOf(getSpectatorPayload(99, 0, CLIENT));

    expect(refusal.kind).toBe("rate");
    expect(refusal.response?.status).toBe(429);
    expect(peekRateToken(SPECTATOR_REBUILD_RULE, CLIENT)?.status).toBe(429);
    // Un autre réseau n'en pâtit pas.
    await expect(getSpectatorPayload(99, 0, "198.51.100.1")).resolves.not.toBeNull();
  });

  it("rend un jeton par seconde : un débit, pas une fenêtre qui se vide d'un coup", async () => {
    jest.useFakeTimers({ now: 1_000_000, ...FAKE_CLOCK });
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    await spendAllTokens();
    await refusalOf(getSpectatorPayload(50, 0, CLIENT));

    jest.setSystemTime(1_000_000 + SPECTATOR_REBUILD_RULE.refillMs);
    await expect(getSpectatorPayload(50, 0, CLIENT)).resolves.not.toBeNull();
    await refusalOf(getSpectatorPayload(51, 0, CLIENT));
  });

  it("n'a jamais plus de constructions en vol que le plafond, et rend le jeton refusé", async () => {
    const releases: Array<() => void> = [];
    mockedSnapshot.mockImplementation(
      () =>
        new Promise<TournamentSnapshot>((resolve) => {
          releases.push(() => resolve(tournamentSnapshot()));
        }),
    );
    const running = Array.from({ length: SPECTATOR_MAX_CONCURRENT_REBUILDS }, (_, index) =>
      getSpectatorPayload(index + 1, 0, `198.51.100.${index + 1}`),
    );
    await new Promise((resolve) => setImmediate(resolve));
    expect(releases).toHaveLength(SPECTATOR_MAX_CONCURRENT_REBUILDS);

    const refusal = await refusalOf(getSpectatorPayload(40, 0, CLIENT));
    expect(refusal.kind).toBe("busy");
    expect(refusal.response).toBeNull();
    expect(tokensLeft()).toBe(SPECTATOR_REBUILD_RULE.capacity);

    for (const release of releases) release();
    await Promise.all(running);
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    await expect(getSpectatorPayload(40, 0, CLIENT)).resolves.not.toBeNull();
  });

  it("rend sa place même quand l'instantané échoue", async () => {
    mockedSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));
    for (let id = 1; id <= SPECTATOR_MAX_CONCURRENT_REBUILDS + 1; id += 1) {
      await expect(getSpectatorPayload(id, 0, `198.51.100.${id}`)).rejects.toThrow("ECONNREFUSED");
    }
  });

  it("ne plafonne pas un client inconnu", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    for (let id = 1; id <= SPECTATOR_REBUILD_RULE.capacity + 2; id += 1) {
      await expect(getSpectatorPayload(id, 0, null)).resolves.not.toBeNull();
    }
  });
});

describe("copie périmée et corps compressé", () => {
  it("garde la dernière réponse 150 s après sa construction, pas au-delà", async () => {
    jest.useFakeTimers({ now: 2_000_000, ...FAKE_CLOCK });
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    const payload = await getSpectatorPayload(5, 0, CLIENT);

    jest.setSystemTime(2_000_000 + SPECTATOR_MAX_COPY_AGE_MS - 1);
    expect(staleSpectatorPayload(5)).toBe(payload);
    jest.setSystemTime(2_000_000 + SPECTATOR_MAX_COPY_AGE_MS);
    expect(staleSpectatorPayload(5)).toBeNull();
  });

  it("compresse le corps une fois pour tous ses lecteurs", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    const payload = (await getSpectatorPayload(5, 0, CLIENT))!;

    const bytes = gzippedSpectatorBody(payload);
    expect(gzippedSpectatorBody(payload)).toBe(bytes);
    expect(gunzipSync(bytes).toString("utf8")).toBe(payload.body);
  });
});

describe("publicTournamentSnapshot", () => {
  it("rend l'instantané public, sans la version des membres", async () => {
    mockedSnapshot.mockResolvedValue(tournamentSnapshot({ version: "membres-v7" }));
    expect((await publicTournamentSnapshot(5, 0, CLIENT))?.version).toBe("");
  });

  it("refus : la copie récente s'il y en a une, sinon null", async () => {
    jest.useFakeTimers({ now: 3_000_000, ...FAKE_CLOCK });
    mockedSnapshot.mockResolvedValue(tournamentSnapshot());
    await getSpectatorPayload(100, 0, CLIENT);
    // La réponse du tournoi 100 a expiré (15 s au calme) mais reste dans l'âge
    // déclaré ; le seau, rempli entre-temps, est vidé ensuite.
    jest.setSystemTime(3_000_000 + 20_000);
    await spendAllTokens();

    expect(await publicTournamentSnapshot(100, 0, CLIENT)).not.toBeNull();
    expect(await publicTournamentSnapshot(77, 0, CLIENT)).toBeNull();
  });

  it("base injoignable : null, sans lever", async () => {
    mockedSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(publicTournamentSnapshot(5, 0, CLIENT)).resolves.toBeNull();
  });
});

describe("isSpectatorTournamentPublic", () => {
  it("lit la seule carte, sans aucun droit, et ne construit pas l'instantané", async () => {
    await expect(isSpectatorTournamentPublic(5)).resolves.toBe(true);
    expect(getVisibleTournamentCard).toHaveBeenCalledWith(5);
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  it("dit non pour un tournoi absent ou pas encore publié", async () => {
    jest.mocked(getVisibleTournamentCard).mockResolvedValue(null);
    await expect(isSpectatorTournamentPublic(5)).resolves.toBe(false);
  });

  it("mutualise les lectures simultanées sans rien garder", async () => {
    await Promise.all([isSpectatorTournamentPublic(5), isSpectatorTournamentPublic(5)]);
    expect(getVisibleTournamentCard).toHaveBeenCalledTimes(1);

    await isSpectatorTournamentPublic(5);
    expect(getVisibleTournamentCard).toHaveBeenCalledTimes(2);
  });

  it("laisse passer l'échec de la base (la route répond 503)", async () => {
    jest.mocked(getVisibleTournamentCard).mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(isSpectatorTournamentPublic(5)).rejects.toThrow("ECONNREFUSED");
  });
});
