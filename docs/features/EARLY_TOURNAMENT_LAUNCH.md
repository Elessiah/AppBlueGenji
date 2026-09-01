# Lancement anticipé : abréger les étapes d'avant-course

Le staff `tournaments` peut **abréger les étapes qui précèdent le coup d'envoi**
et lancer un tournoi sur-le-champ, sans attendre les horaires annoncés.

Un tournoi traverse quatre étapes avant de commencer — **Masqué**, **Annoncé**,
**Inscriptions**, **Clôture** (`lib/shared/tournament-progress.ts`) — et rien ne
permettait de les écourter. Toutes les quatre sont désormais un point de départ
valide : celles qui restaient sont franchies d'un coup.

## Pourquoi l'édition n'y suffisait pas

Le formulaire d'édition (`docs/features/TOURNAMENT_EDITING.md`) modifie les
dates, et pourtant il ne peut pas produire ce résultat — pas par omission, mais
parce que chacun de ses garde-fous, pris isolément, a raison :

- **reculer la clôture des inscriptions dans le passé y est refusé**
  (`REGISTRATION_CLOSE_IN_PAST`), et c'est correct : seule, la manœuvre ferait
  *reculer* le tournoi d'un état plutôt que de l'avancer — `UPCOMING` au lieu de
  `REGISTRATION` ;
- **avancer la date de début seule ne change rien** : `computeTournamentState`
  teste les inscriptions **avant** le coup d'envoi, si bien qu'un tournoi dont la
  clôture est encore à venir reste « Inscriptions », quelle que soit sa date de
  début ;
- **la date d'ouverture des inscriptions n'est plus éditable** une fois le
  tournoi publié, et `startVisibilityAt` non plus.

Abréger n'est donc pas « une modification de plus », mais le déplacement
**cohérent** des quatre jalons — ce qu'un formulaire champ par champ ne sait pas
faire.

## La règle : on ne fait jamais avancer une date

`lib/shared/tournament-launch.ts` (pur, partagé) ramène chaque jalon au plus tôt
entre sa valeur et l'instant du lancement, **dans l'ordre inverse du
calendrier**, chacun borné par le suivant déjà résolu :

```
startAt              = min(startAt,              maintenant − 1 s)
registrationCloseAt  = min(registrationCloseAt,  startAt)
registrationOpenAt   = min(registrationOpenAt,   registrationCloseAt)
startVisibilityAt    = min(startVisibilityAt,    registrationOpenAt)
```

Trois propriétés en découlent seules, sans un cas particulier écrit à la main :

1. **L'ordre chronologique est préservé**, donc l'invariant que
   `validateDateOrder` protège — et avec lui « un tournoi caché est toujours
   `UPCOMING` », dont `docs/features/TOURNAMENT_VISIBILITY_ACCESS.md` dispense
   les routes d'écriture de tout contrôle de visibilité. Abréger depuis l'étape
   « masqué » **publie** le tournoi au passage : il ne devient jamais « en cours
   et invisible ».
2. **Rien n'est rouvert rétroactivement.** Un tournoi déjà à l'étape « clôture »
   ne voit que sa date de début bouger ; ses inscriptions restent closes à
   l'heure où elles l'ont été.
3. **N'importe quelle étape peut être le point de départ**, et le calcul est le
   même pour toutes.

### Le recul d'une seconde

Les jalons ne sont pas posés *exactement* à `now` : `computeTournamentState` rend
`REGISTRATION` tant que `now <= registrationCloseAt`, **bornes comprises** —
poser la clôture à l'instant même ne lancerait donc rien. Une seconde suffit à
sortir de l'égalité, et c'est aussi la résolution d'une colonne `DATETIME`
(MySQL tronque à la seconde : un recul plus court pourrait se retrouver stocké à
l'identique).

## L'état n'est jamais écrit à la main

Ce sont les dates qui font foi partout ailleurs (`lib/shared/tournament-state.ts`
et le calcul client qui en dépend) : un `state = 'RUNNING'` posé de force serait
défait à la première synchronisation.

C'est aussi ce qui fait que le lancement anticipé n'a **aucun chemin à lui côté
moteur**. Une fois les dates abrégées, `syncTournamentState` fait ce qu'il aurait
fait à l'heure dite : clôture d'un plateau désert, initialisation du format,
génération de la première manche, réconciliation, ligne de journal Discord
`tournament_started`. Aucun format ne connaît le lancement anticipé, et un format
ajouté demain en héritera sans une ligne de plus.

Tout tient dans **une transaction**, synchronisation comprise : si
l'initialisation du format échoue, les dates abrégées sont annulées avec elle et
le tournoi reste où il était. Le contraire laisserait un tournoi marqué « en
cours » sans plateau ni classement.

## Ce qui est refusé, et ce qui ne l'est pas

Le seul vrai refus est **« il n'y a plus rien à abréger »** :

| Code | HTTP | Quand |
| --- | --- | --- |
| `TOURNAMENT_ALREADY_STARTED` | 409 | L'heure de début est passée — la synchronisation le lancera d'elle-même |
| `TOURNAMENT_ALREADY_FINISHED` | 409 | Tournoi clos |
| `INVALID_DATES` | 400 | Un jalon illisible en base |
| `TOURNAMENT_NOT_FOUND` | 404 | — |

L'état consulté est le **calculé**, pas le stocké : un tournoi dont l'heure de
début est passée n'a rien à abréger même si la colonne `state` n'a pas encore été
recalée.

En revanche, partir d'une étape où **personne n'a pu s'engager** n'est *pas*
refusé, alors qu'on pourrait s'y attendre : l'inscription exige l'état
`REGISTRATION`, pour un joueur comme pour une équipe invitée. Le lancement clôt
alors le tournoi sur-le-champ, faute d'adversaires
(`docs/features/UNDERFILLED_TOURNAMENTS.md`). C'est une conséquence à **annoncer
avant le clic** (`willCloseWithoutMatches`, affiché en rouge dans la
confirmation, où le bouton devient « Clore le tournoi »), et non un droit à
retirer : refuser reviendrait à décider à la place de l'organisateur qu'un
tournoi mort-né doit rester ouvert jusqu'à son heure.

## Permission

`can(user, "tournaments")` — administrateur **ou arbitre**. Lancer un tournoi est
un acte d'organisation, celui-là même que la clôture des inscriptions et
l'arbitrage des scores supposent déjà. La suppression définitive reste le seul
geste du domaine à exiger `isAdmin` (`docs/features/TOURNAMENT_DELETION.md`),
parce qu'elle, rien ne la rejoue.

## Interface

`POST /api/admin/tournaments/[id]/launch`, sans corps : l'action n'a pas de
paramètre. Laisser le client proposer une date rouvrirait par la fenêtre ce que
l'édition refuse par la porte — un tournoi antidaté d'une semaine.

Le bouton « ▶ Lancer maintenant » n'apparaît dans l'en-tête que lorsqu'il mène
quelque part (`canLaunchNow`, la même fonction pure que le serveur rejoue sous
verrou) — même principe que « Modifier » : pas de bouton grisé sur un tournoi
déjà en cours.

La confirmation (`LaunchTournamentDialog`) n'exige pas de recopier le nom,
contrairement à la suppression : le tournoi n'est pas détruit, il commence. Elle
montre en revanche trois choses concrètes plutôt qu'un « êtes-vous sûr ? » :

- les **étapes abrégées** (`abridgedStagesForLaunch`), nommées avec les libellés
  de la frise de bas de page (`docs/features/TOURNAMENT_PROGRESS.md`) — ce qui
  saute est écrit comme ce que le staff voit déjà sur la barre ;
- l'**effectif au départ**, que le lancement fige ;
- l'**heure de début abandonnée**.

Elles sont calculées à l'ouverture du dialogue et non à chaque rendu : la page se
redessine au fil du flux SSE, et voir la liste changer sous le curseur pendant
qu'on lit la confirmation serait pire que de l'afficher figée le temps d'un clic.
Le serveur, lui, rejoue la règle.

## Effet de bord corrigé au passage

`syncTournamentState` ne reconnaissait le coup d'envoi qu'au couple
`REGISTRATION → RUNNING`. Or entre la clôture des inscriptions et l'heure de
début, un tournoi **repasse par `UPCOMING`** : c'est de là qu'il part le plus
souvent. La ronde suisse, la survie, la BG Survie et le multi-phases étaient donc
privés de leur initialisation dès que clôture et début n'étaient pas simultanés —
classement jamais semé, aucune manche générée, un tournoi « en cours » sans rien
à jouer. Les formats à plateau y échappaient seuls, `createBracketIfMissing` les
rattrapant dans l'entretien.

Le coup d'envoi se reconnaît désormais à l'état **d'arrivée** (`computed ===
"RUNNING"`), ce qui suffit : le test est à l'intérieur de `computed !== state`,
donc l'état de départ ne peut être que `UPCOMING` ou `REGISTRATION`.
