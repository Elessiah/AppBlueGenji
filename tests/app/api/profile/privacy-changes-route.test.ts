import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/auth");
jest.mock("@/lib/server/privacy-consent");

import { GET, POST } from "@/app/api/profile/privacy-changes/route";
import { getCurrentUser } from "@/lib/server/auth";
import { acknowledgePrivacyChanges } from "@/lib/server/privacy-consent";
import { PRIVACY_CHANGES } from "@/lib/shared/privacy-changes";
import { localizedPrivacyChanges } from "@/lib/shared/privacy-changes-en";
import { authUser } from "../../../helpers/auth-user";

const user = authUser({ id: 42 });

function req(body: unknown) {
  return new Request("http://localhost/api/profile/privacy-changes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

/** Seule l'horloge est simulée : les promesses du corps de requête tournent normalement. */
function atInstant(iso: string) {
  jest.useFakeTimers({
    now: new Date(iso),
    doNotFake: ["nextTick", "setImmediate", "setTimeout", "setInterval", "queueMicrotask", "clearTimeout", "clearInterval"],
  });
}

describe("POST /api/profile/privacy-changes", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    // Après tout le registre : chaque entrée est publiée.
    atInstant("2099-01-01T12:00:00Z");
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

  it("refuse une entrée pas encore publiée au jour de Paris, sans rien écrire", async () => {
    const entry = PRIVACY_CHANGES.at(-1)!;
    // 23 h 30 à Paris la veille de la publication : encore la veille.
    const eve = new Date(Date.parse(`${entry.publishedAt}T00:00:00Z`) - 3 * 3_600_000).toISOString();
    atInstant(eve);
    const refused = await POST(req({ changeIds: [entry.id] }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: "UNKNOWN_PRIVACY_CHANGE" });
    expect(acknowledgePrivacyChanges).not.toHaveBeenCalled();

    // 23 h 30 UTC la veille : minuit passé à Paris en toute saison (UTC+1 ou +2).
    atInstant(`${entry.publishedAt}T00:30:00+01:00`);
    expect((await POST(req({ changeIds: [entry.id] }))).status).toBe(200);
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

// #587 : la mise en page n'envoie plus le détail des entrées ; la modale le lit ici.
describe("GET /api/profile/privacy-changes", () => {
  const getReq = (query: string) => new Request(`http://localhost/api/profile/privacy-changes?${query}`);
  const first = PRIVACY_CHANGES[0];
  const second = PRIVACY_CHANGES[1];

  afterEach(() => {
    jest.useRealTimers();
  });

  beforeEach(() => {
    atInstant("2099-01-01T12:00:00Z");
    jest.clearAllMocks();
    jest.mocked(getCurrentUser).mockResolvedValue(user);
  });

  it("GET_noSession_returns401", async () => {
    jest.mocked(getCurrentUser).mockResolvedValue(null);

    const res = await GET(getReq(`ids=${first.id}`));

    expect(res.status).toBe(401);
  });

  it("GET_publishedIds_returnsTheirFrenchDetailsById", async () => {
    const res = await GET(getReq(`ids=${first.id},${second.id}&locale=fr`));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ details: { [first.id]: first.details, [second.id]: second.details } });
  });

  it("GET_englishLocale_returnsTheEnglishDetails", async () => {
    const english = localizedPrivacyChanges([first], "en")[0];

    const res = await GET(getReq(`ids=${first.id}&locale=en`));

    expect(await res.json()).toEqual({ details: { [first.id]: english.details } });
  });

  it("GET_noIds_returns400", async () => {
    const res = await GET(getReq("ids="));

    expect(res.status).toBe(400);
  });

  it("GET_unknownId_returns400", async () => {
    const res = await GET(getReq(`ids=${first.id},inconnu`));

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "UNKNOWN_PRIVACY_CHANGE" });
  });

  it("GET_readsNoAccountData", async () => {
    await GET(getReq(`ids=${first.id}`));

    expect(acknowledgePrivacyChanges).not.toHaveBeenCalled();
  });
});
