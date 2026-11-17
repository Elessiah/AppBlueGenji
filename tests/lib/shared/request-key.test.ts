/**
 * Clé d'un ajout renvoyé (`lib/shared/request-key.ts`) : la même clé pour le
 * même corps (réponse perdue), une clé neuve pour un formulaire corrigé.
 */
import { describe, expect, it } from "@jest/globals";
import { keyForBody, withRequestKey, type KeyedBody } from "@/lib/shared/request-key";

describe("keyForBody", () => {
  it("keyForBody_noPrevious_drawsNewKey", () => {
    const keyed = keyForBody(null, '{"name":"A"}');

    expect(keyed.body).toBe('{"name":"A"}');
    expect(keyed.key).toMatch(/^[A-Za-z0-9-]{16,64}$/);
  });

  it("keyForBody_sameBody_reusesPreviousKey", () => {
    const previous: KeyedBody = { key: "key-0000000000000001", body: '{"name":"A"}' };

    expect(keyForBody(previous, '{"name":"A"}')).toBe(previous);
  });

  it("keyForBody_changedBody_drawsNewKey", () => {
    const previous: KeyedBody = { key: "key-0000000000000001", body: '{"name":"A"}' };

    const keyed = keyForBody(previous, '{"name":"B"}');

    expect(keyed.key).not.toBe("key-0000000000000001");
    expect(keyed.body).toBe('{"name":"B"}');
  });
});

describe("withRequestKey", () => {
  it("withRequestKey_emptySlot_appendsKeyAndStoresIt", () => {
    const slot: { current: KeyedBody | null } = { current: null };

    const body = withRequestKey(slot, { name: "A" });

    expect(body.name).toBe("A");
    expect(slot.current).toEqual({ key: body.requestKey, body: '{"name":"A"}' });
  });

  it("withRequestKey_identicalRetry_sendsSameKey", () => {
    const slot: { current: KeyedBody | null } = { current: null };
    const first = withRequestKey(slot, { name: "A" });

    const retry = withRequestKey(slot, { name: "A" });

    expect(retry.requestKey).toBe(first.requestKey);
  });

  it("withRequestKey_correctedPayload_sendsNewKey", () => {
    const slot: { current: KeyedBody | null } = { current: null };
    const first = withRequestKey(slot, { name: "A" });

    const corrected = withRequestKey(slot, { name: "B" });

    expect(corrected.requestKey).not.toBe(first.requestKey);
  });

  it("withRequestKey_slotReset_sendsNewKey", () => {
    const slot: { current: KeyedBody | null } = { current: null };
    const first = withRequestKey(slot, { name: "A" });
    slot.current = null;

    const reopened = withRequestKey(slot, { name: "A" });

    expect(reopened.requestKey).not.toBe(first.requestKey);
  });
});
