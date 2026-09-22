# Le schéma MySQL

> **`lib/server/database.ts` décrit le schéma tel qu'il est, pas l'histoire de la
> façon dont on y est arrivé.**

## Ce que ce fichier était

Une poignée de `CREATE TABLE` d'origine, puis **soixante-trois `ALTER TABLE`**
empilés au fil des fonctionnalités — chacun dans son `try {} catch {}`, parce
qu'il devait retomber en silence sur une base qui l'avait déjà subi.

Le coût n'était pas théorique :

- **On ne pouvait plus lire une table.** La définition de `bg_tournaments`
  s'étalait sur mille lignes, entre le `CREATE` d'origine (six colonnes) et une
  vingtaine d'`ALTER` disséminés. Pour savoir si une colonne existait, il fallait
  parcourir le fichier entier.
- **L'ordre des colonnes n'avait plus de sens.** Il racontait la chronologie des
  fonctionnalités, jamais la structure de l'objet.
- **Chaque démarrage rejouait le passé.** Conversions d'ENUM, backfills,
  `UPDATE` de rattrapage et créations d'index — sans objet depuis des mois, mais
  relus à chaque redémarrage, certains en balayage de table complète.
- **Les échecs étaient muets par construction.** Un `ALTER` dans un `catch {}`
  vide ne distingue pas « déjà appliqué » de « a échoué pour une autre raison ».

## Ce qu'il est

Un `CREATE TABLE` par table, à son état final, groupé par domaine : comptes,
équipes, tournois, classements des moteurs à rejeu, multi-phases, notifications
envoyées, vitrine. Les colonnes y sont rangées par famille et commentées là où
leur nom ne suffit pas.

## La contrepartie, à connaître avant de toucher au fichier

> Sur une base qui existe déjà, **`CREATE TABLE IF NOT EXISTS` ne fait rien**.
> Il ne rattrape ni une colonne ni un index manquants.

Replier les anciens `ALTER` dans les `CREATE` n'est donc sans danger que parce
que **la production porte déjà le schéma complet** : elle a joué tous ces
`ALTER`, un par un, avant cette consolidation. Une base restée à une version
antérieure n'est **pas** rattrapée par ce fichier et doit être migrée à la main.

## La règle pour la suite — inchangée

Un changement de schéma s'écrit **à deux endroits** :

1. dans le `CREATE TABLE`, pour les bases neuves ;
2. en `ALTER TABLE` tolérant dans la section « Migrations », pour celles qui
   tournent déjà.

Une migration qu'on sait jouée partout peut ensuite être retirée de cette
section — c'est ce qui a été fait pour les soixante-trois anciennes.

### Ce qui est replié, et ce qui ne l'est pas

Replier un `ALTER` dans son `CREATE TABLE` n'est sans danger que si **toute base
vivante l'a déjà joué**. Les soixante-trois anciens remplissent cette condition.
Les changements **récents** — ceux dont on ne peut pas affirmer que le serveur
les a vus passer — restent donc écrits aux deux endroits, dans la liste
`RECENT_SCHEMA_CHANGES` de `lib/server/database.ts`. Elle porte des
**instructions entières** et non des triplets table/colonne/type : un triplet ne
sait dire qu'`ADD COLUMN`, si bien que la règle n'aurait couvert ni un `ENUM`
élargi, ni un index posé, ni une clé primaire recomposée — la prochaine valeur de
`format` n'aurait existé que dans le `CREATE TABLE`, et la base qui tourne aurait
rendu « Data truncated for column 'format' » sur le premier tournoi créé.

Ce qu'elle contient aujourd'hui :

| PR | Table | Colonne |
|---|---|---|
| #135 | `bg_discord_login_challenges` | `handle` |
| #135 | `bg_users` | `discord_verified_at` |
| #135 | `bg_tournaments` | `registration_discord_requirement` |
| #135 | `bg_tournaments` | `registration_min_players` |
| #136 | `bg_users` | `blizzard_sub` |
| #137 | `bg_tournaments` | `registration_blizzard_requirement` |

Le coût est nul : chaque entrée retombe en silence quand la colonne est là, et le
bloc ne fait rien sur une base neuve. **La liste est faite pour rétrécir** — une
colonne dont un déploiement a confirmé le passage se retire d'ici, sa définition
restant dans la table. Ce qu'il ne faut pas faire, c'est la retirer *par
anticipation* : la panne n'apparaît qu'au redémarrage, sur une requête qui nomme
la colonne, et il est alors trop tard pour la reposer sans interruption.

### Le filet : dire qu'une base est en retard

La prémisse de tout ce fichier — « la production porte déjà les soixante-trois
`ALTER` » — était **affirmée et jamais vérifiée**. Si elle est fausse d'une seule
version, la base démarre sans bruit (`CREATE TABLE IF NOT EXISTS` ne fait rien)
et la panne se découvre en production sur la première requête qui nomme une
colonne absente.

`warnIfSchemaIsBehind` lit `information_schema.COLUMNS` une fois au démarrage et
journalise les écarts. Les témoins sont pris dans le **dernier lot replié**,
celui qui a le plus de chances de manquer : les migrations étant jouées dans
l'ordre, une base à jour sur ce lot l'est sur les précédents.

Il en surveille **trois classes**, parce qu'un simple contrôle de présence n'en
voit qu'une :

| Classe | Témoin | Ce qui arriverait sans le filet |
|---|---|---|
| Colonne **absente** | `bg_matches.phase_id` | « Unknown column » sur la première requête qui la nomme |
| Colonne présente mais du **mauvais type** | `bg_tournaments.game` doit contenir `'OW'` et **plus** `'OW2'` | Une base restée avant la conversion `ENUM('OW2','MR')` → `ENUM('OW','MR')` porte bien la colonne, et rend « Data truncated for column 'game' » au premier tournoi écrit |
| Colonne qui devait **partir** | `bg_users.email` | Le `DROP` est best-effort, jamais rejoué dans le processus (la porte mémorise une passe qui se résout toujours), et `anonymizeOwnAccount` a perdu son `email = NULL` dans la même version : les adresses resteraient, sans que rien ne les efface |
| **Index** absent | `uniq_bg_teams_tag`, `uniq_bg_teams_solo_user` | La plus silencieuse de toutes : un index unique manquant ne fait *rien* tomber, il cesse seulement de trancher la course qu'il existe pour trancher — deux équipes créées au même instant prendraient le même sigle, et `mapTeamTagConflict` traduirait un `ER_DUP_ENTRY` qui n'arrive plus jamais |

Le témoin de type porte sur les **deux** faits : une base à demi convertie
affiche `enum('OW2','MR','OW')`, qui contient bien `'OW'` et passerait un filet
qui ne guetterait que la valeur neuve. Ce qui distingue une base à jour est
l'absence de l'ancienne.

Les index se lisent dans `information_schema.STATISTICS` et non dans `COLUMNS`,
d'où une seconde requête — dans son **propre** `try` : partageant celui des
colonnes, son échec jetait les constats déjà établis, dont le signal sur les
adresses. Le rapport vit en dehors des deux et dit ce qu'on sait, même
partiellement. L'argument « les migrations sont jouées dans l'ordre »
ne les couvre pas : chaque ancien `ALTER` était tolérant **indépendamment**, et
celui-là pouvait échouer de façon déterministe sur des données (des doublons de
sigle à libérer d'abord) pendant que les suivants passaient.

Elle **ne répare rien** et ne fait échouer personne. Une base en retard se migre
à la main ; interrompre le démarrage remplacerait un site dégradé par un site
éteint, et une base qui refuse `information_schema` reste servie comme avant.

### Si le retrait des adresses échoue

Le `DROP COLUMN email` est le **seul effaceur restant** : `anonymizeOwnAccount`
a perdu son `email = NULL` dans la même version, cette ligne n'ayant plus
d'objet. Un `ALTER` refusé — droit manquant, verrou de métadonnées tenace —
laisserait donc les adresses en place indéfiniment, y compris pour les comptes
qui ont demandé leur suppression.

D'où un repli qui ne demande **aucun DDL** : `UPDATE bg_users SET email = NULL`.
Il n'obtient pas le même résultat — la colonne survit, et il restera à la retirer
à la main — mais il obtient le seul qui soit urgent, et il se rejoue à chaque
démarrage tant que le `DROP` ne passe pas. Les deux issues sont journalisées.

### Avant de déployer

Le retrait de `bg_users.email` part dans **la même version** que celle qui retire
ses lecteurs. C'est voulu — une colonne d'adresses qui survit à son dernier
lecteur est une fuite en attente —, mais cela a une conséquence à connaître :
**un retour en arrière de la version applicative après ce déploiement casse les
lectures de session**, l'ancien `getCurrentUser()` demandant `u.email` à une
table qui ne l'a plus. Le retour en arrière passe alors par une restauration de
la colonne, pas par un simple `git revert` du déploiement.

### Ce qu'un `catch` a le droit d'avaler

Dans cette section, **un seul cas** : « la colonne est déjà là » (ou déjà
partie), le cas nominal d'une migration rejouée à chaque démarrage. C'est ce que
reconnaît `isSchemaNoOpError` (`lib/server/mysql-errors.ts`).

**Le même code ne dit pas la même chose selon l'instruction**, d'où le second
paramètre du prédicat. `ER_DUP_KEYNAME` en est l'exemple entier :

- sur `ADD COLUMN blizzard_sub … UNIQUE`, c'est une **anomalie**. MySQL voit la
  colonne avant l'index et aurait rendu `ER_DUP_FIELDNAME` si elle était là ;
  recevoir celui-ci dit donc que la colonne n'a *pas* été ajoutée.
- sur `ADD UNIQUE INDEX uniq_bg_teams_tag …`, c'est le **cas nominal** — l'index
  est déjà là, à chaque démarrage. Le traiter en anomalie poserait une fausse
  ligne d'échec à chaque redémarrage, et une alerte permanente cesse d'être lue :
  ce serait éroder le signal même qu'on a posé pour protéger le retrait des
  adresses.

`ER_MULTIPLE_PRI_KEY` suit la même règle sur un `ADD PRIMARY KEY`. Tout autre
échec —
droit `ALTER` manquant, verrou de métadonnées sur une table chaude — laisse le
schéma **en arrière du code** : la base démarre, et la panne se lit plus tard sur
une requête qui nomme la colonne.

Il est donc **journalisé**, et le démarrage se poursuit. Les trois issues
possibles ne se valent pas :

| | Effet |
|---|---|
| **Avaler** (`catch {}`) | Aucune trace. Pour le retrait de l'adresse, les adresses restent et plus rien ne les efface. |
| **Relancer** | 500 sur **toute** requête : `createOnceGate` n'a pas de mémoire de l'échec, la passe entière se rejoue à chaque appel sans recul, et les autres processus expirent sur le verrou nommé. Un dépassement de délai de verrou sur `bg_users` — la table la plus chaude du site — suffit à y entrer, et il est transitoire. |
| **Journaliser et poursuivre** | Le site reste debout, la migration se rejoue au prochain démarrage, et la panne est lisible là où on la cherche (`pm2 logs`, cf. `docs/DEPLOYMENT.md`). |

C'est `reportSchemaFailure` qui l'applique, aux deux migrations. Le cas nominal
ne journalise rien : il se produit à chaque démarrage, et une ligne par entrée
noierait la seule qui compte.

**Trois `CREATE TABLE` ne suivent pas cette règle**, et ce n'est pas un oubli :
`bg_match_reminders`, `bg_referee_alerts` et `bg_endurance_penalties` gardent un
`catch` muet, parce que c'est le contrat qu'`isMissingTableError` décrit et sur
lequel s'appuient les chemins de notification, `tournaments/deletion.ts` et
`tournaments/rollback.ts` — une base où leur création a échoué reste debout, et
un rappel, une alerte ou une sanction perdus valent mieux qu'un report de score
en erreur. Les autres tables ne sont pas tolérées : le site n'a rien à servir
sans elles.

### Ce qui ne pouvait pas être replié

Un **retrait** de colonne n'a aucune contrepartie dans un `CREATE TABLE` : la
colonne y est simplement absente, si bien qu'une table neuve ne la porte jamais
et qu'une base existante la garde pour toujours. Les deux `ALTER … DROP COLUMN`
restent donc dans la section « Migrations » quoi qu'il arrive, et ils disent la
même chose — une adresse que plus personne ne lit :

- `bg_recruitment_ads.contact_email`, qui a perdu son lecteur quand le contact
  d'une annonce est passé en « AUTO / DISCORD / LIEN » ;
- `bg_users.email`, détaillé ci-dessous.

La distinction n'est pas de la coquetterie sur le `DROP COLUMN email`, elle y est
même plus forte : ce `DROP` **est** l'effacement des adresses. Rien ne lit plus la
colonne, donc la base démarrerait parfaitement sans lui, et `anonymizeOwnAccount`
ne met plus l'adresse à `NULL` — cette ligne n'ayant plus d'objet. Un `ALTER`
refusé et avalé garderait donc les adresses **indéfiniment et en silence**, y
compris sur les comptes qui ont demandé leur suppression.

## Le retrait de `bg_users.email`

La colonne n'avait plus **aucun lecteur** : le scope `email` a disparu de la
demande faite à Google, et un compte ne se revendique plus par son adresse (voir
`docs/features/OAUTH_PROVIDERS.md`). Elle restait pourtant, avec les adresses
collectées avant la règle — garder une donnée que plus personne ne lit n'est pas
de la prudence, c'est une fuite en attente.

Elle part donc de la table, ce qui efface les valeurs du même geste. Ont suivi :
`AuthUser.email`, la lecture de session, l'anonymisation (`email = NULL` n'a plus
d'objet), l'export RGPD (`PersonalDataExport.account.email`) et le jeu de test.

**Le geste est irréversible et s'applique au prochain redémarrage.** Un retour en
arrière de la *version applicative* après ce déploiement casserait les lectures
de session : l'ancien code demande une colonne qui n'existe plus.

## Les rattrapages qui restent

Deux, et ce sont des **filets**, pas des migrations à cocher : leur cause peut se
reproduire, et ils sont donc volontairement rejoués à chaque démarrage. Tous deux
sont idempotents et ne trouvent rien à faire dans le cas nominal.

- **L'invitation Discord périmée** en pied de page (`bg_settings
  .contact_discord_url`). C'est une donnée que le staff peut modifier, donc
  corriger le dépôt ne la corrige pas ; et la panne serait muette, une invitation
  périmée menant toujours quelque part. Seules les adresses **périmées connues**
  sont remplacées — une invitation que le staff a saisie lui appartient.
- **Le logo d'une entrée solo** qui republierait un avatar masqué. Le masquage
  posé dans `solo-entries-service` ne vaut que pour les écritures à venir ; une
  ligne déjà écrite continuerait de servir l'image jusque sur la carte « match en
  direct » de l'accueil, que lit un visiteur sans compte.

Ceux qui ont disparu ne préparaient qu'une contrainte que le schéma porte
désormais (la mise en majuscules et la libération des doublons de sigles avant la
création de l'index unique), ou réparaient un défaut corrigé depuis (backfill du
seed suisse, `forfeit_team_id` invalides, `visible_pseudo` forcé à 1, conversion
`OW2` → `OW`, renommage `game` → `domain`).

## Voir aussi

- `lib/server/migration-lock.ts` — la porte à passage unique et le verrou nommé
  qui empêchent deux processus de jouer le schéma en même temps.
- `docs/features/OAUTH_PROVIDERS.md` — pourquoi le site ne collecte plus
  d'adresse.
