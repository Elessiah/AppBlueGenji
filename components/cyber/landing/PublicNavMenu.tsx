"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { isNavLinkActive } from "@/lib/shared/nav-active";
import styles from "./PublicNavMenu.module.css";

type NavLink = { href: string; label: string };

const LINKS: NavLink[] = [
  { href: "/#tournois", label: "Tournois" },
  { href: "/regles", label: "Règles des tournois" },
  { href: "/#equipes", label: "Équipes" },
  { href: "/joueurs", label: "Joueurs" },
  { href: "/recrutement", label: "Recrutement" },
  { href: "/bot", label: "Bot" },
  { href: "/association", label: "L'asso" },
  { href: "/benevoles", label: "Bénévoles" },
];

/**
 * Échap ferme le panneau et, si le focus y était, le rend au bouton : le
 * panneau fermé emporte le lien qui avait le focus, et sans ce retour le
 * clavier repartirait du haut de la page. Rend `true` quand la touche a été
 * traitée.
 */
export function handleMenuEscape(
  key: string,
  focused: Element | null,
  root: { contains(node: Node | null): boolean } | null,
  button: { focus(): void } | null,
  close: () => void,
): boolean {
  if (key !== "Escape") return false;
  close();
  if (root?.contains(focused)) button?.focus();
  return true;
}

/**
 * La tabulation qui quitte le menu le ferme : resté ouvert, le panneau
 * recouvrait le contenu où le focus venait de partir (WCAG 2.4.3). Seule une
 * cible **connue et extérieure** ferme — `relatedTarget` vaut `null` quand le
 * focus part vers la barre du navigateur ou qu'un clic tombe sur une zone non
 * focalisable, y compris à l'intérieur du panneau : le clic dehors a déjà son
 * propre écouteur, et fermer sur un clic dans le panneau lui-même serait faux.
 */
export function focusLeavesMenu(
  nextFocus: EventTarget | null,
  root: { contains(node: Node | null): boolean } | null,
): boolean {
  if (!nextFocus || !root) return false;
  return !root.contains(nextFocus as Node);
}

/**
 * Le panneau ouvert : les liens de la vitrine, la page courante signalée
 * autrement que par le style (`aria-current`, WCAG 1.3.1).
 */
export function PublicNavPanel({
  id,
  pathname,
  onNavigate,
}: {
  id: string;
  pathname: string | null;
  onNavigate: () => void;
}) {
  return (
    <nav id={id} className={styles.panel} aria-label="Navigation principale">
      {LINKS.map((link) => {
        const isActive = isNavLinkActive(pathname, link.href);
        return (
          <Link
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={`${styles.link} ${isActive ? styles.linkActive : ""}`}
            onClick={onNavigate}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

/**
 * Menu de navigation principal des pages vitrine, présenté sous forme de menu
 * burger : un bouton ouvre un panneau listant tous les liens. Se ferme au clic
 * en dehors, sur un lien, avec la touche Échap, ou quand la tabulation en sort.
 *
 * Le bouton porte un libellé « MENU » en plus des trois barres : l'icône seule
 * passait inaperçue à côté des CTA de l'en-tête. Il est rendu en tête de
 * l'en-tête (avant la marque) pour la même raison.
 */
export function PublicNavMenu() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      handleMenuEscape(e.key, document.activeElement, rootRef.current, buttonRef.current, () =>
        setOpen(false),
      );
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
    <div
      className={styles.root}
      ref={rootRef}
      onBlur={(event) => {
        if (open && focusLeavesMenu(event.relatedTarget, event.currentTarget)) setOpen(false);
      }}
    >
      {/* Pas d'`aria-haspopup` : il annonce un `role="menu"`, dont le lecteur
          d'écran attend les flèches — le panneau est une simple navigation. */}
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.burger} ${open ? styles.burgerOpen : ""}`}
        aria-label={open ? "Fermer le menu" : "Ouvrir le menu"}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.bars} aria-hidden="true">
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </span>
        <span className={styles.label}>MENU</span>
      </button>

      {open && (
        <PublicNavPanel id={panelId} pathname={pathname} onNavigate={() => setOpen(false)} />
      )}
    </div>
  );
}
