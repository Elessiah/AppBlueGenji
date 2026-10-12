import enStats from "@/messages/en/stats.json";
import enLabels from "@/messages/en/labels.json";
import type { StatsPanelMessages } from "@/lib/shared/stats-text";

/**
 * L'anglais du bloc de statistiques en **un** morceau (`englishStatsPanel`,
 * revue de performance du lot 9-2) : `stats` et les deux tables de `labels`
 * qu'il lit, une requête au lieu de deux. Jamais importé d'office.
 */
export const STATS_PANEL_EN: StatsPanelMessages = {
  stats: enStats,
  labels: { formatShort: enLabels.formatShort, game: enLabels.game },
};
