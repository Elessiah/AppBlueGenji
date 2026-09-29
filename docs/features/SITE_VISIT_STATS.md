# Fréquentation du site (`/stats-site`)

> **Mise à jour** — les visites ne gardent plus aucun lien vers un compte :
> `user_id` est remplacée par un simple drapeau `authenticated`, et le sel est
> obligatoire en production. Voir `docs/features/RGPD_LOGS_AND_VISITS.md`, qui
> fait foi là où ce document parle encore d'identifiant de compte.

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
| `bg_site_visits` | Une ligne par visite : empreinte, drapeau « connecté », chemin, date. **Gardée `SITE_VISIT_DETAIL_RETENTION_DAYS` (31) jours.** |
| `bg_site_visit_days` | Une ligne par jour révolu : nombre de visites, heure de la première. |
| `bg_site_visitors` | Une empreinte par visiteur, et s'il a été vu connecté — rien d'autre. |

### Repli du détail

Les totaux « depuis toujours » se recalculaient à la lecture : sept
`COUNT(DISTINCT …)` sur toute la table, toutes les cinq minutes dès qu'il y a
des visites, sur une table que rien ne purgeait — mesuré à ~3 s pour 500 000
visites. Le détail n'est plus gardé que 31 jours :

- à chaque synchronisation (donc au plus toutes les cinq minutes),
  `rollUpExpiredSiteVisits` reporte les **jours entiers** antérieurs à la borne
  dans `bg_site_visit_days`, puis les efface — une seule borne, lue une fois, et
  une transaction : un report sans effacement compterait deux fois ;
- chaque visite enregistrée inscrit l'empreinte de son visiteur dans
  `bg_site_visitors` (un `INSERT … ON DUPLICATE KEY UPDATE`) : deux jours
  repliés ne disent pas combien de visiteurs ils ont en commun, le total des
  visiteurs uniques ne peut donc venir que de là. La table a été remplie une
  fois, au démarrage, depuis le détail existant ;
- la lecture balaie le seul détail restant (fenêtres 24 h / 7 j / 30 j) et lit
  les totaux sur les deux tables de cumul. Même base de 500 000 visites :
  ~0,25 s au lieu de ~3 s, et le coût ne grandit plus avec l'historique.

### Vie privée

Seule une empreinte **SHA-256 salée** est stockée : ni IP ni user-agent ne
touchent la base. Le sel vient de `VISIT_HASH_SALT`, à défaut du secret interne
déjà partagé avec le bot, à défaut d'une constante (dev local). **Renseigner
`VISIT_HASH_SALT` en production** : sans sel secret, une empreinte serait
théoriquement rejouable depuis une IP connue.

L'IP transite en mémoire le temps de la requête — pour le hachage et le plafond
de débit — et n'est écrite nulle part.

Aucun cookie n'est posé pour le comptage, et aucun chemin n'est conservé au-delà
de sa partie « page » (query string et fragment sont retirés, donc aucun
paramètre d'URL n'est archivé).

L'empreinte n'en reste pas moins une donnée **pseudonymisée**, donc personnelle :
l'association détient le sel et peut recalculer l'empreinte d'un compte (`u:<id>`)
ou d'un couple IP + navigateur. C'est ainsi que `/rgpd#audience` la présente
(finalité, intérêt légitime, durées, destinataires — dont la commande publique
`/stats-site`, qui ne sert que des totaux —, droit d'opposition), en accord avec
la fiche T06 du registre. Deux points restent à trancher et sont consignés dans
`ERREUR.txt` : un moyen technique de s'opposer, et une durée pour l'empreinte de
`bg_site_visitors`, aujourd'hui gardée sans limite.

### Identité du visiteur et abus

L'empreinte étant dérivée d'en-têtes fournis par le client, la fenêtre de session
ne protège **pas** d'un client qui en change à chaque requête : chaque empreinte
neuve échapperait à la fenêtre et insérerait une ligne. Deux garde-fous :

- **IP retenue = celle qu'ajoute le proxy**, pas celle qu'annonce le client.
  `X-Forwarded-For` se lit `client, proxy1, proxy2` et chaque relais ajoute à
  droite l'adresse dont il a reçu la requête : on compte donc depuis la droite,
  sur `TRUSTED_PROXY_HOPS` relais (défaut 1 = un nginx devant l'app). Un
  `X-Forwarded-For` fabriqué par le visiteur est ainsi sans effet. **Ajuster
  cette variable si la chaîne de proxys est plus longue** (CDN + nginx = 2),
  faute de quoi c'est l'IP du CDN qui serait retenue et tous les visiteurs
  seraient regroupés.
- **Plafond de 30 lignes insérées par IP et par minute**, en mémoire du
  processus. Ce sont bien les *insertions* qu'on plafonne, pas les requêtes : un
  chargement absorbé par la fenêtre de session ne consomme rien, sans quoi
  plusieurs vrais visiteurs partageant une sortie NAT (école, entreprise, réseau
  mobile) s'épuiseraient mutuellement leur quota et seraient sous-comptés. Le
  client qui fabrique une empreinte neuve à chaque requête, lui, insère à chaque
  fois et atteint le plafond immédiatement. C'est le seul rempart contre une
  croissance illimitée de la table — aucune déduplication par empreinte ne peut
  jouer ce rôle, l'empreinte venant du client.

Les lignes ne sont **pas** purgées : « visites totales » est un total depuis la
mise en service, qu'une rétention tronquerait.

### Concurrence

L'insertion est conditionnelle **en une seule requête** (`INSERT … SELECT …
WHERE NOT EXISTS`) plutôt qu'en « lire puis insérer » : la fenêtre de course se
réduit à l'exécution d'une requête, et disparaît tout à fait tant que MySQL
verrouille la lecture (isolation `REPEATABLE READ`, celle par défaut). En
`READ COMMITTED`, la lecture est cohérente mais non verrouillée : deux
chargements rigoureusement simultanés peuvent alors compter deux visites.
L'écart est d'une unité, sans effet sur le nombre de visiteurs uniques — et
aucun invariant de schéma ne peut de toute façon exprimer « une seule ligne par
fenêtre glissante ».

### Cadence de synchronisation

L'app ne pousse au bot que lorsqu'une visite a **réellement** été créée, et au
plus une fois toutes les 5 minutes. Tant que personne ne visite, les chiffres ne
bougent pas : l'instantané du bot reste donc juste sans aucune tâche périodique.

Une lecture impossible **n'envoie rien** : `getSiteVisitStats()` renvoie `null`
en cas d'erreur de base, là où une table réellement vide renvoie des zéros. La
distinction est essentielle — sans elle, une panne passagère écraserait le
dernier bon instantané du bot par des zéros, et `/stats-site` afficherait « 0
visite » jusqu'à la visite suivante. La cadence n'est pas consommée dans ce cas,
pour que la visite d'après retente aussitôt.

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
