import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/player-view", () => ({
  PLAYER_VIEW_NO_SESSION: "NO_SESSION",
  setPlayerView: jest.fn(),
}));

import { POST } from "@/app/api/auth/player-view/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setPlayerView } from "@/lib/server/player-view";
import { PLAYER_VIEW_TOGGLE_RULE } from "@/lib/server/api-guard";
import { resetRateLimit } from "@/lib/server/rate-limit";
import { authUser } from "../../../../helpers/auth-user";

/** `POST /api/auth/player-view` (`docs/features/ADMIN_ROLE_IMPERSONATION.md`). */
const adminInPlayerView = authUser({ id: 7, isAdmin: false, roles: [], playerView: true, playerViewAvailable: true });
const admin = authUser({ id: 7, isAdmin: true });
const player = authUser({ id: 9, roles: [] });
const referee = authUser({ id: 11, roles: ["ARBITRE"] });

function toggle(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost:3000/api/auth/player-view", {
      method: "POST",
      headers: { "content-type": "application/json", "sec-fetch-site": "same-origin", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(setPlayerView).mockResolvedValue({ until: null, roles: [] });
});

describe("POST /api/auth/player-view", () => {
  it("POST_moreEntriesThanRuleLimitPerAccount_returns429", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    for (let i = 0; i < PLAYER_VIEW_TOGGLE_RULE.limit; i += 1) await toggle({ active: true });
    jest.mocked(setPlayerView).mockClear();

    const res = await toggle({ active: true });

    expect(res.status).toBe(429);
    expect(setPlayerView).not.toHaveBeenCalled();
  });

  it("POST_exitAfterEntryLimitReached_isNeverThrottled", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    for (let i = 0; i < PLAYER_VIEW_TOGGLE_RULE.limit; i += 1) await toggle({ active: true });
    jest.mocked(getCurrentUser).mockResolvedValue(adminInPlayerView);

    const res = await toggle({ active: false });

    expect(res.status).toBe(200);
    expect(setPlayerView).toHaveBeenLastCalledWith(adminInPlayerView, false, []);
  });

  it("POST_enterWhileOtherRolesImpersonated_returns409", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(adminInPlayerView);
    jest.mocked(setPlayerView).mockResolvedValue({ until: "2026-11-20T12:00:00.000Z", roles: ["ARBITRE"] });

    const res = await toggle({ active: true, roles: ["CASTER"] });

    expect(res.status).toBe(409);
    await expect(res.json()).resolves.toMatchObject({ error: "IMPERSONATION_ALREADY_ACTIVE" });
  });

  it("POST_enterSameRolesAlreadyImpersonated_returns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(adminInPlayerView);
    jest.mocked(setPlayerView).mockResolvedValue({ until: "2026-11-20T12:00:00.000Z", roles: ["ARBITRE", "CASTER"] });

    const res = await toggle({ active: true, roles: ["CASTER", "ARBITRE"] });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ playerView: true, roles: ["ARBITRE", "CASTER"] });
  });

  it("POST_crossSiteRequest_returns403WithoutReadingSession", async () => {
    const res = await toggle({ active: true }, { "sec-fetch-site": "cross-site" });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "CROSS_SITE_REQUEST" });
    expect(getCurrentUser).not.toHaveBeenCalled();
  });

  it("POST_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await toggle({ active: true });

    expect(res.status).toBe(401);
  });

  it("POST_accountWithoutRealRights_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const res = await toggle({ active: true });

    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ error: "FORBIDDEN" });
    expect(setPlayerView).not.toHaveBeenCalled();
  });

  it("POST_nonAdminPlatformRoleHolder_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(referee);

    const res = await toggle({ active: true, roles: ["CASTER"] });

    expect(res.status).toBe(403);
    expect(setPlayerView).not.toHaveBeenCalled();
  });

  it("POST_enterWithRoles_passesThemAndReturnsStoredRoles", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setPlayerView).mockResolvedValue({ until: "2026-11-20T12:00:00.000Z", roles: ["CASTER"] });

    const res = await toggle({ active: true, roles: ["CASTER"] });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ playerView: true, until: "2026-11-20T12:00:00.000Z", roles: ["CASTER"] });
    expect(setPlayerView).toHaveBeenCalledWith(admin, true, ["CASTER"]);
  });

  it("POST_adminRoleInBody_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await toggle({ active: true, roles: ["ADMIN"] });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "INVALID_PLAYER_VIEW" });
    expect(setPlayerView).not.toHaveBeenCalled();
  });

  it("POST_returnFromPlayerView_returns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(adminInPlayerView);

    const res = await toggle({ active: false });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ playerView: false, until: null });
    expect(setPlayerView).toHaveBeenCalledWith(adminInPlayerView, false, []);
  });

  it("POST_enterPlayerView_returns200WithDeadline", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setPlayerView).mockResolvedValue({ until: "2026-11-20T12:00:00.000Z", roles: [] });

    const res = await toggle({ active: true });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ playerView: true, until: "2026-11-20T12:00:00.000Z" });
  });

  it("POST_enterPlayerViewButNothingActiveInDb_returnsPlayerViewFalse", async () => {
    // L'état relu, pas celui demandé : jamais « vue joueur » sans échéance.
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setPlayerView).mockResolvedValue({ until: null, roles: [] });

    const res = await toggle({ active: true });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ playerView: false, until: null });
  });

  it("POST_bodyWithoutBoolean_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await toggle({ active: "oui" });

    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toMatchObject({ error: "INVALID_PLAYER_VIEW" });
    expect(setPlayerView).not.toHaveBeenCalled();
  });

  it("POST_malformedJson_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);

    const res = await toggle("{");

    expect(res.status).toBe(400);
  });

  it("POST_sessionRowGone_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setPlayerView).mockRejectedValue(new Error("NO_SESSION"));

    const res = await toggle({ active: true });

    expect(res.status).toBe(401);
  });

  it("POST_databaseFailure_returns500CodeOnly", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setPlayerView).mockRejectedValue(new Error("db down"));
    jest.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await toggle({ active: true });

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "PLAYER_VIEW_FAILED" });
  });
});
