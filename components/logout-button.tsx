"use client";

import type { CSSProperties } from "react";
import { useLogout } from "@/components/use-logout";
import { useShellText } from "@/components/i18n/shell-text";
import { Button } from "./Button";

const BUSY_STYLE: CSSProperties = { cursor: "progress" };

/** « Déconnexion » de `/profil` — le geste et le mot du menu du compte, dans la langue de la page. */
export function LogoutButton() {
  const { t } = useShellText();
  const { leaving, logout } = useLogout();

  return (
    // `aria-disabled` plutôt que `disabled` : le focus reste sur le bouton (un
    // échec se retente au clavier sans tout reparcourir) ; `useLogout` ignore
    // déjà un second clic pendant la requête.
    <Button
      variant="ghost"
      onClick={logout}
      aria-disabled={leaving || undefined}
      aria-busy={leaving || undefined}
      style={leaving ? BUSY_STYLE : undefined}
    >
      {leaving ? t("account.loggingOut") : t("account.logout")}
    </Button>
  );
}
