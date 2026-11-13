import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

import { rulesConflictShown, scoreFormSyncOutcome } from "@/app/(secured)/tournois/[id]/_lib/score-form";

const ROOT = path.join(__dirname, "..", "..");
const read = (relative: string) => readFileSync(path.join(ROOT, relative), "utf8");
type Dialogs = { score: { admin: Record<string, string> } };

describe("scoreFormSyncOutcome — le match change sous la saisie d'arbitrage", () => {
  it("scoreFormSyncOutcome_untouched_adoptsWithoutWarning", () => {
    const outcome = scoreFormSyncOutcome({ untouched: true, resultChanged: true, rulesChanged: true, submitting: false });

    expect(outcome).toEqual({ adopt: true, conflict: false, rulesConflict: false });
  });

  it("scoreFormSyncOutcome_resultSavedByThirdParty_flagsConflict", () => {
    const outcome = scoreFormSyncOutcome({ untouched: false, resultChanged: true, rulesChanged: false, submitting: false });

    expect(outcome).toEqual({ adopt: false, conflict: true, rulesConflict: false });
  });

  it("scoreFormSyncOutcome_ownSubmitEcho_noConflict", () => {
    const outcome = scoreFormSyncOutcome({ untouched: false, resultChanged: true, rulesChanged: false, submitting: true });

    expect(outcome).toEqual({ adopt: false, conflict: false, rulesConflict: false });
  });

  it("scoreFormSyncOutcome_roundFormatChanged_flagsRulesConflict", () => {
    const outcome = scoreFormSyncOutcome({ untouched: false, resultChanged: false, rulesChanged: true, submitting: false });

    expect(outcome).toEqual({ adopt: false, conflict: false, rulesConflict: true });
  });

  it("scoreFormSyncOutcome_proposalOnly_keepsEntryQuietly", () => {
    const outcome = scoreFormSyncOutcome({ untouched: false, resultChanged: false, rulesChanged: false, submitting: false });

    expect(outcome).toEqual({ adopt: false, conflict: false, rulesConflict: false });
  });
});

describe("AdminScoreDialog — avis de format changé", () => {
  it("AdminScoreDialog_rulesConflict_showsOwnNoticeInFrAndEn", () => {
    const dialog = read("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");
    const fr = JSON.parse(read("messages/fr/tournamentDialogs.json")) as Dialogs;
    const en = JSON.parse(read("messages/en/tournamentDialogs.json")) as Dialogs;

    expect(dialog).toContain("if (!form.conflict && !form.rulesConflict) return null;");
    expect(dialog).toContain("<ScoreConflictNotice text={text} form={form} />");
    expect(fr.score.admin.rulesChanged).toContain("format de la manche a changé");
    expect(en.score.admin.rulesChanged).toContain("round format changed");
  });
});

describe("rulesConflictShown — l'avis de format changé reste vrai", () => {
  it("rulesConflictShown_noRuleChange_returnsFalse", () => {
    expect(rulesConflictShown({ enteredUnder: null, rules: "BO3|OW", mapsRefusedNow: true })).toBe(false);
  });

  it("rulesConflictShown_ruleBackToEntry_returnsFalse", () => {
    expect(rulesConflictShown({ enteredUnder: "BO3|OW", rules: "BO3|OW", mapsRefusedNow: true })).toBe(false);
  });

  it("rulesConflictShown_rowsPassCurrentRule_returnsFalse", () => {
    expect(rulesConflictShown({ enteredUnder: "BO3|OW", rules: "BO5|OW", mapsRefusedNow: false })).toBe(false);
  });

  it("rulesConflictShown_ruleChangedAndRowsRefused_returnsTrue", () => {
    expect(rulesConflictShown({ enteredUnder: "BO5|OW", rules: "BO3|OW", mapsRefusedNow: true })).toBe(true);
  });
});

describe("Saisie d'arbitrage — câblage de l'avis de format changé", () => {
  const hook = read("app/(secured)/tournois/[id]/_hooks/useScoreForm.ts");
  const dialog = read("app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx");

  it("useScoreForm_rulesConflict_keepsFirstEntryRule", () => {
    expect(hook).toContain("if (outcome.rulesConflict) setRulesEnteredUnder((current) => current ?? synced.rules);");
  });

  it("AdminScoreDialog_bothConflicts_showsBothTexts", () => {
    expect(dialog).toContain('{form.conflict && <p className={styles.conflictText}>{text.t("score.admin.conflict")}</p>}');
    expect(dialog).toContain('{form.rulesConflict && <p className={styles.conflictText}>{text.t("score.admin.rulesChanged")}</p>}');
  });

  it("AdminScoreDialog_rulesConflict_closesCorrectionConfirmation", () => {
    expect(dialog).toMatch(/useEffect\(\(\) => \{\s*if \(form\.rulesConflict\) setConfirmingCorrection\(null\);\s*\}, \[form\.rulesConflict\]\);/);
  });
});
