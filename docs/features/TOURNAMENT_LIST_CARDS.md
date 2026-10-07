# Cartes de la liste des tournois (`/tournois`)

Chaque tournoi de `/tournois` est rendu par une carte propre à son état
(`app/(secured)/tournois/cards/`). Ces cartes répétaient l'état du tournoi
jusqu'à quatre fois et annonçaient des faits faux ; elles disent désormais ce
qu'on vient y chercher.

Les quatre cartes partagent leur cadre par `cards/CardParts.tsx` :
`TournamentCardFrame` (plaque de lien, bandeau, ruban, jeu et format, emblème,
titre, description), `CardMetaItem` (une case d'informations), `CardProgress`
(la jauge) et `LiveRibbon` (pastille + libellé). Chaque carte ne garde que ce
qu'elle dit de son état ; leur rendu est figé par
`tests/app/tournament-list-cards-render.test.tsx`.

## Ce que dit chaque carte

| État | Ruban | Fait du pied | Action |
| --- | --- | --- | --- |
| En cours | « En cours », **bleu** | Déroulement (%) | « Voir le bracket » / « Voir le classement » / « Voir le tournoi » selon le format |
| Inscriptions | « Inscriptions ouvertes » | Remplissage, ou **« Complet »** | « Voir le tournoi » (atténué sur un plateau plein) |
| À venir, inscriptions pas ouvertes | « À venir » | « Inscriptions bientôt » | « Détails » |
| À venir, inscriptions **closes** | « Inscriptions closes » | « En attente du coup d'envoi » | « Détails » |
| Terminé | « Terminé · *date de clôture* » | **Vainqueur** | « Voir les résultats » |

- **Format** : `FORMAT_LABELS` (`lib/shared/tournament-labels.ts`), la table de
  la fiche. Les cartes calculaient `DOUBLE ? … : "Élimination simple"`, si bien
  qu'une ronde suisse, une survie, un multi-phases ou une BG Survie
  s'annonçaient « Élimination simple », deux fois par carte. Le format n'est
  plus écrit qu'une fois (ligne jeu ◆ format) ; la case qui le répétait montre
  le **format des matchs** (`matchFormatLabel` : « BO5 », « Score libre »).
- **Sous-titre** : la description du tournoi, et rien quand il n'en a pas —
  la carte « en cours » la remplaçait par « En cours ».
- **Rouge** : réservé à ce qui est réellement à l'antenne. Un tournoi en cours
  n'est pas une diffusion, sa carte est bleue.
- **« S'inscrire »** a disparu : la liste ne connaît pas le lecteur (déjà
  inscrit, sans équipe, sans rôle de gestion…), c'est la fiche qui tranche
  (`registerBlockedNotice`). Un plateau plein, lui, se lit sur la carte — c'est
  le seul refus qui ne dépend de personne.
- **Terminé** : la carte se ternit par ses couleurs (fond plat, illustration
  désaturée) et non plus par `opacity: 0.65`, qui faisait passer les textes
  atténués sous 4,5:1.

La logique d'affichage est pure, dans `app/(secured)/tournois/_lib/card-display.ts`
(`runningCardAction`, `upcomingCardFace`, `registrationFill`, `progressPercent`,
`formatCardDate`).

## Langues

Textes des cartes, du sommaire et du bandeau dans l'espace `tournaments` (lot 8a-1) : `useTournamentsText()`, français hors fournisseur. Dates : « 07 oct. 2026 » en français, « Oct 7, 2026 » en anglais (jour sans zéro initial). Le lien d'une carte vers la fiche (encore française, lot 8a-2) et « Créer un tournoi » (lot 8b) portent `hrefLang="fr"` sous `/en`. Détail : `I18N.md` § Tournois — liste.

## Couleurs d'état

Un état a **une seule teinte**, posée par `--tone` / `--tone-rgb` sur la carte
(`data-state`), la section (`Section tone`) et son lien du sommaire
(`data-tone`) — variantes sémantiques de `DESIGN_SYSTEM.md`, les mêmes que
l'en-tête de la fiche (`STATE_META`) :

| Carte (`data-state`) | Section | Variante | Texte |
| --- | --- | --- | --- |
| `running` | `running` | `info` | `--blue-300` |
| `open` | `registration` | `highlight` | `--pink-400` |
| `soon` | `upcoming` | `accent` | `--violet-300` |
| `done` | `finished` | `success` | `--teal-400` |

La teinte habille le ruban (texte, liseré, voile), les repères de coin,
l'index et le dégradé de l'en-tête de section, le compte du sommaire, l'éclat
du coin haut droit (sauf « terminé », qui garde son fond plat) et le **halo au
survol** — liseré et ombre colorée, sans déplacement (une translation faisait
clignoter la carte sous un pointeur posé sur son bord), sous
`(hover: hover) and (pointer: fine)` seulement. Le point du ruban « en cours »
et « inscriptions ouvertes » pulse au régime de charge
(`var(--deco-anim-state)`). Jauge, mot fort du titre et index de « Mes
tournois » prennent le dégradé de marque. Jamais de rouge (un tournoi en cours
n'est pas une diffusion) ; l'ambre des avertissements (« Complet », clôture)
reste en attente de décision (`LANDING_ANIMATIONS.md` § Lots suivants, lot 5).
Contrastes : `tests/app/neon-palette.test.ts`.

## Nom accessible de la carte

Chaque carte enveloppait tout son texte — ruban, méta, pied — dans un `<a>`
unique : un nom accessible de 170 à 240 caractères pour un contrôle qui ne dit
qu'une chose, « ouvrir ce tournoi ». Le lien est désormais une plaque
transparente posée sur la carte (`.cardOverlay`, même mécanique que les
annuaires d'équipes et de joueurs) : `aria-label="Voir le tournoi <nom>"`, sans
texte propre, au-dessus des enfants décoratifs de la carte (`.card::before` /
`::after`, `z-index: 1`, `pointer-events: none` — leur ordre de peinture avec
la plaque n'a aucune conséquence, ils n'interceptent jamais le clic). Les
quatre cartes (`RunningCard`, `RegistrationCard`, `UpcomingCard`,
`FinishedCard`) suivent le même schéma : un `<article className={s.card}>`
qui n'est plus lui-même un lien, une seule `<Link className={s.cardOverlay}>`
posée en premier enfant.

**Corollaire : aucun `title` sous la plaque.** Elle recouvre toute la carte, la
souris n'atteint donc plus aucun de ses enfants et une infobulle native ne s'y
déclenche jamais. Le nom du vainqueur, coupé en ellipse au-delà d'une ligne, se
lisait entier par un `title` devenu inatteignable : il se **déplie** désormais
au survol de la carte et au focus de son lien (`.card:hover .cardChampion`,
`.card:focus-within .cardChampion` — clavier compris), le pied poussé en bas
absorbant la ligne gagnée dans l'espace libre de la carte. Le texte complet est
dans le DOM, les lecteurs d'écran le lisent sans rien faire. Même règle sur la
carte d'annuaire d'équipe (`TeamCard.tsx`) : la légende des points (voir
`ELO_RANKING.md`) et le sens de lecture de la barre de forme, désormais écrit
au-dessus d'elle (« Forme · récent → ancien ») et repris dans son `aria-label`.

**Les cartes sont les items de la grille.** La section « Terminés » les
enveloppait dans un `<div>` nu : les douze cartes s'empilaient dans une seule
cellule de `.sectionBody`, et `.card { height: 100% }` — posé pour aligner les
cartes d'une même rangée — étirait chacune à la hauteur de toute la pile
(4 581 px mesurés pour ~230 px de contenu). Elles sont désormais rendues
directement, comme dans les trois autres sections.

## Trois champs de `TournamentCard`

- `finishedAt` — `bg_tournaments.finished_at`, rendu par `mapCard`. Une carte
  d'un tournoi clos avant que la colonne soit remplie retombe sur `startAt`.
- `champion` — l'**unique** engagé classé premier (`pickChampion`,
  `lib/shared/tournament-card-summary.ts`) ; `null` hors `FINISHED`, et quand le
  classement n'en désigne pas un seul (finale en double forfait, ex æquo).
- `runningProgress` — l'avancement interne d'un tournoi en cours, de 0 à 1 :
  **la mesure de `computeRunningRatio`**, celle de la frise de la fiche. `null`
  hors `RUNNING`, ou quand rien ne permet de le situer.

Deux producteurs, une règle :

- **La liste** (`lib/server/tournaments/list-summary.ts`) les lit **par
  lots** — quelques requêtes pour toute la liste, jamais une par carte — et ne
  lit les matchs que **comptés par manche** (`COUNT` / `SUM`), que
  `runningProgressFrom` redéroule avant de les confier à `computeRunningRatio`.
  Survie et BG Survie ne lisent pas leurs matchs : elles se mesurent à leurs
  éliminations. Ces lectures sont décoratives : leur échec est journalisé et
  les cartes gardent leurs `null`, la liste n'est jamais vidée pour elles.
- **L'instantané de la fiche** (`snapshot.ts`) les calcule sur les lignes qu'il
  a déjà chargées, par les mêmes fonctions : la carte dit la même chose dans la
  liste et dans la fiche.

**Fraîcheur** : la liste est en cache 15 s et un score ne la vide pas, par
choix (`notifications.ts` — les scores tombent en rafales). Le déroulement d'une
carte peut donc retarder d'au plus 15 s sur la fiche ; de même le vainqueur
après une correction de la finale d'un tournoi déjà clos (sa clôture, elle,
change l'état et vide la liste).

## Bandeau de chiffres et ticker

Le haut de `/tournois` annonçait deux faits inventés. Le premier chiffre
disait « N EN DIRECT · Diffusés sur Twitch » en comptant les tournois
`RUNNING` : aucune chaîne n'y est vérifiée, et Twitch n'est qu'une des trois
plateformes acceptées (`lib/shared/live-streams.ts`). Le dernier chiffre
affichait « — / Prizepool · à venir » à tout visiteur non-staff — un
emplacement réservé pour une fonctionnalité qui n'existe pas. Le bandeau se
construit désormais par `tournamentsPageMetrics`
(`app/(secured)/tournois/_lib/metrics.ts`, retiré depuis avec le bandeau) : le premier chiffre dit « Tournois
en cours », sans rien affirmer sur une diffusion, et la case « Invisibles ·
staff » n'apparaît que pour le staff — trois cases pour tout le monde, quatre
pour le staff, jamais un repli inventé.

> Ce bandeau a depuis été remplacé par le **sommaire** des sections, qui porte
> les mêmes comptes mais mène à chaque section — voir
> `docs/features/MY_TOURNAMENTS_SECTION.md`.

Le ticker (`_lib/ticker.ts`) faisait le même genre d'annonce fausse : chaque
tournoi en cours donnait « RÉSULTAT · <nom> · N équipes engagées », alors
qu'aucun résultat n'y est porté — c'est `lib/server/landing-service.ts` qui
tient le vrai ticker de résultats, avec un score. La ligne dit maintenant
« EN COURS · … », comme le libellé de section juste en dessous, et se borne à
3 tournois comme les inscriptions ouvertes se bornent à 3 et les à venir à 2 —
un tournoi à 46 entrées `RUNNING` (le cas du jeu de test) ne monopolisait
sinon plus le bandeau.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Cartes de la liste des tournois** (`app/(secured)/tournois/cards/` + `_lib/card-display.ts` pur + `lib/shared/tournament-card-summary.ts` + `lib/server/tournaments/list-summary.ts`) : les cartes de `/tournois` répétaient l'état jusqu'à quatre fois et annonçaient tout ce qui n'était pas `DOUBLE` comme une « Élimination simple ». Le format passe par `FORMAT_LABELS` et ne s'écrit qu'une fois (la case qui le doublait montre le format des matchs) ; la carte « en cours » est **bleue** (le rouge est à l'antenne) et dit son **déroulement**, son action suit la famille de format ; « S'inscrire » a disparu des cartes d'inscription — la liste ne connaît pas le lecteur — au profit de « Voir le tournoi » et d'un **« Complet »** lisible ; un tournoi `UPCOMING` aux inscriptions **closes** a son propre visage (`upcomingCardFace`, par la règle de la frise) ; la carte « terminé » est datée de sa **clôture**, nomme le **vainqueur** et se ternit par ses couleurs, jamais par une opacité. Trois champs de `TournamentCard` les portent : `finishedAt`, `champion` (l'**unique** premier, `pickChampion`) et `runningProgress` (la mesure de `computeRunningRatio`, celle de la fiche). La liste les lit **par lots**, matchs **comptés par manche** et non lus ligne à ligne, et une panne de ces lectures ne vide jamais la liste ; l'instantané les calcule sur ses propres lignes, par les mêmes fonctions. La liste n'étant pas vidée par un score, le déroulement d'une carte peut retarder de 15 s. Une carte n'est plus, elle-même, un `<a>` géant (nom accessible de 170 à 240 caractères, tout le texte de la carte concaténé) : le lien est une plaque transparente (`.cardOverlay`, même mécanique que les annuaires) limitée à « Voir le tournoi *nom* ». Voir `docs/features/TOURNAMENT_LIST_CARDS.md`.
