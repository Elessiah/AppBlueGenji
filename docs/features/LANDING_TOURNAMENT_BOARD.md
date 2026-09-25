# Tableau « Tournois en cours et à venir » de l'accueil

`components/cyber/landing/TournamentBoard.tsx` rend la grande carte du tournoi
mis en avant et les trois suivantes. Ce que chaque carte **dit** — état, action,
date — est décidé par un module pur, `lib/shared/landing-board.ts`, testable sans
rendu.

## Ce qui a été corrigé

| Avant | Après |
| --- | --- |
| Jeu **deviné d'après le nom** (`inferGameLabel`, repli sur « Overwatch ») : un tournoi Marvel Rivals au nom neutre s'annonçait Overwatch, sur le tableau, le calendrier et la carte du direct. | Jeu lu sur `TournamentCard.game`, libellé par `gameLabel` (`lib/shared/tournament-labels.ts`). Les trois fonctions d'inférence ont disparu ; `LandingCalendarEvent` porte désormais `game`. |
| Jeu nommé trois fois par carte (pastille, colonne de droite, sur-titre). | Une seule mention, à droite de la pastille d'état. |
| État brut anglais (« REGISTRATION · BRACKET ») et pastille **rouge** pour un tournoi en cours. | Libellé français (`boardStateLabel`) dans une pastille **bleue** : le rouge est réservé à ce qui est à l'antenne. La ligne sous le titre donne le format (`FORMAT_LABELS`). |
| « S'inscrire » sur toutes les petites cartes, tournoi lancé ou complet compris ; « Voir le bracket » sur la grande, inscriptions comprises, au-dessus d'un mini-arbre vide. | Action selon l'étape (`boardActionLabel`) ; mini-arbre masqué tant que le plateau n'a aucun match. |
| « S'inscrire » proposé aux inscriptions ouvertes avec une place libre, sans connaître le lecteur : un visiteur sans équipe, sans rôle de gestion ou déjà inscrit cliquait et arrivait sur une fiche qui refuse l'inscription (`registerBlockedNotice`). | Le tableau ne connaît toujours pas le lecteur — mais ne le prétend plus : `boardActionLabel` ne rend jamais « S'inscrire », comme les cartes d'inscription de `/tournois` (`RegistrationCard.tsx`, voir `docs/features/TOURNAMENT_LIST_CARDS.md`). « Voir le tournoi » partout aux inscriptions, « Complet » restant lisible sur la pastille d'état (`boardStateLabel`). |
| « CASH PRIZE — » écrit en dur sur chaque carte. | Retiré : aucune colonne ne porte de montant. |
| Date de début en `toLocaleString` (secondes comprises, fuseau du serveur). | `formatBoardStartAt` : « 21 sept. · 20:30 », fuseau `Europe/Paris`, année seulement si elle diffère. |

## Règles

- **État** — l'étape vient de `computeTournamentProgress` (la frise de la fiche),
  qui départage les deux visages d'`UPCOMING` par les dates :
  `ANNOUNCED` → « Bientôt », `REGISTRATION` → « Inscriptions ouvertes » (ou
  « Complet » sur un plateau plein), `LOCKED` → « Inscriptions closes »,
  `RUNNING` → « En cours ».
- **Action** — elle mène toujours à la fiche ; seul le libellé change, et
  **jamais** vers « S'inscrire » : le tableau n'a aucun moyen de savoir si le
  lecteur a une équipe, un rôle de gestion, ou est déjà inscrit — même règle
  que les cartes de `/tournois`. « Voir le bracket » sur un tournoi lancé en
  élimination simple ou double, « Suivre le tournoi » sur un tournoi lancé sans
  arbre (Suisse, Survie, BlueGenji Survie, multi-phases), « Voir le tournoi »
  sinon (inscriptions ouvertes ou closes, à venir, terminé).
- **Horloge** — une seule lecture de `Date.now()` par rendu de la section, pour
  que deux cartes ne se contredisent pas sur une échéance.
