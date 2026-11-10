/**
 * Registre des activités de traitement (RGPD, article 30) — publié.
 *
 * Le registre est un document que la CNIL peut demander à tout moment. Plutôt
 * qu'un tableur tenu à part, qui dériverait du code au premier changement (la
 * page `/rgpd` a annoncé « quelques jours » pour des sauvegardes gardées six
 * mois), il vit ici, à côté des constantes qu'il cite, et se lit de deux façons :
 * la page `/rgpd/registre` et son export tableur. Tout le monde peut le
 * récupérer — la CNIL, un joueur, le staff — sans rien demander à personne.
 *
 * Les rubriques suivent le modèle de registre de la CNIL (description, acteurs,
 * finalités, mesures de sécurité, données, durées, personnes, destinataires,
 * transferts hors UE), plus la base légale.
 *
 * **Règle d'entretien** : un traitement ajouté au site (une table qui garde une
 * donnée personnelle, un envoi vers un tiers) s'ajoute ici dans la même PR, et
 * `REGISTER_UPDATED_AT` avance. Les durées citées viennent des constantes du
 * code chaque fois qu'il y en a une : c'est ce qui les empêche de mentir.
 *
 * Module pur : aucune lecture d'environnement. Le contact ne comporte aucune
 * adresse en clair — il renvoie aux pages qui la révèlent au clic
 * (`lib/shared/legal-contact.ts`).
 *
 * **Deux langues, une écriture** : chaque fiche (`ACTIVITIES`, rangée sous sa
 * référence) porte le français et sa traduction anglaise côte à côte, en
 * `frEn("français", "anglais")` ; `PROCESSING_ACTIVITIES` et
 * `PROCESSING_ACTIVITIES_EN` en sont tirés (`lib/shared/bilingual.ts`). Mêmes
 * fiches, même ordre, autant de puces et les mêmes constantes dans les deux
 * langues, par construction. Le français fait foi ;
 * `processing-register-en.ts` ne fait que réexporter l'anglais
 * (`docs/features/LEGAL_DATA_FILES.md`).
 */
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS, BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import {
  SITE_VISIT_DETAIL_RETENTION_DAYS,
  SITE_VISIT_WINDOW_MINUTES,
  SITE_VISITOR_RETENTION_MONTHS,
} from "@/lib/shared/site-visits";
import { SITE_HOST } from "@/lib/shared/site-host";
import {
  VOICE_BOT_ABANDONED_MAX_HOURS,
  VOICE_BOT_RELEASED_MAX_HOURS,
  VOICE_BOT_SWEEP_MINUTES,
  VOICE_BOT_UNRELEASED_MAX_HOURS,
  VOICE_CHANNEL_CAPACITY,
  VOICE_CHANNEL_LEAD_MINUTES,
  VOICE_CHANNEL_LATE_HOURS,
  VOICE_ROW_RETENTION_DAYS,
  VOICE_SWEEP_THROTTLE_SECONDS,
} from "@/lib/shared/match-voice";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION, copyrightNoticeElementsText } from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { SUSPENSION_RETENTION_MONTHS } from "@/lib/shared/account-suspension";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import {
  TEAM_INVITE_NOTICE_COOLDOWN_HOURS,
  TEAM_INVITE_NOTICES_DAILY_CAP,
  TEAM_INVITE_NOTICES_PER_PLAYER_CAP,
} from "@/lib/shared/team-invite-notice";
import {
  BOT_FEED_EVENT_RETENTION_DAYS,
  BOT_STAFF_LOG_RETENTION_DAYS,
  SUPPORT_TICKET_RETENTION_MONTHS,
  WEB_ACCESS_LOG_FIELDS,
  WEB_ACCESS_LOG_RETENTION_DAYS,
} from "@/lib/shared/legal-durations";
import {
  ASSOCIATION_NAME,
  ASSOCIATION_SEAT,
  DATA_CONTACT_NAME,
  DATA_CONTACT_ROLE,
  RGPD_CONTACT_LINE,
} from "@/lib/shared/legal-contact";
import {
  DATA_CONTACT_ROLE_EN,
  REPORT_FORM_NAME_EN,
  WEB_ACCESS_LOG_FIELDS_EN,
  copyrightNoticeElementsTextEn,
  monthsEn,
} from "@/lib/shared/legal-text-en";
import { frEn, localize, type Localizable } from "@/lib/shared/bilingual";
import { ACCOUNT_REACTIVATION_DAYS, REACTIVATION_TICKET_MINUTES } from "@/lib/shared/account-deletion";

/** Date de dernière mise à jour du registre (AAAA-MM-JJ). À avancer à chaque modification. */
export const REGISTER_UPDATED_AT = "2026-11-12";

/**
 * Durées appliquées par le serveur, et déclarées ici : `lib/server/auth.ts` et
 * `lib/server/users/discord-challenges.ts` les importent, si bien que le registre ne peut
 * pas annoncer une durée que le code ne tient pas.
 */
export const SESSION_RETENTION_DAYS = 30;
export const DISCORD_CODE_VALIDITY_MINUTES = 10;

/**
 * Durées appliquées par le **bot**, qui vit dans un autre dépôt : aucune
 * importation ne peut les tenir alignées, elles sont donc recopiées ici avec
 * leur source, pour le registre (T08) et les pages légales du bot
 * (`lib/shared/bot-legal-content.ts`). Changer l'une sans l'autre rend une page
 * fausse.
 *
 * - `BOT_RELAY_RETENTION_DAYS` : `MESSAGE_RETENTION_DAYS` de
 *   `blueGenjiBot/src/privacy/retentionPeriods.ts` — les traces d'une
 *   annonce relayée sont effacées au **relais suivant** cette échéance, et au
 *   plus tard par le ménage de la nuit ou du redémarrage
 *   (`blueGenjiBot/src/privacy/dataRetention.ts`).
 * - `BOT_ACTIVITY_AUTHOR_RETENTION_DAYS` : `ACTIVITY_AUTHOR_RETENTION_DAYS` de
 *   `blueGenjiBot/src/privacy/retentionPeriods.ts` — au-delà (dans la nuit
 *   qui suit), les lignes `/scrim` et `/recrute` sont repliées en nombres par
 *   jour, serveur et niveau ou rôle (`ActivityDaily`), puis supprimées.
 * - `BOT_FEED_EVENT_RETENTION_DAYS` : `FEED_EVENT_RETENTION_DAYS` — lignes du
 *   fil d'activité (`FeedEvent`), supprimées dans la nuit qui suit.
 * - `BOT_STAFF_LOG_RETENTION_DAYS` : `STAFF_LOG_RETENTION_DAYS` — messages du
 *   bot au salon de journal privé du staff et en message privé au titulaire,
 *   sauf ceux d'une exclusion en cours, supprimés à sa levée
 *   (`blueGenjiBot/src/privacy/staffLogRetention.ts`).
 * - La copie de la base écrite avant une restauration suit
 *   `ROLLBACK_RETENTION_DAYS`, égal à `BACKUP_RETENTION_DAYS` (T09).
 */
export const BOT_RELAY_RETENTION_DAYS = 7;
export const BOT_ACTIVITY_AUTHOR_RETENTION_DAYS = 30;
// Les deux dernières vivent dans `legal-durations.ts`, que la modale des
// changements peut importer sans tirer le registre.
export { BOT_FEED_EVENT_RETENTION_DAYS, BOT_STAFF_LOG_RETENTION_DAYS };

/**
 * Encadrement des transferts hors de l'Union européenne (RGPD art. 45 et 46),
 * **destinataire par destinataire** : la formule conditionnelle d'avant
 * (« adéquation pour un destinataire certifié, à défaut clauses contractuelles
 * types ») ne disait pour aucun d'eux sur quoi il reposait. Écrit une fois pour
 * le registre et pour `/rgpd`.
 */
export type TransferRecipient =
  | "DISCORD"
  | "GOOGLE"
  | "MICROSOFT"
  | "APPLE"
  | "MOZILLA"
  | "SPICEWORKS"
  | "BLIZZARD";

/** Décision d'adéquation qui couvre les entreprises certifiées EU-U.S. Data Privacy Framework. */
export const DPF_ADEQUACY_DECISION =
  "décision d'adéquation (UE) 2023/1795 de la Commission européenne du 10 juillet 2023 (EU-U.S. Data Privacy Framework)";

/** La même décision, pour les pages anglaises (politique de confidentialité du bot). */
export const DPF_ADEQUACY_DECISION_EN =
  "European Commission adequacy decision (EU) 2023/1795 of 10 July 2023 (EU-U.S. Data Privacy Framework)";

/** Clauses contractuelles types, pour un destinataire dont le transfert ne repose pas sur le DPF. */
export const STANDARD_CONTRACTUAL_CLAUSES =
  "clauses contractuelles types de la Commission européenne (art. 46 RGPD), intégrées à ses conditions d'utilisation";

export type TransferMechanism = "DPF" | "SCC";

export const TRANSFER_RECIPIENTS: Record<TransferRecipient, { name: string; mechanism: TransferMechanism }> = {
  DISCORD: { name: "Discord", mechanism: "DPF" },
  GOOGLE: { name: "Google", mechanism: "DPF" },
  MICROSOFT: { name: "Microsoft", mechanism: "DPF" },
  APPLE: { name: "Apple", mechanism: "DPF" },
  MOZILLA: { name: "Mozilla", mechanism: "DPF" },
  // Spiceworks appartient à Ziff Davis, Inc., inscrite à la liste du Data
  // Privacy Framework (dataprivacyframework.gov, vérifié par l'association).
  SPICEWORKS: { name: "Spiceworks (Ziff Davis, Inc.)", mechanism: "DPF" },
  BLIZZARD: { name: "Blizzard", mechanism: "SCC" },
};

/** Tous les destinataires hors UE, dans l'ordre où `/rgpd` les nomme. */
export const ALL_TRANSFER_RECIPIENTS: readonly TransferRecipient[] = [
  "DISCORD",
  "GOOGLE",
  "MICROSOFT",
  "APPLE",
  "MOZILLA",
  "SPICEWORKS",
  "BLIZZARD",
];

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} et ${names.at(-1)}`;
}

/**
 * Le mécanisme de chaque destinataire nommé, regroupé par mécanisme :
 * « Google et Discord, certifiés EU-U.S. Data Privacy Framework : décision
 * d'adéquation… ; Blizzard : clauses contractuelles types… ». Liste vide →
 * chaîne vide.
 */
export function transferBasis(recipients: readonly TransferRecipient[]): string {
  const unique = recipients.filter((r, i) => recipients.indexOf(r) === i);
  const named = (mechanism: TransferMechanism) =>
    unique.filter((r) => TRANSFER_RECIPIENTS[r].mechanism === mechanism).map((r) => TRANSFER_RECIPIENTS[r].name);
  const dpf = named("DPF");
  const scc = named("SCC");
  const parts: string[] = [];
  if (dpf.length > 0) {
    const certified = dpf.length > 1 ? "certifiés" : "certifié";
    parts.push(`${joinNames(dpf)}, ${certified} EU-U.S. Data Privacy Framework : ${DPF_ADEQUACY_DECISION}`);
  }
  if (scc.length > 0) parts.push(`${joinNames(scc)} : ${STANDARD_CONTRACTUAL_CLAUSES}`);
  return parts.join(" ; ");
}

/**
 * Cadre des sauvegardes hors du serveur, déposées depuis le 1er octobre 2026
 * sur Hetzner Storage Share (Nextcloud géré). Hetzner Online GmbH (Allemagne)
 * est **sous-traitant ultérieur** de l'association, par l'hébergeur qui a
 * souscrit le service et accepté son contrat de traitement des données
 * (version 1.2, le 1er octobre 2026 — le document signé n'est pas publié) ;
 * traitement exclusivement dans l'Union européenne ou l'Espace économique
 * européen (§ 3 de ce contrat), donc **aucun transfert hors de l'Union**. Le
 * chiffrement avant envoi, sur le serveur du site, est une mesure de sécurité
 * (art. 32) qui s'y ajoute : Hetzner stocke des copies qu'il ne peut pas lire.
 */
export const HETZNER_BACKUP_FRAMEWORK =
  "Hetzner Online GmbH (Allemagne), service Storage Share, sous-traitant ultérieur de l'association par l'hébergeur du site, qui a accepté son contrat de traitement des données (Data Processing Agreement, version 1.2) le 1er octobre 2026 ; traitement exclusivement dans l'Union européenne ou l'Espace économique européen";

/**
 * Portail de support (T15) : Spiceworks est **sous-traitant** de l'association,
 * dans le cadre de son accord de traitement des données (Data Processing
 * Agreement). Le transfert vers les États-Unis repose sur la certification
 * Data Privacy Framework de Ziff Davis, Inc. (`TRANSFER_RECIPIENTS.SPICEWORKS`),
 * avec à défaut les clauses contractuelles types que contient cet accord.
 */
export const SPICEWORKS_PROCESSOR_FRAMEWORK =
  "sous-traitant de l'association, dans le cadre de l'accord de traitement des données de Spiceworks (Data Processing Agreement)";

/** Repli du transfert de Spiceworks, si la certification de Ziff Davis venait à manquer. */
export const SPICEWORKS_SCC_FALLBACK =
  "en repli, clauses contractuelles types de la Commission européenne (art. 46 RGPD) contenues dans l'accord de traitement des données de Spiceworks";

/**
 * Messagerie de la personne à contacter pour les demandes relatives aux
 * données : un compte Outlook.com **personnel**, sans contrat de
 * sous-traitance, et **sans chiffrement** propre à l'association : Microsoft
 * peut lire ce qu'on y écrit.
 */
export const OUTLOOK_MAIL_FRAMEWORK =
  "compte Microsoft personnel (Outlook.com), régi par le Contrat de services Microsoft et la déclaration de confidentialité de Microsoft, sans contrat de sous-traitance ; lieu de stockage non garanti par Microsoft ; messages non chiffrés par l'association, lisibles par Microsoft";

/**
 * Messagerie de l'**association** elle-même (courriel publié, protégé, sur les
 * mentions légales et `/rgpd`) : une adresse Gmail. Google n'était nommé
 * nulle part comme destinataire de ce qu'on y écrit. La nature du compte
 * (personnel ou Google Workspace, donc avec ou sans contrat de
 * sous-traitance) n'est pas établie : on ne l'affirme pas.
 */
export const ASSOCIATION_GMAIL_FRAMEWORK =
  "messagerie Gmail de l'association, hébergée par Google ; messages non chiffrés par l'association, lisibles par Google";

/**
 * Contrat de sous-traitance (RGPD, art. 28) entre l'association et
 * l'hébergeur technique du site : rédigé dans le dépôt
 * (`docs/legal/contrat-sous-traitance-hebergement.md`), **pas encore signé**.
 * Le registre le cite tel qu'il est, jamais comme un contrat en vigueur.
 */
export const HOST_PROCESSING_AGREEMENT =
  "contrat de sous-traitance (RGPD, art. 28) rédigé, en attente de signature par l'association et l'hébergeur";

// Tickets Spiceworks (T15) et journaux nginx (T17) : définis dans un module de
// constantes seules, pour que la modale des changements les lise sans charger
// le registre.
export { SUPPORT_TICKET_RETENTION_MONTHS, WEB_ACCESS_LOG_RETENTION_DAYS };

export interface RegisterController {
  name: string;
  legalForm: string;
  seat: string;
  /** Moyens de joindre le responsable — aucune adresse en clair (`lib/shared/legal-contact.ts`). */
  contact: string;
  /**
   * Personne à contacter pour les demandes relatives aux données. Jamais un
   * « délégué à la protection des données » : la fonction de l'article 37
   * n'est pas la sienne, et la rubrique le dit.
   */
  dataContact: string;
  /** Hébergeur du site, sous-traitant : il héberge les données de tous les traitements. */
  host: string;
}

export interface ProcessingActivity {
  /** Référence stable (`T01`…) : c'est elle qu'on cite dans une réponse à la CNIL. */
  ref: string;
  name: string;
  /** Finalité principale. */
  purpose: string;
  /** Sous-finalités, dans l'ordre où elles se lisent. */
  subPurposes: string[];
  legalBasis: string;
  dataSubjects: string[];
  dataCategories: string[];
  /** Données sensibles (art. 9) : aucune sur ce site, mais la rubrique se remplit. */
  sensitiveData: string;
  retention: string[];
  recipients: string[];
  /** Transferts hors de l'Union européenne, ou « Aucun ». */
  transfers: string[];
  security: string[];
}

export function registerController(): RegisterController {
  return {
    name: ASSOCIATION_NAME,
    legalForm: "Association loi 1901",
    seat: ASSOCIATION_SEAT,
    contact: RGPD_CONTACT_LINE,
    dataContact: `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE}, chargé par l'association de recevoir les demandes relatives aux données (coordonnées données avec celles du responsable du traitement). Il n'est pas délégué à la protection des données au sens de l'article 37 du RGPD ; l'association reste responsable du traitement`,
    host: `${SITE_HOST.name} (${SITE_HOST.status.toLowerCase()}), ${SITE_HOST.address} — sous-traitant (${HOST_PROCESSING_AGREEMENT}), données hébergées en ${SITE_HOST.country} (site et bot Discord sur ${SITE_HOST.machine})`,
  };
}

/** Mesures de sécurité communes à toutes les fiches, dans les deux langues. */
const COMMON_SECURITY: readonly Localizable<string>[] = [
  frEn("Accès au serveur réservé au responsable technique (authentification par clé SSH, bannissement automatique des tentatives échouées)",
    "Server access restricted to the technical manager (SSH key authentication, automatic banning of failed attempts)"),
  frEn("Chiffrement des échanges (HTTPS)", "Encrypted communications (HTTPS)"),
  frEn("Droits d'administration par rôle, limités à ce que chaque mission exige",
    "Role-based administration rights, limited to what each task requires"),
];

/**
 * Ce que le registre couvre, dit une fois pour `/rgpd` et `/rgpd/registre`.
 *
 * Il se disait exhaustif (« tout ce que BlueGenji fait de données
 * personnelles ») alors qu'il ne décrit que le site et son bot. Les activités
 * attenantes décidées par l'association y ont désormais une fiche (support
 * Spiceworks T15, retransmission T16, journaux du serveur web T17) ; la
 * gestion des adhésions, elle, ne relève pas du site (décision de
 * l'association) : `REGISTER_SCOPE_DETAIL` le dit plutôt que de promettre une
 * fiche qui ne viendra pas.
 */
export const REGISTER_SCOPE =
  "Le registre décrit les traitements de données personnelles du site et du bot Discord de l'association";

export const REGISTER_SCOPE_DETAIL =
  "Il décrit aussi le portail de support (Spiceworks), la retransmission des matchs et les journaux techniques du serveur web. La gestion des adhésions à l'association ne relève pas du site : l'association la tient hors du site, et ce registre ne la décrit pas — pour toute question à son sujet, utilisez les moyens de contact de la politique de confidentialité.";

/* --- English versions (lot 7b-2, D1): the French text prevails ---------- */

/** `STANDARD_CONTRACTUAL_CLAUSES`. */
export const STANDARD_CONTRACTUAL_CLAUSES_EN =
  "standard contractual clauses of the European Commission (art. 46 GDPR), included in its terms of use";

function joinNamesEn(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

/** `transferBasis`, in English: same grouping by mechanism, same recipients. */
export function transferBasisEn(recipients: readonly TransferRecipient[]): string {
  const unique = recipients.filter((r, i) => recipients.indexOf(r) === i);
  const named = (mechanism: TransferMechanism) =>
    unique.filter((r) => TRANSFER_RECIPIENTS[r].mechanism === mechanism).map((r) => TRANSFER_RECIPIENTS[r].name);
  const dpf = named("DPF");
  const scc = named("SCC");
  const parts: string[] = [];
  if (dpf.length > 0) parts.push(`${joinNamesEn(dpf)}, certified under the EU-U.S. Data Privacy Framework: ${DPF_ADEQUACY_DECISION_EN}`);
  if (scc.length > 0) parts.push(`${joinNamesEn(scc)}: ${STANDARD_CONTRACTUAL_CLAUSES_EN}`);
  return parts.join("; ");
}

/** `HETZNER_BACKUP_FRAMEWORK`. */
export const HETZNER_BACKUP_FRAMEWORK_EN =
  "Hetzner Online GmbH (Germany), Storage Share service, sub-processor of the association through the site's host, who accepted its data processing agreement (Data Processing Agreement, version 1.2) on October 1, 2026; processing exclusively in the European Union or the European Economic Area";

/** `SPICEWORKS_PROCESSOR_FRAMEWORK`. */
export const SPICEWORKS_PROCESSOR_FRAMEWORK_EN =
  "a processor of the association, under Spiceworks' data processing agreement (Data Processing Agreement)";

/** `SPICEWORKS_SCC_FALLBACK`. */
export const SPICEWORKS_SCC_FALLBACK_EN =
  "as a fallback, standard contractual clauses of the European Commission (art. 46 GDPR) contained in Spiceworks' data processing agreement";

/** `OUTLOOK_MAIL_FRAMEWORK`. */
export const OUTLOOK_MAIL_FRAMEWORK_EN =
  "personal Microsoft account (Outlook.com), governed by the Microsoft Services Agreement and the Microsoft privacy statement, without a processing agreement; storage location not guaranteed by Microsoft; messages not encrypted by the association, readable by Microsoft";

/** `ASSOCIATION_GMAIL_FRAMEWORK`. */
export const ASSOCIATION_GMAIL_FRAMEWORK_EN =
  "the association's Gmail mailbox, hosted by Google; messages not encrypted by the association, readable by Google";

/** `HOST_PROCESSING_AGREEMENT`. */
export const HOST_PROCESSING_AGREEMENT_EN =
  "processing agreement (GDPR, art. 28) drafted, awaiting signature by the association and the host";

/** `RGPD_CONTACT_LINE` (`legal-contact.ts`). */
export const RGPD_CONTACT_LINE_EN = `Requests regarding data: ${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, appointed by the association to receive them — email and phone (privacy policy and legal notice of the site) —, or the site's “${REPORT_FORM_NAME_EN}” form (footer), “GDPR” category; the association: email and phone (legal notice of the site)`;

/** `registerController()`, in English. */
export function registerControllerEn(): RegisterController {
  return {
    name: ASSOCIATION_NAME,
    legalForm: "French nonprofit (law of 1901)",
    seat: ASSOCIATION_SEAT,
    contact: RGPD_CONTACT_LINE_EN,
    dataContact: `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, appointed by the association to receive requests regarding data (contact details given with those of the data controller). He is not a data protection officer within the meaning of Article 37 of the GDPR; the association remains the data controller`,
    host: `${SITE_HOST.name} (${SITE_HOST.statusEn.toLowerCase()}), ${SITE_HOST.address} — processor (${HOST_PROCESSING_AGREEMENT_EN}), data hosted in ${SITE_HOST.country} (site and Discord bot on ${SITE_HOST.machineEn})`,
  };
}

/** `REGISTER_SCOPE`. */
export const REGISTER_SCOPE_EN =
  "The register describes the processing of personal data by the association's site and Discord bot";

/** `REGISTER_SCOPE_DETAIL`. */
export const REGISTER_SCOPE_DETAIL_EN =
  "It also describes the support portal (Spiceworks), match streaming and the web server's technical logs. Managing memberships of the association is not part of the site: the association keeps it outside the site, and this register does not describe it — for any question about it, use the contact details of the privacy policy.";

/** Une fiche à écrire : tout sauf sa référence, qui est sa clé. */
type ActivityText = { [K in Exclude<keyof ProcessingActivity, "ref">]: Localizable<ProcessingActivity[K]> };

/**
 * Les fiches, rangées par référence (`T01`…) dans l'ordre du registre : la clé
 * devient `ref`, en tête de la fiche. Une seule écriture pour les deux
 * langues — chaque texte est un `frEn(français, anglais)`, le français faisant foi
 * (`lib/shared/bilingual.ts`, `docs/features/LEGAL_DATA_FILES.md`).
 */
function registerActivities(activities: Record<string, ActivityText>): Localizable<ProcessingActivity>[] {
  return Object.entries(activities).map(([ref, activity]) => ({ ref, ...activity }));
}

const ACTIVITIES = registerActivities({
  T01: {
    name: frEn("Comptes joueurs et profils", "Player accounts and profiles"),
    purpose: frEn("Permettre aux joueurs de disposer d'un compte sur la plateforme de tournois",
      "Allowing players to have an account on the tournament platform"),
    subPurposes: [
      frEn("Afficher un profil public (pseudo, avatar, pseudos de jeu selon les réglages de visibilité)",
        "Displaying a public profile (username, avatar, in-game usernames according to visibility settings)"),
      frEn("Mettre les joueurs en relation (s'ajouter en jeu, recrutement d'équipe)",
        "Putting players in touch (adding each other in game, team recruitment)"),
      frEn("Exporter ses données et supprimer son compte depuis « Mon profil » (la suppression aussi depuis la fenêtre d'acceptation des conditions d'utilisation, sans les accepter)",
        "Exporting one's data and deleting one's account from “My profile” (deletion also from the terms of use acceptance window, without accepting them)"),
      frEn(`Laisser ${ACCOUNT_REACTIVATION_DAYS} jours pour revenir sur une suppression demandée : le compte, masqué et sans session, se réactive par une nouvelle connexion suivie d'une confirmation explicite ; dès la demande, il quitte ses équipes (propriété transmise, équipe fantôme ou dissoute), ses tournois organisés passent à un autre membre du staff quand quelqu'un peut les reprendre, ses inscriptions à un tournoi individuel pas encore commencé sont retirées, ses casts de matchs pas encore terminés, ses désignations d'arbitre et ses invitations et demandes d'adhésion d'équipe en attente sont retirés et ses matchs restants d'un tournoi individuel en cours où il n'a jamais joué sont perdus par forfait, sans retour à la réactivation`,
        `Leaving ${ACCOUNT_REACTIVATION_DAYS} days to go back on a requested deletion: the account, hidden and without a session, is reactivated by signing in again followed by an explicit confirmation; as soon as it is requested, it leaves its teams (ownership handed over, ghost or disbanded team), its organised tournaments go to another staff member when someone can take them over, its registrations for a solo tournament that has not started yet are withdrawn, its casts of matches not yet completed, its referee assignments and its pending team invitations and join requests are withdrawn and its remaining matches in a running solo tournament where it never played are lost by forfeit, which reactivation does not undo`),
      frEn("Rédiger les notifications push et les messages privés Discord du site dans la langue du compte (en français puis en anglais quand elle ne peut pas être lue et pour les alertes adressées au staff en message privé — arbitres, direction —, en français seul si les deux ne tiennent pas dans un message) : celle de la page du site d'où part la dernière connexion (une connexion lancée d'ailleurs, ou par le bouton Google, Discord ou Blizzard depuis un navigateur qui ne l'indique pas (trop ancien, ou qui retire cette indication), ne la change pas ; français par défaut), ou celle choisie dans « Mon profil »",
        "Writing push notifications and the site's Discord direct messages in the account's language (French then English when it cannot be read and for alerts sent to staff by direct message — referees, leadership —, French alone when both do not fit in one message): the language of the site page the last login started from (a login started elsewhere, or a login through the Google, Discord or Blizzard button from a browser that does not tell (too old, or one that strips this information), does not change it; French by default), or the one chosen in “My profile”"),
      frEn("Garder sur le compte le choix « Ne plus afficher » de la fenêtre des annonces de recrutement urgentes, pour qu'elle ne s'ouvre plus d'elle-même sur les autres appareils du joueur — choix réversible dans « Mon profil »",
        "Keeping on the account the “Don't show again” choice of the window of urgent recruitment announcements, so that it no longer opens on its own on the player's other devices — a choice that can be undone in “My profile”"),
      frEn("Proposer, une fois par connexion par Discord ou Blizzard, la certification du tag Discord à un compte qui ne l'a pas (fenêtre qui ne certifie rien d'elle-même), et garder sur le compte le choix « Ne plus voir » de cette fenêtre",
        "Suggesting, once per login with Discord or Blizzard, the verification of the Discord tag to an account that does not have it (a window that verifies nothing on its own), and keeping on the account the “Don't show again” choice of that window"),
      frEn("Refuser la remise en ligne, comme avatar ou comme logo d'équipe, d'un avatar supprimé par la modération, par son empreinte (SHA-256) gardée dès cette suppression dans une liste d'images bloquées qui ne désigne aucun compte, et lever ce blocage quand la contestation d'une suppression décidée sur un signalement ou après un masquage est acceptée, tant que le compte n'est pas effacé",
        "Refusing the re-upload, as an avatar or as a team logo, of an avatar deleted by moderation, through its hash (SHA-256) kept from that deletion in a list of blocked images that designates no account, and lifting that block when the challenge to a deletion decided on a report or after a hiding is accepted, as long as the account is not erased"),
    ],
    legalBasis: frEn("Exécution du service demandé par le joueur (contrat) pour le compte ; consentement pour les données facultatives que le joueur renseigne et choisit de rendre visibles ; exécution du service (contrat — conditions d'utilisation, « Contacts de match ») pour la lecture du BattleTag, même masqué, présenté dans les seuls tournois Overwatch, pour un joueur présenté comme contact d'un match, dans sa fenêtre « Contacts », dans sa fenêtre de lancement et, aux seules parties du match (ses deux équipes, ses casters, son arbitre désigné), sur la page du match seulement ; pour un caster et pour l'arbitre désigné, aussi sur la page du match (registre T04) ; pour celui de l'arbitre désigné, dans ces fenêtres comme sur la page du match, intérêt légitime, avec droit d'opposition, tant qu'il n'a pas accepté la version 7 des conditions ou une version suivante (registre T04) — masqué, il n'est lisible nulle part ailleurs, arbitres et administrateurs compris ; intérêt légitime (savoir qui a prouvé son identité de jeu) pour les pastilles de certification de la fiche (tag Discord certifié, BattleTag tiré d'un compte Battle.net rattaché), lues par tout joueur connecté même tag masqué, sans le tag — droit d'opposition par le formulaire de signalement (catégorie RGPD) ; intérêt légitime (modération : refuser la remise en ligne d'une image déjà retirée) pour l'empreinte d'un avatar supprimé par la modération",
      "Performance of the service requested by the player (contract) for the account; consent for the optional data the player fills in and chooses to make visible; performance of the service (contract — terms of use, “Match contacts”) for the BattleTag being read, even when hidden, presented in Overwatch tournaments only, for a player presented as a contact of a match, only in its “Contacts” window, its launch window and, for the parties to the match alone (its two teams, its casters, its assigned referee), on the match page; for a caster and for the assigned referee, also on the match page (record T04); for the assigned referee's, in these windows as on the match page, legitimate interest, with a right to object, until they have accepted version 7 of the terms or a later version (record T04) — when hidden, it is readable nowhere else, referees and administrators included; legitimate interest (knowing who has proven their game identity) for the certification badges on the player page (certified Discord tag, BattleTag taken from a linked Battle.net account), read by any logged-in player even when the tag is hidden, without the tag — right to object through the report form (GDPR category); legitimate interest (moderation: refusing the re-upload of an image already removed) for the hash of an avatar deleted by moderation"),
    dataSubjects: [
      frEn("Joueurs inscrits sur le site", "Players registered on the site"),
    ],
    dataCategories: [
      frEn("Pseudo du site (depuis le 30 septembre 2026, jamais tiré du nom du compte Google : pseudo neutre à la création ; un compte Google antérieur a pu recevoir ce nom), avatar (copié sur nos serveurs ; depuis la même date, masqué par défaut quand il vient du fournisseur de connexion)",
        "Site username (since September 30, 2026, never taken from the name of the Google account: neutral username at creation; an earlier Google account may have received that name), avatar (copied to our servers; since the same date, hidden by default when it comes from the login provider)"),
      frEn("Pseudos Overwatch (BattleTag), Marvel Rivals et Discord ; certification du pseudo Discord ; indication d'un BattleTag tiré d'un compte Battle.net rattaché (pastille de la fiche, montrée même BattleTag masqué)",
        "Overwatch (BattleTag), Marvel Rivals and Discord usernames; certification of the Discord username; whether the BattleTag comes from a linked Battle.net account (player page badge, shown even when the BattleTag is hidden)"),
      frEn("Majorité déclarée (oui / non / non renseignée)",
        "Declared adulthood (yes / no / not specified)"),
      frEn("Réglages de visibilité, disponibilité pour le recrutement, rôles sur la plateforme",
        "Visibility settings, availability for recruitment, roles on the platform"),
      frEn("Langue du compte (français ou anglais), remise au français à l'anonymisation ; transmise au bot Discord de l'association (T08) avec le seul code envoyé par message privé Discord (connexion, certification ou changement du tag) — celle du compte déjà rattaché à ce compte Discord, en français puis en anglais s'il n'y en a pas —, que le bot rédige dans cette langue sans la garder",
        "Account language (French or English), reset to French on anonymization; sent to the association's Discord bot (T08) only with the code sent by Discord direct message (login, certification or change of the tag) — the language of the account already linked to that Discord account, French then English when there is none —, which the bot writes in that language without keeping it"),
      frEn("Choix « Ne plus afficher » de la fenêtre des annonces de recrutement urgentes, fait dans cette fenêtre ou en décochant la case de « Mon profil » (jamais choisi / oui / réaffichée depuis « Mon profil » ; un choix fait sur le navigateur avant la connexion, ou pas enregistré sur-le-champ, est reporté sur un compte qui n'a jamais choisi, à la connexion ou à la visite connectée suivante ; réafficher depuis « Mon profil » efface aussi le cookie bg_recr_off de ce navigateur), remis à « jamais choisi » à l'anonymisation",
        "“Don't show again” choice on the window of urgent recruitment announcements, made in that window or by unticking the “My profile” box (never chosen / yes / turned back on from “My profile”; a choice made on the browser before logging in, or not saved right away, is carried over to an account that has never chosen, at login or on the next logged-in visit; turning it back on from “My profile” also deletes the bg_recr_off cookie of that browser), reset to “never chosen” on anonymization"),
      frEn("Choix « Ne plus voir » de la fenêtre qui propose la certification du tag Discord (date du choix), effacé à l'anonymisation ; sur la session de connexion, marque « fenêtre encore à proposer » (posée à chaque connexion par Discord ou Blizzard d'un compte dont le tag Discord n'est pas certifié et qui n'a pas choisi « Ne plus voir », levée à la première réponse — sur toutes les sessions du compte, celles d'un autre appareil comprises, pour « Ne plus voir » — ou à la première lecture quand il n'y a plus rien à proposer), effacée avec la session",
        "“Don't show again” choice on the window suggesting the verification of the Discord tag (date of the choice), erased on anonymization; on the login session, a “window still to be suggested” mark (set at each login with Discord or Blizzard of an account whose Discord tag is not verified and that has not chosen “Don't show again”, cleared at the first answer — on all the account's sessions, including those of another device, for “Don't show again” — or at the first read when there is nothing left to suggest), erased with the session"),
      frEn("Aucun nom réel, aucune adresse e-mail, aucun numéro de téléphone, aucune adresse postale",
        "No real name, no email address, no phone number, no postal address"),
      frEn("Suppression demandée : date de la demande ; vrai pseudo et chemin de l'avatar mis de côté pour la réactivation ; ticket de réactivation (compte, moyen de connexion, échéance, empreinte du jeton)",
        "Requested deletion: date of the request; real username and avatar path set aside for reactivation; reactivation ticket (account, login method, expiry, hash of the token)"),
      frEn("Empreintes (SHA-256) des avatars supprimés par la modération : dans la liste des images bloquées, sans lien avec aucun compte, datée au jour près ; sur la décision de modération (registre T11), liée au compte tant qu'il existe, avec l'issue de sa contestation (maintenue ou acceptée) et le fait qu'elle a bloqué l'image",
        "Hashes (SHA-256) of avatars deleted by moderation: in the list of blocked images, with no link to any account, dated to the day; on the moderation decision (record T11), linked to the account as long as it exists, with the outcome of its challenge (upheld or accepted) and whether it blocked the image"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Durée du compte", "Lifetime of the account"),
      frEn(`Au terme de la fenêtre de réactivation (ci-dessous) : effacement complet si le compte n'a laissé aucune trace (aucun match joué, aucun engagement dans un tournoi individuel commencé, aucun tournoi organisé que personne au staff n'a pu reprendre) — ses inscriptions à des tournois individuels pas encore commencés, sans match, ont été retirées dès la demande ; anonymisation sinon — le pseudo est remplacé par un pseudo d'emprunt, et seul le compte anonymisé reste, avec son historique de tournois et d'équipes, et sa fiche de joueur seulement s'il a joué au moins un match ; dans les deux cas, le journal des données de connexion (T14) est gardé jusqu'à son échéance légale ; les informations fournies à la création du compte (pseudo, identifiants de fournisseur) ne sont pas gardées après la suppression, hors les copies de sauvegarde chiffrées (T09, ${BACKUP_RETENTION_DAYS} jours au plus) et la mention de la suppression au journal qui la rejoue après une restauration (identifiant et date de création du compte, ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours) ; les signalements envoyés par le compte en sont détachés et suivent leur propre durée (T11), et les gestes d'arbitrage d'un membre du staff restent nommés dans les journaux du serveur, selon leur rotation (T05) ; les annonces #live d'un tournoi individuel gardent le pseudo dans le salon Discord jusqu'à leur suppression sur demande, et l'alerte AutoMod d'une telle annonce bloquée ou signalée le garde dans le salon d'alertes des modérateurs jusqu'à sa suppression par eux ou sur demande (T16)`,
        `At the end of the reactivation window (below): complete erasure if the account has left no trace (no match played, no entry in a solo tournament that has started, no organized tournament that no one on the staff could take over) — its registrations for solo tournaments that have not started yet, with no match, were withdrawn as soon as deletion was requested; anonymization otherwise — the username is replaced by a borrowed username, and only the anonymized account remains, with its tournament and team history, and its player page only if it played at least one match; in both cases, the connection data log (T14) is kept until its legal deadline; the information provided when the account was created (username, provider identifiers) is not kept after deletion, apart from the encrypted backup copies (T09, ${BACKUP_RETENTION_DAYS} days at most) and the record of the deletion in the log that replays it after a restoration (account identifier and creation date, ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days); the reports sent by the account are detached from it and follow their own period (T11), and a staff member's refereeing actions remain named in the server logs, according to their rotation (T05); the #live announcements of a solo tournament keep the username in the Discord channel until they are deleted on request, and the AutoMod alert for such an announcement when blocked or flagged keeps it in the moderators' alert channel until they delete it or on request (T16)`),
      frEn(`Sessions de connexion : ${SESSION_RETENTION_DAYS} jours après la connexion`,
        `Login sessions: ${SESSION_RETENTION_DAYS} days after login`),
      frEn(`Suppression demandée : le compte reste en base, masqué et montré anonyme partout dès la demande (pseudo d'emprunt, sans avatar), ${ACCOUNT_REACTIVATION_DAYS} jours (fenêtre de réactivation, ouverte aussi à un compte suspendu, qui revient suspendu), puis il est effacé ou anonymisé comme ci-dessus ; son vrai pseudo (réservé ; rendu, raccourci au besoin, suivi de « OG » s'il a tout de même été pris — « OG2 », « OG3 »… jusqu'à « OG10 » si ceux-là le sont aussi, à défaut le pseudo d'emprunt) et le chemin de son avatar sont gardés à part pour la seule réactivation (la modération peut encore masquer, rétablir ou supprimer cet avatar, comme celui d'un compte actif ; masqué, il suit la règle des signalements et n'est pas rendu à la réactivation), et effacés à la réactivation ou au terme du délai ; la demande est notée au journal de rejeu des suppressions (identifiant et date de création du compte, date de la demande), où la réactivation la remplace par une ligne portant sa date et celle de la demande défaite, gardée ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours comme les autres (pour qu'une sauvegarde restaurée ne ramène pas le compte en attente de suppression) ; un ticket de réactivation (empreinte d'un jeton aléatoire) vit ${REACTIVATION_TICKET_MINUTES} minutes`,
        `Requested deletion: the account stays in the database, hidden and shown as anonymous everywhere from the request (borrowed username, no avatar), for ${ACCOUNT_REACTIVATION_DAYS} days (reactivation window, open to a suspended account too, which comes back suspended), then it is erased or anonymized as above; its real username (reserved; given back, shortened if needed, followed by “OG” if it was taken all the same — “OG2”, “OG3”… up to “OG10” if those are taken too, failing that the borrowed username) and the path of its avatar are kept apart for reactivation only (moderation can still hide, restore or delete that avatar, like that of an active account; once hidden, it follows the reports rule and is not given back on reactivation), and erased on reactivation or at the end of that time; the request is recorded in the deletion replay log (account identifier and creation date, date of the request), where reactivation replaces it with a line carrying its date and that of the undone request, kept ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days like the others (so that a restored backup does not bring the account back as pending deletion); a reactivation ticket (hash of a random token) lives ${REACTIVATION_TICKET_MINUTES} minutes`),
      frEn("Empreinte (SHA-256) d'un avatar supprimé par la modération — sans délai (sur signalement ou depuis la fiche du joueur), par le staff qui le supprime définitivement après un masquage (contestation rejetée, ou avant l'échéance), ou d'office au terme d'un masquage sans contestation —, que le compte soit actif ou en attente de suppression : gardée dès cette suppression, sans limite de durée, dans la liste des images bloquées, qui ne désigne aucun compte et ne date un blocage qu'au jour près, pour refuser la remise en ligne de la même image (supprimé sans délai, son fichier n'est effacé que si rien d'autre sur le site ne le désigne) ; tant que le compte existe (anonymisé compris), elle est aussi gardée sur la décision de modération qui la consigne (suppression sur signalement ou après un masquage), avec l'issue de sa contestation — maintenue, le blocage reste ; acceptée après une suppression décidée sur un signalement ou après un masquage, il est levé, sauf si une autre suppression de la même image le justifie encore —, puis effacée avec ces décisions à l'effacement du compte, le blocage devenant définitif ; une suppression d'office faite alors que sa contestation attendait encore son issue ne bloque l'image qu'une fois maintenue, ou à l'effacement du compte s'il vient avant, alors définitivement ; les empreintes posées à l'effacement d'un compte avant le 12 novembre 2026 — alors aussi celles d'un avatar seulement masqué — restent bloquées, datées du jour de leur pose, qui peut être celui de l'effacement (toute empreinte posée avant cette date est ramenée au jour près) ; un avatar seulement masqué n'en laisse aucune tant qu'il n'est pas supprimé, un avatar que la modération n'a jamais supprimé n'en laisse aucune (ni à la demande de suppression, ni à l'anonymisation ou à l'effacement), et l'effacement d'un compte ne garde que celle d'un avatar que la modération avait déjà supprimé",
        "Hash (SHA-256) of an avatar deleted by moderation — immediately (on a report or from the player's page), by the staff permanently deleting it after a hiding (challenge rejected, or before the deadline), or automatically at the end of a hiding without a challenge —, whether the account is active or pending deletion: kept from that deletion, without time limit, in the list of blocked images, which designates no account and only dates a block to the day, to refuse the same image being uploaded again (when deleted immediately, its file is only erased if nothing else on the site points to it); as long as the account exists (anonymized included), it is also kept on the moderation decision that records it (deletion on a report or after a hiding), with the outcome of its challenge — upheld, the block stays; accepted after a deletion decided on a report or after a hiding, it is lifted, unless another deletion of the same image still justifies it —, then erased with those decisions when the account is erased, the block becoming permanent; an automatic deletion made while its challenge was still awaiting its outcome only blocks the image once upheld, or on the erasure of the account if that comes first, then permanently; hashes set on the erasure of an account before November 12, 2026 — then also those of an avatar that was only hidden — stay blocked, dated to the day they were set, which may be that of the erasure (any hash set before that date is brought back to the day); an avatar that is only hidden leaves none as long as it is not deleted, an avatar moderation never deleted leaves none (neither on the deletion request, nor on anonymization or erasure), and the erasure of an account only keeps that of an avatar moderation had already deleted"),
    ],
    recipients: [
      frEn("Public du site (seules les données que le joueur rend visibles)",
        "The site's public (only the data the player makes visible)"),
      frEn("Parties d'un même match : dans sa fenêtre « Contacts » et dans sa fenêtre de lancement, pour le BattleTag de tout contact présenté (joueur, caster, arbitre désigné) ; sur la page du match aussi, pour le BattleTag de l'arbitre désigné et des casters et, aux seules parties du match (jamais à un arbitre sans rôle sur ce match), celui des contacts des deux équipes — (BattleTag même masqué, pour s'ajouter en jeu, dans les seuls tournois Overwatch ; durées du traitement T04)",
        "Parties to the same match: in its “Contacts” window and its launch window, for the BattleTag of any contact presented (player, caster, assigned referee); on the match page as well, for the BattleTag of the assigned referee and the casters and, for the parties to the match alone (never a referee with no role in that match), that of both teams' contacts — (BattleTag even when hidden, to add each other in game, in Overwatch tournaments only; durations of record T04)"),
      frEn("Joueurs connectés du site : pseudo Discord certifié, si le joueur le rend visible ; pastilles de certification de la fiche (tag Discord certifié, « BattleTag vérifié » — BattleTag tiré d'un compte Battle.net rattaché), même tag masqué, sans le tag",
        "Logged-in players of the site: certified Discord username, if the player makes it visible; certification badges on the player page (certified Discord tag, “Verified BattleTag” — BattleTag taken from a linked Battle.net account), even when the tag is hidden, without the tag"),
      frEn("Staff de l'association selon son rôle (administration, arbitrage)",
        "The association's staff according to their role (administration, refereeing)"),
      frEn("Bot Discord de l'association (T08) : la langue du compte, avec le seul code envoyé en message privé",
        "The association's Discord bot (T08): the account language, with the code sent by direct message only"),
    ],
    transfers: [
      frEn("Aucun", "None"),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Jetons de session stockés sous forme d'empreinte (SHA-256), cookie httpOnly",
        "Session tokens stored as a hash (SHA-256), httpOnly cookie"),
      frEn("Pas de mot de passe : connexion déléguée à Google, Discord ou Blizzard, ou code à usage unique",
        "No password: login delegated to Google, Discord or Blizzard, or one-time code"),
    ],
  },
  T02: {
    name: frEn("Authentification", "Authentication"),
    purpose: frEn("Connecter un joueur à son compte sans mot de passe",
      "Logging a player into their account without a password"),
    subPurposes: [
      frEn("Connexion par Google, Discord ou Blizzard (OAuth)",
        "Login through Google, Discord or Blizzard (OAuth)"),
      frEn("Connexion par code à six chiffres envoyé en message privé Discord par le bot",
        "Login with a six-digit code sent by the bot by Discord direct message"),
      frEn("Rattachement de plusieurs moyens de connexion à un même compte",
        "Linking several means of logging in to the same account"),
    ],
    legalBasis: frEn("Exécution du service demandé par le joueur (contrat)",
      "Performance of the service requested by the player (contract)"),
    dataSubjects: [
      frEn("Joueurs inscrits sur le site", "Players registered on the site"),
    ],
    dataCategories: [
      frEn("Identifiants techniques opaques Google, Discord et Blizzard",
        "Opaque Google, Discord and Blizzard technical identifiers"),
      frEn("Identifiant Discord et pseudo Discord (connexion par code ou par bouton), enregistré sans être certifié — la certification, qui l'expose, est un geste distinct (T04)",
        "Discord identifier and Discord username (login by code or by button), recorded without being certified — certification, which exposes it, is a separate action (T04)"),
      frEn("Porte de rattachement du compte Discord (bouton OAuth ou code en message privé)",
        "Way the Discord account was linked (OAuth button or code by direct message)"),
      frEn("Code de connexion (conservé uniquement sous forme d'empreinte), nombre d'essais",
        "Login code (kept only as a hash), number of attempts"),
      frEn("Langue du compte déjà rattaché à ce compte Discord (T01), lue pour que le bot rédige le code dans cette langue",
        "Language of the account already linked to that Discord account (T01), read so that the bot writes the code in that language"),
      frEn("Adresse IP, en mémoire pour limiter les essais ; celle d'une connexion réussie est écrite au journal des données de connexion (T14), pour la seule obligation légale de l'hébergeur",
        "IP address, in memory to limit attempts; that of a successful login is written to the connection data log (T14), for the host's legal obligation only"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Identifiants de connexion : durée du compte, ou jusqu'au détachement du fournisseur ; effacés à la suppression du compte (seul le journal des données de connexion, T14, lui survit, hors les copies de sauvegarde chiffrées, T09, ${BACKUP_RETENTION_DAYS} jours au plus)`,
        `Login identifiers: lifetime of the account, or until the provider is unlinked; erased when the account is deleted (only the connection data log, T14, outlives it, apart from the encrypted backup copies, T09, ${BACKUP_RETENTION_DAYS} days at most)`),
      frEn(`Codes de connexion : valables ${DISCORD_CODE_VALIDITY_MINUTES} minutes, purgés un jour après expiration, effacés à la suppression du compte`,
        `Login codes: valid ${DISCORD_CODE_VALIDITY_MINUTES} minutes, purged one day after expiry, erased when the account is deleted`),
    ],
    recipients: [
      frEn("Google, Discord et Blizzard, qui authentifient le joueur (responsables de leur propre traitement)",
        "Google, Discord and Blizzard, which authenticate the player (controllers of their own processing)"),
      frEn("Discord, qui achemine le message privé contenant le code",
        "Discord, which delivers the direct message containing the code"),
    ],
    transfers: [
      frEn(`Possibles vers les États-Unis, selon le fournisseur que le joueur choisit pour se connecter — ${transferBasis(["GOOGLE", "DISCORD", "BLIZZARD"])}`,
        `Possible to the United States, depending on the provider the player chooses to log in with — ${transferBasisEn(["GOOGLE", "DISCORD", "BLIZZARD"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Jeton anti-CSRF et état scellé à l'aller pour chaque connexion OAuth",
        "Anti-CSRF token and state sealed on the way out for each OAuth login"),
      frEn("Cinq essais par code, cinq codes par quart d'heure et par compte, plafonds de débit par adresse IP",
        "Five attempts per code, five codes per quarter of an hour and per account, rate limits per IP address"),
      frEn("Seules les autorisations minimales sont demandées aux fournisseurs (ni adresse e-mail, ni liste de serveurs)",
        "Only the minimum permissions are requested from providers (neither email address nor server list)"),
    ],
  },
  T03: {
    name: frEn("Tournois, équipes et palmarès", "Tournaments, teams and achievements"),
    purpose: frEn("Organiser des tournois amateurs et en conserver les résultats",
      "Organizing amateur tournaments and keeping their results"),
    subPurposes: [
      frEn("Constituer des équipes (membres, rôles, invitations)",
        "Forming teams (members, roles, invitations)"),
      frEn("Prévenir en message privé Discord le propriétaire et les managers d'une équipe d'une demande d'adhésion (sans nommer le demandeur, au plus un message par joueur et par équipe toutes les 24 h)",
        "Notifying the owner and managers of a team of a request to join by Discord direct message (without naming the requester, at most one message per player and per team every 24 h)"),
      frEn(`Prévenir un joueur en message privé Discord de l'invitation d'une équipe (au plus un message par équipe et par joueur toutes les ${TEAM_INVITE_NOTICE_COOLDOWN_HOURS} h, ${TEAM_INVITE_NOTICES_DAILY_CAP} joueurs par équipe ou par auteur et ${TEAM_INVITE_NOTICES_PER_PLAYER_CAP} équipes par joueur dans ce délai), de la reprise d'une équipe fantôme que le staff lui propose (une fois par équipe et par joueur dans ce délai), et de la propriété de son équipe qui lui est transférée (sans nommer qui invite, propose ou transfère : le nom de l'équipe seul)`,
        `Notifying a player by Discord direct message of a team's invitation (at most one message per team and per player every ${TEAM_INVITE_NOTICE_COOLDOWN_HOURS} h, ${TEAM_INVITE_NOTICES_DAILY_CAP} players per team or per author and ${TEAM_INVITE_NOTICES_PER_PLAYER_CAP} teams per player within that time), of the takeover of a ghost team the staff offers them (once per team and per player within that time), and of the ownership of their team being transferred to them (without naming who invites, offers or transfers: the team's name only)`),
      frEn("Inscrire des équipes ou des joueurs, générer les plateaux, saisir et arbitrer les scores",
        "Registering teams or players, generating brackets, entering and refereeing scores"),
      frEn("Publier résultats, classements, statistiques et palmarès",
        "Publishing results, rankings, statistics and achievements"),
      frEn("Laisser suivre sans compte la fiche d'un tournoi publié (/suivre/tournois/…) : plateau, scores, classements, noms et logos des équipes et pseudos des engagés (et, en tournoi individuel, leur avatar s'il n'est pas masqué et leur numéro de compte interne, pour la marque du podium), pénalités d'une BlueGenji Survie sans motif ni arbitre, sans les codes de replay ; page exclue des moteurs de recherche",
        "Letting visitors without an account follow the page of a published tournament (/suivre/tournois/…): bracket, scores, rankings, team names and logos and usernames of the participants (and, in a solo tournament, their avatar unless hidden and their internal account number, for the podium mark), BlueGenji Survival penalties without reason or referee, without replay codes; page excluded from search engines"),
    ],
    legalBasis: frEn("Intérêt légitime (organisation des compétitions, mémoire sportive de la scène)",
      "Legitimate interest (organizing competitions, sporting memory of the scene)"),
    dataSubjects: [
      frEn("Joueurs inscrits", "Registered players"),
      frEn("Membres d'équipe", "Team members"),
      frEn("Staff d'arbitrage", "Refereeing staff"),
      frEn("Visiteurs sans compte de la fiche publique d'un tournoi",
        "Visitors without an account of a tournament's public page"),
    ],
    dataCategories: [
      frEn("Appartenance à une équipe et rôles d'équipe", "Team membership and team roles"),
      frEn("Adresse IP d'un visiteur sans compte, en mémoire seulement, pour plafonner ses lectures de la fiche publique",
        "IP address of a visitor without an account, in memory only, to cap their reads of the public page"),
      frEn("Inscriptions, scores, forfaits, pénalités (avec motif et arbitre auteur), classements",
        "Registrations, scores, forfeits, penalties (with reason and referee who imposed it), rankings"),
      frEn("Détail map par map d'un match : score et code de replay de chaque map (facultatif quand l'arbitrage saisit la map, replay perdu ; le replay montre en jeu les identifiants des joueurs, BattleTag masqué compris), compte qui l'a saisi",
        "Map-by-map detail of a match: score and replay code of each map (optional when the referees enter the map, replay lost; the replay shows the players' identifiers in game, hidden BattleTag included), account that entered it"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Résultats et palmarès : aucune durée de conservation définie, conservés tant que le site existe ; anonymisés à la suppression du compte (pseudo d'emprunt)",
        "Results and achievements: no defined retention period, kept as long as the site exists; anonymized when the account is deleted (borrowed username)"),
      frEn("Inscriptions à un tournoi individuel pas encore commencé, sans match : retirées du tournoi dès la demande de suppression du compte (T01)",
        "Registrations for a solo tournament that has not started yet, with no match: withdrawn from the tournament as soon as deletion of the account is requested (T01)"),
      frEn("Codes de replay : gardés avec le résultat qu'ils documentent (un détail qui ne l'explique plus est effacé) ; le lien vers le compte qui les a saisis est effacé à la suppression du compte, les codes restent (la partie est conservée par l'éditeur du jeu)",
        "Replay codes: kept with the result they document (a detail that no longer explains it is erased); the link to the account that entered them is erased when the account is deleted, the codes remain (the game is kept by the game's publisher)"),
      frEn("Droit d'opposition ouvert sur demande", "Right to object available on request"),
      frEn("Adresse IP d'un visiteur sans compte : en mémoire, le temps de la fenêtre du plafond de lecture (une minute), jamais conservée",
        "IP address of a visitor without an account: in memory, for the read cap's window (one minute), never stored"),
    ],
    recipients: [
      frEn("Public du site", "The site's public"),
      frEn("Staff d'arbitrage et d'administration", "Refereeing and administration staff"),
      frEn("Discord, qui achemine le message privé d'une demande d'adhésion, d'une invitation d'équipe, d'une reprise d'équipe proposée ou d'une propriété transférée",
        "Discord, which delivers the direct message of a request to join, a team invitation, an offered team takeover or a transferred ownership"),
    ],
    transfers: [
      frEn(`États-Unis : Discord (acheminement des messages privés) — ${transferBasis(["DISCORD"])}`,
        `United States: Discord (delivery of direct messages) — ${transferBasisEn(["DISCORD"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Modification d'un score verrouillée dès que la manche suivante est entamée",
        "Changing a score locked as soon as the next round has started"),
    ],
  },
  T04: {
    name: frEn("Contact des joueurs pendant un tournoi", "Contacting players during a tournament"),
    purpose: frEn("Permettre à l'organisation de joindre un joueur engagé (reprogrammer, trancher un litige, confirmer un forfait), et aux parties d'un match (membres des deux équipes, casters inscrits) de se joindre pour l'organiser, et aux membres connectés de savoir qui arbitre un match",
      "Allowing the organizers to reach a player taking part (rescheduling, settling a dispute, confirming a forfeit), and the parties to a match (members of both teams, signed-up casters) to reach each other to organise it, and signed-in members to know who referees a match"),
    subPurposes: [
      frEn("Exposer le pseudo Discord certifié aux administrateurs, à tout moment, et aux arbitres tant que le joueur est inscrit à un tournoi qui n'est pas terminé (dès la phase d'inscription)",
        "Exposing the certified Discord username to administrators, at any time, and to referees while the player is registered for a tournament that is not over (from the registration phase)"),
      frEn("Ne présenter aux administrateurs et aux arbitres le BattleTag masqué d'un joueur que dans la fenêtre « Contacts » d'un match d'un tournoi Overwatch, aux mêmes durées que pour ses deux équipes, et, celui d'un caster, dès que les deux adversaires du match sont connus et jusqu'à sa fin (la fenêtre de lancement, qui la reprend au départ du match, ne s'ouvre qu'aux équipes, aux casters et à l'arbitre désigné ; la page du match reprend ceux de l'arbitre désigné et des casters, aux mêmes lecteurs et aux mêmes moments que la fenêtre « Contacts ») — jamais ailleurs que dans ces deux fenêtres et sur cette page (celle-ci ne reprenant les contacts des équipes qu'aux parties du match)",
        "Presenting a player's hidden BattleTag to administrators and referees only in the “Contacts” window of a match in an Overwatch tournament, over the same durations as for both its teams, and, a caster's, from the moment both opponents of the match are known until its end (the launch window, which repeats it at the start of the match, only opens for the teams, the casters and the assigned referee; the match page repeats those of the assigned referee and the casters, to the same readers at the same times as the “Contacts” window) — never anywhere other than these two windows and that page (which repeats the teams' contacts to the parties to the match alone)"),
      frEn("Au lancement d'un match — et dès que ses deux adversaires sont connus, par le bouton « Contacts » de sa carte —, présenter aux membres des deux équipes (joueurs, coachs, managers, propriétaires) et aux arbitres le pseudo Discord certifié et, dans les seuls tournois Overwatch, le BattleTag (même masqué) d'un ou deux membres par équipe (un seul dans les tournois Marvel Rivals), avec leur rôle d'équipe, jusqu'à la fin du match ; présenter les mêmes contacts à chaque caster inscrit (un match n'a pas de nombre maximal de casters), et ceux de chaque caster (son BattleTag dans les seuls tournois Overwatch) aux deux équipes et aux autres casters du match, le temps du match seulement (de son départ — lancement ouvert ou match lancé — à sa fin) ; ceux des casters aux arbitres dès que les deux adversaires sont connus et jusqu'à la fin du match ; la page du match reprend les contacts des casters (pseudo Discord certifié et, en Overwatch, BattleTag), aux mêmes lecteurs et aux mêmes moments que ce bouton, et, depuis le 4 novembre 2026, ceux des deux équipes (infos de connexion) aux seules parties du match — membres des deux équipes, casters inscrits, arbitre désigné —, jamais à un arbitre sans rôle sur ce match, aux mêmes moments que ce bouton",
        "When a match is launched — and as soon as both its opponents are known, through the “Contacts” button on its card —, presenting to the members of both teams (players, coaches, managers, owners) and to the referees the certified Discord username and, in Overwatch tournaments only, the BattleTag (even when hidden) of one or two members per team (only one in Marvel Rivals tournaments), with their team role, until the end of the match; presenting the same contacts to each registered caster (a match has no maximum number of casters), and each caster's (their BattleTag in Overwatch tournaments only) to both teams and to the other casters of the match, only while the match is being played (from its start — launch window opened or match launched — to its end); the casters' to the referees from the moment both opponents are known until the end of the match; the match page repeats the casters' contacts (certified Discord username and, in Overwatch, BattleTag), to the same readers at the same times as that button, and, since 4 November 2026, both teams' contacts (connection info) for the parties to the match alone — members of both teams, signed-up casters, assigned referee —, never a referee with no role in that match, at the same times as that button"),
      frEn("Recueillir les « Prêt » de chaque partie d'un match (équipes, chaque caster pour lui-même) avant son lancement, dans les seuls tournois qui ont la phase de lancement (option de chaque tournoi, éteinte par défaut)",
        "Collecting the “Ready” of each party to a match (teams, each caster for themselves) before it is launched, only in tournaments that have the launch phase (an option of each tournament, off by default)"),
      frEn("Inviter, sur la fiche d'un tournoi non terminé, le joueur d'une équipe engagée à certifier son tag Discord et son BattleTag (en Marvel Rivals, son tag Discord seul) : celui qui la mène en match (propriétaire, manager, capitaine) s'il lui en manque un, tout membre si personne dans l'équipe n'a de contact à présenter (en Marvel Rivals, si personne n'y a certifié son tag Discord, un BattleTag vérifié n'y comptant pas) — lecture des certifications du roster (tags compris, vérifiés comme au lancement d'un match), à chaque ouverture de la fiche ; le résultat (invitation due ou non) est gardé dans la mémoire du serveur au plus une minute après la fin de sa lecture (dix secondes après une erreur de lecture), jamais écrit ; seul un fait d'équipe (personne n'y a certifié son tag Discord ni son BattleTag — en Marvel Rivals, son tag Discord) est dit aux membres invités, jamais qui a certifié quoi ; fermeture retenue pour l'onglet (stockage de session, valeur « 1 » sans identifiant) ; « Ne plus voir » retenu sur le compte (date du choix), qui tait l'invitation sur tous les tournois et dans tous les navigateurs de ce compte ; un « Ne plus voir » donné à la proposition de certification de la connexion (compte) tait aussi l'invitation faite au meneur quand Discord est seul à manquer (jamais quand son équipe n'a aucun contact à présenter)",
        "Inviting, on the page of a tournament that has not finished, a player of an entered team to verify their Discord tag and BattleTag (in Marvel Rivals, their Discord tag only): whoever leads it in matches (owner, manager, captain) if they are missing one, any member if nobody on the team has a contact to show (in Marvel Rivals, if nobody on it has verified their Discord tag, a verified BattleTag not counting) — reading the roster's verifications (tags included, checked as at a match launch), each time the page opens; the result (prompt due or not) is kept in the server's memory at most one minute after its read ends (ten seconds after a read error), never written; only a team-level fact (nobody on it has verified their Discord tag or their BattleTag — in Marvel Rivals, their Discord tag) is told to the invited members, never who verified what; closing remembered for the tab (session storage, value “1” with no identifier); “Don't show again” kept on the account (date of the choice), which silences the invitation on every tournament and in every browser of that account; a “Don't show again” given to the sign-in certification proposal (account) also silences the invitation made to the team leader when Discord is the only thing missing (never when their team has no contact to show)"),
      frEn("Envoyer en message privé Discord et en push l'annonce de l'horaire d'un match (posé, changé ou retiré), l'avis qu'un match quitte son programme et les rappels de match 24 h et 10 h avant le coup d'envoi (le second — ou l'annonce d'un match programmé moins de 10 h avant — avec le lien d'invitation au serveur Discord du check-in) ; les messages privés ne partent qu'aux comptes dont le tag Discord est certifié (un tag non certifié, même rattaché par la connexion Discord, n'en reçoit aucun, pour éviter le spam) ; le joueur peut couper ces messages privés depuis « Mon profil » (notifications), ses notifications push gardant leurs propres réglages",
        "Sending by Discord direct message and by push the announcement of a match's time (set, changed or removed), the notice that a match leaves their schedule and match reminders 24 h and 10 h before kickoff (the latter — or the announcement of a match scheduled less than 10 h ahead — with the invite link to the check-in Discord server); direct messages only go to accounts with a certified Discord tag (an uncertified tag, even one linked by signing in with Discord, receives none, to avoid spam); the player can turn these direct messages off from “My profile” (notifications), their push notifications keeping their own settings"),
      frEn("Annoncer en message privé Discord et en push un nouveau match dès que ses deux adversaires sont connus (première manche comprise), à tous les membres de ses deux équipes (ou au joueur d'une entrée solo ; personne pour une équipe fantôme, rien pour un match dont une équipe est dissoute) : le tournoi, la manche, l'équipe adverse (en tournoi individuel, l'adversaire n'est pas nommé), l'horaire s'il est déjà posé (« Match programmé » ne part alors pas pour ce même horaire) et le lien de la page du match, sans BattleTag, tag Discord ni pseudo de joueur ; une seule fois par match et par affiche (un réappariement contre un autre adversaire est annoncé) ; le message privé ne part qu'à un tag Discord certifié et se coupe, comme les autres messages de match, depuis « Mon profil » ; le push a son propre sujet, « Nouveau match »",
        "Announcing a new match by Discord direct message and by push as soon as both its opponents are known (first round included), to all members of both its teams (or to the player of a solo entry; nobody for a ghost team, nothing for a match where a team is dissolved): the tournament, the round, the opposing team (in a solo tournament, the opponent is not named), the time if it is already set (“Match scheduled” is then not sent for that same time) and the link to the match page, without any BattleTag, Discord tag or player username; once per match and pairing (a re-pairing against another opponent is announced); the direct message only goes to a certified Discord tag and is turned off, like the other match messages, from “My profile”; the push has its own topic, “New match”"),
      frEn("Alerter le rôle arbitre (conflit de score, litige de score resté trop longtemps sans arbitrage, match entré en lancement sans arbitre désigné ni autogestion — un avertissement, rien ne bascule d'office —, signalement d'un joueur)",
        "Alerting the referee role (score conflict, score dispute left too long without a referee, match entering its launch with neither an assigned referee nor self-management — a warning, nothing switches automatically —, report on a player)"),
      frEn("Avertir en push les autres arbitres et administrateurs quand un membre du staff qui joue un match (membre d'une des deux équipes — encore membre, ou parti depuis le lancement du match, son premier report ou, à défaut, sa création —, ou joueur de l'entrée en tournoi individuel) en tranche lui-même le litige de score (« Valider le résultat »), en corrige le résultat déjà acquis, impose l'abandon de son adversaire, ou en suspend la validation automatique d'un score proposé (« Enregistrer ») : tournoi et manche, et — sauf pour une suspension — l'issue retenue avec les noms d'équipe (aucun en tournoi individuel), sans le pseudo de l'auteur ni d'aucun joueur",
        "Warning the other referees and administrators by push when a staff member who plays in a match (member of one of both teams — still a member, or gone since the match was launched, its first report or, failing these, its creation —, or the player of the entry in a solo tournament) settles its score dispute themselves (“Confirm the result”), corrects its already decided result, imposes their opponent's withdrawal, or pauses the automatic confirmation of a proposed score (“Save”): tournament and round, and — except for a pause — the retained outcome with the team names (none in a solo tournament), without the pseudo of the author or of any player"),
      frEn("Envoyer aux arbitres, environ 10 h à l'avance, le programme des matchs à venir (horaires, tournois, noms d'équipe ; « un joueur » en tournoi individuel) au canal de logs Discord et en push",
        "Sending the referees, about 10 hours ahead, the schedule of upcoming matches (times, tournaments, team names; “a player” in a solo tournament) to the Discord log channel and by push"),
      frEn("Prévenir un caster, en message privé Discord et en push, que son inscription sur un match a été retirée par un autre que lui — par le staff ou d'office (conditions du cast plus remplies, ou il joue désormais le match) —, avec le motif, le match (noms d'équipe ; « un match » en tournoi individuel), son tournoi et sa manche, sans nommer qui l'a retirée ; le message privé ne part qu'à un tag Discord certifié et se coupe, comme les autres messages de match, depuis « Mon profil » ; le push ne part que s'il détient encore la permission de diffusion",
        "Notifying a caster, by Discord direct message and by push, that their registration for a match was removed by someone other than themselves — by the staff or automatically (casting requirements no longer met, or they now play in the match) —, with the reason, the match (team names; “a match” in a solo tournament), its tournament and its round, without naming who removed it; the direct message only goes to a certified Discord tag and is turned off, like the other match messages, from “My profile”; the push is only sent if they still hold the streaming permission"),
      frEn("Envoyer en message privé Discord et en push, pour un match en autogestion seulement (aucun pour un match arbitré ou sans décision d'arbitrage), 15 minutes avant son coup d'envoi — ou à l'ouverture de son salon si elle vient plus tôt ou si le match n'a pas d'horaire —, une seule fois par match et par engagée (ni un changement d'horaire, ni un lancement annulé, ni un réappariement ne le renvoient ; l'engagée qui arrive par un réappariement reçoit le sien), à ceux qui gèrent chacune de ses engagées (propriétaire et managers d'une équipe, joueur d'une entrée solo ; personne pour une équipe fantôme) le check-in du match : la consigne de rejoindre le salon vocal de son équipe (dans un tournoi qui a l'option « Salons vocaux d'équipe », pour un match qui a un horaire, jamais en tournoi individuel ni contre une équipe fantôme) et le salon de check-in, l'équipe à gauche (l'hôte) et à droite, qui crée la partie ou vérifie ses réglages, les paramètres de partie, le déroulé des maps et l'ordre des bans, l'autogestion, le lien de diffusion du match s'il est public, le rappel de saisir les scores et à qui signaler un problème — avec les noms d'équipe, le tournoi, la manche et le lien de la page du match, sans BattleTag, tag Discord ni pseudo de joueur (« toi », « ton adversaire » en tournoi individuel) ; le message privé ne part qu'à un tag Discord certifié et se coupe, comme les autres messages de match, depuis « Mon profil » ; le push a son propre réglage",
        "Sending by Discord direct message and by push, for a self-managed match only (none for a refereed match or one with no refereeing decision), 15 minutes before it kicks off — or when its lobby opens, if that comes earlier or the match has no time —, once per match and per entrant (neither a change of time, nor a cancelled launch, nor a re-pairing sends it again; the entrant that arrives through a re-pairing receives its own), to those who manage each of its entrants (owner and managers of a team, the player of a solo entry; nobody for a ghost team) the match check-in: the instruction to join their team's voice channel (in a tournament with the “Team voice channels” option, for a match that has a time, never in a solo tournament nor against a ghost team) and the check-in channel, the team on the left (the host) and on the right, who creates the game or checks its settings, the game settings, the map order and the ban order, self-management, the match's stream link when it is public, the reminder to enter the scores and who to report a problem to — with the team names, the tournament, the round and the link to the match page, without any BattleTag, Discord tag or player username (“you”, “your opponent” in a solo tournament); the direct message only goes to a certified Discord tag and is turned off, like the other match messages, from “My profile”; the push has its own setting"),
      frEn("Arbitre désigné d'un match (membre du staff qui peut arbitrer — permission d'arbitrage, tag Discord certifié et, pour un match Overwatch, BattleTag tiré d'un compte Battle.net rattaché, un BattleTag tapé à la main n'y suffisant pas —, qui prend le match ou à qui le staff le confie ; il peut aussi le caster) : présenter son pseudo et, dans les seuls tournois Overwatch, son BattleTag (même masqué), dans les fenêtres « Contacts » et de lancement du match et sur la page du match, aux membres de ses deux équipes et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, et à ses casters le temps du match ; depuis le 4 novembre 2026, son tag Discord certifié aussi, dans la fenêtre « Contacts » et sur la page du match, aux seules parties du match — membres de ses deux équipes, ses casters —, aux mêmes moments que son BattleTag, jamais aux arbitres sans rôle sur ce match ni dans la fenêtre de lancement (s'il caste aussi le match, son tag et son BattleTag suivent la règle des casters : ses parties ne les lisent que le temps du match, fenêtre de lancement comprise, les autres arbitres dès que ses deux adversaires sont connus) — le pseudo seul, sans le BattleTag, dès que la fenêtre de lancement montre le match ; montrer aussi son pseudo seul à tout membre connecté, sur la carte et la page d'un match, jusqu'à la déclaration de son score ou la fin du tournoi (les visiteurs sans compte ne lisent que « Arbitre désigné ») ; recueillir son « Prêt », attendu comme celui des équipes et des casters, que seules ses parties et les arbitres lisent, dans les fenêtres « Contacts » et de lancement",
        "Assigned referee of a match (a staff member who can referee — refereeing permission, certified Discord tag and, for an Overwatch match, a BattleTag taken from a linked Battle.net account, a hand-typed BattleTag not being enough —, who takes the match or to whom the staff assigns it; they may also cast it): presenting their username and, in Overwatch tournaments only, their BattleTag (even when hidden), in the match's “Contacts” and launch windows and on the match page, to the members of both its teams and to the referees as soon as both its opponents are known until its end, and to its casters while the match is being played; since 4 November 2026, their certified Discord tag as well, in the “Contacts” window and on the match page, for the parties to the match alone — members of both its teams, its casters —, at the same times as their BattleTag, never to referees with no role in that match nor in the launch window (if they also cast the match, their tag and BattleTag follow the casters' rule: its parties read them only while the match is being played, launch window included, the other referees from the moment both its opponents are known) — the username alone, without the BattleTag, as soon as the launch window shows the match; also showing their username alone to any signed-in member, on the card and page of a match, until its score is reported or the tournament ends (visitors without an account only read “Referee assigned”); collecting their “Ready”, expected like those of the teams and casters, which only its parties and the referees read, in the “Contacts” and launch windows"),
      frEn("Prévenir l'arbitre désigné, en push seulement (jamais en message privé), quand l'arbitrage d'un match lui est retiré par un autre que lui — retrait par le staff, match confié à un autre arbitre ou passé en autogestion, opposition de l'arbitre retenue — ou d'office (conditions de l'arbitrage plus remplies, ou il devient joueur du match avant son lancement), avec le motif, le match (noms d'équipe ; « un match » en tournoi individuel), son tournoi et sa manche, sans nommer qui l'a retiré",
        "Notifying the assigned referee, by push only (never by direct message), when the refereeing of a match is removed from them by someone other than themselves — removal by the staff, match assigned to another referee or switched to self-management, the referee's objection upheld — or automatically (refereeing requirements no longer met, or they become a player of the match before its launch), with the reason, the match (team names; “a match” in a solo tournament), its tournament and its round, without naming who removed it"),
      frEn("Retenir l'opposition d'un arbitre (art. 21, formulaire de signalement, catégorie RGPD) : le retirer de tous ses matchs non terminés, lancés compris (le staff en désigne un autre ; ses matchs terminés gardent leur arbitre), et lui fermer tout arbitrage — ni prise d'un match, ni désignation par le staff — jusqu'à ce que le staff la lève, à sa seule demande (même formulaire) ; le geste et sa levée sont notés au journal du staff sur Discord sans nommer personne ni les matchs retirés (aucune ligne par match), et dans les journaux du serveur avec l'auteur, l'identifiant du compte de l'arbitre et le nombre de matchs retirés",
        "Upholding a referee's objection (art. 21, report form, GDPR category): removing them from all their unfinished matches, launched ones included (the staff assigns another referee; their finished matches keep their referee), and closing all refereeing to them — neither taking a match nor being assigned one by the staff — until the staff lifts it, at their request only (same form); the action and its lifting are noted in the staff log on Discord without naming anyone or the matches removed (no line per match), and in the server logs with the author, the referee's account identifier and the number of matches removed"),
    ],
    legalBasis: frEn("Consentement pour l'exposition du pseudo Discord certifié à l'organisation (certification, geste distinct fait par le joueur depuis son profil ou la fenêtre qui la lui propose après une connexion par Discord ou Blizzard — jamais acquise par la seule connexion — et retirable en retirant son tag) ; exécution du service demandé par le joueur (contrat — conditions d'utilisation, section « Contacts de match ») pour la présentation des contacts aux parties d'un match dans sa fenêtre « Contacts » et dans sa fenêtre de lancement — et, sur la page du match, pour les contacts des casters et, aux seules parties du match, ceux des deux équipes — (à ses deux équipes et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, à ses casters le temps du match, et ceux de chaque caster — service qu'il demande en s'inscrivant sur le match — à ses deux équipes et aux autres casters du match le temps du match et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin ; la fenêtre de lancement, au départ du match, ne s'ouvre qu'aux deux équipes, aux casters et à l'arbitre désigné), BattleTag masqué compris dans les seuls tournois Overwatch — arbitres et administrateurs n'y ont pas d'autre accès, sur la même base —, et le recueil des « Prêt » ; intérêt légitime (bon déroulement des tournois) pour l'annonce des horaires de match, l'avis qu'un match quitte son programme, l'annonce d'un nouveau match (adversaire, horaire et lien, première manche comprise) et les rappels de match envoyés aux joueurs, le check-in d'un match en autogestion envoyé à ceux qui gèrent ses engagées (ou au joueur d'une entrée individuelle), et l'avis du retrait de son inscription envoyé à un caster, avec un droit d'opposition (art. 21) honoré par un interrupteur de « Mon profil » qui coupe tous leurs messages privés de match ; exécution du service (contrat — conditions d'utilisation, les arbitres et administrateurs agissant pour l'association) pour les alertes d'arbitrage et le programme d'arbitrage adressés au staff, l'intérêt légitime (bon déroulement des tournois) restant la base à l'égard des joueurs et équipes qu'ils citent ; intérêt légitime (impartialité de l'arbitrage) à l'égard du membre du staff qui arbitre, dont l'appartenance aux équipes du match est vérifiée à chacun de ces gestes et, s'il joue le match, les autres membres du staff avertis — il peut s'y opposer (art. 21) par le formulaire de signalement (catégorie RGPD) ; obligation légale (RGPD, art. 6.1.c) pour la conservation de son choix des messages privés de match (le garder est ce qui permet de continuer d'honorer son opposition, art. 21 et 12) ; exécution du service (contrat — conditions d'utilisation, section « Contacts de match », depuis leur version 7 : que les parties du match sachent qui l'arbitre et, en Overwatch, puissent l'ajouter en jeu) pour la présentation de l'arbitre désigné aux parties du match, dans ses fenêtres « Contacts » et de lancement et sur la page du match, une fois que cet arbitre a accepté la version 7 des conditions ou une version suivante — tant qu'il ne l'a pas acceptée, intérêt légitime (même but), et il peut s'y opposer (art. 21) par le formulaire de signalement (catégorie RGPD) : retenue, son opposition le retire de tous ses matchs non terminés (le staff en désigne un autre ; ses matchs terminés gardent leur arbitre) et l'empêche d'en prendre un ou de s'en voir confier un tant qu'elle n'est pas levée (à sa seule demande), et continue de valoir une fois la version 7 ou une suivante acceptée — (il peut se retirer d'un match à tout moment, le staff pouvant lui confier de nouveau ce match (sauf opposition retenue), sans avis ; tant qu'il n'a pas accepté la version 7 ou une suivante, la fenêtre d'acceptation couvrant les pages des tournois, il s'en retire en le demandant par le formulaire de signalement) ; intérêt légitime (que les membres sachent qui arbitre un match) pour l'affichage de son pseudo à tout membre connecté, avec le même droit d'opposition et le même effet une fois retenue ; exécution du service (strictement nécessaire à son fonctionnement minimum : sans lui, les parties du match ne peuvent pas joindre son arbitre) pour la présentation de son tag Discord certifié aux parties du match, dans la fenêtre « Contacts » et sur la page du match, depuis le 6 novembre 2026 (avant cette date, intérêt légitime), une fois que cet arbitre a accepté la version 9 des conditions ou une suivante (le reste de sa présentation dépendant de la version 7, ci-dessus) — tant qu'il ne l'a pas acceptée, intérêt légitime (même but), avec le même droit d'opposition ; une fois cette version acceptée, ce tag n'a pas d'opposition propre : son opposition à l'arbitrage, retenue, l'en retire avec ses matchs non terminés, comme ci-dessus ; exécution du service (les arbitres agissant pour l'association) pour le recueil de son « Prêt » ; l'avis du retrait de son arbitrage, envoyé en push seulement, relève des notifications push (consentement, traitement T12) ; exécution du service demandé par le joueur (contrat) pour la conservation sur son compte de son choix « Ne plus voir » de l'invitation à certifier ; obligation légale (RGPD, art. 6.1.c) pour la conservation de la date de l'opposition d'un arbitre retenue (la garder est ce qui permet de continuer de l'honorer, art. 21 et 12) ; exécution du service (contrat — conditions d'utilisation, section « Contacts de match ») pour le BattleTag qu'un caster donne pour un cast précis, présenté à la place de celui de son compte, aux mêmes lecteurs et aux mêmes moments et dans les seuls tournois Overwatch, et jamais présenté comme prouvé",
      "Consent for exposing the certified Discord username to the organizers (certification, a separate action taken by the player from their profile or the window that offers it after logging in through Discord or Blizzard — never acquired by logging in alone — and withdrawable by removing their tag); performance of the service requested by the player (contract — terms of use, “Match contacts” section) for presenting the contacts to the parties to a match in its “Contacts” window and its launch window — and, on the match page, for the casters' contacts and, for the parties to the match alone, both teams' — (to both its teams and the referees as soon as both its opponents are known until its end, to its casters while the match is being played, and each caster's — a service they request by signing up for the match — to both its teams and to the other casters of the match while the match is being played and to the referees as soon as both its opponents are known until its end; the launch window, at the start of the match, only opens for both teams, the casters and the assigned referee), hidden BattleTag included in Overwatch tournaments only — referees and administrators have no other access to it, on the same basis —, and collecting the “Ready”; legitimate interest (smooth running of tournaments) for match time notices, the notice that a match leaves their schedule, the notice of a new match (opponent, time and link, first round included) and match reminders sent to players, the check-in of a self-managed match sent to those who manage its entrants (or to the player of a solo entry), and the notice of the removal of their registration sent to a caster, with a right to object (art. 21) honoured by a switch in “My profile” that turns off all their match direct messages; performance of the service (contract — terms of use, referees and administrators acting for the association) for referee alerts and the refereeing schedule sent to staff, legitimate interest (smooth running of tournaments) remaining the basis with regard to the players and teams they mention; legitimate interest (impartial refereeing) with regard to the staff member who referees, whose membership of the match's teams is checked at each of these actions and, if they play in the match, the other staff members warned — they may object to it (art. 21) through the report form (GDPR category); legal obligation (GDPR, art. 6.1.c) for keeping their choice about match direct messages (keeping it is what allows their objection to keep being honoured, art. 21 and 12); performance of the service (contract — terms of use, “Match contacts” section, since their version 7: the parties to the match know who referees it and, in Overwatch, can add them in game) for presenting the assigned referee to the parties to the match, in its “Contacts” and launch windows and on the match page, once that referee has accepted version 7 of the terms or a later version — until they accept it, legitimate interest (same aim), and they may object to it (art. 21) through the report form (GDPR category): once upheld, their objection removes them from all their unfinished matches (the staff assigns another referee; their finished matches keep their referee) and stops them taking or being assigned one until it is lifted (at their request only), and still stands once version 7 or a later one is accepted — (they can withdraw from a match at any time, the staff being able to assign that match to them again (unless an objection is upheld), without notice; until they have accepted version 7 or a later one, as the acceptance window covers the tournament pages, they withdraw by asking for it through the report form); performance of the service (the referees acting for the association) for collecting their “Ready”; the notice that their refereeing was removed, sent by push only, falls under push notifications (consent, processing activity T12); legitimate interest (members knowing who referees a match) for showing their username to any signed-in member, with the same right to object and the same effect once upheld; performance of the service (strictly necessary for its minimum functioning: without it, the parties to the match cannot reach its referee) for presenting their certified Discord tag to the parties to the match, in the “Contacts” window and on the match page, since 6 November 2026 (before that date, legitimate interest), once this referee has accepted version 9 of the terms or a later one (the rest of their presentation depending on version 7, above) — until they have, legitimate interest (same purpose), with the same right to object; once that version is accepted, this tag has no objection of its own: their objection to refereeing, once upheld, removes it along with their unfinished matches, as above; performance of the service requested by the player (contract) for keeping on their account their “Don't show again” choice on the invitation to verify; legal obligation (GDPR, art. 6.1.c) for keeping the date of a referee's upheld objection (keeping it is what allows it to keep being honoured, art. 21 and 12); performance of the service (contract — terms of use, “Match contacts” section) for the BattleTag a caster gives for one specific cast, shown in place of their account one, to the same readers at the same times and in Overwatch tournaments only, and never presented as proven"),
    dataSubjects: [
      frEn("Joueurs engagés dans un tournoi", "Players taking part in a tournament"),
      frEn("Autres membres des équipes engagées (coachs, managers, propriétaires)",
        "Other members of the teams taking part (coaches, managers, owners)"),
      frEn("Arbitres et administrateurs", "Referees and administrators"),
      frEn("Casters inscrits sur un match", "Casters registered on a match"),
      frEn("Tout titulaire de compte, pour son choix des messages privés de match",
        "Any account holder, for their match direct messages choice"),
    ],
    dataCategories: [
      frEn("Pseudo et identifiant Discord", "Discord username and identifier"),
      frEn("BattleTag (présenté dans les seuls tournois Overwatch, où sa présence et sa provenance d'un compte Battle.net rattaché — un BattleTag saisi à la main n'y suffit pas — sont aussi vérifiées pour caster ou arbitrer un match)",
        "BattleTag (shown in Overwatch tournaments only, where its presence and that it comes from a linked Battle.net account — a BattleTag typed in by hand is not enough — are also checked to cast or referee a match)"),
      frEn("Date et adversaire du match", "Date and opponent of the match"),
      frEn("Annonces d'un nouveau match : place du match dans le tournoi, numéros des deux engagées, horaire annoncé et date de la trace, ou marque d'un match non annoncé",
        "New-match announcements: the match's place in the tournament, numbers of both entrants, announced time and date of the record, or the mark of a match not announced"),
      frEn("Heure à laquelle chaque partie s'est déclarée prête (chaque caster pour lui-même), casters inscrits avec l'heure d'inscription de chacun, et stream que chacun a rejoint (co-cast) ou ouvert à part",
        "Time at which each party declared itself ready (each caster for themselves), registered casters with the time each one registered, and the stream each one joined (co-cast) or opened separately"),
      frEn("BattleTag qu'un caster donne pour un cast précis (facultatif, jamais vérifié ni recopié sur son profil, présenté dans les seuls tournois Overwatch, à la place de celui de son compte et aux mêmes lecteurs et moments — le réglage de visibilité du profil ne le masque pas, le caster le donnant pour ce match)",
        "BattleTag a caster gives for one specific cast (optional, never verified nor copied onto their profile, shown in Overwatch tournaments only, in place of their account one and to the same readers at the same times — the profile visibility setting does not hide it, the caster giving it for this match)"),
      frEn("Motif du retrait de l'inscription d'un caster sur un match (retrait par le staff, conditions du cast plus remplies — permission de diffusion, tag Discord certifié, et en Overwatch BattleTag tiré d'un compte Battle.net rattaché —, ou il joue désormais le match)",
        "Reason for the removal of a caster's registration for a match (removed by the staff, casting requirements no longer met — streaming permission, certified Discord tag, and in Overwatch a BattleTag taken from a linked Battle.net account —, or they now play in the match)"),
      frEn("Arbitre désigné d'un match, heure de son « Prêt », autogestion du match, première carte posée par le staff et cartes choisies dans le pool de la manche (par le staff ou, en autogestion, par une équipe du match) ; motif du retrait de son arbitrage (retrait par le staff, match confié à un autre arbitre ou passé en autogestion, opposition retenue, conditions de l'arbitrage plus remplies, ou il devient joueur du match avant son lancement), envoyé à l'arbitre et gardé seulement dans la ligne du journal du staff sur Discord qui note le retrait, sans nommer l'arbitre (traitement T05)",
        "Assigned referee of a match, time of their “Ready”, self-management of the match, first map set by the staff and maps picked from the round pool (by the staff or, in self-management, by a team of the match); reason for the removal of their refereeing (removed by the staff, match assigned to another referee or switched to self-management, objection upheld, refereeing requirements no longer met, or they become a player of the match before its launch), sent to the referee and kept only in the staff log line on Discord that notes the removal, without naming the referee (processing activity T05)"),
      frEn("Rôles d'équipe et statut de certification (tag Discord ; dans les seuls tournois Overwatch, BattleTag tiré d'un compte Battle.net rattaché) des contacts présentés ; propriétaires et managers des engagées d'un match (choix des destinataires du check-in du match)",
        "Team roles and certification status (Discord username; in Overwatch tournaments only, BattleTag taken from a linked Battle.net account) of the contacts presented; owners and managers of a match's entrants (choosing the recipients of the match check-in)"),
      frEn("Motif d'un signalement", "Reason for a report"),
      frEn("Choix du joueur de recevoir ou non les messages privés Discord de ses matchs",
        "The player's choice to receive or not the Discord direct messages about their matches"),
      frEn("Choix « Ne plus voir » de la fenêtre qui invite à certifier son tag Discord et son BattleTag (date du choix)",
        "“Don't show again” choice on the window inviting to verify the Discord tag and BattleTag (date of the choice)"),
      frEn("Opposition d'un arbitre retenue par le staff (date), lue par le staff ayant la permission de gérer les tournois dans la fenêtre « Arbitrage », où il peut la lever",
        "A referee's objection upheld by the staff (date), read by the staff allowed to manage tournaments in the “Refereeing” window, where they can lift it"),
      frEn("Langue du compte déjà rattaché au compte Discord visé (T01), lue pour que le bot rédige dans cette langue le code de certification ou de changement du tag",
        "Language of the account already linked to the targeted Discord account (T01), read so that the bot writes the certification or tag change code in that language"),
      frEn("Appartenance d'un membre du staff aux équipes d'un match qu'il arbitre — pour un abandon imposé, à la seule équipe adverse de l'équipe retirée — (membre actuel, ou date de départ comparée au lancement du match, à son premier report ou, à défaut, à sa création), vérifiée à chaque litige tranché, résultat corrigé, abandon imposé ou validation automatique suspendue",
        "Membership of a staff member in the teams of a match they referee — for an imposed withdrawal, in the withdrawn team's opponent only — (current member, or leaving date compared with the launch of the match, its first report or, failing these, its creation), checked at each dispute settled, result corrected, withdrawal imposed or automatic confirmation paused"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Pseudo certifié : jusqu'à sa modification ou la suppression du compte",
        "Certified username: until it is changed or the account is deleted"),
      frEn("BattleTag donné pour un cast : avec l'inscription de caster qui le porte — effacé avec elle (retrait du cast, suppression du compte), jamais recopié sur le profil",
        "BattleTag given for a cast: with the caster registration that carries it — erased with it (leaving the cast, account deletion), never copied onto the profile"),
      frEn("Choix des messages privés de match : jusqu'à sa modification ; remis au défaut à la suppression du compte",
        "Choice of match direct messages: until it is changed; reset to the default when the account is deleted"),
      frEn("Choix « Ne plus voir » de l'invitation à certifier : jusqu'à la suppression du compte, effacé à l'anonymisation",
        "“Don't show again” choice on the verification invitation: until the account is deleted, erased on anonymisation"),
      frEn("Opposition d'arbitre retenue (date) : jusqu'à sa levée par le staff, à la demande de l'arbitre, ou la suppression du compte, effacée à l'anonymisation",
        "Upheld referee objection (date): until the staff lifts it at the referee's request or the account is deleted, erased on anonymisation"),
      frEn("Traces d'envoi des rappels, alertes et programmes d'arbitrage (match, palier et horaire annoncé, sans le texte du message) : conservées avec le match, donc sans limite de durée ; celles du check-in du match (la place du match dans le tournoi — phase, tableau, manche, numéro —, l'engagée et la date de l'envoi) : conservées avec le tournoi, pour qu'il ne parte jamais deux fois, même quand un retour arrière efface puis recrée le match ; effacées avec le tournoi ou l'engagée, ou quand le tableau à élimination de la phase (ou du tournoi) est reconstruit parce que le nombre d'engagées a changé — ses nouvelles rencontres reçoivent leur propre check-in ; celles des départs de match (match, affiche et phase de l'annonce — appel aux « Prêt » ou match lancé —, avec leur date) : conservées avec le match ; celles de l'annonce d'un nouveau match (place du match dans le tournoi, numéros des deux engagées, horaire annoncé et date de la trace, ou la marque qu'il n'a pas été annoncé — match déjà apparié à la mise en service, équipe dissoute, envoi échoué trois fois) : conservées avec le tournoi, pour qu'elle ne parte qu'une fois par match et par affiche, effacées avec lui ou avec l'une des deux engagées une fois supprimée — une équipe dissoute reste au tournoi, et la trace avec elle (en tournoi individuel, le numéro d'une entrée renvoie à son joueur, qui n'y est plus reconnaissable une fois son compte anonymisé)",
        "Records of reminders, alerts and refereeing schedules sent (match, step and announced time, without the message text): kept with the match, so with no time limit; those of match check-ins sent (the match's place in the tournament — phase, bracket, round, number —, the entrant and the date it was sent): kept with the tournament, so that it never goes out twice, even when a rollback erases and recreates the match; erased with the tournament or the entrant, or when the elimination bracket of the phase (or of the tournament) is rebuilt because the number of entrants changed — its new matches receive their own check-in; those of match starts (match, pairing and phase of the notice — call for “Ready” or match launched —, with their date): kept with the match; those of the notice of a new match (the match's place in the tournament, the numbers of both entrants, the announced time and the date of the record, or the mark that it was not announced — match already paired when the feature went live, team dissolved, sending failed three times): kept with the tournament, so that it goes out only once per match and pairing, erased with it or with either entrant once deleted — a dissolved team stays in the tournament, and the record with it (in a solo tournament, an entry's number leads to its player, who can no longer be recognised through it once their account is anonymised)"),
      frEn("« Prêt » et casters d'un match : conservés avec le match ; le caster d'un compte supprimé est retiré des matchs non terminés (de tous ses matchs si le compte est effacé), avec le stream qu'il était seul à tenir ; un caster qui quitte un match (de lui-même ou retiré) emporte de même le stream qu'il était seul à tenir et son lien ; seul le lien posé dans la configuration du direct du match reste au match ; le lien qu'un caster a fourni (en ouvrant son stream ou dans cette configuration) part à la suppression de son compte, matchs joués compris, même d'un stream qu'un autre caster tient encore (un membre de l'organisation y indique, en posant le lien, s'il est celui de l'organisation — il reste au match — ou sa propre chaîne, qui part avec son compte ; il peut l'indiquer aussi en ouvrant son propre stream ou dans « Configurer ma diffusion » : ce lien ne part alors pas avec son compte, mais avec ce stream quand plus aucun caster ne le tient ; un lien posé dans cette configuration avant que le site n'enregistre qui le fournit n'a pas d'auteur connu et reste au match) ; un caster qui ne remplit plus les conditions de son inscription (permission de diffusion, tag Discord certifié, et dans un match Overwatch le BattleTag tiré d'un compte Battle.net rattaché) ne reçoit plus les contacts et n'est plus montré ; son inscription est effacée si c'est constaté avant le lancement du match (lecture des contacts, « Prêt », lancement ou entretien des lancements), sinon elle reste avec le match ; un caster dont l'équipe entre dans le match en est retiré au plus tard à son départ",
        "“Ready” and casters of a match: kept with the match; the caster of a deleted account is removed from matches that are not over (from all their matches if the account is erased), with the stream they alone held; a caster who leaves a match (of their own accord or removed) likewise takes away the stream they alone held and its link; only the link set in the match's live configuration stays with the match; the link a caster provided (when opening their stream or in that configuration) goes when their account is deleted, played matches included, even from a stream another caster still holds (a member of the organizers states, when setting the link, whether it is the organizers' link — it stays with the match — or their own channel, which goes with their account; they can also state it when opening their own stream or in “Configure my broadcast”: that link then does not go with their account, but with that stream once no caster holds it any more; a link set in that configuration before the site recorded who provided it has no known author and stays with the match); a caster who no longer meets the conditions of their sign-up (broadcast permission, certified Discord tag, and in an Overwatch match the BattleTag taken from a linked Battle.net account) no longer receives the contacts and is no longer shown; the sign-up is erased if this is noticed before the match is launched (reading the contacts, a “Ready”, the launch or the launch maintenance), otherwise it stays with the match; a caster whose team joins the match is removed at the latest when it starts"),
      frEn("Arbitre désigné, son « Prêt », autogestion, première carte et cartes choisies dans le pool : conservés avec le match ; l'arbitre d'un compte supprimé est retiré de tous ses matchs, joués compris ; un arbitre qui ne remplit plus les conditions de l'arbitrage (permission, tag Discord certifié, et dans un match Overwatch le BattleTag tiré d'un compte Battle.net rattaché), ou qui devient joueur du match avant son lancement, n'est plus montré, et en est retiré si c'est constaté avant le lancement du match",
        "Assigned referee, their “Ready”, self-management, first map and maps picked from the pool: kept with the match; the referee of a deleted account is removed from all their matches, played ones included; a referee who no longer meets the refereeing requirements (permission, certified Discord tag, and in an Overwatch match the BattleTag taken from a linked Battle.net account), or who becomes a player of the match before its launch, is no longer shown, and is removed from it if this is found before the match is launched"),
    ],
    recipients: [
      frEn("Administrateurs et arbitres de l'association",
        "The association's administrators and referees"),
      frEn("Staff ayant la permission de gérer les tournois, dans la fenêtre « Arbitrage » d'un match, à tout moment : pseudo de l'arbitre désigné et des comptes qui peuvent arbitrer, oppositions d'arbitre retenues",
        "Staff holding the permission to manage tournaments, in a match's “Refereeing” window, at any time: username of the assigned referee and of the accounts that can referee, upheld referee objections"),
      frEn("Membres des deux équipes d'un même match et arbitres, dès que ses deux adversaires sont connus et jusqu'à sa fin, et ses casters inscrits le temps du match (de son départ à sa fin) ; contacts de chaque caster aux deux équipes et aux autres casters du match le temps du match, et aux arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin",
        "Members of both teams of the same match and referees, from the moment both its opponents are known to its end, and its registered casters while the match is being played (from its start to its end); each caster's contacts to both teams and to the other casters of the match while the match is being played, and to the referees from the moment both its opponents are known until its end"),
      frEn("Pour l'arbitre désigné d'un match (pseudo et, en Overwatch, BattleTag) : membres des deux équipes du match et arbitres dès que ses deux adversaires sont connus et jusqu'à sa fin, ses casters le temps du match — ses deux équipes le temps du match seulement s'il caste aussi le match — (le pseudo seul dès que la fenêtre de lancement montre le match) ; son pseudo seul à tout membre connecté, sur la carte et la page du match jusqu'à la déclaration de son score ou la fin du tournoi ; son tag Discord certifié aux seules parties du match (membres de ses deux équipes, ses casters), dans la fenêtre « Contacts » et sur la page du match, aux mêmes moments que son BattleTag (en Marvel Rivals, sans BattleTag, aux mêmes moments) — s'il caste aussi le match, la règle des casters : aux autres arbitres dès que ses deux adversaires sont connus",
        "For the assigned referee of a match (username and, in Overwatch, BattleTag): members of both teams of the match and referees from the moment both its opponents are known until its end, its casters while the match is being played — both its teams only while the match is being played if they also cast it — (the username alone as soon as the launch window shows the match); their username alone to any signed-in member, on the match card and page until its score is reported or the tournament ends; their certified Discord tag to the parties to the match alone (members of both its teams, its casters), in the “Contacts” window and on the match page, at the same times as their BattleTag (in Marvel Rivals, with no BattleTag, at the same times) — if they also cast the match, the casters' rule: to the other referees from the moment both its opponents are known"),
      frEn("Discord, qui achemine les messages", "Discord, which delivers the messages"),
      frEn("Staff de l'association ayant accès au canal de logs Discord (programme d'arbitrage, gestes d'un membre du staff qui joue le match, inscriptions et retraits des casters, arbitrage des matchs, sans nommer ni casters ni arbitres, traitement T05)",
        "The association's staff with access to the Discord log channel (refereeing schedule, actions of a staff member who plays in the match, casters' registrations and removals, match refereeing, without naming casters or referees, processing activity T05)"),
      frEn("Service de push du navigateur de chaque destinataire abonné (joueur : annonces et rappels de match ; membre d'une équipe engagée, joueur d'un tournoi individuel : nouveau match ; propriétaire ou manager d'une engagée, joueur d'un tournoi individuel : check-in d'un match en autogestion ; caster : départ du match qu'il caste, retrait de son inscription sur un match ; arbitre désigné : retrait de son arbitrage ; arbitre ou administrateur : programme d'arbitrage, litige tranché, résultat corrigé, abandon imposé à l'adversaire ou validation automatique suspendue par un membre du staff qui joue le match ; traitement T12), qui achemine un message chiffré qu'il ne peut pas lire",
        "The push service of the browser of each subscribed recipient (player: match announcements and reminders; member of an entered team, player of a solo tournament: new match; owner or manager of an entrant, player of a solo tournament: check-in of a self-managed match; caster: start of the match they cast, removal of their registration for a match; assigned referee: removal of their refereeing; referee or administrator: refereeing schedule, dispute settled, result corrected, opponent's withdrawal imposed or automatic confirmation paused by a staff member who plays in the match; processing activity T12), which delivers an encrypted message it cannot read"),
    ],
    transfers: [
      frEn(`États-Unis : Discord (acheminement des messages privés et du canal de logs) — ${transferBasis(["DISCORD"])}`,
        `United States: Discord (delivery of direct messages and of the log channel) — ${transferBasisEn(["DISCORD"])}`),
      frEn(`États-Unis : service de push du navigateur du destinataire abonné (joueur, propriétaire ou manager d'une équipe, caster, arbitre ou administrateur), qui ne reçoit que des messages chiffrés de bout en bout (RFC 8291) — ${transferBasis(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])}`,
        `United States: push service of the browser of the subscribed recipient (player, owner or manager of a team, caster, referee or administrator), which only receives end-to-end encrypted messages (RFC 8291) — ${transferBasisEn(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Pseudo non certifié invisible de tous, administrateurs compris ; pseudo certifié jamais montré à un visiteur sans compte",
        "Uncertified username invisible to everyone, administrators included; certified username never shown to a visitor without an account"),
      frEn("Contacts d'un match servis aux seules parties du match, jamais dans l'instantané public du tournoi",
        "Match contacts served only to the parties to the match, never in the tournament's public snapshot"),
    ],
  },
  T05: {
    name: frEn("Journal d'activité du staff sur Discord", "Staff activity log on Discord"),
    purpose: frEn("Tenir le staff informé des faits marquants de la plateforme",
      "Keeping the staff informed of notable events on the platform"),
    subPurposes: [
      frEn("Arrivées de joueurs, inscriptions et abandons en tournoi, fins de match, clôtures",
        "New players, tournament registrations and withdrawals, match results, closings"),
      frEn("Suppressions de compte demandées et leurs réactivations, et les retraits d'inscription ou forfaits qu'elles entraînent, sans nommer le joueur (« un joueur » ; nom de l'équipe ou du tournoi seulement)",
        "Requested account deletions and their reactivations, and the registration withdrawals or forfeits they cause, without naming the player (“a player”; team or tournament name only)"),
      frEn("Traçabilité des gestes d'arbitrage (pénalités, retraits d'engagés, retours en arrière, horaires de match posés, changés ou retirés, et, quand leur auteur joue le match, litige tranché, résultat corrigé, abandon imposé à l'adversaire ou validation automatique suspendue — ces quatre gestes — tout abandon imposé par l'arbitrage qui clôt une manche compris, une trace par manche close face à un adversaire connu, quelle que soit l'équipe retirée — laissant aussi, que leur auteur joue ou non, une trace courte dans les seuls journaux du serveur), pour la modération",
        "Traceability of refereeing actions (penalties, removal of participants, rollbacks, match times set, changed or removed, and, when their author plays in the match, dispute settled, result corrected, opponent's withdrawal imposed or automatic confirmation paused — these four actions — any withdrawal imposed by the referees that closes a match included, one trace per match closed against a known opponent, whichever team is withdrawn — also leaving, whether or not their author plays, a short trace in the server logs only), for moderation"),
      frEn("Programme d'arbitrage : environ 10 h à l'avance, les matchs à venir (horaires, tournois, noms d'équipe ; « un joueur » en tournoi individuel)",
        "Refereeing schedule: about 10 hours ahead, the upcoming matches (times, tournaments, team names; “a player” in a solo tournament)"),
      frEn("Casts des matchs : l'inscription d'un caster sur un match et son retrait (par lui-même, par le staff ou d'office, avec le motif), sans nommer le caster ni le staff — et sans trace dans les journaux du serveur",
        "Match casts: a caster's registration for a match and its removal (by themselves, by the staff or automatically, with the reason), without naming the caster or the staff — and without any trace in the server logs"),
      frEn("Arbitrage des matchs : arbitre désigné qui prend un match, à qui le staff le confie ou qui en est retiré (par lui-même, par le staff ou d'office, avec le motif), autogestion d'un match ou d'une manche entière (une ligne par manche), première carte posée ou retirée, carte choisie dans le pool de la manche ou choix retiré — sans nommer l'arbitre ni le staff ; l'opposition d'un arbitre retenue ou levée par le staff : une seule ligne, sans nommer personne ni les matchs dont il est retiré (aucune ligne par match)",
        "Match refereeing: an assigned referee taking a match, being assigned it by the staff or removed from it (by themselves, by the staff or automatically, with the reason), self-management of a match or of a whole round (one line per round), first map set or cleared, map picked from the round pool or pick cleared — without naming the referee or the staff; a referee's objection upheld or lifted by the staff: a single line, naming no one nor the matches they are removed from (no line per match)"),
      frEn("Autres gestes du staff sur les matchs et tournois : résultat validé ou score enregistré par l'arbitrage, lancement forcé, hôte du salon désigné ou retiré, réglage de la diffusion d'un match, mise à l'antenne ou retrait, lien de rediffusion, modification d'un tournoi, option « Salons vocaux d'équipe » allumée ou éteinte, salon vocal d'une équipe vidé (son auteur, s'il n'est pas l'arbitre désigné du match, est en outre nommé dans les journaux du serveur, voir T18), ordre des têtes de série, étape suivante avancée, équipes fantômes inscrites (leur nombre), image et lien de diffusion d'un tournoi — le geste, le tournoi et le match (le tournoi seul pour un score qui suspend la validation automatique), sans nommer son auteur (« le staff », ou « un caster » pour un geste de diffusion de qui n'a que cette permission) ni le lien posé ; cette ligne n'ajoute rien aux journaux du serveur (un litige tranché ou un résultat corrigé y garde la trace courte nominative décrite à la première ligne (traçabilité des gestes d'arbitrage), comme une validation automatique suspendue), sauf, quand elle n'a pu être rédigée, le geste et le numéro du match ou du tournoi, sans auteur",
        "Other staff actions on matches and tournaments: result confirmed or score saved by the referees, forced launch, lobby host set or removed, a match's broadcast settings, putting on air or taking off air, replay link, tournament edited, “Team voice channels” option turned on or off, a team's voice channel cleared (its author, unless they are the match's assigned referee, is also named in the server logs, see T18), seeding order, next stage brought forward, ghost teams registered (their number), a tournament's image and broadcast link — the action, the tournament and the match (the tournament alone for a score that pauses the automatic confirmation), without naming its author (“the staff”, or “a caster” for a broadcast action by someone who only holds that permission) or the link set; this line adds nothing to the server logs (a dispute settled or a result corrected keeps there the short named trace described in the first line (traceability of refereeing actions), as does a paused automatic confirmation), except, when it could not be composed, the action and the match or tournament number, without its author"),
      frEn("Rôles de plateforme : attribution ou retrait d'un rôle (administrateur, arbitre, caster, community manager, recruteur) par un administrateur, y compris sur son propre compte, où il ne peut pas se retirer l'administration — une ligne sans nommer personne ; dans les journaux du serveur, son auteur, l'identifiant du compte visé et les rôles enregistrés",
        "Platform roles: an administrator granting or removing a role (administrator, referee, caster, community manager, recruiter), including on their own account, where they cannot remove their own administration — one line naming no one; in the server logs, its author, the identifier of the account concerned and the roles saved"),
    ],
    legalBasis: frEn("Intérêt légitime (administration et contrôle de l'arbitrage et des tournois, diffusion comprise) à l'égard des joueurs et équipes cités, des casters des matchs (jamais nommés) et du membre du staff auteur d'un geste, nommé dans les journaux du serveur, comme de l'arbitre dont le staff retient ou lève l'opposition, désigné dans ces seuls journaux par l'identifiant de son compte, et du compte dont un administrateur attribue ou retire un rôle de plateforme, désigné de même ; l'envoi du programme d'arbitrage aux arbitres et administrateurs relève de l'exécution du service (T04)",
      "Legitimate interest (administration and oversight of refereeing and of tournaments, broadcasting included) with regard to the players and teams mentioned, to the casters of the matches (never named) and to the staff member who carried out an action, named in the server logs, as well as to the referee whose objection the staff upholds or lifts, designated in those logs only by their account identifier, and to the account whose platform role an administrator grants or removes, designated in the same way; sending the refereeing schedule to referees and administrators falls under performance of the service (T04)"),
    dataSubjects: [
      "Staff",
      frEn("Joueurs et équipes engagés dans un tournoi (désignés par le nom d'équipe, jamais par leur pseudo)",
        "Players and teams taking part in a tournament (referred to by team name, never by their username)"),
      frEn("Casters inscrits sur un match (jamais nommés)",
        "Casters registered for a match (never named)"),
      frEn("Arbitres désignés des matchs (jamais nommés sur Discord)",
        "Assigned referees of matches (never named on Discord)"),
      frEn("Comptes dont un administrateur attribue ou retire un rôle de plateforme (désignés par l'identifiant de leur compte ; nommés seulement quand un administrateur règle les siens, comme auteur du geste)",
        "Accounts whose platform role an administrator grants or removes (designated by their account identifier; named only when an administrator sets their own, as the author of the action)"),
    ],
    dataCategories: [
      frEn("Sur Discord : noms d'équipe, scores, noms des tournois, horaires et manches des matchs — aucun pseudo de joueur (« un joueur », y compris en tournoi individuel) et aucun membre du staff ni caster nommé (« le staff », « un caster » ; motif du retrait d'office d'un caster — il ne remplit plus les conditions du cast, ou il joue désormais le match ; « un membre du staff qui joue ce match », avec le seul nom du tournoi, pour un litige tranché, un résultat corrigé, un abandon imposé ou une validation automatique suspendue par lui ; motif du retrait de l'arbitre désigné d'un match — retrait par le staff, match confié à un autre arbitre ou passé en autogestion, conditions de l'arbitrage plus remplies, ou il devient joueur du match avant son lancement)",
        "On Discord: team names, scores, tournament names, match times and rounds — no player username (“a player”, including in solo tournaments) and no staff member or caster named (“the staff”, “a caster”; reason for a caster's automatic removal — they no longer meet the casting requirements, or they now play in the match; “a staff member who plays in this match”, with the tournament name only, for a dispute settled, a result corrected, a withdrawal imposed or an automatic confirmation paused by them; reason for the removal of a match's assigned referee — removed by the staff, match assigned to another referee or switched to self-management, refereeing requirements no longer met, or they become a player of the match before its launch)"),
      frEn("Dans les journaux du serveur : pseudo et identifiant du membre du staff auteur d'un geste d'arbitrage, avec le geste (numéro du match ; pour un arbitre qui joue le match, en plus : tournoi, manche et, sauf pour une suspension, issue et noms d'équipe, aucun en tournoi individuel) ; pour une opposition d'arbitre retenue ou levée, l'identifiant du compte de l'arbitre (retenue, avec le nombre de matchs dont il est retiré) ; et, quand une ligne du journal du staff n'a pu être rédigée, le geste et le numéro du match ou du tournoi, sans auteur",
        "In the server logs: username and identifier of the staff member who carried out a refereeing action, with the action (match number; for a referee who plays in the match, also: tournament, round and, except for a pause, outcome and team names, none in a solo tournament); for a referee's objection upheld or lifted, the referee's account identifier (when upheld, with the number of matches they are removed from); and, when a staff log line could not be composed, the action and the match or tournament number, without its author"),
      frEn("Dans les journaux du serveur, pour un rôle de plateforme attribué ou retiré : pseudo et identifiant de l'administrateur auteur, identifiant du compte visé (« son propre compte » quand c'est le sien) et rôles enregistrés",
        "In the server logs, for a platform role granted or removed: username and identifier of the administrator who did it, identifier of the account concerned (“their own account” when it is theirs) and roles saved"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Messages Discord : conservés dans un salon réservé au staff, purgé à la main par l'association et par le bot au bout de ${BOT_STAFF_LOG_RETENTION_DAYS} jours (un an), par lots — plusieurs nuits pour un arriéré important (traitement T08)`,
        `Discord messages: kept in a staff-only channel, purged manually by the association and by the bot after ${BOT_STAFF_LOG_RETENTION_DAYS} days (one year), in batches — several nights for a large backlog (processing activity T08)`),
      frEn("Journaux du serveur : selon leur rotation automatique",
        "Server logs: according to their automatic rotation"),
    ],
    recipients: [
      frEn("Staff de l'association ayant accès au salon",
        "The association's staff with access to the channel"),
      frEn("Discord (hébergement du salon)", "Discord (hosting of the channel)"),
      frEn("Responsable technique (journaux du serveur)", "Technical manager (server logs)"),
    ],
    transfers: [
      frEn(`États-Unis : Discord — ${transferBasis(["DISCORD"])}`,
        `United States: Discord — ${transferBasisEn(["DISCORD"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Salon privé, accès restreint par rôle Discord",
        "Private channel, access restricted by Discord role"),
    ],
  },
  T06: {
    name: frEn("Mesure d'audience du site", "Site audience measurement"),
    purpose: frEn("Connaître la fréquentation du site", "Knowing how much the site is visited"),
    subPurposes: [
      frEn(`Compter visites (24 h, 7 jours, 30 jours, total) et visiteurs uniques (24 h, 7 jours, 30 jours, ${SITE_VISITOR_RETENTION_MONTHS} mois)`,
        `Counting visits (24 h, 7 days, 30 days, total) and unique visitors (24 h, 7 days, 30 days, ${SITE_VISITOR_RETENTION_MONTHS} months)`),
    ],
    legalBasis: frEn("Intérêt légitime (art. 6.1.f RGPD : connaître la fréquentation du site), sans cookie de mesure ni traceur tiers ; droit d'opposition (art. 21) appliqué par le site lui-même — signaux Global Privacy Control et Do Not Track du navigateur, ou bouton d'opposition de /rgpd#audience (cookie bg_audience_optout, sans identifiant) : une visite refusée n'est pas enregistrée, le serveur relisant ces signaux, et n'est pas même transmise quand le navigateur les expose à la page. Pour les visites déjà enregistrées, le droit s'exerce comme les autres droits : auprès de la personne à contacter pour les demandes relatives aux données, par le formulaire de signalement, catégorie RGPD, ou auprès de l'association",
      "Legitimate interest (art. 6.1.f GDPR: knowing how much the site is visited), without a measurement cookie or third-party tracker; right to object (art. 21) applied by the site itself — the browser's Global Privacy Control and Do Not Track signals, or the objection button of the privacy policy (“Audience measurement” section; bg_audience_optout cookie, without identifier): a refused visit is not recorded, as the server reads these signals itself, and is not even sent when the browser exposes them to the page. For visits already recorded, the right is exercised like the other rights: with the person to contact for requests regarding data, through the report form, “GDPR” category, or with the association"),
    dataSubjects: [
      frEn("Visiteurs du site", "Visitors of the site"),
    ],
    dataCategories: [
      frEn("Empreinte salée par un secret du serveur (SHA-256), dérivée du compte ou de l'adresse IP et du navigateur : donnée pseudonymisée — sans le secret, elle ne se rattache à personne, mais l'association, qui le détient, peut recalculer l'empreinte d'un compte ou d'un couple IP et navigateur",
        "Hash salted with a server secret (SHA-256), derived from the account or from the IP address and the browser: pseudonymized data — without the secret, it cannot be linked to anyone, but the association, which holds it, can recompute the hash of an account or of an IP address and browser pair"),
      frEn("Page consultée (sans paramètres d'URL), date",
        "Page viewed (without URL parameters), date"),
      frEn("Indicateur « visiteur connecté » (oui / non), sans le compte concerné",
        "“Logged-in visitor” indicator (yes / no), without the account concerned"),
      frEn(`Plusieurs chargements d'un même visiteur en ${SITE_VISIT_WINDOW_MINUTES} minutes ne comptent qu'une visite`,
        `Several loads by the same visitor within ${SITE_VISIT_WINDOW_MINUTES} minutes count as a single visit`),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Détail des visites (empreinte, page, date) effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours, après report dans un compteur par jour qui ne garde que le nombre de visites`,
        `Visit details (hash, page, date) erased after ${SITE_VISIT_DETAIL_RETENTION_DAYS} days, after being added to a daily counter that only keeps the number of visits`),
      frEn(`Une empreinte par visiteur, sans page mais avec l'indicateur « visiteur connecté » et la date de la dernière visite, effacée ${SITE_VISITOR_RETENTION_MONTHS} mois après cette dernière visite (y compris après la suppression du compte, qui ne l'efface pas plus tôt) ; les empreintes antérieures à cette règle sont datées de sa mise en place`,
        `One hash per visitor, without page but with the “logged-in visitor” indicator and the date of the last visit, erased ${SITE_VISITOR_RETENTION_MONTHS} months after that last visit (including after the account is deleted, which does not erase it sooner); hashes prior to this rule are dated from when it was introduced`),
      frEn("Adresse IP, navigateur et identifiant du compte jamais enregistrés tels quels",
        "IP address, browser and account identifier never recorded as such"),
    ],
    recipients: [
      frEn("Staff de l'association", "The association's staff"),
      frEn("Tout membre d'un serveur Discord où le bot est installé, pour les seuls totaux (visites et visiteurs), par la commande publique /stats-site",
        "Any member of a Discord server where the bot is installed, for the totals only (visits and visitors), through the public /stats-site command"),
    ],
    transfers: [
      frEn("Aucun", "None"),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Aucun cookie de mesure — une seule valeur de stockage de session (bg:last-visit-ping), jamais transmise, évite de signaler deux fois un même chargement ; le secret de salage n'est ni en base ni dans les sauvegardes, et sans lui aucune visite n'est comptée",
        "No measurement cookie — a single session storage value (bg:last-visit-ping), never sent, avoids reporting the same load twice; the salting secret is neither in the database nor in the backups, and without it no visit is counted"),
      frEn("Opposition relue côté serveur (en-têtes Sec-GPC et DNT, cookie d'opposition) : une visite refusée n'est ni hachée, ni décomptée du plafond de débit, ni écrite",
        "Objection read again on the server side (Sec-GPC and DNT headers, objection cookie): a refused visit is neither hashed, nor counted against the rate limit, nor written"),
    ],
  },
  T07: {
    name: frEn("Présentation de l'association et recrutement de bénévoles",
      "Presenting the association and recruiting volunteers"),
    purpose: frEn("Présenter le bureau et les bénévoles, et recruter",
      "Presenting the board and the volunteers, and recruiting"),
    subPurposes: [
      frEn("Page « Association » : membres du bureau et bénévoles",
        "“Association” page: board members and volunteers"),
      frEn("Annonces de recrutement avec un contact Discord ou un lien",
        "Recruitment announcements with a Discord contact or a link"),
    ],
    legalBasis: frEn("Consentement des bénévoles et membres du bureau concernés",
      "Consent of the volunteers and board members concerned"),
    dataSubjects: [
      frEn("Membres du bureau", "Board members"),
      frEn("Bénévoles", "Volunteers"),
      frEn("Auteurs d'annonces de recrutement", "Authors of recruitment announcements"),
    ],
    dataCategories: [
      frEn("Nom, prénom et pseudo, catégorie ou fonction, date d'arrivée, photo",
        "Last name, first name and username, category or position, date of joining, photo"),
      frEn("Pseudo et identifiant Discord ou lien de contact d'une annonce",
        "Discord username and identifier or contact link of an announcement"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Durée de l'engagement dans l'association, ou de publication de l'annonce",
        "Duration of involvement in the association, or of publication of the announcement"),
    ],
    recipients: [
      frEn("Public du site", "The site's public"),
    ],
    transfers: [
      frEn("Aucun", "None"),
    ],
    security: COMMON_SECURITY,
  },
  T08: {
    name: frEn("Bot Discord BlueGenji", "BlueGenji Discord bot"),
    purpose: frEn("Fournir les services du bot sur les serveurs Discord partenaires",
      "Providing the bot's services on partner Discord servers"),
    subPurposes: [
      frEn("Relais des annonces entre les salons des serveurs partenaires, répercussion des modifications et suppressions, temps de recharge, compteur de messages de /stats, statistiques du tableau de bord, retrait des copies d'un utilisateur exclu",
        "Relaying announcements between the channels of partner servers, passing on edits and deletions, cooldowns, /stats message counter, dashboard statistics, removal of the copies of an excluded user"),
      frEn("Exclusion d'un utilisateur du relais par la modération — valable pour tout le réseau de serveurs partenaires (modération communautaire), d'où la liste des exclusions ouverte aux administrateurs de chaque serveur",
        "Exclusion of a user from the relay by moderation — valid for the whole network of partner servers (community moderation), hence the list of exclusions open to the administrators of each server"),
      frEn("Statistiques d'activité (commande /stats, qui ne montre à chacun que sa propre activité ; tableau de bord du bot)",
        "Activity statistics (/stats command, which shows each person only their own activity; the bot's dashboard)"),
      frEn("Confirmation des adhésions à l'association et rappels programmés sur ses serveurs",
        "Confirming memberships of the association and scheduled reminders on its servers"),
      frEn("Remise des messages du site : codes (rédigés par le bot dans la langue du compte que le site lui transmet), horaires et rappels de match, avis de retrait d'un match (« Match retiré »), check-in d'un match en autogestion envoyé à ceux qui gèrent ses engagées (ou au joueur d'une entrée individuelle), annonce d'un nouveau match aux membres de ses deux équipes (ou au joueur d'une entrée individuelle) et avis envoyé à un caster dont l'inscription est retirée par un autre que lui (ces messages de match aux seuls tags Discord certifiés), avis de modération (signalement désignant la personne, logo masqué, retiré ou supprimé, avatar masqué, retiré ou rétabli, suspension du compte et sa levée), demandes d'adhésion à une équipe, invitations d'équipe, reprises d'équipe proposées, propriétés d'équipe transférées et informations sur les données en message privé, sans conservation par le bot ; alertes d'arbitrage, signalements et journal d'activité du site (sans pseudo de joueur) publiés au salon de journal privé du staff, alertes d'arbitrage aussi envoyées aux membres du rôle d'arbitrage de chaque serveur qui en a défini un ; annonce des matchs diffusés publiée dans le salon #live du serveur de l'association, en un message par soirée modifié à chaque début et fin de match, avec une mention @everyone pour la chaîne officielle ou du seul rôle StreamViewer pour toute autre chaîne (noms d'équipe ou, en tournoi individuel, pseudo public BlueGenji des joueurs — traitement T16)",
        "Delivering the site's messages: codes (written by the bot in the account language the site sends it), match times and reminders, notices of removal from a match (“Match retiré”), the check-in of a self-managed match sent to those who manage its entrants (or to the player of a solo entry), the announcement of a new match to the members of both its teams (or to the player of a solo entry) and the notice sent to a caster whose registration for a match is removed by someone else (these match messages to certified Discord tags only), moderation notices (report naming the person, logo hidden, removed or deleted, avatar hidden, removed or restored, suspension of the account and its lifting), requests to join a team, team invitations, offered team takeovers, transferred team ownerships and information about data by direct message, without being kept by the bot; refereeing alerts, reports and the site's activity log (without player usernames) posted in the staff's private log channel, refereeing alerts also sent to the members of the refereeing role of each server that has set one; announcement of the streamed matches posted in the #live channel of the association's server, in one message per evening edited at each match start and end, with an @everyone mention for the official channel or a mention of the StreamViewer role only for any other channel (team names or, in a solo tournament, the players' public BlueGenji username — processing activity T16)"),
      frEn("Salons vocaux d'équipe des matchs, dans les tournois qui en ont l'option : création au nom de l'équipe et suppression ; pour savoir si un salon est vide, présence vocale des membres du serveur de l'association tenue en mémoire seulement (traitement T18, qui en donne les données et les durées)",
        "Team voice channels for matches, in tournaments with that option: creation named after the team and deletion; to know whether a channel is empty, voice presence of the members of the association's server held in memory only (processing activity T18, which gives its data and periods)"),
    ],
    legalBasis: frEn("Intérêt légitime (faire fonctionner, modérer et mesurer le relais entre serveurs partenaires) ; les messages du site relèvent de la base de leur traitement d'origine ; les salons vocaux d'équipe relèvent de T18",
      "Legitimate interest (operating, moderating and measuring the relay between partner servers); the site's messages fall under the basis of their original processing; team voice channels fall under T18"),
    dataSubjects: [
      frEn("Utilisateurs Discord des serveurs où le bot est installé",
        "Discord users of the servers where the bot is installed"),
      frEn("Administrateurs et modérateurs de ces serveurs",
        "Administrators and moderators of these servers"),
      frEn("Adhérents de l'association dont l'adhésion est confirmée par le bot",
        "Members of the association whose membership is confirmed by the bot"),
    ],
    dataCategories: [
      frEn("Annonces relayées : identifiants du message d'origine et de son auteur, date, identifiants des copies et de leurs salons (contenu recopié dans les salons partenaires, jamais enregistré en base)",
        "Relayed announcements: identifiers of the original message and its author, date, identifiers of the copies and their channels (content copied into partner channels, never recorded in the database)"),
      frEn(`Scrims et recrutement : identifiant de l'auteur, jeu, niveau ou rôle (choisi dans une liste fermée ; texte libre pour les annonces antérieures à cette règle, gardé aussi dans les nombres par jour), serveur, date ; au-delà de ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} jours, seulement des nombres par jour, serveur et niveau ou rôle`,
        `Scrims and recruitment: author's identifier, game, level or role (chosen from a closed list; free text for announcements prior to this rule, also kept in the daily counts), server, date; beyond ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} days, only counts per day, server and level or role`),
      frEn("Fil d'activité public de la page du bot : heure, type d'évènement (relais, scrim, recrutement, connexion), nom du serveur, niveau ou rôle — sans identifiant Discord",
        "Public activity feed on the bot's page: time, type of event (relay, scrim, recruitment, login), server name, level or role — without Discord identifier"),
      frEn("Exclusions : identifiants de l'exclu et du modérateur, date ; identifiants et motif publiés au salon de journal privé du staff, motif copié en message privé au titulaire du bot, pseudos et motif affichés par /ban-list",
        "Exclusions: identifiers of the excluded user and the moderator, date; identifiers and reason posted in the staff's private log channel, reason copied by direct message to the bot's owner, usernames and reason displayed by /ban-list"),
      frEn("Configuration : identifiants de serveurs, salons et rôles, invitation, identifiant de l'administrateur qui l'a posée",
        "Configuration: identifiers of servers, channels and roles, invitation, identifier of the administrator who set it"),
      frEn("Adhésions et rappels programmés : identifiant du membre ou du rôle visé et de l'auteur, message, date du prochain envoi (pour une adhésion : sa date de péremption, donc la qualité d'adhérent), fréquence ; attestation d'adhésion remise en message privé sans être conservée",
        "Memberships and scheduled reminders: identifier of the member or role targeted and of the author, message, date of the next sending (for a membership: its expiry date, hence membership status), frequency; membership certificate delivered by direct message without being kept"),
      frEn("Messages du site : identifiant ou pseudo Discord du destinataire, son pseudo BlueGenji (repris dans le bilan de remise rendu au site), le texte du message et, pour le seul code envoyé en message privé (connexion, certification ou changement du tag), la langue du compte du site rattaché à ce compte Discord (dans laquelle le bot rédige le code), transmis par le site et remis sans être enregistrés par le bot ; l'annonce #live, elle, reste publiée dans le salon (traitement T16)",
        "Site messages: the recipient's Discord ID or username, their BlueGenji username (returned in the delivery report sent back to the site), the message text and, for the code sent by direct message only (login, certification or change of the tag), the language of the site account linked to that Discord account (in which the bot writes the code), sent by the site and delivered without being stored by the bot; the #live announcement, however, stays posted in the channel (processing activity T16)"),
      frEn("Journal technique (salon privé du staff, journaux du serveur) : nom des serveurs qui ajoutent ou retirent le bot, erreurs pouvant citer un identifiant ; le bot n'y écrit plus de pseudo de lui-même, messages antérieurs à cette règle exceptés (le motif libre d'une exclusion ou une erreur de remise d'un message privé peuvent en citer un)",
        "Technical log (staff's private channel, server logs): name of the servers that add or remove the bot, errors that may quote an identifier; the bot no longer writes a username there of its own accord, messages prior to this rule excepted (the free-text reason for an exclusion or an error delivering a direct message may quote one)"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Suivi des annonces relayées : ${BOT_RELAY_RETENTION_DAYS} jours, effacé au relais suivant cette échéance et au plus tard dans la nuit ou au redémarrage du bot ; les copies publiées dans les salons partenaires restent sur Discord jusqu'à leur suppression (par l'auteur dans ce délai, ensuite par les administrateurs de chaque serveur)`,
        `Tracking of relayed announcements: ${BOT_RELAY_RETENTION_DAYS} days, erased at the first relay after that deadline and at the latest during the night or when the bot restarts; the copies posted in partner channels remain on Discord until they are deleted (by the author within that period, afterwards by the administrators of each server)`),
      frEn(`Scrims et recrutement : ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} jours ; ensuite, dans la nuit qui suit (ou à un redémarrage), identifiant de l'auteur effacé et lignes repliées en nombres par jour, serveur et niveau ou rôle, gardés sans limite de durée comme historique de l'activité du bot`,
        `Scrims and recruitment: ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} days; then, during the following night (or at a restart), author's identifier erased and rows collapsed into counts per day, server and level or role, kept with no time limit as a history of the bot's activity`),
      frEn("Exclusions : enregistrement jusqu'à la levée de l'exclusion ; son avis et son motif (salon de journal privé du staff, et motif copié en message privé au titulaire du bot) sont supprimés à la levée — pour une exclusion antérieure à cette règle, seul le motif publié au salon, le reste suivant la durée du salon de journal",
        "Exclusions: record until the exclusion is lifted; its notice and reason (staff's private log channel, and reason copied by direct message to the bot's owner) are deleted when it is lifted — for an exclusion prior to this rule, only the reason posted in the channel, the rest following the log channel's period"),
      frEn("Configuration (salons relayés et leurs filtres de rang, invitation et rôle d'arbitrage avec l'identifiant de qui les a posés, rôle d'administration du bot, modules) : jusqu'à son retrait par les administrateurs, au plus tard jusqu'au départ du bot du serveur, qui l'efface (un départ survenu pendant une interruption du bot, que Discord ne lui signale pas, est rattrapé à son redémarrage)",
        "Configuration (relayed channels and their rank filters, invitation and refereeing role with the identifier of who set them, bot administration role, modules): until removed by the administrators, at the latest until the bot leaves the server, which erases it (a departure that occurred while the bot was down, which Discord does not report to it, is caught up at its restart)"),
      frEn("Adhésions et rappels programmés : jusqu'au dernier envoi du rappel (pour une adhésion, sa date de péremption) ou sa suppression, au plus tard jusqu'au départ du bot du serveur où ils ont été enregistrés, qui les efface (départ pendant une interruption compris, rattrapé au redémarrage)",
        "Memberships and scheduled reminders: until the reminder's last sending (for a membership, its expiry date) or its deletion, at the latest until the bot leaves the server where they were recorded, which erases them (departure while the bot was down included, caught up at restart)"),
      frEn(`Fil d'activité : ${BOT_FEED_EVENT_RETENTION_DAYS} jours, supprimé dans la nuit qui suit`,
        `Activity feed: ${BOT_FEED_EVENT_RETENTION_DAYS} days, deleted during the following night`),
      frEn(`Salon de journal privé du staff, et messages privés du bot au titulaire : ${BOT_STAFF_LOG_RETENTION_DAYS} jours (un an), puis supprimés par le ménage de nuit, par lots (plusieurs nuits pour un arriéré important), sauf le motif publié au salon d'une exclusion en cours — et, pour une exclusion prononcée à partir de cette règle, son avis et la copie de son motif en message privé —, supprimés à sa levée`,
        `Staff's private log channel, and the bot's direct messages to its owner: ${BOT_STAFF_LOG_RETENTION_DAYS} days (one year), then deleted by the nightly cleanup, in batches (several nights for a large backlog), except the reason posted in the channel for an ongoing exclusion — and, for an exclusion imposed from this rule onward, its notice and the copy of its reason by direct message —, deleted when it is lifted`),
      frEn("Journaux du serveur : selon leur rotation automatique",
        "Server logs: according to their automatic rotation"),
      frEn("Annonces #live : dans le salon tant qu'il existe, même après la suppression du compte du joueur, et supprimées sur demande de l'équipe, du joueur ou du caster concerné (traitement T16)",
        "#live announcements: in the channel as long as it exists, even after the player's account is deleted, and deleted at the request of the team, player or caster concerned (processing activity T16)"),
      frEn("Alerte AutoMod d'une annonce #live bloquée ou signalée : dans le salon d'alertes de modération jusqu'à sa suppression par les modérateurs, même après la suppression du compte du joueur, et supprimée sur demande de l'équipe ou du joueur concerné (traitement T16)",
        "AutoMod alert for a blocked or flagged #live announcement: in the moderation alert channel until the moderators delete it, even after the player's account is deleted, and deleted at the request of the team or player concerned (processing activity T16)"),
      frEn(`Sauvegardes : ${BACKUP_RETENTION_DAYS} jours au plus (traitement T09)`,
        `Backups: ${BACKUP_RETENTION_DAYS} days at most (processing activity T09)`),
    ],
    recipients: [
      frEn("Staff de l'association (modération, administration)",
        "The association's staff (moderation, administration)"),
      frEn("Titulaire du bot (son hébergeur technique), pour les motifs d'exclusion reçus en message privé",
        "The bot's owner (its technical host), for the reasons for exclusion received by direct message"),
      frEn("Utilisateur exclu, qui reçoit le motif de son exclusion en message privé quand il publie une annonce dans un salon relayé",
        "Excluded user, who receives the reason for their exclusion by direct message when they post an announcement in a relayed channel"),
      frEn("Membres du salon où /scrim ou /recrute est utilisée (réponse publique de la commande)",
        "Members of the channel where /scrim or /recrute is used (public reply of the command)"),
      frEn("Membres du rôle d'arbitrage de chaque serveur qui en a défini un (/set-referee-role), pour les alertes d'arbitrage du site",
        "Members of the refereeing role of each server that has set one (/set-referee-role), for the site's refereeing alerts"),
      frEn("Membres des serveurs partenaires, qui lisent les annonces relayées",
        "Members of partner servers, who read the relayed announcements"),
      frEn("Membres du serveur Discord de l'association, qui lisent l'annonce des matchs diffusés dans le salon #live (traitement T16)",
        "Members of the association's Discord server, who read the announcement of streamed matches in the #live channel (processing activity T16)"),
      frEn("Modérateurs du serveur Discord de l'association, si une règle AutoMod de Discord bloque ou signale une annonce #live (traitement T16)",
        "Moderators of the association's Discord server, if a Discord AutoMod rule blocks or flags a #live announcement (processing activity T16)"),
      frEn("Administrateurs de tout serveur où le bot est installé (y compris un serveur créé pour l'y inviter) et titulaires du rôle d'administration du bot (/set-bot-admin), pour la liste des exclusions du réseau (/ban-list, réponse visible du seul demandeur) — l'exclusion vaut pour tout le réseau, chaque serveur doit savoir qui ne peut plus y publier",
        "Administrators of any server where the bot is installed (including a server created to invite it there) and holders of the bot administration role (/set-bot-admin), for the network's list of exclusions (/ban-list, reply visible only to the requester) — the exclusion applies to the whole network, each server must know who can no longer post there"),
      frEn("Discord (plateforme d'exécution)", "Discord (execution platform)"),
    ],
    transfers: [
      frEn(`États-Unis : Discord — ${transferBasis(["DISCORD"])}`,
        `United States: Discord — ${transferBasisEn(["DISCORD"])}`),
    ],
    security: COMMON_SECURITY,
  },
  T09: {
    name: frEn("Sauvegardes", "Backups"),
    purpose: frEn("Reprendre l'activité après une panne, une corruption ou une erreur de manipulation",
      "Resuming activity after an outage, corruption or a handling error"),
    subPurposes: [
      frEn("Archive deux fois par semaine (dimanche et mardi soir) des bases de données du site et du bot",
        "Twice-weekly archive (Sunday and Tuesday evenings) of the site's and the bot's databases"),
      frEn("Copie horaire des images téléversées (avatars, logos, photos)",
        "Hourly copy of uploaded images (avatars, logos, photos)"),
      frEn("Journal des suppressions de compte, rejoué après toute restauration",
        "Log of account deletions, replayed after any restoration"),
    ],
    legalBasis: frEn("Intérêt légitime (continuité du service)", "Legitimate interest (continuity of the service)"),
    dataSubjects: [
      frEn("Toutes les personnes des autres traitements du registre",
        "All the persons of the register's other processing activities"),
    ],
    dataCategories: [
      frEn("Copie de l'ensemble des données ci-dessus", "Copy of all the data above"),
      frEn("Journal des suppressions : identifiant et date de création du compte, date de suppression",
        "Deletion log: account identifier and creation date, date of deletion"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Archives : ${BACKUP_RETENTION_DAYS} jours au plus, puis suppression définitive`,
        `Archives: ${BACKUP_RETENTION_DAYS} days at most, then permanent deletion`),
      frEn("Images : le temps de leur présence sur le site (retirées dans l'heure qui suit leur suppression)",
        "Images: for as long as they are on the site (removed within the hour following their deletion)"),
      frEn(`Journal des suppressions : ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours par entrée`,
        `Deletion log: ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} days per entry`),
      frEn(`Copie de la base du bot écrite à côté d'elle avant une restauration (non chiffrée, sur la machine du bot) : supprimée à la restauration réussie suivante, au plus tard dans la nuit qui suit ses ${BACKUP_RETENTION_DAYS} jours`,
        `Copy of the bot's database written next to it before a restoration (unencrypted, on the bot's machine): deleted at the next successful restoration, at the latest during the night after it turns ${BACKUP_RETENTION_DAYS} days old`),
    ],
    recipients: [
      frEn(`${SITE_HOST.name}, responsable technique de l'association et hébergeur du site (sous-traitant — ${HOST_PROCESSING_AGREEMENT}), seul détenteur des clés de déchiffrement`,
        `${SITE_HOST.name}, the association's technical manager and the site's host (processor — ${HOST_PROCESSING_AGREEMENT_EN}), sole holder of the decryption keys`),
      frEn(`${HETZNER_BACKUP_FRAMEWORK}, qui stocke les copies chiffrées sans pouvoir les lire`,
        `${HETZNER_BACKUP_FRAMEWORK_EN}, which stores the encrypted copies without being able to read them`),
    ],
    // Stockage en Allemagne, traitement exclusivement dans l'UE/EEE (§ 3 du
    // contrat de Hetzner) : aucun transfert hors de l'Union.
    transfers: [
      frEn("Aucun", "None"),
    ],
    security: [
      frEn(`Chiffrement sur le serveur du site avant tout envoi (age pour les archives, remote rclone de type crypt pour les images, les logos masqués et le journal — vérifié en production le 30 septembre 2026, maintenu pour le stockage chez Hetzner) : clés détenues par le seul hébergeur du site, ${SITE_HOST.name}, et jamais transmises à Hetzner`,
        `Encryption on the site's server before any upload (the “age” encryption tool for the archives, an rclone crypt remote for the images, the hidden logos and the log — checked in production on September 30, 2026, maintained for storage with Hetzner): keys held only by the site's host, ${SITE_HOST.name}, and never sent to Hetzner`),
      frEn("Envoi chiffré en transit (HTTPS/TLS)", "Upload encrypted in transit (HTTPS/TLS)"),
      frEn("Suppression définitive, sans corbeille ni historique de versions chez le fournisseur du stockage",
        "Permanent deletion, without trash or version history at the storage provider"),
      frEn("Clé privée des archives conservée hors du serveur ; clé des images et du journal sur le seul serveur, avec une copie de secours hors du serveur",
        "Private key of the archives kept off the server; key of the images and the log on the server only, with a backup copy off the server"),
      frEn("Suppressions de compte rejouées avant toute remise en service après restauration",
        "Account deletions replayed before any return to service after a restoration"),
    ],
  },
  T10: {
    name: frEn("Information des joueurs sur les changements de politique",
      "Informing players of policy changes"),
    purpose: frEn("Informer chaque compte d'un changement du traitement de ses données",
      "Informing each account of a change in the processing of its data"),
    subPurposes: [
      frEn("Présenter à la visite suivante les changements publiés dont le compte n'a pas encore pris connaissance (« J'ai pris connaissance » — aucun accord n'est demandé)",
        "Presenting at the next visit the published changes the account has not yet acknowledged (“I have read this” — no agreement is requested)"),
      frEn("Annoncer chaque changement une fois en message privé Discord aux comptes joignables qui n'en ont pas pris connaissance sur le site, une semaine après sa publication et au plus un message par mois",
        "Announcing each change once by Discord direct message to reachable accounts that have not acknowledged it on the site, one week after its publication and at most one message per month"),
    ],
    legalBasis: frEn("Obligation légale d'information (RGPD, articles 12 à 14)",
      "Legal obligation to inform (GDPR, articles 12 to 14)"),
    dataSubjects: [
      frEn("Joueurs inscrits sur le site", "Players registered on the site"),
    ],
    dataCategories: [
      frEn("Changements dont le compte a pris connaissance, avec la date",
        "Changes acknowledged by the account, with the date"),
      frEn("Annonces Discord déjà envoyées au compte, avec leur date",
        "Discord announcements already sent to the account, with their date"),
      frEn("Identifiant Discord ou pseudo Discord certifié, pour adresser l'annonce",
        "Discord identifier or certified Discord username, to address the announcement"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Durée du compte (effacées avec lui)", "Lifetime of the account (erased with it)"),
    ],
    recipients: [
      frEn("Le joueur lui-même", "The player themselves"),
      frEn("Discord, qui achemine le message privé", "Discord, which delivers the direct message"),
    ],
    transfers: [
      frEn(`États-Unis : Discord (acheminement des messages privés) — ${transferBasis(["DISCORD"])}`,
        `United States: Discord (delivery of direct messages) — ${transferBasisEn(["DISCORD"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Une annonce réservée avant l'envoi, pour qu'aucun compte ne la reçoive deux fois",
        "An announcement reserved before sending, so that no account receives it twice"),
    ],
  },
  T11: {
    name: frEn("Signalements, contestations et modération des contenus et des comptes",
      "Reports, appeals and moderation of content and accounts"),
    purpose: frEn("Recevoir et traiter les signalements adressés à l'association, dont les notifications de contenu illicite",
      "Receiving and handling the reports sent to the association, including notices of illegal content"),
    subPurposes: [
      frEn("Recevoir un signalement de toute personne, avec ou sans compte (droit d'auteur, modération, bug, RGPD, hébergeur, autre)",
        "Receiving a report from anyone, with or without an account (copyright, moderation, bug, GDPR, host, other)"),
      frEn("Prévenir les joueurs et les membres des équipes visés, et leur permettre de contester ; permettre à l'auteur d'un signalement de contester la décision prise",
        "Notifying the players and team members targeted, and allowing them to contest; allowing the author of a report to contest the decision taken"),
      frEn("Masquer un logo d'équipe ou un avatar de joueur signalé, puis le rétablir ou le supprimer définitivement ; retirer une image hors de tout signalement, sur un motif saisi par la modération",
        "Hiding a reported team logo or player avatar, then restoring it or permanently deleting it; removing an image outside any report, on a reason entered by moderation"),
      frEn("Suspendre un compte contraire aux conditions d'utilisation (sessions fermées, connexion refusée pendant la suspension), en exposer les motifs à son titulaire, puis la lever ou la laisser échoir",
        "Suspending an account contrary to the terms of use (sessions closed, login refused during the suspension), giving its holder the reasons, then lifting it or letting it expire"),
      frEn("Accuser réception d'une notification de contenu illicite, puis notifier à son auteur la décision et les voies de recours",
        "Acknowledging receipt of a notice of illegal content, then notifying its author of the decision and the means of redress"),
      frEn("Répondre aux demandes d'exercice des droits et aux demandes adressées à l'hébergeur, dont celles des autorités",
        "Answering requests to exercise rights and requests sent to the hosting provider, including those from authorities"),
      frEn("Recevoir par courriel ou par téléphone, auprès de la personne à contacter pour les demandes relatives aux données, les demandes d'exercice des droits et les questions sur le traitement des données, et y répondre",
        "Receiving by email or by phone, through the person to contact for requests regarding data, requests to exercise rights and questions about data processing, and answering them"),
      frEn("Recevoir les demandes adressées au courriel ou au téléphone de l'association elle-même (publiés, protégés, sur les mentions légales), et y répondre",
        "Receiving the requests sent to the association's own email or phone (published, protected, in the legal notice), and answering them"),
      frEn("Alerter les administrateurs sur Discord, sans donnée nominative",
        "Alerting administrators on Discord, without naming anyone"),
    ],
    legalBasis: frEn("Intérêt légitime (RGPD, art. 6.1.f) de l'association à faire respecter ses conditions d'utilisation pour la modération des contenus et des comptes qui y sont contraires — examen, masquage, retrait d'une image, suspension d'un compte, et conservation de la décision le temps de sa contestation ; obligation légale (RGPD, art. 6.1.c) pour les demandes d'exercice des droits (RGPD, art. 12), les notifications de contenu illicite, en droit d'auteur comme en modération (règlement (UE) 2022/2065, art. 16), les demandes adressées à l'hébergeur (art. 11 et 16) et les contestations (art. 20), sans case d'accord ; consentement du signalant (case à l'envoi) pour les signalements de bug et autres ; par courriel ou par téléphone comme par le formulaire (catégorie RGPD), une demande d'exercice des droits ou une question sur le traitement de ses données — qui relève du droit d'accès (RGPD, art. 15) — repose sur la même obligation légale",
      "Legitimate interest (GDPR, art. 6.1.f) of the association in enforcing its terms of use for the moderation of content and accounts contrary to them — review, hiding, removal of an image, suspension of an account, and keeping the decision while it can be contested; legal obligation (GDPR, art. 6.1.c) for requests to exercise rights (GDPR, art. 12), notices of illegal content, in copyright as in moderation (Regulation (EU) 2022/2065, art. 16), requests sent to the hosting provider (art. 11 and 16) and appeals (art. 20), without an agreement box; consent of the reporter (box when sending) for bug and other reports; by email or by phone as through the form (“GDPR” category), a request to exercise rights or a question about the processing of one's data — which falls under the right of access (GDPR, art. 15) — is based on the same legal obligation"),
    dataSubjects: [
      frEn("Signalants, utilisateurs ou non (titulaires de droits, représentants, visiteurs)",
        "Reporters, users or not (rights holders, representatives, visitors)"),
      frEn("Joueurs et membres des équipes visés par un signalement",
        "Players and team members targeted by a report"),
      frEn("Personnes, membres ou non, qui adressent une demande relative à leurs données par courriel ou par téléphone",
        "Persons, members or not, who send a request regarding their data by email or by phone"),
      frEn("Personnes qui écrivent ou téléphonent à l'association",
        "Persons who write to or phone the association"),
    ],
    dataCategories: [
      frEn("Catégorie, description, éléments désignés et page d'origine du signalement",
        "Category, description, items designated and page the report came from"),
      frEn(`Compte du signalant s'il est connecté ; adresse électronique qu'il indique ; en droit d'auteur, ${copyrightNoticeElementsText()}`,
        `Reporter's account if logged in; email address they provide; for copyright, ${copyrightNoticeElementsTextEn()}`),
      frEn("Contestations : texte, compte de leur auteur et adresse facultative",
        "Appeals: text, account of their author and optional address"),
      frEn("Logos d'équipe et avatars de joueur masqués (fichier conservé hors ligne), date du masquage et de l'échéance ; motif d'un retrait décidé hors signalement (transmis à l'équipe ou au joueur, non conservé par le site) ; sur la décision de suppression d'un avatar, son empreinte (SHA-256) et l'issue de la contestation (maintenue ou acceptée), liées au compte tant qu'il existe ; sur la décision de masquage ou de suppression d'un logo d'équipe, l'issue de la contestation (maintenue ou acceptée) ; l'empreinte reste en outre, sans lien avec aucun compte et sans limite de durée, dans la liste des images bloquées, pour en refuser la remise en ligne (décrite au registre T01)",
        "Hidden team logos and player avatars (file kept offline), date of hiding and of the deadline; reason for a removal decided outside a report (sent to the team or the player, not kept by the site); on the decision deleting an avatar, its hash (SHA-256) and the outcome of the challenge (upheld or accepted), linked to the account as long as it exists; on the decision hiding or deleting a team logo, the outcome of the challenge (upheld or accepted); the hash also stays, with no link to any account and without time limit, in the list of blocked images, to refuse it being uploaded again (described in record T01)"),
      frEn("Suspensions de compte : compte visé, faits retenus, clause invoquée, dates de début, d'échéance et de levée, membre de la modération qui l'a prononcée ou levée",
        "Account suspensions: account targeted, facts relied on, clause invoked, dates of start, expiry and lifting, moderation member who imposed or lifted it"),
      frEn("Demandes relatives aux données reçues par courriel ou par téléphone : contenu de la demande et de la réponse, adresse électronique ou numéro de l'expéditeur, et souvent son nom",
        "Requests regarding data received by email or by phone: content of the request and of the reply, sender's email address or number, and often their name"),
      frEn("Demandes reçues au courriel ou au téléphone de l'association : mêmes données",
        "Requests received at the association's email or phone: same data"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Signalement et contestations : durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après l'archivage (${LOGO_QUARANTINE_MONTHS} mois civils pour un signalement de droit d'auteur ou de modération envoyé depuis un compte, délai de contestation de son auteur) — prolongée tant qu'un logo ou un avatar masqué ou supprimé au titre du signalement peut encore être contesté (${LOGO_QUARANTINE_MONTHS} mois au plus après la décision)`,
        `Report and appeals: duration of handling, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after archiving (${LOGO_QUARANTINE_MONTHS} calendar months for a copyright or moderation report sent from an account, its author's period for contesting) — extended as long as a logo or avatar hidden or deleted on the basis of the report can still be contested (${LOGO_QUARANTINE_MONTHS} months at most after the decision)`),
      frEn(`Demande reçue par courriel ou par téléphone : même règle qu'une demande RGPD faite depuis le formulaire — durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après la clôture de la demande (l'équivalent de l'archivage d'un signalement), avant suppression de la messagerie de la personne à contacter (courriel) ou de son téléphone (SMS reçus et envoyés, messagerie vocale, journal d'appels)`,
        `Request received by email or by phone: same rule as a GDPR request made through the form — duration of handling, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after the request is closed (the equivalent of archiving a report), before deletion from the mailbox of the person to contact (email) or from their phone (texts received and sent, voicemail, call log)`),
      frEn(`Demande reçue au courriel ou au téléphone de l'association : même règle — durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa clôture, avant suppression de la messagerie ou du téléphone de l'association`,
        `Request received at the association's email or phone: same rule — duration of handling, then ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} days after it is closed, before deletion from the association's mailbox or phone`),
      frEn(`Logo ou avatar masqué : ${LOGO_QUARANTINE_MONTHS} mois au plus sans contestation (délai de contestation de l'art. 20.1 du règlement (UE) 2022/2065, que l'association applique), puis suppression définitive ; contesté, jusqu'à la décision`,
        `Hidden logo or avatar: ${LOGO_QUARANTINE_MONTHS} months at most without a challenge (period for contesting of art. 20.1 of Regulation (EU) 2022/2065, which the association applies), then permanent deletion; if contested, until the decision`),
      frEn("Décision de suppression d'un avatar (empreinte, issue de la contestation) : tant que le compte existe, anonymisé compris ; effacée avec le compte, l'empreinte ne restant que dans la liste des images bloquées (registre T01)",
        "Decision deleting an avatar (hash, outcome of the challenge): as long as the account exists, anonymized included; erased with the account, the hash only staying in the list of blocked images (record T01)"),
      frEn(`Suspension de compte : tant qu'elle court, puis ${SUSPENSION_RETENTION_MONTHS} mois après sa levée ou son échéance (même délai de contestation), effacée lors de la première connexion au site qui suit ce délai ; effacée avec le compte, ou à son anonymisation`,
        `Account suspension: while it runs, then ${SUSPENSION_RETENTION_MONTHS} months after it is lifted or expires (same period for contesting), erased at the first login to the site after that period; erased with the account, or when it is anonymized`),
    ],
    recipients: [
      frEn("Administrateurs de l'association", "The association's administrators"),
      frEn("Joueurs et membres des équipes visés : motif et description du signalement, jamais l'identité du signalant",
        "Players and team members targeted: reason and description of the report, never the reporter's identity"),
      frEn("Titulaire d'un compte suspendu : la décision, les faits retenus et la clause invoquée, jamais le nom du membre de la modération qui l'a prononcée",
        "Holder of a suspended account: the decision, the facts relied on and the clause invoked, never the name of the moderation member who imposed it"),
      frEn("Discord, qui achemine les alertes et les messages privés (sans nom, adresse ni description)",
        "Discord, which delivers the alerts and direct messages (without name, address or description)"),
      frEn(`${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE}, personne chargée par l'association des demandes relatives aux données : demandes reçues par courriel ou par téléphone`,
        `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE_EN}, the person appointed by the association for requests regarding data: requests received by email or by phone`),
      frEn("Opérateur téléphonique de cette personne : demandes faites par téléphone (appel, SMS, messagerie vocale)",
        "That person's telephone operator: requests made by phone (call, text, voicemail)"),
      frEn(`Microsoft, qui héberge la messagerie de cette personne (${OUTLOOK_MAIL_FRAMEWORK}) : demandes reçues et réponses envoyées par courriel`,
        `Microsoft, which hosts that person's mailbox (${OUTLOOK_MAIL_FRAMEWORK_EN}): requests received and replies sent by email`),
      frEn("Membres du bureau de l'association qui relèvent son courriel et son téléphone",
        "Members of the association's board who check its email and phone"),
      frEn(`Google (${ASSOCIATION_GMAIL_FRAMEWORK}) : demandes reçues et réponses envoyées par le courriel de l'association`,
        `Google (${ASSOCIATION_GMAIL_FRAMEWORK_EN}): requests received and replies sent by the association's email`),
      frEn("Opérateur téléphonique de la ligne de l'association : demandes faites à son téléphone",
        "Telephone operator of the association's line: requests made to its phone"),
    ],
    transfers: [
      frEn(`États-Unis : Discord (acheminement des alertes et des messages privés) — ${transferBasis(["DISCORD"])}`,
        `United States: Discord (delivery of alerts and direct messages) — ${transferBasisEn(["DISCORD"])}`),
      frEn(`Possibles vers les États-Unis : Microsoft (messagerie Outlook.com de la personne à contacter, demandes reçues et réponses envoyées par courriel) — ${transferBasis(["MICROSOFT"])}`,
        `Possible to the United States: Microsoft (Outlook.com mailbox of the person to contact, requests received and replies sent by email) — ${transferBasisEn(["MICROSOFT"])}`),
      frEn(`Possibles vers les États-Unis : Google (messagerie Gmail de l'association) — ${transferBasis(["GOOGLE"])}`,
        `Possible to the United States: Google (the association's Gmail mailbox) — ${transferBasisEn(["GOOGLE"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Panneau de traitement réservé aux administrateurs ; page d'un signalement ouverte aux seules personnes visées",
        "Handling panel restricted to administrators; a report's page open only to the persons targeted"),
      frEn("Plafonds d'envoi par personne et par heure", "Sending limits per person and per hour"),
      frEn("Logo ou avatar masqué déplacé hors du dossier servi par le site ; aperçu réservé aux administrateurs",
        "Hidden logo or avatar moved out of the folder served by the site; preview restricted to administrators"),
      frEn("Suspension réservée à la permission de modération, impossible sur son propre compte ou sur celui d'un administrateur ; le journal Discord du staff n'en porte ni le pseudo du joueur ni le motif",
        "Suspension restricted to the moderation permission, impossible on one's own account or on an administrator's; the staff's Discord log carries neither the player's username nor the reason"),
      frEn("Demandes reçues par courriel ou par téléphone : aucune mesure propre à l'association au-delà de la suppression après la durée de conservation ; elles ne sont protégées que par les mesures de Microsoft ou de Google (messageries), des opérateurs téléphoniques et des appareils qui les reçoivent",
        "Requests received by email or by phone: no measure specific to the association beyond deletion after the retention period; they are protected only by the measures of Microsoft or Google (mailboxes), the telephone operators and the devices that receive them"),
    ],
  },
  T12: {
    name: frEn("Notifications push", "Push notifications"),
    purpose: frEn("Prévenir un joueur sur ses appareils, à sa demande, de ce qui le concerne sur le site",
      "Notifying a player on their devices, at their request, of what concerns them on the site"),
    subPurposes: [
      frEn("Check-in de ses matchs en autogestion, pour le propriétaire et les managers d'une engagée (ou le joueur d'un tournoi individuel)",
        "Check-in of their self-managed matches, for the owner and managers of an entrant (or the player of a solo tournament)"),
      frEn("Départ de ses matchs (et, pour un caster inscrit, du match qu'il caste), score à confirmer ou validé automatiquement faute de réponse, coup d'envoi d'un tournoi, nouveau match dont les deux adversaires viennent d'être connus, horaires de match (posés, changés ou retirés) et rappels de match",
        "Start of their matches (and, for a registered caster, of the match they cast), score to confirm or confirmed automatically without an answer, tournament kickoff, new match whose two opponents have just become known, match times (set, changed or removed) and match reminders"),
      frEn("Demandes d'adhésion à une équipe qu'il gère, signalements et décisions de modération le concernant, changements de la politique de données",
        "Requests to join a team they manage, reports and moderation decisions concerning them, changes to the data policy"),
      frEn("Invitation d'une équipe, reprise d'une équipe fantôme proposée par le staff, propriété de son équipe qui lui est transférée (nom de l'équipe seul)",
        "A team's invitation, takeover of a ghost team offered by the staff, ownership of their team transferred to them (team name only)"),
      frEn("Alertes d'arbitrage, litiges tranchés, résultats corrigés, abandons imposés à l'adversaire ou validations automatiques suspendues par un membre du staff qui joue le match, matchs planifiés, programme d'arbitrage et alertes de modération pour le staff qui détient ces rôles",
        "Referee alerts, disputes settled, results corrected, opponents' withdrawals imposed or automatic confirmations paused by a staff member who plays in the match, scheduled matches, refereeing schedule and moderation alerts for the staff holding these roles"),
      frEn("Retrait de son inscription de caster sur un match (par le staff ou d'office), avec le motif, pour le caster qui détient encore la permission de diffusion",
        "Removal of their caster registration for a match (by the staff or automatically), with the reason, for the caster who still holds the streaming permission"),
      frEn("Retrait de son arbitrage d'un match (par le staff, match confié à un autre arbitre ou passé en autogestion, ou d'office), avec le motif, pour l'arbitre désigné qui détient encore la permission d'arbitrage",
        "Removal of their refereeing of a match (by the staff, match assigned to another referee or switched to self-management, or automatically), with the reason, for the assigned referee who still holds the refereeing permission"),
    ],
    legalBasis: frEn("Consentement (activation sur chaque appareil, retirable à tout moment, sujet par sujet ; un sujet ajouté depuis l'abonnement, comme « Nouveau match », est actif d'office sur un appareil déjà abonné, ce que la politique de données annonce, et se coupe de même)",
      "Consent (activation on each device, withdrawable at any time, topic by topic; a topic added since the subscription, such as “New match”, is on by default on a device already subscribed, which the data policy announces, and is turned off the same way)"),
    dataSubjects: [
      frEn("Joueurs inscrits qui activent les notifications sur un appareil",
        "Registered players who turn on notifications on a device"),
    ],
    dataCategories: [
      frEn("Adresse d'abonnement de l'appareil, fournie par le navigateur, et ses clés de chiffrement",
        "The device's subscription address, provided by the browser, and its encryption keys"),
      frEn("Date d'abonnement et de la dernière notification remise",
        "Date of subscription and of the last notification delivered"),
      frEn("Sujets de notification coupés par le compte",
        "Notification topics turned off by the account"),
      frEn("Langue du compte (T01), dans laquelle la notification est rédigée",
        "Account language (T01), in which the notification is written"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Abonnement : jusqu'à sa désactivation, sa révocation par le navigateur, ou la suppression du compte",
        "Subscription: until it is turned off, revoked by the browser, or the account is deleted"),
      frEn(`Abonnement resté sans notification remise : ${PUSH_SUBSCRIPTION_RETENTION_DAYS} jours au plus`,
        `Subscription with no notification delivered: ${PUSH_SUBSCRIPTION_RETENTION_DAYS} days at most`),
      frEn("Sujets coupés : durée du compte", "Topics turned off: lifetime of the account"),
    ],
    recipients: [
      frEn("Le joueur lui-même", "The player themselves"),
      frEn("Le service de push de son navigateur (Google, Mozilla, Apple ou Microsoft), qui achemine un message chiffré qu'il ne peut pas lire",
        "Their browser's push service (Google, Mozilla, Apple or Microsoft), which delivers an encrypted message it cannot read"),
    ],
    transfers: [
      frEn(`États-Unis : service de push du navigateur choisi par le joueur, qui ne reçoit que des messages chiffrés de bout en bout (RFC 8291) — ${transferBasis(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])}`,
        `United States: push service of the browser chosen by the player, which only receives end-to-end encrypted messages (RFC 8291) — ${transferBasisEn(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Contenu chiffré pour le seul appareil abonné ; envois signés par la clé du site (VAPID)",
        "Content encrypted for the subscribed device only; sendings signed by the site's key (VAPID)"),
      frEn("Aucun pseudo de joueur dans une notification", "No player username in a notification"),
      frEn("Services de push acceptés limités à ceux des navigateurs du marché",
        "Accepted push services limited to those of the browsers on the market"),
    ],
  },
  T13: {
    name: frEn("Acceptation des conditions d'utilisation", "Acceptance of the terms of use"),
    purpose: frEn("Garder la preuve que les conditions d'utilisation du site ont été acceptées, et laquelle de leurs versions",
      "Keeping proof that the site's terms of use have been accepted, and which version of them"),
    subPurposes: [
      frEn("Recueillir l'acceptation à la création du compte, à la création d'une équipe, en recevant la gestion d'une équipe, dans la fenêtre d'acceptation présentée à tout compte connecté qui n'a pas accepté la version en vigueur (depuis la version 6) et à une connexion lancée depuis la page de connexion (clic sur Google, Discord ou Blizzard, ou envoi du code reçu sur Discord) dans les dix minutes où les conditions y ont été acceptées (une acceptation seulement gardée par le navigateur n'est pas reportée sur un compte existant)",
        "Collecting acceptance when the account is created, when a team is created, when the management of a team is received, in the acceptance window shown to any logged-in account that has not accepted the version in force (since version 6) and at a login started from the login page (click on Google, Discord or Blizzard, or submission of the code received on Discord) within ten minutes of accepting the terms there (an acceptance only kept by the browser is not carried over to an existing account)"),
      frEn("Redemander l'acceptation quand les conditions changent de version",
        "Asking for acceptance again when the terms change version"),
      frEn("Fixer la base de la présentation d'un arbitre désigné aux parties de ses matchs (registre T04) : l'intérêt légitime tant qu'il n'a pas accepté la version 7 ou une suivante — la version 9 pour son tag Discord certifié —, le contrat ensuite",
        "Setting the basis for presenting an assigned referee to the parties to their matches (record T04): legitimate interest until they have accepted version 7 or a later one — version 9 for their certified Discord tag —, the contract afterwards"),
    ],
    legalBasis: frEn("Exécution du service demandé par le joueur (contrat)",
      "Performance of the service requested by the player (contract)"),
    dataSubjects: [
      frEn("Joueurs inscrits sur le site", "Players registered on the site"),
    ],
    dataCategories: [
      frEn("Version acceptée, contexte de l'acceptation (création du compte, connexion, création ou gestion d'une équipe, fenêtre d'acceptation d'un compte connecté), date",
        "Version accepted, context of the acceptance (account creation, login, team creation or management, acceptance window of a logged-in account), date"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Durée du compte", "Lifetime of the account"),
      frEn("À la suppression : effacement complet, que le compte soit effacé ou anonymisé — le détail des acceptations comme la dernière version acceptée et sa date",
        "On deletion: complete erasure, whether the account is erased or anonymized — the details of the acceptances as well as the last version accepted and its date"),
    ],
    recipients: [
      frEn("Le joueur lui-même, par l'export de ses données",
        "The player themselves, through the export of their data"),
      frEn("Responsable technique de l'association, qui administre la base",
        "The association's technical manager, who administers the database"),
    ],
    transfers: [
      frEn("Aucun", "None"),
    ],
    security: COMMON_SECURITY,
  },
  T14: {
    name: frEn("Journal des données de connexion", "Connection data log"),
    purpose: frEn("Conserver les données permettant d'identifier l'auteur d'un contenu publié par un membre (logo, avatar, nom d'équipe), que l'association héberge",
      "Keeping the data that makes it possible to identify the author of content published by a member (logo, avatar, team name), which the association hosts"),
    subPurposes: [
      frEn("Consigner chaque ouverture de session (adresse IP, date et heure, moyen de connexion)",
        "Recording each login (IP address, date and time, means of logging in)"),
      frEn("Communiquer ces données à une autorité judiciaire qui les requiert, et à elle seule",
        "Disclosing this data to a judicial authority that requests it, and to it alone"),
    ],
    legalBasis: frEn("Obligation légale (RGPD, art. 6.1.c) de l'hébergeur de contenus : LCEN, art. 6 ; décret n° 2021-1362",
      "Legal obligation (GDPR, art. 6.1.c) of the hosting provider of content: French Act on Confidence in the Digital Economy (« loi pour la confiance dans l'économie numérique », LCEN), art. 6; Decree No. 2021-1362"),
    dataSubjects: [
      frEn("Joueurs inscrits sur le site", "Players registered on the site"),
    ],
    dataCategories: [
      frEn("Identifiant interne du compte", "Internal identifier of the account"),
      frEn("Adresse IP de connexion, telle que la retient le serveur mandataire du site",
        "IP address of the login, as retained by the site's proxy server"),
      frEn("Date et heure de la connexion, moyen de connexion (Google, Discord, Blizzard ou code en message privé)",
        "Date and time of the login, means of logging in (Google, Discord, Blizzard or code by direct message)"),
      frEn("Ni port source de la connexion, ni journal de la création ou de la modification des contenus (seules les ouvertures de session sont consignées), ni informations fournies à la création du compte : celles-ci partent avec le compte (hors les copies de sauvegarde chiffrées et le journal des suppressions, T09)",
        "Neither the source port of the connection, nor a log of the creation or modification of content (only logins are recorded), nor the information provided when the account was created: that leaves with the account (apart from the encrypted backup copies and the deletion log, T09)"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`${CONNECTION_LOG_RETENTION_DAYS} jours (un an) après chaque connexion, puis effacement automatique`,
        `${CONNECTION_LOG_RETENTION_DAYS} days (one year) after each login, then automatic erasure`),
      frEn("Gardé jusqu'à cette échéance même après la suppression du compte (RGPD, art. 17.3.b)",
        "Kept until that deadline even after the account is deleted (GDPR, art. 17.3.b)"),
    ],
    recipients: [
      frEn("Autorités judiciaires, sur réquisition", "Judicial authorities, upon requisition"),
      frEn("Le joueur lui-même, par l'export de ses données, tant que son compte existe",
        "The player themselves, through the export of their data, as long as their account exists"),
      frEn("Responsable technique de l'association, qui administre la base et répond aux réquisitions",
        "The association's technical manager, who administers the database and answers judicial requisitions"),
    ],
    transfers: [
      frEn("Aucun", "None"),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Aucun écran ni aucune route du site ne consulte ce journal ; il ne sert à aucune autre finalité",
        "No screen or route of the site consults this log; it serves no other purpose"),
    ],
  },
  T15: {
    name: frEn("Portail de support (Spiceworks)", "Support portal (Spiceworks)"),
    purpose: frEn("Recevoir et traiter les demandes de support et de modération qui ne portent pas sur un contenu du site (comportement en match, insulte, triche, litige sur Discord)",
      "Receiving and handling support and moderation requests that do not concern content on the site (in-match behavior, insults, cheating, dispute on Discord)"),
    subPurposes: [
      frEn("Recevoir un ticket sur le portail de support de l'association, que le site ne fait que lier (aucune donnée n'y est transmise par le site)",
        "Receiving a ticket on the association's support portal, which the site only links to (no data is sent there by the site)"),
      frEn("Échanger avec le demandeur, instruire la demande et la clore",
        "Exchanging with the requester, examining the request and closing it"),
    ],
    legalBasis: frEn("Intérêt légitime (RGPD, art. 6.1.f) de l'association à faire respecter les règles de ses tournois et de sa communauté, et à répondre aux demandes qu'on lui adresse",
      "Legitimate interest (GDPR, art. 6.1.f) of the association in enforcing the rules of its tournaments and its community, and in answering the requests sent to it"),
    dataSubjects: [
      frEn("Demandeurs (joueurs ou non)", "Requesters (players or not)"),
      frEn("Personnes désignées dans un ticket", "Persons named in a ticket"),
    ],
    dataCategories: [
      frEn("Contenu du ticket et des échanges, pièces jointes éventuelles",
        "Content of the ticket and of the exchanges, any attachments"),
      frEn("Coordonnées que le demandeur indique pour recevoir la réponse, pseudos cités",
        "Contact details the requester provides to receive the reply, usernames mentioned"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Ticket : durée de son traitement, puis ${SUPPORT_TICKET_RETENTION_MONTHS} mois après sa clôture, puis suppression par l'association`,
        `Ticket: duration of its handling, then ${monthsEn(SUPPORT_TICKET_RETENTION_MONTHS)} after it is closed, then deletion by the association`),
    ],
    recipients: [
      frEn("Membres du staff de l'association chargés du support et de la modération",
        "Members of the association's staff in charge of support and moderation"),
      frEn(`Spiceworks, qui héberge le portail (${SPICEWORKS_PROCESSOR_FRAMEWORK})`,
        `Spiceworks, which hosts the portal (${SPICEWORKS_PROCESSOR_FRAMEWORK_EN})`),
    ],
    transfers: [
      frEn(`Possibles vers les États-Unis : Spiceworks — ${transferBasis(["SPICEWORKS"])} ; ${SPICEWORKS_SCC_FALLBACK}`,
        `Possible to the United States: Spiceworks — ${transferBasisEn(["SPICEWORKS"])}; ${SPICEWORKS_SCC_FALLBACK_EN}`),
    ],
    security: [
      frEn("Accès au portail réservé aux membres du staff chargés du support",
        "Access to the portal restricted to the staff members in charge of support"),
      frEn("Suppression des tickets clos au terme de la durée de conservation",
        "Deletion of closed tickets at the end of the retention period"),
    ],
  },
  T16: {
    name: frEn("Retransmission des matchs", "Match streaming"),
    purpose: frEn("Diffuser en direct les matchs des tournois et en garder la rediffusion",
      "Streaming tournament matches live and keeping the replay"),
    subPurposes: [
      frEn("Diffuser un match en direct sur la chaîne de l'association ou d'un ou plusieurs casters (YouTube, Twitch ou Kick) : chaque caster rejoint un stream du match (co-cast) ou ouvre le sien, avec son propre lien",
        "Streaming a match live on the association's channel or that of one or more casters (YouTube, Twitch or Kick): each caster joins a stream of the match (co-cast) or opens their own, with its own link"),
      frEn("Régler le passage à l'antenne d'un match (mode d'antenne) : le caster du match qui le pose — ou qui change un mode sans maître — en devient le maître, et seuls lui, l'arbitre désigné du match et le staff qui a à la fois la permission d'arbitrage et celle de diffusion le changent ou le retirent ensuite ; posé par qui ne caste pas le match (staff, arbitre), ou une fois que son maître a quitté le match ou, avant le lancement, ne remplit plus la condition pour le caster, le mode n'a pas de maître : ce staff, l'arbitre désigné et les casters du match le changent (les casters, sauf quand le match porte le lien de l'organisation), et seuls ce staff et l'arbitre le retirent (il part aussi quand le dernier caster quitte le match, ou que le staff l'en retire, sans qu'aucun stream reste) ; l'arbitre désigné d'un match peut aussi, pour ce seul match, modifier ou retirer le lien d'un caster et configurer la diffusion de l'organisation",
        "Setting how a match goes live (live mode): the match's caster who sets it — or who changes a mode with no holder — becomes its holder, and only they, the match's assigned referee and the staff who hold both the refereeing and the streaming permissions change or remove it afterwards; set by someone who does not cast the match (staff, referee), or once its holder has left the match or, before it launches, no longer meets the conditions to cast it, the mode has no holder: those staff, the assigned referee and the match's casters change it (the casters, unless the match carries the organisation's link), and only those staff and the referee remove it (it also goes when the last caster leaves the match, or is removed from it by the staff, with no stream left); the assigned referee of a match can also, for that match only, edit or remove a caster's link and configure the organizers' broadcast"),
      frEn("Publier sur la fiche du match le lien de sa rediffusion YouTube",
        "Publishing the link to its YouTube replay on the match page"),
      frEn("Annoncer les matchs diffusés dans le salon #live du serveur Discord de l'association, en un message par soirée (quatre heures depuis le premier direct) qui liste à leur heure les matchs en direct, ceux programmés d'ici la fin de la soirée et ceux terminés (« Terminé », avec leur score), modifié à chaque début et fin de match jusqu'à quatre heures après la fin de la soirée (un nouveau message sans mention prend le relais quand il ne peut plus être modifié), avec une mention @everyone pour la chaîne officielle de l'association et du seul rôle StreamViewer pour toute autre chaîne : noms des deux équipes (pour une affiche d'équipes, jamais le pseudo de leurs joueurs) ou, en tournoi individuel, pseudo public BlueGenji des deux joueurs (le pseudo de sa fiche, modifiable dans Mon profil, sans effet sur un message de soirée qui n'est plus modifié : sans changement, le pseudo Discord ou le BattleTag repris à la création du compte, voire le nom du compte Google pour un compte Google créé avant le 30 septembre 2026 ; jamais l'identifiant Discord numérique ; « un joueur » pour un compte supprimé, une entrée sans compte ou une inscription antérieure au 16 octobre 2026), nom du tournoi et lien de la diffusion",
        "Announcing streamed matches in the #live channel of the association's Discord server, in one message per evening (four hours from the first live stream) that lists with their times the matches live, those scheduled until the end of the evening and those finished (“Terminé”, with their score), edited at each match start and end up to four hours after the evening ends (a new message without a mention takes over when it can no longer be edited), with an @everyone mention for the association's official channel and a mention of the StreamViewer role only for any other channel: names of both teams (for a team match, never their players' usernames) or, in a solo tournament, the public BlueGenji username of both players (the username on their page, editable in My profile, with no effect on an evening message that is no longer edited: unless changed, the Discord username or BattleTag taken when the account was created, or even the Google account name for a Google account created before September 30, 2026; never the numeric Discord identifier; “a player” for a deleted account, an entry without an account or a registration made before 16 October 2026), tournament name and stream link"),
      frEn("Modérer le serveur Discord de l'association : une règle AutoMod de Discord qui bloque ou signale une annonce #live en copie le texte (pseudo public compris en tournoi individuel) au salon d'alertes des modérateurs",
        "Moderating the association's Discord server: a Discord AutoMod rule that blocks or flags a #live announcement copies its text (including the public username in a solo tournament) to the moderators' alert channel"),
    ],
    legalBasis: frEn("Intérêt légitime (RGPD, art. 6.1.f) de l'association à faire connaître ses compétitions, objet de ses statuts, avec un droit d'opposition (art. 21) ouvert à chaque joueur ; exécution du service demandé par le joueur (RGPD, art. 6.1.b — conditions d'utilisation) pour son pseudo public dans l'annonce #live d'un tournoi individuel, qui fait partie du tournoi auquel il s'inscrit : ne pas y être nommé revient à ne pas s'inscrire (une annonce passée est supprimée sur demande) ; intérêt légitime de l'association à modérer son serveur Discord pour l'alerte AutoMod d'une annonce #live bloquée ou signalée, gardée dans le salon d'alertes des modérateurs, avec un droit d'opposition (art. 21) : l'alerte est supprimée sur demande",
      "Legitimate interest (GDPR, art. 6.1.f) of the association in promoting its competitions, the purpose set out in its bylaws, with a right to object (art. 21) open to each player; performance of the service requested by the player (GDPR, art. 6.1.b — terms of use) for their public username in the #live announcement of a solo tournament, which is part of the tournament they register for: not being named in it means not registering (a past announcement is deleted on request); legitimate interest of the association in moderating its Discord server for the AutoMod alert of a blocked or flagged #live announcement, kept in the moderators' alert channel, with a right to object (art. 21): the alert is deleted on request"),
    dataSubjects: [
      frEn("Joueurs des matchs diffusés", "Players of the streamed matches"),
      "Casters",
    ],
    dataCategories: [
      frEn("Pseudos en jeu et du site, noms d'équipe, images de la partie, résultats et performances en jeu, tels qu'ils apparaissent à l'écran — ni webcam ni chat vocal des joueurs",
        "In-game and site usernames, team names, images of the game, in-game results and performance, as they appear on screen — neither webcam nor voice chat of the players"),
      frEn("Voix et pseudo des casters", "Voice and username of the casters"),
      frEn("Liens des diffusions d'un match (un par stream : celui du match, et celui que chaque caster ouvre à part, obligatoire pour l'ouvrir) et de sa rediffusion",
        "Links to the streams of a match (one per stream: the match's, and the one each caster opens separately, required to open it) and to its replay"),
      frEn("Compte qui a fourni le lien d'un stream (caster, ou membre de l'organisation qui dit poser sa propre chaîne), pour retirer ce lien à la suppression de son compte",
        "Account that provided a stream's link (a caster, or a member of the organizers who says it is their own channel), to remove that link when that account is deleted"),
      frEn("Compte du caster qui tient le mode d'antenne d'un match (celui qui l'a posé, ou repris quand il n'avait pas de maître), pour que les autres casters ne puissent pas le changer",
        "Account of the caster who holds a match's live mode (the one who set it, or took it over when it had no holder), so that the other casters cannot change it"),
      frEn("Pseudo public BlueGenji des joueurs d'un tournoi individuel, publié dans l'annonce #live sur Discord",
        "Public BlueGenji username of the players of a solo tournament, posted in the #live announcement on Discord"),
      frEn("Heure, état (programmé, en direct, « Terminé ») et score des matchs listés dans le message #live de la soirée, avec les noms d'équipe ou pseudos publics ci-dessus",
        "Time, state (scheduled, live, “Terminé”) and score of the matches listed in the evening's #live message, with the team names or public usernames above"),
      frEn("Trace de l'annonce d'un match sur Discord : le match, les identifiants de ses deux engagés (équipes ou inscriptions individuelles), la date de l'annonce et, le cas échéant, le fait que le passage à l'antenne du match n'a pas été annoncé ; identifiant du message Discord de la soirée et son état d'envoi (pas son texte)",
        "Record of a match's Discord announcement: the match, the identifiers of its two entrants (teams or solo entries), the date of the announcement and, where applicable, the fact that the match going live was not announced; ID of the evening's Discord message and its sending state (not its text)"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn("Direct : la diffusion n'est pas conservée par le site, qui n'en garde que les liens des chaînes ; le stream qu'un caster ouvre à part, et son lien, partent quand plus aucun caster ne le tient (seul le lien posé dans la configuration du direct du match reste au match) ; le lien qu'un caster a fourni, là ou en ouvrant son stream, part à la suppression de son compte, matchs joués compris, même d'un stream qu'un autre caster tient encore — un membre de l'organisation y indique, en posant le lien, s'il est celui de l'organisation (il reste au match) ou sa propre chaîne (elle part avec son compte), mais un caster ne l'indique jamais en ouvrant son propre stream ni dans « Configurer ma diffusion » (un lien qu'un caster avait dit de l'organisation avant le 10 novembre 2026 part avec ce stream quand plus aucun caster ne le tient) ; un lien posé avant que le site n'enregistre qui le fournit reste au match (T04)",
        "Live: the stream is not kept by the site, which only keeps the links to the channels; the stream a caster opens separately, and its link, go once no caster holds it any more (only the link set in the match's live configuration stays with the match); the link a caster provided, there or when opening their stream, goes when their account is deleted, played matches included, even from a stream another caster still holds — a member of the organizers states, when setting the link, whether it is the organizers' link (it stays with the match) or their own channel (it goes with their account), but a caster never states it when opening their own stream or in “Configure my broadcast” (a link a caster had called the organizers' before 10 November 2026 goes with that stream once no caster holds it any more); a link set before the site recorded who provided it stays with the match (T04)"),
      frEn("Compte du caster qui tient le mode d'antenne : effacé quand il quitte le match ou en est retiré avant son lancement (condition du cast plus remplie, ou devenu joueur du match), que le mode est retiré, ou que son compte est supprimé ; avant le lancement, un caster qui ne remplit plus la condition n'est plus tenu pour le maître, et le premier changement qu'un autre fait au mode efface son compte (ou le remplace par celui du caster qui le change) ; sinon conservé avec le match — y compris après le lancement, même s'il ne remplit plus la condition, et quand l'arbitre désigné ou le staff change le mode pour lui",
        "Account of the caster who holds the live mode: erased when they leave the match or are removed from it before it launches (casting requirements no longer met, or having become one of its players), when the mode is removed, or when their account is deleted; before launch, a caster who no longer meets the requirements is no longer treated as the holder, and the first change someone else makes to the mode erases their account (or replaces it with that of the caster who changes it); otherwise kept with the match — including after launch, even if they no longer meet the requirements, and when the assigned referee or the staff change the mode on their behalf"),
      frEn("Lien de rediffusion : conservé avec le match, comme ses résultats (T03) ; la vidéo reste sur la plateforme jusqu'à sa suppression par la chaîne qui l'a publiée",
        "Replay link: kept with the match, like its results (T03); the video stays on the platform until it is deleted by the channel that published it"),
      frEn("Annonce sur Discord : le site ne garde qu'une trace de l'annonce (le match, les identifiants de ses deux engagés, sa date et, le cas échéant, le fait que le passage à l'antenne du match n'a pas été annoncé — refus du bot ou d'AutoMod, ou soirée close après suppression de son message ; le match a pu y figurer avant comme programmé —, alors gardée sans nouvel essai jusqu'à l'effacement du match) et l'identifiant du message de la soirée (sans son texte, effacé un jour après la fin de la soirée), posée avant l'envoi, retirée pour un nouvel essai quand le bot ou la base de données du site était indisponible, sinon effacée avec le match ; le message est conservé dans le salon tant que le salon #live existe, même après la suppression du compte du joueur, et supprimé sur demande de l'équipe, du joueur ou du caster concerné (formulaire « Signaler un problème », catégorie RGPD) ; à la suppression du compte d'un caster, le message d'une soirée encore en cours est remis à jour sans le lien de sa chaîne s'il garde un autre lien, sinon, ou une fois la soirée finie, il le garde",
        `Discord announcement: the site only keeps a record of the announcement (the match, the identifiers of its two entrants, its date and, where applicable, the fact that the match going live was not announced — refused by the bot or AutoMod, or evening closed after its message was deleted; the match may have appeared in it before as scheduled —, then kept without a new attempt until the match is deleted) and the ID of the evening's message (without its text, deleted one day after the evening ends), made before sending, removed for a new attempt when the bot or the site's database was unavailable, otherwise deleted with the match; the message is kept in the channel as long as the #live channel exists, even after the player's account is deleted, and deleted at the request of the team, player or caster concerned (“${REPORT_FORM_NAME_EN}” form, “GDPR” category); when a caster's account is deleted, the message of an evening still under way is updated without their channel link if it keeps another link, otherwise, or once the evening has ended, it keeps it`),
      frEn("Alerte AutoMod (annonce #live bloquée ou signalée) : gardée dans le salon d'alertes de modération du serveur jusqu'à sa suppression par les modérateurs, et supprimée sur demande de l'équipe ou du joueur concerné (formulaire « Signaler un problème », catégorie RGPD)",
        `AutoMod alert (blocked or flagged #live announcement): kept in the server's moderation alert channel until the moderators delete it, and deleted at the request of the team or player concerned (“${REPORT_FORM_NAME_EN}” form, “GDPR” category)`),
      frEn("Droit d'opposition : sur demande (formulaire « Signaler un problème », catégorie RGPD), le joueur apparaît sous un nom neutre dans les diffusions suivantes, le lien de rediffusion est retiré du site, et une vidéo publiée par la chaîne de l'association est masquée ou supprimée ; l'annonce #live d'un tournoi individuel garde le pseudo public, qui relève de l'exécution du service et non de l'intérêt légitime : ne pas y être nommé revient à ne pas s'inscrire",
        `Right to object: on request (“${REPORT_FORM_NAME_EN}” form, “GDPR” category), the player appears under a neutral name in subsequent streams, the replay link is removed from the site, and a video published by the association's channel is hidden or deleted; the #live announcement of a solo tournament keeps the public username, which falls under performance of the service and not legitimate interest: not being named in it means not registering`),
    ],
    recipients: [
      frEn("Public des plateformes de diffusion et du site",
        "Public of the streaming platforms and of the site"),
      frEn("Plateformes de diffusion (YouTube, Twitch, Kick), responsables de leur propre traitement, y compris des données de leurs spectateurs ; le site ne fait que lier les chaînes et n'intègre aucun lecteur, il ne leur transmet aucune donnée",
        "Streaming platforms (YouTube, Twitch, Kick), controllers of their own processing, including of their viewers' data; the site only links to the channels and embeds no player, it sends them no data"),
      frEn("Membres du serveur Discord de l'association, pour l'annonce publiée dans le salon #live (noms d'équipe, ou pseudo public BlueGenji des joueurs d'un tournoi individuel)",
        "Members of the association's Discord server, for the announcement posted in the #live channel (team names, or the public BlueGenji username of the players of a solo tournament)"),
      frEn("Modérateurs du serveur Discord de l'association : si une règle AutoMod de Discord bloque ou signale une annonce #live, son texte (pseudo public compris en tournoi individuel) peut parvenir au salon d'alertes de modération du serveur",
        "Moderators of the association's Discord server: if a Discord AutoMod rule blocks or flags a #live announcement, its text (including the public username in a solo tournament) may reach the server's moderation alert channel"),
      frEn("Propriétaire et managers des engagées d'un match en autogestion (ou le joueur d'une entrée individuelle), par son check-in (message privé Discord et push, T04) : le lien de diffusion du match quand il est public ; l'arbitre désigné d'un match, pour ce seul match : les liens de ses casters et la configuration de sa diffusion",
        "Owner and managers of the entrants of a self-managed match (or the player of a solo entry), through its check-in (Discord direct message and push, T04): the match's stream link when it is public; the assigned referee of a match, for that match only: its casters' links and the configuration of its broadcast"),
      frEn("Discord (hébergement du salon)", "Discord (hosting of the channel)"),
    ],
    // Le site ne transmet rien aux plateformes : la diffusion est publiée par la
    // chaîne qui la produit, chaque plateforme traitant ses spectateurs en
    // responsable de son propre traitement. Seule l'annonce du match dans le
    // salon #live passe par Discord.
    transfers: [
      frEn(`États-Unis : Discord (annonce publiée dans le salon #live, et alerte AutoMod d'une annonce bloquée ou signalée) — ${transferBasis(["DISCORD"])}`,
        `United States: Discord (announcement posted in the #live channel, and AutoMod alert for a blocked or flagged announcement) — ${transferBasisEn(["DISCORD"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Liens de diffusion limités à une liste de plateformes, aucun lecteur intégré ; aucune donnée de contact affichée à l'écran par le site",
        "Stream links limited to a list of platforms, no embedded player; no contact data displayed on screen by the site"),
      frEn("Aucune webcam ni chat vocal des joueurs à l'écran",
        "No webcam or voice chat of the players on screen"),
    ],
  },
  T17: {
    name: frEn("Journaux d'accès du serveur web", "Web server access logs"),
    purpose: frEn("Assurer la sécurité du serveur et diagnostiquer les pannes",
      "Ensuring the server's security and diagnosing outages"),
    subPurposes: [
      frEn("Consigner chaque requête reçue par le serveur mandataire (nginx) du site",
        "Recording each request received by the site's proxy server (nginx)"),
      frEn("Détecter les attaques et les abus, comprendre une panne",
        "Detecting attacks and abuse, understanding an outage"),
    ],
    legalBasis: frEn("Intérêt légitime (RGPD, art. 6.1.f) : sécurité du service (art. 32)",
      "Legitimate interest (GDPR, art. 6.1.f): security of the service (art. 32)"),
    dataSubjects: [
      frEn("Visiteurs du site", "Visitors of the site"),
    ],
    dataCategories: [
      frEn(`${WEB_ACCESS_LOG_FIELDS.charAt(0).toUpperCase()}${WEB_ACCESS_LOG_FIELDS.slice(1)} (format de journal par défaut de nginx)`,
        `${WEB_ACCESS_LOG_FIELDS_EN.charAt(0).toUpperCase()}${WEB_ACCESS_LOG_FIELDS_EN.slice(1)} (nginx's default log format)`),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`${WEB_ACCESS_LOG_RETENTION_DAYS} jours au plus, par rotation automatique, puis suppression`,
        `${WEB_ACCESS_LOG_RETENTION_DAYS} days at most, by automatic rotation, then deletion`),
    ],
    recipients: [
      frEn("Responsable technique de l'association, qui est aussi l'hébergeur du site",
        "The association's technical manager, who is also the site's host"),
    ],
    transfers: [
      frEn("Aucun", "None"),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Journaux lisibles du seul administrateur du serveur, jamais exposés par le site",
        "Logs readable only by the server's administrator, never exposed by the site"),
    ],
  },
  T18: {
    name: frEn("Salons vocaux d'équipe des matchs", "Team voice channels for matches"),
    purpose: frEn("Réunir chaque équipe d'un match dans un salon vocal Discord dédié avant son départ, sans que le lancement du match en dépende, dans les seuls tournois qui ont l'option « Salons vocaux d'équipe » (éteinte par défaut)",
      "Gathering each team of a match in a dedicated Discord voice channel before it starts, without the match's launch depending on it, in tournaments with the “Team voice channels” option only (off by default)"),
    subPurposes: [
      frEn(`Demander au bot Discord de l'association, à partir de ${VOICE_CHANNEL_LEAD_MINUTES} minutes avant l'heure d'un match (ou dès l'option allumée, pour un match déjà dans ce délai), un salon vocal de ${VOICE_CHANNEL_CAPACITY} places par équipe dans la catégorie des matchs de son serveur, au nom de l'équipe — jamais pour une entrée en tournoi individuel (son nom serait un pseudo) ni pour un match contre une équipe fantôme`,
        `Asking the association's Discord bot, from ${VOICE_CHANNEL_LEAD_MINUTES} minutes before a match's time (or as soon as the option is turned on, for a match already within that window), for a ${VOICE_CHANNEL_CAPACITY}-seat voice channel per team in its server's match category, named after the team — never for a solo entry (its name would be a username) nor for a match against a ghost team`),
      frEn("Dire aux parties du match (membres des deux équipes, casters) et au staff, sur la page du match, si chaque salon est ouvert — le site ne demande jamais au bot qui se trouve dans un salon, ni combien",
        "Telling the match's parties (members of both teams, casters) and staff, on the match page, whether each channel is open — the site never asks the bot who is in a channel, nor how many"),
      frEn(`Rendre les salons au bot quand le match est terminé (score validé), annulé, retombé en attente, sorti du programme ou resté sans score validé ${VOICE_CHANNEL_LATE_HOURS} heures après son horaire, quand l'équipe sort de l'appariement, quand une entrée en tournoi individuel ou une équipe fantôme entre dans le match, quand le tournoi n'est plus en cours (terminé, ou ramené avant son départ), est de nouveau masqué ou éteint l'option, ou quand le match est reporté à plus de ${VOICE_CHANNEL_LEAD_MINUTES} minutes (ses salons rouvrent ${VOICE_CHANNEL_LEAD_MINUTES} minutes avant sa nouvelle heure) ; le bot supprime un salon dès qu'il est vide`,
        `Handing the channels back to the bot when the match is finished (score confirmed), cancelled, back to waiting, taken off the schedule or left without a confirmed score ${VOICE_CHANNEL_LATE_HOURS} hours after its time, when the team leaves the pairing, when a solo entry or a ghost team enters the match, when the tournament is no longer running (finished, or moved back before its start), is hidden again or turns the option off, or when the match is rescheduled to more than ${VOICE_CHANNEL_LEAD_MINUTES} minutes away (its channels reopen ${VOICE_CHANNEL_LEAD_MINUTES} minutes before its new time); the bot deletes a channel as soon as it is empty`),
      frEn("Permettre aux arbitres et administrateurs (jamais à qui joue le match) de vider le salon ouvert d'une équipe : le bot en déconnecte tous les occupants, qu'il lit dans l'état vocal tenu en mémoire, sans garder, journaliser ni rendre au site qui, ni combien (seul le journal d'audit de Discord note les déconnexions) ; le salon reste ouvert",
        "Letting referees and administrators (never someone playing the match) clear a team's open channel: the bot disconnects all its occupants, read from the voice state held in memory, without keeping, logging or returning to the site who, nor how many (only Discord's audit log notes the disconnections); the channel stays open"),
      frEn("Permettre au propriétaire, à un manager ou au capitaine d'une équipe de vider de la même façon le salon de sa propre équipe, jamais celui de l'adversaire : le site lit son équipe active et ses rôles pour le vérifier, sans rien en garder ni le journaliser, ni sur le site ni sur Discord",
        "Letting a team's owner, a manager or its captain clear their own team's channel in the same way, never the opponent's: the site reads their active team and roles to check it, without keeping or logging anything, on the site or on Discord"),
    ],
    legalBasis: frEn("Intérêt légitime (bon déroulement des tournois : réunir chaque équipe avant son match) ; rejoindre un salon reste un choix, sans effet sur le lancement du match ; le site ne garde ni qui se trouve dans un salon, ni combien ; le vidage d'un salon relève du même intérêt (en écarter qui ne devrait pas s'y trouver)",
      "Legitimate interest (smooth running of tournaments: gathering each team before its match); joining a channel remains a choice, with no effect on the match's launch; the site keeps neither who is in a channel nor how many; clearing a channel rests on the same interest (removing from it someone who should not be there)"),
    dataSubjects: [
      frEn("Membres des équipes engagées dans un match", "Members of the teams playing a match"),
      frEn("Toute personne qui rejoint un salon vocal d'équipe sur le serveur Discord de l'association (les salons sont ouverts à qui voit la catégorie des matchs), dont celles qu'un vidage par l'arbitrage ou par l'équipe en déconnecte",
        "Anyone who joins a team voice channel on the association's Discord server (the channels are open to whoever sees the match category), including those a clearing by the referees or by the team disconnects"),
      frEn("Membre du staff qui vide un salon, nommé dans les journaux du serveur sauf s'il est l'arbitre désigné du match",
        "Staff member who clears a channel, named in the server logs unless they are the match's assigned referee"),
      frEn("Propriétaire, manager ou capitaine d'une équipe qui vide le salon de son équipe, jamais nommé ni journalisé",
        "Owner, manager or captain of a team who clears their team's channel, never named nor logged"),
      frEn("Membres du serveur Discord de l'association présents dans l'un de ses salons vocaux, dont le bot tient la présence en mémoire pour savoir si un salon de match est vide",
        "Members of the association's Discord server present in one of its voice channels, whose presence the bot holds in memory to know whether a match channel is empty"),
      frEn("Membres des autres serveurs où le bot est présent, présents dans l'un de leurs salons vocaux : seule la fiche de membre jointe à leur état vocal est gardée en mémoire",
        "Members of the other servers the bot is on, present in one of their voice channels: only the member profile attached to their voice state is kept in memory"),
    ],
    dataCategories: [
      frEn("Identifiant Discord du salon de chaque équipe d'un match, numéros du match et de l'équipe, heure d'une éventuelle panne du bot ou d'un rendu refusé (et si la panne touchait tout le bot), heures de création et de rendu du salon — aucune donnée d'utilisateur : jamais qui est présent, ni combien",
        "Discord identifier of each team's channel for a match, numbers of the match and team, time of any bot outage or refused hand-back (and whether the outage hit the whole bot), creation and hand-back times of the channel — no user data: never who is present, nor how many"),
      frEn("Nom de l'équipe, transmis au bot pour nommer le salon",
        "Team name, sent to the bot to name the channel"),
      frEn("Pseudo et numéro de compte du membre du staff qui vide un salon, avec le numéro du match et l'issue, dans les journaux du serveur — jamais pour l'arbitre désigné du match",
        "Username and account number of the staff member who clears a channel, with the match number and the outcome, in the server logs — never for the match's assigned referee"),
      frEn("Équipe active et rôles d'équipe de qui vide le salon de son équipe, lus pour vérifier qu'il la mène (propriétaire, manager, capitaine), sans être gardés",
        "Active team and team roles of whoever clears their team's channel, read to check that they lead it (owner, manager, captain), without being kept"),
      frEn("État vocal (identifiant Discord du membre et de sa session vocale, salon où il se trouve, micro ou son coupés par lui ou par la modération, partage d'écran ou caméra actifs, demande de parole et mise en sourdine de scène), avec la fiche de membre que Discord y joint (sa fiche sur le serveur, dont pseudo, surnom, avatar, rôles, dates d'arrivée et de boost, exclusion temporaire), des membres du serveur Discord de l'association, tenu en mémoire par le bot pour savoir si un salon est vide, jamais enregistré ni transmis au site",
        "Voice state (Discord identifier of the member and of their voice session, channel they are in, microphone or sound muted by them or by moderation, screen sharing or camera on, request to speak and stage suppression), with the member profile Discord attaches to it (their profile on the server, including username, nickname, avatar, roles, join and boost dates, timeout), of the members of the association's Discord server, held in memory by the bot to know whether a channel is empty, never recorded nor sent to the site"),
      frEn("Fiche du salon chez le bot : identifiant du salon, clé du match et de l'équipe (des numéros, aucun nom), heures de création et de rendu",
        "The bot's record of the channel: channel identifier, key of the match and team (numbers, no name), creation and hand-back times"),
    ],
    sensitiveData: frEn("Aucune", "None"),
    retention: [
      frEn(`Ligne du salon sur le site (identifiant, numéros et heures) : jusqu'à ce que le bot ait repris le salon ou dise ne plus le suivre (salon déjà supprimé, sorti de la catégorie des matchs ou oublié par le bot : il relève alors de la modération du serveur), puis ${VOICE_ROW_RETENTION_DAYS} jours, effacée au balayage suivant (purge au plus une fois par heure), hors les copies de sauvegarde chiffrées (T09, ${BACKUP_RETENTION_DAYS} jours au plus) ; sans cette réponse du bot, la ligne n'est jamais close : s'il refuse de reprendre le salon, le site le lui rend de nouveau environ une fois par minute, puis une fois par heure passé ${VOICE_BOT_UNRELEASED_MAX_HOURS} heures après la création du salon actuel, sans limite ; s'il est indisponible, au fil de l'activité du site (au plus environ une fois par minute) tant qu'il l'est — seule exception, un salon que le bot dit ne jamais pouvoir suivre (identifiant ou clé invalides), dont la ligne est close aussitôt`,
        `The channel's record on the site (identifier, numbers and times): until the bot has taken the channel back or says it no longer tracks it (channel already deleted, moved out of the match category or forgotten by the bot: it then falls to the server's moderation), then ${VOICE_ROW_RETENTION_DAYS} days, erased at the next sweep (purge at most once an hour), apart from the encrypted backup copies (T09, ${BACKUP_RETENTION_DAYS} days at most); without that answer from the bot, the record is never closed: if it refuses to take the channel back, the site hands it back again about once a minute, then once an hour from ${VOICE_BOT_UNRELEASED_MAX_HOURS} hours after the current channel was created, with no limit; if it is unavailable, as the site is used (at most about once a minute) for as long as it is — the only exception being a channel the bot says it can never track (invalid identifier or key), whose record is closed at once`),
      frEn(`Salon sur Discord : supprimé par le bot dès qu'il est vide une fois rendu, au plus tard ${VOICE_BOT_RELEASED_MAX_HOURS} heures et ${VOICE_BOT_SWEEP_MINUTES} minutes après son rendu même occupé (balayage toutes les ${VOICE_BOT_SWEEP_MINUTES} minutes, bot en marche), sauf si Discord l'en empêche (droit retiré, erreur) : il réessaie alors à chaque balayage, et s'il oublie le salon (fiche ci-dessous), celui-ci reste jusqu'à ce que la modération du serveur le supprime ; un salon jamais rendu est supprimé par le bot s'il est vide ${VOICE_BOT_UNRELEASED_MAX_HOURS} heures après sa création ou sa reprise, et reste tant qu'il est occupé ; déplacé hors de la catégorie des matchs, le bot cesse de le suivre sans le supprimer (il relève alors de la modération du serveur, et un nouveau salon est ouvert à l'équipe si son match n'a pas encore de score validé, est à moins de ${VOICE_CHANNEL_LEAD_MINUTES} minutes de son horaire ou l'a passé, et n'a pas dépassé son horaire de plus de ${VOICE_CHANNEL_LATE_HOURS} heures, comme après une suppression par la modération ou un oubli par le bot) ; un match reporté à plus de ${VOICE_CHANNEL_LEAD_MINUTES} minutes rend ses salons, et en reçoit de nouveaux ${VOICE_CHANNEL_LEAD_MINUTES} minutes avant sa nouvelle heure`,
        `Channel on Discord: deleted by the bot as soon as it is empty once handed back, within ${VOICE_BOT_RELEASED_MAX_HOURS} hours and ${VOICE_BOT_SWEEP_MINUTES} minutes of being handed back at the latest even if occupied (sweep every ${VOICE_BOT_SWEEP_MINUTES} minutes, while the bot is running), unless Discord prevents it (permission removed, error): it then retries at every sweep, and if it forgets the channel (record below), the channel stays until the server's moderation deletes it; a channel never handed back is deleted by the bot if it is empty ${VOICE_BOT_UNRELEASED_MAX_HOURS} hours after its creation or its reuse, and stays while it is occupied; moved out of the match category, the bot stops tracking it without deleting it (it then falls to the server's moderation, and a new channel is opened for the team if its match has no confirmed score yet, is less than ${VOICE_CHANNEL_LEAD_MINUTES} minutes from its time or past it, and is not more than ${VOICE_CHANNEL_LATE_HOURS} hours past its time, as after a deletion by moderation or the bot forgetting it); a match rescheduled to more than ${VOICE_CHANNEL_LEAD_MINUTES} minutes away hands its channels back, and receives new ones ${VOICE_CHANNEL_LEAD_MINUTES} minutes before its new time`),
      frEn("État vocal : tenu en mémoire par le bot en permanence, que l'option soit allumée ou non dans un tournoi, à jour de ce que Discord lui transmet, et perdu à son arrêt ; jamais enregistré par le bot ni transmis au site — celui des autres serveurs où il est présent n'est pas gardé (la fiche de membre jointe l'est, en mémoire seulement, à jour de Discord et perdue à son arrêt)",
        "Voice state: held in memory by the bot at all times, whether or not a tournament has the option on, kept up to date with what Discord sends it, and lost when it stops; never recorded by the bot nor sent to the site — that of the other servers it is on is not kept (the attached member profile is, in memory only, kept up to date by Discord and lost when it stops)"),
      frEn(`Fiche du salon chez le bot : effacée avec le salon ; oubliée ${VOICE_BOT_ABANDONED_MAX_HOURS} heures après sa création ou sa reprise si le bot ne peut plus lire le salon ; gardée sans limite tant que le salon, jamais rendu, reste occupé, ou qu'il le lit sans pouvoir le supprimer ou que Discord répond par une autre erreur ; hors les copies de sauvegarde chiffrées (T09, ${BACKUP_RETENTION_DAYS} jours au plus)`,
        `The bot's record of the channel: erased with the channel; forgotten ${VOICE_BOT_ABANDONED_MAX_HOURS} hours after its creation or its reuse if the bot can no longer read the channel; kept with no limit while the channel, never handed back, stays occupied, or while it reads it without being able to delete it or while Discord answers with another error; apart from the encrypted backup copies (T09, ${BACKUP_RETENTION_DAYS} days at most)`),
      frEn(`Autres délais du bot (hors le plafond d'un salon rendu, qui l'inclut) : chacun s'entend à un balayage près (au plus ${VOICE_BOT_SWEEP_MINUTES} minutes de plus)`,
        `The bot's other periods (apart from the ceiling of a handed-back channel, which includes it): each holds to within one sweep (at most ${VOICE_BOT_SWEEP_MINUTES} minutes more)`),
      frEn("Vidage d'un salon : rien n'est gardé de ses occupants, ni par le site ni par le bot — ils ne sont lus, dans l'état vocal tenu en mémoire, que pour être déconnectés",
        "Clearing a channel: nothing is kept about its occupants, by the site or by the bot — they are only read, from the voice state held in memory, to be disconnected"),
      frEn("Journaux du serveur, selon leur rotation : lignes techniques des salons (numéro du match, code d'erreur), sans donnée de joueur ; pour un vidage par l'arbitrage, son auteur (pseudo et numéro de compte), le match et l'issue, sauf si l'auteur est l'arbitre désigné du match, jamais nommé ; rien pour un vidage par l'équipe",
        "Server logs, according to their rotation: technical lines about the channels (match number, error code), without any player data; for a clearing by the referees, its author (username and account number), the match and the outcome, unless the author is the match's assigned referee, never named; nothing for a clearing by the team"),
      frEn("Journal d'audit du serveur sur Discord : création et suppression de chaque salon, avec son nom, et déconnexions d'un vidage (leur nombre et leur motif, tels que Discord les y inscrit), pour la durée que Discord fixe",
        "The server's audit log on Discord: creation and deletion of each channel, with its name, and the disconnections of a clearing (their number and reason, as Discord records them), for the period Discord sets"),
    ],
    recipients: [
      frEn("Membres des deux équipes d'un match, ses casters et le staff, à qui la page du match dit si chaque salon est ouvert",
        "Members of both teams of a match, its casters and staff, whom the match page tells whether each channel is open"),
      frEn("Autres membres connectés, qui peuvent lire ces mêmes états dans les données du tournoi — un visiteur sans compte n'en lit rien",
        "Other signed-in members, who can read those same states in the tournament's data — a visitor without an account reads none of it"),
      frEn("Membres du serveur Discord de l'association autorisés dans la catégorie des matchs, qui voient le salon et ses occupants sur Discord",
        "Members of the association's Discord server allowed in the match category, who see the channel and its occupants on Discord"),
      frEn("Administration du serveur Discord de l'association, qui lit dans le journal d'audit de Discord la création et la suppression de chaque salon, avec son nom, et les déconnexions d'un vidage",
        "Administration of the association's Discord server, which reads in Discord's audit log the creation and deletion of each channel, with its name, and the disconnections of a clearing"),
      frEn("Staff, à qui le journal d'activité sur Discord dit qu'un salon d'équipe a été vidé par le staff, sans nommer son auteur (T05) — jamais un vidage par l'équipe",
        "Staff, whom the activity log on Discord tells that a team channel was cleared by staff, without naming its author (T05) — never a clearing by the team"),
      frEn("Discord (plateforme d'exécution)", "Discord (execution platform)"),
    ],
    transfers: [
      frEn(`États-Unis : Discord — ${transferBasis(["DISCORD"])}`,
        `United States: Discord — ${transferBasisEn(["DISCORD"])}`),
    ],
    security: [
      ...COMMON_SECURITY,
      frEn("Aucune présence : ni identifiant, ni pseudo, ni nombre des personnes présentes n'est demandé au bot, reçu ou journalisé par le site",
        "No presence data: neither the identifier, the username nor the number of the people present is requested from the bot, received or logged by the site"),
      frEn(`Le bot n'est appelé que par le balayage du serveur, au plus une fois toutes les ${VOICE_SWEEP_THROTTLE_SECONDS} secondes (aussitôt quand l'arbitrage change l'option), jamais pour chaque lecteur, et seulement pour créer un salon, le redemander (environ une fois par minute dès ${VOICE_CHANNEL_LEAD_MINUTES} minutes avant l'horaire du match, ce qui en ouvre un neuf s'il a été supprimé) ou le rendre — en dehors du vidage demandé par l'arbitrage, dont la réponse ne donne que l'issue — jamais pour savoir qui s'y trouve, ni combien`,
        `The bot is only called by the server's sweep, at most once every ${VOICE_SWEEP_THROTTLE_SECONDS} seconds (immediately when referees change the option), never for each viewer, and only to create a channel, ask for it again (about once a minute from ${VOICE_CHANNEL_LEAD_MINUTES} minutes before the match time, which opens a new one if it was deleted) or hand it back — apart from a clearing requested by the referees, whose answer only gives its outcome — never to know who is in it, nor how many`),
    ],
  },
});

export const PROCESSING_ACTIVITIES: readonly ProcessingActivity[] = localize<ProcessingActivity[]>(ACTIVITIES, "fr");

/** `PROCESSING_ACTIVITIES`, in English: same activities, same order, same constants. */
export const PROCESSING_ACTIVITIES_EN: readonly ProcessingActivity[] = localize<ProcessingActivity[]>(ACTIVITIES, "en");

// --- Export tableur ------------------------------------------------------------

/** Colonnes de l'export, dans l'ordre des rubriques du modèle CNIL. */
export const REGISTER_EXPORT_COLUMNS = [
  "Réf.",
  "Nom du traitement",
  "Date de mise à jour",
  "Responsable du traitement",
  "Personne à contacter pour les demandes relatives aux données",
  "Hébergeur (sous-traitant)",
  "Finalité principale",
  "Sous-finalités",
  "Base légale",
  "Catégories de personnes concernées",
  "Catégories de données",
  "Données sensibles",
  "Durées de conservation",
  "Destinataires",
  "Transferts hors UE",
  "Mesures de sécurité",
] as const;

/**
 * Une cellule CSV.
 *
 * Guillemets doublés et cellule entre guillemets dès qu'elle contient le
 * séparateur, un guillemet ou un saut de ligne. Une cellule qui commence par
 * `=`, `+`, `-`, `@`, une tabulation ou un retour chariot (liste OWASP) est
 * préfixée d'une apostrophe : un tableur l'exécuterait sinon comme une formule
 * (injection CSV) — aucune ne l'est aujourd'hui, mais le registre est un texte
 * qu'on éditera.
 */
export function csvCell(value: string): string {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return /[";\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** Plusieurs éléments dans une cellule : une ligne chacun, lisible dans un tableur. */
function listCell(items: readonly string[]): string {
  return items.join("\n");
}

/**
 * Le registre au format CSV, pour Excel comme pour LibreOffice : séparateur `;`
 * (celui qu'un tableur réglé en français attend), fins de ligne `\r\n`, et BOM
 * UTF-8 en tête — sans lui, Excel lit les accents en Windows-1252.
 */
export function registerToCsv(
  controller: RegisterController,
  activities: readonly ProcessingActivity[] = PROCESSING_ACTIVITIES,
): string {
  const controllerText = `${controller.name} — ${controller.legalForm}, ${controller.seat} — ${controller.contact}`;
  const rows = activities.map((a) => [
    a.ref,
    a.name,
    REGISTER_UPDATED_AT,
    controllerText,
    controller.dataContact,
    controller.host,
    a.purpose,
    listCell(a.subPurposes),
    a.legalBasis,
    listCell(a.dataSubjects),
    listCell(a.dataCategories),
    a.sensitiveData,
    listCell(a.retention),
    listCell(a.recipients),
    listCell(a.transfers),
    listCell(a.security),
  ]);
  const lines = [REGISTER_EXPORT_COLUMNS as readonly string[], ...rows].map((row) =>
    row.map(csvCell).join(";"),
  );
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function registerExportFilename(): string {
  return `registre-traitements-bluegenji-${REGISTER_UPDATED_AT}.csv`;
}
