# 16 — Round Suisse : types partagés et migration de schéma

## Objectif

Préparer le terrain pour l'implémentation du mode Round Suisse : types TypeScript partagés, nouvelles colonnes en base, helpers de format. **Aucune logique métier dans cette tâche** — uniquement les fondations.

## Référence

Lire `plans/SwissRound.md` pour la spec fonctionnelle complète (principes, BYE, tie-breakers).

## Fichiers concernés

- `lib/shared/types.ts`
- `lib/server/database.ts` (bloc de migration auto)
- *(éventuellement)* `lib/server/seed.ts` pour seeder un exemple de tournoi suisse

## Hors périmètre

- Pas d'algorithme d'appariement (cf. tâche 17).
- Pas de génération de bracket (cf. tâche 18).
- Pas d'UI.

## Implémentation

### 1) Étendre les types

Dans `lib/shared/types.ts`, à côté de `TournamentFormat` (probablement `"single-elim" | "double-elim"` actuellement) :

```ts
export type TournamentFormat = "single-elim" | "double-elim" | "swiss";

export type SwissTournamentMeta = {
  totalRounds: number;       // fixé à la création
  currentRound: number;      // 0 = pas commencé, 1..totalRounds en cours/fini
  pointsForWin: number;      // par défaut 3
  pointsForDraw: number;     // par défaut 1
  pointsForLoss: number;     // par défaut 0
  pointsForBye: number;      // par défaut pointsForWin (ou 1 si on veut moins)
  tiebreakers: SwissTiebreaker[]; // ordre d'application
};

export type SwissTiebreaker = "buchholz" | "sonneborn-berger" | "opponent-mwp" | "head-to-head";

export type SwissParticipantStanding = {
  teamId: number;
  teamName: string;
  points: number;
  wins: number;
  draws: number;
  losses: number;
  byes: number;
  opponentIds: number[];    // historique pour éviter rematchs
  buchholz: number;
  rank: number;
};

export type SwissPairing = {
  round: number;
  matches: Array<{
    matchId: number | null; // null tant que persisté
    teamAId: number;
    teamBId: number | null; // null = bye
  }>;
};
```

### 2) Migration SQL (auto)

Dans `lib/server/database.ts`, bloc de migration :

```sql
ALTER TABLE bg_tournaments
  ADD COLUMN IF NOT EXISTS swiss_total_rounds INT NULL,
  ADD COLUMN IF NOT EXISTS swiss_current_round INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swiss_points_win INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS swiss_points_draw INT NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS swiss_points_loss INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS swiss_points_bye INT NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS swiss_tiebreakers_json JSON NULL;
```

Et étendre l'ENUM `format` :
```sql
-- Si la colonne est ENUM, ALTER pour ajouter 'swiss'
ALTER TABLE bg_tournaments MODIFY COLUMN format ENUM('single-elim','double-elim','swiss') NOT NULL;
```

Ajouter une table pour le standings courant (recalculé à chaque ronde) :

```sql
CREATE TABLE IF NOT EXISTS bg_swiss_standings (
  tournament_id INT NOT NULL,
  team_id INT NOT NULL,
  points INT NOT NULL DEFAULT 0,
  wins INT NOT NULL DEFAULT 0,
  draws INT NOT NULL DEFAULT 0,
  losses INT NOT NULL DEFAULT 0,
  byes INT NOT NULL DEFAULT 0,
  opponent_ids_json JSON NOT NULL,
  buchholz DECIMAL(6,2) NOT NULL DEFAULT 0,
  rank INT NOT NULL DEFAULT 0,
  PRIMARY KEY (tournament_id, team_id),
  CONSTRAINT fk_swiss_standings_tournament FOREIGN KEY (tournament_id) REFERENCES bg_tournaments(id) ON DELETE CASCADE,
  CONSTRAINT fk_swiss_standings_team FOREIGN KEY (team_id) REFERENCES bg_teams(id) ON DELETE CASCADE
);
```

Et étendre `bg_matches` pour stocker le round :

```sql
ALTER TABLE bg_matches
  ADD COLUMN IF NOT EXISTS swiss_round INT NULL,
  ADD COLUMN IF NOT EXISTS is_bye BOOLEAN NOT NULL DEFAULT FALSE;
```

(Si une colonne `round` existe déjà pour les brackets éliminatoires, **ne pas la réutiliser** — c'est un concept distinct.)

### 3) Helpers

Dans `lib/shared/swiss.ts` (nouveau, **shared** car le front en a besoin pour afficher le standings) :

```ts
export function computeRecommendedRounds(participantCount: number): number {
  if (participantCount <= 1) return 0;
  return Math.ceil(Math.log2(participantCount)) + 1;
  // 8→4, 16→5, 32→6, 128→8
}

export function formatPoints(points: number): string {
  return points % 1 === 0 ? String(points) : points.toFixed(1);
}
```

### 4) Pas de logique d'orchestration ici

Cette tâche s'arrête aux fondations. La création d'un tournoi suisse, la génération du premier round, l'appariement, le scoring : tout cela viendra dans les tâches 17–20.

## Acceptation

- [ ] Types ajoutés sans casser ceux existants.
- [ ] Migration SQL appliquée au prochain démarrage (`npm run dev` puis check `DESCRIBE bg_tournaments`).
- [ ] `npm run build` clean.
- [ ] Aucun test cassé.

## Discipline

- **Pas de logique** : juste des types et du SQL.
- **`shared` ne tape pas la DB.** Le helper `computeRecommendedRounds` reste pur.
- **Migration idempotente** : `ADD COLUMN IF NOT EXISTS`, `CREATE TABLE IF NOT EXISTS`.
- **Documenter dans `CLAUDE.md`** (section « Tournament Engine ») l'ajout du format `swiss` (3 lignes max).
