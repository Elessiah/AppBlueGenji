import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { applyLiveMessage } from "@/app/(secured)/tournois/[id]/_lib/live-state";
import { MapScoreList } from "@/app/(secured)/tournois/[id]/_components/MapScoreList";
import { refereeReadyRereadDue } from "@/components/match-launch/MatchContactsDialog";
import { missingRefereeNamesKey, parseRefereeNames, refereeNameOf, refereeNamesImprove } from "@/lib/shared/match-referee";
import type { MatchLaunchInfo } from "@/lib/shared/match-launch";
import { matchMapNames, type RoundMapConfig } from "@/lib/shared/round-maps";
import { bracketMatch } from "../../helpers/bracket-match";
import { tournamentDetail, tournamentSnapshot } from "../../helpers/tournament-detail";
import { readSource } from "../../helpers/read-source";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";

/** Noms de cartes, d'arbitre et de chaînes sur les matchs (MATCH-UI-NAMES). */

const NAMES = [{ matchId: 5, refereeKey: "k5", pseudo: "Juge" }];

describe("refereeNameOf", () => {
  it("refereeNameOf_nullKey_returnsNull", () => {
    expect(refereeNameOf({ id: 5, refereeKey: null }, NAMES)).toBeNull();
  });

  it("refereeNameOf_matchingIdAndKey_returnsPseudo", () => {
    expect(refereeNameOf({ id: 5, refereeKey: "k5" }, NAMES)).toBe("Juge");
  });

  it("refereeNameOf_staleKey_returnsNull", () => {
    expect(refereeNameOf({ id: 5, refereeKey: "k-nouveau" }, NAMES)).toBeNull();
  });
});

describe("missingRefereeNamesKey", () => {
  it("missingRefereeNamesKey_allNamed_returnsEmptyString", () => {
    expect(missingRefereeNamesKey([{ id: 5, refereeKey: "k5" }], NAMES)).toBe("");
  });

  it("missingRefereeNamesKey_someMissing_joinsIdKeyPairsSkippingNullKeys", () => {
    const matches = [
      { id: 5, refereeKey: "k5" },
      { id: 6, refereeKey: "k6" },
      { id: 7, refereeKey: null },
      { id: 8, refereeKey: "k8" },
    ];

    expect(missingRefereeNamesKey(matches, NAMES)).toBe("6:k6,8:k8");
  });
});

describe("refereeNamesImprove", () => {
  const shownB = [{ id: 5, refereeKey: "kB" }];
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
    expect(refereeNamesImprove([{ id: 5, refereeKey: null }], [], namedB)).toBe(false);
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
    const snapshot = tournamentSnapshot({ version: "v2", matches: [bracketMatch({ id: 5, refereeKey: "k5" })] });

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
