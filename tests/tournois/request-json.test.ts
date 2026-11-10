import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { requestJson } from "@/app/(secured)/tournois/[id]/_lib/request-json";
import frActions from "@/messages/fr/tournamentActions.json";
import enActions from "@/messages/en/tournamentActions.json";
import frProfile from "@/messages/fr/profile.json";
import enProfile from "@/messages/en/profile.json";

type Reply = { ok: boolean; json: () => Promise<unknown> };

function stubFetch(reply: Reply) {
  const fetchMock = jest.fn<(url: string, init: RequestInit) => Promise<Reply>>().mockResolvedValue(reply);
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  return fetchMock;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("requestJson", () => {
  it("requestJson_okWithBody_returnsPayloadAndSendsJson", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({ done: true }) });
    const payload = await requestJson("/api/x", { method: "PUT", body: { a: 1 } }, "FALLBACK");
    expect(payload).toEqual({ done: true });
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe('{"a":1}');
    expect(init?.headers).toEqual({ "content-type": "application/json" });
  });

  it("requestJson_noBody_sendsNoHeadersAndDefaultsToGet", async () => {
    const fetchMock = stubFetch({ ok: true, json: async () => ({}) });
    await requestJson("/api/x", {}, "FALLBACK");
    const init = fetchMock.mock.calls[0]?.[1];
    expect(init?.method).toBe("GET");
    expect(init?.headers).toBeUndefined();
    expect(init?.body).toBeUndefined();
  });

  it("requestJson_refusalWithCode_throwsServerCode", async () => {
    stubFetch({ ok: false, json: async () => ({ error: "MATCH_NOT_STREAMED" }) });
    await expect(requestJson("/api/x", { method: "DELETE" }, "FALLBACK")).rejects.toThrow("MATCH_NOT_STREAMED");
  });

  it("requestJson_unreadableBodyOnFailure_throwsFallbackCode", async () => {
    stubFetch({
      ok: false,
      json: async () => {
        throw new SyntaxError("Unexpected token <");
      },
    });
    await expect(requestJson("/api/x", {}, "FALLBACK")).rejects.toThrow("FALLBACK");
  });

  it("requestJson_unreadableBodyOnSuccess_returnsEmptyObject", async () => {
    stubFetch({
      ok: true,
      json: async () => {
        throw new SyntaxError("empty");
      },
    });
    await expect(requestJson("/api/x", {}, "FALLBACK")).resolves.toEqual({});
  });
});

describe("textes du champ lien et BattleTag du cast", () => {
  it("castSettings_organisationLabelAndPlaceholder_frAndEn", () => {
    expect(frActions.cardActions.castSettings.urlOrganisation).toBe("Lien du stream de l'organisation");
    expect(enActions.cardActions.castSettings.urlOrganisation).toBe("Organisation stream link");
    expect(frActions.cardActions.castSettings.battletagPlaceholder).toBe(frProfile.games.battletagPlaceholder);
    expect(enActions.cardActions.castSettings.battletagPlaceholder).toBe(enProfile.games.battletagPlaceholder);
  });
});
