"use client";

import { useLocaleRouter } from "@/components/i18n/locale-navigation";
import { useShellText } from "@/components/i18n/shell-text";
import { Button } from "./Button";

/** « Déconnexion » de `/profil` — le mot du menu du compte, dans la langue de la page. */
export function LogoutButton() {
  const router = useLocaleRouter();
  const { t } = useShellText();

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  return (
    <Button variant="ghost" onClick={onLogout}>
      {t("account.logout")}
    </Button>
  );
}
