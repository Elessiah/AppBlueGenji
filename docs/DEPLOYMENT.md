# Déploiement

La production sert le site avec `next start` derrière nginx, sous pm2. Le bot
vit dans son propre dépôt et son propre processus pm2.

```bash
./update.sh          # git pull --ff-only → npm ci → build → restart → contrôle HTTP
```

Le script s'arrête à la première erreur et **vérifie que le site répond** avant
de se déclarer fini. Un déploiement qui ne contrôle rien annonce un succès
qu'il n'a pas constaté : c'est ainsi qu'une panne reste invisible jusqu'au
premier visiteur.

## `npm ci` : scripts d'installation et paquets dépréciés

Le serveur tourne sous **npm 12**, qui bloque par défaut les scripts
d'installation des dépendances et en liste chaque omission à la fin de
`npm ci`. Le champ `allowScripts` de `package.json` les **refuse
explicitement** (`false`), ce qui fait taire l'avertissement sans rien casser :

| Paquet | Script | Pourquoi on s'en passe |
|---|---|---|
| `esbuild` (via `tsx`) | vérifie le binaire, remplace le lanceur JS | le binaire arrive par la dépendance optionnelle `@esbuild/<plateforme>` — vérifié en prod : `tsx` et `esbuild` fonctionnent sans lui |
| `unrs-resolver` (ESLint, Jest) | repli si la liaison native manque | idem, `@unrs/resolver-binding-<plateforme>` |
| `@parcel/watcher` (Jest) | compilation depuis les sources si aucun binaire | idem, et ne sert qu'au mode `--watch` |

Un nouveau paquet à script apparaîtra de nouveau dans l'avertissement : le
relire (`npm install-scripts ls`), puis le refuser (`npm install-scripts deny
<pkg>`) ou, s'il en a réellement besoin, l'approuver (`npm install-scripts
approve <pkg>`, épinglé à la version relue).

Les avertissements `deprecated` de `glob@7`/`inflight` venaient de Jest 29 ;
Jest 30 et l'override `test-exclude@^8` (le dernier à tirer `glob@10`, lui
aussi déprécié) les ont fait disparaître.

## Les journaux : `pm2 flush`, jamais `rm`

**C'est le piège qui a mis le site à terre le 16/09/2026**, et il ne ressemble
pas à un piège.

pm2, en mode `fork`, **ouvre les fichiers de journal avant de lancer le
processus**. Effacer ces fichiers ne libère pas la place tant que pm2 les tient
— et surtout, au redémarrage suivant, l'ouverture échoue :

```
PM2 error: [Error: ENOENT: no such file or directory,
            open '/home/elessiah/apps/logs/bluegenji-out-0.log']
```

Le lancement avorte. L'entrée reste dans `pm2 list`, en `stopped`, mais son
identifiant n'existe plus pour le démon — d'où le symptôme déroutant :

```
$ pm2 restart bluegenji
[PM2] Applying action restartProcessId on app [bluegenji](ids: [ 1 ])
[PM2][ERROR] Process 1 not found      ← alors que `pm2 list` l'affiche
```

`pm2 start 1`, `pm2 restart 1`, `pm2 restart bluegenji` échouent tous pareil :
ils visent un identifiant que le démon a perdu.

**Purger correctement :**

```bash
pm2 flush                # vide les journaux en place, descripteurs intacts
pm2 flush bluegenji      # un seul processus
```

`pm2-logrotate` est installé et fait déjà tourner les fichiers ; une purge
manuelle ne devrait presque jamais être nécessaire.

**Se remettre d'une entrée perdue** — supprimer puis recréer à l'identique,
`pm2 describe <nom>` donnant les valeurs exactes :

```bash
pm2 delete bluegenji
pm2 start /chemin/vers/node_modules/next/dist/bin/next \
  --name bluegenji --cwd /chemin/vers/AppBlueGenji --interpreter node \
  --output /chemin/vers/logs/bluegenji-out-0.log \
  --error  /chemin/vers/logs/bluegenji-err-0.log \
  -- start -H 127.0.0.1 -p 3000
pm2 save                 # sans ça, un reboot restaure l'ancienne entrée cassée
```

Le `pm2 save` n'est pas optionnel : il fige l'entrée réparée dans
`~/.pm2/dump.pm2`, que `pm2 resurrect` relit au démarrage de la machine.

## Ce que `start.sh` ne fait pas

`start.sh` démarre le serveur, et rien d'autre. Il a longtemps enchaîné
`git pull`, `npm run build`, `npm run test`, `npm run seed` puis `next start` —
c'est-à-dire qu'un simple redémarrage changeait la version servie, pouvait
échouer sur un test instable, et **aurait écrit le jeu de test dans la base de
production**. pm2 ne passe pas par ce fichier (il lance le binaire de Next
directement), si bien que le piège ne se serait déclenché que sur un `npm start`
tapé à la main — ce qui le rendait d'autant plus dangereux.

`tests/scripts/deploy-scripts.test.ts` garde ces deux fichiers à la source :
rien n'y est exécuté, c'est leur **forme** qui est tenue.

## Base de données

Le seed ne se pose jamais sur la production : `npm run seed` refuse de tourner
quand `NODE_ENV=production`, avant toute connexion. Le refus porte sur
`NODE_ENV` et non sur `DB_HOST` — la base écoute sur `127.0.0.1` des deux côtés.

Pour rapatrier les photos de profil restées chez leur hébergeur d'origine :

```bash
NODE_ENV=production npm run backfill:avatars     # conçu pour tourner en production, idempotent
```

`NODE_ENV=production` n'est pas décoratif : les scripts `tsx` choisissent leurs
fichiers d'environnement d'après lui (`lib/server/script-env.ts`), et le shell du
serveur ne l'exporte pas — seul pm2 le pose. Sans lui, `.env.production` n'est
pas lu et le script meurt sur `Missing required environment variable DB_HOST` ;
il affiche désormais juste avant la commande à relancer. Même règle pour
`npm run replay:deletions`.
