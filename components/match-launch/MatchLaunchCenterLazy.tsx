"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { orReload } from "@/lib/shared/lazy-component";
import { MATCH_LAUNCH_OPEN_EVENT } from "@/lib/shared/match-launch";
import { PRIVACY_CHANGES_ANSWERED_EVENT } from "@/lib/shared/privacy-changes";

/**
 * La fenêtre de lancement, chargée **après** l'hydratation.
 *
 * Elle ne rend rien tant que sa première lecture (`/api/me/match-launches`)
 * n'est pas revenue : la rendre côté serveur ne montrait rien et mettait son
 * code et ses textes (deux langues) dans le premier chargement de chaque page
 * d'un compte connecté. Chargée à la demande, elle arrive à l'hydratation dans
 * son propre morceau ; un morceau disparu (déploiement entre la page et lui)
 * recharge la page quand c'est sûr (`orReload`), jamais l'écran d'erreur.
 */
const MatchLaunchCenter = dynamic(
  () => orReload(import("./MatchLaunchCenter").then((module) => module.MatchLaunchCenter)),
  { ssr: false },
);

/**
 * Retient ce qui arrive **avant** le morceau : une réponse au choix de
 * confidentialité (sans quoi la fenêtre attendrait jusqu'au prochain
 * chargement complet) et une ouverture demandée par la carte d'un match.
 */
export function MatchLaunchCenterLazy({ privacyPending = false }: Readonly<{ privacyPending?: boolean }>) {
  const [privacyAnswered, setPrivacyAnswered] = useState(false);
  const [requestedMatchId, setRequestedMatchId] = useState<number | null>(null);

  useEffect(() => {
    const onAnswered = () => setPrivacyAnswered(true);
    const onOpen = (event: Event) => {
      const matchId = Number((event as CustomEvent<{ matchId?: unknown }>).detail?.matchId);
      if (Number.isInteger(matchId)) setRequestedMatchId(matchId);
    };
    window.addEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
    window.addEventListener(MATCH_LAUNCH_OPEN_EVENT, onOpen);
    return () => {
      window.removeEventListener(PRIVACY_CHANGES_ANSWERED_EVENT, onAnswered);
      window.removeEventListener(MATCH_LAUNCH_OPEN_EVENT, onOpen);
    };
  }, []);

  return <MatchLaunchCenter privacyPending={privacyPending && !privacyAnswered} requestedMatchId={requestedMatchId} />;
}
