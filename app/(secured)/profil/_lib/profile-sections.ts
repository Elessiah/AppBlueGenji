/**
 * Le découpage de `/profil`, et l'ordre dans lequel il se lit.
 *
 * La page empilait **onze** blocs dans un seul formulaire, sans un titre pour
 * dire où l'on passait d'un sujet à l'autre : pseudo, avatar, BattleTag, tag
 * Marvel, tag Discord, majorité, visibilité, recrutement, applications
 * connectées, invitations, statistiques, puis l'export et la suppression du
 * compte au fil du texte. Tout y avait le même poids — un champ d'identité et
 * un bouton qui efface le compte se ressemblaient à quelques pixels près — et
 * rien ne permettait d'atteindre le bas sans traverser le reste.
 *
 * Le registre nomme donc les sections, une fois, et sert **deux** lecteurs : la
 * navigation d'ancres en tête de page et les titres des sections elles-mêmes.
 * Deux listes auraient dérivé, et la dérive se serait vue sous la forme d'un
 * lien qui ne mène nulle part — `scrollIntoView` sur une ancre absente ne fait
 * rien du tout, sans erreur.
 *
 * Module **pur** : les sections conditionnelles (les invitations n'existent que
 * s'il y en a) sont filtrées par l'appelant, qui seul sait ce qu'il a reçu.
 */

/** Une section de la page : son ancre, son titre, et ce qu'elle promet. */
export type ProfileSection = {
  /** Identifiant d'ancre, repris tel quel dans l'URL (`/profil#discord`). */
  id: string;
  /** Titre affiché en tête de section, et libellé du lien de navigation. */
  title: string;
  /** Une phrase sous le titre — ce que la section règle, pas ce qu'elle contient. */
  lead: string;
  /**
   * Ce qu'il faut avoir reçu pour que la section ait un sens.
   *
   * La clé désigne un compteur de `ProfileSectionAvailability`, et c'est
   * `visibleProfileSections` qui la lit : un simple drapeau `conditional` se
   * serait doublé d'un `id !== "invitations"` écrit en dur dans le filtre, si
   * bien qu'une deuxième section conditionnelle l'aurait porté sans effet —
   * affichée quand même, et annoncée par la navigation.
   */
  requires?: keyof ProfileSectionAvailability;
};

/** Ce que la page a reçu, et qui décide des sections conditionnelles. */
export type ProfileSectionAvailability = {
  /** Nombre d'invitations d'équipe en attente. */
  invitations: number;
};

export const PROFILE_SECTIONS = [
  {
    id: "identite",
    title: "Identité",
    lead: "Ton pseudo et ton avatar, visibles partout où tu joues.",
  },
  {
    id: "jeux",
    title: "Comptes de jeu",
    lead: "Les identifiants qui permettent aux autres joueurs de t'ajouter.",
  },
  {
    id: "discord",
    title: "Discord",
    lead: "Le tag par lequel l'organisation te joint pendant un tournoi.",
  },
  {
    id: "confidentialite",
    title: "Confidentialité",
    lead: "Ce que les autres voient de toi, et si les équipes peuvent te démarcher.",
  },
  {
    id: "connexions",
    title: "Applications connectées",
    lead: "Les portes par lesquelles tu entres sur le site.",
  },
  {
    id: "invitations",
    title: "Invitations d'équipe",
    lead: "Les équipes qui t'ont proposé de les rejoindre.",
    requires: "invitations",
  },
  {
    id: "statistiques",
    title: "Statistiques",
    lead: "Ton bilan sur la plateforme.",
  },
  {
    id: "compte",
    title: "Mon compte",
    lead: "Exporter tes données, te déconnecter, ou tout effacer.",
  },
] as const satisfies readonly ProfileSection[];

/** L'ancre d'une section, telle qu'elle s'écrit dans une URL. */
export type ProfileSectionId = (typeof PROFILE_SECTIONS)[number]["id"];

/**
 * Le registre indexé par ancre — **total**, sections conditionnelles comprises.
 *
 * La page y lit la section qu'elle rend ; la liste filtrée ne sert qu'à la
 * navigation. Indexer la liste filtrée rendrait `undefined` sur une section
 * absente, que le typage ne verrait pas et que `<ProfileSection>` ferait
 * planter sur `section.id` : c'est la navigation qu'on veut voir maigrir, pas
 * la recherche par ancre.
 */
export const PROFILE_SECTION_BY_ID = Object.fromEntries(
  PROFILE_SECTIONS.map((section) => [section.id, section]),
) as Record<ProfileSectionId, ProfileSection>;

/**
 * L'ancre désignée par un fragment d'URL, si c'en est bien une.
 *
 * Un fragment revient du navigateur : il ne sert à désigner un élément qu'une
 * fois reconnu dans le registre — le reste ne nomme aucune section et vaut
 * `null`.
 */
export function profileSectionIdFromHash(hash: string): ProfileSectionId | null {
  const id = hash.startsWith("#") ? hash.slice(1) : hash;
  const match = PROFILE_SECTIONS.find((section) => section.id === id);
  return match ? match.id : null;
}

/**
 * Les sections à afficher, sachant ce que l'appelant a reçu.
 *
 * Une seule question posée pour l'instant, et c'est voulu : une section
 * conditionnelle de plus se déclare par son `requires` plutôt que dans le JSX,
 * où l'oubli de la retirer de la navigation ne se verrait pas.
 */
export function visibleProfileSections(
  available: ProfileSectionAvailability,
): ProfileSection[] {
  // Le paramètre est annoté : `as const` donne à chaque entrée son type
  // littéral, d'où `requires` absent de celles qui ne le portent pas.
  return PROFILE_SECTIONS.filter(
    (section: ProfileSection) =>
      section.requires === undefined || available[section.requires] > 0,
  );
}
