"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { CertifyPrompt } from "@/lib/shared/discord-certify-prompt";
import { useAutoRefresh, type AutoRefreshOutcome } from "@/lib/shared/hooks/useAutoRefresh";
import { DiscordCertifyPrompt } from "./DiscordCertifyPrompt";
import { onCertifyPromptAnsweredElsewhere, recheckCertifyPrompt } from "./certify-prompt-answer";
import type { CertifyPromptText } from "./certify-prompt-text";

/**
 * Âge en deçà duquel une lecture de la proposition vaut encore — à condition
 * d'avoir été faite **canal ouvert** (un choix fait dans ce navigateur arrive
 * alors par le canal) : une ouverture qui suit de près une relecture, ou un
 * aller-retour bref de l'onglet (vers le jeu), ne coûte aucune requête. La
 * **première** ouverture relit toujours (la lecture de la mise en page date
 * d'avant le canal). Aussi l'écart minimal entre deux relectures d'une
 * fenêtre affichée.
 */
export const RECHECK_AFTER_MS = 30_000;

export type DiscordCertifyPromptGateProps = {
  /** Parcours lu par la mise en page (relu à chaque `router.refresh()`). */
  prompt: CertifyPrompt;
  /** Compte à qui la proposition est faite : seules ses réponses comptent. */
  userId: number;
  /** Rien ne passe avant elle (jugé par le relais, `certifyPromptOpen`). */
  canOpen: boolean;
  onProfile: boolean;
  /** Répondue sur ce chargement, lu sans attendre un rendu (tenu par le relais). */
  answered: { readonly current: boolean };
  /** Répondue ici, dans un autre onglet, ou plus due : le relais démonte le morceau. */
  onAnswered: () => void;
  text: CertifyPromptText;
};

/**
 * Garde « jamais sur un état périmé » de la fenêtre, **dans son morceau** :
 * rien de ce code ne voyage avec les pages où aucune proposition n'est due
 * (`docs/features/DISCORD_CERTIFY_PROMPT.md`).
 *
 * Une lecture faite canal ouvert vaut `RECHECK_AFTER_MS`. Une ouverture sans
 * lecture valable relit d'abord la proposition (`recheckCertifyPrompt`),
 * **fermée en cas de doute** ; une réponse tranchée « plus due » démonte le
 * morceau (`onAnswered`). Affichée une fois, la fenêtre le reste tant que rien
 * ne tranche — une page qui la tait ne lui fait pas perdre sa confirmation ;
 * elle se relit au retour de l'onglet ou à sa réapparition (`useAutoRefresh`,
 * au plus une fois par `RECHECK_AFTER_MS`, un doute retenté une fois au retour
 * du réseau ou du focus) et ne se ferme alors que sur une réponse tranchée ;
 * une réponse du même compte donnée dans un autre onglet la ferme
 * (`BroadcastChannel`). Un « Ne plus voir » ou une certification faits sur un
 * autre appareil ne l'ouvrent donc nulle part.
 */
export function DiscordCertifyPromptGate({
  prompt,
  userId,
  canOpen,
  onProfile,
  answered,
  onAnswered,
  text,
}: Readonly<DiscordCertifyPromptGateProps>) {
  const [current, setCurrent] = useState(prompt);
  /** Panne avant l'ouverture : fermée, jusqu'à une proposition fraîche de la mise en page. */
  const [doubt, setDoubt] = useState(false);
  /**
   * Proposition confirmée (relue, ou lecture encore valable) : gardée tant
   * que rien ne tranche, même quand une page la tait un moment.
   */
  const [confirmed, setConfirmed] = useState(false);
  const [layoutPrompt, setLayoutPrompt] = useState(prompt);
  if (prompt !== layoutPrompt) {
    // Relue par la mise en page (`router.refresh()`) : encore due.
    setLayoutPrompt(prompt);
    setCurrent(prompt);
    if (doubt) setDoubt(false);
  }

  /**
   * Dernière lecture tranchée **observée canal ouvert**. Zéro tant qu'aucune
   * relecture n'a tranché : une lecture de la mise en page partie avant le
   * montage (canal pas encore ouvert) ne vaut pas.
   */
  const readAt = useRef(0);
  /** Canal des autres onglets ouvert : une lecture faite maintenant ne peut plus manquer une réponse. */
  const listening = useRef(false);
  const seenLayout = useRef(prompt);
  // Déclaré avant l'abonnement et la relecture : une proposition fraîche de la
  // mise en page n'est datée que si le canal écoutait déjà, et qu'une relecture
  // a déjà tranché depuis le montage.
  useEffect(() => {
    if (seenLayout.current === layoutPrompt) return;
    seenLayout.current = layoutPrompt;
    if (listening.current && readAt.current !== 0) readAt.current = Date.now();
  }, [layoutPrompt]);

  // Aucun abonnement pendant un doute : la fenêtre ne peut plus s'ouvrir sans
  // `router.refresh()`, et un canal ouvert peut priver la page du cache
  // avant/arrière.
  useEffect(() => {
    if (doubt) return;
    const stop = onCertifyPromptAnsweredElsewhere(userId, onAnswered);
    listening.current = true;
    return () => {
      listening.current = false;
      stop();
    };
  }, [doubt, userId, onAnswered]);

  // Ouverture : une lecture valable suffit, sinon relire avant, fermée en cas de doute.
  useEffect(() => {
    if (!canOpen || confirmed || doubt || answered.current) return;
    if (readAt.current !== 0 && Date.now() - readAt.current < RECHECK_AFTER_MS) {
      setConfirmed(true);
      return;
    }
    const abort = new AbortController();
    void recheckCertifyPrompt(abort.signal).then((result) => {
      if (abort.signal.aborted || answered.current) return;
      if (result === "UNKNOWN") {
        setDoubt(true);
      } else if (result.prompt) {
        readAt.current = Date.now();
        setCurrent(result.prompt);
        setConfirmed(true);
      } else {
        onAnswered();
      }
    });
    return () => abort.abort();
  }, [canOpen, confirmed, doubt, layoutPrompt, answered, onAnswered]);

  const shown = canOpen && confirmed && !doubt;

  // Affichée : relue au retour de l'onglet (cache avant/arrière compris) et à
  // sa réapparition (retour d'une page qui la taisait), que le choix fait
  // ailleurs entre-temps la ferme. Seule une réponse tranchée la ferme : un
  // réseau pas encore revenu (téléphone déverrouillé) ne l'escamote pas sous
  // les yeux, et ce doute est retenté une fois.
  const recheckShown = useCallback(
    async (signal: AbortSignal): Promise<AutoRefreshOutcome> => {
      if (answered.current) return;
      const result = await recheckCertifyPrompt(signal);
      if (signal.aborted || answered.current) return;
      if (result === "UNKNOWN") return "RETRY";
      readAt.current = Date.now();
      if (result.prompt) setCurrent(result.prompt);
      else onAnswered();
    },
    [answered, onAnswered],
  );
  useAutoRefresh(recheckShown, {
    intervalMs: null,
    enabled: shown,
    focusMinIntervalMs: RECHECK_AFTER_MS,
    pageShow: true,
    freshAt: readAt,
    runOnEnable: true,
  });

  if (doubt) return null;
  return (
    <DiscordCertifyPrompt
      prompt={current}
      userId={userId}
      canOpen={shown}
      onProfile={onProfile}
      onAnswered={onAnswered}
      text={text}
    />
  );
}
