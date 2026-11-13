"use client";

import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { CHECKBOX_CARD_LAYOUT, CHECKBOX_CARD_TITLE, checkboxCardChrome, HINT } from "../_lib/form-styles";
import { useFormText } from "../_lib/form-text";

/** Précision sous le titre, selon l'écran. */
function scopeHint(text: TournamentFormText, mode: "create" | "edit", editable: boolean): string {
  if (!editable) return text.t("form.matchCheckIn.finished");
  return text.t(mode === "create" ? "form.matchCheckIn.create" : "form.matchCheckIn.edit");
}

/**
 * Case « Check-in des matchs » du formulaire de tournoi
 * (`docs/features/MATCH_CHECK_IN_SETTING.md`). **Cochée** par défaut : le
 * comportement d'avant l'option.
 *
 * Comme les salons vocaux d'équipe, elle **survit à la fenêtre d'édition** :
 * modifiable jusqu'à la clôture, tournoi en cours compris — la page d'édition
 * l'enregistre par sa route dédiée (`PUT /api/admin/tournaments/[id]/match-check-in`).
 */
export function MatchCheckInField({
  mode,
  checked,
  editable,
  onChange,
}: Readonly<{
  mode: "create" | "edit";
  checked: boolean;
  /** Faux sur un tournoi terminé : la case est montrée, verrouillée. */
  editable: boolean;
  onChange: (checked: boolean) => void;
}>) {
  const text = useFormText();
  const { t } = text;
  return (
    <div className="checkbox-card" style={{ ...CHECKBOX_CARD_LAYOUT, ...checkboxCardChrome(checked, !editable) }}>
      <input
        id="match-check-in"
        type="checkbox"
        checked={checked}
        disabled={!editable}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby="match-check-in-label"
        aria-describedby="match-check-in-more match-check-in-hint"
        className="checkbox-card-input"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <InfoHintRow>
          <label
            id="match-check-in-label"
            htmlFor="match-check-in"
            style={{ ...CHECKBOX_CARD_TITLE, cursor: editable ? "pointer" : "default" }}
          >
            {t("form.matchCheckIn.label")}
          </label>
          <InfoHint id="match-check-in-more" subject={t("form.matchCheckIn.label")}>
            <p>{t("form.matchCheckIn.description")}</p>
          </InfoHint>
        </InfoHintRow>
        <p id="match-check-in-hint" style={{ ...HINT, margin: "4px 0 0" }}>
          {scopeHint(text, mode, editable)}
        </p>
      </div>
    </div>
  );
}
