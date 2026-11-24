"use client";

import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import type { FieldAria } from "@/lib/shared/field-errors";
import { CHECKBOX_CARD_LAYOUT, CHECKBOX_CARD_TITLE, checkboxCardChrome, HINT } from "../_lib/form-styles";
import { useFormText } from "../_lib/form-text";

export const RANDOM_SEEDING_FIELD_ID = "random-seeding";
export const RANDOM_SEEDING_HINT_ID = "random-seeding-hint";
/** Le fonctionnement de l'option, derrière le « i » — cité aussi par la case. */
export const RANDOM_SEEDING_MORE_ID = "random-seeding-more";

/**
 * Case « Tirage au sort de l'ordre de départ » du formulaire de tournoi
 * (`docs/features/RANDOM_SEEDING.md`). Décochée par défaut.
 *
 * Un champ de la fenêtre d'édition comme la phase de lancement
 * (`randomSeeding` dans `RESTRICTED_FIELDS`) : modifiable jusqu'au départ,
 * figé ensuite. Même carte : case, titre, bouton « i » du fonctionnement, et
 * une ligne qui dit jusqu'à quand l'option se modifie.
 */
export function RandomSeedingField({
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
          id={RANDOM_SEEDING_FIELD_ID}
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onChange(e.target.checked)}
          aria-labelledby="random-seeding-label"
          {...aria}
          className="checkbox-card-input"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <InfoHintRow>
            <label
              id="random-seeding-label"
              htmlFor={RANDOM_SEEDING_FIELD_ID}
              style={{ ...CHECKBOX_CARD_TITLE, cursor: locked ? "default" : "pointer" }}
            >
              {t("form.randomSeeding.label")}
            </label>
            <InfoHint id={RANDOM_SEEDING_MORE_ID} subject={t("form.randomSeeding.label")}>
              <p>{t("form.randomSeeding.description")}</p>
            </InfoHint>
          </InfoHintRow>
          <p id={RANDOM_SEEDING_HINT_ID} style={{ ...HINT, margin: "4px 0 0" }}>
            {locked ? t("form.randomSeeding.locked") : t("form.randomSeeding.scope")}
          </p>
        </div>
      </div>
      <FieldErrorText fieldId={RANDOM_SEEDING_FIELD_ID} message={error} />
    </>
  );
}
