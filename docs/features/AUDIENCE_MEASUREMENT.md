# Statistiques de fréquentation détaillées — la mesure (registre T19)

Mesure **propre au site**, sans cookie et dispensée de consentement (art. 82
loi Informatique et Libertés, conditions CNIL de la mesure d'audience), qui
nourrit la page `/frequentation` (`STATS_PAGE.md`). Elle vit **à côté** de la
mesure T06 (`SITE_VISIT_STATS.md`, `/api/visits`, `/stats-site`), sans la
toucher : T06 compte des arrivées, T19 des pages vues et du temps.

## Règles qui la rendent dispensée de consentement

- **Aucun cookie, aucun stockage** dans le navigateur ; la session n'est jamais
  lue (`/api/audience` ne touche pas à `bg_user_sessions`).
- **Empreinte du jour** : `HMAC-SHA256(sel_du_jour, ip|user-agent)`. Le sel est
  tiré au hasard (`randomBytes(32)`) pour la journée de Paris, **en mémoire
  seulement**, remplacé au changement de jour, perdu au redémarrage. Passé le
  jour, plus personne ne peut recalculer une empreinte : un visiteur n'est
  reconnu que le temps d'une journée.
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
  (30 envois/min, fenêtre de 60 s, balayage du module `rate-limit`) la tient.

## Chemin de la donnée

```
<AudienceBeacon /> (layout racine) ── AudienceTracker (lib/shared/audience-tracker.ts)
   │  file en mémoire de la page, lots de ≤ 20 : 10 pages, 1 min, onglet masqué, départ
   ▼
POST /api/audience  { v: [{ p, t, a, d, r?, f?, c? }] }   fetch keepalive ; 200, ou 429 au-delà du plafond
   │  opposition → robot → plafond IP → corps ≤ 32 Ko → parseAudienceBatch
   ▼
recordAudienceViews : empreinte du jour + file serveur (≤ 5 000), écriture groupée
   │  toutes les 10 s ou par 200 lignes (INSERT multi-lignes)
   ▼
bg_audience_views (détail, 13 mois)
   │  maintainAudience, au fil du trafic (au plus toutes les 10 min) :
   │  repli des jours clos (veille, 75 min de grâce) puis purge
   ▼
bg_audience_days / _day_pages / _day_hours / _day_dims (agrégats, sans limite)
```

- `p` chemin affiché (réduit côté serveur à `audiencePageKey` : `/frequentation`,
  `/api`, `/_next`, `/og` ne comptent pas), `t` temps visible (ms), `a` âge de
  la page vue au moment de l'envoi (ms, pour la dater ; plafonné à 1 h), `d` appareil,
  `f` première page de l'arrivée (porte `r`, l'hôte du référent externe),
  `c` suite : retour au premier plan sur une page déjà comptée — n'ajoute que
  du temps.
- Une **visite** = suite de vues d'une même empreinte espacées de moins de
  30 min ; un **rebond** = visite d'une seule vue (`aggregateAudienceDay`).
- Le repli d'un jour est transactionnel (efface puis réécrit ses agrégats, la
  ligne `bg_audience_days` en dernier) : rejouable sans double compte.

## Limites assumées

- **Visiteurs par semaine / mois / an = somme des visiteurs uniques de chaque
  jour** : l'empreinte change chaque jour, aucun dédoublonnage entre jours
  n'est possible — c'est le prix de la dispense. La page le dit.
- **Un seul processus** : le sel et la file vivent en mémoire du processus
  (pm2 en lance un). Plusieurs processus compteraient deux fois un visiteur.
  Un redémarrage en cours de journée tire un nouveau sel : les visiteurs déjà
  vus ce jour-là comptent une seconde fois.
- La file serveur (≤ 10 s) est perdue à un arrêt brutal.

## Fichiers

- `lib/shared/audience.ts` — gabarits de pages, analyse du lot, repli d'un jour,
  calculs de la page (pur, testé).
- `lib/shared/audience-tracker.ts` — temps visible, lots (pur, horloge injectée).
- `components/audience-beacon.tsx` — branchement navigateur.
- `app/api/audience/route.ts` — réception.
- `lib/server/audience-service.ts` — sel, écriture, repli, purge, lecture en
  cache (10 min, une seule lecture à la fois).
- Schéma : `lib/server/database/schema/compliance.ts` (tables neuves, aucune
  entrée `RECENT_SCHEMA_CHANGES`).
- Légal : registre T19 (et T17 pour le plafond IP), `/rgpd#audience-detaillee`
  FR et EN, `PRIVACY_CHANGES` « 2026-11-statistiques-frequentation-detaillees ».
