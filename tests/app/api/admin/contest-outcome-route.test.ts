import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/logo-quarantine");

import { POST as recordOutcome } from "@/app/api/admin/logo-quarantines/[id]/contest-outcome/route";
import { getCurrentUser } from "@/lib/server/auth";
import { recordContestOutcome } from "@/lib/server/logo-quarantine";
import { authUser } from "../../../helpers/auth-user";

/* Décision D22 : la modération écrit l'issue d'une contestation. */

const admin = authUser({ id: 1, pseudo: "Admin", isAdmin: true, roles: ["ADMIN"] });
const player = authUser({ id: 2, pseudo: "Joueur" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown) =>
  new Request("http://localhost/api/admin/logo-quarantines/30/contest-outcome", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(admin);
  jest.mocked(recordContestOutcome).mockResolvedValue({ blocked: false, hashUnknown: false });
});

describe("POST /api/admin/logo-quarantines/[id]/contest-outcome", () => {
  it("recordOutcome_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    expect((await recordOutcome(post({ outcome: "UPHELD" }), params("30"))).status).toBe(401);
  });

  it("recordOutcome_withoutModeration_returns403", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(player);

    expect((await recordOutcome(post({ outcome: "UPHELD" }), params("30"))).status).toBe(403);
    expect(recordContestOutcome).not.toHaveBeenCalled();
  });

  it("recordOutcome_invalidId_returns404", async () => {
    expect((await recordOutcome(post({ outcome: "UPHELD" }), params("abc"))).status).toBe(404);
  });

  it("recordOutcome_unknownOutcome_returns400", async () => {
    const response = await recordOutcome(post({ outcome: "MAYBE" }), params("30"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(expect.objectContaining({ error: "INVALID_CONTEST_OUTCOME" }));
    expect(recordContestOutcome).not.toHaveBeenCalled();
  });

  it("recordOutcome_valid_returnsBlockState", async () => {
    const response = await recordOutcome(post({ outcome: "OVERTURNED" }), params("30"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(expect.objectContaining({ blocked: false, hashUnknown: false }));
    expect(recordContestOutcome).toHaveBeenCalledWith(30, "OVERTURNED", { userId: 1, pseudo: "Admin" });
  });

  it.each<[string, number]>([
    ["QUARANTINE_NOT_FOUND", 404],
    ["QUARANTINE_CLOSED", 409],
  ])("recordOutcome_refusal_%s_returns%i", async (code, status) => {
    jest.mocked(recordContestOutcome).mockRejectedValue(new Error(code));

    expect((await recordOutcome(post({ outcome: "UPHELD" }), params("30"))).status).toBe(status);
  });

  it("recordOutcome_unexpectedError_returns500", async () => {
    jest.mocked(recordContestOutcome).mockRejectedValue(new Error("boom"));
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await recordOutcome(post({ outcome: "UPHELD" }), params("30"));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(expect.objectContaining({ error: "CONTEST_OUTCOME_FAILED" }));
    logged.mockRestore();
  });
});
