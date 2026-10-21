"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  certificationPromptStep,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { anotherModalOpen, watchModals, watchModalsClosed } from "@/lib/shared/dialog-focus";

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
 * DOM (sans minuterie, économie d'énergie comprise). Décidée, sa place est
 * tenue dans le DOM pendant le chargement de son morceau (`data-modal-pending`,
 * `TournamentSheet`). Elle **cède sa place** (`data-modal-yields`) : une
 * modale urgente — le lancement d'un match — passe par-dessus, et
 * l'invitation se ferme alors comme sur « Plus tard ».
 *
 * Renvoie l'invitation à afficher (`null` : rien) et la fermeture. Une
 * invitation retirée par le serveur (certifiée entre-temps) ferme la modale ;
 * elle ne se rouvre pas si une autre revient.
 */
export function useCertificationPrompt(prompt: CertificationPrompt | null | undefined, frozen: boolean) {
  const [open, setOpen] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const decided = useRef(false);

  useEffect(() => {
    const step = certificationPromptStep({
      decided: decided.current,
      hasPrompt: prompt != null,
      frozen,
      allowed: shouldOpenCertificationPrompt(browserStorage("localStorage"), browserStorage("sessionStorage")),
      otherModalOpen: anotherModalOpen(),
    });
    if (step === "IDLE") return;
    if (step === "WAIT") return watchModalsClosed(() => setRecheck((n) => n + 1));
    decided.current = true;
    if (step === "OPEN") setOpen(true);
  }, [prompt, frozen, recheck]);

  // Invitation retirée par le serveur (certification faite entre-temps) :
  // fermée. `null` seulement — c'est la réponse du serveur ; `undefined` veut
  // dire que la fiche n'est pas (encore) lue, et ne ferme rien.
  useEffect(() => {
    if (prompt === null) setOpen(false);
  }, [prompt]);

  const close = useCallback((neverAgain: boolean) => {
    rememberCertificationPromptClosed(browserStorage("localStorage"), browserStorage("sessionStorage"), neverAgain);
    setOpen(false);
  }, []);

  // Une modale urgente s'ouvre par-dessus (lancement d'un match) : place nette.
  useEffect(() => {
    if (!open) return;
    return watchModals(() => anotherModalOpen(document, { overYielding: true }), () => close(false));
  }, [open, close]);

  // Fiche figée (erreur fatale, tournoi supprimé) : plus rien ne s'affiche.
  return { prompt: open && !frozen ? (prompt ?? null) : null, close };
}
