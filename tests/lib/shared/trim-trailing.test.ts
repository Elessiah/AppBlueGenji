import { describe, expect, it } from "@jest/globals";

import { trimTrailingSlashes } from "@/lib/shared/trim-trailing";

describe("trimTrailingSlashes", () => {
  it.each<[string, string]>([
    ["/api/teams/", "/api/teams"],
    ["/api/teams///", "/api/teams"],
    ["/api/teams", "/api/teams"],
    ["///", ""],
    ["", ""],
    ["/a//b/", "/a//b"],
  ])("%j → %j", (input, expected) => {
    expect(trimTrailingSlashes(input)).toBe(expected);
  });

  it("reste linéaire sur une longue suite de barres suivie d'un autre caractère", () => {
    const hostile = `${"/".repeat(200_000)}x`;
    const started = Date.now();
    expect(trimTrailingSlashes(hostile)).toBe(hostile);
    expect(Date.now() - started).toBeLessThan(500);
  });
});
