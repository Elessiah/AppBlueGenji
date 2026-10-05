# Ordre de seeding réordonnable

Le **seeding** est l'ordre des équipes inscrites à un tournoi. Il décide des
appariements de la première manche dans tous les formats : haut de tableau
contre bas de tableau en élimination et en ronde suisse, couples adjacents en
survie, plateau initial en multi-phases.

Le staff (`can(user, "tournaments")`) le réordonne depuis la page du tournoi,
avec des flèches ↑ / ↓, **jusqu'au coup d'envoi**.

## Où on le règle

**Dans la liste des inscrites, sur les lignes elles-mêmes** — bloc « Inscriptions
· ordre de départ » de `/tournois/[id]`.

L'ordre a d'abord vécu dans un bloc « Seeding » à part, posé juste au-dessus d'un
tableau « Inscriptions » qui listait les mêmes équipes avec leur seed. Deux
listes identiques dont une seule se manipulait : celle qu'on cherche est celle
qui porte le nom de la chose (« les inscrites »), et c'est justement celle qui
n'avait pas de flèches. Il n'y en a donc plus qu'une, et les flèches sont dessus.

Deux conséquences de forme :

- la **fenêtre d'édition** est déduite du détail déjà reçu (`seedingLockReason`
  rejouée côté client sur `detail.matches`), et non d'une requête à part : les
  flèches apparaissent avec la page. Le serveur reste le juge — il refuse en 409
  une écriture devenue interdite entre-temps ;
- le geste déplace la ligne **tout de suite**, puis se laisse corriger par ce que
  rapporte le flux. Sans cet affichage optimiste, un aller-retour complet (écriture
  puis rafraîchissement) sépare le clic de son effet, et le bouton passe pour mort.

## Des flèches, pas de glisser-déposer

L'ordre se règle **aux seules flèches** ↑ / ↓, qui déplacent une ligne d'un cran
(une écriture par cran, `applyOrder`, avec aperçu optimiste et annonce vocale).

Une poignée de glissement (`⠿`) a existé à côté des flèches, pour amener le
trentième rang en tête d'un seul geste. Elle a été **retirée** : sur téléphone,
la poignée occupe le bord de chaque ligne, et un doigt posé dessus pour faire
défiler la liste vers le bas déplaçait une équipe — autant de réordonnancements
involontaires (retour d'utilisateur, octobre 2026). Le défilement est le geste
le plus fréquent sur une longue liste ; un contrôle qui le confisque coûte plus
qu'il ne fait gagner.

Les flèches n'ont pas ce défaut :

- ce sont de vrais `<button>` : focusables, actionnés à Entrée et à l'espace,
  nommés d'après l'engagé (« Monter Alpha d'un rang ») ;
- elles ne réagissent qu'au `click`, que le navigateur **n'émet pas** pour un
  doigt qui glisse : faire défiler la page en partant d'une flèche ne déplace
  rien. `touch-action: manipulation` retire en plus le délai du double-tap ;
- au doigt (≤ 720 px), elles passent de 32 à **44 px** et s'écartent l'une de
  l'autre, pour qu'on ne touche pas « ↓ » en visant « ↑ » ;
- la flèche qui sortirait de la liste (↑ en tête, ↓ en queue) est désactivée, et
  l'état désactivé se marque **par les couleurs** (`--ink-mute`, bordure
  atténuée), jamais par `opacity` ;
- après un clic, le focus reste sur la flèche actionnée — ou passe à l'autre si
  la ligne vient d'atteindre une extrémité.

## Ce que la liste montre — et ce que le moteur jouera

`TournamentSnapshot.seedingSource` dit d'où vient l'ordre effectif :
`MANUAL`, `RANKING` ou `REGISTRATION` (règle dans `seedingSource()`,
`lib/shared/seeding.ts` — la même que celle de l'aperçu du plateau).

En `RANKING`, **avant le coup d'envoi** (masqué, annoncé, aux inscriptions ou
inscriptions closes — `isPreLaunchState`), l'instantané range lui-même la liste
dans l'ordre du classement du site (`registrationsFollowRanking`,
`lib/shared/seeding.ts`), par **le même tri** que l'aperçu du plateau et que le
moteur au lancement : `rankEntrantsBySiteRanking`, celui que
`loadEntrantsBySiteRanking` applique après sa lecture des inscriptions, appelé
ici sur les lignes que l'instantané a déjà en main (lecture mutualisée du
classement). Chaque nouvelle inscrite prend sa place de cote au lieu de
s'ajouter en queue, et les rangs affichés sont renumérotés de 1 à N. La colonne
`seed` n'est pas réécrite — le classement peut encore bouger d'ici le lancement
(matchs d'autres tournois), c'est donc une **lecture**, refaite à chaque
instantané ; le battement d'entretien de la salle (30 s) rattrape une cote qui
bouge ailleurs. Corollaire utile : le
premier geste du staff part de cet ordre, un déplacement ne jette donc pas le
classement pour revenir à l'ordre d'arrivée. Le bloc le dit, et rappelle que
réordonner fige l'ordre.

Une fois le tournoi **lancé**, les matchs du tournoi font bouger les cotes,
alors que le tirage, lui, est fait : la liste suit les **rangs figés au coup
d'envoi** (`registrationsFollowFrozenDraw`, `orderByFrozenSeeds`). Le moteur les
a écrits au lancement dans sa table d'état (`bg_swiss_standings`,
`bg_survival_standings`, `bg_endurance_standings`, ou `bg_tournament_phase_teams`
de la première phase peuplée) ; `loadFrozenRankingSeeds`
(`lib/server/tournaments/frozen-seeds.ts`) les relit sans jamais reclasser.
`registrations[].seed` porte ce rang (une engagée absente de la table passe en
dernier, `seed` à `null`, affichée « — ») ; le bloc dit que les rangs sont ceux
du tirage. La carte live de l'accueil (« SEED n ») lit le même rang figé. Les
sections de manche s'en servent pour trier (`ROUND_MATCH_SECTIONS.md`). L'ordre,
lui, est figé (voir ci-dessous).

## Fenêtre d'édition

L'ordre reste modifiable **jusqu'au coup d'envoi** : dès la création, avant
l'ouverture des inscriptions et pendant celles-ci (clôture comprise). Il se fige
dès que le tournoi passe `RUNNING`, **même si aucun score n'est saisi**.

La borne était d'abord « la première saisie de score », pour laisser corriger un
tirage après le lancement. Elle a laissé passer un changement d'ordre **en
pleine première manche** : au coup d'envoi, les matchs du premier tour sont
`READY`, les joueurs les voient et commencent à jouer, mais tant que personne
n'a reporté de score, le réordonnancement restait permis — et régénérait le
plateau sous leurs yeux. `RUNNING` est le bon signal : c'est la bascule qui
pose la première manche dans tous les formats (`SINGLE` / `DOUBLE` par
l'entretien, les formats à classement par leur amorçage), et rien n'existe
avant.

Le coup d'envoi se lit sur **deux sources** (`seedingWindowState`) : l'état
stocké **ou** celui de l'horloge (`computeTournamentState`). La colonne `state`
ne bascule qu'au prochain entretien ; l'heure passée, elle peut dire encore
`REGISTRATION` tant que personne n'a rien écrit ni ouvert. Lue seule, elle
laissait réordonner après l'heure — et l'écriture déclenchait alors la
synchronisation qui lance le tournoi avec cet ordre tardif. Le stocké rattrape
un lancement anticipé, le calculé une heure passée sans recalage : même paire
que le retrait d'un engagé (`ENTRANT_REMOVAL.md`). Côté client, l'heure vient de
`useTournamentNow` (minuteur posé sur la prochaine bascule) : les flèches
disparaissent à la seconde du coup d'envoi, sans attendre un instantané.

Le verrou réutilise `hasScoreInput` de `lib/shared/match-lock.ts` : compte comme
saisie un score (même 0), un vainqueur, un forfait ou un report en attente. Les
byes et matchs fantômes sont ignorés — leur score est posé par le moteur.

La fenêtre se juge **sous verrou**. `reorderSeeding` ouvre sa transaction par `lockTournamentRow`
puis par un `SELECT id FROM bg_matches WHERE tournament_id = ? FOR UPDATE` (table
seule : MariaDB refuse `FOR UPDATE OF`), **avant** toute lecture ordinaire —
sous `REPEATABLE READ`, c'est la première qui fige l'instantané. Un lancement
commité pendant l'attente est donc vu, et refusé. Tournoi d'abord, comme les
gestes du staff qui écrivent des matchs sous ce verrou (avancée, inscription).
Un interblocage reste possible avec un geste qui tient des matchs puis le
tournoi ; défait, le réordonnancement **rejoue** sa transaction, jusqu'à trois
fois (`REORDER_DEADLOCK_ATTEMPTS`), et refuse alors sur l'état qu'il relit. Le
refus d'un geste défait est lisible : `fail()` (`lib/server/http.ts`) reconnaît
le message d'interblocage (`isDeadlockMessage`, `lib/server/mysql-errors.ts`)
et le rend en **409 `CONCURRENT_UPDATE_RETRY`** (« rien n'a été enregistré,
réessaie »).

Trois raisons de verrouillage, exposées à l'interface (`seedingLockReason`,
dans cet ordre de priorité) :

| `lockReason` | Sens | Refus de `PATCH` |
| --- | --- | --- |
| `null` | encore modifiable | — |
| `FINISHED` | tournoi terminé | `SEEDING_LOCKED_FINISHED` (409) |
| `SCORES_ENTERED` | au moins un match porte une saisie | `SEEDING_LOCKED` (409) |
| `STARTED` | tournoi lancé (`RUNNING`), même sans score | `SEEDING_LOCKED_STARTED` (409) |

`SCORES_ENTERED` reste jugé avant `STARTED`, pour garder la phrase la plus
précise sur un tournoi où l'on joue déjà. Un tournoi terminé a son propre code :
il portait jadis `SEEDING_LOCKED`, dont la phrase (« Un score a été saisi ») ne
décrivait pas un tournoi clos. Les trois codes ont leur phrase dans `_lib/error-map.ts`. Une fois
figé, les flèches disparaissent et la phrase du verrou prend leur place ; sur
un tournoi lancé, elle tait celle du retrait (« le tirage est fait »), qui
dirait le même fait (`removalNotice`).

## Qui lit l'ordre

`bg_tournament_registrations.seed` est la source de vérité. Le drapeau
`bg_tournaments.manual_seeding` arbitre le comportement par défaut :

| Format | `manual_seeding = 0` (défaut) | `manual_seeding = 1` |
| --- | --- | --- |
| `SINGLE` / `DOUBLE` | ordre des seeds (déjà le cas avant) | idem |
| `SWISS` | classement du site (`lib/shared/ranking.ts`) | ordre des seeds |
| `SURVIVAL` | classement du site | ordre des seeds |
| `BG_SURVIE` | classement du site | ordre des seeds |
| `MULTI` (phase 1) | classement du site | ordre des seeds |

Tant que personne n'a réordonné, chaque format garde donc exactement le
comportement qu'il avait.

## Refermer un trou : `resequenceSeeds`

Retirer un engagé du plateau (`docs/features/ENTRANT_REMOVAL.md`) efface une
ligne au milieu de la suite : le troisième de huit s'en va, et la suite reste en
4, 5, 6, 7, 8. Rien ne s'en casse — tout le moteur lit ces rangs par `ORDER BY`,
jamais par leur valeur — mais la colonne cesse de dire ce qu'elle promet, et le
rang affiché à l'écran (renuméroté à la volée par `loadEntries`) ne serait plus
celui qui est en base.

`resequenceSeeds` renumérote donc de 1 à N **sans changer l'ordre**, sur la
connexion de l'appelant. Elle vit ici, où vit déjà la règle d'ordre, et non chez
le retrait : deux endroits qui décident du même tri finiraient par ne plus
trier pareil.

Elle ne touche **pas** `manual_seeding` : refermer un trou n'est pas un ordre
choisi par le staff, et le poser ferait basculer un tournoi qui seedait depuis le
classement du site vers l'ordre d'inscription, sans que personne ne l'ait
demandé.

## Aucun plateau à reconstruire

Un plateau ne naît qu'au coup d'envoi (`SINGLE` / `DOUBLE` par l'entretien de
`syncTournamentState`, les formats à classement par leur amorçage à la
transition REGISTRATION → RUNNING), et la fenêtre se ferme à ce même instant :
l'ordre s'écrit donc toujours **avant** qu'un match existe, et le lancement le
lit tel quel. `reorderSeeding` n'a rien à détruire ni à réamorcer.

Le chemin qui le faisait (suppression des matchs, `bracket_size` remis à
`NULL`, réamorçage des formats à classement et purge des phases `MULTI`) a été
retiré avec le verrou au coup d'envoi. À sa place, un **invariant** : des
matchs présents dans la transaction refusent l'écriture en
`SEEDING_LOCKED_STARTED`, plutôt que de détruire un tirage et d'amorcer les
manches d'un tournoi que la fenêtre dit encore ouvert.

## Liste repliée

Au-delà de seize inscrites, la liste ne montre que les seize premières lignes,
suivies d'un bouton réversible « Voir toute la liste (N de plus) » /
« Réduire la liste » (`_lib/registrations-list.ts`). Sur téléphone, un tournoi
à 128 engagées rendait sinon une fiche de 16 000 px, où plateau et frise
devenaient introuvables. L'état déplié est un drapeau, pas un compte figé : une
liste dépliée le reste quand le flux y ajoute une ligne. Une flèche « ↓ » qui
ferait passer une ligne sous la dernière visible déplie la liste d'elle-même,
pour que la ligne déplacée et son bouton restent à l'écran.

## Surfaces

| Élément | Emplacement |
| --- | --- |
| Logique pure | `lib/shared/seeding.ts` |
| Orchestration | `lib/server/tournaments/seeding.ts` |
| API | `GET` / `PATCH /api/admin/tournaments/[id]/seeding` |
| Interface | `app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx` |

`GET` sert l'ordre courant et la fenêtre d'édition côté serveur ; l'interface,
elle, dérive la fenêtre du détail déjà reçu et n'appelle que `PATCH`.

`PATCH` attend `{ teamIds: number[] }` — la liste **complète** des inscrites dans
le nouvel ordre. Toute liste qui n'est pas une permutation exacte est refusée
(`INVALID_SEED_ORDER`, 400) : sans ce contrôle, un réordonnancement pourrait
faire disparaître une équipe du tournoi. Ordre figé → `SEEDING_LOCKED`,
`SEEDING_LOCKED_STARTED` ou `SEEDING_LOCKED_FINISHED` (409), un code seul (`fail`).

## Tests

- `tests/lib/shared/seeding.test.ts` — verrou (`STARTED` dès `RUNNING`, même
  sans match), déplacement, validation d'ordre, provenance de l'ordre
  (`seedingSource`, `isSeedOrderEffective`).
- `tests/app/seeding-arrows.test.ts` — plus de poignée ni de geste, flèches
  nommées d'après l'engagé, désactivées aux extrémités par les couleurs,
  `touch-action: manipulation`, 44 px au doigt, phrase du code
  `SEEDING_LOCKED_STARTED` et `SEEDING_LOCKED_FINISHED`, aucune flèche sur un
  tournoi terminé.
- `tests/lib/server/tournament-snapshot.test.ts` — `seedingSource` porté par
  l'instantané, `manual_seeding` compris.
- `tests/tournois/seeding-service.test.ts` — écriture des seeds, refus (tournoi
  lancé — par l'état ou par l'heure —, plateau présent, score saisi,
  tournoi terminé, permutation invalide, tournoi inconnu), verrous du
  tournoi et des matchs posés avant toute lecture.
- `tests/app/api/admin/seeding.test.ts` — permissions et codes d'erreur.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Ordre de seeding réordonnable** (`lib/shared/seeding.ts` pur + `lib/server/tournaments/seeding.ts`) : le staff `tournaments` ordonne les inscrites **aux flèches ↑ / ↓** (le glisser-déposer a été retiré : sur téléphone, il se déclenchait en voulant faire défiler la liste), **jusqu'au coup d'envoi** (`RUNNING` → `STARTED`, refus `SEEDING_LOCKED_STARTED`) et jamais après une saisie de score (`SCORES_ENTERED`, même règle que `match-lock`). `bg_tournaments.manual_seeding` bascule Survie / Suisse / BG Survie / Multi du seeding par classement de site vers l'ordre saisi ; l'élimination lisait déjà `registrations.seed`. Les commandes vivent **sur les lignes de la liste des inscrites** (`RegistrationsPanel.tsx`, bloc « Inscriptions · ordre de départ »). La fenêtre d'édition est **dérivée du détail déjà reçu** (le serveur reste le juge, 409 sur écriture tardive, verrous du tournoi puis des matchs en toute première instruction) et le clic déplace la ligne tout de suite, corrigé ensuite par le flux. `TournamentSnapshot.seedingSource` (`MANUAL` / `RANKING` / `REGISTRATION`, règle unique `seedingSource()` partagée avec l'aperçu du plateau) dit si la liste triée par `seed` **est** le tirage : en `RANKING`, **avant le coup d'envoi** (`isPreLaunchState`), l'instantané range lui-même les inscrites selon le classement du site. Voir `docs/features/SEEDING_ORDER.md`.
