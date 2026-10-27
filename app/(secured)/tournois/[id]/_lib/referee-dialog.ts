/**
 * Ce que la fenêtre « Arbitrage » (`RefereeDialog`) offre, décidé hors du
 * composant (`docs/features/MATCH_REFEREE.md`) : la règle se teste sans rendu.
 */

/** Fiche lue par `GET /api/admin/matches/[id]/referee` (`loadRefereePanel`). */
export type RefereePanelView = {
  matchId: number;
  referee: { userId: number; pseudo: string; eligible: boolean } | null;
  selfManaged: boolean;
  firstMap: string | null;
  round: { phaseId: number; roundNumber: number; bracket: string };
  candidates: ReadonlyArray<{ userId: number; pseudo: string }>;
};

export type RefereeDialogActions = {
  /** Prendre le match : personne ne l'arbitre, ou son arbitre ne le peut plus. */
  take: boolean;
  /** Se retirer : le lecteur est l'arbitre du match. */
  releaseSelf: boolean;
  /** Retirer l'arbitre désigné, quand c'est quelqu'un d'autre. */
  removeOther: boolean;
  /** Comptes qu'on peut désigner : tous ceux qui le peuvent, sauf l'arbitre en place. */
  candidates: ReadonlyArray<{ userId: number; pseudo: string }>;
};

export function refereeDialogActions(panel: RefereePanelView, viewerUserId: number): RefereeDialogActions {
  const current = panel.referee;
  const mine = current !== null && current.userId === viewerUserId;
  return {
    take: !mine && (current === null || !current.eligible),
    releaseSelf: mine,
    removeOther: current !== null && !mine,
    candidates: panel.candidates.filter((candidate) => candidate.userId !== current?.userId),
  };
}

/** Ce que la fenêtre sait du focus au retour d'un geste. */
type FocusCandidate = { isConnected: boolean };

/**
 * Où rendre le focus quand un geste de la fenêtre s'achève : rien si le focus
 * est encore sur un élément vivant ; sinon le contrôle qui a lancé le geste
 * s'il existe toujours (désactivé le temps de l'envoi, le navigateur l'a
 * lâché), et la phrase d'état quand le geste a retiré son propre bouton.
 */
export function refereeFocusTarget<E extends FocusCandidate>(input: {
  active: E | null;
  body: E;
  trigger: E | null;
  status: E | null;
}): E | null {
  const { active, body, trigger, status } = input;
  if (active !== null && active !== body && active.isConnected) return null;
  if (trigger !== null && trigger !== body && trigger.isConnected) return trigger;
  return status;
}
