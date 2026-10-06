"use client";

import { useShellText } from "@/components/i18n/shell-text";
import { requestAccessibilityMenu } from "@/lib/shared/accessibility-menu-request";

interface AccessibilityFooterLinkProps {
  className?: string;
}

/**
 * Entrée « Réglages d'accessibilité » du pied de page : une seconde porte vers
 * le menu, pour qui a manqué le bouton flottant. C'est un **bouton** et non un
 * lien — il n'emmène nulle part, il ouvre un panneau de la page (et Espace
 * doit l'activer). Le libellé se distingue à dessein de la mention RGAA
 * voisine, « Accessibilité : non conforme » : deux liens presque homonymes
 * l'un sous l'autre ne disaient pas lequel des deux ouvre quoi.
 */
export function AccessibilityFooterLink({ className }: Readonly<AccessibilityFooterLinkProps>) {
  const { t } = useShellText();
  return (
    <button type="button" className={className} onClick={(event) => requestAccessibilityMenu(event.currentTarget)}>
      {t("footer.accessibilitySettings")}
    </button>
  );
}
