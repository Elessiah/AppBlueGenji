# Accessibilité — rôles ARIA de la fiche tournoi, titres des fiches

Tâches 9 et 16 d'`ACCESSIBILITE.md`.

## 9. Fiche tournoi : attributs ARIA (WCAG 1.3.1, 4.1.2)

L'audit laissait `aria-prohibited-attr` et `aria-required-children` « à
vérifier » sur `/tournois/[id]`. Trois nœuds en cause :

- **Grille des faits de l'en-tête** (`TournamentHeader.tsx`, `MetaCell`) : le
  repère d'une valeur expliquée (format de match, par exemple) était un
  `<span tabIndex={0} aria-label=…>`. Un `aria-label` est **interdit** sur un
  élément sans rôle (rôle `generic`) — une partie des lecteurs d'écran
  l'ignore —, et le `tabIndex` créait un arrêt de tabulation qui ne faisait
  rien : l'infobulle `title` n'apparaît pas au focus clavier. L'explication
  est désormais écrite dans le texte, hors écran (`.sr-only`), et le repère
  n'est plus focusable. Au passage, l'ancien libellé lisait `item.value`
  brut plutôt que le texte affiché.
- **Classement de la ronde suisse** (`SwissView.tsx`) : `role="list"` /
  `listitem`, avec un en-tête de colonnes `aria-hidden` et un `aria-label`
  par ligne qui remplaçait son contenu. La liste rendue sans équipe laissait
  `aria-required-children` à vérifier ; surtout, un classement à colonnes est
  un **tableau**. Il passe en `role="table"` / `rowgroup` / `row` /
  `columnheader` / `cell`, les
  intitulés abrégés (« Pts », « Bch ») portent leur nom complet, la coche de
  victoire d'office est dite en toutes lettres, et la colonne d'action
  n'existe que si une ligne au moins porte le bouton d'abandon. La mise en page
  est une **grille à sous-grilles** (`grid-template-columns: subgrid` sur les
  groupes et les lignes) : chaque colonne prend la largeur de sa cellule la plus
  large — en-tête, statut, bouton, police agrandie comprise —, et « Statut »
  s'aligne enfin sur les statuts. Seul le nom est élastique, avec un plancher
  de `6em` ; en dessous, sur un écran étroit où il était écrasé à zéro, le
  tableau défile à l'horizontale dans une `ScrollArea` — un tableau de données
  est l'exception que prévoit WCAG 1.4.10. Sans équipe classée, une phrase
  remplace le tableau (sans « pour l'instant » sur un tournoi clos).
  Le bouton d'abandon d'une autre équipe commence désormais par son texte
  visible (« Abandonner : déclarer l'abandon de … », WCAG 2.5.3).
- **Modale de lancement de match** (`MatchLaunchCenter.tsx`) : le « VS » du
  titre portait `aria-label="contre"` sur un `<span>` — même interdiction, sur
  le titre qui **nomme** la modale. Le « VS » est masqué aux technologies
  d'assistance et « contre » écrit hors écran.
- **Hors du périmètre audité, même défaut** : l'équipe et les rôles d'une
  fiche de joueur, les contacts d'une annonce de recrutement reçoivent
  `role="group"`. Le balayage `tests/app/aria-prohibited-attr.test.ts` couvre
  désormais tout `app/` et `components/`.
- **Reste ouvert** : `ScrollArea` est toujours focusable et toujours une
  région, même quand rien ne déborde — c'est le composant partagé, consigné en
  tâche 18 d'`ACCESSIBILITE.md`.

## 16. Titres des fiches d'équipe et de joueur (WCAG 2.4.2 · RGAA 8.6)

`/equipes/[id]` et `/joueurs/[id]` s'intitulaient « Équipes » et « Joueurs »,
hérités de l'annuaire. Chacune a maintenant une mise en page de segment
(`app/(secured)/equipes/[id]/layout.tsx`, `app/(secured)/joueurs/[id]/layout.tsx`)
dont le `generateMetadata` ne pose **que** le titre :

- « <nom> · Équipe · BlueGenji Esport », « <pseudo> · Joueur · BlueGenji Esport » ;
- un compte anonymisé s'annonce « Compte supprimé · Joueur » — son pseudo
  d'emprunt se lirait comme celui d'un joueur ;
- repli générique (« Équipe », « Joueur ») pour un identifiant invalide, une
  fiche introuvable, une entrée solo (qui n'a pas de fiche d'équipe), une base
  injoignable, et **tout lecteur non connecté** : les deux fiches lui sont
  refusées (les routes répondent 401, la garde rend « Connexion requise »),
  l'onglet ne doit pas nommer ce que la page tait.

La règle est dans `lib/shared/entity-page-titles.ts` (pur) ; les lectures,
une ligne chacune, sont `getTeamPageIdentity` (`teams-service`) et
`getPlayerPageIdentity` (`users-service`) — pas `getTeamDetail` ni
`getFullProfile`, qui calculent statistiques et classement pour un titre.
