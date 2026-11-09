import { describe, expect, it } from "@jest/globals";
import { renderToStaticMarkup } from "react-dom/server";
import { ToastProvider } from "@/components/ui/toast";
import { MatchRoundMaps } from "@/app/(secured)/tournois/[id]/_components/MatchRoundMaps";
import { mapRowLabels } from "@/app/(secured)/tournois/[id]/_components/MapScoreList";
import frDialogs from "@/messages/fr/tournamentDialogs.json";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frRoundMaps from "@/messages/fr/roundMaps.json";
import enRoundMaps from "@/messages/en/roundMaps.json";
import { scopedText } from "@/lib/shared/scoped-text";
import type { TournamentMapRules } from "@/lib/shared/round-maps";
import { EMPTY_MAP_RULES } from "@/lib/shared/round-maps";
import { bracketMatch } from "../helpers/bracket-match";
import { tournamentDetail } from "../helpers/tournament-detail";
import { readSource } from "../helpers/read-source";

/**
 * Cartes du tour : rendu de la page du match, libellés de la saisie du score et
 * câblage des gestes que le rendu statique n'atteint pas (`docs/features/ROUND_MAPS.md`).
 */

const ROUND = { phaseId: 0, bracket: "UPPER" as const, roundNumber: 2 };
const match = bracketMatch({ id: 34, tournamentId: 12, ...ROUND });

function render(mapRules: TournamentMapRules, staff: boolean): string {
  const detail = tournamentDetail({ matches: [match], mapRules });
  return renderToStaticMarkup(
    <ToastProvider>
      <MatchRoundMaps detail={detail} match={match} canPick={false} staff={staff} />
    </ToastProvider>,
  );
}

const rules = (overrides: Partial<TournamentMapRules>): TournamentMapRules => ({ ...EMPTY_MAP_RULES, ...overrides });
const listItems = (html: string) => html.match(/<li\b/g)?.length ?? 0;

describe("MatchRoundMaps — liste des cartes", () => {
  it("matchRoundMaps_slotsAndTiebreak_tiebreakIsTheLastItemOfTheLabelledList", () => {
    const html = render(rules({ rounds: [{ ...ROUND, slots: [["Ilios"]] }], tiebreaks: [{ ...ROUND, map: "Oasis" }] }), false);

    expect(html.match(/<ol\b/g)).toHaveLength(1);
    expect(html.indexOf("Map de départage")).toBeGreaterThan(html.indexOf("Ilios"));
    expect(html.indexOf("Map de départage")).toBeLessThan(html.indexOf("</ol>"));
  });

  it("matchRoundMaps_tiebreakOnly_rendersALabelledListWithOneItem", () => {
    const html = render(rules({ tiebreaks: [{ ...ROUND, map: "Oasis" }] }), false);

    expect(html).toMatch(/<ol[^>]*aria-labelledby/);
    expect(listItems(html)).toBe(1);
  });

  it("matchRoundMaps_tiebreakWithInvisibleCharacters_showsVisibleText", () => {
    const html = render(rules({ tiebreaks: [{ ...ROUND, map: "Oasis​" }] }), false);

    expect(html).toContain("<strong>Oasis</strong>");
  });

  it("matchRoundMaps_nothingSetAndNotStaff_rendersNothing", () => {
    expect(render(EMPTY_MAP_RULES, false)).not.toContain("<ol");
  });

  it("matchRoundMaps_staffWithoutSlots_resetButtonStaysMountedAndAriaDisabled", () => {
    const html = render(EMPTY_MAP_RULES, true);

    expect(html).toMatch(/<button[^>]*aria-disabled="true"[^>]*>Réinitialiser le tour/);
  });

  it("matchRoundMaps_staffWithSlots_resetButtonIsEnabled", () => {
    const html = render(rules({ rounds: [{ ...ROUND, slots: [["Ilios"]] }] }), true);

    expect(html).not.toMatch(/<button[^>]*aria-disabled="true"[^>]*>Réinitialiser le tour/);
    expect(html).toContain("Réinitialiser le tour");
  });
});

describe("mapRowLabels", () => {
  const fr = scopedText("fr", frDialogs).t;
  const en = scopedText("en", enDialogs).t;

  it("mapRowLabels_tiebreak_namesTheMapInLabelAndBothPrefixes", () => {
    expect(mapRowLabels(fr, 3, null, "Oasis")).toEqual({
      label: "Map de départage : Oasis",
      prefix: "Map de départage : Oasis, ",
      scorePrefix: "Map de départage : Oasis, score de ",
    });
  });

  it("mapRowLabels_namedMap_scorePrefixCarriesIndexAndName", () => {
    expect(mapRowLabels(fr, 0, "Ilios", null).scorePrefix).toBe("Map 1 : Ilios, score de ");
  });

  it("mapRowLabels_unnamedMap_usesPlainScorePrefix", () => {
    expect(mapRowLabels(fr, 1, null, null).scorePrefix).toBe("Map 2, score de ");
  });

  it("mapRowLabels_english_scorePrefixesAreEnglish", () => {
    expect(mapRowLabels(en, 0, "Ilios", null).scorePrefix).toBe("Map 1: Ilios, score of ");
    expect(mapRowLabels(en, 3, null, "Oasis").scorePrefix).toBe("Tiebreak map: Oasis, score of ");
  });
});

describe("tiebreak texts", () => {
  it("tiebreakHint_pageAndDialog_shareOneKeyInBothLanguages", () => {
    const dialog = readSource("app/(secured)/tournois/[id]/_components/RoundMapsDialog.tsx");

    expect(dialog).toContain('t("page.tiebreakHint")');
    expect(dialog).not.toContain("dialog.tiebreakHint");
    expect(frRoundMaps.dialog).not.toHaveProperty("tiebreakHint");
    expect(enRoundMaps.dialog).not.toHaveProperty("tiebreakHint");
  });
});

describe("câblage de la fenêtre des cartes", () => {
  const dialog = () => readSource("app/(secured)/tournois/[id]/_components/RoundMapsDialog.tsx");

  it("dialog_closeGestures_allGoThroughTheUnsavedConfirmation", () => {
    const source = dialog();

    expect(source).toContain("onClose={requestClose}");
    expect(source).toContain("if (!busy) requestClose();");
    expect(source).toMatch(/if \(roundDirty \|\| rulesDirty \|\| tiebreakDirty\) setPending\(\{ kind: "close" \}\)/);
  });

  it("dialog_saveRound_refusesOverMaxAndUnchangedRoundsBeforeSending", () => {
    expect(dialog()).toMatch(/!roundDirty \|\| gapRefused\(\) \|\| overMaxRefused\(\)/);
  });

  it("dialog_overMax_savedRoundAlreadyOverTheCapCanStillBeEditedWithoutGrowing", () => {
    const source = dialog();

    expect(source).toContain("Math.max(maxMaps, saved?.slots.length ?? 0)");
    // L'avertissement rouge et le refus partagent le même seuil.
    expect(source).toContain("toSave.length > effectiveMax");
    expect(source).toContain("slotOverMax(slots, effectiveMax)");
  });

  it("dialog_serverRefusal_attachesToTheListNotToTheFirstSlot", () => {
    const source = dialog();

    expect(source).toMatch(/Le serveur refuse sans dire quelle carte[\s\S]{0,120}setErrorSlot\(null\)/);
    expect(source).toContain("slots: errorSlot === null ? slotsListId : slotToggleId(errorSlot)");
  });

  it("dialog_customAdd_clearsTheFieldOnlyWhenTheMapWasTaken", () => {
    expect(dialog()).toContain("if (onEdit((current) => addMapToSlot(current, custom))) setCustom(\"\")");
  });

  it("dialog_closeSignal_sendsOnlyTheRoundsWrittenHereAfterTheLastBatch", () => {
    const source = dialog();

    expect(source).toContain("body: JSON.stringify({ rounds })");
    expect(source).toContain("for (const key of targets) writtenRounds.current.add(roundKeyId(key));");
    expect(source.indexOf("for (const key of targets)")).toBeGreaterThan(source.indexOf("for (const chunk of chunkRounds"));
  });

  it("dialog_tiebreakRemove_keepsTextTypedInTheField", () => {
    expect(dialog()).not.toMatch(/send\(null, t\("dialog\.tiebreakRemoved"\)\)\.then/);
  });

  it("dialog_staleTiebreaks_removeSendsANullMap", () => {
    expect(dialog()).toMatch(/roundNumber: item\.roundNumber,\n\s+map: null,/);
  });

  it("snapshot_staleTiebreaks_areTheStoredOnesThatAreNotActive", () => {
    const snapshot = readSource("lib/server/tournaments/snapshot.ts");

    expect(snapshot).toContain("stored.filter((entry) => !activeKeys.has(roundKeyId(entry)))");
  });

  it("snapshot_staleTiebreaks_omittedWhenNoneIsStale", () => {
    const snapshot = readSource("lib/server/tournaments/snapshot.ts");

    expect(snapshot).toContain("stale.length > 0 ? { staleTiebreaks: stale } : {}");
  });

  it("dialog_rendersWithStableReferences", () => {
    const source = dialog();

    expect(source).toContain("if (!sameRoundKeys(stable.current, planned)) stable.current = planned;");
    expect(source).toContain("[slots, copyTarget, roundId, storedKey, clearSlotError]");
    expect(source).toContain("[stale, greyedId]");
  });

  it("mapPick_optimisticValue_expiresWithoutASnapshot", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/MatchRoundMaps.tsx");

    expect(source).toContain("setTimeout(() => setOptimistic(null), OPTIMISTIC_PICK_MS)");
  });

  it("mapPick_optimisticValue_isNotClearedByAnUnrelatedSnapshot", () => {
    const source = readSource("app/(secured)/tournois/[id]/_components/MatchRoundMaps.tsx");

    expect(source).not.toContain("snapshotVersion");
    // En vol, un instantané ne retire pas la valeur locale ; un changement arrivé pendant l'envoi non plus ne la rétablit pas.
    expect(source).toContain("current?.sent ? null : current");
    expect(source).toContain("storedRef.current === storedBefore");
    expect(source).toContain("setTimeout(() => window.dispatchEvent(new Event(MATCH_LAUNCH_REFRESH_EVENT)), OPTIMISTIC_REFETCH_MS)");
  });

  it("mapScoreList_tiebreakRowAnnouncement_isInBothLanguages", () => {
    expect(frDialogs.score.maps.tiebreakRow).toContain("{name}");
    expect(enDialogs.score.maps.tiebreakRow).toContain("{name}");
  });

  it("switchConfirmBody_mentionsTheTiebreakMapInBothLanguages", () => {
    expect(frRoundMaps.dialog.switchConfirm.body).toContain("map de départage");
    expect(enRoundMaps.dialog.switchConfirm.body).toContain("tiebreak map");
  });

  it("dialog_copyAndApplyAll_overMaxTexts_areInBothLanguages", () => {
    expect(frRoundMaps.dialog.overMaxTarget).toContain("{round}");
    expect(enRoundMaps.dialog.overMaxTarget).toContain("{max}");
  });


  const WIRING = [
    {
      name: "tiebreakDraft_isCoveredByCloseAndRoundSwitchConfirmations",
      file: "RoundMapsDialog.tsx",
      present: ["onDirtyChange={setTiebreakDirty}", 'if (roundDirty || tiebreakDirty) setPending({ kind: "switch", id })', "return () => onDirtyChange(false)"],
      absent: [],
    },
    {
      name: "copyAndApplyAll_refuseARoundThatPlaysFewerMaps_attachedToTheirField",
      file: "RoundMapsDialog.tsx",
      present: [
        'gapRefused() || targetOverMaxRefused(rounds, "applyAll")',
        'gapRefused() || targetOverMaxRefused([target], "copy")',
        "fieldErrors.flag(field, text)",
        '{...fieldErrors.aria("copy")}',
        "fieldId={`${ids}-apply-all`}",
      ],
      absent: [],
    },
    {
      name: "serverRefusalOfCopyAndApplyAll_isAttachedToTheGestureNotToTheCurrentList",
      file: "RoundMapsDialog.tsx",
      present: ['success: string, field: RoundField = "slots"', 'fieldErrors.report(code, text) && field !== "slots"', 't("dialog.appliedAll"), "applyAll")'],
      absent: [],
    },
    {
      name: "unchangedRules_areNotSent",
      file: "RoundMapsDialog.tsx",
      present: ["if (busy || !rulesDirty) return;", "aria-disabled={busy || !rulesDirty || undefined}"],
      absent: [],
    },
    {
      name: "buttonsThatEmptyThemselves_stayMountedWithAriaDisabled",
      file: "RoundMapsDialog.tsx",
      present: ["aria-disabled={busy || !saved || undefined}", "aria-disabled={busy || saved === null || undefined}", "{rounds.length > 1 && ("],
      absent: ["{saved && (", "{saved !== null && ("],
    },
    {
      name: "staleTiebreaks_explanationIsBehindAnInfoHintAndFocusIsKept",
      file: "RoundMapsDialog.tsx",
      present: [
        '{t("dialog.staleTiebreakHint")}\n        </InfoHint>',
        "fallbackFocusId={`${ids}-close`}",
        "focusAfter.current = { key: roundKeyId(item), index };",
        "items.some((item) => roundKeyId(item) === pending.key)",
      ],
      absent: ['<p className={styles.muted}>{t("dialog.staleTiebreakHint")}</p>'],
    },
    {
      name: "untouchedFormsAndStaleRefusals_areHandledWithoutNoise",
      file: "RoundMapsDialog.tsx",
      present: ["if (busy || !dirty || !allowed) return;", 'current?.kind === "close" ? current : null', "[slots, copyTarget, roundId, storedKey, clearSlotError]"],
      absent: [],
    },
    {
      name: "mapScoreList_tiebreakAnnouncement_tracksTheMapNameToo",
      file: "MapScoreList.tsx",
      present: ["`${tiebreakIndex}:${tiebreakName}`", "announcedTiebreak.current === tiebreakKey"],
      absent: [],
    },
    {
      name: "mapScoreList_tiebreakName_goesThroughVisibleTextAndCountsInTheLimit",
      file: "MapScoreList.tsx",
      present: ["visibleText(tiebreakMap)", "matchMaxMaps(format) + tiebreakRow"],
      absent: [],
    },
    {
      name: "tiebreakForm_keepsMountedAndResyncsAfterSave",
      file: "RoundMapsDialog.tsx",
      present: ["useTiebreakSection(rules.staleTiebreaks, round, tiebreakAllowed)", "aria-disabled={busy || !dirty || !allowed || undefined}", "allowed={tiebreakAllowed}", 'setValue(map ?? "")', 't("dialog.tiebreakUnavailable")'],
      absent: [],
    },
    {
      name: "tiebreakDisplay_hidesAMapNeverPlayedOnAFinishedMatch",
      file: "MatchRoundMaps.tsx",
      present: ["shownTiebreakMap("],
      absent: [],
    },
    {
      name: "tiebreakFact_hidesAMapNeverPlayedOnAFinishedMatch",
      file: "MatchPage.tsx",
      present: ["shownTiebreakMap("],
      absent: [],
    },
  ];

  it.each(WIRING)("wiring_$name", ({ file, present, absent }) => {
    const source = readSource(`app/(secured)/tournois/[id]/_components/${file}`);

    expect({
      missing: present.filter((fragment) => !source.includes(fragment)),
      forbidden: absent.filter((fragment) => source.includes(fragment)),
    }).toEqual({ missing: [], forbidden: [] });
  });

});

