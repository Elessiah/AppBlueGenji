"use client";

import { useEffect } from "react";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";
import { powerModeAttribute } from "@/lib/shared/client-power";
import { ClientPowerBadge } from "./client-power-badge";

/**
 * Pose le régime de charge sur `<html>` : `data-power` (le régime) et
 * `data-motion` (`on` / `off`), puis rend le témoin.
 *
 * C'est `data-motion` qui fige d'un coup **toutes** les animations décoratives
 * du site, sans qu'aucun composant ait à s'en occuper : chaque animation infinie
 * lit `animation-play-state: var(--deco-anim-state)`, que `app/globals.css`
 * passe à `paused` sous `html[data-motion="off"]`. Une animation en pause ne
 * produit plus aucune image — c'est tout ce qu'on cherchait, et une nouvelle
 * animation en hérite pourvu qu'elle lise le jeton
 * (`tests/app/deco-animations.test.ts` y veille).
 *
 * `data-power` sert au diagnostic : il se lit dans l'inspecteur du navigateur.
 */
export function ClientPowerRoot() {
  const policy = useClientPower();

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.power = powerModeAttribute(policy.mode);
    root.dataset.motion = policy.decorativeMotion ? "on" : "off";
  }, [policy.mode, policy.decorativeMotion]);

  return <ClientPowerBadge />;
}
