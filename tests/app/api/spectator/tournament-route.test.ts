import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET } from "@/app/api/spectator/tournaments/[id]/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getVisibleTournamentCard, getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { clearCache } from "@/lib/server/cache";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { tokensLeft } from "../../../helpers/token-bucket";
import { SPECTATOR_READ_RULE, SPECTATOR_REBUILD_RULE } from "@/lib/server/api-guard";
import { resetSpectatorLoad, spectatorReadsPerMinute } from "@/lib/server/spectator-load";
import {
  SPECTATOR_FRESHNESS_HEADER,
  SPECTATOR_HIDDEN_USER_ID,
  SPECTATOR_MAX_COPY_AGE_MS,
  SPECTATOR_MAX_POLL_MS,
  SPECTATOR_POLL_HEADER,
  SPECTATOR_PRE_LAUNCH_POLL_MS,
  SPECTATOR_RUNNING_POLL_MS,
} from "@/lib/shared/spectator-view";
import type { TournamentSnapshot } from "@/lib/shared/types";
import { gunzipSync } from "node:zlib";
import { SPECTATOR_MAX_CONCURRENT_REBUILDS } from "@/lib/server/spectator-snapshot";
import { tournamentSnapshot } from "../../../helpers/tournament-detail";
import { tournamentCard } from "../../../helpers/tournament-card";
import { bracketMatch, matchCaster } from "../../../helpers/bracket-match";

/**
 * Lecture publique d'un tournoi : la route est appelée pour de vrai, cache,
 * plafond de débit et mesure de charge compris — seule la base est simulée.
 */

const params = (id: string) => ({ params: Promise.resolve({ id }) });

function req(id = "5", headers: Record<string, string> = {}): Request {
  return new Request(`http://localhost/api/spectator/tournaments/${id}`, {
    headers: { "x-forwarded-for": "203.0.113.7", ...headers },
  });
}

function snapshot(overrides: Partial<TournamentSnapshot> = {}): TournamentSnapshot {
  return tournamentSnapshot({
    card: tournamentCard({ id: 5, state: "RUNNING" }),
    matches: [
      bracketMatch({
        id: 1,
        tournamentId: 5,
        status: "COMPLETED",
        maps: [{ mapNumber: 1, replayCode: "SECRET1", team1Score: 3, team2Score: 1 }],
      }),
    ],
    version: "v42",
    ...overrides,
  });
}

const mockedSnapshot = jest.mocked(getVisibleTournamentSnapshot);
const mockedCard = jest.mocked(getVisibleTournamentCard);

beforeEach(() => {
  // Tournoi publié par défaut : la carte (lecture légère) passe avant l'instantané.
  mockedCard.mockResolvedValue(tournamentCard({ id: 5 }));
  clearCache();
  resetRateLimit();
  resetSpectatorLoad();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetAllMocks();
  resetSpectatorLoad();
});

describe("GET /api/spectator/tournaments/[id]", () => {
  it("sert l'instantané sans les codes de replay, avec son empreinte et la cadence accordée", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^"[\w-]{22}"$/);
    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_RUNNING_POLL_MS));
    // L'âge maximal annoncé compte la gigue et le cache partagé.
    expect(Number(res.headers.get(SPECTATOR_FRESHNESS_HEADER))).toBeGreaterThan(SPECTATOR_RUNNING_POLL_MS);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = (await res.json()) as TournamentSnapshot;
    expect(body.card.id).toBe(5);
    expect(body.matches[0].maps[0]).toMatchObject({ replayCode: "", team1Score: 3, team2Score: 1 });
    expect(JSON.stringify(body)).not.toContain("SECRET1");
  });

  it("passe par la porte de visibilité sans aucun droit, et ne lit jamais la session", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    await GET(req(), params("5"));

    expect(mockedCard).toHaveBeenCalledWith(5);
    expect(mockedSnapshot).toHaveBeenCalledWith(5);
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("répond 304 sans corps quand le client détient déjà cette version", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    const etag = (await GET(req(), params("5"))).headers.get("etag")!;

    const res = await GET(req("5", { "if-none-match": etag }), params("5"));

    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_RUNNING_POLL_MS));
  });

  it("reconnaît une empreinte faible ou une liste d'empreintes", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    const etag = (await GET(req(), params("5"))).headers.get("etag")!;

    expect((await GET(req("5", { "if-none-match": `W/${etag}` }), params("5"))).status).toBe(304);
    expect((await GET(req("5", { "if-none-match": `"v1", ${etag}` }), params("5"))).status).toBe(304);
    expect((await GET(req("5", { "if-none-match": '"v41"' }), params("5"))).status).toBe(200);
  });

  it("garde la même empreinte quand seul un champ retiré au public change", async () => {
    mockedSnapshot.mockResolvedValueOnce(snapshot());
    const first = (await GET(req(), params("5"))).headers.get("etag");
    clearCache();
    // Code de replay corrigé : nouvelle version pour les membres, rien de neuf pour le public.
    mockedSnapshot.mockResolvedValueOnce(
      snapshot({
        version: "v43",
        matches: [
          bracketMatch({
            id: 1,
            tournamentId: 5,
            status: "COMPLETED",
            maps: [{ mapNumber: 1, replayCode: "SECRET2", team1Score: 3, team2Score: 1 }],
          }),
        ],
      }),
    );
    const second = (await GET(req(), params("5"))).headers.get("etag");

    expect(second).toBe(first);
  });

  it("ne compte dans la charge que les lectures d'un tournoi servi", async () => {
    mockedSnapshot.mockResolvedValue(null);
    for (let i = 0; i < 5; i += 1) await GET(req(String(100 + i)), params(String(100 + i)));
    expect(spectatorReadsPerMinute()).toBe(0);

    mockedSnapshot.mockResolvedValue(snapshot());
    await GET(req(), params("5"));
    expect(spectatorReadsPerMinute()).toBe(1);
  });

  it("mutualise la lecture : deux visiteurs, une seule passe en base", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    await GET(req(), params("5"));
    await GET(req("5", { "x-forwarded-for": "198.51.100.9" }), params("5"));

    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("espace la relecture avant le coup d'envoi", async () => {
    mockedSnapshot.mockResolvedValue(snapshot({ card: tournamentCard({ id: 5, state: "REGISTRATION" }) }));

    const res = await GET(req(), params("5"));

    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_PRE_LAUNCH_POLL_MS));
  });

  it("relit un tournoi terminé au plus lent : un retour en arrière peut le rouvrir", async () => {
    mockedSnapshot.mockResolvedValue(snapshot({ card: tournamentCard({ id: 5, state: "FINISHED" }) }));

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(200);
    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(SPECTATOR_MAX_POLL_MS));
  });

  it("ne garde pas un « introuvable » : le tournoi publié ensuite s'ouvre aussitôt", async () => {
    mockedSnapshot.mockResolvedValueOnce(null).mockResolvedValueOnce(snapshot());

    expect((await GET(req(), params("5"))).status).toBe(404);
    expect((await GET(req(), params("5"))).status).toBe(200);
    expect(mockedSnapshot).toHaveBeenCalledTimes(2);
  });

  it("ne transmet pas l'identifiant du caster, mais garde les entrées solo (marche du podium)", async () => {
    mockedSnapshot.mockResolvedValue(
      snapshot({ soloUserIds: { 3: 77 }, matches: [bracketMatch({ id: 1, tournamentId: 5, casters: [matchCaster({ userId: 88 })] })] }),
    );

    const body = (await (await GET(req(), params("5"))).json()) as TournamentSnapshot;

    expect(body.soloUserIds).toEqual({ 3: 77 });
    expect(body.matches[0].casters.map((caster) => caster.userId)).toEqual([SPECTATOR_HIDDEN_USER_ID]);
  });

  it("arrête un tournoi non publié à sa carte, sans construire son instantané", async () => {
    mockedCard.mockResolvedValue(null);

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(404);
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  it("répond 404 pour un tournoi absent ou pas encore publié, sans dire lequel", async () => {
    mockedSnapshot.mockResolvedValue(null);

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
  });

  it("refuse un identifiant qui n'en est pas un, sans interroger la base", async () => {
    const res = await GET(req("abc"), params("abc"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    expect(mockedSnapshot).not.toHaveBeenCalled();
  });

  it("fait reculer le visiteur quand la base ne répond pas, d'une minute au calme", async () => {
    mockedSnapshot.mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.2:3306"));

    const res = await GET(req(), params("5"));

    expect(res.status).toBe(503);
    // Un incident bref ne fige pas la page dix minutes : 2 × 30 s au calme.
    expect(res.headers.get("retry-after")).toBe(String((2 * SPECTATOR_RUNNING_POLL_MS) / 1000));
    expect(res.headers.get(SPECTATOR_POLL_HEADER)).toBe(String(2 * SPECTATOR_RUNNING_POLL_MS));
    expect(Number(res.headers.get(SPECTATOR_POLL_HEADER))).toBeLessThan(SPECTATOR_MAX_POLL_MS);
    // Seul un code sort : ni hôte ni port de la base.
    expect(await res.json()).toEqual({ error: "TOURNAMENT_LOAD_FAILED" });
  });

  it("plafonne les lectures d'une même adresse", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());

    for (let i = 0; i < SPECTATOR_READ_RULE.limit; i += 1) {
      expect((await GET(req(), params("5"))).status).toBe(200);
    }
    const refused = await GET(req(), params("5"));

    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    // Une autre adresse passe toujours.
    expect((await GET(req("5", { "x-forwarded-for": "198.51.100.9" }), params("5"))).status).toBe(200);
  });

  it("plafonne à part les lectures qui font reconstruire la réponse, pas celles servies par le cache", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    // Une adresse parcourt des tournois froids : chacun coûte un instantané entier.
    for (let i = 1; i <= SPECTATOR_REBUILD_RULE.capacity; i += 1) {
      expect((await GET(req(String(i)), params(String(i)))).status).toBe(200);
    }
    expect(mockedSnapshot).toHaveBeenCalledTimes(SPECTATOR_REBUILD_RULE.capacity);

    // Une reconstruction ne lit la carte qu'une fois.
    expect(mockedCard).toHaveBeenCalledTimes(SPECTATOR_REBUILD_RULE.capacity);

    mockedCard.mockClear();
    const refused = await GET(req("1000"), params("1000"));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("retry-after")).not.toBeNull();
    // Refusée avant toute lecture en base, carte comprise.
    expect(mockedCard).not.toHaveBeenCalled();
    expect(mockedSnapshot).toHaveBeenCalledTimes(SPECTATOR_REBUILD_RULE.capacity);

    // Un tournoi déjà prêt reste servi à cette adresse : il ne coûte que le cache.
    expect((await GET(req("1"), params("1"))).status).toBe(200);
    // Et une autre adresse fait toujours reconstruire.
    expect((await GET(req("1000", { "x-forwarded-for": "198.51.100.9" }), params("1000"))).status).toBe(200);
    expect(mockedSnapshot).toHaveBeenCalledTimes(SPECTATOR_REBUILD_RULE.capacity + 1);
  });

  it("ne fait pas payer au plafond des reconstructions un identifiant inconnu ou pas encore publié", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    mockedCard.mockResolvedValue(null);
    // Des sondes au hasard (ou une salle qui ouvre un lien avant la publication)
    // reçoivent leur « introuvable », jamais un 429…
    for (let i = 1; i <= SPECTATOR_REBUILD_RULE.capacity + 5; i += 1) {
      const res = await GET(req(String(i)), params(String(i)));
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "TOURNAMENT_NOT_FOUND" });
    }
    expect(mockedSnapshot).not.toHaveBeenCalled();

    // … et la même adresse fait toujours reconstruire le tournoi qu'elle suit.
    mockedCard.mockResolvedValue(tournamentCard({ id: 5 }));
    expect((await GET(req("5"), params("5"))).status).toBe(200);
    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
  });

  it("ne fait payer qu'une reconstruction quand deux lectures froides se croisent", async () => {
    const pending: { release?: (value: TournamentSnapshot) => void } = {};
    mockedSnapshot.mockReturnValue(
      new Promise<TournamentSnapshot>((resolve) => {
        pending.release = resolve;
      }),
    );
    const first = GET(req("5"), params("5"));
    const second = GET(req("5"), params("5"));
    // Laisse les deux lectures passer la carte, puis termine le calcul.
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    pending.release?.(snapshot());

    expect((await first).status).toBe(200);
    expect((await second).status).toBe(200);
    expect(mockedSnapshot).toHaveBeenCalledTimes(1);
    // Une seule lecture de la carte pour les deux, et un seul jeton.
    expect(mockedCard).toHaveBeenCalledTimes(1);
    expect(tokensLeft(SPECTATOR_REBUILD_RULE, "203.0.113.7")).toBe(SPECTATOR_REBUILD_RULE.capacity - 1);
  });

  it("rend le jeton d'une reconstruction qui échoue : une panne brève n'épuise pas une salle", async () => {
    mockedSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));
    for (let i = 0; i < SPECTATOR_REBUILD_RULE.capacity + 3; i += 1) {
      expect((await GET(req("5"), params("5"))).status).toBe(503);
    }
    mockedSnapshot.mockResolvedValue(snapshot());
    expect((await GET(req("5"), params("5"))).status).toBe(200);
  });

  describe("réseau sans jeton, copie échue de moins de 150 s", () => {
    const CLOCK = { now: 5_000_000, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] as const };

    /** Une réponse construite, expirée, puis le seau du réseau vidé. */
    async function exhaustedNetworkWithCopy(): Promise<Response> {
      mockedSnapshot.mockResolvedValue(snapshot());
      const first = await GET(req("5", { "accept-encoding": "identity" }), params("5"));
      jest.setSystemTime(5_000_000 + 20_000);
      for (let i = 1; i <= SPECTATOR_REBUILD_RULE.capacity; i += 1) {
        expect((await GET(req(String(100 + i)), params(String(100 + i)))).status).toBe(200);
      }
      mockedSnapshot.mockClear();
      return first;
    }

    it("refuse en 429, copie ou non : la réponse ne dit pas si le tournoi vient d'être lu", async () => {
      jest.useFakeTimers({ ...CLOCK, doNotFake: [...CLOCK.doNotFake] });
      try {
        await exhaustedNetworkWithCopy();

        const refused = await GET(req("5", { "accept-encoding": "identity" }), params("5"));
        expect(refused.status).toBe(429);
        expect(refused.headers.get("retry-after")).not.toBeNull();
        expect(mockedSnapshot).not.toHaveBeenCalled();
        // Sans copie non plus.
        expect((await GET(req("999"), params("999"))).status).toBe(429);
      } finally {
        jest.useRealTimers();
      }
    });

    it("répond 304 à qui détient déjà la version de la copie, sans corps", async () => {
      jest.useFakeTimers({ ...CLOCK, doNotFake: [...CLOCK.doNotFake] });
      try {
        const first = await exhaustedNetworkWithCopy();

        const res = await GET(
          req("5", { "accept-encoding": "identity", "if-none-match": first.headers.get("etag") ?? "" }),
          params("5"),
        );
        expect(res.status).toBe(304);
        expect(await res.text()).toBe("");
        expect(Number(res.headers.get(SPECTATOR_FRESHNESS_HEADER))).toBeGreaterThanOrEqual(SPECTATOR_MAX_COPY_AGE_MS);
      } finally {
        jest.useRealTimers();
      }
    });

    it("répond 304 aussi à un client gzip qui détient la version du corps compressé", async () => {
      jest.useFakeTimers({ ...CLOCK, doNotFake: [...CLOCK.doNotFake] });
      try {
        mockedSnapshot.mockResolvedValue(snapshot());
        const first = await GET(req("5", { "accept-encoding": "gzip" }), params("5"));
        expect(first.headers.get("etag")).toMatch(/-gzip"$/);
        jest.setSystemTime(5_000_000 + 20_000);
        for (let i = 1; i <= SPECTATOR_REBUILD_RULE.capacity; i += 1) await GET(req(String(100 + i)), params(String(100 + i)));

        const res = await GET(
          req("5", { "accept-encoding": "gzip", "if-none-match": first.headers.get("etag") ?? "" }),
          params("5"),
        );
        expect(res.status).toBe(304);
      } finally {
        jest.useRealTimers();
      }
    });

    it("répond 429 au-delà de l'âge déclaré, même avec la version en main", async () => {
      jest.useFakeTimers({ ...CLOCK, doNotFake: [...CLOCK.doNotFake] });
      try {
        const first = await exhaustedNetworkWithCopy();
        jest.setSystemTime(5_000_000 + SPECTATOR_MAX_COPY_AGE_MS);
        for (let i = 1; i <= SPECTATOR_REBUILD_RULE.capacity; i += 1) {
          await GET(req(String(200 + i)), params(String(200 + i)));
        }

        const res = await GET(
          req("5", { "accept-encoding": "identity", "if-none-match": first.headers.get("etag") ?? "" }),
          params("5"),
        );
        expect(res.status).toBe(429);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  it("sert la copie de moins de 150 s quand la base échoue, au lieu d'un 503", async () => {
    jest.useFakeTimers({ now: 6_000_000, doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
    try {
      mockedSnapshot.mockResolvedValue(snapshot());
      expect((await GET(req("5"), params("5"))).status).toBe(200);
      jest.setSystemTime(6_000_000 + 20_000);
      mockedSnapshot.mockRejectedValue(new Error("ECONNREFUSED"));

      const served = await GET(req("5"), params("5"));
      expect(served.status).toBe(200);
      expect(Number(served.headers.get(SPECTATOR_FRESHNESS_HEADER))).toBeGreaterThanOrEqual(SPECTATOR_MAX_COPY_AGE_MS);
      // Au-delà de l'âge déclaré : le 503.
      jest.setSystemTime(6_000_000 + SPECTATOR_MAX_COPY_AGE_MS);
      expect((await GET(req("5"), params("5"))).status).toBe(503);
    } finally {
      jest.useRealTimers();
    }
  });

  it("donne un ETag par codage : le corps gzip porte le suffixe -gzip", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    const plain = await GET(req("5", { "accept-encoding": "identity" }), params("5"));
    const gzipped = await GET(req("5", { "accept-encoding": "gzip" }), params("5"));

    expect(gzipped.headers.get("content-encoding")).toBe("gzip");
    expect(plain.headers.get("etag")).toMatch(/^"[\w-]{22}"$/);
    expect(gzipped.headers.get("etag")).toBe(`${plain.headers.get("etag")?.slice(0, -1)}-gzip"`);
    // La version d'un codage ne valide pas l'autre.
    const crossed = await GET(
      req("5", { "accept-encoding": "gzip", "if-none-match": plain.headers.get("etag") ?? "" }),
      params("5"),
    );
    expect(crossed.status).toBe(200);
  });

  it("répond 503 quand toutes les places de construction sont prises, sans faire payer", async () => {
    const releases: Array<() => void> = [];
    mockedSnapshot.mockImplementation(
      (id) =>
        new Promise<TournamentSnapshot>((resolve) => {
          releases.push(() => resolve(snapshot({ card: tournamentCard({ id, state: "RUNNING" }) })));
        }),
    );
    const running = Array.from({ length: SPECTATOR_MAX_CONCURRENT_REBUILDS }, (_, index) =>
      GET(req(String(index + 1), { "x-forwarded-for": `198.51.100.${index + 1}` }), params(String(index + 1))),
    );
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
    expect(releases).toHaveLength(SPECTATOR_MAX_CONCURRENT_REBUILDS);

    const busy = await GET(req("40"), params("40"));
    expect(busy.status).toBe(503);
    expect(busy.headers.get("retry-after")).not.toBeNull();
    expect(await busy.json()).toEqual({ error: "TOURNAMENT_LOAD_FAILED" });
    expect(tokensLeft(SPECTATOR_REBUILD_RULE, "203.0.113.7")).toBe(SPECTATOR_REBUILD_RULE.capacity);

    for (const release of releases) release();
    expect((await Promise.all(running)).map((res) => res.status)).toEqual(
      Array.from({ length: SPECTATOR_MAX_CONCURRENT_REBUILDS }, () => 200),
    );
  });

  it("compresse le corps quand le client l'accepte, une fois pour tous", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    const plain = await GET(req("5"), params("5"));
    const body = await plain.text();
    expect(plain.headers.get("content-encoding")).toBeNull();
    expect(plain.headers.get("vary")).toBe("Accept-Encoding");

    const zipped = await GET(req("5", { "accept-encoding": "gzip, deflate, br" }), params("5"));
    expect(zipped.headers.get("content-encoding")).toBe("gzip");
    expect(zipped.headers.get("vary")).toBe("Accept-Encoding");
    expect(gunzipSync(Buffer.from(await zipped.arrayBuffer())).toString("utf8")).toBe(body);
  });

  it("compte un réseau IPv6 /64 comme un seul client", async () => {
    mockedSnapshot.mockResolvedValue(snapshot());
    for (let i = 0; i < SPECTATOR_READ_RULE.limit; i += 1) {
      // Une adresse différente à chaque lecture, dans le même /64.
      const ip = `2001:db8:1:2::${(i + 1).toString(16)}`;
      expect((await GET(req("5", { "x-forwarded-for": ip }), params("5"))).status).toBe(200);
    }
    expect((await GET(req("5", { "x-forwarded-for": "2001:db8:1:2:ffff::9" }), params("5"))).status).toBe(429);
    // Un autre /64 passe.
    expect((await GET(req("5", { "x-forwarded-for": "2001:db8:1:3::1" }), params("5"))).status).toBe(200);
  });

  it("ne lit qu'une fois la carte d'un identifiant introuvable demandé par plusieurs lectures simultanées", async () => {
    mockedCard.mockResolvedValue(null);

    const responses = await Promise.all([1, 2, 3].map(() => GET(req("7"), params("7"))));

    expect(responses.map((res) => res.status)).toEqual([404, 404, 404]);
    expect(mockedCard).toHaveBeenCalledTimes(1);
    // Rien n'est gardé : le tournoi publié ensuite s'ouvre à la lecture suivante.
    mockedCard.mockResolvedValue(tournamentCard({ id: 7 }));
    mockedSnapshot.mockResolvedValue(snapshot());
    expect((await GET(req("7"), params("7"))).status).toBe(200);
  });
});
