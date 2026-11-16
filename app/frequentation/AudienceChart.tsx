"use client";

import { useEffect, useRef, useState } from "react";
import type { Chart as ChartInstance, ChartConfiguration } from "chart.js";
import { useOptionalToast } from "@/components/ui/toast";
import { fillTemplate } from "@/lib/shared/audience";
import styles from "./frequentation.module.css";

export interface AudienceChartSeries {
  label: string;
  data: number[];
  /** Jeton CSS de la teinte (`--st-series-1`), lu sur la page : aucune couleur écrite ici. */
  tone: string;
}

export interface AudienceChartProps {
  type: "line" | "bar";
  labels: string[];
  /** Libellés longs, pour l'info-bulle (« Semaine du 3 novembre »). Par défaut, {@link labels}. */
  tooltipLabels?: string[];
  series: AudienceChartSeries[];
  /** Titre du graphique, en tête de son nom accessible ; le détail est dans le tableau voisin. */
  ariaLabel: string;
  loadingLabel: string;
  /** Message de repli si Chart.js ne se charge pas (le tableau de données reste lisible). */
  failedLabel: string;
  /** Résumé d'une série pour les lecteurs d'écran : `{series}`, `{total}`, `{min}`, `{max}`, `{count}`. */
  summaryTemplate: string;
  /** Renvoi au tableau de données, ajouté à la fin du nom accessible. */
  seeTableLabel: string;
  /** Ligne d'info-bulle, `{label}` et `{value}` (« {label} : {value} »). */
  tooltipTemplate: string;
  formatValue: (value: number) => string;
  /** Hauteur du tracé en px. */
  height?: number;
}

/**
 * Nom accessible d'un graphique : son titre, puis pour chaque série le total,
 * le minimum, le maximum et le nombre de points, puis le renvoi au tableau.
 * Un graphique tracé sur canevas n'a pas d'autre texte à lire.
 */
export function chartAriaLabel(
  title: string,
  series: readonly AudienceChartSeries[],
  summaryTemplate: string,
  seeTableLabel: string,
  formatValue: (value: number) => string,
): string {
  const summaries = series.map((serie) => {
    const data = serie.data;
    return fillTemplate(summaryTemplate, {
      series: serie.label,
      total: formatValue(data.reduce((sum, value) => sum + value, 0)),
      min: formatValue(data.length > 0 ? Math.min(...data) : 0),
      max: formatValue(data.length > 0 ? Math.max(...data) : 0),
      count: data.length,
    });
  });
  return [title, ...summaries, seeTableLabel].join(" ");
}

function token(element: Element, name: string): string {
  return getComputedStyle(element).getPropertyValue(name).trim();
}

/**
 * Un graphique Chart.js, chargé après l'affichage de la page.
 *
 * Règles de lecture (compétence dataviz) : un seul axe, traits de 2 px, barres
 * fines aux bouts arrondis, grille discrète, info-bulle au survol ; les
 * couleurs viennent des jetons de la page, jamais du code. Aucune animation :
 * rien ne tourne une fois le graphique dessiné.
 */
export function AudienceChart({
  type,
  labels,
  tooltipLabels,
  series,
  ariaLabel,
  loadingLabel,
  failedLabel,
  summaryTemplate,
  seeTableLabel,
  tooltipTemplate,
  formatValue,
  height = 240,
}: AudienceChartProps) {
  const toast = useOptionalToast();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<ChartInstance | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    import("./chart-setup")
      .then(({ Chart }) => {
        if (cancelled) return;
        const ink = token(canvas, "--st-ink-2");
        const grid = token(canvas, "--st-grid");
        const surface = token(canvas, "--st-surface");
        const font = { family: token(canvas, "--st-font") || undefined, size: 12 };
        const config: ChartConfiguration<"line" | "bar", number[], string> = {
          type,
          data: {
            labels,
            datasets: series.map((serie) => {
              const tone = token(canvas, serie.tone);
              return type === "line"
                ? {
                    label: serie.label,
                    data: serie.data,
                    borderColor: tone,
                    backgroundColor: tone,
                    borderWidth: 2,
                    pointRadius: 0,
                    pointHoverRadius: 4,
                    pointHoverBorderWidth: 2,
                    pointHoverBorderColor: surface,
                    pointHitRadius: 12,
                    tension: 0.25,
                  }
                : {
                    label: serie.label,
                    data: serie.data,
                    backgroundColor: tone,
                    hoverBackgroundColor: tone,
                    borderRadius: { topLeft: 4, topRight: 4 },
                    borderSkipped: "start" as const,
                    maxBarThickness: 24,
                    categoryPercentage: 0.8,
                    barPercentage: 0.9,
                  };
            }),
          },
          options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: "index", intersect: false },
            plugins: {
              legend: { display: false },
              tooltip: {
                backgroundColor: token(canvas, "--st-ink"),
                titleColor: surface,
                bodyColor: surface,
                titleFont: { ...font, weight: 600 },
                bodyFont: font,
                padding: 10,
                cornerRadius: 6,
                boxPadding: 4,
                usePointStyle: true,
                callbacks: {
                  title: (items) => {
                    const index = items[0]?.dataIndex ?? 0;
                    return (tooltipLabels ?? labels)[index] ?? "";
                  },
                  label: (item) => ` ${fillTemplate(tooltipTemplate, { label: item.dataset.label ?? "", value: formatValue(Number(item.raw)) })}`,
                },
              },
            },
            scales: {
              x: {
                grid: { display: false },
                border: { color: grid },
                ticks: { color: ink, font, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 },
              },
              y: {
                beginAtZero: true,
                grid: { color: grid },
                border: { display: false },
                ticks: { color: ink, font, precision: 0, maxTicksLimit: 5, callback: (value) => formatValue(Number(value)) },
              },
            },
          },
        };
        chartRef.current?.destroy();
        chartRef.current = new Chart(canvas, config);
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setFailed(true);
        toast?.showError(failedLabel, { once: true });
      });
    return () => {
      cancelled = true;
      chartRef.current?.destroy();
      chartRef.current = null;
    };
  }, [type, labels, tooltipLabels, series, formatValue, tooltipTemplate, failedLabel, toast]);

  return (
    <div className={styles.chartBox} style={{ height }}>
      <canvas ref={canvasRef} role="img" aria-label={chartAriaLabel(ariaLabel, series, summaryTemplate, seeTableLabel, formatValue)} />
      {failed && (
        <p className={styles.chartFailed}>
          {failedLabel}
        </p>
      )}
      {!ready && !failed && (
        <p className={styles.chartLoading} aria-hidden="true">
          {loadingLabel}
        </p>
      )}
    </div>
  );
}
