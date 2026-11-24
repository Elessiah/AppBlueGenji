import type { RandomDrawStatus } from "@/lib/shared/random-seeding";

/**
 * Texte d'attente du plateau quand l'ordre de départ est tiré au sort
 * (`docs/features/RANDOM_SEEDING.md`) : à la clôture tant que le tirage est à
 * venir, « tiré » une fois fait. `null` hors tirage au sort : le texte du
 * format s'applique.
 */
export function preLaunchRandomKey(
  seedingSource: string,
  draw: RandomDrawStatus,
): "page.preLaunch.random" | "page.preLaunch.randomDrawn" | null {
  if (draw === "DRAWN") return "page.preLaunch.randomDrawn";
  return seedingSource === "RANDOM" ? "page.preLaunch.random" : null;
}
