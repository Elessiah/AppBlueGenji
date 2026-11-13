import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "@jest/globals";

import { scoreFormSyncOutcome } from "@/app/(secured)/tournois/[id]/_lib/score-form";

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

    expect(dialog).toContain("{(form.conflict || form.rulesConflict) && (");
    expect(dialog).toContain('t(form.conflict ? "score.admin.conflict" : "score.admin.rulesChanged")');
    expect(fr.score.admin.rulesChanged).toContain("format de la manche a changé");
    expect(en.score.admin.rulesChanged).toContain("round format changed");
  });
});
