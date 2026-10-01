# Number Input

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Champs numériques** : un `<input type="number">` contrôlé passe par `<NumberInput>` (`components/ui/number-input.tsx`, logique pure `lib/shared/number-draft.ts`), jamais par `value={n} onChange={(e) => set(Number(e.target.value))}` — `Number("")` vaut `0`, si bien que vider le champ au Retour arrière y réécrivait aussitôt un « 0 ». Le composant garde le texte saisi (vide compris), ne transmet que ce qui se lit comme un nombre, et rétablit à la sortie d'un champ laissé vide la valeur d'**avant l'édition** (vider « 16 » passe par « 1 », que personne n'a voulu garder) ; l'erreur rattachée au champ se lève par `onEdit`, appelé à chaque frappe, vider compris. Un balayage (`tests/lib/shared/number-draft.test.ts`) refuse le motif ; un champ facultatif qui garde le vide (`e.target.value ? Number(…) : null`) n'est pas concerné.
