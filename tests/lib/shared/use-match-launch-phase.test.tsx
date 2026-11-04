import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { useMatchLaunchPhase } from "@/lib/shared/hooks/useMatchLaunchPhase";
import type { MatchLaunchInput } from "@/lib/shared/match-launch";

/** Rend la phase calculée par le crochet (premier rendu, sans effet). */
function Phase({ match }: { match: MatchLaunchInput }) {
  return <span>{useMatchLaunchPhase(match)}</span>;
}

const startPassedPhaseOff: MatchLaunchInput = {
  status: "READY",
  team1Id: 1,
  team2Id: 2,
  startAt: new Date(Date.now() - 60_000).toISOString(),
  launchedAt: null,
  refereeScheduling: false,
  launchPhase: false,
};

describe("useMatchLaunchPhase — sans phase de lancement", () => {
  it("useMatchLaunchPhase_phaseOffStartPassedNoVoice_returnsLaunched", () => {
    const html = renderToStaticMarkup(<Phase match={startPassedPhaseOff} />);
    expect(html).toBe("<span>LAUNCHED</span>");
  });
});
