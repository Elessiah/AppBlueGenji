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
    donnee: "Pseudo Overwatch 2",
    finalite: "Affichage profil, statistiques de jeu",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Pseudo Discord",
    finalite: "Authentification Discord, notifications bot",
    base: "Consentement",
    duree: "Durée du compte",
  },
  {
    donnee: "Pseudo Marvel Rivals",
    finalite: "Affichage profil, statistiques de jeu",
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

export const RGPD_CONTACT_EMAIL_FALLBACK = "kgalaxie84@gmail.com";
