/**
 * Saisie d'un nombre dans un champ contrôlé — logique pure.
 *
 * Un `<input type="number">` contrôlé par un nombre ne peut pas être vide :
 * `Number("")` vaut `0`, si bien que vider le champ au Retour arrière y
 * réécrivait aussitôt un « 0 » devant le curseur, et qu'il fallait le
 * sélectionner pour taper une autre valeur. Le champ garde donc son **texte**
 * tant qu'on l'édite (`draft`), et ne transmet au formulaire que ce qui se lit
 * comme un nombre : vide ou texte partiel (« - », « 1e ») ne changent rien à la
 * valeur retenue, qui est rétablie à la sortie du champ.
 *
 * Utilisé par `components/ui/number-input.tsx`.
 */

/**
 * Nombre porté par le texte du champ, ou `null` s'il n'en porte pas encore un.
 * Espaces ignorés ; un texte vide n'est **pas** zéro.
 */
export function parseNumberDraft(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  return Number.isFinite(value) ? value : null;
}

/**
 * Texte à afficher : la saisie en cours tant qu'il y en a une, la valeur
 * retenue sinon.
 */
export function displayedNumber(draft: string | null, value: number | null | undefined): string {
  if (draft !== null) return draft;
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return String(value);
}
