# Variables d'environnement

Bloc complet, commenté, déplacé depuis `CLAUDE.md`.

```env
DB_HOST=
DB_USER=
DB_PASSWORD=
DB_DATABASE=
APP_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
DISCORD_AUTH_CLIENT_ID=  # app Discord de connexion — défaut: DISCORD_BOT_CLIENT_ID (même app en pratique)
DISCORD_CLIENT_SECRET=  # connexion OAuth Discord
DISCORD_REDIRECT_URI=  # optional — défaut: <APP_URL>/api/auth/discord/callback
BLIZZARD_CLIENT_ID=  # connexion OAuth Blizzard (develop.battle.net)
BLIZZARD_CLIENT_SECRET=
BLIZZARD_REDIRECT_URI=  # optional — défaut: <APP_URL>/api/auth/blizzard/callback
BLIZZARD_REGION=  # optional — « cn » seulement, sinon origine mondiale
BOT_INTERNAL_URL=http://127.0.0.1:4400  # optional
BOT_INTERNAL_TOKEN=  # must match bot's INTERNAL_API_TOKEN
DEV_AUTH_USER_ID=  # optional — bypass auth in dev (see below)
BOT_DOCS_PATH=  # optional — chemin du projet blueGenjiBot (défaut: ../blueGenjiBot)
VISIT_HASH_SALT=  # recommandé — sel des empreintes de visiteur (défaut: BOT_INTERNAL_TOKEN)
TRUSTED_PROXY_HOPS=1  # optional — proxys de confiance devant l'app (X-Forwarded-For)
TRUSTED_PROXY_REAL_IP=false  # optional — n'accepter `X-Real-IP` que si le proxy le pose seul
VAPID_PUBLIC_KEY=  # optional — notifications push (`npm run push:keys`) ; absent = push éteint
VAPID_PRIVATE_KEY=  # à ne jamais changer une fois en production (clé gravée dans chaque abonnement)
VAPID_SUBJECT=  # optional — `mailto:` ou `https:` ; défaut : APP_URL si elle est en https
```
