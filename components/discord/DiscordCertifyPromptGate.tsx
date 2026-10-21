"use client";

import { useEffect, useRef, useState } from "react";
import type { CertifyPrompt } from "@/lib/shared/discord-certify-prompt";
import { DiscordCertifyPrompt } from "./DiscordCertifyPrompt";
import { onCertifyPromptAnsweredElsewhere, recheckCertifyPrompt } from "./certify-prompt-answer";
import type { CertifyPromptText } from "./certify-prompt-text";

/**
 * Âge en deçà duquel une lecture de la proposition vaut encore : une
 * ouverture qui suit de près le chargement (confidentialité acceptée dans la
 * foulée) ou un aller-retour bref de l'onglet (vers le jeu) ne coûte aucune
 * requête — un choix fait dans ce navigateur arrive déjà par le canal. Aussi
 * l'écart minimal entre deux relectures d'une fenêtre affichée.
 */
export const RECHECK_AFTER_MS = 30_000;

export type DiscordCertifyPromptGateProps = {
  /** Parcours lu par la mise en page (relu à chaque `router.refresh()`). */
  prompt: CertifyPrompt;
  /** Rien ne passe avant elle (jugé par le relais, `certifyPromptOpen`). */
  canOpen: boolean;
  onProfile: boolean;
  /** Répondue sur ce chargement, lu sans attendre un rendu (tenu par le relais). */
  answered: { readonly current: boolean };
  /** Répondue ici ou dans un autre onglet : le relais démonte le morceau. */
  onAnswered: () => void;
  /** Instant de la lecture de la mise en page au chargement (`Date.now()`). */
  loadedAt: number;
  text: CertifyPromptText;
};

/**
 * Garde « jamais sur un état périmé » de la fenêtre, **dans son morceau** :
 * rien de ce code ne voyage avec les pages où aucune proposition n'est due
 * (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * Une lecture (mise en page, relecture) vaut `RECHECK_AFTER_MS`. Une
 * ouverture plus tardive relit d'abord la proposition (`recheckCertifyPrompt`),
 * **fermée en cas de doute** ; affichée, la fenêtre se relit au retour de
 * l'onglet (au plus une fois par `RECHECK_AFTER_MS`, un doute retenté une
 * fois au retour du réseau ou du focus) et ne se ferme alors que sur une
 * réponse tranchée ; une réponse donnée dans un autre onglet la ferme
 * (`BroadcastChannel`). Un « Ne plus voir » ou une certification faits sur un
 * autre appareil ne l'ouvrent donc nulle part.
 */
export function DiscordCertifyPromptGate({
  prompt,
  canOpen,
  onProfile,
  answered,
  onAnswered,
  loadedAt,
  text,
}: Readonly<DiscordCertifyPromptGateProps>) {
  const [current, setCurrent] = useState(prompt);
  /** Plus due (relecture tranchée, ou doute avant l'ouverture). */
  const [revoked, setRevoked] = useState(false);
  /** Proposition confirmée pour l'ouverture en cours ; perdue dès qu'elle ne peut plus s'ouvrir. */
  const [confirmed, setConfirmed] = useState(false);
  const [layoutPrompt, setLayoutPrompt] = useState(prompt);
  if (prompt !== layoutPrompt) {
    // Relue par la mise en page (`router.refresh()`) : encore due, fraîchement.
    setLayoutPrompt(prompt);
    setCurrent(prompt);
    setRevoked(false);
    setConfirmed(canOpen);
  }
  if (!canOpen && confirmed) setConfirmed(false);

  /** Dernière lecture tranchée de la proposition. */
  const readAt = useRef(loadedAt);
  /** Dernière tentative de relecture, tranchée ou non (écart minimal entre deux). */
  const triedAt = useRef(0);
  const seenLayout = useRef(prompt);
  // Déclaré avant la relecture : une proposition fraîche de la mise en page
  // est datée avant que la relecture ne juge son âge.
  useEffect(() => {
    if (seenLayout.current === layoutPrompt) return;
    seenLayout.current = layoutPrompt;
    readAt.current = Date.now();
  }, [layoutPrompt]);

  useEffect(() => {
    if (revoked) return;
    return onCertifyPromptAnsweredElsewhere(onAnswered);
  }, [revoked, onAnswered]);

  // Ouverture : une lecture fraîche suffit, sinon relire avant, fermée en cas de doute.
  useEffect(() => {
    if (!canOpen || confirmed || revoked || answered.current) return;
    if (Date.now() - readAt.current < RECHECK_AFTER_MS) {
      setConfirmed(true);
      return;
    }
    const abort = new AbortController();
    triedAt.current = Date.now();
    recheckCertifyPrompt(abort.signal).then((result) => {
      if (abort.signal.aborted) return;
      if (result !== "UNKNOWN" && result.prompt) {
        readAt.current = Date.now();
        setCurrent(result.prompt);
        setConfirmed(true);
      } else {
        setRevoked(true);
      }
    });
    return () => abort.abort();
  }, [canOpen, confirmed, revoked, layoutPrompt, answered]);

  const shown = canOpen && confirmed && !revoked;
  // Affichée : relue au retour de l'onglet (cache avant/arrière compris), que
  // le choix fait ailleurs entre-temps la ferme. Seule une réponse tranchée la
  // ferme : un réseau pas encore revenu (téléphone déverrouillé) ne l'escamote
  // pas sous les yeux, et ce doute est retenté une fois.
  useEffect(() => {
    if (!shown) return;
    let abort: AbortController | null = null;
    let retry = false;
    const check = (retrying: boolean) => {
      if (abort || answered.current) return;
      retry = false;
      triedAt.current = Date.now();
      const request = new AbortController();
      abort = request;
      recheckCertifyPrompt(request.signal)
        .then((result) => {
          if (request.signal.aborted || answered.current) return;
          if (result === "UNKNOWN") {
            retry = !retrying;
            return;
          }
          readAt.current = Date.now();
          if (result.prompt) setCurrent(result.prompt);
          else setRevoked(true);
        })
        .finally(() => {
          if (abort === request) abort = null;
        });
    };
    const onReturn = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - Math.max(readAt.current, triedAt.current) >= RECHECK_AFTER_MS) check(false);
      else if (retry) check(true);
    };
    const onRetry = () => {
      if (retry) check(true);
    };
    document.addEventListener("visibilitychange", onReturn);
    window.addEventListener("pageshow", onReturn);
    window.addEventListener("online", onRetry);
    window.addEventListener("focus", onRetry);
    return () => {
      document.removeEventListener("visibilitychange", onReturn);
      window.removeEventListener("pageshow", onReturn);
      window.removeEventListener("online", onRetry);
      window.removeEventListener("focus", onRetry);
      abort?.abort();
    };
  }, [shown, answered]);

  if (revoked) return null;
  return <DiscordCertifyPrompt prompt={current} canOpen={shown} onProfile={onProfile} onAnswered={onAnswered} text={text} />;
}
