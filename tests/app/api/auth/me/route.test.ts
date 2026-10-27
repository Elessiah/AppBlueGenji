import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { GET } from "@/app/api/auth/me/route";
import { getCurrentUser } from "@/lib/server/auth";
import { publicSessionUser } from "@/lib/server/public-session-user";
import { authUser } from "../../../../helpers/auth-user";

jest.mock("@/lib/server/auth");

/**
 * `GET /api/auth/me` rendait `AuthUser` entier : le drapeau interne
 * `certifyPromptDue`, les identifiants de fournisseur et tout champ ajouté
 * demain au type sortaient vers le navigateur. La forme est désormais écrite.
 */
describe("GET /api/auth/me", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rend 401 UNAUTHORIZED sans session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await GET();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "UNAUTHORIZED" });
  });

  it("rend la forme publique seulement : identité et droits, aucun drapeau interne", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(
      authUser({
        id: 7,
        pseudo: "Zoé",
        isAdmin: false,
        roles: ["ARBITRE"],
        discordId: "123456789012345678",
        googleSub: "google-sub",
        certifyPromptDue: true,
        recruitmentModalOff: true,
        recruitmentModalBackOn: true,
        avatarUrl: "/uploads/avatars/7.png",
      }),
    );

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      user: { id: 7, pseudo: "Zoé", isAdmin: false, roles: ["ARBITRE"] },
    });
  });

  it("garde ce que lisent les écrans de gestion (`can()` sur isAdmin et roles)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true }));
    const body = (await (await GET()).json()) as { user: { isAdmin: boolean; roles: string[] } };
    expect(body.user.isAdmin).toBe(true);
    expect(body.user.roles).toEqual(["ADMIN"]);
  });
});

describe("publicSessionUser", () => {
  it("n'emporte aucune clé hors de la liste écrite", () => {
    expect(Object.keys(publicSessionUser(authUser())).sort((a, b) => a.localeCompare(b))).toEqual([
      "id",
      "isAdmin",
      "pseudo",
      "roles",
    ]);
  });
});
