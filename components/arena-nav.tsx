"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogoWithGlow } from "./logo-with-glow";
import s from "./arena-nav.module.css";

type ArenaNavProps = {
  pseudo: string;
  avatarUrl: string | null;
};

const links = [
  { href: "/joueurs", label: "Joueurs", rgb: "90, 200, 255" },
  { href: "/equipes", label: "Équipes", rgb: "255, 157, 46" },
  { href: "/tournois", label: "Tournois", rgb: "79, 224, 162" },
];

export function ArenaNav({ pseudo, avatarUrl }: ArenaNavProps) {
  const pathname = usePathname();

  return (
    <nav className={s.nav}>
      <div className={`container ${s.navInner}`}>
        <div className={s.navLeft}>
          {links.map((link) => {
            const isActive =
              pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <Link
                key={link.href}
                href={link.href}
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
          <Link href="/" className={s.navHome}>
            ⌂ Accueil
          </Link>
          <Link href="/profil" className={s.avatarChip}>
            <Image
              src={avatarUrl || "/vercel.svg"}
              alt="Avatar"
              width={30}
              height={30}
              unoptimized
              referrerPolicy="no-referrer"
            />
            <span>{pseudo}</span>
          </Link>
        </div>
      </div>
    </nav>
  );
}
