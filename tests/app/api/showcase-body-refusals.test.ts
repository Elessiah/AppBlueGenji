import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/benevoles-service");
jest.mock("@/lib/server/bureau-service");
jest.mock("@/lib/server/recruitment-service");
jest.mock("@/lib/server/about-pillars-service");
jest.mock("@/lib/server/about-stats-service");
jest.mock("@/lib/server/sponsors-service");
jest.mock("@/lib/server/database");

import { POST as postBenevole } from "@/app/api/benevoles/route";
import { POST as postBureau } from "@/app/api/association/bureau/route";
import { POST as postRecruitment } from "@/app/api/recruitment/route";
import { POST as postPillar } from "@/app/api/association/about-pillars/route";
import { POST as postStat } from "@/app/api/association/about-stats/route";
import { POST as postSponsor } from "@/app/api/landing/sponsors/route";
import { getCurrentUser } from "@/lib/server/auth";
import { JSON_BODY_MAX_BYTES } from "@/lib/server/request-body";
import { authUser } from "../../helpers/auth-user";

/**
 * Ajouts des pages vitrine (`readJsonObject`, `lib/server/request-body.ts`) :
 * un corps trop lourd ou non JSON rendait un 400 `INVALID_BODY` sur cinq de
 * ces routes — il rend désormais son propre statut, comme `about-stats`.
 */
const ROUTES: [string, (req: Request) => Promise<Response>][] = [
  ["benevoles", postBenevole],
  ["bureau", postBureau],
  ["recruitment", postRecruitment],
  ["about-pillars", postPillar],
  ["about-stats", postStat],
  ["sponsors", postSponsor],
];

function post(body: string, type: string) {
  return new Request("http://localhost/api/x", { method: "POST", headers: { "content-type": type }, body });
}

describe("POST des pages vitrine — refus de lecture du corps", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(authUser({ id: 1, isAdmin: true }));
  });

  it.each(ROUTES)("%s_POST_oversizedBody_returns413PayloadTooLarge", async (_name, handler) => {
    const res = await handler(post(`{"a":"${"x".repeat(JSON_BODY_MAX_BYTES)}"}`, "application/json"));

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({ error: "PAYLOAD_TOO_LARGE" });
  });

  it.each(ROUTES)("%s_POST_textPlainBody_returns415UnsupportedContentType", async (_name, handler) => {
    const res = await handler(post('{"a":1}', "text/plain"));

    expect(res.status).toBe(415);
    expect(await res.json()).toEqual({ error: "UNSUPPORTED_CONTENT_TYPE" });
  });

  it.each(ROUTES)("%s_POST_brokenJson_returns400InvalidBody", async (_name, handler) => {
    const res = await handler(post("{pas", "application/json"));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "INVALID_BODY" });
  });
});
