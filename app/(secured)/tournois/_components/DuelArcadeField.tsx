"use client";

import { FieldErrorText } from "@/components/ui/field-error-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { NumberInput } from "@/components/ui/number-input";
import { MAP_POINT_TARGET_MAX, MAP_POINT_TARGET_MIN } from "@/lib/shared/map-points";
import type { FieldAria } from "@/lib/shared/field-errors";
import { CHECKBOX_CARD_LAYOUT, CHECKBOX_CARD_TITLE, checkboxCardChrome, FULL_WIDTH, HINT } from "../_lib/form-styles";
import { useFormText } from "../_lib/form-text";

export const DUEL_ARCADE_FIELD_ID = "duel-arcade";
/** Champ des points par carte : celui que désigne un refus (`mapPointTarget`). */
export const MAP_POINT_TARGET_FIELD_ID = "map-point-target";
export const MAP_POINT_TARGET_HINT_ID = "map-point-target-hint";
/** Le fonctionnement du format, derrière le « i » — cité aussi par la case. */
export const DUEL_ARCADE_MORE_ID = "duel-arcade-more";

/**
 * Case « Format Duel / Arcade » et « Premier à N points par carte » du
 * formulaire de tournoi (`docs/features/DUEL_ARCADE.md`). Décochée par défaut ;
 * cochée, elle ouvre le nombre de points (5 proposé). Le format de match (BO /
 * FT) compte toujours des cartes.
 *
 * Champ de la fenêtre d'édition (`mapPointTarget` dans `RESTRICTED_FIELDS`) :
 * modifiable jusqu'au départ, inscrites comprises ; figé ensuite. Un tour
 * peut avoir ses propres points (fenêtre des cartes par manche).
 */
export function DuelArcadeField({
  checked,
  target,
  locked,
  aria,
  error,
  onCheckedChange,
  onTargetChange,
  onTargetEdit,
}: Readonly<{
  checked: boolean;
  target: number;
  locked: boolean;
  /**
   * `aria-describedby` / `aria-invalid` du champ des points (`useFieldErrors`) ;
   * décochée, ceux de la case, qui porte alors le refus.
   */
  aria: FieldAria;
  error: string | null;
  onCheckedChange: (checked: boolean) => void;
  onTargetChange: (target: number) => void;
  onTargetEdit: () => void;
}>) {
  const { t } = useFormText();
  // Décochée, le champ des points n'existe pas : un refus des points
  // (`MAP_POINTS_LOCKED` en décochant sous un score) se rattache à la case.
  const errorFieldId = checked ? MAP_POINT_TARGET_FIELD_ID : DUEL_ARCADE_FIELD_ID;
  const checkboxDescribedBy = checked
    ? DUEL_ARCADE_MORE_ID
    : [aria["aria-describedby"], DUEL_ARCADE_MORE_ID].filter(Boolean).join(" ");
  return (
    <div style={FULL_WIDTH}>
      <div className="checkbox-card" style={{ ...CHECKBOX_CARD_LAYOUT, ...checkboxCardChrome(checked, locked) }}>
        <input
          id={DUEL_ARCADE_FIELD_ID}
          type="checkbox"
          checked={checked}
          disabled={locked}
          onChange={(e) => onCheckedChange(e.target.checked)}
          aria-labelledby="duel-arcade-label"
          aria-describedby={checkboxDescribedBy}
          aria-invalid={checked ? undefined : aria["aria-invalid"]}
          className="checkbox-card-input"
        />
        <div style={{ flex: 1, minWidth: 0 }}>
          <InfoHintRow>
            <label
              id="duel-arcade-label"
              htmlFor={DUEL_ARCADE_FIELD_ID}
              style={{ ...CHECKBOX_CARD_TITLE, cursor: locked ? "default" : "pointer" }}
            >
              {t("form.duelArcade.label")}
            </label>
            <InfoHint id={DUEL_ARCADE_MORE_ID} subject={t("form.duelArcade.label")}>
              <p>{t("form.duelArcade.description")}</p>
            </InfoHint>
          </InfoHintRow>
          {checked && (
            <div className="field" style={{ marginTop: 10, maxWidth: 260 }}>
              <label htmlFor={MAP_POINT_TARGET_FIELD_ID}>{t("form.duelArcade.target")}</label>
              <NumberInput
                id={MAP_POINT_TARGET_FIELD_ID}
                min={MAP_POINT_TARGET_MIN}
                max={MAP_POINT_TARGET_MAX}
                disabled={locked}
                value={target}
                onValueChange={onTargetChange}
                onEdit={onTargetEdit}
                {...aria}
              />
            </div>
          )}
          <FieldErrorText fieldId={errorFieldId} message={error} />
          <p id={MAP_POINT_TARGET_HINT_ID} style={{ ...HINT, margin: "4px 0 0" }}>
            {locked ? t("form.duelArcade.locked") : t("form.duelArcade.scope")}
          </p>
        </div>
      </div>
    </div>
  );
}
