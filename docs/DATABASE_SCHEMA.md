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

C'est exactement ce que fait le retrait de `bg_users.email`, seul `ALTER` que le
fichier porte encore. Une migration qu'on sait jouée partout peut ensuite être
retirée de cette section — c'est ce qui vient d'être fait pour les
soixante-trois autres.

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
