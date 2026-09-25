"use client";

import { useClock } from "@/lib/shared/hooks/useClock";
import { computeCountdown, countdownAccessibleLabel } from "@/lib/shared/countdown";
import styles from "./CountdownStrip.module.css";

interface CountdownStripProps {
  targetISO: string;
  label?: string;
}

const PLACEHOLDER_UNITS = [
  { label: "J", value: "--" },
  { label: "H", value: "--" },
  { label: "M", value: "--" },
  { label: "S", value: "--" },
];

const pad = (n: number) => String(n).padStart(2, "0");

export function CountdownStrip({ targetISO, label }: CountdownStripProps) {
  // Horloge soumise au régime de charge : arrêtée onglet caché, recalée au retour.
  const now = useClock(1000);

  const units =
    now === null
      ? PLACEHOLDER_UNITS
      : (() => {
          const { d, h, m, s } = computeCountdown(targetISO, now);
          return [
            { label: "J", value: pad(d) },
            { label: "H", value: pad(h) },
            { label: "M", value: pad(m) },
            { label: "S", value: pad(s) },
          ];
        })();

  const accessibleLabel =
    now === null ? "Chargement du compte à rebours" : countdownAccessibleLabel(computeCountdown(targetISO, now));

  return (
    <div className={styles.root}>
      {label && <div className={styles.label}>{label}</div>}
      <time dateTime={targetISO} aria-label={accessibleLabel} className={styles.countdown}>
        {units.map(({ label: lbl, value }) => (
          <div key={lbl} className={styles.unit} aria-hidden="true">
            <div className={`num ${styles.val}`}>{value}</div>
            <div className={`mono ${styles.lbl}`}>{lbl}</div>
          </div>
        ))}
      </time>
    </div>
  );
}
