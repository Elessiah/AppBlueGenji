import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/image");

import { DELETE, PATCH, POST } from "@/app/api/admin/tournaments/[id]/image/route";
import { getCurrentUser } from "@/lib/server/auth";
import {
  removeTournamentImage,
  setTournamentImage,
  updateTournamentImageSettings,
} from "@/lib/server/tournaments/image";
import type { TournamentImage } from "@/lib/shared/tournament-image";
import { authUser } from "../../../helpers/auth-user";

/**
 * `/api/admin/tournaments/[id]/image` — illustration ou logo d'un tournoi.
 *
 * Permission `tournaments` (arbitre, admin) : l'image habille l'annonce du
 * tournoi, comme la chaîne officielle. Aucune garde d'état — elle est
 * décorative.
 */

const player = authUser({ id: 2, isAdmin: false, roles: [] });
const caster = authUser({ id: 4, isAdmin: false, roles: ["CASTER"] });
const cm = authUser({ id: 5, isAdmin: false, roles: ["COMMUNITY_MANAGER"] });
const arbitre = authUser({ id: 3, isAdmin: false, roles: ["ARBITRE"] });
const admin = authUser({ id: 1, isAdmin: true, roles: ["ADMIN"] });

const URL_BASE = "http://localhost/api/admin/tournaments/5/image";
const params = (id = "5") => ({ params: Promise.resolve({ id }) });

const pngFile = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], "v.png", { type: "image/png" });

function uploadReq(fields: Record<string, string | File> = {}) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  return new Request(URL_BASE, { method: "POST", body: form });
}

function patchReq(body: unknown) {
  return new Request(URL_BASE, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

const deleteReq = () => new Request(URL_BASE, { method: "DELETE" });

const saved: TournamentImage = {
  url: "/api/uploads/tournaments/5-a.webp",
  fit: "COVER",
  focusX: 50,
  focusY: 50,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(setTournamentImage).mockResolvedValue(saved);
  jest.mocked(updateTournamentImageSettings).mockResolvedValue(saved);
  jest.mocked(removeTournamentImage).mockResolvedValue(undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("accès", () => {
  const calls: [string, () => Promise<Response>][] = [
    ["POST", () => POST(uploadReq({ file: pngFile() }), params())],
    ["PATCH", () => PATCH(patchReq({ fit: "COVER", focusX: 50, focusY: 50 }), params())],
    ["DELETE", () => DELETE(deleteReq(), params())],
  ];

  it.each(calls)("%s rejette un visiteur anonyme avec 401", async (_, call) => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it.each(calls)("%s est refusé sans la permission tournaments (joueur, caster, CM)", async (_, call) => {
    for (const user of [player, caster, cm]) {
      jest.mocked(getCurrentUser).mockResolvedValue(user);
      const res = await call();
      expect(res.status).toBe(403);
    }
    expect(setTournamentImage).not.toHaveBeenCalled();
    expect(updateTournamentImageSettings).not.toHaveBeenCalled();
    expect(removeTournamentImage).not.toHaveBeenCalled();
  });

  it.each(calls)("%s est ouvert à l'arbitre comme à l'admin", async (_, call) => {
    for (const user of [arbitre, admin]) {
      jest.mocked(getCurrentUser).mockResolvedValue(user);
      expect((await call()).status).toBe(200);
    }
  });

  it("refuse un identifiant de tournoi invalide", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
    for (const id of ["abc", "0", "-3", "1.5"]) {
      const res = await DELETE(deleteReq(), params(id));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_TOURNAMENT_ID" });
    }
    expect(removeTournamentImage).not.toHaveBeenCalled();
  });
});

describe("POST — pose ou remplace l'image", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
  });

  it("transmet le fichier et son cadrage, et rend l'image", async () => {
    const res = await POST(uploadReq({ file: pngFile(), fit: "CONTAIN", focusX: "10", focusY: "90" }), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: saved });
    expect(setTournamentImage).toHaveBeenCalledWith(5, expect.any(File), {
      fit: "CONTAIN",
      focusX: 10,
      focusY: 90,
    });
  });

  it("un fichier seul suffit : le cadrage prend ses défauts", async () => {
    await POST(uploadReq({ file: pngFile() }), params());
    expect(setTournamentImage).toHaveBeenCalledWith(5, expect.any(File), {
      fit: "COVER",
      focusX: 50,
      focusY: 50,
    });
  });

  it("refuse une requête sans fichier", async () => {
    const res = await POST(uploadReq({ fit: "COVER" }), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_MISSING" });
  });

  it("refuse un corps qui n'est pas un formulaire", async () => {
    const res = await POST(new Request(URL_BASE, { method: "POST", body: "{}" }), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "FILE_MISSING" });
  });

  it("refuse un cadrage invalide avant tout traitement", async () => {
    let res = await POST(uploadReq({ file: pngFile(), fit: "STRETCH" }), params());
    expect(await res.json()).toEqual({ error: "INVALID_IMAGE_FIT" });
    res = await POST(uploadReq({ file: pngFile(), focusX: "150" }), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_IMAGE_FOCUS" });
    expect(setTournamentImage).not.toHaveBeenCalled();
  });

  it.each([
    "IMAGE_TOO_LARGE",
    "IMAGE_FORMAT_INVALID",
    "IMAGE_DIMENSIONS_INVALID",
    "IMAGE_ANIMATED_NOT_SUPPORTED",
  ])("rend le refus d'image %s en 400", async (code) => {
    jest.mocked(setTournamentImage).mockRejectedValue(new Error(code));
    const res = await POST(uploadReq({ file: pngFile() }), params());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: code });
  });

  it("rend un tournoi inconnu en 404", async () => {
    jest.mocked(setTournamentImage).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    expect((await POST(uploadReq({ file: pngFile() }), params())).status).toBe(404);
  });

  it("ne laisse jamais partir le message d'une erreur inattendue", async () => {
    const log = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(setTournamentImage).mockRejectedValue(
      new Error("ENOENT: no such file or directory, open '/srv/app/public/uploads/x'"),
    );
    const res = await POST(uploadReq({ file: pngFile() }), params());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_IMAGE_UPLOAD_FAILED" });
    expect(log).toHaveBeenCalled();
  });
});

describe("PATCH — change le cadrage seul", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(arbitre);
  });

  it("transmet les réglages validés", async () => {
    const res = await PATCH(patchReq({ fit: "CONTAIN", focusX: 0, focusY: 100 }), params());
    expect(res.status).toBe(200);
    expect(updateTournamentImageSettings).toHaveBeenCalledWith(5, { fit: "CONTAIN", focusX: 0, focusY: 100 });
  });

  it("exige les trois champs : un champ oublié ne recentre pas l'image en silence", async () => {
    let res = await PATCH(patchReq({ focusX: 10, focusY: 10 }), params());
    expect(await res.json()).toEqual({ error: "INVALID_IMAGE_FIT" });
    res = await PATCH(patchReq({ fit: "COVER", focusX: 10 }), params());
    expect(await res.json()).toEqual({ error: "INVALID_IMAGE_FOCUS" });
    res = await PATCH(patchReq({ fit: "COVER", focusY: 10 }), params());
    expect(res.status).toBe(400);
    expect(updateTournamentImageSettings).not.toHaveBeenCalled();
  });

  it("refuse null, une chaîne vide ou un nombre en chaîne : aucun défaut au PATCH", async () => {
    for (const body of [
      { fit: null, focusX: 10, focusY: 10 },
      { fit: "COVER", focusX: null, focusY: 10 },
      { fit: "COVER", focusX: 10, focusY: "" },
      { fit: "COVER", focusX: "10", focusY: 10 },
    ]) {
      const res = await PATCH(patchReq(body), params());
      expect(res.status).toBe(400);
    }
    expect(updateTournamentImageSettings).not.toHaveBeenCalled();
  });

  it("refuse un corps illisible ou des valeurs hors bornes", async () => {
    expect((await PATCH(patchReq("pas du json"), params())).status).toBe(400);
    expect((await PATCH(patchReq("null"), params())).status).toBe(400);
    const res = await PATCH(patchReq({ fit: "COVER", focusX: -1, focusY: 10 }), params());
    expect(await res.json()).toEqual({ error: "INVALID_IMAGE_FOCUS" });
    expect(updateTournamentImageSettings).not.toHaveBeenCalled();
  });

  it("rend une image disparue entre-temps en 409", async () => {
    jest
      .mocked(updateTournamentImageSettings)
      .mockRejectedValue(new Error("TOURNAMENT_IMAGE_MISSING"));
    const res = await PATCH(patchReq({ fit: "COVER", focusX: 1, focusY: 1 }), params());
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "TOURNAMENT_IMAGE_MISSING" });
  });
});

describe("DELETE — retire l'image", () => {
  beforeEach(() => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
  });

  it("retire et rend une image nulle", async () => {
    const res = await DELETE(deleteReq(), params());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ image: null });
    expect(removeTournamentImage).toHaveBeenCalledWith(5);
  });

  it("rend un tournoi inconnu en 404", async () => {
    jest.mocked(removeTournamentImage).mockRejectedValue(new Error("TOURNAMENT_NOT_FOUND"));
    expect((await DELETE(deleteReq(), params())).status).toBe(404);
  });
});
