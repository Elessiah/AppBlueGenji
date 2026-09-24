import { describe, expect, it } from "@jest/globals";
import {
  CONTESTABLE_TARGET_TYPES,
  PRIMARY_REPORT_CATEGORIES,
  REPORT_CATEGORIES,
  REPORT_CATEGORY_DEFINITIONS,
  REPORT_DESCRIPTION_MAX_LENGTH,
  REPORT_DESCRIPTION_MIN_LENGTH,
  REPORT_MAX_TARGETS,
  REPORT_PRIVACY_NOTICE,
  REPORT_RETENTION_DAYS_AFTER_RESOLUTION,
  formatContestAlert,
  formatReportAlert,
  formatTargetNotice,
  isConcernedByReport,
  isPlausibleEmail,
  isReportAction,
  nextReportStatus,
  normalizeReportPagePath,
  reportAdminHref,
  reportConcernedHref,
  reportErrorMessage,
  reportPurgeDate,
  reportRetainedUntil,
  reportTargetFromPath,
  reportTargetHref,
  validateReportSubmission,
  type ReportAction,
  type ReportStatus,
} from "@/lib/shared/content-reports";

const DESCRIPTION = "Le logo de cette équipe reprend celui de notre club, déposé.";

function copyright(overrides: Record<string, unknown> = {}) {
  return {
    category: "COPYRIGHT",
    description: DESCRIPTION,
    targets: [{ type: "TEAM", id: 4 }],
    contactName: "Club Exemple",
    contactEmail: "Juridique@Exemple.fr",
    rightsRelation: "HOLDER",
    goodFaith: true,
    consent: true,
    pagePath: "/equipes/4",
    ...overrides,
  };
}

describe("validateReportSubmission — cas nominaux", () => {
  it("normalise un signalement de droit d'auteur complet", () => {
    const result = validateReportSubmission(copyright());
    expect(result).toEqual({
      ok: true,
      value: {
        category: "COPYRIGHT",
        description: DESCRIPTION,
        targets: [{ type: "TEAM", id: 4 }],
        pagePath: "/equipes/4",
        contactName: "Club Exemple",
        // L'adresse est ramenée en minuscules : c'est une clé de contact.
        contactEmail: "juridique@exemple.fr",
        rightsRelation: "HOLDER",
        parentReportId: null,
      },
    });
  });

  it("accepte un bug sans cible ni contact, et ne garde pas un nom que la catégorie ne demande pas", () => {
    const result = validateReportSubmission({
      category: "BUG",
      description: "Le bouton d'inscription ne répond plus depuis ce matin.",
      contactName: "Nova",
      consent: true,
    });
    expect(result.ok && result.value.contactName).toBeNull();
    expect(result.ok && result.value.targets).toEqual([]);
  });

  it("dédoublonne les cibles et accepte un identifiant numérique en chaîne", () => {
    const result = validateReportSubmission(
      copyright({ targets: [{ type: "USER", id: "8" }, { type: "USER", id: 8 }, { type: "TOURNAMENT", id: 2 }] }),
    );
    expect(result.ok && result.value.targets).toEqual([
      { type: "USER", id: 8 },
      { type: "TOURNAMENT", id: 2 },
    ]);
  });

  it("retire les caractères de contrôle mais garde les sauts de ligne de la description", () => {
    const result = validateReportSubmission(copyright({ description: `  ${DESCRIPTION}\n\u0007Seconde ligne.  ` }));
    expect(result.ok && result.value.description).toBe(`${DESCRIPTION}\nSeconde ligne.`);
  });

  it("rattache une contestation à son signalement, et à lui seul", () => {
    const contest = validateReportSubmission({
      category: "CONTEST",
      parentReportId: "12",
      description: "Nous détenons les droits : le logo a été dessiné par notre capitaine.",
      consent: true,
    });
    expect(contest.ok && contest.value.parentReportId).toBe(12);

    // Hors contestation, le lien est ignoré : un signalement ordinaire ne se
    // range pas sous un autre.
    const other = validateReportSubmission(copyright({ parentReportId: 12 }));
    expect(other.ok && other.value.parentReportId).toBeNull();
  });
});

describe("validateReportSubmission — refus", () => {
  it.each<[string, Record<string, unknown>, string]>([
    ["catégorie inconnue", { category: "SPAM" }, "REPORT_INVALID_CATEGORY"],
    ["cible mal formée", { targets: [{ type: "TEAM", id: -1 }] }, "REPORT_INVALID_TARGET"],
    ["cibles qui ne sont pas une liste", { targets: "TEAM:4" }, "REPORT_INVALID_TARGET"],
    ["type de cible inconnu", { targets: [{ type: "MATCH", id: 3 }] }, "REPORT_INVALID_TARGET"],
    [
      "description trop courte",
      { description: "x".repeat(REPORT_DESCRIPTION_MIN_LENGTH - 1) },
      "REPORT_DESCRIPTION_TOO_SHORT",
    ],
    [
      "description trop longue",
      { description: "x".repeat(REPORT_DESCRIPTION_MAX_LENGTH + 1) },
      "REPORT_DESCRIPTION_TOO_LONG",
    ],
    ["nom manquant", { contactName: "  " }, "REPORT_CONTACT_REQUIRED"],
    ["adresse manquante", { contactEmail: "" }, "REPORT_CONTACT_REQUIRED"],
    ["nom trop long", { contactName: "n".repeat(121) }, "REPORT_CONTACT_TOO_LONG"],
    ["adresse invalide", { contactEmail: "pas-une-adresse" }, "REPORT_INVALID_EMAIL"],
    ["qualité manquante", { rightsRelation: undefined }, "REPORT_RIGHTS_RELATION_REQUIRED"],
    ["qualité inconnue", { rightsRelation: "OWNER" }, "REPORT_RIGHTS_RELATION_REQUIRED"],
    ["bonne foi non déclarée", { goodFaith: false }, "REPORT_GOOD_FAITH_REQUIRED"],
    ["bonne foi non booléenne", { goodFaith: "oui" }, "REPORT_GOOD_FAITH_REQUIRED"],
    ["consentement absent", { consent: undefined }, "REPORT_CONSENT_REQUIRED"],
    ["consentement non strict", { consent: "true" }, "REPORT_CONSENT_REQUIRED"],
  ])("%s", (_label, overrides, error) => {
    expect(validateReportSubmission(copyright(overrides))).toEqual({ ok: false, error });
  });

  it("refuse une cible que la catégorie ne permet pas de désigner", () => {
    expect(
      validateReportSubmission({
        category: "MODERATION",
        description: DESCRIPTION,
        targets: [{ type: "TOURNAMENT", id: 1 }],
        consent: true,
      }),
    ).toEqual({ ok: false, error: "REPORT_TARGET_NOT_ALLOWED" });
    expect(
      validateReportSubmission({ category: "BUG", description: DESCRIPTION, targets: [{ type: "USER", id: 1 }], consent: true }),
    ).toEqual({ ok: false, error: "REPORT_TARGET_NOT_ALLOWED" });
  });

  it(`refuse plus de ${REPORT_MAX_TARGETS} cibles`, () => {
    const targets = Array.from({ length: REPORT_MAX_TARGETS + 1 }, (_, index) => ({ type: "USER", id: index + 1 }));
    expect(validateReportSubmission(copyright({ targets }))).toEqual({ ok: false, error: "REPORT_TOO_MANY_TARGETS" });
  });

  it("exige le signalement contesté d'une contestation", () => {
    for (const parentReportId of [undefined, 0, -3, "abc", 1.5]) {
      expect(
        validateReportSubmission({ category: "CONTEST", description: DESCRIPTION, consent: true, parentReportId }),
      ).toEqual({ ok: false, error: "REPORT_PARENT_REQUIRED" });
    }
  });

  it("refuse une contestation qui désigne des cibles", () => {
    expect(
      validateReportSubmission({
        category: "CONTEST",
        parentReportId: 3,
        description: DESCRIPTION,
        targets: [{ type: "TEAM", id: 1 }],
        consent: true,
      }),
    ).toEqual({ ok: false, error: "REPORT_TARGET_NOT_ALLOWED" });
  });

  it("résiste à un corps qui n'est pas un objet", () => {
    for (const body of [null, undefined, "texte", 42, []]) {
      expect(validateReportSubmission(body).ok).toBe(false);
    }
  });
});

describe("normalizeReportPagePath", () => {
  it("garde un chemin du site", () => {
    expect(normalizeReportPagePath("/equipes/4")).toBe("/equipes/4");
    expect(normalizeReportPagePath(" /tournois/2?onglet=plateau ")).toBe("/tournois/2?onglet=plateau");
  });

  it.each([
    "https://exemple.invalid/x",
    "//exemple.invalid",
    "/\\exemple.invalid",
    "equipes/4",
    "/avec espace",
    "/saut\nde-ligne",
    "",
    `/${"a".repeat(400)}`,
  ])("écarte ce qui n'est pas un chemin du site : %p", (value) => {
    expect(normalizeReportPagePath(value)).toBeNull();
  });

  it("écarte ce qui n'est pas une chaîne", () => {
    expect(normalizeReportPagePath(42)).toBeNull();
    expect(normalizeReportPagePath(undefined)).toBeNull();
  });
});

describe("isPlausibleEmail", () => {
  it.each(["a@b.fr", "prenom.nom+tag@exemple.co.uk"])("accepte %s", (value) => {
    expect(isPlausibleEmail(value)).toBe(true);
  });
  it.each(["a@b", "@b.fr", "a b@c.fr", `${"a".repeat(190)}@b.fr`])("refuse %s", (value) => {
    expect(isPlausibleEmail(value)).toBe(false);
  });
});

describe("cycle de vie", () => {
  const cases: [ReportStatus, ReportAction, ReportStatus | null][] = [
    ["OPEN", "TAKE", "IN_PROGRESS"],
    ["IN_PROGRESS", "TAKE", null],
    ["RESOLVED", "TAKE", null],
    ["IN_PROGRESS", "RELEASE", "OPEN"],
    ["OPEN", "RELEASE", null],
    ["OPEN", "RESOLVE", "RESOLVED"],
    ["IN_PROGRESS", "RESOLVE", "RESOLVED"],
    ["RESOLVED", "RESOLVE", null],
    ["RESOLVED", "REOPEN", "OPEN"],
    ["OPEN", "REOPEN", null],
  ];
  it.each(cases)("%s + %s → %s", (current, action, next) => {
    expect(nextReportStatus(current, action)).toBe(next);
  });

  it("reconnaît les seuls gestes du panneau", () => {
    expect(["TAKE", "RELEASE", "RESOLVE", "REOPEN"].every(isReportAction)).toBe(true);
    expect(isReportAction("DELETE")).toBe(false);
  });

  it(`efface un signalement ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa résolution`, () => {
    expect(reportPurgeDate(new Date("2026-09-01T10:00:00Z")).toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("repousse l'effacement annoncé tant qu'un logo masqué ou supprimé tient au dossier", () => {
    const resolvedAt = new Date("2026-09-01T10:00:00Z");
    const later = "2027-02-28T10:00:00.000Z";
    expect(reportRetainedUntil(resolvedAt, []).toISOString()).toBe("2026-10-01T10:00:00.000Z");
    expect(reportRetainedUntil(resolvedAt, [{ status: "HIDDEN", purgeAfter: later }]).toISOString()).toBe(later);
    expect(reportRetainedUntil(resolvedAt, [{ status: "PURGED", purgeAfter: later }]).toISOString()).toBe(later);
    // Rétabli : plus rien à contester, le signalement suit la règle ordinaire.
    expect(reportRetainedUntil(resolvedAt, [{ status: "RESTORED", purgeAfter: later }]).toISOString()).toBe(
      "2026-10-01T10:00:00.000Z",
    );
    // Une échéance déjà dépassée ne raccourcit rien.
    expect(
      reportRetainedUntil(resolvedAt, [{ status: "PURGED", purgeAfter: "2026-09-02T10:00:00.000Z" }]).toISOString(),
    ).toBe("2026-10-01T10:00:00.000Z");
  });
});

describe("adresses", () => {
  it("déduit la cible de la fiche d'où l'on signale", () => {
    expect(reportTargetFromPath("/equipes/12")).toEqual({ type: "TEAM", id: 12 });
    expect(reportTargetFromPath("/joueurs/3/")).toEqual({ type: "USER", id: 3 });
    expect(reportTargetFromPath("/tournois/9")).toEqual({ type: "TOURNAMENT", id: 9 });
  });

  it.each(["/equipes", "/equipes/creer", "/tournois/9/modifier", "/equipes/0", null, undefined, ""])(
    "ne déduit rien d'une autre page : %p",
    (path) => {
      expect(reportTargetFromPath(path)).toBeNull();
    },
  );

  it("mène aux fiches, au panneau et à la page des personnes visées", () => {
    expect(reportTargetHref({ type: "TEAM", id: 1 })).toBe("/equipes/1");
    expect(reportTargetHref({ type: "USER", id: 2 })).toBe("/joueurs/2");
    expect(reportTargetHref({ type: "TOURNAMENT", id: 3 })).toBe("/tournois/3");
    expect(reportAdminHref(7)).toBe("/admin/signalements?id=7");
    expect(reportConcernedHref(7)).toBe("/signalements/7");
  });
});

describe("messages Discord — aucun joueur nommé", () => {
  it("compte les joueurs, nomme équipes et tournois, et mène au dossier", () => {
    const line = formatReportAlert({
      id: 12,
      category: "COPYRIGHT",
      targets: [
        { type: "USER", label: null },
        { type: "USER", label: null },
        { type: "TEAM", label: "Alpha" },
        { type: "TOURNAMENT", label: "Coupe d'automne" },
      ],
      fromMember: false,
      adminUrl: "https://site.test/admin/signalements?id=12",
    });
    expect(line).toBe(
      "🚩 Signalement #12 · Droit d'auteur — 2 joueurs, 1 équipe (Alpha), 1 tournoi (Coupe d'automne). " +
        "Envoyé par un visiteur. À traiter : https://site.test/admin/signalements?id=12",
    );
  });

  it("ne nomme jamais un joueur, même si un libellé lui parvient", () => {
    const line = formatReportAlert({
      id: 3,
      category: "MODERATION",
      targets: [{ type: "USER", label: "PseudoSecret" }],
      fromMember: true,
      adminUrl: "https://site.test/x",
    });
    expect(line).not.toContain("PseudoSecret");
    expect(line).toContain("1 joueur");
    expect(line).toContain("un membre");
  });

  it("dit un signalement sans cible sans liste vide", () => {
    expect(
      formatReportAlert({ id: 1, category: "BUG", targets: [], fromMember: true, adminUrl: "u" }),
    ).toBe("🚩 Signalement #1 · Bug. Envoyé par un membre. À traiter : u");
  });

  it("prévient les personnes visées sans nommer personne", () => {
    const notice = formatTargetNotice({ category: "COPYRIGHT", url: "https://site.test/signalements/4" });
    expect(notice).toContain("Droit d'auteur");
    expect(notice).toContain("https://site.test/signalements/4");
    expect(notice).toContain("aucune décision");
  });

  it("annonce une contestation, et la réactivation d'un dossier archivé", () => {
    const reopened = formatContestAlert({
      contestId: 20,
      parentId: 8,
      parentCategory: "MODERATION",
      reopened: true,
      adminUrl: "https://site.test/admin/signalements?id=8",
    });
    expect(reopened).toContain("Contestation #20 du signalement #8 (Modération)");
    expect(reopened).toContain("réactivé");
    expect(
      formatContestAlert({ contestId: 1, parentId: 2, parentCategory: "BUG", reopened: false, adminUrl: "u" }),
    ).not.toContain("réactivé");
  });
});

describe("isConcernedByReport", () => {
  const viewer = { userId: 5, teamIds: [30, 31] };

  it("vise le joueur désigné et les membres des équipes désignées", () => {
    expect(isConcernedByReport(viewer, { category: "COPYRIGHT", targets: [{ type: "USER", id: 5 }] })).toBe(true);
    expect(isConcernedByReport(viewer, { category: "MODERATION", targets: [{ type: "TEAM", id: 31 }] })).toBe(true);
  });

  it("ne vise ni un autre joueur, ni une autre équipe, ni un tournoi", () => {
    expect(
      isConcernedByReport(viewer, {
        category: "COPYRIGHT",
        targets: [
          { type: "USER", id: 6 },
          { type: "TEAM", id: 99 },
          // Un tournoi porte l'identifiant 5 : ce n'est pas le joueur 5.
          { type: "TOURNAMENT", id: 5 },
        ],
      }),
    ).toBe(false);
  });

  it("ne laisse pas contester une contestation", () => {
    expect(isConcernedByReport(viewer, { category: "CONTEST", targets: [{ type: "USER", id: 5 }] })).toBe(false);
  });

  it("ne donne la parole qu'aux joueurs et aux équipes", () => {
    expect(CONTESTABLE_TARGET_TYPES).toEqual(["USER", "TEAM"]);
  });
});

describe("registre des catégories", () => {
  it("décrit chaque catégorie, et seule la contestation est hors des catégories d'origine", () => {
    for (const category of REPORT_CATEGORIES) {
      expect(REPORT_CATEGORY_DEFINITIONS[category].label.length).toBeGreaterThan(0);
    }
    expect(PRIMARY_REPORT_CATEGORIES).toEqual(["COPYRIGHT", "MODERATION", "BUG", "OTHER"]);
  });

  it("n'exige nom et qualité que du droit d'auteur", () => {
    const demanding = REPORT_CATEGORIES.filter((category) => REPORT_CATEGORY_DEFINITIONS[category].requiresContact);
    expect(demanding).toEqual(["COPYRIGHT"]);
  });

  it("annonce au signalant que sa description sera lue des personnes visées, jamais son identité", () => {
    expect(REPORT_PRIVACY_NOTICE.recipients).toContain("peuvent lire ta description");
    expect(REPORT_PRIVACY_NOTICE.recipients).toContain("jamais ton nom");
    expect(REPORT_PRIVACY_NOTICE.retention).toContain(`${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours`);
  });
});

describe("reportErrorMessage", () => {
  it.each([
    "REPORT_INVALID_CATEGORY",
    "REPORT_DESCRIPTION_TOO_SHORT",
    "REPORT_DESCRIPTION_TOO_LONG",
    "REPORT_INVALID_TARGET",
    "REPORT_TARGET_NOT_FOUND",
    "REPORT_TARGET_NOT_ALLOWED",
    "REPORT_TOO_MANY_TARGETS",
    "REPORT_CONTACT_REQUIRED",
    "REPORT_CONTACT_TOO_LONG",
    "REPORT_INVALID_EMAIL",
    "REPORT_RIGHTS_RELATION_REQUIRED",
    "REPORT_GOOD_FAITH_REQUIRED",
    "REPORT_CONSENT_REQUIRED",
    "REPORT_PARENT_REQUIRED",
    "REPORT_CONTEST_LOGIN_REQUIRED",
    "REPORT_NOT_CONCERNED",
    "REPORTS_SATURATED",
    "TOO_MANY_REQUESTS",
  ])("dit %s en français, sans le jeton", (code) => {
    const message = reportErrorMessage(code);
    expect(message).not.toContain(code);
    expect(message).not.toBe(reportErrorMessage("INCONNU"));
  });

  it("retombe sur une phrase pour un code inconnu ou absent", () => {
    expect(reportErrorMessage(undefined)).toMatch(/Réessaie/);
    expect(reportErrorMessage("BOOM")).toMatch(/Réessaie/);
  });
});
