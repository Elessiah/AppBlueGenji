import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/discord-verification");

import { GET, POST, PUT } from "@/app/api/profile/discord/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  confirmDiscordVerification,
  getDiscordAccountState,
  startDiscordVerification,
} from "@/lib/server/discord-verification";
import {
  DISCORD_CODE_REQUEST_RULE,
  DISCORD_VERIFY_CONFIRM_RULE,
  DISCORD_VERIFY_TAG_RULE,
} from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";

/**
 * La route de certification : ses gardes, son plafond, et la **traduction des
 * refus en statuts**.
 *
 * Un même code doit rendre le même statut sur les deux verbes — deux tables
 * divergeraient, et un client verrait la même cause en 400 d'un côté et 409 de
 * l'autre. D'où la table unique `statusFor`, dont ce test vérifie les cas qui
 * portent une intention : `DISCORD_ID_MISMATCH` et `DISCORD_ALREADY_LINKED` en
 * **409** (un conflit d'état, que le joueur peut trancher) et non en 400.
 */

const startMock = startDiscordVerification as jest.MockedFunction<typeof startDiscordVerification>;
const confirmMock = confirmDiscordVerification as jest.MockedFunction<
  typeof confirmDiscordVerification
>;
const stateMock = getDiscordAccountState as jest.MockedFunction<typeof getDiscordAccountState>;

const USER = { id: 7, roles: [] };

function post(body: unknown) {
  return POST(
    new Request("http://localhost:3000/api/profile/discord", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

function put(body: unknown) {
  return PUT(
    new Request("http://localhost:3000/api/profile/discord", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit(DISCORD_VERIFY_TAG_RULE.name);
  resetRateLimit(DISCORD_VERIFY_CONFIRM_RULE.name);
  resetRateLimit(DISCORD_CODE_REQUEST_RULE.name);
  (getCurrentUser as jest.Mock).mockResolvedValue(USER as never);
});

describe("garde d'accès", () => {
  it("refuse les trois verbes sans session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await GET()).status).toBe(401);
    expect((await post({ handle: "keryan" })).status).toBe(401);
    expect((await put({ discordId: "900000000000000001", code: "123456" })).status).toBe(401);
  });

  it("ne demande **aucune** permission : c'est son propre compte", async () => {
    stateMock.mockResolvedValue({ tag: null, verified: false, linked: false });

    expect((await GET()).status).toBe(200);
  });
});

describe("POST — ouvrir la certification", () => {
  it("rend « certifié » sans code quand le compte est déjà relié", async () => {
    startMock.mockResolvedValue({ status: "VERIFIED", tag: "keryan" });

    const response = await post({ handle: "keryan" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "VERIFIED", tag: "keryan" });
    // Le troisième argument est le garde posé sur l'identifiant résolu : la
    // route y met son plafond par compte Discord visé, appelé avant l'envoi.
    expect(startMock).toHaveBeenCalledWith(7, "keryan", expect.any(Function));
  });

  it("rend l'identifiant et l'échéance quand un code part", async () => {
    startMock.mockResolvedValue({
      status: "CODE_SENT",
      discordId: "900000000000000002",
      expiresAt: "2026-09-20T12:10:00.000Z",
    });

    const response = await post({ handle: "keryan" });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      status: "CODE_SENT",
      discordId: "900000000000000002",
    });
  });

  it("traite un corps vide comme un tag manquant", async () => {
    startMock.mockRejectedValue(new Error("INVALID_DISCORD_HANDLE"));

    expect((await post({})).status).toBe(400);
    expect(startMock).toHaveBeenCalledWith(7, "", expect.any(Function));
  });

  it("refuse **avant** l'envoi quand le compte Discord visé a reçu trop de codes", async () => {
    // Le garde est appelé par le service juste avant le message privé : c'est ce
    // qui le rend effectif. Posé après l'envoi, il n'aurait rien empêché tout en
    // vidant le seau que la page de connexion consulte, elle, avant d'envoyer.
    startMock.mockImplementation(async (_userId, _handle, guard) => {
      guard?.("900000000000000002");
      return { status: "CODE_SENT", discordId: "900000000000000002", expiresAt: "x" };
    });

    for (let i = 0; i < DISCORD_CODE_REQUEST_RULE.limit; i += 1) {
      expect((await post({ handle: "keryan" })).status).toBe(200);
    }

    const blocked = await post({ handle: "keryan" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "TOO_MANY_CODE_REQUESTS" });
  });

  it("ne charge pas le seau du compte visé quand aucun code ne part", async () => {
    // Une certification immédiate ne fait sonner aucun téléphone : le seau du
    // compte visé — celui que partage `/api/auth/discord/request` — ne doit pas
    // s'en trouver entamé. C'est le service qui décide d'appeler le garde ou
    // non ; on le rejoue ici, puis on vérifie que le quota d'envois est resté
    // entier.
    startMock.mockResolvedValue({ status: "VERIFIED", tag: "keryan" });
    for (let i = 0; i < DISCORD_CODE_REQUEST_RULE.limit + 2; i += 1) {
      expect((await post({ handle: "keryan" })).status).toBe(200);
    }

    startMock.mockImplementation(async (_userId, _handle, guard) => {
      guard?.("900000000000000002");
      return { status: "CODE_SENT", discordId: "900000000000000002", expiresAt: "x" };
    });
    for (let i = 0; i < DISCORD_CODE_REQUEST_RULE.limit; i += 1) {
      expect((await post({ handle: "keryan" })).status).toBe(200);
    }
  });

  it("plafonne par compte du site : la route est authentifiée", async () => {
    // L'axe change par rapport à la connexion, où il n'y a personne à qui
    // imputer l'appel. Ce que le plafond protège ici est la dépense : chaque
    // essai résout un tag auprès du bot.
    startMock.mockResolvedValue({ status: "VERIFIED", tag: "keryan" });

    for (let i = 0; i < DISCORD_VERIFY_TAG_RULE.limit; i += 1) {
      expect((await post({ handle: "keryan" })).status).toBe(200);
    }

    const blocked = await post({ handle: "keryan" });
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("PUT — confirmer avec le code", () => {
  it("garde son propre seau : les essais de tag n'épuisent pas la confirmation", async () => {
    // Partagé, le seau laissait les essais infructueux de la demande refuser la
    // confirmation d'un code qui, lui, expire en dix minutes.
    startMock.mockRejectedValue(new Error("DISCORD_USER_NOT_FOUND"));
    for (let i = 0; i < DISCORD_VERIFY_TAG_RULE.limit + 2; i += 1) {
      await post({ handle: "faute-de-frappe" });
    }

    confirmMock.mockResolvedValue({ tag: "keryan" });
    const response = await put({ discordId: "900000000000000002", code: "123456" });

    expect(response.status).toBe(200);
  });


  it("certifie et rend le tag écrit", async () => {
    confirmMock.mockResolvedValue({ tag: "keryan" });

    const response = await put({ discordId: "900000000000000002", code: "123456" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "VERIFIED", tag: "keryan" });
    expect(confirmMock).toHaveBeenCalledWith(7, "900000000000000002", "123456");
  });

  it("contrôle la forme avant d'appeler le service", async () => {
    for (const body of [
      { discordId: "pas-un-id", code: "123456" },
      { discordId: "900000000000000002", code: "12345" },
      { discordId: "900000000000000002", code: "abcdef" },
      {},
    ]) {
      expect((await put(body)).status).toBe(400);
    }
    expect(confirmMock).not.toHaveBeenCalled();
  });
});

describe("traduction des refus", () => {
  const cases: [string, number][] = [
    ["INVALID_DISCORD_HANDLE", 400],
    // Conflit d'**état**, pas de forme : le joueur peut trancher (corriger son
    // tag, ou rester sur son compte de connexion).
    ["DISCORD_ID_MISMATCH", 409],
    ["DISCORD_ALREADY_LINKED", 409],
    ["CODE_INVALID_OR_EXPIRED", 401],
    ["DISCORD_USER_NOT_FOUND", 404],
    ["PROFILE_NOT_FOUND", 404],
    ["TOO_MANY_CODE_REQUESTS", 429],
    ["DISCORD_DM_FAILED", 502],
    ["BOT_INTERNAL_UNREACHABLE", 503],
    ["BOT_RESOLVE_TIMEOUT", 504],
    ["QUELQUE_CHOSE_DINATTENDU", 500],
  ];

  it.each(cases)("rend %s en %i sur POST", async (code, status) => {
    startMock.mockRejectedValue(new Error(code));

    const response = await post({ handle: "keryan" });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });

  it.each(cases)("rend %s en %i sur PUT, le même statut qu'en POST", async (code, status) => {
    confirmMock.mockRejectedValue(new Error(code));

    const response = await put({ discordId: "900000000000000002", code: "123456" });
    expect(response.status).toBe(status);
  });
});
