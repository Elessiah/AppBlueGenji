"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LocaleLink, useLocalePathname } from "@/components/i18n/locale-navigation";
import { GETI_DEFAULT_LIST_PATH, GETI_PAGE_PATH } from "@/lib/shared/geti/path";
import { isNavLinkActive } from "@/lib/shared/nav-active";
import { useShellText } from "@/components/i18n/shell-text";
import type { ShellKey } from "@/lib/shared/shell-text";
import styles from "./PublicNavMenu.module.css";

/**
 * `section` : la rubrique que l'entrée désigne comme page courante, quand elle
 * diffère de `href` (l'entrée des annonces mène à la liste canonique
 * `/geti-info/lfs` mais reste courante sur toute page `/geti-info…`).
 */
type NavLink = { href: string; labelKey: ShellKey; featured?: boolean; section?: string };

/**
 * Une entrée par page, jamais deux vers la même adresse. Les annonces GETI
 * ouvrent la liste, mises en avant (`featured`) : c'est une fonction principale
 * du site. Rien n'y mène à la partie compétitive (tournois, équipes, joueurs,
 * classement, règles) : on y entre par l'accueil, par le bouton de l'en-tête
 * une fois connecté et par le pied de page
 * (docs/features/PUBLIC_NAVIGATION.md).
 *
 * L'entrée des annonces mène à l'adresse canonique de la liste par défaut
 * (`/geti-info/lfs`, comme l'encart de l'accueil : une seule adresse par liste)
 * et reste la page courante sur toute la rubrique `/geti-info`. Ces adresses
 * viennent de `lib/shared/geti/path.ts`, module sans dépendance : importer `lib/shared/geti/page.ts` chargerait les filtres des
 * annonces dans l'en-tête de chaque page.
 */
export const PUBLIC_NAV_LINKS: readonly NavLink[] = [
  { href: GETI_DEFAULT_LIST_PATH, section: GETI_PAGE_PATH, labelKey: "nav.links.geti", featured: true },
  { href: "/bot", labelKey: "nav.links.bot" },
  { href: "/association", labelKey: "nav.links.association" },
  { href: "/recrutement", labelKey: "nav.links.recruitment" },
  { href: "/benevoles", labelKey: "nav.links.volunteers" },
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
 * La tabulation a-t-elle quitté le menu ? Le panneau ouvert est posé par-dessus
 * le contenu : laissé ouvert quand le focus en sort, il recouvre justement
 * l'endroit où le clavier vient d'arriver (WCAG 2.4.3). `next` est la cible
 * qui reçoit le focus (`relatedTarget` du `focusout`) ; `null` ne ferme **pas** —
 * c'est le cas d'une fenêtre qui perd le focus (changement d'application), où
 * l'on retrouve le menu tel qu'on l'a laissé, et d'un clic dans le vide, que
 * l'écouteur de clic extérieur traite déjà.
 */
export function focusLeftMenu(
  root: { contains(node: Node | null): boolean } | null,
  next: EventTarget | null,
): boolean {
  return root !== null && next !== null && !root.contains(next as Node);
}

/**
 * Le panneau ouvert : les liens de la vitrine, la page courante signalée
 * autrement que par le style (`aria-current`, WCAG 1.3.1).
 */
export function PublicNavPanel({
  id,
  pathname,
  onNavigate,
}: Readonly<{
  id: string;
  pathname: string | null;
  onNavigate: () => void;
}>) {
  const { t } = useShellText();
  return (
    <nav id={id} className={styles.panel} aria-label={t("nav.mainLabel")}>
      {PUBLIC_NAV_LINKS.map((link) => {
        const isActive = isNavLinkActive(pathname, link.section ?? link.href);
        return (
          <LocaleLink
            key={link.href}
            href={link.href}
            aria-current={isActive ? "page" : undefined}
            className={[styles.link, link.featured ? styles.linkFeatured : "", isActive ? styles.linkActive : ""]
              .filter(Boolean)
              .join(" ")}
            onClick={onNavigate}
          >
            {t(link.labelKey)}
          </LocaleLink>
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
  // Chemin sans préfixe de langue : `/en/tournois` reste la section « Tournois ».
  const { path: pathname } = useLocalePathname();
  const { t } = useShellText();
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
      onBlur={(e) => {
        if (open && focusLeftMenu(rootRef.current, e.relatedTarget)) setOpen(false);
      }}
    >
      {/* Pas d'`aria-haspopup` : il annonce un `role="menu"`, dont le lecteur
          d'écran attend les flèches — le panneau est une simple navigation. */}
      <button
        ref={buttonRef}
        type="button"
        className={`${styles.burger} ${open ? styles.burgerOpen : ""}`}
        aria-label={open ? t("nav.closeMenu") : t("nav.openMenu")}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={styles.bars} aria-hidden="true">
          <span className={styles.bar} />
          <span className={styles.bar} />
          <span className={styles.bar} />
        </span>
        <span className={styles.label}>{t("nav.menuButton")}</span>
      </button>

      {open && (
        <PublicNavPanel id={panelId} pathname={pathname} onNavigate={() => setOpen(false)} />
      )}
    </div>
  );
}
