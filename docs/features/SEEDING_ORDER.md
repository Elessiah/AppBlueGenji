# Ordre de seeding réordonnable

Le **seeding** est l'ordre des équipes inscrites à un tournoi. Il décide des
appariements de la première manche dans tous les formats : haut de tableau
contre bas de tableau en élimination et en ronde suisse, couples adjacents en
survie, plateau initial en multi-phases.

Le staff (`can(user, "tournaments")`) le réordonne depuis la page du tournoi,
**au glisser-déposer** ou avec des flèches ↑ / ↓.

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

## Deux gestes pour un même ordre

Les flèches déplacent d'**un cran**, et chaque cran est une écriture : amener le
trentième rang en tête demandait vingt-neuf clics et vingt-neuf `PATCH`, chacun
régénérant le plateau du tournoi. D'où la **poignée de glissement** (`⠿`, en tête
de ligne) : un seul geste, un seul ordre écrit, quelle que soit la distance.

Les flèches **restent**, et pas par nostalgie : un glisser-déposer n'a aucun
équivalent au clavier. Les retirer priverait de l'ordre de départ qui ne tient
pas une souris. Les deux chemins écrivent par la même fonction (`applyOrder`),
donc avec le même aperçu optimiste, la même annonce vocale et le même refus.

La poignée est un `<span aria-hidden>`, **jamais un `<button>`** : un contrôle qui
prend le focus et ne répond ni à Entrée ni à l'espace est un piège, pas une
commande. Ce qu'elle offre au pointeur, les flèches l'offrent au clavier.

### Ce que le geste garantit

| Question | Réponse | Pourquoi |
| --- | --- | --- |
| Où atterrit la ligne ? | `dropIndexAt` — l'ordonnée du pointeur contre les **milieux d'emplacement** | relevés **une fois**, au premier appui : les emplacements ne bougent pas pendant le geste, seul leur contenu permute. Les relire à chaque mouvement ferait osciller la cible entre deux rangs |
| Que devient la liste ? | `moveToIndex` — **extraction puis insertion** | tirer le rang 30 sur le rang 1 décale les autres d'un cran ; un échange expédierait le rang 1 en trentième place, ce que personne ne demande |
| Comment atteindre un rang hors écran ? | `autoScrollVelocity` — la page défile aux **bords** de la fenêtre | sans quoi le geste ne porterait que sur ce qui tient à l'écran, et trente engagés n'y tiennent pas. Vitesse **linéaire** avec l'enfoncement dans la bande, en pixels par **seconde** : le geste se comporte pareil à 60 Hz et à 144 Hz |
| Comment renoncer ? | Échap, ou un `pointercancel` | un glissement sans annulation oblige à relâcher quelque part, donc à écrire un ordre dont on ne veut pas |

Deux refus, pour deux gestes qui ne peuvent pas aboutir :

- le rang d'accueil vit dans la **session du geste**, pas dans un miroir de
  `useState`. La mise à jour naît d'un `pointermove`, donc de priorité continue :
  React la planifie sans la commiter dans la tâche courante, et le `pointerup`
  d'un geste vif arrive avant ce rendu. Un miroir y vaudrait `null` — le geste
  avalé en silence — ou le rang du geste *précédent*, soit un ordre que personne
  n'a demandé. L'état React reste, mais pour l'affichage seul ;
- un geste dont la **liste a changé sous lui** est abandonné. Le flux SSE tient
  la page à jour, et le moment où l'on réordonne est précisément celui où les
  inscriptions sont ouvertes : l'ordre construit sur l'ancienne liste n'est plus
  une permutation, et le serveur le refuserait au nom d'une faute que personne
  n'a commise. Le contrôle est celui du serveur, mot pour mot
  (`isValidSeedOrder`) — en écrire un second ici donnerait deux définitions du
  refus.

Deux points de mise en œuvre qui ne se devinent pas :

- les géométries sont relevées en coordonnées **page** (`clientY + scrollY`), pas
  fenêtre : le défilement automatique déplacerait sinon la cible sous un pointeur
  immobile ;
- `touch-action: none` sur la poignée n'est pas décoratif — sans lui, le
  navigateur prend le premier mouvement du doigt pour un défilement et confisque
  la suite des évènements pointeur : le geste ne marcherait qu'à la souris. C'est
  aussi la raison des `PointerEvent` plutôt que de l'API HTML5 de glisser-déposer,
  qui n'existe pas sur mobile.

**Aucune écriture avant le relâchement.** Le geste ne produit qu'un aperçu ; un
`PATCH` par ligne survolée écrirait des dizaines d'ordres intermédiaires.

## Ce que la liste montre — et ce que le moteur jouera

`TournamentSnapshot.seedingSource` dit d'où vient l'ordre effectif :
`MANUAL`, `RANKING` ou `REGISTRATION` (règle dans `seedingSource()`,
`lib/shared/seeding.ts` — la même que celle de l'aperçu du plateau).

En `RANKING`, la liste triée par `seed` **n'est pas** le tirage : le moteur
seedera depuis le classement du site tant que personne n'a réordonné. Le bloc le
dit alors explicitement, à côté des flèches qui permettent d'y remédier — sans
quoi le staff lit un ordre d'inscription en croyant lire un tirage.

## Fenêtre d'édition

L'ordre reste modifiable **jusqu'à la première saisie de score**, ce qui couvre
la demande « ordonner avant que le tournoi soit visible pour les joueurs » : dès
la création, avant l'ouverture des inscriptions, pendant celles-ci, et même
après le lancement tant que personne n'a reporté de score.

Le verrou réutilise `hasScoreInput` de `lib/shared/match-lock.ts` : compte comme
saisie un score (même 0), un vainqueur, un forfait ou un report en attente. Les
byes et matchs fantômes sont ignorés — leur score est posé par le moteur.

Deux raisons de verrouillage, exposées à l'interface :

| `lockReason` | Sens |
| --- | --- |
| `null` | encore modifiable |
| `SCORES_ENTERED` | au moins un match porte une saisie |
| `FINISHED` | tournoi terminé |

## Qui lit l'ordre

`bg_tournament_registrations.seed` est la source de vérité. Le drapeau
`bg_tournaments.manual_seeding` arbitre le comportement par défaut :

| Format | `manual_seeding = 0` (défaut) | `manual_seeding = 1` |
| --- | --- | --- |
| `SINGLE` / `DOUBLE` | ordre des seeds (déjà le cas avant) | idem |
| `SWISS` | classement du site (`lib/shared/ranking.ts`) | ordre des seeds |
| `SURVIVAL` | classement du site | ordre des seeds |
| `BG_SURVIE` | ordre des seeds (toujours) | ordre des seeds |
| `MULTI` (phase 1) | classement du site | ordre des seeds |

Tant que personne n'a réordonné, chaque format garde donc exactement le
comportement qu'il avait.

## Reconstruction du plateau

Si des matchs ont déjà été générés (tournoi lancé mais vierge de scores), ils
décrivent l'ancien ordre : `reorderSeeding` les supprime, remet les rangs à zéro
et réamorce le format.

- `SINGLE` / `DOUBLE` : `bracket_size` repasse à `NULL`, et l'entretien de
  `syncTournamentState` régénère le plateau.
- `SWISS` / `SURVIVAL` / `BG_SURVIE` / `MULTI` : réinitialisation explicite
  (leur amorçage n'a lieu qu'à la transition REGISTRATION → RUNNING, déjà
  passée). Pour `MULTI`, l'état des phases est d'abord purgé — équipes de phase,
  états, compteurs et `current_phase_id` — sans quoi `startPhase` serait rejoué
  sur une phase déjà marquée RUNNING avec un plateau mélangé.

## Surfaces

| Élément | Emplacement |
| --- | --- |
| Logique pure | `lib/shared/seeding.ts` |
| Mécanique du geste (pure) | `lib/shared/drag-reorder.ts` |
| Orchestration | `lib/server/tournaments/seeding.ts` |
| API | `GET` / `PATCH /api/admin/tournaments/[id]/seeding` |
| Interface | `app/(secured)/tournois/[id]/_components/RegistrationsPanel.tsx` |
| Geste (DOM) | `app/(secured)/tournois/[id]/_hooks/useSeedingDrag.ts` |

`GET` sert l'ordre courant et la fenêtre d'édition côté serveur ; l'interface,
elle, dérive la fenêtre du détail déjà reçu et n'appelle que `PATCH`.

`PATCH` attend `{ teamIds: number[] }` — la liste **complète** des inscrites dans
le nouvel ordre. Toute liste qui n'est pas une permutation exacte est refusée
(`INVALID_SEED_ORDER`, 400) : sans ce contrôle, un réordonnancement pourrait
faire disparaître une équipe du tournoi. Ordre figé → `SEEDING_LOCKED` (409).

## Tests

- `tests/lib/shared/seeding.test.ts` — verrou, déplacement, validation d'ordre,
  provenance de l'ordre (`seedingSource`, `isSeedOrderEffective`).
- `tests/lib/shared/drag-reorder.test.ts` — rang d'accueil, extraction/insertion,
  défilement automatique (bandes, continuité, plafond, fenêtre trop courte).
- `tests/app/seeding-drag-handle.test.ts` — la poignée suit la fenêtre d'édition,
  les flèches survivent, la poignée n'est pas focusable, `touch-action` posé, et
  aucune écriture pendant le geste.
- `tests/lib/server/tournament-snapshot.test.ts` — `seedingSource` porté par
  l'instantané, `manual_seeding` compris.
- `tests/tournois/seeding-service.test.ts` — écriture des seeds, reconstruction
  du plateau, refus (verrou, permutation invalide, tournoi inconnu).
- `tests/app/api/admin/seeding.test.ts` — permissions et codes d'erreur.
