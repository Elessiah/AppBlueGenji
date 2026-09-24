import { describe, expect, it } from "@jest/globals";
import {
  LOGO_RIGHTS_TERMS_ANCHOR,
  TERMS_ACCEPTANCE_CONTEXTS,
  TERMS_PATH,
  TERMS_SECTIONS,
  TERMS_UPDATED_AT,
  TERMS_VERSION,
  coversCurrentTerms,
  formatTermsDate,
  isTermsAcceptanceContext,
} from "@/lib/shared/terms-of-use";
import {
  LOGO_QUARANTINE_DAYS,
  canAutoPurgeLogo,
  formatLogoHiddenLog,
  formatLogoHiddenNotice,
  formatLogoRemovedNotice,
  formatLogoRestoredNotice,
  isImmediateLogoRemoval,
  formatQuarantineDate,
  logoQuarantinePurgeDate,
} from "@/lib/shared/logo-quarantine";

describe("conditions d'utilisation", () => {
  it("tient une acceptation pour valable à la version courante ou au-delà, jamais en deçà", () => {
    expect(coversCurrentTerms(TERMS_VERSION)).toBe(true);
    expect(coversCurrentTerms(TERMS_VERSION + 1)).toBe(true);
    expect(coversCurrentTerms(TERMS_VERSION - 1)).toBe(false);
    expect(coversCurrentTerms(null)).toBe(false);
    expect(coversCurrentTerms(undefined)).toBe(false);
  });

  it("reconnaît les quatre écrans d'acceptation", () => {
    expect(TERMS_ACCEPTANCE_CONTEXTS).toEqual(["SIGNUP", "LOGIN", "TEAM_CREATION", "TEAM_MANAGEMENT"]);
    expect(isTermsAcceptanceContext("LOGIN")).toBe(true);
    expect(isTermsAcceptanceContext("ADMIN")).toBe(false);
  });

  it("donne une ancre unique à chaque section, dont celles que d'autres écrans citent", () => {
    const ids = TERMS_SECTIONS.map((section) => section.id);
    expect(new Set(ids).size).toBe(ids.length);
    // La case du logo et le formulaire de signalement renvoient à ces deux-là.
    expect(ids).toEqual(expect.arrayContaining(["contenus", "signalement"]));
    expect(LOGO_RIGHTS_TERMS_ANCHOR).toBe(`${TERMS_PATH}#contenus`);
  });

  it("ne rédige aucune section vide, et n'emploie que le gras comme marque", () => {
    for (const section of TERMS_SECTIONS) {
      expect(section.paragraphs.length).toBeGreaterThan(0);
      for (const paragraph of section.paragraphs) {
        // Un nombre pair de `**` : aucune marque laissée ouverte.
        expect((paragraph.match(/\*\*/g) ?? []).length % 2).toBe(0);
      }
    }
  });

  it("décrit le processus de contestation que le site offre réellement", () => {
    // La page d'un signalement y renvoie (« Comment se passe un signalement ? ») :
    // elle doit y lire le chemin qu'elle vient de quitter, pas un autre.
    const text = TERMS_SECTIONS.find((section) => section.id === "signalement")!.paragraphs.join(" ");
    expect(text).toContain("message privé Discord");
    expect(text).toContain("« Contestation »");
    expect(text).toContain(`${LOGO_QUARANTINE_DAYS / 30} mois`);
    expect(text).toContain("rétabli");
    expect(text).not.toContain("en écrivant à l'association");
  });

  it("date la version courante en toutes lettres", () => {
    expect(TERMS_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatTermsDate("2026-09-24")).toBe("24 septembre 2026");
  });
});

describe("quarantaine des logos", () => {
  it("dure six mois, le délai de contestation du DSA", () => {
    expect(LOGO_QUARANTINE_DAYS).toBe(180);
    expect(logoQuarantinePurgeDate(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-06-30T00:00:00.000Z");
  });

  const due = new Date("2026-06-30T00:00:00Z");
  const after = new Date("2026-07-01T00:00:00Z");
  const before = new Date("2026-06-01T00:00:00Z");

  it("ne supprime rien avant l'échéance", () => {
    expect(canAutoPurgeLogo({ purgeAfter: due, now: before, contested: false, reportSettled: true })).toBe(false);
  });

  it("supprime à l'échéance ce que personne n'a contesté", () => {
    expect(canAutoPurgeLogo({ purgeAfter: due, now: after, contested: false, reportSettled: false })).toBe(true);
    expect(canAutoPurgeLogo({ purgeAfter: due, now: due, contested: false, reportSettled: false })).toBe(true);
  });

  it("garde un logo contesté tant que l'association n'a pas tranché", () => {
    expect(canAutoPurgeLogo({ purgeAfter: due, now: after, contested: true, reportSettled: false })).toBe(false);
    expect(canAutoPurgeLogo({ purgeAfter: due, now: after, contested: true, reportSettled: true })).toBe(true);
  });

  it("date l'échéance à l'heure de Paris, quel que soit le fuseau du serveur", () => {
    // 23 h 30 UTC le 29 : déjà le 30 à Paris (UTC+2 en été).
    expect(formatQuarantineDate(new Date("2026-06-29T23:30:00Z"))).toBe("30 juin 2026");
  });

  it("dit à l'équipe ce qui arrive, quand, et comment l'empêcher — sans nommer l'auteur du signalement", () => {
    const notice = formatLogoHiddenNotice({
      teamName: "Alpha",
      purgeAfter: new Date("2026-06-30T10:00:00Z"),
      url: "https://site.test/signalements/4",
    });
    expect(notice).toContain("« Alpha »");
    expect(notice).toContain("30 juin 2026");
    expect(notice).toContain("https://site.test/signalements/4");
    expect(formatLogoRestoredNotice({ teamName: "Alpha" })).toContain("rétabli");
  });

  it("journalise le masquage sous le nom de l'équipe et le numéro du signalement", () => {
    expect(formatLogoHiddenLog({ teamName: "Alpha", reportId: 4, purgeAfter: new Date("2026-06-30T10:00:00Z") })).toBe(
      "🙈 Logo de l'équipe « Alpha » masqué par le staff (signalement #4), suppression définitive le 30 juin 2026 sans contestation.",
    );
  });
});

describe("suppression sans délai d'un logo", () => {
  const at = "2026-09-24T10:00:00.000Z";

  it("se reconnaît à une quarantaine close à l'instant de son ouverture", () => {
    expect(isImmediateLogoRemoval({ status: "PURGED", hiddenAt: at, closedAt: at })).toBe(true);
    // Masqué puis supprimé plus tard, rétabli, ou encore masqué : non.
    expect(isImmediateLogoRemoval({ status: "PURGED", hiddenAt: at, closedAt: "2026-10-01T10:00:00.000Z" })).toBe(false);
    expect(isImmediateLogoRemoval({ status: "RESTORED", hiddenAt: at, closedAt: at })).toBe(false);
    expect(isImmediateLogoRemoval({ status: "HIDDEN", hiddenAt: at, closedAt: null })).toBe(false);
  });

  it("prévient l'équipe avec le lien du signalement, ou la renvoie vers l'association", () => {
    const linked = formatLogoRemovedNotice({ teamName: "Alpha", url: "https://site.test/signalements/12" });
    expect(linked).toContain("« Alpha »");
    expect(linked).toContain("à la suite d'un signalement");
    expect(linked).toContain("https://site.test/signalements/12");

    const standalone = formatLogoRemovedNotice({ teamName: "Alpha", url: null });
    expect(standalone).not.toContain("signalement.");
    expect(standalone).toContain("Signaler un problème");
    expect(standalone).not.toContain("https://");
  });
});
