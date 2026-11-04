import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/tournaments/round-maps-notice");

import { POST as flushPost } from "@/app/api/admin/tournaments/[id]/round-maps/flush/route";
import { getCurrentUser } from "@/lib/server/auth";
import { flushRoundMapsNotice } from "@/lib/server/tournaments/round-maps-notice";
import { ROUND_MAPS_FLUSH_ROUNDS_MAX } from "@/lib/shared/round-maps";
import { authUser } from "../../helpers/auth-user";

/** Corps du signal de fermeture : les manches écrites par l'écran (`docs/features/ROUND_MAPS.md`). */

const context = { params: Promise.resolve({ id: "7" }) };
const post = (body?: string) =>
  new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": "application/json" }, body });
const withRounds = (rounds: unknown) => post(JSON.stringify({ rounds }));

beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 3, roles: ["ARBITRE"] }));
  jest.mocked(flushRoundMapsNotice).mockResolvedValue(true);
});

describe("POST /round-maps/flush — body", () => {
  it("flush_validRoundsBody_passesTheListToTheService", async () => {
    const response = await flushPost(withRounds(["0:UPPER:2", "1:LOWER:3"]), context);

    expect(response.status).toBe(200);
    expect(flushRoundMapsNotice).toHaveBeenCalledWith(7, ["0:UPPER:2", "1:LOWER:3"]);
  });

  it("flush_oversizedBody_returns400WithoutFlushing", async () => {
    const response = await flushPost(post(`{"rounds":[],"pad":"${"x".repeat(40_000)}"}`), context);

    expect(response.status).toBe(400);
    expect(flushRoundMapsNotice).not.toHaveBeenCalled();
  });

  it("flush_noBody_passesUndefined", async () => {
    await flushPost(post(), context);

    expect(flushRoundMapsNotice).toHaveBeenCalledWith(7, undefined);
  });

  it("flush_malformedJson_returns400AndFlushesNothing", async () => {
    const response = await flushPost(post("{oups"), context);

    expect(response.status).toBe(400);
    expect(flushRoundMapsNotice).not.toHaveBeenCalled();
  });

  it("flush_bodyWithoutRoundsKey_passesUndefined", async () => {
    await flushPost(post("{}"), context);

    expect(flushRoundMapsNotice).toHaveBeenCalledWith(7, undefined);
  });

  it("flush_roundsNotAnArray_returns400", async () => {
    const response = await flushPost(withRounds("0:UPPER:2"), context);

    expect(response.status).toBe(400);
    expect(flushRoundMapsNotice).not.toHaveBeenCalled();
  });

  it("flush_malformedKey_returns400", async () => {
    const response = await flushPost(withRounds(["0:UPPER:2", "oups"]), context);

    expect(response.status).toBe(400);
  });

  it("flush_exactlyMaxKeys_accepted", async () => {
    const rounds = Array.from({ length: ROUND_MAPS_FLUSH_ROUNDS_MAX }, (_, index) => `0:UPPER:${index + 1}`);

    expect((await flushPost(withRounds(rounds), context)).status).toBe(200);
  });

  it("flush_moreThanMaxKeys_returns400", async () => {
    const rounds = Array.from({ length: ROUND_MAPS_FLUSH_ROUNDS_MAX + 1 }, (_, index) => `0:UPPER:${index + 1}`);

    expect((await flushPost(withRounds(rounds), context)).status).toBe(400);
  });
});
