"use client";

import { useEffect, useState } from "react";
import {
  CERTIFY_DIALOG_EVENT,
  CERTIFY_QUERY_PARAM,
  wantsCertifyDialog,
} from "@/lib/shared/discord-certify-prompt";

/**
 * Ouvre le dialogue de certification quand la fenêtre de connexion
 * (`DiscordCertifyPrompt`, parcours `DIALOG`) l'a demandé : par l'adresse
 * (`/profil?certifier=discord`, retirée dès qu'elle est lue) ou, déjà sur
 * `/profil`, par un événement. Attend que l'état Discord soit **lu** (`ready`)
 * — le dialogue choisit son parcours d'après lui — et n'ouvre rien sur un tag
 * déjà certifié.
 */
export function useCertifyRequest({
  ready,
  verified,
  open,
}: Readonly<{ ready: boolean; verified: boolean; open: () => void }>): void {
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    if (wantsCertifyDialog(window.location.search)) {
      setRequested(true);
      const url = new URL(window.location.href);
      url.searchParams.delete(CERTIFY_QUERY_PARAM);
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
    const onRequest = () => setRequested(true);
    window.addEventListener(CERTIFY_DIALOG_EVENT, onRequest);
    return () => window.removeEventListener(CERTIFY_DIALOG_EVENT, onRequest);
  }, []);

  useEffect(() => {
    if (!requested || !ready) return;
    setRequested(false);
    if (!verified) open();
  }, [requested, ready, verified, open]);
}
