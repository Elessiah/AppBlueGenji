/**
 * Le bouton « i » (`components/ui/info-hint.tsx`) n'est pas une action : il
 * déplie une explication. Un test qui vérifie qu'un écran n'offre « aucun
 * geste » le retire d'abord du balisage, sans fermer les yeux sur un autre
 * bouton.
 */
const INFO_HINT_BUTTON = /<button type="button" class="trigger" aria-expanded="(?:true|false)" aria-controls="[^"]+" aria-label="[^"]+">[\s\S]*?<\/button>/g;

/** Le balisage sans ses boutons « i ». */
export function withoutInfoHintButtons(html: string): string {
  return html.replaceAll(INFO_HINT_BUTTON, "");
}

/** Le nombre de boutons « i » du balisage. */
export function infoHintButtonCount(html: string): number {
  return html.match(INFO_HINT_BUTTON)?.length ?? 0;
}
