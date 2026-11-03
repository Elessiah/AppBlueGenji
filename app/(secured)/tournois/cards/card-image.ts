import { tournamentImageSlot } from "@/lib/shared/tournament-image";
import type { TournamentCard } from "@/lib/shared/types";

/**
 * Largeur rendue du bandeau d'illustration d'une carte, pour le `srcset` de
 * `next/image` (le navigateur multiplie lui-même par la densité de l'écran).
 * Elle suit la grille de `.sectionBody` (`tournois.module.css`) : une colonne
 * sous 720 px, deux jusqu'à 1080 px, puis trois (quatre au-delà de 1800 px)
 * d'environ 400 px.
 */
export const CARD_IMAGE_SIZES = "(max-width: 720px) 100vw, (max-width: 1080px) 50vw, 400px";

/**
 * Cartes « en cours » : leur section reste sur deux colonnes (`data-cols="2"`)
 * à toute largeur, soit environ 580 px par carte dans la colonne de 1200 px et
 * 800 px sur les grands écrans.
 */
export const RUNNING_CARD_IMAGE_SIZES =
  "(max-width: 720px) 100vw, (max-width: 1250px) 50vw, (max-width: 1799px) 580px, 800px";

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
