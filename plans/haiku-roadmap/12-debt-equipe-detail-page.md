# 12 — Alléger `app/(secured)/equipes/[id]/page.tsx`

## Objectif

Page surchargée : chargement, édition meta, upload/suppression logo, gestion membres, transfert ownership, dialogs. Découper en sous-composants + hooks dédiés.

⚠️ Note : un dossier `plans/equipe-detail-rework/` existe déjà avec un découpage très détaillé pour cette page. **Avant de coder cette tâche, lire `plans/equipe-detail-rework/00-README.md`** et suivre cet ancien plan s'il n'est pas encore exécuté. Le présent fichier sert de **complément** si ce travail est déjà partiellement fait.

## Fichiers concernés

- `app/(secured)/equipes/[id]/page.tsx`
- Nouveau : `app/(secured)/equipes/[id]/_components/TeamHeader.tsx`
- Nouveau : `app/(secured)/equipes/[id]/_components/MembersSection.tsx`
- Nouveau : `app/(secured)/equipes/[id]/_components/LogoUploadDialog.tsx`
- Nouveau : `app/(secured)/equipes/[id]/_components/TransferOwnershipDialog.tsx`
- Nouveau : `app/(secured)/equipes/[id]/_hooks/useTeamDetail.ts`
- Nouveau : `app/(secured)/equipes/[id]/_hooks/useMemberManagement.ts`

## Hors périmètre

- Pas de changement de l'API serveur.
- Pas de refonte CSS.
- Si `plans/equipe-detail-rework/` est en cours, **ne pas créer de fichiers en doublon**.

## Implémentation

### Découpage cible

| Sous-composant | Responsabilité |
|---|---|
| `TeamHeader` | logo + nom + édition nom + bouton upload logo + transfert owner |
| `MembersSection` | liste + ajout + suppression + édition roles |
| `LogoUploadDialog` | dialog d'upload (utilise `POST /api/teams/:id/logo`) |
| `TransferOwnershipDialog` | dialog dédié au transfert |

### Hooks

`useTeamDetail(teamId)` :
- fetch initial du team
- gestion erreur / 404 (utilisera `useResourceLoader` créé en tâche 15)
- expose `team`, `loading`, `error`, `refresh`

`useMemberManagement(teamId, members)` :
- `addMember(userId)`, `removeMember(userId)`, `updateRoles(userId, roles[])`
- toasts via `useToast`
- pas de state local du tableau : refresh via callback `onChanged`

### Composant principal cible

```tsx
"use client";

export default function TeamDetailPage({ params }: { params: { id: string } }) {
  const teamId = Number(params.id);
  const { team, loading, error, refresh } = useTeamDetail(teamId);
  if (error) return <NotFound />;
  if (loading || !team) return <Loading />;

  return (
    <section className="fade-in">
      <TeamHeader team={team} onChanged={refresh} />
      <MembersSection teamId={teamId} members={team.members} onChanged={refresh} />
    </section>
  );
}
```

### Plan progressif

1. `useTeamDetail` (déduplique le pattern fetch+404+redirect)
2. `TeamHeader` (logo + nom)
3. `MembersSection` + `useMemberManagement`
4. `LogoUploadDialog`
5. `TransferOwnershipDialog`

## Acceptation

- [ ] `page.tsx` < 100 lignes.
- [ ] Toutes les actions passent par les hooks, jamais de `fetch` dans le composant page.
- [ ] Aucune régression : édition nom, upload logo, ajout/suppression membre, transfert.
- [ ] `npm run lint` + `npm run build` clean.

## Discipline

- **Une dialog = un fichier.** Pas de 3 dialogs dans le même composant.
- **Pas de state global.** Refresh par callback explicite.
- **Pas de hook géant.** `useMemberManagement` ne charge **pas** la team — il reçoit la liste en prop.
