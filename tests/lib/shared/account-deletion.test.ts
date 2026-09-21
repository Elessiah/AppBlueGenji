import { describe, expect, it } from "@jest/globals";
import {
  accountDeletionConfirmation,
  accountDeletionMode,
  accountDeletionOutcome,
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

describe("accountDeletionConfirmation", () => {
  it("ne promet pas la conservation de statistiques inexistantes", () => {
    const erase = accountDeletionConfirmation("ERASE");
    expect(erase).toContain("aucun tournoi");
    expect(erase).not.toContain("statistiques de tournoi resteront");
  });

  it("annonce la conservation des statistiques quand la ligne reste", () => {
    expect(accountDeletionConfirmation("ANONYMIZE")).toContain("statistiques de tournoi");
  });

  it("dit dans les deux cas que le geste est irréversible", () => {
    expect(accountDeletionConfirmation("ERASE")).toContain("irréversible");
    expect(accountDeletionConfirmation("ANONYMIZE")).toContain("irréversible");
  });
});

describe("accountDeletionOutcome", () => {
  it("décrit ce qui vient d'être fait, et pas l'autre cas", () => {
    expect(accountDeletionOutcome("ERASE")).toContain("aucune trace");
    expect(accountDeletionOutcome("ANONYMIZE")).toContain("anonyme");
    expect(accountDeletionOutcome("ERASE")).not.toContain("anonyme");
  });
});
