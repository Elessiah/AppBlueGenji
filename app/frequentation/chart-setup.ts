/**
 * Chart.js, réduit à ce que la page des statistiques dessine (D77) : courbes et
 * barres, deux axes cartésiens, l'info-bulle. Importé **à la demande** par
 * `AudienceChart` : aucune autre page n'en charge un octet, et cette page-ci
 * ne le charge qu'après son premier affichage.
 *
 * Chart.js est publié sous licence MIT, compatible AGPL.
 */
import {
  BarController,
  BarElement,
  CategoryScale,
  Chart,
  LineController,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";

Chart.register(BarController, BarElement, CategoryScale, LineController, LineElement, LinearScale, PointElement, Tooltip);

export { Chart };
