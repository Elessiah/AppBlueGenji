# 17 — Round Suisse : moteur d'appariement (pur, testable)

## Objectif

Implémenter l'algorithme d'appariement Suisse Hollandais simplifié, **sans accès DB**, **sans I/O**. Module pur testable à 100%.

## Référence

`plans/SwissRound.md` — règles fondamentales (sections 3, 4).

## Fichiers concernés

- Nouveau : `lib/shared/swiss-pairing.ts`
- Nouveau : `tests/swiss/pairing.test.ts`

## Hors périmètre

- Pas d'écriture en base.
- Pas de gestion des couleurs (échecs). Notre jeu est symétrique → on ignore.
- Pas d'intégration avec le service tournois (cf. tâche 18).

## Implémentation

### API du module

```ts
export type Participant = {
  teamId: number;
  points: number;
  opponentIds: number[];   // pour éviter rematchs
  hasReceivedBye: boolean;
};

export type Pairing = {
  teamAId: number;
  teamBId: number | null;  // null = bye
};

export function pairFirstRound(participants: Participant[], seed?: number): Pairing[];
export function pairNextRound(participants: Participant[]): Pairing[];
```

### Règles à implémenter (par ordre de priorité)

**Round 1 :**
- Si seed fourni, trier par seed asc, sinon shuffle déterministe (`crypto.randomInt`).
- Apparier moitié haute vs moitié basse (1 vs N/2+1, 2 vs N/2+2, …).
- Si nombre impair, le dernier participant (le plus bas) reçoit un BYE.

**Rounds suivants :**
1. Trier les participants par score décroissant. Tie-break secondaire : id asc (déterministe).
2. Regrouper par score identique (« score groups »).
3. Pour chaque groupe (du plus haut au plus bas) :
   - Apparier deux à deux selon l'ordre.
   - Si un appariement viole « éviter rematchs » : tenter de swap avec le prochain joueur du même groupe ; si impossible, descendre dans le groupe inférieur (« float down »).
4. Si nombre impair :
   - Sélectionner pour le BYE le joueur du groupe le plus bas **qui n'a pas encore reçu de BYE**.
   - Si tous ont déjà reçu un BYE (cas rare), accorder le BYE au joueur ayant le plus faible score.
5. Le BYE compte comme une victoire en points (`pointsForBye` configurable côté caller — ici l'algo ne sait pas, il renvoie juste les paires).

### Heuristique simple (backtracking limité)

Implémentation pragmatique :

```ts
export function pairNextRound(participants: Participant[]): Pairing[] {
  const sorted = [...participants].sort((a, b) =>
    b.points - a.points || a.teamId - b.teamId,
  );

  const remaining = [...sorted];
  const pairings: Pairing[] = [];

  // Gestion BYE pour nombre impair
  if (remaining.length % 2 === 1) {
    const byeIndex = pickByeIndex(remaining);
    const [byeParticipant] = remaining.splice(byeIndex, 1);
    pairings.push({ teamAId: byeParticipant.teamId, teamBId: null });
  }

  // Appariement glouton avec swap pour éviter rematchs
  while (remaining.length > 0) {
    const a = remaining.shift()!;
    const candidateIdx = remaining.findIndex(
      (b) => !a.opponentIds.includes(b.teamId),
    );
    const idx = candidateIdx === -1 ? 0 : candidateIdx; // si tous déjà joués, accepter rematch (cas limite)
    const [b] = remaining.splice(idx, 1);
    pairings.push({ teamAId: a.teamId, teamBId: b.teamId });
  }

  return pairings;
}

function pickByeIndex(participants: Participant[]): number {
  for (let i = participants.length - 1; i >= 0; i--) {
    if (!participants[i].hasReceivedBye) return i;
  }
  return participants.length - 1;
}
```

C'est volontairement simple. Une heuristique plus avancée (recherche complète, équilibrage des écarts de score) pourra venir plus tard.

### Tests obligatoires

```ts
test("round 1 with 8 participants pairs 1-5, 2-6, 3-7, 4-8 (seed sorted)", …);
test("round 1 with 7 participants gives a bye to the lowest seed", …);
test("round 2 pairs winners against winners and losers against losers", …);
test("round 3 avoids rematch if possible", …);
test("bye is awarded to a participant that has not yet received one", …);
test("deterministic output for same input", …);
```

## Acceptation

- [ ] `lib/shared/swiss-pairing.ts` ne fait **aucun** import depuis `lib/server/*`.
- [ ] Tests `swiss/pairing.test.ts` couvrent au moins 6 cas (voir liste).
- [ ] `npm test` clean.
- [ ] Output déterministe pour mêmes entrées.

## Discipline

- **Pas d'I/O dans un algo.** Le module reçoit des données, renvoie des données.
- **Pas de Math.random sans seed.** Pour les cas non déterministes (shuffle initial), exposer un paramètre `seed`.
- **Pas d'optimisation prématurée.** Heuristique greedy d'abord ; optimisation Edmonds plus tard si besoin.
- **Tests d'abord, code après** : écrire un test échouant avant chaque règle implémentée.
