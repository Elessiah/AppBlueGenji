"use client";

import { type InputHTMLAttributes, useState } from "react";
import { displayedNumber, parseNumberDraft } from "@/lib/shared/number-draft";

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  /** Valeur retenue par le formulaire. */
  value: number;
  /** Appelé à chaque saisie qui se lit comme un nombre — jamais pour un champ vide. */
  onValueChange: (value: number) => void;
};

/**
 * Champ numérique qu'on peut vider pour réécrire.
 *
 * Remplace le motif `value={n} onChange={(e) => set(Number(e.target.value))}`,
 * qui changeait un champ vidé en « 0 » au premier Retour arrière. Le texte en
 * cours d'édition est gardé tel quel ; seul un nombre lisible part au
 * formulaire, et la valeur retenue réapparaît quand le champ perd le focus
 * (voir `lib/shared/number-draft.ts`).
 */
export function NumberInput({ value, onValueChange, onBlur, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <input
      {...rest}
      type="number"
      value={displayedNumber(draft, value)}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        const parsed = parseNumberDraft(raw);
        if (parsed !== null) onValueChange(parsed);
      }}
      onBlur={(event) => {
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
