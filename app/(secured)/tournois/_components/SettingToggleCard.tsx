"use client";

import type { ReactNode } from "react";
import { InfoHint, InfoHintRow } from "@/components/ui/info-hint";
import { CHECKBOX_CARD_LAYOUT, CHECKBOX_CARD_TITLE, checkboxCardChrome, HINT } from "../_lib/form-styles";

/**
 * Carte à case d'un réglage de tournoi qui **survit à la fenêtre d'édition**
 * (planification par l'arbitrage, salons vocaux d'équipe, check-in des
 * matchs) : la case, son titre (libellé natif), le bouton « i » de son
 * explication (`docs/features/INFO_HINTS.md` — un bouton ne se pose pas dans
 * un `<label>`) et la ligne visible qui dit jusqu'à quand elle se modifie.
 * Les identifiants dérivent de `id` : `-label`, `-more`, `-hint`.
 */
export function SettingToggleCard({
  id,
  checked,
  editable,
  label,
  description,
  scopeHint,
  extraDescribedBy,
  onChange,
}: Readonly<{
  /** Identifiant de la case, préfixe des autres. */
  id: string;
  checked: boolean;
  /** Faux sur un tournoi terminé : la case est montrée, verrouillée. */
  editable: boolean;
  label: string;
  /** Contenu du bouton « i ». */
  description: ReactNode;
  /** Précision visible sous le titre. */
  scopeHint: string;
  /** Autre élément qui décrit la case (avertissement montré à côté). */
  extraDescribedBy?: string;
  onChange: (checked: boolean) => void;
}>) {
  const describedBy = [`${id}-more`, `${id}-hint`, ...(extraDescribedBy ? [extraDescribedBy] : [])].join(" ");
  return (
    <div className="checkbox-card" style={{ ...CHECKBOX_CARD_LAYOUT, ...checkboxCardChrome(checked, !editable) }}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={!editable}
        onChange={(e) => onChange(e.target.checked)}
        aria-labelledby={`${id}-label`}
        aria-describedby={describedBy}
        className="checkbox-card-input"
      />
      <div style={{ flex: 1, minWidth: 0 }}>
        <InfoHintRow>
          <label
            id={`${id}-label`}
            htmlFor={id}
            style={{ ...CHECKBOX_CARD_TITLE, cursor: editable ? "pointer" : "default" }}
          >
            {label}
          </label>
          <InfoHint id={`${id}-more`} subject={label}>
            {description}
          </InfoHint>
        </InfoHintRow>
        <p id={`${id}-hint`} style={{ ...HINT, margin: "4px 0 0" }}>
          {scopeHint}
        </p>
      </div>
    </div>
  );
}
