"use client";

import { useEffect, useRef, useState } from "react";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import {
  CERTIFY_DIALOG_EVENT,
  CERTIFY_QUERY_PARAM,
  DISCORD_CERTIFIED_EVENT,
  certifiedFromProfile,
  wantsCertifyDialog,
} from "@/lib/shared/discord-certify-prompt";

/**
 * Ouvre le dialogue de certification quand la fenêtre de connexion
 * (`DiscordCertifyPrompt`, parcours `DIALOG`) l'a demandé : par l'adresse
 * (`/profil?certifier=discord`, retirée dès qu'elle est lue) ou, déjà sur
 * `/profil`, par un événement. Attend que l'état Discord soit **lu** (`ready`)
 * — le dialogue choisit son parcours d'après lui — et, sur un tag déjà
 * certifié, le dit par un toast au lieu d'ouvrir le dialogue. Quand la fenêtre
 * certifie d'un clic, `refresh` relit l'état Discord affiché.
 */
export function useCertifyRequest({
  ready,
  verified,
  open,
  refresh,
}: Readonly<{ ready: boolean; verified: boolean; open: () => void; refresh: () => void }>): void {
  const [requested, setRequested] = useState(false);
  const { t } = useShellText();
  const { showSuccess } = useToast();
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  useEffect(() => {
    // Son propre événement (dialogue de cette page) : l'état est déjà à jour.
    const onCertified = (event: Event) => {
      if (!certifiedFromProfile(event)) refreshRef.current();
    };
    window.addEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
    return () => window.removeEventListener(DISCORD_CERTIFIED_EVENT, onCertified);
  }, []);

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
    if (verified) showSuccess(t("certifyPrompt.alreadyVerified"));
    else open();
  }, [requested, ready, verified, open, showSuccess, t]);
}
