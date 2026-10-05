import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
  it("propose une liste de demi-heures, pas un champ libre", () => {
    expect(SOURCE).not.toContain('type="time"');
    expect(SOURCE).toContain("matchEntryTimeOptions(");
    expect(SOURCE).toMatch(/<select\s+id=\{FIELD_IDS\.time\}/);
  });

  it("part de 21:00 sans date posée, et y revient quand on vide la date", () => {
    expect(SOURCE).toContain("useState(initial ? matchEntryTimeValue(initial) : MATCH_ENTRY_DEFAULT_TIME)");
    expect(SOURCE).toContain("setTime(MATCH_ENTRY_DEFAULT_TIME)");
  });

  it("n'explique plus la déduction de l'année, mais garde l'aperçu et sa correction", () => {
    expect(SOURCE).not.toMatch(/se déduit automatiquement/);
    expect(SOURCE).toContain("Date retenue");
    expect(SOURCE).toContain("Mauvaise année ?");
  });
});
