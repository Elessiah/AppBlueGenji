"use client";

import { type InputHTMLAttributes, useRef, useState } from "react";
import { displayedNumber, parseNumberDraft, valueAfterEdit } from "@/lib/shared/number-draft";

type NumberInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "onChange"> & {
  /** Valeur retenue par le formulaire. */
  value: number;
  /**
   * Appelé à chaque saisie qui se lit comme un nombre, et à la sortie du champ
   * pour rétablir la valeur d'avant l'édition quand il a été laissé vide.
   */
  onValueChange: (value: number) => void;
  /**
   * Appelé à chaque frappe, nombre lisible ou non — pour lever l'erreur
   * rattachée au champ dès qu'on y tape, vider compris.
   */
  onEdit?: () => void;
};

/**
 * Champ numérique qu'on peut vider pour réécrire.
 *
 * Remplace le motif `value={n} onChange={(e) => set(Number(e.target.value))}`,
 * qui changeait un champ vidé en « 0 » au premier Retour arrière. Le texte en
 * cours d'édition est gardé tel quel ; seul un nombre lisible part au
 * formulaire. Un champ quitté vide ou illisible revient à la valeur qu'il avait
 * **avant l'édition** — et non à la dernière valeur intermédiaire lue : vider
 * « 16 » au Retour arrière passe par « 1 », que personne n'a voulu garder
 * (voir `lib/shared/number-draft.ts`).
 */
export function NumberInput({ value, onValueChange, onEdit, onFocus, onBlur, ...rest }: NumberInputProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const valueBeforeEdit = useRef(value);

  return (
    <input
      {...rest}
      type="number"
      value={displayedNumber(draft, value)}
      onFocus={(event) => {
        valueBeforeEdit.current = value;
        onFocus?.(event);
      }}
      onChange={(event) => {
        const raw = event.target.value;
        setDraft(raw);
        onEdit?.();
        const parsed = parseNumberDraft(raw);
        if (parsed !== null) onValueChange(parsed);
      }}
      onBlur={(event) => {
        const kept = valueAfterEdit(draft, value, valueBeforeEdit.current);
        if (kept !== value) onValueChange(kept);
        setDraft(null);
        onBlur?.(event);
      }}
    />
  );
}
