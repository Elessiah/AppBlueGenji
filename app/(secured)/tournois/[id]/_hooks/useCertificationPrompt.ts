"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  certificationPromptStep,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { anotherModalOpen } from "@/lib/shared/dialog-focus";
import { useClientPower } from "@/lib/shared/hooks/useClientPower";

/** Cadence du guet d'une autre modale qui retient l'ouverture d'office. */
const MODAL_RECHECK_MS = 1_000;

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
 * rouvrent pas. Jamais par-dessus une autre modale (lancement de match,
 * changements de confidentialité…) : elle attend sa fermeture, guettée chaque
 * seconde tant que les horloges tournent (`useClientPower().clocks`).
 */
export function useCertificationPrompt(prompt: CertificationPrompt | null | undefined, frozen: boolean) {
  const { clocks } = useClientPower();
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
    if (step === "WAIT") {
      if (!clocks) return;
      const timer = setInterval(() => {
        if (!anotherModalOpen()) setRecheck((n) => n + 1);
      }, MODAL_RECHECK_MS);
      return () => clearInterval(timer);
    }
    decided.current = true;
    if (step === "OPEN") setOpen(true);
  }, [prompt, frozen, clocks, recheck]);

  const close = useCallback((neverAgain: boolean) => {
    rememberCertificationPromptClosed(browserStorage("localStorage"), browserStorage("sessionStorage"), neverAgain);
    setOpen(false);
  }, []);

  return { open: open && prompt != null, close };
}
