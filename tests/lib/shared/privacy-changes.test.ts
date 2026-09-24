import { describe, expect, it } from "@jest/globals";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
} from "@/lib/shared/account-deletion-journal";
import {
  INVALID_PRIVACY_CHANGES,
  PRIVACY_CHANGES,
  PRIVACY_CHANGE_ID_MAX_LENGTH,
  PRIVACY_CHANGE_ID_PATTERN,
  PRIVACY_DM_MAX_LENGTH,
  PRIVACY_DM_MIN_INTERVAL_DAYS,
  PRIVACY_DM_SETTLE_DAYS,
  PRIVACY_DM_WINDOW_DAYS,
  UNKNOWN_PRIVACY_CHANGE,
  announceablePrivacyChanges,
  buildPrivacyChangesMessage,
  checkPrivacyAcknowledgement,
  formatPrivacyChangeDate,
  pendingPrivacyChanges,
  privacyChangesHeading,
  privacyDmBatch,
  privacyPolicyUpdatedLabel,
  settledPrivacyChanges,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";

function change(id: string, publishedAt: string, overrides: Partial<PrivacyChange> = {}): PrivacyChange {
  return { id, publishedAt, title: `Titre ${id}`, summary: `Résumé ${id}.`, details: [`Détail ${id}`], ...overrides };
}

const A = change("a", "2026-01-10");
const B = change("b", "2026-03-05");
const C = change("c", "2026-06-20");
const REGISTRY = [A, B, C];

/**
 * Le registre est ce qu'un agent modifie pour déclencher la modale : ces tests
 * sont le garde-fou de ce geste. Une entrée mal formée ne casserait rien de
 * visible — elle ferait simplement réapparaître, ou disparaître, un changement.
 */
describe("PRIVACY_CHANGES — intégrité du registre", () => {
  it("n'est pas vide : la mise en production doit présenter le récapitulatif", () => {
    expect(PRIVACY_CHANGES.length).toBeGreaterThan(0);
    expect(PRIVACY_CHANGES[0].id).toBe("2026-09-recapitulatif-rgpd");
  });

  it("porte le changement des sauvegardes chiffrées, aux durées que /rgpd affiche", () => {
    const backup = PRIVACY_CHANGES.find((entry) => entry.id === "2026-09-sauvegardes-chiffrees");
    expect(backup).toBeDefined();
    expect(backup!.summary).toContain(`${BACKUP_RETENTION_DAYS} jours`);
    expect(backup!.details.join(" ")).toContain(`${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours`);
    expect(backup!.details.join(" ")).toMatch(/journal/);
  });

  it("déclare le public d'un BattleTag masqué : joueurs d'un match et arbitrage, le temps du tournoi", () => {
    // `getFullProfile` rouvre le tag masqué à ces deux publics : sans cette
    // entrée, le site traiterait une donnée d'une façon qu'il n'a pas annoncée.
    const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-09-battletag-masque-matchs");
    expect(entry).toBeDefined();
    const text = [entry!.summary, ...entry!.details].join(" ");
    expect(text).toMatch(/joueurs de tes matchs|joueurs d'un match/);
    expect(text).toMatch(/arbitr/);
    expect(text).toMatch(/n'est pas terminé/);
    // L'écart avec le tag Discord est dit : pas de passe-droit administrateur.
    expect(text).toMatch(/administrateur ne voit pas un BattleTag masqué/);
  });

  it("a des identifiants uniques, bien formés et qui tiennent dans la colonne", () => {
    const ids = PRIVACY_CHANGES.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(id).toMatch(PRIVACY_CHANGE_ID_PATTERN);
      expect(id.length).toBeLessThanOrEqual(PRIVACY_CHANGE_ID_MAX_LENGTH);
    }
  });

  it("a des dates valides, dans l'ordre de publication", () => {
    let previous = "";
    for (const entry of PRIVACY_CHANGES) {
      expect(entry.publishedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${entry.publishedAt}T00:00:00Z`))).toBe(false);
      expect(entry.publishedAt >= previous).toBe(true);
      previous = entry.publishedAt;
    }
  });

  it("a un titre, un résumé et au moins un détail par entrée", () => {
    for (const entry of PRIVACY_CHANGES) {
      expect(entry.title.trim()).not.toBe("");
      expect(entry.summary.trim()).not.toBe("");
      expect(entry.details.length).toBeGreaterThan(0);
      for (const detail of entry.details) expect(detail.trim()).not.toBe("");
    }
  });

  it("tient dans un seul message Discord, registre entier compris", () => {
    const message = buildPrivacyChangesMessage(PRIVACY_CHANGES, "https://bluegenji.fr");
    expect(message.length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    for (const entry of PRIVACY_CHANGES) expect(message).toContain(entry.title);
  });
});

describe("pendingPrivacyChanges", () => {
  it("cumule tous les changements non acceptés, dans l'ordre du registre", () => {
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", [], REGISTRY)).toEqual([A, B, C]);
  });

  it("retire ceux déjà acceptés", () => {
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", ["b"], REGISTRY)).toEqual([A, C]);
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", ["a", "b", "c"], REGISTRY)).toEqual([]);
  });

  it("ignore les changements publiés le jour de la création du compte ou après", () => {
    // Créé le jour de B : il a consenti à la politique qui contenait déjà B.
    expect(pendingPrivacyChanges("2026-03-05 23:59:59", [], REGISTRY)).toEqual([C]);
    expect(pendingPrivacyChanges("2026-03-04 23:59:59", [], REGISTRY)).toEqual([B, C]);
    expect(pendingPrivacyChanges("2026-07-01 00:00:00", [], REGISTRY)).toEqual([]);
  });

  it("accepte une date ISO", () => {
    expect(pendingPrivacyChanges("2026-03-10T08:00:00.000Z", [], REGISTRY)).toEqual([C]);
  });

  it("date inconnue : tout ce qui n'est pas accepté est dû", () => {
    expect(pendingPrivacyChanges(null, ["a"], REGISTRY)).toEqual([B, C]);
  });

  it("ignore un identifiant accepté qui n'existe plus au registre", () => {
    expect(pendingPrivacyChanges(null, ["zzz"], REGISTRY)).toEqual([A, B, C]);
  });

  it("registre vide : rien à présenter", () => {
    expect(pendingPrivacyChanges(null, [], [])).toEqual([]);
  });
});

describe("checkPrivacyAcknowledgement", () => {
  it("accepte des identifiants connus, dédoublonnés", () => {
    expect(checkPrivacyAcknowledgement(["a", "c", "a"], REGISTRY)).toEqual({ ok: true, ids: ["a", "c"] });
  });

  it.each([
    ["absent", undefined],
    ["pas un tableau", "a"],
    ["vide", []],
    ["élément non textuel", ["a", 3]],
    ["plus long que le registre", ["a", "b", "c", "a"]],
  ])("refuse une demande mal formée (%s)", (_label, value) => {
    expect(checkPrivacyAcknowledgement(value, REGISTRY)).toEqual({ ok: false, error: INVALID_PRIVACY_CHANGES });
  });

  it("refuse un identifiant inconnu plutôt que de l'ignorer", () => {
    expect(checkPrivacyAcknowledgement(["a", "inconnu"], REGISTRY)).toEqual({
      ok: false,
      error: UNKNOWN_PRIVACY_CHANGE,
    });
  });
});

describe("mise en forme", () => {
  it("écrit une date en français, sans fuseau", () => {
    expect(formatPrivacyChangeDate("2026-09-23")).toBe("23 septembre 2026");
    expect(formatPrivacyChangeDate("2026-01-01")).toBe("1 janvier 2026");
    expect(formatPrivacyChangeDate("2026-12-31")).toBe("31 décembre 2026");
  });

  it("dérive la mise à jour de /rgpd de la dernière entrée", () => {
    expect(privacyPolicyUpdatedLabel(REGISTRY)).toBe("juin 2026");
    expect(privacyPolicyUpdatedLabel([])).toBeNull();
    expect(privacyPolicyUpdatedLabel()).toMatch(/^[a-zéû]+ \d{4}$/);
  });

  it("compte les changements dans le titre", () => {
    expect(privacyChangesHeading(1)).toBe("Nos règles de confidentialité ont changé");
    expect(privacyChangesHeading(3)).toBe("3 changements de nos règles de confidentialité");
  });
});

describe("buildPrivacyChangesMessage", () => {
  it("nomme chaque changement, sa date et où décider", () => {
    const message = buildPrivacyChangesMessage([A, C], "https://bluegenji.fr/");
    expect(message).toContain("2 changements");
    expect(message).toContain("**Titre a** (10 janvier 2026) — Résumé a.");
    expect(message).toContain("**Titre c**");
    expect(message).toContain("https://bluegenji.fr/rgpd");
    expect(message).toMatch(/supprimer ton compte/);
  });

  it("parle au singulier pour un seul changement", () => {
    expect(buildPrivacyChangesMessage([A], "https://x.fr")).toContain("nos règles de confidentialité ont changé");
  });

  it("se passe d'adresse quand APP_URL manque, sans inventer de lien", () => {
    const message = buildPrivacyChangesMessage([A], null);
    expect(message).not.toMatch(/https?:/);
    expect(message).toContain("sur le site");
  });

  it("reste sous le plafond du bot et compte ce qui ne tient plus", () => {
    const long = Array.from({ length: 12 }, (_, i) =>
      change(`long-${i}`, "2026-02-01", { summary: "x".repeat(300) }),
    );
    const message = buildPrivacyChangesMessage(long, "https://bluegenji.fr");
    expect(message.length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(message).toMatch(/… et \d+ autre\(s\) changement\(s\)\./);
    expect(message).toContain("Titre long-0");
    expect(message).toContain("https://bluegenji.fr/rgpd");
  });
});

describe("announceablePrivacyChanges", () => {
  it(`ne garde que les ${PRIVACY_DM_WINDOW_DAYS} derniers jours`, () => {
    const now = new Date("2026-07-01T12:00:00Z");
    // 1er juillet − 60 jours = 2 mai : B (5 mars) est sorti, C (20 juin) reste.
    expect(announceablePrivacyChanges(now, REGISTRY)).toEqual([C]);
    expect(announceablePrivacyChanges(new Date("2027-01-01T00:00:00Z"), REGISTRY)).toEqual([]);
  });

  it("inclut la borne exacte", () => {
    const now = new Date(Date.parse("2026-03-05T00:00:00Z") + PRIVACY_DM_WINDOW_DAYS * 86_400_000);
    expect(announceablePrivacyChanges(now, REGISTRY)).toContain(B);
  });
});

describe("anti-spam des messages privés", () => {
  const day = (iso: string, plus = 0) => new Date(Date.parse(`${iso}T12:00:00Z`) + plus * 86_400_000);

  it("le délai et l'intervalle tiennent dans la fenêtre d'annonce", () => {
    // Sinon un changement retenu en sortirait sans avoir jamais été annoncé.
    expect(PRIVACY_DM_SETTLE_DAYS).toBeGreaterThan(0);
    expect(PRIVACY_DM_MIN_INTERVAL_DAYS).toBeGreaterThan(0);
    expect(PRIVACY_DM_SETTLE_DAYS + PRIVACY_DM_MIN_INTERVAL_DAYS).toBeLessThan(PRIVACY_DM_WINDOW_DAYS);
  });

  describe("settledPrivacyChanges", () => {
    it("n'autorise un changement qu'après le délai de la modale, borne comprise", () => {
      expect(settledPrivacyChanges(day(C.publishedAt, PRIVACY_DM_SETTLE_DAYS - 1), [C])).toEqual([]);
      expect(settledPrivacyChanges(day(C.publishedAt, PRIVACY_DM_SETTLE_DAYS), [C])).toEqual([C]);
    });

    it("rien le jour de la publication", () => {
      expect(settledPrivacyChanges(day(C.publishedAt), REGISTRY)).toEqual([A, B]);
    });
  });

  describe("privacyDmBatch", () => {
    const burst = [change("x", "2026-09-23"), change("y", "2026-09-24"), change("z", "2026-09-25")];

    it("ne rend rien tant qu'aucun changement dû n'a passé le délai", () => {
      expect(privacyDmBatch(burst, day("2026-09-25", 3))).toEqual([]);
    });

    it("regroupe une rafale : tout part avec le plus ancien, récents compris", () => {
      expect(privacyDmBatch(burst, day("2026-09-23", PRIVACY_DM_SETTLE_DAYS))).toEqual(burst);
    });

    it("un changement accepté entre-temps ne déclenche plus rien", () => {
      // Le 23 est acquitté : il reste deux changements trop récents.
      expect(privacyDmBatch(burst.slice(1), day("2026-09-23", PRIVACY_DM_SETTLE_DAYS))).toEqual([]);
    });

    it("rien à envoyer à qui n'a rien de dû", () => {
      expect(privacyDmBatch([], day("2027-01-01"))).toEqual([]);
    });
  });
});
