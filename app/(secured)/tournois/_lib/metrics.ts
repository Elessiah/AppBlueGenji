export type TournamentsPageMetric = {
  value: number;
  label: string;
  highlighted?: boolean;
};

/**
 * Bandeau de chiffres de `/tournois`. Chaque case dit ce qu'elle compte
 * réellement : le premier chiffre comptait les tournois `RUNNING` sous
 * l'étiquette « Diffusés sur Twitch » (aucune chaîne n'est vérifiée, et
 * Twitch n'est qu'une des trois plateformes acceptées), et la dernière case
 * affichait « Prizepool · à venir » à tout non-staff — un emplacement réservé
 * pour une fonctionnalité qui n'existe pas. La case « Invisibles · staff »
 * n'apparaît donc que pour le staff, au lieu d'un repli inventé.
 */
export function tournamentsPageMetrics(
  counts: { running: number; registration: number; upcoming: number; hidden: number },
  isAdmin: boolean,
): TournamentsPageMetric[] {
  const metrics: TournamentsPageMetric[] = [
    { value: counts.running, label: "Tournois en cours", highlighted: true },
    { value: counts.registration, label: "Inscriptions ouvertes" },
    { value: counts.upcoming, label: "Programmés à venir" },
  ];
  if (isAdmin) {
    metrics.push({ value: counts.hidden, label: "Invisibles · staff" });
  }
  return metrics;
}
