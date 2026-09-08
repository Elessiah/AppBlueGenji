# Migrations : verrou nommé et oubli des échecs

Le schéma se rejoue **à chaque démarrage de processus** : `getDatabase()` appelle
`ensureMigrations`, qui déroule les quelque quatre-vingts instructions de
`runMigrations` (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE … ADD COLUMN`, …).
C'est volontaire — il n'y a pas d'outil de migration dans le projet, la base se
met à niveau toute seule au premier accès.

- Politique : `lib/server/migration-lock.ts`
- Point d'entrée : `ensureMigrations` dans `lib/server/database.ts`

## Le symptôme

Après une vingtaine de minutes de `next dev`, toute page protégée tombait en
« Application error », et l'échec était **définitif** : seul un redémarrage du
serveur débloquait. En cause, `ER_LOCK_DEADLOCK` levé par un
`ALTER TABLE bg_tournaments`.

Deux fautes distinctes s'additionnaient, et il fallait les deux corrections.

## 1. Deux processus jouaient les migrations en même temps

`next dev` ne tient pas le site dans un seul processus, et chacun rejoue le
schéma pour son compte. MySQL, mis devant deux `ALTER TABLE` concurrents sur la
même table, déclare un interblocage et en choisit une victime.

Une garde en mémoire ne pouvait rien : elle ne protège que **son** processus, or
c'est précisément entre deux processus que la collision se produit. D'où un
verrou **consultatif nommé**, qui vit dans le serveur MySQL :

```sql
SELECT GET_LOCK('bg_migrations', 60)
```

Deux détails de mise en œuvre comptent :

- `GET_LOCK` est lié à la **session**, pas à la requête. Le verrou est donc pris
  et rendu sur **une même connexion**, empruntée au pool pour toute la durée des
  migrations ; celles-ci continuent, elles, de passer par le pool — la connexion
  qui tient le verrou n'a pas à être celle qui travaille.
- Si le `RELEASE_LOCK` échoue (connexion perdue), la connexion est **détruite**
  au lieu d'être rendue au pool. C'est alors la fin de la session qui libère le
  verrou ; recyclée, elle le garderait, et le prochain démarrage attendrait
  soixante secondes pour rien.

`GET_LOCK` rend `1` (obtenu), `0` (délai dépassé) ou `NULL` (erreur serveur) :
seul `1` autorise à jouer les migrations, les deux autres lèvent.

## 2. La victime restait morte

`ensureMigrations` mémorisait la promesse de `runMigrations` — **y compris
rejetée**. Chaque requête suivante la réattendait et récoltait le même échec,
sans jamais retenter la manœuvre : d'où le caractère définitif de la panne, alors
même que rejouer aurait suffi (l'interblocage est transitoire, et les migrations
sont idempotentes).

`createOnceGate()` ne mémorise donc **que les succès** : un rejet efface la
promesse et l'appel suivant rejoue la tâche. L'oubli se fait sur l'**identité**
de la promesse — entre le rejet et le rappel, un autre appelant a pu en démarrer
une nouvelle, qu'il ne faut surtout pas effacer.

Le partage entre appels concurrents est conservé : cent requêtes qui arrivent
ensemble sur une base neuve attendent la même exécution, pas cent.

## Ce que cela ne change pas

Les `try { … } catch {}` qui entourent la plupart des instructions de
`runMigrations` restent tels quels : ils absorbent le « existe déjà » d'une base
à jour. Le verrou traite la **concurrence**, la porte traite la **reprise** ;
aucun des deux ne rend une migration ratée silencieuse.
