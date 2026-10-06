# Page Classement (`/classement`)

Page publique (`SessionPageShell` : en-tête, `<main>`, pied de page en
frères) qui montre **tout** le classement des équipes. Elle remplace la cible
du lien « Voir le classement complet » du leaderboard de l'accueil, qui menait
à l'annuaire `/equipes` (retour du 2026-10-05 : « déroutant »).

## En-tête selon la session

`/classement` est aussi listé par la barre des connectés (`ARENA_NAV_LINKS`).
La page passe donc par **`SessionPageShell`**
(`components/cyber/landing/SessionPageShell.tsx`) : déconnecté — robots
d'indexation compris —, l'en-tête et le pied vitrine (`PublicPageShell`) ;
connecté, le gabarit de l'espace `(secured)` (**`ArenaShell`**,
`components/arena-shell.tsx` : `ArenaNav`, `<main>`, `SiteFooterBar`), lien
« Classement » en `aria-current="page"`. Le choix se fait au serveur
(`getCurrentUser`, mémoïsé par requête et déjà lu par le layout racine) : ni
flash, ni requête côté client ; un connecté coûte au serveur la lecture de son
équipe active (et du compteur de signalements pour la modération), chacune
avec son repli. Une session illisible retombe sur la vitrine. La
page était déjà `force-dynamic` : lire le cookie ne change pas son mode de
rendu. Le `<main>` garde le style vitrine dans les deux cas (contenu, SEO,
repères uniques, lien d'évitement et pagination sans JS inchangés). Tests :
`tests/app/session-page-shell.test.tsx`.

## Ordre du classement

Une seule règle, `compareRankedTeams` (`lib/shared/ranking.ts`), pour toutes
les vues — leaderboard de l'accueil, `/classement`, annuaire `/equipes` **et**
seeding des tournois à classement :

1. **cote** décroissante — strictement, bilan vide compris ;
2. à cote égale, **victoires** décroissantes ;
3. puis **défaites** croissantes ;
4. puis **nuls** décroissants (plus de matchs joués d'abord) ;
5. enfin le **nom** (`localeCompare("fr")`).

Une équipe sans match vaut la cote de départ (500) et se range **à cette
cote** : derrière toute équipe qui a gagné des points, devant toute équipe qui
en a perdu.

**Pourquoi.** La règle précédente rangeait les équipes « classées » (au moins
un match) devant toutes les autres, quelle que soit leur cote. Avec un seul
match joué sur le site, la perdante (483) passait **deuxième**, devant toutes
les équipes restées à 500. L'utilisatrice a choisi de corriger l'ordre plutôt
que de masquer les équipes sans match.

`isRankedTeam` reste, mais ne décide plus de l'ordre : il choisit la légende
de la cote (« Aucun match joué ») et si la fiche d'équipe affiche une place.

**Place sur la fiche** (`getTeamRankingPosition`) : comptée sur la même liste
que `/classement` (toutes les équipes, celles sans match à 500), « #n sur N
équipes » — sinon la perdante à 483 lirait « 2ᵉ sur 2 » sur sa fiche et 40ᵉ
sur la page. La place est l'index dans cette liste triée : à cote égale, les
départages ci-dessus tranchent, comme sur la page.

### Effet sur le seeding

- **Tournois lancés** : aucun. Leurs rangs sont figés au coup d'envoi dans les
  tables d'état (`bg_*_standings`, `bg_tournament_phase_teams`) et relus tels
  quels (`SEEDING_ORDER.md`).
- **Ordre réordonné à la main par le staff** : aucun, il est figé.
- **Tournois à venir** (ordre encore lu sur le classement) : une inscrite sans
  match est désormais seedée à 500, donc **devant** une inscrite descendue sous
  500, et derrière une inscrite au-dessus. L'aperçu du plateau et la liste des
  inscrites suivent, par le même comparateur.

## Contenu

- **Héros** : titre « Grimpe jusqu'au sommet. » et sous-titre, halo froid
  animé. Titre et sous-titre sont des **textes éditables** (depuis le
  2026-10-06) : clés `ranking.hero.title` / `ranking.hero.lede` du registre
  `site-copy.ts`, modifiables en place par la permission `showcase` avec
  `<EditableCopy>` — même mécanisme, mêmes limites et mêmes codes d'erreur que
  l'accueil (`EDITABLE_SITE_COPY.md`). Un retour à la ligne du titre devient
  `<br />`, la dernière ligne en dégradé ; le `<h1 id="classement-title">` et
  le `aria-labelledby` de la section restent. Les **métadonnées restent
  figées** (« Classement des équipes »), comme sur l'accueil et la page
  association : le titre éditable est une accroche, pas le nom de la page.
  Français seulement pour l'instant ; le lot 2 de l'i18n rend ces deux clés
  bilingues (`I18N_MIGRATION_PLAN.md`).
- **Pastilles de jeu** — Général / Overwatch / Marvel Rivals — en **liens**
  (`?jeu=ow|mr`, `aria-current="page"`), pas en état client : la page est
  rendue côté serveur, partageable et lisible sans JavaScript. Toute autre
  valeur rend le général (`parseRankingFilter`). Un onglet par jeu ne garde
  que les équipes qui ont joué ce jeu (même règle que le leaderboard,
  `loadLeaderboardRows`).
- **Podium** (dès trois lignes) : `<ol aria-label="Podium">`, ordre visuel
  2-1-3 en bureau (CSS `order`), 1-2-3 en mobile. Chaque marche : numéro,
  sigle/logo, nom (`TeamLink`), cote, bilan, et l'écart à la tête
  (`podiumGapText`) — de quoi donner envie de monter.
- **Tableau** : rang, équipe (`TeamSigil` + `TeamLink`), cote, V, D,
  N (colonne présente seulement s'il existe un nul), forme (cinq derniers
  résultats, **général seulement** : la forme couvre tous les jeux), tendance
  sur 7 jours (même calcul que le leaderboard). Rôles ARIA de tableau ; en
  mobile (≤ 720 px), chaque ligne devient une carte et les cellules chiffrées
  portent leur intitulé par `data-label` (`RESPONSIVE_TABLES.md`). Pas de zone
  défilante interne : la page défile.
- **Pas de doublon** (depuis le 2026-10-06) : dès qu'il y a un podium, le
  tableau **commence à la 4e place** (`splitRankingPodium`) ; son libellé
  accessible le dit (« … à partir de la 4e place »). La forme et la tendance
  des trois premières, qui vivaient dans leurs lignes du tableau, passent sur
  leur marche. Moins de trois équipes : pas de podium, tout au tableau ;
  exactement trois : le podium seul, sans tableau.
- **Affichage progressif** : `?n=` compte des **rangs**, podium compris — la
  première page montre les rangs 1 à 50 (podium 1-3 + tableau 4-50,
  `RANKING_PAGE_SIZE`), puis « Afficher plus » ajoute les 50 suivantes (51-100).
  C'est un **lien** (`?n=100#rang-51`, onglet `jeu` conservé) : sans
  JavaScript, la page se rend côté serveur avec `n` lignes et descend sur la
  première ajoutée (chaque ligne porte `id="rang-<rang>"`). Avec JavaScript
  (`RankingMore`, client), le clic devient une navigation côté client
  (`router.push(…, { scroll: false })`, sans rechargement), le focus va à la
  première ligne ajoutée (`tabIndex={-1}`) et une région `<output>` (rôle `status`),
  toujours présente, annonce « 50 équipes ajoutées. » (« … Fin du
  classement. » à la dernière page). Au plafond, s'il reste des équipes, le
  lien laisse place à « Affichage limité aux 1000 premières équipes. », à
  l'écran comme dans l'annonce — jamais un faux « Fin du classement ». `?n=` est validé côté serveur
  (`parseRankingShown`) : entier seulement, arrondi à la page supérieure,
  borné à [50, 1000] (`RANKING_MAX_SHOWN`) ; toute autre valeur rend la
  première page. Changer d'onglet repart de la première page. Le canonique
  reste `/classement` (métadonnées inchangées).
- **Rangs absolus, coût de lecture.** Le rang dépend de l'ordre complet
  (rejeu de toute l'histoire des matchs puis tri `compareRankedTeams`, avec
  départage par nom fait en JavaScript) : il ne peut pas se couper en SQL.
  `loadLeaderboardRows(game)` rejoue (sous `ranking-cache`) et trie donc
  toutes les équipes ; la page en tire « il en reste » et la présence d'un
  nul (colonne « N » stable d'une page à l'autre, `anyDraws`), puis ne rend
  que les `n` premières : le rendu et le poids de la page sont bornés, et le
  rang reste celui du classement complet.
- **Comment marche la cote** : quatre cartes dérivées des constantes
  (`RANKING_BASE_POINTS`, `RANKING_FLOOR_POINTS`, `RANKING_MARGIN_MAX_BONUS`
  pour le poids du score — `ELO_RANKING.md`), puis deux appels à
  l'action (`/tournois`, `/regles`).
- Panne de lecture : message « momentanément indisponible », distinct de la
  liste vide.

## Couleurs

Palette froide seulement (`DESIGN_SYSTEM.md`) :

| Place | Traitement |
|---|---|
| 1re | bordure et numéro au **dégradé de marque** (`--grad-brand`), couronne cyan (Lucide `Crown`), halo cyan/violet qui respire |
| 2e | `--cyan-400` |
| 3e | `--violet-300` / `--violet-400` |

### Noms du podium (depuis le 2026-10-06)

Le nom de chaque équipe du podium porte un effet propre à sa marche, du plus
riche au plus sobre (`PODIUM_NAME_TIERS` → `.nameTier1/2/3` sur le `<h3>`) :

| Place | Effet du nom |
|---|---|
| 1re | dégradé **irisé** cyan → glacier → violet → rose traversé d'un reflet clair (`--ink`), qui ondule (7 s, `background-position`) ; halo violet large et léger (`drop-shadow` 12 px, 0,3 — un halo serré ferait tomber le contraste au bord des lettres) ; filet irisé de 64 px sous le nom |
| 2e | **givre chromé** (`--ink-soft` → `--blue-100` → `--ink` → `--blue-300`), reflet plus lent (11 s), halo cyan léger, filet givré de 36 px |
| 3e | **liseré néon** : `--violet-300` plein, `text-shadow` violet ; ni mouvement ni filet |

- Aucun or ni bronze : l'ambre reste réservé aux avertissements
  (`DESIGN_SYSTEM.md`) ; le prestige passe par l'irisé et le givre.
- Chaque arrêt de dégradé est un jeton de texte qui tient **4,5:1** sur le fond
  le plus clair du site (vérifié par le test).
- Le nom reste du **vrai texte** dans son `TeamLink` (dégradé par
  `background-clip: text`), nom accessible inchangé ; au survol ou au focus il
  reprend une couleur pleine (`--blue-100`) et son soulignement.
- À l'arrêt (mouvement réduit, menu d'accessibilité, régime économe), chaque
  marche garde sa peinture : la hiérarchie se lit sans animation.
- Le podium ne montre **aucun nom de joueur** : rien à décorer de ce côté.
  Hors podium (tableau, autres pages), aucun effet.

Les trois premières lignes du tableau reprennent la couleur de leur marche en
liseré. Défaites : `--result-loss-ink` (`.result-loss`) **seulement si le
compte est non nul** — zéro défaite reste neutre (`--ink-dim`) ; même règle
corrigée sur le leaderboard de l'accueil. La forme : victoire glacier, défaite
`--result-loss`, nul neutre, chaque case portant sa lettre (V/D/N) et la bande
entière un nom accessible épelé.

L'annuaire `/equipes` garde son marqueur rose commun aux trois premières
cartes (`TeamCard .rankTop`) : c'est un repère « top 3 » dans une grille de
cartes, pas un podium à trois marches ; la page Classement distingue chaque
marche.

## Animations

Cinq boucles décoratives (halo du héros, halo de la 1re, couronne, reflet des
noms de la 1re et de la 2e) : `transform`/`opacity` seulement — sauf le reflet
des noms, qui ne déplace que `background-position` (aucune mise en page) —,
toutes en
`animation-play-state: var(--deco-anim-state)` — en pause en mouvement réduit,
en régime économe et avant l'hydratation si la préférence système le demande
(`CLIENT_POWER_MODES.md`). Rien n'apparaît par animation : la page est
complète sans JavaScript.

## Liens

- Leaderboard de l'accueil : « Voir le classement complet » → `/classement`.
- Menu burger de la vitrine (`PUBLIC_NAV_LINKS`) : « Classement », après
  « Équipes ».
- Barre de navigation des connectés (`ARENA_NAV_LINKS`,
  `components/arena-nav.tsx`) : « Classement », après « Tournois », teinte
  rose (`--pink-400-rgb`) — voir `PUBLIC_NAVIGATION.md`.
- Pied de page, COMPÉTITIONS : « Classement » → `/classement` (menait à
  `/joueurs`).
- Plan du site (`lib/shared/sitemap.ts`), quotidien.

## Fichiers

| Rôle | Fichier |
|---|---|
| Page (serveur, métadonnées) | `app/classement/page.tsx` |
| Titre et sous-titre éditables | `lib/shared/site-copy.ts` (`ranking.hero.*`) |
| Podium + tableau | `app/classement/RankingBoard.tsx` |
| « Afficher plus » (client) | `app/classement/RankingMore.tsx` |
| Styles | `app/classement/page.module.css` |
| Logique pure (filtre, `?n=`, écarts) | `lib/shared/ranking-page.ts` |
| Lignes (cote, bilan, tendance) | `loadLeaderboardRows` (`lib/server/landing-service.ts`) |
| Forme | `loadCachedTeamForms` (`lib/server/teams/directory.ts`) |
| Ordre | `compareRankedTeams` (`lib/shared/ranking.ts`) |

## Tests

- `tests/lib/shared/ranking.test.ts` — ordre : cote stricte, sans match à sa
  cote, départages.
- `tests/lib/server/landing-leaderboard.test.ts` — scénario exact du retour
  (un match, perdante derrière toutes les équipes à 500).
- `tests/lib/server/ranking-service.test.ts` — liste et seeding avec le même
  ordre.
- `tests/lib/shared/ranking-page.test.ts` — filtre, adresses, écarts,
  lecture et bornes de `?n=`, lien de page suivante (onglet gardé, ancre).
- `tests/app/ranking-board.test.tsx` — podium, couleurs de défaite, forme,
  colonne des nuls, filtres, panne, animations en pause, plancher 11 px ;
  lien « Afficher plus » sans JavaScript, région d'annonce, rangs absolus et
  ancres focalisables d'une page suivante ; effet de nom par marche (classe,
  absence hors podium, contraste des arrêts, hiérarchie du mouvement).
- `tests/app/classement-page-copy.test.tsx` — en-tête éditable : défauts,
  textes édités (échappés), crayons réservés à `showcase`, `<h1>` unique,
  métadonnées figées.
