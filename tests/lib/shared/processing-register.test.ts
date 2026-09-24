import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS,
  BACKUP_RETENTION_DAYS,
} from "@/lib/shared/account-deletion-journal";
import {
  DISCORD_CODE_VALIDITY_MINUTES,
  PROCESSING_ACTIVITIES,
  REGISTER_EXPORT_COLUMNS,
  REGISTER_UPDATED_AT,
  SESSION_RETENTION_DAYS,
  csvCell,
  registerController,
  registerExportFilename,
  registerToCsv,
  type ProcessingActivity,
} from "@/lib/shared/processing-register";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_DAYS } from "@/lib/shared/logo-quarantine";
import { SITE_HOST } from "@/lib/shared/site-host";

const controller = registerController("rgpd@exemple.invalid");
const byRef = (ref: string) => PROCESSING_ACTIVITIES.find((a) => a.ref === ref) as ProcessingActivity;

/** Découpe un CSV `;` en respectant les guillemets — de quoi relire l'export. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        cell += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ";") {
      row.push(cell);
      cell = "";
    } else if (c === "\r" && text[i + 1] === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i += 1;
    } else cell += c;
  }
  return rows;
}

describe("PROCESSING_ACTIVITIES", () => {
  it("a des références uniques, T01 à Tnn dans l'ordre", () => {
    const refs = PROCESSING_ACTIVITIES.map((a) => a.ref);
    expect(refs).toEqual(refs.map((_, i) => `T${String(i + 1).padStart(2, "0")}`));
  });

  it("remplit chaque rubrique du modèle CNIL pour chaque traitement", () => {
    for (const a of PROCESSING_ACTIVITIES) {
      for (const text of [a.name, a.purpose, a.legalBasis, a.sensitiveData]) {
        expect(text.trim().length).toBeGreaterThan(0);
      }
      for (const list of [a.subPurposes, a.dataSubjects, a.dataCategories, a.retention, a.recipients, a.transfers, a.security]) {
        expect(list.length).toBeGreaterThan(0);
        for (const item of list) expect(item.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("couvre les traitements réels du site", () => {
    const names = PROCESSING_ACTIVITIES.map((a) => a.name.toLowerCase()).join(" | ");
    for (const word of ["comptes", "authentification", "tournois", "contact", "journal", "audience", "bénévoles", "bot", "sauvegardes"]) {
      expect(names).toContain(word);
    }
  });

  it("déclare les transferts vers Discord partout où Discord achemine des messages", () => {
    for (const ref of ["T02", "T04", "T05", "T08", "T10"]) {
      expect(byRef(ref).transfers.join(" ")).toMatch(/Discord/);
    }
  });

  it("ne présente pas comme courte une trace conservée avec le match", () => {
    const retention = byRef("T04").retention.join(" ");
    expect(retention).not.toMatch(/durée de vie du match/);
    expect(retention).toMatch(/sans limite/);
  });

  it("déclare l'acceptation des changements de politique et leur annonce Discord", () => {
    const t10 = byRef("T10");
    expect(t10.dataCategories.join(" ")).toMatch(/accept/i);
    expect(t10.subPurposes.join(" ")).toMatch(/Discord/);
    expect(t10.retention.join(" ")).toMatch(/Durée du compte/);
  });

  it("compte les joueurs d'un même match parmi les destinataires des profils", () => {
    // Un BattleTag masqué leur reste lisible (`lib/shared/battletag-visibility.ts`).
    expect(byRef("T01").recipients.join(" ")).toMatch(/Joueurs d'un même match.*BattleTag même masqué/);
  });

  it("ne déclare aucune adresse e-mail collectée", () => {
    expect(byRef("T01").dataCategories.join(" ")).toMatch(/aucune adresse e-mail/i);
  });
});

describe("durées : le registre cite les constantes que le code applique", () => {
  it("sauvegardes et journal des suppressions", () => {
    const retention = byRef("T09").retention.join(" ");
    expect(retention).toContain(`${BACKUP_RETENTION_DAYS} jours au plus`);
    expect(retention).toContain(`${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours par entrée`);
  });

  it("sessions et codes de connexion", () => {
    expect(byRef("T01").retention.join(" ")).toContain(`${SESSION_RETENTION_DAYS} jours`);
    expect(byRef("T02").retention.join(" ")).toContain(`${DISCORD_CODE_VALIDITY_MINUTES} minutes`);
  });

  it("signalements et logos signalés, aux durées que le service applique", () => {
    const retention = byRef("T11").retention.join(" ");
    expect(retention).toContain(`${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après l'archivage`);
    expect(retention).toContain(`${LOGO_QUARANTINE_DAYS / 30} mois`);
    // Un logo supprimé retient lui aussi le signalement, le temps de la contestation.
    expect(retention).toContain("masqué ou supprimé");
  });

  it("le serveur tire bien ces durées du registre, sans les réécrire à la main", () => {
    const root = join(__dirname, "..", "..", "..");
    const auth = readFileSync(join(root, "lib", "server", "auth.ts"), "utf8");
    const users = readFileSync(join(root, "lib", "server", "users-service.ts"), "utf8");
    expect(auth).toContain("SESSION_TTL_DAYS = SESSION_RETENTION_DAYS");
    expect(users).toContain("INTERVAL ${DISCORD_CODE_VALIDITY_MINUTES} MINUTE");
    expect(users).not.toMatch(/INTERVAL 10 MINUTE/);
  });
});

describe("registerController", () => {
  it("porte le contact reçu, sans lire l'environnement", () => {
    expect(controller.contactEmail).toBe("rgpd@exemple.invalid");
    expect(controller.legalForm).toMatch(/loi 1901/);
  });

  it("déclare l'hébergeur des mentions légales comme sous-traitant, en France", () => {
    expect(controller.host).toContain(SITE_HOST.name);
    expect(controller.host).toContain(SITE_HOST.address);
    expect(controller.host).toMatch(/sous-traitant/);
    expect(controller.host).toMatch(/hébergées en France/);
  });

  it("les mentions légales affichent le même hébergeur, sans copie", () => {
    const page = readFileSync(join(__dirname, "..", "..", "..", "app", "mentions-legales", "page.tsx"), "utf8");
    expect(page).toContain("{SITE_HOST.address}");
    expect(page).not.toContain("Chemin Fourchue");
  });
});

describe("csvCell", () => {
  it("laisse passer une cellule simple", () => {
    expect(csvCell("Aucune")).toBe("Aucune");
  });

  it("met entre guillemets une cellule qui contient le séparateur, un guillemet ou un saut de ligne", () => {
    expect(csvCell("a;b")).toBe('"a;b"');
    expect(csvCell('dit "oui"')).toBe('"dit ""oui"""');
    expect(csvCell("a\nb")).toBe('"a\nb"');
  });

  it.each(["=SOMME(A1)", "+1", "-1", "@cmd", "\t=SOMME(A1)", "\r=SOMME(A1)"])("neutralise une formule : %j", (value) => {
    expect(csvCell(value).replace(/^"|"$/g, "")).toBe(`'${value}`);
  });
});

describe("registerToCsv", () => {
  const csv = registerToCsv(controller);

  it("commence par un BOM UTF-8 et termine par une fin de ligne Windows", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.endsWith("\r\n")).toBe(true);
  });

  it("une ligne d'en-tête, puis une ligne par traitement, toutes de même largeur", () => {
    const rows = parseCsv(csv.slice(1));
    expect(rows[0]).toEqual([...REGISTER_EXPORT_COLUMNS]);
    expect(rows).toHaveLength(PROCESSING_ACTIVITIES.length + 1);
    for (const row of rows) expect(row).toHaveLength(REGISTER_EXPORT_COLUMNS.length);
  });

  it("relit à l'identique le contenu du registre", () => {
    const rows = parseCsv(csv.slice(1));
    const t09 = rows.find((r) => r[0] === "T09") as string[];
    const col = (name: (typeof REGISTER_EXPORT_COLUMNS)[number]) => t09[REGISTER_EXPORT_COLUMNS.indexOf(name)];
    expect(col("Nom du traitement")).toBe("Sauvegardes");
    expect(col("Date de mise à jour")).toBe(REGISTER_UPDATED_AT);
    expect(col("Durées de conservation").split("\n")).toEqual(byRef("T09").retention);
    expect(col("Responsable du traitement")).toContain("rgpd@exemple.invalid");
    expect(col("Hébergeur (sous-traitant)")).toContain(SITE_HOST.address);
  });

  it("accepte une liste de traitements fournie", () => {
    const rows = parseCsv(registerToCsv(controller, [byRef("T03")]).slice(1));
    expect(rows.map((r) => r[0])).toEqual(["Réf.", "T03"]);
  });
});

describe("registerExportFilename", () => {
  it("est daté par la mise à jour du registre", () => {
    expect(registerExportFilename()).toBe(`registre-traitements-bluegenji-${REGISTER_UPDATED_AT}.csv`);
    expect(REGISTER_UPDATED_AT).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
