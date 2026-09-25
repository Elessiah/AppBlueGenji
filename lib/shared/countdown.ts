/**
 * Extrait de `CountdownStrip` pour rester testable sans horloge ni DOM : le
 * composant ne fait plus que choisir entre l'affichage réel et le repli
 * « chargement » selon que `useClock` a déjà résolu l'heure du lecteur.
 */
import { plural } from "./plural";

export interface CountdownParts {
  d: number;
  h: number;
  m: number;
  s: number;
}

/** Décompose l'écart entre `targetISO` et `now` en jours/heures/minutes/secondes, jamais négatif. */
export function computeCountdown(targetISO: string, now: number): CountdownParts {
  const target = new Date(targetISO).getTime();
  let delta = Math.max(0, target - now);

  const d = Math.floor(delta / 86400000);
  delta -= d * 86400000;
  const h = Math.floor(delta / 3600000);
  delta -= h * 3600000;
  const m = Math.floor(delta / 60000);
  delta -= m * 60000;
  const s = Math.floor(delta / 1000);

  return { d, h, m, s };
}

/**
 * Phrase lisible par un lecteur d'écran, résumée aux deux plus grandes
 * unités non nulles. Une échéance atteinte (ou déjà dépassée, `computeCountdown`
 * plafonnant l'écart à zéro) ne dit jamais « dans 0 seconde » — une fois
 * l'échéance passée, ce serait faux à chaque relecture tant que la page reste ouverte.
 */
export function countdownAccessibleLabel(parts: CountdownParts): string {
  const { d, h, m, s } = parts;

  if (d === 0 && h === 0 && m === 0 && s === 0) return "Début imminent";
  if (d > 0) return `Début dans ${plural(d, "jour")} ${plural(h, "heure")}`;
  if (h > 0) return `Début dans ${plural(h, "heure")} ${plural(m, "minute")}`;
  if (m > 0) return `Début dans ${plural(m, "minute")} ${plural(s, "seconde")}`;
  return `Début dans ${plural(s, "seconde")}`;
}
