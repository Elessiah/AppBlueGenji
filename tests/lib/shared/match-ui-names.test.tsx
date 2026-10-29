import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { applyLiveMessage } from "@/app/(secured)/tournois/[id]/_lib/live-state";
import { MapScoreList } from "@/app/(secured)/tournois/[id]/_components/MapScoreList";
import { refereeReadyRereadDue } from "@/components/match-launch/MatchContactsDialog";
import { missingRefereeNamesKey, parseRefereeNames, refereeNameOf, refereeNamesImprove, showsRefereeName } from "@/lib/shared/match-referee";
import type { MatchLaunchInfo } from "@/lib/shared/match-launch";
import { matchMapNames, type RoundMapConfig } from "@/lib/shared/round-maps";
import { bracketMatch } from "../../helpers/bracket-match";
import { tournamentDetail, tournamentSnapshot } from "../../helpers/tournament-detail";
import { readSource } from "../../helpers/read-source";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import type { MatchStatus } from "@/lib/shared/types";

/** Noms de cartes, d'arbitre et de chaînes sur les matchs (MATCH-UI-NAMES). */

const NAMES = [{ matchId: 5, refereeKey: "k5", pseudo: "Juge" }];

/** Match d'un instantané, réduit à ce qui décide du pseudo d'arbitre. */
function shown(id: number, refereeKey: string | null, status: MatchStatus = "READY") {
  return { id, refereeKey, status };
}

describe("showsRefereeName", () => {
  it("showsRefereeName_readyWithKey_returnsTrue", () => {
    expect(showsRefereeName(shown(5, "k5", "READY"))).toBe(true);
  });

  // Score déclaré : les membres relisent « Arbitre désigné » (textes RGPD).
  it("showsRefereeName_awaitingConfirmationWithKey_returnsFalse", () => {
    expect(showsRefereeName(shown(5, "k5", "AWAITING_CONFIRMATION"))).toBe(false);
  });

  it("showsRefereeName_readyNullKey_returnsFalse", () => {
    expect(showsRefereeName(shown(5, null, "READY"))).toBe(false);
  });
});

describe("refereeNameOf", () => {
  it("refereeNameOf_awaitingConfirmationMatchingKey_returnsNull", () => {
    expect(refereeNameOf(shown(5, "k5", "AWAITING_CONFIRMATION"), NAMES)).toBeNull();
  });

  it("refereeNameOf_nullKey_returnsNull", () => {
    expect(refereeNameOf(shown(5, null), NAMES)).toBeNull();
  });

  it("refereeNameOf_matchingIdAndKey_returnsPseudo", () => {
    expect(refereeNameOf(shown(5, "k5"), NAMES)).toBe("Juge");
  });

  it("refereeNameOf_staleKey_returnsNull", () => {
    expect(refereeNameOf(shown(5, "k-nouveau"), NAMES)).toBeNull();
  });
});

describe("missingRefereeNamesKey", () => {
  it("missingRefereeNamesKey_awaitingConfirmationWithoutName_isNotMissing", () => {
    expect(missingRefereeNamesKey([shown(6, "k6", "AWAITING_CONFIRMATION")], NAMES)).toBe("");
  });

  it("missingRefereeNamesKey_allNamed_returnsEmptyString", () => {
    expect(missingRefereeNamesKey([shown(5, "k5")], NAMES)).toBe("");
  });

  it("missingRefereeNamesKey_someMissing_joinsIdKeyPairsSkippingNullKeys", () => {
    const matches = [
      shown(5, "k5"),
      shown(6, "k6"),
      shown(7, null),
      shown(8, "k8"),
    ];

    expect(missingRefereeNamesKey(matches, NAMES)).toBe("6:k6,8:k8");
  });
});

describe("refereeNamesImprove", () => {
  const shownB = [shown(5, "kB")];
  const namedA = [{ matchId: 5, refereeKey: "kA", pseudo: "Ancien" }];
  const namedB = [{ matchId: 5, refereeKey: "kB", pseudo: "Nouveau" }];

  it("refereeNamesImprove_lateResponseForOlderDesignation_returnsFalse", () => {
    expect(refereeNamesImprove(shownB, namedB, namedA)).toBe(false);
  });

  it("refereeNamesImprove_incomingNamesMissingDesignation_returnsTrue", () => {
    expect(refereeNamesImprove(shownB, [], namedB)).toBe(true);
  });

  it("refereeNamesImprove_sameCoverage_returnsFalse", () => {
    expect(refereeNamesImprove(shownB, [], namedA)).toBe(false);
  });

  it("refereeNamesImprove_matchesWithoutReferee_returnsFalse", () => {
    expect(refereeNamesImprove([shown(5, null)], [], namedB)).toBe(false);
  });
});

describe("parseRefereeNames", () => {
  it("parseRefereeNames_notArray_returnsNull", () => {
    expect(parseRefereeNames({ matchId: 5 })).toBeNull();
  });

  it("parseRefereeNames_mixedItems_keepsOnlyWellTypedEntries", () => {
    const value = [null, "x", { matchId: 5, refereeKey: "k5", pseudo: 3 }, { matchId: 6, refereeKey: "k6", pseudo: "Juge" }];

    expect(parseRefereeNames(value)).toEqual([{ matchId: 6, refereeKey: "k6", pseudo: "Juge" }]);
  });
});

describe("matchMapNames", () => {
  const round = (slots: string[][]): RoundMapConfig => ({ phaseId: 0, bracket: "UPPER", roundNumber: 1, slots });

  it("matchMapNames_roundWithSlots_returnsResolvedSlotNames", () => {
    const match = bracketMatch({ firstMap: "Ilios", mapPicks: {} });

    expect(matchMapNames([round([["Ilios", "Busan"], ["Numbani"], ["Oasis", "Nepal"]])], match)).toEqual([
      "Ilios",
      "Numbani",
      null,
    ]);
  });

  it("matchMapNames_noRoundConfig_returnsFirstMapOnly", () => {
    expect(matchMapNames([], bracketMatch({ firstMap: "Ilios" }))).toEqual(["Ilios"]);
  });

  it("matchMapNames_noNameKnown_returnsEmptyArray", () => {
    expect(matchMapNames([], bracketMatch({ firstMap: null }))).toEqual([]);
  });

  it("matchMapNames_nameWithInvisibleChars_isCleanedOrNull", () => {
    const match = bracketMatch({ firstMap: "\u200BIlios", mapPicks: {} });

    expect(matchMapNames([round([["A", "B"], ["\u200B"]])], match)).toEqual(["Ilios", null]);
  });
});

describe("refereeReadyRereadDue", () => {
  const launch = (overrides: Partial<MatchLaunchInfo>) =>
    ({
      phase: "LOBBY",
      referee: { userId: 7, pseudo: "Juge", ready: false, isViewer: false },
      ...overrides,
    }) as MatchLaunchInfo;

  it("refereeReadyRereadDue_lobbyRefereeNotReady_returnsTrue", () => {
    expect(refereeReadyRereadDue(launch({}))).toBe(true);
  });

  it("refereeReadyRereadDue_refereeReady_returnsFalse", () => {
    expect(refereeReadyRereadDue(launch({ referee: { userId: 7, pseudo: "Juge", ready: true, isViewer: false } }))).toBe(false);
  });

  it("refereeReadyRereadDue_notLobbyPhase_returnsFalse", () => {
    expect(refereeReadyRereadDue(launch({ phase: "LAUNCHED" }))).toBe(false);
  });

  it("refereeReadyRereadDue_noReferee_returnsFalse", () => {
    expect(refereeReadyRereadDue(launch({ referee: null }))).toBe(false);
  });

  it("refereeReadyRereadDue_noLaunch_returnsFalse", () => {
    expect(refereeReadyRereadDue(null)).toBe(false);
  });
});

describe("applyLiveMessage — pseudos d'arbitre", () => {
  it("applyLiveMessage_snapshot_keepsPreviousRefereeNames", () => {
    const state = { detail: tournamentDetail({ version: "v1", refereeNames: NAMES }), tier: "STANDARD" as const };
    const snapshot = tournamentSnapshot({ version: "v2", matches: [bracketMatch(shown(5, "k5"))] });

    const next = applyLiveMessage(state, { type: "snapshot", tournamentId: snapshot.card.id, version: "v2", snapshot });

    expect(next.detail?.refereeNames).toEqual(NAMES);
  });
});

describe("MapScoreList — nom des cartes", () => {
  /** Aucun champ signalé. */
  const noFieldErrors: FieldErrors<string> = {
    invalidField: null,
    report: () => false,
    flag: () => undefined,
    clear: () => undefined,
    aria: () => ({}),
    message: () => null,
  };
  const render = (mapNames?: (string | null)[]) =>
    renderToStaticMarkup(
      <MapScoreList
        idPrefix="t"
        maps={[{ replayCode: "", team1Score: 0, team2Score: 0 }]}
        onChange={() => undefined}
        format={null}
        game="OW"
        team1Name="Alpha"
        team2Name="Bravo"
        disabled={false}
        fieldErrors={noFieldErrors}
        mapNames={mapNames}
      />,
    );

  it("MapScoreList_mapNameGiven_labelsMapIndexColonName", () => {
    expect(render(["Ilios"])).toContain("Map 1 : Ilios");
  });

  it("MapScoreList_mapNameMissing_labelsMapIndexOnly", () => {
    const html = render([null]);

    expect(html).toContain("Map 1");
    expect(html).not.toContain("Map 1 :");
  });
});

describe("LiveCard — casse des chaînes (décision 53)", () => {
  it("LiveCard_channelPresent_streamButtonHasKeepCase", () => {
    const css = readSource("components/cyber/landing/LiveCard.module.css");
    const card = readSource("components/cyber/landing/LiveCard.tsx");

    expect(css).toMatch(/\.streamButton\.keepCase \{\n\s*text-transform: none;/);
    expect(card).toContain("channel ? styles.keepCase : null");
  });
});
