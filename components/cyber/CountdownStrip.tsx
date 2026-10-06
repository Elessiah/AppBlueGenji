"use client";

import { useClock } from "@/lib/shared/hooks/useClock";
import { computeCountdown, type CountdownParts } from "@/lib/shared/countdown";
import type { LandingText } from "@/lib/shared/landing-text";
import { useLandingText } from "@/components/i18n/landing-text";
import styles from "./CountdownStrip.module.css";

interface CountdownStripProps {
  targetISO: string;
  label?: string;
}

const UNITS = ["d", "h", "m", "s"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Phrase lue par un lecteur d'écran, résumée aux deux plus grandes unités non
 * nulles — même règle que `countdownAccessibleLabel` (`lib/shared/countdown.ts`),
 * dans la langue de la page.
 */
export function countdownText({ t }: LandingText, parts: CountdownParts): string {
  const { d, h, m, s } = parts;
  if (d === 0 && h === 0 && m === 0 && s === 0) return t("countdown.imminent");
  if (d > 0) return t("countdown.daysHours", { d, h });
  if (h > 0) return t("countdown.hoursMinutes", { h, m });
  if (m > 0) return t("countdown.minutesSeconds", { m, s });
  return t("countdown.seconds", { s });
}

export function CountdownStrip({ targetISO, label }: Readonly<CountdownStripProps>) {
  const text = useLandingText();
  // Horloge soumise au régime de charge : arrêtée onglet caché, recalée au retour.
  const now = useClock(1000);

  const parts = now === null ? null : computeCountdown(targetISO, now);

  const units = UNITS.map((unit) => ({
    label: text.t(`countdown.unit.${unit}`),
    value: parts ? pad(parts[unit]) : "--",
  }));

  const accessibleLabel = parts ? countdownText(text, parts) : text.t("countdown.pending");

  return (
    <div className={styles.root}>
      {label && <div className={styles.label}>{label}</div>}
      {/* Le rôle ARIA `time` interdit le nom par `aria-label` (« Name
          Prohibited ») : la phrase doit être un vrai contenu, retiré du flux
          visuel par `.sr-only`, pas une étiquette posée par-dessus un élément
          vide. Les cases numériques sont un bloc voisin, purement visuel —
          `<time>` (contenu de phrase) ne peut de toute façon pas contenir de `<div>`. */}
      <time dateTime={targetISO}>
        <span className="sr-only">{accessibleLabel}</span>
      </time>
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
