"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  certificationPromptStep,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { anotherModalOpen, claimAutoOpenModal, watchModalsClosed } from "@/lib/shared/dialog-focus";

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
 * DOM (sans minuterie, économie d'énergie comprise). Décidée, elle réserve sa
 * place (`claimAutoOpenModal`) le temps que son morceau se charge : le centre
 * de lancement ne s'ouvre pas en même temps.
 *
 * Renvoie l'invitation à afficher (`null` : rien) et la fermeture.
 */
export function useCertificationPrompt(prompt: CertificationPrompt | null | undefined, frozen: boolean) {
  const [open, setOpen] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const decided = useRef(false);
  const releaseClaim = useRef<(() => void) | null>(null);

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
    if (step === "OPEN") {
      releaseClaim.current = claimAutoOpenModal();
      setOpen(true);
    }
  }, [prompt, frozen, recheck]);

  // Démontage de la fiche, modale ouverte : la place réservée se libère.
  useEffect(() => () => releaseClaim.current?.(), []);

  const close = useCallback((neverAgain: boolean) => {
    rememberCertificationPromptClosed(browserStorage("localStorage"), browserStorage("sessionStorage"), neverAgain);
    releaseClaim.current?.();
    releaseClaim.current = null;
    setOpen(false);
  }, []);

  return { prompt: open ? (prompt ?? null) : null, close };
}
