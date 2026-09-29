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
  LOGO_QUARANTINE_MONTHS,
  MODERATION_TERMS_ANCHOR,
  canAutoPurgeLogo,
  moderationGroundsFor,
  formatAvatarHiddenLog,
  formatAvatarHiddenNotice,
  formatAvatarRemovedNotice,
  formatAvatarRestoredNotice,
  formatLogoHiddenLog,
  formatLogoHiddenNotice,
  formatLogoRemovedNotice,
  formatLogoRestoredNotice,
  isImmediateLogoRemoval,
  formatQuarantineDate,
  logoQuarantinePurgeDate,
} from "@/lib/shared/logo-quarantine";

const TERMS_URL = `https://site.test${TERMS_PATH}#contenus`;

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
    expect(text).toContain(`${LOGO_QUARANTINE_MONTHS} mois`);
    expect(text).toContain("rétabli");
    expect(text).not.toContain("en écrivant à l'association");
  });

  it("date la version courante en toutes lettres", () => {
    expect(TERMS_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(formatTermsDate("2026-09-24")).toBe("24 septembre 2026");
  });
});

describe("quarantaine des logos", () => {
  it("dure six mois civils, comptés au calendrier de Paris", () => {
    expect(LOGO_QUARANTINE_MONTHS).toBe(6);
    // 1er janvier, 1 h à Paris → 1er juillet, 1 h à Paris (heure d'été).
    expect(logoQuarantinePurgeDate(new Date("2026-01-01T00:00:00Z")).toISOString()).toBe("2026-06-30T23:00:00.000Z");
  });

  it("ne tombe jamais avant six mois : 1er mars à Paris, encore le 28 février en UTC", () => {
    // 180 jours finissaient le 27 août ; six mois au calendrier UTC, le 29.
    const purge = logoQuarantinePurgeDate(new Date("2026-02-28T23:30:00Z"));
    expect(purge.toISOString()).toBe("2026-08-31T22:30:00.000Z");
    expect(formatQuarantineDate(purge)).toBe("1 septembre 2026");
  });

  it("allonge le délai quand le quantième manque au mois d'arrivée, sans jamais le raccourcir", () => {
    // 31 août + 6 mois : pas de 31 février, le délai déborde au 3 mars.
    expect(logoQuarantinePurgeDate(new Date("2026-08-31T10:00:00.250Z")).toISOString()).toBe("2027-03-03T11:00:00.250Z");
  });

  it("donne toujours au moins six mois, à toute heure de l'année", () => {
    const day = 24 * 60 * 60 * 1000;
    for (let t = Date.UTC(2026, 0, 1); t < Date.UTC(2027, 0, 1); t += 3 * 60 * 60 * 1000 + 17 * 60 * 1000) {
      const span = logoQuarantinePurgeDate(new Date(t)).getTime() - t;
      // Six mois civils durent entre 181 et 184 jours, un débordement en ajoute
      // trois au plus ; une heure de changement d'heure se lit en plus ou moins.
      expect(span).toBeGreaterThanOrEqual(181 * day - 60 * 60 * 1000);
      expect(span).toBeLessThanOrEqual(187 * day + 60 * 60 * 1000);
    }
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
      grounds: "THIRD_PARTY_RIGHTS",
      termsUrl: TERMS_URL,
    });
    expect(notice).toContain("« Alpha »");
    expect(notice).toContain("30 juin 2026");
    expect(notice).toContain("https://site.test/signalements/4");
    expect(formatLogoRestoredNotice({ teamName: "Alpha" })).toContain("rétabli");
  });

  it("expose les motifs de la décision : décision, motif, faits, mode, fondement, recours (DSA art. 17.3)", () => {
    const notice = formatLogoHiddenNotice({
      teamName: "Alpha",
      purgeAfter: new Date("2026-06-30T10:00:00Z"),
      url: "https://site.test/signalements/4",
      grounds: "THIRD_PARTY_RIGHTS",
      termsUrl: TERMS_URL,
    });
    expect(notice).toContain("n'est plus en ligne, mais il est conservé");
    expect(notice).toContain("Motif : atteinte présumée au droit d'auteur");
    expect(notice).toContain("Faits retenus : un signalement");
    expect(notice).toContain("sans traitement automatisé");
    expect(notice).toContain(`Fondement : conditions d'utilisation, « Contenus publiés par les membres »`);
    expect(notice).toContain(TERMS_URL);
    expect(notice).toContain("contestez la décision ici : https://site.test/signalements/4");
    expect(notice).toContain("si vous en détenez les droits");
    expect(notice).toContain("devant le juge compétent");
  });

  it("adapte le motif et la réponse proposée à ce qui est reproché", () => {
    const rules = formatLogoHiddenNotice({
      teamName: "Alpha",
      purgeAfter: new Date("2026-06-30T10:00:00Z"),
      url: "https://site.test/signalements/4",
      grounds: "SITE_RULES",
      termsUrl: TERMS_URL,
    });
    expect(rules).toContain("Motif : image jugée contraire aux conditions d'utilisation");
    expect(rules).toContain("« Comportement »");
    expect(rules).toContain("si vous estimez que l'image respecte les règles");
    expect(rules).not.toContain("droits");
  });

  it("tire le fondement de la catégorie du signalement", () => {
    expect(moderationGroundsFor("COPYRIGHT")).toBe("THIRD_PARTY_RIGHTS");
    expect(moderationGroundsFor("MODERATION")).toBe("SITE_RULES");
    expect(moderationGroundsFor("OTHER")).toBe("SITE_RULES");
    // Hors de tout signalement : les règles du site.
    expect(moderationGroundsFor(null)).toBe("SITE_RULES");
  });

  it("cite une clause qui existe dans les conditions d'utilisation", () => {
    const clause = TERMS_SECTIONS.find((section) => section.id === MODERATION_TERMS_ANCHOR);
    expect(clause?.title).toBe("Contenus publiés par les membres");
    expect(TERMS_SECTIONS.some((section) => section.title === "Comportement")).toBe(true);
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
    const linked = formatLogoRemovedNotice({
      teamName: "Alpha",
      url: "https://site.test/signalements/12",
      grounds: "THIRD_PARTY_RIGHTS",
      termsUrl: TERMS_URL,
    });
    expect(linked).toContain("« Alpha »");
    expect(linked).toContain("à la suite d'un signalement");
    expect(linked).toContain("https://site.test/signalements/12");
    expect(linked).toContain("Faits retenus : un signalement");
    expect(linked).toContain("devant le juge compétent");

    const standalone = formatLogoRemovedNotice({ teamName: "Alpha", url: null, grounds: "SITE_RULES", termsUrl: TERMS_URL });
    expect(standalone).not.toContain("à la suite d'un signalement");
    expect(standalone).toContain("Signaler un problème");
    expect(standalone).toContain("Faits retenus : constat de la modération, sans signalement préalable");
    expect(standalone).toContain(TERMS_URL);
    expect(standalone).not.toContain("/signalements/");
    expect(standalone).toContain("devant le juge compétent");
  });
});

describe("quarantaine des avatars — jamais le pseudo du joueur sur Discord", () => {
  it("dit au joueur ce qui arrive, au singulier, sans nommer l'auteur du signalement", () => {
    const hidden = formatAvatarHiddenNotice({
      purgeAfter: new Date("2026-06-30T10:00:00Z"),
      url: "https://site.test/signalements/4",
      grounds: "THIRD_PARTY_RIGHTS",
      termsUrl: TERMS_URL,
    });
    expect(hidden).toContain("Ton avatar");
    expect(hidden).toContain("30 juin 2026");
    expect(hidden).toContain("https://site.test/signalements/4");
    expect(hidden).toContain("conteste la décision ici");
    expect(hidden).toContain("si tu en détiens les droits");
    expect(hidden).toContain("Tu peux aussi porter la décision devant le juge compétent.");
    expect(hidden).not.toMatch(/\bvous\b/);
    expect(formatAvatarRestoredNotice()).toContain("rétabli");
  });

  it("prévient le joueur avec le lien du signalement, ou le renvoie vers l'association", () => {
    const linked = formatAvatarRemovedNotice({
      url: "https://site.test/signalements/12",
      grounds: "SITE_RULES",
      termsUrl: TERMS_URL,
    });
    expect(linked).toContain("Ton avatar");
    expect(linked).toContain("à la suite d'un signalement");
    expect(linked).toContain("https://site.test/signalements/12");
    expect(linked).toContain("si tu estimes que l'image respecte les règles");

    const standalone = formatAvatarRemovedNotice({ url: null, grounds: "SITE_RULES", termsUrl: TERMS_URL });
    expect(standalone).not.toContain("à la suite d'un signalement");
    expect(standalone).toContain("écris à l'association (« Signaler un problème »");
    expect(standalone).not.toContain("/signalements/");
    expect(standalone).not.toMatch(/\bvous\b/);
  });

  it("journalise le masquage sans jamais nommer le joueur (lib/shared/log-privacy.ts)", () => {
    // Contrairement à `formatLogoHiddenLog`, qui peut nommer une équipe : un
    // message Discord ne porte jamais le pseudo d'un joueur, et la fonction ne
    // prend même pas de paramètre par lequel un appelant pourrait lui en glisser un.
    expect(formatAvatarHiddenLog({ reportId: 4, purgeAfter: new Date("2026-06-30T10:00:00Z") })).toBe(
      "🙈 Avatar d'un joueur masqué par le staff (signalement #4), suppression définitive le 30 juin 2026 sans contestation.",
    );
  });
});
