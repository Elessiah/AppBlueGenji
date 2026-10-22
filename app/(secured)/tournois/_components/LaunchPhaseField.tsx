"use client";

import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { LAUNCH_AUTO_DELAY_MINUTES } from "@/lib/shared/match-launch";
import type { FieldAria } from "@/lib/shared/field-errors";
import { CHECKBOX_CARD_LAYOUT, CHECKBOX_CARD_TITLE, checkboxCardChrome, HINT } from "../_lib/form-styles";
import { useFormText } from "../_lib/form-text";

export const LAUNCH_PHASE_FIELD_ID = "launch-phase";
export const LAUNCH_PHASE_HINT_ID = "launch-phase-hint";
/** Le fonctionnement de l'option, derrière le « i » — cité aussi par la case. */
export const LAUNCH_PHASE_MORE_ID = "launch-phase-more";

/**
 * Case « Phase de lancement des matchs » du formulaire de tournoi
 * (`docs/features/MATCH_LAUNCH.md` § Option du tournoi). Décochée par défaut.
 *
 * Un champ de la fenêtre d'édition comme les autres (`launchPhase` dans
 * `RESTRICTED_FIELDS`) : modifiable jusqu'au départ, figé ensuite.
 *
 * La carte porte la case, son titre (libellé natif) et le bouton « i » du
 * fonctionnement (`docs/features/INFO_HINTS.md`) — un bouton ne se pose pas
 * dans un `<label>` : la carte n'est donc plus le libellé tout entier. La
 * ligne visible dit seulement jusqu'à quand l'option se modifie.
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
      <div className="checkbox-card" style={{ ...CHECKBOX_CARD_LAYOUT, ...checkboxCardChrome(checked, locked) }}>
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
        <div style={{ flex: 1, minWidth: 0 }}>
          <InfoHintRow>
            <label
              id="launch-phase-label"
              htmlFor={LAUNCH_PHASE_FIELD_ID}
              style={{ ...CHECKBOX_CARD_TITLE, cursor: locked ? "default" : "pointer" }}
            >
              {t("form.launchPhase.label")}
            </label>
            <InfoHint id={LAUNCH_PHASE_MORE_ID} subject={t("form.launchPhase.label")}>
              <p>{t("form.launchPhase.description", { launchDelay: LAUNCH_AUTO_DELAY_MINUTES })}</p>
            </InfoHint>
          </InfoHintRow>
          <p id={LAUNCH_PHASE_HINT_ID} style={{ ...HINT, margin: "4px 0 0" }}>
            {locked ? t("form.launchPhase.locked") : t("form.launchPhase.scope")}
          </p>
        </div>
      </div>
      <FieldErrorText fieldId={LAUNCH_PHASE_FIELD_ID} message={error} />
    </>
  );
}
