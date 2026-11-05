import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments-service");
jest.mock("@/lib/server/api-guard", () => ({
  ...jest.requireActual<typeof import("@/lib/server/api-guard")>("@/lib/server/api-guard"),
  enforceRateLimit: jest.fn(() => null),
}));

import { GET } from "@/app/api/tournaments/[id]/voice-links/route";
import { getCurrentUser } from "@/lib/server/auth";
import { getViewerVoiceLinks, getVisibleTournamentSnapshot } from "@/lib/server/tournaments-service";
import { authUser } from "../../../helpers/auth-user";
import { tournamentSnapshot } from "../../../helpers/tournament-detail";

/** Relecture légère des liens du salon de son équipe (`docs/features/MATCH_VOICE.md`). */

const player = authUser({ id: 2, roles: [] });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = () => new Request("http://localhost/api/tournaments/7/voice-links");

beforeEach(() => {
  jest.clearAllMocks();
});

describe("GET /api/tournaments/[id]/voice-links", () => {
  it("GET_anonymous_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await GET(request(), params("7"))).status).toBe(401);
    expect(getViewerVoiceLinks).not.toHaveBeenCalled();
  });

  it("GET_invalidTournamentId_returns400", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    expect((await GET(request(), params("abc"))).status).toBe(400);
  });

  it("GET_hiddenTournament_returns404", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(null);

    expect((await GET(request(), params("7"))).status).toBe(404);
    expect(getViewerVoiceLinks).not.toHaveBeenCalled();
  });

  it("GET_visibleTournament_returnsViewerLinks", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);
    const snapshot = tournamentSnapshot();
    jest.mocked(getVisibleTournamentSnapshot).mockResolvedValue(snapshot);
    jest.mocked(getViewerVoiceLinks).mockResolvedValue([{ matchId: 42, url: "https://discord.com/channels/12345/67890" }]);

    const res = await GET(request(), params("7"));

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ voiceLinks: [{ matchId: 42, url: "https://discord.com/channels/12345/67890" }] });
    // Toujours le lecteur lui-même : aucun identifiant d'équipe lu dans la requête.
    expect(getViewerVoiceLinks).toHaveBeenCalledWith(snapshot, 2);
  });
});
