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

function unit(value: number, singular: string, plural: string): string {
  return `${value} ${value > 1 ? plural : singular}`;
}

/** Phrase lisible par un lecteur d'écran, résumée aux deux plus grandes unités non nulles. */
export function countdownAccessibleLabel(parts: CountdownParts): string {
  const { d, h, m, s } = parts;

  if (d > 0) return `Début dans ${unit(d, "jour", "jours")} ${unit(h, "heure", "heures")}`;
  if (h > 0) return `Début dans ${unit(h, "heure", "heures")} ${unit(m, "minute", "minutes")}`;
  if (m > 0) return `Début dans ${unit(m, "minute", "minutes")} ${unit(s, "seconde", "secondes")}`;
  return `Début dans ${unit(s, "seconde", "secondes")}`;
}
