import { BACKUP_RETENTION_DAYS } from "@/lib/shared/account-deletion-journal";

export type LegalBase = "Consentement" | "Intérêt légitime";

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
    finalite: "Identification sur la plateforme, URLs de profil",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Pseudo Overwatch",
    // Depuis la connexion Blizzard, ce champ a deux origines possibles, et la
    // seconde écrase la première à chaque connexion : le dire est la condition
    // pour que le joueur comprenne pourquoi sa saisie a changé.
    finalite:
      "Mise en relation entre joueurs (s'ajouter en jeu) — aucune statistique. Saisi par toi, ou renseigné par Blizzard à chaque connexion si tu as rattaché ton compte Battle.net. Masqué, il reste lisible des joueurs de tes matchs, de leur caster et de l'arbitrage, tant que le tournoi n'est pas terminé",
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
    // deux existent en base au même instant.
    finalite:
      "Authentification Discord, notifications bot. Une fois certifié : contact par l'organisation pendant un tournoi (administrateurs en permanence, arbitres tant que le joueur est engagé) et entre les parties d'un match (joueurs des deux équipes et caster), de son lancement à sa fin. Non certifié : visible de son seul titulaire",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Certification du pseudo Discord",
    // **Les deux chemins sont nommés.** Le second se produit sans qu'on le
    // demande : se connecter par Discord *est* la preuve, donc le tag ressort
    // certifié de la connexion. Une déclaration qui ne parlerait que du bouton
    // de `/profil` laisserait croire que l'exposition suppose toujours un geste
    // délibéré — et un membre qui entre toujours par Discord ne verrait jamais
    // cette page-là.
    finalite:
      "Atteste que le compte Discord appartient bien au joueur ; conditionne l'exposition du tag à l'organisation. Obtenue depuis Mon profil, ou automatiquement en te connectant par Discord. Perdue dès que le tag est modifié",
    base: "Consentement",
    duree: "Jusqu'à modification du tag, ou durée du compte",
  },
  {
    donnee: "ID Discord",
    // Le compte n'a pas de mot de passe : cet identifiant **est** un moyen de
    // connexion, au même titre que les deux suivants. La finalité le dit, parce
    // que c'est ce qui explique qu'on ne puisse pas retirer le dernier.
    finalite:
      "Moyen de connexion (bouton Discord, ou code reçu en message privé) — stocké uniquement si tu rattaches Discord. Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: "Consentement",
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
      "Moyen de connexion (bouton Google) — identifiant technique opaque. Aucune adresse e-mail n'est demandée ni conservée. Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Identifiant Blizzard",
    finalite:
      "Moyen de connexion (bouton Blizzard) — identifiant technique opaque. Renseigne et tient à jour ton BattleTag. Retirable depuis Mon profil tant qu'il t'en reste un autre",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Pseudo Marvel Rivals",
    finalite: "Mise en relation entre joueurs (s'ajouter en jeu) — aucune statistique",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Avatar",
    finalite: "Affichage sur le profil et les brackets",
    base: "Consentement",
    duree: "Durée du compte",
  },
];

export const DONNEE_TOURNOIS: DonneEntry = {
  donnee: "Résultats de tournois",
  finalite: "Historique compétitif, classements, palmarès",
  base: "Intérêt légitime",
  duree: "Indéfini (voir §03)",
};

/**
 * Les copies de sauvegarde — la seule donnée du tableau qui ne se lit pas sur le
 * site, et la seule qui survive un temps à une suppression.
 *
 * La page disait qu'elles « peuvent subsister quelques jours » ; elles étaient
 * gardées six mois. La durée vient désormais de la constante que le script de
 * sauvegarde doit respecter (`BACKUP_RETENTION_DAYS`), et la phrase nomme les
 * deux choses qui rendent cette survie acceptable : le chiffrement (Microsoft
 * héberge sans pouvoir lire) et le rejeu des suppressions à la restauration.
 */
export const DONNEE_SAUVEGARDES: DonneEntry = {
  donnee: "Copies de sauvegarde",
  finalite:
    "Reprise après incident (panne, corruption). Chiffrées avant envoi, avec une clé que seule l'association détient, puis hébergées chez Microsoft (OneDrive)",
  base: "Intérêt légitime",
  duree: `${BACKUP_RETENTION_DAYS} jours au plus`,
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
    text: "Vous pouvez demander la suppression de votre compte et de vos données de profil. Voir ci-dessus pour les données de palmarès.",
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
];

export const RGPD_CONTACT_EMAIL_FALLBACK = "keryan.h@outlook.fr";
