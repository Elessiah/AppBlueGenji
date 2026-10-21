"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  certificationPromptStep,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { anotherModalOpen, watchModalsClosed, watchUrgentModalOpened } from "@/lib/shared/dialog-focus";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";

/** Un stockage du navigateur, `null` s'il est inaccessible (accès refusé, rendu serveur). */
function browserStorage(kind: "localStorage" | "sessionStorage"): Storage | null {
  try {
    return typeof window === "undefined" ? null : window[kind];
  } catch {
    return null;
  }
}

/**
 * Ouverture d'office de l'invitation à certifier (`CERTIFICATION_PROMPT.md`) :
 * une fois par page, dès que le contexte du lecteur en porte une, sauf « Ne
 * plus voir » ou déjà fermée dans cet onglet. Les relectures du contexte ne la
 * rouvrent pas.
 *
 * Jamais par-dessus une autre modale (lancement de match, changements de
 * confidentialité…) : elle attend sa fermeture, guettée par un observateur du
 * DOM tant que l'onglet est visible (`useClientPower().clocks`). Décidée, sa
 * place est tenue dans le DOM pendant le chargement de son morceau
 * (`data-modal-pending`, `TournamentSheet`). Elle **cède sa place**
 * (`data-modal-yields`) : une modale urgente — le lancement d'un match — passe
 * par-dessus ; l'invitation s'efface pour le reste de la page, sans rien
 * retenir dans le navigateur : elle revient à la prochaine fiche ouverte.
 *
 * Le serveur la calcule une fois par connexion du flux (ou lecture REST de
 * secours) : une certification faite entre-temps ne la retire qu'à la lecture
 * suivante. Retirée (ou lecture en échec côté serveur), elle masque la modale
 * sans la fermer : revenue, elle réapparaît. Tournoi clos ou équipe retirée
 * depuis : masquée sur-le-champ (`liveCertificationPrompt`, instantané à
 * jour). Une fiche figée la masque aussi.
 */
export function useCertificationPrompt(prompt: CertificationPrompt | null | undefined, frozen: boolean) {
  const { clocks } = useClientPower();
  const [open, setOpen] = useState(false);
  const [neverAgain, setNeverAgain] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const decided = useRef(false);

  useEffect(() => {
    if (decided.current || prompt == null || frozen) return;
    const step = certificationPromptStep({
      allowed: shouldOpenCertificationPrompt(browserStorage("localStorage"), browserStorage("sessionStorage")),
      otherModalOpen: anotherModalOpen(),
    });
    if (step === "WAIT") return clocks ? watchModalsClosed(() => setRecheck((n) => n + 1)) : undefined;
    decided.current = true;
    if (step === "OPEN") setOpen(true);
  }, [prompt, frozen, clocks, recheck]);

  const close = useCallback(() => {
    rememberCertificationPromptClosed(browserStorage("localStorage"), browserStorage("sessionStorage"), neverAgain);
    setOpen(false);
  }, [neverAgain]);

  // S'effacer devant une modale urgente, sans rien retenir dans le navigateur —
  // l'invitation n'a peut-être pas été lue — mais pour le reste de la page :
  // revenue à chaque fermeture d'une annonce de lancement, elle couvrirait le
  // plateau en plein match. Elle revient à la prochaine fiche ouverte.
  const yieldPlace = useCallback(() => setOpen(false), []);

  // Affichée seulement : invitation présente et fiche vivante.
  const shown = open && prompt != null && !frozen;

  // Une modale urgente s'ouvre par-dessus (lancement d'un match) : place nette
  // sans délai, avant que le morceau ne se monte au-dessus d'elle dans la pile.
  // Armé même onglet caché : un observateur sans minuterie, qui n'examine que
  // les nœuds ajoutés — sans quoi une annonce ouverte onglet caché laisserait
  // l'invitation, devancée, ni affichée ni effacée.
  useEffect(() => {
    if (!shown) return;
    return watchUrgentModalOpened(yieldPlace);
  }, [shown, yieldPlace]);

  return {
    prompt: shown ? prompt : null,
    neverAgain,
    setNeverAgain,
    close,
  };
}
