"use client";

import { useState } from "react";
import { requestLogout } from "@/components/account-menu";
import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { useToast } from "@/components/ui/toast";
import { Button } from "./Button";

/** « Déconnexion » de `/profil` — le mot du menu du compte, dans la langue de la page. */
export function LogoutButton() {
  const router = useLocaleRouter();
  const { t } = useShellText();
  const { showError } = useToast();
  const [leaving, setLeaving] = useState(false);

  // Comme le menu du compte : un échec se dit, au lieu de ramener à l'accueil
  // un joueur toujours connecté ; un second clic n'envoie rien de plus.
  const onLogout = async () => {
    if (leaving) return;
    setLeaving(true);
    const done = await requestLogout();
    setLeaving(false);
    if (!done) {
      showError(t("account.logoutFailed"));
      return;
    }
    router.push("/");
    router.refresh();
  };

  return (
    <Button variant="ghost" onClick={onLogout} disabled={leaving} aria-busy={leaving || undefined}>
      {t("account.logout")}
    </Button>
  );
}
