import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/recruitment-modal-preference", () => ({
  recordRecruitmentModalOff: jest.fn(),
  recordRecruitmentModalBackOn: jest.fn(),
}));

import { DELETE, POST } from "@/app/api/recruitment/modal-dismiss/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordRecruitmentModalBackOn, recordRecruitmentModalOff } from "@/lib/server/users/recruitment-modal-preference";
import { authUser } from "../../../helpers/auth-user";

/** `POST /api/recruitment/modal-dismiss` : « Ne plus afficher » gardé sur le compte, cookie reposé par le serveur. */

/** Le `Set-Cookie` du choix : un an, lax, lisible par le client (ITP borne à 7 jours un cookie posé par script). */
function expectOptOutCookie(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  expect(header).toContain("bg_recr_off=1");
  expect(header).toMatch(/Max-Age=31536000/i);
  expect(header).toMatch(/SameSite=lax/i);
  expect(header).toMatch(/Path=\//i);
  expect(header).not.toMatch(/HttpOnly/i);
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(recordRecruitmentModalOff).mockResolvedValue(true);
  jest.mocked(recordRecruitmentModalBackOn).mockResolvedValue(true);
});

describe("POST /api/recruitment/modal-dismiss", () => {
  it("pose le choix sur le compte connecté", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: true });
    expect(recordRecruitmentModalOff).toHaveBeenCalledWith(7);
    expectOptOutCookie(response);
  });

  it("déjà posé sur le compte (lu avec la session) : aucune écriture, cookie reposé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, recruitmentModalOff: true }));
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: true });
    expect(recordRecruitmentModalOff).not.toHaveBeenCalled();
    expectOptOutCookie(response);
  });

  it("sans session : repose seulement le cookie, sans toucher à aucun compte", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: false });
    expect(recordRecruitmentModalOff).not.toHaveBeenCalled();
    expectOptOutCookie(response);
  });

  it("répond 409 quand le compte vient d'être supprimé", async () => {
    jest.mocked(recordRecruitmentModalOff).mockResolvedValue(false);
    const response = await POST();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ACCOUNT_DELETED" });
    expectOptOutCookie(response);
  });

  it("répond par un code sur une panne de base, sans phrase", async () => {
    jest.mocked(recordRecruitmentModalOff).mockRejectedValue(new Error("down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "RECRUITMENT_MODAL_DISMISS_FAILED" });
    expectOptOutCookie(response);
    spy.mockRestore();
  });

  it("lecture de la session en panne : un code, cookie reposé, jamais la page d'erreur par défaut", async () => {
    jest.mocked(getCurrentUser).mockRejectedValue(new Error("pool exhausted"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "RECRUITMENT_MODAL_DISMISS_FAILED" });
    expectOptOutCookie(response);
    expect(recordRecruitmentModalOff).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("colonne absente (ALTER échoué) : 503 à code propre, sans bruit au journal, cookie reposé", async () => {
    jest.mocked(recordRecruitmentModalOff).mockRejectedValue(
      Object.assign(new Error("Unknown column 'recruitment_modal_off'"), { code: "ER_BAD_FIELD_ERROR" }),
    );
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE" });
    expectOptOutCookie(response);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

/** L'effacement du cookie : mêmes attributs que sa pose (sinon le navigateur garde l'autre), `Max-Age=0`. */
function expectOptOutCookieCleared(response: Response) {
  const header = response.headers.get("set-cookie") ?? "";
  expect(header).toMatch(/bg_recr_off=;/);
  expect(header).toMatch(/Max-Age=0/i);
  expect(header).toMatch(/SameSite=lax/i);
  expect(header).toMatch(/Path=\//i);
  expect(header).not.toMatch(/HttpOnly/i);
}

describe("DELETE /api/recruitment/modal-dismiss — réafficher depuis « Mon profil »", () => {
  it("passe le compte à « réaffichée » et efface le cookie de ce navigateur", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, recruitmentModalOff: true }));
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: true });
    expect(recordRecruitmentModalBackOn).toHaveBeenCalledWith(7);
    expect(recordRecruitmentModalOff).not.toHaveBeenCalled();
    expectOptOutCookieCleared(response);
  });

  it("puis POST le recoupe : compte posé, cookie reposé (aller-retour du réglage)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, recruitmentModalBackOn: true }));
    const response = await POST();
    expect(response.status).toBe(200);
    expect(recordRecruitmentModalOff).toHaveBeenCalledWith(7);
    expectOptOutCookie(response);
  });

  it("déjà réaffichée (lu avec la session) : aucune écriture, cookie d'ici effacé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7, recruitmentModalBackOn: true }));
    const response = await DELETE();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ account: true });
    expect(recordRecruitmentModalBackOn).not.toHaveBeenCalled();
    expectOptOutCookieCleared(response);
  });

  it("sans session : 401, rien d'écrit ni d'effacé", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await DELETE();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(recordRecruitmentModalBackOn).not.toHaveBeenCalled();
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("compte supprimé : 409, cookie gardé", async () => {
    jest.mocked(recordRecruitmentModalBackOn).mockResolvedValue(false);
    const response = await DELETE();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ACCOUNT_DELETED" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("panne de base : un code, sans phrase, cookie gardé", async () => {
    jest.mocked(recordRecruitmentModalBackOn).mockRejectedValue(new Error("down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await DELETE();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "RECRUITMENT_MODAL_RESTORE_FAILED" });
    expect(response.headers.get("set-cookie")).toBeNull();
    spy.mockRestore();
  });

  it("colonne absente : 503 à code propre, sans bruit au journal", async () => {
    jest.mocked(recordRecruitmentModalBackOn).mockRejectedValue(
      Object.assign(new Error("Unknown column"), { code: "ER_BAD_FIELD_ERROR" }),
    );
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await DELETE();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "RECRUITMENT_MODAL_ACCOUNT_UNAVAILABLE" });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
