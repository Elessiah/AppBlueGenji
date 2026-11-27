import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";

jest.mock("@/lib/server/database", () => ({ getDatabase: jest.fn() }));
jest.mock("@/lib/server/geti/posts", () => ({
  upsertGetiPosts: jest.fn(),
  deleteGetiPosts: jest.fn(),
  reconcileGetiChannel: jest.fn(),
}));

import { POST as deletePosts } from "@/app/api/internal/geti/posts/delete/route";
import { POST as upsertPosts } from "@/app/api/internal/geti/posts/route";
import { POST as reconcile } from "@/app/api/internal/geti/reconcile/route";
import { getDatabase } from "@/lib/server/database";
import { GETI_INGEST_RULE } from "@/lib/server/geti/ingest-route";
import { deleteGetiPosts, reconcileGetiChannel, upsertGetiPosts } from "@/lib/server/geti/posts";
import { chargeRateLimit, resetRateLimit } from "@/lib/server/rate-limit";
import { GETI_CHANNEL_IDS } from "@/lib/shared/geti";
import { GETI_FAKE_MESSAGE_ID, getiWirePost } from "../../../../helpers/geti-ingest";
import { fakePool } from "../../../../helpers/sql-double";

/** Routes `/api/internal/geti/*` : jeton, plafond, forme du corps, nombres seuls. */

const TOKEN = "s".repeat(40);
const savedToken = process.env.SITE_INTERNAL_TOKEN;
const pool = fakePool({});

type Route = (req: Request) => Promise<Response>;
type CallOptions = { token?: string | null; contentType?: string; forwardedFor?: string };

function call(route: Route, path: string, payload: unknown, options: CallOptions = {}): Promise<Response> {
  const headers: Record<string, string> = { "content-type": options.contentType ?? "application/json" };
  if (options.token !== null) headers["x-internal-token"] = options.token ?? TOKEN;
  if (options.forwardedFor) headers["x-forwarded-for"] = options.forwardedFor;
  return route(
    new Request(`http://127.0.0.1:3000/api/internal/geti/${path}`, {
      method: "POST",
      headers,
      body: typeof payload === "string" ? payload : JSON.stringify(payload),
    }),
  );
}

const callUpsert = (payload: unknown, options?: CallOptions) => call(upsertPosts, "posts", payload, options);
const callDelete = (payload: unknown, options?: CallOptions) => call(deletePosts, "posts/delete", payload, options);
const callReconcile = (payload: unknown, options?: CallOptions) => call(reconcile, "reconcile", payload, options);

const window = {
  channelId: GETI_CHANNEL_IDS.lfp,
  since: "2026-11-13T10:00:00.000Z",
  until: "2026-11-27T10:00:00.000Z",
  ids: [GETI_FAKE_MESSAGE_ID],
};

beforeEach(() => {
  jest.clearAllMocks();
  resetRateLimit();
  process.env.SITE_INTERNAL_TOKEN = TOKEN;
  jest.mocked(getDatabase).mockResolvedValue(pool);
  jest.mocked(upsertGetiPosts).mockResolvedValue({ stored: 1, emptied: 0, expired: 0 });
  jest.mocked(deleteGetiPosts).mockResolvedValue(1);
  jest.mocked(reconcileGetiChannel).mockResolvedValue(2);
});

afterEach(() => {
  if (savedToken === undefined) delete process.env.SITE_INTERNAL_TOKEN;
  else process.env.SITE_INTERNAL_TOKEN = savedToken;
});

describe("POST /api/internal/geti/posts", () => {
  it("POST_tokenNotConfigured_returns503", async () => {
    delete process.env.SITE_INTERNAL_TOKEN;

    const response = await callUpsert({ posts: [getiWirePost()] });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "SITE_INTERNAL_TOKEN_NOT_CONFIGURED" });
    expect(upsertGetiPosts).not.toHaveBeenCalled();
  });

  it("POST_missingToken_returns401", async () => {
    const response = await callUpsert({ posts: [getiWirePost()] }, { token: null });

    expect(response.status).toBe(401);
    expect(upsertGetiPosts).not.toHaveBeenCalled();
  });

  it("POST_wrongToken_returns401", async () => {
    const response = await callUpsert({ posts: [getiWirePost()] }, { token: "x".repeat(40) });

    expect(response.status).toBe(401);
  });

  it("POST_throughThePublicProxy_returns403", async () => {
    const response = await callUpsert({ posts: [getiWirePost()] }, { forwardedFor: "203.0.113.7" });

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "INTERNAL_ROUTE_LOOPBACK_ONLY" });
  });

  it("POST_rateLimitReached_returns429", async () => {
    for (let index = 0; index < GETI_INGEST_RULE.limit; index += 1) chargeRateLimit(GETI_INGEST_RULE, "bot");

    const response = await callUpsert({ posts: [getiWirePost()] });

    expect(response.status).toBe(429);
    expect(upsertGetiPosts).not.toHaveBeenCalled();
  });

  it("POST_bodyNotDeclaredJson_returns415", async () => {
    const response = await callUpsert({ posts: [] }, { contentType: "text/plain" });

    expect(response.status).toBe(415);
  });

  it("POST_bodyOverTheLimit_returns413", async () => {
    const response = await callUpsert({ posts: [], padding: "x".repeat(513 * 1024) });

    expect(response.status).toBe(413);
  });

  it("POST_invalidJson_returns400", async () => {
    const response = await callUpsert("{");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "GETI_INVALID_REQUEST" });
  });

  it("POST_validBatch_returns200WithCountsOnly", async () => {
    const response = await callUpsert({ posts: [getiWirePost(), { id: "illisible" }] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ stored: 1, emptied: 0, expired: 0, rejected: 1 });
    expect(upsertGetiPosts).toHaveBeenCalledWith(pool, [expect.objectContaining({ messageId: GETI_FAKE_MESSAGE_ID })]);
  });

  it("POST_tooManyPosts_returns400", async () => {
    const posts = Array.from({ length: 21 }, () => getiWirePost());

    const response = await callUpsert({ posts });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "GETI_TOO_MANY_POSTS" });
  });

  it("POST_databaseFails_returns503WithACodeOnly", async () => {
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);
    jest.mocked(upsertGetiPosts).mockRejectedValue(new Error("Table 'bg.bg_geti_posts' doesn't exist"));

    const response = await callUpsert({ posts: [getiWirePost()] });

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "GETI_UNAVAILABLE" });
    logged.mockRestore();
  });
});

describe("POST /api/internal/geti/posts/delete", () => {
  it("POST_missingToken_returns401", async () => {
    const response = await callDelete({ ids: [GETI_FAKE_MESSAGE_ID] }, { token: null });

    expect(response.status).toBe(401);
    expect(deleteGetiPosts).not.toHaveBeenCalled();
  });

  it("POST_throughThePublicProxy_returns403", async () => {
    const response = await callDelete({ ids: [GETI_FAKE_MESSAGE_ID] }, { forwardedFor: "203.0.113.7" });

    expect(response.status).toBe(403);
  });

  it("POST_validIds_returns200WithTheRemovedCount", async () => {
    const response = await callDelete({ ids: [GETI_FAKE_MESSAGE_ID] });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: 1 });
    expect(deleteGetiPosts).toHaveBeenCalledWith(pool, [GETI_FAKE_MESSAGE_ID]);
  });

  it("POST_invalidId_returns400", async () => {
    const response = await callDelete({ ids: ["tout"] });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "GETI_INVALID_REQUEST" });
    expect(deleteGetiPosts).not.toHaveBeenCalled();
  });

  it("POST_bodyOverTheSmallLimit_returns413", async () => {
    const response = await callDelete({ ids: [GETI_FAKE_MESSAGE_ID], padding: "x".repeat(33 * 1024) });

    expect(response.status).toBe(413);
  });
});

describe("POST /api/internal/geti/reconcile", () => {
  it("POST_missingToken_returns401", async () => {
    const response = await callReconcile(window, { token: null });

    expect(response.status).toBe(401);
    expect(reconcileGetiChannel).not.toHaveBeenCalled();
  });

  it("POST_throughThePublicProxy_returns403", async () => {
    const response = await callReconcile(window, { forwardedFor: "203.0.113.7" });

    expect(response.status).toBe(403);
  });

  it("POST_validWindow_returns200WithTheRemovedCount", async () => {
    const response = await callReconcile(window);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: 2 });
    expect(reconcileGetiChannel).toHaveBeenCalledWith(pool, {
      channelId: GETI_CHANNEL_IDS.lfp,
      since: new Date(window.since),
      until: new Date(window.until),
      ids: [GETI_FAKE_MESSAGE_ID],
    });
  });

  it("POST_channelOutsideTheSixSources_returns400", async () => {
    const response = await callReconcile({ ...window, channelId: "100000000000000555" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "GETI_UNKNOWN_CHANNEL" });
  });

  it("POST_sinceAfterUntil_returns400", async () => {
    const response = await callReconcile({ ...window, since: "2026-11-28T10:00:00.000Z" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "GETI_INVALID_WINDOW" });
    expect(reconcileGetiChannel).not.toHaveBeenCalled();
  });
});
