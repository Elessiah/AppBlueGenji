# 14 — Découpler `TournamentBoard` de la couche DB

## Objectif

`components/cyber/landing/TournamentBoard.tsx` accède directement à la DB via `loadMiniBracket()`. Un composant de rendu ne doit pas faire de DB. Choisir entre :
- **Option A** : faire descendre la donnée depuis `app/page.tsx` (serveur).
- **Option B** : passer par un endpoint API si la donnée doit changer côté client.

**Choix retenu : Option A** (plus simple, déjà server-side).

## Fichiers concernés

- `components/cyber/landing/TournamentBoard.tsx`
- `app/page.tsx`
- *(possiblement)* `lib/server/tournaments/bracket-*.ts` (export d'un helper `getMiniBracket`)

## Hors périmètre

- Pas de modification du design du board.
- Pas de SSE / live updates ajouté pour cette tâche.

## Implémentation

### 1) Identifier `loadMiniBracket()`

Trouver son implémentation actuelle (probablement à l'intérieur du composant ou dans un fichier voisin). Si elle utilise `pool.query(...)`, c'est du server-only. **Déplacer dans `lib/server/tournaments/bracket-loader.ts`** (ou un nom équivalent à choisir cohérent avec la tâche 10).

```ts
// lib/server/tournaments/bracket-loader.ts
export async function loadMiniBracket(tournamentId: number): Promise<MiniBracket | null> {
  // … logique SQL existante
}
```

### 2) `app/page.tsx`

Choisir le tournoi à afficher (logique de `chooseNextTournament` déjà présente), puis charger son mini-bracket en parallèle :

```ts
const featured = chooseNextTournament(buckets);
const miniBracket = featured ? await loadMiniBracket(featured.id) : null;
// …
<TournamentBoard buckets={buckets} featured={featured} miniBracket={miniBracket} />
```

### 3) `TournamentBoard.tsx`

Devient un composant **pur** :

```tsx
type Props = {
  buckets: TournamentBuckets;
  featured: TournamentCard | null;
  miniBracket: MiniBracket | null;
};

export function TournamentBoard({ buckets, featured, miniBracket }: Props) {
  // Aucune dépendance à DB, ni à `async`.
}
```

Si `TournamentBoard` était `async` server component, il peut rester server component, **mais** sans accès DB. Si tu préfères, le passer en client component pour expliciter l'absence de fetch ; choisis selon les autres dépendances du fichier.

### 4) Cas où `miniBracket` est null

Afficher le placeholder existant (« Pas de tournoi à venir »).

## Acceptation

- [ ] `TournamentBoard.tsx` n'importe plus rien depuis `lib/server/*`.
- [ ] `loadMiniBracket` vit dans `lib/server/tournaments/`.
- [ ] Aucun accès DB dans `components/cyber/landing/*`.
- [ ] `npm run build` clean.
- [ ] Page `/` affiche le board comme avant (visuel identique).

## Discipline

- **Composant de rendu = props pures, pas de DB**. C'est une règle dure : tout composant dans `components/` doit pouvoir vivre sans la base de données.
- **Pas de fetch côté client** pour des données qui ne changent pas en live.
- Si un composant *doit* être live (`isLive`, scores en cours), passer par SSE existant (`/api/tournaments/[id]/stream`), pas par un fetch direct.
