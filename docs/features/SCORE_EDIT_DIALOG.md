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
| **Enregistrer** | `PATCH /api/admin/matches/[id]/scores` | écrit `team1_score` / `team2_score` **et rien d'autre** | le **plafond** du format |
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
  désactive « Enregistrer » en disant quoi faire à la place ;
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

## Ce que la modale montre, et quand

Le geste courant est « je saisis un score, je valide ». Tout ce qui n'y sert pas
est conditionnel, replié, ou réduit à un lien — la version précédente empilait
neuf blocs pour ce seul geste, dont un rappel de format qui n'apprenait rien et
quatre lignes de prose sur le forfait.

| Élément | Affiché quand |
|---|---|
| Pastille de format (`BO5`, `FT3`) et sa règle chiffrée | le tournoi en a un — « Score libre — aucune limite » occupait une ligne pour ne rien apprendre |
| Résultat déjà en base | il ne se lit pas dans les champs : match tranché, ou saisie en cours qui recouvre l'ancienne valeur |
| Bandeau de désaccord | le résultat enregistré a changé pendant une saisie |
| Forfait | replié derrière « Déclarer un forfait » ; déplié d'office si un forfait est déjà enregistré, puisqu'il commande alors la rencontre. Le bouton est un vrai dépliage — il reste en place, porte `aria-expanded` / `aria-controls`, et sert d'annulation, ce qui évite un troisième bouton dans la rangée |
| Raison d'un refus | une action est bloquée (celle de la validation d'abord) |

Les actions ont trois poids distincts, faute de quoi elles se lisaient comme
trois équivalents : **Valider le résultat** est le bouton plein, **Enregistrer**
est en retrait (`btn ghost`), **Fermer** est un lien poussé à gauche. Le style
désactivé est posé dans le module — le `.btn` global n'en a pas, et un bouton
refusé gardait donc `opacity: 1` et `cursor: pointer`, sans rien dire de son
refus. Il doit être écrit `:global(.btn)` : CSS Modules hacherait un `.btn`
local, et la règle ne s'appliquerait à rien.

## Accessibilité

La règle chiffrée du format (« premier à 3 manches gagnées, 5 au maximum ») est
posée **sous les champs**, pas en `title` de la pastille : une infobulle sur un
`<span>` ne s'atteint ni au clavier ni au doigt, et c'est la seule chose qui
borne la saisie.

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

## Ouverture sur une proposition d'équipe en attente

Face à une **équipe fantôme**, la confirmation d'un score proposé n'arrive jamais : personne ne s'y connecte. L'arbitrage devait alors ouvrir le dialogue sur des champs vides et recopier le score que les joueurs avaient déjà saisi.

`pendingScoreProposal` (`_lib/score-form.ts`) rend la proposition **seule** en attente, et `scoreFormStateFor` ouvre le dialogue dessus : un clic sur « Valider le résultat » la confirme. Le bouton de la carte devient « Valider le score proposé », et le dialogue dit d'où viennent les chiffres.

Pas de pré-remplissage quand :

- le match est tranché, porte un score enregistré par l'arbitrage ou un forfait — ce qui est en base prime ;
- les **deux** engagées ont proposé (désaccord) — pré-remplir avec l'une donnerait raison à une équipe sans décision de l'arbitre.

La règle vaut aussi entre deux équipes réelles : pré-remplir n'écrit rien, seul le clic de l'arbitre valide.

Une proposition arrivée pendant que le dialogue est ouvert a sa propre empreinte (`pendingProposalSignature`), distincte de `storedResultSignature` : elle remplace des champs intacts, mais ne lève **pas** l'alerte « un autre arbitre a enregistré un résultat » sur une saisie en cours — elle n'écrit rien.

## Notes reprises de CLAUDE.md

Texte déplacé tel quel depuis `CLAUDE.md` (allègement du fichier chargé à chaque session).

- **Dialogue d'édition d'un score** (`app/(secured)/tournois/[id]/_lib/score-form.ts` pur + `_hooks/useScoreForm.ts` + `_components/AdminScoreDialog.tsx`) : deux actions qu'il ne faut pas confondre — **« Enregistrer »** (`PATCH .../scores`) note l'avancement d'une rencontre en cours et n'écrit *que* les deux scores, **« Valider le résultat »** (`POST .../resolve`) désigne la gagnante et propage dans le plateau. D'où trois refus, posés dans le module pur *et* côté serveur : un match jamais joué ouvre sur des **champs vides** et non sur un « 0 – 0 » inventé (ce zéro était enregistrable, et `hasScoreInput` le comptant comme une saisie, il **verrouillait la manche précédente**) ; un match **déjà tranché** n'accepte plus l'enregistrement (`MATCH_ALREADY_COMPLETED` → 409), qui laissait `winner_team_id` et la qualifiée sur l'ancien résultat — un match affiché gagné par l'équipe qui perd ; un **forfait** ne peut désigner qu'une des deux engagées (`INVALID_FORFEIT_TEAM_ID` → 400), faute de quoi `adminResolveMatch` déduisait un vainqueur par défaut. L'affichage est **conditionnel par défaut** : pastille de format seulement s'il y en a un, résultat en base seulement s'il ne se lit pas dans les champs, forfait replié derrière un lien, et trois poids distincts pour les actions (« Valider le résultat » plein, « Enregistrer » en retrait, « Fermer » en lien) — le style désactivé du `.btn` global s'écrit `:global(.btn)`, sans quoi CSS Modules le hache et la règle ne s'applique à rien. Le match est **résolu à chaque rendu** depuis `detail.matches` (comme les dialogues de diffusion et de calendrier), et le hook se réaligne sur l'empreinte du **résultat enregistré** : rien saisi → adoption silencieuse de ce qu'apporte le flux, saisie en cours → bandeau de désaccord plutôt qu'un écrasement muet. Voir `docs/features/SCORE_EDIT_DIALOG.md`.
