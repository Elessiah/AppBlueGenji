import { describe, expect, it } from "@jest/globals";
import { reloadSucceeded } from "@/lib/shared/reload-outcome";

describe("reloadSucceeded", () => {
  it("reloadSucceeded_returnsTrue_succeeds", async () => {
    expect(await reloadSucceeded(async () => true)).toBe(true);
  });

  it("reloadSucceeded_returnsNothing_succeeds", async () => {
    expect(await reloadSucceeded(() => undefined)).toBe(true);
  });

  it("reloadSucceeded_returnsFalse_fails", async () => {
    expect(await reloadSucceeded(async () => false)).toBe(false);
  });

  it("reloadSucceeded_rejects_fails", async () => {
    expect(await reloadSucceeded(() => Promise.reject(new Error("réseau")))).toBe(false);
  });

  it("reloadSucceeded_throwsSynchronously_fails", async () => {
    expect(
      await reloadSucceeded(() => {
        throw new Error("boom");
      }),
    ).toBe(false);
  });
});
