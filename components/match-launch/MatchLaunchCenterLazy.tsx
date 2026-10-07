"use client";

import dynamic from "next/dynamic";

/**
 * La fenêtre de lancement, chargée **après** l'hydratation.
 *
 * Elle ne rend rien tant que sa première lecture (`/api/me/match-launches`)
 * n'est pas revenue : la rendre côté serveur ne montrait rien et mettait son
 * code et ses textes (deux langues) dans le premier chargement de chaque page
 * d'un compte connecté. Chargée à la demande, elle arrive à l'hydratation —
 * avant toute interrogation utile — dans son propre morceau.
 */
export const MatchLaunchCenterLazy = dynamic(
  () => import("./MatchLaunchCenter").then((module) => module.MatchLaunchCenter),
  { ssr: false },
);
