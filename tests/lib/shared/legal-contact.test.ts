import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "@jest/globals";
import {
  ASSOCIATION_NAME,
  ASSOCIATION_SEAT,
  DATA_CONTACT_LABEL,
  DATA_CONTACT_NAME,
  DATA_CONTACT_ROLE,
  LEGAL_CONTACT_DISCORD,
  REPORT_FORM_NAME,
  RGPD_CONTACT_LINE,
} from "@/lib/shared/legal-contact";
import { registerController } from "@/lib/shared/processing-register";
import { SITE_HOST } from "@/lib/shared/site-host";
import { readSource } from "../../helpers/read-source";

/**
 * Aucun courriel ni numéro de téléphone **en clair** dans les sources.
 *
 * L'association publie son courriel et son téléphone, l'hébergeur son
 * téléphone — mais une adresse écrite dans une page, ou seulement dans ce
 * dépôt, qui est public, est moissonnée par les robots. Les valeurs vivent
 * encodées (`lib/shared/obfuscated-contact.ts`) et ne se lisent qu'au clic.
 */

const ROOT = join(__dirname, "..", "..", "..");
const SCANNED = ["app", "components", "lib", "docs", "README.md", "CLAUDE.md", ".env.production.example", ".env.example"];
const TEXT_EXT = /\.(ts|tsx|md|css|json|example)$/;
// Composées plutôt qu'écrites : ce fichier ne doit pas être celui qui les publie.
// La première est redevenue un contact (personne à contacter pour les données),
// mais **encodée** seulement : en clair, elle reste refusée partout.
const RETIRED_ADDRESSES = [["keryan.h", "outlook.fr"].join("@"), ["presse", "bluegenji-esport.fr"].join("@")];
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const EMAIL_GLOBAL = new RegExp(EMAIL.source, "g");
/** Numéro français : `0X XX XX XX XX` ou `+33 X …`, séparé par espace, point ou tiret, ou collé. */
const FRENCH_PHONE = /(?<![\w.+])(?:\+33[\s.-]?|0)[1-9](?:[\s.-]?\d{2}){4}(?!\d)/g;
/** Domaines réservés aux exemples (RFC 2606) : jamais une adresse joignable. */
const RESERVED_DOMAIN = /@[a-z0-9.-]*\.(invalid|example|test)$/i;
/** Le seul fichier qui porte les coordonnées — encodées. */
const ENCODING_MODULE = join("lib", "shared", "obfuscated-contact.ts");

/** Courriels et numéros en clair d'un texte source, domaines d'exemple exceptés. */
function plainContactsIn(source: string): string[] {
  const emails = [...source.matchAll(EMAIL_GLOBAL)].map((m) => m[0]).filter((e) => !RESERVED_DOMAIN.test(e));
  const phones = [...source.matchAll(FRENCH_PHONE)].map((m) => m[0]);
  return [...emails, ...phones];
}

describe("détecteur de coordonnées en clair", () => {
  it.each([
    ["prenom.nom@domaine.fr", 1],
    ["06 12 34 56 78", 1],
    ["06.12.34.56.78", 1],
    ["0612345678", 1],
    ["+33 6 12 34 56 78", 1],
    ["contact@exemple.invalid", 0],
    ["1099511627776", 0],
    ["9010000000000", 0],
    ["id 390973051367", 0],
  ])("%s → %i", (text, count) => {
    expect(plainContactsIn(text)).toHaveLength(count);
  });
});

describe("aucune coordonnée en clair", () => {
  it("ni dans app/, ni dans components/, ni dans lib/ (hors module d'encodage)", () => {
    const offenders: string[] = [];
    for (const entry of ["app", "components", "lib"]) {
      for (const file of textFiles(entry)) {
        const rel = relative(ROOT, file);
        if (rel === ENCODING_MODULE) continue;
        for (const found of plainContactsIn(readSource(file))) offenders.push(`${rel}: ${found}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("le module d'encodage ne porte lui-même que des valeurs encodées", () => {
    expect(plainContactsIn(readSource(ENCODING_MODULE))).toEqual([]);
  });
});

function* textFiles(entry: string): Generator<string> {
  const absolute = join(ROOT, entry);
  let stats;
  try {
    stats = statSync(absolute);
  } catch {
    return;
  }
  if (stats.isFile()) {
    if (TEXT_EXT.test(absolute) || entry.startsWith(".env")) yield absolute;
    return;
  }
  for (const child of readdirSync(absolute)) {
    if (child === "node_modules" || child.startsWith(".")) continue;
    yield* textFiles(join(entry, child));
  }
}

describe("adresses retirées", () => {
  it("n'apparaissent plus nulle part dans les sources ni la documentation", () => {
    const offenders: string[] = [];
    for (const entry of SCANNED) {
      for (const file of textFiles(entry)) {
        const text = readSource(file).toLowerCase();
        if (RETIRED_ADDRESSES.some((address) => text.includes(address))) offenders.push(relative(ROOT, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("aucune variable d'environnement ne peut la remettre en page", () => {
    for (const entry of ["app", "components", "lib"]) {
      for (const file of textFiles(entry)) {
        expect([relative(ROOT, file), readSource(file).includes("RGPD_CONTACT_EMAIL")]).toEqual([
          relative(ROOT, file),
          false,
        ]);
      }
    }
  });

  it.each([
    "app/rgpd/page.tsx",
    "app/rgpd/registre/page.tsx",
    "app/rgpd/registre.csv/route.ts",
    "app/accessibilite/page.tsx",
    "app/mentions-legales/page.tsx",
    "lib/shared/bot-legal-content.ts",
    "lib/shared/processing-register.ts",
  ])("%s n'écrit aucune adresse électronique en clair", (path) => {
    const source = readSource(path);
    expect(source).not.toMatch(EMAIL);
    // Le lien `mailto:` n'est assemblé que par le module d'encodage, au clic.
    expect(source).not.toContain("mailto:");
  });
});

describe("éditeur et moyens de le joindre", () => {
  it("nomme l'association sous sa dénomination statutaire, avec son siège", () => {
    expect(ASSOCIATION_NAME).toBe("Bluegenji Esport");
    expect(ASSOCIATION_SEAT).toContain("51210 Janvilliers");
    expect(registerController().name).toBe(ASSOCIATION_NAME);
    expect(registerController().seat).toBe(ASSOCIATION_SEAT);
  });

  it("les mentions légales publient courriel et téléphone de l'association, révélés au clic", () => {
    const page = readSource("app/mentions-legales/page.tsx");
    expect(page).toContain("encoded={ASSOCIATION_EMAIL_ENCODED}");
    expect(page).toContain("encoded={ASSOCIATION_PHONE_ENCODED}");
    expect(page).toContain("encoded={SITE_HOST.phoneEncoded}");
  });

  it("les mentions légales ne citent plus le site tiers hébergé sur la même machine", () => {
    const page = readSource("app/mentions-legales/page.tsx");
    expect(page).not.toContain("celine-houssin");
    expect(page).toContain("hébergeur technique");
    expect(page).toContain("{SITE_HOST.machine}");
  });

  it("/rgpd nomme l'association responsable et révèle son courriel au clic", () => {
    const page = readSource("app/rgpd/page.tsx");
    expect(page).toContain("{ASSOCIATION_NAME}");
    expect(page).toContain("{ASSOCIATION_SEAT}");
    expect(page).toContain("encoded={ASSOCIATION_EMAIL_ENCODED}");
    expect(page).not.toContain("contactez le responsable de traitement");
  });

  it("le pied de page reçoit le courriel encodé, jamais en clair", () => {
    const footer = readSource("components/cyber/landing/PublicFooter.tsx");
    expect(footer).toContain("initialContact={toPublicContact(contact)}");
    const contact = readSource("components/cyber/landing/FooterContact.tsx");
    expect(contact).toContain("encoded={contact.emailEncoded}");
    // Une adresse modifiée repart masquée : le composant est remonté sur sa valeur.
    expect(contact).toContain("key={contact.emailEncoded}");
    expect(contact).not.toContain("mailto:");
  });

  it("la lecture publique du contact rend le courriel encodé", () => {
    const route = readSource("app/api/association/contact/route.ts");
    expect(route).toContain("ok({ contact: toPublicContact(contact) })");
  });
});

describe("contact de remplacement", () => {
  it("nomme le tag Discord de l'hébergeur technique", () => {
    expect(LEGAL_CONTACT_DISCORD).toBe("elessiah");
  });

  it("nomme le bouton tel qu'il s'affiche au pied de chaque page", () => {
    expect(REPORT_FORM_NAME).toBe("Signaler un problème");
    const button = readSource("components/reports/ReportProblemButton.tsx");
    expect(button).toContain("label = REPORT_FORM_NAME");
  });

  it("ligne du registre : la personne à contacter, le formulaire RGPD et l'association, par renvoi, sans adresse", () => {
    // Le responsable reste l'association : la personne à contacter est présentée comme telle.
    expect(RGPD_CONTACT_LINE.startsWith(`Demandes relatives aux données : ${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE}, chargé par l'association`)).toBe(true);
    expect(RGPD_CONTACT_LINE).toContain("l'association : courriel et téléphone (mentions légales du site)");
    expect(RGPD_CONTACT_LINE).not.toContain(LEGAL_CONTACT_DISCORD);
    expect(RGPD_CONTACT_LINE).toContain(REPORT_FORM_NAME);
    expect(RGPD_CONTACT_LINE).toContain("« RGPD »");
    expect(RGPD_CONTACT_LINE).not.toMatch(EMAIL);
  });

  it("/rgpd ouvre le formulaire directement sur la catégorie RGPD", () => {
    const page = readSource("app/rgpd/page.tsx");
    expect(page).toContain('initialCategory="RGPD"');
    // Le tag Discord de l'hébergeur ne sert qu'aux questions techniques.
    expect(page).not.toContain("LEGAL_CONTACT_DISCORD");
  });
});

describe("personne à contacter pour les demandes relatives aux données", () => {
  it("est l'hébergeur technique, jamais appelé délégué ni DPO", () => {
    // Même personne, même graphie que l'hébergeur des mentions légales.
    expect(DATA_CONTACT_NAME).toBe(SITE_HOST.name);
    expect(DATA_CONTACT_ROLE).toBe("hébergeur technique du site");
    expect(DATA_CONTACT_LABEL).toBe("Personne à contacter pour vos demandes relatives à vos données");
    for (const text of [DATA_CONTACT_LABEL, DATA_CONTACT_ROLE, RGPD_CONTACT_LINE]) {
      expect(text).not.toMatch(/DPO|délégué/i);
    }
  });

  it.each(["app/rgpd/page.tsx", "app/mentions-legales/page.tsx"])(
    "%s affiche son courriel et son téléphone, protégés, et dit qu'il n'est pas un délégué",
    (file) => {
      const page = readSource(file);
      expect(page).toContain("encoded={DATA_CONTACT_EMAIL_ENCODED}");
      expect(page).toContain("encoded={DATA_CONTACT_PHONE_ENCODED}");
      expect(page).toContain("{DATA_CONTACT_NAME}, {DATA_CONTACT_ROLE}");
      expect(page).toMatch(/n&apos;est pas (un )?délégué à la protection des données/);
      expect(page).not.toMatch(/ni délégué à la protection des données ni/);
      expect(page).not.toMatch(/\bDPO\b/);
      // Le formulaire reste un canal possible.
      expect(page).toContain("{REPORT_FORM_NAME}");
    },
  );

  it("/rgpd garde les coordonnées de l'association et nomme la section des droits", () => {
    const page = readSource("app/rgpd/page.tsx");
    expect(page).toContain("encoded={ASSOCIATION_EMAIL_ENCODED}");
    expect(page).toContain('id="exercer-vos-droits"');
    // Durée annoncée pour les demandes reçues par courriel ou téléphone (art. 13.2.a).
    expect(page).toContain("{REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa clôture");
    expect(page).toContain("{DATA_CONTACT_LABEL}");
  });

  it("le formulaire s'ouvre sur la catégorie demandée, focus dans la description, et reste modifiable", () => {
    const dialog = readSource("components/reports/ReportProblemDialog.tsx");
    expect(dialog).toContain('contestOf ? "CONTEST" : (initialCategory ?? null)');
    expect(dialog).toContain("contestOf !== undefined || initialCategory !== undefined");
    // Le retour au choix de catégorie n'est retiré qu'à une contestation.
    expect(dialog).toContain("{contestOf === undefined && (");
    const button = readSource("components/reports/ReportProblemButton.tsx");
    expect(button).toContain("initialCategory={initialCategory}");
  });

  it("les mentions légales renvoient l'hébergeur et les droits au formulaire", () => {
    const page = readSource("app/mentions-legales/page.tsx");
    expect(page).toContain("catégorie « Hébergeur »");
    expect(page).toContain("catégorie « RGPD »");
    expect(page).not.toContain("LEGAL_CONTACT_DISCORD");
    expect(page).toContain("l&apos;association ne dispose ni d&apos;un numéro RNA");
  });

  it("la déclaration d'accessibilité donne Discord et le formulaire", () => {
    const page = readSource("app/accessibilite/page.tsx");
    expect(page).toContain("LEGAL_CONTACT_DISCORD");
    expect(page).toContain("REPORT_FORM_NAME");
  });
});
