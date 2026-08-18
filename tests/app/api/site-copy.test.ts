import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/site-copy-service");

import { DELETE, GET, PATCH } from "@/app/api/site-copy/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getSiteCopy, resetSiteCopy, setSiteCopy } from "@/lib/server/site-copy-service";

type SessionUser = Awaited<ReturnType<typeof getCurrentUser>>;

const visitor = { id: 2, isAdmin: false, roles: [] } as unknown as SessionUser;
const cm = { id: 3, isAdmin: false, roles: ["COMMUNITY_MANAGER"] } as unknown as SessionUser;

const copy = { "home.hero.title": "Titre" };

function patchReq(body: unknown) {
  return new Request("http://localhost/api/site-copy", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const deleteReq = (key?: string) =>
  new Request(`http://localhost/api/site-copy${key ? `?key=${encodeURIComponent(key)}` : ""}`, {
    method: "DELETE",
  });

describe("GET /api/site-copy", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("est public : les textes servent au rendu de la vitrine", async () => {
    (getSiteCopy as jest.Mock).mockResolvedValue(copy as never);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copy });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/site-copy", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un visiteur anonyme avec 401", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(null as never);

    expect((await PATCH(patchReq({ key: "home.hero.title", value: "x" }))).status).toBe(401);
    expect(setSiteCopy).not.toHaveBeenCalled();
  });

  it("rejette un membre sans permission showcase avec 403", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(visitor as never);

    expect((await PATCH(patchReq({ key: "home.hero.title", value: "x" }))).status).toBe(403);
    expect(setSiteCopy).not.toHaveBeenCalled();
  });

  it("laisse un Community Manager éditer", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);
    (setSiteCopy as jest.Mock).mockResolvedValue(copy as never);

    const res = await PATCH(patchReq({ key: "home.hero.title", value: "Titre" }));

    expect(res.status).toBe(200);
    expect(setSiteCopy).toHaveBeenCalledWith("home.hero.title", "Titre");
    expect(await res.json()).toEqual({ copy });
  });

  it("renvoie 404 pour une clé inconnue", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);
    (setSiteCopy as jest.Mock).mockRejectedValue(new Error("UNKNOWN_COPY_KEY") as never);

    expect((await PATCH(patchReq({ key: "nope", value: "x" }))).status).toBe(404);
  });

  it("renvoie 400 pour un texte vide", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);
    (setSiteCopy as jest.Mock).mockRejectedValue(new Error("COPY_EMPTY") as never);

    const res = await PATCH(patchReq({ key: "home.hero.title", value: "" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COPY_EMPTY" });
  });

  it("rejette un corps sans clé", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);

    expect((await PATCH(patchReq({ value: "x" }))).status).toBe(400);
    expect(setSiteCopy).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/site-copy", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("rejette un membre sans permission showcase", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(visitor as never);

    expect((await DELETE(deleteReq("home.hero.title"))).status).toBe(403);
    expect(resetSiteCopy).not.toHaveBeenCalled();
  });

  it("rétablit le texte d'origine", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);
    (resetSiteCopy as jest.Mock).mockResolvedValue(copy as never);

    const res = await DELETE(deleteReq("home.hero.title"));

    expect(res.status).toBe(200);
    expect(resetSiteCopy).toHaveBeenCalledWith("home.hero.title");
  });

  it("exige une clé", async () => {
    (getCurrentUser as jest.Mock).mockResolvedValue(cm as never);

    expect((await DELETE(deleteReq())).status).toBe(400);
    expect(resetSiteCopy).not.toHaveBeenCalled();
  });
});
