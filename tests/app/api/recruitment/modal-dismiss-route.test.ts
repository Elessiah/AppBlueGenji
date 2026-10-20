import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/recruitment-modal-preference", () => ({
  recordRecruitmentModalOff: jest.fn(),
}));

import { POST } from "@/app/api/recruitment/modal-dismiss/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordRecruitmentModalOff } from "@/lib/server/users/recruitment-modal-preference";
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
});
