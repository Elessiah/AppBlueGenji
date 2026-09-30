# Journal des données de connexion (LCEN)

L'association **héberge les contenus que publient ses membres** (logos
d'équipe, avatars, noms d'équipe). À ce titre, elle conserve **un an** les
données techniques de connexion qui permettent d'en identifier l'auteur, pour
les communiquer à une autorité judiciaire qui les requiert (loi pour la
confiance dans l'économie numérique, art. 6 ; décret n° 2021-1362). Décision
prise par l'association ; base légale **obligation légale** (RGPD, art. 6.1.c),
fiche **T14** du registre.

## Ce qui est écrit

Table `bg_connection_logs` — une ligne par **ouverture de session** :

| Colonne      | Contenu                                                                 |
|--------------|-------------------------------------------------------------------------|
| `user_id`    | Compte connecté — **sans clé étrangère** (voir plus bas)                |
| `event_type` | Porte : `LOGIN_GOOGLE`, `LOGIN_DISCORD`, `LOGIN_BLIZZARD`, `LOGIN_DISCORD_CODE` |
| `ip`         | Adresse retenue par la chaîne des proxys de confiance, ou `NULL`        |
| `created_at` | Date et heure                                                           |

- **Point de passage unique** : `createSession` (`lib/server/auth.ts`), par
  lequel passent les quatre portes (OAuth Google, Discord, Blizzard par
  `oauth-flow.ts`, code Discord par `/api/auth/discord/verify`). L'appelant
  nomme sa porte.
- **Adresse** : `clientIpFromHeaders` (`lib/server/api-guard.ts`), la même
  lecture que les plafonds de débit — `X-Forwarded-For` parcouru depuis la
  droite sur `TRUSTED_PROXY_HOPS` relais, `X-Real-IP` seulement si
  `TRUSTED_PROXY_REAL_IP=true`. Jamais un en-tête client pris tel quel ; et
  `connectionLogIp` n'écrit que ce qui a la forme d'une adresse (45 caractères
  au plus). Illisible ou absente, la ligne part sans adresse.
- **Jamais bloquant** : `recordConnection` ne lève pas ; une panne est écrite
  dans les journaux du serveur et la connexion est servie.
- **Contenus publiés** : ils n'ont pas de point de passage unique (logo,
  avatar, nom d'équipe passent par des routes distinctes) et ne sont donc pas
  journalisés à part ; c'est la connexion qui précède la publication qui
  identifie l'auteur. Décision requise si une journalisation par contenu est
  exigée (voir `ERREUR.txt`).

## Durée et purge

`CONNECTION_LOG_RETENTION_DAYS = 365` (`lib/shared/connection-logs.ts`),
constante citée par le registre, `/rgpd`, les mentions légales et l'entrée
`PRIVACY_CHANGES`. La purge (`DELETE … WHERE created_at < NOW() - INTERVAL 365
DAY`) suit les connexions elles-mêmes, au plus une fois par heure et par
processus — aucun ordonnanceur.

## Suppression de compte, accès, export

- La ligne **survit à la suppression du compte** jusqu'à son échéance (RGPD,
  art. 17.3.b) : pas de clé étrangère, et aucun chemin de suppression ne touche
  la table. La phrase de confirmation de suppression le dit.
- **Aucune route de lecture.** Le journal ne se consulte que sur réquisition
  d'une autorité, par le responsable technique, en base.
- **Export RGPD** : `connectionLogs` dans `GET /api/profile/export` (droit
  d'accès, art. 15), tant que le compte existe.

## Schéma

Table neuve : `CREATE TABLE IF NOT EXISTS` la crée aussi sur une base qui
tourne, aucune entrée de migration n'est due.

## Ce qui reste hors de ce lot

Les informations fournies à la création du compte (que le décret vise aussi)
suivent toujours l'effacement ou l'anonymisation à la suppression, et le
journal d'accès nginx n'a pas de fiche : décisions requises, consignées dans
`ERREUR.txt`.
