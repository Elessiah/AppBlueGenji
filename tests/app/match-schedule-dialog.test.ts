import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import enDialogs from "@/messages/en/tournamentDialogs.json";
import frDialogs from "@/messages/fr/tournamentDialogs.json";

/**
 * Saisie de l'heure dans `MatchScheduleDialog` (harnais `node` : invariants
 * gardés sur la source, la logique pure vit dans `match-start-entry.test.ts`).
 */
const SOURCE = readFileSync(
  join(__dirname, "..", "..", "app", "(secured)", "tournois", "[id]", "_components", "MatchScheduleDialog.tsx"),
  "utf8",
);

describe("globals.css — champs d'heure", () => {
  const GLOBALS = readFileSync(join(__dirname, "..", "..", "app", "globals.css"), "utf8");

  it("ne garde plus de style mort pour `input[type=\"time\"]`, que plus aucune page ne rend", () => {
    expect(GLOBALS).not.toContain('input[type="time"]');
  });

  it("conserve l'habillage des champs date-heure du formulaire de tournoi", () => {
    expect(GLOBALS).toMatch(/input\[type="datetime-local"\]\s*\{\s*appearance: none;/);
    expect(GLOBALS).toContain('input[type="datetime-local"]::-webkit-calendar-picker-indicator {');
    expect(GLOBALS).toMatch(
      /input\[type="datetime-local"\]::-webkit-outer-spin-button,\s*input\[type="datetime-local"\]::-webkit-inner-spin-button \{\s*display: none;/,
    );
  });
});

describe("MatchScheduleDialog — heure", () => {
  it("propose une liste de quarts d'heure, pas un champ libre", () => {
    expect(SOURCE).not.toContain('type="time"');
    expect(SOURCE).toContain("matchEntryTimeOptions(");
    expect(SOURCE).toMatch(/<select\s+id=\{FIELD_IDS\.time\}/);
  });

  it("part de 21:00 sans date posée, et y revient quand on vide la date", () => {
    expect(SOURCE).toContain("useState(initial ? matchEntryTimeValue(initial) : MATCH_ENTRY_DEFAULT_TIME)");
    expect(SOURCE).toContain("setTime(MATCH_ENTRY_DEFAULT_TIME)");
  });

  it("présélectionne le mois courant sans date posée, et le vide avec la date", () => {
    expect(SOURCE).toContain("initial ? String(initial.month) : String(matchEntryDefaultMonth(Date.now()))");
    expect(SOURCE).toContain('setMonth("")');
  });

  it("n'explique plus la déduction de l'année, mais garde l'aperçu et sa correction", () => {
    expect(SOURCE).not.toMatch(/se déduit automatiquement/);
    // Lot 8b : les phrases vivent dans `tournamentDialogs.schedule`.
    expect(SOURCE).toContain('{t("schedule.preview")}');
    expect(SOURCE).toContain('{t("schedule.wrongYear")}');
    expect(frDialogs.schedule.preview).toBe("Date retenue :");
    expect(frDialogs.schedule.wrongYear).toBe("Mauvaise année ?");
  });
});

describe("MatchScheduleDialog — qui l'horaire prévient", () => {
  it("dit aux arbitres que l'horaire est annoncé, et quand", () => {
    expect(SOURCE).toContain("startAtHint(text, refereeScheduling, match.team1Id !== null && match.team2Id !== null)");
    expect(SOURCE).toMatch(/if \(!entrantsKnown\) return text\.t\("schedule\.noticeTbd"\);/);
    expect(SOURCE).toContain('text.t(refereeScheduling ? "schedule.noticePlanning" : "schedule.notice")');
  });

  it("ne promet un avis de retrait qu'en tournoi planifié par l'arbitrage, et l'attente d'une place vide", () => {
    expect(frDialogs.schedule.noticePlanning).toContain("posé, changé ou retiré");
    expect(frDialogs.schedule.notice).toContain("posé ou changé");
    expect(frDialogs.schedule.notice).not.toContain("retiré");
    expect(frDialogs.schedule.noticeTbd).toContain("dans les 48 h qui précèdent le coup d'envoi");
    expect(enDialogs.schedule.noticePlanning).toContain("set, changed or removed");
    expect(enDialogs.schedule.notice).not.toContain("removed");
    expect(enDialogs.schedule.noticeTbd).toContain("within the 48 h before kickoff");
  });
});
