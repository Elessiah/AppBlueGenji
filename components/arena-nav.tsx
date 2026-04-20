"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

type ArenaNavProps = {
  pseudo: string;
  avatarUrl: string | null;
};

const links = [
  { href: "/joueurs", label: "Joueurs", rgb: "89, 212, 255" },
  { href: "/equipes", label: "Équipes", rgb: "255, 157, 46" },
  { href: "/tournois", label: "Tournois", rgb: "79, 224, 162" },
];

export function ArenaNav({ pseudo, avatarUrl }: ArenaNavProps) {
  const pathname = usePathname();

  return (
    <div className="nav-shell fade-in">
      <div className="nav-links">
        {links.map((link) => {
          const isActive = pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <Link
              key={link.href}
              href={link.href}
              className={`nav-link ${isActive ? "active" : ""}`}
              style={{ "--nav-color": link.rgb } as React.CSSProperties}
            >
              {link.label}
            </Link>
          );
        })}
      </div>
      <Link href="/profil" className="avatar-chip nav-link">
        <Image className="avatar" src={avatarUrl || "/vercel.svg"} alt="Avatar" width={36} height={36} unoptimized referrerPolicy="no-referrer" />
        <span>{pseudo}</span>
      </Link>
    </div>
  );
}
