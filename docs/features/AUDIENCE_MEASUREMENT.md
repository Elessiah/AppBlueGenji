# Statistiques de fréquentation détaillées — la mesure (registre T19)

Mesure **propre au site**, sans cookie et dispensée de consentement (art. 82
loi Informatique et Libertés, conditions CNIL de la mesure d'audience), qui
nourrit la page `/frequentation` (`STATS_PAGE.md`). Elle vit **à côté** de la
mesure T06 (`SITE_VISIT_STATS.md`, `/api/visits`, `/stats-site`), sans la
toucher : T06 compte des arrivées, T19 des pages vues et du temps.

## Règles qui la rendent dispensée de consentement

- **Aucun cookie, aucun stockage** dans le navigateur ; la session n'est jamais
  lue (`/api/audience` ne touche pas à `bg_user_sessions`).
- **Empreinte du jour** : `HMAC-SHA256(sel_du_jour, visitorIdentitySource({ ip: clientNetworkKey(ip), userAgent }))`
  — le réseau (IPv4, ou `/64` en IPv6, port et écritures variantes ôtés) :
  une adresse neuve tirée dans son `/64` n'est pas un visiteur de plus ; les
  appareils d'un même navigateur derrière un `/64` comptent pour un, comme
  derrière une adresse IPv4 partagée.
  Le sel est tiré au hasard (`randomBytes(32)`) au premier signalement d'une
  journée de Paris et gardé dans `bg_audience_salts` (`INSERT IGNORE` puis
  relecture : un redémarrage ou un envoi concurrent reprend le même sel, un
  visiteur ne compte pas deux fois). Chaque entrée prend le sel de **son**
  jour, pas du jour de réception. Une fois le jour replié (75 min après
  minuit, au premier entretien), `forgetSalts` efface son sel (base et
  mémoire) et `recordAudienceViews` écarte les entrées tardives de ce jour :
  plus personne ne peut recalculer une empreinte, hors une copie de
  sauvegarde chiffrée faite entre-temps (T09, 30 jours) — les textes légaux
  le disent.
- **Rien d'identifiant n'est gardé tel quel** : type de page (gabarit, jamais
  l'adresse, un numéro ni un nom), langue, classe d'appareil (largeur de
  fenêtre), famille de provenance (le site d'origine est réduit aussitôt :
  `sourceFromReferrerHost`), temps onglet visible plafonné à 30 min.
- **Agrégé seulement** à la lecture : la page ne lit que les tables
  `bg_audience_day*`, jamais `bg_audience_views`.
- **13 mois** pour les lignes détaillées (`AUDIENCE_RAW_RETENTION_MONTHS`),
  purgées par lots de 10 000 ; les agrégats, sans empreinte, restent.
- **Opposition** : GPC, DNT et cookie `bg_audience_optout` (bouton de
  `/rgpd#audience`) — relus côté client (`browserAudienceOptOut`, au montage
  **et** avant chaque envoi) et côté serveur (`audienceOptOutFromHeaders`,
  avant tout calcul, plafond compris). Les robots connus (user-agent) sont
  écartés de même.
- **IP en mémoire ≤ 2 min** : seuls les plafonds la tiennent, fenêtres de
  60 s (glissante pour le registre des navigateurs vus : une minute après la
  dernière requête), balayage du module `rate-limit`. Trois étages : le **réseau**
  (`audienceNetworkKey` : IPv4, ou préfixe IPv6 `/64` ; adresse illisible =
  un réseau commun, signalé une fois par 10 min dans les journaux quand il
  est plafonné ; une valeur qui n'est pas une adresse IPv4/IPv6 — un
  `X-Forwarded-For` forgé sans mandataire de confiance — y tombe aussi, au
  lieu d'avoir ses plafonds neufs), le **`/48`** en IPv6 (`audienceWideNetworkKey` : un abonné
  reçoit souvent un `/56`, un hébergeur un `/48`) et le **site entier**.
  `throttleAudienceRequest` : `AUDIENCE_REQUEST_RULE` (120 envois/min par
  réseau), `AUDIENCE_WIDE_REQUEST_RULE` (600 par `/48`). `admitAudienceViews` :
  navigateurs nouveaux (clé : réseau + condensé court du user-agent, celle
  de l'empreinte ; `AUDIENCE_IDENTITY_SEEN_RULE`, fenêtre glissante : un
  navigateur actif ne redevient pas nouveau chaque minute) plafonnés à
  30/min par réseau (`AUDIENCE_IDENTITY_RULE`), 150 par `/48`, 1 500 pour
  le site ; pages vues à 120/min par réseau (`AUDIENCE_VIEW_RULE`), 600 par
  `/48`, 6 000 pour le site (les suites n'y comptent pas). La part de chaque
  réseau et de son `/48` (`AUDIENCE_FAIR_IDENTITIES` = 5 navigateurs
  nouveaux, `AUDIENCE_FAIR_VIEWS` = 20 pages vues par minute) puise dans une
  **réserve du site à part** (`AUDIENCE_GLOBAL_FAIR_IDENTITY_RULE` 1 500,
  `AUDIENCE_GLOBAL_FAIR_VIEW_RULE` 6 000 par minute), le reste dans les
  plafonds du site : des réseaux qui épuisent ces derniers n'effacent pas un
  foyer des chiffres, et la part, tous réseaux confondus, reste bornée (le
  site ne reçoit jamais plus de 12 000 pages vues par minute). Registre des
  navigateurs vus plein (`AUDIENCE_MAX_KEYS`, peut-être saturé exprès) : un
  navigateur absent n'est pas écarté, chacun de ses envois compte comme un
  navigateur nouveau sous les mêmes plafonds (journal, une fois par 10 min).
  Un envoi vide ou illisible ne touche pas ces plafonds (il garderait vivante
  une entrée du registre sans rien mesurer). Larges à dessein : une adresse
  partagée (NAT d'opérateur mobile, réseau local d'un événement) ne doit pas
  faire disparaître ses visiteurs des chiffres. Ces seaux sont en
  `overflow: "refuse"` (`AUDIENCE_MAX_KEYS` = 50 000 clés chacun) : pleins de
  fenêtres actives, ils refusent les clés nouvelles au lieu de se vider (un
  seau vidé rendrait leurs plafonds à tous, l'attaquant compris) ; le refus
  est vu dès le contrôle (`checkRateLimit`), si bien qu'un geste à plusieurs
  étages ne décompte rien avant d'être refusé, et son `Retry-After` est la
  fin de la plus ancienne fenêtre. La `Map` d'un seau reste triée par fin de
  fenêtre : la purge d'un seau plein s'arrête à la première fenêtre ouverte
  (pas de parcours de toutes les clés à chaque clé nouvelle).
- **Contre les signalements fabriqués** (chiffres gonflés devant les
  partenaires) : un envoi qui **déclare** une autre provenance est écarté
  (`isAudienceScriptRequest` : `Sec-Fetch-Site` autre que `same-origin` ou
  `Sec-Fetch-Dest` autre que `empty`), comme un envoi sans ces en-têtes au
  nom d'un navigateur qui les pose toujours (`sendsFetchMetadata` : Chrome
  76+, Firefox 90+, WebKit de Safari / iOS 16.4+) **et** sans `Origin` : un
  mandataire qui retire `Sec-Fetch-*` garde d'ordinaire `Origin`, que le
  middleware a déjà comparé aux hôtes du site ; un navigateur plus ancien ou
  inconnu (Safari avant iOS 16.4, vieilles vues web) est compté sans eux. Ce filtre ne prouve rien : la vraie borne est celle des
  plafonds ci-dessus, qui tiennent même quand un client change de
  user-agent ou d'adresse dans son `/64` (même empreinte). Le temps d'une page vue est ignoré (il arrive par ses
  suites) et, au repli, une suite ne compte que la part de sa lecture
  postérieure au début de la visite et au dernier temps déjà compté du
  visiteur : des suites forgées qui se chevauchent ne s'additionnent pas.
  Revers assumé : deux lectures légitimes simultanées d'une même empreinte
  (deux fenêtres visibles, ou deux personnes d'une même adresse avec le
  même navigateur) ne comptent qu'un temps — les chiffres pèchent par
  défaut, jamais par excès. Passé la moitié de `MAX_PENDING`, un envoi
  n'ajoute plus qu'une ligne à la file. Le référent égal à l'hôte d'`APP_URL`
  compte en accès direct.
- **k-anonymat jour par jour** (`AUDIENCE_MIN_VISITORS` = 5), appliqué **au
  repli** (`anonymizeAudienceDay`, dans `rollUpDay`) : seules des lignes sûres
  sont écrites dans `bg_audience_day_pages` / `_hours` / `_dims`, et la
  lecture (`readRange`) ne fait qu'additionner. Une ligne d'un jour sous 5
  visiteurs (ou un type de page inconnu, ou `other`) rejoint « Autres
  pages » ou `small` (« Petits nombres regroupés » : appareils, provenance,
  langue) ; une heure sous 5 visiteurs n'est pas écrite. Le groupe compte ses
  visiteurs **distincts** (dans le détail : en mémoire pour un jour d'une
  seule tranche, `inMemoryDistinctCounter` ; `COUNT(DISTINCT visitor_key)`
  pour un jour en tranches) ; une ligne sans visiteur (du temps de lecture
  seul, sa page vue écartée ce jour-là) ne lance aucun regroupement, elle
  suit le groupe s'il est écrit ;
  sous 5, il absorbe la plus petite ligne suivante (suppression
  complémentaire), et s'il n'y parvient qu'avec tout le jour, il n'est pas
  écrit. Ainsi ni une ligne, ni l'écart entre le total publié d'un jour et
  ses lignes (relevés successifs de « tout », deux périodes) ne décrit moins
  de 5 visiteurs d'un jour. Jour par jour et non sur la période : un visiteur
  n'est reconnu que le temps d'une journée. Les totaux du site par jour
  (visiteurs, pages vues, visites, temps) restent publiés tels quels : ils
  ne disent ni quelle page, ni d'où, ni à quelle heure. Les jours repliés
  avant ce mécanisme (bases de développement) ne sont pas réécrits.
- **Pages jamais mesurées** : `/admin/*` et `/signalements/*`, avec ou sans
  préfixe `/en` (personnel et auteurs de signalements, trop peu nombreux
  pour des chiffres anonymes). Le navigateur ne les signale même pas
  (`AudienceTracker` passe par `audiencePageKey`, qui les rend `null`) ; le
  serveur les écarte de même.

## Chemin de la donnée

```
<AudienceBeacon /> (layout racine) ── AudienceTracker (lib/shared/audience-tracker.ts)
   │  file en mémoire de la page, lots de ≤ 20 : 10 pages, 1 min, onglet masqué, départ
   ▼
POST /api/audience  { v: [{ p, t, a, d, r?, f?, c?, o? }] }   fetch keepalive ; 200, ou 429 au-delà du plafond
   │  opposition → robot / provenance déclarée étrangère → plafond réseau + /48 → corps ≤ 32 Ko → parseAudienceBatch → admitAudienceViews
   ▼
recordAudienceViews : sel du jour de la page (lu une fois par jour ; échec resservi 30 s) + empreinte + file serveur (≤ 5 000)
   │  toutes les 10 s ou par 200 lignes (INSERT multi-lignes)
   ▼
bg_audience_views (détail, 13 mois)
   │  maintainAudience, au fil du trafic (au plus toutes les 10 min) :
   │  attente des signalements en cours et vidage de la file, repli des jours clos
   │  (veille, 75 min de grâce), effacement de leur sel, puis purge
   ▼
bg_audience_days / _day_pages / _day_hours / _day_dims (agrégats, sans limite)
```

- Une page vue part **à son affichage** (`t: 0`, datée de son début : la
  carte de chaleur garde l'heure d'ouverture, même pour une page lue des
  heures) ; son temps visible part **à sa clôture** (navigation, onglet
  masqué, départ) en suite `c: 1`, datée de cette clôture. Une lecture qui
  dure part **par tranches** de 10 min (`AUDIENCE_CHECKPOINT_MS`, au tic d'une
  minute) : chaque tranche reste sous le plafond de 30 min et commence où
  finit la précédente. Un retour au premier plan après une pause de moins de
  30 min, le même jour, ouvre une nouvelle suite sur la même page ; après une
  pause plus longue ou un changement de jour, il compte une **nouvelle page
  vue** (une suite hors de toute visite ne serait pas comptée). Une machine en
  veille onglet visible se voit au tic suivant (retard de plus de 3 min,
  `AUDIENCE_SUSPEND_GAP_MS`) : la lecture s'arrête au dernier tic, la reprise
  suit la même règle — le sommeil n'est jamais du temps de lecture. Le
  tracker lit l'horloge murale (`Date.now()`) : le jour de Paris s'y lit, et
  `performance.now()` s'arrête pendant la veille sur certains systèmes.
- Une suite porte `o`, l'âge de l'ouverture de sa page : elle prend le **jour
  et le sel de cette page**, même lue après minuit (sans `o`, ancien script :
  le jour de sa clôture). Le temps lu après 1 h 15 le
  lendemain, jour déjà replié, n'est pas compté. `o` est plafonné à 7 jours
  (`AUDIENCE_MAX_OPEN_AGE_MS`) : une valeur démesurée tombe sur un jour
  replié et n'écarte que son entrée, jamais le reste du lot.
- `p` chemin affiché (réduit côté serveur à `audiencePageKey` : `/frequentation`,
  `/api`, `/_next`, `/og` ne comptent pas), `t` temps visible (ms), `a` âge,
  à l'envoi, de l'instant que l'entrée date (ms) — au-delà d'une heure,
  l'entrée est **écartée**, jamais redatée —, `d` appareil, `f` première page
  de l'arrivée (porte `r`, l'hôte du référent externe), `c` suite (temps seul).
- Une **visite** = suite de vues d'une même empreinte dont chacune s'ouvre
  moins de 30 min après la **dernière activité** de la visite (ouverture d'une
  page ou fin d'une lecture : une longue lecture ne coupe pas la visite) ; un
  retour sur l'onglet après plus de 30 min de pause clôt la visite d'avant sans
  en ouvrir une. Un **rebond** = visite d'une seule vue (`aggregateAudienceDay`).
  Un temps hors de toute visite (ce retour, ou une suite sans sa page vue)
  n'est **pas compté** : il gonflerait le temps par visite et par page.
- Le repli d'un jour est transactionnel (efface puis réécrit ses agrégats, la
  ligne `bg_audience_days` en dernier) : rejouable sans double compte.

## Limites assumées

- **Visiteurs par semaine / mois / an = somme des visiteurs uniques de chaque
  jour** : l'empreinte change chaque jour, aucun dédoublonnage entre jours
  n'est possible — c'est le prix de la dispense. La page le dit.
- **Un seul processus** pour la file et l'entretien (pm2 en lance un) ; le
  sel, lui, est en base : un redémarrage ne compte pas deux fois un visiteur.
  L'entretien attend les signalements en cours de son processus (15 s au
  plus, `RECORDING_WAIT_MS` = délai d'une lecture de sel + 5 s) et vide la
  file avant de replier ; un signalement qui finit après cette attente écarte
  ses lignes des jours que l'entretien a commencé à replier (rouverts si le
  repli échoue). Quel que soit le processus, l'écriture de la file écarte les
  lignes d'un jour déjà replié (`MAX(bg_audience_days.day)`, relu seulement si
  une ligne est d'un jour repliable à cet instant), et le sel d'un
  jour replié n'est jamais recréé (lecture lente finie après l'entretien). Une lecture de sel sans réponse échoue au bout de 10 s
  (`SALT_READ_TIMEOUT_MS`) : rien n'attend une base figée sans fin. Chaque processus oublie en mémoire les sels des jours clos
  au plus 10 min après la clôture, même sans trafic.
- Un sel illisible (base en panne) écarte les seules entrées de son jour, et
  n'est relu qu'au bout de 30 s (une ligne de journal par essai).
- **Adresse partagée** : deux visiteurs derrière la même IP avec le même
  navigateur ne font qu'une empreinte ce jour-là (sous-compte assumé).
- La file serveur (≤ 10 s) est perdue à un arrêt brutal.

## Coût (performance, cycle 1)

- **Navigateur** : `<AudienceBeacon />` s'installe au repos (`requestIdleCallback`,
  repli `setTimeout`) ; son battement d'une minute suit `powerPolicy(...).clocks`
  par abonnement sans rendu (éteint onglet masqué ou en économie, rallumé au
  retour). Chart.js n'est chargé que sur `/frequentation`.
- **Écriture** : `INSERT` par tranches de `INSERT_CHUNK` (1 000) lignes ; une file
  déjà au seuil à la fin d'une écriture repart aussitôt (pas de minuteur de 10 s).
- **Repli** : un jour de plus de `ROLLUP_SHARD_ROWS` (50 000) lignes est lu par
  tranches de visiteurs (`MOD(CRC32(visitor_key), n)`), chaque tranche repliée
  puis sommée (`mergeAudienceAggregates`) : mémoire bornée.
- **Lecture** : `getAudienceStats` n'attend jamais l'entretien (cache, sinon lecture
  directe des jours déjà repliés) ; l'entretien n'est entraîné que par un envoi
  mesuré (ni opposition, ni robot, ni plafond) ou par la page.
- Les points quotidiens de la page (≈ 100 octets par jour, ≈ 36 Ko par an) ne sont
  pas bornés : la période « tout » les exige, la charge utile reste négligeable.

## Fichiers

- `lib/shared/audience.ts` — gabarits de pages, analyse du lot, repli d'un jour,
  calculs de la page (pur, testé).
- `lib/shared/audience-tracker.ts` — temps visible, lots (pur, horloge injectée).
- `components/audience-beacon.tsx` — branchement navigateur.
- `app/api/audience/route.ts` — réception.
- `lib/server/audience-service.ts` — sel, écriture, repli, purge, lecture en
  cache (10 min, une seule lecture à la fois ; périodes lues en parallèle,
  carte de chaleur groupée par la base, `WEEKDAY(day)`).
- `lib/server/site-counts.ts` — équipes et comptes de la plateforme (même
  définition que l'accueil) ; tournois joués et matchs lus ensemble par
  `audience-service.ts`.
- Schéma : `lib/server/database/schema/compliance.ts` (tables neuves, aucune
  entrée `RECENT_SCHEMA_CHANGES`).
- Légal : registre T19 (et T17 pour le plafond IP), `/rgpd#audience-detaillee`
  FR et EN, `PRIVACY_CHANGES` « 2026-11-statistiques-frequentation-detaillees ».
