import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pastWarningKey } from "@/lib/shared/match-start-entry";
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
    expect(SOURCE).toContain("initial ? String(initial.month) : String(matchEntryDefaultMonth(clock))");
    expect(SOURCE).toContain('setMonth("")');
    // Présélectionné, le mois ne compte qu'une fois un jour choisi (rendu : `match-schedule-dialog-render`).
    expect(SOURCE).toContain('const enteredMonth = monthPreset && day === "" ? "" : month;');
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
    expect(SOURCE).toMatch(
      /startAtHint\(\s*text,\s*refereeScheduling,\s*match\.team1Id !== null && match\.team2Id !== null,\s*(\/\/[^\n]*\s*)?isMatchOver\(match\.status, tournamentFinished\),\s*launchPhase,\s*match\.launchedAt !== null,\s*\)/,
    );
    // Un match joué n'annonce rien ; sinon l'avis vit derrière un « i », hors de l'aide.
    expect(SOURCE).toContain("return played ? null : scheduleNotice(text, refereeScheduling, entrantsKnown);");
    expect(SOURCE).toMatch(/if \(!entrantsKnown\) return text\.t\("schedule\.noticeTbd"\);/);
    expect(SOURCE).toContain('text.t(refereeScheduling ? "schedule.noticePlanning" : "schedule.notice")');
  });

  it("ne promet un avis de retrait qu'en tournoi planifié par l'arbitrage, et l'attente d'une place vide", () => {
    expect(frDialogs.schedule.noticePlanning).toContain("posé ou changé, ou un horaire retiré");
    expect(frDialogs.schedule.notice).toContain("posé ou changé");
    expect(frDialogs.schedule.notice).not.toContain("retiré");
    expect(frDialogs.schedule.noticeTbd).toContain("dans les 48 h qui précèdent le coup d'envoi");
    // « Engagées » n'a pas de sens en tournoi individuel.
    for (const notice of [frDialogs.schedule.notice, frDialogs.schedule.noticePlanning, frDialogs.schedule.noticeTbd]) {
      expect(notice).not.toContain("engagées");
    }
    expect(enDialogs.schedule.noticePlanning).toContain("set or changed, or a time removed");
    expect(enDialogs.schedule.notice).not.toContain("removed");
    expect(enDialogs.schedule.noticeTbd).toContain("within the 48 h before kickoff");
    expect(enDialogs.schedule.notice).toContain("announced to the match's players");
  });
});

describe("MatchScheduleDialog — aide inchangée", () => {
  it("garde l'aide d'avant : l'avis de qui sera prévenu vit dans ses propres clés, sans doublon", () => {
    for (const dialogs of [frDialogs, enDialogs]) {
      for (const hint of [dialogs.schedule.hint, dialogs.schedule.hintPlanning]) {
        expect(hint).not.toContain(dialogs.schedule.notice);
        expect(hint).not.toMatch(/annoncé aux joueurs|announced to the players/);
      }
    }
  });
});

describe("MatchScheduleDialog — confirmation d'un retrait", () => {
  it("confirme un retrait sans reprendre le titre de l'avis aux joueurs, qui ne part pas toujours", () => {
    expect(frDialogs.schedule.cleared).toBe("Date de début effacée.");
    expect(enDialogs.schedule.cleared).toBe("Start date cleared.");
  });

  it("ne parle pas de retrait quand il n'y avait aucun horaire", () => {
    expect(SOURCE).toContain('if (!touched) return text.t(hadTime ? "schedule.cleared" : "schedule.noTime");');
    expect(SOURCE).toContain("savedMessage(text, entry.kind === \"ready\", planning, match.startAt !== null)");
    expect(frDialogs.schedule.noTime).toBe("Aucune date de début posée.");
    expect(enDialogs.schedule.noTime).toBe("No start date set.");
  });
});

describe("MatchScheduleDialog — date déjà passée", () => {
  it("avertit d'une date passée par `pastStartWarning`, sans la refuser (logique : match-start-entry.test)", () => {
    expect(SOURCE).toContain("pastStartWarning({ ...match, refereeScheduling }, entry.instant, now, { launchPhase, tournamentFinished })");
    expect(SOURCE).toContain("<PastDateWarning message={pastWarning === null ? null : t(pastWarning)} />");
  });

  it("dit ce que la date déclenche selon la phase de lancement et les engagés", () => {
    expect(pastWarningKey(true, true)).toBe("schedule.warnPast");
    expect(pastWarningKey(true, false)).toBe("schedule.warnPastDirect");
    expect(pastWarningKey(false, true)).toBe("schedule.warnPastTbd");
    expect(pastWarningKey(false, false)).toBe("schedule.warnPastTbd");
  });

  it("porte ses trois avertissements en français et en anglais", () => {
    for (const key of ["warnPast", "warnPastDirect", "warnPastTbd"] as const) {
      expect(frDialogs.schedule[key]).toMatch(/^Cette date est déjà passée : .+ Vérifiez le jour et le mois\.$/);
      expect(enDialogs.schedule[key]).toMatch(/^This date has already passed: .+ Check the day and month\.$/);
    }
  });
});

describe("MatchScheduleDialog — sous-titre", () => {
  it("rend les engagés par EntrantName (forme affichable, lien de fiche), jamais le nom brut", () => {
    expect(SOURCE).toContain('<EntrantName teamId={match.team1Id} name={match.team1Name ?? t("schedule.tbd")} />');
    expect(SOURCE).toContain('<EntrantName teamId={match.team2Id} name={match.team2Name ?? t("schedule.tbd")} />');
    expect(SOURCE).not.toContain('"TBD"');
    expect(SOURCE).not.toMatch(/\/> vs\{" "\}/);
  });

  it("ouvre le focus sur le jour, pas sur le lien du premier engagé du sous-titre", () => {
    expect(SOURCE).toMatch(/<select\s+data-autofocus\s+id=\{FIELD_IDS\.day\}/);
  });
});
