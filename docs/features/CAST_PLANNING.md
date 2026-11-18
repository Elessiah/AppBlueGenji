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
lues que par `tournaments` : sans elle, la lecture ne rend de la base que les
siennes (`availabilityOf`). La raison « Préférence » / « Charge » d'une
proposition faite à un autre devient « Calcul » (`AUTO`, `visibleAssignment`)
pour qui n'a pas `tournaments` : elle dirait ce que l'autre a demandé. Le
masque est une liste blanche (`MANUAL`, `CAST`, `MATCH` restent lisibles) : un
motif ajouté plus tard est masqué d'office. Un
tournoi encore caché ne va qu'aux membres qui le voient (`seesHidden`,
permission `tournaments`) : le calcul ne le propose qu'à eux
(`excludeFromHidden`), le choix du staff refuse les autres
(`PLANNING_HIDDEN_FOR_MEMBER`, liste des candidats filtrée), la confirmation
les retire. Rôles et état caché se relisent **dans la transaction qui écrit**,
verrouillés en partage (`lockedHolding` : `LOCK IN SHARE MODE` sur le compte
et le tournoi) — calcul, confirmation et choix du staff : un rôle retiré ou un
tournoi recaché pendant le geste attend sa validation. L'export des données
rend toutes les attributions du titulaire, même sur un tournoi caché (art. 15 :
ce sont ses données). Rien n'est publié sur Discord.

Plafonds par compte (`api-guard.ts`), posés après le contrôle de permission :
`PLANNING_READ_RULE` (400 lectures / 5 min, plus que la somme des gestes
permis) doublé de `PLANNING_READ_BURST_RULE` (120 / min, contre une rafale de
400 en une minute ; une disponibilité se pose sans relecture, seuls les gestes
du staff relisent),
`PLANNING_WRITE_RULE` (180 gestes unitaires / 5 min, disponibilité, autonome,
désignation, réglages), `PLANNING_BATCH_RULE` (20 calculs ou confirmations /
5 min, chacun tenant le verrou `bg_planning`). Le refus `429`
(`TOO_MANY_REQUESTS`) a son texte dans `planning.errors`.

## Entrées

- Tournoi **à matchs planifiés** (`referee_scheduling = 1`) : une entrée par
  match daté, non exempt (`m:<id>`).
- Tournoi **sans planification des matchs** : **une seule** entrée au début du
  tournoi (`t:<id>`), attribuée par rôle pour toute la soirée, avec un groupe
  de `PLANNING_EVENT_REFEREES` (2) arbitres posés par le calcul (le staff peut
  en ajouter).
- Montrées : commencées depuis `PLANNING_PAST_DAYS` (7) jours et jusqu'à
  `PLANNING_HORIZON_DAYS` (90) jours devant (la page, sa réponse et son DOM
  restent bornés quand toute une saison est planifiée), tournois masqués
  compris pour le staff seulement.

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
  confirmées, caster inscrit sur le match (`CAST` — son inscription l'emporte sur
  une simple proposition provisoire du même caster, et compte dans l'équité),
  arbitre désigné du match
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
  dépendent d'aucun match), s'écrivent quand même au planning ; si une partie
  a ainsi été écrite, le geste répond `PLANNING_CONFIRM_PARTIAL` (« relance la
  confirmation », la panne d'origine va dans pm2), sinon la panne d'origine
  remonte (même si cette écriture échoue à son tour, consignée).
  Les désignations passent d'abord, les lignes du planning s'écrivent ensuite
  en une transaction ; un arbitre de match ne s'y confirme que si le match l'a
  encore, et un évènement ne s'écrit que pour une ligne vraiment changée
  (relancer le geste n'écrit rien deux fois). Une proposition d'arbitre
  restée provisoire alors que le match a déjà cet arbitre est confirmée au
  début de chaque calcul (fenêtre vide comprise) et de chaque confirmation
  (`confirmPendingReferees`, trois instructions ensemblistes lues en base —
  entrée commencée ou hors de la vue comprise : un calcul relancé ne l'efface
  jamais) ; au même moment, une ligne d'arbitre **confirmée** que son match ne
  porte pas (désignation restée incertaine, arbitre changé depuis le match)
  est retirée : le match fait foi. Les lignes confirmées
  deviennent des contraintes fixes pour les calculs suivants.
- Un choix du staff (`source = MANUAL`) naît confirmé et verrouillé ; un retrait
  manuel est mémorisé pour que le calcul ne repropose pas la personne. Le
  choix est refusé si la personne joue pendant l'entrée (`PLANNING_IS_PLAYER`)
  ou tient déjà une attribution sur une entrée qui la chevauche — confirmée
  ou manuelle (`PLANNING_OVERLAP`, à retirer dans le planning), caster inscrit
  ou arbitre désigné sur le match (`PLANNING_OVERLAP_MANAGED`, à retirer depuis
  le match) ; une simple proposition provisoire qui chevauche lui cède la
  place. Les lignes du planning s'écrivent d'abord, en une transaction
  validée ; la désignation sur le match (`assignMatchReferee`) passe ensuite,
  sauf si le match, relu juste avant, porte déjà ce qui est voulu. Si elle est
  refusée, ou tombe en panne sans avoir pris (le match relu le dit), les seules
  lignes que le geste a écrites ou retirées sont remises (jamais celles d'un
  compte supprimé entre-temps, ni le nom d'un staff supprimé) et les
  évènements du geste effacés (`planning-undo.ts`, instantané pris pour le
  seul arbitre d'un match) ; une panne qui a pris garde le planning,
  un doute est consigné dans pm2. Le match n'est **jamais** réécrit à la main :
  il ne change que par sa désignation, avec ses contrôles (opposition, joueur
  du match) et ses avis à l'arbitre.
- Les refus du match (`MATCH_REFEREE_REFUSAL_CODES`) sont une seule liste,
  vérifiée par le type contre les motifs d'inéligibilité ; les statuts HTTP de
  la route en dérivent.
- Un geste à la fois : verrou nommé `bg_planning` (10 s) → `PLANNING_BUSY`.

## Coût (performance)

- Une page = une fenêtre bornée : durées lues une fois (elles voyagent dans
  `PlanningData`), puis disponibilités, attributions, retraits et casters
  lancés ensemble ; regroupements par entrée en un passage (pas de filtre par
  entrée).
- La **liste** des comptes du planning (balayage de `bg_users` par
  `JSON_CONTAINS`) est gardée `PLANNING_MEMBERS_TTL_MS` (30 s) pour la **page**
  seule, en identifiants : chaque page relit ces comptes par leur clé
  (`loadPlanningMembersByIds` : pseudo, rôles, « caster autonome »), si bien
  qu'un compte supprimé ou qui perd son rôle disparaît dès la page suivante ;
  un rôle accordé apparaît au plus tard en 30 s. Les gestes et le calcul
  relisent tout ; « caster autonome » ne relit que le compte visé.
- Sa disponibilité (`setAvailability`) ne lit que **son** entrée (`only`,
  `parseEntryKey`), ni la fenêtre, ni les comptes.
- Le calcul écrit ses propositions par instructions groupées (200 lignes) et
  ne retrace (`ASSIGNED`) que ce qui change d'un lot à l'autre. La
  confirmation désigne les arbitres de match un à un, chacun sous un bref
  passage du verrou `bg_planning` qui relit d'abord la proposition
  (`PROPOSAL_STILL_PENDING_SQL`) : un retrait du staff fait entre-temps n'est
  jamais défait sur le match. Les écritures du planning suivent sous le verrou.
  Une proposition dont le membre ne tient plus le rôle, ou qui porte sur un
  tournoi encore caché qu'il ne voit pas, est retirée, jamais confirmée
  (`canStillHold`) : rôles relus au geste (`confirmSteps`) puis encore sous le
  verrou final, par leur clé et verrouillés en partage avec l'état caché du
  tournoi (`refuseLostRoles` → `lockedHolding`), les désignations pouvant
  durer. Un `PLANNING_BUSY` en pleine série est une panne : ce qui est décidé
  s'écrit, le geste se relance.
- `bg_planning_events` : index `(entry_key, kind, source)` pour les retraits
  manuels ; les lectures par entrée passent par les clés primaires.
- Écran : une relecture garde l'identité des entrées inchangées (`mergeView`),
  les cartes sont mémoïsées, une disponibilité se pose sur la page sans relecture
  (`applyAvailability`) ; semaine et jour d'une entrée se calculent une fois.
- Bornes d'opérations du calcul testées sur trois formes (étalée, concentrée,
  rondes de 32 matchs simultanés).

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
(`account-erasure.ts`). Export des données : `planning` (`planning-export.ts`) — disponibilités,
attributions (avec leur motif), historique (`history` : attribuée, confirmée, retirée, sans
l'auteur du geste) et réglage autonome.

## Interface

`app/(secured)/planning/` : agenda par semaine puis par jour (Paris), filtres
(« Mes créneaux » = attribué·e, proposition provisoire comprise ; « À couvrir » =
il manque un caster, un prod ou un arbitre, hors autogestion voulue ; un
tournoi) avec compteur, aides « i » (filtres, couverture, raisons) pour tous les
membres, créneau du lecteur surligné (« Mon créneau »), cartes d'entrée (couverture en pastilles,
`warning` réservé à « à arbitrer en priorité »), sa réponse par rôle (contrôle
segmenté + étoile de préférence), panneau du staff (calcul de la semaine par
`ConfirmActionDialog`, confirmation par délai ou par entrée, elle aussi derrière
`ConfirmActionDialog` (elle pose l'arbitre sur le match), casters autonomes,
durées). Textes : espace de noms `planning` (FR, EN).

## Tests

`tests/lib/shared/planning*.test.ts`, `tests/lib/server/planning/`,
`tests/app/api/planning/`, `tests/app/api/admin/planning/`.

## Seed

`docs/seed/SEED_RULES.md` § Planning des casts et arbitres.
