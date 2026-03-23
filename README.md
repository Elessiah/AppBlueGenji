# AppBlueGenji (Next.js)

Plateforme BlueGenji Arena:
- Landing 3 cartes (Bot / Association / Tournois)
- Auth sans mot de passe (Google OAuth + code Discord envoyé par bot)
- Profils joueurs (confidentialité + stats)
- Équipes (rôles cumulables, gestion Owner)
- Tournois (création, inscription, bracket simple/double, score reporting, live SSE)

## Prérequis

- Node.js 20+
- MySQL 8+
- Bot `blueGenjiBot` démarré avec son API interne active

## Variables d'environnement

Copier `.env.example` vers `.env`.

Variables nécessaires:

- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_DATABASE`
- `APP_URL` (ex: `http://localhost:3000`)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI` (ex: `http://localhost:3000/api/auth/google/callback`)
- `BOT_INTERNAL_URL` (optionnel, ex: `http://127.0.0.1:4400`)
- `BOT_INTERNAL_HOST` (optionnel, défaut: `127.0.0.1`)
- `BOT_INTERNAL_PORT` (optionnel, défaut: `4400`)
- `BOT_INTERNAL_TOKEN` (doit matcher `INTERNAL_API_TOKEN` du bot)

## Démarrage

```bash
npm install
npm run dev
```

Les tables `bg_*` sont créées automatiquement au premier accès API.

## Build

```bash
npm run build
npm run start
```

## Notes

- Le classement final est calculé automatiquement à la fin du tournoi.
- Les conflits de score sont envoyés au bot via endpoint interne (`sendLog`).
- Le bracket se met à jour en temps réel via SSE (`/api/tournaments/[id]/stream`).
