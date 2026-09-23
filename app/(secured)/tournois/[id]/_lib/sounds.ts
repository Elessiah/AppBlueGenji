import type { ViewerAlert } from "@/lib/shared/viewer-alerts";

/** Filet de sécurité : au-delà, le contexte est refermé même si la note n'a pas fini. */
export const CHIME_CLOSE_FALLBACK_MS = 1_000;

/**
 * Hauteur du signal par évènement : deux notes distinctes, pour qu'on sache
 * sans regarder s'il faut rejoindre son match ou confirmer un score.
 */
const ALERT_FREQUENCY: Partial<Record<ViewerAlert, number>> = {
  SCORE_TO_CONFIRM: 880,
  MATCH_READY: 660,
};

/**
 * Signal sonore bref. Le contexte audio est **refermé** une fois la note jouée :
 * il en était ouvert un nouveau à chaque signal, jamais rendu — un contexte
 * ouvert garde sa mémoire et son rendu audio actif, et il s'en ajoutait un à
 * chaque score confirmé, sur un poste qui fait tourner un jeu à côté.
 *
 * `onended` ne suffit pas : un contexte que le navigateur garde **suspendu**
 * (son bloqué tant que la page n'a reçu aucun geste — onglet ouvert depuis un
 * lien, jamais cliqué) a une horloge qui n'avance pas, la note n'y finit jamais
 * et `onended` ne vient pas. D'où le minuteur de secours, qui le referme dans
 * tous les cas. On ne juge **pas** sur `context.state` à la construction : la
 * spécification y laisse tout contexte neuf à `"suspended"` jusqu'au démarrage
 * effectif du rendu, si bien que refermer ce qui n'est pas encore `"running"`
 * couperait le signal là où il allait sonner.
 */
export function playAlertChime(alert: ViewerAlert) {
  const frequency = ALERT_FREQUENCY[alert];
  if (frequency === undefined) return;
  try {
    const context = new AudioContext();
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      void context.close().catch(() => undefined);
    };
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "triangle";
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = close;
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.stop(context.currentTime + 0.22);
    setTimeout(close, CHIME_CLOSE_FALLBACK_MS);
  } catch {
    // ignore audio failures
  }
}
