import { describe, expect, it } from "@jest/globals";
import {
  accountDeletionConfirmation,
  accountDeletionMode,
  accountDeletionOutcome,
  accountDeletionPlan,
  accountRetentionReason,
  type AccountTrace,
} from "@/lib/shared/account-deletion";

const nothing: AccountTrace = {
  tournaments: false,
  organizedTournaments: false,
  ownedTeams: false,
};

describe("accountDeletionMode", () => {
  it("efface un compte qui ne laisse rien", () => {
    expect(accountDeletionMode(nothing)).toBe("ERASE");
  });

  it("anonymise dès qu'un tournoi a été joué", () => {
    expect(accountDeletionMode({ ...nothing, tournaments: true })).toBe("ANONYMIZE");
  });

  it("anonymise un organisateur — la base refuserait l'effacement", () => {
    // `bg_tournaments.organizer_user_id` est NOT NULL en ON DELETE RESTRICT.
    expect(accountDeletionMode({ ...nothing, organizedTournaments: true })).toBe("ANONYMIZE");
  });

  it("anonymise un propriétaire d'équipe — sinon l'équipe n'a plus de titulaire", () => {
    // `bg_team_members` s'efface en cascade : l'effacer laisserait une équipe
    // que personne ne peut plus renommer, dissoudre ni engager.
    expect(accountDeletionMode({ ...nothing, ownedTeams: true })).toBe("ANONYMIZE");
  });

  it("suffit d'une seule trace", () => {
    const traces: AccountTrace[] = [
      { tournaments: true, organizedTournaments: true, ownedTeams: true },
      { tournaments: false, organizedTournaments: true, ownedTeams: true },
      { tournaments: true, organizedTournaments: false, ownedTeams: false },
    ];
    for (const trace of traces) expect(accountDeletionMode(trace)).toBe("ANONYMIZE");
  });
});

describe("accountRetentionReason", () => {
  it("ne retient rien quand rien ne reste", () => {
    expect(accountRetentionReason(nothing)).toBeNull();
  });

  it("nomme la trace qui retient la ligne", () => {
    expect(accountRetentionReason({ ...nothing, tournaments: true })).toBe("TOURNAMENTS");
    expect(accountRetentionReason({ ...nothing, organizedTournaments: true }))
      .toBe("ORGANIZED_TOURNAMENTS");
    expect(accountRetentionReason({ ...nothing, ownedTeams: true })).toBe("OWNED_TEAMS");
  });

  it("préfère le tournoi joué : c'est la trace qui appartient aussi aux autres", () => {
    expect(accountRetentionReason({
      tournaments: true,
      organizedTournaments: true,
      ownedTeams: true,
    })).toBe("TOURNAMENTS");
    expect(accountRetentionReason({
      tournaments: false,
      organizedTournaments: true,
      ownedTeams: true,
    })).toBe("ORGANIZED_TOURNAMENTS");
  });
});

describe("accountDeletionPlan", () => {
  it("accorde toujours le mode et le motif — deux calculs séparés pourraient mentir", () => {
    const traces: AccountTrace[] = [
      nothing,
      { ...nothing, tournaments: true },
      { ...nothing, organizedTournaments: true },
      { ...nothing, ownedTeams: true },
    ];
    for (const trace of traces) {
      const plan = accountDeletionPlan(trace);
      expect(plan.mode).toBe(accountDeletionMode(trace));
      expect(plan.reason).toBe(accountRetentionReason(trace));
      expect(plan.mode === "ERASE").toBe(plan.reason === null);
    }
  });
});

describe("accountDeletionConfirmation", () => {
  it("ne promet pas la conservation de statistiques inexistantes", () => {
    const erase = accountDeletionConfirmation(null);
    expect(erase).toContain("aucun tournoi");
    expect(erase).not.toContain("statistiques de tournoi resteront");
  });

  it("annonce la conservation des statistiques à qui en a", () => {
    expect(accountDeletionConfirmation("TOURNAMENTS")).toContain("statistiques de tournoi");
  });

  it("ne parle de statistiques ni au propriétaire d'équipe ni à l'organisateur", () => {
    // Ils n'en ont aucune et n'ont affronté personne : le motif servi doit être
    // le leur, sans quoi la phrase est fausse sur un geste irréversible.
    for (const reason of ["ORGANIZED_TOURNAMENTS", "OWNED_TEAMS"] as const) {
      expect(accountDeletionConfirmation(reason)).not.toContain("statistiques");
      expect(accountDeletionConfirmation(reason)).not.toContain("affrontées");
    }
    expect(accountDeletionConfirmation("OWNED_TEAMS")).toContain("propriétaire d'une équipe");
    expect(accountDeletionConfirmation("ORGANIZED_TOURNAMENTS")).toContain("organisateur");
  });

  it("dit au propriétaire d'équipe le geste qui ouvrirait l'effacement complet", () => {
    const owned = accountDeletionConfirmation("OWNED_TEAMS");
    expect(owned).toMatch(/[Tt]ransf/);
    expect(owned).toContain("dissous");
  });

  it("dit dans tous les cas que le geste est irréversible", () => {
    for (const reason of [null, "TOURNAMENTS", "ORGANIZED_TOURNAMENTS", "OWNED_TEAMS"] as const) {
      expect(accountDeletionConfirmation(reason)).toContain("irréversible");
    }
  });

  it("annonce l'anonymat dès qu'une ligne reste, et jamais sinon", () => {
    for (const reason of ["TOURNAMENTS", "ORGANIZED_TOURNAMENTS", "OWNED_TEAMS"] as const) {
      expect(accountDeletionConfirmation(reason)).toContain("anonyme");
    }
    expect(accountDeletionConfirmation(null)).not.toContain("anonyme");
  });
});

describe("accountDeletionOutcome", () => {
  it("décrit ce qui vient d'être fait, et pas l'autre cas", () => {
    expect(accountDeletionOutcome(null)).toContain("aucune trace");
    expect(accountDeletionOutcome("TOURNAMENTS")).toContain("anonyme");
    expect(accountDeletionOutcome(null)).not.toContain("anonyme");
  });

  it("ne promet pas de statistiques conservées à qui n'en a pas", () => {
    expect(accountDeletionOutcome("ORGANIZED_TOURNAMENTS")).not.toContain("statistiques");
    expect(accountDeletionOutcome("OWNED_TEAMS")).not.toContain("statistiques");
    expect(accountDeletionOutcome("TOURNAMENTS")).toContain("statistiques");
  });
});
