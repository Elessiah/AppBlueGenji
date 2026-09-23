import type { ViewerAlert } from "@/lib/shared/viewer-alerts";

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
 * il en était ouvert un nouveau à chaque signal, jamais rendu — de la mémoire et
 * un fil audio de plus à chaque score confirmé, sur un poste qui fait tourner un
 * jeu à côté (et Chrome cesse d'en créer passé une limite).
 */
export function playAlertChime(alert: ViewerAlert) {
  const frequency = ALERT_FREQUENCY[alert];
  if (frequency === undefined) return;
  try {
    const context = new AudioContext();
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = frequency;
    oscillator.type = "triangle";
    gain.gain.value = 0.0001;
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.onended = () => {
      void context.close().catch(() => undefined);
    };
    oscillator.start();
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.2);
    oscillator.stop(context.currentTime + 0.22);
  } catch {
    // ignore audio failures
  }
}
