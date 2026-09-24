"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearFlag,
  fieldAria,
  flagFromCode,
  focusFlaggedField,
  type FieldAria,
  type FieldErrorMap,
  type FlaggedField,
} from "@/lib/shared/field-errors";

export type FieldErrors<F extends string> = {
  /** Champ signalé en ce moment, s'il y en a un. */
  invalidField: F | null;
  /**
   * Rattache un refus du serveur à son champ, d'après son code. Un code qui ne
   * désigne aucun champ **efface** le signalement précédent : la nouvelle
   * erreur ne dit rien de lui, et il décrirait un envoi qui n'est plus le
   * dernier. Rend `true` si un champ a été signalé.
   */
  report: (code: string | null | undefined, message: string) => boolean;
  /** Signale un champ connu d'avance (contrôle fait avant l'envoi). */
  flag: (field: F, message: string) => void;
  /** Lève le signalement — d'un champ précis, ou de tous. */
  clear: (field?: F) => void;
  /** Attributs ARIA du champ, aides comprises. */
  aria: (field: F, ...helpIds: ReadonlyArray<string | null | undefined | false>) => FieldAria;
  /** Phrase du refus pour ce champ, `null` s'il n'est pas signalé. */
  message: (field: F) => string | null;
};

/**
 * État des erreurs rattachées aux champs d'un formulaire
 * (`lib/shared/field-errors.ts`).
 *
 * Un seul champ signalé à la fois : le serveur ne rend qu'un refus par envoi,
 * et c'est aussi ce que dit la notification. Le signalement ramène le **focus**
 * sur le champ, une fois le rendu fait (le champ pouvait être désactivé pendant
 * l'envoi) — c'est ce qui rend la consigne utile au clavier et au lecteur
 * d'écran, qui arrivent alors sur le champ en entendant pourquoi. Ce focus est
 * marqué (`focusFlaggedField`), pour qu'un contrôle qui s'ouvre au focus ne
 * le prenne pas pour un geste du joueur.
 *
 * `ids` associe chaque champ à l'`id` de son contrôle : c'est lui qui porte
 * les attributs, et lui qu'on focalise.
 */
export function useFieldErrors<F extends string>(
  map: FieldErrorMap<F>,
  ids: Readonly<Record<F, string>>,
): FieldErrors<F> {
  const [flagged, setFlagged] = useState<FlaggedField<F> | null>(null);
  // Les `ids` arrivent souvent en littéral, neuf à chaque rendu : les lire par
  // une référence évite de relancer le focus quand rien n'a été signalé.
  const idsRef = useRef(ids);
  idsRef.current = ids;

  // Un objet neuf par signalement : le même champ signalé deux fois de suite
  // reprend le focus la seconde fois aussi.
  useEffect(() => {
    if (!flagged) return;
    focusFlaggedField(document.getElementById(idsRef.current[flagged.field]));
  }, [flagged]);

  const flag = useCallback((field: F, message: string) => setFlagged({ field, message }), []);

  const report = useCallback(
    (code: string | null | undefined, message: string) => {
      const next = flagFromCode(code, message, map);
      setFlagged(next);
      return next !== null;
    },
    [map],
  );

  const clear = useCallback(
    (field?: F) => setFlagged((prev) => clearFlag(prev, field)),
    [],
  );

  const aria = useCallback(
    (field: F, ...helpIds: ReadonlyArray<string | null | undefined | false>) =>
      fieldAria(idsRef.current[field], flagged?.field === field, ...helpIds),
    [flagged],
  );

  const message = useCallback(
    (field: F) => (flagged?.field === field ? flagged.message : null),
    [flagged],
  );

  return { invalidField: flagged?.field ?? null, report, flag, clear, aria, message };
}
