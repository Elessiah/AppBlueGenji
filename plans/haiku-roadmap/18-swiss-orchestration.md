# 18 — Round Suisse : orchestration côté service tournois

## Objectif

Intégrer le moteur d'appariement (tâche 17) au service tournois (déjà splitté en tâche 10). Création d'un tournoi suisse, génération de la première ronde au passage `REGISTRATION → RUNNING`, génération des rondes suivantes après confirmation de tous les scores d'une ronde.

## Pré-requis

- Tâche 10 terminée (split de `tournaments-service.ts`).
- Tâche 16 terminée (types + schéma).
- Tâche 17 terminée (moteur pur).

## Fichiers concernés

- Nouveau : `lib/server/tournaments/swiss.ts` (orchestration)
- Modifier : `lib/server/tournaments/state.ts` (transition `REGISTRATION → RUNNING` déclenche `swiss.startTournament`)
- Modifier : `lib/server/tournaments/scoring.ts` (après chaque score confirmé, vérifier si la ronde est complète → générer la suivante)
- Modifier : `lib/server/tournaments/index.ts` (ré-exports)

## Hors périmètre

- Pas de tie-breakers ici (Buchholz, etc.) — tâche 19.
- Pas d'UI — tâche 20.
- Pas de modification des autres formats.

## Implémentation

### 1) `swiss.ts` — fonctions clés

```ts
import { pairFirstRound, pairNextRound, type Participant } from "@/lib/shared/swiss-pairing";
import { computeRecommendedRounds } from "@/lib/shared/swiss";

export async function initializeSwissTournament(tournamentId: number, conn: Connection): Promise<void> {
  // Lit les inscriptions, calcule totalRounds si pas fixé, initialise bg_swiss_standings.
}

export async function generateFirstRound(tournamentId: number, conn: Connection): Promise<void> {
  // Récupère participants, appelle pairFirstRound, insère les bg_matches avec swiss_round=1 et is_bye si applicable.
  // Met swiss_current_round=1.
  // Si bye : crée le match comme COMPLETED directement, attribue les points immédiatement.
}

export async function generateNextRound(tournamentId: number, conn: Connection): Promise<void> {
  // Vérifie que tous les matches de current_round sont COMPLETED.
  // Charge le standings, construit Participant[].
  // Appelle pairNextRound.
  // Insère les nouveaux matches, incrémente swiss_current_round.
  // Si current_round atteint totalRounds, passe le tournoi à FINISHED.
}

export async function applySwissMatchResult(matchId: number, conn: Connection): Promise<void> {
  // Appelé depuis scoring.ts quand un match suisse est confirmé.
  // Met à jour bg_swiss_standings des deux équipes (points, wins/losses/draws, opponentIds).
  // Si tous les matches de la ronde sont COMPLETED → appelle generateNextRound.
}
```

### 2) Transition d'état

Dans `state.ts`, la transition `REGISTRATION → RUNNING` :

```ts
if (tournament.format === "swiss") {
  await initializeSwissTournament(tournamentId, conn);
  await generateFirstRound(tournamentId, conn);
}
```

### 3) Hook dans `scoring.ts`

Après `confirmScore`, si `match.swiss_round !== null` :

```ts
await applySwissMatchResult(matchId, conn);
```

### 4) Gestion du BYE

À la génération de chaque ronde, pour la paire avec `teamBId === null` :
- Créer le `bg_matches` avec `is_bye=true`, statut `COMPLETED`, score1=`pointsForBye`, score2=0.
- Incrémenter immédiatement `byes`, `points`, et inclure dans `opponentIds` une valeur sentinelle (ou laisser vide — ne pas inclure de fausse team).
- **Ne pas notifier** le bot Discord pour les byes (silence intentionnel).

### 5) Transactions

Toutes les fonctions ci-dessus prennent une `Connection` en paramètre et doivent être appelées **dans une transaction existante** (`scoring.ts` ouvre déjà une transaction). Pas de commit ici — la transaction parente s'en charge.

### 6) Tests d'intégration

`tests/tournaments/swiss-flow.test.ts` :

```ts
test("end-to-end 8-team Swiss with 3 rounds yields a unique winner", async () => { … });
test("Swiss with 7 teams correctly assigns one bye per round", async () => { … });
test("Swiss tournament transitions to FINISHED after totalRounds", async () => { … });
```

## Acceptation

- [ ] Créer un tournoi `swiss` via le seed et démarrer → première ronde générée, scores rentrables.
- [ ] Saisir tous les scores d'une ronde → 2e ronde apparaît automatiquement.
- [ ] Après la dernière ronde, tournoi passe à `FINISHED`.
- [ ] BYE attribué correctement pour 7, 9, 11 équipes.
- [ ] Aucun rematch tant que mathématiquement évitable.
- [ ] `npm test` clean (intégration suisse + non-régression single/double).

## Discipline

- **Aucune logique d'appariement dans ce fichier.** Tout passe par `swiss-pairing.ts` (tâche 17).
- **Transactions transitives.** Ce module ne commit jamais : il reçoit la connexion.
- **Pas de `console.log` résiduel.** Si tu ajoutes des logs de debug, retire-les avant commit.
- **Notifications centralisées** dans `notifications.ts` (cf. tâche 10). Si tu publies un évènement live, c'est via un helper de ce module.
