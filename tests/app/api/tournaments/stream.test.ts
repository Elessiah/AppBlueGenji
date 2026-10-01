import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { constants as zlibConstants, gunzipSync } from "node:zlib";
import type { TournamentSnapshot, TournamentViewerContext } from "@/lib/shared/types";

/**
 * La route de flux porte plusieurs décisions qu'aucun autre test n'exerce : le
 * palier est résolu **par le serveur**, les plafonds s'appliquent, et la place
 * de flux est rendue par toutes les sorties. On l'appelle donc pour de vrai,
 * comme le projet le fait pour ses autres routes (`admin/seeding.test.ts`).
 */
jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");

import { GET } from "@/app/api/tournaments/[id]/stream/route";
import { currentTokenHash, getCurrentUser } from "@/lib/server/auth";
import {
  closeSessionStreams,
  closeUserStreams,
  registeredStreamCount,
  resetSessionStreams,
} from "@/lib/server/session-streams";
import {
  getVisibleTournamentSnapshot,
  getTournamentViewerContext,
} from "@/lib/server/tournaments-service";
import { resetRateLimit } from "@/lib/server/rate-limit";
import {
  MAX_STREAMS_PER_USER,
  resetTournamentBroadcast,
  tournamentAudience,
} from "@/lib/server/tournament-broadcast";
import {
  STREAM_QUEUE_HIGH_WATER_BYTES,
  STREAM_STALL_TIMEOUT_MS,
} from "@/lib/server/stream-backpressure";
import type { PlatformRole } from "@/lib/shared/permissions";
import { authUser } from "../../../helpers/auth-user";
import * as snapshotModule from "@/lib/server/tournaments/snapshot";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

/**
 * Droits que la route a résolus pour le lecteur. Objet nommé côté production :
 * on le lit par ses clés, et non par une position que le moindre paramètre
 * ajouté décalerait.
 */
function rightsPassedToViewerContext(): {
  canManage?: boolean;
  canPreview?: boolean;
  canManageLive?: boolean;
  canDelete?: boolean;
} {
  return jest.mocked(getTournamentViewerContext).mock.calls[0][2] as Record<string, boolean>;
}

function snapshotWith(registrations: { teamId: number }[]): TournamentSnapshot {
  return {
    card: { id: 5, participantType: "TEAM", state: "RUNNING" },
    matches: [],
    registrations,
    survival: null,
    swiss: null,
    endurance: null,
    phases: null,
    currentPhaseId: null,
    phaseStandings: {},
    soloUserIds: {},
    version: "v1",
  } as unknown as TournamentSnapshot;
}

function viewerWith(overrides: Partial<TournamentViewerContext> = {}): TournamentViewerContext {
  return {
    canRegister: false,
    canRegisterEntrant: true,
    registrationBlock: null,
    myTeamId: null,
    canCreateReportsForTeamIds: [],
    isAdmin: false,
    canDelete: false,
    canManageLive: false,
    viewerUserId: 1,
    castBlock: "NOT_CASTER",
    preview: null,
    ...overrides,
  };
}

/** Lit le premier message SSE de la réponse, puis annule le flux. */
async function firstMessage(response: Response): Promise<Record<string, unknown>> {
  const reader = response.body!.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  const text = new TextDecoder().decode(value);
  return JSON.parse(text.slice("data: ".length, -2));
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  resetTournamentBroadcast();
  resetSessionStreams();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: false, roles: [] }));
  jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(snapshotWith([]));
  jest.mocked(getTournamentViewerContext).mockResolvedValue(viewerWith());
});

afterEach(() => {
  resetRateLimit();
  resetTournamentBroadcast();
  jest.restoreAllMocks();
});

describe("GET /api/tournaments/[id]/stream — accès", () => {
  it("refuse un visiteur non connecté", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET(new Request("http://t/"), params("5"))).status).toBe(401);
  });

  it("refuse un identifiant invalide", async () => {
    expect((await GET(new Request("http://t/"), params("abc"))).status).toBe(400);
    expect((await GET(new Request("http://t/"), params("0"))).status).toBe(400);
  });

  it("répond 404 sur un tournoi inconnu plutôt que d'ouvrir un flux vide", async () => {
    // C'est ce 404 que la lecture de secours du client traduit en échec
    // définitif : sans lui, la page réessaierait pour l'éternité.
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(null);
    expect((await GET(new Request("http://t/"), params("5"))).status).toBe(404);
  });
});

describe("GET /api/tournaments/[id]/stream — palier décidé par le serveur", () => {
  it("sert le palier standard à un simple spectateur", async () => {
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("STANDARD");
  });

  it("passe le staff tournois en prioritaire", async () => {
    // Le palier se lit sur les permissions de l'utilisateur, pas sur le contexte
    // du lecteur : c'est le serveur qui décide, à partir du rôle.
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({ id: 1, isAdmin: false, roles: ["ARBITRE"] }),
    );
    jest.mocked(getTournamentViewerContext).mockResolvedValue(
      viewerWith({ isAdmin: true }),
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("PRIORITY");
  });

  it("passe un caster en prioritaire", async () => {
    // Le caster commente le match pendant qu'il se joue : le laisser au palier
    // spectateur lui ferait décrire un plateau vieux de vingt secondes. Il n'a
    // pourtant pas la permission `tournaments` — son palier se lit sur son rôle,
    // pas sur `viewer.isAdmin`.
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({ id: 1, isAdmin: false, roles: ["CASTER"] }),
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("PRIORITY");
    // Et il reste sans droit d'écriture : le palier n'accorde rien d'autre.
    expect(message.viewer).toMatchObject({ isAdmin: false });
  });

  it("passe un engagé du tournoi en prioritaire", async () => {
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(
      snapshotWith([{ teamId: 42 }]),
    );
    jest.mocked(getTournamentViewerContext).mockResolvedValue(
      viewerWith({ myTeamId: 42 }),
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("PRIORITY");
  });

  it("sert le palier standard à un engagé qui le demande (onglet caché, `?quiet=1`)", async () => {
    // Régime de charge (`lib/shared/client-power.ts`) : un onglet caché depuis
    // une minute, hors match, se déclasse lui-même pour libérer la salle.
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(
      snapshotWith([{ teamId: 42 }]),
    );
    jest.mocked(getTournamentViewerContext).mockResolvedValue(
      viewerWith({ myTeamId: 42 }),
    );
    const message = await firstMessage(await GET(new Request("http://t/?quiet=1"), params("5")));
    expect(message.tier).toBe("STANDARD");
  });

  it("ne promeut jamais un spectateur, quoi que dise la requête", async () => {
    // Le paramètre ne sait que déclasser : toute autre valeur est ignorée, et
    // aucune ne fait passer un spectateur devant.
    for (const url of ["http://t/?quiet=0", "http://t/?quiet=PRIORITY", "http://t/?tier=PRIORITY"]) {
      const message = await firstMessage(await GET(new Request(url), params("5")));
      expect(message.tier).toBe("STANDARD");
    }
  });

  it("ne déclasse que sur `quiet=1` exactement", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({ id: 1, isAdmin: false, roles: ["ARBITRE"] }),
    );
    const kept = await firstMessage(await GET(new Request("http://t/?quiet=true"), params("5")));
    expect(kept.tier).toBe("PRIORITY");
    const quiet = await firstMessage(await GET(new Request("http://t/?quiet=1"), params("5")));
    expect(quiet.tier).toBe("STANDARD");
  });

  it("laisse en standard une équipe qui n'est pas inscrite ici", async () => {
    // Avoir une équipe ne suffit pas : il faut être engagé dans CE tournoi.
    jest.mocked(getTournamentViewerContext).mockResolvedValue(
      viewerWith({ myTeamId: 42 }),
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("STANDARD");
  });

  it("accorde les commandes d'antenne selon la permission `live`", async () => {
    // Le flux est le chemin nominal : la lecture REST ne sert qu'en secours. Si
    // le droit de diffusion ne voyageait que par elle, un arbitre n'aurait ses
    // commandes d'antenne qu'après une coupure du direct.
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({ id: 1, isAdmin: false, roles: ["CASTER"] }),
    );
    await firstMessage(await GET(new Request("http://t/"), params("5")));

    expect(rightsPassedToViewerContext().canManageLive).toBe(true);
  });

  it("refuse les commandes d'antenne à qui n'a pas la permission", async () => {
    await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(rightsPassedToViewerContext().canManageLive).toBe(false);
  });

  it("rejoint la salle partagée plutôt que de s'abonner seul", async () => {
    // Sinon chaque spectateur recalculerait le détail pour lui-même — cent fois
    // le même travail, en même temps.
    expect(tournamentAudience(5)).toBe(0);
    const response = await GET(new Request("http://t/"), params("5"));
    expect(tournamentAudience(5)).toBe(1);
    await response.body!.cancel();
    expect(tournamentAudience(5)).toBe(0);
  });

  it("envoie l'instantané et le contexte du lecteur d'emblée", async () => {
    // C'est ce qui supprime le `GET /api/tournaments/:id` du cas nominal.
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.type).toBe("connected");
    expect(message.snapshot).toMatchObject({ version: "v1" });
    expect(message.viewer).toMatchObject({ isAdmin: false });
  });
});

describe("GET /api/tournaments/[id]/stream — droit de suppression", () => {
  it("accorde la suppression à un administrateur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] }),
    );

    await GET(new Request("http://t/"), params("5"));

    expect(rightsPassedToViewerContext().canDelete).toBe(true);
  });

  it.each<[string, PlatformRole[]]>([
    ["un arbitre", ["ARBITRE"]],
    ["un caster", ["CASTER"]],
    ["un joueur ordinaire", []],
  ])("la refuse à %s, malgré la permission `tournaments`", async (_label, roles) => {
    // Le droit doit voyager par les deux portes — ce flux et la lecture REST de
    // secours —, et se refuser à l'identique sur les deux.
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 2, isAdmin: false, roles }));

    await GET(new Request("http://t/"), params("5"));

    expect(rightsPassedToViewerContext().canDelete).toBe(false);
  });
});

describe("GET /api/tournaments/[id]/stream — révocation de la session", () => {
  beforeEach(() => {
    jest.mocked(currentTokenHash).mockResolvedValue("empreinte-A");
  });

  /** Lit jusqu'à la fin du flux ; rend `true` s'il s'est terminé. */
  async function drainsToEnd(response: Response): Promise<boolean> {
    const reader = response.body!.getReader();
    for (let i = 0; i < 10; i += 1) {
      const { done } = await reader.read();
      if (done) return true;
    }
    return false;
  }

  it("ferme un flux ouvert quand les sessions du compte sont révoquées", async () => {
    const response = await GET(new Request("http://t/"), params("5"));
    expect(response.status).toBe(200);
    expect(registeredStreamCount()).toBe(1);

    expect(closeUserStreams(1)).toBe(1);

    expect(await drainsToEnd(response)).toBe(true);
    expect(registeredStreamCount()).toBe(0);
    // La place de flux est rendue avec lui.
    expect(tournamentAudience(5)).toBe(0);
  });

  it("ferme le flux de la session qui se déconnecte", async () => {
    const response = await GET(new Request("http://t/"), params("5"));
    expect(closeSessionStreams("empreinte-A")).toBe(1);
    expect(await drainsToEnd(response)).toBe(true);
  });

  it("laisse ouvert le flux de la session gardée", async () => {
    const response = await GET(new Request("http://t/"), params("5"));
    expect(closeUserStreams(1, { keepTokenHash: "empreinte-A" })).toBe(0);
    expect(registeredStreamCount()).toBe(1);
    await response.body!.cancel();
    expect(registeredStreamCount()).toBe(0);
  });

  it("répond 401 quand la session tombe pendant les lectures d'ouverture", async () => {
    jest.mocked(getVisibleTournamentSnapshot).mockImplementation(async () => {
      closeUserStreams(1);
      return snapshotWith([]);
    });

    const response = await GET(new Request("http://t/"), params("5"));
    expect(response.status).toBe(401);
    expect(registeredStreamCount()).toBe(0);
    expect(tournamentAudience(5)).toBe(0);
  });

  it.each<[string, () => void]>([
    ["404", () => jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(null)],
    ["400", () => undefined],
  ])("ne laisse aucune inscription derrière un refus %s", async (status, arrange) => {
    arrange();
    const id = status === "400" ? "abc" : "5";
    const response = await GET(new Request("http://t/"), params(id));
    expect(String(response.status)).toBe(status);
    expect(registeredStreamCount()).toBe(0);
  });

  it("répond 401 quand la révocation tombe pendant la lecture de la session elle-même", async () => {
    // Aucun flux n'est encore inscrit : seule la trace de la révocation le rattrape.
    jest.mocked(getCurrentUser).mockImplementation(async () => {
      closeUserStreams(1);
      return authUser({ id: 1, isAdmin: false, roles: [] });
    });

    const response = await GET(new Request("http://t/"), params("5"));
    expect(response.status).toBe(401);
    expect(registeredStreamCount()).toBe(0);
    expect(getVisibleTournamentSnapshot).not.toHaveBeenCalled();
  });

  it("ouvre normalement quand la révocation pendant la lecture gardait cette session", async () => {
    jest.mocked(getCurrentUser).mockImplementation(async () => {
      closeUserStreams(1, { keepTokenHash: "empreinte-A" });
      return authUser({ id: 1, isAdmin: false, roles: [] });
    });

    const response = await GET(new Request("http://t/"), params("5"));
    expect(response.status).toBe(200);
    await response.body!.cancel();
  });

  it("ignore une révocation antérieure à l'ouverture", async () => {
    closeUserStreams(1);
    const response = await GET(new Request("http://t/"), params("5"));
    expect(response.status).toBe(200);
    await response.body!.cancel();
  });

  it("désinscrit le flux quand une lecture d'ouverture lève", async () => {
    jest.mocked(getVisibleTournamentSnapshot).mockRejectedValue(new Error("db down"));
    await expect(GET(new Request("http://t/"), params("5"))).rejects.toThrow("db down");
    expect(registeredStreamCount()).toBe(0);
  });

  it("ne laisse aucune inscription derrière une requête déjà abandonnée", async () => {
    const controller = new AbortController();
    controller.abort();
    const response = await GET(new Request("http://t/", { signal: controller.signal }), params("5"));
    expect(response.status).toBe(204);
    expect(registeredStreamCount()).toBe(0);
  });

  it("ne laisse aucune inscription derrière le plafond de flux simultanés", async () => {
    const opened: Response[] = [];
    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) {
      opened.push(await GET(new Request("http://t/"), params("5")));
    }
    expect((await GET(new Request("http://t/"), params("5"))).status).toBe(429);
    expect(registeredStreamCount()).toBe(MAX_STREAMS_PER_USER);
    expect(closeUserStreams(1)).toBe(MAX_STREAMS_PER_USER);
    expect(opened).toHaveLength(MAX_STREAMS_PER_USER);
  });
});

describe("GET /api/tournaments/[id]/stream — plafonds", () => {
  it("refuse au-delà du plafond de flux simultanés", async () => {
    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) {
      const response = await GET(new Request("http://t/"), params("5"));
      expect(response.status).toBe(200);
    }

    const refused = await GET(new Request("http://t/"), params("5"));
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe("30");
  });

  it("rend la place quand le client s'en va", async () => {
    // Sans cela, quatre F5 rapides suffiraient à se voir refuser son propre
    // tournoi jusqu'au redémarrage du serveur.
    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) {
      const response = await GET(new Request("http://t/"), params("5"));
      await response.body!.cancel();
    }

    expect((await GET(new Request("http://t/"), params("5"))).status).toBe(200);
  });

  it("ne réserve aucune place pour une requête déjà abandonnée", async () => {
    const controller = new AbortController();
    controller.abort();

    for (let i = 0; i < MAX_STREAMS_PER_USER + 2; i += 1) {
      const response = await GET(
        new Request("http://t/", { signal: controller.signal }),
        params("5"),
      );
      expect(response.status).toBe(204);
    }

    // Le plafond n'a pas bougé : un flux normal passe toujours.
    expect((await GET(new Request("http://t/"), params("5"))).status).toBe(200);
  });

  it("borne le rythme d'ouverture, que le plafond simultané laisse passer", async () => {
    // Une fermeture libère aussitôt la place : sans ce second plafond, une
    // boucle ouverture/fermeture referait indéfiniment le travail le plus cher.
    let refused = 0;
    for (let i = 0; i < 40; i += 1) {
      const response = await GET(new Request("http://t/"), params("5"));
      if (response.status === 429) refused += 1;
      else await response.body!.cancel();
    }
    expect(refused).toBeGreaterThan(0);
  });

  it("annonce le bon en-tête de flux", async () => {
    const response = await GET(new Request("http://t/"), params("5"));
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    // Neutralise la mise en tampon d'un reverse proxy, qui ferait croire à un
    // flux mort.
    expect(response.headers.get("X-Accel-Buffering")).toBe("no");
    await response.body!.cancel();
  });
});

describe("GET /api/tournaments/[id]/stream — contre-pression", () => {
  beforeEach(() => {
    // Le temps avancé réveille le battement d'entretien de la salle, qui relit
    // l'instantané : sans ce double, il ouvrirait une vraie connexion MySQL.
    jest
      .spyOn(snapshotModule, "getTournamentSnapshotFrame")
      .mockRejectedValue(new Error("hors ligne"));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  /** Instantané dont la trame d'ouverture remplit à elle seule la file. */
  function oversizedSnapshot(): TournamentSnapshot {
    return {
      ...snapshotWith([]),
      filler: "x".repeat(STREAM_QUEUE_HIGH_WATER_BYTES + 1),
    } as unknown as TournamentSnapshot;
  }

  it("ferme un flux dont le client ne lit plus, au lieu d'empiler les trames", async () => {
    jest.useFakeTimers();
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(oversizedSnapshot());

    // Personne ne lit : la trame d'ouverture reste en file, pleine.
    const response = await GET(new Request("http://t/"), params("5"));
    expect(response.status).toBe(200);
    expect(tournamentAudience(5)).toBe(1);

    // Premier battement : file pleine, le ping est sauté, la connexion tient.
    jest.advanceTimersByTime(25_000);
    expect(tournamentAudience(5)).toBe(1);

    // File toujours pleine au-delà du délai : la connexion est fermée, et sa
    // place de flux rendue.
    jest.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS + 25_000);
    expect(tournamentAudience(5)).toBe(0);
    await expect(response.body!.getReader().read()).rejects.toThrow("STREAM_STALLED");

    jest.useRealTimers();
    for (let i = 0; i < MAX_STREAMS_PER_USER; i += 1) {
      const next = await GET(new Request("http://t/"), params("5"));
      expect(next.status).toBe(200);
      await next.body!.cancel();
    }
  });

  it("laisse ouvert un flux que le client lit", async () => {
    jest.useFakeTimers();
    const response = await GET(new Request("http://t/"), params("5"));
    const reader = response.body!.getReader();
    await reader.read();

    jest.advanceTimersByTime(STREAM_STALL_TIMEOUT_MS * 3);
    expect(tournamentAudience(5)).toBe(1);
    await reader.cancel();
  });
});

describe("GET /api/tournaments/[id]/stream — garde de visibilité", () => {
  /** Droits passés à la garde de visibilité : `[id, { canManage }]`. */
  function visibilityCall() {
    return jest.mocked(getVisibleTournamentSnapshot).mock.calls[0];
  }

  it("lit sans droit de gestion pour un simple spectateur", async () => {
    // Le flux est le chemin nominal : si la garde n'était posée que sur la
    // lecture REST de secours, elle ne servirait à rien tant que le direct tient.
    const response = await GET(new Request("http://t/"), params("5"));
    await response.body!.cancel();

    expect(visibilityCall()).toEqual([5, { canManage: false }]);
  });

  it("accorde la gestion à un arbitre, qui voit donc les tournois non publiés", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({ id: 1, isAdmin: false, roles: ["ARBITRE"] }),
    );

    const response = await GET(new Request("http://t/"), params("5"));
    await response.body!.cancel();

    expect(visibilityCall()).toEqual([5, { canManage: true }]);
  });

  it("laisse le cast sans droit de gestion : il ne voit pas les tournois non publiés", async () => {
    // `casting` donne l'aperçu du plateau, pas l'accès à un tournoi que le staff
    // n'a pas encore annoncé — c'est déjà l'audience de la liste des invisibles.
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({ id: 1, isAdmin: false, roles: ["CASTER"] }),
    );

    const response = await GET(new Request("http://t/"), params("5"));
    await response.body!.cancel();

    expect(visibilityCall()).toEqual([5, { canManage: false }]);
  });

  it("répond 404 — et non 403 — quand la garde refuse", async () => {
    // Un 403 confirmerait l'existence du tournoi qu'on cherche justement à
    // cacher, l'identifiant étant un entier consécutif.
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(null);

    const response = await GET(new Request("http://t/"), params("5"));

    expect(response.status).toBe(404);
  });
});

/**
 * Le flux partait en clair — 238 Ko par instantané sur un gros plateau. Il est
 * désormais compressé pour tout client qui accepte gzip (tout navigateur, pour
 * `EventSource`), sans tampon : chaque trame se décode dès son arrivée.
 */
describe("GET /api/tournaments/[id]/stream — compression", () => {
  const gzipRequest = () =>
    new Request("http://t/", { headers: { "Accept-Encoding": "gzip, br" } });

  /** Lit ce qui est déjà en file : l'en-tête gzip, puis la trame d'ouverture. */
  async function readOpening(response: Response): Promise<Buffer> {
    const reader = response.body!.getReader();
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < 2; i += 1) {
      const { value } = await reader.read();
      if (value) chunks.push(value);
    }
    await reader.cancel();
    return Buffer.concat(chunks);
  }

  it("compresse le flux d'un client qui accepte gzip", async () => {
    const response = await GET(gzipRequest(), params("5"));

    expect(response.headers.get("Content-Encoding")).toBe("gzip");
    expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    // `no-transform` reste : il écarte la compression tamponnante d'un tiers.
    expect(response.headers.get("Cache-Control")).toContain("no-transform");

    const text = gunzipSync(await readOpening(response), {
      finishFlush: zlibConstants.Z_SYNC_FLUSH,
    }).toString("utf8");
    const message = JSON.parse(text.slice("data: ".length, -2));
    expect(message.type).toBe("connected");
    expect(message.snapshot).toEqual(snapshotWith([]));
    expect(message.tier).toBe("STANDARD");
  });

  it("laisse le flux en clair pour un client qui ne l'annonce pas", async () => {
    const response = await GET(new Request("http://t/"), params("5"));

    expect(response.headers.get("Content-Encoding")).toBeNull();
    const message = await firstMessage(response);
    expect(message.type).toBe("connected");
    expect(message.snapshot).toEqual(snapshotWith([]));
  });

  it("n'emploie pas gzip quand le client le refuse explicitement", async () => {
    const response = await GET(
      new Request("http://t/", { headers: { "Accept-Encoding": "gzip;q=0, br" } }),
      params("5"),
    );
    expect(response.headers.get("Content-Encoding")).toBeNull();
    await response.body!.cancel();
  });
});
