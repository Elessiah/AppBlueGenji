"use client";

import { useLogout } from "@/components/use-logout";
import { useShellText } from "@/components/i18n/shell-text";
import { Button } from "./Button";

/** « Déconnexion » de `/profil` — le geste et le mot du menu du compte, dans la langue de la page. */
export function LogoutButton() {
  const { t } = useShellText();
  const { leaving, logout } = useLogout();

  return (
    <Button variant="ghost" onClick={logout} disabled={leaving} aria-busy={leaving || undefined}>
      {leaving ? t("account.loggingOut") : t("account.logout")}
    </Button>
  );
}
