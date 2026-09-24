import { describe, expect, it } from "@jest/globals";
import {
  ACCOUNT_DELETED_ERROR,
  RETENTION_UNKNOWN,
  ACCOUNT_DELETED_WRITE_MESSAGE,
  accountDeletionConfirmation,
  accountDeletionErrorMessage,
  accountDeletionMode,
  accountDeletionOutcome,
  accountDeletionPlan,
  accountRetentionReason,
  type AccountTrace,
} from "@/lib/shared/account-deletion";

const nothing: AccountTrace = {
  playedMatches: false,
  organizedTournaments: false,
  ownedTeams: false,
};

describe("accountDeletionMode", () => {
  it("efface un compte qui ne laisse rien", () => {
    expect(accountDeletionMode(nothing)).toBe("ERASE");
  });

  it("anonymise dès qu'un tournoi a été joué", () => {
    expect(accountDeletionMode({ ...nothing, playedMatches: true })).toBe("ANONYMIZE");
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
      { playedMatches: true, organizedTournaments: true, ownedTeams: true },
      { playedMatches: false, organizedTournaments: true, ownedTeams: true },
      { playedMatches: true, organizedTournaments: false, ownedTeams: false },
    ];
    for (const trace of traces) expect(accountDeletionMode(trace)).toBe("ANONYMIZE");
  });
});

describe("accountRetentionReason", () => {
  it("ne retient rien quand rien ne reste", () => {
    expect(accountRetentionReason(nothing)).toBeNull();
  });

  it("nomme la trace qui retient la ligne", () => {
    expect(accountRetentionReason({ ...nothing, playedMatches: true })).toBe("TOURNAMENTS");
    expect(accountRetentionReason({ ...nothing, organizedTournaments: true }))
      .toBe("ORGANIZED_TOURNAMENTS");
    expect(accountRetentionReason({ ...nothing, ownedTeams: true })).toBe("OWNED_TEAMS");
  });

  it("préfère le tournoi joué : c'est la trace qui appartient aussi aux autres", () => {
    expect(accountRetentionReason({
      playedMatches: true,
      organizedTournaments: true,
      ownedTeams: true,
    })).toBe("TOURNAMENTS");
    expect(accountRetentionReason({
      playedMatches: false,
      organizedTournaments: true,
      ownedTeams: true,
    })).toBe("ORGANIZED_TOURNAMENTS");
  });
});

describe("accountDeletionPlan", () => {
  it("accorde toujours le mode et le motif — deux calculs séparés pourraient mentir", () => {
    const traces: AccountTrace[] = [
      nothing,
      { ...nothing, playedMatches: true },
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
    expect(erase).toContain("aucun match");
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

  /**
   * L'aperçu peut ne pas répondre, et le serveur re-décide de toute façon sur
   * son propre instantané. L'écran retombait alors sur la phrase de
   * `TOURNAMENTS` — « le compte devient anonyme, tes statistiques restent » —
   * alors qu'un effacement **complet** pouvait suivre : un accord donné à la
   * moitié rassurante d'un geste irréversible.
   */
  it("ne promet ni conservation ni effacement quand le sort du compte est inconnu", () => {
    const unknown = accountDeletionConfirmation(RETENTION_UNKNOWN);
    expect(unknown).toContain("irréversible");
    expect(unknown).not.toContain("statistiques");
    // Ni « ton compte sera effacé entièrement », ni « le compte devient
    // anonyme » : les deux issues sont nommées comme possibles, aucune promise.
    expect(unknown).not.toMatch(/sera effacé entièrement, sans laisser/);
    expect(unknown).not.toMatch(/seront effacées \(le compte devient anonyme\)/);
    expect(unknown).toMatch(/anonyme ou effacé/);
  });

  it("retombe sur la phrase prudente, jamais sur la plus définitive", () => {
    // Une valeur qu'on n'attendait pas ne doit pas mener à la description la
    // plus lourde des quatre. Seul `null` — la réponse « il ne reste rien » —
    // annonce un effacement complet.
    const surprise = accountDeletionConfirmation("N_IMPORTE_QUOI" as never);
    expect(surprise).toBe(accountDeletionConfirmation(RETENTION_UNKNOWN));
    expect(accountDeletionConfirmation(null)).toContain("effacé entièrement");
  });

  it("annonce le pseudo d'emprunt dès qu'une ligne reste, et jamais sinon", () => {
    for (const reason of ["TOURNAMENTS", "ORGANIZED_TOURNAMENTS", "OWNED_TEAMS"] as const) {
      expect(accountDeletionConfirmation(reason)).toContain("pseudo d'emprunt");
    }
    expect(accountDeletionConfirmation(null)).not.toContain("pseudo d'emprunt");
  });
});

describe("accountDeletionOutcome", () => {
  it("décrit ce qui vient d'être fait, et pas l'autre cas", () => {
    expect(accountDeletionOutcome(null)).toContain("aucune trace");
    expect(accountDeletionOutcome("TOURNAMENTS")).toContain("pseudo d'emprunt");
    expect(accountDeletionOutcome(null)).not.toContain("pseudo d'emprunt");
  });

  it("ne promet pas de statistiques conservées à qui n'en a pas", () => {
    expect(accountDeletionOutcome("ORGANIZED_TOURNAMENTS")).not.toContain("statistiques");
    expect(accountDeletionOutcome("OWNED_TEAMS")).not.toContain("statistiques");
    expect(accountDeletionOutcome("TOURNAMENTS")).toContain("statistiques");
  });

  it("ne promet ni effacement ni conservation sur une valeur inconnue", () => {
    // `null` **est** une réponse (« il ne reste rien ») ; l'inconnu n'en est
    // pas une. Le repli portait la phrase de `null`, la plus définitive des
    // deux : un aperçu en échec suivi d'une réponse illisible annonçait donc
    // une disparition totale que rien n'avait prouvée.
    const unknown = accountDeletionOutcome(RETENTION_UNKNOWN);
    expect(unknown).not.toContain("aucune trace");
    expect(unknown).not.toContain("anonyme");
    expect(unknown).toContain("supprimé");
  });
});

describe("accountDeletionErrorMessage", () => {
  it("nomme le geste qui débloque une ligne devenue référencée", () => {
    const message = accountDeletionErrorMessage("ACCOUNT_STILL_REFERENCED");
    expect(message).toMatch(/[Rr]éessaie/);
    expect(message).toContain("anonymisé");
  });

  it("ne laisse jamais passer un code brut dans une notification", () => {
    for (const code of [undefined, "ACCOUNT_DELETE_FAILED", "ER_ROW_IS_REFERENCED_2"]) {
      const message = accountDeletionErrorMessage(code);
      expect(message).not.toContain("_");
      expect(message).toMatch(/[éèà]/);
    }
  });
});

describe("ACCOUNT_DELETED_WRITE_MESSAGE", () => {
  it("dit en français qu'une modification est arrivée trop tard", () => {
    expect(ACCOUNT_DELETED_WRITE_MESSAGE).not.toContain("_");
    expect(ACCOUNT_DELETED_WRITE_MESSAGE).toMatch(/supprimé/);
    // Le joueur doit savoir que **rien** n'a été écrit : sans cette moitié, il
    // quitte la page en croyant sa photo posée.
    expect(ACCOUNT_DELETED_WRITE_MESSAGE).toMatch(/pas été enregistrée/);
  });
});
