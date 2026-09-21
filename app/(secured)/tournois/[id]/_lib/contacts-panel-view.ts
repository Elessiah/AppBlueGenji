/**
 * Ce que le panneau de contacts doit montrer, d'après ce qu'il a en main.
 *
 * Trois états de React (`loading`, `entrants`, `failure`) font **quatre** vues,
 * et leur combinaison ne se lit pas d'elle-même : c'est précisément ce qui avait
 * laissé passer un trou. Écrite en ternaires imbriqués dans le JSX, la règle
 * avait un cas où les trois branches étaient fausses à la fois — chargement
 * retombé, liste encore `null` — et le panneau restait déplié, parfaitement
 * vide, le toast d'erreur s'étant effacé entre-temps. Une fonction pure rend ce
 * cas nommable, donc testable : `exhaustive` n'existe pas pour un `?:`.
 *
 * L'ordre des cas est la règle :
 *
 * 1. **premier chargement** — rien à montrer encore. Un rechargement, lui, garde
 *    la liste affichée : elle est périmée d'une seconde, pas fausse ;
 * 2. **échec** — avant la liste, et même quand une liste plus ancienne existe :
 *    un refus comme « tournoi terminé » ferme l'accès, y laisser les tags déjà
 *    reçus serait afficher ce que la route vient de refuser ;
 * 3. **liste vide** — un plateau sans engagé, qui se dit ;
 * 4. **liste**.
 */
export type ContactsPanelState = {
  loading: boolean;
  /** `null` = jamais chargé. */
  entrants: readonly unknown[] | null;
  /** Message déjà traduit, `null` = aucun échec depuis le dernier chargement. */
  failure: string | null;
};

export type ContactsPanelView = "LOADING" | "ERROR" | "EMPTY" | "LIST";

export function contactsPanelView(state: ContactsPanelState): ContactsPanelView {
  if (state.loading && state.entrants === null) return "LOADING";
  if (state.failure !== null) return "ERROR";
  // Ni liste, ni échec, ni chargement : l'état ne devrait pas exister, et c'est
  // la raison de le trancher ici plutôt que de le laisser tomber dans le vide.
  // « En attente » est la seule lecture honnête — il n'y a rien à montrer, mais
  // rien ne dit non plus qu'il n'y a rien.
  if (state.entrants === null) return "LOADING";
  return state.entrants.length === 0 ? "EMPTY" : "LIST";
}
