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
} from "@/lib/shared/processing-register";
import { SITE_MINIMUM_AGE, TERMS_PATH, TERMS_UPDATED_AT, TERMS_VERSION, formatTermsDate } from "@/lib/shared/terms-of-use";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
import { MATCH_REMINDER_LOOKAHEAD_MS } from "@/lib/shared/discord-notifications";
import { PRIVACY_CHANGES_EN } from "@/lib/shared/privacy-changes-en";
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
  privacyChangeReachesAccount,
  publishedPrivacyChanges,
  privacyChangesForOneMessage,
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

  it("partage le registre réel en lots qui nomment chacun tous leurs changements", () => {
    let rest = [...PRIVACY_CHANGES];
    while (rest.length > 0) {
      const batch = privacyChangesForOneMessage(rest, "https://bluegenji.fr");
      const message = buildPrivacyChangesMessage(batch, "https://bluegenji.fr");
      for (const entry of batch) expect(message).toContain(entry.title);
      rest = rest.slice(batch.length);
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

  it("un fait inconnu vaut faux : l'entrée ciblée se tait", () => {
    expect(privacyChangeReachesAccount(G, {})).toBe(false);
    expect(pendingPrivacyChanges("2025-12-01 10:00:00", [], TODAY, TARGETED)).toEqual([A, C]);
  });

  it("une cible inconnue (valeur inattendue) ne vise personne", () => {
    const odd = change("x", "2026-04-01", { audience: "AUTRE" as never });
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
    expect(PRIVACY_CHANGES.at(-22)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-21)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-20)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-19)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-18)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-17)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-16)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-15)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-14)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-13)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-12)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-11)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.at(-9)?.id).toBe(entry.id);
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
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 7);
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
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 8);
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
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 6);
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
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 5);
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
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 4);
    expect([entry.publishedAt, entry.audience]).toEqual([TERMS_UPDATED_AT, undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("annonce la version en vigueur et sa date, et lie ses deux sections (FR et EN)", () => {
    expect(TERMS_VERSION).toBe(6);
    expect(entry.summary).toMatch(new RegExp(`conditions d'utilisation passent en version ${TERMS_VERSION}`));
    expect(entry.details.at(-1)).toContain(`version ${TERMS_VERSION}, en vigueur depuis le ${formatTermsDate(TERMS_UPDATED_AT)}`);
    expect(entry.links?.map((link) => link.href)).toEqual([`${TERMS_PATH}#acceptation`, `${TERMS_PATH}#contacts-de-match`]);
    expect(english.summary).toMatch(new RegExp(`terms of use move to version ${TERMS_VERSION}`));
    expect(english.details.at(-1)).toContain(`version ${TERMS_VERSION}, in force since 19 October 2026`);
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
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 3);
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
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 2);
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

  it("ferme la liste : datée du jour de la fusion, pour tous les comptes, et tient seule dans un message privé", () => {
    expect(entry).toBeDefined();
    expect(PRIVACY_CHANGES.indexOf(entry)).toBe(PRIVACY_CHANGES.length - 1);
    expect([entry.publishedAt, entry.audience]).toEqual(["2026-10-20", undefined]);
    expect(buildPrivacyChangesMessage([entry], "https://site.test").length).toBeLessThanOrEqual(PRIVACY_DM_MAX_LENGTH);
  });

  it("dit les destinataires, le sujet refusable, le contenu sans pseudo et le journal (FR et EN)", () => {
    const fr = [entry.title, entry.summary, ...entry.details].join(" ");
    expect(fr).toMatch(/aux autres arbitres et administrateurs qui l'ont activée \(sujet « Arbitrage par un joueur du staff », que tu peux couper dans « Mon profil »\), jamais à l'auteur/);
    expect(fr).toMatch(/sans le pseudo de l'auteur ni d'aucun joueur/);
    expect(fr).toMatch(/ne dit sur Discord que le tournoi et la nature du geste, sans nom/);
    expect(fr).toMatch(/le pseudo et l'identifiant de compte de son auteur/);
    const en = [english.title, english.summary, ...english.details].join(" ");
    expect(en).toMatch(/topic “Refereeing by a staff player”, which you can turn off in “My profile”\), never to the author/);
    expect(en).toMatch(/without the username of the author or of any player/);
    expect(en).toMatch(/gives on Discord only the tournament and the kind of action, unnamed/);
    expect(english.details).toHaveLength(entry.details.length);
    expect(english.linkLabels).toHaveLength(entry.links?.length ?? 0);
  });
});
