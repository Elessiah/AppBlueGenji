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
 * Module pur : aucune lecture d'environnement, le contact est passé en argument.
 */
import { ACCOUNT_DELETION_JOURNAL_RETENTION_DAYS, BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { SITE_VISIT_WINDOW_MINUTES } from "@/lib/shared/site-visits";
import { SITE_HOST } from "@/lib/shared/site-host";

/** Date de dernière mise à jour du registre (AAAA-MM-JJ). À avancer à chaque modification. */
export const REGISTER_UPDATED_AT = "2026-09-25";

/**
 * Durées appliquées par le serveur, et déclarées ici : `lib/server/auth.ts` et
 * `lib/server/users-service.ts` les importent, si bien que le registre ne peut
 * pas annoncer une durée que le code ne tient pas.
 */
export const SESSION_RETENTION_DAYS = 30;
export const DISCORD_CODE_VALIDITY_MINUTES = 10;

export interface RegisterController {
  name: string;
  legalForm: string;
  seat: string;
  contactEmail: string;
  dpo: string;
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

export function registerController(contactEmail: string): RegisterController {
  return {
    name: "BlueGenji",
    legalForm: "Association loi 1901",
    seat: "Janvilliers (France)",
    contactEmail,
    dpo: "Aucun délégué à la protection des données désigné (désignation non obligatoire) — contact RGPD à l'adresse ci-dessus",
    host: `${SITE_HOST.name} (${SITE_HOST.status.toLowerCase()}, SIREN ${SITE_HOST.siren}), ${SITE_HOST.address} — sous-traitant, données hébergées en ${SITE_HOST.country}`,
  };
}

const COMMON_SECURITY = [
  "Accès au serveur réservé au responsable technique (authentification par clé SSH, bannissement automatique des tentatives échouées)",
  "Chiffrement des échanges (HTTPS)",
  "Droits d'administration par rôle, limités à ce que chaque mission exige",
];

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
    legalBasis: "Consentement (création du compte, choix des données affichées)",
    dataSubjects: ["Joueurs inscrits sur le site"],
    dataCategories: [
      "Pseudo du site, avatar (copié sur nos serveurs)",
      "Pseudos Overwatch (BattleTag), Marvel Rivals et Discord ; certification du pseudo Discord",
      "Majorité déclarée (oui / non / non renseignée)",
      "Réglages de visibilité, disponibilité pour le recrutement, rôles sur la plateforme",
      "Aucun nom réel, aucune adresse e-mail, aucun numéro de téléphone, aucune adresse postale",
    ],
    sensitiveData: "Aucune",
    retention: [
      "Durée du compte",
      "À la suppression : effacement complet si le compte n'a laissé aucune trace (aucun match joué, aucune inscription en tournoi individuel, aucune équipe possédée, aucun tournoi organisé), anonymisation immédiate sinon — le pseudo est remplacé par un pseudo d'emprunt",
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
      "Invite de connexion Google One Tap, sur la seule page de connexion et après acceptation de la politique de confidentialité",
      "Connexion par code à six chiffres envoyé en message privé Discord par le bot",
      "Rattachement de plusieurs moyens de connexion à un même compte",
    ],
    legalBasis: "Exécution du service demandé par le joueur (contrat)",
    dataSubjects: [
      "Joueurs inscrits sur le site",
      "Visiteurs de la page de connexion ayant accepté la politique (invite Google One Tap)",
    ],
    dataCategories: [
      "Identifiants techniques opaques Google, Discord et Blizzard",
      "Identifiant Discord et pseudo Discord (connexion par code)",
      "Porte de rattachement du compte Discord (bouton OAuth ou code en message privé)",
      "Code de connexion (conservé uniquement sous forme d'empreinte), nombre d'essais",
      "Adresse IP (en mémoire uniquement, pour limiter les essais — jamais écrite)",
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
      "Possibles vers les États-Unis, selon le fournisseur que le joueur choisit pour se connecter (Google, Discord, Blizzard), dans le cadre des garanties propres à chacun",
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
      "Résultats et palmarès : sans limite de durée (mémoire sportive) ; un compte supprimé y apparaît sous un pseudo d'emprunt",
      "Droit d'opposition ouvert sur demande",
    ],
    recipients: ["Public du site", "Staff d'arbitrage et d'administration"],
    transfers: ["Aucun"],
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
      "Exposer le pseudo Discord certifié aux administrateurs, et aux arbitres tant que le joueur est engagé dans un tournoi en cours",
      "Au lancement d'un match, présenter aux joueurs des deux équipes et au caster inscrit le pseudo Discord certifié et le BattleTag d'un ou deux joueurs par équipe, et ceux du caster, jusqu'à la fin du match",
      "Recueillir les « Prêt » de chaque partie d'un match (équipes, caster) avant son lancement",
      "Envoyer des rappels de match en message privé Discord (une semaine, 24 h et 1 h avant)",
      "Alerter le rôle arbitre (conflit de score, report expiré, signalement d'un joueur)",
    ],
    legalBasis: "Consentement (certification du pseudo Discord par le joueur) et intérêt légitime (bon déroulement des tournois)",
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
    transfers: ["États-Unis : Discord (acheminement des messages privés), dans le cadre des garanties propres à Discord"],
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
    transfers: ["États-Unis : Discord, dans le cadre des garanties propres à Discord"],
    security: [...COMMON_SECURITY, "Salon privé, accès restreint par rôle Discord"],
  },
  {
    ref: "T06",
    name: "Mesure d'audience du site",
    purpose: "Connaître la fréquentation du site",
    subPurposes: ["Compter visites et visiteurs uniques (24 h, 7 jours, 30 jours, total)"],
    legalBasis: "Intérêt légitime (statistiques de fréquentation, sans cookie ni traceur tiers)",
    dataSubjects: ["Visiteurs du site"],
    dataCategories: [
      "Empreinte salée par un secret du serveur (SHA-256), dérivée du compte ou de l'adresse IP et du navigateur : elle rend un visiteur unique sans permettre de remonter à lui",
      "Page consultée (sans paramètres d'URL), date",
      "Indicateur « visiteur connecté » (oui / non), sans le compte concerné",
      `Plusieurs chargements d'un même visiteur en ${SITE_VISIT_WINDOW_MINUTES} minutes ne comptent qu'une visite`,
    ],
    sensitiveData: "Aucune",
    retention: [
      "Visites conservées sans limite de durée pour le total depuis la mise en service — elles ne désignent aucune personne",
      "Adresse IP, navigateur et identifiant du compte jamais enregistrés",
    ],
    recipients: ["Staff de l'association (commande Discord des statistiques)"],
    transfers: ["Aucun"],
    security: [
      ...COMMON_SECURITY,
      "Aucun cookie de mesure ; le secret de salage n'est ni en base ni dans les sauvegardes, et sans lui aucune visite n'est comptée",
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
      "Synchronisation de contenu entre serveurs, modération, temps de recharge",
      "Envoi des codes de connexion et des rappels de match du site",
    ],
    legalBasis: "Intérêt légitime (service rendu aux serveurs qui installent le bot)",
    dataSubjects: ["Utilisateurs Discord des serveurs où le bot est installé"],
    dataCategories: [
      "Identifiants d'utilisateurs, de messages et de salons",
      "Nom des serveurs qui ajoutent ou retirent le bot",
      "Contenu des messages traité à la volée, jamais stocké",
    ],
    sensitiveData: "Aucune",
    retention: [
      "Identifiants de messages : 72 heures",
      "Identifiants de salons : jusqu'à la suppression de la liaison par le serveur",
      "Identifiants d'utilisateurs : le temps nécessaire aux temps de recharge et à la modération",
    ],
    recipients: ["Staff de l'association", "Discord (plateforme d'exécution)"],
    transfers: ["États-Unis : Discord, dans le cadre des garanties propres à Discord"],
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
    recipients: ["Responsable technique de l'association, seul détenteur des clés de déchiffrement"],
    transfers: [
      "Hébergement chez Microsoft (OneDrive) : données chiffrées avant envoi avec une clé que seule l'association détient — Microsoft stocke sans pouvoir lire",
    ],
    security: [
      "Chiffrement avant envoi (age pour les archives, rclone crypt pour les images et le journal)",
      "Suppression définitive, sans corbeille ni historique de versions",
      "Clés de déchiffrement conservées hors du serveur",
      "Suppressions de compte rejouées avant toute remise en service après restauration",
    ],
  },
  {
    ref: "T10",
    name: "Information des joueurs sur les changements de politique",
    purpose: "Informer chaque compte d'un changement du traitement de ses données, et recueillir son acceptation ou son refus",
    subPurposes: [
      "Présenter les changements non encore acceptés à la connexion (« J'accepte » ou « Je refuse, je supprime mon compte »)",
      "Annoncer chaque changement une fois en message privé Discord aux comptes joignables qui ne l'ont pas accepté sur le site, une semaine après sa publication et au plus un message par mois",
    ],
    legalBasis: "Obligation d'information (RGPD, articles 12 à 14) et consentement du joueur",
    dataSubjects: ["Joueurs inscrits sur le site"],
    dataCategories: [
      "Changements acceptés par le compte, avec la date d'acceptation",
      "Annonces Discord déjà envoyées au compte, avec leur date",
      "Identifiant Discord ou pseudo Discord certifié, pour adresser l'annonce",
    ],
    sensitiveData: "Aucune",
    retention: ["Durée du compte (effacées avec lui)"],
    recipients: ["Le joueur lui-même", "Discord, qui achemine le message privé"],
    transfers: ["États-Unis : Discord (acheminement des messages privés), dans le cadre des garanties propres à Discord"],
    security: [...COMMON_SECURITY, "Une annonce réservée avant l'envoi, pour qu'aucun compte ne la reçoive deux fois"],
  },
];

// --- Export tableur ------------------------------------------------------------

/** Colonnes de l'export, dans l'ordre des rubriques du modèle CNIL. */
export const REGISTER_EXPORT_COLUMNS = [
  "Réf.",
  "Nom du traitement",
  "Date de mise à jour",
  "Responsable du traitement",
  "Délégué à la protection des données",
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
  const controllerText = `${controller.name} — ${controller.legalForm}, ${controller.seat} — ${controller.contactEmail}`;
  const rows = activities.map((a) => [
    a.ref,
    a.name,
    REGISTER_UPDATED_AT,
    controllerText,
    controller.dpo,
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
