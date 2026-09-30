import { describe, expect, it } from "@jest/globals";
import { DISCORD_INVITE_URL } from "@/lib/shared/discord";
import {
  ASSOCIATION_NAME,
  ASSOCIATION_SEAT,
  DATA_CONTACT_NAME,
  LEGAL_CONTACT_DISCORD,
  REPORT_FORM_NAME,
} from "@/lib/shared/legal-contact";
import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import {
  BOT_LINK_CODE_VALIDITY_MINUTES,
  BOT_RELAY_RETENTION_DAYS,
  DPF_ADEQUACY_DECISION,
  DPF_ADEQUACY_DECISION_EN,
  PROCESSING_ACTIVITIES,
} from "@/lib/shared/processing-register";
import { SITE_HOST } from "@/lib/shared/site-host";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BOT_COPYRIGHT_HOLDER,
  BOT_MINIMUM_AGE,
  BOT_SOURCE_URL,
  HEBERGEUR_HREF,
  PRIVACY_POLICY,
  TERMS_OF_SERVICE,
  type BilingualDoc,
} from "@/lib/shared/bot-legal-content";

const ROOT = join(__dirname, "..", "..");
const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

const DOCS: [string, BilingualDoc][] = [
  ["Terms of Service", TERMS_OF_SERVICE],
  ["Privacy Policy", PRIVACY_POLICY],
];

describe("bot legal content is fully bilingual", () => {
  it.each(DOCS)("%s exposes both fr and en variants", (_name, doc) => {
    expect(doc.fr).toBeDefined();
    expect(doc.en).toBeDefined();
  });

  it.each(DOCS)("%s keeps the same section count across languages", (_name, doc) => {
    expect(doc.fr.sections.length).toBe(doc.en.sections.length);
    expect(doc.fr.sections.length).toBeGreaterThanOrEqual(8);
  });

  it.each(DOCS)("%s keeps section numbering aligned across languages", (_name, doc) => {
    const frNums = doc.fr.sections.map((s) => s.num);
    const enNums = doc.en.sections.map((s) => s.num);
    expect(frNums).toEqual(enNums);
    // Numérotation séquentielle et zéro-paddée (01, 02, …).
    frNums.forEach((num, i) => expect(num).toBe(String(i + 1).padStart(2, "0")));
  });

  it.each(DOCS)("%s never ships an empty section or block", (_name, doc) => {
    for (const lang of [doc.fr, doc.en]) {
      expect(lang.title.trim().length).toBeGreaterThan(0);
      expect(lang.intro.trim().length).toBeGreaterThan(0);
      for (const section of lang.sections) {
        expect(section.title.trim().length).toBeGreaterThan(0);
        expect(section.blocks.length).toBeGreaterThan(0);
        for (const block of section.blocks) {
          if (block.kind === "bullets") {
            expect(block.items && block.items.length).toBeTruthy();
            block.items?.forEach((item) => expect(item.trim().length).toBeGreaterThan(0));
          } else {
            expect(block.text && block.text.trim().length).toBeTruthy();
          }
        }
      }
    }
  });
});

describe("bot legal content carries the contact details", () => {
  it.each(DOCS)("%s gives the report form, never an email, in both languages", (_name, doc) => {
    for (const lang of [doc.fr, doc.en]) {
      const flat = JSON.stringify(lang);
      expect(flat).toContain(REPORT_FORM_NAME);
      expect(flat).not.toMatch(/[^\s@"*]+@[^\s@"*]+\.[a-z]{2,}/i);
    }
  });

  it("the terms give the technical host's Discord, the privacy policy never names it as a data contact", () => {
    for (const lang of [TERMS_OF_SERVICE.fr, TERMS_OF_SERVICE.en]) {
      expect(JSON.stringify(lang)).toContain(LEGAL_CONTACT_DISCORD);
    }
    for (const lang of [PRIVACY_POLICY.fr, PRIVACY_POLICY.en]) {
      const contact = lang.sections.find((section) => section.meta === "CONTACT");
      expect(contact).toBeDefined();
      expect(JSON.stringify(contact)).not.toContain(LEGAL_CONTACT_DISCORD);
    }
    expect(JSON.stringify(PRIVACY_POLICY.fr)).not.toContain("ni délégué à la protection des données ni référent");
  });

  it("the privacy policy names the person to contact for data requests, without their details", () => {
    for (const lang of [PRIVACY_POLICY.fr, PRIVACY_POLICY.en]) {
      const contact = JSON.stringify(lang.sections.find((section) => section.meta === "CONTACT"));
      expect(contact).toContain(`**${DATA_CONTACT_NAME}**`);
      expect(contact).toContain("/rgpd#exercer-vos-droits");
      expect(contact).toMatch(/Article 37|article 37/);
    }
    expect(JSON.stringify(PRIVACY_POLICY.fr)).toContain("ce n'est pas un délégué à la protection des données au sens de l'article 37");
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain("is not a data protection officer within the meaning of Article 37");
  });
});

describe("hébergeur redirect points at the mentions légales section", () => {
  it("exposes the shared anchor constant", () => {
    expect(HEBERGEUR_HREF).toBe("/mentions-legales#hebergement");
  });

  it.each(DOCS)("%s carries a hosting block linking to that anchor", (_name, doc) => {
    for (const lang of [doc.fr, doc.en]) {
      expect(lang.hosting.title.trim().length).toBeGreaterThan(0);
      expect(lang.hosting.linkLabel.trim().length).toBeGreaterThan(0);
    }
  });

  it("the mentions-legales page owns the #hebergement anchor", () => {
    const source = read("app/mentions-legales/page.tsx");
    expect(source).toContain('id: "hebergement"');
    expect(source).toContain("id={section.id}");
  });
});

describe("terms of service specifics", () => {
  it("links to the Discord terms and community guidelines", () => {
    const flat = JSON.stringify(TERMS_OF_SERVICE);
    expect(flat).toContain("https://discord.com/terms");
    expect(flat).toContain("https://discord.com/guidelines");
  });

  it("cross-links to the bot privacy policy page", () => {
    const flat = JSON.stringify(TERMS_OF_SERVICE);
    expect(flat).toContain("/privacy-policy-bot");
  });
});

describe("privacy policy specifics", () => {
  it("references the Discord server for change announcements", () => {
    // L'adresse est celle de `lib/shared/discord.ts` : les pages légales du bot
    // renvoient vers le serveur de l'association, pas vers un second serveur
    // dont personne ne saurait plus qui le tient.
    const flat = JSON.stringify(PRIVACY_POLICY);
    expect(flat).toContain(DISCORD_INVITE_URL);
  });
});

describe("route pages wire the right documents", () => {
  it("/terms-of-service-bot renders the ToS doc", () => {
    const source = read("app/terms-of-service-bot/page.tsx");
    expect(source).toContain("TERMS_OF_SERVICE");
    expect(source).toContain("BotLegalDoc");
  });

  it("/privacy-policy-bot renders the Privacy doc", () => {
    const source = read("app/privacy-policy-bot/page.tsx");
    expect(source).toContain("PRIVACY_POLICY");
    expect(source).toContain("BotLegalDoc");
  });

  it("the shared component is a client component with a language switch", () => {
    const source = read("components/legal/BotLegalDoc.tsx");
    expect(source).toContain('"use client"');
    expect(source).toContain("useState");
    expect(source).toContain("aria-pressed");
    expect(source).toContain("HEBERGEUR_HREF");
    // Le composant client ne lit que les types : importer le contenu tirerait
    // le registre des traitements dans le paquet du navigateur.
    expect(source).toContain('from "@/lib/shared/bot-legal-types"');
    expect(source).not.toContain("bot-legal-content");
  });
});

describe("bot legal content matches the bot's code and the association", () => {
  const LANGS = ["fr", "en"] as const;
  const flatOf = (doc: BilingualDoc, lang: "fr" | "en") => JSON.stringify(doc[lang]);

  it.each(DOCS)("%s names the association as controller, with its seat, in both languages", (_name, doc) => {
    for (const lang of LANGS) {
      expect(flatOf(doc, lang)).toContain(ASSOCIATION_NAME);
      expect(flatOf(doc, lang)).toContain(ASSOCIATION_SEAT);
    }
  });

  it.each(DOCS)("%s no longer claims the 72-hour or restart deletion, nor the 13-year threshold", (_name, doc) => {
    for (const lang of LANGS) {
      const flat = flatOf(doc, lang);
      expect(flat).not.toMatch(/72/);
      expect(flat).not.toMatch(/\b13 (ans|years)/);
    }
  });

  it("sets the minimum age at 15 in the terms of both languages", () => {
    expect(BOT_MINIMUM_AGE).toBe(15);
    expect(flatOf(TERMS_OF_SERVICE, "fr")).toContain("au moins 15 ans");
    expect(flatOf(TERMS_OF_SERVICE, "en")).toContain("at least 15 years old");
  });

  it("states the relay retention the bot applies (MESSAGE_RETENTION_DAYS = 7) and says restarts erase nothing", () => {
    expect(BOT_RELAY_RETENTION_DAYS).toBe(7);
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain(`${BOT_RELAY_RETENTION_DAYS} jours`);
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain("Rien n'est effacé au redémarrage");
    expect(flatOf(PRIVACY_POLICY, "en")).toContain(`${BOT_RELAY_RETENTION_DAYS} days`);
    expect(flatOf(PRIVACY_POLICY, "en")).toContain("Nothing is erased when the Bot restarts");
  });

  it("does not claim that no personal data is kept permanently", () => {
    expect(flatOf(PRIVACY_POLICY, "fr")).not.toMatch(/Aucune donnée personnelle n'est conservée de manière permanente/);
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain("aucune suppression automatique à ce jour");
    expect(flatOf(PRIVACY_POLICY, "en")).toContain("no automatic deletion at present");
  });

  it("declares /stats, the backups and the transfer basis", () => {
    for (const lang of LANGS) {
      const flat = flatOf(PRIVACY_POLICY, lang);
      expect(flat).toContain("**/stats**");
      expect(flat).toContain("Microsoft");
      expect(flat).toContain("2023/1795");
    }
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain(DPF_ADEQUACY_DECISION);
    expect(flatOf(PRIVACY_POLICY, "en")).toContain(DPF_ADEQUACY_DECISION_EN);
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain(`${BACKUP_RETENTION_DAYS} jours au plus`);
    expect(flatOf(PRIVACY_POLICY, "en")).toContain(`${BACKUP_RETENTION_DAYS} days at most`);
  });

  it("lists the legal basis, objection, restriction and the CNIL complaint", () => {
    const fr = flatOf(PRIVACY_POLICY, "fr");
    expect(fr).toContain("intérêt légitime");
    expect(fr).toContain("**Opposition**");
    expect(fr).toContain("**Limitation**");
    expect(fr).toContain("https://www.cnil.fr/fr/plaintes");
    const en = flatOf(PRIVACY_POLICY, "en");
    expect(en).toContain("legitimate interest");
    expect(en).toContain("**Objection**");
    expect(en).toContain("**Restriction**");
    expect(en).toContain("https://www.cnil.fr/fr/plaintes");
  });

  it("informs rather than binds: the policy is never 'accepted' by use", () => {
    expect(flatOf(PRIVACY_POLICY, "fr")).not.toMatch(/vous acceptez/i);
    expect(flatOf(PRIVACY_POLICY, "en")).not.toMatch(/you agree/i);
  });

  it("limits the liability clause to what the law permits", () => {
    expect(flatOf(TERMS_OF_SERVICE, "fr")).toContain("Dans les limites permises par la loi");
    expect(flatOf(TERMS_OF_SERVICE, "en")).toContain("To the extent permitted by law");
  });

  it("names the technical host and the machine through SITE_HOST", () => {
    for (const doc of [TERMS_OF_SERVICE, PRIVACY_POLICY]) {
      expect(doc.fr.hosting.text).toContain(SITE_HOST.name);
      expect(doc.fr.hosting.text).toContain(SITE_HOST.machine);
      expect(doc.en.hosting.text).toContain(SITE_HOST.name);
      expect(doc.en.hosting.text).toContain(SITE_HOST.machineEn);
    }
    expect(JSON.stringify(PRIVACY_POLICY.en)).toContain(SITE_HOST.machineEn);
  });

  it("declares the membership confirmations and their reminders, in the pages and in T08", () => {
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain("**Adhésions à l'association**");
    expect(flatOf(PRIVACY_POLICY, "en")).toContain("**Association memberships**");
    const t08 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08");
    expect((t08?.dataCategories ?? []).join(" ")).toContain("date de péremption");
    expect((t08?.dataSubjects ?? []).join(" ")).toContain("Adhérents");
  });

  it("declares /ban-list readers, bot-admin role holders included, in the pages and in T08", () => {
    for (const lang of LANGS) {
      expect(flatOf(PRIVACY_POLICY, lang)).toContain("**/ban-list**");
      expect(flatOf(PRIVACY_POLICY, lang)).toContain("**/set-bot-admin**");
    }
    const t08 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08");
    expect((t08?.recipients ?? []).join(" ")).toContain("/ban-list");
  });

  it("does not promise a /link account link that nothing on the site completes", () => {
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain("la commande ne relie donc aucun compte");
    expect(flatOf(PRIVACY_POLICY, "en")).toContain("the command therefore links no account");
    expect(flatOf(PRIVACY_POLICY, "fr")).not.toContain("date de la liaison");
    const t08 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08");
    expect((t08?.dataCategories ?? []).join(" ")).not.toContain("date de liaison");
  });

  it("says relayed copies stay on Discord once the tracking expires, in the pages and in T08", () => {
    expect(flatOf(PRIVACY_POLICY, "fr")).toContain("Les copies publiées dans les salons partenaires restent sur Discord");
    expect(flatOf(PRIVACY_POLICY, "en")).toContain("The copies posted in partner channels remain on Discord");
    const t08 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08");
    expect((t08?.retention ?? []).join(" ")).toContain("restent sur Discord");
  });

  it.each(DOCS)("%s uses no inline code backtick, which the renderer does not support", (_name, doc) => {
    for (const lang of LANGS) {
      expect(flatOf(doc, lang)).not.toContain("`");
    }
  });

  it("keeps the register's T08 aligned on the same durations", () => {
    const t08 = PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08");
    expect(t08).toBeDefined();
    const retention = (t08?.retention ?? []).join(" | ");
    expect(retention).not.toMatch(/72/);
    expect(retention).toContain(`${BOT_RELAY_RETENTION_DAYS} jours`);
    expect(retention).toContain(`${BOT_LINK_CODE_VALIDITY_MINUTES} minutes`);
    expect(retention).toContain(`${BACKUP_RETENTION_DAYS} jours`);
    expect((t08?.recipients ?? []).join(" ")).toContain("/stats");
  });

  // blueGenjiBot#31 : `Bdd.forgetGuild`, appelé sur `guildDelete`, efface
  // invitation, rôles d'arbitrage et d'administration, modules, rappels
  // d'adhésion et filtres de rang — les textes ne peuvent plus dire « ils restent ».
  it("says the server configuration is erased when the Bot leaves, in both languages and in T08", () => {
    const retentionOf = (lang: "fr" | "en") =>
      PRIVACY_POLICY[lang].sections
        .flatMap((section) => section.blocks)
        .flatMap((block) => (block.kind === "bullets" ? block.items : []));
    const fr = retentionOf("fr").join(" | ");
    const en = retentionOf("en").join(" | ");
    expect(fr).not.toContain("ils restent si le Bot quitte le serveur");
    expect(en).not.toContain("they remain if the Bot leaves the server");
    expect(fr).toContain("au plus tard jusqu'au départ du Bot du serveur, qui l'efface");
    expect(en).toContain("at the latest until the Bot leaves the server, which erases it");
    for (const item of ["filtres de rang", "rôle d'administration du Bot", "modules activés"]) {
      expect(fr).toContain(item);
    }
    for (const item of ["rank filters", "Bot administration role", "enabled modules"]) {
      expect(en).toContain(item);
    }
    // Discord ne signale pas un retrait survenu bot arrêté : la réserve est dite.
    expect(fr).toContain("pendant une interruption du Bot");
    expect(en).toContain("while it is down");
    // Les rappels d'adhésion partent avec la configuration du serveur.
    expect(fr).toMatch(/\*\*Adhésions et rappels programmés\*\*[^|]*départ du Bot du serveur/);
    expect(en).toMatch(/\*\*Memberships and scheduled reminders\*\*[^|]*the Bot leaves the server/);
    // La réserve vaut aussi pour eux : `forgetGuild` ne joue que sur `guildDelete`.
    expect(fr).toMatch(/\*\*Adhésions et rappels programmés\*\*[^|]*pendant une interruption[^|]*demande d'effacement/);
    expect(en).toMatch(/\*\*Memberships and scheduled reminders\*\*[^|]*while it is down[^|]*erasure request/);

    const t08 = (PROCESSING_ACTIVITIES.find((activity) => activity.ref === "T08")?.retention ?? []).join(" | ");
    expect(t08).not.toContain("conservés sans limite si le bot quitte le serveur");
    expect(t08).toContain("au plus tard jusqu'au départ du bot du serveur, qui l'efface");
    expect(t08).toMatch(/Adhésions et rappels programmés[^|]*départ du bot du serveur/);
    expect(t08).toMatch(/Adhésions et rappels programmés[^|]*interruption du bot[^|]*demande d'effacement/);
  });

  it("cites the Bot's AGPL-3.0 licence and links its public repository, in both languages", () => {
    expect(BOT_SOURCE_URL).toBe("https://github.com/Elessiah/blueGenjiBot");
    expect(BOT_COPYRIGHT_HOLDER).toBe("Keryan Houssin");
    const frSection = TERMS_OF_SERVICE.fr.sections.find((section) => section.meta === "LICENCE");
    const enSection = TERMS_OF_SERVICE.en.sections.find((section) => section.meta === "LICENCE");
    expect(frSection?.title).toBe("Code source et licence");
    expect(enSection?.title).toBe("Source code and licence");
    expect(frSection?.num).toBe(enSection?.num);
    for (const section of [frSection, enSection]) {
      const flat = JSON.stringify(section);
      expect(flat).toContain("AGPL-3.0-only");
      expect(flat).toContain("GNU Affero General Public License");
      expect(flat).toContain(`](${BOT_SOURCE_URL})`);
      expect(flat).toContain(`© 2026 ${BOT_COPYRIGHT_HOLDER}`);
    }
    // La licence ne couvre ni l'identité de l'association ni les données.
    expect(JSON.stringify(frSection)).toContain("l'identité visuelle de l'association");
    expect(JSON.stringify(enSection)).toContain("the association's name, logo or visual identity");
    // Section placée avant « Contact », qui reste la dernière.
    expect(TERMS_OF_SERVICE.fr.sections.at(-1)?.meta).toBe("CONTACT");
    expect(TERMS_OF_SERVICE.en.sections.at(-1)?.meta).toBe("CONTACT");
  });
});
