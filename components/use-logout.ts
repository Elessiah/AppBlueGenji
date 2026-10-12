"use client";

import { useState } from "react";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";

/**
 * Le geste « Déconnexion », commun au menu du compte et au bouton de `/profil` :
 * un échec se dit (toast) au lieu de ramener à l'accueil un joueur toujours
 * connecté ; un second clic pendant la requête n'envoie rien de plus. `leaving`
 * retombe après chaque tentative : un composant qui survit à la navigation (menu
 * de la barre, déconnexion depuis l'accueil) ne reste pas figé sur « … ».
 */
export function useLogout(onSuccess?: () => void): { leaving: boolean; logout: () => Promise<void> } {
  const router = useLocaleRouter();
  const { showError } = useToast();
  const { t } = useShellText();
  const [leaving, setLeaving] = useState(false);
  const logout = async () => {
    if (leaving) return;
    setLeaving(true);
    const done = await requestLogout();
    setLeaving(false);
    if (!done) {
      showError(t("account.logoutFailed"));
      return;
    }
    onSuccess?.();
    router.push("/");
    router.refresh();
  };
  return { leaving, logout };
}

/**
 * Ferme la session côté serveur. Rend `false` si la requête échoue ou est
 * refusée : l'appelant le dit (toast) au lieu de ramener à l'accueil un
 * joueur toujours connecté.
 */
export async function requestLogout(fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl("/api/auth/logout", { method: "POST" });
    return res.ok;
  } catch {
    return false;
  }
}
