import type { TournamentBuckets, TournamentCard } from "@/lib/shared/types";
import type { TournamentsText } from "@/lib/shared/tournaments-text";

/**
 * Plan des sections de `/tournois`.
 *
 * La page empilait quatre sections fixes, chacune rendue même vide avec un
 * grand cadre « Vide » : trois cadres vides pouvaient précéder le seul tournoi
 * qui intéressait le lecteur. Deux règles désormais :
 *
 * - **ce qui concerne le lecteur passe d'abord** — « Mes tournois » (engagé
 *   par son équipe ou en solo) vient en tête, seulement devancée par la
 *   section du staff ;
 * - **une section vide ne s'affiche pas** : le sommaire la montre, grisée avec
 *   son zéro, ce qui répond à « y a-t-il un tournoi en cours ? » en une ligne
 *   au lieu d'un bloc.
 */
export type PageSectionKey = "hidden" | "mine" | "running" | "registration" | "upcoming" | "finished";

export const PAGE_SECTION_ORDER: readonly PageSectionKey[] = [
  "hidden",
  "mine",
  "running",
  "registration",
  "upcoming",
  "finished",
];

export const PAGE_SECTION_TITLES: Record<PageSectionKey, string> = {
  hidden: "TOURNOIS INVISIBLES",
  mine: "MES TOURNOIS",
  running: "EN COURS",
  registration: "INSCRIPTIONS OUVERTES",
  upcoming: "PROCHAINEMENT",
  finished: "TERMINÉS",
};

/** Libellés courts du sommaire, où la place manque sur mobile. */
export const PAGE_SECTION_NAV_LABELS: Record<PageSectionKey, string> = {
  hidden: "Invisibles",
  mine: "Mes tournois",
  running: "En cours",
  registration: "Inscriptions",
  upcoming: "Prochainement",
  finished: "Terminés",
};

/** Sections ouvertes à l'arrivée : l'archive des terminés reste repliée. */
export const DEFAULT_OPEN_SECTIONS: readonly PageSectionKey[] = [
  "hidden",
  "mine",
  "running",
  "registration",
  "upcoming",
];

/** Ancre d'une section, cible des liens du sommaire. */
export function pageSectionAnchor(key: PageSectionKey): string {
  return `tournois-${key}`;
}

/**
 * Section désignée par un fragment d'URL (`#tournois-finished`), ou `null`.
 * Les liens du sommaire laissent leur ancre dans l'URL : recharger ou partager
 * la page doit ramener à la même section, dépliée. Le fragment revient du
 * navigateur, il n'est accepté que s'il nomme une section connue.
 */
export function parsePageSectionAnchor(hash: string): PageSectionKey | null {
  const fragment = hash.startsWith("#") ? hash.slice(1) : hash;
  return PAGE_SECTION_ORDER.find((key) => pageSectionAnchor(key) === fragment) ?? null;
}

/**
 * Sort des paniers les tournois où le lecteur est engagé, pour les regrouper
 * en tête — en cours d'abord, puis inscriptions, puis à venir, chaque panier
 * gardant son ordre. Un tournoi n'apparaît jamais deux fois : il quitte son
 * panier d'origine. Les **terminés** restent où ils sont, même joués : la
 * section ne rassemble que ce qui attend encore quelque chose du joueur.
 */
export function splitMyTournaments(
  buckets: TournamentBuckets,
  myIds: ReadonlySet<number>,
): { mine: TournamentCard[]; others: TournamentBuckets } {
  if (myIds.size === 0) return { mine: [], others: buckets };
  const isMine = (t: TournamentCard) => myIds.has(t.id);
  const notMine = (t: TournamentCard) => !myIds.has(t.id);
  return {
    mine: [
      ...buckets.running.filter(isMine),
      ...buckets.registration.filter(isMine),
      ...buckets.upcoming.filter(isMine),
    ],
    others: {
      running: buckets.running.filter(notMine),
      registration: buckets.registration.filter(notMine),
      upcoming: buckets.upcoming.filter(notMine),
      finished: buckets.finished,
    },
  };
}

export type PageSectionEntry = {
  key: PageSectionKey;
  title: string;
  navLabel: string;
  count: number;
};

/**
 * Sections que la page connaît pour ce lecteur, dans l'ordre d'affichage.
 * `hidden` et `mine` n'existent que si le lecteur en a (staff, joueur engagé),
 * jugé **avant** filtre : une recherche qui vide « Mes tournois » doit laisser
 * le sommaire dire « 0 », pas faire disparaître l'entrée.
 */
export function pageSections(
  counts: Record<PageSectionKey, number>,
  available: { hidden: boolean; mine: boolean },
  /** Langue de la page (lot 8a) ; sans elle, les tables françaises ci-dessus. */
  text?: TournamentsText,
): PageSectionEntry[] {
  return PAGE_SECTION_ORDER.filter(
    (key) => (key !== "hidden" || available.hidden) && (key !== "mine" || available.mine),
  ).map((key) => ({
    key,
    title: text ? text.t(`list.sections.${key}`) : PAGE_SECTION_TITLES[key],
    navLabel: text ? text.t(`list.sectionNav.${key}`) : PAGE_SECTION_NAV_LABELS[key],
    count: counts[key],
  }));
}
