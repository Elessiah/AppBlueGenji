"use client";

import { useId } from "react";
import {
  SUSPENSION_REASON_MAX_LENGTH,
  SUSPENSION_REASON_MIN_LENGTH,
  cleanModerationReason,
} from "@/lib/shared/account-suspension";

/**
 * Motif d'une décision de modération (retrait d'une image hors signalement,
 * suspension d'un compte) : les **faits retenus**, envoyés tels quels à la
 * personne visée dans l'exposé des motifs (DSA, art. 17.3.b).
 *
 * `recipient` nomme qui le lira (« l'équipe », « le joueur ») : l'aide le dit,
 * et rappelle de ne nommer aucun autre joueur — le message part sur Discord.
 */
export function ModerationReasonField({
  value,
  onChange,
  recipient,
  disabled = false,
}: Readonly<{
  value: string;
  onChange: (value: string) => void;
  recipient: string;
  disabled?: boolean;
}>) {
  const id = useId();
  const helpId = `${id}-help`;
  const length = cleanModerationReason(value).length;
  return (
    <div className="field" style={{ marginTop: 12 }}>
      <label htmlFor={id}>Faits retenus (obligatoire)</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={SUSPENSION_REASON_MAX_LENGTH}
        rows={3}
        required
        disabled={disabled}
        aria-describedby={helpId}
        data-autofocus
      />
      <p id={helpId} style={{ fontSize: 12, color: "var(--ink-soft)", margin: "6px 0 0" }}>
        Envoyés à {recipient} avec la décision. Décris les faits sans nommer d&apos;autre joueur (
        {SUSPENSION_REASON_MIN_LENGTH} à {SUSPENSION_REASON_MAX_LENGTH} caractères — {length} saisis).
      </p>
    </div>
  );
}

/** Le motif saisi est-il envoyable ? Mêmes bornes que le serveur. */
export function isModerationReasonReady(value: string): boolean {
  const length = cleanModerationReason(value).length;
  return length >= SUSPENSION_REASON_MIN_LENGTH && length <= SUSPENSION_REASON_MAX_LENGTH;
}
