import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { applyLiveMessage } from "@/app/(secured)/tournois/[id]/_lib/live-state";
import { MapScoreList } from "@/app/(secured)/tournois/[id]/_components/MapScoreList";
import {
  REFEREE_READY_REREAD_MAX,
  refereeReadyRereadDue,
  refereeReadyRereadStep,
  serverClockSkew,
} from "@/components/match-launch/MatchContactsDialog";
import { splitChannelText } from "@/components/cyber/landing/LiveCard";
import {
  missingRefereeNamesKey,
  parseRefereeNames,
  refereeNameOf,
  mergeRefereeNames,
  refereeNamesAttempt,
  refereeNamesRetryDelay,
  showsRefereeName,
} from "@/lib/shared/match-referee";
import type { MatchLaunchInfo } from "@/lib/shared/match-launch";
import { matchMapNames, type RoundMapConfig } from "@/lib/shared/round-maps";
import { bracketMatch } from "../../helpers/bracket-match";
import { tournamentDetail, tournamentSnapshot } from "../../helpers/tournament-detail";
import { readSource } from "../../helpers/read-source";
import type { FieldErrors } from "@/lib/shared/hooks/useFieldErrors";
import type { MatchStatus } from "@/lib/shared/types";
import "@/tests/helpers/lazy-tournament-texts";

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

  it("refereeNameOf_emptyPseudo_returnsNull", () => {
    // Entrée de l'arbitre reconnu de lui seul (`markViewerReferee`) : elle ne nomme personne.
    expect(refereeNameOf(shown(5, "k5"), [{ matchId: 5, refereeKey: "k5", pseudo: "" }])).toBeNull();
  });

  it("refereeNameOf_staleKey_returnsNull", () => {
    expect(refereeNameOf(shown(5, "k-nouveau"), NAMES)).toBeNull();
  });
});

describe("refereeNamesAttempt", () => {
  it("refereeNamesAttempt_newMissingKey_readsAndKeepsThePreviousAttemptUntilArmed", () => {
    expect(refereeNamesAttempt("5:k5", "")).toEqual({ read: true, attempted: "" });
  });

  it("refereeNamesAttempt_sameKeyAsLastAttempt_doesNotReadAgain", () => {
    expect(refereeNamesAttempt("5:k5", "5:k5")).toEqual({ read: false, attempted: "5:k5" });
  });

  it("refereeNamesAttempt_nothingMissing_forgetsTheAttempt", () => {
    // Score déclaré (pseudo élagué) : l'essai est oublié…
    expect(refereeNamesAttempt("", "5:k5")).toEqual({ read: false, attempted: "" });
  });

  it("refereeNamesAttempt_sameKeyBackAfterNothingMissing_readsAgain", () => {
    // … et le score rejeté, même empreinte, relit le pseudo.
    const forgotten = refereeNamesAttempt("", "5:k5").attempted;

    expect(refereeNamesAttempt("5:k5", forgotten).read).toBe(true);
  });
});

describe("missingRefereeNamesKey — l'arbitre reconnu de lui seul", () => {
  it("missingRefereeNamesKey_mineEntryWithoutPseudo_notMissing", () => {
    expect(missingRefereeNamesKey([shown(5, "k5")], [{ matchId: 5, refereeKey: "k5", pseudo: "", mine: true }])).toBe("");
  });

  it("missingRefereeNamesKey_emptyPseudoNotMine_missing", () => {
    expect(missingRefereeNamesKey([shown(5, "k5")], [{ matchId: 5, refereeKey: "k5", pseudo: "" }])).toBe("5:k5");
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

describe("mergeRefereeNames", () => {
  const shownB = [shown(5, "kB")];
  const namedA = [{ matchId: 5, refereeKey: "kA", pseudo: "Ancien" }];
  const namedB = [{ matchId: 5, refereeKey: "kB", pseudo: "Nouveau" }];

  it("mergeRefereeNames_lateResponseWhileAlreadyNamed_returnsNullNotStale", () => {
    expect(mergeRefereeNames(shownB, namedB, namedA)).toEqual({ names: null, stale: false });
  });

  it("mergeRefereeNames_incomingResolvesMissingDesignation_addsIt", () => {
    expect(mergeRefereeNames(shownB, [], namedB)).toEqual({ names: namedB, stale: false });
  });

  it("mergeRefereeNames_incomingMineEntryWithoutPseudo_addsIt", () => {
    // L'arbitre au pseudo illisible se reconnaît : l'entrée est gardée.
    const mine = [{ matchId: 5, refereeKey: "kB", pseudo: "", mine: true as const }];

    expect(mergeRefereeNames(shownB, [], mine)).toEqual({ names: mine, stale: false });
  });

  it("mergeRefereeNames_incomingEmptyPseudoNotMine_returnsNull", () => {
    expect(mergeRefereeNames(shownB, [], [{ matchId: 5, refereeKey: "kB", pseudo: "" }])).toEqual({ names: null, stale: false });
  });

  it("mergeRefereeNames_incomingOlderKeyForMissingMatch_flagsStale", () => {
    expect(mergeRefereeNames(shownB, [], namedA)).toEqual({ names: null, stale: true });
  });

  it("mergeRefereeNames_incomingResolvesOtherSubset_keepsCurrentAndAddsNew", () => {
    const matches = [shown(5, "k5"), shown(6, "k6")];
    const current = [{ matchId: 5, refereeKey: "k5", pseudo: "Juge" }];
    const incoming = [{ matchId: 6, refereeKey: "k6", pseudo: "Arbitre" }];

    expect(mergeRefereeNames(matches, current, incoming).names).toEqual([...current, ...incoming]);
  });

  it("mergeRefereeNames_currentHasOlderEntryForMissingMatch_replacesIt", () => {
    expect(mergeRefereeNames(shownB, namedA, namedB).names).toEqual(namedB);
  });

  it("mergeRefereeNames_resolvedEntryGainsMine_replacesWithMarkedEntry", () => {
    const marked = [{ matchId: 5, refereeKey: "kB", pseudo: "Nouveau", mine: true as const }];

    expect(mergeRefereeNames(shownB, namedB, marked)).toEqual({ names: marked, stale: false });
  });

  it("mergeRefereeNames_resolvedMineEntryLosesMark_replacesWithUnmarkedEntry", () => {
    const marked = [{ matchId: 5, refereeKey: "kB", pseudo: "Nouveau", mine: true as const }];

    expect(mergeRefereeNames(shownB, marked, namedB)).toEqual({ names: namedB, stale: false });
  });

  it("mergeRefereeNames_resolvedMineUnreadablePseudoAbsentFromIncoming_dropsEntry", () => {
    const marked = [{ matchId: 5, refereeKey: "kB", pseudo: "", mine: true as const }];

    expect(mergeRefereeNames(shownB, marked, [])).toEqual({ names: [], stale: false });
  });

  it("mergeRefereeNames_resolvedEntrySameMark_returnsNull", () => {
    expect(mergeRefereeNames(shownB, namedB, namedB)).toEqual({ names: null, stale: false });
  });

  it("mergeRefereeNames_resolvedMineIncomingOtherKey_keepsEntry", () => {
    const marked = [{ matchId: 5, refereeKey: "kB", pseudo: "Nouveau", mine: true as const }];

    expect(mergeRefereeNames(shownB, marked, namedA)).toEqual({ names: null, stale: false });
  });

  it("mergeRefereeNames_matchesWithoutReferee_returnsNull", () => {
    expect(mergeRefereeNames([shown(5, null)], [], namedB)).toEqual({ names: null, stale: false });
  });
});

describe("refereeNamesRetryDelay", () => {
  it("refereeNamesRetryDelay_noHeader_returnsTenSeconds", () => {
    expect(refereeNamesRetryDelay(null)).toBe(10_000);
  });

  it("refereeNamesRetryDelay_longerRetryAfter_followsHeader", () => {
    expect(refereeNamesRetryDelay("30")).toBe(30_000);
  });

  it("refereeNamesRetryDelay_shorterRetryAfter_keepsTenSecondFloor", () => {
    expect(refereeNamesRetryDelay("2")).toBe(10_000);
  });

  it("refereeNamesRetryDelay_unreadableOrNegativeHeader_returnsTenSeconds", () => {
    expect(refereeNamesRetryDelay("Wed, 21 Oct 2026 07:28:00 GMT")).toBe(10_000);
    expect(refereeNamesRetryDelay("-5")).toBe(10_000);
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
      viewer: { isReferee: false },
      ...overrides,
    }) as MatchLaunchInfo;

  it("refereeReadyRereadDue_lobbyRefereeNotReady_returnsTrue", () => {
    expect(refereeReadyRereadDue(launch({}))).toBe(true);
  });

  it("refereeReadyRereadDue_refereeReady_returnsFalse", () => {
    expect(refereeReadyRereadDue(launch({ referee: { userId: 7, pseudo: "Juge", ready: true, contactsShown: true, isViewer: false } }))).toBe(false);
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

  it("refereeReadyRereadDue_viewerIsTheReferee_returnsFalse", () => {
    expect(refereeReadyRereadDue(launch({ viewer: { isReferee: true } as MatchLaunchInfo["viewer"] }))).toBe(false);
  });
});

describe("refereeReadyRereadStep", () => {
  const NOW = Date.parse("2026-11-13T20:00:00Z");

  it("refereeReadyRereadStep_beforeAutoLaunchBelowCap_returnsRead", () => {
    expect(
      refereeReadyRereadStep({ now: NOW, autoLaunchAt: "2026-11-13T20:05:00Z", reads: REFEREE_READY_REREAD_MAX - 1, backingOff: false }),
    ).toBe("read");
  });

  it("refereeReadyRereadStep_beforeAutoLaunchCapReached_returnsStop", () => {
    expect(
      refereeReadyRereadStep({ now: NOW, autoLaunchAt: "2026-11-13T23:00:00Z", reads: REFEREE_READY_REREAD_MAX, backingOff: false }),
    ).toBe("stop");
  });

  it("refereeReadyRereadStep_autoLaunchReached_returnsStop", () => {
    expect(refereeReadyRereadStep({ now: NOW, autoLaunchAt: "2026-11-13T20:00:00Z", reads: 0, backingOff: false })).toBe("stop");
  });

  it("refereeReadyRereadStep_noAutoLaunchBelowCap_returnsRead", () => {
    expect(refereeReadyRereadStep({ now: NOW, autoLaunchAt: null, reads: REFEREE_READY_REREAD_MAX - 1, backingOff: false })).toBe("read");
  });

  it("refereeReadyRereadStep_noAutoLaunchCapReached_returnsStop", () => {
    expect(refereeReadyRereadStep({ now: NOW, autoLaunchAt: null, reads: REFEREE_READY_REREAD_MAX, backingOff: false })).toBe("stop");
  });

  it("refereeReadyRereadStep_unreadableAutoLaunch_fallsBackToCap", () => {
    expect(refereeReadyRereadStep({ now: NOW, autoLaunchAt: "pas une date", reads: REFEREE_READY_REREAD_MAX, backingOff: false })).toBe("stop");
  });

  it("refereeReadyRereadStep_backingOff_returnsSkip", () => {
    expect(refereeReadyRereadStep({ now: NOW, autoLaunchAt: null, reads: 0, backingOff: true })).toBe("skip");
  });
});

describe("serverClockSkew", () => {
  const RECEIVED = Date.parse("2026-11-13T20:00:00Z");

  it("serverClockSkew_readableDate_returnsServerMinusReceived", () => {
    expect(serverClockSkew("Fri, 13 Nov 2026 19:55:00 GMT", RECEIVED)).toBe(-300_000);
  });

  it("serverClockSkew_nullDate_returnsZero", () => {
    expect(serverClockSkew(null, RECEIVED)).toBe(0);
  });

  it("serverClockSkew_unreadableDate_returnsZero", () => {
    expect(serverClockSkew("pas une date", RECEIVED)).toBe(0);
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
  it("LiveCard_channelPresent_onlyChannelKeepsCase", () => {
    const css = readSource("components/cyber/landing/LiveCard.module.css");
    const card = readSource("components/cyber/landing/LiveCard.tsx");

    expect(css).toMatch(/^\.keepCase \{\n\s*text-transform: none;/m);
    expect(card).toContain("<span className={styles.keepCase}>{parts.channel}</span>");
  });

  it("splitChannelText_channelInText_splitsAroundIt", () => {
    expect(splitChannelText("Regarder BlueGenji", "BlueGenji")).toEqual({ before: "Regarder ", channel: "BlueGenji", after: "" });
  });

  it("splitChannelText_channelAlsoInsidePrefix_wrapsTheTrailingChannel", () => {
    expect(splitChannelText("Regarder der", "der")).toEqual({ before: "Regarder ", channel: "der", after: "" });
    expect(splitChannelText("Watch at", "at")).toEqual({ before: "Watch ", channel: "at", after: "" });
  });

  it("splitChannelText_noChannelOrAbsent_returnsNull", () => {
    expect(splitChannelText("Regarder sur Twitch", null)).toBeNull();
    expect(splitChannelText("Regarder sur Twitch", "bluegenji")).toBeNull();
  });
});
