import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/users/recruitment-modal-preference", () => ({
  recordRecruitmentModalOff: jest.fn(),
}));

import { POST } from "@/app/api/recruitment/modal-dismiss/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordRecruitmentModalOff } from "@/lib/server/users/recruitment-modal-preference";
import { authUser } from "../../../helpers/auth-user";

/** `POST /api/recruitment/modal-dismiss` : « Ne plus afficher » gardé sur le compte. */

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(recordRecruitmentModalOff).mockResolvedValue(true);
});

describe("POST /api/recruitment/modal-dismiss", () => {
  it("pose le choix sur le compte connecté", async () => {
    const response = await POST();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ off: true });
    expect(recordRecruitmentModalOff).toHaveBeenCalledWith(7);
  });

  it("refuse sans session, par un code seul (le navigateur garde son cookie)", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    const response = await POST();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "UNAUTHORIZED" });
    expect(recordRecruitmentModalOff).not.toHaveBeenCalled();
  });

  it("répond 409 quand le compte vient d'être supprimé", async () => {
    jest.mocked(recordRecruitmentModalOff).mockResolvedValue(false);
    const response = await POST();
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ACCOUNT_DELETED" });
  });

  it("répond par un code sur une panne de base, sans phrase", async () => {
    jest.mocked(recordRecruitmentModalOff).mockRejectedValue(new Error("down"));
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await POST();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "RECRUITMENT_MODAL_DISMISS_FAILED" });
    spy.mockRestore();
  });
});
