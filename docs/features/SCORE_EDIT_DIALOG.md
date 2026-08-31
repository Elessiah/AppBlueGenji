# Dialogue d'édition d'un score

Le dialogue par lequel l'arbitrage (permission `tournaments`) saisit ou corrige
le résultat d'une manche, depuis le bouton « ✎ Éditer le score » d'une carte de
match. C'est le seul endroit du site d'où l'on écrit un score sans être engagé
dans le tournoi.

- Décision pure : `app/(secured)/tournois/[id]/_lib/score-form.ts`
- État et envoi : `app/(secured)/tournois/[id]/_hooks/useScoreForm.ts`
- Rendu : `app/(secured)/tournois/[id]/_components/AdminScoreDialog.tsx`
- Écriture serveur : `lib/server/tournaments/admin.ts`

## Deux actions, deux routes

Le dialogue propose deux gestes qu'il ne faut pas confondre — ce sont deux
routes serveur au comportement franchement différent :

| Action | Route | Ce qu'elle fait | Ce qu'elle exige |
|---|---|---|---|
| **Enregistrer le score** | `PATCH /api/admin/matches/[id]/scores` | écrit `team1_score` / `team2_score` **et rien d'autre** | le **plafond** du format |
| **Valider le résultat** | `POST /api/admin/matches/[id]/resolve` | désigne la gagnante, propage dans le plateau, réconcilie le format | l'**objectif** du format |

L'enregistrement existe pour noter l'avancement d'une rencontre en cours :
l'arbitre pose un 1-0 en BO5 pendant que le match se joue, sans trancher. La
validation est ce qui fait avancer le tournoi.

## Ce que le dialogue refuse, et pourquoi

`decideScoreForm` (pur) décide seul de ce qui est permis ; l'interface ne fait
qu'afficher ses refus, et le serveur applique les mêmes règles.

### Un match jamais joué s'ouvre sur des champs vides

Le dialogue affichait autrefois « 0 – 0 » sur un match sans le moindre score.
C'était un score **inventé**, et il était immédiatement enregistrable. Or
`hasScoreInput` (`lib/shared/match-lock.ts`) compte « un score même nul » comme
une saisie : ce 0-0 accidentel **verrouillait définitivement la manche
précédente**, plus modifiable même par un admin.

Un champ vide, lui, ne part pas par mégarde : `parseScoreInput` renvoie `null`,
et les deux actions restent refusées tant que les deux scores ne sont pas
renseignés. Le vide sert aussi à distinguer « pas encore joué » de « 0-0 », ce
que le dialogue ne savait pas montrer.

### Un match déjà tranché ne s'enregistre plus, il se re-tranche

L'enregistrement n'écrit que les deux scores. Appliqué à un match qui a déjà un
vainqueur, il laissait `winner_team_id` et la qualifiée du tour suivant sur
l'ancien résultat : le plateau affichait alors un match **gagné par l'équipe qui
perd**, sans la moindre erreur remontée.

Le refus est posé aux deux bouts :

- `decideScoreForm` renvoie le blocage `ALREADY_DECIDED` et l'interface
  désactive « Enregistrer le score » en disant quoi faire à la place ;
- `adminSaveMatchScores` lève `MATCH_ALREADY_COMPLETED` (→ 409) — le contrôle
  qui compte, l'interface n'étant qu'un raccourci.

Corriger un résultat acquis passe donc par « Valider le résultat », qui
recalcule la gagnante depuis les scores et repropage dans le plateau. Le
verrouillage aval (`CANNOT_MODIFY_COMPLETED_DEPENDENT_MATCHES`) continue de
s'appliquer par-dessus : une manche suivante déjà entamée fige tout.

### Un forfait ne peut désigner qu'une des deux engagées

Les deux routes acceptaient n'importe quel entier positif comme `forfeitTeamId`.
Un identifiant étranger au match passait en base, et `adminResolveMatch` en
déduisait un vainqueur **par défaut** : l'équipe 1 gagnait, simplement parce
qu'aucune des deux n'était celle déclarée forfait. `assertForfeitBelongsToMatch`
refuse maintenant en `INVALID_FORFEIT_TEAM_ID` (→ 400), dans les deux routes.

## Le dialogue suit le flux

Le match n'est **pas** capturé à l'ouverture. La page retient son identifiant et
le résout à chaque rendu depuis `detail.matches` — même règle que les dialogues
de diffusion et de calendrier :

```tsx
const matchForAdminScore =
  selectedMatchForAdminId === null
    ? null
    : detail.matches.find((match) => match.id === selectedMatchForAdminId) ?? null;
```

Sans cela, un objet figé à l'ouverture continuait d'afficher « 0 – 0 » sur un
match que le flux SSE venait de rapporter à 2-1 — et l'enregistrer écrasait la
saisie de l'autre arbitre. Le dialogue se referme aussi de lui-même si le match
disparaît (plateau régénéré, tournoi supprimé).

Le hook se réaligne sur l'**empreinte du résultat enregistré**
(`storedResultSignature`), pas sur le seul identifiant du match, puisque le
match peut changer sans que le dialogue soit refermé. Ce qui arrive alors dépend
de ce que le lecteur a fait :

- **rien saisi** → la nouvelle valeur est adoptée silencieusement ;
- **une saisie en cours** → elle est conservée, et un bandeau signale le
  désaccord (« Ce match a été modifié pendant ta saisie ») avec un bouton
  « Reprendre la valeur à jour ». On ne détruit pas le travail de l'un, on ne
  laisse pas écraser celui de l'autre sans le dire.

Le changement d'identifiant reste couvert par la même comparaison : ouvrir le
dialogue sur un second match repart de son propre score, jamais de celui du
précédent.

## Accessibilité

Le dialogue passe par `useDialogBehavior` comme les autres modales du site :
`Échap` (bloqué pendant un envoi), piège à focus, défilement de l'arrière-plan
verrouillé, focus rendu au bouton déclencheur à la fermeture. Il se déclare
`role="dialog"` / `aria-modal` / `aria-labelledby`, et `Entrée` dans un champ
vaut « Valider le résultat » — l'issue attendue d'une saisie de score,
l'enregistrement intermédiaire restant un geste délibéré.

Les deux côtés du score partagent le même composant `ScoreStepper` : les
boutons `−` / `+` portent un `aria-label` nommant l'équipe, et le champ signale
`aria-invalid` sur une valeur illisible ou hors plage — mais jamais sur un champ
vide, qui n'est pas une erreur.
