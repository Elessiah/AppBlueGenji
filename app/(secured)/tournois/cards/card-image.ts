import { tournamentImageSlot } from "@/lib/shared/tournament-image";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Largeur rendue du bandeau d'illustration d'une carte, pour le `srcset` de
 * `next/image`. Une carte occupe une colonne sur trois (deux pour un tournoi en
 * cours), et toute la largeur sous 760 px.
 */
export const CARD_IMAGE_SIZES = "(max-width: 760px) 100vw, 720px";

/** Nombre de bandeaux chargés en priorité en haut de `/tournois`. */
export const PRIORITY_BANNER_COUNT = 2;

/**
 * Les cartes dont le bandeau est chargé **en priorité** : les premiers bandeaux
 * d'illustration, dans l'ordre d'affichage de la page.
 *
 * Un bandeau en haut de liste est l'élément le plus grand de l'écran, donc le
 * LCP de la page : chargé paresseusement, il retardait l'affichage principal
 * (Next le signale en développement). Mais précharger tous les bandeaux
 * mettrait en concurrence des images qu'on ne voit pas encore ; on ne retient
 * donc que les premiers — les logos, petits, n'en ont pas besoin.
 */
export function priorityBannerIds(
  cardsInDisplayOrder: readonly TournamentCard[],
  limit: number = PRIORITY_BANNER_COUNT,
): ReadonlySet<number> {
  const ids = new Set<number>();
  for (const card of cardsInDisplayOrder) {
    if (ids.size >= limit) break;
    if (tournamentImageSlot(card.image) === "BANNER") ids.add(card.id);
  }
  return ids;
}
