"use client";

import { useEffect, useRef, useState } from "react";
import { useProfileText } from "@/components/i18n/profile-text";
import { useToast } from "@/components/ui/toast";
import { CERTIFY_QUERY_PARAM, certifiedFromProfile, wantsCertifyDialog } from "@/lib/shared/discord-certify-prompt";
import { CERTIFY_DIALOG_EVENT, DISCORD_CERTIFIED_EVENT, takeCertifyDialogRequest } from "@/lib/shared/discord-certify-events";

/**
 * Ouvre le dialogue de certification quand la fenêtre de connexion
 * (`DiscordCertifyPrompt`, parcours `DIALOG`) l'a demandé : par l'adresse
 * (`/profil?certifier=discord`, retirée dès qu'elle est lue) ou, déjà sur
 * `/profil`, par un événement. L'adresse seule ne suffit pas : il faut que
 * cette page l'ait demandé juste avant (`takeCertifyDialogRequest`) — un lien
 * d'un autre site mène au profil sans ouvrir le dialogue. Attend que l'état Discord soit **lu** (`ready`)
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
  const { t } = useProfileText();
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
    // Demande consommée dans tous les cas : une demande restée en mémoire ne
    // doit pas servir à une visite ultérieure de `/profil`.
    const requestedHere = takeCertifyDialogRequest();
    if (wantsCertifyDialog(window.location.search)) {
      if (requestedHere) setRequested(true);
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
    if (verified) showSuccess(t("discord.alreadyVerified"));
    else open();
  }, [requested, ready, verified, open, showSuccess, t]);
}
