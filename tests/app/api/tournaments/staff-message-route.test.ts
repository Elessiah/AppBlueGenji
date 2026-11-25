import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournament-staff-message", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/tournament-staff-message")>("@/lib/server/tournament-staff-message");
  return {
    ...actual,
    countTournamentStaffMessageRecipients: jest.fn(),
    previewTournamentStaffMessage: jest.fn(),
    sendTournamentStaffMessage: jest.fn(),
  };
});

import { POST } from "@/app/api/tournaments/[id]/staff-message/route";
import { getCurrentUser } from "@/lib/server/auth";
import { resetRateLimit } from "@/lib/server/rate-limit";
import {
  countTournamentStaffMessageRecipients,
  previewTournamentStaffMessage,
  sendTournamentStaffMessage,
  StaffMessageError,
} from "@/lib/server/tournament-staff-message";
import { authUser } from "../../../helpers/auth-user";

/** `POST /api/tournaments/[id]/staff-message` : la porte du site de `/message-tournoi` — session, permission, même service. */

const referee = authUser({ id: 7, pseudo: "Arbitre", roles: ["ARBITRE"] });
const player = authUser({ id: 8, pseudo: "Joueur" });
const counts = {
  tournament: { id: 12, name: "Coupe" },
  recipients: { total: 4, reachable: 2, withoutDiscord: 1, optedOut: 1 },
};
const params = (id: string) => ({ params: Promise.resolve({ id }) });

function call(payload: unknown, id = "12") {
  return POST(
    new Request(`http://localhost/api/tournaments/${id}/staff-message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    params(id),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  jest.mocked(getCurrentUser).mockResolvedValue(referee);
  jest.mocked(countTournamentStaffMessageRecipients).mockResolvedValue(counts);
  jest.mocked(previewTournamentStaffMessage).mockResolvedValue(counts);
  jest.mocked(sendTournamentStaffMessage).mockResolvedValue({
    ...counts,
    delivery: { sent: 2, failed: 0, skipped: 2, pushed: 3, botUnreachable: false, pending: false },
  });
});

describe("POST /api/tournaments/[id]/staff-message — accès", () => {
  it("POST_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const actual = await call({ mode: "count", categories: ["ALL"] });

    expect(actual.status).toBe(401);
    expect(countTournamentStaffMessageRecipients).not.toHaveBeenCalled();
  });

  it("POST_badTournamentId_returns400", async () => {
    const actual = await call({ mode: "count", categories: ["ALL"] }, "abc");

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_TOURNAMENT_ID" });
  });

  it("POST_withoutTournamentsPermission_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    const actual = await call({ mode: "send", categories: ["ALL"], message: "Salut" });

    expect(actual.status).toBe(403);
    await expect(actual.json()).resolves.toEqual({ error: "FORBIDDEN" });
    expect(sendTournamentStaffMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/tournaments/[id]/staff-message — temps", () => {
  it("POST_count_returnsCountsWithoutMessage", async () => {
    const actual = await call({ mode: "count", categories: ["OWNERS", "PLAYERS"] });

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toEqual({ mode: "count", ...counts });
    expect(countTournamentStaffMessageRecipients).toHaveBeenCalledWith({
      author: { userId: 7 },
      tournamentId: 12,
      categories: ["PLAYERS", "OWNERS"],
    });
  });

  it("POST_countBadCategories_returns400", async () => {
    const actual = await call({ mode: "count", categories: [] });

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "INVALID_RECIPIENT_CATEGORIES" });
  });

  it("POST_preview_returnsCounts", async () => {
    const actual = await call({ mode: "preview", categories: ["ALL"], message: "Salut" });

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toEqual({ mode: "preview", ...counts });
  });

  it("POST_send_callsSharedServiceWithSessionAuthor", async () => {
    const actual = await call({ mode: "send", categories: ["CAPTAINS"], message: "  Check-in à 20 h\r\n" });

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toMatchObject({ mode: "send", delivery: { sent: 2, pushed: 3 } });
    expect(sendTournamentStaffMessage).toHaveBeenCalledWith({
      author: { userId: 7 },
      tournamentId: 12,
      categories: ["CAPTAINS"],
      message: "Check-in à 20 h",
    });
  });

  it("POST_blankMessage_returns400", async () => {
    const actual = await call({ mode: "send", categories: ["ALL"], message: "   " });

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: "STAFF_MESSAGE_EMPTY" });
    expect(sendTournamentStaffMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/tournaments/[id]/staff-message — refus", () => {
  it("POST_serviceRefuses_returnsCodeAndStatus", async () => {
    jest.mocked(sendTournamentStaffMessage).mockRejectedValue(new StaffMessageError("STAFF_MESSAGE_QUOTA_EXCEEDED", 429));

    const actual = await call({ mode: "send", categories: ["ALL"], message: "Salut" });

    expect(actual.status).toBe(429);
    await expect(actual.json()).resolves.toEqual({ error: "STAFF_MESSAGE_QUOTA_EXCEEDED" });
  });

  it("POST_unexpectedError_returns500CodeOnly", async () => {
    jest.mocked(countTournamentStaffMessageRecipients).mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:3306"));

    const actual = await call({ mode: "count", categories: ["ALL"] });

    expect(actual.status).toBe(500);
    await expect(actual.json()).resolves.toEqual({ error: "INTERNAL_ERROR" });
  });

  it("POST_beyondCallCap_returns429", async () => {
    for (let i = 0; i < 120; i += 1) await call({ mode: "count", categories: ["ALL"] });

    const actual = await call({ mode: "count", categories: ["ALL"] });

    expect(actual.status).toBe(429);
  });
});
