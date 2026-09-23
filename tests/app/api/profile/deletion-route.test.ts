import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users-service");

import { GET } from "@/app/api/profile/deletion/route";
import { DELETE } from "@/app/api/profile/route";
import { getCurrentUser } from "@/lib/server/auth";
import { clearSession } from "@/lib/server/auth";
import { deleteOwnAccount, getAccountDeletionPlan } from "@/lib/server/users-service";

/**
 * Les deux bouts du geste : la route qui **annonce** ce que la suppression
 * ferait, et celle qui la fait et **rend le plan appliqué**.
 *
 * Le second n'est pas une redite du premier : rien n'interdit qu'un tournoi
 * soit créé entre l'annonce et le clic, et c'est l'écriture qui fait foi — d'où
 * un plan renvoyé par la réponse plutôt que repris de l'aperçu.
 *
 * Les deux rendent le **motif** avec le mode : « anonymisé » ne dit pas au
 * joueur ce qui retient sa ligne, et la phrase qu'il lira en dépend.
 */
const modeMock = getAccountDeletionPlan as jest.MockedFunction<typeof getAccountDeletionPlan>;
const deleteMock = deleteOwnAccount as jest.MockedFunction<typeof deleteOwnAccount>;

beforeEach(() => {
  jest.clearAllMocks();
  (getCurrentUser as jest.Mock).mockResolvedValue({ id: 7, roles: [] } as never);
  (clearSession as jest.Mock).mockResolvedValue(undefined as never);
});

describe("GET /api/profile/deletion", () => {
  it("annonce l'effacement complet, sans motif de conservation", async () => {
    modeMock.mockResolvedValue({ mode: "ERASE", reason: null });

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ mode: "ERASE", reason: null });
  });

  it("annonce l'anonymisation **et** ce qui retient la ligne", async () => {
    modeMock.mockResolvedValue({ mode: "ANONYMIZE", reason: "OWNED_TEAMS" });

    expect(await GET().then((r) => r.json())).toMatchObject({
      mode: "ANONYMIZE",
      reason: "OWNED_TEAMS",
    });
  });

  it("refuse l'appel anonyme sans rien interroger", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await GET()).status).toBe(401);
    expect(modeMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/profile", () => {
  it("rend le plan que l'écriture a réellement appliqué", async () => {
    deleteMock.mockResolvedValue({ mode: "ERASE", reason: null });

    const payload = await DELETE().then((r) => r.json());

    expect(payload).toMatchObject({ deleted: true, mode: "ERASE", reason: null });
  });

  it("rend le motif quand la ligne est retenue", async () => {
    deleteMock.mockResolvedValue({ mode: "ANONYMIZE", reason: "ORGANIZED_TOURNAMENTS" });

    const payload = await DELETE().then((r) => r.json());

    expect(payload).toMatchObject({ mode: "ANONYMIZE", reason: "ORGANIZED_TOURNAMENTS" });
  });

  it("ferme la session dans les deux cas", async () => {
    deleteMock.mockResolvedValue({ mode: "ANONYMIZE", reason: "TOURNAMENTS" });

    await DELETE();

    expect(clearSession).toHaveBeenCalled();
  });

  it("refuse l'appel anonyme sans rien écrire", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await DELETE()).status).toBe(401);
    expect(deleteMock).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/profile — aucun message interne ne sort", () => {
  it.each(["ACCOUNT_STILL_REFERENCED", "USER_NOT_FOUND"])("rend le refus nommé %s tel quel", async (code) => {
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 42 } as never);
    (deleteOwnAccount as jest.Mock).mockRejectedValue(new Error(code) as never);
    const res = await DELETE();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
  });

  it("remplace le message d'une panne par le code générique", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    (getCurrentUser as jest.Mock).mockResolvedValue({ id: 42 } as never);
    (deleteOwnAccount as jest.Mock).mockRejectedValue(
      new Error("Deadlock found when trying to get lock; try restarting transaction") as never,
    );
    const res = await DELETE();
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "ACCOUNT_DELETE_FAILED" });
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});
