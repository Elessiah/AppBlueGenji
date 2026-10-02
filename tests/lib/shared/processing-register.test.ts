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
  ALL_TRANSFER_RECIPIENTS,
  DPF_ADEQUACY_DECISION,
  HETZNER_BACKUP_FRAMEWORK,
  SPICEWORKS_PROCESSOR_FRAMEWORK,
  SPICEWORKS_SCC_FALLBACK,
  STANDARD_CONTRACTUAL_CLAUSES,
  TRANSFER_RECIPIENTS,
  transferBasis,
  csvCell,
  registerController,
  registerExportFilename,
  registerToCsv,
  HOST_PROCESSING_AGREEMENT,
  REGISTER_SCOPE_DETAIL,
  SUPPORT_TICKET_RETENTION_MONTHS,
  WEB_ACCESS_LOG_RETENTION_DAYS,
  type ProcessingActivity,
} from "@/lib/shared/processing-register";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION } from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { SITE_HOST } from "@/lib/shared/site-host";
import { DATA_CONTACT_NAME, LEGAL_CONTACT_DISCORD, RGPD_CONTACT_LINE } from "@/lib/shared/legal-contact";
import { readSource } from "../../helpers/read-source";

const controller = registerController();
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

  it("déclare la preuve d'acceptation des conditions d'utilisation (bg_terms_acceptances)", () => {
    const terms = byRef("T13");
    expect(terms.name).toMatch(/conditions d'utilisation/);
    expect(terms.dataCategories.join(" ")).toMatch(/Version acceptée/);
    expect(terms.retention.join(" ")).toMatch(/Durée du compte/);
    // `anonymizeAccount` efface `bg_terms_acceptances` **et**
    // `bg_users.terms_version` / `terms_accepted_at` : le registre le dit.
    expect(terms.retention.join(" ")).toMatch(/effacé ou anonymisé — le détail des acceptations comme la dernière version acceptée et sa date/);
    expect(terms.retention.join(" ")).not.toMatch(/restent attachées/);
    expect(terms.transfers).toEqual(["Aucun"]);
  });

  it("ouvre le tag certifié et le BattleTag masqué aux arbitres dès l'inscription, pas au seul tournoi en cours", () => {
    const subPurposes = byRef("T04").subPurposes.join(" ");
    expect(subPurposes).not.toMatch(/tournoi en cours/);
    expect(subPurposes).toMatch(/aux arbitres tant que le joueur est inscrit à un tournoi qui n'est pas terminé/);
    expect(subPurposes).toMatch(/aux administrateurs et aux arbitres le BattleTag masqué/);
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

  it("déclare l'information sur les changements de politique et leur annonce Discord", () => {
    const t10 = byRef("T10");
    expect(t10.dataCategories.join(" ")).toMatch(/pris connaissance/i);
    // Informer n'est pas faire consentir (art. 12 à 14) : aucun accord n'est recueilli.
    expect(t10.legalBasis).toMatch(/information/i);
    expect(t10.legalBasis).not.toMatch(/consentement/i);
    expect(t10.subPurposes.join(" ")).not.toMatch(/supprime mon compte|J'accepte/);
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
    expect(retention).toContain(`${LOGO_QUARANTINE_MONTHS} mois`);
    // Un logo supprimé retient lui aussi le signalement, le temps de la contestation.
    expect(retention).toContain("masqué ou supprimé");
  });

  it("le serveur tire bien ces durées du registre, sans les réécrire à la main", () => {
    const root = join(__dirname, "..", "..", "..");
    const auth = readFileSync(join(root, "lib", "server", "auth.ts"), "utf8");
    const users = readSource("lib/server/users/discord-challenges.ts");
    expect(auth).toContain("SESSION_TTL_DAYS = SESSION_RETENTION_DAYS");
    expect(users).toContain("INTERVAL ${DISCORD_CODE_VALIDITY_MINUTES} MINUTE");
    expect(users).not.toMatch(/INTERVAL 10 MINUTE/);
  });
});

describe("T03 — conservation des résultats de tournois", () => {
  it("dit qu'aucune durée n'est définie, tant que le site existe, et l'anonymisation à la suppression", () => {
    const retention = byRef("T03").retention.join(" ");
    expect(retention).toContain("aucune durée de conservation définie, conservés tant que le site existe");
    expect(retention).toContain("anonymisés à la suppression du compte");
  });
});

describe("T11 — demandes reçues par courriel ou téléphone", () => {
  it("nomme la personne à contacter et Microsoft, qui héberge sa messagerie, sans prétendre à une durée", () => {
    const t11 = byRef("T11");
    expect(t11.recipients.join(" ")).toContain(DATA_CONTACT_NAME);
    expect(t11.recipients.join(" ")).toContain("Microsoft, qui héberge la messagerie");
    expect(t11.transfers.join(" ")).toMatch(/Microsoft \(messagerie Outlook\.com/);
    expect(t11.retention.join(" ")).toContain("même règle qu'une demande RGPD faite depuis le formulaire");
    expect(t11.recipients.join(" ")).toContain("sans contrat de sous-traitance");
    expect(t11.recipients.join(" ")).toContain("lisibles par Microsoft");
    expect(t11.dataSubjects.join(" ")).toContain("par courriel ou par téléphone");
    expect(t11.dataCategories.join(" ")).toContain("reçues par courriel ou par téléphone");
    // Finalité et base légale du canal, questions simples comprises (art. 13.1.c, 30.1.b).
    expect(t11.subPurposes.join(" ")).toContain("Recevoir par courriel ou par téléphone");
    // Même base que la catégorie RGPD du formulaire : un canal ne change pas la base légale.
    expect(t11.legalBasis).toContain("par courriel ou par téléphone comme par le formulaire (catégorie RGPD)");
    expect(t11.legalBasis).toContain("repose sur la même obligation légale");
  });
});

describe("registerController", () => {
  it("donne la personne à contacter pour les données, le formulaire et l'association, sans tag Discord ni adresse électronique", () => {
    expect(controller.contact).toBe(RGPD_CONTACT_LINE);
    expect(controller.contact).not.toContain(LEGAL_CONTACT_DISCORD);
    expect(controller.dataContact).toContain(DATA_CONTACT_NAME);
    // Jamais présentée comme un délégué (art. 37) : la rubrique le dit.
    expect(controller.dataContact).toMatch(/n'est pas délégué à la protection des données au sens de l'article 37/);
    expect(controller.dataContact).toContain("l'association reste responsable du traitement");
    expect(controller.dataContact).not.toMatch(/non obligatoire/);
    expect(controller.dataContact).not.toContain("@");
    expect(controller.contact).toContain("RGPD");
    expect(controller.contact).not.toContain("@");
    expect(controller.legalForm).toMatch(/loi 1901/);
  });

  it("déclare l'hébergeur des mentions légales comme sous-traitant, en France", () => {
    expect(controller.host).toContain(SITE_HOST.name);
    expect(controller.host).toContain(SITE_HOST.address);
    expect(controller.host).toMatch(/sous-traitant/);
    expect(controller.host).toMatch(/hébergées en France/);
  });

  it("les mentions légales affichent le même hébergeur, sans copie", () => {
    // Fins de ligne normalisées : un checkout Windows lit la page en CRLF, et
    // l'attendu code le retour à la ligne en LF.
    const page = readFileSync(join(__dirname, "..", "..", "..", "app", "mentions-legales", "page.tsx"), "utf8").replaceAll("\r\n", "\n");
    expect(page).toContain("{SITE_HOST.address}");
    expect(page).not.toContain("Chemin Fourchue");
  });

  it("ne publie aucun SIREN : l'hébergeur est un particulier bénévole, sans immatriculation", () => {
    const page = readFileSync(join(__dirname, "..", "..", "..", "app", "mentions-legales", "page.tsx"), "utf8").replaceAll("\r\n", "\n");
    // Le mot n'y figure que pour dire que l'association n'en a pas.
    expect(page.match(/SIRE[NT]/gi)).toEqual(["SIREN"]);
    expect(page).toContain("ni d&apos;un numéro RNA ni\n          d&apos;un numéro SIREN");
    expect(page).not.toMatch(/\b\d{3} ?\d{3} ?\d{3}\b/);
    expect(controller.host).not.toMatch(/SIRE[NT]/i);
    expect(controller.host).toContain("bénévole");
    expect(Object.keys(SITE_HOST)).not.toContain("siren");
    expect(controller.host).not.toMatch(/\d{3} \d{3} \d{3}/);
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
    expect(col("Responsable du traitement")).toContain(RGPD_CONTACT_LINE);
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

describe("bases légales : le registre et la politique disent la même chose", () => {
  const byRef = (ref: string) => PROCESSING_ACTIVITIES.find((a) => a.ref === ref)!;

  it("fonde le compte (T01) et l'authentification (T02) sur le contrat", () => {
    // Un consentement demandé pour des données sans lesquelles le compte
    // n'existe pas ne serait pas libre (RGPD art. 7.4).
    expect(byRef("T01").legalBasis).toMatch(/^Exécution du service demandé par le joueur \(contrat\)/);
    expect(byRef("T02").legalBasis).toMatch(/contrat/);
  });

  it("fonde l'exposition du tag (T04) sur une certification distincte de la connexion", () => {
    expect(byRef("T04").legalBasis).toMatch(/Consentement pour l'exposition du pseudo Discord certifié/);
    expect(byRef("T04").legalBasis).toMatch(/jamais acquise par la seule connexion/);
  });

  it("fonde les contacts du lancement d'un match sur l'exécution des conditions d'utilisation", () => {
    expect(byRef("T04").legalBasis).toMatch(
      /exécution du service demandé par le joueur \(contrat — conditions d'utilisation\) pour la présentation des contacts aux parties d'un match à son lancement/,
    );
  });

  it("ne mentionne plus l'invite Google One Tap, retirée du site", () => {
    const text = JSON.stringify(PROCESSING_ACTIVITIES);
    expect(text).not.toMatch(/One Tap/i);
  });

  it("nomme le mécanisme de chaque transfert hors UE, jamais « les garanties propres à chacun »", () => {
    for (const activity of PROCESSING_ACTIVITIES) {
      for (const transfer of activity.transfers) {
        expect(transfer).not.toMatch(/garanties propres/);
        // Plus de formule conditionnelle : chaque transfert dit sur quoi il repose.
        expect(transfer).not.toMatch(/à défaut|pour un destinataire certifié/);
        if (transfer === "Aucun") continue;
        // Un mécanisme inconnu est dit « décision requise », jamais deviné :
        // l'exception est voulue, et ne vaut que pour la partie qui le dit.
        const known = transfer.split(/ ; |— décision requise/)[0];
        if (/décision requise/.test(transfer) && !/2023\/1795|clauses contractuelles types de la Commission/.test(known)) {
          expect(transfer).toMatch(/décision requise : mécanisme d'encadrement du transfert/);
          continue;
        }
        expect(transfer).toMatch(/2023\/1795|clauses contractuelles types de la Commission/);
      }
    }
    expect(DPF_ADEQUACY_DECISION).toMatch(/2023\/1795/);
    expect(DPF_ADEQUACY_DECISION).toMatch(/10 juillet 2023/);
    expect(STANDARD_CONTRACTUAL_CLAUSES).toMatch(/clauses contractuelles types/);
  });

  it("rattache Google, Microsoft, Apple, Mozilla, Discord et Spiceworks au DPF, Blizzard aux clauses contractuelles types", () => {
    expect(ALL_TRANSFER_RECIPIENTS).toHaveLength(Object.keys(TRANSFER_RECIPIENTS).length);
    for (const r of ["GOOGLE", "MICROSOFT", "APPLE", "MOZILLA", "DISCORD", "SPICEWORKS"] as const) {
      expect(TRANSFER_RECIPIENTS[r].mechanism).toBe("DPF");
    }
    expect(TRANSFER_RECIPIENTS.BLIZZARD.mechanism).toBe("SCC");
  });

  describe("transferBasis", () => {
    it("nomme un destinataire certifié au singulier", () => {
      expect(transferBasis(["DISCORD"])).toBe(
        `Discord, certifié EU-U.S. Data Privacy Framework : ${DPF_ADEQUACY_DECISION}`,
      );
    });

    it("regroupe par mécanisme et sépare les deux groupes", () => {
      expect(transferBasis(["GOOGLE", "DISCORD", "BLIZZARD"])).toBe(
        `Google et Discord, certifiés EU-U.S. Data Privacy Framework : ${DPF_ADEQUACY_DECISION} ; Blizzard : ${STANDARD_CONTRACTUAL_CLAUSES}`,
      );
    });

    it("énumère trois noms ou plus avec une virgule et un « et » final", () => {
      expect(transferBasis(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])).toMatch(
        /^Google, Mozilla, Apple et Microsoft, certifiés /,
      );
    });

    it("ignore les doublons, et rend une chaîne vide sans destinataire", () => {
      expect(transferBasis(["DISCORD", "DISCORD"])).toBe(transferBasis(["DISCORD"]));
      expect(transferBasis([])).toBe("");
    });

    it("nomme seul Blizzard sans groupe DPF", () => {
      expect(transferBasis(["BLIZZARD"])).toBe(`Blizzard : ${STANDARD_CONTRACTUAL_CLAUSES}`);
    });
  });

  it("nomme Hetzner, en Allemagne, destinataire des sauvegardes chiffrées (T09), sans transfert", () => {
    const backups = byRef("T09");
    expect(backups.recipients.join(" ")).toContain(HETZNER_BACKUP_FRAMEWORK);
    expect(HETZNER_BACKUP_FRAMEWORK).toMatch(/Hetzner Online GmbH \(Allemagne\)/);
    expect(HETZNER_BACKUP_FRAMEWORK).toMatch(/version 1\.2/);
    expect(HETZNER_BACKUP_FRAMEWORK).toMatch(/1er octobre 2026/);
    expect(HETZNER_BACKUP_FRAMEWORK).toMatch(/exclusivement dans l'Union européenne/);
    expect(backups.transfers).toEqual(["Aucun"]);
  });

  it("ne nomme plus Microsoft ni OneDrive pour les sauvegardes, clés chez le seul hébergeur", () => {
    const text = JSON.stringify(byRef("T09"));
    expect(text).not.toMatch(/Microsoft|OneDrive/);
    expect(byRef("T09").recipients.join(" ")).toMatch(/Keryan Houssin, .*seul détenteur des clés/);
    expect(byRef("T09").security.join(" ")).toMatch(/avant tout envoi/);
    expect(byRef("T09").security.join(" ")).toMatch(/jamais transmises à Hetzner/);
  });

  it("dit où le site et le bot sont hébergés", () => {
    expect(registerController().host).toMatch(/Raspberry Pi, à Caen/);
  });
});

describe("décisions de l'association du 2026-09-30", () => {
  const text = (activity: ProcessingActivity) => JSON.stringify(activity);

  it("sort les adhésions du registre du site, sans promettre de fiche", () => {
    expect(REGISTER_SCOPE_DETAIL).toMatch(/adhésions à l'association ne relève pas du site/);
    expect(REGISTER_SCOPE_DETAIL).not.toMatch(/pas encore de fiche/);
    expect(JSON.stringify(PROCESSING_ACTIVITIES)).not.toMatch(/Gestion des adhésions/);
  });

  it("donne une fiche au portail Spiceworks, supprimé un mois après la clôture", () => {
    const sheet = byRef("T15");
    expect(sheet.name).toMatch(/Spiceworks/);
    expect(SUPPORT_TICKET_RETENTION_MONTHS).toBe(1);
    expect(sheet.retention.join(" ")).toContain(`${SUPPORT_TICKET_RETENTION_MONTHS} mois après sa clôture`);
    // Sous-traitant sous l'accord de traitement de Spiceworks ; transfert sur
    // le DPF de Ziff Davis, clauses contractuelles types en repli.
    expect(text(sheet)).not.toMatch(/décision requise/);
    expect(sheet.recipients.join(" ")).toContain(SPICEWORKS_PROCESSOR_FRAMEWORK);
    expect(SPICEWORKS_PROCESSOR_FRAMEWORK).toMatch(/sous-traitant/);
    expect(sheet.transfers.join(" ")).toContain(transferBasis(["SPICEWORKS"]));
    expect(sheet.transfers.join(" ")).toMatch(/Ziff Davis, Inc\./);
    expect(sheet.transfers.join(" ")).toContain(SPICEWORKS_SCC_FALLBACK);
  });

  it("donne une fiche à la retransmission, avec un droit d'opposition", () => {
    const sheet = byRef("T16");
    expect(sheet.legalBasis).toMatch(/Intérêt légitime/);
    expect(sheet.legalBasis).toMatch(/droit d'opposition/);
    expect(sheet.dataCategories.join(" ")).toMatch(/Pseudos .* noms d'équipe/);
    expect(sheet.retention.join(" ")).toMatch(/Lien de rediffusion : conservé avec le match/);
    // Le site ne fait que lier les chaînes : aucun transfert de sa part.
    expect(sheet.transfers).toEqual(["Aucun"]);
    expect(sheet.recipients.join(" ")).toMatch(/n'intègre aucun lecteur/);
    expect(sheet.dataCategories.join(" ")).toMatch(/ni webcam ni chat vocal des joueurs/);
    expect(sheet.retention.join(" ")).toMatch(/nom neutre/);
    expect(text(sheet)).not.toMatch(/décision requise/);
  });

  it("donne une fiche aux journaux nginx, 14 jours", () => {
    const sheet = byRef("T17");
    expect(WEB_ACCESS_LOG_RETENTION_DAYS).toBe(14);
    expect(sheet.retention.join(" ")).toContain(`${WEB_ACCESS_LOG_RETENTION_DAYS} jours au plus`);
    expect(sheet.transfers).toEqual(["Aucun"]);
  });

  it("dit le contrat de l'article 28 avec l'hébergeur rédigé, pas signé", () => {
    expect(HOST_PROCESSING_AGREEMENT).toMatch(/art\. 28/);
    expect(HOST_PROCESSING_AGREEMENT).toMatch(/en attente de signature/);
    expect(controller.host).toContain(HOST_PROCESSING_AGREEMENT);
    expect(byRef("T09").recipients.join(" ")).toContain(HOST_PROCESSING_AGREEMENT);
    expect(byRef("T09").security.join(" ")).toMatch(/remote rclone de type crypt .* vérifié en production le 30 septembre 2026/);
  });

  it("nomme Google destinataire du courriel de l'association, avec la même durée que les demandes RGPD", () => {
    const sheet = byRef("T11");
    expect(sheet.recipients.join(" ")).toMatch(/Google \(messagerie Gmail de l'association/);
    expect(sheet.transfers.join(" ")).toMatch(/Google \(messagerie Gmail de l'association\) — Google, certifié/);
    expect(sheet.retention.join(" ")).toContain(
      `Demande reçue au courriel ou au téléphone de l'association : même règle — durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa clôture`,
    );
  });

  it("ne garde ni le port source, ni les contenus, ni les données de création au-delà du compte", () => {
    const categories = byRef("T14").dataCategories.join(" ");
    expect(categories).toMatch(/Ni port source/);
    expect(categories).toMatch(/seules les ouvertures de session sont consignées/);
    expect(byRef("T01").retention.join(" ")).toMatch(
      /les informations fournies à la création du compte \(pseudo, identifiants de fournisseur\) ne sont pas gardées après la suppression/,
    );
  });
});
