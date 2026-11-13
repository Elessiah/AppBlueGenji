import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

const sheet = readFileSync(
  path.join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "TournamentSheet.tsx"),
  "utf8",
);

describe("TournamentSheet — relecture après un refus du report d'équipe", () => {
  it("TournamentSheet_playerScoreRefusal_refreshesOnlyWhenStreamDown", () => {
    expect(sheet).toContain(
      "const refreshUnlessLive = useCallback(() => (isLive ? undefined : refresh()), [isLive, refresh]);",
    );
  });

  it("TournamentSheet_playerScoreDialog_receivesRefreshUnlessLive", () => {
    expect(sheet).toContain("onRefresh={refreshUnlessLive}");
    expect(sheet).not.toContain("onRefresh={refresh}");
  });
});
