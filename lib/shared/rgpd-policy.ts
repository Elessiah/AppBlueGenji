import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";
import { CONNECTION_LOG_RETENTION_DAYS } from "@/lib/shared/connection-logs";

/**
 * Bases légales citées par la politique — les mêmes que le registre
 * (`processing-register.ts`) : une donnée n'a qu'une base.
 *
 * **Le compte et l'authentification reposent sur le contrat** (art. 6.1.b) : un
 * consentement demandé pour des données sans lesquelles le compte n'existe pas
 * ne serait pas libre (art. 7.4). Le **consentement** est réservé à ce que le
 * joueur choisit en plus — une certification qui l'expose, une donnée
 * facultative qu'il renseigne et publie.
 */
export type LegalBase = "Exécution du contrat" | "Consentement" | "Intérêt légitime" | "Obligation légale";

export interface DonneEntry {
  donnee: string;
  finalite: string;
  base: LegalBase;
  duree: string;
}

export interface DroitEntry {
  title: string;
  text: string;
}

export const DONNEES_PROFIL: DonneEntry[] = [
  {
    donnee: "Pseudo site",
    // **Jamais un nom réel.** Un compte créé par Google recevait le `name` de
    // son profil Google — un prénom et un nom, le plus souvent — pour pseudo
    // public et non masquable. Il naît désormais sous un pseudo neutre ; Discord
    // et Blizzard donnent un pseudonyme de jeu (tag, BattleTag sans son numéro).
    finalite:
      "Identification sur la plateforme, URLs de profil. Jamais tiré de ton nom : un compte créé par Discord ou Blizzard reprend ton pseudo Discord ou ton BattleTag (sans son numéro), un compte créé par Google reçoit un pseudo neutre — tu le changes dans Mon profil. Un compte créé par Google avant le 30 septembre 2026 a pu recevoir le nom de ton compte Google : si c'est le cas, remplace-le dans Mon profil",
    base: "Exécution du contrat",
    duree: "Durée du compte",
  },
  {
    donnee: "Pseudo Overwatch",
    // Depuis la connexion Blizzard, ce champ a deux origines possibles, et la
    // seconde écrase la première à chaque connexion : le dire est la condition
    // pour que le joueur comprenne pourquoi sa saisie a changé.
    finalite:
      "Mise en relation entre joueurs (s'ajouter en jeu) — aucune statistique. Saisi par toi, ou renseigné par Blizzard à chaque connexion si tu as rattaché ton compte Battle.net. Masqué, il reste lisible des joueurs de tes matchs tant que le tournoi n'est pas terminé, du caster de ton match de son lancement à sa fin si tu fais partie des contacts présentés (exécution des conditions d'utilisation), et de l'arbitrage tant que tu es inscrit à un tournoi qui n'est pas terminé",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Pseudo Discord",
    // La finalité a changé avec la certification (`lib/shared/discord-identity.ts`),
    // et une déclaration RGPD qui resterait sur l'ancienne serait fausse : le tag
    // n'est plus seulement un moyen technique, il devient une **coordonnée de
    // contact** exposée à l'organisation — mais uniquement une fois certifié, et
    // uniquement à deux publics. La phrase dit les deux régimes, parce que les
    // deux existent en base au même instant — et le troisième public, les autres
    // joueurs, qui n'existe que si le titulaire coche « Tag Discord ».
    //
    // Deux bases, donc deux lignes : l'enregistrement du pseudo sert la
    // connexion (contrat), son **exposition** repose sur la certification
    // (consentement, ligne suivante).
    finalite:
      "Authentification Discord, notifications bot. Enregistré à ta connexion par Discord, ou saisi par toi (compte sans Discord rattaché) ; sans certification, invisible de tous, administrateurs compris",
    base: "Exécution du contrat",
    duree: "Durée du compte",
  },
  {
    donnee: "Certification du pseudo Discord",
    // **Un geste distinct, et le seul.** Se connecter par Discord ne la donne
    // plus : s'authentifier n'est pas consentir à une exposition, et le refuser
    // ne doit pas coûter la porte Discord. D'où une base « Consentement » qui
    // tient — le geste est libre, spécifique, et se retire.
    finalite:
      "Ouvre ton tag Discord à l'organisation pour te joindre : administrateurs à tout moment, arbitres tant que tu es inscrit à un tournoi qui n'est pas terminé (dès l'ouverture des inscriptions), joueurs et caster de ton match de son lancement à sa fin ; les autres joueurs connectés seulement si tu coches « Tag Discord ». Sa présentation aux joueurs et au caster de ton match, au lancement, repose sur l'exécution des conditions d'utilisation, et non sur ce consentement. Donnée seulement par toi, depuis Mon profil (un clic si ton Discord est rattaché, un code en message privé sinon) — se connecter par Discord ne la donne pas. Retirée en retirant ton tag ; perdue si ton pseudo change",
    base: "Consentement",
    duree: "Jusqu'au retrait ou au changement du tag, ou durée du compte",
  },
  {
    donnee: "ID Discord",
    // Le compte n'a pas de mot de passe : cet identifiant **est** un moyen de
    // connexion, au même titre que les deux suivants. La finalité le dit, parce
    // que c'est ce qui explique qu'on ne puisse pas retirer le dernier.
    finalite:
      "Moyen de connexion (bouton Discord, ou code reçu en message privé) — stocké uniquement si tu rattaches Discord. Sert aussi au bot pour t'écrire en message privé (rappels de match, demande d'adhésion à une équipe que tu gères). Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: "Exécution du contrat",
    duree: "Durée du compte",
  },
  {
    donnee: "Identifiant Google",
    // L'**adresse** n'y figure pas, et ce n'est pas un oubli : plus rien ne
    // rattache un compte par son e-mail, le scope `email` n'est plus demandé, et
    // la colonne a été **supprimée** — avec les adresses collectées avant la
    // règle. Ce qui reste est un identifiant opaque, qui ne s'affiche à
    // personne.
    finalite:
      "Moyen de connexion (bouton Google) — identifiant technique opaque. Aucune adresse e-mail n'est demandée ni conservée, et le nom de ton compte Google n'est pas repris. Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: "Exécution du contrat",
    duree: "Durée du compte",
  },
  {
    donnee: "Identifiant Blizzard",
    finalite:
      "Moyen de connexion (bouton Blizzard) — identifiant technique opaque. Renseigne et tient à jour ton BattleTag. Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: "Exécution du contrat",
    duree: "Durée du compte",
  },
  {
    donnee: "Pseudo Marvel Rivals",
    finalite: "Mise en relation entre joueurs (s'ajouter en jeu) — aucune statistique",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Majorité déclarée",
    finalite:
      "Oui, non ou non renseignée, à ton choix. Affichée sur ta fiche seulement si tu coches « Majorité » dans Mon profil",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Avatar",
    // La photo copiée depuis Google ou Discord n'est pas un choix du joueur :
    // elle naît masquée (`adoptRemoteAvatar`), et seul le joueur la publie.
    finalite:
      "Affichage sur le profil et les brackets. Téléversé par toi, ou copié sur nos serveurs depuis Google ou Discord à la connexion — depuis le 30 septembre 2026, la photo copiée reste masquée tant que tu ne coches pas « Avatar » dans Mon profil (une photo copiée avant cette date reste affichée : décoche « Avatar » pour la masquer)",
    base: "Consentement",
    duree: "Durée du compte",
  },
];

export const DONNEE_TOURNOIS: DonneEntry = {
  donnee: "Résultats de tournois",
  finalite: "Historique compétitif, classements, palmarès",
  base: "Intérêt légitime",
  // Décision de l'association : aucune durée de conservation n'est définie.
  // Les résultats restent tant que le site existe ; à la suppression d'un
  // compte, ils sont anonymisés (pseudo d'emprunt, `anonymizeAccount`).
  duree: "Aucune durée définie : tant que le site existe ; anonymisés à la suppression du compte (voir §03)",
};

/**
 * Les copies de sauvegarde — la seule donnée du tableau qui ne se lit pas sur le
 * site, et la seule qui survive un temps à une suppression.
 *
 * La page disait qu'elles « peuvent subsister quelques jours » ; elles étaient
 * gardées six mois. La durée vient désormais de la constante que le script de
 * sauvegarde doit respecter (`BACKUP_RETENTION_DAYS`), et la phrase nomme les
 * deux choses qui rendent cette survie acceptable : le chiffrement (Microsoft
 * héberge sans pouvoir lire) et le rejeu des suppressions de compte à la
 * restauration — les seules qui soient rejouées.
 */
export const DONNEE_SAUVEGARDES: DonneEntry = {
  donnee: "Copies de sauvegarde",
  finalite:
    "Reprise après incident (panne, corruption). Chiffrées avant envoi, avec une clé que détient le seul responsable technique de l'association (qui est aussi l'hébergeur du site), puis hébergées chez Microsoft (OneDrive)",
  base: "Intérêt légitime",
  duree: `${BACKUP_RETENTION_DAYS} jours au plus`,
};

/**
 * Journal des données de connexion (`lib/shared/connection-logs.ts`) : la
 * seule donnée que le site garde **au-delà** de la suppression du compte, au
 * titre d'une obligation légale — d'où sa ligne à part.
 */
export const DONNEE_CONNEXIONS: DonneEntry = {
  donnee: "Données de connexion (adresse IP, date et heure, moyen de connexion)",
  finalite:
    "Obligation de l'hébergeur des contenus publiés par les membres (LCEN, art. 6 ; décret n° 2021-1362) : permettre d'identifier l'auteur d'un contenu, sur réquisition d'une autorité judiciaire. Aucune autre utilisation",
  base: "Obligation légale",
  duree: `${CONNECTION_LOG_RETENTION_DAYS} jours (un an) après chaque connexion, y compris après la suppression du compte`,
};

export const DROITS: DroitEntry[] = [
  {
    title: "Droit d'accès",
    text: "Vous pouvez demander une copie de toutes les données personnelles que nous détenons vous concernant.",
  },
  {
    title: "Droit de rectification",
    text: "Vous pouvez corriger ou mettre à jour vos données depuis votre page de profil ou en nous contactant.",
  },
  {
    title: "Droit à l'effacement",
    text: "Vous pouvez demander la suppression de votre compte et de vos données de profil. Voir ci-dessus pour les données de palmarès, et pour les données de connexion, que la loi impose de garder un an (RGPD, art. 17.3.b).",
  },
  {
    title: "Droit à la limitation",
    text: "Vous pouvez demander que vos données soient conservées sans être autrement utilisées le temps que nous vérifiions leur exactitude ou que nous examinions votre opposition, lorsque leur traitement est illicite et que vous préférez cette limitation à leur effacement, ou lorsque vous en avez besoin pour faire valoir un droit en justice alors que nous n'en aurions plus l'usage (art. 18).",
  },
  {
    title: "Droit d'opposition",
    text: "Vous pouvez vous opposer au traitement de vos données fondé sur l'intérêt légitime (historique de tournois).",
  },
  {
    title: "Droit à la portabilité",
    text: "Vous pouvez demander l'export de vos données dans un format lisible par machine (JSON).",
  },
  {
    title: "Droit de retrait du consentement",
    text: "Vous pouvez retirer votre consentement à tout moment sans que cela affecte la licéité du traitement antérieur.",
  },
  {
    title: "Directives après votre décès",
    text: "Vous pouvez définir des directives sur la conservation, l'effacement et la communication de vos données après votre décès (art. 85 de la loi Informatique et Libertés). Des directives propres à ce site se transmettent à l'association par les mêmes moyens que les autres demandes.",
  },
];
