# Page Classement (`/classement`)

Page publique (vitrine, `PublicPageShell` : en-tête, `<main>`, pied de page en
frères) qui montre **tout** le classement des équipes. Elle remplace la cible
du lien « Voir le classement complet » du leaderboard de l'accueil, qui menait
à l'annuaire `/equipes` (retour du 2026-10-05 : « déroutant »).

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

- **Héros** : « Grimpe jusqu'au sommet. », halo froid animé.
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
- **Tableau complet** : rang, équipe (`TeamSigil` + `TeamLink`), cote, V, D,
  N (colonne présente seulement s'il existe un nul), forme (cinq derniers
  résultats, **général seulement** : la forme couvre tous les jeux), tendance
  sur 7 jours (même calcul que le leaderboard). Rôles ARIA de tableau ; en
  mobile (≤ 720 px), chaque ligne devient une carte et les cellules chiffrées
  portent leur intitulé par `data-label` (`RESPONSIVE_TABLES.md`). Pas de zone
  défilante interne : la page défile.
- **Comment marche la cote** : trois cartes dérivées des constantes
  (`RANKING_BASE_POINTS`, `RANKING_FLOOR_POINTS`), puis deux appels à
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

Trois boucles décoratives (halo du héros, halo de la 1re, couronne) :
`transform`/`opacity` seulement, toutes en
`animation-play-state: var(--deco-anim-state)` — en pause en mouvement réduit,
en régime économe et avant l'hydratation si la préférence système le demande
(`CLIENT_POWER_MODES.md`). Rien n'apparaît par animation : la page est
complète sans JavaScript.

## Liens

- Leaderboard de l'accueil : « Voir le classement complet » → `/classement`.
- Menu burger de la vitrine (`PUBLIC_NAV_LINKS`) : « Classement », après
  « Équipes ».
- Pied de page, COMPÉTITIONS : « Classement » → `/classement` (menait à
  `/joueurs`).
- Plan du site (`lib/shared/sitemap.ts`), quotidien.

## Fichiers

| Rôle | Fichier |
|---|---|
| Page (serveur, métadonnées) | `app/classement/page.tsx` |
| Podium + tableau | `app/classement/RankingBoard.tsx` |
| Styles | `app/classement/page.module.css` |
| Logique pure (filtre, écarts) | `lib/shared/ranking-page.ts` |
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
- `tests/lib/shared/ranking-page.test.ts` — filtre, adresses, écarts.
- `tests/app/ranking-board.test.tsx` — podium, couleurs de défaite, forme,
  colonne des nuls, filtres, panne, animations en pause, plancher 11 px.
