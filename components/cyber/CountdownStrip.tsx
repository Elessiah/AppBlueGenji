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

  const parts = now === null ? null : computeCountdown(targetISO, now);

  const units = parts
    ? [
        { label: "J", value: pad(parts.d) },
        { label: "H", value: pad(parts.h) },
        { label: "M", value: pad(parts.m) },
        { label: "S", value: pad(parts.s) },
      ]
    : PLACEHOLDER_UNITS;

  const accessibleLabel = parts ? countdownAccessibleLabel(parts) : "Chargement du compte à rebours";

  return (
    <div className={styles.root}>
      {label && <div className={styles.label}>{label}</div>}
      {/* `aria-label` porte la phrase lisible ; les cases numériques ne sont
          qu'un rendu visuel du même fait, répété une seconde fois pour qui l'entend. */}
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
