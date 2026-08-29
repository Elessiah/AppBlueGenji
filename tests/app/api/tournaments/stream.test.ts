import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
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
import { getCurrentUser } from "@/lib/server/auth";
import {
  getTournamentSnapshot,
  getTournamentViewerContext,
} from "@/lib/server/tournaments-service";
import { resetRateLimit } from "@/lib/server/rate-limit";
import {
  MAX_STREAMS_PER_USER,
  resetTournamentBroadcast,
  tournamentAudience,
} from "@/lib/server/tournament-broadcast";

const params = (id: string) => ({ params: Promise.resolve({ id }) });

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
    myTeamId: null,
    canCreateReportsForTeamIds: [],
    isAdmin: false,
    canDelete: false,
    canManageLive: false,
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
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 1, isAdmin: false, roles: [] } as never);
  (getTournamentSnapshot as jest.Mock).mockResolvedValue(snapshotWith([]) as never);
  (getTournamentViewerContext as jest.Mock).mockResolvedValue(viewerWith() as never);
});

afterEach(() => {
  resetRateLimit();
  resetTournamentBroadcast();
  jest.restoreAllMocks();
});

describe("GET /api/tournaments/[id]/stream — accès", () => {
  it("refuse un visiteur non connecté", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);
    expect((await GET(new Request("http://t/"), params("5"))).status).toBe(401);
  });

  it("refuse un identifiant invalide", async () => {
    expect((await GET(new Request("http://t/"), params("abc"))).status).toBe(400);
    expect((await GET(new Request("http://t/"), params("0"))).status).toBe(400);
  });

  it("répond 404 sur un tournoi inconnu plutôt que d'ouvrir un flux vide", async () => {
    // C'est ce 404 que la lecture de secours du client traduit en échec
    // définitif : sans lui, la page réessaierait pour l'éternité.
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(null as never);
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
    (getCurrentUser as jest.Mock).mockResolvedValue(
      { id: 1, isAdmin: false, roles: ["ARBITRE"] } as never,
    );
    (getTournamentViewerContext as jest.Mock).mockResolvedValue(
      viewerWith({ isAdmin: true }) as never,
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("PRIORITY");
  });

  it("passe un caster en prioritaire", async () => {
    // Le caster commente le match pendant qu'il se joue : le laisser au palier
    // spectateur lui ferait décrire un plateau vieux de vingt secondes. Il n'a
    // pourtant pas la permission `tournaments` — son palier se lit sur son rôle,
    // pas sur `viewer.isAdmin`.
    (getCurrentUser as jest.Mock).mockResolvedValue(
      { id: 1, isAdmin: false, roles: ["CASTER"] } as never,
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("PRIORITY");
    // Et il reste sans droit d'écriture : le palier n'accorde rien d'autre.
    expect(message.viewer).toMatchObject({ isAdmin: false });
  });

  it("passe un engagé du tournoi en prioritaire", async () => {
    (getTournamentSnapshot as jest.Mock).mockResolvedValue(
      snapshotWith([{ teamId: 42 }]) as never,
    );
    (getTournamentViewerContext as jest.Mock).mockResolvedValue(
      viewerWith({ myTeamId: 42 }) as never,
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("PRIORITY");
  });

  it("laisse en standard une équipe qui n'est pas inscrite ici", async () => {
    // Avoir une équipe ne suffit pas : il faut être engagé dans CE tournoi.
    (getTournamentViewerContext as jest.Mock).mockResolvedValue(
      viewerWith({ myTeamId: 42 }) as never,
    );
    const message = await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect(message.tier).toBe("STANDARD");
  });

  it("accorde les commandes d'antenne selon la permission `live`", async () => {
    // Le flux est le chemin nominal : la lecture REST ne sert qu'en secours. Si
    // le droit de diffusion ne voyageait que par elle, un arbitre n'aurait ses
    // commandes d'antenne qu'après une coupure du direct.
    (getCurrentUser as jest.Mock).mockResolvedValue(
      { id: 1, isAdmin: false, roles: ["CASTER"] } as never,
    );
    await firstMessage(await GET(new Request("http://t/"), params("5")));

    // 5e argument de `getTournamentViewerContext` : `canManageLive`.
    expect((getTournamentViewerContext as jest.Mock).mock.calls[0][4]).toBe(true);
  });

  it("refuse les commandes d'antenne à qui n'a pas la permission", async () => {
    await firstMessage(await GET(new Request("http://t/"), params("5")));
    expect((getTournamentViewerContext as jest.Mock).mock.calls[0][4]).toBe(false);
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
  /** Arguments : [snapshot, userId, canManage, canPreview, canManageLive, canDelete]. */
  const viewerCall = () => (getTournamentViewerContext as jest.Mock).mock.calls[0];

  it("accorde la suppression à un administrateur", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(
      { id: 1, isAdmin: true, roles: ["ADMIN"] } as never,
    );

    await GET(new Request("http://t/"), params("5"));

    expect(viewerCall()[5]).toBe(true);
  });

  it.each([
    ["un arbitre", ["ARBITRE"]],
    ["un caster", ["CASTER"]],
    ["un joueur ordinaire", []],
  ])("la refuse à %s, malgré la permission `tournaments`", async (_label, roles) => {
    // Le droit doit voyager par les deux portes — ce flux et la lecture REST de
    // secours —, et se refuser à l'identique sur les deux.
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 2, isAdmin: false, roles } as never);

    await GET(new Request("http://t/"), params("5"));

    expect(viewerCall()[5]).toBe(false);
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
