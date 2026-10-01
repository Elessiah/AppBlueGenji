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
 */
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS, BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import {
  SITE_VISIT_DETAIL_RETENTION_DAYS,
  SITE_VISIT_WINDOW_MINUTES,
  SITE_VISITOR_RETENTION_MONTHS,
} from "@/lib/shared/site-visits";
import { SITE_HOST } from "@/lib/shared/site-host";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION, copyrightNoticeElementsText } from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { SUSPENSION_RETENTION_MONTHS } from "@/lib/shared/account-suspension";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
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

/** Date de dernière mise à jour du registre (AAAA-MM-JJ). À avancer à chaque modification. */
export const REGISTER_UPDATED_AT = "2026-10-01";

/**
 * Durées appliquées par le serveur, et déclarées ici : `lib/server/auth.ts` et
 * `lib/server/users-service.ts` les importent, si bien que le registre ne peut
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

const COMMON_SECURITY = [
  "Accès au serveur réservé au responsable technique (authentification par clé SSH, bannissement automatique des tentatives échouées)",
  "Chiffrement des échanges (HTTPS)",
  "Droits d'administration par rôle, limités à ce que chaque mission exige",
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

export const PROCESSING_ACTIVITIES: readonly ProcessingActivity[] = [
  {
    ref: "T01",
    name: "Comptes joueurs et profils",
    purpose: "Permettre aux joueurs de disposer d'un compte sur la plateforme de tournois",
    subPurposes: [
      "Afficher un profil public (pseudo, avatar, pseudos de jeu selon les réglages de visibilité)",
      "Mettre les joueurs en relation (s'ajouter en jeu, recrutement d'équipe)",
      "Exporter ses données et supprimer son compte depuis « Mon profil »",
    ],
    legalBasis:
      "Exécution du service demandé par le joueur (contrat) pour le compte ; consentement pour les données facultatives que le joueur renseigne et choisit de rendre visibles",
    dataSubjects: ["Joueurs inscrits sur le site"],
    dataCategories: [
      "Pseudo du site (depuis le 30 septembre 2026, jamais tiré du nom du compte Google : pseudo neutre à la création ; un compte Google antérieur a pu recevoir ce nom), avatar (copié sur nos serveurs ; depuis la même date, masqué par défaut quand il vient du fournisseur de connexion)",
      "Pseudos Overwatch (BattleTag), Marvel Rivals et Discord ; certification du pseudo Discord",
      "Majorité déclarée (oui / non / non renseignée)",
      "Réglages de visibilité, disponibilité pour le recrutement, rôles sur la plateforme",
      "Aucun nom réel, aucune adresse e-mail, aucun numéro de téléphone, aucune adresse postale",
    ],
    sensitiveData: "Aucune",
    retention: [
      "Durée du compte",
      `À la suppression : effacement complet si le compte n'a laissé aucune trace (aucun match joué, aucune inscription en tournoi individuel, aucune équipe possédée, aucun tournoi organisé), anonymisation immédiate sinon — le pseudo est remplacé par un pseudo d'emprunt, et seul le compte anonymisé reste, avec son historique de tournois et d'équipes ; dans les deux cas, le journal des données de connexion (T14) est gardé jusqu'à son échéance légale ; les informations fournies à la création du compte (pseudo, identifiants de fournisseur) ne sont pas gardées après la suppression, hors les copies de sauvegarde chiffrées (T09, ${BACKUP_RETENTION_DAYS} jours au plus) et la mention de la suppression au journal qui la rejoue après une restauration (identifiant et date de création du compte, ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours) ; les signalements envoyés par le compte en sont détachés et suivent leur propre durée (T11), et les gestes d'arbitrage d'un membre du staff restent nommés dans les journaux du serveur, selon leur rotation (T05)`,
      `Sessions de connexion : ${SESSION_RETENTION_DAYS} jours après la connexion`,
    ],
    recipients: [
      "Public du site (seules les données que le joueur rend visibles)",
      "Joueurs d'un même match, tant que le tournoi n'est pas terminé (BattleTag même masqué, pour s'ajouter en jeu)",
      "Joueurs connectés du site : pseudo Discord certifié, si le joueur le rend visible",
      "Staff de l'association selon son rôle (administration, arbitrage)",
    ],
    transfers: ["Aucun"],
    security: [
      ...COMMON_SECURITY,
      "Jetons de session stockés sous forme d'empreinte (SHA-256), cookie httpOnly",
      "Pas de mot de passe : connexion déléguée à Google, Discord ou Blizzard, ou code à usage unique",
    ],
  },
  {
    ref: "T02",
    name: "Authentification",
    purpose: "Connecter un joueur à son compte sans mot de passe",
    subPurposes: [
      "Connexion par Google, Discord ou Blizzard (OAuth)",
      "Connexion par code à six chiffres envoyé en message privé Discord par le bot",
      "Rattachement de plusieurs moyens de connexion à un même compte",
    ],
    legalBasis: "Exécution du service demandé par le joueur (contrat)",
    dataSubjects: ["Joueurs inscrits sur le site"],
    dataCategories: [
      "Identifiants techniques opaques Google, Discord et Blizzard",
      "Identifiant Discord et pseudo Discord (connexion par code ou par bouton), enregistré sans être certifié — la certification, qui l'expose, est un geste distinct (T04)",
      "Porte de rattachement du compte Discord (bouton OAuth ou code en message privé)",
      "Code de connexion (conservé uniquement sous forme d'empreinte), nombre d'essais",
      "Adresse IP, en mémoire pour limiter les essais ; celle d'une connexion réussie est écrite au journal des données de connexion (T14), pour la seule obligation légale de l'hébergeur",
    ],
    sensitiveData: "Aucune",
    retention: [
      `Identifiants de connexion : durée du compte, ou jusqu'au détachement du fournisseur ; effacés à la suppression du compte (seul le journal des données de connexion, T14, lui survit, hors les copies de sauvegarde chiffrées, T09, ${BACKUP_RETENTION_DAYS} jours au plus)`,
      `Codes de connexion : valables ${DISCORD_CODE_VALIDITY_MINUTES} minutes, purgés un jour après expiration, effacés à la suppression du compte`,
    ],
    recipients: [
      "Google, Discord et Blizzard, qui authentifient le joueur (responsables de leur propre traitement)",
      "Discord, qui achemine le message privé contenant le code",
    ],
    transfers: [
      `Possibles vers les États-Unis, selon le fournisseur que le joueur choisit pour se connecter — ${transferBasis(["GOOGLE", "DISCORD", "BLIZZARD"])}`,
    ],
    security: [
      ...COMMON_SECURITY,
      "Jeton anti-CSRF et état scellé à l'aller pour chaque connexion OAuth",
      "Cinq essais par code, cinq codes par quart d'heure et par compte, plafonds de débit par adresse IP",
      "Seules les autorisations minimales sont demandées aux fournisseurs (ni adresse e-mail, ni liste de serveurs)",
    ],
  },
  {
    ref: "T03",
    name: "Tournois, équipes et palmarès",
    purpose: "Organiser des tournois amateurs et en conserver les résultats",
    subPurposes: [
      "Constituer des équipes (membres, rôles, invitations)",
      "Prévenir en message privé Discord le propriétaire et les managers d'une équipe d'une demande d'adhésion (sans nommer le demandeur, au plus un message par joueur et par équipe toutes les 24 h)",
      "Inscrire des équipes ou des joueurs, générer les plateaux, saisir et arbitrer les scores",
      "Publier résultats, classements, statistiques et palmarès",
    ],
    legalBasis: "Intérêt légitime (organisation des compétitions, mémoire sportive de la scène)",
    dataSubjects: ["Joueurs inscrits", "Membres d'équipe", "Staff d'arbitrage"],
    dataCategories: [
      "Appartenance à une équipe et rôles d'équipe",
      "Inscriptions, scores, forfaits, pénalités (avec motif et arbitre auteur), classements",
    ],
    sensitiveData: "Aucune",
    retention: [
      "Résultats et palmarès : aucune durée de conservation définie, conservés tant que le site existe ; anonymisés à la suppression du compte (pseudo d'emprunt)",
      "Droit d'opposition ouvert sur demande",
    ],
    recipients: [
      "Public du site",
      "Staff d'arbitrage et d'administration",
      "Discord, qui achemine le message privé d'une demande d'adhésion",
    ],
    transfers: [`États-Unis : Discord (acheminement des messages privés) — ${transferBasis(["DISCORD"])}`],
    security: [
      ...COMMON_SECURITY,
      "Modification d'un score verrouillée dès que la manche suivante est entamée",
    ],
  },
  {
    ref: "T04",
    name: "Contact des joueurs pendant un tournoi",
    purpose: "Permettre à l'organisation de joindre un joueur engagé (reprogrammer, trancher un litige, confirmer un forfait)",
    subPurposes: [
      "Exposer le pseudo Discord certifié aux administrateurs, à tout moment, et aux arbitres tant que le joueur est inscrit à un tournoi qui n'est pas terminé (dès la phase d'inscription)",
      "Ouvrir aux administrateurs et aux arbitres le BattleTag masqué d'un joueur, tant qu'il est inscrit à un tournoi qui n'est pas terminé",
      "Au lancement d'un match, présenter aux joueurs des deux équipes et au caster inscrit le pseudo Discord certifié et le BattleTag d'un ou deux joueurs par équipe, et ceux du caster, jusqu'à la fin du match",
      "Recueillir les « Prêt » de chaque partie d'un match (équipes, caster) avant son lancement",
      "Envoyer des rappels de match en message privé Discord (une semaine, 24 h et 1 h avant)",
      "Alerter le rôle arbitre (conflit de score, report expiré, signalement d'un joueur)",
    ],
    legalBasis:
      "Consentement pour l'exposition du pseudo Discord certifié à l'organisation (certification, geste distinct fait par le joueur depuis son profil — jamais acquise par la seule connexion — et retirable en retirant son tag) ; exécution du service demandé par le joueur (contrat — conditions d'utilisation) pour la présentation des contacts aux parties d'un match à son lancement et le recueil des « Prêt » ; intérêt légitime (bon déroulement des tournois) pour les rappels de match et les alertes d'arbitrage",
    dataSubjects: ["Joueurs engagés dans un tournoi", "Arbitres", "Casters inscrits sur un match"],
    dataCategories: [
      "Pseudo et identifiant Discord",
      "BattleTag",
      "Date et adversaire du match",
      "Heure à laquelle chaque partie s'est déclarée prête, caster inscrit",
      "Motif d'un signalement",
    ],
    sensitiveData: "Aucune",
    retention: [
      "Pseudo certifié : jusqu'à sa modification ou la suppression du compte",
      "Traces d'envoi des rappels et alertes (match et palier, sans contenu) : conservées avec le match, donc sans limite de durée",
      "« Prêt » et caster d'un match : conservés avec le match ; le caster d'un compte supprimé est retiré des matchs non joués",
    ],
    recipients: [
      "Administrateurs et arbitres de l'association",
      "Joueurs et caster d'un même match, de son lancement à sa fin",
      "Discord, qui achemine les messages",
    ],
    transfers: [`États-Unis : Discord (acheminement des messages privés) — ${transferBasis(["DISCORD"])}`],
    security: [
      ...COMMON_SECURITY,
      "Pseudo non certifié invisible de tous, administrateurs compris ; pseudo certifié jamais montré à un visiteur sans compte",
      "Contacts d'un match servis aux seules parties du match, jamais dans l'instantané public du tournoi",
    ],
  },
  {
    ref: "T05",
    name: "Journal d'activité du staff sur Discord",
    purpose: "Tenir le staff informé des faits marquants de la plateforme",
    subPurposes: [
      "Arrivées de joueurs, inscriptions et abandons en tournoi, fins de match, clôtures",
      "Traçabilité des gestes d'arbitrage (pénalités, retraits d'engagés, retours en arrière), pour la modération",
    ],
    legalBasis: "Intérêt légitime (administration et contrôle de l'arbitrage)",
    dataSubjects: ["Staff"],
    dataCategories: [
      "Sur Discord : noms d'équipe, scores, noms des tournois — aucun pseudo de joueur (« un joueur », y compris en tournoi individuel) et aucun membre du staff nommé (« le staff »)",
      "Dans les journaux du serveur : pseudo et identifiant du membre du staff auteur d'un geste d'arbitrage",
    ],
    sensitiveData: "Aucune",
    retention: [
      `Messages Discord : conservés dans un salon réservé au staff, purgé à la main par l'association et, au plus tard, par le bot au bout de ${BOT_STAFF_LOG_RETENTION_DAYS} jours (un an, traitement T08)`,
      "Journaux du serveur : selon leur rotation automatique",
    ],
    recipients: [
      "Staff de l'association ayant accès au salon",
      "Discord (hébergement du salon)",
      "Responsable technique (journaux du serveur)",
    ],
    transfers: [`États-Unis : Discord — ${transferBasis(["DISCORD"])}`],
    security: [...COMMON_SECURITY, "Salon privé, accès restreint par rôle Discord"],
  },
  {
    ref: "T06",
    name: "Mesure d'audience du site",
    purpose: "Connaître la fréquentation du site",
    subPurposes: [
      `Compter visites (24 h, 7 jours, 30 jours, total) et visiteurs uniques (24 h, 7 jours, 30 jours, ${SITE_VISITOR_RETENTION_MONTHS} mois)`,
    ],
    legalBasis: "Intérêt légitime (art. 6.1.f RGPD : connaître la fréquentation du site), sans cookie de mesure ni traceur tiers ; droit d'opposition (art. 21) appliqué par le site lui-même — signaux Global Privacy Control et Do Not Track du navigateur, ou bouton d'opposition de /rgpd#audience (cookie bg_audience_optout, sans identifiant) : une visite refusée n'est pas enregistrée, le serveur relisant ces signaux, et n'est pas même transmise quand le navigateur les expose à la page. Pour les visites déjà enregistrées, le droit s'exerce comme les autres droits : auprès de la personne à contacter pour les demandes relatives aux données, par le formulaire de signalement, catégorie RGPD, ou auprès de l'association",
    dataSubjects: ["Visiteurs du site"],
    dataCategories: [
      "Empreinte salée par un secret du serveur (SHA-256), dérivée du compte ou de l'adresse IP et du navigateur : donnée pseudonymisée — sans le secret, elle ne se rattache à personne, mais l'association, qui le détient, peut recalculer l'empreinte d'un compte ou d'un couple IP et navigateur",
      "Page consultée (sans paramètres d'URL), date",
      "Indicateur « visiteur connecté » (oui / non), sans le compte concerné",
      `Plusieurs chargements d'un même visiteur en ${SITE_VISIT_WINDOW_MINUTES} minutes ne comptent qu'une visite`,
    ],
    sensitiveData: "Aucune",
    retention: [
      `Détail des visites (empreinte, page, date) effacé au bout de ${SITE_VISIT_DETAIL_RETENTION_DAYS} jours, après report dans un compteur par jour qui ne garde que le nombre de visites`,
      `Une empreinte par visiteur, sans page mais avec l'indicateur « visiteur connecté » et la date de la dernière visite, effacée ${SITE_VISITOR_RETENTION_MONTHS} mois après cette dernière visite (y compris après la suppression du compte, qui ne l'efface pas plus tôt) ; les empreintes antérieures à cette règle sont datées de sa mise en place`,
      "Adresse IP, navigateur et identifiant du compte jamais enregistrés tels quels",
    ],
    recipients: [
      "Staff de l'association",
      "Tout membre d'un serveur Discord où le bot est installé, pour les seuls totaux (visites et visiteurs), par la commande publique /stats-site",
    ],
    transfers: ["Aucun"],
    security: [
      ...COMMON_SECURITY,
      "Aucun cookie de mesure — une seule valeur de stockage de session (bg:last-visit-ping), jamais transmise, évite de signaler deux fois un même chargement ; le secret de salage n'est ni en base ni dans les sauvegardes, et sans lui aucune visite n'est comptée",
      "Opposition relue côté serveur (en-têtes Sec-GPC et DNT, cookie d'opposition) : une visite refusée n'est ni hachée, ni décomptée du plafond de débit, ni écrite",
    ],
  },
  {
    ref: "T07",
    name: "Présentation de l'association et recrutement de bénévoles",
    purpose: "Présenter le bureau et les bénévoles, et recruter",
    subPurposes: [
      "Page « Association » : membres du bureau et bénévoles",
      "Annonces de recrutement avec un contact Discord ou un lien",
    ],
    legalBasis: "Consentement des bénévoles et membres du bureau concernés",
    dataSubjects: ["Membres du bureau", "Bénévoles", "Auteurs d'annonces de recrutement"],
    dataCategories: [
      "Nom, prénom et pseudo, catégorie ou fonction, date d'arrivée, photo",
      "Pseudo et identifiant Discord ou lien de contact d'une annonce",
    ],
    sensitiveData: "Aucune",
    retention: ["Durée de l'engagement dans l'association, ou de publication de l'annonce"],
    recipients: ["Public du site"],
    transfers: ["Aucun"],
    security: COMMON_SECURITY,
  },
  {
    ref: "T08",
    name: "Bot Discord BlueGenji",
    purpose: "Fournir les services du bot sur les serveurs Discord partenaires",
    subPurposes: [
      "Relais des annonces entre les salons des serveurs partenaires, répercussion des modifications et suppressions, temps de recharge, compteur de messages de /stats, statistiques du tableau de bord, retrait des copies d'un utilisateur exclu",
      "Exclusion d'un utilisateur du relais par la modération — valable pour tout le réseau de serveurs partenaires (modération communautaire), d'où la liste des exclusions ouverte aux administrateurs de chaque serveur",
      "Statistiques d'activité (commande /stats, qui ne montre à chacun que sa propre activité ; tableau de bord du bot)",
      "Confirmation des adhésions à l'association et rappels programmés sur ses serveurs",
      "Remise des messages rédigés par le site : codes, rappels, avis de modération (signalement désignant la personne, logo masqué, retiré ou supprimé), demandes d'adhésion à une équipe et informations sur les données en message privé, sans conservation par le bot ; alertes d'arbitrage, signalements et journal d'activité du site (sans pseudo de joueur) publiés au salon de journal privé du staff, alertes d'arbitrage aussi envoyées aux membres du rôle d'arbitrage de chaque serveur qui en a défini un",
    ],
    legalBasis: "Intérêt légitime (faire fonctionner, modérer et mesurer le relais entre serveurs partenaires) ; les messages du site relèvent de la base de leur traitement d'origine",
    dataSubjects: [
      "Utilisateurs Discord des serveurs où le bot est installé",
      "Administrateurs et modérateurs de ces serveurs",
      "Adhérents de l'association dont l'adhésion est confirmée par le bot",
    ],
    dataCategories: [
      "Annonces relayées : identifiants du message d'origine et de son auteur, date, identifiants des copies et de leurs salons (contenu recopié dans les salons partenaires, jamais enregistré en base)",
      `Scrims et recrutement : identifiant de l'auteur, jeu, niveau ou rôle (choisi dans une liste fermée), serveur, date ; au-delà de ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} jours, seulement des nombres par jour, serveur et niveau ou rôle`,
      "Fil d'activité public de la page du bot : heure, type d'évènement (relais, scrim, recrutement, connexion), nom du serveur, niveau ou rôle — sans identifiant Discord",
      "Exclusions : identifiants de l'exclu et du modérateur, date ; identifiants et motif publiés au salon de journal privé du staff, motif copié en message privé au titulaire du bot, pseudos et motif affichés par /ban-list",
      "Configuration : identifiants de serveurs, salons et rôles, invitation, identifiant de l'administrateur qui l'a posée",
      "Adhésions et rappels programmés : identifiant du membre ou du rôle visé et de l'auteur, message, date du prochain envoi (pour une adhésion : sa date de péremption, donc la qualité d'adhérent), fréquence ; attestation d'adhésion remise en message privé sans être conservée",
      "Journal technique (salon privé du staff, journaux du serveur) : nom des serveurs qui ajoutent ou retirent le bot, erreurs pouvant citer un identifiant ; le bot n'y écrit plus de pseudo de lui-même, messages antérieurs à cette règle exceptés (le motif libre d'une exclusion ou une erreur de remise d'un message privé peuvent en citer un)",
    ],
    sensitiveData: "Aucune",
    retention: [
      `Suivi des annonces relayées : ${BOT_RELAY_RETENTION_DAYS} jours, effacé au relais suivant cette échéance et au plus tard dans la nuit ou au redémarrage du bot ; les copies publiées dans les salons partenaires restent sur Discord jusqu'à leur suppression (par l'auteur dans ce délai, ensuite par les administrateurs de chaque serveur)`,
      `Scrims et recrutement : ${BOT_ACTIVITY_AUTHOR_RETENTION_DAYS} jours ; ensuite, dans la nuit qui suit (ou à un redémarrage), identifiant de l'auteur effacé et lignes repliées en nombres par jour, serveur et niveau ou rôle, gardés sans limite de durée comme historique de l'activité du bot`,
      "Exclusions : enregistrement jusqu'à la levée de l'exclusion ; son avis et son motif (salon de journal privé du staff, et motif copié en message privé au titulaire du bot) sont supprimés à la levée — pour une exclusion antérieure à cette règle, seul le motif publié au salon, le reste suivant la durée du salon de journal",
      "Configuration (salons relayés et leurs filtres de rang, invitation et rôle d'arbitrage avec l'identifiant de qui les a posés, rôle d'administration du bot, modules) : jusqu'à son retrait par les administrateurs, au plus tard jusqu'au départ du bot du serveur, qui l'efface (un départ survenu pendant une interruption du bot, que Discord ne lui signale pas, est rattrapé à son redémarrage)",
      "Adhésions et rappels programmés : jusqu'au dernier envoi du rappel (pour une adhésion, sa date de péremption) ou sa suppression, au plus tard jusqu'au départ du bot du serveur où ils ont été enregistrés, qui les efface (départ pendant une interruption compris, rattrapé au redémarrage)",
      `Fil d'activité : ${BOT_FEED_EVENT_RETENTION_DAYS} jours, supprimé dans la nuit qui suit`,
      `Salon de journal privé du staff, et messages privés du bot au titulaire : ${BOT_STAFF_LOG_RETENTION_DAYS} jours (un an), puis supprimés par le ménage de nuit, par lots (plusieurs nuits pour un arriéré important) — sauf l'avis et le motif d'une exclusion en cours, supprimés à sa levée`,
      "Journaux du serveur : selon leur rotation automatique",
      `Sauvegardes : ${BACKUP_RETENTION_DAYS} jours au plus (traitement T09)`,
    ],
    recipients: [
      "Staff de l'association (modération, administration)",
      "Titulaire du bot (son hébergeur technique), pour les motifs d'exclusion reçus en message privé",
      "Utilisateur exclu, qui reçoit le motif de son exclusion en message privé quand il publie une annonce dans un salon relayé",
      "Membres du salon où /scrim ou /recrute est utilisée (réponse publique de la commande)",
      "Membres du rôle d'arbitrage de chaque serveur qui en a défini un (/set-referee-role), pour les alertes d'arbitrage du site",
      "Membres des serveurs partenaires, qui lisent les annonces relayées",
      "Administrateurs de tout serveur où le bot est installé (y compris un serveur créé pour l'y inviter) et titulaires du rôle d'administration du bot (/set-bot-admin), pour la liste des exclusions du réseau (/ban-list, réponse visible du seul demandeur) — l'exclusion vaut pour tout le réseau, chaque serveur doit savoir qui ne peut plus y publier",
      "Discord (plateforme d'exécution)",
    ],
    transfers: [`États-Unis : Discord — ${transferBasis(["DISCORD"])}`],
    security: COMMON_SECURITY,
  },
  {
    ref: "T09",
    name: "Sauvegardes",
    purpose: "Reprendre l'activité après une panne, une corruption ou une erreur de manipulation",
    subPurposes: [
      "Archive hebdomadaire des bases de données du site et du bot",
      "Copie horaire des images téléversées (avatars, logos, photos)",
      "Journal des suppressions de compte, rejoué après toute restauration",
    ],
    legalBasis: "Intérêt légitime (continuité du service)",
    dataSubjects: ["Toutes les personnes des autres traitements du registre"],
    dataCategories: ["Copie de l'ensemble des données ci-dessus", "Journal des suppressions : identifiant et date de création du compte, date de suppression"],
    sensitiveData: "Aucune",
    retention: [
      `Archives : ${BACKUP_RETENTION_DAYS} jours au plus, puis suppression définitive`,
      "Images : le temps de leur présence sur le site (retirées dans l'heure qui suit leur suppression)",
      `Journal des suppressions : ${ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS} jours par entrée`,
      `Copie de la base du bot écrite à côté d'elle avant une restauration (non chiffrée, sur la machine du bot) : supprimée à la restauration réussie suivante, au plus tard dans la nuit qui suit ses ${BACKUP_RETENTION_DAYS} jours`,
    ],
    recipients: [
      `${SITE_HOST.name}, responsable technique de l'association et hébergeur du site (sous-traitant — ${HOST_PROCESSING_AGREEMENT}), seul détenteur des clés de déchiffrement`,
      `${HETZNER_BACKUP_FRAMEWORK}, qui stocke les copies chiffrées sans pouvoir les lire`,
    ],
    // Stockage en Allemagne, traitement exclusivement dans l'UE/EEE (§ 3 du
    // contrat de Hetzner) : aucun transfert hors de l'Union.
    transfers: ["Aucun"],
    security: [
      `Chiffrement sur le serveur du site avant tout envoi (age pour les archives, remote rclone de type crypt pour les images, les logos masqués et le journal — vérifié en production le 30 septembre 2026, maintenu pour le stockage chez Hetzner) : clés détenues par le seul hébergeur du site, ${SITE_HOST.name}, et jamais transmises à Hetzner`,
      "Envoi chiffré en transit (HTTPS/TLS)",
      "Suppression définitive, sans corbeille ni historique de versions chez le fournisseur du stockage",
      "Clé privée des archives conservée hors du serveur ; clé des images et du journal sur le seul serveur, avec une copie de secours hors du serveur",
      "Suppressions de compte rejouées avant toute remise en service après restauration",
    ],
  },
  {
    ref: "T10",
    name: "Information des joueurs sur les changements de politique",
    purpose: "Informer chaque compte d'un changement du traitement de ses données",
    subPurposes: [
      "Présenter à la visite suivante les changements publiés dont le compte n'a pas encore pris connaissance (« J'ai pris connaissance » — aucun accord n'est demandé)",
      "Annoncer chaque changement une fois en message privé Discord aux comptes joignables qui n'en ont pas pris connaissance sur le site, une semaine après sa publication et au plus un message par mois",
    ],
    legalBasis: "Obligation légale d'information (RGPD, articles 12 à 14)",
    dataSubjects: ["Joueurs inscrits sur le site"],
    dataCategories: [
      "Changements dont le compte a pris connaissance, avec la date",
      "Annonces Discord déjà envoyées au compte, avec leur date",
      "Identifiant Discord ou pseudo Discord certifié, pour adresser l'annonce",
    ],
    sensitiveData: "Aucune",
    retention: ["Durée du compte (effacées avec lui)"],
    recipients: ["Le joueur lui-même", "Discord, qui achemine le message privé"],
    transfers: [`États-Unis : Discord (acheminement des messages privés) — ${transferBasis(["DISCORD"])}`],
    security: [...COMMON_SECURITY, "Une annonce réservée avant l'envoi, pour qu'aucun compte ne la reçoive deux fois"],
  },
  {
    ref: "T11",
    name: "Signalements, contestations et modération des contenus et des comptes",
    purpose: "Recevoir et traiter les signalements adressés à l'association, dont les notifications de contenu illicite",
    subPurposes: [
      "Recevoir un signalement de toute personne, avec ou sans compte (droit d'auteur, modération, bug, RGPD, hébergeur, autre)",
      "Prévenir les joueurs et les membres des équipes visés, et leur permettre de contester ; permettre à l'auteur d'un signalement de contester la décision prise",
      "Masquer un logo d'équipe ou un avatar de joueur signalé, puis le rétablir ou le supprimer définitivement ; retirer une image hors de tout signalement, sur un motif saisi par la modération",
      "Suspendre un compte contraire aux conditions d'utilisation (sessions fermées, connexion refusée pendant la suspension), en exposer les motifs à son titulaire, puis la lever ou la laisser échoir",
      "Accuser réception d'une notification de contenu illicite, puis notifier à son auteur la décision et les voies de recours",
      "Répondre aux demandes d'exercice des droits et aux demandes adressées à l'hébergeur, dont celles des autorités",
      "Recevoir par courriel ou par téléphone, auprès de la personne à contacter pour les demandes relatives aux données, les demandes d'exercice des droits et les questions sur le traitement des données, et y répondre",
      "Recevoir les demandes adressées au courriel ou au téléphone de l'association elle-même (publiés, protégés, sur les mentions légales), et y répondre",
      "Alerter les administrateurs sur Discord, sans donnée nominative",
    ],
    legalBasis:
      "Intérêt légitime (RGPD, art. 6.1.f) de l'association à faire respecter ses conditions d'utilisation pour la modération des contenus et des comptes qui y sont contraires — examen, masquage, retrait d'une image, suspension d'un compte, et conservation de la décision le temps de sa contestation ; obligation légale (RGPD, art. 6.1.c) pour les demandes d'exercice des droits (RGPD, art. 12), les notifications de contenu illicite, en droit d'auteur comme en modération (règlement (UE) 2022/2065, art. 16), les demandes adressées à l'hébergeur (art. 11 et 16) et les contestations (art. 20), sans case d'accord ; consentement du signalant (case à l'envoi) pour les signalements de bug et autres ; par courriel ou par téléphone comme par le formulaire (catégorie RGPD), une demande d'exercice des droits ou une question sur le traitement de ses données — qui relève du droit d'accès (RGPD, art. 15) — repose sur la même obligation légale",
    dataSubjects: [
      "Signalants, utilisateurs ou non (titulaires de droits, représentants, visiteurs)",
      "Joueurs et membres des équipes visés par un signalement",
      "Personnes, membres ou non, qui adressent une demande relative à leurs données par courriel ou par téléphone",
      "Personnes qui écrivent ou téléphonent à l'association",
    ],
    dataCategories: [
      "Catégorie, description, éléments désignés et page d'origine du signalement",
      `Compte du signalant s'il est connecté ; adresse électronique qu'il indique ; en droit d'auteur, ${copyrightNoticeElementsText()}`,
      "Contestations : texte, compte de leur auteur et adresse facultative",
      "Logos d'équipe et avatars de joueur masqués (fichier conservé hors ligne), date du masquage et de l'échéance ; motif d'un retrait décidé hors signalement (transmis à l'équipe ou au joueur, non conservé par le site)",
      "Suspensions de compte : compte visé, faits retenus, clause invoquée, dates de début, d'échéance et de levée, membre de la modération qui l'a prononcée ou levée",
      "Demandes relatives aux données reçues par courriel ou par téléphone : contenu de la demande et de la réponse, adresse électronique ou numéro de l'expéditeur, et souvent son nom",
      "Demandes reçues au courriel ou au téléphone de l'association : mêmes données",
    ],
    sensitiveData: "Aucune",
    retention: [
      `Signalement et contestations : durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après l'archivage (${LOGO_QUARANTINE_MONTHS} mois civils pour un signalement de droit d'auteur ou de modération envoyé depuis un compte, délai de contestation de son auteur) — prolongée tant qu'un logo ou un avatar masqué ou supprimé au titre du signalement peut encore être contesté (${LOGO_QUARANTINE_MONTHS} mois au plus après la décision)`,
      `Demande reçue par courriel ou par téléphone : même règle qu'une demande RGPD faite depuis le formulaire — durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après la clôture de la demande (l'équivalent de l'archivage d'un signalement), avant suppression de la messagerie de la personne à contacter (courriel) ou de son téléphone (SMS reçus et envoyés, messagerie vocale, journal d'appels)`,
      `Demande reçue au courriel ou au téléphone de l'association : même règle — durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après sa clôture, avant suppression de la messagerie ou du téléphone de l'association`,
      `Logo ou avatar masqué : ${LOGO_QUARANTINE_MONTHS} mois au plus sans contestation (délai de contestation de l'art. 20.1 du règlement (UE) 2022/2065, que l'association applique), puis suppression définitive ; contesté, jusqu'à la décision`,
      `Suspension de compte : tant qu'elle court, puis ${SUSPENSION_RETENTION_MONTHS} mois après sa levée ou son échéance (même délai de contestation), effacée lors de la première connexion au site qui suit ce délai ; effacée avec le compte, ou à son anonymisation`,
    ],
    recipients: [
      "Administrateurs de l'association",
      "Joueurs et membres des équipes visés : motif et description du signalement, jamais l'identité du signalant",
      "Titulaire d'un compte suspendu : la décision, les faits retenus et la clause invoquée, jamais le nom du membre de la modération qui l'a prononcée",
      "Discord, qui achemine les alertes et les messages privés (sans nom, adresse ni description)",
      `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE}, personne chargée par l'association des demandes relatives aux données : demandes reçues par courriel ou par téléphone`,
      "Opérateur téléphonique de cette personne : demandes faites par téléphone (appel, SMS, messagerie vocale)",
      `Microsoft, qui héberge la messagerie de cette personne (${OUTLOOK_MAIL_FRAMEWORK}) : demandes reçues et réponses envoyées par courriel`,
      "Membres du bureau de l'association qui relèvent son courriel et son téléphone",
      `Google (${ASSOCIATION_GMAIL_FRAMEWORK}) : demandes reçues et réponses envoyées par le courriel de l'association`,
      "Opérateur téléphonique de la ligne de l'association : demandes faites à son téléphone",
    ],
    transfers: [
      `États-Unis : Discord (acheminement des alertes et des messages privés) — ${transferBasis(["DISCORD"])}`,
      `Possibles vers les États-Unis : Microsoft (messagerie Outlook.com de la personne à contacter, demandes reçues et réponses envoyées par courriel) — ${transferBasis(["MICROSOFT"])}`,
      `Possibles vers les États-Unis : Google (messagerie Gmail de l'association) — ${transferBasis(["GOOGLE"])}`,
    ],
    security: [
      ...COMMON_SECURITY,
      "Panneau de traitement réservé aux administrateurs ; page d'un signalement ouverte aux seules personnes visées",
      "Plafonds d'envoi par personne et par heure",
      "Logo ou avatar masqué déplacé hors du dossier servi par le site ; aperçu réservé aux administrateurs",
      "Suspension réservée à la permission de modération, impossible sur son propre compte ou sur celui d'un administrateur ; le journal Discord du staff n'en porte ni le pseudo du joueur ni le motif",
      "Demandes reçues par courriel ou par téléphone : aucune mesure propre à l'association au-delà de la suppression après la durée de conservation ; elles ne sont protégées que par les mesures de Microsoft ou de Google (messageries), des opérateurs téléphoniques et des appareils qui les reçoivent",
    ],
  },
  {
    ref: "T12",
    name: "Notifications push",
    purpose: "Prévenir un joueur sur ses appareils, à sa demande, de ce qui le concerne sur le site",
    subPurposes: [
      "Départ de ses matchs, score à confirmer, coup d'envoi d'un tournoi, rappels de match",
      "Demandes d'adhésion à une équipe qu'il gère, signalements et décisions de modération le concernant, changements de la politique de données",
      "Alertes d'arbitrage et de modération pour le staff qui détient ces rôles",
    ],
    legalBasis: "Consentement (activation sur chaque appareil, retirable à tout moment, sujet par sujet)",
    dataSubjects: ["Joueurs inscrits qui activent les notifications sur un appareil"],
    dataCategories: [
      "Adresse d'abonnement de l'appareil, fournie par le navigateur, et ses clés de chiffrement",
      "Date d'abonnement et de la dernière notification remise",
      "Sujets de notification coupés par le compte",
    ],
    sensitiveData: "Aucune",
    retention: [
      "Abonnement : jusqu'à sa désactivation, sa révocation par le navigateur, ou la suppression du compte",
      `Abonnement resté sans notification remise : ${PUSH_SUBSCRIPTION_RETENTION_DAYS} jours au plus`,
      "Sujets coupés : durée du compte",
    ],
    recipients: [
      "Le joueur lui-même",
      "Le service de push de son navigateur (Google, Mozilla, Apple ou Microsoft), qui achemine un message chiffré qu'il ne peut pas lire",
    ],
    transfers: [
      `États-Unis : service de push du navigateur choisi par le joueur, qui ne reçoit que des messages chiffrés de bout en bout (RFC 8291) — ${transferBasis(["GOOGLE", "MOZILLA", "APPLE", "MICROSOFT"])}`,
    ],
    security: [
      ...COMMON_SECURITY,
      "Contenu chiffré pour le seul appareil abonné ; envois signés par la clé du site (VAPID)",
      "Aucun pseudo de joueur dans une notification",
      "Services de push acceptés limités à ceux des navigateurs du marché",
    ],
  },
  {
    ref: "T13",
    name: "Acceptation des conditions d'utilisation",
    purpose: "Garder la preuve que les conditions d'utilisation du site ont été acceptées, et laquelle de leurs versions",
    subPurposes: [
      "Recueillir l'acceptation à la création du compte, à la création d'une équipe et en recevant la gestion d'une équipe",
      "Redemander l'acceptation quand les conditions changent de version",
    ],
    legalBasis: "Exécution du service demandé par le joueur (contrat)",
    dataSubjects: ["Joueurs inscrits sur le site"],
    dataCategories: ["Version acceptée, contexte de l'acceptation (création du compte, connexion, création ou gestion d'une équipe), date"],
    sensitiveData: "Aucune",
    retention: [
      "Durée du compte",
      "À la suppression : effacement complet, que le compte soit effacé ou anonymisé — le détail des acceptations comme la dernière version acceptée et sa date",
    ],
    recipients: ["Le joueur lui-même, par l'export de ses données", "Responsable technique de l'association, qui administre la base"],
    transfers: ["Aucun"],
    security: COMMON_SECURITY,
  },
  {
    ref: "T14",
    name: "Journal des données de connexion",
    purpose:
      "Conserver les données permettant d'identifier l'auteur d'un contenu publié par un membre (logo, avatar, nom d'équipe), que l'association héberge",
    subPurposes: [
      "Consigner chaque ouverture de session (adresse IP, date et heure, moyen de connexion)",
      "Communiquer ces données à une autorité judiciaire qui les requiert, et à elle seule",
    ],
    legalBasis:
      "Obligation légale (RGPD, art. 6.1.c) de l'hébergeur de contenus : LCEN, art. 6 ; décret n° 2021-1362",
    dataSubjects: ["Joueurs inscrits sur le site"],
    dataCategories: [
      "Identifiant interne du compte",
      "Adresse IP de connexion, telle que la retient le serveur mandataire du site",
      "Date et heure de la connexion, moyen de connexion (Google, Discord, Blizzard ou code en message privé)",
      "Ni port source de la connexion, ni journal de la création ou de la modification des contenus (seules les ouvertures de session sont consignées), ni informations fournies à la création du compte : celles-ci partent avec le compte (hors les copies de sauvegarde chiffrées et le journal des suppressions, T09)",
    ],
    sensitiveData: "Aucune",
    retention: [
      `${CONNECTION_LOG_RETENTION_DAYS} jours (un an) après chaque connexion, puis effacement automatique`,
      "Gardé jusqu'à cette échéance même après la suppression du compte (RGPD, art. 17.3.b)",
    ],
    recipients: [
      "Autorités judiciaires, sur réquisition",
      "Le joueur lui-même, par l'export de ses données, tant que son compte existe",
      "Responsable technique de l'association, qui administre la base et répond aux réquisitions",
    ],
    transfers: ["Aucun"],
    security: [
      ...COMMON_SECURITY,
      "Aucun écran ni aucune route du site ne consulte ce journal ; il ne sert à aucune autre finalité",
    ],
  },
  {
    ref: "T15",
    name: "Portail de support (Spiceworks)",
    purpose:
      "Recevoir et traiter les demandes de support et de modération qui ne portent pas sur un contenu du site (comportement en match, insulte, triche, litige sur Discord)",
    subPurposes: [
      "Recevoir un ticket sur le portail de support de l'association, que le site ne fait que lier (aucune donnée n'y est transmise par le site)",
      "Échanger avec le demandeur, instruire la demande et la clore",
    ],
    legalBasis:
      "Intérêt légitime (RGPD, art. 6.1.f) de l'association à faire respecter les règles de ses tournois et de sa communauté, et à répondre aux demandes qu'on lui adresse",
    dataSubjects: ["Demandeurs (joueurs ou non)", "Personnes désignées dans un ticket"],
    dataCategories: [
      "Contenu du ticket et des échanges, pièces jointes éventuelles",
      "Coordonnées que le demandeur indique pour recevoir la réponse, pseudos cités",
    ],
    sensitiveData: "Aucune",
    retention: [
      `Ticket : durée de son traitement, puis ${SUPPORT_TICKET_RETENTION_MONTHS} mois après sa clôture, puis suppression par l'association`,
    ],
    recipients: [
      "Membres du staff de l'association chargés du support et de la modération",
      `Spiceworks, qui héberge le portail (${SPICEWORKS_PROCESSOR_FRAMEWORK})`,
    ],
    transfers: [
      `Possibles vers les États-Unis : Spiceworks — ${transferBasis(["SPICEWORKS"])} ; ${SPICEWORKS_SCC_FALLBACK}`,
    ],
    security: [
      "Accès au portail réservé aux membres du staff chargés du support",
      "Suppression des tickets clos au terme de la durée de conservation",
    ],
  },
  {
    ref: "T16",
    name: "Retransmission des matchs",
    purpose: "Diffuser en direct les matchs des tournois et en garder la rediffusion",
    subPurposes: [
      "Diffuser un match en direct sur la chaîne de l'association ou d'un caster (YouTube, Twitch ou Kick)",
      "Publier sur la fiche du match le lien de sa rediffusion YouTube",
    ],
    legalBasis:
      "Intérêt légitime (RGPD, art. 6.1.f) de l'association à faire connaître ses compétitions, objet de ses statuts ; droit d'opposition (art. 21) ouvert à chaque joueur",
    dataSubjects: ["Joueurs des matchs diffusés", "Casters"],
    dataCategories: [
      "Pseudos en jeu et du site, noms d'équipe, images de la partie, résultats et performances en jeu, tels qu'ils apparaissent à l'écran — ni webcam ni chat vocal des joueurs",
      "Voix et pseudo des casters",
      "Lien de la diffusion et de la rediffusion d'un match",
    ],
    sensitiveData: "Aucune",
    retention: [
      "Direct : aucune conservation par le site, qui ne garde que le lien de la chaîne",
      "Lien de rediffusion : conservé avec le match, comme ses résultats (T03) ; la vidéo reste sur la plateforme jusqu'à sa suppression par la chaîne qui l'a publiée",
      "Droit d'opposition : sur demande (formulaire « Signaler un problème », catégorie RGPD), le joueur apparaît sous un nom neutre dans les diffusions suivantes, le lien de rediffusion est retiré du site, et une vidéo publiée par la chaîne de l'association est masquée ou supprimée",
    ],
    recipients: [
      "Public des plateformes de diffusion et du site",
      "Plateformes de diffusion (YouTube, Twitch, Kick), responsables de leur propre traitement, y compris des données de leurs spectateurs ; le site ne fait que lier les chaînes et n'intègre aucun lecteur, il ne leur transmet aucune donnée",
    ],
    // Le site ne transmet rien aux plateformes : la diffusion est publiée par la
    // chaîne qui la produit, chaque plateforme traitant ses spectateurs en
    // responsable de son propre traitement.
    transfers: ["Aucun"],
    security: [
      ...COMMON_SECURITY,
      "Liens de diffusion limités à une liste de plateformes, aucun lecteur intégré ; aucune donnée de contact affichée à l'écran par le site",
      "Aucune webcam ni chat vocal des joueurs à l'écran",
    ],
  },
  {
    ref: "T17",
    name: "Journaux d'accès du serveur web",
    purpose: "Assurer la sécurité du serveur et diagnostiquer les pannes",
    subPurposes: [
      "Consigner chaque requête reçue par le serveur mandataire (nginx) du site",
      "Détecter les attaques et les abus, comprendre une panne",
    ],
    legalBasis: "Intérêt légitime (RGPD, art. 6.1.f) : sécurité du service (art. 32)",
    dataSubjects: ["Visiteurs du site"],
    dataCategories: [
      `${WEB_ACCESS_LOG_FIELDS.charAt(0).toUpperCase()}${WEB_ACCESS_LOG_FIELDS.slice(1)} (format de journal par défaut de nginx)`,
    ],
    sensitiveData: "Aucune",
    retention: [
      `${WEB_ACCESS_LOG_RETENTION_DAYS} jours au plus, par rotation automatique, puis suppression`,
    ],
    recipients: ["Responsable technique de l'association, qui est aussi l'hébergeur du site"],
    transfers: ["Aucun"],
    security: [
      ...COMMON_SECURITY,
      "Journaux lisibles du seul administrateur du serveur, jamais exposés par le site",
    ],
  },
];

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
