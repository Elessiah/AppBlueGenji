import { describe, expect, it } from "@jest/globals";
import {
  RESTRICTED_FIELDS,
  checkEditPatch,
  editLockReason,
  editWindowFor,
  editableFieldsFor,
  isFieldEditable,
  type EditableTournament,
} from "@/lib/shared/tournament-edit";

const NOW = Date.parse("2026-08-27T12:00:00.000Z");
const iso = (offsetMs: number) => new Date(NOW + offsetMs).toISOString();
const HOUR = 3600_000;

function tournament(over: Partial<EditableTournament> = {}): EditableTournament {
  return {
    state: "UPCOMING",
    startVisibilityAt: iso(24 * HOUR),
    maxTeams: 16,
    ...over,
  };
}

describe("editWindowFor", () => {
  it("ouvre tout tant que le tournoi n'est pas visible", () => {
    expect(editWindowFor(tournament(), NOW)).toBe("FULL");
    expect(editLockReason(tournament(), NOW)).toBeNull();
  });

  it("bascule en RESTRICTED à la seconde où la visibilité s'ouvre", () => {
    const t = tournament({ startVisibilityAt: iso(0) });
    expect(editWindowFor(t, NOW - 1)).toBe("FULL");
    expect(editWindowFor(t, NOW)).toBe("RESTRICTED");
    expect(editLockReason(t, NOW)).toBe("VISIBLE");
  });

  it("reste RESTRICTED pendant les inscriptions", () => {
    const t = tournament({ state: "REGISTRATION", startVisibilityAt: iso(-HOUR) });
    expect(editWindowFor(t, NOW)).toBe("RESTRICTED");
  });

  it("verrouille dès que le tournoi est lancé ou terminé", () => {
    for (const state of ["RUNNING", "FINISHED"] as const) {
      const t = tournament({ state, startVisibilityAt: iso(-HOUR) });
      expect(editWindowFor(t, NOW)).toBe("LOCKED");
      expect(editLockReason(t, NOW)).toBe("STARTED");
    }
  });

  it("verrouille un tournoi lancé même si sa date de visibilité est future", () => {
    // Date reprise à la main : l'état prime sur la visibilité.
    const t = tournament({ state: "RUNNING", startVisibilityAt: iso(24 * HOUR) });
    expect(editWindowFor(t, NOW)).toBe("LOCKED");
  });

  it("traite une date illisible comme visible", () => {
    const t = tournament({ startVisibilityAt: "pas-une-date" });
    expect(editWindowFor(t, NOW)).toBe("RESTRICTED");
  });
});

describe("editableFieldsFor", () => {
  it("autorise tous les champs en FULL", () => {
    const fields = editableFieldsFor(tournament(), NOW);
    expect(fields.has("format")).toBe(true);
    expect(fields.has("phases")).toBe(true);
    expect(fields.has("startVisibilityAt")).toBe(true);
  });

  it("n'autorise que la liste restreinte en RESTRICTED", () => {
    const t = tournament({ startVisibilityAt: iso(-HOUR) });
    const fields = editableFieldsFor(t, NOW);
    expect([...fields].sort()).toEqual([...RESTRICTED_FIELDS].sort());
    expect(fields.has("format")).toBe(false);
    expect(fields.has("registrationOpenAt")).toBe(false);
  });

  it("n'autorise rien en LOCKED", () => {
    const t = tournament({ state: "RUNNING", startVisibilityAt: iso(-HOUR) });
    expect(editableFieldsFor(t, NOW).size).toBe(0);
    expect(isFieldEditable("name", t, NOW)).toBe(false);
  });
});

describe("checkEditPatch", () => {
  it("accepte un patch vide", () => {
    expect(checkEditPatch(tournament(), {}, NOW)).toBeNull();
  });

  it("refuse un champ hors fenêtre en le nommant", () => {
    const t = tournament({ startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { format: "DOUBLE" }, NOW)).toEqual({
      code: "FIELD_NOT_EDITABLE",
      field: "format",
    });
  });

  it("refuse une baisse d'effectif en RESTRICTED", () => {
    const t = tournament({ startVisibilityAt: iso(-HOUR), maxTeams: 16 });
    expect(checkEditPatch(t, { maxTeams: 8 }, NOW)).toEqual({
      code: "MAX_TEAMS_CANNOT_DECREASE",
    });
    expect(checkEditPatch(t, { maxTeams: 32 }, NOW)).toBeNull();
    expect(checkEditPatch(t, { maxTeams: 16 }, NOW)).toBeNull();
  });

  it("autorise une baisse d'effectif tant que le tournoi est caché", () => {
    expect(checkEditPatch(tournament(), { maxTeams: 8 }, NOW)).toBeNull();
  });

  it("refuse une clôture d'inscriptions dans le passé pendant les inscriptions", () => {
    const t = tournament({ state: "REGISTRATION", startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { registrationCloseAt: iso(-HOUR) }, NOW)).toEqual({
      code: "REGISTRATION_CLOSE_IN_PAST",
    });
    expect(checkEditPatch(t, { registrationCloseAt: iso(HOUR) }, NOW)).toBeNull();
  });

  it("ne contrôle pas la clôture passée hors état REGISTRATION", () => {
    const t = tournament({ state: "UPCOMING", startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { registrationCloseAt: iso(-HOUR) }, NOW)).toBeNull();
  });

  it("signale le champ interdit avant la contrainte de valeur", () => {
    const t = tournament({ state: "RUNNING", startVisibilityAt: iso(-HOUR) });
    expect(checkEditPatch(t, { maxTeams: 2 }, NOW)).toEqual({
      code: "FIELD_NOT_EDITABLE",
      field: "maxTeams",
    });
  });
});
