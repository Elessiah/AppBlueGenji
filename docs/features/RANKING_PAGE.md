# Page Classement (`/classement`)

Page publique (`SessionPageShell` : en-tête, `<main>`, pied de page en
frères) qui montre **tout** le classement des équipes. Elle remplace la cible
du lien « Voir le classement complet » du leaderboard de l'accueil, qui menait
à l'annuaire `/equipes` (retour du 2026-10-05 : « déroutant »).

## En-tête selon la session

`/classement` est aussi listé par la barre des connectés (`SITE_NAV_LINKS`).
La page passe donc par **`SessionPageShell`**
(`components/cyber/landing/SessionPageShell.tsx`) : déconnecté — robots
d'indexation compris —, l'en-tête et le pied vitrine (`PublicPageShell`) ;
connecté, le gabarit de l'espace `(secured)` (**`SiteShell`**,
`components/site-shell.tsx` : `SiteNav`, `<main>`, `SiteFooterBar`), lien
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

**Pourquoi la cote stricte.** La règle précédente rangeait les équipes
« classées » (au moins un match) devant toutes les autres, quelle que soit leur
cote. Avec un seul match joué sur le site, la perdante (483) passait
**deuxième**, devant toutes les équipes restées à 500. L'ordre a d'abord été
corrigé (2026-10-05) ; depuis le 2026-10-26, les équipes sans match sont en
outre **masquées** (ci-dessous), ce qui règle le cas à la racine.

### Équipes sans match (masquées depuis le 2026-10-26)

Demande du 2026-10-13 : une équipe qui n'a disputé **aucun match compté** ne
figure ni à `/classement` ni dans rien de ce qui en dérive.

**La règle.** « Avoir joué » = au moins une rencontre de l'assiette du rejeu
(`playedMatchSql`) : terminée, non-bye, entre deux équipes réelles, avec un
vainqueur — **forfait compris**, le rejeu le compte — ou nulle. Un bye, un
match contre soi-même ou un classement final sans rencontre (points de
parcours seuls) ne classent pas. C'est `isRankedTeam` (`lib/shared/ranking.ts`),
**filtre unique**, posé une fois dans `loadTeamRanking` : l'option
`includeUnplayed` qui permettait de réintroduire ces équipes a disparu.

**Ce qui en descend**, tous sur le même ensemble, rangs recomptés sans trou :

| Vue | Effet |
|---|---|
| `/classement` (tous onglets) et `GET /api/landing/leaderboard` (`getLeaderboardRows`) | lignes, rangs, podium, écarts et tendance sans elles |
| Marches du podium (`loadPodiumTiers`, `PODIUM_TIERS.md`) | une équipe sans match ne monte jamais |
| Carte d'aperçu du podium (`loadSharePodium`) et carte nominative (`findShareTeam`) | absentes ; une équipe sans match a la carte de la page |
| Tendance sur 7 jours (`getLeaderboardRows`) | une équipe absente de la photo d'il y a une semaine (entrée depuis) a la tendance `new` : « ★ », « Entrée au classement ces 7 derniers jours » / « Entered the ranking in the last 7 days » — jamais « stable » |
| Annuaire `/equipes` (`listTeams`) | l'équipe **reste** à l'annuaire, à sa cote rejouée (500, ou sa cote de placement), mais **sans badge de rang** (`rank: null`), rangée après les classées par nom (`compareDirectoryRank`) ; le podium de l'annuaire (`HighlightStrip`) ne prend que des classées |
| Fiche d'équipe (`getTeamRankingPosition`) | « Aucun match joué », hors du total « #n sur N » |

Le **seeding** des tournois n'est pas concerné : il range des inscrites, qu'elles
aient joué ou non, sur l'état rejoué (`rankEntrantsBySiteRanking`).

**Rien n'est supprimé.** L'équipe garde ses données et son historique ; le
rejeu la compte toujours (adversaire des autres). Elle réapparaît dès son premier
match compté — le cache du classement est vidé à chaque score.

**Équipes dissoutes.** Toutes l'étaient déjà de la liste, qu'elles aient joué
ou non (`deleted_at IS NULL`) : comportement inchangé. La dissolution vide
désormais les entrées tirées de la liste — marches, podium et fiches de la
carte d'aperçu (`invalidateRankingLists`, sous-préfixe `ranking:list:`) — et
les leaderboards, le bandeau, le mini-arbre et les compteurs de l'accueil
(`invalidateLandingTeamViews`, qui nomment ou comptent des équipes), pour que la
dissoute quitte podium, rangs et « Équipes actives », et son ancien nom le
bandeau et le mini-arbre, sans attendre l'échéance du cache. Le rejeu
(`ranking:state:*`) et le direct (5 s) restent en cache : une dissolution ne
change aucun match (revue de performance du lot). **Entrées solo** : toujours hors liste. **Équipes
fantômes** : listées si elles ont joué, masquées sinon, comme les autres.

**États vides.** Si le filtre ne laisse rien, la page lit « Aucune équipe
classée pour le moment : le premier match ouvrira le bal. » / « No ranked
teams yet: the first match will kick things off. » ; sous trois équipes, pas
de podium (tout au tableau). La carte « cote de départ » de « Comment marche la
cote » dit qu'une équipe entre au classement à son premier match **compté**,
forfait compris (règle d'`isRankedTeam`, FR/EN) ; la description de la page et
le sous-titre de sa carte d'aperçu parlent de « chaque équipe classée ». Une
légende dit le sens de l'étoile (`newcomer` : entrée ces 7 derniers jours), dont
la couleur (`trendNew`) n'est plus celle d'une montée.

**Jeu de test.** `npm run seed` crée « Test - Sans Match » (`NOMT`), équipe
ordinaire gardée hors du pool des tournois : présente à `/equipes` sans rang,
absente de `/classement`.

`isRankedTeam` ne décide pas de l'ordre : il décide qui figure à la liste, la
légende de la cote (« Aucun match joué ») et si la fiche affiche une place.

**Une seule photo** (`loadTeamRankingSnapshot`) : la liste **et** l'état rejoué
dont elle sort. L'annuaire (`listTeams`) et la fiche (`getTeamRankingPosition`)
lisent place, total et cote dans la même photo — relire l'état à part pouvait
tomber sur un autre classement qu'une invalidation aurait glissé entre les deux,
et relancer un rejeu. La cote d'une équipe hors liste se lit par
`rankingPointsOf` (ligne, sinon état rejoué, sinon cote de départ). Les
identités (`ranking:list:identities`) sont mutualisées sous `ranking:list:`.
Dernier départage à cote et bilan égaux : le nom, par un `Intl.Collator`
français partagé (même ordre que `localeCompare(…, "fr")`, sans en recréer un
par comparaison).

**Vues d'identité** (`invalidateTeamIdentityViews`, `ranking-cache.ts`) : un
renommage (seulement si le nom change vraiment — le formulaire renvoie toujours
le nom, relu et comparé à l'exact), un logo changé, retiré (s'il y en avait un), mis en quarantaine ou rétabli, une adoption
de fantôme et une dissolution vident la liste (identités, podium, cartes
d'aperçu et leurs PNG) et les vues de l'accueil qui nomment des équipes ; le
rejeu reste en cache. Le logo se relit **sous verrou** (`updateTeamLogo`,
`SELECT … FOR UPDATE` puis écriture dans une transaction) : l'ancien fichier
supprimé par la route est bien celui que l'écriture a remplacé, et le vidage a
lieu après le commit. La synchronisation d'une entrée solo (pseudo ou avatar
changés) ne vide l'accueil que si une entrée a été réécrite.

**Dissolution ciblée** : une équipe jamais inscrite à un tournoi n'est nommée
que sur sa fiche et celles de ses membres — seules celles-ci (`invalidateStatsOf`)
et le compteur de l'accueil (`invalidateLandingCounters`) sont vidés ; une
équipe déjà inscrite vide les vues d'identité et tous les bilans. Créations et
dissolutions partagent un plafond par compte (`TEAM_LIFECYCLE_RULE`, 10 gestes
par heure, 429 `TOO_MANY_REQUESTS`) : la place est réservée d'une instruction
avant l'écriture (`enforceRateLimit`, des requêtes parallèles ne passent pas
toutes) et rendue si le geste échoue (`refundRateLimitFor`) — seul un geste
réussi compte ; le staff `tournaments` n'est pas plafonné. Une boucle « créer → dissoudre » ne fait
plus recalculer le classement et le podium aux visiteurs.

**Nuls à l'annuaire** : `TeamListItem.draws` — la carte d'équipe ajoute une
colonne « Matchs nuls » quand il y en a, le podium de l'annuaire
(`HighlightStrip`, lu sur la liste déjà triée par rang, sans recopie) et le
leaderboard de l'accueil les écrivent (« 1 N » à l'écran, « 1 match nul » lu).
La carte d'une équipe sans rang ne réserve plus la marge du badge.

**Place sur la fiche** (`getTeamRankingPosition`) : comptée sur la même liste
que `/classement` (les équipes classées), « #n sur N équipes ». La place est
l'index dans cette liste triée : à cote égale, les départages ci-dessus
tranchent, comme sur la page.

### Effet sur le seeding

- **Tournois lancés** : aucun. Leurs rangs sont figés au coup d'envoi dans les
  tables d'état (`bg_*_standings`, `bg_tournament_phase_teams`) et relus tels
  quels (`SEEDING_ORDER.md`).
- **Ordre réordonné à la main par le staff** : aucun, il est figé.
- **Tournois à venir** (ordre encore lu sur le classement) : une inscrite sans
  match est seedée à 500, donc **devant** une inscrite descendue sous
  500, et derrière une inscrite au-dessus. L'aperçu du plateau et la liste des
  inscrites suivent, par le même comparateur. (Le masquage des équipes sans
  match ne touche que la liste publique, pas le seeding.)

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
  `getLeaderboardRows`).
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
  `getLeaderboardRows(game)` rejoue (sous `ranking-cache`) et trie donc
  toutes les équipes, **mutualisé** avec le leaderboard de l'accueil (entrée
  `landing:leaderboard:<jeu>`) : la page, rendue à chaque visite, ne refait plus
  ses deux rejeux à chaque rendu. L'entrée est vidée à chaque score avec le
  classement du site (`invalidateTeamRanking`), à chaque écriture de tournoi, à
  une dissolution, à un renommage, à un changement de logo et à un retrait ou
  masquage de logo par la modération (`invalidateLandingTeamViews`,
  `teams/identity.ts`, `logo-quarantine.ts`) — la page reste à jour ; une
  erreur n'est jamais mise en cache ; la page en tire « il en reste » et la présence d'un
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

### Noms du podium (depuis le 2026-10-06, refait le même jour)

Le nom de chaque équipe du podium porte sa **marche**, posée sur le `TeamLink`
par `podiumTier` (classes globales `.podium-tier-N`, **`PODIUM_TIERS.md`**) :
1re irisée cyan → violet → rose, balayée d'un reflet, aura et couronne ; 2e
chrome glacier ; 3e néon violet → rose. La première version (`.nameTier1/2/3`
du module de la page) était trop discrète — la 2e se lisait blanche.

- **Décision de l'utilisateur (2026-10-06)** : ni or ni bronze ; le style
  brillant et animé en teintes froides est gardé, rendu nettement visible.
- La marche est celle **de l'onglet affiché** : un onglet par jeu a son propre
  podium, que le reste du site ne connaît pas (le site suit le podium
  « Général »). Le tableau n'en porte jamais : il suit le podium, ou, sous
  trois équipes, il n'y a pas de podium du tout (même règle que
  `buildPodiumTiers`).
- La même marche suit l'équipe **partout** ailleurs (tournois, annuaire,
  fiche…), et ses membres en portent une version adoucie — `PODIUM_TIERS.md`.

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
- Barre de navigation des connectés (`SITE_NAV_LINKS`,
  `components/site-nav.tsx`) : « Classement », après « Tournois », teinte
  rose (`--pink-400-rgb`) — voir `PUBLIC_NAVIGATION.md`.
- Pied de page, COMPÉTITIONS : « Classement » → `/classement` (menait à
  `/joueurs`).
- Plan du site (`lib/shared/sitemap.ts`), quotidien.

## Langues

Page traduite depuis le lot 4 (`/en/classement`, `I18N.md` § Classement) : textes de
`messages/<langue>/ranking.json`, métadonnées et fil d'Ariane JSON-LD par langue, liens par
`LocaleLink`. Titre et sous-titre éditables : leur anglais (lot 2). Sous `/en`, lettres de forme
W / L / D, colonne « Rating ». Les adresses (`?jeu=`, `?n=`, ancres `rang-N`) sont les mêmes dans
les deux langues.

## Fichiers

| Rôle | Fichier |
|---|---|
| Page (serveur, métadonnées) | `app/classement/page.tsx` |
| Titre et sous-titre éditables | `lib/shared/site-copy.ts` (`ranking.hero.*`) |
| Podium + tableau | `app/classement/RankingBoard.tsx` |
| « Afficher plus » (client) | `app/classement/RankingMore.tsx` |
| Styles | `app/classement/page.module.css` |
| Textes (FR/EN) | `messages/<langue>/ranking.json`, `lib/shared/ranking-text.ts` |
| Logique pure (filtre, `?n=`, écarts) | `lib/shared/ranking-page.ts` |
| Lignes (cote, bilan, tendance) | `getLeaderboardRows` (`lib/server/landing-service.ts`) |
| Forme | `loadCachedTeamForms` (`lib/server/teams/directory.ts`) |
| Ordre | `compareRankedTeams` (`lib/shared/ranking.ts`) |

## Tests

- `tests/lib/shared/ranking.test.ts` — ordre : cote stricte, sans match à sa
  cote, départages.
- `tests/lib/server/landing-leaderboard.test.ts` — équipes sans match masquées,
  rangs sans trou, dans chaque onglet.
- `tests/lib/server/ranking-hide-unplayed.test.ts` — filtre unique
  (`isRankedTeam`), ordre de l'annuaire (`compareDirectoryRank`), chaque
  consommateur câblé sur `loadTeamRanking`, cache vidé à la dissolution.
- `tests/lib/server/ranking-service.test.ts` — forfait, nul, bye, classement
  final seul, fantôme, réapparition, place de la fiche ;
  `tests/lib/server/teams-service.list.test.ts` — annuaire sans rang ;
  `tests/app/team-card-logo.test.tsx`, `tests/app/team-ranking-podium-links.test.tsx`
  — badge absent, podium de l'annuaire.
- `tests/lib/server/ranking-service.test.ts` — liste et seeding avec le même
  ordre.
- `tests/lib/server/ranking-service.test.ts` (`loadTeamRankingSnapshot`,
  `rankingPointsOf`), `tests/lib/server/ranking-cache.test.ts`,
  `tests/lib/server/share-image-cache.test.ts`,
  `tests/lib/server/team-identity-invalidation.test.ts`,
  `tests/lib/server/logo-quarantine.test.ts`,
  `tests/app/api/teams/team-lifecycle-rate-limit.test.ts` — photo unique, vues
  d'identité vidées après commit, cartes d'aperçu oubliées, plafond partagé.
- `tests/lib/shared/ranking-page.test.ts` — filtre, adresses, écarts,
  lecture et bornes de `?n=`, lien de page suivante (onglet gardé, ancre).
- `tests/app/ranking-board.test.tsx` — podium, couleurs de défaite, forme,
  colonne des nuls, filtres, panne, animations en pause, plancher 11 px ;
  lien « Afficher plus » sans JavaScript, région d'annonce, rangs absolus et
  ancres focalisables d'une page suivante ; marche de l'onglet sur le nom du
  podium, absente du tableau qui le suit. L'apparence des marches est testée
  par `tests/app/podium-tiers-style.test.ts` (`PODIUM_TIERS.md`).
- `tests/app/classement-page-copy.test.tsx` — en-tête éditable : défauts,
  textes édités (échappés), crayons réservés à `showcase`, `<h1>` unique,
  métadonnées figées.
- `tests/app/ranking-i18n.test.tsx` — `/en/classement` : liste blanche, sitemap
  et `hreflang`, métadonnées par langue, aucune phrase française ni lettre
  accentuée, liens préfixés (sauf `/tournois`), fil d'Ariane, W / L / D,
  marches du podium dans les deux langues, français inchangé.
