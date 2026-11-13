import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

const sheet = readFileSync(
  path.join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "TournamentSheet.tsx"),
  "utf8",
);

const dialog = readFileSync(
  path.join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "PlayerScoreDialog.tsx"),
  "utf8",
);

describe("PlayerScoreDialog — relecture après un refus", () => {
  it("PlayerScoreDialog_refusal_reloadsProposalsAndRefreshes", () => {
    expect(dialog).toContain("reload: reloadProposals } = useProposalMaps(");
    expect(dialog).toMatch(/const refreshAfterRefusal = \(\) => \{\s*reloadProposals\(\);\s*void Promise\.resolve\(onRefresh\(\)\)/);
    expect(dialog.match(/if \(REFRESH_ON_REFUSAL\.has\(code\)\) refreshAfterRefusal\(\);/g)).toHaveLength(2);
    expect(dialog).not.toContain("REFRESH_ON_REFUSAL.has(code)) void Promise.resolve(onRefresh())");
  });
});

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
