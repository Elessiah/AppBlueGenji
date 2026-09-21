import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/account-identities");

import { getCurrentUser } from "@/lib/server/auth";
import { listAccountConnections, unlinkOAuthIdentity } from "@/lib/server/account-identities";
import { GET } from "@/app/api/profile/connections/route";
import { DELETE } from "@/app/api/profile/connections/[provider]/route";

/**
 * **La route dit la même chose que le bouton.**
 *
 * Le refus qui compte — « c'est ton dernier moyen de connexion » — est décidé
 * par le module pur, celui-là même qui met une phrase à la place du bouton sur
 * `/profil`. Ce qui reste à la route : garder l'accès, refuser un segment d'URL
 * inconnu, et traduire en HTTP. Le **409** de `LAST_CONNECTION` n'est pas un
 * détail : la demande est légitime et l'appelant est chez lui (un 403 dirait le
 * contraire), c'est l'état du compte qui s'y oppose.
 */

const params = (provider: string) => ({ params: Promise.resolve({ provider }) });

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7 } as never);
  (listAccountConnections as jest.Mock).mockResolvedValue([] as never);
  (unlinkOAuthIdentity as jest.Mock).mockResolvedValue(undefined as never);
});

describe("GET /api/profile/connections", () => {
  it("refuse un visiteur sans session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const response = await GET();

    expect(response.status).toBe(401);
    expect(listAccountConnections).not.toHaveBeenCalled();
  });

  it("rend la liste du compte connecté", async () => {
    (listAccountConnections as jest.Mock).mockResolvedValue([
      { provider: "DISCORD", linked: true, handle: "nova" },
    ] as never);

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      connections: [{ provider: "DISCORD", linked: true, handle: "nova" }],
    });
    expect(listAccountConnections).toHaveBeenCalledWith(7);
  });

  it("rend 404 sur un compte introuvable", async () => {
    (listAccountConnections as jest.Mock).mockRejectedValue(new Error("PROFILE_NOT_FOUND") as never);

    const response = await GET();

    expect(response.status).toBe(404);
  });
});

describe("DELETE /api/profile/connections/[provider]", () => {
  it("refuse un visiteur sans session", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    const response = await DELETE(new Request("http://x"), params("discord"));

    expect(response.status).toBe(401);
    expect(unlinkOAuthIdentity).not.toHaveBeenCalled();
  });

  it("refuse un segment d'URL inconnu, sans rien toucher", async () => {
    const response = await DELETE(new Request("http://x"), params("facebook"));

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "UNKNOWN_PROVIDER" });
    expect(unlinkOAuthIdentity).not.toHaveBeenCalled();
  });

  it("traduit le segment en fournisseur et détache", async () => {
    const response = await DELETE(new Request("http://x"), params("blizzard"));

    expect(response.status).toBe(200);
    expect(unlinkOAuthIdentity).toHaveBeenCalledWith(7, "BLIZZARD");
  });

  it("rend **409** sur le dernier moyen de connexion", async () => {
    (unlinkOAuthIdentity as jest.Mock).mockRejectedValue(new Error("LAST_CONNECTION") as never);

    const response = await DELETE(new Request("http://x"), params("discord"));

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "LAST_CONNECTION" });
  });

  it("rend 404 sur une porte qui n'était pas rattachée", async () => {
    (unlinkOAuthIdentity as jest.Mock).mockRejectedValue(new Error("NOT_LINKED") as never);

    const response = await DELETE(new Request("http://x"), params("google"));

    expect(response.status).toBe(404);
  });

  it("rend 500 sur une panne inattendue", async () => {
    (unlinkOAuthIdentity as jest.Mock).mockRejectedValue(new Error("ER_LOCK_DEADLOCK") as never);

    const response = await DELETE(new Request("http://x"), params("google"));

    expect(response.status).toBe(500);
  });
});
