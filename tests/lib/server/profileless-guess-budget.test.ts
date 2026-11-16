import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  admitProfilelessName,
  PROFILELESS_GUESS_WINDOW_MS,
  PROFILELESS_PRUNE_SLACK,
  resetProfilelessGuessesForTests,
  trackedProfilelessBudgetsForTests,
} from "@/lib/server/users/profileless-guess-budget";

/**
 * Revue sécurité EF-65 cycles 2 et 3 : les pseudos d'emprunt viennent d'une
 * liste publique de mille ; les noms faux essayés sont bornés par compte
 * demandé, tous visiteurs confondus (plusieurs comptes n'ajoutent aucun essai).
 */
const T0 = 1_000_000;
const LISTED = new Map<number, ReadonlySet<string>>([[3, new Set(["apextv"])]]);
const WRONG = ["alphafx", "alphagod", "alphaone", "alphapro"];

beforeEach(() => {
  resetProfilelessGuessesForTests();
});

describe("admitProfilelessName", () => {
  it("admitProfilelessName_idNotListed_admittedWithoutTracking", () => {
    expect(admitProfilelessName(5, "anything", LISTED, T0)).toBe(true);
    expect(trackedProfilelessBudgetsForTests()).toBe(0);
  });

  it("admitProfilelessName_fourWrongNames_allAdmitted", () => {
    expect(WRONG.map((key) => admitProfilelessName(3, key, LISTED, T0))).toEqual([true, true, true, true]);
  });

  it("admitProfilelessName_fifthWrongName_refused", () => {
    for (const key of WRONG) admitProfilelessName(3, key, LISTED, T0);

    expect(admitProfilelessName(3, "alphazen", LISTED, T0)).toBe(false);
  });

  it("admitProfilelessName_correctNameAfterCapNeverJudged_refused", () => {
    for (const key of WRONG) admitProfilelessName(3, key, LISTED, T0);

    expect(admitProfilelessName(3, "apextv", LISTED, T0)).toBe(false);
  });

  it("admitProfilelessName_correctNameJudgedBeforeCap_stillAdmittedAfterCap", () => {
    admitProfilelessName(3, "apextv", LISTED, T0);
    for (const key of WRONG) admitProfilelessName(3, key, LISTED, T0);

    expect(admitProfilelessName(3, "apextv", LISTED, T0)).toBe(true);
  });

  it("admitProfilelessName_sameWrongNameRepeated_notCountedTwice", () => {
    admitProfilelessName(3, "alphafx", LISTED, T0);
    admitProfilelessName(3, "alphafx", LISTED, T0);
    admitProfilelessName(3, "alphagod", LISTED, T0);
    admitProfilelessName(3, "alphaone", LISTED, T0);

    expect(admitProfilelessName(3, "alphafx", LISTED, T0)).toBe(true);
    expect(admitProfilelessName(3, "apextv", LISTED, T0)).toBe(true);
  });

  it("admitProfilelessName_budgetSharedAcrossViewers_noExtraGuesses", () => {
    // La borne ne connaît aucun visiteur : un autre compte n'a pas d'essai à lui.
    for (const key of WRONG) admitProfilelessName(3, key, LISTED, T0);

    expect(admitProfilelessName(3, "alphazen", LISTED, T0 + 1)).toBe(false);
  });

  it("admitProfilelessName_windowExpired_wrongCountReset", () => {
    for (const key of WRONG) admitProfilelessName(3, key, LISTED, T0);

    expect(admitProfilelessName(3, "alphazen", LISTED, T0 + PROFILELESS_GUESS_WINDOW_MS)).toBe(true);
  });

  it("admitProfilelessName_knownNameRenamed_droppedFromKnown", () => {
    admitProfilelessName(3, "apextv", LISTED, T0);
    const renamed = new Map<number, ReadonlySet<string>>([[3, new Set(["novatv"])]]);
    for (const key of WRONG) admitProfilelessName(3, key, renamed, T0);

    expect(admitProfilelessName(3, "apextv", renamed, T0)).toBe(false);
  });

  it("admitProfilelessName_manyIdsLeftList_prunedBeyondSlack", () => {
    const everyone = new Map<number, ReadonlySet<string>>(
      Array.from({ length: PROFILELESS_PRUNE_SLACK + 2 }, (_, index) => [index + 1, new Set(["nom"])]),
    );
    for (const id of everyone.keys()) admitProfilelessName(id, "nom", everyone, T0);

    admitProfilelessName(1, "nom", new Map([[1, new Set(["nom"])]]), T0);

    expect(trackedProfilelessBudgetsForTests()).toBe(1);
  });
});
