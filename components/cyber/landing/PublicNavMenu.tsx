"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import styles from "./PublicNavMenu.module.css";

type NavLink = { href: string; label: string };

const LINKS: NavLink[] = [
  { href: "/#tournois", label: "Tournois" },
  { href: "/#equipes", label: "Équipes" },
  { href: "/joueurs", label: "Joueurs" },
  { href: "/recrutement", label: "Recrutement" },
  { href: "/bot", label: "Bot" },
  { href: "/association", label: "L'asso" },
  { href: "/benevoles", label: "Bénévoles" },
];

/**
 * Menu de navigation principal des pages vitrine, présenté sous forme de menu
 * burger : un bouton ouvre un panneau listant tous les liens. Se ferme au clic
 * en dehors, sur un lien, ou avec la touche Échap.
 */
export function PublicNavMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div className={styles.root} ref={rootRef}>
      <button
        type="button"
        className={`${styles.burger} ${open ? styles.burgerOpen : ""}`}
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.bar} />
        <span className={styles.bar} />
        <span className={styles.bar} />
      </button>

      {open && (
        <nav className={styles.panel} aria-label="Navigation principale">
          {LINKS.map((link) => {
            const isActive =
              link.href.startsWith("/") &&
              !link.href.includes("#") &&
              (pathname === link.href || pathname.startsWith(`${link.href}/`));
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`${styles.link} ${isActive ? styles.linkActive : ""}`}
                onClick={() => setOpen(false)}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>
      )}
    </div>
  );
}
