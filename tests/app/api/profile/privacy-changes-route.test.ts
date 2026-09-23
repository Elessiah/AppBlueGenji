import { beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/privacy-consent");

import { POST } from "@/app/api/profile/privacy-changes/route";
import { getCurrentUser } from "@/lib/server/auth";
import { acknowledgePrivacyChanges } from "@/lib/server/privacy-consent";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { authUser } from "../../../helpers/auth-user";

const user = authUser({ id: 42 });

function req(body: unknown) {
  return new Request("http://localhost/api/profile/privacy-changes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("POST /api/profile/privacy-changes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(user);
    jest.mocked(acknowledgePrivacyChanges).mockResolvedValue(undefined);
  });

  it("refuse un visiteur sans session", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);
    expect((await POST(req({ changeIds: [PRIVACY_CHANGES[0].id] }))).status).toBe(401);
    expect(acknowledgePrivacyChanges).not.toHaveBeenCalled();
  });

  it("enregistre les changements montrés", async () => {
    const ids = PRIVACY_CHANGES.map((c) => c.id);
    const res = await POST(req({ changeIds: ids }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ acknowledged: ids });
    expect(acknowledgePrivacyChanges).toHaveBeenCalledWith(42, ids);
  });

  it("refuse un identifiant inconnu sans rien écrire", async () => {
    const res = await POST(req({ changeIds: ["inconnu"] }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "UNKNOWN_PRIVACY_CHANGE" });
    expect(acknowledgePrivacyChanges).not.toHaveBeenCalled();
  });

  it.each([["corps vide", {}], ["liste vide", { changeIds: [] }], ["JSON illisible", "{"]])(
    "refuse une demande mal formée (%s)",
    async (_label, body) => {
      const res = await POST(req(body));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "INVALID_PRIVACY_CHANGES" });
      expect(acknowledgePrivacyChanges).not.toHaveBeenCalled();
    },
  );
});
