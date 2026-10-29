import { TERMS_FREE_PATHS } from "@/lib/shared/global-modals";
import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_CONTACT_NAME, DATA_CONTACT_ROLE } from "@/lib/shared/legal-contact";
import { SUSPENSION_RETENTION_MONTHS } from "@/lib/shared/account-suspension";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/lib/shared/content-reports";
import {
  BOT_FEED_EVENT_RETENTION_DAYS,
  BOT_STAFF_LOG_RETENTION_DAYS,
  SUPPORT_TICKET_RETENTION_MONTHS,
  WEB_ACCESS_LOG_RETENTION_DAYS,
  PROCESSING_ACTIVITIES,
} from "@/lib/shared/processing-register";
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
import { SITE_MINIMUM_AGE, TERMS_PATH, TERMS_UPDATED_AT, TERMS_VERSION, formatTermsDate } from "@/lib/shared/terms-of-use";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import { MATCH_REMINDER_LOOKAHEAD_MS } from "@/lib/shared/discord-notifications";
import { PRIVACY_CHANGES_EN, localizedPrivacyChanges } from "@/lib/shared/privacy-changes-en";
import enPush from "@/messages/en/push.json";
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
  privacyChangeDay,
  isPrivacyPolicyVersion,
  privacyChangeReachesAccount,
  publishedPrivacyChanges,
  privacyChangesForOneMessage,
  privacyChangesHeading,
  privacyDmBatch,
  privacyPolicyUpdatedLabel,
  settledPrivacyChanges,
  type PrivacyAudience,
  type PrivacyChange,
} from "@/lib/shared/privacy-changes";

function change(id: string, publishedAt: string, overrides: Partial<PrivacyChange> = {}): PrivacyChange {
  return { id, publishedAt, title: `Titre ${id}`, summary: `Résumé ${id}.`, details: [`Détail ${id}`], ...overrides };
}

const A = change("a", "2026-01-10");
const B = change("b", "2026-03-05");
const C = change("c", "2026-06-20");
const REGISTRY = [A, B, C];
/** Un jour postérieur à tout le registre de test : tout y est publié. */
const TODAY = "2099-01-01";

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

  it("déclare le tag Discord visible des joueurs : sur choix, certifié seulement, jamais sans compte", () => {
    // La case « Tag Discord » ouvre un public de plus au tag certifié : sans
    // cette entrée, le site traiterait une donnée d'une façon qu'il n'a pas annoncée.
    const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-09-tag-discord-visible-joueurs");
    expect(entry).toBeDefined();
    const text = [entry!.summary, ...entry!.details].join(" ");
    expect(text).toMatch(/décochée/);
    expect(text).toMatch(/tag certifié/);
    expect(text).toMatch(/sans compte ne le voit jamais/);
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

  // Le registre entier ne tient plus dans un message depuis sa huitième entrée,
  // et ne le tiendra plus jamais : il ne fait que grandir. Ce qui doit tenir,
  // c'est le plafond du bot, et qu'aucun changement ne disparaisse sans être
  // compté — le repli que `buildPrivacyChangesMessage` a été écrit pour tenir.
  it("reste sous le plafond du bot, registre entier compris, et compte ce qu'il ne nomme pas", () => {
    const message = buildPrivacyChangesMessage(PRIVACY_CHANGES, "https://bluegenji.fr");
    expect(message.length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    const named = PRIVACY_CHANGES.filter((entry) => message.includes(entry.title)).length;
    expect(named).toBeGreaterThan(0);
    const omitted = PRIVACY_CHANGES.length - named;
    if (omitted > 0) expect(message).toContain(`… et ${omitted} autre(s) changement(s).`);
  });

  it("nomme chaque changement quand il est annoncé seul", () => {
    for (const entry of PRIVACY_CHANGES) {
      const message = buildPrivacyChangesMessage([entry], "https://bluegenji.fr");
      expect(message.length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
      expect(message).toContain(entry.title);
      expect(message).toContain(entry.summary);
    }
  });
});

describe("pendingPrivacyChanges", () => {
  it("cumule tous les changements non acceptés, dans l'ordre du registre", () => {
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", [], TODAY, REGISTRY)).toEqual([A, B, C]);
  });

  it("retire ceux déjà acceptés", () => {
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", ["b"], TODAY, REGISTRY)).toEqual([A, C]);
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", ["a", "b", "c"], TODAY, REGISTRY)).toEqual([]);
  });

  it("ignore les changements publiés le jour de la création du compte ou après", () => {
    // Créé le jour de B : il a consenti à la politique qui contenait déjà B.
    expect(pendingPrivacyChanges("2026-03-05 23:59:59", [], TODAY, REGISTRY)).toEqual([C]);
    expect(pendingPrivacyChanges("2026-03-04 23:59:59", [], TODAY, REGISTRY)).toEqual([B, C]);
    expect(pendingPrivacyChanges("2026-07-01 00:00:00", [], TODAY, REGISTRY)).toEqual([]);
  });

  it("accepte une date ISO", () => {
    expect(pendingPrivacyChanges("2026-03-10T08:00:00.000Z", [], TODAY, REGISTRY)).toEqual([C]);
  });

  it("date inconnue : tout ce qui n'est pas accepté est dû", () => {
    expect(pendingPrivacyChanges(null, ["a"], TODAY, REGISTRY)).toEqual([B, C]);
  });

  it("ignore un identifiant accepté qui n'existe plus au registre", () => {
    expect(pendingPrivacyChanges(null, ["zzz"], TODAY, REGISTRY)).toEqual([A, B, C]);
  });

  it("registre vide : rien à présenter", () => {
    expect(pendingPrivacyChanges(null, [], TODAY, [])).toEqual([]);
  });

  it("tait une entrée datée du futur jusqu'à sa date, borne comprise", () => {
    // Vu la veille de C : « Nos règles ont changé » daté du lendemain.
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", [], "2026-06-19", REGISTRY)).toEqual([A, B]);
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", [], "2026-06-20", REGISTRY)).toEqual([A, B, C]);
    expect(pendingPrivacyChanges(null, [], "2025-01-01", REGISTRY)).toEqual([]);
  });
});

describe("privacyChangeDay — jour de Paris", () => {
  it("passe au lendemain à minuit à Paris, pas à minuit UTC", () => {
    // Heure d'été (UTC+2) : 22 h 30 UTC le 29 est déjà le 30 à Paris.
    expect(privacyChangeDay(new Date("2026-09-29T21:59:59Z"))).toBe("2026-09-29");
    expect(privacyChangeDay(new Date("2026-09-29T22:00:00Z"))).toBe("2026-09-30");
    // Heure d'hiver (UTC+1).
    expect(privacyChangeDay(new Date("2026-12-31T22:59:59Z"))).toBe("2026-12-31");
    expect(privacyChangeDay(new Date("2026-12-31T23:00:00Z"))).toBe("2027-01-01");
  });

  it("rend le format des dates de publication", () => {
    expect(privacyChangeDay(new Date("2026-01-05T12:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("publishedPrivacyChanges", () => {
  it("ne garde que les entrées publiées au jour dit, dans l'ordre", () => {
    expect(publishedPrivacyChanges("2026-03-04", REGISTRY)).toEqual([A]);
    expect(publishedPrivacyChanges("2026-03-05", REGISTRY)).toEqual([A, B]);
    expect(publishedPrivacyChanges(TODAY, REGISTRY)).toEqual(REGISTRY);
  });
});

describe("PRIVACY_CHANGES — aucune entrée ne fait accepter", () => {
  it("n'invite jamais à accepter ni à supprimer son compte pour refuser", () => {
    for (const entry of PRIVACY_CHANGES) {
      const text = [entry.title, entry.summary, ...entry.details].join(" ");
      expect(text).not.toMatch(/j.accepte|accepter ce changement|je refuse|refuser et supprimer/i);
    }
  });

  it("date le retrait de Google One Tap du lendemain de sa mise en ligne, pas d'octobre", () => {
    const entry = PRIVACY_CHANGES.find((change) => change.id === "2026-10-retrait-google-one-tap");
    expect(entry?.publishedAt).toBe("2026-09-30");
  });
});

describe("checkPrivacyAcknowledgement", () => {
  it("accepte des identifiants connus, dédoublonnés", () => {
    expect(checkPrivacyAcknowledgement(["a", "c", "a"], TODAY, REGISTRY)).toEqual({ ok: true, ids: ["a", "c"] });
  });

  it.each([
    ["absent", undefined],
    ["pas un tableau", "a"],
    ["vide", []],
    ["élément non textuel", ["a", 3]],
    ["plus long que le registre", ["a", "b", "c", "a"]],
  ])("refuse une demande mal formée (%s)", (_label, value) => {
    expect(checkPrivacyAcknowledgement(value, TODAY, REGISTRY)).toEqual({ ok: false, error: INVALID_PRIVACY_CHANGES });
  });

  it("refuse un identifiant pas encore publié : aucune modale n'a pu le montrer", () => {
    expect(checkPrivacyAcknowledgement(["a", "c"], "2026-06-19", REGISTRY)).toEqual({
      ok: false,
      error: UNKNOWN_PRIVACY_CHANGE,
    });
    expect(checkPrivacyAcknowledgement(["c"], "2026-06-20", REGISTRY)).toEqual({ ok: true, ids: ["c"] });
  });

  it("refuse un identifiant inconnu plutôt que de l'ignorer", () => {
    expect(checkPrivacyAcknowledgement(["a", "inconnu"], TODAY, REGISTRY)).toEqual({
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
    expect(privacyPolicyUpdatedLabel(TODAY, REGISTRY)).toBe("juin 2026");
    expect(privacyPolicyUpdatedLabel(TODAY, [])).toBeNull();
    // Une entrée pas encore publiée n'avance pas la date affichée.
    expect(privacyPolicyUpdatedLabel("2026-06-19", REGISTRY)).toBe("mars 2026");
    expect(privacyPolicyUpdatedLabel("2025-01-01", REGISTRY)).toBeNull();
    expect(privacyPolicyUpdatedLabel(privacyChangeDay(new Date()))).toMatch(/^[a-zéû]+ \d{4}$/);
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
    expect(message).toMatch(/Aucun accord ne t.est demandé/);
    expect(message).not.toMatch(/supprimer ton compte|accepter/);
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

  it("en anglais (BOT-NOTIF-LANG) : cadre, date et lien anglais ; le français par défaut est inchangé", () => {
    expect(buildPrivacyChangesMessage([A, C], "https://bluegenji.fr/")).toBe(
      buildPrivacyChangesMessage([A, C], "https://bluegenji.fr/", "fr"),
    );
    const message = buildPrivacyChangesMessage([A, C], "https://bluegenji.fr/", "en");
    expect(message).toContain("🔐 **BlueGenji — 2 changes to our privacy rules**");
    expect(message).toContain("**Titre a** (January 10, 2026) — Résumé a.");
    expect(message).toContain("No consent is asked of you");
    expect(message).toContain("https://bluegenji.fr/en/rgpd");
    expect(buildPrivacyChangesMessage([A], "https://x.fr", "en")).toContain("our privacy rules have changed");
    expect(buildPrivacyChangesMessage([A], null, "en")).not.toMatch(/https?:/);
  });

  // EF-19 : des conditions à accepter (`asksTermsAcceptance`) parmi les changements
  // dus, nommés ou seulement comptés : le pied ne dit plus « aucun accord » sans exception.
  const TERMS_FOOTER = {
    fr: "Seules les nouvelles conditions d'utilisation demandent ton accord, si tu ne les as pas encore acceptées ; pour le reste, aucun accord ne t'est demandé : la politique",
    en: "Only the new terms of use need your agreement, if you haven't accepted them yet; for the rest, no consent is asked of you: the privacy policy",
  } as const;
  const PLAIN_FOOTER = { fr: "Aucun accord ne t'est demandé : la politique", en: "No consent is asked of you: the privacy policy" } as const;
  const LOCALES = ["fr", "en"] as const;
  const terms = change("conditions", "2026-02-01", { summary: "y".repeat(300), asksTermsAcceptance: true });

  it("buildPrivacyChangesMessage_namedChangeAsksTermsAcceptance_footerSaysOnlyTheTermsNeedAgreement", () => {
    for (const locale of LOCALES) {
      expect(buildPrivacyChangesMessage([A, terms], "https://bluegenji.fr", locale)).toContain(TERMS_FOOTER[locale]);
    }
  });

  it("buildPrivacyChangesMessage_noChangeAsksTermsAcceptance_footerKeepsPlainNoConsent", () => {
    for (const locale of LOCALES) {
      const message = buildPrivacyChangesMessage([A, C], "https://bluegenji.fr", locale);
      expect(message).toContain(PLAIN_FOOTER[locale]);
      expect(message).not.toContain(TERMS_FOOTER[locale]);
    }
  });

  it("buildPrivacyChangesMessage_termsChangeOnlyCounted_footerStillSaysTheTermsNeedAgreement", () => {
    const filler = Array.from({ length: 6 }, (_, i) => change(`long-${i}`, "2026-02-01", { summary: "x".repeat(300) }));

    const message = buildPrivacyChangesMessage([...filler, terms], "https://bluegenji.fr");

    expect(message).toMatch(/… et \d+ autre\(s\) changement\(s\)\./);
    expect(message).not.toContain("Titre conditions");
    expect(message).toContain(TERMS_FOOTER.fr);
    expect(message.length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

// EF-19 : depuis la version 7, toute entrée qui annonce une version des
// conditions la dit à accepter, pour le pied du message privé.
describe("PRIVACY_CHANGES — versions des conditions à accepter", () => {
  it("PRIVACY_CHANGES_termsVersionEntriesSinceV7_carryAsksTermsAcceptance", () => {
    const termsEntries = PRIVACY_CHANGES.filter(
      (entry) => entry.publishedAt >= "2026-10-29" && entry.title.startsWith("Conditions d'utilisation : version"),
    );
    expect(termsEntries.map((entry) => entry.id)).toContain("2026-10-conditions-v7-casters-et-arbitre");
    expect(termsEntries.filter((entry) => entry.asksTermsAcceptance !== true)).toEqual([]);
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

describe("privacyChangesForOneMessage", () => {
  const long = (id: string) => change(id, "2026-01-10", { summary: "x".repeat(700) });

  it("garde tout ce qui tient dans un message", () => {
    expect(privacyChangesForOneMessage([A, B, C], "https://bluegenji.fr")).toEqual([A, B, C]);
  });

  it("s'arrête au premier changement qui ne serait plus nommé, dans l'ordre", () => {
    const batch = privacyChangesForOneMessage([long("a"), long("b"), long("c")], "https://bluegenji.fr");
    expect(batch.map((c) => c.id)).toEqual(["a", "b"]);
    const message = buildPrivacyChangesMessage(batch, "https://bluegenji.fr");
    expect(message.length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(message).not.toContain("autre(s) changement(s)");
  });

  it("rend toujours au moins un changement quand il y en a", () => {
    const huge = change("z", "2026-01-10", { summary: "x".repeat(5000) });
    expect(privacyChangesForOneMessage([huge, A], null)).toEqual([huge]);
  });

  it("ne rend rien quand il n'y a rien", () => {
    expect(privacyChangesForOneMessage([], null)).toEqual([]);
  });

  // EF-19 : des conditions à accepter partent toujours dans le premier message.
  it("privacyChangesForOneMessage_termsToAcceptAfterLongChanges_putsTheTermsFirstInBothLanguages", () => {
    const terms = change("conditions", "2026-01-20", { asksTermsAcceptance: true });
    const fr = [long("a"), long("b"), long("c"), terms];
    const en = fr.map((entry) => ({ ...entry, summary: `${entry.summary} (en)` }));

    const batch = privacyChangesForOneMessage(fr, "https://bluegenji.fr", en);

    expect(batch.map((c) => c.id)).toEqual(["conditions", "a"]);
    expect(buildPrivacyChangesMessage(batch, "https://bluegenji.fr")).toContain("Seules les nouvelles conditions d'utilisation demandent ton accord");
  });

  it("privacyChangesForOneMessage_flagOnFrenchOnly_englishFollowsFrenchOrder", () => {
    const fr = [long("a"), long("b"), change("conditions", "2026-01-20", { asksTermsAcceptance: true })];
    // Anglais sans drapeau, et des conditions longues : seules, elles tiennent ;
    // suivies de « a » (même ordre qu'en français), plus.
    const en = fr.map(({ asksTermsAcceptance: _flag, ...entry }) =>
      entry.id === "conditions" ? { ...entry, summary: "y".repeat(1100) } : entry,
    );

    const batch = privacyChangesForOneMessage(fr, "https://bluegenji.fr", en);

    expect(batch.map((c) => c.id)).toEqual(["conditions"]);
  });

  it("privacyChangesForOneMessage_realRegistryDueSinceOct29_firstMessageCarriesTheV7Terms", () => {
    const due = PRIVACY_CHANGES.filter((entry) => entry.publishedAt === "2026-10-29");

    const batch = privacyChangesForOneMessage(due, "https://bluegenji.fr", localizedPrivacyChanges(due, "en"));

    expect(batch[0]?.id).toBe("2026-10-conditions-v7-casters-et-arbitre");
  });

  it("avec l'anglais, le lot doit tenir dans les deux langues (BOT-NOTIF-LANG)", () => {
    const fr = [long("a"), long("b"), long("c")];
    // Les mêmes changements, plus longs en anglais : seuls deux tiennent ensemble.
    const en = fr.map((entry) => ({ ...entry, summary: "y".repeat(800) }));
    expect(privacyChangesForOneMessage(fr, "https://bluegenji.fr").map((c) => c.id)).toEqual(["a", "b"]);
    const both = privacyChangesForOneMessage(fr, "https://bluegenji.fr", en);
    expect(both.map((c) => c.id)).toEqual(["a"]);
    expect(buildPrivacyChangesMessage(en.slice(0, both.length), "https://bluegenji.fr", "en").length).toBeLessThanOrEqual(
      PRIVACY_DM_MAX_LENGTH,
    );
  });

  it("partage le registre réel en lots qui nomment tous leurs changements dans les deux langues", () => {
    let rest = [...PRIVACY_CHANGES];
    while (rest.length > 0) {
      const english = localizedPrivacyChanges(rest, "en");
      const batch = privacyChangesForOneMessage(rest, "https://bluegenji.fr", english);
      const englishBatch = localizedPrivacyChanges(batch, "en");
      const message = buildPrivacyChangesMessage(englishBatch, "https://bluegenji.fr", "en");
      for (const entry of englishBatch) expect(message).toContain(entry.title);
      rest = rest.filter((entry) => !batch.includes(entry));
    }
  });

  it("partage le registre réel en lots qui nomment chacun tous leurs changements", () => {
    let rest = [...PRIVACY_CHANGES];
    while (rest.length > 0) {
      const batch = privacyChangesForOneMessage(rest, "https://bluegenji.fr");
      const message = buildPrivacyChangesMessage(batch, "https://bluegenji.fr");
      for (const entry of batch) expect(message).toContain(entry.title);
      rest = rest.filter((entry) => !batch.includes(entry));
    }
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

describe("entrées ciblées (audience)", () => {
  const G = change("g", "2026-04-01", { audience: "GOOGLE_LINKED" });
  const TARGETED = [A, G, C];

  it("sans cible, une entrée vaut pour tout compte", () => {
    expect(privacyChangeReachesAccount(A, {})).toBe(true);
    expect(privacyChangeReachesAccount(A, { googleLinked: false })).toBe(true);
  });

  it("GOOGLE_LINKED ne vise qu'un compte relié à Google", () => {
    expect(privacyChangeReachesAccount(G, { googleLinked: true })).toBe(true);
    expect(privacyChangeReachesAccount(G, { googleLinked: false })).toBe(false);
  });

  it("LIVE_STAFF ne vise qu'un compte qui peut caster (permission live)", () => {
    const L = change("l", "2026-04-01", { audience: "LIVE_STAFF" });
    expect(privacyChangeReachesAccount(L, { liveStaff: true })).toBe(true);
    expect(privacyChangeReachesAccount(L, { liveStaff: false, googleLinked: true })).toBe(false);
    expect(privacyChangeReachesAccount(L, {})).toBe(false);
  });

  it("seul l'avis personnel GOOGLE_LINKED sort de l'historique de la politique", () => {
    expect(isPrivacyPolicyVersion(A)).toBe(true);
    expect(isPrivacyPolicyVersion(G)).toBe(false);
    expect(isPrivacyPolicyVersion(change("l", "2026-04-01", { audience: "LIVE_STAFF" }))).toBe(true);
  });

  it("un fait inconnu vaut faux : l'entrée ciblée se tait", () => {
    expect(privacyChangeReachesAccount(G, {})).toBe(false);
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", [], TODAY, TARGETED)).toEqual([A, C]);
  });

  it("une cible inconnue (valeur inattendue) ne vise personne", () => {
    const odd = change("x", "2026-04-01", { audience: "AUTRE" as string as PrivacyAudience });
    expect(privacyChangeReachesAccount(odd, { googleLinked: true })).toBe(false);
  });

  it("la cible s'ajoute à la date de création, elle ne la remplace pas", () => {
    const linked = { googleLinked: true };
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", [], TODAY, TARGETED, linked)).toEqual([A, G, C]);
    // Créé le jour de la publication ou après : non concerné, relié ou non.
    expect(pendingPrivacyChanges("2026-04-01 00:00:00", [], TODAY, TARGETED, linked)).toEqual([C]);
    // Déjà lue : plus due.
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", ["g"], TODAY, TARGETED, linked)).toEqual([A, C]);
  });
});

describe("PRIVACY_CHANGES — comptes Google antérieurs au pseudo neutre", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-09-comptes-google-anterieurs")!;

  it("vise les comptes reliés à Google créés avant la règle du 30 septembre 2026", () => {
    expect(entry).toBeDefined();
    expect(entry.audience).toBe("GOOGLE_LINKED");
    expect(entry.publishedAt).toBe("2026-09-30");
  });

  it("n'annonce aucune modification d'office et renvoie vers le profil", () => {
    expect(entry.summary).toMatch(/Rien n'a été changé à ta place/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/profil#identite", "/profil#confidentialite"]);
  });

  it("parle au conditionnel : le site ne sait pas par quelle porte un compte est né", () => {
    expect(entry.summary).toMatch(/ont pu venir/);
  });

  it("n'est pas présentée à un compte sans Google", () => {
    expect(pendingPrivacyChanges("2025-01-01 00:00:00", [], TODAY).map((c) => c.id)).not.toContain(entry.id);
    expect(
      pendingPrivacyChanges("2025-01-01 00:00:00", [], TODAY, PRIVACY_CHANGES, { googleLinked: true }).map((c) => c.id),
    ).toContain(entry.id);
  });
});

describe("PRIVACY_CHANGES — rectificatifs d'information", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-rectificatifs-information")!;
  const text = () => [entry.summary, ...entry.details].join(" ");

  it("est datée du lendemain de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(entry.publishedAt).toBe("2026-10-01");
    expect(entry.audience).toBeUndefined();
  });

  it("dit que le traitement ne change pas", () => {
    expect(entry.summary).toMatch(/Rien ne change dans le traitement/);
  });

  it("laisse intactes les entrées qu'elle rectifie", () => {
    const backups = PRIVACY_CHANGES.find((c) => c.id === "2026-09-sauvegardes-chiffrees")!;
    expect(backups.details.join(" ")).toContain("une clé que seule l'association détient");
    const recap = PRIVACY_CHANGES.find((c) => c.id === "2026-09-recapitulatif-rgpd")!;
    expect(recap.details.join(" ")).toContain("tournoi en cours");
  });

  it("sauvegardes : nomme le détenteur de la clé et borne le rejeu aux suppressions de compte", () => {
    expect(text()).toContain("seul responsable technique de l'association, qui est aussi l'hébergeur du site");
    expect(text()).toContain("seules les suppressions de compte intervenues depuis sont réappliquées");
    expect(text()).toContain(`${BACKUP_RETENTION_DAYS} jours`);
  });

  it("arbitrage : tournoi non terminé, pas seulement en cours", () => {
    expect(text()).toContain("tournoi qui n'est pas terminé");
  });

  it("mesure d'audience : pseudonymisée, pas anonyme", () => {
    expect(text()).toContain("pseudonymisée, pas anonyme");
  });

  it("tient dans un message privé à elle seule, et ne renvoie qu'à des sections de /rgpd", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#audience", "/rgpd#destinataires"]);
  });
});

describe("PRIVACY_CHANGES — mesure d'audience, opposition et durée", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-mesure-audience-opposition")!;
  const rectificatifs = PRIVACY_CHANGES.find((c) => c.id === "2026-10-rectificatifs-information")!;
  const text = () => [entry.summary, ...entry.details].join(" ");

  // Même jour que les rectificatifs : une seule modale pour les deux, et une
  // entrée distincte parce que ceux-ci annoncent un traitement inchangé.
  it("précède l'entrée du contact données, datée du même jour que les rectificatifs, pour tous les comptes", () => {
    // Suivie de l'entrée du contact données, de celle des suspensions puis de
    // celle du registre complété, publiées le même jour.
    expect(PRIVACY_CHANGES.at(-43)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe(rectificatifs.publishedAt);
    expect(entry.publishedAt).toBe("2026-10-01");
    expect(entry.audience).toBeUndefined();
    expect(rectificatifs.summary).toMatch(/Rien ne change dans le traitement/);
  });

  it("annonce l'opposition (GPC, DNT, bouton) et la durée de 25 mois", () => {
    expect(text()).toContain("Global Privacy Control");
    expect(text()).toContain("Do Not Track");
    expect(text()).toContain("25 mois après ta dernière visite");
    expect(text()).toContain("une visite refusée n'est pas enregistrée");
    expect(text()).not.toMatch(/sans limite de durée|non réversible/);
  });

  it("tient dans un message privé à elle seule, et renvoie à la section de /rgpd", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#audience"]);
  });
});

describe("PRIVACY_CHANGES — personne à contacter pour les données", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-contact-donnees")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée des suspensions, publiée le même jour que les rectificatifs, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-42)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-01");
    expect(entry.audience).toBeUndefined();
  });

  it("nomme la personne et sa qualité, sans aucune coordonnée en clair", () => {
    // Le résumé part sur Discord : il dit la qualité, le nom reste dans le détail.
    expect(entry.summary).toContain(`l'${DATA_CONTACT_ROLE}`);
    expect(entry.summary).not.toContain(DATA_CONTACT_NAME);
    expect(entry.details.join(" ")).toContain(`Cette personne est ${DATA_CONTACT_NAME}.`);
    expect(text()).not.toMatch(/@|\b0\d([ .-]?\d{2}){4}\b/);
  });

  it("ne l'appelle jamais DPO, et annonce le nouveau destinataire d'un courriel", () => {
    expect(text()).not.toMatch(/DPO/);
    expect(text()).toContain("Ce n'est pas un délégué à la protection des données");
    // Un canal neuf, donc un destinataire neuf : l'entrée ne dit pas que rien ne change.
    expect(text()).not.toMatch(/Rien ne change/);
    expect(text()).toContain("hébergée par Microsoft (Outlook.com, possibles transferts vers les États-Unis)");
    expect(text()).toContain("passe par son opérateur téléphonique");
  });

  it("tient dans un message privé à elle seule, et renvoie à la section des droits", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#exercer-vos-droits"]);
  });
});

describe("PRIVACY_CHANGES — suspension d'un compte", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-suspension-comptes")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée du registre complété, publiée le lendemain de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-41)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-01");
    expect(entry.audience).toBeUndefined();
  });

  it("annonce le traitement, sa base légale, sa durée et la voie de contestation", () => {
    expect(text()).toContain("suspendre un compte");
    expect(text()).toContain("intérêt légitime");
    expect(text()).toContain(`${SUSPENSION_RETENTION_MONTHS} mois`);
    expect(text()).toContain("« Signaler un problème » (catégorie « Autre »)");
    expect(text()).toContain("motif écrit");
  });

  it("tient dans un message privé à elle seule, et renvoie à la section de /rgpd", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#signalements"]);
  });
});

describe("PRIVACY_CHANGES — registre complété (support, retransmission, courriel, âge)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-registre-complete")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée des sauvegardes chez Hetzner, datée du 1er octobre 2026, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-40)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-01");
    expect(entry.audience).toBeUndefined();
  });

  it("annonce le paragraphe « Âge minimum », jusque-là sans entrée", () => {
    expect(text()).toContain(`au moins ${SITE_MINIMUM_AGE} ans`);
    expect(entry.links?.map((link) => link.href)).toContain("/rgpd#age-minimum");
  });

  it("nomme Google comme hôte du courriel de l'association, et la durée des demandes", () => {
    expect(text()).toMatch(/messagerie Gmail, que Google héberge/);
    expect(text()).toContain(`${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa clôture`);
  });

  it("annonce le support, la retransmission et les journaux du serveur avec leurs durées", () => {
    expect(text()).toContain(`${SUPPORT_TICKET_RETENTION_MONTHS} mois après sa clôture`);
    expect(text()).toMatch(/Tu peux t'y opposer/);
    expect(text()).toContain(`${WEB_ACCESS_LOG_RETENTION_DAYS} jours au plus`);
  });

  it("tient dans un message privé à elle seule, sans nommer personne", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(entry.summary).not.toContain(DATA_CONTACT_NAME);
  });

  it("ne charge ni le registre ni les conditions d'utilisation (module lu sur chaque page)", () => {
    const source = readFileSync(join(process.cwd(), "lib/shared/privacy-changes.ts"), "utf8");
    expect(source).not.toMatch(/from "@\/lib\/shared\/processing-register"/);
    expect(source).not.toMatch(/from "@\/lib\/shared\/terms-of-use"/);
    expect(source).toMatch(/from "@\/lib\/shared\/legal-durations"/);
  });
});

describe("PRIVACY_CHANGES — sauvegardes chez Hetzner (changement de sous-traitant et de lieu)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-sauvegardes-hetzner")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée des durées du bot, datée du lendemain de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-39)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-02");
    expect(entry.audience).toBeUndefined();
  });

  it("annonce le nouveau lieu, sans transfert hors de l'Union, et la fin de OneDrive", () => {
    expect(entry.summary).toMatch(/Hetzner, en Allemagne/);
    expect(entry.summary).toMatch(/restent dans l'Union européenne/);
    // Le message ne promet pas l'effacement des copies déjà déposées chez
    // Microsoft, qui reste une action à mener en production.
    expect(text()).toMatch(/Microsoft ne reçoit plus de nouvelle sauvegarde/);
    // Microsoft reste nommé pour la messagerie de la personne à contacter.
    expect(text()).toMatch(/messagerie de la personne à contacter/);
  });

  it("joint les précisions sur Spiceworks et la retransmission, avec le droit d'opposition", () => {
    expect(text()).toMatch(/Spiceworks .* sous-traitant/);
    expect(text()).toMatch(/jamais de webcam ni de chat vocal/);
    expect(text()).toMatch(/nom neutre/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#destinataires", "/rgpd#retransmission"]);
  });

  it("tient dans un message privé à elle seule, sans nommer personne", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(text()).not.toContain(DATA_CONTACT_NAME);
  });
});

describe("PRIVACY_CHANGES — durées du bot (fil d'activité, journal du staff, exclusions, restauration)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-bot-durees-journaux")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée des scores map par map, datée du lendemain de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-38)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-02");
    expect(entry.audience).toBeUndefined();
  });

  it("annonce les durées tenues par le bot, tirées des constantes", () => {
    expect(text()).toContain(`${BOT_FEED_EVENT_RETENTION_DAYS} jours, puis supprimé`);
    expect(text()).toContain(`(${BOT_STAFF_LOG_RETENTION_DAYS} jours)`);
    expect(text()).toMatch(/dès qu'elle est levée/);
    expect(text()).toMatch(/ne transite plus par Discord/);
    expect(text()).toContain(`${BACKUP_RETENTION_DAYS} jours`);
    expect(entry.links?.map((link) => link.href)).toEqual(["/privacy-policy-bot"]);
  });

  it("tient dans un message privé à elle seule, sans nommer personne", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    expect(text()).not.toContain(DATA_CONTACT_NAME);
  });
});

describe("PRIVACY_CHANGES — scores map par map (codes de replay)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-scores-map-par-map")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée du code de replay facultatif, datée de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-37)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-06");
    expect(entry.audience).toBeUndefined();
  });

  it("dit ce qu'un code de replay révèle, qui le voit, et ce qu'emporte une suppression", () => {
    expect(text()).toMatch(/identifiants de jeu/);
    expect(text()).toMatch(/membres connectés/);
    expect(text()).toMatch(/effacé à la suppression du compte/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd"]);
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — code de replay facultatif pour l'arbitrage", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-code-replay-facultatif-arbitrage")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée du suivi sans compte, datée de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-36)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-08");
    expect(entry.audience).toBeUndefined();
  });

  it("dit que l'arbitrage peut omettre le code, ce qui s'affiche, et que les équipes le fournissent toujours", () => {
    expect(text()).toMatch(/uniquement|ne se saisit plus que map par map/);
    expect(text()).toMatch(/Pas de code de replay/);
    expect(text()).toMatch(/aucun code n'est alors collecté/);
    expect(text()).toMatch(/équipes fournissent toujours/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd"]);
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — suivi d'un tournoi sans compte", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-suivi-tournoi-sans-compte")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée de la langue du compte, datée du lendemain de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-35)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-09");
    expect(entry.audience).toBeUndefined();
  });

  it("dit qui lit désormais quoi, ce qui reste aux membres, et le droit d'opposition", () => {
    expect(text()).toMatch(/sans se connecter|sans compte/);
    expect(text()).toMatch(/pseudos des joueurs engagés/);
    // Déclaré : le numéro de compte d'un joueur solo, qui porte sa marque du podium.
    expect(text()).toMatch(/numéro de compte interne/);
    // Déclarés aussi : les logos, et l'avatar d'un joueur solo (copié dans son entrée).
    expect(text()).toMatch(/logos des équipes/);
    // Les pénalités publiques, sans motif ni arbitre.
    expect(text()).toMatch(/pénalités d'une BlueGenji Survie \(engagé, manche, points\), sans leur motif ni l'arbitre/);
    expect(text()).toMatch(/avatar de chaque joueur engagé \(sauf s'il l'a masqué\)/);
    expect(text()).toMatch(/codes de replay n'y figurent pas/);
    // Le délai de la copie partagée (150 s au pire) est dit, suppression de compte comprise.
    expect(text()).toMatch(/toutes les deux minutes et demie[^.]*suppression de compte/);
    expect(text()).toMatch(/exclue des moteurs de recherche/);
    // La visite reste comptée comme partout : la page ne prétend pas le contraire.
    expect(text()).toMatch(/comptée par la mesure d'audience, sauf opposition/);
    expect(text()).toMatch(/adresse IP[^.]*limiter le nombre de lectures, en mémoire/);
    expect(text()).not.toMatch(/sans être enregistrée/);
    expect(text()).toMatch(/t'opposer/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#suivi-sans-compte"]);
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — langue du compte (lot i18n 9-3)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-langue-du-compte")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée des horaires de match, datée du lendemain de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-34)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-14");
    expect(entry.audience).toBeUndefined();
  });

  it("dit ce qui est gardé, comment c'est posé, combien de temps, et ce que la suppression emporte", () => {
    expect(text()).toMatch(/français ou anglais/);
    expect(text()).toMatch(/notifications push/);
    expect(text()).toMatch(/connecté la dernière fois/);
    // Une connexion lancée hors du site ne pose pas la langue (revue sécurité) : le texte le dit.
    expect(text()).toMatch(/lancée d'ailleurs, par un lien ou un favori, ne la change pas, ni une connexion par le bouton Google, Discord ou Blizzard depuis un navigateur qui ne l'indique pas/);
    // Défaut français ; aucune inscription ne naît d'un départ non prouvé
    // (conditions non retenues → refus « terms ») : le texte n'en parle pas.
    expect(text()).toMatch(/le français par défaut, notamment pour un compte qui ne s'est pas reconnecté/);
    expect(text()).not.toMatch(/créé ainsi/);
    expect(text()).toMatch(/Mon profil/);
    expect(text()).toMatch(/prochaine connexion faite dans l'autre langue/);
    expect(text()).toMatch(/le temps du compte/);
    expect(text()).toMatch(/export de tes données/);
    expect(text()).toMatch(/revient au français si le compte est anonymisé/);
    expect(text()).toMatch(/messages Discord, eux, restent en français/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#notifications"]);
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — horaires de match annoncés, changés ou retirés (#441)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-horaires-de-match")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée de l'annonce des matchs diffusés, datée du lendemain de sa mise en ligne, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-33)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-15");
    expect(entry.audience).toBeUndefined();
  });

  it("dit ce qui part, à qui, ce qui est gardé et le réglage qui refuse le nouveau sujet du staff", () => {
    expect(text()).toMatch(/pose, change ou retire l'horaire/);
    expect(text()).toMatch(/message privé Discord et en notification push si tu les as activées/);
    expect(text()).toMatch(/« Horaires et rappels de match »/);
    // L'engagée qu'une mise à jour du tournoi retire d'un match est prévenue.
    expect(text()).toMatch(/te retire, toi ou ton équipe, d'un match dont tu avais reçu l'horaire/);
    // Paliers retirés : il ne reste que la veille.
    expect(text()).toMatch(/un seul rappel reste, dans les 24 h/);
    // L'annonce n'est immédiate que si les deux camps sont connus (sinon le balayage, 48 h avant).
    expect(text()).not.toMatch(/aussitôt/);
    expect(text()).toMatch(/sinon à l'approche du match \(dans les 48 h qui précèdent\)/);
    expect(MATCH_REMINDER_LOOKAHEAD_MS).toBe(48 * 60 * 60 * 1000);
    expect(text()).toMatch(/une semaine et une heure avant le match disparaissent/);
    expect(text()).toMatch(/aucun pseudo de joueur/);
    // `bg_match_reminders.start_at` : l'horaire annoncé, gardé avec le match.
    expect(text()).toMatch(/garde, avec le match, l'horaire qui a été annoncé/);
    expect(text()).toMatch(/ne garde pas le texte des messages/);
    // Sujet push fondé sur le consentement : l'entrée nomme le réglage qui le refuse.
    expect(text()).toMatch(/« Matchs planifiés », que tu peux couper dans « Mon profil »/);
    expect(text()).toMatch(/sans nom sur Discord, avec le pseudo et l'identifiant de compte de son auteur dans les journaux du serveur/);
    // Sans planification par l'arbitrage, un retrait se tait (`clearedHeldStartAt`) : l'entrée le dit.
    expect(text()).toMatch(/ne planifie pas les matchs, un horaire retiré n'est pas annoncé/);
    // Le sujet push ne règle pas les messages privés, fondés sur l'intérêt légitime.
    // Destinataires réels : tous les membres actifs des équipes (`loadEntrantPlayerIds`).
    expect(text()).toMatch(/aux membres des deux équipes du match \(coachs et managers compris ; aux deux joueurs en tournoi individuel\)/);
    // La base et le droit d'opposition vivent sur /rgpd (modifiable), pas dans l'entrée figée.
    expect(text()).toMatch(/ne règle que les notifications push, pas ces messages privés/);
    // Une manche supprimée par le moteur est poussée à tout le staff, auteur compris.
    expect(text()).toMatch(/quand une mise à jour du tournoi supprime un match planifié/);
    // Messages privés sur intérêt légitime : la section des droits (opposition) est à un clic (art. 21.4).
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#notifications", "/rgpd#exercer-vos-droits"]);
  });

  it("nomme les sujets push sous leurs libellés publiés", () => {
    expect(text()).toContain(`« ${PUSH_TOPICS.MATCH_REMINDER.label} »`);
    expect(text()).toContain(`« ${PUSH_TOPICS.MATCH_SCHEDULED.label} »`);
  });

  it("en anglais, nomme les sujets push sous leurs libellés anglais publiés", () => {
    const english = PRIVACY_CHANGES_EN[entry.id];
    const englishText = [english.title, english.summary, ...english.details].join(" ");
    expect(englishText).toContain(`“${enPush.topics.MATCH_REMINDER.label}”`);
    expect(englishText).toContain(`“${enPush.topics.MATCH_SCHEDULED.label}”`);
    expect(english.details).toHaveLength(entry.details.length);
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — matchs diffusés annoncés sur Discord (#442)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-annonce-des-matchs-diffuses")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée du rappel de check-in, datée du lendemain de sa mise en ligne prévue, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-32)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-15");
    expect(entry.audience).toBeUndefined();
  });

  it("dit ce qui part, à qui, sans pseudo, et ce que le site garde", () => {
    expect(text()).toMatch(/salon #live du serveur Discord de l'association, avec une mention @everyone/);
    expect(text()).toMatch(/le nom des deux équipes, celui du tournoi et le lien de la diffusion/);
    // `entrantLabel` : jamais un pseudo, « un joueur » en individuel.
    expect(text()).toMatch(/aucun pseudo de joueur : en tournoi individuel, chaque engagé s'écrit « un joueur »/);
    // `bg_live_announcements` : (match, affiche), supprimée avec le match.
    expect(text()).toMatch(/trace de l'annonce \(le match, les identifiants de ses deux engagés et sa date\), effacée avec le match/);
    expect(text()).toMatch(/chez Discord \(États-Unis\)/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#retransmission", "/rgpd#destinataires"]);
  });

  it("a son anglais, détail pour détail", () => {
    const english = PRIVACY_CHANGES_EN[entry.id];
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
    expect(english.details.join(" ")).toMatch(/“a player”/);
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — rappel de check-in et programme d'arbitrage (#443)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-rappel-de-check-in")!;
  const text = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("précède l'entrée du pseudo #live et des messages de match, datée du lendemain de sa mise en ligne prévue, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.at(-30)?.id).toBe(entry.id);
    expect(entry.publishedAt).toBe("2026-10-16");
    expect(entry.audience).toBeUndefined();
  });

  it("dit le second rappel, le lien du check-in et le programme d'arbitrage, sans pseudo", () => {
    // L'entrée #441 disait « un seul rappel reste, dans les 24 h » : celle-ci la complète.
    expect(text()).toMatch(/Le rappel des 24 h reste/);
    expect(text()).toMatch(/10 h avant le coup d'envoi/);
    expect(text()).toMatch(/serveur Discord du check-in/);
    expect(text()).toMatch(/15 minutes avant le match/);
    expect(text()).toMatch(/journal d'activité du staff sur Discord/);
    expect(text()).toMatch(/« un joueur » en tournoi individuel/);
    expect(text()).toMatch(/sans pseudo de joueur/);
    expect(entry.links?.map((link) => link.href)).toEqual(["/rgpd#notifications", "/rgpd#exercer-vos-droits"]);
  });

  it("a son anglais, détail pour détail", () => {
    const english = PRIVACY_CHANGES_EN[entry.id];
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
    expect(english.details.join(" ")).toMatch(/“a player”/);
    expect(english.summary).toMatch(/10 h before kickoff/);
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — messages privés de match aux seuls tags certifiés (DM-CERTIFIED-ONLY)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-messages-de-match-tags-certifies")!;
  const english = PRIVACY_CHANGES_EN["2026-10-messages-de-match-tags-certifies"];

  it("précède l'entrée des contacts de match : datée du 19 octobre 2026 (jour de la fusion), pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 28);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-19", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit la règle, ce qui ne change pas et comment continuer à les recevoir (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/tag Discord est certifié/);
    expect(fr).toMatch(/Un tag non certifié n'en reçoit plus aucun, qu'il soit saisi à la main ou rattaché par la connexion Discord/);
    // L'avis part aussi aux comptes déjà certifiés : il leur dit que rien ne change.
    expect(fr).toMatch(/Si ton tag est déjà certifié, rien ne change pour toi ; sinon, certifie-le dans « Mon profil », section Discord/);
    expect(fr).toMatch(/notifications push ne changent pas/);
    expect((entry.links ?? []).map(({ href }) => href)).toEqual(["/profil#discord", "/rgpd#messages-de-match"]);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/certified Discord tag/);
    expect(en).toMatch(/An uncertified tag no longer receives any, whether it was typed by hand or linked by signing in with Discord/);
    // La raison vaut aussi pour un tag rattaché par la connexion Discord (FR et EN).
    expect(fr).toMatch(/et seule la certification confirme que tu acceptes d'y être joint\./);
    expect(en).toMatch(/and only certification confirms that you agree to be reached there\./);
    expect(en).toMatch(/If your tag is already certified, nothing changes for you; otherwise, verify it in “My profile”, Discord section, to receive them/);
    // Le réglage est une case à cocher, nommée comme à l'écran.
    expect(fr).toMatch(/la case « Messages privés Discord de mes matchs » et les messages du staff/);
    expect(en).toMatch(/the “Discord direct messages about my matches” box and staff messages/);
    // L'avis part à tous les comptes, certifiés compris : le lien ne promet pas
    // une certification que la section Discord ne propose plus à un tag certifié.
    expect(entry.links?.[0]?.label).toBe("Voir mon tag Discord");
    expect(english.linkLabels?.[0]).toBe("See my Discord tag");
    expect(english.linkLabels).toHaveLength(2);
    // Revue légale : l'identifiant d'un compte rattaché sans tag certifié ne part plus non plus.
    expect(fr).toMatch(/moins de pseudos et d'identifiants Discord sont transmis au bot/);
    expect(en).toMatch(/fewer Discord usernames and IDs are sent to the bot/);
  });
});

describe("PRIVACY_CHANGES — pseudo dans l'annonce #live et messages privés de match (RGPD-DM-SWITCH)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-pseudo-live-et-messages-de-match")!;
  const english = PRIVACY_CHANGES_EN["2026-10-pseudo-live-et-messages-de-match"];

  it("précède l'entrée des tags certifiés : datée du 16 octobre 2026, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 29);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-16", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("déclare le pseudo publié et sa limite, la durée, la suppression sur demande, les bases légales et l'interrupteur", () => {
    const declared = [entry.title, entry.summary, ...entry.details].join(" ");
    for (const pattern of [
      /pseudo public BlueGenji remplace « un joueur »/,
      /voire le nom de ton compte Google pour un compte Google créé avant le 30 septembre 2026 ; jamais ton identifiant Discord numérique/,
      /modifiable dans Mon profil, sans effet sur une annonce déjà publiée/,
      /Un match d'équipes ne nomme toujours que les équipes/,
      /tant qu'il existe/,
      /demander la suppression/,
      /intérêt légitime, avec un droit d'opposition/,
      /« Messages privés Discord de mes matchs »/,
      /notifications push gardent leurs propres réglages/,
      /exécution du service/,
    ]) {
      expect(declared).toMatch(pattern);
    }
    expect((entry.links ?? []).map(({ href }) => href)).toEqual(["/rgpd#retransmission", "/rgpd#messages-de-match"]);
  });

  it("se traduit détail pour détail et lien pour lien", () => {
    expect([english.details.length, english.linkLabels?.length ?? 0]).toEqual([entry.details.length, entry.links?.length ?? 0]);
    expect(english.title).toBe("Your username in #live announcements, and match direct messages up to you");
    const translated = english.details.join(" ");
    for (const pattern of [/right to object/, /performance of the service/, /or even your Google account name for a Google account created before September 30, 2026; never your numeric Discord identifier/]) {
      expect(translated).toMatch(pattern);
    }
  });
});

describe("PRIVACY_CHANGES — base du pseudo #live, AutoMod et fin des messages de match (LEGAL-FOLLOWUP-444)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-base-pseudo-live-et-automod")!;
  const english = PRIVACY_CHANGES_EN["2026-10-base-pseudo-live-et-automod"];
  const declared = () => [entry.title, entry.summary, ...entry.details].join(" ");

  it("datée du jour du déploiement (15 octobre 2026), placée à sa date avant les entrées du 16, pour tous les comptes", () => {
    expect(entry).toBeDefined();
    // Décision du 2026-10-15 : la date de publication est celle du déploiement.
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-15", undefined]);
    const index = PRIVACY_CHANGES.indexOf(entry);
    expect(PRIVACY_CHANGES[index - 1].publishedAt <= entry.publishedAt).toBe(true);
    expect(PRIVACY_CHANGES[index + 1].publishedAt > entry.publishedAt).toBe(true);
  });

  it("dit la nouvelle base du pseudo solo, sans rien changer dans les faits", () => {
    expect(declared()).toMatch(/exécution du service/);
    expect(declared()).toMatch(/et non plus de l'intérêt légitime/);
    expect(declared()).toMatch(/pas de nom neutre pour cette annonce/);
    expect(declared()).toMatch(/supprimée sur demande/);
  });

  it("déclare l'alerte AutoMod aux modérateurs, et la ligne de fin des messages de match", () => {
    expect(declared()).toMatch(/règle AutoMod de Discord bloque ou signale une annonce #live/);
    expect(declared()).toMatch(/salon d'alertes des modérateurs/);
    // Revue légale #445 : la durée de cette copie est dite (suppression par les modérateurs ou sur demande).
    expect(declared()).toMatch(/où il reste jusqu'à sa suppression par les modérateurs ou sur demande/);
    // Revue légale #445 : une acceptation relue du navigateur n'est plus enregistrée pour un compte existant.
    expect(declared()).toMatch(/ton compte n'enregistre plus une acceptation seulement gardée par ton navigateur/);
    expect(declared()).toMatch(/si tu lances la connexion depuis cette page \(ou y saisis le code Discord\) dans les dix minutes/);
    expect(declared()).toMatch(/« Mon profil », section Notifications/);
    expect(declared()).toMatch(/dans ton intérêt légitime/);
    expect(declared()).not.toMatch(/obligation légale/);
    expect((entry.links ?? []).map(({ href }) => href)).toEqual([
      "/rgpd#retransmission",
      "/rgpd#messages-de-match",
      TERMS_PATH,
    ]);
  });

  // Seul canal qui touche chaque compte une fois (modale à la page suivante,
  // message privé sinon) : la modale des conditions ne s'ouvre d'elle-même
  // qu'aux gérants d'équipe, celle de `/connexion` qu'à la connexion suivante.
  it("prévient chaque compte que les conditions d'utilisation ont changé, version et date en vigueur", () => {
    expect(entry.audience).toBeUndefined();
    expect(entry.title).toMatch(/conditions d'utilisation mises à jour/);
    expect(entry.summary).toMatch(/conditions d'utilisation passent en version 4/);
    const terms = entry.details.find((detail) => detail.startsWith("Conditions d'utilisation"));
    expect(terms).toContain("version 4, en vigueur depuis le 14 octobre 2026");
    // Revue sécurité #445 : la modale de `/connexion` dépend du navigateur, pas du compte
    // (ordinateur partagé) — la promesse le dit, sans annoncer une présentation garantie.
    expect(terms).toContain("la page de connexion te les présente de nouveau tant qu'elles n'ont pas été acceptées dans ton navigateur");
    expect(english.details.at(-1)).toContain("the login page shows them to you anew as long as they have not been accepted in your browser");
    // Revue UI/UX #445 : qui a déjà accepté la version 4 ne se la voit pas représenter avant un geste de gestion.
    expect(terms).toContain("si tu gères une équipe sans les avoir déjà acceptées, avant ton prochain geste de gestion");
    expect(english.details.at(-1)).toContain("if you manage a team and have not already accepted them, before your next management action");
    expect(entry.links?.at(-1)).toEqual({ href: TERMS_PATH, label: "Lire les conditions d'utilisation" });
    expect(english.title).toMatch(/terms of use updated/);
    expect(english.summary).toMatch(/terms of use move to version 4/);
    expect(english.details.at(-1)).toMatch(/version 4, in force since 14 October 2026/);
    expect(english.linkLabels?.at(-1)).toBe("Read the terms of use");
  });

  it("se traduit détail pour détail et lien pour lien", () => {
    expect([english.details.length, english.linkLabels?.length ?? 0]).toEqual([entry.details.length, entry.links?.length ?? 0]);
    const translated = [english.summary, ...english.details].join(" ");
    for (const pattern of [/performance of the service/, /AutoMod/, /moderation alert channel/, /in your legitimate interest/, /where it stays until the moderators delete it or on request/, /your account no longer records an acceptance only kept by your browser/]) {
      expect(translated).toMatch(pattern);
    }
  });

  it("tient dans un message privé à elle seule", () => {
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });
});

describe("PRIVACY_CHANGES — contacts de match dès que les adversaires sont connus (LAUNCH-OPTION)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-contacts-de-match-avant-le-depart")!;
  const english = PRIVACY_CHANGES_EN["2026-10-contacts-de-match-avant-le-depart"];

  it("précède l'entrée du caster et des conditions v5 : datée du 19 octobre 2026, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 27);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-19", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit que les données et leurs destinataires ne changent pas, seulement le moment (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/montrées aux mêmes personnes : les seules parties du match/);
    expect(fr).toMatch(/dès que le match a ses deux adversaires, horaire fixé ou non, et non plus seulement à son lancement/);
    expect(fr).toMatch(/éteinte par défaut/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/shown to the same people: only the parties to the match/);
    expect(en).toMatch(/as soon as the match has both its opponents, with or without a set time, no longer only at its launch/);
    expect(english.details).toHaveLength(entry.details.length);
  });
});

describe("PRIVACY_CHANGES — caster le temps du match, BattleTag masqué et conditions v5 (CONTACTS-FOLLOWUP)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-contacts-de-match-caster-et-conditions-v5")!;
  const english = PRIVACY_CHANGES_EN["2026-10-contacts-de-match-caster-et-conditions-v5"];

  it("précède l'entrée des conditions v6 : datée du 19 octobre 2026, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 26);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-19", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("annonce à chaque compte les conditions en version 5, avec leur date d'entrée en vigueur (FR et EN) — texte déployé, figé", () => {
    expect(entry.summary).toMatch(/conditions d'utilisation passent en version 5/);
    expect(entry.details.at(-1)).toContain("version 5, en vigueur depuis le 19 octobre 2026");
    expect(entry.details.at(-1)).toContain("si tu gères une équipe sans les avoir déjà acceptées, avant ton prochain geste de gestion");
    expect(entry.links?.[0]).toEqual({ href: `${TERMS_PATH}#contacts-de-match`, label: "Lire la section « Contacts de match »" });
    expect(english.summary).toMatch(/terms of use move to version 5/);
    expect(english.details.at(-1)).toContain("version 5, in force since 19 October 2026");
  });

  it("dit que le caster n'a les contacts que le temps du match, et que le BattleTag masqué ne se lit que dans « Contacts » (FR et EN)", () => {
    const fr = [entry.summary, ...entry.details].join(" ");
    const en = [english.summary, ...english.details].join(" ");
    expect(fr).toMatch(/que le temps du match — dès son départ \(fenêtre de lancement ouverte, ou match lancé\) et jusqu'à sa fin —/);
    expect(fr).toContain("Il ne se lit plus que dans la fenêtre « Contacts » d'un match où tu es présenté comme contact");
    expect(fr).toContain("les membres des deux équipes ne voient plus les contacts du caster que le temps du match");
    expect(en).toContain("It can now only be read in the “Contacts” window of a match where you are presented as a contact");
    expect(fr).toMatch(/repose sur l'exécution du service — l'organisation du tournoi —, et non sur ton consentement/);
    expect(en).toMatch(/only see .* while the match is being played — from its start \(launch window opened, or match launched\) to its end —/);
    expect(en).toMatch(/based on the performance of the service — running the tournament —, not on your consent/);
    expect([english.details.length, english.linkLabels?.length ?? 0]).toEqual([entry.details.length, entry.links?.length ?? 0]);
  });
});

describe("PRIVACY_CHANGES — conditions v6 : acceptation par chaque compte (CONTACTS-FOLLOWUP-2)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-conditions-v6-acceptation-pour-tous")!;
  const english = PRIVACY_CHANGES_EN["2026-10-conditions-v6-acceptation-pour-tous"];

  it("précède l'entrée des annonces #live par soirée : datée du jour d'entrée en vigueur, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 25);
    // Datée du jour d'entrée en vigueur de la version 6 (19 octobre 2026) ; la
    // version 7 a depuis sa propre entrée, celle-ci ne se réécrit pas.
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-19", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("annonce la version 6 et sa date, et lie ses deux sections (FR et EN)", () => {
    expect(entry.summary).toMatch(/conditions d'utilisation passent en version 6/);
    expect(entry.details.at(-1)).toContain(`version 6, en vigueur depuis le ${formatTermsDate("2026-10-19")}`);
    expect(entry.links?.map((link) => link.href)).toEqual([`${TERMS_PATH}#acceptation`, `${TERMS_PATH}#contacts-de-match`]);
    expect(english.summary).toMatch(/terms of use move to version 6/);
    expect(english.details.at(-1)).toContain("version 6, in force since 19 October 2026");
    expect([english.details.length, english.linkLabels?.length ?? 0]).toEqual([entry.details.length, entry.links?.length ?? 0]);
  });

  it("dit l'acceptation par tout compte, la fin du report et de son cookie, les sorties possibles (FR et EN)", () => {
    const fr = [entry.summary, ...entry.details].join(" ");
    const en = [english.summary, ...english.details].join(" ");
    expect(fr).toContain("chaque compte connecté doit désormais les accepter pour continuer à utiliser le site");
    expect(fr).toContain("le bouton « Plus tard » et son cookie bg_terms_later disparaissent");
    expect(fr).toMatch(/te déconnecter, lire cette politique, les mentions légales, la déclaration d'accessibilité, les pages légales du bot et les règles des tournois, suivre ou contester tes signalements depuis leur page, signaler un contenu par le bouton « Signaler un problème » de ces pages, et ouvrir ton profil, notamment pour exporter tes données ou supprimer ton compte/);
    expect(fr).toContain("Refuser ne te retire ni de tes équipes ni de tes inscriptions");
    expect(en).toContain("every logged-in account must now accept them to keep using the site");
    expect(en).toContain("the “Later” button and its bg_terms_later cookie are gone");
    expect(en).toMatch(/log out, read this policy, the legal notice, the accessibility statement, the bot's legal pages and the tournament rules, follow or contest your reports from their page, report content through the “Report a problem” button of these pages, and open your profile, notably to export your data or delete your account/);
    expect(en).toContain("Refusing does not remove you from your teams or registrations");
  });

  it("dit que la fenêtre de lancement montre aussi le BattleTag masqué, aux équipes et au caster seulement (FR et EN)", () => {
    const fr = entry.details.join(" ");
    const en = english.details.join(" ");
    expect(fr).toContain("dans la fenêtre « Contacts » du match et dans sa fenêtre de lancement");
    expect(fr).toContain("ne s'ouvre qu'aux deux équipes et au caster");
    expect(en).toContain("in the match's “Contacts” window and in its launch window");
    expect(en).toContain("only opens to both teams and the caster");
  });
});

describe("PRIVACY_CHANGES — annonces #live par soirée (LIVE-EVENING)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-annonces-live-par-soiree")!;
  const english = PRIVACY_CHANGES_EN["2026-10-annonces-live-par-soiree"];

  it("précède l'entrée du « Ne plus afficher » du recrutement : datée du 20 octobre 2026, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 24);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-20", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit le nouveau moment, la modification du message et le public notifié (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/avant même de commencer, avec son heure/);
    expect(fr).toMatch(/reprend alors le pseudo public du moment/);
    expect(fr).toMatch(/chaîne officielle BlueGenji notifie tout le serveur \(@everyone\)/);
    expect(fr).toMatch(/rôle StreamViewer/);
    expect(fr).toMatch(/effacé un jour après la fin de la soirée/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/even before it starts, with its time/);
    expect(en).toMatch(/shows the public username of that moment/);
    expect(en).toMatch(/StreamViewer role/);
    expect(english.details).toHaveLength(entry.details.length);
  });
});

describe("PRIVACY_CHANGES — « Ne plus afficher » de la fenêtre de recrutement (MODAL-DISMISS)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-recrutement-ne-plus-afficher")!;
  const english = PRIVACY_CHANGES_EN["2026-10-recrutement-ne-plus-afficher"];

  it("précède l'entrée de l'arbitre qui joue : datée du 20 octobre 2026, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 23);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-20", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit le cookie, sa durée, le report au compte, l'export et la suppression (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/cookie bg_recr_off \(valeur « 1 », sans identifiant de personne\), gardé un an/);
    expect(fr).toMatch(/reporté sur ton compte à ta connexion suivante/);
    expect(fr).toMatch(/figure dans l'export de tes données et revient au défaut à la suppression du compte/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/bg_recr_off cookie \(value “1”, no personal identifier\), kept for one year/);
    expect(en).toMatch(/carried over to your account at your next login/);
    expect(english.details).toHaveLength(entry.details.length);
  });

  it("dit que décocher « Mon profil » pose le cookie et que le compte garde la mention « réaffichée » (FR et EN)", () => {
    const fr = entry.details.join(" ");
    expect(fr).toMatch(/décocher la case de « Mon profil » le pose aussi/);
    expect(fr).toMatch(/ton compte note alors que tu as réaffiché la fenêtre \(mention gardée jusqu'à un nouveau « Ne plus afficher », présente dans l'export\)/);
    expect(fr).not.toMatch(/ton compte ne le garde plus/);
    const en = english.details.join(" ");
    expect(en).toMatch(/unticking the “My profile” box sets it too/);
    expect(en).toMatch(/your account then records that you turned the window back on \(a mark kept until a new “Don't show again”, included in the export\)/);
    expect(en).not.toMatch(/your account no longer keeps it/);
    expect(fr).toMatch(/\(posé avant, hors connexion, ou faute d'avoir pu être enregistré sur ton compte\) n'y tait la fenêtre que chez lui/);
    expect(en).toMatch(/\(set earlier, while logged out, or because it could not be saved to your account\) only keeps the window closed there/);
  });
});

describe("PRIVACY_CHANGES — arbitre qui joue le match (DISPUTE-FOLLOWUP, #456)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-arbitre-qui-joue-le-match")!;
  const english = PRIVACY_CHANGES_EN["2026-10-arbitre-qui-joue-le-match"];

  it("précède l'entrée de la pastille BattleTag : datée du jour de la fusion, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 22);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-20", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit les destinataires, le sujet refusable, le contenu sans pseudo et le journal (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/aux autres arbitres et administrateurs abonnés aux notifications push \(sujet « Arbitrage par un joueur du staff », actif par défaut, que tu peux couper dans « Mon profil »\), jamais à l'auteur/);
    expect(fr).toMatch(/si son auteur est membre d'une des deux équipes du match, ou l'a quittée depuis le lancement du match, son premier report ou, à défaut, sa création/);
    expect(fr).toMatch(/sans le pseudo de l'auteur ni d'aucun joueur/);
    expect(fr).toMatch(/ne dit sur Discord que le tournoi et la nature du geste, sans nom/);
    expect(fr).toMatch(/le pseudo et l'identifiant de compte de son auteur/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/topic “Refereeing by a staff player”, on by default, which you can turn off in “My profile”\), never to the author/);
    expect(en).toMatch(/whether its author is a member of one of the two teams of the match, or left it since the match was launched, its first report or, failing these, its creation/);
    expect(en).toMatch(/without the username of the author or of any player/);
    expect(en).toMatch(/gives on Discord only the tournament and the kind of action, unnamed/);
    expect(fr).toMatch(/la manche et, sauf pour une suspension, l'issue retenue avec les noms d'équipe/);
    expect(fr).toMatch(/la manche, l'issue et les noms d'équipe \(ni l'une ni les autres pour une suspension, aucun nom en tournoi individuel\), et le pseudo et l'identifiant de compte de son auteur/);
    expect(fr).toMatch(/que son auteur joue le match ou non, laisse aussi dans les journaux du serveur une trace courte/);
    expect(en).toMatch(/the round and, except for a pause, the retained outcome with the team names/);
    expect(en).toMatch(/the round, the outcome and the team names \(neither for a pause, no names in a solo tournament\), and the username and account ID of its author/);
    expect(en).toMatch(/whether or not its author plays in the match, also leaves a short trace in the server logs/);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
  });
});

describe("PRIVACY_CHANGES — pastille « BattleTag vérifié » sur la fiche (PROFILE-BATTLETAG-BADGE)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-pastille-battletag-fiche")!;
  const english = PRIVACY_CHANGES_EN["2026-10-pastille-battletag-fiche"];

  it("précède l'entrée de la certification proposée à la connexion : datée du 21 octobre 2026, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 21);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-21", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit le public, le BattleTag masqué jamais montré et le geste qui retire la pastille (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/à tout joueur connecté qui la consulte — y compris quand ton BattleTag est masqué/);
    expect(fr).toMatch(/sans jamais montrer le BattleTag/);
    expect(fr).toMatch(/Tu peux t'y opposer par le formulaire de signalement \(catégorie RGPD\)/);
    expect(fr).toMatch(/après avoir ajouté un autre moyen de connexion si c'est le seul/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/to any logged-in player who opens it — including when your BattleTag is hidden/);
    expect(en).toMatch(/never showing the BattleTag/);
    expect(en).toMatch(/You can object to it through the report form \(GDPR category\)/);
    expect(en).toMatch(/after adding another login method if it is your only one/);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
  });
});

describe("PRIVACY_CHANGES — certification du tag Discord proposée à la connexion (CERTIFY-PROMPT)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-proposition-certification-discord")!;
  const english = PRIVACY_CHANGES_EN["2026-10-proposition-certification-discord"];

  it("précède l'entrée des contacts du caster aux arbitres : datée du 21 octobre 2026, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 20);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-21", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit les portes, que la connexion ne certifie rien, et ce que gardent « Plus tard » et « Ne plus voir » (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/connexion par Discord ou par Blizzard/);
    expect(fr).toMatch(/Se connecter ne certifie toujours rien/);
    expect(fr).toMatch(/« Plus tard » \(ou fermer la fenêtre\) ne garde rien sur ton compte/);
    expect(fr).toMatch(/« Ne plus voir » est gardé sur ton compte, avec sa date/);
    expect(fr).toMatch(/figure dans l'export de tes données et est effacé si le compte est anonymisé/);
    expect(fr).toMatch(/Une connexion par Google n'ouvre pas cette fenêtre/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/logging in with Discord or with Blizzard/);
    expect(en).toMatch(/Logging in still verifies nothing/);
    expect(en).toMatch(/Logging in with Google doesn't open this window/);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
  });
});

describe("PRIVACY_CHANGES — contacts du caster aux arbitres (CASTER-CONTACTS-REFEREES)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-contacts-du-caster-aux-arbitres")!;
  const english = PRIVACY_CHANGES_EN["2026-10-contacts-du-caster-aux-arbitres"];

  it("précède l'entrée des messages Discord dans ta langue : datée du 21 octobre 2026, pour les seuls comptes qui peuvent caster, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 19);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-21", "LIVE_STAFF"]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit le nouveau moment pour les arbitres, l'inchangé pour les équipes, et l'absence de nouvelle version (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/les arbitres et les administrateurs voient tes contacts dès que ses deux adversaires sont connus/);
    expect(fr).toMatch(/ses deux équipes ne les voient toujours que le temps du match/);
    expect(fr).toMatch(/sans nouvelle version à accepter/);
    // Les administrateurs voyaient déjà le tag Discord certifié : seul le BattleTag change pour eux.
    expect(fr).toMatch(/pour eux, seul ton BattleTag est concerné/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/referees and administrators see your contacts as soon as both its opponents are known/);
    expect(en).toMatch(/both its teams still only see them while the match is being played/);
    expect(en).toMatch(/with no new version to accept/);
    expect(en).toMatch(/for them, only your BattleTag is affected/);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
  });
});

describe("PRIVACY_CHANGES — messages privés Discord dans la langue du compte (BOT-NOTIF-LANG)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-messages-discord-dans-ta-langue")!;
  const english = PRIVACY_CHANGES_EN["2026-10-messages-discord-dans-ta-langue"];

  it("avant-dernière (puis LEGAL-OPTOUT-BASIS) : datée du lendemain de la fusion prévue, pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 18);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-27", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    const [englishEntry] = localizedPrivacyChanges([entry], "en");
    expect(buildPrivacyChangesMessage([englishEntry], "https://site.test", "en").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit le nouvel usage de la langue, le bot qui la reçoit sans la garder, le repli bilingue et les salons en français (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/rédigés dans la langue de ton compte, français ou anglais/);
    expect(fr).toMatch(/certification ou changement du tag\), le site transmet au bot de l'association la langue du compte déjà rattaché à ce compte Discord, et le bot rédige le code dans cette langue sans la garder/);
    expect(fr).toMatch(/en français seul si les deux ne tiennent pas dans un message/);
    expect(fr).toMatch(/en français puis en anglais/);
    expect(fr).toMatch(/Les messages publiés dans les salons Discord restent en français/);
    expect(fr).toMatch(/Aucune donnée nouvelle n'est collectée/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/written in your account's language, French or English/);
    expect(en).toMatch(/certification or change of the tag\), the site sends the association's bot the language of the account already linked to that Discord account, and the bot writes the code in that language without keeping it/);
    expect(en).toMatch(/in French alone when both do not fit in one message/);
    expect(en).toMatch(/in French then in English/);
    expect(en).toMatch(/Messages posted in Discord channels stay in French/);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
    expect(entry.links).toEqual([{ href: "/rgpd#notifications", label: "Lire la section « Notifications push »" }]);
  });
});

describe("PRIVACY_CHANGES — base légale de la conservation du choix des messages de match (LEGAL-OPTOUT-BASIS)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-base-du-choix-des-messages-de-match")!;
  const english = PRIVACY_CHANGES_EN["2026-10-base-du-choix-des-messages-de-match"];
  const older = PRIVACY_CHANGES.find((c) => c.id === "2026-10-base-pseudo-live-et-automod")!;

  it("précède l'entrée des sauvegardes deux fois par semaine : datée du 27 octobre (mise en ligne groupée), pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expect(entry).toBeDefined();
    expect(english).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 17);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-27", undefined]);
    expect(PRIVACY_CHANGES.at(-18)!.publishedAt <= entry.publishedAt).toBe(true);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    const [englishEntry] = localizedPrivacyChanges([entry], "en");
    expect(buildPrivacyChangesMessage([englishEntry], "https://site.test", "en").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit la nouvelle base (obligation légale) du choix, rien de changé dans les faits, les messages toujours d'intérêt légitime (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/au titre d'une obligation légale — continuer d'honorer ton opposition —, et non plus dans ton intérêt légitime/);
    expect(fr).toMatch(/Rien ne change dans les faits : la case « Messages privés Discord de mes matchs » de « Mon profil »/);
    expect(fr).toMatch(/horaire, rappels, « Match retiré »/);
    expect(fr).toMatch(/le choix est gardé le temps du compte, seulement pour être respecté/);
    expect(fr).toMatch(/Les messages eux-mêmes reposent toujours sur l'intérêt légitime de l'association, avec ton droit d'opposition/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/under a legal obligation — to keep honouring your objection — and no longer in your legitimate interest/);
    expect(en).toMatch(/Nothing changes in practice: the “Discord direct messages about my matches” box in “My profile”/);
    expect(en).toMatch(/time, reminders, “Match retiré”/);
    expect(en).toMatch(/the choice is kept for the lifetime of the account, only so that it is respected/);
    expect(en).toMatch(/The messages themselves are still based on the association's legitimate interest, with your right to object/);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toEqual(["Read the “Match Discord direct messages” paragraph"]);
    expect(entry.links).toEqual([{ href: "/rgpd#messages-de-match", label: "Lire le paragraphe « Messages privés Discord de match »" }]);
  });

  it("laisse intacte l'entrée publiée du 15 octobre, qui disait l'ancienne base (FR et EN)", () => {
    expect(older.publishedAt).toBe("2026-10-15");
    expect(older.details).toContain("Messages privés de match : chacun se termine désormais par une ligne qui dit où les couper (« Mon profil », section Notifications). Le site garde ton choix dans ton intérêt légitime : c'est ce qui lui permet de l'honorer.");
    expect(PRIVACY_CHANGES_EN["2026-10-base-pseudo-live-et-automod"].details).toContain("Match direct messages: each now ends with a line saying where to turn them off (“My profile”, Notifications section). The site keeps your choice in your legitimate interest: that is what lets it honour it.");
  });
});

describe("PRIVACY_CHANGES — sauvegardes deux fois par semaine, entrée rectificative (BACKUP-SCHEDULE)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-sauvegardes-deux-fois-par-semaine")!;
  const english = PRIVACY_CHANGES_EN["2026-10-sauvegardes-deux-fois-par-semaine"];
  const older = PRIVACY_CHANGES.find((c) => c.id === "2026-09-sauvegardes-chiffrees")!;

  it("précède l'entrée de l'avis de retrait du cast : datée du 27 octobre (mise en ligne groupée), pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expect(entry).toBeDefined();
    expect(english).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 16);
    expect([entry.publishedAt, entry.audience, entry.links]).toEqual(["2026-10-27", undefined, undefined]);
    expect(PRIVACY_CHANGES.at(-17)!.publishedAt <= entry.publishedAt).toBe(true);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    const [englishEntry] = localizedPrivacyChanges([entry], "en");
    expect(buildPrivacyChangesMessage([englishEntry], "https://site.test", "en").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit dimanche et mardi soir au lieu d'une fois par semaine, le reste inchangé (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/deux fois par semaine, le dimanche et le mardi soir, et non plus une fois par semaine comme l'annonçait l'information du 23 septembre 2026/);
    expect(fr).toContain(`le chiffrement et la durée de conservation ne changent pas : chaque archive est détruite au bout de ${BACKUP_RETENTION_DAYS} jours au plus`);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/twice a week, on Sunday and Tuesday evenings, and no longer once a week as stated in the information of September 23, 2026/);
    expect(en).toContain(`the encryption and the retention period do not change: each archive is destroyed after ${BACKUP_RETENTION_DAYS} days at most`);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toBeUndefined();
  });

  it("laisse intacte l'entrée publiée du 23 septembre qu'elle rectifie", () => {
    expect(older.publishedAt).toBe("2026-09-23");
    expect(older.details[0]).toBe(`La base de données est sauvegardée chaque semaine dans une archive chiffrée avant envoi, avec une clé que seule l'association détient, puis hébergée chez Microsoft (OneDrive), qui la stocke sans pouvoir la lire. Chaque archive est détruite au bout de ${BACKUP_RETENTION_DAYS} jours, sans passer par une corbeille.`);
    expect(PRIVACY_CHANGES_EN["2026-09-sauvegardes-chiffrees"].details[0]).toMatch(/^The database is backed up every week in an archive encrypted before upload/);
  });
});


/** Entrée du groupe MATCH-REFEREE / LOGS-NOTIFS : place, date, public, lien, et tient seule dans un message privé (FR et EN). */
function expectStandaloneEntry(
  entry: PrivacyChange,
  english: unknown,
  expected: { fromEnd: number; publishedAt: string; audience: PrivacyChange["audience"]; links: PrivacyChange["links"] },
): void {
  expect(entry).toBeDefined();
  expect(english).toBeDefined();
  expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - expected.fromEnd);
  expect([entry.publishedAt, entry.audience]).toEqual([expected.publishedAt, expected.audience]);
  expect(PRIVACY_CHANGES.at(-(expected.fromEnd + 1))!.publishedAt <= entry.publishedAt).toBe(true);
  expect(entry.links).toEqual(expected.links);
  expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  const [englishEntry] = localizedPrivacyChanges([entry], "en");
  expect(buildPrivacyChangesMessage([englishEntry], "https://site.test", "en").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
}

/** Ce que l'entrée dit, en français et en anglais, avec autant de détails et un libellé de lien par langue. */
function expectEntryTexts(
  entry: PrivacyChange,
  english: (typeof PRIVACY_CHANGES_EN)[string],
  expected: { fr: readonly string[]; en: readonly string[] },
): void {
  const fr = [entry.title, entry.summary, ...entry.details].join(" ");
  for (const text of expected.fr) expect(fr).toContain(text);
  const en = [english.title, english.summary, ...english.details].join(" ");
  for (const text of expected.en) expect(en).toContain(text);
  expect(english.details).toHaveLength(entry.details.length);
  expect(english.linkLabels).toHaveLength(1);
}

describe("PRIVACY_CHANGES — avis de retrait du cast (LOGS-NOTIFS ln-1)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-avis-de-retrait-du-cast")!;
  const english = PRIVACY_CHANGES_EN["2026-10-avis-de-retrait-du-cast"];

  it("ferme la liste : datée du 29 octobre (lendemain de la mise en ligne prévue), pour les seuls casters, et tient seule dans un message privé (FR et EN)", () => {
    expect(entry).toBeDefined();
    expect(english).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 15);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-29", "LIVE_STAFF"]);
    expect(PRIVACY_CHANGES.at(-16)!.publishedAt <= entry.publishedAt).toBe(true);
    expect(entry.links).toEqual([{ href: "/rgpd#messages-de-match", label: "Lire le paragraphe « Messages privés Discord de match »" }]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    const [englishEntry] = localizedPrivacyChanges([entry], "en");
    expect(buildPrivacyChangesMessage([englishEntry], "https://site.test", "en").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit qui est prévenu, comment, avec quel motif, et le journal anonyme (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toContain("en message privé Discord et en notification push, avec le motif");
    expect(fr).toContain("jamais qui a retiré l'inscription");
    expect(fr).toContain("ne part qu'à un tag Discord certifié");
    expect(fr).toContain("« Messages privés Discord de mes matchs »");
    expect(fr).toContain("sans nommer personne (« un caster », « le staff »)");
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toContain("by Discord direct message and push notification, with the reason");
    expect(en).toContain("never who removed the registration");
    expect(en).toContain("only goes to a certified Discord tag");
    expect(en).toContain("without naming anyone (“a caster”, “the staff”)");
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(1);
  });
});

describe("PRIVACY_CHANGES — plusieurs casters par match (MATCH-REFEREE MR-1)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-plusieurs-casters-par-match")!;
  const english = PRIVACY_CHANGES_EN["2026-10-plusieurs-casters-par-match"];

  it("précède l'entrée de l'arbitre désigné : datée comme l'entrée précédente (mise en ligne groupée), pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expect(entry).toBeDefined();
    expect(english).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 14);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-29", undefined]);
    expect(PRIVACY_CHANGES.at(-15)!.publishedAt <= entry.publishedAt).toBe(true);
    expect(entry.links).toEqual([{ href: "/rgpd#retransmission", label: "Lire le paragraphe « Retransmission des matchs »" }]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    const [englishEntry] = localizedPrivacyChanges([entry], "en");
    expect(buildPrivacyChangesMessage([englishEntry], "https://site.test", "en").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit les nouveaux destinataires, ce qui part avec un caster et la fin des reprises (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toContain("chacun rejoint un stream du match (co-cast) ou ouvre le sien, avec son propre lien");
    expect(fr).toContain("le sont à chaque caster inscrit, et ceux de chaque caster aussi aux autres casters du match");
    expect(fr).toContain("le temps du match seulement");
    expect(fr).toContain("ce stream part, avec son lien, quand plus aucun caster ne le tient");
    expect(fr).toContain("seul le lien posé dans la configuration du direct du match reste au match");
    // Le lien fourni part à la suppression du compte (décision 27).
    expect(fr).toContain("À la suppression de ton compte, le lien que tu as fourni — en ouvrant ton stream ou dans cette configuration — part aussi, matchs joués compris, même si un autre caster tient encore ce stream");
    expect(fr).toContain("Un caster n'en remplace plus un autre");
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toContain("each one joins a stream of the match (co-cast) or opens their own, with its own link");
    expect(en).toContain("are presented to each registered caster, and each caster's are also presented to the other casters of the match");
    expect(en).toContain("that stream goes, with its link, once no caster holds it any more");
    expect(en).toContain("only the link set in the match's live configuration stays with the match");
    expect(en).toContain("When your account is deleted, the link you provided — when opening your stream or in that configuration — also goes, played matches included, even if another caster still holds that stream");
    expect(en).toContain("A caster no longer replaces another");
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(1);
  });
});

describe("PRIVACY_CHANGES — arbitre désigné des matchs (MATCH-REFEREE MR-2)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-arbitre-designe-des-matchs")!;
  const english = PRIVACY_CHANGES_EN["2026-10-arbitre-designe-des-matchs"];

  it("précède l'entrée des réglages du salon : datée comme l'entrée précédente (mise en ligne groupée), pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expect(entry).toBeDefined();
    expect(english).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 13);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-29", undefined]);
    expect(PRIVACY_CHANGES.at(-14)!.publishedAt <= entry.publishedAt).toBe(true);
    expect(entry.links).toEqual([{ href: "/rgpd#arbitre-designe", label: "Lire le paragraphe « Arbitre désigné d'un match »" }]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
    const [englishEntry] = localizedPrivacyChanges([entry], "en");
    expect(buildPrivacyChangesMessage([englishEntry], "https://site.test", "en").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit qui voit l'arbitre, ce qui est montré, l'avis push et le journal anonyme (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toContain("le public ne lit que « Arbitre désigné »");
    expect(fr).toContain("son pseudo et son BattleTag, même masqué, jamais son tag Discord");
    expect(fr).toContain("en notification push seulement, avec le motif");
    expect(fr).toContain("À la suppression de ton compte, tu es retiré de tous tes matchs");
    expect(fr).toContain("sans nommer personne");
    expect(fr).toContain("sans rien basculer d'office");
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toContain("the public only reads “Referee assigned”");
    expect(en).toContain("their username and BattleTag, even when hidden, never their Discord tag");
    expect(en).toContain("by push notification only, with the reason");
    expect(en).toContain("When your account is deleted, you are removed from all your matches");
    expect(en).toContain("without naming anyone");
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(1);
  });
});

describe("PRIVACY_CHANGES — réglages du salon envoyés aux managers (MATCH-REFEREE MR-4)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-reglages-du-salon-aux-managers")!;
  const english = PRIVACY_CHANGES_EN["2026-10-reglages-du-salon-aux-managers"];

  it("précède l'entrée des conditions v7 : datée comme elle, lendemain de la mise en ligne (§ Dates corrigées), pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expectStandaloneEntry(entry, english, { fromEnd: 12, publishedAt: "2026-10-29", audience: undefined, links: [
      { href: "/rgpd#messages-de-match", label: "Lire le paragraphe « Messages privés Discord de match »" },
    ] });
  });

  it("dit qui reçoit quoi, ce qui n'y est jamais, et comment le couper (FR et EN)", () => {
    expectEntryTexts(entry, english, {
      fr: [
        "propriétaire ou manager",
        "Il ne contient ni BattleTag, ni tag Discord, ni pseudo de joueur",
        "« toi » et « ton adversaire »",
        "ne part qu'à un tag Discord certifié",
        "« Réglages du salon »",
      ],
      en: [
        "owner or manager",
        "It contains no BattleTag, no Discord tag and no player username",
        "“you” and “your opponent”",
        "only goes to a certified Discord tag",
        "“Lobby settings”",
      ],
    });
  });
});

// TERMS v7 : une entrée pour tous les comptes annonce la version 7 des
// conditions (casters au pluriel, arbitre désigné, page du match, message #live
// de la soirée, suppression depuis la fenêtre d'acceptation) et le passage de la
// présentation de l'arbitre désigné de l'intérêt légitime à l'exécution du service.
describe("PRIVACY_CHANGES — conditions v7 : casters, arbitre désigné et page du match (TERMS v7)", () => {
  const entry = PRIVACY_CHANGES.find((c) => c.id === "2026-10-conditions-v7-casters-et-arbitre")!;
  const english = PRIVACY_CHANGES_EN["2026-10-conditions-v7-casters-et-arbitre"];

  it("précède l'entrée EF-04 : datée du jour d'entrée en vigueur de la version 7 (mise en ligne groupée), pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expectStandaloneEntry(entry, english, {
      fromEnd: 11,
      publishedAt: "2026-10-29",
      audience: undefined,
      links: [
        { href: `${TERMS_PATH}#contacts-de-match`, label: "Lire la section « Contacts de match »" },
        { href: `${TERMS_PATH}#retransmission`, label: "Lire la section « Retransmission des matchs »" },
        { href: "/rgpd#arbitre-designe", label: "Lire le paragraphe « Arbitre désigné d'un match »" },
      ],
    });
  });

  it("PRIVACY_CHANGES_v7_asksTermsAcceptance : à accepter, dit dans le résumé (FR et EN)", () => {
    expect(entry.asksTermsAcceptance).toBe(true);
    expect(entry.summary).toContain("Elle est à accepter : une fenêtre te la présente tant que tu ne l'as pas acceptée.");
    expect(english.summary).toContain("It must be accepted: a window presents it to you until you have accepted it.");
  });

  it("annonce la version en vigueur et sa date, avec un libellé anglais par lien (FR et EN)", () => {
    expect(entry.summary).toMatch(/conditions d'utilisation passent en version 7/);
    expect(entry.details.at(-1)).toContain(`version 7, en vigueur depuis le ${formatTermsDate("2026-10-29")}`);
    expect(english.summary).toMatch(/terms of use move to version 7/);
    expect(english.details.at(-1)).toContain("version 7, in force since 29 October 2026");
    expect([english.details.length, english.linkLabels?.length ?? 0]).toEqual([entry.details.length, entry.links?.length ?? 0]);
  });

  it("dit les casters au pluriel, l'arbitre désigné, la page du match et le passage à l'exécution du service (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(fr).toContain("ceux de chaque caster aussi aux autres casters du match");
    expect(fr).toContain("son pseudo et son BattleTag, même masqué, jamais son tag Discord");
    expect(fr).toContain("repose désormais sur l'exécution du service, et non plus sur l'intérêt légitime, dès que cet arbitre a accepté cette version");
    expect(fr).toContain("l'opposition par le formulaire de signalement ne s'y applique plus");
    // Décision du gestionnaire (revue juridique de #491) : avant l'acceptation, l'intérêt légitime et l'opposition.
    expect(fr).toContain("Tant que tu ne l'as pas acceptée, elle reste fondée sur l'intérêt légitime, et tu peux t'y opposer par le formulaire de signalement (catégorie RGPD)");
    expect(fr).toContain("les contacts des équipes restent dans les fenêtres « Contacts » et de lancement");
    expect(en).toContain("each caster's also to the other casters of the match");
    expect(en).toContain("their username and BattleTag, even when hidden, never their Discord tag");
    expect(en).toContain("now rests on the performance of the service, no longer on legitimate interest, once that referee has accepted this version");
    expect(en).toContain("objecting through the report form no longer applies to it");
    expect(en).toContain("Until you accept it, it still rests on legitimate interest, and you can object to it through the report form (GDPR category)");
    // Revue juridique de #491 : opposition déjà retenue, arbitre devenu joueur, arbitre qui caste aussi.
    expect(fr).toContain("une opposition déjà retenue continue de valoir (le staff ne te confie plus de match ; ceux que tu tiens déjà te restent)");
    // Avant l'acceptation, la fenêtre bloquante couvre les tournois : le retrait passe par le formulaire (/signalements, page libre).
    expect(fr).toContain("la fenêtre d'acceptation couvrant alors les pages des tournois, tu te retires d'un match en le demandant par ce même formulaire");
    expect(en).toContain("as the acceptance window then covers the tournament pages, you withdraw from a match by asking for it through that same form");
    expect(TERMS_FREE_PATHS).toContain("/signalements");
    // Revue juridique de #491 : la page du match montre aussi le pseudo de l'arbitre désigné.
    expect(fr).toContain("et le pseudo et le BattleTag, même masqué, de l'arbitre désigné, aux mêmes personnes");
    expect(en).toContain("and the assigned referee's username and BattleTag, even when hidden, to the same people");
    expect(en).toContain("an objection already upheld still stands (the staff no longer assigns you matches; those you already hold stay yours)");
    expect(fr).toContain("ou si tu deviens joueur du match avant son lancement, tu n'es plus présenté");
    expect(en).toContain("or become a player of the match before its launch, you are no longer presented");
    expect(fr).toContain("jamais son tag Discord à ce titre (s'il caste aussi le match, ses contacts de caster suivent la règle des casters)");
    expect(en).toContain("never their Discord tag in that capacity (if they also cast the match, their caster contacts follow the casters' rule)");
    expect(en).toContain("the teams' contacts stay in the “Contacts” and launch windows");
  });

  it("dit le message #live de la soirée avant et après le match, et la suppression depuis la fenêtre d'acceptation (FR et EN)", () => {
    const fr = entry.details.join(" ");
    const en = english.details.join(" ");
    expect(fr).toContain("avant le début d'un match programmé dans la soirée (un match dont la diffusion doit s'ouvrir à son heure de début) et une fois le match terminé, pas seulement à son départ");
    expect(fr).toContain("ne laisse aucune trace sur le site");
    expect(fr).toContain("supprimer ton compte directement depuis la fenêtre qui te les présente");
    expect(en).toContain("before a match scheduled that evening starts (a match whose broadcast is set to open at its start time) and once the match is finished, not only when it starts");
    expect(en).toContain("leaves no trace on the site");
    expect(en).toContain("delete your account directly from the window that presents them to you");
  });
});

// ERREUR-FIX EF-04 : le « Ne plus voir » de l'invitation à certifier (fiche
// d'un tournoi) passe du stockage local au compte — une donnée de plus sur le
// serveur, annoncée à tous les comptes.
describe("PRIVACY_CHANGES — « Ne plus voir » de l'invitation à certifier sur le compte (EF-04)", () => {
  const id = "2026-10-ne-plus-voir-invitation-certification-sur-le-compte";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("précède l'entrée rectificative EF-05, datée comme l'entrée précédente, pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expectStandaloneEntry(entry, english, {
      fromEnd: 10,
      publishedAt: "2026-10-29",
      audience: undefined,
      links: [{ href: "/rgpd#cookies", label: "Lire la section « Cookies & traceurs »" }],
    });
    expect(english.linkLabels).toEqual(["Read the “Cookies & trackers” section"]);
  });

  it("dit le choix gardé sur le compte, exporté, effacé à l'anonymisation, et la fermeture limitée à l'onglet (FR et EN)", () => {
    const fr = [entry.summary, ...entry.details].join(" ");
    const en = [english.summary, ...english.details].join(" ");
    expect(fr).toContain("est désormais gardé sur ton compte, et non plus dans le navigateur");
    expect(fr).toContain("ne s'applique plus aux autres comptes utilisés dans le même navigateur");
    expect(fr).toContain("Elle figure dans l'export de tes données et est effacée à l'anonymisation du compte");
    expect(fr).toContain("reste retenue pour l'onglet seulement");
    expect(en).toContain("is now kept on your account, no longer in the browser");
    expect(en).toContain("no longer to the other accounts used in the same browser");
    expect(en).toContain("It is included in the export of your data and erased when the account is anonymised");
    expect(en).toContain("is still remembered for the tab only");
    expect([english.details.length, english.linkLabels?.length ?? 0]).toEqual([entry.details.length, entry.links?.length ?? 0]);
  });

  it("dit qu'un ancien choix du navigateur n'est pas repris et n'est effacé qu'à l'ouverture d'une fiche de tournoi (FR et EN)", () => {
    const fr = entry.details.join(" ");
    const en = english.details.join(" ");
    expect(fr).toContain("n'est pas repris sur ton compte : la fenêtre peut revenir une fois, à cocher de nouveau");
    expect(fr).toContain("elle est effacée à l'ouverture de la fiche d'un tournoi");
    expect(fr).not.toContain("est retirée de ton navigateur");
    expect(en).toContain("is not carried over to your account: the window may come back once, to be ticked again");
    expect(en).toContain("it is erased when a tournament page opens");
    expect(en).not.toContain("is removed from your browser");
  });

  it("donne au registre (T04, FR et EN) une base légale pour garder ce choix sur le compte", () => {
    const fr = PROCESSING_ACTIVITIES.find((a) => a.ref === "T04")!;
    const en = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T04")!;
    expect(fr.legalBasis).toContain(
      "exécution du service demandé par le joueur (contrat) pour la conservation sur son compte de son choix « Ne plus voir » de l'invitation à certifier",
    );
    expect(en.legalBasis).toContain(
      "performance of the service requested by the player (contract) for keeping on their account their “Don't show again” choice on the invitation to verify",
    );
  });
});

// ERREUR-FIX EF-05 : l'entrée du 21 octobre (publiée) décrivait la marque de
// session comme posée par « Plus tard » ; une entrée rectificative dit ce que
// fait le code (posée à la connexion, levée à la première réponse).
describe("PRIVACY_CHANGES — marque de session de la proposition de certification, entrée rectificative (EF-05)", () => {
  const id = "2026-10-proposition-certification-discord-marque-de-session";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("précède l'entrée du BattleTag hors Overwatch, datée comme l'entrée précédente, pour tous les comptes, et tient seule dans un message privé (FR et EN)", () => {
    expectStandaloneEntry(entry, english, {
      fromEnd: 9,
      publishedAt: "2026-10-29",
      audience: undefined,
      links: [{ href: "/rgpd#donnees-collectees", label: "Lire la section « Données collectées »" }],
    });
    expect(english.linkLabels).toEqual(["Read the “Data collected” section"]);
  });

  // Son texte n'est figé qu'à un endroit : tests/lib/shared/legal-texts-ef05.test.ts.
  it("rectifie l'entrée du 21 octobre sans la réécrire (FR et EN)", () => {
    expect([english.details.length, english.linkLabels?.length ?? 0]).toEqual([entry.details.length, entry.links?.length ?? 0]);
    const published = PRIVACY_CHANGES.find((c) => c.id === "2026-10-proposition-certification-discord")!;
    expect(PRIVACY_CHANGES.indexOf(published)).toBeLessThan(PRIVACY_CHANGES.indexOf(entry));
  });
});

describe("PRIVACY_CHANGES — EF-19 : entrées du 2026-10-29 rectifiées avant publication", () => {
  const caster = PRIVACY_CHANGES.find((c) => c.id === "2026-10-plusieurs-casters-par-match")!;
  const casterEn = PRIVACY_CHANGES_EN["2026-10-plusieurs-casters-par-match"];
  const referee = PRIVACY_CHANGES.find((c) => c.id === "2026-10-arbitre-designe-des-matchs")!;
  const refereeEn = PRIVACY_CHANGES_EN["2026-10-arbitre-designe-des-matchs"];

  it("EF-19 : un lien inchangé n'est pas réécrit (`setStaffStreamUrl`) ; posé hors cast, il reste à l'organisation (FR et EN)", () => {
    expect(caster.details.join(" ")).toContain("(posée avant ton inscription comme caster ou après l'avoir quitté, elle reste le lien de l'organisation ; réenregistrer un lien déjà posé n'en change pas l'auteur)");
    expect(casterEn.details.join(" ")).toContain("(set before you signed up as its caster or after you left it, it stays the organizers' link; re-saving a link already set does not change its author)");
    expect(readFileSync(join(process.cwd(), "app/rgpd/page.tsx"), "utf8")).not.toContain("qui ne caste pas encore ce match");
  });

  it("EF-19 : arbitre qui caste aussi le match, désignation, remplacement et cartes du pool notés au journal (`refereeLogChange`)", () => {
    const [fr, en] = [referee, refereeEn].map(({ details }) => details.join(" "));
    expect(fr).toContain("jamais son tag Discord à ce titre (s'il caste aussi le match, ses contacts de caster suivent la règle des casters)");
    expect(en).toContain("never their Discord tag in that capacity (if they also cast the match, their caster contacts follow the casters' rule)");
    expect(fr).toContain("La prise d'un match, la désignation ou le remplacement de son arbitre par le staff, le retrait de l'arbitrage, l'autogestion, la première carte et les cartes choisies dans le pool de la manche sont notés");
    expect(en).toContain("Taking a match, the staff assigning or replacing its referee, the removal of the refereeing, self-management, the first map and the maps picked from the round's pool are noted");
  });
});

// Décisions de l'utilisateur 35 et 38 (2026-10-28) : hors Overwatch, aucun
// BattleTag n'est plus envoyé par la lecture des contacts (`withGameBattletag`).
describe("PRIVACY_CHANGES — BattleTag des matchs en Overwatch seulement (décisions 35 et 38)", () => {
  const id = "2026-10-battletag-des-matchs-overwatch-seulement";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("privacyChanges_battletagMatchesOverwatchOnly_closesListDated1030ForAllAccounts", () => {
    expectStandaloneEntry(entry, english, {
      fromEnd: 8,
      publishedAt: "2026-10-30",
      audience: undefined,
      links: [
        { href: "/rgpd#donnees-collectees", label: "Lire la section « Données collectées »" },
        { href: "/rgpd#arbitre-designe", label: "Lire le paragraphe « Arbitre désigné d'un match »" },
      ],
    });
    expect(english.linkLabels).toEqual(["Read the “Data collected” section", "Read the “Assigned referee of a match” paragraph"]);
    expect(id.length).toBeLessThanOrEqual(PRIVACY_CHANGE_ID_MAX_LENGTH);
  });

  it("privacyChanges_battletagMatchesOverwatchOnly_namesTeamsCastersRefereeFrAndEn", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    const en = [english.title, english.summary, ...english.details].join(" ");

    expect(fr).toContain("ni celui des contacts des équipes, ni celui des casters, ni celui de l'arbitre désigné");
    expect(fr).toContain("le site ne l'envoie plus du tout à ces fenêtres");
    expect(fr).toContain("se choisit alors sur le seul tag Discord certifié");
    expect(en).toContain("neither the teams' contacts', nor the casters', nor the assigned referee's");
    expect(en).toContain("the site no longer sends it to these windows at all");
    expect(en).toContain("chosen on the certified Discord tag alone");
    expect(english.details).toHaveLength(entry.details.length);
  });

  // `sideContacts` : hors Overwatch, le pool n'a plus de BattleTag, donc
  // `pickLaunchContacts` ne rend qu'un contact par équipe.
  it("privacyChanges_battletagMatchesOverwatchOnly_statesSingleTeamContactFrAndEn", () => {
    const fr = entry.details.join(" ");
    const en = english.details.join(" ");

    expect(fr).toContain("Une équipe n'y présente plus qu'un seul contact");
    expect(fr).toContain("un BattleTag vérifié ne fait plus passer devant ni présenter un second membre");
    expect(en).toContain("A team now presents only one contact there");
    expect(en).toContain("a verified BattleTag no longer moves a player up nor brings in a second member");
  });

  // `sideContacts` : sans membre certifié, le premier par rôle sort quand même,
  // sans tag Discord ni BattleTag — le texte ne promet pas de tag à chaque contact.
  it("privacyChanges_battletagMatchesOverwatchOnly_statesNoCertifiedMemberFallbackFrAndEn", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    const en = [english.title, english.summary, ...english.details].join(" ");

    expect(fr).toContain(
      "Une équipe dont aucun membre n'a certifié son tag Discord est présentée par le pseudo et le rôle d'équipe d'un de ses membres (capitaine, manager, propriétaire, puis un joueur), sans autre identifiant.",
    );
    expect(en).toContain(
      "A team none of whose members has certified their Discord tag is presented by one member's username and team role (captain, manager, owner, then a player), with no other identifier.",
    );
    expect(fr).not.toContain("Un contact d'équipe et un caster y gardent leur tag Discord certifié");
    expect(en).not.toContain("A team contact and a caster keep their certified Discord tag");
  });
});

describe("PRIVACY_CHANGES — pseudo de l'arbitre lu par les membres connectés (MATCH-UI-NAMES, décisions 47 et 52)", () => {
  const id = "2026-10-pseudo-arbitre-aux-membres";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("privacyChanges_refereeUsernameToMembers_closesListDated1031ForAllAccounts", () => {
    expectStandaloneEntry(entry, english, {
      fromEnd: 6,
      publishedAt: "2026-10-31",
      audience: undefined,
      links: [{ href: "/rgpd#arbitre-designe", label: "Lire le paragraphe « Arbitre désigné d'un match »" }],
    });
    expect(english.linkLabels).toEqual(["Read the “Assigned referee of a match” paragraph"]);
    expect(id.length).toBeLessThanOrEqual(PRIVACY_CHANGE_ID_MAX_LENGTH);
    expect(english.details).toHaveLength(entry.details.length);
  });

  it("privacyChanges_refereeUsernameToMembers_statesReadersBasisAndReadyFrAndEn", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    const en = [english.title, english.summary, ...english.details].join(" ");

    expect(fr).toContain("tout membre connecté lit désormais le pseudo de son arbitre désigné");
    expect(fr).toContain("Les visiteurs sans compte et la page de suivi public lisent toujours « Arbitre désigné »");
    expect(fr).toContain("jamais ton BattleTag ni ton tag Discord");
    expect(fr).toContain("relève de l'intérêt légitime");
    expect(fr).toContain("seuls les parties du match et les arbitres le lisent");
    expect(en).toContain("any signed-in member now reads its assigned referee's username");
    expect(en).toContain("Visitors without an account and the public follow page still read “Referee assigned”");
    expect(en).toContain("never your BattleTag nor your Discord tag");
    expect(en).toContain("falls under legitimate interest");
    expect(en).toContain("only the parties to the match and the referees read it");
  });

  it("privacyChanges_refereeUsernameToMembers_leavesPublishedOppositionEntryIntact", () => {
    const older = PRIVACY_CHANGES.find((c) => c.id === "2026-10-opposition-arbitre-retrait-des-matchs")!;
    expect(older.publishedAt).toBe("2026-10-30");
    expect(PRIVACY_CHANGES.indexOf(older)).toBe(PRIVACY_CHANGES.length - 7);
  });
});

describe("PRIVACY_CHANGES — rôles de plateforme au journal du staff (ADMIN-SELF-ROLES)", () => {
  const id = "2026-10-roles-de-plateforme-journal-du-staff";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("privacyChanges_platformRolesLog_dated1031ForAllAccountsWithRegisterLink", () => {
    expect(PRIVACY_CHANGES.at(-5)).toBe(entry);
    expect(entry.publishedAt).toBe("2026-10-31");
    expect(entry.audience).toBeUndefined();
    expect(entry.links).toEqual([{ href: "/rgpd/registre#t05", label: "Lire la fiche T05 du registre" }]);
    expect(english).toMatchObject({ linkLabels: ["Read entry T05 of the register"] });
    expect([english.details.length, id.length <= PRIVACY_CHANGE_ID_MAX_LENGTH]).toEqual([entry.details.length, true]);
    expectStandaloneEntry(entry, english, {
      fromEnd: 5,
      publishedAt: entry.publishedAt,
      audience: entry.audience,
      links: entry.links,
    });
  });

  it("privacyChanges_platformRolesLog_statesDiscordAnonymityAndServerLogContentFrAndEn", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    const en = [english.title, english.summary, ...english.details].join(" ");

    expect(fr).toContain("ni ton pseudo, ni celui de l'administrateur, ni les rôles");
    expect(fr).toContain("le pseudo et l'identifiant de l'administrateur qui l'a fait, l'identifiant du compte visé et les rôles enregistrés");
    expect(fr).toContain("jamais s'y retirer l'administration");
    expect(en).toContain("neither your username, nor the administrator's, nor the roles");
    expect(en).toContain("the username and identifier of the administrator who did it, the identifier of the account concerned and the roles saved");
    expect(en).toContain("never remove their own administration there");
  });

  it("privacyChanges_platformRolesLog_leavesPublishedEntriesBeforeIt", () => {
    const previous = PRIVACY_CHANGES[PRIVACY_CHANGES.length - 6];
    expect(previous.id).toBe("2026-10-pseudo-arbitre-aux-membres");
    expect(PRIVACY_CHANGES.filter((c) => c.publishedAt > "2026-10-30").map((c) => c.id)).toContain(id);
  });

  it("processingRegister_t05PlatformRoles_namesTheAccountOnlyOnSelfEditFrAndEn", () => {
    const t05 = PROCESSING_ACTIVITIES.find((a) => a.ref === "T05")!;
    const t05En = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T05")!;
    expect(t05.dataSubjects).toContain(
      "Comptes dont un administrateur attribue ou retire un rôle de plateforme (désignés par l'identifiant de leur compte ; nommés seulement quand un administrateur règle les siens, comme auteur du geste)",
    );
    expect(t05En.dataSubjects).toContain(
      "Accounts whose platform role an administrator grants or removes (designated by their account identifier; named only when an administrator sets their own, as the author of the action)",
    );
  });
});

// D3 (EF-23) : remplace l'entrée EF-09 jamais publiée (« effacé ») — le
// BattleTag tapé est gardé, sans jamais passer pour vérifié.
describe("PRIVACY_CHANGES — BattleTag tapé gardé, jamais vérifié (D3)", () => {
  const id = "2026-10-battletag-tape-garde-non-verifie";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("privacyChanges_typedBattletagKept_precedesTermsV8Dated1031ForAllAccounts", () => {
    expect(PRIVACY_CHANGES.at(-4)).toBe(entry);
    expect(PRIVACY_CHANGES.at(-5)?.id).toBe("2026-10-roles-de-plateforme-journal-du-staff");
    expect(id.length).toBeLessThanOrEqual(PRIVACY_CHANGE_ID_MAX_LENGTH);
    expectStandaloneEntry(entry, english, {
      fromEnd: 4,
      publishedAt: "2026-10-31",
      audience: undefined,
      links: [{ href: "/rgpd#donnees-collectees", label: "Lire « Données collectées »" }],
    });
  });

  it("privacyChanges_typedBattletagKept_statesKeptUnverifiedAndItsEffectsFrAndEn", () => {
    expectEntryTexts(entry, english, {
      fr: [
        "celui que tu avais saisi à la main reste sur ta fiche, mais n'est plus tenu pour vérifié",
        "ni contact certifié de ton équipe",
        "ni identité suffisante pour caster ou arbitrer un match",
        "il remplace toujours le tien, et lui seul est vérifié",
        "reste modifiable depuis « Mon profil », même avec Battle.net rattaché",
      ],
      en: [
        "the one you had typed in by hand stays on your profile, but is no longer treated as verified",
        "no certified contact for your team",
        "not enough identity to cast or referee a match",
        "it always replaces yours, and only that one is verified",
        "can still be changed from “My profile”, even with Battle.net linked",
      ],
    });
  });

  it("privacyChanges_typedBattletagKept_statesLegacyAccountsSwitchAtNextSignInFrAndEn", () => {
    expectEntryTexts(entry, english, {
      fr: [
        "déjà rattaché avec un BattleTag",
        "la règle s'applique à ta prochaine connexion par Battle.net",
        "ton BattleTag garde son état actuel",
      ],
      en: [
        "already linked with a BattleTag",
        "the rule applies at your next Battle.net sign-in",
        "your BattleTag keeps its current state",
      ],
    });
  });

  it("privacyChanges_erasedEntry_neverPublished", () => {
    expect(PRIVACY_CHANGES.some((c) => c.id === "2026-10-battletag-efface-sans-battle-net")).toBe(false);
    expect(PRIVACY_CHANGES_EN).not.toHaveProperty("2026-10-battletag-efface-sans-battle-net");
  });
});

// EF-20, décision D2 : conditions v8 (arbitre désigné, BattleTag tapé).
describe("PRIVACY_CHANGES — conditions v8 : arbitre désigné et BattleTag tapé (EF-20, D2)", () => {
  const id = "2026-10-conditions-v8-arbitre-et-battletag";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("privacyChanges_termsV8_closesListDatedAfterGoLiveForAllAccounts", () => {
    expect(id.length).toBeLessThanOrEqual(PRIVACY_CHANGE_ID_MAX_LENGTH);
    expectStandaloneEntry(entry, english, {
      fromEnd: 3,
      publishedAt: "2026-10-31",
      audience: undefined,
      links: [
        { href: `${TERMS_PATH}#contacts-de-match`, label: "Lire la section « Contacts de match »" },
        { href: `${TERMS_PATH}#contenus`, label: "Lire la section « Contenus publiés par les utilisateurs »" },
      ],
    });
    expect(english.linkLabels).toEqual(["Read the “Match contacts” section", "Read the “Content published by users” section"]);
    expect(english.details).toHaveLength(entry.details.length);
  });

  it("privacyChanges_termsV8_asksAcceptanceAndStatesVersionAndDateFrAndEn", () => {
    expect(entry.asksTermsAcceptance).toBe(true);
    expect([TERMS_VERSION, TERMS_UPDATED_AT]).toEqual([8, entry.publishedAt]);
    expect(entry.details.at(-1)).toContain(`version ${TERMS_VERSION}, en vigueur depuis le ${formatTermsDate(TERMS_UPDATED_AT)}`);
    expect(english.details.at(-1)).toContain("version 8, in force since 31 October 2026");
    expect(entry.summary).toContain("Elle est à accepter : une fenêtre te la présente tant que tu ne l'as pas acceptée.");
    expect(english.summary).toContain("It must be accepted: a window presents it to you until you have accepted it.");
  });

  it("privacyChanges_termsV8_statesRefereePseudoAndTypedBattletagFrAndEn", () => {
    const fr = `${entry.title} ${entry.summary} ${entry.details.join(" ")}`;
    const en = `${english.title} ${english.summary} ${english.details.join(" ")}`;
    for (const part of ["son pseudo seul — jamais son BattleTag ni son tag Discord — se lit par tout membre connecté", "il peut s'y opposer par le formulaire de signalement (catégorie RGPD)", "un BattleTag tapé à la main ne suffit pas", "sans être tenu pour vérifié"]) expect(fr).toContain(part);
    for (const part of ["their username alone — never their BattleTag or Discord tag — is read by any signed-in member", "they may object to it through the report form (GDPR category)", "a hand-typed BattleTag is not enough", "without being treated as verified"]) expect(en).toContain(part);
  });

  it("privacyChanges_termsV8_statesCasterDiscordTagInLaunchWindowFrAndEn", () => {
    expect(entry.details.join(" ")).toContain("que le tag Discord certifié d'un caster se lit aussi dans la fenêtre de lancement du match, par ses deux équipes, ses autres casters et son arbitre désigné le temps du match");
    expect(english.details.join(" ")).toContain("that a caster's certified Discord tag can also be read in the match's launch window, by both its teams, its other casters and its assigned referee while the match is being played");
  });
});

describe("PRIVACY_CHANGES — suppression de compte et export (EF-21, décision 11)", () => {
  const id = "2026-10-suppression-compte-et-export";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("privacyChanges_accountDeletionExport_closesListDated1031ForAllAccounts", () => {
    expect(id.length).toBeLessThanOrEqual(PRIVACY_CHANGE_ID_MAX_LENGTH);
    expectStandaloneEntry(entry, english, {
      fromEnd: 2,
      publishedAt: "2026-10-31",
      audience: undefined,
      links: [{ href: "/rgpd#retransmission", label: "Lire le paragraphe « Retransmission des matchs »" }],
    });
    expect(english.linkLabels).toEqual(["Read the “Match streaming” paragraph"]);
    expect(english.details).toHaveLength(entry.details.length);
    expect(entry.asksTermsAcceptance).toBeUndefined();
  });

  it("privacyChanges_accountDeletionExport_noLongerPromisesLinkRemovalAfterEveningEnds", () => {
    // Une soirée finie (ou sans autre lien) n'est pas remise à jour : rien ne le promet.
    const fr = `${entry.summary} ${entry.details.join(" ")}`;
    const en = `${english.summary} ${english.details.join(" ")}`;
    expect(fr).not.toContain("quatre heures");
    expect(en).not.toContain("four hours");
  });

  it("privacyChanges_accountDeletionExport_statesDirectoryLiveMessageAndExportFrAndEn", () => {
    const fr = `${entry.summary} ${entry.details.join(" ")}`;
    const en = `${english.summary} ${english.details.join(" ")}`;
    for (const part of ["mais plus son identifiant ni sa date de création", "sans le lien de sa chaîne s'il garde un autre lien ; sinon, ou une fois la soirée finie, il le garde", "tes inscriptions de caster", "les matchs dont tu es l'arbitre désigné", "si ton BattleTag vient de Battle.net ou a été tapé à la main"]) {
      expect(fr).toContain(part);
    }
    for (const part of ["but no longer its identifier or creation date", "without their channel link if it keeps another link; otherwise, or once the evening has ended, it keeps it", "your caster registrations", "the matches you are the assigned referee of", "whether your BattleTag comes from Battle.net or was typed in by hand"]) {
      expect(en).toContain(part);
    }
  });
});

describe("PRIVACY_CHANGES — lien de l'organisation choisi, non déduit (EF-29, décision 48)", () => {
  const id = "2026-10-lien-organisation-choix-explicite";
  const entry = PRIVACY_CHANGES.find((c) => c.id === id)!;
  const english = PRIVACY_CHANGES_EN[id];

  it("privacyChanges_organisationLinkChoice_closesListDated1031ForAllAccounts", () => {
    expect(id.length).toBeLessThanOrEqual(PRIVACY_CHANGE_ID_MAX_LENGTH);
    expectStandaloneEntry(entry, english, {
      fromEnd: 1,
      publishedAt: "2026-10-31",
      audience: undefined,
      links: [{ href: "/rgpd#retransmission", label: "Lire le paragraphe « Retransmission des matchs »" }],
    });
    expect(english.linkLabels).toEqual(["Read the “Match streaming” paragraph"]);
    expect(english.details).toHaveLength(entry.details.length);
    expect(entry.asksTermsAcceptance).toBeUndefined();
  });

  it("privacyChanges_organisationLinkChoice_statesTheChoiceAndWhatDeletionTakesFrAndEn", () => {
    const fr = `${entry.summary} ${entry.details.join(" ")}`;
    const en = `${english.summary} ${english.details.join(" ")}`;
    expect(fr).toContain("Ce lien est celui de l'organisation");
    expect(fr).toContain("même s'il caste ce match");
    expect(fr).toContain("part à la suppression de son compte");
    expect(en).toContain("This link is the organisation's");
    expect(en).toContain("even if they cast that match");
    expect(en).toContain("goes when their account is deleted");
  });

  it("privacyChanges_organisationLinkChoice_leavesThePublishedCasterEntryIntact", () => {
    const published = PRIVACY_CHANGES.find((c) => c.id === "2026-10-plusieurs-casters-par-match")!;
    expect(published.details.join(" ")).toContain("compte comme la tienne");
    expect(entry.publishedAt > published.publishedAt).toBe(true);
  });
});
