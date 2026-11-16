# Statistiques de fréquentation détaillées — la mesure (registre T19)

Mesure **propre au site**, sans cookie et dispensée de consentement (art. 82
loi Informatique et Libertés, conditions CNIL de la mesure d'audience), qui
nourrit la page `/frequentation` (`STATS_PAGE.md`). Elle vit **à côté** de la
mesure T06 (`SITE_VISIT_STATS.md`, `/api/visits`, `/stats-site`), sans la
toucher : T06 compte des arrivées, T19 des pages vues et du temps.

## Règles qui la rendent dispensée de consentement

- **Aucun cookie, aucun stockage** dans le navigateur ; la session n'est jamais
  lue (`/api/audience` ne touche pas à `bg_user_sessions`).
- **Empreinte du jour** : `HMAC-SHA256(sel_du_jour, visitorIdentitySource({ ip, userAgent }))`.
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
- **IP en mémoire ≤ 2 min** : seul le plafond `AUDIENCE_REQUEST_RULE`
  (120 envois/min, fenêtre de 60 s, balayage du module `rate-limit`) la tient.
  Large à dessein : une adresse partagée (NAT d'opérateur mobile, réseau local
  d'un événement) ne doit pas faire disparaître ses visiteurs des chiffres.

## Chemin de la donnée

```
<AudienceBeacon /> (layout racine) ── AudienceTracker (lib/shared/audience-tracker.ts)
   │  file en mémoire de la page, lots de ≤ 20 : 10 pages, 1 min, onglet masqué, départ
   ▼
POST /api/audience  { v: [{ p, t, a, d, r?, f?, c?, o? }] }   fetch keepalive ; 200, ou 429 au-delà du plafond
   │  opposition → robot → plafond IP → corps ≤ 32 Ko → parseAudienceBatch
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
  lignes d'un jour déjà replié (`MAX(bg_audience_days.day)`), et le sel d'un
  jour replié n'est jamais recréé (lecture lente finie après l'entretien). Une lecture de sel sans réponse échoue au bout de 10 s
  (`SALT_READ_TIMEOUT_MS`) : rien n'attend une base figée sans fin. Chaque processus oublie en mémoire les sels des jours clos
  au plus 10 min après la clôture, même sans trafic.
- Un sel illisible (base en panne) écarte les seules entrées de son jour, et
  n'est relu qu'au bout de 30 s (une ligne de journal par essai).
- **Adresse partagée** : deux visiteurs derrière la même IP avec le même
  navigateur ne font qu'une empreinte ce jour-là (sous-compte assumé).
- La file serveur (≤ 10 s) est perdue à un arrêt brutal.

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
