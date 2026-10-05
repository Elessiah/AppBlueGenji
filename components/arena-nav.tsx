"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoWithGlow } from "./logo-with-glow";
import { AccountMenu } from "./account-menu";
import { isNavLinkActive } from "@/lib/shared/nav-active";
import { REPORTS_ADMIN_PATH } from "@/lib/shared/content-reports";
import s from "./arena-nav.module.css";

type ArenaNavProps = {
  pseudo: string;
  avatarUrl: string | null;
  activeTeam?: { teamId: number; teamName: string } | null;
  /**
   * Signalements à traiter, pour la modération (`null` : pas de permission, le
   * lien n'est pas rendu). Le nombre est celui du chargement de la page.
   */
  openReports?: number | null;
};

/**
 * Teinte de chaque section, en jetons de la palette « néon froid »
 * (DESIGN_SYSTEM.md) : joueurs glacier, équipes violet (comme leurs pages),
 * tournois vert d'eau, classement rose. Aucune teinte chaude (ni rouge du direct,
 * ni ambre, ni couleur de défaite).
 */
export const ARENA_NAV_LINKS = [
  { href: "/joueurs", label: "Joueurs", rgb: "var(--blue-500-rgb)" },
  { href: "/equipes", label: "Équipes", rgb: "var(--violet-400-rgb)" },
  { href: "/tournois", label: "Tournois", rgb: "var(--teal-400-rgb)" },
  { href: "/classement", label: "Classement", rgb: "var(--pink-400-rgb)" },
] as const;
const links = ARENA_NAV_LINKS;

export function ArenaNav({ pseudo, avatarUrl, activeTeam, openReports = null }: Readonly<ArenaNavProps>) {
  const pathname = usePathname();

  return (
    <nav className={s.nav} aria-label="Navigation principale" data-sticky-header>
      <div className={`container ${s.navInner}`}>
        <div className={s.navLeft}>
          {links.map((link) => {
            const isActive = isNavLinkActive(pathname, link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={isActive ? "page" : undefined}
                className={`${s.navLink} ${isActive ? s.navLinkActive : ""}`}
                style={{ "--nav-rgb": link.rgb } as React.CSSProperties}
              >
                {link.label}
              </Link>
            );
          })}
        </div>

        <Link href="/" className={s.navLogo} aria-label="Accueil">
          <LogoWithGlow
            src="/logo_bg.webp"
            alt="BlueGenji"
            width={32}
            height={32}
            size="sm"
            borderRadius={8}
            borderColor="rgba(0,0,0,0)"
          />
        </Link>

        <div className={s.navRight}>
          {/* Les pictogrammes sont décoratifs : lus à voix haute, « ⌂ » et
              « 🛡 » précédaient le nom du lien d'un mot sans rapport. */}
          <Link href="/" className={s.navHome}>
            <span aria-hidden="true">⌂</span> <span className={s.navHomeLabel}>Accueil</span>
          </Link>
          {activeTeam && (
            <Link
              href={`/equipes/${activeTeam.teamId}`}
              className={s.navHome}
              aria-label={`Mon équipe : ${activeTeam.teamName}`}
              title={activeTeam.teamName}
            >
              <span aria-hidden="true">🛡</span> <span className={s.navHomeLabel}>Mon équipe</span>
            </Link>
          )}
          {openReports !== null && (
            <Link
              href={REPORTS_ADMIN_PATH}
              className={`${s.navHome} ${s.navReports}`}
              aria-current={isNavLinkActive(pathname, REPORTS_ADMIN_PATH) ? "page" : undefined}
            >
              <span aria-hidden="true">⚑</span> <span className={s.navReportsLabel}>Signalements</span>
              {openReports > 0 && (
                <span className={s.navBadge}>
                  {openReports}
                  <span className="sr-only"> à traiter</span>
                </span>
              )}
            </Link>
          )}
          {/* Profil, équipe et déconnexion, à portée de main sur toutes les
              largeurs — sous 720 px, c'est le seul chemin vers sa propre équipe. */}
          <AccountMenu pseudo={pseudo} avatarUrl={avatarUrl} activeTeam={activeTeam} />
        </div>
      </div>
    </nav>
  );
}
