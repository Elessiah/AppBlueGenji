"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { powerReasons, resolvePowerMode, showsPowerBadge } from "@/lib/shared/client-power";
import {
  powerLimitsList,
  powerModeDescription,
  powerModeLabel,
  powerProbeSummary,
  powerReasonLabel,
} from "@/lib/shared/client-power-text";
import { setIgnorePerformance, useClientPowerState } from "@/lib/shared/hooks/useClientPower";
import { useShellText } from "@/components/i18n/shell-text";
import styles from "./client-power-badge.module.css";

/**
 * Témoin du régime de charge, en bas à droite.
 *
 * Il n'apparaît que lorsque la page **retire** quelque chose (`ECO`, `MATCH`)
 * pour une raison qui tient page regardée (`showsPowerBadge`) : en veille
 * personne ne le voit. Son rôle est de rendre le mode éco **visible** — un
 * joueur qui trouve la page « figée » doit pouvoir lire pourquoi, et nous le
 * dire —, d'où la liste des raisons, avec la cadence mesurée, derrière un clic.
 *
 * Il porte aussi le seul recours contre une détection qui se trompe : ignorer
 * la détection de performances. Il reste donc affiché tant que ce choix tient,
 * régime complet compris — c'est lui qui permet de le défaire. Le focus,
 * l'onglet caché et le match, eux, ne s'ignorent pas : ce sont des faits, pas
 * des estimations.
 */
export function ClientPowerBadge() {
  const { input, probe, limits, ignorePerformance } = useClientPowerState();
  // Monté par la mise en page racine, sous `ShellTextProvider` : la langue de la page.
  const { t } = useShellText();
  const mode = resolvePowerMode(input);
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  // Formatés une fois par régime et langue, pas à chaque rendu du témoin
  // (monté sur toutes les pages) ; le détail, lui, ne se compose que ouvert.
  const label = useMemo(() => powerModeLabel(mode, t), [mode, t]);
  const description = useMemo(() => powerModeDescription(mode, t), [mode, t]);

  const reasons = powerReasons(input, limits);
  const ignoredLimits = ignorePerformance && limits.length > 0;
  const visible = showsPowerBadge(mode, reasons, ignoredLimits);

  // Le témoin qui disparaît referme son détail : sans quoi il réapparaîtrait
  // ouvert, de lui-même, au prochain match.
  useEffect(() => {
    if (!visible) setOpen(false);
  }, [visible]);

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

  if (!visible) return null;

  return (
    <div ref={rootRef} className={styles.root} data-mode={mode.toLowerCase()}>
      {open && (
        <section id={panelId} className={styles.panel} aria-label={t("clientPower.panelLabel")}>
          <p className={styles.title}>{label}</p>
          <p className={styles.text}>{description}</p>
          {reasons.length > 0 && (
            <ul className={styles.reasons}>
              {reasons.map((reason) => (
                <li key={reason}>{powerReasonLabel(reason, probe, t)}</li>
              ))}
            </ul>
          )}
          {ignoredLimits && (
            <p className={styles.text}>
              {t("clientPower.ignored", { limits: powerLimitsList(limits, probe, t) })}
            </p>
          )}
          {(limits.length > 0 || ignorePerformance) && (
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={ignorePerformance}
                onChange={(event) => setIgnorePerformance(event.target.checked)}
              />
              {/* NOSONAR S6772 — label en flex avec `gap` */}
              {t("clientPower.ignoreToggle")}
            </label>
          )}
          <p className={styles.mono}>{powerProbeSummary(probe, t)}</p>
        </section>
      )}
      <button
        type="button"
        className={styles.pill}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        title={description}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.dot} aria-hidden />
        {label}
      </button>
    </div>
  );
}
