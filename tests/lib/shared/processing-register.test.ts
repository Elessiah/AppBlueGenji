import { describe, expect, it } from "@jest/globals";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PUSH_TOPICS } from "@/lib/shared/push-notifications";
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
import { PROCESSING_ACTIVITIES_EN } from "@/lib/shared/processing-register-en";
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

  it("ouvre le tag certifié aux arbitres dès l'inscription, et le BattleTag masqué par la seule fenêtre « Contacts »", () => {
    const subPurposes = byRef("T04").subPurposes.join(" ");
    expect(subPurposes).not.toMatch(/tournoi en cours/);
    expect(subPurposes).toMatch(/aux arbitres tant que le joueur est inscrit à un tournoi qui n'est pas terminé/);
    // Décisions du 2026-10-19 : plus d'accès propre au BattleTag masqué pour le staff,
    // seulement la fenêtre « Contacts », aux mêmes durées que les équipes.
    expect(subPurposes).toMatch(/Ne présenter aux administrateurs et aux arbitres le BattleTag masqué d'un joueur que dans la fenêtre « Contacts » d'un match du tournoi, aux mêmes durées que pour ses deux équipes/);
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

  it("couvre le programme d'arbitrage : base légale, trace gardée, push et canal de logs, personnes citées", () => {
    const t04 = byRef("T04");
    // Décision du 2026-10-14 : le staff est prévenu en exécution du service ;
    // les messages de match des joueurs restent d'intérêt légitime, opposables.
    expect(t04.legalBasis).toMatch(/exécution du service[^;]*programme d'arbitrage adressés au staff/);
    expect(t04.legalBasis).toMatch(/intérêt légitime[^;]*rappels de match envoyés aux joueurs, avec un droit d'opposition \(art\. 21\) honoré par un interrupteur de « Mon profil »/);
    expect(t04.subPurposes.join(" ")).toMatch(/couper ces messages privés depuis « Mon profil »/);
    // L'avis « Match retiré de ton programme » est l'un des messages coupés par l'interrupteur.
    expect(t04.subPurposes.join(" ")).toMatch(/l'avis qu'un match quitte son programme/);
    // T05 ne contredit pas T04 sur la base du programme d'arbitrage envoyé au staff.
    expect(t04.legalBasis).toMatch(/l'intérêt légitime \(bon déroulement des tournois\) restant la base à l'égard des joueurs et équipes qu'ils citent/);
    expect(byRef("T01").retention.join(" ")).toMatch(/annonces #live d'un tournoi individuel gardent le pseudo dans le salon Discord jusqu'à leur suppression sur demande, et l'alerte AutoMod d'une telle annonce bloquée ou signalée le garde dans le salon d'alertes des modérateurs jusqu'à sa suppression par eux ou sur demande \(T16\)/);
    expect(byRef("T08").subPurposes.join(" ")).toMatch(/salon #live du serveur de l'association, en un message par soirée modifié à chaque début et fin de match, avec une mention @everyone pour la chaîne officielle ou du seul rôle StreamViewer pour toute autre chaîne \(noms d'équipe ou, en tournoi individuel, pseudo public BlueGenji des joueurs/);
    expect(byRef("T08").retention.join(" ")).toMatch(/Annonces #live : dans le salon tant qu'il existe, même après la suppression du compte du joueur/);
    expect(byRef("T08").dataCategories.join(" ")).toMatch(/l'annonce #live, elle, reste publiée dans le salon \(traitement T16\)/);
    expect(byRef("T16").subPurposes.join(" ")).toMatch(/modifiable dans Mon profil, sans effet sur un message de soirée qui n'est plus modifié/);
    // Pseudo solo dans #live : exécution du service, pas intérêt légitime (décision du 2026-10-14).
    expect(byRef("T16").legalBasis).toMatch(/exécution du service demandé par le joueur \(RGPD, art\. 6\.1\.b — conditions d'utilisation\) pour son pseudo public dans l'annonce #live d'un tournoi individuel/);
    expect(byRef("T16").legalBasis).toMatch(/ne pas y être nommé revient à ne pas s'inscrire/);
    expect(byRef("T16").retention.join(" ")).toMatch(/relève de l'exécution du service et non de l'intérêt légitime/);
    // Un blocage AutoMod peut porter le texte de l'annonce au salon d'alertes des modérateurs.
    expect(byRef("T16").recipients.join(" ")).toMatch(/si une règle AutoMod de Discord bloque ou signale une annonce #live, son texte \(pseudo public compris en tournoi individuel\) peut parvenir au salon d'alertes de modération du serveur/);
    // LEGAL-OPTOUT-BASIS : garder le choix des messages de match relève d'une obligation légale
    // (honorer l'opposition), plus de « l'intérêt légitime du joueur » (art. 6.1.f vise le responsable ou un tiers).
    expect(t04.legalBasis).toMatch(/obligation légale \(RGPD, art\. 6\.1\.c\) pour la conservation de son choix des messages privés de match \(le garder est ce qui permet de continuer d'honorer son opposition, art\. 21 et 12\)/);
    expect(t04.legalBasis).not.toMatch(/celui du joueur|intérêt légitime du joueur/);
    // Les messages eux-mêmes restent d'intérêt légitime.
    expect(t04.legalBasis).toMatch(/intérêt légitime \(bon déroulement des tournois\) pour l'annonce des horaires de match/);
    expect(t04.dataSubjects).toContain("Tout titulaire de compte, pour son choix des messages privés de match");
    expect(byRef("T08").recipients.join(" ")).toMatch(/Membres du serveur Discord de l'association, qui lisent l'annonce des matchs diffusés dans le salon #live/);
    expect(byRef("T05").legalBasis).toMatch(/programme d'arbitrage aux arbitres et administrateurs relève de l'exécution du service \(T04\)/);
    expect(t04.dataCategories.join(" ")).toMatch(/recevoir ou non les messages privés Discord de ses matchs/);
    expect(t04.retention.join(" ")).toMatch(/Choix des messages privés de match : jusqu'à sa modification/);
    expect(t04.retention.join(" ")).toMatch(/Traces d'envoi des rappels, alertes et programmes d'arbitrage/);
    expect(t04.recipients.join(" ")).toMatch(/Service de push du navigateur de chaque destinataire abonné \(joueur : [^;]*; arbitre ou administrateur : programme d'arbitrage, litige tranché, résultat corrigé, abandon imposé à l'adversaire ou validation automatique suspendue par un membre du staff qui joue le match ; traitement T12\), qui/);
    expect(t04.subPurposes.join(" ")).toMatch(/en message privé Discord et en push l'annonce/);
    expect(t04.recipients.join(" ")).toMatch(/Staff de l'association ayant accès au canal de logs Discord/);
    expect(byRef("T05").dataCategories.join(" ")).toMatch(/Sur Discord : [^—]*horaires et manches des matchs/);
    expect(t04.transfers.join(" ")).toMatch(/Discord \(acheminement des messages privés et du canal de logs\)/);
    expect(t04.transfers.join(" ")).toMatch(/service de push[^—]*— Google, Mozilla, Apple et Microsoft/);
    expect(byRef("T05").dataSubjects).toContain(
      "Joueurs et équipes engagés dans un tournoi (désignés par le nom d'équipe, jamais par leur pseudo)",
    );
  });

  // Sujet push du staff ajouté par DISPUTE-FOLLOWUP : T12 (les notifications
  // push) le nomme comme /rgpd, en français et en anglais.
  it("nomme en T12 l'alerte d'un litige tranché par un membre du staff qui joue", () => {
    expect(PUSH_TOPICS.REFEREE_SELF_RESOLUTION.audience).toBe("tournaments");
    const t12 = byRef("T12").subPurposes.join(" ");
    expect(t12).toMatch(/Alertes d'arbitrage, litiges tranchés, résultats corrigés, abandons imposés à l'adversaire ou validations automatiques suspendues par un membre du staff qui joue le match, matchs planifiés/);
    const t12En = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T12")!.subPurposes.join(" ");
    // La suspension de la validation automatique par un arbitre qui joue (« Enregistrer ») et l'abandon imposé sont nommés en T04.
    expect(byRef("T04").subPurposes.join(" ")).toMatch(/« Valider le résultat »\), en corrige le résultat déjà acquis, impose l'abandon de son adversaire, ou en suspend la validation automatique d'un score proposé \(« Enregistrer »\)/);
    expect(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T04")!.subPurposes.join(" ")).toMatch(
      /“Confirm the result”\), corrects its already decided result, imposes their opponent's withdrawal, or pauses the automatic confirmation of a proposed score \(“Save”\)/,
    );
    expect(t12En).toMatch(/Referee alerts, disputes settled, results corrected, opponents' withdrawals imposed or automatic confirmations paused by a staff member who plays in the match, scheduled matches/);
  });

  // Revue juridique DISPUTE-FOLLOWUP : la vérification « arbitre qui joue » lit
  // l'appartenance du staff aux équipes du match (T04) ; chaque geste laisse une
  // trace nominative dans pm2, détaillée pour l'arbitre qui joue (T05).
  it("déclare la vérification de l'arbitre qui joue et ce que gardent les journaux du serveur (FR + EN)", () => {
    const t04 = byRef("T04");
    const t04En = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T04")!;
    expect(t04.dataCategories.join(" ")).toMatch(/Appartenance d'un membre du staff aux équipes d'un match qu'il arbitre/);
    expect(t04En.dataCategories.join(" ")).toMatch(/Membership of a staff member in the teams of a match they referee/);
    expect(t04.dataSubjects).toContain("Arbitres et administrateurs");
    expect(t04En.dataSubjects).toContain("Referees and administrators");
    expect(t04.legalBasis).toMatch(/intérêt légitime \(impartialité de l'arbitrage\) à l'égard du membre du staff qui arbitre, dont l'appartenance aux équipes du match est vérifiée à chacun de ces gestes[^;]*il peut s'y opposer \(art. 21\)/);
    expect(t04.dataCategories.join(" ")).toMatch(/comparée au lancement du match, à son premier report ou, à défaut, à sa création/);
    expect(byRef("T05").subPurposes.join(" ")).toMatch(/tout abandon imposé par l'arbitrage qui clôt une manche compris, une trace par manche close face à un adversaire connu, quelle que soit l'équipe retirée/);
    expect(t04.dataCategories.join(" ")).toMatch(/pour un abandon imposé, à la seule équipe adverse de l'équipe retirée/);
    expect(t04En.legalBasis).toMatch(/legitimate interest \(impartial refereeing\) with regard to the staff member who referees, whose membership of the match's teams is checked at each of these actions[^;]*they may object to it \(art. 21\)/);
    const t05 = byRef("T05").dataCategories.join(" ");
    expect(t05).toMatch(/« un membre du staff qui joue ce match », avec le seul nom du tournoi/);
    expect(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T05")!.dataCategories.join(" ")).toMatch(/“a staff member who plays in this match”, with the tournament name only/);
    expect(t04.recipients.join(" ")).toMatch(/canal de logs Discord \(programme d'arbitrage, gestes d'un membre du staff qui joue le match, traitement T05\)/);
    expect(t04En.recipients.join(" ")).toMatch(/Discord log channel \(refereeing schedule, actions of a staff member who plays in the match, processing activity T05\)/);
    const t05En = PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T05")!.dataCategories.join(" ");
    expect(t05).toMatch(/pour un arbitre qui joue le match, en plus : tournoi, manche et, sauf pour une suspension, issue et noms d'équipe/);
    expect(byRef("T05").legalBasis).toMatch(/et du membre du staff auteur d'un geste, nommé dans les journaux du serveur/);
    expect(byRef("T05").subPurposes.join(" ")).toMatch(/une trace courte dans les seuls journaux du serveur/);
    expect(t05En).toMatch(/for a referee who plays in the match, also: tournament, round and, except for a pause, outcome and team names/);
    expect(PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T05")!.legalBasis).toMatch(/and to the staff member who carried out an action, named in the server logs/);
  });

  it("/rgpd (FR + EN) dit l'intérêt légitime du contrôle de l'arbitre qui joue et le droit de s'y opposer", () => {
    const appDir = join(__dirname, "..", "..", "..", "app", "rgpd");
    const fr = readFileSync(join(appDir, "page.tsx"), "utf8").replace(/\s+/g, " ");
    const en = readFileSync(join(appDir, "RgpdEn.tsx"), "utf8").replace(/\s+/g, " ");
    expect(fr).toContain("ce contrôle repose sur l&apos;<strong>intérêt légitime</strong> de l&apos;association à l&apos;impartialité de l&apos;arbitrage, et ce membre du staff peut s&apos;y opposer");
    expect(fr).toContain("ou l&apos;a quittée depuis son lancement, son premier report ou, à défaut, sa création");
    expect(en).toContain("or left it since the match was launched, its first report or, failing these, its creation");
    expect(en).toContain("this check rests on the association&apos;s <strong>legitimate interest</strong> in impartial refereeing, and this staff member may object to it");
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
    expect(byRef("T01").recipients.join(" ")).toMatch(/Parties d'un même match, dans sa seule fenêtre « Contacts ».*BattleTag même masqué/);
  });

  it("ne déclare aucune adresse e-mail collectée", () => {
    expect(byRef("T01").dataCategories.join(" ")).toMatch(/aucune adresse e-mail/i);
  });
});

describe("revue légale #445 — T08 et l'alerte AutoMod (FR et EN)", () => {
  const fr = (ref: string) => PROCESSING_ACTIVITIES.find((a) => a.ref === ref)!;
  const en = (ref: string) => PROCESSING_ACTIVITIES_EN.find((a) => a.ref === ref)!;

  it("T08 remet l'avis « Match retiré » et nomme les modérateurs destinataires d'une alerte AutoMod", () => {
    expect(fr("T08").subPurposes.join(" ")).toMatch(/horaires et rappels de match et avis de retrait d'un match \(« Match retiré » ; ces messages de match aux seuls tags Discord certifiés\), avis de modération/);
    expect(en("T08").subPurposes.join(" ")).toMatch(/match times and reminders and notices of removal from a match \(“Match retiré”; these match messages to certified Discord tags only\), moderation notices/);
    expect(fr("T08").recipients).toContain("Modérateurs du serveur Discord de l'association, si une règle AutoMod de Discord bloque ou signale une annonce #live (traitement T16)");
    expect(en("T08").recipients).toContain("Moderators of the association's Discord server, if a Discord AutoMod rule blocks or flags a #live announcement (processing activity T16)");
  });

  it("T04 dit que les messages privés de match ne partent qu'aux tags Discord certifiés (FR et EN)", () => {
    expect(fr("T04").subPurposes.join(" ")).toMatch(/les messages privés ne partent qu'aux comptes dont le tag Discord est certifié \(un tag non certifié, même rattaché par la connexion Discord, n'en reçoit aucun, pour éviter le spam\)/);
    expect(en("T04").subPurposes.join(" ")).toMatch(/direct messages only go to accounts with a certified Discord tag \(an uncertified tag, even one linked by signing in with Discord, receives none, to avoid spam\)/);
  });

  it("T16 dit combien de temps l'alerte AutoMod reste, et qu'elle est supprimée sur demande", () => {
    expect(fr("T16").retention.join(" ")).toMatch(/Alerte AutoMod \(annonce #live bloquée ou signalée\) : gardée dans le salon d'alertes de modération du serveur jusqu'à sa suppression par les modérateurs, et supprimée sur demande/);
    expect(en("T16").retention.join(" ")).toMatch(/AutoMod alert \(blocked or flagged #live announcement\): kept in the server's moderation alert channel until the moderators delete it, and deleted at the request/);
    expect(fr("T16").retention).toHaveLength(en("T16").retention.length);
  });

  it("T13 recueille aussi l'acceptation à une connexion, seulement si elle vient d'être donnée sur la page (FR et EN)", () => {
    expect(fr("T13").subPurposes.join(" ")).toMatch(/à une connexion lancée depuis la page de connexion \(clic sur Google, Discord ou Blizzard, ou envoi du code reçu sur Discord\) dans les dix minutes où les conditions y ont été acceptées \(une acceptation seulement gardée par le navigateur n'est pas reportée sur un compte existant\)/);
    expect(en("T13").subPurposes.join(" ")).toMatch(/at a login started from the login page \(click on Google, Discord or Blizzard, or submission of the code received on Discord\) within ten minutes of accepting the terms there \(an acceptance only kept by the browser is not carried over to an existing account\)/);
  });

  it("T16 donne une base à l'alerte AutoMod : intérêt légitime de modérer le serveur, opposition = suppression (FR et EN)", () => {
    expect(fr("T16").legalBasis).toMatch(/intérêt légitime de l'association à modérer son serveur Discord pour l'alerte AutoMod d'une annonce #live bloquée ou signalée[^;]*droit d'opposition \(art\. 21\) : l'alerte est supprimée sur demande/);
    expect(en("T16").legalBasis).toMatch(/legitimate interest of the association in moderating its Discord server for the AutoMod alert of a blocked or flagged #live announcement[^;]*right to object \(art\. 21\): the alert is deleted on request/);
  });

  it("T16 dit la finalité de modération de l'alerte AutoMod (FR et EN)", () => {
    expect(fr("T16").subPurposes.join(" ")).toMatch(/Modérer le serveur Discord de l'association : une règle AutoMod de Discord qui bloque ou signale une annonce #live en copie le texte/);
    expect(en("T16").subPurposes.join(" ")).toMatch(/Moderating the association's Discord server: a Discord AutoMod rule that blocks or flags a #live announcement copies its text/);
  });

  it("T08 garde la même durée de l'alerte AutoMod que T16 et la politique du bot, compte supprimé compris", () => {
    expect(fr("T08").retention.join(" ")).toMatch(/Alerte AutoMod d'une annonce #live bloquée ou signalée : dans le salon d'alertes de modération jusqu'à sa suppression par les modérateurs, même après la suppression du compte du joueur, et supprimée sur demande/);
    expect(en("T08").retention.join(" ")).toMatch(/AutoMod alert for a blocked or flagged #live announcement: in the moderation alert channel until the moderators delete it, even after the player's account is deleted, and deleted at the request/);
    expect(fr("T08").retention).toHaveLength(en("T08").retention.length);
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
      /exécution du service demandé par le joueur \(contrat — conditions d'utilisation, section « Contacts de match »\) pour la présentation des contacts aux parties d'un match dans sa fenêtre « Contacts » et dans sa fenêtre de lancement \(à ses deux équipes et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, à son caster le temps du match, et ceux du caster — service qu'il demande en s'inscrivant sur le match — à ses deux équipes le temps du match et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin ; la fenêtre de lancement, au départ du match, ne s'ouvre qu'aux deux équipes et au caster\), BattleTag masqué compris — arbitres et administrateurs n'y ont pas d'autre accès, sur la même base —,/,
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
    // Le site ne fait que lier les chaînes : seule l'annonce #live passe par Discord.
    expect(sheet.transfers).toHaveLength(1);
    expect(sheet.transfers[0]).toMatch(/^États-Unis : Discord \(annonce publiée dans le salon #live, et alerte AutoMod d'une annonce bloquée ou signalée\)/);
    // Décision du 2026-10-14 : pseudo public des joueurs d'un tournoi individuel.
    expect(sheet.subPurposes.join(" ")).toMatch(/salon #live .* @everyone .*jamais le pseudo de leurs joueurs\) ou, en tournoi individuel, pseudo public BlueGenji des deux joueurs \(le pseudo de sa fiche, modifiable dans Mon profil, sans effet sur un message de soirée qui n'est plus modifié : sans changement, le pseudo Discord ou le BattleTag repris à la création du compte, voire le nom du compte Google pour un compte Google créé avant le 30 septembre 2026 ; jamais l'identifiant Discord numérique/);
    expect(sheet.retention.join(" ")).toMatch(/conservé dans le salon tant que le salon #live existe, même après la suppression du compte du joueur, et supprimé sur demande de l'équipe ou du joueur concerné/);
    expect(sheet.recipients.join(" ")).toMatch(/pseudo public BlueGenji des joueurs d'un tournoi individuel/);
    // Le pseudo publié dans #live est une catégorie de données de T16.
    expect(sheet.dataCategories.join(" ")).toMatch(/Pseudo public BlueGenji des joueurs d'un tournoi individuel, publié dans l'annonce #live/);
    expect(sheet.recipients.join(" ")).toMatch(/Membres du serveur Discord de l'association/);
    expect(sheet.retention.join(" ")).toMatch(/Annonce sur Discord : .* effacée avec le match/);
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

describe("T01 : « Ne plus afficher » de la fenêtre du recrutement (MODAL-DISMISS)", () => {
  const enT01 = () => PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T01") as ProcessingActivity;

  it("la donnée gardée sur le compte a sa finalité, en français et en anglais", () => {
    expect(byRef("T01").dataCategories.join(" ")).toMatch(/Choix « Ne plus afficher » de la fenêtre des annonces de recrutement urgentes/);
    expect(byRef("T01").subPurposes.join(" ")).toMatch(
      /Garder sur le compte le choix « Ne plus afficher » de la fenêtre des annonces de recrutement urgentes, pour qu'elle ne s'ouvre plus d'elle-même sur les autres appareils du joueur/,
    );
    expect(enT01().subPurposes.join(" ")).toMatch(
      /Keeping on the account the “Don't show again” choice of the window of urgent recruitment announcements, so that it no longer opens on its own on the player's other devices/,
    );
    expect(enT01().subPurposes).toHaveLength(byRef("T01").subPurposes.length);
  });

  it("dit que décocher la case de « Mon profil » pose aussi le choix (FR et EN)", () => {
    expect(byRef("T01").dataCategories.join(" ")).toMatch(/urgentes, fait dans cette fenêtre ou en décochant la case de « Mon profil »/);
    expect(enT01().dataCategories.join(" ")).toMatch(/announcements, made in that window or by unticking the “My profile” box/);
  });
});

describe("sauvegardes (T09) : deux fois par semaine, dimanche et mardi (BACKUP-SCHEDULE)", () => {
  const enT09 = () => PROCESSING_ACTIVITIES_EN.find((a) => a.ref === "T09")!;

  it("annonce l'archive des bases le dimanche et le mardi soir (FR et EN)", () => {
    expect(byRef("T09").subPurposes[0]).toBe("Archive deux fois par semaine (dimanche et mardi soir) des bases de données du site et du bot");
    expect(enT09().subPurposes[0]).toBe("Twice-weekly archive (Sunday and Tuesday evenings) of the site's and the bot's databases");
  });

  it("ne dit plus « hebdomadaire » ni « weekly » pour les sauvegardes, durée inchangée", () => {
    expect(JSON.stringify(byRef("T09"))).not.toMatch(/hebdomadaire|lundi/i);
    expect(JSON.stringify(enT09())).not.toMatch(/(?<!Twice-)\bweekly\b|monday/i);
    expect(enT09().retention[0]).toContain(`${BACKUP_RETENTION_DAYS} days at most`);
  });
});
