import type { CSSProperties, ReactNode } from "react";
import type { AuthUser } from "@/lib/server/auth";
import { getUserActiveTeam } from "@/lib/server/teams/roster";
import { countOpenReports } from "@/lib/server/content-reports";
import { can } from "@/lib/shared/permissions";
import { ArenaNav } from "@/components/arena-nav";
import { SiteFooterBar } from "@/components/legal/SiteFooterBar";

/**
 * Gabarit des connectés : barre `ArenaNav`, contenu principal, pied de page —
 * en frères, un seul repère de chaque (`banner`/`navigation`, `main`,
 * `contentinfo`). Rendu par l'espace `(secured)` et par les pages publiques
 * qui suivent la session (`SessionPageShell`), pour que la barre soit la même
 * partout où l'on est connecté.
 *
 * Server component : l'équipe active et le compteur de signalements se lisent
 * ici, sans requête côté client ni flash d'en-tête.
 */
export async function ArenaShell({
  user,
  children,
  mainClassName,
  mainStyle,
}: Readonly<{ user: AuthUser; children: ReactNode; mainClassName?: string; mainStyle?: CSSProperties }>) {
  // Ni l'équipe active ni le compteur ne doivent faire tomber la page : une
  // lecture ratée masque le raccourci d'équipe ou affiche le compteur à zéro.
  const activeTeam = await getUserActiveTeam(user.id).catch(() => null);
  const openReports = can(user, "moderation") ? await countOpenReports().catch(() => 0) : null;

  return (
    <>
      <ArenaNav
        pseudo={user.pseudo}
        avatarUrl={user.avatarUrl}
        activeTeam={activeTeam}
        openReports={openReports}
      />
      <main className={mainClassName} style={mainStyle}>{children}</main>
      <SiteFooterBar authenticated />
    </>
  );
}
