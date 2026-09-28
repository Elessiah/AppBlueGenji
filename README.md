# BlueGenji Esport — plateforme de tournois

Site de l'association **BlueGenji Esport** : tournois amateurs francophones sur **Overwatch** et **Marvel Rivals**, fiches d'équipes et de joueurs, classement du site, et intégration avec le bot Discord [`blueGenjiBot`](https://github.com/Elessiah/blueGenjiBot).

## Fonctionnalités

- **Vitrine publique** : accueil (tournoi en direct, classement, calendrier, partenaires), association, page du bot et sa documentation, règles de chaque mode de tournoi (`/regles`), recrutement, pages légales (RGPD et registre des traitements, conditions d'utilisation, déclaration d'accessibilité).
- **Connexion sans mot de passe** : OAuth Google (et Google One Tap), OAuth Discord, OAuth Blizzard, ou code à six chiffres envoyé en message privé par le bot. Les identités se rattachent depuis « Applications connectées » sur `/profil`.
- **Tournois** : simple et double élimination, Ronde suisse, Survie par coupes, BlueGenji Survie (capital d'endurance puis arbre à huit) et tournois multi-phases ; tournois par équipes ou individuels, format des matchs (BO / FT, match nul optionnel), conditions d'inscription, ordre de départ réordonnable, lancement des matchs avec « Prêt », report et arbitrage des scores, forfaits et doubles forfaits, retour en arrière d'une manche, diffusions et rediffs.
- **Temps réel** : flux SSE par tournoi (`/api/tournaments/[id]/stream`), un instantané calculé une fois pour tous les spectateurs.
- **Équipes et joueurs** : rôles cumulables, invitations, sigle, logo, équipes fantômes, statistiques approfondies et classement Elo avec points de parcours.
- **Modération** : signalements ouverts à tous, contestation, quarantaine des logos.
- **Discord** : rappels de match, alertes d'arbitrage et journal d'activité, rédigés par le site et distribués par le bot.
- **Accessibilité** : menu de réglages (contraste renforcé, focus, liens soulignés, police, espacement, animations) sur chaque page.

## Stack

- Next.js 15 (App Router), React 18, TypeScript strict
- MySQL 8 en développement, **MariaDB 11.8 en production** — `mysql2`, sans ORM ; le schéma est créé à la première requête (`lib/server/database.ts`)
- CSS Modules + `app/globals.css`, Radix UI Slot, Lucide
- Jest (tests unitaires), Playwright (tests de bout en bout)

## Prérequis

- Node.js 20+
- MySQL 8+ (ou MariaDB 11+)
- Le bot `blueGenjiBot` démarré avec son API interne, pour les codes de connexion et les messages Discord (le site fonctionne sans, en mode dégradé)

## Installation

```bash
npm install
cp .env.production.example .env   # puis renseigner les valeurs
npm run dev
```

Les tables `bg_*` sont créées automatiquement au premier accès API.

### Variables d'environnement

| Variable | Rôle |
| --- | --- |
| `DB_HOST`, `DB_USER`, `DB_PASSWORD`, `DB_DATABASE` | Connexion à la base |
| `APP_URL` | Adresse publique du site (ex. `http://localhost:3000`), à régler aussi au moment du `build` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | Connexion Google |
| `DISCORD_AUTH_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI` | Connexion Discord (`DISCORD_AUTH_CLIENT_ID` retombe sur `DISCORD_BOT_CLIENT_ID`) |
| `BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, `BLIZZARD_REDIRECT_URI`, `BLIZZARD_REGION` | Connexion Blizzard |
| `DISCORD_BOT_CLIENT_ID`, `DISCORD_BOT_PERMISSIONS` | Lien d'invitation du bot |
| `BOT_INTERNAL_URL`, `BOT_INTERNAL_TOKEN` | API interne du bot (`BOT_INTERNAL_TOKEN` = `INTERNAL_API_TOKEN` du bot) |
| `BOT_DOCS_PATH` | Chemin du dépôt du bot, pour `/bot/docs` (défaut : `../blueGenjiBot`) |
| `VISIT_HASH_SALT` | Sel des empreintes de visite (recommandé en production) |
| `TRUSTED_PROXY_HOPS`, `TRUSTED_PROXY_REAL_IP` | Proxys de confiance devant l'application |
| `DEV_AUTH_USER_ID` | Développement seulement : connecte d'office ce compte (inactif hors `NODE_ENV=development`) |

Les redirections OAuth ont une valeur par défaut dérivée d'`APP_URL`.

## Commandes

```bash
npm run dev            # serveur de développement (Turbopack)
npm run build          # compilation de production
npm run start          # démarrage de production
npm run lint           # ESLint
npm run typecheck      # tsc sur l'application et sur tests/
npm test               # Jest
npm run test:coverage  # Jest avec couverture
npm run test:e2e       # Playwright
npm run seed           # jeu de test (écrase les données préfixées Test_, refusé en production)
npm run seed:view      # inspecte le jeu de test
```

Scripts prévus pour la production (`NODE_ENV=production`) : `npm run backfill:avatars` (rapatrie les photos restées chez leur hébergeur) et `npm run replay:deletions` (rejoue les suppressions de compte après restauration d'une sauvegarde — lancer d'abord avec `--dry-run`).

## Application installée — limite connue

Le site est installable (manifeste `/manifest.webmanifest`, voir [`docs/features/WEB_APP_MANIFEST.md`](docs/features/WEB_APP_MANIFEST.md)), en mode `minimal-ui` et **jamais `standalone`**.

**Le risque** : lancée en mode autonome depuis l'écran d'accueil d'iOS, l'app a ses propres cookies, et l'aller-retour de la connexion Google, Discord ou Blizzard s'ouvre dans une feuille Safari qui ne les partage pas. La connexion échoue alors (`?error=state` le plus souvent), ou réussit dans la feuille en laissant l'app déconnectée. Le manifeste évite ce mode, mais un joueur peut l'imposer (« Ouvrir en tant qu'app web », activé par défaut depuis iOS 26). Les navigateurs intégrés des applications (Instagram, TikTok, WebView Android…) posent le même problème. Le code Discord par message privé, qui ne quitte pas la page, fonctionne partout.

**Ce que fait le site** : `/connexion` reconnaît ces deux contextes (`lib/shared/login-environment.ts`) et affiche, **au-dessus des boutons et avant le clic**, un avertissement qui nomme les deux sorties : ouvrir le site dans un autre navigateur (Safari sur iOS), ou passer par le code Discord. Pour l'app iOS, c'est le seul moment utile : la redirection d'erreur s'ouvre dans la feuille Safari, qui ne se sait plus installée et ne peut plus nommer la cause. Dans un navigateur intégré, l'erreur revient au même endroit, et le message d'échec (`state`, `oauth`, `params`, `session`) reçoit en plus le même conseil. Le cas silencieux — connexion réussie dans la feuille, app restée déconnectée — ne produit aucune erreur : seul l'avertissement préalable le couvre.

## Déploiement

`./update.sh` — voir [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

## Documentation

- [`CLAUDE.md`](CLAUDE.md) : architecture, conventions et règles de travail
- [`docs/features/`](docs/features) : une fiche par fonctionnalité
- [`docs/DATABASE_SCHEMA.md`](docs/DATABASE_SCHEMA.md), [`docs/AUTHORIZATION_RULES.md`](docs/AUTHORIZATION_RULES.md)
- [`ACCESSIBILITE.md`](ACCESSIBILITE.md) et [`ERREUR.txt`](ERREUR.txt) : points d'accessibilité et erreurs connus, à traiter

## Contribuer

Une branche `feature/<nom>` par fonctionnalité, puis une Pull Request vers `main`. Le CI enchaîne lint + typecheck, build et tests ; ne pas fusionner s'il est rouge.
