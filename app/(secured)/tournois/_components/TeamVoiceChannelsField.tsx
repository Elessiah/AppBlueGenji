"use client";

import type { TournamentFormText } from "@/lib/shared/tournament-actions-text";
import { VOICE_CHANNEL_CAPACITY } from "@/lib/shared/match-voice";
import { useFormText } from "../_lib/form-text";
import { SettingToggleCard } from "./SettingToggleCard";

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
  return (
    <SettingToggleCard
      id="team-voice-channels"
      checked={checked}
      editable={editable}
      label={text.t("form.teamVoice.label")}
      description={<p>{text.t("form.teamVoice.description", { capacity: VOICE_CHANNEL_CAPACITY })}</p>}
      scopeHint={scopeHint(text, mode, editable)}
      onChange={onChange}
    />
  );
}
