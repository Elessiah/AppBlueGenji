"use client";

import { useLogout } from "@/components/use-logout";
import { useShellText } from "@/components/i18n/shell-text";
import { Button } from "./Button";

/** « Déconnexion » de `/profil` — le geste et le mot du menu du compte, dans la langue de la page. */
export function LogoutButton() {
  const { t } = useShellText();
  const { leaving, logout } = useLogout();

  return (
    // `aria-disabled` plutôt que `disabled` : le focus reste sur le bouton (un
    // échec se retente au clavier sans tout reparcourir) ; `useLogout` ignore
    // déjà un second clic pendant la requête. L'aspect d'attente vient de
    // `profil.module.css` (`.btn[aria-disabled="true"]`), seule page du bouton.
    <Button
      variant="ghost"
      onClick={logout}
      aria-disabled={leaving || undefined}
      aria-busy={leaving || undefined}
    >
      {/* Libellé fixe (pas de saut de largeur) : l'attente se dit par `aria-busy` et les couleurs. */}
      {t("account.logout")}
    </Button>
  );
}
