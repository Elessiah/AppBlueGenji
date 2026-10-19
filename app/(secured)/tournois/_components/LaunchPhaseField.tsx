"use client";

import { FieldErrorText } from "@/components/ui/field-error-text";
import { LAUNCH_AUTO_DELAY_MINUTES } from "@/lib/shared/match-launch";
import type { FieldAria } from "@/lib/shared/field-errors";
import { checkboxCardChrome, HINT } from "../_lib/form-styles";
import { useFormText } from "../_lib/form-text";

export const LAUNCH_PHASE_FIELD_ID = "launch-phase";
export const LAUNCH_PHASE_HINT_ID = "launch-phase-hint";

/**
 * Case « Phase de lancement des matchs » du formulaire de tournoi
 * (`docs/features/MATCH_LAUNCH.md` § Option du tournoi). Décochée par défaut.
 *
 * Un champ de la fenêtre d'édition comme les autres (`launchPhase` dans
 * `RESTRICTED_FIELDS`) : modifiable jusqu'au départ, figé ensuite.
 *
 * La carte entière est le libellé natif de la case, comme pour la
 * planification par l'arbitrage (`RefereeSchedulingField`).
 */
export function LaunchPhaseField({
  checked,
  locked,
  aria,
  error,
  onChange,
}: Readonly<{
  checked: boolean;
  locked: boolean;
  /** `aria-describedby` / `aria-invalid` composés par `useFieldErrors`. */
  aria: FieldAria;
  error: string | null;
  onChange: (checked: boolean) => void;
}>) {
  const { t } = useFormText();
  return (
    <>
      <label
        className="checkbox-card"
        htmlFor={LAUNCH_PHASE_FIELD_ID}
        style={{
          display: "flex",
          alignItems: "flex-start",
          gap: 12,
          marginTop: 16,
          padding: "14px 16px",
          ...checkboxCardChrome(checked, locked),
          borderRadius: 10,
          cursor: locked ? "default" : "pointer",
          transition: "border-color 0.2s ease, background-color 0.2s ease",
        }}
      >
        <input
          id={LAUNCH_PHASE_FIELD_ID}
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked)}
          aria-labelledby="launch-phase-label"
          {...aria}
          style={{ marginTop: 2 }}
        />
        <span style={{ flex: 1 }}>
          <span
            id="launch-phase-label"
            style={{ display: "block", margin: "0 0 4px", fontSize: 14, fontWeight: 500, color: "var(--ink)" }}
          >
            {t("form.launchPhase.label")}
          </span>
          <span id={LAUNCH_PHASE_HINT_ID} style={{ ...HINT, display: "block", margin: 0 }}>
            {t("form.launchPhase.description", { launchDelay: LAUNCH_AUTO_DELAY_MINUTES })}{" "}
            {locked ? t("form.launchPhase.locked") : t("form.launchPhase.scope")}
          </span>
        </span>
      </label>
      <FieldErrorText fieldId={LAUNCH_PHASE_FIELD_ID} message={error} />
    </>
  );
}
