import type { RefereeIneligibility } from "@/lib/shared/match-referee";

/**
 * Ce que la fenêtre « Arbitrage » (`RefereeDialog`) offre, décidé hors du
 * composant (`docs/features/MATCH_REFEREE.md`) : la règle se teste sans rendu.
 */

/** Fiche lue par `GET /api/admin/matches/[id]/referee` (`loadRefereePanel`). */
export type RefereePanelView = {
  matchId: number;
  referee: { userId: number; pseudo: string; eligible: boolean; reason: RefereeIneligibility | null } | null;
  /** Ce qui empêche le lecteur d'arbitrer ce match, `null` s'il le peut. */
  viewerBlock: RefereeIneligibility | null;
  selfManaged: boolean;
  firstMap: string | null;
  /** La manche et ses matchs encore à jouer : en tout, en autogestion, avec un arbitre. */
  round: { phaseId: number; roundNumber: number; bracket: string; open: number; selfManaged: number; refereed: number };
  /** Cartes réglées pour la manche : vides sans réglage (saisie par match ouverte). */
  roundSlots: ReadonlyArray<ReadonlyArray<string>>;
  candidates: ReadonlyArray<{ userId: number; pseudo: string }>;
  /** Arbitres dont l'opposition est retenue (`MATCH_REFEREE.md`). */
  objections: ReadonlyArray<{ userId: number; pseudo: string }>;
  /** Arbitres dont l'opposition peut être retenue. */
  objectable: ReadonlyArray<{ userId: number; pseudo: string }>;
};

export type RefereeDialogActions = {
  /**
   * Prendre le match : personne ne l'arbitre, ou son arbitre ne le peut plus —
   * jamais pour un lecteur qui ne peut pas l'arbitrer (`viewerBlock` :
   * condition d'arbitrage, joueur du match, opposition retenue).
   */
  take: boolean;
  /**
   * Le match est à prendre, mais pas par le lecteur : pourquoi (la fenêtre le
   * dit à la place du bouton) ; `null` sinon.
   */
  takeBlocked: RefereeIneligibility | null;
  /** Se retirer : le lecteur est l'arbitre du match. */
  releaseSelf: boolean;
  /** Retirer l'arbitre désigné, quand c'est quelqu'un d'autre. */
  removeOther: boolean;
  /** Comptes qu'on peut désigner : tous ceux qui le peuvent, sauf l'arbitre en place. */
  candidates: ReadonlyArray<{ userId: number; pseudo: string }>;
  /** Toute la manche en autogestion : un de ses matchs encore à jouer n'y est pas. */
  roundOn: boolean;
  /** Lever l'autogestion de la manche : un de ses matchs encore à jouer y est. */
  roundOff: boolean;
};

export function refereeDialogActions(panel: RefereePanelView, viewerUserId: number): RefereeDialogActions {
  const current = panel.referee;
  const mine = current !== null && current.userId === viewerUserId;
  const takeable = !mine && (current === null || !current.eligible);
  // L'opposition retenue se relit aussi dans la liste (`objections`), au cas où.
  const block =
    panel.viewerBlock ??
    (panel.objections.some((objection) => objection.userId === viewerUserId) ? "REFEREE_OBJECTION" : null);
  return {
    take: takeable && block === null,
    takeBlocked: takeable ? block : null,
    releaseSelf: mine,
    removeOther: current !== null && !mine,
    candidates: panel.candidates.filter((candidate) => candidate.userId !== current?.userId),
    roundOn: panel.round.selfManaged < panel.round.open,
    roundOff: panel.round.selfManaged > 0,
  };
}

/**
 * Ton de la confirmation d'un geste : `danger` quand il retire quelqu'un
 * (l'arbitre du match, ceux de la manche, l'arbitre visé par l'opposition),
 * neutre sinon (lever une autogestion ou une opposition, autogestion d'un
 * match sans arbitre).
 */
export function refereeConfirmTone(
  gesture: "removeReferee" | "selfOn" | "roundOn" | "roundOff" | "objection" | "liftObjection",
  panel: Pick<RefereePanelView, "referee" | "round">,
): "danger" | "primary" {
  switch (gesture) {
    case "removeReferee":
    case "objection":
      return "danger";
    case "selfOn":
      return panel.referee === null ? "primary" : "danger";
    case "roundOn":
      return panel.round.refereed > 0 ? "danger" : "primary";
    default:
      return "primary";
  }
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
  /**
   * Le panneau vient d'arriver (première lecture) : pendant la lecture, seul
   * « Fermer » était focalisable et le focus y est resté — il passe à la
   * phrase d'état, lue à son tour.
   */
  firstArrival?: boolean;
}): E | null {
  const { active, body, trigger, status, firstArrival = false } = input;
  if (firstArrival && status !== null) return status;
  if (active !== null && active !== body && active.isConnected) return null;
  if (trigger !== null && trigger !== body && trigger.isConnected) return trigger;
  return status;
}
