import { beforeEach, describe, expect, it } from "@jest/globals";
import {
  admitProfilelessName,
  PROFILELESS_GUESS_WINDOW_MS,
  resetProfilelessGuessesForTests,
  storedProfilelessWrongNamesForTests,
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

  // Revue sécurité EF-65 cycle 4 : un nom juste encore jugé après la borne
  // laissait balayer les mille pseudos jusqu'à lui.
  it("admitProfilelessName_correctNameJudgedBeforeCap_refusedAfterCap", () => {
    admitProfilelessName(3, "apextv", LISTED, T0);
    for (const key of WRONG) admitProfilelessName(3, key, LISTED, T0);

    expect(admitProfilelessName(3, "apextv", LISTED, T0)).toBe(false);
  });

  it("admitProfilelessName_correctNameBeforeCap_notCounted", () => {
    admitProfilelessName(3, "apextv", LISTED, T0);
    admitProfilelessName(3, "apextv", LISTED, T0);
    admitProfilelessName(3, "apextv", LISTED, T0);

    expect(WRONG.map((key) => admitProfilelessName(3, key, LISTED, T0))).toEqual([true, true, true, true]);
  });

  it("admitProfilelessName_wrongName_storedAsDigestNotClearText", () => {
    admitProfilelessName(3, "realname", LISTED, T0);

    const stored = storedProfilelessWrongNamesForTests(3);
    expect(stored).toHaveLength(1);
    expect(stored[0]).not.toContain("realname");
  });

  it("admitProfilelessName_newDirectoryWithoutId_budgetDropped", () => {
    admitProfilelessName(3, "alphafx", LISTED, T0);
    const erased = new Map<number, ReadonlySet<string>>([[4, new Set(["novatv"])]]);

    admitProfilelessName(9, "anything", erased, T0);

    expect(storedProfilelessWrongNamesForTests(3)).toEqual([]);
    expect(trackedProfilelessBudgetsForTests()).toBe(0);
  });

  it("admitProfilelessName_newDirectoryWindowExpired_budgetDropped", () => {
    admitProfilelessName(3, "alphafx", LISTED, T0);
    const refreshed = new Map<number, ReadonlySet<string>>([[3, new Set(["apextv"])]]);

    admitProfilelessName(9, "anything", refreshed, T0 + PROFILELESS_GUESS_WINDOW_MS);

    expect(trackedProfilelessBudgetsForTests()).toBe(0);
  });

  it("admitProfilelessName_newDirectoryWithinWindow_keepsExhaustion", () => {
    for (const key of WRONG) admitProfilelessName(3, key, LISTED, T0);
    const refreshed = new Map<number, ReadonlySet<string>>([[3, new Set(["apextv"])]]);

    expect(admitProfilelessName(3, "alphazen", refreshed, T0 + 1)).toBe(false);
  });

  it("admitProfilelessName_sameWrongNameRepeated_notCountedTwice", () => {
    admitProfilelessName(3, "alphafx", LISTED, T0);
    admitProfilelessName(3, "alphafx", LISTED, T0);
    admitProfilelessName(3, "alphagod", LISTED, T0);
    admitProfilelessName(3, "alphaone", LISTED, T0);

    expect(admitProfilelessName(3, "alphafx", LISTED, T0)).toBe(true);
    expect(admitProfilelessName(3, "alphapro", LISTED, T0)).toBe(true);
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
});
