"use client";

import { useState } from "react";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";

/**
 * Le geste « Déconnexion », commun au menu du compte et au bouton de `/profil` :
 * un échec se dit (toast) au lieu de ramener à l'accueil un joueur toujours
 * connecté ; un second clic n'envoie rien de plus, et le bouton reste occupé
 * jusqu'à l'accueil (`leaving` ne retombe qu'après un échec).
 */
export function useLogout(onSuccess?: () => void): { leaving: boolean; logout: () => Promise<void> } {
  const router = useLocaleRouter();
  const { showError } = useToast();
  const { t } = useShellText();
  const [leaving, setLeaving] = useState(false);
  const logout = async () => {
    if (leaving) return;
    setLeaving(true);
    if (!(await requestLogout())) {
      setLeaving(false);
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
