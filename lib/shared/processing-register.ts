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
} from "@/lib/shared/site-visits";
import { SITE_HOST } from "@/lib/shared/site-host";
import { REPORT_RETENTION_DAYS_AFTER_RESOLUTION, copyrightNoticeElementsText } from "@/lib/shared/content-reports";
import { LOGO_QUARANTINE_MONTHS } from "@/lib/shared/logo-quarantine";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";
import { PUSH_SUBSCRIPTION_RETENTION_DAYS } from "@/lib/shared/push-notifications";
import {
  ASSOCIATION_NAME,
  ASSOCIATION_SEAT,
  DATA_CONTACT_NAME,
  DATA_CONTACT_ROLE,
  RGPD_CONTACT_LINE,
} from "@/lib/shared/legal-contact";

/** Date de dernière mise à jour du registre (AAAA-MM-JJ). À avancer à chaque modification. */
export const REGISTER_UPDATED_AT = "2026-09-30";

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
 *   `blueGenjiBot/src/messages/manageMsgExpiration.ts` — les traces d'une
 *   annonce relayée sont effacées au **relais suivant** cette échéance, jamais
 *   au redémarrage.
 * - `BOT_LINK_CODE_VALIDITY_MINUTES` : validité du code de `/link`
 *   (`blueGenjiBot/src/commandsHandlers/link.ts`).
 */
export const BOT_RELAY_RETENTION_DAYS = 7;
export const BOT_LINK_CODE_VALIDITY_MINUTES = 10;

/**
 * Encadrement des transferts hors de l'Union européenne (RGPD art. 45 et 46),
 * **destinataire par destinataire** : la formule conditionnelle d'avant
 * (« adéquation pour un destinataire certifié, à défaut clauses contractuelles
 * types ») ne disait pour aucun d'eux sur quoi il reposait. Écrit une fois pour
 * le registre et pour `/rgpd`.
 */
export type TransferRecipient = "DISCORD" | "GOOGLE" | "MICROSOFT" | "APPLE" | "MOZILLA" | "BLIZZARD";

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
  BLIZZARD: { name: "Blizzard", mechanism: "SCC" },
};

/** Tous les destinataires hors UE, dans l'ordre où `/rgpd` les nomme. */
export const ALL_TRANSFER_RECIPIENTS: readonly TransferRecipient[] = [
  "DISCORD",
  "GOOGLE",
  "MICROSOFT",
  "APPLE",
  "MOZILLA",
  "BLIZZARD",
];

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} et ${names[names.length - 1]}`;
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
 * Cadre des sauvegardes déposées sur OneDrive. Le compte est **personnel** : il
 * relève du Contrat de services Microsoft et de sa déclaration de
 * confidentialité, sans contrat de sous-traitance (le DPA de Microsoft ne vaut
 * que pour ses offres professionnelles), et Microsoft n'y garantit aucun lieu de
 * stockage — d'où aucune localisation affirmée. Le chiffrement avant envoi, sur
 * le serveur du site, est une mesure de sécurité (art. 32) : il ne tient lieu ni
 * de contrat de sous-traitance (art. 28) ni de mécanisme de transfert (art. 44
 * et s.). Le chiffrement au repos de Microsoft et le TLS en transit s'y ajoutent.
 */
export const ONEDRIVE_BACKUP_FRAMEWORK =
  "compte Microsoft personnel, régi par le Contrat de services Microsoft et la déclaration de confidentialité de Microsoft, sans contrat de sous-traitance ; lieu de stockage non garanti par Microsoft";

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
    dataContact: `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE}, chargé par l'association de recevoir les demandes relatives aux données (coordonnées : contact ci-dessus). Il n'est pas délégué à la protection des données au sens de l'article 37 du RGPD ; l'association reste responsable du traitement`,
    host: `${SITE_HOST.name} (${SITE_HOST.status.toLowerCase()}), ${SITE_HOST.address} — sous-traitant, données hébergées en ${SITE_HOST.country} (site et bot Discord sur ${SITE_HOST.machine})`,
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
 * personnelles ») alors qu'il ne décrit que le site et son bot : les activités
 * que l'association mène ailleurs n'y ont pas encore de fiche. Les nommer vaut
 * mieux qu'une promesse que le document ne tient pas.
 */
export const REGISTER_SCOPE =
  "Le registre décrit les traitements de données personnelles du site et du bot Discord de l'association";

export const REGISTER_NOT_YET_COVERED =
  "Les journaux techniques du serveur web, et les activités que l'association mène hors du site — gestion des adhésions, portail de support (Spiceworks), retransmission des matchs —, n'y ont pas encore de fiche : pour toute question à leur sujet, utilisez les moyens de contact de la politique de confidentialité.";

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
      "À la suppression : effacement complet si le compte n'a laissé aucune trace (aucun match joué, aucune inscription en tournoi individuel, aucune équipe possédée, aucun tournoi organisé), anonymisation immédiate sinon — le pseudo est remplacé par un pseudo d'emprunt ; dans les deux cas, le journal des données de connexion (T14) est gardé jusqu'à son échéance légale",
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
      "Identifiants de connexion : durée du compte, ou jusqu'au détachement du fournisseur",
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
      "Consentement (certification du pseudo Discord, geste distinct fait par le joueur depuis son profil — jamais acquise par la seule connexion — et retirable en retirant son tag) et intérêt légitime (bon déroulement des tournois)",
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
      "Messages Discord : conservés dans un salon réservé au staff, purgé à la main par l'association",
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
    subPurposes: ["Compter visites et visiteurs uniques (24 h, 7 jours, 30 jours, total)"],
    legalBasis: "Intérêt légitime (art. 6.1.f RGPD : connaître la fréquentation du site), sans cookie ni traceur tiers ; droit d'opposition (art. 21) exercé par le formulaire de signalement, catégorie RGPD, ou auprès du contact Discord",
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
      "Une empreinte par visiteur, sans page ni date mais avec l'indicateur « visiteur connecté », conservée sans limite de durée pour le nombre de visiteurs uniques depuis la mise en service, y compris après la suppression du compte",
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
      "Relais des annonces entre les salons des serveurs partenaires, répercussion des modifications et suppressions, temps de recharge",
      "Exclusion d'un utilisateur du relais par la modération",
      "Statistiques d'activité (commande /stats, tableau de bord du bot)",
      "Commande /link (code à usage unique, qu'aucune page du site ne permet encore de saisir) ; confirmation des adhésions à l'association et rappels programmés sur ses serveurs",
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
      "Scrims et recrutement : identifiant de l'auteur, jeu, niveau ou rôle, serveur, date",
      "Exclusions : identifiants de l'exclu et du modérateur, date ; pseudos et motif publiés au salon de journal privé du staff et affichés par /ban-list",
      "Commande /link : identifiant Discord, code à usage unique et son échéance",
      "Configuration : identifiants de serveurs, salons et rôles, invitation, identifiant de l'administrateur qui l'a posée",
      "Adhésions et rappels programmés : identifiant du membre ou du rôle visé et de l'auteur, message, date du prochain envoi (pour une adhésion : sa date de péremption, donc la qualité d'adhérent), fréquence ; attestation d'adhésion remise en message privé sans être conservée",
      "Journal technique (salon privé du staff, journaux du serveur) : nom des serveurs qui ajoutent ou retirent le bot, erreurs pouvant citer un pseudo ou un identifiant",
    ],
    sensitiveData: "Aucune",
    retention: [
      `Suivi des annonces relayées : ${BOT_RELAY_RETENTION_DAYS} jours, effacé au relais suivant cette échéance (rien n'est effacé au redémarrage) ; les copies publiées dans les salons partenaires restent sur Discord jusqu'à leur suppression (par l'auteur dans ce délai, ensuite par les administrateurs de chaque serveur)`,
      "Scrims et recrutement : aucune suppression automatique à ce jour, jusqu'à une demande d'effacement",
      "Exclusions : jusqu'à la levée de l'exclusion",
      `Commande /link : code valable ${BOT_LINK_CODE_VALIDITY_MINUTES} minutes ; la ligne n'est pas supprimée automatiquement à ce jour`,
      "Configuration : salons relayés jusqu'à leur retrait ou au départ du bot du serveur ; invitation et rôle d'arbitrage (avec l'identifiant de qui les a posés) et rôle d'administration du bot, jusqu'à leur retrait par les administrateurs, conservés sans limite si le bot quitte le serveur",
      "Adhésions et rappels programmés : jusqu'au dernier envoi du rappel (pour une adhésion, sa date de péremption) ou sa suppression",
      "Salon de journal privé du staff : aucune suppression automatique à ce jour",
      "Journaux du serveur : selon leur rotation automatique",
      `Sauvegardes : ${BACKUP_RETENTION_DAYS} jours au plus (traitement T09)`,
    ],
    recipients: [
      "Staff de l'association (modération, administration)",
      "Membres du rôle d'arbitrage de chaque serveur qui en a défini un (/set-referee-role), pour les alertes d'arbitrage du site",
      "Membres des serveurs partenaires, qui lisent les annonces relayées",
      "Administrateurs de tout serveur où le bot est installé et titulaires du rôle d'administration du bot (/set-bot-admin), pour la liste des exclusions (/ban-list, réponse visible du seul demandeur)",
      "Tout utilisateur du bot, pour les compteurs d'activité d'un autre utilisateur (/stats, réponse visible du seul demandeur)",
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
    ],
    recipients: [
      "Responsable technique de l'association, qui est aussi l'hébergeur du site, seul détenteur des clés de déchiffrement",
      `Microsoft (OneDrive de l'hébergeur du site — ${ONEDRIVE_BACKUP_FRAMEWORK}), qui stocke les copies chiffrées sans pouvoir les lire`,
    ],
    transfers: [
      `Possibles vers les États-Unis (lieu de stockage non garanti par Microsoft) : Microsoft, qui ne reçoit que des données chiffrées avant envoi avec une clé que Microsoft ne détient pas — ${transferBasis(["MICROSOFT"])}`,
    ],
    security: [
      "Chiffrement sur le serveur du site avant tout envoi (age pour les archives, rclone crypt pour les images, les logos masqués et le journal) : aucune clé n'est transmise à Microsoft",
      "Mesures complémentaires de Microsoft : chiffrement au repos de ses serveurs, envoi chiffré en transit (HTTPS/TLS)",
      "Suppression définitive, sans corbeille ni historique de versions",
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
    name: "Signalements, contestations et modération des contenus",
    purpose: "Recevoir et traiter les signalements adressés à l'association, dont les notifications de contenu illicite",
    subPurposes: [
      "Recevoir un signalement de toute personne, avec ou sans compte (droit d'auteur, modération, bug, RGPD, hébergeur, autre)",
      "Prévenir les joueurs et les membres des équipes visés, et leur permettre de contester ; permettre à l'auteur d'un signalement de contester la décision prise",
      "Masquer un logo d'équipe ou un avatar de joueur signalé, puis le rétablir ou le supprimer définitivement",
      "Accuser réception d'une notification de contenu illicite, puis notifier à son auteur la décision et les voies de recours",
      "Répondre aux demandes d'exercice des droits et aux demandes adressées à l'hébergeur, dont celles des autorités",
      "Alerter les administrateurs sur Discord, sans donnée nominative",
    ],
    legalBasis:
      "Obligation légale (RGPD, art. 6.1.c) pour les demandes d'exercice des droits (RGPD, art. 12), les notifications de contenu illicite, en droit d'auteur comme en modération (règlement (UE) 2022/2065, art. 16), les demandes adressées à l'hébergeur (art. 11 et 16) et les contestations (art. 20), sans case d'accord ; consentement du signalant (case à l'envoi) pour les signalements de bug et autres",
    dataSubjects: [
      "Signalants, membres ou non (titulaires de droits, représentants, visiteurs)",
      "Joueurs et membres des équipes visés par un signalement",
    ],
    dataCategories: [
      "Catégorie, description, éléments désignés et page d'origine du signalement",
      `Compte du signalant s'il est connecté ; adresse électronique qu'il indique ; en droit d'auteur, ${copyrightNoticeElementsText()}`,
      "Contestations : texte, compte de leur auteur et adresse facultative",
      "Logos d'équipe et avatars de joueur masqués (fichier conservé hors ligne), date du masquage et de l'échéance",
      "Demandes relatives aux données reçues par courriel ou par téléphone : contenu de la demande, adresse électronique ou numéro de l'expéditeur",
    ],
    sensitiveData: "Aucune",
    retention: [
      `Signalement et contestations : durée du traitement, puis ${REPORT_RETENTION_DAYS_AFTER_RESOLUTION} jours après l'archivage (${LOGO_QUARANTINE_MONTHS} mois civils pour un signalement de droit d'auteur ou de modération envoyé depuis un compte, délai de contestation de son auteur) — prolongée tant qu'un logo ou un avatar masqué ou supprimé au titre du signalement peut encore être contesté (${LOGO_QUARANTINE_MONTHS} mois au plus après la décision)`,
      "Demande reçue par courriel ou par téléphone : durée de conservation dans la messagerie de la personne à contacter non encore fixée par l'association",
      `Logo ou avatar masqué : ${LOGO_QUARANTINE_MONTHS} mois au plus sans contestation (délai de contestation de l'art. 20.1 du règlement (UE) 2022/2065, que l'association applique), puis suppression définitive ; contesté, jusqu'à la décision`,
    ],
    recipients: [
      "Administrateurs de l'association",
      "Joueurs et membres des équipes visés : motif et description du signalement, jamais l'identité du signalant",
      "Discord, qui achemine les alertes et les messages privés (sans nom, adresse ni description)",
      `${DATA_CONTACT_NAME}, ${DATA_CONTACT_ROLE}, personne chargée par l'association des demandes relatives aux données : demandes reçues par courriel ou par téléphone`,
      "Microsoft, qui héberge la messagerie de cette personne (Outlook.com, compte personnel) : demandes reçues par courriel",
    ],
    transfers: [
      `États-Unis : Discord (acheminement des alertes et des messages privés) — ${transferBasis(["DISCORD"])}`,
      `Possibles vers les États-Unis : Microsoft (messagerie Outlook.com de la personne à contacter, demandes reçues par courriel) — ${transferBasis(["MICROSOFT"])}`,
    ],
    security: [
      ...COMMON_SECURITY,
      "Panneau de traitement réservé aux administrateurs ; page d'un signalement ouverte aux seules personnes visées",
      "Plafonds d'envoi par personne et par heure",
      "Logo ou avatar masqué déplacé hors du dossier servi par le site ; aperçu réservé aux administrateurs",
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
