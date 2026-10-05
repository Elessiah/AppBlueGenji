import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/server/auth";
import { ArenaShell } from "@/components/arena-shell";
import { PublicPageShell } from "./PublicPageShell";

/**
 * Gabarit d'une page publique que la barre des connectés liste aussi
 * (`ARENA_NAV_LINKS`, ex. `/classement`) : un visiteur déconnecté — et donc
 * tout robot d'indexation — reçoit l'en-tête vitrine (`PublicPageShell`), un
 * connecté la même barre que sur `/tournois` ou `/equipes`, lien de la section
 * en `aria-current`.
 *
 * Le choix se fait au serveur (`getCurrentUser`, mémoïsé par requête : le
 * layout racine l'a déjà lu) : ni flash d'en-tête, ni requête de plus. Lire le
 * cookie rend la page dynamique — à n'employer que sur une page qui l'est déjà.
 * Le `<main>` garde le style vitrine : le contenu ne bouge pas d'un état à
 * l'autre.
 */
export async function SessionPageShell({ children }: Readonly<{ children: ReactNode }>) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) return <PublicPageShell>{children}</PublicPageShell>;
  return (
    <ArenaShell user={user} mainStyle={{ position: "relative", zIndex: 1 }}>
      {children}
    </ArenaShell>
  );
}
