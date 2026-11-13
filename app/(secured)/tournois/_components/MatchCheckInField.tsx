"use client";

import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";
import { useFormText } from "../_lib/form-text";
import { SettingToggleCard } from "./SettingToggleCard";

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
  return (
    <SettingToggleCard
      id="match-check-in"
      checked={checked}
      editable={editable}
      label={text.t("form.matchCheckIn.label")}
      description={<p>{text.t("form.matchCheckIn.description")}</p>}
      scopeHint={scopeHint(text, mode, editable)}
      onChange={onChange}
    />
  );
}
