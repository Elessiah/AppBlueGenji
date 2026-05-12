# 20 — Round Suisse : intégration UI

## Objectif

Permettre à un admin de **créer** un tournoi suisse, aux équipes de s'**inscrire** comme aujourd'hui, et à tous d'**afficher** le bracket suisse (standings + matches par ronde) à la place du bracket éliminatoire.

## Pré-requis

- Tâches 16–19 terminées.

## Fichiers concernés

- Modifier : `app/admin/tournaments/new/page.tsx` (ou équivalent — chercher le formulaire de création)
- Modifier : `app/(secured)/tournois/[id]/page.tsx` (rendu conditionnel selon format)
- Nouveau : `app/(secured)/tournois/[id]/_components/SwissView.tsx`
- Nouveau : `app/(secured)/tournois/[id]/_components/SwissStandingsTable.tsx`
- Nouveau : `app/(secured)/tournois/[id]/_components/SwissRoundList.tsx`
- API : route `GET /api/tournaments/[id]/standings` (si pas déjà incluse dans le payload)

## Hors périmètre

- Pas de modification du flux de saisie de score : `ScoreInputDialog` existant fonctionne tel quel (un match suisse est un match).
- Pas d'éditeur visuel de pairings (l'admin n'override pas l'appariement dans cette itération).
- Pas d'export PDF / classement papier.

## Implémentation

### 1) Création de tournoi

Dans le formulaire admin de création :

- Ajouter `"swiss"` à l'option « Format » du `<select>`.
- Si `format === "swiss"` :
  - Afficher un champ « Nombre de rondes » (numérique, optionnel — si vide, calculé via `computeRecommendedRounds`).
  - Afficher en read-only le système de points (3/1/0) — pour cette itération, pas de personnalisation.
- À la soumission : POST inclut `format: "swiss"` et `swissTotalRounds`.

Côté API de création : valider `swissTotalRounds` est `null` ou entier entre 1 et 15.

### 2) Page détail tournoi — rendu conditionnel

Dans `app/(secured)/tournois/[id]/page.tsx`, après chargement :

```tsx
{tournament.format === "swiss" ? (
  <SwissView tournament={tournament} matches={matches} standings={standings} />
) : (
  <BracketView matches={matches} … />
)}
```

`standings` vient soit du payload existant, soit d'un nouvel endpoint :

```
GET /api/tournaments/:id/standings → ExtendedStanding[]
```

### 3) `SwissView`

```tsx
export function SwissView({ tournament, matches, standings }) {
  const currentRound = tournament.swissCurrentRound ?? 0;
  return (
    <>
      <SwissProgressBar current={currentRound} total={tournament.swissTotalRounds} />
      <SwissRoundList matches={matches} currentRound={currentRound} onScoreClick={...} />
      <SwissStandingsTable standings={standings} />
    </>
  );
}
```

### 4) `SwissStandingsTable`

Tableau dense avec colonnes :
- Rank
- Équipe (logo + nom)
- V – N – D
- Points
- Buchholz
- Byes

Highlight de la première place jusqu'à `pointsForWin` × `totalRounds`. Pendant que le tournoi est `RUNNING`, le tableau se met à jour via SSE (réutiliser `useTournamentLive`).

### 5) `SwissRoundList`

Liste verticale des rondes, chacune avec ses matchs (`MatchRow` réutilisé) + statut « En cours / Complétée ».
- Les rondes futures (non encore générées) ne s'affichent pas — uniquement la ronde courante et les passées.
- Match BYE affiché avec un libellé clair : `<TeamName> — BYE (+3 pts)`.

### 6) Toasts

- Au passage automatique d'une ronde à la suivante (détecté côté SSE), `showSuccess("Ronde 2 démarrée — appariements générés.")`.
- À la fin du tournoi, `showSuccess("Tournoi terminé. Classement final disponible.")`.

## Acceptation

- [ ] Admin peut créer un tournoi `swiss` avec 4–32 équipes.
- [ ] Page détail affiche standings live + liste des rondes.
- [ ] Saisie de score d'une ronde déclenche, une fois tous les matches confirmés, la génération de la ronde suivante sans rechargement (via SSE).
- [ ] BYE clairement identifié visuellement.
- [ ] Classement final cohérent avec les tie-breakers (tâche 19).
- [ ] `npm run lint` + `npm run build` clean.

## Discipline

- **Pas de duplication de `MatchRow`** : réutiliser celui créé en tâche 11.
- **Pas de fetch direct** dans `SwissView` : tout vient du parent via props.
- **`useTournamentLive` étendu si besoin** pour publier `standings` updates — mais pas de nouveau hook concurrent.
- **Pas de magie visuelle excessive** : un tableau lisible vaut mieux qu'un graphe en bracket forcé. Le suisse n'est pas un bracket éliminatoire.
