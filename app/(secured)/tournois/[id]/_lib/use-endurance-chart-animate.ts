import { useClientPower, useClientPowerInput } from "@/lib/shared/hooks/useClientPower";

/**
 * Le graphique d'endurance s'anime-t-il ? Faux en mouvement réduit demandé,
 * ou en régime économe (machine à la peine, page en arrière-plan) : une seule
 * image, la courbe déjà arrivée — et ni bouton « Rejouer l'animation », ni
 * mention « graphique animé » en tête du volet.
 */
export function useEnduranceChartAnimate(): boolean {
  const { decorativeMotion } = useClientPower();
  const { reducedMotion } = useClientPowerInput();
  return decorativeMotion && !reducedMotion;
}
