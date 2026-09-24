"use client";

import { requestAccessibilityMenu } from "@/lib/shared/accessibility-menu-request";

interface AccessibilityFooterLinkProps {
  className?: string;
}

/**
 * Entrée « Accessibilité » du pied de page : une seconde porte vers le menu,
 * pour qui a manqué le bouton flottant. C'est un **bouton** et non un lien — il
 * n'emmène nulle part, il ouvre un panneau de la page (et Espace doit l'activer).
 */
export function AccessibilityFooterLink({ className }: AccessibilityFooterLinkProps) {
  return (
    <button type="button" className={className} onClick={(event) => requestAccessibilityMenu(event.currentTarget)}>
      Accessibilité
    </button>
  );
}
