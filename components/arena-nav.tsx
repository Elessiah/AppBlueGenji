"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoWithGlow } from "./logo-with-glow";
import { UserAvatar } from "./user-avatar";
import { isNavLinkActive } from "@/lib/shared/nav-active";
import s from "./arena-nav.module.css";

type ArenaNavProps = {
  pseudo: string;
  avatarUrl: string | null;
  activeTeam?: { teamId: number; teamName: string } | null;
};

const links = [
  { href: "/joueurs", label: "Joueurs", rgb: "90, 200, 255" },
  { href: "/equipes", label: "Équipes", rgb: "255, 157, 46" },
  { href: "/tournois", label: "Tournois", rgb: "79, 224, 162" },
];

export function ArenaNav({ pseudo, avatarUrl, activeTeam }: ArenaNavProps) {
  const pathname = usePathname();

  return (
    <nav className={s.nav} aria-label="Navigation principale">
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
            <span aria-hidden="true">⌂</span> Accueil
          </Link>
          {activeTeam && (
            <Link
              href={`/equipes/${activeTeam.teamId}`}
              className={s.navHome}
              aria-label={`Mon équipe : ${activeTeam.teamName}`}
              title={activeTeam.teamName}
            >
              <span aria-hidden="true">🛡</span> Mon équipe
            </Link>
          )}
          <Link href="/profil" className={s.avatarChip}>
            <UserAvatar src={avatarUrl} pseudo={pseudo} size={30} borderWidth={1} decorative />
            <span className={s.chipName}>{pseudo}</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
