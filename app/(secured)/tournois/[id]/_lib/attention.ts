import { attentionDocumentTitle, type ViewerAlert } from "@/lib/shared/viewer-alerts";

/**
 * Titre d'onglet d'appel : « ● Ton match est prêt · <titre> », posé quand la
 * page n'a pas le focus et retiré dès qu'elle le reprend.
 *
 * C'est ce qu'on voit d'un onglet derrière un jeu ou sur un second écran — dans
 * la barre des tâches, dans la liste des onglets. Le titre ne **clignote** pas :
 * un clignotement, c'est un minuteur qui réveille la page chaque seconde, ce que
 * le régime de charge cherche justement à éviter.
 */

/** Titre d'origine, gardé tant qu'un appel est affiché. */
let baseTitle: string | null = null;
/** Titre que l'appel a posé : seul celui-là est à nous de retirer. */
let appliedTitle: string | null = null;

function pageIsWatched(): boolean {
  try {
    return document.visibilityState === "visible" && document.hasFocus();
  } catch {
    return true;
  }
}

function restore(): void {
  if (baseTitle === null) return;
  // Le titre a pu changer depuis — une navigation vers une autre page l'a
  // réécrit : remettre l'ancien écraserait celui de la page qui s'affiche.
  if (document.title === appliedTitle) document.title = baseTitle;
  baseTitle = null;
  appliedTitle = null;
  window.removeEventListener("focus", onReturn);
  document.removeEventListener("visibilitychange", onReturn);
}

function onReturn(): void {
  if (pageIsWatched()) restore();
}

/** Signale l'évènement dans le titre, sauf si le lecteur regarde déjà la page. */
export function raiseAttention(alert: ViewerAlert): void {
  if (pageIsWatched()) return;
  // Un titre réécrit par quelqu'un d'autre depuis le dernier appel devient la
  // nouvelle base : c'est lui qu'on remettra.
  if (baseTitle !== null && document.title !== appliedTitle) {
    baseTitle = document.title;
  }
  if (baseTitle === null) {
    baseTitle = document.title;
    window.addEventListener("focus", onReturn);
    document.addEventListener("visibilitychange", onReturn);
  }
  appliedTitle = attentionDocumentTitle(alert, baseTitle);
  document.title = appliedTitle;
}

/** Retire l'appel (démontage de la page : le titre suivant ne doit pas en hériter). */
export function clearAttention(): void {
  restore();
}
