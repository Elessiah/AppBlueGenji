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
      {/* `<time>` ne porte que la date machine-lisible et la phrase pour les
          lecteurs d'écran ; son contenu (phrasing content) ne peut pas être
          des `<div>` — les cases numériques sont donc un bloc voisin, purement
          visuel, que `aria-hidden` retire de l'arbre d'accessibilité. */}
      <time dateTime={targetISO} aria-label={accessibleLabel} />
      <div className={styles.countdown} aria-hidden="true">
        {units.map(({ label: lbl, value }) => (
          <div key={lbl} className={styles.unit}>
            <div className={parts ? `num ${styles.val}` : `num ${styles.val} ${styles.valPending}`}>
              {value}
            </div>
            <div className={`mono ${styles.lbl}`}>{lbl}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
