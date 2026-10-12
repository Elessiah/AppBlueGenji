/**
 * Nom accessible d'un bouton dont le texte change pendant son geste
 * (« Retirer » → « Retrait… ») : le libellé long tant qu'il est au repos,
 * **aucun** une fois occupé — le texte visible fait alors le nom, et un
 * contrôle vocal qui dit ce qu'il voit l'atteint encore (WCAG 2.5.3).
 *
 * Module **pur**.
 */
export function busyAriaLabel(busy: boolean, label: string): string | undefined {
  return busy ? undefined : label;
}
