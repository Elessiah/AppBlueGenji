import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/player-view", () => ({
  PLAYER_VIEW_NO_SESSION: "NO_SESSION",
  setPlayerView: jest.fn(),
}));

import { POST } from "@/app/api/auth/player-view/route";
import { getCurrentUser } from "@/lib/server/auth";
import { setPlayerView } from "@/lib/server/player-view";
import { authUser } from "../../../../helpers/auth-user";

/** `POST /api/auth/player-view` (`docs/features/ADMIN_PLAYER_VIEW.md`). */
const adminInPlayerView = authUser({ id: 7, isAdmin: false, roles: [], playerView: true, playerViewAvailable: true });
const admin = authUser({ id: 7, isAdmin: true });
const player = authUser({ id: 9, roles: [] });

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
  jest.mocked(setPlayerView).mockResolvedValue({ until: null });
});

describe("POST /api/auth/player-view", () => {
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

  it("POST_returnFromPlayerView_returns200", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(adminInPlayerView);

    const res = await toggle({ active: false });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ playerView: false, until: null });
    expect(setPlayerView).toHaveBeenCalledWith(adminInPlayerView, false);
  });

  it("POST_enterPlayerView_returns200WithDeadline", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setPlayerView).mockResolvedValue({ until: "2026-11-20T12:00:00.000Z" });

    const res = await toggle({ active: true });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ playerView: true, until: "2026-11-20T12:00:00.000Z" });
  });

  it("POST_enterPlayerViewButNothingActiveInDb_returnsPlayerViewFalse", async () => {
    // L'état relu, pas celui demandé : jamais « vue joueur » sans échéance.
    jest.mocked(getCurrentUser).mockResolvedValue(admin);
    jest.mocked(setPlayerView).mockResolvedValue({ until: null });

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
