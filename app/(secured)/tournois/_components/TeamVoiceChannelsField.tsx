"use client";

import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { VOICE_CHANNEL_CAPACITY } from "@/lib/shared/match-voice";
import { CHECKBOX_CARD_LAYOUT, CHECKBOX_CARD_TITLE, checkboxCardChrome, HINT } from "../_lib/form-styles";
import { useFormText } from "../_lib/form-text";

/** Précision sous le titre, selon l'écran. */
function scopeHint(text: TournamentFormText, mode: "create" | "edit", editable: boolean): string {
  if (!editable) return text.t("form.teamVoice.finished");
  return text.t(mode === "create" ? "form.teamVoice.create" : "form.teamVoice.edit");
}

/**
 * Case « Salons vocaux d'équipe » du formulaire de tournoi
 * (`docs/features/MATCH_VOICE.md`). Décochée par défaut.
 *
 * Comme la planification par l'arbitrage, elle **survit à la fenêtre
 * d'édition** : modifiable jusqu'à la clôture, tournoi en cours compris — la
 * page d'édition l'enregistre par sa route dédiée
 * (`PUT /api/admin/tournaments/[id]/voice-channels`).
 */
export function TeamVoiceChannelsField({
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
        id="team-voice-channels"
        type="checkbox"
        checked={checked}
        disabled={!editable}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby="team-voice-channels-label"
        aria-describedby="team-voice-channels-more team-voice-channels-hint"
        className="checkbox-card-input"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <InfoHintRow>
          <label
            id="team-voice-channels-label"
            htmlFor="team-voice-channels"
            style={{ ...CHECKBOX_CARD_TITLE, cursor: editable ? "pointer" : "default" }}
          >
            {t("form.teamVoice.label")}
          </label>
          <InfoHint id="team-voice-channels-more" subject={t("form.teamVoice.label")}>
            <p>{t("form.teamVoice.description", { capacity: VOICE_CHANNEL_CAPACITY })}</p>
          </InfoHint>
        </InfoHintRow>
        <p id="team-voice-channels-hint" style={{ ...HINT, margin: "4px 0 0" }}>
          {scopeHint(text, mode, editable)}
        </p>
      </div>
    </div>
  );
}
