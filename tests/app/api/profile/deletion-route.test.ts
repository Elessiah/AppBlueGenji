import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { GET } from "@/app/api/profile/deletion/route";
import { DELETE } from "@/app/api/profile/route";
import { getCurrentUser } from "@/lib/server/auth";
import { clearSession } from "@/lib/server/auth";
import { deleteOwnAccount, getAccountDeletionMode } from "@/lib/server/users-service";

/**
 * Les deux bouts du geste : la route qui **annonce** ce que la suppression
 * ferait, et celle qui la fait et **rend le mode appliqué**.
 *
 * Le second n'est pas une redite du premier : rien n'interdit qu'un tournoi
 * soit créé entre l'annonce et le clic, et c'est l'écriture qui fait foi — d'où
 * un mode renvoyé par la réponse plutôt que repris de l'aperçu.
 */
const modeMock = getAccountDeletionMode as jest.MockedFunction<typeof getAccountDeletionMode>;
const deleteMock = deleteOwnAccount as jest.MockedFunction<typeof deleteOwnAccount>;

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7, roles: [] } as never);
  (clearSession as jest.Mock).mockResolvedValue(undefined as never);
});

describe("GET /api/profile/deletion", () => {
  it("annonce l'effacement complet", async () => {
    modeMock.mockResolvedValue("ERASE");

    const response = await GET();

    expect(response.status).toBe(200);
    expect((await response.json()).mode).toBe("ERASE");
  });

  it("annonce l'anonymisation", async () => {
    modeMock.mockResolvedValue("ANONYMIZE");

    expect((await GET().then((r) => r.json())).mode).toBe("ANONYMIZE");
  });

  it("refuse l'appel anonyme sans rien interroger", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await GET()).status).toBe(401);
    expect(modeMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/profile", () => {
  it("rend le mode que l'écriture a réellement appliqué", async () => {
    deleteMock.mockResolvedValue("ERASE");

    const payload = await DELETE().then((r) => r.json());

    expect(payload).toMatchObject({ deleted: true, mode: "ERASE" });
  });

  it("ferme la session dans les deux cas", async () => {
    deleteMock.mockResolvedValue("ANONYMIZE");

    await DELETE();

    expect(clearSession).toHaveBeenCalled();
  });

  it("refuse l'appel anonyme sans rien écrire", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await DELETE()).status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});
