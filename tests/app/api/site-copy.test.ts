import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/site-copy-service");

import { DELETE, GET, PATCH } from "@/app/api/site-copy/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getSiteCopy, resetSiteCopy, setSiteCopy } from "@/lib/server/site-copy-service";
import { defaultSiteCopy } from "@/lib/shared/site-copy";
import { authUser } from "../../helpers/auth-user";

const visitor = authUser({ id: 2, isAdmin: false, roles: [] });
const cm = authUser({ id: 3, isAdmin: false, roles: ["COMMUNITY_MANAGER"] });

const copy = { ...defaultSiteCopy(), "home.hero.title": "Titre" };

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
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("est public : les textes servent au rendu de la vitrine", async () => {
    jest.mocked(getSiteCopy).mockResolvedValue(copy);

    const res = await GET();

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ copy });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/site-copy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette un visiteur anonyme avec 401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await PATCH(patchReq({ key: "home.hero.title", value: "x" }))).status).toBe(401);
    expect(setSiteCopy).not.toHaveBeenCalled();
  });

  it("rejette un membre sans permission showcase avec 403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(visitor);

    expect((await PATCH(patchReq({ key: "home.hero.title", value: "x" }))).status).toBe(403);
    expect(setSiteCopy).not.toHaveBeenCalled();
  });

  it("laisse un Community Manager éditer", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);
    jest.mocked(setSiteCopy).mockResolvedValue(copy);

    const res = await PATCH(patchReq({ key: "home.hero.title", value: "Titre" }));

    expect(res.status).toBe(200);
    expect(setSiteCopy).toHaveBeenCalledWith("home.hero.title", "Titre");
    expect(await res.json()).toEqual({ copy });
  });

  it("renvoie 404 pour une clé inconnue", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);
    jest.mocked(setSiteCopy).mockRejectedValue(new Error("UNKNOWN_COPY_KEY"));

    expect((await PATCH(patchReq({ key: "nope", value: "x" }))).status).toBe(404);
  });

  it("renvoie 400 pour un texte vide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);
    jest.mocked(setSiteCopy).mockRejectedValue(new Error("COPY_EMPTY"));

    const res = await PATCH(patchReq({ key: "home.hero.title", value: "" }));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "COPY_EMPTY" });
  });

  it("rejette un corps sans clé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);

    expect((await PATCH(patchReq({ value: "x" }))).status).toBe(400);
    expect(setSiteCopy).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/site-copy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("rejette un membre sans permission showcase", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(visitor);

    expect((await DELETE(deleteReq("home.hero.title"))).status).toBe(403);
    expect(resetSiteCopy).not.toHaveBeenCalled();
  });

  it("rétablit le texte d'origine", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);
    jest.mocked(resetSiteCopy).mockResolvedValue(copy);

    const res = await DELETE(deleteReq("home.hero.title"));

    expect(res.status).toBe(200);
    expect(resetSiteCopy).toHaveBeenCalledWith("home.hero.title");
  });

  it("exige une clé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(cm);

    expect((await DELETE(deleteReq())).status).toBe(400);
    expect(resetSiteCopy).not.toHaveBeenCalled();
  });
});
