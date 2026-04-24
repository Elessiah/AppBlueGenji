# Prompt de démarrage — Phase 3 (Endpoints landing additifs)

> Pré-requis : Phases 1 & 2 commitées (tokens cyber + primitives
> `components/cyber/*`).
>
> Copier-coller le bloc ci-dessous dans une nouvelle session Claude Code
> (Haiku 4.5) à la racine du projet `C:\work\BlueGenji\appbluegenji`.

---

```
Tu travailles sur la refonte « Cyber minimal » de BlueGenji.

LIS D'ABORD :
1. CLAUDE.md (section Architecture, Auth, Database, Tournament Engine,
   Live Updates, Conventions).
2. lib/server/database.ts (schéma SQL via auto-migration).
3. lib/server/tournaments-service.ts (listTournamentBuckets, etc.).
4. lib/server/teams-service.ts, lib/server/users-service.ts.
5. lib/server/live.ts (EventEmitter SSE — pour compter les viewers).
6. lib/server/http.ts (helpers ok/fail).
7. lib/shared/types.ts (TournamentCard, BracketMatch, etc.).
8. app/api/tournaments/route.ts et app/api/tournaments/[id]/stream/
   pour comprendre le style des routes existantes.

OBJECTIF (Phase 3 — endpoints landing STRICTEMENT ADDITIFS) :
Créer 5 routes GET sous app/api/landing/ sans altérer les routes
existantes (/api/tournaments, /api/teams, /api/players, /api/profile,
/api/auth, /api/admin, /api/bot). Aucune auth requise sur ces endpoints
(contenu public vitrine) — retourner directement, pas de getCurrentUser.

Utiliser systématiquement les helpers lib/server/http.ts (ok, fail) et
les services existants autant que possible. Toutes les requêtes SQL
doivent passer par `getDatabase()` exporté depuis lib/server/database.ts.

────────────────────────────────────────────────────────────────────
1. app/api/landing/stats/route.ts
────────────────────────────────────────────────────────────────────
GET -> ok({ players, teams, tournaments }) :
  players      = COUNT(*) FROM bg_users
  teams        = COUNT(*) FROM bg_teams
  tournaments  = COUNT(*) FROM bg_tournaments
Cache : `export const revalidate = 60;` (valeur Next.js = 60s).

────────────────────────────────────────────────────────────────────
2. app/api/landing/live/route.ts
────────────────────────────────────────────────────────────────────
GET -> ok({ live: LivePayload | null })

type LivePayload = {
  tournament: TournamentCard;        // depuis tournaments-service
  currentMatch: {
    id: number;
    team1Name: string | null;
    team2Name: string | null;
    team1Score: number | null;
    team2Score: number | null;
    bracket: BracketType;
    roundLabel: string;              // "Quarts de finale", "Demi-finale", ...
  } | null;
  viewers: number;                   // voir plus bas
};

Algorithme :
- Chercher le premier tournoi en state RUNNING trié par startAt DESC.
- Si aucun -> retourner { live: null }.
- Récupérer ses matches (services ou SQL direct sur bg_matches).
- Prendre le premier match status='READY' ou 'AWAITING_CONFIRMATION'
  avec le plus petit (bracket, roundNumber, matchNumber).
- Déduire roundLabel :
    final (1 match restant dans le bracket UPPER ou GRAND) -> "Finale"
    demi-finale (2 matchs)  -> "Demi-finale"
    quart (4)               -> "Quarts de finale"
    sinon                   -> `Round ${roundNumber}`
- viewers : exporter depuis lib/server/live.ts une fonction
  `getSubscribersCount(tournamentId: number): number` qui renvoie
  `getEmitter().listenerCount(\`tournament:${tournamentId}\`)`.
  L'ajouter au fichier existant sans casser l'API actuelle.

Cache : `export const dynamic = "force-dynamic";` (pas de cache, valeur
en temps réel).

────────────────────────────────────────────────────────────────────
3. app/api/landing/leaderboard/route.ts
────────────────────────────────────────────────────────────────────
GET ?game=all|ow2|mr&limit=8 -> ok({ leaderboard: LeaderboardRow[] })

type LeaderboardRow = {
  rank: number;
  teamId: number;
  teamName: string;
  logoUrl: string | null;
  wins: number;
  losses: number;
  points: number;                    // wins*100 - losses*20
  trend: "up" | "down" | "flat";     // delta rang vs snapshot 7j
  trendValue: number;                // |delta rang| (ex: 2), 0 si flat
};

Pour v1 (game ignoré côté DB — pas encore de colonne game sur
bg_tournaments), calculer l'agrégat sur TOUS les matchs COMPLETED :
  SELECT registration.team_id, COUNT(...) FILTER WHERE winner/loser...
Requête SQL concrète :
  SELECT
    t.id AS team_id, t.name, t.logo_url,
    SUM(CASE WHEN m.winner_team_id = t.id THEN 1 ELSE 0 END) AS wins,
    SUM(CASE WHEN m.loser_team_id  = t.id THEN 1 ELSE 0 END) AS losses
  FROM bg_teams t
  LEFT JOIN bg_matches m
    ON (m.team1_id = t.id OR m.team2_id = t.id)
   AND m.status = 'COMPLETED'
  GROUP BY t.id, t.name, t.logo_url
  ORDER BY (wins*100 - losses*20) DESC, wins DESC, t.name ASC
  LIMIT ?

Pour trend : calculer la même requête sur une fenêtre 7j précédente
(WHERE m.updated_at < NOW() - INTERVAL 7 DAY) et comparer les rangs.
Si l'équipe n'apparaissait pas dans la fenêtre précédente, trend="flat",
trendValue=0. Si delta rang > 0 (amélioration), trend="up".

Le paramètre `game` est accepté mais n'a pas d'effet pour l'instant —
loggue un warning si != "all" et retourne l'agrégat global. Ce sera
branché en Phase 6 quand bg_tournaments aura une colonne game.

Cache : revalidate = 300.

────────────────────────────────────────────────────────────────────
4. app/api/landing/calendar/route.ts
────────────────────────────────────────────────────────────────────
GET ?format=json|ics (défaut json) ?limit=5
  format=json -> ok({ events: CalendarEvent[] })
  format=ics  -> new NextResponse(icsText, { status: 200, headers: {
                   "Content-Type": "text/calendar; charset=utf-8",
                   "Content-Disposition": `attachment; filename="bluegenji.ics"`
                 }})

type CalendarEvent = {
  tournamentId: number;
  name: string;
  startAt: string;        // ISO
  registrationOpenAt: string;
  registrationCloseAt: string;
  state: TournamentState;
  maxTeams: number;
  registeredTeams: number;
};

Source : listTournamentBuckets() puis concaténer [...upcoming,
...registration, ...running] (PAS finished), trier par startAt asc,
limit.

Génération ICS :
  BEGIN:VCALENDAR
  VERSION:2.0
  PRODID:-//BlueGenji//Arena//FR
  CALSCALE:GREGORIAN
  ...
  BEGIN:VEVENT
  UID:bg-tournament-<id>@bluegenji-esport.fr
  DTSTAMP:<now en YYYYMMDDTHHMMSSZ>
  DTSTART:<startAt en YYYYMMDDTHHMMSSZ>
  DTEND:<startAt + 4h en YYYYMMDDTHHMMSSZ>
  SUMMARY:<name>
  DESCRIPTION:Inscriptions : <registrationOpenAt> → <registrationCloseAt>
  URL:<APP_URL>/tournois/<id>
  END:VEVENT
  ...
  END:VCALENDAR

- Utiliser process.env.APP_URL (fallback "http://localhost:3000").
- Respecter CRLF (\r\n) entre les lignes ICS (requis par RFC 5545).
- Échapper les virgules, points-virgules et retours-lignes dans SUMMARY
  et DESCRIPTION.

Cache : revalidate = 300.

────────────────────────────────────────────────────────────────────
5. app/api/landing/ticker/route.ts
────────────────────────────────────────────────────────────────────
GET -> ok({ items: string[] })

Source mixte agrégée (max 10 items, plus récent d'abord) :
- 3 derniers résultats de match COMPLETED :
    "RÉSULTAT · <tournamentName> · <team1> <s1> — <team2> <s2>"
- tous les tournois REGISTRATION ouverts :
    "INSCRIPTIONS · <name> · <registeredTeams>/<maxTeams> équipes"
- 2 derniers tournois FINISHED :
    "VAINQUEUR · <name> · <winnerTeamName>"
- Optionnel : si table bg_news existe, 3 dernières entrées publiées
  (ajoute un try/catch silencieux — si la table n'existe pas, skip).

Cache : revalidate = 60.

────────────────────────────────────────────────────────────────────
MODIFICATION MINIMALE DE lib/server/live.ts
────────────────────────────────────────────────────────────────────
Ajouter après la fonction subscribeTournament :

  export function getSubscribersCount(tournamentId: number): number {
    return getEmitter().listenerCount(key(tournamentId));
  }

Ne rien changer d'autre dans ce fichier.

────────────────────────────────────────────────────────────────────
TESTS MANUELS :
────────────────────────────────────────────────────────────────────
- curl http://localhost:3000/api/landing/stats          -> JSON 3 counts
- curl http://localhost:3000/api/landing/live           -> JSON live|null
- curl http://localhost:3000/api/landing/leaderboard    -> JSON top 8
- curl http://localhost:3000/api/landing/leaderboard?limit=3 -> top 3
- curl http://localhost:3000/api/landing/calendar       -> JSON events
- curl http://localhost:3000/api/landing/calendar?format=ics -> texte ICS
  avec headers Content-Type text/calendar
- curl http://localhost:3000/api/landing/ticker         -> JSON items[]

CONTRAINTES :
- Pas de modification des routes existantes sauf l'ajout à live.ts.
- Toutes les requêtes SQL préparées (placeholders `?`).
- Pas de any en TypeScript (le repo est en strict mode).
- Pas de dépendance externe nouvelle.
- Gestion d'erreur : try/catch -> return fail(message, 500).

CRITÈRE D'ACCEPTATION :
- npm run lint && npm run build -> success.
- Les 5 endpoints répondent 200 avec la forme JSON attendue.
- ICS valide (peut être ouvert par Apple Calendar / Google Calendar
  pour vérifier, optionnel).

Quand tu as fini, rapporte :
- Fichiers créés / modifiés.
- Pour chaque endpoint, 1 ligne de la réponse réelle observée via curl.
- Sorties lint/build.

Ne committe pas. N'ouvre pas de prompts de confirmation npm.
```

---

## Après Phase 3

Commit `feat(cyber): phase 3 — endpoints landing additifs`.
Phase 4 : refonte de `app/page.tsx` pour consommer ces endpoints.
