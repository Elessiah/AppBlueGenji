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

## Notifications push : les clés VAPID

Le push est éteint tant que `VAPID_PUBLIC_KEY` et `VAPID_PRIVATE_KEY` manquent
(`docs/features/PUSH_NOTIFICATIONS.md`). Pour l'allumer :

```bash
npm run push:keys
```

puis recopier les deux lignes (et un `VAPID_SUBJECT` en `mailto:`) dans
`.env.production`, et redémarrer. **Une seule fois** : la clé publique est
gravée dans chaque abonnement d'appareil, et changer la paire rend tous les
abonnements existants muets — chaque joueur devrait réactiver les
notifications sur chacun de ses appareils. La clé privée se sauvegarde avec le
reste de la configuration, hors du dépôt.

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

## Plafond de débit des pages (nginx)

**Rien, dans l'application, ne plafonne le rechargement d'une page.** Les
plafonds de `lib/server/api-guard.ts` ne couvrent que les routes `/api/*`, et
depuis que la politique de sécurité du contenu pose un nonce par requête
(`app/layout.tsx`, `await headers()`), aucune page n'est plus prérendue : chaque
F5 refait un rendu serveur complet, et le serveur le termine même quand le
navigateur l'a abandonné pour le suivant. Les lectures coûteuses sont en cache
(vitrine, liste des tournois, instantanés, statistiques — `lib/server/stats-cache.ts`),
si bien qu'un humain qui martèle F5 ne coûte presque que du processeur ; un
script, lui, peut saturer le Raspberry Pi à coups de rendus.

Le plafond des documents se pose donc **au proxy**, seul endroit qui voie toutes
les requêtes avant qu'elles coûtent quoi que ce soit, et qui compte pour tous les
processus. La configuration nginx n'est pas versionnée ici (elle est partagée
avec un autre site) : le bloc ci-dessous est à reporter à la main.

```nginx
# Contexte http {} — noms préfixés : la configuration est partagée.
#
# Deux zones, parce que deux sortes de requêtes arrivent sur `location /`. En
# production, Next **précharge** chaque lien qui entre à l'écran
# (`next-router-prefetch: 1`) : une page de trente cartes en envoie trente d'un
# coup, que le visiteur n'a pas demandées. Comptées avec les pages, elles
# videraient la rafale d'une salle de joueurs en quelques secondes. Elles ont
# donc leur seau, plus large — et non une exemption : l'en-tête est forgeable,
# un script le poserait pour échapper à tout plafond.
#
# Une clé vide n'est comptée dans aucune zone : chaque requête ne tombe que
# dans l'une des deux.
map $http_next_router_prefetch $bluegenji_page_key {
    ""      $binary_remote_addr;
    default "";
}
map $http_next_router_prefetch $bluegenji_prefetch_key {
    ""      "";
    default $binary_remote_addr;
}
limit_req_zone $bluegenji_page_key     zone=bluegenji_pages:10m    rate=5r/s;
limit_req_zone $bluegenji_prefetch_key zone=bluegenji_prefetch:10m rate=30r/s;
limit_req_status 429;

server {
    # … server_name, certificats, etc.

    # En-têtes du proxy : **ici, au niveau du server, et nulle part dans une
    # location**. nginx hérite de `proxy_set_header` en tout ou rien — une
    # location qui en déclare un seul perd tous ceux du server, si bien qu'y
    # ajouter X-Forwarded-For retirerait Host et le schéma à cette location-là.
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # Fichiers de build et images optimisées : une page en demande des
    # dizaines, les compter ferait refuser la page suivante à une salle entière.
    # L'optimiseur garde son résultat sur disque : il ne recalcule pas.
    location /_next/ {
        proxy_pass http://127.0.0.1:3000;
    }

    # Fichiers de `public/` (pastilles, icônes) et images téléversées : même
    # raison. Une location regex l'emporte sur un préfixe : `/api/uploads/…`
    # passe ici, pas par `/api/`.
    location ~* \.(?:png|jpe?g|gif|webp|avif|svg|ico|txt|xml|woff2?)$ {
        proxy_pass http://127.0.0.1:3000;
    }

    # API : l'application plafonne elle-même, route par route et par compte.
    # Le flux SSE ne doit ni être plafonné ni mis en tampon.
    location /api/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_buffering off;
    }

    # Pages (documents HTML et navigations du routeur) : 5 par seconde et par
    # IP, rafale de 50 servie sans attente. Préchargements : 30 par seconde,
    # rafale de 300.
    location / {
        limit_req zone=bluegenji_pages burst=50 nodelay;
        limit_req zone=bluegenji_prefetch burst=300 nodelay;
        proxy_pass http://127.0.0.1:3000;
    }
}
```

Trois points à ne pas perdre en l'adaptant :

- **Le plafond est par IP, et une IP n'est pas une personne.** Un tournoi en
  réseau local sort tout entier par la même adresse : 5 pages par seconde et une
  rafale de 50 laissent naviguer une salle de joueurs, et ne bornent qu'un
  script. Ne pas descendre en dessous sans l'avoir mesuré.
- **`X-Forwarded-For` doit rester posé**, et au niveau du `server` : c'est de lui que
  l'application tire l'IP de ses propres plafonds (`TRUSTED_PROXY_HOPS`, défaut
  1 = ce nginx). Sans lui, une identité absente n'est volontairement **pas**
  plafonnée (`enforceRateLimit`), et tous les plafonds par IP tombent. Si la
  configuration en place pose déjà ses en-têtes dans chaque location, y
  reporter les trois lignes plutôt que de n'en ajouter qu'une.
- **Essayer d'abord à blanc** : `limit_req_dry_run on;` (nginx ≥ 1.17.1) dans
  `location /` journalise les refus sans les appliquer (les deux zones). Une soirée de tournoi
  sans ligne `limiting requests, dry run` dans `error.log`, puis on retire la
  directive.

Vérification, depuis une autre machine, une fois la configuration rechargée
(`sudo nginx -t && sudo systemctl reload nginx`) :

```bash
for i in $(seq 1 80); do curl -s -o /dev/null -w "%{http_code}\n" https://<domaine>/; done | sort | uniq -c
```

Une cinquantaine de `200`, puis des `429`.

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
