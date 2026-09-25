# Cartes de la liste des tournois (`/tournois`)

Chaque tournoi de `/tournois` est rendu par une carte propre à son état
(`app/(secured)/tournois/cards/`). Ces cartes répétaient l'état du tournoi
jusqu'à quatre fois et annonçaient des faits faux ; elles disent désormais ce
qu'on vient y chercher.

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
(`app/(secured)/tournois/_lib/metrics.ts`) : le premier chiffre dit « Tournois
en cours », sans rien affirmer sur une diffusion, et la case « Invisibles ·
staff » n'apparaît que pour le staff — trois cases pour tout le monde, quatre
pour le staff, jamais un repli inventé.

Le ticker (`_lib/ticker.ts`) faisait le même genre d'annonce fausse : chaque
tournoi en cours donnait « RÉSULTAT · <nom> · N équipes engagées », alors
qu'aucun résultat n'y est porté — c'est `lib/server/landing-service.ts` qui
tient le vrai ticker de résultats, avec un score. La ligne dit maintenant
« EN COURS · … », comme le libellé de section juste en dessous, et se borne à
3 tournois comme les inscriptions ouvertes se bornent à 3 et les à venir à 2 —
un tournoi à 46 entrées `RUNNING` (le cas du jeu de test) ne monopolisait
sinon plus le bandeau.
