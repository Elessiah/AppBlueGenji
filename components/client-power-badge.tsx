"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  powerModeDescription,
  powerModeLabel,
  powerReasonLabel,
  powerReasons,
  resolvePowerMode,
  showsPowerBadge,
} from "@/lib/shared/client-power";
import { setIgnorePerformance, useClientPowerState } from "@/lib/shared/hooks/useClientPower";
import styles from "./client-power-badge.module.css";

/**
 * Témoin du régime de charge, en bas à droite.
 *
 * Il n'apparaît que lorsque la page **retire** quelque chose (`ECO`, `MATCH`)
 * pour une raison qui tient page regardée (`showsPowerBadge`) : en régime
 * complet il n'a rien à dire, et en veille personne ne le voit. Son
 * rôle est de rendre le mode éco **visible** — un joueur qui trouve la page
 * « figée » doit pouvoir lire pourquoi, et nous le dire —, d'où la liste des
 * raisons, avec la cadence mesurée, derrière un clic.
 *
 * Il porte aussi le seul recours contre une détection qui se trompe : ignorer
 * la détection de performances. Le focus, l'onglet caché et le match, eux, ne
 * s'ignorent pas — ce sont des faits, pas des estimations.
 */
export function ClientPowerBadge() {
  const { input, probe, limits, ignorePerformance } = useClientPowerState();
  const mode = resolvePowerMode(input);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Échap et clic à côté referment le détail.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open]);

  const reasons = powerReasons(input, limits);
  if (!showsPowerBadge(mode, reasons)) return null;

  const label = `Mode ${powerModeLabel(mode).toLowerCase()}`;

  return (
    <div ref={rootRef} className={styles.root} data-mode={mode.toLowerCase()}>
      {open && (
        <div id={panelId} className={styles.panel} role="region" aria-label="Mode d'affichage">
          <p className={styles.title}>{label}</p>
          <p className={styles.text}>{powerModeDescription(mode)}</p>
          {reasons.length > 0 && (
            <ul className={styles.reasons}>
              {reasons.map((reason) => (
                <li key={reason}>{powerReasonLabel(reason, probe)}</li>
              ))}
            </ul>
          )}
          {(limits.length > 0 || ignorePerformance) && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={ignorePerformance}
                onChange={(event) => setIgnorePerformance(event.target.checked)}
              />
              Ignorer la détection de performances
            </label>
          )}
          <p className={styles.mono}>
            {[
              probe.frameIntervalMs ? `${Math.round(1000 / probe.frameIntervalMs)} i/s` : "i/s non mesuré",
              probe.cores ? `${probe.cores} cœurs` : null,
              probe.memoryGb ? `${probe.memoryGb} Go` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      )}
      <button
        type="button"
        className={styles.pill}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={powerModeDescription(mode)}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.dot} aria-hidden />
        {label}
      </button>
    </div>
  );
}
