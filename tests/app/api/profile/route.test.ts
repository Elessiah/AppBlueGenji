import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { GET, PATCH } from "@/app/api/profile/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getFullProfile, updateOwnProfile } from "@/lib/server/users-service";
import { profilePatchRequest } from "../../../helpers/profile-request";
import { authUser, fullProfileResponse } from "../../../helpers/auth-user";

/**
 * Lecture et écriture de **son** profil. Les refus de `PATCH` sont couverts par
 * `patch-deleted.test.ts` et `tag-lock-route.test.ts`, `DELETE` par
 * `deletion-route.test.ts` ; ici, ce qui reste : `GET`, et le fait que le
 * compte visé est toujours celui de la session, jamais une valeur du corps.
 */

const user = authUser({ id: 42 });
// La route rend le profil tel quel : sa forme n'est pas ce qui est testé ici.
const profile = fullProfileResponse({ profile: { pseudo: "Nova" } });

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/profile", () => {
  it("refuse l'appel anonyme sans rien lire", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(getFullProfile).not.toHaveBeenCalled();
  });

  it("lit le profil du compte connecté, en tant que son titulaire", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(getFullProfile).mockResolvedValue(profile);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(profile);
    // Lecteur = titulaire : c'est ce qui lui rend ses champs masqués.
    expect(getFullProfile).toHaveBeenCalledWith({ id: 42 }, 42);
  });

  it("rend 404 quand le compte n'existe plus", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(getFullProfile).mockResolvedValue(null);

    const res = await GET();

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "PROFILE_NOT_FOUND" });
  });
});

describe("PATCH /api/profile — compte visé", () => {
  it("refuse l'appel anonyme sans rien écrire", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await PATCH(profilePatchRequest({ pseudo: "Nova" }));

    expect(res.status).toBe(401);
    expect(updateOwnProfile).not.toHaveBeenCalled();
  });

  it("écrit sur le compte de la session, quel que soit l'identifiant du corps", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(updateOwnProfile).mockResolvedValue(undefined);
    jest.mocked(getFullProfile).mockResolvedValue(profile);

    const body = { id: 7, userId: 7, visibility: { avatar: false } };
    await PATCH(profilePatchRequest(body));

    expect(updateOwnProfile).toHaveBeenCalledWith(42, body);
    expect(getFullProfile).toHaveBeenCalledWith({ id: 42 }, 42);
  });
});
