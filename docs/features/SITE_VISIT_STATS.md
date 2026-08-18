# Fréquentation du site (`/stats-site`)

Comptage des visites du site BlueGenji, restitué par une commande Discord du bot.

Deux nombres sont suivis :

- **Visites totales** — une visite = *une arrivée d'un visiteur sur le site*. Les
  chargements successifs d'un même visiteur pendant 30 minutes comptent pour une
  seule visite, faute de quoi un simple rafraîchissement gonflerait le compteur.
- **Visiteurs uniques** — nombre d'empreintes de visiteur distinctes. Un visiteur
  **connecté** est identifié par son compte (donc reconnu d'un appareil à
  l'autre) ; un visiteur anonyme l'est par le couple IP + user-agent. Le champ
  `identifiedVisitors` isole les comptes connectés : c'est le sous-ensemble
  strictement dédoublonné « par utilisateur ».

Conséquence assumée : un même humain vu anonyme puis connecté pèse deux
visiteurs uniques. Sans cookie de traçage, il n'y a pas de rapprochement possible
— et c'est le comportement voulu.

## Chemin de la donnée

```
navigateur ──POST /api/visits──► app (MySQL bg_site_visits)
                                     │
                                     │ POST /internal/site-visits  (canal interne existant,
                                     ▼  x-internal-token, timeout + coupe-circuit)
                                  bot (SQLite SiteVisit, 1 ligne)
                                     │
                                     ▼
                                  /stats-site
```

Le sens des appels est celui **déjà en place** entre les deux projets : l'app
appelle le bot (`lib/server/bot-integration.ts` → API Express `/internal/*` du
bot), jamais l'inverse. Le bot n'a donc besoin ni d'accès MySQL, ni d'une URL du
site, ni d'un second secret : `BOT_INTERNAL_TOKEN` / `INTERNAL_API_TOKEN`
suffisent, comme pour les codes de connexion et les logs.

Le bot conserve seulement le **dernier instantané** ; l'historique reste dans
MySQL, côté site. Conséquence pratique : `/stats-site` répond même site
injoignable, en indiquant l'ancienneté de la mesure.

## Côté site

| Élément | Rôle |
| --- | --- |
| `components/visit-tracker.tsx` | Monté dans le layout racine, signale une visite par chargement de page. Les navigations App Router ne le remontent pas : on mesure une arrivée, pas une page vue. |
| `app/api/visits/route.ts` | Endpoint public d'enregistrement. Ne renvoie jamais d'erreur au visiteur (`recorded: false` en cas de souci). |
| `lib/shared/site-visits.ts` | Logique pure : normalisation du chemin, composition de l'identité du visiteur, lecture de `X-Forwarded-For`. |
| `lib/server/site-visits-service.ts` | Enregistrement, agrégation, poussée vers le bot. |
| `bg_site_visits` | Une ligne par visite : empreinte, compte éventuel, chemin, date. |

### Vie privée

Seule une empreinte **SHA-256 salée** est stockée : ni IP ni user-agent ne
touchent la base. Le sel vient de `VISIT_HASH_SALT`, à défaut du secret interne
déjà partagé avec le bot, à défaut d'une constante (dev local). **Renseigner
`VISIT_HASH_SALT` en production** : sans sel secret, une empreinte serait
théoriquement rejouable depuis une IP connue.

Aucun cookie n'est posé pour le comptage, et aucun chemin n'est conservé au-delà
de sa partie « page » (query string et fragment sont retirés, donc aucun
paramètre d'URL n'est archivé).

### Concurrence

L'insertion est conditionnelle **en une seule requête** (`INSERT … SELECT …
WHERE NOT EXISTS`) : deux onglets ouverts en même temps ne peuvent pas créer deux
visites, là où un « lire puis insérer » laisserait passer la course.

### Cadence de synchronisation

L'app ne pousse au bot que lorsqu'une visite a **réellement** été créée, et au
plus une fois toutes les 5 minutes. Tant que personne ne visite, les chiffres ne
bougent pas : l'instantané du bot reste donc juste sans aucune tâche périodique.

## Côté bot

| Élément | Rôle |
| --- | --- |
| `POST /internal/site-visits` | Reçoit l'instantané. Corps sans compteur exploitable → 400 `INVALID_SITE_VISIT_STATS`. |
| `src/siteVisits/siteVisits.ts` | Validation tolérante, formatage français du message, lecture/écriture SQLite. |
| `src/commandsHandlers/statsSite.ts` | Commande `/stats-site` (publique, réponse éphémère). |
| Table `SiteVisit` | Ligne unique (`id = 1`) : dernier instantané + date de réception. |

La validation est volontairement tolérante — un champ absent vaut 0 — pour qu'une
version antérieure de l'app continue d'alimenter le bot pendant un déploiement
échelonné.
