import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/tournament-staff-message", () => {
  const actual = jest.requireActual<typeof import("@/lib/server/tournament-staff-message")>("@/lib/server/tournament-staff-message");
  return { ...actual, previewTournamentStaffMessage: jest.fn(), sendTournamentStaffMessage: jest.fn() };
});

import { POST } from "@/app/api/internal/tournament-message/route";
import { resetRateLimit } from "@/lib/server/rate-limit";
import {
  previewTournamentStaffMessage,
  sendTournamentStaffMessage,
  StaffMessageError,
} from "@/lib/server/tournament-staff-message";

/** `POST /api/internal/tournament-message` : jeton, forme du corps, codes seuls, nombres seuls. */

const saved = process.env.SITE_INTERNAL_TOKEN;
const preview = {
  tournament: { id: 12, name: "Coupe" },
  recipients: { total: 2, reachable: 1, withoutDiscord: 1, optedOut: 0 },
};

function body(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mode: "preview",
    discordId: "100000000000000009",
    tournamentId: 12,
    categories: ["ALL"],
    message: "Check-in à 20 h",
    ...overrides,
  };
}

function call(payload: unknown, options: { token?: string | null; contentType?: string } = {}) {
  const headers: Record<string, string> = { "content-type": options.contentType ?? "application/json" };
  if (options.token !== null) headers["x-internal-token"] = options.token ?? "secret";
  return POST(
    new Request("http://127.0.0.1:3000/api/internal/tournament-message", {
      method: "POST",
      headers,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  process.env.SITE_INTERNAL_TOKEN = "secret";
  jest.mocked(previewTournamentStaffMessage).mockResolvedValue(preview);
  jest.mocked(sendTournamentStaffMessage).mockResolvedValue({
    ...preview,
    delivery: { sent: 1, failed: 0, unconfirmed: 0, skipped: 1, pushed: 2, botUnreachable: false, pending: false },
  });
});

afterEach(() => {
  if (saved === undefined) delete process.env.SITE_INTERNAL_TOKEN;
  else process.env.SITE_INTERNAL_TOKEN = saved;
});

describe("POST /api/internal/tournament-message — jeton", () => {
  it("POST_tokenNotConfigured_returns503", async () => {
    delete process.env.SITE_INTERNAL_TOKEN;

    const actual = await call(body());

    expect(actual.status).toBe(503);
    expect(previewTournamentStaffMessage).not.toHaveBeenCalled();
  });

  it("POST_missingToken_returns401", async () => {
    const actual = await call(body(), { token: null });

    expect(actual.status).toBe(401);
  });

  it("POST_wrongToken_returns401WithoutCallingTheService", async () => {
    const actual = await call(body(), { token: "nope" });

    expect(actual.status).toBe(401);
    expect(previewTournamentStaffMessage).not.toHaveBeenCalled();
  });
});

describe("POST /api/internal/tournament-message — corps", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["unknownMode", { mode: "draft" }, "INVALID_STAFF_MESSAGE_REQUEST"],
    ["badDiscordId", { discordId: "12" }, "INVALID_DISCORD_ID"],
    ["badTournament", { tournamentId: 0 }, "INVALID_TOURNAMENT_ID"],
    ["noCategory", { categories: [] }, "INVALID_RECIPIENT_CATEGORIES"],
    ["unknownCategory", { categories: ["FANS"] }, "INVALID_RECIPIENT_CATEGORIES"],
    ["blankMessage", { message: "   " }, "STAFF_MESSAGE_EMPTY"],
    ["messageNotText", { message: 5 }, "INVALID_STAFF_MESSAGE_REQUEST"],
  ])("POST_%s_returns400", async (_name, overrides, code) => {
    const actual = await call(body(overrides));

    expect(actual.status).toBe(400);
    await expect(actual.json()).resolves.toEqual({ error: code });
  });

  it("POST_invalidJson_returns400", async () => {
    const actual = await call("{oops");

    expect(actual.status).toBe(400);
  });

  it("POST_notJson_returns415", async () => {
    const actual = await call("mode=preview", { contentType: "text/plain" });

    expect(actual.status).toBe(415);
  });
});

describe("POST /api/internal/tournament-message — issues", () => {
  it("POST_preview_returnsCounts", async () => {
    const actual = await call(body());

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toEqual({ mode: "preview", ...preview });
    expect(previewTournamentStaffMessage).toHaveBeenCalledWith({
      author: { discordId: "100000000000000009" },
      tournamentId: 12,
      categories: ["ALL"],
      message: "Check-in à 20 h",
    });
  });

  it("POST_send_returnsDelivery", async () => {
    const actual = await call(body({ mode: "send", categories: ["OWNERS", "PLAYERS"] }));

    expect(actual.status).toBe(200);
    await expect(actual.json()).resolves.toMatchObject({ mode: "send", delivery: { sent: 1, pushed: 2 } });
    expect(jest.mocked(sendTournamentStaffMessage).mock.calls[0][0].categories).toEqual(["PLAYERS", "OWNERS"]);
  });

  it.each<[string, number]>([
    ["FORBIDDEN", 403],
    ["TOURNAMENT_NOT_FOUND", 404],
    ["TOURNAMENT_NOT_OPEN_FOR_MESSAGES", 409],
    ["STAFF_MESSAGE_QUOTA_EXCEEDED", 429],
  ])("POST_serviceRefuses_%s_returns%i", async (code, status) => {
    jest.mocked(previewTournamentStaffMessage).mockRejectedValue(new StaffMessageError(code, status));

    const actual = await call(body());

    expect(actual.status).toBe(status);
    await expect(actual.json()).resolves.toEqual({ error: code });
  });

  it("POST_unexpectedError_returns500WithCodeOnly", async () => {
    jest.mocked(previewTournamentStaffMessage).mockRejectedValue(new Error("connect ECONNREFUSED 10.0.0.1:3306"));

    const actual = await call(body());

    expect(actual.status).toBe(500);
    await expect(actual.json()).resolves.toEqual({ error: "INTERNAL_ERROR" });
  });

  it("POST_sixtyFirstCallInTenMinutes_returns429", async () => {
    for (let i = 0; i < 60; i += 1) await call(body());

    const actual = await call(body());

    expect(actual.status).toBe(429);
  });
});
