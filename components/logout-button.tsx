"use client";

import { useRouter } from "next/navigation";
import { Button } from "./Button";

export function LogoutButton() {
  const router = useRouter();

  const onLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/");
    router.refresh();
  };

  return (
    <Button variant="ghost" onClick={onLogout}>
      Déconnexion
    </Button>
  );
}
