# Planning des casts et arbitres

Page `/planning` (FR) et `/en/planning` (EN) : les arbitres, casters et prods
disent, créneau par créneau et rôle par rôle, s'ils sont disponibles ; le staff
des tournois attribue, à la main ou par un calcul, qui couvre chaque créneau.
Remplace le tableur partagé tenu jusqu'ici.

## Accès

| Geste | Permission | Route |
| --- | --- | --- |
| Voir le planning (attributions de tous, ses propres réponses) | `planning` | `GET /api/planning` |
| Donner sa disponibilité / sa préférence | `planning` + le rôle concerné | `PUT /api/planning/availability` |
| Se dire caster autonome | `planning` + rôle `CASTER` | `PUT /api/planning/solo-caster` |
| Régler le caster autonome d'un autre | `tournaments` | `PUT /api/planning/solo-caster` (`userId`) |
| Attribuer / retirer à la main | `tournaments` | `PUT /api/admin/planning/assignment` |
| Calculer un lot | `tournaments` | `POST /api/admin/planning/auto-assign` |
| Confirmer des propositions | `tournaments` | `POST /api/admin/planning/confirm` |
| Durées estimées | `tournaments` | `PUT /api/admin/planning/settings` |

`planning` : rôles `ARBITRE`, `CASTER`, `PROD` (nouveau rôle de plateforme,
production d'un direct) et `ADMIN` (`PERMISSION_ROLES.md`). Rôles du planning
tenus (`planningRolesOf`) : arbitre = `tournaments`, caster = `CASTER`, prod =
`PROD`. Vue joueur : aucun rôle, page 404, routes 403. Sans session : carte
« Connexion requise » (page), 401 (routes). Le lien « Planning » du menu du
compte suit `can(user, "planning")`. Les disponibilités des autres ne sont
lues que par `tournaments` ; rien n'est publié sur Discord.

## Entrées

- Tournoi **à matchs planifiés** (`referee_scheduling = 1`) : une entrée par
  match daté, non exempt (`m:<id>`).
- Tournoi **sans planification des matchs** : **une seule** entrée au début du
  tournoi (`t:<id>`), attribuée par rôle pour toute la soirée, avec un groupe
  de `PLANNING_EVENT_REFEREES` (2) arbitres posés par le calcul (le staff peut
  en ajouter).
- Montrées : à venir et commencées depuis `PLANNING_PAST_DAYS` (7) jours,
  tournois masqués compris pour le staff seulement.

## Couverture (du meilleur au pire)

`planningCoverage` (`lib/shared/planning.ts`) : **complet** (arbitre + caster +
prod) › **diffusé** (caster autonome, ou caster + prod — sans arbitre :
« à arbitrer en priorité ») › **arbitré seul** (valide) › **autogestion**.
Un prod n'est jamais attribué ni compté sans caster ; un caster non autonome
(`bg_planning_profiles.solo_caster`) ne diffuse qu'avec un prod. La couverture
compte les **rôles**, pas les personnes.

## Calcul (`lib/shared/planning-planner.ts`, pur et déterministe)

- **Par lot** sur une fenêtre (une semaine depuis la page, `PLANNING_BATCH_MAX_DAYS`
  = 31 au plus), relançable : il efface les seules propositions provisoires
  du lot et recalcule l'ensemble (construction la plus contrainte d'abord, puis
  amélioration globale jusqu'à stabilité : remplacement d'une proposition par
  un autre candidat, et **échange** de deux membres d'un même rôle quand l'un
  préfère l'entrée de l'autre — sort des impasses de deux entrées qui se
  chevauchent). Chaque essai se juge sur la seule partie du planning qu'il
  touche (état indexé) : un lot de 31 jours se calcule en une fraction de
  seconde ; les chevauchements sont indexés une fois (balayage par heure de
  début), si bien qu'une question d'éligibilité ne parcourt que les entrées
  qui chevauchent. Le coût se mesure en essais et en contrôles d'éligibilité
  (`PlannerStats`), bornés par les tests jusque dans le pire cas des échanges
  (tous préfèrent les mêmes entrées), et doubler le lot ne fait pas plus que
  tripler ce travail (croissance linéaire, pas quadratique). Le calcul se fait d'abord, puis l'effacement et les nouvelles
  propositions s'écrivent dans **une transaction** (jamais un lot à moitié
  effacé).
- **Semaines** : lundi 00:00 **heure de Paris** (`planningWeekStart`,
  `PLANNING_TIME_ZONE`) — charge hebdomadaire, bouton « calculer la semaine »
  (`[lundi, lundi suivant[`, 7 j ± 1 h au changement d'heure) et regroupement
  de la page.
- Garde tel quel ce qui est **verrouillé** : choix manuels, propositions
  confirmées, caster inscrit sur le match (`CAST`), arbitre désigné du match
  (`MATCH`) ; respecte l'autogestion décidée par le staff et les retraits
  manuels (jamais reproposé), écarte qui **joue** pendant l'entrée — joueurs
  du match, engagés du tournoi pour l'entrée d'un tournoi entier, joueurs de
  toute entrée qui la chevauche (`players.ts`, deux lectures pour les seules
  entrées du lot et celles qui les chevauchent, règle de `match-players.ts`) — et les arbitres qui ne remplissent pas les conditions de
  `MATCH_REFEREE.md`.
- Ordre : préférence (« je veux ce créneau »), puis charge la plus faible
  (semaine de l'entrée, puis `PLANNING_HISTORY_WEEKS` = 8 semaines d'historique
  **avant la semaine du lot** — un lot calculé à l'avance compte aussi le
  travail déjà tenu des semaines intermédiaires —, confirmées ou manuelles
  seulement ; pour une entrée d'une semaine plus tardive d'un lot de plusieurs
  semaines, le travail tenu des semaines du lot qui la précèdent s'y
  ajoute, `historyWeek` — une simple proposition provisoire hors du lot y
  occupe sa place mais n'y compte pas), puis id. Arbitres d'abord sur les entrées diffusées.
- **Plusieurs casquettes** : une personne répond rôle par rôle ; le calcul
  préfère des personnes distinctes, et ne cumule arbitre + caster ou
  arbitre + prod qu'en dernier recours — jamais caster + prod.
- **Chevauchement** : personne sur deux entrées qui se chevauchent ; deux
  entrées consécutives s'enchaînent. Durée d'un match = cartes au plus (BO n,
  FT n → borne du tournoi ou 2n − 1, sinon `defaultMaps`) × minutes par carte
  du jeu + marge ; entrée de tournoi = `eventHours`. Réglages dans
  `bg_settings.planning_durations` (`planning-durations.ts`, bornes
  `PLANNING_DURATION_BOUNDS`).

## Provisoire, confirmé, manuel

- Le calcul écrit `source = AUTO`, `confirmed = 0` : **provisoire**, affiché
  comme tel, rien n'est encore posé sur le match.
- **Confirmer** un sous-ensemble : des entrées nommées, ou tout ce qui commence
  avant un délai (heures). Une proposition d'arbitre confirmée est posée sur le
  match par `assignMatchReferee` ; seul un **refus métier** (conditions
  changées, arbitre posé entre-temps) retire la ligne et la compte — une panne
  (base, interblocage) fait échouer le geste sans rien retirer ; les
  désignations déjà validées avant elle, et les casters et prods (qui ne
  dépendent d'aucun match), s'écrivent quand même au planning, puis la panne
  d'origine remonte (même si cette écriture échoue à son tour, consignée).
  Les désignations passent d'abord, les lignes du planning s'écrivent ensuite
  en une transaction ; un arbitre de match ne s'y confirme que si le match l'a
  encore, et un évènement ne s'écrit que pour une ligne vraiment changée
  (relancer le geste n'écrit rien deux fois). Une proposition d'arbitre
  restée provisoire alors que le match a déjà cet arbitre est confirmée au
  début de chaque calcul (fenêtre vide comprise) et de chaque confirmation
  (`confirmPendingReferees`), lue en base — entrée commencée ou hors de la
  vue comprise : un calcul relancé ne l'efface jamais. Les lignes confirmées
  deviennent des contraintes fixes pour les calculs suivants.
- Un choix du staff (`source = MANUAL`) naît confirmé et verrouillé ; un retrait
  manuel est mémorisé pour que le calcul ne repropose pas la personne. Le
  choix est refusé si la personne joue pendant l'entrée (`PLANNING_IS_PLAYER`)
  ou tient déjà une attribution sur une entrée qui la chevauche — confirmée
  ou manuelle (`PLANNING_OVERLAP`, à retirer dans le planning), caster inscrit
  ou arbitre désigné sur le match (`PLANNING_OVERLAP_MANAGED`, à retirer depuis
  le match) ; une simple proposition provisoire qui chevauche lui cède la
  place. Les lignes du planning s'écrivent d'abord, en une transaction
  validée ; la désignation sur le match (`assignMatchReferee`) passe ensuite.
  Si elle est refusée, ou tombe en panne sans avoir pris (le match relu le
  dit), les lignes des entrées touchées sont remises et les évènements du
  geste effacés (`planning-undo.ts`) ; une panne qui a pris garde le planning,
  un doute est consigné dans pm2. Le match n'est **jamais** réécrit à la main :
  il ne change que par sa désignation, avec ses contrôles (opposition, joueur
  du match) et ses avis à l'arbitre.
- Les refus du match (`MATCH_REFEREE_REFUSAL_CODES`) sont une seule liste,
  vérifiée par le type contre les motifs d'inéligibilité ; les statuts HTTP de
  la route en dérivent.
- Un geste à la fois : verrou nommé `bg_planning` (10 s) → `PLANNING_BUSY`.

## Données (`lib/server/database/schema/planning.ts`)

`bg_planning_availability` (réponse par entrée × membre × rôle),
`bg_planning_assignments` (attributions, source, raison, état),
`bg_planning_events` (historique : `ASSIGNED`, `CONFIRMED`, `REMOVED` —
la porte des lots suivants : messages privés, désistement et remplacement),
`bg_planning_profiles` (caster autonome). Clés étrangères en cascade sur
compte, tournoi, match.

## Conservation et RGPD

Registre **T20** ; `/rgpd` (FR, EN) ; entrée `2026-11-planning-casts-arbitres`
de `PRIVACY_CHANGES`. Purge quotidienne (`lib/server/planning/retention.ts`,
lancée par `instrumentation.ts`) : tout ce qui concerne une entrée
`PLANNING_RETENTION_DAYS` (90) jours après son début ; le réglage caster
autonome dès que le compte ne tient plus de rôle du planning. Suppression du
compte : ses lignes partent, ses gestes de staff restent sans le désigner
(`account-erasure.ts`). Export des données : `planning` (`planning-export.ts`).

## Interface

`app/(secured)/planning/` : semaines, cartes d'entrée (couverture en pastilles,
`warning` réservé à « à arbitrer en priorité »), sa réponse par rôle (contrôle
segmenté + étoile de préférence), panneau du staff (calcul de la semaine par
`ConfirmActionDialog`, confirmation par délai ou par entrée, casters autonomes,
durées). Textes : espace de noms `planning` (FR, EN).

## Tests

`tests/lib/shared/planning*.test.ts`, `tests/lib/server/planning/`,
`tests/app/api/planning/`, `tests/app/api/admin/planning/`.

## Seed

`docs/seed/SEED_RULES.md` § Planning des casts et arbitres.
