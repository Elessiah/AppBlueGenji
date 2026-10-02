import { touchesViewerMatches } from "@/lib/shared/viewer-alerts";
import type { TournamentDetail } from "@/lib/shared/types";
import { INITIAL_LIVE_STATE, type LiveState } from "./live-state";

/**
 * Régime de charge du suivi en direct (`lib/shared/client-power.ts`,
 * `docs/features/CLIENT_POWER_MODES.md`) : ce qui est *reçu* et ce qui est
 * *rendu* sont deux choses.
 *
 * Tout instantané est intégré sur-le-champ par `useTournamentLive` — c'est sur
 * lui qu'on détecte « ton match est prêt », qu'on sonne et qu'on écrit le titre
 * d'onglet —, mais il n'est **rendu** que si quelqu'un peut le voir : tout de
 * suite quand la page est regardée ou sur un second écran, regroupé pour un
 * joueur en match qui regarde son jeu (sauf ce qui touche son propre match), et
 * pas avant le retour quand l'onglet est caché. Redessiner l'arbre d'un gros
 * plateau à chaque score d'un autre match, c'était prendre au jeu du joueur des
 * images par dizaines.
 *
 * Le délai de rendu est celui du régime (`snapshotRenderDelayMs`) : `0` rend
 * tout de suite, `null` attend le retour, un nombre regroupe.
 */
export type LiveRenderGate = {
  /** Rend le dernier état reçu. */
  flush: () => void;
  /** Un état vient d'être reçu (`previous` → `next`). */
  received: (delay: number | null, previous: TournamentDetail | null, next: TournamentDetail | null) => void;
  /** Le régime a changé : ce qui attendait est rendu dès qu'on peut le voir. */
  policyChanged: (delay: number | null) => void;
  /** Autre tournoi : rien n'attend plus, et rien n'a été rendu. */
  reset: () => void;
  /** Démontage : aucun minuteur ne survit à la page. */
  dispose: () => void;
};

/**
 * `render` publie le dernier état **reçu** et le rend : c'est l'état
 * désormais affiché. Sans détail rendu, la page affiche encore « Chargement… ».
 */
export function createLiveRenderGate(render: () => LiveState): LiveRenderGate {
  /** Un état reçu attend d'être rendu. */
  let pending = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  /** Dernier état **rendu**. */
  let rendered: LiveState = INITIAL_LIVE_STATE;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const flush = () => {
    pending = false;
    cancelTimer();
    rendered = render();
  };

  return {
    flush,
    received(delay, previous, next) {
      if (delay === 0) {
        flush();
        return;
      }
      pending = true;
      // Onglet caché : rien avant le retour (`policyChanged` s'en charge).
      if (delay === null) return;
      // Ne se regroupent pas : une page encore vide (rien n'a été *rendu*, même
      // si quelque chose a été reçu onglet caché), et le match du lecteur,
      // c'est ce qu'il regarde.
      const urgent = !rendered.detail || !previous || !next || touchesViewerMatches(previous, next);
      if (urgent) {
        flush();
        return;
      }
      timer ??= setTimeout(flush, delay);
    },
    policyChanged(delay) {
      // Ce qui attendait est rendu dès qu'on peut le voir — et pas avant : un
      // regroupement armé hors focus ne doit pas redessiner l'arbre derrière le
      // jeu si l'onglet vient d'être caché. Le rendu reste dû, pour le retour.
      if (!pending) return;
      // Une page encore vide ne patiente pas : les données sont là.
      if (delay === 0 || (delay !== null && !rendered.detail)) flush();
      else if (delay === null) cancelTimer();
      else timer ??= setTimeout(flush, delay);
    },
    reset() {
      pending = false;
      cancelTimer();
      rendered = INITIAL_LIVE_STATE;
    },
    dispose: cancelTimer,
  };
}

/**
 * Palier spectateur du flux (`?quiet=1`) pour un onglet caché hors match ;
 * palier normal au retour. Les annonces arrivent encore — à la cadence des
 * spectateurs —, et le budget de sortie de la salle revient à ceux qui jouent.
 */
export type QuietStream = {
  /** Le flux doit-il s'ouvrir au palier spectateur ? */
  isQuiet: () => boolean;
  /** Le seuil du régime (`quietStreamAfterMs`) est passé de `previous` à `next`. */
  policyChanged: (previous: number | null, next: number | null) => void;
  /** Autre tournoi : il repart au palier normal. */
  reset: () => void;
  /** Démontage : le minuteur en attente ne survit pas. */
  dispose: () => void;
};

/** `reconnect` rouvre le flux, qui relit alors `isQuiet()`. */
export function createQuietStream(reconnect: () => void): QuietStream {
  /** Flux ouvert au palier spectateur (`?quiet=1`). */
  let quiet = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cancelTimer = () => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    isQuiet: () => quiet,
    policyChanged(previous, next) {
      if (next === previous) return;
      cancelTimer();
      if (next === null) {
        if (quiet) {
          quiet = false;
          reconnect();
        }
        return;
      }
      timer = setTimeout(() => {
        timer = null;
        quiet = true;
        reconnect();
      }, next);
    },
    reset() {
      quiet = false;
    },
    dispose: cancelTimer,
  };
}
