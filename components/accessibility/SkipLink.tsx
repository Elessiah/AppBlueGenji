"use client";

import type { MouseEvent } from "react";
import { skipLinkTarget } from "@/lib/shared/skip-link";

/** Ancre de repli, sans effet quand JavaScript tourne. */
const SKIP_LINK_HREF = "#contenu";

/**
 * Pose le focus au début du contenu de la page. Rend `false` quand la page n'a
 * pas de `<main>`, ou que la cible refuse le focus : le lien laisse alors le
 * navigateur suivre son ancre.
 *
 * La cible reçoit `tabindex="-1"` — un élément non interactif ne prend pas le
 * focus sans lui —, retiré dès qu'elle le perd : laissé en place, un clic dans
 * une zone vide du contenu y ramènerait le focus.
 */
export function focusMainContent(
  doc: { querySelector(selectors: "main"): HTMLElement | null } = document,
): boolean {
  const main = doc.querySelector("main");
  if (!main) return false;

  const target = skipLinkTarget(main);
  // Le marqueur est posé même sur une cible déjà focalisable : c'est lui qui
  // porte la marge de défilement sous l'en-tête collant. Le `tabindex`, lui,
  // n'est retiré que s'il a été ajouté ici.
  const addedTabIndex = !target.hasAttribute("tabindex");
  if (addedTabIndex) target.setAttribute("tabindex", "-1");
  target.setAttribute("data-skip-target", "");
  const cleanup = () => {
    if (addedTabIndex) target.removeAttribute("tabindex");
    target.removeAttribute("data-skip-target");
  };
  target.addEventListener("blur", cleanup, { once: true });
  target.focus();

  // Une cible masquée par une feuille de style refuse le focus sans rien dire :
  // aucun `blur` ne viendrait alors retirer ce qui vient d'être posé.
  if (target.ownerDocument.activeElement !== target) {
    target.removeEventListener("blur", cleanup);
    cleanup();
    return false;
  }
  return true;
}

/**
 * Lien d'évitement « Aller au contenu » (WCAG 2.4.1, RGAA 12.7).
 *
 * Rendu par la mise en page racine juste après le bouton d'accessibilité : c'est
 * le deuxième arrêt du clavier sur toutes les pages. Invisible tant qu'il n'a
 * pas le focus (`.skip-link`, `app/globals.css`) — aucun effet visuel sinon.
 */
export function SkipLink() {
  const onClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (focusMainContent()) event.preventDefault();
  };

  return (
    <a href={SKIP_LINK_HREF} className="skip-link" onClick={onClick}>
      Aller au contenu
    </a>
  );
}
