# Planning des casts et arbitres

Page `/planning` (FR) et `/en/planning` (EN) : les arbitres, casters et prods
disent, créneau par créneau et rôle par rôle, s'ils sont disponibles ; le staff
des tournois attribue à la main qui couvre chaque créneau, un administrateur
lance le calcul qui le propose et le confirme.
Remplace le tableur partagé tenu jusqu'ici.

## Accès

| Geste | Permission | Route |
| --- | --- | --- |
| Voir le planning (attributions de tous, ses propres réponses) | `planning` | `GET /api/planning` |
| Donner sa disponibilité / sa préférence | `planning` + le rôle concerné | `PUT /api/planning/availability` |
| Se dire caster autonome | `planning` + rôle `CASTER` | `PUT /api/planning/solo-caster` |
| Régler le caster autonome d'un autre | **administrateur** | `PUT /api/planning/solo-caster` (`userId`) |
| Attribuer / retirer à la main | `tournaments` | `PUT /api/admin/planning/assignment` |
| Calculer un lot | **administrateur** (`canComputePlanning`) | `POST /api/admin/planning/auto-assign` |
| Confirmer des propositions | **administrateur** | `POST /api/admin/planning/confirm` |
| Durées estimées | **administrateur** | `PUT /api/admin/planning/settings` |

**Calcul réservé aux administrateurs** (décision explicite, exception à la
règle des permissions scopées) : `canComputePlanning(user)` (`user.isAdmin`).
Le panneau « Calcul et confirmation » (confirmation à l'avance, caster
autonome d'un autre, durées), le bouton « Calculer la semaine » et le bouton
de confirmation d'un créneau n'existent que pour eux : la vue (`GET
/api/planning`, seule porte, le planning n'a pas de flux) porte `canCompute`
et `durations` seulement pour un administrateur ; sinon rien n'est rendu (ni
coquille vide ni indice). Les routes de calcul, de confirmation, de réglages
et le caster autonome d'un autre rendent `403 PLANNING_ADMIN_ONLY` (« réservé
aux administrateurs ») à tout autre compte, `tournaments` compris ; le panneau
n'est rendu que si la vue porte aussi les durées (jamais de valeurs par défaut
qu'un enregistrement écrirait). L'attribution à la main reste à `tournaments`
(`canManage`) : choisir à la main une personne déjà proposée remplace la
proposition par un choix du staff (`MANUAL`, ferme par nature), ce n'est pas
confirmer le calcul ; la confirmation d'office (`auto-confirm`) n'est pas un geste
d'utilisateur et ne change pas ; le remplaçant cherché à un désistement
(`replaceWithdrawn`) non plus : il comble une place que le désisté libère, sans
calculer la semaine. La route d'attribution à la main refuse par `403 FORBIDDEN`
(« réservé au staff des tournois », exact : elle exige `tournaments`). Les heures
de fin et de confirmation de chaque créneau (`endAt`, `confirmAt`) restent
rendues à tous les membres : elles laissent déduire les durées, qui ne sont pas
un secret — seul leur formulaire est réservé.

`planning` : rôles `ARBITRE`, `CASTER`, `PROD` (nouveau rôle de plateforme,
production d'un direct) et `ADMIN` (`PERMISSION_ROLES.md`). Rôles du planning
tenus (`planningRolesOf`) : arbitre = `tournaments`, caster = `CASTER`, prod =
`PROD`. Vue joueur : aucun rôle, page 404, routes `403 PLANNING_MEMBERS_ONLY`
(« réservé aux arbitres, casters et prods du planning »). Sans session : carte
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
tournoi recaché pendant le geste attend sa validation. Ces lectures passent
**en premier** dans la transaction, avant la réconciliation des matchs et les
lignes du planning : même ordre qu'un compte rendu de match (tournoi, puis
match), sans interblocage. L'export des données
rend toutes les attributions du titulaire, même sur un tournoi caché (art. 15 :
ce sont ses données). Seul un changement d'arbitre de match passe par le journal du staff sur Discord (voir « Conservation et RGPD »).

Plafonds par compte (`api-guard.ts`), posés après le contrôle de permission :
`PLANNING_READ_RULE` (400 lectures / 5 min, plus que la somme des gestes
permis) doublé de `PLANNING_READ_BURST_RULE` (200 / min, contre une rafale de
400 en une minute, mais autant que les gestes permis en cinq minutes : une
rafale de gestes acceptés garde sa relecture ; une disponibilité se pose sans
relecture, un geste refusé en `429` ne relit pas),
`PLANNING_WRITE_RULE` (180 gestes unitaires / 5 min, disponibilité, autonome,
désignation, réglages), `PLANNING_BATCH_RULE` (20 calculs ou confirmations /
5 min, chacun tenant le verrou `bg_planning` ; décompté après la validation de
la requête : une requête mal formée n'use pas ce quota). Le refus `429`
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

## Affichage : matchs passés repliés, nom du tour

- **Matchs passés** : une entrée est passée quand elle n'est plus modifiable
  (match joué, tournoi terminé — `isPastEntry` ; un match resté à jouer d'un
  tournoi terminé, revanche de grande finale non jouée par exemple, est clos
  comme le tournoi). Une fin estimée écoulée n'y
  suffit pas : un match en retard ou qui s'éternise se joue encore et reste
  dans la liste à venir, avec ses actions. Elles sont rangées sous un bouton
  « Matchs passés (N) » (`Disclosure`, `DISCLOSURE.md`), **replié par
  défaut**, la semaine la plus récente en tête (`newestFirst`). Le choix du lecteur est gardé
  sur son appareil, par compte (`planning:past-open:<empreinte du compte>`, jamais le numéro en clair, `localStorage`,
  `try/catch` : sans stockage, l'état par défaut vaut).
- **Calcul et confirmation** (administrateurs seuls) : même bouton repliable, **replié par
  défaut** ; le contenu reste monté (les durées en cours de saisie ne se
  perdent pas au repli).
- **Nom du tour** : une carte de match porte le nom de la fiche du tournoi
  (« Quart de finale 2 », « Finale », « Tableau perdants · Demi-finale »,
  « Ronde 3 · Match 2 »), jamais le numéro brut du moteur (« Manche 1000 »).
  Même assistant que les aperçus partagés (`buildShareRounds` /
  `shareRoundText`, `SHARE_EMBEDS.md`) : le serveur (`round-names.ts`) lit tous
  les matchs du tournoi (un tour se nomme depuis le dernier de son tableau) et
  rend un descripteur sans texte (`round`, `matchNumber`) ; l'écran le rédige
  dans la langue de l'adresse (`planning-round.ts`) ; seuls les mots des tours
  de `tournament.bracket` partent avec la page (le planning importe le noyau
  `tournament-page-text-core.ts`, pas le français de la fiche : `tournament.json`
  n'entre pas dans son paquet). Mémoire courte côté serveur : l'arbre d'un tournoi
  est gardé 10 s (10 min s'il est terminé : il ne change plus ; 64 tournois au
  plus, le moins récemment servi sort le premier), donc les relectures et le flux
  n'ajoutent aucune requête ; un match absent de la mémoire (tirage tout juste
  fait) ou un tournoi qui vient de se terminer relit son tournoi aussitôt. La
  mémoire est commune à tous les lecteurs : chacun ne reçoit que les noms des
  matchs que son planning lui rend déjà (tournois masqués compris ou non selon
  ses droits). Les matchs passés ne sont regroupés qu'à l'ouverture
  (`PastWeeks`), et la mise en forme des dates se fait dans la carte (mémorisée).
  Match inconnu du calcul :
  « Manche n » seul (aucun numéro de match inventé). Les notifications du planning (récapitulatif,
  affectation, désistement) ne citent aucun tour : rien à y changer.

## Couverture (du meilleur au pire)

`planningCoverage` (`lib/shared/planning.ts`) : **complet** (arbitre + caster +
prod) › **diffusé** (caster autonome, ou caster + prod — sans arbitre :
« à arbitrer en priorité ») › **arbitré seul** (valide) › **autogestion**.
Un prod n'est jamais attribué ni compté sans caster ; un caster non autonome
(`bg_planning_profiles.solo_caster`) ne diffuse qu'avec un prod. La couverture
compte les **rôles**, pas les personnes.

### Deux casters (`PLANNING_MAX_CASTERS` = 2)

- Une entrée (match ou tournoi entier) tient **deux casters au plus** au
  planning ; le premier la couvre, le second n'est qu'un **renfort**. Deux
  casters non autonomes ont **encore besoin d'un prod** pour que l'entrée soit
  « diffusée » (un seul autonome des deux suffit) : la couverture ne change
  pas de règle.
- Les inscriptions de cast du match (`bg_match_casters`) restent **sans
  plafond** ; elles comptent dans les deux du planning.
- **Calcul** : le second caster vient en dernier, une fois le planning stable
  (chaque entrée à sa meilleure couverture), sur une entrée qui a déjà son
  caster, jamais à quelqu'un déjà sur l'entrée (aucun cumul pour un renfort),
  ni à qui une entrée qui la chevauche attend encore : à venir et non jouée
  (`fillable` ; une entrée commencée ou jouée n'attend plus personne), il lui
  manque un rôle qu'il pourrait prendre — caster, prod (seulement auprès d'un
  caster qui l'attend : entrée avec caster, pas encore diffusée) ou place
  d'arbitre (un caster qui est aussi prod ou arbitre n'y est pas pris) —, ouverte au lot
  ou non (jamais pris à une autre entrée). Les exclusions (joueur, tournoi
  caché, condition d'arbitrage, suspension) se lisent aussi pour ces entrées
  voisines (`loadExclusions`) : n'y est attendu que qui pourrait les tenir. Ordre :
  ceux qui préfèrent l'entrée (sur tout le lot) d'abord, puis les autres
  entrée par entrée dans l'ordre du calendrier ; parmi les candidats, ce qui
  rend l'entrée diffusée (un autonome auprès d'un caster qui attend son prod),
  la préférence, la charge (semaine, historique), l'identifiant.
- **Choix du staff** : poser un caster de plus sur une entrée qui en a déjà
  deux (lignes du planning, propositions provisoires comprises, et inscrits du
  match) est refusé `PLANNING_CASTERS_FULL` (409) ; la page masque alors la
  liste « Ajouter — Caster » et dit « Deux casters au plus »
  (`planningCastersFull`, même règle des deux côtés ; texte selon ce qui se
  retire, `castersFullKind` : un caster, une proposition, depuis le match, ou
  « n'en laisser qu'un » quand les inscrits portent le total au-delà de deux). Retirer d'abord l'un des
  deux (une proposition retirée à la main n'est plus reproposée). Une
  inscription de cast faite sur le match au même instant (hors du verrou du
  planning) peut donner un troisième caster : c'est l'état qu'une inscription
  après coup donne aussi, les inscriptions n'ayant pas de plafond.

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
  (relancer le geste n'écrit rien deux fois). Un calcul relancé inscrit le
  retrait (`REMOVED`, `AUTO`, à son lanceur) de chaque proposition provisoire
  du lot qu'il ne repose pas, d'une instruction lue avant l'effacement. Une proposition d'arbitre
  restée provisoire alors que le match a déjà cet arbitre est confirmée au
  début de chaque calcul (fenêtre vide comprise) et de chaque confirmation
  (`confirmPendingReferees`, quatre instructions ensemblistes lues en base —
  entrée commencée ou hors de la vue comprise : un calcul relancé ne l'efface
  jamais ; la confirmation s'inscrit sans auteur : le site aligne le planning
  sur le match, sans savoir qui l'a désigné — une confirmation joue cette
  réconciliation **après** ses propres lignes, si bien qu'un arbitre qu'elle
  vient de désigner s'inscrit au compte de l'administrateur qui confirme, y compris
  quand une panne survient après que le match l'a pris (match relu) ; un
  arbitre que le match portait déjà avant le geste (posé depuis le match, ou
  confirmation interrompue d'un autre geste) ne passe pas par le match et se
  confirme sans auteur ; une proposition refusée dont le match porte
  l'arbitre n'est pas retirée — le match fait foi, elle se confirme sans
  auteur ; seule une confirmation dont la transaction d'écriture échoue en
  entier laisse ses désignations à la réconciliation suivante, sans auteur) ; au même moment, une ligne d'arbitre **confirmée** que son match ne
  porte pas (désignation restée incertaine, arbitre changé ou retiré depuis le match)
  est retirée, son retrait inscrit à l'historique (`REMOVED`, `AUTO`, sans
  auteur : personne ne l'a retirée par le planning, c'est le match, qui fait
  foi, qui ne la porte pas ; ce retrait n'écarte personne des calculs
  suivants). Index `(role, confirmed, match_id)` pour ces balayages. Les lignes confirmées
  deviennent des contraintes fixes pour les calculs suivants.
- Un choix du staff (`source = MANUAL`) naît confirmé et verrouillé ; un retrait
  manuel est mémorisé pour que le calcul ne repropose pas la personne. Le
  choix est refusé si la personne joue pendant l'entrée (`PLANNING_IS_PLAYER`)
  ou tient déjà une attribution sur une entrée qui la chevauche — confirmée
  ou manuelle (`PLANNING_OVERLAP`, à retirer dans le planning), caster inscrit
  ou arbitre désigné sur le match (`PLANNING_OVERLAP_MANAGED`, à retirer depuis
  le match) ; une simple proposition provisoire qui chevauche lui cède la
  place. Chaque ligne que le choix retire — proposition rendue, arbitre du
  match remplacé (lu verrouillé) — s'inscrit à l'historique (`REMOVED`,
  `AUTO` : retrait par conséquence, qui n'écarte personne des calculs
  suivants, au compte du staff) ; ces évènements s'effacent avec le geste s'il
  est annulé ; l'arbitre que le match portait sans ligne au planning, remplacé
  par ce choix, s'y inscrit aussi — lu sur le match dans la transaction du
  geste, et effacé si le match a reçu le membre voulu depuis le match entre-temps
  (ce geste n'a alors retiré personne) ou si l'issue de la désignation reste
  incertaine (l'historique ne dit jamais un retrait qui a pu ne pas avoir lieu). Retirer une ligne d'arbitre que le match ne porte pas (plus
  d'arbitre, ou un autre posé depuis le match) n'appelle pas le match. Les lignes du planning s'écrivent d'abord, en une transaction
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

### Confirmation d'office

Chaque entrée ouverte se confirme d'office à `min(date butoir, début − délai)` (réglage « délai de confirmation », 24–168 h) : le calcul refait d'abord la semaine autour des confirmées, puis ne confirme que les échues (`lib/server/planning/auto-confirm.ts`, `SCHEDULE_DEADLINE.md` § Planning).

## Notifications (`lib/server/planning/notices.ts`, `new-entries.ts`)

Quatre sujets de `PUSH_TOPICS`, chacun push **et** message privé Discord
(`notifyUsers`) ; couper le sujet coupe aussi le message privé
(`dmFollowsTopic` : lu dans `bg_push_topic_optouts`, et une lecture en
échec n'envoie aucun message privé). Rédacteurs : `push-messages.ts`
(`planning*Push`) et `lib/shared/planning-notices.ts` (messages privés, heure
de Paris, lien vers `/planning` dans la langue du destinataire).

- `PLANNING_NEW_ENTRIES` (« Nouveaux créneaux au planning ») : **un
  récapitulatif par vague**. Un balayage (chaque minute,
  `bg_planning_entry_notices`, verrou nommé `bg_planning_notices`) note
  chaque entrée ouverte qu'il découvre ; la vague part quand elle est calme
  depuis 5 min, ou au plus tard 30 min après sa plus ancienne entrée. Chaque
  membre ne reçoit que les entrées où il tient un rôle utile : caster et prod
  toutes, arbitre celles dont il remplit la condition d'arbitrage du jeu ;
  jamais une entrée où il joue. Une entrée d'un tournoi encore **caché** n'est
  pas notée : elle l'est quand le tournoi devient visible, et part alors à
  tous ceux qu'elle concerne ; notée puis recachée avant sa vague, elle attend
  de même, sans être notée annoncée (son `seen_at` repart à chaque passage
  tant qu'elle est cachée : à sa réapparition elle rejoint la vague suivante au
  lieu de partir seule). Les comptes de la vague se lisent une fois, les
  membres qui reçoivent la même liste partent en un envoi, par paquets de 4 ;
  même regroupement pour les affectations confirmées en groupe. Au tout premier passage (marqueur
  `planning_entry_notices_bootstrapped` absent de `bg_settings`), tout est noté
  déjà annoncé, sans message ; le marqueur ne dépend pas du contenu de la
  table, que la purge de conservation peut vider ; `npm run seed`, qui
  régénère le planning, le retire. Le balayage ne lit que les
  lignes des entrées ouvertes et celles qui attendent leur annonce, et note les
  nouvelles en une seule insertion. Une entrée est notée annoncée **avant**
  l'envoi : une panne perd un récapitulatif, n'en double jamais un.
- `PLANNING_ASSIGNED` (« Affectations du planning ») : à la **confirmation**
  (calcul confirmé, un message par personne pour toutes ses lignes) ou à une
  affectation **manuelle** ; jamais pour une proposition provisoire, jamais
  à l'auteur du geste ; aussi au remplaçant d'un désistement. Date et heure
  (Paris), rôle, affiche, lien.
- `PLANNING_WITHDRAWAL` (« Désistements du planning ») : aux autres affectés
  **confirmés** de l'entrée quand une attribution **confirmée** est quittée
  (une proposition provisoire, quittée ou co-affectée, n'en reçoit aucun) — « un caster
  s'est désisté », remplaçant affecté, autre caster encore affecté (second
  caster, `bodyStillHeld` ; au caster restant lui-même, `bodySelfHeld`) ou
  place à pourvoir.
- `PLANNING_UNFILLED` (« Places à pourvoir », `tournaments`) :
  aucun remplaçant trouvé — push **et** message privé au staff des tournois
  (comptes qui tiennent `tournaments`, choisis par la règle de `notifyStaff`
  — `loadStaffIds` dans `notify.ts` —, donc voient les tournois cachés ; le
  désisté excepté), dans la langue de chacun, et une ligne sans nom au journal
  du staff sur Discord (`sendBotLog`, catégorie d'alerte `staff-removal`) ; « désistement
  tardif » s'il l'est. Jamais par le rôle arbitre de Discord : son message
  privé passerait outre le sujet coupé.
- Arbitre de match changé depuis la fenêtre « Arbitrage » entre la lecture
  et le retrait : le match porte déjà un autre arbitre, la place est tenue —
  ni remplaçant cherché, ni place à pourvoir, ni avis à cet arbitre.

Aucun avis du planning ne part à un compte **suspendu** (rôle gardé, mais
sans droit effectif) : `loadNotificationRecipients(…, { excludeSuspended: true })`.

Vie privée : aucun pseudo de joueur (« Un match » en tournoi individuel),
noms d'équipe et de tournoi par `discordInline`, **aucun membre du staff
nommé** (ni celui qui se désiste, ni le remplaçant, ni l'auteur du geste).

## Désistement (`lib/server/planning/withdrawal.ts`, `POST /api/planning/withdrawal`)

- Un membre (`planning`) quitte **sa** ligne (provisoire ou confirmée) d'une
  entrée modifiable, **jusqu'au début** de l'entrée (`PLANNING_WITHDRAWAL_CLOSED`
  ensuite) ; jamais un cast inscrit sur le match (`PLANNING_CAST_MANAGED`, il
  se retire depuis le match). Le staff retire les lignes des autres par le
  retrait manuel. Geste derrière `ConfirmActionDialog`, motif facultatif
  (300 caractères au plus, `PLANNING_REASON_TOO_LONG`) lu par le staff des
  tournois seul.
- Moins de 24 h avant le début : **tardif** (`late`), signalé au staff.
- Historique : évènement `WITHDRAWN` (sans auteur, `reason`, `late` ; `source`
  `MANUAL` si la ligne quittée était confirmée, `AUTO` si provisoire). Il
  compte comme désistement, **jamais comme charge** : la ligne est effacée,
  et l'entrée exclut ensuite le membre pour ce rôle (comme un retrait manuel).
- **Remplacement automatique** sous le verrou du planning, par les règles du
  calcul (`pickReplacement` : `preparePlanner` sur la seule entrée, rôle
  quitté). Caster quitté alors qu'un **autre caster confirmé** tient encore
  l'entrée : il était le renfort (l'autre devient le premier) ; son remplaçant
  suit la règle du second caster (libre, attendu sur aucune entrée qui la
  chevauche), cherché seul — rien d'autre n'est posé sur l'entrée pendant ce
  calcul (`spareOnly`), aucun prod d'essai n'écarte un candidat. Le seul autre
  caster est une **proposition** provisoire : la place quittée est la première,
  remplacée par la règle ordinaire, la proposition écartée de ce seul calcul
  (elle reste en base). Sans remplaçant, la place n'est pas « à pourvoir » si
  le caster confirmé restant suffit à ce que le départ n'ôtait pas (l'entrée
  reste diffusée, ou ne l'était pas non plus avant ; rôles confirmés seuls) :
  ni pastille, ni avis au staff (`stillHeldBy`) ; les autres co-affectés lisent
  « un autre caster reste affecté », le caster restant « tu restes affecté
  comme caster » (`bodySelfHeld`). Le désisté encore inscrit sur le match
  (`CAST`) n'est jamais « un autre caster » : `casterHold` l'écarte de
  `casterIds` et le dit par `selfHeld` ; seul à tenir le rôle, il le cast
  toujours : aucun remplaçant cherché, aucun avis aux co-affectés (`selfKept`), et
  le désisté lit qu'il reste inscrit et doit se retirer depuis le match
  (`stillSignedUp`, « withdraw.doneStillSignedUp ») ; aucun avis au staff — sauf s'il
  est suspendu : pour le staff, un compte suspendu ne tient rien, la place
  y est à pourvoir et le staff prévenu (`staffUnfilled`). Un caster **autonome** parti laissant un
  caster sans prod (`casterHold` → `streamLost`) : son remplaçant doit rendre
  la diffusion — un caster **autonome** seulement (`restoreStream`), pris même
  si une entrée qui chevauche l'attend, la diffusion de celle-ci passant
  d'abord. Un prod seulement **proposé** auprès du caster restant la tiendra
  une fois confirmé : la règle ordinaire du second caster est tentée d'abord,
  le caster autonome (même attendu ailleurs) à défaut. La perte de diffusion
  et l'alerte se jugent sur les rôles **confirmés** seuls, à la relecture qui
  suit le retrait (une inscription de cast faite ou défaite entre-temps compte) ;
  un remplaçant non autonome posé auprès d'un prod proposé ne déclenche pas
  d'alerte : un administrateur confirme ce prod depuis le tableau. Une **proposition** de caster autonome quittée n'ôtait
  aucune diffusion confirmée : jamais `streamLost`. Sans remplaçant, la diffusion est perdue : la place est à pourvoir, le
  staff prévenu, et tous lisent « diffusion perdue, il manque un prod ou un
  caster autonome » (`bodyStreamLost`, push et message privé ; pas de
  pastille : un caster reste confirmé, la couverture de la carte le dit). Le groupe d'arbitres d'un tournoi entier garde la règle
  d'avant (un arbitre quitté sans remplaçant laisse sa place à pourvoir). La ligne remplaçante hérite de l'état de la ligne quittée :
  confirmée (et le remplaçant prévenu, `PLANNING_ASSIGNED`) si elle l'était,
  provisoire sinon (sans message). Aucun candidat : la place est **« à
  pourvoir »** (pastille sur la carte, `unfilled` de la vue) et le staff est
  prévenu (`PLANNING_UNFILLED`) si la ligne était confirmée.
- **Caster restant suspendu** (`casterHolds`) : deux lectures. Celle des
  membres (`shown` : annonces aux co-affectés, message rendu au désisté —
  « Désistement enregistré : la diffusion est perdue » pour `streamLost`)
  compte le compte suspendu comme le tableau le montre, sans rien trahir de
  la suspension. Celle du calcul et du staff (`staff`) ne le compte pas : le
  remplaçant se cherche comme pour une première place (le suspendu est écarté
  de ce seul calcul et ne prend aucune des deux places), et sans remplaçant le
  staff est prévenu (`staffUnfilled`) même si les membres lisent « un autre
  caster reste affecté » ; une place que les membres lisent à pourvoir l'est
  toujours pour le staff (le message « le staff est prévenu » ne ment pas).
  Sur le tableau du staff seul, la place quittée que ne tient plus qu'un
  compte suspendu se montre « à pourvoir » (`unfilledRoles`), comme son
  alerte, et sa couverture ne compte aucun compte suspendu (`coverage`). Hors du
  lot, `preparePlanner` ne verrouille aucune ligne d'un compte suspendu : une
  entrée voisine qu'il tenait seul attend encore son rôle (`neededElsewhere`),
  comme le tableau du staff la montre. Le plafond, lui, compte toute ligne de
  caster restée (proposition, inscription au match, compte suspendu) : un
  remplaçant ne le dépasse jamais (`pickReplacement`). Un désisté encore **inscrit sur le match** (`CAST`)
  cast toujours : sa ligne d'inscription compte comme caster restant, y compris
  sur la lecture d'avant le retrait (repli quand la relecture échoue).
  `loadExclusions` juge, outre le lot, ses seules voisines encore ouvertes
  (joueurs lus autour du lot, arbitrage hors entrées gérées par le tournoi) —
  pour le remplaçant d'un caster seulement (`neighbours: false` pour un prod ou
  un arbitre, que `neededElsewhere` ne juge jamais).
- Arbitre **d'un match** confirmé : le retrait passe par
  `assignMatchReferee` (le match perd son arbitre, ligne anonyme au journal),
  puis le remplaçant y est posé par la même porte — un refus métier compte
  comme « aucun remplaçant ».
- Une panne **après** le désistement écrit (recherche ou pose du remplaçant)
  ne le défait pas et ne rend pas d'échec : la place est « à pourvoir » et
  l'annonce part quand même. Arbitre déjà posé sur le match quand la ligne du
  planning échoue : il tient le rôle (le tableau le lit du match, qui fait
  foi). Une panne d'`assignMatchReferee` en posant le remplaçant relit le
  match (`readMatchReferee`) : s'il le porte (validation faite, réponse
  perdue), sa ligne s'écrit et il est le remplaçant ; sinon la place est « à
  pourvoir ».
- Les messages partent après le verrou, sans jamais défaire le geste.

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
  ne retrace (`ASSIGNED`) que ce qui change d'un lot à l'autre (une
  proposition reposée à l'identique garde le compte qui l'a posée : un calcul
  qui ne change rien ne laisse donc aucune trace à son lanceur), d'après les
  lignes du lot relues verrouillées dans sa transaction (`lockedBatchRows`,
  `FOR UPDATE`, par paquets de 200) : les retraits (`REMOVED`) s'écrivent par
  paquets, jamais en liste `NOT IN` ; une ligne tenue (confirmée, y compris
  par la réconciliation du même geste, ou choix du staff) n'est ni reproposée
  ni réécrite (une clé en double ne change rien). La
  confirmation désigne les arbitres de match un à un, chacun sous un bref
  passage du verrou `bg_planning` qui relit d'abord la proposition
  (`PROPOSAL_STILL_PENDING_SQL`) : un retrait du staff fait entre-temps n'est
  jamais défait sur le match. Les écritures du planning suivent sous le verrou.
  Une proposition dont le membre ne tient plus le rôle, ou qui porte sur un
  tournoi encore caché qu'il ne voit pas, est retirée, jamais confirmée
  (`canStillHold`) : rôles relus au geste (`confirmSteps`) puis encore sous le
  verrou final, par leur clé et verrouillés en partage avec l'état caché du
  tournoi (`refuseLostRoles` → `lockedHolding`), les désignations pouvant
  durer. Un refus tiré de la lecture sans verrou y est rejugé : un rôle rendu
  entre-temps fait confirmer la proposition (un arbitre de match non désigné
  reste provisoire). Un `PLANNING_BUSY` en pleine série est une panne : ce qui est décidé
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
`bg_planning_events` (historique : `ASSIGNED`, `CONFIRMED`, `REMOVED`,
`WITHDRAWN` avec motif et retard),
`bg_planning_entry_notices` (entrées vues et annoncées par le récapitulatif),
`bg_planning_profiles` (caster autonome). Clés étrangères en cascade sur
compte, tournoi, match.

## Conservation et RGPD

Registre **T20** (et **T12** pour les quatre sujets) ; `/rgpd` (FR, EN : §
planning et § notifications push) ; entrées `2026-11-planning-casts-arbitres`
et `2026-11-planning-notifications-desistements` de `PRIVACY_CHANGES` — dates
et `REGISTER_UPDATED_AT` avancent ensemble. Purge quotidienne (`lib/server/planning/retention.ts`,
lancée par `instrumentation.ts`) : tout ce qui concerne une entrée
`PLANNING_RETENTION_DAYS` (90) jours après son début ; le réglage caster
autonome dès que le compte ne tient plus le rôle `CASTER` (seul à pouvoir le
porter). Suppression du compte : ses lignes partent, ses gestes de staff restent
sans le désigner (`account-erasure.ts`). Export des données : `planning`
(`planning-export.ts`) — disponibilités, attributions (avec leur motif),
historique (`history` : attribuée, confirmée, retirée, désistement avec son
motif et son retard, sans l'auteur du geste),
entrées annoncées (`bg_planning_entry_notices`, sans personne) purgées avec
l'entrée ; ses gestes comme staff (`staffActions` : événements dont il est l'auteur ;
`assignmentsSet` : attributions qu'il a posées — sans l'identifiant de la
personne visée, art. 15.4 ; le match et le rôle restent, et l'arbitre désigné
d'un match est de toute façon public, T04) et réglage autonome.

Ce que disent les textes, et qui doit rester vrai : confirmer ou désigner
l'arbitre d'un **match** par le planning, ou retirer son arbitre désigné, passe par
`assignMatchReferee` — ligne anonyme au journal du staff sur Discord à chaque
changement d'arbitre du match (retirer une proposition provisoire, ou poser
l'arbitre que le match a déjà, n'en écrit aucune), push `REFEREE_RELEASED` à
l'arbitre retiré par un autre que lui : retrait (`STAFF`) ou remplacement par un
autre arbitre (`REPLACED`, désignation avec `replacedRefereeId`), jugés par
`refereeReleaseNotice` (T04, T05). Les notifications du planning (§ Notifications)
partent en message privé Discord sans nommer de joueur ni de membre du
staff ; la ligne « place à pourvoir » va au canal de logs, anonyme (T12, T20).
Le motif d'un désistement n'est lu que du staff des tournois ; la pastille
« à pourvoir » (`unfilled`) est montrée à tous les membres, sans motif, tant
que plus personne n'est confirmé dans le rôle quitté (une proposition
provisoire ne compte pas) ; l'avis au staff part,
lui, dès qu'une attribution confirmée reste sans remplaçant (`unfilledRoles`).
Un compte **suspendu** (`LoadedMember.suspended` : sous-requête
`userSuspendedSql` à la lecture simple ; sous `lockedHolding`, lecture
verrouillante **à part** de `bg_account_suspensions`, après les comptes — une
sous-requête d'une lecture verrouillante n'est qu'un instantané) n'est plus ni
proposé, ni confirmé, ni désigné, ni pris en remplaçant par le planning, ni
prévenu par ses avis : `excludeSuspended` (tous les rôles) et `holdingRefusal`
(`PLANNING_ROLE_NOT_HELD`, texte neutre « ne peut pas tenir ce rôle ici »,
aussi rendu à qui pose une disponibilité pour un rôle qu'il n'a pas). Une désignation d'arbitre de match par le planning (confirmation,
remplaçant, choix à la main) passe `refuseSuspended` à `assignMatchReferee` :
la suspension est relue (`refereeSuspended`, un seul compte, verrouillée après
la ligne du compte, l'ordre de `suspendAccount`) **dans la transaction qui
écrit le match** — aucune fenêtre entre contrôle et écriture ; refus
`REFEREE_UNAVAILABLE`, rendu `PLANNING_ROLE_NOT_HELD` au choix à la main. La
fenêtre « Arbitrage » du match ne passe pas l'option. La réconciliation
(`confirmPendingReferees`) ne confirme pas la proposition d'un compte suspendu
que le match porte d'ailleurs ; `CONFIRM_MATCH_REFEREE_SQL`, lui, suit la
désignation que le geste vient de faire (déjà jugée : une suspension validée
après elle trouve une affectation posée), sauf désignation incertaine (panne
d'`assignMatchReferee`, match relu qui porte l'arbitre, peut-être posé par la
fenêtre « Arbitrage » du match qui ne juge pas la suspension) :
`CONFIRM_UNCERTAIN_MATCH_REFEREE_SQL` rejuge la suspension (sous-select d'un
`UPDATE` : lecture verrouillante en InnoDB ; le compte suspendu reste alors en
proposition, le match le portant jusqu'à son retrait). Une suspension validée
pendant une série de désignations, après celle d'un arbitre, laisse cette
désignation confirmée : elle était déjà posée. Ses affectations confirmées restent
jusqu'à ce que le staff les retire (retirer un arbitre de match le prévient par
`REFEREE_RELEASED`, avis du match et non du planning, dont le push écarte déjà
un compte suspendu) ; ses propositions encore provisoires ne sont plus
confirmées (elles restent provisoires jusqu'à leur retrait : calcul de leur lot,
refus à la confirmation, ou staff — une proposition d'arbitre que le match
porte n'est jamais retirée par le planning). Un caster autonome suspendu ne couvre plus seul son
créneau (`coveringSoloCasterIds`) pour le calcul (`preparePlanner`) et pour le
staff des tournois ; les autres lecteurs gardent la couverture d'avant, mais
voient ce que le calcul propose à sa place. Le staff des tournois — et, par ces
propositions, les autres membres — peuvent donc **déduire** qu'un compte n'est
plus retenu (plus proposé ni confirmé, désignation à la main refusée par le
texte neutre `PLANNING_ROLE_NOT_HELD`, créneau autonome plus couvert ; déclaré :
registre T11 et T20, `/rgpd` §5, `PRIVACY_CHANGES`), sans voir la suspension ni
ses motifs. Les avis déclarent ces effets en **une phrase générale, la même
partout** (FR = EN), sans énumérer les mécanismes du calcul : « écarté des
propositions, confirmations, désignations, remplacements et avis du planning
(…) ; ce qui lui était déjà confirmé ou désigné reste jusqu'à son retrait ; le
staff des tournois et les autres membres du planning peuvent seulement en
déduire que le planning ne le retient plus, sans voir la suspension ni ses
motifs ». Un changement du calcul n'a pas à la retoucher tant qu'il reste
dans ce périmètre.
Coût des verrous : la lecture verrouillante des suspensions de `lockedHolding`
pose des verrous de clé suivante sur `(user_id, lifted_at)` le temps de la
transaction du planning (courte, sérialisée par le verrou nommé) : une
suspension d'un compte voisin attend au plus cette transaction, sans
interblocage (même ordre que `suspendAccount`). La même lecture
(`lockedSuspendedUserIds`, `suspension-sql.ts`, seule écriture, aussi lue par
le contrôle du dernier administrateur) joue dans `assignMatchReferee`
(`refuseSuspended`) pour **un** compte, dans la transaction du match (ligne du
match `FOR UPDATE`, compte en partage, puis suspensions) : une suspension
posée sur un compte voisin de l'index attend aussi cette transaction, courte
(une désignation) ; même ordre comptes → suspensions que `suspendAccount`,
qui ne touche jamais les matchs avant sa validation, donc sans interblocage.
Le drapeau `suspended` n'est jamais rendu à la page. Le staff des
tournois (`tournaments` : arbitres et administrateurs) lit disponibilités,
préférences et motifs ; les autres membres lisent le motif d'une proposition du
calcul comme « Calcul » (`visibleAssignment`). Tests :
`tests/lib/shared/cast-planning-legal.test.ts`.

## Interface

`app/(secured)/planning/` : agenda par semaine puis par jour (Paris), filtres
(« Mes créneaux » = attribué·e, proposition provisoire comprise ; « À couvrir » =
il manque un caster, un prod ou un arbitre, hors autogestion voulue ; un
tournoi) avec compteur, aides « i » (filtres, couverture, raisons) pour tous les
membres, créneau du lecteur surligné (« Mon créneau »), cartes d'entrée (couverture en pastilles,
`warning` réservé à « à arbitrer en priorité »), sa réponse par rôle (contrôle
segmenté + étoile de préférence), panneau « Calcul et confirmation » des
administrateurs seuls (calcul de la semaine par
`ConfirmActionDialog`, confirmation par délai ou par entrée, elle aussi derrière
`ConfirmActionDialog` (elle pose l'arbitre sur le match), casters autonomes,
durées), bouton « Me désister » sur ses propres lignes (sauf cast, jusqu'au
début ; avertissement « tardif » à moins de 24 h), pastille « À pourvoir »,
liste des désistements (motif, tardif) pour le staff des tournois. Textes :
espace de noms `planning` (FR, EN).

## Tests

`tests/lib/shared/planning*.test.ts`, `tests/lib/server/planning/`,
`tests/app/api/planning/`, `tests/app/api/admin/planning/`.

## Seed

`docs/seed/SEED_RULES.md` § Planning des casts et arbitres.
