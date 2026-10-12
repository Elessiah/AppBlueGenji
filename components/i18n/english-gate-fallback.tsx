"use client";

import { SecuredLoadingView } from "@/app/(secured)/_shared/SecuredLoadingView";
import { useShellText } from "./shell-text";

/**
 * L'écran d'attente d'une porte de l'anglais (revue de performance du lot 9-2) :
 * le squelette du segment, rendu **par le client** — une mise en page n'a plus
 * à le sérialiser dans chaque réponse (portes imbriquées comprises). Son
 * libellé vient de la coquille, déjà dans la langue de la page.
 */
export function EnglishGateFallback() {
  const { t } = useShellText();
  return <SecuredLoadingView label={t("loading")} />;
}
