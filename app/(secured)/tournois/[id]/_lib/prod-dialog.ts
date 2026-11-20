/**
 * Fenêtre « Prod du match » (`ProdDialog`, `docs/features/MATCH_PROD.md`) :
 * ce que la route `GET /api/admin/matches/[id]/prod` rend, et les comptes que
 * le staff peut y choisir. Module pur.
 */

/** Un compte de la fenêtre ; `block` : pourquoi il ne peut pas être placé sur ce match. */
export type ProdPanelUserView = { userId: number; pseudo: string; block: "PROD_IS_PLAYER" | "PROD_IS_CASTER" | null };

export type ProdPanelView = {
  matchId: number;
  prod: { userId: number; pseudo: string } | null;
  candidates: ProdPanelUserView[];
};

/**
 * Les comptes affichés au choix : tous sauf la prod actuelle. Ceux qui ne peuvent
 * pas être placés (`block`) y figurent grisés, avec leur raison — sinon le staff ne
 * saurait pas pourquoi la personne qu'il cherche manque.
 */
export function prodOptions(panel: ProdPanelView): ProdPanelUserView[] {
  return panel.candidates.filter((candidate) => candidate.userId !== panel.prod?.userId);
}

/**
 * Les comptes proposés : ceux qui peuvent être placés (ni joueur ni caster du
 * match), sans la prod actuelle — la choisir ne changerait rien.
 */
export function prodPickable(panel: ProdPanelView): ProdPanelUserView[] {
  return panel.candidates.filter((candidate) => candidate.block === null && candidate.userId !== panel.prod?.userId);
}
