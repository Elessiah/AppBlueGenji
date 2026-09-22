# Fonctionnalités à développer côté bot Discord

Liste extraite de l'analyse du design dashboard `/bot` (bundle `O-oRl29qBWppuhpIKafZ-g`)
confrontée à l'état actuel du contrat HTTP exposé par le bot
(`lib/server/bot-integration.ts`). Tout ce qui suit est **absent** ou
**incomplet** côté bot et doit être livré pour que le dashboard sorte du mode
mocks.

État du contrat existant (référence) :
- `GET  /internal/stats` → 5 compteurs agrégés
- `POST /internal/auth/send-code` → DM Discord avec code 6-chiffres
- `POST /internal/log` → log message best-effort

---

## 1. Télémétrie système

À exposer via un nouvel endpoint `GET /internal/status` :

- [ ] **Uptime** — timestamp de démarrage du process (le front calcule la durée écoulée)
- [ ] **Version** — version sémantique + build hash (ex: `v2.4.1 / 4f8a`)
- [ ] **Date de build** — ISO 8601
- [ ] **Gateway latency** — ping WebSocket Discord en ms (échantillonné en continu)
- [ ] **Shard count** — `02 / 02` format, ou objet `{ active, total }`
- [ ] **CPU usage** — pourcentage instantané du process
- [ ] **RAM usage** — MB résidents du process
- [ ] **Statut global** — `OPERATIONAL` / `DEGRADED` / `DOWN` (dérivé des modules)

---

## 2. KPIs élargis

Étendre `GET /internal/stats` ou nouvel endpoint `GET /internal/kpis` :

- [ ] **Séries temporelles 30 jours** pour chacun des compteurs existants
      (afin de calculer les deltas % affichés dans les cartes KPI du dashboard)
- [ ] **Compteur de serveurs** + delta vs N-30j
- [ ] **Compteur de channels relayés** + delta vs N-30j
- [ ] **Compteur de messages traités** + delta % vs N-30j
- [ ] **Compteur de relais inter-serveurs** + delta % vs N-30j

Format suggéré :
```json
{
  "servers":      { "value": 15,   "delta": "+3",    "series": [/* 12 points */] },
  "channels":     { "value": 57,   "delta": "+12",   "series": [...] },
  "messages":     { "value": 8419, "delta": "+18 %", "series": [...] },
  "relays":       { "value": 462,  "delta": "+24 %", "series": [...] }
}
```

---

## 3. Liste des serveurs connectés

Nouvel endpoint `GET /internal/servers` :

- [ ] **Nom** du serveur Discord
- [ ] **Nombre de membres**
- [ ] **Nombre de relais sur 30j**
- [ ] **Status** par serveur : `ok` / `lag` / `off` (dérivé de la dernière activité)
- [ ] **Tendance d'activité** : tableau de 10 points (sparkline)
- [ ] **Couleur d'accent** ou identifiant déterministe pour le sigil (premier caractère + couleur)
- [ ] **Tri** par activité 30j décroissante
- [ ] **Pagination** ou cap (le design affiche 8 serveurs visibles)

---

## 4. Activité historique (chart)

Nouvel endpoint `GET /internal/activity?range=7j|30j|90j` :

- [ ] **Série « relais inter-serveurs »** — un point par jour
- [ ] **Série « scrims proposés »** — un point par jour
- [ ] **Moyenne par jour** sur la période demandée
- [ ] **Labels d'axe X** (dates au format court, ex `04 AVR`, `10`, `16`...)
- [ ] **Support 7j / 30j / 90j** au minimum

---

## 5. Flux temps réel (live feed)

Endpoint streaming `GET /internal/feed/stream` (SSE recommandé pour cohérence
avec `/api/tournaments/[id]/stream` déjà en place) :

- [ ] **Push d'événements** au fil de l'eau, avec timestamp ISO
- [ ] **Types d'événements** : `relay`, `scrim`, `recr`, `auth`, `warn`
- [ ] **Payload structuré** : `{ ts, type, source?, target?, summary }`
- [ ] **Backlog initial** — les N derniers événements à la connexion (le
      dashboard affiche 13 entrées max)
- [ ] **Heartbeat** toutes les 30s pour maintenir la connexion
- [ ] **Reconnect** automatique côté client supporté (id d'événement)

---

## 6. Modules — état et configuration par serveur

> **⚠ Section abandonnée côté site — ne rien construire ici sans rouvrir la
> décision.** La grille « Modules » de `/bot` a été retirée : elle rendait son
> en-tête (« 0 INSTALLÉS · 0 ACTIFS ») au-dessus d'une grille vide tant que le
> bot n'exposait rien, et l'appel sortant `fetchBotModules` est parti avec elle.
> **Le site ne consomme plus aucun de ces endpoints** et n'a plus d'écran où
> afficher un compteur par module. Voir `CLAUDE.md`, section « Page `/bot` ».
> Les lignes ci-dessous sont conservées pour mémoire, barrées : si le bot veut
> des modules pour son propre compte, c'est un besoin du bot, pas une attente de
> la plateforme.

- [ ] ~~**`GET  /internal/servers/:id/modules`** — liste les modules avec `on/off`~~
- [ ] ~~**`PUT  /internal/servers/:id/modules/:moduleKey`** — toggle on/off~~
- [ ] ~~**Persistence** : table dédiée (MySQL existant ou store du bot)~~
- [ ] ~~**Compteurs par module** : nb relais 30j, nb matchs 30j, nb annonces
      actives, nb comptes liés, etc.~~ (le bloc `mod-foot` qui les affichait
      n'existe plus)
- [ ] ~~**Garde-fou** : module `OAuth` non-toggleable~~ — la dépendance de
      `/connexion` reste réelle, mais rien ne propose plus de la débrancher.

---

## 7. Slash commands

> **La page `/bot` ne liste plus les commandes.** Les huit entrées ci-dessous
> venaient d'une liste écrite en dur (`components/bot/mocks.ts`, supprimée) :
> c'était une maquette, jamais un inventaire. La page renvoie désormais à
> `/bot/docs`, qui sert le Markdown du dépôt du bot **à chaud** — la liste qui
> fait foi est donc celle du bot, et la tenir à jour veut dire tenir son
> Markdown à jour. Ce qui suit reste une **feuille de route du bot**, à valider
> commande par commande, et non une promesse déjà affichée quelque part.

### Publiques
- [ ] **`/ping`** — vérifie latence et connexion bot
- [ ] **`/scrim <jeu> <niveau>`** — propose une équipe pour un scrim
- [ ] **`/recrute <rôle>`** — publie une recherche d'équipe ou staff
- [ ] **`/link`** — lie le compte Discord au profil BlueGenji du site
      (cf. flow `/api/auth/discord/verify` déjà en place côté site)
- [ ] **`/stats [joueur]`** — affiche stats personnelles ou d'un autre joueur
- [ ] **`/help`** — liste toutes les commandes

### Admin
- [ ] **`/relay <channel>`** — configure un channel de relais inter-serveurs
- [ ] ~~**`/config <module>`** — toggle on/off d'un module sur le serveur courant~~
      — dépend de la section 6, abandonnée côté site.

Pour chaque commande :
- [ ] **Aide intégrée** auto-générée à partir de la définition
- [ ] **Validation des permissions** (admin vs public)
- [ ] **Réponse ephemeral** quand pertinent (résultats privés)
- [ ] **Logs** des invocations vers `/internal/log` (consommable par le feed)

---

## 8. OAuth & invitation

- [ ] **URL d'invitation officielle** avec scopes
      `bot + applications.commands` et permissions integer `1099511627776`
      (déjà dans le design ; doit correspondre aux scopes réellement utilisés)
- [ ] **Wizard de setup** déclenché au join sur un nouveau serveur
      (auto-déclaration, prompt admin pour configurer les modules)
- [ ] **Endpoint OAuth callback** côté site déjà géré pour le login utilisateur
      (`/api/auth/google/callback` équivalent à créer pour Discord si pas déjà
      présent) — vérifier qu'on n'a pas un trou ici

---

## 9. Wiring côté app Next.js

À faire dans ce repo une fois les endpoints bot livrés :

- [ ] **Étendre `BotStats`** dans [lib/shared/types.ts](lib/shared/types.ts) avec les nouveaux champs
- [ ] **Ajouter dans [lib/server/bot-integration.ts](lib/server/bot-integration.ts)** :
  - [ ] `fetchBotStatus()` → status système
  - [ ] `fetchBotKpis()` → KPIs avec séries
  - [ ] `fetchBotServers()` → liste serveurs
  - [ ] `fetchBotActivity(range)` → données chart
  - [x] ~~`fetchBotModules(serverId)` / `toggleBotModule(serverId, key, on)`~~ —
        **abandonné** : la section « Modules » de `/bot` a été retirée (elle
        rendait son en-tête au-dessus d'une grille vide tant que le bot
        n'exposait rien), et l'appel sortant est parti avec elle. Ne pas le
        recréer sans rouvrir la décision — voir `CLAUDE.md`, section « Page `/bot` ».
- [ ] **Endpoint SSE proxy** `/api/bot/feed/stream` (similaire à
      `/api/tournaments/[id]/stream`) pour le live feed
- [x] ~~**Remplacer les mocks** dans `components/bot/mocks.ts` par les vrais fetchs~~ —
      **fait autrement** : le fichier a été supprimé. La liste de commandes
      qu'il portait n'est pas refaite côté serveur, la section renvoie à
      `/bot/docs`, qui lit le Markdown du bot à chaud.
- [ ] **Mode dégradation gracieuse** : si le bot est down (circuit breaker
      déjà en place), afficher placeholders sans crash de la page

---

## 10. Observabilité bot

Pour faciliter le debug et nourrir le dashboard :

- [ ] **Métriques Prometheus** ou équivalent (latence, throughput, erreurs)
- [ ] **Logs structurés** JSON pour les événements (auth, relay, scrim)
- [ ] **Healthcheck** `GET /internal/health` → 200 si tous les modules nominaux
- [ ] **Rate limiting** par serveur (le design affiche un tag `warn` pour
      `Rate-limit · DPS Diff Club (12 msg/min)`)

---

## Hors scope (volontairement)

- Refonte de l'interface admin du bot (web ou CLI)
- Système de modération
- Intégration de jeux autres qu'Overwatch et Marvel Rivals
- Multi-langue (le bot reste FR comme le site)
