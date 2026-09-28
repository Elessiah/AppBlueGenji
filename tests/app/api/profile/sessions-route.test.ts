import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");

import { DELETE, GET } from "@/app/api/profile/sessions/route";
import { countOtherSessions, getCurrentUser, revokeOtherSessions } from "@/lib/server/auth";
import { authUser } from "../../../helpers/auth-user";

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 7 }));
  jest.mocked(countOtherSessions).mockResolvedValue(3);
  jest.mocked(revokeOtherSessions).mockResolvedValue(3);
});

describe("/api/profile/sessions", () => {
  it("exige une session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
    expect(countOtherSessions).not.toHaveBeenCalled();
    expect(revokeOtherSessions).not.toHaveBeenCalled();
  });

  it("compte les autres sessions du compte connecté", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ otherSessions: 3 });
    expect(countOtherSessions).toHaveBeenCalledWith(7);
  });

  it("ferme les autres sessions du compte connecté", async () => {
    const response = await DELETE();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ revoked: 3 });
    expect(revokeOtherSessions).toHaveBeenCalledWith(7);
  });

  it("rend un code nommé, jamais le message brut, sur une panne", async () => {
    const spy = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(countOtherSessions).mockRejectedValue(new Error("Table 'x.bg_user_sessions' doesn't exist"));
    jest.mocked(revokeOtherSessions).mockRejectedValue(new Error("connect ECONNREFUSED"));

    const read = await GET();
    expect(read.status).toBe(500);
    await expect(read.json()).resolves.toEqual({ error: "SESSIONS_READ_FAILED" });
    const revoke = await DELETE();
    expect(revoke.status).toBe(500);
    await expect(revoke.json()).resolves.toEqual({ error: "SESSIONS_REVOKE_FAILED" });
    spy.mockRestore();
  });
});
