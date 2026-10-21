"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  certificationPromptStep,
  rememberCertificationPromptClosed,
  shouldOpenCertificationPrompt,
  type CertificationPrompt,
} from "@/lib/shared/certification-prompt";
import { anotherModalOpen, watchModals, watchModalsClosed } from "@/lib/shared/dialog-focus";
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
 * par-dessus ; l'invitation s'efface sans rien retenir, case « Ne plus voir »
 * comprise (tenue ici, pas dans la modale), et revient à sa fermeture.
 *
 * Une invitation retirée par le serveur (certifiée entre-temps) ferme la
 * modale, une fiche figée la masque.
 */
export function useCertificationPrompt(prompt: CertificationPrompt | null | undefined, frozen: boolean) {
  const { clocks } = useClientPower();
  const [open, setOpen] = useState(false);
  const [neverAgain, setNeverAgain] = useState(false);
  const [recheck, setRecheck] = useState(0);
  const decided = useRef(false);

  useEffect(() => {
    // Les cas sans rien à décider passent avant toute lecture du stockage ou du DOM.
    if (decided.current || prompt == null || frozen) return;
    const step = certificationPromptStep({
      decided: false,
      hasPrompt: true,
      frozen: false,
      allowed: shouldOpenCertificationPrompt(browserStorage("localStorage"), browserStorage("sessionStorage")),
      otherModalOpen: anotherModalOpen(),
    });
    if (step === "WAIT") return clocks ? watchModalsClosed(() => setRecheck((n) => n + 1)) : undefined;
    decided.current = true;
    if (step === "OPEN") setOpen(true);
  }, [prompt, frozen, clocks, recheck]);

  // `null` seulement — c'est la réponse du serveur ; `undefined` veut dire que
  // la fiche n'est pas (encore) lue, et ne ferme rien.
  useEffect(() => {
    if (prompt === null) setOpen(false);
  }, [prompt]);

  const close = useCallback(() => {
    rememberCertificationPromptClosed(browserStorage("localStorage"), browserStorage("sessionStorage"), neverAgain);
    setOpen(false);
  }, [neverAgain]);

  // Une modale urgente s'ouvre par-dessus (lancement d'un match) : place
  // nette, sans rien retenir — l'invitation n'a peut-être pas été lue.
  useEffect(() => {
    if (!open || !clocks) return;
    return watchModals(
      () => anotherModalOpen(document, { overYielding: true }),
      () => {
        decided.current = false;
        setOpen(false);
        setRecheck((n) => n + 1);
      },
    );
  }, [open, clocks]);

  return {
    prompt: open && !frozen ? (prompt ?? null) : null,
    neverAgain,
    setNeverAgain,
    close,
  };
}
