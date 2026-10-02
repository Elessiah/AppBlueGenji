# Routes d'administration des listes — corps JSON `null`

Détail de l'entrée de `ERREUR.txt` qui renvoie ici. Retirer ce fichier avec l'entrée.

## Constat

Les routes `PUT` / `DELETE` sur `[id]` et `PUT` sur `reorder` des partenaires, du bureau, des chiffres et piliers de l'association, des bénévoles et des annonces de recrutement lisent leur corps par `readJsonBody`, qui rend tout JSON valide — y compris le littéral `null`. Le corps est ensuite lu champ par champ sans vérifier que c'est un objet :

- `reorder` lit `body.ids` hors de tout `try` : la `TypeError` remonte, la réponse est une 500 ;
- `PUT [id]` lit les champs dans le `try` du service : la `TypeError` est attrapée et son **message** (une phrase en anglais) est renvoyé comme code d'erreur, en 400 — contre la règle « une réponse d'erreur ne porte qu'un code ».

Seul un client qui envoie délibérément `null` y arrive, et il lui faut la permission de la liste (`showcase` ou `recruitment`).

## Piste

Dans `readBody` (`lib/server/admin-collection-routes.ts`), refuser tout corps qui n'est pas un objet par `INVALID_BODY` (400), avec un test par famille de route. Changement de comportement : à faire dans sa propre PR, hors de la mise en commun de ces routes (feature/reduce-duplication), qui l'a relevé et l'a volontairement conservé à l'identique.
