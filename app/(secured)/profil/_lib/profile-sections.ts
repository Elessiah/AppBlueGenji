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
  /** Rendue seulement si l'appelant a de quoi la remplir. */
  conditional?: true;
};

export const PROFILE_SECTIONS: readonly ProfileSection[] = [
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
    conditional: true,
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
] as const;

/**
 * Les sections à afficher, sachant ce que l'appelant a reçu.
 *
 * Une seule question posée pour l'instant, et c'est voulu : une section
 * conditionnelle de plus se déclarera ici plutôt que dans le JSX, où l'oubli de
 * la retirer de la navigation ne se verrait pas.
 */
export function visibleProfileSections(available: {
  invitations: number;
}): ProfileSection[] {
  return PROFILE_SECTIONS.filter(
    (section) => section.id !== "invitations" || available.invitations > 0,
  );
}
