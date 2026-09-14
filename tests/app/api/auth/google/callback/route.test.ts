import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/google-oauth");
jest.mock("@/lib/server/users-service");

import { NextRequest } from "next/server";
import { GET } from "@/app/api/auth/google/callback/route";
import { consumeGoogleOAuthState, createSession } from "@/lib/server/auth";
import { fetchGoogleUser, getAppBaseUrl } from "@/lib/server/google-oauth";
import { createOrGetGoogleUser } from "@/lib/server/users-service";

/**
 * **Le convoyage de `email_verified`, de Google jusqu'à la règle.**
 *
 * `createOrGetGoogleUser` décide du rattachement d'un compte sur ce seul champ,
 * et il change de casse en passant du protocole au vocabulaire du projet. Cette
 * ligne de traduction est donc un maillon de la chaîne d'authentification : la
 * laisser tomber (un `profile` passé tel quel, par exemple) ferait tomber la
 * preuve à « absente », et c'est le type de `GoogleProfilePayload` — désormais
 * **obligatoire** — qui refuse de compiler. Ce qui reste à vérifier ici, c'est
 * que la valeur transmise est bien celle de Google, dans les deux sens.
 */

const stateMock = consumeGoogleOAuthState as jest.MockedFunction<typeof consumeGoogleOAuthState>;
const fetchUserMock = fetchGoogleUser as jest.MockedFunction<typeof fetchGoogleUser>;
const createUserMock = createOrGetGoogleUser as jest.MockedFunction<typeof createOrGetGoogleUser>;

const callback = () =>
  GET(new NextRequest("http://localhost:3000/api/auth/google/callback?code=abc&state=xyz"));

describe("GET /api/auth/google/callback — `email_verified`", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (getAppBaseUrl as jest.Mock).mockReturnValue("http://localhost:3000");
    stateMock.mockResolvedValue({ state: "xyz", redirectTo: "/tournois" } as never);
    (createSession as jest.Mock).mockResolvedValue(undefined as never);
    createUserMock.mockResolvedValue(7 as never);
  });

  it("transmet `true` quand Google atteste l'adresse", async () => {
    fetchUserMock.mockResolvedValue({
      sub: "sub-1",
      email: "nova@exemple.test",
      email_verified: true,
    } as never);

    await callback();

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ email: "nova@exemple.test", emailVerified: true }),
    );
  });

  it("transmet `false` quand Google ne l'atteste pas", async () => {
    fetchUserMock.mockResolvedValue({
      sub: "sub-1",
      email: "nova@exemple.test",
      email_verified: false,
    } as never);

    await callback();

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: false }),
    );
  });

  it("traite l'absence du champ comme une adresse non attestée", async () => {
    // `email_verified` est facultatif côté protocole : absent, il ne prouve
    // rien — et une preuve absente ne vaut pas une preuve donnée.
    fetchUserMock.mockResolvedValue({ sub: "sub-1", email: "nova@exemple.test" } as never);

    await callback();

    expect(createUserMock).toHaveBeenCalledWith(
      expect.objectContaining({ emailVerified: false }),
    );
  });

  it("ouvre la session et suit la destination filtrée", async () => {
    fetchUserMock.mockResolvedValue({ sub: "sub-1", email_verified: true } as never);

    const response = await callback();

    expect(createSession).toHaveBeenCalledWith(7);
    expect(response.headers.get("location")).toBe("http://localhost:3000/tournois");
  });

  it("renvoie vers la connexion quand la création échoue, sans ouvrir de session", async () => {
    // C'est par là que sortait l'`ER_DUP_ENTRY` d'une adresse déjà prise : une
    // erreur générique, aucun journal, et le même échec à chaque essai.
    fetchUserMock.mockResolvedValue({ sub: "sub-1", email_verified: false } as never);
    createUserMock.mockRejectedValue(new Error("ER_DUP_ENTRY") as never);

    const response = await callback();

    expect(response.headers.get("location")).toBe("http://localhost:3000/connexion?error=oauth");
    expect(createSession).not.toHaveBeenCalled();
  });
});
