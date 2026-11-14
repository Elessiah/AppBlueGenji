import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { putToggle, saveSimpleToggle, toggleErrorText, TOGGLE_ROUTES, type ToggleKind } from "@/app/(secured)/tournois/_lib/toggle-save";
import { CodedError } from "@/lib/shared/field-errors";
import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";
import frForm from "@/messages/fr/tournamentForm.json";
import enForm from "@/messages/en/tournamentForm.json";

function lookup(messages: unknown, path: string): string {
  let node = messages as Record<string, unknown> | string | undefined;
  for (const part of path.split(".")) node = (node as Record<string, unknown> | undefined)?.[part] as typeof node;
  if (typeof node !== "string") throw new Error(`missing key ${path}`);
  return node;
}

const textOf = (messages: unknown): TournamentFormText => ({ t: (key: string) => lookup(messages, key) }) as TournamentFormText;
const KINDS = Object.keys(TOGGLE_ROUTES) as ToggleKind[];

function mockFetch(status: number, body: unknown) {
  return jest
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("toggleErrorText", () => {
  it.each(KINDS)("%s: a lock contention gets its own retry message in FR and EN", (kind) => {
    expect(toggleErrorText(textOf(frForm), kind, "CONCURRENT_UPDATE_RETRY")).toBe(lookup(frForm, "edit.concurrentRetry"));
    expect(toggleErrorText(textOf(enForm), kind, "CONCURRENT_UPDATE_RETRY")).toBe(lookup(enForm, "edit.concurrentRetry"));
  });

  it.each(KINDS)("%s: known codes map to their text, unknown ones to the fallback", (kind) => {
    const { errors } = TOGGLE_ROUTES[kind];
    for (const messages of [frForm, enForm]) {
      for (const [code, key] of Object.entries(errors)) {
        if (code === "fallback") continue;
        expect(toggleErrorText(textOf(messages), kind, code)).toBe(lookup(messages, key));
      }
      expect(toggleErrorText(textOf(messages), kind, "SOMETHING_ELSE")).toBe(lookup(messages, errors.fallback));
    }
  });
});

describe("putToggle", () => {
  it("PUTs the value on the dedicated route", async () => {
    const spy = mockFetch(200, { changed: true });
    await expect(saveSimpleToggle(7, "checkIn", false, textOf(frForm))).resolves.toBe(true);
    expect(spy).toHaveBeenCalledWith("/api/admin/tournaments/7/match-check-in", expect.objectContaining({ method: "PUT", body: JSON.stringify({ enabled: false }) }));
  });

  it("reports an unchanged option", async () => {
    mockFetch(200, { changed: false });
    await expect(saveSimpleToggle(7, "voice", true, textOf(frForm))).resolves.toBe(false);
  });

  it("raises a 409 contention as a coded retry message", async () => {
    mockFetch(409, { error: "CONCURRENT_UPDATE_RETRY" });
    const failure = await putToggle(7, "checkIn", true, textOf(enForm)).catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(CodedError);
    expect((failure as CodedError).code).toBe("CONCURRENT_UPDATE_RETRY");
    expect((failure as CodedError).message).toBe(lookup(enForm, "edit.concurrentRetry"));
  });

  it("falls back on an unreadable error body", async () => {
    jest.spyOn(globalThis, "fetch").mockResolvedValue(new Response("oops", { status: 500 }));
    await expect(putToggle(7, "planning", true, textOf(frForm))).rejects.toThrow(lookup(frForm, "edit.planningErrors.fallback"));
  });
});
